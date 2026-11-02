import {
  inheritProjectedMembership,
  projectedMembership,
} from "../../features/consistency/domain/projection";
import {
  beginShoppingMoveLifecycle,
  endShoppingMoveLifecycle,
  recordShoppingMovePlanReady,
} from "../../utils/shoppingPerformance";
import type { ShoppingDragMoveContext } from "../../features/shopping-list/drag/shoppingDrag";
import { existingDayKey } from "../../features/consistency/domain/context";
import { bulkImportFailureStatus } from "../../utils/importOutcome";
import { itemUpdateGuard } from "../../utils/itemContentGuard";
import type { BulkImportResult } from "../../types/import";
import { ownValue, recordEntry } from "../../utils/ownRecord";
import {
  itemUpdateBaseline,
  itemExplicitFields,
  itemLimitedPurchaseIntent,
} from "../../utils/itemUpdateBaseline";
import { useCallback, useLayoutEffect, useRef } from "react";
import { selectCurrentMode } from "../selectors/appMapViewSelectors";
import type { UpdateItemFieldsInput } from "../state/itemFieldMutation";
import { editableItemContentFields } from "../state/itemContentEdits";
import { applyChangedFields } from "../../features/consistency/domain/mutations";
import type { AppNavigationCommands } from "../navigation";
import type {
  DayModeState,
  EventMetadata,
  ExecuteModeItems,
  ShoppingItem,
  ViewMode,
} from "../../types/item";
import type {
  BlockSortDirection,
  SortState,
} from "../../features/app-shell/types";
import type { PendingDuplicateEventImport } from "../state/appOverlayTypes";
import {
  buildBulkAddEventMetadata,
  buildBulkAddItems,
  buildBulkAddUiPlan,
  buildInitialDayModesForBulkAdd,
  buildInitialExecuteItemsForBulkAdd,
  buildLayoutAppliedEventItems,
  hasBulkAddLayoutInfo,
  type BulkAddMetadata,
} from "../../features/events/bulkAdd";
import { analyzeDuplicateEventImport } from "../../features/events/duplicateEvent";
import {
  computeDeleteItem,
  computeMoveItem,
  computeMoveItemVertical,
  computeMoveToExecuteColumnWithResult,
  computeRemoveFromExecuteColumn,
  computeUpdateItem,
  repositionExecuteItemAfterIdentityChangeWithResult,
} from "../../features/events/itemOps";
import {
  buildMovePlan,
  getCandidateSourceOrderedIds,
} from "../../features/lists/domain/movePlan";
import { getSpaceKey } from "../../utils/spaceGrouping";
import {
  buildExecutionPlacementVisitKey,
  isSameExecutionPlacementGroup,
} from "../../utils/executionPlacement";
import {
  EXECUTION_VISIT_MERGE_NOTICE,
  buildExecutionVisitProjectionKey,
  normalizeExecutionVisitDay,
} from "../../utils/visitProjection";
import type {
  ApplicationSnapshotCommitPort,
  QueueShoppingMovePatch,
} from "./ApplicationSnapshotCommitPort";
import type { EventUpdateOperationRegistry } from "./eventUpdateOperation";

type EventLists = Record<string, ShoppingItem[]>;
type ExecuteModeItemsByEvent = Record<string, ExecuteModeItems>;
type DayModesByEvent = Record<string, DayModeState>;
type StateUpdater<T> = (current: T) => T;

const isSameExecutionVisitDay = (eventDate: string, dayName: string): boolean =>
  normalizeExecutionVisitDay(eventDate) === normalizeExecutionVisitDay(dayName);

export interface MutableCommandValue<T> {
  current: T;
}

export interface ShoppingItemMutationStatePort {
  getEventGeneration?: (eventName: string) => number;
  readonly activeEventName: string | null;
  readonly activeEventDate: string;
  readonly eventLists: EventLists;
  readonly eventListsRef: MutableCommandValue<EventLists>;
  readonly eventMetadata: Record<string, EventMetadata>;
  readonly dayModes: DayModesByEvent;
  readonly items: ShoppingItem[];
  readonly selectedItemIds: ReadonlySet<string>;
  readonly getSelectionRevision?: () => number;
  readonly selectedBlockFilters: ReadonlySet<string>;
  readonly blockSortDirection: BlockSortDirection | null;
  readonly candidateNumberSortDirection: BlockSortDirection | null;
  readonly itemToDelete: ShoppingItem | null;
  readonly executeModeItemsRef: MutableCommandValue<ExecuteModeItemsByEvent>;
  readonly spaceGroupDragItemIdsRef: MutableCommandValue<
    readonly string[] | null
  >;
  readonly eventUpdatePreviewEpochRef: MutableCommandValue<number>;
  readonly eventUpdateOperationsRef?: MutableCommandValue<EventUpdateOperationRegistry>;
}

import { indexedItem } from "../../utils/itemIndex";
import { useStableCallback } from "../../hooks/useStableCallback";

export interface ShoppingItemMutationActionPort {
  updateItemFields?(
    input: UpdateItemFieldsInput | readonly UpdateItemFieldsInput[],
  ): void;
  setEventLists(updater: StateUpdater<EventLists>): void;
  setEventMetadata(updater: StateUpdater<Record<string, EventMetadata>>): void;
  setDayModes(updater: StateUpdater<DayModesByEvent>): void;
  updateExecuteModeItems(updater: StateUpdater<ExecuteModeItemsByEvent>): void;
  setRecentlyChangedItemIds(updater: StateUpdater<Set<string>>): void;
  openDuplicateEvent(value: PendingDuplicateEventImport): string | void;
  clearRangeSelection(): void;
  clearSelection(): void;
  removeSelectedItemIds(itemIds: readonly string[]): void;
  captureSelectionConsumption?(itemIds: readonly string[]): {
    consume(): void;
    release(): void;
  };
  queueShoppingMovePatch: QueueShoppingMovePatch;
  setSortState(value: Extract<SortState, "Manual">): void;
  setBlockSortDirection(value: BlockSortDirection | null): void;
  setCandidateNumberSortDirection(value: BlockSortDirection | null): void;
  confirmItemDelete(): void;
  readonly navigation: Pick<AppNavigationCommands, "openEvent" | "showImport">;
}

export interface ShoppingItemMutationSelectorPort {
  areItemsInSameHall(
    firstItemId: string,
    secondItemId: string,
    eventDate: string,
  ): boolean;
  areItemsInSameHallGroup(
    firstItemId: string,
    secondItemId: string,
    eventDate: string,
  ): boolean;
}

