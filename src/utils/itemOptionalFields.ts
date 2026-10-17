import { ownValue, setOwnValue } from "./ownRecord";
import { itemPositions } from "./itemIndex";

const OPTIONAL_ITEM_KEYS = [
  "catalogPrice",
  "limitedPurchasedQuantity",
  "sheetRemarks",
  "sheetIdentityVerified",
  "url",
  "priorityLevel",
  "protectionLevel",
  "source",
  "assignedTo",
  "lastSyncedAt",
  "orderIndex",
  "postponed",
  "manualHallId",
] as const;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Normalize completed items, after applying edit intent. Invalid values stay visible to validation. */
export function normalizeItemOptionalFields<T extends object>(item: T): T {
  let result = item;
  for (const key of OPTIONAL_ITEM_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
    const value = (item as Record<string, unknown>)[key];
    if (
      value !== undefined &&
      !(key === "url" && typeof value === "string" && value.trim() === "")
    )
      continue;
    if (result === item) result = { ...item };
    delete (result as Record<string, unknown>)[key];
  }
  return result;
}

export function normalizeItemsOptionalFields<T>(
  items: T[],
  previous?: readonly T[],
): T[] {
  let result = items;
  let previousPositions: ReadonlyMap<string, number> | undefined;
  items.forEach((item, index) => {
    if (!isRecord(item) || item === previous?.[index]) return;
    // Structural edits retain unchanged item objects even when their positions move.
    // Reuse the immutable list's ID index, never a cached normalization result:
    // a replacement object with the same ID must still be checked on every replan.
    if (previous && typeof item.id === "string") {
      previousPositions ??= itemPositions(previous);
      const previousPosition = previousPositions.get(item.id);
      if (previousPosition !== undefined && item === previous[previousPosition])
        return;
    }
    const normalized = normalizeItemOptionalFields(item);
    if (normalized === item) return;
    if (result === items) result = items.slice();
    result[index] = normalized as T;
  });
  return result;
}

/** Startup/restore boundaries accept unknown data; malformed branches must still fail validation. */
export function normalizeSnapshotItemOptionalFields<T>(
  data: T,
  previous?: T,
): T {
  if (!isRecord(data) || !isRecord(data.eventLists)) return data;
  const previousLists =
    isRecord(previous) && isRecord(previous.eventLists)
      ? previous.eventLists
      : undefined;
  if (data.eventLists === previousLists) return data;
  let lists = data.eventLists;
  for (const [eventName, items] of Object.entries(data.eventLists)) {
    const before = previousLists
      ? ownValue(previousLists, eventName)
      : undefined;
    if (!Array.isArray(items) || items === before) continue;
    const normalized = normalizeItemsOptionalFields(
      items,
      Array.isArray(before) ? before : undefined,
    );
    if (normalized === items) continue;
    if (lists === data.eventLists) lists = { ...data.eventLists };
    setOwnValue(lists, eventName, normalized);
  }
  return lists === data.eventLists ? data : { ...data, eventLists: lists };
}
