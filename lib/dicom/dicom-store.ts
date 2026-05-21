// dicom-store.ts — Persistent DICOM blob + metadata store backed by IndexedDB.
//
// Phase 4 contract (Agent 🅳). Shared types with parse-types.ts:
//   DicomFileMeta { fileHandle: File, studyUid, seriesUid, sopInstanceUid, ... }
//
// On STORAGE we drop `fileHandle: File` (cannot re-open same File between
// sessions — the user-gesture-attached handle is gone after refresh) and
// persist a Blob + the rest of the meta. On READ we reconstruct a synthetic
// File by name `${sopInstanceUid}.dcm` so the rest of the pipeline (parser,
// Cornerstone3D loader) works uniformly with the live-import code path.
//
// Vanilla IndexedDB — no `idb` dependency. ~330 LOC, no extra bundle weight.

import type { DicomFileMeta } from "./parse-types";

// ─── Shared contract types (matches Agent 🅲) ────────────────────────────────
//
// Defined locally so this file compiles independently of Agent 🅲's
// `study-organizer.ts`. Identical shape — if 🅲's types ship under
// `lib/dicom/study-organizer.ts` later, swap the import; the structural
// shape is the same.

export interface Series {
  seriesUid: string;
  seriesDescription?: string;
  modality: string;
  instances: DicomFileMeta[];
}

export interface Study {
  studyUid: string;
  patientId?: string;
  studyDescription?: string;
  acquisitionDate?: string;
  series: Series[];
}

// ─── DB constants ────────────────────────────────────────────────────────────

const DB_NAME = "cuvi-dicom-v1";
// AGENT-B Phase 5: bump from v1 → v2 to add the `thumbnails` object store.
// onupgradeneeded path below is additive — existing v1 stores are
// preserved untouched, so this is a forward-compatible upgrade for users
// with persisted Phase 4 studies.
const DB_VERSION = 2;
const STORE_INSTANCES = "instances";
const STORE_STUDIES = "studies";
// AGENT-B: thumbnail cache. Keyed by studyUid (one PNG per study, not
// per series — first instance only).
const STORE_THUMBNAILS = "thumbnails";

// LRU eviction triggers when `used / available > EVICT_THRESHOLD`.
// 0.85 leaves enough headroom that a single new batch of 100 MB won't
// instantly OOM the bucket.
const EVICT_THRESHOLD = 0.85;

// Internal shapes stored on disk. `meta` strips fileHandle (circular File
// reference is not structured-cloneable across the IDB boundary cleanly,
// and we want a clean separation between Blob and meta anyway).
interface StoredInstance {
  /** Primary key (matches meta.sopInstanceUid). Duplicated for index lookups. */
  sopInstanceUid: string;
  /** All DicomFileMeta fields EXCEPT fileHandle (File). */
  meta: Omit<DicomFileMeta, "fileHandle">;
  /** The actual DICOM bytes. */
  blob: Blob;
  /** Epoch ms when this instance was first persisted. Used for LRU tie-break. */
  addedAt: number;
}

interface StoredStudy {
  studyUid: string;
  patientId?: string;
  studyDescription?: string;
  acquisitionDate?: string;
  /** Denormalised series summary (lets us render the panel without scanning instances). */
  series: Array<{
    seriesUid: string;
    seriesDescription?: string;
    modality: string;
    /** Just the instance UIDs — actual files come from `instances` store on demand. */
    sopInstanceUids: string[];
  }>;
  /** Earliest addedAt across this study's instances. Used for LRU eviction. */
  addedAt: number;
}

// AGENT-B Phase 5: PNG thumbnail keyed by studyUid. Generated lazily by
// the thumbnail worker pool after a `saveBatch` (or on StudyTree mount
// when the cache lookup misses). Deleted alongside the parent study by
// deleteStudy() / clearAll() / evictIfNeeded().
interface StoredThumbnail {
  studyUid: string;
  /** Image PNG bytes (always image/png, 192×192 by default). */
  blob: Blob;
  /** Epoch ms when generated. Used for staleness checks. */
  generatedAt: number;
}

