import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { createServer } from "vite";

// Executes the real complete loader and writes of the pristine plan baseline.
// All data lives in disposable in-process IndexedDB, never a user profile.
const BASELINE_SHA = "200cd7564772a17e2264907ae22e9a93ad30f5dc";
const args = process.argv.slice(2);
assert.equal(
  args.length,
  2,
  "Usage: node scripts/verify-shopping-storage-rollback-baseline.mjs --baseline-root <pristine-baseline-worktree>",
);
assert.equal(args[0], "--baseline-root");
const baselineRoot = path.resolve(args[1]);
const currentRoot = process.cwd();
const git = (cwd, ...parameters) =>
  execFileSync("git", parameters, { cwd, encoding: "utf8" }).trim();
assert.equal(
  git(baselineRoot, "rev-parse", "HEAD"),
  BASELINE_SHA,
  "Baseline checkout must be the plan's exact commit",
);
assert.equal(
  git(baselineRoot, "diff", BASELINE_SHA, "--", "src"),
  "",
  "Baseline product sources must be pristine",
);
assert.notEqual(baselineRoot, currentRoot);
const storage = new Map();
globalThis.indexedDB = new IDBFactory();
globalThis.IDBKeyRange = IDBKeyRange;
globalThis.localStorage = {
  get length() {
    return storage.size;
  },
  key: (index) => [...storage.keys()][index] ?? null,
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
const servers = [];
try {
  const load = async (root) => {
    const server = await createServer({
      root,
      configFile: false,
      server: { middlewareMode: true, watch: null, hmr: false, ws: false },
      optimizeDeps: { noDiscovery: true },
      logLevel: "error",
    });
    servers.push(server);
    return async (file) => server.ssrLoadModule(path.join(root, file));
  };
  const current = await load(currentRoot);
  const baseline = await load(baselineRoot);
  const { db } = await current(
    "src/persistence/facade/indexedDbPersistence.ts",
  );
  const old = (await baseline("src/persistence/facade/indexedDbPersistence.ts"))
    .db;
  const { openDatabase } = await current("src/persistence/db/openDatabase.ts");
  const marker = async (key) => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = database.transaction("syncQueue", "readonly");
      const request = tx.objectStore("syncQueue").get(key);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
    });
  };
  const { createEventConsistency } = await current("src/types/consistency.ts");
  const { SHOPPING_STORAGE_MODE_KEY } = await current(
    "src/persistence/db/shoppingStorageMode.ts",
  );
  const baseItem = {
    circle: "ユーザー登録",
    title: "頒布物",
    eventDate: "1日目",
    block: "A",
    number: "1",
    price: 500,
    quantity: 7,
    purchaseStatus: "None",
    remarks: "エラーが発生しました",
    source: "spreadsheet",
    protectionLevel: "none",
    customField: { keep: "任意項目" },
  };
  const value = {
    eventLists: {
      event: [
        { ...baseItem, id: "1" },
        { ...baseItem, id: "2", quantity: 3 },
      ],
      past: [{ ...baseItem, id: "past", quantity: 5 }],
    },
    eventConsistency: {
      event: createEventConsistency(),
      past: createEventConsistency(),
    },
    eventMetadata: { event: { title: "開催情報" } },
    executeModeItems: { event: { "1日目": [] } },
    dayModes: { event: { "1日目": "execute" } },
    mapData: {},
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallDefinitions: {},
    hallRouteSettings: {},
  };
  const initial = await db.readApplicationSnapshot();
  await db.commitApplicationSnapshotAtomically(value, {
    expectedRoots: initial.expectedRoots,
  });
  const read = await db.readApplicationSnapshot({
    shareVerified: true,
    prepareScopedCommands: true,
  });
  const moved = structuredClone(read.snapshot);
  moved.eventLists.event.reverse();
  moved.executeModeItems.event["1日目"] = ["2"];
  await db.commitShoppingCommandSnapshot(moved, read.expectedRoots, {
    eventName: "event",
    day: "1日目",
  });
  let beforeError;
  try {
    await old.readApplicationSnapshot();
  } catch (error) {
    beforeError = { name: error.name, message: error.message };
  }
  assert.ok(
    beforeError,
    "Baseline should reproduce rejection before compatibility preparation",
  );
  const backup = await db.readApplicationSnapshot({
    prepareScopedCommands: false,
  });
  assert.deepEqual(backup.snapshot, moved);
  await db.prepareShoppingMoveRollback(backup.expectedRoots);
  const oldRead = await old.readApplicationSnapshot({
    prepareScopedCommands: true,
  });
  assert.deepEqual(
    oldRead.snapshot,
    moved,
    "Actual baseline full load must preserve all stores",
  );
  const markerBefore = await marker(SHOPPING_STORAGE_MODE_KEY);
  assert.equal(markerBefore.mode, "legacy");
  oldRead.snapshot.eventLists.event[0].quantity = 11;
  oldRead.snapshot.eventLists.event[0].remarks = "旧版で更新したメモ";
  oldRead.snapshot.executeModeItems.event["1日目"] = ["2", "1"];
  await old.commitApplicationSnapshotAtomically(oldRead.snapshot, {
    expectedRoots: oldRead.expectedRoots,
    changedStoresOnly: true,
  });
  assert.deepEqual(
    (await old.readApplicationSnapshot()).snapshot,
    oldRead.snapshot,
  );
  const currentRead = await db.readApplicationSnapshot({
    prepareScopedCommands: true,
  });
  assert.deepEqual(
    currentRead.snapshot,
    oldRead.snapshot,
    "Current version must read baseline edits without reconversion",
  );
  const raw = await db.getAllData("eventLists");
  assert.deepEqual(raw.data, currentRead.snapshot.eventLists);
  assert.deepEqual(
    await marker(SHOPPING_STORAGE_MODE_KEY),
    markerBefore,
    "Baseline must ignore/preserve the private marker",
  );
  const scoped = await old.readDayCommandSnapshot({
    eventName: "event",
    day: "1日目",
  });
  assert.deepEqual(
    scoped.snapshot.eventLists.event,
    currentRead.snapshot.eventLists.event,
  );
  console.log(
    JSON.stringify(
      {
        baselineSha: BASELINE_SHA,
        currentSha: git(currentRoot, "rev-parse", "HEAD"),
        baselineRejectedBeforePreparation: beforeError,
        actualBaselineFullLoadAfterPreparation: true,
        allStoresEqual: true,
        baselineWriteThenCurrentRead: true,
        baselineScopedRead: true,
        baselineMarkerIgnoredAndPreserved: true,
        japaneseQuantityOptionalFieldsPreserved: true,
        databaseImplementation: "fake-indexeddb",
        userDataUsed: false,
      },
      null,
      2,
    ),
  );
} finally {
  for (const server of servers.reverse()) await server.close();
}
