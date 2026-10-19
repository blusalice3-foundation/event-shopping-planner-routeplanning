import { expect, test, type Page, type Worker } from "@playwright/test";
import ExcelJS from "exceljs";
import {
  sheetCsv,
  sheetSnapshot,
  SHEET_EVENT,
} from "../../src/test/sheetImportOptionalUrlFixtures";

test.use({ serviceWorkers: "block", trace: "off", video: "off" });

type FailureProbe = {
  __lateFailureHeld(): boolean;
  __lateFailureRelease(): void;
  __lateFailureMethods: string[];
};

async function restore(page: Page, withSource: boolean) {
  const data = sheetSnapshot(2);
  data.dayModes[SHEET_EVENT]["1日目"] = "execute";
  if (withSource)
    data.eventMetadata[SHEET_EVENT] = {
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/original/edit",
      spreadsheetSheetName: "品目表",
      lastImportDate: "",
    };
  await page.goto("/");
  await page.getByLabel("バックアップファイルを選択").setInputFiles({
    name: "late-save.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        kind: "event-shopping-planner-backup",
        version: 2,
        exportedAt: "2026-10-19T00:00:00.000Z",
        data,
      }),
      "utf8",
    ),
  });
  const candidate = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await candidate.getByRole("radio", { name: /同名で置換/ }).check();
  await candidate.getByRole("button", { name: "置換して復元" }).click();
  await expect(candidate).toBeHidden();
  await expect(page.getByRole("heading", { name: SHEET_EVENT })).toBeVisible();
}

async function holdNextWrite(page: Page): Promise<Worker> {
  const worker = page
    .workers()
    .find((value) => value.url().includes("persistence.worker"));
  if (!worker) throw new Error("Persistence Worker missing");
  await worker.evaluate(() => {
    const receive = self.onmessage!;
    let held: MessageEvent | undefined;
    let armed = true;
    const methods: string[] = [];
    self.onmessage = (event) => {
      const method = String(event.data.method);
      methods.push(method);
      if (
        armed &&
        (["commit", "commitDay", "day", "items"].includes(method) ||
          method.startsWith("save"))
      ) {
        armed = false;
        held = event;
        return;
      }
      receive.call(self, event);
    };
    Object.assign(self, {
      __lateFailureMethods: methods,
      __lateFailureHeld: () => Boolean(held),
      __lateFailureRelease: () => {
        if (!held) throw new Error("No pending write");
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (
          ...args: Parameters<IDBObjectStore["put"]>
        ) {
          if (this.name === "eventLists") {
            IDBObjectStore.prototype.put = put;
            throw new DOMException(
              "Injected delayed save failure",
              "AbortError",
            );
          }
          return put.apply(this, args);
        };
        const event = held;
        held = undefined;
        receive.call(self, event);
      },
    });
  });
  await page
    .locator('[data-item-id="item-0"]')
    .first()
    .getByRole("button", { name: /^Current status:/ })
    .click();
  await expect
    .poll(() =>
      worker.evaluate(() =>
        (self as unknown as FailureProbe).__lateFailureHeld(),
      ),
    )
    .toBe(true);
  return worker;
}

const cases = [
  { kind: "url", menu: "🔄 アイテム更新", title: "スプレッドシートURLを更新" },
  { kind: "update", menu: "🔄 アイテム更新", title: "アイテム更新の確認" },
  { kind: "rename", menu: "✏️ 名称変更", title: "即売会名を変更" },
  {
    kind: "map",
    menu: "🗺️ マップデータ取り込み",
    title: "📋 マップデータ取り込み",
  },
  { kind: "menu", menu: null, title: SHEET_EVENT },
] as const;

for (const entry of cases)
  test(`delayed real save failure keeps keyboard inside ${entry.kind} until close`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/google-sheets-csv", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/csv; charset=utf-8",
        body: sheetCsv(2, "excluded"),
      }),
    );
    await restore(page, entry.kind === "update");
    const worker = await holdNextWrite(page);
    await page
      .getByRole("button", { name: "イベント一覧", exact: true })
      .click();
    await page.getByRole("button", { name: "メニュー", exact: true }).click();
    if (entry.kind === "map") {
      const book = new ExcelJS.Workbook();
      book.addWorksheet("1日目").getCell("A1").value = "ユーザー登録";
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: entry.menu, exact: true }).click();
      await (
        await chooser
      ).setFiles({
        name: "map.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from(await book.xlsx.writeBuffer()),
      });
    } else if (entry.menu)
      await page.getByRole("button", { name: entry.menu, exact: true }).click();
    // Find the visible overlay independently of the newly added dialog semantics,
    // so the baseline test reaches the original late-failure focus regression.
    const heading = page.getByRole("heading", {
      name: entry.title,
      exact: true,
    });
    const overlay = heading.locator(
      'xpath=ancestor::div[contains(@class,"fixed")][1]',
    );
    await expect(overlay).toBeVisible();
    if (entry.kind === "url")
      await page.getByLabel("シート名（オプション）").fill("ユーザー登録");
    else if (entry.kind === "rename")
      await page.getByLabel("新しい即売会名").fill("ユーザー登録");
    else
      await heading.evaluate((element) => {
        element.tabIndex = -1;
        element.focus();
      });
    await worker.evaluate(() =>
      (self as unknown as FailureProbe).__lateFailureRelease(),
    );
    const retry = page.getByRole("button", {
      name: "保留中の保存を再試行",
      exact: true,
    });
    await expect(retry).toBeVisible();
    expect(
      await overlay.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    const before = await worker.evaluate(() => [
      ...(self as unknown as FailureProbe).__lateFailureMethods,
    ]);
    // Keep Enter on a harmless dialog descendant; exercise both Tab boundaries.
    await heading.evaluate((element) => {
      element.tabIndex = -1;
      element.focus();
    });
    await page.keyboard.press("Enter");
    await page.keyboard.press("Shift+Tab");
    expect(
      await overlay.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    await page.keyboard.press("Tab");
    expect(
      await overlay.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    expect(
      await worker.evaluate(() => [
        ...(self as unknown as FailureProbe).__lateFailureMethods,
      ]),
    ).toEqual(before);
    const cancelName = "キャンセル";
    await overlay
      .getByRole("button", { name: cancelName, exact: true })
      .click();
    await expect(overlay).toBeHidden();
    await expect(retry).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(retry).toBeHidden();
    await expect
      .poll(async () =>
        worker.evaluate(
          () => (self as unknown as FailureProbe).__lateFailureMethods.length,
        ),
      )
      .toBeGreaterThan(before.length);
    expect(errors).toEqual([]);
  });
