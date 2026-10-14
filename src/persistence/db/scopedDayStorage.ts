import { dayScopeDays } from "../../features/consistency/domain/dayScope";
import type {
  ApplicationDayScope,
  PersistenceSnapshot,
} from "../../app/ports/PersistenceCommandPort";
import {
  sameDay,
  normalizeMapDay,
} from "../../features/consistency/domain/context";
import { MAPLESS_HALL_KEY, type MapDataStore } from "../../types/map";
import { expandDayMapFromStorage } from "../../utils/mapDataPersistence";
import {
  createPersistenceMetadataKey,
  createPersistenceCheckpointKey,
  verifyPersistenceDigest,
  isPersistenceDigestDescriptor,
  createSynchronousFingerprint,
  type PersistenceCheckpoint,
} from "../../utils/persistenceResilience";
import { semanticEqual } from "../../utils/semanticEquality";
import { validateCheckpointForRoot } from "../recovery/checkpoint";
import {
  isStoredPersistenceMetadata,
  type ObservedRevisionRoot,
} from "../internal/persistenceCore";
import {
  DATA_KEY,
  STORES,
  MAP_DATA_KEY_PREFIX,
  EVENT_GENERATIONS_KEY,
  CONSISTENCY_MIGRATION_KEY,
  CONSISTENCY_ARCHIVE_KEY,
  type StoreName,
} from "./constants";
import {
  dayRecordStores,
  scopeRecordStores,
  dayRecordKey,
  dayRecordRootDigestKey,
  dayRecordDigestInput,
  prepareDayRecord,
  partitionDayRecordStore,
  type DayRecord,
  type DayRecordState,
} from "./dayRecordStorage";
import {
  requestResult,
  openCoordinatedTransaction,
  transactionFinished,
} from "./transactionCoordinator";
import { PersistenceConflictError } from "./errors";

export type DayStorageTarget = ApplicationDayScope;
export const scopeReadyKey = (store: StoreName) =>
  "__esp_internal__:scope-ready:v1:" + store;
export const MAP_SCOPE_READY_KEY = scopeReadyKey(STORES.MAP_DATA);
const mapScopeKey = (event: string) =>
  "__esp_internal__:map-scope-root:v1:" + JSON.stringify(event);

