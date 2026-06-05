import * as Arrow from "apache-arrow";
import * as ArrowFFI from "arrow-js-ffi";
import { ParquetFile, wasmMemory } from "parquet-wasm";

import { binarySearch, binarySearchAll, Span1DBigInt } from "./utils";
import { bigIntToNumber } from "apache-arrow/util/bigint";
import { SpacingInterpolationModel } from "./data";
import { Spectrum, Chromatogram, ParamDescribed } from "./record";

const DATA_POINT_COUNT_TERM = "MS_1003060_number_of_data_points";
const PEAK_COUNT_TERM = "MS_1003059_number_of_peaks";

export class ParamColumnSpec {
  source: string;
  name: string;
  accession: string | null;
  unit: string | null;
  isUnitOnly: boolean;

  constructor(
    source: string,
    name: string,
    accession: string | null = null,
    unit: string | null = null,
    isUnitOnly: boolean = false,
  ) {
    this.source = source;
    this.name = name;
    this.accession = accession;
    this.unit = unit;
    this.isUnitOnly = isUnitOnly;
  }

  static fromColumnName(colName: string) {
    const tokens = colName.split("_");
    // Too short to be a complete CV qualified name
    if (tokens.length < 3) return new ParamColumnSpec(colName, colName);
    const cvPrefix = tokens[0];
    // Don't know the CV
    if (cvPrefix != "MS" && cvPrefix != "UO")
      return new ParamColumnSpec(colName, colName);
    const accession = `${cvPrefix}:${tokens[1]}`;
    const unitIdx = tokens.findIndex((v) => v == "unit");
    if (unitIdx == -1) {
      const name = tokens.slice(2).join(" ");
      return new ParamColumnSpec(colName, name, accession);
    } else if (unitIdx < tokens.length - 1) {
      const name = tokens.slice(2, unitIdx).join(" ");
      const unit = tokens.slice(unitIdx + 1).join(":");
      return new ParamColumnSpec(colName, name, accession, unit);
    } else {
      const name = tokens.slice(2).join(" ");
      return new ParamColumnSpec(colName, name, accession, null, true);
    }
  }
}

export class Param {
  name: string;
  value: any | null = null;
  accession: string | null = null;
  unit: string | null = null;

  constructor(
    name: string,
    value: any | null,
    accession: string | null = null,
    unit: string | null = null,
  ) {
    this.name = name;
    this.value = value;
    this.accession = accession;
    this.unit = unit;
  }

  static fromJSON(raw: any) {
    return new Param(raw.name, raw.value, raw.accession, raw.unit);
  }

  static fromArrow(array: Arrow.Vector) {
    const names = array.getChild("name") as Arrow.Vector<Arrow.Utf8>;
    const accessions = array.getChild("accession") as Arrow.Vector<Arrow.Utf8>;
    const units = array.getChild("unit") as Arrow.Vector<Arrow.Utf8>;
    const values = array.getChild("value") as Arrow.Vector<Arrow.Struct>;

    if (names == null || accessions == null || units == null || values == null)
      throw new Error(`Cannot convert ${array} to Param array`);
    return Array.from(names).map((name, i) => {
      if (name == null) throw new Error(`A Param name cannot be null`);
      const acc = accessions.get(i);
      const unit = units.get(i);
      const val = values.get(i);
      if (val == null) {
        return new this(name, val, acc, unit);
      } else {
        const typedVal = Object.values(val.toJSON()).filter((v) => v != null);
        let valueFor = null;
        if (typedVal.length) {
          valueFor = typedVal[0];
        }
        return new this(name, valueFor, acc, unit);
      }
    });
  }
}

export class SourceFile extends ParamDescribed {
  id: string;
  name: string;
  location: string;

  constructor(id: string, name: string, location: string, parameters: Param[]) {
    super(parameters);
    this.id = id;
    this.name = name;
    this.location = location;
  }

  static fromJSON(raw: any) {
    const parameters = (raw.parameters as Array<any>).map(Param.fromJSON);
    return new SourceFile(raw.id, raw.name, raw.location, parameters);
  }
}

export class FileDescription {
  contents: Param[];
  sourceFiles: SourceFile[];

  constructor(contents: Param[], sourceFiles: SourceFile[]) {
    this.contents = contents;
    this.sourceFiles = sourceFiles;
  }

