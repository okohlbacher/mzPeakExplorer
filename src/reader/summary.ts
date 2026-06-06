// File overview, split into a fast O(1) part (shown immediately) and a single
// async per-spectrum pass (the "explore the rest" step). The async pass yields
// to the event loop periodically so a million-spectrum file never freezes the
// UI, and it produces BOTH the summary aggregates and the Browse navigation
// index in one sweep (no double iteration). No signal arrays are ever read.
import type { Reader } from "./open";
import { metaNumberByAccession, toRepresentation } from "./cv";
import { readImaging } from "./imaging";
import type {
  FileSummary,
  ManifestEntry,
  SpectrumIndexRow,
} from "./types";

const MS_LEVEL_COL = "MS_1000511_ms_level";
const REPR_COL = "MS_1000525_spectrum_representation";
const REPR_PROFILE = "MS:1000128";
const SCAN_LOWER_COL = "MS_1000501_scan_window_lower_limit_unit_MS_1000040";
const SCAN_UPPER_COL = "MS_1000500_scan_window_upper_limit_unit_MS_1000040";
const IMS_POS_X_COL = "IMS_1000050_position_x";
const IMS_POS_Y_COL = "IMS_1000051_position_y";
const TIC_ACC = "1000285"; // total ion current
// Top-level Arrow struct columns of the spectrum-metadata table — the entire
// Browse index can be read from these without materializing each row's nested
// scans/precursors (the slow path that stalled the scan on large files).
const TIME_COL = "time";
const ID_COL = "id";
const TIC_COL = "MS_1000285_total_ion_current_unit_MS_1000131";
const MZ_LOW_COL = "MS_1000528_lowest_observed_mz_unit_MS_1000040";
const MZ_HIGH_COL = "MS_1000527_highest_observed_mz_unit_MS_1000040";

/** Minimal shape of an Apache Arrow child vector (one column). */
type ArrowCol = { get(i: number): unknown } | null;
type ArrowStructVec = {
  length: number;
  getChild?: (name: string) => ArrowCol;
} | null;

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v as number);
  return Number.isFinite(n) ? n : null;
}

function bag(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
}

/** Fields the async scan fills in; merged onto the fast summary when it finishes. */
export type ScanAggregates = Pick<
  FileSummary,
  "msLevelCounts" | "representationCounts" | "mzRange" | "rtRange" | "isImaging"
>;

export type ScanResult = { rows: SpectrumIndexRow[]; aggregates: ScanAggregates };

/**
 * Immediate overview — counts, storage layout, encodings, and a cheap imaging
 * flag from the index discovery block. The per-spectrum fields are left empty
 * (filled in by {@link scanSpectra}). No iteration over all spectra.
 */
export function computeFastSummary(
  reader: Reader,
  manifest: ManifestEntry[],
  fileName: string,
  fileSize: number | null,
): FileSummary {
  const { layout, encodings } = detectLayout(reader);

  // Imaging discovery block (metadata only). Drives both the boolean flag and
  // the detailed imaging readout (pixel grid, optical images, scan geometry).
  const imaging = readImaging(reader);

  return {
    fileName,
    fileSize,
    numSpectra: reader.spectrumMetadata?.length ?? 0,
    numChromatograms: reader.numChromatograms ?? 0,
    numEntities: manifest.length,
    msLevelCounts: {},
    representationCounts: { profile: 0, centroid: 0, unknown: 0 },
    mzRange: null,
    rtRange: null,
    layout,
    encodings,
    isImaging: imaging?.isImaging ?? false,
    imaging,
    instrument: instrumentModel(reader),
  };
}

// Instrument-model CV term (MS:1000031) and a few non-model params to skip when
// the model isn't explicitly tagged.
const INSTRUMENT_MODEL_ACC = "MS:1000031";
const NON_MODEL_NAME = /serial|customization|resolution|software|version/i;

/** Best-effort instrument model name from the first instrument configuration. */
function instrumentModel(reader: Reader): string | null {
  const fm = reader.fileMetadata as
    | { instrumentConfigurations?: unknown[] }
    | undefined;
  const configs = fm?.instrumentConfigurations;
  if (!Array.isArray(configs)) return null;
  for (const cfg of configs) {
    const c = cfg as { parameters?: unknown[]; params?: unknown[] };
    const params = (c.parameters ?? c.params) as
      | { accession?: string; name?: string }[]
      | undefined;
    if (!Array.isArray(params)) continue;
    // Prefer the param explicitly typed as the instrument model.
    const tagged = params.find((p) => p?.accession === INSTRUMENT_MODEL_ACC);
    if (tagged?.name) return tagged.name;
    const named = params.find(
      (p) => typeof p?.name === "string" && p.name && !NON_MODEL_NAME.test(p.name),
    );
    if (named?.name) return named.name;
  }
  return null;
}

