import type { EventConsistencyStore } from "../../types/consistency";
import type { ApplicationMutationPort } from "../ports/ApplicationMutationPort";
import {
  getDayConsistency,
  resolveDayMap,
  normalizeMapDay,
} from "../../features/consistency/domain/context";
import { planMapReimport } from "../../features/consistency/domain/mapReimport";
import { useCallback } from "react";
import type { ChangeEvent } from "react";
import type { ShoppingItem } from "../../types/item";
import type {
  BlockDetectionSettings,
  DayMapData,
  HallDefinitionsStore,
  HallRouteSettingsStore,
  MapDataStore,
  MapRotationSettingsStore,
  MapViewportSettingsStore,
  RouteSettingsStore,
} from "../../types/map";
import { extractEventDates } from "../../utils/eventDates";
import {
  commitPreparedMapImport,
  dispatchPreparedMapImport,
  type PreparedMapImport,
} from "../../features/map/domain/mapImportFlow";
import {
  buildMapReimportPlan,
  type MapReimportOptions,
  type MapReimportState,
} from "../../features/map/domain/mapReimport";

export interface MapImportFileInputPort {
  readonly current: HTMLInputElement | null;
}

export interface MapImportStatePort extends MapReimportState {
  readonly eventConsistency?: EventConsistencyStore;
  readonly pendingEventName: string;
  readonly pendingReimport: PreparedMapImport | null;
  readonly mapViewActive: boolean;
}

export interface MapImportActionPort {
  setEventLists(value: Record<string, ShoppingItem[]>): void;
  setMapData(value: MapDataStore): void;
  setMapRotationSettings(value: MapRotationSettingsStore): void;
  setRouteSettings(value: RouteSettingsStore): void;
  setHallDefinitions(value: HallDefinitionsStore): void;
  setHallRouteSettings(value: HallRouteSettingsStore): void;
  setMapViewportSettings(value: MapViewportSettingsStore): void;
  openImport(file: File, eventName: string): void;
  requestReimport(preparedImport: PreparedMapImport): void;
  closeImportDialog(): void;
  cancelReimport(): void;
  confirmReimport(): void;
}

export interface MapImportSettingsPort {
  requestMutation?: ApplicationMutationPort["requestMutation"];
  commitApplicationSnapshotPatch(
    patch: Pick<
      MapReimportState,
      | "eventLists"
      | "mapData"
      | "mapRotationSettings"
      | "routeSettings"
      | "hallDefinitions"
      | "hallRouteSettings"
      | "mapViewportSettings"
    >,
    blockDetectionSettings: {
      eventName: string;
      settings: BlockDetectionSettings;
    },
  ): Promise<void>;
}

export interface MapImportNavigationPort {
  openEvent(eventName: string, mapTabName: string, view: "map" | "list"): void;
}

export interface MapImportEffectPort {
  notify(message: string): void;
  reportDiagnostic(message: string): void;
}

export interface MapImportCommandPorts {
  readonly fileInput: MapImportFileInputPort;
  readonly state: MapImportStatePort;
  readonly actions: MapImportActionPort;
  readonly settings: MapImportSettingsPort;
  readonly navigation: MapImportNavigationPort;
  readonly effects: MapImportEffectPort;
}

export interface MapImportCommands {
  requestFileSelection(eventName: string): void;
  selectFile(event: ChangeEvent<HTMLInputElement>): void;
  prepareImport(
    parsedData: Record<string, DayMapData>,
    settings: BlockDetectionSettings,
    initialAngles: Record<string, number>,
  ): Promise<void>;
  confirmReimport(options: MapReimportOptions): Promise<void>;
  cancelReimport(): void;
  closeImport(): void;
}

