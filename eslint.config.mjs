import js from "@eslint/js";
import tseslint from "typescript-eslint";

const projectFiles = [
  "src/**/*.ts",
  "src/**/*.tsx",
  "src/**/*.mts",
  "src/**/*.cts",
  "tests/**/*.ts",
  "tests/**/*.tsx",
  "tests/**/*.mts",
  "tests/**/*.cts",
];

const applyProjectSettings = (configs) =>
  configs.map((config) => ({
    ...config,
    files: projectFiles,
    languageOptions: {
      ...config.languageOptions,
      parser: tseslint.parser,
      parserOptions: {
        ...(config.languageOptions?.parserOptions ?? {}),
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
        sourceType: "module",
      },
    },
  }));

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "eslint.config.mjs", "tsup.config.ts", "wasm/**"],
  },
  js.configs.recommended,
  ...applyProjectSettings(tseslint.configs.recommended),
  ...applyProjectSettings(tseslint.configs.recommendedTypeChecked),
  {
    files: projectFiles,
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "no-console": "off",
      "@typescript-eslint/await-thenable": "error",
    },
  }
);

