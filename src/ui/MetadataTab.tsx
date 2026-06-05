import { useState } from "react";
import { useStore } from "../state/store";
import { TreeView } from "./TreeView";

/**
 * The hierarchical, collapsible metadata browser. Renders the five file-level
 * groups plus the mzpeak_index.json discovery block, each as an expandable
 * tree. Expand-depth is controlled globally and applied by remounting the trees.
 */
export function MetadataTab() {
  const fileMeta = useStore((s) => s.fileMeta);
  const indexMeta = useStore((s) => s.indexMeta);
  const [openDepth, setOpenDepth] = useState(1);
  // Bump to force the (uncontrolled-open-state) trees to remount on expand/collapse.
  const [nonce, setNonce] = useState(0);

  if (!fileMeta) return null;

  const groups: { label: string; value: unknown }[] = [
    { label: "fileDescription", value: fileMeta.fileDescription },
    { label: "instrumentConfigurations", value: fileMeta.instrumentConfigurations },
    { label: "software", value: fileMeta.software },
    { label: "dataProcessing", value: fileMeta.dataProcessing },
    { label: "run", value: fileMeta.run },
    { label: "samples", value: fileMeta.samples },
  ];
  if (indexMeta && Object.keys(indexMeta as object).length > 0) {
    groups.push({ label: "index.metadata", value: indexMeta });
  }

  const apply = (depth: number) => {
    setOpenDepth(depth);
    setNonce((n) => n + 1);
  };

  return (
    <div>
      <div className="tree-toolbar">
        <button onClick={() => apply(99)}>Expand all</button>
        <button onClick={() => apply(1)}>Collapse</button>
        <span className="hint" style={{ alignSelf: "center" }}>
          Click a node to expand or collapse it.
        </span>
      </div>
      {groups.map((g) => (
        <TreeView
          key={`${g.label}-${nonce}`}
          label={g.label}
          value={g.value}
          defaultOpen={openDepth}
        />
      ))}
    </div>
  );
}
