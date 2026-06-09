import { describe, it, expect } from "vitest";
import { serializeViewParams, parseViewParams, type ViewState } from "./shareView";

const base: ViewState = {
  sourceUrl: "https://host/x.mzpeak",
  tab: "summary",
  selectedIndex: null,
  selectedId: null,
  msLevelFilter: null,
  chromMode: "tic",
  xic: null,
  chromStoredId: null,
};
const qs = (s: ViewState) => serializeViewParams(s).toString();

describe("serializeViewParams", () => {
  it("emits a bare file link for the default view", () => {
    expect(qs(base)).toBe("file=https%3A%2F%2Fhost%2Fx.mzpeak");
  });

  it("prefers native scan number over index when the id carries one", () => {
    const p = parseViewParams(
      "?" + qs({ ...base, tab: "spectra", selectedIndex: 2, selectedId: "controllerType=0 scan=229" }),
    );
    expect(p.tab).toBe("spectra");
    expect(p.scan).toBe("229");
    expect(p.spectrum).toBeUndefined();
  });

  it("falls back to index when the id has no scan number (imaging)", () => {
    const p = parseViewParams("?" + qs({ ...base, tab: "spectra", selectedIndex: 7, selectedId: "x y 1 1" }));
    expect(p.spectrum).toBe("7");
    expect(p.scan).toBeUndefined();
  });

  it("encodes the MS-level filter", () => {
    expect(parseViewParams("?" + qs({ ...base, msLevelFilter: 2 })).ms).toBe("2");
  });

  it("encodes an XIC and a stored chromatogram", () => {
    const xic = parseViewParams("?" + qs({ ...base, tab: "chromatograms", chromMode: "xic", xic: { mz: 445.12, tolDa: 0.01 } }));
    expect(xic.xic).toBe("445.12,0.01");
    const stored = parseViewParams("?" + qs({ ...base, tab: "chromatograms", chromMode: "stored", chromStoredId: "BasePeak_0" }));
    expect(stored.chrom).toBe("BasePeak_0");
    const tic = parseViewParams("?" + qs({ ...base, tab: "chromatograms", chromMode: "tic" }));
    expect(tic.chrom).toBe("tic");
  });

  it("round-trips a full spectra view", () => {
    const s: ViewState = { ...base, tab: "spectra", selectedIndex: 5, selectedId: "scan=1024", msLevelFilter: 2 };
    const p = parseViewParams("?" + qs(s));
    expect(p).toEqual({ file: "https://host/x.mzpeak", tab: "spectra", scan: "1024", ms: "2" });
  });
});

describe("parseViewParams", () => {
  it("accepts ?url= as a file alias and ignores unknown keys", () => {
    const p = parseViewParams("?url=https://h/y.mzpeak&foo=bar&tab=metadata");
    expect(p.file).toBe("https://h/y.mzpeak");
    expect(p.tab).toBe("metadata");
  });
});
