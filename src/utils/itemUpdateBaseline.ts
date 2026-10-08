import type { ShoppingItem } from "../types/item";

// Keep command intent outside persisted data and preserve one-argument card callbacks.
const baselines = new WeakMap<ShoppingItem, ShoppingItem>();

export function rememberItemUpdateBaseline(
  updated: ShoppingItem,
  baseline: ShoppingItem,
): ShoppingItem {
  baselines.set(updated, baseline);
  return updated;
}

export function itemUpdateBaseline(
  updated: ShoppingItem,
): ShoppingItem | undefined {
  return baselines.get(updated);
}
