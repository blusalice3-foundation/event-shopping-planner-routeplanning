import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../types/item";
import { swapVisitItems } from "./swapVisitItems";
const item = (id: string, number = id): ShoppingItem => ({
  id,
  circle: id,
  title: id,
  eventDate: "1日目",
  block: "A",
  number,
  quantity: 1,
  price: 100,
  purchaseStatus: "None",
  remarks: "",
});
describe("visit swap", () => {
  it.each([
    ["a", "c"],
    ["c", "a"],
    ["a", "b"],
  ])("exchanges %s and %s and is reversible", (a, b) => {
    const items = [item("a"), item("b"), item("c")];
    const swapped = swapVisitItems(items, a, b)!;
    const expected = [...items];
    const x = items.findIndex((i) => i.id === a),
      y = items.findIndex((i) => i.id === b);
    [expected[x], expected[y]] = [expected[y], expected[x]];
    expect(swapped).toEqual(expected);
    expect(swapVisitItems(swapped, a, b)).toEqual(items);
  });
  it("exchanges different sized whole visits while preserving members and middle visits", () => {
    const items = [
      item("a1", "1"),
      item("a2", "1"),
      item("b", "2"),
      item("c", "3"),
    ];
    const swapped = swapVisitItems(items, "a2", "c")!;
    expect(swapped.map((i) => i.id)).toEqual(["c", "b", "a1", "a2"]);
    expect(swapVisitItems(swapped, "a2", "c")).toEqual(items);
    expect(swapped.every((i) => items.includes(i))).toBe(true);
  });
  it("swaps members of one visit and refuses deleted IDs", () => {
    const items = [item("a1", "1"), item("a2", "1"), item("a3", "1")];
    expect(swapVisitItems(items, "a1", "a3")?.map((i) => i.id)).toEqual([
      "a3",
      "a2",
      "a1",
    ]);
    expect(swapVisitItems(items, "deleted", "a1")).toBeNull();
  });
});
