// CUVET-internal teaching cases — distinct from the public CC BY 4.0
// case library in `lib/cases.ts`.
//
// Provenance:
//   Cases here are sourced from CUVET Small Animal Hospital (Fujifilm
//   Synapse 5 PACS) and require:
//     1. Aj. Ekkapol Akkraputtiporn (DI Unit) sign-off per case
//     2. PII scrub of burn-in (Synapse exports embed patient name + HN
//        + date + hospital line in fixed corner zones — see
//        scratch/cuvet-triage-2026-05-26/triage-report.md)
//     3. Filename rename to non-identifying slug
//     4. Anonymized derivative dropped under
//        /public/cases/cuvet-internal/<slug>/ (gitignored by default;
//        Palm enables on a per-case basis once approval is in hand)
//
// Until those gates clear, this file SHIPS WITH AN EMPTY ARRAY. The
// type system, badge, and provenance rendering are wired and tested
// so that integrating an approved case is a 1-PR append, not a
// scaffolding sprint.
//
// Memory rules in play (vault):
//   - `project_senior-project-norberg-chd.md` — Aj. Ekkapol = advisor
//   - vault cases.ts header — "1 cuvet-internal case (น้องคอฟฟี่)
//     skipped pending Aj. approval"
//   - Iron Rule 0 — never ship patient data without consent + scrub

import type { Modality, ImagingCase } from "@/lib/cases";

/** Approval state per case — visible in the UI tooltip. */
export type CuvetApprovalState =
  /** Aj. has verbally approved this teaching case for educational use. */
  | "approved"
  /** Anonymized derivative exists but Aj. has not signed off yet. */
  | "pending-approval"
  /** Aj. asked to hold — not for student-facing surfaces yet. */
  | "hold";

export type CuvetInternalCase = ImagingCase & {
  /** Original Synapse identifier (kept LOCAL — never serialized to the client bundle). */
  internal_ref?: string;
  /** Aj. sign-off state. Only "approved" cases render at runtime. */
  approval_state: CuvetApprovalState;
  /** Short note for Palm + Aj. visible only on the curator surface. */
  curator_note?: string;
};

/**
 * Cuvet teaching cases that have cleared approval AND PII scrub.
 *
 * EMPTY BY DESIGN. The pipeline (per
 * scratch/cuvet-triage-2026-05-26/triage-actions.md) is:
 *
 *   1. Triage manifest → Aj. picks 5–10 cases for first batch
 *   2. Synapse PNGs get scrubbed (top corner pixel mask) and renamed
 *      to slug-based filenames
 *   3. Drop assets under /public/cases/cuvet-internal/<slug>/
 *   4. Append a fully-typed entry below with credibility: "cuvet-internal"
 *      and approval_state: "approved"
 *   5. Build + ship — the listing UIs auto-pick up the new case
 *
 * Nothing else needs to change in the client code.
 */
export const CUVET_INTERNAL_CASES: CuvetInternalCase[] = [];

/** Only "approved" cases are rendered. Other states stay in the file as a record. */
export function visibleCuvetCases(): CuvetInternalCase[] {
  return CUVET_INTERNAL_CASES.filter((c) => c.approval_state === "approved");
}

/** Shared attribution string — verbatim, used by every Cuvet case card. */
export const CUVET_INTERNAL_ATTRIBUTION =
  "Courtesy of Small Animal Hospital of Chulalongkorn University · DI Unit · used with permission for veterinary education";

/** Re-export for convenience so importers can type cases uniformly. */
export type { Modality };
