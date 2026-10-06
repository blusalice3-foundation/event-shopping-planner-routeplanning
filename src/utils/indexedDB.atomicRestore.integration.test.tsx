import { createEventConsistency } from "../types/consistency";
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DayMapData } from "../types/map";
import { db, type AppData } from "./indexedDB";
import * as mapPersistence from "./mapDataPersistence";
import { openDatabase } from "../persistence/db/openDatabase";
import {
  createNextPersistenceCheckpoint,
  prepareMetadataForPayload,
} from "../persistence/internal/persistenceCore";
import {
  createPersistenceMetadataKey,
  createPersistenceCheckpointKey,
} from "./persistenceResilience";

const RESTORE_STORE_NAMES = [
  db.STORES.EVENT_CONSISTENCY,
  db.STORES.EVENT_LISTS,
  db.STORES.EVENT_METADATA,
  db.STORES.EXECUTE_MODE_ITEMS,
  db.STORES.DAY_MODES,
  db.STORES.MAP_DATA,
  db.STORES.MAP_ROTATION_SETTINGS,
  db.STORES.ROUTE_SETTINGS,
  db.STORES.HALL_DEFINITIONS,
  db.STORES.HALL_ROUTE_SETTINGS,
  db.STORES.MAP_VIEWPORT_SETTINGS,
] as const;

const ORDINARY_STORE_NAMES = RESTORE_STORE_NAMES.filter(
  (storeName) => storeName !== db.STORES.MAP_DATA,
);

const FALLBACK_KEYS = [
  "eventShoppingLists",
  "eventMetadata",
  "executeModeItems",
  "dayModes",
  "mapData",
  "mapRotationSettings",
  "routeSettings",
  "hallDefinitions",
  "hallRouteSettings",
  "mapViewportSettings",
] as const;

function makeDayMap(marker: string): DayMapData {
  return {
    sheetName: `${marker}シート`,
    maxRow: 1,
    maxCol: 1,
    cells: [
      {
        row: 1,
        col: 1,
        value: marker,
        backgroundColor: null,
        fontColor: null,
        borders: {
          top: null,
          right: null,
          bottom: null,
          left: null,
        },
        isMerged: false,
        isVerticalText: false,
      },
    ],
    mergedCells: [],
    blocks: [],
  };
}

function makeAppData(marker: string): AppData {
  const eventName = `${marker}イベント`;

  return {
    eventConsistency: { [eventName]: createEventConsistency() },
    eventLists: {
      [eventName]: [{ id: `${marker}-item`, title: `${marker}頒布物` }],
    },
    eventMetadata: {
      [eventName]: { source: marker },
    },
    executeModeItems: {
      [eventName]: { "1日目": [`${marker}-item`] },
    },
    dayModes: {
      [eventName]: { "1日目": `${marker}モード` },
    },
    mapData: {
      [eventName]: {
        "1日目マップ": makeDayMap(`${marker}-day-1`),
        "2日目マップ": makeDayMap(`${marker}-day-2`),
      },
    },
    mapRotationSettings: {
      [eventName]: { "1日目マップ": { rotation: marker.length } },
    },
    routeSettings: {
      [eventName]: { "1日目マップ": { route: marker } },
    },
    hallDefinitions: {
      [eventName]: { "1日目マップ": [{ id: `${marker}-hall` }] },
    },
    hallRouteSettings: {
      [eventName]: { "1日目マップ": { order: [`${marker}-hall`] } },
    },
    mapViewportSettings: {
      [eventName]: { "1日目マップ": { scale: marker.length } },
    },
  };
}

async function readRawRestoreStores(): Promise<Record<string, unknown>> {
  return Object.fromEntries(
    await Promise.all(
      RESTORE_STORE_NAMES.map(async (storeName) => [
        storeName,
        await db.getAllData(storeName),
      ]),
    ),
  );
}

function setFallbackMarkers(marker: string): void {
  FALLBACK_KEYS.forEach((key) => {
    localStorage.setItem(key, `${marker}:${key}`);
  });
}

