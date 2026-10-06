import { inspectConsistencyUpgrade } from "../db/consistencyUpgrade";
import type {
  PersistenceCommandPort,
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
  let observed: PersistenceSnapshot | null = null;
  const read = () => access?.read() ?? observed;
  const commit: PersistenceCommandPort["commitApplicationSnapshotAtomically"] =
    async (snapshot, options) => {
      await delegate.commitApplicationSnapshotAtomically(snapshot, options);
      observed = structuredClone(snapshot);
    };
  return {
    inspectConsistencyUpgrade,
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
        read()?.eventConsistency[eventName]?.blockDetectionSettings ?? null,
      ),
    readBlockDetectionSettingsForBackup(eventNames) {
      const settings: BlockDetectionSettingsStore = {};
      for (const eventName of eventNames) {
        const value =
          read()?.eventConsistency[eventName]?.blockDetectionSettings;
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
      next.eventConsistency[eventName] ??= createEventConsistency();
      next.eventConsistency[eventName].blockDetectionSettings =
        structuredClone(settings);
      return commit(next, { invalidatedEvents: [eventName] });
    },
  };
}
