# Starting page (idle landing) — visual handoff for mzPeakIV

How to reproduce mzPeakExplorer's starting page so mzPeakIV looks like the same product.
Everything here is taken verbatim from the Explorer source — references are to
`src/ui/` in mzPeakExplorer.

The look is the **OpenMS / mzPeak identity**: a light, hairline-bordered "scientific
instrument" chrome, IBM Plex type, a single electric-blue accent, generous whitespace, a
centred logo, and a large dashed drop-zone. (In the full app the chrome wraps a *dark* data
stage where charts live — but the **starting page is all-light**.)

---

## 1. Foundations to copy first (do these and you're 80% there)

### 1a. Design tokens — copy the four token files verbatim
`src/ui/tokens/colors.css`, `typography.css`, `spacing.css`, `base.css`, imported in that
order at the top of `src/ui/styles.css`:

```css
@import "./tokens/colors.css";
@import "./tokens/typography.css";
@import "./tokens/spacing.css";
@import "./tokens/base.css";
```

The whole UI is built on the **semantic aliases** in `colors.css` (`--accent`, `--text-*`,
`--surface-*`, `--border-*`, `--radius-*`, `--focus-ring`, …) — components never hard-code a
hex value. Copy the files as-is; if mzPeakIV already has tokens, reconcile to these names.

Key values that define the feel:
- **Accent** `--accent: #3b54da` (OpenMS electric blue); hover `--accent-hover: #2f44bf`;
  soft wash `--accent-soft: #f2f4fe`.
- **Page** `--surface-page: #ffffff`; **panel** `--surface-panel: #f4f6f8`;
  **card** `--surface-card: #ffffff`.
- **Text** heading `#151a1e`, body `#353c43`, muted `#6b757e`.
- **Borders** are hairline: `--border-default: #dde2e7`, `--border-soft: #e3e7eb`.
- **Radii** small: inputs/buttons 3–4px, cards/dropzone 6px, panels 8px.
- **Focus** `--focus-ring: 0 0 0 3px rgba(59,84,218,0.28)`.
- The OpenMS brand spectrum gradient (`--openms-spectrum`, orange→blue) is **flourish chrome
  only — never used to encode data**.

### 1b. Fonts — self-hosted IBM Plex (no CDN)
Install `@fontsource/ibm-plex-sans` + `@fontsource/ibm-plex-mono` and import the weights in
your entry module (`src/main.tsx`), exactly as the Explorer does:

```ts
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
```

**Sans for all chrome; Mono (tabular figures) for every measured value** — numbers, IDs,
m/z, coordinates, units. `base.css` already wires `--font-sans` onto `body` and gives
`.mono`/`code` the mono family with `font-variant-numeric: tabular-nums`.

### 1c. Global element base (in `styles.css` / `base.css`)
- `html, body, #root { height:100%; width:100%; margin:0 }`; `* { box-sizing:border-box }`.
- `body`: `font-family: var(--font-sans)`, `color: var(--text-body)`,
  `background: var(--surface-page)`, `font-size:13px`, `line-height: var(--leading-normal)`,
  `-webkit-font-smoothing: antialiased`.
- **Focus ring** (accessibility, keep it): `:focus-visible { outline:none;
  box-shadow: var(--focus-ring); border-radius: var(--radius-xs) }`.
- **Reduced motion**: the `@media (prefers-reduced-motion: reduce)` block neutralises
  animations/transitions — copy it.
- Base `button` = the **secondary** control (hairline border, card bg, hover →
  accent border+text); `button.primary` = filled accent. See §3.

### 1d. Logo asset
`public/openms-logo.png` (the wordmark) + `public/openms-mark.svg` (the favicon, set in
`index.html` via `%BASE_URL%openms-mark.svg`). The `Logo` component loads
`` `${import.meta.env.BASE_URL}openms-logo.png` `` so it stays correct under a Pages
sub-path. Drop both assets into mzPeakIV's `public/`.

---

## 2. The idle page structure (`IdleLoader`, `src/ui/FileLoader.tsx`)

A single centred column, **`max-width: 560px`, `margin: 6vh auto 0`, `text-align: center`**,
stacked vertically:

1. **Logo**, centred, `size={62}` (just the mark, no product wordmark on this page).
2. **`<h2>` "Inspect an mzPeak file"** — `font-size:1.2rem`, `color: var(--text-heading)`,
   `font-weight: var(--weight-semibold)`, tight bottom margin.
3. **Intro `<p>`** — `color: var(--text-muted)`, `font-size: var(--text-body)`,
   `line-height: var(--leading-normal)`: one sentence on what it is + "the file never leaves
   your browser."
