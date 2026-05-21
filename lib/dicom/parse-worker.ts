/// <reference lib="webworker" />

// Dedicated Web Worker — parses DICOM headers off the main thread so the
// bulk-import UI doesn't freeze on 50+ file drops.
//
// Bundled by Next.js 16 webpack via the standard
//   new Worker(new URL('./parse-worker.ts', import.meta.url), { type: 'module' })
// pattern from parse-pool.ts. dicom-parser is bundled into the worker chunk.
//
// Scope rules:
// - Header only (untilTag stops parse before pixel data) — ~10ms per file
// - Never read or post PatientName (0010,0010). PatientID is hashed.
// - Malformed DICOMs return { ok: false }, do not crash the worker.

import dicomParser from "dicom-parser";
import type { ParseRequest, ParseResponse, ParsedHeader } from "./parse-types";

// Tell TS this file runs in a DedicatedWorkerGlobalScope (not Window).
declare const self: DedicatedWorkerGlobalScope;

// Stop the parser early — InstanceNumber (0020,0013) sits comfortably
// after every header tag we care about, before the bulky PixelData.
const UNTIL_TAG = "x00200013";

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  const { id, arrayBuffer } = e.data;

  try {
    const u8 = new Uint8Array(arrayBuffer);
    const dataSet = dicomParser.parseDicom(u8, { untilTag: UNTIL_TAG });

    const meta: ParsedHeader = {
      studyUid: dataSet.string("x0020000d") ?? "",
      seriesUid: dataSet.string("x0020000e") ?? "",
      sopInstanceUid: dataSet.string("x00080018") ?? "",
      modality: dataSet.string("x00080060") ?? "OT",
      patientId: hashPatientId(dataSet.string("x00100020")),
      studyDescription: dataSet.string("x00081030") ?? "",
      seriesDescription: dataSet.string("x0008103e") ?? "",
      acquisitionDate: dataSet.string("x00080022") ?? "",
      parsedAt: Date.now(),
    };

    const reply: ParseResponse = { id, ok: true, meta };
    self.postMessage(reply);
  } catch (err) {
    const reply: ParseResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(reply);
  }
};

/**
 * Lightweight deterministic pseudonym for PatientID.
 *
 * djb2-xor variant — same raw ID always maps to the same `pt-xxxxxxxx`
 * token within a session, so two files from the same patient cluster
 * together in the StudyTree without ever persisting the real ID.
 *
 * NOT a cryptographic hash. Don't use for security boundaries — only
 * for in-session grouping where the alternative is shipping raw PHI.
 */
function hashPatientId(raw?: string): string | undefined {
  if (!raw) return undefined;
  let h = 5381;
  for (let i = 0; i < raw.length; i++) {
    h = (h * 33) ^ raw.charCodeAt(i);
  }
  return `pt-${(h >>> 0).toString(16).padStart(8, "0").slice(0, 8)}`;
}

// Export {} so TS treats this as a module (required for top-level
// `declare const self` + module-worker bundling).
export {};
