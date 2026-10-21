import { readBrowserEventLists } from "./shopping-transfer-persisted-store";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const eventName = "設定保存障害の検証";
const sourceItem = {
  id: "preference-item",
  circle: "ユーザー登録",
  title: "設定障害中の新刊",
  eventDate: "1日目",
  block: "A",
  number: "1",
  price: 500,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "既存メモ",
};
async function seed(page: Page) {
  await page.goto("/");
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "preference-failure.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          kind: "event-shopping-planner-backup",
          version: 1,
          exportedAt: "2026-10-18T00:00:00.000Z",
          eventSettings: { blockDetectionSettings: {} },
          data: {
            eventLists: { [eventName]: [sourceItem] },
            eventMetadata: {},
            executeModeItems: { [eventName]: { "1日目": [sourceItem.id] } },
            dayModes: { [eventName]: { "1日目": "edit" } },
            mapData: {},
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
  const restore = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await restore.getByRole("radio", { name: /同名で置換/ }).check();
  await restore.getByRole("button", { name: "置換して復元" }).click();
  await expect(restore).toBeHidden();
  await expect(page.locator(`[data-item-id="${sourceItem.id}"]`)).toBeVisible();
}
async function storedItems(page: Page) {
  return readBrowserEventLists<typeof sourceItem>(page);
}

test("localStorage quota failures preserve the app, current settings, item persistence and JSON backup", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Object.assign(window, { __preferenceWriteAttempts: [] as string[] });
    Storage.prototype.setItem = function (key, value) {
      if (this === window.localStorage) {
        (
          window as unknown as { __preferenceWriteAttempts: string[] }
        ).__preferenceWriteAttempts.push(key);
        throw new DOMException("Injected quota failure", "QuotaExceededError");
      }
      return set.call(this, key, value);
    };
  });
  await page.reload();
  await page.getByText(eventName, { exact: true }).click();
  await expect(page.locator(`[data-item-id="${sourceItem.id}"]`)).toBeVisible();
  await page.getByTitle("表示項目の設定", { exact: true }).click();
  await page
    .getByTitle("システム設定 → ライトモードへ", { exact: true })
    .click();
  await page
    .getByTitle("ライトモード → ダークモードへ", { exact: true })
    .click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("radio", { name: "直角", exact: true }).check();
  await expect(
    page.getByRole("radio", { name: "直角", exact: true }),
  ).toBeChecked();
  await page.getByRole("checkbox", { name: /^保存状態を表示/ }).uncheck();
  await page
    .locator("div.fixed.inset-0.z-40")
    .first()
    .click({ position: { x: 2, y: 100 } });
  await page.getByTitle("表示項目の設定", { exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: /^保存状態を表示/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("radio", { name: "直角", exact: true }),
  ).toBeChecked();
  await page
    .locator("div.fixed.inset-0.z-40")
    .first()
    .click({ position: { x: 2, y: 100 } });
  await page
    .locator(`[data-item-id="${sourceItem.id}"]`)
    .getByRole("textbox", { name: "利用者メモ" })
    .fill("設定障害中に保存したメモ");
  await expect
    .poll(async () => (await storedItems(page))[eventName][0].remarks)
    .toBe("設定障害中に保存したメモ");
  await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONバックアップ保存", exact: true })
    .click();
  const file = await download;
  const saved = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(saved.data.eventLists[eventName][0]).toMatchObject({
    id: sourceItem.id,
    remarks: "設定障害中に保存したメモ",
  });
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __preferenceWriteAttempts: string[] })
          .__preferenceWriteAttempts,
    ),
  ).toEqual(
    expect.arrayContaining([
      "themeMode",
      "uiVisibilitySettings",
      "numberCellOutlineStyle",
    ]),
  );
  await page.reload();
  await page.getByText(eventName, { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "利用者メモ" })).toHaveValue(
    "設定障害中に保存したメモ",
  );
  expect(errors).toEqual([]);
});

for (const kind of ["read", "getter"] as const) {
  test(`unavailable localStorage ${kind} retains a visible app and backup failure guidance`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await seed(page);
    const before = await storedItems(page);
    await page.addInitScript((kind) => {
      if (kind === "getter") {
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          get() {
            throw new DOMException(
              "Injected storage getter failure",
              "SecurityError",
            );
          },
        });
      } else {
        const local = window.localStorage;
        const get = Storage.prototype.getItem;
        const key = Storage.prototype.key;
        Storage.prototype.getItem = function (name) {
          if (this === local)
            throw new DOMException(
              "Injected storage read failure",
              "SecurityError",
            );
          return get.call(this, name);
        };
        Storage.prototype.key = function (index) {
          if (this === local)
            throw new DOMException(
              "Injected storage enumeration failure",
              "SecurityError",
            );
          return key.call(this, index);
        };
      }
    }, kind);
    await page.reload();
    await expect(page.locator("#root")).not.toBeEmpty();
    const event = page.getByText(eventName, { exact: true });
    const recovery = page.getByRole("heading", {
      name: "保存データを安全に読み込めませんでした",
      exact: true,
    });
    await expect(event.or(recovery)).toBeVisible();
    if (await recovery.isVisible()) {
      await expect(page.getByRole("alert")).toBeVisible();
      expect(await storedItems(page)).toEqual(before);
      expect(errors).toEqual([]);
      await testInfo.attach(`storage-${kind}-outcome`, {
        body: "Existing startup recovery screen remained visible; no data changed.",
        contentType: "text/plain",
      });
      return;
    }
    await testInfo.attach(`storage-${kind}-outcome`, {
      body: "Migrated database remained available; backup failure guidance is checked below.",
      contentType: "text/plain",
    });
    await event.click();
    await expect(
      page.locator(`[data-item-id="${sourceItem.id}"]`),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "イベント一覧", exact: true })
      .click();
    const messages: string[] = [];
    page.on("dialog", async (dialog) => {
      messages.push(dialog.message());
      await dialog.accept();
    });
    const downloads: string[] = [];
    page.on("download", (file) => downloads.push(file.suggestedFilename()));
    await page
      .getByRole("button", { name: "JSONバックアップ保存", exact: true })
      .click();
    await expect
      .poll(() => messages)
      .toContain(
        "バックアップを完全に保存できなかったため、ファイルを作成しませんでした。現在のデータは変更されていません。",
      );
    expect(downloads).toEqual([]);
    expect(await storedItems(page)).toEqual(before);
    expect(errors).toEqual([]);
    await expect(
      page.getByRole("heading", {
        name: "保存済みの即売会リスト",
        exact: true,
      }),
    ).toBeVisible();
  });
}
