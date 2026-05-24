'use client';
import { useState, useId, useCallback, useMemo, useEffect } from 'react';
import { studySummary, modalityToKey } from '../../lib/dicom/study-organizer';
// AGENT-B Phase 5: lazy thumbnail load from IDB on mount, subscribe to
// `cuvi:thumbnail-ready` so re-renders happen as the worker pool emits.
import { loadThumbnail } from '../../lib/dicom/dicom-store';
// AGENT-A Phase 6 — detect studies that will auto-route to side-by-side
// synced compare so the CTA label can hint at the workflow up front.
// LabHome's onOpenStudy callback already does the routing; this is just
// for the button label.
import { detectSyncCompareCandidate } from '../../lib/dicom/stack-scroll';

// StudyCard — single-study panel in the imported-studies list.
//
// Layout (mobile-first 375px, scales to wider):
//   [Thumbnail]     192×192 (96 on mobile) preview · first instance pixel
//                   render with W/L mapping. Falls back to modality glyph
//                   while generation is in flight or if PNG unavailable.
//   [Header row]    pt-XXXXXXXX   |   modality chip(s)   |   trash
//   [Title]         study description (or studyUid fallback)
//   [Meta line]     date · N series · M images
//   [Series list]   collapsible disclosure rows, one per series
//   [Footer]        "Open all" CTA
//
// All styling uses CSS custom properties from app/globals.css so the card
// stays on-theme if the dark palette gets retuned later. No external CSS.
//
// 2026-05-21 — Created for Phase 4 (Agent C). The trash icon uses the
// same 2-step confirm pattern Palm prefers (first click swaps icon to
// "Sure?", second click within 4s commits). Avoids destructive misclicks
// on mobile where the trash sits near the card's tap target.
//
// 2026-05-21 — AGENT-B Phase 5 added thumbnail slot. Cache lookup runs
// once per study on mount; if absent, we render a "generating..." skeleton
// + glyph and wait for the LabHome-emitted `cuvi:thumbnail-ready` event
// to fill it in. URL.createObjectURL is revoked on unmount to avoid leaks.

