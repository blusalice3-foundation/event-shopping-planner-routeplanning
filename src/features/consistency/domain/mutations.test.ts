import { describe, expect, it } from "vitest";
import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../../types/item";
import {
  createDayConsistency,
  createEventConsistency,
  createVisitContext,
} from "../../../types/consistency";
import { planProjectedMutation } from "./mutations";
import { planItemEdit } from "./itemEdit";
import { duplicateEventDays, planDayMerge } from "./dayMerge";
import { applyVisitHistory } from "./visitHistory";
import {
  validateSnapshotReferences,
  validateSnapshotStructure,
} from "../../../utils/appBackup";
const item = (id: string, patch: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  circle: id,
  title: "ユーザー登録",
  eventDate: "1日目",
  block: "A",
  number: id,
  price: 100,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "",
  ...patch,
});
const snapshot = (): PersistenceSnapshot => ({
  eventLists: { event: [item("A"), item("B")] },
  eventMetadata: {},
  executeModeItems: { event: { " 1日目　": ["B", "A"] } },
  dayModes: { event: { " 1日目　": "execute" } },
  mapData: {},
  mapRotationSettings: {},
  mapViewportSettings: {},
  routeSettings: {},
  hallRouteSettings: {},
  hallDefinitions: {},
  eventConsistency: {
    event: {
      ...createEventConsistency(),
      days: {
        " 1日目　": {
          ...createDayConsistency(),
          mapless: {
            ...createVisitContext(),
            hallOrder: [{ hall: null, priority: "none" }],
            hallVisitLists: [
              { group: { hall: null, priority: "none" }, itemIds: ["A", "B"] },
            ],
          },
        },
      },
    },
  },
});
const valid = (value: PersistenceSnapshot) =>
  expect([
    ...validateSnapshotStructure(value),
    ...validateSnapshotReferences(value),
  ]).toEqual([]);
