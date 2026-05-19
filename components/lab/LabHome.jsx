'use client';
import { useState, useCallback, useEffect, Suspense, lazy } from 'react';
import Link from 'next/link';
import { useMediaQuery } from '../../lib/dicom/use-media-query.js';
import { CrosshairPattern } from '../CrosshairPattern';

const DicomViewport = lazy(() => import('./DicomViewport.jsx'));
const TagInspector = lazy(() => import('./TagInspector.jsx'));

const RECENT_KEY = 'cuvi-recent-files';
const RECENT_MAX = 5;
const MAX_FILES = 2;

// Check the DICOM magic-byte signature "DICM" at offset 128. Catches
// files exported without a .dcm extension (common when PACS dumps the
// SOP-Instance-UID as filename).
async function isDicomFile(file) {
  if (!file) return false;
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.dcm') || lower.endsWith('.dicom')) return true;
  if (file.type === 'application/dicom') return true;
  if (file.size < 132) return false;
  try {
    const head = await file.slice(0, 200).arrayBuffer();
    const v = new Uint8Array(head);
    return v[128] === 0x44 && v[129] === 0x49 && v[130] === 0x43 && v[131] === 0x4D;
  } catch {
    return false;
  }
}

export default function LabHome() {
  const isMobile = useMediaQuery('(max-width: 600px)');
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const [recent, setRecent] = useState([]);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw) setRecent(JSON.parse(raw));
    } catch { /* corrupt JSON; ignore */ }
    try {
      const seen = localStorage.getItem('cuvi-onboarded');
      if (!seen) setShowOnboarding(true);
    } catch { /* ignore */ }
  }, []);

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    try { localStorage.setItem('cuvi-onboarded', '1'); } catch { /* noop */ }
  }, []);

  const addToRecent = useCallback((f) => {
    if (!f) return;
    const entry = { name: f.name, size: f.size, lastModified: f.lastModified || Date.now() };
    setRecent((prev) => {
      const next = [entry, ...prev.filter((p) => !(p.name === entry.name && p.size === entry.size))].slice(0, RECENT_MAX);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, []);

  const handleFiles = useCallback(async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const arr = Array.from(fileList).slice(0, MAX_FILES);
    const validated = [];
    const bad = [];
    for (const f of arr) {
      if (await isDicomFile(f)) {
        validated.push(f);
        addToRecent(f);
      } else {
        bad.push(f.name);
      }
    }
    if (validated.length === 0) {
      setError(`ไฟล์ไม่ใช่ DICOM: ${bad.join(', ')}`);
      return;
    }
    const skippedExtras = fileList.length > MAX_FILES ? fileList.length - MAX_FILES : 0;
    let msg = null;
    if (bad.length > 0) msg = `บางไฟล์ไม่ใช่ DICOM (ข้าม): ${bad.join(', ')}`;
    if (skippedExtras > 0) msg = `${msg ? msg + ' — ' : ''}ตอนนี้รองรับสูงสุด ${MAX_FILES} ไฟล์ (ข้าม ${skippedExtras})`;
    setError(msg);
    setFiles(validated);
  }, [addToRecent]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer?.files);
  }, [handleFiles]);

  const onDragOver = useCallback((e) => { e.preventDefault(); setDragging(true); }, []);
  const onDragLeave = useCallback((e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragging(false);
  }, []);
  const onFileInput = useCallback((e) => handleFiles(e.target.files), [handleFiles]);

  const clearRecent = useCallback(() => {
    setRecent([]);
    try { localStorage.removeItem(RECENT_KEY); } catch { /* noop */ }
  }, []);

  const removeRecentAt = useCallback((idx) => {
    setRecent((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      try {
        if (next.length === 0) localStorage.removeItem(RECENT_KEY);
        else localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch { /* noop */ }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setFiles([]);
    setError(null);
  }, []);

  const removeFileAt = useCallback((idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const firstFile = files[0];

  // ── VIEWER MODE ──
  if (files.length > 0) {
    return (
      <div className="mx-auto max-w-7xl px-3 sm:px-5 py-4">
        <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
          <div className="text-sm text-[var(--color-text-muted)] font-mono">
            {files.length === 1
              ? `${firstFile.name} — ${(firstFile.size / 1024).toFixed(0)} KB`
              : `Study (${files.length} views): ${files.map(f => f.name).join(' + ')}`}
          </div>
          <button onClick={reset} className="vmx-btn vmx-btn-ghost vmx-btn-sm">← Back to drop zone</button>
        </div>

        <div style={files.length >= 2 ? studyGridStyle : undefined}>
          {files.map((f, idx) => (
            <ViewerPane
              key={`${f.name}-${f.size}-${f.lastModified || 0}`}
              file={f}
              index={idx}
              canRemove={files.length > 1}
              onRemove={() => removeFileAt(idx)}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── HOME / WORKSPACE (no marketing hero — the page IS the tool) ──
  return (
    <div className="relative">
      {/* Faint DICOM crosshair grid wash behind the workspace */}
      <CrosshairPattern className="z-0" opacity={0.035} />

      <div className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 pt-6 pb-10">
        {/* Compact header strip — no hero, just a workspace title bar */}
        <div className="flex items-baseline justify-between mb-5 flex-wrap gap-2">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-[var(--color-text)]">
              Free Mode
            </h1>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Drag DICOM onto the dropzone, ครั้งละ {MAX_FILES} ไฟล์, render ในเบราว์เซอร์ล้วน
            </p>
          </div>
          <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
            Educational, not for clinical decisions
          </span>
        </div>

        {/* PRIMARY: Free Mode drop zone — the page IS the tool */}
        <label
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={`block cursor-pointer rounded-md border-2 border-dashed transition-colors mb-6 ${
            dragging
              ? 'border-[var(--color-tool-cyan)] bg-[rgba(90,204,230,0.08)]'
              : 'border-[var(--color-border)] bg-[var(--color-surface-2)] hover:border-[var(--color-tool-cyan)]/60'
          }`}
        >
          <div className="px-6 py-16 sm:py-20 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-md border border-[var(--color-tool-cyan)]/40 bg-[rgba(90,204,230,0.06)] mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-tool-cyan)]" aria-hidden="true">
                <path d="M12 3v12M12 3l-4 4M12 3l4 4" />
                <path d="M3 17v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
              </svg>
            </div>
            <div className="text-base font-semibold text-[var(--color-text)] mb-1">
              Drop .dcm file here
            </div>
            <div className="text-xs text-[var(--color-text-muted)] mb-4">
              หรือคลิกเพื่อเลือก, ครั้งละสูงสุด {MAX_FILES} ไฟล์, ไม่ขึ้น server
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              <span className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/60">DICOM</span>
              <span className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/60">Norberg</span>
              <span className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/60">VHS</span>
              <span className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/60">Occlusion</span>
            </div>
            <input
              type="file"
              accept=".dcm,application/dicom"
              multiple
              onChange={onFileInput}
              className="hidden"
            />
          </div>
        </label>

        {error && (
          <p className="text-[var(--color-active-red)] text-sm text-center mb-4">{error}</p>
        )}

        {/* Mode picker — Case Library + Occlusion as siblings */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <ModeCard
            href="/cases"
            title="Case Library"
            desc="Curated cases (X-ray, CT, MRI, US)"
            iconSvg={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            }
          />
          <ModeCard
            href="/occlusion"
            title="Image Occlusion"
            desc="Anki-style anatomy and radiograph flashcards"
            iconSvg={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
            }
          />
        </section>

        {showOnboarding && (
          <div className="rounded-md border border-[var(--color-tool-cyan)]/30 bg-[rgba(90,204,230,0.06)] p-4 mb-6 flex items-start justify-between gap-3">
            <div className="text-sm text-[var(--color-text)] leading-relaxed">
              <strong className="text-[var(--color-text)]">ยินดีต้อนรับ Imaging Lab</strong>
              <ul className="mt-2 pl-5 list-disc space-y-1 text-[var(--color-text-muted)]">
                <li>ลาก DICOM (<code className="text-[var(--color-tool-cyan)]">.dcm</code>) ลงในกล่อง Free Mode — ครั้งละ 2 ไฟล์ได้ (side-by-side)</li>
                <li>เปิด viewer แล้วกด <kbd className="px-1.5 py-0.5 border border-[var(--color-border)] rounded text-xs bg-[var(--color-bg)]">?</kbd> ดู 16 keyboard shortcuts</li>
                <li>Norberg + VHS + Length/Angle ครบ, Anonymize ก่อน share ภาพออก</li>
                <li>ไฟล์ render ใน browser ล้วน — ไม่ขึ้น server</li>
              </ul>
            </div>
            <button onClick={dismissOnboarding} className="vmx-btn vmx-btn-ghost vmx-btn-sm shrink-0" aria-label="ปิด">✕</button>
          </div>
        )}

        {recent.length > 0 && (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm">
            <div className="flex items-center justify-between mb-2">
              <strong className="text-[var(--color-text)] text-xs uppercase tracking-wider">Recent files</strong>
              <button
                onClick={clearRecent}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-tool-cyan)] underline"
              >
                ล้าง
              </button>
            </div>
            <div className="text-xs text-[var(--color-text-muted)] mb-2">
              File blobs ไม่ persist ข้าม session — เห็นรายการที่นี่แล้วลากไฟล์เดิมจาก disk เพื่อ re-open
            </div>
            <ul className="divide-y divide-[var(--color-border)]">
              {recent.map((r, i) => (
                <li key={i} className="py-2 flex items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]">
                  <span className="truncate flex-1 font-mono">
                    <span className="text-[var(--color-text)]">{r.name}</span>
                    {' '}— {(r.size / 1024).toFixed(0)} KB,{' '}
                    {new Date(r.lastModified).toLocaleString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </span>
                  <button
                    onClick={() => removeRecentAt(i)}
                    aria-label="ลบไฟล์นี้จากประวัติ"
                    className="w-5 h-5 text-[var(--color-text-muted)] hover:text-[var(--color-active-red)]"
                  >×</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Quiet footnote, replaces the old centered hero subhead */}
        <p className="mt-8 text-[11px] text-[var(--color-text-muted)] text-center">
          New here? <Link href="/about" className="text-[var(--color-tool-cyan)] hover:underline">Read what this lab does ↗</Link>
        </p>
      </div>
    </div>
  );
}

function ModeCard({ href, title, desc, iconSvg }) {
  return (
    <Link
      href={href}
      className="group rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-4 hover:border-[var(--color-tool-cyan)]/60 transition-colors flex items-center gap-4"
    >
      <div className="w-9 h-9 rounded border border-[var(--color-border)] bg-[var(--color-bg)] flex items-center justify-center text-[var(--color-tool-cyan)] shrink-0">
        {iconSvg}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-[var(--color-text)] group-hover:text-[var(--color-tool-cyan)] transition-colors">{title}</div>
        <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{desc}</div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-text-muted)] group-hover:text-[var(--color-tool-cyan)] transition-colors shrink-0" aria-hidden="true">
        <path d="M5 12h14M13 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

// Single viewer pane wrapper — file label + DicomViewport + Tag panel.
function ViewerPane({ file, index, canRemove, onRemove }) {
  const [showTags, setShowTags] = useState(false);
  return (
    <div style={paneStyle}>
      <div style={paneHeaderStyle}>
        <span>
          <strong>View {index + 1}:</strong>{' '}
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>{file.name}</span>
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={() => setShowTags((s) => !s)}
            className="vmx-btn vmx-btn-ghost vmx-btn-sm"
            title="ดู DICOM tags ทั้งหมด"
          >
            Info
          </button>
          {canRemove && (
            <button
              onClick={onRemove}
              aria-label="Remove this view"
              style={removePaneBtnStyle}
              title="ปิด view นี้"
            >✕</button>
          )}
        </div>
      </div>
      <Suspense fallback={<div style={loadingFallbackStyle}>กำลังโหลด viewer...</div>}>
        <DicomViewport file={file} caseId={null} syncEnabled={false} />
      </Suspense>
      {showTags && (
        <Suspense fallback={null}>
          <TagInspector file={file} onClose={() => setShowTags(false)} />
        </Suspense>
      )}
    </div>
  );
}

const studyGridStyle = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12,
};
const paneStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: 'var(--color-surface-2)',
  padding: 8,
};
const paneHeaderStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: 8, padding: '4px 6px', fontSize: '0.85rem', color: 'var(--color-text-muted)',
  flexWrap: 'wrap', gap: 6,
};
const removePaneBtnStyle = {
  width: 24, height: 24, borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface-2)',
  cursor: 'pointer', color: 'var(--color-text-muted)',
  fontSize: '0.85rem', lineHeight: 1, padding: 0,
};
const loadingFallbackStyle = {
  padding: 40, textAlign: 'center', color: 'var(--color-text-muted)',
};
