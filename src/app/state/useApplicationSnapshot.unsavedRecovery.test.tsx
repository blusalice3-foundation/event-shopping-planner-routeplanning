import * as unsavedJournal from "../../utils/unsavedChangesJournal";
import { createEventConsistency } from "../../types/consistency";
// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  emptyApplicationSnapshot,
  useApplicationSnapshot,
} from "./useApplicationSnapshot";
import type {
  PersistenceCommandPort,
  PersistenceSnapshot,
} from "../ports/PersistenceCommandPort";
import {
  readUnsavedChanges,
  type UnsavedChangesRecord,
} from "../../utils/unsavedChangesJournal";

function harness(initial = emptyApplicationSnapshot()) {
  let durable: PersistenceSnapshot = {
    ...initial,
    eventLists: { event: [] },
    eventConsistency: { event: createEventConsistency() },
  };
  const commit = vi.fn(async (snapshot: PersistenceSnapshot) => {
    durable = structuredClone(snapshot);
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
    for (const [key, value] of Object.entries(durable)) {
      const setter =
        hook.result.current.hydrationSetters[
          ("set" +
            key[0].toUpperCase() +
            key.slice(1)) as keyof typeof hook.result.current.hydrationSetters
        ];
      (setter as (value: unknown) => void)(value);
    }
  });
  return { ...hook, commit, durable: () => durable };
}
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it("checkpoints confirmation-waiting inputs synchronously on pagehide without confirming them", async () => {
  const h = harness();
  let pending!: Promise<PersistenceSnapshot>;
  act(() => {
    pending = h.result.current.request({
      events: ["event"],
      plan: (snapshot) => ({
        snapshot,
        confirmation: {
          title: "レビュー",
          details: ["数量を確認"],
          comparison: "pending",
        },
      }),
    });
  });
  void pending.catch(() => {});
  await waitFor(() => expect(h.result.current.confirmations).toHaveLength(1));
  act(() => {
    window.dispatchEvent(new Event("pagehide"));
  });
  const records = readUnsavedChanges();
  expect(records).toHaveLength(1);
  expect(records[0].record?.operations[0]).toMatchObject({
    canResume: false,
    review: { confirmation: { title: "レビュー" } },
  });
  expect(h.commit).not.toHaveBeenCalled();
  h.unmount();
  expect(readUnsavedChanges()).toHaveLength(1);
});
it("restores a checkpoint through a fresh confirmation and does not reuse old permission or overwrite unrelated data", async () => {
  const h = harness();
  let reject!: (reason: unknown) => void;
  h.commit.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  act(() => {
    h.result.current.setters.setDayModes({ event: { "1日目": "execute" } });
  });
  await waitFor(() => expect(h.commit).toHaveBeenCalledOnce());
  act(() => {
    window.dispatchEvent(new Event("pagehide"));
  });
  const record = readUnsavedChanges()[0].record!;
  expect(record.operations[0].canResume).toBe(true);
  h.unmount();
  reject(new Error("page suspended"));
  const resumed = harness({
    ...emptyApplicationSnapshot(),
    eventMetadata: {
      event: {
        spreadsheetUrl: "https://example.com",
        spreadsheetSheetName: "Sheet1",
        lastImportDate: "2026-11-08",
      },
    },
  } as never);
  let saving!: Promise<void>;
  act(() => {
    saving = resumed.result.current.resumeUnsavedChanges(record);
  });
  let resumeError: unknown;
  void saving.catch((error) => {
    resumeError = error;
  });
  await waitFor(() => {
    if (resumeError) throw resumeError;
    expect(resumed.result.current.confirmations).toHaveLength(1);
  });
  expect(resumed.commit).not.toHaveBeenCalled();
  expect(
    resumed.result.current.confirmations[0].confirmation.details.join(" "),
  ).toContain("execute");
  expect(resumed.result.current.confirmations[0].confirmation.title).toBe(
    "未保存操作の再開を確認",
  );
  await act(async () => {
    resumed.result.current.confirm(
      resumed.result.current.confirmations[0].token,
    );
    await saving;
  });
  expect(resumed.durable().dayModes).toEqual({ event: { "1日目": "execute" } });
  expect(resumed.durable().eventMetadata).toEqual({
    event: {
      spreadsheetUrl: "https://example.com",
      spreadsheetSheetName: "Sheet1",
      lastImportDate: "2026-11-08",
    },
  });
  expect(readUnsavedChanges()).toHaveLength(1);
});
it("does not write a checkpoint synchronously during a normal shopping setter", async () => {
  const h = harness();
  const write = vi.spyOn(Storage.prototype, "setItem");
  act(() => {
    h.result.current.setters.setDayModes({ event: { "1日目": "execute" } });
  });
  expect(write).not.toHaveBeenCalled();
  await act(async () => {
    await h.result.current.flush();
  });
  expect(readUnsavedChanges()).toHaveLength(0);
});

