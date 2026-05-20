// scripts/sync-cases-json.mjs
//
// Emit public/cases.json from lib/cases.ts. Run after editing the
// CASES array so the client-fetch path (`/cases.json`) stays in sync
// with the source-of-truth TypeScript module. Pre-Supabase-wiring.
//
// Usage: `node scripts/sync-cases-json.mjs`
// Requires Node ≥ 22 (uses native --experimental-strip-types via .ts import).

import { writeFileSync } from "node:fs";
import { CASES } from "../lib/cases.ts";

const out = "./public/cases.json";
writeFileSync(out, JSON.stringify(CASES, null, 2));
console.log(`Wrote ${CASES.length} cases to ${out}`);
