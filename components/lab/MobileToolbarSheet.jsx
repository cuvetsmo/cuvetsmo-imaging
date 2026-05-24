'use client';
import { useEffect, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// MobileToolbarSheet — Phase 7 bottom-sheet drawer for DICOM viewer tools.
//
// On phone-width viewports (<600px) the viewer toolbar shows only 4 primary
// tools + a "⋯ More" trigger. Tapping the trigger opens this drawer, which
// surfaces every other tool with FULL name + emoji + keyboard hint — the
// abbreviation cram (W/P/Z/M/G) is the antipattern Palm called out.
//
// Pattern A choice rationale (vs Pattern B overflow / Pattern C long-press):
//   - Beginners benefit most from spelled-out names + grouped sections, not
//     hidden overflow they have to discover.
//   - Long-press tooltips alone don't fix the "wait what's G again?" problem
//     when the user is mid-measurement.
//   - Bottom-sheet is the conventional mobile pattern for "more actions"
//     (Material 3 modal bottom sheet) — students recognize it.
//
// A11y:
//   - role="dialog" + aria-modal="true"
//   - Esc closes (handled here, captures so it beats the canvas)
//   - Focus moves to the close button on open, restored on close
//   - Backdrop tap closes
//   - body scroll is locked while open so the drawer doesn't jitter
// ─────────────────────────────────────────────────────────────────────────────

export default function MobileToolbarSheet({
  open,
  onClose,
  activeTool,
  activePreset,
  isStackMode,
  sliceCount,
  sliceIdx,
  paneLabel,
  selectTool,
  applyPreset,
  presets,
  measureTools,
  clearMeasurements,
  goToSlice,
  exportPng,
  toggleFullscreen,
  isFullscreen,
  loadAiJson,
  aiPrediction,
  clearAi,
  openShortcuts,
}) {
  const closeBtnRef = useRef(null);
  const lastFocusRef = useRef(null);

  // Focus + scroll-lock + Esc handler — single effect so cleanup
  // happens atomically on close.
  useEffect(() => {
    if (!open) return undefined;
    lastFocusRef.current =
      typeof document !== 'undefined' ? document.activeElement : null;

    // Defer the focus shift past the open animation so the closing
    // gesture doesn't yank focus mid-render.
    const focusId = requestAnimationFrame(() => {
      closeBtnRef.current?.focus?.();
    });

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      cancelAnimationFrame(focusId);
      window.removeEventListener('keydown', onKey, { capture: true });
      document.body.style.overflow = prevOverflow;
      try {
        lastFocusRef.current?.focus?.();
      } catch {
        /* prior element gone — fine */
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  // Helper to wire any drawer action: invoke handler + dismiss.
  // The drawer is modal, so users expect it to close after a pick;
  // chained edits (e.g. cycle through W/L presets) are a desktop
  // workflow not a mobile one.
  const pick = (fn) => () => {
    fn?.();
    onClose?.();
  };

  // Tool rows — explicit list with full name + emoji + keyboard hint.
  // (Pan/Zoom/WL/Reset live in the primary mobile toolbar, but we still
  // expose Pan + Zoom here too so a returning user who instinctively
  // opens the drawer doesn't go "wait where's Pan".)
  const measureRows = measureTools.map((id) => ({
    id,
    label: id === 'length' ? '📏 Length' : '📐 Angle',
    key: id === 'length' ? 'M' : 'G',
    onClick: pick(() => selectTool(id)),
    active: activeTool === id,
  }));

  const vetRows = [
    {
      id: 'norberg',
      label: '🦴 Norberg angle',
      key: 'N',
      onClick: pick(() => selectTool('norberg')),
      active: activeTool === 'norberg',
    },
    {
      id: 'vhs',
      label: '💗 VHS',
      key: 'V',
      onClick: pick(() => selectTool('vhs')),
      active: activeTool === 'vhs',
    },
  ];

  return (
    <div
      style={backdropStyle}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cuvi-mobile-tools-title"
        onClick={(e) => e.stopPropagation()}
        style={sheetStyle}
      >
        {/* Drag handle — visual affordance only. Pure touch-drag dismiss
            would need a swipe gesture lib; the backdrop tap + Esc + ✕
            already cover dismissal. */}
        <div aria-hidden="true" style={dragHandleStyle} />

        <div style={headerStyle}>
          <h2 id="cuvi-mobile-tools-title" style={titleStyle}>
            More tools
          </h2>
          <button
            type="button"
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="ปิดเมนู"
            style={closeBtnStyle}
          >
            ✕
          </button>
        </div>

        <div style={sectionsScrollStyle}>
          {/* Stack scroll — only shown when we're in a multi-slice study */}
          {isStackMode && sliceCount > 1 && (
            <Section title="Slice navigation">
              <div style={stackRowStyle}>
                <button
                  type="button"
                  onClick={() => goToSlice(sliceIdx - 1)}
                  style={stackBtnStyle}
                  aria-label="Previous slice"
                  title="Previous slice (↑/←)"
                >◀ Prev</button>
                <span
                  style={sliceLabelStyle}
                  aria-live="polite"
                  aria-label={`${paneLabel ? `${paneLabel} pane, ` : ''}Slice ${sliceIdx + 1} of ${sliceCount}`}
                >
                  {paneLabel ? `${paneLabel}: ` : '📚 '}
                  {sliceIdx + 1} / {sliceCount}
                </span>
                <button
                  type="button"
                  onClick={() => goToSlice(sliceIdx + 1)}
                  style={stackBtnStyle}
                  aria-label="Next slice"
                  title="Next slice (↓/→)"
                >Next ▶</button>
              </div>
            </Section>
          )}

          <Section title="Measure">
            <ToolGrid rows={measureRows} />
            <button
              type="button"
              onClick={pick(clearMeasurements)}
              style={fullWidthBtnStyle}
              title="Clear all measurements (C)"
            >
              🗑 Clear all measurements
              <span style={kbdHintStyle}>C</span>
            </button>
          </Section>

          <Section title="Vet tools">
            <ToolGrid rows={vetRows} />
          </Section>

          <Section title="Window / Level">
            <ToolGrid
              rows={presets.map((p, i) => ({
                id: p.id,
                label: p.label,
                key: p.shortcut ? p.shortcut.toUpperCase() : String(i + 1),
                onClick: pick(() => applyPreset(p)),
                active: activePreset === p.id,
                preset: true,
              }))}
            />
          </Section>

          <Section title="Export & view">
            <button
              type="button"
              onClick={pick(exportPng)}
              style={fullWidthBtnStyle}
              title="Export annotated PNG (E)"
            >
              📤 Export annotated PNG
              <span style={kbdHintStyle}>E</span>
            </button>
            <button
              type="button"
              onClick={pick(toggleFullscreen)}
              style={fullWidthBtnStyle}
              title={isFullscreen ? 'Exit fullscreen (F)' : 'Enter fullscreen (F)'}
            >
              {isFullscreen ? '⤢ Exit fullscreen' : '⛶ Fullscreen'}
              <span style={kbdHintStyle}>F</span>
            </button>
          </Section>

          <Section title="AI overlay">
            <label
              style={fullWidthBtnStyle}
              title="Load an AI prediction JSON for this image"
            >
              🤖 Load AI prediction JSON
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) loadAiJson(f);
                  onClose?.();
                }}
                style={{ display: 'none' }}
              />
            </label>
            {aiPrediction && (
              <button
                type="button"
                onClick={pick(clearAi)}
                style={fullWidthBtnStyle}
                title="Clear AI overlay"
              >
                ✕ Clear AI overlay
              </button>
            )}
          </Section>

          <Section title="Help">
            <button
              type="button"
              onClick={pick(openShortcuts)}
              style={fullWidthBtnStyle}
              title="Keyboard shortcuts (?)"
            >
              ⌨ Keyboard shortcuts
              <span style={kbdHintStyle}>?</span>
            </button>
          </Section>
        </div>
      </div>
    </div>
  );
}

// Small section wrapper with a sticky-feel section header.
function Section({ title, children }) {
  return (
    <section style={sectionStyle}>
      <h3 style={sectionTitleStyle}>{title}</h3>
      {children}
    </section>
  );
}

// 2-column tool grid. Renders a single button per row item; active gets
// cyan ring (consistent with the primary toolbar's TBtn).
function ToolGrid({ rows }) {
  return (
    <div style={gridStyle}>
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={r.onClick}
          aria-pressed={r.preset ? !!r.active : undefined}
          style={r.active ? toolGridBtnActiveStyle : toolGridBtnStyle}
          title={r.label}
        >
          <span style={toolGridLabelStyle}>{r.label}</span>
          {r.key && <span style={kbdHintStyle}>{r.key}</span>}
        </button>
      ))}
    </div>
  );
}

