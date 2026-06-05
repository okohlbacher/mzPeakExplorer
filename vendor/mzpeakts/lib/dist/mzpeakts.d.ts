import * as Arrow from 'apache-arrow';
import { Dates } from 'apache-arrow/type';
import { FloatArray } from 'apache-arrow/type';
import { IntArray } from 'apache-arrow/type';
import { ParquetFile } from 'parquet-wasm';
import * as zip from '@zip.js/zip.js';

export declare class ArrayIndex {
    prefix: string;
    entries: ArrayIndexEntry[];
    byFieldName: Map<string, ArrayIndexEntry>;
    constructor(prefix?: string, entries?: ArrayIndexEntry[]);
    rebuildFieldNameMap(): void;
    static fromJSON(obj: any): ArrayIndex;
    hasArrayType(arrayTypeCURIE: string): boolean;
    entriesFor(arrayTypeCURIE: string): ArrayIndexEntry[];
    inferBufferFormat(): BufferFormat | null;
}

export declare class ArrayIndexEntry {
    context: BufferContext;
    path: string;
    dataTypeCURIE: string;
    arrayTypeCURIE: string;
    arrayName: string;
    unitCURIE: string | null;
    transform: string | null;
    bufferFormat: BufferFormat;
    dataProcessingId: string | null;
    bufferPriority: BufferPriority | null;
    sortingRank: number | null;
    /** Populated at runtime; not serialized. */
    schemaIndex: number | null;
    constructor(context: BufferContext, path: string, dataTypeCURIE: string, arrayTypeCURIE: string, arrayName: string, bufferFormat: BufferFormat, unitCURIE?: string | null, transform?: string | null, dataProcessingId?: string | null, bufferPriority?: BufferPriority | null, sortingRank?: number | null);
    static fromJSON(obj: any): ArrayIndexEntry;
    createColumnName(): string;
    equals(other: ArrayIndexEntry): boolean;
    get fieldName(): string;
    arrowBuilder(): Arrow.Float64Builder<null | undefined> | Arrow.Float32Builder<null | undefined> | Arrow.Int32Builder<null | undefined> | Arrow.Int64Builder<null | undefined> | Arrow.Uint8Builder<null | undefined>;
    emptyArrow(): Arrow.Vector<Arrow.Float64> | Arrow.Vector<Arrow.Float32> | Arrow.Vector<Arrow.Int32> | Arrow.Vector<Arrow.Int64> | Arrow.Vector<Arrow.Uint8>;
}

declare class BaseLayoutReader {
    arrayIndex: ArrayIndex;
    protected batches: AsyncIterableIterator<Arrow.RecordBatch>;
    protected spacingModels: Map<bigint, SpacingInterpolationModel> | undefined;
    private _queryCoordinateRange;
    get queryCoordinateRange(): Span1D | null;
    set queryCoordinateRange(value: Span1D | null);
    constructor(batches: AsyncIterableIterator<Arrow.RecordBatch>, arrayIndex: ArrayIndex, spacingModels?: Map<bigint, SpacingInterpolationModel>, queryCoordinateRange?: {
        start: number;
        end: number;
    } | null);
    processSelectedRows(_entryIndex: bigint, rootStruct: Arrow.Vector<Arrow.Struct>, selectedRows: number[]): ColumnMap;
    processRows(entryIndex: bigint, rootStruct: Arrow.Vector<Arrow.Struct>): ColumnMap;
    postprocessRowsOf(entryIndex: bigint, nBats: number, accumulated: Record<string, Arrow.Vector[]>): Arrow.Table<{
        [x: string]: Arrow.Float64 | Arrow.Float32 | Arrow.Int32 | Arrow.Int64 | Arrow.Uint8 | Arrow.Null | Arrow.Bool | Arrow.Int8 | Arrow.Int16 | Arrow.Uint16 | Arrow.Uint32 | Arrow.Uint64 | Arrow.Dictionary<Arrow.Utf8, Arrow.Int32> | Arrow.Date_<Dates> | Arrow.List<never> | Arrow.Struct<{}>;
    }>;
    readRowsOf(entryIndex: bigint, startFrom: bigint | null, endAt: bigint | null): Promise<Arrow.Table>;
    handleTransforms(entry: ArrayIndexEntry | undefined, entryIndex: bigint, array: Arrow.Vector<Arrow.Float>): Arrow.Vector<Arrow.Float<Arrow.Type.Float | Arrow.Type.Float16 | Arrow.Type.Float32 | Arrow.Type.Float64>>;
}

