// anonymize.ts — Phase 5 (Agent ⓔ) + Phase 6 (Agent Ⓒ).
//
// Strip PII from persisted DICOM Blobs and pack the cleaned files into a
// downloadable ZIP. Designed to be called on whole studies from
// RecentImports without depending on the worker pool or Cornerstone.
//
// Phase 5 (Agent ⓔ) shipped the 22-tag top-level PII scrubber.
// Phase 6 (Agent Ⓒ) extends the scrubber to walk:
//   - Private DICOM blocks (group is ODD per PS3.5 §7.8.1 — manufacturer-
//     injected data slots that often carry PHI). Private Creator
//     declarations in the (gggg,0010–00FF) range are KEPT so other
//     software can still parse the file's private namespace.
//   - Nested sequences (VR='SQ' per PS3.5 §7.5). PHI hides in nested
//     DataSets — e.g. AccessionNumber inside RequestAttributesSequence,
//     OperatorIdentificationSequence, ContentSequence (DICOM SR / dose
//     reports / presentation states).
//
// Reference for the tag set:
//   - DICOM PS3.5 (Data Structures and Encoding) §7.5 sequences, §7.8 private
//   - DICOM PS3.15 Annex E (Basic Application Level Confidentiality)
//   - MycOS/knowledge/learnings/dicom-ingestion-pipeline.md  (Step 4 of the
//     project's canonical 22-tag list — re-cited inline in PII_TAGS)
//   - This module supersedes the older lib/dicom/anonymizer.js single-file
//     scrubber. Same byte-overwrite approach, study-level API + ZIP packer
//     on top, written in TS so the report types are exported.
//
// Approach (documented per agent spec):
//   1. Parse DICOM with dicom-parser (read-only — gives us per-element
//      dataOffset + length, plus `el.items[].dataSet` for SQ recursion).
//   2. Clone the original Uint8Array.
//   3. Walk the parsed dataset RECURSIVELY:
//        a. Any explicit PII tag (PII_TAGS_EXTENDED) → overwrite in place
//           with VR-appropriate padding.
//        b. Any private block element (odd group + element ≥ 0x0100) →
//           overwrite in place. Creator entries (element 0x0010–0x00FF)
//           are kept so the namespace declaration survives.
//        c. Any SQ element → recurse into `el.items[i].dataSet` (depth-
//           limited to prevent infinite loops if DICOM is malformed).
//      Element LENGTH is preserved everywhere so byte offsets stay
//      stable — we don't have to rebuild the dataset, and downstream
//      tools see a well-formed DICOM with blank value bytes.
//   4. (Iron Rule 0 self-test) Re-parse the OUTPUT bytes and run the
//      same recursive walk in verification mode — fail if any
//      non-creator private value still has non-padding bytes, or any
//      nested PII tag still has a real value.

import dicomParser, { type DataSet, type Element } from "dicom-parser";
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
  vr: "PN" | "LO" | "SH" | "DA" | "TM" | "AS" | "CS" | "ST" | "UI" | "IS" | "UT";
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

// ─── Phase 6: extended PII tags (Agent Ⓒ) ───────────────────────────────────
//
// PII_TAGS_EXTENDED augments the canonical Phase 5 set with tags that
// frequently appear in nested sequences (DICOM SR · dose reports ·
// presentation states · scheduled-procedure metadata) and that PACS
// vendors sometimes denormalize to top level. The recursive walker hits
// these in BOTH locations.
//
// | tag       | vr | reason                                                         |
// |-----------|----|----------------------------------------------------------------|
// | 0040,0006 | PN | ScheduledPerformingPhysicianName (appears in scheduled step)   |
// | 0018,1000 | LO | DeviceSerialNumber (links a study to a specific machine)       |
// | 0018,700A | SH | DetectorID (per-detector identifier — same risk class)         |
// | 0040,A730 | -- | ContentSequence (DICOM SR root — walked recursively, not zeroed) |
// | 0040,A160 | UT | TextValue (free-text SR content · always scrub · VR=UT)         |
//
// ContentSequence is intentionally NOT a value tag — its VR is 'SQ' and
// we list it for documentation only; the recursive sequence walker
// already covers it. Zeroing the sequence ITSELF (its container length
// header) would break parsers; we walk in and scrub the leaf TextValue /
// PName / etc. instead.
export const PII_TAGS_EXTENDED: readonly PIITag[] = [
  ...PII_TAGS,
  { key: "x00400006", label: "ScheduledPerformingPhysicianName", vr: "PN", group: "study" },
  { key: "x00181000", label: "DeviceSerialNumber", vr: "LO", group: "site" },
  { key: "x0018700a", label: "DetectorID", vr: "SH", group: "site" },
  { key: "x0040a160", label: "TextValue", vr: "UT", group: "free-text" },
  // NB: x0040a730 (ContentSequence) is VR='SQ' — handled by the recursive
  // sequence walker, NOT by the per-tag scrubber. Listed in the doc table
  // above for context; not included as a leaf-strip entry here.
] as const;

