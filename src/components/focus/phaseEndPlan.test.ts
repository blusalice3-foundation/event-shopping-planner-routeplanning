import { describe, expect, it } from "vitest";
import { planPhaseEnd } from "./phaseEndPlan";
import type { ShoppingItem } from "../../types/item";
const item = (
  id: string,
  purchaseStatus: ShoppingItem["purchaseStatus"],
): ShoppingItem => ({
  id,
  circle: id,
  title: id,
  eventDate: "1日目",
  block: "A",
  number: id,
  quantity: 1,
  price: 100,
  purchaseStatus,
  remarks: "",
});
describe("formal phase end", () => {
  it("skips deleted captured IDs but keeps valid captured purchased targets", () => {
    const next = planPhaseEnd(
      "postponed",
      [item("late", "Purchased"), item("new", "Late")],
      new Set(["deleted"]),
      new Set(["deleted", "late"]),
    );
    expect(next.nextPhase).toBe("late");
    expect([...next.late]).toEqual(["late", "new"]);
    expect(next.postponed.size).toBe(0);
  });
  it("chooses postponed then late then completion using current phase boundaries", () => {
    const items = [item("p", "Postpone"), item("l", "Late")];
    expect(planPhaseEnd("normal", items, new Set(), new Set()).nextPhase).toBe(
      "postponed",
    );
    expect(
      planPhaseEnd("postponed", items, new Set(["p"]), new Set()).nextPhase,
    ).toBe("late");
    expect(
      planPhaseEnd("late", items, new Set(["p"]), new Set(["l"])).nextPhase,
    ).toBeNull();
    expect(
      planPhaseEnd("postponed", [], new Set(["gone"]), new Set(["gone"]))
        .nextPhase,
    ).toBeNull();
  });
});
