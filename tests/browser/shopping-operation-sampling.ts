/** Decide every measured input before execution; fixed fixture preparation stays explicit. */
export function shoppingOperationSamplingPlan(
  sampleCount: number,
  concentrated: boolean,
) {
  if (![2, 10].includes(sampleCount))
    throw new Error("Unsupported shopping sample count");
  if (typeof concentrated !== "boolean")
    throw new Error("Invalid shopping concentration condition");
  const ordinaryFocusSamples = sampleCount - (concentrated ? 1 : 2);
  return {
    sampleCount,
    purpose: sampleCount === 2 ? "pr-feedback-only" : "completion",
    execute: Array.from({ length: 20 }, (_, index) => ({
      targetId: `perf-${index}`,
      measured: index < sampleCount,
    })),
    focus: Array.from({ length: 20 }, (_, offset) => ({
      targetId: `perf-${offset + 20}`,
      measured: offset < ordinaryFocusSamples,
      nextMeasured: !concentrated && offset === 0,
      nextContext: "after-focus-purchase" as const,
    })),
    extraFocusPurchase: concentrated
      ? null
      : { targetId: "perf-40", measured: true },
    focusSoldOut: {
      targetId: concentrated ? "perf-39" : "perf-40",
      measured: true,
    },
    recordAnswers: Array.from(
      { length: sampleCount },
      (_, index) => 1 + (index % 2),
    ),
    postRecordNext: { measured: true, context: "after-record" as const },
    returnCycles: Array.from({ length: sampleCount }, (_, index) => ({
      backMeasured: true,
      nextMeasured: index < sampleCount - (concentrated ? 1 : 2),
      nextContext: "return-after-back" as const,
      nextReason:
        !concentrated && sampleCount === 2
          ? "PR covers purchase and record contexts; return-next is functional acknowledgement only and cannot support completion"
          : "Preserve the original return-next sequence with its preselected measurement role",
    })),
    setupPolicy:
      "Original fixed-ID actions preserve the fixture state and order; unmeasured setup never starts a response clock.",
  };
}
