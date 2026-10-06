import {
  exportToXlsx,
  importFromXlsx,
} from "../../../xlsx/engine/eventWorkbookEngine";
import type { EventWorkbookAdditionalData } from "../../../xlsx/domain/eventWorkbook";
import { describe, expect, it } from "vitest";
import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import { createApplicationMutationCoordinator } from "../../../app/commands/applicationMutationCoordinator";
import type { ShoppingItem } from "../../../types/item";
import type { DayMapData, HallRouteSettings } from "../../../types/map";
import {
  createDayConsistency,
  createEventConsistency,
  createVisitContext,
} from "../../../types/consistency";
import {
  createAppBackup,
  parseAppBackup,
  serializeAppBackup,
  validateSnapshotReferences,
  validateSnapshotStructure,
} from "../../../utils/appBackup";
import { planItemEdit, previewItemEdit } from "./itemEdit";
import { planProjectedMutation } from "./mutations";
import { projectConsistencySnapshot } from "./projection";

const mapKey = "1日目マップ";
const makeSource = (): PersistenceSnapshot => {
  const items: ShoppingItem[] = ["a", "b"].map((id, index) => ({
    id,
    circle: id,
    title: "ユーザー登録",
    eventDate: "1日目",
    block: "A",
    number: String(index + 1),
    price: 500,
    quantity: 1,
    purchaseStatus: "None",
    remarks: "元のメモ",
  }));
  const group = {
    hall: { kind: "map" as const, mapKey, hallId: "hall" },
    priority: "none" as const,
  };
  return {
    eventLists: { event: items },
    eventMetadata: {},
    executeModeItems: { event: { "1日目": ["a", "b"] } },
    dayModes: { event: { "1日目": "execute" } },
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallRouteSettings: {},
    mapData: {
      event: {
        [mapKey]: {
          cells: [],
          mergedCells: [],
          maxRow: 8,
          maxCol: 8,
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
        },
      },
    },
    hallDefinitions: {
      event: {
        [mapKey]: [
          {
            id: "hall",
            name: "東館",
            vertices: [
              { row: 1, col: 1 },
              { row: 1, col: 4 },
              { row: 4, col: 4 },
              { row: 4, col: 1 },
            ],
          },
        ],
      },
    },
    eventConsistency: {
      event: {
        ...createEventConsistency(),
        days: {
          "1日目": {
            ...createDayConsistency(),
            selectedMapKey: mapKey,
            maps: {
              [mapKey]: {
                ...createVisitContext(),
                hallOrder: [group],
                hallVisitLists: [
                  { group, itemIds: ["a"] },
                  { group, itemIds: ["b"], legacyHallId: "hall" },
                ],
                route: {
                  isRouteVisible: true,
                  visitOrder: items.map((item, order) => ({
                    row: order + 2,
                    col: 2,
                    blockName: "A",
                    number: order + 1,
                    order,
                    itemIds: [item.id],
                  })),
                },
              },
            },
          },
        },
      },
    },
  };
};
const context = (source: PersistenceSnapshot) =>
  source.eventConsistency.event.days["1日目"].maps[mapKey];
const definitionPlan = (source: PersistenceSnapshot) => {
  const maps = structuredClone(source.mapData);
  const map = maps.event[mapKey] as DayMapData;
  map.blocks[0].numberCells[0].row = 1;
  return planProjectedMutation(
    source,
    { mapData: maps },
    { eventName: "event", day: "1日目" },
  );
};
const valid = (source: PersistenceSnapshot) => {
  expect(validateSnapshotStructure(source)).toEqual([]);
  expect(validateSnapshotReferences(source)).toEqual([]);
};
const coordinatorFor = (source: PersistenceSnapshot, commitFailure?: Error) => {
  let durable = structuredClone(source);
  let visible = structuredClone(source);
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
      if (commitFailure) throw commitFailure;
      commits++;
      durable = structuredClone(next);
    },
    apply: (next) => {
      visible = next;
    },
  });
  return { coordinator, current: () => durable, commits: () => commits };
};

