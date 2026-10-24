import { MutationCancelledError } from "./app/state/useApplicationSnapshot";
import type { MapEditorSession } from "./features/map/domain/mapEditorSession";
import { MutationConfirmationDialog } from "./features/app-shell/components/MutationConfirmationDialog";
import { requestModalSafeFocus } from "./utils/modalFocusBoundary";
import { recordEntry } from "./utils/ownRecord";
import { createItemContentGuard } from "./utils/itemContentGuard";
import { parseFocusSessionKey } from "./utils/focusSessionKey";
import { LegacyConsistencyReview } from "./components/LegacyConsistencyReview";
import { planLegacyResolution } from "./features/consistency/domain/legacyResolution";
import {
  planItemEdit,
  previewItemEdit,
} from "./features/consistency/domain/itemEdit";
import DayTabButton from "./components/DayTabButton";
import {
  duplicateEventDays,
  planDayMerge,
} from "./features/consistency/domain/dayMerge";
import {
  ensureDayConsistency,
  getDayConsistency,
  resolveDayMap,
} from "./features/consistency/domain/context";
import {
  AcceptedItemCommandsProvider,
  type CaptureItemGuard,
} from "./features/shopping-list/renderers/ViewportRowState";
import { useSearchScrollRequest } from "./app/state/useSearchScrollRequest";
import React, {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  useDeferredValue,
} from "react";
import { ShoppingItem, EventMetadata, ExecuteModeItems } from "./types/item";
import { MapDataStore, HallDefinition } from "./types/map";
import { indexedItem, indexedItems } from "./utils/itemIndex";
import { createAppListViewProjectors } from "./app/selectors/incrementalAppListView";
import { createRoutingItemsProjector } from "./utils/executionVisitIndex";
import { FocusModeSessionState } from "./types/focus";
import { getMaplessKey } from "./types/map";
import { extractEventDates } from "./utils/eventDates";
import { getSpaceKey } from "./utils/spaceGrouping";
import { normalizeExecutionVisitDay } from "./utils/visitProjection";
import { type EventUpdateCommitState } from "./features/events/updateFlow";
import type {
  ApplicationSnapshotCommitContext,
  ApplicationSnapshotGuard,
} from "./app/commands/ApplicationSnapshotCommitPort";
import { getGlobalHallItemCount as computeGlobalHallItemCount } from "./features/map/domain/hallOperations";
import { useMapSelectors } from "./features/map/hooks/useMapSelectors";
import { useListInteractionState } from "./features/lists/hooks/useListInteractionState";
import AppHeaderShell from "./features/app-shell/components/AppHeaderShell";
import AppMainContent from "./features/app-shell/components/AppMainContent";
import AppOverlayLayer from "./features/app-shell/components/AppOverlayLayer";
import BackupRestoreDialog from "./components/BackupRestoreDialog";
import PersistenceStatusIndicator from "./components/PersistenceStatusIndicator";
import PersistenceRecoveryScreen from "./components/PersistenceRecoveryScreen";
import MapReimportConfirmationDialog from "./components/map/MapReimportConfirmationDialog";
import DuplicateEventDialog from "./components/DuplicateEventDialog";
import { appRuntime } from "./app/composition/appRuntime";
import { useEventLifecycleCommands } from "./app/commands/useEventLifecycleCommands";
import { useEventTransferCommands } from "./app/commands/useEventTransferCommands";
import { useEventUpdateCommands } from "./app/commands/useEventUpdateCommands";
import { createEventUpdateOperationRegistry } from "./app/commands/eventUpdateOperation";
import { createEventUpdateInvalidationBoundary } from "./app/commands/eventUpdateInvalidation";
import { useShoppingItemMutationCommands } from "./app/commands/useShoppingItemMutationCommands";
import { useShoppingSelectionExecutionCommands } from "./app/commands/useShoppingSelectionExecutionCommands";
import { useMapImportCommands } from "./app/commands/useMapImportCommands";
import { useMapVisitListCommands } from "./app/commands/useMapVisitListCommands";
import { useMapRouteCommands } from "./app/commands/useMapRouteCommands";
import { useMapEditorCommands } from "./app/commands/useMapEditorCommands";
import {
  selectCurrentMaplessHalls,
  selectMapVisitListItems,
  selectSortDisplayLabel,
  selectVisibleSearchMatches,
} from "./app/selectors/appListViewSelectors";
import {
  areFocusModeSessionStatesEqual,
  selectAppChromeVisibility,
  selectCurrentFocusSession,
  selectCurrentMode,
  selectHallExecuteCount,
  selectHallTotalItemCount,
  selectItemHallId,
  selectItemsInSameHallGroup,
  selectItemsInSameHallVisit,
  selectValidFocusSessionKeys,
} from "./app/selectors/appMapViewSelectors";
import { useAppNavigationController } from "./app/navigation";
import { selectNavigationReadModel } from "./app/navigation/navigationSelectors";
import { useAppUiState } from "./app/state/useAppUiState";
import { useAppOverlayController } from "./app/state/useAppOverlayController";
import { useApplicationSnapshot } from "./app/state/useApplicationSnapshot";
import { useMapWorkspaceState } from "./app/state/useMapWorkspaceState";
import { useThemeMode } from "./hooks/useThemeMode";
import {
  DEFAULT_UI_VISIBILITY,
  useDeferredUIVisibilitySettings,
  useUIVisibilitySettings,
} from "./hooks/useUIVisibilitySettings";
import { useNumberCellOutlineStyle } from "./hooks/useNumberCellOutlineStyle";
import { useDisablePriceUndefinedCheck } from "./hooks/useDisablePriceUndefinedCheck";
import { useDisableLimitedPurchaseQuantityCheck } from "./hooks/useDisableLimitedPurchaseQuantityCheck";
import {
  DEFAULT_SKIP_LIMITED_PURCHASE_FOR_SINGLE_QUANTITY,
  useSkipLimitedPurchaseForSingleQuantity,
} from "./hooks/useSkipLimitedPurchaseForSingleQuantity";
import { usePurchaseStatusControlMode } from "./hooks/usePurchaseStatusControlMode";
import { usePostEventDistributionCheck } from "./hooks/usePostEventDistributionCheck";
import { useIndexedDbPersistence } from "./hooks/useIndexedDbPersistence";
import type { ActiveTab, SortState } from "./features/app-shell/types";

const sortCycle: SortState[] = [
  "Manual",
  "Postpone",
  "Late",
  "Absent",
  "SoldOut",
  "None",
  "Purchased",
  "LimitedPurchase",
];
const sortLabels: Record<SortState, string> = {
  Manual: "巡回順",
  Postpone: "後回し",
  Late: "遅参",
  Absent: "欠席",
  SoldOut: "売切",
  None: "未購入",
  Purchased: "購入済",
  LimitedPurchase: "\u9650\u6570",
};