// ─── Module state ────────────────────────────────────────────────────────────

/** Lazy DB handle. `null` = not yet opened. `false` = IDB unavailable (private mode). */
let dbPromise: Promise<IDBDatabase> | null | false = null;

/** Have we called `navigator.storage.persist()` already this session? */
let persistAttempted = false;

/** In-memory fallback for private/incognito (graceful degrade). */
const memoryFallback = {
  instances: new Map<string, StoredInstance>(),
  studies: new Map<string, StoredStudy>(),
  // AGENT-B Phase 5: thumbnail cache, same fallback path.
  thumbnails: new Map<string, StoredThumbnail>(),
  inUse: false,
};

// ─── Open / upgrade ──────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB unavailable in this environment");
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_INSTANCES)) {
        const s = db.createObjectStore(STORE_INSTANCES, {
          keyPath: "sopInstanceUid",
        });
        s.createIndex("by_study", "meta.studyUid", { unique: false });
        s.createIndex("by_series", "meta.seriesUid", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_STUDIES)) {
        db.createObjectStore(STORE_STUDIES, { keyPath: "studyUid" });
      }
      // AGENT-B Phase 5: v1 → v2 additive upgrade. Existing studies +
      // instances are preserved; thumbnails are filled in lazily as the
      // worker pool generates them.
      if (!db.objectStoreNames.contains(STORE_THUMBNAILS)) {
        db.createObjectStore(STORE_THUMBNAILS, { keyPath: "studyUid" });
      }
    };
    req.onsuccess = () => {
      // Reset our cached handle if the connection version-changes out
      // from under us (other tab triggers an upgrade).
      req.result.onversionchange = () => {
        try { req.result.close(); } catch { /* noop */ }
        dbPromise = null;
      };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
    req.onblocked = () => reject(new Error("IDB upgrade blocked by another tab"));
  });
}

async function db(): Promise<IDBDatabase | null> {
  if (dbPromise === false) return null;
  if (!dbPromise) {
    try {
      dbPromise = openDb();
    } catch (err) {
      dbPromise = false;
      memoryFallback.inUse = true;
      console.warn("[dicom-store] IDB unavailable — using in-memory fallback:", err);
      return null;
    }
  }
  try {
    return await dbPromise;
  } catch (err) {
    dbPromise = false;
    memoryFallback.inUse = true;
    console.warn("[dicom-store] IDB open failed — using in-memory fallback:", err);
    return null;
  }
}

/** True iff we're running on the memory fallback path. UI can show a banner. */
export function isUsingMemoryFallback(): boolean {
  return memoryFallback.inUse;
}

// ─── Tx helpers ──────────────────────────────────────────────────────────────

function tx(
  d: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
): IDBTransaction {
  return d.transaction(stores, mode);
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
}

function txAsPromise(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error("IDB tx failed"));
    t.onabort = () => reject(t.error ?? new Error("IDB tx aborted"));
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Persist a batch of parsed DICOM files (Blob + metadata).
 *
 * Idempotent: writing the same sopInstanceUid twice overwrites the entry
 * but keeps the original `addedAt` (LRU age preserved across re-imports).
 *
 * Triggers `navigator.storage.persist()` once per session on first save,
 * and runs LRU eviction if quota is above 85%.
 */
