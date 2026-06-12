# Handoff: touch-device zoom for spectra (and chromatograms)

**Status:** research complete, no code yet. **Owner:** _unassigned_. **Audience:** whoever implements
touch zoom in `/view/`. This is a self-contained brief — research summary, the decided strategy, a
phased roadmap with acceptance criteria, the core design, and a test/verification plan.

## TL;DR

On iPad / touch devices there is **no way to zoom the spectrum** (or chromatogram) charts — they're
mouse-only. After two adversarial research rounds (codex + vibe), the decision is: **build a small,
dependency-free Pointer-Events touch/pen branch into the existing uPlot plugin, and add `ctrl`+wheel
pinch for desktop trackpads in the same pass.** No gesture library, no charting-engine swap. Ship in
phases, gated on a **physical iPad Safari test**.

---

## 1. Problem & constraints

`src/ui/uplotZoom.ts` (`wheelZoomPlugin`) gives the spectrum chart: mouse **wheel** → x-zoom,
**middle-drag** → pan; uPlot's built-in **box-zoom** (left-drag) and **double-click reset**. On touch:
no wheel; middle-drag N/A; and uPlot's box-zoom needs `mousedown`/`mousemove` that touch doesn't
synthesize during a drag. **Net: touch users cannot zoom.** The **chromatogram** chart (`ChromPlot.tsx`)
shares the *same* plugin and additionally has **tap-to-select-RT**, which any touch handler must not
break.

Hard constraints:
- The charts live inside a scrollable `<main>` ([App.tsx](../src/ui/App.tsx)) — whatever captures touch
  must **not trap page scrolling**.
- x-zoom calls `setScale("x", …)`, which already feeds `reportZoom` → the share-view `mz=` deep-link
  param — so any zoom mechanism integrates with sharing for free.
- y stays **auto** (uPlot rescales to the tallest visible peak); spectra do not want y-zoom.

## 2. Decision & strategy

**Hand-rolled, zero new dependency.** Ship `ctrl`+wheel now (desktop), then a Pointer-Events touch/pen
branch for iPad, then visible buttons for discoverability/accessibility. Defer the navigator strip and
Safari `GestureEvent` unless on-device testing demands them.

### Options evaluated (round 2) and why they lost

| Option | Verdict | Why |
|---|---|---|
| **Gesture library** (@use-gesture / Hammer.js / interact.js) | **Reject** | `@use-gesture/vanilla` is ~2¼ yrs stale (10.3.1, Mar 2024) and still leaves all uPlot scale-math/clamp/tap-suppression to us; Hammer.js dead since 2016; interact.js ~96 KB and *recommends* `touch-action:none` (the scroll-trap we must avoid). Hand-rolled ≈150 lines, zero deps, full control. |
| **`ctrl`+wheel trackpad pinch** | **Adopt first** | macOS/precision-touchpad pinch arrives as `wheel`+`ctrlKey`; near-free desktop win. Caveat: the current wheel path is magnitude-blind, so the trackpad's tiny-delta stream over-reacts → must **normalize `deltaY`** (deltaMode + magnitude → bounded exponential). Existing `preventDefault()` already blocks browser page-zoom. Does nothing for iPad. |
| **Navigator / overview strip** | **Defer** | Proven touch pattern (Highcharts Stock disables pinch, uses it), discoverable, desktop-useful — but costs ~48–64 px + a second linked uPlot + handle UX + sync. Complement, not first move; build only if iPad pinch proves too fiddly. |
| **Safari `GestureEvent`** (`event.scale`) | **Defer (guard only)** | WebKit-proprietary; use its `gesturestart`/`gesturechange` `preventDefault()` only as a browser-zoom guard. Add a real `event.scale` branch only if Pointer Events fail on a real iPad. |

## 3. Roadmap (with acceptance criteria)

> **Required regardless of phase:** pure **unit tests** for the zoom/clamp math; a **synthetic
> multi-pointer test** for tap-vs-pan suppression; a decided **minimum visible span** (~0.05–0.1 Da m/z;
> a few seconds RT); **performance profiling** on large profile spectra (peak labeling runs on every
> redraw). **Physical iPad Safari testing is the real gate for Phase 2+** — emulators lie.