export declare enum BufferContext {
    Spectrum = "spectrum",
    Chromatogram = "chromatogram",
    WavelengthSpectrum = "wavelength_spectrum"
}

export declare enum BufferFormat {
    Point = "point",
    ChunkValues = "chunk_values",
    ChunkStart = "chunk_start",
    ChunkEnd = "chunk_end",
    ChunkEncoding = "chunk_encoding",
    ChunkSecondary = "chunk_secondary",
    ChunkTransform = "chunk_transform"
}

export declare enum BufferPriority {
    Primary = "primary",
    Secondary = "secondary"
}

export declare class Chromatogram extends ParamDescribed {
    id: string;
    index: bigint;
    params: Param[];
    precursors: Precursor[];
    selectedIons: SelectedIon[];
    meta: any | null;
    dataArrays?: DataArrays;
    constructor(id: string, index: bigint, params: Param[], precursors?: any[], selectedIons?: any[], meta?: any | null, dataArrays?: DataArrays);
    get rawArrays(): DataArrays | undefined;
    static fromRecord(record: any): Chromatogram;
}

export declare class ChromatogramMetadata extends MetadataReaderBase {
    _chromatograms: Arrow.Vector | null;
    _precursors: Arrow.Vector | null;
    _selectedIons: Arrow.Vector | null;
    constructor(handle: ParquetFile);
    makeIteratorHelpers(): IteratorLookupTables;
    static fromParquet(handle: ParquetFile): Promise<ChromatogramMetadata>;
    init(): Promise<this>;
    protected get _mainStruct(): Arrow.Vector<any> | null;
    get chromatograms(): Arrow.Vector<any> | null;
    get precursors(): Arrow.Vector<any> | null;
    get selectedIons(): Arrow.Vector<any> | null;
    get length(): number;
    get(index: number | bigint): Chromatogram;
}

export declare class ChunkLayoutReader extends BaseLayoutReader {
    private mainAxisEntry;
    private chunkStartFieldName;
    private chunkEndFieldName;
    private chunkEncodingFieldName;
    private chunkValuesFieldName;
    private secondaryFields;
    constructor(batches: AsyncIterableIterator<Arrow.RecordBatch>, arrayIndex: ArrayIndex, spacingModels?: Map<bigint, SpacingInterpolationModel>);
    private configureIndices;
    processSelectedRows(entryIndex: bigint, rootStruct: Arrow.Vector<Arrow.Struct>, selectedRows: number[]): ColumnMap;
}

declare type ColumnMap = Record<string, Arrow.Vector>;

export declare namespace data {
    export {
        packTableIntoDataArrays,
        packTableIntoPeaks,
        findMaskedPairs,
        estimateMedianDelta,
        interpolateNulls,
        DataArrays,
        SpacingInterpolationModel,
        NULL_INTERPOLATE_CURIE,
        NULL_ZERO_CURIE,
        GroupTagBounds,
        RangeIndex,
        DataArraysReaderMeta,
        BaseLayoutReader,
        PointLayoutReader,
        ChunkLayoutReader,
        DataArraysReader,
        DataStreamIterator,
        PeekableDataStreamIterator
    }
}

export declare type DataArrays = Record<string, FloatArray | IntArray | string[]>;

