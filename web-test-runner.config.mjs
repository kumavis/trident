import { esbuildPlugin } from "@web/dev-server-esbuild";
import { playwrightLauncher } from "@web/test-runner-playwright";

export default {
  files: ["tests/browser/**/*.test.ts"],
  nodeResolve: true,
  browsers: [
    playwrightLauncher({
      product: "chromium",
      launchOptions: {
        headless: true,
      },
    }),
  ],
  plugins: [
    esbuildPlugin({
      ts: true,
      target: "es2020",
    }),
  ],
  staticDirs: ["wasm"],
};

