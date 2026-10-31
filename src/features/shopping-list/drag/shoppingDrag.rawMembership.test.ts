import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../../../types/item";
import { buildExecutionPlacementGroupKey } from "../../../utils/executionPlacement";
import {
  buildShoppingDragLayout,
  resolveShoppingDragPlacement,
  resolveShoppingDragColumnPlacement,
  resolveShoppingBookPlacement,
  shoppingDragHasSingleGroup,
  validateShoppingDragPlacement,
  type ShoppingDragPresentation,
} from "./shoppingDrag";
const item = (
  id: string,
  number: string,
  manualHallId?: string,
): ShoppingItem => ({
  id,
  number,
  manualHallId,
  block: "A",
  eventDate: "1日目",
  circle: id,
  title: "新刊",
  quantity: 1,
  price: 500,
  purchaseStatus: "None",
  remarks: "ユーザー登録",
});
const presentation = (
  allItems?: readonly ShoppingItem[],
): ShoppingDragPresentation => ({
  spaceGroups: true,
  hallGroups: false,
  map: null,
  hallOrder: ["east", "west"],
  allItems,
  halls: [
    { id: "east", name: "東館", vertices: [], blockNames: ["A"] },
    { id: "west", name: "西館", vertices: [], blockNames: ["A"] },
  ],
});

describe("raw drag membership context", () => {
  it("uses one complete layout membership context for visits and buckets", () => {
    const existing = [
      item("east-book", "01a", "east"),
      item("west-book", "01a2", "west"),
    ];
    const layout = buildShoppingDragLayout(existing, presentation());
    expect(layout.context.allItems).toBe(existing);
    expect(layout.visits).toHaveLength(1);
    expect(layout.buckets.size).toBe(1);
    expect([...layout.buckets.keys()]).toEqual([
      buildExecutionPlacementGroupKey(existing[0], layout.context),
    ]);
    expect(
      resolveShoppingBookPlacement(
        layout,
        [existing[0]],
        existing[1].id,
        "after",
      ),
    ).toBeNull();
  });
  it("rejects a cross-column raw shared-space conflict instead of resolving each item alone", () => {
    const existing = item("existing", "01a", "east");
    const incoming = item("incoming", "01a2", "west");
    const p = presentation([existing, incoming]);
    const layout = buildShoppingDragLayout([existing], p);
    expect(shoppingDragHasSingleGroup([incoming], p)).toBe(false);
    expect(
      resolveShoppingDragPlacement(layout, [incoming], "existing", "before"),
    ).toBeNull();
    expect(resolveShoppingDragColumnPlacement(layout, [incoming])).toBeNull();
  });
  it("inherits the confirmed shared-space assignment for an unassigned raw incoming book", () => {
    const existing = item("existing", "01a", "east");
    const incoming = item("incoming", "01a2");
    const later = item("later", "02a", "west");
    const allItems = [existing, later, incoming];
    const p = presentation(allItems);
    const layout = buildShoppingDragLayout([existing, later], p);
    expect(layout.context.allItems).toBe(allItems);
    expect(shoppingDragHasSingleGroup([incoming], p)).toBe(true);
    const placement = resolveShoppingDragPlacement(
      layout,
      [incoming],
      "existing",
      "after",
    );
    expect(placement?.mergeTargetIds).toEqual(["existing"]);
    expect(placement?.positionedIds).toEqual([]);
    expect(
      placement &&
        validateShoppingDragPlacement(
          placement,
          [existing, later],
          [existing, incoming, later],
        ),
    ).toBe(true);
  });
  it("also applies shared assignments across different spaces resolving to the same map cell", () => {
    const existing = item("existing", "01a", "east");
    const incoming = item("incoming", "01b", "west");
    const p: ShoppingDragPresentation = {
      ...presentation([existing, incoming]),
      map: {
        maxRow: 3,
        maxCol: 3,
        cells: [],
        mergedCells: [],
        blocks: [
          {
            name: "A",
            startRow: 0,
            endRow: 2,
            startCol: 0,
            endCol: 2,
            numberCells: [{ row: 1, col: 1, value: 1 }],
          },
        ],
      },
    };
    const layout = buildShoppingDragLayout([existing], p);
    expect(
      resolveShoppingDragPlacement(layout, [incoming], "existing", "before"),
    ).toBeNull();
  });
});
