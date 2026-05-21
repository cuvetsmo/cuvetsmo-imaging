// Shared types for the DICOM parse worker pool (Phase 4).
//
// Contract is shared with Agents 🅰 (BulkDropzone/Progress), 🅲 (StudyTree),
// 🅳 (RecentImports/store). Keep field names stable — adding fields is
// fine, renaming requires a coordinated bump across all four agents.
//
// PHI policy:
// - patientId is a deterministic pseudonym (djb2-xor hash, hex slice).
// - PatientName (0010,0010) is NEVER read off the worker. Keep it that way.
//
// All UID strings come straight from DICOM — they are opaque identifiers,
// not PHI on their own (per DICOM PS3.15 Annex E.1).

/** Parsed DICOM header metadata returned by the parse pool. */
export interface DicomFileMeta {
  /** Original File handle, re-attached by the pool on the main thread. */
  fileHandle: File;
  /** StudyInstanceUID (0020,000D). */
  studyUid: string;
  /** SeriesInstanceUID (0020,000E). */
  seriesUid: string;
  /** SOPInstanceUID (0008,0018) — unique per image. */
  sopInstanceUid: string;
  /** Modality (0008,0060) — e.g. "CR", "CT", "MR", "OT" fallback. */
  modality: string;
  /** Pseudonymized PatientID. Never the raw value. */
  patientId?: string;
  /** StudyDescription (0008,1030). */
  studyDescription?: string;
  /** SeriesDescription (0008,103E). */
  seriesDescription?: string;
  /** AcquisitionDate (0008,0022), DICOM YYYYMMDD format. */
  acquisitionDate?: string;
  /** Epoch ms when parse completed (on worker). */
  parsedAt: number;
}

/** The header subset the worker emits — fileHandle is added by the pool. */
export type ParsedHeader = Omit<DicomFileMeta, "fileHandle">;

/** Worker request payload (main → worker). */
export interface ParseRequest {
  id: number;
  arrayBuffer: ArrayBuffer;
}

/** Worker response payload (worker → main). */
export type ParseResponse =
  | { id: number; ok: true; meta: ParsedHeader }
  | { id: number; ok: false; error: string };

/** Public progress callback shape. */
export type ParseProgressFn = (
  done: number,
  total: number,
  latest?: DicomFileMeta,
) => void;

/** Public per-file error callback shape. */
export type ParseErrorFn = (file: File, err: string) => void;

/** Options for {@link parseDicomBatch}. */
export interface ParseDicomBatchOptions {
  onProgress?: ParseProgressFn;
  onError?: ParseErrorFn;
  /** Abort signal — drains queue, lets in-flight tasks finish. */
  signal?: AbortSignal;
  /** Override pool size (mainly for tests). Default = hardwareConcurrency-1 ∈ [1,8]. */
  poolSize?: number;
}
