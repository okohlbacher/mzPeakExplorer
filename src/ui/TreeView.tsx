import { useState } from "react";

/**
 * Recursive collapsible tree for arbitrary plainified metadata (POJOs / arrays /
 * primitives). Objects and arrays are expandable nodes; primitives are leaves.
 * Keys that look like CV accessions (MS:1000511, IMS_1000050_…) get a distinct
 * colour so the parameter structure is legible at a glance.
 */

const CV_RE = /^(MS|IMS|UO|PEFF|BTO|NCIT)[:_]\d{4,}/;

function isPrimitive(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v !== "object";
}

function previewLabel(v: unknown): string {
  if (Array.isArray(v)) return `[${v.length}]`;
  if (v && typeof v === "object") {
    const n = Object.keys(v as object).length;
    return `{${n}}`;
  }
  return "";
}

function Leaf({ label, value }: { label: string; value: unknown }) {
  const isStr = typeof value === "string";
  const cv = CV_RE.test(label);
  return (
    <div className="tree-row">
      <span className="tree-caret" />
      <span className={cv ? "tree-cv" : "tree-key"}>{label}</span>
      <span>:</span>
      <span className={`tree-val${isStr ? " str" : ""}`}>
        {value === null ? "null" : isStr ? `"${value}"` : String(value)}
      </span>
    </div>
  );
}

function Node({
  label,
  value,
  depth,
  defaultOpen,
}: {
  label: string;
  value: unknown;
  depth: number;
  defaultOpen: number;
}) {
  const [open, setOpen] = useState(depth < defaultOpen);

  if (isPrimitive(value)) {
    return <Leaf label={label} value={value} />;
  }

  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);

  const cv = CV_RE.test(label);

  return (
    <div>
      <div
        className="tree-row expandable"
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <span className="tree-caret">{open ? "▾" : "▸"}</span>
        <span className={cv ? "tree-cv" : "tree-key"}>{label}</span>
        <span className="tree-count">{previewLabel(value)}</span>
      </div>
      {open && (
        <div className="tree-node">
          {entries.length === 0 ? (
            <div className="tree-row">
              <span className="tree-caret" />
              <span className="tree-count">(empty)</span>
            </div>
          ) : (
            entries.map(([k, v]) => (
              <Node
                key={k}
                label={k}
                value={v}
                depth={depth + 1}
                defaultOpen={defaultOpen}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function TreeView({
  label,
  value,
  defaultOpen = 1,
}: {
  label: string;
  value: unknown;
  defaultOpen?: number;
}) {
  return (
    <div className="tree">
      <Node label={label} value={value} depth={0} defaultOpen={defaultOpen} />
    </div>
  );
}
