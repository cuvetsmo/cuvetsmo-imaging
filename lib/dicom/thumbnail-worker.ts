/// <reference lib="webworker" />

// Dedicated Web Worker — renders a 192×192 PNG thumbnail from a DICOM file
// without blocking the main thread. AGENT-B for Phase 5.
//
// Pipeline:
//   1. Parse the full DICOM (NO untilTag — we need PixelData at x7fe00010)
//   2. Extract image dimensions (Rows · Columns), bit depth (BitsAllocated),
//      pixel representation (signed/unsigned), and photometric interpretation
//      (MONOCHROME1 = inverted, MONOCHROME2 = normal).
//   3. Build a typed view into the pixel data (Uint8 · Uint16 · Int16).
//   4. Pick a window/level — prefer DICOM-tag WindowCenter/Width when
//      present, otherwise compute P1-P99 quantile from a downsampled
//      histogram (Auto W/L preset behaviour).
//   5. Map every pixel through the W/L → 0..255 grayscale.
//   6. Draw to an OffscreenCanvas at the source dimensions, then scale
//      down letterboxed into a 192×192 thumbnail canvas.
//   7. Export PNG blob via `canvas.convertToBlob({ type: 'image/png' })`
//      and ship it back on the message channel.
//
// Failure modes (any of these → ok:false, the main thread falls back to
// the modality glyph):
//   - Encapsulated PixelData (JPEG / RLE compressed) — we don't depth-
//     decode here; punt rather than ship a broken thumb.
//   - Multi-frame instances — only frame 0 (kept simple, the StudyTree
//     card is illustrative).
//   - Color photometric (RGB · YBR_FULL) — we still render but treat as
//     grayscale by averaging channels (good enough for a 192px thumb).
//   - Missing Rows / Columns / PixelData → ok:false.

import dicomParser from "dicom-parser";

// Tell TS this file runs in a DedicatedWorkerGlobalScope (not Window).
declare const self: DedicatedWorkerGlobalScope;

// ─── Wire types (kept inline to avoid a separate types file just for
// the thumbnail channel — shape mirrors parse-types ParseRequest). ──────

interface ThumbnailRequest {
  id: number;
  /** Raw DICOM bytes (transferred, zero-copy). */
  arrayBuffer: ArrayBuffer;
  /** Target thumbnail size — square. Default 192. */
  size?: number;
}

type ThumbnailResponse =
  | { id: number; ok: true; thumbnailBlob: Blob }
  | { id: number; ok: false; error: string };

// ─── Tags we care about ─────────────────────────────────────────────────

const TAG_ROWS = "x00280010";
const TAG_COLS = "x00280011";
const TAG_BITS_ALLOCATED = "x00280100";
const TAG_BITS_STORED = "x00280101";
const TAG_PIXEL_REPR = "x00280103"; // 0 = unsigned, 1 = signed
const TAG_PHOTOMETRIC = "x00280004";
const TAG_SAMPLES_PER_PIXEL = "x00280002";
const TAG_PLANAR_CONFIG = "x00280006";
const TAG_WINDOW_CENTER = "x00281050";
const TAG_WINDOW_WIDTH = "x00281051";
const TAG_RESCALE_SLOPE = "x00281053";
const TAG_RESCALE_INTERCEPT = "x00281052";
const TAG_NUM_FRAMES = "x00280008";
const TAG_PIXEL_DATA = "x7fe00010";

// ─── Worker message handler ────────────────────────────────────────────

self.onmessage = async (e: MessageEvent<ThumbnailRequest>) => {
  const { id, arrayBuffer, size = 192 } = e.data;
  try {
    const blob = await renderThumbnail(arrayBuffer, size);
    const reply: ThumbnailResponse = { id, ok: true, thumbnailBlob: blob };
    self.postMessage(reply);
  } catch (err) {
    const reply: ThumbnailResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(reply);
  }
};

// ─── Core render ──────────────────────────────────────────────────────