export async function saveBatch(metas: DicomFileMeta[]): Promise<void> {
  if (metas.length === 0) return;

  // Best-effort persistence prompt — only fires once per session.
  if (!persistAttempted) {
    persistAttempted = true;
    void requestPersistence();
  }

  const d = await db();

  // Build StoredInstance entries up-front (sequential, off the tx clock).
  const now = Date.now();
  const prepared: Array<{ key: string; entry: StoredInstance }> = [];
  for (const m of metas) {
    const blob = await fileToBlob(m.fileHandle);
    const { fileHandle: _fh, ...rest } = m;
    void _fh;
    prepared.push({
      key: m.sopInstanceUid,
      entry: {
        sopInstanceUid: m.sopInstanceUid,
        meta: rest,
        blob,
        addedAt: now,
      },
    });
  }

  // Group by studyUid → seriesUid for the denormalised summary write.
  const studyDelta = groupForSummary(metas);

  if (!d) {
    // In-memory fallback
    for (const { key, entry } of prepared) {
      const prior = memoryFallback.instances.get(key);
      if (prior) entry.addedAt = prior.addedAt;
      memoryFallback.instances.set(key, entry);
    }
    for (const [uid, incoming] of studyDelta) {
      const existing = memoryFallback.studies.get(uid);
      const merged = existing ? mergeStudy(existing, incoming, now) : { ...incoming, addedAt: now };
      memoryFallback.studies.set(merged.studyUid, merged);
    }
    return;
  }

  // IndexedDB path — one read+write tx for instances, one for studies.
  const t1 = tx(d, [STORE_INSTANCES], "readwrite");
  const instancesStore = t1.objectStore(STORE_INSTANCES);
  for (const { entry } of prepared) {
    // Preserve original addedAt if this UID already exists.
    const prior = await reqAsPromise(instancesStore.get(entry.sopInstanceUid));
    if (prior) entry.addedAt = (prior as StoredInstance).addedAt;
    instancesStore.put(entry);
  }
  await txAsPromise(t1);

  // Merge study summaries.
  await mergeStudySummariesIDB(d, studyDelta, now);

  // Quota check (best-effort, doesn't block).
  void evictIfNeeded(EVICT_THRESHOLD);
}

/**
 * Load every persisted study. Hydrates each Study with its DicomFileMeta
 * (including a reconstructed `fileHandle: File` from the stored Blob).
 *
 * Returns studies sorted by `addedAt` descending (most-recent first), so
 * the panel reads as a reverse-chronological recent-imports feed.
 */
export async function loadAllStudies(): Promise<Study[]> {
  const d = await db();
  if (!d) {
    return hydrateMany(
      Array.from(memoryFallback.studies.values()),
      (k) => Promise.resolve(memoryFallback.instances.get(k)),
    );
  }

  // Snapshot the two stores in one tx — consistent point-in-time view.
  const t = tx(d, [STORE_INSTANCES, STORE_STUDIES], "readonly");
  const studiesArr = (await reqAsPromise(t.objectStore(STORE_STUDIES).getAll())) as StoredStudy[];
  const instArr = (await reqAsPromise(t.objectStore(STORE_INSTANCES).getAll())) as StoredInstance[];
  await txAsPromise(t);

  const instMap = new Map<string, StoredInstance>();
  for (const i of instArr) instMap.set(i.sopInstanceUid, i);

  return hydrateMany(studiesArr, (k) => Promise.resolve(instMap.get(k)));
}

/**
 * Delete a single study (its summary + every instance under it).
 * AGENT-B Phase 5: also drops the cached thumbnail for this study so
 * the next import re-generates rather than serving the old preview.
 */
export async function deleteStudy(studyUid: string): Promise<void> {
  const d = await db();
  if (!d) {
    const s = memoryFallback.studies.get(studyUid);
    if (s) {
      for (const series of s.series) {
        for (const uid of series.sopInstanceUids) memoryFallback.instances.delete(uid);
      }
      memoryFallback.studies.delete(studyUid);
    }
    // AGENT-B: drop cached thumbnail (independent of study presence).
    memoryFallback.thumbnails.delete(studyUid);
    return;
  }

  const t = tx(d, [STORE_INSTANCES, STORE_STUDIES, STORE_THUMBNAILS], "readwrite");
  const studiesStore = t.objectStore(STORE_STUDIES);
  const instancesStore = t.objectStore(STORE_INSTANCES);
  const idx = instancesStore.index("by_study");

  // Walk the index to delete every instance whose meta.studyUid matches.
  const cursorReq = idx.openKeyCursor(IDBKeyRange.only(studyUid));
  await new Promise<void>((resolve, reject) => {
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result;
      if (!cur) return resolve();
      instancesStore.delete(cur.primaryKey);
      cur.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error("cursor failed"));
  });

  studiesStore.delete(studyUid);
  // AGENT-B Phase 5: nuke the thumbnail in the same tx so we never have
  // an orphaned PNG pointing at a deleted study.
  t.objectStore(STORE_THUMBNAILS).delete(studyUid);
  await txAsPromise(t);
}

