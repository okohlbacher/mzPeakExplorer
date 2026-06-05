import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath, URL } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "parquet-wasm": resolve(
        __dirname,
        "vendor/parquet-wasm/parquet_wasm_node.js"
      ),
    },
  },
  test: {
    environment: "node",
  },
});
