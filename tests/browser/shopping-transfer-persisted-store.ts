import type { Page } from "@playwright/test";
import {
  isPersistenceDigestDescriptor,
  verifyPersistenceDigest,
} from "../../src/utils/persistenceResilience";

/** Physical readback outside timing windows, accepting legacy and authenticated v1 roots. */
export async function readBrowserEventLists<
  T extends Record<string, unknown> = Record<string, unknown>,
>(page: Page): Promise<Record<string, T[]>> {
  const read = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{
        payload: unknown;
        entries: Array<[string, unknown]>;
      }>((resolve, reject) => {
        const tx = db.transaction("eventLists", "readonly");
        const store = tx.objectStore("eventLists");
        const request = store.get("data");
        const entries: Array<[string, unknown]> = [];
        let payload: unknown;
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          payload = request.result;
          if (
            !payload ||
            typeof payload !== "object" ||
            (payload as { kind?: string }).kind !==
              "event-shopping-planner-day-records"
          )
            return;
          const cursor = store.openCursor(
            IDBKeyRange.bound(
              "__esp_internal__:day-record:v1:",
              "__esp_internal__:day-record:v1:\uffff",
            ),
          );
          cursor.onerror = () => reject(cursor.error);
          cursor.onsuccess = () => {
            if (!cursor.result) return;
            entries.push([String(cursor.result.key), cursor.result.value]);
            cursor.result.continue();
          };
        };
        tx.oncomplete = () => resolve({ payload, entries });
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
  const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
  if (!record(read.payload)) throw new Error("Missing eventLists readback");
  if (read.payload.kind !== "event-shopping-planner-day-records") {
    if (Object.values(read.payload).some((items) => !Array.isArray(items)))
      throw new Error("Invalid legacy eventLists readback");
    return read.payload as Record<string, T[]>;
  }
  const head = read.payload;
  if (
    head.version !== 1 ||
    head.storeName !== "eventLists" ||
    head.authenticatedRoots !== true ||
    head.count !== read.entries.length ||
    typeof head.checksum !== "string" ||
    !/^[a-f0-9]{64}$/.test(head.checksum)
  )
    throw new Error("Invalid eventLists head readback");
  const lists: Record<string, T[]> = {};
  let digestSum = 0n;
  for (const [key, value] of read.entries) {
    if (
      !record(value) ||
      value.kind !== "event-shopping-planner-day-record" ||
      value.version !== 1 ||
      typeof value.eventName !== "string" ||
      !Array.isArray(value.path) ||
      value.path.length !== 0 ||
      key !==
        "__esp_internal__:day-record:v1:" +
          JSON.stringify([value.eventName, []]) ||
      !Array.isArray(value.value) ||
      !Array.isArray(value.children) ||
      value.children.length !== 0 ||
      !isPersistenceDigestDescriptor(value.digest) ||
      Object.prototype.hasOwnProperty.call(lists, value.eventName) ||
      !(await verifyPersistenceDigest(
        {
          store: "eventLists",
          key,
          value: value.value,
          children: value.children,
        },
        value.digest,
      ))
    )
      throw new Error("Invalid or unauthenticated eventLists event root");
    digestSum += BigInt("0x" + value.digest.value);
    Object.defineProperty(lists, value.eventName, {
      value: value.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  const checksum = (digestSum % (1n << 256n)).toString(16).padStart(64, "0");
  if (checksum !== head.checksum)
    throw new Error("eventLists root checksum mismatch");
  return lists;
}
