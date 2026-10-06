import type {
  DayMapData,
  HallDefinition,
  HallRouteSettings,
} from "../../../types/map";
import type { ExecuteModeItems, ShoppingItem } from "../../../types/item";
import { getSpaceKey } from "../../../utils/spaceGrouping";
import {
  buildExecutionVisitProjectionKey,
  findExecutionDayBucketKey,
  normalizeExecutionVisitDay,
  projectItemsToExecutionVisits,
  removeExecutionVisitMemberPreservingBasePosition,
} from "../../../utils/visitProjection";
import { findItemHallId } from "./geometry";

export type ExecuteInsertPlacement =
  | "positioned"
  | "hall-order"
  | "merged-into-existing-visit"
  | "mixed";

export type ExecuteInsertedItemIds = string[] & {
  readonly placement?: ExecuteInsertPlacement;
  readonly mergedIntoVisitItemIds?: readonly string[];
};

function attachInsertMetadata(
  itemIds: string[],
  placement: ExecuteInsertPlacement,
  mergedIntoVisitItemIds: readonly string[],
): ExecuteInsertedItemIds {
  const result = itemIds as ExecuteInsertedItemIds;
  Object.defineProperties(result, {
    placement: { value: placement, enumerable: false },
    mergedIntoVisitItemIds: {
      value: [...mergedIntoVisitItemIds],
      enumerable: false,
    },
  });
  return result;
}

export interface MapExecuteInsertResult {
  accepted: boolean;
  executeModeItems: ExecuteModeItems;
  insertedItemIds: ExecuteInsertedItemIds;
  /** Additive metadata for callers that want to notify about automatic merge. */
  placement?: ExecuteInsertPlacement;
  mergedIntoVisitItemIds?: string[];
}

export interface ExecutePositionInsertResult {
  accepted: boolean;
  executeModeItems: ExecuteModeItems;
  insertedItemIds: ExecuteInsertedItemIds;
  /** Additive metadata; existing consumers may continue using insertedItemIds. */
  placement?: ExecuteInsertPlacement;
  mergedIntoVisitItemIds?: string[];
}

export interface ExecuteIdentityRepositionResult {
  executeModeItems: ExecuteModeItems;
  placement?: ExecuteInsertPlacement;
  mergedIntoVisitItemIds?: string[];
}

export interface MapExecuteRemovalResult {
  executeModeItems: ExecuteModeItems;
  removedItemIds: string[];
}

export function expandSameSpacePriorityItemIds(
  itemIds: string[],
  allItems: ShoppingItem[],
  options: {
    dayName?: string;
    excludedIds?: Set<string>;
    sourceIds?: Set<string>;
    excludeSeedIdsFromSiblingExpansion?: boolean;
  } = {},
): string[] {
  const normalizedDayName = options.dayName
    ? normalizeExecutionVisitDay(options.dayName)
    : null;
  const seedIdsSet = new Set(itemIds);
  const expandedIds: string[] = [];
  const expandedIdsSet = new Set<string>();
  const itemsById = new Map<string, ShoppingItem>();
  for (const item of allItems) {
    // Array.findと同じく、重複IDがあっても先頭を優先する。
    if (!itemsById.has(item.id)) itemsById.set(item.id, item);
  }
  const expandedGroupKeys = new Set<string>();

  for (const itemId of itemIds) {
    const item = itemsById.get(itemId);
    if (!item) continue;
    if (
      normalizedDayName &&
      normalizeExecutionVisitDay(item.eventDate) !== normalizedDayName
    )
      continue;

    const addIfAvailable = (id: string) => {
      if (options.excludedIds?.has(id) || expandedIdsSet.has(id)) return;
      if (options.sourceIds && !options.sourceIds.has(id)) return;
      expandedIds.push(id);
      expandedIdsSet.add(id);
    };

    addIfAvailable(item.id);

    const spaceKey = getSpaceKey(item.block, item.number);
    const priorityLevel = item.priorityLevel || "none";
    const groupKey = buildExecutionVisitProjectionKey(item);
    if (expandedGroupKeys.has(groupKey)) continue;
    expandedGroupKeys.add(groupKey);

    for (const sibling of allItems) {
      if (
        options.excludeSeedIdsFromSiblingExpansion &&
        seedIdsSet.has(sibling.id)
      )
        continue;
      if (
        normalizedDayName &&
        normalizeExecutionVisitDay(sibling.eventDate) !== normalizedDayName
      )
        continue;
      if (
        normalizeExecutionVisitDay(sibling.eventDate) !==
        normalizeExecutionVisitDay(item.eventDate)
      )
        continue;
      if (getSpaceKey(sibling.block, sibling.number) !== spaceKey) continue;
      if ((sibling.priorityLevel || "none") !== priorityLevel) continue;
      addIfAvailable(sibling.id);
    }
  }

  return expandedIds;
}

