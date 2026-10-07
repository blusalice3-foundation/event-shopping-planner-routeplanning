import { describe, expect, it } from "vitest";
import type { DayMapData } from "../../../types/map";
import {
  getMapRenderingSnapshot,
  getMapVisitLookupRenderingSignature,
  getMapPathfindingRenderingSignature,
} from "./mapRenderingSnapshot";
import { resolveLocation } from "../../consistency/domain/membership";
import {
  buildDayMapPathfindingSignature,
  buildDayMapVisitLookupSignature,
} from "../../../utils/mapRoutingSignature";

const map: DayMapData = {
  maxRow: 5,
  maxCol: 5,
  mergedCells: [],
  cells: [
    {
      row: 1,
      col: 1,
      value: "通路",
      backgroundColor: null,
      borders: { top: null, right: null, bottom: null, left: null },
    },
  ],
  blocks: [
    {
      name: "A",
      startRow: 1,
      startCol: 1,
      endRow: 5,
      endCol: 5,
      numberCells: [
        { row: 3, col: 3, value: 1 },
        { row: 1, col: 2, value: 1 },
        { row: 1, col: 1, value: 1 },
      ],
    },
  ],
};

describe("shared map rendering snapshot", () => {
  it("shares one UI snapshot and preserves canonical lookup/path signatures", () => {
    expect(getMapRenderingSnapshot(map)).toBe(getMapRenderingSnapshot(map));
    expect(getMapVisitLookupRenderingSignature(map)).toBe(
      buildDayMapVisitLookupSignature(map),
    );
    expect(getMapPathfindingRenderingSignature(map)).toBe(
      buildDayMapPathfindingSignature(map),
    );
    expect(getMapRenderingSnapshot(map).cellViewportIndex()).toBe(
      getMapRenderingSnapshot(map).cellViewportIndex(),
    );
  });
  it.each([
    { block: "A", number: "01a" },
    { block: "a", number: "1" },
    { block: "Ａ", number: "１a" },
    { block: "A", number: "99" },
    { block: "", number: "?" },
  ])("keeps canonical location resolution for %j", (item) => {
    expect(getMapRenderingSnapshot(map).resolveLocation(item)).toEqual(
      resolveLocation(map, item),
    );
  });
  it("preserves ambiguous blocks and preferred coordinates within a block", () => {
    const ambiguous = {
      ...map,
      blocks: [
        ...map.blocks,
        { ...map.blocks[0], numberCells: [{ row: 5, col: 5, value: 1 }] },
      ],
    };
    expect(
      getMapRenderingSnapshot(map).resolveLocation({ block: "A", number: "1" }),
    ).toMatchObject({
      status: "resolved",
      location: { cell: { row: 1, col: 1 } },
    });
    expect(
      getMapRenderingSnapshot(ambiguous).resolveLocation({
        block: "A",
        number: "1",
      }),
    ).toEqual(resolveLocation(ambiguous, { block: "A", number: "1" }));
    expect(
      getMapRenderingSnapshot(ambiguous).resolveLocation({
        block: "A",
        number: "1",
      }).status,
    ).toBe("ambiguous");
  });
  it("invalidates on map replacement and source-array replacement without mutating the inputs", () => {
    const before = JSON.stringify(map);
    const snapshot = getMapRenderingSnapshot(map);
    const replacement = { ...map, cells: [{ ...map.cells[0], value: "壁" }] };
    expect(getMapRenderingSnapshot(replacement)).not.toBe(snapshot);
    expect(getMapPathfindingRenderingSignature(replacement)).not.toBe(
      getMapPathfindingRenderingSignature(map),
    );
    expect(JSON.stringify(map)).toBe(before);
    const owner = { ...map };
    const old = getMapRenderingSnapshot(owner);
    owner.blocks = [
      { ...owner.blocks[0], numberCells: [{ row: 5, col: 4, value: 1 }] },
    ];
    expect(getMapRenderingSnapshot(owner)).not.toBe(old);
    expect(
      getMapRenderingSnapshot(owner).resolveLocation({
        block: "A",
        number: "1",
      }),
    ).toMatchObject({ location: { cell: { row: 5, col: 4 } } });
  });
  it("bounds retained spatial indexes and rebuilds an evicted map without changing results", () => {
    const large = () => ({
      ...map,
      cells: Array.from({ length: 50_001 }, () => map.cells[0]),
    });
    const firstMap = large();
    const first = getMapRenderingSnapshot(firstMap).cellViewportIndex();
    getMapRenderingSnapshot(large()).cellViewportIndex();
    getMapRenderingSnapshot(large()).cellViewportIndex();
    const rebuilt = getMapRenderingSnapshot(firstMap).cellViewportIndex();
    expect(rebuilt).not.toBe(first);
    const bounds = { minRow: 2, maxRow: 5, minCol: 1, maxCol: 5 };
    expect(rebuilt.select(bounds)).toEqual(first.select(bounds));
  });

  it("keeps the missing-map signature contract", () => {
    expect(getMapVisitLookupRenderingSignature(null)).toBe("null");
    expect(getMapPathfindingRenderingSignature(undefined)).toBe("null");
  });
});
