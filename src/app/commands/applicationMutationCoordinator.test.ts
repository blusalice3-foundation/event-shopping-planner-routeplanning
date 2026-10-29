import { describe, expect, it, vi } from "vitest";
import { planDayModeToggle } from "../../features/consistency/domain/dayMode";
import { createEventConsistency } from "../../types/consistency";
import type {
  ApplicationSnapshotRead,
  PersistenceSnapshot,
} from "../ports/PersistenceCommandPort";
import {
  CommittedStateApplyError,
  createApplicationMutationCoordinator,
  type MutationCoordinatorPorts,
  type MutationIntent,
} from "./applicationMutationCoordinator";

function setup(
  commitItems?: Parameters<
    typeof createApplicationMutationCoordinator
  >[0]["commitItemContentEdits"],
) {
  let durable: PersistenceSnapshot = {
    eventLists: {
      event: [{ id: "A", remarks: "before", purchaseStatus: "None" }],
    },
    eventConsistency: { event: createEventConsistency() },
    eventMetadata: {},
    executeModeItems: {},
    dayModes: {},
    mapData: {},
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallDefinitions: {},
    hallRouteSettings: {},
  };
  let current = structuredClone(durable);
  const commit = vi.fn(async (snapshot: PersistenceSnapshot) => {
    durable = structuredClone(snapshot);
  });
  const drain = vi.fn(async () => undefined);
  const readDurable = vi.fn(
    async (): Promise<ApplicationSnapshotRead> => ({
      snapshot: structuredClone(durable),
      expectedRoots: { revision: 1 },
      consistencyMissing: false,
    }),
  );
  const coordinator = createApplicationMutationCoordinator({
    readCurrent: () => current,
    drain,
    readDurable,
    commitItemContentEdits: commitItems,
    commit,
    apply: (value) => {
      current = value;
    },
  });
  const restore: MutationIntent = {
    id: "restore",
    events: ["event"],
    plan(snapshot) {
      const before = structuredClone(snapshot.eventLists.event);
      snapshot.eventLists.event = [
        { id: "A", remarks: "backup", purchaseStatus: "None" },
      ];
      return {
        snapshot,
        confirmation: { title: "復元", details: [], comparison: before },
        invalidatedEvents: ["event"],
      };
    },
  };
  return {
    coordinator,
    commit,
    restore,
    drain,
    readDurable,
    durable: () => durable,
    update: (patch: Record<string, unknown>) => {
      Object.assign(durable.eventLists.event[0]!, patch);
      current = structuredClone(durable);
    },
    read: () => current,
  };
}
describe("application mutation ordering and confirmation", () => {
  it("reconfirms current memo changes even when the restoration result is unchanged (R39)", async () => {
    const app = setup();
    const first = await app.coordinator.request(app.restore);
    expect(first.status).toBe("confirmation-required");
    if (first.status !== "confirmation-required") return;
    app.update({ remarks: "受け取りは午後" });
    const next = await app.coordinator.confirm(first.token);
    expect(next.status).toBe("confirmation-required");
    expect(app.commit).not.toHaveBeenCalled();
    if (next.status !== "confirmation-required") return;
    expect(await app.coordinator.confirm(first.token)).toEqual({
      status: "expired",
    });
    expect((await app.coordinator.confirm(next.token)).status).toBe(
      "committed",
    );
    expect(app.read().eventLists.event[0]).toMatchObject({ remarks: "backup" });
  });
  it("does not hold the queue during confirmation; cancellation preserves intervening purchases", async () => {
    const app = setup();
    const result = await app.coordinator.request(app.restore);
    if (result.status !== "confirmation-required")
      throw new Error("missing confirmation");
    await app.coordinator.enqueue(() =>
      app.update({ price: 900, purchaseStatus: "Purchased" }),
    );
    app.coordinator.cancel(result.token);
    expect((await app.coordinator.confirm(result.token)).status).toBe(
      "expired",
    );
    expect(app.read().eventLists.event[0]).toMatchObject({
      price: 900,
      purchaseStatus: "Purchased",
    });
  });
  it("expires old event sessions only after commit and deduplicates operations", async () => {
    const app = setup();
    const result = await app.coordinator.request(app.restore);
    if (result.status !== "confirmation-required")
      throw new Error("missing confirmation");
    app.commit.mockRejectedValueOnce(new Error("disk full"));
    await expect(app.coordinator.confirm(result.token)).rejects.toThrow(
      "disk full",
    );
    expect(app.coordinator.generation("event")).toBe(0);
    await app.coordinator.confirm(result.token);
    expect(app.coordinator.generation("event")).toBe(1);
    await app.coordinator.request(app.restore);
    expect(app.commit).toHaveBeenCalledTimes(2);
  });
  it("retries CAS from latest data at most three times without applying a failed snapshot", async () => {
    const app = setup();
    const conflict = new Error("conflict");
    conflict.name = "PersistenceConflict";
    app.commit.mockRejectedValue(conflict);
    await expect(
      app.coordinator.request({
        ...app.restore,
        plan: (snapshot) => ({ snapshot }),
      }),
    ).rejects.toThrow("保存の競合");
    expect(app.commit).toHaveBeenCalledTimes(3);
    expect(app.read().eventLists.event[0]).toMatchObject({ remarks: "before" });
  });
});
describe("mutation queue durable boundaries", () => {
  const snapshot = (): PersistenceSnapshot => ({
    eventLists: { event: [] },
    eventConsistency: {},
    eventMetadata: {},
    executeModeItems: {},
    dayModes: {},
    mapData: {},
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallDefinitions: {},
    hallRouteSettings: {},
  });
  it("drains older writes, retries against the exact new roots, and applies before the next intent", async () => {
    let saved = snapshot();
    let visible = snapshot();
    const calls: string[] = [];
    const roots: object[] = [];
    let revision = 0;
    const coordinator = createApplicationMutationCoordinator({
      readCurrent: () => visible,
      drain: async () => {
        calls.push("drain");
        saved.eventMetadata.event = { fromOldWriter: true };
      },
      readDurable: async () => {
        const expectedRoots = { revision: ++revision };
        roots.push(expectedRoots);
        calls.push("read");
        return {
          snapshot: structuredClone(saved),
          expectedRoots,
          consistencyMissing: false,
        };
      },
      commit: async (next, expectedRoots) => {
        expect(expectedRoots).toBe(roots.at(-1));
        calls.push("commit");
        if (revision === 1) {
          saved.dayModes.event = { day: "execute" };
          throw Object.assign(new Error("conflict"), {
            name: "PersistenceConflict",
          });
        }
        saved = structuredClone(next);
      },
      apply: (next) => {
        calls.push("apply");
        visible = next;
      },
    });
    const first = coordinator.request({
      id: "first",
      events: ["event"],
      plan: (next) => {
        next.executeModeItems.event = { day: [] };
        return { snapshot: next };
      },
    });
    const second = coordinator.request({
      id: "second",
      events: ["event"],
      plan: (next) => {
        expect(visible.executeModeItems.event).toEqual({ day: [] });
        expect(next.dayModes.event).toEqual({ day: "execute" });
        next.eventMetadata.second = true;
        return { snapshot: next };
      },
    });
    await Promise.all([first, second]);
    expect(calls).toEqual([
      "drain",
      "read",
      "commit",
      "read",
      "commit",
      "apply",
      "drain",
      "read",
      "commit",
      "apply",
    ]);
    expect(saved.eventMetadata.event).toEqual({ fromOldWriter: true });
  });
  it("stops subsequent mutations after a committed state cannot be applied, without rollback", async () => {
    const commit = vi.fn(async () => {});
    const failure = vi.fn();
    const coordinator = createApplicationMutationCoordinator({
      readCurrent: snapshot,
      drain: async () => {},
      readDurable: async () => ({
        snapshot: snapshot(),
        expectedRoots: {},
        consistencyMissing: false,
      }),
      commit,
      apply: () => {
        throw new Error("render");
      },
      onApplyFailure: failure,
    });
    const intent = {
      id: "first",
      events: ["event"],
      plan: (next: PersistenceSnapshot) => ({ snapshot: next }),
    };
    await expect(coordinator.request(intent)).rejects.toThrow("保存は完了");
    await expect(
      coordinator.request({ ...intent, id: "second" }),
    ).rejects.toThrow("再読み込み");
    expect(commit).toHaveBeenCalledOnce();
    expect(failure).toHaveBeenCalledOnce();
  });
  it("expires pending confirmations only after successful event replacement", async () => {
    const expired = vi.fn();
    const coordinator = createApplicationMutationCoordinator({
      readCurrent: snapshot,
      drain: async () => {},
      readDurable: async () => ({
        snapshot: snapshot(),
        expectedRoots: {},
        consistencyMissing: false,
      }),
      commit: async () => {},
      apply: () => {},
      onExpired: expired,
    });
    const waiting = await coordinator.request({
      id: "edit",
      events: ["event"],
      plan: (next) => ({
        snapshot: next,
        confirmation: { title: "edit", details: [], comparison: "edit" },
      }),
    });
    expect(waiting.status).toBe("confirmation-required");
    await coordinator.request({
      id: "replace",
      events: ["event"],
      plan: (next) => ({ snapshot: next, invalidatedEvents: ["event"] }),
    });
    expect(expired).toHaveBeenCalledExactlyOnceWith(["edit"]);
    if (waiting.status !== "confirmation-required")
      throw new Error("confirmation missing");
    expect(await coordinator.confirm(waiting.token)).toEqual({
      status: "expired",
    });
  });
  it("exports an immutable current snapshot including unsaved values without reading or writing the database", async () => {
    const current = snapshot();
    current.eventMetadata.unsaved = { memo: "ユーザー登録" };
    const drain = vi.fn(async () => {
      throw new Error("unsaved write failed");
    });
    const readDurable = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const commit = vi.fn(async () => {});
    const apply = vi.fn();
    const coordinator = createApplicationMutationCoordinator({
      readCurrent: () => current,
      drain,
      readDurable,
      commit,
      apply,
    });
    const exported = await coordinator.readExportSnapshot();
    expect(exported).toEqual(current);
    current.eventMetadata.unsaved = { memo: "後の変更" };
    expect(exported.eventMetadata.unsaved).toEqual({ memo: "ユーザー登録" });
    expect(drain).not.toHaveBeenCalled();
    expect(readDurable).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "waits for a preceding mutation with write failure=%s and exports only accepted state",
    async (fails) => {
      let current = snapshot();
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });

      const coordinator = createApplicationMutationCoordinator({
        readCurrent: () => current,
        drain: async () => {},
        readDurable: async () => ({
          snapshot: structuredClone(current),
          expectedRoots: {},
          consistencyMissing: false,
        }),
        commit: async () => {
          await barrier;
          if (fails) throw new Error("write failed");
        },
        apply: (next) => {
          current = next;
        },
      });
      const mutation = coordinator.request({
        id: "edit",
        events: ["event"],
        plan: (next) => {
          next.eventMetadata.event = { accepted: true };
          return { snapshot: next };
        },
      });
      const outcome = mutation.catch((error: Error) => error);
      let exported = false;
      const output = coordinator.readExportSnapshot().then((value) => {
        exported = true;
        return value;
      });
      await Promise.resolve();
      expect(exported).toBe(false);
      release();
      await outcome;
      expect((await output).eventMetadata).toEqual(
        fails ? {} : { event: { accepted: true } },
      );
    },
  );
});

