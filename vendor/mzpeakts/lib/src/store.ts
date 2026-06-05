// @ts-check
import * as zip from "@zip.js/zip.js";
import { ParquetFile, setPanicHook } from "parquet-wasm";

setPanicHook();

export enum DataKind {
  DataArrays = "data arrays",
  Metadata = "metadata",
  Peaks = "peaks",
  Proprietary = "proprietary",
}

export enum EntityType {
  Spectrum = "spectrum",
  Chromatogram = "chromatogram",
  WavelengthSpectrum = "wavelength spectrum",
  Other = "other",
}

export class FileIndexEntry {
  name: string;
  data_kind: DataKind;
  entity_type: EntityType;

  constructor(name: string, data_kind: DataKind, entity_type: EntityType) {
    this.name = name;
    this.data_kind = data_kind;
    this.entity_type = entity_type;
  }

  get dataKind(): DataKind {
    return this.data_kind;
  }

  get entityType(): EntityType {
    return this.entity_type;
  }
}

export class FileIndex {
  metadata: any;
  files: FileIndexEntry[];

  static FILE_NAME: string = "mzpeak_index.json";

  constructor(files: FileIndexEntry[], metadata: any | undefined = undefined) {
    this.files = files;
    this.metadata = metadata ? metadata : {};
  }

  static fromRaw(indexObj: any) {
    const files = Array.from(indexObj.files).map(
      (e: any) => new FileIndexEntry(e.name, e.data_kind, e.entity_type),
    );
    return new FileIndex(files, indexObj.metadata);
  }
}

/**
 * Low-level mzPeak storage that is backed by an uncompressed `ZIP` archive that is either local
 * or remote to the runtime.
 */
export class ZipStorage<T> {
  /** The raw {@linkcode zip.Reader} that backs this archive */
  reader: zip.Reader<T>;
  /** The `ZIP` reader on top of {@link reader} */
  archive: zip.ZipReader<T>;
  /** mzPeak archive metadata describing the standardized files */
  fileIndex: FileIndex;
  /** Raw `ZIP` metadata entries */
  entries: zip.Entry[];
  /** Whether the {@linkcode init} method has been called. */
  initialized: boolean;

  /**
   * The raw constructor for `ZipStorage` that works directly on `zip.js`'s `Reader` base type.
   *
   * Prefer {@linkcode `fromUrl`} or {@linkcode `fromBlob`} for most cases as they automatically call `init` as well.
   *
   * @param reader The underlying ZIP reader
   * @see {@linkcode ZipStorage.fromUrl} - For initializing from URLs
   * @see {@linkcode ZipStorage.fromBlob} - For initializing from {@linkcode Blob} or similar interface
   */
  constructor(reader: zip.Reader<T>) {
    this.reader = reader;
    this.archive = new zip.ZipReader(reader);
    this.fileIndex = new FileIndex([]);
    this.entries = [];
    this.initialized = false;
  }

  /**
   * Open a {@linkcode RemoteBlob} for the requested member of the ZIP archive by name
   * @param {string} filename - The name of the file to open from the archive.
   * @returns {RemoteBlob<T> | undefined} If `filename` is found, then a `RemoteBlob` is returned,
   * otherwise `undefined` is returned instead.
   */
  async open(filename: string): Promise<RemoteBlob<T> | undefined> {
    if (!this.initialized) await this.init();

    const entry = this.entries.find((e) => e.filename == filename);
    if (entry === undefined) return undefined;
    return RemoteBlob.fromEntry(this.reader, entry);
  }

  /**
   * Create a `ZipStorage` instance from a URL.
   * @param url The URL for the mzPeak file stored on an accessible server. If this is a cross-origin request, care must be taken to allow range request headers
   * @returns {ZipStorage<zip.HttpRangeReader>} The storage configured for loading via HTTP requests.
   */
  static async fromUrl(url: string | URL) {
    const store = new ZipStorage(
      new zip.HttpRangeReader(url, {
        headers: [["Access-Control-Allow-Origin", "*"]],
      }),
    );
    await store.init();
    return store;
  }

