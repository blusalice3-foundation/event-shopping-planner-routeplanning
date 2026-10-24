import { readBrowserEventLists } from "./shopping-transfer-persisted-store";
import { expect, test, type Page } from "@playwright/test";
import { migrateLegacyConsistency } from "../../src/features/consistency/domain/migration";
import {
  sheetCsv,
  sheetSnapshot,
  SHEET_EVENT,
} from "../../src/test/sheetImportOptionalUrlFixtures";

async function stored(page: Page, name: string) {
  if (name === "eventLists") return readBrowserEventLists(page);
  return page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const request = database
          .transaction(name)
          .objectStore(name)
          .get("data");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, name);
}
async function restore(
  page: Page,
  count = 4,
  mode: "edit" | "execute" | "focus" = "edit",
  source = true,
  withMap = false,
) {
  const data = sheetSnapshot(count);
  if (count) data.eventLists[SHEET_EVENT][0].protectionLevel = "full";
  if (withMap) {
    data.mapData[SHEET_EVENT] = {
      "1日目マップ": {
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
            numberCells: [{ row: 2, col: 2, value: 1 }],
          },
        ],
      },
    };
    data.hallDefinitions[SHEET_EVENT] = {
      "1日目マップ": [
        {
          id: "hall",
          name: "東館",
          vertices: [
            { row: 1, col: 1 },
            { row: 1, col: 5 },
            { row: 5, col: 5 },
            { row: 5, col: 1 },
          ],
        },
      ],
    };
    const legacy = { ...data } as Partial<typeof data>;
    delete legacy.eventConsistency;
    data.eventConsistency =
      migrateLegacyConsistency(legacy).data.eventConsistency;
  }
  data.dayModes[SHEET_EVENT]["1日目"] = mode;
  if (source)
    data.eventMetadata[SHEET_EVENT] = {
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/original/edit",
      spreadsheetSheetName: "品目表",
      lastImportDate: "",
    };
  await page.goto("/");
  await page.getByLabel("バックアップファイルを選択").setInputFiles({
    name: "fixture.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        kind: "event-shopping-planner-backup",
        version: 2,
        exportedAt: "2026-10-17T00:00:00.000Z",
        data,
      }),
    ),
  });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog.getByRole("button", { name: "置換して復元" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: SHEET_EVENT, exact: true }),
  ).toBeVisible();
}
async function finishAddition(page: Page, expectedCount = 3) {
  const review = page.getByRole("dialog", {
    name: "所属・配置の変更を確認",
    exact: true,
  });
  await expect
    .poll(
      async () =>
        (await review.isVisible()) ||
        (
          (await stored(page, "eventLists"))[SHEET_EVENT] as
            | unknown[]
            | undefined
        )?.length === expectedCount,
    )
    .toBe(true);
  if (await review.isVisible())
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
  await expect
    .poll(async () => (await stored(page, "eventLists"))[SHEET_EVENT])
    .toHaveLength(expectedCount);
  await expect(
    page.getByRole("heading", { name: SHEET_EVENT, exact: true }),
  ).toBeVisible();
}
for (const storage of ["direct", "worker"])
  test.describe(`sheet import and optional URL: ${storage}`, () => {
    test.use({ serviceWorkers: "block" });
    test.beforeEach(async ({ page }) => {
      if (storage === "direct")
        await page.addInitScript(() => {
          Object.defineProperty(window, "Worker", {
            value: undefined,
            configurable: true,
          });
        });
      page.on("dialog", (dialog) => dialog.accept());
    });
    for (const count of [150, 500])
      for (const kind of ["items-only", "source-switch"] as const) {
        test(`${kind} ${count}: ordinary exclusions survive the real event-list review, cancellation and save/reload`, async ({
          page,
        }) => {
          await page.route("**/api/google-sheets-csv", (route) =>
            route.fulfill({
              status: 200,
              contentType: "text/csv; charset=utf-8",
              body: sheetCsv(count, "excluded"),
            }),
          );
          await restore(page, count, "edit", kind === "items-only");
          const open = async () => {
            const list = page.getByRole("button", {
              name: "イベント一覧",
              exact: true,
            });
            if (await list.isVisible()) await list.click();
            await page
              .getByRole("button", { name: "メニュー", exact: true })
              .click();
            await page
              .getByRole("button", { name: "🔄 アイテム更新", exact: true })
              .click();
            if (kind === "source-switch") {
              await page
                .getByRole("textbox", {
                  name: "スプレッドシートURL",
                  exact: true,
                })
                .fill("https://docs.google.com/spreadsheets/d/new/edit");
              await page
                .getByRole("button", { name: "更新", exact: true })
                .click();
            }
          };
          await open();
          const summary = page.getByRole("region", { name: "シート取込結果" });
          await expect(summary).toContainText(
            `取込対象: 0件、必須項目不足による除外: ${count}行`,
          );
          await expect(summary.locator("li")).toHaveCount(20);
          await expect(
            page.getByText(`削除候補: ${count - 1}件、削除から保護: 1件`, {
              exact: true,
            }),
          ).toBeVisible();
          const before = await stored(page, "eventLists");
          const metadata = await stored(page, "eventMetadata");
          await page
            .getByRole("button", { name: "キャンセル", exact: true })
            .last()
            .click();
          expect(await stored(page, "eventLists")).toEqual(before);
          expect(await stored(page, "eventMetadata")).toEqual(metadata);
          await open();
          const confirm = page.getByRole("button", {
            name:
              kind === "source-switch"
                ? "更新元を切り替えて更新"
                : "更新を実行",
            exact: true,
          });
          await expect(confirm).toBeEnabled();
          await confirm.click();
          await expect(summary).toBeHidden();
          await expect
            .poll(async () => (await stored(page, "eventLists"))[SHEET_EVENT])
            .toHaveLength(1);
          await page.reload();
          expect((await stored(page, "eventLists"))[SHEET_EVENT]).toEqual([
            expect.objectContaining({ id: "item-0", protectionLevel: "full" }),
          ]);
          if (kind === "source-switch")
            expect(
              (await stored(page, "eventMetadata"))[SHEET_EVENT],
            ).toMatchObject({
              spreadsheetUrl: "https://docs.google.com/spreadsheets/d/new/edit",
            });
        });
      }
    test("new URL import excludes incomplete rows, saves no-URL items and keeps zero-result input", async ({
      page,
    }) => {
      let csv = sheetCsv(4, "excluded");
      await page.route("**/api/google-sheets-csv", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/csv; charset=utf-8",
          body: csv,
        }),
      );
      await page.goto("/");
      await page
        .getByRole("button", { name: "新規リスト作成", exact: true })
        .click();
      await page.getByLabel("即売会名", { exact: true }).fill(SHEET_EVENT);
      const input = page.getByLabel("スプレッドシートURLからインポート", {
        exact: true,
      });
      await input.fill("https://docs.google.com/spreadsheets/d/new/edit");
      await page
        .getByRole("button", { name: "URLからインポート", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "シート取込結果" }),
      ).toContainText("取込対象: 0件");
      await expect(input).toHaveValue(
        "https://docs.google.com/spreadsheets/d/new/edit",
      );
      expect(Object.keys((await stored(page, "eventLists")) ?? {})).toEqual([]);
      csv = sheetCsv(4, "mixed");
      await page
        .getByRole("button", { name: "URLからインポート", exact: true })
        .click();
      await finishAddition(page);
      await page.reload();
      await page.getByText(SHEET_EVENT, { exact: true }).click();
      const items = (await stored(page, "eventLists"))[SHEET_EVENT] as object[];
      expect(
        items.every(
          (item) => !Object.prototype.hasOwnProperty.call(item, "url"),
        ),
      ).toBe(true);
      await expect(
        page.getByRole("heading", { name: SHEET_EVENT, exact: true }),
      ).toBeVisible();
    });
    test("seven-column repaste keeps blank-row URLs aligned through save and reload", async ({
      page,
    }) => {
      await page.goto("/");
      await page
        .getByRole("button", { name: "新規リスト作成", exact: true })
        .click();
      await page.getByLabel("即売会名", { exact: true }).fill(SHEET_EVENT);
      const circles = page.getByLabel("M列 サークル名", { exact: true });
      const paste = async (text: string) =>
        circles.evaluate((element, text) => {
          const clipboardData = new DataTransfer();
          clipboardData.setData("text", text);
          element.dispatchEvent(
            new ClipboardEvent("paste", {
              clipboardData,
              bubbles: true,
              cancelable: true,
            }),
          );
        }, text);
      const first = "サークルA\t1日目\t東A\t01a\t新刊A\t1000\t備考A";
      const last = "サークルB\t1日目\t東A\t03a\t新刊B\t500\t備考B";
      await paste([first, first, last].join("\n"));
      const urls = page.getByLabel("URL（7列貼り付け対象外）", { exact: true });
      const originalUrls = "https://a.test\nhttps://blank.test\nhttps://b.test";
      await urls.fill(originalUrls);
      await paste([first, "", last, ""].join("\r\n"));
      await expect(circles).toHaveValue("サークルA\n\nサークルB");
      await expect(urls).toHaveValue(originalUrls);
      await page
        .getByRole("button", { name: "リストを作成", exact: true })
        .click();
      await finishAddition(page, 2);
      await page.reload();
      await page.getByText(SHEET_EVENT, { exact: true }).click();
      await expect(
        page.getByRole("heading", { name: SHEET_EVENT, exact: true }),
      ).toBeVisible();
      const items = (await stored(page, "eventLists"))[SHEET_EVENT] as object[];
      expect(items).toHaveLength(2);
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            circle: "サークルA",
            url: "https://a.test",
            title: "新刊A",
          }),
          expect.objectContaining({
            circle: "サークルB",
            url: "https://b.test",
            title: "新刊B",
          }),
        ]),
      );
    });
    for (const mode of ["edit", "execute", "focus"] as const) {
      test(`${mode}: adds a no-URL item and persists it across reload`, async ({
        page,
      }) => {
        await restore(page, 2, mode);
        if (mode === "edit") {
          await page
            .getByRole("button", { name: "アイテム追加", exact: true })
            .click();
          await page
            .getByLabel("サークル名", { exact: true })
            .fill("URLなし手動追加");
          await page
            .getByRole("button", { name: "リストに追加", exact: true })
            .click();
        } else {
          if (mode === "focus")
            await page
              .getByTitle("新規アイテム追加", { exact: true })
              .first()
              .click();
          else
            await page
              .getByRole("button", {
                name: "このスペースにアイテムを追加",
                exact: true,
              })
              .first()
              .click();
          const dialog = page.getByRole("dialog").filter({
            has: page.getByRole("heading", {
              name: "新規アイテム追加",
              exact: true,
            }),
          });
          await dialog
            .getByRole("combobox", { name: "サークル名", exact: true })
            .or(
              dialog.getByRole("textbox", { name: "サークル名", exact: true }),
            )
            .fill("URLなし手動追加");
          await dialog
            .getByRole("button", { name: "リストに追加", exact: true })
            .click();
          await expect(dialog).toBeHidden();
        }
        await finishAddition(page);
        await page.reload();
        const items = (await stored(page, "eventLists"))[SHEET_EVENT] as Array<{
          circle: string;
        }>;
        const item = items.find((item) => item.circle === "URLなし手動追加")!;
        expect(item).toBeTruthy();
        expect(Object.prototype.hasOwnProperty.call(item, "url")).toBe(false);
      });
    }
    test("map cell: adds a no-URL item with its selected location and persists it across reload", async ({
      page,
    }) => {
      await restore(page, 2, "execute", true, true);
      await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
      await page.locator("canvas").click({ position: { x: 42, y: 42 } });
      const popup = page.getByRole("dialog", {
        name: "A-1のアイテム一覧",
        exact: true,
      });
      await popup
        .getByRole("button", { name: "新規アイテム追加", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "新規アイテム追加",
        exact: true,
      });
      await dialog
        .getByRole("combobox", { name: "サークル名", exact: true })
        .or(dialog.getByRole("textbox", { name: "サークル名", exact: true }))
        .fill("セルからURLなし追加");
      await dialog
        .getByRole("button", { name: "リストに追加", exact: true })
        .click();
      await finishAddition(page);
      await expect(dialog).toBeHidden();
      await page.reload();
      const items = (await stored(page, "eventLists"))[SHEET_EVENT] as Array<{
        circle: string;
      }>;
      const item = items.find((item) => item.circle === "セルからURLなし追加")!;
      expect(item).toMatchObject({
        eventDate: "1日目",
        block: "A",
        number: "1",
      });
      expect(Object.prototype.hasOwnProperty.call(item, "url")).toBe(false);
    });
    test("removes an existing URL through the guarded editor and persists its absence", async ({
      page,
    }) => {
      await restore(page, 2);
      const card = page
        .locator('[data-item-id="item-0"]')
        .first()
        .locator(":scope > div.rounded-lg")
        .first();
      const edit = async (url: string) => {
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
        const editor = page.getByRole("dialog", {
          name: "アイテム編集",
          exact: true,
        });
        await editor
          .getByRole("textbox", { name: "URL", exact: true })
          .fill(url);
        await editor.getByRole("button", { name: "保存", exact: true }).click();
        await expect(editor).toBeHidden();
      };
      await edit("https://existing.test");
      await edit("");
      await expect
        .poll(async () =>
          Object.prototype.hasOwnProperty.call(
            ((await stored(page, "eventLists"))[SHEET_EVENT] as object[])[0],
            "url",
          ),
        )
        .toBe(false);
      await page.reload();
      expect(
        Object.prototype.hasOwnProperty.call(
          ((await stored(page, "eventLists"))[SHEET_EVENT] as object[])[0],
          "url",
        ),
      ).toBe(false);
    });
  });

