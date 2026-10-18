import { recordEntry } from "../../utils/ownRecord";
import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  CellSelectionMode,
  CellSelectionType,
  PendingCellSelection,
  PendingVertexSelection,
  VertexSelectionMode,
} from "../../features/app-shell/types";
import type { AppNavigationCommands } from "../navigation";
import type { NewItemDefaults } from "../state/useAppUiState";
import {
  computeAddItemFromFocusMode,
  computeBatchAddToExecuteListFromMapWithResult,
  computeAddToExecuteListFromMapWithResult,
  computeHallOrderForPriorityChange,
  computeInsertIntoExecuteAtPosition,
  computeRemoveFromExecuteListFromMapWithResult,
  computeUpdateItemPriority,
  repositionExecuteItemAfterIdentityChangeWithResult,
} from "../../features/events/itemOps";
import {
  cloneHallsForDates,
  getCommittedEditorHalls,
  emptyHallRouteSettings,
  remapHallRouteSettings,
  splitHallsForStorage,
  updateHallDefinitionsForHalls,
  updateHallRouteSettingsForHalls,
  updateMaplessHallDefinitions,
  updateMaplessHallRouteSettings,
} from "../../features/map/domain/hallOperations";
import type {
  BlockDefinition,
  DayMapData,
  HallDefinition,
  HallDefinitionsStore,
  HallRouteSettingsStore,
  MapDataStore,
} from "../../types/map";
import { MAPLESS_HALL_KEY, getMaplessKey } from "../../types/map";
import type {
  ExecuteModeItems,
  PurchaseStatus,
  ShoppingItem,
} from "../../types/item";
import type { FocusModeAddItemResult } from "../../types/focus";
import type { ApplicationSnapshotCommitPort } from "./ApplicationSnapshotCommitPort";
import {
  buildExecutionVisitProjectionKey,
  EXECUTION_VISIT_MERGE_NOTICE,
} from "../../utils/visitProjection";

import type { MapEditorSession } from "../../features/map/domain/mapEditorSession";
import { CommittedStateApplyError } from "./applicationMutationCoordinator";
import type { HallWriteResult } from "../ports/HallEditorCommandPort";
import type { PersistenceSnapshot } from "../ports/PersistenceCommandPort";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export interface MutableMapEditorValue<T> {
  current: T;
}

export type MapEditorPriorityLevel = "none" | "priority" | "highest";

export interface MapEditorStatePort {
  readonly editorSession?: MapEditorSession | null;
  readonly activeEventName: string | null;
  readonly activeEventDate: string;
  readonly isMapTab: boolean;
  readonly currentMapTabName: string | null;
  readonly currentMapData: DayMapData | null | undefined;
  readonly eventLists: Record<string, ShoppingItem[]>;
  readonly items: ShoppingItem[];
  readonly executeModeItemsRef: MutableMapEditorValue<
    Record<string, ExecuteModeItems>
  >;
  readonly mapData: MapDataStore;
  readonly hallDefinitions: HallDefinitionsStore;
  readonly hallRouteSettings: HallRouteSettingsStore;
  readonly visitListPanelMapTab: string | null;
  readonly cellSelectionMode: CellSelectionMode;
  readonly vertexSelectionMode: VertexSelectionMode;
}

export interface MapEditorActionPort {
  readonly setMapData: StateSetter<MapDataStore>;
  readonly setHallDefinitions: StateSetter<HallDefinitionsStore>;
  readonly setHallRouteSettings: StateSetter<HallRouteSettingsStore>;
  readonly setEventLists: StateSetter<Record<string, ShoppingItem[]>>;
  updateExecuteModeItems(
    updater: (
      current: Record<string, ExecuteModeItems>,
    ) => Record<string, ExecuteModeItems>,
  ): void;
  commitExecuteModeItemsForEvent(
    eventName: string,
    executeModeItems: ExecuteModeItems,
  ): void;
  readonly setNewItemDefaults: StateSetter<NewItemDefaults | null>;
  readonly setItemToEdit: StateSetter<ShoppingItem | null>;
  readonly navigation: Pick<AppNavigationCommands, "showImport">;
  startCellSelection(selection: NonNullable<CellSelectionMode>): void;
  toggleCellSelection(cell: { row: number; col: number }): void;
  finishCellSelection(pending: PendingCellSelection): void;
  startVertexSelection(selection: NonNullable<VertexSelectionMode>): void;
  toggleVertexSelection(vertex: { row: number; col: number }): void;
  finishVertexSelection(pending: PendingVertexSelection): void;
}

export interface MapEditorSelectorPort {
  getMapTabForDate(eventDate: string): string | null;
  getItemHallId(item: ShoppingItem, eventDate: string): string | null;
  areItemsInSameHallGroup(
    firstItemId: string,
    secondItemId: string,
    eventDate: string,
  ): boolean;
}

export interface MapEditorEffectPort {
  readonly selectionEventTarget: Pick<
    EventTarget,
    "addEventListener" | "removeEventListener"
  >;
  notify(message: string): void;
  onCommittedFailure?(error: Error): void;
}

