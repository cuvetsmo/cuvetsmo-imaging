// app/sitemap.ts — Next.js Metadata Sitemap (replaces /sitemap.xml).
// Auto-generated at build time. Lists every route a vet student would
// reasonably need to discover via a search engine.
//
// Routes covered:
//   - Static: / · /atlas · /cases · /sources · /about · /occlusion ·
//     /review · /share-receiver
//   - Dynamic SSG: /atlas/[slug] (from ATLAS_ENTRIES)
//   - Dynamic SSR: /cases/[id] (from CASES, slug-based)
//
// lastModified uses 2026-05-27 (Phase 21 ship date) for all entries.
// Could be per-entry later if content updates land asynchronously.

import type { MetadataRoute } from "next";
import { ATLAS_ENTRIES } from "@/lib/atlas";
import { CASES } from "@/lib/cases";

const SITE = "https://imaging.cuvetsmo.com";
const LAST_MODIFIED = new Date("2026-05-27");

export default function sitemap(): MetadataRoute.Sitemap {
  // Static surfaces — priority weighted by user value.
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, lastModified: LAST_MODIFIED, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE}/atlas`, lastModified: LAST_MODIFIED, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE}/cases`, lastModified: LAST_MODIFIED, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE}/sources`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE}/about`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE}/occlusion`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE}/review`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.6 },
  ];

  // Dynamic atlas details — one per entry · derived from data.
  const atlasRoutes: MetadataRoute.Sitemap = ATLAS_ENTRIES.map((entry) => ({
    url: `${SITE}/atlas/${entry.slug}`,
    lastModified: LAST_MODIFIED,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  // Dynamic case details — one per CASES entry · derived from data.
  const caseRoutes: MetadataRoute.Sitemap = CASES.map((c) => ({
    url: `${SITE}/cases/${c.slug}`,
    lastModified: LAST_MODIFIED,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  return [...staticRoutes, ...atlasRoutes, ...caseRoutes];
}
