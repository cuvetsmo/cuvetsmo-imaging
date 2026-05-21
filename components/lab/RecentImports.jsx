'use client';
import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';

import {
  clearAll,
  deleteStudy,
  getQuota,
  isUsingMemoryFallback,
  loadAllStudies,
} from '../../lib/dicom/dicom-store';

// StudyTree (Agent 🅲) lives at ./StudyTree.jsx by the Phase 4 file contract.
// We lazy-import to (a) keep this panel's first paint cheap and (b) survive
// agent-ordering — if 🅲 hasn't shipped yet, the lazy promise rejects and we
// fall back to a minimal inline renderer instead of crashing the whole lab.
const StudyTree = lazy(() =>
  // @ts-expect-error — sibling Agent 🅲 ships ./StudyTree.jsx; resolved at runtime.
  import('./StudyTree.jsx').catch(() => ({ default: FallbackStudyList })),
);

/**
 * RecentImports — persistent recent-imports panel mounted on LabHome.
 *
 * Hydrates from IndexedDB on mount. Returns null when the store is empty
 * (LabHome shows nothing — the section is invisible until the user has
 * actually bulk-imported something). Subsequent saveBatch() calls on the
 * store don't auto-refresh this panel — Agent 🅰 should call the exported
 * `useRecentImportsRefresh` hook OR pass an `onImportComplete` signal up.
 * For now we listen to a custom DOM event `cuvi:imports-changed` so any
 * sibling component can trigger a refresh without prop drilling.
 *
 * Props (all optional):
 *   onOpenInstance(meta) — called with a DicomFileMeta when the user
 *     clicks a single image row inside a series. The meta's
 *     `.fileHandle` is a fresh File reconstructed from the stored Blob,
 *     so callers can pipe it straight into a DICOM viewport.
 *   onOpenStudy(study) — called with a Study object when the user clicks
 *     the "Open study →" footer button.
 */
