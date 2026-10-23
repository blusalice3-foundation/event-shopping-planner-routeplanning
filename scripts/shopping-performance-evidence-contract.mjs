// Current user-specified acceptance criteria. Historical raw evidence is never rewritten.
export const shoppingPerformanceCriteriaDate = "2026-10-24";
export const shoppingPerformanceThresholds = Object.freeze({
  minimumCount: 20,
  medianMs: 65,
  p95Ms: 100,
});

// Fixed test-only inventory. Evidence may never define or shrink its expected collection.
export const performanceGroupSpecs = {
  shopping: ["responsive-performance.spec.ts"],
  range: ["edit-execute-range-selection.spec.ts"],
  drag: ["shopping-cross-column-drag.spec.ts"],
  transfer: [
    "shopping-transfer-rendering.performance.spec.ts",
    "shopping-transfer-accepted.performance.spec.ts",
    "shopping-transfer-terminal.performance.spec.ts",
  ],
};
export const performanceAttachmentNames = {
  shopping: "shopping-operation-timings",
  range: "edit-execute-range-selection-timings",
  drag: "shopping-drag-response",
  transfer: "shopping-transfer-rendering",
};
export const acceptedTransferScenarios = [
  "multiple",
  "range",
  "same-visit-merge",
  "multiple-merge",
  "mixed",
  "offscreen",
  "collapsed",
  "auto-scroll",
];
export function expectedPerformanceConditions(group) {
  const rows = [];
  if (group === "shopping")
    for (const count of [150, 500, 1500])
      for (const concentrated of [false, true])
        for (const mapVisible of [false, true])
          for (const layout of ["pc", "smartphone"])
            rows.push({ count, concentrated, mapVisible, layout });
  if (group === "range")
    for (const renderer of ["auto", "full", "virtual"])
      for (const count of [150, 500])
        for (const layout of renderer === "virtual"
          ? ["smartphone"]
          : ["pc", "smartphone"])
          for (const rangeLength of ["short", "long"])
            rows.push({ count, layout, renderer, rangeLength });
  if (group === "drag")
    for (const count of [150, 500])
      for (const input of ["native", "touch"])
        for (const grouped of [false, true])
          rows.push({ count, input, grouped });
  if (group === "transfer") {
    for (const load of ["light", "practical"])
      for (const count of load === "light" ? [150, 500] : [500])
        for (const input of ["native", "touch"])
          for (const grouped of [false, true])
            for (const direction of [
              "candidate-to-execute",
              "execute-to-candidate",
            ])
              rows.push({ count, input, grouped, load, direction });
    for (const scenario of acceptedTransferScenarios)
      for (const input of ["range", "collapsed"].includes(scenario)
        ? ["native", "touch"]
        : ["native"])
        for (const direction of [
          "candidate-to-execute",
          "execute-to-candidate",
        ])
          rows.push({
            count: 500,
            input,
            grouped: true,
            load: "light",
            direction,
            scenario,
          });
    for (const scenario of ["noop", "reject", "cancel", "same-column"])
      for (const input of ["native", "touch"])
        rows.push({
          count: 500,
          input,
          grouped: false,
          load: "light",
          direction:
            scenario === "reject"
              ? "candidate-to-execute"
              : "execute-to-execute",
          scenario,
        });
  }
  if (!rows.length) throw new Error(`Unknown performance group: ${group}`);
  return rows;
}
export function performanceConditionKey(condition, group) {
  const base = Object.keys(expectedPerformanceConditions(group)[0]).map(
    (key) => [key, condition?.[key]],
  );
  if (
    group === "transfer" &&
    condition?.scenario &&
    condition.scenario !== "single"
  )
    base.push(["scenario", condition.scenario]);
  return JSON.stringify(base);
}
export function expectedPerformanceCases(group) {
  return expectedPerformanceConditions(group).flatMap((condition) => {
    const kinds =
      group !== "transfer" || ["reject", "cancel"].includes(condition.scenario)
        ? ["response"]
        : ["response", "frame"];
    const spec =
      group !== "transfer"
        ? performanceGroupSpecs[group][0]
        : !condition.scenario || condition.scenario === "single"
          ? performanceGroupSpecs.transfer[0]
          : acceptedTransferScenarios.includes(condition.scenario)
            ? performanceGroupSpecs.transfer[1]
            : performanceGroupSpecs.transfer[2];
    return kinds.map((measurementKind) => ({
      condition,
      measurementKind,
      spec,
      key: `${measurementKind}:${performanceConditionKey(condition, group)}`,
    }));
  });
}
export function expectedTransferMetricNames(condition, kind) {
  if (kind === "frame") return ["frame"];
  return ["noop", "reject", "cancel"].includes(condition.scenario)
    ? ["response", "nextApplied"]
    : ["response", "nextPending", "nextApplied", "save"];
}
