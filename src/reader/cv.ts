// Small helpers for reading the reader's promoted-column "meta" bags, which are
// keyed by accession-derived names like "MS_1000511_ms_level" or
// "MS_1000285_total_ion_current_unit_MS_1000131".
import type { Representation } from "./types";

const REPR_PROFILE = "MS:1000128";
const REPR_CENTROID = "MS:1000127";

/** Map a raw MS:1000525 value to the UI representation enum. */
export function toRepresentation(raw: unknown): Representation {
  if (raw === REPR_PROFILE) return "profile";
  if (raw === REPR_CENTROID) return "centroid";
  return null;
}

/**
 * Read the first numeric value from a meta bag whose key contains `accession`
 * (e.g. "1000285"). Tolerant of the unit suffixes the converter appends to
 * promoted column names. Returns null when absent or non-finite.
 */
export function metaNumberByAccession(
  meta: unknown,
  accession: string,
): number | null {
  if (!meta || typeof meta !== "object") return null;
  const needle = accession.replace(":", "_");
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (k.includes(needle) || k.includes(accession)) {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "bigint") return Number(v);
    }
  }
  return null;
}
