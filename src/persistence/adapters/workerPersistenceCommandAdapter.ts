import type {
  ApplicationSnapshotRead,
  AtomicSnapshotOptions,
  PersistenceCommandPort,
  PersistenceSnapshot,
} from "../../app/ports/PersistenceCommandPort";
import {
  MutationConflictError,
  MutationTargetMissingError,
} from "../../app/commands/applicationMutationCoordinator";
import { applyItemContentEdits } from "../../app/state/itemContentEdits";
import { RUNTIME_FALLBACK_NAMESPACE } from "../../utils/persistenceResilience";
import { RECOVERY_ADOPTION_RETENTION_KEY_PREFIX } from "../db/constants";
import { db } from "../facade/indexedDbPersistence";
import {
  createIndexedDbPersistenceCommandAdapter,
  type IndexedDbPersistenceCommandDelegate,
} from "./indexedDbPersistenceCommandAdapter";
import {
  applySnapshotBranches,
  type WorkerSnapshotRead,
} from "../worker/snapshotDelta";

/** One worker owns storage transactions. Ordinary edits send only fields and operation IDs. */
export function createWorkerPersistenceCommandAdapter(): PersistenceCommandPort {
  if (typeof Worker !== "function")
    return createIndexedDbPersistenceCommandAdapter();
  let worker: Worker | undefined;
  let sequence = 0;
  let mirror: PersistenceSnapshot | undefined;
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: unknown): void;
      storage: Map<string, string>;
    }
  >();
  const read = (value: WorkerSnapshotRead): ApplicationSnapshotRead => {
    mirror = value.delta.full ?? { ...mirror!, ...value.delta.stores };
    if (value.delta.items?.length)
      mirror = applyItemContentEdits(mirror, value.delta.items);
    if (value.delta.branches?.length)
      mirror = applySnapshotBranches(mirror, value.delta.branches);
    return {
      snapshot: mirror,
      expectedRoots: { workerObservation: value.observationId },
      consistencyMissing: value.consistencyMissing,
      eventGenerations: value.eventGenerations,
    };
  };
  const call = (method: string, args: unknown[]): Promise<unknown> => {
    try {
      if (!worker) {
        worker = new Worker(
          new URL("../worker/persistence.worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.onmessage = (
          event: MessageEvent<{
            id: number;
            result: unknown;
            error?: { name: string; message: string; recoveryBundle?: unknown };
            storageChanges?: [string, string | null][];
          }>,
        ) => {
          const operation = pending.get(event.data.id);
          if (!operation) return;
          pending.delete(event.data.id);
          if (event.data.error) {
            const data = event.data.error;
            const error =
              data.name === "MutationTargetMissing"
                ? new MutationTargetMissingError()
                : data.name === "MutationConflict"
                  ? new MutationConflictError()
                  : Object.assign(new Error(data.message), data);
            operation.reject(error);
            return;
          }
          for (const [key, value] of event.data.storageChanges ?? []) {
            try {
              if (
                localStorage.getItem(key) !==
                (operation.storage.get(key) ?? null)
              )
                continue;
              if (value === null) localStorage.removeItem(key);
              else localStorage.setItem(key, value);
            } catch {
              /* Retain recovery sources when browser storage cleanup fails. */
            }
          }
          operation.resolve(event.data.result);
        };
        worker.onerror = () => {
          const error = new Error(
            "保存処理が停止しました。未保存の入力を再試行してください。",
          );
          for (const operation of pending.values()) operation.reject(error);
          pending.clear();
          worker?.terminate();
          worker = undefined;
          mirror = undefined;
        };
      }
      const storage = new Map<string, string>();
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (
          key &&
          (key.startsWith(RUNTIME_FALLBACK_NAMESPACE) ||
            key.startsWith(RECOVERY_ADOPTION_RETENTION_KEY_PREFIX))
        ) {
          const value = localStorage.getItem(key);
          if (value !== null) storage.set(key, value);
        }
      }
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, storage });
        try {
          worker!.postMessage({ id, method, args, storage: [...storage] });
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const commit = (
    snapshot: PersistenceSnapshot,
    options?: AtomicSnapshotOptions,
  ) =>
    call("commit", [
      snapshot,
      {
        ...options,
        expectedRoots: undefined,
        observationId: (
          options?.expectedRoots as { workerObservation?: number } | undefined
        )?.workerObservation,
      },
    ]).then(() => {
      mirror = snapshot;
    });
  const delegate: IndexedDbPersistenceCommandDelegate = {
    ...db,
    readApplicationSnapshot: async () =>
      read((await call("read", [])) as WorkerSnapshotRead),
    commitApplicationSnapshotAtomically: commit,
    commitDayMutation: async (command, operationId, expectedGenerations) => {
      const result = (await call("day", [
        command,
        operationId,
        expectedGenerations,
      ])) as
        | { status: "review-required" }
        | { status: "committed"; read: WorkerSnapshotRead };
      return result.status === "committed"
        ? { ...result, read: read(result.read) }
        : result;
    },
    commitItemContentEdits: async (
      edits,
      operationIds,
      expectedGenerations,
    ) => {
      const result = (await call("items", [
        edits,
        operationIds,
        expectedGenerations,
      ])) as
        | { status: "review-required" }
        | { status: "committed"; read: WorkerSnapshotRead };
      return result.status === "committed"
        ? { ...result, read: read(result.read) }
        : result;
    },
  };
  for (const method of [
    "saveEventLists",
    "saveEventMetadata",
    "saveExecuteModeItems",
    "saveDayModes",
    "saveMapDataChanges",
    "saveMapRotationSettings",
    "saveRouteSettings",
    "saveHallDefinitions",
    "saveHallRouteSettings",
    "saveMapViewportSettings",
    "saveEventConsistency",
  ] as const) {
    Object.assign(delegate, {
      [method]: (...args: unknown[]) =>
        call(method, args).then(() => undefined),
    });
  }
  return createIndexedDbPersistenceCommandAdapter(delegate);
}
