import { normalizeItemOptionalFields } from "../../utils/itemOptionalFields";
import { getExactImportItemKey } from "./duplicateEvent";
import type {
  SheetImportDiagnostics,
  SheetRowExclusionSummary,
} from "./sheetRowSelection";
import type { PurchaseStatus, ShoppingItem } from "../../types/item";
import {
  matchSheetItems,
  type SheetMatchChoice,
  type SheetIdentityChoices,
} from "./sheetMatching";
import {
  decideSheetQuantity,
  type QuantitySyncDecision,
  type SheetQuantityInput,
} from "./quantitySync";

export type SheetItem = Pick<
  ShoppingItem,
  | "circle"
  | "eventDate"
  | "block"
  | "number"
  | "title"
  | "price"
  | "quantity"
  | "remarks"
> &
  Partial<Pick<ShoppingItem, "sheetIdentityFingerprint" | "url">> & {
    /**
     * CSV に記載された数量。空欄・不正値を差分作成時まで失わないために保持する。
     * 既存の呼び出し元は quantity だけを渡してもよい。
     */
    rawQuantity?: string;
  };

export type SpreadsheetItemToAdd = Omit<ShoppingItem, "id" | "purchaseStatus">;

export type QuantitySyncWarning = {
  kind: "existing-quantity-not-updated" | "new-item-skipped";
  reason: Extract<QuantitySyncDecision, { kind: "invalid" }>["reason"];
  receivedValue: string;
  circle: string;
  eventDate: string;
  block: string;
  number: string;
  title: string;
};

export type PendingPurchasedQuantityChange = {
  itemId: string;
  circle: string;
  eventDate: string;
  block: string;
  number: string;
  title: string;
  purchaseStatus: Extract<PurchaseStatus, "Purchased" | "LimitedPurchase">;
  currentQuantity: number;
  nextQuantity: number;
};

export type LimitedPurchaseQuantityConflict = {
  itemId: string;
  circle: string;
  eventDate: string;
  block: string;
  number: string;
  title: string;
  currentQuantity: number;
  nextQuantity: number;
  actualPurchasedQuantity: number;
};

export type EventUpdateDiff = {
  sheetImport?: SheetImportDiagnostics;
  /** Incoming rows suppressed only because they would add a complete duplicate. */
  duplicateItemCount?: number;
  csvReview?: { warnings: string[]; itemCount: number };
  matching?: {
    currentItems: ShoppingItem[];
    sheetItems: SheetItem[];
    proposals: SheetMatchChoice[];
  };
  unresolvedMatches?: SheetMatchChoice[];
  itemsToDelete: ShoppingItem[];
  itemsToUpdate: ShoppingItem[];
  itemsToAdd: SpreadsheetItemToAdd[];
  protectedFromDelete: number;
  protectedFromUpdate: number;
  quantityWarnings: QuantitySyncWarning[];
  pendingPurchasedQuantityChanges: PendingPurchasedQuantityChange[];
  limitedPurchaseQuantityConflicts: LimitedPurchaseQuantityConflict[];
};

function getEffectiveProtectionLevel(
  item: ShoppingItem,
): "full" | "deletable" | "none" {
  if (item.protectionLevel) return item.protectionLevel;
  return item.source === "app" ? "full" : "none";
}

function isPurchasedStatus(
  status: PurchaseStatus,
): status is Extract<PurchaseStatus, "Purchased" | "LimitedPurchase"> {
  return status === "Purchased" || status === "LimitedPurchase";
}

function getSheetQuantityInput(item: SheetItem): SheetQuantityInput {
  return item.rawQuantity === undefined ? item.quantity : item.rawQuantity;
}

function toQuantityWarning(
  item: SheetItem,
  decision: Extract<QuantitySyncDecision, { kind: "invalid" }>,
  kind: QuantitySyncWarning["kind"],
): QuantitySyncWarning {
  return {
    kind,
    reason: decision.reason,
    receivedValue: decision.displayValue,
    circle: item.circle,
    eventDate: item.eventDate,
    block: item.block,
    number: item.number,
    title: item.title,
  };
}

