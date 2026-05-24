'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { RenderingEngine, Enums } from '@cornerstonejs/core';
import {
  ToolGroupManager,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  LengthTool,
  AngleTool,
  StackScrollTool,
  annotation,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';
import dicomParser from 'dicom-parser';
import { ensureCornerstoneInit, getDicomImageLoader } from '../../lib/dicom/cornerstone-init.js';
import NorbergOverlay from './NorbergOverlay.jsx';
import VHSOverlay from './VHSOverlay.jsx';
import AIOverlay from './AIOverlay.jsx';
import ShortcutCheatsheet from './ShortcutCheatsheet.jsx';
import MobileToolbarSheet from './MobileToolbarSheet.jsx';
import { useMediaQuery } from '../../lib/dicom/use-media-query.js';
import {
  WL_PRESETS,
  WL_PRESET_DICOM,
  wlToVoiRange,
  formatPresetToast,
} from '../../lib/dicom/wl-presets';
import {
  TOUCH_SLICE_THRESHOLD_PX,
  clampIndex,
  formatSlicePos,
  indexFromKey,
  sliceDeltaFromTouch,
  proportionalSliceIndex,
} from '../../lib/dicom/stack-scroll';

// PRESETS = clinical W/L list (Bone · Soft · Lung · Auto) + DICOM reset.
// Numeric values are HU-based standard radiology presets — see
// lib/dicom/wl-presets.ts for textbook citations. For uncalibrated
// radiographs the Auto path (P1-P99 quantile) is the more useful
// default; the textbook values can look very high-contrast on raw
// DR pixel data, which is expected behavior.
const PRESETS = [...WL_PRESETS, WL_PRESET_DICOM];

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
function applySmartContrast(viewport) {
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

// Tool registry — id → { class, label, sk (keyboard shortcut letter) }.
// The id is what activeTool state holds; class.toolName is what
// Cornerstone stores in its tool group registry. `short` is used as
// the abbreviated label on narrow viewports.
//
// Note on shortcut keys: `L` and `A` are reserved for the W/L preset
// family (L = Lung, A = Auto W/L) per the Phase 2 brief — they're the
// canonical single-key bindings clinicians expect. Length is rebound
// to `M` (Measure) and Angle to `G` (Geometric/angle).
const TOOLS = {
  wl:     { cls: WindowLevelTool, label: '🌓 W/L',    short: '🌓 W', sk: 'W' },
  pan:    { cls: PanTool,         label: '✋ Pan',     short: '✋ P', sk: 'P' },
  zoom:   { cls: ZoomTool,        label: '🔍 Zoom',    short: '🔍 Z', sk: 'Z' },
  length: { cls: LengthTool,      label: '📏 Length',  short: '📏 M', sk: 'M' },
  angle:  { cls: AngleTool,       label: '📐 Angle',   short: '📐 G', sk: 'G' },
};

let engineSeq = 0;

export default function DicomViewport({
  file,
  files,
  mode,
  caseId = null,
  syncEnabled = false,
  // Phase 6 (Agent ⓐ) — sync-compare props.
  // syncGroupId scopes window events so two compare pairs on the same
  // page (rare today but cheap to support) don't cross-fire. Default
  // 'default' matches the legacy 2-up camera-sync behavior.
  syncGroupId = 'default',
  // paneLabel ('L' / 'R' / null) is rendered next to the slice indicator
  // pill so the user can tell at a glance which pane is which in
  // side-by-side-stack mode. Null hides the prefix (single pane / legacy).
  paneLabel = null,
  // AGENT-④ Phase 8 — per-axis sync toggles. Phase 6 used a single
  // `syncEnabled` boolean for slice + camera together; Phase 8 splits it
  // into independent axes so users can opt into W/L sync without losing
  // the slice/camera default. `syncEnabled` is preserved as a coarse
  // master gate (false = nothing syncs, regardless of per-axis flags) so
  // legacy callers and the "off" path are untouched. Defaults match Phase
  // 6 behavior (slice + camera ON, W/L OFF) for non-compare callers.
  syncSlice = true,
  syncCamera = true,
  syncWL = false,
}) {
  // Back-compat normalization. The legacy callsite passed `file: File`; the
  // Phase 5 callsite passes `files: File[]` + `mode`. Convert single → array
  // up front so the rest of the component only sees one shape. `mode` is
  // explicit when the caller wants stack scroll on a multi-file study —
  // otherwise we auto-pick: 1 file = 'single', 2+ = 'stack' (in this viewport
  // — side-by-side is handled by the PARENT mounting two viewports).
  const filesArray = files && files.length > 0
    ? files
    : (file ? [file] : []);
  const resolvedMode = mode
    || (filesArray.length <= 1 ? 'single' : 'stack');
  const isStackMode = resolvedMode === 'stack' && filesArray.length > 1;
  const sliceCount = filesArray.length;
  // Stable key for the engine effect — recompute only when the actual file
  // identities change (not every parent re-render). Comma-joined name+size
  // is unique enough; the legacy single-file path matches `file?.name`.
  const filesKey = filesArray
    .map((f) => `${f.name}-${f.size}-${f.lastModified || 0}`)
    .join('|');
  // Primary file = first slice. Used by AI/Norberg/VHS overlays which read
  // PixelSpacing / world coords from one anchor image. When the user scrolls
  // through a CT stack we keep these overlays pinned to slice 0 for now —
  // VHS / Norberg are radiograph tools so the cardiology + DJD use cases
  // are single-slice anyway. Stack scrolling is for CT/MR readers.
  const primaryFile = filesArray[0];

  const isMobile = useMediaQuery('(max-width: 600px)');
  const elRef = useRef(null);
  const engineRef = useRef(null);
  const viewportIdRef = useRef(null);
  const toolGroupIdRef = useRef(null);
  // Hoisted from below: the engine-setup effect writes `.current = true`
  // around the initial smart-W/L apply, so the ref must be declared
  // before that effect runs. See the longer note at the (former)
  // declaration site for full intent.
  const isApplyingPresetRef = useRef(false);
  // AGENT-④ Phase 8 — pending preset id for the W/L sync dispatcher.
  // applyPreset/resetView/initial-auto set this immediately before
  // calling viewport.setProperties so the synchronous VOI_MODIFIED that
  // bounces back can be tagged with the right preset id (without this,
  // onLocalVoi would read `activePreset` from closure, which is the
  // PREVIOUS preset because setActivePreset schedules an async update).
  // Null when the source of the next VOI write is a user drag (the W/L
  // sync dispatcher checks `isApplyingPresetRef.current` first — if
  // false, presetId is forced to null regardless of this ref).
  const pendingPresetIdRef = useRef(null);
  const [status, setStatus] = useState('init');
  const [errorMsg, setErrorMsg] = useState('');
  const [meta, setMeta] = useState(null);
  const [activeTool, setActiveTool] = useState('wl');
  // Current slice index (0-based) in stack mode. `setImageIdIndex` is
  // async, but we update React state synchronously on user input — the
  // STACK_NEW_IMAGE listener reconciles in case of double-fire / race.
  const [sliceIdx, setSliceIdx] = useState(0);
  // Hoisted up here (was below, but the load + selectTool callbacks
  // reference these setters; React Compiler flags use-before-declare
  // when state hooks land further down the function body).
  const [species, setSpecies] = useState('');
  // First-load nudge — small floating tip near the canvas that hints
  // the measurement workflow. Auto-fades after 6 s or on any tool
  // selection (other than the default W/L which is auto-active).
  const [showFirstHint, setShowFirstHint] = useState(false);
  // Phase 7 — mobile toolbar overflow drawer. Off-canvas bottom sheet
  // that exposes the full tool list with names + keyboard hints, so
  // the visible mobile toolbar can stay at 4 tools + a "More" entry
  // (no horizontal scroll for beginners).
  const [showMobileMore, setShowMobileMore] = useState(false);

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

  const getViewport = useCallback(() => {
    return engineRef.current?.getViewport(viewportIdRef.current);
  }, []);

  const selectTool = useCallback((tool) => {
    setActiveTool(tool);
    // First user action dismisses the hint
    setShowFirstHint(false);
    const tg = ToolGroupManager.getToolGroup(toolGroupIdRef.current);
    if (!tg) return;
    try {
      // Set every Cornerstone tool passive first so only the chosen one
      // is on Primary. Vet-specific modes (e.g. 'norberg') aren't in the
      // TOOLS map — they're handled by React overlays, and Primary stays
      // un-bound so the overlay's click handler receives events first.
      Object.values(TOOLS).forEach(({ cls }) => tg.setToolPassive(cls.toolName));
      if (TOOLS[tool]) {
        // Same dual binding pattern as initial setup — keeps touch
        // tap-and-drag working after the user switches active tools.
        tg.setToolActive(TOOLS[tool].cls.toolName, {
          bindings: [
            { mouseButton: ToolEnums.MouseBindings.Primary },
            { numTouchPoints: 1 },
          ],
        });
      }
      tg.setToolActive(PanTool.toolName, {
        bindings: [
          { mouseButton: ToolEnums.MouseBindings.Auxiliary },
          { numTouchPoints: 2 },
        ],
      });
      tg.setToolActive(ZoomTool.toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }],
      });
    } catch (err) {
      console.error('[selectTool] bind error:', err);
    }
  }, []);

  // Active preset = which W/L preset button gets the cyan ring.
  // `null` while smart-W/L initial compute is in flight or after the
  // user has manually adjusted W/L via the WindowLevelTool drag.
  const [activePreset, setActivePreset] = useState(null);
  // (isApplyingPresetRef moved to the top of the component body.
  // The longer rationale: gate the VOI_MODIFIED → setActivePreset(null)
  // drift-clear for our OWN programmatic voiRange writes (preset apply ·
  // smart auto · reset). Set true BEFORE the write, reset in a
  // queueMicrotask so any synchronous VOI_MODIFIED bounce is gated and
  // any genuine user-drag VOI events arriving in later microtasks fall
  // through.)
  // Ephemeral toast at bottom-center — fades after ~1.2 s. Cleared by
  // ID so rapid preset taps replace the previous toast instead of
  // queueing up.
  const [toast, setToast] = useState(null); // { id, message }
  const toastTimerRef = useRef(null);

  const showToast = useCallback((message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    const id = Date.now() + Math.random();
    setToast({ id, message });
    toastTimerRef.current = setTimeout(() => {
      setToast((cur) => (cur && cur.id === id ? null : cur));
      toastTimerRef.current = null;
    }, 1200);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const applyPreset = useCallback((preset) => {
    const engine = engineRef.current;
    if (!engine) return;
    const viewport = engine.getViewport(viewportIdRef.current);
    if (!viewport) return;
    // Gate the VOI_MODIFIED bounce around every programmatic write so
    // the drift-clear handler doesn't immediately null the ring we
    // just set. Microtask-reset because setProperties fires the event
    // synchronously inside the same task.
    isApplyingPresetRef.current = true;
    // AGENT-④ Phase 8 — tag the impending VOI_MODIFIED bounce with
    // the preset id so the W/L sync dispatcher can mirror the cyan
    // ring on the twin pane (when sync is on). Even reset rings the
    // toast / clears the local preset so the dispatcher fires a null
    // mirror — we use the preset.id for both regular + reset cases.
    pendingPresetIdRef.current = preset.id;
    try {
      if (preset.isReset) {
        viewport.resetProperties();
        viewport.render();
        setActivePreset(preset.id);
        showToast(formatPresetToast(preset));
        return;
      }
      if (preset.isAuto) {
        const ok = applySmartContrast(viewport);
        if (ok) {
          setActivePreset(preset.id);
          showToast(formatPresetToast(preset));
        }
        return;
      }
      if (!preset.values) return;
      const voi = wlToVoiRange(preset.values);
      viewport.setProperties({ voiRange: voi });
      viewport.render();
      setActivePreset(preset.id);
      showToast(formatPresetToast(preset));
    } finally {
      queueMicrotask(() => {
        isApplyingPresetRef.current = false;
        pendingPresetIdRef.current = null;
      });
    }
  }, [showToast]);

  // 10% zoom step per "+"/"-" press. Cornerstone3D exposes
  // get/setZoom on StackViewport — programmatic zoom plays nicely
  // with the existing ZoomTool mouse binding (they both modify the
  // camera parallelScale). Multiplicative steps keep the visual
  // feel of holding "+" consistent at any zoom level.
  const zoomBy = useCallback((factor) => {
    const engine = engineRef.current;
    if (!engine) return;
    const viewport = engine.getViewport(viewportIdRef.current);
    if (!viewport || typeof viewport.getZoom !== 'function') return;
    try {
      const z = viewport.getZoom();
      viewport.setZoom(z * factor);
      viewport.render();
    } catch (err) {
      console.error('[zoomBy] error:', err);
    }
  }, []);

  const resetView = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const viewport = engine.getViewport(viewportIdRef.current);
    if (!viewport) return;
    // `resetProperties()` rewrites voiRange to the DICOM-tag default,
    // which fires VOI_MODIFIED. We explicitly want the cyan ring to
    // clear here anyway (no preset is "the active one" after a reset),
    // but route through the flag so the drift handler doesn't double-
    // null an already-null state on the same event.
    isApplyingPresetRef.current = true;
    // AGENT-④ Phase 8 — reset clears the ring (no preset active) so we
    // tag the W/L sync bounce with null. The receiver will mirror by
    // also clearing its own ring + applying the reset's voiRange.
    pendingPresetIdRef.current = null;
    try {
      viewport.resetCamera();
      viewport.resetProperties();
      viewport.render();
      setActivePreset(null);
      showToast('Reset view');
    } finally {
      queueMicrotask(() => { isApplyingPresetRef.current = false; });
    }
  }, [showToast]);

  const [showShortcuts, setShowShortcuts] = useState(false);
  const [aiPrediction, setAiPrediction] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // (species + showFirstHint moved to the top of the component so
  // earlier-bodied callbacks/effects can reference them without
  // tripping React Compiler's use-before-declare rule.)
  useEffect(() => {
    if (status !== 'ready') return;
    // Microtask-defer the initial setState so the effect body itself
    // doesn't synchronously call setState (React Compiler rule). The
    // 6.5 s auto-hide setTimeout fires its own setState from a task
    // callback (not effect-body), which is allowed.
    queueMicrotask(() => setShowFirstHint(true));
    const t = setTimeout(() => setShowFirstHint(false), 6500);
    return () => clearTimeout(t);
  }, [status, filesKey]);

  // Track browser fullscreen so the toolbar button label flips.
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => { /* user rejected */ });
    } else {
      el.requestFullscreen?.().catch(() => { /* unsupported */ });
    }
  }, []);

  const loadAiJson = useCallback(async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      // Light validation — require predictions object somewhere
      if (!data || typeof data !== 'object' || !data.predictions) {
        throw new Error('JSON missing "predictions" key');
      }
      setAiPrediction(data);
      setAiError(null);
    } catch (err) {
      setAiError(err?.message || String(err));
      setAiPrediction(null);
    }
  }, []);

  const clearAi = useCallback(() => {
    setAiPrediction(null);
    setAiError(null);
  }, []);

  const exportPng = useCallback(async () => {
    try {
      const mod = await import('../../lib/dicom/export-image.js');
      // In stack mode, append the current slice number to the filename
      // so consecutive exports don't clobber each other.
      const baseName = (primaryFile?.name || 'dicom').replace(/\.dcm$/i, '').replace(/\.dicom$/i, '');
      const sliceSuffix = isStackMode && sliceCount > 1 ? `_slice-${sliceIdx + 1}-of-${sliceCount}` : '';
      const baseFilename = `${baseName}${sliceSuffix}_annotated`;
      await mod.exportAnnotatedPng({ containerEl: elRef.current, baseFilename });
    } catch (err) {
      console.error('[exportPng] error:', err);
    }
  }, [primaryFile, isStackMode, sliceCount, sliceIdx]);

  const clearMeasurements = useCallback(() => {
    // Clear both Cornerstone annotations (Length/Angle) and any custom
    // overlays (Norberg/VHS) by dispatching a custom event that the
    // overlay components listen for. Simpler than threading a callback
    // through every overlay child.
    try {
      const all = annotation.state.getAllAnnotations();
      all.forEach((a) => annotation.state.removeAnnotation(a.annotationUID));
    } catch (err) {
      console.error('[clearMeasurements] error:', err);
    }
    try {
      window.dispatchEvent(new CustomEvent('vmx-lab-clear-overlays'));
    } catch { /* noop */ }
    const engine = engineRef.current;
    const viewport = engine?.getViewport(viewportIdRef.current);
    viewport?.render();
  }, []);

  const navTools = ['wl', 'pan', 'zoom'];
  const measureTools = ['length', 'angle'];

  // Camera-sync for 2-up compare. When LabView turns sync on, each
  // viewport emits its own camera changes via window events and
  // applies remote ones (skipping its own ID to avoid feedback).
  // The `isApplying` flag suppresses the bounce — without it, an
  // incoming setCamera() would trigger CAMERA_MODIFIED locally which
  // would emit again → infinite loop. requestAnimationFrame resets
  // the flag AFTER the local CAMERA_MODIFIED bounce arrives.
  //
  // Phase 6 (Agent ⓐ) — extended to also sync STACK_NEW_IMAGE (slice
  // index) when both panes are in stack mode. Two separate
  // `isApplying` flags so a slice-change doesn't accidentally gate
  // the user's NEXT camera adjustment (and vice-versa) — the bounces
  // are independent events on the same element.
  //
  // syncGroupId scopes the window events so multiple compare pairs
  // could coexist on the page. The detail payload carries `totalSlices`
  // so the receiver can map proportionally when stack lengths differ
  // (e.g. compare a 36-slice C-spine to a 40-slice repeat).
  //
  // AGENT-④ Phase 8 — slice + camera now gated INDEPENDENTLY via the
  // per-axis `syncSlice` / `syncCamera` props (defaults preserve Phase 6
  // behavior). `syncEnabled` stays the master gate; a per-axis flag of
  // false just means the corresponding listener pair is not attached, so
  // events from the twin pane on that axis are ignored on this side AND
  // we don't dispatch our own. Both directions are necessary — otherwise
  // a one-sided opt-out would still receive incoming updates on the off
  // axis. (W/L sync lives in its own effect just below — separate `isApplying`
  // closure so it can't gate slice/camera bounces and vice-versa.)
  useEffect(() => {
    if (!syncEnabled || status !== 'ready') return;
    if (!syncSlice && !syncCamera) return; // nothing to attach
    const element = elRef.current;
    if (!element) return;
    const myId = viewportIdRef.current;
    let isApplyingCamera = false;
    let isApplyingSlice = false;
    // Resolve the sync channel name once. 'default' keeps the legacy
    // event name so older callers (Phase 5 2-up compare) still get
    // delivered. Any other group ID gets a per-group suffix.
    const cameraEvent = syncGroupId === 'default'
      ? 'vmx-lab-sync-camera'
      : `vmx-lab-sync-camera:${syncGroupId}`;
    const sliceEvent = syncGroupId === 'default'
      ? 'vmx-lab-sync-slice'
      : `vmx-lab-sync-slice:${syncGroupId}`;

    const onCameraChange = () => {
      if (isApplyingCamera) return;
      const vp = engineRef.current?.getViewport(myId);
      if (!vp) return;
      try {
        const cam = vp.getCamera();
        window.dispatchEvent(new CustomEvent(cameraEvent, {
          detail: { sourceId: myId, syncGroupId, camera: cam },
        }));
      } catch { /* viewport torn down mid-event */ }
    };

    const onRemoteCamera = (evt) => {
      if (!evt?.detail || evt.detail.sourceId === myId) return;
      if (evt.detail.syncGroupId && evt.detail.syncGroupId !== syncGroupId) return;
      const vp = engineRef.current?.getViewport(myId);
      if (!vp) return;
      try {
        isApplyingCamera = true;
        vp.setCamera(evt.detail.camera);
        vp.render();
        requestAnimationFrame(() => { isApplyingCamera = false; });
      } catch (err) {
        console.error('[viewport-sync] camera apply error:', err);
        isApplyingCamera = false;
      }
    };

    // Slice-index sync — only active when this pane is in stack mode.
    // STACK_NEW_IMAGE fires on every visible-slice change (wheel · arrows
    // · touch swipe · programmatic). We re-dispatch as a window event;
    // the twin pane catches it and calls setImageIdIndex(mapped).
    //
    // isApplyingSlice gates the bounce: when we call setImageIdIndex
    // here, STACK_NEW_IMAGE fires locally, and without the flag we'd
    // re-dispatch a window event that the twin pane already sent us →
    // ping-pong loop. requestAnimationFrame resets after the local
    // bounce arrives.
    const onLocalNewImage = () => {
      if (!isStackMode) return;
      if (isApplyingSlice) return;
      const vp = engineRef.current?.getViewport(myId);
      if (!vp || typeof vp.getCurrentImageIdIndex !== 'function') return;
      try {
        const i = vp.getCurrentImageIdIndex();
        const total = typeof vp.getNumberOfSlices === 'function'
          ? vp.getNumberOfSlices()
          : sliceCount;
        window.dispatchEvent(new CustomEvent(sliceEvent, {
          detail: { sourceId: myId, syncGroupId, sliceIdx: i, totalSlices: total },
        }));
      } catch { /* viewport torn down mid-event */ }
    };

    const onRemoteSlice = (evt) => {
      if (!evt?.detail || evt.detail.sourceId === myId) return;
      if (evt.detail.syncGroupId && evt.detail.syncGroupId !== syncGroupId) return;
      // If we're not in stack mode, ignore — there's nothing to scroll.
      if (!isStackMode) return;
      const vp = engineRef.current?.getViewport(myId);
      if (!vp || typeof vp.setImageIdIndex !== 'function') return;
      try {
        const myTotal = typeof vp.getNumberOfSlices === 'function'
          ? vp.getNumberOfSlices()
          : sliceCount;
        const target = proportionalSliceIndex(
          evt.detail.sliceIdx,
          evt.detail.totalSlices,
          myTotal,
        );
        const cur = typeof vp.getCurrentImageIdIndex === 'function'
          ? vp.getCurrentImageIdIndex()
          : -1;
        if (target === cur) return; // already there — skip the bounce entirely
        isApplyingSlice = true;
        // Eager React-state update so the indicator pill doesn't lag.
        setSliceIdx(target);
        vp.setImageIdIndex(target);
        // setImageIdIndex is async — the STACK_NEW_IMAGE bounce arrives
        // on a later task. rAF puts us comfortably past it for typical
        // load latencies; if the decode is slow the flag may flip back
        // before STACK_NEW_IMAGE fires, but the early-return on
        // (target === cur) above catches that case so no infinite loop.
        requestAnimationFrame(() => { isApplyingSlice = false; });
      } catch (err) {
        console.error('[viewport-sync] slice apply error:', err);
        isApplyingSlice = false;
      }
    };

    if (syncCamera) {
      element.addEventListener(Enums.Events.CAMERA_MODIFIED, onCameraChange);
      window.addEventListener(cameraEvent, onRemoteCamera);
    }
    if (syncSlice) {
      element.addEventListener(Enums.Events.STACK_NEW_IMAGE, onLocalNewImage);
      window.addEventListener(sliceEvent, onRemoteSlice);
    }
    return () => {
      if (syncCamera) {
        element.removeEventListener(Enums.Events.CAMERA_MODIFIED, onCameraChange);
        window.removeEventListener(cameraEvent, onRemoteCamera);
      }
      if (syncSlice) {
        element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, onLocalNewImage);
        window.removeEventListener(sliceEvent, onRemoteSlice);
      }
    };
  }, [syncEnabled, syncSlice, syncCamera, status, syncGroupId, isStackMode, sliceCount]);

  // AGENT-④ Phase 8 — W/L cross-pane sync (default OFF · opt-in).
  //
  // Mirrors the Phase 6 slice + camera pattern: subscribe to the local
  // VOI_MODIFIED event, dispatch a window event with the new voiRange so
  // the twin pane can apply the same lower/upper bounds via
  // `viewport.setProperties({ voiRange })`.
  //
  // Design notes:
  //   • Default OFF — clinicians often want different W/L per pane
  //     (bone left vs lung right on a normal-vs-cardiomegaly compare).
  //     The toggle in LabHome's chrome popover is the opt-in surface.
  //   • Separate `isApplyingWL` closure flag — DO NOT reuse the
  //     slice/camera flags. Each axis bounces independently on its own
  //     event; mixing the flags would let a slice change accidentally
  //     gate the next W/L drag (or vice-versa).
  //   • Coexists with Phase 5's `isApplyingPresetRef` — that ref gates
  //     the cyan-ring drift-clear for our OWN programmatic writes. When
  //     a remote VOI lands here, we set the preset ref true around the
  //     setProperties call so the remote's preset (if any) survives the
  //     local VOI_MODIFIED bounce instead of being cleared.
  //   • Detail payload includes an optional `presetId` — when the
  //     source pane just applied a preset, we propagate the id so the
  //     receiver can mirror the cyan ring (otherwise the receiver would
  //     get the right voiRange but show no active preset, which would
  //     visually lie). When the source is a user drag, presetId is null
  //     and the receiver's ring stays cleared/unchanged.
  useEffect(() => {
    if (!syncEnabled || !syncWL || status !== 'ready') return;
    const element = elRef.current;
    if (!element) return;
    const myId = viewportIdRef.current;
    let isApplyingWL = false;
    const wlEvent = syncGroupId === 'default'
      ? 'vmx-lab-sync-wl'
      : `vmx-lab-sync-wl:${syncGroupId}`;

    const onLocalVoi = (evt) => {
      // Our own programmatic apply just below — bounce expected, skip.
      if (isApplyingWL) return;
      // Phase 5's preset/reset gate — when WE applied a preset locally,
      // its synchronous VOI_MODIFIED bounce comes through here too. We
      // STILL want to propagate that preset to the twin (the spec says
      // "preset on left → right gets same preset" when sync ON). The
      // preset-ref is true only inside applyPreset/resetView/initial
      // smart-contrast — see the presetId snapshot below.
      const vp = engineRef.current?.getViewport(myId);
      if (!vp) return;
      // Prefer the event's range payload (Cornerstone gives it to us
      // directly); fall back to reading off the viewport for robustness.
      let voiRange = evt?.detail?.range || null;
      if (!voiRange) {
        try {
          const props = typeof vp.getProperties === 'function' ? vp.getProperties() : null;
          if (props?.voiRange) voiRange = props.voiRange;
        } catch { /* viewport torn down */ }
      }
      if (!voiRange) return;
      // Snapshot the preset id at dispatch time. We CANNOT just read
      // React's `activePreset` state via closure — by the time this
      // listener runs, `setActivePreset(preset.id)` may have scheduled
      // an update but the closure still sees the PREVIOUS render's
      // value. Use `pendingPresetIdRef.current`, which applyPreset /
      // resetView / initial-auto set SYNCHRONOUSLY right before
      // calling setProperties. When the gate is shut
      // (`isApplyingPresetRef.current === false`), the source is a
      // user drag — force presetId to null regardless of what's in
      // the ref (stale from a prior preset apply that's already over).
      const presetId = isApplyingPresetRef.current
        ? pendingPresetIdRef.current
        : null;
      try {
        window.dispatchEvent(new CustomEvent(wlEvent, {
          detail: { sourceId: myId, syncGroupId, voiRange, presetId },
        }));
      } catch { /* dispatch failed; ignore */ }
    };

    const onRemoteVoi = (evt) => {
      if (!evt?.detail || evt.detail.sourceId === myId) return;
      if (evt.detail.syncGroupId && evt.detail.syncGroupId !== syncGroupId) return;
      const vp = engineRef.current?.getViewport(myId);
      if (!vp || typeof vp.setProperties !== 'function') return;
      const { voiRange, presetId } = evt.detail;
      if (!voiRange) return;
      try {
        // Gate BOTH bounces:
        //   • isApplyingWL = true so our onLocalVoi sees this as our
        //     own write and skips re-dispatching (would create a loop).
        //   • isApplyingPresetRef.current = true so the Phase 5
        //     drift-clear handler doesn't immediately null activePreset
        //     on the synchronous VOI_MODIFIED bounce.
        isApplyingWL = true;
        isApplyingPresetRef.current = true;
        vp.setProperties({ voiRange });
        vp.render();
        // Mirror the cyan ring when the source explicitly told us so.
        // For drags (presetId === null) we leave activePreset alone — the
        // local Phase 5 drift handler is suppressed by isApplyingPresetRef
        // above, so the ring won't get cleared by the apply itself; if
        // there was no ring to begin with, nothing changes.
        if (presetId) {
          setActivePreset((cur) => (cur === presetId ? cur : presetId));
        } else {
          // User drag on the source pane — clear local ring (the W/L is
          // now drifted by definition). Matches Phase 5 drift semantics.
          setActivePreset((cur) => (cur === null ? cur : null));
        }
        // Both flags reset on the next animation frame, after the
        // synchronous VOI_MODIFIED bounce has arrived + been ignored.
        requestAnimationFrame(() => {
          isApplyingWL = false;
          isApplyingPresetRef.current = false;
        });
      } catch (err) {
        console.error('[viewport-sync] wl apply error:', err);
        isApplyingWL = false;
        isApplyingPresetRef.current = false;
      }
    };

    element.addEventListener(Enums.Events.VOI_MODIFIED, onLocalVoi);
    window.addEventListener(wlEvent, onRemoteVoi);
    return () => {
      element.removeEventListener(Enums.Events.VOI_MODIFIED, onLocalVoi);
      window.removeEventListener(wlEvent, onRemoteVoi);
    };
    // No React state read in closure — preset id is sourced from
    // pendingPresetIdRef (synchronous, not React state) so we don't
    // need to re-subscribe on every render. filesKey covers the
    // viewport-replaced case.
  }, [syncEnabled, syncWL, status, syncGroupId, filesKey]);

  // W/L drift detection — when the user drags W/L via the
  // WindowLevelTool after a preset is applied, the cyan ring should
  // clear so it doesn't lie about what's active.
  //
  // Subscribe on the viewport element (the same surface Cornerstone
  // dispatches CAMERA_MODIFIED on). `isApplyingPresetRef` gates our
  // own programmatic writes (applyPreset · resetView · initial
  // smart-contrast) — those set the flag true, do the write, and
  // reset in a `queueMicrotask` so the synchronous VOI_MODIFIED
  // bounce is suppressed but any user-drag event arriving on a later
  // tick falls through and clears the ring.
  //
  // Strict-Mode safety: effect deps are [status, file], cleanup
  // removes the listener via the SAME element ref captured at
  // subscribe time. The unique `engineSeq` IDs Agent D established
  // mean a Strict-Mode double-mount unmounts the first engine + tool
  // group cleanly; this listener follows the same lifecycle.
  useEffect(() => {
    if (status !== 'ready') return;
    const element = elRef.current;
    if (!element) return;

    const onVoiModified = () => {
      // Our own programmatic write — bounce is expected, ignore.
      if (isApplyingPresetRef.current) return;
      // User drag (or any other source we didn't gate) — the visible
      // ring is now wrong. Clear it. Silent UX: the cyan ring
      // disappearing IS the signal — no toast needed (a toast on
      // every drag-update would spam during a continuous drag).
      setActivePreset((cur) => (cur === null ? cur : null));
    };

    element.addEventListener(Enums.Events.VOI_MODIFIED, onVoiModified);
    return () => {
      element.removeEventListener(Enums.Events.VOI_MODIFIED, onVoiModified);
    };
  }, [status, filesKey]);

  // Phase 5 — programmatic slice navigation. `setImageIdIndex` is async
  // (Cornerstone fetches+decodes the next imageId), but we eagerly update
  // React state so the indicator UI feels instant. The STACK_NEW_IMAGE
  // listener below reconciles in case Cornerstone clamped or rejected the
  // index (e.g. mid-load).
  const goToSlice = useCallback((nextIdx) => {
    const engine = engineRef.current;
    if (!engine) return;
    const viewport = engine.getViewport(viewportIdRef.current);
    if (!viewport || typeof viewport.setImageIdIndex !== 'function') return;
    const total = typeof viewport.getNumberOfSlices === 'function'
      ? viewport.getNumberOfSlices()
      : sliceCount;
    const clamped = clampIndex(nextIdx, total);
    if (clamped < 0) return;
    setSliceIdx(clamped);
    // setImageIdIndex returns a promise; fire-and-forget is fine — render
    // happens automatically once the image is decoded. Failures here are
    // mostly "viewport unmounted mid-flight" which is harmless.
    try { viewport.setImageIdIndex(clamped); } catch { /* noop */ }
  }, [sliceCount]);

  // Keep React state in sync with Cornerstone's internal index. Cornerstone
  // fires STACK_NEW_IMAGE every time the visible slice changes, regardless
  // of source (our keyboard handler, the StackScrollTool wheel binding, or
  // our touch swipe). One listener catches all three input paths.
  useEffect(() => {
    if (status !== 'ready' || !isStackMode) return;
    const element = elRef.current;
    if (!element) return;
    const onNewImage = () => {
      const vp = engineRef.current?.getViewport(viewportIdRef.current);
      if (!vp || typeof vp.getCurrentImageIdIndex !== 'function') return;
      try {
        const i = vp.getCurrentImageIdIndex();
        setSliceIdx((cur) => (cur === i ? cur : i));
      } catch { /* viewport torn down */ }
    };
    element.addEventListener(Enums.Events.STACK_NEW_IMAGE, onNewImage);
    return () => {
      element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, onNewImage);
    };
  }, [status, isStackMode, filesKey]);

  // Touch swipe → slice scroll. Vertical pointer drag on the canvas
  // becomes slice navigation. Only active in stack mode AND when the
  // current primary tool is one whose drag we can safely intercept —
  // for W/L drag we yield (clinicians need that gesture), but for
  // any non-drag tool (length/angle clicks, pan-via-aux, zoom-via-secondary)
  // single-finger swipe works. Threshold = 18 px per slice.
  //
  // Implementation: use pointer events instead of touch events so we
  // get the same path on mouse + finger + pen. Cornerstone's own touch
  // bindings (numTouchPoints: 1 on the primary tool) compete for the
  // same gesture though — we ONLY take over when activeTool is `null`,
  // `pan`, `zoom` (right-button), or measurement tools that use click
  // not drag. For 'wl' (default) and 'norberg'/'vhs' overlays we yield.
  const stackSwipeRef = useRef({ active: false, startY: 0, accumY: 0 });
  useEffect(() => {
    if (status !== 'ready' || !isStackMode) return;
    const element = elRef.current;
    if (!element) return;
    // Tools whose drag we MUST yield (they use drag for their primary
    // interaction — W/L drag adjusts window/level, Pan drag pans, Length/
    // Angle drag draws the measurement line). For those, we don't intercept
    // pointer-move; the user can press Z first to free up the gesture.
    // Norberg/VHS use click placement (no drag), so they're safe to scroll.
    const yieldDragToTool = (tool) =>
      tool === 'wl' || tool === 'pan' || tool === 'length' || tool === 'angle';

    const onDown = (e) => {
      if (yieldDragToTool(activeTool)) return;
      // Multi-touch (pinch zoom) — yield to Cornerstone.
      if (e.pointerType === 'touch' && e.isPrimary === false) return;
      stackSwipeRef.current = { active: true, startY: e.clientY, accumY: 0 };
    };
    const onMove = (e) => {
      const s = stackSwipeRef.current;
      if (!s.active) return;
      const dy = e.clientY - s.startY - s.accumY;
      const step = sliceDeltaFromTouch(dy);
      if (step !== 0) {
        // Pull current index off the viewport (not React state — React
        // state can lag a frame and we'd double-step). Falls back to
        // sliceIdx if the viewport accessor isn't ready.
        const vp = engineRef.current?.getViewport(viewportIdRef.current);
        const curIdx = vp && typeof vp.getCurrentImageIdIndex === 'function'
          ? vp.getCurrentImageIdIndex()
          : sliceIdx;
        goToSlice(curIdx + step);
        s.accumY += step * TOUCH_SLICE_THRESHOLD_PX;
      }
    };
    const onUp = () => {
      stackSwipeRef.current = { active: false, startY: 0, accumY: 0 };
    };

    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);
    element.addEventListener('pointerleave', onUp);
    return () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
      element.removeEventListener('pointerleave', onUp);
    };
  }, [status, isStackMode, activeTool, goToSlice, sliceIdx]);

  // Keyboard shortcuts. Bound at the window level but skip when the
  // user is typing in a form input (so other views aren't hijacked
  // by single letters). Each viewport mounts its own listener — with
  // 2 viewports they both respond to a keypress, which gives pseudo-
  // sync tool switching for free.
  //
  // Brief-mandated bindings (Phase 2):
  //   b/s/l/a → W/L presets (Bone · Soft · Lung · Auto)
  //   +/-     → zoom in / out (10% step)
  //   r       → reset view (camera + voiRange)
  //   ?       → toggle cheatsheet overlay
  //   Esc     → close cheatsheet
  //
  // Length/Angle shortcuts moved to `m`/`g` to free up `l`/`a` for
  // the W/L family per brief.
  useEffect(() => {
    if (status !== 'ready') return;
    // Build a quick lookup from preset shortcut → preset for the
    // brief-mandated single-letter bindings.
    const presetByKey = Object.fromEntries(
      WL_PRESETS.filter((p) => p.shortcut).map((p) => [p.shortcut, p])
    );
    const onKey = (e) => {
      const t = e.target;
      if (!t) return;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      // Don't hijack OS / browser shortcuts (Cmd+L, Ctrl+R, etc).
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      // Phase 5 — stack-scroll navigation. Arrow keys, PgUp/Dn, Home/End,
      // Space. `indexFromKey` returns null for non-stack-keys so we fall
      // through to the rest of the handler normally.
      if (isStackMode && sliceCount > 1) {
        const vp = engineRef.current?.getViewport(viewportIdRef.current);
        const curIdx = vp && typeof vp.getCurrentImageIdIndex === 'function'
          ? vp.getCurrentImageIdIndex()
          : sliceIdx;
        const nextIdx = indexFromKey(e.key, e.shiftKey, curIdx, sliceCount);
        if (nextIdx !== null && nextIdx !== curIdx) {
          goToSlice(nextIdx);
          e.preventDefault();
          return;
        }
        // null = not a stack-scroll key, fall through. Same-index = no-op
        // (e.g. ArrowUp at slice 0), still preventDefault so the page
        // doesn't scroll.
        if (nextIdx !== null) {
          e.preventDefault();
          return;
        }
      }

      const k = e.key.toLowerCase();
      const sk = e.shiftKey;

      // Tool switches (single letters). Length/Angle moved to m/g
      // so L and A are free for the W/L preset family.
      const toolMap = {
        w: 'wl',
        p: 'pan',
        z: 'zoom',
        m: 'length',
        g: 'angle',
        n: 'norberg',
        v: 'vhs',
      };
      if (toolMap[k]) {
        selectTool(toolMap[k]);
        e.preventDefault();
        return;
      }

      // W/L preset shortcuts (b/s/l/a) per brief.
      if (presetByKey[k]) {
        applyPreset(presetByKey[k]);
        e.preventDefault();
        return;
      }

      // Zoom in/out. `+` arrives as "=" without shift on US keyboards;
      // handle both raw keys and the post-shift forms.
      if (k === '+' || (k === '=' && !sk) || (k === '=' && sk)) {
        zoomBy(1.1);
        e.preventDefault();
        return;
      }
      if (k === '-' || k === '_') {
        zoomBy(1 / 1.1);
        e.preventDefault();
        return;
      }

      // Numbered preset shortcuts (1-5) — kept as a parallel path
      // for muscle memory from the previous version of the toolbar.
      // Preset order: Bone(1) Soft(2) Lung(3) Auto(4) DICOM(5).
      if (k >= '1' && k <= '5') {
        const idx = parseInt(k, 10) - 1;
        if (PRESETS[idx]) applyPreset(PRESETS[idx]);
        e.preventDefault();
        return;
      }

      switch (k) {
        case 'r':
          resetView();
          e.preventDefault();
          return;
        case 'c':
          clearMeasurements();
          showToast('Cleared measurements');
          e.preventDefault();
          return;
        case 'e':
          exportPng();
          e.preventDefault();
          return;
        case 'f':
          toggleFullscreen();
          e.preventDefault();
          return;
        case 'u':
          try { window.dispatchEvent(new CustomEvent('vmx-lab-undo-point')); } catch { /* noop */ }
          e.preventDefault();
          return;
        case '?':
          setShowShortcuts((s) => !s);
          e.preventDefault();
          return;
        case '/':
          if (sk) {
            setShowShortcuts((s) => !s);
            e.preventDefault();
          }
          return;
        case 'escape':
          setShowShortcuts(false);
          // Don't preventDefault — Esc may also be used by browser
          // fullscreen exit, and the ShortcutCheatsheet has its own
          // capturing Esc handler when open.
          return;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    status,
    selectTool,
    resetView,
    clearMeasurements,
    exportPng,
    applyPreset,
    toggleFullscreen,
    zoomBy,
    showToast,
    // Phase 5 — stack-scroll deps
    isStackMode,
    sliceCount,
    sliceIdx,
    goToSlice,
  ]);

  // Phase 7 — Pattern A: segmented mobile toolbar with bottom-sheet
  // drawer. On phone-width viewports we show the 4 most-used tools
  // (Pan · W/L · Zoom · Reset) plus a "⋯ More" trigger; the drawer
  // exposes every other tool with full name + keyboard shortcut.
  // Desktop keeps the full flat toolbar — no regression.
  return (
    <div>
      {status === 'ready' && isMobile && (
        <div style={toolbarMobileStyle}>
          {/* 4 visible primary tools at 375px. Order tuned for radiograph
              workflow: Pan / Zoom / W/L are the constant-use trio; Reset
              is the "undo my exploration" escape hatch.
              Labels use emoji + 1-3 char text so 5 buttons (4 tools + More)
              comfortably fit a 375px viewport with no horizontal scroll.
              Active tool gets the cyan ring via TBtn's active prop;
              long-press / hover surfaces the full name via title attr. */}
          <TBtn
            active={activeTool === 'pan'}
            onClick={() => selectTool('pan')}
            title="Pan — drag to move the image (P)"
          >✋ Pan</TBtn>
          <TBtn
            active={activeTool === 'zoom'}
            onClick={() => selectTool('zoom')}
            title="Zoom — pinch or drag to zoom (Z)"
          >🔍 Zoom</TBtn>
          <TBtn
            active={activeTool === 'wl'}
            onClick={() => selectTool('wl')}
            title="Window/Level — drag to brighten or darken (W)"
          >🌓 W/L</TBtn>
          <TBtn
            onClick={resetView}
            title="Reset view — restore zoom/pan/W/L (R)"
          >↺</TBtn>
          {/* Stack-scroll prev/next live in the More drawer on mobile
              along with the slice indicator pill, so the primary row
              isn't reordered when a CT study loads.
              The More trigger uses a muted border so it doesn't compete
              visually with active-tool styling. Always present. */}
          <button
            type="button"
            onClick={() => setShowMobileMore(true)}
            aria-label="แสดงเครื่องมือเพิ่ม"
            aria-haspopup="dialog"
            aria-expanded={showMobileMore}
            title="More tools — Length · Angle · Norberg · VHS · presets · export · AI"
            style={moreBtnStyle}
          >⋯ More</button>
        </div>
      )}
      {status === 'ready' && !isMobile && (
        <div style={toolbarStyle}>
          <span style={labelStyle}>Nav:</span>
          {navTools.map((t) => (
            <TBtn key={t} active={activeTool === t} onClick={() => selectTool(t)} title={`${TOOLS[t].label} — shortcut (${TOOLS[t].sk})`}>
              {TOOLS[t].label}
            </TBtn>
          ))}
          {/* Phase 5 — stack-scroll controls. Only render when there's a
              real stack to navigate (mode === 'stack' AND >1 slice). The
              indicator pill doubles as a label + status (e.g. "📚 12 / 200").
              Prev/Next buttons give mobile users a tap target equivalent to
              the arrow keys; keyboard shortcut hint is in the title. */}
          {isStackMode && sliceCount > 1 && (
            <>
              <Divider />
              <TBtn
                onClick={() => goToSlice(sliceIdx - 1)}
                title="Previous slice (↑ / ← / PgUp -10)"
                ariaPressed={false}
              >◀</TBtn>
              <span
                style={sliceIndicatorStyle}
                aria-live="polite"
                aria-label={`${paneLabel ? `${paneLabel} pane, ` : ''}Slice ${sliceIdx + 1} of ${sliceCount}`}
                title="Slice indicator — use ↑/↓ arrows, PgUp/PgDn, Home/End, or scroll"
              >
                {paneLabel ? `${paneLabel}: ` : '📚 Slice '}
                {formatSlicePos(sliceIdx, sliceCount)}
              </span>
              <TBtn
                onClick={() => goToSlice(sliceIdx + 1)}
                title="Next slice (↓ / → / PgDn +10)"
                ariaPressed={false}
              >▶</TBtn>
            </>
          )}
          <Divider />
          <span style={labelStyle}>Measure:</span>
          {measureTools.map((t) => (
            <TBtn key={t} active={activeTool === t} onClick={() => selectTool(t)} title={`${TOOLS[t].label} — shortcut (${TOOLS[t].sk})`}>
              {TOOLS[t].label}
            </TBtn>
          ))}
          <TBtn onClick={clearMeasurements} title="Clear all measurements (C)">🗑 Clear</TBtn>
          <Divider />
          <span style={labelStyle}>W/L:</span>
          {PRESETS.map((p, i) => {
            const sk = p.shortcut ? p.shortcut.toUpperCase() : String(i + 1);
            const title = `${p.label} — ${p.description}${p.shortcut ? ` (${sk})` : ''}`;
            const isActive = activePreset === p.id;
            return (
              <TBtn
                key={p.id}
                active={isActive}
                preset
                onClick={() => applyPreset(p)}
                title={title}
              >
                {p.label}
              </TBtn>
            );
          })}
          <Divider />
          <span style={labelStyle}>Vet:</span>
          <TBtn active={activeTool === 'norberg'} onClick={() => selectTool('norberg')} title="Norberg angle (N) — 4-click">
            🦴 Norberg
          </TBtn>
          <TBtn active={activeTool === 'vhs'} onClick={() => selectTool('vhs')} title="Vertebral Heart Score (V) — 6-click">
            💗 VHS
          </TBtn>
          <Divider />
          <span style={labelStyle}>AI:</span>
          <label className="vmx-btn" style={aiBtnLabelStyle} title="Load AI prediction JSON for this image">
            🤖 Load AI
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => loadAiJson(e.target.files?.[0])}
              style={{ display: 'none' }}
            />
          </label>
          {aiPrediction && <TBtn onClick={clearAi} title="Clear AI overlay">✕ Clear AI</TBtn>}
          <Divider />
          <TBtn onClick={exportPng} title="Export annotated PNG (E)">📤 Export PNG</TBtn>
          <TBtn onClick={toggleFullscreen} title={isFullscreen ? 'ออก fullscreen (F or Esc)' : 'เปิด fullscreen (F)'}>
            {isFullscreen ? '⤢ Exit FS' : '⛶ Fullscreen'}
          </TBtn>
          <TBtn onClick={resetView} title="Reset view (R)">↺ Reset view</TBtn>
          <TBtn onClick={() => setShowShortcuts((s) => !s)} title="Keyboard shortcuts (?)">⌨</TBtn>
        </div>
      )}
      {/* Phase 7 — mobile More drawer (bottom-sheet). Mounted only on
          mobile to avoid creating a tab-trap for desktop keyboard users.
          Hands off every action it triggers via the same selectTool /
          applyPreset / etc. callbacks the desktop toolbar uses. */}
      {isMobile && (
        <MobileToolbarSheet
          open={showMobileMore}
          onClose={() => setShowMobileMore(false)}
          activeTool={activeTool}
          activePreset={activePreset}
          isStackMode={isStackMode}
          sliceCount={sliceCount}
          sliceIdx={sliceIdx}
          paneLabel={paneLabel}
          selectTool={selectTool}
          applyPreset={applyPreset}
          presets={PRESETS}
          measureTools={measureTools}
          clearMeasurements={clearMeasurements}
          goToSlice={goToSlice}
          exportPng={exportPng}
          toggleFullscreen={toggleFullscreen}
          isFullscreen={isFullscreen}
          loadAiJson={loadAiJson}
          aiPrediction={aiPrediction}
          clearAi={clearAi}
          openShortcuts={() => setShowShortcuts(true)}
        />
      )}
      {aiError && (
        <div style={{
          background: 'rgba(255, 77, 109, 0.10)',
          border: '1px solid rgba(255, 77, 109, 0.32)',
          color: 'var(--color-active-red)',
          padding: '4px 10px',
          fontSize: '0.78rem',
          borderRadius: 4,
          marginBottom: 4,
        }}>
          ⚠️ AI JSON parse error: {aiError}
        </div>
      )}

      <ShortcutCheatsheet
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
        sections={cheatsheetSections}
      />
      <div
        ref={elRef}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => {
          // Allow JSON drops without intercepting Cornerstone's
          // pointer/measurement events (which use pointerdown/move).
          if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => {
          const f = e.dataTransfer?.files?.[0];
          if (!f) return;
          if (/\.json$/i.test(f.name) || f.type === 'application/json') {
            e.preventDefault();
            loadAiJson(f);
          }
          // Drop of non-JSON file = ignored. New DICOMs must use the
          // home drop zone (we don't want to silently replace the
          // currently-rendered image).
        }}
        style={{
          width: '100%',
          // Adaptive: at least 400 px, at most 900 px, prefer viewport
          // minus chrome (~260 px = page header + toolbar + status
          // footer). Solves the "viewport hidden under fold on a
          // small laptop" complaint without overflowing on tall
          // monitors. Cornerstone3D resizes canvas to match.
          height: 'clamp(380px, calc(100vh - 260px), 900px)',
          background: 'var(--color-surface-3)',
          borderRadius: status === 'ready' ? '0 0 8px 8px' : 8,
          position: 'relative',
          overflow: 'hidden',
          touchAction: 'none',
        }}
      >
        {status === 'init' && (
          <div style={overlay}>
            <div style={spinnerStyle}>🔬</div>
            <div>กำลังโหลด DICOM{isStackMode && sliceCount > 1 ? ` (${sliceCount} slices)` : ''}...</div>
            <div style={{ fontSize: '0.72rem', marginTop: 6, opacity: 0.6 }}>
              {primaryFile?.name} · {(primaryFile?.size / 1024 | 0)} KB
              {isStackMode && sliceCount > 1 && <> + {sliceCount - 1} more</>}
            </div>
          </div>
        )}
        {status === 'error' && (
          <div style={{ ...overlay, color: 'var(--color-active-red)', textAlign: 'center', padding: 20 }}>
            ❌ โหลดไม่สำเร็จ<br />
            <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>{errorMsg}</span>
          </div>
        )}
        {/* `key` includes file identity so the overlay component
            unmounts + re-mounts when the user switches DICOM. Without
            this, world-space points from the previous image stay
            in state and would render at nonsense positions over
            the new image's anatomy. */}
        {status === 'ready' && aiPrediction && (
          <AIOverlay prediction={aiPrediction} viewportRef={getViewport} />
        )}
        {status === 'ready' && showFirstHint && (
          <div
            style={firstHintStyle}
            onClick={() => setShowFirstHint(false)}
            title="คลิกเพื่อปิด"
            role="status"
          >
            💡 <strong>ลองวัด:</strong>{' '}
            กด <kbd style={kbdInlineStyle}>N</kbd> Norberg,{' '}
            <kbd style={kbdInlineStyle}>V</kbd> VHS,{' '}
            <kbd style={kbdInlineStyle}>M</kbd> Length — W/L{' '}
            <kbd style={kbdInlineStyle}>B</kbd>/<kbd style={kbdInlineStyle}>S</kbd>/<kbd style={kbdInlineStyle}>L</kbd>/<kbd style={kbdInlineStyle}>A</kbd>{' '}
            <span style={{ opacity: 0.7, fontSize: '0.78em' }}>· กด <kbd style={kbdInlineStyle}>?</kbd> ดูทั้งหมด</span>
          </div>
        )}
        {/* Norberg / VHS overlays — primarily radiograph tools (single
            slice), but Phase 8 (Agent ③) extends them to per-slice
            anchoring in stack mode so a hip Norberg placed on slice 5
            of a CT stack stays pinned to slice 5 (not floating over
            lung slices when the user scrolls). currentSliceIndex +
            isStackMode let the overlays gate rendering per-slice. */}
        {/* AGENT-③ Phase 8 — pass currentSliceIndex + isStackMode for per-slice overlay anchoring */}
        {status === 'ready' && (
          <NorbergOverlay
            key={`norberg-${primaryFile?.name}-${primaryFile?.size}-${primaryFile?.lastModified || 0}`}
            active={activeTool === 'norberg'}
            viewportRef={getViewport}
            caseId={caseId}
            currentSliceIndex={sliceIdx}
            isStackMode={isStackMode}
            onJumpToSlice={goToSlice}
          />
        )}
        {status === 'ready' && (
          <VHSOverlay
            key={`vhs-${primaryFile?.name}-${primaryFile?.size}-${primaryFile?.lastModified || 0}`}
            active={activeTool === 'vhs'}
            viewportRef={getViewport}
            caseId={caseId}
            species={species}
            currentSliceIndex={sliceIdx}
            isStackMode={isStackMode}
            onJumpToSlice={goToSlice}
          />
        )}
        {/* Phase 5 — overlay slice indicator. Bottom-center, mirrors the
            toast positioning but persistent (no fade) while in stack mode.
            Keeps the "where am I in the stack" feedback visible even when
            the user is in fullscreen and the toolbar pill is hidden.
            Phase 6 — prefixed with paneLabel (L: / R:) when in
            side-by-side-stack mode so the user can tell which pane is
            scrolling without checking the toolbar above. */}
        {status === 'ready' && isStackMode && sliceCount > 1 && (
          <div style={sliceOverlayStyle} aria-hidden>
            {paneLabel ? `${paneLabel}: ` : ''}{formatSlicePos(sliceIdx, sliceCount)}
          </div>
        )}
        {/* Ephemeral toast — keyed on toast.id so each new toast
            restarts the CSS animation rather than continuing the
            previous one. */}
        {toast && (
          <div
            key={toast.id}
            style={toastStyle}
            aria-live="polite"
            role="status"
          >
            {toast.message}
          </div>
        )}
      </div>
      {meta && status === 'ready' && (
        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: 8 }}>
          📐 {meta.width} × {meta.height} pixels
          {meta.mmPerPx && (
            <> · calibrated at <strong>{meta.mmPerPx.toFixed(3)} mm/pixel</strong> (PixelSpacing tag)</>
          )}
          · Phase 6 · 🦴 Norberg + 📐 VHS ใน toolbar
        </div>
      )}
      {meta && status === 'ready' && (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-faint)', marginTop: 4 }}>
          เลือก 📏 Length หรือ 📐 Angle จาก toolbar แล้วลากบนภาพ — ผลแสดงเป็น mm จาก PixelSpacing tag. ลากซ้าย = active tool, กลาง = pan, ขวา = zoom.
        </div>
      )}
    </div>
  );
}

