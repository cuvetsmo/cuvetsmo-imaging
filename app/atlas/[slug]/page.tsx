import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ATLAS_ENTRIES,
  getAtlasEntry,
  getRelatedAtlasEntries,
  SPECIES_LABELS,
  BODY_PART_LABELS,
} from "@/lib/atlas";
import { AtlasDetail } from "@/components/atlas/AtlasDetail";

// Pre-render every atlas entry at build time. The set is tiny (10) so
// generateStaticParams is essentially free, and it lets us serve each
// slug as a static HTML doc (good for OG previews, fast TTFB).
export function generateStaticParams() {
  return ATLAS_ENTRIES.map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const entry = getAtlasEntry(slug);
  if (!entry) return { title: "Not found" };

  const species = SPECIES_LABELS[entry.species];
  const part = BODY_PART_LABELS[entry.body_part];
  const title = `${species} ${part} · ${entry.view} — Atlas`;
  const description = `${entry.description}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      url: `https://imaging.cuvetsmo.com/atlas/${entry.slug}`,
      images: [
        {
          url: entry.image_path,
          width: 800,
          height: 600,
          alt: `${species} ${part} ${entry.view} radiograph — atlas reference`,
        },
      ],
    },
    alternates: { canonical: `https://imaging.cuvetsmo.com/atlas/${entry.slug}` },
  };
}

export default async function AtlasEntryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const entry = getAtlasEntry(slug);
  if (!entry) notFound();

  const related = getRelatedAtlasEntries(slug, 4);

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-10">
      <AtlasDetail entry={entry} related={related} />
    </div>
  );
}
