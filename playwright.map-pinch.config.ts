import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// Browser engines and emulated touch paths; physical OS validation is separate.
export default defineConfig({
  ...base,
  testMatch: "map-pinch-camera.spec.ts",
  outputDir: "./artifacts/map-pinch-camera",
  retries: 0,
  workers: 1,
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-android", use: { ...devices["Pixel 7"] } },
    { name: "webkit-mobile", use: { ...devices["iPhone 14 Pro Max"] } },
  ],
});
