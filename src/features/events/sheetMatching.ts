import type { ShoppingItem } from "../../types/item";
import type { SheetItem } from "./updateDiff";
import { getItemKey, getItemKeyWithoutTitle } from "../../utils/itemComparison";

export interface SheetMatchChoice {
  row: number;
  incoming: SheetItem;
  candidates: ShoppingItem[];
}
export type SheetIdentityChoices = Readonly<Record<string, string>>;
// URL is editable in item details, so it cannot establish sheet provenance.
const signature = (item: SheetItem) =>
  JSON.stringify([item.catalogPrice, item.sheetRemarks]);
const inputSignature = (item: SheetItem) =>
  JSON.stringify([
    item.circle,
    item.eventDate,
    item.block,
    item.number,
    item.title,
    item.price,
    item.catalogPrice,
    item.remarks,
    item.sheetRemarks,
    item.url ?? "",
    item.rawQuantity ?? item.quantity,
  ]);

/** Match complete title groups before considering title-change proposals. */
export function matchSheetItems(
  current: ShoppingItem[],
  incoming: SheetItem[],
  choices: SheetIdentityChoices = {},
) {
  const matches = new Map<number, ShoppingItem>();
  const used = new Set<string>();
  const groups = new Map<string, { current: ShoppingItem[]; rows: number[] }>();
  const group = (key: string) => {
    let value = groups.get(key);
    if (!value) groups.set(key, (value = { current: [], rows: [] }));
    return value;
  };
  current.forEach((item) => group(getItemKey(item)).current.push(item));
  incoming.forEach((item, index) => group(getItemKey(item)).rows.push(index));
  const match = (row: number, item: ShoppingItem) => {
    matches.set(row, item);
    used.add(item.id);
  };
  for (const value of groups.values()) {
    if (value.current.length === 1 && value.rows.length === 1) {
      match(value.rows[0], value.current[0]);
      continue;
    }
    const oldSignatures = new Map<string, ShoppingItem[]>();
    const newSignatures = new Map<string, number[]>();
    for (const item of value.current) {
      if (
        item.source !== "spreadsheet" ||
        item.catalogPrice === undefined ||
        item.sheetRemarks === undefined
      )
        continue;
      const key = signature(item),
        entries = oldSignatures.get(key) ?? [];
      entries.push(item);
      oldSignatures.set(key, entries);
    }
    for (const row of value.rows) {
      const key = signature(incoming[row]),
        entries = newSignatures.get(key) ?? [];
      entries.push(row);
      newSignatures.set(key, entries);
    }
    for (const [key, old] of oldSignatures) {
      const rows = newSignatures.get(key) ?? [];
      if (old.length === 1 && rows.length === 1) match(rows[0], old[0]);
    }
    const old = value.current.filter((item) => !used.has(item.id));
    const rows = value.rows.filter((row) => !matches.has(row));
    if (
      old.length &&
      old.length === rows.length &&
      new Set(rows.map((row) => inputSignature(incoming[row]))).size === 1
    )
      rows.forEach((row, index) => match(row, old[index]));
  }
  const remaining = new Map<string, ShoppingItem[]>();
  for (const item of current)
    if (!used.has(item.id)) {
      const key = getItemKeyWithoutTitle(item),
        items = remaining.get(key) ?? [];
      items.push(item);
      remaining.set(key, items);
    }
  const proposals: SheetMatchChoice[] = [];
  incoming.forEach((item, row) => {
    if (matches.has(row)) return;
    const candidates = remaining.get(getItemKeyWithoutTitle(item)) ?? [];
    if (candidates.length) proposals.push({ row, incoming: item, candidates });
  });
  const unresolved: SheetMatchChoice[] = [];
  for (const proposal of proposals) {
    const selected = choices[String(proposal.row)];
    if (selected === "new") continue;
    const item = proposal.candidates.find(
      (candidate) => candidate.id === selected,
    );
    if (item && !used.has(item.id)) match(proposal.row, item);
    else unresolved.push(proposal);
  }
  return { matches, used, proposals, unresolved };
}
