import { buildWorkerBackup } from "../worker/backupWorkerServer";
import {
  createPersistenceWriteStopController,
  PersistenceOutcomeUnknownError,
  isPersistenceWriteStopReason,
} from "../../app/ports/PersistenceCommandPort";
import { recordEntry, setOwnValue } from "../../utils/ownRecord";
import { createBackupInWorker } from "./backupWorker";
import { inspectConsistencyUpgrade } from "../db/consistencyUpgrade";
import type {
  PersistenceCommandPort,
  ApplicationDayScope,
  PersistenceSnapshot,
  PreferencePersistencePort,
} from "../../app/ports/PersistenceCommandPort";
import type {
  BlockDetectionSettings,
  BlockDetectionSettingsStore,
} from "../../types/map";
import { createEventConsistency } from "../../types/consistency";
import {
  removeEventFromApplicationSnapshot,
  renameEventInApplicationSnapshot,
} from "../repositories/applicationSnapshotOps";
import { db } from "../facade/indexedDbPersistence";

export type IndexedDbPersistenceCommandDelegate = Pick<
  PersistenceCommandPort,
  | "migrateFromLocalStorage"
  | "saveEventLists"
  | "saveEventMetadata"
  | "saveExecuteModeItems"
  | "saveDayModes"
  | "saveMapDataChanges"
  | "saveMapRotationSettings"
  | "saveRouteSettings"
  | "saveHallDefinitions"
  | "saveHallRouteSettings"
  | "saveMapViewportSettings"
  | "saveEventConsistency"
  | "readApplicationSnapshot"
  | "restoreAppDataAtomically"
  | "commitApplicationSnapshotAtomically"
  | "deleteEventAtomically"
  | "renameEventAtomically"
