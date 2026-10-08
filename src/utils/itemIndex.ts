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
const itemId = (item: unknown): string | undefined =>
  item &&
  typeof item === "object" &&
  "id" in item &&
  typeof item.id === "string"
    ? item.id
    : undefined;

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
