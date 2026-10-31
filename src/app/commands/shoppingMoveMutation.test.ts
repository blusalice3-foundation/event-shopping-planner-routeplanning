import { ensureDayConsistency } from "../../features/consistency/domain/context";
import { describe, expect, it, vi } from "vitest";
import type {
  PersistenceSnapshot,
  ApplicationShoppingMove,
} from "../ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../types/item";
import { createEventConsistency } from "../../types/consistency";
import {
  projectConsistencySnapshot,
  encodeHallRef,
} from "../../features/consistency/domain/projection";
import {
  planProjectedMutation,
  planShoppingOrderMutation,
} from "../../features/consistency/domain/mutations";
import {
  planShoppingMove,
  shoppingMoveVisitBaseline,
  shoppingMovePlacementBaseline,
  ShoppingPlacementChangedError,
} from "./shoppingMoveMutation";

const day = "1日目";
const item = (id: string, number: string): ShoppingItem => ({
  id,
  number,
  block: "A",
  circle: id,
  title: "ユーザー登録",
  eventDate: day,
  quantity: 2,
  price: 900,
  purchaseStatus: "None",
  remarks: "エラーが発生しました",
  url: undefined,
  sheetRemarks: "元のメモ",
  sheetIdentityVerified: false,
});
function fixture(): PersistenceSnapshot {
  return {
    eventLists: {
      event: [item("a", "01a"), item("b", "02a")],
      history: [item("past", "03a")],
    },
    eventMetadata: {},
    executeModeItems: { event: { [day]: ["a"] } },
    dayModes: { event: { [day]: "edit" } },
    mapData: {},
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallDefinitions: {},
    hallRouteSettings: {},
    eventConsistency: {
      event: createEventConsistency(),
      history: createEventConsistency(),
    },
  };
}
function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.values(value).forEach(freeze);
  Object.freeze(value);
}
function command(
  source: PersistenceSnapshot,
  reverse: boolean,
): ApplicationShoppingMove {
  const ids = (source.eventLists.event as ShoppingItem[]).map(
    (entry) => entry.id,
  );
  return {
    version: 1,
    eventName: "event",
    day,
    sourceColumn: reverse ? "execute" : "candidate",
    targetColumn: reverse ? "candidate" : "execute",
    requestedIds: [reverse ? "a" : "b"],
    effectiveIds: [reverse ? "a" : "b"],
    hoverId: reverse ? "b" : "a",
    baselineItemIds: ids,
    itemIds: reverse ? ["b", "a"] : ids,
    baselineExecuteIds: ["a"],
    executeIds: reverse ? [] : ["a", "b"],
    baselineVisits: shoppingMoveVisitBaseline(source, "event", day),
  };
}
const context = { eventName: "event", day };
function orderPlan(
  source: PersistenceSnapshot,
  share = false,
  patch = {
    executeModeItems: { event: { [day]: ["a", "b"] } },
  },
) {
  return planShoppingOrderMutation(
    source,
    patch,
    context,
    {},
    projectConsistencySnapshot(source, "event", day),
    share,
  );
}

