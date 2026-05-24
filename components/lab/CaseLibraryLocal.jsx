'use client';
import { useEffect, useMemo, useState, useCallback, useDeferredValue, useRef, useId } from 'react';
import Link from 'next/link';

// CaseLibraryLocal — case-listing grid for the dark imaging.cuvetsmo.com theme.
//
// 2026-05-20 rewrite: the original component was a copy-paste of VetMock's
// white-theme CaseLibrary. White card-backgrounds + #666 muted text against
// the dark page made body text invisible (white-on-white). Palm flagged it
// as "ตัวหนังสือมองไม่เห็น" — fixed by swapping every inline color to a
// CSS custom property from `app/globals.css`.
//
// 2026-05-20 (Phase 3): added text search + difficulty filter + species
// filter on top of the modality filter. All four facets AND-combined.
// Per-chip counts compute against the OTHER three filters held constant
// (so toggling one facet doesn't zero-out the others). Search uses a
// pre-computed lowercase haystack per case + useDeferredValue to keep
// typing snappy on slow devices. localStorage shape collapsed to one
// JSON key `cuvi-cases-filters-v1` (legacy `cuvi-modality-filter` is
// migrated on first read, then deleted).
//
// Reads from a static JSON case list at `/cases.json` (fetched at runtime
// so cases can be added without a rebuild via the prebuild sync script).

// ── Filter constants ──────────────────────────────────────────────────────

const FILTERS_KEY = 'cuvi-cases-filters-v1';
const LEGACY_MODALITY_KEY = 'cuvi-modality-filter';

const EMPTY_FILTERS = Object.freeze({
  search: '',
  modality: 'all',
  difficulty: 'all',
  species: 'all',
});

function readPersistedFilters() {
  if (typeof window === 'undefined') return { ...EMPTY_FILTERS };
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        search: typeof parsed.search === 'string' ? parsed.search : '',
        modality: typeof parsed.modality === 'string' ? parsed.modality : 'all',
        difficulty: typeof parsed.difficulty === 'string' ? parsed.difficulty : 'all',
        species: typeof parsed.species === 'string' ? parsed.species : 'all',
      };
    }
    // Migrate legacy single-key shape
    const legacy = localStorage.getItem(LEGACY_MODALITY_KEY);
    if (legacy) {
      const migrated = { ...EMPTY_FILTERS, modality: legacy };
      try {
        localStorage.setItem(FILTERS_KEY, JSON.stringify(migrated));
        localStorage.removeItem(LEGACY_MODALITY_KEY);
      } catch { /* noop */ }
      return migrated;
    }
  } catch { /* noop */ }
  return { ...EMPTY_FILTERS };
}

// ── Modality helpers ─────────────────────────────────────────────────────

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

