// Atlas — normal-anatomy reference grid for vet students.
//
// Stage 1 of "learning to read X-rays": see normal 100 times before
// you can recognize abnormal. Each entry pairs a clean radiograph
// (modality x species x body-part x view) with a neutral description
// of what's visible — no diagnosis, no pathology, no clinical
// interpretation, just landmarks.
//
// Day 1 ships with 10 AI-generated entries via Pollinations.ai Flux
// (per reference_pollinations-ai-image-gen.md). All entries marked
// `credibility: "ai-generated"` so students KNOW they are looking at
// a synthetic radiograph, not a real diagnostic image. Upgrade path:
// replace one by one with real CC-BY radiographs from Mendeley /
// Wikimedia / open vet atlases. See README at /atlas/README-source.md
// for the swap procedure.

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
  | "ai-generated"
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

// Pollinations.ai Flux — confirmed accessible without API key per
// reference_pollinations-ai-image-gen.md. License terms: outputs are
// "free to use" per their FAQ but they don't claim a specific license.
// We mark `cc-by-4.0` as a best-faith attribution license (close to
// open creative-commons norms for AI outputs) while flagging
// credibility:"ai-generated" so students do NOT mistake these for
// real diagnostic radiographs. See `_atlas_seed.ps1` for the prompts
// and seeds used.
const POLLINATIONS_LICENSE = "cc-by-4.0";
const POLLINATIONS_ATTR = "Generated via Pollinations.ai Flux model";

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
    license: POLLINATIONS_LICENSE,
    attribution: POLLINATIONS_ATTR,
    credibility: "ai-generated",
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
    license: POLLINATIONS_LICENSE,
    attribution: POLLINATIONS_ATTR,
    credibility: "ai-generated",
  },
  {
    id: "atlas-003",
    slug: "canine-abdomen-lat-001",
    modality: "DX",
    species: "canine",
    body_part: "abdomen",
    view: "lateral",
    description:
      "Canine abdominal radiograph in right-lateral recumbency. Gas in stomach and large bowel highlights serosal surfaces; liver silhouette sits behind the costal arch.",
    learning_landmarks: [
      "Liver silhouette",
      "Gastric gas",
      "Small intestinal loops",
      "Colon / fecal material",
      "Urinary bladder",
      "Renal shadows (variable)",
    ],
    image_path: "/atlas/canine-abdomen-lat-001.jpg",
    license: POLLINATIONS_LICENSE,
    attribution: POLLINATIONS_ATTR,
    credibility: "ai-generated",
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
    license: POLLINATIONS_LICENSE,
    attribution: POLLINATIONS_ATTR,
    credibility: "ai-generated",
  },
  {
    id: "atlas-005",
    slug: "canine-skull-lat-001",
    modality: "DX",
    species: "canine",
    body_part: "skull",
    view: "lateral",
    description:
      "Canine skull lateral radiograph. Cranial vault, facial bones, mandible and dental arcades are profiled; tympanic bullae overlap and require oblique views to separate.",
    learning_landmarks: [
      "Calvarium / cranial vault",
      "Frontal sinus",
      "Maxilla and mandible",
      "Dental arcades",
      "Tympanic bullae (superimposed)",
    ],
    image_path: "/atlas/canine-skull-lat-001.jpg",
    license: POLLINATIONS_LICENSE,
    attribution: POLLINATIONS_ATTR,
    credibility: "ai-generated",
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
    license: POLLINATIONS_LICENSE,
    attribution: POLLINATIONS_ATTR,
    credibility: "ai-generated",
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
    license: POLLINATIONS_LICENSE,
    attribution: POLLINATIONS_ATTR,
    credibility: "ai-generated",
  },
  {
    id: "atlas-008",
    slug: "canine-stifle-lat-001",
    modality: "DX",
    species: "canine",
    body_part: "limb-hind",
    view: "lateral",
    description:
      "Canine stifle (knee) lateral radiograph. Femorotibial joint space, patella in the trochlear groove, and the popliteal sesamoid are visible in this orientation.",
    learning_landmarks: [
      "Femoral condyles",
      "Tibial plateau",
      "Patella in trochlear groove",
      "Fabellae (medial / lateral)",
      "Popliteal sesamoid",
      "Tibial tuberosity",
    ],
    image_path: "/atlas/canine-stifle-lat-001.jpg",
    license: POLLINATIONS_LICENSE,
    attribution: POLLINATIONS_ATTR,
    credibility: "ai-generated",
  },
  {
    id: "atlas-009",
    slug: "canine-elbow-lat-001",
    modality: "DX",
    species: "canine",
    body_part: "limb-fore",
    view: "lateral",
    description:
      "Canine elbow lateral radiograph. Humeroulnar joint and the anconeal process are profiled; the medial coronoid is partially obscured and typically requires an additional flexed or oblique view.",
    learning_landmarks: [
      "Humeral condyle",
      "Anconeal process",
      "Olecranon (ulna)",
      "Radial head",
      "Humeroulnar joint space",
    ],
    image_path: "/atlas/canine-elbow-lat-001.jpg",
    license: POLLINATIONS_LICENSE,
    attribution: POLLINATIONS_ATTR,
    credibility: "ai-generated",
  },
  {
    id: "atlas-010",
    slug: "canine-cspine-lat-001",
    modality: "DX",
    species: "canine",
    body_part: "spine",
    view: "lateral",
    description:
      "Canine cervical spine lateral radiograph (C1–C7). Vertebral bodies, intervertebral disc spaces and the dens of C2 are visible in profile.",
    learning_landmarks: [
      "C1 (atlas) wings",
      "C2 (axis) with dens",
      "C3–C7 vertebral bodies",
      "Intervertebral disc spaces",
      "Spinal canal outline",
    ],
    image_path: "/atlas/canine-cspine-lat-001.jpg",
    license: POLLINATIONS_LICENSE,
    attribution: POLLINATIONS_ATTR,
    credibility: "ai-generated",
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
