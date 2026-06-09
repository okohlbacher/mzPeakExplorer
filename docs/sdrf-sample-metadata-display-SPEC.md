# SPEC v2 — Display SDRF / ISA study metadata in the Summary overview (blob-first)

> **Status:** implementation spec / handoff, **revision 2**. Supersedes v1.
> Placement: a **"Study & samples" dashboard section** on the Summary overview (mirrors the Imaging
> section). **Core revision (owner, 2026-06-09):** the embedded **verbatim SDRF/ISA blob is the
> authoritative source and is parsed client-side**; the producer's projected index-JSON keys are a
> secondary convenience only. This folds in the CODEX + knowledge-graph adversarial review
> (`§A` maps each finding to its resolution).
>
> Ground truth: HUPO-PSI **SDRF-Proteomics v1.1.0** (`bigbio/proteomics-sample-metadata`), the
> foundational Dai et al. 2021 paper, ISA-Tab/ISA-JSON (MetaboLights), and the v0.8 producer design
> (`../mzML2mzPeak/.planning/milestones/v0.8-DESIGN-DRAFT.md`).

---

## 0. TL;DR

When a `.mzpeak` carries an embedded study-metadata blob, render a **scannable dashboard** on the
Summary tab: a **study banner**, **factor chips** (the experimental design), a **biology summary**,
and a **channel / sample-assignment table** for this file's run(s). The blob is **parsed in the
browser** (standard SDRF TSV / ISA-Tab / ISA-JSON); the long tail (full characteristics matrix, all
comments, protocols) is behind an expander / "raw blob" view — this is a **dashboard, not a
re-serialization of SDRF**.

Two truths that shaped this revision:
1. **Projected keys can't be "comprehensive."** v0.8 projects only `accession`+`title`; factor values
   and ISA investigation richness live only in the blob → **we parse the blob** (review §A-1/A-2).
2. **The parser is testable now.** An SDRF/ISA blob is a standard document; develop + unit-test the
   parser against the **real corpus already on disk** at
   `../mzML2mzPeak/data/sdrf-examples/` (PXD011799 TMT-10, PXD020187 label-free, MTBLS5358 ISA-Tab)
   — independent of the still-draft producer. Only *embedding + retrieval* depends on v0.8.

Everything is **presence-gated and additive** → invisible on today's files.

---

## 1. Dashboard scope — what we show vs defer (be opinionated)

The user ask is a **dashboard overview**: the *most relevant* study + channel metadata, scannable at a
glance — not every SDRF column. Curated subset:

**Show (the dashboard):**
- **Study banner:** accession (linked to PRIDE/MetaboLights by format), title, format badge
  (SDRF / ISA-Tab / ISA-JSON), labeling (`TMT 10-plex` / `iTRAQ 4-plex` / `SILAC` / `label-free`),
  and counts: **N source samples · K channels · M data files**.
- **Factors** (study variables): each `factor value[*]` / ISA Study Factor → name + its distinct
  **levels** as chips. This is the experimental design; it is *not* optional (review §A-2).
- **Biology summary:** distinct **organism(s)**, **tissue/organism part**, **disease(s)**,
  **cell type(s)** across samples (reserved words excluded from these rollups), each with a count.
- **Channel / sample-assignment table** for *this file's* run(s) (§5.5): one row per
  **(channel × sample × data-file)** relationship — see the relationship model (§4).
- **Provenance:** format, embed scope, retrieved-at, **verified** sha256, "View raw blob".
- **Diagnostics:** parser/normalization warnings.

**Defer (expander / raw view, not the dashboard):**
- Full per-sample characteristics matrix, all `comment[*]`, modification parameters
  (`MT/TA/PP`), ISA protocols / processSequence, ontology-source-reference registry.
- These stay one click away via an expandable panel + the raw-blob download.

---

## 2. Inputs & retrieval

### 2.1 The blob (authoritative)
- Located by name from `metadata.sample_metadata` (the producer records the archive member;
  **require an explicit member/`archive_path` field**, scan `fileIndex.files[]` for a
  `sample_metadata/` prefix only as a diagnostic fallback — review §A-12).