it.each(["choose", "confirm", "retry"] as const)(
  "renews review without saving when duplicate days disappear before %s (R28/I09)",
  async (action) => {
    const app = setup();
    app.durable().dayModes.event = { "1日目": "edit", " 1日目　": "execute" };
    const first = await app.coordinator.request({
      id: "mode",
      events: ["event"],
      plan: (snapshot, choices) =>
        planDayModeToggle(snapshot, "event", "1日目", choices),
    });
    if (first.status !== "confirmation-required")
      throw new Error("Missing review");
    app.durable().dayModes.event = { "1日目": "execute" };
    const renewed = await (action === "choose"
      ? app.coordinator.choose(first.token, "mode", "edit")
      : action === "confirm"
        ? app.coordinator.confirm(first.token)
        : app.coordinator.retry(first.token.operationId));
    expect(renewed.status).toBe("confirmation-required");
    expect(app.commit).not.toHaveBeenCalled();
    expect(app.durable().dayModes.event).toEqual({ "1日目": "execute" });
    if (renewed.status !== "confirmation-required")
      throw new Error("Missing renewed review");
    expect(renewed.token).not.toBe(first.token);
    expect(renewed.confirmation.details.join("\n")).toContain("edit");
    expect(await app.coordinator.confirm(first.token)).toEqual({
      status: "expired",
    });
    app.update({
      remarks: "最新の購入メモ",
      price: 900,
      purchaseStatus: "Purchased",
    });
    expect((await app.coordinator.confirm(renewed.token)).status).toBe(
      "committed",
    );
    expect(app.commit).toHaveBeenCalledOnce();
    expect(app.read().dayModes.event).toEqual({ "1日目": "edit" });
    expect(app.read().eventLists.event[0]).toMatchObject({
      remarks: "最新の購入メモ",
      price: 900,
      purchaseStatus: "Purchased",
    });
  },
);

