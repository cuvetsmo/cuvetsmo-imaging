// Atlas — normal-anatomy reference grid for vet students.
//
// Stage 1 of "learning to read X-rays": see normal 100 times before
// you can recognize abnormal. Each entry pairs a clean radiograph
// (modality x species x body-part x view) with a neutral description
// of what's visible — no diagnosis, no pathology, no clinical
// interpretation, just landmarks.
//
// 100% REAL POLICY (Palm directive 2026-05-26)
// ────────────────────────────────────────────
// Every entry MUST be a real radiograph from a credible source:
//   - peer-reviewed open dataset (CC BY 4.0) — VetXRay (Zenodo)
//   - open community archive (CC BY / CC BY-SA) — Wikimedia Commons
//   - anonymized CUVET teaching case (Aj.-approved, PII-scrubbed)
//
// AI-generated tiles are NOT permitted. The "ai-generated" string is
// not part of the Credibility union — TypeScript will refuse compile
// if anyone tries to add one. Body-part gaps (no stifle / elbow /
// cspine / canine-abdomen as of 2026-05-26) are disclosed in the
// honest footnote at /atlas instead of being filled with synthetic
// images.

export type Modality = "DX" | "CR" | "CT" | "MR" | "US" | "RG";

export type Species = "canine" | "feline" | "equine" | "bovine" | "exotic";

export type BodyPart =
  | "thorax"
  | "abdomen"
  | "pelvis"
  | "skull"
  | "spine"
  | "limb-fore"
  | "limb-hind"
  | "dental"
  | "other";

export type Credibility =
  | "peer-reviewed"
  | "open-textbook"
  | "community"
  | "cuvet-internal";

export type AtlasEntry = {
  id: string;
  slug: string;
  modality: Modality;
  species: Species;
  body_part: BodyPart;
  view: string; // "VD" | "DV" | "lateral" | "oblique" | "axial" | "frog-leg" | etc.
  description: string; // 1–2 sentences explaining what's visible — NEUTRAL, no dx
  learning_landmarks?: string[]; // labeled anatomical features visible in this view
  image_path: string; // /atlas/<slug>.jpg
  thumbnail_path?: string; // optional smaller version (not generated day 1)
  license: string;
  source_url?: string;
  attribution?: string;
  credibility: Credibility;
};

// Human-readable label helpers — used by AtlasGrid filter chips and
// AtlasCard meta lines. Kept here so the type and its display names
// stay in sync.
export const MODALITY_LABELS: Record<Modality, string> = {
  DX: "DX · digital X-ray",
  CR: "CR · computed radiography",
  CT: "CT",
  MR: "MR",
  US: "Ultrasound",
  RG: "RG · plain radiograph",
};

export const SPECIES_LABELS: Record<Species, string> = {
  canine: "Canine",
  feline: "Feline",
  equine: "Equine",
  bovine: "Bovine",
  exotic: "Exotic",
};

export const BODY_PART_LABELS: Record<BodyPart, string> = {
  thorax: "Thorax",
  abdomen: "Abdomen",
  pelvis: "Pelvis",
  skull: "Skull",
  spine: "Spine",
  "limb-fore": "Forelimb",
  "limb-hind": "Hindlimb",
  dental: "Dental",
  other: "Other",
};

// Phase 2 real-image swap — verbatim attribution strings derived from
// the source `imageinfo.extmetadata.LicenseShortName` field on each
// source page (Wikimedia Commons / Zenodo). Don't shorten these —
// CC BY-SA 3.0/4.0 attribution requirement says give credit "in any
// reasonable manner".
const ATTR_VETXRAY =
  "VetXRay — 9,882 manually annotated canine and feline thoracic radiographs · Zenodo · DOI:10.5281/zenodo.19051776 · CC BY 4.0";

// CUVET teaching cases attribution — kept verbatim across atlas entries
// AND lib/cuvet-internal.ts so audit grep can find one canonical string.
// Per Aj. Ekkapol approval 2026-05-26: anonymized derivatives only,
// PII burn-in scrubbed via the full-width top + bottom band mask (see
// scratch/cuvet-triage-2026-05-26/scrub_synapse.py).
const ATTR_CUVET_INTERNAL =
  "Courtesy of Small Animal Hospital of Chulalongkorn University · DI Unit · anonymized for veterinary education with permission";

