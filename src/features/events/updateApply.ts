import { normalizeItemOptionalFields } from "../../utils/itemOptionalFields";
import { recordEntry } from "../../utils/ownRecord";
import type { SheetIdentityChoices } from "./sheetMatching";
import type { ExecuteModeItems, ShoppingItem } from "../../types/item";
import { insertItemSorted } from "../../utils/itemComparison";
import type { EventUpdateDiff } from "./updateDiff";

type EventUpdatePayload = Pick<
  EventUpdateDiff,
  "itemsToDelete" | "itemsToUpdate" | "itemsToAdd"
> &
  Partial<
    Pick<
      EventUpdateDiff,
      "pendingPurchasedQuantityChanges" | "unresolvedMatches"
    >
  >;

export type EventUpdateApplyOptions = {
  acceptCsvExclusions?: boolean;
  identityChoices?: SheetIdentityChoices;
  applyPurchasedQuantityChanges?: boolean;
};

function getEffectiveProtectionLevel(
  item: ShoppingItem,
): "full" | "deletable" | "none" {
  if (item.protectionLevel) return item.protectionLevel;
  return item.source === "app" ? "full" : "none";
}

function createSpreadsheetItem(
  itemData: EventUpdatePayload["itemsToAdd"][number],
): ShoppingItem {
  return normalizeItemOptionalFields({
    id: crypto.randomUUID(),
    circle: itemData.circle,
    eventDate: itemData.eventDate,
    block: itemData.block,
    number: itemData.number,
    title: itemData.title,
    price: itemData.price,
    quantity: itemData.quantity ?? 1,
    remarks: itemData.remarks,
    sheetIdentityFingerprint: itemData.sheetIdentityFingerprint,
    purchaseStatus: "None",
    source: "spreadsheet",
    protectionLevel: "none",
    url: itemData.url,
  });
}

export function applyEventUpdateToItems(
  currentItems: ShoppingItem[],
  updateData: EventUpdatePayload,
  options: EventUpdateApplyOptions = {},
): ShoppingItem[] {
  if (updateData.unresolvedMatches?.length)
    throw new Error("品目の対応関係をすべて確認してください。");

  const deleteIds = new Set(updateData.itemsToDelete.map((item) => item.id));
  const updateMap = new Map(
    updateData.itemsToUpdate.map((item) => [item.id, item]),
  );
  const pendingQuantityMap = options.applyPurchasedQuantityChanges
    ? new Map(
        (updateData.pendingPurchasedQuantityChanges ?? []).map((change) => [
          change.itemId,
          change,
        ]),
      )
    : new Map();

  let updatedItems = currentItems.filter(
    (item) =>
      !deleteIds.has(item.id) || getEffectiveProtectionLevel(item) === "full",
  );
  updatedItems = updatedItems.map((item) => {
    const sourceUpdate = updateMap.get(item.id);
    const pendingQuantity = pendingQuantityMap.get(item.id);
    const limitedActualQuantity = item.limitedPurchasedQuantity;
    const isCompatibleLimitedQuantity =
      item.purchaseStatus !== "LimitedPurchase" ||
      limitedActualQuantity === undefined ||
      (Number.isInteger(limitedActualQuantity) &&
        limitedActualQuantity >= 1 &&
        limitedActualQuantity < (pendingQuantity?.nextQuantity ?? 0));
    let nextItem = item;

    if (sourceUpdate && getEffectiveProtectionLevel(item) === "none") {
      // シート同期で変更できる項目だけを明示する。
      // 価格・備考はシート値を反映し、購入状態・実購入数などは元の値を使う。
      nextItem = {
        ...item,
        title: sourceUpdate.title,
        quantity: sourceUpdate.quantity,
        price: sourceUpdate.price,
        remarks: sourceUpdate.remarks,
        sheetIdentityFingerprint: sourceUpdate.sheetIdentityFingerprint,
        url: sourceUpdate.url,
      };
    }

    if (
      pendingQuantity &&
      getEffectiveProtectionLevel(item) === "none" &&
      item.purchaseStatus === pendingQuantity.purchaseStatus &&
      item.quantity === pendingQuantity.currentQuantity &&
      Number.isInteger(pendingQuantity.nextQuantity) &&
      pendingQuantity.nextQuantity >= 1 &&
      pendingQuantity.nextQuantity <= 20 &&
      isCompatibleLimitedQuantity
    ) {
      nextItem = {
        ...nextItem,
        quantity: pendingQuantity.nextQuantity,
      };
    }

    return nextItem === item ? item : normalizeItemOptionalFields(nextItem);
  });

  updateData.itemsToAdd.forEach((itemData) => {
    const newItem = createSpreadsheetItem(itemData);
    updatedItems = insertItemSorted(updatedItems, newItem);
  });

  return updatedItems;
}

export function removeDeletedIdsFromExecuteModeItems(
  executeModeItems: ExecuteModeItems,
  deleteIds: Set<string>,
): ExecuteModeItems {
  const updatedEventItems: ExecuteModeItems = {};

  Object.keys(executeModeItems).forEach((eventDate) => {
    updatedEventItems[eventDate] = recordEntry(
      executeModeItems,
      eventDate,
    ).filter((id) => !deleteIds.has(id));
  });

  return updatedEventItems;
}
