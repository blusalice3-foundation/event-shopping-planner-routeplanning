import type { ShoppingItem, ViewMode } from "../../types/item";
import type { PersistenceSnapshot } from "../ports/PersistenceCommandPort";
import { computeUpdateItem } from "../../features/events/itemOps/crud";
import {
  changedFieldConflicts,
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
}

/** Field-only plans do not change membership, visit order or map references. */
export function planItemContentMutation(
  source: PersistenceSnapshot,
  edits: readonly ItemContentEdit[],
) {
  const normalizedItems = new Map<string, ShoppingItem>();
  const conflicts: ChangedFieldConflict[] = [];
  const normalizedEdits: ItemContentEdit[] = [];
  for (const edit of edits) {
    const items = source.eventLists[edit.eventName] as
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
        conflicts.push(
          ...changedFieldConflicts(
            edit.baseline[key],
            field.value,
            (current as unknown as Record<string, unknown>)[key],
            ["eventLists", edit.eventName, edit.itemId, key],
          ),
        );
      }
      if (field.present) Object.assign(desired, { [key]: field.value });
      else delete (desired as unknown as Record<string, unknown>)[key];
    }
    const mode = source.dayModes[edit.eventName]?.[current.eventDate] as
      | ViewMode
      | undefined;
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
  return {
    ...confirmChangedFieldConflicts(
      { snapshot: applyItemContentEdits(source, normalizedEdits) },
      conflicts,
    ),
    itemContentEdits: normalizedEdits,
  };
}
