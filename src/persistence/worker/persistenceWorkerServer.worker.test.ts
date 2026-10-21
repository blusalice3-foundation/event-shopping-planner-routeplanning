import { projectConsistencySnapshot } from "../../features/consistency/domain/projection";
import * as snapshotDeltas from "./snapshotDelta";
import {
  planShoppingMove,
  shoppingMoveVisitBaseline,
} from "../../app/commands/shoppingMoveMutation";
import { createWorkerPersistenceCommandAdapter } from "../adapters/workerPersistenceCommandAdapter";
import { IDBFactory, IDBObjectStore, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../facade/indexedDbPersistence";
import { resetDatabaseConnection, openDatabase } from "../db/openDatabase";
import { createPersistenceWorkerServer } from "./persistenceWorkerServer";
import { createEventConsistency } from "../../types/consistency";
import type {
  ItemContentEdit,
  PersistenceSnapshot,
} from "../../app/ports/PersistenceCommandPort";
const item = {
  id: "1",
  circle: "ユーザー登録",
  title: "新刊",
  eventDate: "1日目",
  block: "A",
  number: "1",
  price: 500,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "",
  source: "spreadsheet",
  protectionLevel: "none",
};
const seed = (): PersistenceSnapshot => ({
  eventLists: { event: [item] },
  eventConsistency: { event: createEventConsistency() },
  eventMetadata: {},
  executeModeItems: { event: { "1日目": [] } },
  dayModes: { event: { "1日目": "execute" } },
  mapData: {},
  mapRotationSettings: {},
  mapViewportSettings: {},
  routeSettings: {},
  hallDefinitions: {},
  hallRouteSettings: {},
});
const edit = (
  field: string,
  value: unknown,
  baseline = item,
): ItemContentEdit => ({
  eventName: "event",
  itemId: "1",
  baseline,
  fields: { [field]: { present: true, value } },
});
beforeEach(() => {
  resetDatabaseConnection();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return storage.size;
    },
    key: (index: number) => [...storage.keys()][index] ?? null,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => {
  resetDatabaseConnection();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function setup() {
  const initial = await db.readApplicationSnapshot();
  await db.commitApplicationSnapshotAtomically(seed(), {
    expectedRoots: initial.expectedRoots,
  });
  const commit = vi.fn(db.commitApplicationSnapshotAtomically);
  const server = createPersistenceWorkerServer({
    readApplicationSnapshot: db.readApplicationSnapshot,
    commitApplicationSnapshotAtomically: commit,
  });
  await server.read();
  return { server, commit };
}
describe("storage worker transactions", () => {
  it("commits ordered field edits once and returns only the resulting fields", async () => {
    const { server, commit } = await setup();
    const result = await server.items(
      [edit("quantity", 2), edit("quantity", 7, { ...item, quantity: 2 })],
      ["1", "2"],
      {},
    );
    expect(result.status).toBe("committed");
    expect(commit).toHaveBeenCalledOnce();
    if (result.status !== "committed") throw new Error("not committed");
    expect(result.read.delta.full).toBeUndefined();
    expect(result.read.delta.stores?.eventLists).toBeUndefined();
    expect(result.read.delta.items?.[0].fields.quantity.value).toBe(7);
    const durable = await db.readApplicationSnapshot();
    expect(durable.snapshot.eventLists.event[0]).toMatchObject({
      quantity: 7,
      protectionLevel: "deletable",
    });
  });
  it("writes nothing across a conflict or a deleted target", async () => {
    const { server, commit } = await setup();
    const remote = await db.readApplicationSnapshot();
    (remote.snapshot.eventLists.event[0] as typeof item).remarks = "他タブ";
    await db.commitApplicationSnapshotAtomically(remote.snapshot, {
      expectedRoots: remote.expectedRoots,
    });
    expect(
      await server.items(
        [edit("price", 900), edit("remarks", "今回")],
        ["1", "2"],
        {},
      ),
    ).toEqual({ status: "review-required" });
    expect(commit).not.toHaveBeenCalled();
    expect(
      await server.items(
        [{ ...edit("price", 900), itemId: "missing" }],
        ["3"],
        {},
      ),
    ).toEqual({ status: "review-required" });
  });
  it("retains all-store tamper checks even for a one-item edit", async () => {
    const { server, commit } = await setup();
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("eventMetadata", "readwrite");
      tx.objectStore("eventMetadata").put(
        { event: { unexpected: true } },
        "data",
      );
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    await expect(
      server.items([edit("price", 900)], ["1"], {}),
    ).rejects.toThrow();
    expect(commit).not.toHaveBeenCalled();
  });
  it("rolls back a failed write and accepts the same pending fields on retry", async () => {
    const { server } = await setup();
    const original = IDBObjectStore.prototype.put;
    const fault = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (
        this: IDBObjectStore,
        ...args: Parameters<typeof original>
      ) {
        if (this.name === "eventLists")
          throw new DOMException("quota", "QuotaExceededError");
        return original.apply(this, args);
      });
    await expect(
      server.items([edit("quantity", 7)], ["1"], {}),
    ).rejects.toThrow();
    fault.mockRestore();
    expect(
      (await db.readApplicationSnapshot()).snapshot.eventLists.event[0],
    ).toMatchObject({ quantity: 1 });
    expect((await server.items([edit("quantity", 7)], ["1"], {})).status).toBe(
      "committed",
    );
  });
});

it("limits mode work and acknowledgements to the target day after verified cache warmup", async () => {
  const data = seed();
  data.eventLists.past = Array.from({ length: 10000 }, (_, index) => ({
    ...item,
    id: `past-${index}`,
  }));
  data.eventConsistency.past = createEventConsistency();
  data.dayModes.event["2日目"] = "focus";
  const initial = await db.readApplicationSnapshot();
  await db.commitApplicationSnapshotAtomically(data, {
    expectedRoots: initial.expectedRoots,
  });
  const server = createPersistenceWorkerServer(db);
  await server.read();
  await server.day(
    { kind: "mode", eventName: "event", day: "1日目", mode: "edit" },
    "warm",
    {},
  );
  const get = vi.spyOn(IDBObjectStore.prototype, "get");
  const cursor = vi.spyOn(IDBObjectStore.prototype, "openCursor");
  const result = await server.day(
    { kind: "mode", eventName: "event", day: "1日目", mode: "focus" },
    "measured",
    {},
  );
  expect(result.status).toBe("committed");
  expect(get.mock.calls.every(([key]) => key !== "data")).toBe(true);
  expect(cursor).not.toHaveBeenCalled();
  if (result.status !== "committed") throw new Error("not committed");
  expect(JSON.stringify(result.read.delta).length).toBeLessThan(500);
  const saved = await db.readApplicationSnapshot();
  expect(saved.snapshot.dayModes.event).toEqual({
    "1日目": "focus",
    "2日目": "focus",
  });
  expect(saved.snapshot.eventLists.past).toEqual(data.eventLists.past);
});
it("invalidates the verified cache after another tab changes a revision and preserves its edits", async () => {
  const { server } = await setup();
  const fast = createPersistenceWorkerServer(db);
  await fast.read();
  await fast.day(
    { kind: "mode", eventName: "event", day: "1日目", mode: "edit" },
    "warm",
    {},
  );
  const remote = await db.readApplicationSnapshot();
  (remote.snapshot.eventLists.event[0] as typeof item).remarks =
    "他タブのユーザー登録";
  await db.commitApplicationSnapshotAtomically(remote.snapshot, {
    expectedRoots: remote.expectedRoots,
    changedStoresOnly: true,
  });
  expect(
    (
      await fast.day(
        { kind: "mode", eventName: "event", day: "1日目", mode: "focus" },
        "next",
        {},
      )
    ).status,
  ).toBe("committed");
  expect(
    (await db.readApplicationSnapshot()).snapshot.eventLists.event[0],
  ).toMatchObject({ remarks: "他タブのユーザー登録" });
  void server;
});
it("does not bypass duplicate-day confirmation", async () => {
  const data = seed();
  data.dayModes.event[" 1日目　"] = "focus";
  const initial = await db.readApplicationSnapshot();
  await db.commitApplicationSnapshotAtomically(data, {
    expectedRoots: initial.expectedRoots,
  });
  const server = createPersistenceWorkerServer(db);
  expect(
    await server.day(
      { kind: "mode", eventName: "event", day: "1日目" },
      "review",
      {},
    ),
  ).toEqual({ status: "review-required" });
  expect((await db.readApplicationSnapshot()).snapshot.dayModes).toEqual(
    data.dayModes,
  );
});

it("adds and removes visits atomically without changing another event or day", async () => {
  const data = seed();
  data.eventLists.event.push({ ...item, id: "other-day", eventDate: "2日目" });
  data.executeModeItems.event = { "1日目": [], "2日目": ["other-day"] };
  data.dayModes.event["2日目"] = "focus";
  const initial = await db.readApplicationSnapshot();
  await db.commitApplicationSnapshotAtomically(data, {
    expectedRoots: initial.expectedRoots,
  });
  const server = createPersistenceWorkerServer(db);
  await server.read();
  for (const ids of [["1"], []]) {
    const before = (await db.readApplicationSnapshot()).snapshot
      .executeModeItems.event["1日目"];
    expect(
      (
        await server.day(
          {
            kind: "patch",
            eventName: "event",
            day: "1日目",
            baseline: { executeModeItems: { event: { "1日目": before } } },
            desired: { executeModeItems: { event: { "1日目": ids } } },
          },
          `visit-${ids.length}`,
          {},
        )
      ).status,
    ).toBe("committed");
    const saved = await db.readApplicationSnapshot();
    expect(saved.snapshot.executeModeItems.event).toEqual({
      "1日目": ids,
      "2日目": ["other-day"],
    });
    expect(saved.snapshot.dayModes.event["2日目"]).toBe("focus");
    expect(saved.snapshot.eventLists).toEqual(data.eventLists);
  }
});
it("rolls back a day command and keeps it retryable after a transaction write fails", async () => {
  await setup();
  const server = createPersistenceWorkerServer(db);
  await server.read();
  const original = IDBObjectStore.prototype.put;
  const fault = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof original>
    ) {
      if (this.name === "dayModes")
        throw new DOMException("quota", "QuotaExceededError");
      return original.apply(this, args);
    });
  const command = {
    kind: "mode" as const,
    eventName: "event",
    day: "1日目",
    mode: "focus" as const,
  };
  await expect(server.day(command, "retry", {})).rejects.toThrow();
  fault.mockRestore();
  expect(
    (await db.readApplicationSnapshot()).snapshot.dayModes.event["1日目"],
  ).toBe("execute");
  expect((await server.day(command, "retry", {})).status).toBe("committed");
});
it("exports unsaved Japanese text in the backup worker and supports storage read failure", async () => {
  const { buildWorkerBackup } = await import("./backupWorkerServer");
  const { parseAppBackup } = await import("../../utils/appBackup");
  await setup();
  const baseline = seed().eventLists.event;
  const desired = baseline.map((value) => ({
    ...(value as typeof item),
    remarks: "未保存のユーザー登録・エラーが発生しました",
  }));
  const result = await buildWorkerBackup(db.readApplicationSnapshot, {
    changes: [{ store: "eventLists", eventName: "event", baseline, desired }],
  });
  if (!("file" in result)) throw new Error("missing backup");
  const parsed = parseAppBackup(await result.file.blob.text());
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("invalid backup");
  expect(parsed.data.eventLists.event[0]).toMatchObject({
    remarks: "未保存のユーザー登録・エラーが発生しました",
  });
  expect(
    (await db.readApplicationSnapshot()).snapshot.eventLists.event[0],
  ).toMatchObject({ remarks: "" });
  const fail = async (): Promise<never> => {
    throw new Error("unavailable");
  };
  expect(await buildWorkerBackup(fail, { changes: [] })).toEqual({
    needsSnapshot: true,
  });
  expect(
    await buildWorkerBackup(fail, { changes: [], snapshot: seed() }),
  ).toHaveProperty("file.blob");
});

