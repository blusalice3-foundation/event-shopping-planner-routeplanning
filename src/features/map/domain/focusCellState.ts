import {
  changedItemPositions,
  registerItemChanges,
} from "../../../utils/itemIndex";
import { sameItemRouting } from "../../../utils/executionVisitIndex";
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
  resolveItemLocation: typeof resolveLocation = resolveLocation,
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
    const location = resolveItemLocation(mapData, item);
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

/** Reuse coordinate membership for content edits and replace only affected cells. */
export function createFocusCellItemsProjector() {
  let previous: readonly ShoppingItem[] | undefined;
  let previousContext: readonly unknown[] = [];
  let value: ReturnType<typeof collectFocusCellItems>;
  let membership = new Map<
    string,
    { category: "execution" | "candidates"; key: string; index: number }
  >();
  return (...args: Parameters<typeof collectFocusCellItems>) => {
    const [items, ids, day, map, resolver] = args;
    const context = [ids, day, map, resolver];
    const changes =
      previous &&
      context.every((input, index) => input === previousContext[index])
        ? changedItemPositions(previous, items)
        : null;
    if (
      changes === null ||
      changes.some((index) => !sameItemRouting(previous![index], items[index]))
    ) {
      value = collectFocusCellItems(...args);
      membership = new Map();
      for (const category of ["execution", "candidates"] as const)
        for (const [key, members] of value[category])
          members.forEach((item, index) =>
            membership.set(item.id, { category, key, index }),
          );
    } else if (changes.length) {
      const next = { ...value };
      const updated = new Map<string, number[]>();
      for (const position of changes) {
        const item = items[position];
        const location = membership.get(item.id);
        if (!location) continue;
        const key = location.category + ":" + location.key;
        let indices = updated.get(key);
        if (!indices) {
          indices = [];
          updated.set(key, indices);
          if (next[location.category] === value[location.category])
            next[location.category] = new Map(value[location.category]);
          next[location.category].set(
            location.key,
            value[location.category].get(location.key)!.slice(),
          );
        }
        next[location.category].get(location.key)![location.index] = item;
        indices.push(location.index);
      }
      for (const [key, indices] of updated) {
        const [category, cell] = key.split(":") as [
          "execution" | "candidates",
          string,
        ];
        registerItemChanges(
          value[category].get(cell)!,
          next[category].get(cell)!,
          indices,
        );
      }
      if (updated.size) value = next;
    }
    previous = items;
    previousContext = context;
    return value!;
  };
}
