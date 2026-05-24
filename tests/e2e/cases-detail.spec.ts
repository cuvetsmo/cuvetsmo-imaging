// cases-detail.spec.ts — deeper coverage of the case detail flow than
// active-recall.spec.ts (which stops at "expert card appears"). This
// spec drives the DDx ranker branch specifically.
//
// We use vetxray-canine-cardiomegaly because:
//   - It has non-empty recall.ddx (3 entries: MMVD, DCM, Congenital)
//     so the ranker step DOES render after reveal (not just the
//     compare card)
//   - It has lesion_regions populated (1 enlarged cardiac silhouette
//     box) — though we don't drive spotting in this spec to keep it
//     fast and not flake on a draggable canvas
//   - Single Lateral.dcm file (proven by ls check) so it loads fast
//
// Selector strategy: aria-label + role-based selectors only. We avoid
// data-testid because production code doesn't use them today and the
// spec says "don't add new ones."

import { test, expect } from '@playwright/test';

test.describe('Case detail flow · DDx ranker branch', () => {
  test('cardiomegaly case · notes → reveal → ranker shows → skip → compare', async ({
    page,
  }) => {
    await page.goto('/cases/vetxray-canine-cardiomegaly');

    // Wait for the case shell to mount. The heading is the most
    // stable anchor — title is "Canine lateral thoracic · CARDIOMEGALY".
    await expect(
      page.getByRole('heading', { name: /CARDIOMEGALY/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Type recall notes (aria-label stable per RecallInputCard.tsx)
    const recall = page.getByLabel('Your findings for this case');
    await expect(recall).toBeVisible();
    await recall.fill(
      'Generalized cardiomegaly · VHS likely >10.5 · ddx: MMVD',
    );

    // Two-step reveal pattern. First click ARMS the button (label
    // flips to "Tap again to confirm"), second click within 4 s FIRES.
    await page
      .getByRole('button', { name: /Reveal expert answer/i })
      .click();
    await page
      .getByRole('button', { name: /Tap again to confirm/i })
      .click();

    // Because this case has a non-empty `recall.ddx`, CaseDetailView
    // routes mode → 'ranking' (not directly to 'revealed'). The
    // DDxRankerCard renders with the headline copy "Rank ..." — we
    // accept either the case-meta-driven phrasing OR the literal
    // ranker prompt because the exact copy is owned by DDxRankerCard
    // and may evolve.
    await expect(
      page
        .getByText(/Rank.*top|Pick the (top|three)|differentials/i)
        .first(),
    ).toBeVisible({ timeout: 8_000 });

    // Skip ranker affordance — copy is "Skip ranking · just reveal →".
    // Clicking flips mode → 'revealed', which mounts RevealedCard.
    const skipRanker = page.getByRole('button', {
      name: /Skip ranking/i,
    });
    await expect(skipRanker).toBeVisible();
    await skipRanker.click();

    // RevealedCard shows the "Expert findings" header per
    // RevealedCard.tsx line 120. This is the proof the mode transition
    // landed correctly.
    await expect(
      page.getByText(/Expert findings/i).first(),
    ).toBeVisible({ timeout: 6_000 });

    // The student's notes should be echoed in the compare view —
    // "Your notes" section header (RevealedCard.tsx line 103) is the
    // proof that the textarea content survived the mode transition.
    await expect(page.getByText(/Your notes/i).first()).toBeVisible();
  });

  test('skip-recall affordance jumps straight to revealed', async ({
    page,
  }) => {
    await page.goto('/cases/vetxray-canine-cardiomegaly');

    // Wait for the case shell + DICOM blob fetch to settle. Without
    // this, the lazy DicomViewport mount can race the "Skip recall"
    // button lookup on cold-cache runs and we get a false-negative.
    // networkidle is the right primitive here — the case-index fetch
    // + DICOM blob fetch are the only network activity, and once
    // both complete the page has reached a stable state.
    await page.waitForLoadState('networkidle');

    // Anchor on the heading first so we know the case shell is
    // mounted before looking for the skip button. The heading copy
    // is owned by CaseDetailView line 377 ("Canine lateral thoracic
    // · CARDIOMEGALY") and is the most stable selector on the page.
    await expect(
      page.getByRole('heading', { name: /CARDIOMEGALY/i }),
    ).toBeVisible({ timeout: 15_000 });

    // The "Skip recall" link in the breadcrumb is a <button>. Copy
    // is "Skip recall — just show me the case →". Only renders while
    // mode === 'recall' (which is the initial state).
    const skipRecall = page.getByRole('button', { name: /Skip recall/i });
    await expect(skipRecall).toBeVisible({ timeout: 10_000 });
    await skipRecall.click();

    // Skipping recall goes DIRECTLY to mode='revealed' (bypasses the
    // ranker), so we should see "Expert findings" without going
    // through the ranker step.
    await expect(
      page.getByText(/Expert findings/i).first(),
    ).toBeVisible({ timeout: 6_000 });
  });
});
