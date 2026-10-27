import { expect, test, type Page } from "@playwright/test";

const eventName = "実行モードの順序保護";
const day = "1日目";
const row = (id: string) =>
  `[data-item-id="${id}"]:not([data-space-group-key]):not(.esp-shopping-touch-clone)`;

test.use({ serviceWorkers: "block", video: "off", trace: "off" });

async function restore(page: Page) {
  const items = ["1", "2", "3"].map((id) => ({
    id,
    eventDate: day,
    circle: "ユーザー登録" + id,
    title: "新刊" + id,
    block: "A",
    number: id,
    price: 500,
    quantity: 1,
    purchaseStatus: "None",
    remarks: "エラーが発生しました",
  }));
  const source = {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-27T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: { [eventName]: items },
      eventMetadata: {},
      executeModeItems: {
        [eventName]: { [day]: items.map((item) => item.id) },
      },
      dayModes: { [eventName]: { [day]: "execute" } },
      mapData: {},
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
  await page.goto("/");
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "execution-reordering.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(source), "utf8"),
    });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog.getByRole("button", { name: "置換して復元" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(row("1"))).toBeVisible();
}

async function readSavedData(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Record<string, unknown[]>>((resolve, reject) => {
        const names = Array.from(db.objectStoreNames);
        const transaction = db.transaction(names, "readonly");
        const result: Record<string, unknown[]> = {};
        for (const name of names) {
          const request = transaction.objectStore(name).getAll();
          request.onsuccess = () => {
            result[name] = request.result;
          };
        }
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  });
}

const visibleOrder = (page: Page) =>
  page
    .locator("[data-item-id]:not([data-space-group-key])")
    .evaluateAll((elements) => [
      ...new Set(
        elements
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => element.getAttribute("data-item-id")),
      ),
    ]);

for (const layout of ["pc", "smartphone"] as const) {
  for (const grouped of [false, true]) {
    test(`${layout}, grouped=${grouped}: execution rejects native and touch reordering without changing saved data`, async ({
      page,
    }) => {
      await page.setViewportSize(
        layout === "pc"
          ? { width: 1440, height: 1000 }
          : { width: 390, height: 844 },
      );
      await restore(page);
      const grouping = page
        .getByRole("button", { name: "スペース別", exact: true })
        .first();
      if (
        (await grouping.getAttribute("class"))?.includes("bg-blue-600") !==
        grouped
      )
        await grouping.click();
      await expect.poll(() => visibleOrder(page)).toEqual(["1", "2", "3"]);
      await expect(
        page.getByRole("button", { name: "上に移動", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "下に移動", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.locator('[data-item-id][draggable="true"]'),
      ).toHaveCount(0);
      const before = await readSavedData(page);
      await page.locator(row("1")).evaluate((element) => {
        const transfer = new DataTransfer();
        transfer.setData(
          "text/plain",
          JSON.stringify({ itemId: "1", sourceColumn: "execute" }),
        );
        element.dispatchEvent(
          new DragEvent("dragstart", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          }),
        );
        const target = document.querySelector('[data-item-id="3"]')!;
        target.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          }),
        );
        target.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          }),
        );
        element.dispatchEvent(
          new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }),
        );
        const touch = new Touch({
          identifier: 1,
          target: element,
          clientX: 80,
          clientY: 180,
        });
        element.dispatchEvent(
          new TouchEvent("touchstart", {
            bubbles: true,
            cancelable: true,
            touches: [touch],
            changedTouches: [touch],
          }),
        );
      });
      await page.waitForTimeout(300);
      await expect(page.locator(".esp-shopping-touch-clone")).toHaveCount(0);
      await page
        .locator(row("1"))
        .dispatchEvent("touchend", { touches: [], changedTouches: [] });
      await page.waitForTimeout(650);
      expect(await readSavedData(page)).toEqual(before);
      expect(await visibleOrder(page)).toEqual(["1", "2", "3"]);
      await page.reload();
      await page.getByText(eventName, { exact: true }).click();
      await expect.poll(() => visibleOrder(page)).toEqual(["1", "2", "3"]);
    });
  }
}

test("editing still changes the execution order and retains it after reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await restore(page);
  await page.locator('button[title="編集モード"]').click();
  const execute = page.locator('[data-shopping-drag-column="execute"]');
  const first = execute.locator(row("1"));
  await expect(
    first.getByRole("button", { name: "下に移動", exact: true }),
  ).toBeEnabled();
  await first.getByRole("button", { name: "下に移動", exact: true }).click();
  await expect
    .poll(() =>
      execute
        .locator("[data-item-id]:not([data-space-group-key])")
        .evaluateAll((elements) => [
          ...new Set(
            elements
              .filter((element) => element.getClientRects().length > 0)
              .map((element) => element.getAttribute("data-item-id")),
          ),
        ]),
    )
    .toEqual(["2", "1", "3"]);
  await page.locator('button[title="実行モード"]').click();
  await expect.poll(() => visibleOrder(page)).toEqual(["2", "1", "3"]);
  await page.reload();
  await page.getByText(eventName, { exact: true }).click();
  await expect.poll(() => visibleOrder(page)).toEqual(["2", "1", "3"]);
});
