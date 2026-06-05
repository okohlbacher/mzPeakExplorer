import type uPlot from "uplot";

/**
 * uPlot palette for the dark "data stage" (handoff §8). The canvas itself stays
 * transparent so the stage background (#0e1216 + dot-grid) shows through; only
 * the strokes/labels are coloured here.
 */
export const STAGE = {
  line: "#5468e0", // spectrum / chromatogram stroke (bright blue on dark)
  fill: "rgba(84,104,224,0.18)", // profile-spectrum area fill
  marker: "#d62828", // selected-time marker (signal red)
  band: "rgba(255,200,0,0.22)", // active XIC m/z window
  label: "#c5ccd3", // peak m/z labels
  axis: "#9aa4ad", // axis tick text
  grid: "#2a323a", // gridlines
  pointFill: "#0e1216", // marker interior (= stage bg → hollow dots)
} as const;

/** Dark-stage axes: light tick text, faint grid, no axis-name (kept minimal). */
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
