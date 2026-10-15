import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../../types/item";
import {
  buildGoogleSheetCsvRequest,
  fetchGoogleSheetCsv,
  parseEventItemsFromCsv,
  readEventCsv,
  CsvFormatSelectionRequired,
  type EventCsvFormat,
} from "./sheetImport";
import { createEventUpdateDiff } from "./updateDiff";

function csvRow(
  quantity: string,
  url = "https://example.com",
  number = "01a",
): string {
  const cells = Array.from({ length: 27 }, () => "");
  cells[12] = "サークルA";
  cells[13] = "1日目";
  cells[14] = "東A";
  cells[15] = number;
  cells[16] = "新刊";
  cells[17] = "1,200円";
  cells[22] = "シート備考";
  cells[24] = url;
  cells[26] = quantity;
  return cells
    .map((cell) => (cell.includes(",") ? `"${cell}"` : cell))
    .join(",");
}

const formatRow = (format: EventCsvFormat, cells: string[]) =>
  [...Array<string>(format === "google" ? 12 : 0).fill(""), ...cells].join(",");

for (const format of ["legacy", "google"] as const) {
  describe(`readEventCsv ${format} format selection`, () => {
    it.each([
      ["サークル名", "1日目", "東A", "01a"],
      ["サークル名", "参加日", "東A", "01a"],
      ["サークル名", "参加日", "ブロック", "01a"],
    ])(
      "asks before dropping header-like first data: %s,%s,%s,%s",
      (...first) => {
        const text = [
          formatRow(format, [...first, "先頭の新刊", "500"]),
          formatRow(format, [
            "サークルB",
            "1日目",
            "東A",
            "02a",
            "次の新刊",
            "700",
          ]),
        ].join("\n");
        expect(() => readEventCsv(text)).toThrow(CsvFormatSelectionRequired);
        const result = readEventCsv(text, { format, header: false });
        expect(result.warnings).toEqual([]);
        expect(
          result.rows.map(({ lineNumber, item }) => [lineNumber, item]),
        ).toEqual([
          [
            1,
            expect.objectContaining({
              circle: first[0],
              eventDate: first[1],
              block: first[2],
              number: first[3],
              title: "先頭の新刊",
              price: 500,
            }),
          ],
          [
            2,
            expect.objectContaining({
              circle: "サークルB",
              title: "次の新刊",
              price: 700,
            }),
          ],
        ]);
        expect(
          new Set(result.rows.map(({ sourceRowId }) => sourceRowId)).size,
        ).toBe(2);
      },
    );

    it.each([
      ["番号", "価格"],
      ["ナンバー", "頒布価格"],
    ])("recognizes positional headings with %s and %s", (number, price) => {
      const text = [
        "\uFEFF",
        "#METADATA,spreadsheetUrl,https://docs.google.com/spreadsheets/d/example/edit",
        "",
        formatRow(format, [
          " サークル名　",
          "参加日",
          "ブロック",
          number,
          "タイトル",
          price,
        ]),
        formatRow(format, ["サークルA", "1日目", "東A", "01a", "新刊", "500"]),
      ].join("\n");
      const result = readEventCsv(text);
      expect(result.format).toBe(format);
      expect(result.warnings).toEqual([]);
      expect(result.rows).toEqual([
        expect.objectContaining({
          lineNumber: 5,
          item: expect.objectContaining({ circle: "サークルA", price: 500 }),
        }),
      ]);
      expect(result.spreadsheetUrl).toContain("/example/edit");
    });

    it("preserves a single heading when the caller has confirmed the format", () => {
      const text = [
        formatRow(format, ["サークル名"]),
        formatRow(format, ["サークル名", "1日目", "東A", "01a", "新刊", "500"]),
      ].join("\n");
      expect(() => readEventCsv(text)).toThrow(CsvFormatSelectionRequired);
      expect(readEventCsv(text, { format, header: true }).rows).toEqual([
        expect.objectContaining({
          lineNumber: 2,
          item: expect.objectContaining({
            circle: "サークル名",
            title: "新刊",
          }),
        }),
      ]);
    });

    it("accepts known headings without optional columns, including an empty sheet", () => {
      const header = formatRow(format, [
        "サークル名",
        "参加日",
        "ブロック",
        "番号",
      ]);
      expect(readEventCsv(header).rows).toEqual([]);
      const result = readEventCsv(
        `${header}\n${formatRow(format, ["サークルA", "1日目", "東A", "01a"])}`,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].item).toMatchObject({
        circle: "サークルA",
        title: "",
        price: null,
        rawQuantity: "",
      });
    });

    it("keeps custom headings available through explicit selection", () => {
      const text = [
        formatRow(format, [
          "出展者",
          "日程",
          "区画",
          "スペース",
          "作品",
          "金額",
        ]),
        formatRow(format, ["サークル名", "1日目", "東A", "01a", "新刊", "500"]),
      ].join("\n");
      expect(() => readEventCsv(text)).toThrow(CsvFormatSelectionRequired);
      expect(readEventCsv(text, { format, header: true }).rows).toEqual([
        expect.objectContaining({
          lineNumber: 2,
          item: expect.objectContaining({
            circle: "サークル名",
            title: "新刊",
          }),
        }),
      ]);
    });
  });
}

