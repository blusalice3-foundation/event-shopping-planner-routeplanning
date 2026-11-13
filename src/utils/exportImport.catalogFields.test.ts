import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../types/item";
import { createSheetIdentityFingerprint } from "./sheetIdentity";
import {
  exportToXlsx,
  importFromXlsx,
} from "../xlsx/engine/eventWorkbookEngine";

const legacyHeaders = [
  "ID",
  "サークル名",
  "参加日",
  "ブロック",
  "ナンバー",
  "タイトル",
  "価格",
  "数量",
  "ステータス",
  "備考",
  "URL",
  "優先度",
  "保護レベル",
  "追加元",
  "手動ホール",
  "限数実購入数",
];
const oldHeaders = [
  ...legacyHeaders,
  "カタログ価格",
  "シート備考",
  "シート照合根拠",
];
const fingerprint = createSheetIdentityFingerprint(1200, "シートの原文");
const item = (
  id: string,
  overrides: Partial<ShoppingItem> = {},
): ShoppingItem => ({
  id,
  circle: `サークル-${id}`,
  eventDate: "1日目",
  block: "東A",
  number: "01a",
  title: `タイトル-${id}`,
  price: 900,
  quantity: 1,
  purchaseStatus: "None",
  remarks: `現場備考-${id}`,
  ...overrides,
});
const rowValues = (id: string): ExcelJS.CellValue[] => [
  id,
  `サークル-${id}`,
  "1日目",
  "東A",
  "01a",
  `タイトル-${id}`,
  900,
  3,
  "Purchased",
  "現場のメモ",
  "",
  "",
  "full",
  "spreadsheet",
  "",
  "",
  1200,
  "シートの原文",
  "verified",
];
const workbookFile = async (workbook: ExcelJS.Workbook): Promise<File> =>
  new File([await workbook.xlsx.writeBuffer()], "fields.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
const exportBook = async (
  items: ShoppingItem[],
  format: "simple" | "full" = "full",
) => {
  const blob = await exportToXlsx(
    "往復イベント",
    items,
    {
      includeItems: true,
      includeLayoutInfo: false,
      includeMapData: false,
      includeRouteInfo: false,
      format,
    },
    {},
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await blob.arrayBuffer());
  return book;
};
const importRows = async (
  headers: string[],
  rows: ExcelJS.CellValue[][],
  version?: string,
) => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("アイテムデータ");
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row.slice(0, headers.length)));
  if (version) {
    const meta = book.addWorksheet("メタデータ");
    meta.addRow(["キー", "値"]);
    meta.addRow(["version", version]);
    meta.addRow(["eventName", "取込イベント"]);
  }
  return importFromXlsx(await workbookFile(book));
};
function expectRetiredFieldsRemoved(value: object) {
  expect(value).not.toHaveProperty("catalogPrice");
  expect(value).not.toHaveProperty("sheetRemarks");
  expect(value).not.toHaveProperty("sheetIdentityVerified");
}

