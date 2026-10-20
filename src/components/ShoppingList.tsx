import { useShoppingDragWorkspace } from "../features/shopping-list/drag/ShoppingDragWorkspace";
import type {
  ShoppingDragMoveContext,
  ShoppingDragPresentation,
} from "../features/shopping-list/drag/shoppingDrag";
import { ItemGuardContext } from "../features/shopping-list/renderers/ViewportRowState";
import type { ItemContentGuard } from "../app/ports/PersistenceCommandPort";
import {
  rememberItemUpdateGuard,
  sameItemGuardTarget,
} from "../utils/itemContentGuard";
import {
  buildExecutionVisitProjectionKey as limitedVisitKey,
  normalizeExecutionVisitDay as limitedDay,
} from "../utils/visitProjection";
import { buildLimitedPurchaseDialogUpdate } from "../utils/limitedPurchaseIntent";
import {
  useStableCallback,
  useStableOptionalCallback,
} from "../hooks/useStableCallback";
import React, {
  useRef,
  useState,
  useMemo,
  useEffect,
  useCallback,
  useLayoutEffect,
  useReducer,
  useContext,
} from "react";
import ReactDOM from "react-dom";
import { indexedItem, itemPositions, stableItemIds } from "../utils/itemIndex";
import {
  createExecutionVisitIndex,
  createRoutingItemsProjector,
} from "../utils/executionVisitIndex";
import {
  AcceptedItemContext,
  ItemCommandContext,
} from "../features/shopping-list/renderers/ViewportRowState";
import {
  ShoppingItem,
  PurchaseStatus,
  PurchaseStatusControlMode,
} from "../types/item";
import { HallDefinition, DayMapData } from "../types/map";
import { getSpaceKey } from "../utils/spaceGrouping";
import {
  parseGroupId,
  buildGroupId,
  getHallIdForItem,
  groupItemsByHallOrder,
} from "../utils/hallGrouping";
import ShoppingItemCard from "./ShoppingItemCard";
import LimitedPurchaseDialog from "./LimitedPurchaseDialog";
import type {
  BulkLimitedMessageState,
  LimitedBulkDialogContext,
  LimitedBulkNotificationOwner,
  LimitedPurchaseDialogResult,
} from "../types/limitedPurchase";
import type { FocusModeAddItemReturn } from "../types/focus";
import GripVerticalIcon from "./icons/GripVerticalIcon";
import ChevronUpIcon from "./icons/ChevronUpIcon";
import ChevronDownIcon from "./icons/ChevronDownIcon";
import {
  clearLimitedPurchase,
  getActualPurchasedQuantity,
  getLimitedBulkInputTargetDecision,
  getLimitedBulkInputTargets,
  getPlannedQuantity,
  hasMissingLimitedPurchaseQuantity,
  isPriceRequiredStatus,
  isUndefinedPrice,
} from "../utils/purchaseQuantity";
import {
  computeLimitedBulkCancelDecision,
  computeLimitedBulkSubmitDecision,
} from "../utils/limitedBulkFlow";
import PostEventDistributionCheckDialog, {
  type PostEventDistributionCheckMode,
} from "./PostEventDistributionCheckDialog";
import {
  type PostEventDistributionAnswer,
  upsertPostEventDistributionRemark,
} from "../utils/postEventDistributionCheck";
import { buildVisitId } from "../features/space-navigation/domain/visitIdentity";
import {
  useExecutionSpaceNavigator,
  type ExecutionNavigationGuardFeedback,
} from "../features/space-navigation/hooks/useExecutionSpaceNavigator";
import { acquireBodyScrollLock } from "../utils/bodyScrollLock";
import { useModalFocusBoundary } from "../hooks/useModalFocusBoundary";
import { buildQuantityOptions } from "./quantityOptions";
import {
  buildRangePresentation,
  resolveRangeSelection,
  type RangeEndpoint,
  type RangePresentation,
} from "../features/lists/domain/rangeSelection";
import {
  createListRowsProjector,
  createShoppingListControllerState,
  createLocalStorageListRendererPreferenceAdapter,
  evaluateVirtualListEligibility,
  evaluateRetainedViewportEligibility,
  RetainedViewportListRenderer,
  revealViewportContent,
  findViewportRow,
  FullListRenderer,
  resolveListRendererPreference,
  selectListRenderer,
  shoppingListCommand,
  shoppingListControllerReducer,
  VirtualListRenderer,
  type ListRendererPreferencePort,
  type FullListRenderedItemRow,
  type ShoppingListControllerCommand,
  type ShoppingListControllerState,
  type ShoppingListItemRow,
  type ShoppingListRow,
  type ShoppingListRowGroupInput,
} from "../features/shopping-list";

type PriorityLevel = "none" | "priority" | "highest";

type LimitedMessageState = {
  message: string;
  tone: "info" | "warning";
};

interface HallGroup {
  groupId: string | null;
  hallId: string | null;
  hallName: string | null;
  hallColor?: string;
  priority: PriorityLevel;
  items: ShoppingItem[];
}

interface SpaceGroup {
  groupKey: string;
  spaceKey: string;
  displayName: string;
  items: ShoppingItem[];
  isCollapsed: boolean;
  priority: PriorityLevel;
  hallGroupId: string | null;
}

interface ShoppingListProps {
  items: ShoppingItem[];
  dragSourceItems?: readonly ShoppingItem[];
  dragExecuteOrder?: readonly string[];
  onUpdateItem: (
    item: ShoppingItem,
    baseline?: ShoppingItem,
    options?: { saveImmediately?: boolean },
  ) => void;
  onMoveItem: (
    dragId: string,
    hoverId: string,
    targetColumn?: "execute" | "candidate",
    sourceColumn?: "execute" | "candidate",
    context?: ShoppingDragMoveContext,
  ) => void;
  onEditRequest: (item: ShoppingItem) => void;
  onDeleteRequest: (item: ShoppingItem) => void;
  selectedItemIds: Set<string>;
  onSelectItem: (
    itemId: string,
    columnType: "execute" | "candidate" | undefined,
    presentation: RangePresentation,
  ) => void;
  onMoveToColumn?: (itemIds: string[]) => void;
  onRemoveFromColumn?: (itemIds: string[]) => void;
  columnType?: "execute" | "candidate";
  currentDay?: string;
  candidateNumberSortDirection?: "asc" | "desc" | null;
  rangeScopeId?: string;
  onMoveItemUp?: (
    itemId: string,
    targetColumn?: "execute" | "candidate",
  ) => void;
  onMoveItemDown?: (
    itemId: string,
    targetColumn?: "execute" | "candidate",
  ) => void;
  rangeStart?: RangeEndpoint | null;
  rangeEnd?: RangeEndpoint | null;
  onToggleRangeSelection?: (rangeItemIds: readonly string[]) => void;
  duplicateCircleItemIds?: Set<string>;
  highlightedItemId?: string | null;
  searchScrollRequest?: { itemId: string; requestId: number } | null;
  onSearchScrollRequestConsumed?: (requestId: number) => void;
  layoutMode?: "pc" | "smartphone";
  viewMode?: "edit" | "execute" | "focus";
  // ホールグループ化用のprops
  showHallGroups?: boolean;
  hallDefinitions?: HallDefinition[];
  hallOrder?: string[];
  mapData?: DayMapData | null;
  // スペースグループ化用のprops
  showSpaceGroups?: boolean;
  collapsedSpaces?: Set<string>;
  onToggleSpaceCollapse?: (spaceKey: string) => void;
  onToggleAllSpaceCollapse?: (collapse: boolean) => void;
  onSetSpaceGroupDragItemIds?: (itemIds: string[] | null) => void;
  onSelectSpaceGroupForRange?: (
    groupKey: string,
    allItemIds: string[],
    presentation: RangePresentation,
  ) => void;
  onAddItem?: (
    item: Omit<ShoppingItem, "id"> & { purchaseStatus?: PurchaseStatus },
  ) => FocusModeAddItemReturn;
  // 実行モード用: スペース内一括ステータス変更
  onBulkStatusChange?: (
    groupKey: string,
    targetStatus: PurchaseStatus,
    items: ShoppingItem[],
  ) => void;
  // 実行モード用: スペースグループの表示順序通知
  onSpaceGroupOrderChange?: (orderedGroupKeys: string[]) => void;
  // 実行モード用: 現スペース折りたたみ＋次スペース展開
  onCollapseAndOpenNext?: (currentGroupKey: string) => void;
  // 実行モード用: 最後のスペースグループで「後回しでフィルタ」ボタン表示
  showPostponeFilterButton?: boolean;
  onActivatePostponeFilter?: () => void;
  // 実行モード用: 後回しフィルタ中、最後のスペースグループで「遅参でフィルタ」ボタン表示
  showLateFilterButton?: boolean;
  onActivateLateFilter?: () => void;
  purchaseStatusControlMode?: PurchaseStatusControlMode;
  // 実行モード用: 価格未定チェック無効化設定（true のとき、購入済・価格未定でも次のスペースへ進める）
  disablePriceUndefinedCheck?: boolean;
  disableLimitedPurchaseQuantityCheck?: boolean;
  postEventDistributionCheckEnabled?: boolean;
  skipLimitedPurchaseForSingleQuantity: boolean;
  listRendererPreferencePort?: ListRendererPreferencePort;
  forceFullListRenderer?: boolean;
  retainedItemIds?: readonly string[];
  appZoomLevel?: number;
  recoveryActive?: boolean | null;
}

type PostEventDistributionCheckContext = {
  mode: PostEventDistributionCheckMode;
  targets: ShoppingItem[];
};

const getGroupDisplayName = (
  groupId: string | null,
  hallDefinitions: HallDefinition[],
): string => {
  if (groupId === null) return "ホール未定義";
  if (groupId === "undefined") return "ホール未定義";
  if (groupId === "undefined:highest") return "ホール未定義最優先";
  if (groupId === "undefined:priority") return "ホール未定義優先";

  const { hallId, priority } = parseGroupId(groupId);
  const hall = hallDefinitions.find((h) => h.id === hallId);
  const hallName = hall?.name || "ホール未定義";

  if (priority === "highest") return `${hallName}最優先`;
  if (priority === "priority") return `${hallName}優先`;
  return hallName;
};

const getGroupHeaderStyle = (
  groupId: string | null,
  hallDefinitions: HallDefinition[],
): { bgClass: string; borderColor: string } => {
  const { hallId, priority } = parseGroupId(groupId);
  const hall = hallDefinitions.find((h) => h.id === hallId);
  const baseColor = hall?.color || "#9CA3AF";

  if (priority === "highest") {
    return { bgClass: "bg-red-100 dark:bg-red-900/40", borderColor: "#EF4444" };
  }
  if (priority === "priority") {
    return {
      bgClass: "bg-orange-100 dark:bg-orange-900/40",
      borderColor: "#F97316",
    };
  }
  return { bgClass: "bg-slate-100 dark:bg-slate-800", borderColor: baseColor };
};

// Constants for drag-and-drop auto-scrolling
const SCROLL_SPEED = 20;
const TOP_SCROLL_TRIGGER_PX = 150;
const BOTTOM_SCROLL_TRIGGER_PX = 100;
const EMPTY_HALL_DEFINITIONS: HallDefinition[] = [];
const EMPTY_HALL_ORDER: string[] = [];
const EMPTY_DUPLICATE_CIRCLE_ITEM_IDS = new Set<string>();
const DEFAULT_LIST_RENDERER_PREFERENCE_PORT =
  createLocalStorageListRendererPreferenceAdapter();
const VIRTUAL_LIST_MINIMUM_ROW_COUNT = 80;
const FLAT_RANGE_ANIMATION_ITEM_LIMIT = 80;
const RETAINED_VIEWPORT_MINIMUM_ROW_COUNT = 32;
const VIRTUAL_LIST_ESTIMATED_ROW_HEIGHT_PX = 136;
const VIRTUAL_LIST_SUPPORTED_ZOOM_PERCENTS = [100] as const;

const readViewportZoomPercent = (): number | null => {
  if (typeof window === "undefined" || !window.visualViewport) return null;
  const scale = window.visualViewport.scale;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return Math.round(scale * 100);
};

const useViewportZoomPercent = (): number | null => {
  const [zoomPercent, setZoomPercent] = useState(readViewportZoomPercent);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const updateZoom = () => setZoomPercent(readViewportZoomPercent());
    viewport.addEventListener("resize", updateZoom);
    return () => viewport.removeEventListener("resize", updateZoom);
  }, []);

  return zoomPercent;
};

const colorPalette: Array<{ light: string; dark: string }> = [
  {
    light: "bg-red-50 dark:bg-red-950/30",
    dark: "bg-red-100 dark:bg-red-900/40",
  },
  {
    light: "bg-blue-50 dark:bg-blue-950/30",
    dark: "bg-blue-100 dark:bg-blue-900/40",
  },
  {
    light: "bg-yellow-50 dark:bg-yellow-950/30",
    dark: "bg-yellow-100 dark:bg-yellow-900/40",
  },
  {
    light: "bg-purple-50 dark:bg-purple-950/30",
    dark: "bg-purple-100 dark:bg-purple-900/40",
  },
  {
    light: "bg-green-50 dark:bg-green-950/30",
    dark: "bg-green-100 dark:bg-green-900/40",
  },
  {
    light: "bg-pink-50 dark:bg-pink-950/30",
    dark: "bg-pink-100 dark:bg-pink-900/40",
  },
  {
    light: "bg-cyan-50 dark:bg-cyan-950/30",
    dark: "bg-cyan-100 dark:bg-cyan-900/40",
  },
  {
    light: "bg-orange-50 dark:bg-orange-950/30",
    dark: "bg-orange-100 dark:bg-orange-900/40",
  },
  {
    light: "bg-indigo-50 dark:bg-indigo-950/30",
    dark: "bg-indigo-100 dark:bg-indigo-900/40",
  },
  {
    light: "bg-lime-50 dark:bg-lime-950/30",
    dark: "bg-lime-100 dark:bg-lime-900/40",
  },
  {
    light: "bg-rose-50 dark:bg-rose-950/30",
    dark: "bg-rose-100 dark:bg-rose-900/40",
  },
  {
    light: "bg-sky-50 dark:bg-sky-950/30",
    dark: "bg-sky-100 dark:bg-sky-900/40",
  },
  {
    light: "bg-amber-50 dark:bg-amber-950/30",
    dark: "bg-amber-100 dark:bg-amber-900/40",
  },
  {
    light: "bg-violet-50 dark:bg-violet-950/30",
    dark: "bg-violet-100 dark:bg-violet-900/40",
  },
  {
    light: "bg-emerald-50 dark:bg-emerald-950/30",
    dark: "bg-emerald-100 dark:bg-emerald-900/40",
  },
  {
    light: "bg-fuchsia-50 dark:bg-fuchsia-950/30",
    dark: "bg-fuchsia-100 dark:bg-fuchsia-900/40",
  },
  {
    light: "bg-teal-50 dark:bg-teal-950/30",
    dark: "bg-teal-100 dark:bg-teal-900/40",
  },
  {
    light: "bg-slate-50 dark:bg-slate-950/30",
    dark: "bg-slate-100 dark:bg-slate-900/40",
  },
  {
    light: "bg-gray-50 dark:bg-gray-950/30",
    dark: "bg-gray-100 dark:bg-gray-900/40",
  },
  {
    light: "bg-stone-50 dark:bg-stone-950/30",
    dark: "bg-stone-100 dark:bg-stone-900/40",
  },
  {
    light: "bg-neutral-50 dark:bg-neutral-950/30",
    dark: "bg-neutral-100 dark:bg-neutral-900/40",
  },
  {
    light: "bg-zinc-50 dark:bg-zinc-950/30",
    dark: "bg-zinc-100 dark:bg-zinc-900/40",
  },
  {
    light: "bg-red-100 dark:bg-red-900/40",
    dark: "bg-red-200 dark:bg-red-800/50",
  },
  {
    light: "bg-blue-100 dark:bg-blue-900/40",
    dark: "bg-blue-200 dark:bg-blue-800/50",
  },
  {
    light: "bg-yellow-100 dark:bg-yellow-900/40",
    dark: "bg-yellow-200 dark:bg-yellow-800/50",
  },
  {
    light: "bg-purple-100 dark:bg-purple-900/40",
    dark: "bg-purple-200 dark:bg-purple-800/50",
  },
  {
    light: "bg-green-100 dark:bg-green-900/40",
    dark: "bg-green-200 dark:bg-green-800/50",
  },
  {
    light: "bg-pink-100 dark:bg-pink-900/40",
    dark: "bg-pink-200 dark:bg-pink-800/50",
  },
  {
    light: "bg-cyan-100 dark:bg-cyan-900/40",
    dark: "bg-cyan-200 dark:bg-cyan-800/50",
  },
  {
    light: "bg-orange-100 dark:bg-orange-900/40",
    dark: "bg-orange-200 dark:bg-orange-800/50",
  },
];

export const calculateBlockColors = (
  items: ShoppingItem[],
): Map<string, string> => {
  const colorMap = new Map<string, string>();
  // Purchases do not shift the palette or stripes of unrelated cards.
  const uniqueBlocks = new Set(items.map((item) => item.block));
  const sortedBlocks = Array.from(uniqueBlocks).sort((a, b) => {
    const numA = Number(a);
    const numB = Number(b);
    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }
    return a.localeCompare(b);
  });
  const blockColorMap = new Map<string, { light: string; dark: string }>();
  sortedBlocks.forEach((block, index) => {
    const colorIndex = index % colorPalette.length;
    blockColorMap.set(block, colorPalette[colorIndex]);
  });
  let previousBlock: string | undefined;
  let useDark = false;
  items.forEach((item) => {
    useDark = item.block === previousBlock ? !useDark : false;
    previousBlock = item.block;
    if (item.purchaseStatus === "None") {
      const blockColor = blockColorMap.get(item.block);
      if (blockColor) {
        colorMap.set(item.id, useDark ? blockColor.dark : blockColor.light);
      }
    }
  });
  return colorMap;
};

const getSpaceGroupKeyForItem = (
  item: ShoppingItem,
  columnType: "execute" | "candidate" | undefined,
): string => {
  const spaceKey = getSpaceKey(item.block, item.number);
  const priority =
    columnType === "candidate" ? "none" : item.priorityLevel || "none";

  return columnType === "candidate" || priority === "none"
    ? spaceKey
    : `${spaceKey}:${priority}`;
};

const getExecutionVisitIdForItem = (item: ShoppingItem): string =>
  buildVisitId({
    block: item.block,
    number: item.number,
    priorityLevel: item.priorityLevel,
  });

