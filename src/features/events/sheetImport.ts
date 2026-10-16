import { CsvInputError, parseCsvRecords } from "../../utils/csvRecords";
import type { SheetItem } from "./updateDiff";
import { normalizeImportedUrl } from "./pasteColumns";

const SPREADSHEET_PATH_REGEX = /^\/spreadsheets\/d\/([a-zA-Z0-9-_]+)(?:\/|$)/;
const GID_REGEX = /^\d{1,10}$/;
const MAX_GID = 2_147_483_647;

export interface GoogleSheetCsvRequest {
  spreadsheetId: string;
  sheetName?: string;
  gid?: string;
}

function normalizeGid(value: string | null): string | undefined {
  if (value === null) return undefined;
  if (!GID_REGEX.test(value)) {
    throw new Error("Invalid spreadsheet URL");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_GID) {
    throw new Error("Invalid spreadsheet URL");
  }
  return String(parsed);
}

function toPrice(value: string): number | null {
  if (value === "") return null;
  return parseInt(value.replace(/[^0-9]/g, ""), 10) || 0;
}

export function buildGoogleSheetCsvRequest(
  spreadsheetUrl: string,
  sheetName?: string,
): GoogleSheetCsvRequest {
  let url: URL;
  try {
    url = new URL(spreadsheetUrl.trim());
  } catch {
    throw new Error("Invalid spreadsheet URL");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLocaleLowerCase() !== "docs.google.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("Invalid spreadsheet URL");
  }

  const sheetIdMatch = url.pathname.match(SPREADSHEET_PATH_REGEX);
  if (!sheetIdMatch) throw new Error("Invalid spreadsheet URL");

  const hashParameters = new URLSearchParams(url.hash.replace(/^#/, ""));
  const queryGid = normalizeGid(url.searchParams.get("gid"));
  const hashGid = normalizeGid(hashParameters.get("gid"));
  if (queryGid && hashGid && queryGid !== hashGid) {
    throw new Error("Invalid spreadsheet URL");
  }
  const gid = queryGid ?? hashGid;

  return {
    spreadsheetId: sheetIdMatch[1],
    ...(sheetName ? { sheetName } : {}),
    ...(gid !== undefined ? { gid } : {}),
  };
}

export type EventCsvFormat = "google" | "legacy";
export interface EventCsvOptions {
  format: EventCsvFormat;
  header: boolean;
}
export interface EventCsvRow {
  sourceRowId: string;
  lineNumber: number;
  item: SheetItem;
  layout?: { columnType: "execute" | "candidate"; order: number };
}
export class CsvFormatSelectionRequired extends Error {
  constructor() {
    super("CSVの列形式と見出しの有無を選択してください。");
  }
}

export class CsvReviewRequired extends Error {
  constructor(
    readonly items: SheetItem[],
    readonly warnings: string[],
  ) {
    super(warnings.join("\n"));
    this.name = "CsvReviewRequired";
  }
}
export function readEventCsv(csvText: string, options?: EventCsvOptions) {
  if (/^\s*<(?:!doctype|html|head|body)/iu.test(csvText))
    throw new CsvInputError([
      { line: 1, message: "CSVではなくHTMLが返されました。" },
    ]);
  const parsed = parseCsvRecords(csvText);
  if (parsed.errors.length) throw new CsvInputError(parsed.errors);
  const nonempty = parsed.records.filter((record) =>
    record.cells.some((cell) => cell.trim() !== ""),
  );
  const isMetadata = (record: { cells: readonly string[] }) =>
    record.cells[0] === "#METADATA" &&
    record.cells.slice(3).every((cell) => !cell.trim());
  const first = nonempty.find((record) => !isMetadata(record));
  // A single heading-like value can be item data. Only auto-select a unique
  // positional header; explicit options still allow custom headings.
  const headerFormats = (["google", "legacy"] as const).filter((format) => {
    const offset = format === "google" ? 12 : 0;
    const cells = first?.cells;
    return (
      cells?.[offset]?.trim() === "サークル名" &&
      cells[offset + 1]?.trim() === "参加日" &&
      cells[offset + 2]?.trim() === "ブロック" &&
      ["番号", "ナンバー"].includes(cells[offset + 3]?.trim() ?? "")
    );
  });
  const headerFormat =
    headerFormats.length === 1 ? headerFormats[0] : undefined;
  if (!options) {
    if (!headerFormat) throw new CsvFormatSelectionRequired();
    options = { format: headerFormat, header: true };
  }
  if (!first)
    throw new CsvInputError([
      { line: 1, message: "形式を確認できる見出しまたはデータがありません。" },
    ]);
  const format = options.format;
  const offset = format === "google" ? 12 : 0;
  if (options.header) {
    const headerCells = first.cells.slice(offset, offset + 4);
    const recognizable = first.cells[offset]?.trim() === "サークル名";
    const legacySingleHeading =
      format === "google" &&
      first.cells.length === 1 &&
      first.cells[0].trim() === "サークル名" &&
      nonempty.some(
        (record) =>
          record !== first &&
          [12, 13, 14, 15].every((index) => record.cells[index]?.trim()),
      );
    if (
      !recognizable &&
      !legacySingleHeading &&
      (headerCells.length < 4 || headerCells.some((cell) => !cell.trim()))
    )
      throw new CsvInputError([
        {
          line: first.startLine,
          message: "選択した列形式の見出しを確認できません。",
        },
      ]);
  }
  const rows: EventCsvRow[] = [];
  const warnings: string[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  let spreadsheetUrl: string | undefined;
  const blank = (cells: readonly string[]) =>
    cells.every((cell) => cell.trim() === "");
  for (const record of nonempty) {
    const cells = record.cells;
    if (isMetadata(record)) {
      if (cells[1] === "spreadsheetUrl" && cells[2]?.trim()) {
        try {
          buildGoogleSheetCsvRequest(cells[2]);
          spreadsheetUrl = cells[2].trim();
        } catch {
          warnings.push(
            `${record.startLine}行目: 更新元URLが不正なため引き継ぎません。`,
          );
        }
      } else warnings.push(`${record.startLine}行目: 不明なメタデータです。`);
      continue;
    }
    if (options.header && record === first) continue;
    if (format === "google" && blank(cells.slice(12))) continue;
    const cell = (index: number) => cells[index]?.trim() ?? "";
    if (
      format === "google" &&
      ["合計", "小計", "注意事項"].includes(cell(22)) &&
      blank(
        cells.slice(12).filter((_, index) => index !== 5 && index !== 10),
      ) &&
      (cell(17) === "" || /^[\d,¥￥\s]+$/u.test(cell(17)))
    )
      continue;
    const required = ["サークル名", "参加日", "ブロック", "番号"];
    const missing = required.filter((_, index) => !cell(offset + index));
    if (missing.length === 4) {
      warnings.push(
        `${record.startLine}行目: 品目か案内かを判定できないため除外候補です。${cells.join(" / ").slice(0, 500)}`,
      );
      continue;
    }
    if (missing.length) {
      errors.push({
        line: record.startLine,
        message: `${missing.join("・")}がありません。品目行か案内行かを確認してください。`,
      });
      continue;
    }
    const remarks = cell(format === "google" ? 22 : 8);
    const price = toPrice(cell(offset + 5));
    const url = normalizeImportedUrl(cell(format === "google" ? 24 : 11));
    const item: SheetItem = {
      circle: cell(offset),
      eventDate: cell(offset + 1),
      block: cell(offset + 2),
      number: cell(offset + 3),
      title: cell(offset + 4),
      price,
      catalogPrice: price,
      quantity: 1,
      rawQuantity: cell(format === "google" ? 26 : 6),
      remarks,
      sheetRemarks: remarks,
      ...(format === "google" ? { sheetIdentityVerified: true } : {}),
      ...(url ? { url } : {}),
    };
    const columnType =
      format === "legacy"
        ? cell(9) === "実行列"
          ? "execute"
          : cell(9) === "候補リスト"
            ? "candidate"
            : undefined
        : undefined;
    const order = Number(cell(10));
    rows.push({
      sourceRowId: record.sourceRowId,
      lineNumber: record.startLine,
      item,
      ...(columnType && Number.isInteger(order) && order > 0
        ? { layout: { columnType, order } }
        : {}),
    });
  }
  if (errors.length) throw new CsvInputError(errors);
  return { rows, spreadsheetUrl, warnings, format };
}

export function parseEventItemsFromCsv(csvText: string): SheetItem[] {
  const parsed = readEventCsv(csvText, { format: "google", header: true });
  const items = parsed.rows.map((row) => row.item);
  if (parsed.warnings.length)
    throw new CsvReviewRequired(items, parsed.warnings);
  return items;
}

export async function fetchGoogleSheetCsv(
  spreadsheetUrl: string,
  sheetName?: string,
): Promise<string> {
  const request = buildGoogleSheetCsvRequest(spreadsheetUrl, sheetName);
  const response = await fetch("/api/google-sheets-csv", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "text/csv",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error("Failed to fetch spreadsheet data.");
  }

  return await response.text();
}

export async function fetchEventItemsFromSpreadsheet(
  spreadsheetUrl: string,
  sheetName?: string,
): Promise<SheetItem[]> {
  return parseEventItemsFromCsv(
    await fetchGoogleSheetCsv(spreadsheetUrl, sheetName),
  );
}
