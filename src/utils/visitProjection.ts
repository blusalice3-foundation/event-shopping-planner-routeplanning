import type { ShoppingItem } from "../types/item";
import { getSpaceKey } from "./spaceGrouping";

export const EXECUTION_VISIT_MERGE_NOTICE =
  "同じ訪問先の商品として追加しました。訪問順は変更していません。";

export interface ProjectedVisit {
  key: string;
  firstIndex: number;
  items: ShoppingItem[];
  itemIds: string[];
}

export const normalizeExecutionVisitDay = (value: string): string =>
  value.replace(/\u3000/g, " ").trim();

export function findExecutionDayBucketKey(
  dayNames: readonly string[],
  eventDate: string,
): string | undefined {
  const normalizedEventDate = normalizeExecutionVisitDay(eventDate);
  return dayNames.find(
    (dayName) => normalizeExecutionVisitDay(dayName) === normalizedEventDate,
  );
}

/** Shared execution identity: date + SpaceIdentity + priority. */
const buildExecutionVisitParts = (item: ShoppingItem): string[] => [
  normalizeExecutionVisitDay(item.eventDate),
  getSpaceKey(item.block, item.number),
  item.priorityLevel || "none",
];

export function buildExecutionVisitProjectionKey(item: ShoppingItem): string {
  return JSON.stringify(buildExecutionVisitParts(item));
}

/** Phase identity: phase + the shared execution identity. */
export function buildPhaseVisitProjectionKey(
  item: ShoppingItem,
  phase: string,
): string {
  return JSON.stringify([phase, ...buildExecutionVisitParts(item)]);
}

/**
 * Groups repeated visits into their first position without sorting the source.
 * Member item order remains the same as the source order.
 */
export function projectItemsToExecutionVisits(
  items: readonly ShoppingItem[],
): ProjectedVisit[] {
  const visits: ProjectedVisit[] = [];
  const visitsByKey = new Map<string, ProjectedVisit>();

  items.forEach((item, index) => {
    const key = buildExecutionVisitProjectionKey(item);
    const existing = visitsByKey.get(key);
    if (existing) {
      existing.items.push(item);
      existing.itemIds.push(item.id);
      return;
    }

    const visit: ProjectedVisit = {
      key,
      firstIndex: index,
      items: [item],
      itemIds: [item.id],
    };
    visitsByKey.set(key, visit);
    visits.push(visit);
  });

  return visits;
}

export function flattenExecutionVisitProjection(
  items: readonly ShoppingItem[],
): ShoppingItem[] {
  return projectItemsToExecutionVisits(items).flatMap((visit) => visit.items);
}

export function selectExecutionVisitRepresentatives(
  items: readonly ShoppingItem[],
): ShoppingItem[] {
  return projectItemsToExecutionVisits(items).map((visit) => visit.items[0]);
}

/**
 * Removes one member without giving away the Execution visit's base slot.
 * Only a departing first member promotes the first survivor; unrelated raw
 * order remains untouched.
 */
export function removeExecutionVisitMemberPreservingBasePosition(
  itemIds: readonly string[],
  removedItem: ShoppingItem,
  allItems: readonly ShoppingItem[],
): string[] {
  if (!itemIds.includes(removedItem.id)) return [...itemIds];

  const itemsById = new Map(allItems.map((item) => [item.id, item]));
  const removedVisitKey = buildExecutionVisitProjectionKey(removedItem);
  const visitMemberIds = itemIds.filter((itemId) => {
    if (itemId === removedItem.id) return true;
    const item = itemsById.get(itemId);
    return (
      item !== undefined &&
      buildExecutionVisitProjectionKey(item) === removedVisitKey
    );
  });
  const isFirstMember = visitMemberIds[0] === removedItem.id;
  const promotedItemId = visitMemberIds.find(
    (itemId) => itemId !== removedItem.id,
  );

  if (!isFirstMember || !promotedItemId) {
    return itemIds.filter((itemId) => itemId !== removedItem.id);
  }

  const nextItemIds: string[] = [];
  itemIds.forEach((itemId) => {
    if (itemId === removedItem.id) {
      nextItemIds.push(promotedItemId);
      return;
    }
    if (itemId !== promotedItemId) nextItemIds.push(itemId);
  });
  return nextItemIds;
}

/** Unknown IDs keep their exact indexes because they have no safe identity. */
function projectVisitItemIds(
  itemIds: readonly string[],
  allItems: readonly ShoppingItem[],
): string[] {
  const itemsById = new Map<string, ShoppingItem>();
  allItems.forEach((item) => {
    if (!itemsById.has(item.id)) itemsById.set(item.id, item);
  });

  const knownItems = itemIds
    .map((itemId) => itemsById.get(itemId))
    .filter((item): item is ShoppingItem => item !== undefined);
  const projectedKnownIds = projectItemsToExecutionVisits(knownItems).flatMap(
    (visit) => visit.itemIds,
  );
  let projectedIndex = 0;
  return itemIds.map((itemId) => {
    if (!itemsById.has(itemId)) return itemId;
    return projectedKnownIds[projectedIndex++] ?? itemId;
  });
}

/** Builds a view-only projection. It must not be persisted implicitly. */
export function projectExecutionVisitItemIdsForView(
  itemIds: readonly string[],
  allItems: readonly ShoppingItem[],
): string[] {
  return projectVisitItemIds(itemIds, allItems);
}

/** Only for an explicit user-authorized reorder that is already persisted. */
export function coalesceExecutionVisitItemIdsForExplicitReorder(
  itemIds: readonly string[],
  allItems: readonly ShoppingItem[],
): string[] {
  return projectVisitItemIds(itemIds, allItems);
}
