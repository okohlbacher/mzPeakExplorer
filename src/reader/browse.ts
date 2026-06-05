// Navigation + signal access for the Browse tab: a lightweight per-spectrum
// index, single-spectrum reconstruction, XIC extraction, and stored-chromatogram
// access. All return plain typed arrays / POJOs — no Arrow, no bigint upward.
import type { Reader } from "./open";
import { toRepresentation } from "./cv";
import { plainify } from "./plainify";
import type {
  ChromPoint,
  Representation,
  SpectrumArrays,
  StoredChromatogram,
} from "./types";

const MZ_KEY = "m/z array";
const INTENSITY_KEY = "intensity array";
const TIME_KEY = "time array";
const REPR_COL = "MS_1000525_spectrum_representation";
const REPR_PROFILE = "MS:1000128";

function bag(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
}

function recRepresentation(rec: {
  meta?: unknown;
  isProfile?: boolean;
}): Representation {
  const m = bag(rec.meta);
  const raw = m[REPR_COL] ?? (rec.isProfile ? REPR_PROFILE : undefined);
  return toRepresentation(raw);
}

/**
 * Full per-spectrum metadata for the selected spectrum, plainified for the
 * Metadata tree (CV params, scans + scan windows, precursors, and the promoted
 * column bag). Metadata-only — reads the already-loaded spectrum metadata table,
 * no signal I/O.
 */
export function getSpectrumMetadata(reader: Reader, index: number): unknown {
  const sm = reader.spectrumMetadata;
  if (!sm) return null;
  const rec = sm.get(index) as unknown as {
    id?: unknown;
    msLevel?: unknown;
    time?: unknown;
    parameters?: unknown;
    params?: unknown;
    scans?: unknown;
    precursors?: unknown;
    meta?: unknown;
  };
  return plainify({
    index,
    id: rec.id,
    msLevel: rec.msLevel,
    representation: recRepresentation(rec),
    time: rec.time,
    parameters: rec.parameters ?? rec.params,
    scans: rec.scans,
    precursors: rec.precursors,
    promotedColumns: rec.meta,
  });
}

type RawSpectrum = {
  id: unknown;
  msLevel?: number | null;
  time?: number | null;
  meta?: unknown;
  isProfile?: boolean;
  dataArrays?: Record<string, ArrayLike<number>> | undefined;
  centroids?: { mz: number; intensity: number }[] | undefined;
};

/** Read + reconstruct spectrum `index` into plain typed arrays. */
export async function getSpectrumArrays(
  reader: Reader,
  index: number,
): Promise<SpectrumArrays> {
  const spectrum = (await reader.getSpectrum(index)) as RawSpectrum | null;
  if (!spectrum) throw new Error(`No spectrum at index ${index}`);

  const id = String(spectrum.id);
  const representation = recRepresentation(spectrum);
  const time =
    typeof spectrum.time === "number" && Number.isFinite(spectrum.time)
      ? spectrum.time
      : null;
  const msLevel =
    typeof spectrum.msLevel === "number" ? spectrum.msLevel : null;

  let mz: Float64Array;
  let intensity: Float32Array;

  const da = spectrum.dataArrays;
  const centroids = spectrum.centroids;
  // Prefer the profile data-array source; fall back to centroids (spectra_peaks).
  if (representation !== "centroid" && da && da[MZ_KEY] && da[INTENSITY_KEY]) {
    mz = Float64Array.from(da[MZ_KEY]);
    intensity = Float32Array.from(da[INTENSITY_KEY]);
  } else if (centroids && centroids.length > 0) {
    const k = centroids.length;
    mz = new Float64Array(k);
    intensity = new Float32Array(k);
    for (let i = 0; i < k; i++) {
      mz[i] = centroids[i].mz;
      intensity[i] = centroids[i].intensity;
    }
  } else if (da && da[MZ_KEY] && da[INTENSITY_KEY]) {
    mz = Float64Array.from(da[MZ_KEY]);
    intensity = Float32Array.from(da[INTENSITY_KEY]);
  } else {
    throw new Error(`Spectrum ${index} has no reconstructable m/z + intensity arrays`);
  }

  if (mz.length !== intensity.length) {
    throw new Error(
      `Spectrum ${index}: m/z (${mz.length}) / intensity (${intensity.length}) length mismatch`,
    );
  }
  return { index, id, msLevel, representation, time, mz, intensity };
}

type XicPoint = {
  index: bigint | number;
  time: number | null;
  dataArrays: Record<string, ArrayLike<number> | ArrayLike<string> | undefined>;
};

/**
 * Extract an ion chromatogram: for each spectrum in the (optional) time range,
 * sum the intensity within the (optional) m/z window. With both ranges null this
 * is the total-ion chromatogram. `useProfile` routes to spectra_data vs
 * spectra_peaks.
 */
export async function extractChromatogram(
  reader: Reader,
  opts: {
    mz?: number | null;
    tolDa?: number | null;
    timeRange?: [number, number] | null;
    useProfile?: boolean;
  } = {},
): Promise<ChromPoint[]> {
  const { mz = null, tolDa = null, timeRange = null, useProfile = true } = opts;
  const mzRange =
    mz != null && tolDa != null
      ? { start: mz - tolDa, end: mz + tolDa }
      : null;
  const tRange =
    timeRange != null ? { start: timeRange[0], end: timeRange[1] } : null;

  const xic = await reader.extractXIC(tRange, mzRange, useProfile);
  if (!xic) return [];

  const out: ChromPoint[] = [];
  for (const p of xic.points as XicPoint[]) {
    const arr = p.dataArrays[INTENSITY_KEY];
    let sum = 0;
    if (arr) {
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (typeof v === "number" && Number.isFinite(v)) sum += v;
      }
    }
    out.push({
      index: Number(p.index),
      time: typeof p.time === "number" ? p.time : Number(p.index),
      intensity: sum,
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** List + read stored chromatograms (e.g. the TIC the converter wrote). */
export async function getStoredChromatogram(
  reader: Reader,
  index: number,
): Promise<StoredChromatogram | null> {
  const chrom = (await reader.getChromatogram(index)) as
    | { id: unknown; dataArrays?: Record<string, ArrayLike<number>> }
    | null
    | undefined;
  if (!chrom || !chrom.dataArrays) return null;
  const da = chrom.dataArrays;
  const t = da[TIME_KEY];
  const inten = da[INTENSITY_KEY];
  if (!t || !inten) return null;
  return {
    index,
    id: String(chrom.id),
    time: Float64Array.from(t),
    intensity: Float32Array.from(inten),
  };
}

export function chromatogramIds(reader: Reader): { index: number; id: string }[] {
  const cm = reader.chromatogramMetadata;
  const n = cm?.length ?? 0;
  const out: { index: number; id: string }[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ index: i, id: String(cm!.get(i).id) });
  }
  return out;
}