export declare class DataArraysReader {
    bufferContext: BufferContext;
    handle: ParquetFile;
    metadata: DataArraysReaderMeta;
    constructor(handle: ParquetFile, meta: DataArraysReaderMeta);
    static fromParquet(handle: ParquetFile, context: BufferContext): Promise<DataArraysReader>;
    get arrayIndex(): ArrayIndex;
    get rowGroupIndex(): RangeIndex;
    get format(): BufferFormat;
    get length(): number | undefined;
    get spacingModels(): Map<bigint, SpacingInterpolationModel> | null;
    set spacingModels(v: Map<bigint, SpacingInterpolationModel> | null);
    makeLayoutReader(batches: AsyncIterableIterator<Arrow.RecordBatch>): BaseLayoutReader;
    get(key_: bigint | number): Promise<Arrow.Table | null>;
    getRange(start_: bigint | number, end_: bigint | number): Promise<{
        index: bigint;
        dataArrays: Arrow.Table<any> | ColumnMap;
    }[] | null>;
    /**
     * Extract a contiguous region of the coordinate space in an entry index range, like when building and
     * extracted ion chromatogram (XIC)
     *
     * @param indexRange The start and end entry index to extract between, otherwise all entries are used
     * @param coordinateRange The start and end coordinate (e.g. m/z, time) to extract between, otherwise all points are used
     * @returns An array of untimed {@coderef XICPoint}
     */
    extractRangeFor(indexRange: Span1DBigInt | null, coordinateRange?: Span1D | null): Promise<{
        index: bigint;
        dataArrays: DataArrays;
    }[]>;
    _getRangeIter(start: bigint, end: bigint): Promise<PeekableDataStreamIterator | null>;
    enumerate(batchSize?: number | undefined): PeekableDataStreamIterator;
    [Symbol.asyncIterator](): AsyncIterator<[bigint, Arrow.Table | ColumnMap]>;
}

export declare class DataArraysReaderMeta {
    context: BufferContext;
    arrayIndex: ArrayIndex;
    rowGroupIndex: RangeIndex;
    pageKeyIndex: JsDataPage<bigint>[] | null;
    format: BufferFormat;
    spacingModels: Map<bigint, SpacingInterpolationModel> | null;
    constructor(context: BufferContext, arrayIndex: ArrayIndex, rowGroupIndex: RangeIndex, format: BufferFormat, spacingModels?: Map<bigint, SpacingInterpolationModel> | null, pageKeyIndex?: JsDataPage<bigint>[] | null);
    static fromParquet(handle: ParquetFile, context: BufferContext): Promise<DataArraysReaderMeta>;
    findPageFor(index: bigint): {
        offset: number;
        limit: number | null;
    } | null;
    findPageForRange(startIdx: bigint, endIdx: bigint): {
        offset: number;
        limit: number | null;
    } | null;
}

export declare enum DataKind {
    DataArrays = "data arrays",
    Metadata = "metadata",
    Peaks = "peaks",
    Proprietary = "proprietary"
}

export declare class DataProcessingMethod {
    id: string;
    methods: ProcessingMethod[];
    constructor(id: string, methods: ProcessingMethod[]);
    static fromJSON(raw: any): DataProcessingMethod;
}

declare class DataStreamIterator implements AsyncIterator<[bigint, Arrow.Table | ColumnMap]>, AsyncIterable<[bigint, Arrow.Table | ColumnMap]> {
    private reader;
    private batchStream;
    private layoutReader;
    private currentBatch;
    private currentIndex;
    private _current;
    private initialized;
    constructor(reader: DataArraysReader, batchStream: AsyncIterableIterator<Arrow.RecordBatch>);
    get current(): [bigint, Arrow.Vector<Arrow.Struct> | ColumnMap];
    setQueryCoordinateRange(query: Span1D | null): void;
    private readNextBatch;
    private initialize;
    private batchHasCurrentIndex;
    private batchNextIndex;
    private extractForCurrentIndex;
    private moveNextAsync;
    next(): Promise<IteratorResult<[bigint, Arrow.Table | ColumnMap]>>;
    [Symbol.asyncIterator](): AsyncIterator<[bigint, Arrow.Table | ColumnMap]>;
}

export declare enum EntityType {
    Spectrum = "spectrum",
    Chromatogram = "chromatogram",
    WavelengthSpectrum = "wavelength spectrum",
    Other = "other"
}

/**
 * Find the 2nd median of the consecutive differences of `data`.
 *
 * This is a relatively crude spacing estimate for continuous profile data.
 *
 * @returns A tuple of [secondMedian, filteredDeltas] where filteredDeltas are
 * the diff values that are <= the first median.
 */
declare function estimateMedianDelta(data: number[] | FloatArray): [number, number[]];