test("OP06: edited planned quantity survives limited status and real save/reload", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await restore(page, 2);
  const card = page
    .locator('[data-item-id="item-0"]')
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
  const editor = page.getByRole("dialog", {
    name: "アイテム編集",
    exact: true,
  });
  await editor.getByLabel("数量", { exact: true }).selectOption("3");
  await editor
    .getByLabel("購入状態", { exact: true })
    .selectOption("LimitedPurchase");
  await expect(editor.getByLabel("購入予定量", { exact: true })).toHaveValue(
    "3",
  );
  await editor.getByLabel("実購入数", { exact: true }).fill("2");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect
    .poll(async () =>
      (
        (await stored(page, "eventLists"))[SHEET_EVENT] as Array<{
          id: string;
          quantity: number;
          limitedPurchasedQuantity: number;
        }>
      ).find((i) => i.id === "item-0"),
    )
    .toMatchObject({
      quantity: 3,
      limitedPurchasedQuantity: 2,
      purchaseStatus: "LimitedPurchase",
    });
  await page.reload();
  expect(
    ((await stored(page, "eventLists"))[SHEET_EVENT] as object[])[0],
  ).toMatchObject({ quantity: 3, limitedPurchasedQuantity: 2 });
});

test("OP11: failed URL update reopens with submitted URL and empty sheet name", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.route("**/api/google-sheets-csv", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await restore(page, 2, "edit", true);
  await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page
    .getByRole("button", { name: "🔄 アイテム更新", exact: true })
    .click();
  const url = page.getByLabel("スプレッドシートURL", { exact: true });
  await expect(url).toBeVisible();
  await url.fill("https://docs.google.com/spreadsheets/d/retried/edit");
  await page.getByLabel("シート名（オプション）", { exact: true }).fill("");
  await page.getByRole("button", { name: "更新", exact: true }).click();
  await expect(url).toHaveValue(
    "https://docs.google.com/spreadsheets/d/retried/edit",
  );
  await expect(
    page.getByLabel("シート名（オプション）", { exact: true }),
  ).toHaveValue("");
  expect((await stored(page, "eventMetadata"))[SHEET_EVENT]).toMatchObject({
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/original/edit",
    spreadsheetSheetName: "品目表",
  });
});

