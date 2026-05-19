/**
 * CrosshairPattern — faint DICOM-style crosshair grid used in the LabHome
 * empty state. Rendered as an inline SVG <pattern> so it can tile cheaply
 * via CSS background-image without a separate raster asset.
 *
 * Decoration grammar per locked theme spec: sterile, no aurora, no organic
 * gradients — just clinical crosshair ticks at low opacity. Echoes the
 * viewport overlays from OHIF / Cornerstone3D.
 */
export function CrosshairPattern({
  className = "",
  opacity = 0.04,
  color = "#5ACCE6",
}: {
  className?: string;
  opacity?: number;
  color?: string;
}) {
  // Single tile = 48px × 48px. Crosshair cross at center, plus 4 tick marks
  // on the edges (clinical reticle convention).
  const svg = `
<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48' fill='none'>
  <g stroke='${color}' stroke-width='0.75' opacity='${opacity}'>
    <line x1='24' y1='18' x2='24' y2='30' />
    <line x1='18' y1='24' x2='30' y2='24' />
    <line x1='24' y1='0'  x2='24' y2='3' />
    <line x1='24' y1='45' x2='24' y2='48' />
    <line x1='0'  y1='24' x2='3'  y2='24' />
    <line x1='45' y1='24' x2='48' y2='24' />
  </g>
</svg>`.trim();

  const dataUri = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{
        backgroundImage: dataUri,
        backgroundRepeat: "repeat",
        backgroundSize: "48px 48px",
      }}
    />
  );
}

export default CrosshairPattern;
