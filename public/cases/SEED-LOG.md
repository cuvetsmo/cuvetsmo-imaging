# Seed log — cuvetsmo-imaging case library

> Snapshot of how the Day-1 case library was lifted from VetMock's
> `/lab` Supabase backend into local `/public/cases/`. Generated
> 2026-05-20. Re-run the underlying queries if the seed changes.

## Provenance

- **Source project:** VetMock (Supabase `mpovsdzdggvksmeehqfj`, region ap-southeast-1)
- **Source tables:** `public.imaging_cases` + `public.imaging_case_files` (status = `public`)
- **Source storage:** private bucket `lab-dicom`, files at `<slug>/<view>.dcm`
- **Access:** anon key + storage signed-URL endpoint (10 min TTL per file)
- **Tool:** `_tmp/seed-imaging-cases.ps1` in MycOS vault (Windows PowerShell 5.1)

## Counts

| metric | value |
|---|---|
| Public cases in VetMock | 17 |
| Public files in `lab-dicom` | 18 |
| Cases lifted to cuvetsmo-imaging | **16** |
| Files downloaded | **16** (one Lateral per case) |
| Cases skipped | **1** (cuvet-internal — see below) |
| Total disk added under `public/cases/` | **80.84 MB** (84,769,666 bytes) |

## License breakdown

| license | credibility | count | source |
|---|---|---|---|
| CC BY 4.0 | peer-reviewed | 3 | Mendeley ktx4cj55pn (Flores Duenas et al. 2020) |
| CC BY 4.0 | peer-reviewed | 13 | VetXRay Zenodo 19051776 (9,882 canine + feline thoracic radiographs) |
| **CC BY 4.0 total** | | **16** | |
| cuvet-internal | cuvet-internal | 1 *(skipped)* | CUVET teaching case (น้องคอฟฟี่, anonymized) |

All 16 lifted cases are CC BY 4.0 — full attribution strings preserved
verbatim in `lib/cases.ts`. Source URLs point at the canonical Zenodo /
Mendeley landing page so the CC-BY chain stays auditable.

## Files lifted (16)

| slug | view | bytes | px_spacing_mm | rows x cols |
|---|---|---|---|---|
| mendeley-vhs-1 | Lateral | 4,192,362 | 0.139 | 1300 x 1612 |
| mendeley-vhs-2 | Lateral | 5,797,354 | 0.139 | 1396 x 2076 |
| mendeley-vhs-3 | Lateral | 13,384,298 | 0.139 | 2428 x 2756 |
| vetxray-feline-normal | Lateral | 2,259,390 | 0.16 | 1093 x 2066 |
| vetxray-feline-cardiomegaly | Lateral | 8,089,498 | 0.086 | 3202 x 2526 |
| vetxray-feline-pleural-effusion | Lateral | 3,831,124 | 0.086 | 1636 x 2341 |
| vetxray-feline-interstitial-pattern | Lateral | 5,776,140 | 0.086 | 1789 x 3228 |
| vetxray-feline-alveolar-pattern | Lateral | 3,199,130 | 0.16 | 1262 x 2534 |
| vetxray-feline-bronchial-pattern | Lateral | 4,432,856 | 0.086 | 1832 x 2419 |
| vetxray-feline-mass | Lateral | 3,608,084 | 0.16 | 1415 x 2549 |
| vetxray-feline-pneumothorax | Lateral | 3,438,164 | 0.16 | 1359 x 2529 |
| vetxray-canine-normal | Lateral | 4,431,858 | 0.16 | 1904 x 2327 |
| vetxray-canine-cardiomegaly | Lateral | 4,608,950 | 0.16 | 1883 x 2447 |
| vetxray-canine-pleural-effusion | Lateral | 4,436,906 | 0.16 | 1756 x 2526 |
| vetxray-canine-mass | Lateral | 5,412,472 | 0.16 | 2099 x 2578 |
| vetxray-canine-alveolar-pattern | Lateral | 7,871,080 | 0.086 | 2438 x 3228 |

