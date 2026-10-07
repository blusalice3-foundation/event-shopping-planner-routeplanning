import { describe, expect, it } from "vitest";
import { calculateBlockColors } from "./ShoppingList";
import type { ShoppingItem } from "../types/item";

const item = (id: string, block = "A"): ShoppingItem => ({
  id,
  block,
  number: id,
  circle: "ユーザー登録",
  eventDate: "1日目",
  title: "新刊",
  price: 500,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "",
});

describe("stable item backgrounds during purchase changes", () => {
  it("keeps the other 149 backgrounds unchanged when a purchase changes", () => {
    const items = Array.from({ length: 150 }, (_, index) =>
      item(String(index)),
    );
    const original = calculateBlockColors(items);
    for (const purchaseStatus of [
      "Purchased",
      "SoldOut",
      "Postpone",
      "LimitedPurchase",
    ] as const) {
      const changed = calculateBlockColors([
        { ...items[0], purchaseStatus },
        ...items.slice(1),
      ]);
      expect(changed.has(items[0].id)).toBe(false);
      for (const unchanged of items.slice(1)) {
        expect(changed.get(unchanged.id)).toBe(original.get(unchanged.id));
      }
    }
  });

  it("keeps another block's palette after a whole block is purchased", () => {
    const items = [item("1", "A"), item("2", "B"), item("3", "B")];
    const original = calculateBlockColors(items);
    const purchased = calculateBlockColors([
      { ...items[0], purchaseStatus: "Purchased" },
      ...items.slice(1),
    ]);
    expect(purchased.get("2")).toBe(original.get("2"));
    expect(purchased.get("3")).toBe(original.get("3"));
  });

  it("alternates adjacent rows and restores a cleared purchase's original stripe", () => {
    const items = [item("1"), item("2"), item("3")];
    const original = calculateBlockColors(items);
    expect(original.get("1")).not.toBe(original.get("2"));
    expect(original.get("1")).toBe(original.get("3"));
    const purchased = calculateBlockColors([
      items[0],
      { ...items[1], purchaseStatus: "Purchased" },
      items[2],
    ]);
    expect(purchased.get("1")).toBe(original.get("1"));
    expect(purchased.get("3")).toBe(original.get("3"));
    expect(calculateBlockColors(items).get("2")).toBe(original.get("2"));
  });
});