  /**
   * Create a {@linkcode ZipStorage} instance from a {@linkcode Blob}-like object. This works with local files
   * (including those attached to a browser window) or anything exposing a `Blob`-like API like `slice`, `size`,
   * `arrayBuffer`, et. al.
   *
   * @param {Blob | RemoteBlob} blob The `Blob`-like object to read from. This might be a `RemoteBlob` too
   * @returns {ZipStorage<zip.BlobReader>} The storage configured for loading content via `Blob.slice` calls
   */
  static async fromBlob(blob: Blob) {
    const store = new ZipStorage(new zip.BlobReader(blob));
    await store.init();
    return store;
  }

  /**
   * Open a ZIP archive member based upon its entry in {@linkcode fileIndex}. This cannot open files not in the index
   * and should not be used to open proprietary files listed in the index directly.
   * @param entityType The {@linkcode EntityType} to look up in the {@linkcode fileIndex}
   * @param dataKind The {@linkcode DataKind} to look up in the {@linkcode fileIndex}
   * @returns {RemoteBlob<T> | undefined} If a matching entry is found, then a `RemoteBlob` is returned,
   * otherwise `undefined` is returned instead.
   *
   * @see {@linkcode ZipStorage.open}
   */
  async openFromIndex(
    entityType: EntityType,
    dataKind: DataKind,
  ): Promise<RemoteBlob<T> | undefined> {
    if (!this.initialized) await this.init();
    const entry = this.fileIndex.files.find(
      (e) => e.dataKind == dataKind && e.entityType == entityType,
    );
    if (entry === undefined) return undefined;
    return this.open(entry.name);
  }

  async spectrumMetadata(): Promise<ParquetFile | undefined> {
    const blob = await this.openFromIndex(
      EntityType.Spectrum,
      DataKind.Metadata,
    );
    if (!blob) return undefined;
    return ParquetFile.fromFile(blob as any as Blob);
  }

  async spectrumData(): Promise<ParquetFile | undefined> {
    const blob = await this.openFromIndex(
      EntityType.Spectrum,
      DataKind.DataArrays,
    );
    if (!blob) return undefined;
    return ParquetFile.fromFile(blob as any as Blob);
  }

  async spectrumPeaks(): Promise<ParquetFile | undefined> {
    const blob = await this.openFromIndex(EntityType.Spectrum, DataKind.Peaks);
    if (!blob) return undefined;
    return ParquetFile.fromFile(blob as any as Blob);
  }

  async chromatogramMetadata(): Promise<ParquetFile | undefined> {
    const blob = await this.openFromIndex(
      EntityType.Chromatogram,
      DataKind.Metadata,
    );
    if (!blob) return undefined;
    return ParquetFile.fromFile(blob as any as Blob);
  }

  async chromatogramData(): Promise<ParquetFile | undefined> {
    const blob = await this.openFromIndex(
      EntityType.Chromatogram,
      DataKind.DataArrays,
    );
    if (!blob) return undefined;
    return ParquetFile.fromFile(blob as any as Blob);
  }

  async wavelengthSpectrumMetadata(): Promise<ParquetFile | undefined> {
    const blob = await this.openFromIndex(
      EntityType.WavelengthSpectrum,
      DataKind.Metadata,
    );
    if (!blob) return undefined;
    return ParquetFile.fromFile(blob as any as Blob);
  }

  async wavelengthSpectrumData(): Promise<ParquetFile | undefined> {
    const blob = await this.openFromIndex(
      EntityType.WavelengthSpectrum,
      DataKind.DataArrays,
    );
    if (!blob) return undefined;
    return ParquetFile.fromFile(blob as any as Blob);
  }

