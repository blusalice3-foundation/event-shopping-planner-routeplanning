import type { ConsistencyChange } from "../consistency/domain/migration";
import type { EventConsistencyV1 } from "../../types/consistency";
import { createAppBackup } from "../../utils/appBackup";
import type {
  DayModeState,
  EventMetadata,
  ExecuteModeItems,
  ShoppingItem,
} from "../../types/item";
import type {
  BlockDetectionSettings,
  BlockDetectionSettingsStore,
  HallDefinitionsStore,
  HallRouteSettingsStore,
  MapDataStore,
  MapRotationSettingsStore,
  MapViewportSettingsStore,
  RouteSettingsStore,
} from "../../types/map";
import type { AppData } from "../../app/ports/PersistenceCommandPort";
import type { EventWorkbookImportResult } from "../../xlsx/domain/eventWorkbook";
import { expandEventMapDataFromStorage } from "../../utils/mapDataPersistence";

export type ImportedEventData = {
  eventConsistency?: EventConsistencyV1;
  eventName: string;
  items: ShoppingItem[];
  metadata: EventMetadata | null;
  executeModeItems: ExecuteModeItems | null;
  dayModes: DayModeState | null;
  mapData: MapDataStore[string] | null;
  mapRotationSettings: MapRotationSettingsStore[string] | null;
  mapViewportSettings: MapViewportSettingsStore[string] | null;
  routeSettings: RouteSettingsStore[string] | null;
  hallDefinitions: HallDefinitionsStore[string] | null;
  hallRouteSettings: HallRouteSettingsStore[string] | null;
  blockDetectionSettings: BlockDetectionSettings | null;
  errors: string[];
};

export type XlsxEventRestoreSource = {
  notices: ConsistencyChange[];
  data: AppData;
  blockDetectionSettings: BlockDetectionSettingsStore;
};

function hasEntries(
  record?: Record<string, unknown>,
): record is Record<string, unknown> {
  return !!record && Object.keys(record).length > 0;
}

export function toImportedEventData(
  result: EventWorkbookImportResult,
): ImportedEventData {
  const hallDefinitions = hasEntries(result.hallDefinitions)
    ? (result.hallDefinitions as HallDefinitionsStore[string])
    : null;
  const items = result.items;

  return {
    eventName: result.eventName,
    eventConsistency: result.eventConsistency,
    items,
    metadata: result.metadata ?? null,
    executeModeItems: hasEntries(result.layoutInfo?.executeModeItems)
      ? result.layoutInfo!.executeModeItems
      : null,
    dayModes: hasEntries(result.layoutInfo?.dayModes)
      ? (result.layoutInfo!.dayModes as unknown as DayModeState)
      : null,
    mapData: hasEntries(result.mapData)
      ? expandEventMapDataFromStorage(result.mapData)
      : null,
    mapRotationSettings: hasEntries(result.mapRotationSettings)
      ? result.mapRotationSettings
      : null,
    mapViewportSettings: hasEntries(result.mapViewportSettings)
      ? result.mapViewportSettings
      : null,
    routeSettings: hasEntries(result.routeSettings)
      ? (result.routeSettings as RouteSettingsStore[string])
      : null,
    hallDefinitions,
    hallRouteSettings: hasEntries(result.hallRouteSettings)
      ? (result.hallRouteSettings as HallRouteSettingsStore[string])
      : null,
    blockDetectionSettings: result.blockDetectionSettings ?? null,
    errors: result.errors,
  };
}

function eventSection<T>(
  eventName: string,
  value: T | null,
): Record<string, T> {
  return value === null ? {} : { [eventName]: value };
}

export function buildXlsxEventRestoreSource(
  imported: ImportedEventData,
): XlsxEventRestoreSource {
  const eventName = imported.eventName;

  const backup = createAppBackup(
    {
      ...(imported.eventConsistency
        ? { eventConsistency: { [eventName]: imported.eventConsistency } }
        : {}),
      eventLists: eventSection(eventName, imported.items),
      eventMetadata: eventSection(eventName, imported.metadata),
      executeModeItems: eventSection(eventName, imported.executeModeItems),
      dayModes: eventSection(
        eventName,
        imported.dayModes as Record<string, string> | null,
      ),
      mapData: eventSection(eventName, imported.mapData),
      mapRotationSettings: eventSection(
        eventName,
        imported.mapRotationSettings,
      ),
      routeSettings: eventSection(eventName, imported.routeSettings),
      hallDefinitions: eventSection(eventName, imported.hallDefinitions),
      hallRouteSettings: eventSection(eventName, imported.hallRouteSettings),
      mapViewportSettings: eventSection(
        eventName,
        imported.mapViewportSettings,
      ),
    },
    new Date(),
    {
      blockDetectionSettings: eventSection(
        eventName,
        imported.blockDetectionSettings,
      ),
    },
  );
  return {
    data: backup.data,
    notices: backup.notices ?? [],
    blockDetectionSettings: eventSection(
      eventName,
      imported.blockDetectionSettings,
    ),
  };
}