describe("latest item edits and scoped consistency updates", () => {
  it("keeps every visit setting byte-equivalent during purchase-only updates", () => {
    const source = snapshot();
    const items = structuredClone(source.eventLists.event) as ShoppingItem[];
    items[0].purchaseStatus = "Purchased";
    const plan = planProjectedMutation(
      source,
      { eventLists: { event: items } },
      { eventName: "event", day: "1日目" },
    );
    expect(plan.snapshot.eventConsistency).toEqual(source.eventConsistency);
    expect(plan.snapshot.executeModeItems).toEqual(source.executeModeItems);
    expect(plan.confirmation).toBeUndefined();
    valid(plan.snapshot);
  });
  it("applies a dialog field delta on top of newer purchase records and preserves original day keys", () => {
    const source = snapshot();
    const baseline = structuredClone(
      source.eventLists.event[0],
    ) as ShoppingItem;
    const current = source.eventLists.event[0] as ShoppingItem;
    current.purchaseStatus = "Purchased";
    current.price = 700;
    current.remarks = "最新メモ";
    const plan = planItemEdit(
      source,
      "event",
      baseline,
      { ...baseline, title: "変更後", priorityLevel: "highest" },
      { kind: "unchanged" },
    );
    expect(plan.snapshot.eventLists.event[0]).toMatchObject({
      title: "変更後",
      purchaseStatus: "Purchased",
      price: 700,
      remarks: "最新メモ",
      priorityLevel: "highest",
    });
    expect(Object.keys(plan.snapshot.executeModeItems.event)).toEqual([
      " 1日目　",
    ]);
    valid(plan.snapshot);
  });
  it("retains protection escalation when a dialog changes purchase fields", () => {
    const source = snapshot();
    const baseline = {
      ...(source.eventLists.event[0] as ShoppingItem),
      source: "spreadsheet",
      protectionLevel: "none",
    } as ShoppingItem;
    source.eventLists.event[0] = baseline;
    const plan = planItemEdit(
      source,
      "event",
      baseline,
      { ...baseline, price: 500 },
      { kind: "unchanged" },
    );
    expect(plan.snapshot.eventLists.event[0]).toMatchObject({
      price: 500,
      protectionLevel: "deletable",
    });
  });
  it("keeps unrelated duplicate-day settings available until their own confirmed merge", () => {
    const source = snapshot();
    source.eventLists.other = [];
    source.eventConsistency.other = {
      ...createEventConsistency(),
      days: { day: createDayConsistency(), " day ": createDayConsistency() },
    };
    const baseline = source.eventLists.event[0] as ShoppingItem;
    const plan = planItemEdit(
      source,
      "event",
      baseline,
      { ...baseline, title: "変更" },
      { kind: "unchanged" },
    );
    expect(plan.snapshot.eventConsistency.other).toEqual(
      source.eventConsistency.other,
    );
  });
});
describe("confirmed day merge", () => {
  it("detects settings-only duplicates and remaps colliding simple hall IDs without touching purchases", () => {
    const source = snapshot();
    source.hallDefinitions.event = {
      "__mapless__:1日目": [
        { id: "hall", name: "東", blockNames: ["A"], vertices: [] },
      ],
      "__mapless__: 1日目　": [
        { id: "hall", name: "西", blockNames: ["B"], vertices: [] },
      ],
    };
    source.eventConsistency.event.days[" 1日目　"].mapless!.assignments.A = {
      kind: "simple",
      dayKey: " 1日目　",
      hallId: "hall",
    };
    expect(duplicateEventDays(source, "event")).toEqual(["1日目"]);
    const plan = planDayMerge(source, "event", "1日目");
    expect(plan.confirmation?.details.join("\n")).toContain("hall~2");
    expect(
      plan.snapshot.hallDefinitions.event["__mapless__:1日目"],
    ).toHaveLength(2);
    expect(
      plan.snapshot.eventConsistency.event.days["1日目"].mapless!.assignments.A,
    ).toEqual({ kind: "simple", dayKey: "1日目", hallId: "hall~2" });
    expect(plan.snapshot.eventLists).toEqual(source.eventLists);
    valid(plan.snapshot);
  });
  it("does not reselect a third assignment after a three-way conflict", () => {
    const source = snapshot();
    source.eventConsistency.event.days = {};
    source.hallDefinitions.event = {
      "__mapless__:1日目": ["a", "b", "c"].map((id) => ({
        id,
        name: id,
        vertices: [],
        blockNames: ["A"],
      })),
    };
    for (const [index, day] of ["1日目", " 1日目", "1日目 "].entries())
      source.eventConsistency.event.days[day] = {
        ...createDayConsistency(),
        mapless: {
          ...createVisitContext(),
          assignments: {
            A: {
              kind: "simple",
              dayKey: "1日目",
              hallId: ["a", "b", "c"][index],
            },
          },
        },
      };
    const plan = planDayMerge(source, "event", "1日目");
    expect(
      plan.snapshot.eventConsistency.event.days["1日目"].mapless!.assignments.A,
    ).toBeUndefined();
    expect(plan.snapshot.eventConsistency.event.legacyPending).toHaveLength(3);
    valid(plan.snapshot);
  });
});
describe("visit history only changes surviving known order", () => {
  it("preserves new visit slots while applying old history", () => {
    expect(
      applyVisitHistory(
        ["B", "D", "A", "C"],
        ["A", "B", "C"],
        ["A", "B", "C", "D"].map((id) => item(id)),
        () => "hall",
      ),
    ).toEqual(["A", "D", "B", "C"]);
  });
  it("preserves newly added members inside the same visit", () => {
    expect(
      applyVisitHistory(
        ["A2", "A3", "A1"],
        ["A1", "A2"],
        ["A1", "A2", "A3"].map((id) => item(id, { number: "01a" })),
        () => "hall",
      ),
    ).toEqual(["A1", "A3", "A2"]);
  });
  it("does not resurrect removed IDs or move members back across current priority groups", () => {
    const items = [
      item("A", { priorityLevel: "highest" }),
      item("B"),
      item("C"),
    ];
    expect(
      applyVisitHistory(
        ["A", "C", "B"],
        ["deleted", "B", "A", "C"],
        items,
        (value) => value.priorityLevel ?? "none",
      ),
    ).toEqual(["A", "B", "C"]);
  });
});
describe("day and map route isolation", () => {
  const withMaps = () => {
    const value = snapshot();
    value.eventLists.event = [
      item("A", { number: "01a" }),
      item("B", { number: "02a" }),
      item("C", { eventDate: "１日目", number: "01a" }),
    ];
    value.executeModeItems.event["１日目"] = ["C"];
    const map = {
      cells: [],
      mergedCells: [],
      maxRow: 4,
      maxCol: 4,
      blocks: [
        {
          name: "A",
          startRow: 1,
          startCol: 1,
          endRow: 4,
          endCol: 4,
          numberCells: [
            { row: 2, col: 2, value: 1 },
            { row: 3, col: 2, value: 2 },
          ],
        },
      ],
    };
    const hall = {
      id: "hall",
      name: "東",
      vertices: [
        { row: 1, col: 1 },
        { row: 1, col: 4 },
        { row: 4, col: 4 },
        { row: 4, col: 1 },
      ],
    };
    value.mapData.event = {
      "1日目マップ": map,
      "１日目マップ": structuredClone(map),
    };
    value.hallDefinitions.event = {
      "1日目マップ": [hall],
      "１日目マップ": [structuredClone(hall)],
    };
    const context = (mapKey: string, ids: string[]) => ({
      ...createVisitContext(),
      assignments: Object.fromEntries(
        ids.map((id) => [id, { kind: "map" as const, mapKey, hallId: "hall" }]),
      ),
      hallOrder: [
        {
          hall: { kind: "map" as const, mapKey, hallId: "hall" },
          priority: "none" as const,
        },
      ],
      hallVisitLists: [
        {
          group: {
            hall: { kind: "map" as const, mapKey, hallId: "hall" },
            priority: "none" as const,
          },
          itemIds: ids,
        },
      ],
      route: {
        isRouteVisible: true,
        visitOrder: ids.map((id, order) => ({
          row: id === "B" ? 3 : 2,
          col: 2,
          blockName: "A",
          number: id === "B" ? 2 : 1,
          itemIds: [id],
          order,
        })),
      },
    });
    value.eventConsistency.event.days = {
      " 1日目　": {
        ...createDayConsistency(),
        selectedMapKey: "1日目マップ",
        maps: {
          "1日目マップ": context("1日目マップ", ["B", "A"]),
          "１日目マップ": context("１日目マップ", ["B", "A"]),
        },
      },
      "１日目": {
        ...createDayConsistency(),
        selectedMapKey: "１日目マップ",
        maps: { "１日目マップ": context("１日目マップ", ["C"]) },
      },
    };
    return value;
  };
  it("retains a saved route when changing only visibility and leaves another day's route untouched", () => {
    const source = withMaps();
    const route =
      source.eventConsistency.event.days[" 1日目　"].maps["1日目マップ"].route!;
    route.visitOrder.reverse();
    const changed = { ...route, isRouteVisible: false };
    const plan = planProjectedMutation(
      source,
      { routeSettings: { event: { "1日目マップ": changed } } },
      { eventName: "event", day: "1日目" },
    );
    expect(
      plan.snapshot.eventConsistency.event.days[" 1日目　"].maps["1日目マップ"]
        .route,
    ).toEqual(changed);
    expect(plan.snapshot.eventConsistency.event.days["１日目"]).toEqual(
      source.eventConsistency.event.days["１日目"],
    );
    valid(plan.snapshot);
  });
  it("clears the active day's route even when its last event-level projected entry is removed", () => {
    const source = withMaps();
    const plan = planProjectedMutation(
      source,
      { routeSettings: {} },
      { eventName: "event", day: "1日目" },
    );
    expect(
      plan.snapshot.eventConsistency.event.days[" 1日目　"].maps["1日目マップ"]
        .route,
    ).toBeNull();
    expect(plan.snapshot.eventConsistency.event.days["１日目"]).toEqual(
      source.eventConsistency.event.days["１日目"],
    );
  });
  it("re-evaluates a hidden map and every dependent day while retaining the selected map's assignment", () => {
    const source = withMaps();
    const definitions = structuredClone(source.hallDefinitions);
    definitions.event["１日目マップ"] = [
      {
        id: "hall",
        name: "移動先",
        vertices: [
          { row: 10, col: 10 },
          { row: 10, col: 11 },
          { row: 11, col: 11 },
        ],
      },
    ];
    const plan = planProjectedMutation(
      source,
      { hallDefinitions: definitions },
      { eventName: "event", day: "1日目" },
    );
    expect(
      plan.snapshot.eventConsistency.event.days[" 1日目　"].maps["１日目マップ"]
        .assignments,
    ).toEqual({});
    expect(
      plan.snapshot.eventConsistency.event.days["１日目"].maps["１日目マップ"]
        .assignments,
    ).toEqual({});
    expect(
      plan.snapshot.eventConsistency.event.days[" 1日目　"].maps["1日目マップ"],
    ).toEqual(
      source.eventConsistency.event.days[" 1日目　"].maps["1日目マップ"],
    );
    expect(plan.confirmation?.details.join("\n")).toContain("１日目");
    valid(plan.snapshot);
  });
});

describe("definition dependency scope", () => {
  it("keeps duplicate buckets on an unrelated day unchanged", () => {
    const source = snapshot();
    source.eventLists.event.push(item("C", { eventDate: "2日目" }));
    source.eventConsistency.event.days["1日目"] = createDayConsistency();
    source.dayModes.event["1日目"] = "edit";
    const originalDays = structuredClone(source.eventConsistency.event.days);
    const plan = planProjectedMutation(
      source,
      {
        hallDefinitions: {
          event: {
            "__mapless__:2日目": [
              {
                id: "day-two",
                name: "2日目のホール",
                vertices: [],
                blockNames: ["A"],
              },
            ],
          },
        },
      },
      { eventName: "event", day: "2日目" },
    );
    for (const [day, value] of Object.entries(originalDays))
      expect(plan.snapshot.eventConsistency.event.days[day]).toEqual(value);
    expect(plan.snapshot.dayModes).toEqual(source.dayModes);
    valid(plan.snapshot);
  });
});
