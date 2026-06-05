# mzPeak Explorer

A lightweight, **browser-based** explorer for [mzPeak](https://github.com/HUPO-PSI/mzPeak)
mass-spectrometry files. Think of it as an interactive, web-native [OpenMS
`FileInfo`](https://openms.de/) — open a `.mzpeak` file and immediately see what's
inside it, browse its metadata, and page through spectra and chromatograms.

Everything runs **client-side**: no upload, no backend. The file's bytes never
leave the browser (local files are read in place; URLs are fetched with HTTP
range requests). It deploys as a static site.

## What it does

Three tabs, all driven from a single in-browser read of the file:

- **Summary** — a `FileInfo`-style readout: spectrum / chromatogram / entity
  counts, MS-level breakdown, profile-vs-centroid split, m/z and retention-time
  ranges, storage layout (point / chunked), array encodings, and the file's
  entity manifest.
- **Metadata** — the full file-level metadata (`fileDescription`, instrument
  configurations, software, data processing, run, samples, and the
  `mzpeak_index.json` discovery block) rendered as a **hierarchical, collapsible
  tree** with CV-accession-aware highlighting.
- **Browse** — a navigator for the signal data. A **chromatogram** strip (total
  ion current, or an extracted-ion chromatogram for an m/z window you specify)
  sits on top; click anywhere on it to jump to the nearest spectrum. The
  selected **spectrum** is plotted below — profile spectra as a line, centroid
  spectra as a stick spectrum.

## Stack

- **Vite 8 + React 19 + TypeScript** — static-deployable SPA.
- **[uPlot](https://github.com/leeoniya/uPlot)** — fast canvas charts for dense
  spectra and chromatograms.
- **zustand** — small state store.
- **[`mzpeakts`](https://github.com/HUPO-PSI/mzpeakts)** (vendored) — the browser
  mzPeak reader (`parquet-wasm` + `apache-arrow` + `zip.js`). It is the only
  dependency that touches the (explicitly unstable) on-disk format; the entire
  rest of the app talks to it through the thin boundary in [`src/reader/`](src/reader).

The reader is vendored under [`vendor/mzpeakts/`](vendor/mzpeakts). Vite is
pointed at its TypeScript source so the `parquet-wasm` binary is emitted as a
separate hashed `.wasm` asset rather than inlined.

## Develop

```bash
npm install
npm run dev      # http://localhost:5188
```

(The dev port is pinned to **5188** in `vite.config.ts` so it won't collide with
other Vite projects that default to 5173.)

A couple of small demo files ship under [`public/static/`](public/static); the
URL box is pre-filled with one.

## Build & deploy

```bash
npm run build    # tsc -b && vite build  →  dist/
npm run preview
```

`base` defaults to `/` (works in dev and at a domain root). For a GitHub Pages
**project page**, build with the repo sub-path:

```bash
VITE_BASE=/mzPeakExplorer/ npm run build
```

## Architecture notes

- `src/reader/` is the **only** place `mzpeakts` is imported. Above it, the app
  speaks plain types (`FileSummary`, `SpectrumArrays`, `ChromPoint`, …) — no
  Arrow vectors and no `bigint` leak upward (`src/reader/plainify.ts` enforces
  this at the boundary).
- The live reader handle is held in a module variable, **outside** React state,
  so React never diffs or re-renders against its large Arrow/WASM-backed
  internals.
- **Metadata-first loading:** opening a file reads *only* metadata (manifest,
  file metadata, per-spectrum index, summary). Spectra and the TIC are loaded
  lazily when the Browse tab is first opened. A total-ion chromatogram is shown
  automatically only when it's available as a promoted per-spectrum column
  (metadata-only); summing it from every spectrum is a whole-file read and
  happens solely on an explicit **Build TIC** click.
- The charts create their uPlot instance **lazily**, only once a `ResizeObserver`
  reports the host has a real width — constructing uPlot at zero width (which
  happens the moment a tab is first revealed) permanently breaks its scale
  auto-ranging.

mzPeak has **no stability guarantee** — the reader version-detects and the UI
degrades gracefully (e.g. a chromatogram-only or non-imaging file just shows what
it has).
