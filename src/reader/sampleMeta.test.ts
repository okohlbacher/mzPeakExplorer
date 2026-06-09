import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { readStudyMetadata } from "./sampleMeta";
import type { Reader } from "./open";

const fxBytes = (p: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./__fixtures__/${p}`, import.meta.url))));

/** Minimal fake Reader: an in-memory ZIP with an index metadata map. */
function fakeReader(opts: {
  metadata: Record<string, unknown>;
  members: Record<string, Uint8Array>;
}): Reader {
  const files = Object.keys(opts.members).map((name) => ({ name }));
  return {
    store: {
      fileIndex: { metadata: opts.metadata, files },
      open: async (name: string) => {
        const bytes = opts.members[name];
        if (!bytes) return undefined;
        return { size: bytes.byteLength, bytes: async () => bytes };
      },
    },
  } as unknown as Reader;
}

describe("readStudyMetadata — presence gate (UAT: no info present)", () => {
  it("returns null when the archive carries no study metadata", async () => {
    const r = fakeReader({ metadata: {}, members: { "spectra_data.parquet": new Uint8Array() } });
    expect(await readStudyMetadata(r, "x.mzpeak")).toBeNull();
  });
  it("returns null for an imaging-only metadata block", async () => {
    const r = fakeReader({ metadata: { imaging: { is_imaging: true } }, members: {} });
    expect(await readStudyMetadata(r, "x.mzpeak")).toBeNull();
  });
});

describe("readStudyMetadata — SDRF blob end-to-end", () => {
  const bytes = fxBytes("PXD011799.tmt10.sdrf.tsv");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const member = "sample_metadata/sdrf.tsv";
  const firstFile = "20170424_Lumos_RSLC3_Maurer_Hartl_UW_MFPL_shotgun_TMT1_global_Fr9.raw";

  it("reads, hash-verifies, and parses the embedded SDRF", async () => {
    const r = fakeReader({
      metadata: {
        study: { accession: "PXD011799", title: "B-cell melanoma TMT" },
        sample_metadata: { format: "sdrf", member, sha256: sha, source_uri: "https://x/PXD011799.sdrf.tsv", embed_scope: "applicable_rows" },
      },
      members: { [member]: bytes },
    });
    const sm = await readStudyMetadata(r, firstFile);
    expect(sm).not.toBeNull();
    expect(sm!.format).toBe("sdrf");
    expect(sm!.labeling.kind).toBe("isobaric");
    expect(sm!.counts.channels).toBe(10);
    expect(sm!.provenance.hashState).toBe("verified");
    expect(sm!.investigation.accession).toBe("PXD011799");
    expect(sm!.rows.filter((x) => x.matchesThisFile)).toHaveLength(10);
  });

  it("flags a sha256 mismatch instead of trusting it", async () => {
    const r = fakeReader({
      metadata: { sample_metadata: { format: "sdrf", member, sha256: "deadbeef" } },
      members: { [member]: bytes },
    });
    const sm = await readStudyMetadata(r, firstFile);
    expect(sm!.provenance.hashState).toBe("mismatch");
  });

  it("locates the blob by name scan when no member field is given", async () => {
    const r = fakeReader({
      metadata: { sample_metadata: { format: "sdrf" } },
      members: { [member]: bytes },
    });
    const sm = await readStudyMetadata(r, firstFile);
    expect(sm!.counts.channels).toBe(10);
    expect(sm!.diagnostics.some((d) => /name scan/i.test(d))).toBe(true);
  });
});
