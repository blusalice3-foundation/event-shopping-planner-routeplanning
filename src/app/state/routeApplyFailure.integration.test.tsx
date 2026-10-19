// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { IDBDatabase, IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { planDayModeToggle } from "../../features/consistency/domain/dayMode";
import { useIndexedDbPersistence } from "../../hooks/useIndexedDbPersistence";
import { createWorkerPersistenceCommandAdapter } from "../../persistence/adapters/workerPersistenceCommandAdapter";
import { createPersistenceWorkerServer } from "../../persistence/worker/persistenceWorkerServer";
import { resetDatabaseConnection } from "../../persistence/db/openDatabase";
import { createEventConsistency } from "../../types/consistency";
import { db } from "../../utils/indexedDB";
import { CommittedStateApplyError } from "../commands/applicationMutationCoordinator";
import type { MutationIntent } from "../commands/applicationMutationCoordinator";
import {
  emptyApplicationSnapshot,
  MEMO_SAVE_MAX_WAIT_MS,
  useApplicationSnapshot,
} from "./useApplicationSnapshot";

const EVENT = "保存後適用失敗";
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
type Route = "day fast path" | "day snapshot" | "items batch";

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

async function harness(route: Route) {
  const seed = {
    ...emptyApplicationSnapshot(),
    eventLists: { [EVENT]: items },
    executeModeItems: { [EVENT]: { [DAY]: ["1", "2"] } },
    dayModes: { [EVENT]: { [DAY]: "edit" as const } },
    eventConsistency: { [EVENT]: createEventConsistency() },
  };
  const initial = await db.readApplicationSnapshot();
  await db.commitApplicationSnapshotAtomically(seed, {
    expectedRoots: initial.expectedRoots,
  });
  const server = createPersistenceWorkerServer(db);
  const writeMethod =
    route === "day fast path"
      ? "day"
      : route === "day snapshot"
        ? "commitDay"
        : "items";
  let committed!: () => void;
  let release!: () => void;
  const didCommit = new Promise<void>((resolve) => {
    committed = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: string[] = [];
  let workerCreations = 0;
  // Keep the production Worker adapter and server, replacing only the transport.
  class InProcessWorker {
    onmessage?: (event: MessageEvent) => void;
    private tail = Promise.resolve();
    constructor() {
      workerCreations++;
    }
    postMessage(request: { id: number; method: string; args: unknown[] }) {
      const cloned = structuredClone(request);
      requests.push(cloned.method);
      this.tail = this.tail.then(async () => {
        try {
          const command = server[cloned.method as keyof typeof server] as (
            ...args: unknown[]
          ) => Promise<unknown>;
          const result = await command(...cloned.args);
          if (cloned.method === writeMethod) {
            committed();
            await gate;
          }
          this.onmessage?.({
            data: {
              id: cloned.id,
              result: structuredClone(result),
              storageChanges: [],
            },
          } as MessageEvent);
        } catch (error) {
          const value = error as Error;
          this.onmessage?.({
            data: {
              id: cloned.id,
              error: { name: value.name, message: value.message },
            },
          } as MessageEvent);
        }
      });
    }
    terminate() {}
  }
  vi.stubGlobal("Worker", InProcessWorker);
  const commands = createWorkerPersistenceCommandAdapter();
  // Exercise the scoped fallback directly, without first attempting the command path.
  if (route === "day snapshot") commands.commitDayMutation = undefined;
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
    return { application, persistence };
  });
  await waitFor(() =>
    expect(hook.result.current.persistence.isInitialized).toBe(true),
  );
  return {
    ...hook,
    commands,
    seed,
    server,
    didCommit,
    release,
    requests,
    workerCreations: () => workerCreations,
  };
}

function trackWrites() {
  let started = 0;
  let completed = 0;
  const transaction = IDBDatabase.prototype.transaction;
  vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
    this: IDBDatabase,
    ...args
  ) {
    const result = transaction.apply(this, args);
    if (args[1] === "readwrite") {
      started++;
      result.addEventListener("complete", () => completed++);
    }
    return result;
  });
  return { started: () => started, completed: () => completed };
}

