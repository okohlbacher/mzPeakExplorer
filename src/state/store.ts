import { create } from "zustand";

import { openBlob, openUrl, type Reader } from "../reader/open";
import { fileMeta as readFileMeta, indexMetadata, manifest as readManifest } from "../reader/meta";
import { computeFastSummary, scanSpectra } from "../reader/summary";
import {
  chromatogramIds,
  extractChromatogram,
  getSpectrumArrays,
  getSpectrumMetadata,
  getStoredChromatogram,
} from "../reader/browse";
import type {
  ChromPoint,
  FileMeta,
  FileSummary,
  LoadStage,
  ManifestEntry,
  SpectrumArrays,
  SpectrumIndexRow,
} from "../reader/types";

// The live reader is held OUTSIDE zustand state — it is a large object full of
// Arrow tables and WASM handles that React must never diff or re-render against.
let reader: Reader | null = null;

// Bumped on every load so a slow async scan from a previous file can detect that
// a newer file has superseded it and bail out instead of clobbering state.
let loadGen = 0;

export type Tab = "summary" | "metadata" | "browse";
export type ChromMode = "tic" | "xic";

type XicParams = { mz: number; tolDa: number };

type State = {
  tab: Tab;
  stage: LoadStage;
  error: string | null;

  fileName: string | null;
  fileSize: number | null;
  summary: FileSummary | null;
  fileMeta: FileMeta | null;
  manifest: ManifestEntry[];
  indexMeta: unknown;

  // The per-spectrum scan (msLevels / ranges / Browse index) is expensive on a
  // huge file, so it is NOT run on open — only on demand or for small files.
  scanning: boolean;
  scanned: boolean;
  /** 0..1 while a scan runs, else null. */
  scanProgress: number | null;

  // Browse state
  spectra: SpectrumIndexRow[];
  /** When set, Prev/Next step only through spectra of this MS level. */
  msLevelFilter: number | null;
  selectedIndex: number | null;
  selectedSpectrum: SpectrumArrays | null;
  /** Plainified full metadata for the selected spectrum (params, scans, precursors). */
  selectedMeta: unknown;
  spectrumLoading: boolean;

  chromMode: ChromMode;
  chrom: ChromPoint[] | null;
  chromLoading: boolean;
  xicParams: XicParams | null;
  storedChromIds: { index: number; id: string }[];
  /** True once the Browse tab has lazily loaded its first spectrum + cheap TIC. */
  browseInited: boolean;
};

type Actions = {
  setTab: (tab: Tab) => void;
  openFile: (file: File) => Promise<void>;
  openUrl: (url: string) => Promise<void>;
  /** Run the per-spectrum scan on demand (MS levels, ranges, Browse index). */
  computeBreakdown: () => Promise<void>;
  initBrowse: () => Promise<void>;
  selectSpectrum: (index: number) => Promise<void>;
  selectByTime: (time: number) => Promise<void>;
  /** Restrict Prev/Next navigation to one MS level (null = all). Scans if needed. */
  setMsLevelFilter: (level: number | null) => Promise<void>;
  /** Move to the next (+1) / previous (-1) spectrum, honoring the MS-level filter. */
  stepSpectrum: (dir: 1 | -1) => Promise<void>;
  runXic: (mz: number, tolDa: number) => Promise<void>;
  showTic: () => Promise<void>;
};

