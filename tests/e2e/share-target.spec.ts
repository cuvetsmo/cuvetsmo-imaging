// share-target.spec.ts — Phase 6 PWA share-receiver graceful degrade.
//
// The full PWA Share Target flow needs a real service-worker POST that
// stashes files in IndexedDB · Playwright can simulate this but the
// flake surface (SW registration timing + IDB cross-origin) isn't
// worth it for a Phase 9 smoke. We instead verify the two cheap
// degrade paths:
//
//   1. Direct visit to /share-receiver with NO ?ts= query param:
//      drainShareInbox(null) returns null (no inbox row) so the
//      ShareReceiverClient lands in phase='empty' and renders
//      EmptyState (the "ยังไม่มีไฟล์ใน inbox" card).
//
//   2. Visit /share-receiver?ts=99999 (timestamp that has no matching
//      inbox row): same code path — drainShareInbox finds no row,
//      EmptyState renders. Graceful degrade, not a hard error.
//
// What we INTENTIONALLY don't test here:
//   - Real share-target POST (needs SW intercept + IDB seed)
//   - Error states from corrupt inbox rows (covered by unit tests
//     of drainShareInbox)
//   - The successful import → redirect-home flow
//
// Iron Rule 0: an empty-state assertion proves the page handles the
// "no files" path, NOT that the share-target flow itself works
// end-to-end. We're explicit about that scope.

import { test, expect } from '@playwright/test';

test.describe('PWA share-receiver graceful degrade', () => {
  test('direct visit with no ?ts= → empty state visible', async ({ page }) => {
    await page.goto('/share-receiver');

    // The page header copy is owned by ShareReceiverClient.tsx
    // ("รับไฟล์ DICOM"). Visible in BOTH the loading-fallback and
    // the empty state, so it's a safe initial anchor.
    await expect(
      page.getByRole('heading', { name: /รับไฟล์ DICOM/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Empty-state copy: "ยังไม่มีไฟล์ใน inbox" — owned by EmptyState
    // sub-component (ShareReceiverClient.tsx line 462). This fires
    // ONLY when drainShareInbox returns null, which it does on a
    // fresh visit with no SW-stashed row.
    await expect(
      page.getByText(/ยังไม่มีไฟล์ใน inbox/),
    ).toBeVisible({ timeout: 8_000 });

    // Footer link back home — proves the user has a way out of the
    // dead end. Copy owned by FooterActions sub-component.
    await expect(
      page.getByRole('link', { name: /ไปหน้าหลัก/i }),
    ).toBeVisible();
  });

  test('visit with non-existent ?ts= → empty state visible (no crash)', async ({
    page,
  }) => {
    // ts=99999 is a Unix-ms timestamp that has no matching inbox
    // entry. drainShareInbox(99999) returns null without throwing,
    // so the same EmptyState branch should render.
    await page.goto('/share-receiver?ts=99999');

    await expect(
      page.getByRole('heading', { name: /รับไฟล์ DICOM/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Same assertion as the direct-visit test — both code paths
    // converge on EmptyState when no row is found.
    await expect(
      page.getByText(/ยังไม่มีไฟล์ใน inbox/),
    ).toBeVisible({ timeout: 8_000 });

    // iOS-Safari unsupported callout should appear in the empty
    // state — it's a critical UX detail and proves the empty state
    // rendered the FULL component (not just a partial loading state).
    await expect(
      page.getByText(/iOS Safari ไม่รองรับ/i),
    ).toBeVisible();
  });
});
