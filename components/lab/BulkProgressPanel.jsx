'use client';
import { useEffect, useState } from 'react';

/**
 * Bulk-import progress panel — mounted while a folder/zip/multi-file
 * import is being discovered + parsed.
 *
 * Architecture decisions:
 *  - role="status" + aria-live="polite" so screen readers announce the
 *    phase changes ("Discovering files", "Parsing 12 of 47").
 *  - ESC cancels the in-flight import (signal lives on the parent).
 *  - Clicking outside DOES NOT cancel — we don't want a stray click on
 *    the page to wipe out a 5-minute folder traversal.
 *  - Not technically modal (no backdrop), but `pointer-events: none`
 *    on the rest of the page is overkill for our scale. We rely on
 *    the parent flipping a `parsing` state guard to ignore new drops.
 *  - The progress bar is REAL — driven by `progress.filesFound /
 *    progress.filesTotal` counts that the bulk-import library reports
 *    from actual parse callbacks. No faked smooth animation.
 *  - We DO NOT show a per-file checkmark scroll list. With 5000-file
 *    batches that would explode the DOM and force a virtual list.
 *    Instead we show the current source (filename being processed)
 *    and a running counter. The Study tree below will show the
 *    organized result once parse completes.
 */
export default function BulkProgressPanel({ progress, onCancel }) {
  // Pulse phase — driven by setInterval so we don't need to touch
  // globals.css with @keyframes. Toggles dot opacity to give visual
  // confirmation that work is in flight. Cleared on unmount.
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (!progress) return undefined;
    const id = setInterval(() => setPulse((p) => !p), 700);
    return () => clearInterval(id);
  }, [progress]);

  // ESC handler — wire keydown listener at the document level so it
  // works regardless of focus. Removed on unmount.
  useEffect(() => {
    if (!progress) return undefined;
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel?.();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [progress, onCancel]);

  if (!progress) return null;

  const phaseLabel = PHASE_LABEL[progress.phase] || progress.phase;
  const total = progress.filesTotal || 0;
  const found = progress.filesFound || 0;
  const pct = total > 0 ? Math.min(100, Math.round((found / total) * 100)) : 0;
  // When we don't yet know the total (folder traversal in flight),
  // render an indeterminate striped bar instead of a width-0 bar
  // (which reads as "stuck").
  const indeterminate = total === 0 || progress.phase === 'discovering' || progress.phase === 'unzipping';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      aria-label="กำลัง import DICOM files"
      style={panelStyle}
      data-testid="bulk-progress-panel"
    >
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              ...dotStyle,
              opacity: pulse ? 0.45 : 1,
              transition: 'opacity 0.65s ease-in-out',
            }}
          />
          <strong style={{ color: 'var(--color-text)', fontSize: '0.92rem' }}>
            {phaseLabel}
          </strong>
          {total > 0 && (
            <span style={countStyle}>
              {found} / {total}
            </span>
          )}
          {total === 0 && found > 0 && (
            <span style={countStyle}>{found} found</span>
          )}
        </div>
        <button
          type="button"
          onClick={onCancel}
          style={cancelBtnStyle}
          aria-label="ยกเลิกการ import (ESC)"
        >
          Cancel · ESC
        </button>
      </div>

      <div style={barOuterStyle}>
        {indeterminate ? (
          <div
            aria-hidden
            style={{
              ...barIndeterminateStyle,
              // Slide between 8% and 60% left position to suggest activity
              // without needing @keyframes. Driven by the pulse boolean.
              left: pulse ? '60%' : '8%',
              transition: 'left 0.65s ease-in-out',
            }}
          />
        ) : (
          <div style={{ ...barFillStyle, width: `${pct}%` }} aria-hidden />
        )}
      </div>

      {progress.currentSource && (
        <div style={sourceStyle} title={progress.currentSource}>
          <span style={{ color: 'var(--color-text-faint)' }}>processing:</span>{' '}
          <span style={{ color: 'var(--color-text-muted)' }}>{truncate(progress.currentSource, 80)}</span>
        </div>
      )}

      {progress.phase === 'error' && (
        <p style={errorStyle}>เกิดข้อผิดพลาด — กดยกเลิกแล้วลองใหม่</p>
      )}

      <p style={hintStyle}>
        การ render เกิดในเบราว์เซอร์เท่านั้น · ไม่ส่งภาพขึ้น server
      </p>
    </div>
  );
}

const PHASE_LABEL = {
  discovering: 'กำลังสำรวจไฟล์',
  unzipping: 'กำลังแตกไฟล์ ZIP',
  parsing: 'กำลังอ่าน DICOM tags',
  organizing: 'กำลังจัด studies / series',
  done: 'เสร็จแล้ว',
  error: 'มีข้อผิดพลาด',
};

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  if (s.length <= n) return s;
  return '…' + s.slice(s.length - (n - 1));
}

// ─── styles ───────────────────────────────────────────────────────────────

const panelStyle = {
  position: 'fixed',
  bottom: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 60,
  width: 'min(560px, calc(100vw - 24px))',
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  padding: '14px 16px',
  boxShadow: '0 12px 36px -10px rgba(0,0,0,0.5)',
  // Mobile-first: never bleed past viewport at 375px
  boxSizing: 'border-box',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 10,
  flexWrap: 'wrap',
};

const dotStyle = {
  width: 8,
  height: 8,
  borderRadius: 999,
  background: 'var(--color-tool-cyan, #5ACCE6)',
  boxShadow: '0 0 8px var(--color-tool-cyan, #5ACCE6)',
  flexShrink: 0,
};

const countStyle = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: '0.78rem',
  color: 'var(--color-text-muted)',
  marginLeft: 'auto',
};

const cancelBtnStyle = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: '0.72rem',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  background: 'transparent',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  padding: '4px 10px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const barOuterStyle = {
  position: 'relative',
  width: '100%',
  height: 6,
  background: 'var(--color-surface-3, #1a1a1a)',
  borderRadius: 999,
  overflow: 'hidden',
  marginBottom: 10,
};

const barFillStyle = {
  height: '100%',
  background: 'linear-gradient(96deg, var(--color-tool-cyan, #5ACCE6) 0%, var(--color-tool-violet, #A78BFA) 100%)',
  borderRadius: 999,
  transition: 'width 0.18s ease-out',
};

const barIndeterminateStyle = {
  position: 'absolute',
  top: 0,
  height: '100%',
  width: '32%',
  background:
    'linear-gradient(90deg, transparent 0%, var(--color-tool-cyan, #5ACCE6) 30%, var(--color-tool-violet, #A78BFA) 70%, transparent 100%)',
  borderRadius: 999,
};

const sourceStyle = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: '0.72rem',
  color: 'var(--color-text-muted)',
  marginBottom: 6,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const hintStyle = {
  fontSize: '0.7rem',
  color: 'var(--color-text-faint)',
  marginTop: 4,
  marginBottom: 0,
};

const errorStyle = {
  fontSize: '0.78rem',
  color: 'var(--color-active-red, #f87171)',
  marginTop: 6,
  marginBottom: 4,
};
