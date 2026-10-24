import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventConsistency } from "../../types/consistency";
import type { AppData } from "../../app/ports/PersistenceCommandPort";
import { db } from "../facade/indexedDbPersistence";
import { openDatabase, resetDatabaseConnection } from "./openDatabase";
import { DATA_KEY, STORES } from "./constants";
import { dayRecordKey, hasDayRecordHead } from "./dayRecordStorage";
import {
  LEGACY_SHOPPING_STORAGE_MODE,
  SHOPPING_STORAGE_MODE_KEY,
} from "./shoppingStorageMode";

const source = (): AppData => ({
  eventLists: {
    ユーザー登録: [
      {
        id: "item-1",
        circle: "サークル",
        title: "頒布物",
        eventDate: "1日目",
        block: "A",
        number: "1",
        price: 500,
        quantity: 7,
        purchaseStatus: "None",
        remarks: "エラーが発生しました",
        customField: { preserved: true, value: "任意項目" },
        source: "spreadsheet",
        protectionLevel: "none",
      },
    ],
    過去イベント: [{ id: "past-item", title: "過去の頒布物", quantity: 3 }],
  },
  eventConsistency: {
    ユーザー登録: createEventConsistency(),
    過去イベント: createEventConsistency(),
  },
  eventMetadata: { ユーザー登録: { customSetting: "保持" } },
  executeModeItems: { ユーザー登録: { "1日目": ["item-1"] } },
  dayModes: { ユーザー登録: { "1日目": "execute" } },
  mapData: {},
  mapRotationSettings: {},
  mapViewportSettings: {},
  routeSettings: {},
  hallDefinitions: {},
  hallRouteSettings: {},
});

beforeEach(() => {
  resetDatabaseConnection();
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.clear();
});
afterEach(() => {
  resetDatabaseConnection();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function raw(store: string, key: string, write?: { value: unknown }) {
  const database = await openDatabase();
  return new Promise<unknown>((resolve, reject) => {
    const tx = database.transaction(store, write ? "readwrite" : "readonly");
    const request = write
      ? tx.objectStore(store).put(write.value, key)
      : tx.objectStore(store).get(key);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error);
  });
}
async function allRaw() {
  const database = await openDatabase();
  const names = Array.from(database.objectStoreNames);
  const tx = database.transaction(names, "readonly");
  const values = await Promise.all(
    names.map(async (store) => {
      const rows = new Map<IDBValidKey, unknown>();
      await new Promise<void>((resolve, reject) => {
        const request = tx.objectStore(store).openCursor();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return resolve();
          rows.set(cursor.key, cursor.value);
          cursor.continue();
        };
      });
      return [store, rows];
    }),
  );
  return Object.fromEntries(values);
}
async function prepared() {
  const initial = await db.readApplicationSnapshot();
  await db.commitApplicationSnapshotAtomically(source(), {
    expectedRoots: initial.expectedRoots,
  });
  const read = await db.readApplicationSnapshot({
    prepareScopedCommands: true,
  });
  expect(hasDayRecordHead(await raw(STORES.EVENT_LISTS, DATA_KEY))).toBe(true);
  return read;
}

