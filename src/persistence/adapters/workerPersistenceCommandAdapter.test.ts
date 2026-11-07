import { afterEach, expect, it, vi } from "vitest";
import { createWorkerPersistenceCommandAdapter } from "./workerPersistenceCommandAdapter";
import { emptyApplicationSnapshot } from "../../app/state/useApplicationSnapshot";
import type { WorkerSnapshotRead } from "../worker/snapshotDelta";
afterEach(() => vi.unstubAllGlobals());
it("adopts equal UI references before the first day command and never rescans historical items", async () => {
  let raw = emptyApplicationSnapshot();
  raw.eventLists = {
    event: [{ id: "1", title: "ユーザー登録" }] as never[],
    past: Array.from({ length: 10000 }, (_, index) => ({
      id: "past-" + index,
      title: "過去",
    })) as never[],
  };
  raw.dayModes = { event: { "1日目": "execute" } };
  const replies: WorkerSnapshotRead[] = [
    {
      delta: { full: structuredClone(raw) },
      observationId: 1,
      consistencyMissing: false,
    },
    {
      delta: {
        branches: [
          {
            store: "dayModes",
            eventName: "event",
            path: ["1日目"],
            present: true,
            value: "edit",
          },
        ],
      },
      observationId: 2,
      consistencyMissing: false,
    },
    {
      delta: {
        branches: [
          {
            store: "eventLists",
            eventName: "event",
            path: [],
            present: true,
            value: [{ id: "1", title: "他タブ" }],
          },
        ],
      },
      observationId: 3,
      consistencyMissing: false,
    },
  ];
  class MockWorker {
    onmessage?: (event: MessageEvent) => void;
    onerror?: (event: Event) => void;
    postMessage(request: { id: number }) {
      const read = replies.shift()!;
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            id: request.id,
            result: request.id === 1 ? read : { status: "committed", read },
            storageChanges: [],
          },
        } as MessageEvent),
      );
    }
    terminate() {}
  }
  vi.stubGlobal("localStorage", {
    length: 0,
    key: () => null,
    getItem: () => null,
  });
  vi.stubGlobal("Worker", MockWorker);
  const port = createWorkerPersistenceCommandAdapter();
  const release = port.bindApplicationSettings({
    read: () => raw,
    save: async () => {},
  });
  const initial = await port.readApplicationSnapshot();
  expect(initial.snapshot.eventLists).toBe(raw.eventLists);
  raw = structuredClone(initial.snapshot) as typeof raw;
  port.adoptCommittedSnapshot!(raw);
  const past = raw.eventLists.past;
  const inspect = vi.fn(() => {
    throw new Error("Historical item was inspected");
  });
  Object.defineProperty(past[0], "title", { get: inspect, enumerable: true });
  const mode = await port.commitDayMutation!(
    { kind: "mode", eventName: "event", day: "1日目" },
    "mode",
    {},
  );
  expect(mode.status).toBe("committed");
  if (mode.status !== "committed") throw new Error("not committed");
  raw = mode.read.snapshot as typeof raw;
  expect(raw.eventLists.past).toBe(past);
  expect(inspect).not.toHaveBeenCalled();
  const remote = await port.commitDayMutation!(
    { kind: "mode", eventName: "event", day: "1日目" },
    "remote",
    {},
  );
  if (remote.status !== "committed") throw new Error("not committed");
  expect(remote.read.snapshot.eventLists.event[0]).toMatchObject({
    title: "他タブ",
  });
  expect(remote.read.snapshot.eventLists.past).toBe(past);
  expect(inspect).not.toHaveBeenCalled();
  release();
});

it.each(["commit", "commitDay", "day", "items", "shopping", "save"])(
  "stops all writes after a sent %s loses its worker response",
  async (method) => {
    const workers: LossWorker[] = [];
    class LossWorker {
      onmessage?: (event: MessageEvent) => void;
      onerror?: () => void;
      onmessageerror?: () => void;
      postMessage = vi.fn();
      terminate = vi.fn();
      constructor() {
        workers.push(this);
      }
    }
    vi.stubGlobal("Worker", LossWorker);
    vi.stubGlobal("localStorage", { length: 0, key: () => null });
    const port = createWorkerPersistenceCommandAdapter();
    const stopped = vi.fn();
    port.onWritesStopped!(stopped);
    const snapshot = emptyApplicationSnapshot();
    const result = (
      method === "commit"
        ? port.commitApplicationSnapshotAtomically(snapshot)
        : method === "commitDay"
          ? port.commitDayApplicationSnapshot!(
              snapshot,
              { workerObservation: 1 },
              { eventName: "event", day: "1日目" },
            )
          : method === "day"
            ? port.commitDayMutation!(
                { kind: "mode", eventName: "event", day: "1日目" },
                "day",
                {},
              )
            : method === "shopping"
              ? port.commitShoppingMove!(
                  {
                    version: 1,
                    eventName: "event",
                    day: "1日目",
                    sourceColumn: "execute",
                    targetColumn: "candidate",
                    requestedIds: [],
                    effectiveIds: [],
                    hoverId: "__END_OF_LIST__",
                    baselineVisits: [],
                    baselineItemIds: [],
                    itemIds: [],
                    baselineExecuteIds: [],
                    executeIds: [],
                  },
                  "move",
                  {},
                )
              : method === "items"
                ? port.commitItemContentEdits!([], ["items"], {})
                : port.saveEventLists({})
    ).catch((error: unknown) => error);
    workers[0].onmessageerror!();
    const reason = await result;
    expect(reason).toMatchObject({ name: "PersistenceOutcomeUnknownError" });
    expect(stopped).toHaveBeenCalledExactlyOnceWith(reason);
    await expect(port.saveHallDefinitions({})).rejects.toBe(reason);
    await expect(
      port.commitApplicationSnapshotAtomically(snapshot),
    ).rejects.toBe(reason);
    await expect(port.restoreAppDataAtomically(snapshot)).rejects.toBe(reason);
    expect(workers).toHaveLength(1);
    expect(workers[0].postMessage).toHaveBeenCalledOnce();
  },
);

