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
  return { ...hook, port, commit, durable: () => durable };
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

it.each(["same turn", "pending write", "committed"] as const)(
  "preserves unrelated settings when a rendered patch follows an earlier update (%s)",
  async (timing) => {
    const h = harness();
    const metadata = {
      spreadsheetUrl: "",
      spreadsheetSheetName: "元のシート名",
      lastImportDate: "2026-10-04",
    };
    h.durable().eventMetadata.event = metadata;
    act(() => {
      h.result.current.hydrationSetters.setEventMetadata({ event: metadata });
    });
    const commitFromRender = h.result.current.commitPatch;
    const renderedMetadata = structuredClone(
      h.result.current.values.eventMetadata,
    );
    const save = h.commit.getMockImplementation()!;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.commit.mockImplementationOnce(async (next) => {
      await barrier;
      await save(next);
    });
    act(() => {
      h.result.current.setters.setEventMetadata((previous) => ({
        ...previous,
        event: { ...previous.event, spreadsheetSheetName: "最新のシート名" },
      }));
    });
    if (timing !== "same turn")
      await waitFor(() => expect(h.commit).toHaveBeenCalledOnce());
    if (timing === "committed") {
      await act(async () => {
        release();
        await h.result.current.flush();
      });
    }
    let pending!: Promise<void>;
    act(() => {
      pending = commitFromRender({
        eventMetadata: {
          ...renderedMetadata,
          event: {
            ...renderedMetadata.event,
            spreadsheetUrl: "https://example.com/new",
          },
        },
      });
    });
    await act(async () => {
      release();
      await pending;
      await h.result.current.flush();
    });
    expect(h.durable().eventMetadata.event).toEqual({
      ...metadata,
      spreadsheetSheetName: "最新のシート名",
      spreadsheetUrl: "https://example.com/new",
    });
    expect(h.result.current.raw).toEqual(h.durable());
    expect(h.result.current.confirmations).toEqual([]);
    expect(h.commit).toHaveBeenCalledTimes(2);
  },
);

const repeatedConflict = () =>
  Object.assign(new Error("CAS conflict"), { name: "PersistenceConflict" });

it.each([
  { kind: "CAS conflict", error: repeatedConflict(), attempts: 3 },
  { kind: "write abort", error: new Error("write aborted"), attempts: 1 },
  {
    kind: "quota",
    error: new DOMException("storage full", "QuotaExceededError"),
    attempts: 1,
  },
])(
  "retains accepted purchases, exports and unload protection after $kind; retries latest data",
  async ({ error, attempts }) => {
    const h = harness();
    const original = {
      id: "A",
      circle: "サークル",
      eventDate: "1日目",
      block: "A",
      number: "1",
      title: "新刊",
      price: 500,
      quantity: 1,
      purchaseStatus: "None" as const,
      remarks: "ユーザー登録",
    };
    h.durable().eventLists.event = [original];
    act(() =>
      h.result.current.hydrationSetters.setEventLists({ event: [original] }),
    );
    for (let attempt = 0; attempt < attempts; attempt++)
      h.commit.mockRejectedValueOnce(error);
    act(() =>
      h.result.current.setters.setEventLists((current) => ({
        ...current,
        event: current.event.map((item) => ({
          ...item,
          purchaseStatus: "Purchased",
          price: 900,
          quantity: 2,
        })),
      })),
    );
    await waitFor(() => expect(h.commit).toHaveBeenCalledTimes(attempts));
    await act(() => h.result.current.coordinator.enqueue(() => undefined));
    expect(h.result.current.pendingCount).toBe(1);
    expect(h.result.current.retryableFailures).toHaveLength(1);
    const purchased = { purchaseStatus: "Purchased", price: 900, quantity: 2 };
    expect(h.result.current.values.eventLists.event[0]).toMatchObject(
      purchased,
    );
    expect(
      h.result.current.previewRef.current.eventLists.event[0],
    ).toMatchObject(purchased);
    expect(h.result.current.raw.eventLists.event[0]).toEqual(original);
    expect(h.durable().eventLists.event[0]).toEqual(original);
    const exported = await h.result.current.coordinator.readExportSnapshot();
    expect(exported.eventLists.event[0]).toMatchObject(purchased);
    await expect(h.result.current.flush()).rejects.toThrow("再試行");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    Object.assign(h.durable().eventLists.event[0]!, {
      remarks: "別タブの最新メモ",
    });
    await act(async () => {
      h.result.current.retryPending();
      h.result.current.retryPending();
      await h.result.current.coordinator.enqueue(() => undefined);
    });
    await waitFor(() => expect(h.result.current.pendingCount).toBe(0));
    expect(h.commit).toHaveBeenCalledTimes(attempts + 1);
    expect(h.result.current.values.eventLists.event[0]).toMatchObject({
      ...purchased,
      remarks: "別タブの最新メモ",
    });
    expect(h.result.current.retryableFailures).toHaveLength(0);
    expect(exported.eventLists.event[0]).toMatchObject({
      remarks: "ユーザー登録",
    });
  },
);

