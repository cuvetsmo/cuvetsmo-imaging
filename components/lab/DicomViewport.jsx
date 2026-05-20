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
  annotation,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';
import dicomParser from 'dicom-parser';
import { ensureCornerstoneInit, getDicomImageLoader } from '../../lib/dicom/cornerstone-init.js';
import NorbergOverlay from './NorbergOverlay.jsx';
import VHSOverlay from './VHSOverlay.jsx';
import AIOverlay from './AIOverlay.jsx';
import ShortcutCheatsheet from './ShortcutCheatsheet.jsx';
import { useMediaQuery } from '../../lib/dicom/use-media-query.js';
import {
  WL_PRESETS,
  WL_PRESET_DICOM,
  wlToVoiRange,
  formatPresetToast,
} from '../../lib/dicom/wl-presets';

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

export default function DicomViewport({ file, caseId = null, syncEnabled = false }) {
  const isMobile = useMediaQuery('(max-width: 600px)');
  const elRef = useRef(null);
  const engineRef = useRef(null);
  const viewportIdRef = useRef(null);
  const toolGroupIdRef = useRef(null);
  const [status, setStatus] = useState('init');
  const [errorMsg, setErrorMsg] = useState('');
  const [meta, setMeta] = useState(null);
  const [activeTool, setActiveTool] = useState('wl');

  useEffect(() => {
    if (!file) return;
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
        const imageId = loader.wadouri.fileManager.add(file);

        const engine = new RenderingEngine(engineId);
        engineRef.current = engine;
        engine.enableElement({
          viewportId,
          type: Enums.ViewportType.STACK,
          element: elRef.current,
        });
        const viewport = engine.getViewport(viewportId);
        await viewport.setStack([imageId]);

        const tg = ToolGroupManager.createToolGroup(toolGroupId);
        Object.values(TOOLS).forEach(({ cls }) => tg.addTool(cls.toolName));
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
          try {
            const ok = applySmartContrast(viewport);
            // Mark Auto as the initial active preset only if it
            // actually applied; on failure the DICOM-tag default
            // wins and no preset is "active".
            if (ok) setActivePreset('auto');
          } finally {
            queueMicrotask(() => { isApplyingPresetRef.current = false; });
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
        try {
          const buf = await file.arrayBuffer();
          const ds = dicomParser.parseDicom(new Uint8Array(buf));
          const sp = ds.string('x00102201') || '';
          if (!cancelled && sp) setSpecies(sp);
        } catch { /* dicom-parser failed; species stays empty */ }
        setStatus('ready');
        setActiveTool('wl');
      } catch (err) {
        // eslint-disable-next-line no-console
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
  }, [file]);

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
      // eslint-disable-next-line no-console
      console.error('[selectTool] bind error:', err);
    }
  }, []);

  // Active preset = which W/L preset button gets the cyan ring.
  // `null` while smart-W/L initial compute is in flight or after the
  // user has manually adjusted W/L via the WindowLevelTool drag.
  const [activePreset, setActivePreset] = useState(null);
  // Suppress the VOI_MODIFIED → setActivePreset(null) drift-clear for
  // our OWN programmatic voiRange writes (preset apply · smart auto ·
  // reset). Same shape as the camera-sync `isApplying` flag, but here
  // it's a ref because the VOI event handler doesn't need to re-render
  // when the flag flips — it just reads it. Set true BEFORE the write,
  // reset in `queueMicrotask` so any synchronous VOI_MODIFIED bounce
  // from `setProperties`/`resetProperties` is gated and any genuine
  // user-drag VOI events arriving in later microtasks fall through.
  const isApplyingPresetRef = useRef(false);
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
      queueMicrotask(() => { isApplyingPresetRef.current = false; });
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
      // eslint-disable-next-line no-console
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
  const [species, setSpecies] = useState('');
  // First-load nudge — small floating tip near the canvas that hints
  // the measurement workflow. Auto-fades after 6 s or on any tool
  // selection (other than the default W/L which is auto-active).
  const [showFirstHint, setShowFirstHint] = useState(false);
  useEffect(() => {
    if (status !== 'ready') return;
    setShowFirstHint(true);
    const t = setTimeout(() => setShowFirstHint(false), 6500);
    return () => clearTimeout(t);
  }, [status, file]);

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
      const baseFilename = (file?.name || 'dicom').replace(/\.dcm$/i, '').replace(/\.dicom$/i, '') + '_annotated';
      await mod.exportAnnotatedPng({ containerEl: elRef.current, baseFilename });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[exportPng] error:', err);
    }
  }, [file]);

  const clearMeasurements = useCallback(() => {
    // Clear both Cornerstone annotations (Length/Angle) and any custom
    // overlays (Norberg/VHS) by dispatching a custom event that the
    // overlay components listen for. Simpler than threading a callback
    // through every overlay child.
    try {
      const all = annotation.state.getAllAnnotations();
      all.forEach((a) => annotation.state.removeAnnotation(a.annotationUID));
    } catch (err) {
      // eslint-disable-next-line no-console
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
  useEffect(() => {
    if (!syncEnabled || status !== 'ready') return;
    const element = elRef.current;
    if (!element) return;
    const myId = viewportIdRef.current;
    let isApplying = false;

    const onCameraChange = () => {
      if (isApplying) return;
      const vp = engineRef.current?.getViewport(myId);
      if (!vp) return;
      try {
        const cam = vp.getCamera();
        window.dispatchEvent(new CustomEvent('vmx-lab-sync-camera', {
          detail: { sourceId: myId, camera: cam },
        }));
      } catch { /* viewport torn down mid-event */ }
    };

    const onRemoteCamera = (evt) => {
      if (!evt?.detail || evt.detail.sourceId === myId) return;
      const vp = engineRef.current?.getViewport(myId);
      if (!vp) return;
      try {
        isApplying = true;
        vp.setCamera(evt.detail.camera);
        vp.render();
        requestAnimationFrame(() => { isApplying = false; });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[viewport-sync] apply error:', err);
        isApplying = false;
      }
    };

    element.addEventListener(Enums.Events.CAMERA_MODIFIED, onCameraChange);
    window.addEventListener('vmx-lab-sync-camera', onRemoteCamera);
    return () => {
      element.removeEventListener(Enums.Events.CAMERA_MODIFIED, onCameraChange);
      window.removeEventListener('vmx-lab-sync-camera', onRemoteCamera);
    };
  }, [syncEnabled, status]);

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
  }, [status, file]);

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
  ]);

  return (
    <div>
      {status === 'ready' && (
        <div style={isMobile ? toolbarMobileStyle : toolbarStyle}>
          {!isMobile && <span style={labelStyle}>Nav:</span>}
          {navTools.map((t) => (
            <TBtn key={t} active={activeTool === t} onClick={() => selectTool(t)} title={`${TOOLS[t].label} — shortcut (${TOOLS[t].sk})`}>
              {isMobile ? TOOLS[t].short : TOOLS[t].label}
            </TBtn>
          ))}
          <Divider />
          {!isMobile && <span style={labelStyle}>Measure:</span>}
          {measureTools.map((t) => (
            <TBtn key={t} active={activeTool === t} onClick={() => selectTool(t)} title={`${TOOLS[t].label} — shortcut (${TOOLS[t].sk})`}>
              {isMobile ? TOOLS[t].short : TOOLS[t].label}
            </TBtn>
          ))}
          <TBtn onClick={clearMeasurements} title="Clear all measurements (C)">{isMobile ? '🗑' : '🗑 Clear'}</TBtn>
          <Divider />
          {!isMobile && <span style={labelStyle}>W/L:</span>}
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
          {!isMobile && <span style={labelStyle}>Vet:</span>}
          <TBtn active={activeTool === 'norberg'} onClick={() => selectTool('norberg')} title="Norberg angle (N) — 4-click">
            {isMobile ? '🦴 N' : '🦴 Norberg'}
          </TBtn>
          <TBtn active={activeTool === 'vhs'} onClick={() => selectTool('vhs')} title="Vertebral Heart Score (V) — 6-click">
            {isMobile ? '💗 V' : '💗 VHS'}
          </TBtn>
          <Divider />
          {!isMobile && <span style={labelStyle}>AI:</span>}
          <label className="vmx-btn" style={aiBtnLabelStyle} title="Load AI prediction JSON for this image">
            {isMobile ? '🤖' : '🤖 Load AI'}
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => loadAiJson(e.target.files?.[0])}
              style={{ display: 'none' }}
            />
          </label>
          {aiPrediction && <TBtn onClick={clearAi} title="Clear AI overlay">{isMobile ? '✕' : '✕ Clear AI'}</TBtn>}
          <Divider />
          <TBtn onClick={exportPng} title="Export annotated PNG (E)">{isMobile ? '📤' : '📤 Export PNG'}</TBtn>
          <TBtn onClick={toggleFullscreen} title={isFullscreen ? 'ออก fullscreen (F or Esc)' : 'เปิด fullscreen (F)'}>
            {isFullscreen ? '⤢ Exit FS' : '⛶ Fullscreen'}
          </TBtn>
          <TBtn onClick={resetView} title="Reset view (R)">{isMobile ? '↺' : '↺ Reset view'}</TBtn>
          <TBtn onClick={() => setShowShortcuts((s) => !s)} title="Keyboard shortcuts (?)">⌨</TBtn>
        </div>
      )}
      {aiError && (
        <div style={{ background: '#fff5f5', border: '1px solid #fcc', color: '#a33', padding: '4px 10px', fontSize: '0.78rem', borderRadius: 4, marginBottom: 4 }}>
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
          background: '#000',
          borderRadius: status === 'ready' ? '0 0 8px 8px' : 8,
          position: 'relative',
          overflow: 'hidden',
          touchAction: 'none',
        }}
      >
        {status === 'init' && (
          <div style={overlay}>
            <div style={spinnerStyle}>🔬</div>
            <div>กำลังโหลด DICOM...</div>
            <div style={{ fontSize: '0.72rem', marginTop: 6, opacity: 0.6 }}>
              {file?.name} · {(file?.size / 1024 | 0)} KB
            </div>
          </div>
        )}
        {status === 'error' && (
          <div style={{ ...overlay, color: '#fbb', textAlign: 'center', padding: 20 }}>
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
        {status === 'ready' && (
          <NorbergOverlay
            key={`norberg-${file?.name}-${file?.size}-${file?.lastModified || 0}`}
            active={activeTool === 'norberg'}
            viewportRef={getViewport}
            caseId={caseId}
          />
        )}
        {status === 'ready' && (
          <VHSOverlay
            key={`vhs-${file?.name}-${file?.size}-${file?.lastModified || 0}`}
            active={activeTool === 'vhs'}
            viewportRef={getViewport}
            caseId={caseId}
            species={species}
          />
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
        <div style={{ fontSize: '0.8rem', color: '#666', marginTop: 8 }}>
          📐 {meta.width} × {meta.height} pixels
          {meta.mmPerPx && (
            <> · calibrated at <strong>{meta.mmPerPx.toFixed(3)} mm/pixel</strong> (PixelSpacing tag)</>
          )}
          · Phase 6 · 🦴 Norberg + 📐 VHS ใน toolbar
        </div>
      )}
      {meta && status === 'ready' && (
        <div style={{ fontSize: '0.75rem', color: '#888', marginTop: 4 }}>
          เลือก 📏 Length หรือ 📐 Angle จาก toolbar แล้วลากบนภาพ — ผลแสดงเป็น mm จาก PixelSpacing tag. ลากซ้าย = active tool, กลาง = pan, ขวา = zoom.
        </div>
      )}
    </div>
  );
}