it("keeps read communication loss and a definite transaction abort retryable", async () => {
  const workers: ReadWorker[] = [];
  class ReadWorker {
    onmessage?: (event: MessageEvent) => void;
    onerror?: () => void;
    postMessage = vi.fn();
    terminate() {}
    constructor() {
      workers.push(this);
    }
  }
  vi.stubGlobal("Worker", ReadWorker);
  vi.stubGlobal("localStorage", { length: 0, key: () => null });
  const port = createWorkerPersistenceCommandAdapter();
  const read = port.readApplicationSnapshot().catch((error: unknown) => error);
  workers[0].onerror!();
  expect(await read).toMatchObject({ name: "Error" });
  expect(port.getWriteStopReason!()).toBeUndefined();
  const save = port.saveEventLists({}).catch((error: unknown) => error);
  const id = workers[1].postMessage.mock.calls[0][0].id;
  workers[1].onmessage!({
    data: { id, error: { name: "AbortError", message: "transaction aborted" } },
  } as MessageEvent);
  expect(await save).toMatchObject({ name: "AbortError" });
  expect(port.getWriteStopReason!()).toBeUndefined();
  const retry = port.saveEventLists({});
  const retryId = workers[1].postMessage.mock.calls[1][0].id;
  workers[1].onmessage!({ data: { id: retryId } } as MessageEvent);
  await retry;
});

it("does not label creation or synchronous postMessage failure as an unknown outcome", async () => {
  vi.stubGlobal("localStorage", { length: 0, key: () => null });
  class ThrowWorker {
    postMessage() {
      throw new DOMException("clone", "DataCloneError");
    }
  }
  vi.stubGlobal("Worker", ThrowWorker);
  const port = createWorkerPersistenceCommandAdapter();
  await expect(port.saveEventLists({})).rejects.toMatchObject({
    name: "DataCloneError",
  });
  expect(port.getWriteStopReason!()).toBeUndefined();
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        throw new Error("creation");
      }
    },
  );
  const fresh = createWorkerPersistenceCommandAdapter();
  await expect(fresh.saveEventLists({})).rejects.toThrow("creation");
  expect(fresh.getWriteStopReason!()).toBeUndefined();
});

it.each(["unavailable", "invalid"])(
  "stops every writer when known-commit full recovery is %s",
  async (failure) => {
    const methods: string[] = [];
    class RecoveryWorker {
      onmessage?: (event: MessageEvent) => void;
      postMessage(request: { id: number; method: string }) {
        methods.push(request.method);
        queueMicrotask(() =>
          this.onmessage?.({
            data:
              request.method === "shopping"
                ? {
                    id: request.id,
                    result: { status: "committed", deltaError: true },
                  }
                : failure === "unavailable"
                  ? {
                      id: request.id,
                      error: { name: "Error", message: "read failed" },
                    }
                  : {
                      id: request.id,
                      result: {
                        observationId: 2,
                        consistencyMissing: false,
                        delta: {
                          full: {
                            ...emptyApplicationSnapshot(),
                            executeModeItems: {
                              event: { "1日目": ["missing"] },
                            },
                          },
                        },
                      },
                    },
          } as MessageEvent),
        );
      }
    }
    vi.stubGlobal("Worker", RecoveryWorker);
    vi.stubGlobal("localStorage", { length: 0, key: () => null });
    const port = createWorkerPersistenceCommandAdapter();
    const reason = await port.commitShoppingMove!(
      {
        version: 1,
        eventName: "event",
        day: "1日目",
        sourceColumn: "execute",
        targetColumn: "candidate",
        requestedIds: [],
        effectiveIds: [],
        hoverId: "__END_OF_LIST__",
        baselineVisits: [],
        baselineItemIds: [],
        itemIds: [],
        baselineExecuteIds: [],
        executeIds: [],
      },
      "move",
      {},
    ).catch((error: unknown) => error);
    expect(reason).toMatchObject({ name: "CommittedStateApplyError" });
    expect(port.getWriteStopReason!()).toBe(reason);
    await expect(port.saveEventLists({})).rejects.toBe(reason);
    expect(methods).toEqual(["shopping", "readFull"]);
  },
);

