'use client';
import { useState, useId, useCallback, useMemo } from 'react';
import { studySummary, modalityToKey } from '../../lib/dicom/study-organizer';

// StudyCard — single-study panel in the imported-studies list.
//
// Layout (mobile-first 375px, scales to wider):
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

export default function StudyCard({
  study,
  onOpenStudy,
  onOpenInstance,
  onDeleteStudy,
}) {
  const summary = useMemo(() => studySummary(study), [study]);
  const titleId = useId();

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

      {/* Footer CTA — open the whole study */}
      <button
        type="button"
        onClick={() => onOpenStudy?.(study)}
        style={openAllBtnStyle}
      >
        Open study →
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

const trashBtnStyle = {
  background: 'transparent',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)',
  borderRadius: 6,
  padding: '3px 8px',
  fontSize: '0.85rem',
  lineHeight: 1,
  cursor: 'pointer',
  minHeight: 28,
  minWidth: 28,
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

const seriesRowBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  background: 'transparent',
  border: 'none',
  padding: '6px 4px',
  cursor: 'pointer',
  color: 'var(--color-text)',
  textAlign: 'left',
  fontSize: '0.82rem',
  borderRadius: 6,
  minHeight: 32,
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

const instanceBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  background: 'transparent',
  border: '1px solid transparent',
  padding: '5px 8px',
  cursor: 'pointer',
  color: 'var(--color-text-muted)',
  textAlign: 'left',
  fontSize: '0.74rem',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  borderRadius: 6,
  minHeight: 28,
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

const openAllBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  width: '100%',
  marginTop: 8,
  padding: '9px 12px',
  borderRadius: 8,
  background: 'var(--color-tool-cyan)',
  color: '#06070A',
  border: 'none',
  fontSize: '0.85rem',
  fontWeight: 600,
  letterSpacing: '-0.005em',
  cursor: 'pointer',
  minHeight: 36,
  transition: 'background-color 140ms',
};
