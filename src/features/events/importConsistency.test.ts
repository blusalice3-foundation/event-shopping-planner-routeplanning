import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../../types/item";
import { createEventUpdateDiff, type SheetItem } from "./updateDiff";
import { applyEventUpdateToItems } from "./updateApply";
import {
  parseEventItemsFromCsv,
  readEventCsv,
  CsvFormatSelectionRequired,
} from "./sheetImport";
import { parseCsvRecords } from "../../utils/csvRecords";
import { getItemKey, insertItemSorted } from "../../utils/itemComparison";
import { buildBulkAddItems, buildLayoutAppliedEventItems } from "./bulkAdd";
const item = (
  id: string,
  fields: Partial<ShoppingItem> = {},
): ShoppingItem => ({
  id,
  circle: "ユーザー登録",
  title: id,
  eventDate: "1日目",
  block: "A",
  number: "01a",
  price: 500,
  catalogPrice: 500,
  remarks: "エラーが発生しました",
  sheetRemarks: "",
  quantity: 5,
  purchaseStatus: "None",
  source: "spreadsheet",
  sheetIdentityVerified: true,
  protectionLevel: "none",
  ...fields,
});
const incoming = (value: ShoppingItem): SheetItem => ({
  ...value,
  price: value.catalogPrice ?? null,
  remarks: value.sheetRemarks ?? "",
});
const csv = (cells: string[]) =>
  cells
    .map((cell) =>
      /[",\r\n]/u.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell,
    )
    .join(",");
const row = (fields: Record<number, string> = {}) => {
  const cells = Array<string>(27).fill("");
  Object.assign(cells, {
    12: "サークル",
    13: " 1日目　",
    14: "A",
    15: "01a",
    16: "参加日の案内",
    22: "備考\r\n#METADATA,spreadsheetUrl,...",
    ...fields,
  });
  return csv(cells);
};
const header = csv(
  Array.from({ length: 27 }, (_, index) =>
    index === 12 ? "サークル名" : `独自見出し${index}`,
  ),
);

describe("CSV format and record validation", () => {
  it("preserves quoted commas, CRLF, escaped quotes, trailing cells and physical line identity", () => {
    const result = parseCsvRecords('\uFEFFa,"b\r\nc","d""e",\r\nf,g,,');
    expect(result.errors).toEqual([]);
    expect(
      result.records.map(({ cells, startLine, endLine }) => ({
        cells,
        startLine,
        endLine,
      })),
    ).toEqual([
      { cells: ["a", "b\r\nc", 'd"e', ""], startLine: 1, endLine: 2 },
      { cells: ["f", "g", "", ""], startLine: 3, endLine: 3 },
    ]);
  });
  it.each(["", "<html>login</html>", `${header}\n${row()}\n"broken`])(
    "never turns an invalid response into an empty update: %s",
    (text) => {
      expect(() => parseEventItemsFromCsv(text)).toThrow();
    },
  );
  it("treats incomplete item rows as ordinary exclusions rather than invalid responses", () => {
    expect(parseEventItemsFromCsv(`${header}\n${row({ 15: "" })}`)).toEqual([]);
    expect(
      readEventCsv(`${header}\n${row({ 15: "" })}`, {
        format: "google",
        header: true,
      }).rowExclusions.excludedCount,
    ).toBe(1);
  });
  it("keeps data containing header/metadata words and optional missing columns", () => {
    const minimal = csv([
      ...Array<string>(12).fill("helper"),
      "サークル",
      "1日目",
      "A",
      "01a",
    ]);
    const result = parseEventItemsFromCsv(`${header}\n${row()}\n${minimal}`);
    expect(result).toHaveLength(2);
    expect(result[0].remarks).toBe("備考\r\n#METADATA,spreadsheetUrl,...");
    expect(result[0].title).toBe("参加日の案内");
    expect(result[1].rawQuantity).toBe("");
  });
  it("skips only structurally defined blank/summary rows and accepts a recognized empty sheet", () => {
    const cells = Array<string>(27).fill("");
    cells[17] = "1200";
    cells[22] = "合計";
    expect(parseEventItemsFromCsv(`${header}\naux\n${csv(cells)}\n`)).toEqual(
      [],
    );
    expect(parseEventItemsFromCsv(header)).toEqual([]);
    cells[12] = "サークル";
    expect(parseEventItemsFromCsv(`${header}\n${csv(cells)}`)).toEqual([]);
    const parsed = readEventCsv(`${header}\n${csv(cells)}`, {
      format: "google",
      header: true,
    });
    expect(parsed.rowExclusions.examples[0].missingFields).toEqual([
      "eventDate",
      "block",
      "number",
    ]);
  });
  it("requires explicit headerless format and retains legacy metadata and the first data row", () => {
    const text =
      "サークル,1日目,A,01a,本,500,2,,備考,実行列,1,https://example.com\n#METADATA,spreadsheetUrl,https://docs.google.com/spreadsheets/d/example/edit";
    expect(() => readEventCsv(text)).toThrow(CsvFormatSelectionRequired);
    const result = readEventCsv(text, { format: "legacy", header: false });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      lineNumber: 1,
      layout: { columnType: "execute", order: 1 },
      item: { circle: "サークル", rawQuantity: "2" },
    });
    expect(result.spreadsheetUrl).toContain("/example/edit");
  });
});