it("requires review for competing visit edits and for a replaced event generation", async () => {
  await setup();
  const base = await db.readApplicationSnapshot();
  base.snapshot.eventLists.event.push({ ...item, id: "2", number: "2" });
  base.snapshot.executeModeItems.event = { "1日目": ["1"] };
  await db.commitApplicationSnapshotAtomically(base.snapshot, {
    expectedRoots: base.expectedRoots,
  });
  const server = createPersistenceWorkerServer(db);
  await server.read();
  const remote = await db.readApplicationSnapshot();
  remote.snapshot.executeModeItems.event = { "1日目": [] };
  await db.commitApplicationSnapshotAtomically(remote.snapshot, {
    expectedRoots: remote.expectedRoots,
    changedStoresOnly: true,
  });
  const command = {
    kind: "patch" as const,
    eventName: "event",
    day: "1日目",
    baseline: { executeModeItems: { event: { "1日目": ["1"] } } },
    desired: { executeModeItems: { event: { "1日目": ["1", "2"] } } },
  };
  expect(await server.day(command, "conflict", {})).toEqual({
    status: "review-required",
  });
  expect(
    (await db.readApplicationSnapshot()).snapshot.executeModeItems.event[
      "1日目"
    ],
  ).toEqual([]);
  expect(
    await server.day(
      { kind: "mode", eventName: "event", day: "1日目", mode: "focus" },
      "generation",
      { event: 9 },
    ),
  ).toEqual({ status: "review-required" });
});

it("writes only the requested event/date records and bounded headers with 10000 historical visits", async () => {
  const { DAY_RECORD_PREFIX } = await import("../db/dayRecordStorage");
  const data = seed();
  data.eventLists.past = Array.from({ length: 10000 }, (_, index) => ({
    ...item,
    id: `past-${index}`,
  }));
  data.eventConsistency.past = createEventConsistency();
  data.executeModeItems.past = {
    "1日目": data.eventLists.past.map(
      (value: unknown) => (value as { id: string }).id,
    ),
  };
  data.dayModes.past = { "1日目": "execute" };
  data.dayModes.event["2日目"] = "focus";
  const initial = await db.readApplicationSnapshot();
  await db.commitApplicationSnapshotAtomically(data, {
    expectedRoots: initial.expectedRoots,
  });
  const server = createPersistenceWorkerServer(db);
  await server.read();
  await server.day(
    { kind: "mode", eventName: "event", day: "1日目", mode: "edit" },
    "mode-warm",
    {},
  );
  await server.day(
    {
      kind: "patch",
      eventName: "event",
      day: "1日目",
      baseline: { executeModeItems: { event: { "1日目": [] } } },
      desired: { executeModeItems: { event: { "1日目": ["1"] } } },
    },
    "visit-warm",
    {},
  );
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  const get = vi.spyOn(IDBObjectStore.prototype, "get");
  const cursor = vi.spyOn(IDBObjectStore.prototype, "openCursor");
  await server.day(
    { kind: "mode", eventName: "event", day: "1日目", mode: "focus" },
    "mode-next",
    {},
  );
  await server.day(
    {
      kind: "patch",
      eventName: "event",
      day: "1日目",
      baseline: { executeModeItems: { event: { "1日目": ["1"] } } },
      desired: { executeModeItems: { event: { "1日目": [] } } },
    },
    "visit-next",
    {},
  );
  expect(get.mock.calls.every(([key]) => key !== "data")).toBe(true);
  expect(cursor).not.toHaveBeenCalled();
  const records = put.mock.calls.filter(([, key]) =>
    String(key).startsWith(DAY_RECORD_PREFIX),
  );
  expect(records.length).toBeGreaterThan(0);
  expect(
    records.every(
      ([value]) =>
        value.eventName === "event" &&
        (value.path.length === 0 || value.path.at(-1) === "1日目"),
    ),
  ).toBe(true);
  const headers = put.mock.calls.filter(([, key]) => key === "data");
  expect(headers.length).toBeGreaterThan(0);
  expect(
    headers.every(
      ([value]) =>
        value.kind === "event-shopping-planner-day-records" &&
        JSON.stringify(value).length < 250,
    ),
  ).toBe(true);
  expect(
    put.mock.instances.every(
      (store) =>
        !["eventLists", "mapData"].includes((store as IDBObjectStore).name),
    ),
  ).toBe(true);
  const loaded = await db.readApplicationSnapshot();
  expect(loaded.snapshot.executeModeItems.past).toEqual(
    data.executeModeItems.past,
  );
  expect(loaded.snapshot.dayModes.event["2日目"]).toBe("focus");
  expect((await db.loadDayModes()).data).toEqual(loaded.snapshot.dayModes);
  expect((await db.loadExecuteModeItems()).data).toEqual(
    loaded.snapshot.executeModeItems,
  );
  expect(await db.getAllKeys("executeModeItems")).toEqual(["data"]);
  expect(await db.getAllData("executeModeItems")).toEqual({
    data: loaded.snapshot.executeModeItems,
  });
});