const initial: State = {
  tab: "summary",
  stage: "idle",
  error: null,
  fileName: null,
  fileSize: null,
  summary: null,
  fileMeta: null,
  manifest: [],
  indexMeta: null,
  scanning: false,
  scanned: false,
  scanProgress: null,
  spectra: [],
  selectedIndex: null,
  selectedSpectrum: null,
  selectedMeta: null,
  spectrumLoading: false,
  chromMode: "tic",
  chrom: null,
  chromLoading: false,
  xicParams: null,
  storedChromIds: [],
  browseInited: false,
  msLevelFilter: null,
};

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export const useStore = create<State & Actions>((set, get) => ({
  ...initial,

  setTab: (tab) => set({ tab }),

  async openFile(file) {
    await load(set, get, file.name, file.size, () => openBlob(file));
  },

  async openUrl(url) {
    const name = url.split("/").pop() || url;
    await load(set, get, name, null, () => openUrl(url));
  },

  // Run the per-spectrum scan on demand (the "Compute breakdown" / "Build TIC"
  // paths). No-op if it's already running or done for the current file.
  async computeBreakdown() {
    if (!reader || get().scanning || get().scanned) return;
    await runScan(set, get, reader, loadGen);
  },

  // Lazily load the Browse tab's first spectrum on first visit. Loads ONE
  // spectrum (cheap) and shows a cheap TIC only if the per-spectrum index has
  // already been scanned. The scan itself is on demand (Build TIC), never here.
  async initBrowse() {
    if (!reader || get().browseInited) return;
    set({ browseInited: true });
    const n = get().summary?.numSpectra ?? 0;
    if (n > 0) void get().selectSpectrum(get().selectedIndex ?? 0);
    const cheap = cheapTic(get().spectra);
    if (cheap) set({ chromMode: "tic", chrom: cheap });
  },

  async selectSpectrum(index) {
    if (!reader) return;
    // Metadata is instant (from the in-memory table) — show it before the signal
    // arrays finish loading.
    set({
      selectedIndex: index,
      spectrumLoading: true,
      selectedMeta: getSpectrumMetadata(reader, index),
    });
    try {
      const spectrum = await getSpectrumArrays(reader, index);
      // Ignore if the user moved on to another spectrum meanwhile.
      if (get().selectedIndex === index) {
        set({ selectedSpectrum: spectrum, spectrumLoading: false });
      }
    } catch (err) {
      set({ spectrumLoading: false, error: describeError(err), stage: "error" });
    }
  },

  async selectByTime(time) {
    const rows = get().spectra;
    if (rows.length === 0) return;
    // Navigate within the active MS-level filter (so a TIC click on a filtered
    // browse stays on that level); fall back to all if the filter has no rows.
    const filter = get().msLevelFilter;
    const filtered = filter == null ? rows : rows.filter((r) => r.msLevel === filter);
    const pool = filtered.length > 0 ? filtered : rows;
    let best = pool[0];
    let bestD = Infinity;
    for (const r of pool) {
      const t = r.time ?? r.index;
      const d = Math.abs(t - time);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    await get().selectSpectrum(best.index);
  },

  async setMsLevelFilter(level) {
    // Filtering needs each spectrum's MS level — that comes from the scan.
    if (level !== null && !get().scanned) await get().computeBreakdown();
    set({ msLevelFilter: level });
    if (level === null) return;
    // If the current spectrum isn't on the chosen level, jump to the first that is.
    const rows = get().spectra;
    const cur = get().selectedIndex;
    const curRow = cur != null ? rows[cur] : undefined;
    if (!curRow || curRow.msLevel !== level) {
      const first = rows.find((r) => r.msLevel === level);
      if (first) await get().selectSpectrum(first.index);
    }
  },

  async stepSpectrum(dir) {
    const n = get().summary?.numSpectra ?? 0;
    if (n === 0) return;
    const cur = get().selectedIndex ?? 0;
    const filter = get().msLevelFilter;
    const rows = get().spectra;
    // No filter (or no scanned index yet): plain ±1 over all spectra.
    if (filter === null || rows.length === 0) {
      const next = cur + dir;
      if (next >= 0 && next < n) await get().selectSpectrum(next);
      return;
    }
    // rows[i] corresponds to spectrum i — walk to the next matching MS level.
    for (let i = cur + dir; i >= 0 && i < rows.length; i += dir) {
      if (rows[i]?.msLevel === filter) {
        await get().selectSpectrum(i);
        return;
      }
    }
  },

  async runXic(mz, tolDa) {
    if (!reader) return;
    set({ chromMode: "xic", chromLoading: true, xicParams: { mz, tolDa } });
    try {
      const useProfile = (get().summary?.representationCounts.centroid ?? 0) === 0;
      const points = await extractChromatogram(reader, { mz, tolDa, useProfile });
      set({ chrom: points, chromLoading: false });
    } catch (err) {
      set({ chromLoading: false, error: describeError(err), stage: "error" });
    }
  },

  async showTic() {
    if (!reader) return;
    set({ chromMode: "tic", chromLoading: true, xicParams: null });
    try {
      // Need the per-spectrum index (promoted TIC column) — scan if not done.
      if (!get().scanned) await get().computeBreakdown();
      const tic = await buildTic(reader, get().spectra);
      if (tic === null) {
        set({ chromLoading: false });
        alert(
          `This file has no precomputed total-ion-current column, and summing ` +
            `${get().spectra.length.toLocaleString()} spectra in the browser is too ` +
            `expensive. Extract an XIC for a specific m/z window instead.`,
        );
        return;
      }
      set({ chrom: tic, chromLoading: false });
    } catch (err) {
      set({ chromLoading: false, error: describeError(err), stage: "error" });
    }
  },
}));

/** Shared open path for file + URL loads. */
async function load(
  set: (partial: Partial<State>) => void,
  get: () => State & Actions,
  fileName: string,
  fileSize: number | null,
  open: () => Promise<Reader>,
): Promise<void> {
  const gen = ++loadGen;
  set({ ...initial, tab: get().tab, stage: "loading", fileName, fileSize });
  try {
    // Open reads only metadata + parquet footers — never the signal data.
    reader = await open();
    if (gen !== loadGen) return; // a newer load superseded this one

    // Fast overview: counts, layout, encodings, file metadata — O(1), shown now.
    const manifest = readManifest(reader);
    const summary = computeFastSummary(reader, manifest, fileName, fileSize);
    const fileMeta = readFileMeta(reader);
    const indexMeta = indexMetadata(reader);
    const storedChromIds = chromatogramIds(reader);

    set({
      stage: "ready",
      summary,
      fileMeta,
      manifest,
      indexMeta,
      storedChromIds,
      spectra: [],
      selectedIndex: null,
    });

    // Per the "metadata + counts, nothing else" rule, the per-spectrum scan does
    // NOT run on open. Small files scan automatically in the background (it's
    // quick and fills MS levels / ranges / the TIC); large files wait for an
    // explicit "Compute breakdown" / "Build TIC" so opening stays instant.
    if (summary.numSpectra > 0 && summary.numSpectra <= AUTO_SCAN_LIMIT) {
      void runScan(set, get, reader, gen);
    }
  } catch (err) {
    if (gen !== loadGen) return;
    reader = null;
    set({ stage: "error", error: describeError(err) });
  }
}

/** Below this spectrum count, scan automatically on open; above it, on demand. */
const AUTO_SCAN_LIMIT = 50_000;

/**
 * The time-sliced per-spectrum scan. Guarded against a newer load superseding
 * it. Updates progress as it goes and merges the aggregates + Browse index when
 * done. Returns when complete so callers (showTic) can await it.
 */
async function runScan(
  set: (partial: Partial<State>) => void,
  get: () => State & Actions,
  r: Reader,
  gen: number,
): Promise<void> {
  set({ scanning: true, scanProgress: 0 });
  const { rows, aggregates } = await scanSpectra(r, (done, total) => {
    if (gen === loadGen) set({ scanProgress: total ? done / total : 1 });
  });
  if (gen !== loadGen) return; // stale — a newer file is loading
  const prev = get().summary;
  set({
    scanning: false,
    scanned: true,
    scanProgress: null,
    spectra: rows,
    // Merge aggregates, but the imaging flag is the OR of the index-block flag
    // (authoritative discovery) and the per-spectrum coordinate probe — the scan
    // must not downgrade a file the index block already declared as imaging.
    summary: prev
      ? { ...prev, ...aggregates, isImaging: prev.isImaging || aggregates.isImaging }
      : prev,
    selectedIndex: get().selectedIndex ?? (rows.length > 0 ? 0 : null),
  });
  // If Browse is showing the TIC, fill in the cheap TIC now that we have the index.
  const s = get();
  if (s.browseInited && s.chromMode === "tic" && !s.chrom) {
    const cheap = cheapTic(rows);
    if (cheap) set({ chrom: cheap });
  }
}

/**
 * The TIC is an MS1 trace by convention — only MS1 spectra contribute. Falls
 * back to all spectra when the file tags no MS1 (e.g. untagged levels) so the
 * trace is never spuriously empty.
 */
function ticRows(rows: SpectrumIndexRow[]): SpectrumIndexRow[] {
  const ms1 = rows.filter((row) => row.msLevel === 1);
  return ms1.length > 0 ? ms1 : rows;
}

/**
 * Cheap TIC: built entirely from the promoted per-spectrum TIC column (MS:1000285)
 * already in metadata — no signal I/O. MS1-only. Returns null when the column is
 * absent for any contributing spectrum (a TIC would then require a whole-file read).
 */
function cheapTic(rows: SpectrumIndexRow[]): ChromPoint[] | null {
  const use = ticRows(rows);
  if (use.length === 0 || !use.every((row) => row.tic !== null)) return null;
  return use
    .map((row) => ({
      index: row.index,
      time: row.time ?? row.index,
      intensity: row.tic as number,
    }))
    .sort((a, b) => a.time - b.time);
}

/**
 * Build a total-ion chromatogram (MS1-only). Prefer the cheap metadata-only path.
 * The fallback sums every spectrum's signal — a whole-file read — so it is refused
 * above AUTO_SCAN_LIMIT spectra (returns null) to avoid freezing the browser on a
 * multi-gigabyte file that lacks a promoted TIC column.
 */
async function buildTic(
  r: Reader,
  rows: SpectrumIndexRow[],
): Promise<ChromPoint[] | null> {
  const cheap = cheapTic(rows);
  if (cheap) return cheap;
  if (rows.length > AUTO_SCAN_LIMIT) return null; // too expensive to sum
  const useProfile = rows.some((row) => row.representation !== "centroid");
  const all = await extractChromatogram(r, { useProfile });
  // Restrict the summed trace to MS1 spectra.
  const ms1 = new Set(rows.filter((row) => row.msLevel === 1).map((row) => row.index));
  return ms1.size > 0 ? all.filter((p) => ms1.has(p.index)) : all;
}

/** Read a stored chromatogram by index (used by the Browse stored-chrom picker). */
export async function loadStoredChromatogram(index: number) {
  if (!reader) return null;
  return getStoredChromatogram(reader, index);
}
