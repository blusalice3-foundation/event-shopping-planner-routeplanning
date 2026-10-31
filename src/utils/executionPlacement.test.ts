import { computeUpdateItemPriority } from "../features/events/itemOps/priority";
import { repositionExecuteItemAfterIdentityChangeWithResult } from "../features/events/itemOps/executeList";
import { computeInsertIntoExecuteAtPosition } from "../features/events/itemOps/executeList";
import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../types/item";
import type { HallDefinition } from "../types/map";
import type { PersistenceSnapshot } from "../app/ports/PersistenceCommandPort";
import { createEventConsistency } from "../types/consistency";
import { projectConsistencySnapshot } from "../features/consistency/domain/projection";
import { registerItemChanges } from "./itemIndex";
import { buildExecutionVisitProjectionKey } from "./visitProjection";
import {
  computeMoveItem,
  computeMoveItemVertical,
} from "../features/events/itemOps/move";
import {
  applyExecutionBookOrder,
  buildCandidatePlacementVisitKey,
  buildExecutionNavigationVisitId,
  buildExecutionPlacementGroupKey,
  buildExecutionPlacementVisitKey,
  canPlaceExecutionItemsAtBoundary,
  createExecutionPlacementProjector,
  flattenExecutionPlacementItems,
  isSameExecutionPlacementGroup,
} from "./executionPlacement";

const item = (
  id: string,
  overrides: Partial<ShoppingItem> = {},
): ShoppingItem => ({
  id,
  eventDate: "1日目",
  block: "A",
  number: "01a",
  circle: id,
  title: "新刊",
  price: 500,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "ユーザー登録",
  priorityLevel: "none",
  ...overrides,
});
const hall = (id: string, blockNames = ["A"]): HallDefinition => ({
  id,
  name: id,
  vertices: [],
  blockNames,
});
function projected(
  items: ShoppingItem[],
  halls: HallDefinition[],
): ShoppingItem[] {
  const source: PersistenceSnapshot = {
    eventLists: { event: items },
    eventMetadata: {},
    executeModeItems: {},
    dayModes: {},
    mapData: {},
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallRouteSettings: {},
    hallDefinitions: { event: { "__mapless__:1日目": halls } },
    eventConsistency: { event: createEventConsistency() },
  };
  return projectConsistencySnapshot(source, "event", "1日目").eventLists
    .event as ShoppingItem[];
}

