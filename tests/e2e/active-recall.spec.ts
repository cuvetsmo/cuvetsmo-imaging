// active-recall.spec.ts — most important smoke test.
//
// End-to-end of Phase 1+2+3: case detail loads → recall textarea
// accepts notes → tap-twice reveal CTA shows expert findings.
//
// We use mendeley-vhs-1 because:
//   - It's the first card in lib/cases.ts (stable slug)
//   - It has a populated recall.ddx so the ranker step DOES render
//   - The DICOM file is in public/cases/mendeley-vhs-1/Lateral.dcm
//
// Implementation note: CaseDetailView keeps the recall textarea MOUNTED
// after reveal (it just toggles aria-hidden + pointer-events-none so the
// crossfade animation works). So `recall.isHidden()` would lie. We assert
// on the new card that becomes VISIBLE instead — either DDxRankerCard
// ("Rank the top 3 ...") if the case has recall.ddx, or RevealedCard
// ("Expert findings") otherwise. Both paths are accepted.

import { test, expect } from '@playwright/test';

test('Active Recall flow: notes → reveal → expert card appears', async ({
  page,
}) => {
  await page.goto('/cases/mendeley-vhs-1');

  // The recall textarea — aria-label is stable.
  const recall = page.getByLabel('Your findings for this case');
  await expect(recall).toBeVisible({ timeout: 15_000 });
  await recall.fill('Cardiac silhouette enlarged, VHS appears > 10.5v.');

  // Reveal button: first click arms ("Tap again to confirm"), second
  // click within 4s triggers reveal. The button is the SAME DOM node;
  // its accessible name changes from "Reveal expert answer" to
  // "Tap again to confirm" between clicks.
  await page.getByRole('button', { name: /Reveal expert answer/i }).click();
  await page.getByRole('button', { name: /Tap again to confirm/i }).click();

  // After reveal, EITHER:
  //   (a) DDxRankerCard mounts → contains "Rank" + "top 3 differentials"
  //   (b) RevealedCard mounts → contains "Expert findings" header
  // We accept either. Both are correct outcomes per CaseDetailView.tsx.
  const expertCard = page.getByText(/Rank|Expert findings|Top differential/i).first();
  await expect(expertCard).toBeVisible({ timeout: 8_000 });
});