test("OP10: CSV read failure is reported and same file selection retries", async ({
  page,
}) => {
  const alerts: string[] = [];
  page.on("dialog", async (dialog) => {
    alerts.push(dialog.message());
    await dialog.accept();
  });
  await page.addInitScript(() => {
    const original = File.prototype.text;
    let failed = false;
    File.prototype.text = function () {
      if (this.name === "retry.csv" && !failed) {
        failed = true;
        return Promise.reject(
          new DOMException("unreadable", "NotReadableError"),
        );
      }
      return original.call(this);
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "新規リスト作成", exact: true })
    .click();
  await page.getByLabel("即売会名", { exact: true }).fill(SHEET_EVENT);
  const input = page.locator('input[type="file"][accept=".csv"]');
  const file = {
    name: "retry.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(sheetCsv(2), "utf8"),
  };
  await input.setInputFiles(file);
  await expect
    .poll(() =>
      alerts.some((message) =>
        message.includes("CSVファイルを読み取れませんでした"),
      ),
    )
    .toBe(true);
  expect(await input.inputValue()).toBe("");
  await input.setInputFiles(file);
  const review = page.getByRole("dialog", {
    name: "所属・配置の変更を確認",
    exact: true,
  });
  await expect(review).toBeVisible();
  await review
    .getByRole("button", { name: "確認して保存", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: SHEET_EVENT, exact: true }),
  ).toBeVisible();
  await page.reload();
  expect((await stored(page, "eventLists"))[SHEET_EVENT]).toHaveLength(2);
});

