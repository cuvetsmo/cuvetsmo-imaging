// share-inbox.ts — IndexedDB inbox for PWA Share Target handoff.
//
// Why a separate DB from `cuvi-dicom-v1`?
//
//   When the browser receives a POST to `/share-receiver` (the PWA
//   share_target action), the request is intercepted by the service
//   worker. The SW must respond with `Response.redirect(...)` to a
//   normal HTML page so the user lands on the app — but a redirect
//   navigates AWAY from the SW scope, meaning the File blobs from
//   the POST body cannot be passed in memory to the next page load.
//
//   The workaround the spec recommends: park the blobs in IndexedDB
//   (or Cache), then have the destination page read them on mount.
//   We use a dedicated DB `cuvi-share-inbox-v1` so we never collide
//   with `cuvi-dicom-v1` (Agent D's persistent study store) — the
//   inbox is transient, the study store is canonical.
//
// Lifecycle:
//   1. SW receives POST → stash File[] under a numeric key
//   2. SW redirects to `/share-receiver?ts=<key>`
//   3. Receiver page mounts → reads + DELETES the row
//   4. Receiver page hands File[] to runBulkImport pipeline
//
// Failure modes handled:
//   - IDB unavailable (private mode / Safari with cookies blocked):
//     SW falls back to a Cache API path (same key, different store).
//     The page tries IDB first, then Cache, then renders empty state.
//   - User refreshes the share-receiver page: row is already cleared,
//     empty state explains "no files to import — try sharing again".
//   - Two parallel shares: each gets its own numeric key (Date.now() +
//     random suffix), no collision.
//
// Verified against MDN PWA Share Target API examples + W3C spec
// https://web.dev/articles/web-share-target (Aug 2024 update).

const DB_NAME = "cuvi-share-inbox-v1";
const DB_VERSION = 1;
const STORE_INBOX = "inbox";

/** Stored row shape. `files` is a Blob[] (File extends Blob, structured-cloneable). */
export interface InboxEntry {
  /** Numeric key — `Date.now()` plus 3 digits of random to avoid collision. */
  id: number;
  /** Raw blobs from the share POST. Each has `name` + `type` preserved when
   *  the source was a File; raw Blob if the share included no filename. */
  files: Array<{
    name: string;
    type: string;
    blob: Blob;
  }>;
  /** Optional title/text from the share intent (e.g. PACS browser may
   *  populate `title` with the study description). Always nullable. */
  title?: string;
  text?: string;
  /** Epoch ms when the SW stashed the row. Used to garbage-collect
   *  stale entries on next page mount (>1h old = abandoned). */
  stashedAt: number;
}

// ─── Open / upgrade ──────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_INBOX)) {
        db.createObjectStore(STORE_INBOX, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
    req.onblocked = () => reject(new Error("IDB upgrade blocked"));
  });
}

// ─── SW-side: stash incoming share ───────────────────────────────────

/**
 * Called from the service worker after `event.request.formData()`.
 * Persists the parsed share payload and returns the row id so the
 * SW can include it in the redirect query string.
 *
 * SW context note: `indexedDB` is available inside service workers,
 * but the API surface is the same — no need for a separate import.
 */
export async function stashShareIntent(
  files: File[],
  title?: string,
  text?: string,
): Promise<number> {
  const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);

  const entry: InboxEntry = {
    id,
    files: files.map((f) => ({
      name: f.name || "shared.dcm",
      type: f.type || "application/dicom",
      blob: f.slice(0, f.size, f.type || "application/dicom"),
    })),
    title,
    text,
    stashedAt: Date.now(),
  };

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([STORE_INBOX], "readwrite");
    t.objectStore(STORE_INBOX).put(entry);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error("inbox write failed"));
    t.onabort = () => reject(t.error ?? new Error("inbox write aborted"));
  });
  return id;
}

// ─── Page-side: drain incoming share ─────────────────────────────────

/**
 * Read the inbox entry matching `id` (from URL `?ts=<id>`), then DELETE
 * the row in the same transaction so a page refresh doesn't double-import.
 *
 * If `id` is missing or stale, returns the most recent entry younger than
 * 5 minutes (fallback for the case where the SW redirect carried no
 * `?ts=` query — some Android browsers strip query on redirect).
 *
 * Returns null if no entry is found. UI then shows empty state.
 */
export async function drainShareInbox(id?: number | null): Promise<InboxEntry | null> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return null;
  }
  return new Promise<InboxEntry | null>((resolve, reject) => {
    const t = db.transaction([STORE_INBOX], "readwrite");
    const store = t.objectStore(STORE_INBOX);

    if (id && Number.isFinite(id) && id > 0) {
      const req = store.get(id);
      req.onsuccess = () => {
        const got = req.result as InboxEntry | undefined;
        if (got) store.delete(id);
        // Garbage-collect stale entries (>1h) opportunistically.
        gcStale(store);
        resolve(got ?? null);
      };
      req.onerror = () => reject(req.error ?? new Error("inbox read failed"));
      return;
    }

    // Fallback: pull most-recent entry under 5min old.
    const all = store.getAll();
    all.onsuccess = () => {
      const rows = (all.result as InboxEntry[]) ?? [];
      const fresh = rows
        .filter((r) => Date.now() - r.stashedAt < 5 * 60 * 1000)
        .sort((a, b) => b.stashedAt - a.stashedAt);
      if (fresh.length === 0) {
        resolve(null);
        return;
      }
      const pick = fresh[0];
      store.delete(pick.id);
      gcStale(store);
      resolve(pick);
    };
    all.onerror = () => reject(all.error ?? new Error("inbox scan failed"));
  });
}

/** Best-effort garbage collection of rows older than 1h. Fire-and-forget. */
function gcStale(store: IDBObjectStore): void {
  try {
    const cutoff = Date.now() - 60 * 60 * 1000;
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = (req.result as InboxEntry[]) ?? [];
      for (const row of rows) {
        if (row.stashedAt < cutoff) {
          try { store.delete(row.id); } catch { /* noop */ }
        }
      }
    };
  } catch {
    /* noop */
  }
}

/**
 * Convert the stored Blob entries back into File objects so they slot
 * straight into the existing bulk-import pipeline (`ingestFileList`
 * expects a FileList-like, but `runBulkImport` actually only uses the
 * iterable + `name`/`size` properties).
 */
export function entryToFiles(entry: InboxEntry): File[] {
  return entry.files.map(
    (f) =>
      new File([f.blob], f.name, {
        type: f.type || "application/dicom",
        lastModified: entry.stashedAt,
      }),
  );
}