export declare class FileDescription {
    contents: Param[];
    sourceFiles: SourceFile[];
    constructor(contents: Param[], sourceFiles: SourceFile[]);
    static fromJSON(raw: any): FileDescription;
}

export declare class FileIndex {
    metadata: any;
    files: FileIndexEntry[];
    static FILE_NAME: string;
    constructor(files: FileIndexEntry[], metadata?: any | undefined);
    static fromRaw(indexObj: any): FileIndex;
}

export declare class FileIndexEntry {
    name: string;
    data_kind: DataKind;
    entity_type: EntityType;
    constructor(name: string, data_kind: DataKind, entity_type: EntityType);
    get dataKind(): DataKind;
    get entityType(): EntityType;
}

export declare class FileMetadata {
    fileDescription: FileDescription;
    instrumentConfigurations: InstrumentConfiguration[];
    software: Software[];
    samples: Sample[];
    dataProcessingMethods: DataProcessingMethod[];
    run?: MSRun;
    constructor(fileDescription: FileDescription, instrumentConfigurations: InstrumentConfiguration[], software: Software[], samples: Sample[], dataProcessingMethods: DataProcessingMethod[], run?: MSRun);
    static fromParquet(handle: ParquetFile): FileMetadata;
}

/**
 * Construct index ranges between pairs of masked values in `maskedVector`.
 *
 * The first and last index range will include the beginning and ending
 * of the array respectively, even if the mask does not start/end with a
 * `true` value.
 *
 * The resulting array contains [start, end) pairs (end is exclusive) of the
 * spans between two `true` values (or the termini of the array).
 *
 * Warning: can fail or produce incorrect output if there are runs of
 * `true` values longer than 2 in the mask.
 */
declare function findMaskedPairs(maskedVector: Arrow.Vector): [number, number][];

export declare class GroupTagBounds {
    key: bigint;
    start: bigint;
    end: bigint;
    constructor(key: bigint, start: bigint, end: bigint);
    contains(value: bigint): boolean;
}

declare interface HasSourceIndex {
    source_index: bigint | null;
    parameters?: Arrow.Vector | Param[];
}

export declare class InstrumentComponent extends ParamDescribed {
    componentType: string;
    order: number;
    constructor(componentType: string, order: number, parameters: Param[]);
    static fromJSON(raw: any): InstrumentComponent;
}

export declare class InstrumentConfiguration extends ParamDescribed {
    id: number;
    components: InstrumentComponent[];
    softwareReference?: string;
    constructor(id: number, components: InstrumentComponent[], parameters: Param[], softwareReference?: string);
    static fromJSON(raw: any): InstrumentConfiguration;
}

declare function interpolateNulls(values: Arrow.Vector<Arrow.Float>, model: SpacingInterpolationModel): Arrow.Vector<Arrow.Float>;

export declare class IsolationWindow {
    target: number;
    lowerOffset: number;
    upperOffset: number;
    constructor(target: number, lower: number, upper: number);
    get lowerBound(): number;
    get upperBound(): number;
    static fromRecord(record: any): IsolationWindow;
}

declare type IteratorLookupTables = Record<string, Map<bigint, HasSourceIndex[]>>;

declare interface JsDataPage<T> {
    min: T | undefined;
    max: T | undefined;
    null_count: number | undefined;
    row_group_index: number;
    start_row: number;
    end_row: number;
}