  static fromJSON(raw: any) {
    const contents = (raw.contents as Array<any>).map(Param.fromJSON);
    const sourceFiles = (raw.source_files as Array<any>).map(
      SourceFile.fromJSON,
    );
    return new FileDescription(contents, sourceFiles);
  }
}

export class InstrumentComponent extends ParamDescribed {
  componentType: string;
  order: number;

  constructor(componentType: string, order: number, parameters: Param[]) {
    super(parameters);
    this.componentType = componentType;
    this.order = order;
  }

  static fromJSON(raw: any) {
    const parameters = (raw.parameters as Array<any>).map(Param.fromJSON);
    return new InstrumentComponent(raw.component_type, raw.order, parameters);
  }
}

export class InstrumentConfiguration extends ParamDescribed {
  id: number;
  components: InstrumentComponent[];
  softwareReference?: string;

  constructor(
    id: number,
    components: InstrumentComponent[],
    parameters: Param[],
    softwareReference?: string,
  ) {
    super(parameters);
    this.id = id;
    this.components = components;
    this.softwareReference = softwareReference;
  }

  static fromJSON(raw: any) {
    const components = (raw.components as any[]).map(
      InstrumentComponent.fromJSON,
    );
    const params = (raw.parameters as any[]).map(Param.fromJSON);
    return new InstrumentConfiguration(
      raw.id,
      components,
      params,
      raw.software_reference,
    );
  }
}

export class ProcessingMethod extends ParamDescribed {
  order: number;

  constructor(order: number, parameters: Param[]) {
    super(parameters);
    this.order = order;
  }

  static fromJSON(raw: any) {
    return new ProcessingMethod(
      raw["order"],
      (raw["parameters"] as any[]).map(Param.fromJSON),
    );
  }
}

export class DataProcessingMethod {
  id: string;
  methods: ProcessingMethod[];

  constructor(id: string, methods: ProcessingMethod[]) {
    this.id = id;
    this.methods = methods;
  }

  static fromJSON(raw: any) {
    return new DataProcessingMethod(
      raw.id,
      (raw["methods"] as any[]).map(ProcessingMethod.fromJSON),
    );
  }
}

export class Software extends ParamDescribed {
  id: string;
  version: string;

  constructor(id: string, version: string, parameters: Param[]) {
    super(parameters);
    this.id = id;
    this.version = version;
  }

  static fromJSON(raw: any) {
    return new Software(
      raw.id,
      raw.version,
      (raw["parameters"] as any[]).map(Param.fromJSON),
    );
  }
}

export class Sample extends ParamDescribed {
  id: string;
  name: string;

  constructor(id: string, name: string, parameters: Param[]) {
    super(parameters);
    this.id = id;
    this.name = name;
  }

  static fromJSON(raw: any) {
    return new Sample(
      raw.id,
      raw.name,
      (raw["parameters"] as any[]).map(Param.fromJSON),
    );
  }
}

export class MSRun {
  id: string;
  defaultDataProcessingId?: string;
  defaultInstrumentId?: number;
  defaultSourceFileId?: string;
  startTime?: Date;

  constructor(
    id: string,
    defaultDataProcessingId?: string,
    defaultInstrumentId?: number,
    defaultSourceFileId?: string,
    startTime?: Date,
  ) {
    this.id = id;
    this.defaultDataProcessingId = defaultDataProcessingId;
    this.defaultInstrumentId = defaultInstrumentId;
    this.defaultSourceFileId = defaultSourceFileId;
    this.startTime = startTime;
  }

  static fromJSON(raw: any) {
    return new MSRun(
      raw.id,
      raw.default_data_processing_id,
      raw.default_instrument_id,
      raw.default_source_file_id,
      raw.start_time ? new Date(raw.start_time) : undefined,
    );
  }
}

export class FileMetadata {
  fileDescription: FileDescription;
  instrumentConfigurations: InstrumentConfiguration[];
  software: Software[];
  samples: Sample[];
  dataProcessingMethods: DataProcessingMethod[];
  run?: MSRun;

  constructor(
    fileDescription: FileDescription,
    instrumentConfigurations: InstrumentConfiguration[],
    software: Software[],
    samples: Sample[],
    dataProcessingMethods: DataProcessingMethod[],
    run?: MSRun,
  ) {
    this.fileDescription = fileDescription;
    this.instrumentConfigurations = instrumentConfigurations ?? [];
    this.software = software ?? [];
    this.samples = samples ?? [];
    this.dataProcessingMethods = dataProcessingMethods ?? [];
    this.run = run;
  }

