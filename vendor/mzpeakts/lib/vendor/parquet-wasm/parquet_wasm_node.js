// Node.js-compatible entry point for parquet-wasm.
// Uses readFileSync + synchronous WebAssembly APIs instead of fetch,
// so it works in Vitest (Node.js) without vite-plugin-wasm.
import { readFileSync } from "fs";
import { fileURLToPath, URL } from "url";
import * as bgModule from "./pkg//parquet_wasm_bg.js";
export * from "./pkg/parquet_wasm_bg.js";

const wasmPath = fileURLToPath(
  new URL("./pkg/parquet_wasm_bg.wasm", import.meta.url)
);
const wasmBytes = readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);

// Collect the imports the WASM module needs — all come from parquet_wasm_bg.js
const importObject = {};
for (const { module, name } of WebAssembly.Module.imports(wasmModule)) {
  if (!importObject[module]) importObject[module] = {};
  if (bgModule[name] !== undefined) {
    importObject[module][name] = bgModule[name];
  }
}

const instance = new WebAssembly.Instance(wasmModule, importObject);
bgModule.__wbg_set_wasm(instance.exports);
if (instance.exports.__wbindgen_start) {
  instance.exports.__wbindgen_start();
}