export interface MapEditorCommandPorts {
  readonly state: MapEditorStatePort;
  readonly actions: MapEditorActionPort;
  readonly selectors: MapEditorSelectorPort;
  readonly effects: MapEditorEffectPort;
  readonly persistence: ApplicationSnapshotCommitPort;
  readonly isEditorSessionCurrent?: (session: MapEditorSession) => boolean;
  readonly readCommittedSnapshot: () => Pick<
    PersistenceSnapshot,
    "hallDefinitions"
  >;
}

export interface MapEditorCommands {
  isEditorWritePending(): boolean;
  handleAddToExecuteListFromMap(itemId: string): string[];
  handleAddToExecuteListFromMapAtPosition(
    itemId: string,
    referenceItemId: string,
    position: "before" | "after",
  ): string[];
  handleRemoveFromExecuteListFromMap(itemId: string): string[] | undefined;
  handleBatchAddToExecuteListFromMap(itemIds: string[]): string[];
  handleBatchAddToExecuteListFromMapAtPosition(
    itemIds: string[],
    referenceItemId: string,
    position: "before" | "after",
  ): string[];
  handleBatchRemoveFromExecuteListFromMap(
    itemIds: string[],
  ): string[] | undefined;
  handleAddNewItemFromMap(
    eventDate: string,
    block: string,
    number: string,
  ): void;
  handleAddItemFromFocusMode(
    item: Omit<ShoppingItem, "id"> & { purchaseStatus?: PurchaseStatus },
  ): FocusModeAddItemResult | undefined;
  handleMoveToFirstFromMap(itemId: string): void;
  handleMoveToLastFromMap(itemId: string): void;
  handleUpdateItemPriority(
    itemId: string,
    priorityLevel: MapEditorPriorityLevel,
  ): void;
  handleUpdateItemPriorityFromEdit(
    itemId: string,
    priorityLevel: MapEditorPriorityLevel,
  ): void;
  handleUpdateHallOrderForPriorityChangeFromEdit(
    itemId: string,
    newPriorityLevel: MapEditorPriorityLevel,
    oldPriorityLevel: MapEditorPriorityLevel,
  ): void;
  handleUpdateBlocks(
    blocks: BlockDefinition[],
    session?: MapEditorSession,
  ): void;
  handleUpdateHalls(
    halls: HallDefinition[],
    session?: MapEditorSession,
  ): Promise<HallWriteResult>;
  handleUpdateMaplessHalls(
    halls: HallDefinition[],
    session?: MapEditorSession,
  ): Promise<HallWriteResult>;
  handleSyncMaplessHallsToOtherDates(
    targetDates: string[],
    halls?: HallDefinition[],
    session?: MapEditorSession,
  ): Promise<HallWriteResult>;
  handleSyncPolygonHallsToOtherDates(
    targetDates: string[],
    halls?: HallDefinition[],
    session?: MapEditorSession,
  ): Promise<HallWriteResult>;
  handleStartVertexSelection(editingData?: unknown): void;
  handleConfirmVertexSelection(): void;
  handleCancelVertexSelection(): void;
  handleStartCellSelection(
    type: CellSelectionType,
    editingData?: unknown,
  ): void;
  handleConfirmCellSelection(): void;
  handleCancelCellSelection(): void;
}

const MAP_CELL_CLICK_EVENT = "mapCellClick";

export const sortMapEditorVerticesNonCrossing = (
  vertices: ReadonlyArray<{ row: number; col: number }>,
): Array<{ row: number; col: number }> => {
  if (vertices.length <= 2) return [...vertices];

  const centroidRow =
    vertices.reduce((sum, vertex) => sum + vertex.row, 0) / vertices.length;
  const centroidCol =
    vertices.reduce((sum, vertex) => sum + vertex.col, 0) / vertices.length;

  return [...vertices].sort((first, second) => {
    const firstAngle = Math.atan2(
      first.row - centroidRow,
      first.col - centroidCol,
    );
    const secondAngle = Math.atan2(
      second.row - centroidRow,
      second.col - centroidCol,
    );
    return firstAngle - secondAngle;
  });
};