export function expandMapExecuteInsertItemIds(
  itemIds: string[],
  dayName: string,
  allItems: ShoppingItem[],
  executeModeItems: ExecuteModeItems,
): string[] {
  return expandSameSpacePriorityItemIds(itemIds, allItems, {
    dayName,
    excludedIds: new Set(executeModeItems[dayName] || []),
    excludeSeedIdsFromSiblingExpansion: true,
  });
}

export function expandExecuteRemovalItemIds(
  itemIds: string[],
  dayName: string,
  allItems: ShoppingItem[],
  executeModeItems: ExecuteModeItems,
): string[] {
  return expandSameSpacePriorityItemIds(itemIds, allItems, {
    dayName,
    sourceIds: new Set(executeModeItems[dayName] || []),
  });
}

interface InsertVisitGroup {
  key: string | null;
  itemIds: string[];
}

function groupInsertItemIdsByVisit(
  itemIds: readonly string[],
  itemsMap: Map<string, ShoppingItem>,
): InsertVisitGroup[] {
  const knownItems = itemIds
    .map((itemId) => itemsMap.get(itemId))
    .filter((item): item is ShoppingItem => item !== undefined);
  const knownGroups = projectItemsToExecutionVisits(knownItems);
  const groupByItemId = new Map<string, InsertVisitGroup>();
  knownGroups.forEach((visit) => {
    const group = { key: visit.key, itemIds: [...visit.itemIds] };
    visit.itemIds.forEach((itemId) => groupByItemId.set(itemId, group));
  });

  const result: InsertVisitGroup[] = [];
  const seenGroups = new Set<InsertVisitGroup>();
  itemIds.forEach((itemId) => {
    const knownGroup = groupByItemId.get(itemId);
    if (!knownGroup) {
      result.push({ key: null, itemIds: [itemId] });
      return;
    }
    if (seenGroups.has(knownGroup)) return;
    seenGroups.add(knownGroup);
    result.push(knownGroup);
  });
  return result;
}

function findFirstItemIdForVisit(
  itemIds: readonly string[],
  visitKey: string,
  itemsMap: Map<string, ShoppingItem>,
): string | null {
  for (const itemId of itemIds) {
    const item = itemsMap.get(itemId);
    if (item && buildExecutionVisitProjectionKey(item) === visitKey)
      return itemId;
  }
  return null;
}

function findLastIndexForVisit(
  itemIds: readonly string[],
  visitKey: string,
  itemsMap: Map<string, ShoppingItem>,
): number {
  for (let index = itemIds.length - 1; index >= 0; index--) {
    const item = itemsMap.get(itemIds[index]);
    if (item && buildExecutionVisitProjectionKey(item) === visitKey)
      return index;
  }
  return -1;
}

/**
 * Keeps an existing destination visit at its current position when an edited
 * execute item changes identity and joins it. A date change transfers the ID
 * to the edited date, appending only when no destination visit exists.
 */
