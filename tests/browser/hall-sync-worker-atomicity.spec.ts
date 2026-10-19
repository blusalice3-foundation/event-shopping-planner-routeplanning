import { expect, test, type Locator, type Page } from "@playwright/test";
import { migrateLegacyConsistency } from "../../src/features/consistency/domain/migration";
import { createAppBackup } from "../../src/utils/appBackup";
import type { EventConsistencyStore } from "../../src/types/consistency";
import type { HallDefinitionsStore } from "../../src/types/map";

const eventName = "ホール同期の原子性";
const unrelatedEvent = "変更しないイベント";
const days = ["1日目", "2日目", "２日目", "3日目", "4日目"];
const targets = days.slice(1, 4);
const mapKeys = [
  "1日目マップ",
  "2日目マップ",
  "2日目マップ",
  "3日目マップ",
  "4日目マップ",
];
const draftName = "ユーザー登録・同期する下書き";
const maplessKey = (day: string) => `__mapless__:${day}`;
const sourceName = (simple: boolean) =>
  simple ? "元の簡易ホール" : "元の詳細ホール";

test.use({ serviceWorkers: "block" });

function fixture(simple: boolean) {
  const item = (id: string, eventDate: string, block = "A") => ({
    id,
    eventDate,
    circle: `サークル${id}`,
    title: `新刊${id}`,
    block,
    number: "1",
    price: 700,
    quantity: 2,
    purchaseStatus: "Purchased",
    remarks: "エラーが発生しました・この購入記録は保持",
  });
  const map = {
    cells: [],
    mergedCells: [],
    maxRow: 6,
    maxCol: 6,
    blocks: [
      {
        name: "A",
        startRow: 1,
        startCol: 1,
        endRow: 5,
        endCol: 5,
        numberCells: [{ row: 2, col: 2, value: 1 }],
      },
    ],
  };
  const detailed = {
    id: "shared-raw-id",
    name: sourceName(false),
    vertices: [
      { row: 1, col: 1 },
      { row: 1, col: 5 },
      { row: 5, col: 5 },
      { row: 5, col: 1 },
    ],
  };
  const simpleHall = {
    id: "shared-raw-id",
    name: sourceName(true),
    vertices: [],
    blockNames: [simple ? "A" : "B"],
  };
  const definitions: HallDefinitionsStore = {
    [eventName]: Object.fromEntries([
      ...(!simple
        ? [...new Set(mapKeys)].map((key, index) => [
            key,
            [
              {
                ...detailed,
                name: index ? `元の詳細同期先${index}` : sourceName(false),
              },
            ],
          ])
        : []),
      ...days.map((day, index) => [
        maplessKey(day),
        [
          {
            ...simpleHall,
            name: index ? `元の簡易同期先${index}` : sourceName(true),
          },
        ],
      ]),
    ]),
    [unrelatedEvent]: {
      [maplessKey(days[0])]: [{ ...simpleHall, name: "別イベントのホール" }],
    },
  };
  const records = days.flatMap((day, index) => [
    item(`${index + 1}`, day),
    ...(!simple ? [item(`${index + 1}-simple`, day, "B")] : []),
  ]);
  const snapshot = migrateLegacyConsistency({
    eventLists: {
      [eventName]: records,
      [unrelatedEvent]: [item("unrelated", days[0])],
    },
    eventMetadata: {},
    executeModeItems: {
      [eventName]: Object.fromEntries(
        days.map((day) => [
          day,
          records
            .filter((entry) => entry.eventDate === day)
            .map((entry) => entry.id),
        ]),
      ),
      [unrelatedEvent]: { [days[0]]: ["unrelated"] },
    },
    dayModes: {
      [eventName]: Object.fromEntries(days.map((day) => [day, "edit"])),
      [unrelatedEvent]: { [days[0]]: "edit" },
    },
    mapData: {
      [eventName]: simple
        ? {}
        : Object.fromEntries([...new Set(mapKeys)].map((key) => [key, map])),
    },
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallDefinitions: definitions,
    hallRouteSettings: {},
  }).data;
  for (const [index, day] of days.entries()) {
    const state = snapshot.eventConsistency[eventName].days[day];
    const context = simple ? state.mapless! : state.maps[mapKeys[index]];
    const simpleGroup = {
      hall: { kind: "simple" as const, dayKey: day, hallId: "shared-raw-id" },
      priority: "none" as const,
    };
    const detailedGroup = {
      hall: {
        kind: "map" as const,
        mapKey: mapKeys[index],
        hallId: "shared-raw-id",
      },
      priority: "none" as const,
    };
    context.hallOrder = simple ? [simpleGroup] : [detailedGroup, simpleGroup];
    context.hallVisitLists = simple
      ? [{ group: simpleGroup, itemIds: [`${index + 1}`] }]
      : [
          { group: detailedGroup, itemIds: [`${index + 1}`] },
          { group: simpleGroup, itemIds: [`${index + 1}-simple`] },
        ];
    context.assignments = simple
      ? { [`${index + 1}`]: simpleGroup.hall }
      : {
          [`${index + 1}`]: detailedGroup.hall,
          [`${index + 1}-simple`]: simpleGroup.hall,
        };
  }
  return createAppBackup(snapshot);
}

