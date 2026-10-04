import { createEventConsistency } from "../../types/consistency";
import { describe, expect, it } from "vitest";
import type { AppData } from "../../app/ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../types/item";
import { DEFAULT_BLOCK_DETECTION_SETTINGS } from "../../types/map";
import { createAppBackup, parseAppBackup } from "../../utils/appBackup";
import { buildEventRestoreData } from "./backupRestore";
import {
  buildXlsxEventRestoreSource,
  toImportedEventData,
  type ImportedEventData,
} from "./fileImport";

const APP_DATA_SECTIONS = [
  "eventLists",
  "eventMetadata",
  "executeModeItems",
  "dayModes",
  "mapData",
  "mapRotationSettings",
  "hallDefinitions",
  "mapViewportSettings",
] as const satisfies readonly (keyof AppData)[];

const item: ShoppingItem = {
  id: "item-1",
  circle: "サークル",
  eventDate: "1日目",
  block: "東A",
  number: "01a",
  title: "新刊",
  price: 1000,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "",
};

const completeImport = (): ImportedEventData => ({
  eventName: "復元イベント",
  items: [item],
  metadata: {
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/source",
    spreadsheetSheetName: "品目表",
    lastImportDate: "2026-08-02T00:00:00.000Z",
  },
  executeModeItems: { "1日目": [item.id] },
  dayModes: { "1日目": "execute" },
  mapData: {
    "1日目マップ": {
      maxRow: 1,
      maxCol: 1,
      cells: [],
      mergedCells: [],
      blocks: [],
    },
  },
  mapRotationSettings: {
    "1日目マップ": {
      initialAngle: 0,
      mapTabAngle: 90,
      focusModeAngle: 180,
    },
  },
  routeSettings: {
    "1日目マップ": {
      isRouteVisible: false,
      visitOrder: [],
    },
  },
  hallDefinitions: {
    "1日目マップ": [
      {
        id: "hall-1",
        name: "東ホール",
        vertices: [],
      },
    ],
  },
  hallRouteSettings: {
    "1日目マップ": {
      hallOrder: ["hall-1"],
      hallVisitLists: [],
    },
  },
  mapViewportSettings: {
    "1日目マップ": {
      zoomLevel: 100,
      offsetX: 10,
      offsetY: 20,
    },
  },
  blockDetectionSettings: DEFAULT_BLOCK_DETECTION_SETTINGS,
  errors: ["警告"],
});

const currentEventData = (eventName: string): AppData => ({
  eventConsistency: { [eventName]: createEventConsistency() },
  eventLists: { [eventName]: [{ id: "old-item" }] },
  eventMetadata: { [eventName]: { old: true } },
  executeModeItems: { [eventName]: { "1日目": ["old-item"] } },
  dayModes: { [eventName]: { "1日目": "edit" } },
  mapData: { [eventName]: { old: { value: true } } },
  mapRotationSettings: { [eventName]: { old: { value: true } } },
  routeSettings: { [eventName]: { old: { value: true } } },
  hallDefinitions: { [eventName]: { old: [{ value: true }] } },
  hallRouteSettings: { [eventName]: { old: { value: true } } },
  mapViewportSettings: { [eventName]: { old: { value: true } } },
});

describe("buildXlsxEventRestoreSource", () => {
  it("maps a complete XLSX import into every event-scoped backup section", () => {
    const imported = completeImport();

    const source = buildXlsxEventRestoreSource(imported);

    for (const sectionName of APP_DATA_SECTIONS) {
      expect(source.data[sectionName]).toHaveProperty(imported.eventName);
    }
    expect(source.data.eventLists[imported.eventName]).toEqual([item]);
    expect(source.data.mapRotationSettings[imported.eventName]).toEqual(
      imported.mapRotationSettings,
    );
    expect(source.data.mapViewportSettings[imported.eventName]).toEqual(
      imported.mapViewportSettings,
    );
    expect(
      source.data.eventConsistency[imported.eventName].blockDetectionSettings,
    ).toEqual(DEFAULT_BLOCK_DETECTION_SETTINGS);
  });

  it("leaves missing XLSX sections absent so same-name restore removes stale data", () => {
    const eventName = "同名イベント";
    const imported: ImportedEventData = {
      ...completeImport(),
      eventName,
      metadata: null,
      executeModeItems: null,
      dayModes: null,
      mapData: null,
      mapRotationSettings: null,
      routeSettings: null,
      hallDefinitions: null,
      hallRouteSettings: null,
      mapViewportSettings: null,
      blockDetectionSettings: null,
    };
    const source = buildXlsxEventRestoreSource(imported);
    const validation = parseAppBackup(
      createAppBackup(source.data, new Date("2026-08-02T00:00:00.000Z"), {
        blockDetectionSettings: source.blockDetectionSettings,
      }),
    );

    const restored = buildEventRestoreData(
      currentEventData(eventName),
      source.data,
      eventName,
      eventName,
    );

    expect(restored.eventLists[eventName]).toEqual([item]);
    expect(validation.ok).toBe(true);
    for (const sectionName of APP_DATA_SECTIONS.slice(1)) {
      expect(restored[sectionName][eventName] ?? {}).toEqual({});
    }
    expect(
      source.data.eventConsistency[eventName].blockDetectionSettings,
    ).toBeNull();
    expect(restored.routeSettings).not.toHaveProperty(eventName);
    expect(restored.hallRouteSettings).not.toHaveProperty(eventName);
  });

  it("reports removal of a missing legacy hall reference without changing item data", () => {
    const imported = toImportedEventData({
      success: true,
      eventName: "復元イベント",
      items: [{ ...item, manualHallId: "hall-1" }],
      errors: [],
    });
    const source = buildXlsxEventRestoreSource(imported);
    const backup = createAppBackup(
      source.data,
      new Date("2026-08-02T00:00:00.000Z"),
      {
        blockDetectionSettings: source.blockDetectionSettings,
      },
    );

    const validation = parseAppBackup(backup);

    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error("XLSX restore source was rejected");
    expect(
      validation.data.eventLists[imported.eventName][0],
    ).not.toHaveProperty("manualHallId");
    expect(source.notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("hall-1") }),
      ]),
    );
    expect(validation.data.eventLists[imported.eventName][0]).toEqual(item);
  });
});
