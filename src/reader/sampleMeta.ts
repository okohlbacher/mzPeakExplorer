// Orchestrator for embedded study sample-metadata (SDRF / ISA): locate the blob
// member, read + hash-verify it, detect the format, dispatch to the parser, and
// reconcile with the index.json projected keys. Mirrors readImaging's defensive
// posture; returns null when the file carries no study metadata (presence gate).
import type { Reader } from "./open";
import type { HashState, StudyMetadata, StudyProvenance } from "./types";
import { readArchiveMember } from "./archive";
import { parseSdrf } from "./sdrf";
import { parseIsaTab, parseIsaJson, type IsaTabBundle } from "./isa";

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

type Format = "sdrf" | "isa-tab" | "isa-json";

function detectFormat(member: string | null, hint: string | null): Format | null {
  const h = (hint ?? "").toLowerCase();
  if (h.includes("isa-json") || h === "isa_json") return "isa-json";
  if (h.includes("isa")) return "isa-tab";
  if (h.includes("sdrf")) return "sdrf";
  const m = (member ?? "").toLowerCase();
  if (m.endsWith(".json") || m.includes("isa.json")) return "isa-json";
  if (m.includes("/isa/") || /(^|\/)i_.*\.txt$/.test(m)) return "isa-tab";
  if (m.includes("sdrf") || m.endsWith(".tsv")) return "sdrf";
  return null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  try {
    // Copy into a fresh ArrayBuffer-backed view (satisfies BufferSource typing).
    const buf = new Uint8Array(bytes);
    const d = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function memberNames(reader: Reader): string[] {
  const files = (reader as unknown as { store?: { fileIndex?: { files?: { name?: unknown }[] } } })
    .store?.fileIndex?.files ?? [];
  return files.map((f) => String(f?.name ?? "")).filter(Boolean);
}

/** Read + project the embedded study metadata, or null when none is present. */
export async function readStudyMetadata(
  reader: Reader,
  fileName: string | null,
): Promise<StudyMetadata | null> {
  const meta = obj((reader as unknown as { store?: { fileIndex?: { metadata?: unknown } } })
    .store?.fileIndex?.metadata);
  const prov = obj(meta?.sample_metadata);
  const study = obj(meta?.study);
  const names = memberNames(reader);

  // Locate the blob member: explicit field wins; else scan for sample_metadata/.
  // v0.8 contract (mzpeak-extension-contract §3.9) names this `archive_name`;
  // tolerate the older member/archive_path/path spellings too.
  const explicit =
    str(prov?.archive_name) ?? str(prov?.member) ?? str(prov?.archive_path) ?? str(prov?.path);
  const scanned = names.find((n) => n.toLowerCase().includes("sample_metadata/")) ?? null;
  const member = explicit ?? scanned;

  // Presence gate (review §A-3): need a blob member OR a sample_metadata block.
  if (!member && !prov) return null;

  const diagnostics: string[] = [];
  if (!explicit && scanned) {
    diagnostics.push(`Blob member located by name scan ("${scanned}"); no explicit member field.`);
  }

  const formatHint = str(prov?.format);
  const format = detectFormat(member, formatHint);
  if (!member || !format) {
    diagnostics.push("Study metadata block present but no readable blob member was found.");
    // Fall back to a keys-only banner so the section still shows what little we have.
    return keysOnly(study, prov, member, diagnostics);
  }

  // Provenance + hash verification.
  const sha = str(prov?.sha256);
  const provenance: StudyProvenance = {
    format,
    sourceUri: str(prov?.source_uri) ?? str(prov?.sdrf_uri) ?? str(prov?.uri),
    embedScope: str(prov?.embed_scope),
    retrievedAt: str(prov?.retrieved_at),
    sha256: sha,
    hashState: "none",
    member,
  };

  try {
    if (format === "isa-tab") {
      const bundle = await readIsaBundle(reader, member, names);
      provenance.hashState = await verify(bundle.hashBytes, sha);
      const sm = parseIsaTab(bundle.tab, fileName, provenance);
      return reconcile(sm, study, prov, diagnostics);
    }
    const blob = await readArchiveMember(reader, member);
    if (!blob) {
      diagnostics.push(`Blob member "${member}" could not be read.`);
      return keysOnly(study, prov, member, diagnostics);
    }
    provenance.hashState = await verify(blob.bytes, sha);
    const sm =
      format === "isa-json"
        ? parseIsaJson(safeJson(blob.text), fileName, provenance)
        : parseSdrf(blob.text, fileName, provenance);
    return reconcile(sm, study, prov, diagnostics);
  } catch (err) {
    diagnostics.push(`Failed to read study metadata: ${err instanceof Error ? err.message : String(err)}`);
    return keysOnly(study, prov, member, diagnostics);
  }
}

async function verify(bytes: Uint8Array | null, declared: string | null): Promise<HashState> {
  if (!declared) return "none";
  if (!bytes) return "declared";
  const actual = await sha256Hex(bytes);
  if (!actual) return "declared";
  return actual.toLowerCase() === declared.toLowerCase() ? "verified" : "mismatch";
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** Read all ISA-Tab members (i_/s_/a_) under the blob's directory. */
async function readIsaBundle(
  reader: Reader,
  member: string,
  names: string[],
): Promise<{ tab: IsaTabBundle; hashBytes: Uint8Array | null }> {
  const dir = member.includes("/") ? member.slice(0, member.lastIndexOf("/") + 1) : "";
  const inDir = names.filter((n) => n.startsWith(dir) || n.includes("/isa/"));
  const pick = async (pred: (b: string) => boolean): Promise<string[]> => {
    const out: string[] = [];
    for (const n of inDir) {
      const base = n.split("/").pop() ?? n;
      if (pred(base.toLowerCase())) {
        const m = await readArchiveMember(reader, n);
        if (m) out.push(m.text);
      }
    }
    return out;
  };
  const investigation = (await pick((b) => b.startsWith("i_")))[0] ?? "";
  const studies = await pick((b) => b.startsWith("s_"));
  const assays = await pick((b) => b.startsWith("a_"));
  // Hash the investigation member as the provenance anchor (best-effort).
  const inv = await readArchiveMember(reader, member);
  return { tab: { investigation, studies, assays }, hashBytes: inv?.bytes ?? null };
}

/** Fill blank investigation accession/title from the projected index keys. */
function reconcile(
  sm: StudyMetadata,
  study: Record<string, unknown> | null,
  prov: Record<string, unknown> | null,
  extraDiagnostics: string[],
): StudyMetadata {
  // v0.8 uses `accession` in metadata.study and `dataset_accession` in
  // metadata.sample_metadata (an inter-block inconsistency); accept both.
  const accession =
    str(study?.accession) ?? str(study?.dataset_accession) ?? str(prov?.dataset_accession);
  const title = str(study?.title);
  if ((study?.dataset_accession || prov?.dataset_accession) && !study?.accession) {
    extraDiagnostics.push('Index uses "dataset_accession"; prefer metadata.study.accession.');
  }
  return {
    ...sm,
    investigation: {
      ...sm.investigation,
      accession: sm.investigation.accession ?? accession,
      title: sm.investigation.title ?? title,
    },
    diagnostics: [...sm.diagnostics, ...extraDiagnostics],
  };
}

/** Last-resort banner from projected keys only (no readable blob). */
function keysOnly(
  study: Record<string, unknown> | null,
  prov: Record<string, unknown> | null,
  member: string | null,
  diagnostics: string[],
): StudyMetadata | null {
  const accession = str(study?.accession) ?? str(study?.dataset_accession);
  const title = str(study?.title);
  if (!accession && !title && !prov) return null;
  const fmt = (str(prov?.format) as StudyMetadata["format"]) ?? "sdrf";
  return {
    format: fmt,
    investigation: { accession, title, description: null, contacts: [], publications: [], protocols: [] },
    rows: [],
    factors: [],
    labeling: { kind: "label-free", reagent: null, plex: null },
    counts: { sourceSamples: 0, channels: 0, dataFiles: 0, rows: 0 },
    biology: { organisms: [], tissues: [], diseases: [], cellTypes: [] },
    provenance: {
      format: fmt,
      sourceUri: str(prov?.source_uri) ?? str(prov?.sdrf_uri),
      embedScope: str(prov?.embed_scope),
      retrievedAt: str(prov?.retrieved_at),
      sha256: str(prov?.sha256),
      hashState: "none",
      member,
    },
    diagnostics: [...diagnostics, "Showing projected index keys only (blob not parsed)."],
  };
}
