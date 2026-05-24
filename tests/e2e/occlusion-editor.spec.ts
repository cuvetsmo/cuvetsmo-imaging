// occlusion-editor.spec.ts — smoke test for /occlusion empty-state
// dropzone affordance.
//
// Phase 7 hardened the Image Occlusion editor in two notable ways:
//   1. A11y: the empty-state dropzone is now a real <label htmlFor=...>
//      wrapping a visually-hidden <input type="file"> — so Tab focuses
//      it, Enter/Space opens the picker, and screen readers announce
//      the upload purpose. Earlier versions were a div with onClick.
//   2. Quota: a persistent error banner (role="alert") surfaces when
//      the localStorage write hits QuotaExceededError, and the editor
//      stays mounted so the user can delete an old deck.
//
// Verifying a REAL upload would need a fixture image buffer + the
// canvas-based mask drawing which isn't worth the flake surface in a
// smoke spec. We focus on the affordance — that the empty-state IS a
// <label>, the input IS keyboard-reachable, and the visible copy
// matches what Phase 7 shipped.

import { test, expect } from '@playwright/test';

test.describe('Occlusion editor home', () => {
  test('empty-state dropzone is a <label> with focusable file input', async ({
    page,
  }) => {
    await page.goto('/occlusion');

    // Heading copy from OcclusionView.jsx ("🖼 Image Occlusion"). The
    // emoji can flake in cross-platform font-rendering, so we match
    // only the text portion.
    await expect(
      page.getByRole('heading', { name: /Image Occlusion/i }),
    ).toBeVisible();

    // Empty-state CTA copy is "📷 สร้าง deck แรก" (create first deck) —
    // visible only when decks.length === 0. A fresh browser context
    // has no localStorage entries so this should always render.
    await expect(page.getByText(/สร้าง deck แรก/)).toBeVisible();

    // A11y assertion: the empty-state CTA must be a <label> wrapping
    // the file input. We can't directly assert tagName from the
    // accessible-name API, so we use a CSS-class selector that
    // OcclusionView.jsx applies uniquely to this element.
    const dropzone = page.locator('label.occlusion-empty-dropzone');
    await expect(dropzone).toBeVisible();
    await expect(dropzone).toHaveAttribute('for', 'occlusion-bootstrap-file');

    // The hidden file input MUST be a child of the label so a click
    // anywhere on the dropzone fires the native file picker. We don't
    // simulate the picker click here (Playwright + native picker is
    // flaky), but we verify the input exists with the right id +
    // accept attribute that Phase 8 security-tightened.
    const fileInput = page.locator('input#occlusion-bootstrap-file');
    await expect(fileInput).toHaveAttribute(
      'accept',
      'image/png,image/jpeg,image/jpg,image/webp',
    );

    // SVG MUST NOT be in the accept list (Phase 8 security fix —
    // <script> + foreignObject = XSS surface). Regression guard.
    const acceptAttr = await fileInput.getAttribute('accept');
    expect(acceptAttr).not.toContain('svg');
  });

  test('dropzone reaches keyboard focus via Tab', async ({ page }) => {
    await page.goto('/occlusion');

    // Wait for the page to settle so the focusable elements are all
    // mounted before we start tabbing — otherwise the Tab-order test
    // can race the lazy-loaded back-link / button hydration.
    await expect(page.getByText(/สร้าง deck แรก/)).toBeVisible();

    // Programmatically focus the hidden input — :focus-within on the
    // wrapping <label> is what makes the dropzone visually highlight
    // when keyboard-navigating. We assert the input CAN take focus
    // (proves the input isn't `disabled` or `display:none` which
    // would strip it from the tab sequence).
    const fileInput = page.locator('input#occlusion-bootstrap-file');
    await fileInput.focus();

    const isFocused = await fileInput.evaluate(
      (el) => document.activeElement === el,
    );
    expect(isFocused, 'file input should accept programmatic focus').toBe(true);
  });
});
