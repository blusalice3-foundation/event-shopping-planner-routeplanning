import { describe, expect, it } from "vitest";
import { emptyApplicationSnapshot } from "./useApplicationSnapshot";
import {
  applyItemContentEdits,
  collectItemContentEdits,
} from "./itemContentEdits";

const item = {
  id: "one",
  eventDate: "1日目",
  block: "A",
  number: "1",
  remarks: "旧メモ",
  price: 500,
  quantity: 1,
};
const snapshot = () => ({
  ...emptyApplicationSnapshot(),
  eventLists: { event: [item, { ...item, id: "two" }] },
});

describe("accepted item field edits", () => {
  it("preserves newer unrelated fields, other items and map references", () => {
    const base = snapshot();
    const next = {
      ...base,
      eventLists: {
        event: [{ ...item, remarks: "ユーザー登録" }, base.eventLists.event[1]],
      },
    };
    const edits = collectItemContentEdits(base, next)!;
    const latest = {
      ...base,
      eventLists: {
        event: [{ ...item, price: 900, quantity: 4 }, base.eventLists.event[1]],
      },
    };
    const result = applyItemContentEdits(latest, edits);
    expect(result.eventLists.event[0]).toMatchObject({
      remarks: "ユーザー登録",
      price: 900,
      quantity: 4,
    });
    expect(result.eventLists.event[1]).toBe(latest.eventLists.event[1]);
    expect(result.mapData).toBe(latest.mapData);
    expect(latest.eventLists.event[0].remarks).toBe("旧メモ");
    expect(applyItemContentEdits(result, edits)).toBe(result);
  });

  it("clears an optional purchased quantity without resetting another field", () => {
    const base = snapshot();
    base.eventLists.event[0] = {
      ...item,
      limitedPurchasedQuantity: 1,
    } as typeof item;
    const next = {
      ...base,
      eventLists: { event: [item, base.eventLists.event[1]] },
    };
    const edits = collectItemContentEdits(base, next)!;
    const latest = {
      ...base,
      eventLists: {
        event: [
          { ...base.eventLists.event[0], price: 900 },
          base.eventLists.event[1],
        ],
      },
    };
    const result = applyItemContentEdits(latest, edits);
    expect(result.eventLists.event[0]).not.toHaveProperty(
      "limitedPurchasedQuantity",
    );
    expect(result.eventLists.event[0]).toHaveProperty("price", 900);
  });

  it("does not recreate an item or event removed by another tab", () => {
    const base = snapshot();
    const next = {
      ...base,
      eventLists: {
        event: [{ ...item, remarks: "更新" }, base.eventLists.event[1]],
      },
    };
    const edits = collectItemContentEdits(base, next)!;
    const removedItem = {
      ...base,
      eventLists: { event: [base.eventLists.event[1]] },
    };
    const removedEvent = { ...base, eventLists: {} };
    expect(applyItemContentEdits(removedItem, edits)).toBe(removedItem);
    expect(applyItemContentEdits(removedEvent, edits)).toBe(removedEvent);
  });

  it("excludes layout changes, reorders and multi-store proposals from previews", () => {
    const base = snapshot();
    expect(
      collectItemContentEdits(base, {
        ...base,
        eventLists: {
          event: [{ ...item, block: "B" }, base.eventLists.event[1]],
        },
      }),
    ).toBeUndefined();
    expect(
      collectItemContentEdits(base, {
        ...base,
        eventLists: { event: [...base.eventLists.event].reverse() },
      }),
    ).toBeUndefined();
    expect(
      collectItemContentEdits(base, {
        ...base,
        dayModes: { event: { "1日目": "execute" } },
      }),
    ).toBeUndefined();
  });
});
