import { expect, test, type Download, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

// These checks exercise real codecs and downloads, not physical iOS file pickers.
test.use({ serviceWorkers: "block" });
test.describe.configure({ timeout: 60_000 });

const eventName = "iOSファイル保存確認";
const item = {
  id: "ios-file-item",
  eventDate: "1日目",
  circle: "ユーザー登録",
  title: "日本語の新刊",
  block: "A",
  number: "01a",
  price: 500,
  quantity: 2,
  purchaseStatus: "None",
  remarks: "エラーが発生しました",
};
const backup = {
  kind: "event-shopping-planner-backup",
  version: 1,
  exportedAt: "2026-11-08T00:00:00.000Z",
  eventSettings: { blockDetectionSettings: {} },
  data: {
    eventLists: { [eventName]: [item] },
    eventMetadata: {},
    executeModeItems: { [eventName]: { "1日目": [item.id] } },
    dayModes: { [eventName]: { "1日目": "edit" } },
    mapData: {},
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallDefinitions: {},
    hallRouteSettings: {},
  },
};
const xlsxMime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function readDownload(download: Download): Promise<Buffer> {
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  if (!stream) throw new Error("File download stream is missing.");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function launch(page: Page, forbidNativeCodecs = true) {
  const failures: string[] = [];
  const navigations: string[] = [];
  let codecWorkers = 0;
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("crash", () => failures.push("page crashed"));
  page.on("dialog", (dialog) => void dialog.accept());
  await page.route("**/xlsx.worker-*.js", async (route) => {
    codecWorkers++;
    const response = await route.fetch();
    // Exercise both the ordinary platform codec and a missing native API.
    // Apple WebKit must keep using JS, while other platforms can fall back.
    const prefix = forbidNativeCodecs
      ? 'globalThis.CompressionStream = globalThis.DecompressionStream = class { constructor() { throw new Error("Native ZIP codec must not be used."); } };\n'
      : "";
    await route.fulfill({ response, body: prefix + (await response.text()) });
  });
  await page.goto("/");
  await expect(page.locator("#loading-screen")).toBeHidden();
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  return {
    verify(expectedWorkers: number) {
      expect(codecWorkers).toBe(expectedWorkers);
      expect(failures).toEqual([]);
      expect(navigations).toEqual([]);
    },
  };
}

async function confirmRestore(page: Page, name: string, rename = false) {
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  if (rename) {
    await dialog
      .getByRole("textbox", { name: "復元後のイベント名" })
      .fill(name);
    await dialog
      .getByRole("button", { name: "別名で復元", exact: true })
      .click();
  } else {
    await dialog.getByRole("radio", { name: /同名で置換/ }).check();
    await dialog
      .getByRole("button", { name: "置換して復元", exact: true })
      .click();
  }
  const review = page.getByRole("dialog", {
    name: `「${name}」の復元内容を確認`,
    exact: true,
  });
  await expect
    .poll(async () => (await review.isVisible()) || !(await dialog.isVisible()))
    .toBe(true);
  if (await review.isVisible())
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function exportBackup(page: Page) {
  await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONバックアップ保存", exact: true })
    .click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/\.json$/);
  return JSON.parse((await readDownload(file)).toString("utf8")) as {
    kind: string;
    data: {
      eventLists: Record<string, Array<typeof item>>;
      mapData: Record<
        string,
        Record<string, { maxRow: number; maxCol: number }>
      >;
    };
  };
}

test("@ios-compat imports a compressed XLSX with platform codecs and no page reload", async ({
  page,
}, testInfo) => {
  const trace = await launch(page, false);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("アイテムデータ");
  sheet.addRow([
    "ID",
    "サークル",
    "参加日",
    "ブロック",
    "番号",
    "タイトル",
    "価格",
    "数量",
    "購入状況",
    "備考",
    "URL",
    "優先度",
    "保護",
    "追加元",
  ]);
  let seed = 42;
  const randomText = () =>
    Array.from({ length: 1536 }, () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[
        (seed >>> 0) % 62
      ];
    }).join("");
  const fixtureItems = Array.from({ length: 500 }, (_, index) => ({
    ...item,
    id: `${item.id}-${index}`,
    title: `${item.title} ${index}`,
    remarks: `${item.remarks} ${randomText()}`,
  }));
  for (const value of fixtureItems)
    sheet.addRow([
      value.id,
      value.circle,
      value.eventDate,
      value.block,
      value.number,
      value.title,
      value.price,
      value.quantity,
      value.purchaseStatus,
      value.remarks,
      "",
      "",
      "",
      "app",
    ]);
  const cells = Array.from({ length: 50_000 }, (_, index) => ({
    row: Math.floor(index / 200) + 1,
    col: (index % 200) + 1,
    value: index % 7 === 0 ? (index % 100) + 1 : null,
    backgroundColor: null,
    borders: { top: null, right: null, bottom: null, left: null },
  }));
  const mapSheet = workbook.addWorksheet("マップデータ");
  mapSheet.addRow(["マップ名", "データ"]);
  mapSheet.addRow([
    "1日目マップ",
    JSON.stringify({
      maxRow: 250,
      maxCol: 200,
      cells,
      mergedCells: [],
      blocks: [],
    }),
  ]);
  const metadata = workbook.addWorksheet("メタデータ");
  metadata.addRow(["key", "value"]);
  metadata.addRow(["eventName", eventName]);
  metadata.addRow(["version", "1.0"]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  expect(bytes.byteLength).toBeGreaterThan(482 * 1024);
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const entryCount = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  let totalInflatedBytes = 0;
  for (let index = 0; index < entryCount; index++) {
    totalInflatedBytes += bytes.readUInt32LE(offset + 24);
    offset +=
      46 +
      bytes.readUInt16LE(offset + 28) +
      bytes.readUInt16LE(offset + 30) +
      bytes.readUInt16LE(offset + 32);
  }
  await testInfo.attach("xlsx-fixture-size", {
    contentType: "application/json",
    body: Buffer.from(
      JSON.stringify({
        compressedBytes: bytes.byteLength,
        totalInflatedBytes,
        itemCount: fixtureItems.length,
        mapCellCount: cells.length,
      }),
    ),
  });
  await page.locator('input[aria-label="Excelファイルを選択"]').setInputFiles({
    name: "日本語イベント.xlsx",
    mimeType: xlsxMime,
    buffer: bytes,
  });
  await confirmRestore(page, eventName);
  const saved = await exportBackup(page);
  expect(saved.kind).toBe(backup.kind);
  expect(saved.data.eventLists[eventName]).toHaveLength(fixtureItems.length);
  expect(saved.data.eventLists[eventName][0]).toMatchObject(fixtureItems[0]);
  expect(saved.data.eventLists[eventName].at(-1)).toMatchObject(
    fixtureItems.at(-1)!,
  );
  expect(saved.data.mapData[eventName]["1日目マップ"]).toMatchObject({
    maxRow: 250,
    maxCol: 200,
  });
  trace.verify(1);
});

test("@ios-compat XLSX export and reimport preserve Japanese event data in a downloaded JSON backup", async ({
  page,
}) => {
  const trace = await launch(page);
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "保存確認.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup), "utf8"),
    });
  await confirmRestore(page, eventName);
  await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("button", { name: /Excel形式で出力/ }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "エクスポート", exact: true }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/\.xlsx$/);
  const bytes = await readDownload(file);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const rows: string[] = [];
  workbook.eachSheet((sheet) =>
    sheet.eachRow((row) => rows.push(JSON.stringify(row.values))),
  );
  for (const text of [item.circle, item.title, item.remarks])
    expect(rows.join("\n")).toContain(text);
  await expect(
    page.getByRole("heading", { name: "エクスポート設定" }),
  ).toBeHidden();
  await page.locator('input[aria-label="Excelファイルを選択"]').setInputFiles({
    name: file.suggestedFilename(),
    mimeType: xlsxMime,
    buffer: bytes,
  });
  const restoredEvent = `${eventName}復元`;
  await confirmRestore(page, restoredEvent, true);
  const saved = await exportBackup(page);
  expect(saved.kind).toBe(backup.kind);
  expect(Object.keys(saved.data.eventLists).sort()).toEqual(
    [eventName, restoredEvent].sort(),
  );
  for (const name of [eventName, restoredEvent])
    expect(saved.data.eventLists[name]).toEqual([
      expect.objectContaining(item),
    ]);
  trace.verify(2);
});
