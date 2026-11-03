import { describe, expect, it, vi } from "vitest";
import { createApplicationMutationCoordinator } from "../../../app/commands/applicationMutationCoordinator";
import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import { createEventConsistency } from "../../../types/consistency";
import { planEventDelete } from "./eventMutations";

function snapshot(): PersistenceSnapshot {
  const map = {
    maxRow: 2,
    maxCol: 2,
    cells: [],
    mergedCells: [],
    blocks: [],
  };
  return {
    eventLists: {
      removed: [{ id: "removed-item", remarks: "ユーザー登録" }],
      remaining: [{ id: "remaining-item", remarks: "エラーが発生しました" }],
    },
    eventConsistency: {
      removed: createEventConsistency(),
      remaining: createEventConsistency(),
    },
    eventMetadata: { removed: { memo: "delete" }, remaining: { memo: "keep" } },
    executeModeItems: {
      removed: { "1日目": ["removed-item"] },
      remaining: { "1日目": ["remaining-item"] },
    },
    dayModes: {
      removed: { "1日目": "edit" },
      remaining: { "1日目": "execute" },
    },
    mapData: {
      removed: { "1日目マップ": map },
      remaining: { "1日目マップ": map },
    },
    mapRotationSettings: {
      removed: { "1日目": { mapTabAngle: 90 } },
      remaining: { "1日目": { mapTabAngle: 180 } },
    },
    mapViewportSettings: {
      removed: { "1日目": { zoom: 1 } },
      remaining: { "1日目": { zoom: 2 } },
    },
    routeSettings: {
      removed: { "1日目": { visible: true } },
      remaining: { "1日目": { visible: false } },
    },
    hallDefinitions: {
      removed: { "1日目マップ": [{ id: "removed-hall" }] },
      remaining: { "1日目マップ": [{ id: "remaining-hall" }] },
    },
    hallRouteSettings: {
      removed: { "1日目": { hallOrder: ["removed-hall"] } },
      remaining: { "1日目": { hallOrder: ["remaining-hall"] } },
    },
  };
}

describe("event deletion after the event-list confirmation", () => {
  it("removes every event-owned store without requesting another confirmation", () => {
    const original = snapshot();
    const before = structuredClone(original);
    const plan = planEventDelete(original, "removed");

    expect(plan.confirmation).toBeUndefined();
    expect(plan.invalidatedEvents).toEqual(["removed"]);
    for (const store of Object.keys(original) as Array<
      keyof PersistenceSnapshot
    >)
      expect(plan.snapshot[store]).toEqual({
        remaining: original[store].remaining,
      });
    expect(original).toEqual(before);
  });

  it("does not serialize map cells to construct deletion confirmation details", () => {
    const original = snapshot();
    const serialize = vi.fn(() => {
      throw new Error(
        "Map cells must not be serialized for deletion confirmation",
      );
    });
    const cells: unknown[] = [];
    Object.defineProperty(cells, "toJSON", { value: serialize });
    original.mapData.removed = {
      "1日目マップ": {
        maxRow: 300,
        maxCol: 500,
        cells,
        mergedCells: [],
        blocks: [],
      },
    };

    const plan = planEventDelete(original, "removed");

    expect(serialize).not.toHaveBeenCalled();
    expect(plan.confirmation).toBeUndefined();
    expect(plan.snapshot.mapData).toEqual({
      remaining: original.mapData.remaining,
    });
  });

  it("commits through the shared coordinator without pausing for another confirmation", async () => {
    let current = snapshot();
    const durable = structuredClone(current);
    const expectedRoots = { revision: 1 };
    let finishCommit!: () => void;
    const commit = vi.fn(
      (
        _next: PersistenceSnapshot,
        _roots: object,
        _base: PersistenceSnapshot,
        _invalidatedEvents?: readonly string[],
      ) =>
        new Promise<void>((resolve) => {
          finishCommit = resolve;
        }),
    );
    const apply = vi.fn((next: PersistenceSnapshot) => {
      current = next;
    });
    const coordinator = createApplicationMutationCoordinator({
      readCurrent: () => current,
      drain: async () => undefined,
      readDurable: async () => ({
        snapshot: durable,
        expectedRoots,
        consistencyMissing: false,
      }),
      commit,
      apply,
    });

    const result = coordinator.request({
      id: "delete-event",
      events: ["removed"],
      plan: (latest) => planEventDelete(latest, "removed"),
    });
    await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
    expect(apply).not.toHaveBeenCalled();
    finishCommit();

    expect((await result).status).toBe("committed");
    const saved = commit.mock.calls[0][0];
    expect(commit).toHaveBeenCalledWith(saved, expectedRoots, durable, [
      "removed",
    ]);
    expect(apply).toHaveBeenCalledWith(saved, ["removed"]);
    expect(current.eventLists).toEqual({
      remaining: durable.eventLists.remaining,
    });
    expect(current.mapData).toEqual({ remaining: durable.mapData.remaining });
  });

  it("keeps the event when persistence fails and allows retry without another confirmation", async () => {
    let current = snapshot();
    const durable = structuredClone(current);
    const error = new Error("transaction failed");
    const commit = vi
      .fn(async (_next: PersistenceSnapshot) => undefined)
      .mockRejectedValueOnce(error);
    const apply = vi.fn((next: PersistenceSnapshot) => {
      current = next;
    });
    const coordinator = createApplicationMutationCoordinator({
      readCurrent: () => current,
      drain: async () => undefined,
      readDurable: async () => ({
        snapshot: durable,
        expectedRoots: {},
        consistencyMissing: false,
      }),
      commit,
      apply,
    });
    const intent = {
      id: "delete-event",
      events: ["removed"],
      plan: (latest: PersistenceSnapshot) => planEventDelete(latest, "removed"),
    };

    await expect(coordinator.request(intent)).rejects.toBe(error);
    expect(apply).not.toHaveBeenCalled();
    expect(current).toEqual(durable);
    expect(coordinator.generation("removed")).toBe(0);

    expect((await coordinator.request(intent)).status).toBe("committed");
    expect(commit).toHaveBeenCalledTimes(2);
    expect(current.eventLists).not.toHaveProperty("removed");
    expect(current.mapData).not.toHaveProperty("removed");
  });
});
