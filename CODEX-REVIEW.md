# Adversarial Code Review

## HIGH

- SEVERITY: HIGH
  file: src/state/store.ts:291
  A stale `openFile`/`openUrl` can overwrite the module-level `reader` after a newer file has already loaded, because `reader = await open()` happens before the `gen !== loadGen` check.
  Fix: await into a local `opened`, check `gen === loadGen`, then assign `reader = opened`.

- SEVERITY: HIGH
  file: src/state/store.ts:171
  A pending `selectSpectrum` from an old file can install old signal arrays into the new file if the selected index matches.
  Fix: capture both current `reader` and `loadGen` before awaiting, and only set `selectedSpectrum` when both still match.

- SEVERITY: HIGH
  file: src/state/store.ts:248
  `runXic` can publish chromatogram points from a previous file after a new file is opened.
  Fix: capture `reader` and `loadGen` at the start of `runXic`, and discard results if either changed.

- SEVERITY: HIGH
  file: src/state/store.ts:261
  `showTic` has the same stale async result race, so a slow TIC build from file A can replace file B’s chromatogram state.
  Fix: verify the active reader/generation after each await before setting `chrom`.

- SEVERITY: HIGH
  file: src/state/store.ts:247
  XIC extraction before a scan always sets `useProfile` to `true` because representation counts start at zero, so centroid-only large files can query the wrong data source.
  Fix: derive the source from actual available data, run the representation scan first, or fallback between profile and centroid extraction.

## MEDIUM

- SEVERITY: MEDIUM
  file: src/reader/plainify.ts:22
  `plainify` writes untrusted metadata keys into `{}`, so an own `__proto__` key can mutate the returned object’s prototype.
  Fix: use `Object.create(null)` and skip `__proto__`, `prototype`, and `constructor`.

- SEVERITY: MEDIUM
  file: src/reader/plainify.ts:7
  BigInt metadata is coerced with `Number(value)`, silently losing precision above `Number.MAX_SAFE_INTEGER`.
  Fix: preserve unsafe BigInts as strings or only convert safe integer values.

- SEVERITY: MEDIUM
  file: src/reader/browse.ts:151
  `extractChromatogram` converts bigint indexes to numbers without a safety check.
  Fix: reject/stringify unsafe indexes or keep bigint/string until safe numeric UI indexes are guaranteed.

- SEVERITY: MEDIUM
  file: src/reader/browse.ts:83
  Spectrum arrays are copied without validating finite values or monotonic m/z order, but plotting and binary-search tooltip logic assume sorted finite x-values.
  Fix: validate/drop non-finite points and sort paired points by m/z when needed.

- SEVERITY: MEDIUM
  file: src/ui/uplotZoom.ts:25
  Zoom bounds use first/last x-values as full extent, which is wrong for unsorted or NaN-ended data.
  Fix: compute finite min/max bounds or assert prevalidated sorted data.

- SEVERITY: MEDIUM
  file: src/ui/chartTheme.ts:33
  `xRange` fallback assumes `xs[0]` and `xs[last]` are valid ordered extrema.
  Fix: scan for finite min/max and return `[0, 1]` only when no finite x-values exist.

- SEVERITY: MEDIUM
  file: src/reader/cv.ts:35
  `numOrNull` accepts arbitrary strings through `Number(...)`, so empty strings or whitespace become real zeros.
  Fix: only accept finite numbers/safe BigInts or use strict numeric string parsing.

- SEVERITY: MEDIUM
  file: src/state/store.ts:368
  `runScan` swallows scan errors and resolves normally, so `showTic` can continue with empty `spectra`.
  Fix: rethrow after setting error state or return an explicit failure result.

- SEVERITY: MEDIUM
  file: src/state/store.ts:153
  `initBrowse` marks `browseInited` true before first spectrum load succeeds, preventing retry after a transient or malformed first-spectrum failure.
  Fix: set it only after successful initialization or track attempted/loading separately.

- SEVERITY: MEDIUM
  file: src/reader/plainify.ts:17
  `plainify` materializes every array/typed array with no size cap, enabling metadata-driven client memory exhaustion.
  Fix: cap entries/bytes per node and render truncated placeholders.

## LOW

- SEVERITY: LOW
  file: src/ui/useUplot.ts:59
  `useUplot` accepts external dependency arrays and disables exhaustive-deps, making future stale rebuild/redraw bugs easy.
  Fix: expose named scalar dependencies or memoized keys and keep literal dependency arrays inside the hook.

- SEVERITY: LOW
  file: src/ui/useUplot.ts:40
  If `height` changes, cleanup destroys the plot but the new effect does not immediately rebuild unless resize/data changes.
  Fix: call `build()` after observing or include height in the rebuild path.

- SEVERITY: LOW
  file: src/ui/uplotZoom.ts:60
  Middle-drag document listeners are removed only on `mouseup`, so destroying the plot mid-drag leaves callbacks targeting a destroyed instance.
  Fix: clean them up through a uPlot destroy hook or `AbortController`.

- SEVERITY: LOW
  file: src/reader/browse.ts:173
  Stored chromatograms return arrays without equal-length, finite-value, or sorted-time validation.
  Fix: validate lengths/values and sort or reject malformed pairs.

- SEVERITY: LOW
  file: src/ui/SummaryTab.tsx:359
  Manifest rows use `e.name` as the React key, so duplicate archive names can cause incorrect row reuse.
  Fix: key rows by a stable composite such as `${index}:${e.name}`.

- SEVERITY: LOW
  file: src/state/store.ts:161
  `selectSpectrum` computes metadata outside the `try`, so metadata-table exceptions bypass existing error handling.
  Fix: move metadata and signal loading into the guarded block or validate index bounds first.

## NIT

- SEVERITY: NIT
  file: src/ui/FileLoader.tsx:22
  The `.mzpeak` extension check is case-sensitive.
  Fix: compare `file.name.toLowerCase().endsWith(".mzpeak")`.

- SEVERITY: NIT
  file: src/ui/components.tsx:187
  `StatCard` is exported but unused in the reviewed UI tree.
  Fix: remove it or use it as the shared summary card primitive.

## Overall Assessment

The app is reasonably careful about rendering untrusted metadata as React text rather than HTML, and the load-generation pattern is a good start, but it is applied inconsistently. The most serious issues are stale async completions that can cross-contaminate state between files and XIC source-selection logic that is wrong before a scan. The reader boundary also needs stricter validation and bounded plainification because malformed user-provided archives can currently produce incorrect plots or denial-of-service behavior.
