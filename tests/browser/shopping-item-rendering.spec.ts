import { expect, test } from "@playwright/test";

const eventName = "選択肢と保存の描画回帰";
const first = {
  id: "rendering-first",
  eventDate: "1日目",
  circle: "ユーザー登録サークル",
  title: "選択肢の確認",
  block: "A",
  number: "1",
  purchaseStatus: "None",
  price: 1255,
  quantity: 25,
  remarks: "エラーが発生しました",
};
const items = [
  first,
  ...Array.from({ length: 98 }, (_, index) => ({
    ...first,
    id: "rendering-fill-" + index,
    number: String(index + 3),
    price: 500,
    quantity: 1,
  })),
  { ...first, id: "rendering-second", number: "2", price: 2000, quantity: 1 },
  {
    ...first,
    id: "rendering-day2",
    eventDate: "2日目",
    price: 500,
    quantity: 1,
  },
];
const backup = {
  kind: "event-shopping-planner-backup",
  version: 1,
  exportedAt: "2026-10-07T00:00:00.000Z",
  eventSettings: { blockDetectionSettings: {} },
  data: {
    eventLists: { [eventName]: items },
    eventMetadata: {},
    executeModeItems: {
      [eventName]: {
        "1日目": items
          .filter((item) => item.eventDate === "1日目")
          .map((item) => item.id),
        "2日目": ["rendering-day2"],
      },
    },
    dayModes: { [eventName]: { "1日目": "execute", "2日目": "execute" } },
    mapData: {},
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallDefinitions: {},
    hallRouteSettings: {},
  },
};

for (const layout of ["pc", "smartphone"]) {
  test(
    "native card choices keep their values and save across day changes: " +
      layout,
    async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/");
      await page
        .locator('input[aria-label="バックアップファイルを選択"]')
        .setInputFiles({
          name: "rendering.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(backup), "utf8"),
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
      }
      if (layout === "smartphone") {
        const grouping = page.getByRole("button", {
          name: "スペース別",
          exact: true,
        });
        if (!(await grouping.getAttribute("class"))?.includes("bg-blue-600"))
          await grouping.click();
      }
      const row = page.locator('[data-item-id="rendering-first"]');
      const other = page.locator('[data-item-id="rendering-second"]');
      const price = row.getByRole("combobox", {
        name: "購入金額",
        exact: true,
      });
      const quantity = row.getByRole("combobox", {
        name: "購入予定数量",
        exact: true,
      });
      await expect(price).toHaveValue("1255");
      await expect(price.locator("option")).toHaveCount(103);
      await expect(quantity).toHaveValue("25");
      await expect(quantity.locator("option")).toHaveCount(21);
      await price.selectOption("");
      await expect(price).toHaveValue("");
      await price.selectOption("0");
      await quantity.selectOption("20");
      await expect(price.locator("option")).toHaveCount(102);
      await expect(quantity.locator("option")).toHaveCount(20);
      await expect(
        other.getByRole("combobox", { name: "購入金額" }),
      ).toHaveValue("2000");
      await expect(
        other.getByRole("combobox", { name: "購入予定数量" }),
      ).toHaveValue("1");

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
                      (item: { id: string }) => item.id === "rendering-first",
                    ),
                  );
                request.onerror = () => reject(request.error);
              });
            } finally {
              database.close();
            }
          }, eventName),
        )
        .toMatchObject({ id: "rendering-first", price: 0, quantity: 20 });
      await page.getByRole("button", { name: /^2日目/ }).click();
      await expect(
        page
          .locator('[data-item-id="rendering-day2"]')
          .getByRole("combobox", { name: "購入金額" }),
      ).toHaveValue("500");
      await page.getByRole("button", { name: /^1日目/ }).click();
      await expect(price).toHaveValue("0");
      await expect(quantity).toHaveValue("20");
      await expect(price.locator("option")).toHaveCount(102);
      await expect(quantity.locator("option")).toHaveCount(20);
      expect(errors).toEqual([]);
    },
  );
}
