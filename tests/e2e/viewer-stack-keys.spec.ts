// viewer-stack-keys.spec.ts — Phase 5 stack-mode keyboard nav smoke.
//
// Stack-mode bindings (↑ / ↓ / ← / → / PgUp / PgDn / Home / End) only
// activate when DicomViewport renders a multi-slice study. The slice
// indicator pill ("📚 Slice 1 / N") only shows when `isStackMode &&
// sliceCount > 1` (see DicomViewport.jsx around line 1266).
//
// Current fixture status (verified 2026-05-24):
//   All 16 seeded cases in public/cases/<slug>/ ship EXACTLY 1 .dcm
//   file each (Lateral.dcm only). That means sliceCount === 1 across
//   the whole catalogue, the stack toolbar segment is never rendered,
//   and stack-key bindings cannot be smoke-tested without a real
//   multi-slice CT/MR study.
//
// Phase 4 bulk-import DOES support multi-slice studies (the parse-pool
// + study-organizer paths are unit-tested). Seeding a real multi-slice
// study would need either:
//   (a) Aj. Ekkapol providing a CC-licensed CUVET CT volume, or
//   (b) Lifting a public Mendeley / Zenodo CT/MR slice stack and
//       wiring a route that drops the files into the viewer's File[]
//       prop.
//
// Either path is out of scope for Phase 9 E2E coverage. We honor Iron
// Rule 0 by SKIPPING the spec with the precondition explicit in the
// skip reason · NOT writing a fake-passing test that asserts on a
// single-slice case (which would silently confirm the wrong thing —
// the spec name says "stack nav" but the assertion would just be
// "slice 1 stays slice 1").

import { test, expect } from '@playwright/test';

test.describe('Stack-mode keyboard navigation (Phase 5)', () => {
  test.skip(
    true,
    'No multi-slice fixture seeded · all 16 cases in public/cases/<slug>/ ' +
      'ship single Lateral.dcm only. Unblock by seeding a real multi-slice ' +
      'CT/MR study (Aj. Ekkapol CUVET CT or public Mendeley/Zenodo slice ' +
      'stack) and wiring it into lib/cases.ts + public/cases.json.',
  );

  // ─── Spec body (preserved for the future, runs as soon as
  //     test.skip(true) is removed and the fixture lands) ─────────────
  //
  // The intended flow once a multi-slice case is seeded:
  //
  //   1. Navigate to /cases/<multi-slice-slug>
  //   2. Wait for the slice indicator pill to render (proves stack mode)
  //   3. Read the current "Slice X / N" text
  //   4. Press ArrowDown, re-read the pill, assert X + 1
  //   5. Press ArrowUp, re-read, assert back to X
  //   6. Press End, re-read, assert N / N
  //   7. Press Home, re-read, assert 1 / N
  //
  // The selector for the pill is:
  //   page.locator('[aria-label^="Slice "]').first()
  //
  // because DicomViewport gives it `aria-label="Slice X of N"` for
  // screen-reader announcement of the position change (live-region).
  //
  // Implementation guard: focus the viewport element FIRST (key events
  // are scoped to the elRef <div>), via:
  //   await page.locator('div[style*="touch-action: none"]').first().click()
  // so the keyboard handler attached to that div catches the keypress.

  test('↓/↑/Home/End keys change visible slice (placeholder)', async ({ page }) => {
    // Placeholder body — never executes due to skip(true) above.
    // Kept for future-proof IDE intellisense + so the test count is
    // visible in skip-list reports.
    await page.goto('/');
    expect(true).toBe(true);
  });
});
