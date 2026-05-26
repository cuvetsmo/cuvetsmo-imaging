// overlay-norberg-vhs.spec.ts — Phase 21 Wave 2.
//
// Smoke-tests that the Norberg overlay (pelvis case) + VHS overlay
// (thorax case) are reachable from the CUVET DICOM case routes. Does
// NOT click-through the multi-step measurement workflow (Cornerstone3D
// canvas interactions are unstable on headless · saving for manual QA);
// the goal here is regression protection: if the case page stops
// loading the DICOM or the overlay buttons disappear, this fails.

import { test, expect } from "@playwright/test";

test.describe("Phase 21 Wave 2 · overlay reachability on CUVET DICOMs", () => {
  // Norberg + VHS buttons live in the DESKTOP toolbar. On mobile they're
  // collapsed into MobileToolbarSheet behind a "tools" button — different
  // codepath, separate spec if we ever need it. Skip mobile project here
  // so this spec stays scoped to the desktop toolbar surface.
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "desktop-only toolbar");

  test("Norberg overlay button is reachable on the pelvis VD case", async ({
    page,
  }) => {
    await page.goto("/cases/cuvet-canine-pelvis-vd-001");

    // Skip-recall to get straight to the viewer (the case enters in
    // recall mode by default · we want to verify the viewer chrome,
    // not the recall flow which has its own spec).
    const skip = page.getByRole("button", {
      name: /skip|ข้าม|recall|reveal/i,
    });
    // The case detail has multiple skip-style buttons across modes.
    // Click whichever is present; failure to click is fine if the
    // viewer is already mounted from a recent visit.
    if ((await skip.count()) > 0) {
      await skip.first().click().catch(() => {});
    }

    // Norberg button — owned by DicomViewport.jsx toolbar. The exact
    // label is "Norberg" (the only ∠ tool · others are Length / Angle).
    // Wait a generous timeout because Cornerstone3D mounts asynchronously.
    const norberg = page.getByRole("button", { name: /Norberg/i });
    await expect(norberg.first()).toBeVisible({ timeout: 15_000 });
  });

  test("VHS overlay button is reachable on the thorax lateral case", async ({
    page,
  }) => {
    await page.goto("/cases/cuvet-canine-thorax-lat-001");

    const skip = page.getByRole("button", {
      name: /skip|ข้าม|recall|reveal/i,
    });
    if ((await skip.count()) > 0) {
      await skip.first().click().catch(() => {});
    }

    const vhs = page.getByRole("button", { name: /VHS/i });
    await expect(vhs.first()).toBeVisible({ timeout: 15_000 });
  });

  test("Related cases widget surfaces matches", async ({ page }) => {
    // The pelvis VD case has body_part=pelvis + species=canine ·
    // there's at least one paired case (pelvis-stifle-vd) that should
    // appear in the RelatedCases widget at the bottom of the page.
    await page.goto("/cases/cuvet-canine-pelvis-vd-001");

    // The widget renders "Related cases" as an h2.
    const heading = page.getByRole("heading", { name: /Related cases/i });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // Should contain at least one link to a sibling case.
    const relatedLinks = page.locator('a[href^="/cases/cuvet-"]').filter({
      hasNotText: "Norberg practice (CUVET)", // the current case's title
    });
    expect(await relatedLinks.count()).toBeGreaterThanOrEqual(1);
  });
});