  /**
   * Read the file index JSON file from the source and initialize the `fileIndex` property.
   *
   * @throws {Error} if the index JSON file is not found or not properly formatted.
   */
  async init() {
    if (this.initialized) return;

    this.entries = [];
    const it = this.archive.getEntriesGenerator();
    for await (let entry of it) {
      this.entries.push(entry);
      if (entry.filename == FileIndex.FILE_NAME) {
        const rawIndex = JSON.parse(
          await (await RemoteBlob.fromEntry(this.reader, entry)).text(),
        );
        this.fileIndex = FileIndex.fromRaw(rawIndex);
        this.initialized = true;
      }
    }
    if (!this.initialized) {
      throw new Error(
        `File index did not contain "${FileIndex.FILE_NAME}", not a valid mzPeak ZIP!`,
      );
    }
  }
}

async function readZipHeaderSize<T>(blob: RemoteBlob<T>) {
  const arrayBuffer = await blob.slice(0, 30).arrayBuffer();
  const view = new DataView(arrayBuffer);
  let offset = 30;
  const nameSize = view.getUint16(26, true);
  const extraSize = view.getUint16(28, true);
  return offset + nameSize + extraSize;
}

/**
 * An abstraction that mimicks the built-in {@linkcode Blob} interface but serves data
 * using a {@linkcode zip.Reader} instance. This may refer to a byte range of a larger
 * data store as in a `ZIP` archive.
 */
export class RemoteBlob<T> {
  /** The backing data that may be local or remote */
  source: zip.Reader<T>;
  /** A human-readable name or URL */
  name: string;
  /** The end of the byte range that defines this data source */
  end: number;
  /** The start of the byte range that defines this data source */
  start: number;
  /** A MIME type, not required, part of the {@linkcode Blob} interface */
  type: string | undefined;

  static async fromEntry<T extends zip.Initializable & zip.ReadableReader>(
    sourceUrl: zip.Reader<T>,
    entry: zip.Entry,
  ) {
    const blob = new RemoteBlob(
      sourceUrl,
      entry.filename,
      entry.offset,
      entry.offset + entry.uncompressedSize,
    );
    const headerSize = await readZipHeaderSize(blob);
    blob.start += headerSize;
    blob.end += headerSize;
    return blob;
  }

  constructor(
    source: zip.Reader<T>,
    name: string,
    start: number,
    end: number,
    type: string | undefined = undefined,
  ) {
    this.source = source;
    this.name = name;
    this.end = end;
    this.start = start;
    this.type = type;
  }

  /**
   * Create a new {@linkcode RemoteBlob} from  a slice of this object's byte range.
   *
   * The new instance shares this instance's {@linkcode source}.
   *
   * @see {@linkcode Blob.slice} */
  slice(
    start: number | undefined = undefined,
    end: number | undefined = undefined,
  ) {
    if (start === undefined) {
      return this;
    } else if (end === undefined) {
      return new RemoteBlob(
        this.source,
        this.name,
        this.start + start,
        this.end,
        this.type,
      );
    } else {
      return new RemoteBlob(
        this.source,
        this.name,
        this.start + start,
        this.start + end,
        this.type,
      );
    }
  }

  /** @see {@linkcode Blob.size} */
  get size() {
    return this.end - this.start;
  }

  private async _read(): Promise<Uint8Array> {
    const buf = await this.source.readUint8Array(
      this.start,
      this.end - this.start,
    );
    return buf;
  }

  /**
   * Read the raw data storage of this blob
   * @returns The raw {@linkcode ArrayBuffer} backing this blob.
   * @see {@linkcode Blob.arrayBuffer}
   */
  async arrayBuffer(): Promise<ArrayBuffer> {
    return (await this._read()).buffer as ArrayBuffer;
  }

  /**
   * Read the bytes of this blob
   * @returns The data of this blob represented as {@linkcode Uint8Array}
   * @see {@linkcode Blob.bytes}
   */
  async bytes(): Promise<Uint8Array> {
    return this._read();
  }

  /**
   * Read the bytes of this blob interpreted as UTF-8
   * @returns The data of this blob represented as {@linkcode string}
   * @see {@linkcode Blob.text}
   */
  async text(): Promise<string> {
    const buf = await this._read();
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(buf);
  }
}
