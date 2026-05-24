// viewer-mount.spec.ts — CRITICAL PATH smoke for the DICOM viewer.
//
// Phase 8 shipped 5 specs that all stopped at the "active recall textarea
// is wired" boundary. None of them VERIFY the DICOM viewer actually
// renders a slice — and DicomViewport is the single most fragile surface
// in the app (Cornerstone3D + WebGL + dynamic-imported DICOM blob fetch).
//
// What we verify:
//   1. Navigate to /cases/vetxray-canine-normal
//   2. After the lazy-loaded DicomViewport mounts + the DICOM blob
//      fetches + Cornerstone3D draws the first frame, a <canvas> element
//      exists with non-zero width/height
//   3. No `console.error` during initial mount (would flag stale tool
//      registration / WebGL init / failed blob fetch)
//
// We DO NOT assert pixel content (out of scope for E2E · the unit test
// for cornerstone-init covers that). We assert the affordance is real,
// not the picture.
//
// Selector strategy: `page.locator('canvas').first()`. DicomViewport
// renders the canvas as Cornerstone3D's RenderingEngine output inside
// the elRef <div> — semantic-tagged canvases aren't a thing, so the
// generic locator is the right tool.

import { test, expect, type ConsoleMessage } from '@playwright/test';

test.describe('DICOM viewer mount', () => {
  test('opens vetxray-canine-normal · canvas renders + no console errors', async ({
    page,
  }) => {
    // Wire console-error capture BEFORE navigation so we catch errors
    // that fire during initial hydration (lazy-import + Cornerstone init
    // both run early). Filter out the noisy benign categories that the
    // existing apps log on every visit.
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const txt = msg.text();
      // Service-worker registration / manifest icons / favicon-fallback
      // chatter is environment noise, not viewer bugs.
      if (/sw\.js|favicon|manifest|preloaded.*not used/i.test(txt)) return;
      errors.push(txt);
    });

    await page.goto('/cases/vetxray-canine-normal');

    // The case-detail shell renders FIRST (loading → ready), then the
    // lazy DicomViewport chunk loads, then the DICOM blob is fetched
    // (~250 kB cached), then Cornerstone draws. networkidle gives us a
    // single wait that covers all three.
    await page.waitForLoadState('networkidle');

    // Title section confirms the case shell is mounted before we look
    // for the canvas — guards against a "still loading" false negative.
    await expect(
      page.getByRole('heading', { name: /Canine lateral thoracic · NORMAL/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Cornerstone3D renders its image to a canvas inside the viewport
    // <div>. We accept ANY canvas because the engine spawns one per
    // viewport instance + a few helper canvases for tool overlays.
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    // Bounding box assertion catches the "canvas exists but is 0x0"
    // failure mode that happens when Cornerstone's resize observer
    // hasn't fired (e.g. parent div has no height).
    const box = await canvas.boundingBox();
    expect(box, 'canvas bounding box should resolve').toBeTruthy();
    expect(box!.width, 'canvas width').toBeGreaterThan(0);
    expect(box!.height, 'canvas height').toBeGreaterThan(0);

    // Give Cornerstone a beat to settle any deferred async work
    // (texture upload, voi-modified events). 1.5 s is enough at our
    // single-slice scale and keeps the spec under the 60 s timeout.
    // We DO NOT use this to wait for the canvas — that's done above.
    await page.waitForTimeout(1500);

    expect(
      errors,
      `Console errors during viewer mount:\n${errors.join('\n---\n')}`,
    ).toEqual([]);
  });

  test('toolbar exposes Pan / Zoom / W/L primary tools', async ({ page }) => {
    await page.goto('/cases/vetxray-canine-normal');
    await page.waitForLoadState('networkidle');

    // Wait for the viewport ready state (canvas) before looking for
    // the toolbar — both render conditional on status==='ready', but
    // the canvas is the slower of the two so it's a safer anchor.
    await expect(page.locator('canvas').first()).toBeVisible({
      timeout: 15_000,
    });

    // Desktop renders the flat toolbar (button text includes the tool
    // name); mobile renders the segmented sheet. Both projects share
    // the same primary trio of titles, so we match on the `title=`
    // attribute which DicomViewport.jsx sets identically:
    //   - "Pan — drag to move the image (P)"
    //   - "Zoom — pinch or drag to zoom (Z)"
    //   - "Window/Level — drag to brighten or darken (W)"
    //
    // The desktop version uses `title="${TOOLS[t].label} — shortcut
    // (${TOOLS[t].sk})"` which renders as "✋ Pan — shortcut (P)" so
    // we accept both forms via case-insensitive regex.
    await expect(
      page.locator('button[title*="Pan" i]').first(),
    ).toBeVisible();
    await expect(
      page.locator('button[title*="Zoom" i]').first(),
    ).toBeVisible();
    await expect(
      page.locator('button[title*="Window/Level" i], button[title*="W/L" i]').first(),
    ).toBeVisible();
  });
});
