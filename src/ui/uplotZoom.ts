import type uPlot from "uplot";

/**
 * uPlot interaction plugin for 1-D spectra / chromatograms:
 *  - mouse wheel  → zoom the x-axis, anchored under the cursor (y auto-rescales
 *    to the tallest visible peak, which is uPlot's default for an auto y-scale)
 *  - middle-drag  → pan the x-axis
 *
 * Left-drag box-zoom and double-click-to-reset are uPlot built-ins and are left
 * untouched. Full data bounds are read live from `u.data` on each event, so the
 * clamp stays correct after the spectrum is replaced (navigation) without
 * needing to recreate the plot. Adapted from the official uPlot zoom-wheel demo.
 */
export function wheelZoomPlugin(opts: { factor?: number } = {}): uPlot.Plugin {
  const factor = opts.factor ?? 0.8;

  return {
    hooks: {
      ready: (u: uPlot) => {
        const over = u.over;

        const xBounds = (): [number, number] | null => {
          const xs = u.data[0];
          if (!xs || xs.length === 0) return null;
          return [xs[0] as number, xs[xs.length - 1] as number];
        };

        over.addEventListener(
          "wheel",
          (e: WheelEvent) => {
            e.preventDefault();
            const bounds = xBounds();
            if (!bounds) return;
            const [fullMin, fullMax] = bounds;
            const rect = over.getBoundingClientRect();
            const left = e.clientX - rect.left;
            const leftPct = left / rect.width;
            const xVal = u.posToVal(left, "x");
            const oxRange = u.scales.x.max! - u.scales.x.min!;
            let nxRange = e.deltaY < 0 ? oxRange * factor : oxRange / factor;

            if (nxRange >= fullMax - fullMin) {
              u.setScale("x", { min: fullMin, max: fullMax });
              return;
            }
            let nxMin = xVal - leftPct * nxRange;
            let nxMax = nxMin + nxRange;
            if (nxMin < fullMin) {
              nxMin = fullMin;
              nxMax = fullMin + nxRange;
            } else if (nxMax > fullMax) {
              nxMax = fullMax;
              nxMin = fullMax - nxRange;
            }
            u.setScale("x", { min: nxMin, max: nxMax });
          },
          { passive: false },
        );

        over.addEventListener("mousedown", (e: MouseEvent) => {
          if (e.button !== 1) return; // middle button only
          e.preventDefault();
          const bounds = xBounds();
          if (!bounds) return;
          const [fullMin, fullMax] = bounds;
          const left0 = e.clientX;
          const xMin0 = u.scales.x.min!;
          const xMax0 = u.scales.x.max!;
          const span = xMax0 - xMin0;
          const perPx = u.posToVal(1, "x") - u.posToVal(0, "x");

          const onMove = (ev: MouseEvent) => {
            const dx = perPx * (ev.clientX - left0);
            let nMin = xMin0 - dx;
            let nMax = xMax0 - dx;
            if (nMin < fullMin) {
              nMin = fullMin;
              nMax = fullMin + span;
            } else if (nMax > fullMax) {
              nMax = fullMax;
              nMin = fullMax - span;
            }
            u.setScale("x", { min: nMin, max: nMax });
          };
          const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        });
      },
    },
  };
}