describe("execution placement rules", () => {
  it("collects hall and priority groups while retaining manual visit and book order", () => {
    const a1 = item("a1");
    const b = item("b", { block: "B", number: "02a" });
    const a2 = item("a2", { number: "01a2" });
    const a3 = item("a3", { number: "03a" });
    const highest = item("highest", {
      number: "04a",
      priorityLevel: "highest",
    });
    const source = [a1, b, a3, a2, highest];
    const before = source.slice();
    expect(
      flattenExecutionPlacementItems(
        source,
        { hallDefinitions: [hall("east"), hall("west", ["B"])] },
        ["east:highest", "east", "west"],
      ).map((record) => record.id),
    ).toEqual(["highest", "a1", "a2", "a3", "b"]);
    expect(source).toEqual(before);
  });

  it("always compares priority and rejects missing or unresolved membership", () => {
    expect(
      isSameExecutionPlacementGroup(
        item("normal"),
        item("priority", { priorityLevel: "priority" }),
      ),
    ).toBe(false);
    const [pending] = projected(
      [item("pending")],
      [hall("east"), hall("west")],
    );
    const [unassigned] = projected([item("unassigned")], []);
    expect(buildExecutionPlacementGroupKey(pending)).not.toBe(
      buildExecutionPlacementGroupKey(unassigned),
    );
    expect(isSameExecutionPlacementGroup(pending, pending)).toBe(false);
  });

  it("keeps display membership separate while retaining saved visit keys", () => {
    const [east] = projected([item("east-book")], [hall("east")]);
    const [west] = projected([item("west-book")], [hall("west")]);
    expect(buildExecutionVisitProjectionKey(east)).toBe(
      buildExecutionVisitProjectionKey(west),
    );
    expect(buildExecutionPlacementVisitKey(east)).not.toBe(
      buildExecutionPlacementVisitKey(west),
    );
    expect(buildExecutionNavigationVisitId(east)).not.toBe(
      buildExecutionNavigationVisitId(west),
    );
    expect(flattenExecutionPlacementItems([east, west])).toHaveLength(2);
  });

  it("keeps confirmed membership while a map priority edit joins an existing visit", () => {
    const before = projected(
      [item("normal"), item("priority", { priorityLevel: "priority" })],
      [hall("east")],
    );
    const updated = computeUpdateItemPriority(
      "normal",
      "priority",
      before,
      [],
      undefined,
      { hallOrder: [], hallVisitLists: [] },
    ).items;
    expect(buildExecutionPlacementGroupKey(updated[0])).toBe(
      buildExecutionPlacementGroupKey(updated[1]),
    );
    const result = repositionExecuteItemAfterIdentityChangeWithResult(
      { "1日目": ["normal", "priority"] },
      before[0],
      updated[0],
      updated,
    );
    expect(result.placement).toBe("merged-into-existing-visit");
    expect(result.executeModeItems["1日目"]).toEqual(["priority", "normal"]);
  });
  it("keeps candidate mixed priorities in one membership heading", () => {
    const [eastNormal, eastPriority] = projected(
      [item("normal"), item("priority", { priorityLevel: "priority" })],
      [hall("east")],
    );
    const [west] = projected([item("west")], [hall("west")]);
    expect(buildCandidatePlacementVisitKey(eastNormal)).toBe(
      buildCandidatePlacementVisitKey(eastPriority),
    );
    expect(buildCandidatePlacementVisitKey(eastNormal)).not.toBe(
      buildCandidatePlacementVisitKey(west),
    );
  });

  it("accepts a group tail immediately before the next group's first row", () => {
    const a = item("a", { number: "02a" });
    const b = item("b", { block: "B" });
    const moving = item("moving", { number: "03a" });
    const context = { hallDefinitions: [hall("east"), hall("west", ["B"])] };
    expect(
      canPlaceExecutionItemsAtBoundary({
        movingItems: [moving],
        remainingItems: [a, b],
        beforeId: "b",
        context,
      }),
    ).toBe(true);
    expect(
      canPlaceExecutionItemsAtBoundary({
        movingItems: [moving],
        remainingItems: [a, b],
        beforeId: "__END_OF_LIST__",
        context,
      }),
    ).toBe(false);
  });

  it("accepts explicit map insertion at the previous group's valid tail", () => {
    const allItems = [
      item("a"),
      item("b", { block: "B" }),
      item("new", { number: "02a" }),
    ];
    const result = computeInsertIntoExecuteAtPosition(
      ["new"],
      "b",
      "before",
      { "1日目": ["a", "b"] },
      "1日目",
      allItems,
      {
        expandSiblings: false,
        canInsertWithReference: (_inserted, reference) => reference === "a",
      },
    );
    expect(result.accepted).toBe(true);
    expect(result.executeModeItems["1日目"]).toEqual(["a", "new", "b"]);
  });
  it("orders only book slots when raw legacy visits are interleaved", () => {
    expect(
      applyExecutionBookOrder(["a1", "b", "a2", "a3"], ["a3", "a1", "a2"]),
    ).toEqual(["a3", "b", "a1", "a2"]);
    const allItems = [
      item("a1"),
      item("b", { number: "02a" }),
      item("a2"),
      item("a3"),
    ];
    const result = computeMoveItem({
      dragId: "a3",
      hoverId: "a1",
      sourceColumn: "execute",
      targetColumn: "execute",
      mode: "edit",
      effectiveSelectedIds: new Set(),
      allItems,
      executeModeItems: { "1日目": ["a1", "b", "a2", "a3"] },
      dayName: "1日目",
      selectedBlockFilters: new Set(),
    });
    expect(result.executeModeItems?.["1日目"]).toEqual(["a3", "b", "a1", "a2"]);
  });

  it("moves the whole execution space only when dragging to another space", () => {
    const allItems = [item("a1"), item("a2"), item("b", { number: "02a" })];
    const result = computeMoveItem({
      dragId: "a1",
      hoverId: "__END_OF_LIST__",
      sourceColumn: "execute",
      targetColumn: "execute",
      mode: "edit",
      effectiveSelectedIds: new Set(),
      allItems,
      executeModeItems: { "1日目": ["a1", "a2", "b"] },
      dayName: "1日目",
      selectedBlockFilters: new Set(),
    });
    expect(result.executeModeItems?.["1日目"]).toEqual(["b", "a1", "a2"]);
  });

  it("keeps candidate book reorders explicit", () => {
    const allItems = [item("a1"), item("a2"), item("b", { number: "02a" })];
    const result = computeMoveItem({
      dragId: "a1",
      hoverId: "__END_OF_LIST__",
      sourceColumn: "candidate",
      targetColumn: "candidate",
      mode: "edit",
      effectiveSelectedIds: new Set(),
      allItems,
      executeModeItems: { "1日目": [] },
      dayName: "1日目",
      selectedBlockFilters: new Set(),
    });
    expect(result.eventListItems?.map((record) => record.id)).toEqual([
      "a2",
      "b",
      "a1",
    ]);
  });

  it("does not allow one selected book to smuggle a different priority through a vertical move", () => {
    const allItems = [
      item("a1"),
      item("a2"),
      item("p", { priorityLevel: "priority" }),
    ];
    const result = computeMoveItemVertical(
      "down",
      "a1",
      "execute",
      "edit",
      new Set(["a1", "p"]),
      allItems,
      { "1日目": ["a1", "a2", "p"] },
      "1日目",
      () => true,
    );
    expect(result).toEqual({});
  });

  it("retains prepared view order for content-only edits", () => {
    const source = [item("a1"), item("b", { number: "02a" }), item("a2")];
    const project = createExecutionPlacementProjector();
    const first = project(source);
    const next = [{ ...source[0], quantity: 3 }, source[1], source[2]];
    registerItemChanges(source, next, [0]);
    const second = project(next);
    expect(second.map((record) => record.id)).toEqual(["a1", "a2", "b"]);
    expect(second[0].quantity).toBe(3);
    expect(second[1]).toBe(first[1]);
    expect(project(next)).toBe(second);
  });
});
