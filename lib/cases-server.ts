// ============================================================================
// lib/cases-server.ts
// ============================================================================
// Async case loader. Tries Supabase first when env vars are configured; on
// any failure or when env vars are missing, falls back to the synchronous
// CASES export from lib/cases.ts (which can be empty).
//
// The shape returned matches lib/cases.ts ImagingCase exactly so call sites
// don't need to know whether the source is Supabase or the static array.
//
// Used by app/cases/page.tsx + app/cases/[id]/page.tsx (Server Components).
// ============================================================================

import { CASES, type ImagingCase, type Modality } from "./cases";
import { getSupabase } from "./supabase";
import type { ImagingRecallPayload } from "@/types/database";

// ---- Row shape returned by the embedded join (`*, files:imaging_case_files(*)`)
type CaseFileRow = {
  view_name: string;
  storage_path: string;
  order_index: number;
};

type CaseRow = {
  id: string;
  slug: string;
  title: string;
  species: string;
  signalment: string | null;
  history: string | null;
  body_part: string | null;
  modality: string | null;
  difficulty: "intro" | "intermediate" | "advanced" | null;
  learning_objectives: string[] | null;
  credibility: string;
  license: string | null;
  source_url: string | null;
  attribution: string | null;
  recall: ImagingRecallPayload | null;
  files: CaseFileRow[];
};

/**
 * Load published cases. Resolves to:
 *   1. Supabase rows (if env vars set + query succeeds), OR
 *   2. the static CASES array from lib/cases.ts (fallback).
 *
 * Never throws — Supabase failures degrade silently to the static fallback
 * with a console warn so SSG builds don't fail when the project isn't
 * wired yet.
 */
export async function loadCases(): Promise<ImagingCase[]> {
  const sb = getSupabase();
  if (!sb) return CASES;

  const { data, error } = await sb
    .from("imaging_cases")
    .select("*, files:imaging_case_files(view_name, storage_path, order_index)")
    .eq("is_published", true)
    .order("created_at", { ascending: false });

  if (error || !data) {
    // eslint-disable-next-line no-console
    console.warn(
      "[cuvetsmo-imaging] Supabase case load failed, using static fallback.",
      error,
    );
    return CASES;
  }

  return (data as unknown as CaseRow[]).map(toImagingCase);
}

/**
 * Load one published case by slug. Returns null if not found / not published.
 * Falls back to the static CASES array when Supabase isn't configured.
 */
export async function loadCaseBySlug(slug: string): Promise<ImagingCase | null> {
  const sb = getSupabase();
  if (!sb) return CASES.find((c) => c.slug === slug) ?? null;

  const { data, error } = await sb
    .from("imaging_cases")
    .select("*, files:imaging_case_files(view_name, storage_path, order_index)")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  if (error) {
    // eslint-disable-next-line no-console
    console.warn(
      "[cuvetsmo-imaging] Supabase case-by-slug load failed, falling back.",
      error,
    );
    return CASES.find((c) => c.slug === slug) ?? null;
  }
  if (!data) return null;

  return toImagingCase(data as unknown as CaseRow);
}

// ---- mappers ---------------------------------------------------------------
function toImagingCase(row: CaseRow): ImagingCase {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    species: row.species,
    signalment: row.signalment ?? undefined,
    history: row.history ?? undefined,
    body_part: row.body_part ?? undefined,
    modality: (row.modality ?? undefined) as Modality | undefined,
    difficulty: row.difficulty ?? undefined,
    learning_objectives: row.learning_objectives ?? undefined,
    credibility:
      (row.credibility as ImagingCase["credibility"]) ?? undefined,
    license: row.license ?? undefined,
    source_url: row.source_url ?? undefined,
    attribution: row.attribution ?? undefined,
    files: (row.files ?? [])
      .slice()
      .sort((a, b) => a.order_index - b.order_index)
      .map((f) => ({ view_name: f.view_name, path: f.storage_path })),
    recall: row.recall ?? undefined,
  };
}
