import { registerItemChanges } from "../../../utils/itemIndex";
import { describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../../../types/item";
import type { DayMapData } from "../../../types/map";
import {
  collectFocusCellItems,
  summarizeFocusCell,
  createFocusCellItemsProjector,
  createFocusCellDisplayProjector,
} from "./focusCellState";
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

it("reuses coordinates and unaffected cell memberships on a status change", () => {
  const project = createFocusCellItemsProjector();
  const ids = ["a", "b"];
  const original = [item("a"), item("b", { number: "02a" })];
  const resolver = vi.fn(
    (_map: DayMapData, member: Pick<ShoppingItem, "block" | "number">) => ({
      status: "resolved" as const,
      location: { cell: { row: 1, col: member.number === "01a" ? 1 : 2 } },
    }),
  );
  // Use the production resolver's full shape for the cache contract.
  const resolve = resolver as unknown as Parameters<
    typeof collectFocusCellItems
  >[4];
  const first = project(original, ids, "1日目", map, resolve);
  resolver.mockClear();
  const next = project(
    [{ ...original[0], purchaseStatus: "SoldOut" }, original[1]],
    ids,
    "1日目",
    map,
    resolve,
  );
  expect(resolver).not.toHaveBeenCalled();
  expect(next.execution.get("1-2")).toBe(first.execution.get("1-2"));
  expect(next.execution.get("1-1")![0].purchaseStatus).toBe("SoldOut");
});

it("updates one of 1500 map cells for a purchase and only adjacent markers for navigation", () => {
  const projectMembers = createFocusCellItemsProjector();
  const getVisitKey = vi.fn((member: ShoppingItem) => member.id);
  const projectDisplay = createFocusCellDisplayProjector(getVisitKey);
  const original = Array.from({ length: 1500 }, (_, index) =>
    item(String(index), { number: String(index + 1) }),
  );
  const ids = original.map((member) => member.id);
  const resolve = vi.fn(
    (_map: DayMapData, member: Pick<ShoppingItem, "block" | "number">) => ({
      status: "resolved" as const,
      location: { cell: { row: 1, col: Number(member.number) } },
    }),
  ) as unknown as Parameters<typeof collectFocusCellItems>[4];
  const firstMembers = projectMembers(original, ids, "1日目", map, resolve);
  const positions = { officialVisitKey: "0", temporaryVisitKey: null };
  const first = projectDisplay(
    firstMembers.execution,
    positions,
    "1",
    null,
    "normal",
    0,
  );
  const coords = first.coordinates("0");
  getVisitKey.mockClear();
  const changed = original.slice();
  changed[500] = { ...original[500], purchaseStatus: "Purchased" };
  registerItemChanges(original, changed, [500]);
  const nextMembers = projectMembers(changed, ids, "1日目", map, resolve);
  const next = projectDisplay(
    nextMembers.execution,
    positions,
    "1",
    null,
    "normal",
    0,
  );
  expect(next.updatedCellCount).toBe(1);
  expect(next.states.get("1-501")?.isVisited).toBe(true);
  expect(next.states.get("1-500")).toBe(first.states.get("1-500"));
  expect(next.labels.get("1-500")).toBe(first.labels.get("1-500"));
  expect(next.coordinates("0")).toBe(coords);
  expect(getVisitKey).not.toHaveBeenCalled();
  const moved = projectDisplay(
    nextMembers.execution,
    { officialVisitKey: "1", temporaryVisitKey: "3" },
    "2",
    "0",
    "normal",
    1,
  );
  expect(moved.updatedCellCount).toBe(4);
  expect(moved.states.get("1-2")?.isCurrentPosition).toBe(true);
  expect(moved.states.get("1-1")?.isCurrentPosition).toBe(false);
  expect(moved.states.get("1-4")?.isTemporaryPosition).toBe(true);
  expect(moved.states.get("1-501")).toBe(next.states.get("1-501"));
  const same = projectDisplay(
    nextMembers.execution,
    { officialVisitKey: "1", temporaryVisitKey: "3" },
    "2",
    "0",
    "normal",
    1,
  );
  expect(same.updatedCellCount).toBe(0);
  expect(same.states).toBe(moved.states);
  const removed = projectMembers(
    changed.filter((member) => member.id !== "500"),
    ids,
    "1日目",
    map,
    resolve,
  );
  expect(
    projectDisplay(
      removed.execution,
      positions,
      null,
      null,
      "normal",
      0,
    ).states.has("1-501"),
  ).toBe(false);
});