function TBtn({ active, onClick, children, title, preset, ariaPressed }) {
  // Preset buttons use a cyan ring (rather than active-bg) for the
  // "currently applied preset" indication — visually distinct from
  // the "currently selected tool" cyan-tinted bg state. Matches the
  // OHIF-dark clinical theme of the imaging lab — all colors come
  // from globals.css tokens so theme overrides flow through.
  const style = preset
    ? {
        minHeight: 36,
        padding: '6px 11px',
        background: 'var(--color-surface-lift)',
        color: 'var(--color-text)',
        border: '1px solid var(--color-border-bright)',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: '0.82rem',
        whiteSpace: 'nowrap',
        lineHeight: 1.3,
        // Cyan ring when this preset is the active one.
        boxShadow: active
          ? '0 0 0 2px var(--color-tool-cyan), 0 0 0 4px rgba(90, 204, 230, 0.18)'
          : 'none',
        outline: 'none',
      }
    : {
        minHeight: 36,
        padding: '6px 11px',
        background: active
          ? 'rgba(90, 204, 230, 0.18)'
          : 'var(--color-surface-lift)',
        color: active
          ? 'var(--color-tool-cyan)'
          : 'var(--color-text)',
        border: active
          ? '1px solid var(--color-tool-cyan)'
          : '1px solid var(--color-border-bright)',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: '0.82rem',
        whiteSpace: 'nowrap',
        lineHeight: 1.3,
      };
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={ariaPressed ?? (preset ? !!active : undefined)}
      style={style}
    >
      {children}
    </button>
  );
}

