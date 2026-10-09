import { RUNTIME_FALLBACK_NAMESPACE } from "../../utils/persistenceResilience";
import {
  sameDay,
  normalizeMapDay,
} from "../../features/consistency/domain/context";
import { MAPLESS_HALL_KEY } from "../../types/map";
import { semanticEqual } from "../../utils/semanticEquality";
import {
  readDayRecordPayload,
  dayRecordStores,
  partitionDayRecordStore,
  patchDayRecordStore,
  enqueueDayRecordWrite,
  adoptDayRecordWrite,
  assertDayRecordsUnchanged,
  DAY_RECORD_PREFIX,
  type DayRecordState,
  type DayRecordWrite,
} from "./dayRecordStorage";
import { assertEventConsistency } from "../../types/consistencyValidation";
/**
 * Atomic full-application restore transaction.
 *
 * Observation, CAS validation, writes, metadata, checkpoints, and fallback
 * cleanup are committed as one operation without exposing partial state.
 */

import type {
  AppData,
  ApplicationSnapshotRead,
  AtomicSnapshotOptions,
} from "../../app/ports/PersistenceCommandPort";
import type { MapDataStore } from "../../types/map";
import {
  isExpandedMapDataNormalizedForPersistence,
  normalizeMapDataForPersistence,
} from "../../utils/mapDataPersistence";
import {
  createPersistenceCheckpointKey,
  createPersistenceDigest,
  verifyPersistenceDigest,
  isPersistenceDigestDescriptor,
  createPersistenceMetadataKey,
  reconcileRuntimeFallbackCandidates,
  type PersistenceCheckpoint,
} from "../../utils/persistenceResilience";
import {
  CONSISTENCY_ARCHIVE_KEY,
  EVENT_GENERATIONS_KEY,
  CONSISTENCY_MIGRATION_KEY,
  DATA_KEY,
  STORES,
  type StoreName,
} from "./constants";
import { PersistenceConflictError } from "./errors";
import { ensureStoreExists, openDatabase as openDB } from "./openDatabase";
import {
  openCoordinatedTransaction,
  requestResult,
  transactionFinished,
} from "./transactionCoordinator";
import {
  createConflictLoadResult,
  createRecoveryCandidate,
  assertCurrentCheckpointMatchesExpected,
  assertCurrentSnapshotMatchesExpected,
  cleanupRuntimeCandidateSnapshots,
  createNextPersistenceCheckpoint,
  expectedPersistenceCheckpoints,
  expectedRevisionRoots,
  getObservedRootKey,
  partitionRuntimeCandidateSnapshots,
  prepareMetadataForPayload,
  readRuntimeCandidateSnapshots,
  validatePersistenceSnapshot,
  isStoredPersistenceMetadata,
  immutableObservedRootFieldsMatch,
  type ObservedRevisionRoot,
  type RuntimeCandidateSnapshot,
  type StoredPersistenceMetadata,
} from "../internal/persistenceCore";
import {
  assertCurrentMapMatchesExpected,
  buildMapDataPuts,
  readMapEntriesFromStore,
  validateMapSnapshot,
} from "../repositories/mapRepository";

export const APPLICATION_SNAPSHOT_STORE_NAMES = [
  STORES.EVENT_LISTS,
  STORES.EVENT_CONSISTENCY,
  STORES.EVENT_METADATA,
  STORES.EXECUTE_MODE_ITEMS,
  STORES.DAY_MODES,
  STORES.MAP_DATA,
  STORES.MAP_ROTATION_SETTINGS,
  STORES.ROUTE_SETTINGS,
  STORES.HALL_DEFINITIONS,
  STORES.HALL_ROUTE_SETTINGS,
  STORES.MAP_VIEWPORT_SETTINGS,
] as const;

interface AppDataRestoreObservation {
  roots: Map<StoreName, ObservedRevisionRoot>;
  snapshot: AppData;
  consistencyMissing: boolean;
  mapDataNormalized: boolean;
  journal: unknown;
  archive: unknown;
  eventGenerations: Record<string, number>;
  checkpoints: Map<StoreName, PersistenceCheckpoint | null>;
  runtimeCandidates: RuntimeCandidateSnapshot<unknown>[];
  dayRecords: Map<StoreName, DayRecordState>;
}

// Opaque read handles keep the verified baseline private. Caller snapshots and
// diagnostic roots can be changed without mutating the data reused at commit.
const applicationSnapshotObservations = new WeakMap<
  object,
  AppDataRestoreObservation
>();

async function validateConsistencyMigrationEvidence(
  journal: unknown,
  archive: unknown,
  consistencyMissing: boolean,
): Promise<void> {
  if (journal === undefined && archive === undefined) return;
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const valid =
    !consistencyMissing &&
    record(journal) &&
    record(archive) &&
    journal.kind === "event-shopping-planner-consistency-migration" &&
    journal.version === 1 &&
    archive.kind === "event-shopping-planner-consistency-archive" &&
    archive.version === 1 &&
    typeof journal.targetRevision === "string" &&
    journal.targetRevision.length > 0 &&
    isPersistenceDigestDescriptor(journal.sourceDigest) &&
    isPersistenceDigestDescriptor(archive.sourceDigest) &&
    JSON.stringify(journal.sourceDigest) ===
      JSON.stringify(archive.sourceDigest) &&
    (await verifyPersistenceDigest(
      {
        source: archive.source,
        blockDetectionSettingsRaw: archive.blockDetectionSettingsRaw,
      },
      archive.sourceDigest,
    ));
  if (valid) return;
  const conflict = createConflictLoadResult(
    "関連設定の移行記録または保全データが一致しません。元のデータを保全して復旧してください。",
    STORES.EVENT_CONSISTENCY,
    [
      createRecoveryCandidate(
        "indexedDB",
        STORES.SYNC_QUEUE,
        CONSISTENCY_MIGRATION_KEY,
        null,
        journal,
      ),
      createRecoveryCandidate(
        "indexedDB",
        STORES.SYNC_QUEUE,
        CONSISTENCY_ARCHIVE_KEY,
        null,
        archive,
      ),
    ],
  );
  throw Object.assign(
    new PersistenceConflictError("関連設定の移行記録を検証できません。"),
    { recoveryBundle: conflict.recoveryBundle },
  );
}

