import { normalizeItemOptionalFields } from "../../utils/itemOptionalFields";
import type { BulkImportRequest } from "../../types/import";
import type {
  DayModeState,
  EventMetadata,
  ExecuteModeItems,
  ShoppingItem,
} from "../../types/item";
import { extractEventDates } from "../../utils/eventDates";
import { getItemKey } from "../../utils/itemComparison";
import { resolveBulkAddTab } from "./uiOrchestration";

export type BulkAddLayoutInfo = {
  itemKey: string;
  sourceRowId?: string;
  eventDate: string;
  columnType: "execute" | "candidate";
  order: number;
};

export type BulkAddSourceRow = {
  sourceRowId: string;
  item: Omit<ShoppingItem, "id" | "purchaseStatus">;
};
export type BulkAddMetadata = {
  sourceRows?: readonly BulkAddSourceRow[];
  request?: BulkImportRequest;
  url?: string;
  sheetName?: string;
  layoutInfo?: BulkAddLayoutInfo[];
  source?: "spreadsheet" | "app";
};

export type BulkAddUiPlan = {
  alertMessage: string;
  nextActiveEventName: string | null;
  nextActiveTab: string | null;
};

function resolveItemSource(metadata?: BulkAddMetadata): "spreadsheet" | "app" {
  return metadata?.source ?? (metadata?.url ? "spreadsheet" : "app");
}

export function hasBulkAddLayoutInfo(
  metadata?: BulkAddMetadata,
): metadata is BulkAddMetadata & { layoutInfo: BulkAddLayoutInfo[] } {
  return !!metadata?.layoutInfo && metadata.layoutInfo.length > 0;
}

export function buildBulkAddItems(
  newItemsData: Omit<ShoppingItem, "id" | "purchaseStatus">[],
  metadata?: BulkAddMetadata,
): ShoppingItem[] {
  const itemSource = resolveItemSource(metadata);
  const defaultProtectionLevel = itemSource === "app" ? "full" : "none";

  return newItemsData.map((itemData) =>
    normalizeItemOptionalFields<ShoppingItem>({
      id: crypto.randomUUID(),
      ...itemData,
      ...(itemSource === "spreadsheet"
        ? {
            catalogPrice:
              itemData.catalogPrice === undefined
                ? itemData.price
                : itemData.catalogPrice,
            sheetRemarks: itemData.sheetRemarks ?? itemData.remarks,
            sheetIdentityVerified:
              itemData.sheetIdentityVerified === true &&
              itemData.catalogPrice !== undefined &&
              itemData.sheetRemarks !== undefined
                ? true
                : undefined,
          }
        : {}),
      quantity: itemData.quantity ?? 1,
      purchaseStatus: "None",
      source: itemSource,
      protectionLevel: defaultProtectionLevel,
    }),
  );
}

export function buildLayoutAppliedEventItems(
  newItems: ShoppingItem[],
  layoutInfo: BulkAddLayoutInfo[],
  sourceRowIds?: ReadonlyMap<string, string>,
): { sortedItems: ShoppingItem[]; executeModeItems: ExecuteModeItems } {
  const itemsByKey = new Map<string, ShoppingItem[]>();
  const itemsById = new Map(newItems.map((item) => [item.id, item]));
  for (const item of newItems) {
    const key = getItemKey(item);
    const group = itemsByKey.get(key) ?? [];
    group.push(item);
    itemsByKey.set(key, group);
  }
  const used = new Set<string>();
  const resolved: Array<{
    item: ShoppingItem;
    layout: BulkAddLayoutInfo;
    index: number;
  }> = [];
  layoutInfo.forEach((layout, index) => {
    const id = layout.sourceRowId
      ? sourceRowIds?.get(layout.sourceRowId)
      : undefined;
    if (layout.sourceRowId && !id) return;
    const candidates = id
      ? [itemsById.get(id)!]
      : (itemsByKey.get(layout.itemKey) ?? []);
    if (candidates.length > 1)
      throw new Error(
        "配置と品目を一意に対応できません。元のCSVを再取込みして配置を確認してください。",
      );
    const item = candidates[0];
    if (!item) return;
    if (used.has(item.id))
      throw new Error("同じ品目に複数の配置が指定されています。");
    used.add(item.id);
    resolved.push({ item, layout, index });
  });
  const byDay = new Map<string, ShoppingItem[]>();
  const execute = new Map<string, string[]>();
  const append = (item: ShoppingItem) => {
    const group = byDay.get(item.eventDate) ?? [];
    group.push(item);
    byDay.set(item.eventDate, group);
  };
  resolved.sort(
    (a, b) =>
      (a.layout.columnType === b.layout.columnType
        ? 0
        : a.layout.columnType === "execute"
          ? -1
          : 1) ||
      a.layout.order - b.layout.order ||
      a.index - b.index,
  );
  for (const { item, layout } of resolved) {
    append(item);
    if (layout.columnType === "execute") {
      const ids = execute.get(item.eventDate) ?? [];
      ids.push(item.id);
      execute.set(item.eventDate, ids);
    }
  }
  for (const item of newItems) if (!used.has(item.id)) append(item);
  const sortedItems: ShoppingItem[] = [];
  for (const group of byDay.values())
    for (const item of group) sortedItems.push(item);
  if (
    sortedItems.length !== newItems.length ||
    new Set(sortedItems.map((item) => item.id)).size !== newItems.length
  )
    throw new Error("取込品目のIDまたは配置が重複しています。");
  return {
    sortedItems,
    executeModeItems: Object.fromEntries(
      [...byDay.keys()].map((day) => [day, execute.get(day) ?? []]),
    ),
  };
}

export function buildBulkAddEventMetadata(
  metadata?: BulkAddMetadata,
): EventMetadata | null {
  if (!metadata?.url) return null;

  return {
    spreadsheetUrl: metadata.url,
    spreadsheetSheetName: metadata.sheetName || "",
    lastImportDate: new Date().toISOString(),
  };
}

export function buildInitialDayModesForBulkAdd(
  newItems: ShoppingItem[],
): DayModeState {
  const newEventDates = extractEventDates(newItems);
  const initialDayModes: DayModeState = {};

  newEventDates.forEach((date) => {
    initialDayModes[date] = "edit";
  });

  return initialDayModes;
}

export function buildInitialExecuteItemsForBulkAdd(
  newItems: ShoppingItem[],
): ExecuteModeItems {
  const newEventDates = extractEventDates(newItems);
  const initialExecuteItems: ExecuteModeItems = {};

  newEventDates.forEach((date) => {
    initialExecuteItems[date] = [];
  });

  return initialExecuteItems;
}

export function buildBulkAddUiPlan(
  eventName: string,
  newItems: ShoppingItem[],
  isNewEvent: boolean,
  existingEventItems: ShoppingItem[],
): BulkAddUiPlan {
  const nextActiveTab =
    newItems.length > 0
      ? resolveBulkAddTab(newItems, existingEventItems)
      : null;

  return {
    alertMessage: isNewEvent
      ? `${newItems.length} items imported into a new event.`
      : `${newItems.length} items added.`,
    nextActiveEventName: isNewEvent ? eventName : null,
    nextActiveTab,
  };
}
