import { useCallback, useMemo } from "react";
import type {
  DayMapData,
  HallDefinition,
  HallDefinitionsStore,
  HallRouteSettings,
  HallRouteSettingsStore,
  MapDataStore,
} from "../../../types/map";
import type { EventConsistencyStore } from "../../../types/consistency";
import { getMaplessKey } from "../../../types/map";
import {
  getDayConsistency,
  resolveDayMap,
  resolveSimpleKey,
} from "../../consistency/domain/context";
import { isCompleteHallOrder } from "../../consistency/domain/projection";

type UseMapSelectorsParams = {
  activeEventName: string | null;
  activeTab: string;
  activeEventDate: string | null;
  mapViewActive: boolean;
  mapData: MapDataStore;
  hallDefinitions: HallDefinitionsStore;
  hallRouteSettings: HallRouteSettingsStore;
  eventConsistency?: EventConsistencyStore;
};
export function useMapSelectors({
  activeEventName,
  activeEventDate,
  mapViewActive,
  mapData,
  hallDefinitions,
  hallRouteSettings,
  eventConsistency,
}: UseMapSelectorsParams) {
  const mapTabs = useMemo(
    () =>
      Object.keys(
        activeEventName ? (mapData[activeEventName] ?? {}) : {},
      ).sort(),
    [activeEventName, mapData],
  );
  const getMapTabForDate = useCallback(
    (date: string): string | null => {
      if (!activeEventName) return null;
      const result = resolveDayMap(
        mapData[activeEventName],
        date,
        getDayConsistency(eventConsistency?.[activeEventName], date)
          ?.selectedMapKey,
      );
      return result.status === "resolved" ? result.key : null;
    },
    [activeEventName, mapData, eventConsistency],
  );
  const getSimpleKey = useCallback(
    (date: string): string | null => {
      const result = resolveSimpleKey(
        activeEventName ? hallDefinitions[activeEventName] : undefined,
        date,
      );
      return result.status === "resolved"
        ? result.key
        : result.status === "missing"
          ? getMaplessKey(date)
          : null;
    },
    [activeEventName, hallDefinitions],
  );
  const getHallsForDate = useCallback(
    (date: string): HallDefinition[] => {
      if (!activeEventName) return [];
      const map = getMapTabForDate(date),
        simple = getSimpleKey(date),
        definitions = hallDefinitions[activeEventName];
      return [
        ...(map ? (definitions?.[map] ?? []) : []),
        ...(simple ? (definitions?.[simple] ?? []) : []),
      ];
    },
    [activeEventName, hallDefinitions, getMapTabForDate, getSimpleKey],
  );
  const getMapDataForDate = useCallback(
    (date: string): DayMapData | null => {
      const map = getMapTabForDate(date);
      return activeEventName && map
        ? (mapData[activeEventName]?.[map] ?? null)
        : null;
    },
    [activeEventName, mapData, getMapTabForDate],
  );
  const getSettingsForDate = useCallback(
    (date: string): HallRouteSettings => {
      if (!activeEventName) return { hallOrder: [], hallVisitLists: [] };
      const map = getMapTabForDate(date),
        simple = getSimpleKey(date),
        settings = hallRouteSettings[activeEventName];
      const selected = map
        ? settings?.[map]
        : simple
          ? settings?.[simple]
          : undefined;
      if (isCompleteHallOrder(selected)) return selected!;
      const simpleSettings = simple ? settings?.[simple] : undefined;
      return {
        hallOrder: [
          ...new Set([
            ...(selected?.hallOrder ?? []),
            ...(simpleSettings?.hallOrder ?? []),
            ...getHallsForDate(date).map((hall) => hall.id),
          ]),
        ],
        hallVisitLists: [
          ...(selected?.hallVisitLists ?? []),
          ...(map ? (simpleSettings?.hallVisitLists ?? []) : []),
        ],
      };
    },
    [
      activeEventName,
      hallRouteSettings,
      getMapTabForDate,
      getSimpleKey,
      getHallsForDate,
    ],
  );
  const currentMapTabName =
    activeEventDate && mapViewActive ? getMapTabForDate(activeEventDate) : null;
  const currentMapData =
    activeEventDate && currentMapTabName
      ? getMapDataForDate(activeEventDate)
      : null;
  const currentHalls = useMemo(
    () => (activeEventDate ? getHallsForDate(activeEventDate) : []),
    [activeEventDate, getHallsForDate],
  );
  const currentHallRouteSettings = useMemo(
    () =>
      activeEventDate
        ? getSettingsForDate(activeEventDate)
        : { hallOrder: [], hallVisitLists: [] },
    [activeEventDate, getSettingsForDate],
  );
  const getHallOrderForDate = useCallback(
    (date: string) => getSettingsForDate(date).hallOrder,
    [getSettingsForDate],
  );
  return {
    mapTabs,
    isMapTab: currentMapTabName !== null,
    currentMapTabName,
    currentMapData,
    currentHalls,
    currentHallRouteSettings,
    getMapTabForDate,
    getHallsForDate,
    getMapDataForDate,
    getHallOrderForDate,
  };
}
