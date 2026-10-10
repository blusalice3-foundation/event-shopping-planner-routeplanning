import {
  createNextPersistenceCheckpoint,
  prepareMetadataForPayload,
} from "../internal/persistenceCore";
import {
  createPersistenceMetadataKey,
  createPersistenceCheckpointKey,
} from "../../utils/persistenceResilience";
import { IDBFactory, IDBObjectStore, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { db } from "../facade/indexedDbPersistence";
import { resetDatabaseConnection } from "../db/openDatabase";
import { DAY_RECORD_PREFIX } from "../db/dayRecordStorage";
import { createPersistenceWorkerServer } from "./persistenceWorkerServer";
import {
  applySnapshotBranches,
  type WorkerSnapshotRead,
} from "./snapshotDelta";
import { migrateLegacyConsistency } from "../../features/consistency/domain/migration";
import {
  scopeDaySnapshot,
  adoptScopedDaySnapshot,
} from "../../features/consistency/domain/dayMutation";
import { dayMutationScope } from "../../features/consistency/domain/dayScope";
import { planVisitPanelMutation } from "../../features/consistency/domain/visitPanelMutation";
import { createApplicationMutationCoordinator } from "../../app/commands/applicationMutationCoordinator";
import type {
  ApplicationDayMutation,
  ApplicationSnapshotRead,
  PersistenceSnapshot,
} from "../../app/ports/PersistenceCommandPort";

beforeEach(() => {
  resetDatabaseConnection();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", {
    length: 0,
    key: () => null,
    getItem: () => null,
    setItem() {},
    removeItem() {},
  });
});
afterEach(() => {
  resetDatabaseConnection();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const item = (id: string, day = "1日目") => ({
  id,
  eventDate: day,
  circle: "ユーザー登録",
  title: "新刊",
  block: "A",
  number: id,
  price: 100,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "エラーが発生しました",
});
async function seed(history = 10000) {
  const map = {
    maxRow: 6,
    maxCol: 6,
    cells: [],
    mergedCells: [],
    blocks: [
      {
        name: "A",
        startRow: 1,
        startCol: 1,
        endRow: 5,
        endCol: 5,
        numberCells: [1, 2, 3].map((value) => ({
          row: value + 1,
          col: 2,
          value,
        })),
      },
    ],
  };
  const hall = {
    id: "hall",
    name: "東館",
    vertices: [
      { row: 1, col: 1 },
      { row: 1, col: 5 },
      { row: 5, col: 5 },
      { row: 5, col: 1 },
    ],
  };
  const past = Array.from({ length: history }, (_, index) =>
    item("past-" + index),
  );
  const data = migrateLegacyConsistency({
    eventLists: {
      event: [
        item("1"),
        item("2"),
        item("3"),
        item("4", "2日目"),
        item("5", "3日目"),
      ],
      past,
    },
    eventMetadata: {},
    executeModeItems: {
      event: { "1日目": ["1", "2", "3"], "2日目": ["4"], "3日目": ["5"] },
      past: { "1日目": past.map((value) => value.id) },
    },
    dayModes: {
      event: { "1日目": "execute", "2日目": "execute", "3日目": "focus" },
      past: { "1日目": "execute" },
    },
    mapData: { event: { "1日目マップ": map, "3日目マップ": map } },
    mapRotationSettings: {},
    mapViewportSettings: {
      event: {
        "1日目マップ": { zoomLevel: 100, offsetX: 1, offsetY: 2 },
        "3日目マップ": { zoomLevel: 125, offsetX: 3, offsetY: 4 },
      },
      past: { "1日目マップ": { zoomLevel: 150, offsetX: 5, offsetY: 6 } },
    },
    hallDefinitions: {
      event: { "1日目マップ": [hall], "3日目マップ": [hall] },
    },
    hallRouteSettings: {
      event: {
        "1日目マップ": {
          hallOrder: ["hall"],
          hallVisitLists: [{ hallId: "hall", itemIds: ["1", "2", "3"] }],
        },
      },
    },
    routeSettings: {
      event: {
        "1日目マップ": {
          isRouteVisible: true,
          visitOrder: [1, 2, 3].map((number, index) => ({
            row: number + 1,
            col: 2,
            blockName: "A",
            number,
            order: index,
            itemIds: [String(number)],
          })),
        },
      },
    },
  }).data;
  const read = await db.readApplicationSnapshot();
  await db.commitApplicationSnapshotAtomically(data, {
    expectedRoots: read.expectedRoots,
  });
  resetDatabaseConnection();
  return data;
}
type Visits = Extract<ApplicationDayMutation, { kind: "visits" }>;
const command = (order?: readonly string[], modeDay?: string): Visits => ({
  kind: "visits",
  eventName: "event",
  day: "1日目",
  mapKey: "1日目マップ",
  order,
  modeDay,
});
const operations = [
  { name: "reorder", order: ["3", "2", "1"] },
  { name: "discard", order: ["2", "1", "3"] },
  { name: "save", order: undefined },
  {
    name: "save and change another day's mode",
    order: undefined,
    modeDay: "2日目",
  },
  {
    name: "discard and change another day's mode",
    order: ["2", "1", "3"],
    modeDay: "2日目",
  },
];
it.each(
  [0, 10000].flatMap((history) =>
    operations.map((operation) => ({ history, ...operation })),
  ),
)(
  "$name reads and writes only its dates on a cold cache, history=$history",
  async ({ history, order, modeDay }) => {
    const before = await seed(history);
    const server = createPersistenceWorkerServer(db);
    const get = vi.spyOn(IDBObjectStore.prototype, "get");
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    const cursor = vi.spyOn(IDBObjectStore.prototype, "openCursor");
    const result = await server.day(
      command(order, modeDay),
      "visit-operation",
      {},
    );
    expect(result.status).toBe("committed");
    expect(cursor).not.toHaveBeenCalled();
    expect(
      get.mock.calls.some(
        ([key]) =>
          String(key).includes("past") || String(key).includes("3日目"),
      ),
    ).toBe(false);
    expect(get.mock.calls.filter(([key]) => key === "data")).toHaveLength(7);
    expect(
      put.mock.instances.some((store) =>
        ["eventLists", "mapData"].includes((store as IDBObjectStore).name),
      ),
    ).toBe(false);
    const records = put.mock.calls.filter(([, key]) =>
      String(key).startsWith(DAY_RECORD_PREFIX),
    );
    if (order || modeDay) expect(records.length).toBeGreaterThan(0);
    expect(
      records.every(
        ([value]) =>
          value.eventName === "event" &&
          (!value.path.length ||
            ["1日目", "1日目マップ", ...(modeDay ? [modeDay] : [])].includes(
              value.path.at(-1),
            )),
      ),
    ).toBe(true);
    expect(
      put.mock.calls
        .filter(([, key]) => key === "data")
        .every(([value]) => JSON.stringify(value).length < 250),
    ).toBe(true);
    if (result.status !== "committed") throw new Error("not committed");
    expect(result.read.delta.full).toBeUndefined();
    expect(result.read.delta.scope?.target).toEqual(
      dayMutationScope(command(order, modeDay)),
    );
    get.mockRestore();
    put.mockRestore();
    cursor.mockRestore();
    const saved = (await db.readApplicationSnapshot()).snapshot;
    expect(saved.executeModeItems.event["1日目"]).toEqual(
      order ?? ["1", "2", "3"],
    );
    expect(saved.executeModeItems.event["3日目"]).toEqual(["5"]);
    expect(saved.dayModes.event["2日目"]).toBe(modeDay ? "edit" : "execute");
    expect(saved.dayModes.event["3日目"]).toBe("focus");
    expect(saved.eventLists).toEqual(before.eventLists);
    expect(saved.executeModeItems.past).toEqual(before.executeModeItems.past);
    expect(saved.mapData).toEqual(before.mapData);
    if (order) {
      const route = saved.eventConsistency.event.days["1日目"].maps[
        "1日目マップ"
      ].route as {
        visitOrder: Array<{ itemIds: string[] }>;
      };
      expect(route.visitOrder.flatMap((point) => point.itemIds)).toEqual(order);
      const settings = saved.eventConsistency.event.days["1日目"].maps[
        "1日目マップ"
      ] as {
        hallVisitLists: Array<{ itemIds: string[] }>;
      };
      expect(settings.hallVisitLists.flatMap((hall) => hall.itemIds)).toEqual(
        order,
      );
    }
  },
);
it("separates one-day and two-day cache entries and keeps warm replies free of history", async () => {
  await seed();
  const server = createPersistenceWorkerServer(db);
  await server.readDay(dayMutationScope(command()));
  const get = vi.spyOn(IDBObjectStore.prototype, "get");
  const cursor = vi.spyOn(IDBObjectStore.prototype, "openCursor");
  const combined = await server.day(
    command(["2", "1", "3"], "2日目"),
    "two-days",
    {},
  );
  expect(combined.status).toBe("committed");
  expect(get.mock.calls.some(([key]) => String(key).includes("2日目"))).toBe(
    true,
  );
  expect(
    get.mock.calls.some(
      ([key]) => String(key).includes("3日目") || String(key).includes("past"),
    ),
  ).toBe(false);
  get.mockClear();
  const repeated = await server.day(
    command(["1", "2", "3"], "2日目"),
    "two-days-repeat",
    {},
  );
  expect(repeated.status).toBe("committed");
  expect(get.mock.calls.some(([key]) => key === "data")).toBe(false);
  expect(cursor).not.toHaveBeenCalled();
  if (repeated.status !== "committed") throw new Error("not committed");
  expect(JSON.stringify(repeated.read.delta)).not.toContain("past-");
  get.mockClear();
  expect((await server.day(command(), "one-day-again", {})).status).toBe(
    "committed",
  );
  expect(get.mock.calls.some(([key]) => String(key).includes("2日目"))).toBe(
    false,
  );
});
it("rolls back visits, hall lists, routes and target mode together, then permits retry", async () => {
  const before = await seed();
  const server = createPersistenceWorkerServer(db);
  const original = IDBObjectStore.prototype.put;
  const fault = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof original>
    ) {
      if (this.name === "dayModes")
        throw new DOMException("保存失敗", "QuotaExceededError");
      return original.apply(this, args);
    });
  const change = command(["3", "2", "1"], "2日目");
  await expect(server.day(change, "retry", {})).rejects.toThrow("保存失敗");
  fault.mockRestore();
  expect((await db.readApplicationSnapshot()).snapshot).toEqual(before);
  expect((await server.day(change, "retry", {})).status).toBe("committed");
  const saved = (await db.readApplicationSnapshot()).snapshot;
  expect(saved.executeModeItems.event["1日目"]).toEqual(["3", "2", "1"]);
  expect(saved.dayModes.event["2日目"]).toBe("edit");
});
it("retries a real CAS conflict using scoped reads and retains another tab's unrelated mode", async () => {
  const before = await seed();
  let attempts = 0;
  const get = vi.spyOn(IDBObjectStore.prototype, "get");
  const cursor = vi.spyOn(IDBObjectStore.prototype, "openCursor");
  const server = createPersistenceWorkerServer({
    ...db,
    async commitDayCommandSnapshot(
      ...args: Parameters<typeof db.commitDayCommandSnapshot>
    ) {
      if (++attempts === 1) {
        await db.saveDayModes({
          ...before.dayModes,
          event: { ...before.dayModes.event, "3日目": "edit" },
        });
        get.mockClear();
        cursor.mockClear();
      }
      return db.commitDayCommandSnapshot(...args);
    },
  });
  expect(
    (await server.day(command(["2", "1", "3"], "2日目"), "competing", {}))
      .status,
  ).toBe("committed");
  expect(attempts).toBe(2);
  expect(cursor).not.toHaveBeenCalled();
  expect(
    get.mock.calls.some(
      ([key]) => String(key).includes("past") || String(key).includes("3日目"),
    ),
  ).toBe(false);
  const saved = (await db.readApplicationSnapshot()).snapshot;
  expect(saved.dayModes.event["3日目"]).toBe("edit");
  expect(saved.dayModes.event["2日目"]).toBe("edit");
});
it("rejects a third-date write even when the caller declares a two-day scope", async () => {
  await seed(0);
  const server = createPersistenceWorkerServer(db);
  const target = dayMutationScope(command(undefined, "2日目"));
  const read = await server.readDay(target);
  const proposed = structuredClone(
    scopeDaySnapshot(
      read.delta.scope!.snapshot,
      target.eventName,
      target.day,
      target.additionalDays,
    ),
  );
  proposed.dayModes.event["3日目"] = "edit";
  await expect(
    server.commitDay(proposed, read.observationId, target),
  ).rejects.toThrow("another date");
  expect(
    (await db.readApplicationSnapshot()).snapshot.dayModes.event["3日目"],
  ).toBe("focus");
});
it("keeps review, renewed approval and the confirmed compound commit scoped without cloning UI history", async () => {
  const before = await seed();
  await db.saveDayModes({
    ...before.dayModes,
    event: { ...before.dayModes.event, " 1日目　": "focus" },
  });
  resetDatabaseConnection();
  let current = structuredClone(before);
  const historical = current.eventLists.past;
  Object.defineProperty(historical[0], "title", {
    enumerable: true,
    get() {
      throw new Error("Historical UI items must not be inspected");
    },
  });
  const server = createPersistenceWorkerServer(db);
  const adopt = (value: WorkerSnapshotRead): ApplicationSnapshotRead => {
    const transferred = structuredClone(value);
    const snapshot = transferred.delta.scope
      ? adoptScopedDaySnapshot(
          current,
          transferred.delta.scope.snapshot,
          transferred.delta.scope.target,
        )
      : applySnapshotBranches(current, transferred.delta.branches ?? []);
    return {
      snapshot,
      expectedRoots: { workerObservation: transferred.observationId },
      consistencyMissing: transferred.consistencyMissing,
      eventGenerations: transferred.eventGenerations,
    };
  };
  const readFull = vi.fn(db.readApplicationSnapshot);
  const commitFull = vi.fn(async () => {
    throw new Error("Full commit forbidden");
  });
  const readScoped = vi.fn(
    async (target: Parameters<typeof server.readDay>[0]) =>
      adopt(await server.readDay(target)),
  );
  const commitScoped = vi.fn(
    async (
      snapshot: PersistenceSnapshot,
      roots: object,
      target: Parameters<typeof server.readDay>[0],
    ) =>
      adopt(
        await server.commitDay(
          snapshot,
          (roots as { workerObservation: number }).workerObservation,
          target,
        ),
      ),
  );
  const coordinator = createApplicationMutationCoordinator({
    readCurrent: () => current,
    drain: async () => {},
    readDurable: readFull,
    commit: commitFull,
    readDayDurable: readScoped,
    commitDaySnapshot: commitScoped,
    commitDayMutation: async (...args) => {
      const result = await server.day(...args);
      return result.status === "committed"
        ? { ...result, read: adopt(result.read) }
        : result;
    },
    apply: (snapshot) => {
      current = snapshot;
    },
  });
  const change = command(["2", "1", "3"], "2日目");
  const first = await coordinator.request({
    id: "reviewed-visits",
    events: ["event"],
    dayMutation: change,
    plan: (snapshot, choices) =>
      planVisitPanelMutation(snapshot, change, choices),
  });
  expect(first.status).toBe("confirmation-required");
  if (first.status !== "confirmation-required") throw new Error("no review");
  await db.saveDayModes({
    ...before.dayModes,
    event: {
      ...before.dayModes.event,
      " 1日目　": "focus",
      "2日目": "focus",
      "3日目": "edit",
    },
  });
  const renewed = await coordinator.confirm(first.token);
  expect(renewed.status).toBe("confirmation-required");
  if (renewed.status !== "confirmation-required")
    throw new Error("no renewed review");
  expect((await coordinator.confirm(renewed.token)).status).toBe("committed");
  expect(readFull).not.toHaveBeenCalled();
  expect(commitFull).not.toHaveBeenCalled();
  expect(
    readScoped.mock.calls.every(
      ([target]) =>
        target.eventName === "event" &&
        target.additionalDays?.join() === "2日目",
    ),
  ).toBe(true);
  expect(commitScoped).toHaveBeenCalledOnce();
  expect(current.eventLists.past).toBe(historical);
  expect(current.dayModes.event["3日目"]).toBe("focus"); // The UI retains unrelated dates until their own refresh.
  const saved = (await db.readApplicationSnapshot()).snapshot;
  expect(saved.dayModes.event["3日目"]).toBe("edit");
  expect(saved.executeModeItems.event["1日目"]).toEqual(["2", "1", "3"]);
  expect(saved.dayModes.event["2日目"]).toBe("execute");
});

