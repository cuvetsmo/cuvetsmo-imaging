'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';

// CaseLibraryLocal — case-listing grid for the dark imaging.cuvetsmo.com theme.
//
// 2026-05-20 rewrite: the original component was a copy-paste of VetMock's
// white-theme CaseLibrary. White card-backgrounds + #666 muted text against
// the dark page made body text invisible (white-on-white). Palm flagged it
// as "ตัวหนังสือมองไม่เห็น" — fixed by swapping every inline color to a
// CSS custom property from `app/globals.css` (--color-surface-2, --color-
// text-muted, --color-tool-cyan, etc.).
//
// Reads from a static JSON case list at `/cases.json` (fetched at runtime
// so cases can be added without a rebuild via the prebuild sync script).

function modalityToKey(modality) {
  if (!modality) return 'other';
  const M = String(modality).toUpperCase().trim();
  if (['DX', 'CR', 'RG', 'RF', 'MG', 'PX', 'DR'].includes(M)) return 'xray';
  if (M === 'CT') return 'ct';
  if (M === 'MR') return 'mri';
  if (M === 'US') return 'us';
  return 'other';
}

const MODALITY_TABS = [
  { k: 'all',   label: 'All',         icon: '📚' },
  { k: 'xray',  label: 'X-ray',       icon: '🦴' },
  { k: 'ct',    label: 'CT',          icon: '🧠' },
  { k: 'mri',   label: 'MRI',         icon: '🧲' },
  { k: 'us',    label: 'Ultrasound',  icon: '🌊' },
  { k: 'other', label: 'Other',       icon: '❓' },
];

// Modality badge colors — kept semantically distinct but desaturated for
// dark-theme cohesion (no eye-stab saturation on the dark panels).
function modalityBadgeStyle(k) {
  const palette = {
    xray:  { bg: 'rgba(90, 204, 230, 0.16)',  border: 'rgba(90, 204, 230, 0.42)',  fg: '#7DDCEF' },
    ct:    { bg: 'rgba(255, 154, 90, 0.14)',  border: 'rgba(255, 154, 90, 0.38)',  fg: '#FFA56B' },
    mri:   { bg: 'rgba(167, 139, 250, 0.16)', border: 'rgba(167, 139, 250, 0.42)', fg: '#B7A2FF' },
    us:    { bg: 'rgba(52, 211, 153, 0.14)',  border: 'rgba(52, 211, 153, 0.38)',  fg: '#5FDDA8' },
    other: { bg: 'rgba(255, 255, 255, 0.06)', border: 'rgba(255, 255, 255, 0.18)', fg: 'var(--color-text-muted)' },
  };
  const c = palette[k] || palette.other;
  return {
    fontSize: '0.66rem',
    padding: '2px 7px',
    color: c.fg,
    background: c.bg,
    border: `1px solid ${c.border}`,
    borderRadius: 999,
    whiteSpace: 'nowrap',
    fontWeight: 600,
    letterSpacing: 0.1,
  };
}

// Difficulty badges — same shape, different semantic colors.
function difficultyBadgeStyle(d) {
  if (d === 'advanced') {
    return {
      fontSize: '0.66rem', padding: '2px 7px', color: '#FF8FA3',
      background: 'rgba(255, 77, 109, 0.14)', border: '1px solid rgba(255, 77, 109, 0.38)',
      borderRadius: 999, whiteSpace: 'nowrap', fontWeight: 600,
    };
  }
  if (d === 'intro') {
    return {
      fontSize: '0.66rem', padding: '2px 7px', color: '#5FDDA8',
      background: 'rgba(52, 211, 153, 0.12)', border: '1px solid rgba(52, 211, 153, 0.34)',
      borderRadius: 999, whiteSpace: 'nowrap', fontWeight: 600,
    };
  }
  // intermediate / unknown
  return {
    fontSize: '0.66rem', padding: '2px 7px', color: 'var(--color-text-muted)',
    background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.14)',
    borderRadius: 999, whiteSpace: 'nowrap', fontWeight: 600,
  };
}

function modalityShortLabel(k) {
  return MODALITY_TABS.find((t) => t.k === k)?.label || 'other';
}

