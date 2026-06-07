import { useEffect } from "react";
import { useStore } from "../state/store";
import { SpectrumPlot } from "./SpectrumPlot";
import { TreeView } from "./TreeView";
import { Button, PlotSpinner, Select, TextField } from "./components";

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

  // Levels known from the scan; before it runs we can't know, so offer the
  // common levels speculatively. Always include the active filter so the
  // dropdown shows the current selection even when the file has none of it.
  const knownLevels = scanned
    ? Object.keys(msLevelCounts ?? {}).map(Number)
    : [1, 2, 3];
  const levelSet = new Set(knownLevels);
  if (msLevelFilter != null) levelSet.add(msLevelFilter);
  const levels = [...levelSet].sort((a, b) => a - b);
  const levelOptions = [
    { value: "all", label: `All${scanned ? ` (${numSpectra.toLocaleString()})` : ""}` },
    ...levels.map((lvl) => {
      const c = msLevelCounts?.[lvl] ?? 0;
      return {
        value: String(lvl),
        label: `MS${lvl}${scanned ? ` (${c.toLocaleString()})` : ""}`,
      };
    }),
  ];

  // When an MS level is selected, the index + counter are relative to that level.
  const filtering = msLevelFilter != null;
  const filtered = filtering ? spectra.filter((r) => r.msLevel === msLevelFilter) : null;
  // Resolving = filter chosen but the scan that knows MS levels hasn't finished.
  const resolving = filtering && !scanned;
  // No matches = the file genuinely has no spectra at the chosen level.
  const noMatches = filtering && scanned && (filtered?.length ?? 0) === 0;
  const usingFilter = filtering && (filtered?.length ?? 0) > 0;
  const total = filtering ? filtered?.length ?? 0 : n;
  const pos = usingFilter
    ? Math.max(0, filtered!.findIndex((r) => r.index === selectedIndex))
    : selectedIndex ?? 0;
  const navDisabled = resolving || noMatches;

  const repr = selectedSpectrum?.representation;
  const reprHint =
    repr === "centroid"
      ? "centroid spectrum — drawn as a stick spectrum"
      : repr
        ? "profile spectrum — drawn as a line"
        : null;

  return (
    <div className="browse view-narrow">
      <div className="browse-controls">
        <div className="control-row">
          <Button
            size="sm"
            disabled={navDisabled || pos <= 0}
            onClick={() => void stepSpectrum(-1)}
          >
            ‹ Prev
          </Button>
          <TextField
            label={usingFilter ? `Spectrum (MS${msLevelFilter})` : "Spectrum"}
            type="number"
            width="5rem"
            min={0}
            max={Math.max(0, total - 1)}
            value={navDisabled ? 0 : pos}
            disabled={navDisabled}
            suffix={`of ${Math.max(0, total - 1)}`}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!usingFilter && !filtering) {
                if (!Number.isFinite(v) || v < 0 || v >= total) return;
                void selectSpectrum(v);
                return;
              }
              if (!usingFilter) return;
              if (!Number.isFinite(v) || v < 0 || v >= total) return;
              void selectSpectrum(filtered![v].index);
            }}
          />
          <Button
            size="sm"
            disabled={navDisabled || pos >= total - 1}
            onClick={() => void stepSpectrum(1)}
          >
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

      {resolving ? (
        <div className="data-stage">
          <div className="stage-plot">
            <p className="stage-hint" style={{ padding: "1.4rem 0.2rem" }}>
              Resolving MS levels — scanning the per-spectrum index…
            </p>
          </div>
        </div>
      ) : noMatches ? (
        <div className="data-stage">
          <div className="stage-plot">
            <p className="stage-hint" style={{ padding: "1.4rem 0.2rem" }}>
              <strong style={{ color: "var(--text-heading)" }}>
                No MS{msLevelFilter} spectra in this file.
              </strong>{" "}
              This file contains{" "}
              {levels
                .filter((l) => (msLevelCounts?.[l] ?? 0) > 0)
                .map((l) => `MS${l}`)
                .join(", ") || "no level-tagged"}{" "}
              spectra.{" "}
              <button className="link-btn" onClick={() => void setMsLevelFilter(null)}>
                Show all spectra
              </button>
            </p>
          </div>
        </div>
      ) : (
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
          <div style={{ position: "relative" }}>
            <SpectrumPlot
              spectrum={selectedSpectrum}
              xicWindow={chromMode === "xic" ? xicParams : null}
            />
            {spectrumLoading && <PlotSpinner label="Loading spectrum…" />}
          </div>
          <p className="stage-hint" style={{ marginTop: "0.25rem" }}>
            {reprHint ? `${reprHint} · ` : ""}scroll to zoom · drag a box to zoom
            m/z · middle-drag to pan · double-click to reset
          </p>
        </div>
        </div>
      )}

      {!navDisabled && selectedMeta != null && (
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
