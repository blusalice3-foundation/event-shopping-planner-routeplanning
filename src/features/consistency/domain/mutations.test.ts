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
import { planItemEdit, previewItemEdit } from "./itemEdit";
import { decodeHallRef, projectConsistencySnapshot } from "./projection";
import { duplicateEventDays, planDayMerge } from "./dayMerge";
import { planWithDayMerges, dayMergeChoicePrefix } from "./dayMergeMutation";
import { planEventRestore } from "./eventMutations";
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

describe("removed changed-field targets (R28/R37)", () => {
  it.each([
    {
      value: { blocks: [{ name: "A" }] },
      desired: { blocks: [{ name: "Ｂ" }] },
    },
    { value: [item("A")], desired: [item("A", { remarks: "今回のメモ" })] },
    { value: ["A", "B"], desired: ["B", "A"] },
  ])(
    "keeps a removed collection absent and rejects saving its old delta: $value",
    ({ value, desired }) => {
      const baseline = {
        event: { target: value, unrelated: { name: "別マップ" } },
      };
      const edited = {
        event: { target: desired, unrelated: { name: "別マップ" } },
      };
      for (const latest of [
        {},
        { event: {} },
        { event: { unrelated: { name: "最新の別マップ" } } },
      ]) {
        expect(applyChangedFields(baseline, edited, latest)).toEqual(latest);
        expect(() =>
          applyChangedFields(baseline, edited, latest, {
            requireExistingTargets: true,
          }),
        ).toThrow("編集対象が削除されています");
        expect(
          JSON.stringify(applyChangedFields(baseline, edited, latest)),
        ).not.toContain("target");
      }
    },
  );
  it("allows an intentional new target while preserving newer unrelated fields", () => {
    expect(
      applyChangedFields(
        { event: { existing: { name: "元のマップ" } } },
        {
          event: {
            existing: { name: "元のマップ" },
            added: { name: "新規マップ" },
          },
        },
        { event: { existing: { name: "最新のマップ" } } },
        { requireExistingTargets: true },
      ),
    ).toEqual({
      event: {
        existing: { name: "最新のマップ" },
        added: { name: "新規マップ" },
      },
    });
  });
  it("keeps remotely removed array entries absent while applying surviving item edits", () => {
    expect(
      applyChangedFields(
        [item("A"), item("B")],
        [
          item("A", { remarks: "消失した品目の編集" }),
          item("B", { title: "変更後" }),
        ],
        [item("B", { price: 900 })],
        { requireExistingTargets: true },
      ),
    ).toEqual([item("B", { title: "変更後", price: 900 })]);
  });
  it("allows an idempotent deletion without restoring a removed target", () => {
    expect(
      applyChangedFields(
        { target: { name: "削除済み" } },
        {},
        {},
        { requireExistingTargets: true },
      ),
    ).toEqual({});
  });
});

