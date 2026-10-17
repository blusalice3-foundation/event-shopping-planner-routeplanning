import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../../types/item";
import { readEventCsv } from "../../features/events/sheetImport";
import { buildBulkAddItems } from "../../features/events/bulkAdd";
import {
  createEventUpdateDiff,
  type SheetItem,
} from "../../features/events/updateDiff";
import { applyEventUpdateToItems } from "../../features/events/updateApply";
import {
  buildXlsxEventRestoreSource,
  toImportedEventData,
} from "../../features/events/fileImport";
import {
  createAppBackup,
  parseAppBackup,
  validateSnapshotStructure,
} from "../../utils/appBackup";
import { buildEventWorkbookExportSnapshot } from "../domain/eventWorkbook";
import { xlsxWorkerExecutor } from "./workerExecutor";

const records = (): ShoppingItem[] =>
  [2, 5].map((quantity, index) => ({
    id: String(index + 1),
    circle: "ユーザー登録",
    eventDate: "1日目",
    block: "A",
    number: "01a",
    title: "同名品目",
    price: index === 0 ? 800 : 600,
    quantity,
    purchaseStatus: "None",
    remarks: "エラーが発生しました " + (index + 1),
    source: "spreadsheet",
    protectionLevel: "none",
  }));
const incoming = (): SheetItem[] =>
  records().map((item, index) => ({
    ...item,
    price: index === 0 ? 600 : 800,
    catalogPrice: index === 0 ? 600 : 800,
    remarks: "シート備考",
    sheetRemarks: "シート備考",
    rawQuantity: String(item.quantity),
    sheetIdentityVerified: true,
  }));

async function exportBook(
  items = records(),
  format: "full" | "simple" = "full",
) {
  const bytes = await xlsxWorkerExecutor.exportWorkbook(
    buildEventWorkbookExportSnapshot(
      "検証イベント",
      items,
      {
        includeItems: true,
        includeLayoutInfo: false,
        includeMapData: false,
        includeRouteInfo: false,
        format,
      },
      {},
    ),
    new AbortController().signal,
    () => {},
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(bytes).buffer);
  return book;
}
async function importBook(book: ExcelJS.Workbook) {
  const buffer = await book.xlsx.writeBuffer();
  const response = await xlsxWorkerExecutor.importWorkbook(
    {
      kind: "event-import",
      input: new Uint8Array(buffer).buffer,
      fileName: "regression.xlsx",
    },
    new AbortController().signal,
    () => {},
  );
  if (response.kind !== "event-import")
    throw new Error("Unexpected result kind");
  return response.value;
}
function jsonRoundTrip(result: Awaited<ReturnType<typeof importBook>>) {
  const restored = buildXlsxEventRestoreSource(toImportedEventData(result));
  const parsed = parseAppBackup(createAppBackup(restored.data));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("Invalid backup");
  return parsed.data.eventLists[result.eventName] as ShoppingItem[];
}

