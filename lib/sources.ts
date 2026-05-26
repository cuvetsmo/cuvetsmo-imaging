// Data + learning sources registry — single source-of-truth for the
// open veterinary radiology resources that power Imaging Lab.
//
// Two tiers:
//   1. tier: "ship"      — CC BY 4.0 datasets we mirror into /public/cases
//                          and /public/atlas. Image bytes live in our
//                          repo with verbatim attribution.
//   2. tier: "external"  — free learning portals with no explicit open
//                          license. We link OUT only; we do NOT mirror
//                          their images (Iron Rule 0 — only redistribute
//                          what we have license to redistribute).
//
// All facts (title · authors · DOI · license · operator) are verified
// against the live source page on 2026-05-24 (see session log).
//
// Adding a new source:
//   - Append to SOURCES below.
//   - If `tier === "ship"`, also wire the attribution string into
//     lib/cases.ts or lib/atlas.ts where the bytes are used. Keep the
//     attribution string verbatim — CC BY 4.0 requires "reasonable"
//     credit (verbatim is reasonable; abbreviation is asking for an
//     audit complaint).
//   - Bump `last_verified` to today's date.

export type SourceTier = "ship" | "external" | "pending";

export type DataSource = {
  /** Stable slug used as React key + anchor. */
  id: string;
  /** Display title — long form, verbatim from source page. */
  title: string;
  /** Operator / authors / publishing body. */
  attribution: string;
  /** Canonical URL. */
  url: string;
  /** SPDX-ish short label for the badge ("CC BY 4.0" · "Free, no open license" etc). */
  license: string;
  /** "ship" = we mirror image bytes · "external" = link-out only. */
  tier: SourceTier;
  /** What this source is, in 1 sentence — neutral, factual. */
  summary: string;
  /** How Imaging Lab integrates it today, in 1–2 sentences. */
  how_we_use_it: string;
  /** Short label that goes on the badge — e.g. "Atlas · Cases" or "Browser-only viewer". */
  surfaces: string[];
  /** Date we last verified the URL + facts. ISO date. */
  last_verified: string;
  /** Optional DOI (preferred) or formal citation. */
  doi?: string;
  /** Optional sentence noting WHY we don't redistribute (for external tier). */
  redistribution_note?: string;
};

