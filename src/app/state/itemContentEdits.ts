import type {
  ItemContentEdit,
  PersistenceSnapshot,
} from "../ports/PersistenceCommandPort";

import { itemPositions, registerItemChanges } from "../../utils/itemIndex";

export const editableItemContentFields = new Set([
  "remarks",
  "price",
  "quantity",
  "purchaseStatus",
  "limitedPurchasedQuantity",
  "protectionLevel",
]);

export type { ItemContentEdit } from "../ports/PersistenceCommandPort";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Only field edits of existing items qualify; structural proposals stay private. */
export function collectItemContentEdits(
  base: PersistenceSnapshot,
  next: PersistenceSnapshot,
): readonly ItemContentEdit[] | undefined {
  for (const key of Object.keys(base) as Array<keyof PersistenceSnapshot>) {
    if (key !== "eventLists" && base[key] !== next[key]) return undefined;
  }
  const events = Object.keys(base.eventLists);
  if (events.length !== Object.keys(next.eventLists).length) return undefined;
  const edits: ItemContentEdit[] = [];
  for (const eventName of events) {
    const previous = base.eventLists[eventName];
    const current = next.eventLists[eventName];
    if (!current || previous.length !== current.length) return undefined;
    for (let index = 0; index < previous.length; index++) {
      const before = previous[index];
      const after = current[index];
      if (before === after) continue;
      if (
        !isRecord(before) ||
        !isRecord(after) ||
        typeof before.id !== "string" ||
        before.id !== after.id
      )
        return undefined;
      const fields: Record<string, { present: boolean; value: unknown }> = {};
      for (const key of new Set([
        ...Object.keys(before),
        ...Object.keys(after),
      ])) {
        const present = Object.prototype.hasOwnProperty.call(after, key);
        if (
          Object.prototype.hasOwnProperty.call(before, key) === present &&
          Object.is(before[key], after[key])
        )
          continue;
        if (!editableItemContentFields.has(key)) return undefined;
        fields[key] = { present, value: after[key] };
      }
      if (Object.keys(fields).length) {
        edits.push({ eventName, itemId: before.id, fields, baseline: before });
      }
    }
  }
  return edits;
}

export const isMemoOnlyItemContentEdit = (
  edits: readonly ItemContentEdit[] | undefined,
): boolean =>
  !!edits?.length &&
  edits.every((edit) =>
    Object.keys(edit.fields).every((key) => key === "remarks"),
  );

/** Overlay accepted input without cloning maps or changing unrelated item references. */
export function applyItemContentEdits(
  source: PersistenceSnapshot,
  edits: readonly ItemContentEdit[],
): PersistenceSnapshot {
  const byEvent = new Map<string, Map<string, ItemContentEdit["fields"]>>();
  for (const edit of edits) {
    let items = byEvent.get(edit.eventName);
    if (!items) byEvent.set(edit.eventName, (items = new Map()));
    items.set(edit.itemId, { ...items.get(edit.itemId), ...edit.fields });
  }
  let lists = source.eventLists;
  for (const [eventName, changes] of byEvent) {
    const items = source.eventLists[eventName];
    if (!items) continue;
    let next = items;
    const changedIndices: number[] = [];
    const index = itemPositions(items);
    for (const [id, fields] of changes) {
      const position = index.get(id);
      if (position === undefined) continue;
      const item = items[position];
      if (!isRecord(item)) continue;
      let value = item;
      for (const [key, field] of Object.entries(fields)) {
        if (
          Object.prototype.hasOwnProperty.call(item, key) === field.present &&
          Object.is(item[key], field.value)
        )
          continue;
        if (value === item) value = { ...item };
        if (field.present) value[key] = field.value;
        else delete value[key];
      }
      if (value !== item) {
        if (next === items) next = items.slice();
        next[position] = value;
        changedIndices.push(position);
      }
    }
    if (next !== items) {
      registerItemChanges(items, next, changedIndices);
      if (lists === source.eventLists) lists = { ...lists };
      lists[eventName] = next;
    }
  }
  return lists === source.eventLists
    ? source
    : { ...source, eventLists: lists };
}
