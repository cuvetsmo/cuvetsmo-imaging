import type { Metadata } from "next";
import { ATLAS_ENTRIES } from "@/lib/atlas";
import { QuizView } from "@/components/quiz/QuizView";

export const metadata: Metadata = {
  title: "Anatomy quiz · CUVETSMO Imaging",
  description:
    "Quick anatomy-recognition quiz using the real atlas — identify species, body part, and view from radiographs sourced from VetXRay, Wikimedia, and anonymized CUVET teaching cases.",
  openGraph: {
    title: "Anatomy quiz · CUVETSMO Imaging",
    description: "Quick anatomy-recognition quiz on real veterinary radiographs.",
    type: "website",
    url: "https://imaging.cuvetsmo.com/quiz",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Anatomy quiz" }],
  },
  alternates: { canonical: "https://imaging.cuvetsmo.com/quiz" },
};

// Server component · just hands the static atlas list to the client
// quiz engine. Quiz state (current question · score · streak) lives
// entirely client-side in QuizView so re-mounts don't reset progress
// (persistence is via localStorage, mirroring the SRS pattern in
// app/review).
export default function QuizPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-10">
      <QuizView entries={ATLAS_ENTRIES} />
    </div>
  );
}