describe("shopping move read-only planner items", () => {
  it.each([false, true])(
    "keeps immutable input and original returned item objects (reverse=%s)",
    (reverse) => {
      const source = fixture();
      const original = structuredClone(source);
      const input = command(source, reverse);
      freeze(source);
      const plan = planShoppingMove(source, input);
      expect(source).toEqual(original);
      const current = source.eventLists.event as ShoppingItem[];
      expect(plan.snapshot.eventLists.event).toEqual(
        reverse ? [current[1], current[0]] : current,
      );
      expect(plan.snapshot.eventLists.event[0]).toBe(current[reverse ? 1 : 0]);
      expect(plan.snapshot.eventLists.history).toBe(source.eventLists.history);
      expect(
        plan.snapshot.eventLists.event.every((entry) =>
          Object.prototype.hasOwnProperty.call(entry, "url"),
        ),
      ).toBe(true);
      expect(plan.snapshot.executeModeItems.event[day]).toEqual(
        input.executeIds,
      );
      expect(plan.snapshot.eventLists.event[0]).toMatchObject({
        sheetRemarks: "元のメモ",
        sheetIdentityVerified: false,
      });
    },
  );

  it("omits exactly the discarded item-bearing planner clone while preserving its result", () => {
    const source = fixture();
    freeze(source);
    const clone = vi.spyOn(globalThis, "structuredClone");
    try {
      const publicPlan = orderPlan(source);
      const publicItemClones = clone.mock.calls.filter(
        ([value]) =>
          value &&
          typeof value === "object" &&
          "eventLists" in value &&
          Object.keys(value.eventLists as object).length > 0,
      ).length;
      clone.mockClear();
      const privatePlan = orderPlan(source, true);
      const privateItemClones = clone.mock.calls.filter(
        ([value]) =>
          value &&
          typeof value === "object" &&
          "eventLists" in value &&
          Object.keys(value.eventLists as object).length > 0,
      ).length;
      expect(privateItemClones).toBe(publicItemClones - 1);
      expect(privatePlan).toEqual(publicPlan);
      expect(publicPlan.snapshot.eventLists.event[0]).not.toBe(
        source.eventLists.event[0],
      );
    } finally {
      clone.mockRestore();
    }
  });

  it("retains canonical manual hall copies and confirmation without changing frozen items", () => {
    const source = fixture();
    source.hallDefinitions.event = {
      [`__mapless__:${day}`]: [
        { id: "east", name: "東館", blockNames: ["A"], vertices: [] },
        { id: "west", name: "西館", blockNames: ["A"], vertices: [] },
      ],
    };
    const projection = projectConsistencySnapshot(source, "event", day);
    const patch = {
      eventLists: {
        event: (projection.eventLists.event as ShoppingItem[]).map((entry) =>
          entry.id === "b"
            ? {
                ...entry,
                manualHallId: encodeHallRef({
                  kind: "simple",
                  dayKey: day,
                  hallId: "east",
                }),
              }
            : entry,
        ),
      },
    };
    const original = structuredClone(source);
    freeze(source);
    freeze(patch);
    const publicPlan = planShoppingOrderMutation(
      source,
      patch,
      context,
      {},
      projection,
    );
    const privatePlan = planShoppingOrderMutation(
      source,
      patch,
      context,
      {},
      projection,
      true,
    );
    expect(privatePlan).toEqual(publicPlan);
    expect(privatePlan.confirmation).toBeDefined();
    expect(
      privatePlan.snapshot.eventLists.event.every(
        (entry) => !Object.prototype.hasOwnProperty.call(entry, "manualHallId"),
      ),
    ).toBe(true);
    expect(privatePlan.snapshot.eventLists.event[1]).not.toBe(
      source.eventLists.event[1],
    );
    expect(source).toEqual(original);
    expect(patch.eventLists.event[1].manualHallId).toContain("east");
  });

  it("keeps the duplicate-day merge on the isolated general path", () => {
    const source = fixture();
    source.executeModeItems.event[" 1日目 "] = ["a"];
    source.dayModes.event[" 1日目 "] = "edit";
    const original = structuredClone(source);
    freeze(source);
    const publicPlan = orderPlan(source);
    const privatePlan = orderPlan(source, true);
    expect(privatePlan).toEqual(publicPlan);
    expect(privatePlan.confirmation).toBeDefined();
    expect(privatePlan.snapshot.eventLists.event[0]).not.toBe(
      source.eventLists.event[0],
    );
    expect(source).toEqual(original);
  });

  it("preserves general and default shopping planner output isolation", () => {
    const source = fixture();
    for (const plan of [
      planProjectedMutation(source, {}, context),
      orderPlan(source),
    ]) {
      const changed = plan.snapshot.eventLists.event[0] as ShoppingItem;
      changed.remarks = "結果だけの変更";
      expect((source.eventLists.event[0] as ShoppingItem).remarks).toBe(
        "エラーが発生しました",
      );
      expect(changed).not.toBe(source.eventLists.event[0]);
    }
  });
});

