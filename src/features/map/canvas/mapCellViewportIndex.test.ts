import { describe, expect, it } from "vitest";
import type { DayMapData } from "../../../types/map";
import { createMapCellViewportIndex } from "./mapCellViewportIndex";

const map: DayMapData = {
  maxRow: 1000000,
  maxCol: 20,
  blocks: [],
  mergedCells: [
    { startRow: 2, startCol: 2, endRow: 5, endCol: 6, value: "結合セル" },
  ],
  cells: [
    {
      row: 5,
      col: 6,
      value: 1,
      backgroundColor: null,
      borders: { top: null, right: null, bottom: null, left: null },
    },
    {
      row: 2,
      col: 2,
      value: "結合セル",
      backgroundColor: null,
      borders: { top: null, right: null, bottom: null, left: null },
    },
    {
      row: 1000000,
      col: 3,
      value: 2,
      backgroundColor: null,
      borders: { top: null, right: null, bottom: null, left: null },
    },
    {
      row: 5,
      col: 6,
      value: "同座標",
      backgroundColor: null,
      borders: { top: null, right: null, bottom: null, left: null },
    },
    {
      row: 3,
      col: 10,
      value: 3,
      backgroundColor: null,
      borders: { top: null, right: null, bottom: null, left: null },
    },
  ],
};

describe("map cell viewport index", () => {
  it("matches the original scan order and keeps duplicate source cells", () => {
    const index = createMapCellViewportIndex(map);
    expect(
      index.select({ minRow: 5, maxRow: 5, minCol: 6, maxCol: 6 }),
    ).toEqual([map.cells[0], map.cells[3]]);
  });
  it("includes a merged origin outside the viewport exactly once", () => {
    const index = createMapCellViewportIndex(map);
    expect(
      index.select({ minRow: 5, maxRow: 5, minCol: 6, maxCol: 6 }, true),
    ).toEqual([map.cells[0], map.cells[1], map.cells[3]]);
    expect(
      index.select({ minRow: 2, maxRow: 5, minCol: 2, maxCol: 6 }, true),
    ).toEqual([map.cells[0], map.cells[1], map.cells[3]]);
  });
  it("excludes a merged cell that does not overlap and handles sparse rows", () => {
    const index = createMapCellViewportIndex(map);
    expect(
      index.select(
        { minRow: 999999, maxRow: 1000000, minCol: 1, maxCol: 4 },
        true,
      ),
    ).toEqual([map.cells[2]]);
    expect(
      index.select({ minRow: -5, maxRow: 1, minCol: 1, maxCol: 20 }, true),
    ).toEqual([]);
  });
  it("does not mutate the source or retain cells from a replacement index", () => {
    const replacement = {
      ...map,
      cells: [{ ...map.cells[0], value: "変更後" }],
    };
    const old = JSON.stringify(map);
    const bounds = { minRow: 1, maxRow: 10, minCol: 1, maxCol: 20 };
    expect(
      createMapCellViewportIndex(replacement).select(bounds)[0].value,
    ).toBe("変更後");
    expect(JSON.stringify(map)).toBe(old);
    expect(createMapCellViewportIndex(map).select(bounds)[0].value).toBe(1);
  });
});
