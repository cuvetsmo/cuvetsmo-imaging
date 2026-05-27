"use client";

// Sparkline — minimal 7-day SVG sparkline. No external charting lib.
// Renders as a CSS-token-colored path. Empty data → flat line at
// baseline + caption "no data yet".

type Props = {
  /** Array of values in chronological order (oldest → newest). */
  values: number[];
  /** Width in px (defaults to 120). Height fixed at 36. */
  width?: number;
  height?: number;
  /** Stroke color CSS variable (defaults to --color-tool-cyan). */
  stroke?: string;
  /** Optional accent fill area under the line (low alpha). */
  fillArea?: boolean;
};

export function Sparkline({
  values,
  width = 120,
  height = 36,
  stroke = "var(--color-tool-cyan)",
  fillArea = true,
}: Props) {
  if (values.length === 0 || values.every((v) => v === 0)) {
    // Empty / all-zero → render baseline + "no data" label.
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="block"
        aria-label="No data yet"
      >
        <line
          x1="0"
          y1={height - 1}
          x2={width}
          y2={height - 1}
          stroke="var(--color-border)"
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        <text
          x={width / 2}
          y={height / 2 + 4}
          textAnchor="middle"
          fontSize="9"
          fontFamily="ui-monospace, monospace"
          fill="var(--color-text-faint)"
        >
          no data yet
        </text>
      </svg>
    );
  }

  // Scale values to fit (with 2px vertical padding so 0 isn't on the
  // border and max isn't clipped).
  const max = Math.max(...values, 1);
  const pad = 2;
  const usableH = height - pad * 2;
  const stepX = values.length === 1 ? 0 : width / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = pad + usableH - (v / max) * usableH;
    return [x, y] as const;
  });

  const lineD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
  const areaD =
    fillArea && points.length > 1
      ? `${lineD} L ${width} ${height} L 0 ${height} Z`
      : null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="block"
      aria-label={`Sparkline of ${values.length} values, max ${max}`}
    >
      {areaD && (
        <path d={areaD} fill={stroke} fillOpacity="0.12" stroke="none" />
      )}
      <path
        d={lineD}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Data dots on each point */}
      {points.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={i === points.length - 1 ? 2.5 : 1.5}
          fill={stroke}
        />
      ))}
    </svg>
  );
}
