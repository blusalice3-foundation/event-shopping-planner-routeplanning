import type { EventConsistencyStore } from "../../types/consistency";
import type {
  StartupRecoveryBundle,
  StartupRecoveryCandidate,
} from "../../utils/persistenceResilience";
import type {
  BlockDetectionSettings,
  BlockDetectionSettingsStore,
} from "../../types/map";

export class PersistenceSettingsRollbackError extends Error {
  readonly originalError: unknown;
  readonly rollbackError: unknown;

  constructor(originalError: unknown, rollbackError: unknown) {
    super("Auxiliary settings could not be rolled back after restore failure.");
    this.name = "PersistenceSettingsRollbackError";
    this.originalError = originalError;
    this.rollbackError = rollbackError;
  }
}

export interface PersistenceSnapshot {
  eventConsistency: EventConsistencyStore;
  eventLists: Record<string, unknown[]>;
  eventMetadata: Record<string, unknown>;
  executeModeItems: Record<string, Record<string, string[]>>;
  dayModes: Record<string, Record<string, string>>;
  mapData: Record<string, Record<string, unknown>>;
  mapRotationSettings: Record<string, Record<string, unknown>>;
  routeSettings: Record<string, Record<string, unknown>>;
  hallDefinitions: Record<string, Record<string, unknown[]>>;
  hallRouteSettings: Record<string, Record<string, unknown>>;
  mapViewportSettings: Record<string, Record<string, unknown>>;
}

/**
 * Public compatibility name for the application-level persistence snapshot.
 *
 * Keep the shape owned by this neutral port so feature code and persistence
 * adapters do not depend on one another for a type-only contract.
 */
export type AppData = PersistenceSnapshot;
/** Opaque revision/digest/checkpoint observation tied to the returned snapshot. */
export interface ApplicationSnapshotRead {
  snapshot: PersistenceSnapshot;
  expectedRoots: object;
  consistencyMissing: boolean;
}
export interface AtomicSnapshotOptions {
  expectedRoots?: object;
  migration?: { source: unknown; blockDetectionSettingsRaw: string | null };
}

export type PersistenceMigrationCleanupStatus =
  | "not-needed"
  | "not-ready"
  | "ready"
  | "deferred"
  | "in-progress"
  | "completed"
  | "recovery-required";

export type PersistenceMigrationCommandResult =
  | {
      status: "not-needed" | "completed" | "cleanup-pending";
      cleanupStatus?: Exclude<
        PersistenceMigrationCleanupStatus,
        "recovery-required"
      >;
    }
  | {
      status: "recovery-required";
      cleanupStatus?: PersistenceMigrationCleanupStatus;
      recoveryBundle: StartupRecoveryBundle;
    };

export interface PreferencePersistencePort {
  loadPreference(key: string): string | null;
  savePreference(key: string, value: string): void;
}

export interface ConsistencyUpgradeArchive {
  kind: "event-shopping-planner-pre-upgrade";
  version: 1;
  databaseVersion: number;
  exportedAt: string;
  stores: Record<string, Array<{ key: IDBValidKey; value: unknown }>>;
  localStorage: Record<string, string>;
}
export interface PersistenceCommandPort extends PreferencePersistencePort {
  inspectConsistencyUpgrade(): Promise<ConsistencyUpgradeArchive | null>;
  bindApplicationSettings(access: {
    read(): PersistenceSnapshot;
    save(
      eventName: string,
      settings: BlockDetectionSettings | null,
    ): Promise<void>;
  }): () => void;
  readApplicationSnapshot(): Promise<ApplicationSnapshotRead>;
  saveEventConsistency(
    value: PersistenceSnapshot["eventConsistency"],
  ): Promise<void>;
  readBlockDetectionSettings(eventName: string): BlockDetectionSettings | null;
  readBlockDetectionSettingsForBackup(
    eventNames: readonly string[],
  ): BlockDetectionSettingsStore;
  saveBlockDetectionSettings(
    eventName: string,
    settings: BlockDetectionSettings,
  ): Promise<void>;
  removeBlockDetectionSettingsForEvent(eventName: string): void;
  renameBlockDetectionSettingsForEvent(
    oldEventName: string,
    newEventName: string,
  ): void;
  migrateFromLocalStorage(): Promise<PersistenceMigrationCommandResult>;
  adoptRecoveryCandidate(candidate: StartupRecoveryCandidate): Promise<void>;
  saveEventLists(value: PersistenceSnapshot["eventLists"]): Promise<void>;
  saveEventMetadata(value: PersistenceSnapshot["eventMetadata"]): Promise<void>;
  saveExecuteModeItems(
    value: PersistenceSnapshot["executeModeItems"],
  ): Promise<void>;
  saveDayModes(value: PersistenceSnapshot["dayModes"]): Promise<void>;
  saveMapDataChanges(
    previousValue: PersistenceSnapshot["mapData"],
    value: PersistenceSnapshot["mapData"],
  ): Promise<void>;
  saveMapRotationSettings(
    value: PersistenceSnapshot["mapRotationSettings"],
  ): Promise<void>;
  saveRouteSettings(value: PersistenceSnapshot["routeSettings"]): Promise<void>;
  saveHallDefinitions(
    value: PersistenceSnapshot["hallDefinitions"],
  ): Promise<void>;
  saveHallRouteSettings(
    value: PersistenceSnapshot["hallRouteSettings"],
  ): Promise<void>;
  saveMapViewportSettings(
    value: PersistenceSnapshot["mapViewportSettings"],
  ): Promise<void>;
  restoreAppDataAtomically(
    snapshot: PersistenceSnapshot,
    options?: AtomicSnapshotOptions,
  ): Promise<void>;
  commitApplicationSnapshotAtomically(
    snapshot: PersistenceSnapshot,
    options?: AtomicSnapshotOptions,
  ): Promise<void>;
  deleteEventAtomically(
    snapshot: PersistenceSnapshot,
    eventName: string,
  ): Promise<void>;
  renameEventAtomically(
    snapshot: PersistenceSnapshot,
    oldEventName: string,
    newEventName: string,
  ): Promise<void>;
  restoreAppDataWithBlockDetectionSettings(
    snapshot: PersistenceSnapshot,
    eventName: string,
    settings: BlockDetectionSettings | null,
  ): Promise<void>;
}