function toItemToAdd(item: SheetItem, quantity: number): SpreadsheetItemToAdd {
  return normalizeItemOptionalFields({
    circle: item.circle,
    eventDate: item.eventDate,
    block: item.block,
    number: item.number,
    title: item.title,
    price: item.price,
    quantity,
    remarks: item.remarks,
    sheetIdentityFingerprint: item.sheetIdentityFingerprint,
    url: item.url,
  });
}

function sourceManagedFieldsChanged(
  current: ShoppingItem,
  next: ShoppingItem,
): boolean {
  return (
    current.title !== next.title ||
    current.price !== next.price ||
    current.remarks !== next.remarks ||
    current.sheetIdentityFingerprint !== next.sheetIdentityFingerprint ||
    current.url !== next.url
  );
}

export function normalizeSheetItemsUrls(sheetItems: SheetItem[]): SheetItem[] {
  const normalized = sheetItems.map((item) => ({ ...item }));
  const eventDateGroups = new Map<string, SheetItem[]>();

  normalized.forEach((item) => {
    if (!eventDateGroups.has(item.eventDate)) {
      eventDateGroups.set(item.eventDate, []);
    }
    eventDateGroups.get(item.eventDate)!.push(item);
  });

  eventDateGroups.forEach((items) => {
    const circleGroups = new Map<string, SheetItem[]>();
    items.forEach((item) => {
      if (!circleGroups.has(item.circle)) {
        circleGroups.set(item.circle, []);
      }
      circleGroups.get(item.circle)!.push(item);
    });

    circleGroups.forEach((circleItems) => {
      if (circleItems.length < 2) return;
      const itemWithUrl = circleItems.find(
        (item) => item.url && item.url.trim() !== "",
      );
      if (!itemWithUrl?.url) return;

      circleItems.forEach((item) => {
        if (!item.url || item.url.trim() === "") {
          item.url = itemWithUrl.url;
        }
      });
    });
  });

  return normalized.map(normalizeItemOptionalFields);
}

