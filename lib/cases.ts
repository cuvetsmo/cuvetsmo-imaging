// Local sample case index. Day 1 ships without Supabase — cases are
// served as static JSON pointing at .dcm files in /public/cases/.
//
// Replace with a Supabase-backed loader when the imaging_cases /
// imaging_case_files / lab-dicom bucket migration lands.

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
};

// Day-1 fallback cases. Empty by default — the page will explain the
// drag-and-drop path until Palm seeds /public/cases/<slug>.dcm files
// and registers them here (or wires Supabase storage signed URLs).
export const CASES: ImagingCase[] = [];
