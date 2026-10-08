import { expect, test, type Page } from "@playwright/test";
const eventName = "画面内描画の操作回帰";
const backup = (mode: "execute" | "focus", sameSpace = false) => {
  const days = ["1日目", "2日目"];
  const items = days.flatMap((day, dayIndex) =>
    Array.from({ length: 240 }, (_, index) => ({
      id: "viewport-" + dayIndex + "-" + index,
      eventDate: day,
      circle: "ユーザー登録サークル" + index,
      title: "新刊" + index,
      block: "A",
      number: String(sameSpace ? 1 : index + 1),
      price: 500,
      quantity: 1,
      purchaseStatus: "None",
      remarks: "エラーが発生しました",
    })),
  );
  const map = {
    maxRow: 100,
    maxCol: 100,
    mergedCells: [],
    cells: Array.from({ length: 10000 }, (_, index) => ({
      row: Math.floor(index / 100) + 1,
      col: (index % 100) + 1,
      value: String(index + 1),
      backgroundColor: null,
      borders: { top: null, right: null, bottom: null, left: null },
    })),
    blocks: [
      {
        name: "A",
        startRow: 1,
        startCol: 1,
        endRow: 100,
        endCol: 100,
        numberCells: Array.from({ length: 240 }, (_, index) => ({
          row: Math.floor(index / 100) + 1,
          col: (index % 100) + 1,
          value: index + 1,
        })),
      },
    ],
  };
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-07T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: { [eventName]: items },
      eventMetadata: {},
      executeModeItems: {
        [eventName]: Object.fromEntries(
          days.map((day) => [
            day,
            items
              .filter((item) => item.eventDate === day)
              .map((item) => item.id),
          ]),
        ),
      },
      dayModes: {
        [eventName]: Object.fromEntries(days.map((day) => [day, mode])),
      },
      mapData: {
        [eventName]: Object.fromEntries(
          days.map((day) => [day + "マップ", map]),
        ),
      },
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
};
const restore = async (
  page: Page,
  mode: "execute" | "focus",
  sameSpace = false,
) => {
  await page.goto("/");
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "viewport.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup(mode, sameSpace)), "utf8"),
    });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog.getByRole("button", { name: "置換して復元" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-item-id="viewport-0-0"]')).toBeVisible();
};
for (const layout of ["pc", "smartphone"] as const) {
  test(
    "retained viewport preserves offscreen navigation, native values and saving: " +
      layout,
    async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await restore(page, "execute");
      if (layout === "smartphone") {
        await page.getByTitle("表示項目の設定", { exact: true }).click();
        await page
          .getByTitle("スマートフォンモードに切替", { exact: true })
          .click();
        await page.setViewportSize({ width: 390, height: 844 });
        await page
          .locator("div.fixed.inset-0.z-40")
          .first()
          .click({ position: { x: 2, y: 100 } });
        const groups = page.getByRole("button", {
          name: "スペース別",
          exact: true,
        });
        if (!(await groups.getAttribute("class"))?.includes("bg-blue-600"))
          await groups.click();
      }
      await expect(
        page.locator('[data-list-renderer-strategy="retained-viewport"]'),
      ).toBeVisible();
      expect(await page.locator("[data-item-id]").count()).toBeLessThan(40);
      const first = page.locator('[data-item-id="viewport-0-0"]');
      const price = first.getByRole("combobox", {
        name: "購入金額",
        exact: true,
      });
      const original = await price.elementHandle();
      await price.selectOption("1000");
      await first
        .getByRole("combobox", { name: "購入予定数量", exact: true })
        .selectOption("7");
      await page
        .getByRole("listitem", {
          name: "A240 ユーザー登録サークル239 新刊239",
          exact: true,
        })
        .scrollIntoViewIfNeeded();
      const last = page.locator('[data-item-id="viewport-0-239"]');
      await expect(last).toBeVisible();
      await last
        .getByRole("combobox", { name: "購入金額", exact: true })
        .selectOption("2000");
      await expect
        .poll(() => original!.evaluate((element) => element.isConnected))
        .toBe(false);
      await page
        .getByRole("listitem", {
          name: "A1 ユーザー登録サークル0 新刊0",
          exact: true,
        })
        .scrollIntoViewIfNeeded();
      await expect(first).toBeVisible();
      await expect(price).toHaveValue("1000");
      await expect(
        first.getByRole("combobox", { name: "購入予定数量", exact: true }),
      ).toHaveValue("7");
      await expect
        .poll(() =>
          page.evaluate(async (event) => {
            const database = await new Promise<IDBDatabase>(
              (resolve, reject) => {
                const request = indexedDB.open("EventShoppingPlannerDB");
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              },
            );
            try {
              return await new Promise((resolve, reject) => {
                const request = database
                  .transaction("eventLists", "readonly")
                  .objectStore("eventLists")
                  .get("data");
                request.onsuccess = () =>
                  resolve(
                    request.result[event]?.find(
                      (item: { id: string }) => item.id === "viewport-0-239",
                    )?.price,
                  );
                request.onerror = () => reject(request.error);
              });
            } finally {
              database.close();
            }
          }, eventName),
        )
        .toBe(2000);
      await page.getByRole("button", { name: /^2日目/ }).click();
      await expect(page.locator('[data-item-id="viewport-1-0"]')).toBeVisible();
      await page.getByRole("button", { name: /^1日目/ }).click();
      await expect(price).toHaveValue("1000");
      expect(errors).toEqual([]);
    },
  );
}
test("a large single space defers cards inside the group", async ({ page }) => {
  await restore(page, "execute", true);
  await expect(
    page.locator('[data-list-renderer-strategy="retained-viewport"]'),
  ).toBeVisible();
  expect(await page.locator("[data-item-id]").count()).toBeLessThan(40);
  await page
    .getByRole("listitem", {
      name: "A1 ユーザー登録サークル239 新刊239",
      exact: true,
    })
    .scrollIntoViewIfNeeded();
  await expect(page.locator('[data-item-id="viewport-0-239"]')).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  await page.getByRole("button", { name: "全売切", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "事後通販･頒布可否確認" }),
  ).toBeVisible();
  await expect(
    page.locator('[data-list-renderer-strategy="retained-viewport"]'),
  ).toHaveAttribute("data-list-renderer", "virtual");
  await expect
    .poll(() => page.locator("[data-item-id]").count())
    .toBeLessThan(40);
});
test("focus map remains correct after quantity, purchase and visibility changes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await restore(page, "focus");
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.getByTitle("マップを表示", { exact: true }).click();
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  const readImage = () =>
    canvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const value = canvas.toDataURL();
      let hash = 2166136261;
      for (let index = 0; index < value.length; index += 1)
        hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
      return [canvas.width, canvas.height, value.length, hash >>> 0];
    });
  let previousImage = "";
  let stableImageCount = 0;
  await expect
    .poll(
      async () => {
        const next = JSON.stringify(await readImage());
        stableImageCount = next === previousImage ? stableImageCount + 1 : 0;
        previousImage = next;
        return stableImageCount >= 2;
      },
      { intervals: [50, 100, 100], timeout: 5000 },
    )
    .toBe(true);
  const image = await readImage();
  const first = page.locator('[data-item-id="viewport-0-0"]');
  await first
    .getByRole("combobox", { name: "購入予定数量", exact: true })
    .selectOption("7");
  await expect(
    first.getByRole("combobox", { name: "購入予定数量", exact: true }),
  ).toHaveValue("7");
  await expect.poll(() => readImage()).toEqual(image);
  await first.getByRole("button", { name: /Current status:/ }).click();
  await expect.poll(() => readImage()).not.toEqual(image);
  await page.getByTitle("マップを非表示", { exact: true }).click();
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.getByTitle("マップを表示", { exact: true }).click();
  await expect(canvas).toBeVisible();
  await expect(
    first.getByRole("combobox", { name: "購入予定数量", exact: true }),
  ).toHaveValue("7");
  await page.getByTitle("次の訪問先", { exact: true }).click();
  await expect(page.locator('[data-item-id="viewport-0-1"]')).toBeVisible();
  await page.getByTitle("前の訪問先", { exact: true }).click();
  await expect(first).toBeVisible();
  await expect(
    first.getByRole("combobox", { name: "購入予定数量", exact: true }),
  ).toHaveValue("7");
  expect(errors).toEqual([]);
});

