import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Activity,
  ChartSpline,
  File as FileIcon,
  FolderOpen,
  LayoutDashboard,
  ListTree,
  LoaderCircle,
} from "lucide-react";

import { useStore, type Tab } from "../state/store";
import { AppHeader, Badge, Button, Logo, SideNav, type NavItem } from "./components";
import { IdleLoader } from "./FileLoader";
import { SummaryTab } from "./SummaryTab";
import { MetadataTab } from "./MetadataTab";
import { SpectraTab } from "./SpectraTab";
import { ChromatogramsTab } from "./ChromatogramsTab";

const NAV: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "summary", label: "Summary", icon: <LayoutDashboard size={17} /> },
  { id: "metadata", label: "Metadata", icon: <ListTree size={17} /> },
  { id: "spectra", label: "Spectra", icon: <Activity size={17} /> },
  { id: "chromatograms", label: "Chromatograms", icon: <ChartSpline size={17} /> },
];

/** File mini-inspector pinned to the rail bottom — mirrors mzPeakIV's StatsPanel. */
function MiniInspector() {
  const s = useStore((st) => st.summary);
  if (!s) return null;
  const row = (k: string, v: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", padding: "0.12rem 0" }}>
      <span style={{ color: "var(--text-muted)" }}>{k}</span>
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)", textAlign: "right" }}>{v}</span>
    </div>
  );
  const mz = s.mzRange ? `${s.mzRange[0].toFixed(0)}–${s.mzRange[1].toFixed(0)}` : "—";
  return (
    <div
      style={{
        marginTop: "auto",
        borderTop: "1px solid var(--border-default)",
        padding: "0.6rem 0.7rem",
        fontSize: "var(--text-sm)",
      }}
    >
      <div
        style={{
          fontSize: "var(--text-cap)",
          textTransform: "uppercase",
          letterSpacing: "var(--tracking-caps)",
          color: "var(--text-muted)",
          marginBottom: "0.35rem",
        }}
      >
        File
      </div>
      {row("Spectra", s.numSpectra.toLocaleString())}
      {row("m/z", mz)}
      {row("Layout", s.layout)}
      {row("Imaging", s.isImaging ? "yes" : "no")}
    </div>
  );
}

export function App() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const stage = useStore((s) => s.stage);
  const error = useStore((s) => s.error);
  const fileName = useStore((s) => s.fileName);
  const numSpectra = useStore((s) => s.summary?.numSpectra);
  const openFile = useStore((s) => s.openFile);
  const openUrl = useStore((s) => s.openUrl);

  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const fileInput = useRef<HTMLInputElement>(null);
  function pickFile() {
    fileInput.current?.click();
  }

  const ready = stage === "ready";
  const loading = stage === "loading";

  const navItems: NavItem[] = NAV.map((it) => ({
    ...it,
    disabled: !ready,
    badge: it.id === "spectra" && ready && numSpectra != null ? numSpectra.toLocaleString() : undefined,
  }));

  const fileChip = ready && fileName && (
    <Badge tone="neutral" mono>
      <FileIcon size={13} style={{ marginRight: 2 }} />
      {fileName}
    </Badge>
  );

  const railWide: CSSProperties = {
    width: 220,
    flexShrink: 0,
    borderRight: "1px solid var(--border-default)",
    display: "flex",
    flexDirection: "column",
    background: "var(--surface-page)",
  };
  const railNarrow: CSSProperties = {
    borderBottom: "1px solid var(--border-default)",
    background: "var(--surface-page)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100%", background: "var(--surface-page)" }}>
      <input
        ref={fileInput}
        type="file"
        accept=".mzpeak"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openFile(f);
          e.target.value = "";
        }}
      />

      <AppHeader
        left={<Logo product="mzPeak Explorer" size={narrow ? 24 : 32} />}
        right={
          <>
            {fileChip}
            {ready ? (
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<FolderOpen size={15} />}
                onClick={pickFile}
              >
                Open file
              </Button>
            ) : (
              !loading && (
                <Button
                  variant="primary"
                  size="sm"
                  iconLeft={<FolderOpen size={15} />}
                  onClick={() => void openUrl(`${import.meta.env.BASE_URL}static/small.mzpeak`)}
                >
                  Open demo
                </Button>
              )
            )}
          </>
        }
      />
      <div style={{ height: 2, background: "var(--openms-spectrum)", flexShrink: 0 }} />

      <div style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: narrow ? "column" : "row" }}>
        <aside style={narrow ? railNarrow : railWide}>
          {narrow ? (
            <div style={{ display: "flex", gap: "0.25rem", padding: "0.4rem 0.5rem", overflowX: "auto" }}>
              {navItems.map((it) => {
                const active = tab === it.id && ready;
                return (
                  <button
                    key={it.id}
                    onClick={() => ready && setTab(it.id as Tab)}
                    disabled={it.disabled}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      padding: "0.4rem 0.7rem",
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      background: active ? "var(--accent-soft)" : "transparent",
                      color: active ? "var(--accent-active)" : "var(--text-secondary)",
                      fontWeight: "var(--weight-medium)",
                      fontSize: "var(--text-body)",
                      cursor: ready ? "pointer" : "not-allowed",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {it.icon}
                    {it.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <SideNav items={navItems} activeId={tab} onSelect={(id) => setTab(id as Tab)} />
              {ready && <MiniInspector />}
            </>
          )}
        </aside>

        <main style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", padding: "1.1rem 1.3rem", display: "flex", flexDirection: "column" }}>
          {error && <div className="banner-error" style={{ margin: "0 0 0.75rem" }}>{error}</div>}

          {stage === "idle" && <IdleLoader />}

          {loading && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                color: "var(--text-muted)",
                justifyContent: "center",
                marginTop: "10vh",
                fontSize: "var(--text-body)",
              }}
            >
              <LoaderCircle size={18} className="spin" /> Reading file…
            </div>
          )}

          {ready && tab === "summary" && <SummaryTab />}
          {ready && tab === "metadata" && <MetadataTab />}
          {ready && tab === "spectra" && <SpectraTab />}
          {ready && tab === "chromatograms" && <ChromatogramsTab />}
        </main>
      </div>
    </div>
  );
}