export function repositionExecuteItemAfterIdentityChangeWithResult(
  executeModeItems: ExecuteModeItems,
  previousItem: ShoppingItem,
  updatedItem: ShoppingItem,
  updatedAllItems: readonly ShoppingItem[],
): ExecuteIdentityRepositionResult {
  const previousKey = buildExecutionVisitProjectionKey(previousItem);
  const updatedKey = buildExecutionVisitProjectionKey(updatedItem);
  if (previousKey === updatedKey) return { executeModeItems };

  const sourceDays = Object.keys(executeModeItems).filter((dayName) =>
    (executeModeItems[dayName] || []).includes(updatedItem.id),
  );
  if (sourceDays.length === 0) return { executeModeItems };

  const itemsMap = new Map(updatedAllItems.map((item) => [item.id, item]));
  itemsMap.set(updatedItem.id, updatedItem);
  const normalizedPreviousDay = normalizeExecutionVisitDay(
    previousItem.eventDate,
  );
  const normalizedDestinationDay = normalizeExecutionVisitDay(
    updatedItem.eventDate,
  );
  const dateChanged = normalizedPreviousDay !== normalizedDestinationDay;
  const destinationDay = dateChanged
    ? (findExecutionDayBucketKey(
        Object.keys(executeModeItems),
        updatedItem.eventDate,
      ) ?? normalizedDestinationDay)
    : (sourceDays.find(
        (dayName) =>
          normalizeExecutionVisitDay(dayName) === normalizedPreviousDay,
      ) ?? sourceDays[0]);

  const nextExecuteModeItems: ExecuteModeItems = { ...executeModeItems };
  let departedFirstSourceMember = false;
  let sourceVisitSurvives = false;
  sourceDays.forEach((dayName) => {
    const sourceIds = executeModeItems[dayName] || [];
    const sourceVisitMemberIds = sourceIds.filter((itemId) => {
      if (itemId === updatedItem.id) return true;
      const item = itemsMap.get(itemId);
      return (
        item !== undefined &&
        buildExecutionVisitProjectionKey(item) === previousKey
      );
    });
    if (
      normalizeExecutionVisitDay(dayName) === normalizedPreviousDay ||
      sourceDays.length === 1
    ) {
      departedFirstSourceMember = sourceVisitMemberIds[0] === updatedItem.id;
      sourceVisitSurvives = sourceVisitMemberIds.some(
        (itemId) => itemId !== updatedItem.id,
      );
    }
    nextExecuteModeItems[dayName] =
      removeExecutionVisitMemberPreservingBasePosition(
        sourceIds,
        previousItem,
        updatedAllItems,
      );
  });

  const nextDestinationIds = [
    ...(nextExecuteModeItems[destinationDay] || []),
  ].filter((itemId) => itemId !== updatedItem.id);
  const destinationFirstItemId = findFirstItemIdForVisit(
    nextDestinationIds,
    updatedKey,
    itemsMap,
  );
  const destinationLastIndex = findLastIndexForVisit(
    nextDestinationIds,
    updatedKey,
    itemsMap,
  );

  if (
    !dateChanged &&
    destinationLastIndex < 0 &&
    !(departedFirstSourceMember && sourceVisitSurvives)
  ) {
    return { executeModeItems };
  }

  const insertIndex =
    destinationLastIndex >= 0
      ? destinationLastIndex + 1
      : nextDestinationIds.length;
  nextDestinationIds.splice(insertIndex, 0, updatedItem.id);
  nextExecuteModeItems[destinationDay] = nextDestinationIds;

  const placement: ExecuteInsertPlacement = destinationFirstItemId
    ? "merged-into-existing-visit"
    : "positioned";
  return {
    executeModeItems: nextExecuteModeItems,
    placement,
    ...(destinationFirstItemId
      ? { mergedIntoVisitItemIds: [destinationFirstItemId] }
      : {}),
  };
}

export function repositionExecuteItemAfterIdentityChange(
  executeModeItems: ExecuteModeItems,
  previousItem: ShoppingItem,
  updatedItem: ShoppingItem,
  updatedAllItems: readonly ShoppingItem[],
): ExecuteModeItems {
  return repositionExecuteItemAfterIdentityChangeWithResult(
    executeModeItems,
    previousItem,
    updatedItem,
    updatedAllItems,
  ).executeModeItems;
}