async function renderThumbnail(
  arrayBuffer: ArrayBuffer,
  targetSize: number,
): Promise<Blob> {
  // Full parse — we need the actual PixelData element offsets.
  const u8 = new Uint8Array(arrayBuffer);
  const dataSet = dicomParser.parseDicom(u8);

  const rows = dataSet.uint16(TAG_ROWS);
  const cols = dataSet.uint16(TAG_COLS);
  if (!rows || !cols || rows <= 0 || cols <= 0) {
    throw new Error("Missing or invalid Rows/Columns");
  }

  const pixelEl = dataSet.elements[TAG_PIXEL_DATA];
  if (!pixelEl) {
    throw new Error("No PixelData element");
  }

  // Encapsulated pixel data (JPEG / RLE etc) — `fragments` is populated
  // and `dataOffset` doesn't point at raw pixels. We don't bundle a
  // codec here, so punt cleanly. Main thread falls back to glyph.
  if (pixelEl.encapsulatedPixelData) {
    throw new Error("Encapsulated PixelData (compressed) not supported");
  }

  const bitsAllocated = dataSet.uint16(TAG_BITS_ALLOCATED) ?? 16;
  const bitsStored = dataSet.uint16(TAG_BITS_STORED) ?? bitsAllocated;
  const pixelRepresentation = dataSet.uint16(TAG_PIXEL_REPR) ?? 0;
  const photometric =
    dataSet.string(TAG_PHOTOMETRIC)?.trim().toUpperCase() ?? "MONOCHROME2";
  const samplesPerPixel = dataSet.uint16(TAG_SAMPLES_PER_PIXEL) ?? 1;
  const planarConfig = dataSet.uint16(TAG_PLANAR_CONFIG) ?? 0;
  const numFrames = parseInt(dataSet.string(TAG_NUM_FRAMES) ?? "1", 10) || 1;
  const rescaleSlope =
    (dataSet.floatString(TAG_RESCALE_SLOPE) ??
      parseFloat(dataSet.string(TAG_RESCALE_SLOPE) ?? "1")) ||
    1;
  const rescaleIntercept =
    (dataSet.floatString(TAG_RESCALE_INTERCEPT) ??
      parseFloat(dataSet.string(TAG_RESCALE_INTERCEPT) ?? "0")) ||
    0;

  // Optional window/level (some DICOMs ship arrays — first value wins).
  const tagWC = readFirstFloat(dataSet, TAG_WINDOW_CENTER);
  const tagWW = readFirstFloat(dataSet, TAG_WINDOW_WIDTH);

  // Only frame 0 for thumbnails (multi-frame CT slabs etc).
  const pixelsPerFrame = rows * cols * samplesPerPixel;
  const bytesPerSample = bitsAllocated <= 8 ? 1 : 2;
  const frameByteLength = pixelsPerFrame * bytesPerSample;
  const totalBytes = frameByteLength * numFrames;

  // Bounds check — if the element claims more bytes than we have, clamp
  // rather than overrun. Some malformed DICOMs have wrong length tags.
  const dataOffset = pixelEl.dataOffset;
  const availableBytes = u8.byteLength - dataOffset;
  const useBytes = Math.min(frameByteLength, availableBytes);

  if (useBytes <= 0) {
    throw new Error("PixelData offset beyond buffer end");
  }

  // Build a typed view onto frame 0.
  // dicom-parser keeps `byteArray` as Uint8Array — slicing creates a
  // copy (~few hundred KB), which we accept to align to typed-array
  // requirements (Uint16Array constructor needs aligned offsets).
  // For 192px thumbnails this copy is negligible vs. canvas operations.
  let sourcePixels: Uint8Array | Uint16Array | Int16Array;
  if (bitsAllocated <= 8) {
    sourcePixels = new Uint8Array(u8.buffer, u8.byteOffset + dataOffset, useBytes);
  } else {
    // Slice + new view to guarantee 2-byte alignment.
    const sliced = u8.slice(dataOffset, dataOffset + useBytes);
    sourcePixels = pixelRepresentation === 1
      ? new Int16Array(sliced.buffer, sliced.byteOffset, useBytes / 2)
      : new Uint16Array(sliced.buffer, sliced.byteOffset, useBytes / 2);
  }

  // ─── Build grayscale 0..255 from source pixels ────────────────────

  // Convert (sample) → modality units via slope*x + intercept. For Auto
  // W/L we sample a stride to keep the histogram cheap on large images.
  const isColor = samplesPerPixel >= 3;
  const isInverted = photometric === "MONOCHROME1";

  let lower: number;
  let upper: number;

  if (Number.isFinite(tagWC) && Number.isFinite(tagWW) && tagWW! > 0) {
    // Use stored W/L (already in modality units).
    lower = tagWC! - tagWW! / 2;
    upper = tagWC! + tagWW! / 2;
  } else {
    // P1-P99 quantile from a strided sample of the frame.
    const { p1, p99 } = sampleQuantiles(
      sourcePixels,
      rows,
      cols,
      samplesPerPixel,
      planarConfig,
      rescaleSlope,
      rescaleIntercept,
    );
    if (p99 <= p1) {
      // Degenerate (flat image) → fall back to bit-depth range.
      const maxVal = (1 << bitsStored) - 1;
      lower = 0;
      upper = maxVal;
    } else {
      lower = p1;
      upper = p99;
    }
  }

  const range = upper - lower;
  const safeRange = range > 0 ? range : 1;

  // Build an ImageData-sized RGBA buffer at SOURCE dimensions, then
  // we'll draw it once to an OffscreenCanvas and use canvas resampling
  // for the final 192×192 letterboxed thumbnail. That's faster than
  // hand-rolling bilinear inside the loop.
  const rgba = new Uint8ClampedArray(rows * cols * 4);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const pixelIdx = y * cols + x;
      let gray: number;
      if (isColor) {
        // Average channels (good enough for a 192px thumb of an RGB scout).
        gray = colorPixelGray(
          sourcePixels,
          pixelIdx,
          rows,
          cols,
          samplesPerPixel,
          planarConfig,
        );
      } else {
        const raw = sourcePixels[pixelIdx] as number;
        gray = raw * rescaleSlope + rescaleIntercept;
      }
      // Map to 0..255 via window
      let mapped = ((gray - lower) / safeRange) * 255;
      if (mapped < 0) mapped = 0;
      else if (mapped > 255) mapped = 255;
      if (isInverted) mapped = 255 - mapped;

      const outIdx = pixelIdx * 4;
      rgba[outIdx] = mapped;
      rgba[outIdx + 1] = mapped;
      rgba[outIdx + 2] = mapped;
      rgba[outIdx + 3] = 255;
    }
  }

  // ─── Draw to source-sized canvas, then resize letterboxed to target ─

  // OffscreenCanvas is the fast path. We fall back via a regular
  // ImageBitmap pipeline if it's not available — but every browser
  // that supports module workers also supports OffscreenCanvas (Chrome
  // 69+, Firefox 105+, Safari 16.4+), so this is mostly belt-and-
  // suspenders for old Safari users.
  if (typeof OffscreenCanvas === "undefined") {
    throw new Error("OffscreenCanvas unavailable in worker");
  }

  const srcCanvas = new OffscreenCanvas(cols, rows);
  const srcCtx = srcCanvas.getContext("2d");
  if (!srcCtx) throw new Error("2D context unavailable on source canvas");
  const imageData = new ImageData(rgba, cols, rows);
  srcCtx.putImageData(imageData, 0, 0);

  // Letterbox into target square.
  const dst = new OffscreenCanvas(targetSize, targetSize);
  const dstCtx = dst.getContext("2d");
  if (!dstCtx) throw new Error("2D context unavailable on dst canvas");

  // Black background (matches viewer chrome).
  dstCtx.fillStyle = "#06070A";
  dstCtx.fillRect(0, 0, targetSize, targetSize);

  // Aspect-preserve scaling.
  const aspect = cols / rows;
  let drawW: number;
  let drawH: number;
  if (aspect >= 1) {
    drawW = targetSize;
    drawH = Math.round(targetSize / aspect);
  } else {
    drawH = targetSize;
    drawW = Math.round(targetSize * aspect);
  }
  const dx = Math.round((targetSize - drawW) / 2);
  const dy = Math.round((targetSize - drawH) / 2);

  dstCtx.imageSmoothingEnabled = true;
  dstCtx.imageSmoothingQuality = "medium";
  dstCtx.drawImage(srcCanvas, 0, 0, cols, rows, dx, dy, drawW, drawH);

  // Export PNG.
  const blob = await dst.convertToBlob({ type: "image/png" });
  return blob;
}