function expectAutomaticOrder(before: ShoppingItem[], rows: SheetItem[]) {
  const diff = createEventUpdateDiff(before, rows);
  expect(diff.unresolvedMatches).toEqual([]);
  expect(diff.matching).toBeUndefined();
  expect(diff.itemsToAdd).toEqual([]);
  expect(diff.itemsToDelete).toEqual([]);
  const after = applyEventUpdateToItems(before, diff);
  expect(new Set(after.map((item) => item.id)).size).toBe(before.length);
  const userRecords = (items: ShoppingItem[]) =>
    items.map(({ id, price, remarks, purchaseStatus }) => ({
      id,
      price,
      remarks,
      purchaseStatus,
    }));
  expect(userRecords(after)).toEqual(userRecords(before));
  expect(after.map((item) => item.quantity)).toEqual(
    rows.map((item) => item.quantity),
  );
  expect(after.map((item) => item.catalogPrice)).toEqual(
    rows.map((item) => item.catalogPrice),
  );
}
describe("sheet identity provenance through production ZIP preflight and Worker engine", () => {
  it.each(["full", "simple"] as const)(
    "%s keeps inferred values unverified across repeated Excel and JSON round-trips",
    async (format) => {
      // Same notes make a price swap alone sufficient to reproduce the old bug.
      const originals = records().map((item) => ({
        ...item,
        remarks: "シート備考",
      }));
      let result = await importBook(await exportBook(originals, format));
      for (let round = 0; round < 2; round++) {
        expect(result.success, result.errors.join("\n")).toBe(true);
        expect(result.items.map((item) => item.sheetIdentityVerified)).toEqual([
          undefined,
          undefined,
        ]);
        expect(result.items.map((item) => item.catalogPrice)).toEqual([
          800, 600,
        ]);
        const restored =
          format === "simple" ? result.items : jsonRoundTrip(result);
        for (const rows of [incoming(), incoming().reverse()]) {
          expectAutomaticOrder(restored, rows);
          expect(restored.map((item) => item.quantity)).toEqual([2, 5]);
        }
        result = await importBook(await exportBook(restored, format));
      }
    },
  );

  it.each(["2.1", "2.2", "3.0"])(
    "does not trust an older %s workbook without provenance even after re-export",
    async (version) => {
      const book = await exportBook(
        records().map((item) => ({ ...item, remarks: "シート備考" })),
      );
      const sheet = book.getWorksheet("アイテムデータ")!;
      sheet.spliceColumns(19, 1);
      if (version !== "3.0") {
        book.removeWorksheet("関連設定");
        const meta = book.getWorksheet("メタデータ")!;
        for (let row = meta.rowCount; row >= 2; row--) {
          const key = meta.getCell(row, 1).value;
          if (key === "version") meta.getCell(row, 2).value = version;
          if (
            [
              "contentManifest",
              "consistencySchemaVersion",
              "eventMetadata",
            ].includes(String(key))
          )
            meta.spliceRows(row, 1);
        }
      }
      if (version === "2.1") sheet.spliceColumns(17, 2);
      const result = await importBook(book);
      expect(result.success, result.errors.join("\n")).toBe(true);
      expect(result.items.map((item) => item.sheetIdentityVerified)).toEqual([
        undefined,
        undefined,
      ]);
      const restored = jsonRoundTrip(result);
      const next = await importBook(await exportBook(restored));
      expectAutomaticOrder(next.items, incoming());
      expect(next.items.map((item) => item.quantity)).toEqual([2, 5]);
    },
  );

  it("retains verified sheet fields, including null/empty/zero, independently of user fields", async () => {
    const originals = records().map((item, index) => ({
      ...item,
      catalogPrice: index === 0 ? 600 : 800,
      sheetRemarks: "シート備考",
      sheetIdentityVerified: true,
    }));
    const result = await importBook(await exportBook(originals));
    expect(result.items.every((item) => item.sheetIdentityVerified)).toBe(true);
    const diff = createEventUpdateDiff(
      jsonRoundTrip(result),
      incoming().reverse(),
    );
    expect(diff.unresolvedMatches).toEqual([]);
    expect(
      applyEventUpdateToItems(result.items, diff).map((item) => [
        item.id,
        item.quantity,
        item.price,
        item.remarks,
      ]),
    ).toEqual(
      originals.map((item) => [
        item.id,
        item.quantity,
        item.price,
        item.remarks,
      ]),
    );
    const empty = await importBook(
      await exportBook([
        { ...originals[0], catalogPrice: null, sheetRemarks: "" },
        { ...originals[1], catalogPrice: 0, sheetRemarks: "" },
      ]),
    );
    expect(
      empty.items.map((item) => [
        item.catalogPrice,
        item.sheetRemarks,
        item.sheetIdentityVerified,
      ]),
    ).toEqual([
      [null, "", true],
      [0, "", true],
    ]);
  });

  it("automatic correspondence establishes new sheet values while preserving user records and purchased-quantity confirmation", async () => {
    const result = await importBook(await exportBook(records()));
    const restored = jsonRoundTrip(result);
    restored[1].purchaseStatus = "Purchased";
    const rows = incoming();
    rows[1] = { ...rows[1], quantity: 3, rawQuantity: "3" };
    const diff = createEventUpdateDiff(restored, rows);
    expect(diff.unresolvedMatches).toEqual([]);
    expect(diff.pendingPurchasedQuantityChanges).toMatchObject([
      { itemId: "2", currentQuantity: 5, nextQuantity: 3 },
    ]);
    const after = applyEventUpdateToItems(restored, diff);
    expect(after.map((item) => item.quantity)).toEqual([2, 5]);
    expect(after.map((item) => [item.price, item.remarks])).toEqual(
      records().map((item) => [item.price, item.remarks]),
    );
    expect(after.every((item) => item.sheetIdentityVerified === true)).toBe(
      true,
    );
    expect(
      applyEventUpdateToItems(restored, diff, {
        applyPurchasedQuantityChanges: true,
      })[1].quantity,
    ).toBe(3);
    const next = await importBook(await exportBook(after));
    expect(
      createEventUpdateDiff(next.items, incoming().reverse()).unresolvedMatches,
    ).toEqual([]);
  });

  it("establishes provenance even when the automatically matched sheet values are unchanged", async () => {
    const before = records().map((item, index) => ({
      ...item,
      catalogPrice: index === 0 ? 600 : 800,
      sheetRemarks: "シート備考",
    }));
    const diff = createEventUpdateDiff(before, incoming());
    expect(diff.itemsToUpdate).toHaveLength(2);
    expect(
      applyEventUpdateToItems(before, diff).every(
        (item) => item.sheetIdentityVerified,
      ),
    ).toBe(true);
    before[1].protectionLevel = "full";
    const protectedDiff = createEventUpdateDiff(before, incoming());
    expect(applyEventUpdateToItems(before, protectedDiff)[1]).toEqual(
      before[1],
    );
  });

  it("rejects invalid provenance types in restored JSON", () => {
    const result = validateSnapshotStructure({
      eventLists: {
        event: [{ ...records()[0], sheetIdentityVerified: "true" }],
      },
    });
    expect(
      result.some((message) => message.includes("sheetIdentityVerified")),
    ).toBe(true);
  });

  it.each(["missing", "unknown", "invalid-price", "invalid-notes"])(
    "%s evidence or cells cannot establish identity",
    async (kind) => {
      const book = await exportBook(
        records().map((item, index) => ({
          ...item,
          catalogPrice: index === 0 ? 600 : 800,
          sheetRemarks: "シート備考",
          sheetIdentityVerified: true,
        })),
      );
      const sheet = book.getWorksheet("アイテムデータ")!;
      for (const row of [2, 3]) {
        if (kind === "missing") sheet.getCell(row, 19).value = null;
        if (kind === "unknown") sheet.getCell(row, 19).value = "future";
        if (kind === "invalid-price")
          sheet.getCell(row, 17).value = { formula: "1+1" };
        if (kind === "invalid-notes")
          sheet.getCell(row, 18).value = { error: "#VALUE!" };
      }
      const result = await importBook(book);
      expect(result.success).toBe(true);
      expect(result.items.every((item) => !item.sheetIdentityVerified)).toBe(
        true,
      );
      expectAutomaticOrder(result.items, incoming());
    },
  );
});