declare abstract class MetadataReaderBase {
    /** The backing Parquet file */
    handle: ParquetFile;
    /** Whether the {@link init} method has been called, which asynchronously loads data */
    initialized: boolean;
    protected _iteratorHelpers: IteratorLookupTables | null;
    /**
     * The basic constructor for {@link MetadataReaderBase} instances. This does not
     * complete the initialization process. Call the asynchronous {@link init} method
     * to finish loading data.
     *
     * @param handle The Parquet file this reader uses
     */
    constructor(handle: ParquetFile);
    abstract makeIteratorHelpers(): IteratorLookupTables;
    protected get _mainStruct(): Arrow.Vector<Arrow.Struct> | null;
    /**
     * Get the number of profile data points for this entry
     * @returns {integer} the number of points
     * */
    dataPointCount(index: number): number | null;
    /**
     * Get the array of profile data points for this entry
     * @returns {Arrow.Vector<Arrow.Uint64>} the array number of points
     * */
    dataPointCount(): null | Arrow.Vector<Arrow.Uint64>;
    /** Get the number of peaks for this entry
     * @returns {integer} the number of peaks
     */
    peakCount(index: number): number | null;
    /**
     * Get the array of peak counts for this entry
     * @returns {Arrow.Vector<Arrow.Uint64>} the array number of peaks
     * */
    peakCount(): null | Arrow.Vector<Arrow.Uint64>;
    /**
     * Asynchronously load metadata tables from Parquet file
     */
    init(): Promise<this>;
    /** Get the number of entries of the main data sequence in this reader */
    get length(): number;
    /**
     * Read the Parquet file completely into memory.
     * @returns An Arrow {@link Arrow.Table}
     */
    protected readTable(): Promise<Arrow.Table<Arrow.TypeMap>>;
}

export declare class MSRun {
    id: string;
    defaultDataProcessingId?: string;
    defaultInstrumentId?: number;
    defaultSourceFileId?: string;
    startTime?: Date;
    constructor(id: string, defaultDataProcessingId?: string, defaultInstrumentId?: number, defaultSourceFileId?: string, startTime?: Date);
    static fromJSON(raw: any): MSRun;
}

/**
 * A reader for mzPeak files.
 *
 * This reader eagerly loads metadata but lazily loads signal data.
 *
 * <attribute>a</attribute>
 */
export declare class MzPeakReader<T> implements AsyncIterable<Spectrum> {
    /**
     * The storage backend for the mzPeak file. This is a ZIP archive that is either
     * available as a `Blob` local to the runtime or available over HTTP(S) range requests.
     */
    store: ZipStorage<T>;
    /**
     * A reader for mass spectrum metadata that has been loaded eagerly.
     */
    spectrumMetadata: SpectrumMetadata | null;
    /** A reader for chromatogram or trace metadata that has been loaded eagerly */
    chromatogramMetadata: ChromatogramMetadata | null;
    /**
     * A reader for wavelength spectrum metadata that has been loaded eagerly.
     */
    wavelengthMetadata: SpectrumMetadata | null;
    /**
     * Whether the initial asynchronous metadata loading done by {@linkcode init} has completed.
     *
     * This only necessary if {@link constructor} is called directly instead of {@linkcode fromStore},
     * {@linkcode fromUrl}, or {@linkcode fromBlob}.
     */
    initialized: boolean;
    _spectrumDataReader: DataArraysReader | null;
    _spectrumPeaksReader: DataArraysReader | null;
    _chromatogramDataReader: DataArraysReader | null;
    _wavelengthSpectrumDataReader: DataArraysReader | null;
    _fileMetadata: FileMetadata | undefined;
    /**
     * Construct a {@linkcode MzPeakReader} from a {@linkcode ZipStorage}
     * @param store The data storage to read from.
     * @see {@link fromStore}, {@link fromUrl}, and {@link fromBlob}.
     */
    constructor(store: ZipStorage<T>);
    get fileMetadata(): FileMetadata | undefined;
    static fromStore<T>(store: ZipStorage<T>): Promise<MzPeakReader<T>>;
    static fromUrl(url: string | URL): Promise<MzPeakReader<unknown>>;
    static fromBlob(blob: Blob): Promise<MzPeakReader<unknown>>;
    init(): Promise<this>;
    spectrumData(): Promise<DataArraysReader | null>;
    enumerateSpectra(): AsyncGenerator<Spectrum, void, unknown>;
    spectrumPeaks(): Promise<DataArraysReader | null>;
    chromatogramData(): Promise<DataArraysReader | null>;
    wavelengthSpectrumData(): Promise<DataArraysReader | null>;
    getSpectrum(index_: bigint | number): Promise<Spectrum | undefined>;
    extractXIC(timeRange: Span1D | null, mzRange?: Span1D | null, useProfile?: boolean): Promise<XIC | null>;
    get numSpectra(): number;
    getChromatogram(index_: bigint | number): Promise<Chromatogram | undefined>;
    get numChromatograms(): number;
    getWavelengthSpectrum(index_: bigint | number): Promise<Spectrum | undefined>;
    get numWavelengthSpectra(): number;
    at(index: bigint | number): Promise<Spectrum | undefined>;
    get(index: bigint | number): Promise<Spectrum | undefined>;
    get length(): number;
    [Symbol.asyncIterator](): AsyncGenerator<Spectrum, void, unknown>;
}

