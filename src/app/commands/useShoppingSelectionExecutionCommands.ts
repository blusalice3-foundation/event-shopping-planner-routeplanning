import { useCallback, useEffect, useRef } from "react";
import type {
  BlockSortDirection,
  BulkSortDirection,
  SortState,
} from "../../features/app-shell/types";
import type { RangePresentation } from "../../features/lists/domain/rangeSelection";
import type {
  DayModeState,
  ExecuteModeItems,
  PurchaseStatus,
  ShoppingItem,
  ViewMode,
} from "../../types/item";
import { clearLimitedPurchase } from "../../utils/purchaseQuantity";
import { getSpaceKey } from "../../utils/spaceGrouping";
import {
  buildExecutionVisitProjectionKey,
  normalizeExecutionVisitDay,
} from "../../utils/visitProjection";
import type { MutableCommandValue } from "./useShoppingItemMutationCommands";

type EventLists = Record<string, ShoppingItem[]>;
type DayModesByEvent = Record<string, DayModeState>;
type ExecuteModeItemsByEvent = Record<string, ExecuteModeItems>;
type StateAction<T> = T | ((current: T) => T);

const isSameExecutionVisitDay = (eventDate: string, dayName: string): boolean =>
  normalizeExecutionVisitDay(eventDate) === normalizeExecutionVisitDay(dayName);

export interface ShoppingSelectionExecutionStatePort {
  readonly activeEventName: string | null;
  readonly activeEventDate: string;
  readonly currentMode: ViewMode | undefined;
  readonly dayModes: DayModesByEvent;
  readonly sortState: SortState;
  readonly executeColumnItems: readonly ShoppingItem[];
  readonly items: readonly ShoppingItem[];
  readonly selectedItemIds: ReadonlySet<string>;
  readonly recentlyChangedItemIds: ReadonlySet<string>;
  readonly executeModeItemsRef: MutableCommandValue<ExecuteModeItemsByEvent>;
  readonly spaceGroupDragItemIdsRef: MutableCommandValue<
    readonly string[] | null
  >;
}

export interface ShoppingSelectionInteractionPort {
  clearSelection(): void;
  clearRangeSelection(): void;
  selectItemForRange(itemId: string, presentation: RangePresentation): void;
  selectSpaceGroupForRange(
    groupKey: string,
    allItemIds: readonly string[],
    presentation: RangePresentation,
  ): void;
  toggleRangeItemIdsSelection(itemIds: readonly string[]): void;
}

export interface ShoppingSelectionExecutionActionPort {
  setDayModes(action: StateAction<DayModesByEvent>): void;
  setEventLists(action: StateAction<EventLists>): void;
  setRecentlyChangedItemIds(action: StateAction<Set<string>>): void;
  setCandidateNumberSortDirection(value: null): void;
  setFocusModeMapVisible(value: false): void;
  closeUiSettingsPanel(): void;
  setShowPostponeFilterButton(value: boolean): void;
  setShowLateFilterButton(value: boolean): void;
  setSortState(value: SortState): void;
  setBlockSortDirection(value: BlockSortDirection | null): void;
  setExecuteCollapsedSpaces(action: StateAction<Set<string>>): void;
  updateExecuteModeItems(action: StateAction<ExecuteModeItemsByEvent>): void;
  updateItem(item: ShoppingItem): void;
}

export interface ShoppingSelectionExecutionEffectPort {
  notify(message: string): void;
  scheduleCenteredItemScroll(itemId: string): void;
}

export interface ShoppingSelectionExecutionCommandPorts {
  readonly state: ShoppingSelectionExecutionStatePort;
  readonly interaction: ShoppingSelectionInteractionPort;
  readonly actions: ShoppingSelectionExecutionActionPort;
  readonly effects: ShoppingSelectionExecutionEffectPort;
}

