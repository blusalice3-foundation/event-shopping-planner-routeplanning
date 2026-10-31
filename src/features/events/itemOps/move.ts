import {
  buildExecutionPlacementVisitKey as buildExecutionVisitProjectionKey,
  isSameExecutionPlacementGroup,
  isSameExecutionPlacementVisit,
  canPlaceExecutionItemsAtBoundary,
  applyExecutionBookOrder,
} from "../../../utils/executionPlacement";
import {
  sameDragIds,
  validateShoppingDragPlacement,
  type ShoppingDragMoveContext,
} from "../../shopping-list/drag/shoppingDrag";
import { buildMovePlan } from "../../lists/domain/movePlan";
import { existingDayKey } from "../../consistency/domain/context";
import { recordEntry } from "../../../utils/ownRecord";
import type {
  ExecuteModeItems,
  ShoppingItem,
  ViewMode,
} from "../../../types/item";
import {
  normalizeExecutionVisitDay,
  projectItemsToExecutionVisits,
} from "../../../utils/visitProjection";
import {
  expandSameSpacePriorityItemIds,
  type ExecuteInsertPlacement,
} from "./executeList";

export interface MoveItemResult {
  eventListItems?: ShoppingItem[];
  executeModeItems?: ExecuteModeItems;
  placement?: ExecuteInsertPlacement;
  mergedIntoVisitItemIds?: string[];
  /** Accepted cross-column members, including automatic visit expansion. */
  transferredItemIds?: readonly string[];
}

/**
 * 編集モードのD&Dによるアイテム移動:
 * - editモード列間移動（candidate→execute, execute→candidate）
 * - editモード同列リオーダー（execute列内, candidate列内）
 */