describe("event metadata text through production ZIP preflight and Worker engine", () => {
  it.each([
    {
      richText: [
        { font: { bold: true }, text: "ユーザー" },
        { text: "登録\n🎉" },
      ],
    },
    { formula: '"ユーザー登録"', result: "ユーザー登録" },
  ] as ExcelJS.CellValue[])(
    "preserves decorated or cached event names %j in JSON and another Excel round-trip",
    async (value) => {
      const book = await exportBook();
      const meta = book.getWorksheet("メタデータ")!;
      meta.eachRow((row) => {
        if (row.getCell(1).value === "eventName") row.getCell(2).value = value;
      });
      const result = await importBook(book);
      const expected =
        typeof value === "object" && value !== null && "richText" in value
          ? "ユーザー登録\n🎉"
          : "ユーザー登録";
      expect(result.success, result.errors.join("\n")).toBe(true);
      expect(result.eventName).toBe(expected);
      expect(jsonRoundTrip(result)).toHaveLength(2);
      const bytes = await xlsxWorkerExecutor.exportWorkbook(
        buildEventWorkbookExportSnapshot(
          result.eventName,
          result.items,
          {
            includeItems: true,
            includeLayoutInfo: false,
            includeMapData: false,
            includeRouteInfo: false,
            format: "full",
          },
          {},
        ),
        new AbortController().signal,
        () => {},
      );
      const next = new ExcelJS.Workbook();
      await next.xlsx.load(new Uint8Array(bytes).buffer);
      expect((await importBook(next)).eventName).toBe(expected);
    },
  );

  it.each([
    { formula: '"ユーザー登録"' },
    { error: "#VALUE!" },
  ] as ExcelJS.CellValue[])(
    "rejects unsupported event names instead of creating object strings %j",
    async (value) => {
      const book = await exportBook();
      book.getWorksheet("メタデータ")!.eachRow((row) => {
        if (row.getCell(1).value === "eventName") row.getCell(2).value = value;
      });
      const result = await importBook(book);
      expect(result.success).toBe(false);
      expect(result.errors.join("\n")).toMatch(/eventName.*非対応セル形式/u);
      expect(JSON.stringify(result)).not.toContain("[object Object]");
    },
  );

  it.each(["contentManifest", "eventMetadata"])(
    "does not reinterpret structured %s metadata as decorated JSON",
    async (key) => {
      const book = await exportBook();
      book.getWorksheet("メタデータ")!.eachRow((row) => {
        if (row.getCell(1).value === key)
          row.getCell(2).value = {
            richText: [{ text: String(row.getCell(2).value) }],
          };
      });
      const result = await importBook(book);
      expect(result.success).toBe(false);
      expect(result.errors.join("\n")).toContain("非対応セル形式");
    },
  );
});

