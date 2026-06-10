// "Share view" deep-link (de)serialization. Pure + unit-testable: no store, no
// DOM. See docs/share-view-deep-link-SPEC.md. The view = which dataset, which
// tab, which spectrum, the MS-level filter, and the chromatogram mode.

/** The subset of store state that constitutes a shareable view. */
export type ViewState = {
  sourceUrl: string | null;
  tab: string;
  selectedIndex: number | null;
  /** id of the selected spectrum (carries the native scan number when present). */
  selectedId: string | null;
  msLevelFilter: number | null;
  chromMode: "tic" | "xic" | "stored";
  xic: { mz: number; tolDa: number } | null;
  chromStoredId: string | null;
  /** Current spectrum-plot m/z view [lo, hi], or null when at full range. */
  spectrumZoom: [number, number] | null;
};

/** Parsed view params off a query string (all optional). */
export type ViewParams = {
  file?: string;
  tab?: string;
  scan?: string;
  spectrum?: string;
  ms?: string;
  chrom?: string;
  xic?: string;
  /** Spectrum m/z zoom window "lo,hi". */
  mz?: string;
};

const SCAN_RE = /(?:^|[\s;])scan=(\d+)\b/i;
function scanOf(id: string | null): number | null {
  if (!id) return null;
  const m = SCAN_RE.exec(id);
  return m ? Number(m[1]) : null;
}

/** Serialize a view into URL search params. Only non-default state is emitted,
 *  so links stay short. Selection (scan/spectrum) and chromatogram params are
 *  gated on the active tab so the link describes exactly what's on screen. */
export function serializeViewParams(s: ViewState): URLSearchParams {
  const p = new URLSearchParams();
  if (s.sourceUrl) p.set("file", s.sourceUrl);
  if (s.tab && s.tab !== "summary") p.set("tab", s.tab);
  if (s.msLevelFilter != null) p.set("ms", String(s.msLevelFilter));

  if (s.selectedIndex != null) {
    // Prefer the absolute native scan number (stable across re-conversion); fall
    // back to the 0-based index only when the id carries no scan number.
    const scan = scanOf(s.selectedId);
    if (scan != null) p.set("scan", String(scan));
    else p.set("spectrum", String(s.selectedIndex));
    // Spectrum m/z zoom window (omitted at full range).
    if (s.spectrumZoom) p.set("mz", `${round(s.spectrumZoom[0])},${round(s.spectrumZoom[1])}`);
  }

  if (s.chromMode === "xic" && s.xic) p.set("xic", `${s.xic.mz},${s.xic.tolDa}`);
  else if (s.chromMode === "stored" && s.chromStoredId) p.set("chrom", s.chromStoredId);
  else if (s.chromMode === "tic" && s.tab === "chromatograms") p.set("chrom", "tic");

  return p;
}

/** Trim a m/z bound to 4 decimals without trailing zeros. */
function round(v: number): string {
  return Number(v.toFixed(4)).toString();
}

/** Build the full shareable URL for a view. */
export function buildShareUrl(s: ViewState, origin: string, pathname: string): string {
  return `${origin}${pathname}?${serializeViewParams(s).toString()}`;
}

/** Parse a location.search string into {@link ViewParams}. */
export function parseViewParams(search: string): ViewParams {
  const p = new URLSearchParams(search);
  const out: ViewParams = {};
  const file = p.get("file") ?? p.get("url");
  if (file) out.file = file;
  for (const k of ["tab", "scan", "spectrum", "ms", "chrom", "xic", "mz"] as const) {
    const v = p.get(k);
    if (v != null) out[k] = v;
  }
  return out;
}