it.each(["quota", "readback", "conflict", "read-error"])(
  "rejects a worker fallback acknowledgement when browser storage has a %s failure",
  async (failure) => {
    const key = "esp:idb-fallback:v1:eventLists:data:revision";
    const candidate = '{"payload":"ユーザー登録"}';
    const values = new Map<string, string>();
    const setItem = vi.fn((entryKey: string, value: string) => {
      if (failure === "quota")
        throw new DOMException("storage is full", "QuotaExceededError");
      if (failure !== "readback") values.set(entryKey, value);
    });
    const getItem = vi.fn((entryKey: string) => {
      if (failure === "read-error")
        throw new DOMException("storage unavailable", "SecurityError");
      return values.get(entryKey) ?? null;
    });
    class FallbackWorker {
      onmessage?: (event: MessageEvent) => void;
      postMessage = vi.fn((request: { id: number }) => {
        queueMicrotask(() => {
          if (failure === "conflict")
            values.set(key, "another recovery source");
          this.onmessage?.({
            data: {
              id: request.id,
              storageChanges: [[key, candidate]],
            },
          } as MessageEvent);
        });
      });
    }
    vi.stubGlobal("Worker", FallbackWorker);
    vi.stubGlobal("localStorage", {
      length: 0,
      key: () => null,
      getItem,
      setItem,
    });
    const port = createWorkerPersistenceCommandAdapter();
    const stopped = vi.fn();
    port.onWritesStopped!(stopped);
    const result = await port
      .saveEventLists({})
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ name: "PersistenceOutcomeUnknownError" });
    expect(stopped).toHaveBeenCalledExactlyOnceWith(result);
    expect(port.getWriteStopReason!()).toBe(result);
    await expect(port.saveEventMetadata({})).rejects.toBe(result);
    if (failure === "conflict") {
      expect(setItem).not.toHaveBeenCalled();
      expect(values.get(key)).toBe("another recovery source");
    }
  },
);

it.each([false, true])(
  "acknowledges fallback only after it is durable, including an already retained value (%s)",
  async (alreadyDurable) => {
    const key = "esp:idb-fallback:v1:eventLists:data:revision";
    const candidate = '{"payload":"ユーザー登録"}';
    const values = new Map<string, string>();
    const setItem = vi.fn((entryKey: string, value: string) => {
      values.set(entryKey, value);
    });
    class FallbackWorker {
      onmessage?: (event: MessageEvent) => void;
      postMessage(request: { id: number }) {
        queueMicrotask(() => {
          if (alreadyDurable) values.set(key, candidate);
          this.onmessage?.({
            data: { id: request.id, storageChanges: [[key, candidate]] },
          } as MessageEvent);
        });
      }
    }
    vi.stubGlobal("Worker", FallbackWorker);
    vi.stubGlobal("localStorage", {
      length: 0,
      key: () => null,
      getItem: (entryKey: string) => values.get(entryKey) ?? null,
      setItem,
    });
    const port = createWorkerPersistenceCommandAdapter();
    await expect(port.saveEventLists({})).resolves.toBeUndefined();
    expect(values.get(key)).toBe(candidate);
    expect(setItem).toHaveBeenCalledTimes(alreadyDurable ? 0 : 1);
    expect(port.getWriteStopReason!()).toBeUndefined();
  },
);

it.each(["remove-error", "changed"])(
  "keeps committed writes successful when old recovery source cleanup has a %s condition",
  async (condition) => {
    const key = "esp:idb-fallback:v1:eventLists:data:old";
    const values = new Map([[key, "old recovery source"]]);
    const removeItem = vi.fn(() => {
      throw new DOMException("storage unavailable", "SecurityError");
    });
    class CleanupWorker {
      onmessage?: (event: MessageEvent) => void;
      postMessage(request: { id: number }) {
        queueMicrotask(() => {
          if (condition === "changed") values.set(key, "new recovery source");
          this.onmessage?.({
            data: { id: request.id, storageChanges: [[key, null]] },
          } as MessageEvent);
        });
      }
    }
    vi.stubGlobal("Worker", CleanupWorker);
    vi.stubGlobal("localStorage", {
      length: 1,
      key: () => key,
      getItem: (entryKey: string) => values.get(entryKey) ?? null,
      removeItem,
    });
    const port = createWorkerPersistenceCommandAdapter();
    await expect(port.saveEventLists({})).resolves.toBeUndefined();
    expect(values.get(key)).toBe(
      condition === "changed" ? "new recovery source" : "old recovery source",
    );
    expect(removeItem).toHaveBeenCalledTimes(condition === "changed" ? 0 : 1);
    expect(port.getWriteStopReason!()).toBeUndefined();
  },
);