const aiBtnLabelStyle = {
  minHeight: 36,
  padding: '6px 11px',
  background: 'var(--color-surface-lift)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border-bright)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.82rem',
  whiteSpace: 'nowrap',
  lineHeight: 1.3,
  display: 'inline-flex',
  alignItems: 'center',
};

// Phase 5 — toolbar slice indicator. Reads "📚 Slice 12 / 200" inline with
// the prev/next chevrons. Cyan ring matches the brand's active-state accent
// so it reads as a status pill rather than a clickable control. `aria-live`
// is set on the wrapping <span> so screen readers announce slice changes.
// Phase 7 — text color promoted from teal-700 (#0e7490, light-mode) to
// the brand cyan token so the pill reads on the dark OHIF-style toolbar.
const sliceIndicatorStyle = {
  minHeight: 36,
  padding: '6px 11px',
  background: 'rgba(90, 204, 230, 0.12)',
  color: 'var(--color-tool-cyan)',
  border: '1px solid rgba(90, 204, 230, 0.45)',
  borderRadius: 4,
  fontSize: '0.82rem',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  lineHeight: 1.3,
  display: 'inline-flex',
  alignItems: 'center',
  fontWeight: 600,
  letterSpacing: 0.2,
};

// Phase 5 — canvas overlay slice indicator. Bottom-center, persistent
// (not animated) while stack mode is active. Slightly larger + bolder than
// the toolbar pill so the user sees it during fullscreen scrolling when
// the toolbar is hidden. pointer-events: none so it never blocks the canvas.
const sliceOverlayStyle = {
  position: 'absolute',
  bottom: 14,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 20,
  background: 'rgba(15, 23, 42, 0.78)',
  color: 'var(--color-text)',
  padding: '6px 14px',
  borderRadius: 999,
  fontSize: '0.85rem',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '0.04em',
  pointerEvents: 'none',
  boxShadow: '0 2px 10px rgba(0,0,0,0.32)',
  whiteSpace: 'nowrap',
};

