'use client';
import { useEffect, useRef } from 'react';

// Keyboard cheatsheet overlay — listed in the brief as:
//   - floating card, top-right of viewport
//   - backdrop-blur background
//   - 2-column grid (key · action)
//   - dismissable via Esc, click-outside, close button, or `?` toggle
//
// Self-contained: parent only manages `open` + `onClose`. Esc handling
// is local (so parent doesn't need an extra useEffect just for this);
// the parent's global `?` keyup still toggles via state.
export default function ShortcutCheatsheet({ open, onClose, sections }) {
  const cardRef = useRef(null);
  const lastFocusRef = useRef(null);

  // Esc-to-close + restore focus when overlay closes. Bound on
  // window so it works regardless of focus inside the overlay.
  useEffect(() => {
    if (!open) return;
    lastFocusRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    // Move focus to close button on open for keyboard accessibility.
    requestAnimationFrame(() => {
      const btn = cardRef.current?.querySelector('[data-cheatsheet-close]');
      btn?.focus?.();
    });
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      // Return focus to whatever opened the overlay (toolbar button
      // or wherever the `?` keypress was issued from).
      try { lastFocusRef.current?.focus?.(); } catch { /* element gone */ }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={backdropStyle}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        ref={cardRef}
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={headerStyle}>
          <strong style={{ fontSize: '0.95rem' }}>⌨ Keyboard shortcuts</strong>
          <button
            data-cheatsheet-close
            onClick={onClose}
            style={closeBtnStyle}
            aria-label="ปิด cheatsheet"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {sections.map((sec) => (
          <div key={sec.title} style={{ marginBottom: 12 }}>
            <div style={sectionTitleStyle}>{sec.title}</div>
            <div style={gridStyle}>
              {sec.rows.map((row) => (
                <Row key={`${sec.title}-${row.key}`} k={row.key} desc={row.desc} />
              ))}
            </div>
          </div>
        ))}

        <div style={footerStyle}>
          กด <kbd style={kbdInline}>?</kbd> เปิด/ปิด · <kbd style={kbdInline}>Esc</kbd> ปิด ·
          shortcut ทำงานเมื่อโฟกัสไม่ได้อยู่ใน input/textarea
        </div>
      </div>
    </div>
  );
}

function Row({ k, desc }) {
  return (
    <>
      <div style={keyCellStyle}>
        <kbd style={kbdStyle}>{k}</kbd>
      </div>
      <div style={descCellStyle}>{desc}</div>
    </>
  );
}

// --- styles -----------------------------------------------------

const backdropStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.32)',
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  display: 'flex',
  // Brief says "top-right of viewport". Use flex alignment so the
  // card pins to the upper-right of the visible viewport area while
  // still allowing the backdrop to absorb click-outside.
  alignItems: 'flex-start',
  justifyContent: 'flex-end',
  paddingTop: 'clamp(16px, 6vh, 80px)',
  paddingRight: 'clamp(12px, 4vw, 36px)',
  zIndex: 2000,
};

const cardStyle = {
  background: 'rgba(255,255,255,0.97)',
  borderRadius: 10,
  padding: '14px 16px',
  width: 'min(420px, 92vw)',
  maxHeight: '82vh',
  overflowY: 'auto',
  boxShadow: '0 10px 38px rgba(0,0,0,0.32), 0 0 0 1px rgba(0,0,0,0.06)',
  // Subtle inner ring matches OHIF-dark theme accent without breaking
  // the bright dialog (chosen so the cheatsheet reads against a dark
  // canvas).
  outline: '1px solid rgba(8, 145, 178, 0.22)',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 12,
  paddingBottom: 8,
  borderBottom: '1px solid #eee',
};

const closeBtnStyle = {
  width: 28,
  height: 28,
  border: '1px solid #ccc',
  background: '#fff',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.9rem',
  lineHeight: 1,
  padding: 0,
};

const sectionTitleStyle = {
  fontSize: '0.72rem',
  fontWeight: 600,
  color: '#0891b2', // cyan-600 — matches the active-preset ring
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 6,
};

const gridStyle = {
  display: 'grid',
  // 2-column key+action layout per brief
  gridTemplateColumns: 'minmax(72px, auto) 1fr',
  rowGap: 4,
  columnGap: 10,
  fontSize: '0.82rem',
};

const keyCellStyle = {
  display: 'flex',
  alignItems: 'center',
  paddingRight: 4,
};

const descCellStyle = {
  display: 'flex',
  alignItems: 'center',
  color: '#374151',
  lineHeight: 1.35,
};

const footerStyle = {
  fontSize: '0.7rem',
  color: '#6b7280',
  marginTop: 6,
  paddingTop: 8,
  borderTop: '1px solid #eee',
  lineHeight: 1.5,
};

const kbdStyle = {
  display: 'inline-block',
  padding: '2px 8px',
  background: '#f4f4f4',
  border: '1px solid #d4d4d4',
  borderRadius: 4,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.75rem',
  color: '#1f2937',
  lineHeight: 1.4,
  minWidth: 22,
  textAlign: 'center',
};

const kbdInline = {
  display: 'inline-block',
  padding: '0 5px',
  background: '#fff',
  color: '#1f2937',
  border: '1px solid #d4d4d4',
  borderRadius: 3,
  fontFamily: 'ui-monospace, monospace',
  fontSize: '0.7rem',
  lineHeight: 1.3,
};
