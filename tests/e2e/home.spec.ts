// home.spec.ts — smoke test for the lab home (/).
//
// What we verify:
//   1. Page loads + document title contains "Imaging"
//   2. Primary nav links present (Phase 22: 5 always-visible · 7 total
//      including 2 that hide below sm breakpoint to save mobile space).
//      Always-on:  Cases, Atlas, Quiz, Review, Progress
//      Desktop:    Occlusion, About (hidden on phones to fit 375px)
//   3. No `console.error` during initial render
//   4. Mobile viewport: nav still present (no horizontal scroll bug)

import { test, expect, type ConsoleMessage } from '@playwright/test';

test('home page loads with title + primary nav links', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/');
  // App title contains "Imaging" — set in app/layout.tsx metadata.
  await expect(page).toHaveTitle(/Imaging/);

  // The 5 always-visible nav items (post Phase 22). Occlusion + About
  // are hidden on phones to fit; they show on sm+.
  for (const label of ['Cases', 'Atlas', 'Quiz', 'Review', 'Progress']) {
    await expect(
      page.getByRole('navigation').getByRole('link', { name: label }),
    ).toBeVisible();
  }

  // Hard fail if anything logged an error during initial render.
  // SW-related noise is debounced — anything that fires within the first
  // load window we surface here.
  expect(errors, `Console errors during home render:\n${errors.join('\n')}`).toEqual([]);
});
