import type { ShoppingItem } from "../types/item";
import type { LimitedPurchaseDialogResult } from "../types/limitedPurchase";
import {
  applyLimitedPurchase,
  applyPurchasedFromLimitedInput,
} from "./purchaseQuantity";
import {
  rememberItemUpdateBaseline,
  rememberExplicitItemFields,
  rememberLimitedPurchaseIntent,
} from "./itemUpdateBaseline";

/** Recompute the entered amount against the current planned quantity, including on retry. */
export function resolveLimitedPurchaseIntent(
  item: ShoppingItem,
  result: LimitedPurchaseDialogResult,
) {
  if (!["limited", "purchased", "defer"].includes(result.kind)) return null;
  const planned =
    result.plannedEdited === false ? item.quantity : result.planned;
  if (!Number.isInteger(planned) || planned < 1) return null;
  if (result.kind === "defer")
    return {
      updated: applyLimitedPurchase(item, { planned }),
      actual: undefined,
      requiresConfirmation: false,
    };
  const actual =
    result.actual ??
    (result.kind === "purchased" && item.quantity === result.planned
      ? result.planned
      : undefined);
  if (actual === undefined || !Number.isInteger(actual) || actual < 1)
    return null;
  const purchased = actual >= planned;
  return {
    updated: purchased
      ? applyPurchasedFromLimitedInput(item, planned)
      : applyLimitedPurchase(item, { actual, planned }),
    actual,
    requiresConfirmation:
      (result.kind === "purchased") !== purchased ||
      (purchased &&
        (planned !== result.planned ||
          (result.observedPlanned !== undefined &&
            result.observedPlanned !== item.quantity))),
  };
}

/** UI callers keep the dialog open when its confirmation is already stale. */
export function buildLimitedPurchaseDialogUpdate(
  item: ShoppingItem,
  result: LimitedPurchaseDialogResult,
): ShoppingItem | null {
  const resolved = resolveLimitedPurchaseIntent(item, result);
  if (!resolved || resolved.requiresConfirmation) return null;
  const updated = resolved.updated;
  const baseline =
    result.plannedEdited && result.baselinePlanned !== undefined
      ? { ...item, quantity: result.baselinePlanned }
      : item;
  rememberItemUpdateBaseline(updated, baseline);
  if (result.plannedEdited) rememberExplicitItemFields(updated, ["quantity"]);
  rememberLimitedPurchaseIntent(updated, {
    ...result,
    ...(resolved.actual !== undefined ? { actual: resolved.actual } : {}),
  });
  return updated;
}