export default function CaseLibraryLocal() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalityFilter, setModalityFilter] = useState(() => {
    if (typeof window === 'undefined') return 'all';
    try { return localStorage.getItem('cuvi-modality-filter') || 'all'; } catch { return 'all'; }
  });

  const onSetModalityFilter = useCallback((k) => {
    setModalityFilter(k);
    try { localStorage.setItem('cuvi-modality-filter', k); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/cases.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setCases(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) {
          // Missing /cases.json = empty library, not an error
          if (/HTTP 404/.test(e?.message || '')) setCases([]);
          else setError(e?.message || String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (modalityFilter === 'all') return cases;
    return cases.filter((c) => modalityToKey(c.modality) === modalityFilter);
  }, [cases, modalityFilter]);

  const counts = useMemo(() => {
    const c = { all: cases.length, xray: 0, ct: 0, mri: 0, us: 0, other: 0 };
    for (const cs of cases) c[modalityToKey(cs.modality)]++;
    return c;
  }, [cases]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-[var(--color-text)] m-0">📚 Case library</h2>
        <Link href="/" className="text-sm text-[var(--color-tool-cyan)] hover:text-[#7DDCEF] underline underline-offset-4">
          ← back to lab
        </Link>
      </div>

      {loading && (
        <div style={gridStyle}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                ...cardStyle,
                height: 180,
                animation: 'cuvi-skel-pulse 1.4s ease-in-out infinite',
                animationDelay: `${i * 0.12}s`,
              }}
            >
              <div style={skelLineLg} />
              <div style={skelLineMd} />
              <div style={{ ...skelLineMd, width: '70%', marginBottom: 16 }} />
              <div style={skelLineBlock} />
            </div>
          ))}
        </div>
      )}

      {error && <div style={errorStyle}>โหลดไม่สำเร็จ — {error}</div>}

      {!loading && !error && cases.length > 0 && (
        <div style={tabRowStyle}>
          {MODALITY_TABS.map((t) => {
            const count = counts[t.k] || 0;
            const isActive = modalityFilter === t.k;
            const isEmpty = count === 0 && t.k !== 'all';
            return (
              <button
                key={t.k}
                onClick={() => onSetModalityFilter(t.k)}
                disabled={isEmpty}
                style={{
                  ...tabBtnStyle,
                  ...(isActive ? tabBtnActiveStyle : {}),
                  ...(isEmpty ? tabBtnEmptyStyle : {}),
                }}
                title={isEmpty ? `ยังไม่มี ${t.label} case` : `${t.label} (${count} case)`}
              >
                <span aria-hidden style={{ marginRight: 4 }}>{t.icon}</span>
                {t.label}
                <span style={{ opacity: 0.65, fontSize: '0.85em', marginLeft: 5 }}>({count})</span>
              </button>
            );
          })}
        </div>
      )}

      {!loading && !error && cases.length === 0 && (
        <div style={emptyStyle}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>📭</div>
          <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>ยังไม่มี public case ใน library</div>
          <div style={{ fontSize: '0.82rem', marginTop: 12, color: 'var(--color-text-muted)', lineHeight: 1.6, maxWidth: 520, margin: '12px auto 0' }}>
            ลาก DICOM ของตัวเองได้ที่หน้า{' '}
            <Link href="/" style={{ color: 'var(--color-tool-cyan)', textDecoration: 'underline' }}>Imaging Lab</Link>
            {' '}หรือ seed สาธารณะ: วาง <code style={codeStyle}>.dcm</code> ที่ <code style={codeStyle}>public/cases/&lt;slug&gt;/</code> แล้วแก้ <code style={codeStyle}>public/cases.json</code> เพื่อ register case ใหม่
          </div>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div style={gridStyle}>
          {filtered.map((c) => (
            <CaseCard key={c.id} caseData={c} />
          ))}
        </div>
      )}

      {!loading && !error && cases.length > 0 && filtered.length === 0 && (
        <div style={emptyStyle}>
          <div style={{ fontSize: '2rem', marginBottom: 6 }}>📭</div>
          <div style={{ color: 'var(--color-text)' }}>
            ยังไม่มี <strong>{modalityShortLabel(modalityFilter)}</strong> case ใน library
          </div>
        </div>
      )}
    </div>
  );
}

function CaseCard({ caseData }) {
  return (
    <div style={cardStyle} className="hover:border-[var(--color-border-tool)] transition-colors">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '0.95rem', fontWeight: 600, flex: '1 1 60%', minWidth: 0, color: 'var(--color-text)', letterSpacing: '-0.01em' }}>
          {caseData.title}
        </h3>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {caseData.modality && (
            <span style={modalityBadgeStyle(modalityToKey(caseData.modality))}>
              {MODALITY_TABS.find((t) => t.k === modalityToKey(caseData.modality))?.icon}{' '}
              {modalityShortLabel(modalityToKey(caseData.modality))}
            </span>
          )}
          {caseData.difficulty && (
            <span style={difficultyBadgeStyle(caseData.difficulty)}>
              {caseData.difficulty}
            </span>
          )}
        </div>
      </div>
      <p style={metaLineStyle}>
        {[caseData.species, caseData.signalment, caseData.body_part].filter(Boolean).join(' · ')}
      </p>
      {caseData.history && (
        <p style={descLineStyle}>{caseData.history}</p>
      )}
      {caseData.learning_objectives?.length > 0 && (
        <ul style={objListStyle}>
          {caseData.learning_objectives.slice(0, 3).map((obj, i) => <li key={i}>{obj}</li>)}
        </ul>
      )}
      {(caseData.license || caseData.source_url) && (
        <div style={licenseRowStyle}>
          {caseData.license && <span>📜 {caseData.license}</span>}
          {caseData.source_url && caseData.source_url !== 'internal' && (
            <>
              <span aria-hidden style={{ opacity: 0.6 }}>·</span>
              <a
                href={caseData.source_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--color-tool-cyan)', textDecoration: 'underline', textUnderlineOffset: 2 }}
              >
                source ↗
              </a>
            </>
          )}
        </div>
      )}
      <Link
        href={`/cases/${caseData.slug || caseData.id}`}
        style={openCaseBtnStyle}
        className="hover:bg-[#7DDCEF]"
      >
        เปิด case →
      </Link>
    </div>
  );
}

