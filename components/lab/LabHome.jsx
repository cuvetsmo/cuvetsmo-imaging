'use client';
import { useState, useCallback, useEffect, Suspense, lazy } from 'react';
import Link from 'next/link';
import { useMediaQuery } from '../../lib/dicom/use-media-query.js';

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
    if (skippedExtras > 0) msg = `${msg ? msg + ' · ' : ''}ตอนนี้รองรับสูงสุด ${MAX_FILES} ไฟล์ (ข้าม ${skippedExtras})`;
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
        <div style={viewerHeaderStyle}>
          <div style={{ fontSize: '0.88rem', color: '#555' }}>
            📄 {files.length === 1
              ? `${firstFile.name} · ${(firstFile.size / 1024).toFixed(0)} KB`
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

  // ── HOME / DROP ZONE ──
  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      {/* HERO */}
      <section className="text-center mb-8">
        <div className="text-4xl mb-3" aria-hidden>🔬</div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-stone-900">
          Imaging Lab
        </h1>
        <p className="mt-3 text-stone-600 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
          DICOM viewer + AI overlays สำหรับนิสิตคลินิก ·{" "}
          <span className="text-stone-500">Norberg angle · VHS · Image Occlusion</span>
        </p>
        <p className="mt-2 text-xs text-stone-500">
          ⚠️ Educational tool. Not for clinical decisions.
        </p>
      </section>

      {/* Mode picker */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <ModeCard
          href="/cases"
          icon="📚"
          title="Case Library"
          desc="ดู curated cases — X-ray / CT / MRI / US"
        />
        <label
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={`rounded-xl border bg-white px-5 py-6 text-center cursor-pointer transition-colors ${dragging ? 'border-sky-500 bg-sky-50' : 'border-stone-200 hover:border-sky-400'}`}
        >
          <div className="text-2xl mb-1">🖼</div>
          <div className="font-semibold text-stone-900">Free Mode</div>
          <div className="text-xs text-stone-500 mt-1">
            Drag .dcm · ครั้งละ {MAX_FILES} ไฟล์ · ไม่ขึ้น server
          </div>
          <input
            type="file"
            accept=".dcm,application/dicom"
            multiple
            onChange={onFileInput}
            className="hidden"
          />
        </label>
        <ModeCard
          href="/occlusion"
          icon="🎯"
          title="Image Occlusion"
          desc="Anki-style anatomy/radiograph flashcards"
        />
      </section>

      {error && (
        <p className="text-red-600 text-sm text-center mb-4">{error}</p>
      )}

      {showOnboarding && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 mb-6 flex items-start justify-between gap-3">
          <div className="text-sm text-stone-700 leading-relaxed">
            <strong className="text-stone-900">👋 ยินดีต้อนรับ Imaging Lab</strong>
            <ul className="mt-2 pl-5 list-disc space-y-1 text-stone-600">
              <li>ลาก DICOM (<code>.dcm</code>) ลงในการ์ด <strong>Free Mode</strong> — ครั้งละ 2 ไฟล์ได้ (side-by-side)</li>
              <li>เปิด viewer แล้วกด <kbd className="px-1 py-0.5 border rounded text-xs">?</kbd> ดู 16 keyboard shortcuts</li>
              <li>Norberg + VHS + Length/Angle ครบ · 🔒 Anonymize ก่อน share ภาพออก</li>
              <li>ไฟล์ render ใน browser ล้วน — ไม่ขึ้น server</li>
            </ul>
          </div>
          <button onClick={dismissOnboarding} className="vmx-btn vmx-btn-ghost vmx-btn-sm shrink-0" aria-label="ปิด">✕</button>
        </div>
      )}

      {recent.length > 0 && (
        <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
          <div className="flex items-center justify-between mb-2">
            <strong className="text-stone-700">🕘 Recent files</strong>
            <button
              onClick={clearRecent}
              className="text-xs text-stone-500 hover:text-stone-700 underline"
            >
              ล้าง
            </button>
          </div>
          <div className="text-xs text-stone-500 mb-2">
            File blobs ไม่ persist ข้าม session · เห็นรายการที่นี่แล้วลากไฟล์เดิมจาก disk เพื่อ re-open
          </div>
          <ul className="divide-y divide-stone-100">
            {recent.map((r, i) => (
              <li key={i} className="py-2 flex items-center justify-between gap-2 text-xs text-stone-600">
                <span className="truncate flex-1">
                  📄 <span className="text-stone-800">{r.name}</span> · {(r.size / 1024).toFixed(0)} KB ·{' '}
                  {new Date(r.lastModified).toLocaleString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}
                </span>
                <button
                  onClick={() => removeRecentAt(i)}
                  aria-label="ลบไฟล์นี้จากประวัติ"
                  className="w-5 h-5 text-stone-400 hover:text-stone-700"
                >×</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ModeCard({ href, icon, title, desc }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-stone-200 bg-white px-5 py-6 text-center hover:border-sky-400 hover:shadow-sm transition-all"
    >
      <div className="text-2xl mb-1">{icon}</div>
      <div className="font-semibold text-stone-900">{title}</div>
      <div className="text-xs text-stone-500 mt-1">{desc}</div>
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
          <span style={{ color: '#888', fontSize: '0.75rem' }}>{file.name}</span>
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={() => setShowTags((s) => !s)}
            className="vmx-btn vmx-btn-ghost vmx-btn-sm"
            title="ดู DICOM tags ทั้งหมด"
          >
            🔍 Info
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

const viewerHeaderStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: 12, gap: 8, flexWrap: 'wrap',
};
const studyGridStyle = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12,
};
const paneStyle = { border: '1px solid #ddd', borderRadius: 8, background: '#fff', padding: 8 };
const paneHeaderStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: 8, padding: '4px 6px', fontSize: '0.85rem', color: '#555',
  flexWrap: 'wrap', gap: 6,
};
const removePaneBtnStyle = {
  width: 24, height: 24, borderRadius: 4, border: '1px solid #ccc', background: '#fff',
  cursor: 'pointer', color: '#666', fontSize: '0.85rem', lineHeight: 1, padding: 0,
};
const loadingFallbackStyle = { padding: 40, textAlign: 'center', color: '#888' };
