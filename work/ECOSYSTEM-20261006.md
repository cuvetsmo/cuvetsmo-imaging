# Imaging Athene study bridge — candidate receipt, 2026-10-06

Base: canonical GitHub `cuvetsmo/cuvetsmo-imaging` main `ab49a3007a90efc1193dc99ba68d71d27ac8c135`. The stale saved Desktop/CUVETSMO root was checked and absent. A new bare reference and isolated worktree were created under this task's ecosystem directory; no original checkout was edited. No commit/push/deployment/migration/provider call or private-file upload.

## Scope and API

Canonical selector correction after receiver review: `/api/athene-context` accepts `ref` and the exact backward-compatible `id` alias. Conflicting values or duplicate selectors fail400. Existing actual route-function contract check passed after this narrow patch; whole frontend build was not repeated. Exact updated route/check hashes: `work/endpoint-ref-patch.json`. Previously compiled local port3413 still represents the earlier id-only route and must not be used as proof of the updated query contract.

`GET /api/athene-context?kind=atlas|case&id=<real slug or ID>` returns schema version 1, surface/kind/canonical ref, title/summary/points, canonical source URL, existing public images with license/attribution, provenance/data revision and actual retrieval time. Data comes from the canonical `ATLAS_ENTRIES` and `CASES` registries. Unknown selectors are rejected. No recalls/answer keys, raw DICOM files, patient tags or student notes enter the response. Source images must be existing `/public/atlas/*.png|jpg` records; no remote user-controlled URL is accepted.

CORS has a fixed `https://ai.cuvetsmo.com` allowlist, no credentials and `Vary: Origin`. Optional `ATHENE_DEV_ORIGIN` accepts exactly one localhost/127.0.0.1 HTTP origin in development and is ignored in production. Successful public metadata caches for five minutes; retrieval timestamps are generated at response time, not fabricated publication dates.

Owner-flow details preview uses the existing product's tokens and primitives. The link is `https://ai.cuvetsmo.com/?handoff=imaging&kind=atlas|case&ref=<canonical slug>`; only public IDs travel in the URL. Atlas CTA is available on its existing record page. Case CTA is gated behind the existing `mode === 'revealed'`; it neither skips recall nor changes viewer/measurement logic. Image attachment and question sending remain explicit actions in the Athene receiver.

## Actual checks

- Worktree-own `npm ci --ignore-scripts --no-audit --no-fund` completed with existing locked dependencies.
- Read Next 16.2.6 bundled route/server-client documentation before implementation.
- `node scripts/athene-context-check.mjs`: every real atlas/case record projects correctly; every returned image exists locally; metadata limits, exact refs and ID-only links, no private/answer-key fields, missing selectors, positive/negative CORS and production localhost refusal all passed.
- Full `tsc --noEmit --incremental false`: passed.
- Targeted ESLint on helper/owner-flow/endpoint: passed.
- Required `npm run build`: case sync, Iron Rule 0 (14 file checks), webpack compile, typecheck and prerender passed. Generated `public/cases.json` remains semantically identical to HEAD; Git's Windows line-ending warning remains recorded.
- Production-build local server `http://127.0.0.1:3413`: actual mobile Chromium checked atlas preview/link, live local metadata API/public image URL, disallowed-origin refusal, case CTA absence before recall reveal and presence afterwards, and no provider-upload call. `scripts/verify-athene-browser.mjs <installed Playwright index.mjs>` passed with process exit 0. Screenshot: `work/browser/atlas-handoff.png`.

## Verified VetMock destinations (adjacent study product; no VetMock changes)

Current remote reference `origin/main` in VetMock was `6b454dce055a52041d011b9bffbabd9960549828`. Canonical question bank/share-link/atlas-catalog blobs match the inspected primary files; the latest remote delivery predicate separately confirmed the actual compound keys `com5:500`, `com5:501`, `com5:502` deliverable. Native quiz encode/decode round-trip passed. Exact current source routes:

- `/wiki/com5/cve` and `/wiki/com5/rabies` (keys confirmed in remote governed topic registry).
- `/app/library?subject=com5` (existing exact-subject shelf filter).
- `/app/atlas#specimen=canine-skull-base-cuhl9&part=basisphenoid` (actual catalogue specimen/part).
- `/?qset=W3sicyI6ImNvbTUiLCJpIjo1MDB9LHsicyI6ImNvbTUiLCJpIjo1MDF9LHsicyI6ImNvbTUiLCJpIjo1MDJ9XQ` (three actual numeric bank IDs and subject compound keys).

Personal/string question IDs are not passed through the existing numeric share decoder. These are source-contract checks, not production login/exam outcomes.

## Limits / next step

Cross-domain receiver integration belongs to the root cuvetsmo-ai candidate and is not a public release. No provider interpretation was requested, no clinical conclusions were generated, no model overlay was substituted for real images, and no physical-device test was run. Root may map the two canonical public endpoint hosts to the local QA endpoints for an integrated metadata-fetch/review flow before release.