function storedValuesEqual(left: unknown, right: unknown): boolean {
  const pending: Array<[unknown, unknown]> = [[left, right]];
  const leftToRight = new WeakMap<object, object>();
  const rightToLeft = new WeakMap<object, object>();

  while (pending.length > 0) {
    const [currentLeft, currentRight] = pending.pop()!;
    if (Object.is(currentLeft, currentRight)) continue;
    if (
      typeof currentLeft !== "object" ||
      currentLeft === null ||
      typeof currentRight !== "object" ||
      currentRight === null
    ) {
      return false;
    }

    const mappedRight = leftToRight.get(currentLeft);
    const mappedLeft = rightToLeft.get(currentRight);
    if (mappedRight !== undefined || mappedLeft !== undefined) {
      if (mappedRight !== currentRight || mappedLeft !== currentLeft) {
        return false;
      }
      continue;
    }
    leftToRight.set(currentLeft, currentRight);
    rightToLeft.set(currentRight, currentLeft);

    if (
      Array.isArray(currentLeft) !== Array.isArray(currentRight) ||
      Object.getPrototypeOf(currentLeft) !== Object.getPrototypeOf(currentRight)
    ) {
      return false;
    }

    const leftKeys = Reflect.ownKeys(currentLeft);
    const rightKeys = Reflect.ownKeys(currentRight);
    if (
      leftKeys.length !== rightKeys.length ||
      leftKeys.some((key, index) => key !== rightKeys[index])
    ) {
      return false;
    }

    for (const key of leftKeys) {
      const leftDescriptor = Object.getOwnPropertyDescriptor(currentLeft, key);
      const rightDescriptor = Object.getOwnPropertyDescriptor(
        currentRight,
        key,
      );
      if (
        !leftDescriptor ||
        !rightDescriptor ||
        leftDescriptor.enumerable !== rightDescriptor.enumerable ||
        leftDescriptor.configurable !== rightDescriptor.configurable ||
        "value" in leftDescriptor !== "value" in rightDescriptor
      ) {
        return false;
      }
      if ("value" in leftDescriptor && "value" in rightDescriptor) {
        if (leftDescriptor.writable !== rightDescriptor.writable) return false;
        pending.push([leftDescriptor.value, rightDescriptor.value]);
      } else if (
        leftDescriptor.get !== rightDescriptor.get ||
        leftDescriptor.set !== rightDescriptor.set
      ) {
        return false;
      }
    }
  }

  return true;
}

function readEventGenerations(value: unknown): Record<string, number> {
  if (value === undefined) return {};
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.values(value).some(
      (generation) => !Number.isSafeInteger(generation) || generation < 0,
    )
  )
    throw new PersistenceConflictError("イベントの操作世代を検証できません。");
  return value as Record<string, number>;
}

