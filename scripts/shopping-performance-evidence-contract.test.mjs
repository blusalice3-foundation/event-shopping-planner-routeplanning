import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptedTransferScenarios,
  expectedPerformanceCases,
  expectedPerformanceConditions,
  expectedTransferMetricNames,
  performanceConditionKey,
  performanceGroupSpecs,
  shoppingPerformanceCriteriaDate,
  dndSelectionRenderingPerformanceCriteriaDate,
  shoppingAcceptanceItemCounts,
  shoppingCollectionMetadataForCount,
  shoppingPerformanceTestTag,
  shoppingLargeListDiagnosticTag,
  performanceAcceptanceCriteriaByGroup,
  performanceAcceptanceCriteriaForGroup,
  validateAcceptanceCriteriaMetadata,
  validateRunAcceptanceCriteriaMetadata,
  shoppingPerformanceThresholds,
} from "./shopping-performance-evidence-contract.mjs";
test("fixed performance inventory retains mandatory 150/500 matrices and each expanded category", () => {
  assert.deepEqual(
    ["shopping", "range", "drag", "transfer"].map(
      (group) => expectedPerformanceConditions(group).length,
    ),
    [16, 20, 8, 52],
  );
  const cases = expectedPerformanceCases("transfer");
  assert.equal(cases.length, 100);
  assert.equal(new Set(cases.map((row) => row.key)).size, 100);
  assert.deepEqual(
    performanceGroupSpecs.transfer.map(
      (spec) => cases.filter((row) => row.spec === spec).length,
    ),
    [48, 40, 12],
  );
  for (const scenario of acceptedTransferScenarios) {
    const rows = cases.filter((row) => row.condition.scenario === scenario);
    assert.equal(
      rows.length,
      ["range", "collapsed"].includes(scenario) ? 8 : 4,
    );
    assert.equal(
      rows.filter((row) => row.measurementKind === "response").length,
      rows.filter((row) => row.measurementKind === "frame").length,
    );
  }
});
test("no-save categories have no fabricated pending/save timing and unchanged categories have no fake frame", () => {
  for (const scenario of ["noop", "reject", "cancel"]) {
    const condition = { scenario };
    assert.deepEqual(expectedTransferMetricNames(condition, "response"), [
      "response",
      "nextApplied",
    ]);
  }
  assert.deepEqual(
    expectedTransferMetricNames({ scenario: "same-column" }, "response"),
    ["response", "nextPending", "nextApplied", "save"],
  );
  for (const scenario of ["reject", "cancel"])
    assert.ok(
      expectedPerformanceCases("transfer")
        .filter((row) => row.condition.scenario === scenario)
        .every((row) => row.measurementKind === "response"),
    );
});
test("an omitted single scenario preserves the original condition identity; categories cannot collide", () => {
  const condition = expectedPerformanceConditions("transfer")[0];
  assert.equal(
    performanceConditionKey(condition, "transfer"),
    performanceConditionKey({ ...condition, scenario: "single" }, "transfer"),
  );
  assert.notEqual(
    performanceConditionKey(condition, "transfer"),
    performanceConditionKey({ ...condition, scenario: "multiple" }, "transfer"),
  );
});

test("current acceptance criteria are shared and immutable without changing the sample or p95 limits", () => {
  assert.equal(shoppingPerformanceCriteriaDate, "2026-10-25");
  assert.equal(dndSelectionRenderingPerformanceCriteriaDate, "2026-10-24");
  assert.deepEqual(shoppingPerformanceThresholds, {
    minimumCount: 10,
    medianMs: 65,
    p95Ms: 100,
  });
  assert.ok(Object.isFrozen(shoppingPerformanceThresholds));
});

