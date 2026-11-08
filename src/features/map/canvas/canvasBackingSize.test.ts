import { describe, expect, it } from "vitest";
import {
  getCanvasBackingSize,
  MAX_CANVAS_BACKING_DIMENSION,
  MAX_CANVAS_BACKING_PIXELS,
} from "./canvasBackingSize";

describe("canvas backing allocation", () => {
  it("preserves the native resolution for normal phone and desktop viewports", () => {
    expect(getCanvasBackingSize(430, 932, 3)).toEqual({
      width: 1290,
      height: 2796,
      scale: 3,
    });
    expect(getCanvasBackingSize(1920, 1080, 2)).toEqual({
      width: 3840,
      height: 2160,
      scale: 2,
    });
  });

  it.each([
    [2653, 4025, 3],
    [2653, 2505, 3],
    [30000, 300, 2],
  ])(
    "caps allocation at %s x %s without changing logical coordinates",
    (width, height, dpr) => {
      const result = getCanvasBackingSize(width, height, dpr);
      expect(result.width * result.height).toBeLessThanOrEqual(
        MAX_CANVAS_BACKING_PIXELS,
      );
      expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(
        MAX_CANVAS_BACKING_DIMENSION,
      );
      expect(Math.abs(result.width - width * result.scale)).toBeLessThan(1);
      expect(Math.abs(result.height - height * result.scale)).toBeLessThan(1);
    },
  );

  it("handles a temporarily collapsed viewport", () => {
    expect(getCanvasBackingSize(0, 0, 3)).toEqual({
      width: 0,
      height: 0,
      scale: 3,
    });
  });
});