async function observeAppDataRestoreState(): Promise<AppDataRestoreObservation> {
  const database = await openDB();
  const transaction = openCoordinatedTransaction(
    database,
    [...APPLICATION_SNAPSHOT_STORE_NAMES, STORES.SYNC_QUEUE],
    "readonly",
  );
  const finished = transactionFinished(transaction);
  const raw = new Map<
    StoreName,
    {
      payload: unknown;
      metadata: unknown;
      checkpoint: unknown;
      dayRecords?: Map<string, unknown>;
    }
  >();
  const journalRequest = requestResult(
    transaction.objectStore(STORES.SYNC_QUEUE).get(CONSISTENCY_MIGRATION_KEY),
  );
  const archiveRequest = requestResult(
    transaction.objectStore(STORES.SYNC_QUEUE).get(CONSISTENCY_ARCHIVE_KEY),
  );
  const generationsRequest = requestResult(
    transaction.objectStore(STORES.SYNC_QUEUE).get(EVENT_GENERATIONS_KEY),
  );
  const reads = APPLICATION_SNAPSHOT_STORE_NAMES.map(async (storeName) => {
    const payloadPromise =
      storeName === STORES.MAP_DATA
        ? readMapEntriesFromStore(transaction.objectStore(storeName)).then(
            (payload) => ({ payload }),
          )
        : readDayRecordPayload(transaction.objectStore(storeName));
    const metadataPromise = requestResult(
      transaction
        .objectStore(STORES.SYNC_QUEUE)
        .get(createPersistenceMetadataKey(storeName, DATA_KEY)),
    );
    const checkpointPromise = requestResult(
      transaction
        .objectStore(STORES.SYNC_QUEUE)
        .get(createPersistenceCheckpointKey(storeName, DATA_KEY)),
    );
    const [payload, metadata, checkpoint] = await Promise.all([
      payloadPromise,
      metadataPromise,
      checkpointPromise,
    ]);
    raw.set(storeName, { ...payload, metadata, checkpoint });
  });
  await Promise.all([...reads, finished]);
  const [journal, archive, rawGenerations] = await Promise.all([
    journalRequest,
    archiveRequest,
    generationsRequest,
  ]);
  const eventGenerations = readEventGenerations(rawGenerations);
  const consistencyMissing =
    raw.get(STORES.EVENT_CONSISTENCY)?.payload === undefined;
  await validateConsistencyMigrationEvidence(
    journal,
    archive,
    consistencyMissing,
  );
  const snapshot = {} as AppData;
  const roots = new Map<StoreName, ObservedRevisionRoot>();
  const checkpoints = new Map<StoreName, PersistenceCheckpoint | null>();
  const runtimeCandidates: RuntimeCandidateSnapshot<unknown>[] = [];
  const dayRecords = new Map<StoreName, DayRecordState>();

  await Promise.all(
    APPLICATION_SNAPSHOT_STORE_NAMES.map(async (storeName) => {
      if (storeName === STORES.MAP_DATA) {
        const validation = await validateMapSnapshot({
          entries: raw.get(storeName)!.payload as Record<string, unknown>,
          metadata: raw.get(storeName)!.metadata,
          checkpoint: raw.get(storeName)!.checkpoint,
        });
        if ("conflict" in validation) {
          throw (
            validation.conflict.error ??
            new PersistenceConflictError(
              "mapData is inconsistent before atomic restore.",
            )
          );
        }
        snapshot.mapData = validation.validated.data ?? {};
        Object.assign(snapshot, {
          [storeName]: validation.validated.data ?? {},
        });
        roots.set(storeName, validation.validated.root);
        checkpoints.set(storeName, validation.validated.checkpoint);
        return;
      }

      const rawSnapshot = raw.get(storeName)!;
      const candidateScan = await readRuntimeCandidateSnapshots<unknown>(
        storeName,
        DATA_KEY,
      );
      const validation = await validatePersistenceSnapshot<unknown>(
        storeName,
        DATA_KEY,
        rawSnapshot,
      );
      if ("conflict" in validation) {
        throw (
          validation.conflict.error ??
          new PersistenceConflictError(
            `${storeName} is inconsistent before atomic restore.`,
          )
        );
      }
      if (candidateScan.status === "conflict") {
        throw (
          candidateScan.result.error ??
          new PersistenceConflictError(
            `${storeName} has an invalid runtime fallback before restore.`,
          )
        );
      }
      const partitioned = partitionRuntimeCandidateSnapshots(
        validation.validated.checkpoint,
        candidateScan.snapshots,
      );
      const reconciliation = reconcileRuntimeFallbackCandidates(
        {
          revision: validation.validated.root.missing
            ? null
            : validation.validated.root.revision,
          baseRevision: validation.validated.root.missing
            ? null
            : validation.validated.root.baseRevision,
          digest: validation.validated.root.missing
            ? undefined
            : validation.validated.root.payloadDigest,
          writerId: validation.validated.root.missing
            ? undefined
            : validation.validated.root.writerId,
          createdAt: validation.validated.root.missing
            ? undefined
            : validation.validated.root.committedAt,
        },
        partitioned.active.map(({ candidate }) => candidate),
        validation.validated.checkpoint?.absorbedCandidates ?? [],
      );
      if (reconciliation.status === "conflict" || reconciliation.head) {
        throw new PersistenceConflictError(
          `${storeName} has an unresolved runtime fallback before restore.`,
        );
      }
      Object.assign(snapshot, { [storeName]: validation.validated.data ?? {} });
      roots.set(storeName, validation.validated.root);
      checkpoints.set(storeName, validation.validated.checkpoint);
      runtimeCandidates.push(...candidateScan.snapshots);
      if (validation.validated.dayRecordState)
        dayRecords.set(storeName, validation.validated.dayRecordState);
    }),
  );

  return {
    roots,
    checkpoints,
    runtimeCandidates,
    snapshot,
    mapDataNormalized: isExpandedMapDataNormalizedForPersistence(
      snapshot.mapData as MapDataStore,
    ),
    consistencyMissing,
    journal,
    archive,
    eventGenerations,
    dayRecords,
  };
}

let verifiedCommandCache:
  | {
      database: IDBDatabase;
      observation: AppDataRestoreObservation;
      fallbackKey: string;
    }
  | undefined;
const dayCommandObservations = new WeakSet<object>();
const frozenCommandValues = new WeakSet<object>();
function freezeCommandValue(value: unknown): void {
  if (!value || typeof value !== "object" || frozenCommandValues.has(value))
    return;
  frozenCommandValues.add(value);
  for (const entry of Object.values(value)) freezeCommandValue(entry);
  Object.freeze(value);
}
function captureCommandChanges(before: unknown, after: unknown): unknown {
  if (before === after) return before;
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    return Object.fromEntries(
      Object.entries(after).map(([key, value]) => [
        key,
        captureCommandChanges((before as Record<string, unknown>)[key], value),
      ]),
    );
  }
  return structuredClone(after);
}
function runtimeFallbackKey(): string {
  if (typeof localStorage === "undefined") return "";
  const entries: Array<[string, string | null]> = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(RUNTIME_FALLBACK_NAMESPACE))
      entries.push([key, localStorage.getItem(key)]);
  }
  return JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b)));
}
function rememberObservation(
  observation: AppDataRestoreObservation,
  share = false,
): ApplicationSnapshotRead {
  observation.roots.forEach((root, store) =>
    expectedRevisionRoots.set(getObservedRootKey(store, DATA_KEY), root),
  );
  observation.checkpoints.forEach((checkpoint, store) =>
    expectedPersistenceCheckpoints.set(
      getObservedRootKey(store, DATA_KEY),
      checkpoint,
    ),
  );
  const expectedRoots = { roots: structuredClone(observation.roots) };
  applicationSnapshotObservations.set(expectedRoots, observation);
  if (share) {
    freezeCommandValue(observation.snapshot);
    dayCommandObservations.add(expectedRoots);
  }
  return {
    snapshot: share
      ? observation.snapshot
      : structuredClone(observation.snapshot),
    expectedRoots,
    consistencyMissing: observation.consistencyMissing,
    eventGenerations: { ...observation.eventGenerations },
  };
}

