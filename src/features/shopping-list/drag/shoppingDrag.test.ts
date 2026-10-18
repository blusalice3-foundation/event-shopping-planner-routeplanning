import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../../../types/item";
import { computeMoveItem } from "../../events/itemOps";
import { projectItemsToExecutionVisits } from "../../../utils/visitProjection";
import {
  buildShoppingDragLayout,
  projectShoppingDragDisplay,
  resolveShoppingDragPlacement,
  type ShoppingDragMoveContext,
  type ShoppingDragPresentation,
} from "./shoppingDrag";
const day = "Day1";
const item = (
  id: string,
  number: string,
  overrides: Partial<ShoppingItem> = {},
): ShoppingItem => ({
  id,
  eventDate: day,
  block: "A",
  number,
  circle: id,
  title: "",
  quantity: 1,
  price: null,
  purchaseStatus: "None",
  remarks: "ユーザー登録",
  ...overrides,
});
const presentation = (spaceGroups = true): ShoppingDragPresentation => ({
  spaceGroups,
  hallGroups: !spaceGroups,
  halls: [],
  hallOrder: [],
  map: null,
});
const context = (
  moving: ShoppingItem[],
  p?: ShoppingDragMoveContext["placement"],
): ShoppingDragMoveContext => ({
  token: Symbol(),
  eventName: "Event",
  day,
  generation: 0,
  sourceColumn: "candidate",
  targetColumn: "execute",
  requestedIds: [moving[0].id],
  effectiveIds: moving.map((value) => value.id),
  sourceVisits: projectItemsToExecutionVisits(moving).map((visit) => ({
    key: visit.key,
    ids: visit.itemIds,
  })),
  operation: "single",
  isCurrent: () => true,
  placement: p,
});
function move(
  existing: ShoppingItem[],
  moving: ShoppingItem[],
  boundary: "before" | "after" | "end",
  p = presentation(),
  referenceId = existing[0]?.id,
) {
  const layout = buildShoppingDragLayout(existing, p);
  const placement = resolveShoppingDragPlacement(
    layout,
    moving,
    referenceId,
    boundary,
  );
  if (!placement) return null;
  const allItems = [...existing, ...moving];
  const result = computeMoveItem({
    dragId: moving[0].id,
    hoverId: placement.anchorId,
    sourceColumn: "candidate",
    targetColumn: "execute",
    mode: "edit",
    effectiveSelectedIds: new Set([moving[0].id]),
    allItems,
    executeModeItems: { [day]: existing.map((value) => value.id) },
    dayName: day,
    selectedBlockFilters: new Set(),
    dragContext: context(moving, placement),
  });
  const ids = result.executeModeItems?.[day];
  return {
    result,
    ids,
    display:
      ids &&
      projectShoppingDragDisplay(
        ids.map((id) => allItems.find((value) => value.id === id)!),
        p,
      ).map((value) => value.id),
  };
}
describe("execution cross-column drag placement", () => {
  it.each(["before", "after"] as const)(
    "places the expanded visit at the %s boundary",
    (edge) => {
      const a = [item("a1", "01a"), item("a2", "01a2")];
      const x = [item("x1", "03a"), item("x2", "03a2")];
      expect(move(a, x, edge)?.display).toEqual(
        edge === "before" ? ["x1", "x2", "a1", "a2"] : ["a1", "a2", "x1", "x2"],
      );
    },
  );
  it("anchors after a projected visit without normalizing unrelated raw members", () => {
    const a1 = item("a1", "01a"),
      a2 = item("a2", "01a2"),
      b = item("b", "02"),
      x = item("x", "03");
    const result = move([a1, b, a2], [x], "after");
    expect(result?.ids).toEqual(["a1", "x", "b", "a2"]);
    expect(result?.display).toEqual(["a1", "a2", "x", "b"]);
  });
  it("gives existing-visit tail merges priority over an impossible reference boundary", () => {
    const a = item("a", "01a", { priorityLevel: "priority" }),
      b = item("b", "02"),
      incoming = item("a2", "01a2", { priorityLevel: "priority" });
    const result = move([a, b], [incoming], "after", presentation(false), "b");
    expect(result?.result.placement).toBe("merged-into-existing-visit");
    expect(result?.result.mergedIntoVisitItemIds).toEqual(["a"]);
    expect(result?.ids).toEqual(["a", "a2", "b"]);
  });
  it("rejects an impossible priority boundary without a partial merge", () => {
    const a = item("a", "01"),
      b = item("b", "02", { priorityLevel: "priority" }),
      c = item("c", "03");
    expect(
      move(
        [a, b, c],
        [item("x", "04", { priorityLevel: "priority" })],
        "after",
        presentation(false),
      ),
    ).toBeNull();
  });
  it("rejects a non-contiguous OFF reference visit", () => {
    const a1 = item("a1", "01a", { manualHallId: "one" }),
      a2 = item("a2", "01a2", { manualHallId: "two" }),
      b = item("b", "02", { manualHallId: "one" });
    const p = {
      ...presentation(false),
      map: { maxRow: 1, maxCol: 1, cells: [], blocks: [], mergedCells: [] },
      halls: [
        { id: "one", name: "One", vertices: [], blockNames: ["A"] },
        { id: "two", name: "Two", vertices: [], blockNames: ["A"] },
      ],
    };
    expect(
      move([a1, b, a2], [item("x", "03", { manualHallId: "one" })], "after", p),
    ).toBeNull();
  });
  it("checks the canonical slot when the next raw anchor is a later member of a split visit", () => {
    const a1 = item("a1", "01a", { manualHallId: "one" }),
      b = item("b", "02", { manualHallId: "one" }),
      a2 = item("a2", "01a2", { manualHallId: "two" });
    const p = {
      ...presentation(false),
      map: { maxRow: 1, maxCol: 1, cells: [], blocks: [], mergedCells: [] },
      halls: [
        { id: "one", name: "One", vertices: [], blockNames: ["A"] },
        { id: "two", name: "Two", vertices: [], blockNames: ["A"] },
        { id: "three", name: "Three", vertices: [], blockNames: ["A"] },
      ],
    };
    expect(
      move(
        [a1, b, a2],
        [item("x", "03", { manualHallId: "three" })],
        "after",
        p,
        "b",
      ),
    ).toBeNull();
    expect(
      move(
        [a1, b, a2],
        [item("x", "03", { manualHallId: "one" })],
        "after",
        p,
        "b",
      )?.display,
    ).toEqual(["a1", "b", "x", "a2"]);
  });
  it("resolves each OFF merge endpoint within its existing hall segment", () => {
    const p = {
      ...presentation(false),
      map: { maxRow: 1, maxCol: 1, cells: [], blocks: [], mergedCells: [] },
      halls: [
        { id: "one", name: "One", vertices: [], blockNames: ["A"] },
        { id: "two", name: "Two", vertices: [], blockNames: ["A"] },
      ],
    };
    const a1 = item("a1", "01a", { manualHallId: "one" }),
      c = item("c", "03", { manualHallId: "one" }),
      a2 = item("a2", "01a2", { manualHallId: "two" }),
      b = item("b", "02", { manualHallId: "two" }),
      x = item("x", "01a3", { manualHallId: "one" });
    const placement = resolveShoppingDragPlacement(
      buildShoppingDragLayout([a1, c, a2, b], p),
      [x],
      "b",
      "after",
    );
    expect(placement?.mergeTargetIds).toEqual(["a1"]);
    expect(move([a1, c, a2, b], [x], "after", p, "b")?.display).toEqual([
      "a1",
      "x",
      "c",
      "a2",
      "b",
    ]);
    expect(
      resolveShoppingDragPlacement(
        buildShoppingDragLayout([a1, c, b], p),
        [item("other", "01a3", { manualHallId: "two" })],
        "b",
        "after",
      ),
    ).toBeNull();
  });
  it("rejects a stale source visit membership and an expired owner", () => {
    const a = item("a", "01"),
      x = item("x", "02a"),
      late = item("late", "02a2");
    const frozen = context([x]);
    const input = {
      dragId: "x",
      hoverId: "a",
      targetColumn: "execute" as const,
      sourceColumn: "candidate" as const,
      mode: "edit" as const,
      effectiveSelectedIds: new Set(["x"]),
      allItems: [a, x, late],
      executeModeItems: { [day]: ["a"] },
      dayName: day,
      selectedBlockFilters: new Set<string>(),
      dragContext: frozen,
    };
    expect(computeMoveItem(input)).toEqual({});
    expect(
      computeMoveItem({
        ...input,
        allItems: [a, x],
        dragContext: { ...frozen, isCurrent: () => false },
      }),
    ).toEqual({});
  });
  it("retains the no-context legacy snap-to-first behavior", () => {
    const a1 = item("a1", "01a"),
      a2 = item("a2", "01a2"),
      x = item("x", "02a");
    expect(
      computeMoveItem({
        dragId: "x",
        hoverId: "a2",
        targetColumn: "execute",
        sourceColumn: "candidate",
        mode: "edit",
        effectiveSelectedIds: new Set(),
        allItems: [a1, a2, x],
        executeModeItems: { [day]: ["a1", "a2"] },
        dayName: day,
        selectedBlockFilters: new Set(),
      }).executeModeItems?.[day],
    ).toEqual(["x", "a1", "a2"]);
  });
});
