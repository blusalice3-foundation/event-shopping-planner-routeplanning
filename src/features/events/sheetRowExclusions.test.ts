import { afterEach, describe, expect, it, vi } from "vitest";
import { readEventCsv } from "./sheetImport";
import { buildEventUpdateDiffFromSpreadsheet } from "./updateFlow";
import { normalizeSheetItemsUrls } from "./updateDiff";
import { decideSheetQuantity } from "./quantitySync";
import { sheetItem, sheetCsv } from "../../test/sheetImportOptionalUrlFixtures";
import { parseCsvRecords } from "../../utils/csvRecords";

afterEach(() => vi.unstubAllGlobals());
for (const format of ["google", "legacy"] as const) {
  describe(`required sheet fields: ${format}`, () => {
    it("selects only the complete row from all sixteen combinations and keeps physical identities", () => {
      const offset = format === "google" ? 12 : 0;
      const csv = Array.from({ length: 16 }, (_, mask) => {
        const cells = Array<string>(offset).fill("");
        cells.push(
          ...["サークル", "1日目", "A", "0"].map((value, index) =>
            mask & (1 << index) ? value : "　 ",
          ),
        );
        cells.push('"新刊\n続き"');
        return cells.join(",");
      }).join("\n");
      const result = readEventCsv(csv, { format, header: false });
      const records = parseCsvRecords(csv).records;
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].item).toMatchObject({
        circle: "サークル",
        number: "0",
        price: null,
      });
      expect(result.rowExclusions).toMatchObject({
        excludedCount: 15,
        missingFieldCounts: { circle: 8, eventDate: 8, block: 8, number: 8 },
      });
      expect(result.rowExclusions.examples).toHaveLength(15);
      expect(result.rowExclusions.examples[1]).toMatchObject({
        sourceRowId: records[1].sourceRowId,
        lineNumber: 3,
        missingFields: ["eventDate", "block", "number"],
      });
      expect(result.rows[0].sourceRowId).toBe(records[15].sourceRowId);
      expect(result.warnings).toEqual([]);
    });
    it("bounds examples without capping counts or mixing existing review warnings", () => {
      const result = readEventCsv(
        `#METADATA,unknown,value\n${sheetCsv(100, "excluded", format)}`,
      );
      expect(result.rowExclusions.excludedCount).toBe(100);
      expect(result.rowExclusions.examples).toHaveLength(20);
      expect(result.rowExclusions.missingFieldCounts.block).toBe(100);
      expect(result.warnings).toHaveLength(1);
      expect(result.rows).toEqual([]);
    });
  });
}
it("excludes only required-field failures before URL completion, then applies the existing quantity policy", () => {
  const row = (
    number: string,
    quantity: string,
    url: string,
    block = "A",
    circle = "同一サークル",
    day = "1日目",
  ) => {
    const cells = Array<string>(27).fill("");
    Object.assign(cells, {
      12: circle,
      13: day,
      14: block,
      15: number,
      16: "新刊",
      24: url,
      26: quantity,
    });
    return cells.join(",");
  };
  const parsed = readEventCsv(
    [
      row("1", "1", "https://excluded.test", ""),
      row("2", "21", "https://quantity.test"),
      row("3", "2", ""),
      row("4", "1", "https://later.test"),
      row("5", "1", "", "A", "別サークル"),
      row("6", "1", "", "A", "同一サークル", "2日目"),
    ].join("\n"),
    { format: "google", header: false },
  );
  const completed = normalizeSheetItemsUrls(parsed.rows.map((row) => row.item));
  const accepted = completed.filter(
    (item) => decideSheetQuantity(item.rawQuantity, "new").kind !== "invalid",
  );
  expect(parsed.rowExclusions.excludedCount).toBe(1);
  expect(accepted.map((item) => [item.number, item.url])).toEqual([
    ["3", "https://quantity.test"],
    ["4", "https://later.test"],
    ["5", undefined],
    ["6", undefined],
  ]);
});
it("all excluded rows produce deletion candidates with the existing protection policy and diagnostics", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      text: async () => sheetCsv(4, "excluded"),
    })),
  );
  const current = [
    sheetItem(0),
    { ...sheetItem(1), protectionLevel: "full" as const },
    { ...sheetItem(2), protectionLevel: "deletable" as const },
    { ...sheetItem(3), source: "app" as const, protectionLevel: undefined },
  ];
  const diff = await buildEventUpdateDiffFromSpreadsheet(current, {
    url: "https://docs.google.com/spreadsheets/d/test/edit",
    sheetName: "品目表",
  });
  expect(diff.itemsToDelete.map((item) => item.id)).toEqual([
    "item-0",
    "item-2",
  ]);
  expect(diff.protectedFromDelete).toBe(2);
  expect(diff.sheetImport).toMatchObject({
    acceptedCount: 0,
    rowExclusions: { excludedCount: 4 },
  });
  expect(diff.csvReview).toBeUndefined();
});
