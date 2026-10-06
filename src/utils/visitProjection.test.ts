import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../types/item";
import {
  buildExecutionVisitProjectionKey,
  buildPhaseVisitProjectionKey,
  projectExecutionVisitItemIdsForView,
  projectItemsToExecutionVisits,
} from "./visitProjection";

const item = (
  id: string,
  overrides: Partial<ShoppingItem> = {},
): ShoppingItem => ({
  id,
  circle: id,
  eventDate: "1日目",
  block: "A",
  number: "01a",
  title: "",
  price: null,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "",
  priorityLevel: "none",
  ...overrides,
});

describe("visitProjection", () => {
  it("merges non-contiguous aliases into the first visit position", () => {
    const a1 = item("a1");
    const b = item("b", { block: "B", number: "02a" });
    const a2 = item("a2", { number: "01a2" });

    const visits = projectItemsToExecutionVisits([a1, b, a2]);

    expect(visits.map(({ itemIds }) => itemIds)).toEqual([["a1", "a2"], ["b"]]);
    expect(
      projectExecutionVisitItemIdsForView(["a1", "b", "a2"], [a1, b, a2]),
    ).toEqual(["a1", "a2", "b"]);
  });

  it("keeps different dates, priorities, and phases as distinct visits", () => {
    const base = item("base");
    const otherDate = item("date", { eventDate: "2日目" });
    const priority = item("priority", { priorityLevel: "priority" });
    const late = item("late");

    expect(
      projectItemsToExecutionVisits([base, otherDate, priority]).map(
        ({ itemIds }) => itemIds,
      ),
    ).toEqual([["base"], ["date"], ["priority"]]);
    expect(buildExecutionVisitProjectionKey(base)).toBe(
      buildExecutionVisitProjectionKey(late),
    );
    expect(buildPhaseVisitProjectionKey(base, "normal")).not.toBe(
      buildPhaseVisitProjectionKey(late, "late"),
    );
  });

  it("normalizes full-width spaces in execution visit dates", () => {
    const plain = item("plain", { eventDate: "1日目" });
    const padded = item("padded", { eventDate: " 1日目\u3000" });

    expect(buildExecutionVisitProjectionKey(padded)).toBe(
      buildExecutionVisitProjectionKey(plain),
    );
    expect(
      projectItemsToExecutionVisits([plain, padded]).map(
        ({ itemIds }) => itemIds,
      ),
    ).toEqual([["plain", "padded"]]);
  });

  it("retains unknown IDs instead of dropping persisted data", () => {
    const a1 = item("a1");
    const a2 = item("a2", { number: "01a2" });

    expect(
      projectExecutionVisitItemIdsForView(["a1", "missing", "a2"], [a1, a2]),
    ).toEqual(["a1", "missing", "a2"]);
  });
});
