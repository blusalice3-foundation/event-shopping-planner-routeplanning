import { ensureDayConsistency } from "../../features/consistency/domain/context";
import { describe, expect, it } from "vitest";
import type {
  ApplicationShoppingMove,
  PersistenceSnapshot,
} from "../ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../types/item";
import { createEventConsistency } from "../../types/consistency";
import {
  planShoppingMove,
  shoppingMovePlacementBaseline,
  shoppingMoveVisitBaseline,
  ShoppingPlacementChangedError,
} from "./shoppingMoveMutation";
const day = "1日目";
const item = (id: string, number: string): ShoppingItem => ({
  id,
  number,
  block: "A",
  eventDate: day,
  circle: id,
  title: "新刊",
  quantity: 1,
  price: 500,
  purchaseStatus: "None",
  remarks: "ユーザー登録",
});
function fixture(): PersistenceSnapshot {
  return {
    eventLists: {
      event: [
        item("target", "01a"),
        item("far", "99a"),
        item("incoming", "01a2"),
      ],
    },
    eventMetadata: {},
    executeModeItems: { event: { [day]: ["target", "far"] } },
    dayModes: { event: { [day]: "edit" } },
    mapData: {},
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallRouteSettings: {},
    hallDefinitions: {
      event: {
        [`__mapless__:${day}`]: [
          { id: "east", name: "東館", blockNames: ["A"], vertices: [] },
        ],
      },
    },
    eventConsistency: { event: createEventConsistency() },
  };
}
function fixtureWithWest(): PersistenceSnapshot {
  const source = fixture();
  (source.eventLists.event as ShoppingItem[]).push({
    ...item("west", "01a"),
    block: "B",
  });
  source.executeModeItems.event[day].push("west");
  source.hallDefinitions.event[`__mapless__:${day}`].push({
    id: "west",
    name: "西館",
    blockNames: ["B"],
    vertices: [],
  });
  return source;
}
function frozen(
  source: PersistenceSnapshot,
  executeIds: string[],
): ApplicationShoppingMove {
  const ids = (source.eventLists.event as ShoppingItem[]).map(
    (entry) => entry.id,
  );
  const command: ApplicationShoppingMove = {
    version: 1,
    eventName: "event",
    day,
    sourceColumn: "candidate",
    targetColumn: "execute",
    requestedIds: ["incoming"],
    effectiveIds: ["incoming"],
    hoverId: "far",
    baselineItemIds: ids,
    itemIds: ids,
    baselineExecuteIds: source.executeModeItems.event[day],
    executeIds,
    baselineVisits: shoppingMoveVisitBaseline(source, "event", day),
  };
  command.placementBaseline = shoppingMovePlacementBaseline(source, command);
  return command;
}

describe("scoped placement dependencies", () => {
  it("preserves a merge when a distant executing visit changes priority or purchase contents", () => {
    const source = fixture();
    const command = frozen(source, ["target", "incoming", "far"]);
    expect(command.placementBaseline!.entries.map((entry) => entry.id)).toEqual(
      ["incoming", "target"],
    );
    const current = structuredClone(source);
    Object.assign(current.eventLists.event[1] as ShoppingItem, {
      priorityLevel: "highest",
      quantity: 7,
      price: 1200,
      remarks: "保存待ち中の入力",
    });
    const result = planShoppingMove(current, command);
    expect(result.snapshot.executeModeItems.event[day]).toEqual([
      "target",
      "incoming",
      "far",
    ]);
    expect(result.snapshot.eventLists.event[1]).toMatchObject({
      id: "far",
      priorityLevel: "highest",
      quantity: 7,
      price: 1200,
      remarks: "保存待ち中の入力",
    });
  });
  it("still aborts if the actual merge visit gains a book", () => {
    const source = fixture();
    const command = frozen(source, ["target", "incoming", "far"]);
    const current = structuredClone(source);
    (current.eventLists.event as ShoppingItem[]).push(
      item("new-target-book", "01a3"),
    );
    current.executeModeItems.event[day].push("new-target-book");
    expect(() => planShoppingMove(current, command)).toThrow(
      ShoppingPlacementChangedError,
    );
  });
  it("keeps a group-tail dependency without depending on distant earlier visits", () => {
    const source = fixture();
    (source.eventLists.event[2] as ShoppingItem).number = "03a";
    const command = frozen(source, ["target", "far", "incoming"]);
    const earlier = structuredClone(source);
    (earlier.eventLists.event as ShoppingItem[]).push(
      item("new-earlier", "02a"),
    );
    earlier.executeModeItems.event[day].splice(1, 0, "new-earlier");
    expect(
      planShoppingMove(earlier, command).snapshot.executeModeItems.event[day],
    ).toEqual(["target", "new-earlier", "far", "incoming"]);
    const later = structuredClone(source);
    (later.eventLists.event as ShoppingItem[]).push(item("new-tail", "02a"));
    later.executeModeItems.event[day].push("new-tail");
    expect(() => planShoppingMove(later, command)).toThrow(
      ShoppingPlacementChangedError,
    );
  });
  it("does not abort an explicit insertion for a distant same-group priority edit", () => {
    const source = fixture();
    (source.eventLists.event[2] as ShoppingItem).number = "03a";
    const command = frozen(source, ["incoming", "target", "far"]);
    command.hoverId = "target";
    command.placementBaseline = shoppingMovePlacementBaseline(source, {
      ...command,
      placementBaseline: undefined,
    });
    const current = structuredClone(source);
    (current.eventLists.event[1] as ShoppingItem).priorityLevel = "highest";
    expect(
      planShoppingMove(current, command).snapshot.executeModeItems.event[day],
    ).toEqual(["incoming", "target", "far"]);
  });
  it("aborts when a new visit enters the actual insertion gap", () => {
    const source = fixture();
    (source.eventLists.event[2] as ShoppingItem).number = "03a";
    const command = frozen(source, ["incoming", "target", "far"]);
    command.hoverId = "target";
    command.placementBaseline = shoppingMovePlacementBaseline(source, {
      ...command,
      placementBaseline: undefined,
    });
    const current = structuredClone(source);
    (current.eventLists.event as ShoppingItem[]).push(
      item("new-neighbor", "04a"),
    );
    current.executeModeItems.event[day].unshift("new-neighbor");
    expect(() => planShoppingMove(current, command)).toThrow(
      ShoppingPlacementChangedError,
    );
  });
  it("keeps candidate card order independent of the destination card's priority", () => {
    const source = fixture();
    source.executeModeItems.event[day] = [];
    const command = frozen(source, []);
    command.sourceColumn = "candidate";
    command.targetColumn = "candidate";
    command.hoverId = "__END_OF_LIST__";
    // Move only incoming to the front of target, retaining the candidate role.
    command.itemIds = ["incoming", "target", "far"];
    command.placementBaseline = shoppingMovePlacementBaseline(source, {
      ...command,
      placementBaseline: undefined,
    });
    const current = structuredClone(source);
    (current.eventLists.event[0] as ShoppingItem).priorityLevel = "priority";
    expect(
      (
        planShoppingMove(current, command).snapshot.eventLists
          .event as ShoppingItem[]
      ).map((entry) => entry.id),
    ).toEqual(["incoming", "target", "far"]);
  });
});

