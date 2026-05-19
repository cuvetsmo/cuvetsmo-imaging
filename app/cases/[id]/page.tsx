import { CaseViewerClient } from "./CaseViewerClient";

// Catch-all id resolves to a slug — the client loads /cases.json and
// fetches the DICOM at /cases/<slug>/<view>.dcm.
export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CaseViewerClient caseId={id} />;
}