it.each(["altered", "missing"])(
  "detects %s date records on reload and preserves corruption evidence",
  async (damage) => {
    const { dayRecordKey } = await import("../db/dayRecordStorage");
    await setup();
    const server = createPersistenceWorkerServer(db);
    await server.read();
    await server.day(
      { kind: "mode", eventName: "event", day: "1日目", mode: "focus" },
      "warm",
      {},
    );
    const database = await openDatabase();
    const transaction = database.transaction("dayModes", "readwrite");
    if (damage === "altered")
      transaction
        .objectStore("dayModes")
        .put({ corrupt: "ユーザー登録" }, dayRecordKey("event", ["1日目"]));
    else
      transaction
        .objectStore("dayModes")
        .delete(dayRecordKey("event", ["1日目"]));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    await expect(db.readApplicationSnapshot()).rejects.toThrow();
    const loaded = await db.loadDayModes();
    expect(loaded.status).toBe("conflict");
    expect(loaded.recoveryBundle).toBeDefined();
    if (damage === "altered")
      expect(JSON.stringify(loaded.recoveryBundle)).toContain("ユーザー登録");
  },
);

it.each([false, true])(
  "rejects writes outside a date command before any persistence, partitioned=%s",
  async (partitioned) => {
    await setup();
    if (partitioned) {
      const server = createPersistenceWorkerServer(db);
      await server.day(
        { kind: "mode", eventName: "event", day: "1日目", mode: "focus" },
        "warm",
        {},
      );
    }
    const read = await db.readDayCommandSnapshot();
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    const changes = [
      {
        ...read.snapshot,
        dayModes: {
          ...read.snapshot.dayModes,
          other: { "1日目": "focus" as const },
        },
      },
      {
        ...read.snapshot,
        dayModes: {
          ...read.snapshot.dayModes,
          event: { ...read.snapshot.dayModes.event, "2日目": "focus" as const },
        },
      },
      { ...read.snapshot, eventMetadata: { event: { name: "outside" } } },
    ];
    for (const changed of changes)
      await expect(
        db.commitDayCommandSnapshot(changed, read.expectedRoots, {
          eventName: "event",
          day: "1日目",
        }),
      ).rejects.toThrow("Day commands cannot modify");
    expect(put).not.toHaveBeenCalled();
    expect((await db.loadDayModes()).data).toEqual(read.snapshot.dayModes);
  },
);

it("rejects physical date-record changes during a full save and through the compatibility API", async () => {
  const { dayRecordKey } = await import("../db/dayRecordStorage");
  await setup();
  const server = createPersistenceWorkerServer(db);
  await server.day(
    { kind: "mode", eventName: "event", day: "1日目", mode: "focus" },
    "warm",
    {},
  );
  const read = await db.readApplicationSnapshot();
  const database = await openDatabase();
  const transaction = database.transaction("dayModes", "readwrite");
  transaction
    .objectStore("dayModes")
    .put({ corrupt: "ユーザー登録" }, dayRecordKey("event", ["1日目"]));
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
  await expect(
    db.commitApplicationSnapshotAtomically(read.snapshot, {
      expectedRoots: read.expectedRoots,
    }),
  ).rejects.toThrow("日付レコードが計算後に変更");
  await expect(
    db.saveDayModes({ event: { "1日目": "edit" } }),
  ).rejects.toThrow();
  expect((await db.loadDayModes()).status).toBe("conflict");
});

it("retains shard state after a failed visit write and a retry, then survives a full-store API save", async () => {
  await setup();
  const server = createPersistenceWorkerServer(db);
  await server.read();
  await server.day(
    { kind: "mode", eventName: "event", day: "1日目", mode: "edit" },
    "mode-warm",
    {},
  );
  await server.day(
    {
      kind: "patch",
      eventName: "event",
      day: "1日目",
      baseline: { executeModeItems: { event: { "1日目": [] } } },
      desired: { executeModeItems: { event: { "1日目": ["1"] } } },
    },
    "warm",
    {},
  );
  const original = IDBObjectStore.prototype.put;
  const fault = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof original>
    ) {
      if (this.name === "executeModeItems")
        throw new DOMException("quota", "QuotaExceededError");
      return original.apply(this, args);
    });
  const command = {
    kind: "patch" as const,
    eventName: "event",
    day: "1日目",
    baseline: { executeModeItems: { event: { "1日目": ["1"] } } },
    desired: { executeModeItems: { event: { "1日目": [] } } },
  };
  await expect(server.day(command, "retry", {})).rejects.toThrow();
  fault.mockRestore();
  expect(
    (await db.readApplicationSnapshot()).snapshot.executeModeItems.event[
      "1日目"
    ],
  ).toEqual(["1"]);
  expect((await server.day(command, "retry", {})).status).toBe("committed");
  expect((await db.loadExecuteModeItems()).data).toEqual({
    event: { "1日目": [] },
  });
  await db.saveExecuteModeItems({ event: { "1日目": ["1"] } });
  expect(
    (await db.readApplicationSnapshot()).snapshot.executeModeItems.event[
      "1日目"
    ],
  ).toEqual(["1"]);
  expect((await server.day(command, "after-full-save", {})).status).toBe(
    "committed",
  );
  expect(
    (await db.readApplicationSnapshot()).snapshot.executeModeItems.event[
      "1日目"
    ],
  ).toEqual([]);
});

it("preserves and explicitly adopts valid date-record data when its root metadata is damaged", async () => {
  const { createPersistenceMetadataKey } =
    await import("../../utils/persistenceResilience");
  await setup();
  const server = createPersistenceWorkerServer(db);
  await server.read();
  await server.day(
    { kind: "mode", eventName: "event", day: "1日目", mode: "focus" },
    "warm",
    {},
  );
  const database = await openDatabase();
  const transaction = database.transaction("syncQueue", "readwrite");
  transaction
    .objectStore("syncQueue")
    .put({ corrupt: true }, createPersistenceMetadataKey("dayModes", "data"));
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
  const loaded = await db.loadDayModes();
  expect(loaded.status).toBe("conflict");
  const candidate = loaded.recoveryBundle?.candidates.find(
    (value) => value.storeName === "dayModes" && value.adoptable,
  );
  expect(candidate).toBeDefined();
  expect(JSON.stringify(loaded.recoveryBundle)).toContain(
    "event-shopping-planner-day-record",
  );
  await db.adoptRecoveryCandidate(candidate!);
  expect((await db.loadDayModes()).data).toEqual({
    event: { "1日目": "focus" },
  });
});