describe("confirmed display modes across day merge entry points (R19/R22)", () => {
  it.each(["edit", "execute", "focus"] as const)(
    "offers a focused source and saves the confirmed %s mode in a standalone merge",
    (mode) => {
      const source = snapshot();
      source.dayModes.event = {
        "1日目": "focus",
        " 1日目　": "execute",
        "2日目": "edit",
      };
      const original = structuredClone(source);
      const initial = planDayMerge(source, "event", "1日目");
      const choice = initial.confirmation!.choices!.find(
        (choice) => choice.id === "mode",
      )!;
      expect(choice.options.map((option) => option.value)).toEqual([
        "edit",
        "execute",
        "focus",
      ]);
      expect(choice.value).toBe("focus");
      expect(initial.snapshot.dayModes.event["1日目"]).toBe(choice.value);
      expect(
        choice.options.find((option) => option.value === "focus")!.label,
      ).toContain("集中モード");
      const plan = planDayMerge(source, "event", "1日目", undefined, { mode });
      expect(plan.snapshot.dayModes.event).toEqual({
        "1日目": mode,
        "2日目": "edit",
      });
      expect(source).toEqual(original);
      expect(plan.snapshot.eventLists).toEqual(original.eventLists);
      valid(plan.snapshot);
      const restored = parseAppBackup(
        serializeAppBackup(createAppBackup(plan.snapshot)),
      );
      expect(restored.ok).toBe(true);
      if (restored.ok)
        expect(restored.data.dayModes).toEqual(plan.snapshot.dayModes);
    },
  );

  const modeChanges = ["edit", "execute", "focus"].flatMap((requested) =>
    ["edit", "execute", "focus"].flatMap((confirmed) =>
      ["1日目", " 1日目　"].map((destination) => ({
        requested,
        confirmed,
        destination,
      })),
    ),
  );
  it.each(modeChanges)(
    "uses confirmed $confirmed instead of requested $requested at $destination",
    ({ requested, confirmed, destination }) => {
      const source = snapshot();
      source.dayModes.event = {
        "1日目": requested === "edit" ? "execute" : "edit",
        " 1日目　": "focus",
        "2日目": "execute",
      };
      source.eventLists.other = [];
      source.eventConsistency.other = createEventConsistency();
      source.dayModes.other = { "1日目": "focus" };
      const original = structuredClone(source);
      const patch = structuredClone(
        projectConsistencySnapshot(source, "event", "1日目").dayModes,
      );
      patch.event["1日目"] = requested;
      const input = { eventName: "event", day: "1日目" };
      const initial = planProjectedMutation(source, { dayModes: patch }, input);
      const modeChoice = initial.confirmation!.choices!.find(
        (choice) => choice.label === "統合後の表示モード",
      )!;
      expect(modeChoice.value).toBe(requested);
      expect(initial.snapshot.dayModes.event["1日目"]).toBe(requested);
      const destinationChoice = initial.confirmation!.choices!.find(
        (choice) => choice.label === "統合先の日付表記",
      )!;
      const plan = planProjectedMutation(source, { dayModes: patch }, input, {
        [modeChoice.id]: confirmed,
        [destinationChoice.id]: destination,
      });
      expect(
        plan.confirmation!.choices!.find(
          (choice) => choice.id === modeChoice.id,
        )!.value,
      ).toBe(confirmed);
      expect(plan.snapshot.dayModes).toEqual({
        event: { [destination]: confirmed, "2日目": "execute" },
        other: original.dayModes.other,
      });
      expect(plan.snapshot.executeModeItems.event).toEqual({
        [destination]: ["B", "A"],
      });
      expect(plan.snapshot.eventLists).toEqual(original.eventLists);
      expect(source).toEqual(original);
      expect(duplicateEventDays(plan.snapshot, "event")).toEqual([]);
      valid(plan.snapshot);
    },
  );

  it.each(["edit", "execute", "focus"] as const)(
    "renews the review and keeps chosen %s after another writer resolves the duplicate days",
    async (mode) => {
      let durable = snapshot();
      durable.dayModes.event["1日目"] = "edit";
      const coordinator = createApplicationMutationCoordinator({
        readCurrent: () => durable,
        drain: async () => {},
        readDurable: async () => ({
          snapshot: structuredClone(durable),
          expectedRoots: {},
          consistencyMissing: false,
        }),
        commit: async (next) => {
          durable = next;
        },
        apply: () => {},
      });
      const first = await coordinator.request({
        id: "confirmed-mode",
        events: ["event"],
        plan: (latest, choices) => {
          const dayModes = projectConsistencySnapshot(
            latest,
            "event",
            "1日目",
          ).dayModes;
          return planProjectedMutation(
            latest,
            {
              dayModes: {
                ...dayModes,
                event: { ...dayModes.event, "1日目": "execute" },
              },
            },
            { eventName: "event", day: "1日目" },
            choices,
          );
        },
      });
      if (first.status !== "confirmation-required")
        throw new Error("Expected initial review");
      const modeChoice = first.confirmation.choices!.find(
        (choice) => choice.label === "統合後の表示モード",
      )!;
      const chosen = await coordinator.choose(first.token, modeChoice.id, mode);
      if (chosen.status !== "confirmation-required")
        throw new Error("Expected chosen review");
      durable = planDayMerge(durable, "event", "1日目", undefined, {
        mode: "execute",
      }).snapshot;
      const external = structuredClone(durable);
      const renewed = await coordinator.confirm(chosen.token);
      expect(renewed.status).toBe("confirmation-required");
      expect(durable).toEqual(external);
      if (renewed.status !== "confirmation-required")
        throw new Error("Expected renewed review");
      expect(await coordinator.confirm(renewed.token)).toMatchObject({
        status: "committed",
      });
      expect(durable.dayModes.event).toEqual({ "1日目": mode });
      expect(durable.eventLists).toEqual(external.eventLists);
      valid(durable);
    },
  );

  it("confirms a newly requested mode when only execution buckets are duplicated", () => {
    const source = snapshot();
    source.dayModes.event = {};
    source.executeModeItems.event["1日目"] = ["A"];
    const patch = { dayModes: { event: { "1日目": "execute" } } };
    const input = { eventName: "event", day: "1日目" };
    const initial = planProjectedMutation(source, patch, input);
    const choice = initial.confirmation!.choices!.find(
      (choice) => choice.label === "統合後の表示モード",
    )!;
    expect(choice.value).toBe("execute");
    const plan = planProjectedMutation(source, patch, input, {
      [choice.id]: "focus",
    });
    expect(plan.snapshot.dayModes.event).toEqual({ "1日目": "focus" });
    valid(plan.snapshot);
  });

  it.each(["edit", "execute", "focus"] as const)(
    "keeps the long-press confirmation and saved %s mode aligned",
    (mode) => {
      const source = selectableDayMergeSource();
      source.dayModes.event["1日目"] = "focus";
      const plan = planDayModeToggle(source, "event", "1日目", {
        mode,
        destination: " 1日目　",
      });
      expect(
        plan.confirmation!.choices!.find((choice) => choice.id === "mode")!
          .value,
      ).toBe(mode);
      expect(plan.snapshot.dayModes.event).toEqual({
        " 1日目　": mode,
        "2日目": "edit",
      });
      valid(plan.snapshot);
    },
  );
});

