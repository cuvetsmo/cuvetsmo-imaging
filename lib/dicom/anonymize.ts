// anonymize.ts — Phase 5 (Agent ⓔ).
//
// Strip the 22-tag PII set from persisted DICOM Blobs and pack the cleaned
// files into a downloadable ZIP. Designed to be called on whole studies
// from RecentImports without depending on the worker pool or Cornerstone.
//
// Reference for the tag set:
//   - DICOM PS3.15 Annex E (Basic Application Level Confidentiality)
//   - MycOS/knowledge/learnings/dicom-ingestion-pipeline.md  (Step 4 of the
//     project's canonical 22-tag list — re-cited inline in PII_TAGS)
//   - This module supersedes the older lib/dicom/anonymizer.js single-file
//     scrubber. Same byte-overwrite approach, study-level API + ZIP packer
//     on top, written in TS so the report types are exported.
//
// Approach (documented per agent spec):
//   1. Parse DICOM with dicom-parser (read-only — gives us per-element
//      dataOffset + length).
//   2. Clone the original Uint8Array.
//   3. For each PII tag found, overwrite the value bytes IN PLACE,
//      preserving the element length so the DICOM structure stays
//      conformant. Strings get padded with ASCII space (0x20); dates
//      (VR=DA, 8 chars) get rewritten to a fixed neutral epoch value.
//      We never resize an element — keeping byte offsets stable means
//      we don't have to rebuild the dataset, and other tools downstream
//      see a well-formed DICOM that just has empty PII fields.
//   4. (Iron Rule 0 self-test) Re-parse the OUTPUT bytes and verify
//      every PII tag is either missing or all-zero/all-space.

import dicomParser, { type DataSet } from "dicom-parser";
import { zip } from "fflate";

import { loadAllStudies } from "./dicom-store";
import type { Study } from "./dicom-store";

// ─── Canonical 22-tag PII set ────────────────────────────────────────────────
//
// Numbered per the agent spec (Phase 5 brief). Source: DICOM PS3.15
// Annex E + MycOS dicom-ingestion-pipeline.md.

export interface PIITag {
  /** dicom-parser key "xGGGGEEEE" lowercase hex. */
  key: string;
  /** Spec-name label (used in report). */
  label: string;
  /** DICOM "Value Representation" — drives padding choice. */
  vr: "PN" | "LO" | "SH" | "DA" | "TM" | "AS" | "CS" | "ST" | "UI" | "IS";
  /** Family bucket — used purely for the report. */
  group: "patient" | "study" | "site" | "free-text";
}

// Exactly 22 entries. StudyDescription and SeriesDescription are LISTED
// here but are conditionally KEPT — see anonymizeDicomBlob() opts.
export const PII_TAGS: readonly PIITag[] = [
  // ── Patient identity (8)
  { key: "x00100010", label: "PatientName", vr: "PN", group: "patient" },
  { key: "x00100020", label: "PatientID", vr: "LO", group: "patient" },
  { key: "x00100030", label: "PatientBirthDate", vr: "DA", group: "patient" },
  { key: "x00100040", label: "PatientSex", vr: "CS", group: "patient" },
  { key: "x00101010", label: "PatientAge", vr: "AS", group: "patient" },
  { key: "x00101040", label: "PatientAddress", vr: "LO", group: "patient" },
  { key: "x00102154", label: "PatientTelephoneNumbers", vr: "SH", group: "patient" },
  { key: "x00101060", label: "PatientMotherBirthName", vr: "PN", group: "patient" },
  // ── Study / order identifiers (6)
  { key: "x00080050", label: "AccessionNumber", vr: "SH", group: "study" },
  { key: "x00200010", label: "StudyID", vr: "SH", group: "study" },
  { key: "x00080090", label: "ReferringPhysicianName", vr: "PN", group: "study" },
  { key: "x00321032", label: "RequestingPhysician", vr: "PN", group: "study" },
  { key: "x00081050", label: "PerformingPhysicianName", vr: "PN", group: "study" },
  { key: "x00081070", label: "OperatorsName", vr: "PN", group: "study" },
  // ── Hospital / site (4 — note 0008,1040 listed twice in the agent brief,
  //   safe-dedup to 1 entry; DICOM's "InstitutionalDepartmentName" is the
  //   real tag name for 0008,1040 — "DepartmentName" was a colloquial dupe)
  { key: "x00080080", label: "InstitutionName", vr: "LO", group: "site" },
  { key: "x00080081", label: "InstitutionAddress", vr: "ST", group: "site" },
  { key: "x00081010", label: "StationName", vr: "SH", group: "site" },
  { key: "x00081040", label: "InstitutionalDepartmentName", vr: "LO", group: "site" },
  // ── Free-text fields that may carry PII (4 — totalling 22)
  { key: "x00081030", label: "StudyDescription", vr: "LO", group: "free-text" },
  { key: "x0008103e", label: "SeriesDescription", vr: "LO", group: "free-text" },
  { key: "x00204000", label: "ImageComments", vr: "ST", group: "free-text" },
  { key: "x00400254", label: "PerformedProcedureStepDescription", vr: "LO", group: "free-text" },
] as const;