export function computeInsertIntoExecuteAtPosition(
  itemIds: string[],
  referenceItemId: string,
  position: "before" | "after",
  executeModeItems: ExecuteModeItems,
  dayName: string,
  allItems: ShoppingItem[],
  options: {
    expandSiblings?: boolean;
    requireReference?: boolean;
    canInsertWithReference?: (
      insertedItemId: string,
      referenceItemId: string,
    ) => boolean;
  } = {},
): ExecutePositionInsertResult {
  const currentDayItems = [...(executeModeItems[dayName] || [])];

  const insertedItemIds =
    options.expandSiblings === false
      ? itemIds.filter((id) => !currentDayItems.includes(id))
      : expandMapExecuteInsertItemIds(
          itemIds,
          dayName,
          allItems,
          executeModeItems,
        );
  if (insertedItemIds.length === 0) {
    return { accepted: false, executeModeItems, insertedItemIds: [] };
  }

  const itemsMap = new Map(allItems.map((item) => [item.id, item]));
  const insertGroups = groupInsertItemIdsByVisit(insertedItemIds, itemsMap);
  const mergedTargets = new Map<InsertVisitGroup, string>();
  const positionedGroups: InsertVisitGroup[] = [];
  insertGroups.forEach((group) => {
    const existingItemId = group.key
      ? findFirstItemIdForVisit(currentDayItems, group.key, itemsMap)
      : null;
    if (existingItemId) mergedTargets.set(group, existingItemId);
    else positionedGroups.push(group);
  });

  const refIndex = currentDayItems.indexOf(referenceItemId);
  if (
    positionedGroups.length > 0 &&
    refIndex < 0 &&
    options.requireReference !== false
  ) {
    return { accepted: false, executeModeItems, insertedItemIds: [] };
  }

  if (options.canInsertWithReference) {
    const rejectedMerge = Array.from(mergedTargets).some(
      ([group, mergeTargetId]) =>
        group.itemIds.some(
          (itemId) => !options.canInsertWithReference!(itemId, mergeTargetId),
        ),
    );
    const rejectedPosition =
      refIndex >= 0 &&
      positionedGroups.some((group) =>
        group.itemIds.some(
          (itemId) => !options.canInsertWithReference!(itemId, referenceItemId),
        ),
      );
    if (rejectedMerge || rejectedPosition) {
      return { accepted: false, executeModeItems, insertedItemIds: [] };
    }
  }

  // Do not rewrite legacy raw IDs. New members are appended after the last
  // raw member of their existing visit; the shared view projection places the
  // complete visit at its first logical position.
  const dayItems = currentDayItems.filter(
    (id) => !insertedItemIds.includes(id),
  );
  mergedTargets.forEach((mergeTargetId, group) => {
    const visitKey = group.key!;
    const lastVisitIndex = findLastIndexForVisit(dayItems, visitKey, itemsMap);
    const insertIndex =
      lastVisitIndex >= 0 ? lastVisitIndex + 1 : dayItems.length;
    dayItems.splice(insertIndex, 0, ...group.itemIds);
  });

  if (positionedGroups.length > 0) {
    let insertIndex = dayItems.length;
    const referenceItem = itemsMap.get(referenceItemId);
    const referenceKey = referenceItem
      ? buildExecutionVisitProjectionKey(referenceItem)
      : null;
    const currentRefIndex = referenceKey
      ? dayItems.findIndex((itemId) => {
          const item = itemsMap.get(itemId);
          return (
            item && buildExecutionVisitProjectionKey(item) === referenceKey
          );
        })
      : dayItems.indexOf(referenceItemId);

    if (currentRefIndex >= 0) {
      let firstRunEnd = currentRefIndex;
      if (referenceKey) {
        while (firstRunEnd < dayItems.length - 1) {
          const nextItem = itemsMap.get(dayItems[firstRunEnd + 1]);
          if (
            !nextItem ||
            buildExecutionVisitProjectionKey(nextItem) !== referenceKey
          )
            break;
          firstRunEnd++;
        }
      }
      insertIndex = position === "before" ? currentRefIndex : firstRunEnd + 1;
    } else if (options.requireReference !== false) {
      return { accepted: false, executeModeItems, insertedItemIds: [] };
    }

    dayItems.splice(
      insertIndex,
      0,
      ...positionedGroups.flatMap((group) => group.itemIds),
    );
  }

  const mergedIntoVisitItemIds = Array.from(new Set(mergedTargets.values()));
  const placement: ExecuteInsertPlacement =
    mergedTargets.size === 0
      ? "positioned"
      : positionedGroups.length === 0
        ? "merged-into-existing-visit"
        : "mixed";
  return {
    accepted: true,
    executeModeItems: { ...executeModeItems, [dayName]: dayItems },
    insertedItemIds: attachInsertMetadata(
      insertedItemIds,
      placement,
      mergedIntoVisitItemIds,
    ),
    placement,
    ...(mergedIntoVisitItemIds.length > 0 ? { mergedIntoVisitItemIds } : {}),
  };
}

