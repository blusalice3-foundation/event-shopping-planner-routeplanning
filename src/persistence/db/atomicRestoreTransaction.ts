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
import { normalizeMapDataForPersistence } from "../../utils/mapDataPersistence";
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
  journal: unknown;
  archive: unknown;
  eventGenerations: Record<string, number>;
  checkpoints: Map<StoreName, PersistenceCheckpoint | null>;
  runtimeCandidates: RuntimeCandidateSnapshot<unknown>[];
}

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
    { payload: unknown; metadata: unknown; checkpoint: unknown }
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
        ? readMapEntriesFromStore(transaction.objectStore(storeName))
        : requestResult(transaction.objectStore(storeName).get(DATA_KEY));
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
    raw.set(storeName, { payload, metadata, checkpoint });
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
    }),
  );

  return {
    roots,
    checkpoints,
    runtimeCandidates,
    snapshot,
    consistencyMissing,
    journal,
    archive,
    eventGenerations,
  };
}

export async function readApplicationSnapshot(): Promise<ApplicationSnapshotRead> {
  const observation = await observeAppDataRestoreState();
  observation.roots.forEach((root, store) =>
    expectedRevisionRoots.set(getObservedRootKey(store, DATA_KEY), root),
  );
  observation.checkpoints.forEach((checkpoint, store) =>
    expectedPersistenceCheckpoints.set(
      getObservedRootKey(store, DATA_KEY),
      checkpoint,
    ),
  );
  return {
    snapshot: structuredClone(observation.snapshot),
    expectedRoots: observation,
    consistencyMissing: observation.consistencyMissing,
    eventGenerations: structuredClone(observation.eventGenerations),
  };
}
export async function commitApplicationSnapshotAtomically(
  data: AppData,
  options: AtomicSnapshotOptions = {},
): Promise<void> {
  assertEventConsistency(data.eventConsistency);
  const stableData = structuredClone(data);
  const stableMapData = normalizeMapDataForPersistence(
    stableData.mapData as MapDataStore,
  );
  stableData.mapData = stableMapData;
  const rememberedRoots = new Map(expectedRevisionRoots);
  const observation = options.expectedRoots
    ? (options.expectedRoots as AppDataRestoreObservation)
    : await observeAppDataRestoreState();
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
  const preparedMetadata = new Map<StoreName, StoredPersistenceMetadata>();
  const preparedCheckpoints = new Map<StoreName, PersistenceCheckpoint>();
  await Promise.all(
    APPLICATION_SNAPSHOT_STORE_NAMES.map(async (storeName) => {
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
  const mapPuts = buildMapDataPuts(stableMapData);
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
    let remainingReads = APPLICATION_SNAPSHOT_STORE_NAMES.length * 3 + 3;
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
          const metadata = preparedMetadata.get(storeName);
          const checkpoint = preparedCheckpoints.get(storeName);
          if (!observed || !metadata || !checkpoint) {
            throw new Error(`Missing restore state for ${storeName}.`);
          }

          if (storeName === STORES.MAP_DATA) {
            const currentEntries = currentMapEntries;
            if (currentEntries === null) {
              throw new Error("Missing mapData restore CAS snapshot.");
            }
            const knownKeys = assertCurrentMapMatchesExpected(
              currentEntries,
              currentMetadata.get(storeName),
              observed,
            );
            const mapStore = transaction.objectStore(storeName);
            knownKeys.forEach((storageKey) => {
              if (!mapPutKeys.has(storageKey)) {
                trackRequest(mapStore.delete(storageKey));
              }
            });
            mapPuts.forEach(({ key, value }) => {
              if (
                !Object.prototype.hasOwnProperty.call(currentEntries, key) ||
                !storedValuesEqual(currentEntries[key], value)
              ) {
                trackRequest(mapStore.put(value, key));
              }
            });
          } else {
            assertCurrentSnapshotMatchesExpected(
              storeName,
              DATA_KEY,
              currentPayloads.get(storeName),
              currentMetadata.get(storeName),
              observed,
            );
            trackRequest(
              transaction
                .objectStore(storeName)
                .put(restorePayloads.get(storeName), DATA_KEY),
            );
          }
          assertCurrentCheckpointMatchesExpected(
            storeName,
            DATA_KEY,
            currentCheckpoints.get(storeName),
            observation.checkpoints.get(storeName) ?? null,
          );

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
}

/** Compatibility entry point for backup restore callers. */
export const restoreAppDataAtomically = commitApplicationSnapshotAtomically;
