'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import {
  anonymizeStudy,
  packAnonymizedZip,
  triggerDownload,
} from '../../lib/dicom/anonymize';

// AnonymizeAction — single-study "scrub PII & download ZIP" control.
//
// Phase 5 (Agent ⓔ). Mounted by RecentImports per study, sitting alongside
// the existing trash button on Agent 🅲's StudyCard but rendered as a
// sibling row outside the card so we don't have to touch StudyCard.jsx.
//
// UX flow:
//   1. Idle button: "🛡️ Anonymize & download"
//   2. First click: button transforms into "Sure? Strip PII →" / "Cancel"
//      pair (matches Palm's 2-step destructive-action pattern from
//      StudyCard / RecentImports).
//   3. Confirm: progress strip shows "Anonymizing N of M files…"; aria-live
//      announcement on each tick for screen readers.
//   4. Done: success line with the count of stripped tags + auto-download
//      kicks off. The control auto-resets after 6s.
//   5. Error: shown inline, reset button available.
//
// All work happens on the main thread but we yield between files (see
// anonymize.ts) so the page stays responsive for typical study sizes
// (≤200 instances). For ~thousand-file CT volumes we'd want a worker —
// not in scope for Phase 5.
//
// Iron Rule 0: anonymize.ts re-parses every output and fails the
// per-file report if any PII tag still has a non-padding value. We
// surface a warning row if `selfTestPassed === false` anywhere in the
// study so the student doesn't unknowingly distribute leaky bytes.

