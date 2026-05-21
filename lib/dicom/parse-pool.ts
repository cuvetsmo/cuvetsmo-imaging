// Web Worker pool for parallel DICOM header parsing.
//
// Phase 4 / Agent 🅱.  Public surface is `parseDicomBatch` — everything
// else (pool lifecycle, worker recycling, abort plumbing) is internal.
//
// Design summary:
//   - Lazy: pool spawns on the first parseDicomBatch call, never at import
//     time (SSR-safe — Next.js compiles this file for the server bundle
//     even though the workers themselves are client-only).
//   - Pool size: navigator.hardwareConcurrency - 1, clamped to [1, 8].
//   - Each worker processes one file at a time; idle workers pull from the
//     FIFO queue.
//   - Transferable ArrayBuffers — zero-copy from main → worker.
//   - Crash recovery: onerror / onmessageerror respawns the slot and
//     surfaces the failure to the awaiting promise.
//   - AbortController.signal drains the queue (rejects pending) but lets
//     in-flight parses finish (workers can't be interrupted mid-message);
//     the returned promise resolves with whatever completed before the
//     abort hit.
//
// The pool is a singleton per page load. Workers are kept warm between
// batches because spawn cost (~20–80ms on a cold start) outweighs the
// memory savings of tearing down between drops.

"use client";

import type {
  DicomFileMeta,
  ParseDicomBatchOptions,
  ParseErrorFn,
  ParseProgressFn,
  ParseRequest,
  ParseResponse,
  ParsedHeader,
} from "./parse-types";

// ---------------------------------------------------------------------------
// Pool internals
// ---------------------------------------------------------------------------

interface PendingTask {
  id: number;
  file: File;
  arrayBuffer: ArrayBuffer;
  resolve: (meta: DicomFileMeta) => void;
  reject: (err: Error) => void;
}

interface PoolWorker {
  /** The underlying Worker. */
  worker: Worker;
  /** The task this worker is currently parsing, or null if idle. */
  current: PendingTask | null;
}

interface Pool {
  workers: PoolWorker[];
  queue: PendingTask[];
  /** Tasks the pool is responsible for (queued OR in flight). */
  pendingById: Map<number, PendingTask>;
}

let pool: Pool | null = null;
let nextTaskId = 1;