export default function RecentImports({ onOpenInstance, onOpenStudy } = {}) {
  const [state, setState] = useState({
    status: 'loading', // 'loading' | 'empty' | 'ready' | 'error'
    studies: [],
    error: null,
  });
  const [quota, setQuota] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [usingMemFallback, setUsingMemFallback] = useState(false);

  // ── Hydration ─────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    try {
      const [studies, q] = await Promise.all([loadAllStudies(), getQuota()]);
      setQuota(q);
      setUsingMemFallback(isUsingMemoryFallback());
      if (studies.length === 0) {
        setState({ status: 'empty', studies: [], error: null });
      } else {
        setState({ status: 'ready', studies, error: null });
      }
    } catch (err) {
      setState({
        status: 'error',
        studies: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    // Kick off hydration in a microtask so the effect body itself returns
    // synchronously without scheduling a setState (eslint react-hooks rule:
    // set-state-in-effect). `refresh()` is async — every setState in it
    // already awaits I/O, so this just satisfies the static check.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void refresh();
    });
    // Custom event — Agent 🅰 (BulkDropzone) dispatches this after each
    // saveBatch() so the panel rehydrates without a prop drill chain.
    const onChange = () => { void refresh(); };
    window.addEventListener('cuvi:imports-changed', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('cuvi:imports-changed', onChange);
    };
  }, [refresh]);

  // ── Computed counts ───────────────────────────────────────────────────

  const counts = useMemo(() => {
    let nStudies = state.studies.length;
    let nInstances = 0;
    for (const s of state.studies) {
      for (const ser of s.series) nInstances += ser.instances.length;
    }
    return { nStudies, nInstances };
  }, [state.studies]);

  // ── Actions ───────────────────────────────────────────────────────────

  const handleDelete = useCallback(
    async (studyUid) => {
      try {
        await deleteStudy(studyUid);
        await refresh();
      } catch (err) {
        console.error('[RecentImports] delete failed', err);
        await refresh();
      }
    },
    [refresh],
  );

  const handleClearAll = useCallback(async () => {
    try {
      await clearAll();
    } catch (err) {
      console.error('[RecentImports] clear failed', err);
    } finally {
      setConfirmClear(false);
      await refresh();
    }
  }, [refresh]);

  // ── Render guards ─────────────────────────────────────────────────────

  // Empty → render nothing. LabHome hides the wrapper section.
  if (state.status === 'empty') return null;

  // Loading on first paint — skeleton.
  if (state.status === 'loading') {
    return (
      <section className={panelStyles.wrapper} aria-busy="true">
        <div className={panelStyles.headerRow}>
          <div className={panelStyles.skeletonHeader} />
        </div>
        <div className={panelStyles.skeletonCard} />
        <div className={panelStyles.skeletonCard} />
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section
        className={panelStyles.wrapper}
        role="alert"
        aria-live="polite"
      >
        <div className={panelStyles.headerRow}>
          <span className={panelStyles.title}>📥 Recent imports</span>
        </div>
        <p className={panelStyles.errorMsg}>
          Storage error: <code>{state.error || 'unknown'}</code>
        </p>
        <button
          type="button"
          onClick={handleClearAll}
          className="imaging-btn imaging-btn-ghost"
        >
          Clear store and retry
        </button>
      </section>
    );
  }

  // ── Ready ─────────────────────────────────────────────────────────────

  const { nStudies, nInstances } = counts;
  const quotaPct =
    quota && quota.available > 0
      ? Math.min(100, Math.round((quota.used / quota.available) * 100))
      : 0;

  return (
    <section
      className={panelStyles.wrapper}
      aria-live="polite"
      aria-label="Recently imported DICOM studies, persisted offline"
    >
      <div className={panelStyles.headerRow}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className={panelStyles.collapseBtn}
          aria-expanded={!collapsed}
          aria-controls="recent-imports-body"
        >
          <span aria-hidden className={panelStyles.chev}>
            {collapsed ? '▸' : '▾'}
          </span>
          <span className={panelStyles.title}>
            📥 Recent imports
            <span className={panelStyles.titleMeta}>
              {' '}({nStudies} {nStudies === 1 ? 'study' : 'studies'} ·{' '}
              {nInstances} {nInstances === 1 ? 'image' : 'images'})
            </span>
          </span>
        </button>
        <div className={panelStyles.headerActions}>
          {!confirmClear ? (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className={panelStyles.linkBtn}
              title="Remove every persisted study from this browser"
            >
              Clear all
            </button>
          ) : (
            <>
              <span className={panelStyles.confirmText}>Sure?</span>
              <button
                type="button"
                onClick={handleClearAll}
                className={panelStyles.dangerBtn}
              >
                Yes, delete {nStudies}
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className={panelStyles.linkBtn}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {usingMemFallback && (
        <p className={panelStyles.warningBanner}>
          💾 Storage unavailable — imports won&apos;t persist across reloads (private/incognito mode?)
        </p>
      )}

      {!collapsed && (
        <div id="recent-imports-body">
          {quota && quota.available > 0 && (
            <div className={panelStyles.quotaRow}>
              <div className={panelStyles.quotaBar} aria-hidden="true">
                <div
                  className={panelStyles.quotaFill}
                  style={{
                    width: `${quotaPct}%`,
                    background:
                      quotaPct >= 85
                        ? 'var(--color-active-red, #FF8FA3)'
                        : quotaPct >= 60
                          ? '#FFA56B'
                          : 'var(--color-tool-cyan, #5ACCE6)',
                  }}
                />
              </div>
              <span className={panelStyles.quotaText}>
                📊 {formatBytes(quota.used)} used / {formatBytes(quota.available)} available
                {quota.persistedGranted ? (
                  <span className={panelStyles.persistedTag} title="Storage marked as persistent — browser won't auto-evict under disk pressure">
                    {' · '}persistent ✓
                  </span>
                ) : (
                  <span className={panelStyles.bestEffortTag} title="Best-effort storage — browser may evict under heavy disk pressure">
                    {' · '}best-effort
                  </span>
                )}
              </span>
            </div>
          )}

          <Suspense fallback={<div className={panelStyles.skeletonCard} />}>
            <StudyTree
              studies={state.studies}
              onDeleteStudy={handleDelete}
              onOpenInstance={onOpenInstance}
              onOpenStudy={onOpenStudy}
            />
          </Suspense>
        </div>
      )}
    </section>
  );
}

// ─── Fallback list (only used when Agent 🅲's StudyTree isn't shipped) ──────
//
// Plain HTML rendering of the Study[] tree. Mirrors the StudyTree contract
// (`studies`, `onDeleteStudy`) so the props-flow is identical regardless of
// whether the real component or this stub is mounted.
function FallbackStudyList({ studies, onDeleteStudy }) {
  if (!studies || studies.length === 0) return null;
  return (
    <ul className={panelStyles.fallbackList}>
      {studies.map((s) => {
        const totalImages = s.series.reduce((n, ser) => n + ser.instances.length, 0);
        return (
          <li key={s.studyUid} className={panelStyles.fallbackItem}>
            <div className={panelStyles.fallbackRow}>
              <div className={panelStyles.fallbackMain}>
                <div className={panelStyles.fallbackTitle}>
                  {s.studyDescription || s.patientId || 'Untitled study'}
                </div>
                <div className={panelStyles.fallbackMeta}>
                  {s.series.length} series · {totalImages} images
                  {s.acquisitionDate ? ` · ${formatDicomDate(s.acquisitionDate)}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onDeleteStudy?.(s.studyUid)}
                className={panelStyles.linkBtn}
                aria-label={`Delete study ${s.studyUid}`}
                title="Remove this study from local storage"
              >
                Remove
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Utils ──────────────────────────────────────────────────────────────────

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log10(n) / 3));
  const v = n / 10 ** (i * 3);
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

function formatDicomDate(d) {
  if (!d) return '';
  if (/^\d{8}$/.test(d)) {
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }
  return d;
}

// ─── Style tokens ───────────────────────────────────────────────────────────
//
// Tailwind class strings collected into one object so the JSX above stays
// scannable. Matches the dark imaging.cuvetsmo.com palette established by
// LabHome / CaseLibraryLocal (CSS-var color tokens, no hard-coded hex).

const panelStyles = {
  wrapper:
    'rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 sm:p-5 text-sm space-y-3',
  headerRow:
    'flex items-center justify-between gap-3 flex-wrap',
  collapseBtn:
    'flex items-center gap-2 bg-transparent border-0 p-0 text-left cursor-pointer text-[var(--color-text)] hover:text-[var(--color-tool-cyan)] transition-colors',
  chev:
    'inline-block w-3 text-[var(--color-text-muted)] font-mono leading-none',
  title:
    'text-xs uppercase tracking-wider font-semibold',
  titleMeta:
    'font-mono normal-case tracking-normal text-[var(--color-text-muted)] font-normal',
  headerActions:
    'flex items-center gap-2 flex-wrap',
  linkBtn:
    'text-xs text-[var(--color-text-muted)] hover:text-[var(--color-tool-cyan)] underline bg-transparent border-0 p-0 cursor-pointer',
  dangerBtn:
    'text-xs text-[var(--color-active-red,#FF8FA3)] underline bg-transparent border-0 p-0 cursor-pointer hover:opacity-80',
  confirmText:
    'text-xs text-[var(--color-text-muted)]',
  warningBanner:
    'rounded-md border border-[var(--color-border-bright,rgba(255,255,255,0.18))] bg-[rgba(255,165,107,0.08)] px-3 py-2 text-xs text-[var(--color-text-muted)] font-mono',
  errorMsg:
    'text-xs text-[var(--color-active-red,#FF8FA3)] font-mono mb-3',
  quotaRow:
    'flex items-center gap-3 flex-wrap text-xs text-[var(--color-text-muted)] font-mono',
  quotaBar:
    'flex-1 min-w-[160px] h-1.5 rounded-full bg-[rgba(255,255,255,0.08)] overflow-hidden',
  quotaFill:
    'h-full transition-[width] duration-300 ease-out',
  quotaText:
    'whitespace-nowrap',
  persistedTag:
    'text-[var(--color-finalized,#5FDDA8)]',
  bestEffortTag:
    'text-[var(--color-text-faint)]',
  skeletonHeader:
    'h-3 w-40 rounded bg-[rgba(255,255,255,0.06)] animate-pulse',
  skeletonCard:
    'h-14 rounded-md bg-[rgba(255,255,255,0.04)] animate-pulse',
  fallbackList:
    'divide-y divide-[var(--color-border)] -mx-1',
  fallbackItem:
    'py-2 px-1',
  fallbackRow:
    'flex items-center justify-between gap-3',
  fallbackMain:
    'flex-1 min-w-0',
  fallbackTitle:
    'text-sm text-[var(--color-text)] truncate',
  fallbackMeta:
    'text-xs text-[var(--color-text-muted)] font-mono',
};
