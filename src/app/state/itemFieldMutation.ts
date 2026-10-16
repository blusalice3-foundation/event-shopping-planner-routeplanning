import { resolveLimitedPurchaseIntent } from "../../utils/limitedPurchaseIntent";
import { recordEntry } from "../../utils/ownRecord";
import { itemContentGuardFailure } from "../../utils/itemContentGuard";
import type { ShoppingItem, ViewMode } from "../../types/item";
import type { PersistenceSnapshot } from "../ports/PersistenceCommandPort";
import { computeUpdateItem } from "../../features/events/itemOps/crud";
import {
  confirmChangedFieldConflicts,
  type ChangedFieldConflict,
} from "../../features/consistency/domain/mutations";
import { MutationTargetMissingError } from "../commands/applicationMutationCoordinator";
import {
  applyItemContentEdits,
  editableItemContentFields,
  type ItemContentEdit,
} from "./itemContentEdits";

import { indexedItem } from "../../utils/itemIndex";

export interface UpdateItemFieldsInput {
  readonly eventName: string;
  readonly itemId: string;
  readonly changes: Partial<
    Pick<
      ShoppingItem,
      | "remarks"
      | "price"
      | "quantity"
      | "purchaseStatus"
      | "limitedPurchasedQuantity"
      | "protectionLevel"
    >
  >;
  readonly baseline: ShoppingItem;
  readonly saveImmediately?: boolean;
  readonly guard?: ItemContentEdit["guard"];
  readonly limitedPurchase?: ItemContentEdit["limitedPurchase"];
}

/** Field-only plans do not change membership, visit order or map references. */
export function planItemContentMutation(
  source: PersistenceSnapshot,
  edits: readonly ItemContentEdit[],
) {
  const normalizedItems = new Map<string, ShoppingItem>();
  const conflicts: ChangedFieldConflict[] = [];
  const normalizedEdits: ItemContentEdit[] = [];
  const quantityReviews: Array<{
    eventName: string;
    itemId: string;
    actual: number;
    planned: number;
    observedPlanned: number;
    purchaseStatus: string;
  }> = [];
  const skipped: Array<{ edit: ItemContentEdit; reason: string }> = [];
  for (const edit of edits) {
    const reason = itemContentGuardFailure(source, edit);
    if (reason) {
      skipped.push({ edit, reason });
      continue;
    }
    const items = recordEntry(source.eventLists, edit.eventName) as
      | ShoppingItem[]
      | undefined;
    const itemKey = JSON.stringify([edit.eventName, edit.itemId]);
    const current =
      normalizedItems.get(itemKey) ??
      (items ? indexedItem(items, edit.itemId) : undefined);
    if (!current) throw new MutationTargetMissingError();
    const desired = { ...current };
    for (const [key, field] of Object.entries(edit.fields)) {
      if (!editableItemContentFields.has(key))
        throw new Error("Invalid item field.");
      if (edit.baseline) {
        const baseline = edit.baseline[key];
        const latest = (current as unknown as Record<string, unknown>)[key];
        if (!Object.is(baseline, latest) && !Object.is(field.value, latest))
          conflicts.push({
            baseline,
            current: latest,
            desired: field.value,
            path: ["eventLists", edit.eventName, edit.itemId, key],
          });
      }
      if (field.present) Object.assign(desired, { [key]: field.value });
      else delete (desired as unknown as Record<string, unknown>)[key];
    }
    if (edit.limitedPurchase) {
      const resolved = resolveLimitedPurchaseIntent(
        current,
        edit.limitedPurchase,
      );
      if (!resolved) throw new Error("Invalid limited purchase quantities.");
      desired.quantity = resolved.updated.quantity;
      desired.purchaseStatus = resolved.updated.purchaseStatus;
      delete desired.limitedPurchasedQuantity;
      if (resolved.updated.limitedPurchasedQuantity !== undefined)
        desired.limitedPurchasedQuantity =
          resolved.updated.limitedPurchasedQuantity;
      if (resolved.requiresConfirmation && resolved.actual !== undefined)
        quantityReviews.push({
          eventName: edit.eventName,
          itemId: edit.itemId,
          actual: resolved.actual,
          planned: desired.quantity,
          observedPlanned:
            edit.limitedPurchase.observedPlanned ??
            edit.limitedPurchase.planned,
          purchaseStatus: desired.purchaseStatus,
        });
    }
    const mode = recordEntry(source.dayModes, edit.eventName)?.[
      current.eventDate
    ] as ViewMode | undefined;
    const normalized = computeUpdateItem(
      [current],
      desired,
      mode,
      current.protectionLevel,
      current.source,
    ).items[0];
    const fields = Object.fromEntries(
      [...editableItemContentFields].flatMap((key) => {
        const value = normalized as unknown as Record<string, unknown>;
        const before = current as unknown as Record<string, unknown>;
        const present = Object.prototype.hasOwnProperty.call(value, key);
        return Object.is(value[key], before[key]) &&
          present === Object.prototype.hasOwnProperty.call(before, key)
          ? []
          : [[key, { present, value: value[key] }]];
      }),
    );
    const normalizedEdit = { ...edit, fields };
    normalizedEdits.push(normalizedEdit);
    normalizedItems.set(itemKey, normalized);
  }
  const plan = confirmChangedFieldConflicts(
    { snapshot: applyItemContentEdits(source, normalizedEdits) },
    conflicts,
  );
  if (quantityReviews.length) {
    plan.confirmation = {
      title: "予定数量が変わった購入数を確認",
      details: [
        ...quantityReviews.map(
          ({ itemId, actual, planned, purchaseStatus }) =>
            `${itemId}: 入力した実購入数は${actual}個です。最新の予定数量${planned}個に対し、${purchaseStatus === "Purchased" ? "購入済み" : "限数購入"}として保存します。`,
        ),
        ...(plan.confirmation?.details ?? []),
      ],
      comparison: {
        quantities: quantityReviews,
        related: plan.confirmation?.comparison ?? null,
      },
    };
  }
  if (skipped.length) {
    plan.confirmation = {
      title: "対象外になった限数入力を確認",
      details: [
        ...skipped.map(
          ({ edit, reason }) =>
            `${edit.itemId}: ${reason} この入力は適用しません。`,
        ),
        ...(plan.confirmation?.details ?? []),
      ],
      comparison: { skipped, conflicts: plan.confirmation?.comparison ?? null },
    };
  }
  return {
    ...plan,
    invalidItemContentEdits: skipped.map(({ edit }) => edit),
    skipCommit: skipped.length > 0 && normalizedEdits.length === 0,
    itemContentEdits: normalizedEdits,
  };
}