declare const NULL_INTERPOLATE_CURIE = "MS:1003901";

declare const NULL_ZERO_CURIE = "MS:1003902";

declare function packTableIntoDataArrays(table: Arrow.Table): DataArrays;

declare function packTableIntoPeaks(table: Arrow.Table): {
    [x: string]: string | number;
}[];

export declare class Param {
    name: string;
    value: any | null;
    accession: string | null;
    unit: string | null;
    constructor(name: string, value: any | null, accession?: string | null, unit?: string | null);
    static fromJSON(raw: any): Param;
    static fromArrow(array: Arrow.Vector): Param[];
}

export declare class ParamColumnSpec {
    source: string;
    name: string;
    accession: string | null;
    unit: string | null;
    isUnitOnly: boolean;
    constructor(source: string, name: string, accession?: string | null, unit?: string | null, isUnitOnly?: boolean);
    static fromColumnName(colName: string): ParamColumnSpec;
}

declare class ParamDescribed {
    params: Param[];
    meta?: any;
    constructor(params: Param[]);
    get parameters(): Param[];
    getParamByAccession(accession: string): Param | undefined;
}

export declare class PeekableDataStreamIterator implements AsyncIterator<[bigint, Arrow.Table | ColumnMap]>, AsyncIterable<[bigint, Arrow.Table | ColumnMap]> {
    inner: DataStreamIterator;
    private peeked;
    constructor(inner: DataStreamIterator);
    get currentIndex(): bigint | null;
    peek(): Promise<[bigint, Arrow.Table<any> | ColumnMap] | null>;
    next(): Promise<IteratorReturnResult<any> | IteratorYieldResult<[bigint, Arrow.Table<any> | ColumnMap]> | {
        done: boolean;
        value: [bigint, Arrow.Table<any> | ColumnMap];
    }>;
    seek(index_: bigint): Promise<boolean>;
    setQueryCoordinateRange(query: Span1D | null): void;
    [Symbol.asyncIterator](): AsyncIterator<[bigint, Arrow.Table | ColumnMap]>;
}

export declare class PointLayoutReader extends BaseLayoutReader {
    processSelectedRows(entryIndex: bigint, rootStruct: Arrow.Vector<Arrow.Struct>, selectedRows: number[]): ColumnMap;
}

declare interface PointLike {
    mz: number;
    intensity: number;
}

export declare class Precursor {
    sourceIndex: bigint;
    precursorIndex: bigint;
    activation: Param[];
    isolationWindow: IsolationWindow;
    meta: any;
    constructor(sourceIndex: bigint, precursorIndex: bigint, activation: Param[], isolationWindow: IsolationWindow, meta?: any);
    static fromRecord(record: any): Precursor;
}

export declare class ProcessingMethod extends ParamDescribed {
    order: number;
    constructor(order: number, parameters: Param[]);
    static fromJSON(raw: any): ProcessingMethod;
}

export declare class RangeIndex implements Iterable<GroupTagBounds> {
    ranges: GroupTagBounds[];
    constructor(ranges: GroupTagBounds[]);
    get length(): number;
    [Symbol.iterator](): Iterator<GroupTagBounds>;
    findByKey(key: bigint): GroupTagBounds | null;
    keysFor(index_: bigint): bigint[];
}

/**
 * An abstraction that mimicks the built-in {@linkcode Blob} interface but serves data
 * using a {@linkcode zip.Reader} instance. This may refer to a byte range of a larger
 * data store as in a `ZIP` archive.
 */