describe("R28 definition confirmation covers final visit results", () => {
  it("still shows affected visit settings for a definition change on an empty day", () => {
    const source = makeSource();
    source.eventLists.event = [];
    source.executeModeItems.event["1日目"] = [];
    context(source).hallVisitLists = [];
    context(source).route!.visitOrder = [];
    const plan = definitionPlan(source);
    expect(plan.confirmation?.details.join("\n")).toContain(
      "1日目 / 1日目マップ: 巡回順: 東館（通常）",
    );
    valid(plan.snapshot);
  });
  it("reconfirms a priority edit accepted while waiting and rejects the old token", async () => {
    const session = coordinatorFor(makeSource());
    const first = await session.coordinator.request({
      id: "definition",
      events: ["event"],
      plan: definitionPlan,
    });
    if (first.status !== "confirmation-required")
      throw new Error("missing confirmation");
    const baseline = session.current().eventLists.event[0] as ShoppingItem;
    expect(
      (
        await session.coordinator.request({
          id: "priority",
          events: ["event"],
          plan: (latest) =>
            planItemEdit(
              latest,
              "event",
              baseline,
              { ...baseline, priorityLevel: "highest" },
              { kind: "unchanged" },
            ),
        })
      ).status,
    ).toBe("committed");
    const next = await session.coordinator.confirm(first.token);
    expect(next.status).toBe("confirmation-required");
    expect(session.commits()).toBe(1);
    if (next.status !== "confirmation-required") return;
    expect(next.confirmation.details.join("\n")).toContain("最優先");
    expect((await session.coordinator.confirm(first.token)).status).toBe(
      "expired",
    );
    expect((await session.coordinator.confirm(next.token)).status).toBe(
      "committed",
    );
    expect(context(session.current()).hallVisitLists).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: expect.objectContaining({ priority: "highest" }),
          itemIds: ["a"],
        }),
      ]),
    );
    expect(
      (session.current().mapData.event[mapKey] as DayMapData).blocks[0]
        .numberCells[0].row,
    ).toBe(1);
    valid(session.current());
  });
  it.each(["hallOrder", "hallVisitLists", "route", "executeOrder"] as const)(
    "reconfirms changed %s and cancellation retains the intervening update",
    async (field) => {
      const source = makeSource();
      context(source).hallOrder.push({ hall: null, priority: "priority" });
      const session = coordinatorFor(source);
      const first = await session.coordinator.request({
        id: "definition",
        events: ["event"],
        plan: definitionPlan,
      });
      if (first.status !== "confirmation-required")
        throw new Error("missing confirmation");
      const latest = session.current();
      if (field === "hallOrder") context(latest).hallOrder.reverse();
      if (field === "hallVisitLists") context(latest).hallVisitLists.reverse();
      if (field === "route") context(latest).route!.isRouteVisible = false;
      if (field === "executeOrder")
        latest.executeModeItems.event["1日目"].reverse();
      const updated = structuredClone(latest);
      const next = await session.coordinator.confirm(first.token);
      expect(next.status).toBe("confirmation-required");
      expect(session.commits()).toBe(0);
      if (next.status !== "confirmation-required") return;
      session.coordinator.cancel(next.token);
      expect((await session.coordinator.confirm(next.token)).status).toBe(
        "expired",
      );
      expect(session.current()).toEqual(updated);
    },
  );
  it("retains purchases, money, quantities and memos without asking again", async () => {
    const session = coordinatorFor(makeSource());
    const first = await session.coordinator.request({
      id: "definition",
      events: ["event"],
      plan: definitionPlan,
    });
    if (first.status !== "confirmation-required")
      throw new Error("missing confirmation");
    Object.assign(session.current().eventLists.event[0] as ShoppingItem, {
      purchaseStatus: "Purchased",
      price: 900,
      quantity: 2,
      remarks: "確認中のメモ",
    });
    expect((await session.coordinator.confirm(first.token)).status).toBe(
      "committed",
    );
    expect(session.current().eventLists.event[0]).toMatchObject({
      purchaseStatus: "Purchased",
      price: 900,
      quantity: 2,
      remarks: "確認中のメモ",
    });
    valid(session.current());
  });
  it("ignores visit settings on an unrelated day", async () => {
    const source = makeSource();
    source.eventConsistency.event.days["2日目"] = {
      ...createDayConsistency(),
      mapless: createVisitContext(),
    };
    const session = coordinatorFor(source);
    const first = await session.coordinator.request({
      id: "definition",
      events: ["event"],
      plan: definitionPlan,
    });
    if (first.status !== "confirmation-required")
      throw new Error("missing confirmation");
    session
      .current()
      .eventConsistency.event.days[
        "2日目"
      ].mapless!.hallOrder.push({ hall: null, priority: "highest" });
    expect((await session.coordinator.confirm(first.token)).status).toBe(
      "committed",
    );
    expect(
      session.current().eventConsistency.event.days["2日目"].mapless!.hallOrder,
    ).toEqual([{ hall: null, priority: "highest" }]);
  });
});

describe("I02 split visit lists retain their own legacy metadata", () => {
  it.each(["order-only", "reverse-lists", "changed-members"] as const)(
    "preserves each list for %s and JSON roundtrip",
    (operation) => {
      const source = makeSource();
      context(source).hallOrder.push({ hall: null, priority: "none" });
      const projected = projectConsistencySnapshot(source, "event", "1日目");
      const settings = structuredClone(projected.hallRouteSettings) as Record<
        string,
        Record<string, HallRouteSettings>
      >;
      settings.event[mapKey].hallOrder.reverse();
      if (operation === "reverse-lists")
        settings.event[mapKey].hallVisitLists.reverse();
      if (operation === "changed-members") {
        source.eventLists.event.push({
          ...(source.eventLists.event[0] as ShoppingItem),
          id: "c",
        });
        source.executeModeItems.event["1日目"].push("c");
        settings.event[mapKey].hallVisitLists[0].itemIds.push("c");
      }
      const plan = planProjectedMutation(
        source,
        { hallRouteSettings: settings },
        { eventName: "event", day: "1日目" },
      );
      const lists = context(plan.snapshot).hallVisitLists;
      expect(
        lists.find((list) => list.itemIds.includes("a"))?.legacyHallId,
      ).toBeUndefined();
      expect(
        lists.find((list) => list.itemIds.includes("b"))?.legacyHallId,
      ).toBe("hall");
      expect(lists).toHaveLength(2);
      const restored = parseAppBackup(
        serializeAppBackup(createAppBackup(plan.snapshot)),
      );
      expect(restored.ok).toBe(true);
      if (restored.ok)
        expect(context(restored.data).hallVisitLists).toEqual(lists);
      valid(plan.snapshot);
    },
  );
});

