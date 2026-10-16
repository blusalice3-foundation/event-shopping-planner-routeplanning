import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { DayModeState, ShoppingItem } from "../../types/item";
import {
  buildXlsxEventRestoreSource,
  toImportedEventData,
} from "../../features/events/fileImport";
import { createAppBackup, parseAppBackup } from "../../utils/appBackup";
import { buildEventWorkbookExportSnapshot } from "../domain/eventWorkbook";
import { xlsxWorkerExecutor } from "./workerExecutor";

const eventName = "配置情報の検証";
const eventDate = "1日目";
const items: ShoppingItem[] = [2, 5].map((quantity, index) => ({
  id: `original-${index}`,
  circle: "ユーザー登録",
  eventDate,
  block: "A",
  number: "01a",
  title: `品目${index}`,
  price: 700,
  quantity,
  purchaseStatus: "None",
  remarks: "エラーが発生しました\n🎉",
}));
const layoutInfo = {
  executeModeItems: { [eventDate]: [items[1].id, items[0].id] },
  dayModes: { [eventDate]: "focus" as const },
};
const textEncodings = {
  plain: (text: string): ExcelJS.CellValue => text,
  rich: (text: string): ExcelJS.CellValue => ({
    richText: [
      { font: { bold: true }, text: text.slice(0, 2) },
      { text: text.slice(2) },
    ],
  }),
  cached: (text: string): ExcelJS.CellValue => ({
    formula: JSON.stringify(text),
    result: text,
  }),
};

async function exportBook() {
  const bytes = await xlsxWorkerExecutor.exportWorkbook(
    buildEventWorkbookExportSnapshot(
      eventName,
      items,
      {
        includeItems: true,
        includeLayoutInfo: true,
        includeMapData: false,
        includeRouteInfo: false,
        format: "full",
      },
      {
        executeModeItems: { [eventName]: layoutInfo.executeModeItems },
        dayModes: { [eventName]: layoutInfo.dayModes },
      },
    ),
    new AbortController().signal,
    () => {},
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(bytes).buffer);
  return book;
}

function makeLegacy(book: ExcelJS.Workbook) {
  book.removeWorksheet("関連設定");
  const meta = book.getWorksheet("メタデータ")!;
  for (let row = meta.rowCount; row >= 2; row--) {
    const key = meta.getCell(row, 1).value;
    if (key === "version") meta.getCell(row, 2).value = "2.2";
    if (
      key === "contentManifest" ||
      key === "consistencySchemaVersion" ||
      key === "eventMetadata"
    )
      meta.spliceRows(row, 1);
  }
  book.getWorksheet("アイテムデータ")!.spliceColumns(19, 1);
}

async function importBook(book: ExcelJS.Workbook) {
  const bytes = await book.xlsx.writeBuffer();
  const phases: string[] = [];
  const response = await xlsxWorkerExecutor.importWorkbook(
    {
      kind: "event-import",
      input: new Uint8Array(bytes).buffer,
      fileName: "layout.xlsx",
    },
    new AbortController().signal,
    ({ phase }) => phases.push(phase),
  );
  expect(phases).toContain("preflight");
  if (response.kind !== "event-import") throw new Error("Unexpected kind");
  return response.value;
}

function auxiliarySheets(book: ExcelJS.Workbook) {
  const map = book.addWorksheet("マップデータ");
  map.addRow(["マップ名", "データ"]);
  map.addRow(["会場\n🎉", '{"cells":[]}']);
  const route = book.addWorksheet("ルート情報");
  route.addRow(["種別", "マップ名", "データ"]);
  route.addRow(["routeSettings", "会場\n🎉", '{"enabled":true}']);
  route.addRow(["hallDefinitions", "会場\n🎉", "[]"]);
  route.addRow(["hallRouteSettings", "会場\n🎉", '{"enabled":false}']);
}

