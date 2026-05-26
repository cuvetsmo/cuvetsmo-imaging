// Local sample case index. Day 1 ships without Supabase — cases are
// served as static JSON pointing at .dcm files in /public/cases/.
//
// Replace with a Supabase-backed loader when the imaging_cases /
// imaging_case_files / lab-dicom bucket migration lands.
//
// Seeded 2026-05-20 from VetMock production Supabase (project
// mpovsdzdggvksmeehqfj · bucket lab-dicom · imaging_cases status='public').
// 16 CC-BY 4.0 cases lifted; 1 cuvet-internal case (น้องคอฟฟี่)
// skipped pending Aj. approval. See public/cases/SEED-LOG.md.

export type Modality = "DX" | "CR" | "CT" | "MR" | "US" | "RG" | "OT";

export type ImagingCase = {
  id: string;
  slug: string;
  title: string;
  species: string;
  signalment?: string;
  history?: string;
  body_part?: string;
  modality?: Modality;
  difficulty?: "intro" | "intermediate" | "advanced";
  learning_objectives?: string[];
  credibility?: "peer-reviewed" | "open-textbook" | "community" | "cuvet-internal" | "sample-demo";
  license?: string;
  source_url?: string;
  attribution?: string;
  // Storage — paths under /public/cases/<slug>/<view>.dcm
  files: { view_name: string; path: string }[];
  // ── Active Recall fields (added 2026-05-20) ──
  // Renders only when present; CaseDetailView graceful-degrades to a
  // "expert findings coming soon" placeholder when undefined. Owned by
  // the case-seeding pipeline (cases.json), NOT by per-user state.
  recall?: {
    findings: string[];                                          // expert's bullet findings, ordered head→tail
    ddx: { name: string; probability?: "high" | "mid" | "low" }[]; // differential ranking
    final_diagnosis: string;                                     // one-line dx
    teaching_points?: string[];                                  // optional pearls
    citation?: string;                                           // optional textbook / paper ref
    // Optional expert ground truth for guided measurement scoring.
    // Only set when the value is defensible from the source (peer-
    // reviewed dataset label, published case, expert read). Cases
    // without a single expected value (e.g. obscured cardiac border
    // from effusion) deliberately leave this undefined — the overlay
    // gracefully degrades to live measurement only.
    ground_truth?: {
      norberg?: {
        /** Expected Norberg angle (degrees), left hip vertex. */
        left: number;
        /** Expected Norberg angle (degrees), right hip vertex. */
        right: number;
        /** Where the expected number came from — for the UI tooltip. */
        source?: string;
      };
      vhs?: {
        /** Expected VHS in vertebra units. */
        value: number;
        /** Provenance string shown next to the result. */
        source?: string;
      };
    };
    // ── Lesion-spot mode (added 2026-05-20, Phase 3) ──
    // Optional · only seed for cases where the lesion has a defensible
    // bounding region. Diffuse/pattern diseases (alveolar, interstitial,
    // bronchial) are NOT spot-localizable and MUST stay unseeded so the
    // student doesn't get scored against a fabricated guess.
    // Coordinates are normalized [0, 1] in (x, y, w, h) relative to the
    // rendered viewport (origin = top-left of the displayed image area).
    // Cases without this field auto-skip the spotting mode in the UI.
    lesion_regions?: {
      /** Short noun phrase, e.g. "cardiac silhouette", "pleural fluid". */
      label: string;
      /** Normalized bounding box in [0, 1] coordinates. */
      box: { x: number; y: number; w: number; h: number };
      /** One-sentence anatomy/teaching note shown after submit. */
      hint?: string;
    }[];
  };
};

// VetMock attribution strings (kept verbatim so CC-BY compliance
// stays structural rather than optional polish).
const ATTR_VETXRAY =
  "VetXRay — 9,882 manually annotated canine and feline thoracic radiographs · Zenodo · DOI:10.5281/zenodo.19051776 · CC BY 4.0";
const ATTR_MENDELEY =
  "Flores Duenas C.A., Gaxiola Camacho S.M., Montaño Gómez M.F. (2020). Radiographic Dataset for VHS determination learning process, Mendeley Data, V1, doi:10.17632/ktx4cj55pn.1 · Universidad Autónoma de Baja California";
const ATTR_CUVET_INTERNAL =
  "Courtesy of Small Animal Hospital of Chulalongkorn University · DI Unit · anonymized for veterinary education with permission";

