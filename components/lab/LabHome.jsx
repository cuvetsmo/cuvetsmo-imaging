'use client';
import { useState, useCallback, useEffect, Suspense, lazy } from 'react';
import Link from 'next/link';
import Image from 'next/image';
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

  // ── HOME / WORKSPACE ──
  //
  // 2026-05-20 hero redesign. The previous "the page IS the tool" layout
  // (compact title + giant empty dropzone + 2 mode cards) tested poorly:
  // the dropzone read as a placeholder rather than a product, the 4 pills
  // (DICOM/Norberg/VHS/Occlusion) looked like clickable CTAs but weren't,
  // and visitors had no preview of what the viewer actually does.
  //
  // New flow follows the OHIF.org landing pattern (see
  // sessions/2026-05-20 imaging redesign): three-noun hero + a stylised
  // preview of the viewer running a Norberg case on the right, with two
  // explicit CTAs (Sample case as primary, your-own-file as secondary
  // that scrolls down to the existing dropzone). The dropzone itself
  // moves below the hero where it makes sense as a follow-up action
  // rather than the headline.
  return (
    <div className="relative">
      {/* Faint DICOM crosshair grid wash behind everything */}
      <CrosshairPattern className="z-0" opacity={0.035} />

      <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 pt-10 sm:pt-14 pb-10">
        {/* ──── HERO ──── */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12 items-center mb-14">
          {/* Left: copy + CTAs */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--color-tool-cyan)] mb-4">
              CUVETSMO Imaging · Free for vet students
            </p>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-[var(--color-text)] leading-[1.1] mb-5">
              Vet DICOM viewer.<br />
              <span className="text-[var(--color-tool-cyan)]">Browser-based.</span><br />
              Free for students.
            </h1>
            <p className="text-base text-[var(--color-text-muted)] leading-relaxed mb-7 max-w-md">
              เปิดภาพรังสีของหมา-แมวในเบราว์เซอร์ ไม่ส่งภาพขึ้น server, มี overlay Norberg + VHS วินิจฉัย hip dysplasia สำหรับการเรียนการสอน.
            </p>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/cases"
                className="inline-flex items-center gap-2 rounded-md bg-[var(--color-tool-cyan)] px-5 py-2.5 text-sm font-semibold text-[var(--color-bg)] hover:bg-[var(--color-tool-cyan)]/90 transition-colors shadow-sm"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
                </svg>
                เปิด sample case
              </Link>
              <a
                href="#dropzone"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById('dropzone')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="inline-flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-2.5 text-sm font-semibold text-[var(--color-text)] hover:border-[var(--color-tool-cyan)]/60 hover:text-[var(--color-tool-cyan)] transition-colors"
              >
                หรือลากไฟล์ DICOM ของคุณ
                <span aria-hidden>↓</span>
              </a>
            </div>

            {/* Capability strip — text-only, static dots */}
            <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--color-text-muted)]">
              <li className="flex items-center gap-1.5"><span aria-hidden className="text-[var(--color-tool-cyan)]">●</span> Norberg angle</li>
              <li className="flex items-center gap-1.5"><span aria-hidden className="text-[var(--color-tool-cyan)]">●</span> VHS · vertebral heart score</li>
              <li className="flex items-center gap-1.5"><span aria-hidden className="text-[var(--color-tool-cyan)]">●</span> Image occlusion editor</li>
              <li className="flex items-center gap-1.5"><span aria-hidden className="text-[var(--color-finalized)]">●</span> ไม่ขึ้น server</li>
            </ul>
          </div>

          {/* Right: stylised viewer preview · static SVG, not a live viewer.
              Mimics the chrome of the real DicomViewport (toolbar, viewport
              frame, measurement readout) with a canine pelvis sketch + Norberg
              angle overlay drawn in. Labelled as "Sample · Illustrative" so
              we never imply this is a real diagnostic radiograph. */}
          <ViewerPreview />
        </section>

        {/* ──── DROPZONE ──── */}
        <section id="dropzone" className="mb-10 scroll-mt-20">
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--color-text)]">
              Free Mode · ลาก DICOM ของคุณ
            </h2>
            <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
              Educational, not for clinical decisions
            </span>
          </div>

          <label
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            className={`block cursor-pointer rounded-md border-2 border-dashed transition-colors ${
              dragging
                ? 'border-[var(--color-tool-cyan)] bg-[rgba(90,204,230,0.08)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface-2)] hover:border-[var(--color-tool-cyan)]/60'
            }`}
          >
            <div className="px-6 py-10 sm:py-12 text-center">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-md border border-[var(--color-tool-cyan)]/40 bg-[rgba(90,204,230,0.06)] mb-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-tool-cyan)]" aria-hidden="true">
                  <path d="M12 3v12M12 3l-4 4M12 3l4 4" />
                  <path d="M3 17v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
                </svg>
              </div>
              <div className="text-sm font-semibold text-[var(--color-text)] mb-1">
                Drop .dcm file here · หรือคลิกเพื่อเลือก
              </div>
              <div className="text-xs text-[var(--color-text-muted)]">
                ครั้งละสูงสุด {MAX_FILES} ไฟล์ (side-by-side study) · render ในเบราว์เซอร์ล้วน ไม่ส่งภาพขึ้น server
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
            <p className="text-[var(--color-active-red)] text-sm text-center mt-4">{error}</p>
          )}
        </section>

        {/* ──── TOOL TILES ────
            Image-art tiles for each lab feature · Pollinations-generated
            radiographs as illustrations · simple border + arrow nudge on hover.
            Layout uses the .imaging-tool-tile class kept from Phase 0.5. */}
        <section className="mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ToolTile
              href="/cases"
              title="Case Library"
              desc="Curated CC-BY radiographs · X-ray · CT · MR · US"
              meta="17 cases · grows weekly"
              art={
                /* Real Pollinations-generated canine skeleton lateral · cropped to fit tile */
                <div className="relative w-[110px] h-[68px] rounded-md overflow-hidden bg-black ring-1 ring-[var(--color-border-bright)]">
                  <Image
                    src="/illustrations/tile-cases.jpg"
                    alt=""
                    fill
                    sizes="110px"
                    className="object-cover"
                  />
                </div>
              }
            />
            <ToolTile
              href="/occlusion"
              title="Image Occlusion"
              desc="Anki-style masks · cover-the-anatomy active recall"
              meta="works on PNG + DICOM"
              art={
                /* Real radiograph base + SVG occlusion masks overlaid · shows the tool's actual behavior */
                <div className="relative w-[110px] h-[68px] rounded-md overflow-hidden bg-black ring-1 ring-[var(--color-border-bright)]">
                  <Image
                    src="/illustrations/tile-occlusion.jpg"
                    alt=""
                    fill
                    sizes="110px"
                    className="object-cover"
                  />
                  {/* Cyan occlusion masks overlaid · shows the tool action */}
                  <svg
                    className="absolute inset-0 w-full h-full"
                    viewBox="0 0 110 68"
                    aria-hidden="true"
                  >
                    <rect x="22" y="20" width="30" height="14" rx="2" fill="#5ACCE6" opacity="0.88" />
                    <rect x="60" y="34" width="28" height="14" rx="2" fill="#5ACCE6" opacity="0.88" />
                    <circle cx="37" cy="27" r="1" fill="#000" opacity="0.4" />
                    <circle cx="74" cy="41" r="1" fill="#000" opacity="0.4" />
                  </svg>
                </div>
              }
            />
          </div>
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

