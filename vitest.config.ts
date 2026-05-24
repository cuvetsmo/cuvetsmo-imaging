// vitest.config.ts — unit-test runner for cuvetsmo-imaging Phase 8.
//
// Scope:
//   - Pure logic in lib/ (iou, measurement, srs, ddx-pools, study-organizer,
//     anonymize) is jsdom-friendly and runs here.
//   - Anything that imports @cornerstonejs/* MUST stay in Playwright (E2E)
//     because Cornerstone3D needs a real WebGL context. Test files that
//     pull in a Cornerstone-dependent module will fail with
//     "WebGLRenderingContext is not defined" — that's the signal to move
//     the test to tests/e2e/ instead of stubbing the entire renderer.
//
// React is wired via @vitejs/plugin-react v4 (peer-pinned to vite 5 which
// vitest 2 bundles). Bumping to plugin-react v6 requires vite 8 and would
// drag in a vitest 3+ upgrade — defer.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirror the tsconfig `@/*` path so tests can import lib/ files the
    // same way production code does.
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    // Hard exclude the Playwright spec tree so vitest never tries to
    // execute it as a jsdom test (different runner, different globals).
    exclude: ['node_modules/**', '.next/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Only measure the modules we actually test. Including app/ and
      // components/ would tank the % since most React surfaces are E2E
      // territory, not unit.
      include: [
        'lib/scoring/**',
        'lib/srs.ts',
        'lib/ddx-pools.ts',
        'lib/dicom/study-organizer.ts',
        'lib/dicom/anonymize.ts',
      ],
      exclude: ['**/*.d.ts', '**/index.ts'],
    },
  },
});
