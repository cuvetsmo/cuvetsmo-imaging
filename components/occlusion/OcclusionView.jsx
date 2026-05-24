'use client';

// Lifted from VetMock src/views/ImageOcclusionView.jsx with the
// goHome prop dropped in favor of a Next.js Link, and the editor
// import path updated for this project layout.

import { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  loadDecks, saveDeck, deleteDeck, touchDeck,
  IMAGE_OCCLUSION_EVENT,
} from '../../lib/image-occlusion.js';

// Human-readable copy for each failure reason returned by saveDeck.
function describeSaveError(reason) {
  switch (reason) {
    case 'QuotaExceededError':
      return '💾 บันทึกไม่สำเร็จ — localStorage เต็ม · ลบ deck เก่าก่อน';
    case 'storage-unavailable':
      return '💾 บันทึกไม่สำเร็จ — เบราว์เซอร์ปิด localStorage (เช่น Private/Incognito mode)';
    case 'serialization-failed':
      return '💾 บันทึกไม่สำเร็จ — แปลงข้อมูลไม่ได้ · ลองสร้าง deck ใหม่';
    case 'invalid-input':
      return '💾 บันทึกไม่สำเร็จ — ข้อมูล deck ไม่ครบ';
    default:
      return '💾 บันทึกไม่สำเร็จ — ลองอีกครั้ง';
  }
}

const ImageOcclusionEditor = lazy(() => import('./ImageOcclusionEditor.jsx'));

function formatThaiDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return ''; }
}

