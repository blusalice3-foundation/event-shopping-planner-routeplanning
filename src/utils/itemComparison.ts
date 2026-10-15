import { ShoppingItem } from "../types/item";
import { normalizeExecutionVisitDay } from "./visitProjection";

export function getItemKey(
  item: ShoppingItem | Omit<ShoppingItem, "id" | "purchaseStatus">,
): string {
  return JSON.stringify([
    item.circle,
    item.eventDate,
    item.block,
    item.number,
    item.title,
  ]);
}

export function getItemKeyWithoutTitle(
  item: ShoppingItem | Omit<ShoppingItem, "id" | "purchaseStatus">,
): string {
  return JSON.stringify([item.circle, item.eventDate, item.block, item.number]);
}

const locationCollator = new Intl.Collator("ja", {
  numeric: true,
  sensitivity: "base",
});

export function insertItemSorted(
  items: ShoppingItem[],
  newItem: ShoppingItem,
): ShoppingItem[] {
  const newItems = [...items];
  const day = normalizeExecutionVisitDay(newItem.eventDate);
  const locationKey = `${newItem.block}|${newItem.number}`;
  let insertIndex = items.length;
  for (let index = 0; index < items.length; index++) {
    const current = items[index];
    if (normalizeExecutionVisitDay(current.eventDate) !== day) continue;
    if (
      locationCollator.compare(
        `${current.block}|${current.number}`,
        locationKey,
      ) > 0
    ) {
      insertIndex = index;
      break;
    }
    insertIndex = index + 1;
  }
  newItems.splice(insertIndex, 0, newItem);
  return newItems;
}
