import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginShoppingMoveLifecycle,
  endShoppingMoveLifecycle,
  recordAcceptedShoppingMove,
  recordShoppingMovePlanReady,
  recordShoppingMoveUiApply,
  measureShoppingOperation,
  shoppingPerformance,
} from "./shoppingPerformance";

describe("shopping performance diagnostic statistics", () => {
  beforeEach(() => {
    shoppingPerformance.reset();
    shoppingPerformance.enable();
  });
  afterEach(() => {
    shoppingPerformance.enable(false);
    shoppingPerformance.reset();
    vi.restoreAllMocks();
  });

  it.each([
    {
      durations: Array.from({ length: 20 }, (_, index) => 20 - index),
      medianMs: 10.5,
      p95Ms: 19,
    },
    { durations: [9, 1, 5], medianMs: 5, p95Ms: 9 },
    { durations: [7], medianMs: 7, p95Ms: 7 },
    {
      durations: [...Array<number>(10).fill(54), ...Array<number>(10).fill(58)],
      medianMs: 56,
      p95Ms: 58,
    },
  ])(
    "summarizes $durations with median $medianMs",
    ({ durations, medianMs, p95Ms }) => {
      const now = vi.spyOn(performance, "now");
      for (const duration of durations) {
        now.mockReturnValueOnce(0).mockReturnValueOnce(duration);
        measureShoppingOperation("quantity", "save")();
      }
      const result = shoppingPerformance.read();
      expect(result.summary["quantity:save"]).toEqual({
        count: durations.length,
        medianMs,
        p95Ms,
      });
      expect(result.samples.map((sample) => sample.durationMs)).toEqual(
        durations,
      );
    },
  );
});