describe("layout text through production ZIP preflight, Worker and JSON restore", () => {
  for (const version of ["2.2", "3.0"]) {
    it.each(Object.entries(textEncodings))(
      `${version} preserves %s layout text, execution order and item references`,
      async (_name, encode) => {
        const book = await exportBook();
        if (version === "2.2") makeLegacy(book);
        book.getWorksheet("配置情報")!.eachRow((row, index) => {
          if (index === 1) return;
          const isMode = row.getCell(1).value === "dayModes";
          for (const column of isMode ? [1, 2, 3] : [1, 2])
            row.getCell(column).value = encode(
              row.getCell(column).value as string,
            );
        });
        const result = await importBook(book);
        expect(result.success, result.errors.join("\n")).toBe(true);
        expect(result.layoutInfo).toEqual(layoutInfo);
        expect(result.items.map(({ id }) => id)).toEqual(
          items.map(({ id }) => id),
        );
        const restored = buildXlsxEventRestoreSource(
          toImportedEventData(result),
        );
        const parsed = parseAppBackup(createAppBackup(restored.data));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) throw new Error("Invalid backup");
        expect(parsed.data.executeModeItems[eventName]).toEqual(
          layoutInfo.executeModeItems,
        );
        expect(parsed.data.dayModes[eventName]).toEqual(layoutInfo.dayModes);
        const bytes = await xlsxWorkerExecutor.exportWorkbook(
          buildEventWorkbookExportSnapshot(
            eventName,
            parsed.data.eventLists[eventName] as ShoppingItem[],
            {
              includeItems: true,
              includeLayoutInfo: true,
              includeMapData: false,
              includeRouteInfo: false,
              format: "full",
            },
            {
              executeModeItems: parsed.data.executeModeItems,
              dayModes: {
                [eventName]: parsed.data.dayModes[eventName] as DayModeState,
              },
            },
          ),
          new AbortController().signal,
          () => {},
        );
        const next = new ExcelJS.Workbook();
        await next.xlsx.load(new Uint8Array(bytes).buffer);
        expect((await importBook(next)).layoutInfo).toEqual(layoutInfo);
      },
    );
  }

  it.each(Object.entries(textEncodings))(
    "preserves %s legacy map names and all route kinds without normalizing text",
    async (_name, encode) => {
      const book = await exportBook();
      makeLegacy(book);
      auxiliarySheets(book);
      for (const name of ["マップデータ", "ルート情報"]) {
        book.getWorksheet(name)!.eachRow((row, index) => {
          if (index === 1) return;
          for (const column of name === "マップデータ" ? [1] : [1, 2])
            row.getCell(column).value = encode(
              row.getCell(column).value as string,
            );
        });
      }
      const result = await importBook(book);
      expect(result.success, result.errors.join("\n")).toBe(true);
      expect(result.mapData).toEqual({ "会場\n🎉": { cells: [] } });
      expect(result.routeSettings).toEqual({ "会場\n🎉": { enabled: true } });
      expect(result.hallDefinitions).toEqual({ "会場\n🎉": [] });
      expect(result.hallRouteSettings).toEqual({
        "会場\n🎉": { enabled: false },
      });
    },
  );

  const cells = [
    ["配置情報", "A2", "種別"],
    ["配置情報", "B2", "参加日"],
    ["配置情報", "C2", "データ"],
    ["配置情報", "C3", "データ"],
    ["マップデータ", "A2", "マップ名"],
    ["マップデータ", "B2", "データ"],
    ["ルート情報", "A2", "種別"],
    ["ルート情報", "B2", "マップ名"],
    ["ルート情報", "C2", "データ"],
  ];
  for (const value of [
    { formula: '"missing result"' },
    { error: "#VALUE!" },
  ] as ExcelJS.CellValue[]) {
    it.each(cells)(
      `rejects unsupported ${JSON.stringify(value)} in %s %s (%s)`,
      async (sheetName, address, field) => {
        const book = await exportBook();
        makeLegacy(book);
        auxiliarySheets(book);
        book.getWorksheet(sheetName)!.getCell(address).value = value;
        const result = await importBook(book);
        expect(result.success).toBe(false);
        expect(result.errors.join("\n")).toContain(sheetName);
        expect(result.errors.join("\n")).toContain(`${address.slice(1)}行目`);
        expect(result.errors.join("\n")).toContain(`「${field}」`);
        expect(result.errors.join("\n")).toContain("非対応セル形式");
        expect(JSON.stringify(result)).not.toContain("[object Object]");
      },
    );
  }

  for (const encode of [textEncodings.rich, textEncodings.cached]) {
    it.each([
      ["配置情報", "C2"],
      ["マップデータ", "B2"],
      ["ルート情報", "C2"],
    ])(
      "does not reinterpret structured JSON in %s %s as text",
      async (name, address) => {
        const book = await exportBook();
        makeLegacy(book);
        auxiliarySheets(book);
        const cell = book.getWorksheet(name)!.getCell(address);
        cell.value = encode(cell.value as string);
        const result = await importBook(book);
        expect(result.success).toBe(false);
        expect(result.errors.join("\n")).toContain("非対応セル形式");
        expect(JSON.stringify(result)).not.toContain("[object Object]");
      },
    );
  }

  for (const value of [0, false]) {
    it.each([
      ["配置情報", "C2"],
      ["マップデータ", "B2"],
      ["ルート情報", "C2"],
    ])(
      `keeps the legacy empty JSON treatment for ${String(value)} in %s %s`,
      async (name, address) => {
        const book = await exportBook();
        makeLegacy(book);
        auxiliarySheets(book);
        book.getWorksheet(name)!.getCell(address).value = value;
        const result = await importBook(book);
        if (name === "配置情報") {
          expect(result.success).toBe(false);
          expect(result.errors).toContain("配置情報の解析エラー");
        } else {
          expect(result.success, result.errors.join("\n")).toBe(true);
          if (name === "マップデータ") expect(result.mapData).toBeUndefined();
          else expect(result.routeSettings).toBeUndefined();
        }
      },
    );
  }

  it("still rejects external hyperlinks before parsing layout text", async () => {
    const book = await exportBook();
    makeLegacy(book);
    book.getWorksheet("配置情報")!.getCell("B2").value = {
      text: eventDate,
      hyperlink: "https://example.com/external",
    };
    await expect(importBook(book)).rejects.toMatchObject({
      code: "SECURITY_REJECTED",
    });
  });
});
