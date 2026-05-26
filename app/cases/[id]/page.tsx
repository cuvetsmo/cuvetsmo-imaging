import type { Metadata } from "next";
import { CASES } from "@/lib/cases";
import { CaseDetailView } from "@/components/cases/CaseDetailView";

// Per-case generateMetadata — Phase 21 Wave 2.
//
// Each case detail page exports unique title + description + OG image
// so share-link previews + search snippets reflect the actual case
// rather than the generic /og.png. CUVET cases get the matching atlas
// PNG as OG. Non-CUVET cases (VetXRay external) fall back to /og.png.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const meta = CASES.find((c) => c.slug === id || c.id === id);
  if (!meta) {
    return {
      title: "Case not found",
      description: "The case you're looking for isn't in the catalog yet.",
    };
  }

  // Per-case OG image — atlas-paired PNG for CUVET cases.
  const isCuvet = meta.slug.startsWith("cuvet-");
  const ogImage = isCuvet
    ? `/atlas/${meta.slug}.png`
    : "/og.png";

  return {
    title: meta.title,
    description: meta.history ?? meta.title,
    openGraph: {
      title: meta.title,
      description: meta.history ?? meta.title,
      type: "article",
      url: `https://imaging.cuvetsmo.com/cases/${meta.slug}`,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: `${meta.species} ${meta.body_part ?? ""} radiograph — ${meta.title}`,
        },
      ],
    },
    alternates: { canonical: `https://imaging.cuvetsmo.com/cases/${meta.slug}` },
  };
}

// Catch-all id resolves to a slug. CaseDetailView loads /cases.json on the
// client, mounts the DICOM viewer and runs the Active Recall workflow.
// 404-style fallback is rendered inside CaseDetailView when the slug
// can't be matched.
export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CaseDetailView caseId={id} />;
}
