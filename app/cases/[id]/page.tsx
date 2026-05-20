import { CaseDetailView } from "@/components/cases/CaseDetailView";

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