const DIFFICULTY_TABS = [
  { k: 'all',          label: 'All',          icon: '📚' },
  { k: 'intro',        label: 'intro',        icon: '🌱' },
  { k: 'intermediate', label: 'intermediate', icon: '🌿' },
  { k: 'advanced',     label: 'advanced',     icon: '🌳' },
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

// ── Search index helpers ─────────────────────────────────────────────────

// Pre-compute a lowercase haystack per case so filtering doesn't run
// .toLowerCase() on every keystroke (see feedback_input-lag-perf-checklist).
// Thai characters are not cased — toLowerCase() is a no-op for them but
// lowercases any Latin chars in titles like "VHS" or "HCM".
function buildSearchIndex(cases) {
  return cases.map((c) => {
    const parts = [
      c.title,
      c.species,
      c.signalment,
      c.body_part,
      c.history,
      c.modality,
      c.difficulty,
      Array.isArray(c.learning_objectives) ? c.learning_objectives.join(' ') : '',
      c.recall?.final_diagnosis,
    ];
    const haystack = parts.filter(Boolean).join('  ').toLowerCase();
    return { ...c, _haystack: haystack };
  });
}

// Apply the four filters with optional skip — used for both the filtered
// list and per-chip counts (where we hold the OTHER three filters constant).
function applyFilters(indexed, filters, skip = {}) {
  const q = skip.search ? '' : (filters.search || '').trim().toLowerCase();
  return indexed.filter((c) => {
    if (q && !c._haystack.includes(q)) return false;
    if (!skip.modality && filters.modality !== 'all' && modalityToKey(c.modality) !== filters.modality) return false;
    if (!skip.difficulty && filters.difficulty !== 'all' && (c.difficulty || 'unknown') !== filters.difficulty) return false;
    if (!skip.species && filters.species !== 'all' && (c.species || 'unknown') !== filters.species) return false;
    return true;
  });
}

// ── Component ────────────────────────────────────────────────────────────

export default function CaseLibraryLocal() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [filters, setFilters] = useState(readPersistedFilters);
  const deferredSearch = useDeferredValue(filters.search);

  // Persist on change
  useEffect(() => {
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify(filters)); } catch { /* noop */ }
  }, [filters]);

  const setSearch = useCallback((v) => setFilters((f) => ({ ...f, search: v })), []);
  const setModality = useCallback((v) => setFilters((f) => ({ ...f, modality: v })), []);
  const setDifficulty = useCallback((v) => setFilters((f) => ({ ...f, difficulty: v })), []);
  const setSpecies = useCallback((v) => setFilters((f) => ({ ...f, species: v })), []);
  const clearAll = useCallback(() => setFilters({ ...EMPTY_FILTERS }), []);

  // Fetch cases
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
          if (/HTTP 404/.test(e?.message || '')) setCases([]);
          else setError(e?.message || String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Build the search index ONCE per cases load (not per keystroke).
  const indexed = useMemo(() => buildSearchIndex(cases), [cases]);

  // Derive available species options from data so "ostrich" appears
  // automatically when a new case lands without a code change.
  const speciesOptions = useMemo(() => {
    const seen = new Map();
    for (const c of cases) {
      const s = c.species;
      if (!s) continue;
      if (!seen.has(s)) seen.set(s, true);
    }
    return [{ k: 'all', label: 'All', icon: '🐾' }, ...Array.from(seen.keys()).sort().map((s) => ({
      k: s,
      label: s,
      icon: s === 'canine' ? '🐶' : s === 'feline' ? '🐱' : s === 'equine' ? '🐴' : s === 'bovine' ? '🐄' : '🐾',
    }))];
  }, [cases]);

  // Effective filter object — substitute the deferred search in for the
  // live input so we filter against the deferred value, but the input
  // displays the live value. Same trick framer-motion / react-spring use.
  const effective = useMemo(() => ({
    search: deferredSearch,
    modality: filters.modality,
    difficulty: filters.difficulty,
    species: filters.species,
  }), [deferredSearch, filters.modality, filters.difficulty, filters.species]);

  const filtered = useMemo(() => applyFilters(indexed, effective), [indexed, effective]);

  // Per-facet counts: each facet's chips count against the OTHER 3 filters
  // held constant. Iron Rule 0: derive from actual filtered subset, never hardcode.
  const modalityCounts = useMemo(() => {
    const subset = applyFilters(indexed, effective, { modality: true });
    const c = { all: subset.length, xray: 0, ct: 0, mri: 0, us: 0, other: 0 };
    for (const cs of subset) c[modalityToKey(cs.modality)]++;
    return c;
  }, [indexed, effective]);

  const difficultyCounts = useMemo(() => {
    const subset = applyFilters(indexed, effective, { difficulty: true });
    const c = { all: subset.length, intro: 0, intermediate: 0, advanced: 0 };
    for (const cs of subset) {
      const d = cs.difficulty || 'unknown';
      if (c[d] !== undefined) c[d]++;
    }
    return c;
  }, [indexed, effective]);

  const speciesCounts = useMemo(() => {
    const subset = applyFilters(indexed, effective, { species: true });
    const c = { all: subset.length };
    for (const cs of subset) {
      const s = cs.species || 'unknown';
      c[s] = (c[s] || 0) + 1;
    }
    return c;
  }, [indexed, effective]);

  const hasAnyActive = filters.search.trim() !== '' || filters.modality !== 'all' || filters.difficulty !== 'all' || filters.species !== 'all';

  // Search field — uncontrolled-ish: live input value drives `filters.search`
  // each keystroke, but the actual filter pass runs against `deferredSearch`.
  const searchInputRef = useRef(null);
  const searchInputId = useId();

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
        <div style={filterBlockStyle}>
          {/* Search input row */}
          <div style={searchRowStyle}>
            <label htmlFor={searchInputId} style={srOnlyStyle}>ค้นหา case</label>
            <div style={searchWrapStyle}>
              <span aria-hidden style={searchIconStyle}>🔍</span>
              <input
                id={searchInputId}
                ref={searchInputRef}
                type="search"
                value={filters.search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหา case, species, diagnosis"
                style={searchInputStyle}
                autoComplete="off"
                spellCheck={false}
              />
              {filters.search && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); searchInputRef.current?.focus(); }}
                  style={searchClearBtnStyle}
                  aria-label="ล้างคำค้น"
                  title="ล้างคำค้น"
                >
                  ✕
                </button>
              )}
            </div>
            {hasAnyActive && (
              <button
                type="button"
                onClick={clearAll}
                style={clearAllBtnStyle}
                title="ล้างตัวกรองทั้งหมด"
              >
                ล้างตัวกรอง
              </button>
            )}
          </div>

          {/* Modality chips */}
          <ChipRow
            label="Modality"
            options={MODALITY_TABS}
            value={filters.modality}
            counts={modalityCounts}
            onChange={setModality}
          />

          {/* Difficulty chips */}
          <ChipRow
            label="Difficulty"
            options={DIFFICULTY_TABS}
            value={filters.difficulty}
            counts={difficultyCounts}
            onChange={setDifficulty}
          />

          {/* Species chips — derived from data */}
          {speciesOptions.length > 1 && (
            <ChipRow
              label="Species"
              options={speciesOptions}
              value={filters.species}
              counts={speciesCounts}
              onChange={setSpecies}
              isLast
            />
          )}
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
          <div style={{ color: 'var(--color-text)', fontWeight: 600 }}>
            ไม่พบ case ที่ตรงกับเงื่อนไข
          </div>
          <div style={{ fontSize: '0.82rem', marginTop: 8, color: 'var(--color-text-muted)' }}>
            ล้างตัวกรองเพื่อดูทั้งหมด
          </div>
          <button
            type="button"
            onClick={clearAll}
            style={{ ...clearAllBtnStyle, marginTop: 14 }}
          >
            ล้างตัวกรองทั้งหมด
          </button>
        </div>
      )}
    </div>
  );
}

