import { recordEntry, setOwnValue } from "../../utils/ownRecord";
import {
  createWorkbookSource,
  selectWorkbookContent,
  encodeConsistencyRows,
  decodeConsistencyRows,
  parseContentManifest,
  validateWorkbookManifest,
  type ConsistencyChunkRow,
  type ContentManifest,
} from "../domain/consistencyWorkbook";
import {
  validateSnapshotStructure,
  validateSnapshotReferences,
} from "../../utils/appBackup";
import type { PersistenceSnapshot } from "../../app/ports/PersistenceCommandPort";
/**
 * エクスポート/インポート ユーティリティ
 * IndexedDBのデータをxlsxファイルにエクスポート/インポート
 */

import ExcelJS from "exceljs";
import {
  ShoppingItem,
  EventMetadata,
  PurchaseStatuses,
} from "../../types/item";
import {
  BlockDetectionSettings,
  MapRotationSettingsStore,
  MapViewportSettingsStore,
  isBlockDetectionSettings,
} from "../../types/map";
import type { ExportOptions } from "../../types/export";
import {
  normalizeLimitedPurchaseFields,
  validateLimitedPurchaseQuantities,
} from "../../utils/purchaseQuantity";
import type {
  EventWorkbookAdditionalData,
  EventWorkbookImportResult,
  ItemFallbackWarning,
  LegacySheetFieldFallback,
} from "../domain/eventWorkbook";
export type {
  EventWorkbookImportResult as ImportResult,
  ItemFallbackWarning,
  LegacySheetFieldFallback,
} from "../domain/eventWorkbook";

// エクスポートデータの型
export interface ExportData {
  version: string;
  exportDate: string;
  eventName: string;
  metadata?: EventMetadata;
  items: ShoppingItem[];
  layoutInfo?: {
    executeModeItems: Record<string, string[]>;
    dayModes: Record<string, string>;
  };
  mapData?: Record<string, unknown>;
  mapRotationSettings?: MapRotationSettingsStore[string];
  mapViewportSettings?: MapViewportSettingsStore[string];
  routeSettings?: Record<string, unknown>;
  hallDefinitions?: Record<string, unknown[]>;
  hallRouteSettings?: Record<string, unknown>;
  blockDetectionSettings?: BlockDetectionSettings;
}

