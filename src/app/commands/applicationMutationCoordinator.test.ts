import { describe, expect, it, vi } from "vitest";
import type { PersistenceSnapshot } from "../ports/PersistenceCommandPort";
import {
  createApplicationMutationCoordinator,
  type MutationIntent,
} from "./applicationMutationCoordinator";

function setup() {
  let durable: PersistenceSnapshot = {
    eventLists: {
      event: [{ id: "A", remarks: "before", purchaseStatus: "None" }],
    },
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
  };
  let current = structuredClone(durable);
  const commit = vi.fn(async (snapshot: PersistenceSnapshot) => {
    durable = structuredClone(snapshot);
  });
  const coordinator = createApplicationMutationCoordinator({
    readCurrent: () => current,
    drain: async () => undefined,
    readDurable: async () => ({
      snapshot: structuredClone(durable),
      expectedRoots: { revision: 1 },
      consistencyMissing: false,
    }),
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
  it("exports coherent durable data including updates from another tab", async () => {
    const saved = snapshot();
    saved.eventMetadata.external = true;
    const coordinator = createApplicationMutationCoordinator({
      readCurrent: snapshot,
      drain: async () => {},
      readDurable: async () => ({
        snapshot: saved,
        expectedRoots: {},
        consistencyMissing: false,
      }),
      commit: async () => {},
      apply: vi.fn(),
    });
    expect(
      (await coordinator.readExportSnapshot()).eventMetadata.external,
    ).toBe(true);
  });
});
