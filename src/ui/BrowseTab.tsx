import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { ChromPlot } from "./ChromPlot";
import { SpectrumPlot } from "./SpectrumPlot";
import { TreeView } from "./TreeView";
import { Button, Select, TextField } from "./components";

export function BrowseTab() {
  const initBrowse = useStore((s) => s.initBrowse);
  // Lazily load the first spectrum + a cheap TIC the first time Browse is opened.
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
  const selectByTime = useStore((s) => s.selectByTime);
  const scanned = useStore((s) => s.scanned);
  const msLevelFilter = useStore((s) => s.msLevelFilter);
  const setMsLevelFilter = useStore((s) => s.setMsLevelFilter);
  const stepSpectrum = useStore((s) => s.stepSpectrum);

  const chrom = useStore((s) => s.chrom);
  const chromMode = useStore((s) => s.chromMode);
  const chromLoading = useStore((s) => s.chromLoading);
  const xicParams = useStore((s) => s.xicParams);
  const runXic = useStore((s) => s.runXic);
  const showTic = useStore((s) => s.showTic);

  const [mz, setMz] = useState("");
  const [tol, setTol] = useState("0.01");

  // Navigation works off the spectrum COUNT (known at open), independent of the
  // optional per-spectrum index scan. `spectra` rows only enrich the header /
  // the TIC navigator once a scan has run.
  const n = numSpectra;
  if (n === 0) {
    return <p className="hint">This file contains no spectra to browse.</p>;
  }

  const selRow =
    selectedIndex != null ? spectra[selectedIndex] : undefined;
  const selTime = selectedSpectrum?.time ?? selRow?.time ?? null;

  const chromTitle =
    chromMode === "xic" && xicParams
      ? `XIC — m/z ${xicParams.mz} ± ${xicParams.tolDa}`
      : "Total ion chromatogram";

  function submitXic() {
    const m = Number(mz);
    const t = Number(tol);
    if (Number.isFinite(m) && m > 0 && Number.isFinite(t) && t > 0) {
      void runXic(m, t);
    }
  }

  // Levels to offer: the real set (with counts) once scanned, else 1/2/3.
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

  // When an MS level is selected, the spectrum index + counter are relative to
  // that level's spectra only (browse only those). "All" → absolute over the file.
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

        <div className="control-row" style={{ marginLeft: "auto" }}>
          <TextField
            label="XIC m/z"
            type="number"
            step="0.001"
            width="6rem"
            placeholder="e.g. 445.12"
            value={mz}
            onChange={(e) => setMz(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitXic()}
          />
          <TextField
            label="± tol"
            type="number"
            step="0.001"
            width="4rem"
            suffix="Da"
            value={tol}
            onChange={(e) => setTol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitXic()}
          />
          <Button size="sm" variant="primary" disabled={!mz} onClick={submitXic}>
            Extract
          </Button>
          {(chromMode === "xic" || !chrom) && (
            <Button size="sm" disabled={chromLoading} onClick={() => void showTic()}>
              {chromMode === "xic" ? "Show TIC" : "Build TIC"}
            </Button>
          )}
        </div>
      </div>

      {/* Dark "data stage" — both plots live here (handoff §7). */}
      <div className="data-stage">
        <div className="stage-plot">
          <h4 className="stage-h">
            {chromTitle}
            <span className="stage-meta">
              {chromLoading
                ? "computing…"
                : chrom
                  ? `${chrom.length} points · click to navigate`
                  : "not computed"}
            </span>
          </h4>
          {chrom || chromLoading ? (
            <ChromPlot
              points={chrom ?? []}
              onPick={(t) => void selectByTime(t)}
              selectedTime={selTime}
            />
          ) : (
            <p className="stage-hint" style={{ padding: "1.2rem 0.2rem" }}>
              <strong style={{ color: "var(--text-on-stage)" }}>Build TIC</strong>{" "}
              scans the per-spectrum index (metadata only); if the file has no
              precomputed total-ion-current column it sums every spectrum. Or
              extract an XIC for a specific m/z window above.
            </p>
          )}
        </div>

        <div className="stage-divider" />

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

      {/* Spectrum metadata is inspector content (light chrome), below the stage. */}
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
