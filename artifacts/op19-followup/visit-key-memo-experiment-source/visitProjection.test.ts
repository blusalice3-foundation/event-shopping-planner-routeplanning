import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../types/item";
import { getSpaceKey } from "./spaceGrouping";
import {
  buildExecutionVisitProjectionKey,
  buildPhaseVisitProjectionKey,
  projectExecutionVisitItemIdsForView,
  projectItemsToExecutionVisits,
} from "./visitProjection";

const item = (
  id: string,
  overrides: Partial<ShoppingItem> = {},
): ShoppingItem => ({
  id,
  circle: id,
  eventDate: "1日目",
  block: "A",
  number: "01a",
  title: "",
  price: null,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "",
  priorityLevel: "none",
  ...overrides,
});

describe("visitProjection", () => {
  it("merges non-contiguous aliases into the first visit position", () => {
    const a1 = item("a1");
    const b = item("b", { block: "B", number: "02a" });
    const a2 = item("a2", { number: "01a2" });

    const visits = projectItemsToExecutionVisits([a1, b, a2]);

    expect(visits.map(({ itemIds }) => itemIds)).toEqual([["a1", "a2"], ["b"]]);
    expect(
      projectExecutionVisitItemIdsForView(["a1", "b", "a2"], [a1, b, a2]),
    ).toEqual(["a1", "a2", "b"]);
  });

  it("keeps different dates, priorities, and phases as distinct visits", () => {
    const base = item("base");
    const otherDate = item("date", { eventDate: "2日目" });
    const priority = item("priority", { priorityLevel: "priority" });
    const late = item("late");

    expect(
      projectItemsToExecutionVisits([base, otherDate, priority]).map(
        ({ itemIds }) => itemIds,
      ),
    ).toEqual([["base"], ["date"], ["priority"]]);
    expect(buildExecutionVisitProjectionKey(base)).toBe(
      buildExecutionVisitProjectionKey(late),
    );
    expect(buildPhaseVisitProjectionKey(base, "normal")).not.toBe(
      buildPhaseVisitProjectionKey(late, "late"),
    );
  });

  it("normalizes full-width spaces in execution visit dates", () => {
    const plain = item("plain", { eventDate: "1日目" });
    const padded = item("padded", { eventDate: " 1日目\u3000" });

    expect(buildExecutionVisitProjectionKey(padded)).toBe(
      buildExecutionVisitProjectionKey(plain),
    );
    expect(
      projectItemsToExecutionVisits([plain, padded]).map(
        ({ itemIds }) => itemIds,
      ),
    ).toEqual([["plain", "padded"]]);
  });

  it("retains unknown IDs instead of dropping persisted data", () => {
    const a1 = item("a1");
    const a2 = item("a2", { number: "01a2" });

    expect(
      projectExecutionVisitItemIdsForView(["a1", "missing", "a2"], [a1, a2]),
    ).toEqual(["a1", "missing", "a2"]);
  });
});

const originalExecutionKey = (value: ShoppingItem): string =>
  JSON.stringify([
    value.eventDate.replace(/\u3000/g, " ").trim(),
    getSpaceKey(value.block, value.number),
    value.priorityLevel || "none",
  ]);