// Fast lookup keyed by dicom-parser's xGGGGEEEE string.
const PII_TAGS_EXTENDED_BY_KEY: ReadonlyMap<string, PIITag> = new Map(
  PII_TAGS_EXTENDED.map((t) => [t.key, t]),
);

// Tags we KEEP by default (Palm wants case labels in the UI). Toggle-able.
const DEFAULT_KEEP = new Set<string>(["x00081030", "x0008103e"]);

// ─── Phase 6 helpers: private-block tag parsing ──────────────────────────────
//
// dicom-parser keys are "xGGGGEEEE" lowercase hex. Per DICOM PS3.5 §7.8.1:
//   - Private elements live in ODD-numbered groups (group_number % 2 === 1).
//   - The (gggg,0010)…(gggg,00FF) elements are PRIVATE CREATOR declarations —
//     opaque LO strings that name the vendor namespace, e.g. "FUJI Sample".
//     We KEEP these by default so other software can still parse the file.
//   - The (gggg,XX10)…(gggg,XXFF) elements (where XX is the creator slot
//     number, 10–FF) are PRIVATE DATA. These often carry PHI in PACS
//     deployments (Toshiba/Canon/GE/Fuji all have known PHI fields here).
//
// We test the parity + element range by parsing the dicom-parser key
// directly — cheap string slice, no per-element regex.

function isOddGroup(key: string): boolean {
  // key = "xGGGGEEEE" — group = chars 1..5
  if (key.length < 9 || key[0] !== "x") return false;
  const groupLow = key.charCodeAt(4); // last hex of group
  // hex digits '0'..'9' = 0x30..0x39 ; 'a'..'f' = 0x61..0x66
  const v = groupLow >= 0x61 ? groupLow - 0x61 + 10 : groupLow - 0x30;
  return (v & 1) === 1;
}

function isPrivateCreator(key: string): boolean {
  // creator range is element 0010..00FF — characters 5..8 of "xGGGGEEEE"
  // Elements 0000..000F are reserved by the standard (not creators); we
  // treat them as private DATA conservatively (zero-fill).
  if (key.length < 9) return false;
  // Element high byte (positions 5..6) must be "00", low byte (7..8) must
  // be >= "10".
  if (key[5] !== "0" || key[6] !== "0") return false;
  const lowHi = key.charCodeAt(7);
  const lowLo = key.charCodeAt(8);
  const hi = lowHi >= 0x61 ? lowHi - 0x61 + 10 : lowHi - 0x30;
  const lo = lowLo >= 0x61 ? lowLo - 0x61 + 10 : lowLo - 0x30;
  const elemLow = (hi << 4) | lo;
  return elemLow >= 0x10; // 0x10..0xFF inclusive
}

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

  // ── Phase 6 additions ──────────────────────────────────────────────
  /**
   * Walk + scrub PRIVATE DICOM blocks (odd-group elements). Default true.
   * Manufacturer-specific tags routinely carry PHI in PACS deployments.
   */
  stripPrivateBlocks?: boolean;
  /**
   * Keep PRIVATE CREATOR declarations ((gggg,0010)…(gggg,00FF)). Default
   * true. These are LO strings naming the vendor namespace and are not
   * themselves PHI; keeping them lets other software still parse the
   * file's private data layout.
   */
  keepPrivateCreators?: boolean;
  /**
   * Recurse into nested sequences (VR='SQ'). Default true. PHI hides in
   * nested DataSets — see PII_TAGS_EXTENDED + the SR/dose/state notes
   * at the top of this module.
   */
  walkSequences?: boolean;
  /**
   * Max recursion depth for nested sequences. Default 8. DICOM SR can
   * legitimately nest deeply; 8 is a safe cap that still terminates
   * promptly on malformed cyclic-looking input.
   */
  recursionDepth?: number;
};

