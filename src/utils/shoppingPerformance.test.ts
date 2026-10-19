import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  measureShoppingOperation,
  shoppingPerformance,
} from "./shoppingPerformance";

describe("shopping performance diagnostic statistics", () => {
  beforeEach(() => {
    shoppingPerformance.reset();
    shoppingPerformance.enable();
  });
  afterEach(() => {
    shoppingPerformance.enable(false);
    shoppingPerformance.reset();
    vi.restoreAllMocks();
  });

  it.each([
    {
      durations: Array.from({ length: 20 }, (_, index) => 20 - index),
      medianMs: 10.5,
      p95Ms: 19,
    },
    { durations: [9, 1, 5], medianMs: 5, p95Ms: 9 },
    { durations: [7], medianMs: 7, p95Ms: 7 },
    {
      durations: [...Array<number>(10).fill(54), ...Array<number>(10).fill(58)],
      medianMs: 56,
      p95Ms: 58,
    },
  ])(
    "summarizes $durations with median $medianMs",
    ({ durations, medianMs, p95Ms }) => {
      const now = vi.spyOn(performance, "now");
      for (const duration of durations) {
        now.mockReturnValueOnce(0).mockReturnValueOnce(duration);
        measureShoppingOperation("quantity", "save")();
      }
      const result = shoppingPerformance.read();
      expect(result.summary["quantity:save"]).toEqual({
        count: durations.length,
        medianMs,
        p95Ms,
      });
      expect(result.samples.map((sample) => sample.durationMs)).toEqual(
        durations,
      );
    },
  );
});
