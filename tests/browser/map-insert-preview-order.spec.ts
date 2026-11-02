import { expect, test, type Page } from "@playwright/test";
import type { ShoppingItem } from "../../src/types/item";
import { readBrowserEventLists } from "./shopping-transfer-persisted-store";

const eventName = "地図の追加位置プレビュー検証";
const day = "1日目";
const mapKey = `${day}マップ`;
const makeItem = (id: string, block: string, number: string): ShoppingItem => ({
  id,
  eventDate: day,
  block,
  number,
  circle: id,
  title: `保持する本 ${id}`,
  priorityLevel: "none",
  price: 500,
  quantity: 2,
  purchaseStatus: "None",
  remarks: "ユーザー登録 エラーが発生しました",
});

function backup(raw: string[]) {
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-11-02T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: {
        [eventName]: [
          makeItem("a1", "A", "01a"),
          makeItem("hall-b", "B", "01a"),
          makeItem("b1", "A", "02a"),
          makeItem("new-a", "A", "03a"),
          makeItem("new-b", "B", "02a"),
        ],
      },
      eventMetadata: {},
      executeModeItems: { [eventName]: { [day]: raw } },
      dayModes: { [eventName]: { [day]: "edit" } },
      mapData: {
        [eventName]: {
          [mapKey]: {
            maxRow: 8,
            maxCol: 12,
            cells: [],
            mergedCells: [],
            blocks: [
              {
                name: "A",
                startRow: 1,
                startCol: 1,
                endRow: 6,
                endCol: 5,
                numberCells: [
                  { row: 2, col: 2, value: 1 },
                  { row: 3, col: 2, value: 2 },
                  { row: 4, col: 2, value: 3 },
                ],
              },
              {
                name: "B",
                startRow: 1,
                startCol: 7,
                endRow: 6,
                endCol: 11,
                numberCells: [
                  { row: 2, col: 8, value: 1 },
                  { row: 3, col: 8, value: 2 },
                ],
              },
            ],
          },
        },
      },
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {
        [eventName]: {
          [mapKey]: [
            {
              id: "hall-a",
              name: "Aホール",
              blockNames: ["A"],
              vertices: [
                { row: 1, col: 1 },
                { row: 1, col: 5 },
                { row: 6, col: 5 },
                { row: 6, col: 1 },
              ],
            },
            {
              id: "hall-b",
              name: "Bホール",
              blockNames: ["B"],
              vertices: [
                { row: 1, col: 7 },
                { row: 1, col: 11 },
                { row: 6, col: 11 },
                { row: 6, col: 7 },
              ],
            },
          ],
        },
      },
      hallRouteSettings: {},
    },
  };
}

async function showFlatList(page: Page) {
  const list = page.getByTitle("リスト表示に切り替え", { exact: true });
  if (await list.isVisible()) await list.click();
  const grouping = page
    .getByRole("button", { name: "スペース別", exact: true })
    .first();
  if ((await grouping.getAttribute("class"))?.includes("bg-blue-600"))
    await grouping.click();
}

async function displayIds(page: Page) {
  return page
    .locator(
      '[data-shopping-drag-column="execute"] [data-item-id]:not([data-space-group-key])',
    )
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-item-id")),
    );
}

