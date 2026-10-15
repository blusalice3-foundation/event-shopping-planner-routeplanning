import type { ShoppingItem } from "../types/item";
import type { LimitedPurchaseDialogResult } from "../types/limitedPurchase";
import {
  applyLimitedPurchase,
  applyPurchasedFromLimitedInput,
} from "./purchaseQuantity";
import {
  rememberItemUpdateBaseline,
  rememberExplicitItemFields,
} from "./itemUpdateBaseline";

/** Revalidate entered quantities against the latest planned amount. */
export function buildLimitedPurchaseDialogUpdate(
  item: ShoppingItem,
  result: LimitedPurchaseDialogResult,
): ShoppingItem | null {
  const planned =
    result.plannedEdited === false ? item.quantity : result.planned;
  if (!Number.isInteger(planned) || planned < 1) return null;
  let updated: ShoppingItem;
  if (result.kind === "defer")
    updated = applyLimitedPurchase(item, { planned });
  else {
    const actual =
      result.actual ??
      (result.kind === "purchased" && item.quantity === result.planned
        ? result.planned
        : undefined);
    if (actual === undefined || !Number.isInteger(actual) || actual < 1)
      return null;
    const purchased = actual >= planned;
    if ((result.kind === "purchased") !== purchased) return null;
    if (
      purchased &&
      result.observedPlanned !== undefined &&
      result.observedPlanned !== item.quantity
    )
      return null;
    updated = purchased
      ? applyPurchasedFromLimitedInput(item, planned)
      : applyLimitedPurchase(item, { actual, planned });
  }
  const baseline =
    result.plannedEdited && result.baselinePlanned !== undefined
      ? { ...item, quantity: result.baselinePlanned }
      : item;
  rememberItemUpdateBaseline(updated, baseline);
  if (result.plannedEdited) rememberExplicitItemFields(updated, ["quantity"]);
  return updated;
}
