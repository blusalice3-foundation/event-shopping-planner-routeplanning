import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../types/item";
import { resolveSpaceAdditionPriority } from "./spaceAdditionPriority";

const itemsWithPriorities = (
  ...priorities: ShoppingItem["priorityLevel"][]
): ShoppingItem[] =>
  priorities.map((priorityLevel, index) => ({
    id: String(index),
    eventDate: "1日目",
    block: "A",
    number: "01a",
    circle: "サークル",
    title: "本",
    price: null,
    quantity: 1,
    remarks: "",
    purchaseStatus: "None",
    priorityLevel,
  }));

describe("space addition priority", () => {
  it.each(["highest", "priority", "none"] as const)(
    "inherits a uniform %s priority",
    (priority) => {
      expect(
        resolveSpaceAdditionPriority(itemsWithPriorities(priority, priority)),
      ).toBe(priority);
    },
  );

  it("treats missing priority as normal, while mixed and empty groups require a choice", () => {
    expect(
      resolveSpaceAdditionPriority(itemsWithPriorities(undefined, "none")),
    ).toBe("none");
    expect(
      resolveSpaceAdditionPriority(itemsWithPriorities("highest", "none")),
    ).toBe("");
    expect(
      resolveSpaceAdditionPriority(itemsWithPriorities("priority", "highest")),
    ).toBe("");
    expect(resolveSpaceAdditionPriority([])).toBe("");
  });
});