// First-load hint near the canvas, fades after 6.5 s.
const firstHintStyle = {
  position: 'absolute',
  top: 10,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 11,
  background: 'rgba(0, 0, 0, 0.78)',
  color: 'var(--color-text)',
  padding: '8px 14px',
  borderRadius: 999,
  fontSize: '0.82rem',
  pointerEvents: 'auto',
  cursor: 'pointer',
  maxWidth: '92%',
  textAlign: 'center',
  animation: 'vmx-lab-hint-fade 6.5s ease-in-out forwards',
};

const kbdInlineStyle = {
  display: 'inline-block',
  padding: '0 5px',
  background: 'var(--color-surface-lift)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border-bright)',
  borderRadius: 3,
  fontFamily: 'monospace',
  fontSize: '0.78rem',
  lineHeight: 1.3,
};

// Keyframes for first-hint fade
if (typeof document !== 'undefined' && !document.getElementById('vmx-lab-hint-keyframes')) {
  const s = document.createElement('style');
  s.id = 'vmx-lab-hint-keyframes';
  s.textContent = '@keyframes vmx-lab-hint-fade { 0% { opacity: 0; transform: translateX(-50%) translateY(-4px); } 8% { opacity: 1; transform: translateX(-50%) translateY(0); } 85% { opacity: 1; } 100% { opacity: 0; transform: translateX(-50%) translateY(-2px); } }';
  document.head.appendChild(s);
}

