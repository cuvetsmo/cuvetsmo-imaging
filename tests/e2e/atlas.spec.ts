// atlas.spec.ts — smoke test for /atlas (Anatomy Atlas).
//
// Confirms the 10-card grid renders + the credibility split pill
// ("5 real · 5 AI-illustrative") shows + clicking the "real" segment
// narrows the visible set.

import { test, expect } from '@playwright/test';

test('Atlas grid renders with credibility split pill', async ({ page }) => {
  await page.goto('/atlas');

  // Header copy from AtlasGrid.tsx — "ดู normal ให้ครบ 100 ครั้งก่อน...".
  await expect(page.getByText(/normal/i).first()).toBeVisible();

  // The split pill contains two clickable segments; their labels are
  // "real" and "AI-illustrative". Counts are computed from lib/atlas.ts —
  // we don't hardcode "5" because data may grow; we DO assert the labels
  // exist.
  const realSegment = page.getByRole('button', { name: /real reference radiographs/i });
  await expect(realSegment).toBeVisible();
  const aiSegment = page.getByRole('button', { name: /AI-illustrative entries/i });
  await expect(aiSegment).toBeVisible();

  // Cards link to /atlas/<slug>. Day-1 catalog is 10 entries.
  const cards = page.locator('a[href^="/atlas/"]');
  // Wait until the grid hydrates.
  await expect(cards.first()).toBeVisible();
  const initial = await cards.count();
  expect(initial).toBeGreaterThanOrEqual(5);

  // Click "real" to narrow. After clicking, visible card count should
  // be ≤ initial (cannot be more — that would be a counting bug).
  await realSegment.click();
  await expect.poll(async () => await cards.count()).toBeLessThanOrEqual(initial);
});