// ── ChipRow ──────────────────────────────────────────────────────────────

function ChipRow({ label, options, value, counts, onChange, isLast = false }) {
  return (
    <div style={{ ...chipRowWrapStyle, ...(isLast ? { marginBottom: 0, paddingBottom: 0, borderBottom: 'none' } : {}) }}>
      <div style={chipRowLabelStyle}>{label}</div>
      <div style={chipRowStyle}>
        {options.map((t) => {
          const count = counts[t.k] || 0;
          const isActive = value === t.k;
          const isEmpty = count === 0 && t.k !== 'all';
          return (
            <button
              key={t.k}
              type="button"
              onClick={() => onChange(t.k)}
              disabled={isEmpty}
              aria-pressed={isActive}
              style={{
                ...chipBtnStyle,
                ...(isActive ? chipBtnActiveStyle : {}),
                ...(isEmpty ? chipBtnEmptyStyle : {}),
              }}
              title={isEmpty ? `ยังไม่มี ${t.label} case ในชุดที่กรอง` : `${t.label} (${count} case)`}
            >
              {t.icon && <span aria-hidden style={{ marginRight: 4 }}>{t.icon}</span>}
              {t.label}
              <span style={{ opacity: 0.65, fontSize: '0.85em', marginLeft: 5 }}>({count})</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── CaseCard ─────────────────────────────────────────────────────────────

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

// Phase 9: minmax floor lowered 280→260 so a 320px viewport fits one
// card without horizontal scroll (320 - 16*2 page padding = 288px
// usable; the old 280 was tight after 1px borders rendered).
const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
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

// Filter block wraps search + 3 chip rows in one card
const filterBlockStyle = {
  marginBottom: 14,
  paddingBottom: 10,
  borderBottom: '1px solid var(--color-border)',
};

const searchRowStyle = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
  marginBottom: 12,
};

const searchWrapStyle = {
  position: 'relative',
  flex: '1 1 240px',
  minWidth: 200,
  display: 'flex',
  alignItems: 'center',
};

const searchIconStyle = {
  position: 'absolute',
  left: 10,
  pointerEvents: 'none',
  fontSize: '0.95rem',
  opacity: 0.7,
  lineHeight: 1,
};

// Phase 9: search field min-height 36→44 so it matches WCAG touch
// target and avoids the iOS Safari "auto-zoom on small text inputs"
// trap (the 0.88rem ≈ 14px font would trigger zoom; bump to 16px to
// disable it on iPhone — fixes the mobile typing UX without adding a
// `viewport user-scalable=no` hack).
const searchInputStyle = {
  width: '100%',
  minHeight: 44,
  // padding-right 52 makes room for the bumped-up 44px search-clear X
  // (right:4 + width:44 = occupies right edge to 48px). Without this
  // bump, typed text would slide under the X.
  padding: '10px 52px 10px 36px',
  background: 'var(--color-surface-2)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border-bright)',
  borderRadius: 8,
  fontSize: '16px', // iOS zoom prevention (≥16px disables auto-zoom on focus)
  outline: 'none',
};

// Phase 9: 24→44 floor. The clear-X used to be a 24px micro-target
// inside the search field — easy to miss with a thumb, especially
// near the field edge where the field's own focus catcher competes.
const searchClearBtnStyle = {
  position: 'absolute',
  right: 4,
  width: 44,
  height: 44,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  fontSize: '0.9rem',
  borderRadius: 4,
  padding: 0,
};

// Phase 9: clear-all 32→44 floor.
const clearAllBtnStyle = {
  padding: '10px 14px',
  background: 'transparent',
  color: 'var(--color-tool-cyan)',
  border: '1px solid var(--color-border-tool)',
  borderRadius: 8,
  fontSize: '0.78rem',
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const chipRowWrapStyle = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  flexWrap: 'wrap',
  marginBottom: 8,
  paddingBottom: 8,
  borderBottom: '1px dashed var(--color-border)',
};

const chipRowLabelStyle = {
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: 'var(--color-text-faint, var(--color-text-muted))',
  fontWeight: 600,
  flex: '0 0 76px',
  paddingTop: 8,
  minWidth: 76,
};

const chipRowStyle = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  flex: '1 1 0',
  minWidth: 0,
};

// Phase 9: filter chips 32→44 floor. These are the primary mobile
// filter primitives — sitting in flex-wrap rows on a phone, a missed
// tap flips the wrong facet and shuffles the case grid below. 44px
// also gives enough vertical padding so chips don't visually collide
// with the dashed row separator at narrow widths.
const chipBtnStyle = {
  padding: '10px 14px',
  background: 'var(--color-surface-2)',
  color: 'var(--color-text-muted)',
  border: '1px solid var(--color-border-bright)',
  borderRadius: 999,
  cursor: 'pointer',
  fontSize: '0.8rem',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  transition: 'border-color 140ms, color 140ms, background-color 140ms',
};

const chipBtnActiveStyle = {
  background: 'var(--color-tool-cyan)',
  color: '#06070A',
  borderColor: 'var(--color-tool-cyan)',
  fontWeight: 600,
};

const chipBtnEmptyStyle = {
  opacity: 0.7,
  cursor: 'not-allowed',
  color: 'var(--color-text-muted)',
  background: 'transparent',
  borderStyle: 'dashed',
};

const srOnlyStyle = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
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

// Phase 9: case-card CTA 32 (effective)→44 floor.
const openCaseBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  width: '100%',
  marginTop: 'auto',
  padding: '12px 14px',
  minHeight: 44,
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
