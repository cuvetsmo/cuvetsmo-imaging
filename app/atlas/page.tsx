import type { Metadata } from "next";
import { ATLAS_ENTRIES } from "@/lib/atlas";
import { AtlasGrid } from "@/components/atlas/AtlasGrid";

export const metadata: Metadata = {
  title: "Anatomy Atlas — normal radiograph reference",
  description:
    "Anatomy Atlas — filterable grid of normal canine, feline and exotic radiographs by modality and body part. Stage-1 baseline for vet students learning to read X-rays.",
  openGraph: {
    title: "Anatomy Atlas — normal radiograph reference",
    description:
      "Normal radiographs by modality x species x body part. See normal 100 times before reading abnormal.",
    type: "website",
    url: "https://imaging.cuvetsmo.com/atlas",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "CUVETSMO Imaging Atlas" }],
  },
  alternates: { canonical: "https://imaging.cuvetsmo.com/atlas" },
};

// Server component. Reads the static ATLAS_ENTRIES list and hands it
// to the client grid. Filter state + persistence live in AtlasGrid.
export default function AtlasPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
      <AtlasGrid entries={ATLAS_ENTRIES} />
    </div>
  );
}