test("only trusted plan groups select 110ms criteria and retain completion sampling", () => {
  assert.deepEqual(Object.keys(performanceAcceptanceCriteriaByGroup), [
    "shopping",
    "range",
    "drag",
    "transfer",
  ]);
  assert.deepEqual(
    performanceAcceptanceCriteriaForGroup("shopping").acceptanceThresholds,
    shoppingPerformanceThresholds,
  );
  for (const group of ["range", "drag", "transfer"]) {
    const criteria = performanceAcceptanceCriteriaForGroup(group);
    assert.equal(criteria.acceptanceScope, "dnd-selection-rendering");
    assert.equal(
      criteria.acceptanceCriteriaId,
      "dnd-selection-rendering-110-110-2026-10-24",
    );
    assert.equal(criteria.acceptanceCriteriaDate, "2026-10-24");
    assert.deepEqual(criteria.acceptanceThresholds, {
      minimumCount: 10,
      medianMs: 110,
      p95Ms: 110,
    });
    assert.ok(Object.isFrozen(criteria));
    assert.ok(Object.isFrozen(criteria.acceptanceThresholds));
  }
  assert.ok(Object.isFrozen(performanceAcceptanceCriteriaByGroup));
  for (const group of [
    "functional",
    "future",
    "toString",
    "__proto__",
    undefined,
  ])
    assert.throws(
      () => performanceAcceptanceCriteriaForGroup(group),
      /Unknown performance criteria group/,
    );
});
test("criteria metadata rejects forged values, partial scopes, and incomplete or foreign group tables", () => {
  for (const group of Object.keys(performanceAcceptanceCriteriaByGroup)) {
    const correct = performanceAcceptanceCriteriaForGroup(group);
    assert.doesNotThrow(() =>
      validateAcceptanceCriteriaMetadata(correct, group),
    );
    for (const field of Object.keys(correct)) {
      const forged = structuredClone(correct);
      forged[field] =
        field === "acceptanceThresholds"
          ? { minimumCount: 10, medianMs: 999, p95Ms: 999 }
          : "forged";
      assert.throws(
        () => validateAcceptanceCriteriaMetadata(forged, group),
        /metadata/,
      );
    }
  }
  assert.doesNotThrow(() => validateRunAcceptanceCriteriaMetadata({}));
  assert.doesNotThrow(() =>
    validateRunAcceptanceCriteriaMetadata({
      acceptanceCriteriaByGroup: performanceAcceptanceCriteriaByGroup,
    }),
  );
  const missing = structuredClone(performanceAcceptanceCriteriaByGroup);
  delete missing.range;
  for (const table of [
    null,
    missing,
    { ...performanceAcceptanceCriteriaByGroup, future: {} },
  ])
    assert.throws(
      () =>
        validateRunAcceptanceCriteriaMetadata({
          acceptanceCriteriaByGroup: table,
        }),
      /metadata/,
    );
  assert.doesNotThrow(() =>
    validateAcceptanceCriteriaMetadata(
      { acceptanceThresholds: { medianMs: 55 } },
      "range",
      { required: false },
    ),
  );
  assert.throws(
    () =>
      validateAcceptanceCriteriaMetadata(
        { acceptanceScope: "dnd-selection-rendering" },
        "range",
        { required: false },
      ),
    /metadata/,
  );
});

test("2026-10-25 shopping inventory excludes 1500 and keeps all 16 mandatory combinations", () => {
  assert.deepEqual(shoppingAcceptanceItemCounts, [150, 500]);
  assert.ok(Object.isFrozen(shoppingAcceptanceItemCounts));
  const rows = expectedPerformanceConditions("shopping");
  for (const count of shoppingAcceptanceItemCounts)
    assert.equal(rows.filter((row) => row.count === count).length, 8);
  assert.equal(
    rows.some((row) => row.count === 1500),
    false,
  );
  assert.equal(rows.length * 6 * 2, 192);
  assert.equal(
    ["shopping", "range", "drag", "transfer"].reduce(
      (sum, group) => sum + expectedPerformanceCases(group).length,
      0,
    ),
    144,
  );
  const transferMetrics = expectedPerformanceCases("transfer").flatMap((row) =>
    expectedTransferMetricNames(row.condition, row.measurementKind),
  );
  assert.equal(transferMetrics.length, 244);
  assert.equal(
    transferMetrics.filter((metric) => metric !== "save").length,
    198,
  );
  assert.equal(rows.length * 12 + 80 + 60 + 198, 530);
  assert.equal(rows.length * 12 + 80 + 60 + transferMetrics.length, 576);
  const criteria = performanceAcceptanceCriteriaForGroup("shopping");
  assert.equal(
    criteria.acceptanceCriteriaId,
    "shopping-operations-150-500-65-100-2026-10-25",
  );
  assert.equal(criteria.acceptanceCriteriaDate, "2026-10-25");
});

