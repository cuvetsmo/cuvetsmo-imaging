// study-organizer.ts — pure grouping/sort/summary for cuvetsmo-imaging Phase 4
//
// Takes a flat `DicomFileMeta[]` array from Agent B's worker pool and folds
// it into a Study → Series → Image tree. Functions are pure so Agent D's
// IndexedDB layer can persist the result without re-running the grouping,
// and so the logic is unit-testable without React.
//
// Sort contract (stable):
//   - Studies: acquisitionDate desc (newest first). Missing dates sink to
//     bottom. Equal-or-missing dates break tie with studyUid asc so order
//     is deterministic across reloads.
//   - Series: modality asc, then seriesDescription asc, then seriesUid asc.
//     Modality first because Palm's mental model is "X-ray together, CT
//     together" rather than "by description".
//   - Instances: sopInstanceUid asc. PACS-exported DICOM files often carry
//     numerically-suffixed UIDs (...1234.1, ...1234.2) so string compare
//     gives a natural acquisition order in practice.
//
// All sorts use `Array.prototype.sort` which is stable as of ES2019; we
// also do a single pre-sort pass per level rather than nested sorts
// (keeps it O(n log n) overall instead of O(n² log n)).

import type { DicomFileMeta } from './parse-types';

// Tree shape produced by `organizeIntoStudies`. Exported here (not in
// parse-types) because Agent C owns the grouping output; Agent B's
// worker pool only emits the flat `DicomFileMeta[]`.

/** One DICOM study — a clinical exam, identified by StudyInstanceUID. */
export interface Study {
  studyUid: string;
  patientId?: string;
  studyDescription?: string;
  acquisitionDate?: string;
  series: Series[];
}

/** One series within a study — typically one acquisition orientation. */
export interface Series {
  seriesUid: string;
  seriesDescription?: string;
  modality: string;
  instances: DicomFileMeta[];
}

// ── Grouping ─────────────────────────────────────────────────────────────

/**
 * Group a flat array of DICOM file metadata into Study → Series → Image
 * tree. Pure function — does not mutate input.
 *
 * - One Study per unique studyUid
 * - One Series per unique (studyUid, seriesUid) pair
 * - One instance per DicomFileMeta entry (no de-dup; caller's job)
 *
 * Empty input returns []. All metas with the same studyUid collapse into
 * a single Study with one or more Series.
 */
export function organizeIntoStudies(metas: DicomFileMeta[]): Study[] {
  if (!Array.isArray(metas) || metas.length === 0) return [];

  // First pass: bucket by studyUid → seriesUid → instances[]
  // Using a Map keeps insertion order, but we resort below so it doesn't
  // actually matter here.
  const studyMap = new Map<string, Map<string, DicomFileMeta[]>>();
  // Keep first-seen Study-level fields (patientId · studyDescription · date)
  // so we don't have to scan all instances of a study to render its summary.
  const studyHeader = new Map<string, {
    patientId?: string;
    studyDescription?: string;
    acquisitionDate?: string;
  }>();
  // Same for Series-level fields (seriesDescription · modality).
  const seriesHeader = new Map<string, {
    seriesDescription?: string;
    modality: string;
  }>();

  for (const meta of metas) {
    if (!meta || !meta.studyUid || !meta.seriesUid) continue;
    const sKey = meta.studyUid;
    const seKey = `${sKey}::${meta.seriesUid}`;

    if (!studyMap.has(sKey)) {
      studyMap.set(sKey, new Map());
      studyHeader.set(sKey, {
        patientId: meta.patientId,
        studyDescription: meta.studyDescription,
        acquisitionDate: meta.acquisitionDate,
      });
    } else {
      // Upgrade header if first entry was missing a field that this one has.
      // (PACS exports sometimes have inconsistent tags between instances.)
      const h = studyHeader.get(sKey)!;
      if (!h.patientId && meta.patientId) h.patientId = meta.patientId;
      if (!h.studyDescription && meta.studyDescription) h.studyDescription = meta.studyDescription;
      if (!h.acquisitionDate && meta.acquisitionDate) h.acquisitionDate = meta.acquisitionDate;
    }

    const sm = studyMap.get(sKey)!;
    if (!sm.has(meta.seriesUid)) {
      sm.set(meta.seriesUid, []);
      seriesHeader.set(seKey, {
        seriesDescription: meta.seriesDescription,
        modality: meta.modality || 'OT',
      });
    } else {
      const h = seriesHeader.get(seKey)!;
      if (!h.seriesDescription && meta.seriesDescription) h.seriesDescription = meta.seriesDescription;
      // Don't overwrite modality if already set; some PACS leave modality
      // blank on later instances.
      if ((!h.modality || h.modality === 'OT') && meta.modality && meta.modality !== 'OT') {
        h.modality = meta.modality;
      }
    }
    sm.get(meta.seriesUid)!.push(meta);
  }

  // Second pass: sort instances within series, then series within study,
  // then studies overall. Done in this order so the output tree is fully
  // stable before we return.
  const studies: Study[] = [];
  for (const [studyUid, sm] of studyMap) {
    const header = studyHeader.get(studyUid)!;
    const series: Series[] = [];
    for (const [seriesUid, instances] of sm) {
      const seKey = `${studyUid}::${seriesUid}`;
      const sh = seriesHeader.get(seKey)!;
      const sortedInstances = [...instances].sort(sortInstances);
      series.push({
        seriesUid,
        seriesDescription: sh.seriesDescription,
        modality: sh.modality,
        instances: sortedInstances,
      });
    }
    series.sort(sortSeries);
    studies.push({
      studyUid,
      patientId: header.patientId,
      studyDescription: header.studyDescription,
      acquisitionDate: header.acquisitionDate,
      series,
    });
  }
  studies.sort(sortStudies);
  return studies;
}

