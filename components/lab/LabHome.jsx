'use client';
import { useState, useCallback, useEffect, useRef, Suspense, lazy } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useMediaQuery } from '../../lib/dicom/use-media-query.js';
import { CrosshairPattern } from '../CrosshairPattern';
import OnboardingTour, { HelpButton, useOnboardingTour } from './OnboardingTour.jsx';
import BulkDropzone from './BulkDropzone.jsx';
import BulkProgressPanel from './BulkProgressPanel.jsx';
import {
  ingestDropPayload,
  ingestFileList,
  MAX_BATCH_FILES,
  MAX_SIDE_BY_SIDE,
} from '../../lib/dicom/bulk-import.ts';
// AGENT-A Phase 5 — stack-mode auto-router for multi-instance studies.
// Routes Study → single / stack / side-by-side based on instance count so
// scrolling a 200-slice CT works out of the box from "Open study".
// Phase 6 — detectSyncCompareCandidate identifies "2 series of similar
// length" studies for the synced-compare workflow.
import { autoModeForFiles, detectSyncCompareCandidate } from '../../lib/dicom/stack-scroll';
// Agent 🅱 — worker pool that parses DICOM headers in parallel.
import { parseDicomBatch } from '../../lib/dicom/parse-pool.ts';
// Agent 🅲 — pure Study/Series grouping over a flat DicomFileMeta[].
import { organizeIntoStudies } from '../../lib/dicom/study-organizer.ts';
// Agent 🅳 — IndexedDB-backed persistence + custom-event refresh signal.
import { saveBatch, loadAllStudies, loadThumbnailMap, saveThumbnail } from '../../lib/dicom/dicom-store.ts';
// AGENT-B Phase 5 — thumbnail worker pool. Generates 192×192 PNG previews
// for each newly persisted study (off the main thread). Fires the
// `cuvi:thumbnail-ready` event StudyCard subscribes to.
import { generateThumbnailsForStudies } from '../../lib/dicom/thumbnail-pool.ts';

const DicomViewport = lazy(() => import('./DicomViewport.jsx'));
const TagInspector = lazy(() => import('./TagInspector.jsx'));

// Sister-agent component — the persistent studies panel below the
// dropzone. Lazy-loaded so its dicom-store + IndexedDB code stays out
// of the initial chunk. RecentImports itself lazy-loads StudyTree
// (Agent 🅲) internally, so this is the single mount point for the
// Study/Series tree on the home page. Avoids the double-mount that
// having both a "session-only" StudyTree and a "persisted" one in
// RecentImports would create.
const RecentImports = lazy(() =>
  import('./RecentImports.jsx').catch(() => ({ default: () => null }))
);

const RECENT_KEY = 'cuvi-recent-files';
const RECENT_MAX = 5;
// The legacy 2-file cap only applies to the side-by-side VIEWER pane
// grid, not to the import pipeline. Import path uses MAX_BATCH_FILES.
const MAX_FILES = MAX_SIDE_BY_SIDE;

// AGENT-④ Phase 8 — compare-mode per-axis sync preferences.
// Persisted across sessions so opening a new compare doesn't reset
// the user's preferred sync mix. Schema is intentionally narrow so
// future axes (annotation? zoom level? rotation?) can extend without
// breaking older saved shapes — unknown keys are merged with the
// defaults. Versioned key (`-v1`) for forward compatibility.
const COMPARE_SYNC_KEY = 'cuvi-compare-sync-axes-v1';
const COMPARE_SYNC_DEFAULTS = Object.freeze({
  slice: true,    // proportional slice-index mirror (Phase 6 default)
  camera: true,   // pan/zoom/rotation mirror (Phase 6 default)
  wl: false,      // Phase 8 — opt-in; clinicians often want different W/L per pane
});

function readCompareSyncAxes() {
  try {
    const raw = localStorage.getItem(COMPARE_SYNC_KEY);
    if (!raw) return COMPARE_SYNC_DEFAULTS;
    const parsed = JSON.parse(raw);
    // Merge with defaults so partial / older shapes still work.
    return {
      slice: typeof parsed.slice === 'boolean' ? parsed.slice : COMPARE_SYNC_DEFAULTS.slice,
      camera: typeof parsed.camera === 'boolean' ? parsed.camera : COMPARE_SYNC_DEFAULTS.camera,
      wl: typeof parsed.wl === 'boolean' ? parsed.wl : COMPARE_SYNC_DEFAULTS.wl,
    };
  } catch {
    return COMPARE_SYNC_DEFAULTS;
  }
}

function writeCompareSyncAxes(axes) {
  try { localStorage.setItem(COMPARE_SYNC_KEY, JSON.stringify(axes)); } catch { /* quota */ }
}

// Compact human-readable summary for the toggle title attribute.
// "Slice + Camera" / "All axes" / "W/L only" / "OFF". Used in the
// tooltip so the user can hover and see at a glance what's wired
// without opening the popover.
function describeSyncAxes(axes) {
  const on = [];
  if (axes.slice) on.push('Slice');
  if (axes.camera) on.push('Camera');
  if (axes.wl) on.push('W/L');
  if (on.length === 0) return 'OFF';
  if (on.length === 3) return 'All axes';
  return on.join(' + ');
}

// Peek at a DataTransferItemList to see if any item is a directory.
// Used to decide whether the "skipped non-DICOM" tally is meaningful —
// for folder drops the input count is 1 item but the discovered count
// is N files, so the subtraction would give a nonsense negative number.
function hasAnyDirectoryEntry(items) {
  if (!items) return false;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind !== 'file') continue;
    const entry = it.webkitGetAsEntry?.();
    if (entry?.isDirectory) return true;
  }
  return false;
}

