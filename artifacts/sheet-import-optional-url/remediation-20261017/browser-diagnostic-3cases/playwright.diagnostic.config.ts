import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import baseline from "../../../../playwright.config";

export default defineConfig({
  ...baseline,
  testDir: fileURLToPath(new URL(".", import.meta.url)),
  testMatch: "sheet-import-optional-url.diagnostic.spec.ts",
  outputDir: fileURLToPath(new URL("./diagnostic-default-output", import.meta.url)),
  workers: 1,
  retries: 0,
  webServer: undefined,
});
