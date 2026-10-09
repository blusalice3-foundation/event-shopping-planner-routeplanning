import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
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
  executeModeItems: {},
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