const EXPORT_VERSION = "3.0";
const WORKBOOK_CREATOR = "Event Shopping Planner";
const TEXT_METADATA_KEYS = new Set([
  "eventName",
  "exportDate",
  "spreadsheetUrl",
  "spreadsheetSheetName",
  "lastImportDate",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type StrictPositiveIntegerCellParseResult =
  | { kind: "empty" }
  | { kind: "value"; value: number }
  | { kind: "invalid"; raw: string };

type FiniteNumberCellParseResult =
  | { kind: "empty" }
  | { kind: "value"; value: number }
  | { kind: "invalid"; raw: string };

const isFormulaCellValue = (
  rawValue: ExcelJS.CellValue,
): rawValue is ExcelJS.CellFormulaValue | ExcelJS.CellSharedFormulaValue =>
  typeof rawValue === "object" &&
  rawValue !== null &&
  ("formula" in rawValue || "sharedFormula" in rawValue);

const parseStrictPositiveIntegerScalar = (
  rawValue: number | string,
): StrictPositiveIntegerCellParseResult => {
  if (typeof rawValue === "number") {
    return Number.isInteger(rawValue) && rawValue >= 1
      ? { kind: "value", value: rawValue }
      : { kind: "invalid", raw: String(rawValue) };
  }

  const rawText = rawValue.trim();
  if (rawText === "") return { kind: "empty" };
  if (!/^\d+$/.test(rawText)) return { kind: "invalid", raw: rawText };

  const value = Number(rawText);
  return value >= 1
    ? { kind: "value", value }
    : { kind: "invalid", raw: rawText };
};

const parseStrictPositiveIntegerCell = (
  rawValue: ExcelJS.CellValue,
): StrictPositiveIntegerCellParseResult => {
  if (rawValue === null || rawValue === undefined) return { kind: "empty" };

  if (typeof rawValue === "number" || typeof rawValue === "string") {
    return parseStrictPositiveIntegerScalar(rawValue);
  }

  if (isFormulaCellValue(rawValue)) {
    const result = rawValue.result;
    if (typeof result === "number" || typeof result === "string") {
      return parseStrictPositiveIntegerScalar(result);
    }
    return { kind: "invalid", raw: "数式結果なし" };
  }

  return { kind: "invalid", raw: "非対応セル形式" };
};

const parseFiniteNumberScalar = (
  rawValue: number | string,
): FiniteNumberCellParseResult => {
  if (typeof rawValue === "number") {
    return Number.isFinite(rawValue)
      ? { kind: "value", value: rawValue }
      : { kind: "invalid", raw: String(rawValue) };
  }

  const rawText = rawValue.trim();
  if (rawText === "") return { kind: "empty" };
  const value = Number(rawText);
  return Number.isFinite(value)
    ? { kind: "value", value }
    : { kind: "invalid", raw: rawText };
};

const parseFiniteNumberCell = (
  rawValue: ExcelJS.CellValue,
): FiniteNumberCellParseResult => {
  if (rawValue === null || rawValue === undefined) return { kind: "empty" };

  if (typeof rawValue === "number" || typeof rawValue === "string") {
    return parseFiniteNumberScalar(rawValue);
  }

  if (isFormulaCellValue(rawValue)) {
    const result = rawValue.result;
    if (typeof result === "number" || typeof result === "string") {
      return parseFiniteNumberScalar(result);
    }
    return { kind: "invalid", raw: "数式結果なし" };
  }

  return { kind: "invalid", raw: "非対応セル形式" };
};

/** Preserve text without coercing structured Excel values into object strings. */
function parseTextCell(value: ExcelJS.CellValue): string | undefined {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "boolean")
    return String(value);
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : undefined;
  if (value instanceof Date) return String(value);
  if (typeof value === "object" && "richText" in value)
    return value.richText.every((part) => typeof part.text === "string")
      ? value.richText.map((part) => part.text).join("")
      : undefined;
  if (isFormulaCellValue(value)) {
    const result = value.result;
    if (typeof result === "string" || typeof result === "boolean")
      return String(result);
    if (typeof result === "number" && Number.isFinite(result))
      return String(result);
  }
  return undefined;
}

/** Read auxiliary text while keeping JSON payload cells scalar-only. */
function readAuxiliaryTextCell(
  cell: ExcelJS.Cell,
  field: string,
  scalarOnly = false,
): string {
  const rawValue = cell.value;
  const text =
    scalarOnly && rawValue !== null && typeof rawValue === "object"
      ? undefined
      : parseTextCell(scalarOnly ? rawValue || "" : rawValue);
  if (text === undefined)
    throw new Error(
      `${cell.worksheet.name}${cell.row}行目「${field}」が非対応セル形式です。`,
    );
  return text;
}

/**
 * データをxlsxファイルにエクスポート
 */
export async function exportToXlsx(
  eventName: string,
  items: ShoppingItem[],
  options: ExportOptions,
  additionalData: EventWorkbookAdditionalData,
): Promise<Blob> {
  const selected = selectWorkbookContent(
    createWorkbookSource(eventName, items, additionalData),
    eventName,
    options,
  );
  items = recordEntry(
    selected.snapshot.eventLists,
    eventName,
  ) as ShoppingItem[];
  additionalData = {
    ...selected.snapshot,
    metadata: recordEntry(
      selected.snapshot.eventMetadata,
      eventName,
    ) as EventMetadata,
  } as EventWorkbookAdditionalData;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = WORKBOOK_CREATOR;
  workbook.created = new Date();

  // 1. アイテムデータシート（必須）
  const itemsSheet = workbook.addWorksheet("アイテムデータ");

  // ヘッダー
  itemsSheet.columns = [
    { header: "ID", key: "id", width: 40 },
    { header: "サークル名", key: "circle", width: 20 },
    { header: "参加日", key: "eventDate", width: 12 },
    { header: "ブロック", key: "block", width: 10 },
    { header: "ナンバー", key: "number", width: 10 },
    { header: "タイトル", key: "title", width: 30 },
    { header: "価格", key: "price", width: 10 },
    { header: "数量", key: "quantity", width: 8 },
    { header: "ステータス", key: "purchaseStatus", width: 12 },
    { header: "備考", key: "remarks", width: 30 },
    { header: "URL", key: "url", width: 50 },
    { header: "優先度", key: "priorityLevel", width: 10 },
    { header: "保護レベル", key: "protectionLevel", width: 12 },
    { header: "追加元", key: "source", width: 12 },
    { header: "手動ホール", key: "manualHallId", width: 20 },
    { header: "限数実購入数", key: "limitedPurchasedQuantity", width: 14 },
    { header: "カタログ価格", key: "catalogPrice", width: 14 },
    { header: "シート備考", key: "sheetRemarks", width: 30 },
    { header: "シート照合根拠", key: "sheetIdentityEvidence", width: 18 },
  ];

  // データ
  items.forEach((item) => {
    itemsSheet.addRow({
      id: item.id,
      circle: item.circle,
      eventDate: item.eventDate,
      block: item.block,
      number: item.number,
      title: item.title,
      price: item.price,
      quantity: item.quantity,
      purchaseStatus: item.purchaseStatus,
      remarks: item.remarks,
      url: item.url || "",
      priorityLevel: item.priorityLevel || "none",
      protectionLevel: item.protectionLevel || "",
      source: item.source || "",
      manualHallId: "",
      limitedPurchasedQuantity:
        item.purchaseStatus === "LimitedPurchase"
          ? (item.limitedPurchasedQuantity ?? "")
          : "",
      // Keep legacy fallback values, but never turn them into identity evidence.
      sheetIdentityEvidence:
        item.sheetIdentityVerified === true &&
        item.catalogPrice !== undefined &&
        item.sheetRemarks !== undefined
          ? "verified"
          : "unverified",
      catalogPrice:
        item.catalogPrice !== undefined
          ? (item.catalogPrice ?? "")
          : item.source === "spreadsheet"
            ? (item.price ?? "")
            : "",
      sheetRemarks:
        item.sheetRemarks !== undefined
          ? item.sheetRemarks
          : item.source === "spreadsheet"
            ? item.remarks
            : "",
    });
  });

  // ヘッダー行のスタイル
  itemsSheet.getRow(1).font = { bold: true };
  itemsSheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE0E0E0" },
  };

  // 2. メタデータシート
  if (options.format === "full") {
    const metaSheet = workbook.addWorksheet("メタデータ");
    metaSheet.columns = [
      { header: "キー", key: "key", width: 30 },
      { header: "値", key: "value", width: 100 },
    ];

    metaSheet.addRow({ key: "version", value: EXPORT_VERSION });
    metaSheet.addRow({ key: "exportDate", value: new Date().toISOString() });
    metaSheet.addRow({ key: "eventName", value: eventName });
    metaSheet.addRow({ key: "consistencySchemaVersion", value: 1 });
    const manifestJson = JSON.stringify(selected.manifest);
    if (manifestJson.length > 30000)
      throw new Error("出力設定の一覧がExcelのセル上限を超えています。");
    metaSheet.addRow({ key: "contentManifest", value: manifestJson });
    metaSheet.addRow({
      key: "eventMetadata",
      value: JSON.stringify(additionalData.metadata ?? null),
    });

    if (additionalData.metadata) {
      metaSheet.addRow({
        key: "spreadsheetUrl",
        value: additionalData.metadata.spreadsheetUrl || "",
      });
      metaSheet.addRow({
        key: "spreadsheetSheetName",
        value: additionalData.metadata.spreadsheetSheetName || "",
      });
      metaSheet.addRow({
        key: "lastImportDate",
        value: additionalData.metadata.lastImportDate || "",
      });
    }

    if (options.includeMapData) {
      const eventSettings = [
        [
          "mapRotationSettings",
          recordEntry(additionalData.mapRotationSettings, eventName),
        ],
        [
          "mapViewportSettings",
          recordEntry(additionalData.mapViewportSettings, eventName),
        ],
      ] as const;

      eventSettings.forEach(([key, value]) => {
        if (value === undefined) return;
        metaSheet.addRow({ key, value: JSON.stringify(value) });
      });
    }

    metaSheet.getRow(1).font = { bold: true };
  }

  // 3. 配置情報シート
  if (options.includeLayoutInfo && options.format === "full") {
    const layoutSheet = workbook.addWorksheet("配置情報");
    layoutSheet.columns = [
      { header: "タイプ", key: "type", width: 20 },
      { header: "参加日", key: "eventDate", width: 12 },
      { header: "データ", key: "data", width: 100 },
    ];

    // 実行モードアイテム
    const eventExecuteItems =
      recordEntry(additionalData.executeModeItems, eventName) || {};
    Object.entries(eventExecuteItems).forEach(([eventDate, itemIds]) => {
      layoutSheet.addRow({
        type: "executeModeItems",
        eventDate,
        data: JSON.stringify(itemIds),
      });
    });

    // 日モード
    const eventDayModes = recordEntry(additionalData.dayModes, eventName) || {};
    Object.entries(eventDayModes).forEach(([eventDate, mode]) => {
      layoutSheet.addRow({
        type: "dayModes",
        eventDate,
        data: mode,
      });
    });

    layoutSheet.getRow(1).font = { bold: true };
  }

  // 4. マップデータシート
  if (options.includeMapData && options.format === "full") {
    const eventMapData = recordEntry(additionalData.mapData, eventName) ?? {};
    {
      const mapSheet = workbook.addWorksheet("マップデータ");
      mapSheet.columns = [
        { header: "マップ名", key: "mapName", width: 20 },
        { header: "データ", key: "data", width: 200 },
      ];

      Object.entries(eventMapData).forEach(([mapName, data]) => {
        mapSheet.addRow({
          mapName,
          data: JSON.stringify(data),
        });
      });

      mapSheet.getRow(1).font = { bold: true };
    }
  }

  // 5. ルート情報シート
  if (options.includeRouteInfo && options.format === "full") {
    const routeSheet = workbook.addWorksheet("ルート情報");
    routeSheet.columns = [
      { header: "タイプ", key: "type", width: 20 },
      { header: "マップ名", key: "mapName", width: 20 },
      { header: "データ", key: "data", width: 200 },
    ];

    // ホール定義
    const eventHallDefinitions = recordEntry(
      additionalData.hallDefinitions,
      eventName,
    );
    if (eventHallDefinitions) {
      Object.entries(eventHallDefinitions).forEach(([mapName, data]) => {
        routeSheet.addRow({
          type: "hallDefinitions",
          mapName,
          data: JSON.stringify(data),
        });
      });
    }

    routeSheet.getRow(1).font = { bold: true };
  }

  if (options.format === "full") {
    const sheet = workbook.addWorksheet("関連設定");
    sheet.columns = [
      "種別",
      "日付キー",
      "文脈種別",
      "実在マップキー",
      "レコードID",
      "分割番号",
      "総分割数",
      "JSON本文",
    ].map((header) => ({ header, width: header === "JSON本文" ? 100 : 22 }));
    for (const row of encodeConsistencyRows(
      recordEntry(selected.snapshot.eventConsistency, eventName),
    ).rows)
      sheet.addRow([
        row.kind,
        row.dayKey,
        row.context,
        row.mapKey,
        row.recordId,
        row.part,
        row.totalParts,
        row.json,
      ]);
    sheet.getRow(1).font = { bold: true };
  }
  // Blobとして出力
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/**
 * xlsxファイルからデータをインポート
 */
export async function importFromXlsx(
  file: File,
  suppliedInput?: ArrayBuffer,
): Promise<EventWorkbookImportResult> {
  const result: EventWorkbookImportResult = {
    success: false,
    eventName: "",
    items: [],
    errors: [],
  };

  try {
    const arrayBuffer = suppliedInput ?? (await file.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);

    const metaSheet = workbook.getWorksheet("メタデータ");
    const metaMap = new Map<string, string>();
    if (metaSheet) {
      metaSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const key = parseTextCell(row.getCell(1).value);
        if (key === undefined)
          throw new Error(
            `メタデータ${rowNumber}行目のキーが非対応セル形式です。`,
          );
        const rawValue = row.getCell(2).value;
        // Structured JSON/manifest values must still be scalar cells.
        const value = TEXT_METADATA_KEYS.has(key)
          ? parseTextCell(rawValue)
          : rawValue === null ||
              rawValue === undefined ||
              ["string", "number", "boolean"].includes(typeof rawValue)
            ? String(rawValue ?? "")
            : undefined;
        if (value === undefined)
          throw new Error(
            `メタデータ${rowNumber}行目「${key}」が非対応セル形式です。`,
          );
        if (key && metaMap.has(key))
          throw new Error("メタデータのキーが重複しています。");
        if (key) metaMap.set(key, value);
      });
    }

    const version = metaMap.get("version");
    const isNew = version === EXPORT_VERSION;
    if (
      version !== undefined &&
      !["1.0", "2.0", "2.1", "2.2", EXPORT_VERSION].includes(version)
    )
      throw new Error("未対応のExcelバージョンです。");
    if (
      !isNew &&
      (workbook.getWorksheet("関連設定") ||
        metaMap.has("consistencySchemaVersion") ||
        metaMap.has("contentManifest"))
    )
      throw new Error("新形式の宣言とバージョンが一致しません。");
    let manifest: ContentManifest | undefined;
    if (isNew) {
      if (metaMap.get("consistencySchemaVersion") !== "1")
        throw new Error("未対応の関連設定スキーマです。");
      manifest = parseContentManifest(
        JSON.parse(metaMap.get("contentManifest") ?? "null"),
      );
      const required = [
        "アイテムデータ",
        "メタデータ",
        "関連設定",
        ...(manifest.options.includeLayoutInfo ? ["配置情報"] : []),
        ...(manifest.options.includeMapData ? ["マップデータ"] : []),
        ...(manifest.options.includeRouteInfo ? ["ルート情報"] : []),
      ];
      if (
        JSON.stringify(required) !== JSON.stringify(manifest.requiredSheets) ||
        required.some((name) => !workbook.getWorksheet(name))
      )
        throw new Error(
          `contentManifestで宣言されたシートがありません: ${manifest.requiredSheets.filter((name) => !workbook.getWorksheet(name)).join("、")}`,
        );
      for (const [name, enabled] of [
        ["配置情報", manifest.options.includeLayoutInfo],
        ["マップデータ", manifest.options.includeMapData],
        ["ルート情報", manifest.options.includeRouteInfo],
      ] as const)
        if (!enabled && workbook.getWorksheet(name))
          throw new Error("省略したシートが混在しています。");
    }
    // 1. アイテムデータシートを読み込み
    const itemsSheet = workbook.getWorksheet("アイテムデータ");
    if (!itemsSheet) {
      result.errors.push("アイテムデータシートが見つかりません");
      return result;
    }

    const itemHeaderColumns = new Map<string, number>();
    itemsSheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
      const header = parseTextCell(cell.value)?.trim();
      if (header === undefined)
        throw new Error(
          `アイテムデータの${column}列目の見出しが非対応セル形式です。`,
        );
      if (header && !itemHeaderColumns.has(header)) {
        itemHeaderColumns.set(header, column);
      }
    });
    const catalogPriceColumn = itemHeaderColumns.get("カタログ価格");
    const sheetRemarksColumn = itemHeaderColumns.get("シート備考");
    const sheetIdentityColumn = itemHeaderColumns.get("シート照合根拠");
    const hasCatalogPriceColumn = catalogPriceColumn !== undefined;
    const hasSheetRemarksColumn = sheetRemarksColumn !== undefined;
    if (hasCatalogPriceColumn !== hasSheetRemarksColumn) {
      result.errors.push(
        "アイテムデータの「カタログ価格」と「シート備考」は両方の列が必要です。ファイルが破損している可能性があります。",
      );
      return result;
    }
    const hasSheetDerivedColumns =
      hasCatalogPriceColumn && hasSheetRemarksColumn;
    if (
      !hasSheetDerivedColumns &&
      ["2.2", EXPORT_VERSION].includes(metaMap.get("version") ?? "")
    ) {
      result.errors.push(
        `バージョン${metaMap.get("version")}の完全版に「カタログ価格」または「シート備考」がありません。ファイルが破損している可能性があります。`,
      );
      return result;
    }

    const items: ShoppingItem[] = [];
    const itemFallbackWarnings: ItemFallbackWarning[] = [];
    const legacySheetFieldFallbacks: LegacySheetFieldFallback[] = [];
    const validPurchaseStatuses = new Set<string>(
      PurchaseStatuses as readonly string[],
    );

    itemsSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // ヘッダーをスキップ

      const rowReasons: string[] = [];
      const textCell = (column: number): string => {
        const text = parseTextCell(row.getCell(column).value);
        if (text !== undefined) return text;
        rowReasons.push(
          `${column}列目の非対応テキストセルを空欄で補完しました`,
        );
        return "";
      };

      const rawId = textCell(1).trim();
      const itemId = rawId || crypto.randomUUID();
      if (!rawId) {
        rowReasons.push("IDが空のため自動採番しました");
      }

      const circle = textCell(2);
      const eventDate = textCell(3);
      const block = textCell(4);
      const number = textCell(5);
      const title = textCell(6);

      const parsedPrice = parseFiniteNumberCell(row.getCell(7).value);
      let price: number | null = null;
      if (parsedPrice.kind === "value") price = parsedPrice.value;
      else if (parsedPrice.kind === "invalid") {
        rowReasons.push(
          `価格「${parsedPrice.raw}」は不正のため空値で補完しました`,
        );
      }

      const rawQuantity = row.getCell(8).value;
      const parsedQuantity = parseStrictPositiveIntegerCell(rawQuantity);
      let quantity = 1;
      if (parsedQuantity.kind === "value") {
        quantity = parsedQuantity.value;
      } else {
        const raw =
          parsedQuantity.kind === "invalid"
            ? `「${parsedQuantity.raw}」`
            : "空欄";
        rowReasons.push(`購入予定量${raw}は不正のため1で補完しました`);
      }

      if (!Number.isInteger(quantity)) {
        quantity = Math.max(1, Math.floor(quantity));
      }

      const rawPurchaseStatus = textCell(9).trim();
      const purchaseStatus: ShoppingItem["purchaseStatus"] =
        validPurchaseStatuses.has(rawPurchaseStatus)
          ? (rawPurchaseStatus as ShoppingItem["purchaseStatus"])
          : "None";
      if (rawPurchaseStatus && !validPurchaseStatuses.has(rawPurchaseStatus)) {
        rowReasons.push(
          `ステータス「${rawPurchaseStatus}」は不正のためNoneで補完しました`,
        );
      }

      const remarks = textCell(10);
      const url = textCell(11);

      // 優先度の値を取得（列12）
      const priorityValue = textCell(12).trim();
      let priorityLevel: "none" | "priority" | "highest" | undefined;
      if (priorityValue === "highest") {
        priorityLevel = "highest";
      } else if (priorityValue === "priority") {
        priorityLevel = "priority";
      } else if (priorityValue === "none" || priorityValue === "") {
        priorityLevel = undefined; // 'none'は保存しない（デフォルト値）
      } else {
        rowReasons.push(
          `優先度「${priorityValue}」は不正のため未設定で補完しました`,
        );
      }

      // 保護レベルの値を取得（列13）
      const protectionValue = textCell(13).trim();
      let protectionLevel: "full" | "deletable" | "none" | undefined;
      if (protectionValue === "full") {
        protectionLevel = "full";
      } else if (protectionValue === "deletable") {
        protectionLevel = "deletable";
      } else if (protectionValue === "none") {
        protectionLevel = "none";
      } else {
        protectionLevel = undefined; // 未設定
        if (protectionValue) {
          rowReasons.push(
            `保護レベル「${protectionValue}」は不正のため未設定で補完しました`,
          );
        }
      }

      // 追加元の値を取得（列14）
      const sourceValue = textCell(14).trim();
      let source: "spreadsheet" | "app" | undefined;
      if (sourceValue === "app") {
        source = "app";
      } else if (sourceValue === "spreadsheet") {
        source = "spreadsheet";
      } else {
        source = undefined; // 未設定
        if (sourceValue) {
          rowReasons.push(
            `追加元「${sourceValue}」は不正のため未設定で補完しました`,
          );
        }
      }

      let catalogPrice: number | null | undefined;
      let sheetRemarks: string | undefined;
      let usedLegacySheetFieldFallback = false;
      // Older exports could fill these columns from editable price/notes.
      // Missing or unknown evidence must remain unverified across JSON/XLSX.
      let sheetIdentityVerified =
        source === "spreadsheet" &&
        hasSheetDerivedColumns &&
        sheetIdentityColumn !== undefined &&
        row.getCell(sheetIdentityColumn).value === "verified";
      if (hasSheetDerivedColumns) {
        const parsedCatalogPrice = parseFiniteNumberCell(
          row.getCell(catalogPriceColumn!).value,
        );
        if (parsedCatalogPrice.kind === "value") {
          catalogPrice = parsedCatalogPrice.value;
        } else if (parsedCatalogPrice.kind === "empty") {
          if (source === "spreadsheet") {
            catalogPrice = null;
          }
        } else {
          sheetIdentityVerified = false;
          rowReasons.push(
            `カタログ価格「${parsedCatalogPrice.raw}」は不正のため空値で補完しました`,
          );
          if (source === "spreadsheet") {
            catalogPrice = null;
          }
        }

        if (parseTextCell(row.getCell(sheetRemarksColumn!).value) === undefined)
          sheetIdentityVerified = false;
        const parsedSheetRemarks = textCell(sheetRemarksColumn!);
        if (source === "spreadsheet" || parsedSheetRemarks !== "") {
          sheetRemarks = parsedSheetRemarks;
        }
      } else if (source === "spreadsheet") {
        catalogPrice = price;
        sheetRemarks = remarks;
        usedLegacySheetFieldFallback = true;
      }

      // 手動ホールIDを取得（列15、後方互換: 古いファイルは空）
      const manualHallValue = textCell(15).trim();
      const manualHallId = manualHallValue || undefined;
      const parsedLimitedPurchasedQuantity = parseStrictPositiveIntegerCell(
        row.getCell(16).value,
      );
      let limitedPurchasedQuantity: number | undefined;

      if (parsedLimitedPurchasedQuantity.kind === "value") {
        limitedPurchasedQuantity = parsedLimitedPurchasedQuantity.value;
      } else if (parsedLimitedPurchasedQuantity.kind === "invalid") {
        rowReasons.push(
          `限数実購入数「${parsedLimitedPurchasedQuantity.raw}」は不正のため未入力にしました`,
        );
      }

      if (
        purchaseStatus === "LimitedPurchase" &&
        limitedPurchasedQuantity !== undefined
      ) {
        const validation = validateLimitedPurchaseQuantities(
          limitedPurchasedQuantity,
          quantity,
        );
        if (!validation.ok) {
          rowReasons.push(
            `限数実購入数「${limitedPurchasedQuantity}」は購入予定量「${quantity}」に対して不正のため未入力にしました`,
          );
          limitedPurchasedQuantity = undefined;
        }
      }

      if (
        purchaseStatus !== "LimitedPurchase" &&
        limitedPurchasedQuantity !== undefined
      ) {
        rowReasons.push("限数以外の限数実購入数は無視しました");
        limitedPurchasedQuantity = undefined;
      }

      const item: ShoppingItem = normalizeLimitedPurchaseFields({
        id: itemId,
        circle,
        eventDate,
        block,
        number,
        title,
        price,
        ...(catalogPrice !== undefined ? { catalogPrice } : {}),
        quantity,
        purchaseStatus,
        remarks,
        ...(sheetRemarks !== undefined ? { sheetRemarks } : {}),
        ...(sheetIdentityVerified ? { sheetIdentityVerified: true } : {}),
        url,
        ...(priorityLevel !== undefined ? { priorityLevel } : {}),
        ...(protectionLevel !== undefined ? { protectionLevel } : {}),
        ...(source !== undefined ? { source } : {}),
        ...(manualHallId !== undefined ? { manualHallId } : {}),
        ...(limitedPurchasedQuantity !== undefined
          ? { limitedPurchasedQuantity }
          : {}),
      });

      if (item.circle || item.title) {
        items.push(item);
        if (usedLegacySheetFieldFallback) {
          legacySheetFieldFallbacks.push({
            itemId: item.id,
            rowNumber,
          });
        }
        if (rowReasons.length > 0) {
          itemFallbackWarnings.push({
            itemId: item.id,
            rowNumber,
            reasons: rowReasons,
          });
        }
      }
    });

    result.items = items;
    if (itemFallbackWarnings.length > 0) {
      result.itemFallbackWarnings = itemFallbackWarnings;
    }
    if (legacySheetFieldFallbacks.length > 0) {
      result.legacySheetFieldFallbacks = legacySheetFieldFallbacks;
    }

    // 2. メタデータシートを読み込み
    if (metaSheet) {
      result.eventName = metaMap.get("eventName") || "";

      if (metaMap.has("spreadsheetUrl")) {
        result.metadata = {
          spreadsheetUrl: metaMap.get("spreadsheetUrl") || "",
          spreadsheetSheetName: metaMap.get("spreadsheetSheetName") || "",
          lastImportDate: metaMap.get("lastImportDate") || "",
        };
      }

      const parseJsonMetadata = (key: string, label: string): unknown => {
        const serialized = metaMap.get(key);
        if (serialized === undefined || serialized === "") return undefined;
        try {
          return JSON.parse(serialized) as unknown;
        } catch {
          throw new Error(`${label}をJSONとして解析できません。`);
        }
      };

      try {
        const mapRotationSettings = parseJsonMetadata(
          "mapRotationSettings",
          "マップ回転設定",
        );
        if (mapRotationSettings !== undefined) {
          if (!isRecord(mapRotationSettings)) {
            throw new Error("マップ回転設定の形式が不正です。");
          }
          result.mapRotationSettings =
            mapRotationSettings as MapRotationSettingsStore[string];
        }

        const mapViewportSettings = parseJsonMetadata(
          "mapViewportSettings",
          "マップ表示位置",
        );
        if (mapViewportSettings !== undefined) {
          if (!isRecord(mapViewportSettings)) {
            throw new Error("マップ表示位置の形式が不正です。");
          }
          result.mapViewportSettings =
            mapViewportSettings as MapViewportSettingsStore[string];
        }

        const blockDetectionSettings = parseJsonMetadata(
          "blockDetectionSettings",
          "ブロック検出設定",
        );
        if (blockDetectionSettings !== undefined) {
          if (!isBlockDetectionSettings(blockDetectionSettings)) {
            throw new Error("ブロック検出設定の形式が不正です。");
          }
          result.blockDetectionSettings = blockDetectionSettings;
        }
      } catch (error) {
        result.errors.push(
          error instanceof Error
            ? error.message
            : "イベント設定の解析に失敗しました。",
        );
        return result;
      }
    }

    // イベント名がない場合はファイル名から推測
    if (!result.eventName) {
      const baseName = file.name.replace(/\.xlsx$/i, "");
      const generatedSimpleName =
        workbook.creator === WORKBOOK_CREATOR
          ? baseName.match(/^(.+)_\d{4}-\d{2}-\d{2}T\d{4}_simple$/)
          : null;
      result.eventName = generatedSimpleName?.[1] ?? baseName;
    }

    // 3. 配置情報シートを読み込み
    const layoutSheet = workbook.getWorksheet("配置情報");
    if (layoutSheet) {
      const executeModeItems: Record<string, string[]> = {};
      const dayModes: Record<string, string> = {};

      layoutSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const type = readAuxiliaryTextCell(row.getCell(1), "種別");
        const eventDate = readAuxiliaryTextCell(row.getCell(2), "参加日");
        const data = readAuxiliaryTextCell(
          row.getCell(3),
          "データ",
          type !== "dayModes",
        );

        try {
          if (type === "executeModeItems") {
            setOwnValue(executeModeItems, eventDate, JSON.parse(data));
          } else if (type === "dayModes") {
            setOwnValue(dayModes, eventDate, data);
          }
        } catch {
          result.errors.push("配置情報の解析エラー");
        }
      });

      if (
        Object.keys(executeModeItems).length > 0 ||
        Object.keys(dayModes).length > 0
      ) {
        result.layoutInfo = { executeModeItems, dayModes };
      }
    }

    // 4. マップデータシートを読み込み
    const mapSheet = workbook.getWorksheet("マップデータ");
    if (mapSheet) {
      const mapData: Record<string, unknown> = {};

      mapSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const mapName = readAuxiliaryTextCell(row.getCell(1), "マップ名");
        const data = readAuxiliaryTextCell(row.getCell(2), "データ", true);

        try {
          if (mapName && data) {
            setOwnValue(mapData, mapName, JSON.parse(data));
          }
        } catch {
          result.errors.push("マップデータの解析エラー");
        }
      });

      if (Object.keys(mapData).length > 0) {
        result.mapData = mapData;
      }
    }

    // 5. ルート情報シートを読み込み
    const routeSheet = workbook.getWorksheet("ルート情報");
    if (routeSheet) {
      const routeSettings: Record<string, unknown> = {};
      const hallDefinitions: Record<string, unknown[]> = {};
      const hallRouteSettings: Record<string, unknown> = {};

      routeSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const type = readAuxiliaryTextCell(row.getCell(1), "種別");
        const mapName = readAuxiliaryTextCell(row.getCell(2), "マップ名");
        const data = readAuxiliaryTextCell(row.getCell(3), "データ", true);

        try {
          if (type === "routeSettings" && mapName && data) {
            setOwnValue(routeSettings, mapName, JSON.parse(data));
          } else if (type === "hallDefinitions" && mapName && data) {
            setOwnValue(hallDefinitions, mapName, JSON.parse(data));
          } else if (type === "hallRouteSettings" && mapName && data) {
            setOwnValue(hallRouteSettings, mapName, JSON.parse(data));
          }
        } catch {
          result.errors.push("ルート情報の解析エラー");
        }
      });

      if (Object.keys(routeSettings).length > 0) {
        result.routeSettings = routeSettings;
      }
      if (Object.keys(hallDefinitions).length > 0) {
        result.hallDefinitions = hallDefinitions;
      }
      if (Object.keys(hallRouteSettings).length > 0) {
        result.hallRouteSettings = hallRouteSettings;
      }
    }

    if (isNew && manifest) {
      const sheet = workbook.getWorksheet("関連設定")!;
      const headers = [
        "種別",
        "日付キー",
        "文脈種別",
        "実在マップキー",
        "レコードID",
        "分割番号",
        "総分割数",
        "JSON本文",
      ];
      if (
        headers.some(
          (header, index) =>
            sheet.getRow(1).getCell(index + 1).value !== header,
        )
      )
        throw new Error("関連設定の列が不正です。");
      const rows: ConsistencyChunkRow[] = [];
      sheet.eachRow((row, index) => {
        if (index === 1) return;
        const values = Array.from(
          { length: 8 },
          (_, column) => row.getCell(column + 1).value ?? "",
        );
        if (
          ![...values.slice(0, 5), values[7]].every(
            (value) => typeof value === "string",
          ) ||
          !Number.isSafeInteger(values[5]) ||
          !Number.isSafeInteger(values[6])
        )
          throw new Error("関連設定の分割行の型が不正です。");
        rows.push({
          kind: values[0],
          dayKey: values[1],
          context: values[2],
          mapKey: values[3],
          recordId: values[4],
          part: values[5],
          totalParts: values[6],
          json: values[7],
        } as ConsistencyChunkRow);
      });
      result.eventConsistency = decodeConsistencyRows(rows, manifest);
      result.contentManifest = manifest;
      const metadata = JSON.parse(metaMap.get("eventMetadata") ?? "null");
      if (metadata !== null) result.metadata = metadata;
      else delete result.metadata;
      if (
        result.routeSettings ||
        result.hallRouteSettings ||
        result.blockDetectionSettings ||
        result.items.some((item) => item.manualHallId !== undefined)
      )
        throw new Error("新形式に旧巡回設定が重複しています。");
      const name = result.eventName;
      const one = (value: unknown) =>
        value === undefined ? {} : { [name]: value };
      const snapshot = {
        eventLists: { [name]: result.items },
        eventMetadata: one(result.metadata),
        executeModeItems: one(result.layoutInfo?.executeModeItems),
        dayModes: one(result.layoutInfo?.dayModes),
        mapData: one(result.mapData),
        mapRotationSettings: one(result.mapRotationSettings),
        mapViewportSettings: one(result.mapViewportSettings),
        hallDefinitions: one(result.hallDefinitions),
        hallRouteSettings: {},
        routeSettings: {},
        eventConsistency: { [name]: result.eventConsistency },
      } as PersistenceSnapshot;
      const errors = [
        ...validateSnapshotStructure(snapshot),
        ...validateSnapshotReferences(snapshot),
      ];
      if (errors.length) throw new Error(errors.join("\n"));
      validateWorkbookManifest(snapshot, name, manifest);
    }
    result.success = result.errors.length === 0;
  } catch (error) {
    console.error("Spreadsheet import failed (spreadsheet-import-failed).");
    result.errors.push(
      error instanceof Error
        ? error.message
        : "インポートエラー: ファイルを解析できませんでした",
    );
  }

  return result;
}
