import type { EventConsistencyStore } from "../../src/types/consistency";
import { expect, test, type Page } from "@playwright/test";

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
async function restore(page: Page, data = backup()) {
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
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
}
async function stored(page: Page, store: string) {
  return page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const request = database
          .transaction(name, "readonly")
          .objectStore(name)
          .get("data");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, store);
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
async function reorderVisitList(page: Page) {
  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  await page.getByTitle("リスト表示に切り替え", { exact: true }).hover();
  await page.mouse.down();
  const openPanel = page.getByRole("button", {
    name: "📍 訪問リスト",
    exact: true,
  });
  await expect(openPanel).toBeVisible();
  await page.mouse.up();
  await openPanel.click();
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
  await restore(page, source);
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
  await page.evaluate(() => {
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