it("requires selection when both A and M positions have known headings", () => {
  const heading = ["サークル名", "参加日", "ブロック", "番号"];
  const first = [...heading, ...Array<string>(8).fill(""), ...heading].join(
    ",",
  );
  const data = [
    "A列のサークル",
    "1日目",
    "東A",
    "01a",
    ...Array<string>(8).fill(""),
    "M列のサークル",
    "1日目",
    "東A",
    "02a",
  ].join(",");
  const text = `${first}\n${data}`;
  expect(() => readEventCsv(text)).toThrow(CsvFormatSelectionRequired);
  for (const format of ["legacy", "google"] as const) {
    expect(readEventCsv(text, { format, header: true }).rows).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({
          circle: format === "legacy" ? "A列のサークル" : "M列のサークル",
        }),
      }),
    ]);
  }
});

describe("parseEventItemsFromCsv quantity", () => {
  it("空欄・不正値・正常値を丸めずに差分処理へ渡す", () => {
    const header = Array.from({ length: 27 }, (_, index) => `列${index}`).join(
      ",",
    );
    const parsed = parseEventItemsFromCsv(
      [header, csvRow(""), csvRow("21"), csvRow("5")].join("\n"),
    );

    expect(parsed.map((item) => item.rawQuantity)).toEqual(["", "21", "5"]);
    expect(parsed.every((item) => item.quantity === 1)).toBe(true);
    expect(parsed[0]).toMatchObject({
      price: 1200,
      catalogPrice: 1200,
      remarks: "シート備考",
      sheetRemarks: "シート備考",
      url: "https://example.com",
    });
  });

  it("Y列は妥当なHTTP(S) URLだけを取り込む", () => {
    const header = Array.from({ length: 27 }, (_, index) => `列${index}`).join(
      ",",
    );
    const parsed = parseEventItemsFromCsv(
      [
        header,
        csvRow("1", "https://example.com/item", "01a"),
        csvRow("1", "備考の文字列", "02a"),
        csvRow("1", "javascript:alert(1)", "03a"),
      ].join("\n"),
    );

    expect(parsed[0].url).toBe("https://example.com/item");
    expect(parsed[1].url).toBeUndefined();
    expect(parsed[2].url).toBeUndefined();
  });

  it("全行CSVに含まれる手動非表示・フィルタ非表示相当の品目を削除しない", () => {
    const header = Array.from({ length: 27 }, (_, index) => `列${index}`).join(
      ",",
    );
    const parsed = parseEventItemsFromCsv(
      [
        header,
        csvRow("1", "https://example.com/visible", "01a"),
        csvRow("1", "https://example.com/manually-hidden", "02a"),
        csvRow("1", "https://example.com/filter-hidden", "03a"),
      ].join("\n"),
    );
    const currentItems: ShoppingItem[] = parsed.map((item, index) => ({
      ...item,
      id: `existing-${index + 1}`,
      purchaseStatus: "None",
      source: "spreadsheet",
      protectionLevel: "none",
    }));
    const actuallyDeleted: ShoppingItem = {
      ...currentItems[0],
      id: "actually-deleted",
      number: "04a",
    };

    const diff = createEventUpdateDiff(
      [...currentItems, actuallyDeleted],
      parsed,
    );

    expect(diff.itemsToDelete.map((item) => item.id)).toEqual([
      "actually-deleted",
    ]);
    expect(diff.itemsToDelete).not.toContainEqual(
      expect.objectContaining({ id: "existing-2" }),
    );
    expect(diff.itemsToDelete).not.toContainEqual(
      expect.objectContaining({ id: "existing-3" }),
    );
  });
});

