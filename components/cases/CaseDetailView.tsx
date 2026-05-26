'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
  lazy,
} from 'react';
import Link from 'next/link';
import type { ImagingCase } from '@/lib/cases';
import { RecallInputCard } from './RecallInputCard';
import { RevealedCard } from './RevealedCard';
import { DDxRankerCard } from './DDxRankerCard';
import { LesionSpotCard } from './LesionSpotCard';
import { RelatedCases } from './RelatedCases';
import type { Box } from '@/lib/scoring/iou';

const DicomViewport = lazy(() => import('@/components/lab/DicomViewport.jsx'));

// ─── localStorage schema ────────────────────────────────────────────────
// Bumping v1 → v2 means clearing previous attempts intentionally.
// Read-side is defensive (try/catch + fallback {}), so a stale or
// malformed entry never crashes the page.
const ATTEMPTS_KEY = 'cuvi-attempts-v1';

type AttemptRecord = {
  notes: string;
  confidence: 1 | 2 | 3 | 4 | 5;
  revealedAt: string | null; // ISO timestamp, null if user hasn't revealed yet
  lastEditedAt: string;       // ISO of last note edit (useful for future SRS)
  // ── DDx Ranker outcome (added 2026-05-20) ──
  // Optional · only present after the student submits the ranker step.
  // We persist alongside notes so the student can see prior attempts
  // when re-doing a case. Schema is forward-compatible: missing field
  // means "ranker not attempted yet" or pre-Phase-2 attempt.
  dxRanking?: {
    student: string[];      // student's top-3 names, in their ranked order
    score: 0 | 1 | 2 | 3;   // bucketed score for headline display
    rankedAt: string;       // ISO submission timestamp
  };
  // ── Lesion-spot outcome (added 2026-05-21, Phase 3) ──
  // Optional · only present after the student submits a box in the
  // spotting mode. Schema is forward-compatible: missing field means
  // "spotting not attempted" or pre-Phase-3 attempt. Additive — old
  // attempts continue to read correctly thanks to the defensive
  // try/catch in readAttempts().
  lesionSpot?: {
    studentBox: Box;        // normalized [0, 1] coords of submitted box
    iou: number;            // 0.0–1.0 best-match score across regions
    submittedAt: string;    // ISO timestamp
  };
};

type AttemptStore = Record<string, AttemptRecord>;

function readAttempts(): AttemptStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(ATTEMPTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as AttemptStore;
  } catch {
    /* corrupt JSON — start fresh */
  }
  return {};
}

function writeAttempt(slug: string, record: AttemptRecord) {
  if (typeof window === 'undefined') return;
  try {
    const all = readAttempts();
    all[slug] = record;
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(all));
  } catch {
    /* quota or private mode — silently degrade */
  }
}

type Status = 'loading' | 'ready' | 'not-found' | 'error';
// `ranking` is the new intermediate step between recall + revealed. It's
// only entered when the case has a non-empty `recall.ddx` array AND the
// student went through the recall reveal flow (not skip-recall).
//
// `spotting` (added Phase 3, 2026-05-21) is an OPTIONAL post-reveal step
// entered from the RevealedCard CTA. Available only when the case has
// `recall.lesion_regions` populated · graceful-degrades by hiding the
// CTA when regions are missing. Returning from spotting goes back to
// `revealed`, not forward — the student can re-try the spotting from
// the same compare view.
type Mode = 'recall' | 'ranking' | 'revealed' | 'spotting';

