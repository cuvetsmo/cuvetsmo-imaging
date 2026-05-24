// playwright.config.ts — E2E smoke tests for cuvetsmo-imaging Phase 8.
//
// Scope decisions:
//   - Chromium-only for both desktop + mobile profiles (no Firefox/Safari).
//     Rationale: Cornerstone3D's WebGL rendering is the only "browser
//     diversity" risk vector, and Cornerstone is already tested manually
//     across browsers during Phase 7 polish. Adding Firefox/WebKit would
//     triple CI time for ~zero incremental coverage on the smoke surface.
//   - Mobile profile uses 375x812 (iPhone X+ portrait) — the canonical
//     mobile breakpoint VetMock + Hanong + Imaging all design around.
//   - webServer reuses an existing dev server when running locally so
//     Palm can `npm run dev` once + iterate with `npm run test:e2e` fast.
//     CI will start its own server (reuseExistingServer:true is a no-op
//     when nothing is listening on 3000).

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Cornerstone-heavy pages need a longer wait — bump from default 30s.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Smoke surface: fail fast, do not retry. Flakes should be investigated
  // not papered over.
  retries: 0,
  // Local-only smoke; CI integration is a separate decision.
  workers: 2,
  reporter: [['list']],
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    // Capture trace on first retry — useful for the rare flake.
    trace: 'on-first-retry',
    // No video by default; the smoke surface is fast enough that re-running
    // is cheaper than disk I/O for video capture.
    video: 'off',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'chromium-mobile',
      use: {
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
