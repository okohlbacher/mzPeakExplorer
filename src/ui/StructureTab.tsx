import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronRight,
  Database,
  FileText,
  Folder,
  Table2,
} from "lucide-react";
import { Button } from "./components";
import {
  getArchiveListing,
  getDeepColumn,
  getParquetInfo,
  sampleColumn,
} from "../state/store";
import type {
  ArchiveEntry,
  ArchiveListing,
  DeepColumn,
  ParquetColumn,
  ParquetInfo,
} from "../reader/types";
import { fmtBytes } from "./format";
import { accessionIn, cvTitle, useCvTerms, type CvMap } from "./cvTerms";

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
      <table className="data" style={{ maxWidth: 760 }}>
        <thead>
          <tr>
            <th style={{ width: 18 }} />
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
            <ColumnRow
              key={c.name}
              filename={filename}
              col={c}
              maxCol={maxCol}
              totalCompressed={info.totalCompressed}
              cv={cv}
            />
          ))}
        </tbody>
      </table>
      <p className="stage-hint" style={{ marginTop: "0.5rem" }}>
        Click a column for encodings, page stats, min/max, nulls and a sampled
        value distribution.
      </p>
    </div>
  );
}

/** One column row in the parquet table; clicking it reveals the deep panel. */
function ColumnRow({
  filename,
  col,
  maxCol,
  totalCompressed,
  cv,
}: {
  filename: string;
  col: ParquetColumn;
  maxCol: number;
  totalCompressed: number;
  cv: CvMap | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        onClick={() => setOpen((o) => !o)}
        style={{ cursor: "pointer" }}
        className={open ? "col-open" : undefined}
      >
        <td style={{ color: "var(--text-muted)", textAlign: "center" }}>{open ? "▾" : "▸"}</td>
        <td className="mono" title={cvTitle(cv, accessionIn(col.name))}>{col.name}</td>
        <td className="mono" style={{ color: "var(--text-secondary)" }}>{col.type}</td>
        <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtBytes(col.compressedSize)}</td>
        <td style={{ minWidth: 160 }}>
          <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Bar frac={maxCol > 0 ? col.compressedSize / maxCol : 0} />
            <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", minWidth: "3ch" }}>
              {totalCompressed > 0 ? `${Math.round((col.compressedSize / totalCompressed) * 100)}%` : "—"}
            </span>
          </span>
        </td>
        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {col.numValues.toLocaleString()}
        </td>
        <td className="mono" style={{ color: "var(--text-muted)" }}>{col.compression}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} style={{ padding: 0, borderBottom: "1px solid var(--border-default)" }}>
            <DeepColumnPanel filename={filename} path={col.name} />
          </td>
        </tr>
      )}
    </>
  );
}

function Stat({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div>
      <div
        style={{
          fontSize: "var(--text-cap)",
          textTransform: "uppercase",
          letterSpacing: "var(--tracking-caps)",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
          fontSize: "var(--text-sm)",
          color: "var(--text-body)",
          wordBreak: "break-word",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** Deep per-column detail (footer-derived) + an on-demand value histogram. */
function DeepColumnPanel({ filename, path }: { filename: string; path: string }) {
  const [d, setD] = useState<DeepColumn | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setD(undefined);
    void getDeepColumn(filename, path).then((x) => alive && setD(x));
    return () => {
      alive = false;
    };
  }, [filename, path]);

  if (d === undefined) return <p className="stage-hint" style={{ padding: "0.6rem 0.7rem" }}>Reading column footer…</p>;
  if (d === null) return <p className="stage-hint" style={{ padding: "0.6rem 0.7rem" }}>No deep detail available for this column.</p>;

  const fmtNum = (n: number | null) => (n == null ? "—" : n.toLocaleString());
  return (
    <div style={{ padding: "0.7rem 0.9rem", background: "var(--surface-panel)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: "0.6rem 1.1rem",
          marginBottom: "0.6rem",
        }}
      >
        <Stat label="Physical type" value={d.physicalType} mono />
        <Stat label="Encodings" value={d.encodings.join(", ") || "—"} mono />
        <Stat
          label="Dictionary"
          value={d.dictionary ? `yes (${d.dictionaryPages} page${d.dictionaryPages === 1 ? "" : "s"})` : "no"}
        />
        <Stat label="Data pages" value={fmtNum(d.dataPages)} />
        <Stat label="Min" value={d.min ?? "—"} mono />
        <Stat label="Max" value={d.max ?? "—"} mono />
        <Stat label="Nulls" value={d.nullCount == null ? "—" : `${fmtNum(d.nullCount)} (${pct(d.nullCount, d.numValues)})`} />
        <Stat label="Distinct" value={fmtNum(d.distinctCount)} />
        <Stat label="Row groups" value={fmtNum(d.rowGroups)} />
      </div>
      {d.scalar ? (
        <Histogram filename={filename} path={path} truncated={d.numValues > HIST_SAMPLE} />
      ) : (
        <p className="stage-hint">Repeated (list) column — value distribution not sampled.</p>
      )}
    </div>
  );
}

function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  const p = (100 * part) / whole;
  return p > 0 && p < 0.1 ? "<0.1%" : `${p.toFixed(p < 10 ? 1 : 0)}%`;
}

const HIST_SAMPLE = 50000;
const HIST_BINS = 24;

/** Lazy, bounded numeric value histogram for a scalar column. */
function Histogram({
  filename,
  path,
  truncated,
}: {
  filename: string;
  path: string;
  truncated: boolean;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "na">("idle");
  const [bins, setBins] = useState<number[]>([]);
  const [info, setInfo] = useState<{ n: number; min: number; max: number } | null>(null);

  async function run() {
    setState("loading");
    const vals = await sampleColumn(filename, path, HIST_SAMPLE);
    if (!vals || vals.length === 0) {
      setState("na");
      return;
    }
    let min = vals[0];
    let max = vals[0];
    for (const v of vals) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const counts = new Array(HIST_BINS).fill(0);
    const span = max - min;
    for (const v of vals) {
      let i = span > 0 ? Math.floor(((v - min) / span) * HIST_BINS) : 0;
      if (i >= HIST_BINS) i = HIST_BINS - 1;
      if (i < 0) i = 0;
      counts[i]++;
    }
    setBins(counts);
    setInfo({ n: vals.length, min, max });
    setState("done");
  }

  if (state === "idle") {
    return (
      <Button size="sm" onClick={run}>
        Sample value distribution
      </Button>
    );
  }
  if (state === "loading") return <p className="stage-hint">Sampling values…</p>;
  if (state === "na" || !info) {
    return <p className="stage-hint">Distribution unavailable (non-numeric column).</p>;
  }

  const peak = Math.max(...bins, 1);
  const fmt = (v: number) => (Number.isInteger(v) ? v.toLocaleString() : v.toPrecision(5));
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 2,
          height: 70,
          padding: "0.2rem 0",
        }}
      >
        {bins.map((n, i) => (
          <div
            key={i}
            title={`${n.toLocaleString()} values`}
            style={{
              flex: 1,
              height: `${(n / peak) * 100}%`,
              minHeight: n > 0 ? 2 : 0,
              background: "var(--accent)",
              borderRadius: "1px 1px 0 0",
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "var(--text-xs)",
          color: "var(--text-muted)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>{fmt(info.min)}</span>
        <span>
          {info.n.toLocaleString()} values{truncated ? " · first 50k rows" : ""}
        </span>
        <span>{fmt(info.max)}</span>
      </div>
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
