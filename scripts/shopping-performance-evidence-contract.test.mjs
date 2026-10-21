import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptedTransferScenarios,
  expectedPerformanceCases,
  expectedPerformanceConditions,
  expectedTransferMetricNames,
  performanceConditionKey,
  performanceGroupSpecs,
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