  static fromParquet(handle: ParquetFile) {
    const meta = handle.metadata().fileMetadata().keyValueMetadata();
    let raw = meta.get("file_description");
    const fileDescription = raw
      ? FileDescription.fromJSON(JSON.parse(raw))
      : new FileDescription([], []);
    raw = meta.get("instrument_configuration_list");
    const instrumentConfigs = raw
      ? (JSON.parse(raw) as any[]).map(InstrumentConfiguration.fromJSON)
      : [];
    raw = meta.get("data_processing_method_list");
    const dpMethods = raw
      ? JSON.parse(raw).map(DataProcessingMethod.fromJSON)
      : [];
    raw = meta.get("software_list");
    const softwares = raw ? JSON.parse(raw).map(Software.fromJSON) : [];
    raw = meta.get("sample_list");
    const samples = raw ? JSON.parse(raw).map(Sample.fromJSON) : [];
    raw = meta.get("run");
    const run = raw ? MSRun.fromJSON(JSON.parse(raw)) : undefined;
    return new FileMetadata(
      fileDescription,
      instrumentConfigs,
      softwares,
      samples,
      dpMethods,
      run,
    );
  }
}

abstract class MetadataReaderBase {
  /** The backing Parquet file */
  handle: ParquetFile;
  /** Whether the {@link init} method has been called, which asynchronously loads data */
  initialized: boolean = false;
  protected _iteratorHelpers: IteratorLookupTables | null = null;

  /**
   * The basic constructor for {@link MetadataReaderBase} instances. This does not
   * complete the initialization process. Call the asynchronous {@link init} method
   * to finish loading data.
   *
   * @param handle The Parquet file this reader uses
   */
  constructor(handle: ParquetFile) {
    this.handle = handle;
    this.initialized = false;
  }

  abstract makeIteratorHelpers(): IteratorLookupTables;

  protected get _mainStruct(): Arrow.Vector<Arrow.Struct> | null {
    throw new Error("Most override");
  }

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
  dataPointCount(
    index: number | undefined = undefined,
  ): number | null | Arrow.Vector<Arrow.Uint64> {
    const main = this._mainStruct;
    const counter: Arrow.Vector<Arrow.Uint64> | null = main?.getChild(
      DATA_POINT_COUNT_TERM,
    ) as any;
    if (index == undefined) {
      return counter;
    }
    if (counter == null) {
      return null;
    } else {
      const val = counter.get(index);
      return val == null ? null : bigIntToNumber(val);
    }
  }

  /** Get the number of peaks for this entry
   * @returns {integer} the number of peaks
   */
  peakCount(index: number): number | null;
  /**
   * Get the array of peak counts for this entry
   * @returns {Arrow.Vector<Arrow.Uint64>} the array number of peaks
   * */
  peakCount(): null | Arrow.Vector<Arrow.Uint64>;
  peakCount(
    index: number | undefined = undefined,
  ): number | null | Arrow.Vector<Arrow.Uint64> {
    const main = this._mainStruct;
    const counter: Arrow.Vector<Arrow.Uint64> | null = main?.getChild(
      PEAK_COUNT_TERM,
    ) as any;
    if (index == undefined) {
      return counter;
    }
    if (counter == null) {
      return null;
    } else {
      const val = counter.get(index);
      return val == null ? null : bigIntToNumber(val);
    }
  }

  /**
   * Asynchronously load metadata tables from Parquet file
   */
  async init(): Promise<this> {
    throw new Error("Must override init");
  }

  /** Get the number of entries of the main data sequence in this reader */
  get length(): number {
    return this.initialized && this._mainStruct ? this._mainStruct.length : 0;
  }

  /**
   * Read the Parquet file completely into memory.
   * @returns An Arrow {@link Arrow.Table}
   */
  protected async readTable() {
    const tab = await this.handle.read();
    const ffi = tab.intoFFI();
    const mem = wasmMemory();
    const arrowTab = ArrowFFI.parseTable(
      mem.buffer,
      ffi.arrayAddrs(),
      ffi.schemaAddr(),
      true,
    );
    ffi.free();
    return arrowTab;
  }
}

