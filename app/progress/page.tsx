import type { Metadata } from "next";
import { ProgressView } from "@/components/progress/ProgressView";

export const metadata: Metadata = {
  title: "Your progress · CUVETSMO Imaging",
  description:
    "Aggregate of cases attempted, quiz performance, atlas browsing, and SRS streak from your local browser storage. Nothing is sent to a server.",
  openGraph: {
    title: "Your progress · CUVETSMO Imaging",
    description: "Local-only progress dashboard — cases, quizzes, atlas, SRS.",
    type: "website",
    url: "https://imaging.cuvetsmo.com/progress",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Progress dashboard" }],
  },
  alternates: { canonical: "https://imaging.cuvetsmo.com/progress" },
};

export default function ProgressPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-10">
      <ProgressView />
    </div>
  );
}