export const SOURCES: DataSource[] = [
  // ──────────────────────────────────────────────────────────────
  // Tier 1 — CC BY 4.0 datasets we redistribute
  // ──────────────────────────────────────────────────────────────
  {
    id: "vetxray-zenodo",
    title:
      "VetXRay — A Dataset of 9,882 Manually Annotated Canine and Feline Thoracic Radiographs with Lesion and Image Quality Annotations",
    attribution: "Banzato, Tommaso; Burti, Silvia; Zotti, Alessandro; Wodzinski, Marek",
    url: "https://zenodo.org/records/19051776",
    license: "CC BY 4.0",
    tier: "ship",
    summary:
      "9,882 dog and cat thoracic radiographs annotated by a veterinary radiologist with 17 pathological findings plus 5 image-quality tags. Hosted on Zenodo (CERN), DOI-citable.",
    how_we_use_it:
      "13 hand-picked DICOM cases (8 feline + 5 canine, covering normal · cardiomegaly · pleural effusion · pneumothorax · alveolar/interstitial/bronchial pattern · mass) live in /public/cases, and 2 entries seed the atlas. Each case keeps the verbatim Zenodo citation in its attribution field.",
    surfaces: ["Cases", "Atlas"],
    last_verified: "2026-05-24",
    doi: "10.5281/zenodo.19051776",
  },
  {
    id: "mendeley-vhs",
    title: "Radiographic Dataset for VHS determination learning process",
    attribution:
      "Flores Duenas, Cesar Augusto; Gaxiola Camacho, Soila Maribel; Montaño Gómez, Martin Francisco — Universidad Autónoma de Baja California, 2020",
    url: "https://data.mendeley.com/datasets/ktx4cj55pn/1",
    license: "CC BY 4.0",
    tier: "ship",
    summary:
      "152 lateral thoracic radiographs of dogs in PNG (reduced from 628 original DICOM) curated for Vertebral Heart Score measurement practice. Original measurements were excluded to avoid biasing training.",
    how_we_use_it:
      "3 representative images converted to DICOM and seeded as VHS-practice cases. The VHS overlay tool autoloads against canine reference range 8.5–10.5 (Buchanan & Bücheler 1995).",
    surfaces: ["Cases", "VHS overlay"],
    last_verified: "2026-05-24",
    doi: "10.17632/ktx4cj55pn.1",
  },

  // ──────────────────────────────────────────────────────────────
  // Tier 2 — Free learning portals, link-out only (no explicit
  // open license, so we cannot mirror their images)
  // ──────────────────────────────────────────────────────────────
  {
    id: "vet-dicom-library",
    title: "VET DICOM Library",
    attribution: "Klever & Matenaers, since 2018",
    url: "https://www.dicomlibrary.vet/about/",
    license: "Free, no open redistribution license",
    tier: "external",
    summary:
      "Free online portal where veterinary professionals share and view anonymized DICOM cases. Files are anonymized at upload. Intended for radiologists, cardiologists, professors and students.",
    how_we_use_it:
      "Linked from Imaging Lab as an external case-browse resource. Drop DICOM downloaded from VET DICOM Library straight into our viewer to read in your browser.",
    surfaces: ["External viewer"],
    last_verified: "2026-05-24",
    redistribution_note:
      "Site Terms of Service govern individual case files; we don't mirror images. Use the link to view in their portal or download for personal study.",
  },
  {
    id: "ivra-oer",
    title: "IVRA Open Education Resources",
    attribution: "International Veterinary Radiology Association",
    url: "https://www.ivraimaging.org/oer-open-education-resources",
    license: "Free access, no open license stated",
    tier: "external",
    summary:
      "Teaching materials from the International Veterinary Radiology Association — summaries of imaging findings in infectious disease, a case-of-the-month archive, and curated links to other diagnostic-imaging resources.",
    how_we_use_it:
      "Linked from Imaging Lab as a curated reading + case-of-the-month reference. Best paired with a case from /cases when reviewing infectious-disease patterns.",
    surfaces: ["Learning"],
    last_verified: "2026-05-24",
    redistribution_note:
      "Resources are explicitly free of charge but no formal open license is stated, so we link out instead of mirroring.",
  },
  {
    id: "ceg-radiographic-viewer",
    title: "CEG Interactive Radiographic Viewer",
    attribution:
      "Cardiac Education Group, funded by Boehringer Ingelheim Vetmedica, IDEXX Laboratories, and Nestlé Purina PetCare",
    url: "https://cardiaceducationgroup.org/learn/interactive-radiographic-viewer/",
    license: "Free web viewer, no open license stated",
    tier: "external",
    summary:
      "Web-based VHS and VLAS practice tool. 60+ dog and cat cases (normal and abnormal) with instructional videos for feline VHS, canine VHS, and canine VLAS. Your measurement is compared against the CEG reference read.",
    how_we_use_it:
      "Linked from Imaging Lab as the canonical second-opinion drill for VHS / VLAS. After measuring VHS on a /cases case, cross-check your technique on a CEG case for the same species.",
    surfaces: ["VHS practice", "VLAS practice"],
    last_verified: "2026-05-24",
    redistribution_note:
      "Browser-only viewer with no download function — we link to the live tool.",
  },

  // ──────────────────────────────────────────────────────────────
  // Tier 3 — Pending approval (transparent placeholder)
  // ──────────────────────────────────────────────────────────────
  {
    id: "cuvet-internal-teaching",
    title: "CUVET Small Animal Hospital — anonymized teaching cases",
    attribution:
      "Small Animal Hospital of Chulalongkorn University · DI Unit · advisor ผศ. เอกพล อัครพุทธิพร",
    // Internal hospital source — no public URL.
    url: "/sources#cuvet-internal-teaching",
    license: "Educational use, anonymized with Aj. approval",
    tier: "ship",
    summary:
      "Radiograph exports from the CUVET PACS (Fujifilm Synapse 5), anonymized via full-width top + bottom band PII scrub. Each batch goes through a 4-pass QA pipeline before any byte ships: (1) scrub, (2) mask black-band assertion, (3) re-open + visual recheck of the file at its production path, (4) post-deploy live curl.",
    how_we_use_it:
      "Batch 01 (2026-05-26) ships 5 atlas entries: 1 canine pelvic VD (Norberg baseline), 1 feline + 1 canine lateral skull (dental anatomy), 1 feline DV skull, 1 canine lateral thorax (VHS-compatible). Future batches add Norberg-ground-truth cases as Aj. sign-off lands per-case.",
    surfaces: ["Atlas (batch 01)", "Cases (future)", "Norberg ground truth (future)"],
    last_verified: "2026-05-26",
    redistribution_note:
      "Only anonymized derivatives ship — patient name + HN + date + hospital line + side text are removed in scrub. Raw PNG bytes from the hospital dump are gitignored at the source. See scratch/cuvet-triage-2026-05-26/ for the pipeline scripts (local-only).",
  },
];

/** Helper for /sources page rendering — split by tier in the order they should display. */
export function sourcesByTier(): {
  ship: DataSource[];
  external: DataSource[];
  pending: DataSource[];
} {
  return {
    ship: SOURCES.filter((s) => s.tier === "ship"),
    external: SOURCES.filter((s) => s.tier === "external"),
    pending: SOURCES.filter((s) => s.tier === "pending"),
  };
}

/** Helper — lookup by id (used by anchored deep-link or future per-source detail). */
export function getSource(id: string): DataSource | undefined {
  return SOURCES.find((s) => s.id === id);
}
