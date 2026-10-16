import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../../types/item";
import { createEventUpdateDiff, type SheetItem } from "./updateDiff";
import { applyEventUpdateToItems } from "./updateApply";
import { applyPendingEventUpdate } from "./updateFlow";

const urls = ["https://example.com/book-a", "https://example.com/book-b"];
const items = (): ShoppingItem[] =>
  [2, 5].map((quantity, index) => ({
    id: String(index + 1),
    circle: "ユーザー登録",
    eventDate: "1日目",
    block: "A",
    number: "01a",
    title: "同名品目",
    price: index === 0 ? 800 : 0,
    catalogPrice: 500,
    quantity,
    remarks: `ID ${index + 1} の記録`,
    sheetRemarks: "エラーが発生しました",
    url: urls[index],
    purchaseStatus: "None",
    source: "spreadsheet",
    protectionLevel: "none",
  }));
const rows = (): SheetItem[] =>
  items().map((item) => ({
    ...item,
    price: item.catalogPrice!,
    remarks: item.sheetRemarks!,
    rawQuantity: String(item.quantity),
  }));

const urlChanges = [
  { name: "unchanged", values: urls },
  { name: "swapped", values: [...urls].reverse() },
  {
    name: "replaced",
    values: ["https://example.com/manual-a", "https://example.com/manual-b"],
  },
  { name: "removed", values: [undefined, undefined] },
  { name: "partially removed", values: [undefined, urls[0]] },
];

describe("sheet identity excludes editable URLs", () => {
  for (const reverse of [false, true]) {
    it.each(urlChanges)(
      `requires explicit identity with $name URLs, reversed=${reverse}`,
      ({ values }) => {
        const before = items().map((item, index) => ({
          ...item,
          url: values[index],
        }));
        const incoming = reverse ? rows().reverse() : rows();
        const pending = createEventUpdateDiff(before, incoming);
        expect(pending.unresolvedMatches).toHaveLength(2);
        expect(() => applyEventUpdateToItems(before, pending)).toThrow(
          /対応関係/u,
        );
        const choices = reverse
          ? { "0": "2", "1": "1" }
          : { "0": "1", "1": "2" };
        const resolved = createEventUpdateDiff(before, incoming, choices);
        expect(resolved.unresolvedMatches).toEqual([]);
        expect(resolved.itemsToDelete).toEqual([]);
        expect(resolved.itemsToAdd).toEqual([]);
        expect(applyEventUpdateToItems(before, resolved)).toEqual(items());
      },
    );
  }

  it.each(["catalogPrice", "sheetRemarks"] as const)(
    "still matches unique sheet-owned %s after manual URL swaps",
    (field) => {
      const original = items();
      original[1] = {
        ...original[1],
        [field]: field === "catalogPrice" ? 700 : "別のシート備考",
      };
      const before = original.map((item, index) => ({
        ...item,
        url: urls[1 - index],
      }));
      const incoming = rows();
      incoming[1] = { ...incoming[1], [field]: original[1][field] };
      if (field === "catalogPrice") incoming[1].price = 700;
      else incoming[1].remarks = original[1].sheetRemarks!;
      const diff = createEventUpdateDiff(before, incoming.reverse());
      expect(diff.unresolvedMatches).toEqual([]);
      expect(applyEventUpdateToItems(before, diff)).toEqual(original);
    },
  );

  it("keeps each ID without a choice when all incoming effects, including URL, are identical", () => {
    const before = items();
    const incoming = [rows()[0], rows()[0]];
    const diff = createEventUpdateDiff(before, incoming);
    expect(diff.unresolvedMatches).toEqual([]);
    expect(diff.itemsToAdd).toEqual([]);
    expect(diff.itemsToDelete).toEqual([]);
    expect(applyEventUpdateToItems(before, diff)).toEqual([
      before[0],
      { ...before[1], quantity: 2, url: urls[0] },
    ]);
  });

  it("requires a choice when only the incoming URLs differ", () => {
    const before = items().map((item) => ({ ...item, quantity: 2 }));
    const incoming = rows().map((item) => ({
      ...item,
      quantity: 2,
      rawQuantity: "2",
    }));
    expect(
      createEventUpdateDiff(before, incoming).unresolvedMatches,
    ).toHaveLength(2);
  });

  it("keeps purchased-quantity confirmation and per-ID records after explicit identity selection", () => {
    const before = items();
    before[0] = { ...before[0], purchaseStatus: "Purchased", url: urls[1] };
    const incoming = rows();
    incoming[0] = { ...incoming[0], quantity: 6, rawQuantity: "6" };
    const diff = createEventUpdateDiff(before, incoming, {
      "0": "1",
      "1": "2",
    });
    expect(diff.pendingPurchasedQuantityChanges).toMatchObject([
      { itemId: "1", currentQuantity: 2, nextQuantity: 6 },
    ]);
    expect(applyEventUpdateToItems(before, diff)[0]).toEqual({
      ...before[0],
      url: urls[0],
    });
    expect(
      applyEventUpdateToItems(before, diff, {
        applyPurchasedQuantityChanges: true,
      })[0],
    ).toEqual({ ...before[0], url: urls[0], quantity: 6 });
  });

  it.each(["items-only", "same-source", "source-switch"] as const)(
    "blocks unresolved %s updates and applies the selected IDs through the shared flow",
    (kind) => {
      const before = items().map((item, index) => ({
        ...item,
        url: urls[1 - index],
      }));
      const baseSource = {
        url: "https://docs.google.com/spreadsheets/d/source-a",
        sheetName: "一覧",
      };
      const nextSource =
        kind === "source-switch"
          ? {
              ...baseSource,
              url: "https://docs.google.com/spreadsheets/d/source-b",
            }
          : baseSource;
      const state = {
        eventLists: { event: before },
        eventMetadata: {
          event: {
            spreadsheetUrl: baseSource.url,
            spreadsheetSheetName: baseSource.sheetName,
            lastImportDate: "2026-10-16",
          },
        },
        executeModeItems: { event: { "1日目": ["1", "2"] } },
      };
      const pending = {
        kind:
          kind === "items-only"
            ? ("items-only" as const)
            : ("source-switch" as const),
        eventName: "event",
        diff: createEventUpdateDiff(before, rows()),
        baseSource,
        nextSource,
      };
      expect(
        applyPendingEventUpdate({
          state,
          pending,
          baseItems: before,
          options: {},
        }),
      ).toBeNull();
      expect(state.eventLists.event).toEqual(before);
      const after = applyPendingEventUpdate({
        state,
        pending,
        baseItems: before,
        options: { identityChoices: { "0": "1", "1": "2" } },
      });
      expect(after?.eventLists.event).toEqual(items());
      expect(after?.eventMetadata.event.spreadsheetUrl).toBe(nextSource.url);
      expect(after?.executeModeItems).toEqual(state.executeModeItems);
    },
  );
});