// Tags we KEEP by default (Palm wants case labels in the UI). Toggle-able.
const DEFAULT_KEEP = new Set<string>(["x00081030", "x0008103e"]);

// ─── Public types ────────────────────────────────────────────────────────────

export type AnonymizationOptions = {
  /** Keep StudyDescription (0008,1030). Default: true (Palm needs labels). */
  keepStudyDescription?: boolean;
  /** Keep SeriesDescription (0008,103E). Default: true. */
  keepSeriesDescription?: boolean;
  /**
   * If set, replace PatientID with `pt-<hex>` derived from this seed +
   * the original PatientID bytes. Deterministic across re-anonymizations
   * so case-sets stay linkable without leaking the raw ID.
   * If unset, PatientID is just blanked like the other PII tags.
   */
  patientIdHashSeed?: string;
};

export type StrippedTag = {
  label: string;
  /** dicom-parser key. */
  key: string;
  /** Element length in bytes (what was overwritten). */
  bytes: number;
};

export type AnonymizationReport = {
  /** Which PII tags were found and stripped, per file. */
  tagsStripped: StrippedTag[];
  /** Expected tags that weren't present (informational). */
  tagsNotFound: string[];
  /** Tags that were intentionally kept (e.g. StudyDescription). */
  tagsKept: string[];
  /** Self-test result — false means something leaked through. */
  selfTestPassed: boolean;
  /** Any non-fatal warnings (e.g. self-test mismatches). */
  warnings: string[];
};

export type StudyAnonymizationReport = {
  studyUid: string;
  files: number;
  byFile: Array<{
    sopInstanceUid: string;
    filename: string;
    report: AnonymizationReport;
  }>;
  errors: Array<{ sopInstanceUid: string; error: string }>;
  /** Union of stripped tag labels across the whole study. */
  tagsStrippedUnion: string[];
};

// ─── Per-blob anonymizer ─────────────────────────────────────────────────────

/**
 * Anonymize a single DICOM Blob.
 *
 * Strategy: parse for offsets/lengths, clone the byte array, overwrite each
 * PII element's value bytes in place. Element length is preserved so the
 * outer DICOM framing (group/element/length headers, sequences, transfer
 * syntax) stays valid for every downstream tool.
 *
 * Trade-off: we DO NOT write a meaningful replacement string (no "ANON" or
 * "REDACTED" tokens). Reason — DICOM Value Representation rules differ per
 * tag (PN has component delimiters, DA wants YYYYMMDD, AS wants nnnD/W/M/Y,
 * CS is constrained vocab, IS is integer-as-string). Writing wrong-VR bytes
 * risks rejection by strict viewers. Pure space/zero-fill is universally
 * legal (DICOM treats trailing 0x20 as padding for string VRs and "00000000"
 * is a valid placeholder date), so it survives every parser.
 *
 * For odd-length elements we still write all bytes (DICOM specifies even
 * length so this is academic, but defensively no boundary skipping).
 */