it.each([0, 10000])(
  "scopes viewport cleanup to its source date on a cold cache, history=%i",
  async (history) => {
    const before = await seed(history);
    const server = createPersistenceWorkerServer(db);
    const get = vi.spyOn(IDBObjectStore.prototype, "get");
    const cursor = vi.spyOn(IDBObjectStore.prototype, "openCursor");
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    const viewport = { zoomLevel: 200, offsetX: 15, offsetY: 25 };
    const result = await server.day(
      {
        kind: "map-viewport",
        eventName: "event",
        day: "1日目",
        mapKey: "1日目マップ",
        viewport,
      },
      "viewport",
      {},
    );
    expect(result.status).toBe("committed");
    expect(cursor).not.toHaveBeenCalled();
    expect(get.mock.calls.filter(([key]) => key === "data")).toHaveLength(7);
    expect(
      get.mock.calls.some(
        ([key]) =>
          String(key).includes("past") || String(key).includes("3日目"),
      ),
    ).toBe(false);
    expect(
      put.mock.instances.every((store) =>
        ["syncQueue", "mapViewportSettings"].includes(
          (store as IDBObjectStore).name,
        ),
      ),
    ).toBe(true);
    const records = put.mock.calls.filter(([, key]) =>
      String(key).startsWith(DAY_RECORD_PREFIX),
    );
    expect(records).toHaveLength(2);
    expect(
      records.every(
        ([value]) =>
          value.eventName === "event" &&
          (!value.path.length || value.path[0] === "1日目マップ"),
      ),
    ).toBe(true);
    vi.restoreAllMocks();
    const saved = (await db.readApplicationSnapshot()).snapshot;
    expect(saved.mapViewportSettings).toEqual({
      ...before.mapViewportSettings,
      event: { ...before.mapViewportSettings.event, "1日目マップ": viewport },
    });
    expect(saved.dayModes).toEqual(before.dayModes);
    expect(saved.eventLists).toEqual(before.eventLists);
    expect(saved.mapData).toEqual(before.mapData);
  },
);

