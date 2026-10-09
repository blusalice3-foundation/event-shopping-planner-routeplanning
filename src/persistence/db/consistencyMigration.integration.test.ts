// @vitest-environment jsdom
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventConsistency } from "../../types/consistency";
import type { PersistenceSnapshot } from "../../app/ports/PersistenceCommandPort";
import {
  CONSISTENCY_ARCHIVE_KEY,
  CONSISTENCY_MIGRATION_KEY,
  DATA_KEY,
  EVENT_GENERATIONS_KEY,
  DB_NAME,
  STORES,
} from "./constants";
let factory: IDBFactory;
beforeEach(() => {
  vi.resetModules();
  factory = new IDBFactory();
  vi.stubGlobal("indexedDB", factory);
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const source = (): PersistenceSnapshot => ({
  eventLists: { event: [] },
  eventMetadata: {},
  executeModeItems: {},
  dayModes: {},
  mapData: {},
  mapRotationSettings: {},
  mapViewportSettings: {},
  routeSettings: {},
  hallDefinitions: {},
  hallRouteSettings: {},
  eventConsistency: { event: createEventConsistency() },
});
async function raw(store: string, key: string, write?: { value: unknown }) {
  const { openDatabase } = await import("./openDatabase");
  const db = await openDatabase();
  return await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(store, write ? "readwrite" : "readonly");
    const request = write
      ? tx.objectStore(store).put(write.value, key)
      : tx.objectStore(store).get(key);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error);
  });
}
describe("consistency migration transaction", () => {
  async function migrate() {
    const { readApplicationSnapshot, commitApplicationSnapshotAtomically } =
      await import("./atomicRestoreTransaction");
    const before = await readApplicationSnapshot();
    const value = source();
    const { eventConsistency: _consistency, ...legacy } = value;
    await commitApplicationSnapshotAtomically(value, {
      expectedRoots: before.expectedRoots,
      migration: { source: legacy, blockDetectionSettingsRaw: null },
    });
    return {
      value,
      readApplicationSnapshot,
      commitApplicationSnapshotAtomically,
    };
  }
  it("commits archive, journal, eleven stores and subsequent saves together", async () => {
    const app = await migrate();
    const first = await app.readApplicationSnapshot();
    expect(first.consistencyMissing).toBe(false);
    expect(first.snapshot).toEqual(app.value);
    const archive = await raw(STORES.SYNC_QUEUE, CONSISTENCY_ARCHIVE_KEY);
    expect(archive).toMatchObject({
      version: 1,
      source: { eventLists: { event: [] } },
    });
    first.snapshot.eventMetadata.event = { updated: true };
    await app.commitApplicationSnapshotAtomically(first.snapshot, {
      expectedRoots: first.expectedRoots,
    });
    expect(await raw(STORES.SYNC_QUEUE, CONSISTENCY_ARCHIVE_KEY)).toEqual(
      archive,
    );
    expect(
      (await app.readApplicationSnapshot()).snapshot.eventMetadata.event,
    ).toEqual({ updated: true });
  });
  it("does not read inaccessible legacy localStorage after migration is complete", async () => {
    const app = await migrate();
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("legacy storage unavailable");
      });
    const { inspectConsistencyUpgrade } = await import("./consistencyUpgrade");
    await expect(inspectConsistencyUpgrade()).resolves.toBeNull();
    const { db } = await import("../facade/indexedDbPersistence");
    await expect(db.migrateFromLocalStorage()).resolves.toMatchObject({
      status: "cleanup-pending",
      dataMigrationStatus: "not-needed",
      cleanupStatus: "deferred",
    });
    expect(getItem).not.toHaveBeenCalled();
    expect((await app.readApplicationSnapshot()).snapshot).toEqual(app.value);
  });
  it("rolls back payloads and archive when the journal cannot be written", async () => {
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      if (key === CONSISTENCY_MIGRATION_KEY) throw new Error("journal failure");
      return original.call(this, value, key);
    });
    await expect(migrate()).rejects.toThrow("journal failure");
    expect(await raw(STORES.EVENT_CONSISTENCY, DATA_KEY)).toBeUndefined();
    expect(
      await raw(STORES.SYNC_QUEUE, CONSISTENCY_ARCHIVE_KEY),
    ).toBeUndefined();
  });
  it("retains corrupted archive evidence and refuses normal writes", async () => {
    const app = await migrate();
    await raw(STORES.SYNC_QUEUE, CONSISTENCY_ARCHIVE_KEY, {
      value: { tampered: true },
    });
    await expect(app.readApplicationSnapshot()).rejects.toMatchObject({
      name: "PersistenceConflict",
      recoveryBundle: expect.any(Object),
    });
    expect(await raw(STORES.SYNC_QUEUE, CONSISTENCY_ARCHIVE_KEY)).toEqual({
      tampered: true,
    });
  });
  it("keeps malformed completed migration evidence in recovery without consulting legacy storage", async () => {
    await migrate();
    await raw(STORES.SYNC_QUEUE, CONSISTENCY_ARCHIVE_KEY, {
      value: { tampered: true },
    });
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("legacy storage unavailable");
      });
    const { db } = await import("../facade/indexedDbPersistence");
    const result = await db.migrateFromLocalStorage();
    expect(result.status).toBe("recovery-required");
    if (result.status === "recovery-required")
      expect(result.recoveryBundle.candidates).toContainEqual(
        expect.objectContaining({
          storeName: STORES.SYNC_QUEUE,
          key: CONSISTENCY_ARCHIVE_KEY,
          payload: { tampered: true },
        }),
      );
    expect(getItem).not.toHaveBeenCalled();
    expect(await raw(STORES.SYNC_QUEUE, CONSISTENCY_ARCHIVE_KEY)).toEqual({
      tampered: true,
    });
  });
  it("rejects a stale observation if migration evidence changes before CAS", async () => {
    const app = await migrate();
    const read = await app.readApplicationSnapshot();
    await raw(STORES.SYNC_QUEUE, CONSISTENCY_MIGRATION_KEY, {
      value: { tampered: true },
    });
    await expect(
      app.commitApplicationSnapshotAtomically(read.snapshot, {
        expectedRoots: read.expectedRoots,
      }),
    ).rejects.toMatchObject({ name: "PersistenceConflict" });
  });
  it("reports a malformed new store with its raw recovery candidate", async () => {
    const app = await migrate();
    await raw(STORES.EVENT_CONSISTENCY, DATA_KEY, {
      value: { event: { schemaVersion: 99 } },
    });
    const { db } = await import("../facade/indexedDbPersistence");
    const loaded = await db.loadEventConsistency();
    expect(loaded.status).toBe("conflict");
    expect(
      loaded.recoveryBundle?.candidates.some(
        (candidate) => candidate.storeName === STORES.EVENT_CONSISTENCY,
      ),
    ).toBe(true);
    await expect(app.readApplicationSnapshot()).rejects.toThrow();
  });
  it("rejects both reads and writes through the actual previous database opener", async () => {
    await migrate();
    const { resetDatabaseConnection } = await import("./openDatabase");
    resetDatabaseConnection();
    const legacy =
      await import("../../test/fixtures/legacy-db7-941ebe7/openDatabase");
    const original = localStorage.length;
    await expect(legacy.openDatabase()).rejects.toMatchObject({
      name: "VersionError",
    });
    await expect(
      legacy
        .openDatabase()
        .then((db) => db.transaction(STORES.EVENT_LISTS, "readwrite")),
    ).rejects.toMatchObject({ name: "VersionError" });
    expect(localStorage.length).toBe(original);
    const request = factory.open(DB_NAME);
    await new Promise<void>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        expect(request.result.version).toBe(9);
        request.result.close();
        resolve();
      };
    });
  });
});