function TBtn({ active, onClick, children, title, preset, ariaPressed }) {
  // Preset buttons use a cyan ring (rather than green-bg) for the
  // "currently applied preset" indication — visually distinct from
  // the "currently selected tool" green-bg state. Matches the brief
  // and pairs with the OHIF-dark clinical theme of the imaging lab.
  const style = preset
    ? {
        minHeight: 36,
        padding: '6px 11px',
        background: '#fff',
        color: '#333',
        border: '1px solid #ccc',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: '0.82rem',
        whiteSpace: 'nowrap',
        lineHeight: 1.3,
        // Cyan ring when this preset is the active one.
        boxShadow: active ? '0 0 0 2px #06b6d4, 0 0 0 4px rgba(6,182,212,0.18)' : 'none',
        outline: 'none',
      }
    : {
        minHeight: 36,
        padding: '6px 11px',
        background: active ? '#4a6b4a' : '#fff',
        color: active ? '#fff' : '#333',
        border: '1px solid #ccc',
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
  background: '#fff',
  color: '#333',
  border: '1px solid #ccc',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.82rem',
  whiteSpace: 'nowrap',
  lineHeight: 1.3,
  display: 'inline-flex',
  alignItems: 'center',
};

// First-load hint near the canvas, fades after 6.5 s.
const firstHintStyle = {
  position: 'absolute',
  top: 10,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 11,
  background: 'rgba(0,0,0,0.78)',
  color: '#fff',
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
  background: '#fff',
  color: '#333',
  border: '1px solid #ccc',
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
  color: '#fff',
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
    title: 'Help',
    rows: [
      { key: '?', desc: 'Toggle this cheatsheet' },
      { key: 'Esc', desc: 'Close cheatsheet' },
    ],
  },
];