function DeckCard({ deck, onOpen, onDelete }) {
  return (
    <div
      style={{
        border: '1px solid var(--clr-border)',
        borderRadius: 12,
        background: 'var(--clr-surface)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        transition: 'transform 120ms ease, box-shadow 120ms ease',
      }}
      onClick={() => onOpen(deck)}
    >
      <div style={{ position: 'relative', aspectRatio: '16 / 10', background: '#0a0a0a', overflow: 'hidden' }}>
        {deck.imageDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={deck.imageDataUrl} alt={deck.name} draggable={false}
               style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666' }}>
            (ไม่มีรูป)
          </div>
        )}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none"
             style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {(deck.masks || []).map((m) => (
            <rect key={m.id} x={m.x * 100} y={m.y * 100} width={m.w * 100} height={m.h * 100}
                  fill="#0369a1" fillOpacity={0.65} stroke="#075985" strokeWidth={0.2} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--clr-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {deck.name}
          </div>
          <div style={{ fontSize: 12, color: 'var(--clr-ink-soft)', marginTop: 2 }}>
            {(deck.masks?.length || 0)} กล่อง · {formatThaiDate(deck.createdAt)}
          </div>
        </div>
        <button type="button" className="vmx-btn vmx-btn-ghost vmx-btn-sm"
                style={{ minHeight: 36, minWidth: 36, padding: '0 8px' }}
                onClick={(e) => { e.stopPropagation(); onDelete(deck); }}
                aria-label={`ลบ ${deck.name}`}
                title="ลบ deck">🗑</button>
      </div>
    </div>
  );
}

export default function OcclusionView() {
  const [decks, setDecks] = useState([]);
  const [editing, setEditing] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState('');
  // Persistent error banner — survives until the user dismisses or retries.
  // Distinct from `toast` (which auto-dismisses) because quota/storage errors
  // need user action (delete a deck, exit private mode) to resolve.
  const [saveError, setSaveError] = useState('');

  // SSR-safe initial load.
  // queueMicrotask defers the hydration setState past React's "no setState
  // sync in effect" guard. The event-driven onChange/onStorage callbacks
  // below run in their own ticks (already user-initiated) so they don't
  // need the wrap. Behavior is unchanged — decks appear one microtask
  // later, well before the next paint.
  useEffect(() => {
    queueMicrotask(() => setDecks(loadDecks()));
    const onChange = () => setDecks(loadDecks());
    window.addEventListener(IMAGE_OCCLUSION_EVENT, onChange);
    const onStorage = (e) => {
      if (e.key === null || e.key === 'vmx-image-occlusion-decks') onChange();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(IMAGE_OCCLUSION_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const openNew = useCallback(() => setEditing({}), []);
  const openExisting = useCallback((deck) => {
    touchDeck(deck.id);
    setEditing(deck);
  }, []);

  const handleSave = useCallback((deckPayload) => {
    const result = saveDeck(deckPayload);
    if (!result.ok) {
      // Persistent banner — quota/private-mode errors need user action.
      setSaveError(describeSaveError(result.reason));
      // Return false so the Editor stays open and shows its own inline toast.
      return false;
    }
    // Clear any prior error since this save succeeded.
    setSaveError('');
    setDecks(loadDecks());
    setEditing(null);
    const evictedNote = result.evicted ? ` (ลบ deck เก่า ${result.evicted} อัน)` : '';
    setToast(`บันทึก "${result.deck.name}" แล้ว (${result.deck.masks.length} กล่อง)${evictedNote}`);
    return result.deck;
  }, []);

  const handleDelete = useCallback((deck) => {
    if (!confirm(`ลบ deck "${deck.name}" ใช่ไหม? การลบนี้ย้อนกลับไม่ได้`)) return;
    deleteDeck(deck.id);
    setDecks(loadDecks());
    setToast(`ลบ "${deck.name}" แล้ว`);
    // A delete frees space — if the user was blocked by quota, let them retry.
    setSaveError('');
  }, []);

  const onDropFile = useCallback((file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setToast('ไฟล์ไม่ใช่รูป');
      return;
    }
    // Phase 8 security: drag-drop bypasses <input accept>, so re-check
    // here. SVG can embed <script>/<foreignObject>; raster-only is safe
    // bytes-not-code. Mirrors the accept attribute on the file input.
    if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
      setToast('SVG ไม่รองรับ — ใช้ PNG / JPG / WebP เท่านั้น');
      return;
    }
    setEditing({ _bootstrapFile: file });
  }, []);

  if (editing !== null) {
    return (
      <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>กำลังโหลด editor…</div>}>
        <EditorBootstrap
          initial={editing}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      </Suspense>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {/* Focus-visible ring for the keyboard-activated upload label — uses
          cyan tool color to match brand. :focus-within fires when the hidden
          input inside the label gains focus via Tab. */}
      <style>{`
        .occlusion-empty-dropzone:focus-within {
          outline: 2px solid var(--clr-sage);
          outline-offset: 4px;
        }
      `}</style>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '14px 14px 80px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Link href="/" className="vmx-btn vmx-btn-ghost vmx-btn-sm" style={{ minHeight: 44, textDecoration: 'none' }}>
            ← หน้าแรก
          </Link>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--clr-ink)' }}>
              🖼 Image Occlusion
            </h1>
            <div style={{ fontSize: 12, color: 'var(--clr-ink-soft)', marginTop: 2 }}>
              อัปโหลดรูป → วาดกล่องทับ label → กลายเป็น flashcard อัตโนมัติ
            </div>
          </div>
          {decks.length > 0 && (
            <button type="button" className="vmx-btn vmx-btn-primary vmx-btn-sm" style={{ minHeight: 44 }} onClick={openNew}>
              + สร้าง deck
            </button>
          )}
        </div>

        {saveError && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              marginBottom: 14,
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid var(--clr-rose)',
              background: 'rgba(255, 77, 109, 0.10)',
              color: 'var(--clr-ink)',
              fontSize: 13,
              lineHeight: 1.5,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{saveError}</div>
              <div style={{ fontSize: 12, color: 'var(--clr-ink-soft)' }}>
                ข้อมูลใน editor ยังอยู่ — ลบ deck เก่าหรือเปลี่ยน browser แล้วลองบันทึกอีกครั้ง
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSaveError('')}
              aria-label="ปิดข้อความแจ้งเตือน"
              style={{
                minHeight: 44, minWidth: 44,
                background: 'transparent', color: 'var(--clr-ink-soft)',
                border: '1px solid transparent', borderRadius: 8,
                cursor: 'pointer', fontSize: 18, lineHeight: 1,
              }}
              title="ปิด"
            >
              ✕
            </button>
          </div>
        )}

        {decks.length === 0 ? (
          // A11y fix: <label> wraps a real (visually-hidden) <input type="file">
          // so screen readers announce the upload purpose, Tab focuses the
          // input, and Enter/Space opens the picker — all native browser
          // behavior. Drag-drop handlers stay on the label so the visual
          // affordance is unchanged.
          <label
            htmlFor="occlusion-bootstrap-file"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              onDropFile(e.dataTransfer?.files?.[0]);
            }}
            style={{
              display: 'block',
              border: `2px dashed ${dragOver ? 'var(--clr-sage)' : 'var(--clr-border)'}`,
              borderRadius: 14, padding: '60px 20px', textAlign: 'center', cursor: 'pointer',
              background: dragOver ? 'var(--clr-sage-soft)' : 'var(--clr-surface)',
              color: 'var(--clr-ink-soft)', marginTop: 20,
              outlineOffset: 4,
            }}
            className="occlusion-empty-dropzone"
          >
            <input
              id="occlusion-bootstrap-file"
              type="file"
              // Phase 8 security: SVG removed from accept list. SVG can carry
              // <script> + foreignObject HTML, so user-supplied SVG = XSS
              // surface. Raster-only inputs are bytes-not-code, safe.
              accept="image/png,image/jpeg,image/jpg,image/webp"
              aria-label="อัปโหลดรูปเพื่อสร้าง image occlusion deck — รองรับ PNG, JPG, WebP"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onDropFile(f);
                // Cancel (no file picked) is a no-op — user stays on home.
                // Reset so re-selecting the same file re-fires onChange.
                e.target.value = '';
              }}
              // Visually hidden but Tab-focusable + screen-reader visible.
              style={{
                position: 'absolute',
                width: 1, height: 1,
                padding: 0, margin: -1,
                overflow: 'hidden', clip: 'rect(0 0 0 0)',
                whiteSpace: 'nowrap', border: 0,
              }}
            />
            <div style={{ fontSize: 48, marginBottom: 12 }} aria-hidden="true">🖼</div>
            <div style={{ fontWeight: 600, color: 'var(--clr-ink)', fontSize: 18, marginBottom: 6 }}>
              📷 สร้าง deck แรก
            </div>
            <div style={{ fontSize: 14, marginBottom: 12 }}>
              คลิกที่นี่ หรือ ลากรูปมาวาง · รองรับ PNG / JPG / WebP
            </div>
            <div style={{ fontSize: 12, color: 'var(--clr-ink-soft)' }}>
              เหมาะกับ anatomy lateral · radiograph · histology · microbe colony plate
            </div>
          </label>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
            {decks.map((d) => (
              <DeckCard key={d.id} deck={d} onOpen={openExisting} onDelete={handleDelete} />
            ))}
          </div>
        )}

        <div style={{ marginTop: 20, fontSize: 12, color: 'var(--clr-ink-soft)', textAlign: 'center' }}>
          {decks.length}/30 decks · เก็บใน localStorage ของ device นี้เท่านั้น
        </div>
      </div>

      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 'calc(24px + env(safe-area-inset-bottom))',
          left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '10px 16px',
          borderRadius: 999, fontSize: 13, zIndex: 9999, maxWidth: '90%',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function EditorBootstrap({ initial, onSave, onClose }) {
  const [resolved, setResolved] = useState(() => {
    if (initial && initial._bootstrapFile) return null;
    return initial && initial.id ? initial : null;
  });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!initial || !initial._bootstrapFile) return;
    const reader = new FileReader();
    reader.onload = () => {
      setResolved({ imageDataUrl: reader.result, masks: [], name: '' });
    };
    reader.onerror = () => setError('อ่านไฟล์ไม่ได้');
    reader.readAsDataURL(initial._bootstrapFile);
  }, [initial]);

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--clr-rose)' }}>
        {error}
        <div style={{ marginTop: 12 }}>
          <button type="button" className="vmx-btn vmx-btn-ghost" onClick={onClose}>ปิด</button>
        </div>
      </div>
    );
  }

  return (
    <ImageOcclusionEditor
      initialDeck={resolved}
      onSave={onSave}
      onClose={onClose}
    />
  );
}
