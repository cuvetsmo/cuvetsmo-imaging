# cuvetsmo-imaging tests

Phase 8 testing setup. Two layers:

## 1. `tests/unit/` — vitest + jsdom

Pure logic (no Cornerstone3D, no WebGL). 67 tests covering:

- `scoring/iou.test.ts` — bounding-box IoU + bucketing (Agent ⑦)
- `scoring/measurement.test.ts` — Norberg + VHS tolerance buckets (Agent ⑧)
- `srs.test.ts` — Leitner-style 4-bucket SRS scheduler (Agent B Phase 2)
- `ddx-pools.test.ts` — 6-option assembly + scoring + seeded shuffle (Agent C)
- `study-organizer.test.ts` — pure DICOM Study→Series→Image grouping (Agent 🅲)
- `anonymize.test.ts` — synthetic-DICOM build + PII tag scrubbing (Agents ⓔ + Ⓒ)

Run: `npm test` (one-shot) · `npm run test:watch` · `npm run test:coverage`

Coverage budget: ~75% lines across the tested lib/ modules. iou.ts +
study-organizer.ts + ddx-pools.ts are all > 95%.

**Why no Cornerstone tests here**: WebGL is unavailable in jsdom. Anything
that touches `@cornerstonejs/*` belongs in `tests/e2e/`.

## 2. `tests/e2e/` — Playwright (chromium-only, desktop + mobile)

Smoke tests against a real Next.js dev server. 5 specs × 2 viewports = 10 tests:

- `home.spec.ts` — `/` loads + 5 nav links + 0 console errors
- `cases.spec.ts` — Case Library renders + search/filter + click into detail
- `atlas.spec.ts` — Atlas grid + credibility pill segment toggle
- `review.spec.ts` — `/review` queues new cases for fresh visitors
- `active-recall.spec.ts` — full notes → reveal → expert card flow

Run: `npm run test:e2e` · `npm run test:e2e:ui` (Playwright UI mode)

Profiles: `chromium-desktop` (1280×720) + `chromium-mobile` (375×812).
Firefox/WebKit deliberately omitted — Cornerstone's WebGL renderer is the
only cross-browser risk vector and it's manually verified each phase.

**First time setup**: `npx playwright install chromium`

## Conventions

- No `describe` nesting > 2 levels (avoid over-structuring)
- No real DICOM fixtures shipped in `tests/` — synthetic builder in
  `anonymize.test.ts` if you need a parseable file
- Unit suite must stay under 5s total (currently ~4s)
- E2E must use stable accessibility queries (`getByRole` / `getByLabel`) —
  CSS-class selectors break on every refactor
