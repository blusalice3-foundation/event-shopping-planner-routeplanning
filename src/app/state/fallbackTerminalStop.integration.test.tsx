// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { IDBDatabase, IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIndexedDbPersistence } from "../../hooks/useIndexedDbPersistence";
import { createIndexedDbPersistenceCommandAdapter } from "../../persistence/adapters/indexedDbPersistenceCommandAdapter";
import { resetDatabaseConnection } from "../../persistence/db/openDatabase";
import { createEventConsistency } from "../../types/consistency";
import { db } from "../../utils/indexedDB";
import type { AppBackupV1 } from "../../utils/appBackup";
import { useEventTransferCommands } from "../commands/useEventTransferCommands";
import {
  emptyApplicationSnapshot,
  MEMO_SAVE_MAX_WAIT_MS,
  useApplicationSnapshot,
} from "./useApplicationSnapshot";

const EVENT = "保存安全性";
const DAY = "1日目";
const items = ["1", "2"].map((id) => ({
  id,
  circle: `サークル${id}`,
  title: "新刊",
  eventDate: DAY,
  block: "A",
  number: id,
  purchaseStatus: "None" as const,
  price: 900,
  quantity: 1,
  remarks: "ユーザー登録",
}));

beforeEach(() => {
  resetDatabaseConnection();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("Worker", undefined);
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  resetDatabaseConnection();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function harness(backup: AppBackupV1 | null = null) {
  const seed = {
    ...emptyApplicationSnapshot(),
    eventLists: { [EVENT]: items },
    executeModeItems: { [EVENT]: { [DAY]: ["1", "2"] } },
    eventConsistency: { [EVENT]: createEventConsistency() },
  };
  const initial = await db.readApplicationSnapshot();
  await db.commitApplicationSnapshotAtomically(seed, {
    expectedRoots: initial.expectedRoots,
  });
  const commands = createIndexedDbPersistenceCommandAdapter();
  const navigation = { openEvent: vi.fn(), showEventList: vi.fn() };
  const clearSelection = vi.fn();
  const confirmBackupRestore = vi.fn();
  const hook = renderHook(() => {
    const application = useApplicationSnapshot(commands, EVENT, DAY);
    const persistence = useIndexedDbPersistence({
      persistenceCommands: commands,
      values: application.raw,
      setters: application.hydrationSetters,
      saveDelayMs: 25,
    });
    application.handlers.current = {
      stopWrites: persistence.stopWrites,
      drain: persistence.flushPendingSave,
      observeSnapshot: persistence.observeSnapshot,
      applied: persistence.acceptCommittedSnapshot,
    };
    const transfer = useEventTransferCommands({
      ...application.values,
      ...application.setters,
      requestMutation: application.request,
      readExportSnapshot: application.coordinator.readExportSnapshot,
      createBackupFile: application.coordinator.createBackupFile,
      appRuntime: {
        persistenceCommands: commands,
        xlsxCommands: {
          importWorkbook: vi.fn(),
          exportWorkbook: vi.fn(),
        },
        downloadXlsx: vi.fn(),
      },
      startupState: persistence.startupState,
      exportEventName: null,
      pendingBackup: backup,
      pendingXlsxRestoreCompletion: null,
      navigationCommands: navigation,
      clearSelection,
      runExclusiveRestore: persistence.runExclusiveRestore,
      openExport: vi.fn(),
      confirmEventOverlay: vi.fn(),
      openBackupRestore: vi.fn(),
      confirmBackupRestore,
      stopWrites: application.stopWrites,
      startXlsxOperation: vi.fn(() => "xlsx-operation"),
      updateXlsxOperation: vi.fn(),
      clearXlsxOperation: vi.fn(),
      setExecuteModeItemsCommitted:
        application.hydrationSetters.setExecuteModeItems,
    });
    return { application, persistence, transfer };
  });
  await waitFor(() =>
    expect(hook.result.current.persistence.isInitialized).toBe(true),
  );
  return {
    ...hook,
    commands,
    seed,
    navigation,
    clearSelection,
    confirmBackupRestore,
  };
}

function trackWrites(afterFirstCommit?: () => void) {
  let started = 0;
  let completed = 0;
  const transaction = IDBDatabase.prototype.transaction;
  vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
    this: IDBDatabase,
    ...args
  ) {
    const result = transaction.apply(this, args);
    if (args[1] === "readwrite") {
      const first = ++started === 1;
      result.addEventListener("complete", () => {
        completed++;
        if (first) afterFirstCommit?.();
      });
    }
    return result;
  });
  return { started: () => started, completed: () => completed };
}