describe("unrelated placement group removal", () => {
  it("keeps an existing-visit merge when the sole book in an unrelated hall is deleted", () => {
    const source = fixtureWithWest();
    const command = frozen(source, ["target", "incoming", "far", "west"]);
    const current = structuredClone(source);
    current.eventLists.event = current.eventLists.event.filter(
      (entry) => (entry as ShoppingItem).id !== "west",
    );
    current.executeModeItems.event[day] = ["target", "far"];
    Object.assign(current.eventLists.event[2] as ShoppingItem, {
      quantity: 8,
      price: 1400,
      remarks: "最新の追加入力",
    });
    const result = planShoppingMove(current, command);
    expect(result.confirmation).toBeUndefined();
    expect(result.snapshot.executeModeItems.event[day]).toEqual([
      "target",
      "incoming",
      "far",
    ]);
    expect(result.snapshot.eventLists.event).toEqual(current.eventLists.event);
    expect(result.snapshot.eventLists.event[2]).toBe(
      current.eventLists.event[2],
    );
  });

  it("keeps book-order slots when the sole book in an unrelated hall is deleted", () => {
    const source = fixtureWithWest();
    source.executeModeItems.event[day] = ["target", "far", "incoming", "west"];
    const command = frozen(source, ["incoming", "far", "target", "west"]);
    command.sourceColumn = "execute";
    command.requestedIds = ["target"];
    command.effectiveIds = ["target"];
    command.hoverId = "incoming";
    command.reorderWithinVisit = true;
    command.placementBaseline = shoppingMovePlacementBaseline(source, {
      ...command,
      placementBaseline: undefined,
    });
    const current = structuredClone(source);
    current.eventLists.event = current.eventLists.event.filter(
      (entry) => (entry as ShoppingItem).id !== "west",
    );
    current.executeModeItems.event[day] = ["target", "far", "incoming"];
    Object.assign(current.eventLists.event[0] as ShoppingItem, {
      purchaseStatus: "Purchased",
      quantity: 5,
      price: 1700,
    });
    const result = planShoppingMove(current, command);
    expect(result.confirmation).toBeUndefined();
    expect(result.snapshot.executeModeItems.event[day]).toEqual([
      "incoming",
      "far",
      "target",
    ]);
    expect(result.snapshot.eventLists.event).toEqual(current.eventLists.event);
    expect(result.snapshot.eventLists.event[0]).toBe(
      current.eventLists.event[0],
    );
  });

  it("still aborts a new placement group's insertion when its hall order changes", () => {
    const source = fixtureWithWest();
    source.eventLists.event = source.eventLists.event.filter((entry) =>
      ["incoming", "west"].includes((entry as ShoppingItem).id),
    );
    source.executeModeItems.event[day] = ["west"];
    const command = frozen(source, ["incoming", "west"]);
    command.hoverId = "west";
    command.placementBaseline = shoppingMovePlacementBaseline(source, {
      ...command,
      placementBaseline: undefined,
    });
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
    expect(() => planShoppingMove(current, command)).toThrow(
      ShoppingPlacementChangedError,
    );
  });
});