export function computeAddToExecuteListFromMap(
  itemId: string,
  dayName: string,
  allItems: ShoppingItem[],
  executeModeItems: ExecuteModeItems,
  halls: HallDefinition[],
  hallRouteSettingsForMap: HallRouteSettings,
  mapData: DayMapData | undefined,
): ExecuteModeItems {
  return computeAddToExecuteListFromMapWithResult(
    itemId,
    dayName,
    allItems,
    executeModeItems,
    halls,
    hallRouteSettingsForMap,
    mapData,
  ).executeModeItems;
}

export function computeAddToExecuteListFromMapWithResult(
  itemId: string,
  dayName: string,
  allItems: ShoppingItem[],
  executeModeItems: ExecuteModeItems,
  halls: HallDefinition[],
  hallRouteSettingsForMap: HallRouteSettings,
  mapData: DayMapData | undefined,
): MapExecuteInsertResult {
  const insertItemIds = expandMapExecuteInsertItemIds(
    [itemId],
    dayName,
    allItems,
    executeModeItems,
  );
  if (insertItemIds.length === 0) {
    return { accepted: false, executeModeItems, insertedItemIds: [] };
  }

  const dayItems = [...(executeModeItems[dayName] || [])];
  const itemsMap = new Map(allItems.map((item) => [item.id, item]));
  const insertGroups = groupInsertItemIdsByVisit(insertItemIds, itemsMap);
  const mergedIntoVisitItemIds: string[] = [];
  let hallOrderedGroupCount = 0;

  for (const insertGroup of insertGroups) {
    const existingItemId = insertGroup.key
      ? findFirstItemIdForVisit(dayItems, insertGroup.key, itemsMap)
      : null;
    if (existingItemId && insertGroup.key) {
      const lastVisitIndex = findLastIndexForVisit(
        dayItems,
        insertGroup.key,
        itemsMap,
      );
      dayItems.splice(lastVisitIndex + 1, 0, ...insertGroup.itemIds);
      mergedIntoVisitItemIds.push(existingItemId);
      continue;
    }

    const item = itemsMap.get(insertGroup.itemIds[0]);
    if (!item) continue;
    hallOrderedGroupCount++;

    const itemHallId = findItemHallId(item, halls, mapData);

    if (!itemHallId || halls.length === 0) {
      dayItems.push(...insertGroup.itemIds);
      continue;
    }

    const hallOrder =
      hallRouteSettingsForMap.hallOrder.length > 0
        ? hallRouteSettingsForMap.hallOrder
        : halls.map((h) => h.id);

    const getHallIdForItem = (id: string): string | null => {
      const targetItem = itemsMap.get(id);
      if (!targetItem) return null;
      return findItemHallId(targetItem, halls, mapData);
    };

    let insertIndex = dayItems.length;
    const itemHallIndex = hallOrder.indexOf(itemHallId);

    if (itemHallIndex >= 0) {
      let lastSameHallIndex = -1;
      let firstLaterHallIndex = -1;

      for (let i = 0; i < dayItems.length; i++) {
        const existingItemHallId = getHallIdForItem(dayItems[i]);
        if (existingItemHallId === itemHallId) {
          lastSameHallIndex = i;
        } else if (existingItemHallId) {
          const existingHallIndex = hallOrder.indexOf(existingItemHallId);
          if (existingHallIndex > itemHallIndex && firstLaterHallIndex === -1) {
            firstLaterHallIndex = i;
          }
        }
      }

      if (lastSameHallIndex >= 0) {
        insertIndex = lastSameHallIndex + 1;
      } else if (firstLaterHallIndex >= 0) {
        insertIndex = firstLaterHallIndex;
      }
    }

    dayItems.splice(insertIndex, 0, ...insertGroup.itemIds);
  }

  const placement: ExecuteInsertPlacement =
    mergedIntoVisitItemIds.length === 0
      ? "hall-order"
      : hallOrderedGroupCount === 0
        ? "merged-into-existing-visit"
        : "mixed";
  return {
    accepted: true,
    executeModeItems: { ...executeModeItems, [dayName]: dayItems },
    insertedItemIds: attachInsertMetadata(
      insertItemIds,
      placement,
      mergedIntoVisitItemIds,
    ),
    placement,
    ...(mergedIntoVisitItemIds.length > 0 ? { mergedIntoVisitItemIds } : {}),
  };
}

