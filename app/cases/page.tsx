import type { Metadata } from "next";
import CaseLibraryLocal from "@/components/lab/CaseLibraryLocal";

export const metadata: Metadata = {
  title: "Case Library",
  description:
    "Curated DICOM cases for veterinary imaging practice — Norberg, VHS, and more. By CUVETSMO Labs.",
};

export default function CasesPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <CaseLibraryLocal />
    </div>
  );
}