const ShoppingList: React.FC<ShoppingListProps> = ({
  items,
  dragSourceItems = items,
  dragExecuteOrder,
  onUpdateItem,
  onMoveItem,
  onEditRequest,
  onDeleteRequest,
  selectedItemIds: controlledSelectedItemIds,
  onSelectItem: onSelectItemProp,
  onMoveToColumn: _onMoveToColumn,
  onRemoveFromColumn: _onRemoveFromColumn,
  columnType,
  currentDay,
  candidateNumberSortDirection = null,
  rangeScopeId = "",
  onMoveItemUp: onMoveItemUpProp,
  onMoveItemDown: onMoveItemDownProp,
  rangeStart,
  rangeEnd,
  onToggleRangeSelection: onToggleRangeSelectionProp,
  duplicateCircleItemIds = EMPTY_DUPLICATE_CIRCLE_ITEM_IDS,
  highlightedItemId = null,
  searchScrollRequest = null,
  onSearchScrollRequestConsumed,
  layoutMode = "pc",
  viewMode = "edit",
  showHallGroups = false,
  hallDefinitions = EMPTY_HALL_DEFINITIONS,
  hallOrder = EMPTY_HALL_ORDER,
  mapData = null,
  showSpaceGroups = false,
  collapsedSpaces,
  onToggleSpaceCollapse: onToggleSpaceCollapseProp,
  onToggleAllSpaceCollapse,
  onSetSpaceGroupDragItemIds: onSetSpaceGroupDragItemIdsProp,
  onSelectSpaceGroupForRange: onSelectSpaceGroupForRangeProp,
  onAddItem: onAddItemProp,
  onBulkStatusChange: onBulkStatusChangeProp,
  onSpaceGroupOrderChange: onSpaceGroupOrderChangeProp,
  onCollapseAndOpenNext: onCollapseAndOpenNextProp,
  showPostponeFilterButton,
  onActivatePostponeFilter: onActivatePostponeFilterProp,
  showLateFilterButton,
  onActivateLateFilter: onActivateLateFilterProp,
  disablePriceUndefinedCheck = false,
  disableLimitedPurchaseQuantityCheck:
    _disableLimitedPurchaseQuantityCheck = false,
  postEventDistributionCheckEnabled = true,
  skipLimitedPurchaseForSingleQuantity,
  purchaseStatusControlMode = "cycle",
  listRendererPreferencePort = DEFAULT_LIST_RENDERER_PREFERENCE_PORT,
  forceFullListRenderer = false,
  retainedItemIds,
  appZoomLevel = 100,
  recoveryActive = false,
}) => {
  const onMoveItemUp = useStableOptionalCallback(onMoveItemUpProp);
  const onMoveItemDown = useStableOptionalCallback(onMoveItemDownProp);

  const onToggleSpaceCollapse = useStableOptionalCallback(
    onToggleSpaceCollapseProp,
  );
  const onSetSpaceGroupDragItemIds = useStableOptionalCallback(
    onSetSpaceGroupDragItemIdsProp,
  );
  const onSelectSpaceGroupForRange = useStableOptionalCallback(
    onSelectSpaceGroupForRangeProp,
  );
  const onAddItem = useStableOptionalCallback(onAddItemProp);
  const onBulkStatusChange = useStableOptionalCallback(onBulkStatusChangeProp);
  const onSpaceGroupOrderChange = useStableOptionalCallback(
    onSpaceGroupOrderChangeProp,
  );
  const onCollapseAndOpenNext = useStableOptionalCallback(
    onCollapseAndOpenNextProp,
  );
  const onActivatePostponeFilter = useStableOptionalCallback(
    onActivatePostponeFilterProp,
  );
  const onActivateLateFilter = useStableOptionalCallback(
    onActivateLateFilterProp,
  );
  const dragWorkspace = useShoppingDragWorkspace();
  const dragToken = useRef<symbol | null>(null);
  const dragGroupOwner = useRef(false);
  const dragOpacityElements = useRef(new Set<Element>());
  const markDragOpacity = useCallback((element: Element) => {
    element.classList.add("opacity-40");
    dragOpacityElements.current.add(element);
  }, []);
  const touchTargetColumn = useRef<"execute" | "candidate" | null>(null);
  const dragItem = useRef<string | null>(null);
  const dragSourceColumn = useRef<"execute" | "candidate" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const latestItemsRef = useRef(items);
  const captureItemGuard = useContext(ItemGuardContext);
  const limitedTargetsRef = useRef(
    new Map<string, { item: ShoppingItem; guard?: ItemContentGuard }>(),
  );
  const isCurrentLimitedTarget = useStableCallback((item: ShoppingItem) => {
    const target = limitedTargetsRef.current.get(item.id);
    if (
      !target ||
      limitedDay(target.item.eventDate) !== limitedDay(item.eventDate) ||
      limitedVisitKey(target.item) !== limitedVisitKey(item)
    )
      return false;
    if (
      target.guard &&
      captureItemGuard &&
      !sameItemGuardTarget(
        target.guard,
        captureItemGuard(item, target.guard.kind),
      )
    )
      return false;

    return true;
  });
  const readAcceptedItem = useContext(AcceptedItemContext);
  const commitItemCommands = useContext(ItemCommandContext);
  const latestCardCrudCallbacksRef = useRef({
    onDeleteRequest,
    onEditRequest,
    onUpdateItem,
  });
  useLayoutEffect(() => {
    latestItemsRef.current = items;
    latestCardCrudCallbacksRef.current = {
      onDeleteRequest,
      onEditRequest,
      onUpdateItem,
    };
  }, [items, onDeleteRequest, onEditRequest, onUpdateItem]);
  const getLatestItemById = useCallback(
    (itemId: string): ShoppingItem | undefined => {
      const rendered = indexedItem(latestItemsRef.current, itemId);
      return rendered
        ? readAcceptedItem
          ? readAcceptedItem(itemId)
          : rendered
        : undefined;
    },
    [readAcceptedItem],
  );
  const handleCardUpdateItem = useCallback(
    (item: ShoppingItem, saveImmediately = false) => {
      if (saveImmediately)
        latestCardCrudCallbacksRef.current.onUpdateItem(item, undefined, {
          saveImmediately: true,
        });
      else latestCardCrudCallbacksRef.current.onUpdateItem(item);
    },
    [],
  );
  const handleCardEditRequest = useCallback((item: ShoppingItem) => {
    latestCardCrudCallbacksRef.current.onEditRequest(item);
  }, []);
  const handleCardDeleteRequest = useCallback((item: ShoppingItem) => {
    latestCardCrudCallbacksRef.current.onDeleteRequest(item);
  }, []);
  const [limitedBulkDialogContext, setLimitedBulkDialogContext] =
    useState<LimitedBulkDialogContext | null>(null);
  const [limitedMessage, setLimitedMessage] =
    useState<LimitedMessageState | null>(null);
  const [bulkLimitedMessage, setBulkLimitedMessage] =
    useState<BulkLimitedMessageState | null>(null);
  const [
    postEventDistributionCheckContext,
    setPostEventDistributionCheckContext,
  ] = useState<PostEventDistributionCheckContext | null>(null);
  const activeLimitedBulkFlowTokenRef = useRef<symbol | null>(null);
  const limitedBulkNotificationOwnerRef =
    useRef<LimitedBulkNotificationOwner | null>(null);

  // タッチドラッグ用state/ref
  const touchDragActive = useRef(false);
  const touchLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const touchStartY = useRef(0);
  const touchStartX = useRef(0);
  const touchDragClone = useRef<HTMLElement | null>(null);
  const touchScrollInterval = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const touchDragSpaceGroupIds = useRef<string[] | null>(null);
  const touchDragSourceEl = useRef<HTMLElement | null>(null); // ドラッグ元要素（draggable復元用）
  const releaseTouchBodyScrollLock = useRef<(() => void) | null>(null);
  const activeDropTarget = useRef<{
    id: string;
    position: "top" | "bottom";
  } | null>(null);
  const localDragGuide = useRef<HTMLElement | null>(null);
  const setActiveDropTarget = useCallback(
    (target: { id: string; position: "top" | "bottom" } | null) => {
      if (
        activeDropTarget.current?.id === target?.id &&
        activeDropTarget.current?.position === target?.position &&
        localDragGuide.current?.isConnected
      )
        return;
      activeDropTarget.current = target;
      localDragGuide.current?.remove();
      localDragGuide.current = null;
      if (!target) return;
      const element = containerRef.current?.querySelector<HTMLElement>(
        `[data-item-id=${JSON.stringify(target.id)}]`,
      );
      if (!element) return;
      const line = document.createElement("div");
      line.dataset.shoppingDragGuide = "same-column";
      line.className = `absolute left-0 right-0 h-1.5 bg-blue-500 rounded-full z-30 pointer-events-none ${target.position === "top" ? "top-0" : "bottom-0"}`;
      element.classList.add("relative");
      element.append(line);
      localDragGuide.current = line;
    },
    [],
  );
  const [dragRuntimeActive, setDragRuntimeActive] = useState(false);
  const browserZoomPercent = useViewportZoomPercent();
  const viewportZoomPercent =
    browserZoomPercent === null
      ? null
      : (browserZoomPercent * appZoomLevel) / 100;

  const [expandedRemarks, setExpandedRemarks] = useState<Set<string>>(
    new Set(),
  );

  // 価格未定の購入済アイテムの価格欄を強調表示するためのアイテムIDセット
  const [priceHighlightItemIds, setPriceHighlightItemIds] = useState<
    Set<string>
  >(new Set());
  const [limitedMissingHighlightItemIds, setLimitedMissingHighlightItemIds] =
    useState<Set<string>>(new Set());
  const [
    deferredLimitedItemIdsByGroupKey,
    setDeferredLimitedItemIdsByGroupKey,
  ] = useState<Map<string, Set<string>>>(() => new Map());
  const showLimitedMessage = useCallback(
    (message: string | null, tone: LimitedMessageState["tone"] = "info") => {
      setLimitedMessage(message === null ? null : { message, tone });
    },
    [],
  );
  const displayOrderedItems = items;
  const handleExecutionNavigationGuardFeedback = useCallback(
    (feedback: ExecutionNavigationGuardFeedback) => {
      setPriceHighlightItemIds(new Set(feedback.priceItemIds));
      setLimitedMissingHighlightItemIds(new Set(feedback.limitedItemIds));
      showLimitedMessage(feedback.message, "warning");
    },
    [showLimitedMessage],
  );
  const { isInspecting } = useExecutionSpaceNavigator({
    enabled: viewMode === "execute" && columnType === "execute",
    registrationId: `execute:${currentDay ?? "all"}`,
    items: displayOrderedItems,
    layoutMode,
    showSpaceGroups,
    collapsedSpaces,
    onToggleSpaceCollapse,
    deferredLimitedItemIdsByGroupKey,
    disablePriceUndefinedCheck,
    disableLimitedPurchaseQuantityCheck: _disableLimitedPurchaseQuantityCheck,
    containerRef,
    onGuardFeedback: handleExecutionNavigationGuardFeedback,
  });

  const markLimitedPurchaseQuantityDeferred = useCallback(
    (item: ShoppingItem) => {
      if (viewMode !== "execute" || columnType !== "execute") {
        return;
      }

      const groupKey = getSpaceGroupKeyForItem(item, columnType);

      setDeferredLimitedItemIdsByGroupKey((previous) => {
        const next = new Map(previous);
        const itemIds = new Set(next.get(groupKey) ?? []);
        itemIds.add(item.id);
        next.set(groupKey, itemIds);
        return next;
      });
    },
    [columnType, viewMode],
  );

  const clearLimitedPurchaseQuantityDeferredForItem = useCallback(
    (itemId: string) => {
      setDeferredLimitedItemIdsByGroupKey((previous) => {
        let mutated = false;
        const next = new Map<string, Set<string>>();
        previous.forEach((itemIds, groupKey) => {
          if (!itemIds.has(itemId)) {
            next.set(groupKey, itemIds);
            return;
          }
          mutated = true;
          const updated = new Set(itemIds);
          updated.delete(itemId);
          if (updated.size > 0) {
            next.set(groupKey, updated);
          }
        });
        return mutated ? next : previous;
      });
    },
    [],
  );

  useEffect(() => {
    if (priceHighlightItemIds.size === 0) return;
    const remaining = new Set<string>();
    for (const id of priceHighlightItemIds) {
      const item = indexedItem(items, id);
      if (item && isPriceRequiredStatus(item) && isUndefinedPrice(item.price)) {
        remaining.add(id);
      }
    }
    if (remaining.size !== priceHighlightItemIds.size) {
      setPriceHighlightItemIds(remaining);
    }
  }, [items, priceHighlightItemIds]);

  useEffect(() => {
    if (limitedMissingHighlightItemIds.size === 0) return;
    const remaining = new Set<string>();
    for (const id of limitedMissingHighlightItemIds) {
      const item = indexedItem(items, id);
      if (item && hasMissingLimitedPurchaseQuantity(item)) {
        remaining.add(id);
      }
    }
    if (remaining.size !== limitedMissingHighlightItemIds.size) {
      setLimitedMissingHighlightItemIds(remaining);
    }
  }, [items, limitedMissingHighlightItemIds]);

  useEffect(() => {
    setDeferredLimitedItemIdsByGroupKey((previous) => {
      if (previous.size === 0) return previous;

      let mutated = false;
      const next = new Map<string, Set<string>>();

      previous.forEach((itemIds, groupKey) => {
        const retainedIds = new Set<string>();

        itemIds.forEach((itemId) => {
          const latest = indexedItem(items, itemId);
          if (
            latest &&
            latest.purchaseStatus === "LimitedPurchase" &&
            hasMissingLimitedPurchaseQuantity(latest) &&
            getSpaceGroupKeyForItem(latest, columnType) === groupKey
          ) {
            retainedIds.add(itemId);
          } else {
            mutated = true;
          }
        });

        if (retainedIds.size > 0) {
          next.set(groupKey, retainedIds);
        } else if (itemIds.size > 0) {
          mutated = true;
        }
      });

      return mutated ? next : previous;
    });
  }, [items, columnType]);

  useEffect(() => {
    if (!limitedMessage) return;
    const timer = window.setTimeout(() => showLimitedMessage(null), 2500);
    return () => window.clearTimeout(timer);
  }, [limitedMessage, showLimitedMessage]);

  useEffect(() => {
    if (!bulkLimitedMessage) return;
    const owner = limitedBulkNotificationOwnerRef.current;
    const timer = window.setTimeout(() => {
      if (limitedBulkNotificationOwnerRef.current === owner) {
        limitedBulkNotificationOwnerRef.current = null;
        setBulkLimitedMessage(null);
      }
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [bulkLimitedMessage]);

  const clearLimitedBulkMessage = useCallback((flowToken?: symbol) => {
    if (
      flowToken !== undefined &&
      limitedBulkNotificationOwnerRef.current?.flowToken !== flowToken
    ) {
      return;
    }
    limitedBulkNotificationOwnerRef.current = null;
    setBulkLimitedMessage(null);
  }, []);

  const showLimitedBulkMessage = useCallback(
    (message: string, flowToken: symbol) => {
      limitedBulkNotificationOwnerRef.current = { flowToken, message };
      setBulkLimitedMessage((current) => ({
        message,
        nonce: (current?.nonce ?? 0) + 1,
      }));
    },
    [],
  );

  const isLimitedBulkInputTarget = useCallback(
    (item: ShoppingItem): boolean =>
      getLimitedBulkInputTargetDecision(item, {
        skipLimitedPurchaseForSingleQuantity,
      }).isTarget,
    [skipLimitedPurchaseForSingleQuantity],
  );

  const isActiveLimitedBulkFlow = useCallback(
    (flowToken: symbol): boolean =>
      activeLimitedBulkFlowTokenRef.current === flowToken,
    [],
  );

  const finishLimitedBulkFlow = useCallback(
    (
      skipped: number,
      options: { flowToken?: symbol; preserveStartNotification?: boolean } = {},
    ) => {
      setLimitedBulkDialogContext((current) =>
        options.flowToken !== undefined &&
        current?.flowToken !== options.flowToken
          ? current
          : null,
      );
      if (
        options.flowToken === undefined ||
        activeLimitedBulkFlowTokenRef.current === options.flowToken
      ) {
        activeLimitedBulkFlowTokenRef.current = null;
      }
      if (skipped > 0) {
        showLimitedBulkMessage(
          `対象外になったアイテムを${skipped}件スキップしました`,
          options.flowToken ?? Symbol("limited-bulk-flow"),
        );
        return;
      }
      if (!options.preserveStartNotification) {
        clearLimitedBulkMessage(options.flowToken);
      }
    },
    [clearLimitedBulkMessage, showLimitedBulkMessage],
  );

  const advanceLimitedBulkToNextTarget = useCallback(
    (
      queueIds: string[],
      startIndex: number,
      skippedSoFar: number,
      preserveStartNotification: boolean,
      flowToken: symbol,
    ) => {
      let skipped = 0;
      for (let index = startIndex; index < queueIds.length; index += 1) {
        const latestItem = getLatestItemById(queueIds[index]);
        if (
          latestItem !== undefined &&
          isCurrentLimitedTarget(latestItem) &&
          isLimitedBulkInputTarget(latestItem)
        ) {
          setLimitedBulkDialogContext({
            itemSnapshot: latestItem,
            queueIds,
            index,
            skippedCount: skippedSoFar + skipped,
            preserveStartNotification,
            flowToken,
          });
          return;
        }
        skipped += 1;
      }
      finishLimitedBulkFlow(skippedSoFar + skipped, {
        flowToken,
        preserveStartNotification,
      });
    },
    [
      finishLimitedBulkFlow,
      getLatestItemById,
      isLimitedBulkInputTarget,
      isCurrentLimitedTarget,
    ],
  );

  const updateItemWithDeferredCleanup = useCallback(
    (updatedItem: ShoppingItem, saveImmediately = false) => {
      const shouldClearDefer =
        updatedItem.purchaseStatus !== "LimitedPurchase" ||
        !hasMissingLimitedPurchaseQuantity(updatedItem);

      if (shouldClearDefer) {
        clearLimitedPurchaseQuantityDeferredForItem(updatedItem.id);
      }

      handleCardUpdateItem(updatedItem, saveImmediately);
    },
    [clearLimitedPurchaseQuantityDeferredForItem, handleCardUpdateItem],
  );

  const updateItemsWithDeferredCleanup = useCallback(
    (updates: readonly ShoppingItem[], saveImmediately = false) => {
      if (!commitItemCommands) {
        updates.forEach((item) =>
          updateItemWithDeferredCleanup(item, saveImmediately),
        );
        return;
      }
      updates.forEach((item) => {
        if (
          item.purchaseStatus !== "LimitedPurchase" ||
          !hasMissingLimitedPurchaseQuantity(item)
        )
          clearLimitedPurchaseQuantityDeferredForItem(item.id);
      });
      commitItemCommands(updates, { saveImmediately });
    },
    [
      commitItemCommands,
      updateItemWithDeferredCleanup,
      clearLimitedPurchaseQuantityDeferredForItem,
    ],
  );
  const openPostEventDistributionCheck = useCallback(
    (mode: PostEventDistributionCheckMode, targets: ShoppingItem[]) => {
      if (!postEventDistributionCheckEnabled || targets.length === 0) return;
      setPostEventDistributionCheckContext({ mode, targets });
    },
    [postEventDistributionCheckEnabled],
  );

  const handlePostEventDistributionCheckApply = useCallback(
    (answers: { itemId: string; answer: PostEventDistributionAnswer }[]) => {
      const updates = answers.flatMap(({ itemId, answer }) => {
        const latestItem = getLatestItemById(itemId);
        return latestItem
          ? [
              {
                ...latestItem,
                remarks: upsertPostEventDistributionRemark(
                  latestItem.remarks,
                  answer,
                ),
              },
            ]
          : [];
      });
      updateItemsWithDeferredCleanup(updates, true);
      setPostEventDistributionCheckContext(null);
    },
    [getLatestItemById, updateItemsWithDeferredCleanup],
  );

  const handlePostEventDistributionCheckCancel = useCallback(() => {
    setPostEventDistributionCheckContext(null);
  }, []);

  const commitLimitedDialogResult = useStableCallback(
    (baseItem: ShoppingItem, result: LimitedPurchaseDialogResult) => {
      const updated = buildLimitedPurchaseDialogUpdate(baseItem, result);
      if (!updated) {
        showLimitedMessage(
          "購入予定量が変わりました。入力を確認して保存してください。",
          "warning",
        );
        return false;
      }
      if (result.kind === "defer")
        markLimitedPurchaseQuantityDeferred(baseItem);
      const guard = limitedTargetsRef.current.get(baseItem.id)?.guard;
      if (guard) rememberItemUpdateGuard(updated, guard);
      updateItemWithDeferredCleanup(updated);
      return true;
    },
  );

  const handleLimitedBulkSubmit = useCallback(
    (result: LimitedPurchaseDialogResult) => {
      if (limitedBulkDialogContext === null) return;

      const candidate = getLatestItemById(
        limitedBulkDialogContext.itemSnapshot.id,
      );
      const latestItem =
        candidate && isCurrentLimitedTarget(candidate) ? candidate : undefined;
      const isActiveFlow = isActiveLimitedBulkFlow(
        limitedBulkDialogContext.flowToken,
      );
      const submitDecision =
        latestItem === undefined
          ? computeLimitedBulkSubmitDecision({
              context: limitedBulkDialogContext,
              latestItem: undefined,
              isActiveFlow,
            })
          : computeLimitedBulkSubmitDecision({
              context: limitedBulkDialogContext,
              latestItem,
              decision: getLimitedBulkInputTargetDecision(latestItem, {
                skipLimitedPurchaseForSingleQuantity,
              }),
              isActiveFlow,
            });

      switch (submitDecision.kind) {
        case "stale":
          setLimitedBulkDialogContext((current) =>
            current?.flowToken === submitDecision.flowToken ? null : current,
          );
          return;

        case "notFound":
        case "notTarget":
          setLimitedBulkDialogContext(null);
          advanceLimitedBulkToNextTarget(
            limitedBulkDialogContext.queueIds,
            submitDecision.nextIndex,
            submitDecision.nextSkippedCount,
            limitedBulkDialogContext.preserveStartNotification,
            submitDecision.flowToken,
          );
          return;

        case "commit":
          if (!commitLimitedDialogResult(submitDecision.baseItem, result))
            return;
          setLimitedBulkDialogContext(null);
          advanceLimitedBulkToNextTarget(
            limitedBulkDialogContext.queueIds,
            submitDecision.nextIndex,
            submitDecision.nextSkippedCount,
            limitedBulkDialogContext.preserveStartNotification,
            submitDecision.flowToken,
          );
          return;

        default: {
          const _exhaustive: never = submitDecision;
          void _exhaustive;
        }
      }
    },
    [
      advanceLimitedBulkToNextTarget,
      commitLimitedDialogResult,
      isCurrentLimitedTarget,
      getLatestItemById,
      isActiveLimitedBulkFlow,
      limitedBulkDialogContext,
      skipLimitedPurchaseForSingleQuantity,
    ],
  );

  const handleLimitedBulkCancel = useCallback(() => {
    if (limitedBulkDialogContext === null) return;

    const cancelDecision = computeLimitedBulkCancelDecision({
      context: limitedBulkDialogContext,
      isActiveFlow: isActiveLimitedBulkFlow(limitedBulkDialogContext.flowToken),
    });

    switch (cancelDecision.kind) {
      case "stale":
        setLimitedBulkDialogContext((current) =>
          current?.flowToken === cancelDecision.flowToken ? null : current,
        );
        return;

      case "finish":
        finishLimitedBulkFlow(cancelDecision.skippedCount, {
          flowToken: cancelDecision.flowToken,
          preserveStartNotification: cancelDecision.preserveStartNotification,
        });
        return;

      default: {
        const _exhaustive: never = cancelDecision;
        void _exhaustive;
      }
    }
  }, [
    finishLimitedBulkFlow,
    isActiveLimitedBulkFlow,
    limitedBulkDialogContext,
  ]);

  const startLimitedBulkFlow = useCallback(
    (groupItems: ShoppingItem[]) => {
      limitedTargetsRef.current = new Map(
        groupItems.map((item) => [
          item.id,
          { item, guard: captureItemGuard?.(item, "limited-list") },
        ]),
      );
      const allAlreadyLimited =
        groupItems.length > 0 &&
        groupItems.every((item) => item.purchaseStatus === "LimitedPurchase");
      const flowToken = Symbol("limited-bulk-flow");
      activeLimitedBulkFlowTokenRef.current = flowToken;

      if (allAlreadyLimited) {
        setLimitedBulkDialogContext(null);
        const missing = groupItems.filter(hasMissingLimitedPurchaseQuantity);
        if (missing.length === 0) {
          showLimitedBulkMessage("解除対象の限数未入力はありません", flowToken);
          activeLimitedBulkFlowTokenRef.current = null;
          return;
        }
        if (
          !window.confirm(
            "実購入数が未入力の限数だけ未購入に戻します。よろしいですか？",
          )
        ) {
          activeLimitedBulkFlowTokenRef.current = null;
          return;
        }
        clearLimitedBulkMessage();
        missing.forEach((item) => {
          updateItemWithDeferredCleanup(
            clearLimitedPurchase({ ...item, purchaseStatus: "None" }),
          );
        });
        activeLimitedBulkFlowTokenRef.current = null;
        return;
      }

      const { targets, singleQuantitySkippedCount, baseTargetCount } =
        getLimitedBulkInputTargets(groupItems, {
          skipLimitedPurchaseForSingleQuantity,
        });
      const queueIds = targets.map((item) => item.id);
      if (queueIds.length === 0) {
        setLimitedBulkDialogContext(null);
        clearLimitedBulkMessage();
        if (baseTargetCount > 0 && singleQuantitySkippedCount > 0) {
          showLimitedBulkMessage(
            `数量1のアイテム${singleQuantitySkippedCount}件を除外したため、変更対象はありません`,
            flowToken,
          );
          activeLimitedBulkFlowTokenRef.current = null;
          return;
        }
        showLimitedBulkMessage("変更対象のアイテムはありません", flowToken);
        activeLimitedBulkFlowTokenRef.current = null;
        return;
      }
      if (singleQuantitySkippedCount > 0) {
        showLimitedBulkMessage(
          `数量1のアイテムを${singleQuantitySkippedCount}件スキップしました`,
          flowToken,
        );
      } else {
        clearLimitedBulkMessage();
      }
      advanceLimitedBulkToNextTarget(
        queueIds,
        0,
        0,
        singleQuantitySkippedCount > 0,
        flowToken,
      );
    },
    [
      advanceLimitedBulkToNextTarget,
      captureItemGuard,
      clearLimitedBulkMessage,
      showLimitedBulkMessage,
      skipLimitedPurchaseForSingleQuantity,
      updateItemWithDeferredCleanup,
    ],
  );

  const handleExecuteBulkStatusChange = useCallback(
    (
      groupKey: string,
      targetStatus: PurchaseStatus,
      groupItems: ShoppingItem[],
    ) => {
      if (isInspecting) return;
      if (targetStatus === "LimitedPurchase") {
        startLimitedBulkFlow(groupItems);
        return;
      }

      const allAlready = groupItems.every(
        (item) => item.purchaseStatus === targetStatus,
      );
      const hasLimitedPurchase = groupItems.some(
        (item) => item.purchaseStatus === "LimitedPurchase",
      );
      const targets = groupItems.filter(
        (item) => item.purchaseStatus !== "LimitedPurchase",
      );
      const changedItems = hasLimitedPurchase
        ? targets.filter((item) => item.purchaseStatus !== targetStatus)
        : targets;

      if (changedItems.length === 0) {
        showLimitedMessage("変更対象のアイテムはありません");
        return;
      }
      onBulkStatusChange?.(groupKey, targetStatus, changedItems);
      if (targetStatus === "SoldOut" && !allAlready) {
        openPostEventDistributionCheck("bulk", targets);
      }
    },
    [
      isInspecting,
      onBulkStatusChange,
      openPostEventDistributionCheck,
      showLimitedMessage,
      startLimitedBulkFlow,
    ],
  );

  const blockPriceOrLimitedMissingIfNeeded = useCallback(
    (groupKey: string, targetItems: ShoppingItem[]): boolean => {
      const priceMissing = targetItems.filter(
        (item) => isPriceRequiredStatus(item) && isUndefinedPrice(item.price),
      );
      const limitedMissing = targetItems.filter(
        hasMissingLimitedPurchaseQuantity,
      );
      const deferredItemIds = deferredLimitedItemIdsByGroupKey.get(groupKey);

      const isLimitedCheckDeferredForGroup =
        limitedMissing.length > 0 &&
        deferredItemIds !== undefined &&
        limitedMissing.every((item) => deferredItemIds.has(item.id));

      const blockedByPrice =
        !disablePriceUndefinedCheck && priceMissing.length > 0;
      const blockedByLimited =
        !_disableLimitedPurchaseQuantityCheck &&
        !isLimitedCheckDeferredForGroup &&
        limitedMissing.length > 0;

      setPriceHighlightItemIds(new Set(priceMissing.map((item) => item.id)));
      setLimitedMissingHighlightItemIds(
        blockedByLimited
          ? new Set(limitedMissing.map((item) => item.id))
          : new Set(),
      );

      if (blockedByPrice && blockedByLimited) {
        showLimitedMessage("価格と限数の実購入数を入力してください", "warning");
      } else if (blockedByPrice) {
        showLimitedMessage(
          "価格未定のアイテムがあります。価格を入力してください。",
          "warning",
        );
      } else if (blockedByLimited) {
        showLimitedMessage(
          "限数未入力があります。実購入数を入力してください",
          "warning",
        );
      } else {
        showLimitedMessage(null);
      }

      return blockedByPrice || blockedByLimited;
    },
    [
      _disableLimitedPurchaseQuantityCheck,
      deferredLimitedItemIdsByGroupKey,
      disablePriceUndefinedCheck,
      showLimitedMessage,
    ],
  );

  const limitedBulkDialogItemSnapshot = limitedBulkDialogContext?.itemSnapshot;

  // === アイテム追加ダイアログ ===
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogDefaults, setAddDialogDefaults] = useState({
    block: "",
    number: "",
  });
  const [addDialogCircleSuggestions, setAddDialogCircleSuggestions] = useState<
    string[]
  >([]);
  const [newItemForm, setNewItemForm] = useState({
    circle: "",
    title: "",
    price: "",
    quantity: "1",
    remarks: "",
    url: "",
    block: "",
    number: "",
    purchaseStatus: "None" as "None" | "Purchased" | "Postpone" | "Late",
  });
  const addDialogBaseId = React.useId();
  const addDialogRef = useRef<HTMLDivElement>(null);
  useModalFocusBoundary({
    isOpen: addDialogOpen && !isInspecting,
    dialogRef: addDialogRef,
  });
  const addDialogInputRef = useRef<HTMLInputElement>(null);
  const addDialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const addDialogIds = {
    title: `${addDialogBaseId}-title`,
    description: `${addDialogBaseId}-description`,
    circle: `${addDialogBaseId}-circle`,
    circleSuggestions: `${addDialogBaseId}-circle-suggestions`,
    itemTitle: `${addDialogBaseId}-item-title`,
    eventDate: `${addDialogBaseId}-event-date`,
    block: `${addDialogBaseId}-block`,
    number: `${addDialogBaseId}-number`,
    price: `${addDialogBaseId}-price`,
    quickPrice: `${addDialogBaseId}-quick-price`,
    quantity: `${addDialogBaseId}-quantity`,
    purchaseStatus: `${addDialogBaseId}-purchase-status`,
    remarks: `${addDialogBaseId}-remarks`,
    url: `${addDialogBaseId}-url`,
  };

  const addFormPriceOptions = useMemo(() => {
    const options: number[] = [0];
    for (let i = 100; i <= 15000; i += 100) {
      options.push(i);
    }
    return options;
  }, []);

  const openAddDialog = (
    block: string,
    number: string,
    circleSuggestions: string[] = [],
    returnFocusTarget?: HTMLElement,
  ) => {
    if (isInspecting) return;
    addDialogReturnFocusRef.current =
      returnFocusTarget ??
      (typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    setAddDialogDefaults({ block, number });
    setAddDialogCircleSuggestions(circleSuggestions);
    setNewItemForm({
      circle: "",
      title: "",
      price: "",
      quantity: "1",
      remarks: "",
      url: "",
      block,
      number,
      purchaseStatus: "None",
    });
    setAddDialogOpen(true);
  };

  const closeAddDialog = () => {
    setAddDialogOpen(false);
  };

  const handleAddDialogKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeAddDialog();
      return;
    }
    if (event.key !== "Tab") return;

    const dialogElement = addDialogRef.current;
    if (!dialogElement) return;
    const focusableElements = Array.from(
      dialogElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    if (!first || !last) return;

    if (
      event.shiftKey &&
      (document.activeElement === first ||
        !dialogElement.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last ||
        !dialogElement.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleAddItemSubmit = () => {
    if (isInspecting || !onAddItem || !newItemForm.circle.trim()) return;
    const price =
      newItemForm.price === "" ? null : parseInt(newItemForm.price, 10) || 0;
    onAddItem({
      eventDate: currentDay || "",
      block: newItemForm.block,
      number: newItemForm.number,
      circle: newItemForm.circle,
      title: newItemForm.title,
      price,
      quantity: parseInt(newItemForm.quantity, 10) || 1,
      remarks: newItemForm.remarks,
      url: newItemForm.url || undefined,
      purchaseStatus: newItemForm.purchaseStatus,
    });
    closeAddDialog();
  };

  useEffect(() => {
    if (!addDialogOpen) return;

    const releaseBodyScrollLock = acquireBodyScrollLock({
      lockOverscroll: true,
    });
    addDialogInputRef.current?.focus({ preventScroll: true });

    return () => {
      releaseBodyScrollLock();
      const returnFocus = addDialogReturnFocusRef.current;
      addDialogReturnFocusRef.current = null;
      if (returnFocus?.isConnected) {
        returnFocus.focus({ preventScroll: true });
      }
    };
  }, [addDialogOpen]);

  useEffect(() => {
    if (!isInspecting) return;
    setAddDialogOpen(false);
    setLimitedBulkDialogContext(null);
    setPostEventDistributionCheckContext(null);
  }, [isInspecting]);

  const formInputClass =
    "w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900 dark:text-white";
  const labelClass =
    "block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1";

  const hallGroups = useMemo((): HallGroup[] => {
    if (!showHallGroups) {
      return [
        {
          groupId: null,
          hallId: null,
          hallName: null,
          priority: "none",
          items,
        },
      ];
    }
    // ホール定義なしでも groupItemsByHallOrder 内で priority 別に 3 バケットに分けて返す
    const firstIndex = new Map(items.map((item, index) => [item.id, index]));
    return groupItemsByHallOrder(
      items,
      mapData,
      hallDefinitions,
      hallOrder,
    ).sort(
      (a, b) => firstIndex.get(a.items[0].id)! - firstIndex.get(b.items[0].id)!,
    );
  }, [items, showHallGroups, hallDefinitions, hallOrder, mapData]);

  const projectRoutingItems = useMemo(createRoutingItemsProjector, []);
  const routingItems = projectRoutingItems(items);
  const blockColorMap = useMemo(
    () => calculateBlockColors(routingItems),
    [routingItems],
  );

  const projectExecutionVisits = useMemo(
    () =>
      createExecutionVisitIndex((item) =>
        getSpaceGroupKeyForItem(item, columnType),
      ),
    [columnType],
  );
  const executionVisits = projectExecutionVisits(items).visits;
  const spaceGroupCache = useRef(
    new Map<
      string,
      {
        visit: (typeof executionVisits)[number];
        context: readonly unknown[];
        group: SpaceGroup;
      }
    >(),
  );
  const spaceGroups = useMemo((): SpaceGroup[] => {
    if (!showSpaceGroups) return [];
    const context = [columnType, collapsedSpaces, hallDefinitions, mapData];
    const nextCache = new Map<
      string,
      {
        visit: (typeof executionVisits)[number];
        context: readonly unknown[];
        group: SpaceGroup;
      }
    >();
    const sources = executionVisits;
    const output = sources.map((visit) => {
      const item = visit.items[0];
      const groupKey = getSpaceGroupKeyForItem(item, columnType);
      const cached = spaceGroupCache.current.get(groupKey);
      if (
        cached?.visit === visit &&
        context.every((value, index) => value === cached.context[index])
      ) {
        nextCache.set(groupKey, cached);
        return cached.group;
      }
      const spaceKey = getSpaceKey(item.block, item.number);
      const priority =
        columnType === "candidate"
          ? "none"
          : ((item.priorityLevel || "none") as PriorityLevel);
      const hallId =
        columnType !== "candidate" && hallDefinitions.length > 0 && mapData
          ? getHallIdForItem(item, mapData, hallDefinitions)
          : null;
      const group: SpaceGroup = {
        groupKey,
        spaceKey,
        displayName: spaceKey,
        items: visit.items,
        isCollapsed: collapsedSpaces?.has(groupKey) ?? false,
        priority,
        hallGroupId:
          columnType === "candidate" ? null : buildGroupId(hallId, priority),
      };
      nextCache.set(groupKey, { visit, context, group });
      return group;
    });
    spaceGroupCache.current = nextCache;
    return output;
  }, [
    columnType,
    collapsedSpaces,
    executionVisits,
    hallDefinitions,
    mapData,
    showSpaceGroups,
  ]);

  const shouldShowHallGroups =
    showHallGroups &&
    (hallDefinitions.length > 0 ||
      hallGroups.length > 1 ||
      (hallGroups.length === 1 && hallGroups[0].groupId !== null));

  const listRowGroups = useMemo<
    readonly ShoppingListRowGroupInput[] | undefined
  >(() => {
    if (showSpaceGroups) {
      return spaceGroups.map((group) => ({
        key: group.groupKey,
        label: group.displayName,
        items: group.items,
        collapsed: group.isCollapsed,
      }));
    }
    if (shouldShowHallGroups) {
      return hallGroups.map((group, groupIndex) => ({
        key: group.groupId ?? `ungrouped:${groupIndex}`,
        label: getGroupDisplayName(group.groupId, hallDefinitions),
        items: group.items,
      }));
    }
    return undefined;
  }, [
    hallDefinitions,
    hallGroups,
    shouldShowHallGroups,
    showSpaceGroups,
    spaceGroups,
  ]);

  const groupVisitIdByKey = useMemo(
    () =>
      new Map(
        listRowGroups?.map((group) => [
          group.key,
          group.items[0]
            ? getExecutionVisitIdForItem(group.items[0])
            : undefined,
        ]),
      ),
    [listRowGroups],
  );
  const getGroupVisitId = useCallback(
    (groupKey: string) => groupVisitIdByKey.get(groupKey),
    [groupVisitIdByKey],
  );
  const projectControllerRows = useMemo(createListRowsProjector, []);
  const projectDisplayRows = useMemo(createListRowsProjector, []);
  const listControllerModel = useMemo(() => {
    const visibleModel = projectControllerRows({
      items,
      groups: listRowGroups,
      column: columnType,
      duplicateCircleItemIds,
      highlightedItemId,
    });
    return {
      ...visibleModel,
      itemIds: stableItemIds(items),
    };
  }, [
    columnType,
    duplicateCircleItemIds,
    highlightedItemId,
    items,
    listRowGroups,
    projectControllerRows,
  ]);
  const listControllerModelMembershipKey = useMemo(
    () =>
      JSON.stringify([
        listControllerModel.itemIds,
        listControllerModel.rowKeys,
      ]),
    [listControllerModel.itemIds, listControllerModel.rowKeys],
  );

  const [listControllerState, dispatchListController] = useReducer(
    (
      state: ShoppingListControllerState,
      command: ShoppingListControllerCommand,
    ) => shoppingListControllerReducer(listControllerModel, state, command),
    createShoppingListControllerState(Array.from(controlledSelectedItemIds)),
  );
  const controlledSelectedItemIdsSignature = JSON.stringify(
    Array.from(controlledSelectedItemIds).sort(),
  );

  useEffect(() => {
    dispatchListController(
      shoppingListCommand.replaceSelection(
        JSON.parse(controlledSelectedItemIdsSignature) as string[],
      ),
    );
  }, [controlledSelectedItemIdsSignature]);

  useEffect(() => {
    dispatchListController(shoppingListCommand.reconcileModel());
  }, [listControllerModelMembershipKey]);

  const selectedItemIds = useMemo(
    () => new Set(listControllerState.selectedItemIds),
    [listControllerState.selectedItemIds],
  );

  const listReadModel = useMemo(
    () =>
      projectDisplayRows({
        items,
        groups: listRowGroups,
        column: columnType,
        selectedItemIds,
        duplicateCircleItemIds,
        highlightedItemId,
      }),
    [
      columnType,
      duplicateCircleItemIds,
      highlightedItemId,
      items,
      listRowGroups,
      selectedItemIds,
      projectDisplayRows,
    ],
  );

  const onToggleRangeSelection = useStableOptionalCallback(
    onToggleRangeSelectionProp
      ? (rangeItemIds: readonly string[]) => {
          dispatchListController(
            shoppingListCommand.toggleRangeSelection(rangeItemIds),
          );
          onToggleRangeSelectionProp(rangeItemIds);
        }
      : undefined,
  );

  const onSelectItem = useStableCallback(
    (
      itemId: string,
      sourceColumn: "execute" | "candidate" | undefined,
      presentation: RangePresentation,
    ) => {
      dispatchListController(shoppingListCommand.toggleSelection(itemId));
      onSelectItemProp(itemId, sourceColumn, presentation);
    },
  );

  const handleFocusedRowKeyChange = useCallback((rowKey: string | null) => {
    dispatchListController(shoppingListCommand.focusRow(rowKey));
    if (rowKey !== null) {
      dispatchListController(shoppingListCommand.requestScroll(rowKey));
    }
  }, []);

  const consumedSearchRequest = useRef<number | null>(null);
  const expandedSearchRequest = useRef<number | null>(null);
  useEffect(() => {
    if (
      !searchScrollRequest ||
      consumedSearchRequest.current === searchScrollRequest.requestId ||
      !items.some((item) => item.id === searchScrollRequest.itemId)
    )
      return;
    const group = listRowGroups?.find((group) =>
      group.items.some((item) => item.id === searchScrollRequest.itemId),
    );
    if (group?.collapsed) {
      if (expandedSearchRequest.current !== searchScrollRequest.requestId) {
        expandedSearchRequest.current = searchScrollRequest.requestId;
        onToggleSpaceCollapse?.(group.key);
      }
      return;
    }
    if (
      !listControllerModel.itemRows.some(
        (row) => row.itemId === searchScrollRequest.itemId,
      )
    )
      return;
    consumedSearchRequest.current = searchScrollRequest.requestId;
    dispatchListController(
      shoppingListCommand.requestItemScroll(searchScrollRequest.itemId),
    );
    onSearchScrollRequestConsumed?.(searchScrollRequest.requestId);
  }, [
    searchScrollRequest,
    onSearchScrollRequestConsumed,
    items,
    listRowGroups,
    listControllerModel,
    onToggleSpaceCollapse,
  ]);

  const handleScrollRequestConsumed = useCallback((requestId: number) => {
    dispatchListController(shoppingListCommand.consumeScroll(requestId));
  }, []);

  const handleFullListFocusCapture = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (!(event.target instanceof HTMLElement)) return;
      const rowElement = event.target.closest<HTMLElement>("[data-row-key]");
      if (!rowElement || !containerRef.current?.contains(rowElement)) return;
      handleFocusedRowKeyChange(rowElement.dataset.rowKey ?? null);
    },
    [handleFocusedRowKeyChange],
  );

  const handleFullListBlurCapture = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Node &&
        containerRef.current?.contains(nextTarget)
      ) {
        return;
      }
      handleFocusedRowKeyChange(null);
    },
    [handleFocusedRowKeyChange],
  );

  const listRendererPreference = useMemo(() => {
    try {
      return resolveListRendererPreference(listRendererPreferencePort.read());
    } catch {
      return "full";
    }
  }, [listRendererPreferencePort]);
  const virtualRuntimeAvailable =
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    typeof ResizeObserver === "function" &&
    typeof HTMLElement.prototype.focus === "function";
  const isSingleColumnVirtualShape =
    layoutMode === "smartphone" && !showSpaceGroups && !shouldShowHallGroups;
  const virtualListEligibility = evaluateVirtualListEligibility({
    runtimeAvailable: virtualRuntimeAvailable,
    columnCount: isSingleColumnVirtualShape ? 1 : 2,
    zoomPercent: viewportZoomPercent,
    supportedZoomPercents: VIRTUAL_LIST_SUPPORTED_ZOOM_PERCENTS,
    dragActive:
      dragRuntimeActive ||
      activeDropTarget.current !== null ||
      touchDragActive.current,
    modalActive:
      addDialogOpen ||
      limitedBulkDialogContext !== null ||
      postEventDistributionCheckContext !== null,
    recoveryActive,
    rowCount: listReadModel.rows.length,
    minimumRowCount: VIRTUAL_LIST_MINIMUM_ROW_COUNT,
    rowHeightPx: VIRTUAL_LIST_ESTIMATED_ROW_HEIGHT_PX,
    stableRowHeight: isSingleColumnVirtualShape,
    focusRestorationReady: virtualRuntimeAvailable,
    stableRowKeys: listReadModel.hasStableRowKeys,
  });
  const retainedViewportActivatedRef = useRef(false);
  const retainedViewportCapabilities = {
    runtimeAvailable:
      virtualRuntimeAvailable && typeof IntersectionObserver === "function",
    zoomPercent: viewportZoomPercent,
    recoveryActive,
    rowCount: listReadModel.rows.length,
    minimumRowCount: retainedViewportActivatedRef.current
      ? 1
      : RETAINED_VIEWPORT_MINIMUM_ROW_COUNT,
    estimatedRowHeightPx: VIRTUAL_LIST_ESTIMATED_ROW_HEIGHT_PX,
    stableRowKeys: listReadModel.hasStableRowKeys,
  };
  const retainedViewportEligibility = evaluateRetainedViewportEligibility(
    retainedViewportCapabilities,
  );
  // Keep the same normal-flow structure across the row-count threshold.
  const useRetainedViewportStructure =
    selectListRenderer(
      listRendererPreference,
      evaluateRetainedViewportEligibility({
        ...retainedViewportCapabilities,
        minimumRowCount: 0,
      }),
      { forceFull: forceFullListRenderer },
    ).engine === "virtual";
  const listRendererSelection = selectListRenderer(
    listRendererPreference,
    retainedViewportEligibility.eligible
      ? retainedViewportEligibility
      : virtualListEligibility,
    { forceFull: forceFullListRenderer },
  );
  const useRetainedViewport =
    listRendererSelection.engine === "virtual" &&
    retainedViewportEligibility.eligible;
  if (useRetainedViewport) retainedViewportActivatedRef.current = true;
  const GroupedListRenderer = useRetainedViewportStructure
    ? RetainedViewportListRenderer
    : FullListRenderer;
  const itemIndexById = itemPositions(items);
  const preferNativeOptions =
    (listRendererSelection.engine === "full" || useRetainedViewport) &&
    listReadModel.itemRows.length >= VIRTUAL_LIST_MINIMUM_ROW_COUNT;

  useLayoutEffect(() => {
    const scrollRequest = listControllerState.scrollRequest;
    if (
      !scrollRequest ||
      (listRendererSelection.engine !== "full" && !useRetainedViewport)
    )
      return;
    const rowElement = findViewportRow(
      containerRef.current,
      scrollRequest.rowKey,
    );
    if (useRetainedViewportStructure && rowElement) {
      revealViewportContent(rowElement);
      const frame = requestAnimationFrame(() => {
        const actual = findViewportRow(
          containerRef.current,
          scrollRequest.rowKey,
        );
        actual?.scrollIntoView?.({
          block: scrollRequest.alignment,
          behavior: "auto",
        });
        if (actual) handleScrollRequestConsumed(scrollRequest.requestId);
      });
      return () => cancelAnimationFrame(frame);
    }
    rowElement?.scrollIntoView?.({
      block: scrollRequest.alignment,
      behavior: "auto",
    });
    if (rowElement) handleScrollRequestConsumed(scrollRequest.requestId);
  }, [
    handleScrollRequestConsumed,
    listControllerState.scrollRequest,
    listRendererSelection.engine,
    useRetainedViewport,
    useRetainedViewportStructure,
  ]);

  const rangePresentation = useMemo((): RangePresentation => {
    if (showSpaceGroups) {
      const groups = spaceGroups.map((group) => ({
        key: group.groupKey,
        itemIds: group.items.map((item) => item.id),
      }));
      return buildRangePresentation({
        scopeKey: JSON.stringify([
          rangeScopeId,
          currentDay ?? null,
          columnType ?? null,
          viewMode,
          "space",
          groups,
          spaceGroups.map((group) => [group.groupKey, group.isCollapsed]),
        ]),
        grouping: "space",
        groups,
      });
    }

    if (shouldShowHallGroups) {
      const groups = hallGroups.map((group) => ({
        key: group.groupId,
        itemIds: group.items.map((item) => item.id),
      }));
      return buildRangePresentation({
        scopeKey: JSON.stringify([
          rangeScopeId,
          currentDay ?? null,
          columnType ?? null,
          viewMode,
          "hall",
          groups,
        ]),
        grouping: "hall",
        groups,
      });
    }

    const itemIds = items.map((item) => item.id);
    return buildRangePresentation({
      scopeKey: JSON.stringify([
        rangeScopeId,
        currentDay ?? null,
        columnType ?? null,
        viewMode,
        "flat",
        itemIds,
      ]),
      grouping: "flat",
      itemIds,
    });
  }, [
    columnType,
    currentDay,
    hallGroups,
    items,
    rangeScopeId,
    shouldShowHallGroups,
    showSpaceGroups,
    spaceGroups,
    viewMode,
  ]);

  // スペースグループの表示順序をApp.tsxに通知
  const spaceGroupOrderSignature = JSON.stringify(
    spaceGroups.map((group) => group.groupKey),
  );
  useEffect(() => {
    const order: string[] = JSON.parse(spaceGroupOrderSignature);
    if (!isInspecting && onSpaceGroupOrderChange && order.length > 0) {
      onSpaceGroupOrderChange(order);
    }
  }, [isInspecting, spaceGroupOrderSignature, onSpaceGroupOrderChange]);

  const spaceGroupBlockColorMap = useMemo(() => {
    if (!showSpaceGroups)
      return new Map<string, { light: string; dark: string }>();
    const uniqueBlocks = new Set<string>();
    routingItems.forEach((item) => uniqueBlocks.add(item.block));
    const sortedBlocks = Array.from(uniqueBlocks).sort((a, b) => {
      const numA = Number(a);
      const numB = Number(b);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
    const blockColorMapResult = new Map<
      string,
      { light: string; dark: string }
    >();
    sortedBlocks.forEach((block, index) => {
      blockColorMapResult.set(block, colorPalette[index % colorPalette.length]);
    });
    return blockColorMapResult;
  }, [routingItems, showSpaceGroups]);

  const resolvedRange = useMemo(() => {
    if (!rangeStart || !rangeEnd) return null;
    const resolution = resolveRangeSelection(
      rangePresentation,
      rangeStart,
      rangeEnd,
    );
    return resolution.valid ? resolution : null;
  }, [rangeEnd, rangePresentation, rangeStart]);

  const rangeItemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );

  const resolvedRangeSummary = useMemo(() => {
    if (!resolvedRange || !rangeStart || !rangeEnd) return null;

    const endpointItemIds = new Set<string>();
    const addEndpointItems = (
      endpoint: RangeEndpoint,
      groupIndex: number | null,
    ) => {
      if (endpoint.kind === "item") {
        endpointItemIds.add(endpoint.itemId);
        return;
      }
      if (groupIndex === null) return;
      rangePresentation.groups[groupIndex]?.itemIds.forEach((itemId) =>
        endpointItemIds.add(itemId),
      );
    };

    addEndpointItems(rangeStart, resolvedRange.start.groupIndex);
    addEndpointItems(rangeEnd, resolvedRange.end.groupIndex);

    const allSelected = resolvedRange.itemIds.every((itemId) =>
      selectedItemIds.has(itemId),
    );
    const onlyStartEndSelected =
      resolvedRange.itemIds.length > endpointItemIds.size &&
      endpointItemIds.size > 0 &&
      [...endpointItemIds].every((itemId) => selectedItemIds.has(itemId)) &&
      resolvedRange.itemIds.every(
        (itemId) => endpointItemIds.has(itemId) || !selectedItemIds.has(itemId),
      );

    return {
      allSelected,
      onlyStartEndSelected,
      rangeItems: resolvedRange.itemIds
        .map((itemId) => rangeItemsById.get(itemId))
        .filter((item): item is ShoppingItem => item !== undefined),
    };
  }, [
    rangeEnd,
    rangeItemsById,
    rangePresentation.groups,
    rangeStart,
    resolvedRange,
    selectedItemIds,
  ]);

  const groupRangeInfo = useMemo(() => {
    if (
      rangePresentation.grouping !== "hall" ||
      !resolvedRange ||
      !resolvedRangeSummary ||
      resolvedRange.coverage !== "item-slice" ||
      resolvedRange.start.kind !== "item" ||
      resolvedRange.end.kind !== "item" ||
      resolvedRange.start.groupIndex === null ||
      resolvedRange.start.groupIndex !== resolvedRange.end.groupIndex
    ) {
      return null;
    }

    const group = hallGroups[resolvedRange.start.groupIndex];
    if (!group) return null;

    return {
      groupId: group.groupId,
      startIndex: Math.min(
        resolvedRange.start.itemIndex,
        resolvedRange.end.itemIndex,
      ),
      endIndex: Math.max(
        resolvedRange.start.itemIndex,
        resolvedRange.end.itemIndex,
      ),
      ...resolvedRangeSummary,
    };
  }, [
    hallGroups,
    rangePresentation.grouping,
    resolvedRange,
    resolvedRangeSummary,
  ]);

  const spaceGroupRangeInfo = useMemo(() => {
    if (
      rangePresentation.grouping !== "space" ||
      !resolvedRange ||
      !resolvedRangeSummary ||
      resolvedRange.coverage !== "item-slice" ||
      resolvedRange.start.kind !== "item" ||
      resolvedRange.end.kind !== "item" ||
      resolvedRange.start.groupIndex === null ||
      resolvedRange.start.groupIndex !== resolvedRange.end.groupIndex
    ) {
      return null;
    }

    const group = spaceGroups[resolvedRange.start.groupIndex];
    if (!group) return null;

    return {
      groupKey: group.groupKey,
      startIndex: Math.min(
        resolvedRange.start.itemIndex,
        resolvedRange.end.itemIndex,
      ),
      endIndex: Math.max(
        resolvedRange.start.itemIndex,
        resolvedRange.end.itemIndex,
      ),
      ...resolvedRangeSummary,
    };
  }, [
    rangePresentation.grouping,
    resolvedRange,
    resolvedRangeSummary,
    spaceGroups,
  ]);

  const crossSpaceGroupRangeInfo = useMemo(() => {
    if (
      rangePresentation.grouping !== "space" ||
      !resolvedRange ||
      !resolvedRangeSummary ||
      resolvedRange.coverage !== "group-span" ||
      resolvedRange.start.groupIndex === null ||
      resolvedRange.end.groupIndex === null
    ) {
      return null;
    }

    const startGroupIndex = Math.min(
      resolvedRange.start.groupIndex,
      resolvedRange.end.groupIndex,
    );
    const endGroupIndex = Math.max(
      resolvedRange.start.groupIndex,
      resolvedRange.end.groupIndex,
    );

    return {
      startGroupIndex,
      endGroupIndex,
      rangeGroupIndices: Array.from(
        { length: endGroupIndex - startGroupIndex + 1 },
        (_, index) => startGroupIndex + index,
      ),
      rangeGroupItems: resolvedRangeSummary.rangeItems,
      allSelected: resolvedRangeSummary.allSelected,
      onlyStartEndSelected: resolvedRangeSummary.onlyStartEndSelected,
    };
  }, [rangePresentation.grouping, resolvedRange, resolvedRangeSummary]);

  const rangeInfo = useMemo(() => {
    if (
      rangePresentation.grouping !== "flat" ||
      !resolvedRange ||
      !resolvedRangeSummary ||
      resolvedRange.coverage !== "item-slice" ||
      resolvedRange.start.kind !== "item" ||
      resolvedRange.end.kind !== "item"
    ) {
      return null;
    }

    return {
      startIndex: Math.min(
        resolvedRange.start.displayIndex,
        resolvedRange.end.displayIndex,
      ),
      endIndex: Math.max(
        resolvedRange.start.displayIndex,
        resolvedRange.end.displayIndex,
      ),
      ...resolvedRangeSummary,
    };
  }, [rangePresentation.grouping, resolvedRange, resolvedRangeSummary]);

  const cardActionContextRef = useRef({
    columnType,
    onMoveItemDown,
    onMoveItemUp,
    onSelectItem,
    openPostEventDistributionCheck,
    rangePresentation,
  });
  useLayoutEffect(() => {
    cardActionContextRef.current = {
      columnType,
      onMoveItemDown,
      onMoveItemUp,
      onSelectItem,
      openPostEventDistributionCheck,
      rangePresentation,
    };
  }, [
    columnType,
    onMoveItemDown,
    onMoveItemUp,
    onSelectItem,
    openPostEventDistributionCheck,
    rangePresentation,
  ]);
  const handleCardSelectItem = useCallback((itemId: string) => {
    const { columnType, onSelectItem, rangePresentation } =
      cardActionContextRef.current;
    onSelectItem(itemId, columnType, rangePresentation);
  }, []);
  const handleCardMoveUp = useCallback((itemId: string) => {
    const { columnType, onMoveItemUp } = cardActionContextRef.current;
    onMoveItemUp?.(itemId, columnType);
  }, []);
  const handleCardMoveDown = useCallback((itemId: string) => {
    const { columnType, onMoveItemDown } = cardActionContextRef.current;
    onMoveItemDown?.(itemId, columnType);
  }, []);
  const handleCardPostEventDistributionCheckRequest = useCallback(
    (soldOutItem: ShoppingItem) => {
      cardActionContextRef.current.openPostEventDistributionCheck("single", [
        soldOutItem,
      ]);
    },
    [],
  );

  const dragPresentation = useMemo<ShoppingDragPresentation>(
    () => ({
      spaceGroups: showSpaceGroups,
      hallGroups: showHallGroups,
      halls: hallDefinitions,
      hallOrder,
      map: mapData,
    }),
    [showSpaceGroups, showHallGroups, hallDefinitions, hallOrder, mapData],
  );
  const handleDragMove = useStableCallback(onMoveItem);
  const dragDisplayOrder = useStableCallback(() =>
    listRowGroups
      ? listRowGroups.flatMap((group) =>
          group.collapsed
            ? group.items.length > 0
              ? [group.items[0].id]
              : []
            : group.items.map((item) => item.id),
        )
      : listReadModel.itemRows.map((row) => row.itemId),
  );
  useLayoutEffect(() => {
    if (!columnType || !dragWorkspace || viewMode !== "edit") return;
    return dragWorkspace.register(columnType, {
      items,
      sourceItems: dragSourceItems,
      executeOrder: dragExecuteOrder,
      displayOrder: dragDisplayOrder,
      presentation: dragPresentation,
      root: () => containerRef.current,
      move: handleDragMove,
      candidateNumberSort: candidateNumberSortDirection,
    });
  }, [
    columnType,
    dragWorkspace,
    viewMode,
    items,
    dragPresentation,
    dragSourceItems,
    dragExecuteOrder,
    dragDisplayOrder,
    listRowGroups,
    handleDragMove,
    candidateNumberSortDirection,
  ]);

  useLayoutEffect(() => {
    dragWorkspace?.refresh();
  }, [dragWorkspace, listReadModel]);
  useLayoutEffect(() => {
    if (containerRef.current && columnType) {
      containerRef.current.dataset.shoppingDragColumn = columnType;
      containerRef.current.dataset.shoppingDragScope = JSON.stringify([
        rangeScopeId,
        currentDay,
      ]);
    }
  });
  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    item: ShoppingItem,
  ) => {
    setDragRuntimeActive(true);
    dragItem.current = item.id;
    dragSourceColumn.current = columnType || null;
    if (columnType)
      dragToken.current =
        dragWorkspace?.start(
          columnType,
          item.id,
          selectedItemIds.has(item.id)
            ? Array.from(selectedItemIds)
            : [item.id],
          selectedItemIds.has(item.id) ? "selection" : "single",
        ) ?? null;
    if (columnType) {
      e.dataTransfer.setData("sourceColumn", columnType);
    }
    const target = e.currentTarget;
    setTimeout(() => {
      if (dragItem.current !== item.id) return;
      if (target) {
        markDragOpacity(target);
      }
      if (selectedItemIds.has(item.id)) {
        document.querySelectorAll('[data-is-selected="true"]').forEach((el) => {
          markDragOpacity(el);
        });
      }
    }, 0);
  };

  const handleDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    item: ShoppingItem,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const clientY = e.clientY;
    const windowHeight = window.innerHeight;
    if (clientY < TOP_SCROLL_TRIGGER_PX) {
      window.scrollBy(0, -SCROLL_SPEED);
    } else if (clientY > windowHeight - BOTTOM_SCROLL_TRIGGER_PX) {
      window.scrollBy(0, SCROLL_SPEED);
    }

    if (
      columnType &&
      dragWorkspace?.hover(columnType, item.id, e.clientY, e.clientX)
    )
      return;

    const isCrossColumn =
      dragSourceColumn.current !== null &&
      dragSourceColumn.current !== columnType;

    if (!isCrossColumn) {
      if (dragItem.current === item.id && selectedItemIds.size === 0) {
        setActiveDropTarget(null);
        return;
      }
      if (
        selectedItemIds.has(item.id) &&
        selectedItemIds.has(dragItem.current || "")
      ) {
        setActiveDropTarget(null);
        return;
      }
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const position = relativeY < rect.height / 2 ? "top" : "bottom";

    setActiveDropTarget({ id: item.id, position });
  };

  const handleContainerDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (columnType)
      dragWorkspace?.hover(columnType, undefined, e.clientY, e.clientX);
  };

  const handleContainerDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = e.relatedTarget;
    if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget))
      return;
    dragWorkspace?.leave();
    setActiveDropTarget(null);
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const sharedDrag = dragWorkspace?.active();
    if (
      columnType &&
      sharedDrag &&
      sharedDrag.context.sourceColumn !== columnType
    ) {
      dragWorkspace?.drop(columnType);
      cleanUp();
      return;
    }

    const sourceColumn = (sharedDrag?.context.sourceColumn ??
      e.dataTransfer.getData("sourceColumn")) as
      | "execute"
      | "candidate"
      | undefined;

    if (!columnType || !dragItem.current) {
      cleanUp();
      return;
    }

    const dragContext = dragWorkspace?.moveContext(columnType);

    if (sourceColumn && sourceColumn === columnType) {
      if (!activeDropTarget.current) {
        cleanUp();
        return;
      }
    } else if (sourceColumn && sourceColumn !== columnType) {
      // Allow cross-column drop
    } else {
      cleanUp();
      return;
    }

    if (!activeDropTarget.current) {
      if (sourceColumn && sourceColumn !== columnType) {
        onMoveItem(
          dragItem.current,
          "__END_OF_LIST__",
          columnType,
          sourceColumn,
          dragContext,
        );
        cleanUp();
        return;
      }
      cleanUp();
      return;
    }

    const { id: targetId, position } = activeDropTarget.current;

    if (dragItem.current === targetId && sourceColumn === columnType) {
      cleanUp();
      return;
    }

    if (position === "top") {
      onMoveItem(
        dragItem.current,
        targetId,
        columnType,
        sourceColumn,
        dragContext,
      );
    } else {
      const targetIndex = items.findIndex((i) => i.id === targetId);
      if (targetIndex === -1) {
        cleanUp();
        return;
      }

      if (targetIndex === items.length - 1) {
        onMoveItem(
          dragItem.current,
          "__END_OF_LIST__",
          columnType,
          sourceColumn,
          dragContext,
        );
      } else {
        const nextItem = items[targetIndex + 1];
        onMoveItem(
          dragItem.current,
          nextItem.id,
          columnType,
          sourceColumn,
          dragContext,
        );
      }
    }

    cleanUp();
  };

  const cleanUp = useCallback(() => {
    dragOpacityElements.current.forEach((element) =>
      element.classList.remove("opacity-40"),
    );
    dragOpacityElements.current.clear();
    if (dragGroupOwner.current) {
      onSetSpaceGroupDragItemIds?.(null);
      dragGroupOwner.current = false;
    }
    if (dragToken.current) dragWorkspace?.clear(dragToken.current);
    dragToken.current = null;
    touchTargetColumn.current = null;
    dragItem.current = null;
    dragSourceColumn.current = null;
    setActiveDropTarget(null);
    setDragRuntimeActive(false);
  }, [dragWorkspace, setActiveDropTarget, onSetSpaceGroupDragItemIds]);

  // === タッチドラッグ&ドロップ ===
  const TOUCH_LONG_PRESS_MS = 200;
  const TOUCH_MOVE_THRESHOLD = 5; // px — 指の微小な揺れを無視
  const touchCleanUp = useCallback(() => {
    if (touchLongPressTimer.current) {
      clearTimeout(touchLongPressTimer.current);
      touchLongPressTimer.current = null;
    }
    if (touchScrollInterval.current) {
      clearInterval(touchScrollInterval.current);
      touchScrollInterval.current = null;
    }
    if (touchDragClone.current) {
      touchDragClone.current.remove();
      touchDragClone.current = null;
    }
    if (touchDragSourceEl.current) {
      touchDragSourceEl.current.setAttribute("draggable", "true");
      touchDragSourceEl.current.classList.remove("opacity-40");
      touchDragSourceEl.current = null;
    }
    if (touchDragSpaceGroupIds.current && onSetSpaceGroupDragItemIds) {
      onSetSpaceGroupDragItemIds(null);
    }
    touchDragSpaceGroupIds.current = null;
    touchDragActive.current = false;
    releaseTouchBodyScrollLock.current?.();
    releaseTouchBodyScrollLock.current = null;
    cleanUp();
  }, [cleanUp, onSetSpaceGroupDragItemIds]);

  // クリーンアップ: コンポーネントアンマウント時
  useEffect(() => () => touchCleanUp(), [touchCleanUp]);
  useLayoutEffect(
    () =>
      dragWorkspace?.subscribe((active) => {
        setDragRuntimeActive(active);
        if (!active && dragToken.current) touchCleanUp();
      }),
    [dragWorkspace, touchCleanUp],
  );

  const createDragClone = useCallback(
    (sourceEl: HTMLElement, touchX: number, touchY: number) => {
      const rect = sourceEl.getBoundingClientRect();
      const clone = sourceEl.cloneNode(true) as HTMLElement;
      clone.dataset.layoutLeft = `${Math.max(0, touchX - rect.width / 2)}px`;
      clone.dataset.layoutTop = `${touchY - 20}px`;
      clone.dataset.layoutWidth = `${rect.width}px`;
      clone.classList.add(
        "esp-shopping-touch-clone",
        "esp-layout-left",
        "esp-layout-top",
        "esp-layout-width",
      );
      document.body.appendChild(clone);
      return clone;
    },
    [],
  );

  const handleTouchDragStart = useCallback(
    (
      itemId: string,
      sourceEl: HTMLElement,
      touchX: number,
      touchY: number,
      spaceGroupItemIds?: string[],
    ) => {
      setDragRuntimeActive(true);
      touchDragActive.current = true;
      dragItem.current = itemId;
      dragSourceColumn.current = columnType || null;
      if (columnType)
        dragToken.current =
          dragWorkspace?.start(
            columnType,
            itemId,
            spaceGroupItemIds ??
              (selectedItemIds.has(itemId)
                ? Array.from(selectedItemIds)
                : [itemId]),
            spaceGroupItemIds
              ? "space-group"
              : selectedItemIds.has(itemId)
                ? "selection"
                : "single",
          ) ?? null;

      // ブラウザのネイティブドラッグゴーストを防止
      sourceEl.setAttribute("draggable", "false");
      touchDragSourceEl.current = sourceEl;

      // 元の要素を半透明に
      markDragOpacity(sourceEl);
      if (selectedItemIds.has(itemId)) {
        document.querySelectorAll('[data-is-selected="true"]').forEach((el) => {
          markDragOpacity(el);
        });
      }

      if (spaceGroupItemIds && onSetSpaceGroupDragItemIds) {
        touchDragSpaceGroupIds.current = spaceGroupItemIds;
        onSetSpaceGroupDragItemIds(spaceGroupItemIds);
      }

      // ドラッグクローン作成
      touchDragClone.current = createDragClone(sourceEl, touchX, touchY);

      // スクロール防止
      releaseTouchBodyScrollLock.current?.();
      releaseTouchBodyScrollLock.current = acquireBodyScrollLock();

      // 触覚フィードバック
      if (navigator.vibrate) navigator.vibrate(30);
    },
    [
      columnType,
      selectedItemIds,
      createDragClone,
      onSetSpaceGroupDragItemIds,
      dragWorkspace,
      markDragOpacity,
    ],
  );

  const handleItemTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>, item: ShoppingItem) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-no-long-press]")) return;

      const touch = e.touches[0];
      touchStartX.current = touch.clientX;
      touchStartY.current = touch.clientY;

      const el = e.currentTarget;
      touchLongPressTimer.current = setTimeout(() => {
        handleTouchDragStart(item.id, el, touch.clientX, touch.clientY);
      }, TOUCH_LONG_PRESS_MS);
    },
    [handleTouchDragStart],
  );

  const handleItemTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      const touch = e.touches[0];

      if (!touchDragActive.current) {
        const dx = Math.abs(touch.clientX - touchStartX.current);
        const dy = Math.abs(touch.clientY - touchStartY.current);
        if (dx > TOUCH_MOVE_THRESHOLD || dy > TOUCH_MOVE_THRESHOLD) {
          if (touchLongPressTimer.current) {
            clearTimeout(touchLongPressTimer.current);
            touchLongPressTimer.current = null;
          }
        }
        return;
      }

      e.preventDefault(); // ドラッグ中はスクロール防止

      if (touchDragClone.current) {
        touchDragClone.current.dataset.layoutTop = `${touch.clientY - 20}px`;
      }

      // 自動スクロール
      const clientY = touch.clientY;
      const windowHeight = window.innerHeight;
      if (touchScrollInterval.current) {
        clearInterval(touchScrollInterval.current);
        touchScrollInterval.current = null;
      }
      if (clientY < TOP_SCROLL_TRIGGER_PX) {
        touchScrollInterval.current = setInterval(
          () => window.scrollBy(0, -SCROLL_SPEED),
          16,
        );
      } else if (clientY > windowHeight - BOTTOM_SCROLL_TRIGGER_PX) {
        touchScrollInterval.current = setInterval(
          () => window.scrollBy(0, SCROLL_SPEED),
          16,
        );
      }

      touchDragClone.current?.classList.add("esp-shopping-touch-clone-hidden");
      const elementUnder = document.elementFromPoint(
        touch.clientX,
        touch.clientY,
      );
      touchDragClone.current?.classList.remove(
        "esp-shopping-touch-clone-hidden",
      );

      if (!elementUnder) {
        touchTargetColumn.current = null;
        dragWorkspace?.leave();
        setActiveDropTarget(null);
        return;
      }
      if (dragWorkspace) {
        const root = elementUnder.closest<HTMLElement>(
          "[data-shopping-drag-column]",
        );
        const targetColumn = root?.dataset.shoppingDragColumn as
          | "execute"
          | "candidate"
          | undefined;
        if (!targetColumn) {
          touchTargetColumn.current = null;
          dragWorkspace.leave();
          setActiveDropTarget(null);
          return;
        }
        const reference = elementUnder.closest<HTMLElement>(
          "[data-item-id], [data-shopping-drag-reference-id]",
        );
        const targetId =
          reference?.dataset.itemId ??
          reference?.dataset.shoppingDragReferenceId;
        touchTargetColumn.current = targetColumn ?? null;
        if (
          targetColumn &&
          dragWorkspace.hover(
            targetColumn,
            targetId,
            touch.clientY,
            touch.clientX,
          )
        ) {
          setActiveDropTarget(null);
          return;
        }
      }

      if (elementUnder) {
        const itemEl = elementUnder.closest(
          "[data-item-id]",
        ) as HTMLElement | null;
        if (itemEl) {
          const targetId = itemEl.getAttribute("data-item-id");
          if (targetId && targetId !== dragItem.current) {
            const rect = itemEl.getBoundingClientRect();
            const relativeY = touch.clientY - rect.top;
            const position = relativeY < rect.height / 2 ? "top" : "bottom";
            setActiveDropTarget({ id: targetId, position });
          } else setActiveDropTarget(null);
        } else {
          // アイテム上でない場合はドロップターゲットをクリア
          setActiveDropTarget(null);
        }
      }
    },
    [dragWorkspace, setActiveDropTarget],
  );

  const handleItemTouchEnd = useCallback(() => {
    // ロングプレスタイマーをクリア
    if (touchLongPressTimer.current) {
      clearTimeout(touchLongPressTimer.current);
      touchLongPressTimer.current = null;
    }

    if (!touchDragActive.current) return;
    if (
      touchTargetColumn.current &&
      touchTargetColumn.current !== columnType &&
      dragWorkspace?.active()
    ) {
      dragWorkspace.drop(touchTargetColumn.current);
      touchCleanUp();
      return;
    }

    const dragContext = columnType
      ? dragWorkspace?.moveContext(columnType)
      : undefined;
    if (activeDropTarget.current && dragItem.current && columnType) {
      const sourceColumn = dragSourceColumn.current;
      const { id: targetId, position } = activeDropTarget.current;

      if (dragItem.current !== targetId || sourceColumn !== columnType) {
        if (position === "top") {
          onMoveItem(
            dragItem.current,
            targetId,
            columnType,
            sourceColumn || undefined,
            dragContext,
          );
        } else {
          const targetIndex = items.findIndex((i) => i.id === targetId);
          if (targetIndex !== -1) {
            if (targetIndex === items.length - 1) {
              onMoveItem(
                dragItem.current,
                "__END_OF_LIST__",
                columnType,
                sourceColumn || undefined,
                dragContext,
              );
            } else {
              const nextItem = items[targetIndex + 1];
              onMoveItem(
                dragItem.current,
                nextItem.id,
                columnType,
                sourceColumn || undefined,
                dragContext,
              );
            }
          }
        }
      }
    }

    touchCleanUp();
  }, [columnType, items, onMoveItem, touchCleanUp, dragWorkspace]);

  const handleItemTouchCancel = useCallback(() => {
    touchCleanUp();
  }, [touchCleanUp]);

  useEffect(() => {
    const handleGlobalTouchEnd = () => {
      if (touchDragActive.current) {
        touchCleanUp();
      }
    };
    document.addEventListener("touchend", handleGlobalTouchEnd);
    document.addEventListener("touchcancel", handleGlobalTouchEnd);
    return () => {
      document.removeEventListener("touchend", handleGlobalTouchEnd);
      document.removeEventListener("touchcancel", handleGlobalTouchEnd);
    };
  }, [touchCleanUp]);

  const limitedToastMessage = bulkLimitedMessage
    ? { message: bulkLimitedMessage.message, tone: "info" as const }
    : limitedMessage;
  const limitedPurchaseOverlays = (
    <>
      {limitedToastMessage &&
        ReactDOM.createPortal(
          <div
            className={`fixed left-1/2 top-20 z-[95] -translate-x-1/2 rounded px-4 py-2 text-sm font-medium shadow-lg ${
              limitedToastMessage.tone === "warning"
                ? "bg-red-600 text-white dark:bg-red-700 dark:text-white"
                : "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
            }`}
          >
            {limitedToastMessage.message}
          </div>,
          document.body,
        )}
      <LimitedPurchaseDialog
        isOpen={!isInspecting && limitedBulkDialogContext !== null}
        itemId={limitedBulkDialogItemSnapshot?.id}
        itemTitle={
          limitedBulkDialogItemSnapshot?.title ||
          limitedBulkDialogItemSnapshot?.circle
        }
        initialActual={
          limitedBulkDialogItemSnapshot
            ? getActualPurchasedQuantity(limitedBulkDialogItemSnapshot)
            : undefined
        }
        initialPlanned={
          limitedBulkDialogItemSnapshot
            ? getPlannedQuantity(
                getLatestItemById(limitedBulkDialogItemSnapshot.id) ??
                  limitedBulkDialogItemSnapshot,
              )
            : 1
        }
        showDeferButton
        onSubmit={handleLimitedBulkSubmit}
        onCancel={handleLimitedBulkCancel}
      />
      <PostEventDistributionCheckDialog
        open={!isInspecting && postEventDistributionCheckContext !== null}
        mode={postEventDistributionCheckContext?.mode ?? "single"}
        targets={postEventDistributionCheckContext?.targets ?? []}
        onCancel={handlePostEventDistributionCheckCancel}
        onApply={handlePostEventDistributionCheckApply}
      />
    </>
  );

  if (items.length === 0) {
    return (
      <GroupedListRenderer
        defer={useRetainedViewport}
        zoomPercent={viewportZoomPercent}
        pinnedRowKeys={
          new Set(
            listReadModel.itemRows
              .filter(
                (row) =>
                  retainedItemIds?.includes(row.itemId) ||
                  row.itemId === limitedBulkDialogContext?.itemSnapshot.id ||
                  (postEventDistributionCheckContext?.mode === "single" &&
                    postEventDistributionCheckContext.targets[0]?.id ===
                      row.itemId) ||
                  row.rowKey === listControllerState.focusedRowKey ||
                  row.itemId === dragItem.current ||
                  touchDragSpaceGroupIds.current?.includes(row.itemId),
              )
              .map((row) => row.rowKey),
          )
        }
        engine={listRendererSelection.engine}
        layoutMode={layoutMode}
        getVisitId={getExecutionVisitIdForItem}
        getGroupVisitId={getGroupVisitId}
        model={listReadModel}
        selectionReason={listRendererSelection.reason}
        accessibleLabel="買い物リスト"
        focusedRowKey={listControllerState.focusedRowKey}
        rootRef={containerRef}
        rootProps={{
          className:
            "text-center text-slate-500 dark:text-slate-400 py-12 min-h-[200px] border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg relative",
          onBlurCapture: handleFullListBlurCapture,
          onDragOver: !isInspecting ? handleContainerDragOver : undefined,
          onDrop: !isInspecting ? handleDrop : undefined,
          onDragLeave: handleContainerDragLeave,
          onFocusCapture: handleFullListFocusCapture,
        }}
        beforeContent={limitedPurchaseOverlays}
        renderRow={() => null}
      />
    );
  }

  // スペースグループ化表示
  if (showSpaceGroups && spaceGroups.length > 0) {
    const getEffectiveDragIds = (group: SpaceGroup): string[] => {
      const groupIds = new Set(group.items.map((item) => item.id));
      const isGroupInSelection = group.items.some((item) =>
        selectedItemIds.has(item.id),
      );
      if (isGroupInSelection && selectedItemIds.size > groupIds.size) {
        // 選択中のアイテムがこのグループ以外にもある→チェーン選択されたアイテム全て含める
        return Array.from(selectedItemIds);
      }
      return group.items.map((item) => item.id);
    };

    const handleSpaceGroupDragStart = (
      e: React.DragEvent<HTMLDivElement>,
      group: SpaceGroup,
    ) => {
      const firstItemId = group.items[0]?.id;
      if (!firstItemId) return;
      setDragRuntimeActive(true);
      dragGroupOwner.current = true;
      dragItem.current = firstItemId;
      if (columnType)
        dragToken.current =
          dragWorkspace?.start(
            columnType,
            firstItemId,
            getEffectiveDragIds(group),
            "space-group",
          ) ?? null;
      dragSourceColumn.current = columnType || null;
      if (columnType) {
        e.dataTransfer.setData("sourceColumn", columnType);
      }
      if (onSetSpaceGroupDragItemIds) {
        onSetSpaceGroupDragItemIds(getEffectiveDragIds(group));
      }
      const target = e.currentTarget;
      setTimeout(() => {
        if (dragItem.current === firstItemId && target) markDragOpacity(target);
      }, 0);
    };

    const handleSpaceGroupDragEnd = () => {
      if (onSetSpaceGroupDragItemIds) {
        onSetSpaceGroupDragItemIds(null);
      }
      cleanUp();
    };

    const allCollapsed =
      spaceGroups.length > 0 && spaceGroups.every((g) => g.isCollapsed);
    const hasPriorityGroups = spaceGroups.some(
      (group) => group.priority !== "none",
    );
    const spaceGroupIndexByKey = new Map(
      spaceGroups.map((group, index) => [group.groupKey, index] as const),
    );
    const renderSpaceGroupRow = (
      row: Extract<ShoppingListRow, { kind: "group" }>,
      renderedItemRows: readonly FullListRenderedItemRow[],
    ): React.ReactNode => {
      const groupIndex = spaceGroupIndexByKey.get(row.groupKey);
      if (groupIndex === undefined) {
        throw new Error(
          `ShoppingList invariant failed: unknown space group ${row.groupKey}`,
        );
      }
      const group = spaceGroups[groupIndex];

      const prevHallGroupId =
        groupIndex > 0 ? spaceGroups[groupIndex - 1].hallGroupId : undefined;
      const showHallSectionHeader =
        columnType !== "candidate" &&
        group.hallGroupId !== prevHallGroupId &&
        (hallDefinitions.length > 0 || hasPriorityGroups);
      const hallSectionHeader = showHallSectionHeader
        ? (() => {
            const headerStyle = getGroupHeaderStyle(
              group.hallGroupId,
              hallDefinitions,
            );
            const displayName = getGroupDisplayName(
              group.hallGroupId,
              hallDefinitions,
            );
            // このセクション内のアイテム数を算出
            let sectionItemCount = 0;
            for (let i = groupIndex; i < spaceGroups.length; i++) {
              if (
                i > groupIndex &&
                spaceGroups[i].hallGroupId !== group.hallGroupId
              )
                break;
              sectionItemCount += spaceGroups[i].items.length;
            }
            return (
              <div
                className={`sticky top-0 z-30 flex items-center justify-between overflow-hidden rounded-t-lg px-4 py-2 ${headerStyle.bgClass} ${groupIndex > 0 ? "mt-3" : ""}`}
              >
                <svg
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 h-full w-1"
                  preserveAspectRatio="none"
                  viewBox="0 0 4 100"
                >
                  <rect fill={headerStyle.borderColor} height="100" width="4" />
                </svg>
                <span className="font-bold text-sm text-slate-700 dark:text-slate-300">
                  {displayName}
                </span>
                <span className="text-xs text-slate-600 dark:text-slate-300">
                  {sectionItemCount}件
                </span>
              </div>
            );
          })()
        : null;

      const block = group.spaceKey.split("-")[0];
      const blockColor = spaceGroupBlockColorMap.get(block);

      const allItemsSelected =
        group.items.length > 0 &&
        group.items.every((item) => selectedItemIds.has(item.id));
      const someItemsSelected =
        !allItemsSelected &&
        group.items.some((item) => selectedItemIds.has(item.id));

      const totalPrice = group.items.reduce(
        (sum, item) => sum + (item.price ?? 0) * (item.quantity || 1),
        0,
      );

      // 上下移動の可否
      const canMoveGroupUp = groupIndex > 0;
      const canMoveGroupDown = groupIndex < spaceGroups.length - 1;

      // スペースグループのチェックボックスクリック
      const handleSpaceCheckbox = (e: React.MouseEvent | React.ChangeEvent) => {
        e.stopPropagation();
        const groupItemIds = group.items.map((item) => item.id);
        // 折りたたみ時は範囲選択対応のハンドラーを使用
        if (group.isCollapsed && onSelectSpaceGroupForRange && columnType) {
          onSelectSpaceGroupForRange(
            group.groupKey,
            groupItemIds,
            rangePresentation,
          );
          return;
        }
        if (onToggleRangeSelection) {
          onToggleRangeSelection(groupItemIds);
          return;
        }
        if (allItemsSelected) {
          // 全解除
          groupItemIds.forEach((id) =>
            onSelectItem(id, columnType, rangePresentation),
          );
        } else {
          groupItemIds.forEach((id) => {
            if (!selectedItemIds.has(id)) {
              onSelectItem(id, columnType, rangePresentation);
            }
          });
        }
      };

      const handleSpaceGroupMoveUp = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!canMoveGroupUp || !onMoveItemUp) return;
        const effectiveIds = getEffectiveDragIds(group);
        if (onSetSpaceGroupDragItemIds) {
          onSetSpaceGroupDragItemIds(effectiveIds);
        }
        onMoveItemUp(group.items[0].id, columnType);
        if (onSetSpaceGroupDragItemIds) {
          onSetSpaceGroupDragItemIds(null);
        }
      };

      const handleSpaceGroupMoveDown = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!canMoveGroupDown || !onMoveItemDown) return;
        const effectiveIds = getEffectiveDragIds(group);
        if (onSetSpaceGroupDragItemIds) {
          onSetSpaceGroupDragItemIds(effectiveIds);
        }
        onMoveItemDown(group.items[group.items.length - 1].id, columnType);
        if (onSetSpaceGroupDragItemIds) {
          onSetSpaceGroupDragItemIds(null);
        }
      };

      // クロスグループチェーン表示情報
      const crossRangeInGroup =
        crossSpaceGroupRangeInfo &&
        crossSpaceGroupRangeInfo.rangeGroupIndices.includes(groupIndex);
      const isCrossStart =
        crossSpaceGroupRangeInfo &&
        groupIndex === crossSpaceGroupRangeInfo.startGroupIndex;
      const isCrossEnd =
        crossSpaceGroupRangeInfo &&
        groupIndex === crossSpaceGroupRangeInfo.endGroupIndex;
      const isCrossMiddle = crossRangeInGroup && !isCrossStart && !isCrossEnd;

      return (
        <div className="space-y-1">
          {hallSectionHeader}
          <div className="mb-1 relative">
            {/* ドロップ位置ガイド */}

            {/* スペースグループヘッダー */}
            <div
              className={`sticky top-0 z-20 rounded-lg border-l-4 border-l-[#9CA3AF] select-none cursor-pointer ${
                blockColor?.light || "bg-slate-100 dark:bg-slate-800"
              } hover:brightness-95 dark:hover:brightness-110 transition-all ${
                layoutMode === "smartphone" &&
                group.isCollapsed &&
                viewMode !== "execute"
                  ? "flex flex-col"
                  : "flex items-center"
              }`}
              onClick={() => onToggleSpaceCollapse?.(group.groupKey)}
              data-item-id={group.isCollapsed ? group.items[0]?.id : undefined}
              data-shopping-drag-reference-id={group.items[0]?.id}
              data-space-group-key={group.groupKey}
              data-space-navigation-visit-id={
                group.items[0]
                  ? getExecutionVisitIdForItem(group.items[0])
                  : undefined
              }
              data-space-navigation-anchor="heading"
              draggable={viewMode !== "execute" && group.isCollapsed}
              onDragStart={
                viewMode !== "execute" && group.isCollapsed
                  ? (e) => handleSpaceGroupDragStart(e, group)
                  : undefined
              }
              onDragOver={
                viewMode !== "execute"
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const firstItem = group.items[0];
                      if (
                        firstItem &&
                        columnType &&
                        dragWorkspace?.hover(
                          columnType,
                          firstItem.id,
                          e.clientY,
                          e.clientX,
                        )
                      )
                        return;
                      if (firstItem) {
                        setActiveDropTarget({
                          id: firstItem.id,
                          position: "top",
                        });
                      }
                    }
                  : undefined
              }
              onDrop={viewMode !== "execute" ? handleDrop : undefined}
              onDragEnd={
                viewMode !== "execute" && group.isCollapsed
                  ? handleSpaceGroupDragEnd
                  : undefined
              }
              onTouchStart={
                viewMode !== "execute" && group.isCollapsed
                  ? (e: React.TouchEvent<HTMLDivElement>) => {
                      const target = e.target as HTMLElement;
                      if (target.closest("[data-no-long-press]")) return;
                      const touch = e.touches[0];
                      touchStartX.current = touch.clientX;
                      touchStartY.current = touch.clientY;
                      const el = e.currentTarget;
                      const firstItemId = group.items[0]?.id;
                      if (!firstItemId) return;
                      const effectiveIds = getEffectiveDragIds(group);
                      touchLongPressTimer.current = setTimeout(() => {
                        handleTouchDragStart(
                          firstItemId,
                          el,
                          touch.clientX,
                          touch.clientY,
                          effectiveIds,
                        );
                      }, TOUCH_LONG_PRESS_MS);
                    }
                  : undefined
              }
              onTouchMove={
                viewMode !== "execute" && group.isCollapsed
                  ? handleItemTouchMove
                  : undefined
              }
              onTouchEnd={
                viewMode !== "execute" && group.isCollapsed
                  ? handleItemTouchEnd
                  : undefined
              }
              onTouchCancel={
                viewMode !== "execute" && group.isCollapsed
                  ? handleItemTouchCancel
                  : undefined
              }
            >
              {/* 折りたたみ時：編集モード＝チェックボックス+ドラッグハンドル+上下ボタン / 実行モード＝なし（サマリーはメインエリア右側に表示） */}
              {group.isCollapsed && viewMode !== "execute" && (
                <div
                  data-drag-handle
                  className={`flex flex-row items-center cursor-grab text-slate-400 dark:text-slate-500 ${
                    layoutMode === "smartphone"
                      ? "px-1 py-0.5 gap-0.5 border-b border-slate-200/80 dark:border-slate-700/80"
                      : "px-1.5 py-1 gap-1 border-r border-slate-200/80 dark:border-slate-700/80"
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={allItemsSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someItemsSelected;
                    }}
                    onChange={handleSpaceCheckbox}
                    onClick={(e) => e.stopPropagation()}
                    data-no-long-press
                    className={`rounded text-blue-600 focus:ring-blue-500 ${
                      layoutMode === "smartphone" ? "w-4 h-4" : "w-5 h-5"
                    }`}
                  />
                  {onMoveItemUp && (
                    <button
                      onClick={handleSpaceGroupMoveUp}
                      disabled={!canMoveGroupUp}
                      data-no-long-press
                      className={`p-0.5 rounded-md transition-colors ${canMoveGroupUp ? "hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 cursor-pointer" : "text-slate-300 dark:text-slate-600 cursor-not-allowed opacity-50"}`}
                      aria-label="グループを上に移動"
                    >
                      <ChevronUpIcon
                        className={
                          layoutMode === "smartphone"
                            ? "w-3.5 h-3.5"
                            : "w-4 h-4"
                        }
                      />
                    </button>
                  )}
                  <GripVerticalIcon
                    className={
                      layoutMode === "smartphone" ? "w-4 h-4 mx-1" : "w-5 h-5"
                    }
                  />
                  {onMoveItemDown && (
                    <button
                      onClick={handleSpaceGroupMoveDown}
                      disabled={!canMoveGroupDown}
                      data-no-long-press
                      className={`p-0.5 rounded-md transition-colors ${canMoveGroupDown ? "hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 cursor-pointer" : "text-slate-300 dark:text-slate-600 cursor-not-allowed opacity-50"}`}
                      aria-label="グループを下に移動"
                    >
                      <ChevronDownIcon
                        className={
                          layoutMode === "smartphone"
                            ? "w-3.5 h-3.5"
                            : "w-4 h-4"
                        }
                      />
                    </button>
                  )}
                  {/* スマホ時：追加ボタンをコントロールバー右端に配置 */}
                  {layoutMode === "smartphone" && onAddItem && (
                    <>
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const spaceBlock = group.spaceKey.split("-")[0];
                          const spaceNumber = group.spaceKey
                            .split("-")
                            .slice(1)
                            .join("-");
                          const circles = [
                            ...new Set(
                              group.items
                                .map((item) => item.circle)
                                .filter(Boolean),
                            ),
                          ];
                          openAddDialog(
                            spaceBlock,
                            spaceNumber,
                            circles,
                            e.currentTarget,
                          );
                        }}
                        className="px-1.5 py-0.5 mr-1 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 rounded transition-colors"
                        title="このスペースにアイテムを追加"
                        aria-label="このスペースにアイテムを追加"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 4v16m8-8H4"
                          />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* メインのクリック可能エリア */}
              <div
                className={`flex-1 flex flex-col min-w-0 ${
                  layoutMode === "smartphone" ? "px-2 py-1" : "px-3 py-1.5"
                }`}
              >
                <div className="flex items-center justify-between min-w-0">
                  <div
                    className={`flex items-center min-w-0 ${layoutMode === "smartphone" ? "gap-1" : "gap-2"}`}
                  >
                    <span
                      className={`text-xs transition-transform duration-200 flex-shrink-0 ${
                        group.isCollapsed ? "" : "rotate-90"
                      }`}
                    >
                      &#9654;
                    </span>
                    <span
                      className={`font-bold text-slate-700 dark:text-slate-300 flex-shrink-0 ${
                        layoutMode === "smartphone" ? "text-xs" : "text-sm"
                      }`}
                    >
                      {group.displayName}
                    </span>
                    {(() => {
                      const uniqueCircles = [
                        ...new Set(
                          group.items
                            .map((item) => item.circle)
                            .filter(Boolean),
                        ),
                      ];
                      if (uniqueCircles.length === 0) return null;
                      const displayText =
                        layoutMode === "smartphone"
                          ? uniqueCircles
                              .map((c) =>
                                c.length > 6 ? c.slice(0, 6) + "…" : c,
                              )
                              .join(" & ")
                          : uniqueCircles.join(" & ");
                      return (
                        <span
                          className={`font-bold text-slate-700 dark:text-slate-300 truncate ${
                            layoutMode === "smartphone" ? "text-xs" : "text-sm"
                          }`}
                          title={uniqueCircles.join(" & ")}
                        >
                          {displayText}
                        </span>
                      );
                    })()}
                  </div>
                  <div
                    className={`flex items-center flex-shrink-0 ${layoutMode === "smartphone" ? "gap-1" : "gap-2"}`}
                  >
                    {/* スマホ折りたたみ時：備考を💬/⚠️アイコンで表示 */}
                    {layoutMode === "smartphone" &&
                      group.isCollapsed &&
                      (() => {
                        const remarksItems = group.items.filter(
                          (item) => item.remarks,
                        );
                        if (remarksItems.length === 0) return null;
                        const hasWarningRemarks = remarksItems.some(
                          (item) =>
                            item.remarks.includes("委託無") ||
                            item.remarks.includes("優先"),
                        );
                        const isExpanded = expandedRemarks.has(group.groupKey);
                        return (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedRemarks((prev) => {
                                const next = new Set(prev);
                                if (next.has(group.groupKey)) {
                                  next.delete(group.groupKey);
                                } else {
                                  next.add(group.groupKey);
                                }
                                return next;
                              });
                            }}
                            className={`text-sm leading-none p-0.5 rounded hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors ${isExpanded ? "bg-slate-200 dark:bg-slate-700" : ""}`}
                            title="備考を表示"
                          >
                            {hasWarningRemarks ? "⚠️" : "💬"}
                          </button>
                        );
                      })()}
                    {/* 実行モード折りたたみ時：購入状態サマリー（色付き） */}
                    {viewMode === "execute" &&
                      group.isCollapsed &&
                      (() => {
                        const statusColorMap: Record<string, string> = {
                          None: "text-red-600 dark:text-red-400 font-bold",
                          Purchased: "text-green-600 dark:text-green-400",
                          SoldOut: "text-red-600 dark:text-red-400",
                          Postpone: "text-purple-600 dark:text-purple-400",
                          Late: "text-blue-600 dark:text-blue-400",
                          LimitedPurchase:
                            "text-orange-600 dark:text-orange-400",
                          Absent: "text-yellow-600 dark:text-yellow-400",
                        };
                        const statusAbbrevMap: [string, string][] = [
                          ["None", "未"],
                          ["Purchased", "購"],
                          ["SoldOut", "売"],
                          ["Postpone", "後"],
                          ["Late", "遅"],
                          ["LimitedPurchase", "限"],
                          ["Absent", "欠"],
                        ];
                        const counts = new Map<string, number>();
                        group.items.forEach((item) => {
                          counts.set(
                            item.purchaseStatus,
                            (counts.get(item.purchaseStatus) || 0) + 1,
                          );
                        });
                        const entries = statusAbbrevMap.filter(
                          ([s]) => (counts.get(s) || 0) > 0,
                        );
                        if (entries.length === 0) return null;
                        return (
                          <span
                            className={`flex items-center ${layoutMode === "smartphone" ? "gap-0.5" : "gap-1"}`}
                          >
                            {entries.map(([status, abbrev]) => (
                              <span
                                key={status}
                                className={`font-medium ${statusColorMap[status]} ${
                                  layoutMode === "smartphone"
                                    ? "text-[10px]"
                                    : "text-xs"
                                }`}
                              >
                                {abbrev}
                                {counts.get(status)}
                              </span>
                            ))}
                          </span>
                        );
                      })()}
                    {/* 件数表示（全モード共通） */}
                    <span
                      className={`text-slate-500 dark:text-slate-400 ${
                        layoutMode === "smartphone" ? "text-[10px]" : "text-xs"
                      }`}
                    >
                      {group.items.length}件
                    </span>
                    {group.isCollapsed &&
                      viewMode !== "execute" &&
                      (() => {
                        const allPriceNull = group.items.every(
                          (item) => item.price == null,
                        );
                        if (allPriceNull) {
                          return (
                            <span
                              className={`font-medium text-slate-500 dark:text-slate-400 ${
                                layoutMode === "smartphone"
                                  ? "text-[10px]"
                                  : "text-xs"
                              }`}
                            >
                              価格未定
                            </span>
                          );
                        }
                        return (
                          <span
                            className={`font-medium text-slate-600 dark:text-slate-300 ${
                              layoutMode === "smartphone"
                                ? "text-[10px]"
                                : "text-xs"
                            }`}
                          >
                            {totalPrice.toLocaleString()}円
                          </span>
                        );
                      })()}
                  </div>
                </div>
                {/* 折りたたみ時の備考表示 */}
                {group.isCollapsed &&
                  (() => {
                    // スマホ時：💬/⚠️クリックで展開表示
                    if (layoutMode === "smartphone") {
                      if (!expandedRemarks.has(group.groupKey)) return null;
                      const remarksItems = group.items.filter(
                        (item) => item.remarks,
                      );
                      if (remarksItems.length === 0) return null;
                      return (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {remarksItems.map((item) => (
                            <span
                              key={item.id}
                              className={`text-[10px] px-1 py-0.5 rounded bg-slate-200/60 dark:bg-slate-700/60 ${
                                item.remarks.includes("委託無") ||
                                item.remarks.includes("優先")
                                  ? "text-red-600 dark:text-red-400 font-medium"
                                  : "text-slate-600 dark:text-slate-400"
                              }`}
                            >
                              {item.remarks}
                            </span>
                          ))}
                        </div>
                      );
                    }
                    // PC時：従来の備考表示
                    const remarksItems = group.items.filter(
                      (item) => item.remarks,
                    );
                    if (remarksItems.length === 0) return null;
                    return (
                      <div className="flex flex-wrap gap-1 mt-0.5 ml-4">
                        {remarksItems.map((item) => {
                          const isExpanded = expandedRemarks.has(item.id);
                          const text = item.remarks;
                          const needsTruncate = text.length >= 5;
                          const displayText =
                            needsTruncate && !isExpanded
                              ? text.slice(0, 4) + "..."
                              : text;
                          return (
                            <span
                              key={item.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (needsTruncate) {
                                  setExpandedRemarks((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(item.id)) {
                                      next.delete(item.id);
                                    } else {
                                      next.add(item.id);
                                    }
                                    return next;
                                  });
                                }
                              }}
                              className={`text-xs px-1 py-0.5 rounded bg-slate-200/60 dark:bg-slate-700/60 text-slate-600 dark:text-slate-400 ${needsTruncate ? "cursor-pointer hover:bg-slate-300 dark:hover:bg-slate-600" : ""}`}
                            >
                              {displayText}
                            </span>
                          );
                        })}
                      </div>
                    );
                  })()}
                {/* 実行モード展開時：一括ステータス変更ボタン */}
                {viewMode === "execute" &&
                  !isInspecting &&
                  !group.isCollapsed &&
                  onBulkStatusChange && (
                    <div
                      className={`max-w-full overflow-x-auto overflow-y-hidden ${layoutMode === "smartphone" ? "mt-0.5" : "mt-1 ml-4"}`}
                    >
                      <div className="ml-auto flex w-max max-w-none flex-nowrap justify-end gap-1">
                        {[
                          {
                            status: "Purchased" as PurchaseStatus,
                            label: "全購入",
                            activeColor:
                              "bg-green-700 text-white dark:bg-green-700",
                            hoverColor:
                              "hover:bg-green-100 dark:hover:bg-green-900/30",
                          },
                          {
                            status: "SoldOut" as PurchaseStatus,
                            label: "全売切",
                            activeColor:
                              "bg-red-600 text-white dark:bg-red-700",
                            hoverColor:
                              "hover:bg-red-100 dark:hover:bg-red-900/30",
                          },
                          {
                            status: "Absent" as PurchaseStatus,
                            label: "全欠席",
                            activeColor:
                              "bg-yellow-700 text-white dark:bg-yellow-700",
                            hoverColor:
                              "hover:bg-yellow-100 dark:hover:bg-yellow-900/30",
                          },
                          {
                            status: "Postpone" as PurchaseStatus,
                            label: "全後回",
                            activeColor:
                              "bg-purple-600 text-white dark:bg-purple-600",
                            hoverColor:
                              "hover:bg-purple-100 dark:hover:bg-purple-900/30",
                          },
                          {
                            status: "Late" as PurchaseStatus,
                            label: "全遅参",
                            activeColor:
                              "bg-blue-600 text-white dark:bg-blue-600",
                            hoverColor:
                              "hover:bg-blue-100 dark:hover:bg-blue-900/30",
                          },
                          {
                            status: "LimitedPurchase" as PurchaseStatus,
                            label: "全限数",
                            activeColor:
                              "bg-orange-700 text-white dark:bg-orange-700",
                            hoverColor:
                              "hover:bg-orange-100 dark:hover:bg-orange-900/30",
                          },
                        ].map(({ status, label, activeColor, hoverColor }) => {
                          const allMatch = group.items.every(
                            (item) => item.purchaseStatus === status,
                          );
                          return (
                            <button
                              key={status}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExecuteBulkStatusChange(
                                  group.groupKey,
                                  status,
                                  group.items,
                                );
                              }}
                              className={`${layoutMode === "smartphone" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"} flex-shrink-0 whitespace-nowrap font-medium rounded transition-colors ${
                                allMatch
                                  ? activeColor
                                  : `bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 ${hoverColor}`
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
              </div>
              {/* アイテム追加ボタン（編集モードPC時・実行モード時はここに配置、編集モードスマホ折りたたみ時はコントロールバーに移動済み） */}
              {!isInspecting &&
                !(
                  viewMode !== "execute" &&
                  layoutMode === "smartphone" &&
                  group.isCollapsed
                ) &&
                onAddItem && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const spaceBlock = group.spaceKey.split("-")[0];
                      const spaceNumber = group.spaceKey
                        .split("-")
                        .slice(1)
                        .join("-");
                      const circles = [
                        ...new Set(
                          group.items
                            .map((item) => item.circle)
                            .filter(Boolean),
                        ),
                      ];
                      openAddDialog(
                        spaceBlock,
                        spaceNumber,
                        circles,
                        e.currentTarget,
                      );
                    }}
                    className={`text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 rounded transition-colors ${
                      layoutMode === "smartphone"
                        ? "px-1.5 py-0.5 mr-1"
                        : "px-2 py-1 mr-2"
                    }`}
                    title="このスペースにアイテムを追加"
                    aria-label="このスペースにアイテムを追加"
                  >
                    <svg
                      className={
                        layoutMode === "smartphone" ? "w-4 h-4" : "w-5 h-5"
                      }
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                  </button>
                )}
            </div>

            {/* クロスグループチェーンUI（折りたたみヘッダー間） */}
            {!isInspecting && crossRangeInGroup && onToggleRangeSelection && (
              <div
                className={`absolute top-0 bottom-0 z-40 w-10 ${
                  columnType === "candidate" ? "left-0" : "right-0"
                } cursor-pointer ${
                  crossSpaceGroupRangeInfo!.onlyStartEndSelected
                    ? "opacity-50 hover:opacity-100"
                    : "opacity-100"
                }`}
                title={
                  crossSpaceGroupRangeInfo!.allSelected
                    ? "範囲内のチェックを外す"
                    : "範囲内のチェックを入れる"
                }
                onClick={() =>
                  onToggleRangeSelection(
                    crossSpaceGroupRangeInfo!.rangeGroupItems.map(
                      (item) => item.id,
                    ),
                  )
                }
              >
                <svg
                  className={`absolute h-full w-full ${
                    columnType === "candidate"
                      ? "-left-[42px]"
                      : "-right-[42px]"
                  }`}
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient
                      id={`chainMetal-cross-${group.groupKey}`}
                      x1="0%"
                      y1="0%"
                      x2="100%"
                      y2="0%"
                    >
                      <stop offset="0%" stopColor="#9CA3AF" />
                      <stop offset="50%" stopColor="#D1D5DB" />
                      <stop offset="100%" stopColor="#9CA3AF" />
                    </linearGradient>
                    <pattern
                      id={`chainPattern-cross-${group.groupKey}`}
                      x="0"
                      y="0"
                      width="40"
                      height="20"
                      patternUnits="userSpaceOnUse"
                    >
                      <rect
                        x="14"
                        y="-2"
                        width="12"
                        height="18"
                        rx="6"
                        fill="none"
                        stroke={`url(#chainMetal-cross-${group.groupKey})`}
                        strokeWidth="3"
                      />
                      <rect
                        x="17"
                        y="13"
                        width="6"
                        height="8"
                        rx="2"
                        fill={`url(#chainMetal-cross-${group.groupKey})`}
                        stroke="#4B5563"
                        strokeWidth="0.5"
                      />
                    </pattern>
                  </defs>

                  {isCrossStart && (
                    <rect
                      x="0"
                      y="50%"
                      width="40"
                      height="50%"
                      fill={`url(#chainPattern-cross-${group.groupKey})`}
                    />
                  )}
                  {isCrossEnd && (
                    <rect
                      x="0"
                      y="0"
                      width="40"
                      height="50%"
                      fill={`url(#chainPattern-cross-${group.groupKey})`}
                    />
                  )}
                  {isCrossMiddle && (
                    <rect
                      x="0"
                      y="0"
                      width="40"
                      height="100%"
                      fill={`url(#chainPattern-cross-${group.groupKey})`}
                    />
                  )}

                  {isCrossStart && (
                    <ellipse
                      cx="20"
                      cy="100%"
                      rx="10"
                      ry="5"
                      fill="none"
                      stroke={`url(#chainMetal-cross-${group.groupKey})`}
                      strokeWidth="3"
                    />
                  )}
                  {isCrossEnd && (
                    <ellipse
                      cx="20"
                      cy="0"
                      rx="10"
                      ry="5"
                      fill="none"
                      stroke={`url(#chainMetal-cross-${group.groupKey})`}
                      strokeWidth="3"
                    />
                  )}
                </svg>
              </div>
            )}

            {/* グループ内アイテム（展開時のみ表示） */}
            {!group.isCollapsed && (
              <div
                role="list"
                aria-label={`${row.label}の項目`}
                className={`mt-1 ${
                  layoutMode === "smartphone" ? "space-y-2" : "space-y-4"
                }`}
              >
                {renderedItemRows.map((renderedItemRow, spaceItemIndex) => {
                  const item = renderedItemRow.row.item;
                  const globalIndex = itemIndexById.get(item.id) ?? -1;

                  const isThisGroupInRange =
                    spaceGroupRangeInfo &&
                    spaceGroupRangeInfo.groupKey === group.groupKey;
                  const isInRange =
                    isThisGroupInRange &&
                    spaceItemIndex >= spaceGroupRangeInfo!.startIndex &&
                    spaceItemIndex <= spaceGroupRangeInfo!.endIndex;
                  const isStart =
                    isThisGroupInRange &&
                    spaceItemIndex === spaceGroupRangeInfo!.startIndex;
                  const isEnd =
                    isThisGroupInRange &&
                    spaceItemIndex === spaceGroupRangeInfo!.endIndex;
                  const isMiddle =
                    isThisGroupInRange &&
                    spaceItemIndex > spaceGroupRangeInfo!.startIndex &&
                    spaceItemIndex < spaceGroupRangeInfo!.endIndex;

                  return renderedItemRow.render(
                    <div
                      key={item.id}
                      data-item-id={item.id}
                      data-space-navigation-visit-id={getExecutionVisitIdForItem(
                        item,
                      )}
                      data-space-navigation-anchor="item"
                      draggable={!isInspecting}
                      onDragStart={
                        !isInspecting
                          ? (e) => handleDragStart(e, item)
                          : undefined
                      }
                      onDragOver={
                        !isInspecting
                          ? (e) => handleDragOver(e, item)
                          : undefined
                      }
                      onDrop={!isInspecting ? handleDrop : undefined}
                      onDragEnd={!isInspecting ? cleanUp : undefined}
                      onTouchStart={
                        !isInspecting
                          ? (e) => handleItemTouchStart(e, item)
                          : undefined
                      }
                      onTouchMove={
                        !isInspecting ? handleItemTouchMove : undefined
                      }
                      onTouchEnd={
                        !isInspecting ? handleItemTouchEnd : undefined
                      }
                      onTouchCancel={
                        !isInspecting ? handleItemTouchCancel : undefined
                      }
                      className="transition-opacity duration-200 relative"
                      data-is-selected={selectedItemIds.has(item.id)}
                    >
                      <ShoppingItemCard
                        preferNativeOptions={preferNativeOptions}
                        item={item}
                        onUpdate={updateItemWithDeferredCleanup}
                        isStriped={globalIndex % 2 !== 0}
                        onEditRequest={handleCardEditRequest}
                        onDeleteRequest={handleCardDeleteRequest}
                        isSelected={selectedItemIds.has(item.id)}
                        onSelectItem={handleCardSelectItem}
                        blockBackgroundColor={blockColorMap.get(item.id)}
                        onMoveUp={onMoveItemUp ? handleCardMoveUp : undefined}
                        onMoveDown={
                          onMoveItemDown ? handleCardMoveDown : undefined
                        }
                        canMoveUp={globalIndex > 0}
                        canMoveDown={globalIndex < items.length - 1}
                        isDuplicateCircle={duplicateCircleItemIds.has(item.id)}
                        isSearchMatch={highlightedItemId === item.id}
                        layoutMode={layoutMode}
                        viewMode={viewMode}
                        highlightPrice={priceHighlightItemIds.has(item.id)}
                        highlightLimitedMissing={limitedMissingHighlightItemIds.has(
                          item.id,
                        )}
                        getLatestItemById={getLatestItemById}
                        onNotify={showLimitedMessage}
                        onLimitedPurchaseDefer={
                          viewMode === "execute" && columnType === "execute"
                            ? markLimitedPurchaseQuantityDeferred
                            : undefined
                        }
                        onPostEventDistributionCheckRequest={
                          viewMode === "execute" && columnType === "execute"
                            ? handleCardPostEventDistributionCheckRequest
                            : undefined
                        }
                        purchaseStatusControlMode={purchaseStatusControlMode}
                        skipLimitedPurchaseForSingleQuantity={
                          skipLimitedPurchaseForSingleQuantity
                        }
                        readOnly={isInspecting}
                      />

                      {/* チェーン範囲選択UI（スペースグループ内） */}
                      {!isInspecting && isInRange && onToggleRangeSelection && (
                        <div
                          className={`absolute top-0 bottom-0 z-40 w-10 ${
                            columnType === "candidate" ? "left-0" : "right-0"
                          } cursor-pointer ${
                            spaceGroupRangeInfo!.onlyStartEndSelected
                              ? "opacity-50 hover:opacity-100"
                              : "opacity-100"
                          }`}
                          title={
                            spaceGroupRangeInfo!.allSelected
                              ? "範囲内のチェックを外す"
                              : "範囲内のチェックを入れる"
                          }
                          onClick={() =>
                            onToggleRangeSelection(
                              spaceGroupRangeInfo!.rangeItems.map(
                                (rangeItem) => rangeItem.id,
                              ),
                            )
                          }
                        >
                          <svg
                            className={`absolute h-full w-full ${
                              columnType === "candidate"
                                ? "-left-[42px]"
                                : "-right-[42px]"
                            }`}
                            preserveAspectRatio="none"
                          >
                            <defs>
                              <linearGradient
                                id={`chainMetal-space-${item.id}`}
                                x1="0%"
                                y1="0%"
                                x2="100%"
                                y2="0%"
                              >
                                <stop offset="0%" stopColor="#9CA3AF" />
                                <stop offset="50%" stopColor="#D1D5DB" />
                                <stop offset="100%" stopColor="#9CA3AF" />
                              </linearGradient>
                              <pattern
                                id={`chainPattern-space-${item.id}`}
                                x="0"
                                y="0"
                                width="40"
                                height="20"
                                patternUnits="userSpaceOnUse"
                              >
                                <rect
                                  x="14"
                                  y="-2"
                                  width="12"
                                  height="18"
                                  rx="6"
                                  fill="none"
                                  stroke={`url(#chainMetal-space-${item.id})`}
                                  strokeWidth="3"
                                />
                                <rect
                                  x="17"
                                  y="13"
                                  width="6"
                                  height="8"
                                  rx="2"
                                  fill={`url(#chainMetal-space-${item.id})`}
                                  stroke="#4B5563"
                                  strokeWidth="0.5"
                                />
                              </pattern>
                            </defs>

                            {isStart && (
                              <rect
                                x="0"
                                y="50%"
                                width="40"
                                height="50%"
                                fill={`url(#chainPattern-space-${item.id})`}
                              />
                            )}
                            {isEnd && (
                              <rect
                                x="0"
                                y="0"
                                width="40"
                                height="50%"
                                fill={`url(#chainPattern-space-${item.id})`}
                              />
                            )}
                            {isMiddle && (
                              <rect
                                x="0"
                                y="0"
                                width="40"
                                height="100%"
                                fill={`url(#chainPattern-space-${item.id})`}
                              />
                            )}

                            {isStart && (
                              <ellipse
                                cx="20"
                                cy="100%"
                                rx="10"
                                ry="5"
                                fill="none"
                                stroke={`url(#chainMetal-space-${item.id})`}
                                strokeWidth="3"
                              />
                            )}
                            {isEnd && (
                              <ellipse
                                cx="20"
                                cy="0"
                                rx="10"
                                ry="5"
                                fill="none"
                                stroke={`url(#chainMetal-space-${item.id})`}
                                strokeWidth="3"
                              />
                            )}
                          </svg>
                        </div>
                      )}
                    </div>,
                  );
                })}
                {/* 実行モード: 全アイテム非未購入時のボタン */}
                {viewMode === "execute" &&
                  !isInspecting &&
                  (() => {
                    const allNonNone = group.items.every(
                      (item) => item.purchaseStatus !== "None",
                    );
                    if (!allNonNone) return null;
                    const isLastGroup = groupIndex === spaceGroups.length - 1;

                    if (
                      isLastGroup &&
                      showPostponeFilterButton &&
                      onActivatePostponeFilter
                    ) {
                      return (
                        <button
                          onClick={() => {
                            if (
                              blockPriceOrLimitedMissingIfNeeded(
                                group.groupKey,
                                group.items,
                              )
                            ) {
                              return;
                            }
                            onActivatePostponeFilter();
                          }}
                          className={`w-full mt-2 py-2 rounded-lg font-medium transition-colors bg-orange-700 hover:bg-orange-800 text-white dark:bg-orange-700 dark:hover:bg-orange-800 ${
                            layoutMode === "smartphone" ? "text-sm" : "text-sm"
                          }`}
                        >
                          後回しでフィルタ
                        </button>
                      );
                    }

                    if (
                      isLastGroup &&
                      showLateFilterButton &&
                      onActivateLateFilter
                    ) {
                      return (
                        <button
                          onClick={() => {
                            if (
                              blockPriceOrLimitedMissingIfNeeded(
                                group.groupKey,
                                group.items,
                              )
                            ) {
                              return;
                            }
                            onActivateLateFilter();
                          }}
                          className={`w-full mt-2 py-2 rounded-lg font-medium transition-colors bg-sky-700 hover:bg-sky-800 text-white dark:bg-sky-700 dark:hover:bg-sky-800 ${
                            layoutMode === "smartphone" ? "text-sm" : "text-sm"
                          }`}
                        >
                          遅参でフィルタ
                        </button>
                      );
                    }

                    // 最下段以外: スペースを閉じて次のスペースを展開
                    if (!isLastGroup && onCollapseAndOpenNext) {
                      return (
                        <button
                          onClick={() => {
                            if (
                              blockPriceOrLimitedMissingIfNeeded(
                                group.groupKey,
                                group.items,
                              )
                            ) {
                              return;
                            }
                            onCollapseAndOpenNext(group.groupKey);
                          }}
                          className={`w-full mt-2 py-2 rounded-lg font-medium transition-colors bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700 ${
                            layoutMode === "smartphone" ? "text-sm" : "text-sm"
                          }`}
                        >
                          スペースを閉じて次のスペースを展開
                        </button>
                      );
                    }

                    return null;
                  })()}
              </div>
            )}
          </div>
        </div>
      );
    };

    return (
      <GroupedListRenderer
        defer={useRetainedViewport}
        zoomPercent={viewportZoomPercent}
        pinnedRowKeys={
          new Set(
            listReadModel.itemRows
              .filter(
                (row) =>
                  retainedItemIds?.includes(row.itemId) ||
                  row.itemId === limitedBulkDialogContext?.itemSnapshot.id ||
                  (postEventDistributionCheckContext?.mode === "single" &&
                    postEventDistributionCheckContext.targets[0]?.id ===
                      row.itemId) ||
                  row.rowKey === listControllerState.focusedRowKey ||
                  row.itemId === dragItem.current ||
                  touchDragSpaceGroupIds.current?.includes(row.itemId),
              )
              .map((row) => row.rowKey),
          )
        }
        engine={listRendererSelection.engine}
        layoutMode={layoutMode}
        getVisitId={getExecutionVisitIdForItem}
        getGroupVisitId={getGroupVisitId}
        model={listReadModel}
        selectionReason={listRendererSelection.reason}
        accessibleLabel="買い物リスト"
        focusedRowKey={listControllerState.focusedRowKey}
        rootRef={containerRef}
        rootProps={{
          className: "relative space-y-1 pb-[var(--footer-height,96px)]",
          onBlurCapture: handleFullListBlurCapture,
          onDragOver: !isInspecting ? handleContainerDragOver : undefined,
          onDrop: !isInspecting ? handleDrop : undefined,
          onDragLeave: handleContainerDragLeave,
          onFocusCapture: handleFullListFocusCapture,
        }}
        beforeContent={
          <>
            {limitedPurchaseOverlays}
            {onToggleAllSpaceCollapse && (
              <div className="flex justify-end mb-1">
                <button
                  onClick={() => onToggleAllSpaceCollapse(!allCollapsed)}
                  className="text-xs px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                >
                  {allCollapsed ? "全て展開" : "全て折りたたむ"}
                </button>
              </div>
            )}
          </>
        }
        renderDependencies={[
          dragWorkspace,
          layoutMode,
          viewMode,
          columnType,
          hallDefinitions,
          hallOrder,
          mapData,
          selectedItemIds,
          priceHighlightItemIds,
          limitedMissingHighlightItemIds,
          expandedRemarks,
          rangeStart,
          rangeEnd,
          groupRangeInfo,
          spaceGroupRangeInfo,
          crossSpaceGroupRangeInfo,
          isInspecting,
          purchaseStatusControlMode,
          skipLimitedPurchaseForSingleQuantity,
          preferNativeOptions,
          onSelectItem,
          onMoveItemUp,
          onMoveItemDown,
          onToggleRangeSelection,
          onToggleSpaceCollapse,
          onSetSpaceGroupDragItemIds,
          onSelectSpaceGroupForRange,
          onAddItem,
          onBulkStatusChange,
          onSpaceGroupOrderChange,
          onCollapseAndOpenNext,
          showPostponeFilterButton,
          showLateFilterButton,
          onActivatePostponeFilter,
          onActivateLateFilter,
          disablePriceUndefinedCheck,
          _disableLimitedPurchaseQuantityCheck,
          postEventDistributionCheckEnabled,
          deferredLimitedItemIdsByGroupKey,
        ]}
        getGroupVersion={(key) =>
          spaceGroups[spaceGroupIndexByKey.get(key) ?? -1]
        }
        renderGroup={renderSpaceGroupRow}
        afterContent={
          addDialogOpen &&
          !isInspecting &&
          ReactDOM.createPortal(
            <div
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm"
              onClick={closeAddDialog}
            >
              <div
                ref={addDialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={addDialogIds.title}
                aria-describedby={addDialogIds.description}
                className="bg-white dark:bg-slate-800 rounded-lg shadow-2xl max-w-lg w-full mx-4 overflow-hidden max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleAddDialogKeyDown}
              >
                <div className="bg-gradient-to-r from-green-700 to-emerald-700 text-white p-4">
                  <h2 id={addDialogIds.title} className="text-lg font-bold">
                    新規アイテム追加
                  </h2>
                  <p id={addDialogIds.description} className="text-sm mt-1">
                    {currentDay} {addDialogDefaults.block}-
                    {addDialogDefaults.number}
                  </p>
                </div>
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor={addDialogIds.circle}
                        className={labelClass}
                      >
                        サークル名{" "}
                        <span aria-hidden="true" className="text-red-500">
                          *
                        </span>
                      </label>
                      <input
                        id={addDialogIds.circle}
                        type="text"
                        required
                        value={newItemForm.circle}
                        onChange={(e) =>
                          setNewItemForm((prev) => ({
                            ...prev,
                            circle: e.target.value,
                          }))
                        }
                        className={formInputClass}
                        placeholder="サークル名"
                        ref={addDialogInputRef}
                        list={addDialogIds.circleSuggestions}
                      />
                      {addDialogCircleSuggestions.length > 0 && (
                        <datalist id={addDialogIds.circleSuggestions}>
                          {addDialogCircleSuggestions.map((c) => (
                            <option key={c} value={c} />
                          ))}
                        </datalist>
                      )}
                    </div>
                    <div>
                      <label
                        htmlFor={addDialogIds.itemTitle}
                        className={labelClass}
                      >
                        タイトル
                      </label>
                      <input
                        id={addDialogIds.itemTitle}
                        type="text"
                        value={newItemForm.title}
                        onChange={(e) =>
                          setNewItemForm((prev) => ({
                            ...prev,
                            title: e.target.value,
                          }))
                        }
                        className={formInputClass}
                        placeholder="新刊セット"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label
                        htmlFor={addDialogIds.eventDate}
                        className={labelClass}
                      >
                        参加日
                      </label>
                      <input
                        id={addDialogIds.eventDate}
                        type="text"
                        value={currentDay || ""}
                        readOnly
                        className={`${formInputClass} bg-slate-100 dark:bg-slate-700`}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={addDialogIds.block}
                        className={labelClass}
                      >
                        ブロック
                      </label>
                      <input
                        id={addDialogIds.block}
                        type="text"
                        value={newItemForm.block}
                        onChange={(e) =>
                          setNewItemForm((prev) => ({
                            ...prev,
                            block: e.target.value,
                          }))
                        }
                        className={formInputClass}
                        placeholder="A"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={addDialogIds.number}
                        className={labelClass}
                      >
                        ナンバー
                      </label>
                      <input
                        id={addDialogIds.number}
                        type="text"
                        value={newItemForm.number}
                        onChange={(e) =>
                          setNewItemForm((prev) => ({
                            ...prev,
                            number: e.target.value,
                          }))
                        }
                        className={formInputClass}
                        placeholder="01a"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                    <div className="relative">
                      <label
                        htmlFor={addDialogIds.price}
                        className={labelClass}
                      >
                        購入金額
                      </label>
                      <input
                        id={addDialogIds.price}
                        type="text"
                        value={newItemForm.price}
                        onChange={(e) => {
                          const value = e.target.value.replace(/[^0-9]/g, "");
                          setNewItemForm((prev) => ({
                            ...prev,
                            price: value,
                          }));
                        }}
                        className={`${formInputClass} pr-12`}
                        placeholder="0"
                        inputMode="numeric"
                      />
                      <span
                        aria-hidden="true"
                        className="absolute right-3 top-9 text-slate-500 dark:text-slate-400"
                      >
                        円
                      </span>
                    </div>
                    <div>
                      <label
                        htmlFor={addDialogIds.quickPrice}
                        className={labelClass}
                      >
                        クイック選択
                      </label>
                      <select
                        id={addDialogIds.quickPrice}
                        onChange={(e) => {
                          setNewItemForm((prev) => ({
                            ...prev,
                            price: e.target.value,
                          }));
                        }}
                        className={formInputClass}
                        value={
                          addFormPriceOptions.includes(
                            Number(newItemForm.price),
                          )
                            ? newItemForm.price
                            : ""
                        }
                      >
                        <option value="" disabled>
                          金額を選択...
                        </option>
                        {addFormPriceOptions.map((p) => (
                          <option key={p} value={p}>
                            {p.toLocaleString()}円
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor={addDialogIds.quantity}
                        className={labelClass}
                      >
                        数量
                      </label>
                      <select
                        id={addDialogIds.quantity}
                        value={newItemForm.quantity}
                        onChange={(e) =>
                          setNewItemForm((prev) => ({
                            ...prev,
                            quantity: e.target.value,
                          }))
                        }
                        className={formInputClass}
                      >
                        {buildQuantityOptions(newItemForm.quantity).map(
                          (num) => (
                            <option key={num} value={num}>
                              {num}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor={addDialogIds.purchaseStatus}
                        className={labelClass}
                      >
                        購入状態
                      </label>
                      <select
                        id={addDialogIds.purchaseStatus}
                        value={newItemForm.purchaseStatus}
                        onChange={(e) =>
                          setNewItemForm((prev) => ({
                            ...prev,
                            purchaseStatus: e.target
                              .value as typeof newItemForm.purchaseStatus,
                          }))
                        }
                        className={formInputClass}
                      >
                        <option value="None">未購入</option>
                        <option value="Purchased">購入済</option>
                        <option value="Postpone">後回し</option>
                        <option value="Late">遅参</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor={addDialogIds.remarks}
                        className={labelClass}
                      >
                        利用者メモ
                      </label>
                      <input
                        id={addDialogIds.remarks}
                        type="text"
                        value={newItemForm.remarks}
                        onChange={(e) =>
                          setNewItemForm((prev) => ({
                            ...prev,
                            remarks: e.target.value,
                          }))
                        }
                        className={formInputClass}
                        placeholder="スケブお願い"
                      />
                    </div>
                    <div>
                      <label htmlFor={addDialogIds.url} className={labelClass}>
                        URL
                      </label>
                      <input
                        id={addDialogIds.url}
                        type="text"
                        value={newItemForm.url}
                        onChange={(e) =>
                          setNewItemForm((prev) => ({
                            ...prev,
                            url: e.target.value,
                          }))
                        }
                        className={formInputClass}
                        placeholder="https://example.com"
                      />
                    </div>
                  </div>
                </div>
                <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex gap-2">
                  <button
                    type="button"
                    onClick={closeAddDialog}
                    className="flex-1 py-2 px-4 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg font-medium transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={handleAddItemSubmit}
                    disabled={!newItemForm.circle.trim()}
                    className="flex-1 py-2 px-4 bg-green-700 hover:bg-green-800 disabled:bg-slate-400 text-white rounded-lg font-medium transition-colors"
                  >
                    リストに追加
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        }
      />
    );
  }

  // ホールグループ化表示
  // ホール定義 0 件でも、優先度別の未定義セクション (highest/priority/none) が
  // 1 つでもあれば groupItemsByHallOrder が複数バケットを返す
  if (shouldShowHallGroups) {
    const hallGroupIndexByKey = new Map(
      hallGroups.map(
        (group, index) =>
          [group.groupId ?? `ungrouped:${index}`, index] as const,
      ),
    );
    const renderHallGroupRow = (
      row: Extract<ShoppingListRow, { kind: "group" }>,
      renderedItemRows: readonly FullListRenderedItemRow[],
    ): React.ReactNode => {
      const groupIndex = hallGroupIndexByKey.get(row.groupKey);
      if (groupIndex === undefined) {
        throw new Error(
          `ShoppingList invariant failed: unknown hall group ${row.groupKey}`,
        );
      }
      const group = hallGroups[groupIndex];

      const headerStyle = getGroupHeaderStyle(group.groupId, hallDefinitions);
      const displayName = getGroupDisplayName(group.groupId, hallDefinitions);

      // このグループ内での範囲選択情報
      const isThisGroupInRange =
        groupRangeInfo && groupRangeInfo.groupId === group.groupId;

      return (
        <div key={group.groupId ?? `no-hall-${groupIndex}`} className="mb-4">
          {/* グループヘッダー */}
          <div
            className={`sticky top-0 z-20 flex items-center justify-between overflow-hidden rounded-t-lg px-4 py-2 ${headerStyle.bgClass}`}
          >
            <svg
              aria-hidden="true"
              className="absolute inset-y-0 left-0 h-full w-1"
              preserveAspectRatio="none"
              viewBox="0 0 4 100"
            >
              <rect fill={headerStyle.borderColor} height="100" width="4" />
            </svg>
            <span className="font-bold text-sm text-slate-700 dark:text-slate-300">
              {displayName}
            </span>
            <span className="text-xs text-slate-600 dark:text-slate-300">
              {group.items.length}件
            </span>
          </div>

          {/* グループ内アイテム */}
          <div
            role="list"
            aria-label={`${row.label}の項目`}
            className={`mt-2 ${
              layoutMode === "smartphone" ? "space-y-2" : "space-y-4"
            }`}
          >
            {renderedItemRows.map((renderedItemRow, hallIndex) => {
              const item = renderedItemRow.row.item;
              const globalIndex = itemIndexById.get(item.id) ?? -1;

              const isInRange =
                isThisGroupInRange &&
                hallIndex >= groupRangeInfo!.startIndex &&
                hallIndex <= groupRangeInfo!.endIndex;
              const isStart =
                isThisGroupInRange && hallIndex === groupRangeInfo!.startIndex;
              const isEnd =
                isThisGroupInRange && hallIndex === groupRangeInfo!.endIndex;
              const isMiddle =
                isThisGroupInRange &&
                hallIndex > groupRangeInfo!.startIndex &&
                hallIndex < groupRangeInfo!.endIndex;

              return renderedItemRow.render(
                <div
                  key={item.id}
                  data-item-id={item.id}
                  data-space-navigation-visit-id={getExecutionVisitIdForItem(
                    item,
                  )}
                  data-space-navigation-anchor="item"
                  draggable={!isInspecting}
                  onDragStart={
                    !isInspecting ? (e) => handleDragStart(e, item) : undefined
                  }
                  onDragOver={
                    !isInspecting ? (e) => handleDragOver(e, item) : undefined
                  }
                  onDrop={!isInspecting ? handleDrop : undefined}
                  onDragEnd={!isInspecting ? cleanUp : undefined}
                  onTouchStart={
                    !isInspecting
                      ? (e) => handleItemTouchStart(e, item)
                      : undefined
                  }
                  onTouchMove={!isInspecting ? handleItemTouchMove : undefined}
                  onTouchEnd={!isInspecting ? handleItemTouchEnd : undefined}
                  onTouchCancel={
                    !isInspecting ? handleItemTouchCancel : undefined
                  }
                  className={`transition-opacity duration-200 relative ${
                    group.priority === "highest"
                      ? "bg-red-50/30 dark:bg-red-950/20"
                      : group.priority === "priority"
                        ? "bg-orange-50/30 dark:bg-orange-950/20"
                        : ""
                  }`}
                  data-is-selected={selectedItemIds.has(item.id)}
                >
                  <ShoppingItemCard
                    preferNativeOptions={preferNativeOptions}
                    item={item}
                    onUpdate={handleCardUpdateItem}
                    isStriped={globalIndex % 2 !== 0}
                    onEditRequest={handleCardEditRequest}
                    onDeleteRequest={handleCardDeleteRequest}
                    isSelected={selectedItemIds.has(item.id)}
                    onSelectItem={handleCardSelectItem}
                    blockBackgroundColor={blockColorMap.get(item.id)}
                    onMoveUp={onMoveItemUp ? handleCardMoveUp : undefined}
                    onMoveDown={onMoveItemDown ? handleCardMoveDown : undefined}
                    canMoveUp={globalIndex > 0}
                    canMoveDown={globalIndex < items.length - 1}
                    isDuplicateCircle={duplicateCircleItemIds.has(item.id)}
                    isSearchMatch={highlightedItemId === item.id}
                    layoutMode={layoutMode}
                    viewMode={viewMode}
                    hallIndex={hallIndex}
                    priorityLevel={group.priority}
                    highlightPrice={priceHighlightItemIds.has(item.id)}
                    highlightLimitedMissing={limitedMissingHighlightItemIds.has(
                      item.id,
                    )}
                    getLatestItemById={getLatestItemById}
                    onNotify={showLimitedMessage}
                    onPostEventDistributionCheckRequest={
                      viewMode === "execute" && columnType === "execute"
                        ? handleCardPostEventDistributionCheckRequest
                        : undefined
                    }
                    purchaseStatusControlMode={purchaseStatusControlMode}
                    skipLimitedPurchaseForSingleQuantity={
                      skipLimitedPurchaseForSingleQuantity
                    }
                    readOnly={isInspecting}
                  />

                  {/* 範囲選択表示とチェーン選択UI（グループ内のみ） */}
                  {!isInspecting && isInRange && onToggleRangeSelection && (
                    <div
                      className={`absolute top-0 bottom-0 z-40 w-10 ${
                        columnType === "candidate" ? "left-0" : "right-0"
                      } cursor-pointer ${
                        groupRangeInfo!.onlyStartEndSelected
                          ? "opacity-50 hover:opacity-100"
                          : "opacity-100"
                      }`}
                      title={
                        groupRangeInfo!.allSelected
                          ? "範囲内のチェックを外す"
                          : "範囲内のチェックを入れる"
                      }
                      onClick={() =>
                        onToggleRangeSelection(
                          groupRangeInfo!.rangeItems.map(
                            (rangeItem) => rangeItem.id,
                          ),
                        )
                      }
                    >
                      <svg
                        className={`absolute h-full w-full ${
                          columnType === "candidate"
                            ? "-left-[42px]"
                            : "-right-[42px]"
                        }`}
                        preserveAspectRatio="none"
                      >
                        <defs>
                          <linearGradient
                            id={`chainMetal-group-${item.id}`}
                            x1="0%"
                            y1="0%"
                            x2="100%"
                            y2="0%"
                          >
                            <stop offset="0%" stopColor="#9CA3AF" />
                            <stop offset="50%" stopColor="#D1D5DB" />
                            <stop offset="100%" stopColor="#9CA3AF" />
                          </linearGradient>
                          <pattern
                            id={`chainPattern-group-${item.id}`}
                            x="0"
                            y="0"
                            width="40"
                            height="20"
                            patternUnits="userSpaceOnUse"
                          >
                            <rect
                              x="14"
                              y="-2"
                              width="12"
                              height="18"
                              rx="6"
                              fill="none"
                              stroke={`url(#chainMetal-group-${item.id})`}
                              strokeWidth="3"
                            />
                            <rect
                              x="17"
                              y="13"
                              width="6"
                              height="8"
                              rx="2"
                              fill={`url(#chainMetal-group-${item.id})`}
                              stroke="#4B5563"
                              strokeWidth="0.5"
                            />
                          </pattern>
                        </defs>

                        {isStart && (
                          <rect
                            x="0"
                            y="50%"
                            width="40"
                            height="50%"
                            fill={`url(#chainPattern-group-${item.id})`}
                          />
                        )}
                        {isEnd && (
                          <rect
                            x="0"
                            y="0"
                            width="40"
                            height="50%"
                            fill={`url(#chainPattern-group-${item.id})`}
                          />
                        )}
                        {isMiddle && (
                          <rect
                            x="0"
                            y="0"
                            width="40"
                            height="100%"
                            fill={`url(#chainPattern-group-${item.id})`}
                          />
                        )}

                        {/* 端点のリング */}
                        {isStart && (
                          <ellipse
                            cx="20"
                            cy="100%"
                            rx="10"
                            ry="5"
                            fill="none"
                            stroke={`url(#chainMetal-group-${item.id})`}
                            strokeWidth="3"
                          />
                        )}
                        {isEnd && (
                          <ellipse
                            cx="20"
                            cy="0"
                            rx="10"
                            ry="5"
                            fill="none"
                            stroke={`url(#chainMetal-group-${item.id})`}
                            strokeWidth="3"
                          />
                        )}

                        {/* 中心の丸 */}
                        {isStart && (
                          <circle
                            cx="20"
                            cy="100%"
                            r="4"
                            fill={`url(#chainMetal-group-${item.id})`}
                            stroke="#4B5563"
                            strokeWidth="0.5"
                          />
                        )}
                        {isEnd && (
                          <circle
                            cx="20"
                            cy="0"
                            r="4"
                            fill={`url(#chainMetal-group-${item.id})`}
                            stroke="#4B5563"
                            strokeWidth="0.5"
                          />
                        )}
                      </svg>
                    </div>
                  )}
                </div>,
              );
            })}
          </div>
        </div>
      );
    };

    return (
      <GroupedListRenderer
        defer={useRetainedViewport}
        zoomPercent={viewportZoomPercent}
        pinnedRowKeys={
          new Set(
            listReadModel.itemRows
              .filter(
                (row) =>
                  retainedItemIds?.includes(row.itemId) ||
                  row.itemId === limitedBulkDialogContext?.itemSnapshot.id ||
                  (postEventDistributionCheckContext?.mode === "single" &&
                    postEventDistributionCheckContext.targets[0]?.id ===
                      row.itemId) ||
                  row.rowKey === listControllerState.focusedRowKey ||
                  row.itemId === dragItem.current ||
                  touchDragSpaceGroupIds.current?.includes(row.itemId),
              )
              .map((row) => row.rowKey),
          )
        }
        engine={listRendererSelection.engine}
        layoutMode={layoutMode}
        getVisitId={getExecutionVisitIdForItem}
        getGroupVisitId={getGroupVisitId}
        model={listReadModel}
        selectionReason={listRendererSelection.reason}
        accessibleLabel="買い物リスト"
        focusedRowKey={listControllerState.focusedRowKey}
        rootRef={containerRef}
        rootProps={{
          className: "relative space-y-2 pb-[var(--footer-height,96px)]",
          onBlurCapture: handleFullListBlurCapture,
          onDragOver: !isInspecting ? handleContainerDragOver : undefined,
          onDrop: !isInspecting ? handleDrop : undefined,
          onDragLeave: handleContainerDragLeave,
          onFocusCapture: handleFullListFocusCapture,
        }}
        renderDependencies={[
          dragWorkspace,
          layoutMode,
          viewMode,
          columnType,
          hallDefinitions,
          hallOrder,
          mapData,
          selectedItemIds,
          priceHighlightItemIds,
          limitedMissingHighlightItemIds,
          expandedRemarks,
          rangeStart,
          rangeEnd,
          groupRangeInfo,
          spaceGroupRangeInfo,
          crossSpaceGroupRangeInfo,
          isInspecting,
          purchaseStatusControlMode,
          skipLimitedPurchaseForSingleQuantity,
          preferNativeOptions,
          onSelectItem,
          onMoveItemUp,
          onMoveItemDown,
          onToggleRangeSelection,
          onToggleSpaceCollapse,
          onSetSpaceGroupDragItemIds,
          onSelectSpaceGroupForRange,
          onAddItem,
          onBulkStatusChange,
          onSpaceGroupOrderChange,
          onCollapseAndOpenNext,
          showPostponeFilterButton,
          showLateFilterButton,
          onActivatePostponeFilter,
          onActivateLateFilter,
          disablePriceUndefinedCheck,
          _disableLimitedPurchaseQuantityCheck,
          postEventDistributionCheckEnabled,
          deferredLimitedItemIdsByGroupKey,
        ]}
        renderGroup={renderHallGroupRow}
      />
    );
  }

  const renderUngroupedItemRow = (
    row: ShoppingListItemRow,
    index: number,
  ): React.ReactElement => {
    const item = row.item;
    const isInRange =
      rangeInfo && index >= rangeInfo.startIndex && index <= rangeInfo.endIndex;
    const isStart = rangeInfo && index === rangeInfo.startIndex;
    const isEnd = rangeInfo && index === rangeInfo.endIndex;
    const isMiddle =
      rangeInfo && index > rangeInfo.startIndex && index < rangeInfo.endIndex;
    const rangeAppearanceClassName =
      rangeInfo &&
      rangeInfo.rangeItems.length >= FLAT_RANGE_ANIMATION_ITEM_LIMIT
        ? "esp-flat-range-chain-large"
        : "transition-opacity";

    return (
      <div
        key={row.rowKey}
        data-item-id={item.id}
        data-space-navigation-visit-id={getExecutionVisitIdForItem(item)}
        data-space-navigation-anchor="item"
        draggable={!isInspecting}
        onDragStart={
          !isInspecting ? (e) => handleDragStart(e, item) : undefined
        }
        onDragOver={!isInspecting ? (e) => handleDragOver(e, item) : undefined}
        onDrop={!isInspecting ? handleDrop : undefined}
        onDragEnd={!isInspecting ? cleanUp : undefined}
        onTouchStart={
          !isInspecting ? (e) => handleItemTouchStart(e, item) : undefined
        }
        onTouchMove={!isInspecting ? handleItemTouchMove : undefined}
        onTouchEnd={!isInspecting ? handleItemTouchEnd : undefined}
        onTouchCancel={!isInspecting ? handleItemTouchCancel : undefined}
        className="transition-opacity duration-200 relative"
        data-is-selected={selectedItemIds.has(item.id)}
      >
        <ShoppingItemCard
          preferNativeOptions={preferNativeOptions}
          item={item}
          onUpdate={handleCardUpdateItem}
          isStriped={index % 2 !== 0}
          onEditRequest={handleCardEditRequest}
          onDeleteRequest={handleCardDeleteRequest}
          isSelected={selectedItemIds.has(item.id)}
          onSelectItem={handleCardSelectItem}
          blockBackgroundColor={blockColorMap.get(item.id)}
          onMoveUp={onMoveItemUp ? handleCardMoveUp : undefined}
          onMoveDown={onMoveItemDown ? handleCardMoveDown : undefined}
          canMoveUp={index > 0}
          canMoveDown={index < items.length - 1}
          isDuplicateCircle={duplicateCircleItemIds.has(item.id)}
          isSearchMatch={highlightedItemId === item.id}
          layoutMode={layoutMode}
          viewMode={viewMode}
          highlightPrice={priceHighlightItemIds.has(item.id)}
          highlightLimitedMissing={limitedMissingHighlightItemIds.has(item.id)}
          getLatestItemById={getLatestItemById}
          onNotify={showLimitedMessage}
          onPostEventDistributionCheckRequest={
            viewMode === "execute" && columnType === "execute"
              ? handleCardPostEventDistributionCheckRequest
              : undefined
          }
          purchaseStatusControlMode={purchaseStatusControlMode}
          skipLimitedPurchaseForSingleQuantity={
            skipLimitedPurchaseForSingleQuantity
          }
          readOnly={isInspecting}
        />

        {/* チェーンをアイテムの右側（左列: execute）または左側（右列: candidate）に表示 */}
        {!isInspecting && isInRange && onToggleRangeSelection && (
          <div
            className={`absolute top-0 bottom-0 z-40 w-10 pointer-events-none ${
              columnType === "candidate" ? "left-0" : "right-0"
            }`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleRangeSelection(
                  rangeInfo.rangeItems.map((rangeItem) => rangeItem.id),
                );
              }}
              className={`esp-flat-range-chain ${
                isStart
                  ? "esp-flat-range-chain-start"
                  : isEnd
                    ? "esp-flat-range-chain-end"
                    : ""
              } ${
                columnType === "candidate"
                  ? "esp-flat-range-chain-candidate"
                  : ""
              } pointer-events-auto absolute h-full w-full ${rangeAppearanceClassName} ${
                rangeInfo.onlyStartEndSelected
                  ? "opacity-50 hover:opacity-100"
                  : "opacity-100"
              } ${
                columnType === "candidate" ? "-left-[42px]" : "-right-[42px]"
              }`}
              title={
                rangeInfo.allSelected
                  ? "範囲内のチェックを外す"
                  : "範囲内のチェックを入れる"
              }
              data-no-long-press
            ></button>
          </div>
        )}

        {/* アイテム間の隙間を埋めるチェーン */}
        {!isInspecting &&
          rangeInfo &&
          (isStart || isMiddle) &&
          onToggleRangeSelection && (
            <div
              className={`absolute bottom-0 z-50 h-4 w-10 pointer-events-none ${
                columnType === "candidate" ? "left-0" : "right-0"
              } ${
                columnType === "candidate" ? "-left-[42px]" : "-right-[42px]"
              }`}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleRangeSelection(
                    rangeInfo.rangeItems.map((rangeItem) => rangeItem.id),
                  );
                }}
                className={`esp-flat-range-chain-gap pointer-events-auto absolute w-full h-full ${rangeAppearanceClassName} ${
                  rangeInfo.onlyStartEndSelected
                    ? "opacity-50 hover:opacity-100"
                    : "opacity-100"
                }`}
                title={
                  rangeInfo.allSelected
                    ? "範囲内のチェックを外す"
                    : "範囲内のチェックを入れる"
                }
                data-no-long-press
              ></button>
            </div>
          )}
      </div>
    );
  };

  if (useRetainedViewportStructure) {
    return (
      <RetainedViewportListRenderer
        defer={useRetainedViewport}
        zoomPercent={viewportZoomPercent}
        pinnedRowKeys={
          new Set(
            listReadModel.itemRows
              .filter(
                (row) =>
                  retainedItemIds?.includes(row.itemId) ||
                  row.itemId === limitedBulkDialogContext?.itemSnapshot.id ||
                  (postEventDistributionCheckContext?.mode === "single" &&
                    postEventDistributionCheckContext.targets[0]?.id ===
                      row.itemId) ||
                  row.rowKey === listControllerState.focusedRowKey ||
                  row.itemId === dragItem.current ||
                  touchDragSpaceGroupIds.current?.includes(row.itemId),
              )
              .map((row) => row.rowKey),
          )
        }
        engine={listRendererSelection.engine}
        model={listReadModel}
        selectionReason={listRendererSelection.reason}
        accessibleLabel="買い物リスト"
        focusedRowKey={listControllerState.focusedRowKey}
        rootRef={containerRef}
        layoutMode={layoutMode}
        getVisitId={getExecutionVisitIdForItem}
        getGroupVisitId={getGroupVisitId}
        rootProps={{
          className: "relative space-y-4 pb-[var(--footer-height,96px)]",
          onBlurCapture: handleFullListBlurCapture,
          onFocusCapture: handleFullListFocusCapture,
          onDragOver: !isInspecting ? handleContainerDragOver : undefined,
          onDrop: !isInspecting ? handleDrop : undefined,
          onDragLeave: handleContainerDragLeave,
        }}
        beforeContent={limitedPurchaseOverlays}
        renderRow={(row, index) =>
          row.kind === "item" ? renderUngroupedItemRow(row, index) : null
        }
      />
    );
  }
  if (listRendererSelection.engine === "virtual") {
    return (
      <VirtualListRenderer
        model={listReadModel}
        accessibleLabel="買い物リスト"
        focusedRowKey={listControllerState.focusedRowKey}
        scrollRequest={listControllerState.scrollRequest}
        onFocusedRowKeyChange={handleFocusedRowKeyChange}
        onScrollRequestConsumed={handleScrollRequestConsumed}
        estimateSizePx={
          virtualListEligibility.rowHeightPx ??
          VIRTUAL_LIST_ESTIMATED_ROW_HEIGHT_PX
        }
        overscan={8}
        gapPx={layoutMode === "smartphone" ? 8 : 16}
        className="pb-[var(--footer-height,96px)]"
        beforeContent={limitedPurchaseOverlays}
        rootRef={containerRef}
        onDragLeave={handleContainerDragLeave}
        rootProps={{
          onDragOver: !isInspecting ? handleContainerDragOver : undefined,
          onDrop: !isInspecting ? handleDrop : undefined,
        }}
        renderRow={(row, index) =>
          row.kind === "item" ? renderUngroupedItemRow(row, index) : null
        }
      />
    );
  }

  return (
    <FullListRenderer
      model={listReadModel}
      selectionReason={listRendererSelection.reason}
      accessibleLabel="買い物リスト"
      focusedRowKey={listControllerState.focusedRowKey}
      rootRef={containerRef}
      rootProps={{
        className: `relative ${
          layoutMode === "smartphone" ? "space-y-2" : "space-y-4"
        } pb-[var(--footer-height,96px)]`,
        onBlurCapture: handleFullListBlurCapture,
        onDragOver: !isInspecting ? handleContainerDragOver : undefined,
        onDrop: !isInspecting ? handleDrop : undefined,
        onDragLeave: handleContainerDragLeave,
        onFocusCapture: handleFullListFocusCapture,
      }}
      beforeContent={limitedPurchaseOverlays}
      renderRow={(row, index) =>
        row.kind === "item" ? renderUngroupedItemRow(row, index) : null
      }
    />
  );
};

export default React.memo(ShoppingList);
