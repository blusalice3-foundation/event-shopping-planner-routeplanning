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
import { createSheetIdentityFingerprint } from "../../utils/sheetIdentity";
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
    remarks: "シート備考",
    rawQuantity: String(item.quantity),
    sheetIdentityFingerprint: createSheetIdentityFingerprint(
      index === 0 ? 600 : 800,
      "シート備考",
    ),
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
  expect(diff.itemsToAdd).toEqual([]);
  expect(diff.itemsToDelete).toEqual([]);
  const after = applyEventUpdateToItems(before, diff);
  expect(after.map((item) => item.id)).toEqual(before.map((item) => item.id));
  expect(
    after.map((item) => [item.price, item.remarks, item.quantity]),
  ).toEqual(rows.map((item) => [item.price, item.remarks, item.quantity]));
}
function setLegacyVersion(book: ExcelJS.Workbook, version: string) {
  const sheet = book.getWorksheet("アイテムデータ")!;
  sheet.spliceColumns(17, 1);
  if (version !== "2.1") {
    ["カタログ価格", "シート備考", "シート照合根拠"].forEach(
      (header, index) => {
        sheet.getCell(1, 17 + index).value = header;
      },
    );
    records().forEach((item, index) => {
      sheet.getCell(index + 2, 17).value = item.price;
      sheet.getCell(index + 2, 18).value = item.remarks;
    });
  }
  if (version !== "3.0") book.removeWorksheet("関連設定");
  const meta = book.getWorksheet("メタデータ")!;
  for (let row = meta.rowCount; row >= 2; row--) {
    const key = meta.getCell(row, 1).value;
    if (key === "version") meta.getCell(row, 2).value = version;
    if (
      version !== "3.0" &&
      ["contentManifest", "consistencySchemaVersion", "eventMetadata"].includes(
        String(key),
      )
    )
      meta.spliceRows(row, 1);
  }
}

