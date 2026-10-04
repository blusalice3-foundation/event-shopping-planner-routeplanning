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