test("keyboard focus reaches the native controls of a pending PC row", async ({
  page,
}) => {
  await restore(page, "execute");
  await page.locator("[data-viewport-focus-sentinel]").first().focus();
  await expect(
    page.locator("[data-viewport-focus-sentinel]:focus"),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      ["INPUT", "SELECT", "BUTTON", "A"].includes(
        document.activeElement?.tagName ?? "",
      ),
    ),
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(
    page.locator("[data-viewport-focus-sentinel]:focus"),
  ).toHaveCount(0);
});

test("focus mode defers a large visit with the map shown and hidden", async ({
  page,
}) => {
  await restore(page, "focus", true);
  expect(await page.locator("[data-item-id]").count()).toBeLessThan(40);
  await page.getByTitle("マップを表示", { exact: true }).click();
  await expect(page.locator("canvas")).toBeVisible();
  expect(await page.locator("[data-item-id]").count()).toBeLessThan(40);
  await page
    .getByRole("listitem", {
      name: "A1 ユーザー登録サークル239 新刊239",
      exact: true,
    })
    .scrollIntoViewIfNeeded();
  await expect(page.locator('[data-item-id="viewport-0-239"]')).toBeVisible();
  await page.getByTitle("マップを非表示", { exact: true }).click();
  await expect(page.locator("canvas")).toHaveCount(0);
});