it("upgrades signed DB 10 viewport settings into DB 11 date records without losing other dates or events", async () => {
  const original = await seed();
  resetDatabaseConnection();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("EventShoppingPlannerDB");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("EventShoppingPlannerDB", 10);
    request.onupgradeneeded = () => {
      for (const store of [...Object.keys(original), "syncQueue"])
        request.result.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const roots = await Promise.all(
    Object.entries(original).map(async ([storeName, payload]) => {
      const store = storeName as keyof PersistenceSnapshot;
      const metadata = await prepareMetadataForPayload(
        store,
        "data",
        payload,
        null,
      );
      const checkpoint = createNextPersistenceCheckpoint(
        store,
        "data",
        metadata,
        null,
      );
      return { store, payload, metadata, checkpoint };
    }),
  );
  await new Promise<void>((resolve, reject) => {
    const transaction = legacy.transaction(
      [...Object.keys(original), "syncQueue"],
      "readwrite",
    );
    for (const { store, payload, metadata, checkpoint } of roots) {
      transaction.objectStore(store).put(payload, "data");
      transaction
        .objectStore("syncQueue")
        .put(metadata, createPersistenceMetadataKey(store, "data"));
      transaction
        .objectStore("syncQueue")
        .put(checkpoint, createPersistenceCheckpointKey(store, "data"));
    }
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
  legacy.close();
  await createPersistenceWorkerServer(db).read();
  const saved = (await db.readApplicationSnapshot()).snapshot;
  expect(saved.mapViewportSettings).toEqual(original.mapViewportSettings);
  expect(saved.eventLists).toEqual(original.eventLists);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("EventShoppingPlannerDB");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  expect(database.version).toBe(11);
  const head = await new Promise<unknown>((resolve, reject) => {
    const request = database
      .transaction("mapViewportSettings")
      .objectStore("mapViewportSettings")
      .get("data");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  expect(head).toMatchObject({
    kind: "event-shopping-planner-day-records",
    authenticatedRoots: true,
    storeName: "mapViewportSettings",
    count: 5,
  });
  database.close();
});