it("creates the first visit through a date command and exports the partitioned state without losing Japanese text", async () => {
  const { collectDayMutation } =
    await import("../../features/consistency/domain/dayMutation");
  const { buildWorkerBackup } = await import("./backupWorkerServer");
  const { parseAppBackup } = await import("../../utils/appBackup");
  const data = seed();
  data.executeModeItems = {};
  const initial = await db.readApplicationSnapshot();
  await db.commitApplicationSnapshotAtomically(data, {
    expectedRoots: initial.expectedRoots,
  });
  const server = createPersistenceWorkerServer(db);
  await server.read();
  const command = collectDayMutation(
    data,
    { ...data, executeModeItems: { event: { "1日目": ["1"] } } },
    "event",
    "1日目",
  );
  expect(command).toBeDefined();
  expect((await server.day(command!, "first-visit", {})).status).toBe(
    "committed",
  );
  const result = await buildWorkerBackup(db.readApplicationSnapshot, {
    changes: [],
  });
  if (!("file" in result)) throw new Error("missing backup");
  const parsed = parseAppBackup(await result.file.blob.text());
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("invalid backup");
  expect(parsed.data.executeModeItems.event["1日目"]).toEqual(["1"]);
  expect(parsed.data.eventLists.event[0]).toMatchObject({
    circle: "ユーザー登録",
  });
});

it.each([0, 10000])(
  "reads only target records without a cache, history=%i",
  async (history) => {
    const data = seed();
    data.eventLists.past = Array.from({ length: history }, (_, index) => ({
      ...item,
      id: "past-" + index,
    }));
    data.eventConsistency.past = createEventConsistency();
    data.dayModes.event["2日目"] = "focus";
    const initial = await db.readApplicationSnapshot();
    await db.commitApplicationSnapshotAtomically(data, {
      expectedRoots: initial.expectedRoots,
    });
    resetDatabaseConnection();
    const server = createPersistenceWorkerServer(db);
    const get = vi.spyOn(IDBObjectStore.prototype, "get");
    const cursor = vi.spyOn(IDBObjectStore.prototype, "openCursor");
    const result = await server.day(
      { kind: "mode", eventName: "event", day: "1日目", mode: "edit" },
      "cold",
      {},
    );
    expect(result.status).toBe("committed");
    expect(cursor).not.toHaveBeenCalled();
    expect(get.mock.calls.some(([key]) => String(key).includes("past"))).toBe(
      false,
    );
    expect(get.mock.calls.filter(([key]) => key === "data")).toHaveLength(7);
    expect(
      get.mock.instances
        .filter((store, index) => get.mock.calls[index][0] === "data")
        .every(
          (store) =>
            !["eventLists", "mapData"].includes((store as IDBObjectStore).name),
        ),
    ).toBe(true);
    if (result.status !== "committed") throw new Error("not committed");
    expect(result.read.delta.scope?.target).toEqual({
      eventName: "event",
      day: "1日目",
    });
    expect(result.read.delta.scope?.snapshot.eventLists.past).toBeUndefined();
    cursor.mockRestore();
    get.mockRestore();
    const saved = await db.readApplicationSnapshot();
    expect(saved.snapshot.eventLists.past).toEqual(data.eventLists.past);
    expect(saved.snapshot.dayModes.event).toEqual({
      "1日目": "edit",
      "2日目": "focus",
    });
  },
);
it("invalidates a cache after a repository save without reloading historical payloads", async () => {
  await setup();
  const server = createPersistenceWorkerServer(db);
  await server.read();
  await db.saveEventLists({ event: [{ ...item, remarks: "他タブ更新" }] });
  const cursor = vi.spyOn(IDBObjectStore.prototype, "openCursor");
  const result = await server.day(
    { kind: "mode", eventName: "event", day: "1日目", mode: "focus" },
    "remote",
    {},
  );
  expect(result.status).toBe("committed");
  expect(cursor).not.toHaveBeenCalled();
  if (result.status !== "committed") throw new Error("not committed");
  expect(
    (
      result.read.delta.branches?.find(
        (branch) => branch.store === "eventLists",
      )?.value as unknown[] | undefined
    )?.[0],
  ).toMatchObject({
    remarks: "他タブ更新",
  });
});
it("keeps date merge review and its confirmed commit scoped, including concurrent changes", async () => {
  const data = seed();
  data.dayModes.event[" 1日目　"] = "focus";
  data.dayModes.event["2日目"] = "execute";
  const initial = await db.readApplicationSnapshot();
  await db.commitApplicationSnapshotAtomically(data, {
    expectedRoots: initial.expectedRoots,
  });
  const server = createPersistenceWorkerServer(db);
  await server.read();
  const { scopeDaySnapshot, adoptScopedDaySnapshot } =
    await import("../../features/consistency/domain/dayMutation");
  const { planDayModeToggle } =
    await import("../../features/consistency/domain/dayMode");
  const cursor = vi.spyOn(IDBObjectStore.prototype, "openCursor");
  const read = await server.readDay({ eventName: "event", day: "1日目" });
  const scoped = adoptScopedDaySnapshot(data, read.delta.scope!.snapshot, {
    eventName: "event",
    day: "1日目",
  });
  expect(scoped.mapData.event).toBeUndefined();
  const plan = planDayModeToggle(
    scopeDaySnapshot(scoped, "event", "1日目"),
    "event",
    "1日目",
    { mode: "edit" },
  );
  expect(plan.confirmation).toBeDefined();
  const committed = await server.commitDay(plan.snapshot, read.observationId, {
    eventName: "event",
    day: "1日目",
  });
  expect(
    committed.delta.branches?.find(
      (branch) => branch.store === "dayModes" && branch.path.at(-1) === "1日目",
    )?.value,
  ).toBe("edit");
  expect(cursor).not.toHaveBeenCalled();
  cursor.mockRestore();
  const saved = await db.readApplicationSnapshot();
  expect(saved.snapshot.dayModes.event).toEqual({
    "1日目": "edit",
    "2日目": "execute",
  });
});
it("rejects modified target records after a cache reset instead of adopting their payload", async () => {
  await setup();
  const { dayRecordKey } = await import("../db/dayRecordStorage");
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction("dayModes", "readwrite");
    const store = tx.objectStore("dayModes");
    const request = store.get(dayRecordKey("event", ["1日目"]));
    request.onsuccess = () =>
      store.put(
        { ...request.result, value: "focus" },
        dayRecordKey("event", ["1日目"]),
      );
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  resetDatabaseConnection();
  await expect(
    createPersistenceWorkerServer(db).day(
      { kind: "mode", eventName: "event", day: "1日目", mode: "edit" },
      "tamper",
      {},
    ),
  ).rejects.toMatchObject({ name: "PersistenceConflict" });
});

it("keeps acknowledgements small after an independently verified cache miss", async () => {
  await setup();
  resetDatabaseConnection();
  const server = createPersistenceWorkerServer(db);
  await server.day(
    { kind: "mode", eventName: "event", day: "1日目", mode: "edit" },
    "first",
    {},
  );
  const result = await server.day(
    { kind: "mode", eventName: "event", day: "1日目", mode: "focus" },
    "second",
    {},
  );
  expect(result.status).toBe("committed");
  if (result.status !== "committed") throw new Error("not committed");
  expect(result.read.delta.scope).toBeUndefined();
  expect(result.read.delta.full).toBeUndefined();
  expect(JSON.stringify(result.read.delta).length).toBeLessThan(1000);
  expect(
    result.read.delta.branches?.every((branch) => branch.eventName === "event"),
  ).toBe(true);
});

