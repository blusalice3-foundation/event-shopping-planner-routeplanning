import {
  createPersistenceDigest,
  verifyPersistenceDigest,
  isPersistenceDigestDescriptor,
  type PersistenceDigestDescriptor,
} from "../../utils/persistenceResilience";
import { DATA_KEY, STORES, type StoreName } from "./constants";
import { requestResult } from "./transactionCoordinator";
import { PersistenceConflictError } from "./errors";
import { semanticEqual } from "../../utils/semanticEquality";

export const DAY_RECORD_PREFIX = "__esp_internal__:day-record:v1:";
const HEAD_KIND = "event-shopping-planner-day-records";
const RECORD_KIND = "event-shopping-planner-day-record";
const MODULUS = 1n << 256n;
export const dayRecordStores: readonly StoreName[] = [
  STORES.DAY_MODES,
  STORES.EXECUTE_MODE_ITEMS,
  STORES.HALL_ROUTE_SETTINGS,
  STORES.ROUTE_SETTINGS,
  STORES.EVENT_CONSISTENCY,
  STORES.HALL_DEFINITIONS,
  STORES.MAP_VIEWPORT_SETTINGS,
];
export const scopeRecordStores: readonly Exclude<StoreName, "syncQueue">[] = [
  ...(dayRecordStores as readonly Exclude<StoreName, "syncQueue">[]),
  STORES.EVENT_LISTS,
  STORES.EVENT_METADATA,
  STORES.MAP_ROTATION_SETTINGS,
];
export const sidecarRecordStores = scopeRecordStores.filter(
  (store) => !dayRecordStores.includes(store),
);
export interface DayRecordHead {
  kind: typeof HEAD_KIND;
  version: 1;
  storeName: StoreName;
  count: number;
  checksum: string;
  authenticatedRoots?: true;
}
export interface DayRecord {
  kind: typeof RECORD_KIND;
  version: 1;
  eventName: string;
  path: string[];
  value: unknown;
  digest: PersistenceDigestDescriptor;
  children?: Array<{ path: string[]; digest: PersistenceDigestDescriptor }>;
}
export interface DayRecordState {
  head: DayRecordHead;
  records: Map<string, DayRecord>;
}
export interface DayRecordWrite {
  state: DayRecordState;
  puts: Map<string, DayRecord>;
  deletes: string[];
  replace: boolean;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const hasDayRecordHead = (value: unknown): boolean =>
  record(value) && value.kind === HEAD_KIND;
export const dayRecordKey = (eventName: string, path: readonly string[]) =>
  DAY_RECORD_PREFIX + JSON.stringify([eventName, path]);
const checksum = (value: bigint) =>
  (((value % MODULUS) + MODULUS) % MODULUS).toString(16).padStart(64, "0");
export const dayRecordRootDigestKey = (store: StoreName, eventName: string) =>
  "__esp_internal__:day-root-digest:v1:" + JSON.stringify([store, eventName]);
const eventWideStore = (store: StoreName) =>
  store === STORES.EVENT_LISTS || store === STORES.EVENT_METADATA;
export const dayRecordDigestInput = (
  store: StoreName,
  key: string,
  value: unknown,
  children?: DayRecord["children"],
) => ({
  store,
  key,
  value,
  ...(children === undefined ? {} : { children }),
});
const define = (target: Record<string, unknown>, key: string, value: unknown) =>
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });

/** Enqueue the cursor before the transaction becomes inactive; hash after reading. */
export async function readDayRecordPayload(
  store: IDBObjectStore,
  key = DATA_KEY,
): Promise<{ payload: unknown; dayRecords?: Map<string, unknown> }> {
  const payload = await requestResult(store.get(key));
  if (key !== DATA_KEY || !hasDayRecordHead(payload)) return { payload };
  const dayRecords = new Map<string, unknown>();
  await new Promise<void>((resolve, reject) => {
    const cursor = store.openCursor(
      IDBKeyRange.bound(DAY_RECORD_PREFIX, DAY_RECORD_PREFIX + "\uffff"),
    );
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return resolve();
      dayRecords.set(String(entry.key), entry.value);
      entry.continue();
    };
  });
  return { payload, dayRecords };
}