describe("frozen placement dependencies", () => {
  function frozen(source: PersistenceSnapshot): ApplicationShoppingMove {
    const input = command(source, false);
    input.placementBaseline = shoppingMovePlacementBaseline(source, input);
    return input;
  }
  it("keeps latest purchase fields and ignores an unrelated candidate priority", () => {
    const source = fixture();
    (source.eventLists.event as ShoppingItem[]).push(item("unrelated", "99a"));
    const input = frozen(source);
    const current = structuredClone(source);
    Object.assign(current.eventLists.event[1] as ShoppingItem, {
      quantity: 9,
      price: 1234,
      remarks: "最新のメモ",
    });
    (current.eventLists.event[2] as ShoppingItem).priorityLevel = "priority";
    const plan = planShoppingMove(current, input);
    expect(plan.confirmation).toBeUndefined();
    expect(plan.snapshot.executeModeItems.event[day]).toEqual(["a", "b"]);
    expect(plan.snapshot.eventLists.event[1]).toMatchObject({
      quantity: 9,
      price: 1234,
      remarks: "最新のメモ",
    });
    expect(plan.snapshot.eventLists.event[2]).toBe(current.eventLists.event[2]);
  });
  it("aborts a changed source placement without a confirmation alternative", () => {
    const source = fixture();
    const input = frozen(source);
    const current = structuredClone(source);
    (current.eventLists.event[1] as ShoppingItem).priorityLevel = "priority";
    expect(() => planShoppingMove(current, input)).toThrow(
      ShoppingPlacementChangedError,
    );
  });
  it("aborts when the destination visit changes", () => {
    const source = fixture();
    const input = frozen(source);
    const current = structuredClone(source);
    (current.eventLists.event[0] as ShoppingItem).number = "03a";
    expect(() => planShoppingMove(current, input)).toThrow(
      ShoppingPlacementChangedError,
    );
  });
  it("detects a resolved hall change even when space and priority stay unchanged", () => {
    const source = fixture();
    source.hallDefinitions.event = {
      [`__mapless__:${day}`]: [
        { id: "east", name: "東館", blockNames: ["A"], vertices: [] },
      ],
    };
    const input = frozen(source);
    const current = structuredClone(source);
    current.hallDefinitions.event = {
      [`__mapless__:${day}`]: [
        { id: "west", name: "西館", blockNames: ["A"], vertices: [] },
      ],
    };
    expect(() => planShoppingMove(current, input)).toThrow(
      ShoppingPlacementChangedError,
    );
  });
  it("preserves unrelated item insertions and deletions", () => {
    const source = fixture();
    (source.eventLists.event as ShoppingItem[]).push(item("unrelated", "99a"));
    const input = frozen(source);
    const current = structuredClone(source);
    current.eventLists.event = [
      item("new", "98a"),
      ...current.eventLists.event.filter(
        (entry) => (entry as ShoppingItem).id !== "unrelated",
      ),
    ];
    const plan = planShoppingMove(current, input);
    expect(
      (plan.snapshot.eventLists.event as ShoppingItem[]).map(
        (entry) => entry.id,
      ),
    ).toEqual(["new", "a", "b"]);
    expect(plan.snapshot.executeModeItems.event[day]).toEqual(["a", "b"]);
  });
  it("aborts when a source visit gains an implicit member", () => {
    const source = fixture();
    const input = frozen(source);
    const current = structuredClone(source);
    (current.eventLists.event as ShoppingItem[]).push(
      item("new-member", "02a2"),
    );
    expect(() => planShoppingMove(current, input)).toThrow(
      ShoppingPlacementChangedError,
    );
  });
});

it("aborts when a hall-order change alters the destination group's neighboring groups", () => {
  const source = fixture();
  const west = { ...item("west", "03a"), block: "B" };
  (source.eventLists.event as ShoppingItem[]).push(west);
  source.executeModeItems.event[day] = ["a", "west"];
  source.hallDefinitions.event = {
    [`__mapless__:${day}`]: [
      { id: "east", name: "東館", blockNames: ["A"], vertices: [] },
      { id: "west", name: "西館", blockNames: ["B"], vertices: [] },
    ],
  };
  const input = command(source, false);
  input.baselineExecuteIds = ["a", "west"];
  input.executeIds = ["a", "b", "west"];
  input.placementBaseline = shoppingMovePlacementBaseline(source, input);
  const current = structuredClone(source);
  ensureDayConsistency(current.eventConsistency.event, day).mapless = {
    assignments: {},
    hallOrder: [
      {
        hall: { kind: "simple", dayKey: day, hallId: "west" },
        priority: "none",
      },
      {
        hall: { kind: "simple", dayKey: day, hallId: "east" },
        priority: "none",
      },
    ],
    hallVisitLists: [],
    route: null,
  };
  expect(() => planShoppingMove(current, input)).toThrow(
    ShoppingPlacementChangedError,
  );
});

it("saves a one-book reorder into the current visit's raw slots without losing its base position", () => {
  const source = fixture();
  (source.eventLists.event as ShoppingItem[]).push(
    item("a2", "01a2"),
    item("a3", "01a3"),
  );
  source.executeModeItems.event[day] = ["a", "b", "a2", "a3"];
  const input: ApplicationShoppingMove = {
    version: 1,
    eventName: "event",
    day,
    sourceColumn: "execute",
    targetColumn: "execute",
    requestedIds: ["a"],
    effectiveIds: ["a"],
    hoverId: "a3",
    reorderWithinVisit: true,
    baselineItemIds: ["a", "b", "a2", "a3"],
    itemIds: ["a", "b", "a2", "a3"],
    baselineExecuteIds: ["a", "b", "a2", "a3"],
    executeIds: ["a2", "b", "a", "a3"],
    baselineVisits: shoppingMoveVisitBaseline(source, "event", day),
  };
  input.placementBaseline = shoppingMovePlacementBaseline(source, input);
  const current = structuredClone(source);
  Object.assign(current.eventLists.event[0] as ShoppingItem, {
    quantity: 9,
    remarks: "保存待ち中の入力",
  });
  const result = planShoppingMove(current, input);
  expect(result.snapshot.executeModeItems.event[day]).toEqual([
    "a2",
    "b",
    "a",
    "a3",
  ]);
  expect(result.snapshot.eventLists.event[0]).toMatchObject({
    id: "a",
    quantity: 9,
    remarks: "保存待ち中の入力",
  });
  expect(result.snapshot.eventLists.event[1]).toBe(current.eventLists.event[1]);
});