const App: React.FC = () => {
  const navigation = useAppNavigationController();
  const { activeEventName, activeTab, mapViewActive } =
    selectNavigationReadModel(navigation.state);
  const application = useApplicationSnapshot(
    appRuntime.persistenceCommands,
    activeEventName,
    activeTab,
  );
  const conflictRetryButtonRef = useRef<HTMLButtonElement>(null);
  const latestRetryableFailures = useRef(application.retryableFailures);
  latestRetryableFailures.current = application.retryableFailures;
  useEffect(() => {
    const failures = application.retryableFailures;
    if (failures.length)
      requestModalSafeFocus(
        () => conflictRetryButtonRef.current,
        () =>
          latestRetryableFailures.current === failures && failures.length > 0,
      );
  }, [application.retryableFailures]);
  const {
    eventLists,
    eventMetadata,
    executeModeItems,
    dayModes,
    mapData,
    mapRotationSettings,
    mapViewportSettings,
    routeSettings,
    hallDefinitions,
    hallRouteSettings,
    eventConsistency,
  } = application.values;
  const {
    setEventLists,
    setEventMetadata,
    setExecuteModeItems: setExecuteModeItemsCommitted,
    setDayModes,
    setMapData,
    setMapRotationSettings,
    setMapViewportSettings,
    setRouteSettings,
    setHallDefinitions,
    setHallRouteSettings,
  } = application.setters;
  const eventListsRef = useMemo(
    () => ({
      get current() {
        return application.previewRef.current.eventLists as Record<
          string,
          ShoppingItem[]
        >;
      },
    }),
    [application.previewRef],
  );
  const captureItemGuard = useCallback<CaptureItemGuard>(
    (item, kind) =>
      createItemContentGuard(
        application.rawRef.current,
        activeEventName ?? "",
        item,
        kind,
        application.coordinator.durableGeneration(activeEventName ?? ""),
      ),
    [activeEventName, application.rawRef, application.coordinator],
  );
  const readAcceptedItem = useCallback(
    (id: string) =>
      activeEventName
        ? indexedItem(
            recordEntry(eventListsRef.current, activeEventName) ?? [],
            id,
          )
        : undefined,
    [activeEventName, eventListsRef],
  );
  const eventMetadataRef = useMemo(
    () => ({
      get current() {
        return application.previewRef.current.eventMetadata as Record<
          string,
          EventMetadata
        >;
      },
    }),
    [application.previewRef],
  );
  const executeModeItemsRef = useMemo(
    () => ({
      get current() {
        return application.previewRef.current.executeModeItems;
      },
    }),
    [application.previewRef],
  );
  const updateExecuteModeItems = useCallback(
    (
      updater: (
        value: Record<string, ExecuteModeItems>,
      ) => Record<string, ExecuteModeItems>,
    ) => {
      setExecuteModeItemsCommitted(updater);
      return executeModeItemsRef.current;
    },
    [setExecuteModeItemsCommitted, executeModeItemsRef],
  );
  const commitExecuteModeItemsForEvent = useCallback(
    (name: string, next: ExecuteModeItems) => {
      setExecuteModeItemsCommitted((current) => ({ ...current, [name]: next }));
    },
    [setExecuteModeItemsCommitted],
  );
  const navigationCommands = navigation.commands;
  const finishMapEditorTransitionRef = useRef<() => void>(() => {});
  const preserveMapEditorAtTabRef = useRef<ActiveTab | null>(null);
  const restoreTransitionPendingRef = useRef(false);
  const navigateToTab = useCallback(
    (tab: ActiveTab) => {
      if (preserveMapEditorAtTabRef.current === tab)
        preserveMapEditorAtTabRef.current = null;
      else finishMapEditorTransitionRef.current();
      if (tab === "eventList") {
        navigationCommands.showEventList();
        return;
      }
      if (tab === "import") {
        navigationCommands.showImport(activeEventName);
        return;
      }
      if (navigation.state.kind === "event") {
        navigationCommands.changeDay(tab);
        return;
      }
      if (activeEventName) {
        navigationCommands.openEvent(activeEventName, tab);
      }
    },
    [activeEventName, navigation.state.kind, navigationCommands],
  );
  const {
    sortState,
    setSortState,
    blockSortDirection,
    setBlockSortDirection,
    itemToEdit,
    setItemToEdit,
    zoomLevel,
    setZoomLevel,
    recentlyChangedItemIds,
    setRecentlyChangedItemIds,
    newItemDefaults,
    setNewItemDefaults,
    searchKeyword,
    setSearchKeyword,
    currentSearchIndex,
    setCurrentSearchIndex,
    highlightedItemId,
    setHighlightedItemId,
    layoutMode,
    setLayoutMode,
    uiVisibilityOverride,
    setUiVisibilityOverride,
    focusModeMapVisible,
    setFocusModeMapVisible,
    focusModeSessions,
    setFocusModeSessions,
    showPostponeFilterButton,
    setShowPostponeFilterButton,
    showLateFilterButton,
    setShowLateFilterButton,
    candidateNumberSortDirection,
    setCandidateNumberSortDirection,
  } = useAppUiState();
  const overlayController = useAppOverlayController();
  const activeMapEditorSessionRef = useRef<MapEditorSession | null>(null);
  activeMapEditorSessionRef.current =
    overlayController.readModel.mapEditorSession;
  const {
    readModel: {
      itemToDelete,
      pendingEventUpdate,
      pendingUpdateEventName,
      eventToRename,
      pendingDuplicateEvent,
      exportEventName,
      pendingBackup,
      pendingXlsxRestoreCompletion,
      mapImportPendingEventName,
      pendingMapReimport,
      cellSelectionMode,
      vertexSelectionMode,
      visitListPanelOpen,
      visitListPanelMapTab,
      visitListHasUnsavedChanges,
      visitListOriginalOrder,
      showVisitListConfirmDialog,
      pendingTabChange,
    },
    concurrentStatus,
    commands: overlayCommands,
  } = overlayController;
  const xlsxOperationActivity =
    concurrentStatus.xlsxOperation?.activity ?? null;
  const {
    mapTabMenuOpen,
    setMapTabMenuOpen,
    highlightedMapCell,
    setHighlightedMapCell,
    mapSelectedHallId,
    setMapSelectedHallId,
    mapIsRouteVisible,
    setMapIsRouteVisible,
    mapIsHallOrderOpen,
    setMapIsHallOrderOpen,
    mapHallSelectorOpen,
    setMapHallSelectorOpen,
    mapSmartInsertEnabled,
    setMapSmartInsertEnabled,
    mapSmartInsertMode,
    setMapSmartInsertMode,
    vertexGuideOptions,
    setVertexGuideOptions,
  } = useMapWorkspaceState(
    appRuntime.persistenceCommands,
    (message, tone = "success") => {
      overlayCommands.status.showSmartInsertToast(message, tone);
    },
  );
  const mapToggleLongPressRef = React.useRef<number | null>(null);
  const mapToggleLongPressFiredRef = React.useRef(false);
  const mapToggleButtonRef = React.useRef<HTMLButtonElement>(null);
  const mapToggleMenuRef = React.useRef<HTMLDivElement>(null);
  const {
    selectedItemIds,
    selectedBlockFilters,
    setSelectedBlockFilters,
    rangeStart,
    rangeEnd,
    spaceGroupingEnabled,
    setSpaceGroupingEnabled,
    collapsedSpaces,
    setCollapsedSpaces,
    executeSpaceGroupingEnabled,
    setExecuteSpaceGroupingEnabled,
    executeCollapsedSpaces,
    setExecuteCollapsedSpaces,
    clearSelection,
    removeSelectedItemIds,
    clearRangeSelection,
    clearBlockFilters,
    toggleBlockFilter,
    toggleCollapsedSpace,
    toggleExecuteCollapsedSpace,
    selectItemForRange,
    selectSpaceGroupForRange,
    toggleRangeItemIdsSelection,
  } = useListInteractionState();

  const pendingEventUpdateBaseItemsRef = useRef<ShoppingItem[] | null>(null);
  const eventUpdatePreviewEpochRef = useRef(0);
  const [eventUpdateOperations] = useState(createEventUpdateOperationRegistry);
  const eventUpdateOperationsRef = useRef(eventUpdateOperations);
  const invalidateEventUpdateForEventRef = useRef<(eventName: string) => void>(
    () => {},
  );
  const eventUpdateInvalidation = useMemo(
    () =>
      createEventUpdateInvalidationBoundary(invalidateEventUpdateForEventRef),
    [],
  );

  useEffect(
    () => () => {
      eventUpdatePreviewEpochRef.current += 1;
    },
    [],
  );

  const { uiVisibilitySettings, setUiVisibilitySettings } =
    useUIVisibilitySettings(appRuntime.persistenceCommands);
  const {
    draftSettings: draftUIVisibilitySettings,
    isPanelOpen: uiSettingsPanelOpen,
    setDraftSettings: setDraftUIVisibilitySettings,
    closePanel: closeUiSettingsPanel,
    togglePanel: toggleUiSettingsPanel,
    updateDraftConfig: updateUIVisibilityConfig,
  } = useDeferredUIVisibilitySettings({
    appliedSettings: uiVisibilitySettings,
    setAppliedSettings: setUiVisibilitySettings,
    setVisibilityOverride: setUiVisibilityOverride,
  });
  const {
    numberCellOutlineStyle,
    setNumberCellOutlineStyle,
    DEFAULT_OUTLINE_STYLE,
  } = useNumberCellOutlineStyle(appRuntime.persistenceCommands);
  const { disablePriceUndefinedCheck, setDisablePriceUndefinedCheck } =
    useDisablePriceUndefinedCheck(appRuntime.persistenceCommands);
  const {
    disableLimitedPurchaseQuantityCheck,
    setDisableLimitedPurchaseQuantityCheck,
  } = useDisableLimitedPurchaseQuantityCheck(appRuntime.persistenceCommands);
  const {
    purchaseStatusControlMode,
    setPurchaseStatusControlMode,
    DEFAULT_PURCHASE_STATUS_CONTROL_MODE,
  } = usePurchaseStatusControlMode(appRuntime.persistenceCommands);
  const {
    skipLimitedPurchaseForSingleQuantity,
    setSkipLimitedPurchaseForSingleQuantity,
  } = useSkipLimitedPurchaseForSingleQuantity(appRuntime.persistenceCommands);
  const {
    postEventDistributionCheckEnabled,
    setPostEventDistributionCheckEnabled,
  } = usePostEventDistributionCheck(appRuntime.persistenceCommands);
  const { themeMode, setThemeMode } = useThemeMode(
    appRuntime.persistenceCommands,
  );

  const mapFileInputRef = useRef<HTMLInputElement>(null);
  const exportFileInputRef = useRef<HTMLInputElement>(null);
  const {
    isInitialized,
    startupState,
    persistenceStatus,
    legacyCleanupStatus,
    isAdoptingRecoveryCandidate,
    recoveryAdoptionError,
    failedStores,
    failureDetails,
    retryInitialization,
    adoptRecoveryCandidate,
    retrySave,
    isUpdateBlocked,
    flushPendingSave,
    runExclusiveRestore,
    acceptCommittedSnapshot,
    observeSnapshot,
    stopWrites: stopPersistenceWrites,
    migrationNotices,
    dismissMigrationNotices,
  } = useIndexedDbPersistence({
    persistenceCommands: appRuntime.persistenceCommands,
    values: application.raw,
    setters: application.hydrationSetters,
    onHydratedSnapshot: application.coordinator.initializeEventGenerations,
  });

  const commitApplicationSnapshotPatch = application.commitPatch;
  const { flush: flushApplication, isPending: isApplicationPending } =
    application;
  application.handlers.current = {
    stopWrites: stopPersistenceWrites,
    drain: flushPendingSave,
    observeSnapshot,
    applied: (snapshot, invalidatedEvents) => {
      acceptCommittedSnapshot(snapshot);
      eventUpdateInvalidation.applied(invalidatedEvents);
      if (
        mapImportPendingEventName &&
        invalidatedEvents.includes(mapImportPendingEventName)
      ) {
        overlayCommands.mapImport.closeDialog();
        overlayCommands.mapImport.cancelReimport();
      }
      if (invalidatedEvents.length)
        setFocusModeSessions((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([key]) =>
                !invalidatedEvents.includes(
                  parseFocusSessionKey(key)?.[0] ?? "",
                ),
            ),
          ),
        );
      if (activeEventName && invalidatedEvents.includes(activeEventName)) {
        overlayCommands.visitList.endSession();
        setItemToEdit(null);
        overlayCommands.item.close();
        activeMapEditorSessionRef.current = null;
        overlayCommands.mapEditor.close();
        clearSearchScrollRequest();
        setHighlightedItemId(null);
        pendingEventUpdateBaseItemsRef.current = null;
      }
    },
  };
  useEffect(
    () =>
      appRuntime.registerUpdateBlocker({
        id: "event-autosave",
        label: "イベントを保存中",
        isBlocking: () => isUpdateBlocked() || isApplicationPending(),
        flush: async () => {
          await flushApplication();
          await flushPendingSave();
        },
      }),
    [flushPendingSave, isUpdateBlocked, flushApplication, isApplicationPending],
  );

  const items = useMemo(
    () =>
      activeEventName ? recordEntry(eventLists, activeEventName) || [] : [],
    [activeEventName, eventLists],
  );
  const firstItemById = indexedItems(items);
  const listProjectors = useMemo(createAppListViewProjectors, []);
  const projectRoutingItems = useMemo(createRoutingItemsProjector, []);
  const routingItems = projectRoutingItems(items);
  const eventDates = useMemo(
    () => extractEventDates(routingItems),
    [routingItems],
  );
  const activeEventDate = useMemo(
    () => (activeEventName && eventDates.includes(activeTab) ? activeTab : ""),
    [activeEventName, activeTab, eventDates],
  );
  const executeColumnItems = useMemo(
    () =>
      listProjectors.execute({
        activeEventName,
        activeEventDate,
        executeModeItems,
        items,
      }),
    [activeEventDate, activeEventName, executeModeItems, items, listProjectors],
  );

  const {
    isMapTab,
    currentMapTabName,
    currentMapData,
    currentHalls,
    currentHallRouteSettings,
    getMapTabForDate,
    getHallsForDate,
    getMapDataForDate,
    getHallOrderForDate,
  } = useMapSelectors({
    eventConsistency,
    activeEventName,
    activeTab,
    activeEventDate: activeEventDate || null,
    mapViewActive,
    mapData,
    hallDefinitions,
    hallRouteSettings,
  });

  const getHallExecuteCount = useCallback(
    (hallId: string): number =>
      selectHallExecuteCount({
        hallId,
        activeEventName,
        activeEventDate,
        isMapTab,
        currentMapData,
        currentHalls,
        items,
        executeModeItems,
      }),
    [
      activeEventDate,
      activeEventName,
      currentHalls,
      currentMapData,
      executeModeItems,
      isMapTab,
      items,
    ],
  );

  const getHallTotalItemCount = useCallback(
    (hallId: string): number =>
      selectHallTotalItemCount({
        hallId,
        activeEventName,
        activeEventDate,
        isMapTab,
        currentMapData,
        currentHalls,
        items,
        executeModeItems,
      }),
    [
      activeEventDate,
      activeEventName,
      currentHalls,
      currentMapData,
      executeModeItems,
      isMapTab,
      items,
    ],
  );

  const getItemHallId = useCallback(
    (item: ShoppingItem, eventDate: string): string | null =>
      selectItemHallId({
        item,
        halls: getHallsForDate(eventDate),
        mapData: getMapDataForDate(eventDate),
        allItems: items,
      }),
    [getHallsForDate, getMapDataForDate, items],
  );

  const areItemsInSameHall = useCallback(
    (firstItemId: string, secondItemId: string, eventDate: string): boolean =>
      selectItemsInSameHallVisit({
        firstItemId,
        secondItemId,
        items,
        halls: getHallsForDate(eventDate),
        mapData: getMapDataForDate(eventDate),
      }),
    [getHallsForDate, getMapDataForDate, items],
  );

  const areItemsInSameHallGroup = useCallback(
    (firstItemId: string, secondItemId: string, eventDate: string): boolean =>
      selectItemsInSameHallGroup({
        firstItemId,
        secondItemId,
        items,
        halls: getHallsForDate(eventDate),
        mapData: getMapDataForDate(eventDate),
      }),
    [getHallsForDate, getMapDataForDate, items],
  );

  const currentMode = useMemo(
    () =>
      selectCurrentMode({
        activeEventName,
        activeEventDate,
        dayModes,
      }),
    [activeEventDate, activeEventName, dayModes],
  );

  const {
    sessionKey: currentFocusSessionKey,
    resumeState: currentFocusResumeState,
    mapName: currentFocusMapName,
  } = useMemo(
    () =>
      selectCurrentFocusSession({
        activeEventName,
        activeEventDate,
        focusModeSessions,
      }),
    [activeEventDate, activeEventName, focusModeSessions],
  );

  const handleFocusSessionStateChange = useCallback(
    (state: FocusModeSessionState) => {
      if (!currentFocusSessionKey) return;
      setFocusModeSessions((previous) => {
        const existing = previous[currentFocusSessionKey];
        if (areFocusModeSessionStatesEqual(existing, state)) return previous;
        return {
          ...previous,
          [currentFocusSessionKey]: state,
        };
      });
    },
    [currentFocusSessionKey, setFocusModeSessions],
  );

  const validFocusSessionKeys = useMemo(
    () => selectValidFocusSessionKeys({ eventLists }),
    [eventLists],
  );

  useEffect(() => {
    setFocusModeSessions((previous) => {
      let changed = false;
      const next: Record<string, FocusModeSessionState> = {};
      Object.entries(previous).forEach(([key, value]) => {
        if (validFocusSessionKeys.has(key)) {
          next[key] = value;
        } else {
          changed = true;
        }
      });
      return changed ? next : previous;
    });
  }, [setFocusModeSessions, validFocusSessionKeys]);

  const {
    currentMapTabRotation: currentMapTabRotationState,
    currentFocusMapRotation: currentFocusMapRotationState,
    currentMapTabViewport,
    globalMapTabName: globalHallOrderMapTabName,
    globalHallRouteSettings: globalHallOrderRouteSettings,
    setRouteVisibility: handleSetMapRouteVisibility,
    updateMapTabRotation: handleMapTabRotationAngleChange,
    updateFocusMapRotation: handleFocusMapRotationAngleChange,
    updateMapViewport: handleMapViewportChange,
    updateCurrentHallRouteSettings: handleUpdateHallRouteSettings,
    updateGlobalHallRouteSettings: handleUpdateGlobalHallRouteSettings,
    reorderExecuteListByHallOrder: handleReorderExecuteListByHallOrder,
  } = useMapRouteCommands({
    requestMutation: application.request,
    state: {
      activeEventName,
      activeEventDate,
      isMapTab,
      currentMapTabName,
      currentFocusMapName,
      routeVisible: mapIsRouteVisible,
      mapRotationSettings,
      mapViewportSettings,
      mapData,
      hallDefinitions,
      hallRouteSettings,
      executeModeItems,
      items,
    },
    actions: {
      setRouteVisible: setMapIsRouteVisible,
      setMapRotationSettings,
      setMapViewportSettings,
      setHallRouteSettings,
      updateExecuteModeItems,
    },
    selectors: {
      getMapTabForDate,
    },
  });
  const retainedDialogItemIds = useMemo(
    () => [itemToEdit?.id, itemToDelete?.id].filter((id): id is string => !!id),
    [itemToEdit?.id, itemToDelete?.id],
  );
  const { showHeaderBar, showTabBar, rawHideSomething } = useMemo(
    () =>
      selectAppChromeVisibility({
        activeEventName,
        currentMode,
        layoutMode,
        focusModeMapVisible,
        uiVisibilitySettings,
        uiVisibilityOverride,
        uiSettingsPanelOpen,
      }),
    [
      activeEventName,
      currentMode,
      focusModeMapVisible,
      layoutMode,
      uiSettingsPanelOpen,
      uiVisibilityOverride,
      uiVisibilitySettings,
    ],
  );

  const spaceGroupDragItemIdsRef = useRef<readonly string[] | null>(null);
  const {
    applyBulkAdd,
    handleBulkAdd,
    updateItem: handleUpdateItem,
    updateItems: handleUpdateItems,
    moveItem: handleMoveItem,
    moveItemUp: handleMoveItemUp,
    moveItemDown: handleMoveItemDown,
    moveToExecuteColumn: handleMoveToExecuteColumn,
    removeFromExecuteColumn: handleRemoveFromExecuteColumn,
    confirmDeleteItem: handleConfirmDelete,
    toggleBlockSort: handleBlockSortToggle,
    toggleCandidateBlockSort: handleBlockSortToggleCandidate,
    toggleCandidateNumberSort: handleCandidateNumberSort,
  } = useShoppingItemMutationCommands({
    state: {
      getEventGeneration: application.coordinator.generation,
      activeEventName,
      activeEventDate,
      eventLists,
      eventListsRef,
      eventMetadata,
      dayModes,
      items,
      selectedItemIds,
      selectedBlockFilters,
      executeModeItemsRef,
      spaceGroupDragItemIdsRef,
      eventUpdatePreviewEpochRef,
      eventUpdateOperationsRef,
      blockSortDirection,
      candidateNumberSortDirection,
      itemToDelete,
    },
    actions: {
      setEventLists,
      updateItemFields: application.updateItemFields,
      queueShoppingMovePatch: application.queueShoppingMovePatch,
      removeSelectedItemIds,
      setEventMetadata,
      setDayModes,
      updateExecuteModeItems,
      setRecentlyChangedItemIds,
      openDuplicateEvent: overlayCommands.event.openDuplicate,
      clearRangeSelection,
      clearSelection,
      setSortState,
      setBlockSortDirection,
      setCandidateNumberSortDirection,
      confirmItemDelete: overlayCommands.item.confirm,
      navigation: navigationCommands,
    },
    selectors: {
      areItemsInSameHall,
      areItemsInSameHallGroup,
    },
    alerts: { notify: alert },
    persistence: { commitApplicationSnapshotPatch },
  });

  const scheduleCenteredItemScroll = useCallback((itemId: string) => {
    window.setTimeout(() => {
      document
        .querySelector(`[data-item-id="${itemId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }, []);
  const {
    setViewMode: handleSetViewMode,
    selectItem: handleSelectItem,
    selectSpaceGroup: handleSelectSpaceGroupForRange,
    toggleItemsSelection: handleToggleRangeSelection,
    clearSelection: handleClearSelection,
    setSpaceGroupDragItemIds: handleSetSpaceGroupDragItemIds,
    changeBulkStatus: handleBulkStatusChange,
    updateExecuteItem: handleExecuteItemUpdate,
    activatePostponeFilter: handleActivatePostponeFilter,
    activateLateFilter: handleActivateLateFilter,
    setExecuteSpaceGroupOrder: handleExecuteSpaceGroupOrderChange,
    collapseAndOpenNext: handleCollapseAndOpenNext,
    sortSelectedItems: handleBulkSort,
  } = useShoppingSelectionExecutionCommands({
    state: {
      activeEventName,
      activeEventDate,
      currentMode,
      dayModes,
      sortState,
      executeColumnItems,
      readAcceptedItem,
      recentlyChangedItemIds,
      spaceGroupDragItemIdsRef,
      items,
      selectedItemIds,
      executeModeItemsRef,
    },
    interaction: {
      clearSelection,
      clearRangeSelection,
      selectItemForRange,
      selectSpaceGroupForRange,
      toggleRangeItemIdsSelection,
    },
    actions: {
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
      updateItem: handleUpdateItem,
      updateItems: handleUpdateItems,
    },
    effects: {
      notify: alert,
      scheduleCenteredItemScroll,
    },
  });

  const {
    selectEvent: selectEvent,
    deleteEvent: handleDeleteEvent,
    requestRename: handleRenameEvent,
    confirmRename: handleConfirmRename,
  } = useEventLifecycleCommands({
    requestMutation: application.request,
    persistenceCommands: appRuntime.persistenceCommands,
    flushPendingSave,
    runExclusiveRestore,
    activeEventName,
    eventToRename,
    eventLists,
    eventMetadata,
    executeModeItems,
    dayModes,
    mapData,
    mapRotationSettings,
    routeSettings,
    hallDefinitions,
    hallRouteSettings,
    mapViewportSettings,
    navigation: navigationCommands,
    notify: alert,
    clearSelection,
    setSelectedBlockFilters,
    closeEventUpdateForEvent: eventUpdateInvalidation.closeEventUpdateForEvent,
    setEventLists,
    setEventMetadata,
    updateExecuteModeItems,
    setDayModes,
    setMapData,
    setMapRotationSettings,
    setRouteSettings,
    setHallDefinitions,
    setHallRouteSettings,
    setMapViewportSettings,
    setFocusModeSessions,
    openRename: overlayCommands.event.openRename,
    confirmEventOverlay: overlayCommands.event.confirm,
  });

  const handleSortToggle = () => {
    clearSelection();
    setBlockSortDirection(null);
    setRecentlyChangedItemIds(new Set());
    const currentIndex = sortCycle.indexOf(sortState);
    const nextIndex = (currentIndex + 1) % sortCycle.length;
    setSortState(sortCycle[nextIndex]);
  };

  const handleEditRequest = (item: ShoppingItem) => {
    overlayCommands.item.openEdit(item);
  };

  const handleDeleteRequest = useCallback(
    (item: ShoppingItem) => {
      overlayCommands.item.openDelete(item);
    },
    [overlayCommands.item],
  );

  const handleDeleteItemFromMap = useCallback(
    (itemId: string) => {
      const item = firstItemById.get(itemId);
      if (item) overlayCommands.item.openDelete(item);
    },
    [firstItemById, overlayCommands.item],
  );

  const handleClearNewItemDefaults = useCallback(() => {
    setNewItemDefaults(null);
  }, [setNewItemDefaults]);

  const handleModeChangeFromFocus = useCallback(
    (mode: "edit" | "execute", lastItemId?: string) =>
      handleSetViewMode(mode, lastItemId),
    [handleSetViewMode],
  );

  const handleDoneEditing = () => {
    if (itemToEdit?.eventDate) {
      setItemToEdit(null);
      if (activeEventName) {
        navigationCommands.openEvent(activeEventName, itemToEdit.eventDate);
      } else {
        handleShowEventList();
      }
    } else {
      setItemToEdit(null);
      alert("参加日がないため処理を停止しました。");
      handleShowEventList();
    }
  };

  const handleToggleBlockFilter = useCallback(
    (block: string) => {
      clearRangeSelection();
      toggleBlockFilter(block);
    },
    [clearRangeSelection, toggleBlockFilter],
  );
  const handleClearBlockFilters = useCallback(() => {
    clearRangeSelection();
    clearBlockFilters();
  }, [clearBlockFilters, clearRangeSelection]);

  const handleToggleSpaceCollapse = useCallback(
    (spaceKey: string) => {
      clearRangeSelection();
      toggleCollapsedSpace(spaceKey);
    },
    [clearRangeSelection, toggleCollapsedSpace],
  );

  const handleToggleAllSpaceCollapse = useCallback(
    (collapse: boolean) => {
      clearRangeSelection();
      if (!collapse) {
        setCollapsedSpaces(new Set());
      } else {
        const allGroupKeys = new Set<string>();
        items
          .filter(
            (item) =>
              normalizeExecutionVisitDay(item.eventDate) ===
              normalizeExecutionVisitDay(activeEventDate),
          )
          .forEach((item) => {
            const spaceKey = getSpaceKey(item.block, item.number);
            const priority = item.priorityLevel || "none";
            const groupKey =
              priority !== "none" ? `${spaceKey}:${priority}` : spaceKey;
            allGroupKeys.add(groupKey);
          });
        setCollapsedSpaces(allGroupKeys);
      }
    },
    [activeEventDate, clearRangeSelection, items, setCollapsedSpaces],
  );

  const handleExecuteToggleSpaceCollapse = useCallback(
    (spaceKey: string) => {
      clearRangeSelection();
      toggleExecuteCollapsedSpace(spaceKey);
    },
    [clearRangeSelection, toggleExecuteCollapsedSpace],
  );

  const handleExecuteToggleAllSpaceCollapse = useCallback(
    (collapse: boolean) => {
      clearRangeSelection();
      if (!collapse) {
        setExecuteCollapsedSpaces(new Set());
      } else {
        if (!activeEventName) return;
        const currentEventDate = activeEventDate;
        const executeIds =
          recordEntry(executeModeItems, activeEventName)?.[currentEventDate] ||
          [];
        const itemsMap = new Map(items.map((item) => [item.id, item]));
        const allGroupKeys = new Set<string>();
        executeIds.forEach((id) => {
          const item = itemsMap.get(id);
          if (!item) return;
          const spaceKey = getSpaceKey(item.block, item.number);
          const priority = item.priorityLevel || "none";
          const groupKey =
            priority !== "none" ? `${spaceKey}:${priority}` : spaceKey;
          allGroupKeys.add(groupKey);
        });
        setExecuteCollapsedSpaces(allGroupKeys);
      }
    },
    [
      activeEventDate,
      activeEventName,
      clearRangeSelection,
      executeModeItems,
      items,
      setExecuteCollapsedSpaces,
    ],
  );

  const {
    backupFileInputRef,
    isBackupRestoreStopped,
    cancelXlsxOperation,
    handleExportEvent,
    previewEventExport,
    handleBackupExport,
    handlePersistenceRecoveryExport,
    handleBackupRestoreRequest,
    handleBackupRestoreCancel,
    handleBackupFileImport,
    handleBackupRestore: restoreBackup,
    handleConfirmExport,
    handleExportFileImport,
  } = useEventTransferCommands({
    requestMutation: application.request,
    readExportSnapshot: () => {
      application.flushDraft();
      return application.coordinator.readExportSnapshot();
    },
    createBackupFile: () => {
      if (!application.getWriteStopReason()) application.flushDraft();
      return application.coordinator.createBackupFile();
    },
    eventConsistency,
    appRuntime,
    eventLists,
    eventMetadata,
    executeModeItems,
    dayModes,
    mapData,
    mapRotationSettings,
    routeSettings,
    hallDefinitions,
    hallRouteSettings,
    mapViewportSettings,
    startupState,
    exportEventName,
    pendingBackup,
    pendingXlsxRestoreCompletion,
    navigationCommands: {
      openEvent: (eventName, tab, view) => {
        navigationCommands.openEvent(eventName, tab, view);
        finishMapEditorTransitionRef.current();
      },
      showEventList: () => {
        navigationCommands.showEventList();
        finishMapEditorTransitionRef.current();
      },
    },
    clearSelection,
    runExclusiveRestore,
    openExport: overlayCommands.event.openExport,
    confirmEventOverlay: overlayCommands.event.confirm,
    openBackupRestore: overlayCommands.backup.openRestore,
    confirmBackupRestore: overlayCommands.backup.confirm,
    closeBackupRestore: overlayCommands.backup.close,
    stopWrites: application.stopWrites,
    startXlsxOperation: overlayCommands.status.startXlsxOperation,
    updateXlsxOperation: overlayCommands.status.updateXlsxOperation,
    clearXlsxOperation: overlayCommands.status.clearXlsxOperation,
    setEventLists,
    setEventMetadata,
    setExecuteModeItemsCommitted,
    setDayModes,
    setMapData,
    setMapRotationSettings,
    setRouteSettings,
    setHallDefinitions,
    setHallRouteSettings,
    setMapViewportSettings,
  });
  const commitEventUpdateState = useCallback(
    async (
      nextState: EventUpdateCommitState,
      assertCurrent: ApplicationSnapshotGuard,
      context: ApplicationSnapshotCommitContext,
    ): Promise<boolean> => {
      await commitApplicationSnapshotPatch(
        {
          eventLists: nextState.eventLists,
          eventMetadata: nextState.eventMetadata,
          executeModeItems: nextState.executeModeItems,
        },
        undefined,
        context,
        assertCurrent,
      );

      return true;
    },
    [commitApplicationSnapshotPatch],
  );
  const {
    handleUpdateEvent,
    handleDuplicateEventResolution,
    handleDuplicateEventCancel,
    handleCancelUpdate,
    handleConfirmUpdate,
    handleUrlUpdate,
    handleUrlUpdateCancel,
    invalidateEventUpdateForEvent,
    isEventUpdateSaving,
    currentUpdateOperationId,
    currentUpdateUrlDraft,
  } = useEventUpdateCommands({
    state: {
      eventLists,
      getEventGeneration: application.coordinator.generation,
      eventMetadata,
      pendingDuplicateEvent,
      pendingEventUpdate,
      pendingUpdateEventName,
      eventListsRef,
      eventMetadataRef,
      executeModeItemsRef,
      pendingEventUpdateBaseItemsRef,
      eventUpdatePreviewEpochRef,
      eventUpdateOperationsRef,
    },
    actions: {
      applyBulkAdd,
      commitEventUpdateState,
      openEventUpdate: overlayCommands.event.openUpdate,
      openUrlUpdate: overlayCommands.event.openUrlUpdate,
      closeEventOverlay: overlayCommands.event.close,
      confirmEventOverlay: overlayCommands.event.confirm,
    },
    effects: {
      notify: (message) => alert(message),
      reportError: (message) => console.error(message),
    },
  });

  invalidateEventUpdateForEventRef.current = invalidateEventUpdateForEvent;

  const {
    requestPending: mapImportRequestPending,
    canCancel: canCancelMapImport,
    requestFileSelection: handleImportMapData,
    selectCapturedFile: selectCapturedMapFile,
    prepareImport: handleMapImportConfirm,
    confirmReimport: handleMapReimportConfirm,
    cancelReimport: handleMapReimportCancel,
    closeImport: handleMapImportClose,
  } = useMapImportCommands({
    fileInput: mapFileInputRef,
    state: {
      eventLists,
      executeModeItems,
      mapData,
      mapRotationSettings,
      routeSettings,
      hallDefinitions,
      hallRouteSettings,
      mapViewportSettings,
      pendingEventName: mapImportPendingEventName,
      importSessionId:
        overlayController.state.mapImport.kind === "inactive"
          ? null
          : overlayController.state.mapImport.requestId,
      eventConsistency,
      pendingReimport: pendingMapReimport,
      mapViewActive,
    },
    actions: {
      setEventLists,
      setMapData,
      setMapRotationSettings,
      setRouteSettings,
      setHallDefinitions,
      setHallRouteSettings,
      setMapViewportSettings,
      openImport: overlayCommands.mapImport.open,
      requestReimport: overlayCommands.mapImport.requestReimport,
      closeImportDialog: overlayCommands.mapImport.closeDialog,
      cancelReimport: overlayCommands.mapImport.cancelReimport,
      confirmReimport: overlayCommands.mapImport.confirmReimport,
    },
    settings: {
      startImportMutation: (intent) => {
        const id = crypto.randomUUID();
        const result = application.request({ ...intent, id });
        return {
          result,
          cancel: () => application.cancelPendingMutation(id),
          getState: () => application.getPendingMutationState(id),
          subscribe: (listener) =>
            application.subscribePendingMutationState(id, listener),
        };
      },
      requestMutation: application.request,
      commitApplicationSnapshotPatch,
    },
    navigation: {
      openEvent: navigationCommands.openEvent,
    },
    effects: {
      notify: (message) => alert(message),
      reportDiagnostic: (message) => console.error(message),
      onCommittedFailure: application.stopWrites,
    },
  });

  const {
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
  } = useMapEditorCommands({
    readCommittedSnapshot: () => application.rawRef.current,
    isEditorSessionCurrent: (session) =>
      activeMapEditorSessionRef.current?.sessionId === session.sessionId &&
      application.coordinator.generation(session.eventName) ===
        session.eventGeneration,
    state: {
      editorSession: overlayController.readModel.mapEditorSession,
      activeEventName,
      activeEventDate,
      isMapTab,
      currentMapTabName,
      currentMapData: currentMapData ?? undefined,
      eventLists,
      items,
      executeModeItemsRef,
      mapData,
      hallDefinitions,
      hallRouteSettings,
      visitListPanelMapTab,
      cellSelectionMode,
      vertexSelectionMode,
    },
    actions: {
      setMapData,
      setHallDefinitions,
      setHallRouteSettings,
      setEventLists,
      updateExecuteModeItems,
      commitExecuteModeItemsForEvent,
      setNewItemDefaults,
      setItemToEdit,
      navigation: navigationCommands,
      startCellSelection: overlayCommands.mapEditor.startCellSelection,
      toggleCellSelection: overlayCommands.mapEditor.toggleCellSelection,
      finishCellSelection: (pending) =>
        overlayCommands.mapEditor.finishCellSelection(pending ?? null),
      startVertexSelection: overlayCommands.mapEditor.startVertexSelection,
      toggleVertexSelection: overlayCommands.mapEditor.toggleVertexSelection,
      finishVertexSelection: (pending) =>
        overlayCommands.mapEditor.finishVertexSelection(pending ?? null),
    },
    selectors: {
      getMapTabForDate,
      getItemHallId,
      areItemsInSameHallGroup,
    },
    effects: {
      selectionEventTarget: window,
      notify: alert,
      onCommittedFailure: application.stopWrites,
    },
    persistence: { commitApplicationSnapshotPatch },
  });

  const endMapEditorSession = useCallback(() => {
    activeMapEditorSessionRef.current = null;
    overlayCommands.mapEditor.close();
  }, [overlayCommands.mapEditor]);
  finishMapEditorTransitionRef.current = endMapEditorSession;
  const approveMapEditorDiscard = useCallback(() => {
    if (!activeMapEditorSessionRef.current) return true;
    if (isEditorWritePending() || application.getWriteStopReason())
      return false;
    return window.confirm("地図の編集中の内容を破棄して移動しますか？");
  }, [application, isEditorWritePending]);
  const openMapEditor = useCallback(
    (editorKind: MapEditorSession["editorKind"]) => {
      if (
        !activeEventName ||
        !activeEventDate ||
        (editorKind !== "simple-hall-definition" && !currentMapTabName)
      )
        return;
      const session: MapEditorSession = Object.freeze({
        sessionId: crypto.randomUUID(),
        eventName: activeEventName,
        eventGeneration: application.coordinator.generation(activeEventName),
        day: activeEventDate,
        mapKey:
          editorKind === "simple-hall-definition"
            ? getMaplessKey(activeEventDate)
            : currentMapTabName!,
        editorKind,
      });
      activeMapEditorSessionRef.current = session;
      if (editorKind === "block-definition")
        overlayCommands.mapEditor.openBlockDefinition(null, session);
      else if (editorKind === "hall-definition")
        overlayCommands.mapEditor.openHallDefinition(null, session);
      else overlayCommands.mapEditor.openSimpleHallDefinition(session);
    },
    [
      activeEventName,
      activeEventDate,
      currentMapTabName,
      application,
      overlayCommands.mapEditor,
    ],
  );
  const currentMapExecuteItemIds = useMemo(() => {
    if (!activeEventName || !isMapTab || !activeEventDate) return [];

    const dayName = activeEventDate;

    return recordEntry(executeModeItems, activeEventName)?.[dayName] || [];
  }, [activeEventName, activeEventDate, isMapTab, executeModeItems]);

  const currentTabItems = useMemo(() => {
    if (!activeEventName || !eventDates.includes(activeTab)) return [];
    return listProjectors.day(items, activeTab, true);
  }, [items, activeTab, activeEventName, eventDates, listProjectors]);

  React.useEffect(() => {
    if (mapTabMenuOpen !== "mapToggle") return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        mapToggleMenuRef.current &&
        !mapToggleMenuRef.current.contains(e.target as Node) &&
        mapToggleButtonRef.current &&
        !mapToggleButtonRef.current.contains(e.target as Node)
      ) {
        setMapTabMenuOpen(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [mapTabMenuOpen, setMapTabMenuOpen]);

  const smartInsertLongPressRef = React.useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const smartInsertLongPressTriggeredRef = React.useRef(false);

  const {
    historyVersion: visitListHistoryVersion,
    openPanel: openVisitListPanel,
    updateOrder: handleVisitListOrderUpdate,
    saveChanges: handleVisitListConfirm,
    discardChanges: handleVisitListCancel,
    requestClose: handleVisitListClose,
    requestTabChange: requestVisitListTabChangeRaw,
    requestDayModeChange: requestVisitListDayModeChangeRaw,
    confirmPendingTransition: handleVisitListDialogConfirm,
    discardPendingTransition: handleVisitListDialogCancel,
  } = useMapVisitListCommands({
    readCurrentSnapshot: () => application.rawRef.current,
    requestMutation: application.request,
    state: {
      generation: activeEventName
        ? application.coordinator.generation(activeEventName)
        : 0,
      activeEventName,
      activeEventDate,
      isMapTab,
      currentMapTabName,
      executeModeItems: application.raw.executeModeItems,
      panelOpen: visitListPanelOpen,
      panelMapTab: visitListPanelMapTab,
      hasUnsavedChanges: visitListHasUnsavedChanges,
      originalOrder: visitListOriginalOrder,
      confirmDialogOpen: showVisitListConfirmDialog,
      pendingTabChange,
    },
    actions: {
      updateExecuteModeItems,
      openPanel: overlayCommands.visitList.open,
      setUnsaved: overlayCommands.visitList.setUnsaved,
      requestConfirmClose: overlayCommands.visitList.requestConfirmClose,
      closePanel: overlayCommands.visitList.endSession,
      confirmClose: overlayCommands.visitList.confirmClose,
      discardClose: overlayCommands.visitList.discardClose,
    },
    navigation: {
      navigateToTab,
    },
  });

  const requestVisitListTabChange = useCallback(
    (tab: ActiveTab, after?: () => void) => {
      if (showVisitListConfirmDialog || !approveMapEditorDiscard())
        return "ignored" as const;
      return requestVisitListTabChangeRaw(tab, after);
    },
    [
      showVisitListConfirmDialog,
      approveMapEditorDiscard,
      requestVisitListTabChangeRaw,
    ],
  );
  const requestVisitListDayModeChange = useCallback(
    (tab: ActiveTab) => {
      if (showVisitListConfirmDialog || !approveMapEditorDiscard())
        return "ignored" as const;
      return requestVisitListDayModeChangeRaw(tab);
    },
    [
      showVisitListConfirmDialog,
      approveMapEditorDiscard,
      requestVisitListDayModeChangeRaw,
    ],
  );
  const handleMapFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const file = input.files?.[0];
      const eventName = input.dataset.eventName;
      input.value = "";
      if (!file || showVisitListConfirmDialog || !approveMapEditorDiscard())
        return;
      requestVisitListTabChangeRaw(activeTab, () =>
        selectCapturedMapFile(file, eventName),
      );
    },
    [
      showVisitListConfirmDialog,
      approveMapEditorDiscard,
      requestVisitListTabChangeRaw,
      activeTab,
      selectCapturedMapFile,
    ],
  );
  const handleBackupRestore = useCallback(
    async (sourceEventName: string, targetEventName: string) => {
      if (
        restoreTransitionPendingRef.current ||
        showVisitListConfirmDialog ||
        !approveMapEditorDiscard()
      )
        throw new MutationCancelledError();
      restoreTransitionPendingRef.current = true;
      try {
        await new Promise<void>((resolve, reject) => {
          preserveMapEditorAtTabRef.current = activeTab;
          const result = requestVisitListTabChangeRaw(activeTab, () => {
            void restoreBackup(sourceEventName, targetEventName).then(
              resolve,
              reject,
            );
          });
          if (result === "ignored") {
            preserveMapEditorAtTabRef.current = null;
            reject(new MutationCancelledError());
          }
        });
      } finally {
        restoreTransitionPendingRef.current = false;
      }
    },
    [
      showVisitListConfirmDialog,
      approveMapEditorDiscard,
      activeTab,
      requestVisitListTabChangeRaw,
      restoreBackup,
    ],
  );
  const handleSelectEvent = useCallback(
    (eventName: string) => {
      requestVisitListTabChange(activeTab, () => selectEvent(eventName));
    },
    [requestVisitListTabChange, activeTab, selectEvent],
  );
  const handleShowEventList = useCallback(() => {
    requestVisitListTabChange("eventList");
  }, [requestVisitListTabChange]);

  const handleHighlightMapCell = useCallback(
    (row: number, col: number) => {
      setHighlightedMapCell({ row, col });
    },
    [setHighlightedMapCell],
  );

  const handleClearMapCellHighlight = useCallback(() => {
    setHighlightedMapCell(null);
  }, [setHighlightedMapCell]);

  const visitListItems = useMemo(() => {
    if (!visitListPanelMapTab || !activeEventName) return [];

    return selectMapVisitListItems({
      activeEventName,
      mapTabName: visitListPanelMapTab,
      dayName: activeEventDate,
      executeModeItems,
      items,
    });
  }, [
    visitListPanelMapTab,
    activeEventName,
    activeEventDate,
    items,
    executeModeItems,
  ]);

  const visitListHallOrder = useMemo(() => {
    if (!visitListPanelMapTab || !activeEventName) return [];

    const halls =
      recordEntry(hallDefinitions, activeEventName)?.[visitListPanelMapTab] ||
      [];
    const routeSettings = recordEntry(hallRouteSettings, activeEventName)?.[
      visitListPanelMapTab
    ];

    if (routeSettings?.hallOrder && routeSettings.hallOrder.length > 0) {
      return routeSettings.hallOrder;
    }

    return halls.map((h) => h.id);
  }, [
    visitListPanelMapTab,
    activeEventName,
    hallDefinitions,
    hallRouteSettings,
  ]);

  const mapTabDates = useMemo(
    () => eventDates.filter((date) => !!getMapTabForDate(date)),
    [eventDates, getMapTabForDate],
  );

  const hasUndefinedPriorityItems = useMemo((): boolean => {
    if (!activeEventName || !activeEventDate) return false;
    const ids =
      recordEntry(executeModeItems, activeEventName)?.[activeEventDate] || [];
    return ids.some((id) => {
      const it = firstItemById.get(id);
      if (!it) return false;
      const p = it.priorityLevel || "none";
      return p === "priority" || p === "highest";
    });
  }, [activeEventName, activeEventDate, executeModeItems, firstItemById]);

  const globalHallOrderHalls = useMemo((): HallDefinition[] => {
    if (!activeEventName) return [];
    const hasMap = !!globalHallOrderMapTabName;
    const mapHalls = hasMap
      ? recordEntry(hallDefinitions, activeEventName)?.[
          globalHallOrderMapTabName
        ] || []
      : [];
    const maplessKey = activeEventDate ? getMaplessKey(activeEventDate) : null;
    const maplessHalls = maplessKey
      ? recordEntry(hallDefinitions, activeEventName)?.[maplessKey] || []
      : [];
    return [...mapHalls, ...maplessHalls];
  }, [
    activeEventName,
    activeEventDate,
    globalHallOrderMapTabName,
    hallDefinitions,
  ]);

  const getGlobalHallItemCount = useCallback(
    (groupId: string): number => {
      if (!activeEventName || !activeEventDate) return 0;
      const executeIds =
        recordEntry(executeModeItems, activeEventName)?.[activeEventDate] || [];
      return computeGlobalHallItemCount({
        groupId,
        executeIds,
        items,
        getItemHallId,
      });
    },
    [activeEventName, activeEventDate, executeModeItems, items, getItemHallId],
  );

  const tabActionsRef = useRef({
    activeTab,
    activeEventName,
    eventDates,
    select: (_tab: ActiveTab, _callback?: () => void) => {},
    longPress: (_tab: ActiveTab) => {},
  });
  tabActionsRef.current = {
    activeTab,
    activeEventName,
    eventDates,
    select: (tab, callback) => {
      setMapTabMenuOpen(null);
      requestVisitListTabChange(tab, () => {
        setItemToEdit(null);
        clearSelection();
        setSelectedBlockFilters(new Set());
        setCandidateNumberSortDirection(null);
        setCollapsedSpaces(new Set());
        callback?.();
      });
    },
    longPress: (tab) => {
      requestVisitListDayModeChange(tab);
    },
  };
  const TabButton = useMemo<
    React.FC<{
      tab: ActiveTab;
      label: string;
      count?: number;
      onClick?: () => void;
    }>
  >(
    () =>
      function Tab({ tab, label, count, onClick }) {
        const current = tabActionsRef.current;
        return (
          <DayTabButton
            tab={tab}
            label={label}
            count={count}
            active={current.activeTab === tab}
            onSelect={() => tabActionsRef.current.select(tab, onClick)}
            onLongPress={
              current.activeEventName && current.eventDates.includes(tab)
                ? () => tabActionsRef.current.longPress(tab)
                : undefined
            }
          />
        );
      },
    [],
  );
  const baseFilteredItems = useMemo(
    () =>
      listProjectors.base({
        activeEventName,
        activeEventDate,
        currentTabItems,
        dayModes,
        executeColumnItems,
        sortState,
      }),
    [
      activeEventDate,
      activeEventName,
      currentTabItems,
      dayModes,
      executeColumnItems,
      sortState,
      listProjectors,
    ],
  );

  const temporaryVisibleItems = useMemo(
    () =>
      listProjectors.temporary({
        activeEventName,
        activeEventDate,
        dayModes,
        executeColumnItems,
        baseFilteredItems,
        recentlyChangedItemIds,
        sortState,
      }),
    [
      activeEventDate,
      activeEventName,
      baseFilteredItems,
      dayModes,
      executeColumnItems,
      recentlyChangedItemIds,
      sortState,
      listProjectors,
    ],
  );
  const temporaryVisibleCount = temporaryVisibleItems.length;

  const sortDisplayLabel = useMemo(
    () =>
      selectSortDisplayLabel({
        sortState,
        sortLabels,
        baseFilteredItems,
        temporaryVisibleCount,
      }),
    [baseFilteredItems, sortState, temporaryVisibleCount],
  );

  const { visibleItems } = useMemo(
    () =>
      listProjectors.visible({
        activeEventName,
        activeEventDate,
        currentTabItems,
        dayModes,
        executeColumnItems,
        baseFilteredItems,
        temporaryVisibleItems,
        sortState,
      }),
    [
      activeEventDate,
      activeEventName,
      baseFilteredItems,
      currentTabItems,
      dayModes,
      executeColumnItems,
      sortState,
      temporaryVisibleItems,
      listProjectors,
    ],
  );

  const deferredSearchKeyword = useDeferredValue(searchKeyword);
  const [pendingSearchNext, setPendingSearchNext] = useState<{
    keyword: string;
    id: number;
  } | null>(null);
  const searchNextSequence = useRef(0);
  const consumedSearchNext = useRef(0);
  const searchMatches = useMemo(
    () =>
      listProjectors.search({
        searchKeyword: deferredSearchKeyword,
        activeEventName,
        activeTab,
        eventDates,
        currentTabItems,
      }),
    [
      activeEventName,
      activeTab,
      currentTabItems,
      eventDates,
      deferredSearchKeyword,
      listProjectors,
    ],
  );

  const duplicateCircleItemIds = useMemo(
    () =>
      listProjectors.duplicates({
        activeEventName,
        activeTab,
        eventDates,
        currentTabItems,
      }),
    [activeEventName, activeTab, currentTabItems, eventDates, listProjectors],
  );

  const {
    availableBlocks,
    allBlocksForHallDefinition,
    blocksWithPriorityRemarks,
  } = useMemo(
    () =>
      listProjectors.blocks({
        activeEventName,
        activeEventDate,
        executeModeItems,
        currentTabItems,
      }),
    [
      activeEventDate,
      activeEventName,
      currentTabItems,
      executeModeItems,
      listProjectors,
    ],
  );

  const currentMaplessHalls = useMemo(
    () =>
      selectCurrentMaplessHalls({
        activeEventName,
        activeEventDate,
        hallDefinitions,
      }),
    [activeEventDate, activeEventName, hallDefinitions],
  );

  const candidateColumnItems = useMemo(
    () =>
      listProjectors.candidate({
        activeEventName,
        activeEventDate,
        executeModeItems,
        currentTabItems,
        selectedBlockFilters,
        candidateNumberSortDirection,
      }),
    [
      activeEventDate,
      activeEventName,
      candidateNumberSortDirection,
      currentTabItems,
      executeModeItems,
      selectedBlockFilters,
      listProjectors,
    ],
  );

  const visibleSearchMatches = useMemo(
    () =>
      selectVisibleSearchMatches({
        searchMatches,
        activeEventName,
        activeEventDate,
        dayModes,
        visibleItems,
        executeColumnItems,
        candidateColumnItems,
      }),
    [
      activeEventDate,
      activeEventName,
      candidateColumnItems,
      dayModes,
      executeColumnItems,
      searchMatches,
      visibleItems,
    ],
  );

  const searchContextKey = JSON.stringify([
    activeEventName,
    activeTab,
    activeEventDate,
    deferredSearchKeyword,
    currentMode,
    sortState,
    candidateNumberSortDirection,
    [...selectedBlockFilters].sort(),
    visibleSearchMatches,
  ]);
  const {
    searchScrollRequest,
    request: requestSearchScroll,
    consume: consumeSearchScrollRequest,
    clear: clearSearchScrollRequest,
  } = useSearchScrollRequest(searchContextKey);
  useEffect(() => {
    setCurrentSearchIndex(-1);
    setHighlightedItemId(null);
  }, [searchContextKey, setCurrentSearchIndex, setHighlightedItemId]);
  const handleSearchNext = useCallback(
    (keyword = searchKeyword) => {
      setSearchKeyword(keyword);
      setPendingSearchNext({ keyword, id: ++searchNextSequence.current });
    },
    [searchKeyword, setSearchKeyword],
  );
  useEffect(() => {
    if (
      !pendingSearchNext ||
      consumedSearchNext.current === pendingSearchNext.id ||
      deferredSearchKeyword !== pendingSearchNext.keyword
    )
      return;
    consumedSearchNext.current = pendingSearchNext.id;
    if (!deferredSearchKeyword.trim() || visibleSearchMatches.length === 0) {
      if (searchMatches.length && !visibleSearchMatches.length)
        alert("現在の絞り込み条件では一致する項目がありません。");
      return;
    }
    const nextIndex =
      ((currentSearchIndex < 0 ? -1 : currentSearchIndex) + 1) %
      visibleSearchMatches.length;
    setCurrentSearchIndex(nextIndex);
    setHighlightedItemId(visibleSearchMatches[nextIndex]);
    requestSearchScroll(visibleSearchMatches[nextIndex]);
  }, [
    pendingSearchNext,
    deferredSearchKeyword,
    visibleSearchMatches,
    searchMatches.length,
    currentSearchIndex,
    requestSearchScroll,
    setCurrentSearchIndex,
    setHighlightedItemId,
  ]);

  const {
    candidateMovePlan,
    executeMovePlan,
    hasCandidateSelection,
    hasExecuteSelection,
    showMoveButtons,
  } = useMemo(
    () =>
      listProjectors.movePlan({
        activeEventName,
        activeEventDate,
        currentMode,
        executeModeItems,
        items,
        selectedItemIds,
      }),
    [
      activeEventDate,
      activeEventName,
      currentMode,
      executeModeItems,
      items,
      selectedItemIds,
      listProjectors,
    ],
  );

  if (!isInitialized) {
    if (startupState.status === "recovery-required") {
      return (
        <PersistenceRecoveryScreen
          message={startupState.message}
          details={startupState.details}
          canExport={(startupState.recoveryBundle?.candidates.length ?? 0) > 0}
          isRetrying={startupState.isRetrying}
          candidates={startupState.recoveryBundle?.candidates ?? []}
          isAdopting={isAdoptingRecoveryCandidate}
          adoptionError={recoveryAdoptionError}
          onRetry={retryInitialization}
          onExport={handlePersistenceRecoveryExport}
          onAdopt={adoptRecoveryCandidate}
        />
      );
    }

    return (
      <main
        className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-slate-800 dark:bg-slate-900 dark:text-slate-100"
        aria-live="polite"
      >
        <p className="text-sm font-medium">保存データを確認しています…</p>
      </main>
    );
  }

  const mainContentVisible = eventDates.includes(activeTab);
  const duplicateDays = activeEventName
    ? duplicateEventDays(application.raw, activeEventName)
    : [];
  const selectedMap =
    activeEventName && activeEventDate
      ? resolveDayMap(
          recordEntry(mapData, activeEventName),
          activeEventDate,
          getDayConsistency(
            recordEntry(eventConsistency, activeEventName),
            activeEventDate,
          )?.selectedMapKey,
        )
      : null;

  const handleZoomChange = (newZoom: number) => {
    setZoomLevel(Math.max(15, Math.min(150, newZoom)));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 dark:bg-slate-900 dark:text-slate-200 font-sans">
      <MutationConfirmationDialog application={application} />
      {migrationNotices.length > 0 && (
        <section role="status" className="bg-amber-50 text-amber-950 p-3">
          <h2 className="font-bold">保存データの移行内容</h2>
          <ul>
            {migrationNotices.map((notice, index) => (
              <li key={index}>{notice}</li>
            ))}
          </ul>
          <button onClick={dismissMigrationNotices}>確認しました</button>
        </section>
      )}
      {application.retryableFailures.length > 0 && (
        <div
          role="alert"
          className="fixed bottom-4 left-4 right-4 z-[22000] bg-amber-100 text-amber-950 p-3 rounded shadow-lg"
        >
          保存に失敗しました。{application.retryableFailures.length}
          件の操作を未保存のまま保留しています。
          <button
            ref={conflictRetryButtonRef}
            onClick={application.retryPending}
            className="ml-4 underline"
          >
            保留中の保存を再試行
          </button>
          <button onClick={handleBackupExport} className="ml-4 underline">
            JSONバックアップを保存
          </button>
          <button
            onClick={application.discardPending}
            className="ml-4 underline"
          >
            保留中の操作を取り消す
          </button>
        </div>
      )}
      {application.failure && (
        <div role="alert" className="bg-red-100 text-red-900 p-3">
          {application.failure}
          {application.requiresReload ? (
            <button onClick={() => window.location.reload()} className="ml-4">
              再読み込み
            </button>
          ) : (
            <button onClick={application.clearFailure} className="ml-4">
              閉じる
            </button>
          )}
        </div>
      )}
      {activeEventName && (
        <LegacyConsistencyReview
          snapshot={application.raw}
          eventName={activeEventName}
          resolve={(identity, choice) =>
            application.request({
              events: [activeEventName],
              plan: (snapshot) =>
                planLegacyResolution(
                  snapshot,
                  activeEventName,
                  identity,
                  choice,
                ),
            })
          }
        />
      )}
      {activeEventName &&
        duplicateDays.map((day) => (
          <div key={day} className="bg-amber-100 text-amber-950 p-3">
            {day} に複数の保存先があります。
            <button
              className="underline ml-3"
              onClick={() => {
                void application
                  .request({
                    events: [activeEventName],
                    plan: (snapshot, choices) =>
                      planDayMerge(
                        snapshot,
                        activeEventName,
                        day,
                        undefined,
                        choices,
                      ),
                  })
                  .catch(() => {});
              }}
            >
              統合内容を確認
            </button>
          </div>
        ))}
      {activeEventName &&
        selectedMap &&
        (selectedMap.status === "selection-required" ||
          selectedMap.candidates.length > 1) && (
          <label className="block p-3 bg-amber-50 dark:bg-slate-800">
            利用するマップ
            <select
              aria-label="利用するマップ"
              className="ml-3 border rounded p-2 dark:bg-slate-700"
              value={selectedMap.status === "resolved" ? selectedMap.key : ""}
              onChange={(event) => {
                const key = event.target.value;
                if (!key) return;
                requestVisitListTabChange(activeTab, () => {
                  void application
                    .request({
                      events: [activeEventName],
                      plan: (snapshot) => {
                        const day = ensureDayConsistency(
                          recordEntry(
                            snapshot.eventConsistency,
                            activeEventName,
                          ),
                          activeEventDate,
                          [
                            recordEntry(
                              snapshot.executeModeItems,
                              activeEventName,
                            ),
                            recordEntry(snapshot.dayModes, activeEventName),
                          ],
                        );
                        const found = resolveDayMap(
                          recordEntry(
                            snapshot.mapData,
                            activeEventName,
                          ) as MapDataStore[string],
                          activeEventDate,
                          key,
                        );
                        if (found.status !== "resolved")
                          throw new Error("選択したマップが見つかりません。");
                        day.selectedMapKey = key;
                        return { snapshot };
                      },
                    })
                    .catch(() => {});
                });
              }}
            >
              <option value="">選択が必要です</option>
              {selectedMap.candidates.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
            {selectedMap.status === "selection-required" &&
              selectedMap.invalidSelection && (
                <span className="ml-2">
                  保存済みの選択先が失効しています:{" "}
                  {selectedMap.invalidSelection}
                </span>
              )}
          </label>
        )}
      <AppHeaderShell
        model={{
          navigation: {
            activeEventDate,
            activeEventName,
            activeTab,
            currentMode,
            eventDates,
            isMapTab,
          },
          map: {
            currentHalls,
            currentMapData,
            currentMapTabName,
            currentMapTabRotationState,
            globalHallOrderHalls,
            globalHallOrderMapTabName,
            hasUndefinedPriorityItems,
            mapHallSelectorOpen,
            mapIsRouteVisible,
            mapSelectedHallId,
            mapSmartInsertEnabled,
            mapSmartInsertMode,
            mapTabMenuOpen,
            mapToggleButtonRef,
            mapToggleLongPressFiredRef,
            mapToggleLongPressRef,
            mapToggleMenuRef,
            mapViewActive,
            smartInsertLongPressRef,
            smartInsertLongPressTriggeredRef,
          },
          list: {
            blockSortDirection,
            candidateMovePlan,
            currentSearchIndex,
            executeMovePlan,
            executeSpaceGroupingEnabled,
            hasCandidateSelection,
            hasExecuteSelection,
            items,
            searchKeyword,
            selectedItemIds,
            showMoveButtons,
            sortDisplayLabel,
            visibleSearchMatches,
          },
          preferences: {
            DEFAULT_OUTLINE_STYLE,
            DEFAULT_PURCHASE_STATUS_CONTROL_MODE,
            DEFAULT_SKIP_LIMITED_PURCHASE_FOR_SINGLE_QUANTITY,
            DEFAULT_UI_VISIBILITY,
            disableLimitedPurchaseQuantityCheck,
            disablePriceUndefinedCheck,
            numberCellOutlineStyle,
            postEventDistributionCheckEnabled,
            purchaseStatusControlMode,
            skipLimitedPurchaseForSingleQuantity,
            themeMode,
            uiVisibilitySettings: draftUIVisibilitySettings,
            zoomLevel,
          },
          ui: {
            layoutMode,
            mainContentVisible,
            showHeaderBar,
            showTabBar,
            TabButton,
            uiSettingsPanelOpen,
          },
        }}
        actions={{
          navigation: {
            getMapTabForDate,
            handleSetViewMode,
            onShowEventList: handleShowEventList,
            onShowImport: () => requestVisitListTabChange("import"),
            onToggleEventSurface: () => {
              if (approveMapEditorDiscard()) {
                endMapEditorSession();
                navigationCommands.toggleEventSurface();
              }
            },
          },
          map: {
            getHallExecuteCount,
            getHallTotalItemCount,
            handleMapTabRotationAngleChange,
            openVisitListPanel,
            setBlockDefinitionMode: (open) => {
              if (open) openMapEditor("block-definition");
            },
            setGlobalHallOrderPanelOpen: (open) => {
              if (open) overlayCommands.mapEditor.openGlobalHallOrder();
            },
            setHallDefinitionMode: (open) => {
              if (open) openMapEditor("hall-definition");
            },
            setMapHallSelectorOpen,
            setMapIsHallOrderOpen,
            setMapIsRouteVisible: handleSetMapRouteVisibility,
            setMapSelectedHallId,
            setMapSmartInsertEnabled,
            setMapSmartInsertMode,
            setMapTabMenuOpen,
            setSimpleHallDefinitionMode: (open) => {
              if (open) openMapEditor("simple-hall-definition");
            },
            showSmartInsertToast: (message, tone = "success") => {
              overlayCommands.status.showSmartInsertToast(message, tone);
            },
          },
          list: {
            handleBlockSortToggle,
            handleBlockSortToggleCandidate,
            handleBulkSort,
            handleClearRangeSelection: clearRangeSelection,
            handleClearSelection,
            handleMoveToExecuteColumn,
            handleRemoveFromExecuteColumn,
            handleSearchNext,
            handleSortToggle,
            setExecuteCollapsedSpaces,
            setExecuteSpaceGroupingEnabled,
            setItemToEdit,
            setSearchKeyword,
            setSelectedBlockFilters,
          },
          preferences: {
            handleZoomChange,
            setDisableLimitedPurchaseQuantityCheck,
            setDisablePriceUndefinedCheck,
            setNumberCellOutlineStyle,
            setPostEventDistributionCheckEnabled,
            setPurchaseStatusControlMode,
            setSkipLimitedPurchaseForSingleQuantity,
            setThemeMode,
            setUiVisibilitySettings: setDraftUIVisibilitySettings,
            updateUIVisibilityConfig,
          },
          ui: {
            onCloseUiSettingsPanel: closeUiSettingsPanel,
            onToggleUiSettingsPanel: toggleUiSettingsPanel,
            setLayoutMode,
          },
        }}
      />

      {rawHideSomething &&
        activeEventName &&
        (currentMode === "focus" || currentMode === "execute") && (
          <button
            onClick={() => {
              closeUiSettingsPanel({ resetVisibilityOverride: false });
              setUiVisibilityOverride((prev) => !prev);
            }}
            className={`fixed z-[110] flex h-10 w-10 touch-manipulation select-none items-center justify-center rounded-full shadow-lg transition-all [-webkit-tap-highlight-color:transparent] ${
              layoutMode === "smartphone" &&
              currentMode === "focus" &&
              focusModeMapVisible
                ? "left-3 top-[4.25rem]"
                : "left-3 top-3"
            } ${
              uiVisibilityOverride
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-white/80 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-600 backdrop-blur-sm border border-slate-200 dark:border-slate-600"
            }`}
            title={
              uiVisibilityOverride ? "自動表示に戻す" : "画面要素をすべて表示"
            }
            aria-label={
              uiVisibilityOverride ? "自動表示に戻す" : "画面要素をすべて表示"
            }
            type="button"
          >
            {uiVisibilityOverride ? (
              <svg
                className="w-5 h-5 pointer-events-none"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"
                />
              </svg>
            ) : (
              <svg
                className="w-5 h-5 pointer-events-none"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
            )}
          </button>
        )}

      <AcceptedItemCommandsProvider
        captureGuard={captureItemGuard}
        read={readAcceptedItem}
        commit={handleUpdateItems}
      >
        <AppMainContent
          eventGeneration={
            activeEventName
              ? application.coordinator.generation(activeEventName)
              : 0
          }
          model={{
            navigation: {
              activeEventDate,
              activeEventName,
              activeTab,
              currentMode,
              eventDates,
              isMapTab,
              mainContentVisible,
            },
            events: {
              eventLists,
              exportFileInputRef,
            },
            list: {
              availableBlocks,
              blocksWithPriorityRemarks,
              candidateColumnItems,
              candidateNumberSortDirection,
              collapsedSpaces,
              duplicateCircleItemIds,
              executeCollapsedSpaces,
              executeColumnItems,
              executeModeItems,
              executeSpaceGroupingEnabled,
              items,
              itemToEdit,
              retainedItemIds: retainedDialogItemIds,
              newItemDefaults,
              rangeEnd,
              rangeStart,
              selectedBlockFilters,
              selectedItemIds,
              showLateFilterButton,
              showPostponeFilterButton,
              spaceGroupingEnabled,
              visibleItems,
            },
            map: {
              mapOperationScope: JSON.stringify([
                activeEventName,
                activeEventName
                  ? application.coordinator.generation(activeEventName)
                  : 0,
                normalizeExecutionVisitDay(activeEventDate),
                currentMapTabName,
              ]),
              cellSelectionMode,
              currentHallRouteSettings,
              currentHalls,
              currentMapData,
              currentMapExecuteItemIds,
              currentMapTabName,
              currentMapTabRotationState,
              currentMapTabViewport,
              getHallOrderForDate,
              getHallsForDate,
              getMapDataForDate,
              getMapTabForDate,
              hallDefinitions,
              hallRouteSettings,
              highlightedItemId,
              searchScrollRequest,
              onSearchScrollRequestConsumed: consumeSearchScrollRequest,
              highlightedMapCell,
              mapData,
              mapIsHallOrderOpen,
              mapIsRouteVisible,
              mapSelectedHallId,
              mapSmartInsertEnabled,
              mapSmartInsertMode,
              vertexGuideOptions,
              vertexSelectionMode,
              visitListPanelOpen,
            },
            focus: {
              currentFocusMapRotationState,
              currentFocusResumeState,
              currentFocusSessionKey,
            },
            ui: {
              disableLimitedPurchaseQuantityCheck,
              disablePriceUndefinedCheck,
              layoutMode,
              numberCellOutlineStyle,
              postEventDistributionCheckEnabled,
              purchaseStatusControlMode,
              skipLimitedPurchaseForSingleQuantity,
              zoomLevel,
            },
          }}
          actions={{
            events: {
              handleBackupExport,
              handleBackupRestoreRequest,
              handleBulkAdd,
              handleDeleteEvent,
              handleExportEvent,
              handleImportMapData,
              handleRenameEvent,
              handleSelectEvent,
              handleUpdateEvent,
            },
            list: {
              handleActivateLateFilter,
              handleActivatePostponeFilter,
              handleBulkStatusChange,
              handleCandidateNumberSort,
              handleClearBlockFilters,
              handleClearNewItemDefaults,
              handleClearRangeSelection: clearRangeSelection,
              handleCollapseAndOpenNext,
              handleDeleteRequest,
              handleDoneEditing,
              handleEditRequest,
              handleExecuteItemUpdate,
              handleExecuteSpaceGroupOrderChange,
              handleExecuteToggleAllSpaceCollapse,
              handleExecuteToggleSpaceCollapse,
              handleMoveItem,
              handleMoveItemDown,
              handleMoveItemUp,
              handleMoveToExecuteColumn,
              handleRemoveFromExecuteColumn,
              handleSelectItem,
              handleSelectSpaceGroupForRange,
              handleSetSpaceGroupDragItemIds,
              handleToggleAllSpaceCollapse,
              handleToggleBlockFilter,
              handleToggleRangeSelection,
              handleToggleSpaceCollapse,
              handleUpdateItem,
              setCollapsedSpaces,
              setSpaceGroupingEnabled,
            },
            map: {
              handleAddNewItemFromMap,
              handleAddToExecuteListFromMap,
              handleAddToExecuteListFromMapAtPosition,
              handleBatchAddToExecuteListFromMap,
              handleBatchAddToExecuteListFromMapAtPosition,
              handleBatchRemoveFromExecuteListFromMap,
              handleDeleteItemFromMap,
              handleMapTabRotationAngleChange,
              handleMapViewportChange,
              handleMoveToFirstFromMap,
              handleMoveToLastFromMap,
              handleRemoveFromExecuteListFromMap,
              handleReorderExecuteListByHallOrder,
              handleUpdateHallRouteSettings,
              handleUpdateItemPriorityFromEdit,
              setMapIsHallOrderOpen,
              setMapIsRouteVisible: handleSetMapRouteVisibility,
              setMapSelectedHallId,
            },
            focus: {
              handleAddItemFromFocusMode,
              handleFocusMapRotationAngleChange,
              handleFocusSessionStateChange,
              handleModeChangeFromFocus,
              setFocusModeMapVisible,
            },
            ui: {
              setLayoutMode,
            },
          }}
        />
      </AcceptedItemCommandsProvider>

      <AppOverlayLayer
        overlay={overlayController.readModel}
        overlayCommands={overlayCommands}
        model={{
          item: {
            items,
            isEventUpdateSaving,
          },
          event: {
            activeEventDate,
            activeEventName,
            eventDates,
            eventMetadata,
            updateOperationId: currentUpdateOperationId,
            updateUrlDraft: currentUpdateUrlDraft,
          },
          mapEditor: {
            allBlocksForHallDefinition,
            currentHalls,
            currentMapData,
            currentMaplessHalls,
            getGlobalHallItemCount,
            getHallsForDate,
            globalHallOrderHalls,
            globalHallOrderRouteSettings,
            mapData,
            mapTabDates,
            vertexGuideOptions,
          },
          visitList: {
            visitListHistoryVersion,
            layoutMode,
            visitListHallOrder,
            visitListItems,
          },
          imports: {
            exportFileInputRef,
            mapFileInputRef,
            mapImportRequestPending,
            canCancelMapImport,
            mapImportSavedSettings: mapImportPendingEventName
              ? appRuntime.persistenceCommands.readBlockDetectionSettings(
                  mapImportPendingEventName,
                )
              : null,
          },
          list: {
            candidateMovePlan,
            currentMode,
            executeMovePlan,
            hasCandidateSelection,
            hasExecuteSelection,
            mainContentVisible,
            selectedItemIds,
            showHeaderBar,
            showMoveButtons,
            sortDisplayLabel,
            visibleItems,
          },
        }}
        actions={{
          item: {
            handleCancelUpdate,
            handleConfirmDelete,
            handleConfirmUpdate,
            handleUpdateHallOrderForPriorityChangeFromEdit,
            saveItemEdit: async (baseline, edited, selection) => {
              if (!activeEventName) return;
              await application.request({
                events: [activeEventName],
                retainOnConflict:
                  selection.kind === "unchanged" &&
                  (baseline.priorityLevel ?? "none") ===
                    (edited.priorityLevel ?? "none") &&
                  (
                    [
                      "eventDate",
                      "block",
                      "number",
                      "circle",
                      "manualHallId",
                    ] as const
                  ).every(
                    (field) =>
                      (baseline[field] ?? "") === (edited[field] ?? ""),
                  ),
                plan: (snapshot, choices) =>
                  planItemEdit(
                    snapshot,
                    activeEventName,
                    baseline,
                    edited,
                    selection,
                    choices,
                  ),
              });
            },
            previewItemEdit: (baseline, edited, selection) =>
              activeEventName
                ? previewItemEdit(
                    application.raw,
                    activeEventName,
                    baseline,
                    edited,
                    selection,
                  )
                : {
                    mapSelectionRequired: true,
                    status: "イベントが未選択です",
                    locationStatus: "確認できません",
                    halls: [],
                    details: [],
                  },
            handleUpdateItem,
          },
          event: {
            handleConfirmExport,
            previewEventExport,
            handleConfirmRename,
            handleUrlUpdate,
            handleUrlUpdateCancel,
            onShowEventList: handleShowEventList,
          },
          mapEditor: {
            handleCancelCellSelection,
            handleCancelVertexSelection,
            handleConfirmCellSelection,
            handleConfirmVertexSelection,
            handleReorderExecuteListByHallOrder,
            handleStartCellSelection,
            handleStartVertexSelection,
            handleSyncMaplessHallsToOtherDates,
            handleSyncPolygonHallsToOtherDates,
            handleUpdateBlocks,
            handleUpdateGlobalHallRouteSettings,
            handleUpdateHalls,
            handleUpdateMaplessHalls,
            setVertexGuideOptions,
          },
          visitList: {
            handleClearMapCellHighlight,
            handleHighlightMapCell,
            handleUpdateItemPriority,
            handleVisitListCancel,
            handleVisitListClose,
            handleVisitListConfirm,
            handleVisitListDialogCancel,
            handleVisitListDialogConfirm,
            handleVisitListOrderUpdate,
          },
          imports: {
            handleExportFileImport,
            handleMapFileChange,
            handleMapImportClose,
            handleMapImportConfirm,
            xlsxExecutionPort: appRuntime.xlsxCommands,
          },
          list: {
            handleBulkSort,
            handleClearSelection,
            handleMoveToExecuteColumn,
            handleRemoveFromExecuteColumn,
            handleSortToggle,
          },
        }}
      />
      <input
        ref={backupFileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleBackupFileImport}
        aria-label="バックアップファイルを選択"
      />
      {xlsxOperationActivity && (
        <section
          aria-label="Excel処理状況"
          className="fixed bottom-4 right-4 z-50 rounded-lg border border-slate-300 bg-white p-3 shadow-lg dark:border-slate-600 dark:bg-slate-800"
          data-xlsx-operation={xlsxOperationActivity.kind}
          data-xlsx-cancel-requested={
            xlsxOperationActivity.cancelRequested ? "true" : "false"
          }
        >
          <p role="status" aria-live="polite" className="text-sm">
            {xlsxOperationActivity.cancelRequested
              ? "Excel処理を取り消しています…"
              : xlsxOperationActivity.progress
                ? `Excel処理中: ${xlsxOperationActivity.progress.phase} ${xlsxOperationActivity.progress.completed}/${xlsxOperationActivity.progress.total}`
                : "Excel処理を開始しています…"}
          </p>
          <button
            type="button"
            className="mt-2 rounded bg-red-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            disabled={xlsxOperationActivity.cancelRequested}
            onClick={cancelXlsxOperation}
          >
            Excel処理を取り消す
          </button>
        </section>
      )}
      <BackupRestoreDialog
        requiresReload={isBackupRestoreStopped || application.requiresReload}
        isOpen={pendingBackup !== null}
        backupEventNames={
          pendingBackup ? Object.keys(pendingBackup.data.eventLists).sort() : []
        }
        currentEventNames={Object.keys(eventLists)}
        notices={
          pendingBackup?.notices?.map(
            (change) => `${change.path}: ${change.message}`,
          ) ?? []
        }
        onClose={() =>
          handleBackupRestoreCancel(
            overlayController.state.backup.kind === "restore"
              ? overlayController.state.backup.requestId
              : undefined,
          )
        }
        onRestore={handleBackupRestore}
      />
      <MapReimportConfirmationDialog
        isOpen={pendingMapReimport !== null}
        requestPending={mapImportRequestPending}
        canCancel={canCancelMapImport}
        plan={pendingMapReimport?.plan ?? null}
        onCancel={handleMapReimportCancel}
        onConfirm={handleMapReimportConfirm}
      />
      {pendingDuplicateEvent && (
        <DuplicateEventDialog
          analysis={pendingDuplicateEvent.analysis}
          existingEventNames={Object.keys(eventLists)}
          onResolve={(resolution) => {
            void handleDuplicateEventResolution(resolution);
          }}
          onCancel={() =>
            handleDuplicateEventCancel(pendingDuplicateEvent.updateOperationId)
          }
        />
      )}
      <PersistenceStatusIndicator
        status={
          application.retryableFailures.length
            ? "unsaved"
            : application.pendingCount
              ? "saving"
              : persistenceStatus
        }
        legacyCleanupStatus={legacyCleanupStatus}
        showRoutineStatus={
          uiSettingsPanelOpen
            ? draftUIVisibilitySettings.showPersistenceStatus
            : uiVisibilitySettings.showPersistenceStatus
        }
        failedStores={failedStores}
        failureDetails={failureDetails}
        onRetry={retrySave}
        onExportBackup={handleBackupExport}
      />
    </div>
  );
};

export default App;