async function restore(page: Page, simple: boolean) {
  await page.addInitScript(() => {
    Object.assign(window, { __hallSyncWorkerCount: 0 });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (String(url).includes("persistence.worker")) {
          const state = window as unknown as { __hallSyncWorkerCount: number };
          state.__hallSyncWorkerCount++;
        }
      }
    };
  });
  const buffer = Buffer.from(JSON.stringify(fixture(simple)), "utf8");
  for (const name of [unrelatedEvent, eventName]) {
    await page.goto("/");
    await page
      .locator('input[aria-label="バックアップファイルを選択"]')
      .setInputFiles({
        name: "hall-sync-atomicity.json",
        mimeType: "application/json",
        buffer,
      });
    const dialog = page.getByRole("dialog", {
      name: "バックアップからイベントを復元",
    });
    await dialog.getByLabel("復元するイベント").selectOption(name);
    await dialog.getByRole("radio", { name: /同名で置換/ }).check();
    await dialog
      .getByRole("button", { name: "置換して復元", exact: true })
      .click();
    const confirm = page.getByRole("button", {
      name: "確認して保存",
      exact: true,
    });
    await expect
      .poll(async () =>
        (await confirm.isVisible())
          ? "review"
          : (await dialog.isVisible())
            ? "waiting"
            : "saved",
      )
      .not.toBe("waiting");
    if (await confirm.isVisible()) await confirm.click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
}

type StoredRows = Record<string, Array<{ key: IDBValidKey; value: unknown }>>;

async function allStores(page: Page): Promise<StoredRows> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<StoredRows>((resolve, reject) => {
        const names = [...database.objectStoreNames];
        const transaction = database.transaction(names, "readonly");
        const rows: StoredRows = Object.fromEntries(
          names.map((name) => [name, []]),
        );
        transaction.oncomplete = () => resolve(rows);
        transaction.onabort = () => reject(transaction.error);
        for (const name of names) {
          const cursor = transaction.objectStore(name).openCursor();
          cursor.onerror = () => reject(cursor.error);
          cursor.onsuccess = () => {
            const current = cursor.result;
            if (!current) return;
            rows[name].push({ key: current.key, value: current.value });
            current.continue();
          };
        }
      });
    } finally {
      database.close();
    }
  });
}

function payload<T>(rows: StoredRows, store: string): T {
  const head = rows[store].find((entry) => entry.key === "data")?.value;
  if (
    (head as { kind?: string } | undefined)?.kind !==
    "event-shopping-planner-day-records"
  )
    return head as T;
  const result: Record<string, unknown> = {};
  const records = rows[store]
    .filter((entry) =>
      String(entry.key).startsWith("__esp_internal__:day-record:v1:"),
    )
    .map(
      (entry) =>
        entry.value as { eventName: string; path: string[]; value: unknown },
    )
    .sort((left, right) => left.path.length - right.path.length);
  for (const record of records) {
    if (!record.path.length) {
      result[record.eventName] = structuredClone(record.value);
      continue;
    }
    let parent = result[record.eventName] as Record<string, unknown>;
    for (const part of record.path.slice(0, -1))
      parent = parent[part] as Record<string, unknown>;
    parent[record.path.at(-1)!] = structuredClone(record.value);
  }
  return result as T;
}