function Divider() {
  return <span style={{ width: 1, height: 22, background: '#ccc', margin: '0 4px' }} />;
}

const toolbarStyle = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  padding: 8,
  background: '#f5f5f5',
  borderRadius: '8px 8px 0 0',
  alignItems: 'center',
  fontSize: '0.85rem',
};

// Mobile toolbar — no wrap, horizontal scroll. Keeps the canvas
// from being squished by a 4-row toolbar on phone portrait.
// `touch-action: pan-x` lets horizontal swipe scroll the toolbar
// without the browser also trying to navigate. Momentum scroll on
// iOS via -webkit-overflow-scrolling.
const toolbarMobileStyle = {
  display: 'flex',
  gap: 6,
  flexWrap: 'nowrap',
  overflowX: 'auto',
  overflowY: 'hidden',
  padding: '6px 8px',
  background: '#f5f5f5',
  borderRadius: '8px 8px 0 0',
  alignItems: 'center',
  fontSize: '0.85rem',
  WebkitOverflowScrolling: 'touch',
  touchAction: 'pan-x',
  scrollbarWidth: 'thin',
};

const labelStyle = {
  color: '#666',
  fontSize: '0.75rem',
  marginRight: 2,
  whiteSpace: 'nowrap',
};

const overlay = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#aaa',
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