test("OP07: late JSON cannot reopen after newer candidate cancellation", async ({
  page,
}) => {
  const alerts: string[] = [];
  page.on("dialog", async (dialog) => {
    alerts.push(dialog.message());
    await dialog.accept();
  });
  await page.addInitScript(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      if (this.name === "late.json")
        return new Promise<string>((resolve) => {
          (window as unknown as { releaseOldJson: () => void }).releaseOldJson =
            () => {
              void original.call(this).then(resolve);
            };
        });
      return original.call(this);
    };
  });
  await page.goto("/");
  const fixture = Buffer.from(
    JSON.stringify({
      kind: "event-shopping-planner-backup",
      version: 2,
      exportedAt: "2026-10-18T00:00:00.000Z",
      data: sheetSnapshot(2),
    }),
    "utf8",
  );
  const input = page.getByLabel("バックアップファイルを選択");
  await input.setInputFiles({
    name: "late.json",
    mimeType: "application/json",
    buffer: fixture,
  });
  await input.setInputFiles({
    name: "new.json",
    mimeType: "application/json",
    buffer: fixture,
  });
  const candidate = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
    exact: true,
  });
  await expect(candidate).toBeVisible();
  await candidate
    .getByRole("button", { name: "キャンセル", exact: true })
    .click();
  await expect(candidate).toBeHidden();
  await page.evaluate(() => {
    (window as unknown as { releaseOldJson: () => void }).releaseOldJson();
  });
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await expect(candidate).toBeHidden();
  expect(alerts).toEqual([]);
});
