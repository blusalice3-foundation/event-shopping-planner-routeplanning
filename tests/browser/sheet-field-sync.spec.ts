import { expect, test, type Page } from "@playwright/test";
import {
  DAY_RECORD_PREFIX,
  decodeDayRecords,
  hasDayRecordHead,
} from "../../src/persistence/db/dayRecordStorage";
import { createSheetIdentityFingerprint } from "../../src/utils/sheetIdentity";
import { allStores } from "./ios-xlsx-helpers";
import { readBrowserEventLists } from "./shopping-transfer-persisted-store";

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
async function restore(
  page: Page,
  data: unknown = backup(),
  reviewTitle?: string,
  expectedEventName = eventName,
) {
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
  if (reviewTitle) {
    const review = page.getByRole("dialog", { name: reviewTitle, exact: true });
    await expect(review).toBeVisible();
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
    await expect(review).toBeHidden();
  }
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: expectedEventName, exact: true }),
  ).toBeVisible();
}
async function storedExecution(page: Page) {
  const name = "executeModeItems";
  const rows = (await allStores(page))[name];
  const head = rows.find(({ key }) => key === "data")?.value;
  if (!hasDayRecordHead(head)) return head;
  const entries = new Map(
    rows
      .filter(
        ({ key }) =>
          typeof key === "string" && key.startsWith(DAY_RECORD_PREFIX),
      )
      .map(({ key, value }) => [String(key), value]),
  );
  return (await decodeDayRecords(name, head, entries)).data;
}

test.describe("sheet price and memo updates respect purchase locks", () => {
  test.use({ serviceWorkers: "block" });

  test("updates unlocked fields, preserves on-site edits after the purchase button locks an item, and persists empty updates @sheet-field-sync", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() =>
      localStorage.setItem("purchaseStatusControlMode", "radial"),
    );
    const records = ["1", "2"].map((id) => ({
      ...item(id),
      source: "spreadsheet",
      protectionLevel: "none",
      sheetIdentityFingerprint: createSheetIdentityFingerprint(
        500,
        "ユーザー登録",
      ),
    }));
    const source = backup(records);
    source.data.dayModes[eventName]["1日目"] = "execute";
    Object.assign(source.data.eventMetadata, {
      [eventName]: {
        spreadsheetUrl:
          "https://docs.google.com/spreadsheets/d/field-sync/edit",
        spreadsheetSheetName: "品目表",
        lastImportDate: "2026-11-13T00:00:00Z",
      },
    });
    let emptyUpdate = false;
    await page.route("**/api/google-sheets-csv", (route) => {
      const rows = records.map((record, index) => {
        const cells = Array<string>(27).fill("");
        cells[12] = record.circle;
        cells[13] = record.eventDate;
        cells[14] = record.block;
        cells[15] = record.number;
        cells[16] = record.title;
        cells[17] = index === 0 ? (emptyUpdate ? "" : "800") : "1200";
        cells[22] =
          index === 0
            ? emptyUpdate
              ? ""
              : "シート更新後の備考"
            : "シートの備考";
        cells[26] = String(record.quantity);
        return cells.join(",");
      });
      return route.fulfill({
        status: 200,
        contentType: "text/csv; charset=utf-8",
        body: [Array<string>(27).fill("header").join(","), ...rows].join("\n"),
      });
    });
    await restore(page, source);
    const purchasedCard = page.locator('[data-item-id="2"]').first();
    await purchasedCard
      .getByRole("combobox", { name: "購入金額", exact: true })
      .selectOption("900");
    await purchasedCard
      .getByRole("textbox", { name: "利用者メモ", exact: true })
      .fill("現地で追記した購入記録");
    await purchasedCard
      .getByRole("button", {
        name: "Current status: 未購入. Click to change.",
        exact: true,
      })
      .click();
    await page
      .getByRole("radio", { name: "Purchasedに変更", exact: true })
      .click();
    const protectedItem = {
      id: "2",
      price: 900,
      remarks: "現地で追記した購入記録",
      purchaseStatus: "Purchased",
      protectionLevel: "deletable",
    };
    await expect
      .poll(() => readBrowserEventLists(page))
      .toMatchObject({
        [eventName]: [
          expect.objectContaining({ id: "1", protectionLevel: "none" }),
          expect.objectContaining(protectedItem),
        ],
      });
    // The compact smartphone layout omits this control; saved locks apply on every layout.
    const lockButton = purchasedCard.getByRole("button", {
      name: "削除のみ許可",
      exact: true,
    });
    if ((await page.evaluate(() => window.innerWidth)) >= 768) {
      await expect(lockButton).toBeVisible();
    } else {
      await expect(lockButton).toHaveCount(0);
    }
    const executeBefore = await storedExecution(page);

    const runUpdate = async () => {
      const eventList = page.getByRole("button", {
        name: "イベント一覧",
        exact: true,
      });
      if (await eventList.isVisible()) await eventList.click();
      await page.getByRole("button", { name: "メニュー", exact: true }).click();
      await page
        .getByRole("button", { name: "🔄 アイテム更新", exact: true })
        .click();
      const review = page.getByRole("dialog", {
        name: "アイテム更新の確認",
        exact: true,
      });
      await expect(review).toBeVisible();
      await expect(review).toContainText(
        "空欄を含めてシートの価格・備考で上書き",
      );
      await expect(review).toContainText("更新から保護: 1件");
      await review
        .getByRole("button", { name: "更新を実行", exact: true })
        .click();
      await expect(review).toBeHidden();
    };
    const checkSaved = async (price: number | null, remarks: string) => {
      await expect
        .poll(() => readBrowserEventLists(page))
        .toMatchObject({
          [eventName]: [
            expect.objectContaining({
              id: "1",
              price,
              remarks,
              protectionLevel: "none",
              sheetIdentityFingerprint: createSheetIdentityFingerprint(
                price,
                remarks,
              ),
            }),
            expect.objectContaining(protectedItem),
          ],
        });
      const saved = (await readBrowserEventLists(page))[eventName];
      for (const record of saved) {
        expect(record).not.toHaveProperty("catalogPrice");
        expect(record).not.toHaveProperty("sheetRemarks");
        expect(record).not.toHaveProperty("sheetIdentityVerified");
      }
      expect(await storedExecution(page)).toEqual(executeBefore);
    };

    await runUpdate();
    await checkSaved(800, "シート更新後の備考");
    await page.reload();
    await expect(
      page.locator('input[aria-label="バックアップファイルを選択"]'),
    ).toBeAttached();
    await checkSaved(800, "シート更新後の備考");

    emptyUpdate = true;
    await runUpdate();
    await checkSaved(null, "");
    await page.reload();
    await expect(
      page.locator('input[aria-label="バックアップファイルを選択"]'),
    ).toBeAttached();
    await checkSaved(null, "");
    expect(errors).toEqual([]);
  });
});