// Inject skeleton keyframes once
if (typeof document !== 'undefined' && !document.getElementById('cuvi-skel-keyframes')) {
  const s = document.createElement('style');
  s.id = 'cuvi-skel-keyframes';
  s.textContent = '@keyframes cuvi-skel-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 0.9; } }';
  document.head.appendChild(s);
}

// ── Dark-theme style atoms ─────────────────────────────────────────────────

const errorStyle = {
  padding: '12px 16px',
  background: 'rgba(255, 77, 109, 0.10)',
  border: '1px solid rgba(255, 77, 109, 0.32)',
  borderRadius: 8,
  color: '#FF8FA3',
  fontSize: '0.85rem',
};

const emptyStyle = {
  padding: 36,
  textAlign: 'center',
  background: 'var(--color-surface-2)',
  border: '1px dashed var(--color-border-bright)',
  borderRadius: 12,
  color: 'var(--color-text-muted)',
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 12,
};

const cardStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  padding: 16,
  background: 'var(--color-surface-2)',
  display: 'flex',
  flexDirection: 'column',
};

const tabRowStyle = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  marginBottom: 14,
  paddingBottom: 10,
  borderBottom: '1px solid var(--color-border)',
};

const tabBtnStyle = {
  padding: '6px 12px',
  background: 'var(--color-surface-2)',
  color: 'var(--color-text-muted)',
  border: '1px solid var(--color-border-bright)',
  borderRadius: 999,
  cursor: 'pointer',
  fontSize: '0.8rem',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  minHeight: 32,
  display: 'inline-flex',
  alignItems: 'center',
  transition: 'border-color 140ms, color 140ms, background-color 140ms',
};

const tabBtnActiveStyle = {
  background: 'var(--color-tool-cyan)',
  color: '#06070A',
  borderColor: 'var(--color-tool-cyan)',
  fontWeight: 600,
};

// Disabled tabs: keep readable (0.7 not 0.45) — Palm flagged old 0.45 made
// them effectively invisible against the dark page bg.
const tabBtnEmptyStyle = {
  opacity: 0.7,
  cursor: 'not-allowed',
  color: 'var(--color-text-muted)',
  background: 'transparent',
  borderStyle: 'dashed',
};

const metaLineStyle = {
  margin: '0 0 6px',
  fontSize: '0.78rem',
  color: 'var(--color-text-muted)',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  letterSpacing: 0.1,
};

const descLineStyle = {
  margin: '6px 0',
  fontSize: '0.82rem',
  color: 'var(--color-text)',
  lineHeight: 1.55,
};

const objListStyle = {
  margin: '6px 0 10px',
  paddingLeft: 18,
  fontSize: '0.76rem',
  color: 'var(--color-text-muted)',
  lineHeight: 1.55,
};

const licenseRowStyle = {
  margin: '6px 0 10px',
  padding: '6px 10px',
  background: 'rgba(255, 255, 255, 0.025)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  fontSize: '0.7rem',
  color: 'var(--color-text-muted)',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
};

const codeStyle = {
  background: 'rgba(90, 204, 230, 0.10)',
  color: 'var(--color-tool-cyan)',
  padding: '1px 5px',
  borderRadius: 3,
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: '0.92em',
};

const openCaseBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  width: '100%',
  marginTop: 'auto',
  padding: '9px 12px',
  borderRadius: 8,
  background: 'var(--color-tool-cyan)',
  color: '#06070A',
  fontSize: '0.85rem',
  fontWeight: 600,
  textAlign: 'center',
  textDecoration: 'none',
  letterSpacing: '-0.005em',
  transition: 'background-color 140ms',
};

const skelLineLg = {
  height: 14, width: '60%',
  background: 'var(--color-border-bright)',
  borderRadius: 4, marginBottom: 8,
};
const skelLineMd = {
  height: 10, width: '85%',
  background: 'var(--color-border)',
  borderRadius: 4, marginBottom: 6,
};
const skelLineBlock = {
  height: 36, width: '100%',
  background: 'var(--color-border-bright)',
  borderRadius: 6,
};
