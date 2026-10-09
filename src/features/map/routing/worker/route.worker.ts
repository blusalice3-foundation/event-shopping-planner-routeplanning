import { calculateRouteJob, routeMapKey, type RouteJob } from "./routeJob";
import type { DayMapData } from "../../../../types/map";
// Reuse map identity so pathfinding can reuse only the unchanged route prefix.
const maps = new Map<string, DayMapData>();
function intern(map: DayMapData | null): DayMapData | null {
  if (!map) return null;
  const key = routeMapKey(map);
  const previous = maps.get(key);
  if (previous) return previous;
  if (maps.size >= 4) maps.delete(maps.keys().next().value!);
  maps.set(key, map);
  return map;
}
self.onmessage = (event: MessageEvent<{ key: string; job: RouteJob }>) => {
  const { key, job } = event.data;
  try {
    if (job.kind === "pair") {
      job.params.displayMapData = intern(job.params.displayMapData)!;
      job.params.mapInsertMapData = intern(job.params.mapInsertMapData);
    } else job.mapData = intern(job.mapData)!;
    self.postMessage({ key, result: calculateRouteJob(job) });
  } catch (error) {
    self.postMessage({
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
