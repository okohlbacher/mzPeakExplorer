import { useEffect, useState } from "react";
import {
  ChevronRight,
  Database,
  FileText,
  Folder,
  Table2,
} from "lucide-react";
import { getArchiveListing, getParquetInfo } from "../state/store";
import type { ArchiveEntry, ArchiveListing, ParquetInfo } from "../reader/types";
import { fmtBytes } from "./format";
import { accessionIn, cvTitle, useCvTerms } from "./cvTerms";

/** Horizontal proportion bar (fraction 0..1) used for relative sizes. */
function Bar({ frac, color }: { frac: number; color?: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "100%",
        height: 6,
        background: "var(--surface-panel)",
        borderRadius: "var(--radius-pill)",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          display: "block",
          height: "100%",
          width: `${Math.max(frac * 100, frac > 0 ? 1.5 : 0)}%`,
          background: color ?? "var(--accent)",
          borderRadius: "var(--radius-pill)",
        }}
      />
    </span>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <div className="k">{label}</div>
      <div className="v" style={{ fontSize: "var(--text-stat)" }}>
        {value}
      </div>
    </div>
  );
}

/** Per-column footprint table for an expanded parquet member (lazy-loaded). */
function ParquetDetail({ filename }: { filename: string }) {
  const cv = useCvTerms();
  // undefined = loading, null = unavailable.
  const [info, setInfo] = useState<ParquetInfo | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setInfo(undefined);
    void getParquetInfo(filename).then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, [filename]);

  if (info === undefined) {
    return <p className="stage-hint" style={{ padding: "0.6rem 0 0.6rem 2.1rem" }}>Reading parquet footer…</p>;
  }
  if (info === null) {
    return (
      <p className="stage-hint" style={{ padding: "0.6rem 0 0.6rem 2.1rem" }}>
        Could not read this parquet file's internal structure.
      </p>
    );
  }

  const maxCol = info.columns[0]?.compressedSize ?? 0; // columns are size-desc
  return (
    <div style={{ padding: "0.3rem 0 0.7rem 2.1rem" }}>
      <div
        style={{
          display: "flex",
          gap: "1.2rem",
          flexWrap: "wrap",
          fontSize: "var(--text-sm)",
          color: "var(--text-secondary)",
          marginBottom: "0.5rem",
        }}
      >
        <span><strong>{info.numRows.toLocaleString()}</strong> rows</span>
        <span><strong>{info.numColumns.toLocaleString()}</strong> columns</span>
        <span><strong>{info.numRowGroups.toLocaleString()}</strong> row group{info.numRowGroups === 1 ? "" : "s"}</span>
        <span>{fmtBytes(info.totalCompressed)} compressed · {fmtBytes(info.totalUncompressed)} raw</span>
      </div>
      <table className="data" style={{ maxWidth: 720 }}>
        <thead>
          <tr>
            <th style={{ width: "28%" }}>Column</th>
            <th style={{ width: 110 }}>Type</th>
            <th style={{ width: 120 }}>Compressed</th>
            <th>Share</th>
            <th style={{ width: 90, textAlign: "right" }}>Values</th>
            <th style={{ width: 80 }}>Codec</th>
          </tr>
        </thead>
        <tbody>
          {info.columns.map((c) => (
            <tr key={c.name}>
              <td className="mono" title={cvTitle(cv, accessionIn(c.name))}>{c.name}</td>
              <td className="mono" style={{ color: "var(--text-secondary)" }}>{c.type}</td>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmtBytes(c.compressedSize)}
              </td>
              <td style={{ minWidth: 160 }}>
                <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Bar frac={maxCol > 0 ? c.compressedSize / maxCol : 0} />
                  <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", minWidth: "3ch" }}>
                    {info.totalCompressed > 0
                      ? `${Math.round((c.compressedSize / info.totalCompressed) * 100)}%`
                      : "—"}
                  </span>
                </span>
              </td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {c.numValues.toLocaleString()}
              </td>
              <td className="mono" style={{ color: "var(--text-muted)" }}>{c.compression}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EntryRow({ entry, maxSize }: { entry: ArchiveEntry; maxSize: number }) {
  const [open, setOpen] = useState(false);
  const expandable = entry.isParquet;
  const frac = maxSize > 0 ? entry.uncompressedSize / maxSize : 0;
  const icon = entry.isDirectory ? (
    <Folder size={15} />
  ) : entry.isParquet ? (
    <Table2 size={15} />
  ) : (
    <FileText size={15} />
  );

  return (
    <div style={{ borderBottom: "1px solid var(--border-default)" }}>
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        style={{
          display: "grid",
          gridTemplateColumns: "1.1rem 1.1rem minmax(0,1fr) 120px 6.5rem 6.5rem",
          alignItems: "center",
          gap: "0.6rem",
          width: "100%",
          padding: "0.45rem 0.4rem",
          border: "none",
          background: "transparent",
          textAlign: "left",
          font: "inherit",
          cursor: expandable ? "pointer" : "default",
        }}
      >
        <ChevronRight
          size={14}
          style={{
            color: "var(--text-muted)",
            visibility: expandable ? "visible" : "hidden",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 0.12s",
          }}
        />
        <span style={{ display: "inline-flex", color: "var(--text-muted)" }}>{icon}</span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-data)",
            color: "var(--text-body)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.path}
        </span>
        {entry.isDirectory ? <span /> : <Bar frac={frac} />}
        <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-sm)" }}>
          {entry.isDirectory ? "—" : fmtBytes(entry.uncompressedSize)}
        </span>
        <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
          {entry.isDirectory ? "—" : fmtBytes(entry.compressedSize)}
        </span>
      </button>
      {open && expandable && <ParquetDetail filename={entry.path} />}
    </div>
  );
}

/** The Structure view: navigate the .mzpeak ZIP and inspect parquet internals. */
export function StructureTab() {
  const [listing, setListing] = useState<ArchiveListing | null>(null);
  useEffect(() => {
    setListing(getArchiveListing());
  }, []);

  if (!listing) return <p className="hint">No archive loaded.</p>;
  const files = listing.entries.filter((e) => !e.isDirectory);
  const maxSize = Math.max(1, ...files.map((e) => e.uncompressedSize));
  const ratio =
    listing.totalUncompressed > 0
      ? listing.totalCompressed / listing.totalUncompressed
      : 0;

  return (
    <div>
      <h3 className="section">Archive</h3>
      <div className="summary-grid" style={{ marginBottom: "1rem" }}>
        <StatCell label="Members" value={listing.entries.length.toLocaleString()} />
        <StatCell label="Uncompressed" value={fmtBytes(listing.totalUncompressed)} />
        <StatCell label="Compressed" value={fmtBytes(listing.totalCompressed)} />
        <StatCell
          label="Compression"
          value={ratio > 0 ? `${(ratio * 100).toFixed(0)}% of raw` : "—"}
        />
      </div>

      <h3 className="section" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <Database size={13} /> Entries ({files.length})
      </h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.1rem 1.1rem minmax(0,1fr) 120px 6.5rem 6.5rem",
          alignItems: "center",
          gap: "0.6rem",
          padding: "0 0.4rem 0.35rem",
          fontSize: "var(--text-cap)",
          textTransform: "uppercase",
          letterSpacing: "var(--tracking-caps)",
          color: "var(--text-muted)",
          borderBottom: "1px solid var(--border-default)",
        }}
      >
        <span /> <span /> <span>Name</span> <span>Rel. size</span>
        <span style={{ textAlign: "right" }}>Raw</span>
        <span style={{ textAlign: "right" }}>Stored</span>
      </div>
      <div>
        {files.map((e) => (
          <EntryRow key={e.path} entry={e} maxSize={maxSize} />
        ))}
      </div>
      <p className="hint" style={{ marginTop: "0.7rem" }}>
        Expand a <strong>parquet</strong> file to see its columns, row/row-group
        counts, and each column's share of the stored bytes.
      </p>
    </div>
  );
}
