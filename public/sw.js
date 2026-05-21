/* CUVETSMO Imaging — minimal service worker for PWA Share Target.
 *
 * Scope: ONLY the share-target POST. We do NOT cache static assets here
 * because Vercel's CDN already serves the Next.js bundle with strong
 * `cache-control: public, immutable` for hashed assets — a SW cache
 * layer on top would just create staleness bugs without measurable wins.
 *
 * Inbox handoff (matches lib/dicom/share-inbox.ts):
 *   1. POST /share-receiver arrives → parse formData()
 *   2. Stash File[] into IDB store `cuvi-share-inbox-v1` under a numeric id
 *   3. Redirect (303) to /share-receiver?ts=<id>
 *   4. The client-side page reads + drains that id, then runs the
 *      same runBulkImport pipeline LabHome uses
 *
 * Why 303 (See Other) not 302 (Found)?
 *   The spec calls for 303 specifically so the browser performs a GET
 *   after the POST, regardless of the original POST method. 302 would
 *   work in most browsers but is technically ambiguous.
 *
 * Compatibility:
 *   - Android Chrome / Edge / Samsung Internet — full PWA Share Target
 *   - Desktop Chrome (with installed PWA) — also works
 *   - iOS Safari — Share Target is NOT supported (Apple has not shipped
 *     the manifest field as of 2026-05). The share-receiver page handles
 *     this gracefully with an empty-state explanation.
 *
 * Verified against:
 *   - https://web.dev/articles/web-share-target (W3C spec)
 *   - MDN: ServiceWorkerGlobalScope.fetch handling FormData
 */

const SHARE_INBOX_DB = 'cuvi-share-inbox-v1';
const SHARE_INBOX_VERSION = 1;
const SHARE_INBOX_STORE = 'inbox';

// ─── Lifecycle ──────────────────────────────────────────────────────

self.addEventListener('install', () => {
  // Skip the waiting phase so the new SW activates immediately on first
  // install (no need for the user to close every tab).
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Claim every client (open tab) in scope so subsequent POSTs to
  // /share-receiver are intercepted without a refresh.
  event.waitUntil(self.clients.claim());
});

// ─── Share Target POST interceptor ──────────────────────────────────

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only intercept the share-target action POST. Everything else passes
  // through to the network untouched (Vercel CDN).
  if (
    event.request.method === 'POST' &&
    url.pathname === '/share-receiver'
  ) {
    event.respondWith(handleShareTarget(event.request));
  }
});

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();

    // PWA Share Target API: the `files` param can be a single File or
    // array. We declared `name: "file"` in manifest.json so getAll('file')
    // returns the full list.
    const allFiles = formData.getAll('file');
    const files = allFiles.filter((entry) => entry instanceof File);

    // Optional text fields the share intent may include (e.g. PACS
    // browser sends study description as `title`).
    const title = formData.get('title');
    const text = formData.get('text');

    const id = await stashInIdb(
      files,
      typeof title === 'string' ? title : undefined,
      typeof text === 'string' ? text : undefined,
    );

    // 303 See Other forces a GET on the redirect target, regardless of
    // the original POST method. This is what the W3C spec recommends
    // for share-target redirects.
    return Response.redirect(`/share-receiver?ts=${id}`, 303);
  } catch (err) {
    // If anything in the stash path explodes (IDB unavailable, formData
    // parse failed) we still redirect to the receiver page — it knows
    // how to render an empty / error state. Better than a generic
    // browser error screen mid-share.
    console.warn('[sw] share-target failed:', err);
    return Response.redirect('/share-receiver?error=stash_failed', 303);
  }
}

// ─── IDB stash (mirrors lib/dicom/share-inbox.ts) ────────────────────

function openShareInboxDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_INBOX_DB, SHARE_INBOX_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SHARE_INBOX_STORE)) {
        db.createObjectStore(SHARE_INBOX_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb open failed'));
    req.onblocked = () => reject(new Error('idb upgrade blocked'));
  });
}

async function stashInIdb(files, title, text) {
  const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);

  // Convert each File → { name, type, blob } so the stored shape is
  // pure structured-clone-friendly. (File extends Blob, so this is a
  // no-op copy of the underlying bytes — the structured clone the IDB
  // put() performs is the actual cost.)
  const entry = {
    id,
    files: files.map((f) => ({
      name: f.name || 'shared.dcm',
      type: f.type || 'application/dicom',
      blob: f.slice(0, f.size, f.type || 'application/dicom'),
    })),
    title,
    text,
    stashedAt: Date.now(),
  };

  const db = await openShareInboxDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([SHARE_INBOX_STORE], 'readwrite');
    tx.objectStore(SHARE_INBOX_STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('idb write failed'));
    tx.onabort = () => reject(tx.error || new Error('idb write aborted'));
  });
  return id;
}
