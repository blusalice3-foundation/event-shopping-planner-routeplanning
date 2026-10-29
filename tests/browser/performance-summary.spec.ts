import { expect, test } from "@playwright/test";
import { summarizePerformanceSamples } from "./performance-summary";

test("performance summaries use the two middle samples and nearest-rank p95", () => {
  const samples = Array.from({ length: 20 }, (_, index) => 20 - index);
  expect(summarizePerformanceSamples(samples)).toEqual({
    count: 20,
    medianMs: 10.5,
    p95Ms: 19,
  });
  expect(samples).toEqual(Array.from({ length: 20 }, (_, index) => 20 - index));
  expect(summarizePerformanceSamples([9, 1, 5])).toEqual({
    count: 3,
    medianMs: 5,
    p95Ms: 9,
  });
  expect(summarizePerformanceSamples([7])).toEqual({
    count: 1,
    medianMs: 7,
    p95Ms: 7,
  });
});

test("performance summaries cannot hide an even-sample median above 65 ms", () => {
  const samples = [
    ...Array<number>(10).fill(64),
    ...Array<number>(10).fill(68),
  ];
  expect(summarizePerformanceSamples(samples).medianMs).toBe(66);
  expect(() => summarizePerformanceSamples([])).toThrow(RangeError);
});