export default function StudyCard({
  study,
  onOpenStudy,
  onOpenInstance,
  onDeleteStudy,
}) {
  const summary = useMemo(() => studySummary(study), [study]);
  // AGENT-A Phase 5 — peek at the largest series to decide whether the
  // "Open study" button promises stack-scroll or just opens the first
  // instance(s). Cheap O(series-count) reduce; recomputed only when the
  // study object identity changes (RecentImports replaces it wholesale
  // on each refresh).
  const longestSeriesInstanceCount = useMemo(() => {
    let max = 0;
    for (const s of study?.series || []) {
      const n = s.instances?.length || 0;
      if (n > max) max = n;
    }
    return max;
  }, [study]);
  // AGENT-A Phase 6 — does this study auto-route to side-by-side-stack
  // when the user clicks "Open"? Cached the same way (study identity)
  // because the candidate detection traverses the series list.
  const compareCandidate = useMemo(
    () => detectSyncCompareCandidate(study),
    [study],
  );
  const compareCounts = compareCandidate
    ? {
        left: compareCandidate.leftSeries.instances?.length || 0,
        right: compareCandidate.rightSeries.instances?.length || 0,
      }
    : null;
  const titleId = useId();

  // AGENT-B Phase 5: thumbnail object URL. Null = not yet loaded /
  // generated. Initial mount tries the IDB cache; the LabHome event
  // listener fills the gap on a `cuvi:thumbnail-ready` dispatch.
  const [thumbUrl, setThumbUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let lastUrl = null;
    // Cache lookup on mount + on study change.
    (async () => {
      try {
        const blob = await loadThumbnail(study.studyUid);
        if (cancelled || !blob) return;
        lastUrl = URL.createObjectURL(blob);
        setThumbUrl(lastUrl);
      } catch {
        /* no thumb yet — fallback glyph stays */
      }
    })();
    // Subscribe to the LabHome-emitted ready event.
    const onReady = (e) => {
      const detail = e?.detail;
      if (!detail || detail.studyUid !== study.studyUid) return;
      if (cancelled) return;
      // Prefer the URL the dispatcher already minted if present, else
      // mint our own from the blob payload.
      let nextUrl = detail.url;
      if (!nextUrl && detail.blob) {
        nextUrl = URL.createObjectURL(detail.blob);
      }
      if (!nextUrl) return;
      // Revoke any previous URL we created (event-supplied URLs are
      // owned by the dispatcher and outlive us, so we only revoke our
      // own).
      if (lastUrl && lastUrl !== nextUrl) {
        URL.revokeObjectURL(lastUrl);
      }
      lastUrl = nextUrl;
      setThumbUrl(nextUrl);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('cuvi:thumbnail-ready', onReady);
    }
    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('cuvi:thumbnail-ready', onReady);
      }
      if (lastUrl) {
        try { URL.revokeObjectURL(lastUrl); } catch { /* noop */ }
      }
    };
  }, [study.studyUid]);

  // Two-step delete: first click = arm, second click = commit. Auto-disarm
  // after 4s so a finger-slip doesn't stay "live" forever.
  const [armDelete, setArmDelete] = useState(false);
  const handleDeleteClick = useCallback(() => {
    if (armDelete) {
      onDeleteStudy?.(study.studyUid);
      setArmDelete(false);
      return;
    }
    setArmDelete(true);
    const t = setTimeout(() => setArmDelete(false), 4000);
    // No cleanup return — timer is cheap, harmless if it fires after unmount.
    return () => clearTimeout(t);
  }, [armDelete, onDeleteStudy, study.studyUid]);

  const displayTitle = study.studyDescription
    || (study.studyUid ? `Study ${shortUid(study.studyUid)}` : 'Untitled study');

  const modalityKey = modalityToKey(summary.primaryModality);

  return (
    <section
      role="region"
      aria-labelledby={titleId}
      style={cardStyle}
    >
      {/* Header row: anonymized patient ID + modality chip + trash */}
      <div style={headerRowStyle}>
        <div style={patientIdStyle} title="Anonymized patient identifier">
          {study.patientId || 'pt-unknown'}
        </div>
        <div style={headerRightStyle}>
          <span style={modalityBadgeStyle(modalityKey)}>
            {modalityShortLabel(modalityKey)}
          </span>
          <button
            type="button"
            onClick={handleDeleteClick}
            style={armDelete ? trashBtnArmedStyle : trashBtnStyle}
            aria-label={armDelete ? 'Confirm delete study' : 'Delete study'}
            title={armDelete ? 'คลิกอีกครั้งเพื่อยืนยัน' : 'ลบ study'}
          >
            {armDelete ? 'Sure?' : '🗑'}
          </button>
        </div>
      </div>

      {/* AGENT-B Phase 5 — Thumbnail slot. Shows the rendered PNG once
          the worker pool fills the cache; falls back to a modality glyph
          tile while generation is in flight. The img has alt="" because
          the title text below already describes the study (a11y:
          decorative). */}
      <div style={thumbWrapStyle(modalityKey)}>
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            decoding="async"
            loading="lazy"
            style={thumbImgStyle}
          />
        ) : (
          <div style={thumbGlyphStyle} aria-hidden="true">
            {modalityGlyph(modalityKey)}
            <span style={thumbGenLabelStyle}>generating…</span>
          </div>
        )}
      </div>

      {/* Title */}
      <h3 id={titleId} style={titleStyle}>
        {displayTitle}
      </h3>

      {/* Meta line: date · series count · image count */}
      <p style={metaLineStyle}>
        {[
          summary.date,
          `${summary.seriesCount} series`,
          `${summary.instanceCount} ${summary.instanceCount === 1 ? 'image' : 'images'}`,
        ].filter(Boolean).join(' · ')}
      </p>

      {/* Series rows — disclosure pattern (default: collapsed) */}
      <div style={seriesListStyle}>
        {study.series.map((s) => (
          <SeriesRow
            key={s.seriesUid}
            series={s}
            onOpenInstance={onOpenInstance}
          />
        ))}
      </div>

      {/* Footer CTA — open the whole study.
          AGENT-A Phase 5 — when the largest series has >2 instances, the
          parent's onOpenStudy handler routes through to stack mode (one
          viewport, scrollable). The button label hints at this so the user
          knows what they're getting. The handler itself lives in LabHome's
          onOpenStudy callback; we just expose the affordance here.
          AGENT-A Phase 6 — when the study has two series of similar
          length (compareCandidate non-null), LabHome routes to synced
          side-by-side compare instead. Reflect this in the label so the
          user knows what they're getting BEFORE clicking — same handler,
          richer hint. */}
      <button
        type="button"
        onClick={() => onOpenStudy?.(study)}
        style={openAllBtnStyle}
        title={compareCandidate
          ? `Open synced compare: 2 series side-by-side (L: ${compareCounts.left} slices · R: ${compareCounts.right} slices)`
          : longestSeriesInstanceCount > 2
            ? `Open as scrollable stack (${longestSeriesInstanceCount} slices)`
            : 'Open study'}
      >
        {compareCandidate
          ? `🔗 Open synced compare (${compareCounts.left} ↔ ${compareCounts.right} slices) →`
          : longestSeriesInstanceCount > 2
            ? `📚 Open as stack (${longestSeriesInstanceCount} slices) →`
            : 'Open study →'}
      </button>
    </section>
  );
}

