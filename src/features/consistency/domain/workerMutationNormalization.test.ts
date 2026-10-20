import { describe, expect, it } from "vitest";
import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../../types/item";
import type { DayMapData, HallDefinition } from "../../../types/map";
import {
  createDayConsistency,
  createEventConsistency,
  createVisitContext,
} from "../../../types/consistency";
import { getContextHalls, resolveDayMap } from "./context";
import { collectDayMutation, planDayMutation } from "./dayMutation";
import { createMembershipResolver } from "./membership";
import { projectConsistencySnapshot } from "./projection";
import {
  validateSnapshotReferences,
  validateSnapshotStructure,
} from "../../../utils/appBackup";

const day = "1日目";
const mapKey = day + "マップ";
const item = (
  id: string,
  block: string,
  number: string,
  patch: Partial<ShoppingItem> = {},
): ShoppingItem => ({
  id,
  circle: id,
  title: "ユーザー登録",
  eventDate: day,
  block,
  number,
  quantity: 1,
  price: 100,
  purchaseStatus: "None",
  remarks: "",
  ...patch,
});
const map = (): DayMapData => ({
  maxRow: 6,
  maxCol: 11,
  cells: [],
  mergedCells: [],
  blocks: ["A", "B"].map((name, index) => ({
    name,
    startRow: 1,
    endRow: 5,
    startCol: index * 6 + 1,
    endCol: index * 6 + 4,
    numberCells: [1, 2, 3, 4].map((value) => ({
      value,
      row: value + 1,
      col: index * 6 + 2,
    })),
  })),
});
const halls = (): HallDefinition[] =>
  ["A", "B"].map((name, index) => ({
    id: name,
    name: name + "館",
    blockNames: [name],
    vertices: [
      { row: 1, col: index * 6 + 1 },
      { row: 1, col: index * 6 + 4 },
      { row: 5, col: index * 6 + 4 },
      { row: 5, col: index * 6 + 1 },
    ],
  }));

describe("worker visit normalization preserves exact membership and order", () => {
  it("includes a distinct edited object even when its ID is already a member", () => {
    const stored = item("same", "A", "1");
    const edited = { ...stored, block: "B" };
    const geometry = map();
    geometry.blocks[1].numberCells[0] = { value: 1, row: 2, col: 2 };
    const definitions = halls().map((hall) => ({ ...hall, vertices: [] }));
    const resolve = createMembershipResolver({
      items: [stored],
      day,
      map: resolveDayMap({ [mapKey]: geometry }, day),
      halls: getContextHalls({ [mapKey]: definitions }, day, mapKey),
      context: createVisitContext(),
    });

    const result = resolve(edited);
    expect(result.status).toBe("confirmation-required");
    expect(result.candidates.map((hall) => hall.hallId)).toEqual(["A", "B"]);
    expect(result.memberIds).toEqual(["same"]);
    expect(stored.block).toBe("A");
  });

  it("reorders surviving visits, removes a member and appends a new visit in its hall", () => {
    const group = (hallId: string, priority: "none" | "highest" = "none") => ({
      hall: { kind: "map" as const, mapKey, hallId },
      priority,
    });
    const context = {
      ...createVisitContext(),
      hallOrder: [group("A"), group("B"), group("A", "highest")],
      hallVisitLists: [
        { group: group("A"), itemIds: ["second", "first"] },
        { group: group("B"), itemIds: ["third"] },
        { group: group("A", "highest"), itemIds: ["highest"] },
      ],
    };
    const otherContext = {
      ...createVisitContext(),
      hallOrder: [{ hall: null, priority: "none" as const }],
      hallVisitLists: [
        {
          group: { hall: null, priority: "none" as const },
          itemIds: ["other"],
        },
      ],
    };
    const source: PersistenceSnapshot = {
      eventLists: {
        event: [
          item("first", "A", "1"),
          item("second", "A", "2"),
          item("third", "B", "3"),
          item("highest", "A", "4", { priorityLevel: "highest" }),
          item("new", "B", "4"),
          item("other", "A", "1", { eventDate: "2日目" }),
        ],
      },
      eventMetadata: {},
      executeModeItems: {
        event: {
          [day]: ["first", "second", "third", "highest"],
          "2日目": ["other"],
        },
      },
      dayModes: { event: { [day]: "edit", "2日目": "execute" } },
      mapData: { event: { [mapKey]: map() } },
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallRouteSettings: {},
      hallDefinitions: { event: { [mapKey]: halls() } },
      eventConsistency: {
        event: {
          ...createEventConsistency(),
          days: {
            [day]: {
              ...createDayConsistency(),
              selectedMapKey: mapKey,
              maps: { [mapKey]: context },
            },
            "2日目": { ...createDayConsistency(), mapless: otherContext },
          },
        },
      },
    };
    const original = structuredClone(source);
    const projected = projectConsistencySnapshot(source, "event", day);
    const desired = {
      ...projected,
      executeModeItems: {
        ...projected.executeModeItems,
        event: {
          ...projected.executeModeItems.event,
          [day]: ["third", "first", "highest", "new"],
        },
      },
    };
    const command = collectDayMutation(projected, desired, "event", day);
    expect(command).toBeDefined();
    const plan = planDayMutation(source, command!);
    expect(plan.confirmation).toBeUndefined();
    const saved = plan.snapshot.eventConsistency.event.days[day].maps[mapKey];
    expect(saved.hallVisitLists).toEqual([
      { group: group("A"), itemIds: ["first"] },
      { group: group("B"), itemIds: ["third", "new"] },
      { group: group("A", "highest"), itemIds: ["highest"] },
    ]);
    expect(saved.hallOrder).toEqual(context.hallOrder);
    expect(plan.snapshot.executeModeItems.event[day]).toEqual(
      desired.executeModeItems.event[day],
    );
    expect(plan.snapshot.eventConsistency.event.days["2日目"]).toEqual(
      original.eventConsistency.event.days["2日目"],
    );
    expect(plan.snapshot.mapData.event[mapKey]).toBe(
      source.mapData.event[mapKey],
    );
    expect(source).toEqual(original);
    expect([
      ...validateSnapshotStructure(plan.snapshot),
      ...validateSnapshotReferences(plan.snapshot),
    ]).toEqual([]);
  });
});