it("prepares valid legacy map records before accepting scoped commands after restart", async () => {
  const { scopeReadyKey } = await import("../db/scopedDayStorage");
  const data = seed();
  data.mapData.event = {
    "1日目マップ": {
      sheetName: "ユーザー登録",
      maxRow: 1,
      maxCol: 1,
      cells: [],
      mergedCells: [],
      blocks: [],
    },
  };
  const initial = await db.readApplicationSnapshot();
  await db.commitApplicationSnapshotAtomically(data, {
    expectedRoots: initial.expectedRoots,
  });
  const saved = (await db.readApplicationSnapshot()).snapshot;
  const database = await openDatabase();
  const transaction = database.transaction(
    ["mapData", "syncQueue"],
    "readwrite",
  );
  const mapStore = transaction.objectStore("mapData");
  mapStore.clear();
  mapStore.put(saved.mapData, "data");
  transaction.objectStore("syncQueue").delete(scopeReadyKey("mapData"));
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
  resetDatabaseConnection();
  const server = createPersistenceWorkerServer(db);
  await server.read();
  resetDatabaseConnection();
  const cursor = vi.spyOn(IDBObjectStore.prototype, "openCursor");
  const scoped = await server.readDay({ eventName: "event", day: "1日目" });
  expect(cursor).not.toHaveBeenCalled();
  expect(scoped.delta.scope?.snapshot.mapData.event).toEqual(
    saved.mapData.event,
  );
});

it.each([0, 10000])(
  "guards limited input on the existing whole-snapshot item path, history=%i",
  async (history) => {
    const { createItemContentGuard } =
      await import("../../utils/itemContentGuard");
    const { dayRecordKey } = await import("../db/dayRecordStorage");
    const data = seed();
    const target = { ...item, quantity: 5 };
    data.eventLists.event = [
      target,
      { ...item, id: "day2", eventDate: "2日目", remarks: "別日の記録" },
    ];
    data.executeModeItems.event["1日目"] = ["1"];
    data.eventLists.past = Array.from({ length: history }, (_, index) => ({
      ...item,
      id: "past-" + index,
    }));
    data.eventConsistency.past = createEventConsistency();
    const initial = await db.readApplicationSnapshot();
    await db.commitApplicationSnapshotAtomically(data, {
      expectedRoots: initial.expectedRoots,
    });
    const server = createPersistenceWorkerServer(db);
    await server.read();
    const guard = createItemContentGuard(
      data,
      "event",
      target as import("../../types/item").ShoppingItem,
      "limited-focus",
      0,
    );
    const get = vi.spyOn(IDBObjectStore.prototype, "get");
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    const read = vi.spyOn(db, "readApplicationSnapshot");
    const result = await server.items(
      [
        {
          eventName: "event",
          itemId: "1",
          baseline: target,
          operationKind: "limited-input",
          guard,
          fields: {
            purchaseStatus: { present: true, value: "LimitedPurchase" },
            limitedPurchasedQuantity: { present: true, value: 1 },
          },
        },
      ],
      ["guarded"],
      {},
    );
    expect(result.status).toBe("committed");
    expect(read).toHaveBeenCalledTimes(1);
    // DB 11 deliberately reads the shared payload and writes that same payload.
    expect(get.mock.calls.some(([key]) => key === "data")).toBe(true);
    const writes = put.mock.calls.map((args, index) => [
      (put.mock.contexts[index] as IDBObjectStore).name,
      args[1],
    ]);
    expect(writes).toContainEqual(["eventLists", "data"]);
    expect(writes).toContainEqual(["eventLists", dayRecordKey("event", [])]);
    expect(writes).not.toContainEqual(["eventLists", dayRecordKey("past", [])]);
    expect(
      writes.every(
        ([store]) => store === "eventLists" || store === "syncQueue",
      ),
    ).toBe(true);
    const durable = (await db.readApplicationSnapshot()).snapshot;
    expect(durable.eventLists.event[0]).toMatchObject({
      purchaseStatus: "LimitedPurchase",
      limitedPurchasedQuantity: 1,
      quantity: 5,
    });
    expect(durable.eventLists.event[1]).toEqual(data.eventLists.event[1]);
    expect(durable.eventLists.past).toEqual(data.eventLists.past);
    expect(durable.eventConsistency).toEqual(data.eventConsistency);
    expect(durable.executeModeItems).toEqual(data.executeModeItems);
  },
);

it("writes none of a mixed item batch before review when one guarded target leaves execution", async () => {
  const { createItemContentGuard } =
    await import("../../utils/itemContentGuard");
  const { server } = await setup();
  const guarded: ItemContentEdit = {
    ...edit("limitedPurchasedQuantity", 1),
    operationKind: "limited-input",
    guard: createItemContentGuard(
      seed(),
      "event",
      item as import("../../types/item").ShoppingItem,
      "limited-focus",
      0,
    ),
  };
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  expect(
    (
      await server.items(
        [guarded, edit("remarks", "正常なメモ")],
        ["mixed"],
        {},
      )
    ).status,
  ).toBe("review-required");
  expect(put).not.toHaveBeenCalled();
});

it.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])(
  "rejects unguarded limited intent before any worker write, operationKind=%s, fields=%s",
  async (withOperationKind, withFields) => {
    const { server, commit } = await setup();
    const remote = await db.readApplicationSnapshot();
    Object.assign(remote.snapshot.eventLists.event[0]!, {
      eventDate: "2日目",
      quantity: 5,
      remarks: "他タブのメモ",
    });
    await db.commitApplicationSnapshotAtomically(remote.snapshot, {
      expectedRoots: remote.expectedRoots,
      changedStoresOnly: true,
    });
    const before = (await db.readApplicationSnapshot()).snapshot;
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    const request: ItemContentEdit = {
      ...edit("purchaseStatus", "LimitedPurchase"),
      operationKind: withOperationKind ? "limited-input" : undefined,
      limitedPurchase: {
        kind: "limited",
        actual: 1,
        planned: 5,
        plannedEdited: false,
      },
      fields: withFields
        ? {
            purchaseStatus: { present: true, value: "LimitedPurchase" },
            limitedPurchasedQuantity: { present: true, value: 1 },
          }
        : {},
    };
    expect(
      await server.items(
        structuredClone([
          request,
          edit("remarks", "正常なメモ", { ...item, remarks: "他タブのメモ" }),
        ]),
        ["missing-guard"],
        {},
      ),
    ).toEqual({ status: "review-required" });
    expect(commit).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect((await db.readApplicationSnapshot()).snapshot).toEqual(before);
  },
);

it("requires a current accepted snapshot for a backup with unmarked limited intent", async () => {
  const { buildWorkerBackup } = await import("./backupWorkerServer");
  await setup();
  const read = vi.fn(db.readApplicationSnapshot);
  expect(
    await buildWorkerBackup(read, {
      changes: [
        {
          store: "eventLists",
          eventName: "event",
          baseline: [item],
          desired: [
            {
              ...item,
              quantity: 5,
              purchaseStatus: "LimitedPurchase",
              limitedPurchasedQuantity: 1,
            },
          ],
        },
      ],
      guardedItemEdits: [
        {
          ...edit("purchaseStatus", "LimitedPurchase"),
          limitedPurchase: {
            kind: "limited",
            actual: 1,
            planned: 5,
            plannedEdited: false,
          },
        },
      ],
    }),
  ).toEqual({ needsSnapshot: true });
  expect(read).not.toHaveBeenCalled();
});

