import { useRef, useState } from "react";
import { useStore } from "../state/store";

const DEFAULT_DEMO_URL = `${import.meta.env.BASE_URL}static/small.mzpeak`;

export function FileLoader() {
  const openFile = useStore((s) => s.openFile);
  const openUrl = useStore((s) => s.openUrl);
  const loading = useStore((s) => s.stage === "loading");

  const [url, setUrl] = useState(DEFAULT_DEMO_URL);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function handle(file: File) {
    if (!file.name.endsWith(".mzpeak")) {
      alert("Please select a .mzpeak file.");
      return;
    }
    void openFile(file);
  }

  return (
    <div className="loader">
      <div
        className={`drop-zone${over ? " over" : ""}`}
        role="button"
        tabIndex={loading ? -1 : 0}
        onClick={() => !loading && fileInput.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !loading)
            fileInput.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) handle(f);
        }}
      >
        Drop a <strong>.mzpeak</strong> file, or <u>browse</u>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".mzpeak"
        style={{ display: "none" }}
        disabled={loading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handle(f);
          e.target.value = "";
        }}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) void openUrl(url.trim());
        }}
      >
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/file.mzpeak"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !url.trim()}>
          {loading ? "Loading…" : "Load URL"}
        </button>
      </form>
    </div>
  );
}