/**
 * Single async pass over the spectrum metadata table. Time-sliced: it yields to
 * the event loop whenever a slice has run longer than `SLICE_MS`, so even a
 * multi-hundred-thousand-spectrum file never freezes the UI. Returns the Browse
 * navigation index plus the aggregate stats, and reports progress.
 */
const SLICE_MS = 12;

export async function scanSpectra(
  reader: Reader,
  onProgress?: (done: number, total: number) => void,
): Promise<ScanResult> {
  const sm = reader.spectrumMetadata;
  const n = sm?.length ?? 0;
  // Fast path: read the Browse index straight from the Arrow struct columns. This
  // avoids sm.get(i), which materializes each row's nested scans/precursors — far
  // too slow on a large file (it left `scanned` stuck false, so the MS-level
  // filter showed a perpetual "0"). Fall back to the row path if the column
  // accessor isn't available or the ms-level column is missing.
  const vec = (sm as unknown as { spectra?: ArrowStructVec })?.spectra ?? null;
  if (vec?.getChild && vec.getChild(MS_LEVEL_COL)) {
    return scanByColumns(vec, n, onProgress);
  }
  return scanByRows(reader, n, onProgress);
}

/** Fast Browse-index pass over the top-level Arrow columns (no row materialization). */
async function scanByColumns(
  vec: NonNullable<ArrowStructVec>,
  n: number,
  onProgress?: (done: number, total: number) => void,
): Promise<ScanResult> {
  const get = (name: string): ArrowCol => vec.getChild!(name);
  const msLevelCol = get(MS_LEVEL_COL);
  const reprCol = get(REPR_COL);
  const timeCol = get(TIME_COL);
  const idCol = get(ID_COL);
  const ticCol = get(TIC_COL);
  const mzLoCol = get(MZ_LOW_COL);
  const mzHiCol = get(MZ_HIGH_COL);

  const rows: SpectrumIndexRow[] = new Array(n);
  const msLevelCounts: Record<number, number> = {};
  let profile = 0;
  let centroid = 0;
  let unknownRep = 0;
  let mzMin: number | null = null;
  let mzMax: number | null = null;
  let rtMin: number | null = null;
  let rtMax: number | null = null;
  let sliceStart = performance.now();

  for (let i = 0; i < n; i++) {
    const msLevel = numOrNull(msLevelCol?.get(i));
    if (msLevel !== null) {
      msLevelCounts[msLevel] = (msLevelCounts[msLevel] ?? 0) + 1;
    }

    const representation = toRepresentation(reprCol?.get(i));
    if (representation === "profile") profile++;
    else if (representation === "centroid") centroid++;
    else unknownRep++;

    const time = numOrNull(timeCol?.get(i));
    if (time !== null) {
      if (rtMin === null || time < rtMin) rtMin = time;
      if (rtMax === null || time > rtMax) rtMax = time;
    }

    const lo = numOrNull(mzLoCol?.get(i));
    const hi = numOrNull(mzHiCol?.get(i));
    if (lo !== null && (mzMin === null || lo < mzMin)) mzMin = lo;
    if (hi !== null && (mzMax === null || hi > mzMax)) mzMax = hi;

    rows[i] = {
      index: i,
      id: String(idCol?.get(i) ?? i),
      msLevel,
      representation,
      time,
      tic: numOrNull(ticCol?.get(i)),
    };

    if (performance.now() - sliceStart > SLICE_MS) {
      onProgress?.(i + 1, n);
      await new Promise<void>((r) => setTimeout(r, 0));
      sliceStart = performance.now();
    }
  }
  onProgress?.(n, n);

  return {
    rows,
    aggregates: {
      msLevelCounts,
      representationCounts: { profile, centroid, unknown: unknownRep },
      mzRange: mzMin !== null && mzMax !== null ? [mzMin, mzMax] : null,
      rtRange: rtMin !== null && rtMax !== null ? [rtMin, rtMax] : null,
      // The imaging flag is owned by readImaging() (the authoritative index-block
      // discovery) and OR-merged in the store; the per-spectrum probe is omitted
      // here to keep this pass column-only.
      isImaging: false,
    },
  };
}