it("renews a review again when the result changes after its original confirmation disappears", async () => {
  const app = setup();
  app.durable().dayModes.event = { "1日目": "edit", " 1日目　": "execute" };
  const first = await app.coordinator.request({
    id: "mode",
    events: ["event"],
    plan: (snapshot, choices) =>
      planDayModeToggle(snapshot, "event", "1日目", choices),
  });
  if (first.status !== "confirmation-required")
    throw new Error("Missing review");
  app.durable().dayModes.event = { "1日目": "execute" };
  const second = await app.coordinator.confirm(first.token);
  expect(second.status).toBe("confirmation-required");
  if (second.status !== "confirmation-required")
    throw new Error("Missing renewed review");
  app.durable().dayModes.event = { "1日目": "edit" };
  const third = await app.coordinator.confirm(second.token);
  expect(third.status).toBe("confirmation-required");
  expect(app.commit).not.toHaveBeenCalled();
});

it.each(["drain", "read", "conflict"] as const)(
  "does not commit or apply after cancellation while awaiting %s (3.3/R28)",
  async (boundary) => {
    const app = setup();
    const first = await app.coordinator.request(app.restore);
    if (first.status !== "confirmation-required")
      throw new Error("Missing review");
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    if (boundary === "drain")
      app.drain.mockImplementationOnce(async () => {
        entered();
        await gate;
      });
    else if (boundary === "read")
      app.readDurable.mockImplementationOnce(async () => {
        entered();
        await gate;
        return {
          snapshot: structuredClone(app.durable()),
          expectedRoots: {},
          consistencyMissing: false,
        };
      });
    else {
      app.commit.mockRejectedValueOnce(
        Object.assign(new Error("conflict"), { name: "PersistenceConflict" }),
      );
      app.readDurable
        .mockImplementationOnce(async () => ({
          snapshot: structuredClone(app.durable()),
          expectedRoots: {},
          consistencyMissing: false,
        }))
        .mockImplementationOnce(async () => {
          entered();
          await gate;
          return {
            snapshot: structuredClone(app.durable()),
            expectedRoots: {},
            consistencyMissing: false,
          };
        });
    }
    const confirming = app.coordinator.confirm(first.token);
    await waiting;
    app.coordinator.cancel(first.token);
    release();
    expect((await confirming).status).toBe("cancelled");
    expect(app.commit).toHaveBeenCalledTimes(boundary === "conflict" ? 1 : 0);
    expect(app.durable().eventLists.event[0]).toMatchObject({
      remarks: "before",
    });
    expect(app.read().eventLists.event[0]).toMatchObject({ remarks: "before" });
    expect(app.coordinator.generation("event")).toBe(0);
  },
);

