// ZIP + parquet structure inspection for the Structure tab. Reads the raw ZIP
// entry list (filenames + sizes) and, for parquet members, the footer metadata
// (row/column counts and per-column byte footprint) — all metadata-only, no bulk
// data is materialized.
import type { Reader } from "./open";
import type {
  ArchiveListing,
  ArchiveEntry,
  ParquetColumn,
  ParquetInfo,
} from "./types";

type RawZipEntry = {
  filename?: unknown;
  compressedSize?: unknown;
  uncompressedSize?: unknown;
  directory?: unknown;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v as number);
  return Number.isFinite(n) ? n : 0;
}

// parquet-wasm Compression enum order (note: not the Thrift order).
const CODECS = ["UNCOMPRESSED", "SNAPPY", "GZIP", "BROTLI", "LZ4", "ZSTD", "LZ4_RAW", "LZO"];
function codecName(c: unknown): string {
  const n = typeof c === "number" ? c : Number(c);
  return Number.isInteger(n) && n >= 0 && n < CODECS.length ? CODECS[n] : String(c);
}

/** List every member of the backing ZIP archive with its stored/expanded size. */
export function listArchive(reader: Reader): ArchiveListing {
  const store = (reader as unknown as { store?: { entries?: RawZipEntry[] } }).store;
  const raw = store?.entries ?? [];
  const entries: ArchiveEntry[] = raw
    .filter((e) => e && typeof e.filename === "string")
    .map((e) => {
      const path = String(e.filename);
      return {
        path,
        compressedSize: num(e.compressedSize),
        uncompressedSize: num(e.uncompressedSize),
        isDirectory: e.directory === true || path.endsWith("/"),
        isParquet: path.toLowerCase().endsWith(".parquet"),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  let totalCompressed = 0;
  let totalUncompressed = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    totalCompressed += e.compressedSize;
    totalUncompressed += e.uncompressedSize;
  }
  return { entries, totalCompressed, totalUncompressed };
}

// Minimal structural view of parquet-wasm's footer metadata objects.
type ColumnChunk = {
  columnPath(): string[];
  compressedSize(): number;
  uncompressedSize(): number;
  numValues(): number;
  compression(): unknown;
};
type ParquetHandle = {
  metadata(): {
    fileMetadata(): { numRows(): number; createdBy(): string | undefined };
    numRowGroups(): number;
    rowGroup(i: number): { columns(): ColumnChunk[] };
  };
};
type ParquetStore = Record<string, (() => Promise<ParquetHandle | undefined>) | undefined>;

/**
 * Map a ZIP member name to the ZipStorage accessor that yields its footer-only
 * ParquetFile handle. The mzPeak archive's parquet files are a fixed, small set
 * (spectra/chromatograms × metadata/data/peaks); their names follow the spec's
 * conventions, so a name match is reliable and avoids re-downloading the file.
 */
async function openParquet(
  reader: Reader,
  filename: string,
): Promise<ParquetHandle | null> {
  const store = (reader as unknown as { store?: ParquetStore }).store;
  if (!store) return null;
  const f = filename.toLowerCase();
  const meta = f.includes("meta");
  let accessor: keyof ParquetStore | null = null;
  if (f.includes("chrom")) {
    accessor = meta ? "chromatogramMetadata" : "chromatogramData";
  } else if (f.includes("wavelength")) {
    accessor = meta ? "wavelengthSpectrumMetadata" : "wavelengthSpectrumData";
  } else if (f.includes("spectr")) {
    accessor = meta ? "spectrumMetadata" : f.includes("peak") ? "spectrumPeaks" : "spectrumData";
  }
  const fn = accessor ? store[accessor] : undefined;
  if (typeof fn !== "function") return null;
  try {
    return (await fn.call(store)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Internal table structure of a parquet member: row/column/row-group counts and
 * the per-column byte footprint summed across all row groups. Returns null for a
 * non-parquet member or one whose footer can't be read.
 */
export async function readParquetInfo(
  reader: Reader,
  filename: string,
): Promise<ParquetInfo | null> {
  const handle = await openParquet(reader, filename);
  if (!handle) return null;
  let md: ReturnType<ParquetHandle["metadata"]>;
  try {
    md = handle.metadata();
  } catch {
    return null;
  }

  const fileMd = md.fileMetadata();
  const numRows = num(fileMd.numRows());
  const createdBy = fileMd.createdBy() ?? null;
  const numRowGroups = md.numRowGroups();

  // Sum each column's footprint across all row groups.
  const byColumn = new Map<string, ParquetColumn>();
  for (let g = 0; g < numRowGroups; g++) {
    for (const cc of md.rowGroup(g).columns()) {
      const name = cc.columnPath().join(".");
      const existing = byColumn.get(name);
      const compressedSize = num(cc.compressedSize());
      const uncompressedSize = num(cc.uncompressedSize());
      const numValues = num(cc.numValues());
      if (existing) {
        existing.compressedSize += compressedSize;
        existing.uncompressedSize += uncompressedSize;
        existing.numValues += numValues;
      } else {
        byColumn.set(name, {
          name,
          compressedSize,
          uncompressedSize,
          numValues,
          compression: codecName(cc.compression()),
        });
      }
    }
  }

  const columns = [...byColumn.values()].sort(
    (a, b) => b.compressedSize - a.compressedSize,
  );
  return {
    numRows,
    numColumns: columns.length,
    numRowGroups,
    totalCompressed: columns.reduce((s, c) => s + c.compressedSize, 0),
    totalUncompressed: columns.reduce((s, c) => s + c.uncompressedSize, 0),
    columns,
    createdBy,
  };
}
