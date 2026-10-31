import type { ShoppingItem } from "../types/item";

export type SpaceAdditionPriority = NonNullable<ShoppingItem["priorityLevel"]>;

/** Empty means the user must choose; it is distinct from normal priority. */
export function resolveSpaceAdditionPriority(
  items: readonly ShoppingItem[],
): SpaceAdditionPriority | "" {
  if (items.length === 0) return "";
  const priority = items[0].priorityLevel || "none";
  return items.every((item) => (item.priorityLevel || "none") === priority)
    ? priority
    : "";
}