export function createEventUpdateDiff(
  currentItems: ShoppingItem[],
  sheetItems: SheetItem[],
  identityChoices: SheetIdentityChoices = {},
  rowExclusions?: SheetRowExclusionSummary,
): EventUpdateDiff {
  // Use evaluated CSV quantities only for the duplicate key. In particular, blank
  // quantities compare as new-import quantity 1 while matched items preserve theirs.
  const newQuantityDecisions = sheetItems.map((item) =>
    decideSheetQuantity(getSheetQuantityInput(item), "new"),
  );
  const duplicateKeys = sheetItems.map((item, row) => {
    const decision = newQuantityDecisions[row];
    return decision.kind === "apply"
      ? getExactImportItemKey({ ...item, quantity: decision.quantity })
      : undefined;
  });
  const matching = matchSheetItems(currentItems, sheetItems, identityChoices);
  const seenKeys = new Set<string>();
  for (const row of matching.matches.keys()) {
    const key = duplicateKeys[row];
    if (key !== undefined) seenKeys.add(key);
  }

  const itemsToDelete: ShoppingItem[] = [];
  const itemsToUpdate: ShoppingItem[] = [];
  const itemsToAdd: SpreadsheetItemToAdd[] = [];
  const quantityWarnings: QuantitySyncWarning[] = [];
  const pendingPurchasedQuantityChanges: PendingPurchasedQuantityChange[] = [];
  const limitedPurchaseQuantityConflicts: LimitedPurchaseQuantityConflict[] =
    [];
  let duplicateItemCount = 0;
  let protectedFromDelete = 0;
  let protectedFromUpdate = 0;

  currentItems.forEach((item) => {
    if (!matching.used.has(item.id)) {
      const protectionLevel = getEffectiveProtectionLevel(item);
      if (protectionLevel !== "full") {
        itemsToDelete.push(item);
      } else {
        protectedFromDelete++;
      }
    }
  });

  sheetItems.forEach((sheetItem, row) => {
    const existing = matching.matches.get(row);

    if (!existing) {
      const quantityDecision = newQuantityDecisions[row];
      if (quantityDecision.kind === "invalid") {
        quantityWarnings.push(
          toQuantityWarning(sheetItem, quantityDecision, "new-item-skipped"),
        );
        return;
      }

      const duplicateKey = duplicateKeys[row];
      if (duplicateKey !== undefined) {
        if (seenKeys.has(duplicateKey)) {
          duplicateItemCount++;
          return;
        }
        seenKeys.add(duplicateKey);
      }
      const quantity =
        quantityDecision.kind === "apply" ? quantityDecision.quantity : 1;
      itemsToAdd.push(toItemToAdd(sheetItem, quantity));
      return;
    }

    const quantityDecision = decideSheetQuantity(
      getSheetQuantityInput(sheetItem),
      "existing",
    );
    if (quantityDecision.kind === "invalid") {
      quantityWarnings.push(
        toQuantityWarning(
          sheetItem,
          quantityDecision,
          "existing-quantity-not-updated",
        ),
      );
    }

    const nextItem: ShoppingItem = normalizeItemOptionalFields({
      ...existing,
      title: sheetItem.title,
      price: sheetItem.price,
      remarks: sheetItem.remarks,
      sheetIdentityFingerprint: sheetItem.sheetIdentityFingerprint,
      url: sheetItem.url,
    });
    const nextSheetQuantity =
      quantityDecision.kind === "apply" ? quantityDecision.quantity : undefined;
    const hasQuantityChange =
      nextSheetQuantity !== undefined &&
      nextSheetQuantity !== existing.quantity;
    const protectionLevel = getEffectiveProtectionLevel(existing);
    const hasSourceManagedChange = sourceManagedFieldsChanged(
      existing,
      nextItem,
    );

    if (protectionLevel !== "none") {
      if (hasSourceManagedChange || hasQuantityChange) {
        protectedFromUpdate++;
      }
      return;
    }

    if (hasQuantityChange && isPurchasedStatus(existing.purchaseStatus)) {
      const actualPurchasedQuantity = existing.limitedPurchasedQuantity;
      if (
        existing.purchaseStatus === "LimitedPurchase" &&
        typeof actualPurchasedQuantity === "number" &&
        Number.isInteger(actualPurchasedQuantity) &&
        actualPurchasedQuantity >= 1 &&
        nextSheetQuantity <= actualPurchasedQuantity
      ) {
        limitedPurchaseQuantityConflicts.push({
          itemId: existing.id,
          circle: existing.circle,
          eventDate: existing.eventDate,
          block: existing.block,
          number: existing.number,
          title: nextItem.title,
          currentQuantity: existing.quantity,
          nextQuantity: nextSheetQuantity,
          actualPurchasedQuantity,
        });
      } else {
        pendingPurchasedQuantityChanges.push({
          itemId: existing.id,
          circle: existing.circle,
          eventDate: existing.eventDate,
          block: existing.block,
          number: existing.number,
          title: nextItem.title,
          purchaseStatus: existing.purchaseStatus,
          currentQuantity: existing.quantity,
          nextQuantity: nextSheetQuantity,
        });
      }
    } else if (hasQuantityChange) {
      nextItem.quantity = nextSheetQuantity;
    }

    if (hasSourceManagedChange || nextItem.quantity !== existing.quantity) {
      itemsToUpdate.push(nextItem);
    }
  });

  return {
    ...(rowExclusions
      ? {
          sheetImport: {
            acceptedCount:
              sheetItems.length -
              quantityWarnings.filter(
                (warning) => warning.kind === "new-item-skipped",
              ).length -
              duplicateItemCount,
            rowExclusions,
          },
        }
      : {}),
    ...(matching.proposals.length
      ? {
          matching: { currentItems, sheetItems, proposals: matching.proposals },
        }
      : {}),
    duplicateItemCount,
    unresolvedMatches: matching.unresolved,
    itemsToDelete,
    itemsToUpdate,
    itemsToAdd,
    protectedFromDelete,
    protectedFromUpdate,
    quantityWarnings,
    pendingPurchasedQuantityChanges,
    limitedPurchaseQuantityConflicts,
  };
}
