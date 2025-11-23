import type { Plugin } from "esbuild";
import { cpSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "tsup";

const WASM_SRC_DIR = resolve(process.cwd(), "src/wasm");
const WASM_OUT_DIR = resolve(process.cwd(), "dist/wasm");

const copyWasmAssetsPlugin: Plugin = {
  name: "copy-wasm-assets",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) {
        return;
      }

      rmSync(WASM_OUT_DIR, { recursive: true, force: true });
      cpSync(WASM_SRC_DIR, WASM_OUT_DIR, { recursive: true });
    });
  },
};

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  minify: false,
  outDir: "dist",
  esbuildPlugins: [copyWasmAssetsPlugin],
});