export function computeMoveItem(params: {
  dragId: string;
  hoverId: string;
  targetColumn?: "execute" | "candidate";
  sourceColumn?: "execute" | "candidate";
  mode: ViewMode | undefined;
  effectiveSelectedIds: Set<string>;
  allItems: ShoppingItem[];
  executeModeItems: ExecuteModeItems;
  dayName: string;
  selectedBlockFilters: Set<string>;
  areItemsInSameHall?: (id1: string, id2: string) => boolean;
  dragContext?: ShoppingDragMoveContext;
}): MoveItemResult {
  const {
    dragId,
    hoverId,
    targetColumn,
    sourceColumn,
    mode,
    effectiveSelectedIds,
    allItems,
    executeModeItems,
    dayName,
    selectedBlockFilters,
    areItemsInSameHall,
    dragContext,
  } = params;

  if (mode !== "edit") return {};

  const isDragInEffectiveSelection = effectiveSelectedIds.has(dragId);
  const isAppendToEnd = hoverId === "__END_OF_LIST__";
  const savedDayName = existingDayKey(executeModeItems, dayName) ?? dayName;
  const executeIdsSet = new Set(
    recordEntry(executeModeItems, savedDayName) || [],
  );
  const normalizedDayName = normalizeExecutionVisitDay(dayName);

  if (dragContext) {
    if (
      !dragContext.isCurrent() ||
      mode !== "edit" ||
      dragContext.day !== dayName ||
      dragContext.sourceColumn !== sourceColumn ||
      dragContext.targetColumn !== targetColumn
    )
      return {};
    const sourceItems = allItems.filter(
      (item) =>
        normalizeExecutionVisitDay(item.eventDate) === normalizedDayName &&
        (sourceColumn === "execute"
          ? executeIdsSet.has(item.id)
          : !executeIdsSet.has(item.id) &&
            (selectedBlockFilters.size === 0 ||
              selectedBlockFilters.has(item.block))),
    );
    if (sourceColumn === "execute") {
      const positions = new Map(
        (recordEntry(executeModeItems, savedDayName) || []).map((id, index) => [
          id,
          index,
        ]),
      );
      sourceItems.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
    }
    const plan = buildMovePlan({
      requestedIds: dragContext.requestedIds,
      sourceOrderedIds: sourceItems.map((item) => item.id),
      allItems,
      dayName,
      expansionPolicy:
        dragContext.placement?.kind === "items" ||
        (sourceColumn === "candidate" && targetColumn === "candidate") ||
        (sourceColumn === "execute" &&
          targetColumn === "execute" &&
          dragContext.requestedIds.every((id) => {
            const item = allItems.find((candidate) => candidate.id === id);
            const hover = allItems.find(
              (candidate) => candidate.id === hoverId,
            );
            return (
              item &&
              hover &&
              isSameExecutionPlacementVisit(item, hover, { allItems })
            );
          }))
          ? "exact"
          : "same-visit",
    });
    if (
      !sameDragIds(plan.requested, dragContext.requestedIds) ||
      !sameDragIds(plan.effective, dragContext.effectiveIds) ||
      !plan.effective.includes(dragId)
    )
      return {};
    const currentVisits = new Map(
      projectItemsToExecutionVisits(
        sourceItems.filter((item) =>
          dragContext.effectiveIds.includes(item.id),
        ),
        buildExecutionVisitProjectionKey,
      ).map((visit) => [visit.key, visit]),
    );
    if (
      dragContext.sourceVisits.some((expected) => {
        const current = currentVisits.get(expected.key);
        return !current || !sameDragIds(expected.ids, current.itemIds);
      })
    )
      return {};
    if (targetColumn === "candidate" && hoverId !== "__END_OF_LIST__") {
      const target = allItems.find((item) => item.id === hoverId);
      if (
        !target ||
        executeIdsSet.has(hoverId) ||
        normalizeExecutionVisitDay(target.eventDate) !== normalizedDayName ||
        (selectedBlockFilters.size > 0 &&
          !selectedBlockFilters.has(target.block))
      )
        return {};
    }
  }
  // ---- editモード列間移動 ----
  if (
    mode === "edit" &&
    sourceColumn &&
    targetColumn &&
    sourceColumn !== targetColumn
  ) {
    if (sourceColumn === "candidate" && targetColumn === "execute") {
      // candidate → execute
      const currentTabItems = allItems.filter(
        (item) =>
          normalizeExecutionVisitDay(item.eventDate) === normalizedDayName,
      );
      let candidateItems = currentTabItems.filter(
        (item) => !executeIdsSet.has(item.id),
      );

      if (selectedBlockFilters.size > 0) {
        candidateItems = candidateItems.filter((item) =>
          selectedBlockFilters.has(item.block),
        );
      }

      let itemsToMove: ShoppingItem[] = [];
      if (isDragInEffectiveSelection) {
        // スペースグループ展開：選択アイテムの同一スペース+同一優先度を自動追加
        const expandedIds = expandSameSpacePriorityItemIds(
          Array.from(effectiveSelectedIds),
          candidateItems,
        );
        itemsToMove = candidateItems.filter((item) =>
          expandedIds.includes(item.id),
        );
      } else {
        const item = candidateItems.find((item) => item.id === dragId);
        if (item) {
          // 単一アイテムでもスペースグループ全体を移動
          const expandedIds = expandSameSpacePriorityItemIds(
            [dragId],
            candidateItems,
          );
          itemsToMove = candidateItems.filter((i) =>
            expandedIds.includes(i.id),
          );
        }
      }

      if (
        itemsToMove.length === 0 ||
        !itemsToMove.every((item) =>
          isSameExecutionPlacementGroup(itemsToMove[0], item, { allItems }),
        )
      )
        return {};

      const dayItems = [...(recordEntry(executeModeItems, savedDayName) || [])];
      const itemsMap = new Map(allItems.map((item) => [item.id, item]));
      const positionedItemIds: string[] = [];
      const mergedIntoVisitItemIds: string[] = [];

      projectItemsToExecutionVisits(
        itemsToMove,
        buildExecutionVisitProjectionKey,
      ).forEach((visit) => {
        let firstExistingItemId: string | null = null;
        let lastExistingIndex = -1;
        for (let index = 0; index < dayItems.length; index++) {
          const existingItem = itemsMap.get(dayItems[index]);
          if (
            !existingItem ||
            buildExecutionVisitProjectionKey(existingItem) !== visit.key
          ) {
            continue;
          }
          firstExistingItemId ??= existingItem.id;
          lastExistingIndex = index;
        }

        if (lastExistingIndex >= 0 && firstExistingItemId) {
          dayItems.splice(lastExistingIndex + 1, 0, ...visit.itemIds);
          mergedIntoVisitItemIds.push(firstExistingItemId);
          return;
        }
        positionedItemIds.push(...visit.itemIds);
      });

      const columnInsertions = dragContext?.placement?.hallTailInsertions;
      if (positionedItemIds.length > 0 && columnInsertions) {
        if (
          !sameDragIds(
            positionedItemIds,
            columnInsertions.flatMap((entry) => entry.itemIds),
          )
        )
          return {};
        for (const insertion of columnInsertions) {
          const index = dayItems.indexOf(insertion.anchorId);
          if (insertion.anchorId !== "__END_OF_LIST__" && index < 0) return {};
          dayItems.splice(
            index < 0 ? dayItems.length : index,
            0,
            ...insertion.itemIds,
          );
        }
      } else if (positionedItemIds.length > 0) {
        const hoverItem = itemsMap.get(hoverId);
        const hoverVisitKey = hoverItem
          ? buildExecutionVisitProjectionKey(hoverItem)
          : null;
        const explicitAnchor = dragContext?.placement?.anchorId;
        const hoverIndex = explicitAnchor
          ? explicitAnchor === "__END_OF_LIST__"
            ? -1
            : dayItems.indexOf(explicitAnchor)
          : isAppendToEnd
            ? -1
            : hoverVisitKey
              ? dayItems.findIndex((id) => {
                  const item = itemsMap.get(id);
                  return (
                    item !== undefined &&
                    buildExecutionVisitProjectionKey(item) === hoverVisitKey
                  );
                })
              : dayItems.findIndex((id) => id === hoverId);
        if (hoverIndex < 0) {
          dayItems.push(...positionedItemIds);
        } else {
          dayItems.splice(hoverIndex, 0, ...positionedItemIds);
        }
      }

      if (
        dragContext?.placement &&
        !validateShoppingDragPlacement(
          dragContext.placement,
          (recordEntry(executeModeItems, savedDayName) || []).flatMap((id) => {
            const item = itemsMap.get(id);
            return item ? [item] : [];
          }),
          dayItems.flatMap((id) => {
            const item = itemsMap.get(id);
            return item ? [item] : [];
          }),
        )
      )
        return {};

      const placement: ExecuteInsertPlacement =
        mergedIntoVisitItemIds.length === 0
          ? "positioned"
          : positionedItemIds.length === 0
            ? "merged-into-existing-visit"
            : "mixed";
      return {
        executeModeItems: { ...executeModeItems, [savedDayName]: dayItems },
        transferredItemIds: itemsToMove.map((item) => item.id),
        placement,
        ...(mergedIntoVisitItemIds.length > 0
          ? { mergedIntoVisitItemIds }
          : {}),
      };
    } else if (sourceColumn === "execute" && targetColumn === "candidate") {
      // execute → candidate
      const executeItems = allItems.filter(
        (item) =>
          normalizeExecutionVisitDay(item.eventDate) === normalizedDayName &&
          executeIdsSet.has(item.id),
      );
      const candidateItems = allItems.filter(
        (item) =>
          normalizeExecutionVisitDay(item.eventDate) === normalizedDayName &&
          !executeIdsSet.has(item.id),
      );

      let itemsToMove: ShoppingItem[] = [];
      if (isDragInEffectiveSelection) {
        // スペースグループ展開：選択アイテムの同一スペース+同一優先度を自動追加
        const expandedIds = expandSameSpacePriorityItemIds(
          Array.from(effectiveSelectedIds),
          executeItems,
        );
        itemsToMove = executeItems.filter((item) =>
          expandedIds.includes(item.id),
        );
      } else {
        const item = executeItems.find((item) => item.id === dragId);
        if (item) {
          // 単一アイテムでもスペースグループ全体を移動
          const expandedIds = expandSameSpacePriorityItemIds(
            [dragId],
            executeItems,
          );
          itemsToMove = executeItems.filter((i) => expandedIds.includes(i.id));
        }
      }

      if (
        itemsToMove.length === 0 ||
        !itemsToMove.every((item) =>
          isSameExecutionPlacementGroup(itemsToMove[0], item, { allItems }),
        )
      )
        return {};

      const itemIdsToMove = itemsToMove.map((item) => item.id);

      // executeModeItemsからの除去
      const newDayItems = (
        recordEntry(executeModeItems, savedDayName) || []
      ).filter((id) => !itemIdsToMove.includes(id));

      // candidate列のリオーダー
      let newCandidateList: ShoppingItem[];
      if (isAppendToEnd) {
        newCandidateList = [...candidateItems, ...itemsToMove];
      } else {
        const hoverIndex = candidateItems.findIndex(
          (item) => item.id === hoverId,
        );
        if (hoverIndex === -1) {
          newCandidateList = [...candidateItems, ...itemsToMove];
        } else {
          const listWithoutMoved = candidateItems.filter(
            (item) => !itemIdsToMove.includes(item.id),
          );
          listWithoutMoved.splice(hoverIndex, 0, ...itemsToMove);
          newCandidateList = listWithoutMoved;
        }
      }

      // allItemsのリビルド
      const remainingExecuteItems = executeItems.filter(
        (item) => !itemIdsToMove.includes(item.id),
      );
      const execShift = [...remainingExecuteItems];
      const candShift = [...newCandidateList];

      const newItems = allItems.map((item) => {
        if (normalizeExecutionVisitDay(item.eventDate) !== normalizedDayName)
          return item;
        if (executeIdsSet.has(item.id) && !itemIdsToMove.includes(item.id)) {
          return execShift.shift() || item;
        } else if (
          !executeIdsSet.has(item.id) ||
          itemIdsToMove.includes(item.id)
        ) {
          return candShift.shift() || item;
        }
        return item;
      });

      return {
        eventListItems: newItems,
        executeModeItems: { ...executeModeItems, [savedDayName]: newDayItems },
        transferredItemIds: itemIdsToMove,
      };
    }
  }

  // ---- editモード同列リオーダー: execute列内 ----
  if (mode === "edit" && targetColumn === "execute") {
    const dayItems = [...(recordEntry(executeModeItems, savedDayName) || [])];
    const itemsById = new Map(allItems.map((item) => [item.id, item]));
    const requestedIds = isDragInEffectiveSelection
      ? [...effectiveSelectedIds]
      : [dragId];
    const requestedItems = requestedIds.flatMap((id) => {
      const item = itemsById.get(id);
      return item &&
        executeIdsSet.has(id) &&
        normalizeExecutionVisitDay(item.eventDate) === normalizedDayName
        ? [item]
        : [];
    });
    const first = requestedItems[0];
    if (
      !first ||
      !requestedItems.every((item) =>
        isSameExecutionPlacementGroup(first, item, { allItems }),
      )
    )
      return {};
    const hover = itemsById.get(hoverId);
    const reorderBooks =
      dragContext?.placement?.kind === "items" ||
      (!!hover &&
        requestedItems.every((item) =>
          isSameExecutionPlacementVisit(item, hover, { allItems }),
        ));
    const movedIds = new Set(
      dragContext?.effectiveIds ??
        (reorderBooks
          ? requestedItems.map((item) => item.id)
          : expandSameSpacePriorityItemIds(requestedIds, allItems, {
              dayName,
              sourceIds: executeIdsSet,
            })),
    );
    const selectedBlock = dayItems.filter((id) => movedIds.has(id));
    const movingItems = selectedBlock.flatMap((id) => itemsById.get(id) ?? []);
    if (
      !movingItems.length ||
      !movingItems.every((item) =>
        isSameExecutionPlacementGroup(first, item, { allItems }),
      )
    )
      return {};
    const remaining = dayItems.filter((id) => !movedIds.has(id));
    let beforeId = dragContext?.placement?.anchorId ?? hoverId;
    if (!dragContext?.placement && !isAppendToEnd && !reorderBooks && hover) {
      beforeId =
        remaining.find((id) => {
          const item = itemsById.get(id);
          return (
            item && isSameExecutionPlacementVisit(item, hover, { allItems })
          );
        }) ?? hoverId;
    }
    const index =
      beforeId === "__END_OF_LIST__"
        ? remaining.length
        : remaining.indexOf(beforeId);
    if (index < 0) return {};
    const remainingItems = remaining.flatMap((id) => itemsById.get(id) ?? []);
    if (reorderBooks) {
      if (
        dragContext?.placement?.kind !== "items" &&
        (!hover || movedIds.has(hoverId))
      )
        return {};
    } else if (
      !canPlaceExecutionItemsAtBoundary({
        movingItems,
        remainingItems,
        beforeId,
        context: { allItems },
      })
    )
      return {};
    if (areItemsInSameHall && !reorderBooks) {
      const neighbours = [remaining[index - 1], remaining[index]].filter(
        (id): id is string => !!id,
      );
      if (
        !neighbours.some((id) =>
          movingItems.every((item) => areItemsInSameHall(item.id, id)),
        )
      )
        return {};
    }
    const before = remaining.flatMap((id) => itemsById.get(id) ?? []);
    remaining.splice(index, 0, ...selectedBlock);
    let resultIds = remaining;
    if (reorderBooks) {
      const bookIds = new Set(
        dayItems.filter((id) => {
          const item = itemsById.get(id);
          return (
            item && isSameExecutionPlacementVisit(first, item, { allItems })
          );
        }),
      );
      const desired = (
        dragContext?.placement?.expectedItemIds ?? remaining
      ).filter((id) => bookIds.has(id));
      if (
        desired.length !== bookIds.size ||
        new Set(desired).size !== bookIds.size
      )
        return {};
      resultIds = applyExecutionBookOrder(dayItems, desired);
    }
    if (
      dragContext?.placement &&
      !validateShoppingDragPlacement(
        dragContext.placement,
        before,
        resultIds.flatMap((id) => itemsById.get(id) ?? []),
      )
    )
      return {};
    return {
      executeModeItems: { ...executeModeItems, [savedDayName]: resultIds },
    };
  }
  // ---- editモード同列リオーダー: candidate列内 ----
  if (mode === "edit" && targetColumn === "candidate") {
    const candidateItems = allItems.filter(
      (item) =>
        normalizeExecutionVisitDay(item.eventDate) === normalizedDayName &&
        !executeIdsSet.has(item.id),
    );

    const rebuildItems = (newCandidateList: ShoppingItem[]): ShoppingItem[] => {
      const executeItems = allItems.filter(
        (item) =>
          normalizeExecutionVisitDay(item.eventDate) === normalizedDayName &&
          executeIdsSet.has(item.id),
      );
      const execShift = [...executeItems];
      const candShift = [...newCandidateList];

      return allItems.map((item) => {
        if (normalizeExecutionVisitDay(item.eventDate) !== normalizedDayName)
          return item;
        if (executeIdsSet.has(item.id)) {
          return execShift.shift() || item;
        } else {
          return candShift.shift() || item;
        }
      });
    };

    if (isDragInEffectiveSelection) {
      const selectedBlock = candidateItems.filter((item) =>
        effectiveSelectedIds.has(item.id),
      );
      const listWithoutSelection = candidateItems.filter(
        (item) => !effectiveSelectedIds.has(item.id),
      );

      let newCandidateList: ShoppingItem[];
      if (isAppendToEnd) {
        newCandidateList = [...listWithoutSelection, ...selectedBlock];
      } else {
        const targetIndex = listWithoutSelection.findIndex(
          (item) => item.id === hoverId,
        );
        if (targetIndex === -1) return {};
        listWithoutSelection.splice(targetIndex, 0, ...selectedBlock);
        newCandidateList = listWithoutSelection;
      }

      return { eventListItems: rebuildItems(newCandidateList) };
    } else {
      const dragIndex = candidateItems.findIndex((item) => item.id === dragId);
      if (dragIndex === -1) return {};

      const [draggedItem] = candidateItems.splice(dragIndex, 1);
      if (isAppendToEnd) {
        candidateItems.push(draggedItem);
      } else {
        const hoverIndex = candidateItems.findIndex(
          (item) => item.id === hoverId,
        );
        if (hoverIndex === -1) return {};
        candidateItems.splice(hoverIndex, 0, draggedItem);
      }

      return { eventListItems: rebuildItems(candidateItems) };
    }
  }

  return {};
}