/**
 * Nuke everything in the store.
 * AGENT-B Phase 5: also clears the thumbnail cache.
 */
export async function clearAll(): Promise<void> {
  const d = await db();
  if (!d) {
    memoryFallback.instances.clear();
    memoryFallback.studies.clear();
    // AGENT-B: drop cached thumbnails too.
    memoryFallback.thumbnails.clear();
    return;
  }
  const t = tx(d, [STORE_INSTANCES, STORE_STUDIES, STORE_THUMBNAILS], "readwrite");
  t.objectStore(STORE_INSTANCES).clear();
  t.objectStore(STORE_STUDIES).clear();
  // AGENT-B Phase 5.
  t.objectStore(STORE_THUMBNAILS).clear();
  await txAsPromise(t);
}

// ─── AGENT-B Phase 5: thumbnail cache API ────────────────────────────

/**
 * Persist a generated PNG thumbnail for a study. Overwrites any prior
 * entry (re-generation is allowed, e.g. when the user manually clicks
 * "regenerate"). The blob should already be the final 192×192 PNG.
 */
export async function saveThumbnail(
  studyUid: string,
  blob: Blob,
): Promise<void> {
  if (!studyUid) return;
  const entry: StoredThumbnail = {
    studyUid,
    blob,
    generatedAt: Date.now(),
  };
  const d = await db();
  if (!d) {
    memoryFallback.thumbnails.set(studyUid, entry);
    return;
  }
  const t = tx(d, [STORE_THUMBNAILS], "readwrite");
  t.objectStore(STORE_THUMBNAILS).put(entry);
  await txAsPromise(t);
}

/**
 * Read a cached thumbnail blob. Returns null if no entry exists.
 */
export async function loadThumbnail(studyUid: string): Promise<Blob | null> {
  if (!studyUid) return null;
  const d = await db();
  if (!d) {
    const got = memoryFallback.thumbnails.get(studyUid);
    return got ? got.blob : null;
  }
  const t = tx(d, [STORE_THUMBNAILS], "readonly");
  const got = (await reqAsPromise(t.objectStore(STORE_THUMBNAILS).get(studyUid))) as
    | StoredThumbnail
    | undefined;
  await txAsPromise(t);
  return got ? got.blob : null;
}

/**
 * Bulk-load thumbnails for a list of studies. Returns a Map keyed by
 * studyUid — entries are present only for studies that have a cached
 * blob. Single transaction, one cursor walk.
 */
export async function loadThumbnailMap(
  studyUids: string[],
): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  if (studyUids.length === 0) return out;
  const d = await db();
  if (!d) {
    for (const uid of studyUids) {
      const got = memoryFallback.thumbnails.get(uid);
      if (got) out.set(uid, got.blob);
    }
    return out;
  }
  const t = tx(d, [STORE_THUMBNAILS], "readonly");
  const store = t.objectStore(STORE_THUMBNAILS);
  // One get per UID — same cost as a cursor for our typical set sizes
  // (single-digit to low-hundreds studies).
  await Promise.all(
    studyUids.map(async (uid) => {
      const got = (await reqAsPromise(store.get(uid))) as
        | StoredThumbnail
        | undefined;
      if (got) out.set(uid, got.blob);
    }),
  );
  await txAsPromise(t);
  return out;
}

/**
 * Real quota numbers from `navigator.storage.estimate()` (NOT faked).
 * `available` is what the spec calls `quota` (the bucket's max budget).
 * `persistedGranted` reflects whether storage is marked persistent
 * (browsers won't auto-evict under disk pressure when granted).
 */