test("optional 1500 records carry exclusion and reference budgets without acceptance identity", () => {
  for (const count of shoppingAcceptanceItemCounts) {
    assert.deepEqual(shoppingCollectionMetadataForCount(count), {
      diagnosticOnly: false,
      acceptanceMeasurement: true,
    });
    assert.equal(shoppingPerformanceTestTag(count), "@shopping-performance");
  }
  const diagnostic = shoppingCollectionMetadataForCount(1500);
  assert.equal(diagnostic.diagnosticOnly, true);
  assert.equal(diagnostic.acceptanceMeasurement, false);
  assert.equal(diagnostic.excludedFromDefaultAcceptance, true);
  assert.equal(diagnostic.collectionScope, "optional-large-list-diagnostic");
  assert.deepEqual(diagnostic.acceptanceExclusion, {
    decisionDate: "2026-10-25",
    reason: "user-excluded-1500-item-workload",
    itemCount: 1500,
    mandatoryItemCounts: [150, 500],
  });
  assert.deepEqual(
    diagnostic.referenceAcceptanceCriteria,
    performanceAcceptanceCriteriaForGroup("shopping"),
  );
  assert.equal(
    shoppingPerformanceTestTag(1500),
    shoppingLargeListDiagnosticTag,
  );
  assert.equal(
    shoppingPerformanceTestTag(1500).includes("@shopping-performance"),
    false,
  );
  assert.ok(Object.isFrozen(diagnostic));
  for (const count of [0, 149, 501, 1490, "150", undefined]) {
    assert.throws(
      () => shoppingCollectionMetadataForCount(count),
      /Unknown shopping item count/,
    );
    assert.throws(
      () => shoppingPerformanceTestTag(count),
      /Unknown shopping item count/,
    );
  }
});

test("sampling profiles change only the requested repetition count and purpose", async () => {
  const {
    performanceSamplingProfile,
    performanceAcceptanceCriteriaByGroupForProfile,
    resolvePerformanceProfile,
    validatePerformanceSamplingMetadata,
    performanceSamplingMetadata,
  } = await import("./shopping-performance-evidence-contract.mjs");
  assert.equal(resolvePerformanceProfile(), "completion");
  for (const [profile, count] of [
    ["pr", 2],
    ["completion", 10],
  ]) {
    const sampling = performanceSamplingProfile(profile);
    assert.equal(sampling.sampleCount, count);
    assert.equal(sampling.completionEligible, profile === "completion");
    assert.equal(sampling.policyDate, "2026-10-26");
    const table = performanceAcceptanceCriteriaByGroupForProfile(profile);
    for (const group of ["shopping", "range", "drag", "transfer"]) {
      assert.equal(table[group].acceptanceThresholds.minimumCount, count);
      assert.equal(
        table[group].acceptanceThresholds.medianMs,
        group === "shopping" ? 65 : 110,
      );
      assert.equal(
        table[group].acceptanceThresholds.p95Ms,
        group === "shopping" ? 100 : 110,
      );
      assert.equal(
        expectedPerformanceCases(group).length,
        { shopping: 16, range: 20, drag: 8, transfer: 100 }[group],
      );
      assert.doesNotThrow(() =>
        validatePerformanceSamplingMetadata(table[group], profile),
      );
    }
    assert.throws(
      () =>
        validatePerformanceSamplingMetadata(
          performanceSamplingMetadata(profile),
          profile === "pr" ? "completion" : "pr",
        ),
      /sampling metadata/,
    );
  }
  for (const unknown of ["", "PR", "fast", null, 2, "__proto__"])
    assert.throws(() => performanceSamplingProfile(unknown), /Unknown/);
  assert.equal(
    resolvePerformanceProfile(undefined, { ESP_PERFORMANCE_PROFILE: "pr" }),
    "pr",
  );
  assert.throws(
    () =>
      resolvePerformanceProfile("pr", {
        ESP_PERFORMANCE_PROFILE: "completion",
      }),
    /conflicts/,
  );
  assert.throws(
    () => resolvePerformanceProfile(undefined, { ESP_PERFORMANCE_PROFILE: "" }),
    /Unknown/,
  );
});
