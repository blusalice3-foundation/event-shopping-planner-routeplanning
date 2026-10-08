import {
  type ExecuteColumnItemsSelectorInput,
  type BaseFilteredItemsSelectorInput,
  type TemporaryVisibleItemsSelectorInput,
  type VisibleItemsSelectorInput,
  type CandidateColumnItemsSelectorInput,
  type DuplicateCircleItemsSelectorInput,
  type BlockOptionsSelectorInput,
  type SearchMatchesSelectorInput,
  type MovePlanStateSelectorInput,
  selectCandidateColumnItems,
  selectDuplicateCircleItemIds,
  selectBlockOptions,
  selectMovePlanState,
} from "./appListViewSelectors";
import {
  createFilteredItemsProjector,
  createItemProjection,
  createItemValueProjector,
  createOrderedItemsProjector,
  changedSetMembers,
} from "../../utils/incrementalItems";
import { itemPositions, stableItemIds } from "../../utils/itemIndex";
import {
  flattenExecutionVisitProjection,
  normalizeExecutionVisitDay,
} from "../../utils/visitProjection";
import { matchesPurchaseStatusFilter } from "../../utils/purchaseQuantity";
import type { ShoppingItem } from "../../types/item";

const EMPTY_IDS: readonly string[] = [];
const hasPriorityRemark = (item: ShoppingItem) =>
  item.remarks.includes("優先") || item.remarks.includes("委託無");

