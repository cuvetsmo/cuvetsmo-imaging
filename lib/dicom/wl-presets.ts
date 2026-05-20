// Window/Level (W/L) clinical presets for DICOM viewing.
//
// Values follow textbook radiology practice for CT data calibrated
// in Hounsfield Units (HU). When the underlying DICOM has
// RescaleSlope/Intercept set (typical for CT Image Storage), the
// pixel values are mapped to HU and these presets apply correctly.
// For uncalibrated radiographs (raw 12-bit DR pixel values), the
// "Auto" P1-P99 quantile path produces a better default — manual
// presets may look high-contrast/dark on raw radiographs, which is
// expected; the cheatsheet documents this trade-off.
//
// Window Width (WW)  = upper - lower   (display dynamic range)
// Window Level (WL)  = (upper + lower) / 2  (center)
// voiRange.lower     = WL - WW/2
// voiRange.upper     = WL + WW/2
//
// Sources (all standard practice; no novel values):
//   - Bone WW 2000 / WL 500 — skeletal radiograph & CT bone window
//     (Bushberg, "Essential Physics of Medical Imaging", 3rd ed., ch 10)
//   - Soft tissue WW 400 / WL 40 — mediastinum / abdomen standard
//     (Bushberg, ch 10; also OHIF default soft-tissue preset)
//   - Lung WW 1500 / WL -500 — pulmonary parenchyma standard
//     (ACR practice parameter; OHIF default lung preset)
//   - Auto = data-driven P1-P99 quantile (handled in DicomViewport;
//     fallback for uncalibrated images)

export interface WLValues {
  /** Window Width (display dynamic range) */
  ww: number;
  /** Window Level (center) */
  wl: number;
}

export interface WLPreset {
  /** Stable id used in state / shortcut maps */
  id: 'bone' | 'soft' | 'lung' | 'auto' | 'dicom';
  /** Toolbar label including emoji */
  label: string;
  /** Single-letter keyboard shortcut (lowercased) */
  shortcut: string;
  /** Short tooltip-friendly description */
  description: string;
  /**
   * `null` for non-numeric presets (auto = compute from histogram,
   * dicom = reset to DICOM-tag default). Numeric values are HU-based
   * standard radiology values.
   */
  values: WLValues | null;
  /** Marker for the smart-quantile path (P1-P99) */
  isAuto?: boolean;
  /** Marker for the resetProperties() path */
  isReset?: boolean;
}

export const WL_PRESETS: WLPreset[] = [
  {
    id: 'bone',
    label: '🦴 Bone',
    shortcut: 'b',
    description: 'WW 2000 · WL 500 — skeletal radiograph & CT bone',
    values: { ww: 2000, wl: 500 },
  },
  {
    id: 'soft',
    label: '🫀 Soft',
    shortcut: 's',
    description: 'WW 400 · WL 40 — mediastinum / abdomen',
    values: { ww: 400, wl: 40 },
  },
  {
    id: 'lung',
    label: '🫁 Lung',
    shortcut: 'l',
    description: 'WW 1500 · WL -500 — pulmonary parenchyma',
    values: { ww: 1500, wl: -500 },
  },
  {
    id: 'auto',
    label: '🪄 Auto',
    shortcut: 'a',
    description: 'Smart contrast (P1-P99 from this image)',
    values: null,
    isAuto: true,
  },
];

/** Optional 5th preset for DICOM-tag default (reset) — bound to toolbar only, no shortcut */
export const WL_PRESET_DICOM: WLPreset = {
  id: 'dicom',
  label: 'DICOM',
  shortcut: '',
  description: 'Reset to DICOM-tag default (resetProperties)',
  values: null,
  isReset: true,
};

/** Convert WW/WL pair to Cornerstone3D `voiRange` { lower, upper }. */
export function wlToVoiRange(values: WLValues): { lower: number; upper: number } {
  const half = values.ww / 2;
  return { lower: values.wl - half, upper: values.wl + half };
}

/** Human-readable toast label: "Bone (WW 2000 / WL 500)". */
export function formatPresetToast(preset: WLPreset): string {
  if (preset.isReset) return 'DICOM default';
  if (preset.isAuto || !preset.values) {
    // Stripped of leading emoji for clean toast wording (still
    // recognisable from context).
    return 'Auto W/L';
  }
  const { ww, wl } = preset.values;
  // Strip emoji prefix for the toast body; emoji is in label-only UX.
  const cleanLabel = preset.label.replace(/^[^\w]*\s*/, '').trim();
  return `${cleanLabel} (WW ${ww} / WL ${wl})`;
}