describe("execution visit key reuse", () => {
  it("preserves the original identity for Unicode, aliases, and priorities", () => {
    const dates = ["1日目", " 1日目\u3000", "２日目", "", '日\\"目'];
    const blocks = ["A", " Ａ ", "東  甲", "", 'A\\"'];
    const numbers = ["01a", "０１Ａ２", " 01 a3 ", "1", "01", "", '1\\"'];
    const priorities: ShoppingItem["priorityLevel"][] = [
      undefined,
      "none",
      "priority",
      "highest",
    ];

    for (const eventDate of dates) {
      for (const block of blocks) {
        for (const number of numbers) {
          for (const priorityLevel of priorities) {
            const value = Object.freeze(
              item("same-id", { eventDate, block, number, priorityLevel }),
            );
            const expected = originalExecutionKey(value);
            expect(buildExecutionVisitProjectionKey(value)).toBe(expected);
            expect(buildExecutionVisitProjectionKey(value)).toBe(expected);
          }
        }
      }
    }
  });

  it.each([
    ["eventDate", "2日目"],
    ["block", "B"],
    ["number", "02b"],
    ["priorityLevel", "highest"],
  ] as const)(
    "detects a same-object change to %s and its restoration",
    (field, next) => {
      const value = item("mutable");
      const previous = value[field];
      const before = buildExecutionVisitProjectionKey(value);
      Object.assign(value, { [field]: next });

      const after = buildExecutionVisitProjectionKey(value);
      expect(after).toBe(originalExecutionKey(value));
      expect(after).not.toBe(before);
      expect(buildExecutionVisitProjectionKey(value)).toBe(after);

      Object.assign(value, { [field]: previous });
      expect(buildExecutionVisitProjectionKey(value)).toBe(before);
    },
  );

  it("handles changes through equivalent raw spellings before a new identity", () => {
    const value = item("aliases");
    const original = buildExecutionVisitProjectionKey(value);
    Object.assign(value, {
      eventDate: "\u30001日目 ",
      block: " Ａ ",
      number: "０１Ａ２",
      priorityLevel: undefined,
    });
    expect(buildExecutionVisitProjectionKey(value)).toBe(original);

    Object.assign(value, {
      eventDate: "2日目",
      block: "B",
      number: "02b",
      priorityLevel: "priority",
    });
    expect(buildExecutionVisitProjectionKey(value)).toBe(
      '["2日目","B-02b","priority"]',
    );
  });

  it("keeps copies independent even when IDs and initial keys match", () => {
    const original = item("same-id");
    const copy = { ...original };
    const first = buildExecutionVisitProjectionKey(original);
    expect(buildExecutionVisitProjectionKey(copy)).toBe(first);

    original.eventDate = "2日目";
    expect(buildExecutionVisitProjectionKey(original)).toBe(
      originalExecutionKey(original),
    );
    expect(buildExecutionVisitProjectionKey(copy)).toBe(first);

    copy.block = "B";
    expect(buildExecutionVisitProjectionKey(copy)).toBe(
      originalExecutionKey(copy),
    );
    expect(buildExecutionVisitProjectionKey(copy)).not.toBe(
      buildExecutionVisitProjectionKey(original),
    );
  });

  it("does not include purchase, display, hall, or persistence fields in identity", () => {
    const value = item("original");
    const before = buildExecutionVisitProjectionKey(value);
    Object.assign(value, {
      id: "changed",
      circle: "変更",
      title: "変更後の商品",
      price: 1200,
      catalogPrice: 1500,
      purchaseStatus: "LimitedPurchase",
      quantity: 3,
      limitedPurchasedQuantity: 2,
      remarks: "メモ",
      sheetRemarks: "同期メモ",
      sheetIdentityVerified: true,
      url: "https://example.test/changed",
      protectionLevel: "full",
      source: "app",
      assignedTo: "担当",
      lastSyncedAt: "2026-10-19T00:00:00Z",
      orderIndex: 8,
      postponed: true,
      manualHallId: "changed-hall",
    } satisfies Partial<ShoppingItem>);

    expect(buildExecutionVisitProjectionKey(value)).toBe(before);
    expect(buildExecutionVisitProjectionKey(value)).toBe(
      originalExecutionKey(value),
    );
    expect(buildPhaseVisitProjectionKey(value, "normal")).toBe(
      '["normal","1日目","A-01a","none"]',
    );
    value.number = "02b";
    expect(buildPhaseVisitProjectionKey(value, "late")).toBe(
      '["late","1日目","A-02b","none"]',
    );
    expect(buildExecutionVisitProjectionKey(value)).toBe(
      originalExecutionKey(value),
    );
  });
});
