// The ONE module that imports `mzpeakts`. Everything else depends on the opaque
// `Reader` handle re-exported here. `grep -rl "from \"mzpeakts\"" src/` must
// return only this file.
import { MzPeakReader } from "mzpeakts";

/**
 * Opaque reader handle. Concretely an mzpeakts `MzPeakReader`, but callers treat
 * it as a black box and go through the helpers in summary.ts / browse.ts.
 */
export type Reader = InstanceType<typeof MzPeakReader>;

/**
 * Eagerly trigger the spectrum-data reader so the array index is populated
 * (needed for layout/encoding detection). Best-effort: a file with no spectrum
 * data must still open.
 */
async function warm(reader: Reader): Promise<Reader> {
  try {
    await reader.spectrumData();
  } catch {
    // Some files (e.g. chromatogram-only) have no spectrum data — ignore.
  }
  return reader;
}

/** Open a `.mzpeak` from a local File/Blob (no bytes leave the browser). */
export async function openBlob(blob: Blob): Promise<Reader> {
  return warm(await MzPeakReader.fromBlob(blob));
}

/** Open a `.mzpeak` from a URL (HTTP range requests via zip.js). */
export async function openUrl(url: string | URL): Promise<Reader> {
  return warm(await MzPeakReader.fromUrl(url));
}