export declare class RemoteBlob<T> {
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
    static fromEntry<T extends zip.Initializable & zip.ReadableReader>(sourceUrl: zip.Reader<T>, entry: zip.Entry): Promise<RemoteBlob<T>>;
    constructor(source: zip.Reader<T>, name: string, start: number, end: number, type?: string | undefined);
    /**
     * Create a new {@linkcode RemoteBlob} from  a slice of this object's byte range.
     *
     * The new instance shares this instance's {@linkcode source}.
     *
     * @see {@linkcode Blob.slice} */
    slice(start?: number | undefined, end?: number | undefined): RemoteBlob<T>;
    /** @see {@linkcode Blob.size} */
    get size(): number;
    private _read;
    /**
     * Read the raw data storage of this blob
     * @returns The raw {@linkcode ArrayBuffer} backing this blob.
     * @see {@linkcode Blob.arrayBuffer}
     */
    arrayBuffer(): Promise<ArrayBuffer>;
    /**
     * Read the bytes of this blob
     * @returns The data of this blob represented as {@linkcode Uint8Array}
     * @see {@linkcode Blob.bytes}
     */
    bytes(): Promise<Uint8Array>;
    /**
     * Read the bytes of this blob interpreted as UTF-8
     * @returns The data of this blob represented as {@linkcode string}
     * @see {@linkcode Blob.text}
     */
    text(): Promise<string>;
}

export declare class Sample extends ParamDescribed {
    id: string;
    name: string;
    constructor(id: string, name: string, parameters: Param[]);
    static fromJSON(raw: any): Sample;
}

export declare class Scan extends ParamDescribed {
    sourceIndex: bigint;
    instrumentConfigurationRef: number;
    params: Param[];
    scanWindows: any[];
    injectionTime?: number;
    presetScanConfiguration?: number;
    meta: any | null;
    constructor(sourceIndex: bigint, instrumentConfigurationRef: number, params: Param[], scanWindows?: any[], injectionTime?: number, presetScanConfiguration?: number, meta?: any);
    static fromRecord(record: any): Scan;
}

export declare class SelectedIon extends ParamDescribed {
    sourceIndex: bigint;
    precursorIndex: bigint;
    chargeState: number | null;
    intensity: number | null;
    mz: number | null;
    ionMobility: number | null;
    params: Param[];
    meta: any;
    constructor(sourceIndex: bigint, precursorIndex: bigint, mz?: number, intensity?: number, chargeState?: number | null, ionMobility?: number | null, parameters?: Param[], meta?: any);
    static fromRecord(record: any): SelectedIon;
}

export declare class Software extends ParamDescribed {
    id: string;
    version: string;
    constructor(id: string, version: string, parameters: Param[]);
    static fromJSON(raw: any): Software;
}

export declare class SourceFile extends ParamDescribed {
    id: string;
    name: string;
    location: string;
    constructor(id: string, name: string, location: string, parameters: Param[]);
    static fromJSON(raw: any): SourceFile;
}

export declare class SpacingInterpolationModel {
    coefficients: number[];
    constructor(coefficients: number[]);
    predict(value: number): number;
    static fromArrow(value: Arrow.Vector<Arrow.Float64>): SpacingInterpolationModel;
}

declare interface Span1D {
    start: number;
    end: number;
}

declare interface Span1DBigInt {
    start: bigint;
    end: bigint;
}

export declare class Spectrum extends ParamDescribed {
    id: string;
    index: bigint;
    msLevel: number;
    isProfile: boolean;
    polarity: number;
    time: number;
    params: Param[];
    scans: Scan[];
    precursors: Precursor[];
    selectedIons: SelectedIon[];
    meta: any | null;
    dataArrays?: DataArrays;
    centroids?: PointLike[];
    constructor(id: string, index: bigint, msLevel: number, isProfile: boolean, polarity: number, time: number, params: Param[], scans?: any[], precursors?: any[], selectedIons?: any[], meta?: any | null, dataArrays?: DataArrays);
    get rawArrays(): DataArrays | undefined;
    centroidPeaks(): PointLike[] | undefined;
    static fromRecord(record: any): Spectrum;
}