/** Stateful projectors belong to one mounted application, never a global store. */
export function createAppListViewProjectors() {
  const executeOrder = createOrderedItemsProjector();
  const executeVisits = createItemProjection(flattenExecutionVisitProjection);
  const dayItems = createFilteredItemsProjector();
  const baseItems = createFilteredItemsProjector();
  const temporaryItems = createFilteredItemsProjector();
  const visibleItems = createFilteredItemsProjector();
  const candidateItems = createFilteredItemsProjector();
  let candidateInput: CandidateColumnItemsSelectorInput;
  const candidateOrder = createItemProjection((items) =>
    selectCandidateColumnItems({ ...candidateInput, currentTabItems: items }),
  );
  const duplicates = createItemValueProjector<Set<string>>();
  const blocks =
    createItemValueProjector<ReturnType<typeof selectBlockOptions>>();
  const searchItems = createFilteredItemsProjector();
  const movePlan =
    createItemValueProjector<ReturnType<typeof selectMovePlanState>>();
  let recentIds: ReadonlySet<string> | undefined;
  let temporaryIds: ReadonlySet<string> | undefined;
  return {
    execute(input: ExecuteColumnItemsSelectorInput) {
      const ids = input.activeEventName
        ? (input.executeModeItems[input.activeEventName]?.[
            input.activeEventDate
          ] ?? EMPTY_IDS)
        : EMPTY_IDS;
      return executeVisits(executeOrder(input.items, ids));
    },
    day(items: readonly ShoppingItem[], day: string, enabled: boolean) {
      const normalized = normalizeExecutionVisitDay(day);
      return dayItems(
        items,
        (item) =>
          enabled && normalizeExecutionVisitDay(item.eventDate) === normalized,
        [normalized, enabled],
      );
    },
    base(input: BaseFilteredItemsSelectorInput) {
      const mode = input.activeEventName
        ? input.dayModes[input.activeEventName]?.[input.activeEventDate]
        : undefined;
      if (mode !== "execute") return input.currentTabItems;
      if (input.sortState === "Manual") return input.executeColumnItems;
      const status = input.sortState;
      return baseItems(
        input.executeColumnItems,
        (item) => matchesPurchaseStatusFilter(item, status),
        [status],
      );
    },
    temporary(input: TemporaryVisibleItemsSelectorInput) {
      const reconsider = changedSetMembers(
        recentIds,
        input.recentlyChangedItemIds,
      );
      recentIds = input.recentlyChangedItemIds;
      const mode = input.activeEventName
        ? input.dayModes[input.activeEventName]?.[input.activeEventDate]
        : undefined;
      const base = itemPositions(input.baseFilteredItems);
      return temporaryItems(
        input.executeColumnItems,
        (item) =>
          mode === "execute" &&
          input.sortState !== "Manual" &&
          input.recentlyChangedItemIds.has(item.id) &&
          !base.has(item.id),
        [mode, input.sortState],
        reconsider,
      );
    },
    visible(input: VisibleItemsSelectorInput) {
      const mode = input.activeEventName
        ? input.dayModes[input.activeEventName]?.[input.activeEventDate]
        : undefined;
      if (mode !== "execute") return { visibleItems: input.baseFilteredItems };
      if (input.sortState === "Manual")
        return { visibleItems: input.executeColumnItems as ShoppingItem[] };
      const base = itemPositions(input.baseFilteredItems);
      const temporary = new Set(stableItemIds(input.temporaryVisibleItems));
      const reconsider = changedSetMembers(temporaryIds, temporary);
      temporaryIds = temporary;
      return {
        visibleItems: visibleItems(
          input.executeColumnItems,
          (item) => base.has(item.id) || temporary.has(item.id),
          [mode, input.sortState],
          reconsider,
        ),
      };
    },
    candidate(input: CandidateColumnItemsSelectorInput) {
      candidateInput = input;
      const ids = input.activeEventName
        ? (input.executeModeItems[input.activeEventName]?.[
            input.activeEventDate
          ] ?? EMPTY_IDS)
        : EMPTY_IDS;
      const execute = new Set(ids);
      const filtered = candidateItems(
        input.currentTabItems,
        (item) =>
          !!input.activeEventName &&
          !execute.has(item.id) &&
          (!input.selectedBlockFilters.size ||
            input.selectedBlockFilters.has(item.block)),
        [input.activeEventName, ids, input.selectedBlockFilters],
      );
      return candidateOrder(filtered, [input.candidateNumberSortDirection]);
    },
    duplicates(input: DuplicateCircleItemsSelectorInput) {
      return duplicates(
        input.currentTabItems,
        [
          input.activeEventName,
          input.activeTab,
          input.eventDates.includes(input.activeTab),
        ],
        (before, after) => before.circle !== after.circle,
        () => selectDuplicateCircleItemIds(input),
      );
    },
    blocks(input: BlockOptionsSelectorInput) {
      const ids = input.activeEventName
        ? input.executeModeItems[input.activeEventName]?.[input.activeEventDate]
        : undefined;
      return blocks(
        input.currentTabItems,
        [input.activeEventName, input.activeEventDate, ids],
        (before, after) =>
          before.block !== after.block ||
          hasPriorityRemark(before) !== hasPriorityRemark(after),
        () => selectBlockOptions(input),
      );
    },
    search(input: SearchMatchesSelectorInput) {
      const keyword = input.searchKeyword.trim().toLowerCase();
      if (
        !keyword ||
        !input.activeEventName ||
        !input.eventDates.includes(input.activeTab)
      )
        return EMPTY_IDS as string[];
      const result = searchItems(
        input.currentTabItems,
        (item) =>
          [item.circle, item.title, item.remarks].some((field) =>
            field.toLowerCase().includes(keyword),
          ),
        [keyword, input.activeEventName, input.activeTab],
      );
      return stableItemIds(result) as string[];
    },
    movePlan(input: MovePlanStateSelectorInput) {
      return movePlan(
        input.items,
        [
          input.activeEventName,
          input.activeEventDate,
          input.currentMode,
          input.executeModeItems,
          input.selectedItemIds,
        ],
        (before, after) =>
          before.block !== after.block ||
          before.number !== after.number ||
          before.eventDate !== after.eventDate ||
          before.priorityLevel !== after.priorityLevel ||
          before.manualHallId !== after.manualHallId,
        () => selectMovePlanState(input),
      );
    },
  };
}