function expectFallbackMarkers(marker: string): void {
  FALLBACK_KEYS.forEach((key) => {
    expect(localStorage.getItem(key)).toBe(`${marker}:${key}`);
  });
}

describe("db.restoreAppDataAtomically", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replaces all ten app-data stores and leaves the sync queue untouched", async () => {
    const restoredData = makeAppData("成功");
    const syncQueue = [{ id: "keep-sync-queue" }];
    localStorage.clear();
    setFallbackMarkers("成功前");
    await db.saveSyncQueue(syncQueue);

    await expect(
      db.restoreAppDataAtomically(restoredData),
    ).resolves.toBeUndefined();

    expect(await db.getAllAppData()).toEqual(restoredData);
    const rawStores = await readRawRestoreStores();
    ORDINARY_STORE_NAMES.forEach((storeName) => {
      expect(Object.keys(rawStores[storeName] as object)).toEqual(["data"]);
    });
    expect(Object.keys(rawStores[db.STORES.MAP_DATA] as object).sort()).toEqual(
      [
        'mapData:["成功イベント","1日目マップ"]',
        'mapData:["成功イベント","2日目マップ"]',
      ],
    );
    expect(await db.loadSyncQueue()).toMatchObject({
      status: "ok",
      data: syncQueue,
    });
    expectFallbackMarkers("成功前");
  });

  it("normalizes an empty map event during atomic restore without leaving a split record", async () => {
    const restoredData = {
      ...makeAppData("空map復元"),
      mapData: { 空map復元イベント: {} },
    };
    localStorage.clear();

    await expect(
      db.restoreAppDataAtomically(restoredData),
    ).resolves.toBeUndefined();

    expect(await db.loadMapData()).toMatchObject({
      status: "missing",
      data: null,
    });
    expect(await db.getAllKeys(db.STORES.MAP_DATA)).toEqual([]);
  });

  it("updates only added, changed, and removed map records", async () => {
    const initialData = makeAppData("差分");
    const eventName = "差分イベント";
    initialData.mapData[eventName]["削除対象マップ"] =
      makeDayMap("removed-map");
    await db.restoreAppDataAtomically(initialData);

    const restoredData: AppData = {
      ...initialData,
      mapData: {
        [eventName]: {
          "1日目マップ": initialData.mapData[eventName]["1日目マップ"],
          "2日目マップ": makeDayMap("changed-map"),
          追加対象マップ: makeDayMap("added-map"),
        },
      },
    };
    const putSpy = vi.spyOn(IDBObjectStore.prototype, "put");
    const deleteSpy = vi.spyOn(IDBObjectStore.prototype, "delete");

    await db.restoreAppDataAtomically(restoredData);

    const mapPutKeys = putSpy.mock.calls.flatMap((args, index) =>
      (putSpy.mock.contexts[index] as IDBObjectStore).name ===
      db.STORES.MAP_DATA
        ? [String(args[1])]
        : [],
    );
    const mapDeleteKeys = deleteSpy.mock.calls.flatMap((args, index) =>
      (deleteSpy.mock.contexts[index] as IDBObjectStore).name ===
      db.STORES.MAP_DATA
        ? [String(args[0])]
        : [],
    );

    expect(mapPutKeys.sort()).toEqual(
      [
        `mapData:${JSON.stringify([eventName, "2日目マップ"])}`,
        `mapData:${JSON.stringify([eventName, "追加対象マップ"])}`,
      ].sort(),
    );
    expect(mapDeleteKeys).toEqual([
      `mapData:${JSON.stringify([eventName, "削除対象マップ"])}`,
    ]);
    expect(await db.getAllAppData()).toEqual(restoredData);
  });

  it("rolls back a mid-restore DataCloneError and succeeds on retry", async () => {
    const initialData = makeAppData("復元前");
    const retryData = makeAppData("再成功");
    const syncQueue = [{ id: "still-in-sync-queue" }];
    localStorage.clear();
    await db.saveSyncQueue(syncQueue);
    await db.restoreAppDataAtomically(initialData);
    const beforeFailure = await readRawRestoreStores();
    setFallbackMarkers("失敗前");

    const failingData: AppData = {
      ...makeAppData("失敗候補"),
      routeSettings: {
        失敗候補イベント: {
          "1日目マップ": {
            uncloneable: () => "DataCloneError",
          },
        },
      },
    };

    await expect(
      db.restoreAppDataAtomically(failingData),
    ).rejects.toMatchObject({
      name: "DataCloneError",
    });

    expect(await readRawRestoreStores()).toEqual(beforeFailure);
    expect(await db.getAllAppData()).toEqual(initialData);
    expect(await db.loadSyncQueue()).toMatchObject({
      status: "ok",
      data: syncQueue,
    });
    expectFallbackMarkers("失敗前");

    await expect(
      db.restoreAppDataAtomically(retryData),
    ).resolves.toBeUndefined();

    expect(await db.getAllAppData()).toEqual(retryData);
    expect(await db.loadSyncQueue()).toMatchObject({
      status: "ok",
      data: syncQueue,
    });
    expectFallbackMarkers("失敗前");
  });

  it("does not touch legacy sources while restoring", async () => {
    const restoredData = makeAppData("後片付け失敗");
    localStorage.clear();
    setFallbackMarkers("削除前");
    const cleanupError = new Error("localStorage is locked");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementationOnce(() => {
      throw cleanupError;
    });

    await expect(
      db.restoreAppDataAtomically(restoredData),
    ).resolves.toBeUndefined();

    expect(await db.getAllAppData()).toEqual(restoredData);
    expectFallbackMarkers("削除前");
    expect(Storage.prototype.removeItem).not.toHaveBeenCalled();
  });
});
it("writes only changed stores while checking every durable root", async () => {
  await db.restoreAppDataAtomically(makeAppData("差分保存"));
  const before = await db.readApplicationSnapshot();
  const next = {
    ...before.snapshot,
    dayModes: { 差分保存イベント: { "1日目": "execute" } },
  };
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  try {
    await db.commitApplicationSnapshotAtomically(next, {
      expectedRoots: before.expectedRoots,
      changedStoresOnly: true,
    });
    expect(
      put.mock.instances.map((store) => (store as IDBObjectStore).name).sort(),
    ).toEqual(
      [db.STORES.DAY_MODES, db.STORES.SYNC_QUEUE, db.STORES.SYNC_QUEUE].sort(),
    );
    expect(await db.getAllAppData()).toEqual(next);
    const after = await db.readApplicationSnapshot();
    const roots = (read: typeof before) =>
      (read.expectedRoots as { roots: Map<string, unknown> }).roots;
    for (const store of RESTORE_STORE_NAMES) {
      if (store === db.STORES.DAY_MODES)
        expect(roots(after).get(store)).not.toEqual(roots(before).get(store));
      else expect(roots(after).get(store)).toEqual(roots(before).get(store));
    }
    put.mockClear();
    await db.commitApplicationSnapshotAtomically(after.snapshot, {
      expectedRoots: after.expectedRoots,
      changedStoresOnly: true,
    });
    expect(
      put.mock.instances.map((store) => (store as IDBObjectStore).name).sort(),
    ).toEqual(
      [db.STORES.DAY_MODES, db.STORES.SYNC_QUEUE, db.STORES.SYNC_QUEUE].sort(),
    );
  } finally {
    put.mockRestore();
  }
});

