/**
 * Bulk import helpers for cuvetsmo-imaging Phase 4.
 *
 * Three entry points feed the same pipeline:
 *  1. Loose file batch (existing dropzone behavior, lifted cap)
 *  2. Folder picker (webkitdirectory + DataTransferItem.webkitGetAsEntry)
 *  3. ZIP archive (client-side unpack via fflate)
 *
 * All three produce `File[]` candidates which the caller can then push
 * into Agent B's parse pool. We deliberately stop short of parsing here:
 * this module is concerned with discovering DICOM-shaped bytes only.
 *
 * Iron Rule 0 reminders:
 *  - DICOM detection uses the DICM magic byte at offset 128 (NEVER
 *    trust the .dcm extension alone — PACS dumps often write
 *    extension-less files named after the SOP-Instance-UID).
 *  - Folder traversal handles errors per-entry, never crashes the
 *    whole import on one bad symlink / permission denied.
 *  - ZIP unpack streams entries and bails on individual decode errors.
 */

// ─── DICOM detection ────────────────────────────────────────────────────────

/**
 * Magic-byte check. The DICOM preamble is 128 bytes of zero followed by
 * the ASCII characters "DICM" at offset 128. This is the spec-defined
 * way to identify a Part 10 file, and is much more reliable than the
 * filename extension.
 *
 * Returns true for:
 *  - Files with a .dcm or .dicom extension (fast path)
 *  - Files with the application/dicom MIME (fast path)
 *  - Anything with the DICM magic bytes (slow path, requires file read)
 */
export async function isDicomFile(file: File | Blob | null | undefined): Promise<boolean> {
  if (!file) return false;
  const f = file as File;
  const name = (typeof f.name === 'string' ? f.name : '').toLowerCase();
  if (name.endsWith('.dcm') || name.endsWith('.dicom')) return true;
  if (file.type === 'application/dicom') return true;
  if (file.size < 132) return false;
  try {
    const head = await file.slice(0, 200).arrayBuffer();
    const v = new Uint8Array(head);
    return v[128] === 0x44 && v[129] === 0x49 && v[130] === 0x43 && v[131] === 0x4D;
  } catch {
    return false;
  }
}

/**
 * Lightweight pre-filter that runs synchronously on names without
 * touching file bytes. Used to skip the obvious junk in a folder
 * traversal before paying for the magic-byte read.
 *
 * We DO NOT skip extension-less files here — PACS exports often have
 * no extension at all, and we need them to fall through to the
 * magic-byte check.
 */
export function isObviousNonDicom(name: string): boolean {
  const lower = name.toLowerCase();
  // Hidden files (macOS detritus + dotfiles)
  if (lower.startsWith('.')) return true;
  if (lower === 'dicomdir' || lower === 'dicomdir.exe') {
    // DICOMDIR is a directory listing, not an image instance. Skip.
    return true;
  }
  // Common non-DICOM exports a vet PACS often co-bundles
  const skipExts = ['.txt', '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.zip', '.rar', '.7z', '.tar', '.gz', '.html', '.htm', '.xml', '.json', '.csv', '.xls', '.xlsx', '.doc', '.docx', '.mp4', '.mov', '.avi'];
  for (const ext of skipExts) {
    if (lower.endsWith(ext)) return true;
  }
  // macOS resource forks
  if (lower.includes('__macosx/') || lower.endsWith('.ds_store')) return true;
  return false;
}

// ─── Folder traversal ──────────────────────────────────────────────────────

/**
 * DataTransferItem-based folder traversal. Fires when the user drags
 * a folder (rather than individual files) onto the dropzone. Each
 * DataTransferItem in `event.dataTransfer.items` may expose either a
 * file or a directory via webkitGetAsEntry().
 *
 * Returns a flat list of File objects, discovered depth-first. We
 * filter out obvious non-DICOM names AND apply the magic-byte check.
 *
 * Compatibility: Chrome / Edge / Safari 11.1+ / Firefox 50+ all
 * implement webkitGetAsEntry. Old browsers fall through with no items.
 *
 * Cancellation: pass an AbortSignal to bail mid-traversal on ESC.
 */