it("retains an atomic intent without applying it and completes its original promise only after retry", async () => {
  const h = harness();
  h.commit
    .mockRejectedValueOnce(repeatedConflict())
    .mockRejectedValueOnce(repeatedConflict())
    .mockRejectedValueOnce(repeatedConflict());
  const finished = vi.fn();
  let pending!: Promise<void>;
  act(() => {
    pending = h.result.current.commitPatch({
      dayModes: { event: { "1日目": "execute" } },
    });
    void pending.then(finished);
  });
  await waitFor(() => expect(h.commit).toHaveBeenCalledTimes(3));
  await act(() => h.result.current.coordinator.enqueue(() => undefined));
  expect(h.result.current.pendingCount).toBe(1);
  expect(finished).not.toHaveBeenCalled();
  expect(h.result.current.values.dayModes).toEqual({});
  expect(
    (await h.result.current.coordinator.readExportSnapshot()).dayModes,
  ).toEqual({});
  await act(async () => {
    h.result.current.retryPending();
    await pending;
  });
  expect(finished).toHaveBeenCalledOnce();
  expect(h.result.current.raw.dayModes).toEqual({
    event: { "1日目": "execute" },
  });
});

it.each([
  { error: repeatedConflict(), attempts: 3 },
  { error: new Error("write aborted"), attempts: 1 },
])(
  "renews confirmation from changed durable fields on manual retry after %s",
  async ({ error, attempts }) => {
    const h = harness();
    for (let attempt = 0; attempt < attempts; attempt++)
      h.commit.mockRejectedValueOnce(error);
    act(() =>
      h.result.current.setters.setDayModes({ event: { "1日目": "execute" } }),
    );
    await waitFor(() => expect(h.commit).toHaveBeenCalledTimes(attempts));
    h.durable().dayModes = { event: { "1日目": "focus" } };
    await act(async () => {
      h.result.current.retryPending();
      await h.result.current.coordinator.enqueue(() => undefined);
    });
    await waitFor(() => expect(h.result.current.confirmations).toHaveLength(1));
    expect(h.commit).toHaveBeenCalledTimes(attempts);
    await act(async () => {
      h.result.current.confirm(h.result.current.confirmations[0].token);
      await h.result.current.coordinator.enqueue(() => undefined);
    });
    await waitFor(() => expect(h.result.current.pendingCount).toBe(0));
    expect(h.result.current.raw.dayModes).toEqual({
      event: { "1日目": "execute" },
    });
  },
);

it("can explicitly discard a suspended intent and rejects its original promise without saving", async () => {
  const h = harness();
  h.commit
    .mockRejectedValueOnce(repeatedConflict())
    .mockRejectedValueOnce(repeatedConflict())
    .mockRejectedValueOnce(repeatedConflict());
  let pending!: Promise<void>;
  let cancelled!: Promise<unknown>;
  act(() => {
    pending = h.result.current.commitPatch({
      dayModes: { event: { "1日目": "execute" } },
    });
    cancelled = pending.catch((error: unknown) => error);
  });
  await waitFor(() => expect(h.commit).toHaveBeenCalledTimes(3));
  await act(async () => h.result.current.discardPending());
  expect(await cancelled).toMatchObject({ name: "MutationCancelled" });
  expect(h.result.current.pendingCount).toBe(0);
  expect(h.result.current.isPending()).toBe(false);
  expect(h.result.current.retryableFailures).toHaveLength(0);
  expect(h.result.current.previewRef.current.dayModes).toEqual({});
  expect(h.commit).toHaveBeenCalledTimes(3);
});

