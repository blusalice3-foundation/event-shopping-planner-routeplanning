import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const eventName = "削除する地図付きイベント";
const retainedEventName = "残す地図付きイベント";

function backup(name: string, large = false) {
  const itemId = `${name}-item`;
  const width = large ? 500 : 6;
  const height = large ? 300 : 6;
  const map = {
    maxRow: height,
    maxCol: width,
    mergedCells: [],
    cells: Array.from({ length: width * height }, (_, index) => ({
      row: Math.floor(index / width) + 1,
      col: (index % width) + 1,
      value: index === width + 1 ? 1 : null,
      backgroundColor: null,
      borders: { top: null, right: null, bottom: null, left: null },
    })),
    blocks: [
      {
        name: "A",
        startRow: 1,
        startCol: 1,
        endRow: height,
        endCol: width,
        numberCells: [{ row: 2, col: 2, value: 1 }],
      },
    ],
  };
  const hall = {
    id: "hall",
    name: "東館",
    vertices: [
      { row: 1, col: 1 },
      { row: 1, col: width },
      { row: height, col: width },
      { row: height, col: 1 },
    ],
  };
  const maps = { "1日目マップ": map, "１日目マップ": map };
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-11-04T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: {
        [name]: [
          {
            id: itemId,
            eventDate: "1日目",
            circle: "ユーザー登録",
            title: "削除確認の回帰検証",
            block: "A",
            number: "1",
            price: 500,
            purchaseStatus: "None",
            quantity: 1,
            remarks: "エラーが発生しました",
          },
        ],
      },
      eventMetadata: {
        [name]: {
          spreadsheetUrl: "",
          spreadsheetSheetName: "購入リスト",
          lastImportDate: "2026-11-04T00:00:00.000Z",
        },
      },
      executeModeItems: { [name]: { "1日目": [itemId] } },
      dayModes: { [name]: { "1日目": "edit" } },
      mapData: { [name]: maps },
      mapRotationSettings: {
        [name]: {
          "1日目マップ": {
            initialAngle: 0,
            mapTabAngle: 90,
            focusModeAngle: 0,
          },
        },
      },
      mapViewportSettings: {
        [name]: {
          "1日目マップ": { zoomLevel: 100, offsetX: 4, offsetY: 8 },
        },
      },
      routeSettings: {
        [name]: {
          "1日目マップ": { isRouteVisible: true, visitOrder: [] },
        },
      },
      hallDefinitions: {
        [name]: { "1日目マップ": [hall], "１日目マップ": [hall] },
      },
      hallRouteSettings: {
        [name]: {
          "1日目マップ": {
            hallOrder: ["hall"],
            hallVisitLists: [{ hallId: "hall", itemIds: [itemId] }],
          },
          "１日目マップ": {
            hallOrder: ["hall"],
            hallVisitLists: [{ hallId: "hall", itemIds: [itemId] }],
          },
        },
      },
    },
  };
}

async function restore(page: Page, name: string, large = false) {
  await page.goto("/");
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "event-deletion.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup(name, large)), "utf8"),
    });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog.getByRole("button", { name: "置換して復元" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
}

async function storedEvent(page: Page, event: string) {
  return page.evaluate(async (eventName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = [
      "eventLists",
      "eventMetadata",
      "executeModeItems",
      "dayModes",
      "mapData",
      "mapRotationSettings",
      "mapViewportSettings",
      "routeSettings",
      "hallDefinitions",
      "hallRouteSettings",
      "eventConsistency",
    ];
    try {
      return Object.fromEntries(
        await Promise.all(
          stores.map(
            (name) =>
              new Promise<[string, Array<{ key: string; value: unknown }>]>(
                (resolve, reject) => {
                  const records: Array<{ key: string; value: unknown }> = [];
                  const request = db
                    .transaction(name, "readonly")
                    .objectStore(name)
                    .openCursor();
                  request.onerror = () => reject(request.error);
                  request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor) {
                      resolve([name, records]);
                      return;
                    }
                    const key = String(cursor.key);
                    const value = cursor.value;
                    if (
                      key === "data" &&
                      Object.prototype.hasOwnProperty.call(value, eventName)
                    ) {
                      records.push({ key, value: value[eventName] });
                    } else if (
                      key.startsWith("__esp_internal__:day-record:v1:") &&
                      value.eventName === eventName
                    ) {
                      records.push({ key, value });
                    } else if (
                      name === "mapData" &&
                      key.startsWith("mapData:") &&
                      JSON.parse(key.slice("mapData:".length))[0] === eventName
                    ) {
                      records.push({ key, value });
                    }
                    cursor.continue();
                  };
                },
              ),
          ),
        ),
      );
    } finally {
      db.close();
    }
  }, event);
}

async function observeDeleteReview(page: Page) {
  await page.evaluate((title) => {
    const state = window as Window & { __eventDeleteReviewSeen?: boolean };
    state.__eventDeleteReviewSeen = false;
    const isReview = (element: Element) =>
      element.matches('[role="dialog"]') &&
      element.getAttribute("aria-label") === title;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (
            node instanceof Element &&
            (isReview(node) ||
              Array.from(node.querySelectorAll('[role="dialog"]')).some(
                isReview,
              ))
          ) {
            state.__eventDeleteReviewSeen = true;
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }, `「${eventName}」を削除`);
}

async function expectNoDeleteReview(page: Page) {
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __eventDeleteReviewSeen?: boolean })
          .__eventDeleteReviewSeen,
    ),
  ).toBe(false);
  await expect(
    page.getByRole("button", { name: "確認して保存", exact: true }),
  ).toHaveCount(0);
}

async function openDeleteMenu(page: Page) {
  await page
    .locator("li")
    .filter({ hasText: eventName })
    .getByRole("button", { name: "メニュー", exact: true })
    .click();
}

test("canceling the native deletion confirmation preserves the event and its map", async ({
  page,
}) => {
  await restore(page, eventName);
  const before = await storedEvent(page, eventName);
  await observeDeleteReview(page);
  const nativeDialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    nativeDialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await openDeleteMenu(page);
  await page.getByRole("button", { name: "削除", exact: true }).click();
  expect(nativeDialogs).toEqual([
    `「${eventName}」を削除しますか？この操作は元に戻せません。`,
  ]);
  await expectNoDeleteReview(page);
  expect(await storedEvent(page, eventName)).toEqual(before);
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await page.getByText(eventName, { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
  await page.reload();
  expect(await storedEvent(page, eventName)).toEqual(before);
});

test("native OK deletes a large map event without creating another confirmation and preserves other events", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await restore(page, retainedEventName);
  await restore(page, eventName, true);
  const retained = await storedEvent(page, retainedEventName);
  await observeDeleteReview(page);
  const nativeDialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    nativeDialogs.push(dialog.message());
    await dialog.accept();
  });
  await openDeleteMenu(page);
  await page.getByRole("button", { name: "削除", exact: true }).click();
  await expect(page.getByText(eventName, { exact: true })).toHaveCount(0);
  await expectNoDeleteReview(page);
  expect(nativeDialogs).toEqual([
    `「${eventName}」を削除しますか？この操作は元に戻せません。`,
  ]);
  expect(Object.values(await storedEvent(page, eventName)).flat()).toEqual([]);
  expect(await storedEvent(page, retainedEventName)).toEqual(retained);
  await page.getByText(retainedEventName, { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: retainedEventName, exact: true }),
  ).toBeVisible();
  await page.reload();
  expect(Object.values(await storedEvent(page, eventName)).flat()).toEqual([]);
  expect(await storedEvent(page, retainedEventName)).toEqual(retained);
  expect(errors).toEqual([]);
});
