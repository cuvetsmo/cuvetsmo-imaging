'use client';
// Phase 9 (Agent ①) — extracted from DicomViewport.jsx (engine setup).
//
// Owns the Cornerstone3D rendering-engine lifecycle for one viewport:
//   • Lazy init of Cornerstone (worker + image loader)
//   • Engine + StackViewport + ToolGroup creation under unique
//     `engineSeq++` ids (Strict-Mode double-mount safe — cleanup
//     destroys the prior engine before the next render reuses refs)
//   • Default tool bindings (W/L primary, Pan auxiliary, Zoom secondary)
//   • Conditional StackScrollTool wheel binding in stack mode
//   • Smart-contrast auto W/L via the P1-P99 quantile sampler
//   • PatientSpeciesDescription parse (used by VHS overlay)
//   • Status / errorMsg / meta / species state
//
// State sliceIdx/activeTool/activePreset stay in the parent because
// many other places (keyboard, tool clicks, sync) mutate them — the
// engine effect only writes the INITIAL value of each. Setters arrive
// as parameters so the engine effect can fire the same initial writes
// it always has.

import { useEffect, useState } from 'react';
import { RenderingEngine, Enums } from '@cornerstonejs/core';
import {
  ToolGroupManager,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';
import dicomParser from 'dicom-parser';
import {
  ensureCornerstoneInit,
  getDicomImageLoader,
} from '../cornerstone-init.js';

let engineSeq = 0;

// Sample the pixel histogram + set voiRange from P1–P99. Way more
// reliable than the DICOM-tag default (which is often the full bit
// range = washed out). Sampled (~20 k) not full-image, so it's cheap
// even on 4k DR images.
//
// NOTE: callers that want the cyan preset ring to stay active MUST
// gate this call with `isApplyingPresetRef.current = true` and reset
// the flag in a `queueMicrotask` — `viewport.setProperties` fires
// `VOI_MODIFIED` synchronously within the same task, so a microtask
// boundary is the tightest valid suppression window.
export function applySmartContrast(viewport) {
  try {
    const img = viewport?.csImage;
    if (!img?.getPixelData) return false;
    const pixels = img.getPixelData();
    const N = pixels.length;
    if (N === 0) return false;
    const sampleSize = Math.min(20000, N);
    const stride = Math.max(1, Math.floor(N / sampleSize));
    const samples = [];
    for (let i = 0; i < N; i += stride) samples.push(pixels[i]);
    if (samples.length < 10) return false;
    samples.sort((a, b) => a - b);
    const p1 = samples[Math.floor(samples.length * 0.01)];
    const p99 = samples[Math.floor(samples.length * 0.99)];
    if (p99 <= p1) return false;
    viewport.setProperties({ voiRange: { lower: p1, upper: p99 } });
    viewport.render();
    return true;
  } catch {
    return false;
  }
}

export function useDicomEngine({
  // File inputs.
  filesArray,
  primaryFile,
  filesKey,
  isStackMode,
  // Tool registry — id → { cls, label, sk } (W/L, Pan, Zoom, Length,
  // Angle). Parent owns this so the selectTool callback can rebind on
  // tool switch without re-importing the Cornerstone tool classes here.
  TOOLS,
  // Refs the parent owns (shared with the rest of the viewport effects).
  elRef,
  engineRef,
  viewportIdRef,
  toolGroupIdRef,
  isApplyingPresetRef,
  pendingPresetIdRef,
  // Setters for state the parent owns.
  setSliceIdx,
  setActiveTool,
  setActivePreset,
}) {
  const [status, setStatus] = useState('init');
  const [errorMsg, setErrorMsg] = useState('');
  const [meta, setMeta] = useState(null);
  const [species, setSpecies] = useState('');

  useEffect(() => {
    if (filesArray.length === 0) return;
    let cancelled = false;
    const seq = ++engineSeq;
    const engineId = `lab-engine-${seq}`;
    const viewportId = `lab-vp-${seq}`;
    const toolGroupId = `lab-tg-${seq}`;
    viewportIdRef.current = viewportId;
    toolGroupIdRef.current = toolGroupId;

    (async () => {
      try {
        setStatus('init');
        await ensureCornerstoneInit();
        if (cancelled || !elRef.current) return;

        const loader = getDicomImageLoader();
        // Phase 5 — register every file as an imageId so the StackViewport
        // can scroll through all of them. For 1-file mode this is still a
        // single-element array (Cornerstone's STACK viewport happily renders
        // a 1-slice stack).
        const imageIds = filesArray.map((f) => loader.wadouri.fileManager.add(f));

        const engine = new RenderingEngine(engineId);
        engineRef.current = engine;
        engine.enableElement({
          viewportId,
          type: Enums.ViewportType.STACK,
          element: elRef.current,
        });
        const viewport = engine.getViewport(viewportId);
        await viewport.setStack(imageIds);
        // Always start at the first slice. Cornerstone preserves the last
        // index from any previous setStack on the same viewport (we destroy
        // the engine in cleanup so this is mostly defensive).
        setSliceIdx(0);

        const tg = ToolGroupManager.createToolGroup(toolGroupId);
        Object.values(TOOLS).forEach(({ cls }) => tg.addTool(cls.toolName));
        // Phase 5 — stack scroll tool is added regardless of mode, but only
        // bound to wheel input when we're actually in stack mode. Adding it
        // unconditionally keeps the tool group shape stable across mode
        // transitions if we add a toolbar toggle later.
        tg.addTool(StackScrollTool.toolName);
        tg.addViewport(viewportId, engineId);
        // Bindings include explicit numTouchPoints so single-finger
        // tap-and-drag on tablet/phone behaves the same as left-mouse-
        // drag — same gesture pipes through Cornerstone's normalized
        // pointer events. Pan also accepts 2-finger drag (the natural
        // touch gesture). Zoom keeps Secondary mouse only; pinch on
        // touch is suppressed by `touch-action: none` on the wrapper
        // and re-enabled implicitly when the user selects Zoom in the
        // toolbar (becomes single-tap-drag via the Primary binding).
        tg.setToolActive(WindowLevelTool.toolName, {
          bindings: [
            { mouseButton: ToolEnums.MouseBindings.Primary },
            { numTouchPoints: 1 },
          ],
        });
        tg.setToolActive(PanTool.toolName, {
          bindings: [
            { mouseButton: ToolEnums.MouseBindings.Auxiliary },
            { numTouchPoints: 2 },
          ],
        });
        tg.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }],
        });
        // Phase 5 — bind StackScroll to mouse wheel ONLY in stack mode.
        // Mouse wheel in single mode = browser scroll, which is the expected
        // behavior on a single-slice page (no slices to advance through).
        // The tool itself has Touch in supportedInteractionTypes, but we
        // handle touch ourselves via pointer events to coexist with the
        // primary-tool single-finger gesture (W/L drag, Pan).
        if (isStackMode) {
          tg.setToolActive(StackScrollTool.toolName, {
            bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }],
          });
        }

        viewport.render();

        // Try smart auto-contrast as the default presentation. Falls
        // back silently to the DICOM-tag default if csImage isn't
        // ready yet (rare; happens with stack-loader race conditions).
        // Gate the VOI_MODIFIED bounce — without the flag, the drift
        // handler would null `activePreset` back to null in the same
        // microtask we set it to 'auto'.
        requestAnimationFrame(() => {
          if (cancelled) return;
          isApplyingPresetRef.current = true;
          // AGENT-④ Phase 8 — tag the impending VOI_MODIFIED bounce
          // with the preset id so the W/L sync dispatcher can mirror
          // the cyan ring on the twin pane (when sync is on).
          pendingPresetIdRef.current = 'auto';
          try {
            const ok = applySmartContrast(viewport);
            // Mark Auto as the initial active preset only if it
            // actually applied; on failure the DICOM-tag default
            // wins and no preset is "active".
            if (ok) setActivePreset('auto');
          } finally {
            queueMicrotask(() => {
              isApplyingPresetRef.current = false;
              pendingPresetIdRef.current = null;
            });
          }
        });

        if (cancelled) return;
        const img = viewport.csImage || null;
        const dims = img?.dimensions || [img?.width, img?.height];
        // PixelSpacing for mm-calibrated measurements. Cornerstone reads
        // it from the DICOM tag; we just surface it in the status line.
        const spacing = img?.rowPixelSpacing || img?.columnPixelSpacing || null;
        setMeta({
          width: dims?.[0] ?? '?',
          height: dims?.[1] ?? '?',
          mmPerPx: spacing,
        });
        // Parse PatientSpeciesDescription (0010,2201) once, in parallel
        // with the Cornerstone load. Used by VHS overlay to pick the
        // right reference range (canine 8.5–10.5 vs feline 6.7–8.1).
        // In stack mode we read the first file — species is a study-level
        // attribute, so any instance carries the same value.
        try {
          if (primaryFile) {
            const buf = await primaryFile.arrayBuffer();
            const ds = dicomParser.parseDicom(new Uint8Array(buf));
            const sp = ds.string('x00102201') || '';
            if (!cancelled && sp) setSpecies(sp);
          }
        } catch { /* dicom-parser failed; species stays empty */ }
        setStatus('ready');
        setActiveTool('wl');
      } catch (err) {
        console.error('[DicomViewport] load error:', err);
        if (!cancelled) {
          setStatus('error');
          setErrorMsg(err?.message || String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        if (toolGroupIdRef.current) ToolGroupManager.destroyToolGroup(toolGroupIdRef.current);
        engineRef.current?.destroy();
      } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey, isStackMode]);

  return { status, errorMsg, meta, species };
}