| Phase | Deliverable | ~Effort | Acceptance criteria |
|---|---|---|---|
| **1 — Desktop trackpad** | `ctrl`+wheel pinch in `wheelZoomPlugin`, with `deltaMode`/magnitude **normalization** → bounded exponential zoom; ordinary wheel unchanged. | ~0.5–1 d | On a Mac trackpad / Windows precision touchpad, pinch smoothly zooms the x-axis anchored under the cursor; no browser page-zoom; mouse-wheel zoom feels the same as before. |
| **2 — iPad spectrum MVP** | Additive **Pointer-Events** touch/pen branch in the shared plugin, **enabled for `SpectrumPlot` only**. | ~3–5 d | On a real iPad: two-finger pinch zooms x (anchored between the fingers); one-finger drag pans after a small threshold; double-tap resets; vertical swipe still scrolls the page; the hover tooltip doesn't stick; the mouse path and the share-view `mz=` link still work. |
| **3 — Chromatogram touch + copy fix** | Extend the touch branch to `ChromPlot` with a tap-threshold + post-gesture click-suppression; fix the stale hint in [ChromatogramsTab](../src/ui/ChromatogramsTab.tsx) ("drag to box-zoom RT" — drag is actually disabled). | ~1–2 d | On iPad: pinch/pan works on the chromatogram **and** a tap (below the move threshold) still selects the nearest spectrum; no selection fires after a pan/pinch. |
| **4 — Visible zoom controls** | Small `＋ / − / ⤢-reset` buttons overlaid on the plot (aria-label, keyboard focus, `touch-action: manipulation`, event-isolated). | ~1 d | Buttons zoom/reset on click and keyboard; reachable by tab; don't intercept chart gestures. (Not a full gesture replacement — no pan.) |
| **5 — Navigator strip** *(only if needed)* | Compact 48–64 px decimated overview strip with large drag handles, as a complement. | ~2–3 d | Build only if iPad usage shows pinch is a persistent failure. |

**Why this order:** Phase 1 is a near-free desktop win with zero touch risk; Phase 2 fixes the reported
iPad gap behind one device-test gate; Phase 3 protects the chromatogram's existing tap behavior;
Phases 4–5 are discoverability/a11y polish gated on real usage.

## 4. Core design (Phase 2)

Extend the **shared** plugin (rename `wheelZoomPlugin` → an x-interaction plugin) with a per-plot
`touch?: boolean` option; keep the mouse wheel + middle-drag paths intact.

- **Pointer Events**, not Touch Events: `pointerdown/move/up/cancel` on `u.over`; cache active pointers
  by `pointerId`; filter to `pointerType` `touch`/`pen` and pointers that began on `u.over`;
  `setPointerCapture`. Cleaner identity / `pointercancel` / Apple-Pencil handling than `touches[]`.
- **`touch-action: pan-y`** on `u.over` (**not** `none`) so a vertical swipe scrolls the page while the
  chart claims horizontal pan + pinch. Listeners `{passive:false}` + `preventDefault()` on claimed
  gestures (touch-action is fixed at gesture start, so toggling it mid-gesture is unreliable). Add a
  `gesturestart`/`gesturechange` `preventDefault()` **guard** for iOS Safari.