it("rejects a changed unrelated store during an optimized atomic save", async () => {
  await db.restoreAppDataAtomically(makeAppData("全領域競合"));
  const before = await db.readApplicationSnapshot();
  const remoteModes = { 全領域競合イベント: { "1日目": "focus" } };
  await db.saveDayModes(remoteModes);
  await expect(
    db.commitApplicationSnapshotAtomically(
      {
        ...before.snapshot,
        eventMetadata: { 全領域競合イベント: { source: "local" } },
      },
      { expectedRoots: before.expectedRoots, changedStoresOnly: true },
    ),
  ).rejects.toMatchObject({ name: "PersistenceConflict" });
  const after = await db.getAllAppData();
  expect(after.dayModes).toEqual(remoteModes);
  expect(after.eventMetadata).toEqual(before.snapshot.eventMetadata);
});

it("reuses only a private unchanged map and captures caller edits before awaiting", async () => {
  await db.restoreAppDataAtomically(makeAppData("準備省略"));
  const before = await db.readApplicationSnapshot();
  const expectedMap = structuredClone(before.snapshot.mapData);
  const next = {
    ...before.snapshot,
    dayModes: { 準備省略イベント: { "1日目": "execute" } },
  };
  // Diagnostic roots are detached from the actual observed CAS baseline.
  (before.expectedRoots as { roots: Map<string, unknown> }).roots.clear();
  const normalize = vi.spyOn(mapPersistence, "normalizeMapDataForPersistence");
  const clone = vi.spyOn(globalThis, "structuredClone");
  try {
    const saving = db.commitApplicationSnapshotAtomically(next, {
      expectedRoots: before.expectedRoots,
      changedStoresOnly: true,
    });
    next.mapData.準備省略イベント["1日目マップ"] = makeDayMap("後から変更");
    next.dayModes.準備省略イベント["1日目"] = "focus";
    await saving;
    expect(normalize).not.toHaveBeenCalled();
    expect(
      clone.mock.calls.some(
        ([value]) => value === next || value === next.mapData,
      ),
    ).toBe(false);
  } finally {
    normalize.mockRestore();
    clone.mockRestore();
  }
  const saved = await db.getAllAppData();
  expect(saved.mapData).toEqual(expectedMap);
  expect(saved.dayModes).toEqual({ 準備省略イベント: { "1日目": "execute" } });
});