// ── Sort comparators ─────────────────────────────────────────────────────

function sortStudies(a: Study, b: Study): number {
  // Newest study first by acquisitionDate (YYYYMMDD raw DICOM string sorts
  // lexically the same as chronologically). Missing dates sink to bottom.
  const da = a.acquisitionDate || '';
  const db = b.acquisitionDate || '';
  if (da && !db) return -1;
  if (!da && db) return 1;
  if (da !== db) return db.localeCompare(da); // desc
  // Tie-break on studyUid for stable order across reloads.
  return a.studyUid.localeCompare(b.studyUid);
}

function sortSeries(a: Series, b: Series): number {
  // Modality first (groups DX together, CT together) then description.
  const ma = (a.modality || '').toUpperCase();
  const mb = (b.modality || '').toUpperCase();
  if (ma !== mb) return ma.localeCompare(mb);
  const da = a.seriesDescription || '';
  const db = b.seriesDescription || '';
  if (da !== db) return da.localeCompare(db);
  return a.seriesUid.localeCompare(b.seriesUid);
}

function sortInstances(a: DicomFileMeta, b: DicomFileMeta): number {
  return a.sopInstanceUid.localeCompare(b.sopInstanceUid);
}

// ── Study summary ────────────────────────────────────────────────────────

export interface StudySummary {
  studyUid: string;
  patientId?: string;
  description?: string;
  /** ISO-formatted YYYY-MM-DD if acquisitionDate was a valid YYYYMMDD,
   *  otherwise the raw value (or undefined). */
  date?: string;
  seriesCount: number;
  instanceCount: number;
  /** Most common modality across series (ties broken by first-seen). */
  primaryModality: string;
}

/**
 * Build a flat summary object for a Study — used by the card UI so it
 * doesn't have to recompute counts/modality on every render.
 */
export function studySummary(study: Study): StudySummary {
  let instanceCount = 0;
  const modalityCount = new Map<string, number>();
  for (const s of study.series) {
    instanceCount += s.instances.length;
    const m = (s.modality || 'OT').toUpperCase();
    modalityCount.set(m, (modalityCount.get(m) || 0) + s.instances.length);
  }

  // Pick the modality with the most instances. Ties → first inserted
  // (which is the first series after sort = alphabetically-first modality).
  let primary = 'OT';
  let max = -1;
  for (const [m, n] of modalityCount) {
    if (n > max) {
      max = n;
      primary = m;
    }
  }

  return {
    studyUid: study.studyUid,
    patientId: study.patientId,
    description: study.studyDescription,
    date: formatDicomDate(study.acquisitionDate),
    seriesCount: study.series.length,
    instanceCount,
    primaryModality: primary,
  };
}

// ── Date helpers ─────────────────────────────────────────────────────────

/**
 * Convert DICOM raw `YYYYMMDD` into `YYYY-MM-DD`. Returns undefined for
 * empty/null and the raw value unchanged if it doesn't match the 8-digit
 * pattern (e.g. some PACS export with hyphens or trailing time fields).
 */
export function formatDicomDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  // Strict YYYYMMDD
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  // Some PACS prepend the time as YYYYMMDDHHMMSS — slice front 8.
  if (/^\d{14}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  // Already-hyphenated YYYY-MM-DD passes through.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Fallback — return as-is. Don't fabricate a date.
  return s;
}

// ── Modality classification (matches CaseLibraryLocal palette) ───────────

export type ModalityKey = 'xray' | 'ct' | 'mri' | 'us' | 'other';

/**
 * Group DICOM modality codes into the same 5 buckets that
 * `CaseLibraryLocal` already uses for badge colors. Keeps the visual
 * language consistent across the Local-Imports section and the public
 * Case Library.
 */
export function modalityToKey(modality: string | undefined): ModalityKey {
  if (!modality) return 'other';
  const M = String(modality).toUpperCase().trim();
  if (['DX', 'CR', 'RG', 'RF', 'MG', 'PX', 'DR'].includes(M)) return 'xray';
  if (M === 'CT') return 'ct';
  if (M === 'MR') return 'mri';
  if (M === 'US') return 'us';
  return 'other';
}
