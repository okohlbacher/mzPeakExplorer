# Architecture

Developer-facing notes for mzPeak Explorer. For what the app *does*, see the
[README](README.md).

## Stack

- **Vite 8 + React 19 + TypeScript ~5.9** — a static-deployable SPA.
- **[uPlot](https://github.com/leeoniya/uPlot)** — fast canvas charts for dense spectra and
  chromatograms, re-themed for the dark "data stage" in [`src/ui/chartTheme.ts`](src/ui/chartTheme.ts).
- **zustand** — a small state store ([`src/state/store.ts`](src/state/store.ts)).
- **IBM Plex Sans/Mono** (self-hosted via `@fontsource`) + **lucide-react** icons.
- **[`mzpeakts`](https://github.com/HUPO-PSI/mzpeakts)** (vendored under
  [`vendor/mzpeakts/`](vendor/mzpeakts)) — the browser mzPeak reader (`parquet-wasm` +
  `apache-arrow` + `@zip.js/zip.js`). It is the only dependency that touches the (explicitly
  unstable) on-disk format.

Vite is pointed at the reader's TypeScript **source** (not its build) so the `parquet-wasm` binary
is emitted as a separate hashed `.wasm` asset rather than inlined. The reader is installed as a
`file:` dependency and committed in-tree, so `npm ci` needs no submodule or reader build.

## The reader boundary

[`src/reader/`](src/reader) is the **only** place `mzpeakts` is imported
(`grep -rl 'from "mzpeakts"' src/` returns just [`src/reader/open.ts`](src/reader/open.ts)). Above
it, the app speaks plain types — `FileSummary`, `SpectrumArrays`, `ChromPoint`, … — with **no Arrow
vectors and no `bigint`** leaking upward; the boundary converts at the edge. This keeps the UI
testable and insulated from format churn.

The live reader handle is held in a **module variable, outside React state**, so React never diffs
or re-renders against its large Arrow/WASM-backed internals. A monotonically increasing `loadGen`
counter acts as the cancellation token: every async path captures it on entry and bails (and
re-checks after each `await`) when a newer file has loaded.

## Loading model

Opening a file reads **only** metadata (manifest, file metadata, per-spectrum index, summary) —
the overview is footer-first and appears in seconds even on multi-GB files. Heavier work is
deferred and policy-driven:

- Files ≤ `AUTO_SCAN_LIMIT` (50k) spectra **auto-scan** the per-spectrum index after open. Above
  that, a **remote** file scans only on demand (MS-level filter, Build TIC, Compute breakdown); a
  **local** file is also scanned by the background preloader (below), regardless of size.
- A **TIC** is shown automatically only when it's available as a promoted per-spectrum column
  (metadata-only). Summing it from every spectrum is a whole-file read and happens solely on an
  explicit **Build TIC** click (refused above the auto-scan limit).
- **Remote** files do **not** auto-preload spectra — every cold read is a large row-group range
  request, so eager fetching would saturate the link. Local files background-preload.

### Prioritized read scheduler

All signal reads (spectra, XIC/TIC extraction) run through a two-lane serial scheduler
([`src/state/readScheduler.ts`](src/state/readScheduler.ts)): user-triggered reads preempt the
background preloader's speculative reads, and the preloader backs off while the user is actively
navigating. The vendored reader is single-threaded, non-reentrant, and exposes no `AbortSignal`, so
this is queue discipline, not interruption. Full rationale + an adoption guide in
[`docs/preload-caching-mechanism-HANDOFF.md`](docs/preload-caching-mechanism-HANDOFF.md).

## Charts

uPlot instances are created **lazily**, only once a `ResizeObserver` reports the host has a real
width — constructing uPlot at zero width (which happens the moment a tab is first revealed)
permanently breaks its scale auto-ranging. The charts own raw canvas/WASM-backed handles, which is
also why `StrictMode` is intentionally omitted (its dev-only double-mount recreates the imperative
instances and can leave a chart blank).

## Layout

```
src/
  reader/    the mzpeakts boundary — open, metadata, summary, browse, study/SDRF, archive
  state/     zustand store + the read scheduler
  ui/        App shell, tabs, charts, components, design tokens
docs/        SPECs, handoffs, and screenshots
vendor/      the vendored mzpeakts reader (source + .d.ts + parquet-wasm)
```

## Deployment

Two targets (see [`CLAUDE.md`](CLAUDE.md) for the authoritative process):

1. **GitHub Pages** — `git push origin main` triggers
   [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which runs `npm ci && npm run
   build` with `VITE_BASE` derived from the repo name and publishes `dist/`.
2. **mzpeak.org** — `~/Claude/mzPeak Website/deploy.sh` rebuilds the combined site (Explorer under
   `/view/`, built with `VITE_BASE=/view/`) and rsyncs it over SSH to the StackIT server.

`VITE_BASE` defaults to `/` (correct for dev and a domain root); a project page needs the repo
sub-path (`VITE_BASE=/mzPeakExplorer/`).
