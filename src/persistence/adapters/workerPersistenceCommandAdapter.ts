import {
  sameDay,
  normalizeMapDay,
} from "../../features/consistency/domain/context";
import { MAPLESS_HALL_KEY } from "../../types/map";
import {
  validateSnapshotStructure,
  validateSnapshotReferences,
} from "../../utils/appBackup";
import { scopeDaySnapshot } from "../../features/consistency/domain/dayMutation";
import {
  PersistenceOutcomeUnknownError,
  isPersistenceWriteStopReason,
} from "../../app/ports/PersistenceCommandPort";
import { reuseEqualReferences } from "../../utils/semanticEquality";
import { adoptScopedDaySnapshot } from "../../features/consistency/domain/dayMutation";
import type {
  ApplicationSnapshotRead,
  AtomicSnapshotOptions,
  PersistenceCommandPort,
  PersistenceSnapshot,
} from "../../app/ports/PersistenceCommandPort";
import {
  MutationConflictError,
  CommittedStateApplyError,
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
  applyShoppingOrderDelta,
  type WorkerSnapshotRead,
} from "../worker/snapshotDelta";

/** One worker owns storage transactions. Ordinary edits send only fields and operation IDs. */
export function createWorkerPersistenceCommandAdapter(): PersistenceCommandPort {
  if (typeof Worker !== "function")
    return createIndexedDbPersistenceCommandAdapter();
  let worker: Worker | undefined;
  let sequence = 0;
  let mirror: PersistenceSnapshot | undefined;
  let mirrorObservation = 0;
  let applicationAccess:
    | Parameters<PersistenceCommandPort["bindApplicationSettings"]>[0]
    | undefined;
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: unknown): void;
      storage: Map<string, string>;
      method: string;
      write: boolean;
      sent: boolean;
    }
  >();
  const read = (value: WorkerSnapshotRead): ApplicationSnapshotRead => {
    mirror = value.delta.scope
      ? adoptScopedDaySnapshot(
          mirror,
          value.delta.scope.snapshot,
          value.delta.scope.target,
        )
      : (value.delta.full ?? { ...mirror!, ...value.delta.stores });
    if (value.delta.items?.length)
      mirror = applyItemContentEdits(mirror, value.delta.items);
    if (value.delta.branches?.length)
      mirror = applySnapshotBranches(mirror, value.delta.branches);
    if (applicationAccess)
      mirror = reuseEqualReferences(applicationAccess.read(), mirror);
    mirrorObservation = value.observationId;
    return {
      snapshot: mirror,
      expectedRoots: { workerObservation: value.observationId },
      consistencyMissing: value.consistencyMissing,
      eventGenerations: value.eventGenerations,
    };
  };
  const readCommitted = (value: WorkerSnapshotRead) => {
    try {
      return read(value);
    } catch (error) {
      throw new PersistenceOutcomeUnknownError(error);
    }
  };
  const call = (method: string, args: unknown[]): Promise<unknown> => {
    const write =
      ["commit", "commitDay", "day", "items", "shopping"].includes(method) ||
      method.startsWith("save");
    const stopped = adapter.getWriteStopReason?.();
    if (write && stopped) return Promise.reject(stopped);
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
            if (isPersistenceWriteStopReason(error))
              adapter.stopWrites?.(error);
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
        const communicationFailed = () => {
          const failure = new Error(
            "保存処理が停止しました。未保存の入力を再試行してください。",
          );
          const uncertain = [...pending.values()].some(
            (operation) => operation.write && operation.sent,
          )
            ? new PersistenceOutcomeUnknownError(failure)
            : undefined;
          if (uncertain) adapter.stopWrites?.(uncertain);
          for (const operation of pending.values())
            operation.reject(
              operation.write && operation.sent ? uncertain! : failure,
            );
          pending.clear();
          worker?.terminate();
          worker = undefined;
          // Retain the accepted mirror; terminal writes cannot recreate this worker.
        };
        worker.onerror = communicationFailed;
        worker.onmessageerror = communicationFailed;
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
        const operation = {
          resolve,
          reject,
          storage,
          method,
          write,
          sent: false,
        };
        pending.set(id, operation);
        try {
          worker!.postMessage({ id, method, args, storage: [...storage] });
          operation.sent = true;
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
    readDayApplicationSnapshot: async (target) =>
      read((await call("readDay", [target])) as WorkerSnapshotRead),
    commitDayApplicationSnapshot: async (snapshot, expectedRoots, target) =>
      readCommitted(
        (await call("commitDay", [
          snapshot,
          (expectedRoots as { workerObservation: number }).workerObservation,
          target,
        ])) as WorkerSnapshotRead,
      ),
    commitDayMutation: async (command, operationId, expectedGenerations) => {
      const result = (await call("day", [
        command,
        operationId,
        expectedGenerations,
      ])) as
        | { status: "review-required" }
        | { status: "committed"; read: WorkerSnapshotRead };
      return result.status === "committed"
        ? { ...result, read: readCommitted(result.read) }
        : result;
    },
    commitShoppingMove: async (command, operationId, expectedGenerations) => {
      const result = (await call("shopping", [
        command,
        operationId,
        expectedGenerations,
      ])) as
        | { status: "review-required" }
        | {
            status: "committed";
            read?: WorkerSnapshotRead;
            deltaError?: boolean;
          };
      if (result.status !== "committed") return result;
      const adopt = (
        value: WorkerSnapshotRead,
        full: boolean,
      ): ApplicationSnapshotRead => {
        if (
          !Number.isSafeInteger(value.observationId) ||
          value.observationId <= mirrorObservation
        )
          throw new Error("Invalid shopping observation.");
        let candidate: PersistenceSnapshot;
        if (full) {
          if (value.consistencyMissing || value.scopeTarget)
            throw new Error("Recovery state is incomplete.");
          if (
            !value.delta.full ||
            value.delta.scope ||
            value.delta.shoppingOrder ||
            value.delta.items?.length ||
            value.delta.branches?.length ||
            Object.keys(value.delta.stores ?? {}).length
          )
            throw new Error("Recovery requires a complete snapshot.");
          candidate = value.delta.full;
          const errors = [
            ...validateSnapshotStructure(candidate),
            ...validateSnapshotReferences(candidate),
          ];
          if (errors.length) throw new Error(errors.join("\n"));
        } else {
          const order = value.delta.shoppingOrder;
          if (
            !mirror ||
            !order ||
            order.eventName !== command.eventName ||
            order.day !== command.day ||
            value.delta.full ||
            value.delta.scope ||
            value.delta.items?.length ||
            Object.keys(value.delta.stores ?? {}).length ||
            value.delta.branches?.some(
              (branch) =>
                branch.eventName !== command.eventName ||
                branch.store === "eventLists" ||
                branch.store === "mapData" ||
                branch.store === "eventMetadata",
            )
          )
            throw new Error("Invalid shopping order delta.");
          for (const branch of value.delta.branches ?? []) {
            const path = branch.path;
            const key = path[0];
            const valid =
              branch.store === "eventConsistency"
                ? path[0] === "days" &&
                  typeof path[1] === "string" &&
                  sameDay(path[1], command.day)
                : branch.store === "executeModeItems" ||
                    branch.store === "dayModes"
                  ? typeof key === "string" && sameDay(key, command.day)
                  : branch.store === "routeSettings" ||
                      branch.store === "hallRouteSettings"
                    ? typeof key === "string" &&
                      (key.startsWith(MAPLESS_HALL_KEY + ":")
                        ? sameDay(
                            key.slice(MAPLESS_HALL_KEY.length + 1),
                            command.day,
                          )
                        : normalizeMapDay(key) === normalizeMapDay(command.day))
                    : false;
            if (!valid)
              throw new Error(
                "Shopping delta changed an unvalidated day or store.",
              );
          }
          candidate = applyShoppingOrderDelta(mirror, order, mirrorObservation);
          candidate = applySnapshotBranches(
            candidate,
            value.delta.branches ?? [],
          );
          const scoped = scopeDaySnapshot(
            candidate,
            command.eventName,
            command.day,
          );
          const maps = new WeakSet<object>(
            Object.values(scoped.mapData[command.eventName] ?? {}).filter(
              (value): value is object => !!value && typeof value === "object",
            ),
          );
          const errors = [
            ...validateSnapshotStructure(scoped, true, maps),
            ...validateSnapshotReferences(scoped, maps),
          ];
          if (errors.length) throw new Error(errors.join("\n"));
        }
        // Publish a fully validated candidate once. Failed deltas cannot pollute recovery.
        mirror = candidate;
        mirrorObservation = value.observationId;
        return {
          snapshot: candidate,
          expectedRoots: { workerObservation: value.observationId },
          consistencyMissing: value.consistencyMissing,
          eventGenerations: value.eventGenerations,
        };
      };
      try {
        if (result.deltaError || !result.read)
          throw new Error("Shopping delta construction failed.");
        return { status: "committed", read: adopt(result.read, false) };
      } catch {
        try {
          return {
            status: "committed",
            read: adopt(
              (await call("readFull", [])) as WorkerSnapshotRead,
              true,
            ),
          };
        } catch (error) {
          const failure = new CommittedStateApplyError(error);
          adapter.stopWrites?.(failure);
          throw failure;
        }
      }
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
        ? { ...result, read: readCommitted(result.read) }
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
  const adapter = createIndexedDbPersistenceCommandAdapter(delegate);
  return {
    ...adapter,
    adoptCommittedSnapshot(snapshot) {
      mirror = snapshot;
    },
    bindApplicationSettings(access) {
      applicationAccess = access;
      const release = adapter.bindApplicationSettings(access);
      return () => {
        if (applicationAccess === access) applicationAccess = undefined;
        release();
      };
    },
  };
}
