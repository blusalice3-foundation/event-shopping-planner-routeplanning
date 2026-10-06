import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../../../types/item";
import type { DayMapData } from "../../../types/map";
import { collectFocusCellItems, summarizeFocusCell } from "./focusCellState";
const item = (id: string, patch: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  circle: id,
  title: "",
  eventDate: "1日目",
  block: "A",
  number: "01a",
  price: 100,
  quantity: 2,
  purchaseStatus: "None",
  remarks: "",
  ...patch,
});
const map: DayMapData = {
  cells: [],
  mergedCells: [],
  maxRow: 3,
  maxCol: 3,
  blocks: [
    {
      name: "A",
      startRow: 1,
      startCol: 1,
      endRow: 3,
      endCol: 3,
      numberCells: [{ row: 2, col: 2, value: 1 }],
    },
  ],
};
describe("focus map completion (I05)", () => {
  it("keeps mixed postponement and lateness incomplete", () => {
    const summary = summarizeFocusCell([
      item("a", { purchaseStatus: "Postpone" }),
      item("b", { purchaseStatus: "Late" }),
    ]);
    expect(summary).toMatchObject({
      isVisited: false,
      allProcessed: false,
      allPostponed: false,
      allLate: false,
    });
  });
  it.each([undefined, 0, 2, 3, 1.5])(
    "does not complete invalid limited quantity %s",
    (quantity) => {
      expect(
        summarizeFocusCell([
          item("a", {
            purchaseStatus: "LimitedPurchase",
            limitedPurchasedQuantity: quantity,
          }),
        ]).isVisited,
      ).toBe(false);
    },
  );
  it("uses the navigator completion rule for every execution item", () => {
    expect(
      summarizeFocusCell([
        item("a", {
          purchaseStatus: "LimitedPurchase",
          limitedPurchasedQuantity: 1,
        }),
        item("b", { purchaseStatus: "SoldOut" }),
        item("c", { purchaseStatus: "Purchased" }),
      ]).isVisited,
    ).toBe(true);
    expect(summarizeFocusCell([]).isVisited).toBe(false);
  });
  it("deduplicates execution IDs and keeps candidates separate", () => {
    const bought = item("a", { purchaseStatus: "Purchased" });
    const result = collectFocusCellItems(
      [bought, bought, item("b")],
      ["a", "a"],
      "1日目",
      map,
    );
    expect(result.execution.get("2-2")?.map((value) => value.id)).toEqual([
      "a",
    ]);
    expect(result.candidates.get("2-2")?.map((value) => value.id)).toEqual([
      "b",
    ]);
    expect(summarizeFocusCell(result.execution.get("2-2")!).isVisited).toBe(
      true,
    );
  });
  it("keeps actual days distinct when they share a map", () => {
    const result = collectFocusCellItems(
      [
        item("a", { eventDate: " 1日目　" }),
        item("b", { eventDate: "１日目" }),
      ],
      ["a", "b"],
      "1日目",
      map,
    );
    expect(result.execution.get("2-2")?.map((value) => value.id)).toEqual([
      "a",
    ]);
  });
  it("does not place either execution or candidate items at ambiguous coordinates", () => {
    const ambiguous = {
      ...map,
      blocks: [
        ...map.blocks,
        { ...map.blocks[0], numberCells: [{ row: 3, col: 3, value: 1 }] },
      ],
    };
    const result = collectFocusCellItems(
      [item("a"), item("b")],
      ["a"],
      "1日目",
      ambiguous,
    );
    expect(result.execution.size).toBe(0);
    expect(result.candidates.size).toBe(0);
  });
});

describe("focus map status labels", () => {
  it.each([
    [["Postpone", "Late"], "後1・遅1"],
    [["Purchased", "Postpone"], "後1・済1"],
    [["None", "Late"], "未1・遅1"],
    [["None", "Postpone", "Late", "Purchased"], "未1・後1・遅1・済1"],
    [["Postpone", "Postpone"], "後"],
    [["Late"], "遅"],
    [["SoldOut", "Absent", "Purchased"], "済"],
  ] as const)("shows %s as %s", (statuses, label) => {
    expect(
      summarizeFocusCell(
        statuses.map((purchaseStatus, index) =>
          item(String(index), { purchaseStatus }),
        ),
      ).statusLabel,
    ).toBe(label);
  });

  it("deduplicates counts and keeps invalid limited quantities visibly incomplete", () => {
    const postponed = item("a", { purchaseStatus: "Postpone" });
    expect(
      summarizeFocusCell([
        postponed,
        postponed,
        item("b", { purchaseStatus: "LimitedPurchase" }),
        item("c", {
          purchaseStatus: "LimitedPurchase",
          limitedPurchasedQuantity: 1,
        }),
      ]).statusLabel,
    ).toBe("後1・限未1・済1");
    expect(summarizeFocusCell([]).statusLabel).toBe("");
  });
});
