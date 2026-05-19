import type { Metadata } from "next";
import OcclusionView from "@/components/occlusion/OcclusionView";

export const metadata: Metadata = {
  title: "Image Occlusion",
  description:
    "Anki-style image occlusion for anatomy, radiographs, histology. Decks stay in browser localStorage. By CUVETSMO Labs.",
};

export default function OcclusionPage() {
  return <OcclusionView />;
}
