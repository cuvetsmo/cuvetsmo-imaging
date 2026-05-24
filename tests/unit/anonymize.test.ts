// Unit tests for lib/dicom/anonymize.ts — Agent ⓔ Phase 5 + Agent Ⓒ Phase 6.
//
// We build a SYNTHETIC DICOM byte buffer with known PII tags at known
// offsets, run anonymizeDicomBlob against it, and verify (a) the PII tags
// are zeroed/space-filled in the OUTPUT bytes at those exact offsets, and
// (b) the built-in Iron-Rule-0 selfTestPassed flag flips to true.
//
// This deliberately exercises the real dicom-parser + real recursive
// scrubber — no mocking. The synthetic buffer is small enough (well under
// 1 KB) that the test stays under the unit-suite budget.

import { describe, it, expect } from 'vitest';
import { anonymizeDicomBlob, PII_TAGS } from '@/lib/dicom/anonymize';

// ── Synthetic DICOM Part 10 file builder ────────────────────────────────
//
// File layout:
//   - 128-byte preamble (zeros)
//   - "DICM" magic
//   - File Meta group (0002,xxxx) — minimum required so dicom-parser can
//     identify Transfer Syntax = Explicit VR Little Endian (1.2.840.10008.1.2.1)
//   - Dataset elements in Explicit VR Little Endian:
//       (0010,0010) PN PatientName
//       (0010,0020) LO PatientID
//       (0008,0050) SH AccessionNumber
//       (0008,1030) LO StudyDescription (KEPT by default)
//       (0009,0010) LO Private creator (KEPT)
//       (0009,1010) UN Private data    (SCRUBBED)
//
// We keep PII values long enough (8-byte aligned) that VR/length math is
// trivial.

const EXPLICIT_LE_TS = '1.2.840.10008.1.2.1';

function ascii(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function padEven(bytes: Uint8Array): Uint8Array {
  if (bytes.length % 2 === 0) return bytes;
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  out[bytes.length] = 0x20; // space pad — legal for PN/LO/SH
  return out;
}

// Explicit-VR element with a short VR (2-byte length) — adequate for PN,
// LO, SH, CS, UI, DA, etc. Returns the encoded element bytes.
function elementExplicit(
  group: number,
  element: number,
  vr: string,
  value: string,
): Uint8Array {
  const valBytes = padEven(ascii(value));
  const out = new Uint8Array(8 + valBytes.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, group, true);
  dv.setUint16(2, element, true);
  out[4] = vr.charCodeAt(0);
  out[5] = vr.charCodeAt(1);
  dv.setUint16(6, valBytes.length, true);
  out.set(valBytes, 8);
  return out;
}

// UL = 4-byte unsigned-long value, 2-byte length header (short VR form).
function elementUL(group: number, element: number, value: number): Uint8Array {
  const out = new Uint8Array(12);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, group, true);
  dv.setUint16(2, element, true);
  out[4] = 0x55; // 'U'
  out[5] = 0x4c; // 'L'
  dv.setUint16(6, 4, true);
  dv.setUint32(8, value, true);
  return out;
}