export async function getQuota(): Promise<{
  used: number;
  available: number;
  persistedGranted: boolean;
}> {
  let used = 0;
  let available = 0;
  if (
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    typeof navigator.storage?.estimate === "function"
  ) {
    try {
      const est = await navigator.storage.estimate();
      used = est.usage ?? 0;
      available = est.quota ?? 0;
    } catch {
      /* noop */
    }
  }
  let persistedGranted = false;
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.persisted === "function"
  ) {
    try {
      persistedGranted = await navigator.storage.persisted();
    } catch {
      /* noop */
    }
  }
  return { used, available, persistedGranted };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function requestPersistence(): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.persist !== "function"
  )
    return;
  try {
    const already = (await navigator.storage.persisted?.()) ?? false;
    if (already) return;
    await navigator.storage.persist();
  } catch {
    /* noop — some browsers no-op or reject silently */
  }
}

async function fileToBlob(f: File): Promise<Blob> {
  // File extends Blob, so we COULD return it directly, but copying through
  // arrayBuffer detaches any retained references to the user's source
  // FileList (browsers can then GC the disk-backed handle once stored).
  // The structured-clone wire copy is the storage cost, not this allocation.
  return new Blob([await f.arrayBuffer()], {
    type: f.type || "application/dicom",
  });
}

function blobToFile(blob: Blob, sopInstanceUid: string): File {
  return new File([blob], `${sopInstanceUid}.dcm`, {
    type: blob.type || "application/dicom",
  });
}

/**
 * Group a flat meta[] into the {studyUid → seriesUid → instanceUid[]} shape
 * we use for the denormalised study summary write.
 */
function groupForSummary(metas: DicomFileMeta[]): Map<string, StoredStudy> {
  const studies = new Map<string, StoredStudy>();
  for (const m of metas) {
    let s = studies.get(m.studyUid);
    if (!s) {
      s = {
        studyUid: m.studyUid,
        patientId: m.patientId,
        studyDescription: m.studyDescription,
        acquisitionDate: m.acquisitionDate,
        series: [],
        addedAt: 0, // filled by caller
      };
      studies.set(m.studyUid, s);
    }
    // First non-empty value wins for the study-level fields (UIDs may have
    // arrived from per-instance reads with sparse fields).
    if (!s.patientId && m.patientId) s.patientId = m.patientId;
    if (!s.studyDescription && m.studyDescription) s.studyDescription = m.studyDescription;
    if (!s.acquisitionDate && m.acquisitionDate) s.acquisitionDate = m.acquisitionDate;

    let ser = s.series.find((x) => x.seriesUid === m.seriesUid);
    if (!ser) {
      ser = {
        seriesUid: m.seriesUid,
        seriesDescription: m.seriesDescription,
        modality: m.modality,
        sopInstanceUids: [],
      };
      s.series.push(ser);
    }
    if (!ser.seriesDescription && m.seriesDescription) ser.seriesDescription = m.seriesDescription;
    if (!ser.sopInstanceUids.includes(m.sopInstanceUid)) {
      ser.sopInstanceUids.push(m.sopInstanceUid);
    }
  }
  return studies;
}

/**
 * IDB-path merge of new study summaries into existing ones — preserves
 * earliest addedAt and unions series/instance UID lists. The in-memory
 * fallback inlines the equivalent logic in `saveBatch` to avoid the
 * async callback indirection.
 */
async function mergeStudySummariesIDB(
  d: IDBDatabase,
  delta: Map<string, StoredStudy>,
  now: number,
): Promise<void> {
  const t = tx(d, [STORE_STUDIES], "readwrite");
  const store = t.objectStore(STORE_STUDIES);
  for (const [uid, incoming] of delta) {
    const existing = (await reqAsPromise(store.get(uid))) as StoredStudy | undefined;
    const merged = existing ? mergeStudy(existing, incoming, now) : { ...incoming, addedAt: now };
    store.put(merged);
  }
  await txAsPromise(t);
}