describe("fetchGoogleSheetCsv", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses only the purpose-fixed same-origin CSV gateway", async () => {
    const fetchMock = vi.fn(async () => new Response("csv-body"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchGoogleSheetCsv(
        "https://docs.google.com/spreadsheets/d/abcdefghij123456/edit#gid=0042&fvid=99",
        "品目表",
      ),
    ).resolves.toBe("csv-body");
    expect(fetchMock).toHaveBeenCalledWith("/api/google-sheets-csv", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "text/csv",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        spreadsheetId: "abcdefghij123456",
        sheetName: "品目表",
        gid: "42",
      }),
    });
  });
});

describe("buildGoogleSheetCsvRequest", () => {
  it("queryまたはfragmentのgidを正規化し、fvidは送信しない", () => {
    expect(
      buildGoogleSheetCsvRequest(
        "https://docs.google.com/spreadsheets/d/abcdefghij123456/edit?gid=0007",
        "品目表",
      ),
    ).toEqual({
      spreadsheetId: "abcdefghij123456",
      sheetName: "品目表",
      gid: "7",
    });
    expect(
      buildGoogleSheetCsvRequest(
        "https://docs.google.com/spreadsheets/d/abcdefghij123456/edit#gid=0&fvid=123",
      ),
    ).toEqual({
      spreadsheetId: "abcdefghij123456",
      gid: "0",
    });
  });

  it("gidなしURLはシート名からサーバー側で解決できる形を保つ", () => {
    expect(
      buildGoogleSheetCsvRequest(
        "https://docs.google.com/spreadsheets/d/abcdefghij123456/edit?usp=sharing",
        "品目表",
      ),
    ).toEqual({
      spreadsheetId: "abcdefghij123456",
      sheetName: "品目表",
    });
  });

  it.each([
    "http://docs.google.com/spreadsheets/d/abcdefghij123456/edit#gid=0",
    "https://docs.google.com.evil.test/spreadsheets/d/abcdefghij123456/edit#gid=0",
    "https://user@docs.google.com/spreadsheets/d/abcdefghij123456/edit#gid=0",
    "https://docs.google.com/spreadsheets/d/abcdefghij123456/edit#gid=-1",
    "https://docs.google.com/spreadsheets/d/abcdefghij123456/edit#gid=1.5",
    "https://docs.google.com/spreadsheets/d/abcdefghij123456/edit#gid=2147483648",
    "https://docs.google.com/spreadsheets/d/abcdefghij123456/edit?gid=1#gid=2",
  ])("不正または曖昧なURLを拒否する: %s", (url) => {
    expect(() => buildGoogleSheetCsvRequest(url, "品目表")).toThrow(
      "Invalid spreadsheet URL",
    );
  });
});