it("requests a freshly guarded accepted snapshot for worker backup instead of replaying a whole-item delta", async () => {
  const { buildWorkerBackup } = await import("./backupWorkerServer");
  const { createItemContentGuard } =
    await import("../../utils/itemContentGuard");
  const read = vi.fn(db.readApplicationSnapshot);
  const result = await buildWorkerBackup(read, {
    changes: [
      {
        store: "eventLists",
        eventName: "event",
        baseline: [item],
        desired: [{ ...item, limitedPurchasedQuantity: 1 }],
      },
    ],
    guardedItemEdits: [
      {
        ...edit("limitedPurchasedQuantity", 1),
        operationKind: "limited-input",
        guard: createItemContentGuard(
          seed(),
          "event",
          item as import("../../types/item").ShoppingItem,
          "limited-focus",
          0,
        ),
      },
    ],
  });
  expect(result).toEqual({ needsSnapshot: true });
  expect(read).not.toHaveBeenCalled();
});

it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
  "saves guarded input for the literal event name %s without inherited generation values",
  async (name) => {
    const { createItemContentGuard } =
      await import("../../utils/itemContentGuard");
    const data = seed();
    const target = {
      ...item,
      quantity: 5,
    } as import("../../types/item").ShoppingItem;
    data.eventLists = { [name]: [target] };
    data.dayModes = { [name]: { "1日目": "execute" } };
    data.eventConsistency = { [name]: createEventConsistency() };
    data.executeModeItems = { [name]: { "1日目": [target.id] } };
    const initial = await db.readApplicationSnapshot();
    await db.commitApplicationSnapshotAtomically(data, {
      expectedRoots: initial.expectedRoots,
    });
    const server = createPersistenceWorkerServer(db);
    await server.read();
    const guard = createItemContentGuard(
      data,
      name,
      target,
      "limited-focus",
      0,
    );
    const result = await server.items(
      [
        {
          eventName: name,
          itemId: target.id,
          baseline: { ...target },
          operationKind: "limited-input",
          guard,
          fields: {
            purchaseStatus: { present: true, value: "LimitedPurchase" },
            limitedPurchasedQuantity: { present: true, value: 1 },
          },
        },
      ],
      ["reserved"],
      {},
    );
    expect(result.status).toBe("committed");
    const current = (await db.readApplicationSnapshot()).snapshot;
    expect(current.eventLists[name][0]).toMatchObject({
      quantity: 5,
      limitedPurchasedQuantity: 1,
    });
    expect(Object.getPrototypeOf(current.eventLists)).toBe(Object.prototype);
  },
);

it.each([false, true])(
  "rechecks purchase quantities on the worker path, CAS retry=%s",
  async (retry) => {
    const { createItemContentGuard } =
      await import("../../utils/itemContentGuard");
    const { server } = await setup();
    const before = await db.readApplicationSnapshot();
    Object.assign(before.snapshot.eventLists.event[0]!, { quantity: 5 });
    await db.commitApplicationSnapshotAtomically(before.snapshot, {
      expectedRoots: before.expectedRoots,
      changedStoresOnly: true,
    });
    const target = { ...item, quantity: 5 };
    const intent: ItemContentEdit = {
      ...edit("purchaseStatus", "Purchased", target),
      operationKind: "limited-input",
      guard: createItemContentGuard(
        before.snapshot,
        "event",
        target as import("../../types/item").ShoppingItem,
        "limited-single",
        0,
      ),
      limitedPurchase: {
        kind: "purchased",
        actual: 5,
        planned: 5,
        plannedEdited: false,
        observedPlanned: 5,
      },
    };
    const changeQuantity = async () => {
      const remote = await db.readApplicationSnapshot();
      Object.assign(remote.snapshot.eventLists.event[0]!, {
        quantity: 9,
        remarks: "他タブのメモ",
      });
      await db.commitApplicationSnapshotAtomically(remote.snapshot, {
        expectedRoots: remote.expectedRoots,
        changedStoresOnly: true,
      });
    };
    let injected = false;
    const commit = vi.fn(
      async (
        ...args: Parameters<typeof db.commitApplicationSnapshotAtomically>
      ) => {
        if (retry && !injected) {
          injected = true;
          await changeQuantity();
        }
        return db.commitApplicationSnapshotAtomically(...args);
      },
    );
    if (!retry) await changeQuantity();
    const worker = retry
      ? createPersistenceWorkerServer({
          readApplicationSnapshot: db.readApplicationSnapshot,
          commitApplicationSnapshotAtomically: commit,
        })
      : server;
    const request = structuredClone(intent);
    expect(await worker.items([request], ["quantity-review"], {})).toEqual({
      status: "review-required",
    });
    expect(commit).toHaveBeenCalledTimes(retry ? 1 : 0);
    expect(
      (await db.readApplicationSnapshot()).snapshot.eventLists.event[0],
    ).toMatchObject({
      quantity: 9,
      purchaseStatus: "None",
      remarks: "他タブのメモ",
    });
    expect(request.limitedPurchase).toMatchObject({ actual: 5 });
  },
);

it.each(["commit", "items", "day", "commitDay"])(
  "reports post-commit %s failure as terminal while preserving the DB commit",
  async (boundary) => {
    const initial = await db.readApplicationSnapshot();
    await db.commitApplicationSnapshotAtomically(seed(), {
      expectedRoots: initial.expectedRoots,
    });
    let committed = false;
    const commits = vi.fn(
      async (
        snapshot: PersistenceSnapshot,
        options?: Parameters<typeof db.commitApplicationSnapshotAtomically>[1],
      ) => {
        await db.commitApplicationSnapshotAtomically(snapshot, options);
        committed = true;
        if (boundary === "day" || boundary === "commitDay") {
          Object.defineProperty(snapshot.dayModes, "event", {
            enumerable: true,
            configurable: true,
            get: () => {
              throw new Error("publish failed after commit");
            },
          });
        }
      },
    );
    const server = createPersistenceWorkerServer({
      readApplicationSnapshot: db.readApplicationSnapshot,
      readDayCommandSnapshot: async () => {
        if (committed && (boundary === "commit" || boundary === "items"))
          throw new Error("post-commit read failed");
        return db.readApplicationSnapshot();
      },
      commitApplicationSnapshotAtomically: commits,
      commitDayCommandSnapshot: (snapshot, expectedRoots) =>
        commits(snapshot, { expectedRoots, changedStoresOnly: true }),
    });
    const observed = await server.read();
    const next = seed();
    next.dayModes.event["1日目"] = "edit";
    const result =
      boundary === "commit"
        ? server.commit(next, { observationId: observed.observationId })
        : boundary === "items"
          ? server.items([edit("quantity", 9)], ["item"], {})
          : boundary === "day"
            ? server.day(
                {
                  kind: "mode",
                  eventName: "event",
                  day: "1日目",
                  mode: "edit",
                },
                "day",
                {},
              )
            : server.commitDay(next, observed.observationId, {
                eventName: "event",
                day: "1日目",
              });
    await expect(result).rejects.toMatchObject({
      name: "PersistenceOutcomeUnknownError",
    });
    expect(commits).toHaveBeenCalledOnce();
    const durable = (await db.readApplicationSnapshot()).snapshot;
    if (boundary === "items")
      expect(durable.eventLists.event[0]).toMatchObject({ quantity: 9 });
    else expect(durable.dayModes.event["1日目"]).toBe("edit");
  },
);