export async function anonymizeDicomBlob(
  blob: Blob,
  opts: AnonymizationOptions = {},
): Promise<{ blob: Blob; report: AnonymizationReport }> {
  const keep = new Set<string>(DEFAULT_KEEP);
  if (opts.keepStudyDescription === false) keep.delete("x00081030");
  if (opts.keepSeriesDescription === false) keep.delete("x0008103e");

  const buf = await blob.arrayBuffer();
  const u8 = new Uint8Array(buf);

  let dataSet: DataSet;
  try {
    dataSet = dicomParser.parseDicom(u8);
  } catch (err) {
    throw new Error(
      `dicom-parser failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Make our writable copy — must not mutate the caller's buffer.
  const out = new Uint8Array(u8.length);
  out.set(u8);

  const stripped: StrippedTag[] = [];
  const notFound: string[] = [];
  const kept: string[] = [];

  for (const tag of PII_TAGS) {
    const el = dataSet.elements[tag.key];
    if (!el) {
      notFound.push(tag.label);
      continue;
    }
    if (keep.has(tag.key)) {
      kept.push(tag.label);
      continue;
    }

    // Special case: PatientID with a hash seed → write a deterministic
    // pseudonym (length-fitted) instead of pure padding. Stays a valid
    // LO (Long String, ≤64 chars). If the original element is too short
    // to fit "pt-XXXXXXXX" (11 chars), we fall back to plain padding —
    // a too-short PatientID was almost certainly empty/garbage anyway.
    if (
      tag.key === "x00100020" &&
      opts.patientIdHashSeed &&
      el.length >= 11
    ) {
      let raw = "";
      try { raw = dataSet.string("x00100020") ?? ""; } catch { /* binary */ }
      const token = `pt-${stableHexHash(`${opts.patientIdHashSeed}|${raw}`, 8)}`;
      writePaddedString(out, el.dataOffset, el.length, token, 0x20);
      stripped.push({ label: tag.label, key: tag.key, bytes: el.length });
      continue;
    }

    // Default: write per-VR padding.
    const padByte = paddingByteForVR(tag.vr);
    for (let i = 0; i < el.length; i++) {
      out[el.dataOffset + i] = padByte;
    }
    stripped.push({ label: tag.label, key: tag.key, bytes: el.length });
  }

  // Build the Blob from a fresh ArrayBuffer to dodge TS lib.dom
  // strict-typing around Uint8Array<ArrayBufferLike> vs BlobPart. Casting
  // through `as unknown as BlobPart` would also work — copying is cleaner
  // and trivially cheap relative to the surrounding parse cost.
  const outBlob = new Blob([toFreshArrayBuffer(out)], { type: "application/dicom" });

  // ── Iron Rule 0 self-test ────────────────────────────────────────────
  // Re-parse the OUTPUT and confirm every stripped tag is now blank
  // (or, for PatientID under a hash seed, contains only the expected
  // `pt-` pseudonym — which we accept as anonymized).
  const allowedPseudonyms = new Map<string, RegExp>();
  if (opts.patientIdHashSeed) {
    allowedPseudonyms.set("PatientID", /^\s*pt-[0-9a-f]{1,16}\s*$/);
  }
  const { ok, warnings } = await verifyAnonymized(outBlob, kept, allowedPseudonyms);

  return {
    blob: outBlob,
    report: {
      tagsStripped: stripped,
      tagsNotFound: notFound,
      tagsKept: kept,
      selfTestPassed: ok,
      warnings,
    },
  };
}

// ─── Study-level API ─────────────────────────────────────────────────────────

export type StudyAnonymizationProgress = (info: {
  doneFiles: number;
  totalFiles: number;
  phase: "parsing" | "zipping" | "done";
  currentSop?: string;
}) => void;

/**
 * Anonymize every instance of a study. Returns a list of cleaned files
 * (Blob + sanitized filename) plus a summary report.
 *
 * Filenames are `${sopInstanceUid}.dcm`. We DO NOT use the original
 * `file.name` because user-supplied filenames often contain PatientName or
 * PatientID ("JohnDoe_RX_1.dcm"). The SOP InstanceUID is a DICOM-internal
 * opaque identifier (PS3.15 Annex E.1 — not PHI on its own).
 */
export async function anonymizeStudy(
  studyUid: string,
  opts: AnonymizationOptions = {},
  onProgress?: StudyAnonymizationProgress,
): Promise<{
  files: { name: string; blob: Blob; sopInstanceUid: string }[];
  report: StudyAnonymizationReport;
}> {
  const studies = await loadAllStudies();
  const study = studies.find((s) => s.studyUid === studyUid);
  if (!study) {
    throw new Error(`Study not found in local store: ${studyUid}`);
  }

  const all = collectInstances(study);
  const total = all.length;
  if (total === 0) {
    return {
      files: [],
      report: {
        studyUid,
        files: 0,
        byFile: [],
        errors: [],
        tagsStrippedUnion: [],
      },
    };
  }

  const files: { name: string; blob: Blob; sopInstanceUid: string }[] = [];
  const byFile: StudyAnonymizationReport["byFile"] = [];
  const errors: StudyAnonymizationReport["errors"] = [];
  const unionLabels = new Set<string>();

  onProgress?.({ doneFiles: 0, totalFiles: total, phase: "parsing" });

  for (let i = 0; i < all.length; i++) {
    const m = all[i];
    onProgress?.({
      doneFiles: i,
      totalFiles: total,
      phase: "parsing",
      currentSop: m.sopInstanceUid,
    });
    try {
      const blob = await fileHandleToBlob(m.fileHandle);
      const { blob: outBlob, report } = await anonymizeDicomBlob(blob, opts);
      const safeName = `${sanitizeForFilename(m.sopInstanceUid)}.dcm`;
      files.push({ name: safeName, blob: outBlob, sopInstanceUid: m.sopInstanceUid });
      byFile.push({
        sopInstanceUid: m.sopInstanceUid,
        filename: safeName,
        report,
      });
      for (const s of report.tagsStripped) unionLabels.add(s.label);
    } catch (err) {
      errors.push({
        sopInstanceUid: m.sopInstanceUid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // Yield to UI between files so large studies don't block the main
    // thread for several hundred ms — the next macrotask paints progress.
    if ((i & 3) === 3) await new Promise((r) => setTimeout(r, 0));
  }

  onProgress?.({ doneFiles: total, totalFiles: total, phase: "done" });

  return {
    files,
    report: {
      studyUid,
      files: files.length,
      byFile,
      errors,
      tagsStrippedUnion: Array.from(unionLabels).sort(),
    },
  };
}

// ─── ZIP packer ──────────────────────────────────────────────────────────────

export type PackedZip = {
  blob: Blob;
  filename: string;
};

/**
 * Pack cleaned files into a single ZIP plus a MANIFEST.json containing the
 * per-file anonymization report. Stream compression isn't worth it for DICOM
 * (pixel data is already byte-noisy), so we use store-only — zipSync's
 * default level is fine for the tiny non-pixel headers.
 */
export async function packAnonymizedZip(
  files: { name: string; blob: Blob }[],
  report: StudyAnonymizationReport,
): Promise<PackedZip> {
  // Build the fflate input map.
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    entries[f.name] = new Uint8Array(await f.blob.arrayBuffer());
  }
  const manifest = {
    generator: "cuvetsmo-imaging",
    generatedAt: new Date().toISOString(),
    studyUid: report.studyUid,
    files: report.files,
    errors: report.errors,
    tagsStrippedUnion: report.tagsStrippedUnion,
    perFile: report.byFile.map((f) => ({
      filename: f.filename,
      sopInstanceUid: f.sopInstanceUid,
      tagsStripped: f.report.tagsStripped,
      tagsNotFound: f.report.tagsNotFound,
      tagsKept: f.report.tagsKept,
      selfTestPassed: f.report.selfTestPassed,
      warnings: f.report.warnings,
    })),
  };
  entries["MANIFEST.json"] = new TextEncoder().encode(
    JSON.stringify(manifest, null, 2),
  );

  // Async zip — keeps the main thread responsive for big studies.
  const data: Uint8Array = await new Promise((resolve, reject) => {
    zip(entries, { level: 0 /* DICOM headers already small, pixel data noisy */ }, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });

  const shortUid = shortStudyUid(report.studyUid);
  const stamp = ymd(new Date());
  return {
    blob: new Blob([toFreshArrayBuffer(data)], { type: "application/zip" }),
    filename: `cuvetsmo-anonymized-${shortUid}-${stamp}.zip`,
  };
}

/**
 * Copy a Uint8Array's contents into a brand-new ArrayBuffer.
 *
 * Modern TS lib.dom typings declare Uint8Array as
 * `Uint8Array<ArrayBufferLike>` which the Blob constructor refuses (a
 * SharedArrayBuffer-backed view isn't a valid BlobPart). For our use we
 * always have a plain ArrayBuffer at runtime, but the static type doesn't
 * narrow that. One fresh copy keeps the code branch-free and the cost is
 * dwarfed by the surrounding parse/zip work.
 */
function toFreshArrayBuffer(view: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(view.byteLength);
  new Uint8Array(buf).set(view);
  return buf;
}

// ─── Browser download helper ────────────────────────────────────────────────

export function triggerDownload(packed: PackedZip): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(packed.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = packed.filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after the browser has had time to commit the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ─── Self-verification (Iron Rule 0) ─────────────────────────────────────────

/**
 * Re-parse an anonymized Blob and check that every PII tag we said we
 * stripped is now either missing or contains only neutral padding bytes
 * (0x00 / 0x20 / numeric "0"). Kept tags are ignored.
 *
 * Returns { ok: false, warnings: [...] } if anything looks suspicious so
 * the caller can refuse to ship that file.
 */
async function verifyAnonymized(
  blob: Blob,
  keptLabels: string[],
  allowedPseudonyms?: Map<string, RegExp>,
): Promise<{ ok: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  const keptLabelSet = new Set(keptLabels);
  try {
    const u8 = new Uint8Array(await blob.arrayBuffer());
    const ds = dicomParser.parseDicom(u8);
    for (const tag of PII_TAGS) {
      // Skip intentionally-kept tags by LABEL (matches report.tagsKept entries).
      if (keptLabelSet.has(tag.label)) continue;
      const el = ds.elements[tag.key];
      if (!el || el.length === 0) continue;
      // Read string value — if it has any non-padding char, FAIL the test
      // unless an explicit pseudonym pattern accepts it.
      let val: string | undefined;
      try { val = ds.string(tag.key); } catch { val = undefined; }
      if (!val || val.trim().length === 0 || isPaddingOnly(val)) continue;
      const allowed = allowedPseudonyms?.get(tag.label);
      if (allowed && allowed.test(val)) continue;
      warnings.push(
        `Tag ${tag.label} (${tag.key}) still contains "${val.slice(0, 24)}"`,
      );
    }
  } catch (err) {
    warnings.push(
      `Self-test parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ok: false, warnings };
  }
  return { ok: warnings.length === 0, warnings };
}

