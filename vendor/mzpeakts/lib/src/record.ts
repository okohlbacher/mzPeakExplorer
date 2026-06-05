import { DataArrays } from "./data";
import { Param, ParamColumnSpec } from "./metadata";

export class ParamDescribed {
  params: Param[];
  meta?: any;

  constructor(params: Param[]) {
    this.params = params;
  }

  get parameters() {
    return this.params;
  }

  getParamByAccession(accession: string): Param | undefined {
    let value = this.params.find((p) => p.accession == accession);
    if (value != undefined) return value;
    else if (this.meta) {
      for (let [key, val] of Object.entries(this.meta)) {
        const spec = ParamColumnSpec.fromColumnName(key);
        if (spec.accession == accession && !spec.isUnitOnly) {
          return new Param(spec.name, val, spec.accession, spec.unit);
        }
      }
    }
    return undefined;
  }
}

export class ScanWindow {
  lowerBound: number;
  upperBound: number;

  constructor(lowerBound: number, upperBound: number) {
    this.lowerBound = lowerBound;
    this.upperBound = upperBound;
  }

  static fromRecord(record: any) {
    return new ScanWindow(
      record["MS_1000501_scan_window_lower_limit_unit_MS_1000040"],
      record["MS_1000500_scan_window_upper_limit_unit_MS_1000040"],
    );
  }
}

export class Scan extends ParamDescribed {
  sourceIndex: bigint;
  instrumentConfigurationRef: number;
  params: Param[];
  scanWindows: any[];
  injectionTime?: number;
  presetScanConfiguration?: number;
  meta: any | null;

  constructor(
    sourceIndex: bigint,
    instrumentConfigurationRef: number,
    params: Param[],
    scanWindows?: any[],
    injectionTime?: number,
    presetScanConfiguration?: number,
    meta?: any,
  ) {
    super(params);
    this.sourceIndex = sourceIndex;
    this.instrumentConfigurationRef = instrumentConfigurationRef;
    this.params = params;
    this.scanWindows = scanWindows ?? [];
    this.injectionTime = injectionTime;
    this.presetScanConfiguration = presetScanConfiguration;
    this.meta = meta;
  }

  static fromRecord(record: any) {
    return new Scan(
      record.source_index,
      record.instrument_configuration_ref,
      record.parameters,
      Array.from(record.scan_windows ?? []).map((w: any) =>
        ScanWindow.fromRecord(w.toJSON()),
      ),
      record["MS_1000927_ion_injection_time_unit_UO_0000028"],
      record["MS_1000616_preset_scan_configuration"],
      record,
    );
  }
}

export class IsolationWindow {
  target: number;
  lowerOffset: number;
  upperOffset: number;

  constructor(target: number, lower: number, upper: number) {
    this.target = target;
    this.lowerOffset = lower;
    this.upperOffset = upper;
  }

  get lowerBound() {
    return this.target - this.lowerOffset;
  }

  get upperBound() {
    return this.target + this.upperOffset;
  }

  static fromRecord(record: any) {
    return new IsolationWindow(
      record["MS_1000827_isolation_window_target_mz"],
      record["MS_1000828_isolation_window_lower_offset"],
      record["MS_1000829_isolation_window_upper_offset"],
    );
  }
}

export class Precursor {
  sourceIndex: bigint;
  precursorIndex: bigint;
  activation: Param[];
  isolationWindow: IsolationWindow;
  meta: any;

  constructor(
    sourceIndex: bigint,
    precursorIndex: bigint,
    activation: Param[],
    isolationWindow: IsolationWindow,
    meta?: any,
  ) {
    this.sourceIndex = sourceIndex;
    this.precursorIndex = precursorIndex;
    this.activation = activation;
    this.isolationWindow = isolationWindow;
    this.meta = meta;
  }

  static fromRecord(record: any) {
    const activation = record.activation.parameters;
    return new Precursor(
      record.source_index,
      record.prescursor_index,
      activation,
      IsolationWindow.fromRecord(record.isolation_window),
      record,
    );
  }
}

export class SelectedIon extends ParamDescribed {
  sourceIndex: bigint;
  precursorIndex: bigint;
  chargeState: number | null;
  intensity: number | null;
  mz: number | null;
  ionMobility: number | null;
  params: Param[];
  meta: any;

