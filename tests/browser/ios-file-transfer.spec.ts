import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { addInflateRegressionPart } from "../../src/xlsx/fixtures/inflateWindowWrap";
import {
  allStores,
  backup,
  confirmRestore,
  eventName,
  exportBackup,
  item,
  launch,
  readDownload,
  xlsxMime,
} from "./ios-xlsx-helpers";

// Compatibility automation is separate from physical device file-picker checks.
test.use({ serviceWorkers: "block" });
test.describe.configure({ timeout: 60_000 });

for (const forceJs of [false, true])
  test(`@ios-compat imports fixed JS inflate regression XLSX with ${forceJs ? "JS fallback" : "platform codecs"} and persists all contents`, async ({
    page,
  }, testInfo) => {
    const trace = await launch(page, forceJs);
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
    const bytes = Buffer.from(
      addInflateRegressionPart(
        new Uint8Array(await workbook.xlsx.writeBuffer()),
      ),
    );
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
    await page
      .locator('input[aria-label="Excelファイルを選択"]')
      .setInputFiles({
        name: "日本語イベント.xlsx",
        mimeType: xlsxMime,
        buffer: bytes,
      });
    await confirmRestore(page, eventName);
    const saved = await exportBackup(page);
    expect(saved.kind).toBe(backup.kind);
    expect(saved.data.eventLists[eventName]).toHaveLength(fixtureItems.length);
    expect(saved.data.eventLists[eventName]).toMatchObject(fixtureItems);
    expect(saved.data.mapData[eventName]["1日目マップ"]).toMatchObject({
      maxRow: 250,
      maxCol: 200,
      cells,
      mergedCells: [],
      blocks: [],
    });
    const traces = await trace.verify(1, testInfo);
    expect(traces.flatMap((worker) => worker.responses)).toEqual([
      { type: "XLSX_IMPORT_RESULT", kind: "event-import" },
    ]);
    await page.reload();
    await expect(page.locator("#loading-screen")).toBeHidden();
    const reloaded = await exportBackup(page);
    expect(reloaded.data).toEqual(saved.data);
    expect(reloaded.eventSettings).toEqual(saved.eventSettings);
  });

test("@ios-compat XLSX export and reimport preserve Japanese event data in a downloaded JSON backup", async ({
  page,
}, testInfo) => {
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
  const traces = await trace.verify(2, testInfo);
  expect(traces.flatMap((worker) => worker.responses)).toEqual([
    { type: "XLSX_EXPORT_RESULT", kind: "export" },
    { type: "XLSX_IMPORT_RESULT", kind: "event-import" },
  ]);
  await page.reload();
  await expect(page.locator("#loading-screen")).toBeHidden();
  const reloaded = await exportBackup(page);
  expect(reloaded.data).toEqual(saved.data);
  expect(reloaded.eventSettings).toEqual(saved.eventSettings);
});

for (const corruption of ["crc", "payload"] as const) {
  test(`@ios-compat JS inflate ${corruption} corruption is rejected by the real Worker before persistence`, async ({
    page,
  }, testInfo) => {
    const trace = await launch(page);
    await page
      .locator('input[aria-label="バックアップファイルを選択"]')
      .setInputFiles({
        name: "retained.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(backup), "utf8"),
      });
    await confirmRestore(page, eventName);
    const before = await allStores(page);
    const book = new ExcelJS.Workbook();
    book.addWorksheet("アイテムデータ").addRow(["ID", "サークル"]);
    const bytes = Buffer.from(
      addInflateRegressionPart(
        new Uint8Array(await book.xlsx.writeBuffer()),
        corruption,
      ),
    );
    await page
      .locator('input[aria-label="Excelファイルを選択"]')
      .setInputFiles({
        name: "corrupt.xlsx",
        mimeType: xlsxMime,
        buffer: bytes,
      });
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as Window & {
              __xlsxTransferTrace: Array<{
                responses: Array<{ errorCode?: string }>;
              }>;
            }
          ).__xlsxTransferTrace
            .flatMap((worker) => worker.responses)
            .map((response) => response.errorCode),
        ),
      )
      .toContain("SECURITY_REJECTED");
    await expect(
      page.getByRole("dialog", {
        name: "バックアップからイベントを復元",
        exact: true,
      }),
    ).toBeHidden();
    expect(await allStores(page)).toEqual(before);
    const traces = await trace.verify(1, testInfo);
    expect(traces.flatMap((worker) => worker.responses)).toEqual([
      {
        type: "XLSX_ERROR",
        kind: "event-import",
        errorCode: "SECURITY_REJECTED",
      },
    ]);
    await page.reload();
    await expect(page.locator("#loading-screen")).toBeHidden();
    expect(await allStores(page)).toEqual(before);
  });
}