/** Fallback: materialize each row (older path) when columns aren't reachable. */
async function scanByRows(
  reader: Reader,
  n: number,
  onProgress?: (done: number, total: number) => void,
): Promise<ScanResult> {
  const sm = reader.spectrumMetadata;
  const rows: SpectrumIndexRow[] = new Array(n);
  const msLevelCounts: Record<number, number> = {};
  let profile = 0;
  let centroid = 0;
  let unknownRep = 0;
  let mzMin: number | null = null;
  let mzMax: number | null = null;
  let rtMin: number | null = null;
  let rtMax: number | null = null;
  let isImaging = false;
  let sliceStart = performance.now();

  for (let i = 0; i < n; i++) {
    const rec = sm!.get(i);
    const m = bag(rec.meta);

    const rawLevel = m[MS_LEVEL_COL];
    const msLevel =
      typeof rawLevel === "number"
        ? rawLevel
        : rec.msLevel != null
          ? numOrNull(rec.msLevel)
          : null;
    if (msLevel !== null && Number.isFinite(msLevel)) {
      msLevelCounts[msLevel] = (msLevelCounts[msLevel] ?? 0) + 1;
    }

    const reprRaw = m[REPR_COL] ?? (rec.isProfile ? REPR_PROFILE : undefined);
    const representation = toRepresentation(reprRaw);
    if (representation === "profile") profile++;
    else if (representation === "centroid") centroid++;
    else unknownRep++;

    const time =
      typeof rec.time === "number" && Number.isFinite(rec.time) ? rec.time : null;
    if (time !== null) {
      if (rtMin === null || time < rtMin) rtMin = time;
      if (rtMax === null || time > rtMax) rtMax = time;
    }

    for (const scan of rec.scans ?? []) {
      const sb = bag(scan.meta);
      const lo = sb[SCAN_LOWER_COL];
      const hi = sb[SCAN_UPPER_COL];
      if (typeof lo === "number" && Number.isFinite(lo)) {
        if (mzMin === null || lo < mzMin) mzMin = lo;
      }
      if (typeof hi === "number" && Number.isFinite(hi)) {
        if (mzMax === null || hi > mzMax) mzMax = hi;
      }
      if (
        !isImaging &&
        (sb[IMS_POS_X_COL] !== undefined || sb[IMS_POS_Y_COL] !== undefined)
      ) {
        isImaging = true;
      }
    }

    rows[i] = {
      index: i,
      id: String(rec.id),
      msLevel,
      representation,
      time,
      tic: metaNumberByAccession(rec.meta, TIC_ACC),
    };

    if (performance.now() - sliceStart > SLICE_MS) {
      onProgress?.(i + 1, n);
      await new Promise<void>((r) => setTimeout(r, 0));
      sliceStart = performance.now();
    }
  }
  onProgress?.(n, n);

  return {
    rows,
    aggregates: {
      msLevelCounts,
      representationCounts: { profile, centroid, unknown: unknownRep },
      mzRange: mzMin !== null && mzMax !== null ? [mzMin, mzMax] : null,
      rtRange: rtMin !== null && rtMax !== null ? [rtMin, rtMax] : null,
      isImaging,
    },
  };
}

const BF_CHUNK = new Set([
  "chunk_values",
  "chunk_encoding",
  "chunk_start",
  "chunk_end",
  "chunk_secondary",
  "chunk_transform",
]);

function detectLayout(reader: Reader): {
  layout: FileSummary["layout"];
  encodings: string[];
} {
  const bufferFormats = new Set<string>();
  const encodings = new Set<string>();

  const collect = (idx: unknown) => {
    if (!idx || typeof idx !== "object") return;
    const entries = (idx as { entries?: unknown[] }).entries;
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      const entry = e as { bufferFormat?: string; arrayTypeCURIE?: string };
      if (entry.bufferFormat) bufferFormats.add(String(entry.bufferFormat));
      if (entry.arrayTypeCURIE) encodings.add(String(entry.arrayTypeCURIE));
    }
  };
  collect(reader._spectrumDataReader?.arrayIndex);
  collect(reader._spectrumPeaksReader?.arrayIndex);

  let layout: FileSummary["layout"] = "unknown";
  if (bufferFormats.size > 0) {
    const hasPoint = bufferFormats.has("point");
    const hasChunk = [...bufferFormats].some((b) => BF_CHUNK.has(b));
    if (hasPoint && hasChunk) layout = "mixed";
    else if (hasChunk) layout = "chunked";
    else if (hasPoint) layout = "point";
  }

  return { layout, encodings: [...encodings].sort() };
}
