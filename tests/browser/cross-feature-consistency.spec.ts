import ExcelJS from "exceljs";
import type { PersistenceSnapshot } from "../../src/app/ports/PersistenceCommandPort";
import { planEventRestore } from "../../src/features/consistency/domain/eventMutations";
import { duplicateEventDays } from "../../src/features/consistency/domain/dayMerge";
import { createAppBackup } from "../../src/utils/appBackup";
import { migrateLegacyConsistency } from "../../src/features/consistency/domain/migration";
import type { EventConsistencyStore } from "../../src/types/consistency";
import { expect, test, type Page } from "@playwright/test";
import {
  createNextPersistenceCheckpoint,
  prepareMetadataForPayload,
  type StoredPersistenceMetadata,
} from "../../src/persistence/internal/persistenceCore";
import {
  createPersistenceMetadataKey,
  createPersistenceCheckpointKey,
  type PersistenceCheckpoint,
} from "../../src/utils/persistenceResilience";

const eventName = "整合性検証";
const item = (id: string, eventDate = "1日目") => ({
  id,
  eventDate,
  circle: "サークル" + id,
  title: "新刊" + id,
  block: "A",
  number: id,
  price: 500,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "ユーザー登録",
});
const backup = (items = [item("1"), item("2", "2日目")]) => ({
  kind: "event-shopping-planner-backup",
  version: 1,
  exportedAt: "2026-09-28T00:00:00.000Z",
  eventSettings: { blockDetectionSettings: {} },
  data: {
    eventLists: { [eventName]: items },
    eventMetadata: {},
    executeModeItems: {
      [eventName]: {
        "1日目": items
          .filter((value) => value.eventDate === "1日目")
          .map((value) => value.id),
        "2日目": items
          .filter((value) => value.eventDate === "2日目")
          .map((value) => value.id),
      },
    },
    dayModes: { [eventName]: { "1日目": "edit", "2日目": "edit" } },
    mapData: {},
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallDefinitions: {},
    hallRouteSettings: {},
  },
});
async function restore(
  page: Page,
  data: unknown = backup(),
  reviewTitle?: string,
) {
  await page.goto("/");
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "consistency.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data), "utf8"),
    });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog.getByRole("button", { name: "置換して復元" }).click();
  if (reviewTitle) {
    const review = page.getByRole("dialog", { name: reviewTitle, exact: true });
    await expect(review).toBeVisible();
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
    await expect(review).toBeHidden();
  }
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
}
function persistenceRealm(page: Page) {
  const worker = page
    .workers()
    .find((candidate) => candidate.url().includes("persistence.worker"));
  if (!worker) throw new Error("The persistence worker has not started.");
  return worker;
}
async function stored(page: Page, store: string, key = "data") {
  return page.evaluate(
    async ({ name, key }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("EventShoppingPlannerDB");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<unknown>((resolve, reject) => {
          const store = database
            .transaction(name, "readonly")
            .objectStore(name);
          const request = store.get(key);
          request.onsuccess = () => {
            const head = request.result;
            if (
              key !== "data" ||
              head?.kind !== "event-shopping-planner-day-records"
            ) {
              resolve(head);
              return;
            }
            const prefix = "__esp_internal__:day-record:v1:";
            const rows: Array<{
              eventName: string;
              path: string[];
              value: unknown;
            }> = [];
            const cursor = store.openCursor(
              IDBKeyRange.bound(prefix, prefix + "\uffff"),
            );
            cursor.onerror = () => reject(cursor.error);
            cursor.onsuccess = () => {
              const row = cursor.result;
              if (row) {
                rows.push(row.value);
                row.continue();
                return;
              }
              const data: Record<string, Record<string, unknown>> = {};
              for (const row of rows.filter((row) => !row.path.length))
                Object.defineProperty(data, row.eventName, {
                  value: row.value,
                  enumerable: true,
                });
              for (const row of rows.filter((row) => row.path.length)) {
                const parent =
                  row.path.length === 2
                    ? (data[row.eventName].days as Record<string, unknown>)
                    : data[row.eventName];
                Object.defineProperty(parent, row.path.at(-1)!, {
                  value: row.value,
                  enumerable: true,
                });
              }
              resolve(data);
            };
          };
          request.onerror = () => reject(request.error);
        });
      } finally {
        database.close();
      }
    },
    { name: store, key },
  );
}
async function storedMaps(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Record<string, Record<string, unknown>>>(
        (resolve, reject) => {
          const maps: Record<string, Record<string, unknown>> = {};
          const request = database
            .transaction("mapData", "readonly")
            .objectStore("mapData")
            .openCursor();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
              resolve(maps);
              return;
            }
            const key = String(cursor.key);
            if (key.startsWith("mapData:")) {
              const [event, map] = JSON.parse(key.slice("mapData:".length)) as [
                string,
                string,
              ];
              (maps[event] ??= {})[map] = cursor.value;
            }
            cursor.continue();
          };
        },
      );
    } finally {
      database.close();
    }
  });
}
test("legacy JSON restores atomically and target-day long press persists exactly once", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await restore(page);
  const second = page.getByRole("button", { name: /^2日目/ });
  await second.hover();
  await page.mouse.down();
  await expect
    .poll(async () => stored(page, "dayModes"))
    .toMatchObject({ [eventName]: { "1日目": "edit", "2日目": "execute" } });
  await page.mouse.up();
  expect(await stored(page, "eventConsistency")).toMatchObject({
    [eventName]: { schemaVersion: 1 },
  });
  await page.reload();
  await expect(
    page.locator('input[aria-label="バックアップファイルを選択"]'),
  ).toBeAttached();
  expect(await stored(page, "dayModes")).toMatchObject({
    [eventName]: { "1日目": "edit", "2日目": "execute" },
  });
  expect(errors).toEqual([]);
});
test("search brings an initially unmounted item into view and repeats after another search", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await restore(
    page,
    backup(Array.from({ length: 120 }, (_, index) => item(String(index + 1)))),
  );
  await page.getByRole("button", { name: "🏃‍♂️", exact: true }).click();
  await expect
    .poll(async () => stored(page, "dayModes"))
    .toMatchObject({
      [eventName]: { "1日目": "execute" },
    });
  await page.getByRole("button", { name: "スペース別", exact: true }).click();
  await expect(page.locator('[data-list-renderer="virtual"]')).toBeVisible();
  await expect(page.locator('[data-item-id="110"]')).toHaveCount(0);
  await page.getByPlaceholder("検索...").fill("サークル110");
  await page.getByRole("button", { name: "次を検索", exact: true }).click();
  await expect(page.locator('[data-item-id="110"]')).toBeInViewport();
  await page.getByPlaceholder("検索...").fill("サークル1");
  await page.getByRole("button", { name: "次を検索", exact: true }).click();
  await expect(page.locator('[data-item-id="1"]')).toBeInViewport();
  await page.getByPlaceholder("検索...").fill("サークル110");
  await page.getByRole("button", { name: "次を検索", exact: true }).click();
  await expect(page.locator('[data-item-id="110"]')).toBeInViewport();
  await page.getByPlaceholder("検索...").fill("");
  await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  await page.getByText(eventName, { exact: true }).click();
  await expect(page.locator('[data-item-id="1"]')).toBeInViewport();
  await expect(page.locator('[data-item-id="110"]')).toHaveCount(0);
  // An already handled request also expires when reopening with the same query.
  await page.getByPlaceholder("検索...").fill("サークル110");
  await page.getByRole("button", { name: "次を検索", exact: true }).click();
  await expect(page.locator('[data-item-id="110"]')).toBeInViewport();
  await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  await page.getByText(eventName, { exact: true }).click();
  await expect(page.locator('[data-item-id="1"]')).toBeInViewport();
  await expect(page.locator('[data-item-id="110"]')).toHaveCount(0);
  await page.getByRole("button", { name: "次を検索", exact: true }).click();
  await expect(page.locator('[data-item-id="110"]')).toBeInViewport();
});

const mapBackup = () => {
  const source = backup([item("1"), item("2"), item("3", "2日目")]);
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
        numberCells: [
          { row: 2, col: 2, value: 1 },
          { row: 3, col: 2, value: 2 },
        ],
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
  const settings = {
    hallOrder: ["hall"],
    hallVisitLists: [{ hallId: "hall", itemIds: ["1", "2"] }],
  };
  return {
    ...source,
    data: {
      ...source.data,
      mapData: { [eventName]: { "1日目マップ": map, "１日目マップ": map } },
      hallDefinitions: {
        [eventName]: { "1日目マップ": [hall], "１日目マップ": [hall] },
      },
      hallRouteSettings: {
        [eventName]: { "1日目マップ": settings, "１日目マップ": settings },
      },
    },
  };
};

// Existing-database scenarios must start from saved duplicates. Backup restore
// now requires a merge review, so seed that legacy state with valid DB metadata.
async function loadSavedSnapshot(page: Page, source: PersistenceSnapshot) {
  const duplicates = duplicateEventDays(source, eventName);
  const initial = duplicates.length
    ? planEventRestore(source, source, eventName, eventName).snapshot
    : source;
  await restore(page, createAppBackup(initial));
  if (!duplicates.length) return;
  const writes = await Promise.all(
    Object.entries(source)
      .filter(
        ([store, value]) =>
          store !== "mapData" &&
          JSON.stringify(value) !==
            JSON.stringify(initial[store as keyof PersistenceSnapshot]),
      )
      .map(async ([store, value]) => {
        const metadataKey = createPersistenceMetadataKey(store, "data");
        const checkpointKey = createPersistenceCheckpointKey(store, "data");
        const previous = (await stored(
          page,
          "syncQueue",
          metadataKey,
        )) as StoredPersistenceMetadata;
        const previousCheckpoint = (await stored(
          page,
          "syncQueue",
          checkpointKey,
        )) as PersistenceCheckpoint | null;
        const metadata = await prepareMetadataForPayload(
          store,
          "data",
          value,
          previous.revision,
        );
        const checkpoint = createNextPersistenceCheckpoint(
          store,
          "data",
          metadata,
          previousCheckpoint,
        );
        return {
          store,
          value,
          metadataKey,
          checkpointKey,
          metadata,
          checkpoint,
        };
      }),
  );
  await page.evaluate(async (writes) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          [...new Set(["syncQueue", ...writes.map(({ store }) => store)])],
          "readwrite",
        );
        for (const {
          store,
          value,
          metadataKey,
          checkpointKey,
          metadata,
          checkpoint,
        } of writes) {
          transaction.objectStore(store).put(value, "data");
          transaction.objectStore("syncQueue").put(metadata, metadataKey);
          transaction.objectStore("syncQueue").put(checkpoint, checkpointKey);
        }
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, writes);
  await page.reload();
  await page.getByText(eventName, { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
}
async function openVisitList(page: Page) {
  await page.getByTitle("リスト表示に切り替え", { exact: true }).hover();
  await page.mouse.down();
  const openPanel = page.getByRole("button", {
    name: "📍 訪問リスト",
    exact: true,
  });
  await expect(openPanel).toBeVisible();
  await page.mouse.up();
  await openPanel.click();
}
async function reorderVisitList(page: Page) {
  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  await openVisitList(page);
  const rows = page.locator("[data-drag-item]");
  await expect(rows).toHaveCount(2);
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await rows.nth(1).dispatchEvent("dragstart", { dataTransfer: transfer });
  await rows.nth(0).dispatchEvent("dragover", { dataTransfer: transfer });
  await rows.nth(0).dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
  await expect
    .poll(() => stored(page, "executeModeItems"))
    .toMatchObject({
      [eventName]: { "1日目": ["2", "1"], "2日目": ["3"] },
    });
}
for (const choice of ["保存して確定", "キャンセル（破棄）"] as const) {
  test(`event-list navigation waits for the visit transition answer: ${choice}`, async ({
    page,
  }) => {
    await restore(page, mapBackup());
    const originalItems = await stored(page, "eventLists");
    const originalConsistency = (await stored(
      page,
      "eventConsistency",
    )) as EventConsistencyStore;
    await reorderVisitList(page);
    await expect(
      page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "イベント一覧", exact: true })
      .click();
    const confirm = page.getByRole("heading", { name: "変更を保存しますか？" });
    await expect(confirm).toBeVisible();
    // The panel and its history must stay alive until the answer is applied.
    await expect(
      page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }),
    ).toBeEnabled();
    expect(await stored(page, "executeModeItems")).toMatchObject({
      [eventName]: { "1日目": ["2", "1"] },
    });
    await page.getByRole("button", { name: choice, exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(page.locator("[data-drag-item]")).toHaveCount(0);
    const expected = choice === "保存して確定" ? ["2", "1"] : ["1", "2"];
    expect(await stored(page, "executeModeItems")).toMatchObject({
      [eventName]: { "1日目": expected, "2日目": ["3"] },
    });
    expect(await stored(page, "eventLists")).toEqual(originalItems);
    expect(
      ((await stored(page, "eventConsistency")) as EventConsistencyStore)[
        eventName
      ].days["2日目"],
    ).toEqual(originalConsistency[eventName].days["2日目"]);
    await page.getByText(eventName, { exact: true }).click();
    await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
    await openVisitList(page);
    await expect(
      page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }),
    ).toBeDisabled();
    await expect(page.locator("[data-drag-item]").first()).toContainText(
      "サークル" + expected[0],
    );
    await page.getByRole("button", { name: "キャンセル", exact: true }).click();
    expect(await stored(page, "executeModeItems")).toMatchObject({
      [eventName]: { "1日目": expected },
    });
  });
}
for (const choice of ["保存して確定", "キャンセル（破棄）"] as const) {
  test(`map selection waits for the visit transition answer: ${choice}`, async ({
    page,
  }) => {
    await restore(page, mapBackup());
    await reorderVisitList(page);
    const before = await stored(page, "eventConsistency");
    const itemsBefore = await stored(page, "eventLists");
    const selector = page.getByRole("combobox", { name: "利用するマップ" });
    await expect(selector).toHaveValue("1日目マップ");
    await selector.selectOption("１日目マップ");
    await expect(
      page.getByText("変更を保存しますか？", { exact: true }),
    ).toBeVisible();
    expect(await stored(page, "eventConsistency")).toEqual(before);
    await expect(selector).toHaveValue("1日目マップ");
    await page.getByRole("button", { name: choice, exact: true }).click();
    await expect
      .poll(() => stored(page, "eventConsistency"))
      .toMatchObject({
        [eventName]: { days: { "1日目": { selectedMapKey: "１日目マップ" } } },
      });
    await expect(selector).toHaveValue("１日目マップ");
    const after = (await stored(
      page,
      "eventConsistency",
    )) as EventConsistencyStore;
    const original = before as EventConsistencyStore;
    for (const mapKey of ["1日目マップ", "１日目マップ"]) {
      const context = after[eventName].days["1日目"].maps[mapKey];
      const previous = original[eventName].days["1日目"].maps[mapKey];
      expect(context.assignments).toEqual(previous.assignments);
      expect(context.hallOrder).toEqual(previous.hallOrder);
      expect(context.hallVisitLists.map((list) => list.legacyHallId)).toEqual(
        previous.hallVisitLists.map((list) => list.legacyHallId),
      );
      expect(context.hallVisitLists[0].itemIds).toEqual(
        choice === "保存して確定" ? ["2", "1"] : ["1", "2"],
      );
    }
    expect(after[eventName].days["2日目"]).toEqual(
      original[eventName].days["2日目"],
    );
    expect(await stored(page, "eventLists")).toEqual(itemsBefore);
    expect(await stored(page, "executeModeItems")).toMatchObject({
      [eventName]: {
        "1日目": choice === "保存して確定" ? ["2", "1"] : ["1", "2"],
        "2日目": ["3"],
      },
    });
    await page.reload();
    await expect(
      page.locator('input[aria-label="バックアップファイルを選択"]'),
    ).toBeAttached();
    expect(await stored(page, "eventConsistency")).toMatchObject({
      [eventName]: { days: { "1日目": { selectedMapKey: "１日目マップ" } } },
    });
  });
}
test("a migrated database starts when legacy localStorage reads fail", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await restore(page);
  const before = await stored(page, "eventConsistency");
  await page.addInitScript(() => {
    const legacy = new Set([
      "eventShoppingLists",
      "eventLists",
      "eventMetadata",
      "executeModeItems",
      "dayModes",
      "mapData",
      "mapRotationSettings",
      "routeSettings",
      "hallDefinitions",
      "hallRouteSettings",
      "mapViewportSettings",
      "blockDetectionSettings",
      "syncQueue",
    ]);
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (legacy.has(key)) throw new Error("legacy storage unavailable");
      return getItem.call(this, key);
    };
  });
  await page.reload();
  await expect(
    page.locator('input[aria-label="バックアップファイルを選択"]'),
  ).toBeAttached();
  await page.getByText(eventName, { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
  expect(await stored(page, "eventConsistency")).toEqual(before);
  expect(errors).toEqual([]);
});