describe("pre-upgrade boundary", () => {
  it("closes an already-open old client on versionchange and refuses its reconnect", async () => {
    const legacy =
      await import("../../test/fixtures/legacy-db7-941ebe7/openDatabase");
    const oldConnection = await legacy.openDatabase();
    expect(oldConnection.version).toBeLessThanOrEqual(7);
    const current = await import("./openDatabase");
    expect((await current.openDatabase()).version).toBe(9);
    expect(() =>
      oldConnection.transaction(STORES.EVENT_LISTS, "readwrite"),
    ).toThrow();
    await expect(legacy.openDatabase()).rejects.toMatchObject({
      name: "VersionError",
    });
    current.resetDatabaseConnection();
  });
  it("refuses to upgrade an old database when legacy storage cannot be read", async () => {
    const request = factory.open(DB_NAME, 7);
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STORES.EVENT_LISTS);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("legacy storage unavailable");
      });
      const { inspectConsistencyUpgrade } =
        await import("./consistencyUpgrade");
      await expect(inspectConsistencyUpgrade()).rejects.toThrow(
        "legacy storage unavailable",
      );
      expect(old.version).toBe(7);
      expect(old.objectStoreNames.contains(STORES.EVENT_CONSISTENCY)).toBe(
        false,
      );
    } finally {
      old.close();
    }
  });
  it("archives original store keys and local settings before changing the database version", async () => {
    const oldConnection = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, 7);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("eventLists");
        request.result.createObjectStore("unknownArchive");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const original = {
      event: [
        { id: "A", remarks: "ユーザー登録", purchaseStatus: "Purchased" },
      ],
    };
    await new Promise<void>((resolve, reject) => {
      const transaction = oldConnection.transaction(
        ["eventLists", "unknownArchive"],
        "readwrite",
      );
      transaction.objectStore("eventLists").put(original, "data");
      transaction
        .objectStore("unknownArchive")
        .put({ preserved: true }, "original-key");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    localStorage.setItem(
      "blockDetectionSettings",
      '{"event":{"原文":"ユーザー登録"}}',
    );
    const { inspectConsistencyUpgrade } = await import("./consistencyUpgrade");
    const archive = await inspectConsistencyUpgrade();
    expect(archive).toMatchObject({
      databaseVersion: 7,
      stores: {
        eventLists: [{ key: "data", value: original }],
        unknownArchive: [{ key: "original-key", value: { preserved: true } }],
      },
      localStorage: {
        blockDetectionSettings: '{"event":{"原文":"ユーザー登録"}}',
      },
    });
    expect(oldConnection.version).toBe(7);
    expect(oldConnection.objectStoreNames.contains("eventConsistency")).toBe(
      false,
    );
    oldConnection.close();
  });
});

