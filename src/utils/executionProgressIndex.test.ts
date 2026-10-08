import { describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../types/item";
import { createExecutionProgressIndex } from "./executionProgressIndex";
import { registerItemChanges } from "./itemIndex";

const item = (
  id: string,
  purchaseStatus: ShoppingItem["purchaseStatus"] = "None",
  number = "1",
): ShoppingItem => ({
  id,
  eventDate: "1日目",
  block: "A",
  number,
  circle: "ユーザー登録",
  title: "新刊",
  remarks: "エラーが発生しました",
  quantity: 1,
  price: 500,
  purchaseStatus,
});
const key = (item: ShoppingItem) =>
  item.block + "-" + item.number + ":" + (item.priorityLevel || "none");

describe("incremental execution progression", () => {
  it("checks a last item after earlier accepted changes before React renders", () => {
    const first = item("first");
    const last = item("last");
    const progress = createExecutionProgressIndex(key);
    progress.sync([first, last], new Set(), "event/day");
    expect(progress.lastItemId(key(last))).toBe("last");
    progress.apply({ ...first, purchaseStatus: "Purchased" }, true);
    expect(progress.noneCount).toBe(1);
    progress.apply({ ...last, purchaseStatus: "Purchased" }, true);
    expect(progress.noneCount).toBe(0);
    progress.apply(first, true);
    expect(progress.noneCount).toBe(1);
  });

  it("keeps temporary visibility, normalized quantities and group tails through acknowledgement and clearing", () => {
    const members = [
      item("postponed", "Postpone"),
      item("temporary"),
      item("hidden"),
    ];
    const progress = createExecutionProgressIndex(key);
    const recent = new Set(["temporary"]);
    progress.sync(members, recent, "event/day");
    expect(progress.lastItemId(key(members[0]), true)).toBe("temporary");
    expect(progress.visibleNoneCount).toBe(1);
    progress.apply(
      {
        ...members[1],
        purchaseStatus: "LimitedPurchase",
        limitedPurchasedQuantity: 1,
      },
      true,
    );
    expect(progress.visibleNoneCount).toBe(0);
    const acknowledged = members.slice();
    acknowledged[1] = progress.item("temporary")!;
    registerItemChanges(members, acknowledged, [1]);
    progress.sync(acknowledged, new Set(recent), "event/day");
    expect(progress.visibleNoneCount).toBe(0);
    progress.apply(members[1], true);
    expect(progress.visibleNoneCount).toBe(1);
    progress.sync(acknowledged, new Set(), "event/day");
    expect(progress.visibleNoneCount).toBe(0);
    expect(progress.lastItemId(key(members[0]), true)).toBe("postponed");
  });

  it("evaluates only changed group memberships among 1500 items", () => {
    const members = Array.from({ length: 1500 }, (_, index) =>
      item(String(index), "None", String(index + 1)),
    );
    const groupKey = vi.fn(key);
    const progress = createExecutionProgressIndex(groupKey);
    progress.sync(members, new Set(), "event/day");
    groupKey.mockClear();
    const next = members.slice();
    next[1499] = { ...members[1499], purchaseStatus: "Purchased" };
    registerItemChanges(members, next, [1499]);
    progress.apply(next[1499], true);
    progress.sync(next, new Set(["1499"]), "event/day");
    expect(progress.noneCount).toBe(1499);
    expect(progress.lastItemId(key(next[1499]))).toBe("1499");
    expect(groupKey.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("matches canonical progression across status cycles, moved groups, deletes, reorders and a new event", () => {
    let members = Array.from({ length: 150 }, (_, index) =>
      item(String(index), "None", String(1 + Math.floor(index / 5))),
    );
    const progress = createExecutionProgressIndex(key);
    let recent = new Set<string>();
    progress.sync(members, recent, "event/day");
    const assertCanonical = () => {
      expect(progress.noneCount).toBe(
        members.filter((entry) => entry.purchaseStatus === "None").length,
      );
      expect(progress.visibleNoneCount).toBe(
        members.filter(
          (entry) => entry.purchaseStatus === "None" && recent.has(entry.id),
        ).length,
      );
      for (const groupKey of new Set(members.map(key))) {
        const group = members.filter((entry) => key(entry) === groupKey);
        const visible = group.filter(
          (entry) =>
            entry.purchaseStatus === "Postpone" || recent.has(entry.id),
        );
        expect(progress.lastItemId(groupKey)).toBe(group.at(-1)?.id);
        expect(progress.lastItemId(groupKey, true)).toBe(visible.at(-1)?.id);
      }
    };
    for (let operation = 0; operation < 60; operation++) {
      const position = (operation * 17) % members.length;
      const next = members.slice();
      const status = (
        ["Purchased", "Postpone", "Late", "SoldOut", "None"] as const
      )[operation % 5];
      next[position] = {
        ...next[position],
        purchaseStatus: status,
        ...(operation % 7 === 0 ? { number: "99" } : {}),
      };
      registerItemChanges(members, next, [position]);
      recent = new Set(recent).add(next[position].id);
      progress.apply(next[position], true);
      members = next;
      progress.sync(members, recent, "event/day");
      assertCanonical();
    }
    members = members.slice(2).reverse();
    recent = new Set();
    progress.sync(members, recent, "event/day");
    assertCanonical();
    members = [item("0")];
    progress.sync(members, recent, "another-event/day");
    assertCanonical();
    expect(progress.item("149")).toBeUndefined();
  });
});