describe("ordinary mutations review duplicate day settings (R19/R22)", () => {
  it.each(["reorder", "edit", "move"] as const)(
    "reviews mode-only duplicates before %s and preserves other days",
    (operation) => {
      const source = snapshot();
      source.dayModes.event["1日目"] = "edit";
      source.dayModes.event["2日目"] = "execute";
      const original = structuredClone(source);
      const baseline = source.eventLists.event[0] as ShoppingItem;
      const plan =
        operation === "edit" || operation === "move"
          ? planItemEdit(
              source,
              "event",
              baseline,
              {
                ...baseline,
                remarks: "今回の編集",
                ...(operation === "move" ? { eventDate: "2日目" } : {}),
              },
              { kind: "unchanged" },
            )
          : planProjectedMutation(
              source,
              { executeModeItems: { event: { "1日目": ["A", "B"] } } },
              { eventName: "event", day: "1日目", confirm: false },
            );
      expect(plan.confirmation?.title).toContain("保存先を統合");
      expect(
        plan.confirmation?.choices?.some(
          (choice) => choice.label === "統合後の表示モード",
        ),
      ).toBe(true);
      expect(duplicateEventDays(plan.snapshot, "event")).toEqual([]);
      expect(source).toEqual(original);
      expect(plan.snapshot.dayModes.event["2日目"]).toBe("execute");
      valid(plan.snapshot);
    },
  );

  it("applies the chosen destination and mode together with an ordinary reorder", async () => {
    const source = snapshot();
    source.dayModes.event["1日目"] = "edit";
    const coordinator = createApplicationMutationCoordinator({
      readCurrent: () => source,
      drain: async () => {},
      readDurable: async () => ({
        snapshot: structuredClone(source),
        expectedRoots: {},
        consistencyMissing: false,
      }),
      commit: async (next) => {
        Object.assign(source, next);
      },
      apply: () => {},
    });
    const first = await coordinator.request({
      id: "ordinary-reorder",
      events: ["event"],
      plan: (latest, choices) =>
        planProjectedMutation(
          latest,
          { executeModeItems: { event: { "1日目": ["A", "B"] } } },
          { eventName: "event", day: "1日目" },
          choices,
        ),
    });
    if (first.status !== "confirmation-required")
      throw new Error("Expected day merge review");
    const selections = Object.fromEntries(
      first.confirmation.choices!.map((choice) => [
        choice.id,
        choice.label === "統合先の日付表記"
          ? " 1日目　"
          : choice.label === "統合後の表示モード"
            ? "edit"
            : choice.value,
      ]),
    );
    let token = first.token;
    for (const [id, value] of Object.entries(selections)) {
      const selected = await coordinator.choose(token, id, value);
      if (selected.status !== "confirmation-required")
        throw new Error("Expected selected review");
      token = selected.token;
    }
    expect((await coordinator.confirm(token)).status).toBe("committed");
    expect(source.dayModes.event).toEqual({ " 1日目　": "edit" });
    expect(source.executeModeItems.event).toEqual({ " 1日目　": ["A", "B"] });
    valid(source);
  });
});

