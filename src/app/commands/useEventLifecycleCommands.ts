import type { ApplicationMutationPort } from "../ports/ApplicationMutationPort";
import {
  planEventDelete,
  planEventRename,
} from "../../features/consistency/domain/eventMutations";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { AppNavigationCommands } from "../navigation";
import type {
  DayModeState,
  EventMetadata,
  ExecuteModeItems,
  ShoppingItem,
} from "../../types/item";
import type { FocusModeSessionState } from "../../types/focus";
import type {
  HallDefinitionsStore,
  HallRouteSettingsStore,
  MapDataStore,
  MapRotationSettingsStore,
  MapViewportSettingsStore,
  RouteSettingsStore,
} from "../../types/map";
import type { PersistenceCommandPort } from "../ports/PersistenceCommandPort";
import { resolveEventListTab } from "../../features/events/uiOrchestration";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export interface EventLifecyclePersistenceValues {
  eventLists: Record<string, ShoppingItem[]>;
  eventMetadata: Record<string, EventMetadata>;
  executeModeItems: Record<string, ExecuteModeItems>;
  dayModes: Record<string, DayModeState>;
  mapData: MapDataStore;
  mapRotationSettings: MapRotationSettingsStore;
  routeSettings: RouteSettingsStore;
  hallDefinitions: HallDefinitionsStore;
  hallRouteSettings: HallRouteSettingsStore;
  mapViewportSettings: MapViewportSettingsStore;
}

export const removeFocusModeSessionByEvent = (
  sessions: Record<string, FocusModeSessionState>,
  eventName: string,
): Record<string, FocusModeSessionState> => {
  let changed = false;
  const next: Record<string, FocusModeSessionState> = {};

  Object.entries(sessions).forEach(([key, value]) => {
    if (key.startsWith(`${eventName}::`)) {
      changed = true;
      return;
    }
    next[key] = value;
  });

  return changed ? next : sessions;
};

export const renameFocusModeSessionKeys = (
  sessions: Record<string, FocusModeSessionState>,
  oldEventName: string,
  newEventName: string,
): Record<string, FocusModeSessionState> => {
  let changed = false;
  const next: Record<string, FocusModeSessionState> = {};

  Object.entries(sessions).forEach(([key, value]) => {
    if (key.startsWith(`${oldEventName}::`)) {
      const suffix = key.slice(oldEventName.length);
      next[`${newEventName}${suffix}`] = value;
      changed = true;
    } else {
      next[key] = value;
    }
  });

  return changed ? next : sessions;
};

export interface EventLifecycleCommandPorts
  extends
    EventLifecyclePersistenceValues,
    Pick<ApplicationMutationPort, "requestMutation"> {
  persistenceCommands: Pick<
    PersistenceCommandPort,
    "deleteEventAtomically" | "renameEventAtomically"
  >;
  flushPendingSave(): Promise<void>;
  runExclusiveRestore<T>(
    restoredValues: EventLifecyclePersistenceValues,
    restore: () => Promise<T>,
  ): Promise<T>;
  activeEventName: string | null;
  eventToRename: string | null;
  navigation: AppNavigationCommands;
  notify(message: string): void;
  clearSelection(): void;
  setSelectedBlockFilters: StateSetter<Set<string>>;
  closeEventUpdateForEvent(eventName: string): void;
  setEventLists: StateSetter<Record<string, ShoppingItem[]>>;
  setEventMetadata: StateSetter<Record<string, EventMetadata>>;
  updateExecuteModeItems(
    updater: (
      current: Record<string, ExecuteModeItems>,
    ) => Record<string, ExecuteModeItems>,
  ): Record<string, ExecuteModeItems>;
  setDayModes: StateSetter<Record<string, DayModeState>>;
  setMapData: StateSetter<MapDataStore>;
  setMapRotationSettings: StateSetter<MapRotationSettingsStore>;
  setRouteSettings: StateSetter<RouteSettingsStore>;
  setHallDefinitions: StateSetter<HallDefinitionsStore>;
  setHallRouteSettings: StateSetter<HallRouteSettingsStore>;
  setMapViewportSettings: StateSetter<MapViewportSettingsStore>;
  setFocusModeSessions: StateSetter<Record<string, FocusModeSessionState>>;
  openRename(eventName: string): void;
  confirmEventOverlay(): void;
}

export interface EventLifecycleCommands {
  selectEvent(eventName: string): void;
  deleteEvent(eventName: string): Promise<void>;
  requestRename(eventName: string): void;
  confirmRename(newName: string): Promise<void>;
}

export const useEventLifecycleCommands = ({
  requestMutation,
  eventLists,
  eventToRename,
  activeEventName,
  navigation,
  notify,
  clearSelection,
  setSelectedBlockFilters,
  closeEventUpdateForEvent,
  setFocusModeSessions,
  openRename,
  confirmEventOverlay,
}: EventLifecycleCommandPorts): EventLifecycleCommands => {
  const selectEvent = useCallback(
    (eventName: string) => {
      const tab = resolveEventListTab(eventLists[eventName] || []);
      if (!tab) {
        notify("参加日がないため処理を停止しました。");
        return;
      }
      navigation.openEvent(eventName, tab);
      clearSelection();
      setSelectedBlockFilters(new Set());
    },
    [eventLists, navigation, notify, clearSelection, setSelectedBlockFilters],
  );
  const deleteEvent = useCallback(
    async (name: string) => {
      try {
        await requestMutation({
          events: [name],
          plan: (snapshot) => planEventDelete(snapshot, name),
        });
      } catch (error) {
        if (!(error instanceof Error && error.name === "MutationCancelled"))
          notify("イベントを削除できませんでした。");
        return;
      }
      closeEventUpdateForEvent(name);
      setFocusModeSessions((current) =>
        removeFocusModeSessionByEvent(current, name),
      );
      navigation.removeEvent(name);
    },
    [
      requestMutation,
      notify,
      closeEventUpdateForEvent,
      setFocusModeSessions,
      navigation,
    ],
  );
  const confirmRename = useCallback(
    async (newName: string) => {
      if (!eventToRename) return;
      if (newName === eventToRename) {
        confirmEventOverlay();
        return;
      }
      try {
        await requestMutation({
          events: [eventToRename, newName],
          plan: (snapshot) => planEventRename(snapshot, eventToRename, newName),
        });
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "イベント名を変更できませんでした。",
        );
        return;
      }
      closeEventUpdateForEvent(eventToRename);
      setFocusModeSessions((current) =>
        removeFocusModeSessionByEvent(current, eventToRename),
      );
      if (activeEventName === eventToRename)
        navigation.renameActiveEvent(eventToRename, newName);
      confirmEventOverlay();
    },
    [
      eventToRename,
      activeEventName,
      requestMutation,
      notify,
      closeEventUpdateForEvent,
      setFocusModeSessions,
      navigation,
      confirmEventOverlay,
    ],
  );
  return { selectEvent, deleteEvent, requestRename: openRename, confirmRename };
};
