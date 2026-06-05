import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { ChromPoint } from "../reader/types";
import { wheelZoomPlugin } from "./uplotZoom";
import { STAGE, stageAxes } from "./chartTheme";

/**
 * Chromatogram navigator: time (x) vs summed intensity (y). Clicking anywhere
 * picks the nearest time and calls `onPick`, which the Browse tab maps to the
 * nearest spectrum. A vertical marker shows the currently-selected time.
 *
 * Like SpectrumPlot, the uPlot instance is created LAZILY once the host has a
 * real width — constructing at zero width breaks uPlot's scale auto-ranging.
 */
const HEIGHT = 200;

function toData(points: ChromPoint[]): uPlot.AlignedData {
  const xs = new Float64Array(points.length);
  const ys = new Float64Array(points.length);
  for (let i = 0; i < points.length; i++) {
    xs[i] = points[i].time;
    ys[i] = points[i].intensity;
  }
  return [xs, ys];
}

export function ChromPlot({
  points,
  onPick,
  selectedTime,
}: {
  points: ChromPoint[];
  onPick: (time: number) => void;
  selectedTime: number | null;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const dataRef = useRef<uPlot.AlignedData>(toData(points));
  const selRef = useRef<number | null>(selectedTime);
  selRef.current = selectedTime;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  // Recreate the plot from current data (see SpectrumPlot.build): constructing
  // with real data at a real width is the only reliable way to get scale ranging.
  function build() {
    const el = elRef.current;
    if (!el) return;
    const w = el.clientWidth;
    if (w <= 0) return;
    if (dataRef.current[0].length === 0) {
      plotRef.current?.destroy();
      plotRef.current = null;
      return;
    }
    plotRef.current?.destroy();
    const opts: uPlot.Options = {
      width: w,
      height: HEIGHT,
      scales: { x: { time: false } },
      // Left-drag stays a click (navigate); zoom via wheel, pan via middle-drag.
      cursor: { y: false, drag: { x: false, y: false } },
      legend: { show: false },
      plugins: [wheelZoomPlugin({ factor: 0.8 })],
      series: [
        { label: "RT (s)" },
        {
          label: "intensity",
          stroke: STAGE.line,
          width: 1.25,
          points: { show: true, size: 4, stroke: STAGE.line, fill: STAGE.pointFill },
        },
      ],
      axes: stageAxes("retention time (s)", "intensity"),
      hooks: {
        draw: [
          (u) => {
            const t = selRef.current;
            if (t === null) return;
            const x = u.valToPos(t, "x", true);
            const { ctx } = u;
            ctx.save();
            ctx.strokeStyle = STAGE.marker;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, u.bbox.top);
            ctx.lineTo(x, u.bbox.top + u.bbox.height);
            ctx.stroke();
            ctx.restore();
          },
        ],
        ready: [
          (u) => {
            u.over.style.cursor = "crosshair";
            u.over.addEventListener("click", () => {
              const left = u.cursor.left;
              if (left == null || left < 0) return;
              const t = u.posToVal(left, "x");
              if (Number.isFinite(t)) onPickRef.current(t);
            });
          },
        ],
      },
    };
    const plot = new uPlot(opts, dataRef.current, el);
    plotRef.current = plot;
    // Force the x-scale to the data extent — constructing with a small, all-equal-
    // distance x range (an MS1-only TIC) can leave uPlot's x auto-range null while
    // y ranges fine; an explicit setScale snaps it and paints the line.
    const xs = dataRef.current[0];
    if (xs.length > 0) {
      const lo = xs[0] as number;
      const hi = xs[xs.length - 1] as number;
      plot.setScale("x", { min: lo, max: hi > lo ? hi : lo + 1 });
    }
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    dataRef.current = toData(points);
    build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  useEffect(() => {
    plotRef.current?.redraw();
  }, [selectedTime]);

  return <div ref={elRef} className="chart-host" />;
}