/**
 * ViewerPreview — static SVG mockup of the DICOM viewer shown in the hero.
 *
 * Drawing a stylised canine pelvis with the Norberg angle overlay already
 * applied. NOT a real radiograph — labelled "Sample · Illustrative" so
 * visitors don't mistake it for a diagnostic image. We avoid using a real
 * patient X-ray here because licensing CC-BY vet radiographs takes effort
 * and the stylised version reads cleanly as "this is what the tool does".
 *
 * The chrome (toolbar row + viewport frame + measurement readout) mimics
 * the real DicomViewport so visitors recognise the workspace they'll get
 * after they click "Open sample case" / drop a file.
 */
function ViewerPreview() {
  return (
    <div
      className="relative rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] shadow-xl overflow-hidden"
      role="img"
      aria-label="Preview of the DICOM viewer showing a canine pelvis with Norberg angle overlay drawn — illustrative, not a real radiograph"
    >
      {/* Toolbar row */}
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-surface-2)] border-b border-[var(--color-border)] text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-finalized)]" aria-hidden />
          <span className="font-mono">cu-001 · canine pelvis · VD</span>
        </div>
        <div className="flex items-center gap-3 font-mono">
          <span>W/L</span>
          <span>Pan</span>
          <span className="text-[var(--color-tool-cyan)]">∠ Norberg</span>
          <span>↕ Stack</span>
        </div>
      </div>

      {/* Viewport · real radiograph image + measurement overlay drawn on top.
          The image is an AI-generated stylised canine lateral (Pollinations.ai
          Flux seed=11) showing dog body w/ ribcage + spine + pelvis visible.
          Not a true diagnostic radiograph — "Sample · Illustrative" badge
          makes this explicit. Overlay coordinates tuned to the visible pelvis
          area (lower-left) of the lateral image; easy to nudge if the source
          image is swapped later. */}
      <div className="relative aspect-[5/4] bg-[var(--color-surface-3)]">
        {/* Base radiograph image */}
        <Image
          src="/illustrations/hero-pelvis.jpg"
          alt=""
          fill
          sizes="(min-width: 1024px) 480px, 100vw"
          className="object-cover"
          priority
        />

        {/* Measurement overlay SVG — drawn on top using viewBox 500x400 so
            coordinates can be tuned by eye against the image. */}
        <svg
          viewBox="0 0 500 400"
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 w-full h-full pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Subtle dark vignette so the metadata text reads on busy areas */}
          <defs>
            <radialGradient id="overlay-vignette" cx="50%" cy="50%" r="80%">
              <stop offset="55%" stopColor="rgba(0,0,0,0)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0.6)" />
            </radialGradient>
          </defs>
          <rect width="500" height="400" fill="url(#overlay-vignette)" />

          {/* Norberg overlay — femoral heads + acetabular rims positioned
              over the visible pelvis area in the lower-left of the image.
              Not anatomically rigorous (the image is lateral, Norberg needs
              VD); kept as a stylised "this is what the tool does" demo. */}
          {/* Cyan baseline · femoral head to femoral head */}
          <line x1="105" y1="245" x2="170" y2="245" stroke="#5ACCE6" strokeWidth="2" />
          {/* Angle lines · femoral head → acetabular rim */}
          <line x1="105" y1="245" x2="88" y2="220" stroke="#5ACCE6" strokeWidth="2" />
          <line x1="170" y1="245" x2="187" y2="220" stroke="#5ACCE6" strokeWidth="2" />
          {/* Acetabular rim dots */}
          <circle cx="88" cy="220" r="3.5" fill="#5ACCE6" />
          <circle cx="187" cy="220" r="3.5" fill="#5ACCE6" />
          {/* Femoral head center dots */}
          <circle cx="105" cy="245" r="3.5" fill="#5ACCE6" />
          <circle cx="170" cy="245" r="3.5" fill="#5ACCE6" />
          {/* Angle arcs */}
          <path d="M 120 233 A 14 14 0 0 0 117 244" fill="none" stroke="#5ACCE6" strokeWidth="1.5" />
          <path d="M 155 233 A 14 14 0 0 1 158 244" fill="none" stroke="#5ACCE6" strokeWidth="1.5" />

          {/* Numeric readouts — floated above the angle area, drop-shadow for contrast */}
          <g fontFamily="ui-monospace, monospace" fontWeight="600">
            <text x="35" y="208" fontSize="12" fill="#5ACCE6">L: 108°</text>
            <text x="200" y="208" fontSize="12" fill="#5ACCE6">R: 105°</text>
          </g>

          {/* Top-left DICOM metadata · monospace, kept on dark area */}
          <g fontFamily="ui-monospace, monospace" fontSize="9" fill="#D4D4D8">
            <text x="12" y="22">MRN: 12345678</text>
            <text x="12" y="36">Modality: DX</text>
            <text x="12" y="50">Acquired: 2026-05-20</text>
          </g>
          <g fontFamily="ui-monospace, monospace" fontSize="9" fill="#D4D4D8" textAnchor="end">
            <text x="488" y="22">WW: 4096</text>
            <text x="488" y="36">WL: 2048</text>
            <text x="488" y="50">Px: 0.142mm</text>
          </g>

          {/* Bottom-right scale ruler — gives visual sense of measurement */}
          <g stroke="#D4D4D8" strokeWidth="1" opacity="0.75">
            <line x1="370" y1="380" x2="470" y2="380" />
            <line x1="370" y1="376" x2="370" y2="384" />
            <line x1="395" y1="378" x2="395" y2="382" />
            <line x1="420" y1="376" x2="420" y2="384" />
            <line x1="445" y1="378" x2="445" y2="382" />
            <line x1="470" y1="376" x2="470" y2="384" />
          </g>
          <text x="420" y="395" textAnchor="middle" fontSize="9" fontFamily="ui-monospace, monospace" fill="#D4D4D8">10 mm</text>
        </svg>

        {/* Floating "Sample · Illustrative" badge — makes it explicit the image
            is AI-generated, not a real diagnostic radiograph. */}
        <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded bg-[rgba(0,0,0,0.7)] backdrop-blur-sm px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] border border-[var(--color-border-bright)]">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-tool-cyan)]" aria-hidden />
          Sample · Illustrative
        </div>
      </div>

      {/* Footer · measurement readout strip · mirrors the real viewer chrome */}
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-surface-2)] border-t border-[var(--color-border)] text-[10px] font-mono text-[var(--color-text-muted)]">
        <span>∠ Norberg · L 108° / R 105°</span>
        <span className="text-[var(--color-tool-cyan)]">Open sample case →</span>
      </div>
    </div>
  );
}

/**
 * ToolTile — tactile feature tile with custom SVG illustration on the right.
 *
 * Hover behavior comes from the .imaging-tool-tile CSS class:
 *   - Lifts 2px
 *   - Cyan gradient ring reveals around border
 *   - art color shifts from text-muted → tool-cyan
 *   - arrow shifts 3px right + colors to cyan
 *
 * The `art` slot receives an inline SVG that uses `currentColor` so the tile
 * can control the line color via the .imaging-tile-art class.
 */
function ToolTile({ href, title, desc, meta, art }) {
  return (
    <Link href={href} className="imaging-tool-tile group">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-semibold text-[var(--color-text)] tracking-tight text-[15px]">{title}</span>
          {meta && (
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-muted)] opacity-70">
              {meta}
            </span>
          )}
        </div>
        <div className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">{desc}</div>
      </div>
      <div className="imaging-tile-art self-center">
        {art}
      </div>
      <svg
        width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="1.75"
        strokeLinecap="round" strokeLinejoin="round"
        className="imaging-tile-arrow"
        aria-hidden="true"
      >
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