/** Worker-owned immutable cache. Every transaction still checks all revision/checkpoint heads. */
export async function readDayCommandSnapshot(): Promise<ApplicationSnapshotRead> {
  const database = await openDB();
  const cached = verifiedCommandCache;
  const fallbackKey = runtimeFallbackKey();
  if (
    cached?.database === database &&
    cached.fallbackKey === fallbackKey &&
    cached.observation.runtimeCandidates.length === 0 &&
    !cached.observation.consistencyMissing &&
    APPLICATION_SNAPSHOT_STORE_NAMES.every(
      (store) =>
        !cached.observation.roots.get(store)?.synthetic &&
        cached.observation.checkpoints.get(store) != null,
    )
  ) {
    const transaction = openCoordinatedTransaction(
      database,
      [STORES.SYNC_QUEUE],
      "readonly",
    );
    const finished = transactionFinished(transaction);
    const control = transaction.objectStore(STORES.SYNC_QUEUE);
    const reads = APPLICATION_SNAPSHOT_STORE_NAMES.map(async (store) => {
      const [metadata, checkpoint] = await Promise.all([
        requestResult(
          control.get(createPersistenceMetadataKey(store, DATA_KEY)),
        ),
        requestResult(
          control.get(createPersistenceCheckpointKey(store, DATA_KEY)),
        ),
      ]);
      const root = cached.observation.roots.get(store)!;
      if (
        !isStoredPersistenceMetadata(metadata, store, DATA_KEY) ||
        !immutableObservedRootFieldsMatch(metadata, root)
      )
        return false;
      try {
        assertCurrentCheckpointMatchesExpected(
          store,
          DATA_KEY,
          checkpoint,
          cached.observation.checkpoints.get(store)!,
        );
      } catch {
        return false;
      }
      return true;
    });
    const journal = requestResult(control.get(CONSISTENCY_MIGRATION_KEY));
    const archive = requestResult(control.get(CONSISTENCY_ARCHIVE_KEY));
    const generations = requestResult(control.get(EVENT_GENERATIONS_KEY));
    const heads = await Promise.all(reads);
    const evidence = await Promise.all([
      journal,
      archive,
      generations,
      finished,
    ]);
    if (
      heads.every(Boolean) &&
      storedValuesEqual(evidence[0], cached.observation.journal) &&
      storedValuesEqual(evidence[1], cached.observation.archive) &&
      storedValuesEqual(
        readEventGenerations(evidence[2]),
        cached.observation.eventGenerations,
      )
    )
      return rememberObservation(cached.observation, true);
  }
  verifiedCommandCache = undefined;
  const observation = await observeAppDataRestoreState();
  verifiedCommandCache = {
    database,
    observation,
    fallbackKey: runtimeFallbackKey(),
  };
  return rememberObservation(
    observation,
    APPLICATION_SNAPSHOT_STORE_NAMES.every(
      (store) =>
        !observation.roots.get(store)?.synthetic &&
        observation.checkpoints.get(store) != null,
    ),
  );
}
export async function commitDayCommandSnapshot(
  data: AppData,
  expectedRoots: object,
  target: { eventName: string; day: string },
): Promise<void> {
  await commitApplicationSnapshotAtomically(
    data,
    {
      expectedRoots,
      changedStoresOnly: true,
    },
    target,
  );
}
export async function readApplicationSnapshot(): Promise<ApplicationSnapshotRead> {
  const observation = await observeAppDataRestoreState();
  verifiedCommandCache = {
    database: await openDB(),
    observation,
    fallbackKey: runtimeFallbackKey(),
  };
  observation.roots.forEach((root, store) =>
    expectedRevisionRoots.set(getObservedRootKey(store, DATA_KEY), root),
  );
  observation.checkpoints.forEach((checkpoint, store) =>
    expectedPersistenceCheckpoints.set(
      getObservedRootKey(store, DATA_KEY),
      checkpoint,
    ),
  );
  const expectedRoots = { roots: structuredClone(observation.roots) };
  applicationSnapshotObservations.set(expectedRoots, observation);
  return {
    snapshot: structuredClone(observation.snapshot),
    expectedRoots,
    consistencyMissing: observation.consistencyMissing,
    eventGenerations: structuredClone(observation.eventGenerations),
  };
}
export async function commitApplicationSnapshotAtomically(
  data: AppData,
  options: AtomicSnapshotOptions = {},
  dayTarget?: { eventName: string; day: string },
): Promise<void> {
  const verifiedCommand =
    !!options.expectedRoots &&
    dayCommandObservations.has(options.expectedRoots);
  if (!verifiedCommand) assertEventConsistency(data.eventConsistency);
  const ownedObservation = options.expectedRoots
    ? applicationSnapshotObservations.get(options.expectedRoots)
    : undefined;
  const mapDescriptor = Object.getOwnPropertyDescriptor(data, "mapData");
  const reuseUnchangedMap =
    options.changedStoresOnly &&
    !options.migration &&
    ownedObservation !== undefined &&
    ownedObservation.mapDataNormalized &&
    !ownedObservation.roots.get(STORES.MAP_DATA)?.synthetic &&
    ownedObservation.checkpoints.get(STORES.MAP_DATA) != null &&
    mapDescriptor?.enumerable === true &&
    "value" in mapDescriptor &&
    (verifiedCommand
      ? mapDescriptor.value === ownedObservation.snapshot.mapData
      : storedValuesEqual(
          mapDescriptor.value,
          ownedObservation.snapshot.mapData,
        ));
  // Capture all mutable caller data before awaiting. Only a private, previously
  // validated and unchanged map may bypass full restore preparation.
  const stableData: AppData =
    verifiedCommand && ownedObservation
      ? (captureCommandChanges(ownedObservation.snapshot, data) as AppData)
      : reuseUnchangedMap
        ? {
            ...structuredClone({ ...data, mapData: {} }),
            mapData: ownedObservation.snapshot.mapData,
          }
        : structuredClone(data);
  const stableMapData = reuseUnchangedMap
    ? (stableData.mapData as MapDataStore)
    : normalizeMapDataForPersistence(stableData.mapData as MapDataStore);
  stableData.mapData = stableMapData;
  const rememberedRoots = new Map(expectedRevisionRoots);
  const observation =
    ownedObservation ??
    (options.expectedRoots
      ? (options.expectedRoots as AppDataRestoreObservation)
      : await observeAppDataRestoreState());
  if (
    !(observation.roots instanceof Map) ||
    !(observation.checkpoints instanceof Map)
  )
    throw new Error("保存の計算基準が不正です。");
  if (!options.expectedRoots)
    for (const [store, root] of observation.roots) {
      const previous = rememberedRoots.get(getObservedRootKey(store, DATA_KEY));
      if (
        previous &&
        (previous.revision !== root.revision ||
          previous.missing !== root.missing)
      )
        throw new PersistenceConflictError(
          "計算後に保存データが変更されました。",
        );
    }
  if (
    options.migration &&
    (!observation.consistencyMissing ||
      observation.journal !== undefined ||
      observation.archive !== undefined)
  )
    throw new PersistenceConflictError(
      "移行済みの保全記録は上書きできません。",
    );
  const migrationDigest = options.migration
    ? await createPersistenceDigest(options.migration)
    : null;
  const database = await openDB();
  APPLICATION_SNAPSHOT_STORE_NAMES.forEach((storeName) => {
    ensureStoreExists(database, storeName);
  });
  ensureStoreExists(database, STORES.SYNC_QUEUE);

  const restorePayloads = new Map<StoreName, unknown>([
    [STORES.EVENT_LISTS, stableData.eventLists],
    [STORES.EVENT_CONSISTENCY, stableData.eventConsistency],
    [STORES.EVENT_METADATA, stableData.eventMetadata],
    [STORES.EXECUTE_MODE_ITEMS, stableData.executeModeItems],
    [STORES.DAY_MODES, stableData.dayModes],
    [STORES.MAP_DATA, stableMapData],
    [STORES.MAP_ROTATION_SETTINGS, stableData.mapRotationSettings],
    [STORES.ROUTE_SETTINGS, stableData.routeSettings],
    [STORES.HALL_DEFINITIONS, stableData.hallDefinitions],
    [STORES.HALL_ROUTE_SETTINGS, stableData.hallRouteSettings],
    [STORES.MAP_VIEWPORT_SETTINGS, stableData.mapViewportSettings],
  ]);
  const changedStores = new Set(
    APPLICATION_SNAPSHOT_STORE_NAMES.filter(
      (storeName) =>
        !options.changedStoresOnly ||
        options.migration ||
        observation.roots.get(storeName)?.synthetic ||
        !observation.checkpoints.get(storeName) ||
        !(verifiedCommand
          ? semanticEqual(
              observation.snapshot[storeName],
              restorePayloads.get(storeName),
            )
          : storedValuesEqual(
              observation.snapshot[storeName],
              restorePayloads.get(storeName),
            )),
    ),
  );
  // A confirmed save remains a real write even when its values already match.
  // Keep failure/retry behavior without rewriting large unchanged lists or maps.
  if (changedStores.size === 0) changedStores.add(STORES.DAY_MODES);
  const dayRecordWrites = new Map<StoreName, DayRecordWrite>();
  for (const storeName of changedStores) {
    if (dayTarget) {
      const before = observation.snapshot[storeName];
      const after = stableData[storeName];
      if (!dayRecordStores.includes(storeName) && !semanticEqual(before, after))
        throw new Error("Day commands cannot modify this store.");
      for (const eventName of new Set([
        ...Object.keys(before),
        ...Object.keys(after),
      ]))
        if (
          eventName !== dayTarget.eventName &&
          !semanticEqual(before[eventName], after[eventName])
        )
          throw new Error("Day commands cannot modify another event.");
    }
    if (!dayRecordStores.includes(storeName)) continue;
    const state = observation.dayRecords.get(storeName);
    if (!dayTarget && !state) continue;
    let write: DayRecordWrite;
    if (dayTarget) {
      const eventName = dayTarget.eventName;
      const previous = observation.snapshot[storeName][eventName] as
        | Record<string, unknown>
        | undefined;
      const next = stableData[storeName][eventName] as
        | Record<string, unknown>
        | undefined;
      const consistency = storeName === STORES.EVENT_CONSISTENCY;
      const before = consistency
        ? (previous?.days as Record<string, unknown> | undefined)
        : previous;
      const after = consistency
        ? (next?.days as Record<string, unknown> | undefined)
        : next;
      const changes: Array<{
        path: string[];
        present: boolean;
        value?: unknown;
      }> = [];
      if (!previous && next)
        changes.push({
          path: [],
          present: true,
          value: consistency ? { ...next, days: {} } : {},
        });
      if (previous && !next) changes.push({ path: [], present: false });
      for (const key of new Set([
        ...Object.keys(before ?? {}),
        ...Object.keys(after ?? {}),
      ])) {
        if (semanticEqual(before?.[key], after?.[key])) continue;
        const inTarget =
          consistency ||
          storeName === STORES.DAY_MODES ||
          storeName === STORES.EXECUTE_MODE_ITEMS
            ? sameDay(key, dayTarget.day)
            : key.startsWith(MAPLESS_HALL_KEY + ":")
              ? sameDay(key.slice(MAPLESS_HALL_KEY.length + 1), dayTarget.day)
              : normalizeMapDay(key) === normalizeMapDay(dayTarget.day);
        if (!inTarget)
          throw new Error("Day commands cannot modify another date.");
        changes.push({
          path: consistency ? ["days", key] : [key],
          present: Object.prototype.hasOwnProperty.call(after ?? {}, key),
          value: after?.[key],
        });
      }
      if (
        consistency &&
        previous &&
        next &&
        !semanticEqual(
          { ...previous, days: undefined },
          { ...next, days: undefined },
        )
      )
        throw new Error(
          "Day commands cannot modify event-wide consistency settings.",
        );
      write = state
        ? await patchDayRecordStore(storeName, state, eventName, changes)
        : await partitionDayRecordStore(
            storeName,
            stableData[storeName] as Record<string, unknown>,
          );
    } else {
      write = await partitionDayRecordStore(
        storeName,
        stableData[storeName] as Record<string, unknown>,
      );
    }
    dayRecordWrites.set(storeName, write);
    restorePayloads.set(storeName, write.state.head);
  }
  const preparedMetadata = new Map<StoreName, StoredPersistenceMetadata>();
  const preparedCheckpoints = new Map<StoreName, PersistenceCheckpoint>();
  await Promise.all(
    APPLICATION_SNAPSHOT_STORE_NAMES.filter((storeName) =>
      changedStores.has(storeName),
    ).map(async (storeName) => {
      const observed = observation.roots.get(storeName);
      if (!observed) {
        throw new Error(`Missing restore observation for ${storeName}.`);
      }
      const metadata = await prepareMetadataForPayload(
        storeName,
        DATA_KEY,
        restorePayloads.get(storeName),
        observed.missing ? null : observed.revision,
      );
      preparedMetadata.set(storeName, metadata);
      preparedCheckpoints.set(
        storeName,
        createNextPersistenceCheckpoint(
          storeName,
          DATA_KEY,
          metadata,
          observation.checkpoints.get(storeName) ?? null,
          observation.runtimeCandidates.filter(
            ({ candidate }) =>
              candidate.storeName === storeName && candidate.key === DATA_KEY,
          ),
        ),
      );
    }),
  );
  const mapPuts = changedStores.has(STORES.MAP_DATA)
    ? buildMapDataPuts(stableMapData)
    : [];
  const mapPutKeys = new Set(mapPuts.map(({ key }) => key));

  await new Promise<void>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = openCoordinatedTransaction(
        database,
        [...APPLICATION_SNAPSHOT_STORE_NAMES, STORES.SYNC_QUEUE],
        "readwrite",
      );
    } catch (error) {
      reject(error);
      return;
    }

    let failure: unknown = null;
    const currentPayloads = new Map<StoreName, unknown>();
    const currentMetadata = new Map<StoreName, unknown>();
    const currentCheckpoints = new Map<StoreName, unknown>();
    let currentMapEntries: Record<string, unknown> | null = null;
    const currentDayRecords = new Map<StoreName, Map<string, unknown>>();
    let remainingReads =
      APPLICATION_SNAPSHOT_STORE_NAMES.length * (verifiedCommand ? 2 : 3) +
      3 +
      (verifiedCommand ? 0 : observation.dayRecords.size);
    let currentEventGenerations: unknown;
    let currentJournal: unknown;
    let currentArchive: unknown;
    let writesQueued = false;

    const trackRequest = (request: IDBRequest): void => {
      request.onerror = () => {
        failure =
          failure ??
          request.error ??
          new Error("IndexedDB atomic restore request failed.");
      };
    };

    const abortWith = (error: unknown): void => {
      failure = error;
      try {
        transaction.abort();
      } catch {
        reject(error);
      }
    };

    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = () => {
      failure = failure ?? transaction.error;
    };

    transaction.onabort = () => {
      reject(
        failure ??
          transaction.error ??
          new Error("IndexedDB atomic restore transaction was aborted."),
      );
    };

    const commitIfReady = (): void => {
      remainingReads -= 1;
      if (remainingReads !== 0 || writesQueued) return;
      writesQueued = true;

      try {
        const controlStore = transaction.objectStore(STORES.SYNC_QUEUE);
        if (
          !storedValuesEqual(currentJournal, observation.journal) ||
          !storedValuesEqual(currentArchive, observation.archive)
        )
          throw new PersistenceConflictError(
            "計算後に移行記録が変更されました。",
          );
        if (
          !storedValuesEqual(
            readEventGenerations(currentEventGenerations),
            observation.eventGenerations,
          )
        )
          throw new PersistenceConflictError(
            "計算後にイベントの操作世代が変更されました。",
          );
        if (options.invalidatedEvents?.length) {
          const generations = { ...observation.eventGenerations };
          for (const event of new Set(options.invalidatedEvents)) {
            const generation =
              (Object.prototype.hasOwnProperty.call(generations, event)
                ? generations[event]
                : 0) + 1;
            if (!Number.isSafeInteger(generation))
              throw new Error("イベントの操作世代が上限に達しました。");
            Object.defineProperty(generations, event, {
              value: generation,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          }
          trackRequest(controlStore.put(generations, EVENT_GENERATIONS_KEY));
        }
        if (options.migration) {
          trackRequest(
            controlStore.put(
              {
                kind: "event-shopping-planner-consistency-archive",
                version: 1,
                ...options.migration,
                sourceDigest: migrationDigest,
              },
              CONSISTENCY_ARCHIVE_KEY,
            ),
          );
          trackRequest(
            controlStore.put(
              {
                kind: "event-shopping-planner-consistency-migration",
                version: 1,
                sourceDigest: migrationDigest,
                targetRevision: preparedMetadata.get(STORES.EVENT_CONSISTENCY)!
                  .revision,
              },
              CONSISTENCY_MIGRATION_KEY,
            ),
          );
        }
        APPLICATION_SNAPSHOT_STORE_NAMES.forEach((storeName) => {
          const observed = observation.roots.get(storeName);
          if (!observed)
            throw new Error(`Missing restore state for ${storeName}.`);
          const changed = changedStores.has(storeName);
          if (!verifiedCommand && observation.dayRecords.has(storeName))
            assertDayRecordsUnchanged(
              observation.dayRecords.get(storeName)!.records,
              currentDayRecords.get(storeName)!,
            );
          if (verifiedCommand) {
            const metadata = currentMetadata.get(storeName);
            if (
              !isStoredPersistenceMetadata(metadata, storeName, DATA_KEY) ||
              !immutableObservedRootFieldsMatch(metadata, observed)
            )
              throw new PersistenceConflictError(
                `${storeName} changed after the verified command read.`,
              );
            if (changed) {
              if (storeName === STORES.MAP_DATA)
                throw new Error("Day commands cannot modify map geometry.");
              const dayWrite = dayRecordWrites.get(storeName);
              if (dayWrite)
                enqueueDayRecordWrite(
                  transaction.objectStore(storeName),
                  dayWrite,
                  trackRequest,
                );
              else
                trackRequest(
                  transaction
                    .objectStore(storeName)
                    .put(restorePayloads.get(storeName), DATA_KEY),
                );
            }
          } else if (storeName === STORES.MAP_DATA) {
            const currentEntries = currentMapEntries;
            if (currentEntries === null)
              throw new Error("Missing mapData restore CAS snapshot.");
            const knownKeys = assertCurrentMapMatchesExpected(
              currentEntries,
              currentMetadata.get(storeName),
              observed,
            );
            if (changed) {
              const mapStore = transaction.objectStore(storeName);
              knownKeys.forEach((storageKey) => {
                if (!mapPutKeys.has(storageKey))
                  trackRequest(mapStore.delete(storageKey));
              });
              mapPuts.forEach(({ key, value }) => {
                if (
                  !Object.prototype.hasOwnProperty.call(currentEntries, key) ||
                  !storedValuesEqual(currentEntries[key], value)
                )
                  trackRequest(mapStore.put(value, key));
              });
            }
          } else {
            assertCurrentSnapshotMatchesExpected(
              storeName,
              DATA_KEY,
              currentPayloads.get(storeName),
              currentMetadata.get(storeName),
              observed,
            );
            if (changed) {
              const dayWrite = dayRecordWrites.get(storeName);
              if (dayWrite)
                enqueueDayRecordWrite(
                  transaction.objectStore(storeName),
                  dayWrite,
                  trackRequest,
                );
              else
                trackRequest(
                  transaction
                    .objectStore(storeName)
                    .put(restorePayloads.get(storeName), DATA_KEY),
                );
            }
          }
          assertCurrentCheckpointMatchesExpected(
            storeName,
            DATA_KEY,
            currentCheckpoints.get(storeName),
            observation.checkpoints.get(storeName) ?? null,
          );
          // Unchanged stores are still observed and checked inside this same transaction.
          if (!changed) return;
          const metadata = preparedMetadata.get(storeName);
          const checkpoint = preparedCheckpoints.get(storeName);
          if (!metadata || !checkpoint)
            throw new Error(`Missing prepared state for ${storeName}.`);
          trackRequest(
            controlStore.put(
              metadata,
              createPersistenceMetadataKey(storeName, DATA_KEY),
            ),
          );
          trackRequest(
            controlStore.put(
              checkpoint,
              createPersistenceCheckpointKey(storeName, DATA_KEY),
            ),
          );
        });
      } catch (error) {
        abortWith(error);
      }
    };

    try {
      const controlStore = transaction.objectStore(STORES.SYNC_QUEUE);
      const generationsRead = controlStore.get(EVENT_GENERATIONS_KEY);
      generationsRead.onerror = () => {
        failure = generationsRead.error;
      };
      generationsRead.onsuccess = () => {
        currentEventGenerations = generationsRead.result;
        commitIfReady();
      };
      const journalRead = controlStore.get(CONSISTENCY_MIGRATION_KEY);
      journalRead.onerror = () => {
        failure = journalRead.error;
      };
      journalRead.onsuccess = () => {
        currentJournal = journalRead.result;
        commitIfReady();
      };
      const archiveRead = controlStore.get(CONSISTENCY_ARCHIVE_KEY);
      archiveRead.onerror = () => {
        failure = archiveRead.error;
      };
      archiveRead.onsuccess = () => {
        currentArchive = archiveRead.result;
        commitIfReady();
      };
      APPLICATION_SNAPSHOT_STORE_NAMES.forEach((storeName) => {
        const metadataRequest = controlStore.get(
          createPersistenceMetadataKey(storeName, DATA_KEY),
        );
        metadataRequest.onerror = () => {
          failure = failure ?? metadataRequest.error;
        };
        metadataRequest.onsuccess = () => {
          currentMetadata.set(storeName, metadataRequest.result);
          commitIfReady();
        };
        const checkpointRequest = controlStore.get(
          createPersistenceCheckpointKey(storeName, DATA_KEY),
        );
        checkpointRequest.onerror = () => {
          failure = failure ?? checkpointRequest.error;
        };
        checkpointRequest.onsuccess = () => {
          currentCheckpoints.set(storeName, checkpointRequest.result);
          commitIfReady();
        };

        if (verifiedCommand) return;
        if (observation.dayRecords.has(storeName)) {
          const rows = new Map<string, unknown>();
          const cursorRequest = transaction
            .objectStore(storeName)
            .openCursor(
              IDBKeyRange.bound(
                DAY_RECORD_PREFIX,
                DAY_RECORD_PREFIX + "\uffff",
              ),
            );
          cursorRequest.onerror = () => {
            failure = failure ?? cursorRequest.error;
          };
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (cursor) {
              rows.set(String(cursor.key), cursor.value);
              cursor.continue();
            } else {
              currentDayRecords.set(storeName, rows);
              commitIfReady();
            }
          };
        }
        if (storeName === STORES.MAP_DATA) {
          const mapEntries: Record<string, unknown> = {};
          const mapCursor = transaction.objectStore(storeName).openCursor();
          mapCursor.onerror = () => {
            failure =
              failure ??
              mapCursor.error ??
              new Error("Failed to enumerate mapData during atomic restore.");
          };
          mapCursor.onsuccess = () => {
            const cursor = mapCursor.result;
            if (cursor) {
              mapEntries[String(cursor.key)] = cursor.value;
              cursor.continue();
              return;
            }
            currentMapEntries = mapEntries;
            commitIfReady();
          };
        } else {
          const payloadRequest = transaction
            .objectStore(storeName)
            .get(DATA_KEY);
          payloadRequest.onerror = () => {
            failure = failure ?? payloadRequest.error;
          };
          payloadRequest.onsuccess = () => {
            currentPayloads.set(storeName, payloadRequest.result);
            commitIfReady();
          };
        }
      });
    } catch (error) {
      abortWith(error);
    }
  });

  const nextDayRecords = new Map(observation.dayRecords);
  dayRecordWrites.forEach((write, store) =>
    nextDayRecords.set(store, adoptDayRecordWrite(write)),
  );
  preparedMetadata.forEach((metadata, storeName) => {
    const checkpoint = preparedCheckpoints.get(storeName);
    if (!checkpoint) {
      throw new Error(`Missing committed restore checkpoint for ${storeName}.`);
    }
    expectedRevisionRoots.set(
      getObservedRootKey(storeName, DATA_KEY),
      storeName === STORES.MAP_DATA
        ? {
            ...metadata,
            missing: Object.keys(stableMapData).length === 0,
          }
        : metadata,
    );
    expectedPersistenceCheckpoints.set(
      getObservedRootKey(storeName, DATA_KEY),
      checkpoint,
    );
  });
  cleanupRuntimeCandidateSnapshots(observation.runtimeCandidates);
  if (!options.migration) {
    const roots = new Map(observation.roots),
      checkpoints = new Map(observation.checkpoints);
    preparedMetadata.forEach((metadata, store) => {
      roots.set(store, metadata);
      checkpoints.set(store, preparedCheckpoints.get(store)!);
    });
    verifiedCommandCache = {
      database,
      observation: {
        ...observation,
        roots,
        checkpoints,
        snapshot: stableData,
        dayRecords: nextDayRecords,
        consistencyMissing: false,
        mapDataNormalized: true,
        eventGenerations: Object.fromEntries(
          [
            ...new Set([
              ...Object.keys(observation.eventGenerations),
              ...(options.invalidatedEvents ?? []),
            ]),
          ].map((event) => [
            event,
            (observation.eventGenerations[event] ?? 0) +
              (options.invalidatedEvents?.includes(event) ? 1 : 0),
          ]),
        ),
        runtimeCandidates: [],
      },
      fallbackKey: runtimeFallbackKey(),
    };
  } else verifiedCommandCache = undefined;
}

/** Compatibility entry point for backup restore callers. */
export const restoreAppDataAtomically = commitApplicationSnapshotAtomically;
