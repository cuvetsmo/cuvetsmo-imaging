// Unit tests for lib/dicom/study-organizer.ts — Agent 🅲 Phase 4.
//
// Pure grouping/sort/summary over a flat DicomFileMeta[]. No worker or
// IndexedDB touched here — just the deterministic tree shape.

import { describe, it, expect } from 'vitest';
import {
  organizeIntoStudies,
  studySummary,
  formatDicomDate,
  modalityToKey,
} from '@/lib/dicom/study-organizer';
import type { DicomFileMeta } from '@/lib/dicom/parse-types';

function meta(partial: Partial<DicomFileMeta>): DicomFileMeta {
  // Provide just enough to satisfy the type — fileHandle isn't read by
  // study-organizer, so a stub File works.
  return {
    fileHandle: new File([], partial.sopInstanceUid ?? 'f.dcm'),
    studyUid: 'study-1',
    seriesUid: 'series-1',
    sopInstanceUid: 'sop-1',
    modality: 'CR',
    parsedAt: Date.now(),
    ...partial,
  };
}

describe('organizeIntoStudies()', () => {
  it('empty input → empty array', () => {
    expect(organizeIntoStudies([])).toEqual([]);
  });

  it('3 instances · same studyUid + seriesUid → 1 study, 1 series, 3 instances', () => {
    const metas: DicomFileMeta[] = [
      meta({ sopInstanceUid: 'a' }),
      meta({ sopInstanceUid: 'b' }),
      meta({ sopInstanceUid: 'c' }),
    ];
    const studies = organizeIntoStudies(metas);
    expect(studies).toHaveLength(1);
    expect(studies[0].series).toHaveLength(1);
    expect(studies[0].series[0].instances).toHaveLength(3);
    // Instances sorted by sopInstanceUid asc.
    expect(studies[0].series[0].instances.map((i) => i.sopInstanceUid)).toEqual(
      ['a', 'b', 'c'],
    );
  });

  it('4 instances across 2 studies → 2 studies sorted by acquisitionDate desc', () => {
    const metas: DicomFileMeta[] = [
      meta({ studyUid: 's-old', sopInstanceUid: 'o1', acquisitionDate: '20240101' }),
      meta({ studyUid: 's-old', sopInstanceUid: 'o2', acquisitionDate: '20240101' }),
      meta({ studyUid: 's-new', sopInstanceUid: 'n1', acquisitionDate: '20260101' }),
      meta({ studyUid: 's-new', sopInstanceUid: 'n2', acquisitionDate: '20260101' }),
    ];
    const studies = organizeIntoStudies(metas);
    expect(studies).toHaveLength(2);
    expect(studies[0].studyUid).toBe('s-new'); // newer first
    expect(studies[1].studyUid).toBe('s-old');
  });

  it('groups by seriesUid within a study and sorts series by modality', () => {
    const metas: DicomFileMeta[] = [
      meta({ seriesUid: 'se-ct', modality: 'CT' }),
      meta({ seriesUid: 'se-cr', modality: 'CR' }),
    ];
    const studies = organizeIntoStudies(metas);
    expect(studies[0].series).toHaveLength(2);
    expect(studies[0].series[0].modality).toBe('CR'); // CR before CT
    expect(studies[0].series[1].modality).toBe('CT');
  });

  it('skips metas with missing studyUid or seriesUid (defensive)', () => {
    const metas = [
      meta({ studyUid: '', sopInstanceUid: 'bad' }),
      meta({ sopInstanceUid: 'ok' }),
    ];
    const studies = organizeIntoStudies(metas);
    expect(studies).toHaveLength(1);
    expect(studies[0].series[0].instances).toHaveLength(1);
  });
});

describe('studySummary()', () => {
  it('builds counts + primary modality from a study tree', () => {
    const metas: DicomFileMeta[] = [
      meta({ seriesUid: 'a', modality: 'CR', sopInstanceUid: 'a1' }),
      meta({ seriesUid: 'a', modality: 'CR', sopInstanceUid: 'a2' }),
      meta({ seriesUid: 'b', modality: 'CT', sopInstanceUid: 'b1' }),
      meta({ acquisitionDate: '20260524', sopInstanceUid: 'c1' }),
    ];
    const study = organizeIntoStudies(metas)[0];
    const summary = studySummary(study);
    expect(summary.seriesCount).toBe(study.series.length);
    expect(summary.instanceCount).toBe(4);
    // Whatever modality occurs most often wins.
    expect(['CR', 'CT']).toContain(summary.primaryModality);
  });
});

describe('formatDicomDate()', () => {
  it('YYYYMMDD → YYYY-MM-DD', () => {
    expect(formatDicomDate('20260524')).toBe('2026-05-24');
  });
  it('YYYYMMDDHHMMSS → YYYY-MM-DD (strip time)', () => {
    expect(formatDicomDate('20260524123000')).toBe('2026-05-24');
  });
  it('already hyphenated passes through', () => {
    expect(formatDicomDate('2026-05-24')).toBe('2026-05-24');
  });
  it('empty/undefined → undefined', () => {
    expect(formatDicomDate(undefined)).toBeUndefined();
    expect(formatDicomDate('')).toBeUndefined();
  });
});

describe('modalityToKey()', () => {
  it('groups DX/CR/RG into xray bucket', () => {
    expect(modalityToKey('DX')).toBe('xray');
    expect(modalityToKey('CR')).toBe('xray');
    expect(modalityToKey('RG')).toBe('xray');
  });
  it('CT → ct, MR → mri, US → us', () => {
    expect(modalityToKey('CT')).toBe('ct');
    expect(modalityToKey('MR')).toBe('mri');
    expect(modalityToKey('US')).toBe('us');
  });
  it('unknown / undefined → other', () => {
    expect(modalityToKey(undefined)).toBe('other');
    expect(modalityToKey('OT')).toBe('other');
    expect(modalityToKey('UNKNOWN')).toBe('other');
  });
});