  constructor(
    sourceIndex: bigint,
    precursorIndex: bigint,
    mz?: number,
    intensity?: number,
    chargeState?: number|null,
    ionMobility?: number|null,
    parameters?: Param[],
    meta?: any,
  ) {
    super(parameters ?? []);
    this.sourceIndex = sourceIndex;
    this.precursorIndex = precursorIndex;
    this.chargeState = chargeState ?? null;
    this.mz = mz ?? null;
    this.intensity = intensity ?? null;
    this.ionMobility = ionMobility ?? null;
    this.params = parameters ?? [];
    this.meta = meta;
  }

  static fromRecord(record: any) {
    const parameters = record.parameters.map(Param.fromArrow);
    let charge: number | null;
    if (record["MS_1000041_charge_state"]) {
      charge = Number(record["MS_1000041_charge_state"]);
    }
    else {
      charge = null
    }
    return new SelectedIon(
      record.source_index,
      record.precursor_index,
      record["MS_1000744_selected_ion_mz_unit_MS_1000040"],
      record["MS_1000042_intensity_unit_MS_1000131"],
      charge,
      record["ion_mobility"],
      parameters,
      record,
    );
  }
}

export interface PointLike {
  mz: number;
  intensity: number;
}

export class Spectrum extends ParamDescribed {
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

  constructor(
    id: string,
    index: bigint,
    msLevel: number,
    isProfile: boolean,
    polarity: number,
    time: number,
    params: Param[],
    scans?: any[],
    precursors?: any[],
    selectedIons?: any[],
    meta?: any | null,
    dataArrays?: DataArrays,
  ) {
    super(params);
    this.id = id;
    this.index = index;
    this.msLevel = msLevel;
    this.isProfile = isProfile;
    this.polarity = polarity;
    this.time = time;
    this.params = params;
    this.scans = scans ?? [];
    this.precursors = precursors ?? [];
    this.selectedIons = selectedIons ?? [];
    this.meta = meta ?? null;
    this.dataArrays = dataArrays;
  }

  get rawArrays() {
    return this.dataArrays;
  }

  centroidPeaks() {
    if (this.centroids) return this.centroids;
    if (!this.isProfile) {
      if (this.dataArrays) {
        const intensityArr = this.dataArrays["intensity array"] as Float32Array;
        const mzArr = this.dataArrays["m/z array"] as Float64Array;
        this.centroids = [];
        for (let i = 0; i < mzArr.length; i++) {
          this.centroids.push({
            mz: mzArr[i],
            intensity: intensityArr[i],
          });
        }
        return this.centroids;
      }
    }
  }

  static fromRecord(record: any) {
    return new Spectrum(
      record.id,
      record.index,
      record["MS_1000511_ms_level"],
      record["MS_1000525_spectrum_representation"] == "MS:1000128",
      record["MS_1000465_scan_polarity"],
      record["time"],
      record["parameters"],
      (record["scans"] ?? []).map(Scan.fromRecord),
      (record["precursors"] ?? []).map(Precursor.fromRecord),
      (record["selectedIons"] ?? []).map(SelectedIon.fromRecord),
      record,
      record.dataArrays,
    );
  }
}

export class Chromatogram extends ParamDescribed {
  id: string;
  index: bigint;
  params: Param[];
  precursors: Precursor[];
  selectedIons: SelectedIon[];
  meta: any | null;
  dataArrays?: DataArrays;

  constructor(
    id: string,
    index: bigint,
    params: Param[],
    precursors?: any[],
    selectedIons?: any[],
    meta?: any | null,
    dataArrays?: DataArrays,
  ) {
    super(params);
    this.id = id;
    this.index = index;
    this.params = params;
    this.precursors = precursors ?? [];
    this.selectedIons = selectedIons ?? [];
    this.meta = meta ?? null;
    this.dataArrays = dataArrays;
  }

  get rawArrays() {
    return this.dataArrays;
  }

  static fromRecord(record: any) {
    const parameters = record.parameters.map(Param.fromArrow);
    return new Chromatogram(
      record.id,
      record.index,
      parameters,
      (record["precursors"] ?? []).map(Precursor.fromRecord),
      (record["selectedIons"] ?? []).map(SelectedIon.fromRecord),
      record,
      record.dataArrays,
    );
  }
}