describe("sheet identity through production ZIP preflight and Worker engine", () => {
  it.each(["full", "simple"] as const)(
    "%s keeps absent provenance absent through repeated Excel/JSON round-trips",
    async (format) => {
      let result = await importBook(await exportBook(records(), format));
      for (let round = 0; round < 2; round++) {
        expect(result.success, result.errors.join("\n")).toBe(true);
        expect(
          result.items.map((item) => item.sheetIdentityFingerprint),
        ).toEqual([undefined, undefined]);
        expect(result.items.map((item) => [item.price, item.remarks])).toEqual(
          records().map((item) => [item.price, item.remarks]),
        );
        const restored =
          format === "simple" ? result.items : jsonRoundTrip(result);
        for (const rows of [incoming(), incoming().reverse()])
          expectAutomaticOrder(restored, rows);
        result = await importBook(await exportBook(restored, format));
      }
    },
  );

  it.each(["2.1", "2.2", "3.0"])(
    "does not trust older %s workbook columns without verified provenance",
    async (version) => {
      const book = await exportBook();
      setLegacyVersion(book, version);
      const result = await importBook(book);
      expect(result.success, result.errors.join("\n")).toBe(true);
      expect(result.items.map((item) => item.sheetIdentityFingerprint)).toEqual(
        [undefined, undefined],
      );
      const next = await importBook(await exportBook(jsonRoundTrip(result)));
      expectAutomaticOrder(next.items, incoming());
    },
  );

  it.each(["full", "simple"] as const)(
    "%s retains opaque identity independently of edited fields and locks",
    async (format) => {
      const originals = records().map((item, index) => ({
        ...item,
        protectionLevel: "full" as const,
        purchaseStatus: "Purchased" as const,
        sheetIdentityFingerprint: incoming()[index].sheetIdentityFingerprint,
      }));
      const result = await importBook(await exportBook(originals, format));
      expect(result.success, result.errors.join("\n")).toBe(true);
      const restored =
        format === "simple" ? result.items : jsonRoundTrip(result);
      originals.forEach((item, index) =>
        expect(restored[index]).toMatchObject(item),
      );
      const diff = createEventUpdateDiff(restored, incoming().reverse());
      expect(diff.unresolvedMatches).toEqual([]);
      expect(diff.itemsToAdd).toEqual([]);
      expect(diff.itemsToDelete).toEqual([]);
      expect(applyEventUpdateToItems(restored, diff)).toEqual(restored);
      for (const item of restored) {
        expect(item).not.toHaveProperty("catalogPrice");
        expect(item).not.toHaveProperty("sheetRemarks");
        expect(item).not.toHaveProperty("sheetIdentityVerified");
      }
    },
  );

  it("establishes incoming identity and updates unlocked fields while preserving quantity confirmation", async () => {
    const result = await importBook(await exportBook());
    const restored = jsonRoundTrip(result);
    restored[1].purchaseStatus = "Purchased";
    const rows = incoming();
    rows[1] = { ...rows[1], quantity: 3, rawQuantity: "3" };
    const diff = createEventUpdateDiff(restored, rows);
    expect(diff.pendingPurchasedQuantityChanges).toMatchObject([
      { itemId: "2", currentQuantity: 5, nextQuantity: 3 },
    ]);
    const after = applyEventUpdateToItems(restored, diff);
    expect(after.map((item) => item.quantity)).toEqual([2, 5]);
    expect(
      after.map((item) => [
        item.price,
        item.remarks,
        item.sheetIdentityFingerprint,
      ]),
    ).toEqual(
      rows.map((item) => [
        item.price,
        item.remarks,
        item.sheetIdentityFingerprint,
      ]),
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

  it("rejects malformed identity fingerprints in restored JSON", () => {
    const errors = validateSnapshotStructure({
      eventLists: {
        event: [{ ...records()[0], sheetIdentityFingerprint: "invalid" }],
      },
    });
    expect(
      errors.some((message) => message.includes("sheetIdentityFingerprint")),
    ).toBe(true);
  });

  it.each(["missing", "unknown", "invalid-price", "invalid-notes"])(
    "legacy %s evidence cannot establish identity",
    async (kind) => {
      const book = await exportBook();
      setLegacyVersion(book, "3.0");
      const sheet = book.getWorksheet("アイテムデータ")!;
      for (const row of [2, 3]) {
        sheet.getCell(row, 19).value = "verified";
        if (kind === "missing") sheet.getCell(row, 19).value = null;
        if (kind === "unknown") sheet.getCell(row, 19).value = "future";
        if (kind === "invalid-price")
          sheet.getCell(row, 17).value = { formula: "1+1" };
        if (kind === "invalid-notes")
          sheet.getCell(row, 18).value = { error: "#VALUE!" };
      }
      const result = await importBook(book);
      expect(result.success, result.errors.join("\n")).toBe(true);
      expect(
        result.items.every(
          (item) => item.sheetIdentityFingerprint === undefined,
        ),
      ).toBe(true);
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
  it("exports sheet imports appended as fixed app items without retaining sheet identity", async () => {
    const added = buildBulkAddItems(
      incoming().map(({ rawQuantity, ...item }) => ({
        ...item,
        quantity: Number(rawQuantity),
      })),
      { source: "app" },
    );
    for (const item of added) {
      expect(item.source).toBe("app");
      expect(item.protectionLevel).toBe("full");
      expect(item).not.toHaveProperty("sheetIdentityFingerprint");
    }
    const result = await importBook(await exportBook(added));
    expect(result.success, result.errors.join("\n")).toBe(true);
    added.forEach((item, index) => {
      expect(result.items[index]).toMatchObject(item);
      expect(result.items[index]).not.toHaveProperty(
        "sheetIdentityFingerprint",
      );
    });
  });
  it("keeps legacy CSV values unverified before and after Excel export", async () => {
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
    expect(
      added.every((item) => item.sheetIdentityFingerprint === undefined),
    ).toBe(true);
    expectAutomaticOrder(
      (await importBook(await exportBook(added))).items,
      incoming(),
    );
  });

  it("records Google sheet identity without retaining separate price or notes", () => {
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
      cells[22] = item.remarks;
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
    expect(added.map((item) => item.sheetIdentityFingerprint)).toEqual(
      incoming().map((item) => item.sheetIdentityFingerprint),
    );
    expect(
      createEventUpdateDiff(added, incoming().reverse()).unresolvedMatches,
    ).toEqual([]);
  });
});