describe("ordinary mutation merge scope and renewed review", () => {
  it("keeps source and destination day choices separate when editing an item's date", () => {
    const source = snapshot();
    source.dayModes.event["1日目"] = "edit";
    source.dayModes.event["2日目"] = "edit";
    source.dayModes.event[" 2日目　"] = "execute";
    const baseline = source.eventLists.event[0] as ShoppingItem;
    const edited = { ...baseline, eventDate: "2日目", remarks: "移動後のメモ" };
    const initial = planItemEdit(source, "event", baseline, edited, {
      kind: "unchanged",
    });
    const modeChoices = initial.confirmation!.choices!.filter((choice) =>
      choice.label.includes("統合後の表示モード"),
    );
    expect(modeChoices).toHaveLength(2);
    expect(new Set(modeChoices.map((choice) => choice.id)).size).toBe(2);
    expect(new Set(modeChoices.map((choice) => choice.label)).size).toBe(2);
    const choices = Object.fromEntries(
      modeChoices.map((choice) => [
        choice.id,
        choice.id.includes("2日目") ? "execute" : "edit",
      ]),
    );
    const selected = planItemEdit(
      source,
      "event",
      baseline,
      edited,
      { kind: "unchanged" },
      choices,
    );
    expect(selected.snapshot.dayModes.event).toEqual({
      "1日目": "edit",
      "2日目": "execute",
    });
    expect(duplicateEventDays(selected.snapshot, "event")).toEqual([]);
    expect(selected.snapshot.eventLists.event[0]).toMatchObject(edited);
    valid(selected.snapshot);
  });

  it("renews an ordinary edit's merge review when modes change and preserves a concurrent purchase", async () => {
    let durable = snapshot();
    durable.dayModes.event["1日目"] = "edit";
    const baseline = durable.eventLists.event[0] as ShoppingItem;
    let commits = 0;
    const coordinator = createApplicationMutationCoordinator({
      readCurrent: () => durable,
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
      apply: () => {},
    });
    const first = await coordinator.request({
      id: "ordinary-edit-review",
      events: ["event"],
      plan: (latest, choices) =>
        planItemEdit(
          latest,
          "event",
          baseline,
          { ...baseline, remarks: "新しいメモ" },
          { kind: "unchanged" },
          choices,
        ),
    });
    if (first.status !== "confirmation-required")
      throw new Error("Expected merge review");
    durable.dayModes.event[" 1日目　"] = "edit";
    Object.assign(durable.eventLists.event[1] as ShoppingItem, {
      purchaseStatus: "Purchased",
      price: 800,
      quantity: 2,
    });
    const renewed = await coordinator.confirm(first.token);
    expect(commits).toBe(0);
    if (renewed.status !== "confirmation-required")
      throw new Error("Expected renewed merge review");
    expect((await coordinator.confirm(renewed.token)).status).toBe("committed");
    expect(durable.eventLists.event[1]).toMatchObject({
      purchaseStatus: "Purchased",
      price: 800,
      quantity: 2,
    });
    expect(durable.eventLists.event[0]).toMatchObject({
      remarks: "新しいメモ",
    });
    valid(durable);
  });

  it("retains merge choices when the requested edit also conflicts with another writer", () => {
    const source = snapshot();
    source.dayModes.event["1日目"] = "edit";
    const baseline = structuredClone(
      source.eventLists.event[0],
    ) as ShoppingItem;
    (source.eventLists.event[0] as ShoppingItem).remarks = "別タブのメモ";
    const plan = planItemEdit(
      source,
      "event",
      baseline,
      { ...baseline, remarks: "今回のメモ" },
      { kind: "unchanged" },
    );
    expect(
      plan.confirmation!.choices!.some(
        (choice) => choice.label === "統合後の表示モード",
      ),
    ).toBe(true);
    expect(plan.confirmation!.details.join("\n")).toContain("別タブのメモ");
    valid(plan.snapshot);
  });
});

it("remaps an explicit simple-hall choice with the day merge before saving an item edit", () => {
  const source = snapshot();
  source.dayModes.event["1日目"] = "edit";
  source.hallDefinitions.event = {
    "__mapless__: 1日目　": [
      { id: "simple", name: "簡易会場", blockNames: ["A"], vertices: [] },
    ],
  };
  const baseline = source.eventLists.event[0] as ShoppingItem;
  const preview = previewItemEdit(
    source,
    "event",
    baseline,
    { ...baseline, remarks: "ホール選択付きの編集" },
    { kind: "unchanged" },
  );
  expect(decodeHallRef(preview.halls[0].id)).toEqual({
    kind: "simple",
    dayKey: " 1日目　",
    hallId: "simple",
  });
  const plan = planItemEdit(
    source,
    "event",
    baseline,
    { ...baseline, remarks: "ホール選択付きの編集" },
    {
      kind: "select",
      hall: { kind: "simple", dayKey: " 1日目　", hallId: "simple" },
    },
  );
  expect(
    plan.confirmation!.choices!.some(
      (choice) => choice.label === "統合先の日付表記",
    ),
  ).toBe(true);
  expect(
    plan.snapshot.eventConsistency.event.days["1日目"].mapless!.assignments.A,
  ).toEqual({
    kind: "simple",
    dayKey: "1日目",
    hallId: "simple",
  });
  valid(plan.snapshot);
});

