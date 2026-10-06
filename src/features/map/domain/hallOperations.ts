import { isCompleteHallOrder } from "../../consistency/domain/projection";
import type {
  DayMapData,
  HallDefinition,
  HallDefinitionsStore,
  HallRouteSettings,
  HallRouteSettingsStore,
} from "../../../types/map";
import type { ShoppingItem } from "../../../types/item";
import { getMaplessKey } from "../../../types/map";
import { getHallIdForItem, parseGroupId } from "../../../utils/hallGrouping";
import { coalesceExecutionVisitItemIdsForExplicitReorder } from "../../../utils/visitProjection";

type PriorityLevel = "none" | "priority" | "highest";

export const emptyHallRouteSettings = (): HallRouteSettings => ({
  hallOrder: [],
  hallVisitLists: [],
});

export const extractHallIdFromGroupId = (groupId: string): string =>
  parseGroupId(groupId).hallId ?? "undefined";

export const buildHallGroupId = (
  hallId: string | null,
  priority: PriorityLevel,
): string => {
  if (hallId === null) {
    if (priority === "highest") return "undefined:highest";
    if (priority === "priority") return "undefined:priority";
    return "undefined";
  }
  if (priority === "highest") return `${hallId}:highest`;
  if (priority === "priority") return `${hallId}:priority`;
  return hallId;
};

export const splitHallsForStorage = (
  halls: HallDefinition[],
): { polygonHalls: HallDefinition[]; maplessHalls: HallDefinition[] } => {
  const polygonHalls = halls
    .filter((hall) => hall.vertices && hall.vertices.length >= 4)
    .map(({ blockNames: _ignored, ...rest }) => rest as HallDefinition);
  const maplessHalls = halls.filter(
    (hall) =>
      (!hall.vertices || hall.vertices.length < 4) && !!hall.blockNames?.length,
  );

  return { polygonHalls, maplessHalls };
};

export const mergeHallOrder = (
  existingOrder: string[],
  hallIds: string[],
): string[] => [
  ...existingOrder.filter((id) =>
    hallIds.includes(extractHallIdFromGroupId(id)),
  ),
  ...hallIds.filter(
    (id) => !existingOrder.some((existingId) => existingId === id),
  ),
];

// Projected settings contain the complete mixed order. Definition edits only
// append new groups; canonical reference reconciliation removes deleted halls.
const mergeHallOrderForDefinitions = (
  settings: HallRouteSettings,
  hallIds: string[],
): string[] =>
  isCompleteHallOrder(settings)
    ? [
        ...settings.hallOrder,
        ...hallIds.filter((id) => !settings.hallOrder.includes(id)),
      ]
    : mergeHallOrder(settings.hallOrder, hallIds);

export const updateHallDefinitionsForHalls = ({
  previous,
  eventName,
  mapTabName,
  maplessKey,
  polygonHalls,
  maplessHalls,
}: {
  previous: HallDefinitionsStore;
  eventName: string;
  mapTabName: string;
  maplessKey: string | null;
  polygonHalls: HallDefinition[];
  maplessHalls: HallDefinition[];
}): HallDefinitionsStore => {
  const updated: HallDefinitionsStore = {
    ...previous,
    [eventName]: {
      ...(previous[eventName] || {}),
      [mapTabName]: polygonHalls,
    },
  };
  if (maplessKey) {
    updated[eventName][maplessKey] = maplessHalls;
  }
  return updated;
};

export const updateHallRouteSettingsForHalls = ({
  previous,
  eventName,
  mapTabName,
  maplessKey,
  polygonHalls,
  maplessHalls,
}: {
  previous: HallRouteSettingsStore;
  eventName: string;
  mapTabName: string;
  maplessKey: string | null;
  polygonHalls: HallDefinition[];
  maplessHalls: HallDefinition[];
}): HallRouteSettingsStore => {
  const previousEvent = previous[eventName] || {};
  const previousMapTab = previousEvent[mapTabName] || emptyHallRouteSettings();
  const polygonIds = polygonHalls.map((hall) => hall.id);
  const maplessIds = maplessHalls.map((hall) => hall.id);

  const updated: HallRouteSettingsStore = {
    ...previous,
    [eventName]: {
      ...previousEvent,
      [mapTabName]: {
        ...previousMapTab,
        hallOrder: mergeHallOrderForDefinitions(
          previousMapTab,
          isCompleteHallOrder(previousMapTab) && maplessKey
            ? [...polygonIds, ...maplessIds]
            : polygonIds,
        ),
      },
    },
  };

  if (maplessKey) {
    const previousMapless =
      previousEvent[maplessKey] || emptyHallRouteSettings();
    updated[eventName][maplessKey] = {
      ...previousMapless,
      hallOrder: mergeHallOrderForDefinitions(previousMapless, maplessIds),
    };
  }

  return updated;
};

