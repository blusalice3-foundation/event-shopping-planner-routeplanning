import { defineConfig } from "vitest/config";
import { sheetUrlStageProbe } from "./scripts/sheet-url-stage-probe.mjs";

export default defineConfig({
  plugins: [sheetUrlStageProbe()],
  test: {
    environment: "jsdom",
    include: [
      "src/test/sheetImportOptionalUrl.measurement.integration.test.tsx",
    ],
    setupFiles: ["src/test/setup.ts"],
    maxWorkers: 1,
    // One case contains 20 independent samples; retain each sample wait limit.
    testTimeout: 60_000,
  },
});