/** Every record is authenticated, including unrelated dates during a full reload. */
export async function decodeDayRecords(
  store: StoreName,
  value: unknown,
  entries: Map<string, unknown> | undefined,
): Promise<{ data: Record<string, unknown>; state: DayRecordState }> {
  if (
    !record(value) ||
    value.kind !== HEAD_KIND ||
    value.version !== 1 ||
    value.storeName !== store ||
    !dayRecordStores.includes(store) ||
    !Number.isSafeInteger(value.count) ||
    (value.count as number) < 0 ||
    typeof value.checksum !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.checksum) ||
    !entries ||
    entries.size !== value.count
  )
    throw new Error("日付レコードの保存ヘッダーまたは件数が一致しません。");
  const records = new Map<string, DayRecord>();
  let sum = 0n;
  await Promise.all(
    [...entries].map(async ([key, entry]) => {
      if (
        !record(entry) ||
        entry.kind !== RECORD_KIND ||
        entry.version !== 1 ||
        typeof entry.eventName !== "string" ||
        !Array.isArray(entry.path) ||
        !entry.path.every((part) => typeof part === "string") ||
        !(store === STORES.EVENT_CONSISTENCY
          ? entry.path.length === 0 ||
            (entry.path.length === 2 && entry.path[0] === "days")
          : entry.path.length <= 1) ||
        key !== dayRecordKey(entry.eventName, entry.path) ||
        !isPersistenceDigestDescriptor(entry.digest) ||
        !(await verifyPersistenceDigest(
          dayRecordDigestInput(
            store,
            key,
            entry.value,
            entry.children as DayRecord["children"],
          ),
          entry.digest,
        ))
      )
        throw new Error("日付レコードの内容またはハッシュが一致しません。");
      if (
        value.authenticatedRoots &&
        entry.path.length === 0 &&
        (!Array.isArray(entry.children) ||
          !entry.children.every(
            (child) =>
              record(child) &&
              Array.isArray(child.path) &&
              child.path.length > 0 &&
              child.path.every((part) => typeof part === "string") &&
              isPersistenceDigestDescriptor(child.digest),
          ))
      ) {
        throw new Error("イベント索引の形式が一致しません。");
      }
      const typed = entry as unknown as DayRecord;
      records.set(key, typed);
      sum += BigInt("0x" + typed.digest.value);
    }),
  );
  if (checksum(sum) !== value.checksum)
    throw new Error("日付レコードの整合性ヘッダーが一致しません。");
  if (value.authenticatedRoots) {
    const childCounts = new Map<string, number>();
    for (const entry of records.values())
      if (entry.path.length)
        childCounts.set(
          entry.eventName,
          (childCounts.get(entry.eventName) ?? 0) + 1,
        );
    for (const root of records.values()) {
      if (root.path.length) continue;
      const expected = new Set<string>();
      for (const child of root.children ?? []) {
        const key = dayRecordKey(root.eventName, child.path);
        const entry = records.get(key);
        if (
          expected.has(key) ||
          !entry ||
          !semanticEqual(child.digest, entry.digest)
        )
          throw new Error("イベント索引と日付レコードが一致しません。");
        expected.add(key);
      }
      if ((childCounts.get(root.eventName) ?? 0) !== expected.size)
        throw new Error("イベント索引に含まれない日付レコードがあります。");
    }
  }
  const data: Record<string, unknown> = {};
  for (const entry of records.values())
    if (!entry.path.length)
      define(data, entry.eventName, structuredClone(entry.value));
  for (const entry of records.values()) {
    if (!entry.path.length) continue;
    if (!Object.prototype.hasOwnProperty.call(data, entry.eventName))
      throw new Error("日付レコードの親イベントがありません。");
    let parent = data[entry.eventName];
    if (entry.path.length === 2) parent = record(parent) ? parent.days : null;
    if (!record(parent))
      throw new Error("日付レコードの親イベントがありません。");
    define(parent, entry.path.at(-1)!, entry.value);
  }
  return { data, state: { head: value as unknown as DayRecordHead, records } };
}

export async function prepareDayRecord(
  store: StoreName,
  eventName: string,
  path: string[],
  value: unknown,
  children?: DayRecord["children"],
): Promise<[string, DayRecord]> {
  const key = dayRecordKey(eventName, path);
  const stable = structuredClone(value);
  return [
    key,
    {
      kind: RECORD_KIND,
      version: 1,
      eventName,
      path,
      value: stable,
      ...(children === undefined ? {} : { children }),
      digest: await createPersistenceDigest(
        dayRecordDigestInput(store, key, stable, children),
      ),
    },
  ];
}

/** One-time conversion of a verified legacy store, never required on a warm edit. */
export async function partitionDayRecordStore(
  store: StoreName,
  data: Record<string, unknown>,
): Promise<DayRecordWrite> {
  const roots = await Promise.all(
    Object.entries(data).map(async ([event, branch]) => {
      const consistency = store === STORES.EVENT_CONSISTENCY;
      const children =
        record(branch) && !eventWideStore(store)
          ? await Promise.all(
              Object.entries(
                consistency ? (branch.days as object) : branch,
              ).map(([key, child]) =>
                prepareDayRecord(
                  store,
                  event,
                  consistency ? ["days", key] : [key],
                  child,
                ),
              ),
            )
          : [];
      const root = await prepareDayRecord(
        store,
        event,
        [],
        eventWideStore(store) || !record(branch)
          ? branch
          : consistency
            ? { ...branch, days: {} }
            : {},
        children.map(([, child]) => ({
          path: child.path,
          digest: child.digest,
        })),
      );
      return [root, ...children];
    }),
  );
  const records = new Map(roots.flat());
  let sum = 0n;
  for (const entry of records.values())
    sum += BigInt("0x" + entry.digest.value);
  const head: DayRecordHead = {
    kind: HEAD_KIND,
    version: 1,
    storeName: store,
    count: records.size,
    authenticatedRoots: true,
    checksum: checksum(sum),
  };
  return {
    state: { head, records },
    puts: records,
    deletes: [],
    replace: true,
  };
}