it("keeps a commit in progress valid when cancellation can no longer be accepted", async () => {
  const app = setup();
  const first = await app.coordinator.request(app.restore);
  if (first.status !== "confirmation-required")
    throw new Error("Missing review");
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const save = app.commit.getMockImplementation()!;
  app.commit.mockImplementationOnce(async (snapshot) => {
    entered();
    await gate;
    await save(snapshot);
  });
  const confirming = app.coordinator.confirm(first.token);
  await waiting;
  expect(app.coordinator.cancel(first.token)).toBe(false);
  expect(app.coordinator.discard(first.token.operationId)).toBe(false);
  release();
  expect((await confirming).status).toBe("committed");
  expect(app.read().eventLists.event[0]).toMatchObject({ remarks: "backup" });
});

it.each(["cancel", "undo", "redo", "reorder", "save", "transition"])(
  "expires another-tab replacement before planning an old %s, even when every payload is equal",
  async (action) => {
    const app = setup();
    let durableGenerations = { event: 4, other: 2 };
    app.coordinator.initializeEventGenerations({
      snapshot: app.read(),
      expectedRoots: {},
      consistencyMissing: false,
      eventGenerations: durableGenerations,
    });
    app.readDurable.mockImplementation(async () => ({
      snapshot: structuredClone(app.durable()),
      expectedRoots: {},
      consistencyMissing: false,
      eventGenerations: { ...durableGenerations },
    }));
    const plan = vi.fn((snapshot: PersistenceSnapshot) => ({ snapshot }));
    durableGenerations = { event: 5, other: 2 };
    expect(
      await app.coordinator.request({
        id: action,
        events: ["event"],
        expectedGenerations: { event: 0 },
        plan,
      }),
    ).toEqual({ status: "expired" });
    expect(plan).not.toHaveBeenCalled();
    expect(app.commit).not.toHaveBeenCalled();
    expect(app.coordinator.generation("event")).toBe(1);
    expect(app.coordinator.generation("other")).toBe(0);
    expect(
      (
        await app.coordinator.request({
          id: "new-session",
          events: ["event"],
          expectedGenerations: { event: 1 },
          plan,
        })
      ).status,
    ).toBe("committed");
  },
);

it("expires a pending review after another-tab replacement without touching an unrelated event", async () => {
  const app = setup();
  let eventGenerations = { event: 0 };
  app.readDurable.mockImplementation(async () => ({
    snapshot: structuredClone(app.durable()),
    expectedRoots: {},
    consistencyMissing: false,
    eventGenerations,
  }));
  const review = await app.coordinator.request(app.restore);
  if (review.status !== "confirmation-required")
    throw new Error("missing review");
  eventGenerations = { event: 1 };
  expect(
    (
      await app.coordinator.request({
        id: "other",
        events: ["other"],
        plan: (snapshot) => ({ snapshot }),
      })
    ).status,
  ).toBe("committed");
  expect(await app.coordinator.confirm(review.token)).toEqual({
    status: "expired",
  });
  expect(app.commit).toHaveBeenCalledOnce();
  expect(app.read().eventLists.event).toEqual(app.durable().eventLists.event);
});

it("expires a stale session if a CAS retry encounters an equal replacement", async () => {
  const app = setup();
  let eventGenerations = { event: 0 };
  app.readDurable.mockImplementation(async () => ({
    snapshot: structuredClone(app.durable()),
    expectedRoots: {},
    consistencyMissing: false,
    eventGenerations,
  }));
  app.commit.mockImplementationOnce(async () => {
    eventGenerations = { event: 1 };
    throw Object.assign(new Error("another tab restored"), {
      name: "PersistenceConflict",
    });
  });
  const plan = vi.fn((snapshot: PersistenceSnapshot) => ({ snapshot }));
  expect(
    await app.coordinator.request({ id: "cancel", events: ["event"], plan }),
  ).toEqual({ status: "expired" });
  expect(plan).toHaveBeenCalledOnce();
  expect(app.commit).toHaveBeenCalledOnce();
});

