import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { SpectrumArrays } from "../reader/types";
import { wheelZoomPlugin } from "./uplotZoom";
import { nearestPeakIndex, topPeakIndices } from "./peaks";

/**
 * Single-spectrum plot: m/z (x) vs intensity (y). Profile spectra draw as a
 * line; centroid spectra as a stick spectrum. Interactions: wheel-zoom / box-
 * zoom (left drag) / pan (middle drag) / double-click reset, the most intense
 * visible peaks are auto-labelled with their m/z, and a hover tooltip reads the
 * nearest peak. An optional translucent band marks the active XIC m/z window.
 *
 * The uPlot instance is created LAZILY once the host has a real width —
 * constructing at zero width permanently breaks uPlot's scale auto-ranging.
 */
const HEIGHT = 320;
const MAX_LABELS = 10;
const LABEL_GAP_PX = 34;

function toSeries(s: SpectrumArrays | null): uPlot.AlignedData {
  if (!s) return [new Float64Array(0), new Float64Array(0)];
  if (s.representation !== "centroid") {
    return [s.mz, Float64Array.from(s.intensity)];
  }
  const n = s.mz.length;
  const xs = new Float64Array(n * 3);
  const ys = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    xs[j] = s.mz[i];
    xs[j + 1] = s.mz[i];
    xs[j + 2] = s.mz[i];
    ys[j + 1] = s.intensity[i];
  }
  return [xs, ys];
}

export function SpectrumPlot({
  spectrum,
  xicWindow,
}: {
  spectrum: SpectrumArrays | null;
  xicWindow: { mz: number; tolDa: number } | null;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const dataRef = useRef<uPlot.AlignedData>(toSeries(spectrum));
  const specRef = useRef<SpectrumArrays | null>(spectrum);
  specRef.current = spectrum;
  const windowRef = useRef(xicWindow);
  windowRef.current = xicWindow;
  const tipRef = useRef<HTMLDivElement | null>(null);

  // (Re)build the plot from the current data. Constructing uPlot with the real
  // data at a real width is the only reliable way to get correct scale ranging —
  // a plot built empty (the spectrum loads asynchronously) never re-ranges on a
  // later setData. So we recreate on each data change; it's a few ms for an 18k-
  // point spectrum and conveniently resets zoom when navigating to a new scan.
  function build() {
    const el = elRef.current;
    if (!el) return;
    const w = el.clientWidth;
    if (w <= 0) return; // wait for layout
    if (dataRef.current[0].length === 0) {
      plotRef.current?.destroy();
      plotRef.current = null;
      tipRef.current = null;
      return;
    }
    plotRef.current?.destroy();

    const opts: uPlot.Options = {
      width: w,
      height: HEIGHT,
      scales: { x: { time: false } },
      legend: { show: false },
      plugins: [wheelZoomPlugin({ factor: 0.8 })],
      series: [
        { label: "m/z" },
        {
          label: "intensity",
          stroke: "#1565c0",
          fill: "rgba(21,101,192,0.10)",
          width: 1,
          points: { show: false },
        },
      ],
      axes: [{ label: "m/z" }, { label: "intensity" }],
      hooks: {
        draw: [
          (u) => drawXicBand(u, windowRef.current),
          (u) => drawPeakLabels(u, specRef.current),
        ],
        setCursor: [(u) => updateTooltip(u, tipRef.current, specRef.current)],
      },
    };

    const plot = new uPlot(opts, dataRef.current, el);
    plotRef.current = plot;
    // Tooltip lives inside the cursor overlay so its coords match cursor.left/top.
    const tip = document.createElement("div");
    tip.className = "spec-tooltip";
    plot.over.appendChild(tip);
    tipRef.current = tip;
  }

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w <= 0) return;
      if (plotRef.current) plotRef.current.setSize({ width: w, height: HEIGHT });
      else build();
    });
    ro.observe(el);
    build();
    return () => {
      ro.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
      tipRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    dataRef.current = toSeries(spectrum);
    build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spectrum]);

  useEffect(() => {
    plotRef.current?.redraw();
  }, [xicWindow]);

  return <div ref={elRef} className="chart-host" />;
}

function drawXicBand(u: uPlot, win: { mz: number; tolDa: number } | null) {
  if (!win) return;
  const xLo = u.valToPos(win.mz - win.tolDa, "x", true);
  const xHi = u.valToPos(win.mz + win.tolDa, "x", true);
  const { ctx } = u;
  ctx.save();
  ctx.fillStyle = "rgba(255,179,0,0.22)";
  ctx.fillRect(xLo, u.bbox.top, xHi - xLo, u.bbox.height);
  ctx.restore();
}

function drawPeakLabels(u: uPlot, s: SpectrumArrays | null) {
  if (!s || s.mz.length === 0) return;
  const xmin = u.scales.x.min;
  const xmax = u.scales.x.max;
  if (xmin == null || xmax == null) return;
  const idxs = topPeakIndices(s, xmin, xmax, MAX_LABELS);
  const { ctx } = u;
  ctx.save();
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = "#37474f";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const placed: number[] = [];
  for (const i of idxs) {
    const x = u.valToPos(s.mz[i], "x", true);
    const y = u.valToPos(s.intensity[i], "y", true);
    if (placed.some((px) => Math.abs(px - x) < LABEL_GAP_PX)) continue;
    placed.push(x);
    ctx.fillText(s.mz[i].toFixed(3), x, y - 4);
  }
  ctx.restore();
}

function updateTooltip(
  u: uPlot,
  tip: HTMLDivElement | null,
  s: SpectrumArrays | null,
) {
  if (!tip) return;
  const { left, top } = u.cursor;
  if (!s || left == null || left < 0 || top == null || top < 0) {
    tip.style.display = "none";
    return;
  }
  const i = nearestPeakIndex(s, u.posToVal(left, "x"));
  if (i == null) {
    tip.style.display = "none";
    return;
  }
  tip.style.display = "block";
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
  tip.textContent = `m/z ${s.mz[i].toFixed(4)} · ${s.intensity[i].toExponential(2)}`;
}
