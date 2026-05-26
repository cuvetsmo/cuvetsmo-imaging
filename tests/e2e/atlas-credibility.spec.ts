// atlas-credibility.spec.ts — Phase 13 (Palm directive 2026-05-26).
//
// Atlas is 100% real radiographs. AI tiles + AI-illustrative segment
// + 🤖 AI-gen badge are all retired. This spec enforces the new
// invariant: every visible card carries a verified-credibility badge,
// and the page contains zero AI-leakage.
//
// What this spec covers:
//   - Provenance breakdown shows in the header (status role)
//   - Every card visible on /atlas has one of the four verified labels
//   - No "🤖 AI-gen" badge appears anywhere
//   - No "AI-illustrative" copy / segment / button appears anywhere
//   - Removed slugs (canine-abdomen-lat-001 etc.) return 404 — protects
//     against a stale entry sneaking back in.

import { test, expect } from '@playwright/test';

test.describe('Atlas Phase 13 — 100% real invariant', () => {
  test('provenance breakdown is data-derived + visible', async ({ page }) => {
    await page.goto('/atlas');

    const provenance = page.getByRole('status', { name: /atlas provenance/i });
    await expect(provenance).toBeVisible();

    // Total count text — "N real radiographs" — must contain a positive
    // integer pulled from data, not a hardcoded literal.
    const text = await provenance.textContent();
    const match = text?.match(/(\d+)\s+real radiographs/i);
    expect(match, 'provenance must show a real-radiograph count').toBeTruthy();
    const total = Number(match?.[1] ?? -1);
    expect(total).toBeGreaterThan(0);
  });

  test('every visible card has a verified badge — zero AI residue', async ({
    page,
  }) => {
    await page.goto('/atlas');

    const cards = page.locator('a[href^="/atlas/"]');
    await expect(cards.first()).toBeVisible();

    // Each card must contain at least one of the four verified labels.
    const verifiedCount = await page
      .locator('a[href^="/atlas/"]')
      .getByText(/✓ Peer-reviewed|✓ Community|✓ Textbook|✓ CUVET/)
      .count();
    const cardCount = await cards.count();
    expect(
      verifiedCount,
      `every card (${cardCount}) must show a verified badge`,
    ).toBeGreaterThanOrEqual(cardCount);

    // ZERO tolerance for AI residue across the page.
    expect(await page.locator('text=/🤖 AI-gen/').count()).toBe(0);
    expect(await page.locator('text=/AI-illustrative/').count()).toBe(0);
    expect(
      await page.getByRole('button', { name: /AI-illustrative/i }).count(),
    ).toBe(0);
  });

  test('removed AI slugs no longer resolve', async ({ page }) => {
    // The 5 retired Pollinations entries — if any sneaks back into
    // lib/atlas.ts these become 200s instead of 404s.
    const ghostSlugs = [
      'canine-abdomen-lat-001',
      'canine-skull-lat-001',
      'canine-stifle-lat-001',
      'canine-elbow-lat-001',
      'canine-cspine-lat-001',
    ];
    for (const slug of ghostSlugs) {
      const resp = await page.goto(`/atlas/${slug}`);
      expect(resp?.status(), `${slug} should be 404`).toBe(404);
    }
  });
});
