import type {
  CellData,
  DayMapData,
  HallDefinition,
  RoutePathConstraint,
} from "../types/map";
import {
  isPointInPolygonInclusive,
  isRoutePathInsideHallPolygon,
} from "./mapRoutePolygon";

export interface SelectedHallRouteMapData {
  strictFilteredMapData: DayMapData;
  hallConstrainedPathfindingMapData: DayMapData;
  routePathConstraint: RoutePathConstraint;
}

const ROUTE_HALL_OUTSIDE_BLOCK_COLOR = "#000000";

const isPointInHall = (
  row: number,
  col: number,
  hall: HallDefinition,
): boolean => isPointInPolygonInclusive(row, col, hall.vertices);

function isMergedCellFullyInHall(
  merge: DayMapData["mergedCells"][number],
  hall: HallDefinition,
): boolean {
  for (let row = merge.startRow; row <= merge.endRow; row += 1) {
    for (let col = merge.startCol; col <= merge.endCol; col += 1) {
      if (!isPointInHall(row, col, hall)) return false;
    }
  }
  return true;
}

export function buildSelectedHallRouteMapData(
  mapData: DayMapData,
  hall: HallDefinition | undefined,
): SelectedHallRouteMapData | null {
  if (!hall || hall.vertices.length < 4) return null;

  const filteredCells = mapData.cells.filter((cell) =>
    isPointInHall(cell.row, cell.col, hall),
  );
  const filteredBlocks = mapData.blocks.map((block) => ({
    ...block,
    numberCells: block.numberCells.filter((numberCell) =>
      isPointInHall(numberCell.row, numberCell.col, hall),
    ),
    nameCells: block.nameCells?.filter((nameCell) =>
      isPointInHall(nameCell.row, nameCell.col, hall),
    ),
    cellGroups: block.cellGroups,
  }));
  const filteredMergedCells = mapData.mergedCells.filter((merge) =>
    isMergedCellFullyInHall(merge, hall),
  );
  let maxRow = -Infinity;
  let maxCol = -Infinity;
  const include = (row: number, col: number) => {
    maxRow = Math.max(maxRow, row);
    maxCol = Math.max(maxCol, col);
  };
  for (const cell of filteredCells) include(cell.row, cell.col);
  for (const block of filteredBlocks)
    for (const cell of block.numberCells) include(cell.row, cell.col);
  for (const merge of filteredMergedCells) {
    include(merge.startRow, merge.startCol);
    include(merge.endRow, merge.endCol);
  }
  const bounds =
    maxRow === -Infinity
      ? { maxRow: mapData.maxRow, maxCol: mapData.maxCol }
      : { maxRow, maxCol };

  const strictFilteredMapData: DayMapData = {
    ...mapData,
    cells: filteredCells,
    blocks: filteredBlocks,
    mergedCells: filteredMergedCells,
    maxRow: bounds.maxRow,
    maxCol: bounds.maxCol,
  };

  const cellsByKey = new Map<string, CellData>();
  mapData.cells.forEach((cell) =>
    cellsByKey.set(`${cell.row}-${cell.col}`, cell),
  );

  for (let row = 1; row <= mapData.maxRow; row += 1) {
    for (let col = 1; col <= mapData.maxCol; col += 1) {
      if (isPointInHall(row, col, hall)) continue;
      cellsByKey.set(`${row}-${col}`, {
        row,
        col,
        value: null,
        backgroundColor: ROUTE_HALL_OUTSIDE_BLOCK_COLOR,
        borders: { top: null, right: null, bottom: null, left: null },
      });
    }
  }

  return {
    strictFilteredMapData,
    hallConstrainedPathfindingMapData: {
      ...mapData,
      cells: [...cellsByKey.values()],
    },
    routePathConstraint: {
      definition: {
        rule: "inside-inclusive-v1",
        vertices: hall.vertices.map((point) => ({ ...point })),
      },
      isPathAllowed: (path) =>
        isRoutePathInsideHallPolygon(path, hall.vertices),
    },
  };
}
