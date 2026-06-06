// UI-facing types for the reader boundary.
//
// Everything ABOVE src/reader/ speaks only these plain shapes — no apache-arrow
// Vectors, no `bigint`, no mzpeakts internals leak upward. The reader/ folder is
// the only place that touches the (explicitly unstable) mzPeak format.

/** One entity row from `mzpeak_index.json`. */
export type ManifestEntry = {
  name: string;
  entityType: string;
  dataKind: string;
};

/** One member of the `.mzpeak` ZIP archive (Structure tab). */
export type ArchiveEntry = {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
  isDirectory: boolean;
  isParquet: boolean;
};

/** The ZIP listing plus its rolled-up totals. */
export type ArchiveListing = {
  entries: ArchiveEntry[];
  totalCompressed: number;
  totalUncompressed: number;
};

/** Per-column footprint inside a parquet file (summed across row groups). */
export type ParquetColumn = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  numValues: number;
  compression: string;
};

/** Internal table structure of one parquet member (from its footer metadata). */
export type ParquetInfo = {
  numRows: number;
  numColumns: number;
  numRowGroups: number;
  totalCompressed: number;
  totalUncompressed: number;
  columns: ParquetColumn[];
  createdBy: string | null;
};

/** The five file-level metadata groups, kept generic for the tree view. */
export type FileMeta = {
  fileDescription: unknown;
  instrumentConfigurations: unknown[];
  software: unknown[];
  dataProcessing: unknown[];
  run: unknown;
  samples: unknown[];
};

/** profile / centroid, derived from MS:1000525. */
export type Representation = "profile" | "centroid" | null;

/** One optical image embedded in an imaging archive (metadata.imaging.images[]). */
export type OpticalImage = {
  archivePath: string;
  sourceName: string | null;
  mediaType: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  sha256: string | null;
};

/**
 * Parsed `metadata.imaging` discovery block (mzPeak imaging spec). All fields
 * beyond `isImaging` / `coordinateBase` are optional per the schema.
 */
export type ImagingInfo = {
  isImaging: boolean;
  coordinateBase: number | null;
  pixelCount: { x: number; y: number; z: number | null } | null;
  pixelCountSource: string | null;
  mzRange: [number, number] | null;
  pixelSizeUm: { x: number; y: number } | null;
  maxDimensionUm: { x: number; y: number } | null;
  scanPattern: string | null;
  scanType: string | null;
  lineScanDirection: string | null;
  linescanSequence: string | null;
  images: OpticalImage[];
};

/**
 * OpenMS FileInfo-style aggregate readout. Everything here is derived from the
 * eagerly-loaded metadata tables — no signal arrays are read to compute it.
 */
export type FileSummary = {
  fileName: string;
  fileSize: number | null;
  numSpectra: number;
  numChromatograms: number;
  numEntities: number;
  /** spectra count per MS level, e.g. { 1: 120, 2: 880 }. */
  msLevelCounts: Record<number, number>;
  representationCounts: { profile: number; centroid: number; unknown: number };
  /** [min, max] over per-spectrum scan windows, or null when not derivable. */
  mzRange: [number, number] | null;
  /** [min, max] retention time (seconds) over all spectra, or null. */
  rtRange: [number, number] | null;
  /** point / chunked / mixed, inferred from the array-index buffer formats. */
  layout: "point" | "chunked" | "mixed" | "unknown";
  /** unique array-encoding CURIEs found in the array index. */
  encodings: string[];
  isImaging: boolean;
  /** Parsed imaging discovery block when this is an imaging archive, else null. */
  imaging: ImagingInfo | null;
  /** Best-effort instrument model name from the instrument configuration. */
  instrument: string | null;
};

/** A lightweight per-spectrum index row used by the Browse navigator. */
export type SpectrumIndexRow = {
  index: number;
  id: string;
  msLevel: number | null;
  representation: Representation;
  /** retention time in seconds, or null when the file has no time column. */
  time: number | null;
  /** total ion current from MS:1000285 if promoted, else null. */
  tic: number | null;
};

/** Reconstructed signal arrays for one spectrum. */
export type SpectrumArrays = {
  index: number;
  id: string;
  msLevel: number | null;
  representation: Representation;
  time: number | null;
  mz: Float64Array;
  intensity: Float32Array;
};

/** One point of an extracted-ion / total-ion chromatogram. */
export type ChromPoint = { time: number; index: number; intensity: number };

/** A stored chromatogram (e.g. the TIC written by the converter). */
export type StoredChromatogram = {
  index: number;
  id: string;
  time: Float64Array;
  intensity: Float32Array;
};

export type LoadStage = "idle" | "loading" | "ready" | "error";
