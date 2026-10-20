import { expect, test, type Page } from "@playwright/test";

const eventName = "優先操作の結合検証";
const items = [
  { id: "first", eventDate: "1日目", title: "最初の入力", number: "1" },
  { id: "second", eventDate: "1日目", title: "次の入力", number: "1" },
  { id: "next", eventDate: "1日目", title: "次の訪問先", number: "2" },
  { id: "other", eventDate: "2日目", title: "別日の入力", number: "1" },
].map((item) => ({
  ...item,
  circle: item.id,
  block: "A",
  price: 500,
  quantity: 5,
  purchaseStatus: "None",
  remarks: "ユーザー登録",
}));
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
      numberCells: [
        { row: 2, col: 2, value: 1 },
        { row: 3, col: 2, value: 2 },
      ],
    },
  ],
};
async function restore(page: Page) {
  await page.goto("/");
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "priority-interaction.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          kind: "event-shopping-planner-backup",
          version: 1,
          exportedAt: "2026-10-18T00:00:00.000Z",
          eventSettings: { blockDetectionSettings: {} },
          data: {
            eventLists: { [eventName]: items },
            eventMetadata: {},
            executeModeItems: {
              [eventName]: {
                "1日目": ["first", "second", "next"],
                "2日目": ["other"],
              },
            },
            dayModes: {
              [eventName]: { "1日目": "execute", "2日目": "execute" },
            },
            mapData: {
              [eventName]: { "1日目マップ": map, "2日目マップ": map },
            },
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
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog.getByRole("button", { name: "置換して復元" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
}
async function swipe(page: Page, selector: string) {
  await page.locator(selector).evaluate((root) => {
    const start = new Touch({
      identifier: 1,
      target: root,
      clientX: 250,
      clientY: 150,
    });
    const end = new Touch({
      identifier: 1,
      target: root,
      clientX: 50,
      clientY: 150,
    });
    root.dispatchEvent(
      new TouchEvent("touchstart", { bubbles: true, touches: [start] }),
    );
    root.dispatchEvent(
      new TouchEvent("touchmove", { bubbles: true, touches: [end] }),
    );
    root.dispatchEvent(
      new TouchEvent("touchend", { bubbles: true, changedTouches: [end] }),
    );
    root.dispatchEvent(new TouchEvent("touchcancel", { bubbles: true }));
  });
}

for (const layout of ["pc", "smartphone"] as const)
  test(`bulk limited input contains touch and keyboard across confirmations and the next item: ${layout}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await restore(page);
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
    await page.getByTitle("集中モード", { exact: true }).click();
    const origin = page
      .getByRole("button", { name: "全限数", exact: true })
      .first();
    await origin.click();
    const main = page.getByRole("dialog", {
      name: "限数購入の数量",
      exact: true,
    });
    const actual = main.getByRole("textbox", { name: "実購入数", exact: true });
    await expect(actual).toBeFocused();
    await swipe(page, '[aria-labelledby="limited-purchase-dialog-title"]');
    await expect(
      main.getByText("対象: 最初の入力", { exact: true }),
    ).toBeVisible();
    await actual.fill("5");
    await main.getByRole("button", { name: "保存", exact: true }).click();
    const confirm = page.getByRole("dialog", {
      name: "購入済として保存しますか？",
      exact: true,
    });
    await expect(confirm).toBeVisible();
    await confirm.press("Escape");
    await expect(confirm).toBeHidden();
    await expect(
      main.getByRole("button", { name: "保存", exact: true }),
    ).toBeFocused();
    await main.getByRole("button", { name: "保存", exact: true }).click();
    await confirm
      .getByRole("button", { name: "購入済にする", exact: true })
      .click();
    await expect(
      main.getByText("対象: 次の入力", { exact: true }),
    ).toBeVisible();
    await expect(actual).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      main.getByRole("button", { name: "保存", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(actual).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(main).toBeHidden();
    await expect(origin).toBeFocused();
    await origin.click();
    await expect(actual).toBeFocused();
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
  });

test("keyboard day changes discard popup input while retaining the map canvas", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await restore(page);
  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  const canvas = page.locator("canvas");
  await canvas.evaluate((element) => {
    element.dataset.priorityIdentity = "kept";
  });
  await canvas.click({ position: { x: 42, y: 42 } });
  const popup = page.getByRole("dialog", {
    name: "A-1のアイテム一覧",
    exact: true,
  });
  await expect(popup).toBeVisible();
  const day2 = page.getByRole("button", { name: /^2日目/ }).first();
  await day2.focus();
  await day2.press("Enter");
  await expect(popup).toBeHidden();
  await expect(canvas).toHaveAttribute("data-priority-identity", "kept");
  const day1 = page.getByRole("button", { name: /^1日目/ }).first();
  await day1.focus();
  await day1.press("Enter");
  await expect(popup).toBeHidden();
  await canvas.click({ position: { x: 42, y: 42 } });
  await popup
    .getByRole("button", { name: "新規アイテム追加", exact: true })
    .click();
  const add = page.getByRole("dialog", {
    name: "新規アイテム追加",
    exact: true,
  });
  await expect(add.getByLabel("参加日", { exact: true })).toHaveValue("1日目");
  const circle = add
    .getByRole("combobox", { name: "サークル名", exact: true })
    .or(add.getByRole("textbox", { name: "サークル名", exact: true }));
  await expect(circle).toHaveValue("");
  await circle.fill("未送信の入力");
  await day2.focus();
  await day2.press("Enter");
  await expect(add).toBeHidden();
  await expect(popup).toBeHidden();
  await expect(canvas).toHaveAttribute("data-priority-identity", "kept");
  await day1.focus();
  await day1.press("Enter");
  await expect(add).toBeHidden();
  await expect(popup).toBeHidden();
  expect(errors).toEqual([]);
});