async function openPanel(page: Page, simple: boolean) {
  await page.getByRole("button", { name: /^1日目/ }).click();
  if (simple)
    await page
      .getByTitle("ホール定義（ブロック割当）", { exact: true })
      .click();
  else {
    await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
    await page.getByTitle("リスト表示に切り替え", { exact: true }).hover();
    await page.mouse.down();
    const action = page.getByRole("button", {
      name: "🏛️ ホール定義",
      exact: true,
    });
    await expect(action).toBeVisible();
    await page.mouse.up();
    await action.click();
  }
  return page.getByRole("dialog", {
    name: simple ? "ホール定義（ブロック割当）" : "ホール定義エリア設定",
    exact: true,
  });
}

interface TransactionTrace {
  stores: string[];
  outcome: "pending" | "complete" | "abort";
  puts: number;
  successfulPuts: number;
  queuedDefinitions: string[];
  successfulDefinitions: string[];
}
interface WorkerTrace {
  writeRequests: string[];
  injected: number;
  transactions: TransactionTrace[];
}

async function installAbort(page: Page, simple: boolean) {
  const worker = page
    .workers()
    .find((candidate) => candidate.url().includes("persistence.worker"));
  if (!worker) throw new Error("The real persistence Worker has not started.");
  await worker.evaluate(
    ({ eventName, destination }) => {
      const trace: WorkerTrace = {
        writeRequests: [],
        injected: 0,
        transactions: [],
      };
      Object.assign(globalThis, { __hallSyncAbortTrace: trace });
      self.addEventListener("message", (event) => {
        const method = event.data?.method as string | undefined;
        if (
          method &&
          (["commit", "commitDay", "day", "items"].includes(method) ||
            method.startsWith("save"))
        )
          trace.writeRequests.push(method);
      });
      const transactions = new WeakMap<IDBTransaction, TransactionTrace>();
      const originalTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (
        ...args: Parameters<IDBDatabase["transaction"]>
      ) {
        const transaction = originalTransaction.apply(this, args);
        if (args[1] === "readwrite") {
          const record: TransactionTrace = {
            stores: [...transaction.objectStoreNames],
            outcome: "pending",
            puts: 0,
            successfulPuts: 0,
            queuedDefinitions: [],
            successfulDefinitions: [],
          };
          transactions.set(transaction, record);
          trace.transactions.push(record);
          transaction.addEventListener("complete", () => {
            record.outcome = "complete";
          });
          transaction.addEventListener("abort", () => {
            record.outcome = "abort";
          });
        }
        return transaction;
      };
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (
        ...args: Parameters<IDBObjectStore["put"]>
      ) {
        const request = originalPut.apply(this, args);
        const transaction = this.transaction;
        const record = transactions.get(transaction);
        if (!record) return request;
        record.puts++;
        const value = args[0] as {
          kind?: string;
          eventName?: string;
          path?: string[];
        };
        const key =
          this.name === "hallDefinitions" &&
          value.kind === "event-shopping-planner-day-record" &&
          value.eventName === eventName
            ? value.path?.[0]
            : undefined;
        if (key) record.queuedDefinitions.push(key);
        request.addEventListener("success", () => {
          record.successfulPuts++;
          if (key) record.successfulDefinitions.push(key);
          // Abort only after real source and target definition writes have succeeded.
          // Their request success must still roll back with the encompassing transaction.
          if (key === destination && trace.injected === 0) {
            trace.injected++;
            transaction.abort();
          }
        });
        return request;
      };
    },
    { eventName, destination: simple ? maplessKey("3日目") : "3日目マップ" },
  );
  return worker;
}

