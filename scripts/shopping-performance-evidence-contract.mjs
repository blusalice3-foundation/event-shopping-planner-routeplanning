// Time budgets and workload conditions are unchanged. Sampling changed on 2026-10-26.
export const shoppingPerformanceCriteriaDate = "2026-10-25";
export const dndSelectionRenderingPerformanceCriteriaDate = "2026-10-24";
export const performanceSamplingPolicyId = "performance-samples-2026-10-26";
const samplingProfiles = Object.freeze({
  pr: Object.freeze({
    id: "pr",
    sampleCount: 2,
    policyDate: "2026-10-26",
    completionEligible: false,
  }),
  completion: Object.freeze({
    id: "completion",
    sampleCount: 10,
    policyDate: "2026-10-26",
    completionEligible: true,
  }),
});
export function performanceSamplingProfile(profile = "completion") {
  if (typeof profile !== "string" || !Object.hasOwn(samplingProfiles, profile))
    throw new Error(`Unknown performance sampling profile: ${String(profile)}`);
  return samplingProfiles[profile];
}
export function resolvePerformanceProfile(profile, env = {}) {
  const entries = Object.entries(env).filter(
    ([name, value]) =>
      name.toUpperCase() === "ESP_PERFORMANCE_PROFILE" && value !== undefined,
  );
  const values = new Set(entries.map(([, value]) => value));
  if (values.size > 1)
    throw new Error(
      "Ambiguous case-insensitive ESP_PERFORMANCE_PROFILE values",
    );
  const environmentProfile = entries[0]?.[1];
  if (profile !== undefined) performanceSamplingProfile(profile);
  if (environmentProfile !== undefined)
    performanceSamplingProfile(environmentProfile);
  if (
    profile !== undefined &&
    environmentProfile !== undefined &&
    profile !== environmentProfile
  )
    throw new Error(
      "Explicit performance profile conflicts with ESP_PERFORMANCE_PROFILE",
    );
  return profile ?? environmentProfile ?? "completion";
}
export function performanceProfileEnvironment(env = {}, profile) {
  const selected = resolvePerformanceProfile(profile, env),
    child = { ...env };
  for (const name of Object.keys(child))
    if (name.toUpperCase() === "ESP_PERFORMANCE_PROFILE") delete child[name];
  child.ESP_PERFORMANCE_PROFILE = selected;
  return child;
}
export function performanceSamplingMetadata(profile = "completion") {
  return {
    samplingPolicyId: performanceSamplingPolicyId,
    samplingProfile: performanceSamplingProfile(profile),
  };
}
export function validatePerformanceSamplingMetadata(
  value,
  profile = "completion",
) {
  const expected = performanceSamplingMetadata(profile);
  if (
    value?.samplingPolicyId !== expected.samplingPolicyId ||
    !value?.samplingProfile ||
    JSON.stringify(Object.keys(value.samplingProfile).sort()) !==
      JSON.stringify(Object.keys(expected.samplingProfile).sort()) ||
    Object.entries(expected.samplingProfile).some(
      ([key, entry]) => value.samplingProfile[key] !== entry,
    )
  )
    throw new Error(
      `Invalid or mixed ${profile} performance sampling metadata`,
    );
}
export const shoppingAcceptanceItemCounts = Object.freeze([150, 500]);
export const shoppingLargeListDiagnosticTag = "@shopping-large-list-diagnostic";
export const shoppingPerformanceThresholds = Object.freeze({
  minimumCount: 10,
  medianMs: 65,
  p95Ms: 100,
});
export const dndSelectionRenderingPerformanceThresholds = Object.freeze({
  minimumCount: 10,
  medianMs: 110,
  p95Ms: 110,
});
const criteriaTables = Object.freeze(
  Object.fromEntries(
    Object.keys(samplingProfiles).map((profile) => {
      const sampling = performanceSamplingMetadata(profile);
      const shopping = Object.freeze({
        acceptanceScope: "shopping-operations",
        acceptanceCriteriaId: "shopping-operations-150-500-65-100-2026-10-25",
        acceptanceCriteriaDate: shoppingPerformanceCriteriaDate,
        acceptanceThresholds: Object.freeze({
          ...shoppingPerformanceThresholds,
          minimumCount: sampling.samplingProfile.sampleCount,
        }),
        ...sampling,
      });
      const dnd = Object.freeze({
        acceptanceScope: "dnd-selection-rendering",
        acceptanceCriteriaId: "dnd-selection-rendering-110-110-2026-10-24",
        acceptanceCriteriaDate: dndSelectionRenderingPerformanceCriteriaDate,
        acceptanceThresholds: Object.freeze({
          ...dndSelectionRenderingPerformanceThresholds,
          minimumCount: sampling.samplingProfile.sampleCount,
        }),
        ...sampling,
      });
      return [
        profile,
        Object.freeze({ shopping, range: dnd, drag: dnd, transfer: dnd }),
      ];
    }),
  ),
);
export function performanceAcceptanceCriteriaByGroupForProfile(
  profile = "completion",
) {
  performanceSamplingProfile(profile);
  return criteriaTables[profile];
}
export const performanceAcceptanceCriteriaByGroup =
  performanceAcceptanceCriteriaByGroupForProfile();
export function performanceAcceptanceCriteriaForGroup(
  group,
  profile = "completion",
) {
  const table = performanceAcceptanceCriteriaByGroupForProfile(profile);
  if (typeof group !== "string" || !Object.hasOwn(table, group))
    throw new Error(`Unknown performance criteria group: ${String(group)}`);
  return table[group];
}
const shoppingAcceptanceCollection = Object.freeze({
  diagnosticOnly: false,
  acceptanceMeasurement: true,
});
export function shoppingCollectionMetadataForCount(
  count,
  profile = "completion",
) {
  performanceSamplingProfile(profile);
  if (shoppingAcceptanceItemCounts.includes(count))
    return shoppingAcceptanceCollection;
  if (count === 1500)
    return Object.freeze({
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
      referenceAcceptanceCriteria: performanceAcceptanceCriteriaForGroup(
        "shopping",
        profile,
      ),
    });
  throw new Error(`Unknown shopping item count: ${String(count)}`);
}
export function shoppingPerformanceTestTag(count) {
  return shoppingCollectionMetadataForCount(count).diagnosticOnly
    ? shoppingLargeListDiagnosticTag
    : "@shopping-performance";
}
// Historical artifacts are retained separately; current evidence must declare its sampling policy.
export function validateAcceptanceCriteriaMetadata(
  value,
  group,
  { required = true, profile = "completion" } = {},
) {
  const expected = performanceAcceptanceCriteriaForGroup(group, profile);
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
  validatePerformanceSamplingMetadata(value, profile);
}
export function validateRunAcceptanceCriteriaMetadata(
  value,
  { profile = "completion", required = false } = {},
) {
  if (required) validatePerformanceSamplingMetadata(value, profile);
  if (value.acceptanceCriteriaByGroup === undefined) {
    if (required) throw new Error("Missing acceptanceCriteriaByGroup metadata");
    return;
  }
  const table = value.acceptanceCriteriaByGroup;
  const expected = performanceAcceptanceCriteriaByGroupForProfile(profile);
  if (
    !table ||
    JSON.stringify(Object.keys(table).sort()) !==
      JSON.stringify(Object.keys(expected).sort())
  )
    throw new Error("Invalid acceptanceCriteriaByGroup metadata");
  for (const group of Object.keys(expected))
    validateAcceptanceCriteriaMetadata(table[group], group, { profile });
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