it.each(["hall order", "hall definition"] as const)(
  "preserves a requested %s change while merging its simple-hall source",
  (operation) => {
    const source = snapshot();
    source.dayModes.event["1日目"] = "edit";
    source.hallDefinitions.event = {
      "__mapless__: 1日目　": [
        { id: "first", name: "簡易一", blockNames: ["A"], vertices: [] },
        { id: "second", name: "簡易二", blockNames: ["A"], vertices: [] },
      ],
    };
    const refs = ["first", "second"].map((hallId) => ({
      kind: "simple" as const,
      dayKey: " 1日目　",
      hallId,
    }));
    source.eventConsistency.event.days[" 1日目　"].mapless!.hallOrder =
      refs.map((hall) => ({ hall, priority: "none" }));
    const projection = projectConsistencySnapshot(source, "event", "1日目");
    if (operation === "hall order")
      (
        projection.hallRouteSettings.event["__mapless__:1日目"] as {
          hallOrder: string[];
        }
      ).hallOrder.reverse();
    else
      (
        projection.hallDefinitions.event["__mapless__:1日目"] as Array<{
          name: string;
        }>
      )[0].name = "変更した簡易一";
    const plan = planProjectedMutation(
      source,
      operation === "hall order"
        ? { hallRouteSettings: projection.hallRouteSettings }
        : { hallDefinitions: projection.hallDefinitions },
      { eventName: "event", day: "1日目" },
    );
    expect(plan.confirmation!.title).toContain("保存先を統合");
    if (operation === "hall order")
      expect(
        plan.snapshot.eventConsistency.event.days["1日目"]
          .mapless!.hallOrder.map((group) => group.hall)
          .filter((hall) => hall !== null),
      ).toEqual(
        [...refs].reverse().map((hall) => ({ ...hall, dayKey: "1日目" })),
      );
    else
      expect(
        plan.snapshot.hallDefinitions.event["__mapless__:1日目"],
      ).toMatchObject([{ name: "変更した簡易一" }, { name: "簡易二" }]);
    valid(plan.snapshot);
  },
);

it("applies a simple-hall definition edit to its remapped ID when duplicate sources collide", () => {
  const source = snapshot();
  source.hallDefinitions.event = {
    "__mapless__:1日目": [
      { id: "hall", name: "東", blockNames: ["B"], vertices: [] },
    ],
    "__mapless__: 1日目　": [
      { id: "hall", name: "西", blockNames: ["A"], vertices: [] },
    ],
  };
  const projection = projectConsistencySnapshot(source, "event", "1日目");
  (
    projection.hallDefinitions.event["__mapless__: 1日目　"] as Array<{
      name: string;
    }>
  )[0].name = "変更した西";
  const plan = planProjectedMutation(
    source,
    { hallDefinitions: projection.hallDefinitions },
    { eventName: "event", day: "1日目" },
  );
  expect(
    plan.snapshot.hallDefinitions.event["__mapless__:1日目"],
  ).toMatchObject([
    { id: "hall", name: "東" },
    { id: "hall~2", name: "変更した西" },
  ]);
  valid(plan.snapshot);
});