it.each(["day fast path", "day snapshot", "items batch"] as const)(
  "stops the composed persistence owners after a real %s commit cannot be applied",
  async (route) => {
    const h = await harness(route);
    const day = vi.spyOn(h.server, "day");
    const snapshot = vi.spyOn(h.server, "commitDay");
    const batch = vi.spyOn(h.server, "items");
    const scopedCommit = vi.spyOn(db, "commitDayCommandSnapshot");
    const atomic = vi.spyOn(db, "commitApplicationSnapshotAtomically");
    const singleItems = vi.spyOn(db, "saveEventLists");
    const singleOrder = vi.spyOn(db, "saveExecuteModeItems");
    const writes = trackWrites();
    const plan = vi.fn((snapshot) =>
      planDayModeToggle(snapshot, EVENT, DAY, { mode: "execute" }),
    );
    const intent: MutationIntent = {
      id: "first",
      events: [EVENT],
      plan,
      ...(route === "items batch"
        ? {
            itemContentEdits: [
              {
                eventName: EVENT,
                itemId: "1",
                fields: { quantity: { present: true, value: 2 } },
              },
            ],
          }
        : {
            dayMutation: {
              kind: "mode" as const,
              eventName: EVENT,
              day: DAY,
              mode: "execute" as const,
            },
          }),
    };
    let first!: Promise<unknown>;
    let peer: Promise<unknown> | undefined;
    await act(async () => {
      first = h.result.current.application
        .request(intent)
        .catch((error: unknown) => error);
      if (route === "items batch")
        peer = h.result.current.application
          .request({
            ...intent,
            id: "batch-peer",
            itemContentEdits: [
              {
                eventName: EVENT,
                itemId: "1",
                fields: { price: { present: true, value: 1200 } },
              },
            ],
          })
          .catch((error: unknown) => error);
      await h.didCommit;
    });
    expect(writes.started()).toBe(1);
    expect(writes.completed()).toBe(1);
    const durableBeforeApply = (await db.readApplicationSnapshot()).snapshot;
    if (route === "items batch") {
      expect(durableBeforeApply.eventLists[EVENT][0]).toMatchObject({
        quantity: 2,
        price: 1200,
      });
      expect(batch.mock.calls[0][1]).toEqual(["first", "batch-peer"]);
    } else expect(durableBeforeApply.dayModes[EVENT][DAY]).toBe("execute");

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const queuedPlan = vi.fn((snapshot) => {
      snapshot.eventMetadata[EVENT] = { queued: true };
      return { snapshot };
    });
    let queued!: Promise<unknown>;
    act(() => {
      queued = h.result.current.application
        .request({ id: "queued", events: [EVENT], plan: queuedPlan })
        .catch((error: unknown) => error);
      h.result.current.application.setters.setEventLists((lists) => ({
        ...lists,
        [EVENT]: lists[EVENT].map((item) =>
          item.id === "2"
            ? { ...item, remarks: "保存待ちに受理したメモ" }
            : item,
        ),
      }));
    });
    const fault = new Error("エラーが発生しました");
    const sameTick: Promise<unknown>[] = [];
    const stopped = vi.fn((reason: Error) => {
      expect(h.commands.getWriteStopReason?.()).toBe(reason);
      expect(h.result.current.application.getWriteStopReason()).toBe(reason);
      h.result.current.persistence.stopWrites(reason);
      h.result.current.persistence.retrySave();
      h.result.current.application.retryPending();
      sameTick.push(
        h.result.current.persistence
          .flushPendingSave()
          .catch((error: unknown) => error),
        h.commands.saveEventLists({}).catch((error: unknown) => error),
      );
    });
    h.result.current.application.handlers.current.stopWrites = stopped;
    const applied = vi.fn((snapshot) => {
      h.result.current.persistence.acceptCommittedSnapshot(snapshot);
      throw fault;
    });
    h.result.current.application.handlers.current.applied = applied;
    await act(async () => {
      h.release();
      await Promise.all([first, queued, ...(peer ? [peer] : [])]);
    });
    const terminal = await first;
    expect(terminal).toBeInstanceOf(CommittedStateApplyError);
    expect(terminal).toMatchObject({ cause: fault });
    expect(await queued).toBe(terminal);
    if (peer) expect(await peer).toBe(terminal);
    for (const outcome of await Promise.all(sameTick))
      expect(outcome).toBe(terminal);
    expect(stopped).toHaveBeenCalledExactlyOnceWith(terminal);
    expect(applied).toHaveBeenCalledOnce();
    expect(h.result.current.application.requiresReload).toBe(true);
    expect(h.result.current.application.pendingCount).toBe(0);
    expect(h.result.current.application.confirmations).toEqual([]);
    expect(h.result.current.application.retryableFailures).toEqual([]);
    expect(h.result.current.persistence.getWriteStopReason()).toBe(terminal);
    expect(h.commands.getWriteStopReason?.()).toBe(terminal);
    expect(queuedPlan).not.toHaveBeenCalled();
    expect(
      h.result.current.application.values.eventLists[EVENT][1].remarks,
    ).toBe("保存待ちに受理したメモ");
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
      h.result.current.application.request({ ...intent, id: "after-stop" }),
    ).rejects.toBe(terminal);
    await expect(h.commands.saveExecuteModeItems({})).rejects.toBe(terminal);
    vi.stubGlobal("Worker", undefined);
    const file =
      await h.result.current.application.coordinator.createBackupFile();
    const exported = JSON.parse(await file.blob.text());
    expect(exported.data.eventLists[EVENT][1].remarks).toBe(
      "保存待ちに受理したメモ",
    );
    expect(exported.data.eventMetadata).toEqual(
      durableBeforeApply.eventMetadata,
    );
    if (route === "items batch")
      expect(exported.data.eventLists[EVENT][0]).toMatchObject({
        quantity: 2,
        price: 1200,
      });
    else expect(exported.data.dayModes[EVENT][DAY]).toBe("execute");
    expect((await db.readApplicationSnapshot()).snapshot).toEqual(
      durableBeforeApply,
    );
    expect(day).toHaveBeenCalledTimes(route === "day fast path" ? 1 : 0);
    expect(snapshot).toHaveBeenCalledTimes(route === "day snapshot" ? 1 : 0);
    expect(batch).toHaveBeenCalledTimes(route === "items batch" ? 1 : 0);
    expect(plan).toHaveBeenCalledTimes(route === "day snapshot" ? 1 : 0);
    expect(atomic).toHaveBeenCalledTimes(route === "items batch" ? 1 : 0);
    expect(scopedCommit).toHaveBeenCalledTimes(route === "items batch" ? 0 : 1);
    expect(
      h.requests.filter((method) => !["read", "readDay"].includes(method)),
    ).toEqual([
      route === "day fast path"
        ? "day"
        : route === "day snapshot"
          ? "commitDay"
          : "items",
    ]);
    expect(h.workerCreations()).toBe(1);
    expect(singleItems).not.toHaveBeenCalled();
    expect(singleOrder).not.toHaveBeenCalled();
    expect(writes.started()).toBe(1);
    expect(writes.completed()).toBe(1);
  },
);