export async function prepareMapScopeRoots(
  data: MapDataStore,
  revision: string,
): Promise<Map<string, DayRecord>> {
  const partition = await partitionDayRecordStore(STORES.MAP_DATA, data);
  return new Map(
    await Promise.all(
      [...partition.state.records.values()]
        .filter((entry) => !entry.path.length)
        .map(async (root) => {
          const [, entry] = await prepareDayRecord(
            STORES.MAP_DATA,
            root.eventName,
            [],
            { revision },
            root.children,
          );
          return [root.eventName, entry] as const;
        }),
    ),
  );
}
export function enqueueMapScopeRoots(
  control: IDBObjectStore,
  roots: ReadonlyMap<string, DayRecord>,
  revision: string,
  previousEvents: Iterable<string>,
  track: (request: IDBRequest) => void,
) {
  for (const event of previousEvents)
    if (!roots.has(event)) {
      track(control.delete(mapScopeKey(event)));
      track(control.delete(dayRecordRootDigestKey(STORES.MAP_DATA, event)));
    }
  for (const [event, root] of roots) {
    track(control.put(root, mapScopeKey(event)));
    track(
      control.put(root.digest, dayRecordRootDigestKey(STORES.MAP_DATA, event)),
    );
  }
  track(control.put(revision, MAP_SCOPE_READY_KEY));
}
const inDay = (store: StoreName, path: string[], day: string) => {
  const key = path.at(-1)!;
  return store === STORES.EVENT_CONSISTENCY ||
    store === STORES.DAY_MODES ||
    store === STORES.EXECUTE_MODE_ITEMS
    ? sameDay(key, day)
    : key.startsWith(MAPLESS_HALL_KEY + ":")
      ? sameDay(key.slice(MAPLESS_HALL_KEY.length + 1), day)
      : normalizeMapDay(key) === normalizeMapDay(day);
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
async function verifyRoot(
  store: StoreName,
  event: string,
  raw: unknown,
  digest: unknown,
): Promise<DayRecord | undefined> {
  if (raw === undefined && digest === undefined) return undefined;
  if (
    !isRecord(raw) ||
    raw.kind !== "event-shopping-planner-day-record" ||
    raw.version !== 1 ||
    raw.eventName !== event ||
    !Array.isArray(raw.path) ||
    raw.path.length !== 0 ||
    !Array.isArray(raw.children) ||
    !isPersistenceDigestDescriptor(digest) ||
    !semanticEqual(raw.digest, digest)
  )
    throw new PersistenceConflictError(
      "対象イベントの検証済み索引が一致しません。",
    );
  const root = raw as unknown as DayRecord;
  if (
    (store === STORES.EVENT_LISTS || store === STORES.EVENT_METADATA) &&
    root.children!.length
  )
    throw new PersistenceConflictError("イベント索引の形式が不正です。");
  const paths = new Set<string>();
  for (const child of root.children!) {
    if (
      !child ||
      !Array.isArray(child.path) ||
      !child.path.length ||
      !child.path.every((part) => typeof part === "string") ||
      !(store === STORES.EVENT_CONSISTENCY
        ? child.path.length === 2 && child.path[0] === "days"
        : child.path.length === 1) ||
      !isPersistenceDigestDescriptor(child.digest) ||
      paths.has(JSON.stringify(child.path))
    )
      throw new PersistenceConflictError("対象イベントの索引形式が不正です。");
    paths.add(JSON.stringify(child.path));
  }
  if (
    !(await verifyPersistenceDigest(
      dayRecordDigestInput(
        store,
        dayRecordKey(event, []),
        root.value,
        root.children,
      ),
      digest,
    ))
  )
    throw new PersistenceConflictError(
      "対象イベントの索引ハッシュが一致しません。",
    );
  return root;
}
export interface ScopedDayObservation {
  snapshot: PersistenceSnapshot;
  roots: Map<StoreName, ObservedRevisionRoot>;
  checkpoints: Map<StoreName, PersistenceCheckpoint | null>;
  dayRecords: Map<StoreName, DayRecordState>;
  journal: unknown;
  archive: unknown;
  rawGenerations: unknown;
  mapScopeRevision: string;
  scopeReady: Map<StoreName, unknown>;
}
/** Missing caches and CAS retries read only authenticated roots and target-date records. */
export async function observeScopedDay(
  database: IDBDatabase,
  target: DayStorageTarget,
): Promise<ScopedDayObservation> {
  const names = [...scopeRecordStores, STORES.MAP_DATA];
  const transaction = openCoordinatedTransaction(
    database,
    [...names, STORES.SYNC_QUEUE],
    "readonly",
  );
  const finished = transactionFinished(transaction);
  // Retain the abort handler while post-read validation runs outside this transaction.
  void finished.catch(() => {});
  const control = transaction.objectStore(STORES.SYNC_QUEUE);
  const journal = requestResult(control.get(CONSISTENCY_MIGRATION_KEY));
  const archive = requestResult(control.get(CONSISTENCY_ARCHIVE_KEY));
  const generations = requestResult(control.get(EVENT_GENERATIONS_KEY));
  const ready = requestResult(control.get(MAP_SCOPE_READY_KEY));
  const raw = await Promise.all(
    names.map(async (store) => {
      const metadata = requestResult(
        control.get(createPersistenceMetadataKey(store, DATA_KEY)),
      );
      const checkpoint = requestResult(
        control.get(createPersistenceCheckpointKey(store, DATA_KEY)),
      );
      const digest = requestResult(
        control.get(dayRecordRootDigestKey(store, target.eventName)),
      );
      const head = dayRecordStores.includes(store)
        ? requestResult(transaction.objectStore(store).get(DATA_KEY))
        : Promise.resolve(undefined);
      const scopeReady = dayRecordStores.includes(store)
        ? Promise.resolve(undefined)
        : requestResult(control.get(scopeReadyKey(store)));
      const root = await requestResult(
        store === STORES.MAP_DATA
          ? control.get(mapScopeKey(target.eventName))
          : transaction
              .objectStore(store)
              .get(dayRecordKey(target.eventName, [])),
      );
      // Queue child reads before awaiting hashes, while the IDB transaction is active.
      const children =
        isRecord(root) && Array.isArray(root.children)
          ? root.children.filter(
              (child: unknown) =>
                isRecord(child) &&
                Array.isArray(child.path) &&
                child.path.length &&
                child.path.every((part: unknown) => typeof part === "string") &&
                dayScopeDays(target).some((day) =>
                  inDay(store, child.path as string[], day),
                ),
            )
          : [];
      const entries = await Promise.all(
        children.map(async (child) => {
          const path = child.path as string[];
          const key = dayRecordKey(target.eventName, path);
          const storageKey =
            store === STORES.MAP_DATA
              ? MAP_DATA_KEY_PREFIX +
                JSON.stringify([target.eventName, path[0]])
              : key;
          return [
            key,
            await requestResult(transaction.objectStore(store).get(storageKey)),
          ] as const;
        }),
      );
      return {
        store,
        root,
        entries,
        metadata: await metadata,
        checkpoint: await checkpoint,
        digest: await digest,
        head: await head,
        scopeReady: await scopeReady,
      };
    }),
  );
  await finished;
  const [journalValue, archiveValue, rawGenerations, mapScopeRevision] =
    await Promise.all([journal, archive, generations, ready]);
  const snapshot = Object.fromEntries(
    names.map((store) => [store, {}]),
  ) as unknown as PersistenceSnapshot;
  const roots = new Map<StoreName, ObservedRevisionRoot>();
  const checkpoints = new Map<StoreName, PersistenceCheckpoint | null>();
  const dayRecords = new Map<StoreName, DayRecordState>();
  await Promise.all(
    raw.map(async (entry) => {
      const { store, metadata } = entry;
      if (!isStoredPersistenceMetadata(metadata, store, DATA_KEY))
        throw new PersistenceConflictError(
          "対象日付の保存世代を検証できません。",
        );
      const checkpoint = validateCheckpointForRoot(
        entry.checkpoint,
        store,
        DATA_KEY,
        metadata,
      );
      if (!checkpoint)
        throw new PersistenceConflictError(
          "対象日付のcheckpointがありません。",
        );
      roots.set(store, metadata);
      checkpoints.set(store, checkpoint);
      if (!dayRecordStores.includes(store)) {
        if (entry.scopeReady !== metadata.revision)
          throw new PersistenceConflictError(
            "対象イベント索引の初期化が完了していません。",
          );
      } else if (
        !isRecord(entry.head) ||
        entry.head.authenticatedRoots !== true ||
        entry.head.kind !== "event-shopping-planner-day-records" ||
        entry.head.storeName !== store ||
        entry.head.version !== 1 ||
        !Number.isSafeInteger(entry.head.count) ||
        (entry.head.count as number) < 0 ||
        typeof entry.head.checksum !== "string" ||
        !/^[0-9a-f]{64}$/.test(entry.head.checksum) ||
        !(await verifyPersistenceDigest(entry.head, metadata.payloadDigest)) ||
        !semanticEqual(
          createSynchronousFingerprint(entry.head),
          metadata.payloadFingerprint,
        )
      )
        throw new PersistenceConflictError(
          "日付レコードの初期化または検証が完了していません。",
        );
      const root = await verifyRoot(
        store,
        target.eventName,
        entry.root,
        entry.digest,
      );
      if (!root) {
        if (dayRecordStores.includes(store))
          dayRecords.set(store, {
            head: entry.head as unknown as DayRecordState["head"],
            records: new Map(),
          });
        return;
      }
      if (
        store === STORES.MAP_DATA &&
        (!isRecord(root.value) || root.value.revision !== metadata.revision)
      )
        throw new PersistenceConflictError(
          "対象マップの索引世代が一致しません。",
        );
      const records = new Map<string, DayRecord>([
        [dayRecordKey(target.eventName, []), root],
      ]);
      let value: unknown = root.value;
      if (store === STORES.MAP_DATA) value = {};
      else if (store === STORES.EVENT_CONSISTENCY)
        value = { ...(root.value as object), days: {} };
      else if (store !== STORES.EVENT_LISTS && store !== STORES.EVENT_METADATA)
        value = { ...(root.value as object) };
      for (const [key, rawChild] of entry.entries) {
        const child = root.children!.find(
          (child) => dayRecordKey(target.eventName, child.path) === key,
        )!;
        if (store === STORES.MAP_DATA) {
          const expanded = expandDayMapFromStorage(rawChild);
          if (
            !(await verifyPersistenceDigest(
              dayRecordDigestInput(store, key, expanded),
              child.digest,
            ))
          )
            throw new PersistenceConflictError(
              "対象マップの内容が索引と一致しません。",
            );
          Object.defineProperty(value, child.path[0], {
            value: expanded,
            enumerable: true,
            writable: true,
          });
        } else {
          if (
            !isRecord(rawChild) ||
            rawChild.kind !== "event-shopping-planner-day-record" ||
            rawChild.version !== 1 ||
            rawChild.eventName !== target.eventName ||
            !semanticEqual(rawChild.path, child.path) ||
            !semanticEqual(rawChild.digest, child.digest) ||
            !(await verifyPersistenceDigest(
              dayRecordDigestInput(store, key, rawChild.value),
              child.digest,
            ))
          )
            throw new PersistenceConflictError(
              "対象日付の内容が索引と一致しません。",
            );
          const record = rawChild as unknown as DayRecord;
          records.set(key, record);
          const parent =
            store === STORES.EVENT_CONSISTENCY
              ? (value as { days: object }).days
              : (value as object);
          Object.defineProperty(parent, child.path.at(-1)!, {
            value: record.value,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
      }
      Object.defineProperty(snapshot[store], target.eventName, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      if (dayRecordStores.includes(store))
        dayRecords.set(store, {
          head: entry.head as unknown as DayRecordState["head"],
          records,
        });
    }),
  );
  return {
    snapshot,
    roots,
    checkpoints,
    dayRecords,
    journal: journalValue,
    archive: archiveValue,
    rawGenerations,
    mapScopeRevision: mapScopeRevision as string,
    scopeReady: new Map(
      raw
        .filter((entry) => !dayRecordStores.includes(entry.store))
        .map((entry) => [entry.store, entry.scopeReady]),
    ),
  };
}

export async function prepareSidecarRecords(
  store: StoreName,
  data: Record<string, unknown>,
  before: Record<string, unknown> | undefined,
) {
  const changed = Object.fromEntries(
    Object.entries(data).filter(
      ([event, value]) =>
        before === undefined || !semanticEqual(before[event], value),
    ),
  );
  const write = await partitionDayRecordStore(store, changed);
  const removed = before
    ? Object.keys(before).filter(
        (event) => !Object.prototype.hasOwnProperty.call(data, event),
      )
    : [];
  return { write, removed, replace: before === undefined };
}
export function enqueueSidecarRecords(
  payload: IDBObjectStore,
  control: IDBObjectStore,
  store: StoreName,
  prepared: Awaited<ReturnType<typeof prepareSidecarRecords>>,
  revision: string,
  track: (request: IDBRequest) => void,
) {
  if (prepared.replace) {
    const prefix =
      "__esp_internal__:day-root-digest:v1:" +
      JSON.stringify([store]).slice(0, -1) +
      ",";
    track(
      payload.delete(
        IDBKeyRange.bound(
          "__esp_internal__:day-record:v1:",
          "__esp_internal__:day-record:v1:" + "\uffff",
        ),
      ),
    );
    track(control.delete(IDBKeyRange.bound(prefix, prefix + "\uffff")));
  }
  // Event roots are authenticated; obsolete child records are never selected by the new manifest.
  const changedEvents = [...prepared.write.puts.values()]
    .filter((entry) => !entry.path.length)
    .map((entry) => entry.eventName);
  for (const event of [...prepared.removed, ...changedEvents]) {
    const prefix =
      "__esp_internal__:day-record:v1:" +
      JSON.stringify([event]).slice(0, -1) +
      ",";
    track(payload.delete(IDBKeyRange.bound(prefix, prefix + "￿")));
    track(payload.delete(dayRecordKey(event, [])));
    track(control.delete(dayRecordRootDigestKey(store, event)));
  }
  for (const [key, entry] of prepared.write.puts) {
    track(payload.put(entry, key));
    if (!entry.path.length)
      track(
        control.put(
          entry.digest,
          dayRecordRootDigestKey(store, entry.eventName),
        ),
      );
  }
  track(control.put(revision, scopeReadyKey(store)));
}