it("fully prepares changed maps and full restores even when observed roots exist", async () => {
  await db.restoreAppDataAtomically(makeAppData("全面準備"));
  const before = await db.readApplicationSnapshot();
  before.snapshot.mapData.全面準備イベント["1日目マップ"] =
    makeDayMap("変更されたマップ");
  const normalize = vi.spyOn(mapPersistence, "normalizeMapDataForPersistence");
  try {
    await db.commitApplicationSnapshotAtomically(before.snapshot, {
      expectedRoots: before.expectedRoots,
      changedStoresOnly: true,
    });
    expect(normalize).toHaveBeenCalledTimes(1);
    const after = await db.readApplicationSnapshot();
    normalize.mockClear();
    await db.restoreAppDataAtomically(after.snapshot, {
      expectedRoots: after.expectedRoots,
    });
    expect(normalize).toHaveBeenCalledTimes(1);
  } finally {
    normalize.mockRestore();
  }
  expect((await db.getAllAppData()).mapData).toEqual(before.snapshot.mapData);
});

it("rejects raw map tampering during a save that skips unchanged-map preparation", async () => {
  await db.restoreAppDataAtomically(makeAppData("map競合"));
  const before = await db.readApplicationSnapshot();
  const entries = await db.getAllData(db.STORES.MAP_DATA);
  const key = Object.keys(entries)[0];
  const value = structuredClone(entries[key]) as DayMapData;
  value.cells[0].value = "他の書き込み";
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(db.STORES.MAP_DATA, "readwrite");
    tx.objectStore(db.STORES.MAP_DATA).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  const normalize = vi.spyOn(mapPersistence, "normalizeMapDataForPersistence");
  try {
    await expect(
      db.commitApplicationSnapshotAtomically(
        {
          ...before.snapshot,
          eventMetadata: { map競合イベント: { source: "local" } },
        },
        { expectedRoots: before.expectedRoots, changedStoresOnly: true },
      ),
    ).rejects.toMatchObject({ name: "PersistenceConflict" });
    expect(normalize).not.toHaveBeenCalled();
  } finally {
    normalize.mockRestore();
  }
  expect(await db.getAllData(db.STORES.EVENT_METADATA)).toEqual({
    data: before.snapshot.eventMetadata,
  });
  expect((await db.getAllData(db.STORES.MAP_DATA))[key]).toEqual(value);
  // Leave the shared test database valid for subsequent restore tests.
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(db.STORES.MAP_DATA, "readwrite");
    tx.objectStore(db.STORES.MAP_DATA).put(entries[key], key);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
});