describe("R20/I08 item preview separates hall membership from unresolved location", () => {
  const ambiguousSource = () => {
    const source = makeSource();
    const map = source.mapData.event[mapKey] as DayMapData;
    map.blocks.push({
      ...map.blocks[0],
      numberCells: [{ row: 6, col: 6, value: 1 }],
    });
    return source;
  };
  it.each([
    "unassigned",
    "automatic",
    "manual",
    "confirmation-required",
  ] as const)("shows ambiguity independently of %s membership", (state) => {
    const source = ambiguousSource();
    if (state !== "unassigned")
      source.hallDefinitions.event["__mapless__:1日目"] = [
        { id: "simple", name: "簡易館", vertices: [], blockNames: ["A"] },
      ];
    if (state === "manual")
      context(source).assignments.a = {
        kind: "simple",
        dayKey: "1日目",
        hallId: "simple",
      };
    if (state === "confirmation-required")
      (source.hallDefinitions.event["__mapless__:1日目"] as unknown[]).push({
        id: "second",
        name: "第二館",
        vertices: [],
        blockNames: ["A"],
      });
    const baseline = source.eventLists.event[0] as ShoppingItem;
    const preview = previewItemEdit(source, "event", baseline, baseline, {
      kind: "unchanged",
    });
    expect(preview.status).toBe(
      {
        unassigned: "未割当",
        automatic: "自動判定",
        manual: "共有先の手動指定を使用",
        "confirmation-required": "所属確認が必要",
      }[state],
    );
    expect(preview).toMatchObject({ locationStatus: "場所未解決" });
    expect(preview.details.join("\n")).toContain("異なる位置");
    expect(preview.details.join("\n")).toContain(mapKey);
    expect(preview.details.join("\n")).toContain("ブロック定義");
    expect(source.eventLists.event[0]).toEqual(baseline);
  });
  it("shows the missing-cell reason but does not label a resolved or mapless item ambiguous", () => {
    const source = makeSource();
    const baseline = source.eventLists.event[0] as ShoppingItem;
    expect(
      previewItemEdit(source, "event", baseline, baseline, {
        kind: "unchanged",
      }),
    ).toMatchObject({ locationStatus: "場所を特定済み" });
    const missing = previewItemEdit(
      source,
      "event",
      baseline,
      { ...baseline, number: "99" },
      { kind: "unchanged" },
    );
    expect(missing).toMatchObject({ locationStatus: "場所未解決" });
    expect(missing.details.join("\n")).toContain("番号セルが見つからない");
    source.mapData.event = {};
    source.eventConsistency.event.days["1日目"].selectedMapKey = null;
    expect(
      previewItemEdit(source, "event", baseline, baseline, {
        kind: "unchanged",
      }),
    ).toMatchObject({ locationStatus: "マップなし" });
  });
});

