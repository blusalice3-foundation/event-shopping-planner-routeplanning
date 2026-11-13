import { createSheetIdentityFingerprint } from "../../utils/sheetIdentity";
import { dayMergeChoicePrefix } from "../../features/consistency/domain/dayMergeMutation";
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
  shoppingMoveInitialDayMergeSignature,
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
  sheetIdentityFingerprint: createSheetIdentityFingerprint(500, "元のメモ"),
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
        sheetIdentityFingerprint: createSheetIdentityFingerprint(
          500,
          "元のメモ",
        ),
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

describe("known initial day merge review", () => {
  function pendingReorder() {
    const source = fixture();
    (source.eventLists.event[1] as ShoppingItem).number = "01a2";
    (source.eventLists.event as ShoppingItem[]).push(item("unrelated", "99a"));
    source.executeModeItems.event[day] = ["a", "b"];
    source.dayModes.event[" 1日目 "] = "execute";
    const input: ApplicationShoppingMove = {
      version: 1,
      eventName: "event",
      day,
      sourceColumn: "execute",
      targetColumn: "execute",
      requestedIds: ["b"],
      effectiveIds: ["b"],
      hoverId: "a",
      reorderWithinVisit: true,
      baselineItemIds: ["a", "b", "unrelated"],
      itemIds: ["a", "b", "unrelated"],
      baselineExecuteIds: ["a", "b"],
      executeIds: ["b", "a"],
      baselineVisits: shoppingMoveVisitBaseline(source, "event", day),
      initialDayMergeSignature: shoppingMoveInitialDayMergeSignature(
        source,
        "event",
        day,
      ),
    };
    input.placementBaseline = shoppingMovePlacementBaseline(source, input);
    return { source, input };
  }
  it("retains the known duplicate-day review and its explicit destination and mode choices", () => {
    const { source, input } = pendingReorder();
    const review = planShoppingMove(source, input).confirmation;
    expect(review?.title).toContain("1日目 の保存先を統合");
    const prefix = dayMergeChoicePrefix("event", day);
    expect(review?.choices?.map((choice) => choice.id)).toEqual(
      expect.arrayContaining([`${prefix}destination`, `${prefix}mode`]),
    );
    const selected = planShoppingMove(source, input, {
      [`${prefix}destination`]: " 1日目 ",
      [`${prefix}mode`]: "execute",
    });
    expect(selected.confirmation?.title).toContain("1日目 の保存先を統合");
    expect(selected.snapshot.executeModeItems.event[" 1日目 "]).toEqual([
      "b",
      "a",
    ]);
    expect(selected.snapshot.dayModes.event).toEqual({ " 1日目 ": "execute" });
  });
  it("still aborts a newly appearing review instead of offering a new placement", () => {
    const { source, input } = pendingReorder();
    delete input.initialDayMergeSignature;
    expect(() => planShoppingMove(source, input)).toThrow(
      ShoppingPlacementChangedError,
    );
  });
  it("aborts if the initially known merge changes or disappears before saving", () => {
    const { source, input } = pendingReorder();
    for (const changed of ["changed", "resolved"] as const) {
      const latest = structuredClone(source);
      if (changed === "changed") latest.dayModes.event[" 1日目 "] = "focus";
      else delete latest.dayModes.event[" 1日目 "];
      expect(() => planShoppingMove(latest, input)).toThrow(
        ShoppingPlacementChangedError,
      );
    }
  });
  it("keeps latest quantity and memo changes while reviewing only the original day conflict", () => {
    const { source, input } = pendingReorder();
    Object.assign(source.eventLists.event[1] as ShoppingItem, {
      quantity: 8,
      price: 777,
      remarks: "確認待ち中の入力",
    });
    Object.assign(source.eventLists.event[2] as ShoppingItem, {
      quantity: 11,
      price: 1234,
      remarks: "無関係な候補の最新メモ",
    });
    const result = planShoppingMove(source, input);
    expect(result.confirmation?.title).toContain("1日目 の保存先を統合");
    expect(result.snapshot.eventLists.event[2]).toMatchObject({
      id: "unrelated",
      quantity: 11,
      price: 1234,
      remarks: "無関係な候補の最新メモ",
    });
    expect(result.snapshot.eventLists.event[1]).toMatchObject({
      id: "b",
      quantity: 8,
      price: 777,
      remarks: "確認待ち中の入力",
    });
  });
});

it("aborts the original day review when its execute order changes", () => {
  const source = fixture();
  (source.eventLists.event[1] as ShoppingItem).number = "01a2";
  source.dayModes.event[" 1日目 "] = "execute";
  const input = command(source, false);
  input.initialDayMergeSignature = shoppingMoveInitialDayMergeSignature(
    source,
    "event",
    day,
  );
  input.placementBaseline = shoppingMovePlacementBaseline(source, input);
  source.executeModeItems.event[day] = [];
  expect(() => planShoppingMove(source, input)).toThrow(
    ShoppingPlacementChangedError,
  );
});