it("retains rollback and retry behavior when unchanged-map preparation is skipped", async () => {
  await db.restoreAppDataAtomically(makeAppData("軽量再試行"));
  const before = await db.readApplicationSnapshot();
  const next = {
    ...before.snapshot,
    eventMetadata: { 軽量再試行イベント: { source: "retry" } },
  };
  const originalPut = IDBObjectStore.prototype.put;
  const put = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === db.STORES.EVENT_METADATA)
        throw new DOMException("simulated save failure", "DataCloneError");
      return originalPut.call(this, value, key);
    });
  try {
    await expect(
      db.commitApplicationSnapshotAtomically(next, {
        expectedRoots: before.expectedRoots,
        changedStoresOnly: true,
      }),
    ).rejects.toMatchObject({ name: "DataCloneError" });
  } finally {
    put.mockRestore();
  }
  expect(await db.getAllAppData()).toEqual(before.snapshot);
  await db.commitApplicationSnapshotAtomically(next, {
    expectedRoots: before.expectedRoots,
    changedStoresOnly: true,
  });
  expect(await db.getAllAppData()).toEqual(next);
});

it("keeps legacy map normalization even when a caller leaves the map unchanged", async () => {
  await db.restoreAppDataAtomically(makeAppData("旧形式準備"));
  const initial = await db.readApplicationSnapshot();
  const legacyMap = structuredClone(initial.snapshot.mapData);
  const day = legacyMap.旧形式準備イベント["1日目マップ"] as DayMapData;
  day.cells[0].backgroundColor = "#FFFFFF";
  const metadata = await prepareMetadataForPayload(
    db.STORES.MAP_DATA,
    "data",
    legacyMap,
    null,
  );
  const checkpoint = createNextPersistenceCheckpoint(
    db.STORES.MAP_DATA,
    "data",
    metadata,
    null,
    [],
  );
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(
      [db.STORES.MAP_DATA, db.STORES.SYNC_QUEUE],
      "readwrite",
    );
    for (const [event, maps] of Object.entries(legacyMap))
      for (const [name, map] of Object.entries(maps)) {
        tx.objectStore(db.STORES.MAP_DATA).put(
          map,
          `mapData:${JSON.stringify([event, name])}`,
        );
      }
    tx.objectStore(db.STORES.SYNC_QUEUE).put(
      metadata,
      createPersistenceMetadataKey(db.STORES.MAP_DATA, "data"),
    );
    tx.objectStore(db.STORES.SYNC_QUEUE).put(
      checkpoint,
      createPersistenceCheckpointKey(db.STORES.MAP_DATA, "data"),
    );
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  const before = await db.readApplicationSnapshot();
  const normalize = vi.spyOn(mapPersistence, "normalizeMapDataForPersistence");
  try {
    await db.commitApplicationSnapshotAtomically(
      {
        ...before.snapshot,
        dayModes: { 旧形式準備イベント: { "1日目": "execute" } },
      },
      { expectedRoots: before.expectedRoots, changedStoresOnly: true },
    );
    expect(normalize).toHaveBeenCalledTimes(1);
  } finally {
    normalize.mockRestore();
  }
  const saved = await db.getAllAppData();
  expect(
    (saved.mapData.旧形式準備イベント["1日目マップ"] as DayMapData).cells[0]
      .backgroundColor,
  ).toBeNull();
  expect(saved.dayModes).toEqual({
    旧形式準備イベント: { "1日目": "execute" },
  });
});