type IteratorLookupTables = Record<string, Map<bigint, HasSourceIndex[]>>;

interface HasSourceIndex {
  source_index: bigint | null;
  parameters?: Arrow.Vector | Param[];
}

const coerceToBasicRecordInTable = <T extends HasSourceIndex>(
  table: Map<bigint, T[]>,
  rec: T | undefined,
) => {
  if (
    rec === undefined ||
    rec.source_index === undefined ||
    rec.source_index === null
  )
    return;
  const c = table.get(rec.source_index as bigint);
  if (rec.parameters != undefined) {
    rec.parameters = Param.fromArrow(rec.parameters as Arrow.Vector);
  }
  if (c == undefined || c == null) {
    table.set(rec.source_index, [rec]);
  } else {
    c.push(rec);
  }
};

const buildBasicRecordTable = <T extends HasSourceIndex>(
  array: Arrow.Vector<Arrow.Struct>,
  convert?: Function,
): Map<bigint, T[]> => {
  const table = new Map();
  for (let i = 0; i < array.length; i++) {
    if (array.isValid(i)) {
      let rec = array.get(i)?.toJSON() as HasSourceIndex | undefined;
      if (convert != undefined) {
        rec = convert(rec);
      }
      coerceToBasicRecordInTable(table, rec);
    }
  }
  return table;
};

export class SpectrumMetadata extends MetadataReaderBase {
  _spectra: Arrow.Vector<Arrow.Struct> | null;
  _scans: Arrow.Vector<Arrow.Struct> | null;
  _precursors: Arrow.Vector<Arrow.Struct> | null;
  _selectedIons: Arrow.Vector<Arrow.Struct> | null;

  constructor(handle: ParquetFile) {
    super(handle);
    this._spectra = null;
    this._scans = null;
    this._precursors = null;
    this._selectedIons = null;
  }

  /**
   * Convert a time range to a contiguous span of indices
   *
   * @param start The starting time in minutes
   * @param end The ending time in minutes
   * @returns The index range that corresponds to the time interval requested
   */
  timeRangeToIndices(start: number, end: number): Span1DBigInt | null {
    if (!this._spectra)
      throw new Error("Cannot query spectrum indices, table not loaded");
    const indexArr = this._spectra.getChildAt(0) as Arrow.Vector<Arrow.Uint64>;
    const timeArr = this._spectra.getChild("time") as Arrow.Vector<Arrow.Float>;
    let startedAt: number | null = null;

    for (let i = 0; i < timeArr.length; i++) {
      let val = timeArr.get(i);
      if (val == null) continue;
      if (startedAt == null) {
        if (val >= start) {
          startedAt = i;
        }
      } else if (val > end) {
        if (startedAt != null) {
          return {
            start: indexArr.get(startedAt) as bigint,
            end: indexArr.get(i) as bigint,
          };
        } else {
          return null;
        }
      }
    }
    if (startedAt != null) {
      return {
        start: indexArr.get(startedAt) as bigint,
        end: indexArr.get(indexArr.length - 1) as bigint,
      };
    } else {
      return null;
    }
  }

  /**
   * Read the run-level metadata from the Parquet file footer
   *
   * @returns {FileMetadata} The run level metadata
   */
  fileMetadata() {
    return FileMetadata.fromParquet(this.handle);
  }

  static async fromParquet(handle: ParquetFile) {
    const self = new this(handle);
    return await self.init();
  }

  makeIteratorHelpers(): IteratorLookupTables {
    const lookups: IteratorLookupTables = {};
    if (this.scans) {
      lookups["scans"] = buildBasicRecordTable(this.scans);
    }
    if (this.precursors) {
      lookups["precursors"] = buildBasicRecordTable(this.precursors);
    }
    if (this.selectedIons) {
      lookups["selectedIons"] = buildBasicRecordTable(this.selectedIons);
    }
    return lookups;
  }

  protected get _mainStruct() {
    return this._spectra;
  }

