// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  PersistenceCommandPort,
  PersistenceSnapshot,
} from "../ports/PersistenceCommandPort";
import { createEventConsistency } from "../../types/consistency";
import {
  emptyApplicationSnapshot,
  useApplicationSnapshot,
} from "./useApplicationSnapshot";

function harness() {
  let durable: PersistenceSnapshot = {
    ...emptyApplicationSnapshot(),
    eventLists: { event: [] },
    eventConsistency: { event: createEventConsistency() },
  };
  const commit = vi.fn(async (next: PersistenceSnapshot) => {
    durable = structuredClone(next);
  });
  const port = {
    readApplicationSnapshot: async () => ({
      snapshot: structuredClone(durable),
      expectedRoots: {},
      consistencyMissing: false,
    }),
    commitApplicationSnapshotAtomically: commit,
    bindApplicationSettings: () => () => {},
  } as unknown as PersistenceCommandPort;
  const hook = renderHook(() => useApplicationSnapshot(port, "event", "1日目"));
  act(() => {
    hook.result.current.hydrationSetters.setEventLists({ event: [] });
    hook.result.current.hydrationSetters.setEventConsistency({
      event: createEventConsistency(),
    });
  });
  return { ...hook, commit, durable: () => durable };
}
describe("one accepted application state", () => {
  it("batches synchronous related setters and shows no intermediate state before commit", async () => {
    const h = harness();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.commit.mockImplementationOnce(async () => {
      await barrier;
    });
    act(() => {
      h.result.current.setters.setDayModes({ event: { "1日目": "execute" } });
      h.result.current.setters.setExecuteModeItems({ event: { "1日目": [] } });
      expect(h.result.current.rawRef.current.dayModes).toEqual({});
      expect(h.result.current.isPending()).toBe(true);
    });
    await waitFor(() => expect(h.commit).toHaveBeenCalledOnce());
    expect(h.result.current.raw.dayModes).toEqual({});
    expect(h.result.current.raw.executeModeItems).toEqual({});
    expect(h.commit.mock.calls[0][0]).toMatchObject({
      dayModes: { event: { "1日目": "execute" } },
      executeModeItems: { event: { "1日目": [] } },
    });
    await act(async () => {
      release();
      await h.result.current.flush();
    });
    expect(h.result.current.raw.dayModes).toEqual({
      event: { "1日目": "execute" },
    });
    expect(h.result.current.pendingCount).toBe(0);
  });
  it("keeps accepted state after a failed write and removes the draft preview", async () => {
    const h = harness();
    h.commit.mockRejectedValueOnce(new Error("write aborted"));
    await act(async () => {
      await expect(
        h.result.current.commitPatch({
          dayModes: { event: { "1日目": "execute" } },
        }),
      ).rejects.toThrow("write aborted");
    });
    expect(h.result.current.raw.dayModes).toEqual({});
    expect(h.result.current.previewRef.current.dayModes).toEqual({});
    expect(h.result.current.failure).toBe("write aborted");
    expect(h.result.current.pendingCount).toBe(0);
  });
  it("keeps confirmation pending without occupying the queue and rejects reload flush until answered", async () => {
    const h = harness();
    let request!: Promise<PersistenceSnapshot>;
    act(() => {
      request = h.result.current.request({
        events: ["event"],
        plan: (snapshot) => ({
          snapshot,
          confirmation: { title: "確認", details: [], comparison: "stable" },
        }),
      });
    });
    await waitFor(() => expect(h.result.current.confirmations).toHaveLength(1));
    await expect(h.result.current.flush()).rejects.toThrow("確認");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await act(async () => {
      h.result.current.confirm(h.result.current.confirmations[0].token);
      await request;
    });
    expect(h.result.current.pendingCount).toBe(0);
    expect(h.commit).toHaveBeenCalledOnce();
  });
});

it("exports current memory through the application port even when draining saves fails", async () => {
  const h = harness();
  const drain = vi.fn(async () => {
    throw new Error("save unavailable");
  });
  h.result.current.handlers.current.drain = drain;
  act(() => {
    h.result.current.hydrationSetters.setDayModes({
      event: { "1日目": "execute" },
    });
  });
  const exported = await h.result.current.coordinator.readExportSnapshot();
  expect(exported.dayModes).toEqual({ event: { "1日目": "execute" } });
  expect(h.durable().dayModes).toEqual({});
  expect(drain).not.toHaveBeenCalled();
  expect(h.commit).not.toHaveBeenCalled();
});

it("confirms a same-field conflict from ordinary setters without replacing unrelated settings", async () => {
  const h = harness();
  h.durable().dayModes.event = { "1日目": "edit", "2日目": "execute" };
  act(() => {
    h.result.current.hydrationSetters.setDayModes({
      event: { "1日目": "edit", "2日目": "execute" },
    });
  });
  // Another tab changes the same day after the render used by the setter.
  h.durable().dayModes.event["1日目"] = "focus";
  act(() => {
    h.result.current.setters.setDayModes((current) => ({
      event: { ...current.event, "1日目": "execute" },
    }));
  });
  await waitFor(() => expect(h.result.current.confirmations).toHaveLength(1));
  expect(h.commit).not.toHaveBeenCalled();
  expect(h.result.current.raw.dayModes.event["1日目"]).toBe("edit");
  expect(h.result.current.confirmations[0].confirmation.title).toBe(
    "競合する更新を確認",
  );
  h.durable().dayModes.event["2日目"] = "edit";
  await act(async () => {
    h.result.current.confirm(h.result.current.confirmations[0].token);
    await h.result.current.coordinator.enqueue(() => undefined);
  });
  await waitFor(() => expect(h.result.current.pendingCount).toBe(0));
  expect(h.result.current.raw.dayModes.event).toEqual({
    "1日目": "execute",
    "2日目": "edit",
  });
});
