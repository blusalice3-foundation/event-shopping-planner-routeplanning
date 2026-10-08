import type { ShoppingItem } from "../types/item";
import { sameItemRouting } from "./executionVisitIndex";
import {
  changedItemPositions,
  indexedItems,
  itemPositions,
  registerItemChanges,
} from "./itemIndex";

const sameContext = (before: readonly unknown[], after: readonly unknown[]) =>
  before.length === after.length &&
  after.every((value, index) => value === before[index]);

/** Project content edits into an existing order without rebuilding membership. */
export function createItemProjection(
  build: (items: readonly ShoppingItem[]) => ShoppingItem[],
  structural = (before: ShoppingItem, after: ShoppingItem) =>
    !sameItemRouting(before, after),
) {
  let previous: readonly ShoppingItem[] | undefined;
  let previousContext: readonly unknown[] = [];
  let value: ShoppingItem[];
  return (
    items: readonly ShoppingItem[],
    context: readonly unknown[] = [],
  ): ShoppingItem[] => {
    const changes =
      previous && sameContext(previousContext, context)
        ? changedItemPositions(previous, items)
        : null;
    if (
      changes === null ||
      changes.some((index) => structural(previous![index], items[index]))
    ) {
      value = build(items);
      itemPositions(value);
    } else if (changes.length) {
      const positions = itemPositions(value);
      let next = value;
      const updated: number[] = [];
      for (const index of changes) {
        const position = positions.get(items[index].id);
        if (position === undefined || value[position] === items[index])
          continue;
        if (next === value) next = value.slice();
        next[position] = items[index];
        updated.push(position);
      }
      registerItemChanges(value, next, updated);
      value = next;
    }
    previous = items;
    previousContext = context;
    return value!;
  };
}

export function createOrderedItemsProjector() {
  let ids: readonly string[] = [];
  const project = createItemProjection(
    (items) => {
      const lookup = indexedItems(items);
      return ids.flatMap((id) => {
        const item = lookup.get(id);
        return item ? [item] : [];
      });
    },
    () => false,
  );
  return (items: readonly ShoppingItem[], selectedIds: readonly string[]) => {
    ids = selectedIds;
    return project(items, [selectedIds]);
  };
}

/** Evaluate only changed members; insertion/removal preserves source ordering. */
export function createFilteredItemsProjector() {
  let previous: readonly ShoppingItem[] | undefined;
  let previousContext: readonly unknown[] = [];
  let value: ShoppingItem[] = [];
  return (
    items: readonly ShoppingItem[],
    include: (item: ShoppingItem) => boolean,
    context: readonly unknown[] = [],
    reconsiderIds: Iterable<string> = [],
  ): ShoppingItem[] => {
    const changes =
      previous && sameContext(previousContext, context)
        ? changedItemPositions(previous, items)
        : null;
    if (changes === null) {
      value = items.filter(include);
      itemPositions(value);
    } else {
      const candidates = new Set(changes.map((index) => items[index].id));
      for (const id of reconsiderIds) candidates.add(id);
      if (candidates.size) {
        const sourcePositions = itemPositions(items);
        const positions = itemPositions(value);
        let next = value;
        let membershipChanged = false;
        const replaced: number[] = [];
        for (const id of candidates) {
          const sourcePosition = sourcePositions.get(id);
          const item =
            sourcePosition === undefined ? undefined : items[sourcePosition];
          const position = membershipChanged
            ? next.findIndex((member) => member.id === id)
            : (positions.get(id) ?? -1);
          const selected = item !== undefined && include(item);
          if (selected && position >= 0) {
            if (next[position] !== item) {
              if (next === value) next = value.slice();
              next[position] = item;
              replaced.push(position);
            }
          } else if (selected || position >= 0) {
            if (next === value) next = value.slice();
            if (position >= 0) next.splice(position, 1);
            else {
              let low = 0,
                high = next.length;
              while (low < high) {
                const middle = (low + high) >>> 1;
                if (sourcePositions.get(next[middle].id)! < sourcePosition!)
                  low = middle + 1;
                else high = middle;
              }
              next.splice(low, 0, item!);
            }
            membershipChanged = true;
          }
        }
        if (!membershipChanged) registerItemChanges(value, next, replaced);
        else itemPositions(next);
        value = next;
      }
    }
    previous = items;
    previousContext = context;
    return value;
  };
}

/** Derived metadata is recalculated only when one of its own fields changes. */
export function createItemValueProjector<T>() {
  let previous: readonly ShoppingItem[] | undefined;
  let previousContext: readonly unknown[] = [];
  let value: T;
  return (
    items: readonly ShoppingItem[],
    context: readonly unknown[],
    relevant: (before: ShoppingItem, after: ShoppingItem) => boolean,
    build: () => T,
  ): T => {
    const changes =
      previous && sameContext(previousContext, context)
        ? changedItemPositions(previous, items)
        : null;
    if (
      changes === null ||
      changes.some((index) => relevant(previous![index], items[index]))
    )
      value = build();
    previous = items;
    previousContext = context;
    return value!;
  };
}

export function changedSetMembers(
  previous: ReadonlySet<string> | undefined,
  next: ReadonlySet<string>,
): string[] {
  if (previous === next) return [];
  if (!previous) return [...next];
  return [...previous]
    .filter((id) => !next.has(id))
    .concat([...next].filter((id) => !previous.has(id)));
}