/** The caller passes only changed date branches. No other payload is read or hashed. */
export async function patchDayRecordStore(
  store: StoreName,
  previous: DayRecordState,
  eventName: string,
  changes: Array<{ path: string[]; present: boolean; value?: unknown }>,
): Promise<DayRecordWrite> {
  const puts = new Map<string, DayRecord>();
  const deletes: string[] = [];
  let sum = BigInt("0x" + previous.head.checksum);
  let count = previous.head.count;
  for (const change of changes) {
    const key = dayRecordKey(eventName, change.path);
    const old = previous.records.get(key);
    if (old) {
      sum -= BigInt("0x" + old.digest.value);
      count--;
    }
    if (change.present) {
      const [key, entry] = await prepareDayRecord(
        store,
        eventName,
        change.path,
        change.value,
        change.path.length ? undefined : (old?.children ?? []),
      );
      puts.set(key, entry);
      sum += BigInt("0x" + entry.digest.value);
      count++;
    } else deletes.push(key);
  }
  const rootKey = dayRecordKey(eventName, []);
  const oldRoot = previous.records.get(rootKey);
  let root = puts.get(rootKey) ?? oldRoot;
  if (root && !deletes.includes(rootKey)) {
    const children = new Map(
      (root.children ?? []).map((child) => [JSON.stringify(child.path), child]),
    );
    for (const change of changes) {
      if (!change.path.length) continue;
      const path = JSON.stringify(change.path);
      const entry = puts.get(dayRecordKey(eventName, change.path));
      if (entry)
        children.set(path, { path: change.path, digest: entry.digest });
      else children.delete(path);
    }
    const [key, updated] = await prepareDayRecord(
      store,
      eventName,
      [],
      root.value,
      [...children.values()],
    );
    if (!semanticEqual(root, updated)) {
      sum -= BigInt("0x" + root.digest.value);
      sum += BigInt("0x" + updated.digest.value);
      puts.set(key, updated);
      root = updated;
    }
  }
  return {
    state: {
      head: { ...previous.head, count, checksum: checksum(sum) },
      records: previous.records,
    },
    puts,
    deletes,
    replace: false,
  };
}

export function enqueueDayRecordWrite(
  store: IDBObjectStore,
  write: DayRecordWrite,
  track: (request: IDBRequest) => void,
): void {
  if (write.replace)
    track(
      store.delete(
        IDBKeyRange.bound(DAY_RECORD_PREFIX, DAY_RECORD_PREFIX + "\uffff"),
      ),
    );
  for (const key of write.deletes) track(store.delete(key));
  for (const [key, entry] of write.puts) track(store.put(entry, key));
  track(store.put(write.state.head, DATA_KEY));
}

/** Full saves also compare the physical rows; scoped commands rely on revision/checkpoint CAS. */
export function assertDayRecordsUnchanged(
  expected: ReadonlyMap<string, unknown>,
  current: ReadonlyMap<string, unknown>,
): void {
  if (
    expected.size !== current.size ||
    [...expected].some(
      ([key, value]) =>
        !current.has(key) || !semanticEqual(value, current.get(key)),
    )
  )
    throw new PersistenceConflictError(
      "日付レコードが計算後に変更されました。",
    );
}

/** Publish the private lookup only after all related stores have committed. */
export function adoptDayRecordWrite(write: DayRecordWrite): DayRecordState {
  if (!write.replace) {
    for (const key of write.deletes) write.state.records.delete(key);
    for (const [key, entry] of write.puts) write.state.records.set(key, entry);
  }
  return write.state;
}

/** Root digests authenticate the manifest used for independent scoped reads. */
export function enqueueDayRootDigests(
  control: IDBObjectStore,
  storeName: StoreName,
  write: DayRecordWrite,
  previous: ReadonlyMap<string, DayRecord> | undefined,
  track: (request: IDBRequest) => void,
): void {
  if (write.replace) {
    const prefix =
      "__esp_internal__:day-root-digest:v1:" +
      JSON.stringify([storeName]).slice(0, -1) +
      ",";
    track(control.delete(IDBKeyRange.bound(prefix, prefix + "\uffff")));
  }
  if (write.replace && previous) {
    for (const [key, entry] of previous) {
      if (!entry.path.length && !write.state.records.has(key))
        track(
          control.delete(dayRecordRootDigestKey(storeName, entry.eventName)),
        );
    }
  }
  for (const key of write.deletes) {
    const [eventName, path] = JSON.parse(
      key.slice(DAY_RECORD_PREFIX.length),
    ) as [string, string[]];
    if (!path.length)
      track(control.delete(dayRecordRootDigestKey(storeName, eventName)));
  }
  for (const entry of write.puts.values()) {
    if (!entry.path.length)
      track(
        control.put(
          entry.digest,
          dayRecordRootDigestKey(storeName, entry.eventName),
        ),
      );
  }
}