function shoppingCommand() {
  return {
    version: 1 as const,
    eventName: "event",
    day: "1日目",
    sourceColumn: "execute" as const,
    targetColumn: "candidate" as const,
    requestedIds: ["1"],
    effectiveIds: ["1"],
    hoverId: "__END_OF_LIST__",
    baselineVisits: shoppingMoveVisitBaseline(
      {
        ...seed(),
        eventLists: { event: [item, { ...item, id: "2", number: "2" }] },
      },
      "event",
      "1日目",
    ),
    baselineItemIds: ["1", "2", "other-day"],
    itemIds: ["2", "1", "other-day"],
    baselineExecuteIds: ["1"],
    executeIds: [],
  };
}
async function setupShopping() {
  const data = seed();
  data.eventLists.event = [
    item,
    {
      ...item,
      id: "2",
      number: "2",
      quantity: 7,
      remarks: "後発メモ",
      customField: { keep: true },
    },
    { ...item, id: "other-day", eventDate: "2日目" },
  ];
  data.eventLists.past = [{ ...item, id: "past", quantity: 9 }];
  data.eventConsistency.past = createEventConsistency();
  data.executeModeItems.event["1日目"] = ["1"];
  data.executeModeItems.event["2日目"] = ["other-day"];
  data.dayModes.event["1日目"] = "edit";
  const initial = await db.readApplicationSnapshot();
  await db.commitApplicationSnapshotAtomically(data, {
    expectedRoots: initial.expectedRoots,
  });
  const commit = vi.fn(db.commitShoppingCommandSnapshot);
  const read = vi.fn(db.readApplicationSnapshot);
  const server = createPersistenceWorkerServer({
    ...db,
    readApplicationSnapshot: read,
    commitShoppingCommandSnapshot: commit,
  });
  const baseline = await server.read();
  read.mockClear();
  return { server, baseline, commit, read };
}
it("atomically commits shopping order and references without full reads or item payload deltas", async () => {
  const h = await setupShopping();
  const result = await h.server.shopping(shoppingCommand(), "move:1", {});
  expect(result.status).toBe("committed");
  expect(h.commit).toHaveBeenCalledOnce();
  expect(h.read).not.toHaveBeenCalled();
  if (result.status !== "committed" || !result.read)
    throw new Error("not committed");
  expect(result.read.delta.shoppingOrder).toMatchObject({
    version: 1,
    itemIds: ["2", "1", "other-day"],
    baseObservationId: h.baseline.observationId,
  });
  expect(result.read.delta.full).toBeUndefined();
  expect(result.read.delta.stores).toEqual({});
  expect(
    result.read.delta.branches?.some((branch) => branch.store === "eventLists"),
  ).toBe(false);
  const durable = (await db.readApplicationSnapshot()).snapshot;
  expect(
    durable.eventLists.event.map((item) => (item as { id: string }).id),
  ).toEqual(["2", "1", "other-day"]);
  expect(durable.eventLists.event[0]).toMatchObject({
    quantity: 7,
    remarks: "後発メモ",
    customField: { keep: true },
  });
  expect(durable.executeModeItems.event).toEqual({
    "1日目": [],
    "2日目": ["other-day"],
  });
  expect(durable.eventLists.past[0]).toMatchObject({ quantity: 9 });
  // A cold scoped read authenticates the persisted event sidecar, root and checkpoints.
  resetDatabaseConnection();
  const cold = await db.readDayCommandSnapshot({
    eventName: "event",
    day: "1日目",
  });
  expect(
    cold.snapshot.eventLists.event.map((item) => (item as { id: string }).id),
  ).toEqual(["2", "1", "other-day"]);
  expect(cold.snapshot.eventLists.event[0]).toMatchObject({
    quantity: 7,
    customField: { keep: true },
  });
  expect(cold.snapshot.executeModeItems.event["1日目"]).toEqual([]);
});
it("rolls all shopping stores back on abort and falls back before writing stale order", async () => {
  const h = await setupShopping();
  const original = IDBObjectStore.prototype.put;
  const fault = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof original>
    ) {
      if (this.name === "executeModeItems")
        throw new DOMException("quota", "QuotaExceededError");
      return original.apply(this, args);
    });
  await expect(
    h.server.shopping(shoppingCommand(), "move:1", {}),
  ).rejects.toThrow();
  fault.mockRestore();
  const durable = (await db.readApplicationSnapshot()).snapshot;
  expect(
    durable.eventLists.event.map((item) => (item as { id: string }).id),
  ).toEqual(["1", "2", "other-day"]);
  expect(durable.executeModeItems.event["1日目"]).toEqual(["1"]);
  expect(
    await h.server.shopping(
      { ...shoppingCommand(), baselineItemIds: ["2", "1", "other-day"] },
      "move:2",
      {},
    ),
  ).toEqual({ status: "review-required" });
  expect(h.commit).toHaveBeenCalledOnce();
});
it("full recovery is baseline-independent, validates all stores and never prepares writes", async () => {
  const h = await setupShopping();
  await h.server.shopping(shoppingCommand(), "move:1", {});
  const writes = vi.spyOn(IDBObjectStore.prototype, "put");
  const full = await h.server.readFull();
  expect(
    full.delta.full?.eventLists.event.map(
      (item) => (item as { id: string }).id,
    ),
  ).toEqual(["2", "1", "other-day"]);
  expect(full.delta.full?.eventLists.past).toHaveLength(1);
  expect(h.read).toHaveBeenCalledWith({
    shareVerified: true,
    prepareScopedCommands: false,
  });
  expect(writes).not.toHaveBeenCalled();
  const next = await h.server.read();
  expect(next.delta.full).toBeUndefined();
  expect(next.delta.stores).toEqual({});
});