it("marks unplanned closure inputs as unavailable instead of claiming they were retained", async () => {
  const h = harness();
  h.result.current.handlers.current.drain = () => new Promise(() => {});
  const plan = vi.fn((snapshot: PersistenceSnapshot) => ({ snapshot }));
  act(() => {
    void h.result.current.request({ events: ["event"], plan });
  });
  act(() => {
    window.dispatchEvent(new Event("pagehide"));
  });
  expect(plan).not.toHaveBeenCalled();
  expect(readUnsavedChanges()[0].record?.operations[0]).toMatchObject({
    inputUnavailable: true,
    canResume: false,
    changes: [],
  });
  expect(h.result.current.unsavedJournalFailed).toBe(true);
});
it("reports checkpoint quota failure while keeping a pending confirmation uncommitted", async () => {
  const h = harness();
  act(() => {
    void h.result.current.request({
      events: ["event"],
      plan: (snapshot) => ({
        snapshot,
        confirmation: { title: "確認", details: [], comparison: true },
      }),
    });
  });
  await waitFor(() => expect(h.result.current.confirmations).toHaveLength(1));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  act(() => {
    window.dispatchEvent(new Event("pagehide"));
  });
  expect(h.result.current.unsavedJournalFailed).toBe(true);
  expect(h.commit).not.toHaveBeenCalled();
});

it("requires conflict review when saved values changed since the checkpoint", async () => {
  const h = harness({
    ...emptyApplicationSnapshot(),
    dayModes: { event: { "1日目": "focus" } },
  });
  const record: UnsavedChangesRecord = {
    format: "event-shopping-planner-unsaved-changes",
    version: 1,
    source: "application",
    recordedAt: new Date().toISOString(),
    operations: [
      {
        id: "old",
        context: { eventName: "event", day: "1日目" },
        canResume: true,
        changes: [
          {
            store: "dayModes",
            eventName: "event",
            baseline: { "1日目": "edit" },
            desired: { "1日目": "execute" },
          },
        ],
      },
    ],
  };
  let resumed!: Promise<void>;
  act(() => {
    resumed = h.result.current.resumeUnsavedChanges(record);
  });
  void resumed.catch(() => {});
  await waitFor(() => expect(h.result.current.confirmations).toHaveLength(1));
  expect(h.commit).not.toHaveBeenCalled();
  expect(h.result.current.confirmations[0].confirmation.title).toBe(
    "競合する更新を確認",
  );
  expect(h.durable().dayModes.event["1日目"]).toBe("focus");
  await act(async () => {
    h.result.current.cancel(h.result.current.confirmations[0].token);
    await expect(resumed).rejects.toThrow("操作を取り消しました");
  });
});

it("preserves its earlier checkpoint and skips all difference scans when pending operations exceed the total budget", async () => {
  const h = harness();
  h.result.current.handlers.current.drain = () => new Promise(() => {});
  act(() => {
    void h.result.current.request({
      events: ["event"],
      plan: (snapshot) => ({ snapshot }),
    });
  });
  act(() => {
    window.dispatchEvent(new Event("pagehide"));
  });
  const existing = readUnsavedChanges()[0].text;
  const scan = vi.spyOn(unsavedJournal, "unsavedSnapshotChanges");
  const write = vi.spyOn(Storage.prototype, "setItem");
  act(() => {
    for (let index = 0; index < 100; index++)
      void h.result.current.request({
        events: ["event"],
        plan: (snapshot) => ({ snapshot }),
      });
  });
  expect(h.result.current.coordinator.pendingOperationCount()).toBe(101);
  act(() => {
    window.dispatchEvent(new Event("pagehide"));
  });
  expect(scan).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(h.result.current.unsavedJournalFailed).toBe(true);
  expect(readUnsavedChanges()[0].text).toBe(existing);
});
