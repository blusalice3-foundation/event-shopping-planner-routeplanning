export function summarizePerformanceSamples(values: readonly number[]) {
  if (values.length === 0)
    throw new RangeError("Performance summaries require at least one sample");
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    medianMs:
      (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.floor(sorted.length / 2)]) /
      2,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}