/**
 * Adds several map items while preserving merge metadata across every step.
 * The single-item operation remains the source of truth because each accepted
 * insertion changes the execution list used by the following item.
 */
export function computeBatchAddToExecuteListFromMapWithResult(
  itemIds: readonly string[],
  dayName: string,
  allItems: ShoppingItem[],
  executeModeItems: ExecuteModeItems,
  halls: HallDefinition[],
  hallRouteSettingsForMap: HallRouteSettings,
  mapData: DayMapData | undefined,
): MapExecuteInsertResult {
  let current = executeModeItems;
  const insertedItemIds: string[] = [];
  const mergedIntoVisitItemIds: string[] = [];
  let hasMergedPlacement = false;
  let hasNonMergedPlacement = false;

  itemIds.forEach((itemId) => {
    const result = computeAddToExecuteListFromMapWithResult(
      itemId,
      dayName,
      allItems,
      current,
      halls,
      hallRouteSettingsForMap,
      mapData,
    );
    if (!result.accepted) return;

    current = result.executeModeItems;
    insertedItemIds.push(...result.insertedItemIds);
    mergedIntoVisitItemIds.push(...(result.mergedIntoVisitItemIds ?? []));
    if (
      result.placement === "merged-into-existing-visit" ||
      result.placement === "mixed"
    ) {
      hasMergedPlacement = true;
    }
    if (result.placement !== "merged-into-existing-visit") {
      hasNonMergedPlacement = true;
    }
  });

  if (insertedItemIds.length === 0) {
    return { accepted: false, executeModeItems, insertedItemIds: [] };
  }

  const uniqueMergedIntoVisitItemIds = Array.from(
    new Set(mergedIntoVisitItemIds),
  );
  const placement: ExecuteInsertPlacement = hasMergedPlacement
    ? hasNonMergedPlacement
      ? "mixed"
      : "merged-into-existing-visit"
    : "hall-order";

  return {
    accepted: true,
    executeModeItems: current,
    insertedItemIds: attachInsertMetadata(
      insertedItemIds,
      placement,
      uniqueMergedIntoVisitItemIds,
    ),
    placement,
    ...(uniqueMergedIntoVisitItemIds.length > 0
      ? { mergedIntoVisitItemIds: uniqueMergedIntoVisitItemIds }
      : {}),
  };
}

// ────────────────────────────────────────────────
// 5. computeAddToExecuteListFromMapAtPosition
// ────────────────────────────────────────────────

/**
 * 指定位置にアイテムを挿入する。
 */
export function computeAddToExecuteListFromMapAtPosition(
  itemId: string,
  referenceItemId: string,
  position: "before" | "after",
  executeModeItems: ExecuteModeItems,
  dayName: string,
): ExecuteModeItems {
  return computeInsertIntoExecuteAtPosition(
    [itemId],
    referenceItemId,
    position,
    executeModeItems,
    dayName,
    [],
    { expandSiblings: false, requireReference: false },
  ).executeModeItems;
}

// ────────────────────────────────────────────────
// 6. computeRemoveFromExecuteListFromMap
// ────────────────────────────────────────────────

