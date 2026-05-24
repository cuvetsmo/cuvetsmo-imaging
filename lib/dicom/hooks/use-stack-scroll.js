'use client';
// Phase 9 (Agent ①) — extracted from DicomViewport.jsx (Phase 5).
//
// Stack-mode navigation surface: STACK_NEW_IMAGE reconciliation listener
// + `goToSlice` callback + vertical-swipe touch handler. The keyboard
// handler for stack navigation stays inside DicomViewport because it
// shares a `keydown` listener with the broader tool/preset/help key map.
// Wheel binding lives in the engine setup (StackScrollTool with Wheel
// MouseBinding) — it's part of the tool group, not this hook.
//
// The hook is non-stateful — it consumes `sliceIdx` and the setter from
// the parent. We export `goToSlice` (parent's selectTool / keyboard
// handler / toolbar prev/next all call this) so callers don't need to
// know how clamping or async-fetch lifecycles work.

import { useCallback, useEffect, useRef } from 'react';
import { Enums } from '@cornerstonejs/core';
import {
  TOUCH_SLICE_THRESHOLD_PX,
  clampIndex,
  sliceDeltaFromTouch,
} from '../stack-scroll';

export function useStackScroll({
  // Refs the parent owns (engine + viewport + element).
  elRef,
  engineRef,
  viewportIdRef,
  // Lifecycle / mode.
  status,
  isStackMode,
  sliceCount,
  filesKey,
  // Active tool (for swipe yield logic).
  activeTool,
  // React state.
  sliceIdx,
  setSliceIdx,
}) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, isStackMode, activeTool, goToSlice, sliceIdx]);

  return { goToSlice };
}
