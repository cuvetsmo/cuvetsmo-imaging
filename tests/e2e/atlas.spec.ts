// atlas.spec.ts — smoke test for /atlas (Anatomy Atlas).
//
// Phase 13 (Palm directive 2026-05-26): atlas is 100% real radiographs.
// The old real-vs-AI quick-filter pill was removed; a non-interactive
// provenance breakdown ("N real radiographs · X peer-reviewed · Y
// community · Z CUVET") sits in its place. This spec asserts the
// new shape AND zero presence of AI badges anywhere on the page.

import { test, expect } from '@playwright/test';

test('Atlas grid renders with 100%-real provenance breakdown', async ({ page }) => {
  await page.goto('/atlas');

  // Header copy from AtlasGrid.tsx.
  await expect(page.getByText(/normal/i).first()).toBeVisible();

  // Provenance breakdown — role="status" (not a button, not clickable)
  // with aria-label "Atlas provenance". It must show a "real
  // radiographs" label + the total count.
  const provenance = page.getByRole('status', { name: /atlas provenance/i });
  await expect(provenance).toBeVisible();
  await expect(provenance).toContainText(/real radiographs/i);

  // ZERO tolerance for AI residue — no segments, no badges, no copy.
  const aiSegment = page.getByRole('button', { name: /AI-illustrative/i });
  expect(await aiSegment.count()).toBe(0);
  const aiGenBadge = page.locator('text=/🤖 AI-gen/');
  expect(await aiGenBadge.count()).toBe(0);

  // Cards link to /atlas/<slug>. Catalog should have at least 5.
  const cards = page.locator('a[href^="/atlas/"]');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(5);
});
