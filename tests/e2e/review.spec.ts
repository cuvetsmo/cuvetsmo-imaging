// review.spec.ts — smoke test for /review (SRS queue).
//
// A fresh browser context with no `cuvi-attempts-v1` localStorage entries
// still shows the queue (populated with "new" cases) because CASES is
// non-empty. The honest empty state only renders when the CATALOG is
// empty (queue.length === 0) — see app/review/ReviewView.tsx.
//
// We assert the page renders the hero copy + at least one queue card.
// Empty-state behavior is covered separately by the unit tests for
// buildQueue (tests/unit/srs.test.ts: "empty cases → empty queue").

import { test, expect } from '@playwright/test';

test('Review page renders queue with new-case cards for fresh visitors', async ({
  page,
}) => {
  await page.goto('/review');

  // Hero copy from app/review/ReviewView.tsx.
  await expect(page.getByRole('heading', { name: /Next up for you/i })).toBeVisible();

  // For a fresh visitor with no attempts, the queue is full of "new"
  // cases and the top N (= 3) show as ReviewQueueCard items. Each card
  // links to /cases/<slug>, so we assert at least 1 such link renders.
  // The site-header also has a Cases nav link — we scope to the article
  // region (the queue list) to avoid that false positive.
  const queueLinks = page
    .locator('main, [role="main"], body')
    .first()
    .locator('ul a[href^="/cases/"]');
  await expect(queueLinks.first()).toBeVisible({ timeout: 10_000 });
  const count = await queueLinks.count();
  expect(count).toBeGreaterThanOrEqual(1);
});