/** Browser-safe pool size — clamped to [1, 8]. */
function computePoolSize(override?: number): number {
  if (override != null) {
    return clamp(Math.floor(override), 1, 8);
  }
  // SSR-safe — navigator is only defined in the browser. Default to 2.
  const hc =
    typeof navigator !== "undefined" &&
    typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : 3;
  return clamp(hc - 1, 1, 8);
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function spawnWorker(): Worker {
  // The `new URL(..., import.meta.url)` pattern is the canonical
  // webpack/Next.js way to register a worker file as a separate chunk
  // (works under `next build --webpack`, which this project uses).
  return new Worker(new URL("./parse-worker.ts", import.meta.url), {
    type: "module",
    name: "dicom-parse-worker",
  });
}

function ensurePool(poolSize: number): Pool {
  if (pool) return pool;

  const workers: PoolWorker[] = [];
  pool = { workers, queue: [], pendingById: new Map() };

  for (let i = 0; i < poolSize; i++) {
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
  slot.worker.onmessage = (e: MessageEvent<ParseResponse>) => {
    const msg = e.data;
    const task = slot.current;
    // Defensive: response without an in-flight task = stale post-crash.
    if (!task || task.id !== msg.id) {
      slot.current = null;
      pumpSlot(slot, p);
      return;
    }
    slot.current = null;
    p.pendingById.delete(task.id);

    if (msg.ok) {
      const meta: DicomFileMeta = { ...msg.meta, fileHandle: task.file };
      task.resolve(meta);
    } else {
      task.reject(new Error(msg.error || "Unknown parse error"));
    }
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
  // Fail the in-flight task (if any) and replace the worker.
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

  // Spawn a replacement and let it pick up the queue.
  slot.worker = spawnWorker();
  attachHandlers(slot, p);
  pumpSlot(slot, p);
}

function pumpSlot(slot: PoolWorker, p: Pool): void {
  if (slot.current) return;
  const next = p.queue.shift();
  if (!next) return;
  slot.current = next;
  // Transfer ArrayBuffer ownership — zero-copy.
  const req: ParseRequest = { id: next.id, arrayBuffer: next.arrayBuffer };
  slot.worker.postMessage(req, [next.arrayBuffer]);
}

function pumpAll(p: Pool): void {
  for (const slot of p.workers) {
    if (!slot.current) pumpSlot(slot, p);
  }
}

function describeEvent(ev: Event): string {
  // ErrorEvent has more fields; pluck what's safe.
  const e = ev as ErrorEvent;
  const parts: string[] = [];
  if (e.message) parts.push(e.message);
  if (e.filename) parts.push(`${e.filename}:${e.lineno ?? "?"}`);
  return parts.join(" ") || ev.type;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse the headers of `files` in parallel via a Web Worker pool.
 *
 * Resolves with one {@link DicomFileMeta} per successfully-parsed file
 * (in completion order, not input order). Per-file failures invoke
 * `onError` and are dropped from the result list rather than rejecting
 * the whole batch.
 *
 * @param files Input files (any size — pool keeps parallelism in check).
 * @param onProgress Optional `(done, total, latest?)` callback. Called
 *   once per file completion (success only). `done` and `total` count
 *   resolved+rejected, so a UI bar reaches 100% even if some fail.
 * @param onError Optional `(file, err)` callback for parse failures.
 * @param signal Optional AbortSignal. Aborts pending (queued) tasks; in-
 *   flight tasks finish naturally.
 * @returns Resolves with the successfully-parsed metas. Never rejects
 *   except for non-recoverable infra failures (e.g. Worker constructor
 *   threw because the browser doesn't support module workers).
 */
export function parseDicomBatch(
  files: File[],
  onProgress?: ParseProgressFn,
  onError?: ParseErrorFn,
  signal?: AbortSignal,
): Promise<DicomFileMeta[]>;

/** Object-options overload (preferred for new call sites). */
export function parseDicomBatch(
  files: File[],
  options: ParseDicomBatchOptions,
): Promise<DicomFileMeta[]>;

export function parseDicomBatch(
  files: File[],
  optsOrOnProgress?: ParseProgressFn | ParseDicomBatchOptions,
  onError?: ParseErrorFn,
  signal?: AbortSignal,
): Promise<DicomFileMeta[]> {
  // Normalize arguments.
  let onProgress: ParseProgressFn | undefined;
  let onErr: ParseErrorFn | undefined;
  let abortSignal: AbortSignal | undefined;
  let poolSizeOverride: number | undefined;

  if (typeof optsOrOnProgress === "function" || optsOrOnProgress === undefined) {
    onProgress = optsOrOnProgress as ParseProgressFn | undefined;
    onErr = onError;
    abortSignal = signal;
  } else {
    onProgress = optsOrOnProgress.onProgress;
    onErr = optsOrOnProgress.onError;
    abortSignal = optsOrOnProgress.signal;
    poolSizeOverride = optsOrOnProgress.poolSize;
  }

  return runBatch(files, onProgress, onErr, abortSignal, poolSizeOverride);
}

async function runBatch(
  files: File[],
  onProgress: ParseProgressFn | undefined,
  onError: ParseErrorFn | undefined,
  signal: AbortSignal | undefined,
  poolSizeOverride: number | undefined,
): Promise<DicomFileMeta[]> {
  if (files.length === 0) return [];

  // Pool boot is deferred to here so the Worker constructor never runs
  // on the server (Next.js still type-checks/imports this module).
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    throw new Error(
      "parseDicomBatch: Web Workers unavailable (server runtime?)",
    );
  }

  const size = computePoolSize(poolSizeOverride);
  const p = ensurePool(size);

  const total = files.length;
  let done = 0;
  const out: DicomFileMeta[] = [];

  // Track tasks this call enqueued so abort only affects our batch.
  const batchIds = new Set<number>();
  let aborted = false;

  const onAbort = () => {
    aborted = true;
    // Drain queued items that belong to this batch.
    p.queue = p.queue.filter((t) => {
      if (!batchIds.has(t.id)) return true;
      batchIds.delete(t.id);
      p.pendingById.delete(t.id);
      t.reject(new DOMException("Aborted", "AbortError"));
      return false;
    });
    // In-flight tasks finish naturally — workers can't be interrupted
    // mid-postMessage without termination, and termination would cost
    // us the parse result we're about to receive anyway.
  };

  if (signal) {
    if (signal.aborted) {
      return [];
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    // Read all File buffers in parallel (the read itself is async — the
    // browser fans these out without blocking).
    const buffers = await Promise.all(
      files.map((f) =>
        f.arrayBuffer().then(
          (buf) => ({ file: f, buf, err: null as Error | null }),
          (err: unknown) => ({
            file: f,
            buf: null as ArrayBuffer | null,
            err: err instanceof Error ? err : new Error(String(err)),
          }),
        ),
      ),
    );

    const tasks: Promise<void>[] = [];

    for (const item of buffers) {
      if (aborted) break;

      if (!item.buf || item.err) {
        onError?.(item.file, item.err?.message ?? "Failed to read file");
        done++;
        onProgress?.(done, total);
        continue;
      }

      const id = nextTaskId++;
      batchIds.add(id);

      const promise = new Promise<void>((resolve) => {
        const task: PendingTask = {
          id,
          file: item.file,
          arrayBuffer: item.buf!,
          resolve: (meta) => {
            out.push(meta);
            done++;
            onProgress?.(done, total, meta);
            resolve();
          },
          reject: (err) => {
            // AbortError: silent (the caller chose to cancel — no toast).
            if (!(err instanceof DOMException && err.name === "AbortError")) {
              onError?.(item.file, err.message);
            }
            done++;
            onProgress?.(done, total);
            resolve();
          },
        };

        p.pendingById.set(id, task);
        p.queue.push(task);
      });
      tasks.push(promise);
    }

    // Kick the pool — pumps as many slots as we have queued tasks.
    pumpAll(p);

    await Promise.all(tasks);
    return out;
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

// ---------------------------------------------------------------------------
// Test / diagnostic helpers (not in the public worker contract; safe to
// import for unit-test setup or debug panels).
// ---------------------------------------------------------------------------

/** Returns the current pool size, or 0 if the pool hasn't booted yet. */
export function getPoolSize(): number {
  return pool?.workers.length ?? 0;
}

/**
 * Tear the pool down. Mainly for tests / HMR. In-flight tasks are
 * rejected with an 'AbortError'. Safe to call when no pool exists.
 */
export function disposePool(): void {
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