test("split legacy visit lists restore and remain separate after reorder and reload", async ({
  page,
}) => {
  const data = mapBackup();
  for (const settings of Object.values(data.data.hallRouteSettings[eventName]))
    settings.hallVisitLists = [
      { hallId: "hall", itemIds: ["1"] },
      { hallId: "hall", itemIds: ["2"] },
    ];
  await restore(page, data);
  const checkLists = async () => {
    const state = (await stored(
      page,
      "eventConsistency",
    )) as EventConsistencyStore;
    for (const context of Object.values(state[eventName].days["1日目"].maps))
      expect(
        context.hallVisitLists.map((list) => [list.legacyHallId, list.itemIds]),
      ).toEqual([
        ["hall", ["1"]],
        ["hall", ["2"]],
      ]);
  };
  await checkLists();
  await reorderVisitList(page);
  await checkLists();
  await page.reload();
  await expect(
    page.locator('input[aria-label="バックアップファイルを選択"]'),
  ).toBeAttached();
  await checkLists();
  expect(await stored(page, "executeModeItems")).toMatchObject({
    [eventName]: { "1日目": ["2", "1"] },
  });
});

async function editMemo(page: Page, memo: string) {
  const card = page
    .locator('[data-item-id="1"]')
    .first()
    .locator(":scope > div.rounded-lg")
    .first();
  await card.dispatchEvent("pointerdown", {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
  });
  await expect(
    page.getByRole("button", { name: "編集", exact: true }),
  ).toBeVisible();
  await card.dispatchEvent("pointerup", {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
  });
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page
    .getByRole("textbox", { name: "利用者メモ", exact: true })
    .last()
    .fill(memo);
}
test("a stale edit asks before replacing another tab's memo and reconfirms further changes", async ({
  page,
  context,
}) => {
  await restore(page);
  await editMemo(page, "古い画面からのメモ");
  const other = await context.newPage();
  await other.goto("/");
  await other.getByText(eventName, { exact: true }).click();
  await expect(
    other.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
  await editMemo(other, "別タブのメモ");
  await other.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(async () => stored(page, "eventLists"))
    .toMatchObject({
      [eventName]: expect.arrayContaining([
        expect.objectContaining({ id: "1", remarks: "別タブのメモ" }),
      ]),
    });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const conflict = page.getByRole("dialog", { name: "競合する更新を確認" });
  await expect(conflict).toContainText("別タブのメモ");
  expect(await stored(page, "eventLists")).toMatchObject({
    [eventName]: expect.arrayContaining([
      expect.objectContaining({ id: "1", remarks: "別タブのメモ" }),
    ]),
  });
  await editMemo(other, "さらに更新したメモ");
  await other.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(async () => stored(page, "eventLists"))
    .toMatchObject({
      [eventName]: expect.arrayContaining([
        expect.objectContaining({ id: "1", remarks: "さらに更新したメモ" }),
      ]),
    });
  await conflict.getByRole("button", { name: "確認して保存" }).click();
  await expect(conflict).toContainText("さらに更新したメモ");
  expect(await stored(page, "eventLists")).toMatchObject({
    [eventName]: expect.arrayContaining([
      expect.objectContaining({ id: "1", remarks: "さらに更新したメモ" }),
    ]),
  });
  await conflict.getByRole("button", { name: "取消", exact: true }).click();
  await expect(conflict).toBeHidden();
  expect(await stored(page, "eventLists")).toMatchObject({
    [eventName]: expect.arrayContaining([
      expect.objectContaining({ id: "1", remarks: "さらに更新したメモ" }),
    ]),
  });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(conflict).toBeVisible();
  await conflict.getByRole("button", { name: "確認して保存" }).click();
  await expect
    .poll(async () => stored(page, "eventLists"))
    .toMatchObject({
      [eventName]: expect.arrayContaining([
        expect.objectContaining({ id: "1", remarks: "古い画面からのメモ" }),
      ]),
    });
  await other.close();
});
test("long press confirms settings-only duplicate days before changing the displayed day", async ({
  page,
}) => {
  const source = backup();
  (source.data.dayModes[eventName] as Record<string, string>)[" 2日目　"] =
    "execute";
  await loadSavedSnapshot(page, migrateLegacyConsistency(source.data).data);
  const second = page.getByRole("button", { name: /^2日目/ });
  await second.hover();
  await page.mouse.down();
  const merge = page.getByRole("dialog", { name: /2日目 の保存先を統合/ });
  await expect(merge).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('[data-item-id="1"]')).toBeVisible();
  await expect(page.locator('[data-item-id="2"]')).toHaveCount(0);
  expect(await stored(page, "dayModes")).toMatchObject({
    [eventName]: { "2日目": "edit", " 2日目　": "execute" },
  });
  await merge.getByRole("button", { name: "取消", exact: true }).click();
  await expect(merge).toBeHidden();
  await expect(page.locator('[data-item-id="1"]')).toBeVisible();
  await second.hover();
  await page.mouse.down();
  await expect(merge).toBeVisible();
  await page.mouse.up();
  await merge.getByRole("button", { name: "確認して保存" }).click();
  await expect
    .poll(async () => stored(page, "dayModes"))
    .toEqual({ [eventName]: { "1日目": "edit", "2日目": "execute" } });
  await expect(page.locator('[data-item-id="2"]')).toBeVisible();
  await expect(page.locator('[data-item-id="1"]')).toHaveCount(0);
});
test("a failed long-press save keeps the current day and persisted modes", async ({
  page,
}) => {
  await restore(page);
  await persistenceRealm(page).evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      ...args: Parameters<typeof original>
    ) {
      if (args[1] === "readwrite")
        throw new DOMException("長押し保存失敗の検証", "AbortError");
      return original.apply(this, args);
    };
  });
  await page.getByRole("button", { name: /^2日目/ }).hover();
  await page.mouse.down();
  await expect(page.getByRole("alert")).toContainText("長押し保存失敗の検証");
  await page.mouse.up();
  await expect(page.locator('[data-item-id="1"]')).toBeVisible();
  await expect(page.locator('[data-item-id="2"]')).toHaveCount(0);
  expect(await stored(page, "dayModes")).toEqual({
    [eventName]: { "1日目": "edit", "2日目": "edit" },
  });
});

test("hall-order save preserves mixed legacy metadata on split lists and reload", async ({
  page,
}) => {
  const source = migrateLegacyConsistency(mapBackup().data).data;
  for (const context of Object.values(
    source.eventConsistency[eventName].days["1日目"].maps,
  )) {
    const list = context.hallVisitLists[0];
    context.hallVisitLists = [
      { group: list.group, itemIds: ["1"] },
      { group: list.group, itemIds: ["2"], legacyHallId: "hall" },
    ];
    context.hallOrder.push({ hall: null, priority: "none" });
  }
  await loadSavedSnapshot(page, source);
  const check = async () => {
    const state = (await stored(
      page,
      "eventConsistency",
    )) as EventConsistencyStore;
    for (const context of Object.values(state[eventName].days["1日目"].maps)) {
      expect(context.hallVisitLists).toHaveLength(2);
      expect(
        context.hallVisitLists.find((list) => list.itemIds.includes("1"))
          ?.legacyHallId,
      ).toBeUndefined();
      expect(
        context.hallVisitLists.find((list) => list.itemIds.includes("2"))
          ?.legacyHallId,
      ).toBe("hall");
    }
    expect(state[eventName].days["2日目"]).toEqual(
      source.eventConsistency[eventName].days["2日目"],
    );
  };
  await check();
  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  await page.getByTitle("ホール順を編集", { exact: true }).click();
  const order = page.getByRole("dialog", { name: "ホール間移動順序" });
  await order.getByRole("button", { name: "▼", exact: true }).click();
  await order.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(() => stored(page, "eventConsistency"))
    .toMatchObject({
      [eventName]: {
        days: {
          "1日目": {
            maps: {
              "1日目マップ": {
                hallOrder: [
                  { hall: null, priority: "none" },
                  {
                    hall: {
                      kind: "map",
                      mapKey: "1日目マップ",
                      hallId: "hall",
                    },
                    priority: "none",
                  },
                ],
              },
            },
          },
        },
      },
    });
  await check();
  await page.reload();
  await expect(
    page.locator('input[aria-label="バックアップファイルを選択"]'),
  ).toBeAttached();
  await check();
});

test("item editor shows location ambiguity separately and cancellation preserves items", async ({
  page,
}) => {
  const source = mapBackup();
  source.data.mapData[eventName]["1日目マップ"].blocks.push({
    name: "A",
    startRow: 4,
    startCol: 4,
    endRow: 6,
    endCol: 6,
    numberCells: [{ row: 5, col: 5, value: 1 }],
  });
  await restore(page, source);
  const before = await stored(page, "eventLists");
  await editMemo(page, "ユーザー登録");
  const editor = page.getByRole("dialog", { name: "アイテム編集" });
  await expect(editor).toContainText("所属: 未割当");
  await expect(editor).toContainText("場所: 場所未解決");
  await expect(editor).toContainText("異なる位置の番号セルが2件");
  await expect(editor).toContainText("マップ「1日目マップ」");
  await expect(editor).toContainText("ブロック定義を確認してください");
  await editor.getByRole("button", { name: "キャンセル", exact: true }).click();
  expect(await stored(page, "eventLists")).toEqual(before);
  await page.reload();
  await expect(
    page.locator('input[aria-label="バックアップファイルを選択"]'),
  ).toBeAttached();
  await page.getByText(eventName, { exact: true }).click();
  await editMemo(page, "ユーザー登録");
  await expect(
    page.getByRole("dialog", { name: "アイテム編集" }),
  ).toContainText("異なる位置の番号セルが2件");
});

test("block definition waits for renewed approval after another tab changes priority", async ({
  page,
  context,
}) => {
  await restore(page, mapBackup());
  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  await page.getByTitle("リスト表示に切り替え", { exact: true }).hover();
  await page.mouse.down();
  const blocks = page.getByRole("button", {
    name: "🔲 ブロック定義",
    exact: true,
  });
  await expect(blocks).toBeVisible();
  await page.mouse.up();
  await blocks.click();
  await page.getByRole("button", { name: /A.*2セル/ }).click();
  await page.getByPlaceholder("例: ア, め, N").fill("Ａ");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "適用", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "所属・配置の変更を確認",
  });
  await expect(confirmation).toBeVisible();
  const other = await context.newPage();
  await other.goto("/");
  await other.getByText(eventName, { exact: true }).click();
  await editMemo(other, "ユーザー登録");
  await other
    .getByRole("combobox", { name: "優先度", exact: true })
    .selectOption("highest");
  await other.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(() => stored(page, "eventLists"))
    .toMatchObject({
      [eventName]: expect.arrayContaining([
        expect.objectContaining({ id: "1", priorityLevel: "highest" }),
      ]),
    });
  await confirmation.getByRole("button", { name: "確認して保存" }).click();
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("最優先");
  const mapStorageKey = `mapData:${JSON.stringify([eventName, "1日目マップ"])}`;
  expect(await stored(page, "mapData", mapStorageKey)).toMatchObject({
    blocks: [expect.objectContaining({ name: "A" })],
  });
  await confirmation.getByRole("button", { name: "確認して保存" }).click();
  await expect(confirmation).toBeHidden();
  await expect
    .poll(() => stored(page, "mapData", mapStorageKey))
    .toMatchObject({
      blocks: [expect.objectContaining({ name: "Ａ" })],
    });
  expect(await stored(page, "eventLists")).toMatchObject({
    [eventName]: expect.arrayContaining([
      expect.objectContaining({ id: "1", priorityLevel: "highest" }),
    ]),
  });
  await other.close();
});

async function updatePurchaseInOtherTab(page: Page) {
  await page.goto("/");
  await page.getByText(eventName, { exact: true }).click();
  await editMemo(page, "新しいメモ");
  const dialog = page.getByRole("dialog", { name: "アイテム編集" });
  await dialog
    .getByRole("textbox", { name: "購入金額", exact: true })
    .fill("900");
  await dialog
    .getByRole("combobox", { name: "数量", exact: true })
    .selectOption("2");
  await dialog
    .getByRole("combobox", { name: "購入状態", exact: true })
    .selectOption("Purchased");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(() => stored(page, "eventLists"))
    .toMatchObject({
      [eventName]: expect.arrayContaining([
        expect.objectContaining({
          id: "1",
          purchaseStatus: "Purchased",
          price: 900,
          quantity: 2,
          remarks: "新しいメモ",
        }),
      ]),
    });
}

for (const origin of ["visit panel", "map item edit"] as const) {
  test(`${origin} priority change preserves newer purchases after saving and reload`, async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const source = mapBackup();
    source.data.eventLists[eventName] = source.data.eventLists[eventName].map(
      (value) => ({ ...value, priorityLevel: "none" }),
    );
    await restore(page, source);
    await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
    if (origin === "visit panel") {
      await page.getByTitle("リスト表示に切り替え", { exact: true }).hover();
      await page.mouse.down();
      const openPanel = page.getByRole("button", {
        name: "📍 訪問リスト",
        exact: true,
      });
      await expect(openPanel).toBeVisible();
      await page.mouse.up();
      await openPanel.click();
    } else {
      // At 100% zoom and the initial zero offset, A-1 is row 2 / column 2.
      await page.locator("canvas").click({ position: { x: 42, y: 42 } });
      const popup = page.getByRole("dialog", { name: "A-1のアイテム一覧" });
      await expect(popup).toBeVisible();
      const card = popup
        .getByText("サークル1", { exact: true })
        .locator('xpath=ancestor::div[contains(@class,"cursor-pointer")][1]');
      await card.dispatchEvent("pointerdown", {
        button: 0,
        isPrimary: true,
        pointerType: "mouse",
      });
      await expect(
        page.getByRole("button", { name: "✏️ 編集", exact: true }),
      ).toBeVisible();
      await card.dispatchEvent("pointerup", {
        button: 0,
        isPrimary: true,
        pointerType: "mouse",
      });
      await page.getByRole("button", { name: "✏️ 編集", exact: true }).click();
    }
    const other = await context.newPage();
    await updatePurchaseInOtherTab(other);
    if (origin === "visit panel") {
      await page.getByTitle("優先度を変更", { exact: true }).first().click();
      await page.getByRole("button", { name: "最優先", exact: true }).click();
    } else {
      const editor = page.getByRole("dialog", { name: "アイテム編集" });
      await editor
        .getByRole("combobox", { name: "優先度", exact: true })
        .selectOption("highest");
      await editor.getByRole("button", { name: "保存", exact: true }).click();
    }
    const preserved = {
      id: "1",
      purchaseStatus: "Purchased",
      price: 900,
      quantity: 2,
      remarks: "新しいメモ",
      priorityLevel: "highest",
    };
    await expect
      .poll(() => stored(page, "eventLists"))
      .toMatchObject({
        [eventName]: expect.arrayContaining([
          expect.objectContaining(preserved),
        ]),
      });
    await page.reload();
    await expect(
      page.locator('input[aria-label="バックアップファイルを選択"]'),
    ).toBeAttached();
    await page.getByText(eventName, { exact: true }).click();
    await editMemo(page, "新しいメモ");
    const editor = page.getByRole("dialog", { name: "アイテム編集" });
    await expect(
      editor.getByRole("textbox", { name: "購入金額", exact: true }),
    ).toHaveValue("900");
    await expect(
      editor.getByRole("combobox", { name: "数量", exact: true }),
    ).toHaveValue("2");
    await expect(
      editor.getByRole("combobox", { name: "購入状態", exact: true }),
    ).toHaveValue("Purchased");
    await expect(
      editor.getByRole("combobox", { name: "優先度", exact: true }),
    ).toHaveValue("highest");
    await editor
      .getByRole("button", { name: "キャンセル", exact: true })
      .click();
    expect(await stored(page, "eventLists")).toMatchObject({
      [eventName]: expect.arrayContaining([expect.objectContaining(preserved)]),
    });
    expect(errors).toEqual([]);
    await other.close();
  });
}