export const updateMaplessHallDefinitions = ({
  previous,
  eventName,
  maplessKey,
  halls,
}: {
  previous: HallDefinitionsStore;
  eventName: string;
  maplessKey: string;
  halls: HallDefinition[];
}): HallDefinitionsStore => ({
  ...previous,
  [eventName]: {
    ...(previous[eventName] || {}),
    [maplessKey]: halls,
  },
});

export const updateMaplessHallRouteSettings = ({
  previous,
  eventName,
  maplessKey,
  halls,
}: {
  previous: HallRouteSettingsStore;
  eventName: string;
  maplessKey: string;
  halls: HallDefinition[];
}): HallRouteSettingsStore => {
  const previousEvent = previous[eventName] || {};
  const previousSettings =
    previousEvent[maplessKey] || emptyHallRouteSettings();
  const hallIds = halls.map((hall) => hall.id);

  return {
    ...previous,
    [eventName]: {
      ...previousEvent,
      [maplessKey]: {
        ...previousSettings,
        hallOrder: mergeHallOrderForDefinitions(previousSettings, hallIds),
      },
    },
  };
};

export const cloneHallsForDates = (
  sourceHalls: HallDefinition[],
  targetDates: string[],
): Map<string, { halls: HallDefinition[]; idMap: Map<string, string> }> => {
  const clonedByDate = new Map<
    string,
    { halls: HallDefinition[]; idMap: Map<string, string> }
  >();
  for (const date of targetDates) {
    const idMap = new Map<string, string>();
    const halls = sourceHalls.map((hall) => {
      const newId = `hall-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      idMap.set(hall.id, newId);
      return { ...hall, id: newId };
    });
    clonedByDate.set(date, { halls, idMap });
  }
  return clonedByDate;
};

const remapHallGroupId = (
  groupId: string,
  idMap: Map<string, string>,
): string | null => {
  const hallId = extractHallIdFromGroupId(groupId);
  const nextHallId = idMap.get(hallId);
  if (!nextHallId) return null;
  if (groupId.endsWith(":highest"))
    return buildHallGroupId(nextHallId, "highest");
  if (groupId.endsWith(":priority"))
    return buildHallGroupId(nextHallId, "priority");
  return buildHallGroupId(nextHallId, "none");
};

export const remapHallRouteSettings = (
  sourceSettings: HallRouteSettings,
  idMap: Map<string, string>,
): HallRouteSettings => ({
  ...sourceSettings,
  hallOrder: sourceSettings.hallOrder
    .map((id) => remapHallGroupId(id, idMap))
    .filter((id): id is string => !!id),
  hallVisitLists: (sourceSettings.hallVisitLists || [])
    .map((visitList) => {
      const hallId = remapHallGroupId(visitList.hallId, idMap);
      return hallId ? { ...visitList, hallId } : null;
    })
    .filter(
      (visitList): visitList is NonNullable<typeof visitList> => !!visitList,
    ),
});

export const splitGlobalHallRouteSettings = ({
  settings,
  mapHallIds,
  maplessHallIds,
  hasMapTab,
}: {
  settings: HallRouteSettings;
  mapHallIds: Set<string>;
  maplessHallIds: Set<string>;
  hasMapTab: boolean;
}): { mapSettings: HallRouteSettings; maplessSettings: HallRouteSettings } => {
  const mapOrder: string[] = [];
  const maplessOrder: string[] = [];

  settings.hallOrder.forEach((groupId) => {
    const hallId = extractHallIdFromGroupId(groupId);
    if (mapHallIds.has(hallId)) {
      mapOrder.push(groupId);
    } else if (maplessHallIds.has(hallId)) {
      maplessOrder.push(groupId);
    } else if (hasMapTab) {
      mapOrder.push(groupId);
    } else {
      maplessOrder.push(groupId);
    }
  });

  const mapVisitLists = settings.hallVisitLists.filter((visitList) =>
    mapHallIds.has(extractHallIdFromGroupId(visitList.hallId)),
  );
  const maplessVisitLists = settings.hallVisitLists.filter((visitList) =>
    maplessHallIds.has(extractHallIdFromGroupId(visitList.hallId)),
  );

  return {
    mapSettings: { hallOrder: mapOrder, hallVisitLists: mapVisitLists },
    maplessSettings: {
      hallOrder: maplessOrder,
      hallVisitLists: maplessVisitLists,
    },
  };
};

export const getGlobalHallItemCount = ({
  groupId,
  executeIds,
  items,
  getItemHallId,
}: {
  groupId: string;
  executeIds: string[];
  items: ShoppingItem[];
  getItemHallId: (item: ShoppingItem, eventDate: string) => string | null;
}): number => {
  if (executeIds.length === 0) return 0;

  const { hallId: targetHallId, priority: targetPriority } =
    parseGroupId(groupId);

  const itemsById = new Map<string, ShoppingItem>();
  items.forEach((item) => {
    if (!itemsById.has(item.id)) itemsById.set(item.id, item);
  });

  return executeIds.filter((itemId) => {
    const item = itemsById.get(itemId);
    if (!item) return false;
    if ((item.priorityLevel || "none") !== targetPriority) return false;
    return getItemHallId(item, item.eventDate) === targetHallId;
  }).length;
};

export const resolveItemHallGroupId = ({
  item,
  halls,
  mapData,
  allItems,
}: {
  item: ShoppingItem | undefined;
  halls: HallDefinition[];
  mapData: DayMapData | undefined;
  allItems?: ShoppingItem[];
}): string => {
  if (!item) return "undefined";
  return buildHallGroupId(
    getHallIdForItem(item, mapData ?? null, halls, allItems),
    item.priorityLevel ?? "none",
  );
};

export const reorderExecuteIdsByHallOrder = ({
  hallOrder,
  dayItems,
  items,
  halls,
  mapData,
}: {
  hallOrder: string[];
  dayItems: string[];
  items: ShoppingItem[];
  halls: HallDefinition[];
  mapData: DayMapData | undefined;
  hallRouteSettings: HallRouteSettings;
}): string[] => {
  const itemsMap = new Map(items.map((item) => [item.id, item]));
  const itemsByGroup = new Map<string, Set<string>>();

  dayItems.forEach((itemId) => {
    const groupId = resolveItemHallGroupId({
      item: itemsMap.get(itemId),
      allItems: items,
      halls,
      mapData,
    });
    if (!itemsByGroup.has(groupId)) {
      itemsByGroup.set(groupId, new Set());
    }
    itemsByGroup.get(groupId)!.add(itemId);
  });

  const sortItemsInGroup = (itemIds: Set<string>): string[] =>
    Array.from(itemIds);

  const reorderedItems: string[] = [];
  hallOrder.forEach((groupId) => {
    const groupItems = itemsByGroup.get(groupId);
    if (groupItems && groupItems.size > 0) {
      reorderedItems.push(...sortItemsInGroup(groupItems));
      itemsByGroup.delete(groupId);
    }
  });

  itemsByGroup.forEach((groupItems) => {
    if (groupItems.size > 0) {
      reorderedItems.push(...sortItemsInGroup(groupItems));
    }
  });

  // This command already performs an explicit persisted reorder. Keep every
  // visit adjacent in that result so per-item legacy visit-list positions
  // cannot split one logical visit again.
  return coalesceExecutionVisitItemIdsForExplicitReorder(reorderedItems, items);
};

export const getCombinedHallRouteSettingsForDate = ({
  hallRouteSettings,
  eventName,
  dayName,
  mapTabName,
}: {
  eventName: string;
  dayName: string;
  mapTabName: string | null;
  hallRouteSettings: HallRouteSettingsStore;
}): HallRouteSettings => {
  const maplessKey = getMaplessKey(dayName);
  const mapSettings = mapTabName
    ? hallRouteSettings[eventName]?.[mapTabName]
    : undefined;
  const maplessSettings = hallRouteSettings[eventName]?.[maplessKey];
  if (isCompleteHallOrder(mapSettings)) return mapSettings!;
  if (!mapTabName && isCompleteHallOrder(maplessSettings))
    return maplessSettings!;

  return {
    hallOrder: [
      ...(mapSettings?.hallOrder || []),
      ...(maplessSettings?.hallOrder || []),
    ],
    hallVisitLists: [
      ...(mapSettings?.hallVisitLists || []),
      ...(maplessSettings?.hallVisitLists || []),
    ],
  };
};