test("@ios-compat map import through the JS Worker persists every parsed cell after reload", async ({
  page,
}, testInfo) => {
  const trace = await launch(page);
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "map-target.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup), "utf8"),
    });
  await confirmRestore(page, eventName);
  const before = await allStores(page);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("1日目");
  const border = { style: "medium" as const, color: { argb: "FFFF0000" } };
  sheet.getCell("A1").value = "A";
  sheet.getCell("A1").border = { top: border, bottom: border, left: border };
  sheet.getCell("B1").value = 1;
  sheet.getCell("B1").border = { top: border, bottom: border, right: border };
  sheet.getCell("F6").value = "ユーザー登録・エラーが発生しました";
  const bytes = Buffer.from(
    addInflateRegressionPart(new Uint8Array(await book.xlsx.writeBuffer())),
  );
  const input = page.locator('input[type="file"][accept=".xlsx"]').first();
  await input.evaluate((element, name) => {
    (element as HTMLInputElement).dataset.eventName = name;
  }, eventName);
  await input.setInputFiles({
    name: "map-inflate-regression.xlsx",
    mimeType: xlsxMime,
    buffer: bytes,
  });
  const dialog = page.getByRole("dialog", {
    name: "📋 マップデータ取り込み",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取り込む", exact: true }).click();
  const impact = page.getByRole("dialog", {
    name: "マップ再取り込みの影響を確認",
    exact: true,
  });
  await expect
    .poll(async () => (await impact.isVisible()) || !(await dialog.isVisible()))
    .toBe(true);
  if (await impact.isVisible())
    await impact
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
  await expect(dialog).toBeHidden();
  const after = await allStores(page);
  expect(after.eventLists).toEqual(before.eventLists);
  expect(after.mapData).not.toEqual(before.mapData);
  const saved = await exportBackup(page);
  const map = saved.data.mapData[eventName]["1日目マップ"];
  expect(map).toMatchObject({ maxRow: 56, maxCol: 56 });
  expect(map.cells).toHaveLength(36);
  expect(map.cells).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ row: 26, col: 26, value: "A" }),
      expect.objectContaining({ row: 26, col: 27, value: 1 }),
      expect.objectContaining({
        row: 31,
        col: 31,
        value: "ユーザー登録・エラーが発生しました",
      }),
    ]),
  );
  for (const cell of map.cells as Array<{
    row: number;
    col: number;
    value: unknown;
  }>)
    if (
      !(cell.row === 26 && cell.col <= 27) &&
      !(cell.row === 31 && cell.col === 31)
    )
      expect(cell.value).toBeNull();
  const traces = await trace.verify(1, testInfo);
  expect(traces.flatMap((worker) => worker.responses)).toEqual([
    { type: "XLSX_IMPORT_RESULT", kind: "map-import" },
  ]);
  await page.reload();
  await expect(page.locator("#loading-screen")).toBeHidden();
  const reloaded = await exportBackup(page);
  expect(reloaded.data).toEqual(saved.data);
  expect(reloaded.eventSettings).toEqual(saved.eventSettings);
});