describe("definition confirmation across dependent contexts", () => {
  it.each(["dependent-day", "hidden-map"] as const)(
    "reconfirms %s visit results even outside the displayed context",
    async (scope) => {
      const source = makeSource();
      const editedId = scope === "dependent-day" ? "c" : "a";
      if (scope === "dependent-day") {
        source.eventLists.event.push({
          ...(source.eventLists.event[0] as ShoppingItem),
          id: "c",
          eventDate: "１日目",
        });
        source.executeModeItems.event["１日目"] = ["c"];
        const dependent = createVisitContext();
        dependent.hallOrder = structuredClone(context(source).hallOrder);
        dependent.hallVisitLists = [
          { group: dependent.hallOrder[0], itemIds: ["c"] },
        ];
        source.eventConsistency.event.days["１日目"] = {
          ...createDayConsistency(),
          selectedMapKey: mapKey,
          maps: { [mapKey]: dependent },
        };
      } else {
        source.mapData.event["１日目マップ"] = structuredClone(
          source.mapData.event[mapKey],
        );
        source.hallDefinitions.event["１日目マップ"] = structuredClone(
          source.hallDefinitions.event[mapKey],
        );
        source.eventConsistency.event.days["1日目"].maps["１日目マップ"] =
          createVisitContext();
        source.eventConsistency.event.days["1日目"].selectedMapKey =
          "１日目マップ";
      }
      const session = coordinatorFor(source);
      const first = await session.coordinator.request({
        id: "definition",
        events: ["event"],
        plan: definitionPlan,
      });
      if (first.status !== "confirmation-required")
        throw new Error("missing confirmation");
      const edited = (
        session.current().eventLists.event as ShoppingItem[]
      ).find((item) => item.id === editedId)!;
      edited.priorityLevel = "highest";
      const next = await session.coordinator.confirm(first.token);
      expect(next.status).toBe("confirmation-required");
      expect(session.commits()).toBe(0);
      if (next.status !== "confirmation-required") return;
      expect(next.confirmation.details.join("\n")).toContain("最優先");
      expect((await session.coordinator.confirm(next.token)).status).toBe(
        "committed",
      );
      const day = scope === "dependent-day" ? "１日目" : "1日目";
      expect(
        session.current().eventConsistency.event.days[day].maps[mapKey]
          .hallVisitLists,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            group: expect.objectContaining({ priority: "highest" }),
            itemIds: [editedId],
          }),
        ]),
      );
      valid(session.current());
    },
  );
  it("reconfirms simple-hall definition changes with mapless visit results", async () => {
    const source = makeSource();
    source.mapData.event = {};
    source.hallDefinitions.event = {
      "__mapless__:1日目": [
        { id: "hall", name: "東館", vertices: [], blockNames: ["A"] },
      ],
    };
    const visits = context(source);
    const group = {
      hall: { kind: "simple" as const, dayKey: "1日目", hallId: "hall" },
      priority: "none" as const,
    };
    visits.hallOrder = [group];
    visits.hallVisitLists = visits.hallVisitLists.map((list) => ({
      ...list,
      group,
    }));
    visits.route = null;
    source.eventConsistency.event.days["1日目"] = {
      ...createDayConsistency(),
      mapless: visits,
    };
    const session = coordinatorFor(source);
    const first = await session.coordinator.request({
      id: "definition",
      events: ["event"],
      plan: (latest) => {
        const definitions = structuredClone(latest.hallDefinitions);
        (definitions.event["__mapless__:1日目"] as { name: string }[])[0].name =
          "変更後の東館";
        return planProjectedMutation(
          latest,
          { hallDefinitions: definitions },
          { eventName: "event", day: "1日目" },
        );
      },
    });
    if (first.status !== "confirmation-required")
      throw new Error("missing confirmation");
    (session.current().eventLists.event[0] as ShoppingItem).priorityLevel =
      "highest";
    const next = await session.coordinator.confirm(first.token);
    expect(next.status).toBe("confirmation-required");
    expect(session.commits()).toBe(0);
    if (next.status !== "confirmation-required") return;
    expect(next.confirmation.details.join("\n")).toContain(
      "変更後の東館（最優先）",
    );
    expect((await session.coordinator.confirm(next.token)).status).toBe(
      "committed",
    );
    valid(session.current());
  });
});

it("keeps distinct legacy IDs with their split lists rather than duplicating the first", () => {
  const source = makeSource();
  context(source).hallVisitLists[0].legacyHallId = "hall:custom";
  context(source).hallOrder.push({ hall: null, priority: "none" });
  const projected = projectConsistencySnapshot(source, "event", "1日目");
  const settings = structuredClone(projected.hallRouteSettings) as Record<
    string,
    Record<string, HallRouteSettings>
  >;
  settings.event[mapKey].hallOrder.reverse();
  const plan = planProjectedMutation(
    source,
    { hallRouteSettings: settings },
    { eventName: "event", day: "1日目" },
  );
  expect(
    context(plan.snapshot).hallVisitLists.map((list) => list.legacyHallId),
  ).toEqual(["hall:custom", "hall"]);
  valid(plan.snapshot);
});

it("updates the location preview after a duplicate definition is corrected without changing the item", () => {
  const source = makeSource();
  const map = source.mapData.event[mapKey] as DayMapData;
  map.blocks.push({
    ...map.blocks[0],
    numberCells: [{ row: 6, col: 6, value: 1 }],
  });
  const original = structuredClone(source.eventLists.event[0]) as ShoppingItem;
  expect(
    previewItemEdit(source, "event", original, original, { kind: "unchanged" }),
  ).toMatchObject({ locationStatus: "場所未解決" });
  map.blocks.pop();
  const resolved = previewItemEdit(source, "event", original, original, {
    kind: "unchanged",
  });
  expect(resolved).toMatchObject({
    status: "自動判定",
    locationStatus: "場所を特定済み",
  });
  expect(resolved.details.join("\n")).not.toContain("異なる位置");
  expect(source.eventLists.event[0]).toEqual(original);
});