export function CaseDetailView({ caseId }: { caseId: string }) {
  // ── case loading ──
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [caseMeta, setCaseMeta] = useState<ImagingCase | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  // Full catalog kept in state so the RelatedCases widget can score
  // candidates client-side without a second fetch. Loaded together
  // with the case index.
  const [catalog, setCatalog] = useState<ImagingCase[]>([]);

  // ── active recall workflow state ──
  const [mode, setMode] = useState<Mode>('recall');
  const [studentNotes, setStudentNotes] = useState('');
  const [confidence, setConfidence] = useState<1 | 2 | 3 | 4 | 5>(3);

  // Hydrate prior attempt (if any) once caseMeta lands. Don't restore the
  // mode itself — re-entering a case starts in recall by default so the
  // student commits to their guess each visit. Their previous notes are
  // pre-filled as a starting point.
  //
  // queueMicrotask defers the setState calls past React's "no setState
  // sync in effect" guard. Behavior is unchanged — the student sees the
  // prior notes one microtask later, well before the next paint.
  useEffect(() => {
    if (!caseMeta) return;
    queueMicrotask(() => {
      const prior = readAttempts()[caseMeta.slug];
      if (prior) {
        setStudentNotes(prior.notes ?? '');
        if (prior.confidence) setConfidence(prior.confidence);
      }
    });
  }, [caseMeta]);

  // ── fetch the case index + DICOM files ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idxRes = await fetch('/cases.json', { cache: 'no-store' });
        if (!idxRes.ok) throw new Error(`Case index HTTP ${idxRes.status}`);
        const idx = (await idxRes.json()) as ImagingCase[];
        const meta = idx.find((c) => c.slug === caseId || c.id === caseId);
        if (!meta) {
          if (!cancelled) setStatus('not-found');
          return;
        }
        if (!cancelled) {
          setCaseMeta(meta);
          setCatalog(idx);
        }

        // Fetch each .dcm file as a Blob → File so it slots into the
        // viewer's File-based API directly. Cap at 2 files per existing
        // LabHome / CaseViewerClient convention.
        const fetched = await Promise.all(
          (meta.files ?? []).slice(0, 2).map(async (entry) => {
            const r = await fetch(entry.path, { cache: 'force-cache' });
            if (!r.ok) throw new Error(`${entry.path} HTTP ${r.status}`);
            const buf = await r.arrayBuffer();
            return new File([buf], `${meta.slug}_${entry.view_name}.dcm`, {
              type: 'application/dicom',
            });
          }),
        );
        if (!cancelled) {
          setFiles(fetched);
          setStatus('ready');
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  // Persist on note/confidence edit (debounced via simple setTimeout).
  // We persist on every change because the data is tiny (text + 1 number)
  // and writing on tab-close is unreliable on mobile Safari.
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!caseMeta) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      const prior = readAttempts()[caseMeta.slug];
      writeAttempt(caseMeta.slug, {
        notes: studentNotes,
        confidence,
        revealedAt: prior?.revealedAt ?? null,
        lastEditedAt: new Date().toISOString(),
      });
    }, 300);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [studentNotes, confidence, caseMeta]);

  // Helper — scroll the reveal/ranker anchor into view on mobile.
  const scrollToAnchor = useCallback(() => {
    if (typeof window === 'undefined') return;
    requestAnimationFrame(() => {
      document
        .getElementById('reveal-anchor')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  // Whether this case has any DDx to rank against. Cases with an empty
  // (or missing) ddx array auto-skip the ranker step entirely.
  const hasRankableDdx = !!(caseMeta?.recall?.ddx && caseMeta.recall.ddx.length > 0);

  // Reveal — stamp revealedAt + flip mode. If the case has a populated
  // DDx, we route to the new `ranking` step first; otherwise we go
  // straight to the standard compare view.
  const reveal = useCallback(() => {
    if (!caseMeta) return;
    const prior = readAttempts()[caseMeta.slug];
    writeAttempt(caseMeta.slug, {
      notes: studentNotes,
      confidence,
      revealedAt: new Date().toISOString(),
      lastEditedAt: prior?.lastEditedAt ?? new Date().toISOString(),
      dxRanking: prior?.dxRanking,
    });
    setMode(hasRankableDdx ? 'ranking' : 'revealed');
    scrollToAnchor();
  }, [caseMeta, studentNotes, confidence, hasRankableDdx, scrollToAnchor]);

  // "Skip recall" — let the user view the case in browse mode (still
  // shows expert findings if available, but flips immediately).
  // Bypasses the ranker entirely · users opting out of recall don't
  // want a quiz either.
  const skipRecall = useCallback(() => {
    setMode('revealed');
  }, []);

  // "Skip ranker" — from inside the ranking step, jump to compare.
  // Reusable by both the explicit "Skip ranking" link and the post-
  // submit "Continue to compare" button.
  const skipRanker = useCallback(() => {
    setMode('revealed');
    scrollToAnchor();
  }, [scrollToAnchor]);

  // Persist the ranker outcome alongside notes/confidence. Don't
  // overwrite existing notes/confidence/revealedAt — just merge in.
  const onRankerSubmit = useCallback(
    (result: { studentTop3: string[]; score: 0 | 1 | 2 | 3; rankedAt: string }) => {
      if (!caseMeta) return;
      const prior = readAttempts()[caseMeta.slug];
      writeAttempt(caseMeta.slug, {
        notes: prior?.notes ?? studentNotes,
        confidence: prior?.confidence ?? confidence,
        revealedAt: prior?.revealedAt ?? new Date().toISOString(),
        lastEditedAt: prior?.lastEditedAt ?? new Date().toISOString(),
        dxRanking: {
          student: result.studentTop3,
          score: result.score,
          rankedAt: result.rankedAt,
        },
      });
    },
    [caseMeta, studentNotes, confidence],
  );

  // ── Lesion-spot wiring (Phase 3) ──
  // Whether this case has expert lesion regions to score against. Drives
  // the "try spot-the-finding" CTA on the RevealedCard. Cases without
  // regions hide the CTA entirely.
  const hasLesionRegions = !!(
    caseMeta?.recall?.lesion_regions && caseMeta.recall.lesion_regions.length > 0
  );

  const enterSpotting = useCallback(() => {
    if (!hasLesionRegions) return;
    setMode('spotting');
    scrollToAnchor();
  }, [hasLesionRegions, scrollToAnchor]);

  const exitSpotting = useCallback(() => {
    setMode('revealed');
    scrollToAnchor();
  }, [scrollToAnchor]);

  // Persist the lesion-spot outcome alongside other fields. Same merge
  // pattern as the ranker callback — preserve prior data, never lose
  // notes/confidence/ranking when only spotting was attempted.
  const onLesionSpotSubmit = useCallback(
    (result: { studentBox: Box; iou: number; submittedAt: string }) => {
      if (!caseMeta) return;
      const prior = readAttempts()[caseMeta.slug];
      writeAttempt(caseMeta.slug, {
        notes: prior?.notes ?? studentNotes,
        confidence: prior?.confidence ?? confidence,
        revealedAt: prior?.revealedAt ?? new Date().toISOString(),
        lastEditedAt: prior?.lastEditedAt ?? new Date().toISOString(),
        dxRanking: prior?.dxRanking,
        lesionSpot: {
          studentBox: result.studentBox,
          iou: result.iou,
          submittedAt: result.submittedAt,
        },
      });
    },
    [caseMeta, studentNotes, confidence],
  );

  const breadcrumb = useMemo(() => {
    if (!caseMeta) return caseId;
    return caseMeta.title;
  }, [caseMeta, caseId]);

  // ─── render branches ───
  if (status === 'loading') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-[var(--color-text-muted)]">
        <div className="inline-flex h-2 w-2 rounded-full bg-[var(--color-tool-cyan)] animate-pulse mr-2 align-middle" />
        Loading case <code className="text-[var(--color-text)] font-mono">{caseId}</code>…
      </div>
    );
  }

  if (status === 'not-found') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <div className="text-4xl mb-3">📭</div>
        <h1 className="text-xl font-semibold mb-2 text-[var(--color-text)]">Case not found</h1>
        <p className="text-[var(--color-text-muted)] text-sm mb-4">
          ไม่พบ case <code className="font-mono">{caseId}</code> ใน <code className="font-mono">/cases.json</code>
        </p>
        <Link href="/cases" className="imaging-btn imaging-btn-ghost">
          ← Back to case library
        </Link>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <h1 className="text-xl font-semibold mb-2 text-[var(--color-text)]">Failed to load case</h1>
        <p className="text-[var(--color-text-muted)] text-sm mb-4 font-mono">{error}</p>
        <Link href="/cases" className="imaging-btn imaging-btn-ghost">
          ← Back to case library
        </Link>
      </div>
    );
  }

  if (!caseMeta) return null;

  // ─── happy path ───
  const signalmentBits = [caseMeta.species, caseMeta.signalment].filter(Boolean);

  return (
    <div className="mx-auto max-w-5xl px-3 sm:px-5 py-4">
      {/* Breadcrumb · skip-recall affordance */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="text-xs sm:text-sm text-[var(--color-text-muted)] flex items-center gap-2 min-w-0">
          <Link
            href="/cases"
            className="text-[var(--color-text-muted)] hover:text-[var(--color-tool-cyan)] transition-colors"
          >
            ← Cases
          </Link>
          <span aria-hidden className="text-[var(--color-text-faint)]">/</span>
          <span className="truncate text-[var(--color-text)] font-medium">{breadcrumb}</span>
        </div>
        {mode === 'recall' && (
          <button
            onClick={skipRecall}
            className="text-[11px] sm:text-xs font-mono uppercase tracking-wider text-[var(--color-text-faint)] hover:text-[var(--color-tool-cyan)] transition-colors"
            title="Skip the active recall step and just browse the case"
          >
            Skip recall — just show me the case →
          </button>
        )}
      </div>

      {/* Signalment + history block */}
      <section className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
        <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-[var(--color-text)] mb-2">
          {caseMeta.title}
        </h1>
        {signalmentBits.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--color-text-muted)] mb-2">
            {signalmentBits.map((bit, i) => (
              <span key={i} className="inline-flex items-center gap-2">
                {i > 0 && <span aria-hidden className="text-[var(--color-text-faint)]">/</span>}
                <span>{bit}</span>
              </span>
            ))}
            {caseMeta.body_part && (
              <>
                <span aria-hidden className="text-[var(--color-text-faint)]">/</span>
                <span>{caseMeta.body_part}</span>
              </>
            )}
            {caseMeta.modality && (
              <span className="ml-1 inline-flex items-center rounded border border-[var(--color-border-bright)] px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-[var(--color-tool-cyan)]">
                {caseMeta.modality}
              </span>
            )}
          </div>
        )}
        {caseMeta.history && (
          <p className="text-sm text-[var(--color-text)] leading-relaxed">
            <strong className="text-[var(--color-text-muted)] font-mono text-[11px] uppercase tracking-wider mr-2">
              History
            </strong>
            {caseMeta.history}
          </p>
        )}
      </section>

      {/* DICOM viewer · always shown (clean image, no overlays in recall mode) */}
      <section className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2">
        {files.length > 0 ? (
          <Suspense
            fallback={
              <div className="p-10 text-center text-[var(--color-text-muted)]">
                Loading viewer…
              </div>
            }
          >
            {/* If multiple views, render side-by-side at lg+, stacked below.
                Each pane is its own DicomViewport instance. */}
            <div
              className={
                files.length >= 2
                  ? 'grid grid-cols-1 lg:grid-cols-2 gap-2'
                  : ''
              }
            >
              {files.map((f, idx) => (
                <div
                  key={`${f.name}-${idx}`}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-3)] overflow-hidden"
                >
                  <div className="px-2 py-1.5 text-[11px] font-mono text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                    View {idx + 1}{' '}
                    <span className="text-[var(--color-text-faint)]">·</span>{' '}
                    {(caseMeta.files?.[idx]?.view_name) ?? f.name}
                  </div>
                  <DicomViewport file={f} caseId={caseMeta.id} syncEnabled={false} />
                </div>
              ))}
            </div>
          </Suspense>
        ) : (
          <div className="aspect-[4/3] flex items-center justify-center text-sm text-[var(--color-text-muted)] bg-[var(--color-surface-3)] rounded">
            No image available for this case.
          </div>
        )}
      </section>

      {/* Recall / Ranking / Revealed cards — smooth crossfade by always
          rendering recall + revealed (textarea stays mounted so its
          content shows as "your notes" in revealed mode). The Ranker
          renders ONLY in `ranking` mode and unmounts after — it owns its
          own internal post-submit "scored" UI state, but once the user
          continues to compare we drop it so the parent state machine
          stays simple. */}
      <div id="reveal-anchor" className="scroll-mt-4 relative">
        {/* RECALL card */}
        <div
          className={`transition-opacity duration-200 ${
            mode === 'recall'
              ? 'opacity-100'
              : 'opacity-0 pointer-events-none absolute inset-0 -z-10'
          }`}
          aria-hidden={mode !== 'recall'}
        >
          <RecallInputCard
            notes={studentNotes}
            onNotesChange={setStudentNotes}
            confidence={confidence}
            onConfidenceChange={setConfidence}
            onReveal={reveal}
          />
        </div>

        {/* RANKING card — only rendered while in ranking mode. We mount
            fresh each time so re-doing a case resets the slots; the
            student's submitted ranking is still persisted to
            localStorage for future analytics / SRS. */}
        {mode === 'ranking' && caseMeta.recall && (
          <DDxRankerCard
            caseMeta={{
              slug: caseMeta.slug,
              species: caseMeta.species,
              body_part: caseMeta.body_part,
            }}
            expertDdx={caseMeta.recall.ddx}
            // Exclude the case's own final_diagnosis from the distractor pool
            // so umbrella terms (e.g. "Cardiomegaly" on a cardiomegaly case)
            // don't surface as wrong-choice distractors.
            extraExcludes={caseMeta.recall.final_diagnosis ? [caseMeta.recall.final_diagnosis] : []}
            onSubmit={onRankerSubmit}
            onSkip={skipRanker}
          />
        )}

        {/* REVEALED card */}
        <div
          className={`transition-opacity duration-200 ${
            mode === 'revealed' ? 'opacity-100' : 'opacity-0 pointer-events-none hidden'
          }`}
          aria-hidden={mode !== 'revealed'}
        >
          <RevealedCard
            studentNotes={studentNotes}
            confidence={confidence}
            recall={caseMeta.recall}
            currentSlug={caseMeta.slug}
            canSpotLesion={hasLesionRegions}
            onTrySpotting={enterSpotting}
          />
        </div>

        {/* SPOTTING card — only rendered while in spotting mode. Mounts
            its own copy of DicomViewport so the box-coords map cleanly to
            a fit-to-container layout. Unmounts on exit so re-entering
            starts the student with a fresh box. Only available when the
            case has expert lesion_regions (CTA on RevealedCard is hidden
            otherwise). */}
        {mode === 'spotting' && caseMeta.recall?.lesion_regions && caseMeta.recall.lesion_regions.length > 0 && (
          <LesionSpotCard
            caseMeta={{ slug: caseMeta.slug, id: caseMeta.id }}
            file={files[0]}
            fileViewName={caseMeta.files?.[0]?.view_name}
            regions={caseMeta.recall.lesion_regions}
            onSubmit={onLesionSpotSubmit}
            onExit={exitSpotting}
          />
        )}
      </div>

      {/* Source/license footer · always shown */}
      {(caseMeta.license || caseMeta.source_url || caseMeta.attribution) && (
        <footer className="mt-6 pt-3 border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-faint)] font-mono">
          {caseMeta.license && <span>{caseMeta.license}</span>}
          {caseMeta.source_url && caseMeta.source_url !== 'internal' && (
            <>
              {' / '}
              <a
                href={caseMeta.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-tool-cyan)] hover:underline"
              >
                source ↗
              </a>
            </>
          )}
          {caseMeta.attribution && (
            <div className="text-[var(--color-text-faint)] text-[10px] mt-1">{caseMeta.attribution}</div>
          )}
        </footer>
      )}

      {caseMeta && catalog.length > 0 && (
        <RelatedCases
          currentSlug={caseMeta.slug}
          bodyPart={caseMeta.body_part}
          species={caseMeta.species}
          catalog={catalog}
        />
      )}
    </div>
  );
}