export interface ShoppingItemMutationAlertPort {
  notify(message: string): void;
  placementRejected?(message: string): void;
}

export interface ShoppingItemMutationCommandPorts {
  readonly state: ShoppingItemMutationStatePort;
  readonly actions: ShoppingItemMutationActionPort;
  readonly selectors: ShoppingItemMutationSelectorPort;
  readonly alerts: ShoppingItemMutationAlertPort;
  readonly persistence: ApplicationSnapshotCommitPort;
}

export type BulkAddItemInput = Omit<ShoppingItem, "id" | "purchaseStatus">;
export type ShoppingListColumn = "execute" | "candidate";

export interface ShoppingItemMutationCommands {
  applyBulkAdd(
    eventName: string,
    newItemsData: BulkAddItemInput[],
    metadata?: BulkAddMetadata,
  ): Promise<BulkImportResult>;
  handleBulkAdd(
    eventName: string,
    newItemsData: BulkAddItemInput[],
    metadata?: BulkAddMetadata,
  ): Promise<BulkImportResult>;
  updateItem(
    updatedItem: ShoppingItem,
    baseline?: ShoppingItem,
    options?: { saveImmediately?: boolean },
  ): void;
  updateItems(
    items: readonly ShoppingItem[],
    options?: { saveImmediately?: boolean },
  ): void;
  moveItem(
    dragId: string,
    hoverId: string,
    targetColumn?: ShoppingListColumn,
    sourceColumn?: ShoppingListColumn,
    dragContext?: ShoppingDragMoveContext,
  ): void;
  moveItemUp(itemId: string, targetColumn?: ShoppingListColumn): void;
  moveItemDown(itemId: string, targetColumn?: ShoppingListColumn): void;
  moveToExecuteColumn(itemIds: string[]): void;
  removeFromExecuteColumn(itemIds: string[]): void;
  confirmDeleteItem(): void;
  toggleBlockSort(): void;
  toggleCandidateBlockSort(): void;
  toggleCandidateNumberSort(): void;
}

const moveExecuteSpacePriorityGroup = ({
  direction,
  itemId,
  dayItems,
  items,
  effectiveIds,
  areBoundaryItemsInSameHall,
}: {
  direction: "up" | "down";
  itemId: string;
  dayItems: readonly string[];
  items: readonly ShoppingItem[];
  effectiveIds: ReadonlySet<string>;
  areBoundaryItemsInSameHall: (firstId: string, secondId: string) => boolean;
}): { handled: boolean; reordered?: string[] } => {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const source = itemsById.get(itemId);
  if (!source) return { handled: true };
  const sourceMembership = projectedMembership(source);
  const isInPlacementGroup = (item: ShoppingItem): boolean =>
    sourceMembership && projectedMembership(item)
      ? isSameExecutionPlacementGroup(source, item)
      : areBoundaryItemsInSameHall(itemId, item.id);
  if (!isInPlacementGroup(source)) return { handled: true };
  const getVisitKey = (id: string): string => {
    const item = itemsById.get(id);
    return item ? buildExecutionPlacementVisitKey(item) : `unknown:${id}`;
  };
  const movingGroupKeys = new Set<string>([getVisitKey(itemId)]);
  for (const id of effectiveIds) {
    if (!dayItems.includes(id)) continue;
    const item = itemsById.get(id);
    if (!item || !isInPlacementGroup(item)) return { handled: true };
    movingGroupKeys.add(getVisitKey(id));
  }

  const visitGroups: Array<{ key: string; itemIds: string[] }> = [];
  const visitGroupsByKey = new Map<
    string,
    { key: string; itemIds: string[] }
  >();
  dayItems.forEach((id) => {
    const item = itemsById.get(id);
    if (!item || !isInPlacementGroup(item)) return;
    const key = getVisitKey(id);
    const existing = visitGroupsByKey.get(key);
    if (existing) {
      existing.itemIds.push(id);
      return;
    }
    const group = { key, itemIds: [id] };
    visitGroupsByKey.set(key, group);
    visitGroups.push(group);
  });

  const movingIndices = visitGroups
    .map((group, index) => (movingGroupKeys.has(group.key) ? index : -1))
    .filter((index) => index >= 0);
  if (movingIndices.length === 0) return { handled: true };

  const adjacentIndex =
    direction === "up"
      ? movingIndices[0] - 1
      : movingIndices[movingIndices.length - 1] + 1;
  const adjacentGroup = visitGroups[adjacentIndex];
  if (!adjacentGroup || movingGroupKeys.has(adjacentGroup.key)) {
    return { handled: true };
  }
  const boundaryMovingIndex =
    direction === "up" ? movingIndices[0] : movingIndices.at(-1)!;
  const boundaryMovingGroup = visitGroups[boundaryMovingIndex];
  if (
    !boundaryMovingGroup ||
    !areBoundaryItemsInSameHall(
      boundaryMovingGroup.itemIds[0],
      adjacentGroup.itemIds[0],
    )
  ) {
    return { handled: true };
  }

  const movingGroups = visitGroups.filter((group) =>
    movingGroupKeys.has(group.key),
  );
  if (
    movingGroups.some(
      (group) =>
        !areBoundaryItemsInSameHall(group.itemIds[0], adjacentGroup.itemIds[0]),
    )
  )
    return { handled: true };
  const remainingGroups = visitGroups.filter(
    (group) => !movingGroupKeys.has(group.key),
  );
  const remainingAdjacentIndex = remainingGroups.findIndex(
    (group) => group.key === adjacentGroup.key,
  );
  if (remainingAdjacentIndex < 0) return { handled: true };

  const insertIndex =
    direction === "up" ? remainingAdjacentIndex : remainingAdjacentIndex + 1;
  const movingIds = movingGroups.flatMap((group) => group.itemIds);
  const movingSet = new Set(movingIds);
  const remainingIds = dayItems.filter((id) => !movingSet.has(id));
  const nextVisit = remainingGroups[insertIndex];
  let rawInsertIndex: number;
  if (nextVisit) rawInsertIndex = remainingIds.indexOf(nextVisit.itemIds[0]);
  else {
    const remainingGroupIds = new Set(
      remainingGroups.flatMap((group) => group.itemIds),
    );
    rawInsertIndex = remainingIds.length;
    for (let index = remainingIds.length - 1; index >= 0; index--) {
      if (remainingGroupIds.has(remainingIds[index])) {
        rawInsertIndex = index + 1;
        break;
      }
    }
  }
  // Move only the selected visits so frozen save replay retains every other raw ID.
  remainingIds.splice(rawInsertIndex, 0, ...movingIds);
  return { handled: true, reordered: remainingIds };
};

