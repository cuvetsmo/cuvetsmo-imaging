// Web Worker pool for parallel DICOM thumbnail generation.
//
// AGENT-B · Phase 5 thumbnail pipeline.
//
// Mirrors parse-pool.ts architecture (lazy singleton, FIFO queue,
// transferable ArrayBuffers, crash-recovery respawn) but with two
// differences:
//   - Pool size: hardwareConcurrency-1 clamped to [1, 4]. Lower ceiling
//     than parse-pool because pixel decoding + canvas ops are heavier
//     than header-only parsing. 4 workers @ ~80 MB peak each is the
//     practical headroom on a Macbook with 16 GB RAM.
//   - Each task ships a full File `.arrayBuffer()`, not just a header
//     slice. Memory cost scales with image size (8 MB chest DR is fine,
//     1 GB whole-slide pathology would die — but we never thumbnail
//     things that big).
//
// Public API:
//   generateThumbnail(file, opts?)
//     → Promise<Blob>  single-shot, used for "regenerate this one"
//   generateThumbnailsForStudies(studies, onReady)
//     → Promise<void> · iterates one instance per study (NOT per series —
//                      a 200-slice CT thumbnails its first slice only).

"use client";

// ─── Wire types (kept inline — only the pool + worker speak this) ──────

interface ThumbnailRequest {
  id: number;
  arrayBuffer: ArrayBuffer;
  size?: number;
}

type ThumbnailResponse =
  | { id: number; ok: true; thumbnailBlob: Blob }
  | { id: number; ok: false; error: string };

// Public shape — kept duck-typed to avoid a hard import on study-organizer.
interface StudyLike {
  studyUid: string;
  series: Array<{
    instances: Array<{
      sopInstanceUid: string;
      fileHandle: File;
    }>;
  }>;
}

interface PendingTask {
  id: number;
  arrayBuffer: ArrayBuffer;
  size: number;
  resolve: (blob: Blob) => void;
  reject: (err: Error) => void;
}

interface PoolWorker {
  worker: Worker;
  current: PendingTask | null;
}

interface Pool {
  workers: PoolWorker[];
  queue: PendingTask[];
  pendingById: Map<number, PendingTask>;
}

let pool: Pool | null = null;
let nextTaskId = 1;

// ─── Pool internals ────────────────────────────────────────────────────

function computePoolSize(): number {
  const hc =
    typeof navigator !== "undefined" &&
    typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : 3;
  // Heavier-than-parse workers → tighter clamp [1, 4].
  const n = hc - 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 4) return 4;
  return n;
}

function spawnWorker(): Worker {
  return new Worker(
    new URL("./thumbnail-worker.ts", import.meta.url),
    { type: "module", name: "dicom-thumbnail-worker" },
  );
}

function ensurePool(): Pool {
  if (pool) return pool;
  const workers: PoolWorker[] = [];
  pool = { workers, queue: [], pendingById: new Map() };
  const size = computePoolSize();
  for (let i = 0; i < size; i++) {
    workers.push(createPoolWorker(pool));
  }
  return pool;
}

function createPoolWorker(p: Pool): PoolWorker {
  const slot: PoolWorker = { worker: spawnWorker(), current: null };
  attachHandlers(slot, p);
  return slot;
}

function attachHandlers(slot: PoolWorker, p: Pool): void {
  slot.worker.onmessage = (e: MessageEvent<ThumbnailResponse>) => {
    const msg = e.data;
    const task = slot.current;
    if (!task || task.id !== msg.id) {
      // Stale post-crash response — clear the slot and pump.
      slot.current = null;
      pumpSlot(slot, p);
      return;
    }
    slot.current = null;
    p.pendingById.delete(task.id);

    if (msg.ok) task.resolve(msg.thumbnailBlob);
    else task.reject(new Error(msg.error || "Unknown thumbnail error"));

    pumpSlot(slot, p);
  };

  slot.worker.onmessageerror = (ev) => {
    crashSlot(slot, p, `messageerror: ${describeEvent(ev)}`);
  };
  slot.worker.onerror = (ev) => {
    crashSlot(
      slot,
      p,
      `worker error: ${ev.message || describeEvent(ev) || "unknown"}`,
    );
  };
}

function crashSlot(slot: PoolWorker, p: Pool, reason: string): void {
  const task = slot.current;
  slot.current = null;
  try {
    slot.worker.terminate();
  } catch {
    /* ignore */
  }
  if (task) {
    p.pendingById.delete(task.id);
    task.reject(new Error(reason));
  }
  slot.worker = spawnWorker();
  attachHandlers(slot, p);
  pumpSlot(slot, p);
}

