// scripts/lint-iron-rule-0.mjs
//
// Automated Iron Rule 0 guard. Scans data + production-rendered files
// for forbidden patterns that would re-introduce AI/fabricated content
// or PII attribution drift. Exit code 1 on any violation so CI / the
// prebuild step blocks the deploy.
//
// Runs as `npm run lint:iron-rule-0` standalone, or as part of the
// `prebuild` script alongside sync-cases-json.mjs.

import { readFileSync, existsSync } from "node:fs";

// ---- Patterns that must NOT appear ----
// Each entry: { pattern (RegExp), files (string[]), reason (string) }
// Patterns are evaluated per-file. Source-of-truth data files
// (lib/atlas.ts · lib/cases.ts · public/cases.json) get the strictest
// checks. Production-rendered components get a narrower set so the
// "🤖 Load AI" feature (which IS a real function for loading AI
// prediction JSON files) doesn't false-positive.

const DATA_FILES = ["lib/atlas.ts", "lib/cases.ts", "public/cases.json"];
const RENDER_FILES = ["components/lab/LabHome.jsx", "components/atlas/AtlasGrid.tsx"];

const CHECKS = [
  {
    pattern: /credibility:\s*['"]ai-generated['"]/i,
    files: DATA_FILES,
    reason: "AI-generated atlas/case entries are forbidden (Phase 13 directive)",
  },
  {
    pattern: /POLLINATIONS_LICENSE|POLLINATIONS_ATTR/,
    files: DATA_FILES,
    reason: "Pollinations constants were retired in Phase 13",
  },
  {
    pattern: /Pollinations\.ai/i,
    files: [...DATA_FILES, ...RENDER_FILES],
    reason: "Pollinations.ai references must stay out of production data + UI",
  },
  {
    pattern: /credibility:\s*['"][^'"]*['"]/g,
    files: DATA_FILES,
    reason: "credibility value must be one of: peer-reviewed | open-textbook | community | cuvet-internal",
    validator: (matches) => {
      const allowed = new Set(["peer-reviewed", "open-textbook", "community", "cuvet-internal"]);
      const bad = [];
      for (const m of matches) {
        const val = m.replace(/credibility:\s*['"]/, "").replace(/['"]/, "");
        if (!allowed.has(val)) bad.push(val);
      }
      return bad.length > 0 ? bad : null;
    },
  },
];

// ---- Run ----
let violations = 0;
let checked = 0;

for (const check of CHECKS) {
  for (const filePath of check.files) {
    if (!existsSync(filePath)) continue;
    checked++;
    const content = readFileSync(filePath, "utf8");
    if (check.validator) {
      // collect-then-validate · ensure pattern has /g for matchAll
      const globalPattern = check.pattern.flags.includes("g")
        ? check.pattern
        : new RegExp(check.pattern.source, check.pattern.flags + "g");
      const matches = [...content.matchAll(globalPattern)].map((m) => m[0]);
      const bad = check.validator(matches);
      if (bad && bad.length > 0) {
        console.error(`[iron-rule-0] FAIL ${filePath}: ${check.reason}`);
        console.error(`  bad values: ${JSON.stringify(bad)}`);
        violations++;
      }
    } else {
      // simple match check
      const match = check.pattern.exec(content);
      if (match) {
        console.error(`[iron-rule-0] FAIL ${filePath}: ${check.reason}`);
        console.error(`  matched: ${JSON.stringify(match[0].slice(0, 80))}`);
        violations++;
      }
    }
  }
}

if (violations > 0) {
  console.error(`\n[iron-rule-0] ${violations} violation(s) across ${checked} file-checks`);
  process.exit(1);
}

console.log(`[iron-rule-0] CLEAN (${checked} file-checks)`);
