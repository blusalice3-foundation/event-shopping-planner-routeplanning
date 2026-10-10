import type {
  DayMapData,
  RoutePathConstraint,
  RouteSegment,
} from "../../../../types/map";
import { buildDayMapPathfindingSignature } from "../../../../utils/mapRoutingSignature";
import { isRoutePathInsideHallPolygon } from "../../../../utils/mapRoutePolygon";
import {
  generateRouteSegments,
  simplifyPath,
  type RouteVisitPoint,
} from "../../../../utils/pathfinding";
import {
  calculateStrictFocusRoute,
  type FocusRouteCalculation,
  type FocusRouteCell,
} from "../../../../utils/focusRouteCalculation";
import {
  calculateRouteSegmentsPair,
  type RouteSegmentsPairParams,
  type RouteSegmentsPair,
} from "../../../../components/map/mapViewRouteCalculations";

export type RouteJob =
  | {
      kind: "pair";
      params: Omit<RouteSegmentsPairParams, "mapInsertPathConstraint">;
      constraint?: RoutePathConstraint["definition"];
    }
  | {
      kind: "focus";
      enabled?: boolean;
      mapData: DayMapData | null;
      visitKeys: string[];
      cells: ReadonlyMap<string, FocusRouteCell>;
    }
  | {
      kind: "segments";
      mapData: DayMapData;
      points: RouteVisitPoint[];
      enabled: boolean;
    };
export interface RouteJobResults {
  pair: RouteSegmentsPair;
  focus: FocusRouteCalculation;
  segments: RouteSegment[];
}
const signatures = new WeakMap<DayMapData, string>();
export function routeMapKey(map: DayMapData | null): string {
  if (!map) return "null";
  let key = signatures.get(map);
  if (!key) signatures.set(map, (key = buildDayMapPathfindingSignature(map)));
  return key;
}
const routePointsKey = (points: RouteVisitPoint[]) =>
  points.map(({ row, col, priorityLevel, itemId, order }) => [
    row,
    col,
    priorityLevel ?? "none",
    itemId,
    order,
  ]);
export function routeJobKey(job: RouteJob): string {
  if (job.kind === "pair")
    return JSON.stringify([
      job.kind,
      routeMapKey(job.params.displayMapData),
      routeMapKey(job.params.mapInsertMapData),
      routePointsKey(job.params.displayRoutePoints),
      routePointsKey(job.params.mapInsertRoutePoints),
      job.constraint,
      job.params.includeDisplayRoute,
      job.params.includeMapInsertRoute,
    ]);
  if (job.kind === "focus")
    return JSON.stringify([
      job.kind,
      routeMapKey(job.mapData),
      job.visitKeys,
      [...job.cells],
    ]);
  return JSON.stringify([
    job.kind,
    routeMapKey(job.mapData),
    routePointsKey(job.points),
    job.enabled,
  ]);
}
export function calculateRouteJob(
  job: RouteJob,
): RouteJobResults[RouteJob["kind"]] {
  if (job.kind === "pair")
    return calculateRouteSegmentsPair({
      ...job.params,
      mapInsertPathConstraint: job.constraint
        ? {
            definition: job.constraint,
            isPathAllowed: (path) =>
              isRoutePathInsideHallPolygon(path, job.constraint!.vertices),
          }
        : undefined,
    });
  if (job.kind === "focus")
    return calculateStrictFocusRoute(job.mapData, job.visitKeys, job.cells);
  return job.enabled
    ? generateRouteSegments(job.mapData, job.points).map((segment) => ({
        ...segment,
        path: simplifyPath(segment.path),
      }))
    : [];
}
export function emptyRouteJobResult(
  job: RouteJob,
): RouteJobResults[RouteJob["kind"]] {
  if (job.kind === "pair")
    return {
      displayRouteSegments: [],
      mapInsertRouteSegments: [],
      displayRouteState: "idle",
    };
  if (job.kind === "focus")
    return {
      segments: [],
      missingVisitKeys: job.visitKeys.filter((key) => !job.cells.has(key)),
      validLocationCount: job.visitKeys.filter((key) => job.cells.has(key))
        .length,
      unreachable: false,
    };
  return [];
}
