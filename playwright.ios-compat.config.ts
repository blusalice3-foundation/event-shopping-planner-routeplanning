import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// WebKit emulation checks compatibility paths; physical iOS validation is separate.
export default defineConfig({
  ...base,
  testMatch: "ios-compatibility.spec.ts",
  outputDir: "./artifacts/ios-compatibility",
  retries: 0,
  workers: 1,
  projects: [
    { name: "chromium-compat", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-android-compat", use: { ...devices["Pixel 7"] } },
    { name: "webkit-mobile-compat", use: { ...devices["iPhone 14 Pro Max"] } },
  ],
});