// ─── inline styles (no Tailwind dependency · self-contained) ───────────────

const backdropStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 95,
  background: 'rgba(0, 0, 0, 0.55)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  // Backdrop fades in via a single animation; the sheet uses the same
  // class. Both registered below.
  animation: 'cuvi-sheet-fade-in 160ms ease-out',
};

const sheetStyle = {
  width: '100%',
  maxWidth: 480,
  maxHeight: '78vh',
  background: 'var(--color-surface-2)',
  borderTopLeftRadius: 18,
  borderTopRightRadius: 18,
  borderTop: '1px solid var(--color-border-bright)',
  boxShadow: '0 -12px 36px rgba(0, 0, 0, 0.45)',
  padding: '8px 16px 24px',
  color: 'var(--color-text)',
  display: 'flex',
  flexDirection: 'column',
  animation: 'cuvi-sheet-slide-up 200ms ease-out',
};

const dragHandleStyle = {
  width: 36,
  height: 4,
  borderRadius: 999,
  background: 'var(--color-border-bright)',
  margin: '6px auto 8px',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 8,
};

const titleStyle = {
  fontSize: 16,
  fontWeight: 600,
  margin: 0,
  letterSpacing: '-0.01em',
};

const closeBtnStyle = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: '1px solid var(--color-border-bright)',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
};