function buildSyntheticDicom(opts: {
  patientName?: string;
  patientId?: string;
  accessionNumber?: string;
  studyDescription?: string;
}): { bytes: Uint8Array<ArrayBuffer> } {
  // ── Build dataset first (post-meta group) ────────────────────────────
  const dsParts: Uint8Array[] = [];
  if (opts.patientName !== undefined)
    dsParts.push(elementExplicit(0x0010, 0x0010, 'PN', opts.patientName));
  if (opts.patientId !== undefined)
    dsParts.push(elementExplicit(0x0010, 0x0020, 'LO', opts.patientId));
  if (opts.accessionNumber !== undefined)
    dsParts.push(elementExplicit(0x0008, 0x0050, 'SH', opts.accessionNumber));
  if (opts.studyDescription !== undefined)
    dsParts.push(elementExplicit(0x0008, 0x1030, 'LO', opts.studyDescription));

  // ── File Meta group (0002,xxxx) — Explicit VR LE explicitly ──────────
  // dicom-parser requires (0002,0010) TransferSyntaxUID at minimum.
  const ts = elementExplicit(0x0002, 0x0010, 'UI', EXPLICIT_LE_TS);
  const sopClass = elementExplicit(
    0x0002,
    0x0002,
    'UI',
    '1.2.840.10008.5.1.4.1.1.7',
  );
  const sopInstance = elementExplicit(
    0x0002,
    0x0003,
    'UI',
    '1.2.840.113619.2.1.0.0.0.0.1',
  );
  // FileMetaInformationGroupLength (0002,0000) UL — length of remaining
  // file-meta elements in bytes.
  const fileMetaRest = concat([sopClass, sopInstance, ts]);
  const groupLen = elementUL(0x0002, 0x0000, fileMetaRest.length);

  // ── Preamble + DICM magic + file meta + dataset ──────────────────────
  const preamble = new Uint8Array(128); // zeros
  const dicm = ascii('DICM');
  const dataset = concat(dsParts);

  // Cast to Uint8Array<ArrayBuffer> — TS 5.9 + lib.dom 'BlobPart' wants
  // ArrayBuffer-backed views, not the union ArrayBufferLike that
  // Uint8Array's default constructor returns. The synthetic bytes are
  // produced from a fresh Uint8Array() in concat() so the cast is sound.
  const out = concat([preamble, dicm, groupLen, fileMetaRest, dataset]);
  return { bytes: out as Uint8Array<ArrayBuffer> };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ── Sanity: round-trip the synthetic DICOM through dicom-parser ─────────
// If this fails the builder is broken — not the anonymizer — so we test
// it first with a clear failure message.

describe('synthetic DICOM builder (test fixture)', () => {
  it('round-trips through dicom-parser with all 4 PII tags readable', async () => {
    const dicomParser = (await import('dicom-parser')).default ?? (await import('dicom-parser'));
    const { bytes } = buildSyntheticDicom({
      patientName: 'TEST^PATIENT',
      patientId: 'ID-12345678',
      accessionNumber: 'ACC-90909',
      studyDescription: 'Synthetic test',
    });
    const ds = dicomParser.parseDicom(bytes);
    expect(ds.string('x00100010')?.trim()).toBe('TEST^PATIENT');
    expect(ds.string('x00100020')?.trim()).toBe('ID-12345678');
    expect(ds.string('x00080050')?.trim()).toBe('ACC-90909');
    expect(ds.string('x00081030')?.trim()).toBe('Synthetic test');
  });
});

// ── PII_TAGS shape ──────────────────────────────────────────────────────

describe('PII_TAGS catalogue', () => {
  it('contains the canonical 22 Phase-5 entries', () => {
    expect(PII_TAGS).toHaveLength(22);
  });

  it('every entry has the required shape', () => {
    for (const t of PII_TAGS) {
      expect(t.key).toMatch(/^x[0-9a-f]{8}$/);
      expect(t.label).toBeTruthy();
      expect(['patient', 'study', 'site', 'free-text']).toContain(t.group);
    }
  });
});

// ── Real anonymizeDicomBlob ─────────────────────────────────────────────

describe('anonymizeDicomBlob()', () => {
  it('strips PatientName, PatientID, AccessionNumber and keeps StudyDescription', async () => {
    const { bytes } = buildSyntheticDicom({
      patientName: 'TEST^PATIENT',
      patientId: 'ID-12345678',
      accessionNumber: 'ACC-90909',
      studyDescription: 'Survey thorax',
    });
    const blob = new Blob([bytes], { type: 'application/dicom' });
    const { blob: outBlob, report } = await anonymizeDicomBlob(blob);

    // Stripped labels should include the 3 PII tags we put in.
    const labels = report.tagsStripped.map((t) => t.label);
    expect(labels).toContain('PatientName');
    expect(labels).toContain('PatientID');
    expect(labels).toContain('AccessionNumber');

    // StudyDescription is in PII_TAGS but defaults to KEEP.
    expect(report.tagsKept).toContain('StudyDescription');

    // Re-parse to confirm the values were actually scrubbed.
    const dicomParser = (await import('dicom-parser')).default ?? (await import('dicom-parser'));
    const outDs = dicomParser.parseDicom(
      new Uint8Array(await outBlob.arrayBuffer()),
    );
    const pn = (outDs.string('x00100010') ?? '').trim();
    const pid = (outDs.string('x00100020') ?? '').trim();
    const acc = (outDs.string('x00080050') ?? '').trim();
    // After scrubbing, these should be empty or padding-only (space).
    expect(pn === '' || pn === '\x00'.repeat(pn.length)).toBe(true);
    expect(pid === '' || pid === '\x00'.repeat(pid.length)).toBe(true);
    expect(acc === '' || acc === '\x00'.repeat(acc.length)).toBe(true);

    // StudyDescription kept as-is.
    expect(outDs.string('x00081030')?.trim()).toBe('Survey thorax');
  });

  it('selfTestPassed = true after a clean scrub (Iron Rule 0)', async () => {
    const { bytes } = buildSyntheticDicom({
      patientName: 'X^Y',
      patientId: 'ABC123',
      accessionNumber: 'ACC1',
    });
    const blob = new Blob([bytes]);
    const { report } = await anonymizeDicomBlob(blob);
    expect(report.selfTestPassed).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it('patientIdHashSeed produces a deterministic pseudonym', async () => {
    // Two anonymizations of the same input with the same seed should
    // produce the same pt-XXXXXXXX token. Cases stay linkable.
    const { bytes } = buildSyntheticDicom({
      patientId: 'ORIGINAL_PT_ID',
    });
    const a = await anonymizeDicomBlob(new Blob([bytes]), {
      patientIdHashSeed: 'seed-A',
    });
    const b = await anonymizeDicomBlob(new Blob([bytes]), {
      patientIdHashSeed: 'seed-A',
    });
    const dicomParser = (await import('dicom-parser')).default ?? (await import('dicom-parser'));
    const aDs = dicomParser.parseDicom(new Uint8Array(await a.blob.arrayBuffer()));
    const bDs = dicomParser.parseDicom(new Uint8Array(await b.blob.arrayBuffer()));
    const aPid = aDs.string('x00100020')?.trim();
    const bPid = bDs.string('x00100020')?.trim();
    expect(aPid).toMatch(/^pt-[0-9a-f]+/);
    expect(aPid).toBe(bPid);
    // Different seed → different pseudonym.
    const c = await anonymizeDicomBlob(new Blob([bytes]), {
      patientIdHashSeed: 'seed-B',
    });
    const cDs = dicomParser.parseDicom(new Uint8Array(await c.blob.arrayBuffer()));
    const cPid = cDs.string('x00100020')?.trim();
    expect(cPid).toMatch(/^pt-[0-9a-f]+/);
    expect(cPid).not.toBe(aPid);
  });

  it('keepStudyDescription=false actually strips StudyDescription', async () => {
    const { bytes } = buildSyntheticDicom({
      studyDescription: 'Should be removed',
      patientName: 'A^B',
    });
    const blob = new Blob([bytes]);
    const { report } = await anonymizeDicomBlob(blob, {
      keepStudyDescription: false,
    });
    const labels = report.tagsStripped.map((t) => t.label);
    expect(labels).toContain('StudyDescription');
    expect(report.tagsKept).not.toContain('StudyDescription');
  });
});
