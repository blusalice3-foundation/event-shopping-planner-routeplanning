import type { LimitedPurchaseDialogResult } from "../../types/limitedPurchase";
import type { EventConsistencyStore } from "../../types/consistency";
import type {
  StartupRecoveryBundle,
  StartupRecoveryCandidate,
} from "../../utils/persistenceResilience";
import type {
  BlockDetectionSettings,
  BlockDetectionSettingsStore,
  MapViewportState,
} from "../../types/map";

/** A sent write may have committed even though its response never arrived. */
export class PersistenceOutcomeUnknownError extends Error {
  constructor(readonly cause?: unknown) {
    super(
      "保存結果を確認できません。再送せず、JSONバックアップを保存して再読み込みしてください。",
    );
    this.name = "PersistenceOutcomeUnknownError";
  }
}
/** Neutral error boundary shared by UI coordination and persistence adapters. */
export type PersistenceWriteStopReason = Error;
export function isPersistenceWriteStopReason(
  error: unknown,
): error is PersistenceWriteStopReason {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  return (
    name === "PersistenceOutcomeUnknownError" ||
    name === "CommittedStateApplyError"
  );
}
export function createPersistenceWriteStopController() {
  let reason: PersistenceWriteStopReason | undefined;
  const listeners = new Set<(reason: PersistenceWriteStopReason) => void>();
  return {
    getWriteStopReason: () => reason,
    stopWrites(next: PersistenceWriteStopReason) {
      if (reason) return;
      reason = next;
      for (const listener of listeners) {
        try {
          listener(next);
        } catch {
          /* All owners must observe the stop. */
        }
      }
    },
    onWritesStopped(listener: (reason: PersistenceWriteStopReason) => void) {
      listeners.add(listener);
      if (reason) listener(reason);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
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

export interface ItemContentGuard {
  readonly kind: "limited-single" | "limited-list" | "limited-focus";
  readonly operationId: string;
  readonly itemId: string;
  readonly eventName: string;
  readonly day: string;
  readonly eventGeneration: number;
  readonly visitKey?: string;
  readonly requireExecute: boolean;
  readonly mapContext?: string;
}
export interface ItemContentEdit {
  readonly limitedPurchase?: LimitedPurchaseDialogResult;
  readonly operationKind?: "limited-input";
  readonly guard?: ItemContentGuard;
  readonly eventName: string;
  readonly itemId: string;
  readonly baseline?: Readonly<Record<string, unknown>>;
  readonly fields: Readonly<
    Record<string, { present: boolean; value: unknown }>
  >;
}
export interface ApplicationBackupChange {
  store: keyof PersistenceSnapshot;
  eventName: string;
  baseline: unknown;
  desired: unknown;
}
export interface ApplicationBackupFile {
  blob: Blob;
  exportedAt: string;
}
/** A compound visit transition may touch its source day and one destination day. */
export interface ApplicationDayScope {
  eventName: string;
  day: string;
  additionalDays?: readonly string[];
}
/** A command contains only the affected event/day and proposed field changes. */
export type ApplicationDayMutation =
  | {
      kind: "mode";
      eventName: string;
      day: string;
      mode?: "edit" | "execute" | "focus";
    }
  | {
      kind: "patch";
      eventName: string;
      day: string;
      baseline: Partial<PersistenceSnapshot>;
      desired: Partial<PersistenceSnapshot>;
      routeDays?: Record<string, Record<string, string[]>>;
    }
  | {
      kind: "visits";
      eventName: string;
      day: string;
      mapKey: string;
      /** Omit order when accepting the current durable visit order. */
      order?: readonly string[];
      modeDay?: string;
    }
  | { kind: "day-merge"; eventName: string; day: string }
  | {
      kind: "map-viewport";
      eventName: string;
      day: string;
      mapKey: string;
      viewport: MapViewportState;
    };
/** Serializable, order-only intent. Item content is always taken from current storage. */
export interface ApplicationShoppingMove {
  version: 1;
  eventName: string;
  day: string;
  sourceColumn: "execute" | "candidate";
  targetColumn: "execute" | "candidate";
  requestedIds: readonly string[];
  effectiveIds: readonly string[];
  hoverId: string;
  candidateSortMode?: string;
  baselineVisits: readonly { id: string; key: string }[];
  baselineItemIds: readonly string[];
  itemIds: readonly string[];
  baselineExecuteIds: readonly string[];
  executeIds: readonly string[];
}
export type ApplicationItemEditsResult =
  | { status: "committed"; read: ApplicationSnapshotRead }
  | { status: "review-required" };

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
  /** Worker-internal scoped observation; the adapter merges it into retained UI state. */
  scopeTarget?: ApplicationDayScope;
  /** Internal lifecycle counters; excluded from application backups. */
  eventGenerations?: Readonly<Record<string, number>>;
}
export interface AtomicSnapshotOptions {
  expectedRoots?: object;
  /** Keep CAS checks for all stores, but write only changed initialized payloads. */
  changedStoresOnly?: boolean;
  invalidatedEvents?: readonly string[];
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
  /** Terminal until reload; registration and notification are synchronous and idempotent. */
  stopWrites?(reason: PersistenceWriteStopReason): void;
  getWriteStopReason?(): PersistenceWriteStopReason | undefined;
  onWritesStopped?(
    listener: (reason: PersistenceWriteStopReason) => void,
  ): () => void;
  /** Align the local worker mirror with immutable state adopted after a durable commit. */
  adoptCommittedSnapshot?(snapshot: PersistenceSnapshot): void;
  inspectConsistencyUpgrade(): Promise<ConsistencyUpgradeArchive | null>;
  bindApplicationSettings(access: {
    read(): PersistenceSnapshot;
    save(
      eventName: string,
      settings: BlockDetectionSettings | null,
    ): Promise<void>;
  }): () => void;
  readApplicationSnapshot(): Promise<ApplicationSnapshotRead>;
  readDayApplicationSnapshot?(
    target: ApplicationDayScope,
  ): Promise<ApplicationSnapshotRead>;
  commitDayApplicationSnapshot?(
    snapshot: PersistenceSnapshot,
    expectedRoots: object,
    target: ApplicationDayScope,
  ): Promise<ApplicationSnapshotRead>;
  commitItemContentEdits?(
    edits: readonly ItemContentEdit[],
    operationIds: readonly string[],
    expectedEventGenerations: Readonly<Record<string, number>>,
  ): Promise<ApplicationItemEditsResult>;
  createBackupFile?(
    changes: readonly ApplicationBackupChange[],
    fallback: () => PersistenceSnapshot,
    guardedItemEdits?: readonly ItemContentEdit[],
  ): Promise<ApplicationBackupFile>;
  commitDayMutation?(
    command: ApplicationDayMutation,
    operationId: string,
    expectedEventGenerations: Readonly<Record<string, number>>,
  ): Promise<ApplicationItemEditsResult>;
  commitShoppingMove?(
    command: ApplicationShoppingMove,
    operationId: string,
    expectedEventGenerations: Readonly<Record<string, number>>,
  ): Promise<ApplicationItemEditsResult>;
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