async function openMapItemEditor(page: Page) {
  await page.locator("canvas").click({ position: { x: 42, y: 42 } });
  const popup = page.getByRole("dialog", { name: "A-1のアイテム一覧" });
  await expect(popup).toBeVisible();
  const card = popup
    .getByText("サークル1", { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"cursor-pointer")][1]');
  await card.dispatchEvent("pointerdown", {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
  });
  await expect(
    page.getByRole("button", { name: "✏️ 編集", exact: true }),
  ).toBeVisible();
  await card.dispatchEvent("pointerup", {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
  });
  await page.getByRole("button", { name: "✏️ 編集", exact: true }).click();
  return page.getByRole("dialog", { name: "アイテム編集" });
}

for (const origin of ["visit panel", "map item edit"] as const) {
  test(`${origin} priority change retains the purchase accepted while its save is pending`, async ({
    page,
  }) => {
    const source = mapBackup();
    source.data.eventLists[eventName] = source.data.eventLists[eventName].map(
      (value) => ({ ...value, priorityLevel: "none" }),
    );
    await restore(page, source);
    await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
    const editor = await openMapItemEditor(page);
    await editor
      .getByRole("textbox", { name: "直接入力", exact: true })
      .fill("900");
    await editor
      .getByRole("combobox", { name: "数量", exact: true })
      .selectOption("2");
    await editor
      .getByRole("combobox", { name: "購入状態", exact: true })
      .selectOption("Purchased");
    await editor
      .getByRole("textbox", { name: "利用者メモ", exact: true })
      .fill("新しいメモ");
    // Delay delivery of the first atomic transaction's completion so the screen
    // still contains its previous values when the priority intent is accepted.
    await persistenceRealm(page).evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(
        IDBTransaction.prototype,
        "oncomplete",
      )!;
      const gate = { ready: false, release: () => {} };
      (
        globalThis as typeof globalThis & {
          __consistencyWriteGate: typeof gate;
        }
      ).__consistencyWriteGate = gate;
      let intercepted = false;
      Object.defineProperty(IDBTransaction.prototype, "oncomplete", {
        ...descriptor,
        set(this: IDBTransaction, handler: IDBTransaction["oncomplete"]) {
          if (
            !intercepted &&
            this.mode === "readwrite" &&
            this.objectStoreNames.contains("eventLists")
          ) {
            intercepted = true;
            descriptor.set!.call(this, (event: Event) => {
              gate.ready = true;
              gate.release = () => {
                Object.defineProperty(
                  IDBTransaction.prototype,
                  "oncomplete",
                  descriptor,
                );
                handler?.call(this, event);
              };
            });
          } else descriptor.set!.call(this, handler);
        },
      });
    });
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect
      .poll(() =>
        persistenceRealm(page).evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __consistencyWriteGate: { ready: boolean };
              }
            ).__consistencyWriteGate.ready,
        ),
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "A-1のアイテム一覧を閉じる", exact: true })
      .click();
    if (origin === "visit panel") {
      await page.getByTitle("リスト表示に切り替え", { exact: true }).hover();
      await page.mouse.down();
      const openPanel = page.getByRole("button", {
        name: "📍 訪問リスト",
        exact: true,
      });
      await expect(openPanel).toBeVisible();
      await page.mouse.up();
      await openPanel.click();
      await page.getByTitle("優先度を変更", { exact: true }).first().click();
      await page.getByRole("button", { name: "最優先", exact: true }).click();
    } else {
      const priorityEditor = await openMapItemEditor(page);
      await priorityEditor
        .getByRole("combobox", { name: "優先度", exact: true })
        .selectOption("highest");
      await priorityEditor
        .getByRole("button", { name: "保存", exact: true })
        .click();
    }
    await persistenceRealm(page).evaluate(() =>
      (
        globalThis as typeof globalThis & {
          __consistencyWriteGate: { release(): void };
        }
      ).__consistencyWriteGate.release(),
    );
    const preserved = {
      id: "1",
      purchaseStatus: "Purchased",
      price: 900,
      quantity: 2,
      remarks: "新しいメモ",
      priorityLevel: "highest",
    };
    await expect
      .poll(() => stored(page, "eventLists"))
      .toMatchObject({
        [eventName]: expect.arrayContaining([
          expect.objectContaining(preserved),
        ]),
      });
    await page.reload();
    await expect(
      page.locator('input[aria-label="バックアップファイルを選択"]'),
    ).toBeAttached();
    expect(await stored(page, "eventLists")).toMatchObject({
      [eventName]: expect.arrayContaining([expect.objectContaining(preserved)]),
    });
  });
}

for (const kind of ["detailed", "simple"] as const) {
  test(`renaming a ${kind} hall preserves mixed order in every map and after reload`, async ({
    page,
  }) => {
    const source = migrateLegacyConsistency(mapBackup().data).data;
    source.hallDefinitions[eventName]["__mapless__:1日目"] = [
      {
        id: "simple",
        name: "簡易ホール",
        vertices: [],
        blockNames: ["A"],
      },
    ];
    const simpleRef = {
      kind: "simple" as const,
      dayKey: "1日目",
      hallId: "simple",
    };
    for (const [mapKey, context] of Object.entries(
      source.eventConsistency[eventName].days["1日目"].maps,
    )) {
      const mapRef = { kind: "map" as const, mapKey, hallId: "hall" };
      context.assignments = { "1": simpleRef, "2": mapRef };
      context.hallOrder = [
        { hall: simpleRef, priority: "none" },
        { hall: mapRef, priority: "none" },
        { hall: null, priority: "highest" },
      ];
      context.hallVisitLists = [
        { group: context.hallOrder[0], itemIds: ["1"] },
        { group: context.hallOrder[1], itemIds: ["2"] },
      ];
    }
    await loadSavedSnapshot(page, source);
    await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
    await page.getByTitle("リスト表示に切り替え", { exact: true }).hover();
    await page.mouse.down();
    const openHalls = page.getByRole("button", {
      name: "🏛️ ホール定義",
      exact: true,
    });
    await expect(openHalls).toBeVisible();
    await page.mouse.up();
    await openHalls.click();
    const editor = page.getByRole("dialog", { name: "ホール定義エリア設定" });
    await editor
      .getByRole("button")
      .filter({ hasText: kind === "detailed" ? "東館" : "簡易ホール" })
      .click();
    await editor.getByPlaceholder("例: 東1ホール").fill("変更後のホール名");
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await editor.getByRole("button", { name: "適用", exact: true }).click();
    const confirm = page.getByRole("button", {
      name: "確認して保存",
      exact: true,
    });
    await expect(confirm).toBeVisible();
    await confirm.click();
    const key = kind === "detailed" ? "1日目マップ" : "__mapless__:1日目";
    await expect
      .poll(() => stored(page, "hallDefinitions"))
      .toMatchObject({
        [eventName]: {
          [key]: [expect.objectContaining({ name: "変更後のホール名" })],
        },
      });
    const check = async () => {
      const saved = (await stored(
        page,
        "eventConsistency",
      )) as EventConsistencyStore;
      for (const [mapKey, context] of Object.entries(
        source.eventConsistency[eventName].days["1日目"].maps,
      )) {
        expect(saved[eventName].days["1日目"].maps[mapKey].hallOrder).toEqual(
          context.hallOrder,
        );
        expect(
          saved[eventName].days["1日目"].maps[mapKey].hallVisitLists,
        ).toEqual(context.hallVisitLists);
      }
      expect(saved[eventName].days["2日目"]).toEqual(
        source.eventConsistency[eventName].days["2日目"],
      );
    };
    await check();
    await page.reload();
    await expect(
      page.locator('input[aria-label="バックアップファイルを選択"]'),
    ).toBeAttached();
    await check();
  });
}