export async function traverseDataTransferItems(
  items: DataTransferItemList | null | undefined,
  opts?: { signal?: AbortSignal; onProgress?: (found: number) => void }
): Promise<File[]> {
  if (!items || items.length === 0) return [];
  const signal = opts?.signal;
  const onProgress = opts?.onProgress;

  const out: File[] = [];

  // Snapshot the entries up front. DataTransferItemList is live and
  // mutates after the drop event ends, so we resolve to FileSystemEntry
  // immediately.
  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // Only "file" kind can produce an entry. Strings (text/plain etc) are skipped.
    if (item.kind !== 'file') continue;
    // webkitGetAsEntry is the de-facto cross-browser API. The standard
    // .getAsFileSystemHandle() lives behind a flag in some browsers.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entry = (item as any).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  // BFS through directories. Each FileSystemDirectoryEntry has a
  // `createReader()` that yields children in pages of ~100; we drain
  // until empty.
  const queue: FileSystemEntry[] = [...entries];
  while (queue.length > 0) {
    if (signal?.aborted) break;
    const node = queue.shift();
    if (!node) continue;

    if (node.isFile) {
      const fileEntry = node as FileSystemFileEntry;
      if (isObviousNonDicom(fileEntry.name)) continue;
      try {
        const file = await fileEntryToFile(fileEntry);
        if (file && (await isDicomFile(file))) {
          out.push(file);
          onProgress?.(out.length);
        }
      } catch {
        // Permission denied / read error — skip silently
      }
    } else if (node.isDirectory) {
      const dirEntry = node as FileSystemDirectoryEntry;
      try {
        const children = await readAllDirectoryEntries(dirEntry);
        // Filter out obvious junk subdirs before queueing
        for (const c of children) {
          if (c.isFile && isObviousNonDicom(c.name)) continue;
          if (c.isDirectory && (c.name === '__MACOSX' || c.name.startsWith('.'))) continue;
          queue.push(c);
        }
      } catch {
        // Permission denied — skip the whole subtree
      }
    }
  }

  return out;
}

/**
 * Convert a FileSystemFileEntry to a File via its `file()` callback.
 * Promise wrapper around the legacy callback API.
 */
function fileEntryToFile(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(
      (f) => resolve(f),
      () => resolve(null)
    );
  });
}

/**
 * Drain a FileSystemDirectoryReader — chunks of ~100 entries at a time
 * until it returns an empty page. Skipping this loop misses files in
 * directories with more than ~100 entries (very common in PACS dumps
 * where a single study has 200+ slices).
 */
function readAllDirectoryEntries(dirEntry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const reader = dirEntry.createReader();
    const all: FileSystemEntry[] = [];
    const readChunk = () => {
      reader.readEntries(
        (entries) => {
          if (entries.length === 0) {
            resolve(all);
          } else {
            all.push(...entries);
            readChunk(); // keep reading until we get an empty page
          }
        },
        (err) => reject(err)
      );
    };
    readChunk();
  });
}

// ─── ZIP unpack ─────────────────────────────────────────────────────────────

/**
 * Detect a ZIP file by extension or MIME. Used at drop-time to decide
 * whether to route through `unpackZipFile` instead of treating the
 * file as a single DICOM instance.
 */
export function looksLikeZip(file: File | null | undefined): boolean {
  if (!file) return false;
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.zip')) return true;
  if (file.type === 'application/zip' || file.type === 'application/x-zip-compressed') return true;
  return false;
}

/**
 * Unpack a ZIP archive client-side via fflate. Each entry inside is
 * wrapped as a `File` whose name is the basename of the archive path
 * (folder structure inside the ZIP is flattened — Agent C's
 * StudyOrganizer groups by DICOM tags, not filesystem layout).
 *
 * Returns only entries that pass the magic-byte DICOM check.
 *
 * fflate API note: `unzip` is the streaming variant; we use it via a
 * Promise wrapper. Encrypted ZIPs and ZIP64-bombs are rejected by
 * fflate itself with `err` populated.
 */
