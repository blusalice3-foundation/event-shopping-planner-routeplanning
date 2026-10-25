import assert from "node:assert/strict";
import test from "node:test";
import { shoppingOperationSamplingPlan } from "../tests/browser/shopping-operation-sampling.ts";
for (const count of [2, 10])
  for (const concentrated of [false, true]) {
    test(`${count} samples retain every original shopping subcondition: concentrated=${concentrated}`, () => {
      const plan = shoppingOperationSamplingPlan(count, concentrated);
      assert.deepEqual(
        plan.execute.map((entry) => entry.targetId),
        Array.from({ length: 20 }, (_, index) => `perf-${index}`),
      );
      assert.deepEqual(
        plan.focus.map((entry) => entry.targetId),
        Array.from({ length: 20 }, (_, index) => `perf-${index + 20}`),
      );
      const counts = {
        execute: plan.execute.filter((entry) => entry.measured).length,
        executeRecord: plan.recordAnswers.length,
        focus:
          plan.focus.filter((entry) => entry.measured).length +
          Number(!!plan.extraFocusPurchase?.measured) +
          Number(plan.focusSoldOut.measured),
        record: plan.recordAnswers.length,
        next:
          plan.focus.filter((entry) => entry.nextMeasured).length +
          Number(plan.postRecordNext.measured) +
          plan.returnCycles.filter((entry) => entry.nextMeasured).length,
        back: plan.returnCycles.filter((entry) => entry.backMeasured).length,
      };
      assert.deepEqual(
        counts,
        Object.fromEntries(
          Object.keys(counts).map((operation) => [operation, count]),
        ),
      );
      assert.equal(
        plan.focusSoldOut.targetId,
        concentrated ? "perf-39" : "perf-40",
      );
      assert.equal(
        plan.extraFocusPurchase?.targetId,
        concentrated ? undefined : "perf-40",
      );
      assert.equal(
        plan.recordAnswers.at(-1),
        2,
        "Final recorded answer matches the original even-count run",
      );
      assert.deepEqual([...new Set(plan.recordAnswers)], [1, 2]);
      assert.ok(plan.returnCycles.every((entry) => entry.backMeasured));
      assert.equal(plan.returnCycles.at(-1).nextMeasured, false);
      assert.ok(plan.execute.slice(count).every((entry) => !entry.measured));
      assert.equal(
        plan.execute.at(-1).targetId,
        "perf-19",
        "Original execution record target is prepared",
      );
      assert.match(plan.setupPolicy, /never starts a response clock/);
      const contexts = {
        purchase: plan.focus.filter((entry) => entry.nextMeasured).length,
        record: Number(plan.postRecordNext.measured),
        return: plan.returnCycles.filter((entry) => entry.nextMeasured).length,
      };
      assert.deepEqual(
        contexts,
        concentrated
          ? { purchase: 0, record: 1, return: count - 1 }
          : { purchase: 1, record: 1, return: count - 2 },
      );
      if (!concentrated && count === 10)
        assert.ok(Object.values(contexts).every((value) => value >= 1));
      assert.equal(
        plan.purpose,
        count === 2 ? "pr-feedback-only" : "completion",
      );
      assert.ok(
        plan.focus.every(
          (entry) => entry.nextContext === "after-focus-purchase",
        ),
      );
      assert.equal(plan.postRecordNext.context, "after-record");
      assert.ok(
        plan.returnCycles.every(
          (entry) => entry.nextContext === "return-after-back",
        ),
      );
      if (!concentrated && count === 2) {
        assert.ok(plan.returnCycles.every((entry) => !entry.nextMeasured));
        assert.ok(
          plan.returnCycles.every((entry) =>
            /cannot support completion/.test(entry.nextReason),
          ),
        );
      }
      if (!concentrated && count === 2) {
        assert.equal(plan.focus.filter((entry) => entry.measured).length, 0);
        assert.equal(plan.extraFocusPurchase.measured, true);
        assert.equal(plan.focusSoldOut.measured, true);
      }
    });
  }
for (const count of [0, 1, 3, 9, 11, 20, NaN, Infinity, "2", undefined])
  test(`unsupported shopping sample count is rejected before input: ${String(count)}`, () =>
    assert.throws(
      () => shoppingOperationSamplingPlan(count, false),
      /Unsupported shopping sample count/,
    ));
for (const value of [undefined, null, "pr", "false", 0, 1])
  test(`invalid concentration condition is rejected before fixture input: ${String(value)}`, () =>
    assert.throws(
      () => shoppingOperationSamplingPlan(2, value),
      /Invalid shopping concentration condition/,
    ));
