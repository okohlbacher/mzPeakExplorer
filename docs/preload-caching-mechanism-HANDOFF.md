# Preload + caching mechanism — handoff for mzPeakIV

How mzPeakExplorer keeps spectrum navigation fast over HTTP range requests against a
single-threaded, **non-reentrant**, **non-abortable** vendored reader (`mzpeakts` over
`zip.js` `HttpRangeReader`). Written so mzPeakIV can adopt the same design. All references
are to `src/state/store.ts` and `src/state/readScheduler.ts` in mzPeakExplorer.

## TL;DR

Three cooperating pieces:

1. **In-memory LRU spectrum cache** — decoded arrays kept under a byte budget; a cache hit
   bypasses all I/O and renders instantly.
2. **Two-lane serial read scheduler** — every reader signal-read runs one-at-a-time (the reader
   isn't reentrant), but **user reads preempt the background preloader's speculative reads**.
3. **Background preloader** — after the overview is on screen, speculatively buffers spectra
   nearest the current selection, **backing off while the user is actively navigating**.

The hard constraint that shapes everything: the reader exposes **no `AbortSignal`** — an
in-flight range fetch cannot be cancelled. So the goal is not "interrupt the current read" (we
can't) but "never let speculative work get *ahead* of the user, and get off the wire while the
user is active." This matters most on low-bandwidth links.

---

## 1. The in-memory spectrum cache

- `specCache: Map<number, SpectrumArrays>` keyed by **spectrum index**, insertion-ordered as an
  LRU (`cacheSpectrum` deletes+re-inserts on touch; `evictToBudget` drops oldest-first).
- Byte-budgeted: `specCacheBytes` vs `cacheBudgetBytes` (default derived per-session, presettable
  via `?cacheMB=`). Eviction keeps ≥1 entry.
- A cache hit in `selectSpectrum` returns immediately with **no spinner and no scheduler hop** —
  this is why, once preloaded, Prev/Next is instant.

> ⚠️ **Cache-poisoning pitfall (we hit this).** The cache is keyed by index only, with no file
> identity. If a read started against file A completes *after* file B has loaded, writing its
> result into `specCache` lets a later hit serve **A's arrays under B's index**. Guard every
> cache write with the load-generation check (below) **before** `cacheSpectrum`, and clear the
> cache on every new load (`resetSpecCache`).

## 2. Load generation = cancellation token

There is no cancellation in the reader, so we use a monotonically increasing **`loadGen`**
module counter, bumped on every `load()`. Every async path captures `const gen = loadGen` at
entry and bails (`if (gen !== loadGen) return`) at each await boundary — *and* re-checks **after**
the await before mutating state or caching. This is the project's universal "is my work still
relevant?" pattern; the scheduler and preloader lean on it heavily.

## 3. The two-lane read scheduler (`readScheduler.ts`)

A self-contained module — copy it wholesale. Public surface:

```ts
priorityRead<T>(fn): Promise<T>   // user-triggered, latency-critical
backgroundRead<T>(fn): Promise<T> // preloader's speculative reads
userIsActive(): boolean           // preloader polls this to back off
PRELOAD_COOLDOWN_MS               // post-read quiet window (350 ms)
```

Mechanics:

- **Single in-flight read.** One `draining` loop pulls from two FIFO lanes; only one read runs at
  a time (`await item.run()`), honouring the non-reentrant reader.
- **Priority.** The drain always takes `highLane.shift() ?? lowLane.shift()`, so a user read
  enqueued while a background read is in flight runs **next**, ahead of any queued background
  reads. It cannot preempt the *already-running* one (no abort) — that's the one bounded wait.
- **`userIsActive()`** is true while a user read is pending/in-flight **or** within
  `PRELOAD_COOLDOWN_MS` after the last one settled, on the **monotonic `performance.now()`** clock
  (not `Date.now()` — wall-clock jumps would mis-gate the cooldown).
- **Sync-throw safety.** Reads are dispatched as `Promise.resolve().then(fn).then(resolve, reject)`
  so a *synchronous* throw in `fn` rejects the caller instead of wedging the drain loop / leaking
  the active-read counter. (A bare `fn().then(...)` does **not** catch a sync throw — we got this
  wrong first.)

Wire-up in the store: `selectSpectrum`, `runXic`, `buildTic`, `loadStoredChromatogram` →
`priorityRead`; the preloader → `backgroundRead`.

## 4. The background preloader (`preloadInBackground`)

- **When it runs.** After the overview renders. **Local files** auto-preload; **remote (HTTP)
  files do NOT** — a `remoteSource` flag gates it, because eagerly fetching every cold row-group
  saturates the connection and starves navigation. Remote preload is opt-in (Settings) or kicked
  explicitly via `startPreload()` after a deep-linked spectrum has loaded.
- **Deep-link ordering.** `openUrl(url, { deferPreload })` + `load(..., deferPreload)` let a
  shared/deep-linked target spectrum load **first**, then `startPreload()` begins buffering — so
  the thing the user asked for never queues behind speculation.
- **Order.** Indices sorted nearest-to-current-selection first, so Prev/Next is buffered soonest.
- **Backoff (the low-bandwidth win).** Before each read the loop spins
  `while (userIsActive()) await sleep(PRELOAD_COOLDOWN_MS)`, re-checking cancel conditions each
  tick — so speculative buffering stays **off the wire** during a navigation burst and resumes
  ~350 ms after the user pauses.
- **Generation-scoped guard.** `preloadGen: number | null` (not a bare boolean) so opening a new
  file starts *its* preloader even while a previous gen's preloader is still unwinding its last
  in-flight read; the `finally` only clears the slot if it still owns it
  (`if (preloadGen === gen)`).
- **Re-checks after every await** (`gen`, `preloadEnabled`, budget) before caching — a file
  switch, a preload toggle-off, or a shrunk budget during a read must all abort the write.

## 5. In-flight de-duplication (`readSpectrumArrays`)

A single helper used by **both** lanes. If the preloader is already fetching index *i* when the
user navigates to *i* (or vice-versa), the second caller **piggybacks on the in-flight promise**
instead of issuing a duplicate row-group request. Keyed by index in `inflightSpectra`; each entry
self-removes on settle (`if (inflightSpectra.get(index) === p) inflightSpectra.delete(index)` — so
it never deletes a newer entry), and the whole map is cleared in `resetSpecCache`. The scheduled
closure also re-checks `gen` (returns `null` → caller skips) and the cache (a peer may have filled
it while queued).

## 6. What this does and does NOT buy you (honest)

**Does:** user reads never sit *behind queued* speculative reads; the preloader gets off the wire
during navigation bursts; no duplicate fetches; no cross-file cache poisoning; bounded, correct
cancellation.

**Does not:** it **cannot** preempt an already-started background read — the reader has no
`AbortSignal`. So the residual worst case is: a cache-missing jump that lands while one background
row-group fetch is in flight waits for **that one read** (≤ one row group; ~0.8 s warm-CDN, a few
seconds cold/low-bandwidth). The old design was already sequential, so be precise in PR/comments:
the win is *queue discipline + burst backoff*, not interruption.

## 7. Known limitations / future work (carry into mzPeakIV)

- **No in-flight abort.** The only true fix for the residual wait is threading an `AbortSignal`
  from `getSpectrum` down through `zip.js` fetches and aborting the background read when a user
  read arrives. That's invasive vendor surgery — deliberately not done here.
- **Scheduler gates signal reads only.** `getSpectrumArrays`, chromatogram extraction, and stored
  chromatograms go through it. **Metadata / archive / parquet-column reads are NOT gated**
  (`scanSpectra` column scan, study-blob + archive-member reads, `readParquetInfo`, deep parquet
  columns). In practice these hit different parquet sub-files / happen at load time or on explicit
  tab actions, but if you observe reader corruption under concurrency, widen the gate — except
  `scanSpectra`, which is long-running and intentionally left concurrent (gating it would block
  all spectrum reads for the whole scan).
- **Preload order is captured once.** If the user jumps far away during the cooldown, preload
  resumes around the *old* selection. Re-centering on the live `selectedIndex` when resuming would
  tighten the low-bandwidth benefit.
- **`PRELOAD_COOLDOWN_MS = 350` is a fixed guess.** Could be derived from observed read-latency
  percentiles for adaptivity.

## 8. Adoption checklist for mzPeakIV

1. Copy `src/state/readScheduler.ts` verbatim (+ its test).
2. Add a `loadGen` counter bumped on every load; capture+re-check it across all async reads.
3. Add the index-keyed LRU `specCache` with a byte budget + `resetSpecCache` (clearing any
   in-flight map) on load.
4. Route user reads through `priorityRead`, the preloader through `backgroundRead`.
5. Implement the preloader with: nearest-first order, `userIsActive()` backoff, gen-scoped guard,
   post-await re-checks, and **remote-source gating + deferred deep-link start**.
6. Add `readSpectrumArrays`-style in-flight de-dup if you have a preloader (you will, for imaging
   pixel spectra).
7. Guard **every** cache write with the gen check *before* writing — the cache-poisoning trap.
