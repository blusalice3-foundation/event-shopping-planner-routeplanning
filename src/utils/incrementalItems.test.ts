import { describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../types/item";
import {
  indexedItems,
  itemPositions,
  registerItemChanges,
  stableItemIds,
} from "./itemIndex";
import {
  createFilteredItemsProjector,
  createOrderedItemsProjector,
} from "./incrementalItems";
import { createAppListViewProjectors } from "../app/selectors/incrementalAppListView";
import {
  selectExecuteColumnItems,
  selectCandidateColumnItems,
  selectBaseFilteredItems,
  selectTemporaryVisibleItems,
  selectVisibleItems,
} from "../app/selectors/appListViewSelectors";
import { createListRowsProjector } from "../features/shopping-list/model/buildListRows";

const fixture = (index: number): ShoppingItem => ({
  id: `item-${index}`,
  block: "A",
  number: String(index),
  circle: "ユーザー登録",
  title: "新刊",
  eventDate: "1日目",
  price: 500,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "エラーが発生しました",
});
const edit = (
  items: ShoppingItem[],
  index: number,
  changes: Partial<ShoppingItem>,
) => {
  const next = items.slice();
  next[index] = { ...items[index], ...changes };
  registerItemChanges(items, next, [index]);
  return next;
};

describe.each([150, 500, 1500])("incremental view with %i items", (count) => {
  it("checks only a changed member and preserves ordering when it leaves and reenters a filter", () => {
    const project = createFilteredItemsProjector();
    const include = vi.fn(
      (item: ShoppingItem) => item.purchaseStatus === "None",
    );
    let items = Array.from({ length: count }, (_, index) => fixture(index));
    const first = project(items, include);
    include.mockClear();
    items = edit(items, 50, { purchaseStatus: "Purchased" });
    const removed = project(items, include);
    expect(include).toHaveBeenCalledTimes(1);
    expect(removed).toHaveLength(count - 1);
    expect(removed[49]).toBe(first[49]);
    expect(removed[50]).toBe(first[51]);
    include.mockClear();
    items = edit(items, 50, { purchaseStatus: "None" });
    const restored = project(items, include);
    expect(include).toHaveBeenCalledTimes(1);
    expect(restored.map((item) => item.id)).toEqual(
      first.map((item) => item.id),
    );
  });
  it("keeps row IDs and sibling row objects through chained edits and save acknowledgements", () => {
    const project = createListRowsProjector();
    let items = Array.from({ length: count }, (_, index) => fixture(index));
    const first = project({ items });
    items = edit(edit(items, 0, { purchaseStatus: "Purchased" }), 0, {
      remarks: "記録済み",
    });
    const next = project({ items });
    expect(next.itemRows[1]).toBe(first.itemRows[1]);
    expect(next.itemRows[0].item.remarks).toBe("記録済み");
    expect(next.rowKeys).toBe(first.rowKeys);
    expect(next.itemIds).toBe(first.itemIds);
    expect(project({ items })).toBe(next);
  });
});

it("shares immutable lookup positions and ordered membership while reflecting latest values", () => {
  let items = [fixture(0), fixture(1), fixture(2)];
  const first = indexedItems(items),
    positions = itemPositions(items);
  const project = createOrderedItemsProjector(),
    ids = ["item-2", "item-0"];
  const ordered = project(items, ids);
  const membership = stableItemIds(ordered);
  items = edit(items, 0, { purchaseStatus: "SoldOut" });
  const next = project(items, ids);
  expect(itemPositions(items)).toBe(positions);
  expect(first.get("item-0")?.purchaseStatus).toBe("None");
  expect(indexedItems(items).get("item-0")).toBe(items[0]);
  expect(next[0]).toBe(ordered[0]);
  expect(next[1]).toBe(items[0]);
  expect(stableItemIds(next)).toBe(membership);
  const structural = [items[2], items[1], fixture(3)];
  expect(project(structural, ids).map((item) => item.id)).toEqual(["item-2"]);
});

it("matches canonical execution filtering, temporary visibility and candidate ordering across rapid operations", () => {
  const project = createAppListViewProjectors();
  let items = [
    fixture(0),
    fixture(1),
    { ...fixture(2), number: "0" },
    fixture(3),
  ];
  const executeModeItems = {
    event: { "1日目": ["item-0", "item-1", "item-2"] },
  };
  const dayModes = { event: { "1日目": "execute" as const } };
  const common = {
    activeEventName: "event",
    activeEventDate: "1日目",
    executeModeItems,
  };
  let recent = new Set<string>();
  for (const [index, status] of [
    [0, "Purchased"],
    [1, "Postpone"],
    [0, "None"],
    [2, "Late"],
  ] as const) {
    items = edit(items, index, { purchaseStatus: status });
    recent = new Set([...recent, items[index].id]);
    const execute = project.execute({ ...common, items });
    expect(execute).toEqual(selectExecuteColumnItems({ ...common, items }));
    const currentTabItems = project.day(items, "1日目", true);
    for (const sortState of [
      "Manual",
      "Postpone",
      "Late",
      "Purchased",
      "None",
    ] as const) {
      const input = {
        ...common,
        dayModes,
        sortState,
        currentTabItems,
        executeColumnItems: execute,
      };
      const base = project.base(input);
      expect(base).toEqual(selectBaseFilteredItems(input));
      const temporaryInput = {
        ...input,
        baseFilteredItems: base,
        recentlyChangedItemIds: recent,
      };
      const temporary = project.temporary(temporaryInput);
      expect(temporary).toEqual(selectTemporaryVisibleItems(temporaryInput));
      const visibleInput = {
        ...input,
        baseFilteredItems: base,
        temporaryVisibleItems: temporary,
      };
      expect(project.visible(visibleInput).visibleItems).toEqual(
        selectVisibleItems(visibleInput).visibleItems,
      );
    }
    const candidateInput = {
      ...common,
      currentTabItems,
      selectedBlockFilters: new Set<string>(),
      candidateNumberSortDirection: null,
    };
    expect(project.candidate(candidateInput)).toEqual(
      selectCandidateColumnItems(candidateInput),
    );
  }
});

it("does not rebuild unrelated metadata for purchases, but refreshes edited circle and membership", () => {
  const project = createAppListViewProjectors();
  let items = [fixture(0), fixture(1)];
  const metadata = {
    activeEventName: "event",
    activeTab: "1日目",
    eventDates: ["1日目"],
  };
  const first = project.duplicates({ ...metadata, currentTabItems: items });
  items = edit(items, 0, { purchaseStatus: "Purchased" });
  expect(project.duplicates({ ...metadata, currentTabItems: items })).toBe(
    first,
  );
  items = edit(items, 0, { circle: "別サークル" });
  expect(project.duplicates({ ...metadata, currentTabItems: items }).size).toBe(
    0,
  );
  const projectRows = createListRowsProjector();
  const initial = projectRows({
    items,
    groups: [{ key: "visit", label: "スペース", items }],
  });
  const collapsed = projectRows({
    items,
    groups: [{ key: "visit", label: "スペース", items, collapsed: true }],
  });
  expect(collapsed.itemRows).toHaveLength(0);
  expect(collapsed.rowKeys).not.toBe(initial.rowKeys);
});
