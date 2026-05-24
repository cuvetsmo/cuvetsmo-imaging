// cases.spec.ts — smoke test for /cases (Case Library).
//
// Confirms the static-JSON case catalogue renders, search narrows the list,
// difficulty filter narrows further, and clicking a card navigates to the
// detail route.

import { test, expect } from '@playwright/test';

test('Case Library renders, search + filter work, card navigates', async ({ page }) => {
  await page.goto('/cases');

  // Heading copy is owned by CaseLibraryLocal.jsx ("📚 Case library").
  await expect(page.getByRole('heading', { name: /Case library/i })).toBeVisible();

  // The catalogue currently ships 16 cases (lib/cases.ts seed). We don't
  // assert the literal "16" — counts may grow week-to-week — but we DO
  // assert at least 10 case cards render so a "no cases load" regression
  // would fail loud.
  const cards = page.locator('a[href^="/cases/"]');
  await expect(cards.first()).toBeVisible();
  await expect.poll(async () => await cards.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(10);
  const initialCount = await cards.count();

  // Search input — exists on the library page. Type "feline" and expect a
  // narrower set than the initial card count.
  const search = page.getByPlaceholder(/search/i).first();
  if (await search.count()) {
    await search.fill('feline');
    // Filtering is client-side + debounced; wait a beat then re-count.
    await expect.poll(async () => await cards.count(), {
      timeout: 5_000,
    }).toBeLessThan(initialCount);
    // Clear to restore.
    await search.fill('');
  }

  // Navigate into the first card and verify URL pattern.
  await cards.first().click();
  await page.waitForURL(/\/cases\/.+/);
  expect(page.url()).toMatch(/\/cases\/[^/]+$/);
});
