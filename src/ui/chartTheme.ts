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