const sectionsScrollStyle = {
  overflowY: 'auto',
  paddingBottom: 8,
};

const sectionStyle = {
  marginTop: 10,
};

const sectionTitleStyle = {
  fontSize: 11,
  fontWeight: 600,
  margin: '0 0 6px',
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontFamily: 'ui-monospace, monospace',
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 6,
};

const toolGridBtnBase = {
  minHeight: 44,
  padding: '8px 12px',
  borderRadius: 6,
  cursor: 'pointer',
  textAlign: 'left',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
  fontSize: 14,
  fontFamily: 'inherit',
};

const toolGridBtnStyle = {
  ...toolGridBtnBase,
  background: 'var(--color-surface-lift)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border-bright)',
};

const toolGridBtnActiveStyle = {
  ...toolGridBtnBase,
  background: 'rgba(90, 204, 230, 0.18)',
  color: 'var(--color-tool-cyan)',
  border: '1px solid var(--color-tool-cyan)',
  boxShadow: '0 0 0 2px rgba(90, 204, 230, 0.18)',
};

const toolGridLabelStyle = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const kbdHintStyle = {
  display: 'inline-block',
  minWidth: 18,
  padding: '1px 5px',
  borderRadius: 4,
  background: 'var(--color-bg)',
  color: 'var(--color-text-muted)',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 11,
  lineHeight: 1.4,
  border: '1px solid var(--color-border)',
  textAlign: 'center',
};

const fullWidthBtnStyle = {
  ...toolGridBtnBase,
  marginTop: 6,
  width: '100%',
  background: 'var(--color-surface-lift)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border-bright)',
};

const stackRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const stackBtnStyle = {
  flex: '0 0 auto',
  minHeight: 44,
  padding: '8px 14px',
  borderRadius: 6,
  background: 'var(--color-surface-lift)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border-bright)',
  cursor: 'pointer',
  fontSize: 14,
  fontFamily: 'inherit',
};

const sliceLabelStyle = {
  flex: 1,
  textAlign: 'center',
  fontSize: 13,
  color: 'var(--color-tool-cyan)',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};

// One-time keyframe registration. We register on the module level so
// every viewport that mounts the sheet shares the same animation
// definitions (no duplicate <style> tags).
if (
  typeof document !== 'undefined' &&
  !document.getElementById('cuvi-mobile-sheet-keyframes')
) {
  const s = document.createElement('style');
  s.id = 'cuvi-mobile-sheet-keyframes';
  s.textContent =
    '@keyframes cuvi-sheet-fade-in { from { opacity: 0; } to { opacity: 1; } } ' +
    '@keyframes cuvi-sheet-slide-up { from { transform: translateY(16px); opacity: 0.6; } to { transform: translateY(0); opacity: 1; } }';
  document.head.appendChild(s);
}