describe("shopping storage rollback", () => {
  it("preserves every current value, legacy sidecars and subsequent generic writes across restart", async () => {
    const before = await prepared();
    await db.prepareShoppingMoveRollback(before.expectedRoots);
    expect(await raw(STORES.EVENT_LISTS, DATA_KEY)).toEqual(
      before.snapshot.eventLists,
    );
    expect(await raw(STORES.SYNC_QUEUE, SHOPPING_STORAGE_MODE_KEY)).toEqual(
      LEGACY_SHOPPING_STORAGE_MODE,
    );
    resetDatabaseConnection();
    const reopened = await db.readApplicationSnapshot({
      prepareScopedCommands: true,
    });
    expect(reopened.snapshot).toEqual(before.snapshot);
    expect(hasDayRecordHead(await raw(STORES.EVENT_LISTS, DATA_KEY))).toBe(
      false,
    );
    expect(
      await db.readCachedShoppingCommandSnapshot({
        eventName: "ユーザー登録",
        day: "1日目",
      }),
    ).toBeUndefined();
    expect(
      await db.readShoppingCommandSnapshot({
        eventName: "ユーザー登録",
        day: "1日目",
      }),
    ).toBeUndefined();
    Object.assign(
      reopened.snapshot.eventLists["ユーザー登録"][0] as Record<
        string,
        unknown
      >,
      {
        quantity: 9,
        remarks: "後発メモ",
      },
    );
    await db.commitApplicationSnapshotAtomically(reopened.snapshot, {
      expectedRoots: reopened.expectedRoots,
      changedStoresOnly: true,
    });
    expect(await raw(STORES.EVENT_LISTS, DATA_KEY)).toEqual(
      reopened.snapshot.eventLists,
    );
    expect((await db.readApplicationSnapshot()).snapshot).toEqual(
      reopened.snapshot,
    );
    const scoped = await db.readDayCommandSnapshot({
      eventName: "ユーザー登録",
      day: "1日目",
    });
    expect(scoped.snapshot.eventLists["ユーザー登録"][0]).toMatchObject({
      quantity: 9,
      remarks: "後発メモ",
      customField: { preserved: true },
    });
    const restored = await db.readApplicationSnapshot();
    await db.restoreAppDataAtomically(restored.snapshot);
    expect(hasDayRecordHead(await raw(STORES.EVENT_LISTS, DATA_KEY))).toBe(
      false,
    );
    expect(
      (await db.readApplicationSnapshot({ prepareScopedCommands: true }))
        .snapshot,
    ).toEqual(restored.snapshot);
  });

  it.each(["eventLists", "checkpoint"])(
    "aborts the payload, marker and all metadata together on %s write failure",
    async (boundary) => {
      const read = await prepared();
      const before = await allRaw();
      const original = IDBObjectStore.prototype.put;
      vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
        this: IDBObjectStore,
        value,
        key,
      ) {
        if (
          (boundary === "eventLists" &&
            this.name === STORES.EVENT_LISTS &&
            key === DATA_KEY) ||
          (boundary === "checkpoint" &&
            this.name === STORES.SYNC_QUEUE &&
            String(key).includes("checkpoint"))
        )
          throw new DOMException("Injected rollback failure", "AbortError");
        return original.call(this, value, key);
      });
      await expect(
        db.prepareShoppingMoveRollback(read.expectedRoots),
      ).rejects.toThrow("Injected rollback failure");
      vi.restoreAllMocks();
      expect(await allRaw()).toEqual(before);
      expect(
        await raw(STORES.SYNC_QUEUE, SHOPPING_STORAGE_MODE_KEY),
      ).toBeUndefined();
      expect((await db.readApplicationSnapshot()).snapshot).toEqual(
        read.snapshot,
      );
    },
  );

  it("rejects a backup observation after a newer accepted save without rewriting the current format", async () => {
    const backup = await prepared();
    const next = await db.readApplicationSnapshot();
    next.snapshot.dayModes["ユーザー登録"]["1日目"] = "edit";
    await db.commitApplicationSnapshotAtomically(next.snapshot, {
      expectedRoots: next.expectedRoots,
      changedStoresOnly: true,
    });
    const durable = await allRaw();
    await expect(
      db.prepareShoppingMoveRollback(backup.expectedRoots),
    ).rejects.toMatchObject({ name: "PersistenceConflict" });
    expect(await allRaw()).toEqual(durable);
    expect(
      await raw(STORES.SYNC_QUEUE, SHOPPING_STORAGE_MODE_KEY),
    ).toBeUndefined();
  });

  it("rejects changed physical item roots before publishing a rollback marker", async () => {
    const read = await prepared();
    const key = dayRecordKey("ユーザー登録", []);
    const entry = (await raw(STORES.EVENT_LISTS, key)) as {
      value: Array<{ quantity: number }>;
    };
    entry.value[0].quantity = 22;
    await raw(STORES.EVENT_LISTS, key, { value: entry });
    const durable = await allRaw();
    await expect(
      db.prepareShoppingMoveRollback(read.expectedRoots),
    ).rejects.toMatchObject({ name: "PersistenceConflict" });
    expect(await allRaw()).toEqual(durable);
    expect(
      await raw(STORES.SYNC_QUEUE, SHOPPING_STORAGE_MODE_KEY),
    ).toBeUndefined();
  });

  it("does not let a pre-rollback write restore the incompatible head", async () => {
    const stale = await prepared();
    const backup = await db.readApplicationSnapshot();
    await db.prepareShoppingMoveRollback(backup.expectedRoots);
    const durable = await allRaw();
    (
      stale.snapshot.eventLists["ユーザー登録"][0] as Record<string, unknown>
    ).quantity = 99;
    await expect(
      db.commitApplicationSnapshotAtomically(stale.snapshot, {
        expectedRoots: stale.expectedRoots,
        changedStoresOnly: true,
      }),
    ).rejects.toMatchObject({ name: "PersistenceConflict" });
    expect(await allRaw()).toEqual(durable);
  });

  it("keeps full recovery reads read-only and rejects malformed mode records without repair", async () => {
    const read = await prepared();
    await db.prepareShoppingMoveRollback(read.expectedRoots);
    const before = await allRaw();
    const writes = vi.spyOn(IDBObjectStore.prototype, "put");
    expect(
      (await db.readApplicationSnapshot({ prepareScopedCommands: false }))
        .snapshot,
    ).toEqual(read.snapshot);
    expect(writes).not.toHaveBeenCalled();
    expect(await allRaw()).toEqual(before);
    await raw(STORES.SYNC_QUEUE, SHOPPING_STORAGE_MODE_KEY, {
      value: { ...LEGACY_SHOPPING_STORAGE_MODE, version: 999 },
    });
    writes.mockClear();
    await expect(
      db.readApplicationSnapshot({ prepareScopedCommands: false }),
    ).rejects.toMatchObject({ name: "PersistenceConflict" });
    await expect(
      db.readApplicationSnapshot({ prepareScopedCommands: true }),
    ).rejects.toMatchObject({ name: "PersistenceConflict" });
    expect(writes).not.toHaveBeenCalled();
  });

  it("requires an owned complete observation", async () => {
    await prepared();
    await expect(db.prepareShoppingMoveRollback({})).rejects.toMatchObject({
      name: "PersistenceConflict",
    });
  });
});