export interface ShoppingSelectionExecutionCommands {
  toggleMode(day?: string): void;
  setViewMode(mode: ViewMode, scrollToItemId?: string): void;
  selectItem(
    itemId: string,
    columnType: "execute" | "candidate" | undefined,
    presentation: RangePresentation,
  ): void;
  selectSpaceGroup(
    groupKey: string,
    allItemIds: readonly string[],
    presentation: RangePresentation,
  ): void;
  toggleItemsSelection(itemIds: readonly string[]): void;
  clearSelection(): void;
  setSpaceGroupDragItemIds(itemIds: readonly string[] | null): void;
  changeBulkStatus(
    groupKey: string,
    targetStatus: PurchaseStatus,
    groupItems: ShoppingItem[],
  ): void;
  updateExecuteItem(updatedItem: ShoppingItem): void;
  activatePostponeFilter(): void;
  activateLateFilter(): void;
  setExecuteSpaceGroupOrder(orderedGroupKeys: readonly string[]): void;
  collapseAndOpenNext(currentGroupKey: string): void;
  sortSelectedItems(direction: BulkSortDirection): void;
}

const buildSpacePriorityGroupKey = (item: ShoppingItem): string => {
  const spaceKey = getSpaceKey(item.block, item.number);
  const priority = item.priorityLevel || "none";
  return priority !== "none" ? `${spaceKey}:${priority}` : spaceKey;
};

