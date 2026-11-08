// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAppleTouchWebKit } from "./appleTouchWebKit";

describe("isAppleTouchWebKit", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    [
      "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Safari/604.1",
      "iPhone",
      5,
      true,
    ],
    ["Mozilla/5.0 (iPad) AppleWebKit/605.1.15 CriOS/100", "iPad", 5, true],
    [
      "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15",
      "MacIntel",
      5,
      true,
    ],
    [
      "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15",
      "MacIntel",
      0,
      false,
    ],
    ["Mozilla/5.0 (Android) AppleWebKit/537.36 Chrome/145", "Linux", 5, false],
    ["Mozilla/5.0 (Windows) AppleWebKit/537.36 Chrome/145", "Win32", 0, false],
  ])(
    "detects %s with %s / %i",
    (userAgent, platform, maxTouchPoints, expected) => {
      vi.stubGlobal("navigator", { userAgent, platform, maxTouchPoints });
      expect(isAppleTouchWebKit()).toBe(expected);
    },
  );
});