export const useMapImportCommands = ({
  fileInput,
  state,
  actions,
  settings,
  navigation,
  effects,
}: MapImportCommandPorts): MapImportCommands => {
  const {
    eventLists,
    executeModeItems,
    mapData,
    mapRotationSettings,
    routeSettings,
    hallDefinitions,
    hallRouteSettings,
    mapViewportSettings,
    pendingEventName,
    pendingReimport,
    mapViewActive,
  } = state;
  const {
    setEventLists,
    setMapData,
    setMapRotationSettings,
    setRouteSettings,
    setHallDefinitions,
    setHallRouteSettings,
    setMapViewportSettings,
    openImport,
    requestReimport,
    closeImportDialog,
    cancelReimport: cancelReimportOverlay,
    confirmReimport: confirmReimportOverlay,
  } = actions;
  const { commitApplicationSnapshotPatch, requestMutation } = settings;
  const { openEvent } = navigation;
  const { notify, reportDiagnostic } = effects;

  const requestFileSelection = useCallback(
    (eventName: string) => {
      const input = fileInput.current;
      if (!input) return;
      input.dataset.eventName = eventName;
      input.click();
    },
    [fileInput],
  );

  const selectFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      const eventName = event.target.dataset.eventName;
      if (!file || !eventName) return;

      openImport(file, eventName);
      event.target.value = "";
    },
    [openImport],
  );

  const finishImport = useCallback(() => {
    if (pendingReimport) {
      confirmReimportOverlay();
      return;
    }
    closeImportDialog();
  }, [closeImportDialog, confirmReimportOverlay, pendingReimport]);

  const commitImport = useCallback(
    async (
      preparedImport: PreparedMapImport,
      options: MapReimportOptions,
    ): Promise<void> => {
      try {
        if (requestMutation) {
          const name = preparedImport.plan.eventName;
          await requestMutation({
            events: [name],
            plan: (snapshot) =>
              planMapReimport(
                snapshot,
                name,
                preparedImport.plan.targets,
                options,
                preparedImport.settings,
              ),
          });
          const first = preparedImport.plan.targets[0];
          if (first)
            openEvent(name, first.eventDate, mapViewActive ? "map" : "list");
          finishImport();
          notify(
            `${preparedImport.plan.targets.length}件のマップを取り込みました。`,
          );
          return;
        }
        await commitPreparedMapImport({
          state: {
            eventLists,
            executeModeItems,
            mapData,
            mapRotationSettings,
            routeSettings,
            hallDefinitions,
            hallRouteSettings,
            mapViewportSettings,
          },
          preparedImport,
          options,
          effects: {
            commitApplicationSnapshotPatch: (patch, eventName, nextSettings) =>
              commitApplicationSnapshotPatch(patch, {
                eventName,
                settings: nextSettings,
              }),
            setEventLists,
            setMapData,
            setMapRotationSettings,
            setRouteSettings,
            setHallDefinitions,
            setHallRouteSettings,
            setMapViewportSettings,
            activateTarget: (eventName, mapTabName) => {
              openEvent(eventName, mapTabName, mapViewActive ? "map" : "list");
            },
            finishImport,
            notify,
          },
        });
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "マップを保存できませんでした。",
        );
      }
    },
    [
      eventLists,
      executeModeItems,
      commitApplicationSnapshotPatch,
      requestMutation,
      finishImport,
      hallDefinitions,
      hallRouteSettings,
      mapData,
      mapRotationSettings,
      mapViewActive,
      mapViewportSettings,
      notify,
      openEvent,
      routeSettings,
      setEventLists,
      setHallDefinitions,
      setHallRouteSettings,
      setMapData,
      setMapRotationSettings,
      setMapViewportSettings,
      setRouteSettings,
    ],
  );

  const prepareImport = useCallback(
    async (
      parsedData: Record<string, DayMapData>,
      blockDetectionSettings: BlockDetectionSettings,
      initialAngles: Record<string, number>,
    ): Promise<void> => {
      if (!pendingEventName) return;

      try {
        const eventDates = extractEventDates(
          eventLists[pendingEventName] || [],
        );
        const skippedDays = new Set<string>();
        const targets = Object.entries(parsedData).flatMap(
          ([mapName, dayMapData]) => {
            const normalizedMapDay = normalizeMapDay(mapName);
            const candidateDays = eventDates.filter(
              (candidate) => normalizeMapDay(candidate) === normalizedMapDay,
            );
            const eventDate =
              candidateDays.find(
                (day) => `${day}マップ` === mapName || day === mapName,
              ) ?? (candidateDays.length === 1 ? candidateDays[0] : undefined);
            if (!eventDate && candidateDays.length > 1)
              throw new Error(
                `「${mapName}」に対応する日付が複数あります。取り込み元のシート名を実際の日付と一致させてください。`,
              );
            if (!eventDate) {
              skippedDays.add(normalizedMapDay || mapName);
              return [];
            }
            const resolved = resolveDayMap(
              mapData[pendingEventName],
              eventDate,
              getDayConsistency(
                state.eventConsistency?.[pendingEventName],
                eventDate,
              )?.selectedMapKey,
            );
            return [
              {
                eventDate,
                mapTabName:
                  resolved.status === "resolved"
                    ? resolved.key
                    : `${eventDate}マップ`,
                targetCandidates: resolved.candidates,
                targetChoiceRequired: resolved.status === "selection-required",
                mapData: dayMapData,
                initialAngle: initialAngles[mapName] ?? 0,
              },
            ];
          },
        );

        if (targets.length === 0) {
          const skippedMessages = Array.from(skippedDays)
            .sort((a, b) => a.localeCompare(b, "ja"))
            .map((dayName) => `${dayName}はないので取り込みしませんでした`);
          notify(
            skippedMessages.length > 0
              ? skippedMessages.join("\n")
              : "取り込める対象日のマップがありません。",
          );
          closeImportDialog();
          return;
        }

        const preparedImport: PreparedMapImport = {
          plan: buildMapReimportPlan({
            state: {
              eventLists,
              executeModeItems,
              mapData,
              mapRotationSettings,
              routeSettings,
              hallDefinitions,
              hallRouteSettings,
              mapViewportSettings,
            },
            eventName: pendingEventName,
            targets,
          }),
          settings: blockDetectionSettings,
          skippedDays: Array.from(skippedDays),
        };
        await dispatchPreparedMapImport(preparedImport, {
          requestConfirmation: (pendingImport) => {
            requestReimport(pendingImport);
          },
          commit: commitImport,
        });
      } catch (error) {
        reportDiagnostic("Map reimport planning failed (map-plan-failed).");
        notify(
          error instanceof Error
            ? error.message
            : "マップを取り込む準備に失敗しました。",
        );
      }
    },
    [
      commitImport,
      eventLists,
      executeModeItems,
      hallDefinitions,
      hallRouteSettings,
      mapData,
      mapRotationSettings,
      mapViewportSettings,
      notify,
      pendingEventName,
      state.eventConsistency,
      reportDiagnostic,
      closeImportDialog,
      requestReimport,
      routeSettings,
    ],
  );

  const confirmReimport = useCallback(
    async (options: MapReimportOptions): Promise<void> => {
      if (!pendingReimport) return;
      await commitImport(pendingReimport, options);
    },
    [commitImport, pendingReimport],
  );

  const cancelReimport = useCallback(() => {
    cancelReimportOverlay();
  }, [cancelReimportOverlay]);

  const closeImport = useCallback(() => {
    closeImportDialog();
  }, [closeImportDialog]);

  return {
    requestFileSelection,
    selectFile,
    prepareImport,
    confirmReimport,
    cancelReimport,
    closeImport,
  };
};
