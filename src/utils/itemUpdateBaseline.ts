import type { ShoppingItem } from "../types/item";
import type { LimitedPurchaseDialogResult } from "../types/limitedPurchase";

const limitedPurchaseIntents = new WeakMap<
  ShoppingItem,
  LimitedPurchaseDialogResult
>();
export function rememberLimitedPurchaseIntent(
  item: ShoppingItem,
  intent: LimitedPurchaseDialogResult,
) {
  limitedPurchaseIntents.set(item, { ...intent });
}
export const itemLimitedPurchaseIntent = (item: ShoppingItem) =>
  limitedPurchaseIntents.get(item);

// Keep command intent outside persisted data and preserve one-argument card callbacks.
const baselines = new WeakMap<ShoppingItem, ShoppingItem>();

export function rememberItemUpdateBaseline(
  updated: ShoppingItem,
  baseline: ShoppingItem,
): ShoppingItem {
  if (!baselines.has(updated)) baselines.set(updated, baseline);
  return updated;
}

export function itemUpdateBaseline(
  updated: ShoppingItem,
): ShoppingItem | undefined {
  return baselines.get(updated);
}

const explicitFields = new WeakMap<ShoppingItem, readonly string[]>();
export function rememberExplicitItemFields(
  item: ShoppingItem,
  fields: readonly string[],
) {
  explicitFields.set(item, fields);
}
export const itemExplicitFields = (item: ShoppingItem): readonly string[] =>
  explicitFields.get(item) ?? [];
