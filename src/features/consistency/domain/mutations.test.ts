import { describe, expect, it } from "vitest";
import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../../types/item";
import {
  createDayConsistency,
  createEventConsistency,
  createVisitContext,
} from "../../../types/consistency";
import {
  applyChangedFields,
  changedFieldConflicts,
  planProjectedMutation,
} from "./mutations";
import { createApplicationMutationCoordinator } from "../../../app/commands/applicationMutationCoordinator";
import { planDayModeToggle } from "./dayMode";
import { planItemEdit } from "./itemEdit";
import { duplicateEventDays, planDayMerge } from "./dayMerge";
import { applyVisitHistory } from "./visitHistory";
import {
  validateSnapshotReferences,
  validateSnapshotStructure,
} from "../../../utils/appBackup";
import {
  createAppBackup,
  parseAppBackup,
  serializeAppBackup,
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
  it.each([
    { hallId: "hall", priority: "none", legacy: "hall", expected: "hall~2" },
    {
      hallId: "hall",
      priority: "priority",
      legacy: "hall:priority",
      expected: "hall~2:priority",
    },
    {
      hallId: "hall",
      priority: "highest",
      legacy: "hall:highest",
      expected: "hall~2:highest",
    },
    {
      hallId: "hall:priority",
      priority: "none",
      legacy: "hall:priority",
      expected: "hall:priority~2",
    },
    {
      hallId: "hall:priority",
      priority: "highest",
      legacy: "hall:priority:highest",
      expected: "hall:priority~2:highest",
    },
    {
      hallId: "hall",
      priority: "priority",
      legacy: "hall:custom",
      expected: "hall:custom",
    },
  ] as const)(
    "remaps legacy group $legacy as $expected together with its sourced hall",
    ({ hallId, priority, legacy, expected }) => {
      const source = snapshot();
      source.hallDefinitions.event = {
        "__mapless__:1日目": [
          { id: hallId, name: "東", blockNames: ["A"], vertices: [] },
        ],
        "__mapless__: 1日目　": [
          { id: hallId, name: "西", blockNames: ["B"], vertices: [] },
        ],
      };
      const context = source.eventConsistency.event.days[" 1日目　"].mapless!;
      const group = {
        hall: { kind: "simple" as const, dayKey: " 1日目　", hallId },
        priority,
      };
      context.assignments.A = group.hall;
      context.hallOrder = [group, { hall: null, priority }];
      context.hallVisitLists = [
        { group, legacyHallId: legacy, itemIds: ["A"] },
        {
          group: { hall: null, priority },
          legacyHallId: `undefined:${priority}`,
          itemIds: ["B"],
        },
      ];
      source.mapData.event = {
        "1日目マップ": {
          cells: [],
          mergedCells: [],
          blocks: [],
          maxRow: 1,
          maxCol: 1,
        },
      };
      source.hallDefinitions.event["1日目マップ"] = [
        { id: hallId, name: "別マップのホール", vertices: [] },
      ];
      const mapContext = structuredClone(context);
      const mapGroup = {
        ...group,
        hall: { kind: "map" as const, mapKey: "1日目マップ", hallId },
      };
      mapContext.assignments = { A: mapGroup.hall };
      mapContext.hallOrder = [mapGroup];
      mapContext.hallVisitLists = [
        { group: mapGroup, legacyHallId: legacy, itemIds: ["A"] },
      ];
      source.eventConsistency.event.days[" 1日目　"].maps["1日目マップ"] =
        mapContext;
      const original = structuredClone(source);
      const plan = planDayMerge(source, "event", "1日目");
      const merged = plan.snapshot.eventConsistency.event.days["1日目"];
      expect(merged.mapless!.hallVisitLists[0]).toMatchObject({
        group: {
          hall: { kind: "simple", dayKey: "1日目", hallId: `${hallId}~2` },
          priority,
        },
        legacyHallId: expected,
        itemIds: ["A"],
      });
      expect(merged.mapless!.hallOrder[0]).toEqual(
        merged.mapless!.hallVisitLists[0].group,
      );
      expect(merged.mapless!.assignments.A).toEqual(
        merged.mapless!.hallOrder[0].hall,
      );
      expect(merged.mapless!.hallVisitLists[1]).toEqual(
        context.hallVisitLists[1],
      );
      expect(merged.maps["1日目マップ"]).toEqual(mapContext);
      expect(source).toEqual(original);
      const restored = parseAppBackup(
        serializeAppBackup(createAppBackup(plan.snapshot)),
      );
      expect(restored.ok).toBe(true);
      if (restored.ok)
        expect(restored.data.eventConsistency.event.days["1日目"]).toEqual(
          merged,
        );
      valid(plan.snapshot);
    },
  );
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

describe("same-field edit conflicts", () => {
  it.each([
    ["remarks", "別タブのメモ", "今回のメモ"],
    ["title", "別タブの品目", "今回の品目"],
    ["price", 700, 900],
    ["quantity", 2, 3],
    ["purchaseStatus", "Purchased", "SoldOut"],
  ] as const)(
    "requires approval before replacing a changed %s",
    (field, current, desired) => {
      const source = snapshot();
      const baseline = structuredClone(
        source.eventLists.event[0],
      ) as ShoppingItem;
      Object.assign(source.eventLists.event[0]!, { [field]: current });
      const plan = planItemEdit(
        source,
        "event",
        baseline,
        { ...baseline, [field]: desired },
        { kind: "unchanged" },
      );
      expect(plan.confirmation?.title).toBe("競合する更新を確認");
      expect(plan.confirmation?.details.join("\n")).toContain(
        JSON.stringify(current),
      );
      expect(plan.confirmation?.details.join("\n")).toContain(
        JSON.stringify(desired),
      );
      expect((source.eventLists.event[0] as ShoppingItem)[field]).toBe(current);
      valid(plan.snapshot);
    },
  );
  it("does not ask again when both writers chose the same value", () => {
    const source = snapshot();
    const baseline = structuredClone(
      source.eventLists.event[0],
    ) as ShoppingItem;
    (source.eventLists.event[0] as ShoppingItem).remarks = "同じメモ";
    expect(
      planItemEdit(
        source,
        "event",
        baseline,
        { ...baseline, remarks: "同じメモ" },
        { kind: "unchanged" },
      ).confirmation,
    ).toBeUndefined();
  });
  it("reconfirms changed conflict values and preserves unrelated purchases", async () => {
    let durable = snapshot();
    let visible = structuredClone(durable);
    const baseline = structuredClone(
      durable.eventLists.event[0],
    ) as ShoppingItem;
    let commits = 0;
    const coordinator = createApplicationMutationCoordinator({
      readCurrent: () => visible,
      drain: async () => {},
      readDurable: async () => ({
        snapshot: structuredClone(durable),
        expectedRoots: {},
        consistencyMissing: false,
      }),
      commit: async (next) => {
        commits++;
        durable = structuredClone(next);
      },
      apply: (next) => {
        visible = next;
      },
    });
    (durable.eventLists.event[0] as ShoppingItem).remarks = "別タブのメモ";
    const intent = {
      id: "edit",
      events: ["event"],
      plan: (latest: PersistenceSnapshot) =>
        planItemEdit(
          latest,
          "event",
          baseline,
          { ...baseline, remarks: "今回のメモ" },
          { kind: "unchanged" },
        ),
    };
    const first = await coordinator.request(intent);
    if (first.status !== "confirmation-required")
      throw new Error("missing conflict confirmation");
    expect(commits).toBe(0);
    (durable.eventLists.event[0] as ShoppingItem).remarks = "さらに新しいメモ";
    const next = await coordinator.confirm(first.token);
    if (next.status !== "confirmation-required")
      throw new Error("missing reconfirmation");
    expect(next.confirmation.details.join("\n")).toContain("さらに新しいメモ");
    expect(commits).toBe(0);
    (durable.eventLists.event[0] as ShoppingItem).purchaseStatus = "Purchased";
    (durable.eventLists.event[0] as ShoppingItem).price = 1200;
    expect((await coordinator.confirm(next.token)).status).toBe("committed");
    expect(visible.eventLists.event[0]).toMatchObject({
      remarks: "今回のメモ",
      purchaseStatus: "Purchased",
      price: 1200,
    });
  });
  it("detects a same-field edit discovered only after a database conflict", async () => {
    const durable = snapshot();
    const baseline = structuredClone(
      durable.eventLists.event[0],
    ) as ShoppingItem;
    let attempts = 0;
    const coordinator = createApplicationMutationCoordinator({
      readCurrent: () => durable,
      drain: async () => {},
      readDurable: async () => ({
        snapshot: structuredClone(durable),
        expectedRoots: {},
        consistencyMissing: false,
      }),
      commit: async () => {
        attempts++;
        (durable.eventLists.event[0] as ShoppingItem).remarks =
          "DB競合で届いたメモ";
        throw Object.assign(new Error("CAS conflict"), {
          name: "PersistenceConflict",
        });
      },
      apply: () => {
        throw new Error("must not apply");
      },
    });
    const result = await coordinator.request({
      id: "edit",
      events: ["event"],
      plan: (latest) =>
        planItemEdit(
          latest,
          "event",
          baseline,
          { ...baseline, remarks: "今回のメモ" },
          { kind: "unchanged" },
        ),
    });
    expect(result.status).toBe("confirmation-required");
    expect(attempts).toBe(1);
    expect((durable.eventLists.event[0] as ShoppingItem).remarks).toBe(
      "DB競合で届いたメモ",
    );
    if (result.status === "confirmation-required") {
      coordinator.cancel(result.token);
      expect((await coordinator.confirm(result.token)).status).toBe("expired");
    }
  });
  it("detects nested settings and item removal that would discard another update", () => {
    expect(
      changedFieldConflicts(
        { settings: { angle: 0, color: "red" } },
        { settings: { angle: 90, color: "red" } },
        { settings: { angle: 180, color: "blue" } },
      ).map((entry) => entry.path),
    ).toEqual([["settings", "angle"]]);
    expect(
      changedFieldConflicts([item("A")], [], [item("A", { remarks: "最新" })]),
    ).toHaveLength(1);
  });
});
describe("target-day mode plans", () => {
  it("preserves an unambiguous whitespace key and changes only the target day", () => {
    const source = snapshot();
    source.dayModes.event["2日目"] = "edit";
    const plan = planDayModeToggle(source, "event", "1日目");
    expect(plan.confirmation).toBeUndefined();
    expect(plan.snapshot.dayModes.event).toEqual({
      " 1日目　": "edit",
      "2日目": "edit",
    });
    expect(source.dayModes.event[" 1日目　"]).toBe("execute");
  });
  it.each(["mode", "selection", "halls"])(
    "confirms a settings-only %s duplicate together with the mode change",
    (kind) => {
      const source = snapshot();
      source.dayModes.event = { "1日目": "edit", "2日目": "execute" };
      source.eventConsistency.event.days = {};
      if (kind === "mode") source.dayModes.event[" 1日目　"] = "execute";
      if (kind === "selection")
        source.eventConsistency.event.days = {
          "1日目": createDayConsistency(),
          " 1日目　": createDayConsistency(),
        };
      if (kind === "halls")
        source.hallDefinitions.event = {
          "__mapless__:1日目": [],
          "__mapless__: 1日目　": [],
        };
      const original = structuredClone(source);
      const plan = planDayModeToggle(source, "event", "1日目");
      expect(plan.confirmation?.details.join("\n")).toContain("モード");
      expect(plan.snapshot.dayModes.event).toEqual({
        "1日目": "execute",
        "2日目": "execute",
      });
      expect(duplicateEventDays(plan.snapshot, "event")).toEqual([]);
      expect(source).toEqual(original);
      valid(plan.snapshot);
    },
  );
});

it("preserves a concurrently changed item order when only a field was edited", () => {
  const baseline = [item("A"), item("B")];
  const desired = [item("A", { remarks: "今回のメモ" }), item("B")];
  const latest = [item("B"), item("A", { price: 900 })];
  expect(applyChangedFields(baseline, desired, latest)).toEqual([
    item("B"),
    item("A", { remarks: "今回のメモ", price: 900 }),
  ]);
});

function selectableDayMergeSource(): PersistenceSnapshot {
  const source = snapshot();
  source.eventLists.event.push(
    item("C", { purchaseStatus: "Purchased", price: 900, quantity: 2 }),
  );
  source.executeModeItems.event = {
    "1日目": ["A", "B"],
    " 1日目　": ["B", "A", "C"],
  };
  source.dayModes.event = {
    "1日目": "edit",
    " 1日目　": "execute",
    "2日目": "edit",
  };
  const map = { maxRow: 3, maxCol: 3, cells: [], mergedCells: [], blocks: [] };
  source.mapData.event = {
    "1日目マップ": map,
    "１日目マップ": structuredClone(map),
  };
  const group = (priority: "none" | "highest") => ({ hall: null, priority });
  const context = (reverse: boolean) => ({
    ...createVisitContext(),
    hallOrder: reverse
      ? [group("highest"), group("none")]
      : [group("none"), group("highest")],
    hallVisitLists: [
      { group: group("none"), itemIds: reverse ? ["B", "A", "C"] : ["A", "B"] },
    ],
    route: {
      isRouteVisible: !reverse,
      visitOrder: (reverse ? ["B", "A", "C"] : ["A", "B"]).map((id, order) => ({
        row: 1,
        col: id.charCodeAt(0) - 64,
        blockName: "A",
        number: id.charCodeAt(0) - 64,
        itemIds: [id],
        order,
      })),
    },
  });
  source.eventConsistency.event.days = {
    "1日目": {
      ...createDayConsistency(),
      selectedMapKey: "1日目マップ",
      maps: { "1日目マップ": context(false) },
    },
    " 1日目　": {
      ...createDayConsistency(),
      selectedMapKey: "１日目マップ",
      maps: {
        "1日目マップ": context(true),
        "１日目マップ": createVisitContext(),
      },
    },
    "2日目": createDayConsistency(),
  };
  return source;
}

describe("selectable day merge results (R19/R22/R28)", () => {
  it("lets each saved order, mode, map and destination be chosen independently without losing records", () => {
    const source = selectableDayMergeSource();
    const original = structuredClone(source);
    const choices = {
      destination: " 1日目　",
      executeOrder: " 1日目　",
      mode: "edit",
      selectedMap: JSON.stringify("１日目マップ"),
      'hallOrder:"1日目マップ"': " 1日目　",
      'hallVisitLists:"1日目マップ"': " 1日目　",
      'route:"1日目マップ"': " 1日目　",
    };
    const plan = planDayMerge(source, "event", "1日目", undefined, choices);
    expect(plan.confirmation!.choices!.map((choice) => choice.id)).toEqual(
      expect.arrayContaining(Object.keys(choices)),
    );
    for (const choice of plan.confirmation!.choices!)
      expect(choice.value).toBe(choices[choice.id as keyof typeof choices]);
    expect(plan.snapshot.executeModeItems.event).toEqual({
      " 1日目　": ["B", "A", "C"],
    });
    expect(plan.snapshot.dayModes.event).toEqual({
      " 1日目　": "edit",
      "2日目": "edit",
    });
    const day = plan.snapshot.eventConsistency.event.days[" 1日目　"];
    expect(day.selectedMapKey).toBe("１日目マップ");
    expect(
      day.maps["1日目マップ"].hallOrder.map((group) => group.priority),
    ).toEqual(["highest", "none"]);
    expect(
      day.maps["1日目マップ"].hallVisitLists.map((list) => list.itemIds),
    ).toEqual([
      ["B", "A", "C"],
      ["A", "B"],
    ]);
    expect(day.maps["1日目マップ"].route).toMatchObject({
      isRouteVisible: false,
      visitOrder: [
        { itemIds: ["B"], order: 0 },
        { itemIds: ["A"], order: 1 },
        { itemIds: ["C"], order: 2 },
      ],
    });
    expect(plan.snapshot.eventLists).toEqual(original.eventLists);
    expect(plan.snapshot.eventConsistency.event.days["2日目"]).toEqual(
      original.eventConsistency.event.days["2日目"],
    );
    expect(source).toEqual(original);
    expect(duplicateEventDays(plan.snapshot, "event")).toEqual([]);
    valid(plan.snapshot);
    const restored = parseAppBackup(
      serializeAppBackup(createAppBackup(plan.snapshot)),
    );
    expect(restored.ok).toBe(true);
    if (restored.ok)
      expect(restored.data.eventConsistency).toEqual(
        plan.snapshot.eventConsistency,
      );
    expect(planDayMerge(plan.snapshot, "event", "1日目").snapshot).toEqual(
      plan.snapshot,
    );
  });

  it("keeps source-only items when another source order is adopted", () => {
    const source = selectableDayMergeSource();
    const plan = planDayMerge(source, "event", "1日目", undefined, {
      executeOrder: "1日目",
    });
    expect(plan.snapshot.executeModeItems.event["1日目"]).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(plan.snapshot.eventLists).toEqual(source.eventLists);
  });

  it("uses the chosen final mode when merging during a day-tab long press", () => {
    const source = selectableDayMergeSource();
    const plan = planDayModeToggle(source, "event", "1日目", {
      mode: "edit",
      executeOrder: " 1日目　",
    });
    expect(plan.snapshot.dayModes.event["1日目"]).toBe("edit");
    expect(plan.snapshot.executeModeItems.event["1日目"]).toEqual([
      "B",
      "A",
      "C",
    ]);
    expect(
      plan.confirmation?.choices?.find((choice) => choice.id === "mode")?.value,
    ).toBe("edit");
    valid(plan.snapshot);
  });

  it("recalculates choices on the queue, preserves purchase updates and reconfirms changed source orders", async () => {
    let durable = selectableDayMergeSource();
    let current = structuredClone(durable);
    let writes = 0;
    const coordinator = createApplicationMutationCoordinator({
      readCurrent: () => current,
      drain: async () => {},
      readDurable: async () => ({
        snapshot: structuredClone(durable),
        expectedRoots: {},
        consistencyMissing: false,
      }),
      commit: async (value) => {
        writes++;
        durable = structuredClone(value);
      },
      apply: (value) => {
        current = value;
      },
    });
    const first = await coordinator.request({
      id: "merge-choice",
      events: ["event"],
      plan: (value, choices) =>
        planDayMerge(value, "event", "1日目", undefined, choices),
    });
    if (first.status !== "confirmation-required")
      throw new Error("Expected merge preview");
    let selected = await coordinator.choose(
      first.token,
      "executeOrder",
      " 1日目　",
    );
    if (selected.status !== "confirmation-required")
      throw new Error("Expected chosen preview");
    expect(selected.token).not.toBe(first.token);
    expect(writes).toBe(0);
    expect(current).toEqual(durable);
    // Two selections can be queued from the same render without losing either.
    selected = await coordinator.choose(first.token, "mode", "execute");
    if (selected.status !== "confirmation-required")
      throw new Error("Expected chosen mode preview");
    expect(
      selected.confirmation.choices?.find((choice) => choice.id === "mode")
        ?.value,
    ).toBe("execute");
    expect(
      selected.confirmation.choices?.find(
        (choice) => choice.id === "executeOrder",
      )?.value,
    ).toBe(" 1日目　");
    expect(await coordinator.choose(selected.token, "mode", "invalid")).toEqual(
      selected,
    );
    durable.executeModeItems.event[" 1日目　"] = ["C", "B", "A"];
    const renewed = await coordinator.confirm(selected.token);
    if (renewed.status !== "confirmation-required")
      throw new Error("Expected renewed preview");
    expect(
      renewed.confirmation.choices?.find(
        (choice) => choice.id === "executeOrder",
      )?.value,
    ).toBe(" 1日目　");
    expect(writes).toBe(0);
    (durable.eventLists.event[0] as ShoppingItem).remarks = "最新の購入メモ";
    (durable.eventLists.event[0] as ShoppingItem).price = 1500;
    const committed = await coordinator.confirm(renewed.token);
    expect(committed.status).toBe("committed");
    expect(writes).toBe(1);
    expect(current.executeModeItems.event["1日目"]).toEqual(["C", "B", "A"]);
    expect(current.eventLists.event[0]).toMatchObject({
      remarks: "最新の購入メモ",
      price: 1500,
    });
  });

  it.each(["cancel", "failure"])(
    "keeps both source keys and settings on %s after a choice",
    async (action) => {
      const source = selectableDayMergeSource();
      let current = source;
      const coordinator = createApplicationMutationCoordinator({
        readCurrent: () => current,
        drain: async () => {},
        readDurable: async () => ({
          snapshot: structuredClone(source),
          expectedRoots: {},
          consistencyMissing: false,
        }),
        commit: async () => {
          throw new Error("write aborted");
        },
        apply: (value) => {
          current = value;
        },
      });
      const first = await coordinator.request({
        id: "merge",
        events: ["event"],
        plan: (value, choices) =>
          planDayMerge(value, "event", "1日目", undefined, choices),
      });
      if (first.status !== "confirmation-required")
        throw new Error("Expected merge preview");
      const selected = await coordinator.choose(
        first.token,
        "executeOrder",
        " 1日目　",
      );
      if (selected.status !== "confirmation-required")
        throw new Error("Expected chosen preview");
      if (action === "cancel") coordinator.cancel(selected.token);
      else
        await expect(coordinator.confirm(selected.token)).rejects.toThrow(
          "write aborted",
        );
      expect(current).toBe(source);
      expect(await coordinator.readExportSnapshot()).toEqual(source);
    },
  );
});
