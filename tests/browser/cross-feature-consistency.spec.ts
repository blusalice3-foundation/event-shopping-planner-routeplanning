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
