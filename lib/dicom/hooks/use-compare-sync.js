'use client';
// Phase 9 (Agent ①) — extracted from DicomViewport.jsx (Phase 6 + Phase 8).
//
// Cross-pane sync for side-by-side compare: slice index · camera · W/L.
// Each axis bounces independently on its own Cornerstone event and has
// its OWN closure-scoped `isApplying` flag (per Phase 8 ④ note —
// mixing flags would let a slice change accidentally gate the next
// W/L drag and vice-versa).
//
// Coexists with Phase 5's `isApplyingPresetRef` — that ref gates the
// cyan-ring drift-clear for our OWN programmatic writes. When a remote
// VOI lands here, we set the preset ref true around the setProperties
// call so the remote's preset (if any) survives the local VOI_MODIFIED
// bounce instead of being cleared.

import { useEffect } from 'react';
import { Enums } from '@cornerstonejs/core';
import { proportionalSliceIndex } from '../stack-scroll';

export function useCompareSync({
  // Refs the parent owns (engine + viewport ids · element).
  elRef,
  engineRef,
  viewportIdRef,
  // Sync state.
  syncEnabled,
  syncGroupId = 'default',
  syncSlice = true,
  syncCamera = true,
  syncWL = false,
  // Lifecycle / mode.
  status,
  isStackMode,
  sliceCount,
  filesKey,
  // Preset-ring coordination (Phase 5 + Phase 8 hand-off).
  isApplyingPresetRef,
  pendingPresetIdRef,
  // React state setters.
  setSliceIdx,
  setActivePreset,
}) {
  // Camera + slice sync (Phase 6 · gated independently in Phase 8).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncEnabled, syncSlice, syncCamera, status, syncGroupId, isStackMode, sliceCount]);

  // W/L cross-pane sync (Phase 8 · default OFF · opt-in).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncEnabled, syncWL, status, syncGroupId, filesKey]);
}