it.each([
  { error: repeatedConflict(), attempts: 3 },
  { error: new Error("write aborted"), attempts: 1 },
])(
  "keeps repeatedly failed edits until explicit discard (%s)",
  async ({ error, attempts }) => {
    const h = harness();
    h.commit.mockRejectedValue(error);
    act(() =>
      h.result.current.setters.setDayModes({ event: { "1日目": "execute" } }),
    );
    await waitFor(() => expect(h.commit).toHaveBeenCalledTimes(attempts));
    await act(async () => {
      h.result.current.retryPending();
      await h.result.current.coordinator.enqueue(() => undefined);
    });
    await waitFor(() =>
      expect(h.result.current.retryableFailures).toHaveLength(1),
    );
    expect(h.commit).toHaveBeenCalledTimes(attempts * 2);
    expect(h.result.current.pendingCount).toBe(1);
    expect(h.result.current.values.dayModes).toEqual({
      event: { "1日目": "execute" },
    });
    await act(() => h.result.current.discardPending());
    expect(h.result.current.values.dayModes).toEqual({});
    expect(
      (await h.result.current.coordinator.readExportSnapshot()).dayModes,
    ).toEqual({});
    expect(h.result.current.isPending()).toBe(false);
  },
);

it("expires a suspended edit when its event is replaced and never retries it into the new event", async () => {
  const h = harness();
  h.commit
    .mockRejectedValueOnce(repeatedConflict())
    .mockRejectedValueOnce(repeatedConflict())
    .mockRejectedValueOnce(repeatedConflict());
  act(() =>
    h.result.current.setters.setDayModes({ event: { "1日目": "execute" } }),
  );
  await waitFor(() => expect(h.commit).toHaveBeenCalledTimes(3));
  await act(async () => {
    await h.result.current.request({
      events: ["event"],
      plan: (snapshot) => ({ snapshot, invalidatedEvents: ["event"] }),
    });
  });
  expect(h.result.current.pendingCount).toBe(0);
  expect(h.result.current.retryableFailures).toHaveLength(0);
  expect(h.result.current.values.dayModes).toEqual({});
  await act(() => h.result.current.retryPending());
  expect(h.commit).toHaveBeenCalledTimes(4);
});

it("keeps a newer confirmed edit visible while an older conflicting edit remains suspended", async () => {
  const h = harness();
  h.commit
    .mockRejectedValueOnce(repeatedConflict())
    .mockRejectedValueOnce(repeatedConflict())
    .mockRejectedValueOnce(repeatedConflict());
  act(() =>
    h.result.current.setters.setDayModes({ event: { "1日目": "execute" } }),
  );
  await waitFor(() => expect(h.commit).toHaveBeenCalledTimes(3));
  act(() =>
    h.result.current.setters.setDayModes({ event: { "1日目": "focus" } }),
  );
  await waitFor(() => expect(h.result.current.confirmations).toHaveLength(1));
  await act(async () => {
    h.result.current.confirm(h.result.current.confirmations[0].token);
    await h.result.current.coordinator.enqueue(() => undefined);
  });
  expect(h.result.current.pendingCount).toBe(1);
  expect(h.result.current.values.dayModes).toEqual({
    event: { "1日目": "focus" },
  });
  expect(h.result.current.previewRef.current.dayModes).toEqual({
    event: { "1日目": "focus" },
  });
  expect(
    (await h.result.current.coordinator.readExportSnapshot()).dayModes,
  ).toEqual({ event: { "1日目": "focus" } });
  await act(async () => {
    h.result.current.retryPending();
    await h.result.current.coordinator.enqueue(() => undefined);
  });
  expect(h.result.current.confirmations).toHaveLength(1);
  expect(h.commit).toHaveBeenCalledTimes(4);
  await act(() =>
    h.result.current.cancel(h.result.current.confirmations[0].token),
  );
  expect(h.result.current.values.dayModes).toEqual({
    event: { "1日目": "focus" },
  });
  expect(h.result.current.pendingCount).toBe(0);
});