async function restore(page: Page, phone: boolean, raw: string[]) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator("#loading-screen")).toBeHidden();
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "map-insert-preview.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup(raw)), "utf8"),
    });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog.getByRole("button", { name: "置換して復元" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
  if (phone) {
    await page.getByTitle("表示項目の設定", { exact: true }).click();
    await page
      .getByTitle("スマートフォンモードに切替", { exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator("div.fixed.inset-0.z-40")
      .first()
      .click({ position: { x: 2, y: 100 } });
  }
  await showFlatList(page);
  await expect.poll(() => displayIds(page)).toEqual(["a1", "b1", "hall-b"]);
}

async function savedExecute(page: Page) {
  return page.evaluate(
    async ({ eventName, day }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("EventShoppingPlannerDB");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<{ ids: string[]; checkpoint: unknown }>(
          (resolve, reject) => {
            const tx = db.transaction(
              ["executeModeItems", "syncQueue"],
              "readonly",
            );
            const store = tx.objectStore("executeModeItems");
            const root = store.get("data");
            const checkpoint = tx
              .objectStore("syncQueue")
              .get("__esp_internal__:checkpoint:v1:executeModeItems:data");
            const records: Array<{
              eventName: string;
              path: string[];
              value: unknown;
            }> = [];
            const cursor = store.openCursor();
            cursor.onsuccess = () => {
              if (!cursor.result) return;
              if (
                String(cursor.result.key).startsWith(
                  "__esp_internal__:day-record:v1:",
                )
              )
                records.push(cursor.result.value);
              cursor.result.continue();
            };
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
            tx.oncomplete = () => {
              const value = root.result;
              const ids =
                value?.kind === "event-shopping-planner-day-records"
                  ? records.find(
                      (record) =>
                        record.eventName === eventName &&
                        record.path.length === 1 &&
                        record.path[0] === day,
                    )?.value
                  : value?.[eventName]?.[day];
              resolve({ ids: ids as string[], checkpoint: checkpoint.result });
            };
          },
        );
      } finally {
        db.close();
      }
    },
    { eventName, day },
  );
}

async function openPreview(page: Page, pending: "new-a" | "new-b") {
  const point = pending === "new-a" ? { x: 42, y: 98 } : { x: 210, y: 70 };
  await page.locator("canvas").first().click({ position: point });
  const popup = page.getByRole("dialog", {
    name: pending === "new-a" ? /A-.*のアイテム一覧/ : /B-.*のアイテム一覧/,
  });
  await expect(popup).toBeVisible();
  await popup.getByText(pending, { exact: true }).first().click();
  const dialog = page.getByRole("dialog", {
    name: "追加位置を選択",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

const orders = [
  { name: "interleaved", raw: ["a1", "hall-b", "b1"] },
  { name: "contiguous", raw: ["a1", "b1", "hall-b"] },
];

for (const phone of [false, true]) {
  for (const order of orders) {
    for (const pending of ["new-a", "new-b"] as const) {
      test(`map preview keeps logical order and saves the selected ${pending} boundary: ${order.name}, ${phone ? "smartphone" : "PC"}`, async ({
        page,
      }, testInfo) => {
        const expectedRaw =
          pending === "new-a"
            ? order.name === "interleaved"
              ? ["a1", "hall-b", "b1", "new-a"]
              : ["a1", "b1", "new-a", "hall-b"]
            : order.name === "interleaved"
              ? ["a1", "new-b", "hall-b", "b1"]
              : ["a1", "b1", "new-b", "hall-b"];
        const expectedDisplay = ["a1", "b1", pending, "hall-b"];
        const proof: Record<string, unknown> = {
          phone,
          order: order.name,
          pending,
          initialRaw: order.raw,
          expectedRaw,
          expectedDisplay,
          stage: "restore",
        };
        try {
          await restore(page, phone, order.raw);
          const before = await savedExecute(page);
          expect(before.ids).toEqual(order.raw);
          const beforeItems = await readBrowserEventLists(page);
          proof.before = before;
          await page
            .getByTitle("マップ表示に切り替え", { exact: true })
            .click();
          await expect(
            page.locator('[data-route-item-count="3"]'),
          ).toBeVisible();
          const smart = page.getByTitle(/^スマート挿入:/);
          if ((await smart.getAttribute("title"))?.includes("無効"))
            await smart.click();
          if (!(await smart.getAttribute("title"))?.includes("プレビュー")) {
            await smart.hover();
            await page.mouse.down();
            await page.waitForTimeout(650);
            await page.mouse.up();
          }
          await expect(smart).toHaveAttribute("title", /有効.*プレビュー/);
          proof.stage = "preview";
          let dialog = await openPreview(page, pending);
          expect(
            await dialog.locator("span.truncate").allTextContents(),
          ).toEqual(["a1", "b1", "hall-b"]);
          expect(
            await dialog.locator("span.font-mono").allTextContents(),
          ).toEqual(["#1", "#2", "#3"]);
          await expect(
            dialog.getByRole("button", { name: /^挿入位置 [A-D] を選択$/ }),
          ).toHaveCount(4);
          expect(await savedExecute(page)).toEqual(before);
          await dialog
            .getByRole("button", { name: "キャンセル", exact: true })
            .click();
          await expect(dialog).toBeHidden();
          const afterCancel = await savedExecute(page);
          expect(afterCancel).toEqual(before);
          expect(await readBrowserEventLists(page)).toEqual(beforeItems);
          proof.afterCancel = afterCancel;
          proof.stage = "select";
          dialog = await openPreview(page, pending);
          await dialog
            .getByRole("button", { name: "挿入位置 C を選択", exact: true })
            .click();
          await expect(dialog).toBeHidden();
          await expect
            .poll(async () => (await savedExecute(page)).ids)
            .toEqual(expectedRaw);
          const after = await savedExecute(page);
          expect(after.ids.filter((id) => id !== pending)).toEqual(order.raw);
          expect(new Set(after.ids).size).toBe(after.ids.length);
          expect(after.ids.filter((id) => id === pending)).toHaveLength(1);
          expect(after.checkpoint).not.toEqual(before.checkpoint);
          expect(await readBrowserEventLists(page)).toEqual(beforeItems);
          proof.after = after;
          await showFlatList(page);
          await expect.poll(() => displayIds(page)).toEqual(expectedDisplay);
          proof.stage = "reload";
          await page.reload();
          await page.getByText(eventName, { exact: true }).click();
          await expect(
            page.getByRole("heading", { name: eventName, exact: true }),
          ).toBeVisible();
          await showFlatList(page);
          await expect.poll(() => displayIds(page)).toEqual(expectedDisplay);
          const reloaded = await savedExecute(page);
          expect(reloaded).toEqual(after);
          expect(await readBrowserEventLists(page)).toEqual(beforeItems);
          proof.reloaded = reloaded;
          proof.stage = "complete";
        } finally {
          await testInfo.attach("map-preview-order-and-durable-position", {
            body: Buffer.from(JSON.stringify(proof, null, 2), "utf8"),
            contentType: "application/json",
          });
        }
      });
    }
  }
}