it("coalesces queued field commands in order without crossing a structural command", async () => {
  const trace: string[] = [];
  const commitItems = vi.fn<
    NonNullable<
      Parameters<
        typeof createApplicationMutationCoordinator
      >[0]["commitItemContentEdits"]
    >
  >(async (edits, ids) => {
    trace.push("items:" + ids.join(","));
    for (const edit of edits) {
      app.update(
        Object.fromEntries(
          Object.entries(edit.fields).map(([key, field]) => [
            key,
            (field as { value: unknown }).value,
          ]),
        ),
      );
    }
    return {
      status: "committed" as const,
      read: {
        snapshot: structuredClone(app.durable()),
        expectedRoots: {},
        consistencyMissing: false,
      },
    };
  });
  const app = setup(commitItems);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blocker = app.coordinator.enqueue(() => gate);
  const fieldIntent = (
    id: string,
    fields: Record<string, { present: boolean; value: unknown }>,
  ): MutationIntent => ({
    id,
    events: ["event"],
    itemContentEdits: [{ eventName: "event", itemId: "A", fields }],
    plan: () => {
      throw new Error("The ordinary field path should stay in the worker.");
    },
  });
  const first = app.coordinator.request(
    fieldIntent("first", { quantity: { present: true, value: 2 } }),
  );
  const second = app.coordinator.request(
    fieldIntent("second", {
      remarks: { present: true, value: "ユーザー登録" },
    }),
  );
  const structure = app.coordinator.request({
    id: "structure",
    events: ["event"],
    plan: (snapshot) => {
      trace.push("structure");
      expect(snapshot.eventLists.event[0]).toMatchObject({
        quantity: 2,
        remarks: "ユーザー登録",
      });
      return { snapshot };
    },
  });
  const third = app.coordinator.request(
    fieldIntent("third", { quantity: { present: true, value: 3 } }),
  );
  expect(commitItems).not.toHaveBeenCalled();
  release();
  const results = await Promise.all([first, second, structure, third]);
  await blocker;
  expect(results.map((result) => result.status)).toEqual(
    Array(4).fill("committed"),
  );
  expect(trace).toEqual(["items:first,second", "structure", "items:third"]);
  expect(commitItems).toHaveBeenCalledTimes(2);
  expect(app.commit).toHaveBeenCalledOnce();
  expect(app.read().eventLists.event[0]).toMatchObject({
    quantity: 3,
    remarks: "ユーザー登録",
  });
});

it("checks an expired visit session before sending a queued day command", async () => {
  let applicable = true;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const base = setup();
  const commitDayMutation = vi.fn();
  const coordinator = createApplicationMutationCoordinator({
    readCurrent: base.read,
    readDurable: base.readDurable,
    commit: base.commit,
    apply: () => {},
    drain: async () => {
      await gate;
    },
    commitDayMutation,
  });
  const pending = coordinator.request({
    id: "old-session",
    events: ["event"],
    dayMutation: {
      kind: "visits",
      eventName: "event",
      day: "1日目",
      mapKey: "1日目マップ",
      order: ["A"],
    },
    assertApplicable() {
      if (!applicable) throw new Error("訪問リストの操作は終了しています。");
    },
    plan(snapshot) {
      return { snapshot };
    },
  });
  const rejected =
    expect(pending).rejects.toThrow("訪問リストの操作は終了しています。");
  applicable = false;
  release();
  await rejected;
  expect(commitDayMutation).not.toHaveBeenCalled();
  expect(base.readDurable).not.toHaveBeenCalled();
  expect(base.commit).not.toHaveBeenCalled();
});

it.each(["drain", "commit", "day", "day-snapshot", "items"])(
  "shares an unknown write stop from %s with queued and new requests",
  async (boundary) => {
    const app = setup();
    const reason = Object.assign(new Error("reload"), {
      name: "PersistenceOutcomeUnknownError",
    });
    const notify = vi.fn();
    const commit = vi.fn(async () => {
      if (boundary === "commit") throw reason;
    });
    const read = async () => ({
      snapshot: { ...structuredClone(app.read()), eventLists: { event: [] } },
      expectedRoots: {},
      consistencyMissing: false,
    });
    const coordinator = createApplicationMutationCoordinator({
      readCurrent: app.read,
      readDurable: read,
      drain: async () => {
        if (boundary === "drain") throw reason;
      },
      ...(boundary === "day"
        ? {
            commitDayMutation: async () => {
              throw reason;
            },
          }
        : {}),
      ...(boundary === "day-snapshot"
        ? {
            readDayDurable: read,
            commitDaySnapshot: async () => {
              throw reason;
            },
          }
        : {}),
      ...(boundary === "items"
        ? {
            commitItemContentEdits: async () => {
              throw reason;
            },
          }
        : {}),
      commit,
      apply: vi.fn(),
      onApplyFailure: notify,
    });
    const intent: MutationIntent = {
      id: "first",
      events: ["event"],
      plan: (snapshot) => ({ snapshot }),
      ...(["day", "day-snapshot"].includes(boundary)
        ? {
            dayMutation: {
              kind: "mode" as const,
              eventName: "event",
              day: "1日目",
            },
          }
        : {}),
      ...(boundary === "items" ? { itemContentEdits: [] } : {}),
    };
    const first = coordinator.request(intent).catch((error: unknown) => error);
    const queued = coordinator
      .request({ ...intent, id: "queued" })
      .catch((error: unknown) => error);
    expect(await first).toBe(reason);
    expect(await queued).toBe(reason);
    await expect(coordinator.request({ ...intent, id: "new" })).rejects.toBe(
      reason,
    );
    expect(notify).toHaveBeenCalledExactlyOnceWith(reason);
    expect(coordinator.getWriteStopReason()).toBe(reason);
    expect(coordinator.getPendingState("first").requestPending).toBe(false);
    expect(commit).toHaveBeenCalledTimes(boundary === "commit" ? 1 : 0);
  },
);

