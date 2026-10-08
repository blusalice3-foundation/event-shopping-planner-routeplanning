/** Immutable item arrays share their ID positions for field-only changes. */
const positions = new WeakMap<
  readonly unknown[],
  ReadonlyMap<string, number>
>();
type ArrayReference = { deref(): readonly unknown[] | undefined };
const WeakArrayReference = (
  globalThis as unknown as {
    WeakRef?: new (array: readonly unknown[]) => ArrayReference;
  }
).WeakRef;
const deltas = new WeakMap<
  readonly unknown[],
  { previous: ArrayReference; indices: readonly number[] }
>();
const itemId = (item: unknown): string | undefined => {
  if (!item || typeof item !== "object") return undefined;
  if ("id" in item && typeof item.id === "string") return item.id;
  if ("key" in item && typeof item.key === "string") return item.key;
  return undefined;
};
export function itemPositions(
  items: readonly unknown[],
): ReadonlyMap<string, number> {
  let index = positions.get(items);
  if (!index) {
    const next = new Map<string, number>();
    items.forEach((item, position) => {
      const id = itemId(item);
      if (id !== undefined && !next.has(id)) next.set(id, position);
    });
    positions.set(items, (index = next));
  }
  return index;
}
export function indexedItem<T>(items: readonly T[], id: string): T | undefined {
  const position = itemPositions(items).get(id);
  return position === undefined ? undefined : items[position];
}
export function registerItemChanges(
  previous: readonly unknown[],
  next: readonly unknown[],
  indices: readonly number[],
): void {
  if (previous === next) return;
  if (
    previous.length !== next.length ||
    indices.some((index) => itemId(previous[index]) !== itemId(next[index]))
  )
    return;
  positions.set(next, itemPositions(previous));
  if (WeakArrayReference)
    deltas.set(next, { previous: new WeakArrayReference(previous), indices });
}
/** Coalesce batched operations; unknown/structural arrays use a checked fallback. */
export function changedItemPositions(
  previous: readonly unknown[],
  next: readonly unknown[],
): readonly number[] | null {
  if (previous === next) return [];
  if (previous.length !== next.length) return null;
  const changed = new Set<number>();
  let cursor = next;
  for (let depth = 0; depth < 64; depth++) {
    const delta = deltas.get(cursor);
    const parent = delta?.previous.deref();
    if (!delta || !parent) break;
    delta.indices.forEach((index) => changed.add(index));
    if (parent === previous)
      return [...changed].filter((index) => previous[index] !== next[index]);
    cursor = parent;
  }
  for (let index = 0; index < next.length; index++) {
    if (itemId(previous[index]) !== itemId(next[index])) return null;
    if (previous[index] !== next[index]) changed.add(index);
  }
  return [...changed];
}
const itemMaps = new WeakMap<
  readonly unknown[],
  ReadonlyMap<string, unknown>
>();
const mapSources = new WeakMap<object, readonly unknown[]>();
/** Immutable lookup backed by shared positions; creating a new view is O(1). */
export function indexedItems<T>(items: readonly T[]): ReadonlyMap<string, T> {
  const cached = itemMaps.get(items);
  if (cached) return cached as ReadonlyMap<string, T>;
  const index = itemPositions(items);
  const entries = function* (): MapIterator<[string, T]> {
    for (const [id, position] of index) yield [id, items[position]];
  };
  const view: ReadonlyMap<string, T> = {
    size: index.size,
    get: (id) => {
      const position = index.get(id);
      return position === undefined ? undefined : items[position];
    },
    has: (id) => index.has(id),
    keys: () => index.keys(),
    values: function* (): MapIterator<T> {
      for (const position of index.values()) yield items[position];
    },
    entries,
    [Symbol.iterator]: entries,
    forEach: (callback, thisArg) => {
      for (const [id, position] of index)
        callback.call(thisArg, items[position], id, view);
    },
  };
  itemMaps.set(items, view);
  mapSources.set(view, items);
  return view;
}
const idsByPositions = new WeakMap<object, readonly string[]>();
/** Membership IDs stay identical through field-only array replacements. */
export function stableItemIds(items: readonly unknown[]): readonly string[] {
  const positions = itemPositions(items);
  let ids = idsByPositions.get(positions);
  if (!ids) {
    ids = items.flatMap((item) => {
      const id = itemId(item);
      return id === undefined ? [] : [id];
    });
    idsByPositions.set(positions, ids);
  }
  return ids;
}

export function indexedItemsSource<T>(
  view: ReadonlyMap<string, T>,
): readonly T[] | undefined {
  return mapSources.get(view) as readonly T[] | undefined;
}
