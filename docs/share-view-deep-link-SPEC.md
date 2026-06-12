# DRAFT — "Share view" deep link (reproduce the current view from a URL)

> **Status:** feature draft. A persistent **Share view** button (header right, when a
> cloud-hosted dataset is open) that copies a deep link encoding the *full view state* — which
> tab, which spectrum, which chromatogram, the MS-level filter — so a recipient opening the link
> in the same mzPeakExplorer instance lands on exactly what the sharer sees.
>
> Builds directly on the existing deep-link machinery (`?file=` / `?scan=` / `?chrom=` in
> `src/ui/App.tsx`, the `selectByScanNumber` / `showStoredChromatogram` store actions). This is an
> *extension*, not a new subsystem.

---

## 1. Goal & scope

- **When:** the button is shown **only while a cloud-hosted dataset is open** (`stage === "ready" &&
  sourceUrl != null`). Local-file sessions have no shareable data URL, so the button is hidden
  (a local `.mzpeak` can't be reproduced on someone else's machine).
- **What it carries:** the dataset URL **plus** the view: active tab, selected spectrum, MS-level
  filter, and chromatogram mode (TIC / XIC params / stored chromatogram).
- **What it does NOT carry:** the sharer's personal cache preferences (`preload` / `cacheMB`) — those
  are session-local, not "what we see"; imposing them on a recipient is wrong. (They remain
  presettable via their own params for power users, just not auto-included in a shared link.)
- **Recipient experience:** opening the link in the same instance auto-opens the file and replays the
  view after it's `ready`. A missing or stale target degrades gracefully (existing overview+error path).

This replaces today's **"Copy link"** button (which carries only `?file=`) with a state-complete
**"Share view"**.

---

## 2. URL schema

All params are optional except `file`. Short links: **only non-default state is emitted.**

| Param | Meaning | Example | Notes |
|---|---|---|---|
| `file` | dataset URL (existing; alias `url`) | `file=https%3A%2F%2F…%2Fx.mzpeak` | required to share |
| `tab` | active tab | `tab=spectra` | one of `summary\|metadata\|spectra\|chromatograms\|structure`; omitted when `summary` |
| `scan` | selected spectrum by **native scan number** (existing) | `scan=229` | preferred — stable across re-conversions |
| `spectrum` | selected spectrum by **0-based index** (fallback) | `spectrum=2` | used only when the id has no `scan=N` (e.g. imaging) |
| `ms` | MS-level filter | `ms=2` | omitted when no filter |
| `chrom` | chromatogram view | `chrom=tic` / `chrom=BasePeak_0` | `tic` ⇒ TIC; otherwise stored-chromatogram index/id (existing semantics) |
| `xic` | XIC by **centre + delta** | `xic=445.12,0.01` | `mz,delta` (delta = ± half-window); takes precedence over `chrom` |
| `xicmz` | XIC by **m/z range** | `xicmz=445.0,445.3` | `lo,hi`; alternative to `xic` (normalised to centre+delta); takes precedence over `xic` |
| `rt` | restrict TIC/XIC to a **retention-time window** | `rt=120,600` | `start,end` in **seconds**; optional; applies to `chrom=tic`, `xic`, `xicmz` (ignored for stored chromatograms) |

**Generate-on-the-fly** (hand-authored links). A chromatogram param alone computes and renders the
chromatogram — no `tab=` needed:
- **TIC** needs nothing but optionally an RT window: `chrom=tic` [`&rt=start,end`].
- **XIC** needs an m/z window — either a range (`xicmz=lo,hi`) or centre+delta (`xic=mz,delta`) —
  plus an optional RT window.

Precedence on apply: m/z window `xicmz` > `xic` > `chrom`; `scan` > `spectrum`. **Active tab**: an
explicit `tab=` wins; otherwise a chromatogram param lands on **chromatograms** (priority), else a
spectrum param lands on **spectra**, else summary. When **both** a spectrum and a chromatogram are
set, both are applied (the spectrum stays selected) but the chromatogram is shown first; switching to
Spectra then shows the selected spectrum.

Examples:
```
…/mzPeakExplorer/?file=<url>&tab=spectra&scan=229
…/mzPeakExplorer/?file=<url>&chrom=tic&rt=120,600
…/mzPeakExplorer/?file=<url>&xicmz=445.0,445.3
…/mzPeakExplorer/?file=<url>&xic=445.12,0.01&rt=120,600
…/mzPeakExplorer/?file=<url>&scan=10002&xic=445.12,0.01   # XIC shown, scan 10002 selected
```

---

## 3. Serialize — current state → params (`serializeView`)

A pure function `serializeView(state): string` producing the query string from a `useStore.getState()`
snapshot at click time:

```ts
function serializeView(s: State): string {
  const p = new URLSearchParams();
  if (s.sourceUrl) p.set("file", s.sourceUrl);
  if (s.tab && s.tab !== "summary") p.set("tab", s.tab);

  // Selected spectrum: prefer native scan number from the id; else index.
  if (s.selectedIndex != null) {
    const id = s.selectedSpectrum?.id ?? s.spectra[s.selectedIndex]?.id ?? "";
    const scan = parseScanNumber(id);            // existing helper
    if (scan != null) p.set("scan", String(scan));
    else p.set("spectrum", String(s.selectedIndex));
  }

  if (s.msLevelFilter != null) p.set("ms", String(s.msLevelFilter));

  if (s.chromMode === "xic" && s.xicParams) p.set("xic", `${s.xicParams.mz},${s.xicParams.tolDa}`);
  else if (s.chromMode === "stored" && s.chromStoredId) p.set("chrom", s.chromStoredId);
  else if (s.chromMode === "tic" && s.tab === "chromatograms") p.set("chrom", "tic");

  return `${location.origin}${location.pathname}?${p.toString()}`;
}
```
(`parseScanNumber` is already module-private in `store.ts`; expose it or duplicate a 1-liner in the
share module.)