it("keeps remapped simple-hall choices isolated between events with the same source IDs", () => {
  const source = snapshot();
  source.hallDefinitions.event = {
    "__mapless__:1日目": [
      { id: "hall", name: "東", blockNames: ["B"], vertices: [] },
    ],
    "__mapless__: 1日目　": [
      { id: "hall", name: "西", blockNames: ["A"], vertices: [] },
    ],
  };
  source.eventLists.other = [item("C"), item("D")];
  source.executeModeItems.other = { " 1日目　": ["C", "D"] };
  source.dayModes.other = { "1日目": "edit", " 1日目　": "execute" };
  source.hallDefinitions.other = {
    "__mapless__: 1日目　": [
      { id: "hall", name: "別イベント", blockNames: ["A"], vertices: [] },
    ],
  };
  source.eventConsistency.other = {
    ...createEventConsistency(),
    days: {
      " 1日目　": { ...createDayConsistency(), mapless: createVisitContext() },
    },
  };
  const hall = { kind: "simple" as const, dayKey: " 1日目　", hallId: "hall" };
  const plan = planWithDayMerges(
    source,
    [
      { eventName: "event", day: "1日目" },
      { eventName: "other", day: "1日目" },
    ],
    {},
    (merged, remapHall) => {
      const next = structuredClone(merged);
      next.eventConsistency.event.days["1日目"].mapless!.assignments.A =
        remapHall("event", hall);
      next.eventConsistency.other.days["1日目"].mapless!.assignments.C =
        remapHall("other", hall);
      return { snapshot: next };
    },
  );
  expect(
    plan.snapshot.eventConsistency.event.days["1日目"].mapless!.assignments.A,
  ).toEqual({ ...hall, dayKey: "1日目", hallId: "hall~2" });
  expect(
    plan.snapshot.eventConsistency.other.days["1日目"].mapless!.assignments.C,
  ).toEqual({ ...hall, dayKey: "1日目" });
  valid(plan.snapshot);
});

it("requires selectable day merging before restoring a new event with settings-only duplicates", () => {
  const backup = snapshot();
  backup.dayModes.event["1日目"] = "edit";
  const original = structuredClone(backup);
  const current = snapshot();
  const plan = planEventRestore(current, backup, "event", "restored");
  expect(plan.confirmation?.choices?.map((choice) => choice.label)).toEqual(
    expect.arrayContaining(["統合先の日付表記", "統合後の表示モード"]),
  );
  const prefix = dayMergeChoicePrefix("restored", "1日目");
  const chosen = planEventRestore(current, backup, "event", "restored", [], {
    [`${prefix}destination`]: " 1日目　",
    [`${prefix}mode`]: "focus",
  });
  expect(chosen.snapshot.dayModes.restored).toEqual({ " 1日目　": "focus" });
  expect(chosen.snapshot.executeModeItems.restored).toEqual({
    " 1日目　": ["B", "A"],
  });
  expect(chosen.snapshot.eventLists.restored).toEqual(backup.eventLists.event);
  expect(chosen.snapshot.eventConsistency.event).toEqual(
    current.eventConsistency.event,
  );
  expect(chosen.invalidatedEvents).toEqual(["restored"]);
  expect(backup).toEqual(original);
  valid(chosen.snapshot);
});

it("restoration merges all duplicated days with separate choices and deterministic proposals", () => {
  const backup = snapshot();
  backup.executeModeItems.event["1日目"] = ["A", "B"];
  backup.dayModes.event["1日目"] = "edit";
  backup.dayModes.event["2日目"] = "edit";
  backup.dayModes.event[" 2日目　"] = "execute";
  const choices = {
    [`${dayMergeChoicePrefix("event", "1日目")}destination`]: " 1日目　",
    [`${dayMergeChoicePrefix("event", "1日目")}executionOrder`]: " 1日目　",
    [`${dayMergeChoicePrefix("event", "1日目")}mode`]: "execute",
    [`${dayMergeChoicePrefix("event", "2日目")}destination`]: "2日目",
    [`${dayMergeChoicePrefix("event", "2日目")}mode`]: "focus",
  };
  const plan = planEventRestore(
    snapshot(),
    backup,
    "event",
    "event",
    ["参照整理済み"],
    choices,
  );
  expect(plan.confirmation?.details).toContain("参照整理済み");
  expect(duplicateEventDays(plan.snapshot, "event")).toEqual([]);
  expect(plan.snapshot.dayModes.event).toEqual({
    " 1日目　": "execute",
    "2日目": "focus",
  });
  expect(plan.snapshot.eventLists).toEqual(backup.eventLists);
  const reversed = structuredClone(backup);
  reversed.dayModes.event = Object.fromEntries(
    Object.entries(reversed.dayModes.event).reverse(),
  );
  expect(
    planEventRestore(
      snapshot(),
      reversed,
      "event",
      "event",
      ["参照整理済み"],
      choices,
    ).snapshot,
  ).toEqual(plan.snapshot);
  expect(
    planEventRestore(snapshot(), plan.snapshot, "event", "event").snapshot,
  ).toEqual(plan.snapshot);
  valid(plan.snapshot);
});