describe("one-to-one sheet identity", () => {
  it("matches reversed duplicate titles using only known sheet values, preserving each ID's records", () => {
    const before = [
      item("a", {
        title: "同名",
        purchaseStatus: "Purchased",
        remarks: "Aの記録",
      }),
      item("b", {
        title: "同名",
        price: 0,
        catalogPrice: 700,
        remarks: "Bの記録",
      }),
    ];
    const diff = createEventUpdateDiff(before, [
      incoming(before[1]),
      incoming(before[0]),
    ]);
    expect(diff.unresolvedMatches).toEqual([]);
    const after = applyEventUpdateToItems(before, diff);
    expect(after).toEqual(before);
  });
  it("requires a choice for a title change and never offers a candidate across the four-field group", () => {
    const before = [item("a"), item("b", { circle: "別", number: "02a" })];
    const rows = [
      incoming(item("new-a", { title: "改題" })),
      incoming(item("new-b", { circle: "別", number: "02a", title: "改題2" })),
    ];
    const pending = createEventUpdateDiff(before, rows);
    expect(
      pending.matching?.proposals.map((value) =>
        value.candidates.map((candidate) => candidate.id),
      ),
    ).toEqual([["a"], ["b"]]);
    expect(() => applyEventUpdateToItems(before, pending)).toThrow();
    const accepted = createEventUpdateDiff(before, rows, {
      "0": "a",
      "1": "new",
    });
    const after = applyEventUpdateToItems(before, accepted);
    expect(after.find((value) => value.id === "a")?.title).toBe("改題");
    expect(after.find((value) => value.title === "改題2")?.id).not.toBe("b");
    expect(
      createEventUpdateDiff(
        [before[0]],
        [incoming(item("new", { circle: "異なる", title: "改題" }))],
      ).matching,
    ).toBeUndefined();
  });
  it("does not use user price/memo as unknown legacy provenance, or reuse one protected ID", () => {
    const a = item("a", {
      title: "同名",
      catalogPrice: undefined,
      sheetRemarks: undefined,
      protectionLevel: "full",
    });
    const b = item("b", {
      title: "同名",
      catalogPrice: undefined,
      sheetRemarks: undefined,
    });
    const rows = [
      incoming(item("new-a", { title: "同名", catalogPrice: 500 })),
      incoming(item("new-b", { title: "同名", catalogPrice: 700 })),
    ];
    expect(createEventUpdateDiff([a, b], rows).unresolvedMatches).toHaveLength(
      2,
    );
    expect(
      createEventUpdateDiff([a, b], rows, { "0": "a", "1": "a" })
        .unresolvedMatches,
    ).toHaveLength(1);
    const diff = createEventUpdateDiff([a, b], rows, { "0": "a", "1": "b" });
    expect(new Set(diff.itemsToUpdate.map((value) => value.id)).size).toBe(
      diff.itemsToUpdate.length,
    );
  });
  it("keeps identical duplicate rows without unnecessary identity choices and encodes separators safely", () => {
    const a = item("a", { title: "同名" }),
      b = item("b", { title: "同名" });
    expect(
      createEventUpdateDiff([a, b], [incoming(a), incoming(b)])
        .unresolvedMatches,
    ).toEqual([]);
    expect(getItemKey(item("a", { circle: "A|B", eventDate: "C" }))).not.toBe(
      getItemKey(item("a", { circle: "A", eventDate: "B|C" })),
    );
  });
});

it("places rows by source identity before sorting, excluding dropped duplicate placements", () => {
  const items = buildBulkAddItems([
    incoming(item("a")),
    incoming(item("b", { price: 700, catalogPrice: 700 })),
  ]);
  const rows = new Map([
    ["r1", items[0].id],
    ["r2", items[1].id],
  ]);
  const layouts = [
    {
      itemKey: getItemKey(items[0]),
      sourceRowId: "r1",
      eventDate: "1日目",
      columnType: "candidate" as const,
      order: 2,
    },
    {
      itemKey: getItemKey(items[1]),
      sourceRowId: "r2",
      eventDate: "1日目",
      columnType: "execute" as const,
      order: 1,
    },
    {
      itemKey: getItemKey(items[0]),
      sourceRowId: "dropped",
      eventDate: "1日目",
      columnType: "execute" as const,
      order: 3,
    },
  ];
  const result = buildLayoutAppliedEventItems(items, layouts, rows);
  expect(result.sortedItems.map((value) => value.id)).toEqual([
    items[1].id,
    items[0].id,
  ]);
  expect(result.executeModeItems["1日目"]).toEqual([items[1].id]);
  expect(JSON.stringify(result.sortedItems)).not.toContain("sourceRowId");
});

it("inserts with real global indices and normalized day comparison while preserving raw dates and manual order", () => {
  const a = item("a", { number: "01a", eventDate: " 1日目　" }),
    b = item("other", { eventDate: "2日目" }),
    c = item("c", { number: "03a", eventDate: " 1日目　" });
  expect(
    insertItemSorted([a, b, c], item("new", { number: "02a" })).map((value) => [
      value.id,
      value.eventDate,
    ]),
  ).toEqual([
    ["a", " 1日目　"],
    ["other", "2日目"],
    ["new", "1日目"],
    ["c", " 1日目　"],
  ]);
  expect(
    insertItemSorted([a, b, c], item("new", { number: "04a" })).map(
      (value) => value.id,
    ),
  ).toEqual(["a", "other", "c", "new"]);
  expect(
    insertItemSorted([c, a], item("new", { number: "02a" })).map(
      (value) => value.id,
    ),
  ).toEqual(["new", "c", "a"]);
});