// Ephemeral preset/action toast — bottom-center, ~1.2 s fade. The
// toast is pointer-events: none so it never blocks clicks on the
// underlying canvas (clinician can keep working while the label
// glides in/out).
const toastStyle = {
  position: 'absolute',
  bottom: 22,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 25,
  background: 'rgba(15, 23, 42, 0.92)', // slate-900 / 92% — works against bright + dark canvases
  color: 'var(--color-text)',
  padding: '8px 16px',
  borderRadius: 999,
  fontSize: '0.85rem',
  fontWeight: 500,
  letterSpacing: '0.01em',
  pointerEvents: 'none',
  boxShadow: '0 4px 16px rgba(0,0,0,0.32)',
  // Subtle fade-in/out across the 1.2 s lifetime.
  animation: 'vmx-lab-toast-fade 1200ms ease-in-out forwards',
  whiteSpace: 'nowrap',
  maxWidth: 'calc(100% - 32px)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

// Keyframes for toast fade — registered once at module level.
if (typeof document !== 'undefined' && !document.getElementById('vmx-lab-toast-keyframes')) {
  const s = document.createElement('style');
  s.id = 'vmx-lab-toast-keyframes';
  s.textContent = '@keyframes vmx-lab-toast-fade { 0% { opacity: 0; transform: translateX(-50%) translateY(6px); } 12% { opacity: 1; transform: translateX(-50%) translateY(0); } 80% { opacity: 1; } 100% { opacity: 0; transform: translateX(-50%) translateY(-4px); } }';
  document.head.appendChild(s);
}

// Cheatsheet content — passed to ShortcutCheatsheet as structured
// sections. Sectioned (W/L · Tools · View · Help) so the 2-column
// grid is scannable rather than a flat dump. Length/Angle reflect
// the m/g remap; W/L family uses brief-mandated b/s/l/a.
const cheatsheetSections = [
  {
    title: 'W/L presets',
    rows: [
      { key: 'B', desc: '🦴 Bone — WW 2000 / WL 500' },
      { key: 'S', desc: '🫀 Soft tissue — WW 400 / WL 40' },
      { key: 'L', desc: '🫁 Lung — WW 1500 / WL -500' },
      { key: 'A', desc: '🪄 Auto — smart contrast (P1-P99)' },
      { key: '1 – 5', desc: 'Preset by index (Bone · Soft · Lung · Auto · DICOM)' },
    ],
  },
  {
    title: 'Tools',
    rows: [
      { key: 'W', desc: 'Window/Level tool' },
      { key: 'P', desc: 'Pan tool' },
      { key: 'Z', desc: 'Zoom tool' },
      { key: 'M', desc: '📏 Length measurement' },
      { key: 'G', desc: '📐 Angle measurement' },
      { key: 'N', desc: '🦴 Norberg angle' },
      { key: 'V', desc: '💗 VHS' },
    ],
  },
  {
    title: 'View',
    rows: [
      { key: '+', desc: 'Zoom in (10% step)' },
      { key: '-', desc: 'Zoom out (10% step)' },
      { key: 'R', desc: 'Reset view (zoom · pan · W/L)' },
      { key: 'F', desc: 'Toggle fullscreen' },
      { key: 'E', desc: 'Export annotated PNG' },
    ],
  },
  {
    title: 'Annotation',
    rows: [
      { key: 'C', desc: 'Clear all measurements' },
      { key: 'U', desc: 'Undo last Norberg/VHS point' },
      { key: '(drag)', desc: 'ลากจุด Norberg/VHS ที่วางแล้ว = ปรับตำแหน่ง' },
    ],
  },
  {
    // Phase 5 (Agent ⓐ) — stack-scroll keys. Only useful when the viewer
    // is in stack mode (multi-slice study), but listed here unconditionally
    // so the cheatsheet doubles as discovery doc.
    title: 'Stack scroll (CT / MR series)',
    rows: [
      { key: '↓ / →', desc: 'Next slice' },
      { key: '↑ / ←', desc: 'Previous slice' },
      { key: 'PgDn', desc: 'Jump +10 slices' },
      { key: 'PgUp', desc: 'Jump -10 slices' },
      { key: 'Home', desc: 'First slice' },
      { key: 'End', desc: 'Last slice' },
      { key: 'Space', desc: 'Next slice (Shift+Space = previous)' },
      { key: '(wheel)', desc: 'Mouse wheel = next/prev slice' },
      { key: '(swipe)', desc: 'Vertical swipe on mobile = scroll slices' },
    ],
  },
  {
    title: 'Help',
    rows: [
      { key: '?', desc: 'Toggle this cheatsheet' },
      { key: 'Esc', desc: 'Close cheatsheet' },
    ],
  },
];

function Divider() {
  return (
    <span
      style={{
        width: 1,
        height: 22,
        background: 'var(--color-border-bright)',
        margin: '0 4px',
      }}
    />
  );
}

const toolbarStyle = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  padding: 8,
  background: 'var(--color-surface-2)',
  borderTop: '1px solid var(--color-border)',
  borderLeft: '1px solid var(--color-border)',
  borderRight: '1px solid var(--color-border)',
  borderRadius: '8px 8px 0 0',
  alignItems: 'center',
  fontSize: '0.85rem',
};

