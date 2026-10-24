import { readBrowserEventLists } from "./shopping-transfer-persisted-store";
import { expect, test, type Page } from "@playwright/test";

const eventName = "セルからの限数編集";
const day = "1日目";
const limitedItem = {
  id: "limited",
  circle: "限数サークル",
  title: "ユーザー登録の限数品目",
  eventDate: day,
  block: "A",
  number: "1",
  price: 500,
  quantity: 5,
  purchaseStatus: "LimitedPurchase",
  limitedPurchasedQuantity: 2,
  remarks: "エラーが発生しました、という誤動作を防ぐ検証",
};
const map = {
  maxRow: 5,
  maxCol: 5,
  cells: [],
  mergedCells: [],
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
interface WorkerObservation {
  pending: number[];
  mutations: string[];
}
async function observeWorker(page: Page) {
  await page.addInitScript(() => {
    const observation: WorkerObservation = { pending: [], mutations: [] };
    Object.assign(window, { __cellPopupEditWorker: observation });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes("persistence.worker")) return;
        const send = this.postMessage.bind(this);
        this.postMessage = (message: { id: number; method: string }) => {
          observation.pending.push(message.id);
          if (!message.method.startsWith("read")) {
            observation.mutations.push(message.method);
          }
          send(message);
        };
        this.addEventListener(
          "message",
          (event: MessageEvent<{ id: number }>) => {
            observation.pending = observation.pending.filter(
              (id) => id !== event.data.id,
            );
          },
        );
      }
    };
  });
}
async function workerObservation(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __cellPopupEditWorker: WorkerObservation })
        .__cellPopupEditWorker,
  );
}
async function durableState(page: Page) {
  const visits = await page.evaluate(
    async ({ eventName, day }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("EventShoppingPlannerDB");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const visits = await new Promise<{ value: string[] }>(
          (resolve, reject) => {
            const request = database
              .transaction("executeModeItems", "readonly")
              .objectStore("executeModeItems")
              .get(
                "__esp_internal__:day-record:v1:" +
                  JSON.stringify([eventName, [day]]),
              );
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          },
        );
        return visits.value;
      } finally {
        database.close();
      }
    },
    { eventName, day },
  );
  const lists = await readBrowserEventLists<{ id: string }>(page);
  return {
    visits,
    item: lists[eventName].find((item) => item.id === "limited"),
  };
}
function popup(page: Page) {
  return page.getByRole("dialog", { name: "A-1のアイテム一覧", exact: true });
}
function detail(page: Page) {
  return page.getByRole("dialog", { name: "アイテム編集", exact: true });
}
async function restore(page: Page, visits = ["limited"]) {
  await observeWorker(page);
  await page.goto("/");
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "cell-popup-limited-edit.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          kind: "event-shopping-planner-backup",
          version: 1,
          exportedAt: "2026-10-18T00:00:00.000Z",
          eventSettings: { blockDetectionSettings: {} },
          data: {
            eventLists: { [eventName]: [limitedItem] },
            eventMetadata: {},
            executeModeItems: { [eventName]: { [day]: visits } },
            dayModes: { [eventName]: { [day]: "edit" } },
            mapData: { [eventName]: { "1日目マップ": map } },
            mapRotationSettings: {},
            mapViewportSettings: {},
            routeSettings: {},
            hallDefinitions: {},
            hallRouteSettings: {},
          },
        }),
        "utf8",
      ),
    });
  const restoreDialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await restoreDialog.getByRole("radio", { name: /同名で置換/ }).check();
  await restoreDialog.getByRole("button", { name: "置換して復元" }).click();
  await expect(restoreDialog).toBeHidden();
  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  await expect
    .poll(async () => (await workerObservation(page)).pending)
    .toEqual([]);
  await expect
    .poll(async () => (await durableState(page)).visits)
    .toEqual(visits);
  expect(
    page
      .workers()
      .some((worker) => worker.url().includes("persistence.worker")),
  ).toBe(true);
  await page.evaluate(() => {
    (
      window as unknown as { __cellPopupEditWorker: WorkerObservation }
    ).__cellPopupEditWorker.mutations = [];
  });
  await page.locator("canvas").click({ position: { x: 42, y: 42 } });
  await expect(popup(page)).toBeVisible();
}
async function assertDetailAndCancel(page: Page, visits = ["limited"]) {
  const editor = detail(page);
  await expect(editor).toBeVisible();
  await expect(popup(page)).toBeHidden();
  await expect(
    editor.getByRole("textbox", { name: "実購入数", exact: true }),
  ).toHaveValue("2");
  await expect(
    editor.getByRole("textbox", { name: "購入予定量", exact: true }),
  ).toHaveValue("5");
  await editor
    .getByRole("textbox", { name: "購入予定量", exact: true })
    .fill("6");
  await editor.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(editor).toBeHidden();
  // Wait beyond the row's long-press timer, so leaked timers and delayed writes surface.
  await page.waitForTimeout(650);
  await expect(
    page.getByRole("button", { name: "✏️ 編集", exact: true }),
  ).toBeHidden();
  expect((await workerObservation(page)).mutations).toEqual([]);
  expect(await durableState(page)).toMatchObject({ visits, item: limitedItem });
  await test.info().attach("cell-popup-edit-before-reload", {
    body: JSON.stringify(
      {
        durable: await durableState(page),
        worker: await workerObservation(page),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await page.reload();
  await page.getByText(eventName, { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
  expect(await durableState(page)).toMatchObject({ visits, item: limitedItem });
}

test.afterEach(async ({ page }, testInfo) => {
  if (page.isClosed()) return;
  try {
    await testInfo.attach("cell-popup-edit-observation", {
      body: JSON.stringify(
        {
          durable: await durableState(page),
          worker: await workerObservation(page),
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } catch (error) {
    await testInfo.attach("cell-popup-edit-observation-unavailable", {
      body: String(error),
      contentType: "text/plain",
    });
  }
});

test("direct mouse click opens the real limited editor without changing or saving visits", async ({
  page,
}) => {
  await restore(page);
  await popup(page)
    .getByRole("button", { name: "限数を編集", exact: true })
    .click();
  await assertDetailAndCancel(page);
});

test("direct mouse click preserves an unregistered item without adding or saving visits", async ({
  page,
}) => {
  await restore(page, []);
  await popup(page)
    .getByRole("button", { name: "限数を編集", exact: true })
    .click();
  await assertDetailAndCancel(page, []);
});

test("direct mouse entry saves the real detail edit once and retains limited quantities and visits on reload", async ({
  page,
}) => {
  await restore(page);
  await popup(page)
    .getByRole("button", { name: "限数を編集", exact: true })
    .click();
  const editor = detail(page);
  await expect(
    editor.getByRole("textbox", { name: "実購入数", exact: true }),
  ).toHaveValue("2");
  await expect(
    editor.getByRole("textbox", { name: "購入予定量", exact: true }),
  ).toHaveValue("5");
  const remarks = "ユーザー登録のメモを詳細編集から保存";
  await editor
    .getByRole("textbox", { name: "利用者メモ", exact: true })
    .fill(remarks);
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect
    .poll(async () => (await durableState(page)).item)
    .toMatchObject({ ...limitedItem, remarks });
  expect((await durableState(page)).visits).toEqual(["limited"]);
  expect((await workerObservation(page)).mutations).toHaveLength(1);
  await test.info().attach("cell-popup-edit-before-reload", {
    body: JSON.stringify(
      {
        durable: await durableState(page),
        worker: await workerObservation(page),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await page.reload();
  await page.getByText(eventName, { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
  expect(await durableState(page)).toMatchObject({
    visits: ["limited"],
    item: { ...limitedItem, remarks },
  });
});
test("keyboard Enter opens the same limited editor without changing or saving visits", async ({
  page,
}) => {
  await restore(page);
  const edit = popup(page).getByRole("button", {
    name: "限数を編集",
    exact: true,
  });
  await edit.focus();
  await edit.press("Enter");
  await assertDetailAndCancel(page);
});

test("holding the child edit button does not trigger the row long-press menu", async ({
  page,
}) => {
  await restore(page);
  await popup(page)
    .getByRole("button", { name: "限数を編集", exact: true })
    .click({ delay: 650 });
  await assertDetailAndCancel(page);
});

test("row long press still opens the legacy entry and then the real limited editor", async ({
  page,
}) => {
  await restore(page);
  await popup(page)
    .getByText(limitedItem.circle, { exact: true })
    .click({ delay: 650 });
  await page.getByRole("button", { name: "✏️ 編集", exact: true }).click();
  await detail(page)
    .getByRole("button", { name: "限数を編集", exact: true })
    .click();
  await assertDetailAndCancel(page);
});

test("ordinary row mouse clicks still remove and add visits without changing the limited item", async ({
  page,
}) => {
  await restore(page);
  const rowText = popup(page).getByText(limitedItem.circle, { exact: true });
  await rowText.click();
  await expect.poll(async () => (await durableState(page)).visits).toEqual([]);
  await expect(
    popup(page).getByText("タップで追加", { exact: true }),
  ).toBeVisible();
  await rowText.click();
  await expect
    .poll(async () => (await durableState(page)).visits)
    .toEqual(["limited"]);
  await expect(popup(page).getByText("訪問先", { exact: true })).toBeVisible();
  expect((await durableState(page)).item).toMatchObject(limitedItem);
  expect((await workerObservation(page)).mutations).toHaveLength(2);
});

test.describe("mobile touch", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("touch tap opens the real limited editor without changing or saving visits", async ({
    page,
  }) => {
    await restore(page);
    await popup(page)
      .getByRole("button", { name: "限数を編集", exact: true })
      .tap();
    await assertDetailAndCancel(page);
  });
});
