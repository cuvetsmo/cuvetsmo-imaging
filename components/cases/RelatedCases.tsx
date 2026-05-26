"use client";

// RelatedCases — small widget that surfaces cases related to the
// current one. Used on the case-detail page and (optionally) on the
// atlas-detail page so students can hop between paired views without
// returning to the index.
//
// Match criteria (cheap · runs entirely client-side over the in-memory
// catalog):
//   1. Same body_part + same species → strongest signal
//   2. Same body_part, any species → useful for cross-species comparison
//   3. Same species, different body_part → broader navigation
//
// Returns max 4 results, ordered by signal strength.

import Link from "next/link";
import type { ImagingCase } from "@/lib/cases";

type Props = {
  /** The current case slug — excluded from results. */
  currentSlug: string;
  /** Current case body_part for related-by-body matching. */
  bodyPart?: string;
  /** Current case species for related-by-species matching. */
  species?: string;
  /** Full case catalog from public/cases.json or lib/cases.ts. */
  catalog: ImagingCase[];
  /** Optional cap (default 4). */
  limit?: number;
};

type Scored = { item: ImagingCase; score: number };

export function RelatedCases({
  currentSlug,
  bodyPart,
  species,
  catalog,
  limit = 4,
}: Props) {
  // Score each candidate: 3 = exact body + species, 2 = body only,
  // 1 = species only. 0 means no relation and is filtered out.
  const scored: Scored[] = catalog
    .filter((c) => c.slug !== currentSlug)
    .map((c) => {
      let score = 0;
      const bodyMatch = bodyPart && c.body_part === bodyPart;
      const speciesMatch = species && c.species === species;
      if (bodyMatch && speciesMatch) score = 3;
      else if (bodyMatch) score = 2;
      else if (speciesMatch) score = 1;
      return { item: c, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length === 0) {
    return null;
  }

  return (
    <section className="mt-8 pt-6 border-t border-[var(--color-border)]">
      <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] mb-3 flex items-center gap-2">
        <span className="text-[var(--color-tool-violet)]">↔</span> Related cases
      </h2>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {scored.map(({ item, score }) => (
          <li key={item.slug}>
            <Link
              href={`/cases/${item.slug}`}
              className="block px-3 py-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] hover:border-[var(--color-tool-cyan)]/40 hover:bg-[var(--color-surface-lift)] transition-colors"
            >
              <div className="flex items-baseline justify-between gap-2 mb-0.5">
                <span className="text-[13px] text-[var(--color-text)] truncate">
                  {item.title}
                </span>
                <span className="text-[10px] font-mono text-[var(--color-text-faint)] shrink-0">
                  {score === 3 ? "same view" : score === 2 ? "same body" : "same species"}
                </span>
              </div>
              <div className="text-[11px] font-mono text-[var(--color-text-muted)]">
                {item.modality ?? "—"} · {item.species ?? "—"} · {item.body_part ?? "—"} · {item.files[0]?.view_name ?? "—"}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
