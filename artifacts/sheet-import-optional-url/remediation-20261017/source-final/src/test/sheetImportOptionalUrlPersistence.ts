import { scopeReadyKey } from "../persistence/db/scopedDayStorage";
import { sidecarRecordStores } from "../persistence/db/dayRecordStorage";
import { openDatabase } from "../persistence/db/openDatabase";
import {
  IDBDatabase,
  IDBFactory,
  IDBKeyRange,
  IDBObjectStore,
} from "fake-indexeddb";
import { vi } from "vitest";
import type { PersistenceSnapshot } from "../app/ports/PersistenceCommandPort";
import { emptyApplicationSnapshot } from "../app/state/useApplicationSnapshot";
import type { useIndexedDbPersistence } from "../hooks/useIndexedDbPersistence";
import { createIndexedDbPersistenceCommandAdapter } from "../persistence/adapters/indexedDbPersistenceCommandAdapter";
import { createWorkerPersistenceCommandAdapter } from "../persistence/adapters/workerPersistenceCommandAdapter";
import { createPersistenceWorkerServer } from "../persistence/worker/persistenceWorkerServer";
import { resetDatabaseConnection } from "../persistence/db/openDatabase";
import { db } from "../utils/indexedDB";
export const setters = () =>
  Object.fromEntries(
    Object.keys({ ...emptyApplicationSnapshot(), mapViewportSettings: {} }).map(
      (key) => [`set${key[0].toUpperCase()}${key.slice(1)}`, vi.fn()],
    ),
  ) as unknown as Parameters<typeof useIndexedDbPersistence>[0]["setters"];
export function fresh() {
  resetDatabaseConnection();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  localStorage.clear();
  sessionStorage.clear();
}
export function port(mode: string) {
  if (mode === "direct") return createIndexedDbPersistenceCommandAdapter();
  class LoopbackWorker {
    onmessage?: (event: MessageEvent) => void;
    onerror?: (event: Event) => void;
    server = createPersistenceWorkerServer(db);
    tail = Promise.resolve();
    postMessage(value: { id: number; method: string; args: unknown[] }) {
      const request = structuredClone(value);
      this.tail = this.tail.then(async () => {
        try {
          const methods = this.server as unknown as Record<
            string,
            (...args: unknown[]) => Promise<unknown>
          >;
          const result = await methods[request.method](...request.args);
          this.onmessage?.({
            data: structuredClone({
              id: request.id,
              result,
              storageChanges: [],
            }),
          } as MessageEvent);
        } catch (error) {
          const value = error as Error;
          this.onmessage?.({
            data: {
              id: request.id,
              error: { name: value.name, message: value.message },
            },
          } as MessageEvent);
        }
      });
    }
    terminate() {}
  }
  vi.stubGlobal("Worker", LoopbackWorker);
  return createWorkerPersistenceCommandAdapter();
}
export async function seed(snapshot: PersistenceSnapshot, prepared = true) {
  if (prepared) {
    const read = await db.readApplicationSnapshot();
    await db.commitApplicationSnapshotAtomically(snapshot, {
      expectedRoots: read.expectedRoots,
    });
    await db.readApplicationSnapshot({ prepareScopedCommands: true });
  } else {
    await db.readApplicationSnapshot();
    for (const [key, value] of Object.entries(snapshot)) {
      const save = (
        db as unknown as Record<string, (value: unknown) => Promise<void>>
      )[`save${key[0].toUpperCase()}${key.slice(1)}`];
      await save(value);
    }
    // Current save APIs prepare scope controls themselves. Remove only those
    // unauthenticated readiness markers to reproduce a verified older store.
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("syncQueue", "readwrite");
      for (const store of [...sidecarRecordStores, "mapData"] as const)
        tx.objectStore("syncQueue").delete(scopeReadyKey(store));
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  }
}
export function commits(includeScoped = false) {
  const result = {
    attempts: 0,
    successes: 0,
    aborted: 0,
    physicalCommitMs: 0,
    transactions: [] as Array<{
      startMs: number;
      endMs: number;
      outcome: "complete" | "abort";
      stores?: string[];
      scope?: "application" | "item-domain";
      putRequests?: Record<string, number>;
    }>,
    puts: {} as Record<string, number>,
    ...(includeScoped
      ? {
          observationScope: {
            transactions: "readwrite: 12+ stores, or eventLists included",
            application: "12+ stores",
            itemDomain: "eventLists included with fewer than 12 stores",
            putRequests:
              "put calls in selected transactions, including aborted attempts",
            duration: "transaction return to complete/abort event",
          },
        }
      : {}),
  };
  const observedTransactions = new WeakMap<
    IDBTransaction,
    {
      stores: string[];
      scope: "application" | "item-domain";
      putRequests: Record<string, number>;
    }
  >();
  let abortNext = false;
  const transaction = IDBDatabase.prototype.transaction;
  const put = IDBObjectStore.prototype.put;
  const txSpy = vi
    .spyOn(IDBDatabase.prototype, "transaction")
    .mockImplementation(function (
      this: IDBDatabase,
      ...args: Parameters<typeof transaction>
    ) {
      const tx = transaction.apply(this, args);
      if (
        args[1] === "readwrite" &&
        (Array.from(tx.objectStoreNames).length >= 12 ||
          (includeScoped && tx.objectStoreNames.contains("eventLists")))
      ) {
        result.attempts++;
        const observation = includeScoped
          ? {
              stores: Array.from(tx.objectStoreNames),
              scope: (tx.objectStoreNames.length >= 12
                ? "application"
                : "item-domain") as "application" | "item-domain",
              putRequests: {} as Record<string, number>,
            }
          : null;
        if (observation) observedTransactions.set(tx, observation);
        if (abortNext) {
          abortNext = false;
          queueMicrotask(() => tx.abort());
        }
        const start = performance.now();
        tx.addEventListener("complete", () => {
          result.successes++;
          result.transactions.push({
            startMs: start,
            endMs: performance.now(),
            outcome: "complete",
            ...(observation ?? {}),
          });
          result.physicalCommitMs += performance.now() - start;
        });
        tx.addEventListener("abort", () => {
          result.aborted++;
          result.transactions.push({
            startMs: start,
            endMs: performance.now(),
            outcome: "abort",
            ...(observation ?? {}),
          });
          result.physicalCommitMs += performance.now() - start;
        });
      }
      return tx;
    });
  const putSpy = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof put>
    ) {
      const observation = includeScoped
        ? observedTransactions.get(this.transaction)
        : undefined;
      if (!includeScoped || observation)
        result.puts[this.name] = (result.puts[this.name] ?? 0) + 1;
      if (observation)
        observation.putRequests[this.name] =
          (observation.putRequests[this.name] ?? 0) + 1;
      return put.apply(this, args);
    });
  return {
    result,
    failNext() {
      abortNext = true;
    },
    stop() {
      txSpy.mockRestore();
      putSpy.mockRestore();
    },
  };
}
