import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

const eventName = "閉じる操作検証";
const itemTitle = "出力する新刊";
const backup = {
  kind: "event-shopping-planner-backup",
  version: 1,
  exportedAt: "2026-10-18T00:00:00.000Z",
  eventSettings: { blockDetectionSettings: {} },
  data: {
    eventLists: {
      [eventName]: [
        {
          id: "overlay-item",
          circle: "出力するサークル",
          title: itemTitle,
          eventDate: "1日目",
          block: "A",
          number: "1",
          price: 500,
          purchaseStatus: "None",
          quantity: 1,
          remarks: "ユーザー登録",
        },
      ],
    },
    eventMetadata: {},
    executeModeItems: { [eventName]: { "1日目": ["overlay-item"] } },
    dayModes: { [eventName]: { "1日目": "edit" } },
    mapData: {},
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallDefinitions: {},
    hallRouteSettings: {},
  },
};

const restoreAndOpenEventList = async (page: Page) => {
  await page.goto("/");
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "event-overlay.json",
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
  await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
};

const openRename = async (page: Page) => {
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("button", { name: /名称変更/ }).click();
  await expect(
    page.getByRole("heading", { name: "即売会名を変更" }),
  ).toBeVisible();
};

const openExport = async (page: Page) => {
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("button", { name: /Excel形式で出力/ }).click();
  await expect(
    page.getByRole("heading", { name: "エクスポート設定" }),
  ).toBeVisible();
};

test("rename cancellation and unchanged-name submission close without changing the event, then normal rename persists", async ({
  page,
}) => {
  const downloads: string[] = [];
  const errors: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await restoreAndOpenEventList(page);

  await openRename(page);
  await page.getByLabel("新しい即売会名").fill("取り消す名称");
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "即売会名を変更" }),
  ).toBeHidden();
  await expect(page.getByText(eventName, { exact: true })).toBeVisible();
  await expect(page.getByText("取り消す名称", { exact: true })).toHaveCount(0);
  expect(downloads).toEqual([]);

  await openRename(page);
  await expect(page.getByLabel("新しい即売会名")).toHaveValue(eventName);
  await page.getByRole("button", { name: "変更", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "即売会名を変更" }),
  ).toBeHidden();
  await expect(page.getByText(eventName, { exact: true })).toBeVisible();
  expect(downloads).toEqual([]);

  await page.reload();
  await openRename(page);
  await expect(page.getByLabel("新しい即売会名")).toHaveValue(eventName);
  const renamed = eventName + "変更後";
  await page.getByLabel("新しい即売会名").fill(renamed);
  await page.getByRole("button", { name: "変更", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "イベント名を変更",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "確認して保存", exact: true })
    .click();
  await expect(confirmation).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "即売会名を変更" }),
  ).toBeHidden();
  await expect(page.getByText(renamed, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(renamed, { exact: true })).toBeVisible();
  await expect(page.getByText(eventName, { exact: true })).toHaveCount(0);
  expect(downloads).toEqual([]);
  expect(errors).toEqual([]);
});

test("export cancellation and close icon reopen without downloading, then the real Excel Worker exports and closes", async ({
  page,
}) => {
  const downloads: string[] = [];
  const errors: string[] = [];
  const workerUrls: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("worker", (worker) => workerUrls.push(worker.url()));
  await restoreAndOpenEventList(page);

  await openExport(page);
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "エクスポート設定" }),
  ).toBeHidden();
  await expect(page.getByText(eventName, { exact: true })).toBeVisible();
  expect(downloads).toEqual([]);

  await openExport(page);
  await page
    .getByRole("heading", { name: "エクスポート設定" })
    .locator("..")
    .getByRole("button")
    .click();
  await expect(
    page.getByRole("heading", { name: "エクスポート設定" }),
  ).toBeHidden();
  await expect(page.getByText(eventName, { exact: true })).toBeVisible();
  expect(downloads).toEqual([]);

  await openExport(page);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "エクスポート", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  expect(await download.failure()).toBeNull();
  await expect(
    page.getByRole("heading", { name: "エクスポート設定" }),
  ).toBeHidden();
  expect(workerUrls.some((url) => url.includes("xlsx.worker"))).toBe(true);
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Excel download stream is missing");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.concat(chunks));
  const rows: string[] = [];
  workbook.eachSheet((sheet) =>
    sheet.eachRow((row) => rows.push(JSON.stringify(row.values))),
  );
  expect(rows.join("\n")).toContain(itemTitle);
  expect(rows.join("\n")).toContain("ユーザー登録");
  expect(downloads).toHaveLength(1);
  await expect(page.getByText(eventName, { exact: true })).toBeVisible();
  await openExport(page);
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "エクスポート設定" }),
  ).toBeHidden();
  expect(downloads).toHaveLength(1);
  expect(errors).toEqual([]);
});
