import { useEffect } from "react";
import { useStore } from "../state/store";
import { SpectrumPlot } from "./SpectrumPlot";
import { TreeView } from "./TreeView";
import { Button, Select, TextField } from "./components";

/** The Spectra view: navigate + inspect individual spectra (optionally filtered
 *  by MS level). The TIC / XIC chromatogram lives in the Chromatograms tab. */
export function SpectraTab() {
  const initBrowse = useStore((s) => s.initBrowse);
  useEffect(() => {
    void initBrowse();
  }, [initBrowse]);

  const numSpectra = useStore((s) => s.summary?.numSpectra ?? 0);
  const msLevelCounts = useStore((s) => s.summary?.msLevelCounts);
  const spectra = useStore((s) => s.spectra);
  const selectedIndex = useStore((s) => s.selectedIndex);
  const selectedSpectrum = useStore((s) => s.selectedSpectrum);
  const selectedMeta = useStore((s) => s.selectedMeta);
  const spectrumLoading = useStore((s) => s.spectrumLoading);
  const selectSpectrum = useStore((s) => s.selectSpectrum);
  const scanned = useStore((s) => s.scanned);
  const msLevelFilter = useStore((s) => s.msLevelFilter);
  const setMsLevelFilter = useStore((s) => s.setMsLevelFilter);
  const stepSpectrum = useStore((s) => s.stepSpectrum);
  const chromMode = useStore((s) => s.chromMode);
  const xicParams = useStore((s) => s.xicParams);

  const n = numSpectra;
  if (n === 0) {
    return <p className="hint">This file contains no spectra to browse.</p>;
  }

  const selRow = selectedIndex != null ? spectra[selectedIndex] : undefined;

  const levels = scanned
    ? Object.keys(msLevelCounts ?? {})
        .map(Number)
        .sort((a, b) => a - b)
    : [1, 2, 3];
  const levelOptions = [
    { value: "all", label: `All${scanned ? ` (${numSpectra.toLocaleString()})` : ""}` },
    ...levels.map((lvl) => {
      const c = msLevelCounts?.[lvl];
      return {
        value: String(lvl),
        label: `MS${lvl}${c ? ` (${c.toLocaleString()})` : ""}`,
        disabled: scanned && !c,
      };
    }),
  ];

  // When an MS level is selected, the index + counter are relative to that level.
  const filtered =
    msLevelFilter != null ? spectra.filter((r) => r.msLevel === msLevelFilter) : null;
  const usingFilter = filtered != null && filtered.length > 0;
  const total = usingFilter ? filtered.length : n;
  const pos = usingFilter
    ? Math.max(0, filtered.findIndex((r) => r.index === selectedIndex))
    : selectedIndex ?? 0;

  return (
    <div className="browse">
      <div className="browse-controls">
        <div className="control-row">
          <Button size="sm" disabled={pos <= 0} onClick={() => void stepSpectrum(-1)}>
            ‹ Prev
          </Button>
          <TextField
            label={usingFilter ? `Spectrum (MS${msLevelFilter})` : "Spectrum"}
            type="number"
            width="4.5rem"
            min={0}
            max={total - 1}
            value={pos}
            suffix={`of ${total - 1}`}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v) || v < 0 || v >= total) return;
              const targetIdx = usingFilter ? filtered[v].index : v;
              void selectSpectrum(targetIdx);
            }}
          />
          <Button size="sm" disabled={pos >= total - 1} onClick={() => void stepSpectrum(1)}>
            Next ›
          </Button>
        </div>

        <Select
          label="MS level"
          value={msLevelFilter == null ? "all" : String(msLevelFilter)}
          options={levelOptions}
          onChange={(e) => void setMsLevelFilter(e.target.value === "all" ? null : Number(e.target.value))}
        />
      </div>

      <div className="data-stage">
        <div className="stage-plot">
          <h4 className="stage-h">
            Spectrum
            <span className="stage-meta">
              {(() => {
                const meta = selectedSpectrum ?? selRow;
                if (!meta && !spectrumLoading) return "";
                return [
                  meta ? `id: ${meta.id}` : null,
                  meta?.msLevel != null ? `MS${meta.msLevel}` : null,
                  meta?.representation ?? null,
                  meta?.time != null ? `RT ${meta.time.toFixed(2)} s` : null,
                  selectedSpectrum ? `${selectedSpectrum.mz.length} pts` : null,
                  spectrumLoading ? "loading…" : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
              })()}
            </span>
          </h4>
          <SpectrumPlot
            spectrum={selectedSpectrum}
            xicWindow={chromMode === "xic" ? xicParams : null}
          />
          <p className="stage-hint" style={{ marginTop: "0.25rem" }}>
            Scroll to zoom · drag a box to zoom m/z · middle-drag to pan ·
            double-click to reset
          </p>
        </div>
      </div>

      {selectedMeta != null && (
        <details style={{ marginTop: "0.1rem" }}>
          <summary
            style={{
              cursor: "pointer",
              fontWeight: "var(--weight-semibold)",
              fontSize: "var(--text-body)",
              color: "var(--text-heading)",
            }}
          >
            Spectrum metadata
          </summary>
          <div style={{ marginTop: "0.4rem" }}>
            <TreeView label="spectrum" value={selectedMeta} defaultOpen={2} />
          </div>
        </details>
      )}
    </div>
  );
}
