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
  performanceAcceptanceCriteriaByGroup,
  performanceAcceptanceCriteriaForGroup,
  validateAcceptanceCriteriaMetadata,
  validateRunAcceptanceCriteriaMetadata,
  shoppingPerformanceThresholds,
} from "./shopping-performance-evidence-contract.mjs";
test("fixed performance inventory retains all original matrices and each expanded category", () => {
  assert.deepEqual(
    ["shopping", "range", "drag", "transfer"].map(
      (group) => expectedPerformanceConditions(group).length,
    ),
    [24, 20, 8, 52],
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
  assert.equal(shoppingPerformanceCriteriaDate, "2026-10-24");
  assert.deepEqual(shoppingPerformanceThresholds, {
    minimumCount: 20,
    medianMs: 65,
    p95Ms: 100,
  });
  assert.ok(Object.isFrozen(shoppingPerformanceThresholds));
});

test("only trusted plan groups select 110ms criteria and retain the 20-sample minimum", () => {
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
    assert.deepEqual(criteria.acceptanceThresholds, {
      minimumCount: 20,
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
          ? { minimumCount: 20, medianMs: 999, p95Ms: 999 }
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