/**
 * マップからexecuteリストのアイテムを除去する。
 */
export function computeRemoveFromExecuteListFromMap(
  itemId: string,
  executeModeItems: ExecuteModeItems,
  dayName: string,
  allItems?: ShoppingItem[],
): ExecuteModeItems {
  return computeRemoveFromExecuteListFromMapWithResult(
    [itemId],
    executeModeItems,
    dayName,
    allItems,
  ).executeModeItems;
}

/**
 * マップから指定アイテムと同一スペース・同一優先度の兄弟を一括除去し、
 * 実際に除去対象となったIDを従来と同じ先着順で返す。
 */
export function computeRemoveFromExecuteListFromMapWithResult(
  itemIds: string[],
  executeModeItems: ExecuteModeItems,
  dayName: string,
  allItems?: ShoppingItem[],
): MapExecuteRemovalResult {
  if (itemIds.length === 0) {
    return { executeModeItems, removedItemIds: [] };
  }

  const removedItemIds = allItems
    ? expandExecuteRemovalItemIds(itemIds, dayName, allItems, executeModeItems)
    : itemIds;
  const removedItemIdsSet = new Set(removedItemIds);
  const dayItems = (executeModeItems[dayName] || []).filter(
    (id) => !removedItemIdsSet.has(id),
  );

  return {
    executeModeItems: { ...executeModeItems, [dayName]: dayItems },
    removedItemIds,
  };
}

// ────────────────────────────────────────────────
// 7. computeMoveToExecuteColumn
// ────────────────────────────────────────────────

/**
 * 選択アイテムをexecute列に移動する。
 */
export function computeMoveToExecuteColumnWithResult(
  itemIds: string[],
  dayName: string,
  allItems: ShoppingItem[],
  executeModeItems: ExecuteModeItems,
  selectedBlockFilters: Set<string>,
): ExecutePositionInsertResult {
  const executeIdsSet = new Set(executeModeItems[dayName] || []);
  const normalizedDayName = normalizeExecutionVisitDay(dayName);
  const currentTabItems = allItems.filter(
    (item) => normalizeExecutionVisitDay(item.eventDate) === normalizedDayName,
  );

  let candidateItems = currentTabItems.filter(
    (item) => !executeIdsSet.has(item.id),
  );
  if (selectedBlockFilters.size > 0) {
    candidateItems = candidateItems.filter((item) =>
      selectedBlockFilters.has(item.block),
    );
  }

  const itemIdsSet = new Set(itemIds);
  const itemsToMove = candidateItems.filter((item) => itemIdsSet.has(item.id));
  const orderedItemIds = itemsToMove.map((item) => item.id);

  const currentDayItems = [...(executeModeItems[dayName] || [])];
  const existingIdsSet = new Set(currentDayItems);
  const newItemIds = orderedItemIds.filter((id) => !existingIdsSet.has(id));
  if (newItemIds.length === 0) {
    return { accepted: false, executeModeItems, insertedItemIds: [] };
  }

  const itemsMap = new Map(allItems.map((item) => [item.id, item]));
  const resultIds = [...currentDayItems];
  const mergedIntoVisitItemIds: string[] = [];
  let positionedGroupCount = 0;

  groupInsertItemIdsByVisit(newItemIds, itemsMap).forEach((group) => {
    const existingTargetId = group.key
      ? findFirstItemIdForVisit(currentDayItems, group.key, itemsMap)
      : null;
    if (existingTargetId && group.key) {
      const lastVisitIndex = findLastIndexForVisit(
        resultIds,
        group.key,
        itemsMap,
      );
      resultIds.splice(lastVisitIndex + 1, 0, ...group.itemIds);
      mergedIntoVisitItemIds.push(existingTargetId);
    } else {
      resultIds.push(...group.itemIds);
      positionedGroupCount++;
    }
  });

  const placement: ExecuteInsertPlacement =
    mergedIntoVisitItemIds.length === 0
      ? "positioned"
      : positionedGroupCount === 0
        ? "merged-into-existing-visit"
        : "mixed";

  return {
    accepted: true,
    executeModeItems: { ...executeModeItems, [dayName]: resultIds },
    insertedItemIds: attachInsertMetadata(
      newItemIds,
      placement,
      mergedIntoVisitItemIds,
    ),
    placement,
    ...(mergedIntoVisitItemIds.length > 0 ? { mergedIntoVisitItemIds } : {}),
  };
}

