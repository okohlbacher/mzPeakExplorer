import type uPlot from "uplot";

/**
 * uPlot palette for the spectrum / chromatogram viewer. The viewer sits on a
 * WHITE panel (per request), so axes/labels are dark and gridlines light; the
 * series stroke is OpenMS blue and the selected-time marker signal red.
 */
export const STAGE = {
  line: "#3b54da", // spectrum / chromatogram stroke (OpenMS blue)
  fill: "rgba(59,84,218,0.10)", // profile-spectrum area fill
  marker: "#c00000", // selected-time marker (signal red)
  band: "rgba(255,200,0,0.25)", // active XIC m/z window (warning band)
  label: "#353c43", // peak m/z labels (dark on white)
  axis: "#6b757e", // axis tick text
  grid: "#e3e7eb", // gridlines
  pointFill: "#ffffff", // marker interior (= panel bg → hollow dots)
} as const;

/**
 * x-scale range function. uPlot's auto-range can return null for a small,
 * near-uniform x range (e.g. an MS1-only TIC), which blanks the plot. This
 * respects an explicit pinned range (so wheel/box zoom keep working) and only
 * falls back to the data extent when the auto-range is missing.
 */
export function xRange(
  u: uPlot,
  initMin: number,
  initMax: number,
): [number, number] {
  if (Number.isFinite(initMin) && Number.isFinite(initMax)) return [initMin, initMax];
  const xs = u.data[0];
  if (!xs || xs.length === 0) return [0, 1];
  const a = xs[0] as number;
  const b = xs[xs.length - 1] as number;
  return [a, b > a ? b : a + 1];
}

/** Light-panel axes: dark tick text, faint grid. */
export function stageAxes(xLabel: string, yLabel: string): uPlot.Axis[] {
  const common = {
    stroke: STAGE.axis,
    grid: { stroke: STAGE.grid, width: 1 },
    ticks: { stroke: STAGE.grid, width: 1 },
    font: "11px IBM Plex Mono, monospace",
    labelFont: "11px IBM Plex Sans, sans-serif",
  };
  return [
    { ...common, label: xLabel, labelGap: 4, labelSize: 22 },
    { ...common, label: yLabel, labelGap: 4, labelSize: 30 },
  ];
}