async function sync(page: Page, panel: Locator) {
  page.once("dialog", (dialog) => dialog.accept());
  await panel.getByRole("button", { name: /選択した日に同期/ }).click();
  const confirmation = page.getByRole("button", {
    name: "確認して保存",
    exact: true,
  });
  const error = panel.getByRole("alert");
  await expect
    .poll(async () => {
      if (await confirmation.isVisible()) return "review";
      if (await error.isVisible()) return "failed";
      return (await panel
        .getByRole("checkbox", { name: targets[0], exact: true })
        .isVisible())
        ? "waiting"
        : "saved";
    })
    .not.toBe("waiting");
  if (await confirmation.isVisible()) await confirmation.click();
}

for (const simple of [true, false]) {
  test(`OP02 real Worker ${simple ? "simple" : "detailed"} hall sync rolls back every source/target after successful IDB writes, then retries atomically`, async ({
    page,
  }, testInfo) => {
    await restore(page, simple);
    const panel = await openPanel(page, simple);
    await panel
      .getByRole("button")
      .filter({ hasText: sourceName(simple) })
      .first()
      .click();
    await panel.getByPlaceholder("例: 東1ホール").fill(draftName);
    await panel
      .getByRole("button", { name: simple ? "確定" : "保存", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "他の日に同期", exact: true })
      .click();
    for (const day of targets)
      await panel.getByRole("checkbox", { name: day, exact: true }).check();
    const before = await allStores(page);
    const beforeDefinitions = payload<HallDefinitionsStore>(
      before,
      "hallDefinitions",
    );
    const beforeConsistency = payload<EventConsistencyStore>(
      before,
      "eventConsistency",
    );
    if (!simple) {
      // Distinct exact day keys resolve to one shared real map destination.
      for (const day of targets.slice(0, 2))
        expect(
          Object.keys(beforeConsistency[eventName].days[day].maps),
        ).toEqual(["2日目マップ"]);
    }
    const worker = await installAbort(page, simple);
    await sync(page, panel);
    await expect(panel.getByRole("alert")).toContainText(
      "入力を保持しています",
    );
    await expect(
      panel.getByRole("button").filter({ hasText: draftName }).first(),
    ).toBeVisible();
    for (const day of targets)
      await expect(
        panel.getByRole("checkbox", { name: day, exact: true }),
      ).toBeChecked();
    expect(await allStores(page)).toEqual(before);
    const failed = await worker.evaluate(
      () =>
        (globalThis as unknown as { __hallSyncAbortTrace: WorkerTrace })
          .__hallSyncAbortTrace,
    );
    expect(failed.writeRequests).toEqual(["commit"]);
    expect(failed.injected).toBe(1);
    expect(failed.transactions).toHaveLength(1);
    expect(failed.transactions[0].outcome).toBe("abort");
    expect(failed.transactions[0].stores).toEqual(
      expect.arrayContaining([
        "hallDefinitions",
        "hallRouteSettings",
        "eventConsistency",
        "syncQueue",
      ]),
    );
    expect(failed.transactions[0].successfulPuts).toBeGreaterThan(1);
    if (!simple)
      expect(
        failed.transactions[0].queuedDefinitions.filter(
          (key) => key === "2日目マップ",
        ),
      ).toHaveLength(1);
    const destinations = simple
      ? days.slice(0, 4).map(maplessKey)
      : ["1日目マップ", "2日目マップ", "3日目マップ"];
    expect(failed.transactions[0].successfulDefinitions).toEqual(
      expect.arrayContaining(destinations),
    );
    // A second independent readonly transaction sees exactly the same durable data.
    expect(await allStores(page)).toEqual(before);
    await sync(page, panel);
    await expect(panel.getByRole("alert")).toHaveCount(0);
    await expect(
      panel.getByRole("checkbox", { name: targets[0], exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button").filter({ hasText: draftName }).first(),
    ).toBeVisible();
    const saved = await allStores(page);
    const definitions = payload<HallDefinitionsStore>(saved, "hallDefinitions");
    const consistency = payload<EventConsistencyStore>(
      saved,
      "eventConsistency",
    );
    for (const destination of destinations)
      expect(definitions[eventName][destination][0].name).toBe(draftName);
    expect(definitions[eventName][destinations[0]][0].id).toBe("shared-raw-id");
    expect(
      new Set(
        destinations.map(
          (destination) => definitions[eventName][destination][0].id,
        ),
      ).size,
    ).toBe(destinations.length);
    for (const hall of Object.values(definitions[eventName]).flat())
      expect(hall.id.startsWith("@hall:")).toBe(false);
    for (const [index, day] of days.slice(0, 4).entries()) {
      const context = simple
        ? consistency[eventName].days[day].mapless!
        : consistency[eventName].days[day].maps[mapKeys[index]];
      const destination = simple ? maplessKey(day) : mapKeys[index];
      const hallId = definitions[eventName][destination][0].id;
      expect(context.hallOrder[0].hall).toEqual(
        simple
          ? { kind: "simple", dayKey: day, hallId }
          : { kind: "map", mapKey: destination, hallId },
      );
      expect(
        context.hallVisitLists.find(
          (list) => list.group.hall?.hallId === hallId,
        )?.itemIds,
      ).toEqual([`${index + 1}`]);
      if (!simple) {
        expect(definitions[eventName][maplessKey(day)]).toEqual(
          beforeDefinitions[eventName][maplessKey(day)],
        );
        expect(context.hallOrder[1]).toEqual(
          beforeConsistency[eventName].days[day].maps[mapKeys[index]]
            .hallOrder[1],
        );
        expect(
          context.hallVisitLists.find(
            (list) => list.group.hall?.kind === "simple",
          ),
        ).toEqual(
          beforeConsistency[eventName].days[day].maps[
            mapKeys[index]
          ].hallVisitLists.find((list) => list.group.hall?.kind === "simple"),
        );
      }
    }
    expect(consistency[eventName].days[days[4]]).toEqual(
      beforeConsistency[eventName].days[days[4]],
    );
    for (const key of [maplessKey(days[4]), ...(!simple ? [mapKeys[4]] : [])])
      expect(definitions[eventName][key]).toEqual(
        beforeDefinitions[eventName][key],
      );
    for (const store of [
      "eventLists",
      "eventMetadata",
      "executeModeItems",
      "dayModes",
      "mapData",
      "mapRotationSettings",
      "mapViewportSettings",
      "routeSettings",
    ])
      expect(saved[store]).toEqual(before[store]);
    const previousRoutes = payload<Record<string, Record<string, unknown>>>(
      before,
      "hallRouteSettings",
    );
    const savedRoutes = payload<Record<string, Record<string, unknown>>>(
      saved,
      "hallRouteSettings",
    );
    for (const key of [maplessKey(days[4]), ...(!simple ? [mapKeys[4]] : [])])
      expect(savedRoutes[eventName]?.[key]).toEqual(
        previousRoutes[eventName]?.[key],
      );
    for (const store of [
      "hallDefinitions",
      "hallRouteSettings",
      "eventConsistency",
    ])
      expect(
        payload<Record<string, unknown>>(saved, store)[unrelatedEvent],
      ).toEqual(
        payload<Record<string, unknown>>(before, store)[unrelatedEvent],
      );
    const finalTrace = await worker.evaluate(
      () =>
        (globalThis as unknown as { __hallSyncAbortTrace: WorkerTrace })
          .__hallSyncAbortTrace,
    );
    expect(finalTrace.writeRequests).toEqual(["commit", "commit"]);
    expect(finalTrace.injected).toBe(1);
    expect(finalTrace.transactions.map((entry) => entry.outcome)).toEqual([
      "abort",
      "complete",
    ]);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __hallSyncWorkerCount: number })
            .__hallSyncWorkerCount,
      ),
    ).toBe(1);
    await testInfo.attach("real-worker-hall-sync-transaction-trace", {
      body: Buffer.from(JSON.stringify(finalTrace, null, 2), "utf8"),
      contentType: "application/json",
    });
    await page.reload();
    await expect(
      page.locator('input[aria-label="バックアップファイルを選択"]'),
    ).toBeAttached();
    expect(await allStores(page)).toEqual(saved);
    await page.getByText(eventName, { exact: true }).click();
    const reloaded = await openPanel(page, simple);
    await expect(
      reloaded.getByRole("button").filter({ hasText: draftName }).first(),
    ).toBeVisible();
  });
}