it.each(["none", "duplicate", "missing", "revision", "other-day"])(
  "recovers one known shopping commit from %s order delta with a full read and resumes normal deltas",
  async (corruption) => {
    const h = await setupShopping();
    const methods: string[] = [];
    const recoveryWrites: string[] = [];
    class StorageWorker {
      onmessage?: (event: MessageEvent) => void;
      onerror?: () => void;
      postMessage(request: { id: number; method: string; args: unknown[] }) {
        methods.push(request.method);
        void (async () => {
          let result: unknown;
          try {
            if (request.method === "read") result = h.baseline;
            else if (request.method === "shopping") {
              const committed = await h.server.shopping(
                request.args[0] as ReturnType<typeof shoppingCommand>,
                request.args[1] as string,
                {},
              );
              if (committed.status !== "committed" || !committed.read)
                throw new Error("missing shopping commit");
              const read = structuredClone(committed.read);
              if (corruption === "revision")
                read.delta.shoppingOrder!.baseObservationId = -1;
              else if (corruption === "duplicate" || corruption === "missing")
                read.delta.shoppingOrder!.itemIds =
                  corruption === "duplicate" ? ["1", "1", "other-day"] : ["1"];
              // Include an invalid branch: no prefix may become the adapter baseline.
              if (corruption !== "none")
                read.delta.branches = [
                  {
                    store: "dayModes",
                    eventName: "event",
                    path: [corruption === "other-day" ? "2日目" : "1日目"],
                    present: true,
                    value: "broken",
                  },
                ];
              result = { status: "committed", read };
            } else if (request.method === "readFull") {
              const puts = vi.spyOn(IDBObjectStore.prototype, "put");
              result = await h.server.readFull();
              recoveryWrites.push(...puts.mock.calls.map(() => "put"));
              puts.mockRestore();
            } else if (request.method === "day")
              result = await h.server.day(
                request.args[0] as Parameters<typeof h.server.day>[0],
                request.args[1] as string,
                {},
              );
            else throw new Error("Unexpected protocol method");
            this.onmessage?.({
              data: { id: request.id, result },
            } as MessageEvent);
          } catch (error) {
            const value = error as Error;
            this.onmessage?.({
              data: {
                id: request.id,
                error: { name: value.name, message: value.message },
              },
            } as MessageEvent);
          }
        })();
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", StorageWorker);
    const port = createWorkerPersistenceCommandAdapter();
    await port.readApplicationSnapshot();
    const result = await port.commitShoppingMove!(
      shoppingCommand(),
      "move:1",
      {},
    );
    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw new Error("not committed");
    expect(
      result.read.snapshot.eventLists.event.map(
        (item) => (item as { id: string }).id,
      ),
    ).toEqual(["2", "1", "other-day"]);
    expect(result.read.snapshot.eventLists.event[0]).toMatchObject({
      quantity: 7,
      remarks: "後発メモ",
      customField: { keep: true },
    });
    expect(result.read.snapshot.dayModes.event["1日目"]).toBe("edit");
    expect(result.read.snapshot.eventLists.past).toHaveLength(1);
    expect(h.commit).toHaveBeenCalledOnce();
    expect(methods).toEqual(
      corruption === "none"
        ? ["read", "shopping"]
        : ["read", "shopping", "readFull"],
    );
    expect(recoveryWrites).toEqual([]);
    const next = await port.commitDayMutation!(
      { kind: "mode", eventName: "event", day: "1日目", mode: "execute" },
      "mode:2",
      {},
    );
    expect(next.status).toBe("committed");
    if (next.status !== "committed") throw new Error("not committed");
    expect(next.read.snapshot.dayModes.event["1日目"]).toBe("execute");
    expect(next.read.snapshot.eventLists.event[0]).toMatchObject({
      id: "2",
      quantity: 7,
    });
    expect(port.getWriteStopReason!()).toBeUndefined();
  },
);

it("returns a known commit when delta construction fails after advancing the worker baseline", async () => {
  const h = await setupShopping();
  const fault = vi
    .spyOn(snapshotDeltas, "daySnapshotDelta")
    .mockImplementationOnce(() => {
      throw new Error("delta construction failed");
    });
  expect(await h.server.shopping(shoppingCommand(), "move:1", {})).toEqual({
    status: "committed",
    deltaError: true,
  });
  fault.mockRestore();
  expect(h.commit).toHaveBeenCalledOnce();
  const full = await h.server.readFull();
  expect(
    full.delta.full?.eventLists.event.map(
      (item) => (item as { id: string }).id,
    ),
  ).toEqual(["2", "1", "other-day"]);
  expect((await h.server.read()).delta.stores).toEqual({});
});
it("preserves later quantities but refuses stale source identity and reviews changed target visits", async () => {
  const h = await setupShopping();
  const snapshot = h.baseline.delta.full!;
  const command = {
    ...shoppingCommand(),
    baselineVisits: shoppingMoveVisitBaseline(snapshot, "event", "1日目"),
  };
  const quantity = structuredClone(snapshot);
  Object.assign(quantity.eventLists.event[0] as object, {
    quantity: 9,
    remarks: "latest",
  });
  expect(
    planShoppingMove(quantity, command).snapshot.eventLists.event[1],
  ).toMatchObject({ id: "1", quantity: 9, remarks: "latest" });
  const changedSource = structuredClone(snapshot);
  Object.assign(changedSource.eventLists.event[0] as object, {
    eventDate: "2日目",
  });
  expect(() => planShoppingMove(changedSource, command)).toThrow("編集対象");
  const changedVisit = structuredClone(snapshot);
  Object.assign(changedVisit.eventLists.event[0] as object, { number: "9" });
  expect(() => planShoppingMove(changedVisit, command)).toThrow("編集対象");
  const changedTarget = structuredClone(snapshot);
  Object.assign(changedTarget.eventLists.event[1] as object, { number: "8" });
  expect(planShoppingMove(changedTarget, command).confirmation).toBeDefined();
  expect(h.commit).not.toHaveBeenCalled();
});

it("constructs recovery full snapshots without consulting the normal previous-based delta function", async () => {
  const h = await setupShopping();
  const delta = vi
    .spyOn(snapshotDeltas, "snapshotDelta")
    .mockImplementation(() => {
      throw new Error("previous-based delta is unavailable");
    });
  const full = await h.server.readFull();
  expect(full.delta.full?.eventLists.event).toHaveLength(3);
  expect(delta).not.toHaveBeenCalled();
});

it("keeps virtual hall assignments during repeated forward, reverse and candidate order commits", async () => {
  const h = await setupShopping();
  const initial = await db.readApplicationSnapshot();
  initial.snapshot.hallDefinitions = {
    event: {
      "__mapless__:1日目": [
        { id: "hall-a", name: "Aホール", vertices: [], blockNames: ["A"] },
      ],
    },
  };
  initial.snapshot.eventConsistency.event.days["1日目"] = {
    selectedMapKey: null,
    maps: {},
    mapless: {
      assignments: {
        "2": { kind: "simple", dayKey: "1日目", hallId: "hall-a" },
      },
      hallOrder: [],
      hallVisitLists: [],
      route: null,
    },
  };
  await db.commitApplicationSnapshotAtomically(initial.snapshot, {
    expectedRoots: initial.expectedRoots,
    changedStoresOnly: true,
  });
  await h.server.read();
  let current = (await db.readApplicationSnapshot()).snapshot;
  const transitions = [
    {
      sourceColumn: "candidate" as const,
      targetColumn: "execute" as const,
      effectiveIds: ["2"],
      itemIds: ["1", "2", "other-day"],
      executeIds: ["1", "2"],
    },
    {
      sourceColumn: "execute" as const,
      targetColumn: "candidate" as const,
      effectiveIds: ["1", "2"],
      itemIds: ["2", "1", "other-day"],
      executeIds: [],
    },
    {
      sourceColumn: "candidate" as const,
      targetColumn: "candidate" as const,
      effectiveIds: ["2"],
      itemIds: ["1", "2", "other-day"],
      executeIds: [],
    },
  ];
  for (const [index, transition] of transitions.entries()) {
    const projected = projectConsistencySnapshot(current, "event", "1日目");
    expect(projected.eventLists.event[0]).toHaveProperty("manualHallId");
    const command = {
      ...shoppingCommand(),
      ...transition,
      requestedIds: transition.effectiveIds,
      baselineItemIds: current.eventLists.event.map(
        (item) => (item as { id: string }).id,
      ),
      baselineExecuteIds: current.executeModeItems.event["1日目"],
      baselineVisits: shoppingMoveVisitBaseline(current, "event", "1日目"),
    };
    const plan = planShoppingMove(current, command);
    expect(plan.confirmation).toBeUndefined();
    expect(
      plan.snapshot.eventLists.event.every(
        (item) => !Object.prototype.hasOwnProperty.call(item, "manualHallId"),
      ),
    ).toBe(true);
    const committed = await h.server.shopping(
      command,
      `projected-move:${index}`,
      {},
    );
    expect(committed.status).toBe("committed");
    current = (await db.readApplicationSnapshot()).snapshot;
    expect(
      current.eventLists.event.map((item) => (item as { id: string }).id),
    ).toEqual(transition.itemIds);
    expect(current.executeModeItems.event["1日目"]).toEqual(
      transition.executeIds,
    );
    expect(
      current.eventLists.event.find(
        (item) => (item as { id: string }).id === "2",
      ),
    ).toMatchObject({
      quantity: 7,
      remarks: "後発メモ",
      customField: { keep: true },
    });
    expect(
      current.eventLists.event.every(
        (item) => !Object.prototype.hasOwnProperty.call(item, "manualHallId"),
      ),
    ).toBe(true);
    expect(current.executeModeItems.event["2日目"]).toEqual(["other-day"]);
    expect(
      current.eventConsistency.event.days["1日目"].mapless?.assignments["2"],
    ).toEqual({ kind: "simple", dayKey: "1日目", hallId: "hall-a" });
  }
});