export const ATLAS_ENTRIES: AtlasEntry[] = [
  {
    id: "atlas-001",
    slug: "canine-thorax-lat-001",
    modality: "DX",
    species: "canine",
    body_part: "thorax",
    view: "lateral",
    description:
      "Canine thoracic radiograph in right-lateral recumbency. Air-filled lungs read as low-density (dark) against the soft-tissue silhouette of heart, great vessels and diaphragm.",
    learning_landmarks: [
      "Cardiac silhouette",
      "Diaphragmatic line",
      "Tracheal column",
      "Caudal vena cava",
      "Vertebral column dorsally",
    ],
    image_path: "/atlas/canine-thorax-lat-001.jpg",
    license: "CC BY 4.0",
    source_url: "https://zenodo.org/records/19051776",
    attribution: ATTR_VETXRAY,
    credibility: "peer-reviewed",
  },
  {
    id: "atlas-002",
    slug: "canine-thorax-vd-001",
    modality: "DX",
    species: "canine",
    body_part: "thorax",
    view: "VD",
    description:
      "Canine thoracic radiograph in ventrodorsal projection. Lung fields are symmetric left and right of the cardiac silhouette; sternum overlies the spine.",
    learning_landmarks: [
      "Cardiac silhouette (centred)",
      "Left and right lung fields",
      "Sternum / vertebral overlap",
      "Diaphragmatic dome",
      "Mediastinum",
    ],
    image_path: "/atlas/canine-thorax-vd-001.jpg",
    license: "CC BY-SA 4.0",
    source_url: "https://commons.wikimedia.org/wiki/File:Radiographie_thoracique_ventro-dorsale.jpg",
    attribution: "Ophélie Tissier (2016). Radiographie thoracique grand chien, incidence ventro-dorsale. Wikimedia Commons. CC BY-SA 4.0.",
    credibility: "community",
  },
  {
    id: "atlas-004",
    slug: "canine-pelvis-vd-001",
    modality: "DX",
    species: "canine",
    body_part: "pelvis",
    view: "VD",
    description:
      "Canine pelvic radiograph in extended-leg ventrodorsal projection — the standard view for hip joint evaluation. Symmetric placement of femoral heads in acetabula is the baseline for Norberg-angle measurement.",
    learning_landmarks: [
      "Femoral head and neck",
      "Acetabular rim (cranial / caudal)",
      "Obturator foramen",
      "Sacroiliac joints",
      "Iliac wings",
    ],
    image_path: "/atlas/canine-pelvis-vd-001.jpg",
    license: "CC BY-SA 3.0",
    source_url: "https://commons.wikimedia.org/wiki/File:Normal_canine_hips.JPG",
    attribution: "Joel Mills (2007). Normal canine hips. Wikimedia Commons. CC BY-SA 3.0.",
    credibility: "community",
  },
  {
    id: "atlas-006",
    slug: "feline-thorax-lat-001",
    modality: "DX",
    species: "feline",
    body_part: "thorax",
    view: "lateral",
    description:
      "Feline thoracic radiograph in right-lateral recumbency. Compared with canine the cardiac silhouette is more elongated, vertebral heart score reference range differs (feline ~6.7–8.1 vs canine ~8.7–10.7).",
    learning_landmarks: [
      "Cardiac silhouette (elongated)",
      "Tracheal column (more horizontal)",
      "Lung fields",
      "Diaphragmatic line",
      "Caudal vena cava",
    ],
    image_path: "/atlas/feline-thorax-lat-001.jpg",
    license: "CC BY 4.0",
    source_url: "https://zenodo.org/records/19051776",
    attribution: ATTR_VETXRAY,
    credibility: "peer-reviewed",
  },
  {
    id: "atlas-007",
    slug: "feline-abdomen-lat-001",
    modality: "DX",
    species: "feline",
    body_part: "abdomen",
    view: "lateral",
    description:
      "Feline abdominal radiograph in right-lateral recumbency. Smaller frame than canine; renal silhouettes are typically more conspicuous due to retroperitoneal fat.",
    learning_landmarks: [
      "Liver silhouette",
      "Gastric gas",
      "Small intestinal loops",
      "Colon",
      "Renal silhouettes (often visible)",
      "Urinary bladder",
    ],
    image_path: "/atlas/feline-abdomen-lat-001.jpg",
    license: "CC BY-SA 4.0",
    source_url: "https://commons.wikimedia.org/wiki/File:Radio_abdominale_chat_-_LL_D_-_normale.jpg",
    attribution: "Anja (2025). Radio abdominale, latéro-latérale droite, chat normal. Wikimedia Commons. CC BY-SA 4.0.",
    credibility: "community",
  },
  // ────────────────────────────────────────────────────────────────
  // CUVET teaching cases — Batch 01 (5 entries · added 2026-05-26)
  //
  // Source: CUVET Small Animal Hospital · Fujifilm Synapse 5 PACS export.
  // Approval: Aj. Ekkapol Akkraputtiporn (DI Unit) — verbal sign-off.
  // PII scrub: full-width top + bottom band mask (see scrub_synapse.py).
  // Pre-deploy QA: 4-pass recheck (mean+max black assertion on mask
  //   bands + parent visual re-Read of each file at /public/atlas/).
  // ────────────────────────────────────────────────────────────────
  {
    id: "atlas-cuvet-001",
    slug: "cuvet-canine-pelvis-vd-001",
    modality: "DX",
    species: "canine",
    body_part: "pelvis",
    view: "VD",
    description:
      "Canine extended-leg ventrodorsal pelvis from the CUVET teaching set. Symmetric femoral-head placement in acetabula — Norberg-angle baseline view. Right-side anatomy marker (R) visible.",
    learning_landmarks: [
      "Femoral head + neck",
      "Acetabular rim (cranial + caudal)",
      "Obturator foramen",
      "Sacroiliac joints",
      "R anatomy marker (mid-left)",
    ],
    image_path: "/atlas/cuvet-canine-pelvis-vd-001.png",
    license: "Educational use, CUVET-internal",
    attribution: ATTR_CUVET_INTERNAL,
    credibility: "cuvet-internal",
  },
  {
    id: "atlas-cuvet-002",
    slug: "cuvet-feline-skull-dv-001",
    modality: "DX",
    species: "feline",
    body_part: "skull",
    view: "DV",
    description:
      "Feline dorsoventral skull from the CUVET teaching set. Symmetric tympanic bullae, dental arcades and zygomatic arches in plain view. Lead L-marker visible top-left.",
    learning_landmarks: [
      "Tympanic bullae (paired, symmetric)",
      "Zygomatic arches",
      "Maxillary + mandibular dental arcades",
      "Nasal cavity midline",
      "Cranial vault outline",
      "Lead L marker (CUVET institutional, top-left)",
    ],
    image_path: "/atlas/cuvet-feline-skull-dv-001.png",
    license: "Educational use, CUVET-internal",
    attribution: ATTR_CUVET_INTERNAL,
    credibility: "cuvet-internal",
  },
  {
    id: "atlas-cuvet-003",
    slug: "cuvet-feline-skull-lat-001",
    modality: "DX",
    species: "feline",
    body_part: "skull",
    view: "lateral",
    description:
      "Feline lateral skull from the CUVET teaching set. Brachycephalic conformation — shortened muzzle, prominent globe outlines. Useful contrast against the dolichocephalic canine lateral for breed-shape comparison.",
    learning_landmarks: [
      "Calvarium / cranial vault",
      "Frontal sinus (small in brachycephalic cats)",
      "Maxilla + mandible (shortened)",
      "Dental arcades (compressed)",
      "Tympanic bullae (superimposed)",
    ],
    image_path: "/atlas/cuvet-feline-skull-lat-001.png",
    license: "Educational use, CUVET-internal",
    attribution: ATTR_CUVET_INTERNAL,
    credibility: "cuvet-internal",
  },
  {
    id: "atlas-cuvet-004",
    slug: "cuvet-canine-skull-lat-001",
    modality: "DX",
    species: "canine",
    body_part: "skull",
    view: "lateral",
    description:
      "Canine lateral skull from the CUVET teaching set. Mesocephalic conformation — elongated muzzle, complete adult dental arcades visible.",
    learning_landmarks: [
      "Calvarium / cranial vault",
      "Frontal sinus",
      "Maxilla + mandible (elongated)",
      "Complete adult dentition",
      "Tympanic bullae",
    ],
    image_path: "/atlas/cuvet-canine-skull-lat-001.png",
    license: "Educational use, CUVET-internal",
    attribution: ATTR_CUVET_INTERNAL,
    credibility: "cuvet-internal",
  },
  {
    id: "atlas-cuvet-005",
    slug: "cuvet-canine-thorax-lat-001",
    modality: "DX",
    species: "canine",
    body_part: "thorax",
    view: "lateral",
    description:
      "Canine lateral thorax from the CUVET teaching set. Cardiac silhouette, tracheal column, and diaphragmatic line in profile — VHS-compatible view for vertebral heart score practice (canine reference range 8.5–10.5).",
    learning_landmarks: [
      "Cardiac silhouette",
      "Tracheal column",
      "Carina",
      "Diaphragmatic line",
      "Caudal vena cava",
      "Vertebral bodies (T4 onwards)",
    ],
    image_path: "/atlas/cuvet-canine-thorax-lat-001.png",
    license: "Educational use, CUVET-internal",
    attribution: ATTR_CUVET_INTERNAL,
    credibility: "cuvet-internal",
  },

  // ────────────────────────────────────────────────────────────────
  // CUVET teaching cases — Batch 02 (4 entries · added 2026-05-26)
  //
  // Closes coverage gaps disclosed in the previous atlas footnote:
  // canine abdomen (lateral + VD) · spine VD · pelvis-stifle VD.
  // Same 4-pass QA pipeline as batch 01 (mask black assertion +
  // parent visual recheck at /public/atlas/ + post-deploy curl).
  // Remaining gaps after this batch: cervical spine (C1-C7), elbow.
  // ────────────────────────────────────────────────────────────────
  {
    id: "atlas-cuvet-006",
    slug: "cuvet-canine-abdomen-lat-001",
    modality: "DX",
    species: "canine",
    body_part: "abdomen",
    view: "lateral",
    description:
      "Canine lateral abdomen from the CUVET teaching set. Vertebral column dorsally, gas-filled bowel loops + serosal silhouettes ventrally, pelvic inlet caudally. The reference layout for evaluating gas pattern, organ silhouette, and serosal detail.",
    learning_landmarks: [
      "Vertebral column (T13–L7)",
      "Diaphragm (cranial border)",
      "Liver silhouette (caudal to diaphragm)",
      "Gastric gas",
      "Small intestinal loops",
      "Colon",
      "Urinary bladder",
      "Pelvic inlet (caudal limit)",
    ],
    image_path: "/atlas/cuvet-canine-abdomen-lat-001.png",
    license: "Educational use, CUVET-internal",
    attribution: ATTR_CUVET_INTERNAL,
    credibility: "cuvet-internal",
  },
  {
    id: "atlas-cuvet-007",
    slug: "cuvet-canine-abdomen-vd-001",
    modality: "DX",
    species: "canine",
    body_part: "abdomen",
    view: "VD",
    description:
      "Canine ventrodorsal abdomen from the CUVET teaching set. Vertebrae down the midline, symmetric kidneys flanking, intestinal gas patterns, and sacroiliac + femoral heads at the pelvic inlet. Pair with the lateral view for two-plane abdominal evaluation.",
    learning_landmarks: [
      "Lumbar vertebrae (midline)",
      "Renal silhouettes (paired, retroperitoneal)",
      "Intestinal gas pattern",
      "Sacroiliac joints",
      "Femoral heads / pelvic inlet",
      "L anatomy marker",
    ],
    image_path: "/atlas/cuvet-canine-abdomen-vd-001.png",
    license: "Educational use, CUVET-internal",
    attribution: ATTR_CUVET_INTERNAL,
    credibility: "cuvet-internal",
  },
  {
    id: "atlas-cuvet-008",
    slug: "cuvet-canine-spine-tl-vd-001",
    modality: "DX",
    species: "canine",
    body_part: "spine",
    view: "VD",
    description:
      "Canine thoraco-lumbar spine VD from the CUVET teaching set. Full thoracic + lumbar vertebral column with ribs symmetric on both sides — useful for screening alignment, intervertebral disc space uniformity, and vertebral body shape.",
    learning_landmarks: [
      "Thoracic vertebrae (T-row, ribs attached)",
      "Lumbar vertebrae (cranial portion visible)",
      "Ribs (paired, symmetric)",
      "Intervertebral disc spaces",
      "Spinous processes (midline column of densities)",
      "L CUVET anatomy marker (top-right)",
    ],
    image_path: "/atlas/cuvet-canine-spine-tl-vd-001.png",
    license: "Educational use, CUVET-internal",
    attribution: ATTR_CUVET_INTERNAL,
    credibility: "cuvet-internal",
  },
  {
    id: "atlas-cuvet-009",
    slug: "cuvet-canine-pelvis-stifle-vd-001",
    modality: "DX",
    species: "canine",
    body_part: "limb-hind",
    view: "VD",
    description:
      "Canine ventrodorsal pelvis + bilateral stifles from the CUVET teaching set. Extends a standard Norberg-positioning VD caudally to capture both femorotibial joints — femoral condyles, tibial plateaus, and fabellae visible on both sides. Useful for stifle symmetry screening and as a one-image hindlimb reference.",
    learning_landmarks: [
      "Femoral heads + acetabula (paired)",
      "Femoral diaphysis (paired)",
      "Femoral condyles (medial + lateral · paired)",
      "Tibial plateau (paired)",
      "Fabellae (medial + lateral sesamoids)",
      "Stifle joint space (paired)",
    ],
    image_path: "/atlas/cuvet-canine-pelvis-stifle-vd-001.png",
    license: "Educational use, CUVET-internal",
    attribution: ATTR_CUVET_INTERNAL,
    credibility: "cuvet-internal",
  },

  // ────────────────────────────────────────────────────────────────
  // CUVET teaching cases — Batch 03 (3 entries · added 2026-05-26)
  //
  // Closes the elbow gap that the previous footnote disclosed.
  // Adds a forelimb (radius/ulna/carpus) view and a CUVET thorax VD
  // to pair with the existing CUVET thorax lateral.
  //
  // Iron Rule 0 catch during Pass-3 visual recheck: cell-0083 was
  // initially classified as "stifle lateral" based on bucket sampling,
  // but the visible body-wall attachment on the right + ~110°
  // flexion angle + prominent olecranon process behind the joint
  // confirmed it's an ELBOW lateral. Reclassified before atlas entry
  // was written. This catch is why Pass-3 visual review is non-
  // optional — pixel-band assertion alone would never have caught it.
  // ────────────────────────────────────────────────────────────────
  {
    id: "atlas-cuvet-010",
    slug: "cuvet-canine-forelimb-lat-001",
    modality: "DX",
    species: "canine",
    body_part: "limb-fore",
    view: "lateral",
    description:
      "Canine lateral antebrachium (radius + ulna) and carpus from the CUVET teaching set. Full forearm shaft visible with the carpal joints at the distal end. Reference for forelimb-shaft alignment and carpal-row anatomy.",
    learning_landmarks: [
      "Radius (cranial bone, slimmer)",
      "Ulna (caudal bone, with olecranon proximally)",
      "Antebrachiocarpal joint (distal radius)",
      "Carpal bones (proximal + distal rows)",
      "Metacarpal bases",
      "R anatomy marker (top-left)",
    ],
    image_path: "/atlas/cuvet-canine-forelimb-lat-001.png",
    license: "Educational use, CUVET-internal",
    attribution: ATTR_CUVET_INTERNAL,
    credibility: "cuvet-internal",
  },
  {
    id: "atlas-cuvet-011",
    slug: "cuvet-canine-elbow-lat-001",
    modality: "DX",
    species: "canine",
    body_part: "limb-fore",
    view: "lateral",
    description:
      "Canine lateral elbow (humero-radio-ulnar joint) from the CUVET teaching set. Joint flexed at ~110° in this projection, with the humeral condyle proximally, anconeal process projecting behind the joint, and radius + ulna distally. Body-wall shadow visible caudoventrally (right side of image).",
    learning_landmarks: [
      "Humeral condyle (proximal articular surface)",
      "Anconeal process (ulna, behind joint)",
      "Olecranon (proximal ulna)",
      "Radial head (cranial articulation)",
      "Radius + ulna distal to joint",
      "Body-wall silhouette (caudo-distal)",
    ],
    image_path: "/atlas/cuvet-canine-elbow-lat-001.png",
    license: "Educational use, CUVET-internal",
    attribution: ATTR_CUVET_INTERNAL,
    credibility: "cuvet-internal",
  },
  {
    id: "atlas-cuvet-012",
    slug: "cuvet-canine-thorax-vd-001",
    modality: "DX",
    species: "canine",
    body_part: "thorax",
    view: "VD",
    description:
      "Canine ventrodorsal thorax from the CUVET teaching set. Symmetric ribs left + right of midline, cardiac silhouette centred, spine running down midline. Pair with cuvet-canine-thorax-lat-001 for two-plane thoracic evaluation.",
    learning_landmarks: [
      "Cardiac silhouette (centred over spine)",
      "Left + right lung fields",
      "Ribs (paired, symmetric)",
      "Sternum (overlies spine on VD)",
      "Diaphragmatic dome",
      "L anatomy marker (top-right)",
    ],
    image_path: "/atlas/cuvet-canine-thorax-vd-001.png",
    license: "Educational use, CUVET-internal",
    attribution: ATTR_CUVET_INTERNAL,
    credibility: "cuvet-internal",
  },
];

// Helper — lookup by slug. Used by /atlas/[slug] detail route.
export function getAtlasEntry(slug: string): AtlasEntry | undefined {
  return ATLAS_ENTRIES.find((e) => e.slug === slug);
}

// Helper — entries related by body_part. Used by detail page to suggest
// peers in the same anatomical region.
export function getRelatedAtlasEntries(slug: string, limit = 4): AtlasEntry[] {
  const me = getAtlasEntry(slug);
  if (!me) return [];
  return ATLAS_ENTRIES.filter((e) => e.slug !== slug && e.body_part === me.body_part).slice(0, limit);
}
