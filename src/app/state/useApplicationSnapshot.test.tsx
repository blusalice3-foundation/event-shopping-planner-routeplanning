// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  PersistenceCommandPort,
  PersistenceSnapshot,
} from "../ports/PersistenceCommandPort";
import { createEventConsistency } from "../../types/consistency";
import {
  planEventDelete,
  planEventRename,
  planEventRestore,
} from "../../features/consistency/domain/eventMutations";
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

it("expires a suspended atomic intent when its event is replaced and never retries it into the new event", async () => {
  const h = harness();
  h.commit
    .mockRejectedValueOnce(repeatedConflict())
    .mockRejectedValueOnce(repeatedConflict())
    .mockRejectedValueOnce(repeatedConflict());
  act(
    () =>
      void h.result.current
        .commitPatch({ dayModes: { event: { "1日目": "execute" } } })
        .catch(() => {}),
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

it("retains successive accepted edits in order and never saves ahead of a failed edit", async () => {
  const h = harness();
  h.commit
    .mockRejectedValueOnce(repeatedConflict())
    .mockRejectedValueOnce(repeatedConflict())
    .mockRejectedValueOnce(repeatedConflict());
  act(() =>
    h.result.current.setters.setDayModes({ event: { "1日目": "execute" } }),
  );
  await waitFor(() =>
    expect(h.result.current.retryableFailures).toHaveLength(1),
  );
  act(() =>
    h.result.current.setters.setDayModes({ event: { "1日目": "focus" } }),
  );
  await waitFor(() =>
    expect(h.result.current.retryableFailures).toHaveLength(2),
  );
  expect(h.result.current.pendingCount).toBe(2);
  expect(h.commit).toHaveBeenCalledTimes(3);
  expect(h.durable().dayModes).toEqual({});
  expect(h.result.current.confirmations).toEqual([]);
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
  await waitFor(() => expect(h.result.current.pendingCount).toBe(0));
  expect(h.commit).toHaveBeenCalledTimes(5);
  expect(h.commit.mock.calls[3][0].dayModes).toEqual({
    event: { "1日目": "execute" },
  });
  expect(h.commit.mock.calls[4][0].dayModes).toEqual({
    event: { "1日目": "focus" },
  });
  expect(h.result.current.values.dayModes).toEqual({
    event: { "1日目": "focus" },
  });
  expect(h.durable().dayModes).toEqual({ event: { "1日目": "focus" } });
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

const purchase = {
  id: "purchase",
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
const acceptedPurchase = {
  ...purchase,
  purchaseStatus: "Purchased" as const,
  price: 900,
  quantity: 2,
};
const lifecyclePlans = {
  rename: (snapshot: PersistenceSnapshot) =>
    planEventRename(snapshot, "event", "renamed"),
  delete: (snapshot: PersistenceSnapshot) => planEventDelete(snapshot, "event"),
  restore: (snapshot: PersistenceSnapshot) =>
    planEventRestore(
      snapshot,
      {
        ...emptyApplicationSnapshot(),
        eventLists: { event: [purchase] },
        eventConsistency: { event: createEventConsistency() },
      },
      "event",
      "event",
    ),
};

it.each(
  (["setter", "command"] as const).flatMap((origin) =>
    (["abort", "quota", "conflicts"] as const).flatMap((failure) =>
      (["rename", "delete", "restore"] as const).map((operation) => ({
        origin,
        failure,
        operation,
      })),
    ),
  ),
)(
  "preserves a failed $origin purchase after $failure when $operation is confirmed",
  async ({ origin, failure, operation }) => {
    const h = harness();
    h.durable().eventLists.event = [purchase];
    act(() =>
      h.result.current.hydrationSetters.setEventLists({ event: [purchase] }),
    );
    const attempts = failure === "conflicts" ? 3 : 1;
    const error =
      failure === "conflicts"
        ? repeatedConflict()
        : new DOMException(
            "購入記録の保存失敗",
            failure === "quota" ? "QuotaExceededError" : "AbortError",
          );
    for (let i = 0; i < attempts; i++) h.commit.mockRejectedValueOnce(error);
    act(() => {
      if (origin === "setter")
        h.result.current.setters.setEventLists({ event: [acceptedPurchase] });
      else
        void h.result.current
          .request({
            events: ["event"],
            retainOnConflict: true,
            plan: (snapshot) => {
              snapshot.eventLists.event = [acceptedPurchase];
              return { snapshot };
            },
          })
          .catch(() => {});
    });
    await waitFor(() =>
      expect(h.result.current.retryableFailures).toHaveLength(1),
    );
    expect(h.commit).toHaveBeenCalledTimes(attempts);
    const purchaseId = h.result.current.retryableFailures[0];
    let outcome!: Promise<unknown>;
    act(() => {
      outcome = h.result.current
        .request({
          events: ["event"],
          plan: lifecyclePlans[operation],
        })
        .catch((error: unknown) => error);
    });
    await waitFor(() => expect(h.result.current.confirmations).toHaveLength(1));
    const preview = h.result.current.confirmations[0];
    if (operation !== "rename") {
      expect(JSON.stringify(preview.confirmation.comparison)).toContain(
        '"price":900',
      );
      expect(preview.confirmation.details.join("\n")).toContain(
        '"purchaseStatus": "Purchased"',
      );
      expect(preview.confirmation.details.join("\n")).toContain(
        '"quantity": 2',
      );
    }
    await act(async () => {
      h.result.current.confirm(preview.token);
      expect(await outcome).toMatchObject({ name: "PendingAcceptedMutation" });
    });
    expect(h.commit).toHaveBeenCalledTimes(attempts);
    expect(h.result.current.retryableFailures).toEqual([purchaseId]);
    expect(h.result.current.pendingCount).toBe(1);
    expect(h.result.current.coordinator.generation("event")).toBe(0);
    expect(h.result.current.raw.eventLists).toEqual({ event: [purchase] });
    expect(h.durable().eventLists).toEqual({ event: [purchase] });
    expect(h.result.current.values.eventLists.event[0]).toEqual(
      acceptedPurchase,
    );
    expect(
      (await h.result.current.coordinator.readExportSnapshot()).eventLists
        .event[0],
    ).toEqual(acceptedPurchase);
    await expect(h.result.current.flush()).rejects.toThrow("再試行");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    h.durable().eventLists.other = [];
    h.durable().eventConsistency.other = createEventConsistency();
    h.durable().eventMetadata.other = {
      spreadsheetSheetName: "",
      lastImportDate: "",
      spreadsheetUrl: "https://example.com/other",
    };
    await act(async () => {
      h.result.current.retryPending();
      await h.result.current.coordinator.enqueue(() => undefined);
    });
    await waitFor(() => expect(h.result.current.pendingCount).toBe(0));
    expect(h.durable().eventLists.event[0]).toEqual(acceptedPurchase);
    let completed!: Promise<PersistenceSnapshot>;
    act(() => {
      completed = h.result.current.request({
        events: ["event"],
        plan: lifecyclePlans[operation],
      });
    });
    await waitFor(() => expect(h.result.current.confirmations).toHaveLength(1));
    await act(async () => {
      h.result.current.confirm(h.result.current.confirmations[0].token);
      await completed;
    });
    expect(h.result.current.pendingCount).toBe(0);
    expect(h.result.current.coordinator.generation("event")).toBe(1);
    expect(h.durable().eventMetadata.other).toEqual({
      spreadsheetSheetName: "",
      lastImportDate: "",
      spreadsheetUrl: "https://example.com/other",
    });
    if (operation === "rename")
      expect(h.durable().eventLists).toEqual({
        renamed: [acceptedPurchase],
        other: [],
      });
    if (operation === "delete")
      expect(h.durable().eventLists).toEqual({ other: [] });
    if (operation === "restore")
      expect(h.durable().eventLists).toEqual({ event: [purchase], other: [] });
    h.unmount();
  },
);

async function holdPurchase() {
  const h = harness();
  h.durable().eventLists.event = [purchase];
  act(() =>
    h.result.current.hydrationSetters.setEventLists({ event: [purchase] }),
  );
  h.commit.mockRejectedValueOnce(new Error("購入記録の保存失敗"));
  act(() =>
    h.result.current.setters.setEventLists({ event: [acceptedPurchase] }),
  );
  await waitFor(() =>
    expect(h.result.current.retryableFailures).toHaveLength(1),
  );
  return h;
}

it.each(["same event", "other event"])(
  "blocks an unconfirmed atomic write in %s while an accepted purchase is unsaved",
  async (target) => {
    const h = await holdPurchase();
    const name = target === "same event" ? "event" : "other";
    if (name === "other") {
      h.durable().eventLists.other = [];
      h.durable().eventConsistency.other = createEventConsistency();
    }
    await act(async () => {
      await expect(
        h.result.current.commitPatch({
          dayModes: { [name]: { "1日目": "execute" } },
        }),
      ).rejects.toMatchObject({ name: "PendingAcceptedMutation" });
    });
    expect(h.commit).toHaveBeenCalledOnce();
    expect(h.durable().dayModes).toEqual({});
    expect(h.result.current.values.eventLists.event[0]).toEqual(
      acceptedPurchase,
    );
    expect(h.result.current.retryableFailures).toHaveLength(1);
    expect(h.result.current.pendingCount).toBe(1);
    await act(() => h.result.current.discardPending());
    expect(h.result.current.values.eventLists.event[0]).toEqual(purchase);
    await act(async () => {
      await h.result.current.commitPatch({
        dayModes: { [name]: { "1日目": "execute" } },
      });
    });
    expect(h.durable().eventLists.event[0]).toEqual(purchase);
    expect(h.durable().dayModes[name]).toEqual({ "1日目": "execute" });
    h.unmount();
  },
);

it("renews restore current values after another unsaved purchase and preserves them on cancellation (R39)", async () => {
  const h = await holdPurchase();
  act(() => {
    void h.result.current
      .request({ events: ["event"], plan: lifecyclePlans.restore })
      .catch(() => {});
  });
  await waitFor(() => expect(h.result.current.confirmations).toHaveLength(1));
  const token = h.result.current.confirmations[0].token;
  const newest = {
    ...acceptedPurchase,
    price: 1000,
    quantity: 3,
    remarks: "エラーが発生しました",
  };
  act(() => h.result.current.setters.setEventLists({ event: [newest] }));
  await waitFor(() =>
    expect(h.result.current.retryableFailures).toHaveLength(2),
  );
  await act(async () => {
    h.result.current.confirm(token);
    await h.result.current.coordinator.enqueue(() => undefined);
  });
  expect(h.result.current.confirmations).toHaveLength(1);
  const renewed = h.result.current.confirmations[0];
  expect(renewed.token).not.toBe(token);
  expect(JSON.stringify(renewed.confirmation.comparison)).toContain(
    '"price":1000',
  );
  expect(renewed.confirmation.details.join("\n")).toContain(
    "エラーが発生しました",
  );
  expect(h.commit).toHaveBeenCalledOnce();
  await act(() => h.result.current.cancel(renewed.token));
  expect(h.result.current.pendingCount).toBe(2);
  expect(h.result.current.values.eventLists.event[0]).toEqual(newest);
  expect(
    (await h.result.current.coordinator.readExportSnapshot()).eventLists
      .event[0],
  ).toEqual(newest);
  await act(async () => {
    h.result.current.retryPending();
    await h.result.current.coordinator.enqueue(() => undefined);
  });
  await waitFor(() => expect(h.result.current.pendingCount).toBe(0));
  expect(h.durable().eventLists.event[0]).toEqual(newest);
  expect(h.result.current.coordinator.generation("event")).toBe(0);
  h.unmount();
});

it("renews a restore confirmation after explicit discard removes its unsaved current values", async () => {
  const h = await holdPurchase();
  let completed!: Promise<PersistenceSnapshot>;
  act(() => {
    completed = h.result.current.request({
      events: ["event"],
      plan: lifecyclePlans.restore,
    });
  });
  await waitFor(() => expect(h.result.current.confirmations).toHaveLength(1));
  const token = h.result.current.confirmations[0].token;
  await act(() => h.result.current.discardPending());
  await act(async () => {
    h.result.current.confirm(token);
    await h.result.current.coordinator.enqueue(() => undefined);
  });
  const renewed = h.result.current.confirmations[0];
  expect(renewed.token).not.toBe(token);
  expect(h.commit).toHaveBeenCalledOnce();
  expect(JSON.stringify(renewed.confirmation.comparison)).toContain(
    '"price":500',
  );
  await act(async () => {
    h.result.current.confirm(renewed.token);
    await completed;
  });
  expect(h.result.current.pendingCount).toBe(0);
  expect(h.durable().eventLists.event[0]).toEqual(purchase);
  h.unmount();
});

it.each([false, true])(
  "queues a same-turn setter ahead of lifecycle preview when its save fails=%s",
  async (fails) => {
    const h = harness();
    h.durable().eventLists.event = [purchase];
    act(() =>
      h.result.current.hydrationSetters.setEventLists({ event: [purchase] }),
    );
    if (fails) h.commit.mockRejectedValueOnce(new Error("購入記録の保存失敗"));
    act(() => {
      h.result.current.setters.setEventLists({ event: [acceptedPurchase] });
      void h.result.current
        .request({ events: ["event"], plan: lifecyclePlans.restore })
        .catch(() => {});
    });
    await waitFor(() => expect(h.result.current.confirmations).toHaveLength(1));
    expect(h.commit).toHaveBeenCalledOnce();
    expect(
      JSON.stringify(h.result.current.confirmations[0].confirmation.comparison),
    ).toContain('"price":900');
    await act(() =>
      h.result.current.cancel(h.result.current.confirmations[0].token),
    );
    expect(h.result.current.values.eventLists.event[0]).toEqual(
      acceptedPurchase,
    );
    expect(h.result.current.pendingCount).toBe(fails ? 1 : 0);
    if (fails) await act(() => h.result.current.discardPending());
    h.unmount();
  },
);

it.each([
  "success",
  "renewed review",
  "failure",
  "cancel",
  "cancel and read failure",
])(
  "keeps confirmation busy through the durable read and settles correctly on %s",
  async (outcome) => {
    const h = harness();
    let pending!: Promise<PersistenceSnapshot>;
    let rejection: unknown;
    act(() => {
      pending = h.result.current.request({
        events: ["event"],
        plan: (snapshot) => {
          const before = structuredClone(snapshot.dayModes);
          snapshot.dayModes.event = { "1日目": "execute" };
          return {
            snapshot,
            confirmation: {
              title: "モードを確認",
              details: [],
              comparison: before,
            },
          };
        },
      });
      void pending.catch((error) => {
        rejection = error;
      });
    });
    await waitFor(() => expect(h.result.current.confirmations).toHaveLength(1));
    const token = h.result.current.confirmations[0].token;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(h.port, "readApplicationSnapshot").mockImplementationOnce(
      async () => {
        entered();
        await gate;
        if (outcome === "cancel and read failure")
          throw new Error("遅れて届いた読込失敗");
        return {
          snapshot: structuredClone(h.durable()),
          expectedRoots: {},
          consistencyMissing: false,
        };
      },
    );
    await act(async () => {
      h.result.current.confirm(token);
      await waiting;
    });
    expect(h.result.current.isConfirmationBusy).toBe(true);
    expect(h.commit).not.toHaveBeenCalled();
    if (outcome === "renewed review")
      h.durable().dayModes.event = { "1日目": "edit" };
    if (outcome === "failure")
      h.commit.mockRejectedValueOnce(new Error("保存失敗"));
    if (outcome.startsWith("cancel")) act(() => h.result.current.cancel(token));
    await act(async () => {
      release();
      await h.result.current.coordinator.enqueue(() => undefined);
    });
    await waitFor(() =>
      expect(h.result.current.isConfirmationBusy).toBe(false),
    );
    if (outcome === "success") {
      expect(h.commit).toHaveBeenCalledOnce();
      expect(h.durable().dayModes.event).toEqual({ "1日目": "execute" });
      expect(h.result.current.confirmations).toHaveLength(0);
    } else if (outcome === "renewed review") {
      expect(h.commit).not.toHaveBeenCalled();
      expect(h.result.current.confirmations[0].token).not.toBe(token);
      act(() =>
        h.result.current.cancel(h.result.current.confirmations[0].token),
      );
    } else if (outcome === "failure") {
      expect(rejection).toMatchObject({ message: "保存失敗" });
      expect(h.durable().dayModes).toEqual({});
    } else {
      expect(h.commit).not.toHaveBeenCalled();
      expect(rejection).toMatchObject({ name: "MutationCancelled" });
      expect(h.result.current.confirmations).toHaveLength(0);
      expect(h.result.current.failure).toBeNull();
      expect(h.durable().dayModes).toEqual({});
    }
    expect(h.result.current.pendingCount).toBe(0);
    h.unmount();
  },
);

function mapEditHarness() {
  const h = harness();
  const map = {
    maxRow: 6,
    maxCol: 6,
    cells: [],
    mergedCells: [],
    blocks: [
      {
        name: "A",
        startRow: 1,
        startCol: 1,
        endRow: 5,
        endCol: 5,
        numberCells: [{ row: 2, col: 2, value: 1 }],
      },
    ],
  };
  const initial = {
    eventLists: {
      event: [purchase],
      other: [{ ...purchase, remarks: "別イベント" }],
    },
    mapData: {
      event: { "1日目マップ": map, "１日目マップ": structuredClone(map) },
    },
    eventConsistency: {
      event: createEventConsistency(),
      other: createEventConsistency(),
    },
  };
  Object.assign(h.durable(), initial);
  act(() => {
    h.result.current.hydrationSetters.setEventLists(
      structuredClone(initial.eventLists),
    );
    h.result.current.hydrationSetters.setMapData(
      structuredClone(initial.mapData),
    );
    h.result.current.hydrationSetters.setEventConsistency(
      structuredClone(initial.eventConsistency),
    );
  });
  const edited = structuredClone(initial.mapData);
  edited.event["1日目マップ"].blocks[0].name = "Ａ";
  return { ...h, edited };
}

describe("expired map edits adopt durable removals (R28/R37)", () => {
  for (const timing of [
    "before request",
    "confirmation",
    "CAS retry",
  ] as const) {
    it.each(["map container", "selected map", "event"] as const)(
      timing + ": never recreates a removed %s or another map",
      async (removed) => {
        const h = mapEditHarness();
        const remove = () => {
          if (removed === "event") {
            for (const store of Object.values(h.durable())) delete store.event;
          } else if (removed === "map container")
            delete h.durable().mapData.event;
          else delete h.durable().mapData.event["1日目マップ"];
          (h.durable().eventLists.other[0] as typeof purchase).remarks =
            "別タブの最新メモ";
        };
        if (timing === "before request") remove();
        act(() => h.result.current.setters.setMapData(h.edited));
        if (timing !== "before request") {
          await waitFor(() =>
            expect(h.result.current.confirmations).toHaveLength(1),
          );
          if (timing === "CAS retry")
            h.commit.mockImplementationOnce(async () => {
              remove();
              throw repeatedConflict();
            });
          else remove();
          await act(async () => {
            h.result.current.confirm(h.result.current.confirmations[0].token);
            await h.result.current.coordinator.enqueue(() => undefined);
          });
        }
        await waitFor(() =>
          expect(h.result.current.failure).toContain(
            "編集対象が削除されています",
          ),
        );
        expect(h.commit).toHaveBeenCalledTimes(timing === "CAS retry" ? 1 : 0);
        expect(h.result.current.confirmations).toEqual([]);
        expect(h.result.current.retryableFailures).toEqual([]);
        expect(h.result.current.pendingCount).toBe(0);
        expect(h.result.current.isPending()).toBe(false);
        expect(h.result.current.raw).toEqual(h.durable());
        expect(h.result.current.previewRef.current.mapData).toEqual(
          h.durable().mapData,
        );
        expect(await h.result.current.coordinator.readExportSnapshot()).toEqual(
          h.durable(),
        );
        expect(h.result.current.coordinator.generation("event")).toBe(1);
        expect(h.result.current.coordinator.generation("other")).toBe(0);
        if (removed === "selected map")
          expect(Object.keys(h.durable().mapData.event)).toEqual([
            "１日目マップ",
          ]);
        else expect(h.durable().mapData.event).toBeUndefined();
        h.unmount();
      },
    );
  }
  it.each(["before request", "confirmation"] as const)(
    "rejects the first hall definition for a removed map (%s)",
    async (timing) => {
      const h = mapEditHarness();
      let outcome!: Promise<unknown>;
      if (timing === "before request")
        delete h.durable().mapData.event["1日目マップ"];
      act(() => {
        outcome = h.result.current
          .commitPatch({
            hallDefinitions: {
              event: {
                "1日目マップ": [
                  {
                    id: "hall",
                    name: "新規ホール",
                    vertices: [
                      { row: 1, col: 1 },
                      { row: 1, col: 5 },
                      { row: 5, col: 1 },
                    ],
                  },
                ],
              },
            },
          })
          .catch((error: unknown) => error);
      });
      if (timing === "confirmation") {
        await waitFor(() =>
          expect(h.result.current.confirmations).toHaveLength(1),
        );
        delete h.durable().mapData.event["1日目マップ"];
        await act(async () => {
          h.result.current.confirm(h.result.current.confirmations[0].token);
          await h.result.current.coordinator.enqueue(() => undefined);
        });
      }
      await act(async () => {
        expect(await outcome).toMatchObject({ name: "MutationTargetMissing" });
      });
      expect(h.commit).not.toHaveBeenCalled();
      expect(h.result.current.raw).toEqual(h.durable());
      expect(h.durable().hallDefinitions).toEqual({});
      expect(h.result.current.pendingCount).toBe(0);
      h.unmount();
    },
  );
  it("expires the removed event's other confirmations and preserves another event's review", async () => {
    const h = mapEditHarness();
    act(() => h.result.current.setters.setMapData(h.edited));
    await waitFor(() => expect(h.result.current.confirmations).toHaveLength(1));
    const token = h.result.current.confirmations[0].token;
    for (const event of ["event", "other"]) {
      act(() => {
        void h.result.current
          .request({
            events: [event],
            plan: (snapshot) => ({
              snapshot,
              confirmation: { title: event, details: [], comparison: event },
            }),
          })
          .catch(() => {});
      });
    }
    await waitFor(() => expect(h.result.current.confirmations).toHaveLength(3));
    delete h.durable().mapData.event;
    await act(async () => {
      h.result.current.confirm(token);
      await h.result.current.coordinator.enqueue(() => undefined);
    });
    expect(
      h.result.current.confirmations.map((entry) => entry.confirmation.title),
    ).toEqual(["other"]);
    expect(h.result.current.pendingCount).toBe(1);
    expect(h.commit).not.toHaveBeenCalled();
    await act(() =>
      h.result.current.cancel(h.result.current.confirmations[0].token),
    );
    h.unmount();
  });
});

it("keeps a confirmed day merge out of accepted state after a standalone mode write fails", async () => {
  const h = harness();
  const modes = { event: { "1日目": "edit", " 1日目　": "execute" } } as const;
  h.durable().dayModes = structuredClone(modes);
  act(() =>
    h.result.current.hydrationSetters.setDayModes(structuredClone(modes)),
  );
  h.commit.mockRejectedValueOnce(new Error("day merge write aborted"));
  act(() =>
    h.result.current.setters.setDayModes({
      event: { "1日目": "execute", " 1日目　": "execute" },
    }),
  );
  await waitFor(() => expect(h.result.current.confirmations).toHaveLength(1));
  expect(h.commit).not.toHaveBeenCalled();
  await act(async () => {
    h.result.current.confirm(h.result.current.confirmations[0].token);
    await h.result.current.coordinator.enqueue(() => undefined);
  });
  await waitFor(() =>
    expect(h.result.current.retryableFailures).toHaveLength(1),
  );
  expect(h.result.current.raw.dayModes).toEqual(modes);
  expect(h.result.current.values.dayModes).toEqual(modes);
  expect(
    (await h.result.current.coordinator.readExportSnapshot()).dayModes,
  ).toEqual(modes);
  expect(h.durable().dayModes).toEqual(modes);
  act(() => h.result.current.discardPending());
  h.unmount();
});
it("still adopts another tab changes when a setter returns unchanged values", async () => {
  const h = harness();
  const metadata = {
    event: {
      spreadsheetUrl: "remote",
      spreadsheetSheetName: "シート",
      lastImportDate: "2026-10-06",
    },
  };
  h.durable().eventMetadata = structuredClone(metadata);
  await act(async () => {
    h.result.current.setters.setDayModes((current) => current);
    await h.result.current.flush();
  });
  expect(h.result.current.raw.eventMetadata).toEqual(metadata);
  expect(h.result.current.isPending()).toBe(false);
});

const memoTestItem = {
  id: "memo-item",
  circle: "ユーザー登録",
  eventDate: "1日目",
  block: "A",
  number: "1",
  title: "新刊",
  price: 500,
  quantity: 1,
  purchaseStatus: "None" as const,
  remarks: "",
};

function memoHarness() {
  const h = harness();
  h.durable().eventLists.event = [memoTestItem];
  act(() =>
    h.result.current.hydrationSetters.setEventLists({ event: [memoTestItem] }),
  );
  const writeMemo = (remarks: string) => {
    act(() =>
      h.result.current.setters.setEventLists((current) => ({
        ...current,
        event: current.event.map((item) => ({ ...item, remarks })),
      })),
    );
  };
  return { ...h, writeMemo };
}

describe("accepted memo input and batched saving", () => {
  it("keeps newer input visible when an earlier save finishes", async () => {
    const h = memoHarness();
    const originalCommit = h.commit.getMockImplementation()!;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.commit.mockImplementationOnce(async (snapshot) => {
      await barrier;
      await originalCommit(snapshot);
    });
    h.writeMemo("a");
    act(() => h.result.current.flushDraft());
    await waitFor(() => expect(h.commit).toHaveBeenCalledTimes(1));
    h.writeMemo("ab");
    expect(h.result.current.values.eventLists.event[0].remarks).toBe("ab");
    await act(async () => {
      release();
      await h.result.current.coordinator.enqueue(() => undefined);
    });
    expect(h.result.current.raw.eventLists.event[0].remarks).toBe("a");
    expect(h.result.current.values.eventLists.event[0].remarks).toBe("ab");
    await act(async () => h.result.current.flush());
    expect(h.durable().eventLists.event[0]).toMatchObject({ remarks: "ab" });
    h.unmount();
  });

  it("collects successive input into one save while keeping it visible and guarded", async () => {
    vi.useFakeTimers();
    const h = memoHarness();
    try {
      for (const value of ["a", "ab", "abc"]) {
        h.writeMemo(value);
        await act(async () => vi.advanceTimersByTimeAsync(40));
      }
      expect(h.commit).not.toHaveBeenCalled();
      expect(h.result.current.values.eventLists.event[0].remarks).toBe("abc");
      expect(h.result.current.isPending()).toBe(true);
      expect(h.result.current.pendingCount).toBe(1);
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
      const exported = await h.result.current.coordinator.readExportSnapshot();
      expect(exported.eventLists.event[0]).toMatchObject({ remarks: "abc" });
      await act(async () => vi.advanceTimersByTimeAsync(300));
      expect(h.commit).toHaveBeenCalledTimes(1);
      expect(h.durable().eventLists.event[0]).toMatchObject({ remarks: "abc" });
      expect(h.result.current.isPending()).toBe(false);
    } finally {
      h.unmount();
      vi.useRealTimers();
    }
  });

  it("saves during continuous input without waiting indefinitely", async () => {
    vi.useFakeTimers();
    const h = memoHarness();
    try {
      for (const value of ["a", "ab", "abc", "abcd"]) {
        h.writeMemo(value);
        await act(async () => vi.advanceTimersByTimeAsync(250));
      }
      expect(h.commit).toHaveBeenCalledTimes(1);
      expect(h.durable().eventLists.event[0]).toMatchObject({
        remarks: "abcd",
      });
    } finally {
      h.unmount();
      vi.useRealTimers();
    }
  });

  it("flushes a memo on focus change and preserves a simultaneous purchase", async () => {
    const h = memoHarness();
    h.writeMemo("最新のメモ");
    act(() => document.dispatchEvent(new Event("focusout")));
    await act(async () =>
      h.result.current.coordinator.enqueue(() => undefined),
    );
    expect(h.durable().eventLists.event[0]).toMatchObject({
      remarks: "最新のメモ",
    });
    h.writeMemo("次のメモ");
    act(() =>
      h.result.current.setters.setEventLists((current) => ({
        ...current,
        event: current.event.map((item) => ({
          ...item,
          purchaseStatus: "Purchased",
        })),
      })),
    );
    await act(async () => h.result.current.flush());
    expect(h.durable().eventLists.event[0]).toMatchObject({
      remarks: "次のメモ",
      purchaseStatus: "Purchased",
    });
    h.unmount();
  });

  it("submits memo input before an unrelated multi-store proposal", async () => {
    const h = memoHarness();
    h.writeMemo("保存するメモ");
    act(() => {
      h.result.current.setters.setDayModes({ event: { "1日目": "execute" } });
      h.result.current.setters.setExecuteModeItems({
        event: { "1日目": ["memo-item"] },
      });
    });
    expect(h.result.current.raw.dayModes).toEqual({});
    expect(h.result.current.values.eventLists.event[0].remarks).toBe(
      "保存するメモ",
    );
    await act(async () => h.result.current.flush());
    expect(h.commit).toHaveBeenCalledTimes(2);
    expect(h.commit.mock.calls[0][0].dayModes).toEqual({});
    expect(h.durable().dayModes).toEqual({ event: { "1日目": "execute" } });
    h.unmount();
  });

  it("retains a failed memo save for export and retry", async () => {
    const h = memoHarness();
    h.commit.mockRejectedValueOnce(new Error("save aborted"));
    h.writeMemo("再試行するメモ");
    act(() => h.result.current.flushDraft());
    await waitFor(() =>
      expect(h.result.current.retryableFailures).toHaveLength(1),
    );
    expect(h.result.current.values.eventLists.event[0].remarks).toBe(
      "再試行するメモ",
    );
    expect(h.durable().eventLists.event[0]).toMatchObject({ remarks: "" });
    const exported = await h.result.current.coordinator.readExportSnapshot();
    expect(exported.eventLists.event[0]).toMatchObject({
      remarks: "再試行するメモ",
    });
    await act(async () => {
      h.result.current.retryPending();
      await h.result.current.flush();
    });
    expect(h.durable().eventLists.event[0]).toMatchObject({
      remarks: "再試行するメモ",
    });
    h.unmount();
  });
});

it("keeps targeted field edits and other item references through a failed save and retry", async () => {
  const h = harness();
  const first = { ...purchase };
  const untouched = { ...purchase, id: "B" };
  const past = [{ ...purchase, id: "past" }];
  h.durable().eventLists = { event: [first, untouched], past };
  h.durable().eventConsistency.past = createEventConsistency();
  act(() => {
    h.result.current.hydrationSetters.setEventLists({
      event: [first, untouched],
      past,
    });
    h.result.current.hydrationSetters.setEventConsistency(
      h.durable().eventConsistency,
    );
  });
  const before = h.result.current.previewRef.current.eventLists;
  h.commit.mockRejectedValueOnce(new Error("購入記録の保存失敗"));
  act(() => {
    h.result.current.updateItemFields({
      eventName: "event",
      itemId: first.id,
      baseline: first,
      changes: {
        quantity: 7,
        purchaseStatus: "Purchased",
        remarks: "ユーザー登録",
      },
    });
    expect(h.result.current.previewRef.current.eventLists.past).toBe(
      before.past,
    );
    expect(h.result.current.previewRef.current.eventLists.event[1]).toBe(
      before.event[1],
    );
  });
  await waitFor(() =>
    expect(h.result.current.retryableFailures).toHaveLength(1),
  );
  expect(h.result.current.pendingItemIds).toEqual([first.id]);
  expect(h.result.current.values.eventLists.event[0]).toMatchObject({
    quantity: 7,
    purchaseStatus: "Purchased",
    remarks: "ユーザー登録",
  });
  expect(h.durable().eventLists.event[0]).toMatchObject({
    purchaseStatus: "None",
  });
  await act(async () => {
    h.result.current.retryPending();
    await h.result.current.coordinator.enqueue(() => undefined);
  });
  await waitFor(() => expect(h.result.current.pendingCount).toBe(0));
  expect(h.durable().eventLists.event[0]).toMatchObject({
    quantity: 7,
    purchaseStatus: "Purchased",
    remarks: "ユーザー登録",
  });
  h.unmount();
});

it("normalizes limited quantities before publishing or saving a direct field command", async () => {
  const h = harness();
  const item = {
    ...purchase,
    purchaseStatus: "LimitedPurchase" as const,
    quantity: 5,
    limitedPurchasedQuantity: 4,
  };
  h.durable().eventLists.event = [item];
  act(() => h.result.current.hydrationSetters.setEventLists({ event: [item] }));
  act(() => {
    h.result.current.updateItemFields({
      eventName: "event",
      itemId: item.id,
      baseline: item,
      changes: { quantity: 2 },
    });
    expect(
      h.result.current.previewRef.current.eventLists.event[0],
    ).toMatchObject({ quantity: 2, purchaseStatus: "LimitedPurchase" });
  });
  expect(h.result.current.values.eventLists.event[0]).toMatchObject({
    quantity: 2,
    purchaseStatus: "LimitedPurchase",
  });
  expect(h.result.current.values.eventLists.event[0]).not.toHaveProperty(
    "limitedPurchasedQuantity",
  );
  await act(async () => h.result.current.flush());
  expect(h.durable().eventLists.event[0]).toMatchObject({
    quantity: 2,
    purchaseStatus: "LimitedPurchase",
  });
  h.unmount();
});

it("queues confirmed remarks immediately and preserves accepted references on acknowledgement", async () => {
  const h = harness();
  const item = { ...purchase };
  const other = { ...purchase, id: "unrelated" };
  h.durable().eventLists.event = [item, other];
  act(() =>
    h.result.current.hydrationSetters.setEventLists({ event: [item, other] }),
  );
  const untouched = h.result.current.values.eventLists.event[1];
  act(() => {
    h.result.current.updateItemFields({
      eventName: "event",
      itemId: item.id,
      baseline: item,
      changes: { purchaseStatus: "SoldOut" },
    });
    const accepted = h.result.current.previewRef.current.eventLists
      .event[0] as typeof item;
    h.result.current.updateItemFields({
      eventName: "event",
      itemId: item.id,
      baseline: accepted,
      changes: { remarks: "ユーザー登録" },
      saveImmediately: true,
    });
  });
  const acceptedReference = h.result.current.values.eventLists.event[0];
  // Enqueue a barrier without flushing memo timers: the record is already queued.
  await act(async () => {
    await h.result.current.coordinator.enqueue(() => undefined);
  });
  expect(h.durable().eventLists.event[0]).toMatchObject({
    purchaseStatus: "SoldOut",
    remarks: "ユーザー登録",
  });
  expect(h.result.current.values.eventLists.event[0]).toBe(acceptedReference);
  expect(h.result.current.values.eventLists.event[1]).toBe(untouched);
  expect(h.result.current.pendingCount).toBe(0);
  h.unmount();
});
it("accepts a bulk field command in one ordered operation", async () => {
  const h = harness();
  const items = [purchase, { ...purchase, id: "second" }];
  h.durable().eventLists.event = items;
  act(() => h.result.current.hydrationSetters.setEventLists({ event: items }));
  act(() =>
    h.result.current.updateItemFields(
      items.map((item) => ({
        eventName: "event",
        itemId: item.id,
        baseline: item,
        changes: { purchaseStatus: "Purchased" as const },
        saveImmediately: true,
      })),
    ),
  );
  expect(h.result.current.pendingItemIds).toEqual(items.map((item) => item.id));
  await act(async () => {
    await h.result.current.coordinator.enqueue(() => undefined);
  });
  expect(h.commit).toHaveBeenCalledOnce();
  expect(
    h
      .durable()
      .eventLists.event.map((item) => (item as typeof purchase).purchaseStatus),
  ).toEqual(["Purchased", "Purchased"]);
  h.unmount();
});

it("flushes a pending memo when an unchanged answer is confirmed", async () => {
  const h = harness();
  const item = { ...purchase, remarks: "未記録" };
  h.durable().eventLists.event = [item];
  act(() => h.result.current.hydrationSetters.setEventLists({ event: [item] }));
  act(() => {
    h.result.current.updateItemFields({
      eventName: "event",
      itemId: purchase.id,
      baseline: item,
      changes: { remarks: "ユーザー登録" },
    });
    h.result.current.updateItemFields({
      eventName: "event",
      itemId: purchase.id,
      baseline: h.result.current.previewRef.current.eventLists
        .event[0] as typeof purchase,
      changes: {},
      saveImmediately: true,
    });
  });
  await act(async () => h.result.current.coordinator.enqueue(() => undefined));
  expect(h.durable().eventLists.event[0]).toMatchObject({
    remarks: "ユーザー登録",
  });
  expect(h.commit).toHaveBeenCalledOnce();
  h.unmount();
});

it("preserves historical day-store input references instead of cloning them for modes and visits", async () => {
  const h = harness();
  const history = {
    "1日目": Array.from({ length: 10000 }, (_, index) => `past-${index}`),
  };
  const modes = {
    event: { "1日目": "edit" as const },
    past: { "1日目": "focus" as const },
  };
  const visits = { event: { "1日目": [] }, past: history };
  act(() => {
    h.result.current.hydrationSetters.setDayModes(modes);
    h.result.current.hydrationSetters.setExecuteModeItems(visits);
  });
  const beforeModes = h.result.current.previewRef.current.dayModes;
  const beforeVisits = h.result.current.previewRef.current.executeModeItems;
  let modesInput: unknown;
  let visitsInput: unknown;
  const clone = vi.spyOn(globalThis, "structuredClone");
  act(() => {
    h.result.current.setters.setDayModes((current) => {
      modesInput = current;
      return { ...current, event: { ...current.event, "1日目": "focus" } };
    });
    h.result.current.setters.setExecuteModeItems((current) => {
      visitsInput = current;
      return { ...current, event: { ...current.event, "1日目": [] } };
    });
  });
  expect(modesInput).toBe(beforeModes);
  expect(visitsInput).toBe(beforeVisits);
  expect(
    clone.mock.calls.every(
      ([value]) => value !== beforeModes && value !== beforeVisits,
    ),
  ).toBe(true);
  expect(h.result.current.previewRef.current.executeModeItems.past).toBe(
    beforeVisits.past,
  );
  clone.mockRestore();
  await act(async () => h.result.current.coordinator.enqueue(() => undefined));
  h.unmount();
});