export const useMapEditorCommands = ({
  state,
  actions,
  selectors,
  effects,
  persistence,
  isEditorSessionCurrent,
  readCommittedSnapshot,
}: MapEditorCommandPorts): MapEditorCommands => {
  const {
    activeEventName,
    activeEventDate,
    isMapTab,
    currentMapTabName,
    currentMapData,
    eventLists,
    items,
    executeModeItemsRef,
    mapData,
    hallDefinitions,
    hallRouteSettings,
    visitListPanelMapTab,
    cellSelectionMode,
    vertexSelectionMode,
  } = state;
  const {
    setMapData,
    setHallRouteSettings,
    setEventLists,
    updateExecuteModeItems,
    commitExecuteModeItemsForEvent,
    setNewItemDefaults,
    setItemToEdit,
    navigation,
    startCellSelection,
    toggleCellSelection,
    finishCellSelection,
    startVertexSelection,
    toggleVertexSelection,
    finishVertexSelection,
  } = actions;
  const { commitApplicationSnapshotPatch } = persistence;
  const { getMapTabForDate, getItemHallId, areItemsInSameHallGroup } =
    selectors;
  const { notify, selectionEventTarget } = effects;
  const editorWritePending = useRef(false);
  const isEditorWritePending = useCallback(
    () => editorWritePending.current,
    [],
  );
  const liveEditor = useRef({ state, isEditorSessionCurrent });
  liveEditor.current = { state, isEditorSessionCurrent };
  const sessionIsCurrent = useCallback(
    (session?: MapEditorSession): boolean => {
      if (!session) return true;
      const live = liveEditor.current;
      return (
        live.state.editorSession?.sessionId === session.sessionId &&
        live.state.activeEventName === session.eventName &&
        live.state.activeEventDate === session.day &&
        (session.editorKind === "simple-hall-definition" ||
          live.state.currentMapTabName === session.mapKey) &&
        (live.isEditorSessionCurrent?.(session) ?? true)
      );
    },
    [],
  );

  const handleAddToExecuteListFromMap = useCallback(
    (itemId: string): string[] => {
      if (
        !activeEventName ||
        !isMapTab ||
        !currentMapTabName ||
        !activeEventDate
      ) {
        return [];
      }

      const halls =
        recordEntry(hallDefinitions, activeEventName)?.[currentMapTabName] ??
        [];
      const routeSettings = recordEntry(hallRouteSettings, activeEventName)?.[
        currentMapTabName
      ] ?? { hallOrder: [], hallVisitLists: [] };
      const result = computeAddToExecuteListFromMapWithResult(
        itemId,
        activeEventDate,
        items,
        recordEntry(executeModeItemsRef.current, activeEventName) ?? {},
        halls,
        routeSettings,
        recordEntry(mapData, activeEventName)?.[currentMapTabName],
      );
      if (!result.accepted) return [];
      commitExecuteModeItemsForEvent(activeEventName, result.executeModeItems);
      return result.insertedItemIds;
    },
    [
      activeEventDate,
      activeEventName,
      commitExecuteModeItemsForEvent,
      currentMapTabName,
      executeModeItemsRef,
      hallDefinitions,
      hallRouteSettings,
      isMapTab,
      items,
      mapData,
    ],
  );

  const handleAddToExecuteListFromMapAtPosition = useCallback(
    (
      itemId: string,
      referenceItemId: string,
      position: "before" | "after",
    ): string[] => {
      if (!activeEventName || !isMapTab || !activeEventDate) return [];
      const result = computeInsertIntoExecuteAtPosition(
        [itemId],
        referenceItemId,
        position,
        recordEntry(executeModeItemsRef.current, activeEventName) ?? {},
        activeEventDate,
        items,
        {
          canInsertWithReference: (insertedItemId, referenceId) =>
            areItemsInSameHallGroup(
              insertedItemId,
              referenceId,
              activeEventDate,
            ),
        },
      );
      if (!result.accepted) return [];
      commitExecuteModeItemsForEvent(activeEventName, result.executeModeItems);
      return result.insertedItemIds;
    },
    [
      activeEventDate,
      activeEventName,
      areItemsInSameHallGroup,
      commitExecuteModeItemsForEvent,
      executeModeItemsRef,
      isMapTab,
      items,
    ],
  );

  const handleRemoveFromExecuteListFromMap = useCallback(
    (itemId: string): string[] | undefined => {
      if (!activeEventName || !isMapTab || !activeEventDate) return undefined;
      const result = computeRemoveFromExecuteListFromMapWithResult(
        [itemId],
        recordEntry(executeModeItemsRef.current, activeEventName) ?? {},
        activeEventDate,
        items,
      );
      commitExecuteModeItemsForEvent(activeEventName, result.executeModeItems);
      return result.removedItemIds;
    },
    [
      activeEventDate,
      activeEventName,
      commitExecuteModeItemsForEvent,
      executeModeItemsRef,
      isMapTab,
      items,
    ],
  );

  const handleBatchAddToExecuteListFromMap = useCallback(
    (itemIds: string[]): string[] => {
      if (
        !activeEventName ||
        !isMapTab ||
        !currentMapTabName ||
        !activeEventDate
      ) {
        return [];
      }
      const halls =
        recordEntry(hallDefinitions, activeEventName)?.[currentMapTabName] ??
        [];
      const routeSettings = recordEntry(hallRouteSettings, activeEventName)?.[
        currentMapTabName
      ] ?? { hallOrder: [], hallVisitLists: [] };
      const currentMap = recordEntry(mapData, activeEventName)?.[
        currentMapTabName
      ];
      const result = computeBatchAddToExecuteListFromMapWithResult(
        itemIds,
        activeEventDate,
        items,
        recordEntry(executeModeItemsRef.current, activeEventName) ?? {},
        halls,
        routeSettings,
        currentMap,
      );
      if (!result.accepted) return [];
      commitExecuteModeItemsForEvent(activeEventName, result.executeModeItems);
      return result.insertedItemIds;
    },
    [
      activeEventDate,
      activeEventName,
      commitExecuteModeItemsForEvent,
      currentMapTabName,
      executeModeItemsRef,
      hallDefinitions,
      hallRouteSettings,
      isMapTab,
      items,
      mapData,
    ],
  );

  const handleBatchAddToExecuteListFromMapAtPosition = useCallback(
    (
      itemIds: string[],
      referenceItemId: string,
      position: "before" | "after",
    ): string[] => {
      if (!activeEventName || !isMapTab || !activeEventDate) return [];
      const result = computeInsertIntoExecuteAtPosition(
        itemIds,
        referenceItemId,
        position,
        recordEntry(executeModeItemsRef.current, activeEventName) ?? {},
        activeEventDate,
        items,
        {
          canInsertWithReference: (insertedItemId, referenceId) =>
            areItemsInSameHallGroup(
              insertedItemId,
              referenceId,
              activeEventDate,
            ),
        },
      );
      if (!result.accepted) return [];
      commitExecuteModeItemsForEvent(activeEventName, result.executeModeItems);
      return result.insertedItemIds;
    },
    [
      activeEventDate,
      activeEventName,
      areItemsInSameHallGroup,
      commitExecuteModeItemsForEvent,
      executeModeItemsRef,
      isMapTab,
      items,
    ],
  );

  const handleBatchRemoveFromExecuteListFromMap = useCallback(
    (itemIds: string[]): string[] | undefined => {
      if (!activeEventName || !isMapTab || !activeEventDate) return undefined;
      const result = computeRemoveFromExecuteListFromMapWithResult(
        itemIds,
        recordEntry(executeModeItemsRef.current, activeEventName) ?? {},
        activeEventDate,
        items,
      );
      commitExecuteModeItemsForEvent(activeEventName, result.executeModeItems);
      return result.removedItemIds;
    },
    [
      activeEventDate,
      activeEventName,
      commitExecuteModeItemsForEvent,
      executeModeItemsRef,
      isMapTab,
      items,
    ],
  );

  const handleAddNewItemFromMap = useCallback(
    (eventDate: string, block: string, number: string): void => {
      setNewItemDefaults({ eventDate, block, number });
      setItemToEdit(null);
      navigation.showImport(activeEventName);
    },
    [activeEventName, navigation, setItemToEdit, setNewItemDefaults],
  );

  const handleAddItemFromFocusMode = useCallback(
    (
      newItem: Omit<ShoppingItem, "id"> & {
        purchaseStatus?: PurchaseStatus;
      },
    ): FocusModeAddItemResult | undefined => {
      if (!activeEventName) return;
      const result = computeAddItemFromFocusMode(
        recordEntry(eventLists, activeEventName) ?? [],
        newItem,
        recordEntry(executeModeItemsRef.current, activeEventName) ?? {},
      );
      setEventLists((previous) => ({
        ...previous,
        [activeEventName]: result.items,
      }));
      updateExecuteModeItems((previous) => ({
        ...previous,
        [activeEventName]: result.executeModeItems,
      }));
      return {
        newItemId: result.newItemId,
        ...(result.placement ? { placement: result.placement } : {}),
        ...(result.mergedIntoVisitItemIds
          ? { mergedIntoVisitItemIds: result.mergedIntoVisitItemIds }
          : {}),
      };
    },
    [
      activeEventName,
      eventLists,
      executeModeItemsRef,
      setEventLists,
      updateExecuteModeItems,
    ],
  );

  const handleMoveToFirstFromMap = useCallback(
    (itemId: string): void => {
      if (!activeEventName || !isMapTab || !activeEventDate) return;
      updateExecuteModeItems((previous) => {
        const eventItems = recordEntry(previous, activeEventName) ?? {};
        const dayItemIds = eventItems[activeEventDate] ?? [];
        const targetItem = items.find((item) => item.id === itemId);
        const targetVisitKey = targetItem
          ? buildExecutionVisitProjectionKey(targetItem)
          : null;
        const visitItemIds = dayItemIds.filter((currentId) => {
          if (!targetVisitKey) return currentId === itemId;
          const currentItem = items.find((item) => item.id === currentId);
          return (
            currentItem !== undefined &&
            buildExecutionVisitProjectionKey(currentItem) === targetVisitKey
          );
        });
        const visitItemIdSet = new Set(visitItemIds);
        const remaining = dayItemIds.filter(
          (currentId) => !visitItemIdSet.has(currentId),
        );
        return {
          ...previous,
          [activeEventName]: {
            ...eventItems,
            [activeEventDate]: [...visitItemIds, ...remaining],
          },
        };
      });
    },
    [activeEventDate, activeEventName, isMapTab, items, updateExecuteModeItems],
  );

  const handleMoveToLastFromMap = useCallback(
    (itemId: string): void => {
      if (!activeEventName || !isMapTab || !activeEventDate) return;
      updateExecuteModeItems((previous) => {
        const eventItems = recordEntry(previous, activeEventName) ?? {};
        const dayItemIds = eventItems[activeEventDate] ?? [];
        const targetItem = items.find((item) => item.id === itemId);
        const targetVisitKey = targetItem
          ? buildExecutionVisitProjectionKey(targetItem)
          : null;
        const visitItemIds = dayItemIds.filter((currentId) => {
          if (!targetVisitKey) return currentId === itemId;
          const currentItem = items.find((item) => item.id === currentId);
          return (
            currentItem !== undefined &&
            buildExecutionVisitProjectionKey(currentItem) === targetVisitKey
          );
        });
        const visitItemIdSet = new Set(visitItemIds);
        const remaining = dayItemIds.filter(
          (currentId) => !visitItemIdSet.has(currentId),
        );
        return {
          ...previous,
          [activeEventName]: {
            ...eventItems,
            [activeEventDate]: [...remaining, ...visitItemIds],
          },
        };
      });
    },
    [activeEventDate, activeEventName, isMapTab, items, updateExecuteModeItems],
  );

  const handleUpdateItemPriority = useCallback(
    async (
      itemId: string,
      priorityLevel: MapEditorPriorityLevel,
    ): Promise<void> => {
      if (!activeEventName || !visitListPanelMapTab) return;
      const halls =
        recordEntry(hallDefinitions, activeEventName)?.[visitListPanelMapTab] ??
        [];
      const result = computeUpdateItemPriority(
        itemId,
        priorityLevel,
        items,
        halls,
        recordEntry(mapData, activeEventName)?.[visitListPanelMapTab],
        recordEntry(hallRouteSettings, activeEventName)?.[
          visitListPanelMapTab
        ] ?? emptyHallRouteSettings(),
      );
      const nextEventLists = {
        ...eventLists,
        [activeEventName]: result.items,
      };
      const nextHallRouteSettings = {
        ...hallRouteSettings,
        [activeEventName]: {
          ...recordEntry(hallRouteSettings, activeEventName),
          [visitListPanelMapTab]: result.hallRouteSettings,
        },
      };

      const changedItem = items.find((item) => item.id === itemId);
      if (!changedItem) return;
      const updatedItem = result.items.find((item) => item.id === itemId);
      if (!updatedItem) return;
      const repositionResult =
        repositionExecuteItemAfterIdentityChangeWithResult(
          recordEntry(executeModeItemsRef.current, activeEventName) ?? {},
          changedItem,
          updatedItem,
          result.items,
        );
      const nextExecuteModeItems = {
        ...executeModeItemsRef.current,
        [activeEventName]: repositionResult.executeModeItems,
      };
      try {
        await commitApplicationSnapshotPatch({
          eventLists: nextEventLists,
          hallRouteSettings: nextHallRouteSettings,
          executeModeItems: nextExecuteModeItems,
        });
      } catch {
        return;
      }
      if (repositionResult.placement === "merged-into-existing-visit") {
        notify(EXECUTION_VISIT_MERGE_NOTICE);
      }
    },
    [
      activeEventName,
      commitApplicationSnapshotPatch,
      eventLists,
      executeModeItemsRef,
      hallDefinitions,
      hallRouteSettings,
      items,
      mapData,
      notify,
      visitListPanelMapTab,
    ],
  );

  const handleUpdateItemPriorityFromEdit = useCallback(
    async (
      itemId: string,
      priorityLevel: MapEditorPriorityLevel,
    ): Promise<void> => {
      if (!activeEventName) return;
      const currentItems = recordEntry(eventLists, activeEventName) ?? [];
      const changedItem = currentItems.find((item) => item.id === itemId);
      if (!changedItem) return;
      const resolvedHallId = getItemHallId(changedItem, changedItem.eventDate);
      const mapTabForItem = getMapTabForDate(changedItem.eventDate);
      const mapHallIds = new Set(
        mapTabForItem
          ? (
              recordEntry(hallDefinitions, activeEventName)?.[mapTabForItem] ??
              []
            ).map((hall) => hall.id)
          : [],
      );
      const targetKey =
        resolvedHallId && mapHallIds.has(resolvedHallId) && mapTabForItem
          ? mapTabForItem
          : getMaplessKey(changedItem.eventDate);
      const result = computeUpdateItemPriority(
        itemId,
        priorityLevel,
        currentItems,
        recordEntry(hallDefinitions, activeEventName)?.[targetKey] ?? [],
        targetKey.startsWith(MAPLESS_HALL_KEY)
          ? undefined
          : recordEntry(mapData, activeEventName)?.[targetKey],
        recordEntry(hallRouteSettings, activeEventName)?.[targetKey] ??
          emptyHallRouteSettings(),
      );
      const nextEventLists = {
        ...eventLists,
        [activeEventName]: result.items,
      };
      const nextHallRouteSettings = {
        ...hallRouteSettings,
        [activeEventName]: {
          ...recordEntry(hallRouteSettings, activeEventName),
          [targetKey]: result.hallRouteSettings,
        },
      };
      const updatedItem = result.items.find((item) => item.id === itemId);
      if (!updatedItem) return;
      const repositionResult =
        repositionExecuteItemAfterIdentityChangeWithResult(
          recordEntry(executeModeItemsRef.current, activeEventName) ?? {},
          changedItem,
          updatedItem,
          result.items,
        );
      const nextExecuteModeItems = {
        ...executeModeItemsRef.current,
        [activeEventName]: repositionResult.executeModeItems,
      };
      try {
        await commitApplicationSnapshotPatch({
          eventLists: nextEventLists,
          hallRouteSettings: nextHallRouteSettings,
          executeModeItems: nextExecuteModeItems,
        });
      } catch {
        return;
      }
      if (repositionResult.placement === "merged-into-existing-visit") {
        notify(EXECUTION_VISIT_MERGE_NOTICE);
      }
    },
    [
      activeEventName,
      commitApplicationSnapshotPatch,
      eventLists,
      executeModeItemsRef,
      getItemHallId,
      getMapTabForDate,
      hallDefinitions,
      hallRouteSettings,
      mapData,
      notify,
    ],
  );

  const handleUpdateHallOrderForPriorityChangeFromEdit = useCallback(
    (
      itemId: string,
      newPriorityLevel: MapEditorPriorityLevel,
      oldPriorityLevel: MapEditorPriorityLevel,
    ): void => {
      if (!activeEventName) return;
      const currentItems = recordEntry(eventLists, activeEventName) ?? [];
      const changedItem = currentItems.find((item) => item.id === itemId);
      if (!changedItem) return;
      const resolvedHallId = getItemHallId(changedItem, changedItem.eventDate);
      const mapTabForItem = getMapTabForDate(changedItem.eventDate);
      const mapHallIds = new Set(
        mapTabForItem
          ? (
              recordEntry(hallDefinitions, activeEventName)?.[mapTabForItem] ??
              []
            ).map((hall) => hall.id)
          : [],
      );
      const targetKey =
        resolvedHallId && mapHallIds.has(resolvedHallId) && mapTabForItem
          ? mapTabForItem
          : getMaplessKey(changedItem.eventDate);
      const itemsAfter = currentItems.map((item) =>
        item.id === itemId
          ? { ...item, priorityLevel: newPriorityLevel }
          : item,
      );
      const nextSettings = computeHallOrderForPriorityChange(
        itemId,
        newPriorityLevel,
        oldPriorityLevel,
        itemsAfter,
        recordEntry(hallDefinitions, activeEventName)?.[targetKey] ?? [],
        targetKey.startsWith(MAPLESS_HALL_KEY)
          ? undefined
          : recordEntry(mapData, activeEventName)?.[targetKey],
        recordEntry(hallRouteSettings, activeEventName)?.[targetKey] ??
          emptyHallRouteSettings(),
      );
      setHallRouteSettings((previous) => ({
        ...previous,
        [activeEventName]: {
          ...recordEntry(previous, activeEventName),
          [targetKey]: nextSettings,
        },
      }));
    },
    [
      activeEventName,
      eventLists,
      getItemHallId,
      getMapTabForDate,
      hallDefinitions,
      hallRouteSettings,
      mapData,
      setHallRouteSettings,
    ],
  );

  const resolveEditorSession = useCallback(
    (
      kind: MapEditorSession["editorKind"],
      supplied?: MapEditorSession,
    ): MapEditorSession | null => {
      const session = supplied ?? state.editorSession;
      if (session)
        return session.editorKind === kind && sessionIsCurrent(session)
          ? session
          : null;
      if (
        !activeEventName ||
        !activeEventDate ||
        (kind !== "simple-hall-definition" && !currentMapTabName)
      )
        return null;
      return {
        sessionId: "",
        eventName: activeEventName,
        eventGeneration: 0,
        day: activeEventDate,
        mapKey:
          kind === "simple-hall-definition"
            ? getMaplessKey(activeEventDate)
            : currentMapTabName!,
        editorKind: kind,
      };
    },
    [
      activeEventDate,
      activeEventName,
      currentMapTabName,
      sessionIsCurrent,
      state.editorSession,
    ],
  );

  const handleUpdateBlocks = useCallback(
    (blocks: BlockDefinition[], supplied?: MapEditorSession): void => {
      const session = resolveEditorSession("block-definition", supplied);
      if (!session || !isMapTab || !currentMapData) return;
      const source = recordEntry(mapData, session.eventName)?.[session.mapKey];
      if (!source) return;
      setMapData((previous) => {
        if (session.sessionId && !sessionIsCurrent(session)) return previous;
        const current = recordEntry(previous, session.eventName)?.[
          session.mapKey
        ];
        if (!current) return previous;
        return {
          ...previous,
          [session.eventName]: {
            ...recordEntry(previous, session.eventName),
            [session.mapKey]: { ...current, blocks },
          },
        };
      });
    },
    [
      currentMapData,
      isMapTab,
      mapData,
      resolveEditorSession,
      sessionIsCurrent,
      setMapData,
    ],
  );

  const writeHalls = useCallback(
    async (
      kind: "hall-definition" | "simple-hall-definition",
      halls: HallDefinition[],
      targetDates: string[],
      supplied?: MapEditorSession,
      writeSource = true,
    ): Promise<HallWriteResult> => {
      const session = resolveEditorSession(kind, supplied);
      if (!session || editorWritePending.current)
        return { status: "cancelled" };
      const { eventName, day, mapKey } = session;
      const maplessKey = getMaplessKey(day);
      const { polygonHalls, maplessHalls } =
        kind === "simple-hall-definition"
          ? { polygonHalls: [], maplessHalls: halls }
          : splitHallsForStorage(halls);
      // Source and destinations belong to a single existing atomic mutation.
      let definitions = !writeSource
        ? hallDefinitions
        : kind === "simple-hall-definition"
          ? updateMaplessHallDefinitions({
              previous: hallDefinitions,
              eventName,
              maplessKey,
              halls: maplessHalls,
            })
          : updateHallDefinitionsForHalls({
              previous: hallDefinitions,
              eventName,
              mapTabName: mapKey,
              maplessKey,
              polygonHalls,
              maplessHalls,
            });
      let routes = !writeSource
        ? hallRouteSettings
        : kind === "simple-hall-definition"
          ? updateMaplessHallRouteSettings({
              previous: hallRouteSettings,
              eventName,
              maplessKey,
              halls: maplessHalls,
            })
          : updateHallRouteSettingsForHalls({
              previous: hallRouteSettings,
              eventName,
              mapTabName: mapKey,
              maplessKey,
              polygonHalls,
              maplessHalls,
            });
      const sourceKey = kind === "simple-hall-definition" ? maplessKey : mapKey;
      const routeDays: Record<string, string[]> = { [sourceKey]: [day] };
      if (kind === "hall-definition") routeDays[maplessKey] = [day];
      const targets = new Map<string, string[]>();
      for (const date of new Set(targetDates)) {
        const key =
          kind === "simple-hall-definition"
            ? getMaplessKey(date)
            : getMapTabForDate(date);
        if (!key) continue;
        (routeDays[key] ??= []).push(
          ...(routeDays[key]?.includes(date) ? [] : [date]),
        );
        if (key === sourceKey) continue;
        const dates = targets.get(key) ?? [];
        dates.push(date);
        targets.set(key, dates);
      }
      // Allocate once per storage destination, before coordinator re-planning/CAS retries.
      const clones = cloneHallsForDates(
        kind === "simple-hall-definition" ? maplessHalls : polygonHalls,
        [...targets.keys()],
      );
      if (clones.size) {
        definitions = {
          ...definitions,
          [eventName]: { ...recordEntry(definitions, eventName) },
        };
        routes = {
          ...routes,
          [eventName]: { ...recordEntry(routes, eventName) },
        };
        const sourceSettings =
          recordEntry(routes, eventName)?.[sourceKey] ??
          emptyHallRouteSettings();
        for (const [key, clone] of clones) {
          definitions[eventName][key] = clone.halls;
          routes[eventName][key] = remapHallRouteSettings(
            sourceSettings,
            clone.idMap,
          );
        }
      }
      editorWritePending.current = true;
      let committed = false;
      try {
        await commitApplicationSnapshotPatch(
          { hallDefinitions: definitions, hallRouteSettings: routes },
          undefined,
          {
            routeDays: { [eventName]: routeDays },
            ...(kind === "hall-definition" && clones.size
              ? { polygonHallSyncTargets: { [eventName]: [...clones.keys()] } }
              : {}),
          },
          (snapshot) => {
            if (session.sessionId && !sessionIsCurrent(session))
              throw new Error(
                "地図編集の対象が変更されました。編集を開き直してください。",
              );
            if (
              !recordEntry(snapshot.eventLists, eventName) ||
              (kind === "hall-definition" &&
                !recordEntry(snapshot.mapData, eventName)?.[mapKey])
            )
              throw new Error(
                "地図編集の保存先が見つかりません。編集を開き直してください。",
              );
          },
        );
        committed = true;
        const snapshot = readCommittedSnapshot();
        return {
          status: "saved",
          sessionId: session.sessionId,
          committedHalls: getCommittedEditorHalls(
            snapshot.hallDefinitions as HallDefinitionsStore,
            session,
          ),
        };
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === "MutationCancelled" ||
            error.name === "MutationCancelledError")
        )
          return { status: "cancelled" };
        if (committed) {
          const failure = new CommittedStateApplyError(error);
          effects.onCommittedFailure?.(failure);
          throw failure;
        }
        throw error;
      } finally {
        editorWritePending.current = false;
      }
    },
    [
      commitApplicationSnapshotPatch,
      getMapTabForDate,
      hallDefinitions,
      hallRouteSettings,
      effects,
      readCommittedSnapshot,
      resolveEditorSession,
      sessionIsCurrent,
    ],
  );

  const handleUpdateHalls = useCallback(
    (halls: HallDefinition[], session?: MapEditorSession) =>
      writeHalls("hall-definition", halls, [], session),
    [writeHalls],
  );
  const handleUpdateMaplessHalls = useCallback(
    (halls: HallDefinition[], session?: MapEditorSession) =>
      writeHalls("simple-hall-definition", halls, [], session),
    [writeHalls],
  );
  const handleSyncMaplessHallsToOtherDates = useCallback(
    (
      targetDates: string[],
      halls?: HallDefinition[],
      session?: MapEditorSession,
    ) =>
      writeHalls(
        "simple-hall-definition",
        halls ??
          recordEntry(hallDefinitions, activeEventName ?? "")?.[
            getMaplessKey(activeEventDate)
          ] ??
          [],
        targetDates,
        session,
        halls !== undefined,
      ),
    [activeEventDate, activeEventName, hallDefinitions, writeHalls],
  );
  const handleSyncPolygonHallsToOtherDates = useCallback(
    (
      targetDates: string[],
      halls?: HallDefinition[],
      session?: MapEditorSession,
    ) =>
      writeHalls(
        "hall-definition",
        halls ??
          recordEntry(hallDefinitions, activeEventName ?? "")?.[
            currentMapTabName ?? ""
          ] ??
          [],
        targetDates,
        session,
        halls !== undefined,
      ),
    [activeEventName, currentMapTabName, hallDefinitions, writeHalls],
  );
  const handleStartVertexSelection = useCallback(
    (editingData?: unknown): void => {
      const session = state.editorSession ?? undefined;
      if (!sessionIsCurrent(session)) return;
      startVertexSelection({
        clickedVertices: [],
        editingData,
        ...(session ? { session } : {}),
      });
    },
    [sessionIsCurrent, startVertexSelection, state.editorSession],
  );

  const handleConfirmVertexSelection = useCallback((): void => {
    if (vertexSelectionMode && sessionIsCurrent(vertexSelectionMode.session)) {
      finishVertexSelection({
        vertices: sortMapEditorVerticesNonCrossing(
          vertexSelectionMode.clickedVertices,
        ),
        editingData: vertexSelectionMode.editingData,
        ...(vertexSelectionMode.session
          ? { session: vertexSelectionMode.session }
          : {}),
      });
      return;
    }
    if (!vertexSelectionMode || sessionIsCurrent(vertexSelectionMode.session))
      finishVertexSelection(null);
  }, [finishVertexSelection, sessionIsCurrent, vertexSelectionMode]);

  const handleCancelVertexSelection = useCallback((): void => {
    if (
      vertexSelectionMode?.editingData &&
      sessionIsCurrent(vertexSelectionMode.session)
    ) {
      finishVertexSelection({
        vertices: [],
        editingData: vertexSelectionMode.editingData,
        ...(vertexSelectionMode.session
          ? { session: vertexSelectionMode.session }
          : {}),
      });
      return;
    }
    if (!vertexSelectionMode || sessionIsCurrent(vertexSelectionMode.session))
      finishVertexSelection(null);
  }, [finishVertexSelection, sessionIsCurrent, vertexSelectionMode]);

  useEffect(() => {
    const handleMapCellClickForVertex = (event: Event): void => {
      if (
        !vertexSelectionMode ||
        !sessionIsCurrent(vertexSelectionMode.session)
      )
        return;
      const { row, col } = (event as CustomEvent<{ row: number; col: number }>)
        .detail;
      toggleVertexSelection({ row, col });
    };

    selectionEventTarget.addEventListener(
      MAP_CELL_CLICK_EVENT,
      handleMapCellClickForVertex,
    );
    return () => {
      selectionEventTarget.removeEventListener(
        MAP_CELL_CLICK_EVENT,
        handleMapCellClickForVertex,
      );
    };
  }, [
    selectionEventTarget,
    sessionIsCurrent,
    toggleVertexSelection,
    vertexSelectionMode,
  ]);

  const handleStartCellSelection = useCallback(
    (type: CellSelectionType, editingData?: unknown): void => {
      const session = state.editorSession ?? undefined;
      if (!sessionIsCurrent(session)) return;
      startCellSelection({
        ...(session ? { session } : {}),
        type,
        clickedCells: [],
        editingBlockData: editingData,
      });
    },
    [sessionIsCurrent, startCellSelection, state.editorSession],
  );

  const handleConfirmCellSelection = useCallback((): void => {
    if (cellSelectionMode && sessionIsCurrent(cellSelectionMode.session)) {
      finishCellSelection({
        type: cellSelectionMode.type,
        cells: cellSelectionMode.clickedCells,
        editingData: cellSelectionMode.editingBlockData,
        ...(cellSelectionMode.session
          ? { session: cellSelectionMode.session }
          : {}),
      });
      return;
    }
    if (!cellSelectionMode || sessionIsCurrent(cellSelectionMode.session))
      finishCellSelection(null);
  }, [cellSelectionMode, finishCellSelection, sessionIsCurrent]);

  const handleCancelCellSelection = useCallback((): void => {
    if (
      cellSelectionMode?.editingBlockData &&
      sessionIsCurrent(cellSelectionMode.session)
    ) {
      finishCellSelection({
        type: "cancelled",
        cells: [],
        editingData: cellSelectionMode.editingBlockData,
        ...(cellSelectionMode.session
          ? { session: cellSelectionMode.session }
          : {}),
      });
      return;
    }
    if (!cellSelectionMode || sessionIsCurrent(cellSelectionMode.session))
      finishCellSelection(null);
  }, [cellSelectionMode, finishCellSelection, sessionIsCurrent]);

  useEffect(() => {
    const handleMapCellClick = (event: Event): void => {
      if (!cellSelectionMode || !sessionIsCurrent(cellSelectionMode.session))
        return;
      const { row, col } = (event as CustomEvent<{ row: number; col: number }>)
        .detail;
      toggleCellSelection({ row, col });
    };

    selectionEventTarget.addEventListener(
      MAP_CELL_CLICK_EVENT,
      handleMapCellClick,
    );
    return () => {
      selectionEventTarget.removeEventListener(
        MAP_CELL_CLICK_EVENT,
        handleMapCellClick,
      );
    };
  }, [
    cellSelectionMode,
    selectionEventTarget,
    sessionIsCurrent,
    toggleCellSelection,
  ]);

  return {
    isEditorWritePending,
    handleAddToExecuteListFromMap,
    handleAddToExecuteListFromMapAtPosition,
    handleRemoveFromExecuteListFromMap,
    handleBatchAddToExecuteListFromMap,
    handleBatchAddToExecuteListFromMapAtPosition,
    handleBatchRemoveFromExecuteListFromMap,
    handleAddNewItemFromMap,
    handleAddItemFromFocusMode,
    handleMoveToFirstFromMap,
    handleMoveToLastFromMap,
    handleUpdateItemPriority,
    handleUpdateItemPriorityFromEdit,
    handleUpdateHallOrderForPriorityChangeFromEdit,
    handleUpdateBlocks,
    handleUpdateHalls,
    handleUpdateMaplessHalls,
    handleSyncMaplessHallsToOtherDates,
    handleSyncPolygonHallsToOtherDates,
    handleStartVertexSelection,
    handleConfirmVertexSelection,
    handleCancelVertexSelection,
    handleStartCellSelection,
    handleConfirmCellSelection,
    handleCancelCellSelection,
  };
};