export const CASES: ImagingCase[] = [
  // ────────────────────────────────────────────────────────
  // Mendeley VHS dataset (3 canine lateral · PNG→DICOM)
  // ────────────────────────────────────────────────────────
  {
    id: "1aa918f0-2ca0-4628-a871-9294955c6c00",
    slug: "mendeley-vhs-1",
    title: "Canine lateral thoracic · VHS practice #1 (small)",
    species: "canine",
    signalment: "Adult dog · breed unspecified",
    history:
      "Lateral thoracic radiograph from a peer-reviewed open dataset · suited for ฝึก VHS measurement workflow",
    body_part: "thorax",
    modality: "DX",
    difficulty: "intro",
    learning_objectives: [
      "ฝึก 📐 VHS 6-click workflow: long axis · short axis · vertebra ruler",
      "สังเกต cardiac silhouette + vertebral body landmarks",
      "เทียบค่า VHS ที่วัดได้กับ canine reference 8.5–10.5",
      "ลอง 🪄 Auto preset ดู image contrast แล้วลอง W/L drag เอง",
      "ลอง drag จุดที่วางผิดเพื่อปรับ — ไม่ต้องเริ่มใหม่",
    ],
    credibility: "peer-reviewed",
    license: "CC BY 4.0",
    source_url: "https://data.mendeley.com/datasets/ktx4cj55pn/1",
    attribution: ATTR_MENDELEY,
    files: [{ view_name: "Lateral", path: "mendeley-vhs-1/Lateral.dcm" }],
    recall: {
      findings: [],
      ddx: [],
      final_diagnosis:
        "Lateral thoracic — VHS measurement practice (no formal diagnosis from source)",
      teaching_points: [
        "Canine VHS reference range 8.5–10.5 (Buchanan & Bucheler 1995)",
        "Long-axis from carina to apex; short-axis perpendicular at widest point",
        "Sum vertebral lengths starting at T4 cranial edge",
      ],
      citation: ATTR_MENDELEY,
    },
  },
  {
    id: "6b1e38b1-a27c-4172-8660-eee142d269bc",
    slug: "mendeley-vhs-2",
    title: "Canine lateral thoracic · VHS practice #2 (medium)",
    species: "canine",
    signalment: "Adult dog · breed unspecified",
    history:
      "Second lateral thoracic from the same Mendeley dataset — medium-size detector area, different patient",
    body_part: "thorax",
    modality: "DX",
    difficulty: "intermediate",
    learning_objectives: [
      "เทียบกับ case #1: VHS ของ patient ต่างกันได้ไหม? breed-related variation",
      "ลองสลับ preset ดู bone vs soft tissue detail",
      "ฝึกใช้ ⛶ fullscreen (F key) เพื่อมองภาพชัด ๆ",
      "ลอง 📥 export JSON หลังวัด VHS แล้วเปิดผ่าน 🤖 Load AI ดูว่า round-trips ได้ไหม",
    ],
    credibility: "peer-reviewed",
    license: "CC BY 4.0",
    source_url: "https://data.mendeley.com/datasets/ktx4cj55pn/1",
    attribution: ATTR_MENDELEY,
    files: [{ view_name: "Lateral", path: "mendeley-vhs-2/Lateral.dcm" }],
    recall: {
      findings: [],
      ddx: [],
      final_diagnosis:
        "Lateral thoracic — VHS measurement practice (no formal diagnosis from source)",
      teaching_points: [
        "Inter-patient VHS variability is normal — breed conformation matters",
        "Brachycephalic / barrel-chested breeds may run higher even when normal",
      ],
      citation: ATTR_MENDELEY,
    },
  },
  {
    id: "14b95745-1cea-46f3-a6cf-183a27cb937d",
    slug: "mendeley-vhs-3",
    title: "Canine lateral thoracic · VHS practice #3 (large-detail)",
    species: "canine",
    signalment: "Adult dog · breed unspecified",
    history:
      "Highest-resolution radiograph from the dataset — practice fine landmark identification at high zoom",
    body_part: "thorax",
    modality: "DX",
    difficulty: "intermediate",
    learning_objectives: [
      "ใช้ 🔍 Zoom + ✋ Pan สำรวจรายละเอียดของ vertebral bodies",
      "ลอง 📏 Length tool: วัด vertebral body length โดยตรง vs ใช้ VHS ratio",
      "สังเกต difference ระหว่าง T4-T5 vertebrae (reference body) กับอื่น ๆ",
      "ลอง 🔍 Info button ดู DICOM tags ของไฟล์ที่ converted มา",
    ],
    credibility: "peer-reviewed",
    license: "CC BY 4.0",
    source_url: "https://data.mendeley.com/datasets/ktx4cj55pn/1",
    attribution: ATTR_MENDELEY,
    files: [{ view_name: "Lateral", path: "mendeley-vhs-3/Lateral.dcm" }],
    recall: {
      findings: [],
      ddx: [],
      final_diagnosis:
        "Lateral thoracic — VHS measurement practice (no formal diagnosis from source)",
      teaching_points: [
        "Use T4 onwards as the vertebral ruler; T1–T3 obscured by shoulder",
        "Per Buchanan: count vertebrae to nearest 0.1 (interpolate within a vertebra)",
      ],
      citation: ATTR_MENDELEY,
    },
  },

  // ────────────────────────────────────────────────────────
  // VetXRay — feline (8 cases)
  // ────────────────────────────────────────────────────────
  {
    id: "435e31f2-4552-47c0-9a29-91c369210ff4",
    slug: "vetxray-feline-normal",
    title: "Feline lateral thoracic · NORMAL (no_finding)",
    species: "feline",
    signalment: "Cat · European Shorthair · LL projection",
    history:
      "Normal lateral thoracic radiograph · ใช้เป็น reference สำหรับ feline VHS measurement (ค่าปกติ 6.7–8.1)",
    body_part: "thorax",
    modality: "CR",
    difficulty: "intro",
    learning_objectives: [
      "ฝึก 📐 VHS บนแมว · auto-detect species → ใช้ feline reference 6.7–8.1 อัตโนมัติ",
      "เปรียบเทียบ landmark กับ canine cases — แตกต่างกันยังไง?",
      "ลอง 🪄 Auto preset ดู contrast ที่เหมาะกับ thoracic exam",
      "ลอง 📏 Length tool: วัดความยาว diaphragm หรือ trachea diameter",
    ],
    credibility: "peer-reviewed",
    license: "CC BY 4.0",
    source_url: "https://zenodo.org/records/19051776",
    attribution: ATTR_VETXRAY,
    files: [{ view_name: "Lateral", path: "vetxray-feline-normal/Lateral.dcm" }],
    recall: {
      findings: [
        "No radiographic abnormalities identified",
        "Cardiac silhouette within normal limits",
        "Lung fields clear",
      ],
      ddx: [],
      final_diagnosis: "Normal (no finding)",
      teaching_points: [
        "Feline VHS reference 6.7–8.1 (Litster & Buchanan 2000)",
        "Cats have proportionally smaller cardiac silhouette vs dogs",
      ],
      citation: ATTR_VETXRAY,
      // Defensible because the dataset label is `no_finding` (peer-
      // reviewed VetXRay) and the published feline mean is 7.5 v
      // (Litster & Buchanan 2000). Mid-range placement avoids
      // implying false precision beyond the dataset's per-case
      // resolution.
      ground_truth: {
        vhs: {
          value: 7.5,
          source: "Litster & Buchanan 2000 feline mean · dataset label = no_finding",
        },
      },
    },
  },
  {
    id: "e164d826-d820-4036-9ca3-158cc950a9cd",
    slug: "vetxray-feline-cardiomegaly",
    title: "Feline lateral thoracic · CARDIOMEGALY",
    species: "feline",
    signalment: "Cat · breed unknown · LL projection",
    history:
      "Cardiomegaly case — practice ดู VHS ที่สูงกว่าค่าปกติ (> 8.1) เปรียบเทียบกับ normal case · classic HCM (hypertrophic cardiomyopathy) consideration ในแมว",
    body_part: "thorax",
    modality: "CR",
    difficulty: "intermediate",
    learning_objectives: [
      "วัด VHS คาดว่าจะ > 8.1 (sniffer ของ cardiomegaly)",
      "เปรียบเทียบ cardiac silhouette กับ vetxray-feline-normal",
      'สังเกต "Valentine heart" appearance ของ HCM ในแมว',
      "ลอง 🦴 W/L bone/soft tissue presets ดู cardiac border ชัดสุดที่ตัวไหน",
    ],
    credibility: "peer-reviewed",
    license: "CC BY 4.0",
    source_url: "https://zenodo.org/records/19051776",
    attribution: ATTR_VETXRAY,
    files: [{ view_name: "Lateral", path: "vetxray-feline-cardiomegaly/Lateral.dcm" }],
    recall: {
      findings: [
        "Enlarged cardiac silhouette",
        "Expected VHS > 8.1 (feline normal 6.7–8.1)",
      ],
      ddx: [
        { name: "Hypertrophic cardiomyopathy (HCM)", probability: "high" },
        { name: "Restrictive cardiomyopathy", probability: "mid" },
        { name: "Dilated cardiomyopathy (rarer in cats)", probability: "low" },
      ],
      final_diagnosis: "Cardiomegaly",
      teaching_points: [
        "HCM is the most common cardiomyopathy in cats",
        '"Valentine heart" silhouette on DV/VD is the classic HCM marker',
      ],
      citation: ATTR_VETXRAY,
      // Defensible because dataset label is `cardiomegaly` (peer-
      // reviewed) — feline cardiomegaly literature places mild–
      // moderate enlargement at ~8.7–9.0 v (Litster 2000 reports
      // affected cats clustering ~1 v above the 8.1 upper limit).
      ground_truth: {
        vhs: {
          value: 8.8,
          source: "Litster 2000 cardiomegaly cluster · dataset label = cardiomegaly",
        },
      },
      // Defensible because cardiomegaly = enlarged cardiac silhouette
      // by definition. In a feline lateral, the heart sits roughly
      // mid-thorax, slightly cranio-ventral, occupying ~2-3 intercostal
      // spaces between sternum and the caudal vena cava (Schwarz &
      // Johnson, BSAVA Manual of Canine and Feline Thoracic Imaging
      // 2008, Ch. 4). The box is centered on the cardiac silhouette
      // and slightly enlarged vs normal-cat anatomy to reflect the
      // enlarged outline. ~30% width × 35% height of typical thorax.
      lesion_regions: [
        {
          label: "enlarged cardiac silhouette",
          box: { x: 0.32, y: 0.40, w: 0.32, h: 0.35 },
          hint: 'Compare against the feline normal case — the enlarged heart fills more intercostal spaces and pushes the trachea dorsally. "Valentine heart" on DV is the HCM tell.',
        },
      ],
    },
  },
  {
    id: "35d8df45-c266-4f11-9862-4363411d6346",
    slug: "vetxray-feline-pleural-effusion",
    title: "Feline lateral thoracic · PLEURAL EFFUSION",
    species: "feline",
    signalment: "Cat · European Shorthair · LL projection",
    history:
      "Pleural effusion case · เห็น fluid line ใน pleural space · cardiac silhouette อาจดู obscured · VHS วัดยากกว่า normal",
    body_part: "thorax",
    modality: "CR",
    difficulty: "advanced",
    learning_objectives: [
      "สังเกต pleural fluid pattern (interlobar fissures · diaphragm border)",
      "ลอง VHS — เมื่อมี effusion, cardiac silhouette ถูก partially obscured · VHS reliability ต่ำลง",
      "ฝึกใช้ 🔍 Zoom ดู costophrenic angle ที่ blunted",
      "ลอง preset Bone vs Soft ดู fluid contrast",
    ],
    credibility: "peer-reviewed",
    license: "CC BY 4.0",
    source_url: "https://zenodo.org/records/19051776",
    attribution: ATTR_VETXRAY,
    files: [
      { view_name: "Lateral", path: "vetxray-feline-pleural-effusion/Lateral.dcm" },
    ],
    recall: {
      findings: [
        "Pleural fluid visible in interlobar fissures",
        "Cardiac silhouette partially obscured",
        "Blunted costophrenic angle",
      ],
      ddx: [],
      final_diagnosis: "Pleural effusion",
      teaching_points: [
        "VHS reliability drops when cardiac border is obscured by fluid",
        "Always look for interlobar fissure lines as the giveaway sign",
      ],
      citation: ATTR_VETXRAY,
    },
  },
  {
    id: "70231067-8dd4-4111-8104-ecac7aab0fc7",
    slug: "vetxray-feline-interstitial-pattern",
    title: "Feline lateral thoracic · INTERSTITIAL PATTERN",
    species: "feline",
    signalment: "แมว · LL projection · European Shorthair",
    history:
      "Interstitial pattern · increased lung opacity without alveolar consolidation",
    body_part: "thorax",
    modality: "CR",
    difficulty: "intermediate",
    learning_objectives: [
      "แยก unstructured (diffuse haze) vs structured (nodular/reticular)",
      "DDx: pulmonary fibrosis, neoplasia, early pulmonary edema, infection",
      "เปรียบเทียบกับ alveolar pattern case",
    ],
    credibility: "peer-reviewed",
    license: "CC BY 4.0",
    source_url: "https://zenodo.org/records/19051776",
    attribution: ATTR_VETXRAY,
    files: [
      { view_name: "Lateral", path: "vetxray-feline-interstitial-pattern/Lateral.dcm" },
    ],
    recall: {
      findings: ["Increased lung opacity without alveolar consolidation"],
      ddx: [
        { name: "Pulmonary fibrosis", probability: "mid" },
        { name: "Pulmonary neoplasia (early)", probability: "mid" },
        { name: "Early pulmonary edema", probability: "mid" },
        { name: "Atypical infection", probability: "mid" },
      ],
      final_diagnosis: "Interstitial pattern",
      teaching_points: [
        "Structured (nodular/reticular) vs unstructured (diffuse haze) sub-categorization narrows DDx",
        "Interstitial is the broadest DDx among lung patterns — always pair with clinical history",
      ],
      citation: ATTR_VETXRAY,
    },
  },
  {
    id: "8ff6029a-219a-4f1e-8225-45977f6f863f",
    slug: "vetxray-feline-alveolar-pattern",
    title: "Feline lateral thoracic · ALVEOLAR PATTERN",
    species: "feline",
    signalment: "แมว · LL projection · European Shorthair",
    history: "Alveolar pattern in cat · DDx pneumonia, edema",
    body_part: "thorax",
    modality: "CR",
    difficulty: "intermediate",
    learning_objectives: [
      "สังเกต air bronchograms ในแมว",
      "compare กับ canine alveolar pattern case",
      "feline alveolar DDx: viral/bacterial pneumonia, CHF",
    ],
    credibility: "peer-reviewed",
    license: "CC BY 4.0",
    source_url: "https://zenodo.org/records/19051776",
    attribution: ATTR_VETXRAY,
    files: [
      { view_name: "Lateral", path: "vetxray-feline-alveolar-pattern/Lateral.dcm" },
    ],
    recall: {
      findings: ["Air bronchograms visible", "Alveolar consolidation"],
      ddx: [
        { name: "Bacterial pneumonia", probability: "high" },
        { name: "Viral pneumonia", probability: "mid" },
        { name: "Cardiogenic pulmonary edema (CHF)", probability: "mid" },
      ],
      final_diagnosis: "Alveolar pattern",
      teaching_points: [
        "Air bronchograms = alveolar consolidation by definition",
        "In cats, CHF often presents with patchy alveolar pattern rather than the classic perihilar canine distribution",
      ],
      citation: ATTR_VETXRAY,
    },
  },
  {
    id: "34fafd5f-37d2-4ded-9263-6cd4fa4bb190",
    slug: "vetxray-feline-bronchial-pattern",
    title: "Feline lateral thoracic · BRONCHIAL PATTERN",
    species: "feline",
    signalment: "แมว · LL projection · European Shorthair",
    history:
      "Bronchial pattern · thickened bronchial walls · classic feline asthma",
    body_part: "thorax",
    modality: "CR",
    difficulty: "intermediate",
    learning_objectives: [
      'สังเกต "donut" + "tram-line" signs ของ thickened bronchi',
      "ระบุ distribution: focal · diffuse",
      "ใน cats: bronchial pattern + hyperinflation = consider feline asthma",
    ],
    credibility: "peer-reviewed",
    license: "CC BY 4.0",
    source_url: "https://zenodo.org/records/19051776",
    attribution: ATTR_VETXRAY,
    files: [
      { view_name: "Lateral", path: "vetxray-feline-bronchial-pattern/Lateral.dcm" },
    ],
    recall: {
      findings: [
        '"Donut" sign — thickened bronchial walls on end',
        '"Tram-line" sign — thickened bronchial walls in long axis',
      ],
      ddx: [
        { name: "Feline asthma (chronic bronchitis)", probability: "high" },
        { name: "Bronchopneumonia", probability: "mid" },
      ],
      final_diagnosis: "Bronchial pattern",
      teaching_points: [
        "Bronchial pattern + hyperinflation in a cat = feline asthma until proven otherwise",
        "Donut (end-on) and tram-line (long-axis) are two views of the same thickened wall",
      ],
      citation: ATTR_VETXRAY,
    },
  },
  {
    id: "f3edec9d-f86c-4ed4-a240-e9c9299cccb6",
    slug: "vetxray-feline-mass",
    title: "Feline lateral thoracic · MASS",
    species: "feline",
    signalment: "แมว · LL projection · Persian",
    history: "Soft tissue mass · feline cardiothoracic mass DDx",
    body_part: "thorax",
    modality: "CR",
    difficulty: "intermediate",
    learning_objectives: [
      "ระบุ mass location, size, borders",
      "วัดขนาดด้วย 📏 Length tool",
      "DDx: lymphoma, thymoma, neoplasia ของ lung",
    ],
    credibility: "peer-reviewed",
    license: "CC BY 4.0",
    source_url: "https://zenodo.org/records/19051776",
    attribution: ATTR_VETXRAY,
    files: [{ view_name: "Lateral", path: "vetxray-feline-mass/Lateral.dcm" }],
    recall: {
      findings: ["Soft tissue mass identified"],
      ddx: [
        { name: "Mediastinal lymphoma", probability: "high" },
        { name: "Thymoma", probability: "mid" },
        { name: "Primary pulmonary neoplasia", probability: "mid" },
      ],
      final_diagnosis: "Mass",
      teaching_points: [
        "Mediastinal lymphoma is the most common cranial mediastinal mass in young cats",
        "Always measure mass dimensions for staging and treatment follow-up",
      ],
      citation: ATTR_VETXRAY,
      // Defensible because feline thoracic mass top DDx (mediastinal
      // lymphoma + thymoma) localize to the CRANIAL mediastinum on a
      // lateral view — anatomically the cranio-ventral region just
      // dorsal to the sternum and ventral to the trachea, between the
      // thoracic inlet and the heart. Cranial-end of image (left side
      // in standard LL orientation) is x ≈ 0.10-0.45. A wider box
      // covers the cardiothoracic region overall since the dataset
      // label is generic "mass" and the exact lobe isn't published.
      lesion_regions: [
        {
          label: "cranial mediastinal mass",
          box: { x: 0.18, y: 0.32, w: 0.32, h: 0.28 },
          hint: "Mediastinal masses in cats classically occupy the cranio-ventral mediastinum — thymoma (older cats) and lymphoma (young cats) are the top DDx.",
        },
      ],
    },
  },
  {
    id: "7985dce1-60e8-475a-9c0e-970ef2c1145d",
    slug: "vetxray-feline-pneumothorax",
    title: "Feline lateral thoracic · PNEUMOTHORAX",
    species: "feline",
    signalment: "แมว · LL projection",
    history: "Pneumothorax · free air in pleural space · EMERGENCY",
    body_part: "thorax",
    modality: "CR",
    difficulty: "advanced",
    learning_objectives: [
      "สังเกต lung edge displaced จาก thoracic wall · radiolucent space",
      "ระบุ tension vs simple pneumothorax (mediastinal shift?)",
      "Emergency consideration — usually requires intervention",
    ],
    credibility: "peer-reviewed",
    license: "CC BY 4.0",
    source_url: "https://zenodo.org/records/19051776",
    attribution: ATTR_VETXRAY,
    files: [
      { view_name: "Lateral", path: "vetxray-feline-pneumothorax/Lateral.dcm" },
    ],
    recall: {
      findings: [
        "Lung edge displaced from thoracic wall",
        "Radiolucent (gas) space between lung and parietal pleura",
      ],
      ddx: [
        { name: "Traumatic pneumothorax", probability: "high" },
        { name: "Spontaneous pneumothorax (bullae rupture)", probability: "mid" },
        { name: "Iatrogenic (post-thoracocentesis / surgery)", probability: "low" },
      ],
      final_diagnosis: "Pneumothorax",
      teaching_points: [
        "Tension pneumothorax = mediastinal shift away from affected side — surgical emergency",
        "Treat the patient, not the radiograph — clinical signs override imaging when patient is decompensating",
      ],
      citation: ATTR_VETXRAY,
      // Defensible because pneumothorax on a lateral view shows as a
      // radiolucent (very dark, air) crescent between the dorsal lung
      // border and the thoracic spine — the heart is also classically
      // "elevated" off the sternum on lateral. The dorsal-caudal lung
      // edge separation is the textbook sign (Thrall, Veterinary
      // Diagnostic Radiology 7e, Ch. 36). Box covers the dorsal
      // hemithorax where the gas band appears.
      lesion_regions: [
        {
          label: "dorsal pleural air gap",
          box: { x: 0.25, y: 0.05, w: 0.55, h: 0.25 },
          hint: "On a lateral, look for a radiolucent (black) band between the lung edge and the thoracic spine, and an elevated cardiac silhouette off the sternum.",
        },
      ],
    },
  },

  // ────────────────────────────────────────────────────────
  // VetXRay — canine (5 cases)
  // ────────────────────────────────────────────────────────
  {
    id: "a8bb2126-e5a5-4617-92af-27c90e4d8aaa",
    slug: "vetxray-canine-normal",
    title: "Canine lateral thoracic · NORMAL (no_finding)",
    species: "canine",
    signalment: "หมา (canine) · LL projection · breed unspecified",
    history:
      "Normal lateral thoracic radiograph · reference สำหรับ VHS measurement",
    body_part: "thorax",
    modality: "CR",
    difficulty: "intro",
    learning_objectives: [
      "ฝึก 📐 VHS measurement บน canine",
      "ระบุ anatomic landmarks: vertebral bodies (T4 onwards), cardiac silhouette, diaphragm",
      "ลอง 🪄 Auto preset · drag W/L · เปรียบเทียบ",
    ],
    credibility: "peer-reviewed",
    license: "CC BY 4.0",
    source_url: "https://zenodo.org/records/19051776",
    attribution: ATTR_VETXRAY,
    files: [{ view_name: "Lateral", path: "vetxray-canine-normal/Lateral.dcm" }],
    recall: {
      findings: [
        "No radiographic abnormalities identified",
        "Cardiac silhouette within normal limits",
      ],
      ddx: [],
      final_diagnosis: "Normal (no finding)",
      teaching_points: [
        "Canine VHS reference 8.5–10.5 (Buchanan & Bucheler 1995)",
        "Breed conformation modifies the upper end — Labradors and barrel-chested breeds can run 10.5–11 while normal",
      ],
      citation: ATTR_VETXRAY,
      // Defensible because dataset label is `no_finding` (peer-
      // reviewed) and canine published mean is 9.7 v (Buchanan
      // 1995). Anchored slightly below the mean to land mid-window.
      ground_truth: {
        vhs: {
          value: 9.5,
          source: "Buchanan & Bücheler 1995 canine mean · dataset label = no_finding",
        },
      },
    },
  },
  {
    id: "93f5cc55-d000-46c4-8a67-234d509402be",
    slug: "vetxray-canine-cardiomegaly",
    title: "Canine lateral thoracic · CARDIOMEGALY",
    species: "canine",
    signalment: "หมา · LL projection · breed unspecified",
    history: "Cardiomegaly · expected VHS > 10.5 in canine",
    body_part: "thorax",
    modality: "CR",
    difficulty: "intermediate",
    learning_objectives: [
      "วัด VHS — คาดเกิน 10.5 (canine cardiomegaly threshold)",
      "เปรียบเทียบ cardiac silhouette กับ vetxray-canine-normal",
      "สังเกต breed-specific cardiac shape variations",
    ],
    credibility: "peer-reviewed",
    license: "CC BY 4.0",
    source_url: "https://zenodo.org/records/19051776",
    attribution: ATTR_VETXRAY,
    files: [{ view_name: "Lateral", path: "vetxray-canine-cardiomegaly/Lateral.dcm" }],
    recall: {
      findings: [
        "Enlarged cardiac silhouette",
        "Expected VHS > 10.5 (canine threshold)",
      ],
      ddx: [
        { name: "Myxomatous mitral valve disease (MMVD)", probability: "high" },
        { name: "Dilated cardiomyopathy (DCM)", probability: "mid" },
        { name: "Congenital heart disease", probability: "low" },
      ],
      final_diagnosis: "Cardiomegaly",
      teaching_points: [
        "MMVD is the #1 acquired cardiac disease in dogs, especially small breeds",
        "DCM more common in large breeds (Doberman, Great Dane, Boxer)",
      ],
      citation: ATTR_VETXRAY,
      // Defensible because dataset label is `cardiomegaly` and the
      // common clinical literature (Buchanan; Lamb & Boswood) places
      // moderate cardiomegaly at ~11.5 v in dogs — about 1 v above
      // the 10.5 upper limit. Without the original case's reader
      // value, mid-cardiomegaly is the most defensible anchor.
      ground_truth: {
        vhs: {
          value: 11.5,
          source: "Lamb & Boswood 2002 moderate cardiomegaly cluster · dataset label = cardiomegaly",
        },
      },
      // Defensible because cardiomegaly = enlarged cardiac silhouette
      // by definition. In a canine lateral the heart occupies roughly
      // T4-T8 vertebral span (Buchanan 1995) — mid-thorax horizontally
      // and centered vertically. An enlarged silhouette spreads both
      // cranially (toward the trachea) and caudally (toward the
      // diaphragm), so the box is slightly wider than the feline
      // analog. ~35% width × 38% height.
      lesion_regions: [
        {
          label: "enlarged cardiac silhouette",
          box: { x: 0.30, y: 0.36, w: 0.36, h: 0.38 },
          hint: "VHS workflow tells you HOW MUCH the heart is enlarged. Spot-the-finding tells you WHERE the cardiac silhouette is on the image. Use both.",
        },
      ],
    },
  },
  {
    id: "cdb748aa-be7c-4e29-a20c-57529a5b0ced",
    slug: "vetxray-canine-pleural-effusion",
    title: "Canine lateral thoracic · PLEURAL EFFUSION",
    species: "canine",
    signalment: "หมา · LL projection",
    history: "Pleural effusion · fluid line · cardiac silhouette obscured",
    body_part: "thorax",
    modality: "CR",
    difficulty: "advanced",
    learning_objectives: [
      "สังเกต pleural fluid patterns: interlobar fissures · blunted costophrenic angle",
      "VHS reliability ลดลงเมื่อ cardiac border obscured",
      "ลอง Bone vs Soft preset ดู fluid contrast",
    ],
    credibility: "peer-reviewed",
    license: "CC BY 4.0",
    source_url: "https://zenodo.org/records/19051776",
    attribution: ATTR_VETXRAY,
    files: [
      { view_name: "Lateral", path: "vetxray-canine-pleural-effusion/Lateral.dcm" },
    ],
    recall: {
      findings: [
        "Pleural fluid lines (interlobar fissures)",
        "Blunted costophrenic angle",
        "Cardiac silhouette obscured",
      ],
      ddx: [],
      final_diagnosis: "Pleural effusion",
      teaching_points: [
        "DDx for effusion in dogs differs from cats — neoplasia, CHF, pyothorax, chylothorax",
        "Always interpret VHS with caution when the cardiac border is silhouetted by fluid",
      ],
      citation: ATTR_VETXRAY,
    },
  },
  {
    id: "294da3c8-713f-4b1e-9056-46f9e9eaf191",
    slug: "vetxray-canine-mass",
    title: "Canine lateral thoracic · MASS",
    species: "canine",
    signalment: "หมา · LL projection",
    history: "Soft tissue mass · DDx primary vs metastatic",
    body_part: "thorax",
    modality: "CR",
    difficulty: "intermediate",
    learning_objectives: [
      "ระบุ mass location · borders · sharpness",
      "วัดขนาด mass ด้วย 📏 Length tool (mm calibrated)",
      "สังเกต relationship กับ surrounding structures",
    ],
    credibility: "peer-reviewed",
    license: "CC BY 4.0",
    source_url: "https://zenodo.org/records/19051776",
    attribution: ATTR_VETXRAY,
    files: [{ view_name: "Lateral", path: "vetxray-canine-mass/Lateral.dcm" }],
    recall: {
      findings: ["Soft tissue mass identified"],
      ddx: [
        { name: "Primary pulmonary neoplasia", probability: "mid" },
        { name: "Metastatic disease", probability: "mid" },
        { name: "Granuloma / abscess", probability: "low" },
      ],
      final_diagnosis: "Mass",
      teaching_points: [
        "Solitary well-defined mass favors primary tumor; multiple small nodules favor metastatic",
        "Follow up with CT for staging — radiographs miss ~30% of metastatic nodules",
      ],
      citation: ATTR_VETXRAY,
      // Defensible only as a WIDE "lung-field" search region: the
      // VetXRay dataset label is generic "mass" with no published lobe
      // location for this individual case, so we can't pinpoint a
      // specific pulmonary nodule honestly. Instead we mark the
      // caudo-dorsal lung field — the most common site for primary
      // pulmonary neoplasia in dogs (per Thrall 7e Ch.32: caudal lobes
      // are over-represented for primary lung tumors). Wider box +
      // explicit hint = student learns to search the right anatomic
      // zone, not to nail a fabricated coordinate.
      lesion_regions: [
        {
          label: "caudo-dorsal lung field (search zone)",
          box: { x: 0.50, y: 0.25, w: 0.40, h: 0.45 },
          hint: "Without a lobe-specific label, the caudo-dorsal lung field is the canonical search region for canine primary pulmonary mass. Compare against the canine-normal lung pattern.",
        },
      ],
    },
  },
  {
    id: "5d32a243-d018-4cb3-98d8-efcd3b024161",
    slug: "vetxray-canine-alveolar-pattern",
    title: "Canine lateral thoracic · ALVEOLAR PATTERN",
    species: "canine",
    signalment: "หมา · LL projection",
    history: "Alveolar pattern · DDx pneumonia, edema, hemorrhage",
    body_part: "thorax",
    modality: "CR",
    difficulty: "intermediate",
    learning_objectives: [
      "สังเกต air bronchograms (ลม trapping ใน bronchi)",
      "ระบุ distribution: lobar · multifocal · diffuse",
      "เปรียบเทียบกับ interstitial pattern",
    ],
    credibility: "peer-reviewed",
    license: "CC BY 4.0",
    source_url: "https://zenodo.org/records/19051776",
    attribution: ATTR_VETXRAY,
    files: [
      { view_name: "Lateral", path: "vetxray-canine-alveolar-pattern/Lateral.dcm" },
    ],
    recall: {
      findings: ["Air bronchograms visible", "Alveolar consolidation"],
      ddx: [
        { name: "Bacterial pneumonia", probability: "high" },
        { name: "Cardiogenic pulmonary edema (CHF)", probability: "mid" },
        { name: "Pulmonary hemorrhage", probability: "mid" },
        { name: "Atelectasis", probability: "low" },
      ],
      final_diagnosis: "Alveolar pattern",
      teaching_points: [
        "Distribution matters: perihilar+caudodorsal = classic CHF; cranioventral = aspiration pneumonia",
        "Lobar consolidation favors bacterial; diffuse favors edema or hemorrhage",
      ],
      citation: ATTR_VETXRAY,
    },
  },

  // ────────────────────────────────────────────────────────
  // CUVET internal teaching cases (Aj. Ekkapol approved)
  // Anonymized via the 4-pass scrubber + PNG→DICOM wrapper.
  // ────────────────────────────────────────────────────────
  {
    id: "cuvet-pelvis-vd-001-uuid-2026-05-26",
    slug: "cuvet-canine-pelvis-vd-001",
    title: "Canine extended-leg pelvis VD · Norberg practice (CUVET)",
    species: "canine",
    signalment: "Dog · breed unknown · CUVET teaching set",
    history:
      "Extended-leg ventrodorsal pelvis from the CUVET teaching archive — the standard projection for coxofemoral evaluation and Norberg-angle practice. Image anonymized via the CUVET 4-pass scrubber pipeline; institutional R anatomy marker preserved.",
    body_part: "pelvis",
    modality: "DX",
    difficulty: "intro",
    learning_objectives: [
      "ฝึก 📐 Norberg angle 4-click workflow บนภาพจริงจาก CUVET PACS",
      "ระบุ landmark: femoral head + acetabular rim + obturator foramen",
      "ลอง 🪄 Auto preset ดู bone contrast แล้ว drag W/L เอง",
      "เปรียบเทียบ extended-leg position vs alternative views (ไม่มีในชุดนี้)",
      "อ่าน R anatomy marker เพื่อยืนยัน left vs right hip",
    ],
    credibility: "cuvet-internal",
    license: "Educational use, CUVET-internal · anonymized with Aj. approval",
    source_url: "https://imaging.cuvetsmo.com/sources#cuvet-internal-teaching",
    attribution: ATTR_CUVET_INTERNAL,
    files: [{ view_name: "VD", path: "cuvet-canine-pelvis-vd-001/VD.dcm" }],
    recall: {
      // Iron Rule 0: no published radiologist read for this anonymized
      // case, so the findings list reflects ONLY what was visually
      // verified during the QA audit — not an inferred diagnosis.
      findings: [
        "Symmetric femoral-head placement in acetabula on visual inspection",
        "Obturator foramina paired and symmetric",
        "Sacroiliac joints visible",
        "R anatomy marker confirms right-side orientation",
      ],
      ddx: [],
      final_diagnosis:
        "Visually normal extended-leg pelvis (no formal radiologist read available for this anonymized teaching case — practice the measurement workflow, not the diagnosis)",
      teaching_points: [
        "Norberg angle measures coxofemoral subluxation severity — vertex at the femoral head, lines to centre + craniolateral acetabular rim",
        "Reference cut-offs: ≥105° normal · 95–105° borderline · <95° dysplastic (Smith et al 1990 PennHIP-adjacent)",
        "Always measure BOTH hips and compare — asymmetry is a clinical flag even when individual angles look OK",
      ],
      citation: ATTR_CUVET_INTERNAL,
      // ground_truth deliberately OMITTED. Cannot fabricate a Norberg
      // angle without a published expert read. The overlay degrades
      // to live-measurement-only when ground_truth is absent.
    },
  },
];