// ────────────────────────────────────────────────
// 10. computeMoveItemVertical
// ────────────────────────────────────────────────

/**
 * 上下移動。ホール境界を尊重する。
 *
 * @param areItemsInSameHall - App.tsx側で定義されるホール判定コールバック
 */
export function computeMoveItemVertical(
  direction: "up" | "down",
  itemId: string,
  targetColumn: "execute" | "candidate" | undefined,
  mode: ViewMode | undefined,
  effectiveSelectedIds: Set<string>,
  allItems: ShoppingItem[],
  executeModeItems: ExecuteModeItems,
  dayName: string,
  areItemsInSameHall: (id1: string, id2: string) => boolean,
): MoveItemResult {
  if (mode !== "edit") return {};

  const isDragInEffectiveSelection = effectiveSelectedIds.has(itemId);
  const savedDayName = existingDayKey(executeModeItems, dayName) ?? dayName;
  const executeIdsSet = new Set(
    recordEntry(executeModeItems, savedDayName) || [],
  );

  // ---- editモード execute列 ----
  if (mode === "edit" && targetColumn === "execute") {
    const dayItems = [...(recordEntry(executeModeItems, savedDayName) || [])];
    const itemsById = new Map(allItems.map((item) => [item.id, item]));
    const selected = new Set(
      isDragInEffectiveSelection ? effectiveSelectedIds : [itemId],
    );
    const selectedIds = dayItems.filter((id) => selected.has(id));
    if (!selectedIds.length) return {};
    const first = itemsById.get(selectedIds[0]);
    if (
      !first ||
      !selectedIds.every((id) => {
        const item = itemsById.get(id);
        return (
          item &&
          isSameExecutionPlacementVisit(first, item, { allItems }) &&
          areItemsInSameHall(first.id, id)
        );
      })
    )
      return {};
    const visitIds = dayItems.filter((id) => {
      const item = itemsById.get(id);
      return item && isSameExecutionPlacementVisit(first, item, { allItems });
    });
    const firstIndex = visitIds.indexOf(selectedIds[0]);
    const lastIndex = visitIds.indexOf(selectedIds[selectedIds.length - 1]);
    const targetId =
      visitIds[direction === "up" ? firstIndex - 1 : lastIndex + 1];
    const target = targetId ? itemsById.get(targetId) : undefined;
    if (
      !target ||
      !selectedIds.every((id) => areItemsInSameHall(id, targetId)) ||
      !isSameExecutionPlacementVisit(first, target, { allItems })
    )
      return {};
    const remainingBooks = visitIds.filter((id) => !selected.has(id));
    const targetIndex = remainingBooks.indexOf(targetId);
    if (targetIndex < 0) return {};
    remainingBooks.splice(
      targetIndex + (direction === "down" ? 1 : 0),
      0,
      ...selectedIds,
    );
    const remaining = applyExecutionBookOrder(dayItems, remainingBooks);
    return {
      executeModeItems: { ...executeModeItems, [savedDayName]: remaining },
    };
  }
  // ---- editモード candidate列 ----
  if (mode === "edit" && targetColumn === "candidate") {
    const candidateItems = allItems.filter(
      (item) =>
        normalizeExecutionVisitDay(item.eventDate) ===
          normalizeExecutionVisitDay(dayName) && !executeIdsSet.has(item.id),
    );
    const currentIndex = candidateItems.findIndex((item) => item.id === itemId);

    const rebuildItems = (newCandidateList: ShoppingItem[]): ShoppingItem[] => {
      const executeItems = allItems.filter(
        (item) =>
          normalizeExecutionVisitDay(item.eventDate) ===
            normalizeExecutionVisitDay(dayName) && executeIdsSet.has(item.id),
      );
      const execShift = [...executeItems];
      const candShift = [...newCandidateList];

      return allItems.map((item) => {
        if (
          !(
            normalizeExecutionVisitDay(item.eventDate) ===
            normalizeExecutionVisitDay(dayName)
          )
        )
          return item;
        if (executeIdsSet.has(item.id)) {
          return execShift.shift() || item;
        } else {
          return candShift.shift() || item;
        }
      });
    };

    if (direction === "up") {
      if (currentIndex <= 0) return {};

      if (isDragInEffectiveSelection) {
        const selectedBlock = candidateItems.filter((item) =>
          effectiveSelectedIds.has(item.id),
        );
        const listWithoutSelection = candidateItems.filter(
          (item) => !effectiveSelectedIds.has(item.id),
        );
        const firstSelectedIndex = candidateItems.findIndex((item) =>
          effectiveSelectedIds.has(item.id),
        );

        if (firstSelectedIndex > 0) {
          const newTargetIndex = firstSelectedIndex - 1;
          listWithoutSelection.splice(newTargetIndex, 0, ...selectedBlock);
          return { eventListItems: rebuildItems(listWithoutSelection) };
        }
        return {};
      } else {
        [candidateItems[currentIndex - 1], candidateItems[currentIndex]] = [
          candidateItems[currentIndex],
          candidateItems[currentIndex - 1],
        ];
        return { eventListItems: rebuildItems(candidateItems) };
      }
    } else {
      // down
      if (currentIndex < 0 || currentIndex >= candidateItems.length - 1)
        return {};

      if (isDragInEffectiveSelection) {
        const selectedBlock = candidateItems.filter((item) =>
          effectiveSelectedIds.has(item.id),
        );
        const listWithoutSelection = candidateItems.filter(
          (item) => !effectiveSelectedIds.has(item.id),
        );

        let lastSelectedIndex = -1;
        candidateItems.forEach((item, index) => {
          if (effectiveSelectedIds.has(item.id)) lastSelectedIndex = index;
        });

        if (
          lastSelectedIndex >= 0 &&
          lastSelectedIndex < candidateItems.length - 1
        ) {
          const jumpOverItemId = candidateItems[lastSelectedIndex + 1].id;
          const targetIndexInListWithout = listWithoutSelection.findIndex(
            (item) => item.id === jumpOverItemId,
          );

          if (targetIndexInListWithout !== -1) {
            listWithoutSelection.splice(
              targetIndexInListWithout + 1,
              0,
              ...selectedBlock,
            );
            return { eventListItems: rebuildItems(listWithoutSelection) };
          }
        }
        return {};
      } else {
        [candidateItems[currentIndex], candidateItems[currentIndex + 1]] = [
          candidateItems[currentIndex + 1],
          candidateItems[currentIndex],
        ];
        return { eventListItems: rebuildItems(candidateItems) };
      }
    }
  }

  return {};
}

// ────────────────────────────────────────────────
// 11. computeUpdateItemPriority
// ────────────────────────────────────────────────