it("keeps the registered terminal reason when an older read subsequently rejects with a generic transport error", async () => {
  const app = setup();
  let reject!: (error: unknown) => void;
  app.drain.mockImplementationOnce(
    () =>
      new Promise<undefined>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const result = app.coordinator
    .request({
      id: "inflight",
      events: ["event"],
      plan: (snapshot) => ({ snapshot }),
    })
    .catch((error: unknown) => error);
  await Promise.resolve();
  const reason = Object.assign(new Error("unknown outcome"), {
    name: "PersistenceOutcomeUnknownError",
  });
  app.coordinator.stopWrites(reason);
  reject(new Error("read transport lost"));
  expect(await result).toBe(reason);
  expect(app.commit).not.toHaveBeenCalled();
});
it.each(["day fast path", "day snapshot", "items batch"] as const)(
  "stops queued and same-tick writes after %s commits but apply fails",
  async (route) => {
    const app = setup();
    let durable = structuredClone(app.read());
    (durable.eventLists.event[0] as Record<string, unknown>).eventDate =
      "1日目";
    const saved = structuredClone(durable);
    if (route === "items batch") {
      saved.eventLists.event[0] = {
        ...(saved.eventLists.event[0] as Record<string, unknown>),
        quantity: 2,
        remarks: "ユーザー登録",
      };
    } else saved.dayModes.event = { "1日目": "execute" };
    const read = (): ApplicationSnapshotRead => ({
      snapshot: structuredClone(durable),
      expectedRoots: { revision: 1 },
      consistencyMissing: false,
      eventGenerations: { event: 0 },
    });
    const trace: string[] = [];
    const commitDayMutation = vi.fn<
      NonNullable<MutationCoordinatorPorts["commitDayMutation"]>
    >(async () => {
      durable = structuredClone(saved);
      trace.push("day committed");
      return { status: "committed", read: read() };
    });
    const commitDaySnapshot = vi.fn<
      NonNullable<MutationCoordinatorPorts["commitDaySnapshot"]>
    >(async (next) => {
      expect(next.dayModes.event).toEqual({ "1日目": "execute" });
      durable = structuredClone(next);
      trace.push("day snapshot committed");
      return read();
    });
    const commitItemContentEdits = vi.fn<
      NonNullable<MutationCoordinatorPorts["commitItemContentEdits"]>
    >(async (_edits, ids) => {
      expect(ids).toEqual(["first", "batch-peer"]);
      durable = structuredClone(saved);
      trace.push("items committed");
      return { status: "committed", read: read() };
    });
    const genericCommit = vi.fn(async () => {});
    const readDurable = vi.fn(async () => read());
    const readDayDurable = vi.fn(async () => read());
    const drain = vi.fn(async () => {});
    const fault = new Error("エラーが発生しました");
    const apply = vi.fn((next: PersistenceSnapshot) => {
      expect(next).toEqual(durable);
      expect(durable).toEqual(saved);
      trace.push("apply failed");
      throw fault;
    });
    const downstreamWrite = vi.fn();
    const queuedPlan = vi.fn((snapshot: PersistenceSnapshot) => ({ snapshot }));
    const blockedIntent: MutationIntent = {
      id: "queued",
      events: ["event"],
      plan: queuedPlan,
    };
    const sameTickRequests: Promise<unknown>[] = [];
    const onApplyFailure = vi.fn((reason: Error) => {
      expect(coordinator.getWriteStopReason()).toBe(reason);
      trace.push("stopped");
      sameTickRequests.push(
        coordinator.retry("first").catch((error: unknown) => error),
        coordinator
          .request({ ...blockedIntent, id: "same-tick-new" })
          .catch((error: unknown) => error),
        coordinator
          .enqueue(() => downstreamWrite())
          .catch((error: unknown) => error),
      );
    });
    const coordinator = createApplicationMutationCoordinator({
      readCurrent: app.read,
      drain,
      readDurable,
      readDayDurable,
      commitDayMutation:
        route === "day fast path" ? commitDayMutation : undefined,
      commitDaySnapshot,
      commitItemContentEdits,
      commit: genericCommit,
      apply,
      onApplyFailure,
    });
    const plan = vi.fn((snapshot: PersistenceSnapshot) => {
      snapshot.dayModes.event = { "1日目": "execute" };
      return { snapshot };
    });
    const intent: MutationIntent = {
      id: "first",
      events: ["event"],
      plan,
      ...(route === "items batch"
        ? {
            itemContentEdits: [
              {
                eventName: "event",
                itemId: "A",
                fields: { quantity: { present: true, value: 2 } },
              },
            ],
          }
        : {
            dayMutation: {
              kind: "mode" as const,
              eventName: "event",
              day: "1日目",
            },
          }),
    };
    const first = coordinator.request(intent).catch((error: unknown) => error);
    const peer =
      route === "items batch"
        ? coordinator
            .request({
              ...intent,
              id: "batch-peer",
              itemContentEdits: [
                {
                  eventName: "event",
                  itemId: "A",
                  fields: { remarks: { present: true, value: "ユーザー登録" } },
                },
              ],
            })
            .catch((error: unknown) => error)
        : undefined;
    const queued = coordinator
      .request(blockedIntent)
      .catch((error: unknown) => error);
    const terminal = await first;
    expect(terminal).toBeInstanceOf(CommittedStateApplyError);
    expect(terminal).toMatchObject({ cause: fault });
    expect(await queued).toBe(terminal);
    if (peer) expect(await peer).toBe(terminal);
    expect(sameTickRequests).toHaveLength(3);
    for (const result of await Promise.all(sameTickRequests))
      expect(result).toBe(terminal);
    await expect(
      coordinator.request({ ...blockedIntent, id: "after-stop" }),
    ).rejects.toBe(terminal);
    expect(coordinator.getWriteStopReason()).toBe(terminal);
    for (const id of ["first", "batch-peer", "queued", "same-tick-new"])
      expect(coordinator.getPendingState(id)).toEqual({
        requestPending: false,
        canCancel: false,
        confirmationPending: false,
      });
    expect(onApplyFailure).toHaveBeenCalledExactlyOnceWith(terminal);
    expect(apply).toHaveBeenCalledOnce();
    expect(drain).toHaveBeenCalledOnce();
    expect(genericCommit).not.toHaveBeenCalled();
    expect(readDurable).not.toHaveBeenCalled();
    expect(queuedPlan).not.toHaveBeenCalled();
    expect(downstreamWrite).not.toHaveBeenCalled();
    expect(commitDayMutation).toHaveBeenCalledTimes(
      route === "day fast path" ? 1 : 0,
    );
    expect(commitDaySnapshot).toHaveBeenCalledTimes(
      route === "day snapshot" ? 1 : 0,
    );
    expect(readDayDurable).toHaveBeenCalledTimes(
      route === "day snapshot" ? 1 : 0,
    );
    expect(commitItemContentEdits).toHaveBeenCalledTimes(
      route === "items batch" ? 1 : 0,
    );
    expect(plan).toHaveBeenCalledTimes(route === "day snapshot" ? 1 : 0);
    expect(trace).toEqual([
      route === "day fast path"
        ? "day committed"
        : route === "day snapshot"
          ? "day snapshot committed"
          : "items committed",
      "apply failed",
      "stopped",
    ]);
    expect(durable).toEqual(saved);
  },
);

it.each(["snapshot", "day-command", "day-snapshot", "item-batch"] as const)(
  "publishes the owned %s request state before persistence starts and when it ends",
  async (route) => {
    const app = setup();
    (app.read().eventLists.event[0] as Record<string, unknown>).eventDate =
      "1日目";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = async (): Promise<ApplicationSnapshotRead> => ({
      snapshot: structuredClone(app.read()),
      expectedRoots: {},
      consistencyMissing: false,
      eventGenerations: { event: 0 },
    });
    const states: Array<{
      id: string;
      requestPending: boolean;
      canCancel: boolean;
      confirmationPending: boolean;
    }> = [];
    const commit = vi.fn(async () => {
      expect(states.at(-1)).toMatchObject({
        id: "owned",
        requestPending: true,
        canCancel: false,
      });
      await gate;
    });
    const coordinator = createApplicationMutationCoordinator({
      readCurrent: app.read,
      drain: async () => {},
      readDurable: read,
      ...(route === "day-command"
        ? {
            commitDayMutation: async () => {
              await commit();
              return { status: "committed" as const, read: await read() };
            },
          }
        : {}),
      ...(route === "day-snapshot"
        ? {
            readDayDurable: read,
            commitDaySnapshot: async () => {
              await commit();
              return read();
            },
          }
        : {}),
      ...(route === "item-batch"
        ? {
            commitItemContentEdits: async () => {
              await commit();
              return { status: "committed" as const, read: await read() };
            },
          }
        : {}),
      commit,
      apply: vi.fn(),
      onPendingStateChanged: (id) =>
        states.push({ id, ...coordinator.getPendingState(id) }),
    });
    const result = coordinator.request({
      id: "owned",
      events: ["event"],
      plan: (snapshot) => ({ snapshot }),
      ...(["day-command", "day-snapshot"].includes(route)
        ? {
            dayMutation: {
              kind: "mode" as const,
              eventName: "event",
              day: "1日目",
            },
          }
        : {}),
      ...(route === "item-batch" ? { itemContentEdits: [] } : {}),
    });
    await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
    expect(coordinator.discard("owned")).toBe(false);
    release();
    expect((await result).status).toBe("committed");
    expect(states).toEqual([
      {
        id: "owned",
        requestPending: true,
        canCancel: true,
        confirmationPending: false,
      },
      {
        id: "owned",
        requestPending: true,
        canCancel: false,
        confirmationPending: false,
      },
      {
        id: "owned",
        requestPending: false,
        canCancel: false,
        confirmationPending: false,
      },
    ]);
  },
);

it.each([false, true])(
  "isolates pending-state observer failures from the committed apply result (apply fails=%s)",
  async (applyFails) => {
    const app = setup();
    const observerError = new Error("observer failed");
    const applyError = new Error("apply failed");
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    const commit = vi.fn(async () => {});
    const apply = vi.fn(() => {
      if (applyFails) throw applyError;
    });
    const stopped = vi.fn();
    const observer = vi.fn(() => {
      throw observerError;
    });
    try {
      const coordinator = createApplicationMutationCoordinator({
        readCurrent: app.read,
        drain: async () => {},
        readDurable: app.readDurable,
        commit,
        apply,
        onApplyFailure: stopped,
        onPendingStateChanged: observer,
      });
      const result = coordinator.request({
        id: "owned",
        events: ["event"],
        plan: (snapshot) => ({ snapshot }),
      });
      if (applyFails) {
        await expect(result).rejects.toMatchObject({
          name: "CommittedStateApplyError",
          cause: applyError,
        });
        expect(coordinator.getWriteStopReason()).toBeInstanceOf(
          CommittedStateApplyError,
        );
        expect(stopped).toHaveBeenCalledOnce();
      } else {
        expect((await result).status).toBe("committed");
        expect(coordinator.getWriteStopReason()).toBeUndefined();
        expect(stopped).not.toHaveBeenCalled();
      }
      expect(commit).toHaveBeenCalledOnce();
      expect(apply).toHaveBeenCalledOnce();
      expect(observer).toHaveBeenCalledTimes(3);
      expect(diagnostic).toHaveBeenCalledWith(
        "Mutation pending-state notification failed.",
        observerError,
      );
    } finally {
      diagnostic.mockRestore();
    }
  },
);

it("keeps a shopping UI apply failure terminal without recovery reads or resending its known commit", async () => {
  const h = setup();
  const snapshot = h.read();
  const readDurable = vi.fn(async () => {
    throw new Error("must not reread");
  });
  const commitShoppingMove = vi.fn(async () => ({
    status: "committed" as const,
    read: { snapshot, expectedRoots: {}, consistencyMissing: false },
  }));
  const coordinator = createApplicationMutationCoordinator({
    readCurrent: () => snapshot,
    drain: async () => {},
    readDurable,
    commit: vi.fn(),
    commitShoppingMove,
    apply: () => {
      throw new Error("UI failed");
    },
  });
  const intent: MutationIntent = {
    id: "move:1",
    events: ["event"],
    shoppingMove: {
      version: 1,
      eventName: "event",
      day: "1日目",
      sourceColumn: "candidate",
      targetColumn: "execute",
      requestedIds: ["A"],
      effectiveIds: ["A"],
      hoverId: "__END_OF_LIST__",
      baselineVisits: [],
      baselineItemIds: ["A"],
      itemIds: ["A"],
      baselineExecuteIds: [],
      executeIds: ["A"],
    },
    plan: () => {
      throw new Error("must not replan");
    },
  };
  await expect(coordinator.request(intent)).rejects.toBeInstanceOf(
    CommittedStateApplyError,
  );
  expect(commitShoppingMove).toHaveBeenCalledOnce();
  expect(readDurable).not.toHaveBeenCalled();
  await expect(
    coordinator.request({ ...intent, id: "move:2" }),
  ).rejects.toBeInstanceOf(CommittedStateApplyError);
  expect(commitShoppingMove).toHaveBeenCalledOnce();
});

describe("optional apply lifecycle prototype (source only; not yet executed)", () => {
  const command: NonNullable<MutationIntent["shoppingMove"]> = {
    version: 1,
    eventName: "event",
    day: "1日目",
    sourceColumn: "candidate",
    targetColumn: "execute",
    requestedIds: ["A"],
    effectiveIds: ["A"],
    hoverId: "__END_OF_LIST__",
    baselineVisits: [],
    baselineItemIds: ["A"],
    itemIds: ["A"],
    baselineExecuteIds: [],
    executeIds: ["A"],
  };
  it.each([
    { dedicated: false, observerThrows: false, applyThrows: false },
    { dedicated: true, observerThrows: false, applyThrows: false },
    { dedicated: false, observerThrows: true, applyThrows: false },
    { dedicated: true, observerThrows: true, applyThrows: false },
    { dedicated: false, observerThrows: true, applyThrows: true },
    { dedicated: true, observerThrows: true, applyThrows: true },
  ])(
    "preserves commit/apply/stop order for $dedicated/$observerThrows/$applyThrows",
    async ({ dedicated, observerThrows, applyThrows }) => {
      const snapshot = setup().read();
      const calls: string[] = [];
      const read = { snapshot, expectedRoots: {}, consistencyMissing: false };
      const commit = vi.fn(async () => {
        calls.push("commit");
      });
      const coordinator = createApplicationMutationCoordinator({
        readCurrent: () => snapshot,
        drain: async () => {},
        readDurable: async () => read,
        commit,
        ...(dedicated
          ? {
              commitShoppingMove: async () => {
                calls.push("commit");
                return { status: "committed" as const, read };
              },
            }
          : {}),
        onApplyLifecycle(operationId, phase) {
          calls.push("observe:" + operationId + ":" + phase);
          if (observerThrows) throw new Error("optional observer failed");
        },
        apply() {
          calls.push("apply");
          if (applyThrows) throw new Error("existing UI apply failure");
        },
        onApplyFailure() {
          calls.push("stop");
        },
      });
      const result = coordinator.request({
        id: "actual-request-id",
        events: ["event"],
        ...(dedicated ? { shoppingMove: command } : {}),
        plan: (current) => ({ snapshot: current }),
      });
      if (applyThrows) {
        await expect(result).rejects.toBeInstanceOf(CommittedStateApplyError);
        expect(calls).toEqual([
          "commit",
          "observe:actual-request-id:start",
          "apply",
          "observe:actual-request-id:failure",
          "stop",
        ]);
      } else {
        expect((await result).status).toBe("committed");
        expect(calls).toEqual([
          "commit",
          "observe:actual-request-id:start",
          "apply",
          "observe:actual-request-id:success",
        ]);
      }
    },
  );
});