function isPaddingOnly(s: string): boolean {
  // We treat zero, space, and DICOM date placeholders (00000000) as padding.
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== 0x00 && c !== 0x20 && c !== 0x30 /* '0' */) return false;
  }
  return true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function collectInstances(study: Study) {
  const out = [] as { sopInstanceUid: string; fileHandle: File }[];
  for (const ser of study.series) {
    for (const inst of ser.instances) {
      out.push({ sopInstanceUid: inst.sopInstanceUid, fileHandle: inst.fileHandle });
    }
  }
  return out;
}

async function fileHandleToBlob(f: File): Promise<Blob> {
  // File extends Blob; arrayBuffer→Blob detaches refs but here we don't
  // care about lifetime since the dicom-store hands us synthetic Files.
  return new Blob([await f.arrayBuffer()], { type: f.type || "application/dicom" });
}

/**
 * Pad byte for a given VR. Strings → ASCII space (0x20, legal trailing
 * pad per DICOM PS3.5). Dates / times / age strings → ASCII zero (0x30)
 * so "00000000" parses as a valid (sentinel) DA value. UIs that strictly
 * validate DA will at least see well-formed input.
 */
function paddingByteForVR(vr: PIITag["vr"]): number {
  switch (vr) {
    case "DA":
    case "TM":
    case "AS":
    case "IS":
      return 0x30; // '0'
    case "UI":
      return 0x00; // null pad — UI VR is NUL-padded per PS3.5
    default:
      return 0x20; // space — string VRs (PN, LO, SH, ST, CS)
  }
}

function writePaddedString(
  out: Uint8Array,
  offset: number,
  length: number,
  value: string,
  padByte: number,
): void {
  const enc = new TextEncoder();
  const bytes = enc.encode(value);
  const n = Math.min(bytes.length, length);
  for (let i = 0; i < n; i++) out[offset + i] = bytes[i];
  for (let i = n; i < length; i++) out[offset + i] = padByte;
}

function sanitizeForFilename(s: string): string {
  // SOP UIDs are dot-separated digits — already filename-safe — but defensive
  // strip in case future inputs include path separators.
  return s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
}

function shortStudyUid(uid: string): string {
  if (!uid) return "unknown";
  // Last 12 hex-ish chars — uniquely identifies the study without leaking
  // OID prefix structure across hospitals.
  return uid.replace(/[^A-Za-z0-9]/g, "").slice(-12);
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function stableHexHash(input: string, hexLen: number): string {
  // djb2-xor — same one used by parse-worker.ts so pseudonyms align.
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, hexLen);
}