export default function LabHome() {
  // Phase 6 — viewport stacks panes vertically below this breakpoint
  // (mobile-first). Synced compare on a 375 px phone reads better as
  // two stacked rows than two squished columns.
  const isNarrow = useMediaQuery('(max-width: 768px)');
  // Side-by-side viewer state. For modes other than 'side-by-side-stack'
  // this holds a flat File[] (legacy). For 'side-by-side-stack' it holds
  // File[][] — one inner array per pane (Phase 6).
  const [files, setFiles] = useState([]);
  // AGENT-A Phase 5 — viewer mode. Decides whether the viewer surface
  // renders ONE pane with a scrollable stack, ONE pane with a single
  // slice, TWO panes side-by-side (legacy compare), or — Phase 6 —
  // TWO STACK panes side-by-side with synced scroll. Auto-derived by
  // file count when not explicitly set via `openInMode(files, mode)`.
  const [viewMode, setViewMode] = useState('single');
  // Phase 6 / AGENT-④ Phase 8 — per-axis synced-compare state.
  //
  // Phase 6 used a single boolean `syncCompareEnabled` for slice + camera
  // together. Phase 8 splits it into three independent axes so users can
  // opt into W/L sync without giving up the slice/camera default — and
  // can also disable slice while keeping camera (or any other mix).
  //
  // Defaults: slice ON · camera ON · W/L OFF. The W/L default is OFF
  // because clinicians comparing normal vs cardiomegaly often want
  // different presets per pane (bone left vs lung right). The user
  // explicitly opts into W/L sync via the chrome popover.
  //
  // Persisted to localStorage so the preference sticks across sessions.
  // Hydration is deferred to a microtask (same pattern as `recent`) to
  // avoid React-Compiler "no setState sync in effect" warnings.
  const [compareSyncAxes, setCompareSyncAxes] = useState(COMPARE_SYNC_DEFAULTS);
  const [syncPopoverOpen, setSyncPopoverOpen] = useState(false);
  const syncPopoverRef = useRef(null);
  // Derived master gate — passed to ViewerPane as `syncEnabled`. When
  // every axis is off, we short-circuit the listeners entirely. This
  // also drives the "🔗 Sync ON / ⛓‍💥 Sync OFF" label on the toggle.
  const anySyncOn = compareSyncAxes.slice || compareSyncAxes.camera || compareSyncAxes.wl;
  const [error, setError] = useState(null);
  const [recent, setRecent] = useState([]);

  // Phase-4 bulk import state. `bulkProgress` is non-null only while
  // an import is in flight; the BulkProgressPanel renders off this
  // value. Persisted studies render in <RecentImports>, which hydrates
  // from IndexedDB after each `saveBatch` (via the
  // `cuvi:imports-changed` event). We don't keep a separate
  // session-only StudyTree state — the persisted view IS the session
  // view (avoids the double-StudyTree-mount that Agent 🅰 and 🅳
  // would otherwise both produce).
  const [bulkProgress, setBulkProgress] = useState(null);
  const abortRef = useRef(null);

  // 3-step onboarding tour (replaces the old "ยินดีต้อนรับ" welcome card).
  // Auto-launches on first visit (key `cuvi-tour-completed-v1`), manually
  // re-triggerable via the HelpButton in the bottom-right.
  const { open: tourOpen, openTour, closeTour } = useOnboardingTour();

  useEffect(() => {
    // Defer the hydration setState into a microtask — keeps React Compiler
    // happy ("no setState sync in effect") with no user-visible delay.
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(RECENT_KEY);
        if (raw) setRecent(JSON.parse(raw));
      } catch { /* corrupt JSON; ignore */ }
      // AGENT-④ Phase 8 — hydrate compare-sync preferences. Same
      // microtask-defer pattern so the initial render is the default
      // (matches SSR if ever added) and the saved prefs apply on the
      // next tick. Visually imperceptible.
      const axes = readCompareSyncAxes();
      setCompareSyncAxes(axes);
    });
  }, []);

  // AGENT-④ Phase 8 — single toggle for a per-axis sync flag. Persists
  // to localStorage on every change so refreshing mid-compare preserves
  // the user's preferred mix. Functional setter avoids stale-closure
  // bugs when several toggles fire close together (rare but cheap to
  // guard against).
  const toggleSyncAxis = useCallback((axis) => {
    setCompareSyncAxes((prev) => {
      const next = { ...prev, [axis]: !prev[axis] };
      writeCompareSyncAxes(next);
      return next;
    });
  }, []);

  // AGENT-④ Phase 8 — close popover on outside click / Escape. Same
  // contract MobileToolbarSheet uses elsewhere in the lab.
  useEffect(() => {
    if (!syncPopoverOpen) return;
    const onDocClick = (evt) => {
      const root = syncPopoverRef.current;
      if (root && !root.contains(evt.target)) setSyncPopoverOpen(false);
    };
    const onKey = (evt) => {
      if (evt.key === 'Escape') setSyncPopoverOpen(false);
    };
    document.addEventListener('pointerdown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [syncPopoverOpen]);

  const addToRecent = useCallback((f) => {
    if (!f) return;
    const entry = { name: f.name, size: f.size, lastModified: f.lastModified || Date.now() };
    setRecent((prev) => {
      const next = [entry, ...prev.filter((p) => !(p.name === entry.name && p.size === entry.size))].slice(0, RECENT_MAX);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, []);

  // AGENT-A Phase 5 — single entry point to open files in a specific
  // viewer mode. If `mode` is omitted, autoModeForFiles picks: 1→single,
  // 2→side-by-side, 3+→stack. Declared HERE (above runBulkImport)
  // because runBulkImport's deps reference openInMode.
  //
  // Phase 6 — when `mode === 'side-by-side-stack'`, `nextFiles` must be
  // a `File[][]` (array of arrays, one per pane). All other modes take
  // a flat `File[]`. The shape is checked before we commit to state so a
  // bad call doesn't leave the viewer in an unrecoverable mix.
  const openInMode = useCallback((nextFiles, mode) => {
    if (!nextFiles || nextFiles.length === 0) {
      setFiles([]);
      setViewMode('single');
      return;
    }
    if (mode === 'side-by-side-stack') {
      // Shape check — must be File[][]. If the caller passed File[] by
      // mistake, fall back to plain 'stack' (single pane) so we don't
      // render an empty grid.
      const isPaneArray = Array.isArray(nextFiles)
        && nextFiles.length >= 2
        && Array.isArray(nextFiles[0])
        && Array.isArray(nextFiles[1]);
      if (!isPaneArray) {
        setFiles(nextFiles);
        setViewMode('stack');
        return;
      }
      setFiles(nextFiles);
      setViewMode('side-by-side-stack');
      // AGENT-④ Phase 8 — sync axes are persisted across sessions, so
      // we DON'T reset on a new compare open. Users who turn W/L sync
      // on once keep it on for subsequent compares; same for any axis
      // they turned off. (Previously: defaulted slice+camera ON every
      // time. Now defaults only apply on first-ever use or after
      // localStorage clear.)
      return;
    }
    const resolved = mode || autoModeForFiles(nextFiles.length);
    setFiles(nextFiles);
    setViewMode(resolved);
  }, []);

  // AGENT-B Phase 5 — Thumbnail pipeline.
  //
  // Pipeline trace (subscribed end-to-end so every persisted study ends
  // up with a PNG preview):
  //   1. runBulkImport finishes → fires `cuvi:imports-changed`
  //   2. This effect listens to that event AND triggers an initial
  //      pass on mount (covers page refreshes where the worker pool
  //      died but the studies persist).
  //   3. We loadAllStudies + loadThumbnailMap; diff to find which
  //      studies are missing a cached PNG.
  //   4. generateThumbnailsForStudies queues those into the worker pool
  //      (≤4 workers, hardwareConcurrency-1).
  //   5. On each completion: saveThumbnail to IDB → mint a fresh
  //      ObjectURL → dispatch `cuvi:thumbnail-ready` with both the URL
  //      and the underlying Blob. StudyCard subscribes to the event,
  //      re-renders, and revokes the URL on unmount.
  //
  // AbortController on the effect's cleanup so a fast remount (HMR /
  // page-nav) doesn't leak work into a stale pass.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;
    let controller = null;

    const runPass = async () => {
      if (cancelled) return;
      // Always abort any prior in-flight pass before starting a new
      // one — `cuvi:imports-changed` can fire back-to-back during a
      // large folder drop, no point thumbnailing intermediate states.
      if (controller) {
        try { controller.abort(); } catch { /* noop */ }
      }
      controller = new AbortController();
      const signal = controller.signal;

      let studies = [];
      try {
        studies = await loadAllStudies();
      } catch (err) {
        console.warn('[LabHome thumb] loadAllStudies failed', err);
        return;
      }
      if (cancelled || signal.aborted || studies.length === 0) return;

      let cached;
      try {
        cached = await loadThumbnailMap(studies.map((s) => s.studyUid));
      } catch (err) {
        console.warn('[LabHome thumb] loadThumbnailMap failed', err);
        cached = new Map();
      }
      if (cancelled || signal.aborted) return;

      const missing = studies.filter((s) => !cached.has(s.studyUid));
      if (missing.length === 0) return;

      try {
        await generateThumbnailsForStudies(
          missing,
          (studyUid, blob) => {
            if (cancelled || signal.aborted) return;
            // Persist first so a refresh doesn't kick us back to glyph.
            saveThumbnail(studyUid, blob).catch((err) => {
              console.warn('[LabHome thumb] saveThumbnail failed', err);
            });
            // Mint a URL the dispatcher owns; StudyCard treats event-
            // supplied URLs as borrowed (revokes only its own).
            const url = URL.createObjectURL(blob);
            window.dispatchEvent(
              new CustomEvent('cuvi:thumbnail-ready', {
                detail: { studyUid, blob, url },
              }),
            );
          },
          {
            signal,
            // skip is redundant given our pre-filter, but adds safety
            // if a thumbnail lands between the loadThumbnailMap snapshot
            // and the worker dispatch.
            skip: async (uid) => cached.has(uid),
            onError: (uid, err) => {
              console.warn(`[LabHome thumb] study ${uid} failed`, err.message);
            },
          },
        );
      } catch (err) {
        if (!signal.aborted) {
          console.warn('[LabHome thumb] generation pass failed', err);
        }
      }
    };

    // Kick the initial pass on mount.
    void runPass();

    // Re-run after every import.
    const onChange = () => { void runPass(); };
    window.addEventListener('cuvi:imports-changed', onChange);

    return () => {
      cancelled = true;
      window.removeEventListener('cuvi:imports-changed', onChange);
      if (controller) {
        try { controller.abort(); } catch { /* noop */ }
      }
    };
  }, []);

  /**
   * Bulk-import pipeline — single entry point for any drop / pick /
   * folder-pick. Pulls DICOM-only Files from the payload (folder
   * traversal, ZIP unpack, magic-byte filter) and hands them off:
   *   - 1-2 files → also feed the side-by-side viewer state (legacy)
   *   - 3+ files → bulk-only flow, StudyTree below the dropzone
   *
   * The actual parse (DICOM tag extraction) is Agent B's worker pool;
   * the StudyTree (Agent C) and RecentImports (Agent D) read from
   * `importedFiles` once parse completes. While this Promise is in
   * flight, BulkProgressPanel is visible and ESC cancels via the
   * AbortController.
   */
  const runBulkImport = useCallback(
    async (kind, payload) => {
      // Abort any prior in-flight import (re-dropping mid-parse)
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch { /* noop */ }
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const signal = controller.signal;

      setError(null);
      setBulkProgress({
        phase: 'discovering',
        filesFound: 0,
        filesTotal: 0,
        currentSource: '',
      });

      let discovered = [];
      try {
        if (kind === 'drop') {
          discovered = await ingestDropPayload(payload, {
            signal,
            onProgress: (status) => setBulkProgress(status),
          });
        } else {
          // 'pick' (file input) or 'folder' (webkitdirectory input)
          discovered = await ingestFileList(payload, {
            signal,
            onProgress: (status) => setBulkProgress(status),
          });
        }
      } catch (err) {
        if (!signal.aborted) {
          setError(`Import failed: ${err?.message || 'unknown error'}`);
        }
        setBulkProgress(null);
        abortRef.current = null;
        return;
      }

      if (signal.aborted) {
        setBulkProgress(null);
        abortRef.current = null;
        return;
      }

      if (discovered.length === 0) {
        setError('ไม่พบไฟล์ DICOM ในรายการที่ลากมา (ตรวจ magic byte แล้วไม่ผ่าน)');
        setBulkProgress(null);
        abortRef.current = null;
        return;
      }

      // Cap at MAX_BATCH_FILES to prevent runaway ingest
      let batch = discovered;
      let skippedHardCap = 0;
      if (batch.length > MAX_BATCH_FILES) {
        skippedHardCap = batch.length - MAX_BATCH_FILES;
        batch = batch.slice(0, MAX_BATCH_FILES);
      }

      // Update recent-files history. We only record the first few names
      // (not all 5000 of a PACS dump) — recent is a UI hint, not a
      // replay store.
      for (const f of batch.slice(0, RECENT_MAX)) addToRecent(f);

      // For tiny batches (1-2 files), also seed the legacy side-by-side
      // viewer so single-file users get the familiar "drop → view"
      // experience. Larger batches stay on the home page with the
      // RecentImports panel as the navigator. Done BEFORE parse so
      // the viewer can start rendering Cornerstone while the worker
      // pool churns through the headers in the background.
      if (batch.length <= MAX_FILES) {
        // 1 file → single, 2 files → side-by-side (legacy behavior).
        openInMode(batch, batch.length === 1 ? 'single' : 'side-by-side');
      }

      // ── Phase 4 pipeline: parse → organize → persist → broadcast ──
      //
      // We DO NOT block the discovered-but-not-yet-parsed batch from
      // viewer-mode entry above. The viewer reads the File directly via
      // Cornerstone, independent of the worker pool's header metadata.
      // The pool feeds the StudyTree / RecentImports panels which need
      // grouped Study[] data, not raw bytes.
      setBulkProgress({
        phase: 'parsing',
        filesFound: 0,
        filesTotal: batch.length,
        currentSource: '',
      });

      let metas = [];
      try {
        metas = await parseDicomBatch(batch, {
          signal,
          onProgress: (done, total, latest) => {
            setBulkProgress({
              phase: 'parsing',
              filesFound: done,
              filesTotal: total,
              currentSource: latest?.fileHandle?.name || '',
            });
          },
        });
      } catch (err) {
        if (!signal.aborted) {
          setError(`Parse failed: ${err?.message || 'unknown error'}`);
        }
        setBulkProgress(null);
        abortRef.current = null;
        return;
      }

      if (signal.aborted) {
        setBulkProgress(null);
        abortRef.current = null;
        return;
      }

      // If every file failed to parse (e.g. all corrupt / not real
      // DICOM despite the magic byte) we still want the UI to recover
      // cleanly. Show the count mismatch as a message rather than
      // dropping the user back to an empty home screen with no clue.
      if (metas.length === 0) {
        setError(`Parse: 0 / ${batch.length} ไฟล์อ่าน DICOM header สำเร็จ — ลองตรวจไฟล์ต้นทาง`);
        setBulkProgress(null);
        abortRef.current = null;
        return;
      }

      // Group flat DicomFileMeta[] → Study → Series tree (Agent 🅲).
      setBulkProgress({
        phase: 'organizing',
        filesFound: metas.length,
        filesTotal: metas.length,
        currentSource: '',
      });
      const studies = organizeIntoStudies(metas);

      // Persist to IndexedDB (Agent 🅳). The store dedupes by
      // sopInstanceUid so re-dropping the same files is idempotent.
      try {
        await saveBatch(metas);
        // Notify RecentImports (sibling) so it rehydrates from IDB.
        // Listener registered in RecentImports.useEffect's onChange.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('cuvi:imports-changed'));
        }
      } catch (err) {
        // Don't fail the whole import if persistence fails — the user
        // can still view the files in this session. Just warn.
        console.warn('[LabHome] saveBatch failed', err);
        setError(
          `บันทึก offline ไม่สำเร็จ: ${err?.message || 'unknown'} (ภาพยังเปิดดูใน session นี้ได้)`
        );
      }

      // Build any user-facing skip message. We only count "non-DICOM
      // skipped" for the FLAT branches (file-input pick or loose-file
      // drop) — folder traversal and ZIP unpack already swallow non-
      // DICOM entries silently, and the input-count there is wildly
      // different from the discovered count (1 folder = 200 files).
      const parts = [];
      const isFlatBranch =
        kind === 'pick' ||
        (kind === 'drop' &&
          payload &&
          (!payload.items || !hasAnyDirectoryEntry(payload.items)) &&
          !Array.from(payload?.files || []).some((f) => /\.zip$/i.test(f.name)));
      if (isFlatBranch) {
        const inputCount =
          kind === 'drop' ? payload?.files?.length || 0 : payload?.length || 0;
        const skippedNonDicom = Math.max(0, inputCount - discovered.length);
        if (skippedNonDicom > 0) parts.push(`ข้าม non-DICOM ${skippedNonDicom} ไฟล์`);
      }
      const parseFailed = batch.length - metas.length;
      if (parseFailed > 0) parts.push(`อ่าน header ไม่สำเร็จ ${parseFailed} ไฟล์`);
      if (skippedHardCap > 0)
        parts.push(`เกิน batch cap ${MAX_BATCH_FILES} (ตัดทิ้ง ${skippedHardCap})`);
      if (parts.length > 0) setError(parts.join(' · '));

      setBulkProgress({
        phase: 'done',
        filesFound: metas.length,
        filesTotal: metas.length,
        currentSource:
          studies.length === 1
            ? `${studies.length} study · ${metas.length} images`
            : `${studies.length} studies · ${metas.length} images`,
      });

      // Auto-dismiss the progress panel after a short pause so the
      // user can see the final "done" count.
      setTimeout(() => {
        setBulkProgress((p) => (p && p.phase === 'done' ? null : p));
      }, 1100);

      abortRef.current = null;
    },
    [addToRecent, openInMode]
  );

  const cancelImport = useCallback(() => {
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* noop */ }
    }
    setBulkProgress(null);
    abortRef.current = null;
  }, []);

  const handleDrop = useCallback(
    (dataTransfer) => {
      runBulkImport('drop', dataTransfer);
    },
    [runBulkImport]
  );

  const handlePick = useCallback(
    (fileList) => {
      runBulkImport('pick', fileList);
    },
    [runBulkImport]
  );

  const handlePickFolder = useCallback(
    (fileList) => {
      runBulkImport('folder', fileList);
    },
    [runBulkImport]
  );

  const clearRecent = useCallback(() => {
    setRecent([]);
    try { localStorage.removeItem(RECENT_KEY); } catch { /* noop */ }
  }, []);

  const removeRecentAt = useCallback((idx) => {
    setRecent((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      try {
        if (next.length === 0) localStorage.removeItem(RECENT_KEY);
        else localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch { /* noop */ }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setFiles([]);
    setViewMode('single');
    setError(null);
  }, []);

  const removeFileAt = useCallback((idx) => {
    // Only valid in the LEGACY side-by-side (flat File[]) flow; in
    // side-by-side-stack mode panes are removed via the parent "back to
    // drop zone" button rather than per-pane ✕.
    setFiles((prev) => {
      if (viewMode === 'side-by-side-stack') return prev; // no-op
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 1) setViewMode('single');
      else if (next.length === 0) setViewMode('single');
      return next;
    });
  }, [viewMode]);

  // Phase 6 — derive the "anchor" file for header summaries / fallback
  // labels. In side-by-side-stack mode that's the first slice of the
  // left pane; for all other modes it's the first element of the flat
  // File[] (legacy behavior).
  const isSideBySideStack = viewMode === 'side-by-side-stack';
  const firstFile = isSideBySideStack
    ? (Array.isArray(files[0]) ? files[0][0] : undefined)
    : files[0];

  // ── VIEWER MODE ──
  //
  // AGENT-A Phase 5 / Phase 6 — four render branches:
  //   stack               → ONE pane, all files passed as `files={...}`,
  //                         Cornerstone3D StackViewport scrolls through all.
  //   side-by-side        → N panes, each rendering ONE file (legacy compare).
  //   side-by-side-stack  → TWO panes, each rendering ITS OWN stack of files,
  //                         scroll synchronized via STACK_NEW_IMAGE event +
  //                         proportional slice mapping. The Phase 6 addition.
  //   single              → ONE pane, one file (legacy single-image workflow).
  const hasContent = isSideBySideStack
    ? (Array.isArray(files) && files.length >= 2 && Array.isArray(files[0]) && files[0].length > 0)
    : files.length > 0;
  if (hasContent) {
    // Header label varies per mode. side-by-side-stack reports the total
    // slice counts of L vs R because that's the at-a-glance question:
    // "is the compare pair the same length?".
    let headerSummary;
    if (isSideBySideStack) {
      const lCount = files[0]?.length || 0;
      const rCount = files[1]?.length || 0;
      headerSummary = `Synced compare · L (${lCount} slices) vs R (${rCount} slices)`;
    } else if (viewMode === 'stack' && files.length > 1) {
      headerSummary = `Stack (${files.length} slices) · ${firstFile.name}…`;
    } else if (files.length === 1) {
      headerSummary = `${firstFile.name} — ${(firstFile.size / 1024).toFixed(0)} KB`;
    } else {
      headerSummary = `Study (${files.length} views): ${files.map(f => f.name).join(' + ')}`;
    }
    return (
      <div className="mx-auto max-w-7xl px-3 sm:px-5 py-4">
        <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
          <div className="text-sm text-[var(--color-text-muted)] font-mono">
            {headerSummary}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isSideBySideStack && (
              // AGENT-④ Phase 8 — single toggle opens a popover with one
              // checkbox per sync axis (slice / camera / W/L). Chose the
              // popover over three separate buttons in the chrome bar
              // because (a) chrome real estate is tight on tablets, (b)
              // the "sync" mental model is one concept with sub-options,
              // not three independent toggles. The button label reflects
              // the aggregate (ON if any axis on · OFF if all off).
              <div style={syncPopoverWrapStyle} ref={syncPopoverRef}>
                <button
                  onClick={() => setSyncPopoverOpen((v) => !v)}
                  className="vmx-btn vmx-btn-sm"
                  title={anySyncOn
                    ? `Sync settings — ${describeSyncAxes(compareSyncAxes)}. Click to change.`
                    : 'Sync OFF — panes are fully independent. Click to enable.'}
                  aria-pressed={anySyncOn}
                  aria-haspopup="menu"
                  aria-expanded={syncPopoverOpen}
                  style={anySyncOn ? syncToggleOnStyle : syncToggleOffStyle}
                >
                  {anySyncOn ? '🔗 Sync' : '⛓‍💥 Sync OFF'}
                  <span style={syncToggleCaretStyle} aria-hidden="true">▾</span>
                </button>
                {syncPopoverOpen && (
                  <div
                    role="menu"
                    aria-label="Compare-mode sync settings"
                    style={syncPopoverStyle}
                  >
                    <div style={syncPopoverHeaderStyle}>Sync between panes</div>
                    <SyncAxisRow
                      label="Slice"
                      hint="Scroll one stack → other follows (proportional)."
                      checked={compareSyncAxes.slice}
                      onToggle={() => toggleSyncAxis('slice')}
                    />
                    <SyncAxisRow
                      label="Camera"
                      hint="Pan, zoom & rotation mirror across panes."
                      checked={compareSyncAxes.camera}
                      onToggle={() => toggleSyncAxis('camera')}
                    />
                    <SyncAxisRow
                      label="W/L"
                      hint="Window/level (incl. presets) mirror. Off by default — useful when comparing different W/L per pane."
                      checked={compareSyncAxes.wl}
                      onToggle={() => toggleSyncAxis('wl')}
                      isNew
                    />
                  </div>
                )}
              </div>
            )}
            <button onClick={reset} className="vmx-btn vmx-btn-ghost vmx-btn-sm">← Back to drop zone</button>
          </div>
        </div>

        {isSideBySideStack ? (
          // Phase 6 — TWO independent DicomViewport instances, each in
          // its own stack mode, scrolling synced via window events.
          // syncGroupId='compare' isolates the channel from any legacy
          // 2-up that might be on the page (rare today, cheap to support).
          //
          // Each pane has paneLabel set so the slice indicator pill
          // reads "L: 42 / 36" instead of just "📚 Slice 42 / 36" —
          // visual disambiguation for the synced workflow.
          //
          // Mobile (<768px): grid collapses to one column so the panes
          // stack vertically. Side-by-side at 375 px would be unreadable.
          //
          // AGENT-④ Phase 8 — per-axis sync flags passed through. The
          // master `syncEnabled` gate short-circuits the listeners when
          // every axis is off (no listener registration cost when sync
          // is fully disabled).
          <div style={isNarrow ? compareGridMobileStyle : compareGridStyle}>
            {[0, 1].map((paneIdx) => {
              const paneFiles = files[paneIdx] || [];
              if (paneFiles.length === 0) return null;
              const label = paneIdx === 0 ? 'L' : 'R';
              const anchor = paneFiles[0];
              return (
                <ViewerPane
                  key={`compare-${paneIdx}-${anchor.name}-${anchor.size}-${paneFiles.length}`}
                  files={paneFiles}
                  mode="stack"
                  index={paneIdx}
                  canRemove={false}
                  syncEnabled={anySyncOn}
                  syncSlice={compareSyncAxes.slice}
                  syncCamera={compareSyncAxes.camera}
                  syncWL={compareSyncAxes.wl}
                  syncGroupId="compare"
                  paneLabel={label}
                />
              );
            })}
          </div>
        ) : viewMode === 'stack' ? (
          // Single pane that owns the full stack — DicomViewport calls
          // viewport.setStack(allImageIds) and binds StackScrollTool.
          <ViewerPane
            key={`stack-${firstFile.name}-${firstFile.size}-${files.length}`}
            files={files}
            mode="stack"
            index={0}
            canRemove={false}
          />
        ) : (
          // Side-by-side (2 panes) or single (1 pane) — one DicomViewport
          // per file. Preserves the legacy compare workflow.
          <div style={files.length >= 2 ? studyGridStyle : undefined}>
            {files.map((f, idx) => (
              <ViewerPane
                key={`${f.name}-${f.size}-${f.lastModified || 0}`}
                file={f}
                index={idx}
                canRemove={files.length > 1}
                onRemove={() => removeFileAt(idx)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── HOME / WORKSPACE ──
  //
  // 2026-05-20 hero redesign. The previous "the page IS the tool" layout
  // (compact title + giant empty dropzone + 2 mode cards) tested poorly:
  // the dropzone read as a placeholder rather than a product, the 4 pills
  // (DICOM/Norberg/VHS/Occlusion) looked like clickable CTAs but weren't,
  // and visitors had no preview of what the viewer actually does.
  //
  // New flow follows the OHIF.org landing pattern (see
  // sessions/2026-05-20 imaging redesign): three-noun hero + a stylised
  // preview of the viewer running a Norberg case on the right, with two
  // explicit CTAs (Sample case as primary, your-own-file as secondary
  // that scrolls down to the existing dropzone). The dropzone itself
  // moves below the hero where it makes sense as a follow-up action
  // rather than the headline.
  return (
    <>
    <div className="relative imaging-hero-bg">
      {/* Faint DICOM crosshair grid wash behind everything — kept as clinical signature on top of the new mesh gradient */}
      <CrosshairPattern className="z-0" opacity={0.028} />

      <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 pt-12 sm:pt-20 pb-10">
        {/* ──── HERO ──── */}
        <section className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-10 lg:gap-14 items-center mb-16 sm:mb-20">
          {/* Left: copy + CTAs */}
          <div>
            <p className="imaging-eyebrow mb-5">
              CUVETSMO Imaging Lab · for Y4–Y6 reading clinics
            </p>
            <h1 className="imaging-display text-[2.5rem] sm:text-5xl lg:text-[3.75rem] text-[var(--color-text)] mb-6">
              Radiographs,<br />
              <span
                style={{
                  background: 'linear-gradient(96deg, #5ACCE6 0%, #A78BFA 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >un-blackboxed.</span>
            </h1>
            <p className="text-[15px] sm:text-base text-[var(--color-text-muted)] leading-relaxed mb-8 max-w-[28rem]">
              เปิดภาพ DICOM ของหมา-แมวใน browser · Norberg + VHS วาดเอง วัดเอง · ไม่ขึ้น server, ไม่ต้อง login.
              <br />
              <span className="text-[var(--color-text-faint)]">A diagnostic-reading tool designed for learners, not for hospital dashboards.</span>
            </p>

            <div className="flex flex-wrap gap-3">
              <Link href="/cases" data-tour="sample-case-cta" className="imaging-btn imaging-btn-primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                เปิด sample case
              </Link>
              <a
                href="#dropzone"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById('dropzone')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="imaging-btn imaging-btn-ghost"
              >
                หรือลากไฟล์ DICOM
                <span aria-hidden style={{ display: 'inline-block', transform: 'translateY(1px)' }}>↓</span>
              </a>
            </div>

            {/* Capability strip — animated breathing dots */}
            <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2.5 text-[12px] text-[var(--color-text-muted)] font-mono">
              <li className="flex items-center gap-2"><span aria-hidden className="imaging-cap-dot" /> Norberg angle</li>
              <li className="flex items-center gap-2"><span aria-hidden className="imaging-cap-dot" /> VHS · vertebral heart score</li>
              <li className="flex items-center gap-2"><span aria-hidden className="imaging-cap-dot" /> Image occlusion editor</li>
              <li className="flex items-center gap-2"><span aria-hidden className="imaging-cap-dot finalized" /> ไม่ขึ้น server</li>
            </ul>
          </div>

          {/* Right: stylised viewer preview · static SVG, not a live viewer.
              Mimics the chrome of the real DicomViewport (toolbar, viewport
              frame, measurement readout) with a canine pelvis sketch + Norberg
              angle overlay drawn in. Labelled as "Sample · Illustrative" so
              we never imply this is a real diagnostic radiograph. */}
          <ViewerPreview />
        </section>

        {/* ──── DROPZONE ────
            Phase 4 swap: the inline <label> is replaced by <BulkDropzone />.
            The new component accepts loose files, folders (webkitdirectory),
            and ZIP archives, with no hard cap on file count (capped by
            MAX_BATCH_FILES = 5000 in lib/dicom/bulk-import.ts, applied in
            runBulkImport above). Side-by-side viewer pane still caps at
            MAX_FILES=2 inside the viewer branch above. */}
        <section id="dropzone" className="mb-12 scroll-mt-20">
          <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] flex items-center gap-2">
              <span className="text-[var(--color-tool-violet)]">02 /</span> Free Mode — ลาก DICOM, โฟลเดอร์, หรือ ZIP
            </h2>
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--color-text-faint)]">
              Educational tool · not for clinical decisions
            </span>
          </div>

          <BulkDropzone
            onDrop={handleDrop}
            onPick={handlePick}
            onPickFolder={handlePickFolder}
            busy={!!bulkProgress && bulkProgress.phase !== 'done'}
          />

          {error && (
            <p className="text-[var(--color-active-red)] text-sm text-center mt-4 font-mono">{error}</p>
          )}

          {/* RecentImports (Agent 🅳) — IndexedDB-backed history of past
              imports. Mounts <StudyTree> (Agent 🅲) internally for the
              persisted view, so this is the single Study tree on the
              home page. Since our pipeline now calls saveBatch() on
              every successful import + dispatches cuvi:imports-changed,
              the current session's imports show up here without a
              separate "session-only" tree. `key={importBatchKey}` would
              force a remount on every batch which fights its internal
              hydration state — we let the custom event drive refresh
              instead. */}
          <div className="mt-6">
            <Suspense fallback={null}>
              <RecentImports
                onOpenInstance={(meta) => {
                  // meta is a DicomFileMeta — `.fileHandle` is the
                  // reconstructed File (or live File for this session).
                  // ViewerPane reads .name + .size + .lastModified off
                  // a File, so unwrap before handing it over.
                  const f = meta?.fileHandle;
                  if (f) openInMode([f], 'single');
                }}
                onOpenStudy={(study) => {
                  // AGENT-A Phase 5 — auto-mode-select based on instance
                  // count of the LARGEST series. If a single series has
                  // >2 instances → stack mode (load all into one viewport
                  // and scroll). If the study has two single-instance
                  // series → side-by-side compare (legacy). Otherwise
                  // single-pane view of the first instance.
                  //
                  // Phase 6 (Agent ⓐ) — BEFORE the legacy routing, check
                  // for the synced-compare candidate (exactly two series
                  // of similar length, each ≥3 instances). If so we route
                  // to side-by-side-stack and skip the legacy fallback.
                  // detectSyncCompareCandidate uses a 30% slice-count
                  // tolerance so pre/post-contrast pairs (e.g. 36 vs 40
                  // slices) qualify.
                  if (!study?.series || study.series.length === 0) return;
                  const pair = detectSyncCompareCandidate(study);
                  if (pair) {
                    const leftFiles = (pair.leftSeries.instances || [])
                      .map((m) => m?.fileHandle)
                      .filter(Boolean);
                    const rightFiles = (pair.rightSeries.instances || [])
                      .map((m) => m?.fileHandle)
                      .filter(Boolean);
                    if (leftFiles.length > 0 && rightFiles.length > 0) {
                      openInMode([leftFiles, rightFiles], 'side-by-side-stack');
                      return;
                    }
                    // Fall through to legacy path if file handles missing.
                  }
                  // Legacy Phase 5 routing — pick longest series for stack.
                  //
                  // Why "largest series" not "total instances": a study
                  // with [series A: 200 slices, series B: 1 slice] should
                  // stack-mode series A (the volume), not flatten both
                  // into 201 mixed slices. We pick the longest series as
                  // the representative — series B can be opened via the
                  // per-instance row.
                  const seriesList = study.series;
                  let longestSeries = seriesList[0];
                  for (const s of seriesList) {
                    if ((s.instances?.length || 0) > (longestSeries.instances?.length || 0)) {
                      longestSeries = s;
                    }
                  }
                  const stackFiles = (longestSeries.instances || [])
                    .map((m) => m?.fileHandle)
                    .filter(Boolean);
                  if (stackFiles.length === 0) return;
                  if (stackFiles.length > 2) {
                    openInMode(stackFiles, 'stack');
                  } else if (stackFiles.length === 2) {
                    openInMode(stackFiles, 'side-by-side');
                  } else {
                    openInMode(stackFiles, 'single');
                  }
                }}
              />
            </Suspense>
          </div>
        </section>

        {/* ──── TOOL TILES ────
            Custom SVG illustrations for each lab feature. Each tile lifts +1px
            on hover, reveals a cyan gradient ring, and the illustration color
            shifts to brand cyan. Replaces the old generic icon+text card. */}
        <section className="mb-6">
          <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] mb-4 flex items-center gap-2">
            <span className="text-[var(--color-tool-violet)]">03 /</span> Other modes
          </h2>
          <div data-tour="tool-tiles" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ToolTile
              href="/cases"
              title="Case Library"
              desc="Curated CC-BY radiographs across X-ray, CT, MR, US"
              meta="16 cases, grows weekly"
              art={
                /* Real Pollinations-generated canine skeleton lateral · cropped to fit tile */
                <div className="relative w-[110px] h-[68px] rounded-md overflow-hidden bg-black ring-1 ring-[var(--color-border-bright)]">
                  <Image
                    src="/illustrations/tile-cases.jpg"
                    alt=""
                    fill
                    sizes="110px"
                    className="object-cover"
                  />
                </div>
              }
            />
            <ToolTile
              href="/occlusion"
              title="Image Occlusion"
              desc="Anki-style masks · cover-the-anatomy active recall"
              meta="works on PNG + DICOM"
              art={
                /* Real radiograph base + SVG occlusion masks overlaid · shows the tool's actual behavior */
                <div className="relative w-[110px] h-[68px] rounded-md overflow-hidden bg-black ring-1 ring-[var(--color-border-bright)]">
                  <Image
                    src="/illustrations/tile-occlusion.jpg"
                    alt=""
                    fill
                    sizes="110px"
                    className="object-cover"
                  />
                  {/* Cyan occlusion masks overlaid · shows the tool action */}
                  <svg
                    className="absolute inset-0 w-full h-full"
                    viewBox="0 0 110 68"
                    aria-hidden="true"
                  >
                    <rect x="22" y="20" width="30" height="14" rx="2" fill="#5ACCE6" opacity="0.88" />
                    <rect x="60" y="34" width="28" height="14" rx="2" fill="#5ACCE6" opacity="0.88" />
                    <circle cx="37" cy="27" r="1" fill="#000" opacity="0.4" />
                    <circle cx="74" cy="41" r="1" fill="#000" opacity="0.4" />
                  </svg>
                </div>
              }
            />
          </div>
        </section>

        {recent.length > 0 && (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm">
            <div className="flex items-center justify-between mb-2">
              <strong className="text-[var(--color-text)] text-xs uppercase tracking-wider">Recent files</strong>
              <button
                onClick={clearRecent}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-tool-cyan)] underline"
              >
                ล้าง
              </button>
            </div>
            <div className="text-xs text-[var(--color-text-muted)] mb-2">
              File blobs ไม่ persist ข้าม session — เห็นรายการที่นี่แล้วลากไฟล์เดิมจาก disk เพื่อ re-open
            </div>
            <ul className="divide-y divide-[var(--color-border)]">
              {recent.map((r, i) => (
                <li key={i} className="py-2 flex items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]">
                  <span className="truncate flex-1 font-mono">
                    <span className="text-[var(--color-text)]">{r.name}</span>
                    {' '}— {(r.size / 1024).toFixed(0)} KB,{' '}
                    {new Date(r.lastModified).toLocaleString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </span>
                  <button
                    onClick={() => removeRecentAt(i)}
                    aria-label="ลบไฟล์นี้จากประวัติ"
                    className="w-5 h-5 text-[var(--color-text-muted)] hover:text-[var(--color-active-red)]"
                  >×</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Quiet footnote, replaces the old centered hero subhead */}
        <p className="mt-8 text-[11px] text-[var(--color-text-muted)] text-center">
          New here?{' '}
          <button
            type="button"
            onClick={openTour}
            className="text-[var(--color-tool-cyan)] hover:underline"
          >
            ทบทวน tour ↻
          </button>
          {' · '}
          <Link href="/about" className="text-[var(--color-tool-cyan)] hover:underline">Read what this lab does ↗</Link>
        </p>
      </div>
    </div>

    {/* 3-step onboarding tour — auto-launches on first visit, manually
        re-triggerable via the help button or the "ทบทวน tour" footer link. */}
    <OnboardingTour open={tourOpen} onClose={closeTour} />
    <HelpButton onOpen={openTour} hidden={tourOpen} />

    {/* Bulk import progress — fixed-position, shown while a folder /
        zip / multi-file batch is being discovered + parsed. ESC cancels.
        Auto-dismisses 1.1s after reaching `done`. */}
    <BulkProgressPanel progress={bulkProgress} onCancel={cancelImport} />
    </>
  );
}

/**
 * ViewerPreview — static SVG mockup of the DICOM viewer shown in the hero.
 *
 * Drawing a stylised canine pelvis with the Norberg angle overlay already
 * applied. NOT a real radiograph — labelled "Sample · Illustrative" so
 * visitors don't mistake it for a diagnostic image. We avoid using a real
 * patient X-ray here because licensing CC-BY vet radiographs takes effort
 * and the stylised version reads cleanly as "this is what the tool does".
 *
 * The chrome (toolbar row + viewport frame + measurement readout) mimics
 * the real DicomViewport so visitors recognise the workspace they'll get
 * after they click "Open sample case" / drop a file.
 */
function ViewerPreview() {
  return (
    <div
      className="relative rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] shadow-xl overflow-hidden"
      role="img"
      aria-label="Preview of the DICOM viewer showing a canine pelvis with Norberg angle overlay drawn — illustrative, not a real radiograph"
    >
      {/* Toolbar row */}
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-surface-2)] border-b border-[var(--color-border)] text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-finalized)]" aria-hidden />
          <span className="font-mono">cu-001 · canine pelvis · VD</span>
        </div>
        <div className="flex items-center gap-3 font-mono">
          <span>W/L</span>
          <span>Pan</span>
          <span className="text-[var(--color-tool-cyan)]">∠ Norberg</span>
          <span>↕ Stack</span>
        </div>
      </div>

      {/* Viewport · real radiograph image + measurement overlay drawn on top.
          The image is an AI-generated stylised canine lateral (Pollinations.ai
          Flux seed=11) showing dog body w/ ribcage + spine + pelvis visible.
          Not a true diagnostic radiograph — "Sample · Illustrative" badge
          makes this explicit. Overlay coordinates tuned to the visible pelvis
          area (lower-left) of the lateral image; easy to nudge if the source
          image is swapped later. */}
      <div className="relative aspect-[5/4] bg-[var(--color-surface-3)]">
        {/* Base radiograph image */}
        <Image
          src="/illustrations/hero-pelvis.jpg"
          alt=""
          fill
          sizes="(min-width: 1024px) 480px, 100vw"
          className="object-cover"
          priority
        />

        {/* Measurement overlay SVG — drawn on top using viewBox 500x400 so
            coordinates can be tuned by eye against the image. */}
        <svg
          viewBox="0 0 500 400"
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 w-full h-full pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Subtle dark vignette so the metadata text reads on busy areas */}
          <defs>
            <radialGradient id="overlay-vignette" cx="50%" cy="50%" r="80%">
              <stop offset="55%" stopColor="rgba(0,0,0,0)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0.6)" />
            </radialGradient>
          </defs>
          <rect width="500" height="400" fill="url(#overlay-vignette)" />

          {/* Norberg overlay — femoral heads + acetabular rims positioned
              over the visible pelvis area in the lower-left of the image.
              Not anatomically rigorous (the image is lateral, Norberg needs
              VD); kept as a stylised "this is what the tool does" demo. */}
          {/* Cyan baseline · femoral head to femoral head */}
          <line x1="105" y1="245" x2="170" y2="245" stroke="#5ACCE6" strokeWidth="2" />
          {/* Angle lines · femoral head → acetabular rim */}
          <line x1="105" y1="245" x2="88" y2="220" stroke="#5ACCE6" strokeWidth="2" />
          <line x1="170" y1="245" x2="187" y2="220" stroke="#5ACCE6" strokeWidth="2" />
          {/* Acetabular rim dots */}
          <circle cx="88" cy="220" r="3.5" fill="#5ACCE6" />
          <circle cx="187" cy="220" r="3.5" fill="#5ACCE6" />
          {/* Femoral head center dots */}
          <circle cx="105" cy="245" r="3.5" fill="#5ACCE6" />
          <circle cx="170" cy="245" r="3.5" fill="#5ACCE6" />
          {/* Angle arcs */}
          <path d="M 120 233 A 14 14 0 0 0 117 244" fill="none" stroke="#5ACCE6" strokeWidth="1.5" />
          <path d="M 155 233 A 14 14 0 0 1 158 244" fill="none" stroke="#5ACCE6" strokeWidth="1.5" />

          {/* Numeric readouts — floated above the angle area, drop-shadow for contrast */}
          <g fontFamily="ui-monospace, monospace" fontWeight="600">
            <text x="35" y="208" fontSize="12" fill="#5ACCE6">L: 108°</text>
            <text x="200" y="208" fontSize="12" fill="#5ACCE6">R: 105°</text>
          </g>

          {/* Top-left DICOM metadata · monospace, kept on dark area */}
          <g fontFamily="ui-monospace, monospace" fontSize="9" fill="#D4D4D8">
            <text x="12" y="22">MRN: 12345678</text>
            <text x="12" y="36">Modality: DX</text>
            <text x="12" y="50">Acquired: 2026-05-20</text>
          </g>
          <g fontFamily="ui-monospace, monospace" fontSize="9" fill="#D4D4D8" textAnchor="end">
            <text x="488" y="22">WW: 4096</text>
            <text x="488" y="36">WL: 2048</text>
            <text x="488" y="50">Px: 0.142mm</text>
          </g>

          {/* Bottom-right scale ruler — gives visual sense of measurement */}
          <g stroke="#D4D4D8" strokeWidth="1" opacity="0.75">
            <line x1="370" y1="380" x2="470" y2="380" />
            <line x1="370" y1="376" x2="370" y2="384" />
            <line x1="395" y1="378" x2="395" y2="382" />
            <line x1="420" y1="376" x2="420" y2="384" />
            <line x1="445" y1="378" x2="445" y2="382" />
            <line x1="470" y1="376" x2="470" y2="384" />
          </g>
          <text x="420" y="395" textAnchor="middle" fontSize="9" fontFamily="ui-monospace, monospace" fill="#D4D4D8">10 mm</text>
        </svg>

        {/* Floating "Sample · Illustrative" badge — makes it explicit the image
            is AI-generated, not a real diagnostic radiograph. */}
        <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded bg-[rgba(0,0,0,0.7)] backdrop-blur-sm px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] border border-[var(--color-border-bright)]">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-tool-cyan)]" aria-hidden />
          Sample · Illustrative
        </div>
      </div>

      {/* Footer · measurement readout strip · mirrors the real viewer chrome */}
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-surface-2)] border-t border-[var(--color-border)] text-[10px] font-mono text-[var(--color-text-muted)]">
        <span>∠ Norberg · L 108° / R 105°</span>
        <span className="text-[var(--color-tool-cyan)]">Open sample case →</span>
      </div>
    </div>
  );
}

/**
 * ToolTile — tactile feature tile with custom SVG illustration on the right.
 *
 * Hover behavior comes from the .imaging-tool-tile CSS class:
 *   - Lifts 2px
 *   - Cyan gradient ring reveals around border
 *   - art color shifts from text-muted → tool-cyan
 *   - arrow shifts 3px right + colors to cyan
 *
 * The `art` slot receives an inline SVG that uses `currentColor` so the tile
 * can control the line color via the .imaging-tile-art class.
 */
function ToolTile({ href, title, desc, meta, art }) {
  return (
    <Link href={href} className="imaging-tool-tile group">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-semibold text-[var(--color-text)] tracking-tight text-[15px]">{title}</span>
          {meta && (
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)]">
              {meta}
            </span>
          )}
        </div>
        <div className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">{desc}</div>
      </div>
      <div className="imaging-tile-art self-center">
        {art}
      </div>
      <svg
        width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="1.75"
        strokeLinecap="round" strokeLinejoin="round"
        className="imaging-tile-arrow"
        aria-hidden="true"
      >
        <path d="M5 12h14M13 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

// AGENT-④ Phase 8 — single row in the sync-settings popover. Renders
// label + hint + checkbox in a clickable card. `isNew` adds a subtle
// "NEW" pill so users notice the W/L sync option on first open after
// the Phase 8 ship. Checkbox is a styled <button> with aria-pressed
// (not a native <input type="checkbox">) so the touch target is the
// full row + we control the visual without resetting native styles.
function SyncAxisRow({ label, hint, checked, onToggle, isNew = false }) {
  return (
    <button
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onToggle}
      style={{
        ...syncAxisRowStyle,
        background: checked ? 'rgba(6,182,212,0.08)' : 'transparent',
        borderColor: checked ? 'rgba(6,182,212,0.35)' : 'transparent',
      }}
    >
      <div style={syncAxisRowMainStyle}>
        <div style={syncAxisRowLabelStyle}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {label}
            {isNew && <span style={syncAxisNewPillStyle}>NEW</span>}
          </span>
          <span
            aria-hidden="true"
            style={{
              ...syncAxisCheckStyle,
              background: checked ? 'rgba(6,182,212,0.95)' : 'transparent',
              borderColor: checked ? 'rgba(6,182,212,0.95)' : 'var(--color-border)',
              color: checked ? '#fff' : 'transparent',
            }}
          >
            ✓
          </span>
        </div>
        <div style={syncAxisRowHintStyle}>{hint}</div>
      </div>
    </button>
  );
}

// Single viewer pane wrapper — file label + DicomViewport + Tag panel.
//
// Accepts EITHER `file: File` (legacy single-image / side-by-side workflow)
// OR `files: File[]` + `mode: 'stack'` (Phase 5 stack-scroll workflow).
// The primary file (`primary`) is used for the header label + Tag inspector
// (Tag inspector still views a single instance's DICOM tags — when scrolling
// a stack the user would want to know "what tags does slice N have" which
// is a future enhancement, not Phase 5 scope).
//
// Phase 6 — accepts syncEnabled + syncGroupId + paneLabel for the
// side-by-side-stack workflow. paneLabel ('L'/'R') is also surfaced in
// the pane header so the user can disambiguate before even looking at
// the canvas. Defaults preserve Phase 5 behavior for non-compare callers.
function ViewerPane({
  file,
  files,
  mode,
  index,
  canRemove,
  onRemove,
  syncEnabled = false,
  // AGENT-④ Phase 8 — per-axis sync flags. Defaults preserve Phase 6
  // behavior (slice + camera ON, W/L OFF) for any caller that hasn't
  // been updated to thread the new props.
  syncSlice = true,
  syncCamera = true,
  syncWL = false,
  syncGroupId = 'default',
  paneLabel = null,
}) {
  const [showTags, setShowTags] = useState(false);
  const isStackPane = mode === 'stack' && Array.isArray(files) && files.length > 1;
  const primary = isStackPane ? files[0] : file;
  const headerLabel = paneLabel
    ? `Pane ${paneLabel}`
    : isStackPane
      ? 'Stack'
      : `View ${index + 1}`;
  return (
    <div style={paneStyle}>
      <div style={paneHeaderStyle}>
        <span>
          <strong>{headerLabel}:</strong>{' '}
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
            {primary?.name}
            {isStackPane && (
              <> · {files.length} slices</>
            )}
          </span>
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={() => setShowTags((s) => !s)}
            className="vmx-btn vmx-btn-ghost vmx-btn-sm"
            title="ดู DICOM tags ทั้งหมด"
          >
            Info
          </button>
          {canRemove && (
            <button
              onClick={onRemove}
              aria-label="Remove this view"
              style={removePaneBtnStyle}
              title="ปิด view นี้"
            >✕</button>
          )}
        </div>
      </div>
      <Suspense fallback={<div style={loadingFallbackStyle}>กำลังโหลด viewer...</div>}>
        {isStackPane ? (
          <DicomViewport
            files={files}
            mode="stack"
            caseId={null}
            syncEnabled={syncEnabled}
            syncSlice={syncSlice}
            syncCamera={syncCamera}
            syncWL={syncWL}
            syncGroupId={syncGroupId}
            paneLabel={paneLabel}
          />
        ) : (
          <DicomViewport
            file={primary}
            caseId={null}
            syncEnabled={syncEnabled}
            syncSlice={syncSlice}
            syncCamera={syncCamera}
            syncWL={syncWL}
            syncGroupId={syncGroupId}
            paneLabel={paneLabel}
          />
        )}
      </Suspense>
      {showTags && (
        <Suspense fallback={null}>
          <TagInspector file={primary} onClose={() => setShowTags(false)} />
        </Suspense>
      )}
    </div>
  );
}

const studyGridStyle = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12,
};
// Phase 6 — Synced-compare grid. Two equal columns at ≥768px so the
// L/R panes share the available width. The viewport canvas itself uses
// `clamp(380px, calc(100vh - 260px), 900px)` for height, so the panes
// stay readable on tall + short displays.
const compareGridStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 10,
};
// Mobile (<768px) — vertical stack instead of horizontal split. A 375 px
// viewport split in half = 180 px wide per pane, which is unusable for
// reading. Phone users get one pane on top of the other; sync still works
// (and arguably reads better when one finger drives both).
const compareGridMobileStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: 10,
};
// Toolbar Sync ON/OFF toggle. ON state uses the brand cyan ring (matches
// the W/L preset active style elsewhere); OFF is a quiet bordered button.
const syncToggleOnStyle = {
  minHeight: 32,
  padding: '5px 12px',
  background: 'rgba(6,182,212,0.10)',
  color: '#0e7490',
  border: '1px solid rgba(6,182,212,0.45)',
  borderRadius: 4,
  fontSize: '0.78rem',
  fontWeight: 600,
  letterSpacing: 0.2,
  cursor: 'pointer',
  boxShadow: '0 0 0 2px rgba(6,182,212,0.25)',
};
const syncToggleOffStyle = {
  minHeight: 32,
  padding: '5px 12px',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  fontSize: '0.78rem',
  fontWeight: 500,
  cursor: 'pointer',
};
// AGENT-④ Phase 8 — sync settings popover styles. The wrap is
// position:relative so the absolute popover anchors to the button. We
// don't use a portal because the popover is small + sits below the
// header (no overflow:hidden parents in the chrome area).
const syncPopoverWrapStyle = {
  position: 'relative',
  display: 'inline-flex',
};
const syncToggleCaretStyle = {
  marginLeft: 6,
  fontSize: '0.7rem',
  opacity: 0.7,
};
const syncPopoverStyle = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  zIndex: 30,
  minWidth: 280,
  maxWidth: 'min(360px, 90vw)',
  background: 'var(--color-surface-2, #1a1d24)',
  border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
  borderRadius: 6,
  padding: 6,
  boxShadow: '0 8px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(6,182,212,0.08)',
  fontSize: '0.8rem',
  color: 'var(--color-text-primary, #e5e7eb)',
};
const syncPopoverHeaderStyle = {
  padding: '6px 10px 8px',
  fontSize: '0.7rem',
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  fontWeight: 600,
};
const syncAxisRowStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '8px 10px',
  margin: '2px 0',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 5,
  cursor: 'pointer',
  color: 'inherit',
  font: 'inherit',
};
const syncAxisRowMainStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};
const syncAxisRowLabelStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontWeight: 600,
  fontSize: '0.85rem',
};
const syncAxisRowHintStyle = {
  fontSize: '0.72rem',
  lineHeight: 1.35,
  color: 'var(--color-text-muted)',
};
const syncAxisCheckStyle = {
  width: 18,
  height: 18,
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.7rem',
  fontWeight: 700,
  transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
};
const syncAxisNewPillStyle = {
  fontSize: '0.6rem',
  fontWeight: 700,
  letterSpacing: 0.6,
  padding: '1px 6px',
  borderRadius: 999,
  background: 'rgba(6,182,212,0.18)',
  color: '#0891b2',
  border: '1px solid rgba(6,182,212,0.4)',
};
const paneStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: 'var(--color-surface-2)',
  padding: 8,
};
const paneHeaderStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: 8, padding: '4px 6px', fontSize: '0.85rem', color: 'var(--color-text-muted)',
  flexWrap: 'wrap', gap: 6,
};
const removePaneBtnStyle = {
  width: 24, height: 24, borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface-2)',
  cursor: 'pointer', color: 'var(--color-text-muted)',
  fontSize: '0.85rem', lineHeight: 1, padding: 0,
};
const loadingFallbackStyle = {
  padding: 40, textAlign: 'center', color: 'var(--color-text-muted)',
};
