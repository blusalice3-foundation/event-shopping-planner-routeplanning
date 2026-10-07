import type { CellData, DayMapData } from "../../../types/map";

export interface CellViewport {
  readonly minRow: number;
  readonly maxRow: number;
  readonly minCol: number;
  readonly maxCol: number;
}

interface IndexedCell {
  readonly cell: CellData;
  readonly index: number;
}

export interface MapCellViewportIndex {
  readonly select: (
    bounds: CellViewport,
    includeMergedAnchors?: boolean,
  ) => CellData[];
}

/** Preserve source draw order, including merged anchors outside the viewport. */
export const createMapCellViewportIndex = (
  map: DayMapData,
): MapCellViewportIndex => {
  const rows = new Map<number, IndexedCell[]>();
  const cellsByKey = new Map<string, IndexedCell[]>();
  map.cells.forEach((cell, index) => {
    const entry = { cell, index };
    const members = rows.get(cell.row) ?? [];
    members.push(entry);
    rows.set(cell.row, members);
    const key = cell.row + "-" + cell.col;
    const sameCell = cellsByKey.get(key) ?? [];
    sameCell.push(entry);
    cellsByKey.set(key, sameCell);
  });
  const rowNumbers = [...rows.keys()].sort((a, b) => a - b);
  const firstAtOrAfter = (value: number): number => {
    let low = 0;
    let high = rowNumbers.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (rowNumbers[middle] < value) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  return {
    select: (bounds, includeMergedAnchors = false) => {
      const selected = new Map<number, CellData>();
      for (
        let rowIndex = firstAtOrAfter(bounds.minRow);
        rowIndex < rowNumbers.length && rowNumbers[rowIndex] <= bounds.maxRow;
        rowIndex += 1
      ) {
        for (const entry of rows.get(rowNumbers[rowIndex]) ?? []) {
          if (
            entry.cell.col >= bounds.minCol &&
            entry.cell.col <= bounds.maxCol
          )
            selected.set(entry.index, entry.cell);
        }
      }
      if (includeMergedAnchors) {
        for (const merge of map.mergedCells) {
          if (
            merge.endRow < bounds.minRow ||
            merge.startRow > bounds.maxRow ||
            merge.endCol < bounds.minCol ||
            merge.startCol > bounds.maxCol
          )
            continue;
          for (const entry of cellsByKey.get(
            merge.startRow + "-" + merge.startCol,
          ) ?? [])
            selected.set(entry.index, entry.cell);
        }
      }
      return [...selected.entries()]
        .sort((a, b) => a[0] - b[0])
        .map((entry) => entry[1]);
    },
  };
};
