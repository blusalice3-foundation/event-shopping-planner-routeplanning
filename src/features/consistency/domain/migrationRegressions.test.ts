import { describe, expect, it } from "vitest";
import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../../types/item";
import type {
  HallDefinitionsStore,
  HallRouteSettingsStore,
  MapDataStore,
} from "../../../types/map";
import {
  createAppBackup,
  parseAppBackup,
  serializeAppBackup,
  validateSnapshotReferences,
  validateSnapshotStructure,
} from "../../../utils/appBackup";
import { buildMergedHallRouteSettings } from "../../../utils/mergedHallRouteSettings";
import { getCombinedHallRouteSettingsForDate } from "../../map/domain/hallOperations";
import {
  exportToXlsx,
  importFromXlsx,
} from "../../../xlsx/engine/eventWorkbookEngine";
import type { EventWorkbookAdditionalData } from "../../../xlsx/domain/eventWorkbook";
import {
  legacyPendingIdentity,
  planLegacyResolution,
} from "./legacyResolution";
import { migrateLegacyConsistency, type LegacySnapshot } from "./migration";
import { encodeHallGroup, projectConsistencySnapshot } from "./projection";

const MAP = "1日目マップ";
const DAY = "1日目";
const OTHER = "１日目";
const item = (id: string, eventDate = DAY): ShoppingItem => ({
  id,
  eventDate,
  circle: id,
  title: "ユーザー登録",
  block: "A",
  number: id,
  quantity: 1,
  price: 100,
  purchaseStatus: "None",
  remarks: "元のメモ",
});
const legacy = (shared = true): LegacySnapshot => ({
  eventLists: { event: shared ? [item("1"), item("2", OTHER)] : [item("1")] },
  eventMetadata: {},
  executeModeItems: {
    event: shared ? { [DAY]: ["1"], [OTHER]: ["2"] } : { [DAY]: ["1"] },
  },
  dayModes: {
    event: shared
      ? { [DAY]: "execute", [OTHER]: "edit" }
      : { [DAY]: "execute" },
  },
  mapData: {
    event: {
      [MAP]: { cells: [], mergedCells: [], blocks: [], maxRow: 10, maxCol: 10 },
    },
  },
  mapRotationSettings: {},
  mapViewportSettings: {},
  hallDefinitions: {
    event: {
      [MAP]: [
        {
          id: "east",
          name: "詳細A",
          vertices: [
            { row: 1, col: 1 },
            { row: 1, col: 3 },
            { row: 3, col: 3 },
          ],
        },
      ],
    },
  },
  hallRouteSettings: {},
  routeSettings: {},
});
const point = (order: number, itemIds: string[]) => ({
  row: order + 1,
  col: 2,
  blockName: "A",
  number: order + 1,
  order,
  itemIds,
});
const withEmptyVisits = (known = true, shared = true) => {
  const source = legacy(shared);
  const ids = known ? (shared ? ["1", "2"] : ["1"]) : [];
  source.hallRouteSettings.event = {
    [MAP]: {
      hallOrder: [],
      hallVisitLists: [
        { hallId: "undefined:highest", itemIds: [] },
        ...(known ? [{ hallId: "east", itemIds: ids }] : []),
        { hallId: "east:priority", itemIds: [] },
      ],
    },
  };
  source.routeSettings.event = {
    [MAP]: {
      isRouteVisible: true,
      visitOrder: [
        point(0, []),
        ...(known ? [point(1, ids)] : []),
        point(2, []),
      ],
    },
  };
  return source;
};
const valid = (source: PersistenceSnapshot) => {
  expect(validateSnapshotStructure(source)).toEqual([]);
  expect(validateSnapshotReferences(source)).toEqual([]);
};
async function excelRoundTrip(source: PersistenceSnapshot) {
  const blob = await exportToXlsx(
    "event",
    source.eventLists.event as ShoppingItem[],
    {
      format: "full",
      includeItems: true,
      includeLayoutInfo: true,
      includeMapData: true,
      includeRouteInfo: true,
    },
    {
      ...source,
      metadata: source.eventMetadata.event,
    } as EventWorkbookAdditionalData,
  );
  const restored = await importFromXlsx(new File([blob], "migration.xlsx"));
  expect(restored.success).toBe(true);
  expect(restored.errors).toEqual([]);
  expect(restored.eventConsistency).toEqual(source.eventConsistency.event);
}
describe("I01 / R38 legacy visits without a known day", () => {
  it.each([true, false])(
    "preserves original empty visits and points, including their order (known visits: %s)",
    (known) => {
      const source = withEmptyVisits(known);
      const before = structuredClone(source);
      const result = migrateLegacyConsistency(source);
      const event = result.data.eventConsistency.event;
      expect(event.legacyPending).toEqual([
        {
          sourceKey: MAP,
          sourceDayKey: null,
          sourceMapKey: MAP,
          reason: "ambiguous-day",
          payload: {
            kind: "hall-route-settings",
            settings: source.hallRouteSettings.event[MAP],
          },
        },
        {
          sourceKey: MAP,
          sourceDayKey: null,
          sourceMapKey: MAP,
          reason: "ambiguous-day",
          payload: {
            kind: "route-settings",
            settings: source.routeSettings.event[MAP],
          },
        },
      ]);
      expect(result.changes).toHaveLength(2);
      expect(
        result.changes.every((change) => change.message.includes("保全")),
      ).toBe(true);
      for (const [day, id] of [
        [DAY, "1"],
        [OTHER, "2"],
      ]) {
        const context = event.days[day].maps[MAP];
        expect(context.hallVisitLists.map((list) => list.itemIds)).toEqual(
          known ? [[id]] : [],
        );
        expect(
          context.route?.visitOrder.map((point) => point.itemIds) ?? [],
        ).toEqual(known ? [[id]] : []);
      }
      expect(source).toEqual(before);
      expect(migrateLegacyConsistency(result.data).data).toEqual(result.data);
      valid(result.data);
    },
  );
  it("retains empty visits for a sole day without asking to choose another day", () => {
    const source = withEmptyVisits(true, false);
    const { data } = migrateLegacyConsistency(source);
    const context = data.eventConsistency.event.days[DAY].maps[MAP];
    expect(data.eventConsistency.event.legacyPending).toEqual([]);
    expect(context.hallVisitLists.map((list) => list.itemIds)).toEqual([
      [],
      ["1"],
      [],
    ]);
    expect(context.route).toEqual(source.routeSettings.event[MAP]);
    valid(data);
  });
  it("resolves the retained original positions to a chosen day and preserves the other day's known visits", () => {
    const { data } = migrateLegacyConsistency(withEmptyVisits());
    const event = data.eventConsistency.event;
    const other = structuredClone(event.days[OTHER]);
    const hall = { kind: "map" as const, mapKey: MAP, hallId: "east" };
    const listPending = event.legacyPending.find(
      (pending) => pending.payload.kind === "hall-route-settings",
    )!;
    const lists = planLegacyResolution(
      data,
      "event",
      legacyPendingIdentity(listPending),
      {
        day: DAY,
        mapKey: MAP,
        groups: {
          "undefined:highest": { hall: null, priority: "highest" },
          east: { hall, priority: "none" },
          "east:priority": { hall, priority: "priority" },
        },
      },
    );
    const routePending = lists.snapshot.eventConsistency.event.legacyPending[0];
    const resolved = planLegacyResolution(
      lists.snapshot,
      "event",
      legacyPendingIdentity(routePending),
      {
        day: DAY,
        mapKey: MAP,
        groups: {},
      },
    ).snapshot;
    expect(resolved.eventConsistency.event.legacyPending).toEqual([]);
    expect(
      resolved.eventConsistency.event.days[DAY].maps[MAP].hallVisitLists.map(
        (list) => list.itemIds,
      ),
    ).toEqual([[], ["1"], []]);
    expect(
      resolved.eventConsistency.event.days[DAY].maps[MAP].route?.visitOrder,
    ).toEqual([point(0, []), point(1, ["1"]), point(2, [])]);
    expect(resolved.eventConsistency.event.days[OTHER]).toEqual(other);
    valid(resolved);
  });
  it("preserves pending original data through JSON and full Excel, independently from migrated per-day visits", async () => {
    const { data } = migrateLegacyConsistency(withEmptyVisits());
    const parsed = parseAppBackup(serializeAppBackup(createAppBackup(data)));
    expect(parsed.data).toEqual(data);
    await excelRoundTrip(data);
  });
});

