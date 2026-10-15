import { expect, it } from "vitest";
import type { ShoppingItem } from "../types/item";
import type { DayMapData } from "../types/map";
import { createDayItemCountSelector } from "./dayItemCounts";
import { registerItemChanges } from "./itemIndex";
import { buildSelectedHallRouteMapData } from "./mapRouteMapData";
import { computeMoveItemVertical } from "../features/events/itemOps/move";

const item = (id: string, eventDate: string): ShoppingItem => ({
  id,
  eventDate,
  circle: id,
  title: id,
  block: "A",
  number: id,
  price: 500,
  quantity: 1,
  remarks: "ユーザー登録",
  purchaseStatus: "None",
});
it("counts the same normalized days as the list and reuses counts for content edits", () => {
  const select = createDayItemCountSelector();
  const initial = [
    item("1", " １日目　"),
    item("2", "１日目"),
    item("3", "11日目"),
    item("4", "1日目"),
  ];
  const counts = select(initial);
  expect([...counts]).toEqual([
    ["１日目", 2],
    ["11日目", 1],
    ["1日目", 1],
  ]);
  const content = [...initial];
  content[0] = { ...initial[0], remarks: "エラーが発生しました" };
  registerItemChanges(initial, content, [0]);
  expect(select(content)).toBe(counts);
  const moved = [...content];
  moved[0] = { ...content[0], eventDate: "11日目" };
  registerItemChanges(content, moved, [0]);
  expect([...select(moved)]).toEqual([
    ["１日目", 1],
    ["11日目", 2],
    ["1日目", 1],
  ]);
  expect(select([...moved, item("5", "１日目")]).get("１日目")).toBe(2);
});
it("reorders only the current day's candidates using its actual saved execution key", () => {
  const items = [
    item("1", " 1日目　"),
    item("2", "11日目"),
    item("3", "1日目"),
    item("4", "1日目"),
  ];
  const result = computeMoveItemVertical(
    "up",
    "4",
    "candidate",
    "edit",
    new Set(),
    items,
    { " 1日目　": ["1"] },
    "1日目",
    () => true,
  );
  expect(result.eventListItems?.map((record) => record.id)).toEqual([
    "1",
    "2",
    "4",
    "3",
  ]);
  expect(result.eventListItems?.[0]).toBe(items[0]);
});
it("filters 300 by 500 cells without spreading an input-sized argument list", () => {
  const cells = Array.from({ length: 150000 }, (_, index) => ({
    row: Math.floor(index / 500) + 1,
    col: (index % 500) + 1,
    value: null,
    backgroundColor: null,
    borders: { top: null, right: null, bottom: null, left: null },
  }));
  const data: DayMapData = {
    maxRow: 300,
    maxCol: 500,
    cells,
    blocks: [],
    mergedCells: [],
  };
  const result = buildSelectedHallRouteMapData(data, {
    id: "hall",
    name: "全域",
    vertices: [
      { row: 1, col: 1 },
      { row: 1, col: 500 },
      { row: 300, col: 500 },
      { row: 300, col: 1 },
    ],
  });
  expect(result?.strictFilteredMapData.cells).toHaveLength(150000);
  expect(result?.strictFilteredMapData).toMatchObject({
    maxRow: 300,
    maxCol: 500,
  });
  expect(
    result?.routePathConstraint.isPathAllowed([
      { row: 2, col: 2 },
      { row: 299, col: 499 },
    ]),
  ).toBe(true);
});
