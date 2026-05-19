'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';

// CaseLibraryLocal — lifted-and-shifted CaseLibrary minus the Supabase
// data source. Reads from a static JSON case list at `/cases.json`
// (fetched at runtime so Palm can update without a rebuild). Each case
// points at .dcm files under /public/cases/. Falls back to a guided
// empty state when no cases are registered yet.

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

const badgeBase = {
  fontSize: '0.65rem',
  padding: '2px 6px',
  color: '#fff',
  borderRadius: 3,
  whiteSpace: 'nowrap',
  fontWeight: 600,
};

function modalityBadgeStyle(k) {
  const bg = { xray: '#5a7ba8', ct: '#a86b5a', mri: '#7a5aa8', us: '#5aa87a', other: '#888' }[k] || '#888';
  return { ...badgeBase, background: bg };
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1.15rem', margin: 0 }}>📚 Case library</h2>
        <Link href="/" className="text-sm text-sky-700 hover:text-sky-900 underline underline-offset-4">← back to lab</Link>
      </div>

      {loading && (
        <div style={gridStyle}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ ...cardStyle, height: 180, animation: 'cuvi-skel-pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.12}s` }}>
              <div style={{ height: 14, width: '60%', background: '#e8e8e8', borderRadius: 3, marginBottom: 8 }} />
              <div style={{ height: 10, width: '85%', background: '#eee', borderRadius: 3, marginBottom: 6 }} />
              <div style={{ height: 10, width: '70%', background: '#eee', borderRadius: 3, marginBottom: 16 }} />
              <div style={{ height: 32, width: '100%', background: '#e8e8e8', borderRadius: 4 }} />
            </div>
          ))}
        </div>
      )}

      {error && <div style={errorStyle}>โหลดไม่สำเร็จ: {error}</div>}

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
                {t.icon} {t.label} <span style={{ opacity: 0.7, fontSize: '0.85em' }}>({count})</span>
              </button>
            );
          })}
        </div>
      )}

      {!loading && !error && cases.length === 0 && (
        <div style={emptyStyle}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>📭</div>
          <div style={{ fontWeight: 600 }}>ยังไม่มี public case ใน standalone build</div>
          <div style={{ fontSize: '0.82rem', marginTop: 12, color: '#666', lineHeight: 1.6, maxWidth: 520, margin: '12px auto 0' }}>
            ลาก DICOM ของตัวเองได้ที่หน้า{' '}
            <Link href="/" style={{ color: '#0369a1', textDecoration: 'underline' }}>Imaging Lab</Link> หรือ
            seed สาธารณะ: วาง <code>.dcm</code> ที่ <code>public/cases/&lt;slug&gt;/</code> +
            แก้ <code>public/cases.json</code> เพื่อ register case ใหม่.
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
          <div>ยังไม่มี <strong>{modalityShortLabel(modalityFilter)}</strong> case ใน library</div>
        </div>
      )}
    </div>
  );
}

function CaseCard({ caseData }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '0.95rem', flex: '1 1 60%', minWidth: 0 }}>{caseData.title}</h3>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {caseData.modality && (
            <span style={modalityBadgeStyle(modalityToKey(caseData.modality))}>
              {MODALITY_TABS.find((t) => t.k === modalityToKey(caseData.modality))?.icon}{' '}
              {modalityShortLabel(modalityToKey(caseData.modality))}
            </span>
          )}
          {caseData.difficulty && (
            <span style={{ ...badgeBase, background: caseData.difficulty === 'advanced' ? '#c0392b' : caseData.difficulty === 'intro' ? '#4a6b4a' : '#888' }}>
              {caseData.difficulty}
            </span>
          )}
        </div>
      </div>
      <p style={{ margin: '4px 0', fontSize: '0.78rem', color: '#666' }}>
        {[caseData.species, caseData.signalment, caseData.body_part].filter(Boolean).join(' · ')}
      </p>
      {caseData.history && (
        <p style={{ margin: '6px 0', fontSize: '0.78rem', color: '#555' }}>{caseData.history}</p>
      )}
      {caseData.learning_objectives?.length > 0 && (
        <ul style={{ margin: '6px 0 8px', paddingLeft: 18, fontSize: '0.75rem', color: '#666' }}>
          {caseData.learning_objectives.slice(0, 3).map((obj, i) => <li key={i}>{obj}</li>)}
        </ul>
      )}
      {(caseData.license || caseData.source_url) && (
        <div style={licenseRowStyle}>
          {caseData.license && <span>📜 {caseData.license}</span>}
          {caseData.source_url && caseData.source_url !== 'internal' && (
            <> · <a href={caseData.source_url} target="_blank" rel="noopener noreferrer" style={{ color: '#0369a1', textDecoration: 'underline' }}>source ↗</a></>
          )}
        </div>
      )}
      <Link
        href={`/cases/${caseData.slug || caseData.id}`}
        className="inline-block w-full mt-2 px-3 py-2 rounded bg-sky-700 hover:bg-sky-800 text-white text-sm font-medium text-center"
      >
        เปิด case
      </Link>
    </div>
  );
}

// Inject skeleton keyframes once
if (typeof document !== 'undefined' && !document.getElementById('cuvi-skel-keyframes')) {
  const s = document.createElement('style');
  s.id = 'cuvi-skel-keyframes';
  s.textContent = '@keyframes cuvi-skel-pulse { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }';
  document.head.appendChild(s);
}

const errorStyle = { padding: '12px 16px', background: '#fff5f5', border: '1px solid #fcc', borderRadius: 6, color: '#a33', fontSize: '0.85rem' };
const emptyStyle = { padding: 36, textAlign: 'center', color: '#666', background: '#fafafa', border: '1px dashed #ccc', borderRadius: 8 };
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 };
const cardStyle = { border: '1px solid #ddd', borderRadius: 8, padding: 14, background: '#fff' };
const tabRowStyle = { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, padding: '6px 0', borderBottom: '1px solid #eee' };
const tabBtnStyle = { padding: '6px 12px', background: '#fff', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem', whiteSpace: 'nowrap', minHeight: 32 };
const tabBtnActiveStyle = { background: '#0369a1', color: '#fff', borderColor: '#075985' };
const tabBtnEmptyStyle = { opacity: 0.45, cursor: 'not-allowed' };
const licenseRowStyle = { margin: '6px 0', padding: '6px 8px', background: '#f8f8f8', borderRadius: 4, fontSize: '0.7rem', color: '#666', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 };