  async init() {
    if (this.initialized) return this;
    const arrowTab = await this.readTable();
    this._spectra = arrowTab.getChild(
      "spectrum",
    ) as Arrow.Vector<Arrow.Struct> | null;
    this._scans = arrowTab.getChild(
      "scan",
    ) as Arrow.Vector<Arrow.Struct> | null;
    this._precursors = arrowTab.getChild(
      "precursor",
    ) as Arrow.Vector<Arrow.Struct> | null;
    this._selectedIons = arrowTab.getChild(
      "selected_ion",
    ) as Arrow.Vector<Arrow.Struct> | null;
    this.initialized = true;
    return this;
  }

  /**
   * Load the spacing models from the metadata table.
   *
   * @returns A mapping to {@coderef SpacingInterpolationModel} for spectra with a fitted model.
   */
  loadSpacingModelIndex(): Map<bigint, SpacingInterpolationModel> | null {
    if (this.spectra === null) return null;
    const indexArr = this.spectra.getChildAt(0) as Arrow.Vector<Arrow.Uint64>;
    const spacingModels = this.spectra.getChild(
      "mz_delta_model",
    ) as Arrow.Vector<Arrow.List<Arrow.Float64>> | null;
    if (spacingModels == null) return null;
    const modelIndex = new Map();
    for (let i = 0; i < indexArr.length; i++) {
      const key = indexArr.get(i);
      if (key == null) continue;
      const coefs = spacingModels.get(i);
      if (coefs == null) continue;
      const model = SpacingInterpolationModel.fromArrow(coefs);
      modelIndex.set(key, model);
    }
    return modelIndex;
  }

  get spectra() {
    if (!this.initialized)
      throw new Error("Metadata not initialized yet! call and await `init()`");
    return this._spectra;
  }

  get scans() {
    if (!this.initialized)
      throw new Error("Metadata not initialized yet! call and await `init()`");
    return this._scans;
  }

  get precursors() {
    if (!this.initialized)
      throw new Error("Metadata not initialized yet! call and await `init()`");
    return this._precursors;
  }

  get selectedIons() {
    if (!this.initialized)
      throw new Error("Metadata not initialized yet! call and await `init()`");
    return this._selectedIons;
  }

  /**
   * Fetch the metadata record
   * @param index The index of the spectrum to read out
   * @returns The metadata record for a {@coderef Spectrum}
   */
  get(index: number | bigint) : Spectrum {
    if (index >= this.length) throw new Error("Index out of range");
    let index_ = bigIntToNumber(index);
    let index_n = BigInt(index);
    if (this.spectra == null) throw new Error("Invalid state");

    let indexArr = this.spectra?.getChild(
      "index",
    ) as Arrow.Vector<Arrow.Uint64>;
    let row = indexArr.get(index_);
    if (row != index_n) {
      const offset = binarySearch(indexArr, index_n);
      row = indexArr.get(offset);
    }
    const spectrumRecord = this.spectra.get(index_)?.toJSON();
    if (!spectrumRecord)
      throw new Error("Invalid state, spectrum record not found");
    spectrumRecord.parameters = Param.fromArrow(spectrumRecord.parameters);

    indexArr = this.scans?.getChild(
      "source_index",
    ) as Arrow.Vector<Arrow.Uint64>;
    let offsets = binarySearchAll(indexArr, index_n);

    if (offsets && this.scans) {
      const scanRecords = Array.from(
        this.scans.slice(offsets[0], offsets[1]),
      ).map((e) => {
        if (!e) return e;
        const conv = e.toJSON();
        conv.parameters = Param.fromArrow(conv.parameters);
        return conv;
      });
      spectrumRecord.scans = scanRecords;
    }

    if (this.precursors != null) {
      indexArr = this.precursors?.getChild(
        "source_index",
      ) as Arrow.Vector<Arrow.Uint64>;
      offsets = binarySearchAll(indexArr, index_n);
      if (offsets) {
        const precursorRecords = this.precursors.slice(offsets[0], offsets[1]);
        spectrumRecord.precursors = Array.from(precursorRecords).map((e) => {
          if (!e) return e;
          const conv = e.toJSON();
          conv.isolation_window = conv.isolation_window.toJSON();
          conv.activation = conv.activation.toJSON();
          conv.activation.parameters = Param.fromArrow(
            conv.activation.parameters,
          );
          return conv;
        });
      }
    }

    if (this.selectedIons != null) {
      indexArr = this.selectedIons?.getChild(
        "source_index",
      ) as Arrow.Vector<Arrow.Uint64>;
      offsets = binarySearchAll(indexArr, index_n);
      if (offsets) {
        const ionRecords = this.selectedIons
          .slice(offsets[0], offsets[1])
          .toJSON();
        spectrumRecord.selectedIons = Array.from(ionRecords).map((e) => {
          if (!e) return e;
          const conv = e.toJSON();
          conv.parameters = Param.fromArrow(conv.parameters);
          return conv;
        });
      }
    }

    return Spectrum.fromRecord(spectrumRecord);
  }
}