export declare class SpectrumMetadata extends MetadataReaderBase {
    _spectra: Arrow.Vector<Arrow.Struct> | null;
    _scans: Arrow.Vector<Arrow.Struct> | null;
    _precursors: Arrow.Vector<Arrow.Struct> | null;
    _selectedIons: Arrow.Vector<Arrow.Struct> | null;
    constructor(handle: ParquetFile);
    /**
     * Convert a time range to a contiguous span of indices
     *
     * @param start The starting time in minutes
     * @param end The ending time in minutes
     * @returns The index range that corresponds to the time interval requested
     */
    timeRangeToIndices(start: number, end: number): Span1DBigInt | null;
    /**
     * Read the run-level metadata from the Parquet file footer
     *
     * @returns {FileMetadata} The run level metadata
     */
    fileMetadata(): FileMetadata;
    static fromParquet(handle: ParquetFile): Promise<SpectrumMetadata>;
    makeIteratorHelpers(): IteratorLookupTables;
    protected get _mainStruct(): Arrow.Vector<Arrow.Struct<any>> | null;
    init(): Promise<this>;
    /**
     * Load the spacing models from the metadata table.
     *
     * @returns A mapping to {@coderef SpacingInterpolationModel} for spectra with a fitted model.
     */
    loadSpacingModelIndex(): Map<bigint, SpacingInterpolationModel> | null;
    get spectra(): Arrow.Vector<Arrow.Struct<any>> | null;
    get scans(): Arrow.Vector<Arrow.Struct<any>> | null;
    get precursors(): Arrow.Vector<Arrow.Struct<any>> | null;
    get selectedIons(): Arrow.Vector<Arrow.Struct<any>> | null;
    /**
     * Fetch the metadata record
     * @param index The index of the spectrum to read out
     * @returns The metadata record for a {@coderef Spectrum}
     */
    get(index: number | bigint): Spectrum;
}

export declare interface XIC {
    points: XICPoint[];
    target: {
        timeRange: Span1D | null;
        mzRange: Span1D | null;
    };
}

export declare interface XICPoint {
    index: bigint;
    time: number | null;
    dataArrays: DataArrays;
}

/**
 * Low-level mzPeak storage that is backed by an uncompressed `ZIP` archive that is either local
 * or remote to the runtime.
 */
export declare class ZipStorage<T> {
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
    constructor(reader: zip.Reader<T>);
    /**
     * Open a {@linkcode RemoteBlob} for the requested member of the ZIP archive by name
     * @param {string} filename - The name of the file to open from the archive.
     * @returns {RemoteBlob<T> | undefined} If `filename` is found, then a `RemoteBlob` is returned,
     * otherwise `undefined` is returned instead.
     */
    open(filename: string): Promise<RemoteBlob<T> | undefined>;
    /**
     * Create a `ZipStorage` instance from a URL.
     * @param url The URL for the mzPeak file stored on an accessible server. If this is a cross-origin request, care must be taken to allow range request headers
     * @returns {ZipStorage<zip.HttpRangeReader>} The storage configured for loading via HTTP requests.
     */
    static fromUrl(url: string | URL): Promise<ZipStorage<unknown>>;
    /**
     * Create a {@linkcode ZipStorage} instance from a {@linkcode Blob}-like object. This works with local files
     * (including those attached to a browser window) or anything exposing a `Blob`-like API like `slice`, `size`,
     * `arrayBuffer`, et. al.
     *
     * @param {Blob | RemoteBlob} blob The `Blob`-like object to read from. This might be a `RemoteBlob` too
     * @returns {ZipStorage<zip.BlobReader>} The storage configured for loading content via `Blob.slice` calls
     */
    static fromBlob(blob: Blob): Promise<ZipStorage<unknown>>;
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
    openFromIndex(entityType: EntityType, dataKind: DataKind): Promise<RemoteBlob<T> | undefined>;
    spectrumMetadata(): Promise<ParquetFile | undefined>;
    spectrumData(): Promise<ParquetFile | undefined>;
    spectrumPeaks(): Promise<ParquetFile | undefined>;
    chromatogramMetadata(): Promise<ParquetFile | undefined>;
    chromatogramData(): Promise<ParquetFile | undefined>;
    wavelengthSpectrumMetadata(): Promise<ParquetFile | undefined>;
    wavelengthSpectrumData(): Promise<ParquetFile | undefined>;
    /**
     * Read the file index JSON file from the source and initialize the `fileIndex` property.
     *
     * @throws {Error} if the index JSON file is not found or not properly formatted.
     */
    init(): Promise<void>;
}

export { }