> & {
  commitItemContentEdits?: PersistenceCommandPort["commitItemContentEdits"];
  commitDayMutation?: PersistenceCommandPort["commitDayMutation"];
  commitShoppingMove?: PersistenceCommandPort["commitShoppingMove"];
  readDayApplicationSnapshot?: PersistenceCommandPort["readDayApplicationSnapshot"];
  commitDayApplicationSnapshot?: PersistenceCommandPort["commitDayApplicationSnapshot"];
  adoptRecoveryCandidate(
    candidate: Parameters<PersistenceCommandPort["adoptRecoveryCandidate"]>[0],
  ): Promise<unknown>;
};
/** Retained as a compatibility type for embedders. Event settings use IndexedDB. */
export interface AuxiliaryPersistenceCommandDelegate extends PreferencePersistencePort {
  readBlockDetectionSettings?(eventName: string): BlockDetectionSettings | null;
  readBlockDetectionSettingsForBackup?(
    eventNames: readonly string[],
  ): BlockDetectionSettingsStore;
  saveBlockDetectionSettings?(
    eventName: string,
    settings: BlockDetectionSettings,
  ): void;
  removeBlockDetectionSettingsForEvent?(eventName: string): void;
  renameBlockDetectionSettingsForEvent?(
    oldEventName: string,
    newEventName: string,
  ): void;
  runWithBlockDetectionSettingsRestore?<T>(
    eventName: string,
    settings: BlockDetectionSettings | null,
    commit: () => Promise<T>,
  ): Promise<T>;
}
const browserPreferences: PreferencePersistencePort = {
  loadPreference: (key) =>
    typeof window === "undefined" ? null : window.localStorage.getItem(key),
  savePreference: (key, value) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  },
};
export function createIndexedDbPersistenceCommandAdapter(
  delegate: IndexedDbPersistenceCommandDelegate = db,
  auxiliary: AuxiliaryPersistenceCommandDelegate = browserPreferences,
): PersistenceCommandPort {
  let access:
    | Parameters<PersistenceCommandPort["bindApplicationSettings"]>[0]
    | null = null;
  const writeStop = createPersistenceWriteStopController();
  let observed: PersistenceSnapshot | null = null;
  const read = () => access?.read() ?? observed;
  const commit: PersistenceCommandPort["commitApplicationSnapshotAtomically"] =
    async (snapshot, options) => {
      await delegate.commitApplicationSnapshotAtomically(snapshot, options);
      try {
        observed = structuredClone(snapshot);
      } catch (error) {
        throw new PersistenceOutcomeUnknownError(error);
      }
    };
  const adapter: PersistenceCommandPort = {
    ...writeStop,
    inspectConsistencyUpgrade,
    ...(delegate.readDayApplicationSnapshot
      ? {
          readDayApplicationSnapshot: async (target: ApplicationDayScope) => {
            const result = await delegate.readDayApplicationSnapshot!(target);
            observed = result.snapshot;
            return result;
          },
          commitDayApplicationSnapshot: async (
            snapshot: PersistenceSnapshot,
            expectedRoots: object,
            target: ApplicationDayScope,
          ) => {
            const result = await delegate.commitDayApplicationSnapshot!(
              snapshot,
              expectedRoots,
              target,
            );
            observed = result.snapshot;
            return result;
          },
        }
      : {}),
    createBackupFile: async (changes, fallback, guardedItemEdits) => {
      if (writeStop.getWriteStopReason() && typeof Worker !== "function") {
        const result = await buildWorkerBackup(
          () => delegate.readApplicationSnapshot(),
          { changes, guardedItemEdits },
        );
        if ("file" in result) return result.file;
        throw writeStop.getWriteStopReason();
      }
      return createBackupInWorker(
        changes,
        () => {
          const reason = writeStop.getWriteStopReason();
          if (reason) throw reason;
          return fallback();
        },
        guardedItemEdits,
      );
    },
    ...(delegate.commitItemContentEdits
      ? {
          commitItemContentEdits: async (...args) => {
            const result = await delegate.commitItemContentEdits!(...args);
            if (result.status === "committed") observed = result.read.snapshot;
            return result;
          },
        }
      : {}),
    ...(delegate.commitShoppingMove
      ? {
          commitShoppingMove: async (
            ...args: Parameters<
              NonNullable<PersistenceCommandPort["commitShoppingMove"]>
            >
          ) => {
            const result = await delegate.commitShoppingMove!(...args);
            if (result.status === "committed") observed = result.read.snapshot;
            return result;
          },
        }
      : {}),
    ...(delegate.commitDayMutation
      ? {
          commitDayMutation: async (
            ...args: Parameters<
              NonNullable<PersistenceCommandPort["commitDayMutation"]>
            >
          ) => {
            const result = await delegate.commitDayMutation!(...args);
            if (result.status === "committed") observed = result.read.snapshot;
            return result;
          },
        }
      : {}),
    loadPreference: (key) => auxiliary.loadPreference(key),
    savePreference: (key, value) => auxiliary.savePreference(key, value),
    bindApplicationSettings(next) {
      access = next;
      return () => {
        if (access === next) access = null;
      };
    },
    async readApplicationSnapshot() {
      const result = await delegate.readApplicationSnapshot();
      observed = result.snapshot;
      return result;
    },
    readBlockDetectionSettings: (eventName) =>
      structuredClone(
        recordEntry(read()?.eventConsistency, eventName)
          ?.blockDetectionSettings ?? null,
      ),
    readBlockDetectionSettingsForBackup(eventNames) {
      const settings: BlockDetectionSettingsStore = {};
      for (const eventName of eventNames) {
        const value = recordEntry(
          read()?.eventConsistency,
          eventName,
        )?.blockDetectionSettings;
        if (value)
          Object.defineProperty(settings, eventName, {
            value: structuredClone(value),
            enumerable: true,
          });
      }
      return settings;
    },
    async saveBlockDetectionSettings(eventName, settings) {
      if (!access) throw new Error("設定の保存処理が初期化されていません。");
      await access.save(eventName, settings);
    },
    removeBlockDetectionSettingsForEvent() {
      throw new Error("設定はイベントと同じ操作で削除してください。");
    },
    renameBlockDetectionSettingsForEvent() {
      throw new Error("設定はイベントと同じ操作で改名してください。");
    },
    migrateFromLocalStorage: () => delegate.migrateFromLocalStorage(),
    async adoptRecoveryCandidate(candidate) {
      await delegate.adoptRecoveryCandidate(candidate);
    },
    saveEventLists: (value) => delegate.saveEventLists(value),
    saveEventMetadata: (value) => delegate.saveEventMetadata(value),
    saveExecuteModeItems: (value) => delegate.saveExecuteModeItems(value),
    saveDayModes: (value) => delegate.saveDayModes(value),
    saveMapDataChanges: (previous, value) =>
      delegate.saveMapDataChanges(previous, value),
    saveMapRotationSettings: (value) => delegate.saveMapRotationSettings(value),
    saveRouteSettings: (value) => delegate.saveRouteSettings(value),
    saveHallDefinitions: (value) => delegate.saveHallDefinitions(value),
    saveHallRouteSettings: (value) => delegate.saveHallRouteSettings(value),
    saveMapViewportSettings: (value) => delegate.saveMapViewportSettings(value),
    saveEventConsistency: (value) => delegate.saveEventConsistency(value),
    commitApplicationSnapshotAtomically: commit,
    restoreAppDataAtomically: (snapshot, options) =>
      commit(snapshot, {
        ...options,
        invalidatedEvents: options?.invalidatedEvents ?? [
          ...new Set([
            ...Object.keys(read()?.eventLists ?? {}),
            ...Object.keys(snapshot.eventLists),
          ]),
        ],
      }),
    deleteEventAtomically: (snapshot, eventName) =>
      commit(removeEventFromApplicationSnapshot(snapshot, eventName), {
        invalidatedEvents: [eventName],
      }),
    renameEventAtomically: (snapshot, oldName, newName) =>
      commit(renameEventInApplicationSnapshot(snapshot, oldName, newName), {
        invalidatedEvents: [oldName, newName],
      }),
    restoreAppDataWithBlockDetectionSettings(snapshot, eventName, settings) {
      const next = structuredClone(snapshot);
      next.eventConsistency ??= {};
      if (!recordEntry(next.eventConsistency, eventName))
        setOwnValue(next.eventConsistency, eventName, createEventConsistency());
      recordEntry(next.eventConsistency, eventName).blockDetectionSettings =
        structuredClone(settings);
      return commit(next, { invalidatedEvents: [eventName] });
    },
  };
  const writeMethods = [
    "migrateFromLocalStorage",
    "adoptRecoveryCandidate",
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
    "saveBlockDetectionSettings",
    "commitApplicationSnapshotAtomically",
    "commitDayApplicationSnapshot",
    "commitDayMutation",
    "commitShoppingMove",
    "commitItemContentEdits",
    "restoreAppDataAtomically",
    "deleteEventAtomically",
    "renameEventAtomically",
    "restoreAppDataWithBlockDetectionSettings",
  ] as const;
  for (const method of writeMethods) {
    const command = adapter[method];
    if (!command) continue;
    Object.assign(adapter, {
      [method]: async (...args: unknown[]) => {
        const stopped = writeStop.getWriteStopReason();
        if (stopped) throw stopped;
        try {
          return await (command as (...args: unknown[]) => unknown)(...args);
        } catch (error) {
          if (isPersistenceWriteStopReason(error)) writeStop.stopWrites(error);
          throw error;
        }
      },
    });
  }
  for (const method of [
    "savePreference",
    "removeBlockDetectionSettingsForEvent",
    "renameBlockDetectionSettingsForEvent",
  ] as const) {
    const command = adapter[method];
    Object.assign(adapter, {
      [method]: (...args: unknown[]) => {
        const stopped = writeStop.getWriteStopReason();
        if (stopped) throw stopped;
        return (command as (...args: unknown[]) => unknown)(...args);
      },
    });
  }
  return adapter;
}