---

## 4. Deserialize — params → actions (`applyView`), ordering

Extends the existing `pendingTarget` / `targetApplied` effect in `App.tsx`. Read all params once on
mount; after `stage === "ready"`, apply **in this order** (each step is a no-op when its param is
absent):

1. `setTab(tab)` — show the destination immediately (so the user sees progress while data resolves).
2. `ms` → `setMsLevelFilter(Number(ms))` — this triggers the per-spectrum scan it needs and may move
   the selection; do it before explicit selection so the explicit one wins.
3. spectrum → `selectByScanNumber(Number(scan))` (existing) or `selectSpectrum(Number(spectrum))`.
4. chromatogram → `xic` ⇒ `runXic(mz, tol)`; else `chrom==="tic"` ⇒ `showTic()`; else
   `chrom=<id>` ⇒ `showStoredChromatogram(chrom)` (existing).

All steps are best-effort + non-fatal (consistent with current deep-link behavior): a scan/chrom that
doesn't exist lands on the overview with an error banner; a tab is always valid. Runs once
(`targetApplied` guard) so later user navigation isn't clobbered.

> The current effect already handles `scan`/`chrom`; this adds `tab`, `spectrum`, `ms`, `xic`, and the
> `chrom=tic` case, and sequences them.

---

## 5. The button (UI)

In `App.tsx`'s header-right cluster (where "Copy link" is today), shown when `ready && sourceUrl`:

```tsx
<Button
  variant="ghost" size="sm"
  iconLeft={copied ? <Check/> : <Share2/>}          // lucide Share2
  onClick={shareView}
  title="Copy a link that reproduces this exact view (tab, spectrum, chromatogram, filter)"
>
  {copied ? "Copied" : "Share view"}
</Button>
```
`shareView()` = `serializeView(useStore.getState())` → `navigator.clipboard.writeText(link)` → flash
"Copied" for ~1.8 s (reuse the existing `copied` state + timer). On clipboard failure (or
non-secure-context), fall back to a tiny popover showing the selectable link.

**Placement note.** The user asked for it "at all times on the right-hand side." The header-right
cluster satisfies that and matches the existing affordance. Optional enhancement: a small floating
share pill pinned to the right edge of the data stage so it's reachable without going to the header —
deferred unless wanted.

### 5.1 Optional: live address-bar sync
Beyond the button, we *could* keep the address bar in sync with the view via a debounced
`history.replaceState(null, "", serializeView(state))` subscription — so refresh/bookmark preserve the
view and "Share view" simply copies `location.href`. Clean, but it makes the URL churn as the user
navigates. **Default: off** (button builds the link on click). Offer as a toggle later.

---

## 6. Edge cases

- **Imaging / non-Thermo ids** with no `scan=N` → `spectrum=<index>` fallback (handled in §3).
- **Spectrum chosen before the scan ran** → `spectrum=<index>` works without the full scan; `scan=`
  triggers the scan on the recipient side (existing `selectByScanNumber`).
- **Recipient's file fails to load** (CORS/offline) → existing error + `IdleLoader` recovery.
- **Very long URLs** — `file` is the bulk; total stays well under browser limits. No base64 needed.
- **Stale link after a re-conversion** — `scan` is more robust than `spectrum` (survives row reordering),
  which is why it's preferred.
- **Local file open** → button hidden (no `sourceUrl`).

---

## 7. Privacy

The link embeds the **dataset URL** (a public cloud object — same exposure as today's `?file=`
deep link) and view coordinates only. **No** cache prefs, **no** local-file data, **no** credentials.
The repo/site being public (per CLAUDE.md context) is unchanged by this. Worth a one-line tooltip note
that the link includes the dataset URL.

---

## 8. Files touched (when greenlit)

| File | Change |
|---|---|
| `src/ui/shareView.ts` | **new** — `serializeView(state)` + `parseView(search)` (pure, unit-testable) |
| `src/ui/App.tsx` | "Copy link" → "Share view" button; extend the deep-link apply effect (tab/spectrum/ms/xic/chrom=tic, ordered) |
| `src/state/store.ts` | export `parseScanNumber` (or re-derive in shareView); no new state |
| `src/ui/shareView.test.ts` | **new** — round-trip serialize↔parse for each view (spectra+scan, xic, stored chrom, ms filter, imaging index fallback) |

Small, additive, and reuses every existing action. No reader changes.

### 8.1 Test plan
Pure round-trip tests (no DOM): build a state snapshot → `serializeView` → `parseView` → assert the
params map back to the same actions; assert defaults are omitted (summary tab, no selection produce a
bare `?file=`); assert `scan` preferred over `spectrum` when the id carries a scan number; assert
`xic` precedence over `chrom`.

---

## 9. Open questions

1. **Button label/icon** — "Share view" (Share2) vs keep "Copy link" wording? (Recommend "Share view".)
2. **Live address-bar sync** (§5.1) — include now (off by default toggle) or defer? (Recommend defer.)
3. **Structure-tab state** (which parquet member / expanded deep-column) — worth encoding, or treat as
   ephemeral? (Recommend ephemeral for v1.)
4. **Replace vs add** — repurpose the existing "Copy link" button, or keep both ("Copy link" = file
   only, "Share view" = full state)? (Recommend replace — one button, full state.)