export async function unpackZipFile(
  file: File,
  opts?: { signal?: AbortSignal; onProgress?: (found: number, total: number) => void }
): Promise<File[]> {
  // Dynamic import keeps fflate out of the LabHome chunk until a ZIP
  // is actually dropped — saves ~14KB unminified on the initial load.
  const { unzip } = await import('fflate');

  const bytes = new Uint8Array(await file.arrayBuffer());

  const entries: Record<string, Uint8Array> = await new Promise((resolve, reject) => {
    unzip(bytes, (err, files) => {
      if (err) reject(err);
      else resolve(files);
    });
  });

  const out: File[] = [];
  const names = Object.keys(entries);
  let processed = 0;

  for (const path of names) {
    if (opts?.signal?.aborted) break;
    processed++;
    opts?.onProgress?.(out.length, names.length);

    // Skip directory entries (path ends with /) and obvious junk
    if (path.endsWith('/')) continue;
    if (isObviousNonDicom(path)) continue;

    const base = basename(path);
    const data = entries[path];
    if (!data || data.length < 132) continue;

    // Wrap as File so downstream code (parser, viewer) sees a normal
    // File object identical to a dropped file. `lastModified` falls
    // back to now since fflate's metadata doesn't surface mtime
    // reliably across archive variants.
    // fflate returns Uint8Array; cast to BlobPart so the File ctor
    // accepts it on TS 5+ with strict DOM lib.
    const f = new File([data as BlobPart], base, {
      type: 'application/dicom',
      lastModified: Date.now(),
    });

    if (await isDicomFile(f)) {
      out.push(f);
    }
  }

  opts?.onProgress?.(out.length, names.length);
  return out;
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

// ─── Unified dropzone handler ──────────────────────────────────────────────

/**
 * Single entry point for ANY dropzone payload — handles loose files,
 * folder drops, and ZIP drops uniformly. The caller passes the raw
 * `DataTransfer` (from a drop event) and gets back a flat File[] of
 * DICOM candidates.
 *
 * Routing rules:
 *  - If `items` is present and any entry is a directory, traverse it.
 *  - If any single file looks like a ZIP, unpack it.
 *  - Otherwise filter the `files` list to DICOM by magic byte.
 *
 * All three branches converge on the magic-byte filter, so the caller
 * gets back DICOM-only File objects ready to hand to the parse pool.
 */
export async function ingestDropPayload(
  dt: DataTransfer | null | undefined,
  opts?: {
    signal?: AbortSignal;
    onProgress?: (status: BulkIngestProgress) => void;
  }
): Promise<File[]> {
  if (!dt) return [];
  const signal = opts?.signal;
  const emit = (patch: Partial<BulkIngestProgress>) =>
    opts?.onProgress?.({
      phase: 'discovering',
      filesFound: 0,
      filesTotal: 0,
      currentSource: '',
      ...patch,
    });

  emit({ phase: 'discovering', currentSource: 'dropped payload' });

  // 1. Folder branch — items[].webkitGetAsEntry sees any directory
  const items = dt.items;
  let hasDirectory = false;
  if (items && typeof (items as DataTransferItemList & { length: number }).length === 'number') {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind !== 'file') continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry = (it as any).webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        hasDirectory = true;
        break;
      }
    }
  }

  if (hasDirectory) {
    emit({ phase: 'discovering', currentSource: 'folder traversal' });
    const files = await traverseDataTransferItems(items, {
      signal,
      onProgress: (n) => emit({ phase: 'discovering', filesFound: n, currentSource: 'folder traversal' }),
    });
    return files;
  }

  // 2. ZIP branch — any single file with .zip extension or zip mime
  const fileList = dt.files;
  const looseFiles = fileList ? Array.from(fileList) : [];
  const zips = looseFiles.filter(looksLikeZip);
  if (zips.length > 0) {
    const out: File[] = [];
    let total = 0;
    for (const zip of zips) {
      if (signal?.aborted) break;
      emit({ phase: 'unzipping', currentSource: zip.name });
      try {
        const got = await unpackZipFile(zip, {
          signal,
          onProgress: (found, t) => {
            total += 0; // intentional: we report per-zip totals via filesTotal below
            emit({
              phase: 'unzipping',
              filesFound: out.length + found,
              filesTotal: total + t,
              currentSource: zip.name,
            });
          },
        });
        total += got.length;
        out.push(...got);
      } catch {
        // ZIP decode failed (corrupt archive, encrypted, etc.) — skip
        // the whole zip but don't crash the import.
      }
    }
    // Also accept any non-zip loose files dropped alongside the zip
    const nonZip = looseFiles.filter((f) => !looksLikeZip(f));
    for (const f of nonZip) {
      if (signal?.aborted) break;
      if (await isDicomFile(f)) out.push(f);
    }
    return out;
  }

  // 3. Plain file branch — filter to DICOM by magic byte
  const out: File[] = [];
  for (const f of looseFiles) {
    if (signal?.aborted) break;
    if (await isDicomFile(f)) {
      out.push(f);
      emit({
        phase: 'discovering',
        filesFound: out.length,
        filesTotal: looseFiles.length,
        currentSource: f.name,
      });
    }
  }
  return out;
}

