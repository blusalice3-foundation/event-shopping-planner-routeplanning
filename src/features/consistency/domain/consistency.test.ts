import { planMapReimport } from "./mapReimport";
import {
  planLegacyResolution,
  legacyPendingIdentity,
} from "./legacyResolution";
import {
  validateSnapshotStructure,
  validateSnapshotReferences,
} from "../../../utils/appBackup";
import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../../../types/item";
import type { DayMapData, HallDefinition } from "../../../types/map";
import { DEFAULT_BLOCK_DETECTION_SETTINGS } from "../../../types/map";
import {
  createDayConsistency,
  createEventConsistency,
  createVisitContext,
} from "../../../types/consistency";
import {
  existingDayKey,
  getContextHalls,
  hallRefKey,
  resolveDayKey,
  resolveDayMap,
  sameDay,
} from "./context";
import {
  applyMembershipIntent,
  resolveLocation,
  resolveMembership,
} from "./membership";
import { migrateLegacyConsistency, type LegacySnapshot } from "./migration";
import { validateEventConsistency } from "./validation";
import {
  createAppBackup,
  parseAppBackup,
  serializeAppBackup,
} from "../../../utils/appBackup";

const item = (id: string, patch: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  circle: id,
  title: id,
  block: "A",
  number: "01a",
  eventDate: "1日目",
  quantity: 1,
  price: 900,
  purchaseStatus: "None",
  remarks: "ユーザー登録",
  ...patch,
});
const map = (): DayMapData => ({
  cells: [],
  mergedCells: [],
  maxRow: 8,
  maxCol: 8,
  blocks: [
    {
      name: "A",
      startRow: 1,
      startCol: 1,
      endRow: 3,
      endCol: 3,
      numberCells: [{ row: 2, col: 2, value: 1 }],
    },
  ],
});
const halls: HallDefinition[] = [
  {
    id: "east",
    name: "東館",
    vertices: [
      { row: 1, col: 1 },
      { row: 1, col: 2 },
      { row: 3, col: 2 },
      { row: 3, col: 1 },
    ],
  },
  {
    id: "west",
    name: "西館",
    vertices: [
      { row: 1, col: 2 },
      { row: 1, col: 3 },
      { row: 3, col: 3 },
      { row: 3, col: 2 },
    ],
  },
];
const legacy = (): LegacySnapshot => ({
  eventLists: { event: [item("A")] },
  eventMetadata: {},
  executeModeItems: { event: { "1日目": ["A"] } },
  dayModes: {},
  mapData: { event: { "1日目マップ": map() } },
  mapRotationSettings: {},
  mapViewportSettings: {},
  hallDefinitions: { event: { "1日目マップ": halls } },
  hallRouteSettings: {},
  routeSettings: {},
});