// ── SeriesRow ────────────────────────────────────────────────────────────

function SeriesRow({ series, onOpenInstance }) {
  const [expanded, setExpanded] = useState(false);
  const modalityKey = modalityToKey(series.modality);
  const count = series.instances.length;
  const summaryId = useId();

  const label = series.seriesDescription || `Series ${shortUid(series.seriesUid)}`;

  return (
    <div style={seriesRowWrapStyle}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={seriesRowBtnStyle}
        aria-expanded={expanded}
        aria-controls={summaryId}
      >
        <span style={modalityDotStyle(modalityKey)} aria-hidden />
        <span style={seriesRowLabelStyle}>{label}</span>
        <span style={seriesRowCountStyle}>
          {count} {count === 1 ? 'img' : 'imgs'}
        </span>
        <span
          aria-hidden
          style={{ ...chevronStyle, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          ›
        </span>
      </button>

      {expanded && (
        <ul id={summaryId} style={instanceListStyle}>
          {series.instances.map((meta, idx) => (
            <li key={meta.sopInstanceUid || idx} style={instanceItemStyle}>
              <button
                type="button"
                onClick={() => onOpenInstance?.(meta)}
                style={instanceBtnStyle}
                title={`Open ${meta.sopInstanceUid}`}
              >
                <span style={instanceIdxStyle}>#{idx + 1}</span>
                <span style={instanceUidStyle}>{shortUid(meta.sopInstanceUid)}</span>
                <span aria-hidden style={instanceArrowStyle}>↗</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function shortUid(uid) {
  if (!uid) return '';
  // DICOM UIDs can be 60+ chars. Trim the suffix so the UI doesn't wrap;
  // mid-UID is unique enough for human disambiguation.
  if (uid.length <= 24) return uid;
  return `…${uid.slice(-20)}`;
}

function modalityShortLabel(k) {
  if (k === 'xray') return 'X-ray';
  if (k === 'ct') return 'CT';
  if (k === 'mri') return 'MRI';
  if (k === 'us') return 'US';
  return 'Other';
}

// AGENT-B Phase 5 — modality emoji used as the fallback when no
// thumbnail PNG is cached yet. Mirrors the dot palette colour mapping
// so the glyph reads as part of the same visual language.
function modalityGlyph(k) {
  if (k === 'xray') return '🦴';
  if (k === 'ct') return '🧠';
  if (k === 'mri') return '🧲';
  if (k === 'us') return '🫧';
  return '🖼';
}

// Modality palette — matches CaseLibraryLocal.jsx so the visual language
// is the same across "imported studies" and "case library" sections.
function modalityBadgeStyle(k) {
  const palette = {
    xray: { bg: 'rgba(90, 204, 230, 0.16)', border: 'rgba(90, 204, 230, 0.42)', fg: '#7DDCEF' },
    ct: { bg: 'rgba(255, 154, 90, 0.14)', border: 'rgba(255, 154, 90, 0.38)', fg: '#FFA56B' },
    mri: { bg: 'rgba(167, 139, 250, 0.16)', border: 'rgba(167, 139, 250, 0.42)', fg: '#B7A2FF' },
    us: { bg: 'rgba(52, 211, 153, 0.14)', border: 'rgba(52, 211, 153, 0.38)', fg: '#5FDDA8' },
    other: { bg: 'rgba(255, 255, 255, 0.06)', border: 'rgba(255, 255, 255, 0.18)', fg: 'var(--color-text-muted)' },
  };
  const c = palette[k] || palette.other;
  return {
    fontSize: '0.66rem',
    padding: '2px 8px',
    color: c.fg,
    background: c.bg,
    border: `1px solid ${c.border}`,
    borderRadius: 999,
    whiteSpace: 'nowrap',
    fontWeight: 600,
    letterSpacing: 0.1,
    minHeight: 20,
    display: 'inline-flex',
    alignItems: 'center',
  };
}

// Small colored dot used as the modality marker on each Series row.
function modalityDotStyle(k) {
  const palette = {
    xray: '#7DDCEF',
    ct: '#FFA56B',
    mri: '#B7A2FF',
    us: '#5FDDA8',
    other: 'var(--color-text-faint)',
  };
  return {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: palette[k] || palette.other,
    flexShrink: 0,
  };
}

// ── Style atoms (dark-theme tokens from app/globals.css) ─────────────────

const cardStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 12,
  padding: 14,
  background: 'var(--color-surface-2)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const headerRowStyle = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 8,
  flexWrap: 'wrap',
};

const headerRightStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const patientIdStyle = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: '0.78rem',
  color: 'var(--color-text-muted)',
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid var(--color-border)',
  padding: '3px 8px',
  borderRadius: 6,
  letterSpacing: 0.2,
};

// Phase 9: trash bumped 28×28 → 44×44. The icon stays visually small
// (0.85rem) but the hit area now meets WCAG-AAA. Padding is intentionally
// asymmetric so the icon stays optically centered after the bump.
const trashBtnStyle = {
  background: 'transparent',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)',
  borderRadius: 6,
  padding: '10px 12px',
  fontSize: '0.85rem',
  lineHeight: 1,
  cursor: 'pointer',
  minHeight: 44,
  minWidth: 44,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'border-color 140ms, color 140ms, background-color 140ms',
};

const trashBtnArmedStyle = {
  ...trashBtnStyle,
  background: 'rgba(255, 77, 109, 0.12)',
  border: '1px solid rgba(255, 77, 109, 0.5)',
  color: '#FF8FA3',
  fontSize: '0.72rem',
  fontWeight: 600,
  letterSpacing: 0.2,
};

const titleStyle = {
  margin: '2px 0 0',
  fontSize: '0.98rem',
  fontWeight: 600,
  color: 'var(--color-text)',
  letterSpacing: '-0.01em',
  lineHeight: 1.3,
  overflowWrap: 'anywhere',
};

const metaLineStyle = {
  margin: 0,
  fontSize: '0.76rem',
  color: 'var(--color-text-muted)',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  letterSpacing: 0.1,
};

const seriesListStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginTop: 4,
};

const seriesRowWrapStyle = {
  borderTop: '1px dashed var(--color-border)',
  paddingTop: 6,
};

// Phase 9: series disclosure row bumped to 44px floor (was 32).
// These rows are wide-but-short — a missed tap collapses/expands the
// wrong series. The chevron + label keep their visual weight; only
// padding grows.
const seriesRowBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  background: 'transparent',
  border: 'none',
  padding: '10px 6px',
  cursor: 'pointer',
  color: 'var(--color-text)',
  textAlign: 'left',
  fontSize: '0.82rem',
  borderRadius: 6,
  minHeight: 44,
};

const seriesRowLabelStyle = {
  flex: '1 1 0',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const seriesRowCountStyle = {
  fontSize: '0.7rem',
  color: 'var(--color-text-muted)',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  flexShrink: 0,
};

const chevronStyle = {
  color: 'var(--color-text-faint)',
  fontSize: '0.95rem',
  transition: 'transform 140ms',
  display: 'inline-block',
  width: 12,
  textAlign: 'center',
};

const instanceListStyle = {
  listStyle: 'none',
  padding: '4px 0 4px 16px',
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const instanceItemStyle = {
  margin: 0,
};

// Phase 9: per-instance row bumped 28→44 floor. These rows render
// inside a series disclosure list — at 28 they were almost touching
// on a phone, easy to tap the wrong instance.
const instanceBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  background: 'transparent',
  border: '1px solid transparent',
  padding: '10px 8px',
  cursor: 'pointer',
  color: 'var(--color-text-muted)',
  textAlign: 'left',
  fontSize: '0.78rem',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  borderRadius: 6,
  minHeight: 44,
  transition: 'border-color 140ms, color 140ms, background-color 140ms',
};

const instanceIdxStyle = {
  color: 'var(--color-text-faint)',
  flexShrink: 0,
  width: 30,
};

const instanceUidStyle = {
  flex: '1 1 0',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const instanceArrowStyle = {
  color: 'var(--color-tool-cyan)',
  flexShrink: 0,
};

// ── AGENT-B Phase 5 — Thumbnail slot styles ─────────────────────────────
// Square aspect-ratio container so the layout doesn't shift between
// "generating glyph" and the loaded PNG. Mobile-first: 96×96 on narrow
// viewports (we control via aspect-ratio + max-width), expands to fill
// the card width on wider screens up to 192px tall — but always 1:1.
// Backed by a faint modality-tinted gradient so the glyph fallback
// doesn't look like a dropped image.

function thumbWrapStyle(k) {
  const tint = {
    xray: 'rgba(90, 204, 230, 0.06)',
    ct: 'rgba(255, 154, 90, 0.06)',
    mri: 'rgba(167, 139, 250, 0.06)',
    us: 'rgba(52, 211, 153, 0.05)',
    other: 'rgba(255, 255, 255, 0.03)',
  };
  return {
    width: '100%',
    aspectRatio: '1 / 1',
    maxHeight: 192,
    margin: '2px 0',
    borderRadius: 8,
    overflow: 'hidden',
    background: `linear-gradient(180deg, ${tint[k] || tint.other} 0%, rgba(0,0,0,0.4) 100%)`,
    border: '1px solid var(--color-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    // Subtle skeleton shimmer while empty — a 12% opacity static dark
    // band rather than a CSS keyframe pulse (Palm dislikes box-shadow
    // keyframe animations; this is content-shaped passive shading).
  };
}

const thumbImgStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  display: 'block',
  background: '#06070A',
};

const thumbGlyphStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontSize: '2.4rem',
  lineHeight: 1,
  color: 'var(--color-text-faint)',
  opacity: 0.85,
};

const thumbGenLabelStyle = {
  fontSize: '0.62rem',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  color: 'var(--color-text-faint)',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

// Phase 9: primary CTA bumped 36→44 floor with 12px V padding so the
// "Open study" footer is the unambiguous tap target on a mobile card.
const openAllBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  width: '100%',
  marginTop: 8,
  padding: '12px 14px',
  borderRadius: 8,
  background: 'var(--color-tool-cyan)',
  color: '#06070A',
  border: 'none',
  fontSize: '0.85rem',
  fontWeight: 600,
  letterSpacing: '-0.005em',
  cursor: 'pointer',
  minHeight: 44,
  transition: 'background-color 140ms',
};