4. **Drop-zone** (the hero element) — see §2a.
5. **Privacy reassurance strip** — a soft bordered row with a green `ShieldCheck` icon
   (`lucide-react`, `--green-700`) and "Private by design… never uploaded." `--surface-panel`
   bg, `--border-soft` border, `--radius-md`, `--text-sm`.
6. **Action row** — primary **"Open demo"** button (`Play` icon) + a **"Download demo file"**
   link styled as `.demo-download` (see §3). `flex-wrap`, centred, `gap: 0.5rem`.
7. **Hint `<p>`** under the actions — `--text-xs`, `--text-muted`: when to stream vs download.
8. **URL form** — a text input (`placeholder="https://…/file.mzpeak"`, `max-width:380`,
   card bg, hairline border, `--radius-sm`) + a `.primary` submit "Load URL", disabled when
   empty.

Vertical rhythm between blocks is ~`0.9rem–1.4rem` top margins (see the component for exact
values). Keep it centred and airy.

### 2a. The drop-zone (the signature element)
A focusable `role="button"` `div` that is also the click-to-browse target and the
drag-and-drop target, with a hidden `<input type="file" accept=".mzpeak">`. Visual:

```
padding: 2.2rem 1rem;
border: 2px dashed var(--border-default);   /* → var(--accent) while dragging */
border-radius: var(--radius-lg);
background: var(--surface-panel);            /* → var(--accent-soft) while dragging */
color: var(--text-muted);                    /* → var(--accent) while dragging */
transition: var(--transition-ui);
cursor: pointer; user-select: none;
```
Label: `Drop a <strong>.mzpeak</strong> file, or <u>browse</u>`. On `dragover` flip the
border, background, and text to the accent variants (a small `over` state boolean). Keyboard:
Enter/Space triggers the file picker. Reset `input.value = ""` after each pick so the same
file re-triggers `onChange`.

---

## 3. Controls used on this page

- **Primary button** — `class="primary"` (or the `<Button variant="primary">` primitive):
  filled `--accent`, white text, hover `--accent-hover`. Used for "Open demo" and "Load URL".
- **Secondary button** — the base `button` element: card bg, hairline `--border-default`,
  hover → accent border + accent text.
- **`.demo-download` link** — looks like a small secondary button but is an `<a download>`:
  inline-flex, icon + label, `--text-sm`, `--weight-medium`, hairline border, hover → accent.
- **Icons** — `lucide-react`, ~14–15px, inheriting `currentColor` (so they pick up the accent
  on hover): `Play`, `Download`, `ShieldCheck`, plus `Logo`.

The `Button` primitive (`src/ui/components.tsx`) is worth copying — it encodes the sizes
(`sm`/`md`), the four variants (`primary`/`secondary`/`ghost`/`quiet`), and hover state.

---

## 4. The frame around it (optional, for full parity)

In the Explorer the idle page renders **inside the persistent app shell**, below a 52px-tall
`AppHeader` (white, `border-bottom: 1px solid var(--border-default)`, logo+product on the
left, actions on the right) — see `AppHeader` and `Logo({ product })` in
`src/ui/components.tsx`. mzPeakIV can either reuse that header or render the idle column on a
bare `--surface-page` background. The starting page itself does not require the header.

---

## 5. Adoption checklist for mzPeakIV

1. Copy `src/ui/tokens/{colors,typography,spacing,base}.css` and import them first in your
   global stylesheet.
2. Add `@fontsource/ibm-plex-sans` + `-mono`; import the 400/500/600(/700) weights in the
   entry module. Sans = chrome, Mono = every number.
3. Copy the global base: `box-sizing`, full-height `html/body/#root`, the `:focus-visible`
   ring, and the reduced-motion block.
4. Drop `openms-logo.png` + `openms-mark.svg` into `public/`; wire the favicon in `index.html`
   with `%BASE_URL%`.
5. Port the `IdleLoader` layout (§2): centred 560px column → logo 62 → h2 → intro → dashed
   drop-zone → privacy strip → demo actions → URL form. Reuse mzPeakIV's own
   `openFile`/`openUrl` store actions and its own demo URL.
6. Use the `.primary` / base-`button` / `.demo-download` styles (§3) and `lucide-react` icons.
7. Sanity check: accent is `#3b54da`, surfaces are white/`#f4f6f8`, borders are hairline
   `#dde2e7`, radii are 3–8px, and the drop-zone flips to the accent wash on drag.

> The visual system is deliberately restrained: one accent, hairline borders, flat chrome,
> tabular mono numbers, lots of whitespace. When in doubt, reference a semantic token rather
> than inventing a value — that's what keeps the two apps looking like one product.
