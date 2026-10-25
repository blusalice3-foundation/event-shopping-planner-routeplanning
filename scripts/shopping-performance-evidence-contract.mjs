// Current user-specified acceptance criteria. Historical raw evidence is never rewritten.
export const shoppingPerformanceCriteriaDate = "2026-10-25";
export const dndSelectionRenderingPerformanceCriteriaDate = "2026-10-24";
export const shoppingAcceptanceItemCounts = Object.freeze([150, 500]);
export const shoppingLargeListDiagnosticTag = "@shopping-large-list-diagnostic";
export const shoppingPerformanceThresholds = Object.freeze({
  minimumCount: 20,
  medianMs: 65,
  p95Ms: 100,
});

/**
 * 2026-10-24 ユーザー指定: D&D・選択・描画改善プランに限る例外。
 * range / drag / transfer（D&D・範囲選択・描画・移動後の次操作）は
 * 中央値・95%点とも110ms以下。通常のshoppingは上記65ms / 100msを維持する。
 * 各20サンプル以上。保存完了（save）は別の補助指標として扱う。
 * 計測終了点・条件、過去の実測値・当初合否を維持し、再判定は別に記録する。
 * 詳細: docs/dnd-selection-rendering-performance-criteria-20261024.md / AGENTS.md。
 */
export const dndSelectionRenderingPerformanceThresholds = Object.freeze({
  minimumCount: 20,
  medianMs: 110,
  p95Ms: 110,
});
const shoppingCriteria = Object.freeze({
  acceptanceScope: "shopping-operations",
  acceptanceCriteriaId: "shopping-operations-150-500-65-100-2026-10-25",
  acceptanceCriteriaDate: shoppingPerformanceCriteriaDate,
  acceptanceThresholds: shoppingPerformanceThresholds,
});
const dndCriteria = Object.freeze({
  acceptanceScope: "dnd-selection-rendering",
  acceptanceCriteriaId: "dnd-selection-rendering-110-110-2026-10-24",
  acceptanceCriteriaDate: dndSelectionRenderingPerformanceCriteriaDate,
  acceptanceThresholds: dndSelectionRenderingPerformanceThresholds,
});
const shoppingAcceptanceCollection = Object.freeze({
  diagnosticOnly: false,
  acceptanceMeasurement: true,
});
const shoppingLargeListDiagnosticCollection = Object.freeze({
  diagnosticOnly: true,
  acceptanceMeasurement: false,
  collectionScope: "optional-large-list-diagnostic",
  excludedFromDefaultAcceptance: true,
  acceptanceExclusion: Object.freeze({
    decisionDate: shoppingPerformanceCriteriaDate,
    reason: "user-excluded-1500-item-workload",
    itemCount: 1500,
    mandatoryItemCounts: shoppingAcceptanceItemCounts,
  }),
  referenceAcceptanceCriteria: shoppingCriteria,
});
export function shoppingCollectionMetadataForCount(count) {
  if (shoppingAcceptanceItemCounts.includes(count))
    return shoppingAcceptanceCollection;
  if (count === 1500) return shoppingLargeListDiagnosticCollection;
  throw new Error(`Unknown shopping item count: ${String(count)}`);
}
export function shoppingPerformanceTestTag(count) {
  return shoppingCollectionMetadataForCount(count).diagnosticOnly
    ? shoppingLargeListDiagnosticTag
    : "@shopping-performance";
}
export const performanceAcceptanceCriteriaByGroup = Object.freeze({
  shopping: shoppingCriteria,
  range: dndCriteria,
  drag: dndCriteria,
  transfer: dndCriteria,
});
export function performanceAcceptanceCriteriaForGroup(group) {
  if (
    typeof group !== "string" ||
    !Object.hasOwn(performanceAcceptanceCriteriaByGroup, group)
  )
    throw new Error(`Unknown performance criteria group: ${String(group)}`);
  return performanceAcceptanceCriteriaByGroup[group];
}
// Historical evidence without scoped metadata remains readable, but never chooses its own budget.
export function validateAcceptanceCriteriaMetadata(
  value,
  group,
  { required = true } = {},
) {
  const expected = performanceAcceptanceCriteriaForGroup(group);
  if (
    !required &&
    value?.acceptanceScope === undefined &&
    value?.acceptanceCriteriaId === undefined
  )
    return;
  for (const field of [
    "acceptanceScope",
    "acceptanceCriteriaId",
    "acceptanceCriteriaDate",
  ])
    if (value?.[field] !== expected[field])
      throw new Error(`${group}: invalid ${field} metadata`);
  const thresholds = value?.acceptanceThresholds;
  if (
    !thresholds ||
    JSON.stringify(Object.keys(thresholds).sort()) !==
      JSON.stringify(Object.keys(expected.acceptanceThresholds).sort()) ||
    Object.entries(expected.acceptanceThresholds).some(
      ([key, number]) => thresholds[key] !== number,
    )
  )
    throw new Error(`${group}: invalid acceptanceThresholds metadata`);
}
export function validateRunAcceptanceCriteriaMetadata(value) {
  if (value.acceptanceCriteriaByGroup === undefined) return;
  const table = value.acceptanceCriteriaByGroup;
  if (
    !table ||
    JSON.stringify(Object.keys(table).sort()) !==
      JSON.stringify(Object.keys(performanceAcceptanceCriteriaByGroup).sort())
  )
    throw new Error("Invalid acceptanceCriteriaByGroup metadata");
  for (const group of Object.keys(performanceAcceptanceCriteriaByGroup))
    validateAcceptanceCriteriaMetadata(table[group], group);
}

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
    for (const count of shoppingAcceptanceItemCounts)
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