export function computeMoveToExecuteColumn(
  itemIds: string[],
  dayName: string,
  allItems: ShoppingItem[],
  executeModeItems: ExecuteModeItems,
  selectedBlockFilters: Set<string>,
): ExecuteModeItems {
  return computeMoveToExecuteColumnWithResult(
    itemIds,
    dayName,
    allItems,
    executeModeItems,
    selectedBlockFilters,
  ).executeModeItems;
}

// ────────────────────────────────────────────────
// 8. computeRemoveFromExecuteColumn
// ────────────────────────────────────────────────

/**
 * 選択アイテムをexecute列から除去する。
 */
export function computeRemoveFromExecuteColumn(
  itemIds: string[],
  executeModeItems: ExecuteModeItems,
  dayName: string,
): ExecuteModeItems {
  const currentDayItems = (executeModeItems[dayName] || []).filter(
    (id) => !itemIds.includes(id),
  );
  return {
    ...executeModeItems,
    [dayName]: currentDayItems,
  };
}

// ────────────────────────────────────────────────
// 8b. reorderExecuteIdsForSpaceAdjacency
// ────────────────────────────────────────────────

/**
 * 優先度変更後に、executeIds内で同一スペース+同一優先度の兄弟と隣接するようにアイテムを移動する。
 */
export function reorderExecuteIdsForSpaceAdjacency(
  itemId: string,
  allItems: ShoppingItem[],
  executeModeItems: ExecuteModeItems,
  dayName: string,
): ExecuteModeItems {
  const currentDayItems = executeModeItems[dayName] || [];
  if (!currentDayItems.includes(itemId)) return executeModeItems;

  const itemsMap = new Map(allItems.map((item) => [item.id, item]));
  const targetItem = itemsMap.get(itemId);
  if (!targetItem) return executeModeItems;

  const targetSpaceKey = getSpaceKey(targetItem.block, targetItem.number);
  const targetPriority = targetItem.priorityLevel || "none";

  // 同一spaceKey+priorityLevelの兄弟インデックスを収集
  const siblingIndices: number[] = [];
  const targetIndex = currentDayItems.indexOf(itemId);

  for (let i = 0; i < currentDayItems.length; i++) {
    if (i === targetIndex) continue;
    const item = itemsMap.get(currentDayItems[i]);
    if (!item) continue;
    if (
      getSpaceKey(item.block, item.number) === targetSpaceKey &&
      (item.priorityLevel || "none") === targetPriority
    ) {
      siblingIndices.push(i);
    }
  }

  // 兄弟がいない場合は何もしない
  if (siblingIndices.length === 0) return executeModeItems;

  // 既に兄弟と隣接している場合は何もしない
  const lastSiblingIndex = siblingIndices[siblingIndices.length - 1];
  const firstSiblingIndex = siblingIndices[0];
  if (
    targetIndex >= firstSiblingIndex - 1 &&
    targetIndex <= lastSiblingIndex + 1
  ) {
    // 兄弟の範囲内または直接隣接している
    return executeModeItems;
  }

  // 対象を現在位置から除去し、兄弟グループの最後の直後に挿入
  const newDayItems = currentDayItems.filter((id) => id !== itemId);
  // 除去後のインデックスを再計算（targetIndexが兄弟より前にあった場合、インデックスが1つずれる）
  const adjustedLastSiblingIndex =
    targetIndex < lastSiblingIndex ? lastSiblingIndex - 1 : lastSiblingIndex;
  newDayItems.splice(adjustedLastSiblingIndex + 1, 0, itemId);

  return {
    ...executeModeItems,
    [dayName]: newDayItems,
  };
}

// ────────────────────────────────────────────────
// 9. computeMoveItem (D&D)
// ────────────────────────────────────────────────
