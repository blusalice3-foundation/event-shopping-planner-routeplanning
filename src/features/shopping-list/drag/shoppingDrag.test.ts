import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../../../types/item";
import { computeMoveItem } from "../../events/itemOps";
import { projectItemsToExecutionVisits } from "../../../utils/visitProjection";
import {
  buildShoppingDragLayout,
  projectShoppingDragDisplay,
  resolveShoppingDragPlacement,
  validateShoppingDragPlacement,
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
  requestedIds: moving.map((value) => value.id),
  effectiveIds: moving.map((value) => value.id),
  sourceVisits: projectItemsToExecutionVisits(moving).map((visit) => ({
    key: visit.key,
    ids: visit.itemIds,
  })),
  operation: moving.length > 1 ? "selection" : "single",
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
    effectiveSelectedIds: new Set(moving.map((value) => value.id)),
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
  it("rejects an OFF selection whose hall buckets reverse at a shared boundary", () => {
    const p = {
      ...presentation(false),
      halls: [
        { id: "one", name: "One", vertices: [], blockNames: ["A"] },
        { id: "two", name: "Two", vertices: [], blockNames: ["B"] },
      ],
    };
    const a = item("a", "01", { block: "A" });
    const b = item("b", "02", { block: "B" });
    const x = item("x", "03", { block: "B" });
    const y = item("y", "04", { block: "A" });
    expect(move([a, b], [x, y], "after", p, "a")).toBeNull();
    expect(move([a, b], [y, x], "after", p, "a")?.display).toEqual([
      "a",
      "y",
      "x",
      "b",
    ]);
  });
  it("keeps new hall buckets between the leading and trailing existing segments", () => {
    const p = {
      ...presentation(false),
      halls: ["A", "B", "C", "D"].map((name) => ({
        id: name,
        name,
        vertices: [],
        blockNames: [name],
      })),
    };
    const a = item("a", "01", { block: "A" });
    const b = item("b", "02", { block: "B" });
    const moving = [
      item("lead", "03", { block: "A" }),
      item("new", "04", { block: "C" }),
      item("tail", "05", { block: "B" }),
    ];
    expect(move([a, b], moving, "after", p, "a")?.display).toEqual([
      "a",
      "lead",
      "new",
      "tail",
      "b",
    ]);
    expect(move([a, b], moving.slice(1).reverse(), "after", p, "a")).toBeNull();
    expect(move([a, b], [moving[1], moving[0]], "after", p, "a")).toBeNull();
    expect(
      move(
        [a, b],
        [moving[1], moving[2], item("other", "06", { block: "D" })],
        "after",
        p,
        "a",
      ),
    ).toBeNull();
  });
  it("accepts only selections whose prepared guide agrees with the final drop projection", () => {
    const p = {
      ...presentation(false),
      halls: ["A", "B", "C"].map((name) => ({
        id: name,
        name,
        vertices: [],
        blockNames: [name],
      })),
    };
    for (const blocks of [
      ["A", "B"],
      ["B", "A"],
      ["A", "B", "A"],
    ]) {
      const existing = blocks.map((block, index) =>
        item(`existing-${index}`, String(index + 1), { block }),
      );
      for (const first of ["A", "B", "C"])
        for (const second of ["A", "B", "C"])
          for (const third of ["A", "B", "C"]) {
            const moving = [first, second, third].map((block, index) =>
              item(`moving-${index}`, String(index + 10), { block }),
            );
            for (const reference of existing)
              for (const edge of ["before", "after", "end"] as const) {
                const moved = move(existing, moving, edge, p, reference.id);
                if (moved) expect(moved.ids).toBeDefined();
              }
          }
    }
  });
  it("matches a full projection oracle in both directions across hall and priority bucket permutations", () => {
    const halls = ["A", "B"].map((name) => ({
      id: name,
      name,
      vertices: [],
      blockNames: [name],
    }));
    const bucketItem = (id: string, number: string, bucket: number) =>
      item(id, number, {
        block: bucket === 1 ? "B" : "A",
        priorityLevel: bucket === 2 ? "priority" : "none",
      });
    const existingBuckets = [
      [],
      [0],
      [0, 1],
      [1, 0],
      [0, 0, 1],
      [0, 1, 0],
      [0, 1, 2],
      [2, 0, 1],
      [2, 1, 0, 2],
      [0, 1, 2, 0],
    ];
    const incomingBuckets: number[][] = [];
    for (const a of [0, 1, 2]) {
      incomingBuckets.push([a]);
      for (const b of [0, 1, 2]) {
        incomingBuckets.push([a, b]);
        for (const c of [0, 1, 2]) incomingBuckets.push([a, b, c]);
      }
    }
    for (const p of [
      { ...presentation(false), halls },
      { ...presentation(false), hallGroups: false, halls },
      { ...presentation(true), halls },
    ])
      for (const buckets of existingBuckets) {
        const existing = buckets.map((bucket, index) =>
          bucketItem(`existing-${index}`, String(index + 1), bucket),
        );
        const display = projectShoppingDragDisplay(existing, p);
        const layout = buildShoppingDragLayout(existing, p);
        for (const incoming of incomingBuckets) {
          const moving = incoming.map((bucket, index) =>
            bucketItem(`moving-${index}`, String(index + 10), bucket),
          );
          for (let slot = 0; slot <= display.length; slot++) {
            const referenceId = display[slot]?.id;
            const edge = referenceId ? "before" : "end";
            const anchorIndex = referenceId
              ? existing.findIndex((value) => value.id === referenceId)
              : existing.length;
            const after = [...existing];
            after.splice(anchorIndex, 0, ...moving);
            const expected = [...display];
            expected.splice(slot, 0, ...moving);
            const actual = projectShoppingDragDisplay(after, p);
            const preservesSequence = actual.every(
              (value, index) => value.id === expected[index].id,
            );
            const placement = resolveShoppingDragPlacement(
              layout,
              moving,
              referenceId,
              edge,
            );
            expect(
              placement !== null,
              JSON.stringify({
                p: [p.spaceGroups, p.hallGroups],
                buckets,
                incoming,
                slot,
              }),
            ).toBe(preservesSequence);
          }
        }
      }
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

describe("drop placement validation with reused visit membership", () => {
  const hallPresentation: ShoppingDragPresentation = {
    ...presentation(false),
    map: { maxRow: 1, maxCol: 1, cells: [], blocks: [], mergedCells: [] },
    halls: [
      { id: "one", name: "One", vertices: [], blockNames: ["A"] },
      { id: "two", name: "Two", vertices: [], blockNames: ["A"] },
    ],
  };
  it.each([
    { label: "space groups", p: { ...hallPresentation, spaceGroups: true } },
    { label: "no hall groups", p: { ...hallPresentation, hallGroups: false } },
    { label: "split hall groups", p: hallPresentation },
  ])(
    "preserves membership and raw non-contiguous visits with $label",
    ({ p }) => {
      const a1 = item("a1", "01a", { manualHallId: "one" });
      const a2 = item("a2", "01a2", { manualHallId: "two" });
      const b = item("b", "02", { manualHallId: "one" });
      const x = item("x", "03", { manualHallId: "one" });
      const merged = item("merged", "01a3", { manualHallId: "one" });
      const before = [a1, b, a2];
      const after = [a1, x, b, a2, merged];
      const placement = resolveShoppingDragPlacement(
        buildShoppingDragLayout(before, p),
        [x, merged],
        b.id,
        "before",
      );
      expect(placement).not.toBeNull();
      if (!placement) throw new Error("Expected an accepted placement");
      expect(validateShoppingDragPlacement(placement, before, after)).toBe(
        true,
      );
      expect(validateShoppingDragPlacement(placement, [a1, a2, b], after)).toBe(
        true,
      );
      if (!p.spaceGroups && p.hallGroups) {
        // Hall grouping splits the same visit into two displayed segments.
        // Its repeated display key must survive the validation fast path.
        expect(placement.baseVisitKeys).toHaveLength(3);
        expect(placement.baseVisitKeys[0]).toBe(placement.baseVisitKeys[2]);
      }
      for (const [label, staleBefore] of [
        ["missing merge member", [a1, b]],
        ["duplicate merge member", [a1, b, a2, a2]],
        ["replacement merge member", [a1, b, { ...a2, id: "replacement" }]],
        ["duplicate reference member", [a1, b, a2, b]],
        ["added reference member", [a1, b, a2, { ...b, id: "late-reference" }]],
        ["changed visit order", [b, a1, a2]],
      ] as const) {
        expect(
          validateShoppingDragPlacement(placement, staleBefore, after),
          label,
        ).toBe(false);
      }
      expect(
        validateShoppingDragPlacement(placement, before, [
          a1,
          b,
          a2,
          merged,
          x,
        ]),
      ).toBe(false);
      expect(
        validateShoppingDragPlacement(placement, before, [
          ...after,
          item("late", "04"),
        ]),
      ).toBe(false);
    },
  );

  it("keeps duplicate ID counts when a frozen merge membership is rechecked", () => {
    const a = item("a", "01a");
    const b = item("b", "02");
    const merged = item("merged", "01a2");
    const before = [a, b, a];
    const placement = resolveShoppingDragPlacement(
      buildShoppingDragLayout(before, presentation()),
      [merged],
      b.id,
      "end",
    );
    expect(placement).not.toBeNull();
    if (!placement) throw new Error("Expected a merge placement");
    expect(placement.mergeVisits[0].itemIds).toEqual(["a", "a"]);
    expect(
      validateShoppingDragPlacement(placement, before, [...before, merged]),
    ).toBe(true);
    expect(
      validateShoppingDragPlacement(placement, [a, b], [a, b, merged]),
    ).toBe(false);
    expect(
      validateShoppingDragPlacement(
        placement,
        [...before, a],
        [...before, a, merged],
      ),
    ).toBe(false);
  });
});
