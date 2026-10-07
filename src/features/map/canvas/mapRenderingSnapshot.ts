import type { DayMapData } from "../../../types/map";
import { createLocationResolver } from "../../consistency/domain/membership";
import {
  buildDayMapPathfindingSignature,
  buildDayMapVisitLookupSignature,
} from "../../../utils/mapRoutingSignature";
import { createMapCellViewportIndex } from "./mapCellViewportIndex";

/** UI snapshots only: the common command/persistence validation path is unchanged. */
const snapshots = new WeakMap<DayMapData, ReturnType<typeof createSnapshot>>();

interface CachedViewportIndex {
  readonly index: ReturnType<typeof createMapCellViewportIndex>;
  readonly cellCount: number;
  readonly release: () => void;
}
const viewportIndexes: CachedViewportIndex[] = [];
const MAX_RETAINED_INDEX_CELLS = 100_000;
let retainedCellCount = 0;

const createSnapshot = (map: DayMapData) => {
  let lookupSignature: string | undefined;
  let pathSignature: string | undefined;
  let viewportIndex: CachedViewportIndex | undefined;
  return {
    cells: map.cells,
    blocks: map.blocks,
    mergedCells: map.mergedCells,
    maxRow: map.maxRow,
    maxCol: map.maxCol,
    resolveLocation: createLocationResolver(map),
    visitLookupSignature: () =>
      (lookupSignature ??= buildDayMapVisitLookupSignature(map)),
    pathfindingSignature: () =>
      (pathSignature ??= buildDayMapPathfindingSignature(map)),
    cellViewportIndex: () => {
      if (viewportIndex) {
        const position = viewportIndexes.indexOf(viewportIndex);
        if (position >= 0) viewportIndexes.splice(position, 1);
      } else {
        viewportIndex = {
          index: createMapCellViewportIndex(map),
          cellCount: map.cells.length,
          release: () => {
            viewportIndex = undefined;
          },
        };
        retainedCellCount += viewportIndex.cellCount;
      }
      viewportIndexes.push(viewportIndex);
      // Keep the current index and at most 100k cells across recently shown maps.
      while (
        retainedCellCount > MAX_RETAINED_INDEX_CELLS &&
        viewportIndexes.length > 1
      ) {
        const oldest = viewportIndexes.shift()!;
        retainedCellCount -= oldest.cellCount;
        oldest.release();
      }
      return viewportIndex.index;
    },
  };
};

export const getMapRenderingSnapshot = (map: DayMapData) => {
  const existing = snapshots.get(map);
  if (
    existing &&
    existing.cells === map.cells &&
    existing.blocks === map.blocks &&
    existing.mergedCells === map.mergedCells &&
    existing.maxRow === map.maxRow &&
    existing.maxCol === map.maxCol
  )
    return existing;
  const snapshot = createSnapshot(map);
  snapshots.set(map, snapshot);
  return snapshot;
};

export const getMapVisitLookupRenderingSignature = (
  map: DayMapData | null | undefined,
): string =>
  map
    ? getMapRenderingSnapshot(map).visitLookupSignature()
    : JSON.stringify(null);
export const getMapPathfindingRenderingSignature = (
  map: DayMapData | null | undefined,
): string =>
  map
    ? getMapRenderingSnapshot(map).pathfindingSignature()
    : JSON.stringify(null);