describe("event XLSX unified price and remarks", () => {
  it("uses the transferred workbook buffer without rereading the File", async () => {
    const book = await exportBook([item("transferred")]);
    const bytes = new Uint8Array(await book.xlsx.writeBuffer());
    const input = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const file = {
      name: "transferred.xlsx",
      arrayBuffer: async () => {
        throw new Error("The transferred workbook was read twice.");
      },
    } as unknown as File;
    const result = await importFromXlsx(file, input);
    expect(result.success).toBe(true);
    expect(result.items.map(({ id }) => id)).toEqual(["transferred"]);
  });

  it("exports 3.1 with a hidden identity fingerprint and no retired columns", async () => {
    const book = await exportBook([
      item("format", {
        source: "spreadsheet",
        sheetIdentityFingerprint: fingerprint,
      }),
    ]);
    const sheet = book.getWorksheet("アイテムデータ")!;
    expect(sheet.columnCount).toBe(17);
    expect(sheet.getCell(1, 17).value).toBe("シート照合識別子");
    expect(sheet.getColumn(17).hidden).toBe(true);
    expect(sheet.getCell(2, 17).value).toBe(fingerprint);
    const headers = sheet.getRow(1).values;
    expect(headers).not.toContain("カタログ価格");
    expect(headers).not.toContain("シート備考");
    expect(headers).not.toContain("シート照合根拠");
    expect(book.getWorksheet("メタデータ")!.getCell(2, 2).value).toBe("3.1");
  });

  it.each(["simple", "full"] as const)(
    "round-trips field values, locks and opaque identity in %s",
    async (format) => {
      const originals = [
        item("locked", {
          source: "spreadsheet",
          purchaseStatus: "Purchased",
          protectionLevel: "full",
          price: 800,
          remarks: "ユーザー登録\nエラーが発生しました",
          sheetIdentityFingerprint: fingerprint,
        }),
        item("zero", {
          source: "spreadsheet",
          price: 0,
          remarks: "",
          sheetIdentityFingerprint: createSheetIdentityFingerprint(0, ""),
        }),
        item("null", {
          source: "spreadsheet",
          price: null,
          sheetIdentityFingerprint: createSheetIdentityFingerprint(null, ""),
        }),
        item("unverified", { source: "spreadsheet" }),
        item("app", { source: "app" }),
      ];
      const book = await exportBook(originals, format);
      const result = await importFromXlsx(await workbookFile(book));
      expect(result.success, result.errors.join("\n")).toBe(true);
      originals.forEach((expected, index) => {
        expect(result.items[index]).toMatchObject(expected);
        expect(result.items[index].sheetIdentityFingerprint).toBe(
          expected.sheetIdentityFingerprint,
        );
        expectRetiredFieldsRemoved(result.items[index]);
      });
      expect(result).not.toHaveProperty("legacySheetFieldFallbacks");
    },
  );

  it.each([15, 16])(
    "keeps legacy %s-column field values without inventing identity",
    async (count) => {
      const result = await importRows(legacyHeaders.slice(0, count), [
        rowValues("legacy"),
      ]);
      expect(result.success).toBe(true);
      expect(result.items[0]).toMatchObject({
        price: 900,
        remarks: "現場のメモ",
        purchaseStatus: "Purchased",
        protectionLevel: "full",
      });
      expect(result.items[0].sheetIdentityFingerprint).toBeUndefined();
      expectRetiredFieldsRemoved(result.items[0]);
      expect(result).not.toHaveProperty("legacySheetFieldFallbacks");
      expect(result.itemFallbackWarnings).toBeUndefined();
    },
  );

  it("migrates verified legacy sheet columns into identity without replacing current fields", async () => {
    const result = await importRows(oldHeaders, [rowValues("verified")], "2.2");
    expect(result.success).toBe(true);
    expect(result.items[0]).toMatchObject({
      price: 900,
      remarks: "現場のメモ",
      protectionLevel: "full",
      sheetIdentityFingerprint: fingerprint,
    });
    expectRetiredFieldsRemoved(result.items[0]);
  });

  it("retains old 3.0 manifest compatibility", async () => {
    const book = await exportBook([
      item("old", { source: "spreadsheet", protectionLevel: "full" }),
    ]);
    const sheet = book.getWorksheet("アイテムデータ")!;
    sheet.spliceColumns(17, 1);
    oldHeaders.slice(16).forEach((header, index) => {
      sheet.getCell(1, 17 + index).value = header;
    });
    sheet.getCell(2, 17).value = 1200;
    sheet.getCell(2, 18).value = "シートの原文";
    sheet.getCell(2, 19).value = "verified";
    book.getWorksheet("メタデータ")!.eachRow((row) => {
      if (row.getCell(1).value === "version") row.getCell(2).value = "3.0";
    });
    const result = await importFromXlsx(await workbookFile(book));
    expect(result.success, result.errors.join("\n")).toBe(true);
    expect(result.items[0]).toMatchObject({
      price: 900,
      remarks: "現場備考-old",
      protectionLevel: "full",
      sheetIdentityFingerprint: fingerprint,
    });
    expectRetiredFieldsRemoved(result.items[0]);
  });

  it.each(["", "unverified", "future"])(
    "does not trust legacy %j evidence",
    async (evidence) => {
      const row = rowValues("untrusted");
      row[18] = evidence;
      const result = await importRows(oldHeaders, [row]);
      expect(result.success).toBe(true);
      expect(result.items[0].sheetIdentityFingerprint).toBeUndefined();
      expect(result.items[0]).toMatchObject({
        price: 900,
        remarks: "現場のメモ",
      });
    },
  );

  it.each([null, 0])(
    "migrates verified empty and zero sheet prices (%j)",
    async (price) => {
      const row = rowValues("empty");
      row[16] = price;
      row[17] = null;
      const result = await importRows(oldHeaders, [row]);
      expect(result.items[0].sheetIdentityFingerprint).toBe(
        createSheetIdentityFingerprint(price, ""),
      );
      expect(result.items[0].price).toBe(900);
    },
  );

  it.each(["invalid-price", "invalid-notes", "app"])(
    "discards invalid or non-sheet legacy identity (%s)",
    async (kind) => {
      const row = rowValues(kind);
      if (kind === "invalid-price") row[16] = { formula: "1+1" };
      if (kind === "invalid-notes") row[17] = { error: "#VALUE!" };
      if (kind === "app") row[13] = "app";
      const result = await importRows(oldHeaders, [row]);
      expect(result.success).toBe(true);
      expect(result.items[0].sheetIdentityFingerprint).toBeUndefined();
      expect(result.items[0]).toMatchObject({
        price: 900,
        remarks: "現場のメモ",
      });
    },
  );

  it("detects verified legacy columns by header name", async () => {
    const row = rowValues("swapped");
    [row[16], row[17]] = [row[17], row[16]];
    const result = await importRows(
      [...legacyHeaders, "シート備考", "カタログ価格", "シート照合根拠"],
      [row],
    );
    expect(result.items[0].sheetIdentityFingerprint).toBe(fingerprint);
  });

  it.each(["invalid", "sheet-v1:12:ABCDEF0123456789"])(
    "does not retain malformed fingerprint %j",
    async (value) => {
      const book = await exportBook([item("bad", { source: "spreadsheet" })]);
      book.getWorksheet("アイテムデータ")!.getCell(2, 17).value = value;
      const result = await importFromXlsx(await workbookFile(book));
      expect(result.success).toBe(true);
      expect(result.items[0].sheetIdentityFingerprint).toBeUndefined();
      expect(result.itemFallbackWarnings).toMatchObject([
        {
          itemId: "bad",
          reasons: [expect.stringContaining("シート照合識別子")],
        },
      ]);
    },
  );

  it("rejects a 3.1 workbook missing its identity column", async () => {
    const book = await exportBook([item("missing")]);
    book.getWorksheet("アイテムデータ")!.spliceColumns(17, 1);
    const result = await importFromXlsx(await workbookFile(book));
    expect(result.success).toBe(false);
    expect(result.errors.join("\n")).toContain("シート照合識別子がありません");
  });

  it("rejects incomplete old sheet columns", async () => {
    const result = await importRows(
      [...legacyHeaders, "カタログ価格"],
      [rowValues("broken")],
    );
    expect(result.success).toBe(false);
    expect(result.errors.join("\n")).toContain("両方の列が必要");
  });
  it("rejects missing mandatory columns in old 2.2", async () => {
    const result = await importRows(
      legacyHeaders,
      [rowValues("broken")],
      "2.2",
    );
    expect(result.success).toBe(false);
    expect(result.errors.join("\n")).toContain("バージョン2.2");
  });
  it("accepts legacy 2.1 without inventing fingerprint", async () => {
    const result = await importRows(
      legacyHeaders,
      [rowValues("legacy")],
      "2.1",
    );
    expect(result.success).toBe(true);
    expect(result.items[0].sheetIdentityFingerprint).toBeUndefined();
  });
});