- Read the **raw member bytes** via a new bounded reader API (§7.1) — `archive.ts` today only reads
  parquet footers, so this is **new plumbing** (correcting v1's "no new plumbing" claim — review §A-13).
- **Verify** the member bytes' SHA-256 against `metadata.sample_metadata.sha256`; show
  *verified* / *declared (unverified)* / *mismatch ⚠* accordingly (review §A-14).

### 2.2 Projected keys (convenience only)
`reader.store.fileIndex.metadata.study` may carry `accession` + `title`; use them for the banner
*before* the blob parses (fast paint), then reconcile with the blob. **Accept `accession`; tolerate
`dataset_accession` as a legacy alias with a diagnostic** (review §A-15). Do **not** depend on these
keys for anything the blob provides.

### 2.3 Presence gate (strict)
Render the section **only** when an SDRF/ISA **blob member exists** (or `metadata.sample_metadata`
is present). **Do not** trigger on a non-empty mzML `<sampleList>` alone — that is ordinary mzML
sample metadata, not a study document, and belongs (if anywhere) in its own clearly-labeled block
(review §A-3).

---

## 3. Format detection

From the member name + a cheap sniff:
- `…/sdrf.tsv` or `*.sdrf.tsv` / `.txt` with a header row containing `source name` + `characteristics[` → **SDRF**.
- `…/isa/i_*.txt` (or a member set with `i_/s_/a_` prefixes) → **ISA-Tab**.
- `…/isa.json` / JSON with top-level `investigation` → **ISA-JSON**.
- Record the detected format; on ambiguity, emit a diagnostic and prefer the `metadata.sample_metadata.format` hint.

---

## 4. Data model — relationships, not flat entries (review §A-7/A-9/A-11)

SDRF is **one row per (sample × data-file × label)**; `source name`, `comment[data file]`,
`comment[label]`, fraction, and any sample-list id are **distinct**. Model them separately.

```ts
export type CvRef = { prefix: string; accession: string; label: string | null };
//  prefix kept verbatim (e.g. "MS", "Unimod", "NCBITaxon"); `${prefix}:${accession}` for lookups.

export type Cell = {
  /** verbatim cell text (lexical), e.g. "Homo sapiens" or "NT=TMT6plex;AC=Unimod:737;MT=fixed" */
  raw: string;
  value: string | null;           // NT= or the plain value; null when reserved/empty
  cv: CvRef | null;               // from AC=
  unit: CvRef | null;
  reserved: "not available" | "not applicable" | "anonymized" | "pooled" | null;  // review §A-10
  extra: Record<string, string>;  // MT/TA/PP/… verbatim (deferred from the dashboard)
};

export type LabelKind = "isobaric" | "silac" | "label-free" | "other";
//  isobaric ⇒ TMT/TMTpro/iTRAQ; silac ⇒ "SILAC light|medium|heavy"; label-free ⇒ "label free sample"

/** One SDRF relationship row (or ISA assay-row projection), already typed. */
export type StudyRow = {
  sourceName: string;             // characteristics' subject (biological sample)
  assayName: string | null;
  dataFile: string | null;        // comment[data file] / ISA Raw|Derived Spectral Data File (basename)
  label: string | null;           // comment[label] raw, e.g. "TMT126", "label free sample"
  labelKind: LabelKind;
  reporterMz: number | null;      // resolved from a reagent table by label (§6.3); null if unresolvable
  role: ChannelRole;              // experimental | reference | carrier | norm | empty | unknown
  poolMembers: string[];          // SN= members when characteristics[pooled sample]=SN=…
  tag: CvRef | null;              // Unimod label-mod (TMT6plex=Unimod:737), from comment[modification parameters]
  fraction: string | null;        // comment[fraction identifier]
  characteristics: Record<string, Cell>;  // keyed by EXACT header inside [...] e.g. "organism","disease"
  factors: Record<string, Cell>;           // factor value[...] by exact name
  matchesThisFile: boolean;       // dataFile basename matches the open .mzpeak (§5.5)
};

export type StudyFactor = { name: string; levels: string[] };  // distinct levels across rows

export type Investigation = {     // populated from ISA; from SDRF only accession/title are knowable
  accession: string | null; title: string | null; description: string | null;
  contacts: string[]; publications: string[]; protocols: string[];   // ISA only; [] for SDRF
};

export type StudyMetadata = {
  format: "sdrf" | "isa-tab" | "isa-json";
  investigation: Investigation;
  rows: StudyRow[];                         // all rows in the blob (whole study or applicable subset)
  factors: StudyFactor[];
  labeling: { kind: LabelKind; plex: number | null; reagent: string | null }; // e.g. {isobaric,10,"TMT"}
  // Counts (review §A-9): these are DIFFERENT numbers — never conflate.
  counts: { sourceSamples: number; channels: number; dataFiles: number; rows: number };
  provenance: StudyProvenance;              // format, sourceUri, embedScope, retrievedAt, sha256, hashState
  biology: { organisms: string[]; tissues: string[]; diseases: string[]; cellTypes: string[] };
  diagnostics: string[];
};
```

`ChannelRole = "experimental" | "reference" | "carrier" | "norm" | "empty" | "unknown"`.

---

## 5. SDRF parser (`src/reader/sdrf.ts`)

Pure function `parseSdrf(text: string, thisFileName: string): StudyMetadata`. Testable in isolation.

### 5.1 Tokenize
Split into lines, then each line on `\t`. **No CSV quoting** — SDRF cells legitimately contain `;`
and `=`; RFC-4180 `"` handling would mis-split (`quoting=false`). Rows are ragged → tolerate short rows.

### 5.2 Header → column typing by prefix (exact, case-sensitive)
Columns are **lowercase, space-sensitive**. Classify each header:
- `source name`, `assay name`, `technology type` → identity columns.
- `characteristics[X]` → sample characteristic `X` (keep `X` verbatim: `organism`, `disease`, `organism part`, `cell type`, `age`, `pooled sample`, `biological replicate`, …).
- `comment[X]` → data-file/technical: notably `comment[label]`, `comment[data file]`, `comment[file uri]`, `comment[instrument]`, `comment[fraction identifier]`, `comment[modification parameters]` (repeated), `comment[carrier channel]`, `comment[reference channel]`.
- `factor value[X]` → study variable `X`.
Duplicate headers (e.g. repeated `comment[modification parameters]`) → collect as a list.

### 5.3 Cell grammar → `Cell` (review §A-5/A-10)
For each cell:
- If lowercased value ∈ {`not available`,`not applicable`,`anonymized`,`pooled`} → set `reserved`, `value=null`.
- If it contains `=` and `;`-separated tokens → parse `NT=`(→`value`/label), `AC=`(→`cv`, **CURIE parsed case-insensitively**, §7.2), unit, and **keep all other tokens (`MT/TA/PP/CT/…`) verbatim in `extra`**.
- Else plain value (free text = a CV term name, or a number+unit, or a URI, or a date).

### 5.4 Build `StudyRow`s
- `sourceName`←`source name`; `assayName`←`assay name`; `dataFile`←basename of `comment[data file]` (strip path; the value may name the **`.raw`/`.d`/`.wiff`** — keep basename sans known extension); `fraction`←`comment[fraction identifier]`.
- `label`←`comment[label]` raw; `labelKind` = classify (§7.3): isobaric (TMT/TMTpro/iTRAQ pattern) | silac (`SILAC …`) | label-free (`label free sample`) | other.
- `tag`←first `comment[modification parameters]` whose `NT`/`AC` is a labeling reagent (TMT/iTRAQ/TMTpro Unimod); `reporterMz`←reagent-table lookup by `label` (§6.3).
- `role`: `carrier` if `comment[carrier channel]`’s value equals this row’s label; `reference` if `comment[reference channel]` matches; `norm`/`empty`/`experimental` otherwise; `unknown` if undeterminable.
- `poolMembers`: parse `characteristics[pooled sample]` = `SN=a;SN=b` → `[a,b]`.
- `characteristics`/`factors`: the typed `Cell` maps.

### 5.5 "This file's rows" (review §A-8)
`matchesThisFile` = `dataFile` basename equals the open archive's file name basename across sibling
extensions (`.raw/.d/.wiff/.mzML/.mzml`). The **channel table** renders `rows.filter(matchesThisFile)`;
the **study banner/factors/biology** summarize **all** rows in the blob. If *no* row matches (full-study
embed with a different naming), fall back to all rows + a diagnostic.

### 5.6 Labeling / plex inference (review §A-8) — per assay group, not global
Group rows by `(dataFile, assayName)`; within a group the distinct isobaric labels = the **observed
channels**. `labeling.reagent` from the tag/label family (TMT vs TMTpro vs iTRAQ); `labeling.plex` =
the reagent's nominal plex when known (TMT 6/10/11/16/18; iTRAQ 4/8) else `observed channel count`,
and **show "observed N channels" distinct from "reagent plex"** when they differ (missing/empty channels).

### 5.7 Counts (review §A-9)
`sourceSamples` = distinct `sourceName`; `channels` = distinct `(group, label)` isobaric rows;
`dataFiles` = distinct `dataFile`; `rows` = row count. Never reuse one for another.

---

## 6. ISA parser (`src/reader/isa.ts`)

ISA is normalized; a single assay file is meaningless without its investigation, so the embed is the
whole bundle. For the **dashboard** we need a *thin* projection (review §A-1):

### 6.1 ISA-Tab
- `i_Investigation.txt`: section-keyed tab blocks. Surface **INVESTIGATION** Title/Description,
  **INVESTIGATION PUBLICATIONS**, **INVESTIGATION/STUDY CONTACTS**, **STUDY FACTORS** (→ `factors`),
  **STUDY PROTOCOLS** (deferred to expander), and the **ONTOLOGY SOURCE REFERENCE** registry
  (resolves `Term Source REF` → real CV for CURIE display). `accession`←Study Identifier (`MTBLS…`).
- `s_*.txt`: `Source/Sample Name` + `Characteristics[*]` (+ paired `Term Source REF`/`Term Accession Number` — ISA carries CV **out-of-band**, unlike SDRF's inline `AC=`). → `StudyRow.sourceName` + characteristics.
- `a_*.txt`: `Sample Name → … → Raw/Derived Spectral Data File`; `matchesThisFile` on those file columns. Labels rare in metabolomics → mostly `label-free`.

### 6.2 ISA-JSON
Own `Deserialize` + `@id` reference resolution (material nodes, processSequence), projected into the
same `StudyMetadata`. Three parse front-ends (SDRF cells · ISA-Tab blocks · ISA-JSON nodes) → **one**
model.

### 6.3 Reporter-ion reagent table (shipped constant)
A small static map `label → reporter m/z` for TMT 126–131 (+N/C isotopologues), TMTpro 126–134,
iTRAQ 113–121. `null` for any label not in the table (e.g. an unrecognized tag) — **never a sentinel
0/NaN** (review §A-16). This is physical-constant data, not read from the (untrusted) blob.

---

## 7. Normalization, reader & store wiring

### 7.1 Raw member read (new, bounded)
Add `readArchiveMember(reader, name, { maxBytes }): Promise<Uint8Array>` to `archive.ts` (uses the
zip layer the reader already has). **Size-cap** (e.g. 8 MB default; SDRF/ISA text is small) and refuse
larger with a diagnostic. Decode as UTF-8 text. This is the "View/Download raw blob" source too.

### 7.2 CURIE normalization (review §A-4/A-5)
`normCurie(s)`: split on first `:` or `_`; **uppercase-insensitive prefix compare** for matching
(`unimod` ≡ `UNIMOD` ≡ `Unimod`; `ms` ≡ `MS`), but **preserve original casing for display**.
Matching the sample-label term and tag uses normalized prefixes — never `startsWith("UNIMOD:")`.

### 7.3 Isobaric / SILAC / label-free detection (review §A-6)
By **label value**, not mere presence:
- isobaric ⇔ `/^(TMT|TMTpro|iTRAQ)\d/i` (or a known label CV child).
- silac ⇔ `/^SILAC (light|medium|heavy)/i` → render a **SILAC** labeling note, *no channel table*.
- label-free ⇔ `label free sample`.
- else `other` → "labeling: <verbatim> (unclassified)", never silently "label-free".

### 7.4 Store
Compute `studyMeta: StudyMetadata | null` at `load()` (after the index + samples are read). Parsing
the blob is async (member read) — set it once resolved; the banner can paint from projected keys
meanwhile. Carry on the store (sibling to `summary`, like imaging rides `summary.imaging`). Parse off
the main thread if a blob is large (it won't be, given the cap).

---

## 8. UI — `SampleMetadataSection` (dashboard) in `SummaryTab.tsx`

Render only when `studyMeta != null`. Layout, top to bottom:

1. **Study banner** (one row of compact stat chips, like the summary cards):
   `PXD011799 ↗` · `SDRF` · **TMT 10-plex** · `5 samples · 10 channels · 1 file` · `Homo sapiens`.
   Accession links by format (PRIDE for `PXD…`, MetaboLights for `MTBLS…` — review §A-15). Title below.
2. **Factors** (chips): `enrichment process: {no enrichment}` · `disease: {melanoma, control}`. The
   experimental design — always shown when present.
3. **Biology** (key/value, deduped, counts): Organism(s), Tissue, Disease(s), Cell type(s).
   Reserved-word cells excluded from these rollups; shown as status only on the per-row table.
4. **Channel / sample-assignment table** — `rows.filter(matchesThisFile)`, grouped by data file:
   - isobaric columns: `Channel · Reporter m/z · Sample · Organism · Disease · Cell type · Role · Tag`,
     sorted by reporter m/z (label order fallback). Reserved cells → muted "n/a"/"pooled" badge, not `—`.
     Reference/Carrier/Norm/Empty roles get a distinct badge; pool rows list `poolMembers`.
   - reporter m/z absent (TMTpro gap) → `—` with a tooltip "reporter m/z unresolved", never `NaN/0`.
   - **label-free / ISA** → drop channel columns → `Sample · Organism · Tissue · Disease · …` table.
   - **SILAC** → no channel table; a labeling note + the sample list.
5. **Provenance + raw**: format · scope · retrieved · **sha256 (verified ✓ / declared / mismatch ⚠)** ·
   *View raw blob* (opens the decoded member) · *Download*.
6. **Expander** "All characteristics & comments" → the deferred long-tail matrix.
7. **Diagnostics** (muted list) when non-empty.

### 8.1 CV tooltips — honest about coverage (review §A-5)
The bundled `cv-terms.json` is **PSI-MS + Unit + Imaging-MS only**, and `accessionIn` matches
`MS|IMS|UO|PEFF|BTO|NCIT|PRIDE`. So **organism (NCBITaxon), disease (EFO/MONDO), Cellosaurus, Unimod
tags resolve to no definition.** Options (pick one, don't over-promise):
- (a) show the term **name from the blob** (`NT=`/ISA value) always, and only add a definition tooltip
  when the accession is in the bundled map; for others, link the accession out to **OLS**
  (`https://www.ebi.ac.uk/ols4/search?q=<acc>`); **or**
- (b) extend `gen-cv-terms.mjs` to also bundle NCBITaxon/EFO/Unimod subsets (heavier — EFO is huge).
Recommended: **(a)** — name from blob + OLS link-out; no false "no definition" gaps.

---

## 9. Security / robustness (review §A blob-is-untrusted)

- The blob is **user-supplied text** → treat as untrusted. React escapes by default (no
  `dangerouslySetInnerHTML`); strip control chars; cap cell render length; cap member size (§7.1);
  cap rendered rows (virtualize / "+N more" for pathological sample lists).
- **Never** fetch anything referenced *inside* the blob (`comment[file uri]`, ISA URIs) — display only.
- sha256: compute + compare; an archive can otherwise show a reassuring but unrelated hash (review §A-14).
- Parser must never throw on malformed input → partial parse + diagnostics.

---

## 10. Testing — against the REAL corpus (now possible)

Unit-test the pure parsers against files already on disk
(`../mzML2mzPeak/data/sdrf-examples/`), copied into `src/reader/__fixtures__/`:
- **PXD011799** (TMT 10-plex): assert 10 channels, labels `TMT126…TMT131`, reporter m/z resolved,
  pool/reference role on the `Pool` rows, tag `Unimod:737`, factors `[enrichment process]`,
  organism `Homo sapiens`, `counts.sourceSamples=5 / channels=10`.
- **PXD020187** (label-free): assert `labelKind=label-free`, no channel columns, factor `[disease]`.
- **MTBLS5358** (ISA-Tab GC-MS): assert investigation title/description parsed, study factors,
  label-free, assay→sample→file binding.
- **Adversarial**: mixed CURIE casing (`Unimod:` vs `UNIMOD:`), reserved words in organism/disease,
  ragged rows, duplicate `comment[modification parameters]`, a SILAC label, a TMTpro label with no
  reporter m/z, a 5,000-row blob (perf/virtualization), a hash mismatch.

End-to-end (a tiny hand-built `.mzpeak` with a `sample_metadata/sdrf.tsv` member) is optional until
the producer ships, since the parser is independently covered.

---

## 11. Files touched (when greenlit)

| File | Change |
|---|---|
| `src/reader/types.ts` | the model in §4 (`StudyMetadata`, `StudyRow`, `Cell`, `CvRef`, `ChannelRole`, …) |
| `src/reader/sdrf.ts` | **new** — `parseSdrf(text, thisFileName)` (§5) |
| `src/reader/isa.ts` | **new** — `parseIsaTab` / `parseIsaJson` (§6) |
| `src/reader/reagents.ts` | **new** — static reporter-m/z reagent table (§6.3) |
| `src/reader/sampleMeta.ts` | **new** — orchestrator: detect format, read member, verify hash, dispatch parser, reconcile with projected keys |
| `src/reader/archive.ts` | **add** `readArchiveMember` bounded raw-member read (§7.1) |
| `src/reader/cv.ts` / `cvTerms.ts` | CURIE normalization (§7.2); OLS link-out helper (§8.1) |
| `src/state/store.ts` | async `studyMeta` compute in `load()`; carry on summary |
| `src/ui/SummaryTab.tsx` | **new** `SampleMetadataSection` dashboard (§8) |
| `src/reader/__fixtures__/…` + tests | real SDRF/ISA fixtures + adversarial (§10) |

Additive + presence-gated → zero change on current files. Validate with `tsc -p tsconfig.app.json
--noEmit` + fresh-checkout build. **Note:** this is now a multi-module feature (two parsers + a
reagent table + a member reader) — larger than the imaging section; budget accordingly.

---

## 12. Remaining contract points (reduced — blob is authoritative)

Only retrieval/provenance still depends on the producer; the *content* comes from the standard blob:
1. **Explicit blob member path** in `metadata.sample_metadata` (don't force a name scan) — review §A-12.
2. **sha256 present** for verification.
3. Whether the default embed is *applicable rows* or *full study* (affects §5.5 matching; handled either way).
4. ISA bundle member layout (`isa/i_*.txt` set vs `isa.json`).
Everything else (channels, factors, characteristics, investigation) is read from the blob — no
dependency on the producer's projected keys or the upstream `ms_run.sample_ref`.

---

## A. Adversarial-review traceability (CODEX + knowledge-graph)

| # | Finding (sev) | Resolution |
|---|---|---|
| A-1 | *Crit* — comprehensiveness impossible from keys | Blob parsed in v1 (§2.1, §5, §6). |
| A-2 | *Crit* — factor values are the study design, were hidden | Factors are a first-class dashboard block (§1, §8.2); parsed from `factor value[*]` / ISA Study Factors. |
| A-3 | *High* — presence gate over-triggers on plain mzML samples | Strict gate on blob/`sample_metadata` presence (§2.3). |
| A-4 | *High* — CURIE casing case-sensitive | `normCurie`, case-insensitive prefix match, display-preserving (§7.2). |
| A-5 | *High* — CV tooltips won't resolve (NCBITaxon/EFO/Unimod) | Name-from-blob + OLS link-out; honest coverage (§8.1). |
| A-6 | *High* — `no MS:1002602 ⇒ label-free`; SILAC mislabeled | Detect by label value; SILAC/other branches (§7.3). |
| A-7 | *High* — `id == source name` conflation | Relationship model: source/file/label/fraction separate (§4). |
| A-8 | *High* — global plex inference breaks | Per-assay-group; observed-channels vs reagent-plex (§5.6). |
| A-9 | *Med* — sample vs channel count confusion | Three distinct counts (§5.7, model `counts`). |
| A-10 | *Med* — reserved words rendered as values | Detected → status badges; excluded from rollups (§5.3, §8). |
| A-11 | *Med* — fractionation 1:N files | One row per (channel × sample × file); grouped by file (§4, §8.4). |
| A-12 | *Med* — blob discovery by name-scan fragile | Require explicit member path; scan = diagnostic fallback (§2.1). |
| A-13 | *Med* — `archive.ts` can't read arbitrary members | New bounded `readArchiveMember` (§7.1). |
| A-14 | *Med* — sha256 shown but unverified | Compute + compare; verified/declared/mismatch states (§2.1, §8.5). |
| A-15 | *High/Low* — `dataset_accession` vs `accession`; PXD-only link | Standardize `accession` (+legacy alias); format-aware accession link (§2.2, §8.1). |
| A-16 | *Med* — missing reporter m/z as NaN/0; thin fixtures | `null` never sentinel; real + adversarial fixtures (§6.3, §10). |