it.each([
  { error: repeatedConflict(), attempts: 3 },
  { error: new Error("write aborted"), attempts: 1 },
])(
  "retains ordinary command edits and resolves their caller only after retry (%s)",
  async ({ error, attempts }) => {
    const h = harness();
    for (let attempt = 0; attempt < attempts; attempt++)
      h.commit.mockRejectedValueOnce(error);
    let pending!: Promise<PersistenceSnapshot>;
    act(() => {
      pending = h.result.current.request({
        events: ["event"],
        retainOnConflict: true,
        plan: (snapshot) => {
          snapshot.dayModes = { event: { "1日目": "execute" } };
          return { snapshot };
        },
      });
    });
    await waitFor(() => expect(h.commit).toHaveBeenCalledTimes(attempts));
    expect(h.result.current.retryableFailures).toHaveLength(1);
    expect(h.result.current.values.dayModes).toEqual({
      event: { "1日目": "execute" },
    });
    expect(
      (await h.result.current.coordinator.readExportSnapshot()).dayModes,
    ).toEqual({ event: { "1日目": "execute" } });
    expect(h.result.current.raw.dayModes).toEqual({});
    await act(async () => {
      h.result.current.retryPending();
      await pending;
    });
    expect(h.result.current.pendingCount).toBe(0);
    expect(h.result.current.raw.dayModes).toEqual({
      event: { "1日目": "execute" },
    });
  },
);

it("requires reload after a committed edit fails to apply, without offering another save", async () => {
  const h = harness();
  h.result.current.handlers.current.applied = () => {
    throw new Error("render failed");
  };
  act(() =>
    h.result.current.setters.setDayModes({ event: { "1日目": "execute" } }),
  );
  await waitFor(() => expect(h.result.current.requiresReload).toBe(true));
  expect(h.durable().dayModes.event["1日目"]).toBe("execute");
  expect(h.result.current.retryableFailures).toEqual([]);
  expect(h.result.current.pendingCount).toBe(0);
  expect(h.result.current.failure).toContain("保存は完了");
});

it("holds confirmation actions until an asynchronous choice has a current preview token", async () => {
  const h = harness();
  let pending!: Promise<PersistenceSnapshot>;
  act(() => {
    pending = h.result.current.request({
      events: ["event"],
      plan: (snapshot, choices) => {
        const mode = choices?.mode ?? "edit";
        snapshot.dayModes.event = { "1日目": mode };
        return {
          snapshot,
          confirmation: {
            title: "モードを選択",
            details: [],
            comparison: mode,
            choices: [
              {
                id: "mode",
                label: "モード",
                value: mode,
                options: [
                  { value: "edit", label: "編集" },
                  { value: "execute", label: "実行" },
                ],
              },
            ],
          },
        };
      },
    });
  });
  await waitFor(() => expect(h.result.current.confirmations).toHaveLength(1));
  const previous = h.result.current.confirmations[0].token;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(h.port, "readApplicationSnapshot").mockImplementationOnce(
    async () => {
      await barrier;
      return {
        snapshot: structuredClone(h.durable()),
        expectedRoots: {},
        consistencyMissing: false,
      };
    },
  );
  act(() => h.result.current.choose(previous, "mode", "execute"));
  expect(h.result.current.isUpdatingChoices).toBe(true);
  expect(h.commit).not.toHaveBeenCalled();
  await act(async () => {
    release();
    await h.result.current.coordinator.enqueue(() => undefined);
  });
  await waitFor(() => expect(h.result.current.isUpdatingChoices).toBe(false));
  expect(h.result.current.confirmations[0].token).not.toBe(previous);
  expect(h.result.current.confirmations[0].confirmation.choices![0].value).toBe(
    "execute",
  );
  expect(h.commit).not.toHaveBeenCalled();
  await act(async () => {
    h.result.current.confirm(h.result.current.confirmations[0].token);
    await pending;
  });
  expect(h.durable().dayModes.event["1日目"]).toBe("execute");
});
