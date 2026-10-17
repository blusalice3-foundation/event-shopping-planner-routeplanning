import type { ShoppingItem } from "../../types/item";
import type { SheetItem } from "./updateDiff";
import { getItemKey, getItemKeyWithoutTitle } from "../../utils/itemComparison";

export interface SheetMatchChoice {
  row: number;
  incoming: SheetItem;
  candidates: ShoppingItem[];
}
export type SheetIdentityChoices = Readonly<Record<string, string>>;
type SheetMatchGroup = { current: ShoppingItem[]; rows: number[] };

// URL is editable in item details, so it cannot establish sheet provenance.
const signature = (item: SheetItem) =>
  JSON.stringify([item.catalogPrice, item.sheetRemarks]);

/** Prefer unchanged titles and verified sheet values, then pair remaining rows in order. */
export function matchSheetItems(
  current: ShoppingItem[],
  incoming: SheetItem[],
  choices: SheetIdentityChoices = {},
) {
  // Keep the argument compatible with older callers; correspondence is automatic.
  void choices;
  const matches = new Map<number, ShoppingItem>();
  const used = new Set<string>();
  const match = (row: number, item: ShoppingItem) => {
    matches.set(row, item);
    used.add(item.id);
  };
  const matchGroup = (group: SheetMatchGroup) => {
    // Partial provenance cannot prove a unique signature within the group.
    const verifiedGroup =
      group.current.every(
        (item) =>
          item.source === "spreadsheet" &&
          item.sheetIdentityVerified === true &&
          item.catalogPrice !== undefined &&
          item.sheetRemarks !== undefined,
      ) &&
      group.rows.every(
        (row) =>
          incoming[row].sheetIdentityVerified === true &&
          incoming[row].catalogPrice !== undefined &&
          incoming[row].sheetRemarks !== undefined,
      );
    if (verifiedGroup) {
      const oldSignatures = new Map<string, ShoppingItem[]>();
      const newSignatures = new Map<string, number[]>();
      for (const item of group.current) {
        const key = signature(item),
          entries = oldSignatures.get(key) ?? [];
        entries.push(item);
        oldSignatures.set(key, entries);
      }
      for (const row of group.rows) {
        const key = signature(incoming[row]),
          entries = newSignatures.get(key) ?? [];
        entries.push(row);
        newSignatures.set(key, entries);
      }
      for (const [key, old] of oldSignatures) {
        const rows = newSignatures.get(key) ?? [];
        if (old.length === 1 && rows.length === 1 && !used.has(old[0].id))
          match(rows[0], old[0]);
      }
    }
    const old = group.current.filter((item) => !used.has(item.id));
    let nextOld = 0;
    for (const row of group.rows) {
      if (matches.has(row)) continue;
      while (nextOld < old.length && used.has(old[nextOld].id)) nextOld++;
      if (nextOld === old.length) break;
      match(row, old[nextOld++]);
    }
  };
  const collectGroups = (
    keyFor: (item: ShoppingItem | SheetItem) => string,
  ) => {
    const groups = new Map<string, SheetMatchGroup>();
    const group = (key: string) => {
      let value = groups.get(key);
      if (!value) groups.set(key, (value = { current: [], rows: [] }));
      return value;
    };
    for (const item of current)
      if (!used.has(item.id)) group(keyFor(item)).current.push(item);
    incoming.forEach((item, row) => {
      if (!matches.has(row)) group(keyFor(item)).rows.push(row);
    });
    return groups;
  };

  for (const group of collectGroups(getItemKey).values()) matchGroup(group);
  for (const group of collectGroups(getItemKeyWithoutTitle).values())
    matchGroup(group);

  return {
    matches,
    used,
    proposals: [] as SheetMatchChoice[],
    unresolved: [] as SheetMatchChoice[],
  };
}