it("commits event generations with lifecycle writes, keeps tombstones, and excludes them from backups", async () => {
  const app = await import("./atomicRestoreTransaction");
  const value = source();
  for (const event of ["event", "other", "__proto__", "constructor"]) {
    const before = await app.readApplicationSnapshot();
    await app.commitApplicationSnapshotAtomically(value, {
      expectedRoots: before.expectedRoots,
      invalidatedEvents: [event, event],
    });
  }
  const read = await app.readApplicationSnapshot();
  expect(read.eventGenerations).toEqual(
    JSON.parse('{"event":1,"other":1,"__proto__":1,"constructor":1}'),
  );
  expect(read.snapshot).toEqual(value);
  await app.commitApplicationSnapshotAtomically(value, {
    expectedRoots: read.expectedRoots,
  });
  expect((await app.readApplicationSnapshot()).eventGenerations).toEqual(
    read.eventGenerations,
  );
  const { createAppBackup } = await import("../../utils/appBackup");
  const backup = createAppBackup(value);
  expect(JSON.stringify(backup)).not.toContain("eventGenerations");
  const deleted = source();
  deleted.eventLists = {};
  deleted.eventConsistency = {};
  await app.commitApplicationSnapshotAtomically(deleted, {
    invalidatedEvents: ["event"],
  });
  expect((await app.readApplicationSnapshot()).eventGenerations?.event).toBe(2);
  await app.commitApplicationSnapshotAtomically(value, {
    invalidatedEvents: ["event"],
  });
  expect((await app.readApplicationSnapshot()).eventGenerations?.event).toBe(3);
});

it("rolls back lifecycle generations and all payloads when their atomic write fails", async () => {
  const app = await import("./atomicRestoreTransaction");
  await app.commitApplicationSnapshotAtomically(source(), {
    invalidatedEvents: ["event"],
  });
  const before = await app.readApplicationSnapshot();
  const next = structuredClone(before.snapshot);
  next.eventMetadata.event = { title: "replacement" };
  const original = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (this.name === STORES.EVENT_METADATA && key === DATA_KEY)
      throw new Error("atomic write failure");
    return original.call(this, value, key);
  });
  await expect(
    app.commitApplicationSnapshotAtomically(next, {
      expectedRoots: before.expectedRoots,
      invalidatedEvents: ["event"],
    }),
  ).rejects.toThrow("atomic write failure");
  const after = await app.readApplicationSnapshot();
  expect(after.snapshot).toEqual(before.snapshot);
  expect(after.eventGenerations).toEqual(before.eventGenerations);
});

it("CAS rejects a changed internal generation even when the application payloads did not change", async () => {
  const app = await import("./atomicRestoreTransaction");
  await app.commitApplicationSnapshotAtomically(source());
  const before = await app.readApplicationSnapshot();
  await raw(STORES.SYNC_QUEUE, EVENT_GENERATIONS_KEY, { value: { event: 1 } });
  await expect(
    app.commitApplicationSnapshotAtomically(before.snapshot, {
      expectedRoots: before.expectedRoots,
    }),
  ).rejects.toThrow("操作世代");
  expect((await app.readApplicationSnapshot()).snapshot).toEqual(
    before.snapshot,
  );
});

it.each([null, [], { event: -1 }, { event: 0.5 }, { event: "1" }])(
  "refuses malformed lifecycle counters: %j",
  async (value) => {
    const app = await import("./atomicRestoreTransaction");
    await raw(STORES.SYNC_QUEUE, EVENT_GENERATIONS_KEY, { value });
    await expect(app.readApplicationSnapshot()).rejects.toThrow("操作世代");
  },
);