// Mobile toolbar — Phase 7 (segmented + drawer pattern). 4 most-used
// tools visible by default + a "More" trigger that opens an off-canvas
// bottom-sheet with the full list. Replaces the previous nowrap +
// horizontal-scroll abbreviation grid that beginners found confusing.
// `flex-wrap: nowrap` is kept but `overflowX: 'hidden'` because the
// More drawer absorbs the spillover instead of letting it scroll.
const toolbarMobileStyle = {
  display: 'flex',
  gap: 6,
  flexWrap: 'nowrap',
  overflow: 'hidden',
  padding: '6px 8px',
  background: 'var(--color-surface-2)',
  borderTop: '1px solid var(--color-border)',
  borderLeft: '1px solid var(--color-border)',
  borderRight: '1px solid var(--color-border)',
  borderRadius: '8px 8px 0 0',
  alignItems: 'center',
  fontSize: '0.85rem',
  touchAction: 'pan-y',
  justifyContent: 'space-between',
};

const labelStyle = {
  color: 'var(--color-text-muted)',
  fontSize: '0.75rem',
  marginRight: 2,
  whiteSpace: 'nowrap',
};

// Phase 7 — "⋯ More" trigger that lives at the right edge of the mobile
// toolbar. Same height + rounded corners as TBtn for visual cohesion,
// but uses a muted border so it doesn't look like an active tool.
const moreBtnStyle = {
  minHeight: 36,
  padding: '6px 11px',
  background: 'var(--color-surface-lift)',
  color: 'var(--color-text-muted)',
  border: '1px solid var(--color-border-bright)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.82rem',
  whiteSpace: 'nowrap',
  lineHeight: 1.3,
  fontFamily: 'inherit',
  flex: '0 0 auto',
};

const overlay = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--color-text-muted)',
  fontSize: '0.95rem',
  pointerEvents: 'none',
};

const spinnerStyle = {
  fontSize: 44,
  marginBottom: 14,
  animation: 'vmx-lab-spin-pulse 1.4s ease-in-out infinite',
  display: 'inline-block',
};

// CSS keyframes injected once at module level so each viewport
// doesn't duplicate a <style> tag.
if (typeof document !== 'undefined' && !document.getElementById('vmx-lab-spin-pulse-keyframes')) {
  const s = document.createElement('style');
  s.id = 'vmx-lab-spin-pulse-keyframes';
  s.textContent = `@keyframes vmx-lab-spin-pulse { 0%,100% { opacity:0.35; transform: scale(0.92); } 50% { opacity: 1; transform: scale(1.05); } }`;
  document.head.appendChild(s);
}