it("retains sparse legacy metadata after hall-order save through a full Excel roundtrip", async () => {
  const source = makeSource();
  context(source).hallOrder.push({ hall: null, priority: "none" });
  const settings = structuredClone(
    projectConsistencySnapshot(source, "event", "1日目").hallRouteSettings,
  ) as Record<string, Record<string, HallRouteSettings>>;
  settings.event[mapKey].hallOrder.reverse();
  const saved = planProjectedMutation(
    source,
    { hallRouteSettings: settings },
    { eventName: "event", day: "1日目" },
  ).snapshot;
  const blob = await exportToXlsx(
    "event",
    saved.eventLists.event as ShoppingItem[],
    {
      format: "full",
      includeItems: true,
      includeLayoutInfo: true,
      includeMapData: true,
      includeRouteInfo: true,
    },
    {
      ...saved,
      metadata: saved.eventMetadata.event,
    } as EventWorkbookAdditionalData,
  );
  const restored = await importFromXlsx(new File([blob], "split-legacy.xlsx"));
  expect(restored.success).toBe(true);
  expect(restored.errors).toEqual([]);
  expect(
    restored.eventConsistency?.days["1日目"].maps[mapKey].hallVisitLists,
  ).toEqual(context(saved).hallVisitLists);
  expect(restored.items).toMatchObject(saved.eventLists.event);
});

describe("map selection before item edits (I06-I08 / R16)", () => {
  const ambiguousSource = () => {
    const source = makeSource();
    const original = context(source);
    const day = source.eventConsistency.event.days["1日目"];
    day.selectedMapKey = null;
    for (const key of ["1 日目マップ", "１日目マップ"]) {
      source.mapData.event[key] = structuredClone(source.mapData.event[mapKey]);
      source.hallDefinitions.event[key] = structuredClone(
        source.hallDefinitions.event[mapKey],
      );
      const hall = { kind: "map" as const, mapKey: key, hallId: "hall" };
      day.maps[key] = {
        ...structuredClone(original),
        assignments: { a: hall, b: hall },
        hallOrder: original.hallOrder.map((group) => ({ ...group, hall })),
        hallVisitLists: original.hallVisitLists.map((list) => ({
          ...structuredClone(list),
          group: { ...list.group, hall },
        })),
      };
    }
    delete source.mapData.event[mapKey];
    delete source.hallDefinitions.event[mapKey];
    delete day.maps[mapKey];
    return source;
  };

  it.each([
    { number: "2" },
    { block: "B" },
    { eventDate: " 1日目　" },
    { priorityLevel: "highest" as const },
    { remarks: "編集中のメモ" },
  ])(
    "rejects an unselected dialog edit %j without changing either map",
    (patch) => {
      const source = ambiguousSource();
      const before = structuredClone(source);
      const baseline = source.eventLists.event[0] as ShoppingItem;
      const edited = { ...baseline, ...patch };
      expect(() =>
        planItemEdit(source, "event", baseline, edited, { kind: "unchanged" }),
      ).toThrow("利用するマップを選択");
      expect(
        previewItemEdit(source, "event", baseline, edited, {
          kind: "unchanged",
        }),
      ).toMatchObject({
        mapSelectionRequired: true,
        locationStatus: "マップ選択待ち",
      });
      expect(source).toEqual(before);
      valid(source);
    },
  );

  it.each(["identity", "priority", "automatic", "select"] as const)(
    "rejects %s through the shared mutation path before updating visits",
    (operation) => {
      const source = ambiguousSource();
      const before = structuredClone(source);
      const items = structuredClone(source.eventLists.event) as ShoppingItem[];
      if (operation === "identity") items[0].number = "2";
      if (operation === "priority") items[0].priorityLevel = "highest";
      const selection =
        operation === "automatic"
          ? { itemId: "a", intent: { kind: "automatic" as const } }
          : operation === "select"
            ? {
                itemId: "a",
                intent: {
                  kind: "select" as const,
                  hall: {
                    kind: "map" as const,
                    mapKey: "1 日目マップ",
                    hallId: "hall",
                  },
                },
              }
            : undefined;
      expect(() =>
        planProjectedMutation(
          source,
          { eventLists: { event: items } },
          {
            eventName: "event",
            day: "1日目",
            selection,
          },
        ),
      ).toThrow("利用するマップを選択");
      expect(source).toEqual(before);
    },
  );

  it("keeps direct purchase updates available and every map context intact", () => {
    const source = ambiguousSource();
    const items = structuredClone(source.eventLists.event) as ShoppingItem[];
    items[0].purchaseStatus = "Purchased";
    items[0].price = 900;
    const plan = planProjectedMutation(
      source,
      { eventLists: { event: items } },
      {
        eventName: "event",
        day: "1日目",
      },
    );
    expect(plan.snapshot.eventConsistency).toEqual(source.eventConsistency);
    expect(plan.snapshot.eventLists.event[0]).toMatchObject({
      purchaseStatus: "Purchased",
      price: 900,
    });
    valid(plan.snapshot);
  });

  it("accepts a saved selection and still checks changes across both maps", () => {
    const source = ambiguousSource();
    source.eventConsistency.event.days["1日目"].selectedMapKey = "1 日目マップ";
    const baseline = source.eventLists.event[0] as ShoppingItem;
    const edited = {
      ...baseline,
      number: "2",
      priorityLevel: "highest" as const,
    };
    const preview = previewItemEdit(source, "event", baseline, edited, {
      kind: "unchanged",
    });
    expect(preview.mapSelectionRequired).toBe(false);
    const plan = planItemEdit(source, "event", baseline, edited, {
      kind: "unchanged",
    });
    for (const key of ["1 日目マップ", "１日目マップ"]) {
      expect(plan.confirmation?.details.join("\n")).toContain(key);
      expect(
        plan.snapshot.eventConsistency.event.days["1日目"].maps[key].assignments
          .b,
      ).toEqual(
        source.eventConsistency.event.days["1日目"].maps[key].assignments.b,
      );
    }
    valid(plan.snapshot);
  });

  it("rejects a saved selection that disappeared even when one candidate remains", () => {
    const source = ambiguousSource();
    source.eventConsistency.event.days["1日目"].selectedMapKey =
      "削除済みマップ";
    delete source.mapData.event["１日目マップ"];
    const baseline = source.eventLists.event[0] as ShoppingItem;
    expect(() =>
      planItemEdit(
        source,
        "event",
        baseline,
        { ...baseline, number: "2" },
        { kind: "unchanged" },
      ),
    ).toThrow("利用するマップを選択");
  });

  it("requires selection on the destination day before moving an item", () => {
    const source = makeSource();
    for (const key of ["2 日目マップ", "２日目マップ"])
      source.mapData.event[key] = structuredClone(source.mapData.event[mapKey]);
    const baseline = source.eventLists.event[0] as ShoppingItem;
    const edited = {
      ...baseline,
      eventDate: "2日目",
      number: "2",
      priorityLevel: "highest" as const,
    };
    expect(() =>
      planItemEdit(source, "event", baseline, edited, { kind: "unchanged" }),
    ).toThrow("利用するマップを選択");
    expect(
      previewItemEdit(source, "event", baseline, edited, { kind: "unchanged" })
        .mapSelectionRequired,
    ).toBe(true);
  });

  it("stops an already confirmed edit when its map selection becomes invalid before saving", async () => {
    const source = ambiguousSource();
    source.eventConsistency.event.days["1日目"].selectedMapKey = "1 日目マップ";
    const session = coordinatorFor(source);
    const baseline = source.eventLists.event[0] as ShoppingItem;
    const first = await session.coordinator.request({
      id: "edit-before-map-invalidates",
      events: ["event"],
      plan: (latest) =>
        planItemEdit(
          latest,
          "event",
          baseline,
          { ...baseline, number: "2" },
          { kind: "unchanged" },
        ),
    });
    if (first.status !== "confirmation-required")
      throw new Error("Expected edit confirmation");
    session.current().eventConsistency.event.days["1日目"].selectedMapKey =
      "削除済みマップ";
    const latest = structuredClone(session.current());
    await expect(session.coordinator.confirm(first.token)).rejects.toThrow(
      "利用するマップを選択",
    );
    expect(session.commits()).toBe(0);
    expect(session.current()).toEqual(latest);
  });
});