describe("shopping lifecycle prototype (source only; not yet executed)", () => {
  beforeEach(() => {
    shoppingPerformance.reset();
    shoppingPerformance.enable();
  });
  afterEach(() => {
    shoppingPerformance.enable(false);
    shoppingPerformance.reset();
    vi.restoreAllMocks();
  });

  it("does not read clocks or create a scope while diagnostics are disabled", () => {
    shoppingPerformance.enable(false);
    const now = vi.spyOn(performance, "now");
    const scope = beginShoppingMoveLifecycle(
      Symbol("real-drag"),
      "A",
      "candidate",
      "execute",
    );
    recordShoppingMovePlanReady();
    recordAcceptedShoppingMove("real-save", "real-save:move:1");
    recordShoppingMoveUiApply("real-save", "start");
    endShoppingMoveLifecycle(scope);
    expect(scope).toBeUndefined();
    expect(now).not.toHaveBeenCalled();
    expect(shoppingPerformance.read().lifecycle).toEqual([]);
  });

  it("links actual receipt IDs to the synchronous command token and port return", () => {
    vi.spyOn(performance, "now").mockReturnValue(42);
    const scope = beginShoppingMoveLifecycle(
      Symbol("real-drag"),
      "A",
      "candidate",
      "execute",
    );
    try {
      recordShoppingMovePlanReady();
      recordAcceptedShoppingMove("actual-operation", "actual-operation:move:1");
    } finally {
      endShoppingMoveLifecycle(scope);
    }
    recordShoppingMoveUiApply("actual-operation", "start");
    recordShoppingMoveUiApply("actual-operation", "success");
    const records = shoppingPerformance.read().lifecycle;
    expect(records.map((record) => record.phase)).toEqual([
      "move-command-entry",
      "plan-ready",
      "queue-accepted",
      "ui-apply-start",
      "ui-apply-success",
    ]);
    expect(new Set(records.map((record) => record.diagnosticToken)).size).toBe(
      1,
    );
    expect(records[0].diagnosticToken).toMatch(/^shopping-diagnostic:/);
    expect(records[0].operationId).toBeUndefined();
    expect(
      records
        .slice(2)
        .every(
          (record) =>
            record.operationId === "actual-operation" &&
            record.moveId === "actual-operation:move:1",
        ),
    ).toBe(true);
    expect(
      records.every(
        (record) =>
          record.atMs === 42 && record.epochMs === performance.timeOrigin + 42,
      ),
    ).toBe(true);
  });

  it("does not infer acceptance from a computed proposal", () => {
    const scope = beginShoppingMoveLifecycle(Symbol("drag"), "A");
    try {
      recordShoppingMovePlanReady();
      // A blocked/noop receipt deliberately does not invoke acceptance recording.
    } finally {
      endShoppingMoveLifecycle(scope);
    }
    recordShoppingMoveUiApply("no-such-operation", "start");
    expect(
      shoppingPerformance.read().lifecycle.map((record) => record.phase),
    ).toEqual(["move-command-entry", "plan-ready"]);
    expect(
      shoppingPerformance
        .read()
        .lifecycle.every(
          (record) =>
            record.operationId === undefined && record.moveId === undefined,
        ),
    ).toBe(true);
  });

  it("restores nested contexts in finally and does not leak them after exceptions", () => {
    const outer = beginShoppingMoveLifecycle(Symbol("outer"), "A");
    const inner = beginShoppingMoveLifecycle(Symbol("inner"), "B");
    try {
      recordAcceptedShoppingMove("inner", "inner:move:1");
      throw new Error("existing action error");
    } catch {
      // The action handles its original error; diagnostics only restore context.
    } finally {
      endShoppingMoveLifecycle(inner);
    }
    recordAcceptedShoppingMove("outer", "outer:move:1");
    endShoppingMoveLifecycle(outer);
    recordAcceptedShoppingMove("outside", "outside:move:1");
    const accepted = shoppingPerformance
      .read()
      .lifecycle.filter((record) => record.phase === "queue-accepted");
    expect(accepted.map((record) => record.draggedItemId)).toEqual([
      "B",
      "A",
      undefined,
    ]);
    expect(accepted[0].diagnosticToken).not.toBe(accepted[1].diagnosticToken);
    expect(accepted[2].diagnosticToken).toBeUndefined();
  });

  it("invalidates old scopes and accepted links at reset", () => {
    const old = beginShoppingMoveLifecycle(Symbol("old"), "A");
    recordAcceptedShoppingMove("old", "old:move:1");
    shoppingPerformance.reset();
    const next = beginShoppingMoveLifecycle(Symbol("next"), "B");
    endShoppingMoveLifecycle(old);
    recordShoppingMovePlanReady();
    endShoppingMoveLifecycle(next);
    recordShoppingMoveUiApply("old", "success");
    expect(
      shoppingPerformance.read().lifecycle.map((record) => record.phase),
    ).toEqual(["move-command-entry", "plan-ready"]);
    expect(
      shoppingPerformance
        .read()
        .lifecycle.every((record) => record.draggedItemId === "B"),
    ).toBe(true);
  });

  it("records each real move in a shared save batch without issuing another ID", () => {
    for (const moveId of ["shared-save:move:1", "shared-save:move:2"]) {
      const scope = beginShoppingMoveLifecycle(Symbol("drag"), moveId);
      recordAcceptedShoppingMove("shared-save", moveId);
      endShoppingMoveLifecycle(scope);
    }
    recordShoppingMoveUiApply("shared-save", "success");
    expect(
      shoppingPerformance
        .read()
        .lifecycle.filter((record) => record.phase === "ui-apply-success")
        .map((record) => [record.operationId, record.moveId]),
    ).toEqual([
      ["shared-save", "shared-save:move:1"],
      ["shared-save", "shared-save:move:2"],
    ]);
  });

  it("bounds both retained events and retained acceptance correlations", () => {
    for (let index = 0; index < 520; index++) {
      recordAcceptedShoppingMove("save:" + index, "save:" + index + ":move:1");
    }
    expect(shoppingPerformance.read().lifecycle).toHaveLength(500);
    recordShoppingMoveUiApply("save:0", "success");
    expect(
      shoppingPerformance
        .read()
        .lifecycle.some((record) => record.phase === "ui-apply-success"),
    ).toBe(false);
    recordShoppingMoveUiApply("save:519", "success");
    const records = shoppingPerformance.read().lifecycle;
    expect(records).toHaveLength(500);
    expect(records.at(-1)).toMatchObject({
      phase: "ui-apply-success",
      operationId: "save:519",
      moveId: "save:519:move:1",
    });
    Object.assign(records[0], { operationId: "caller-tampered" });
    expect(shoppingPerformance.read().lifecycle[0].operationId).not.toBe(
      "caller-tampered",
    );
  });

  it("isolates diagnostic clock failures from the original synchronous action", () => {
    vi.spyOn(performance, "now").mockImplementation(() => {
      throw new Error("diagnostic clock failed");
    });
    expect(() => {
      const scope = beginShoppingMoveLifecycle(Symbol("drag"), "A");
      try {
        recordShoppingMovePlanReady();
        recordAcceptedShoppingMove("real-operation", "real-operation:move:1");
      } finally {
        endShoppingMoveLifecycle(scope);
      }
      recordShoppingMoveUiApply("real-operation", "start");
      recordShoppingMoveUiApply("real-operation", "failure");
    }).not.toThrow();
  });
});