describe("frozen candidate raw slots", () => {
  function reverseFixture() {
    const source = fixture();
    source.eventLists.event = [
      item("e1", "11a"),
      item("e2", "12a"),
      item("e3", "13a"),
      { ...item("another-day", "90a"), eventDate: "2日目" },
      item("c0", "90a"),
      item("e0", "01a"),
      item("c1", "100a"),
      item("c2", "200a"),
    ];
    source.executeModeItems.event[day] = ["e1", "e2", "e3"];
    return source;
  }
  function freezeCandidateMove(
    source: PersistenceSnapshot,
    sourceColumn: "execute" | "candidate",
    effectiveIds: string[],
    desired: string[],
    hoverId: string,
  ): ApplicationShoppingMove {
    const input: ApplicationShoppingMove = {
      version: 1,
      eventName: "event",
      day,
      sourceColumn,
      targetColumn: "candidate",
      requestedIds: effectiveIds,
      effectiveIds,
      hoverId,
      baselineItemIds: (source.eventLists.event as ShoppingItem[]).map(
        (value) => value.id,
      ),
      itemIds: desired,
      baselineExecuteIds: source.executeModeItems.event[day],
      executeIds: source.executeModeItems.event[day].filter(
        (id) => !effectiveIds.includes(id),
      ),
      baselineVisits: shoppingMoveVisitBaseline(source, "event", day),
    };
    input.placementBaseline = shoppingMovePlacementBaseline(source, input);
    return input;
  }

  it("fills moving and candidate slots while keeping remaining execution and other-day slots", () => {
    const source = reverseFixture();
    const input = freezeCandidateMove(
      source,
      "execute",
      ["e1", "e2"],
      ["c0", "e0", "e3", "another-day", "e1", "e2", "c1", "c2"],
      "c1",
    );
    const result = planShoppingMove(source, input);
    expect(
      (result.snapshot.eventLists.event as ShoppingItem[]).map(
        (value) => value.id,
      ),
    ).toEqual(["c0", "e0", "e3", "another-day", "e1", "e2", "c1", "c2"]);
    expect(result.snapshot.executeModeItems.event[day]).toEqual(["e3"]);
  });

  it("reorders candidate slots without moving an interleaved execution item", () => {
    const source = fixture();
    source.eventLists.event = [
      item("c0", "90a"),
      item("e0", "01a"),
      item("c1", "100a"),
    ];
    source.executeModeItems.event[day] = ["e0"];
    const input = freezeCandidateMove(
      source,
      "candidate",
      ["c1"],
      ["c1", "e0", "c0"],
      "c0",
    );
    const result = planShoppingMove(source, input);
    expect(
      (result.snapshot.eventLists.event as ShoppingItem[]).map(
        (value) => value.id,
      ),
    ).toEqual(["c1", "e0", "c0"]);
    expect(result.snapshot.executeModeItems.event[day]).toEqual(["e0"]);
  });

  it("preserves later insertions, deletions, unrelated order and current content while filling current slots", () => {
    const source = reverseFixture();
    (source.eventLists.event as ShoppingItem[]).push(
      item("far-a", "300a"),
      item("far-b", "400a"),
      item("deleted", "500a"),
      item("e4", "14a"),
    );
    source.executeModeItems.event[day].push("e4");
    const input = freezeCandidateMove(
      source,
      "execute",
      ["e1", "e2"],
      [
        "c0",
        "e0",
        "e3",
        "another-day",
        "e1",
        "e2",
        "c1",
        "c2",
        "far-a",
        "far-b",
        "deleted",
        "e4",
      ],
      "c1",
    );
    const current = structuredClone(source);
    const currentById = new Map(
      (current.eventLists.event as ShoppingItem[]).map((value) => [
        value.id,
        value,
      ]),
    );
    currentById.set("inserted", item("inserted", "350a"));
    Object.assign(currentById.get("e2")!, {
      quantity: 7,
      price: 1234,
      remarks: "保存待ち中の入力",
    });
    current.eventLists.event = [
      "e1",
      "e2",
      "e4",
      "another-day",
      "c0",
      "e0",
      "c1",
      "c2",
      "far-b",
      "inserted",
      "far-a",
      "e3",
    ].map((id) => currentById.get(id)!);
    current.executeModeItems.event[day] = ["e1", "e2", "e4", "e3"];
    freeze(current);
    const result = planShoppingMove(current, input);
    expect(
      (result.snapshot.eventLists.event as ShoppingItem[]).map(
        (value) => value.id,
      ),
    ).toEqual([
      "c0",
      "e0",
      "e4",
      "another-day",
      "e1",
      "e2",
      "c1",
      "c2",
      "far-b",
      "inserted",
      "far-a",
      "e3",
    ]);
    expect(result.snapshot.executeModeItems.event[day]).toEqual(["e4", "e3"]);
    expect(
      (result.snapshot.eventLists.event as ShoppingItem[]).find(
        (value) => value.id === "e2",
      ),
    ).toMatchObject({ quantity: 7, price: 1234, remarks: "保存待ち中の入力" });
    for (const value of result.snapshot.eventLists.event as ShoppingItem[])
      expect(value).toBe(currentById.get(value.id));
    expect(result.snapshot.eventLists.history).toBe(current.eventLists.history);
  });

  it("uses latest column membership for candidate slots and preserves unrelated transfers", () => {
    const source = fixture();
    source.eventLists.event = [
      item("c0", "90a"),
      item("e0", "01a"),
      item("c1", "100a"),
      item("e1", "20a"),
      item("c2", "200a"),
      item("c3", "300a"),
      item("c4", "400a"),
    ];
    source.executeModeItems.event[day] = ["e0", "e1"];
    const input = freezeCandidateMove(
      source,
      "candidate",
      ["c1"],
      ["c1", "e0", "c0", "e1", "c2", "c3", "c4"],
      "c0",
    );
    const current = structuredClone(source);
    current.executeModeItems.event[day] = ["e0", "c4"];
    const result = planShoppingMove(current, input);
    expect(
      (result.snapshot.eventLists.event as ShoppingItem[]).map(
        (value) => value.id,
      ),
    ).toEqual(["c1", "e0", "c0", "e1", "c2", "c3", "c4"]);
    expect(result.snapshot.executeModeItems.event[day]).toEqual(["e0", "c4"]);
  });
});
