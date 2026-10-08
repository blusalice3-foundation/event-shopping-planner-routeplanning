import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../types/item";
import {
  createExecutionVisitIndex,
  createPhaseVisitProjector,
  createRoutingItemsProjector,
} from "./executionVisitIndex";
import { indexedItem, itemPositions, registerItemChanges } from "./itemIndex";
import {
  createFocusNavigatorEntriesProjector,
  createRouteEntriesProjector,
} from "../features/space-navigation/domain/navigatorEntriesProjector";
import { emptyApplicationSnapshot } from "../app/state/useApplicationSnapshot";
import { planItemContentMutation } from "../app/state/itemFieldMutation";
const fixture = (index: number, concentrated = false): ShoppingItem => ({
  id: `item-${index}`,
  circle: "サークル",
  title: `タイトル${index}`,
  block: "A",
  number: concentrated ? "01a" : String(index + 1) + "a",
  eventDate: "1日目",
  price: 500,
  quantity: 3,
  purchaseStatus: "None",
  remarks: "ユーザー登録",
  protectionLevel: "none",
  source: "app",
});
function update(
  items: ShoppingItem[],
  index: number,
  changes: Partial<ShoppingItem>,
) {
  const next = items.slice();
  next[index] = { ...items[index], ...changes };
  registerItemChanges(items, next, [index]);
  return next;
}
describe.each([150, 500, 1500])("incremental visits with %i items", (count) => {
  it.each([false, true])(
    "updates counts and only the affected visit (concentrated=%s)",
    (concentrated) => {
      const project = createExecutionVisitIndex();
      let items = Array.from({ length: count }, (_, index) =>
        fixture(index, concentrated),
      );
      const first = project(items);
      const positions = itemPositions(items);
      for (let index = 0; index < 40; index++) {
        items = update(items, 0, {
          purchaseStatus: index % 2 ? "Postpone" : "Purchased",
          remarks: "エラーが発生しました",
        });
        const next = project(items);
        expect(next.updatedVisitCount).toBe(1);
        expect(next.itemMembership).toBe(first.itemMembership);
        expect(next.visits[0].itemIds).toBe(first.visits[0].itemIds);
        expect(itemPositions(items)).toBe(positions);
        expect(indexedItem(items, "item-0")).toBe(items[0]);
        if (!concentrated) expect(next.visits[1]).toBe(first.visits[1]);
        expect(next.purchasedCount).toBe(index % 2 ? 0 : 1);
        expect(next.remainingCost).toBe((count - (index % 2 ? 0 : 1)) * 1500);
      }
    },
  );
});
it("retains fixed phase membership and excludes later postponed items", () => {
  const index = createExecutionVisitIndex();
  const phase = createPhaseVisitProjector();
  let items = [fixture(0), fixture(1), fixture(2)];
  items = update(items, 0, { purchaseStatus: "Postpone" });
  const initial = index(items);
  const fixedIds = new Set(initial.postponedItemIds);
  const first = phase(initial.visits, fixedIds);
  items = update(update(items, 0, { purchaseStatus: "Purchased" }), 1, {
    purchaseStatus: "Postpone",
  });
  const current = index(items);
  const next = phase(current.visits, fixedIds);
  expect(first[0].itemIds).toEqual(["item-0"]);
  expect(next.map((visit) => visit.itemIds)).toEqual([["item-0"]]);
  expect(next[0].items[0].purchaseStatus).toBe("Purchased");
});
it("preserves navigator and geometry entries for unchanged visits, rebuilding structural edits", () => {
  const index = createExecutionVisitIndex();
  const navigation = createFocusNavigatorEntriesProjector();
  const route = createRouteEntriesProjector();
  const routing = createRoutingItemsProjector();
  let items = [fixture(0), fixture(1)];
  const originalItems = items;
  const first = navigation({ normal: index(items).visits });
  const firstRoute = route(first);
  expect(routing(items)).toBe(originalItems);
  items = update(items, 0, { price: 800, purchaseStatus: "SoldOut" });
  const next = navigation({ normal: index(items).visits });
  expect(next[1]).toBe(first[1]);
  expect(next[0].statusCounts.completed).toBe(1);
  expect(route(next)).toBe(firstRoute);
  expect(routing(items)).toBe(originalItems);
  items = update(items, 0, { number: "99a" });
  const moved = index(items);
  expect(moved.itemMembership).not.toBe(index(originalItems).itemMembership);
  expect(route(navigation({ normal: moved.visits }))).not.toBe(firstRoute);
  expect(routing(items)).toBe(items);
  expect(index(items.slice(1)).visits).toHaveLength(1);
});
it("normalizes a 1500-item bulk command once and retains unrelated objects", () => {
  const items = Array.from({ length: 1500 }, (_, index) => fixture(index));
  const source = {
    ...emptyApplicationSnapshot(),
    eventLists: { event: items },
    dayModes: { event: { "1日目": "execute" } },
  };
  const edits = items.slice(0, 500).map((item) => ({
    eventName: "event",
    itemId: item.id,
    baseline: item as unknown as Record<string, unknown>,
    fields: {
      purchaseStatus: { present: true, value: "LimitedPurchase" },
      limitedPurchasedQuantity: { present: true, value: 2 },
    },
  }));
  const result = planItemContentMutation(source, edits);
  expect(result.snapshot.eventLists.event[499]).toMatchObject({
    purchaseStatus: "LimitedPurchase",
    limitedPurchasedQuantity: 2,
    protectionLevel: "deletable",
  });
  expect(result.snapshot.eventLists.event[500]).toBe(items[500]);
  expect(items[0].purchaseStatus).toBe("None");
  expect(result.itemContentEdits).toHaveLength(500);
});
