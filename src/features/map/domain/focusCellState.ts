import type { ShoppingItem } from "../../../types/item";
import type { DayMapData } from "../../../types/map";
import { normalizeExecutionVisitDay } from "../../../utils/visitProjection";
import { resolveLocation } from "../../consistency/domain/membership";
import {
  countNavigatorStatuses,
  getNavigatorStatusKind,
} from "../../space-navigation/domain/statusSegments";

export function collectFocusCellItems(
  items: readonly ShoppingItem[],
  executeIds: readonly string[],
  day: string,
  mapData: DayMapData,
): {
  execution: Map<string, ShoppingItem[]>;
  candidates: Map<string, ShoppingItem[]>;
} {
  const execution = new Map<string, ShoppingItem[]>();
  const candidates = new Map<string, ShoppingItem[]>();
  const ids = new Set(executeIds);
  const seen = new Set<string>();
  const normalizedDay = normalizeExecutionVisitDay(day);
  for (const item of items) {
    if (
      seen.has(item.id) ||
      normalizeExecutionVisitDay(item.eventDate) !== normalizedDay
    )
      continue;
    seen.add(item.id);
    const location = resolveLocation(mapData, item);
    if (location.status !== "resolved") continue;
    const cell = location.location.cell;
    const key = [cell.row, cell.col].join("-");
    const target = ids.has(item.id) ? execution : candidates;
    const members = target.get(key) ?? [];
    members.push(item);
    target.set(key, members);
  }
  return { execution, candidates };
}

export function summarizeFocusCell(items: readonly ShoppingItem[]) {
  const all = (predicate: (item: ShoppingItem) => boolean) =>
    items.length > 0 && items.every(predicate);
  const isVisited = all((item) => getNavigatorStatusKind(item) === "completed");
  const allPostponed = all((item) => item.purchaseStatus === "Postpone");
  const allLate = all((item) => item.purchaseStatus === "Late");
  const counts = countNavigatorStatuses([
    ...new Map(items.map((item) => [item.id, item])).values(),
  ]);
  const segments = [
    { label: "未", count: counts.unvisited },
    { label: "後", count: counts.postponed },
    { label: "遅", count: counts.late },
    { label: "限未", count: counts.limited },
    { label: "済", count: counts.completed },
  ].filter(({ count }) => count > 0);
  const statusLabel = segments
    .map(({ label, count }) => (segments.length > 1 ? label + count : label))
    .join("・");
  return {
    statusLabel,
    hasItems: items.length > 0,
    isVisited,
    allNone: all((item) => item.purchaseStatus === "None"),
    allProcessed: isVisited || allPostponed || allLate,
    hasPostponed: items.some((item) => item.purchaseStatus === "Postpone"),
    hasLate: items.some((item) => item.purchaseStatus === "Late"),
    allPostponed,
    allLate,
  };
}