export const useShoppingSelectionExecutionCommands = ({
  state,
  interaction,
  actions,
  effects,
}: ShoppingSelectionExecutionCommandPorts): ShoppingSelectionExecutionCommands => {
  const {
    activeEventName,
    activeEventDate,
    currentMode,
    dayModes,
    sortState,
    executeColumnItems,
    items,
    selectedItemIds,
    recentlyChangedItemIds,
    executeModeItemsRef,
    spaceGroupDragItemIdsRef,
  } = state;
  const {
    clearSelection,
    clearRangeSelection,
    selectItemForRange,
    selectSpaceGroupForRange,
    toggleRangeItemIdsSelection,
  } = interaction;
  const {
    setDayModes,
    setEventLists,
    setRecentlyChangedItemIds,
    setCandidateNumberSortDirection,
    setFocusModeMapVisible,
    closeUiSettingsPanel,
    setShowPostponeFilterButton,
    setShowLateFilterButton,
    setSortState,
    setBlockSortDirection,
    setExecuteCollapsedSpaces,
    updateExecuteModeItems,
    updateItem,
  } = actions;
  const { scheduleCenteredItemScroll } = effects;

  const executeSpaceGroupOrderRef = useRef<readonly string[]>([]);
  const executeColumnItemsRef =
    useRef<readonly ShoppingItem[]>(executeColumnItems);
  const recentlyChangedItemIdsRef = useRef<ReadonlySet<string>>(
    recentlyChangedItemIds,
  );

  useEffect(() => {
    executeColumnItemsRef.current = executeColumnItems;
  }, [executeColumnItems]);

  useEffect(() => {
    recentlyChangedItemIdsRef.current = recentlyChangedItemIds;
  }, [recentlyChangedItemIds]);

  useEffect(() => {
    setShowPostponeFilterButton(false);
    setShowLateFilterButton(false);
  }, [
    currentMode,
    setShowLateFilterButton,
    setShowPostponeFilterButton,
    sortState,
  ]);

  const toggleMode = useCallback(
    (targetDay = activeEventDate) => {
      if (!activeEventName || !targetDay) return;
      setDayModes((current) => {
        const mode = current[activeEventName]?.[targetDay];
        return {
          ...current,
          [activeEventName]: {
            ...current[activeEventName],
            [targetDay]: mode === "execute" ? "edit" : "execute",
          },
        };
      });
      clearSelection();
      setCandidateNumberSortDirection(null);
    },
    [
      activeEventName,
      activeEventDate,
      setDayModes,
      clearSelection,
      setCandidateNumberSortDirection,
    ],
  );
  const setViewMode = useCallback(
    (mode: ViewMode, scrollToItemId?: string) => {
      if (!activeEventName) return;
      setDayModes((current) => ({
        ...current,
        [activeEventName]: {
          ...(current[activeEventName] || {}),
          [activeEventDate]: mode,
        },
      }));
      clearSelection();
      setCandidateNumberSortDirection(null);
      if (mode !== "focus") setFocusModeMapVisible(false);
      closeUiSettingsPanel();
      if (scrollToItemId) scheduleCenteredItemScroll(scrollToItemId);
    },
    [
      activeEventDate,
      activeEventName,
      clearSelection,
      closeUiSettingsPanel,
      scheduleCenteredItemScroll,
      setCandidateNumberSortDirection,
      setDayModes,
      setFocusModeMapVisible,
    ],
  );

  const selectItem = useCallback(
    (
      itemId: string,
      _columnType: "execute" | "candidate" | undefined,
      presentation: RangePresentation,
    ) => selectItemForRange(itemId, presentation),
    [selectItemForRange],
  );

  const selectSpaceGroup = useCallback(
    (
      groupKey: string,
      allItemIds: readonly string[],
      presentation: RangePresentation,
    ) => selectSpaceGroupForRange(groupKey, allItemIds, presentation),
    [selectSpaceGroupForRange],
  );

  const toggleItemsSelection = useCallback(
    (itemIds: readonly string[]) => toggleRangeItemIdsSelection(itemIds),
    [toggleRangeItemIdsSelection],
  );

  const setSpaceGroupDragItemIds = useCallback(
    (itemIds: readonly string[] | null) => {
      spaceGroupDragItemIdsRef.current = itemIds;
    },
    [spaceGroupDragItemIdsRef],
  );

  const changeBulkStatus = useCallback(
    (
      groupKey: string,
      targetStatus: PurchaseStatus,
      groupItems: ShoppingItem[],
    ) => {
      if (!activeEventName) return;
      const allAlready = groupItems.every(
        (item) => item.purchaseStatus === targetStatus,
      );
      const nextStatus: PurchaseStatus = allAlready ? "None" : targetStatus;
      const groupItemIds = new Set(groupItems.map((item) => item.id));

      setEventLists((current) => ({
        ...current,
        [activeEventName]: (current[activeEventName] || []).map((item) => {
          if (!groupItemIds.has(item.id)) return item;
          if (
            targetStatus === "LimitedPurchase" ||
            item.purchaseStatus === "LimitedPurchase"
          ) {
            return item;
          }
          return clearLimitedPurchase({ ...item, purchaseStatus: nextStatus });
        }),
      }));
      setRecentlyChangedItemIds((currentIds) => {
        const next = new Set(currentIds);
        groupItems.forEach((item) => next.add(item.id));
        return next;
      });

      const groupOrder = executeSpaceGroupOrderRef.current;
      const isLastGroup =
        groupOrder.length > 0 && groupKey === groupOrder[groupOrder.length - 1];
      if (!isLastGroup || nextStatus === "None") return;

      const currentItems = executeColumnItemsRef.current;
      if (sortState === "Manual") {
        const allNonNone = currentItems.every(
          (item) => groupItemIds.has(item.id) || item.purchaseStatus !== "None",
        );
        if (allNonNone) setShowPostponeFilterButton(true);
      }

      if (sortState === "Postpone") {
        const recentIds = recentlyChangedItemIdsRef.current;
        const allVisibleNonNone = currentItems.every((item) => {
          if (groupItemIds.has(item.id)) return true;
          if (item.purchaseStatus !== "Postpone" && !recentIds.has(item.id)) {
            return true;
          }
          return item.purchaseStatus !== "None";
        });
        if (allVisibleNonNone) setShowLateFilterButton(true);
      }
    },
    [
      activeEventName,
      setEventLists,
      setRecentlyChangedItemIds,
      setShowLateFilterButton,
      setShowPostponeFilterButton,
      sortState,
    ],
  );

  const updateExecuteItem = useCallback(
    (updatedItem: ShoppingItem) => {
      updateItem(updatedItem);
      if (sortState !== "Manual" && sortState !== "Postpone") return;
      if (updatedItem.purchaseStatus === "None") return;

      const groupOrder = executeSpaceGroupOrderRef.current;
      if (groupOrder.length === 0) return;
      const lastGroupKey = groupOrder[groupOrder.length - 1];
      if (buildSpacePriorityGroupKey(updatedItem) !== lastGroupKey) return;

      const currentItems = executeColumnItemsRef.current;
      if (sortState === "Manual") {
        const lastGroupItems = currentItems.filter(
          (item) => buildSpacePriorityGroupKey(item) === lastGroupKey,
        );
        if (lastGroupItems[lastGroupItems.length - 1]?.id !== updatedItem.id) {
          return;
        }
        const allNonNone = currentItems.every(
          (item) =>
            item.id === updatedItem.id || item.purchaseStatus !== "None",
        );
        if (allNonNone) setShowPostponeFilterButton(true);
        return;
      }

      const recentIds = recentlyChangedItemIdsRef.current;
      const visibleLastGroupItems = currentItems.filter((item) => {
        if (buildSpacePriorityGroupKey(item) !== lastGroupKey) return false;
        return item.purchaseStatus === "Postpone" || recentIds.has(item.id);
      });
      if (
        visibleLastGroupItems[visibleLastGroupItems.length - 1]?.id !==
        updatedItem.id
      ) {
        return;
      }
      const allVisibleNonNone = currentItems.every((item) => {
        if (item.id === updatedItem.id) return true;
        if (item.purchaseStatus !== "Postpone" && !recentIds.has(item.id)) {
          return true;
        }
        return item.purchaseStatus !== "None";
      });
      if (allVisibleNonNone) setShowLateFilterButton(true);
    },
    [
      setShowLateFilterButton,
      setShowPostponeFilterButton,
      sortState,
      updateItem,
    ],
  );

  const activatePostponeFilter = useCallback(() => {
    setRecentlyChangedItemIds(new Set());
    setSortState("Postpone");
    setShowPostponeFilterButton(false);
  }, [setRecentlyChangedItemIds, setShowPostponeFilterButton, setSortState]);

  const activateLateFilter = useCallback(() => {
    setRecentlyChangedItemIds(new Set());
    setSortState("Late");
    setShowLateFilterButton(false);
  }, [setRecentlyChangedItemIds, setShowLateFilterButton, setSortState]);

  const setExecuteSpaceGroupOrder = useCallback(
    (orderedGroupKeys: readonly string[]) => {
      executeSpaceGroupOrderRef.current = [...orderedGroupKeys];
    },
    [],
  );

  const collapseAndOpenNext = useCallback(
    (currentGroupKey: string) => {
      clearRangeSelection();
      const order = executeSpaceGroupOrderRef.current;
      const currentIndex = order.indexOf(currentGroupKey);
      const nextKey =
        currentIndex >= 0 && currentIndex < order.length - 1
          ? order[currentIndex + 1]
          : null;
      setExecuteCollapsedSpaces((current) => {
        const next = new Set(current);
        next.add(currentGroupKey);
        if (nextKey) next.delete(nextKey);
        return next;
      });
    },
    [clearRangeSelection, setExecuteCollapsedSpaces],
  );

  const sortSelectedItems = useCallback(
    (direction: BulkSortDirection) => {
      if (!activeEventName || selectedItemIds.size === 0) return;
      clearRangeSelection();
      setSortState("Manual");
      setBlockSortDirection(null);

      const mode = dayModes[activeEventName]?.[activeEventDate];
      if (mode === "edit") {
        const executeIds = new Set(
          executeModeItemsRef.current[activeEventName]?.[activeEventDate] || [],
        );
        const selectedItems = items.filter((item) =>
          selectedItemIds.has(item.id),
        );
        const isInExecuteColumn = selectedItems.some((item) =>
          executeIds.has(item.id),
        );
        const isInCandidateColumn = selectedItems.some(
          (item) => !executeIds.has(item.id),
        );

        if (isInExecuteColumn && !isInCandidateColumn) {
          updateExecuteModeItems((current) => {
            const eventItems = current[activeEventName] || {};
            const dayItems = [...(eventItems[activeEventDate] || [])];
            const itemsMap = new Map(items.map((item) => [item.id, item]));
            const selectedVisitKeys = new Set(
              dayItems.flatMap((itemId) => {
                if (!selectedItemIds.has(itemId)) return [];
                const selectedItem = itemsMap.get(itemId);
                return selectedItem
                  ? [buildExecutionVisitProjectionKey(selectedItem)]
                  : [];
              }),
            );
            const selectedVisitBlocks = new Map<string, ShoppingItem[]>();
            dayItems.forEach((itemId) => {
              const item = itemsMap.get(itemId);
              if (!item) return;
              const visitKey = buildExecutionVisitProjectionKey(item);
              if (!selectedVisitKeys.has(visitKey)) return;
              const visitItems = selectedVisitBlocks.get(visitKey);
              if (visitItems) {
                visitItems.push(item);
              } else {
                selectedVisitBlocks.set(visitKey, [item]);
              }
            });
            const sortedSelectedVisitBlocks = Array.from(
              selectedVisitBlocks.values(),
            ).sort((firstVisit, secondVisit) => {
              const comparison = firstVisit[0].number.localeCompare(
                secondVisit[0].number,
                undefined,
                { numeric: true, sensitivity: "base" },
              );
              return direction === "asc" ? comparison : -comparison;
            });
            const selectedVisitMemberIds = new Set(
              sortedSelectedVisitBlocks.flatMap((visitItems) =>
                visitItems.map((item) => item.id),
              ),
            );
            const firstSelectedIndex = dayItems.findIndex((itemId) =>
              selectedVisitMemberIds.has(itemId),
            );
            if (firstSelectedIndex === -1) return current;
            const nextDayItems = dayItems.filter(
              (itemId) => !selectedVisitMemberIds.has(itemId),
            );
            nextDayItems.splice(
              firstSelectedIndex,
              0,
              ...sortedSelectedVisitBlocks.flatMap((visitItems) =>
                visitItems.map((item) => item.id),
              ),
            );
            return {
              ...current,
              [activeEventName]: {
                ...eventItems,
                [activeEventDate]: nextDayItems,
              },
            };
          });
          return;
        }

        if (isInCandidateColumn && !isInExecuteColumn) {
          setEventLists((current) => {
            const allItems = [...(current[activeEventName] || [])];
            const candidateItems = allItems.filter(
              (item) =>
                isSameExecutionVisitDay(item.eventDate, activeEventDate) &&
                !executeIds.has(item.id),
            );
            const selectedCandidateItems = candidateItems
              .filter((item) => selectedItemIds.has(item.id))
              .sort((first, second) => {
                const comparison = first.number.localeCompare(
                  second.number,
                  undefined,
                  { numeric: true, sensitivity: "base" },
                );
                return direction === "asc" ? comparison : -comparison;
              });
            const firstSelectedIndex = candidateItems.findIndex((item) =>
              selectedItemIds.has(item.id),
            );
            if (firstSelectedIndex === -1) return current;
            const sortedCandidateItems = candidateItems.filter(
              (item) => !selectedItemIds.has(item.id),
            );
            sortedCandidateItems.splice(
              firstSelectedIndex,
              0,
              ...selectedCandidateItems,
            );
            const executeItems = allItems.filter(
              (item) =>
                isSameExecutionVisitDay(item.eventDate, activeEventDate) &&
                executeIds.has(item.id),
            );
            return {
              ...current,
              [activeEventName]: allItems.map((item) => {
                if (!isSameExecutionVisitDay(item.eventDate, activeEventDate)) {
                  return item;
                }
                return executeIds.has(item.id)
                  ? executeItems.shift() || item
                  : sortedCandidateItems.shift() || item;
              }),
            };
          });
        }
        return;
      }

      setEventLists((current) => {
        const currentItems = [...(current[activeEventName] || [])];
        const selectedItems = currentItems
          .filter((item) => selectedItemIds.has(item.id))
          .sort((first, second) => {
            const comparison = first.number.localeCompare(
              second.number,
              undefined,
              { numeric: true, sensitivity: "base" },
            );
            return direction === "asc" ? comparison : -comparison;
          });
        const firstSelectedIndex = currentItems.findIndex((item) =>
          selectedItemIds.has(item.id),
        );
        if (firstSelectedIndex === -1) return current;
        const nextItems = currentItems.filter(
          (item) => !selectedItemIds.has(item.id),
        );
        nextItems.splice(firstSelectedIndex, 0, ...selectedItems);
        return { ...current, [activeEventName]: nextItems };
      });
    },
    [
      activeEventDate,
      activeEventName,
      clearRangeSelection,
      dayModes,
      executeModeItemsRef,
      items,
      selectedItemIds,
      setBlockSortDirection,
      setEventLists,
      setSortState,
      updateExecuteModeItems,
    ],
  );

  return {
    toggleMode,
    setViewMode,
    selectItem,
    selectSpaceGroup,
    toggleItemsSelection,
    clearSelection,
    setSpaceGroupDragItemIds,
    changeBulkStatus,
    updateExecuteItem,
    activatePostponeFilter,
    activateLateFilter,
    setExecuteSpaceGroupOrder,
    collapseAndOpenNext,
    sortSelectedItems,
  };
};
