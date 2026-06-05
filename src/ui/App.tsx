import { useStore, type Tab } from "../state/store";
import { FileLoader } from "./FileLoader";
import { SummaryTab } from "./SummaryTab";
import { MetadataTab } from "./MetadataTab";
import { BrowseTab } from "./BrowseTab";

const TABS: { id: Tab; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "metadata", label: "Metadata" },
  { id: "browse", label: "Browse" },
];

export function App() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const stage = useStore((s) => s.stage);
  const error = useStore((s) => s.error);

  const ready = stage === "ready";

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          mzPeak Explorer
          <span className="sub">lightweight, client-side mzPeak inspection</span>
        </h1>
        <FileLoader />
      </header>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
            disabled={!ready}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && <div className="banner-error">{error}</div>}

      <div className="tab-body">
        {stage === "idle" && (
          <p className="empty">
            Open a <strong>.mzpeak</strong> file to explore its contents — drop a
            file above, browse for one, or load the bundled demo URL.
          </p>
        )}
        {stage === "loading" && <p className="empty">Reading file…</p>}
        {ready && tab === "summary" && <SummaryTab />}
        {ready && tab === "metadata" && <MetadataTab />}
        {ready && tab === "browse" && <BrowseTab />}
      </div>
    </div>
  );
}