function pumpSlot(slot: PoolWorker, p: Pool): void {
  if (slot.current) return;
  const next = p.queue.shift();
  if (!next) return;
  slot.current = next;
  const req: ThumbnailRequest = {
    id: next.id,
    arrayBuffer: next.arrayBuffer,
    size: next.size,
  };
  slot.worker.postMessage(req, [next.arrayBuffer]);
}

function pumpAll(p: Pool): void {
  for (const slot of p.workers) {
    if (!slot.current) pumpSlot(slot, p);
  }
}

function describeEvent(ev: Event): string {
  const e = ev as ErrorEvent;
  const parts: string[] = [];
  if (e.message) parts.push(e.message);
  if (e.filename) parts.push(`${e.filename}:${e.lineno ?? "?"}`);
  return parts.join(" ") || ev.type;
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Generate a single thumbnail PNG from a DICOM File.
 *
 * Resolves with a PNG Blob. Rejects on parse / render errors (caller
 * should swallow and fall back to a glyph). `signal` aborts a queued
 * task before it dispatches; in-flight tasks finish naturally (workers
 * can't be interrupted mid-message without termination).
 */
export async function generateThumbnail(
  file: File,
  opts?: { size?: number; signal?: AbortSignal },
): Promise<Blob> {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    throw new Error("Web Workers unavailable (server runtime?)");
  }
  const signal = opts?.signal;
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const size = opts?.size ?? 192;
  const p = ensurePool();
  const buffer = await file.arrayBuffer();

  return new Promise<Blob>((resolve, reject) => {
    const id = nextTaskId++;
    const task: PendingTask = {
      id,
      arrayBuffer: buffer,
      size,
      resolve,
      reject,
    };
    p.pendingById.set(id, task);

    const onAbort = () => {
      // Try to remove from queue. If already in-flight, just drop the
      // resolution slot — worker still finishes silently.
      const qi = p.queue.indexOf(task);
      if (qi >= 0) p.queue.splice(qi, 1);
      p.pendingById.delete(id);
      reject(new DOMException("Aborted", "AbortError"));
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    p.queue.push(task);
    pumpAll(p);
  });
}

/**
 * Generate thumbnails for an array of Studies, calling `onReady` as
 * each one completes. Uses ONE instance per study (the first available),
 * not all 200 CT slices.
 *
 * Resolves once every study has either succeeded or failed. Caller is
 * expected to dispatch a `cuvi:thumbnail-ready` event from `onReady`
 * so StudyCard can re-render.
 *
 * `skip(studyUid)` returns true to skip studies that already have a
 * cached thumbnail. Caller is responsible for the cache lookup; this
 * pool stays storage-agnostic.
 */
export async function generateThumbnailsForStudies(
  studies: StudyLike[],
  onReady: (studyUid: string, blob: Blob) => void,
  opts?: {
    size?: number;
    signal?: AbortSignal;
    skip?: (studyUid: string) => Promise<boolean> | boolean;
    onError?: (studyUid: string, err: Error) => void;
  },
): Promise<void> {
  if (typeof window === "undefined" || typeof Worker === "undefined") return;

  const size = opts?.size ?? 192;
  const signal = opts?.signal;
  const skip = opts?.skip;
  const onError = opts?.onError;

  const work: Array<Promise<void>> = [];

  for (const study of studies) {
    if (signal?.aborted) break;

    // Pick the first instance — typically series[0].instances[0].
    const instance = findFirstInstance(study);
    if (!instance) continue;

    work.push(
      (async () => {
        if (skip) {
          try {
            const shouldSkip = await skip(study.studyUid);
            if (shouldSkip) return;
          } catch {
            /* If skip-check fails, generate anyway. */
          }
        }
        if (signal?.aborted) return;

        try {
          const blob = await generateThumbnail(instance.fileHandle, {
            size,
            signal,
          });
          onReady(study.studyUid, blob);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          onError?.(
            study.studyUid,
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      })(),
    );
  }

  await Promise.all(work);
}

function findFirstInstance(study: StudyLike): { fileHandle: File } | null {
  for (const series of study.series ?? []) {
    for (const inst of series.instances ?? []) {
      if (inst?.fileHandle) return inst;
    }
  }
  return null;
}

// ─── Test / diagnostic helpers ─────────────────────────────────────────

export function getThumbnailPoolSize(): number {
  return pool?.workers.length ?? 0;
}

/** Tear the pool down. Mainly for tests / HMR. */
export function disposeThumbnailPool(): void {
  if (!pool) return;
  const p = pool;
  pool = null;
  for (const task of p.pendingById.values()) {
    task.reject(new DOMException("Pool disposed", "AbortError"));
  }
  for (const slot of p.workers) {
    try {
      slot.worker.terminate();
    } catch {
      /* ignore */
    }
  }
}