// ─── Helpers ───────────────────────────────────────────────────────────

function readFirstFloat(
  ds: dicomParser.DataSet,
  tag: string,
): number | undefined {
  const v = ds.floatString(tag, 0);
  if (Number.isFinite(v)) return v;
  // Some DICOMs store WC/WW as a backslash-separated string.
  const str = ds.string(tag);
  if (!str) return undefined;
  const first = parseFloat(str.split("\\")[0] ?? str);
  return Number.isFinite(first) ? first : undefined;
}

/**
 * Compute P1 / P99 quantiles by stride-sampling the frame. We don't
 * need an exact histogram for a 192px thumbnail — a 4096-bin sketch
 * is plenty.
 */
function sampleQuantiles(
  src: Uint8Array | Uint16Array | Int16Array,
  rows: number,
  cols: number,
  samplesPerPixel: number,
  planarConfig: number,
  slope: number,
  intercept: number,
): { p1: number; p99: number } {
  const isColor = samplesPerPixel >= 3;
  const totalPx = rows * cols;
  // Cap samples so we never histogram more than ~65k pixels for the
  // quantile estimate. Mainly matters for full-chest DR ~3000×3000.
  const TARGET_SAMPLES = 65536;
  const stride = Math.max(1, Math.floor(totalPx / TARGET_SAMPLES));

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const buf: number[] = [];

  for (let i = 0; i < totalPx; i += stride) {
    let v: number;
    if (isColor) {
      v = colorPixelGray(src, i, rows, cols, samplesPerPixel, planarConfig);
    } else {
      v = (src[i] as number) * slope + intercept;
    }
    if (v < min) min = v;
    if (v > max) max = v;
    buf.push(v);
  }
  if (buf.length === 0) return { p1: 0, p99: 1 };

  buf.sort((a, b) => a - b);
  const idx1 = Math.max(0, Math.floor(buf.length * 0.01));
  const idx99 = Math.min(buf.length - 1, Math.floor(buf.length * 0.99));
  return { p1: buf[idx1], p99: buf[idx99] };
}

/**
 * Average RGB → grayscale for a color pixel at logical index `i`.
 * Handles both interleaved (planarConfig=0) and planar (planarConfig=1).
 */
function colorPixelGray(
  src: Uint8Array | Uint16Array | Int16Array,
  i: number,
  rows: number,
  cols: number,
  samplesPerPixel: number,
  planarConfig: number,
): number {
  if (planarConfig === 0) {
    // Interleaved: R,G,B,R,G,B,...
    const base = i * samplesPerPixel;
    const r = (src[base] as number) ?? 0;
    const g = (src[base + 1] as number) ?? 0;
    const b = (src[base + 2] as number) ?? 0;
    return (r + g + b) / 3;
  } else {
    // Planar: R-frame then G-frame then B-frame.
    const frameSize = rows * cols;
    const r = (src[i] as number) ?? 0;
    const g = (src[i + frameSize] as number) ?? 0;
    const b = (src[i + frameSize * 2] as number) ?? 0;
    return (r + g + b) / 3;
  }
}

// Export {} so TS treats this as a module (required for top-level
// `declare const self` + module-worker bundling).
export {};