test.describe("spreadsheet and save-conflict connections", () => {
  test.use({ serviceWorkers: "block" });
  for (const kind of ["items-only", "source-switch"] as const) {
    test(`spreadsheet ${kind} opens review after CSV success and persists the reviewed update`, async ({
      page,
    }) => {
      const source = backup([item("1")]);
      Object.assign(source.data.eventLists[eventName][0], {
        source: "spreadsheet",
      });
      const metadata = {
        spreadsheetUrl:
          "https://docs.google.com/spreadsheets/d/consistency-source",
        spreadsheetSheetName: "一覧",
        lastImportDate: "2026-10-04",
      };
      if (kind === "items-only")
        Object.assign(source.data.eventMetadata, { [eventName]: metadata });
      const cells = Array<string>(27).fill("");
      cells[12] = "サークル1";
      cells[13] = "1日目";
      cells[14] = "A";
      cells[15] = "1";
      cells[16] = "新刊1";
      cells[17] = "800";
      cells[22] = "更新後のシート備考";
      cells[26] = "1";
      await page.route("**/api/google-sheets-csv", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/csv; charset=utf-8",
          body: `${Array<string>(27).fill("header").join(",")}\n${cells.join(",")}\n`,
        }),
      );
      await restore(page, source);
      await page.reload();
      await page.getByRole("button", { name: "メニュー", exact: true }).click();
      await page
        .getByRole("button", { name: "🔄 アイテム更新", exact: true })
        .click();
      if (kind === "source-switch") {
        await page
          .getByRole("textbox", { name: "スプレッドシートURL", exact: true })
          .fill(metadata.spreadsheetUrl);
        await page
          .getByRole("textbox", { name: "シート名（オプション）", exact: true })
          .fill(metadata.spreadsheetSheetName);
        await page.getByRole("button", { name: "更新", exact: true }).click();
      }
      const heading = page.getByRole("heading", {
        name: "アイテム更新の確認",
        exact: true,
      });
      await expect(heading).toBeVisible();
      expect(await stored(page, "eventLists")).toMatchObject({
        [eventName]: [expect.objectContaining({ price: 500 })],
      });
      await page
        .getByRole("button", {
          name: kind === "items-only" ? "更新を実行" : "更新元を切り替えて更新",
          exact: true,
        })
        .click();
      await expect(heading).toBeHidden();
      await expect
        .poll(() => stored(page, "eventLists"))
        .toMatchObject({
          [eventName]: [
            expect.objectContaining({
              catalogPrice: 800,
              sheetRemarks: "更新後のシート備考",
            }),
          ],
        });
      expect(await stored(page, "eventMetadata")).toMatchObject({
        [eventName]: {
          spreadsheetUrl: metadata.spreadsheetUrl,
          spreadsheetSheetName: "一覧",
        },
      });
      await page.reload();
      expect(await stored(page, "eventLists")).toMatchObject({
        [eventName]: [
          expect.objectContaining({
            catalogPrice: 800,
            sheetRemarks: "更新後のシート備考",
          }),
        ],
      });
    });
  }

  async function forceThreeSnapshotConflicts(page: Page) {
    await persistenceRealm(page).evaluate(
      (metadataKey) => {
        const original = IDBObjectStore.prototype.get;
        let remaining = 3;
        const state = { count: 0 };
        Object.assign(globalThis, { __forcedConsistencyConflicts: state });
        IDBObjectStore.prototype.get = function (key) {
          const request = original.call(this, key);
          if (
            remaining > 0 &&
            this.name === "syncQueue" &&
            key === metadataKey &&
            this.transaction.mode === "readwrite" &&
            this.transaction.objectStoreNames.contains("eventConsistency")
          ) {
            remaining--;
            request.addEventListener(
              "success",
              () => {
                // Both whole snapshots and cached day commands CAS against this revision.
                // Change only the observation; no corrupt value is written to IndexedDB.
                const value = {
                  ...request.result,
                  revision: request.result.revision + 1,
                };
                state.count++;
                Object.defineProperty(request, "result", { value });
              },
              { once: true },
            );
            if (remaining === 0) IDBObjectStore.prototype.get = original;
          }
          return request;
        };
      },
      createPersistenceMetadataKey("eventLists", "data"),
    );
  }
  async function forceSnapshotAbort(page: Page) {
    await persistenceRealm(page).evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      const state = { count: 0 };
      Object.assign(globalThis, { __forcedConsistencyConflicts: state });
      IDBObjectStore.prototype.put = function (
        ...args: Parameters<typeof original>
      ) {
        if (
          this.transaction.mode === "readwrite" &&
          this.transaction.objectStoreNames.contains("eventConsistency")
        ) {
          state.count++;
          IDBObjectStore.prototype.put = original;
          throw new DOMException("購入記録の書き込み失敗", "AbortError");
        }
        return original.apply(this, args);
      };
    });
  }

  for (const failure of ["cancel", "abort"] as const) {
    test(
      "confirming a long press preserves the target mode when source-day merge " +
        failure +
        " occurs",
      async ({ page }) => {
        await restore(page, mapBackup());
        await reorderVisitList(page);
        await addDurableDuplicateMode(page);
        const beforeExecute = await stored(page, "executeModeItems");
        const beforeModes = await stored(page, "dayModes");
        const beforeConsistency = await stored(page, "eventConsistency");
        await page.getByRole("button", { name: /^2日目/ }).hover();
        await page.mouse.down();
        const transition = page.getByRole("heading", {
          name: "変更を保存しますか？",
        });
        await expect(transition).toBeVisible();
        await page.mouse.up();
        await page
          .getByRole("button", { name: "保存して確定", exact: true })
          .click();
        const review = page.getByRole("dialog", {
          name: /1日目 の保存先を統合/,
        });
        await expect(review).toBeVisible();
        expect(await stored(page, "dayModes")).toEqual(beforeModes);
        if (failure === "cancel") {
          await review
            .getByRole("button", { name: "取消", exact: true })
            .click();
          await expect(review).toBeHidden();
        } else {
          await forceSnapshotAbort(page);
          await review
            .getByRole("button", { name: "確認して保存", exact: true })
            .click();
          await expect(
            page
              .getByRole("alert")
              .filter({ hasText: "購入記録の書き込み失敗" }),
          ).toBeVisible();
        }
        expect(await stored(page, "dayModes")).toEqual(beforeModes);
        expect(await stored(page, "executeModeItems")).toEqual(beforeExecute);
        expect(await stored(page, "eventConsistency")).toEqual(
          beforeConsistency,
        );
        await expect(transition).toBeVisible();
        await expect(page.locator("[data-drag-item]")).toHaveCount(2);
        await expect(
          page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }),
        ).toBeEnabled();
        await page.reload();
        await expect(
          page.locator('input[aria-label="バックアップファイルを選択"]'),
        ).toBeAttached();
        expect(await stored(page, "dayModes")).toEqual(beforeModes);
        expect(await stored(page, "executeModeItems")).toEqual(beforeExecute);
      },
    );
  }

  for (const failure of ["abort", "conflicts"] as const) {
    for (const action of ["retry", "discard"] as const) {
      for (const operation of ["settings", "reorder"] as const) {
        test(`failed hall-order save keeps DB, screen and JSON unchanged: ${failure}, ${action}, ${operation}`, async ({
          page,
        }) => {
          const source = mapBackup();
          source.data.dayModes[eventName]["1日目"] = "execute";
          for (const mapKey of ["1日目マップ", "１日目マップ"] as const) {
            source.data.hallDefinitions[eventName][mapKey] = [
              {
                id: "A",
                name: "ホールA",
                vertices: [
                  { row: 1, col: 1 },
                  { row: 1, col: 5 },
                  { row: 2, col: 5 },
                  { row: 2, col: 1 },
                ],
              },
              {
                id: "B",
                name: "ホールB",
                vertices: [
                  { row: 3, col: 1 },
                  { row: 3, col: 5 },
                  { row: 5, col: 5 },
                  { row: 5, col: 1 },
                ],
              },
            ];
            source.data.hallRouteSettings[eventName][mapKey] = {
              hallOrder: ["A", "B"],
              hallVisitLists: [
                { hallId: "A", itemIds: ["1"] },
                { hallId: "B", itemIds: ["2"] },
              ],
            };
          }
          await restore(page, source);
          const beforeConsistency = await stored(page, "eventConsistency");
          const beforeItems = await stored(page, "eventLists");
          await page
            .getByTitle("マップ表示に切り替え", { exact: true })
            .click();
          await page.getByTitle("ホール順を編集", { exact: true }).click();
          const order = page.getByRole("dialog", { name: "ホール間移動順序" });
          await expect(
            order.locator(".font-medium").filter({ hasText: /^ホール[AB]$/ }),
          ).toHaveText(["ホールA", "ホールB"]);
          await order
            .getByRole("button", { name: "▼", exact: true })
            .first()
            .click();
          if (failure === "conflicts") await forceThreeSnapshotConflicts(page);
          else await forceSnapshotAbort(page);
          if (operation === "settings")
            await order
              .getByRole("button", { name: "保存", exact: true })
              .click();
          else {
            await order
              .getByRole("button", { name: "🔄 実行列を並び替え", exact: true })
              .click();
            await order
              .getByRole("button", { name: "ホール間移動順序を閉じる" })
              .click();
          }
          const pending = page.getByRole("alert").filter({
            hasText: "件の操作を未保存のまま保留しています",
          });
          await expect(pending).toBeVisible();
          await expect(order).toBeHidden();
          expect(await stored(page, "executeModeItems")).toMatchObject({
            [eventName]: { "1日目": ["1", "2"], "2日目": ["3"] },
          });
          expect(await stored(page, "eventConsistency")).toEqual(
            beforeConsistency,
          );
          const downloading = page.waitForEvent("download");
          await pending
            .getByRole("button", {
              name: "JSONバックアップを保存",
              exact: true,
            })
            .click();
          const stream = await (await downloading).createReadStream();
          const chunks: Buffer[] = [];
          for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
          const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          expect(exported.data.executeModeItems[eventName]["1日目"]).toEqual([
            "1",
            "2",
          ]);
          expect(exported.data.eventConsistency).toEqual(beforeConsistency);
          await page.getByTitle("ホール順を編集", { exact: true }).click();
          await expect(
            order.locator(".font-medium").filter({ hasText: /^ホール[AB]$/ }),
          ).toHaveText(["ホールA", "ホールB"]);
          await order
            .getByRole("button", { name: "ホール間移動順序を閉じる" })
            .click();
          await page
            .getByTitle("リスト表示に切り替え", { exact: true })
            .click();
          await expect(page.locator("[data-item-id]")).toHaveCount(2);
          expect(
            await page
              .locator("[data-item-id]")
              .evaluateAll((rows) =>
                rows.map((row) => row.getAttribute("data-item-id")),
              ),
          ).toEqual(["1", "2"]);
          await pending
            .getByRole("button", {
              name:
                action === "retry"
                  ? "保留中の保存を再試行"
                  : "保留中の操作を取り消す",
              exact: true,
            })
            .click();
          await expect
            .poll(async () => {
              const snapshot = (await stored(
                page,
                "eventConsistency",
              )) as EventConsistencyStore;
              return snapshot[eventName].days["1日目"].maps[
                "1日目マップ"
              ].hallOrder.map((group) => group.hall?.hallId);
            })
            .toEqual(action === "retry" ? ["B", "A"] : ["A", "B"]);
          await expect(pending).toBeHidden();
          const expected =
            action === "retry" && operation === "reorder"
              ? ["2", "1"]
              : ["1", "2"];
          const consistency = (await stored(
            page,
            "eventConsistency",
          )) as EventConsistencyStore;
          const before = beforeConsistency as EventConsistencyStore;
          expect(
            consistency[eventName].days["1日目"].maps[
              "1日目マップ"
            ].hallOrder.map((group) => group.hall?.hallId),
          ).toEqual(action === "retry" ? ["B", "A"] : ["A", "B"]);
          expect(
            consistency[eventName].days["1日目"].maps["１日目マップ"],
          ).toEqual(before[eventName].days["1日目"].maps["１日目マップ"]);
          expect(consistency[eventName].days["2日目"]).toEqual(
            before[eventName].days["2日目"],
          );
          expect(await stored(page, "executeModeItems")).toMatchObject({
            [eventName]: { "1日目": expected, "2日目": ["3"] },
          });
          expect(await stored(page, "eventLists")).toEqual(beforeItems);
          await page.reload();
          await expect(
            page.locator('input[aria-label="バックアップファイルを選択"]'),
          ).toBeAttached();
          expect(await stored(page, "executeModeItems")).toMatchObject({
            [eventName]: { "1日目": expected },
          });
        });
      }
    }
  }

  test("failed visit discard keeps event navigation, undo history and cancel baseline pending", async ({
    page,
  }) => {
    await restore(page, mapBackup());
    await reorderVisitList(page);
    await page
      .getByRole("button", { name: "イベント一覧", exact: true })
      .click();
    const confirm = page.getByRole("heading", { name: "変更を保存しますか？" });
    await expect(confirm).toBeVisible();
    await forceSnapshotAbort(page);
    await page
      .getByRole("button", { name: "キャンセル（破棄）", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "購入記録の書き込み失敗" }),
    ).toBeVisible();
    await expect(confirm).toBeVisible();
    await expect(
      page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }),
    ).toBeEnabled();
    expect(await stored(page, "executeModeItems")).toMatchObject({
      [eventName]: { "1日目": ["2", "1"] },
    });
    await page
      .getByRole("button", { name: "キャンセル（破棄）", exact: true })
      .click();
    await expect(confirm).toBeHidden();
    await expect(page.locator("[data-drag-item]")).toHaveCount(0);
    expect(await stored(page, "executeModeItems")).toMatchObject({
      [eventName]: { "1日目": ["1", "2"], "2日目": ["3"] },
    });
  });
  for (const [failure, action] of [
    ["conflicts", "retry"],
    ["conflicts", "discard"],
    ["abort", "retry"],
    ["abort", "discard"],
  ] as const) {
    test(`save ${failure} retains accepted purchase, JSON backup and explicit ${action}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await restore(page, backup([item("1")]));
      const before = await stored(page, "eventLists");
      await editMemo(page, "競合中の購入メモ");
      const editor = page.getByRole("dialog", { name: "アイテム編集" });
      await editor
        .getByRole("textbox", { name: "購入金額", exact: true })
        .fill("900");
      await editor
        .getByRole("combobox", { name: "数量", exact: true })
        .selectOption("2");
      await editor
        .getByRole("combobox", { name: "購入状態", exact: true })
        .selectOption("Purchased");
      if (failure === "conflicts") await forceThreeSnapshotConflicts(page);
      else await forceSnapshotAbort(page);
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await expect(editor).toBeVisible();
      const conflict = page
        .getByRole("alert")
        .filter({ hasText: "件の操作を未保存のまま保留しています" });
      await expect(conflict).toBeVisible();
      expect(await stored(page, "eventLists")).toEqual(before);
      expect(
        await persistenceRealm(page).evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __forcedConsistencyConflicts: { count: number };
              }
            ).__forcedConsistencyConflicts.count,
        ),
      ).toBe(failure === "conflicts" ? 3 : 1);
      const downloading = page.waitForEvent("download");
      await conflict
        .getByRole("button", { name: "JSONバックアップを保存", exact: true })
        .click();
      const download = await downloading;
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
      const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const purchased = {
        purchaseStatus: "Purchased",
        price: 900,
        quantity: 2,
        remarks: "競合中の購入メモ",
      };
      expect(exported.data.eventLists[eventName][0]).toMatchObject(purchased);
      await expect(
        editor.getByRole("textbox", { name: "購入金額", exact: true }),
      ).toHaveValue("900");
      await expect(
        editor.getByRole("combobox", { name: "数量", exact: true }),
      ).toHaveValue("2");
      await expect(
        editor.getByRole("combobox", { name: "購入状態", exact: true }),
      ).toHaveValue("Purchased");
      if (action === "retry") {
        await conflict
          .getByRole("button", { name: "保留中の保存を再試行", exact: true })
          .click();
        await expect
          .poll(() => stored(page, "eventLists"))
          .toMatchObject({ [eventName]: [expect.objectContaining(purchased)] });
      } else {
        await conflict
          .getByRole("button", { name: "保留中の操作を取り消す", exact: true })
          .click();
        expect(await stored(page, "eventLists")).toEqual(before);
        await editor
          .getByRole("button", { name: "キャンセル", exact: true })
          .click();
      }
      await expect(editor).toBeHidden();
      await expect(conflict).toBeHidden();
      await page.reload();
      await expect(
        page.locator('input[aria-label="バックアップファイルを選択"]'),
      ).toBeAttached();
      if (action === "retry") {
        expect(await stored(page, "eventLists")).toMatchObject({
          [eventName]: [expect.objectContaining(purchased)],
        });
      } else {
        expect(await stored(page, "eventLists")).toEqual(before);
      }
      expect(errors).toEqual([]);
    });
  }

  for (const operation of ["rename", "restore"] as const) {
    test(`failed purchase survives a subsequent ${operation} and its current values are confirmed`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const source = backup([item("1")]);
      await restore(page, source);
      const before = await stored(page, "eventLists");
      const row = page.locator('[data-item-id="1"]');
      const pending = page
        .getByRole("alert")
        .filter({ hasText: "件の操作を未保存のまま保留しています" });
      await forceSnapshotAbort(page);
      await row
        .getByRole("combobox", { name: "購入金額", exact: true })
        .selectOption("900");
      await expect(pending).toContainText("1件の操作");
      await row
        .getByRole("combobox", { name: "購入予定数量", exact: true })
        .selectOption("2");
      await expect(pending).toContainText("2件の操作");
      await row
        .getByRole("button", {
          name: "Current status: 未購入. Click to change.",
          exact: true,
        })
        .click();
      await expect(pending).toContainText("3件の操作");
      const renamed = eventName + "改名後";
      const openOperation = async () => {
        if (operation === "rename") {
          await page
            .getByRole("button", { name: "イベント一覧", exact: true })
            .click();
          await page
            .getByRole("button", { name: "メニュー", exact: true })
            .click();
          await page.getByRole("button", { name: /名称変更/ }).click();
          await page.getByLabel("新しい即売会名").fill(renamed);
          await page.getByRole("button", { name: "変更", exact: true }).click();
        } else {
          await page
            .locator('input[aria-label="バックアップファイルを選択"]')
            .setInputFiles({
              name: "pending-restore.json",
              mimeType: "application/json",
              buffer: Buffer.from(JSON.stringify(source), "utf8"),
            });
          const outer = page.getByRole("dialog", {
            name: "バックアップからイベントを復元",
          });
          await outer.getByRole("radio", { name: /同名で置換/ }).check();
          await outer
            .getByRole("button", { name: "置換して復元", exact: true })
            .click();
        }
      };
      await openOperation();
      const review = page.getByRole("dialog", {
        name:
          operation === "rename"
            ? "イベント名を変更"
            : `「${eventName}」の復元内容を確認`,
      });
      await expect(review).toBeVisible();
      if (operation === "restore") {
        await expect(review).toContainText('"purchaseStatus": "Purchased"');
        await expect(review).toContainText('"price": 900');
        await expect(review).toContainText('"quantity": 2');
        await expect(review).toContainText("ユーザー登録");
      }
      await review
        .getByRole("button", { name: "確認して保存", exact: true })
        .click();
      await expect(review).toBeHidden();
      await expect(pending).toContainText("3件の操作");
      expect(await stored(page, "eventLists")).toEqual(before);
      if (operation === "restore") {
        await page
          .getByRole("dialog", { name: "バックアップからイベントを復元" })
          .getByRole("button", { name: "キャンセル", exact: true })
          .click();
      } else {
        await page
          .getByRole("button", { name: "キャンセル", exact: true })
          .click();
      }
      const downloading = page.waitForEvent("download");
      await pending
        .getByRole("button", { name: "JSONバックアップを保存", exact: true })
        .click();
      const download = await downloading;
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
      const purchased = {
        purchaseStatus: "Purchased",
        price: 900,
        quantity: 2,
        remarks: "ユーザー登録",
      };
      expect(
        JSON.parse(Buffer.concat(chunks).toString("utf8")).data.eventLists[
          eventName
        ][0],
      ).toMatchObject(purchased);
      await pending
        .getByRole("button", { name: "保留中の保存を再試行", exact: true })
        .click();
      await expect(pending).toBeHidden();
      await expect
        .poll(() => stored(page, "eventLists"))
        .toMatchObject({
          [eventName]: [expect.objectContaining(purchased)],
        });
      if (operation === "rename") {
        // The first attempt left us on the event list.
        await page
          .getByRole("button", { name: "メニュー", exact: true })
          .click();
        await page.getByRole("button", { name: /名称変更/ }).click();
        await page.getByLabel("新しい即売会名").fill(renamed);
        await page.getByRole("button", { name: "変更", exact: true }).click();
      } else await openOperation();
      await expect(review).toBeVisible();
      await review
        .getByRole("button", { name: "確認して保存", exact: true })
        .click();
      await expect(review).toBeHidden();
      await expect
        .poll(() => stored(page, "eventLists"))
        .toMatchObject(
          operation === "rename"
            ? { [renamed]: [expect.objectContaining(purchased)] }
            : before,
        );
      await page.reload();
      await expect(
        page.locator('input[aria-label="バックアップファイルを選択"]'),
      ).toBeAttached();
      expect(await stored(page, "eventLists")).toMatchObject(
        operation === "rename"
          ? { [renamed]: [expect.objectContaining(purchased)] }
          : before,
      );
      expect(errors).toEqual([]);
    });
  }
});

test("day merge choices change the adopted order, mode, map and destination and survive reload", async ({
  page,
}) => {
  const source = migrateLegacyConsistency(mapBackup().data).data;
  const days = source.eventConsistency[eventName].days;
  const originalDay = structuredClone(days["1日目"]);
  originalDay.selectedMapKey = "1日目マップ";
  days["1日目"] = originalDay;
  days[" 1日目　"] = {
    ...structuredClone(originalDay),
    selectedMapKey: "１日目マップ",
  };
  source.executeModeItems[eventName][" 1日目　"] = ["2", "1"];
  source.dayModes[eventName][" 1日目　"] = "execute";
  await loadSavedSnapshot(page, source);
  const beforeItems = await stored(page, "eventLists");
  const review = page.getByRole("button", {
    name: "統合内容を確認",
    exact: true,
  });
  await review.click();
  const dialog = page.getByRole("dialog", { name: /1日目 の保存先を統合/ });
  const select = async (name: string | RegExp, value: string) => {
    const selector = dialog.getByRole("combobox", { name });
    await selector.selectOption(value);
    await expect(selector).toHaveValue(value);
  };
  await select("統合先の日付表記", " 1日目　");
  await select(/実行列の順序/, " 1日目　");
  await select("統合後の表示モード", "execute");
  await select("統合後の利用マップ", JSON.stringify("１日目マップ"));
  expect(await stored(page, "executeModeItems")).toEqual(
    source.executeModeItems,
  );
  expect(await stored(page, "eventLists")).toEqual(beforeItems);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(await stored(page, "executeModeItems")).toEqual(
    source.executeModeItems,
  );
  await review.click();
  await select("統合先の日付表記", " 1日目　");
  await select(/実行列の順序/, " 1日目　");
  await select("統合後の表示モード", "execute");
  await select("統合後の利用マップ", JSON.stringify("１日目マップ"));
  await dialog
    .getByRole("button", { name: "確認して保存", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  const check = async () => {
    expect(await stored(page, "executeModeItems")).toEqual({
      [eventName]: { " 1日目　": ["2", "1"], "2日目": ["3"] },
    });
    expect(await stored(page, "dayModes")).toEqual({
      [eventName]: { " 1日目　": "execute", "2日目": "edit" },
    });
    const merged = (await stored(
      page,
      "eventConsistency",
    )) as EventConsistencyStore;
    expect(Object.keys(merged[eventName].days)).not.toContain("1日目");
    expect(merged[eventName].days[" 1日目　"].selectedMapKey).toBe(
      "１日目マップ",
    );
    expect(await stored(page, "eventLists")).toEqual(beforeItems);
  };
  await check();
  await page.reload();
  await expect(
    page.locator('input[aria-label="バックアップファイルを選択"]'),
  ).toBeAttached();
  await check();
});

test("priority text inside a hall ID keeps the hall name in the map order dialog", async ({
  page,
}) => {
  const source = mapBackup();
  for (const halls of Object.values(source.data.hallDefinitions[eventName])) {
    halls[0].id = "west:priority";
    halls[0].name = "西館";
  }
  for (const settings of Object.values(
    source.data.hallRouteSettings[eventName],
  )) {
    settings.hallOrder = ["west:priority:priority"];
    settings.hallVisitLists[0].hallId = "west:priority:priority";
  }
  const data = migrateLegacyConsistency(source.data).data;
  for (const shoppingItem of data.eventLists[eventName])
    if ((shoppingItem as { eventDate: string }).eventDate === "1日目")
      Object.assign(shoppingItem, { priorityLevel: "priority" });
  await restore(page, createAppBackup(data));
  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  await page.getByTitle("ホール順を編集", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "ホール間移動順序" });
  await expect(dialog.getByText("西館優先", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("ホール未定義優先", { exact: true }),
  ).toHaveCount(0);
});

test("focus map shows mixed execution counts separately from candidates and the current marker", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const labels: string[] = [];
    Object.assign(globalThis, { __focusStatusLabels: labels });
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (
      ...args: Parameters<typeof original>
    ) {
      labels.push(args[0]);
      return original.apply(this, args);
    };
  });
  const source = mapBackup();
  source.data.eventLists[eventName] = [
    { ...item("1"), number: "2" },
    { ...item("2"), number: "01a", purchaseStatus: "Postpone" },
    { ...item("3"), number: "01b", purchaseStatus: "Late" },
    { ...item("4"), number: "01a" },
  ];
  source.data.executeModeItems[eventName] = {
    "1日目": ["1", "2", "3"],
    "2日目": [],
  };
  await restore(page, source);
  await page.getByRole("button", { name: "🏃‍♂️", exact: true }).click();
  await page.getByTitle("集中モード", { exact: true }).click();
  await expect(page.locator("#focus-mode-footer")).toBeVisible();
  await page.getByTitle("マップを表示", { exact: true }).click();
  const labels = () =>
    page.evaluate(
      () =>
        (globalThis as typeof globalThis & { __focusStatusLabels: string[] })
          .__focusStatusLabels,
    );
  await expect
    .poll(labels)
    .toEqual(expect.arrayContaining(["後1", "遅1", "候補1"]));
  expect(await labels()).not.toContain("済");
  const phase = page.getByLabel("phase", { exact: true });
  await page.evaluate(() => {
    (
      globalThis as typeof globalThis & { __focusStatusLabels: string[] }
    ).__focusStatusLabels.length = 0;
  });
  await phase.selectOption("postponed");
  const confirmation = page.getByRole("dialog", {
    name: "フェーズを切り替えますか？",
  });
  if (await confirmation.isVisible()) {
    await confirmation.getByRole("button", { name: /最初から開始/ }).click();
  }

  await expect
    .poll(labels)
    .toEqual(expect.arrayContaining(["後始", "後1", "遅1", "候補1"]));
});

test("a standalone execute reorder writes only its changed payload and survives reload", async ({
  page,
}) => {
  const source = migrateLegacyConsistency(
    backup([item("1"), item("2")]).data,
  ).data;
  // A standalone fixture has no saved visit lists or routes to reorder.
  // Legacy migration normally creates a visit context for these execution IDs.
  source.eventConsistency[eventName].days = {};
  await loadSavedSnapshot(page, source);
  await persistenceRealm(page).evaluate(() => {
    const writes: string[] = [];
    Object.assign(globalThis, { __reorderTransactions: writes });
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<typeof original>
    ) {
      if (args[1] === "data" && this.name !== "syncQueue")
        writes.push(this.name);
      return original.apply(this, args);
    };
  });
  const row = page.locator('[data-item-id="2"]');
  await row.getByTitle("上に移動", { exact: true }).click();
  await expect
    .poll(() => stored(page, "executeModeItems"))
    .toMatchObject({ [eventName]: { "1日目": ["2", "1"] } });
  const writes = await persistenceRealm(page).evaluate(
    () =>
      (globalThis as typeof globalThis & { __reorderTransactions: string[] })
        .__reorderTransactions,
  );
  expect(writes).toEqual(["executeModeItems"]);
  await page.reload();
  await expect(
    page.locator('input[aria-label="バックアップファイルを選択"]'),
  ).toBeAttached();
  expect(await stored(page, "executeModeItems")).toMatchObject({
    [eventName]: { "1日目": ["2", "1"] },
  });
});

test("full Excel keeps undated mapless legacy halls through Worker export and restore", async ({
  page,
}) => {
  const source = backup();
  source.data.hallDefinitions = {
    [eventName]: {
      __mapless__: [
        { id: "old", name: "旧簡易ホール", vertices: [], blockNames: ["A"] },
      ],
    },
  };
  await restore(page, source, `「${eventName}」の復元内容を確認`);
  const before = (await stored(
    page,
    "eventConsistency",
  )) as EventConsistencyStore;
  expect(before[eventName].legacyPending).toHaveLength(1);
  await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("button", { name: /Excel形式で出力/ }).click();
  await expect(
    page.getByRole("checkbox", {
      name: "配置情報（実行列・候補リストの順序）",
    }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "マップ・表示位置・ブロック検出設定" }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "ホール定義・所属・巡回設定" }),
  ).toBeChecked();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "エクスポート", exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Excel download stream is missing");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  await page.locator('input[aria-label="Excelファイルを選択"]').setInputFiles({
    name: "pending.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.concat(chunks),
  });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog
    .getByRole("button", { name: "置換して復元", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: `「${eventName}」の復元内容を確認`,
    exact: true,
  });
  await expect(review).toBeVisible();
  await review
    .getByRole("button", { name: "確認して保存", exact: true })
    .click();
  await expect(review).toBeHidden();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => stored(page, "eventConsistency"))
    .toMatchObject({
      [eventName]: { legacyPending: before[eventName].legacyPending },
    });
  await page.reload();
  await expect(
    page.locator('input[aria-label="バックアップファイルを選択"]'),
  ).toBeAttached();
  const after = (await stored(
    page,
    "eventConsistency",
  )) as EventConsistencyStore;
  expect(after[eventName].legacyPending).toEqual(
    before[eventName].legacyPending,
  );
});

test("map reimport saves the chosen actual map and displays it after reload", async ({
  page,
}) => {
  const source = mapBackup();
  for (const store of [
    source.data.mapData,
    source.data.hallDefinitions,
    source.data.hallRouteSettings,
  ]) {
    const values = store[eventName] as Record<string, unknown>;
    values["1 日目マップ"] = values["1日目マップ"];
    delete values["1日目マップ"];
  }
  await restore(page, source);
  const selector = page.getByRole("combobox", { name: "利用するマップ" });
  await expect(selector).toHaveValue("");
  const before = (await stored(
    page,
    "eventConsistency",
  )) as EventConsistencyStore;
  const mapsBefore = (await storedMaps(page)) as Record<
    string,
    Record<string, unknown>
  >;
  const itemsBefore = await stored(page, "eventLists");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("1日目");
  const border = { style: "medium" as const, color: { argb: "FFFF0000" } };
  sheet.getCell("A1").value = "A";
  sheet.getCell("A1").border = { top: border, bottom: border, left: border };
  sheet.getCell("B1").value = 1;
  sheet.getCell("B1").border = { top: border, bottom: border, right: border };
  for (let row = 2; row <= 40; row++)
    for (let col = 1; col <= 20; col++)
      sheet.getCell(row, col).value = `確認用セル ${row}:${col}`;
  await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /マップデータ取り込み/ }).click();
  await (
    await chooserPromise
  ).setFiles({
    name: "map.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  });
  await expect(
    page.getByRole("heading", { name: "📋 マップデータ取り込み" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取り込む", exact: true }).click();
  const targetDialog = page.getByRole("dialog", {
    name: "マップを入れ替える前の確認",
  });
  await expect(targetDialog).toBeVisible();
  await targetDialog
    .getByRole("combobox", { name: "1日目の更新先マップ" })
    .selectOption("1 日目マップ");
  await targetDialog
    .getByRole("button", { name: "影響範囲を確認する", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "マップ再取り込みの影響を確認",
  });
  await expect(confirmation).toBeVisible();
  const save = confirmation.getByRole("button", {
    name: "確認して保存",
    exact: true,
  });
  const cancel = confirmation.getByRole("button", {
    name: "取消",
    exact: true,
  });
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(save).toBeInViewport({ ratio: 1 });
    await expect(cancel).toBeInViewport({ ratio: 1 });
    const content = confirmation.getByRole("region", { name: "確認内容" });
    expect(
      await content.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(save).toBeInViewport({ ratio: 1 });
    await expect(cancel).toBeInViewport({ ratio: 1 });
    await expect(
      confirmation.getByRole("heading", {
        name: "マップ再取り込みの影響を確認",
      }),
    ).toBeInViewport({ ratio: 1 });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(await stored(page, "eventConsistency")).toEqual(before);
  expect(await storedMaps(page)).toEqual(mapsBefore);
  await confirmation
    .getByRole("button", { name: "確認して保存", exact: true })
    .click();
  await expect(confirmation).toBeHidden();
  await expect(selector).toHaveValue("1 日目マップ");
  await expect
    .poll(() => stored(page, "eventConsistency"))
    .toMatchObject({
      [eventName]: { days: { "1日目": { selectedMapKey: "1 日目マップ" } } },
    });
  const mapsAfter = (await storedMaps(page)) as Record<
    string,
    Record<string, unknown>
  >;
  expect(Object.keys(mapsAfter[eventName]).sort()).toEqual(
    Object.keys(mapsBefore[eventName]).sort(),
  );
  expect(mapsAfter[eventName]["１日目マップ"]).toEqual(
    mapsBefore[eventName]["１日目マップ"],
  );
  expect(mapsAfter[eventName]["1 日目マップ"]).not.toEqual(
    mapsBefore[eventName]["1 日目マップ"],
  );
  expect(await stored(page, "eventLists")).toEqual(itemsBefore);
  await page.reload();
  await expect(
    page.locator('input[aria-label="バックアップファイルを選択"]'),
  ).toBeAttached();
  await page.getByText(eventName, { exact: true }).click();
  await expect(selector).toHaveValue("1 日目マップ");
  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  await expect(
    page.getByText("利用するマップを選択してください。", { exact: true }),
  ).toHaveCount(0);
});

test("item edits require a map selection before saving and preserve both maps on cancellation", async ({
  page,
}) => {
  const source = mapBackup();
  for (const store of [
    source.data.mapData,
    source.data.hallDefinitions,
    source.data.hallRouteSettings,
  ]) {
    const values = store[eventName] as Record<string, unknown>;
    values["1 日目マップ"] = values["1日目マップ"];
    delete values["1日目マップ"];
  }
  await restore(page, source);
  const selector = page.getByRole("combobox", { name: "利用するマップ" });
  await expect(selector).toHaveValue("");
  const before = await stored(page, "eventConsistency");
  const itemsBefore = await stored(page, "eventLists");
  const executeBefore = await stored(page, "executeModeItems");
  await editMemo(page, "ユーザー登録");
  const editor = page.getByRole("dialog", { name: "アイテム編集" });
  await editor
    .getByRole("textbox", { name: "ナンバー", exact: true })
    .fill("2");
  await editor
    .getByRole("combobox", { name: "優先度", exact: true })
    .selectOption("highest");
  await expect(editor).toContainText("利用するマップを選択してください");
  await expect(
    editor.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  await editor.getByRole("button", { name: "キャンセル", exact: true }).click();
  expect(await stored(page, "eventConsistency")).toEqual(before);
  expect(await stored(page, "eventLists")).toEqual(itemsBefore);
  expect(await stored(page, "executeModeItems")).toEqual(executeBefore);
  await selector.selectOption("1 日目マップ");
  await expect(selector).toHaveValue("1 日目マップ");
  await editMemo(page, "ユーザー登録");
  await editor
    .getByRole("textbox", { name: "ナンバー", exact: true })
    .fill("2");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  const review = page.getByRole("dialog", {
    name: "所属・配置の変更を確認",
    exact: true,
  });
  await expect(review).toBeVisible();
  await expect(review).toContainText("1 日目マップ");
  await expect(review).toContainText("１日目マップ");
  await review
    .getByRole("button", { name: "確認して保存", exact: true })
    .click();
  await expect(editor).toBeHidden();
  await expect
    .poll(() => stored(page, "eventLists"))
    .toMatchObject({
      [eventName]: [
        expect.objectContaining({ id: "1", number: "2" }),
        expect.anything(),
        expect.anything(),
      ],
    });
  await page.reload();
  await page.getByText(eventName, { exact: true }).click();
  await expect(selector).toHaveValue("1 日目マップ");
  expect(await stored(page, "eventLists")).toMatchObject({
    [eventName]: [
      expect.objectContaining({ id: "1", number: "2" }),
      expect.anything(),
      expect.anything(),
    ],
  });
});

async function openModeMergeReview(page: Page) {
  const source = migrateLegacyConsistency(backup().data).data;
  source.dayModes[eventName][" 1日目　"] = "execute";
  await loadSavedSnapshot(page, source);
  const day = page.getByRole("button", { name: /^1日目/ });
  await day.hover();
  await page.mouse.down();
  const dialog = page.getByRole("dialog", { name: /1日目 の保存先を統合/ });
  await expect(dialog).toBeVisible();
  await page.mouse.up();
  return { source, dialog };
}

for (const action of ["cancel", "save"] as const) {
  test(`mode review is renewed after another tab resolves duplicate dates and can ${action}`, async ({
    page,
    context,
  }) => {
    const { dialog } = await openModeMergeReview(page);
    const other = await context.newPage();
    await other.goto("/");
    await other.getByText(eventName, { exact: true }).click();
    await other
      .getByRole("button", { name: "統合内容を確認", exact: true })
      .click();
    const otherDialog = other.getByRole("dialog", {
      name: /1日目 の保存先を統合/,
    });
    await otherDialog
      .getByRole("combobox", { name: "統合後の表示モード" })
      .selectOption("execute");
    await otherDialog
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
    await expect(otherDialog).toBeHidden();
    const before = await stored(page, "dayModes");
    const itemsBefore = await stored(page, "eventLists");
    const consistencyBefore = await stored(page, "eventConsistency");
    await dialog
      .getByRole("combobox", { name: "統合後の表示モード" })
      .selectOption("edit");
    await expect(dialog).toHaveAttribute("aria-busy", "false");
    await expect(dialog).toContainText("前回の確認対象が解消");
    await expect(dialog).toContainText('"execute" → "edit"');
    expect(await stored(page, "dayModes")).toEqual(before);
    expect(await stored(page, "eventLists")).toEqual(itemsBefore);
    expect(await stored(page, "eventConsistency")).toEqual(consistencyBefore);
    await dialog
      .getByRole("button", {
        name: action === "cancel" ? "取消" : "確認して保存",
        exact: true,
      })
      .click();
    await expect(dialog).toBeHidden();
    const expected =
      action === "cancel"
        ? before
        : { [eventName]: { "1日目": "edit", "2日目": "edit" } };
    expect(await stored(page, "dayModes")).toEqual(expected);
    expect(await stored(page, "eventLists")).toEqual(itemsBefore);
    await page.reload();
    await expect(
      page.locator('input[aria-label="バックアップファイルを選択"]'),
    ).toBeAttached();
    expect(await stored(page, "dayModes")).toEqual(expected);
    await other.close();
  });
}

test("confirmation disables cancellation, choices and repeated saving during its durable read", async ({
  page,
}) => {
  const { dialog, source } = await openModeMergeReview(page);
  const selectedMode = await dialog
    .getByRole("combobox", { name: "統合後の表示モード" })
    .inputValue();
  await persistenceRealm(page).evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      IDBTransaction.prototype,
      "oncomplete",
    )!;
    const gate = { ready: false, release: () => {} };
    (
      globalThis as typeof globalThis & { __confirmationReadGate: typeof gate }
    ).__confirmationReadGate = gate;
    let intercepted = false;
    Object.defineProperty(IDBTransaction.prototype, "oncomplete", {
      ...descriptor,
      set(this: IDBTransaction, handler: IDBTransaction["oncomplete"]) {
        if (
          !intercepted &&
          this.mode === "readonly" &&
          this.objectStoreNames.contains("eventConsistency") &&
          this.objectStoreNames.contains("eventLists")
        ) {
          intercepted = true;
          descriptor.set!.call(this, (event: Event) => {
            gate.ready = true;
            gate.release = () => {
              Object.defineProperty(
                IDBTransaction.prototype,
                "oncomplete",
                descriptor,
              );
              handler?.call(this, event);
            };
          });
        } else descriptor.set!.call(this, handler);
      },
    });
  });
  await dialog
    .getByRole("button", { name: "確認して保存", exact: true })
    .click();
  await expect
    .poll(() =>
      persistenceRealm(page).evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __confirmationReadGate: { ready: boolean };
            }
          ).__confirmationReadGate.ready,
      ),
    )
    .toBe(true);
  await expect(dialog).toHaveAttribute("aria-busy", "true");
  const cancel = dialog.getByRole("button", { name: "取消", exact: true });
  await expect(cancel).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "確認して保存", exact: true }),
  ).toBeDisabled();
  for (const choice of await dialog.getByRole("combobox").all())
    await expect(choice).toBeDisabled();
  await cancel.evaluate((button: HTMLButtonElement) => button.click());
  await expect(dialog).toBeVisible();
  expect(await stored(page, "dayModes")).toEqual(source.dayModes);
  await persistenceRealm(page).evaluate(() =>
    (
      globalThis as typeof globalThis & {
        __confirmationReadGate: { release(): void };
      }
    ).__confirmationReadGate.release(),
  );
  await expect(dialog).toBeHidden();
  const expected = { [eventName]: { "1日目": selectedMode, "2日目": "edit" } };
  expect(await stored(page, "dayModes")).toEqual(expected);
  await page.reload();
  await expect(
    page.locator('input[aria-label="バックアップファイルを選択"]'),
  ).toBeAttached();
  expect(await stored(page, "dayModes")).toEqual(expected);
});

async function dragSecondVisitFirst(page: Page) {
  const rows = page.locator("[data-drag-item]");
  await expect(rows).toHaveCount(2);
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await rows.nth(1).dispatchEvent("dragstart", { dataTransfer: transfer });
  await rows.nth(0).dispatchEvent("dragover", { dataTransfer: transfer });
  await rows.nth(0).dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
}

for (const duplicate of ["execution", "modes", "contexts"] as const) {
  test(`visit opening reviews ${duplicate} duplicate day keys before creating history`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const raw = mapBackup();
    Object.assign(raw.data.eventLists[eventName][0], {
      purchaseStatus: "Purchased",
      price: 900,
      quantity: 2,
    });
    const source = migrateLegacyConsistency(raw.data).data;
    source.dayModes[eventName]["1日目"] = "execute";
    if (duplicate === "execution") {
      source.executeModeItems[eventName]["1日目"] = ["1"];
      source.executeModeItems[eventName][" 1日目　"] = ["2"];
    } else if (duplicate === "modes") {
      source.dayModes[eventName][" 1日目　"] = "edit";
    } else {
      source.eventConsistency[eventName].days[" 1日目　"] = structuredClone(
        source.eventConsistency[eventName].days["1日目"],
      );
    }
    await loadSavedSnapshot(page, source);
    const beforeItems = await stored(page, "eventLists");
    const beforeExecute = await stored(page, "executeModeItems");
    const beforeModes = await stored(page, "dayModes");
    await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
    await openVisitList(page);
    const review = page.getByRole("dialog", { name: /1日目 の保存先を統合/ });
    await expect(review).toBeVisible();
    await expect(page.locator("[data-drag-item]")).toHaveCount(0);
    expect(await stored(page, "executeModeItems")).toEqual(beforeExecute);
    expect(await stored(page, "dayModes")).toEqual(beforeModes);
    await review.getByRole("button", { name: "取消", exact: true }).click();
    await expect(review).toBeHidden();
    await expect(page.locator("[data-drag-item]")).toHaveCount(0);
    expect(await stored(page, "executeModeItems")).toEqual(beforeExecute);
    expect(await stored(page, "dayModes")).toEqual(beforeModes);

    await openVisitList(page);
    await expect(review).toBeVisible();
    await review
      .getByRole("combobox", { name: "統合先の日付表記" })
      .selectOption(" 1日目　");
    if (duplicate === "execution")
      await review
        .getByRole("combobox", { name: /実行列の順序/ })
        .selectOption("1日目");
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
    await expect(review).toBeHidden();
    await expect(page.locator("[data-drag-item]")).toHaveCount(2);
    await page.getByRole("button", { name: "左側に移動", exact: true }).click();
    await expect(
      page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }),
    ).toBeDisabled();
    expect(await stored(page, "executeModeItems")).toEqual({
      [eventName]: { " 1日目　": ["1", "2"], "2日目": ["3"] },
    });
    await dragSecondVisitFirst(page);
    await expect
      .poll(() => stored(page, "executeModeItems"))
      .toEqual({
        [eventName]: { " 1日目　": ["2", "1"], "2日目": ["3"] },
      });
    await page.getByRole("button", { name: "キャンセル", exact: true }).click();
    await expect
      .poll(() => stored(page, "executeModeItems"))
      .toEqual({
        [eventName]: { " 1日目　": ["1", "2"], "2日目": ["3"] },
      });
    expect(await stored(page, "eventLists")).toEqual(beforeItems);
    await page.reload();
    await expect(
      page.locator('input[aria-label="バックアップファイルを選択"]'),
    ).toBeAttached();
    expect(await stored(page, "executeModeItems")).toEqual({
      [eventName]: { " 1日目　": ["1", "2"], "2日目": ["3"] },
    });
    expect(await stored(page, "eventLists")).toEqual(beforeItems);
    expect(errors).toEqual([]);
  });
}

async function addDurableDuplicateMode(
  page: Page,
  mode: "edit" | "execute" = "execute",
) {
  // Simulate another writer using the application's integrity metadata generators.
  const modes = (await stored(page, "dayModes")) as Record<
    string,
    Record<string, string>
  >;
  modes[eventName][" 1日目　"] = mode;
  const metadataKey = createPersistenceMetadataKey("dayModes", "data");
  const checkpointKey = createPersistenceCheckpointKey("dayModes", "data");
  const previous = (await stored(
    page,
    "syncQueue",
    metadataKey,
  )) as StoredPersistenceMetadata;
  const previousCheckpoint = (await stored(
    page,
    "syncQueue",
    checkpointKey,
  )) as PersistenceCheckpoint | null;
  const metadata = await prepareMetadataForPayload(
    "dayModes",
    "data",
    modes,
    previous.revision,
  );
  const checkpoint = createNextPersistenceCheckpoint(
    "dayModes",
    "data",
    metadata,
    previousCheckpoint,
  );
  await page.evaluate(
    async ({ modes, metadataKey, checkpointKey, metadata, checkpoint }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("EventShoppingPlannerDB");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(
            ["dayModes", "syncQueue"],
            "readwrite",
          );
          transaction.objectStore("dayModes").put(modes, "data");
          transaction.objectStore("syncQueue").put(metadata, metadataKey);
          transaction.objectStore("syncQueue").put(checkpoint, checkpointKey);
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error);
          transaction.onerror = () => reject(transaction.error);
        });
      } finally {
        database.close();
      }
    },
    { modes, metadataKey, checkpointKey, metadata, checkpoint },
  );
}

for (const operation of ["reorder", "discard", "save"] as const) {
  test(`visit ${operation} reviews settings-only duplicates introduced while open`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await restore(page, mapBackup());
    await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
    await openVisitList(page);
    await expect(page.locator("[data-drag-item]")).toHaveCount(2);
    const beforeItems = await stored(page, "eventLists");
    await page.getByRole("button", { name: "左側に移動", exact: true }).click();
    await addDurableDuplicateMode(page);
    const beforeExecute = await stored(page, "executeModeItems");
    const beforeModes = await stored(page, "dayModes");
    const operate = async () => {
      if (operation === "reorder") await dragSecondVisitFirst(page);
      else
        await page
          .getByRole("button", {
            name: operation === "discard" ? "キャンセル" : "確定",
            exact: true,
          })
          .click();
    };
    await operate();
    const review = page.getByRole("dialog", { name: /1日目 の保存先を統合/ });
    await expect(review).toBeVisible();
    expect(await stored(page, "executeModeItems")).toEqual(beforeExecute);
    expect(await stored(page, "dayModes")).toEqual(beforeModes);
    await review.getByRole("button", { name: "取消", exact: true }).click();
    await expect(review).toBeHidden();
    expect(await stored(page, "executeModeItems")).toEqual(beforeExecute);
    expect(await stored(page, "dayModes")).toEqual(beforeModes);
    await operate();
    await expect(review).toBeVisible();
    await review
      .getByRole("combobox", { name: "統合先の日付表記" })
      .selectOption(" 1日目　");
    await review
      .getByRole("combobox", { name: "統合後の表示モード" })
      .selectOption("edit");
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
    await expect(review).toBeHidden();
    await expect
      .poll(() => stored(page, "executeModeItems"))
      .toEqual({
        [eventName]: {
          " 1日目　": operation === "reorder" ? ["2", "1"] : ["1", "2"],
          "2日目": ["3"],
        },
      });
    expect(await stored(page, "dayModes")).toEqual({
      [eventName]: { " 1日目　": "edit", "2日目": "edit" },
    });
    await expect(
      page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "キャンセル", exact: true }).click();
    await expect
      .poll(() => stored(page, "executeModeItems"))
      .toEqual({
        [eventName]: { " 1日目　": ["1", "2"], "2日目": ["3"] },
      });
    expect(await stored(page, "eventLists")).toEqual(beforeItems);
    expect(errors).toEqual([]);
  });
}

for (const operation of ["opening", "reorder"] as const) {
  test(`visit ${operation} merge abort preserves the previous data and can be retried`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const source = migrateLegacyConsistency(mapBackup().data).data;
    if (operation === "opening")
      source.executeModeItems[eventName][" 1日目　"] = ["2", "1"];
    await loadSavedSnapshot(page, source);
    await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
    if (operation === "reorder") {
      await openVisitList(page);
      await expect(page.locator("[data-drag-item]")).toHaveCount(2);
      await addDurableDuplicateMode(page);
    }
    const beforeItems = await stored(page, "eventLists");
    const beforeExecute = await stored(page, "executeModeItems");
    const beforeModes = await stored(page, "dayModes");
    const operate = () =>
      operation === "opening"
        ? openVisitList(page)
        : dragSecondVisitFirst(page);
    await operate();
    const review = page.getByRole("dialog", { name: /1日目 の保存先を統合/ });
    await expect(review).toBeVisible();
    await persistenceRealm(page).evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (
        ...args: Parameters<typeof original>
      ) {
        if (
          this.transaction.mode === "readwrite" &&
          this.transaction.objectStoreNames.contains("eventConsistency")
        ) {
          IDBObjectStore.prototype.put = original;
          throw new DOMException("日付統合の保存失敗", "AbortError");
        }
        return original.apply(this, args);
      };
    });
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "日付統合の保存失敗" }),
    ).toBeVisible();
    await expect(review).toBeHidden();
    await expect(page.locator("[data-drag-item]")).toHaveCount(
      operation === "opening" ? 0 : 2,
    );
    expect(await stored(page, "eventLists")).toEqual(beforeItems);
    expect(await stored(page, "executeModeItems")).toEqual(beforeExecute);
    expect(await stored(page, "dayModes")).toEqual(beforeModes);
    await operate();
    await expect(review).toBeVisible();
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
    await expect(review).toBeHidden();
    await expect(page.locator("[data-drag-item]")).toHaveCount(2);
    expect(await stored(page, "executeModeItems")).toEqual({
      [eventName]: {
        "1日目": operation === "opening" ? ["1", "2"] : ["2", "1"],
        "2日目": ["3"],
      },
    });
    expect(await stored(page, "eventLists")).toEqual(beforeItems);
    expect(errors).toEqual([]);
  });
}

test("visit reorder renews duplicate-day review after the saved modes change", async ({
  page,
}) => {
  await restore(page, mapBackup());
  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  await openVisitList(page);
  await expect(page.locator("[data-drag-item]")).toHaveCount(2);
  await addDurableDuplicateMode(page);
  await dragSecondVisitFirst(page);
  const review = page.getByRole("dialog", { name: /1日目 の保存先を統合/ });
  await expect(review).toBeVisible();
  await addDurableDuplicateMode(page, "edit");
  const beforeExecute = await stored(page, "executeModeItems");
  await review
    .getByRole("button", { name: "確認して保存", exact: true })
    .click();
  await expect(review).toContainText('" 1日目　"=edit');
  expect(await stored(page, "executeModeItems")).toEqual(beforeExecute);
  expect(await stored(page, "dayModes")).toMatchObject({
    [eventName]: { "1日目": "edit", " 1日目　": "edit" },
  });
  await review
    .getByRole("button", { name: "確認して保存", exact: true })
    .click();
  await expect(review).toBeHidden();
  await expect
    .poll(() => stored(page, "executeModeItems"))
    .toEqual({
      [eventName]: { "1日目": ["2", "1"], "2日目": ["3"] },
    });
  expect(await stored(page, "dayModes")).toEqual({
    [eventName]: { "1日目": "edit", "2日目": "edit" },
  });
});

test("legacy shared-map empty visits are retained for review after restore and reload", async ({
  page,
}) => {
  const original = mapBackup();
  const mapKey = "1日目マップ";
  const visits = {
    hallOrder: [],
    hallVisitLists: [
      { hallId: "hall:priority", itemIds: [] },
      { hallId: "hall", itemIds: ["1", "2"] },
    ],
  };
  const route = {
    isRouteVisible: true,
    visitOrder: [
      { row: 1, col: 2, blockName: "A", number: 0, order: 0, itemIds: [] },
      {
        row: 2,
        col: 2,
        blockName: "A",
        number: 1,
        order: 1,
        itemIds: ["1", "2"],
      },
    ],
  };
  const source = {
    ...original,
    data: {
      ...original.data,
      eventLists: { [eventName]: [item("1"), item("2", "１日目")] },
      executeModeItems: { [eventName]: { "1日目": ["1"], "１日目": ["2"] } },
      dayModes: { [eventName]: { "1日目": "execute", "１日目": "edit" } },
      mapData: {
        [eventName]: { [mapKey]: original.data.mapData[eventName][mapKey] },
      },
      hallDefinitions: {
        [eventName]: {
          [mapKey]: original.data.hallDefinitions[eventName][mapKey],
        },
      },
      hallRouteSettings: { [eventName]: { [mapKey]: visits } },
      routeSettings: { [eventName]: { [mapKey]: route } },
    },
  };
  await restore(page, source, "「" + eventName + "」の復元内容を確認");
  const check = async () => {
    const saved = (await stored(
      page,
      "eventConsistency",
    )) as EventConsistencyStore;
    expect(
      saved[eventName].legacyPending.map((pending) => pending.payload),
    ).toEqual([
      { kind: "hall-route-settings", settings: visits },
      { kind: "route-settings", settings: route },
    ]);
    for (const [day, id] of [
      ["1日目", "1"],
      ["１日目", "2"],
    ]) {
      const context = saved[eventName].days[day].maps[mapKey];
      expect(context.hallVisitLists.map((list) => list.itemIds)).toEqual([
        [id],
      ]);
      expect(context.route?.visitOrder.map((point) => point.itemIds)).toEqual([
        [id],
      ]);
    }
  };
  await check();
  await page.reload();
  await expect(
    page.locator('input[aria-label="バックアップファイルを選択"]'),
  ).toBeAttached();
  await check();
});

test("legacy mixed hall order keeps the saved simple sequence in the editor after reload", async ({
  page,
}) => {
  const original = mapBackup();
  const source = {
    ...original,
    data: {
      ...original.data,
      hallDefinitions: {
        [eventName]: {
          ...original.data.hallDefinitions[eventName],
          "__mapless__:1日目": [
            { id: "simple1", name: "簡易1", vertices: [], blockNames: ["B"] },
            { id: "simple2", name: "簡易2", vertices: [], blockNames: ["C"] },
          ],
        },
      },
      hallRouteSettings: {
        [eventName]: {
          ...original.data.hallRouteSettings[eventName],
          "__mapless__:1日目": {
            hallOrder: ["simple2", "simple1"],
            hallVisitLists: [],
          },
        },
      },
    },
  };
  await restore(page, source);
  const beforeExecute = await stored(page, "executeModeItems");
  const beforeItems = await stored(page, "eventLists");
  const check = async () => {
    const saved = (await stored(
      page,
      "eventConsistency",
    )) as EventConsistencyStore;
    for (const context of Object.values(saved[eventName].days["1日目"].maps))
      expect(context.hallOrder.map((group) => group.hall?.hallId)).toEqual([
        "hall",
        "simple2",
        "simple1",
      ]);
    await expect(
      page.getByTitle(/^(マップ表示|リスト表示)に切り替え$/),
    ).toBeVisible();
    const mapToggle = page.getByTitle("マップ表示に切り替え", { exact: true });
    if (await mapToggle.isVisible()) await mapToggle.click();
    await page.getByTitle("ホール順を編集", { exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "ホール間移動順序" });
    await expect(dialog.getByText(/^(東館|簡易1|簡易2)$/)).toHaveText([
      "東館",
      "簡易2",
      "簡易1",
    ]);
    await dialog
      .getByRole("button", { name: "ホール間移動順序を閉じる" })
      .click();
    expect(await stored(page, "executeModeItems")).toEqual(beforeExecute);
    expect(await stored(page, "eventLists")).toEqual(beforeItems);
  };
  await check();
  await page.reload();
  await expect(
    page.locator('input[aria-label="バックアップファイルを選択"]'),
  ).toBeAttached();
  await page.getByText(eventName, { exact: true }).click();
  await check();
});

for (const timing of ["before apply", "confirmation"] as const) {
  for (const removal of ["all maps", "edited map"] as const) {
    test(
      "stale block edit never recreates maps removed by another tab's replacement: " +
        timing +
        ", " +
        removal,
      async ({ page, context }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await restore(page, mapBackup());
        await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
        await page.getByTitle("リスト表示に切り替え", { exact: true }).hover();
        await page.mouse.down();
        const blocks = page.getByRole("button", {
          name: "🔲 ブロック定義",
          exact: true,
        });
        await expect(blocks).toBeVisible();
        await page.mouse.up();
        await blocks.click();
        await page.getByRole("button", { name: /A.*2セル/ }).click();
        await page.getByPlaceholder("例: ア, め, N").fill("Ａ");
        await page.getByRole("button", { name: "保存", exact: true }).click();
        const confirmation = page.getByRole("dialog", {
          name: "所属・配置の変更を確認",
        });
        if (timing === "confirmation") {
          await page.getByRole("button", { name: "適用", exact: true }).click();
          await expect(confirmation).toBeVisible();
        }
        const replacement =
          removal === "all maps"
            ? backup(mapBackup().data.eventLists[eventName])
            : mapBackup();
        if (removal === "edited map") {
          delete (
            replacement.data.mapData as Record<string, Record<string, unknown>>
          )[eventName]["1日目マップ"];
          delete (
            replacement.data.hallDefinitions as Record<
              string,
              Record<string, unknown>
            >
          )[eventName]["1日目マップ"];
          delete (
            replacement.data.hallRouteSettings as Record<
              string,
              Record<string, unknown>
            >
          )[eventName]["1日目マップ"];
        }
        replacement.data.eventLists[eventName][0].remarks = "置換後の最新メモ";
        replacement.data.eventLists[eventName][0].price = 900;
        replacement.data.eventLists[eventName][0].purchaseStatus = "Purchased";
        const other = await context.newPage();
        await restore(
          other,
          replacement,
          "「" + eventName + "」の復元内容を確認",
        );
        const beforeMaps = await storedMaps(other);
        const stores = [
          "eventLists",
          "eventConsistency",
          "hallDefinitions",
          "executeModeItems",
          "dayModes",
        ];
        const before = await Promise.all(
          stores.map((store) => stored(other, store)),
        );
        if (timing === "confirmation")
          await confirmation
            .getByRole("button", { name: "確認して保存" })
            .click();
        else
          await page.getByRole("button", { name: "適用", exact: true }).click();
        await expect(confirmation).toBeHidden();
        // A lifecycle replacement now expires the whole editing session before
        // its planner runs, including a review that was already open.
        await expect(
          page.getByRole("button", { name: "適用", exact: true }),
        ).toHaveCount(0);
        expect(await storedMaps(page)).toEqual(beforeMaps);
        expect(
          await Promise.all(stores.map((store) => stored(page, store))),
        ).toEqual(before);
        await page.reload();
        await expect(
          page.locator('input[aria-label="バックアップファイルを選択"]'),
        ).toBeAttached();
        expect(await storedMaps(page)).toEqual(beforeMaps);
        expect(
          await Promise.all(stores.map((store) => stored(page, store))),
        ).toEqual(before);
        expect(errors).toEqual([]);
        await other.close();
      },
    );
  }
}

for (const operation of ["ordinary reorder", "ordinary item edit"] as const) {
  for (const outcome of ["cancel", "save", "abort"] as const) {
    test(`${operation} reviews mode-only duplicate dates and handles ${outcome} atomically`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const source = migrateLegacyConsistency(
        backup([item("1"), item("2"), item("3", "2日目")]).data,
      ).data;
      source.dayModes[eventName]["1日目"] = "edit";
      source.dayModes[eventName][" 1日目　"] = "execute";
      await loadSavedSnapshot(page, source);
      const before = {
        items: await stored(page, "eventLists"),
        execute: await stored(page, "executeModeItems"),
        modes: await stored(page, "dayModes"),
        consistency: await stored(page, "eventConsistency"),
      };
      if (operation === "ordinary item edit")
        await editMemo(page, "統合後のメモ");
      const operate = () =>
        operation === "ordinary reorder"
          ? page
              .locator('[data-item-id="2"]')
              .getByTitle("上に移動", { exact: true })
              .click()
          : page
              .getByRole("dialog", { name: "アイテム編集" })
              .getByRole("button", { name: "保存", exact: true })
              .click();
      await operate();
      const review = page.getByRole("dialog", { name: /1日目 の保存先を統合/ });
      await expect(review).toBeVisible();
      const unchanged = async () => {
        expect(await stored(page, "eventLists")).toEqual(before.items);
        expect(await stored(page, "executeModeItems")).toEqual(before.execute);
        expect(await stored(page, "dayModes")).toEqual(before.modes);
        expect(await stored(page, "eventConsistency")).toEqual(
          before.consistency,
        );
      };
      await unchanged();
      if (outcome === "cancel") {
        await review.getByRole("button", { name: "取消", exact: true }).click();
        await expect(review).toBeHidden();
        await unchanged();
      } else {
        await review
          .getByRole("combobox", { name: "統合先の日付表記" })
          .selectOption(" 1日目　");
        await review
          .getByRole("combobox", { name: "統合後の表示モード" })
          .selectOption("execute");
        await expect(review).toHaveAttribute("aria-busy", "false");
        if (outcome === "abort") {
          await persistenceRealm(page).evaluate(() => {
            const original = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (
              ...args: Parameters<typeof original>
            ) {
              if (
                this.transaction.mode === "readwrite" &&
                this.transaction.objectStoreNames.contains("eventConsistency")
              ) {
                IDBObjectStore.prototype.put = original;
                throw new DOMException(
                  "通常操作の日付統合保存失敗",
                  "AbortError",
                );
              }
              return original.apply(this, args);
            };
          });
        }
        await review
          .getByRole("button", { name: "確認して保存", exact: true })
          .click();
        await expect(review).toBeHidden();
        if (outcome === "abort") {
          await expect(
            page
              .getByRole("alert")
              .filter({ hasText: "通常操作の日付統合保存失敗" })
              .first(),
          ).toBeVisible();
          await unchanged();
        } else {
          await expect
            .poll(() => stored(page, "dayModes"))
            .toEqual({
              [eventName]: { " 1日目　": "execute", "2日目": "edit" },
            });
          expect(await stored(page, "executeModeItems")).toEqual({
            [eventName]: {
              " 1日目　":
                operation === "ordinary reorder" ? ["2", "1"] : ["1", "2"],
              "2日目": ["3"],
            },
          });
          expect(await stored(page, "eventLists")).toMatchObject({
            [eventName]: expect.arrayContaining([
              expect.objectContaining({
                id: "1",
                remarks:
                  operation === "ordinary item edit"
                    ? "統合後のメモ"
                    : "ユーザー登録",
              }),
              expect.objectContaining(item("3", "2日目")),
            ]),
          });
          await page.reload();
          await page.getByText(eventName, { exact: true }).click();
          expect(await stored(page, "dayModes")).toEqual({
            [eventName]: { " 1日目　": "execute", "2日目": "edit" },
          });
        }
      }
      expect(errors).toEqual([]);
    });
  }
}

test("map reimport skips impact review and preserves another selected map day", async ({
  page,
}) => {
  const source = migrateLegacyConsistency(mapBackup().data).data;
  const items = source.eventLists[eventName] as Array<ReturnType<typeof item>>;
  items[2].eventDate = "１日目";
  source.executeModeItems[eventName] = { "1日目": ["1", "2"], "１日目": ["3"] };
  source.dayModes[eventName] = { "1日目": "execute", "１日目": "execute" };
  source.eventConsistency[eventName].days["１日目"] = structuredClone(
    source.eventConsistency[eventName].days["1日目"],
  );
  delete source.eventConsistency[eventName].days["2日目"];
  for (const [day, mapKey, ids] of [
    ["1日目", "1日目マップ", ["1", "2"]],
    ["１日目", "１日目マップ", ["3"]],
  ] as const) {
    const hall = { kind: "simple" as const, dayKey: day, hallId: "simple" };
    const group = { hall, priority: "none" as const };
    source.hallDefinitions[eventName]["__mapless__:" + day] = [
      { id: "simple", name: day + "簡易会場", blockNames: ["A"], vertices: [] },
    ];
    const settings = source.eventConsistency[eventName].days[day];
    settings.selectedMapKey = mapKey;
    settings.maps = {
      [mapKey]: {
        assignments: Object.fromEntries(ids.map((id) => [id, hall])),
        hallOrder: [group],
        hallVisitLists: [{ group, itemIds: [...ids] }],
        route: null,
      },
    };
  }
  await loadSavedSnapshot(page, source);
  const before = (await stored(
    page,
    "eventConsistency",
  )) as EventConsistencyStore;
  const definitions = (await stored(page, "hallDefinitions")) as Record<
    string,
    Record<string, unknown>
  >;
  const itemsBefore = await stored(page, "eventLists");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("1日目");
  const border = { style: "medium" as const, color: { argb: "FFFF0000" } };
  sheet.getCell("A1").value = "A";
  sheet.getCell("A1").border = { top: border, bottom: border, left: border };
  sheet.getCell("B1").value = 1;
  sheet.getCell("B1").border = { top: border, bottom: border, right: border };
  await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /マップデータ取り込み/ }).click();
  await (
    await chooser
  ).setFiles({
    name: "map.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  });
  await page.getByRole("button", { name: "取り込む", exact: true }).click();
  const target = page.getByRole("dialog", {
    name: "マップを入れ替える前の確認",
  });
  await expect(target).toBeVisible();
  await target
    .getByRole("checkbox", { name: /マップを使わない会場設定を残す/ })
    .uncheck();
  expect(await stored(page, "eventConsistency")).toEqual(before);
  await target
    .getByRole("button", { name: "影響を確認せずに取り込む", exact: true })
    .click();
  await expect(target).toBeHidden();
  await expect(
    page.getByRole("dialog", { name: "マップ再取り込みの影響を確認" }),
  ).toHaveCount(0);
  const mapsAfter = await storedMaps(page);
  expect(mapsAfter[eventName]["1日目マップ"]).not.toEqual(
    source.mapData[eventName]["1日目マップ"],
  );
  expect(mapsAfter[eventName]["１日目マップ"]).toEqual(
    source.mapData[eventName]["１日目マップ"],
  );
  const after = (await stored(
    page,
    "eventConsistency",
  )) as EventConsistencyStore;
  expect(after[eventName].days["１日目"]).toEqual(
    before[eventName].days["１日目"],
  );
  const definitionsAfter = (await stored(page, "hallDefinitions")) as Record<
    string,
    Record<string, unknown>
  >;
  expect(definitionsAfter[eventName]["__mapless__:1日目"]).toBeUndefined();
  expect(definitionsAfter[eventName]["__mapless__:１日目"]).toEqual(
    definitions[eventName]["__mapless__:１日目"],
  );
  expect(definitionsAfter[eventName]["１日目マップ"]).toEqual(
    definitions[eventName]["１日目マップ"],
  );
  expect(await stored(page, "eventLists")).toEqual(itemsBefore);
  await page.reload();
  expect(await storedMaps(page)).toEqual(mapsAfter);
  expect(
    ((await stored(page, "eventConsistency")) as EventConsistencyStore)[
      eventName
    ].days["１日目"],
  ).toEqual(before[eventName].days["１日目"]);
});

test("ordinary item edit carries its chosen simple hall through a selectable day merge", async ({
  page,
}) => {
  const source = migrateLegacyConsistency(
    backup([item("1"), item("2")]).data,
  ).data;
  source.dayModes[eventName][" 1日目　"] = "execute";
  source.hallDefinitions[eventName] = {
    "__mapless__: 1日目　": [
      {
        id: "simple",
        name: "選択する簡易会場",
        blockNames: ["A"],
        vertices: [],
      },
    ],
  };
  await loadSavedSnapshot(page, source);
  await editMemo(page, "所属指定付きの編集");
  const editor = page.getByRole("dialog", { name: "アイテム編集" });
  await editor
    .getByRole("combobox", { name: /^ホール設定/ })
    .selectOption("@hall:" + JSON.stringify(["simple", " 1日目　", "simple"]));
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  const review = page.getByRole("dialog", { name: /1日目 の保存先を統合/ });
  await expect(review).toBeVisible();
  await review
    .getByRole("combobox", { name: "統合先の日付表記" })
    .selectOption(" 1日目　");
  await expect(review).toHaveAttribute("aria-busy", "false");
  await review
    .getByRole("button", { name: "確認して保存", exact: true })
    .click();
  await expect(review).toBeHidden();
  await expect(editor).toBeHidden();
  expect(await stored(page, "eventConsistency")).toMatchObject({
    [eventName]: {
      days: {
        " 1日目　": {
          mapless: {
            assignments: {
              "1": { kind: "simple", dayKey: " 1日目　", hallId: "simple" },
            },
          },
        },
      },
    },
  });
  expect(await stored(page, "eventLists")).toMatchObject({
    [eventName]: expect.arrayContaining([
      expect.objectContaining({ id: "1", remarks: "所属指定付きの編集" }),
    ]),
  });
  await page.reload();
  expect(await stored(page, "hallDefinitions")).toMatchObject({
    [eventName]: {
      "__mapless__: 1日目　": [{ id: "simple", name: "選択する簡易会場" }],
    },
  });
});

for (const selected of [undefined, "edit", "execute", "focus"] as const) {
  test(`ordinary mode change saves its confirmed ${selected ?? "default"} mode after a day merge and reload`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const source = migrateLegacyConsistency(backup().data).data;
    source.dayModes[eventName][" 1日目　"] = "focus";
    await loadSavedSnapshot(page, source);
    const itemsBefore = await stored(page, "eventLists");
    const executeBefore = await stored(page, "executeModeItems");
    await page.getByTitle("実行モード", { exact: true }).click();
    const review = page.getByRole("dialog", { name: /1日目 の保存先を統合/ });
    const mode = review.getByRole("combobox", { name: "統合後の表示モード" });
    await expect(mode).toHaveValue("execute");
    await expect(mode.locator('option[value="focus"]')).toContainText(
      "集中モード",
    );
    if (selected !== undefined) await mode.selectOption(selected);
    const expected = selected ?? "execute";
    await expect(mode).toHaveValue(expected);
    await expect(review).toHaveAttribute("aria-busy", "false");
    await review
      .getByRole("combobox", { name: "統合先の日付表記" })
      .selectOption(" 1日目　");
    await expect(mode).toHaveValue(expected);
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
    await expect(review).toBeHidden();
    const expectedModes = {
      [eventName]: { " 1日目　": expected, "2日目": "edit" },
    };
    await expect.poll(() => stored(page, "dayModes")).toEqual(expectedModes);
    expect(await stored(page, "eventLists")).toEqual(itemsBefore);
    expect(await stored(page, "executeModeItems")).toEqual({
      [eventName]: { " 1日目　": ["1"], "2日目": ["2"] },
    });
    expect(executeBefore).toEqual({
      [eventName]: { "1日目": ["1"], "2日目": ["2"] },
    });
    if (expected === "focus")
      await expect(page.locator("#focus-mode-footer")).toBeVisible();
    await page.reload();
    await page.getByText(eventName, { exact: true }).click();
    expect(await stored(page, "dayModes")).toEqual(expectedModes);
    expect(await stored(page, "eventLists")).toEqual(itemsBefore);
    if (expected === "focus")
      await expect(page.locator("#focus-mode-footer")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

for (const outcome of ["save", "cancel", "abort"] as const) {
  test(`a focused standalone merge shows its saved mode and handles ${outcome} without losing records`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const source = migrateLegacyConsistency(backup().data).data;
    source.dayModes[eventName]["1日目"] = "focus";
    source.dayModes[eventName][" 1日目　"] = "execute";
    await loadSavedSnapshot(page, source);
    const stores = [
      "dayModes",
      "eventLists",
      "executeModeItems",
      "eventConsistency",
    ];
    const before = await Promise.all(
      stores.map((store) => stored(page, store)),
    );
    await page
      .getByRole("button", { name: "統合内容を確認", exact: true })
      .click();
    const review = page.getByRole("dialog", { name: /1日目 の保存先を統合/ });
    const mode = review.getByRole("combobox", { name: "統合後の表示モード" });
    await expect(mode).toHaveValue("focus");
    await expect(mode.locator("option:checked")).toContainText("集中モード");
    expect(
      await Promise.all(stores.map((store) => stored(page, store))),
    ).toEqual(before);
    if (outcome === "abort") {
      await persistenceRealm(page).evaluate(() => {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (
          ...args: Parameters<typeof original>
        ) {
          if (
            this.transaction.mode === "readwrite" &&
            this.transaction.objectStoreNames.contains("eventConsistency")
          ) {
            IDBObjectStore.prototype.put = original;
            throw new DOMException(
              "集中モードの日付統合保存失敗",
              "AbortError",
            );
          }
          return original.apply(this, args);
        };
      });
    }
    await review
      .getByRole("button", {
        name: outcome === "cancel" ? "取消" : "確認して保存",
        exact: true,
      })
      .click();
    await expect(review).toBeHidden();
    if (outcome === "save") {
      await expect
        .poll(() => stored(page, "dayModes"))
        .toEqual({ [eventName]: { "1日目": "focus", "2日目": "edit" } });
      expect(await stored(page, "eventLists")).toEqual(before[1]);
      expect(await stored(page, "executeModeItems")).toEqual(before[2]);
      await expect(page.locator("#focus-mode-footer")).toBeVisible();
    } else {
      if (outcome === "abort")
        await expect(
          page
            .getByRole("alert")
            .filter({ hasText: "集中モードの日付統合保存失敗" })
            .first(),
        ).toBeVisible();
      expect(
        await Promise.all(stores.map((store) => stored(page, store))),
      ).toEqual(before);
    }
    const savedModes = await stored(page, "dayModes");
    await page.reload();
    await page.getByText(eventName, { exact: true }).click();
    expect(await stored(page, "dayModes")).toEqual(savedModes);
    expect(await stored(page, "eventLists")).toEqual(before[1]);
    await expect(page.locator("#focus-mode-footer")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("a day-tab long press can confirm focus mode through a day merge and reload", async ({
  page,
}) => {
  const { dialog } = await openModeMergeReview(page);
  const mode = dialog.getByRole("combobox", { name: "統合後の表示モード" });
  await expect(mode).toHaveValue("execute");
  await mode.selectOption("focus");
  await expect(mode).toHaveValue("focus");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await dialog
    .getByRole("button", { name: "確認して保存", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  const expected = { [eventName]: { "1日目": "focus", "2日目": "edit" } };
  await expect.poll(() => stored(page, "dayModes")).toEqual(expected);
  await expect(page.locator("#focus-mode-footer")).toBeVisible();
  await page.reload();
  await page.getByText(eventName, { exact: true }).click();
  expect(await stored(page, "dayModes")).toEqual(expected);
  await expect(page.locator("#focus-mode-footer")).toBeVisible();
});

for (const outcome of ["save", "cancel"] as const) {
  test(`item move renews approval after another tab changes its hidden source assignment: ${outcome}`, async ({
    page,
    context,
  }) => {
    const source = migrateLegacyConsistency(mapBackup().data).data;
    for (const key of ["1日目マップ", "１日目マップ"]) {
      const definitions = source.hallDefinitions[eventName][key] as Array<{
        id: string;
        name: string;
        vertices: Array<{ row: number; col: number }>;
      }>;
      definitions.push({ ...definitions[0], id: "west", name: "西館" });
      source.eventConsistency[eventName].days["1日目"].maps[key].assignments[
        "1"
      ] = { kind: "map", mapKey: key, hallId: "hall" };
    }
    source.eventConsistency[eventName].days["1日目"].selectedMapKey =
      "1日目マップ";
    await loadSavedSnapshot(page, source);
    await editMemo(page, "ユーザー登録");
    const editor = page.getByRole("dialog", { name: "アイテム編集" });
    await editor
      .getByRole("textbox", { name: "参加日", exact: true })
      .fill("2日目");
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    const review = page.getByRole("dialog", { name: "所属・配置の変更を確認" });
    await expect(review).toBeVisible();
    await expect(review).toContainText("１日目マップ");
    await expect(review).toContainText("東館 → 指定解除");

    const other = await context.newPage();
    await other.goto("/");
    await other.getByText(eventName, { exact: true }).click();
    await other.getByTitle("マップ表示に切り替え", { exact: true }).click();
    await other
      .getByRole("combobox", { name: "利用するマップ" })
      .selectOption("１日目マップ");
    await other.getByTitle("リスト表示に切り替え", { exact: true }).click();
    await editMemo(other, "ユーザー登録");
    const otherEditor = other.getByRole("dialog", { name: "アイテム編集" });
    await otherEditor
      .getByRole("combobox", { name: /^ホール設定/ })
      .selectOption("@hall:" + JSON.stringify(["map", "１日目マップ", "west"]));
    await otherEditor
      .getByRole("button", { name: "保存", exact: true })
      .click();
    const otherReview = other.getByRole("dialog", {
      name: "所属・配置の変更を確認",
    });
    await expect(otherReview).toBeVisible();
    await otherReview
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
    await expect(otherReview).toBeHidden();
    await expect
      .poll(() => stored(page, "eventConsistency"))
      .toMatchObject({
        [eventName]: {
          days: {
            "1日目": {
              maps: {
                "１日目マップ": { assignments: { "1": { hallId: "west" } } },
              },
            },
          },
        },
      });
    const before = await Promise.all(
      ["eventLists", "eventConsistency", "executeModeItems"].map((store) =>
        stored(page, store),
      ),
    );

    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
    await expect(review).toBeVisible();
    await expect(review).toContainText("西館 → 指定解除");
    expect(
      await Promise.all(
        ["eventLists", "eventConsistency", "executeModeItems"].map((store) =>
          stored(page, store),
        ),
      ),
    ).toEqual(before);
    await review
      .getByRole("button", {
        name: outcome === "save" ? "確認して保存" : "取消",
        exact: true,
      })
      .click();
    await expect(review).toBeHidden();
    if (outcome === "cancel") {
      expect(
        await Promise.all(
          ["eventLists", "eventConsistency", "executeModeItems"].map((store) =>
            stored(page, store),
          ),
        ),
      ).toEqual(before);
    } else {
      expect(await stored(page, "eventLists")).toMatchObject({
        [eventName]: expect.arrayContaining([
          expect.objectContaining({ id: "1", eventDate: "2日目" }),
        ]),
      });
      const saved = (await stored(
        page,
        "eventConsistency",
      )) as EventConsistencyStore;
      for (const key of ["1日目マップ", "１日目マップ"]) {
        const visits = saved[eventName].days["1日目"].maps[key];
        expect(visits.assignments["1"]).toBeUndefined();
        expect(
          visits.hallVisitLists.flatMap((list) => list.itemIds),
        ).not.toContain("1");
      }
      expect(await stored(page, "executeModeItems")).toMatchObject({
        [eventName]: { "1日目": ["2"], "2日目": ["3", "1"] },
      });
    }
    await page.reload();
    expect(await stored(page, "eventLists")).toMatchObject({
      [eventName]: expect.arrayContaining([
        expect.objectContaining({
          id: "1",
          eventDate: outcome === "save" ? "2日目" : "1日目",
        }),
      ]),
    });
  });
}

for (const action of [
  "cancel",
  "undo",
  "reorder",
  "save",
  "discard transition",
] as const) {
  test(`another-tab equal replacement expires the old visit ${action} and reopens from the restored baseline`, async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await restore(page, mapBackup());
    await reorderVisitList(page);
    if (action !== "discard transition")
      await page
        .getByRole("button", { name: "左側に移動", exact: true })
        .click();
    const other = await context.newPage();
    const replacement = mapBackup();
    replacement.data.executeModeItems[eventName]["1日目"] = ["2", "1"];
    // Includes an exactly equal replacement: ID, day, order, and item content.
    const savedBefore = await stored(page, "eventLists");
    await restore(other, replacement, `「${eventName}」の復元内容を確認`);
    const restoredItems = await stored(page, "eventLists");
    expect(restoredItems).toEqual(savedBefore);
    const restoredConsistency = await stored(page, "eventConsistency");
    await page.bringToFront();
    if (action === "undo")
      await page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }).click();
    else if (action === "reorder") await dragSecondVisitFirst(page);
    else if (action === "discard transition") {
      await page
        .getByRole("button", { name: "イベント一覧", exact: true })
        .click();
      await page
        .getByRole("button", { name: "キャンセル（破棄）", exact: true })
        .click();
    } else
      await page
        .getByRole("button", {
          name: action === "save" ? "確定" : "キャンセル",
          exact: true,
        })
        .click();
    await expect(page.locator("[data-drag-item]")).toHaveCount(0);
    expect(await stored(page, "executeModeItems")).toMatchObject({
      [eventName]: { "1日目": ["2", "1"] },
    });
    expect(await stored(page, "eventLists")).toEqual(restoredItems);
    expect(await stored(page, "eventConsistency")).toEqual(restoredConsistency);
    await openVisitList(page);
    if (action === "discard transition")
      await page
        .getByRole("button", { name: "左側に移動", exact: true })
        .click();
    await expect(page.locator("[data-drag-item]").first()).toContainText(
      "サークル2",
    );
    await expect(
      page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }),
    ).toBeDisabled();
    await dragSecondVisitFirst(page);
    await expect
      .poll(() => stored(page, "executeModeItems"))
      .toMatchObject({ [eventName]: { "1日目": ["1", "2"] } });
    await page.getByRole("button", { name: "キャンセル", exact: true }).click();
    await expect
      .poll(() => stored(page, "executeModeItems"))
      .toMatchObject({ [eventName]: { "1日目": ["2", "1"] } });
    expect(errors).toEqual([]);
    await other.close();
  });
}

for (const outcome of ["save", "cancel", "abort"] as const) {
  test(`JSON restore reviews duplicate day destination and mode before one atomic ${outcome}`, async ({
    page,
  }) => {
    const source = backup([item("1"), item("2"), item("3", "2日目")]);
    source.data.dayModes[eventName][" 1日目　"] = "execute";
    await page.goto("/");
    await page
      .locator('input[aria-label="バックアップファイルを選択"]')
      .setInputFiles({
        name: "duplicate-days.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(source), "utf8"),
      });
    const restoreDialog = page.getByRole("dialog", {
      name: "バックアップからイベントを復元",
    });
    await restoreDialog.getByRole("radio", { name: /同名で置換/ }).check();
    const beforeModes = await stored(page, "dayModes");
    const beforeItems = await stored(page, "eventLists");
    await restoreDialog.getByRole("button", { name: "置換して復元" }).click();
    const review = page.getByRole("dialog", {
      name: `「${eventName}」の復元内容を確認`,
      exact: true,
    });
    await expect(review).toBeVisible();
    const destination = review.getByRole("combobox", {
      name: "統合先の日付表記",
    });
    await destination.selectOption(" 1日目　");
    await expect(destination).toHaveValue(" 1日目　");
    const mode = review.getByRole("combobox", { name: "統合後の表示モード" });
    await mode.selectOption("execute");
    await expect(mode).toHaveValue("execute");
    expect(await stored(page, "dayModes")).toEqual(beforeModes);
    expect(await stored(page, "eventLists")).toEqual(beforeItems);
    if (outcome === "cancel") {
      await review.getByRole("button", { name: "取消", exact: true }).click();
      await expect(review).toBeHidden();
    } else {
      if (outcome === "abort")
        await persistenceRealm(page).evaluate(() => {
          const original = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function (
            ...args: Parameters<typeof original>
          ) {
            if (this.name === "dayModes") {
              IDBObjectStore.prototype.put = original;
              throw new DOMException("復元の書き込み失敗", "AbortError");
            }
            return original.apply(this, args);
          };
        });
      await review
        .getByRole("button", { name: "確認して保存", exact: true })
        .click();
    }
    if (outcome !== "save") {
      if (outcome === "abort")
        await expect(
          page
            .getByRole("alert")
            .filter({ hasText: "復元の書き込み失敗" })
            .first(),
        ).toBeVisible();
      expect(await stored(page, "dayModes")).toEqual(beforeModes);
      expect(await stored(page, "eventLists")).toEqual(beforeItems);
      return;
    }
    await expect(restoreDialog).toBeHidden();
    const check = async () => {
      expect(await stored(page, "dayModes")).toEqual({
        [eventName]: { " 1日目　": "execute", "2日目": "edit" },
      });
      expect(await stored(page, "executeModeItems")).toEqual({
        [eventName]: { " 1日目　": ["1", "2"], "2日目": ["3"] },
      });
      expect(await stored(page, "eventLists")).toEqual(source.data.eventLists);
    };
    await check();
    await page.reload();
    await expect(
      page.locator('input[aria-label="バックアップファイルを選択"]'),
    ).toBeAttached();
    await check();
  });
}