export const useShoppingItemMutationCommands = ({
  state,
  actions,
  selectors,
  alerts,
  persistence,
}: ShoppingItemMutationCommandPorts): ShoppingItemMutationCommands => {
  const {
    activeEventName,
    activeEventDate,
    getEventGeneration,
    eventLists,
    eventListsRef,
    eventMetadata,
    dayModes,
    selectedItemIds,
    selectedBlockFilters,
    blockSortDirection,
    candidateNumberSortDirection,
    itemToDelete,
    executeModeItemsRef,
    spaceGroupDragItemIdsRef,
    eventUpdatePreviewEpochRef,
  } = state;
  const reorderContextRef = useRef({
    activeEventName,
    activeEventDate,
    dayModes,
  });
  useLayoutEffect(() => {
    reorderContextRef.current = { activeEventName, activeEventDate, dayModes };
  }, [activeEventName, activeEventDate, dayModes]);
  const {
    setEventLists,
    updateItemFields,
    updateExecuteModeItems,
    setRecentlyChangedItemIds,
    openDuplicateEvent,
    clearRangeSelection,
    clearSelection,
    removeSelectedItemIds,
    captureSelectionConsumption,
    queueShoppingMovePatch,
    setSortState,
    setBlockSortDirection,
    setCandidateNumberSortDirection,
    confirmItemDelete,
    navigation,
  } = actions;
  const { areItemsInSameHall, areItemsInSameHallGroup } = selectors;
  const { notify } = alerts;
  const placementRejected = alerts.placementRejected ?? notify;
  const selectionRevisionReader = useRef(state.getSelectionRevision);
  selectionRevisionReader.current = state.getSelectionRevision;
  const selectionRef = useRef({ ids: selectedItemIds, revision: 0 });
  if (selectionRef.current.ids !== selectedItemIds)
    selectionRef.current = {
      ids: selectedItemIds,
      revision: selectionRef.current.revision + 1,
    };
  const { commitApplicationSnapshotPatch } = persistence;

  const applyBulkAdd = useCallback(
    async (
      eventName: string,
      newItemsData: BulkAddItemInput[],
      metadata?: BulkAddMetadata,
    ): Promise<BulkImportResult> => {
      if (metadata?.request?.isCurrent?.() === false)
        return { status: "invalidated" };
      metadata?.request?.progress?.("saving");
      const newItems = buildBulkAddItems(newItemsData, metadata);
      const inputRows = new Map(
        metadata?.sourceRows?.map((row) => [row.item, row.sourceRowId]),
      );
      const sourceRowIds = new Map(
        newItemsData.flatMap((item, index) => {
          const row = inputRows.get(item);
          return row ? [[row, newItems[index].id] as const] : [];
        }),
      );
      const isNewEvent = !ownValue(eventLists, eventName);
      let nextEventLists = eventLists;
      let nextExecuteModeItems = executeModeItemsRef.current;
      let nextEventMetadata = eventMetadata;
      let nextDayModes = dayModes;

      if (hasBulkAddLayoutInfo(metadata) && isNewEvent) {
        const layoutResult = buildLayoutAppliedEventItems(
          newItems,
          metadata.layoutInfo,
          sourceRowIds,
        );
        nextEventLists = {
          ...eventLists,
          [eventName]: layoutResult.sortedItems,
        };
        nextExecuteModeItems = {
          ...executeModeItemsRef.current,
          [eventName]: layoutResult.executeModeItems,
        };
      } else {
        nextEventLists = {
          ...eventLists,
          [eventName]: [
            ...(ownValue(eventLists, eventName) || []),
            ...newItems,
          ],
        };
      }

      const nextMetadata = buildBulkAddEventMetadata(metadata);
      if (nextMetadata) {
        nextEventMetadata = {
          ...eventMetadata,
          [eventName]: nextMetadata,
        };
      }

      if (isNewEvent) {
        const initialDayModes = buildInitialDayModesForBulkAdd(newItems);
        nextDayModes = {
          ...dayModes,
          [eventName]: initialDayModes,
        };

        if (!hasBulkAddLayoutInfo(metadata)) {
          const initialExecuteItems =
            buildInitialExecuteItemsForBulkAdd(newItems);
          nextExecuteModeItems = {
            ...executeModeItemsRef.current,
            [eventName]: initialExecuteItems,
          };
        }
      }

      try {
        await commitApplicationSnapshotPatch(
          {
            eventLists: nextEventLists,
            eventMetadata: nextEventMetadata,
            executeModeItems: nextExecuteModeItems,
            dayModes: nextDayModes,
          },
          undefined,
          undefined,
          metadata?.request?.isCurrent
            ? () => {
                if (metadata.request?.isCurrent?.() === false)
                  throw Object.assign(
                    new Error(
                      "取込み元の入力が変更されたため、保存していません。",
                    ),
                    { name: "BulkImportInvalidated" },
                  );
              }
            : undefined,
        );
      } catch (error) {
        if (error instanceof Error && error.name === "BulkImportInvalidated")
          return { status: "invalidated" };
        const status = bulkImportFailureStatus(error);
        if (status === "committed-ui-failed" || status === "cancelled")
          return { status };
        notify(
          status === "failed"
            ? "イベントを保存できませんでした。表示内容は変更されていません。"
            : "保存結果の確認が必要です。再取込みせず、画面を再読み込みして保存内容を確認してください。",
        );
        return { status };
      }

      if (metadata?.request?.isCurrent?.() === false)
        return { status: "saved", importedItemCount: newItems.length };
      try {
        const uiPlan = buildBulkAddUiPlan(
          eventName,
          newItems,
          isNewEvent,
          ownValue(eventLists, eventName) || [],
        );
        notify(uiPlan.alertMessage);
        if (uiPlan.nextActiveTab) {
          navigation.openEvent(
            uiPlan.nextActiveEventName ?? eventName,
            uiPlan.nextActiveTab,
          );
        } else if (uiPlan.nextActiveEventName) {
          navigation.showImport(uiPlan.nextActiveEventName);
        }
        return { status: "saved", importedItemCount: newItems.length };
      } catch {
        return { status: "committed-ui-failed" };
      }
    },
    [
      eventLists,
      eventMetadata,
      dayModes,
      executeModeItemsRef,
      commitApplicationSnapshotPatch,
      navigation,
      notify,
    ],
  );

  const handleBulkAdd = useCallback(
    (
      eventName: string,
      newItemsData: BulkAddItemInput[],
      metadata?: BulkAddMetadata,
    ): Promise<BulkImportResult> => {
      if (metadata?.request?.isCurrent?.() === false)
        return Promise.resolve({ status: "invalidated" });
      const normalizedEventName = eventName.trim();
      const isExplicitAddToOpenEvent =
        metadata?.source === "app" &&
        activeEventName === normalizedEventName &&
        Object.prototype.hasOwnProperty.call(eventLists, normalizedEventName);

      if (isExplicitAddToOpenEvent) {
        return applyBulkAdd(normalizedEventName, newItemsData, metadata);
      }

      const registry = state.eventUpdateOperationsRef?.current;
      if (registry?.isSaving()) {
        notify(
          "アイテム更新を保存中です。保留中の保存を再試行または取り消してから、次の取込みを開始してください。",
        );
        return Promise.resolve({ status: "invalidated" });
      }
      if (registry?.current) {
        registry.finish(registry.current.id, { status: "invalidated" });
        if (registry.current) return Promise.resolve({ status: "invalidated" });
      }
      eventUpdatePreviewEpochRef.current += 1;

      const analysis = analyzeDuplicateEventImport({
        eventName: normalizedEventName,
        incomingItems: newItemsData,
        incomingSource: metadata?.url
          ? { url: metadata.url, sheetName: metadata.sheetName || "" }
          : null,
        eventLists,
        eventMetadata,
      });
      if (analysis.kind === "create") {
        return applyBulkAdd(
          analysis.eventName,
          analysis.incomingItems,
          metadata,
        );
      }

      metadata?.request?.progress?.("review");
      return new Promise((complete) => {
        const eventGeneration = state.getEventGeneration?.(normalizedEventName);
        const operation = registry?.start({
          eventName: analysis.eventName,
          complete,
          isCurrentInput: metadata?.request?.isCurrent,
          eventGeneration,
          phase: "selection",
        });
        if (registry && !operation) return;
        const requestId = openDuplicateEvent({
          analysis,
          metadata,
          complete,
          eventGeneration,
          ...(operation ? { updateOperationId: operation.id } : {}),
        });
        if (operation && registry?.current === operation) {
          operation.requestId = requestId || undefined;
          operation.ownsUntrackedOverlay = !requestId;
        }
      });
    },
    [
      activeEventName,
      applyBulkAdd,
      eventLists,
      eventMetadata,
      eventUpdatePreviewEpochRef,
      state,
      openDuplicateEvent,
      notify,
    ],
  );

  const fieldCommandBatch = useRef<UpdateItemFieldsInput[] | null>(null);
  const updateItem = useStableCallback(
    (
      updatedItem: ShoppingItem,
      baseline?: ShoppingItem,
      options?: { saveImmediately?: boolean },
    ) => {
      if (!activeEventName) return;
      const currentMode = recordEntry(dayModes, activeEventName)?.[
        activeEventDate
      ];
      const currentItems =
        recordEntry(eventListsRef.current, activeEventName) || [];
      const currentItem = indexedItem(currentItems, updatedItem.id);
      if (!currentItem) return;
      const renderedItem =
        baseline ??
        itemUpdateBaseline(updatedItem) ??
        indexedItem(
          recordEntry(eventLists, activeEventName) ?? [],
          updatedItem.id,
        );
      const intendedItem = renderedItem
        ? (applyChangedFields(
            renderedItem,
            updatedItem,
            currentItem,
          ) as ShoppingItem)
        : updatedItem;
      const forcedFields = itemExplicitFields(updatedItem);
      for (const key of forcedFields) {
        Object.assign(intendedItem, {
          [key]: (updatedItem as unknown as Record<string, unknown>)[key],
        });
      }
      const fieldOnly =
        updateItemFields &&
        [
          ...new Set([
            ...Object.keys(currentItem),
            ...Object.keys(intendedItem),
          ]),
        ].every(
          (key) =>
            editableItemContentFields.has(key) ||
            Object.is(
              (currentItem as unknown as Record<string, unknown>)[key],
              (intendedItem as unknown as Record<string, unknown>)[key],
            ),
        );
      const result = computeUpdateItem(
        fieldOnly ? [currentItem] : currentItems,
        intendedItem,
        currentMode as ViewMode | undefined,
        currentItem?.protectionLevel,
        currentItem?.source,
      );
      const finalUpdatedItem = result.items.find(
        (candidate) => candidate.id === updatedItem.id,
      );

      if (currentItem && finalUpdatedItem)
        inheritProjectedMembership(currentItem, finalUpdatedItem);
      const changes = finalUpdatedItem
        ? Object.fromEntries(
            [
              ...new Set([
                ...Object.keys(currentItem),
                ...Object.keys(finalUpdatedItem),
              ]),
            ]
              .filter(
                (key) =>
                  !Object.is(
                    (currentItem as unknown as Record<string, unknown>)[key],
                    (finalUpdatedItem as unknown as Record<string, unknown>)[
                      key
                    ],
                  ),
              )
              .map((key) => [
                key,
                (finalUpdatedItem as unknown as Record<string, unknown>)[key],
              ]),
          )
        : {};
      if (
        updateItemFields &&
        Object.keys(changes).every((key) => editableItemContentFields.has(key))
      ) {
        const command = {
          eventName: activeEventName,
          itemId: updatedItem.id,
          changes,
          baseline: renderedItem ?? currentItem,
          saveImmediately: options?.saveImmediately,
          guard: itemUpdateGuard(updatedItem),
          limitedPurchase: itemLimitedPurchaseIntent(updatedItem),
        };
        if (fieldCommandBatch.current) fieldCommandBatch.current.push(command);
        else updateItemFields(command);
      } else {
        setEventLists((current) => ({
          ...current,
          [activeEventName]: result.items,
        }));
      }

      if (
        currentItem &&
        finalUpdatedItem &&
        buildExecutionVisitProjectionKey(currentItem) !==
          buildExecutionVisitProjectionKey(finalUpdatedItem)
      ) {
        const currentEventItems =
          recordEntry(executeModeItemsRef.current, activeEventName) || {};
        const repositionResult =
          repositionExecuteItemAfterIdentityChangeWithResult(
            currentEventItems,
            currentItem,
            finalUpdatedItem,
            result.items,
          );
        if (repositionResult.executeModeItems !== currentEventItems) {
          updateExecuteModeItems((currentExecuteItems) => ({
            ...currentExecuteItems,
            [activeEventName]: repositionResult.executeModeItems,
          }));
        }
        if (
          repositionResult.placement === "merged-into-existing-visit" ||
          repositionResult.placement === "mixed"
        ) {
          notify(EXECUTION_VISIT_MERGE_NOTICE);
        }
      }

      if (
        !fieldCommandBatch.current &&
        (result.purchaseStatusChanged || result.purchaseQuantityChanged)
      ) {
        setRecentlyChangedItemIds((currentIds) =>
          new Set(currentIds).add(updatedItem.id),
        );
      }
    },
  );

  const updateItems = useStableCallback(
    (
      updates: readonly ShoppingItem[],
      options?: { saveImmediately?: boolean },
    ) => {
      if (!updateItemFields) {
        updates.forEach((item) => updateItem(item, undefined, options));
        return;
      }
      const commands: UpdateItemFieldsInput[] = [];
      fieldCommandBatch.current = commands;
      try {
        updates.forEach((item) => updateItem(item, undefined, options));
      } finally {
        fieldCommandBatch.current = null;
      }
      if (commands.length) {
        updateItemFields(commands);
        const changedIds = commands
          .filter(
            (command) =>
              "purchaseStatus" in command.changes ||
              "limitedPurchasedQuantity" in command.changes ||
              "quantity" in command.changes,
          )
          .map((command) => command.itemId);
        if (changedIds.length)
          setRecentlyChangedItemIds(
            (current) => new Set([...current, ...changedIds]),
          );
      }
    },
  );
  const moveItem = useCallback(
    (
      dragId: string,
      hoverId: string,
      targetColumn?: ShoppingListColumn,
      sourceColumn?: ShoppingListColumn,
      dragContext?: ShoppingDragMoveContext,
    ) => {
      const latestContext = reorderContextRef.current;
      const mode = selectCurrentMode(latestContext);
      if (
        !activeEventName ||
        latestContext.activeEventName !== activeEventName ||
        latestContext.activeEventDate !== activeEventDate ||
        !recordEntry(eventListsRef.current, activeEventName) ||
        mode !== "edit"
      )
        return;
      const lifecycleScope = beginShoppingMoveLifecycle(
        dragContext?.token,
        dragId,
        sourceColumn,
        targetColumn,
      );
      try {
        if (
          dragContext &&
          (!sourceColumn ||
            !targetColumn ||
            !dragContext.isCurrent() ||
            dragContext.eventName !== activeEventName ||
            dragContext.day !== activeEventDate ||
            (getEventGeneration &&
              dragContext.generation !== getEventGeneration(activeEventName)))
        )
          return;
        const spaceGroupIds = dragContext
          ? dragContext.operation === "space-group"
            ? dragContext.effectiveIds
            : null
          : spaceGroupDragItemIdsRef.current;
        const effectiveSelectedIds = new Set(
          dragContext?.requestedIds ?? spaceGroupIds ?? selectedItemIds,
        );
        if (!dragContext) spaceGroupDragItemIdsRef.current = null;

        const currentEventExecuteItems =
          recordEntry(executeModeItemsRef.current, activeEventName) || {};
        const currentExecuteItems = currentEventExecuteItems[activeEventDate]
          ? {
              ...currentEventExecuteItems,
              [activeEventDate]: [
                ...(currentEventExecuteItems[activeEventDate] || []),
              ],
            }
          : currentEventExecuteItems;

        const selectionSpansMultipleSpaces = (() => {
          if (effectiveSelectedIds.size <= 1) return false;
          const spaceKeys = new Set<string>();
          effectiveSelectedIds.forEach((id) => {
            const selectedItem = (
              recordEntry(eventLists, activeEventName) || []
            ).find((candidate) => candidate.id === id);
            if (selectedItem) {
              spaceKeys.add(
                getSpaceKey(selectedItem.block, selectedItem.number),
              );
            }
          });
          return spaceKeys.size > 1;
        })();
        const hallCheck =
          spaceGroupIds ||
          selectionSpansMultipleSpaces ||
          (dragContext && dragContext.placement?.kind !== "items")
            ? (firstId: string, secondId: string) =>
                areItemsInSameHallGroup(firstId, secondId, activeEventDate)
            : (firstId: string, secondId: string) =>
                areItemsInSameHall(firstId, secondId, activeEventDate);

        const currentAllItems =
          recordEntry(eventListsRef.current, activeEventName) || [];
        const result = computeMoveItem({
          dragId,
          hoverId,
          targetColumn,
          sourceColumn,
          mode: mode as ViewMode | undefined,
          effectiveSelectedIds,
          allItems: currentAllItems,
          executeModeItems: currentExecuteItems,
          dayName: activeEventDate,
          selectedBlockFilters: new Set(selectedBlockFilters),
          areItemsInSameHall: hallCheck,
          dragContext,
        });
        if (dragContext) {
          if (!result.eventListItems && !result.executeModeItems) {
            placementRejected(
              "配置先を確定できなかったため、移動を中止しました。所属・優先度・品目の順序を確認し、もう一度ドラッグしてください。",
            );
            return;
          }
          recordShoppingMovePlanReady();
          const receipt = queueShoppingMovePatch({
            eventName: activeEventName,
            day: activeEventDate,
            eventGeneration: dragContext.generation,
            reorderWithinVisit: dragContext.placement?.kind === "items",
            baselineItemIds: currentAllItems.map((item) => item.id),
            baselineExecuteIds:
              recordEntry(
                currentExecuteItems,
                existingDayKey(currentExecuteItems, activeEventDate) ??
                  activeEventDate,
              ) ?? [],
            sourceColumn: sourceColumn!,
            targetColumn: targetColumn!,
            requestedIds: dragContext.requestedIds,
            effectiveIds: dragContext.effectiveIds,
            hoverId,
            eventListItems: result.eventListItems,
            executeModeItems: result.executeModeItems,
          });
          if (receipt.status === "blocked") {
            placementRejected(receipt.reason);
            return;
          }
          if (receipt.status === "noop") {
            clearRangeSelection();
            return;
          }
          const selectionConsumption = result.transferredItemIds?.length
            ? captureSelectionConsumption?.(result.transferredItemIds)
            : undefined;

          const selectedRevision = selectionRef.current.revision;
          const rangeRevision = selectionRevisionReader.current?.();
          const finishSelection = () => {
            const latest = reorderContextRef.current;
            if (
              latest.activeEventName !== activeEventName ||
              latest.activeEventDate !== activeEventDate ||
              selectCurrentMode(latest) !== "edit"
            )
              return;
            const selectionUnchanged =
              selectionRef.current.revision === selectedRevision &&
              (rangeRevision === undefined ||
                selectionRevisionReader.current?.() === rangeRevision);
            selectionConsumption?.consume();
            if (!selectionUnchanged) return;
            if (!selectionConsumption && result.transferredItemIds)
              removeSelectedItemIds(result.transferredItemIds);
            if (!receipt.completion || rangeRevision !== undefined)
              clearRangeSelection();
            setSortState("Manual");
            setBlockSortDirection(null);
          };
          spaceGroupDragItemIdsRef.current = null;
          if (receipt.completion) {
            void receipt.completion
              .then((completion) => {
                if (completion.status === "aborted")
                  placementRejected(completion.reason);
                else if (completion.status === "committed") finishSelection();
              })
              .finally(() => selectionConsumption?.release());
          } else {
            try {
              finishSelection();
            } finally {
              selectionConsumption?.release();
            }
          }
        }
        if (
          !dragContext &&
          (result.eventListItems || result.executeModeItems)
        ) {
          clearRangeSelection();
          setSortState("Manual");
          setBlockSortDirection(null);
        }
        if (!dragContext && result.eventListItems) {
          setEventLists((current) => ({
            ...current,
            [activeEventName]: result.eventListItems!,
          }));
        }
        if (!dragContext && result.executeModeItems) {
          updateExecuteModeItems((current) => ({
            ...current,
            [activeEventName]: result.executeModeItems!,
          }));
        }
        if (
          result.placement === "merged-into-existing-visit" ||
          result.placement === "mixed"
        ) {
          notify(EXECUTION_VISIT_MERGE_NOTICE);
        }
      } finally {
        endShoppingMoveLifecycle(lifecycleScope);
      }
    },
    [
      activeEventDate,
      activeEventName,
      areItemsInSameHall,
      areItemsInSameHallGroup,
      clearRangeSelection,
      removeSelectedItemIds,
      captureSelectionConsumption,
      queueShoppingMovePatch,
      placementRejected,
      eventLists,
      eventListsRef,
      getEventGeneration,
      executeModeItemsRef,
      selectedBlockFilters,
      selectedItemIds,
      setBlockSortDirection,
      setEventLists,
      setSortState,
      spaceGroupDragItemIdsRef,
      updateExecuteModeItems,
      notify,
    ],
  );

  const queuePlacementButton = useStableCallback(
    (input: {
      sourceColumn: ShoppingListColumn;
      targetColumn: ShoppingListColumn;
      requestedIds: readonly string[];
      effectiveIds: readonly string[];
      allItems: readonly ShoppingItem[];
      currentExecute: ExecuteModeItems;
      eventListItems?: readonly ShoppingItem[];
      executeModeItems?: ExecuteModeItems;
      reorderWithinVisit?: boolean;
      removeTransferredSelection?: boolean;
      mergeNotice?: boolean;
      manualSort?: boolean;
    }) => {
      if (!activeEventName || !input.effectiveIds.length) return;
      const targetDays = input.executeModeItems ?? input.currentExecute;
      const targetExecute =
        recordEntry(
          targetDays,
          existingDayKey(targetDays, activeEventDate) ?? activeEventDate,
        ) ?? [];
      const finalOrder =
        input.targetColumn === "execute"
          ? targetExecute
          : (input.eventListItems ?? input.allItems)
              .filter(
                (item) =>
                  isSameExecutionVisitDay(item.eventDate, activeEventDate) &&
                  !targetExecute.includes(item.id),
              )
              .map((item) => item.id);
      const moving = new Set(input.effectiveIds);
      const firstMoved = finalOrder.findIndex((id) => moving.has(id));
      const hoverId =
        firstMoved < 0
          ? "__END_OF_LIST__"
          : (finalOrder.slice(firstMoved + 1).find((id) => !moving.has(id)) ??
            "__END_OF_LIST__");
      const receipt = queueShoppingMovePatch({
        eventName: activeEventName,
        day: activeEventDate,
        eventGeneration: getEventGeneration?.(activeEventName),
        baselineItemIds: input.allItems.map((item) => item.id),
        baselineExecuteIds:
          recordEntry(
            input.currentExecute,
            existingDayKey(input.currentExecute, activeEventDate) ??
              activeEventDate,
          ) ?? [],
        sourceColumn: input.sourceColumn,
        targetColumn: input.targetColumn,
        requestedIds: input.requestedIds,
        effectiveIds: input.effectiveIds,
        hoverId,
        eventListItems: input.eventListItems,
        executeModeItems: input.executeModeItems,
        reorderWithinVisit: input.reorderWithinVisit,
      });
      if (receipt.status === "blocked") {
        placementRejected(receipt.reason);
        return;
      }
      if (receipt.status === "noop") return;
      const selectionConsumption = input.removeTransferredSelection
        ? captureSelectionConsumption?.(input.effectiveIds)
        : undefined;
      const selectedRevision = selectionRef.current.revision;
      const rangeRevision = selectionRevisionReader.current?.();
      const finish = () => {
        const latest = reorderContextRef.current;
        if (
          latest.activeEventName !== activeEventName ||
          latest.activeEventDate !== activeEventDate ||
          selectCurrentMode(latest) !== "edit"
        )
          return;
        const selectionUnchanged =
          selectionRef.current.revision === selectedRevision &&
          (rangeRevision === undefined ||
            selectionRevisionReader.current?.() === rangeRevision);
        selectionConsumption?.consume();
        if (!selectionUnchanged) return;
        if (!selectionConsumption && input.removeTransferredSelection)
          removeSelectedItemIds(input.effectiveIds);
        if (!receipt.completion || rangeRevision !== undefined)
          clearRangeSelection();
        if (input.manualSort) {
          setSortState("Manual");
          setBlockSortDirection(null);
        }
        if (input.mergeNotice) notify(EXECUTION_VISIT_MERGE_NOTICE);
      };
      if (receipt.completion)
        void receipt.completion
          .then((result) => {
            if (result.status === "aborted") placementRejected(result.reason);
            else if (result.status === "committed") finish();
          })
          .finally(() => selectionConsumption?.release());
      else {
        try {
          finish();
        } finally {
          selectionConsumption?.release();
        }
      }
    },
  );
  const moveItemVertical = useCallback(
    (
      direction: "up" | "down",
      itemId: string,
      targetColumn?: ShoppingListColumn,
    ) => {
      const latestContext = reorderContextRef.current;
      const mode = selectCurrentMode(latestContext);
      if (
        !activeEventName ||
        latestContext.activeEventName !== activeEventName ||
        latestContext.activeEventDate !== activeEventDate ||
        mode !== "edit" ||
        !targetColumn
      )
        return;
      const currentAllItems =
        recordEntry(eventListsRef.current, activeEventName) ?? [];
      const currentExecute =
        recordEntry(executeModeItemsRef.current, activeEventName) ?? {};
      const currentExecuteIds =
        recordEntry(
          currentExecute,
          existingDayKey(currentExecute, activeEventDate) ?? activeEventDate,
        ) ?? [];
      const spaceGroupIds = spaceGroupDragItemIdsRef.current;
      const requested =
        spaceGroupIds ??
        (selectedItemIds.has(itemId) ? [...selectedItemIds] : [itemId]);
      const plan = buildMovePlan({
        requestedIds: requested,
        sourceOrderedIds:
          targetColumn === "execute"
            ? currentExecuteIds
            : getCandidateSourceOrderedIds(
                currentAllItems,
                activeEventDate,
                currentExecuteIds,
              ),
        allItems: currentAllItems,
        dayName: activeEventDate,
        expansionPolicy: targetColumn === "execute" ? "same-visit" : "exact",
      });
      if (!plan.effective.includes(itemId)) return;
      if (targetColumn === "execute") {
        const moved = moveExecuteSpacePriorityGroup({
          direction,
          itemId,
          dayItems: currentExecuteIds,
          items: currentAllItems,
          effectiveIds: new Set(plan.effective),
          areBoundaryItemsInSameHall: (first, second) =>
            areItemsInSameHallGroup(first, second, activeEventDate),
        });
        if (moved.reordered)
          queuePlacementButton({
            sourceColumn: targetColumn,
            targetColumn,
            requestedIds: plan.requested,
            effectiveIds: plan.effective,
            allItems: currentAllItems,
            currentExecute,
            executeModeItems: {
              ...currentExecute,
              [existingDayKey(currentExecute, activeEventDate) ??
              activeEventDate]: moved.reordered,
            },
            manualSort: true,
          });
        return;
      }
      const result = computeMoveItemVertical(
        direction,
        itemId,
        targetColumn,
        mode as ViewMode,
        new Set(plan.effective),
        currentAllItems,
        currentExecute,
        activeEventDate,
        (first, second) => areItemsInSameHall(first, second, activeEventDate),
      );
      if (!result.eventListItems && !result.executeModeItems) return;
      queuePlacementButton({
        sourceColumn: targetColumn,
        targetColumn,
        requestedIds: plan.requested,
        effectiveIds: plan.effective,
        allItems: currentAllItems,
        currentExecute,
        eventListItems: result.eventListItems,
        executeModeItems: result.executeModeItems,
        manualSort: true,
      });
    },
    [
      activeEventName,
      activeEventDate,
      eventListsRef,
      executeModeItemsRef,
      spaceGroupDragItemIdsRef,
      selectedItemIds,
      areItemsInSameHall,
      areItemsInSameHallGroup,
      queuePlacementButton,
    ],
  );
  const moveItemUp = useCallback(
    (itemId: string, targetColumn?: ShoppingListColumn) =>
      moveItemVertical("up", itemId, targetColumn),
    [moveItemVertical],
  );
  const moveItemDown = useCallback(
    (itemId: string, targetColumn?: ShoppingListColumn) =>
      moveItemVertical("down", itemId, targetColumn),
    [moveItemVertical],
  );

  const moveToExecuteColumn = useCallback(
    (itemIds: string[]) => {
      const latest = reorderContextRef.current;
      if (
        !activeEventName ||
        latest.activeEventName !== activeEventName ||
        latest.activeEventDate !== activeEventDate ||
        selectCurrentMode(latest) !== "edit"
      )
        return;
      const currentAllItems =
        recordEntry(eventListsRef.current, activeEventName) ?? [];
      const currentExecute =
        recordEntry(executeModeItemsRef.current, activeEventName) ?? {};
      const currentExecuteIds =
        recordEntry(
          currentExecute,
          existingDayKey(currentExecute, activeEventDate) ?? activeEventDate,
        ) ?? [];
      const plan = buildMovePlan({
        requestedIds: itemIds,
        sourceOrderedIds: getCandidateSourceOrderedIds(
          currentAllItems,
          activeEventDate,
          currentExecuteIds,
        ),
        allItems: currentAllItems,
        dayName: activeEventDate,
        expansionPolicy: "same-visit",
      });
      const result = computeMoveToExecuteColumnWithResult(
        plan.effective,
        activeEventDate,
        currentAllItems,
        currentExecute,
        new Set(),
      );
      if (!result.accepted) return;
      queuePlacementButton({
        sourceColumn: "candidate",
        targetColumn: "execute",
        requestedIds: plan.requested,
        effectiveIds: plan.effective,
        allItems: currentAllItems,
        currentExecute,
        executeModeItems: result.executeModeItems,
        removeTransferredSelection: true,
        mergeNotice:
          result.placement === "merged-into-existing-visit" ||
          result.placement === "mixed",
      });
    },
    [
      activeEventName,
      activeEventDate,
      eventListsRef,
      executeModeItemsRef,
      queuePlacementButton,
    ],
  );

  const removeFromExecuteColumn = useCallback(
    (itemIds: string[]) => {
      const latest = reorderContextRef.current;
      if (
        !activeEventName ||
        latest.activeEventName !== activeEventName ||
        latest.activeEventDate !== activeEventDate ||
        selectCurrentMode(latest) !== "edit"
      )
        return;
      const currentAllItems =
        recordEntry(eventListsRef.current, activeEventName) ?? [];
      const currentExecute =
        recordEntry(executeModeItemsRef.current, activeEventName) ?? {};
      const currentExecuteIds =
        recordEntry(
          currentExecute,
          existingDayKey(currentExecute, activeEventDate) ?? activeEventDate,
        ) ?? [];
      const plan = buildMovePlan({
        requestedIds: itemIds,
        sourceOrderedIds: currentExecuteIds,
        allItems: currentAllItems,
        dayName: activeEventDate,
        expansionPolicy: "same-visit",
      });
      if (!plan.effective.length) return;
      queuePlacementButton({
        sourceColumn: "execute",
        targetColumn: "candidate",
        requestedIds: plan.requested,
        effectiveIds: plan.effective,
        allItems: currentAllItems,
        currentExecute,
        executeModeItems: computeRemoveFromExecuteColumn(
          plan.effective,
          currentExecute,
          activeEventDate,
        ),
        removeTransferredSelection: true,
      });
    },
    [
      activeEventName,
      activeEventDate,
      eventListsRef,
      executeModeItemsRef,
      queuePlacementButton,
    ],
  );
  const confirmDeleteItem = useCallback(() => {
    if (!itemToDelete || !activeEventName) return;

    const result = computeDeleteItem(
      recordEntry(eventLists, activeEventName) || [],
      itemToDelete.id,
      recordEntry(executeModeItemsRef.current, activeEventName) || {},
    );
    setEventLists((current) => ({
      ...current,
      [activeEventName]: result.items,
    }));
    updateExecuteModeItems((current) => ({
      ...current,
      [activeEventName]: result.executeModeItems,
    }));
    confirmItemDelete();
  }, [
    activeEventName,
    confirmItemDelete,
    eventLists,
    executeModeItemsRef,
    itemToDelete,
    setEventLists,
    updateExecuteModeItems,
  ]);

  const toggleBlockSort = useCallback(() => {
    if (!activeEventName) return;

    const nextDirection: BlockSortDirection =
      blockSortDirection === "asc" ? "desc" : "asc";
    setEventLists((current) => {
      const allItems = [...(recordEntry(current, activeEventName) || [])];
      const itemsForDate = allItems.filter((item) =>
        isSameExecutionVisitDay(item.eventDate, activeEventDate),
      );
      if (itemsForDate.length === 0) return current;

      const sortedItemsForDate = [...itemsForDate].sort((first, second) => {
        if (!first.block && !second.block) return 0;
        if (!first.block) return 1;
        if (!second.block) return -1;
        const comparison = first.block.localeCompare(second.block, "ja", {
          numeric: true,
          sensitivity: "base",
        });
        return nextDirection === "asc" ? comparison : -comparison;
      });
      let sortedIndex = 0;
      return {
        ...current,
        [activeEventName]: allItems.map((item) =>
          isSameExecutionVisitDay(item.eventDate, activeEventDate)
            ? sortedItemsForDate[sortedIndex++]
            : item,
        ),
      };
    });
    setBlockSortDirection(nextDirection);
    clearSelection();
  }, [
    activeEventDate,
    activeEventName,
    clearSelection,
    blockSortDirection,
    setBlockSortDirection,
    setEventLists,
  ]);

  const toggleCandidateBlockSort = useCallback(() => {
    if (!activeEventName) return;

    const nextDirection: BlockSortDirection =
      blockSortDirection === "asc" ? "desc" : "asc";
    const executeIds = new Set(
      recordEntry(executeModeItemsRef.current, activeEventName)?.[
        activeEventDate
      ] || [],
    );
    setEventLists((current) => {
      const allItems = [...(recordEntry(current, activeEventName) || [])];
      const candidateItems = allItems.filter(
        (item) =>
          isSameExecutionVisitDay(item.eventDate, activeEventDate) &&
          !executeIds.has(item.id),
      );
      if (candidateItems.length === 0) return current;

      const sortedCandidateItems = [...candidateItems].sort((first, second) => {
        if (!first.block && !second.block) return 0;
        if (!first.block) return 1;
        if (!second.block) return -1;
        const comparison = first.block.localeCompare(second.block, "ja", {
          numeric: true,
          sensitivity: "base",
        });
        return nextDirection === "asc" ? comparison : -comparison;
      });
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
    setBlockSortDirection(nextDirection);
    clearSelection();
  }, [
    activeEventDate,
    activeEventName,
    clearSelection,
    blockSortDirection,
    executeModeItemsRef,
    setBlockSortDirection,
    setEventLists,
  ]);

  const toggleCandidateNumberSort = useCallback(() => {
    if (!activeEventName) return;

    const nextDirection: BlockSortDirection =
      candidateNumberSortDirection === "asc" ? "desc" : "asc";
    const executeIds = new Set(
      recordEntry(executeModeItemsRef.current, activeEventName)?.[
        activeEventDate
      ] || [],
    );
    setEventLists((current) => {
      const allItems = [...(recordEntry(current, activeEventName) || [])];
      const candidateItems = allItems.filter(
        (item) =>
          isSameExecutionVisitDay(item.eventDate, activeEventDate) &&
          !executeIds.has(item.id),
      );
      const filteredCandidateItems =
        selectedBlockFilters.size === 0
          ? candidateItems
          : candidateItems.filter((item) =>
              selectedBlockFilters.has(item.block),
            );
      if (filteredCandidateItems.length === 0) return current;

      const sortedCandidateItems = [...filteredCandidateItems].sort(
        (first, second) => {
          const comparison = first.number.localeCompare(
            second.number,
            undefined,
            { numeric: true, sensitivity: "base" },
          );
          return nextDirection === "asc" ? comparison : -comparison;
        },
      );
      const sortableIds = new Set(
        filteredCandidateItems.map((item) => item.id),
      );
      let sortedIndex = 0;
      return {
        ...current,
        [activeEventName]: allItems.map((item) =>
          sortableIds.has(item.id) ? sortedCandidateItems[sortedIndex++] : item,
        ),
      };
    });
    setCandidateNumberSortDirection(nextDirection);
    clearSelection();
  }, [
    activeEventDate,
    activeEventName,
    clearSelection,
    candidateNumberSortDirection,
    executeModeItemsRef,
    selectedBlockFilters,
    setCandidateNumberSortDirection,
    setEventLists,
  ]);

  return {
    applyBulkAdd,
    handleBulkAdd,
    updateItem,
    updateItems,
    moveItem,
    moveItemUp,
    moveItemDown,
    moveToExecuteColumn,
    removeFromExecuteColumn,
    confirmDeleteItem,
    toggleBlockSort,
    toggleCandidateBlockSort,
    toggleCandidateNumberSort,
  };
};
