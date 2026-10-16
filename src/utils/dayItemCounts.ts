import type { ShoppingItem } from "../types/item";
import { normalizeExecutionVisitDay } from "./visitProjection";
import { changedItemPositions } from "./itemIndex";

/** One index per immutable event array; content edits reuse the existing counts. */
export function createDayItemCountSelector() {
  let previous: readonly ShoppingItem[] | undefined;
  let counts: ReadonlyMap<string, number> = new Map();
  return (items: readonly ShoppingItem[]): ReadonlyMap<string, number> => {
    if (items === previous) return counts;
    const changes = previous ? changedItemPositions(previous, items) : null;
    if (previous && changes !== null) {
      let next: Map<string, number> | undefined;
      for (const index of changes) {
        const before = normalizeExecutionVisitDay(previous[index].eventDate);
        const after = normalizeExecutionVisitDay(items[index].eventDate);
        if (before === after) continue;
        next ??= new Map(counts);
        next.set(before, (next.get(before) ?? 0) - 1);
        next.set(after, (next.get(after) ?? 0) + 1);
      }
      counts = next ?? counts;
    } else {
      const next = new Map<string, number>();
      for (const item of items) {
        const day = normalizeExecutionVisitDay(item.eventDate);
        next.set(day, (next.get(day) ?? 0) + 1);
      }
      counts = next;
    }
    previous = items;
    return counts;
  };
}
