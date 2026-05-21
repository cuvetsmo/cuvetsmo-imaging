'use client';
import { useCallback, useRef, useState, useEffect } from 'react';

/**
 * Bulk dropzone — extends the existing LabHome dropzone with folder
 * picker + ZIP accept, plus arbitrary multi-file count.
 *
 * Composition:
 *  - Same drag-and-drop affordance as the original dropzone (drop
 *    event fires `onDrop` with the full DataTransfer so the parent
 *    can decide folder-vs-ZIP-vs-loose-file via `ingestDropPayload`).
 *  - Two file inputs (hidden):
 *      • `accept=".dcm,application/dicom,application/zip,.zip"` for
 *        single/multi-file selection
 *      • `webkitdirectory` for whole-folder selection
 *  - Two click affordances rendered inside the dropzone: "เลือกไฟล์"
 *    and "เลือกโฟลเดอร์".
 *  - Disabled state while parse is in flight (parent passes `busy`).
 *
 * Mobile-first behavior: at <=600px the file input is still tappable
 * (most mobile browsers support multi-select), but the webkitdirectory
 * picker is unsupported on iOS Safari. We show a hint when the
 * browser doesn't expose webkitdirectory.
 */
export default function BulkDropzone({ onDrop, onPick, onPickFolder, busy }) {
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [supportsWebkitDirectory, setSupportsWebkitDirectory] = useState(true);

  // Detect webkitdirectory support on mount — iOS Safari + a few
  // older Android browsers don't implement it. If unsupported we hide
  // the folder button and lean on ZIP as the bulk-import path.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    // `webkitdirectory` is a non-standard property; presence on the
    // prototype is the de-facto support check.
    const supported = 'webkitdirectory' in input || 'directory' in input;
    setSupportsWebkitDirectory(supported);
  }, []);

  // Imperatively set the non-standard `webkitdirectory` + `directory`
  // attributes on the folder input. Setting them via JSX triggers
  // React unknown-attribute warnings; setting them imperatively
  // sidesteps the warning while still producing valid HTML the
  // browser folder picker recognises.
  useEffect(() => {
    const el = folderInputRef.current;
    if (!el) return;
    try {
      el.setAttribute('webkitdirectory', '');
      el.setAttribute('directory', '');
      el.setAttribute('mozdirectory', '');
    } catch {
      /* attribute setter never throws in practice but guard anyway */
    }
  }, [supportsWebkitDirectory]);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      if (busy) return;
      // Capture the DataTransfer synchronously — it becomes stale after
      // the event handler returns, so the parent's async `onDrop` MUST
      // pull `items` and `files` before yielding to a Promise.
      onDrop?.(e.dataTransfer);
    },
    [onDrop, busy]
  );

  const onDragOver = useCallback(
    (e) => {
      e.preventDefault();
      if (!busy) setDragging(true);
    },
    [busy]
  );

  const onDragLeave = useCallback((e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragging(false);
  }, []);

  const onFileInput = useCallback(
    (e) => {
      const files = e.target.files;
      if (busy) return;
      onPick?.(files);
      // reset the input so the same file can be re-picked
      e.target.value = '';
    },
    [onPick, busy]
  );

  const onFolderInput = useCallback(
    (e) => {
      const files = e.target.files;
      if (busy) return;
      onPickFolder?.(files);
      e.target.value = '';
    },
    [onPickFolder, busy]
  );

  return (
    <label
      onDrop={handleDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      data-dragging={dragging ? 'true' : 'false'}
      data-busy={busy ? 'true' : 'false'}
      data-tour="dropzone"
      className="imaging-dropzone"
      style={busy ? { opacity: 0.55, pointerEvents: 'none' } : undefined}
    >
      <div className="px-6 py-12 sm:py-14 text-center relative z-10">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl border border-[var(--color-border-tool)] bg-[rgba(90,204,230,0.06)] mb-4 shadow-[0_0_24px_-8px_rgba(90,204,230,0.4)]">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[var(--color-tool-cyan)]"
            aria-hidden="true"
          >
            <path d="M12 3v12M12 3l-4 4M12 3l4 4" />
            <path d="M3 17v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
          </svg>
        </div>

        <div className="text-base font-semibold text-[var(--color-text)] mb-1.5 tracking-tight">
          Drop <code className="font-mono text-[var(--color-tool-cyan)] text-[0.92em]">.dcm</code>,
          {' '}โฟลเดอร์, หรือ ZIP ที่นี่
        </div>

        <div className="text-xs text-[var(--color-text-muted)] max-w-md mx-auto leading-relaxed">
          รับ multi-file batch · folder picker · ZIP archive · ลากที่นี่หรือคลิกปุ่ม
          <br />
          render ในเบราว์เซอร์ล้วน ไม่ส่งภาพขึ้น server
        </div>

        {/* Action buttons row — clicking either button opens the
            matching native picker. Wired with stopPropagation so the
            click doesn't bubble to the <label> + double-fire. */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginTop: 16,
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="imaging-btn imaging-btn-ghost"
            disabled={busy}
          >
            เลือกไฟล์
          </button>
          {supportsWebkitDirectory && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                folderInputRef.current?.click();
              }}
              className="imaging-btn imaging-btn-ghost"
              disabled={busy}
            >
              เลือกโฟลเดอร์
            </button>
          )}
        </div>

        {!supportsWebkitDirectory && (
          <p
            style={{
              fontSize: 11,
              color: 'var(--color-text-faint)',
              marginTop: 12,
              marginBottom: 0,
            }}
          >
            (เบราว์เซอร์นี้ยังไม่รองรับเลือกทั้งโฟลเดอร์ — ใช้ ZIP ได้แทน)
          </p>
        )}

        {/* Hidden inputs — wired by the buttons above. The accept attr
            includes both DICOM extensions and .zip so users can pick
            an archive. We do NOT set `webkitdirectory` on this one —
            that's the separate folder picker. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".dcm,.dicom,application/dicom,application/zip,.zip"
          multiple
          onChange={onFileInput}
          className="hidden"
        />

        {/*
          The folder picker. `webkitdirectory` is non-standard but
          supported by Chrome (since v7), Edge, Safari 11.1+, and
          Firefox 50+. iOS Safari doesn't support it (gated behind
          `supportsWebkitDirectory` above).

          `directory` is the legacy alias kept for any browser that
          implements that but not webkit-prefixed. Setting both is the
          recommended cross-browser pattern.
        */}
        <input
          ref={folderInputRef}
          type="file"
          multiple
          onChange={onFolderInput}
          className="hidden"
        />
      </div>
    </label>
  );
}