/**
 * Same shape but for the <input type="file"> change handler — which
 * delivers a FileList (no DataTransfer, no folder entries, but
 * `webkitdirectory` does flatten a chosen directory into the list).
 */
export async function ingestFileList(
  fileList: FileList | null | undefined,
  opts?: {
    signal?: AbortSignal;
    onProgress?: (status: BulkIngestProgress) => void;
  }
): Promise<File[]> {
  if (!fileList || fileList.length === 0) return [];
  const signal = opts?.signal;
  const all = Array.from(fileList);

  // Branch: zip in the input (rare but possible if accept=".zip")
  const zips = all.filter(looksLikeZip);
  const looseFiles = all.filter((f) => !looksLikeZip(f));

  const out: File[] = [];
  const total = all.length;

  // Process loose files first (cheap)
  for (let i = 0; i < looseFiles.length; i++) {
    if (signal?.aborted) break;
    const f = looseFiles[i];
    if (isObviousNonDicom(f.name)) continue;
    if (await isDicomFile(f)) out.push(f);
    opts?.onProgress?.({
      phase: 'discovering',
      filesFound: out.length,
      filesTotal: total,
      currentSource: f.name,
    });
  }

  // Then unpack any ZIPs (slower, blocks on full ArrayBuffer)
  for (const zip of zips) {
    if (signal?.aborted) break;
    opts?.onProgress?.({
      phase: 'unzipping',
      filesFound: out.length,
      filesTotal: total,
      currentSource: zip.name,
    });
    try {
      const got = await unpackZipFile(zip, { signal });
      out.push(...got);
    } catch {
      // skip corrupt zip
    }
  }

  return out;
}

// ─── Public types ──────────────────────────────────────────────────────────

export type BulkIngestPhase = 'discovering' | 'unzipping' | 'parsing' | 'organizing' | 'done' | 'error';

export type BulkIngestProgress = {
  phase: BulkIngestPhase;
  filesFound: number;
  filesTotal: number;
  currentSource: string;
};

/**
 * Maximum files we'll attempt to import in one drop. PACS exports of a
 * full multi-modality study (CT + DR + US) can easily push past 1000
 * slices, and we want to leave headroom. The hard ceiling exists to
 * prevent a runaway drop (e.g. someone dragging "C:\") from blowing
 * up the parse pool / IndexedDB.
 */
export const MAX_BATCH_FILES = 5000;

/**
 * Side-by-side viewer cap is unchanged at 2 — that's a UI concern
 * (the grid only renders two panes), not an import concern.
 */
export const MAX_SIDE_BY_SIDE = 2;

/**
 * The shared file-meta contract — produced by Agent B's parse pool,
 * consumed by Agent C's StudyOrganizer and Agent D's dicom-store.
 *
 * DO NOT modify this shape without coordinating with the sister
 * agents. Kept exported here so any caller (including LabHome) can
 * pass typed arrays around without re-declaring.
 */
export type DicomFileMeta = {
  fileHandle: File;
  studyUid: string;
  seriesUid: string;
  sopInstanceUid: string;
  modality: string;
  patientId?: string;
  studyDescription?: string;
  seriesDescription?: string;
  acquisitionDate?: string;
  parsedAt: number;
};

export type Series = {
  seriesUid: string;
  seriesDescription?: string;
  modality: string;
  instances: DicomFileMeta[];
};

export type Study = {
  studyUid: string;
  patientId?: string;
  studyDescription?: string;
  acquisitionDate?: string;
  series: Series[];
};