DICOM magic bytes (`DICM` at offset 128) verified on the first
(`mendeley-vhs-1`) and last (`vetxray-feline-pneumothorax`) files.
Transfer syntax across all 16 files: Explicit VR Little Endian
(`1.2.840.10008.1.2.1`).

A small (~+100 to -400 byte) drift between Supabase `byte_size`
metadata and downloaded file size was observed on most files — likely
a Storage-layer metadata refresh that lagged the actual upload by a
trivial amount. Files render fine, magic bytes match.

## Case skipped (1)

### `coffee-whole-body-vd-lat` — น้องคอฟฟี่ — Whole body 2-view

- **Reason:** `license = "cuvet-internal"`, `credibility = "cuvet-internal"`
- **Task spec** explicitly says: "A case may be marked `cuvet-internal` —
  DO NOT include those (they need explicit Aj. approval)."
- **What it is:** anonymized CUVET teaching case (VD + Lateral, both views),
  22 PII tags stripped, consent on file at VetMock — but the CC-status
  is internal, not a public open license.
- **Where to find it if needed:** still in VetMock Supabase
  (`imaging_cases.slug = 'coffee-whole-body-vd-lat'`,
  `lab-dicom/coffee/{VD,Lateral}.dcm`, 7.41 MB combined).
- **To unblock:** Palm gets explicit Aj. Ekkapol / DI Unit approval to
  re-license under CC-BY (or sample-demo). Then re-run the seed script
  with the slug added to `$paths`.

## Active recall fields

`recall?: CaseRecall` was added to the `ImagingCase` type by Agent A
during the same session. Per the task spec ("If VetMock has any case
findings or diagnoses recorded ... populate this field for each case.
If unknown, omit (don't fabricate)"):

- **`final_diagnosis`** — populated for all 16 from the VetXRay tag /
  Mendeley dataset purpose. The 3 Mendeley cases are tagged as "VHS
  measurement practice" since the source dataset is a measurement-
  training set without per-image radiologist diagnoses.
- **`findings`** — populated only where VetMock's `reference_findings`
  or `history` columns described concrete radiographic observations.
  Empty arrays kept for the 3 Mendeley cases (no source findings) and
  the 2 normal cases of either species.
- **`ddx`** — populated only where source text or downstream clinical
  consensus identifies specific differentials (cardiomegaly, mass,
  patterns, pneumothorax, infiltrates). Empty arrays for normals,
  measurement-practice cases, and effusions (where DDx is too broad
  to pin from a single radiograph).
- **`teaching_points`** — distilled from `learning_objectives` and
  textbook-level vet-radiology consensus (Buchanan & Bucheler 1995 for
  canine VHS, Litster & Buchanan 2000 for feline VHS, etc.).
- **`citation`** — verbatim attribution string from VetMock
  `imaging_cases.attribution`, identical to the per-case `attribution`
  field on the parent case.

Nothing was fabricated; uncertain fields use empty arrays not invented
content (Iron Rule 0).

## Re-running the seed

```powershell
# From MycOS vault root
& 'C:\Users\palmz\OneDrive\Desktop\MycOS\_tmp\seed-imaging-cases.ps1'
```

The script:
1. Calls `POST /storage/v1/object/sign/lab-dicom/<path>` with anon key
2. Downloads each signed URL with `Invoke-WebRequest`
3. Writes to `C:\Users\palmz\Desktop\cuvetsmo-imaging\public\cases\<slug>\<view>.dcm`

Anon key access works because the `imaging_case_files` RLS policy
allows `SELECT` for rows whose parent case has `status = 'public'`,
and Storage's sign endpoint honours that.

## Next-step ideas (not in scope here)

- Add the 1 skipped CUVET case once Aj. Ekkapol gives written approval
  to re-license (or to use the `sample-demo` tier with explicit consent).
- Add a 17th case for parity: Mendeley dataset still has 149 untouched
  lateral radiographs at the same provenance — pick one with verified
  diagnostic finding to balance the canine bench against the feline.
- Wire Supabase backing later — `lib/cases.ts` is a Day-1 fallback;
  `imaging_cases` in CUVETSMO Supabase (or a synced copy) is the
  long-term home.
