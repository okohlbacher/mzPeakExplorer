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
          ? Number(rec.msLevel)
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
