// tests/setup.ts — global vitest setup for the unit tree.
//
// Wires @testing-library/jest-dom matchers (.toBeInTheDocument(), etc.)
// onto vitest's expect. Imported once via vitest.config.ts `setupFiles`.

import '@testing-library/jest-dom/vitest';
