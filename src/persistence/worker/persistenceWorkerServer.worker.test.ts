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
      ([value]) => value.eventName === "event" && value.path.at(-1) === "1日目",
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
