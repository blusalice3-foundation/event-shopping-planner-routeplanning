import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../../types/item";
import { createEventUpdateDiff, type SheetItem } from "./updateDiff";
import { applyEventUpdateToItems } from "./updateApply";
import { applyPendingEventUpdate } from "./updateFlow";
import { matchSheetItems } from "./sheetMatching";

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
    sheetIdentityVerified: true,
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

describe("automatic sheet identity excludes editable URLs", () => {
  for (const reverse of [false, true]) {
    it.each(urlChanges)(
      `pairs duplicate rows in order with $name URLs, reversed=${reverse}`,
      ({ values }) => {
        const before = items().map((item, index) => ({
          ...item,
          url: values[index],
        }));
        const incoming = reverse ? rows().reverse() : rows();
        const diff = createEventUpdateDiff(before, incoming);
        expect(diff.unresolvedMatches).toEqual([]);
        expect(diff.matching).toBeUndefined();
        expect(diff.itemsToDelete).toEqual([]);
        expect(diff.itemsToAdd).toEqual([]);
        expect(applyEventUpdateToItems(before, diff)).toEqual(
          items().map((item, index) => ({
            ...item,
            quantity: incoming[index].quantity,
            url: incoming[index].url,
          })),
        );
      },
    );
  }

  it.each(["catalogPrice", "sheetRemarks"] as const)(
    "prefers unique verified %s over row order after manual URL swaps",
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

  it("keeps each ID when all incoming effects are identical", () => {
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

  it("does not require a choice when only the incoming URLs differ", () => {
    const before = items().map((item) => ({ ...item, quantity: 2 }));
    const incoming = rows().map((item) => ({
      ...item,
      quantity: 2,
      rawQuantity: "2",
    }));
    const diff = createEventUpdateDiff(before, incoming);
    expect(diff.unresolvedMatches).toEqual([]);
    expect(applyEventUpdateToItems(before, diff)).toEqual(before);
  });

  it("keeps purchased-quantity consent and per-ID records after automatic matching", () => {
    const before = items();
    before[0] = { ...before[0], purchaseStatus: "Purchased", url: urls[1] };
    const incoming = rows();
    incoming[0] = { ...incoming[0], quantity: 6, rawQuantity: "6" };
    const diff = createEventUpdateDiff(before, incoming);
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
    "applies %s updates without per-row choices through the shared flow",
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
      const after = applyPendingEventUpdate({
        state,
        pending,
        baseItems: before,
        options: {},
      });
      expect(after?.eventLists.event).toEqual(items());
      expect(after?.eventMetadata.event.spreadsheetUrl).toBe(nextSource.url);
      expect(after?.executeModeItems).toEqual(state.executeModeItems);
      expect(state.eventLists.event).toEqual(before);
    },
  );
});

describe("automatic matching prioritizes identity and never reuses an old ID", () => {
  it("matches a single changed title without a choice and preserves purchase records", () => {
    const before = [items()[0]];
    const incoming = [{ ...rows()[0], title: "改題後" }];
    const diff = createEventUpdateDiff(before, incoming);
    expect(diff.itemsToDelete).toEqual([]);
    expect(diff.itemsToAdd).toEqual([]);
    expect(diff.unresolvedMatches).toEqual([]);
    expect(applyEventUpdateToItems(before, diff)).toEqual([
      { ...before[0], title: "改題後" },
    ]);
  });

  it("reserves unchanged titles before matching changed titles, regardless of incoming order", () => {
    const before = items().map((item, index) => ({
      ...item,
      title: index === 0 ? "改題前" : "既存タイトル",
    }));
    const incoming = [
      { ...rows()[0], title: "改題後" },
      { ...rows()[1], title: "既存タイトル" },
    ];
    const matched = matchSheetItems(before, incoming);
    expect(matched.matches.get(0)?.id).toBe("1");
    expect(matched.matches.get(1)?.id).toBe("2");
    expect(matched.proposals).toEqual([]);
    expect(matched.unresolved).toEqual([]);
  });

  it("prefers unique verified signatures when several titles change and rows reverse", () => {
    const before = items().map((item, index) => ({
      ...item,
      title: `旧${index}`,
      catalogPrice: 500 + index * 200,
    }));
    const incoming = before
      .map((item, index) => ({
        ...item,
        title: `新${index}`,
        rawQuantity: String(item.quantity),
      }))
      .reverse();
    const matched = matchSheetItems(before, incoming);
    expect(matched.matches.get(0)?.id).toBe("2");
    expect(matched.matches.get(1)?.id).toBe("1");
    const after = applyEventUpdateToItems(
      before,
      createEventUpdateDiff(before, incoming),
    );
    expect(
      after.map(({ id, title, price, remarks }) => ({
        id,
        title,
        price,
        remarks,
      })),
    ).toEqual(
      before.map(({ id, price, remarks }, index) => ({
        id,
        title: `新${index}`,
        price,
        remarks,
      })),
    );
  });

  it("pairs ambiguous title changes in old-item and incoming order, without reusing IDs", () => {
    const before = items().map((item, index) => ({
      ...item,
      title: `旧${index}`,
    }));
    const incoming = rows().map((item, index) => ({
      ...item,
      title: `新${index}`,
    }));
    const matched = matchSheetItems(before, incoming, { "0": "2", "1": "2" });
    expect([...matched.matches.values()].map(({ id }) => id)).toEqual([
      "1",
      "2",
    ]);
    expect(matched.used.size).toBe(2);
    const diff = createEventUpdateDiff(before, incoming);
    expect(diff.itemsToUpdate.map(({ id }) => id)).toEqual(["1", "2"]);
    expect(diff.itemsToAdd).toEqual([]);
    expect(diff.itemsToDelete).toEqual([]);
  });

  it("keeps extra incoming rows as new items after existing IDs are consumed", () => {
    const before = items().map((item, index) => ({
      ...item,
      title: `旧${index}`,
    }));
    const incoming = [...rows(), rows()[0]].map((item, index) => ({
      ...item,
      title: `新${index}`,
    }));
    const diff = createEventUpdateDiff(before, incoming);
    expect(diff.itemsToUpdate.map(({ id }) => id)).toEqual(["1", "2"]);
    expect(diff.itemsToAdd).toMatchObject([{ title: "新2" }]);
    const after = applyEventUpdateToItems(before, diff);
    expect(after).toHaveLength(3);
    expect(new Set(after.map(({ id }) => id)).size).toBe(3);
  });

  it("reserves all unchanged-title duplicates before using the next old title", () => {
    const before = [
      ...items(),
      { ...items()[0], id: "3", title: "別タイトル" },
    ];
    const incoming = [{ ...rows()[0], title: "改題後" }, ...rows()];
    const matched = matchSheetItems(before, incoming);
    expect([0, 1, 2].map((row) => matched.matches.get(row)?.id)).toEqual([
      "3",
      "1",
      "2",
    ]);
  });

  it("retains full protection and only deletes unmatched deletable items", () => {
    const before = [
      { ...items()[0], title: "旧タイトル" },
      { ...items()[1], protectionLevel: "full" as const },
      { ...items()[0], id: "3", protectionLevel: "deletable" as const },
    ];
    const incoming = [{ ...rows()[0], title: "新タイトル" }];
    const diff = createEventUpdateDiff(before, incoming);
    expect(diff.itemsToDelete.map(({ id }) => id)).toEqual(["3"]);
    expect(diff.protectedFromDelete).toBe(1);
    expect(applyEventUpdateToItems(before, diff)).toEqual([
      { ...before[0], title: "新タイトル" },
      before[1],
    ]);
  });

  it.each(["current", "incoming"] as const)(
    "falls back to row order when one %s row has unknown provenance",
    (side) => {
      const current = items().map((item, index) => ({
        ...item,
        catalogPrice: index === 0 ? 500 : 700,
      }));
      const incoming = rows().map((item, index) => ({
        ...item,
        catalogPrice: index === 0 ? 500 : 700,
        price: index === 0 ? 500 : 700,
      }));
      if (side === "current") current[1].sheetIdentityVerified = undefined;
      else incoming[1].sheetIdentityVerified = undefined;
      const matched = matchSheetItems(current, incoming.reverse());
      expect([0, 1].map((row) => matched.matches.get(row)?.id)).toEqual([
        "1",
        "2",
      ]);
      const diff = createEventUpdateDiff(current, incoming);
      expect(diff.unresolvedMatches).toEqual([]);
      expect(diff.itemsToDelete).toEqual([]);
      expect(diff.itemsToAdd).toEqual([]);
      const after = applyEventUpdateToItems(current, diff);
      expect(
        after.map(({ id, remarks, price }) => ({ id, remarks, price })),
      ).toEqual(
        current.map(({ id, remarks, price }) => ({ id, remarks, price })),
      );
    },
  );
});

describe("update-only whitespace rescue preserves all raw correspondence first", () => {
  const collision = () => {
    const before = items().map((item, index) => ({
      ...item,
      id: index === 0 ? "A" : "B",
      circle: index === 0 ? "X " : "X",
      title: index === 0 ? "旧A" : "旧B",
      catalogPrice: index === 0 ? 500 : 700,
      purchaseStatus:
        index === 0 ? ("Purchased" as const) : ("LimitedPurchase" as const),
      ...(index === 0 ? {} : { limitedPurchasedQuantity: 2 }),
    }));
    const incoming: SheetItem[] = [
      {
        ...before[1],
        circle: "X",
        title: "旧A",
        price: 700,
        catalogPrice: 700,
        rawQuantity: "",
      },
      {
        ...before[0],
        circle: "X",
        title: "新A",
        price: 500,
        catalogPrice: 500,
        rawQuantity: "",
      },
    ];
    return { before, incoming };
  };

  it.each([false, true])(
    "fixes raw base matches before trimmed titles, reverse=%s",
    (reverse) => {
      const { before, incoming } = collision();
      if (reverse) incoming.reverse();
      const result = matchSheetItems(before, incoming);
      expect(
        incoming.map((row, index) => [
          row.title,
          result.matches.get(index)?.id,
        ]),
      ).toEqual(
        incoming.map((row) => [row.title, row.title === "旧A" ? "B" : "A"]),
      );
      expect(result.matches.size).toBe(2);
      expect(result.used.size).toBe(2);
      const diff = createEventUpdateDiff(before, incoming);
      expect(diff.itemsToAdd).toEqual([]);
      expect(diff.itemsToDelete).toEqual([]);
      const after = applyEventUpdateToItems(before, diff);
      expect(after).toEqual([
        { ...before[0], title: "新A" },
        { ...before[1], title: "旧A" },
      ]);
      const repeated = createEventUpdateDiff(after, incoming);
      expect(repeated.itemsToAdd).toEqual([]);
      expect(repeated.itemsToDelete).toEqual([]);
      expect(applyEventUpdateToItems(after, repeated)).toEqual(after);
    },
  );

  it.each(["items-only", "same-source", "source-switch"] as const)(
    "%s retains each ID's purchases, user values, whitespace and execution references",
    (entry) => {
      const { before, incoming } = collision();
      const baseSource = {
        url: "https://docs.google.com/spreadsheets/d/base",
        sheetName: "一覧",
      };
      const nextSource =
        entry === "source-switch"
          ? { ...baseSource, url: `${baseSource.url}-next` }
          : baseSource;
      const state = {
        eventLists: { event: before },
        eventMetadata: {
          event: {
            spreadsheetUrl: baseSource.url,
            spreadsheetSheetName: baseSource.sheetName,
            lastImportDate: "2026-10-18",
          },
        },
        executeModeItems: { event: { "1日目": ["B", "A"] } },
      };
      const pending = {
        kind:
          entry === "items-only"
            ? ("items-only" as const)
            : ("source-switch" as const),
        eventName: "event",
        baseSource,
        nextSource,
        diff: createEventUpdateDiff(before, incoming),
      };
      const after = applyPendingEventUpdate({
        state,
        pending,
        baseItems: before,
        options: {},
      });
      expect(after?.eventLists.event).toEqual([
        { ...before[0], title: "新A" },
        { ...before[1], title: "旧A" },
      ]);
      expect(after?.executeModeItems).toEqual(state.executeModeItems);
      expect(after?.eventMetadata.event.spreadsheetUrl).toBe(nextSource.url);
    },
  );

  it("trims only comparison edges across identity fields and keeps persisted identifiers", () => {
    const before = [
      {
        ...items()[0],
        circle: " X Y ",
        eventDate: " 1日目 ",
        block: " A ",
        number: " 01a ",
        title: " 旧題 ",
      },
    ];
    const incoming = [
      {
        ...rows()[0],
        circle: "X Y",
        eventDate: "1日目",
        block: "A",
        number: "01a",
        title: "旧題",
      },
    ];
    const diff = createEventUpdateDiff(before, incoming);
    expect(diff.itemsToAdd).toEqual([]);
    expect(diff.itemsToDelete).toEqual([]);
    expect(applyEventUpdateToItems(before, diff)).toEqual([
      { ...before[0], title: "旧題" },
    ]);
    expect(
      matchSheetItems(before, [{ ...incoming[0], circle: "XY" }]).matches.size,
    ).toBe(0);
    expect(
      matchSheetItems(before, [{ ...incoming[0], number: "1a" }]).matches.size,
    ).toBe(0);
  });

  it("keeps raw group signature and fallback ordering when all rows already match", () => {
    const before = items().map((item, index) => ({
      ...item,
      title: `旧${index}`,
      circle: "X",
      catalogPrice: 500 + index * 200,
    }));
    const incoming = before
      .map((item, index) => ({ ...item, title: `新${index}` }))
      .reverse();
    expect(
      [0, 1].map(
        (row) => matchSheetItems(before, incoming).matches.get(row)?.id,
      ),
    ).toEqual(["2", "1"]);
    before[0].sheetIdentityVerified = undefined;
    expect(
      [0, 1].map(
        (row) => matchSheetItems(before, incoming).matches.get(row)?.id,
      ),
    ).toEqual(["1", "2"]);
    const trimmedOnly = before.map((item) => ({ ...item, circle: " X " }));
    expect(
      [0, 1].map(
        (row) => matchSheetItems(trimmedOnly, incoming).matches.get(row)?.id,
      ),
    ).toEqual(["1", "2"]);
  });
});
