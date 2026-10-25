import assert from "node:assert/strict";
import test from "node:test";
import {
  isTerminalBaselineObservation,
  resolveBaselineProductObservation,
  terminalBaselineProduct,
  terminalPersistenceObservation,
  terminalWritePostconditions,
} from "../tests/browser/shopping-transfer-terminal-observation.ts";

const baseline = {
  ...terminalBaselineProduct,
  phase: "before",
  sourceCommit: "a".repeat(40),
  sourceState: "clean",
};
const commit = (operationId, at = 1001) => ({
  at,
  stores: ["shoppingProgress"],
  operationId,
  writes: [{ kind: "put", key: "event" }],
});
const options = (overrides = {}) => ({
  observation: baseline,
  scenario: "noop",
  sampleIndex: 1,
  measurementId: "terminal-noop-0",
  targetId: "e0",
  commits: [commit("actual-op-1")],
  ...overrides,
});

test("only a clean pinned before product permits comparison-only noop observation", () => {
  assert.equal(isTerminalBaselineObservation(baseline), true);
  assert.equal(isTerminalBaselineObservation(undefined), false);
});
for (const [field, value] of [
  ["phase", "after"],
  ["phase", "standalone"],
  ["sourceState", "dirty"],
  ["sourceCommit", "invalid"],
  ["referenceProductCommit", "a".repeat(40)],
  ["sourceTree", "b".repeat(40)],
  ["publicTree", "c".repeat(40)],
]) {
  test(`changing ${field} to ${value} disables the noop exception`, () => {
    const observation = { ...baseline, [field]: value };
    assert.equal(isTerminalBaselineObservation(observation), false);
    assert.deepEqual(terminalWritePostconditions(options({ observation })), []);
  });
}
for (const scenario of ["same-column", "reject", "cancel"]) {
  test(`${scenario} cannot use the baseline noop exception`, () => {
    assert.deepEqual(terminalWritePostconditions(options({ scenario })), []);
  });
}
test("a normal zero-write noop has no postcondition failure", () => {
  assert.deepEqual(terminalWritePostconditions(options({ commits: [] })), []);
});
test("a known baseline noop retains ordinal, actual count, and the original response target", () => {
  const errors = terminalWritePostconditions(options());
  assert.deepEqual(errors, [
    {
      measurementId: "terminal-noop-0",
      sampleIndex: 1,
      code: "unexpected-noop-write",
      itemIds: ["e0"],
      message: "Noop expected zero persistence transactions; observed 1",
      expectedWriteCount: 0,
      actualWriteCount: 1,
    },
  ]);
});
test("multiple observed transactions remain actual counts without inventing single-operation attribution", () => {
  const commits = [commit("actual-op-1"), commit("actual-op-2", 1002)];
  const errors = terminalWritePostconditions(options({ commits }));
  assert.equal(errors[0].actualWriteCount, 2);
  assert.equal(errors[0].expectedWriteCount, 0);
  assert.deepEqual(
    commits.map((entry) => entry.operationId),
    ["actual-op-1", "actual-op-2"],
  );
});
test("the artifact aggregates each of twenty original samples once and preserves full transactions", () => {
  const samples = Array.from({ length: 20 }, (_, index) => {
    const commits = [commit(`actual-op-${index}`, 1001 + index)];
    return {
      sampleIndex: index + 1,
      measurementId: `terminal-noop-${index}`,
      physicalWriteCount: commits.length,
      operationId: commits[0].operationId,
      commits,
    };
  });
  const observation = terminalPersistenceObservation(samples);
  assert.equal(observation.writeCount, 20);
  assert.equal(observation.operationId, null);
  assert.equal(observation.samples, samples);
  assert.deepEqual(
    observation.commits,
    samples.flatMap((sample) => sample.commits),
  );
  assert.deepEqual(
    observation.commits.map((entry) => entry.operationId),
    Array.from({ length: 20 }, (_, index) => `actual-op-${index}`),
  );
});
test("artifact counts derive from actual transactions rather than a claimed per-sample count", () => {
  const commits = [commit("actual-op-1"), commit("actual-op-2", 1002)];
  const observation = terminalPersistenceObservation([
    {
      sampleIndex: 1,
      measurementId: "terminal-noop-0",
      physicalWriteCount: 0,
      operationId: null,
      commits,
    },
  ]);
  assert.equal(observation.writeCount, 2);
  assert.deepEqual(observation.commits, commits);
  assert.equal(observation.samples[0].physicalWriteCount, 0);
});

test("after source proof short-circuits before every Git or hash operation", () => {
  let calls = 0;
  for (const phase of ["after", "standalone", "", "other"]) {
    assert.equal(
      resolveBaselineProductObservation({
        phase,
        git() {
          calls++;
          throw new Error("Git must not run for after");
        },
      }),
      undefined,
    );
  }
  assert.equal(calls, 0);
});
test("the before resolver records actual HEAD and pinned clean product trees", () => {
  const calls = [];
  const values = [
    baseline.sourceCommit,
    baseline.sourceTree,
    baseline.publicTree,
    "",
  ];
  const proof = resolveBaselineProductObservation({
    phase: "before",
    git(args) {
      calls.push(args);
      return values.shift();
    },
  });
  assert.deepEqual(proof, baseline);
  assert.deepEqual(calls, [
    ["rev-parse", "HEAD"],
    ["rev-parse", "HEAD:src"],
    ["rev-parse", "HEAD:public"],
    ["status", "--porcelain", "--untracked-files=all", "--", "src", "public"],
  ]);
});
for (const [field, replacement] of [
  [0, "bad-head"],
  [1, "b".repeat(40)],
  [2, "c".repeat(40)],
  [3, " M src/product.ts"],
]) {
  test(`the resolver rejects foreign or dirty before proof field ${field}`, () => {
    const values = [
      baseline.sourceCommit,
      baseline.sourceTree,
      baseline.publicTree,
      "",
    ];
    values[field] = replacement;
    assert.equal(
      resolveBaselineProductObservation({
        phase: "before",
        git() {
          return values.shift();
        },
      }),
      undefined,
    );
  });
}
test("a Git error remains fatal instead of becoming an expected baseline postcondition", () => {
  assert.throws(
    () =>
      resolveBaselineProductObservation({
        phase: "before",
        git() {
          throw new Error("Git unavailable");
        },
      }),
    /Git unavailable/,
  );
});