export type StrippedTag = {
  label: string;
  /** dicom-parser key. */
  key: string;
  /** Element length in bytes (what was overwritten). */
  bytes: number;
  /**
   * Phase 6: where the stripped element lived. "top-level" matches Phase 5
   * behavior; "sequence" was found inside a nested SQ item; "private"
   * was an odd-group manufacturer block.
   */
  kind?: "top-level" | "sequence" | "private";
  /** Phase 6: depth in the SQ tree (0 = top-level). */
  depth?: number;
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
 * Strategy: parse for offsets/lengths, clone the byte array, then run a
 * RECURSIVE walk over the parsed tree:
 *   - Known PII tags (PII_TAGS_EXTENDED) → overwrite per-VR padding.
 *   - Private blocks (odd-group elements) → overwrite, keep creator
 *     declarations if `keepPrivateCreators` (default true).
 *   - Sequences (VR='SQ') → recurse into `el.items[i].dataSet`, depth-
 *     limited by `recursionDepth` (default 8).
 *
 * Element length is preserved everywhere so the outer DICOM framing
 * (group/element/length headers, transfer syntax, sequence delimiters)
 * stays valid for every downstream tool.
 *
 * Trade-off: we DO NOT write a meaningful replacement string (no "ANON" /
 * "REDACTED" tokens). DICOM VR rules differ per tag (PN has component
 * delimiters, DA wants YYYYMMDD, AS wants nnnD/W/M/Y, CS is constrained
 * vocab, IS is integer-as-string). Writing wrong-VR bytes risks rejection
 * by strict viewers. Pure space/zero-fill is universally legal (DICOM
 * treats trailing 0x20 as padding for string VRs and "00000000" is a
 * valid placeholder date), so it survives every parser. For private
 * blocks (unknown VR) we use 0x00 — also universally safe.
 */
export async function anonymizeDicomBlob(
  blob: Blob,
  opts: AnonymizationOptions = {},
): Promise<{ blob: Blob; report: AnonymizationReport }> {
  const keep = new Set<string>(DEFAULT_KEEP);
  if (opts.keepStudyDescription === false) keep.delete("x00081030");
  if (opts.keepSeriesDescription === false) keep.delete("x0008103e");

  // Phase 6 option defaults — all backward-compatible (true / 8).
  const stripPrivateBlocks = opts.stripPrivateBlocks !== false;
  const keepPrivateCreators = opts.keepPrivateCreators !== false;
  const walkSequences = opts.walkSequences !== false;
  const maxDepth = Math.max(0, Math.min(32, opts.recursionDepth ?? 8));

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
  const seenStrippedKeys = new Set<string>();
  const visitedDataSets = new WeakSet<DataSet>();

  // ── Recursive walk ──────────────────────────────────────────────────
  scrubDataSet(dataSet, out, 0, {
    keep,
    keepPrivateCreators,
    stripPrivateBlocks,
    walkSequences,
    maxDepth,
    patientIdHashSeed: opts.patientIdHashSeed,
    stripped,
    kept,
    seenStrippedKeys,
    visitedDataSets,
  });

  // ── Phase 5 compat: which expected top-level tags weren't present ──
  for (const tag of PII_TAGS) {
    if (!dataSet.elements[tag.key]) notFound.push(tag.label);
  }

  // Build the Blob from a fresh ArrayBuffer to dodge TS lib.dom
  // strict-typing around Uint8Array<ArrayBufferLike> vs BlobPart. Casting
  // through `as unknown as BlobPart` would also work — copying is cleaner
  // and trivially cheap relative to the surrounding parse cost.
  const outBlob = new Blob([toFreshArrayBuffer(out)], { type: "application/dicom" });

  // ── Iron Rule 0 self-test ────────────────────────────────────────────
  // Re-parse the OUTPUT and run the same recursive walk in VERIFY mode.
  // PatientID under a hash seed is allowed to contain the `pt-XXXXXXXX`
  // pseudonym — that's anonymized, not leaked.
  const allowedPseudonyms = new Map<string, RegExp>();
  if (opts.patientIdHashSeed) {
    allowedPseudonyms.set("PatientID", /^\s*pt-[0-9a-f]{1,16}\s*$/);
  }
  const { ok, warnings } = await verifyAnonymized(
    outBlob,
    kept,
    allowedPseudonyms,
    {
      stripPrivateBlocks,
      keepPrivateCreators,
      walkSequences,
      maxDepth,
    },
  );

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

// ─── Recursive walker (Phase 6) ──────────────────────────────────────────────

type ScrubCtx = {
  keep: Set<string>;
  keepPrivateCreators: boolean;
  stripPrivateBlocks: boolean;
  walkSequences: boolean;
  maxDepth: number;
  patientIdHashSeed: string | undefined;
  stripped: StrippedTag[];
  kept: string[];
  seenStrippedKeys: Set<string>;
  /**
   * Cycle guard: if a malformed file builds a graph rather than a tree,
   * we don't want to recurse forever. WeakSet of visited DataSet objects.
   */
  visitedDataSets: WeakSet<DataSet>;
};

/**
 * Walk every element of `dataSet`. For each element decide one of:
 *   1. KEEP it (intentionally kept tag, or private creator declaration).
 *   2. SCRUB its value bytes (PII tag or private data).
 *   3. RECURSE into it (SQ — Sequence of Items).
 *
 * The byte writes go into `out` so the caller can repackage the final
 * file as a single Blob with all changes applied. We never resize an
 * element — preserving length keeps offsets stable.
 */
function scrubDataSet(
  dataSet: DataSet,
  out: Uint8Array,
  depth: number,
  ctx: ScrubCtx,
): void {
  if (ctx.visitedDataSets.has(dataSet)) return;
  ctx.visitedDataSets.add(dataSet);

  // dicom-parser elements is a plain object keyed by xGGGGEEEE. We don't
  // need a hasOwnProperty guard — it has no prototype-chain noise.
  const elements = dataSet.elements;
  for (const key in elements) {
    const el = elements[key];
    if (!el) continue;

    // ── 1. SEQUENCE — recurse, never overwrite the container bytes ──
    // The container's dataOffset/length covers the item delimiters; we
    // must not touch those or the file will fail to re-parse. We walk
    // INTO the items and scrub leaves there.
    if (ctx.walkSequences && el.vr === "SQ" && Array.isArray(el.items)) {
      if (depth + 1 > ctx.maxDepth) continue;
      for (const item of el.items) {
        if (item?.dataSet) {
          scrubDataSet(item.dataSet, out, depth + 1, ctx);
        }
      }
      continue;
    }

    // ── 2. PRIVATE BLOCKS — odd-group elements ─────────────────────
    if (ctx.stripPrivateBlocks && isOddGroup(key)) {
      // Private creator declarations: (gggg,0010)..(gggg,00FF). Keep
      // unless caller explicitly opted out.
      if (ctx.keepPrivateCreators && isPrivateCreator(key)) {
        if (!ctx.kept.includes("PrivateCreator")) ctx.kept.push("PrivateCreator");
        continue;
      }
      // Private DATA: zero-fill the value. Length preserved. Don't
      // touch elements with no body (length 0).
      if (el.length > 0 && !isSqOrPixelData(el, key)) {
        fillRange(out, el.dataOffset, el.length, 0x00);
        recordStripped(ctx, {
          label: `Private ${key.toUpperCase().slice(1, 5)},${key.toUpperCase().slice(5)}`,
          key,
          bytes: el.length,
          kind: "private",
          depth,
        });
      }
      continue;
    }

    // ── 3. KNOWN PII TAGS — Phase 5 + extended set ─────────────────
    const tag = PII_TAGS_EXTENDED_BY_KEY.get(key);
    if (!tag) continue;

    if (ctx.keep.has(tag.key)) {
      if (!ctx.kept.includes(tag.label)) ctx.kept.push(tag.label);
      continue;
    }
    if (el.length === 0) continue; // nothing to overwrite

    // PatientID + hash seed → deterministic pseudonym.
    if (
      tag.key === "x00100020" &&
      ctx.patientIdHashSeed &&
      el.length >= 11
    ) {
      let raw = "";
      try { raw = dataSet.string("x00100020") ?? ""; } catch { /* binary */ }
      const token = `pt-${stableHexHash(`${ctx.patientIdHashSeed}|${raw}`, 8)}`;
      writePaddedString(out, el.dataOffset, el.length, token, 0x20);
      recordStripped(ctx, {
        label: tag.label,
        key: tag.key,
        bytes: el.length,
        kind: depth === 0 ? "top-level" : "sequence",
        depth,
      });
      continue;
    }

    // Default: per-VR padding.
    const padByte = paddingByteForVR(tag.vr);
    fillRange(out, el.dataOffset, el.length, padByte);
    recordStripped(ctx, {
      label: tag.label,
      key: tag.key,
      bytes: el.length,
      kind: depth === 0 ? "top-level" : "sequence",
      depth,
    });
  }
}

function recordStripped(ctx: ScrubCtx, entry: StrippedTag): void {
  // Per-(key,depth) dedup so re-encountering the same nested key in a
  // multi-item sequence still aggregates cleanly without exploding the
  // report. We log each unique (label,depth) once.
  const dedupKey = `${entry.key}@${entry.depth ?? 0}`;
  if (ctx.seenStrippedKeys.has(dedupKey)) return;
  ctx.seenStrippedKeys.add(dedupKey);
  ctx.stripped.push(entry);
}

function fillRange(out: Uint8Array, offset: number, length: number, byte: number): void {
  // Defensive bounds check — a malformed DICOM could claim a length that
  // overruns the buffer. We'd rather no-op than corrupt unrelated bytes.
  const end = Math.min(out.length, offset + length);
  for (let i = offset; i < end; i++) out[i] = byte;
}

/**
 * Defensive check: don't try to overwrite a sequence container or the
 * pixel-data element if they happen to land in a private group. Pixel
 * data lives at (7FE0,0010) which is even-group so this almost never
 * fires, but better safe than corrupting an image.
 */
function isSqOrPixelData(el: Element, key: string): boolean {
  if (el.vr === "SQ") return true;
  if (key === "x7fe00010") return true;
  // dicom-parser sets encapsulatedPixelData on fragmented JPEG/JPEG2000 etc.
  if (el.encapsulatedPixelData) return true;
  return false;
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
 * Re-parse an anonymized Blob and recursively check that:
 *   - Every PII tag (Phase 5 + Phase 6 extended set) we said we stripped
 *     is now either missing or contains only neutral padding bytes
 *     (0x00 / 0x20 / numeric "0"). Kept tags are ignored.
 *   - Every PRIVATE non-creator element contains only padding bytes
 *     (when stripPrivateBlocks was on).
 *   - Nested sequences are walked too — leaked PHI in a nested SR
 *     ContentSequence would otherwise pass a top-level-only check.
 *
 * Returns { ok: false, warnings: [...] } if anything looks suspicious so
 * the caller can refuse to ship that file.
 */
type VerifyOpts = {
  stripPrivateBlocks: boolean;
  keepPrivateCreators: boolean;
  walkSequences: boolean;
  maxDepth: number;
};

async function verifyAnonymized(
  blob: Blob,
  keptLabels: string[],
  allowedPseudonyms?: Map<string, RegExp>,
  vopts?: VerifyOpts,
): Promise<{ ok: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  const keptLabelSet = new Set(keptLabels);
  const stripPrivateBlocks = vopts?.stripPrivateBlocks !== false;
  const keepPrivateCreators = vopts?.keepPrivateCreators !== false;
  const walkSequences = vopts?.walkSequences !== false;
  const maxDepth = vopts?.maxDepth ?? 8;
  try {
    const u8 = new Uint8Array(await blob.arrayBuffer());
    const ds = dicomParser.parseDicom(u8);
    const visited = new WeakSet<DataSet>();
    verifyDataSet(ds, 0, {
      keptLabelSet,
      allowedPseudonyms,
      stripPrivateBlocks,
      keepPrivateCreators,
      walkSequences,
      maxDepth,
      warnings,
      visited,
    });
  } catch (err) {
    warnings.push(
      `Self-test parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ok: false, warnings };
  }
  return { ok: warnings.length === 0, warnings };
}

type VerifyCtx = {
  keptLabelSet: Set<string>;
  allowedPseudonyms?: Map<string, RegExp>;
  stripPrivateBlocks: boolean;
  keepPrivateCreators: boolean;
  walkSequences: boolean;
  maxDepth: number;
  warnings: string[];
  visited: WeakSet<DataSet>;
};

function verifyDataSet(ds: DataSet, depth: number, ctx: VerifyCtx): void {
  if (ctx.visited.has(ds)) return;
  ctx.visited.add(ds);

  // 1. Check known PII tags at this level.
  for (const tag of PII_TAGS_EXTENDED) {
    if (ctx.keptLabelSet.has(tag.label)) continue;
    const el = ds.elements[tag.key];
    if (!el || el.length === 0) continue;
    let val: string | undefined;
    try { val = ds.string(tag.key); } catch { val = undefined; }
    if (!val || val.trim().length === 0 || isPaddingOnly(val)) continue;
    const allowed = ctx.allowedPseudonyms?.get(tag.label);
    if (allowed && allowed.test(val)) continue;
    ctx.warnings.push(
      `Tag ${tag.label} (${tag.key}) still contains "${val.slice(0, 24)}" at depth ${depth}`,
    );
  }

  // 2. Check private blocks for residual non-padding bytes.
  if (ctx.stripPrivateBlocks) {
    for (const key in ds.elements) {
      if (!isOddGroup(key)) continue;
      if (ctx.keepPrivateCreators && isPrivateCreator(key)) continue;
      const el = ds.elements[key];
      if (!el || el.length === 0) continue;
      if (el.vr === "SQ") continue; // walked separately
      if (!hasNonPaddingBytes(ds.byteArray, el.dataOffset, el.length)) continue;
      ctx.warnings.push(
        `Private element ${key} still has non-padding bytes (len=${el.length}) at depth ${depth}`,
      );
    }
  }

  // 3. Recurse into sequences.
  if (!ctx.walkSequences) return;
  if (depth + 1 > ctx.maxDepth) return;
  for (const key in ds.elements) {
    const el = ds.elements[key];
    if (!el || el.vr !== "SQ" || !Array.isArray(el.items)) continue;
    for (const item of el.items) {
      if (item?.dataSet) verifyDataSet(item.dataSet, depth + 1, ctx);
    }
  }
}

function isPaddingOnly(s: string): boolean {
  // We treat zero, space, and DICOM date placeholders (00000000) as padding.
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== 0x00 && c !== 0x20 && c !== 0x30 /* '0' */) return false;
  }
  return true;
}

/**
 * Byte-level non-padding check for private elements where we can't rely
 * on `ds.string(...)` (unknown VR — could be binary or string). We
 * accept 0x00, 0x20 (space), and 0x30 ('0') as padding. ANY other byte
 * means the strip leaked.
 */
function hasNonPaddingBytes(
  buf: { [i: number]: number; length: number },
  offset: number,
  length: number,
): boolean {
  const end = Math.min(buf.length, offset + length);
  for (let i = offset; i < end; i++) {
    const c = buf[i];
    if (c !== 0x00 && c !== 0x20 && c !== 0x30) return true;
  }
  return false;
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