export default function AnonymizeAction({ study }) {
  const labelId = useId();
  const progressId = useId();

  // 'idle' | 'armed' | 'running' | 'done' | 'error'
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null); // { report, packed } | null
  const [errorMsg, setErrorMsg] = useState('');
  // Phase 6 (Agent Ⓒ): per-confirmation flag. Default true — manufacturer
  // private blocks are a common PHI hiding spot (DeviceSerialNumber, scan
  // operator notes, dose-report comments). Students can opt out from the
  // confirm row if they need to keep private blocks for a specific
  // research-data study.
  const [stripPrivateBlocks, setStripPrivateBlocks] = useState(true);
  const armTimerRef = useRef(null);
  const resetTimerRef = useRef(null);
  const triggerBtnRef = useRef(null);

  // ── Cleanup pending timers on unmount ──────────────────────────────
  useEffect(() => () => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  const disarm = useCallback(() => {
    setPhase('idle');
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
  }, []);

  const handleArm = useCallback(() => {
    setErrorMsg('');
    setResult(null);
    setPhase('armed');
    armTimerRef.current = setTimeout(() => setPhase('idle'), 5000);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    setPhase('running');
    setProgress({ done: 0, total: 0 });
    setErrorMsg('');
    try {
      const { files, report } = await anonymizeStudy(study.studyUid, {
        // Defaults match the brief: keep StudyDescription + SeriesDescription
        keepStudyDescription: true,
        keepSeriesDescription: true,
        // Phase 6 (Agent Ⓒ): private blocks + recursive sequence walk.
        // Sequences default ON (cheap + critical for SR/dose PHI). Private-
        // block strip mirrors the UI checkbox state.
        stripPrivateBlocks,
        walkSequences: true,
      }, (info) => {
        setProgress({ done: info.doneFiles, total: info.totalFiles });
      });

      if (files.length === 0) {
        setErrorMsg('No files were anonymized (study may be empty).');
        setPhase('error');
        return;
      }

      const packed = await packAnonymizedZip(files, report);
      triggerDownload(packed);

      setResult({ report, filename: packed.filename });
      setPhase('done');
      // Auto-reset after 6s so the card returns to its idle look. Focus
      // returns to the trigger so keyboard users land back where they were.
      resetTimerRef.current = setTimeout(() => {
        setPhase('idle');
        setResult(null);
        triggerBtnRef.current?.focus();
      }, 6000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [study.studyUid, stripPrivateBlocks]);

  // ── Render ─────────────────────────────────────────────────────────

  const studyShortName = study.studyDescription
    || (study.patientId ? `patient ${study.patientId}` : 'study');

  return (
    <div style={wrapStyle} aria-labelledby={labelId}>
      {phase === 'idle' && (
        <button
          type="button"
          ref={triggerBtnRef}
          onClick={handleArm}
          style={primaryBtnStyle}
          aria-label={`Anonymize ${studyShortName} and download cleaned ZIP`}
          title="Strip 22 PII tags + download a cleaned ZIP archive"
        >
          <span aria-hidden style={iconStyle}>🛡️</span>
          <span>Anonymize &amp; download</span>
        </button>
      )}

      {phase === 'armed' && (
        <div style={confirmRowStyle} role="group" aria-label="Confirm anonymization">
          <span id={labelId} style={confirmTextStyle}>
            Strip PII & build ZIP?
          </span>
          {/* Phase 6 (Agent Ⓒ) option toggle — default checked. Keeps the
              destructive-action choice in one row so keyboard users can
              tab through cleanly. */}
          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={stripPrivateBlocks}
              onChange={(e) => setStripPrivateBlocks(e.target.checked)}
              style={checkboxInputStyle}
            />
            <span>Strip private blocks</span>
            <span style={checkboxHintStyle} aria-hidden>
              (manufacturer tags · recommended)
            </span>
          </label>
          <button
            type="button"
            onClick={handleConfirm}
            style={dangerConfirmBtnStyle}
            autoFocus
          >
            Yes, scrub →
          </button>
          <button
            type="button"
            onClick={disarm}
            style={ghostBtnStyle}
          >
            Cancel
          </button>
        </div>
      )}

      {phase === 'running' && (
        <div
          id={progressId}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          style={progressRowStyle}
        >
          <div style={progressBarWrapStyle} aria-hidden="true">
            <div
              style={{
                ...progressBarFillStyle,
                width:
                  progress.total > 0
                    ? `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%`
                    : '8%',
              }}
            />
          </div>
          <span style={progressTextStyle}>
            Anonymizing {progress.done} of {progress.total || '…'} files
          </span>
        </div>
      )}

      {phase === 'done' && result && (
        <div
          role="status"
          aria-live="polite"
          style={doneRowStyle}
        >
          <span style={doneIconStyle} aria-hidden>✓</span>
          <span style={doneTextStyle}>
            Stripped{' '}
            <strong>{result.report.tagsStrippedUnion.length}</strong>{' '}
            PII tags across{' '}
            <strong>{result.report.files}</strong>{' '}
            {result.report.files === 1 ? 'file' : 'files'} ·{' '}
            <span style={doneFilenameStyle}>{result.filename}</span>
          </span>
          {result.report.byFile.some((f) => f.report.selfTestPassed === false) && (
            <p style={warnRowStyle} role="alert">
              ⚠ Self-test flagged residual bytes in one or more files. Inspect MANIFEST.json
              before sharing the ZIP.
            </p>
          )}
        </div>
      )}

      {phase === 'error' && (
        <div role="alert" style={errorRowStyle}>
          <span>⚠ Anonymization failed: <code>{errorMsg}</code></span>
          <button
            type="button"
            onClick={() => {
              setPhase('idle');
              setErrorMsg('');
              triggerBtnRef.current?.focus();
            }}
            style={ghostBtnStyle}
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
//
// Inline objects, matching the rest of the lab/* aesthetic. CSS-var tokens
// from app/globals.css so the dark imaging theme retunes uniformly.

const wrapStyle = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  minHeight: 36,
};

const primaryBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 12px',
  background: 'rgba(95, 221, 168, 0.12)',
  border: '1px solid rgba(95, 221, 168, 0.45)',
  color: '#7AE6BA',
  borderRadius: 8,
  fontSize: '0.78rem',
  fontWeight: 600,
  letterSpacing: 0.1,
  cursor: 'pointer',
  minHeight: 32,
  transition: 'background-color 140ms, border-color 140ms, color 140ms',
};

const iconStyle = {
  fontSize: '0.95rem',
  lineHeight: 1,
};

const confirmRowStyle = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
};

const confirmTextStyle = {
  fontSize: '0.78rem',
  color: 'var(--color-text-muted)',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
};

const dangerConfirmBtnStyle = {
  padding: '7px 12px',
  background: 'rgba(95, 221, 168, 0.18)',
  border: '1px solid rgba(95, 221, 168, 0.55)',
  color: '#7AE6BA',
  borderRadius: 8,
  fontSize: '0.78rem',
  fontWeight: 700,
  cursor: 'pointer',
  minHeight: 32,
};

const ghostBtnStyle = {
  padding: '7px 10px',
  background: 'transparent',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)',
  borderRadius: 8,
  fontSize: '0.74rem',
  cursor: 'pointer',
  minHeight: 32,
};

const checkboxLabelStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: '0.74rem',
  color: 'var(--color-text-muted)',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  cursor: 'pointer',
  userSelect: 'none',
};

const checkboxInputStyle = {
  margin: 0,
  cursor: 'pointer',
  accentColor: '#5FDDA8',
};

const checkboxHintStyle = {
  color: 'var(--color-text-muted)',
  opacity: 0.7,
  fontSize: '0.7rem',
};

const progressRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flex: 1,
  minWidth: 240,
};

const progressBarWrapStyle = {
  flex: '1 1 0',
  height: 4,
  borderRadius: 999,
  background: 'rgba(255, 255, 255, 0.08)',
  overflow: 'hidden',
  minWidth: 120,
};

const progressBarFillStyle = {
  height: '100%',
  background: 'linear-gradient(90deg, #5FDDA8 0%, #5ACCE6 100%)',
  transition: 'width 220ms ease-out',
};

const progressTextStyle = {
  fontSize: '0.74rem',
  color: 'var(--color-text-muted)',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  whiteSpace: 'nowrap',
};

const doneRowStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
};

const doneIconStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 999,
  background: 'rgba(95, 221, 168, 0.18)',
  color: '#7AE6BA',
  fontSize: '0.85rem',
  fontWeight: 700,
};

const doneTextStyle = {
  fontSize: '0.76rem',
  color: 'var(--color-text)',
};

const doneFilenameStyle = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  color: 'var(--color-text-muted)',
  fontSize: '0.7rem',
  overflowWrap: 'anywhere',
};

const warnRowStyle = {
  width: '100%',
  margin: '4px 0 0',
  padding: '6px 8px',
  borderRadius: 6,
  background: 'rgba(255, 165, 107, 0.10)',
  border: '1px solid rgba(255, 165, 107, 0.4)',
  color: '#FFB78F',
  fontSize: '0.72rem',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
};

const errorRowStyle = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  padding: '6px 8px',
  borderRadius: 6,
  background: 'rgba(255, 143, 163, 0.10)',
  border: '1px solid rgba(255, 143, 163, 0.4)',
  color: '#FF8FA3',
  fontSize: '0.74rem',
};
