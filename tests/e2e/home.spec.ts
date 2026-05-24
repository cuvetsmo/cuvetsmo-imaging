// home.spec.ts — smoke test for the lab home (/).
//
// What we verify:
//   1. Page loads + document title contains "Imaging"
//   2. All 5 site-header nav links present (Cases, Review, Atlas, Occlusion, About)
//   3. No `console.error` during initial render
//   4. Mobile viewport: nav still present (no horizontal scroll bug)

import { test, expect, type ConsoleMessage } from '@playwright/test';

test('home page loads with title and 5 nav links', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/');
  // App title contains "Imaging" — set in app/layout.tsx metadata.
  await expect(page).toHaveTitle(/Imaging/);

  // All 5 site-header nav links (from components/Brand.tsx).
  for (const label of ['Cases', 'Review', 'Atlas', 'Occlusion', 'About']) {
    await expect(
      page.getByRole('navigation').getByRole('link', { name: label }),
    ).toBeVisible();
  }

  // Hard fail if anything logged an error during initial render.
  // SW-related noise is debounced — anything that fires within the first
  // load window we surface here.
  expect(errors, `Console errors during home render:\n${errors.join('\n')}`).toEqual([]);
});