export class ChromatogramMetadata extends MetadataReaderBase {
  _chromatograms: Arrow.Vector | null;
  _precursors: Arrow.Vector | null;
  _selectedIons: Arrow.Vector | null;

  constructor(handle: ParquetFile) {
    super(handle);
    this._chromatograms = null;
    this._precursors = null;
    this._selectedIons = null;
  }

  makeIteratorHelpers(): IteratorLookupTables {
    const lookups: IteratorLookupTables = {};
    if (this.precursors) {
      lookups["precursors"] = buildBasicRecordTable(this.precursors);
    }
    if (this.selectedIons) {
      lookups["selectedIons"] = buildBasicRecordTable(this.selectedIons);
    }
    return lookups;
  }

  static async fromParquet(handle: ParquetFile) {
    const self = new this(handle);
    return await self.init();
  }

  async init() {
    if (this.initialized) return this;
    const arrowTab = await this.readTable();
    this._chromatograms = arrowTab.getChild("chromatogram");
    this._precursors = arrowTab.getChild("precursor");
    this._selectedIons = arrowTab.getChild("selected_ion");
    this.initialized = true;
    return this;
  }

  protected get _mainStruct() {
    return this.chromatograms;
  }

  get chromatograms() {
    if (!this.initialized)
      throw new Error("Metadata not initialized yet! call and await `init()`");
    return this._chromatograms;
  }

  get precursors() {
    if (!this.initialized)
      throw new Error("Metadata not initialized yet! call and await `init()`");
    return this._precursors;
  }

  get selectedIons() {
    if (!this.initialized)
      throw new Error("Metadata not initialized yet! call and await `init()`");
    return this._selectedIons;
  }

  get length(): number {
    return this.initialized && this._chromatograms
      ? this._chromatograms.length
      : 0;
  }

  get(index: number | bigint) {
    if (index >= this.length) throw new Error("Index out of range");
    let index_ = bigIntToNumber(index);
    let index_n = BigInt(index);
    if (this.chromatograms == null) throw new Error("Invalid state");
    let indexArr = this.chromatograms?.getChild(
      "index",
    ) as Arrow.Vector<Arrow.Uint64>;
    let row = indexArr.get(index_);
    if (row != BigInt(index)) {
      index_ = binarySearch(indexArr, BigInt(index));
    }
    const chromatogramRecord = this.chromatograms.get(index_)?.toJSON();
    chromatogramRecord.parameters = Param.fromArrow(
      chromatogramRecord.parameters,
    );

    if (this.precursors != null) {
      indexArr = this.precursors?.getChild(
        "source_index",
      ) as Arrow.Vector<Arrow.Uint64>;
      let offsets = binarySearchAll(indexArr, index_n);
      if (offsets) {
        const precursorRecords = this.precursors.slice(offsets[0], offsets[1]);
        chromatogramRecord.precursors = Array.from(precursorRecords).map(
          (e) => {
            if (!e) return e;
            const conv = e.toJSON();
            conv.isolation_window = conv.isolation_window.toJSON();
            conv.activation = conv.activation.toJSON();
            conv.activation.parameters = Param.fromArrow(
              conv.activation.parameters,
            );
            return conv;
          },
        );
      }
    }

    if (this.selectedIons != null) {
      indexArr = this.selectedIons?.getChild(
        "source_index",
      ) as Arrow.Vector<Arrow.Uint64>;
      let offsets = binarySearchAll(indexArr, index_n);
      if (offsets) {
        const ionRecords = this.selectedIons
          .slice(offsets[0], offsets[1])
          .toJSON();
        chromatogramRecord.selectedIons = Array.from(ionRecords).map((e) => {
          if (!e) return e;
          const conv = e.toJSON();
          conv.parameters = Param.fromArrow(conv.parameters);
          return conv;
        });
      }
    }

    return Chromatogram.fromRecord(chromatogramRecord);
  }
}