describe("only actual sheet values establish identity provenance", () => {
  it("keeps old JSON and legacy CSV values unverified before and after Excel export", async () => {
    const oldJson = records().map((item) => ({
      ...item,
      catalogPrice: item.price,
      sheetRemarks: "シート備考",
    }));
    expectAutomaticOrder(oldJson, incoming());
    const csv = records()
      .map((item) =>
        [
          item.circle,
          item.eventDate,
          item.block,
          item.number,
          item.title,
          String(item.price),
          String(item.quantity),
          item.purchaseStatus,
          "シート備考",
          "",
          "",
          "",
        ].join(","),
      )
      .join("\n");
    const parsed = readEventCsv(csv, { format: "legacy", header: false });
    const added = buildBulkAddItems(
      parsed.rows.map(({ item: { rawQuantity, ...item } }) => ({
        ...item,
        quantity: Number(rawQuantity),
      })),
      { source: "spreadsheet" },
    );
    expect(added.every((item) => item.sheetIdentityVerified !== true)).toBe(
      true,
    );
    const result = await importBook(await exportBook(added));
    expectAutomaticOrder(result.items, incoming());
  });

  it("marks actual Google sheet values as verified when creating items", () => {
    const rows = incoming().map((item) => {
      const cells = Array<string>(27).fill("");
      [
        item.circle,
        item.eventDate,
        item.block,
        item.number,
        item.title,
        String(item.price),
      ].forEach((value, index) => {
        cells[12 + index] = value;
      });
      cells[22] = item.sheetRemarks!;
      cells[26] = String(item.quantity);
      return cells.join(",");
    });
    const parsed = readEventCsv(
      [Array<string>(27).fill("header").join(","), ...rows].join("\n"),
      { format: "google", header: true },
    );
    const added = buildBulkAddItems(
      parsed.rows.map(({ item: { rawQuantity, ...item } }) => ({
        ...item,
        quantity: Number(rawQuantity),
      })),
      { source: "spreadsheet" },
    );
    expect(added.every((item) => item.sheetIdentityVerified)).toBe(true);
    expect(
      createEventUpdateDiff(added, incoming().reverse()).unresolvedMatches,
    ).toEqual([]);
  });
});