- **Pinch (2 pointers):** anchor in **data space** — `anchorVal = avg(posToVal(p1.x), posToVal(p2.x))`;
  store the initial x-scale + anchor + pointer distance; on move `newRange = initialRange ×
  initialDist/curDist`, holding `anchorVal` under the live midpoint. (Mirrors the existing wheel math;
  avoids the [uPlot #478](https://github.com/leeoniya/uPlot/issues/478) edge-pinch jump.)
- **State machine:** 1 pointer past a movement **threshold** = pan; below threshold = tap (let the
  chromatogram's click-select through); 2 pointers = pinch; **double-tap** = reset. Handle finger
  add/remove, simultaneous lift, `pointercancel`.
- **Clamp** with the normalized `xRange` (not raw `finiteExtent`, which can return zero-width `[a,a]` —
  see [chartTheme.ts](../src/ui/chartTheme.ts)) and enforce a **minimum span** so a hard pinch can't
  zoom into nothing.
- **Hide the hover tooltip** (driven by `setCursor` in [SpectrumPlot.tsx](../src/ui/SpectrumPlot.tsx))
  during an active touch gesture; suppress the synthetic click after a gesture.
- **rAF-throttle** the `setScale`; clean up listeners via `AbortController` on `destroy`.

### Pull the math into pure, testable functions

Extract (and unit-test) the parts that don't touch the DOM, e.g.:
- `zoomAroundAnchor(scale, anchorVal, factor, fullBounds, minSpan) → {min,max}`
- `panBy(scale, dxVal, fullBounds) → {min,max}`
- `normalizeWheelDelta(e) → factor` (handles `deltaMode` + `ctrlKey` trackpad amplification)
- `clampSpan(min, max, fullBounds, minSpan) → {min,max}`

## 5. Test & verification plan

- **Unit (vitest):** the pure functions above — anchor stays put across zoom, clamp respects
  `fullBounds` + `minSpan`, inverted/zero-width inputs rejected, wheel-delta normalization for
  mouse vs trackpad (`ctrlKey`).
- **Synthetic multi-pointer:** drive `pointerdown/move/up` with two fake pointers; assert pinch →
  expected scale, 1-pointer-below-threshold → tap (selection fires), 1-pointer-past-threshold → pan
  (no selection), `pointercancel` mid-gesture → clean abort.
- **On-device (the gate):** a physical iPad in Safari (and ideally an Android tablet in Chrome). Manual
  checklist matching the Phase 2/3 acceptance criteria: pinch, pan, double-tap reset, page-scroll over
  the chart, tooltip behavior, chromatogram tap-select, and that the share-view link round-trips the
  zoom. DevTools touch-emulation is **not** sufficient.
- **Perf:** profile pinch on a large *profile* spectrum (peak labeling runs each redraw via
  `topPeakIndices`); confirm rAF-throttling keeps it smooth.

## 6. Risks / failure modes to guard against

1. **Scroll-trap** — `touch-action:none` would block page scroll over the chart → use `pan-y`.
2. **Over-zoom to nonsense** — a hard pinch into an empty/noisy range → min-span clamp on normalized
   `xRange`.
3. **Chromatogram mis-select** — a selection firing after a pan/pinch → movement threshold + click
   suppression.
4. **Safari quirks** — non-standard `GestureEvent` + page-zoom → `preventDefault()` guard + the
   on-device gate.

## 7. Provenance

Two adversarial research rounds, each reviewed by **codex + vibe**:
- **Round 1** rejected a naive Touch-Events / `touch-action:none` / pixel-midpoint cut and converged on
  the Pointer-Events / `pan-y` / data-anchored design above.
- **Round 2** evaluated four alternatives (gesture libraries, navigator strip, `ctrl`+wheel, Safari
  `GestureEvent`) and produced the strategy + roadmap here.

**Sources:** [uPlot Pinch demo](https://leeoniya.github.io/uPlot/demos/zoom-touch.html) ·
[uPlot #478](https://github.com/leeoniya/uPlot/issues/478) ·
[MDN: Pinch-zoom with Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Pinch_zoom_gestures) ·
[MDN: touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action) ·
[Auchenberg — trackpad ctrl+wheel](https://kenneth.io/post/detecting-multi-touch-trackpad-gestures-in-javascript) ·
[Highcharts zooming/navigator](https://www.highcharts.com/docs/chart-concepts/zooming) ·
[@use-gesture](https://github.com/pmndrs/use-gesture) · [MDN: GestureEvent](https://developer.mozilla.org/en-US/docs/Web/API/GestureEvent).

## 8. Where to touch

| File | Change |
|---|---|
| [src/ui/uplotZoom.ts](../src/ui/uplotZoom.ts) | the plugin — add `ctrl`+wheel normalization (P1) + the Pointer-Events branch + per-plot `touch` option (P2) |
| [src/ui/chartTheme.ts](../src/ui/chartTheme.ts) | reuse `finiteExtent`/`xRange` for clamping; possibly export a `clampSpan` helper |
| [src/ui/SpectrumPlot.tsx](../src/ui/SpectrumPlot.tsx) | enable touch; hide tooltip during gesture |
| [src/ui/ChromPlot.tsx](../src/ui/ChromPlot.tsx) | enable touch with tap-threshold; preserve tap-to-select (P3) |
| [src/ui/SpectraTab.tsx](../src/ui/SpectraTab.tsx) / [ChromatogramsTab.tsx](../src/ui/ChromatogramsTab.tsx) | update interaction hint copy (P2/P3) |