describe("consistency context contract (R12–R25, R31, R35, R38)", () => {
  it("uses a sole original day key and distinguishes fullwidth days", () => {
    expect(existingDayKey({ " 1日目　": [] }, "1日目")).toBe(" 1日目　");
    expect(sameDay("1日目", "１日目")).toBe(false);
    expect(resolveDayKey({ "1日目": [], " 1日目　": [] }, "1日目").status).toBe(
      "ambiguous",
    );
  });
  it("prefers explicit choice, then exact name, then unique normalized match", () => {
    const maps = { "１日目マップ": map(), "1日目マップ": map() };
    expect(resolveDayMap(maps, "1日目")).toMatchObject({
      status: "resolved",
      key: "1日目マップ",
    });
    expect(resolveDayMap(maps, "1日目", "１日目マップ")).toMatchObject({
      status: "resolved",
      key: "１日目マップ",
    });
    expect(resolveDayMap({ "１日目マップ": map() }, "1日目").status).toBe(
      "resolved",
    );
    expect(
      resolveDayMap({ "１日目マップ": map(), "1 日目マップ": map() }, "1日目")
        .status,
    ).toBe("selection-required");
    expect(resolveDayMap({}, "1日目").status).toBe("none");
    expect(resolveDayMap(maps, "1日目", "gone")).toMatchObject({
      status: "selection-required",
      invalidSelection: "gone",
    });
  });
  it("normalizes spaces before looking up the number cell", () => {
    expect(resolveLocation(map(), item("A", { number: "０１ａ" }))).toEqual(
      resolveLocation(map(), item("B")),
    );
  });
  it("deduplicates equal coordinates and refuses distinct locations", () => {
    const value = map();
    value.blocks.push({ ...value.blocks[0], name: "Ａ" });
    expect(resolveLocation(value, item("A")).status).toBe("resolved");
    value.blocks[1] = {
      ...value.blocks[1],
      numberCells: [{ row: 7, col: 7, value: 1 }],
    };
    expect(resolveLocation(value, item("A")).status).toBe("ambiguous");
    value.blocks.reverse();
    expect(resolveLocation(value, item("A")).status).toBe("ambiguous");
  });
  it("does not select the first duplicate number within one block", () => {
    const value = map();
    value.blocks[0].numberCells.push({ row: 2, col: 2, value: 1 });
    expect(resolveLocation(value, item("A")).status).toBe("resolved");
    value.blocks[0].numberCells.push({ row: 7, col: 7, value: 1 });
    expect(resolveLocation(value, item("A")).status).toBe("ambiguous");
  });
  it("keeps exact case precedence and only unique case fallback", () => {
    const value = map();
    expect(resolveLocation(value, item("A", { block: "a" })).status).toBe(
      "resolved",
    );
    value.blocks.push({
      ...value.blocks[0],
      name: "a",
      numberCells: [{ row: 7, col: 7, value: 1 }],
    });
    expect(resolveLocation(value, item("A", { block: "a" }))).toMatchObject({
      status: "resolved",
      location: { cell: { row: 7, col: 7 } },
    });
    value.blocks = ["AB", "Ab"].map((name) => ({ ...value.blocks[0], name }));
    expect(resolveLocation(value, item("A", { block: "ab" })).status).toBe(
      "missing",
    );
  });
  it("distinguishes same IDs from different definition sources", () => {
    const definitions = {
      "1日目マップ": [halls[0]],
      "__mapless__: 1日目　": [
        { ...halls[1], id: "east", vertices: [], blockNames: ["A"] },
      ],
    };
    const sourced = getContextHalls(definitions, "1日目", "1日目マップ");
    expect(new Set(sourced.map((hall) => hallRefKey(hall.ref))).size).toBe(2);
  });
});
describe("shared membership (Q2, Q3, R8, R9, R17, R18, R20)", () => {
  const input = (
    items = [item("A"), item("B", { priorityLevel: "highest" })],
  ) => ({
    items,
    day: "1日目",
    map: resolveDayMap({ "1日目マップ": map() }, "1日目"),
    halls: getContextHalls({ "1日目マップ": halls }, "1日目", "1日目マップ"),
    context: createVisitContext(),
  });
  it("leaves boundaries unresolved until all peers share a choice", () => {
    const value = input();
    expect(resolveMembership(value.items[0], value).status).toBe(
      "confirmation-required",
    );
    value.context = applyMembershipIntent(
      value.items[0],
      value.items[0],
      { kind: "select", hall: value.halls[1].ref },
      value,
    );
    expect(Object.keys(value.context.assignments)).toEqual(["A", "B"]);
    expect(resolveMembership(value.items[0], value).hall).toEqual(
      value.halls[1].ref,
    );
    value.context = applyMembershipIntent(
      value.items[0],
      value.items[0],
      { kind: "automatic" },
      value,
    );
    expect(value.context.assignments).toEqual({});
    expect(resolveMembership(value.items[0], value).status).toBe(
      "confirmation-required",
    );
  });
  it("recomputes conflicts after candidate-only deletion", () => {
    const value = input();
    value.context.assignments = {
      A: value.halls[0].ref,
      B: value.halls[1].ref,
    };
    expect(resolveMembership(value.items[0], value).reason).toBe(
      "conflicting-assignments",
    );
    value.items = [value.items[0]];
    expect(resolveMembership(value.items[0], value).hall).toEqual(
      value.halls[0].ref,
    );
  });
  it("inherits the destination before an otherwise valid source choice", () => {
    const value = input();
    value.context.assignments = {
      A: value.halls[0].ref,
      B: value.halls[1].ref,
    };
    const next = applyMembershipIntent(
      value.items[0],
      item("A", { number: "02" }),
      { kind: "unchanged" },
      value,
    );
    expect(next.assignments.A).toEqual(value.halls[1].ref);
  });
  it("never turns a pending map selection into mapless membership", () => {
    const value = input();
    value.map = resolveDayMap(
      { "１日目マップ": map(), "1 日目マップ": map() },
      "1日目",
    );
    expect(resolveMembership(value.items[0], value).status).toBe(
      "map-selection-required",
    );
  });
});
describe("legacy migration and backup contract (I01, P1, R11, R30–R39)", () => {
  it("preserves old priority list spelling and shared-map routes separately by day", () => {
    const source = legacy();
    source.eventLists.event.push(item("B", { eventDate: "１日目" }));
    source.hallRouteSettings.event = {
      "1日目マップ": {
        hallOrder: ["east:priority"],
        hallVisitLists: [{ hallId: "east:priority", itemIds: ["A", "B"] }],
      },
    };
    source.routeSettings.event = {
      "1日目マップ": {
        isRouteVisible: true,
        visitOrder: [
          {
            row: 2,
            col: 2,
            blockName: "A",
            number: 1,
            order: 0,
            itemIds: ["A", "B"],
          },
        ],
      },
    };
    const original = structuredClone(source);
    const migrated = migrateLegacyConsistency(source).data;
    expect(source).toEqual(original);
    expect(
      migrated.eventConsistency.event.days["1日目"].maps["1日目マップ"].route
        ?.visitOrder[0].itemIds,
    ).toEqual(["A"]);
    expect(
      migrated.eventConsistency.event.days["１日目"].maps["1日目マップ"].route
        ?.visitOrder[0].itemIds,
    ).toEqual(["B"]);
    expect(
      migrated.eventConsistency.event.days["1日目"].maps["1日目マップ"]
        .hallVisitLists[0].legacyHallId,
    ).toBe("east:priority");
    expect(migrateLegacyConsistency(migrated).data).toEqual(migrated);
  });
  it("archives conflicting undated simple halls instead of discarding them", () => {
    const source = legacy();
    source.hallDefinitions.event.__mapless__ = [
      { id: "simple", name: "東館", vertices: [], blockNames: ["A"] },
    ];
    source.hallDefinitions.event["__mapless__:1日目"] = [
      { id: "simple", name: "西館", vertices: [], blockNames: ["B"] },
    ];
    const data = migrateLegacyConsistency(source).data;
    expect(data.eventConsistency.event.legacyPending[0].payload).toMatchObject({
      kind: "hall-definitions",
      halls: [{ name: "東館" }],
    });
    expect(data.hallDefinitions.event["__mapless__:1日目"][0]).toMatchObject({
      name: "西館",
    });
  });
  it("preserves orphan references only until validated repair, rejecting hidden corruption", () => {
    const source = legacy();
    source.routeSettings.event = {
      "1日目マップ": {
        isRouteVisible: true,
        visitOrder: [
          {
            row: 2,
            col: 2,
            blockName: "A",
            number: 1,
            order: 0,
            itemIds: ["deleted"],
          },
        ],
      },
    };
    const root = {
      kind: "event-shopping-planner-backup",
      version: 1,
      exportedAt: "2026-09-26T00:00:00.000Z",
      data: source,
    };
    expect(parseAppBackup(root).ok).toBe(true);
    (
      source.routeSettings.event["1日目マップ"] as {
        visitOrder: { row: unknown }[];
      }
    ).visitOrder[0].row = "broken";
    expect(parseAppBackup(root).ok).toBe(false);
  });
  it("exports V2 without duplicate settings and accepts explicit null", () => {
    const source = legacy();
    const backup = createAppBackup(
      source,
      new Date("2026-09-26T00:00:00.000Z"),
      { blockDetectionSettings: { event: DEFAULT_BLOCK_DETECTION_SETTINGS } },
    );
    const text = serializeAppBackup(backup);
    expect(JSON.parse(text)).not.toHaveProperty("eventSettings");
    expect(JSON.parse(text).version).toBe(2);
    expect(parseAppBackup(text)).toMatchObject({
      ok: true,
      data: {
        eventConsistency: {
          event: { blockDetectionSettings: DEFAULT_BLOCK_DETECTION_SETTINGS },
        },
      },
    });
    delete (backup.data as Partial<typeof backup.data>).eventConsistency;
    expect(parseAppBackup(backup).ok).toBe(false);
  });
  it.each(["schemaVersion", "blockDetectionSettings", "days", "legacyPending"])(
    "rejects missing required %s",
    (key) => {
      const value = { event: createEventConsistency() };
      delete (value.event as unknown as Record<string, unknown>)[key];
      expect(validateEventConsistency(value).length).toBeGreaterThan(0);
    },
  );
  it("rejects invalid nested data even when a reference would be removed", () => {
    const event = createEventConsistency();
    event.days.day = createDayConsistency();
    event.days.day.mapless = createVisitContext();
    (event.days.day.mapless.assignments as Record<string, unknown>).deleted = {
      kind: "simple",
      dayKey: "day",
      hallId: 7,
    };
    expect(validateEventConsistency({ event }).length).toBeGreaterThan(0);
  });
});
describe("migration review and map reimport", () => {
  it("preserves duplicate day buckets and manual choices until a confirmed merge", () => {
    const source = legacy();
    source.executeModeItems.event[" 1日目　"] = ["A"];
    (source.eventLists.event[0] as ShoppingItem).manualHallId = "east";
    const migrated = migrateLegacyConsistency(source).data;
    expect(Object.keys(migrated.executeModeItems.event)).toEqual([
      "1日目",
      " 1日目　",
    ]);
    expect(migrated.eventConsistency.event.legacyPending).toContainEqual(
      expect.objectContaining({
        reason: "ambiguous-day",
        payload: { kind: "manual-hall", itemId: "A", manualHallId: "east" },
      }),
    );
    expect(migrated.eventConsistency.event.days["1日目"].maps).toEqual({});
    expect(migrated.eventLists.event[0]).toMatchObject({
      title: "A",
      price: 900,
      quantity: 1,
    });
  });
  it("requires review before adding conflicting legacy definitions with distinct IDs", () => {
    const source = legacy();
    source.hallDefinitions.event.__mapless__ = [
      { id: "same", name: "旧ホール", vertices: [], blockNames: ["A"] },
    ];
    source.hallDefinitions.event["__mapless__:1日目"] = [
      { id: "same", name: "現ホール", vertices: [], blockNames: ["B"] },
    ];
    const data = createAppBackup(source as never).data;
    const pending = data.eventConsistency.event.legacyPending[0];
    const plan = planLegacyResolution(
      data,
      "event",
      legacyPendingIdentity(pending),
      { day: "1日目", mapKey: null, groups: {} },
    );
    expect(plan.confirmation).toBeDefined();
    expect(plan.snapshot.hallDefinitions.event["__mapless__:1日目"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "same", name: "現ホール" }),
        expect.objectContaining({ id: "same~2", name: "旧ホール" }),
      ]),
    );
    expect(plan.snapshot.eventConsistency.event.legacyPending).toEqual([]);
    expect(data.eventConsistency.event.legacyPending).toHaveLength(1);
    expect([
      ...validateSnapshotStructure(plan.snapshot),
      ...validateSnapshotReferences(plan.snapshot),
    ]).toEqual([]);
  });
  it("updates the actual shared map and all dependent dates without merging execution order", () => {
    const source = legacy();
    source.eventLists.event.push(
      item("B", {
        eventDate: "１日目",
        purchaseStatus: "Purchased",
        remarks: "最新",
      }),
    );
    source.executeModeItems.event["１日目"] = ["B"];
    source.mapData.event = { "１ 日目マップ": map() };
    source.hallDefinitions.event = { "１ 日目マップ": halls };
    const data = createAppBackup(source as never).data;
    const plan = planMapReimport(
      data,
      "event",
      [
        {
          eventDate: "1日目",
          mapTabName: "1日目マップ",
          mapData: map(),
          initialAngle: 90,
        },
      ],
      { preserveMaplessHalls: true },
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
    expect(Object.keys(plan.snapshot.mapData.event)).toEqual(["１ 日目マップ"]);
    expect(plan.confirmation?.details.join("\n")).toContain("１日目");
    expect(plan.snapshot.executeModeItems).toEqual(data.executeModeItems);
    expect(plan.snapshot.eventLists).toEqual(data.eventLists);
    expect(
      plan.snapshot.hallDefinitions.event["１ 日目マップ"],
    ).toBeUndefined();
    expect([
      ...validateSnapshotStructure(plan.snapshot),
      ...validateSnapshotReferences(plan.snapshot),
    ]).toEqual([]);
    const updated = structuredClone(data);
    (updated.eventLists.event[0] as ShoppingItem).remarks = "購入中に更新";
    const second = planMapReimport(
      updated,
      "event",
      [
        {
          eventDate: "1日目",
          mapTabName: "1日目マップ",
          mapData: map(),
          initialAngle: 90,
        },
      ],
      { preserveMaplessHalls: true },
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
    expect(second.confirmation?.comparison).toEqual(
      plan.confirmation?.comparison,
    );
    expect(second.snapshot.eventLists.event[0]).toMatchObject({
      remarks: "購入中に更新",
    });
  });
  it("requires an explicit target when multiple real map keys match", () => {
    const source = legacy();
    source.mapData.event = { "１日目マップ": map(), "1 日目マップ": map() };
    source.hallDefinitions.event = {};
    const data = createAppBackup(source as never).data;
    const targets = [
      {
        eventDate: "1日目",
        mapTabName: "1日目マップ",
        mapData: map(),
        initialAngle: 0,
      },
    ];
    expect(() =>
      planMapReimport(
        data,
        "event",
        targets,
        { preserveMaplessHalls: true },
        DEFAULT_BLOCK_DETECTION_SETTINGS,
      ),
    ).toThrow("選択");
    const plan = planMapReimport(
      data,
      "event",
      targets,
      {
        preserveMaplessHalls: true,
        targetMapKeys: { "1日目": "1 日目マップ" },
      },
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
    expect(Object.keys(plan.snapshot.mapData.event)).toEqual([
      "１日目マップ",
      "1 日目マップ",
    ]);
    expect(
      plan.snapshot.mapRotationSettings.event["1 日目マップ"],
    ).toBeDefined();
  });
});