describe("R28/R34 item moves compare every source and destination context", () => {
  const hiddenMapKey = "１日目マップ";
  const destinationMapKey = "2日目マップ";
  const hiddenDestinationMapKey = "２日目マップ";
  const moveSource = (mapless = false) => {
    const source = makeSource();
    (source.eventLists.event[1] as ShoppingItem).number = "1";
    source.eventLists.event.push({
      ...(source.eventLists.event[0] as ShoppingItem),
      id: "c",
      eventDate: "2日目",
    });
    source.executeModeItems.event["2日目"] = ["c"];
    const day = source.eventConsistency.event.days["1日目"];
    for (const key of [
      mapKey,
      hiddenMapKey,
      destinationMapKey,
      hiddenDestinationMapKey,
    ]) {
      source.mapData.event[key] = structuredClone(source.mapData.event[mapKey]);
      const halls = structuredClone(
        source.hallDefinitions.event[mapKey],
      ) as Array<{
        id: string;
        name: string;
        vertices: Array<{ row: number; col: number }>;
      }>;
      source.hallDefinitions.event[key] = [
        halls[0],
        { ...halls[0], id: "west", name: "西館" },
      ];
      const hall = { kind: "map" as const, mapKey: key, hallId: "hall" };
      const visits = structuredClone(context(source));
      visits.assignments = { a: hall, b: hall };
      visits.hallOrder = [{ hall, priority: "none" }];
      visits.hallVisitLists = [
        { group: visits.hallOrder[0], itemIds: ["a", "b"] },
      ];
      if (key === mapKey || key === hiddenMapKey) day.maps[key] = visits;
      else {
        visits.assignments = { c: hall };
        visits.hallVisitLists[0].itemIds = ["c"];
        visits.route!.visitOrder = [
          { ...visits.route!.visitOrder[0], itemIds: ["c"] },
        ];
        const destination = (source.eventConsistency.event.days["2日目"] ??=
          createDayConsistency());
        destination.selectedMapKey = destinationMapKey;
        destination.maps[key] = visits;
      }
    }
    if (mapless) {
      const hall = { kind: "simple" as const, dayKey: "1日目", hallId: "hall" };
      const visits = structuredClone(context(source));
      visits.assignments = { a: hall, b: hall };
      visits.hallOrder = [{ hall, priority: "none" }];
      visits.hallVisitLists = [
        { group: visits.hallOrder[0], itemIds: ["a", "b"] },
      ];
      visits.route = null;
      day.mapless = visits;
      day.maps = {};
      day.selectedMapKey = null;
      delete source.mapData.event[mapKey];
      delete source.mapData.event[hiddenMapKey];
      delete source.hallDefinitions.event[mapKey];
      delete source.hallDefinitions.event[hiddenMapKey];
      source.hallDefinitions.event["__mapless__:1日目"] = [
        { id: "hall", name: "東館", vertices: [], blockNames: ["A"] },
        { id: "west", name: "西館", vertices: [], blockNames: ["A"] },
      ];
    }
    valid(source);
    return source;
  };
  const moveIntent = (source: PersistenceSnapshot) => {
    const baseline = structuredClone(
      source.eventLists.event[0],
    ) as ShoppingItem;
    return {
      id: "move-between-days",
      events: ["event"],
      plan: (latest: PersistenceSnapshot) =>
        planItemEdit(
          latest,
          "event",
          baseline,
          { ...baseline, eventDate: "2日目" },
          { kind: "unchanged" },
        ),
    };
  };

  it.each(["selected-map", "hidden-map", "mapless"] as const)(
    "reconfirms a changed %s source assignment even when the final move is identical",
    async (scope) => {
      const source = moveSource(scope === "mapless");
      const session = coordinatorFor(source);
      const intent = moveIntent(source);
      const first = await session.coordinator.request(intent);
      if (first.status !== "confirmation-required")
        throw new Error("missing move confirmation");
      const previousResult = intent.plan(source).snapshot;
      const day = session.current().eventConsistency.event.days["1日目"];
      const visits =
        scope === "mapless"
          ? day.mapless!
          : day.maps[scope === "hidden-map" ? hiddenMapKey : mapKey];
      visits.assignments.a = { ...visits.assignments.a, hallId: "west" };
      expect(intent.plan(session.current()).snapshot).toEqual(previousResult);
      const latest = structuredClone(session.current());
      const renewed = await session.coordinator.confirm(first.token);
      expect(renewed.status).toBe("confirmation-required");
      expect(session.commits()).toBe(0);
      expect(session.current()).toEqual(latest);
      if (renewed.status !== "confirmation-required")
        throw new Error("missing source reconfirmation");
      expect(renewed.token.signature).not.toBe(first.token.signature);
      expect(renewed.confirmation.details.join("\n")).toContain(
        "西館 → 指定解除",
      );
      expect(renewed.confirmation.details.join("\n")).toContain(
        scope === "mapless"
          ? "1日目 / マップなし"
          : scope === "hidden-map"
            ? hiddenMapKey
            : mapKey,
      );
      expect((await session.coordinator.confirm(first.token)).status).toBe(
        "expired",
      );
      expect((await session.coordinator.confirm(renewed.token)).status).toBe(
        "committed",
      );
      expect(session.commits()).toBe(1);
      const saved = session.current();
      expect(saved.eventLists.event[0]).toMatchObject({ eventDate: "2日目" });
      const oldDay = saved.eventConsistency.event.days["1日目"];
      for (const visit of [
        ...Object.values(oldDay.maps),
        ...(oldDay.mapless ? [oldDay.mapless] : []),
      ]) {
        expect(visit.assignments.a).toBeUndefined();
        expect(visit.assignments.b).toMatchObject({ hallId: "hall" });
        expect(
          visit.hallVisitLists.flatMap((list) => list.itemIds),
        ).not.toContain("a");
        expect(
          visit.route?.visitOrder.flatMap((point) => point.itemIds) ?? [],
        ).not.toContain("a");
      }
      for (const key of [destinationMapKey, hiddenDestinationMapKey]) {
        const visit = saved.eventConsistency.event.days["2日目"].maps[key];
        expect(visit.assignments.a).toEqual(visit.assignments.c);
        expect(visit.hallVisitLists.flatMap((list) => list.itemIds)).toContain(
          "a",
        );
      }
      valid(saved);
      const restored = parseAppBackup(
        serializeAppBackup(createAppBackup(saved)),
      );
      expect(restored.ok).toBe(true);
      if (restored.ok)
        expect(restored.data.eventConsistency).toEqual(saved.eventConsistency);
    },
  );

  it.each([destinationMapKey, hiddenDestinationMapKey])(
    "reconfirms a changed destination assignment in %s",
    async (key) => {
      const source = moveSource();
      const session = coordinatorFor(source);
      const first = await session.coordinator.request(moveIntent(source));
      if (first.status !== "confirmation-required")
        throw new Error("missing move confirmation");
      const visits =
        session.current().eventConsistency.event.days["2日目"].maps[key];
      visits.assignments.c = { ...visits.assignments.c, hallId: "west" };
      const renewed = await session.coordinator.confirm(first.token);
      expect(renewed.status).toBe("confirmation-required");
      expect(session.commits()).toBe(0);
      if (renewed.status !== "confirmation-required")
        throw new Error("missing destination reconfirmation");
      expect((await session.coordinator.confirm(renewed.token)).status).toBe(
        "committed",
      );
      expect(
        session.current().eventConsistency.event.days["2日目"].maps[key]
          .assignments.a,
      ).toMatchObject({ hallId: "west" });
      valid(session.current());
    },
  );

  it("preserves purchases, memos and unrelated day settings without asking again", async () => {
    const source = moveSource();
    source.eventConsistency.event.days["3日目"] = {
      ...createDayConsistency(),
      mapless: createVisitContext(),
    };
    const session = coordinatorFor(source);
    const first = await session.coordinator.request(moveIntent(source));
    if (first.status !== "confirmation-required")
      throw new Error("missing move confirmation");
    Object.assign(session.current().eventLists.event[0] as ShoppingItem, {
      purchaseStatus: "Purchased",
      price: 900,
      quantity: 2,
      remarks: "確認中のメモ",
    });
    session
      .current()
      .eventConsistency.event.days[
        "3日目"
      ].mapless!.hallOrder.push({ hall: null, priority: "highest" });
    expect((await session.coordinator.confirm(first.token)).status).toBe(
      "committed",
    );
    expect(session.current().eventLists.event[0]).toMatchObject({
      eventDate: "2日目",
      purchaseStatus: "Purchased",
      price: 900,
      quantity: 2,
      remarks: "確認中のメモ",
    });
    expect(
      session.current().eventConsistency.event.days["3日目"].mapless!.hallOrder,
    ).toEqual([{ hall: null, priority: "highest" }]);
    valid(session.current());
  });

  it("keeps the latest source assignment when saving the renewed move fails", async () => {
    const source = moveSource();
    const session = coordinatorFor(source, new Error("エラーが発生しました"));
    const first = await session.coordinator.request(moveIntent(source));
    if (first.status !== "confirmation-required")
      throw new Error("missing move confirmation");
    const visits =
      session.current().eventConsistency.event.days["1日目"].maps[hiddenMapKey];
    visits.assignments.a = { ...visits.assignments.a, hallId: "west" };
    const latest = structuredClone(session.current());
    const renewed = await session.coordinator.confirm(first.token);
    if (renewed.status !== "confirmation-required")
      throw new Error("missing reconfirmation");
    await expect(session.coordinator.confirm(renewed.token)).rejects.toThrow(
      "エラーが発生しました",
    );
    expect(session.commits()).toBe(0);
    expect(session.current()).toEqual(latest);
  });

  it("keeps an explicit hall selection scoped to its map while retaining another map's update", async () => {
    const source = moveSource();
    const baseline = structuredClone(
      source.eventLists.event[0],
    ) as ShoppingItem;
    const session = coordinatorFor(source);
    const first = await session.coordinator.request({
      id: "select-hall-in-current-map",
      events: ["event"],
      plan: (latest) =>
        planItemEdit(latest, "event", baseline, baseline, {
          kind: "select",
          hall: { kind: "map", mapKey, hallId: "west" },
        }),
    });
    if (first.status !== "confirmation-required")
      throw new Error("missing hall confirmation");
    const hidden =
      session.current().eventConsistency.event.days["1日目"].maps[hiddenMapKey];
    hidden.assignments.a = { ...hidden.assignments.a, hallId: "west" };
    const unchangedHidden = structuredClone(hidden);
    expect((await session.coordinator.confirm(first.token)).status).toBe(
      "committed",
    );
    expect(
      session.current().eventConsistency.event.days["1日目"].maps[hiddenMapKey],
    ).toEqual(unchangedHidden);
    for (const id of ["a", "b"])
      expect(context(session.current()).assignments[id]).toMatchObject({
        hallId: "west",
      });
    valid(session.current());
  });
  it("keeps an intervening source choice after cancellation", async () => {
    const source = moveSource();
    const session = coordinatorFor(source);
    const first = await session.coordinator.request(moveIntent(source));
    if (first.status !== "confirmation-required")
      throw new Error("missing move confirmation");
    const visits =
      session.current().eventConsistency.event.days["1日目"].maps[hiddenMapKey];
    visits.assignments.a = { ...visits.assignments.a, hallId: "west" };
    const latest = structuredClone(session.current());
    const renewed = await session.coordinator.confirm(first.token);
    if (renewed.status !== "confirmation-required")
      throw new Error("missing reconfirmation");
    expect(session.coordinator.cancel(renewed.token)).toBe(true);
    expect((await session.coordinator.confirm(renewed.token)).status).toBe(
      "expired",
    );
    expect(session.commits()).toBe(0);
    expect(session.current()).toEqual(latest);
  });
});