function mergeStudy(existing: StoredStudy, incoming: StoredStudy, now: number): StoredStudy {
  const seriesById = new Map(existing.series.map((s) => [s.seriesUid, { ...s, sopInstanceUids: [...s.sopInstanceUids] }]));
  for (const incSer of incoming.series) {
    const cur = seriesById.get(incSer.seriesUid);
    if (!cur) {
      seriesById.set(incSer.seriesUid, { ...incSer, sopInstanceUids: [...incSer.sopInstanceUids] });
    } else {
      if (!cur.seriesDescription && incSer.seriesDescription) cur.seriesDescription = incSer.seriesDescription;
      for (const uid of incSer.sopInstanceUids) {
        if (!cur.sopInstanceUids.includes(uid)) cur.sopInstanceUids.push(uid);
      }
    }
  }
  return {
    studyUid: existing.studyUid,
    patientId: existing.patientId ?? incoming.patientId,
    studyDescription: existing.studyDescription ?? incoming.studyDescription,
    acquisitionDate: existing.acquisitionDate ?? incoming.acquisitionDate,
    series: Array.from(seriesById.values()),
    // Preserve oldest addedAt (LRU age). Brand-new entries use `now`.
    addedAt: existing.addedAt > 0 ? existing.addedAt : now,
  };
}

async function hydrateMany(
  studies: StoredStudy[],
  getInstance: (k: string) => Promise<StoredInstance | undefined>,
): Promise<Study[]> {
  const sorted = [...studies].sort((a, b) => b.addedAt - a.addedAt);
  const hydrated: Study[] = [];
  for (const s of sorted) {
    const series: Series[] = [];
    for (const ser of s.series) {
      const instances: DicomFileMeta[] = [];
      for (const uid of ser.sopInstanceUids) {
        const got = await getInstance(uid);
        if (!got) continue; // orphan summary entry — silently skip
        const fileHandle = blobToFile(got.blob, got.sopInstanceUid);
        instances.push({ ...got.meta, fileHandle });
      }
      if (instances.length > 0) {
        series.push({
          seriesUid: ser.seriesUid,
          seriesDescription: ser.seriesDescription,
          modality: ser.modality,
          instances,
        });
      }
    }
    if (series.length > 0) {
      hydrated.push({
        studyUid: s.studyUid,
        patientId: s.patientId,
        studyDescription: s.studyDescription,
        acquisitionDate: s.acquisitionDate,
        series,
      });
    }
  }
  return hydrated;
}

/**
 * LRU eviction: drop the oldest study (by `acquisitionDate` then `addedAt`)
 * while we're above `threshold` of the bucket quota. Best-effort — never
 * throws into the caller's path.
 */
async function evictIfNeeded(threshold: number): Promise<void> {
  try {
    const { used, available } = await getQuota();
    if (available <= 0) return;
    if (used / available <= threshold) return;

    const d = await db();
    if (!d) {
      // Memory fallback: nothing to do — RAM pressure isn't quota-managed.
      return;
    }

    const studiesArr = await reqAsPromise(
      tx(d, [STORE_STUDIES], "readonly").objectStore(STORE_STUDIES).getAll(),
    ) as StoredStudy[];
    if (studiesArr.length === 0) return;

    // Sort ASCENDING — oldest first.
    const ranked = [...studiesArr].sort((a, b) => {
      const ad = parseAcqDate(a.acquisitionDate);
      const bd = parseAcqDate(b.acquisitionDate);
      if (ad !== bd) return ad - bd;
      return a.addedAt - b.addedAt;
    });

    for (const victim of ranked) {
      await deleteStudy(victim.studyUid);
      const q = await getQuota();
      if (q.available <= 0 || q.used / q.available <= threshold) break;
    }
  } catch (err) {
    console.warn("[dicom-store] evictIfNeeded failed:", err);
  }
}

function parseAcqDate(d?: string): number {
  if (!d) return 0;
  // DICOM YYYYMMDD → millis. Falls back to 0 for anything malformed.
  if (/^\d{8}$/.test(d)) {
    const y = Number(d.slice(0, 4));
    const m = Number(d.slice(4, 6)) - 1;
    const day = Number(d.slice(6, 8));
    const t = Date.UTC(y, m, day);
    return Number.isFinite(t) ? t : 0;
  }
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : 0;
}