function delayNextAtomicCommit() {
  let begin!: () => void;
  let release!: () => void;
  const began = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = db.commitApplicationSnapshotAtomically.bind(db);
  const atomic = vi.spyOn(db, "commitApplicationSnapshotAtomically");
  atomic.mockImplementationOnce(async (...args) => {
    begin();
    await released;
    return original(...args);
  });
  return { began, release, atomic };
}

describe("non-Worker terminal persistence stop composition", () => {
  it("stops every owner after a real commit cleanup failure, retaining accepted input and rejecting queued writes", async () => {
    const h = await harness();
    const gate = delayNextAtomicCommit();
    const fault = new DOMException("エラーが発生しました", "SecurityError");
    let injected = 0;
    const writes = trackWrites(() => {
      vi.spyOn(Storage.prototype, "length", "get").mockImplementationOnce(
        () => {
          injected++;
          throw fault;
        },
      );
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let first!: Promise<unknown>;
    await act(async () => {
      first = h.result.current.application
        .commitPatch({
          eventLists: {
            [EVENT]: items.map((item) =>
              item.id === "1" ? { ...item, quantity: 2 } : item,
            ),
          },
        })
        .catch((error: unknown) => error);
      await gate.began;
    });
    let queued!: Promise<unknown>;
    act(() => {
      queued = h.result.current.application
        .commitPatch({
          eventMetadata: {
            [EVENT]: { spreadsheetUrl: "https://example.invalid/queued" },
          },
        })
        .catch((error: unknown) => error);
      h.result.current.application.setters.setEventLists((lists) => ({
        ...lists,
        [EVENT]: lists[EVENT].map((item) =>
          item.id === "2" ? { ...item, remarks: "停止前に受理したメモ" } : item,
        ),
      }));
    });
    let synchronousFlush!: Promise<unknown>;
    let stopReason: unknown;
    h.commands.onWritesStopped?.((reason) => {
      stopReason = reason;
      h.result.current.persistence.retrySave();
      synchronousFlush = h.result.current.persistence
        .flushPendingSave()
        .catch((error: unknown) => error);
    });
    await act(async () => {
      gate.release();
      await Promise.all([first, queued]);
    });
    const terminal = await first;
    expect(injected).toBe(1);
    expect(terminal).toMatchObject({
      name: "PersistenceOutcomeUnknownError",
      cause: fault,
    });
    expect(await queued).toBe(terminal);
    expect(stopReason).toBe(terminal);
    expect(await synchronousFlush).toBe(terminal);
    expect(h.commands.getWriteStopReason?.()).toBe(terminal);
    expect(h.result.current.persistence.getWriteStopReason()).toBe(terminal);
    expect(h.result.current.application.getWriteStopReason()).toBe(terminal);
    expect(h.result.current.application.requiresReload).toBe(true);
    expect(h.result.current.application.pendingCount).toBe(0);
    expect(h.result.current.application.confirmations).toEqual([]);
    expect(h.result.current.application.retryableFailures).toEqual([]);
    expect(writes.started()).toBe(1);
    expect(writes.completed()).toBe(1);
    expect(
      (await db.readApplicationSnapshot()).snapshot.eventLists[EVENT],
    ).toMatchObject([{ quantity: 2 }, { remarks: "ユーザー登録" }]);
    expect(
      h.result.current.application.values.eventLists[EVENT][1].remarks,
    ).toBe("停止前に受理したメモ");
    await act(async () => {
      h.result.current.persistence.retrySave();
      h.result.current.application.retryPending();
      h.result.current.persistence.acceptCommittedSnapshot(h.seed);
      await vi.advanceTimersByTimeAsync(MEMO_SAVE_MAX_WAIT_MS + 25);
    });
    await expect(h.result.current.persistence.flushPendingSave()).rejects.toBe(
      terminal,
    );
    await expect(h.result.current.application.flush()).rejects.toBe(terminal);
    await expect(
      h.result.current.application.commitPatch({ eventLists: {} }),
    ).rejects.toBe(terminal);
    await expect(h.commands.saveEventLists({})).rejects.toBe(terminal);
    const file =
      await h.result.current.application.coordinator.createBackupFile();
    const exported = JSON.parse(await file.blob.text());
    expect(exported.data.eventLists[EVENT]).toMatchObject([
      { quantity: 2 },
      { remarks: "停止前に受理したメモ" },
    ]);
    expect(gate.atomic).toHaveBeenCalledOnce();
    expect(writes.started()).toBe(1);
    expect(writes.completed()).toBe(1);
  });
});

it("stops a real restore after committed navigation fails and preserves unrelated accepted input", async () => {
  const restoredEvent = "復元済みイベント";
  const backup: AppBackupV1 = {
    kind: "event-shopping-planner-backup",
    version: 2,
    exportedAt: "2026-10-19T00:00:00.000Z",
    data: {
      ...emptyApplicationSnapshot(),
      eventLists: { source: [{ ...items[0], id: "restored", quantity: 4 }] },
      eventConsistency: { source: createEventConsistency() },
    },
  };
  const h = await harness(backup);
  const gate = delayNextAtomicCommit();
  const writes = trackWrites();
  const uiFault = new Error("復元保存後の画面処理失敗");
  h.navigation.openEvent.mockImplementation(() => {
    throw uiFault;
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let restoring!: Promise<unknown>;
  await act(async () => {
    restoring = h.result.current.transfer
      .handleBackupRestore("source", restoredEvent)
      .catch((error: unknown) => error);
    await gate.began;
  });
  act(() => {
    h.result.current.application.setters.setEventLists((lists) => ({
      ...lists,
      [EVENT]: lists[EVENT].map((item) =>
        item.id === "2" ? { ...item, remarks: "復元待ちに受理したメモ" } : item,
      ),
    }));
  });
  await act(async () => {
    gate.release();
    await restoring;
  });
  const terminal = await restoring;
  expect(terminal).toMatchObject({
    name: "CommittedStateApplyError",
    cause: uiFault,
  });
  expect(h.result.current.application.requiresReload).toBe(true);
  expect(h.result.current.transfer.isBackupRestoreStopped).toBe(true);
  expect(h.result.current.application.getWriteStopReason()).toBe(terminal);
  expect(h.result.current.persistence.getWriteStopReason()).toBe(terminal);
  expect(h.commands.getWriteStopReason?.()).toBe(terminal);
  expect(h.result.current.application.pendingCount).toBe(0);
  expect(h.result.current.application.confirmations).toEqual([]);
  expect(h.result.current.application.retryableFailures).toEqual([]);
  expect(h.navigation.openEvent).toHaveBeenCalledOnce();
  expect(h.clearSelection).not.toHaveBeenCalled();
  expect(h.confirmBackupRestore).not.toHaveBeenCalled();
  expect(writes.started()).toBe(1);
  expect(writes.completed()).toBe(1);
  const saved = (await db.readApplicationSnapshot()).snapshot;
  expect(saved.eventLists[restoredEvent]).toMatchObject([
    { id: "restored", quantity: 4 },
  ]);
  expect(saved.eventLists[EVENT][1]).toMatchObject({ remarks: "ユーザー登録" });
  expect(h.result.current.application.values.eventLists[EVENT][1].remarks).toBe(
    "復元待ちに受理したメモ",
  );
  await act(async () => {
    h.result.current.persistence.retrySave();
    h.result.current.application.retryPending();
    await h.result.current.transfer.handleBackupRestore(
      "source",
      restoredEvent,
    );
    await vi.advanceTimersByTimeAsync(MEMO_SAVE_MAX_WAIT_MS + 25);
  });
  expect(h.result.current.transfer.handleBackupRestoreCancel()).toBe(false);
  await expect(h.result.current.persistence.flushPendingSave()).rejects.toBe(
    terminal,
  );
  await expect(h.result.current.application.flush()).rejects.toBe(terminal);
  await expect(
    h.result.current.application.commitPatch({ eventLists: {} }),
  ).rejects.toBe(terminal);
  await expect(h.commands.restoreAppDataAtomically(h.seed)).rejects.toBe(
    terminal,
  );
  const file =
    await h.result.current.application.coordinator.createBackupFile();
  const exported = JSON.parse(await file.blob.text());
  expect(exported.data.eventLists[EVENT][1].remarks).toBe(
    "復元待ちに受理したメモ",
  );
  expect(exported.data.eventLists[restoredEvent]).toMatchObject([
    { id: "restored", quantity: 4 },
  ]);
  expect(h.navigation.openEvent).toHaveBeenCalledOnce();
  expect(gate.atomic).toHaveBeenCalledOnce();
  expect(writes.started()).toBe(1);
  expect(writes.completed()).toBe(1);
});