describe("I02 / R32 legacy detailed and simple hall order", () => {
  const sourceWithOrder = () => {
    const source = legacy(false);
    source.hallDefinitions.event["__mapless__:1日目"] = [
      { id: "simple1", name: "簡易1", vertices: [], blockNames: ["B"] },
      { id: "simple2", name: "簡易2", vertices: [], blockNames: ["C"] },
    ];
    source.hallRouteSettings.event = {
      [MAP]: { hallOrder: ["east"], hallVisitLists: [] },
      "__mapless__:1日目": {
        hallOrder: ["simple2", "simple1"],
        hallVisitLists: [],
      },
    };
    return source;
  };
  it.each([false, true])(
    "uses saved simple order regardless of source registration order (reversed: %s)",
    (reverse) => {
      const source = sourceWithOrder();
      if (reverse)
        source.hallRouteSettings.event = Object.fromEntries(
          Object.entries(source.hallRouteSettings.event).reverse(),
        );
      const { data } = migrateLegacyConsistency(source);
      const context = data.eventConsistency.event.days[DAY].maps[MAP];
      expect(context.hallOrder.map((group) => group.hall?.hallId)).toEqual([
        "east",
        "simple2",
        "simple1",
      ]);
      expect(data.executeModeItems).toEqual(source.executeModeItems);
      expect(data.eventLists).toEqual(source.eventLists);
      const projected = projectConsistencySnapshot(data, "event", DAY);
      const expected = context.hallOrder.map(encodeHallGroup);
      const settings = projected.hallRouteSettings as HallRouteSettingsStore;
      const merged = buildMergedHallRouteSettings({
        eventName: "event",
        dayName: DAY,
        mapTabName: MAP,
        items: projected.eventLists.event as ShoppingItem[],
        executeIds: [],
        hallDefinitionsStore: projected.hallDefinitions as HallDefinitionsStore,
        hallRouteSettingsStore: settings,
        mapDataStore: projected.mapData as MapDataStore,
      });
      expect(merged.mergedSettings.hallOrder).toEqual(expected);
      expect(
        getCombinedHallRouteSettingsForDate({
          eventName: "event",
          dayName: DAY,
          mapTabName: MAP,
          hallRouteSettings: settings,
        }).hallOrder,
      ).toEqual(expected);
      valid(data);
    },
  );
  it("preserves the complete initial order through JSON and full Excel", async () => {
    const { data } = migrateLegacyConsistency(sourceWithOrder());
    expect(
      parseAppBackup(serializeAppBackup(createAppBackup(data))).data,
    ).toEqual(data);
    await excelRoundTrip(data);
  });
});
