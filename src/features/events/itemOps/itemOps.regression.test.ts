import { describe, expect, it } from "vitest";
import type { ExecuteModeItems, ShoppingItem } from "../../../types/item";
import type { HallDefinition, HallRouteSettings } from "../../../types/map";
import {
  computeAddToExecuteListFromMap,
  computeAddToExecuteListFromMapWithResult,
  computeBatchAddToExecuteListFromMapWithResult,
  computeAddItemFromFocusMode,
  computeDeleteItem,
  computeInsertIntoExecuteAtPosition,
  computeMoveItem,
  computeRemoveFromExecuteListFromMap,
  computeRemoveFromExecuteListFromMapWithResult,
  computeUpdateItemPriority,
  expandExecuteRemovalItemIds,
  expandSameSpacePriorityItemIds,
  repositionExecuteItemAfterIdentityChange,
  repositionExecuteItemAfterIdentityChangeWithResult,
  reorderExecuteIdsForSpaceAdjacency,
} from "./index";

const dayName = "2026-01-01";

const makeItem = (
  id: string,
  block: string,
  number: string,
  priorityLevel: ShoppingItem["priorityLevel"] = "none",
): ShoppingItem => ({
  id,
  circle: id,
  eventDate: dayName,
  block,
  number,
  title: "",
  price: null,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "",
  priorityLevel,
});

const halls: HallDefinition[] = [
  { id: "hall-a", name: "Hall A", vertices: [], blockNames: ["A"] },
  { id: "hall-b", name: "Hall B", vertices: [], blockNames: ["B"] },
];

const emptySettings: HallRouteSettings = { hallOrder: [], hallVisitLists: [] };

describe("itemOps regressions", () => {
  it("promotes the first surviving visit member when deleting its representative", () => {
    const a1 = makeItem("a1", "A", "01a");
    const between = makeItem("between", "B", "02");
    const a2 = makeItem("a2", "A", "01a2");

    const result = computeDeleteItem([a1, between, a2], "a1", {
      [dayName]: ["a1", "between", "a2"],
    });

    expect(result.executeModeItems[dayName]).toEqual(["a2", "between"]);
  });

  it("deletes a nonrepresentative without moving other raw IDs", () => {
    const a1 = makeItem("a1", "A", "01a");
    const between = makeItem("between", "B", "02");
    const a2 = makeItem("a2", "A", "01a2");

    const result = computeDeleteItem([a1, between, a2], "a2", {
      [dayName]: ["a1", "between", "a2"],
    });

    expect(result.executeModeItems[dayName]).toEqual(["a1", "between"]);
  });

  it("does not promote a same-space member with a different priority", () => {
    const a1 = makeItem("a1", "A", "01a");
    const between = makeItem("between", "B", "02");
    const a2 = makeItem("a2", "A", "01a2", "highest");

    const result = computeDeleteItem([a1, between, a2], "a1", {
      [dayName]: ["a1", "between", "a2"],
    });

    expect(result.executeModeItems[dayName]).toEqual(["between", "a2"]);
  });

  it("keeps the destination visit position when an edited item joins it", () => {
    const editing = makeItem("editing", "C", "03");
    const between = makeItem("between", "B", "02");
    const destination = makeItem("destination", "A", "01a");
    const updated = { ...editing, block: "A", number: "01a2" };

    expect(
      repositionExecuteItemAfterIdentityChange(
        { [dayName]: ["editing", "between", "destination"] },
        editing,
        updated,
        [updated, between, destination],
      )[dayName],
    ).toEqual(["between", "destination", "editing"]);
  });

  it("stabilizes the source visit before merging a changed representative", () => {
    const a1 = makeItem("a1", "A", "01a");
    const between = makeItem("between", "B", "02");
    const a2 = makeItem("a2", "A", "01a2");
    const c1 = makeItem("c1", "C", "03");
    const updated = { ...a1, block: "C", number: "03" };

    const result = repositionExecuteItemAfterIdentityChangeWithResult(
      { [dayName]: ["a1", "between", "a2", "c1"] },
      a1,
      updated,
      [updated, between, a2, c1],
    );

    expect(result.executeModeItems[dayName]).toEqual([
      "a2",
      "between",
      "c1",
      "a1",
    ]);
    expect(result).toMatchObject({
      placement: "merged-into-existing-visit",
      mergedIntoVisitItemIds: ["c1"],
    });
  });

  it("appends a new identity after stabilizing its surviving source visit", () => {
    const a1 = makeItem("a1", "A", "01a");
    const between = makeItem("between", "B", "02");
    const a2 = makeItem("a2", "A", "01a2");
    const updated = { ...a1, block: "C", number: "03" };

    expect(
      repositionExecuteItemAfterIdentityChange(
        { [dayName]: ["a1", "between", "a2"] },
        a1,
        updated,
        [updated, between, a2],
      )[dayName],
    ).toEqual(["a2", "between", "a1"]);
  });

  it("keeps the raw slot for a nonrepresentative identity change", () => {
    const a1 = makeItem("a1", "A", "01a");
    const between = makeItem("between", "B", "02");
    const a2 = makeItem("a2", "A", "01a2");
    const updated = { ...a2, block: "C", number: "03" };

    expect(
      repositionExecuteItemAfterIdentityChange(
        { [dayName]: ["a1", "between", "a2"] },
        a2,
        updated,
        [a1, between, updated],
      )[dayName],
    ).toEqual(["a1", "between", "a2"]);
  });

  it("lets a new identity inherit the old slot when its source disappears", () => {
    const a1 = makeItem("a1", "A", "01a");
    const between = makeItem("between", "B", "02");
    const updated = { ...a1, block: "C", number: "03" };

    expect(
      repositionExecuteItemAfterIdentityChange(
        { [dayName]: ["a1", "between"] },
        a1,
        updated,
        [updated, between],
      )[dayName],
    ).toEqual(["a1", "between"]);
  });

  it("transfers an edited execute item to its destination date", () => {
    const editing = makeItem("editing", "C", "03");
    const destination = {
      ...makeItem("destination", "A", "01a"),
      eventDate: "2026-01-02",
    };
    const updated = {
      ...editing,
      eventDate: "2026-01-02",
      block: "A",
      number: "01a2",
    };

    expect(
      repositionExecuteItemAfterIdentityChange(
        {
          [dayName]: ["editing"],
          "2026-01-02": ["destination"],
        },
        editing,
        updated,
        [updated, destination],
      ),
    ).toEqual({
      [dayName]: [],
      "2026-01-02": ["destination", "editing"],
    });
  });

  it("stabilizes a surviving source visit before a cross-date destination merge", () => {
    const a1 = makeItem("a1", "A", "01a");
    const between = makeItem("between", "B", "02");
    const a2 = makeItem("a2", "A", "01a2");
    const destination = {
      ...makeItem("destination", "C", "03"),
      eventDate: "2026-01-02",
    };
    const updated = {
      ...a1,
      eventDate: "2026-01-02",
      block: "C",
      number: "03",
    };

    const result = repositionExecuteItemAfterIdentityChangeWithResult(
      {
        [dayName]: ["a1", "between", "a2"],
        "2026-01-02": ["destination"],
      },
      a1,
      updated,
      [updated, between, a2, destination],
    );

    expect(result.executeModeItems).toEqual({
      [dayName]: ["a2", "between"],
      "2026-01-02": ["destination", "a1"],
    });
    expect(result.placement).toBe("merged-into-existing-visit");
  });

  it("returns merge placement when Focus adds to an existing execution visit", () => {
    const a1 = makeItem("a1", "A", "01a");
    const between = makeItem("between", "B", "02");

    const result = computeAddItemFromFocusMode(
      [a1, between],
      {
        ...makeItem("ignored", "A", "01a2"),
        purchaseStatus: "Postpone",
      },
      { [dayName]: ["a1", "between"] },
    );

    expect(result.executeModeItems[dayName]).toEqual([
      "a1",
      result.newItemId,
      "between",
    ]);
    expect(result).toMatchObject({
      placement: "merged-into-existing-visit",
      mergedIntoVisitItemIds: ["a1"],
    });
  });

  it("reuses a normalized day bucket when Focus adds a padded date", () => {
    const a1 = makeItem("a1", "A", "01a");

    const result = computeAddItemFromFocusMode(
      [a1],
      {
        ...makeItem("ignored", "A", "01a2"),
        eventDate: `${dayName}\u3000`,
        purchaseStatus: "Late",
      },
      { [dayName]: ["a1"] },
    );

    expect(result.executeModeItems).toEqual({
      [dayName]: ["a1", result.newItemId],
    });
  });

  it("keeps a normalized same-day identity edit in the source bucket", () => {
    const a1 = makeItem("a1", "A", "01a");
    const between = makeItem("between", "B", "02");
    const a2 = makeItem("a2", "A", "01a2");
    const updated = {
      ...a1,
      eventDate: `${dayName}\u3000`,
      block: "C",
      number: "03",
    };

    const result = repositionExecuteItemAfterIdentityChangeWithResult(
      { [dayName]: ["a1", "between", "a2"] },
      a1,
      updated,
      [updated, between, a2],
    );

    expect(result.executeModeItems).toEqual({
      [dayName]: ["a2", "between", "a1"],
    });
  });

  it("reuses an existing normalized destination bucket after a real date change", () => {
    const editing = makeItem("editing", "C", "03");
    const destination = {
      ...makeItem("destination", "A", "01a"),
      eventDate: "2026-01-02",
    };
    const updated = {
      ...editing,
      eventDate: "2026-01-02\u3000",
      block: "A",
      number: "01a2",
    };

    const result = repositionExecuteItemAfterIdentityChangeWithResult(
      { [dayName]: ["editing"], "2026-01-02": ["destination"] },
      editing,
      updated,
      [updated, destination],
    );

    expect(result.executeModeItems).toEqual({
      [dayName]: [],
      "2026-01-02": ["destination", "editing"],
    });
  });

  it("expands same-visit members across normalized date padding", () => {
    const a1 = makeItem("a1", "A", "01a");
    const a2 = {
      ...makeItem("a2", "A", "01a2"),
      eventDate: `${dayName}\u3000`,
    };

    expect(
      expandSameSpacePriorityItemIds(["a1"], [a1, a2], {
        dayName,
      }),
    ).toEqual(["a1", "a2"]);
  });

  it("adds map items before later halls according to hallOrder", () => {
    const allItems = [makeItem("b1", "B", "01"), makeItem("a1", "A", "01")];
    const executeModeItems: ExecuteModeItems = { [dayName]: ["b1"] };

    const result = computeAddToExecuteListFromMap(
      "a1",
      dayName,
      allItems,
      executeModeItems,
      halls,
      { hallOrder: ["hall-a", "hall-b"], hallVisitLists: [] },
      undefined,
    );

    expect(result[dayName]).toEqual(["a1", "b1"]);
  });

  it("adds a map item together with uninserted same-space same-priority siblings", () => {
    const allItems = [
      makeItem("b1", "B", "01"),
      makeItem("a1", "A", "01a", "priority"),
      makeItem("a2", "A", "01a2", "priority"),
      makeItem("a3", "A", "01a3", "highest"),
      makeItem("a4", "A", "02", "priority"),
    ];
    const executeModeItems: ExecuteModeItems = { [dayName]: ["b1"] };

    const result = computeAddToExecuteListFromMapWithResult(
      "a1",
      dayName,
      allItems,
      executeModeItems,
      halls,
      { hallOrder: ["hall-a", "hall-b"], hallVisitLists: [] },
      undefined,
    );

    expect(result.insertedItemIds).toEqual(["a1", "a2"]);
    expect(result.executeModeItems[dayName]).toEqual(["a1", "a2", "b1"]);
  });

  it("adds only uninserted same-space siblings when the clicked map item is already inserted", () => {
    const allItems = [
      makeItem("a1", "A", "01a", "priority"),
      makeItem("a2", "A", "01a2", "priority"),
    ];
    const executeModeItems: ExecuteModeItems = { [dayName]: ["a1"] };

    const result = computeAddToExecuteListFromMapWithResult(
      "a1",
      dayName,
      allItems,
      executeModeItems,
      halls,
      emptySettings,
      undefined,
    );

    expect(result.insertedItemIds).toEqual(["a2"]);
    expect(result.executeModeItems[dayName]).toEqual(["a1", "a2"]);
    expect(result).toMatchObject({
      placement: "merged-into-existing-visit",
      mergedIntoVisitItemIds: ["a1"],
    });
  });

  it("keeps mixed merge metadata across a sequential batch map add", () => {
    const a1 = makeItem("a1", "A", "01a");
    const a2 = makeItem("a2", "A", "01a2");
    const b1 = makeItem("b1", "B", "02");

    const result = computeBatchAddToExecuteListFromMapWithResult(
      ["a2", "b1"],
      dayName,
      [a1, a2, b1],
      { [dayName]: ["a1"] },
      halls,
      emptySettings,
      undefined,
    );

    expect(result.executeModeItems[dayName]).toEqual(["a1", "a2", "b1"]);
    expect(result.insertedItemIds).toEqual(["a2", "b1"]);
    expect(result).toMatchObject({
      placement: "mixed",
      mergedIntoVisitItemIds: ["a1"],
    });
    expect(result.insertedItemIds).toMatchObject({
      placement: "mixed",
      mergedIntoVisitItemIds: ["a1"],
    });
  });

  it("removes a map item together with same-space same-priority execute siblings", () => {
    const allItems = [
      makeItem("a1", "A", "01a", "priority"),
      makeItem("a2", "A", "01a2", "priority"),
      makeItem("a3", "A", "01a3", "highest"),
    ];
    const executeModeItems: ExecuteModeItems = {
      [dayName]: ["a1", "a2", "a3"],
    };

    const result = computeRemoveFromExecuteListFromMap(
      "a1",
      executeModeItems,
      dayName,
      allItems,
    );

    expect(result[dayName]).toEqual(["a3"]);
  });

  it("keeps batch map removal equivalent to sequential removal, including returned ID order", () => {
    const allItems = [
      makeItem("a1", "A", "01a", "priority"),
      makeItem("a2", "A", "01a2", "priority"),
      makeItem("b1", "B", "02b"),
      makeItem("b2", "B", "02b2"),
      makeItem("c1", "C", "03"),
    ];
    const executeModeItems: ExecuteModeItems = {
      [dayName]: ["b1", "a1", "c1", "a2", "b2"],
    };
    const requestedIds = ["a2", "b2", "a1"];

    let sequentialItems = executeModeItems;
    const sequentialRemovedIds: string[] = [];
    for (const itemId of requestedIds) {
      const removeIds = expandExecuteRemovalItemIds(
        [itemId],
        dayName,
        allItems,
        sequentialItems,
      );
      const removeIdsSet = new Set(removeIds);
      sequentialItems = {
        ...sequentialItems,
        [dayName]: (sequentialItems[dayName] || []).filter(
          (id) => !removeIdsSet.has(id),
        ),
      };
      for (const removeId of removeIds) {
        if (!sequentialRemovedIds.includes(removeId)) {
          sequentialRemovedIds.push(removeId);
        }
      }
    }

    const result = computeRemoveFromExecuteListFromMapWithResult(
      requestedIds,
      executeModeItems,
      dayName,
      allItems,
    );

    expect(result.removedItemIds).toEqual(["a2", "a1", "b2", "b1"]);
    expect(result.removedItemIds).toEqual(sequentialRemovedIds);
    expect(result.executeModeItems).toEqual(sequentialItems);
    expect(result.executeModeItems[dayName]).toEqual(["c1"]);
  });

  it("removes an inserted sibling when the requested batch seed is not inserted", () => {
    const allItems = [
      makeItem("a1", "A", "01a", "priority"),
      makeItem("a2", "A", "01a2", "priority"),
    ];
    const executeModeItems: ExecuteModeItems = { [dayName]: ["a1"] };

    const result = computeRemoveFromExecuteListFromMapWithResult(
      ["a2"],
      executeModeItems,
      dayName,
      allItems,
    );

    expect(result.removedItemIds).toEqual(["a1"]);
    expect(result.executeModeItems[dayName]).toEqual([]);
  });

  it("keeps seed-first ordering when multiple seeds share one expanded group", () => {
    const allItems = [
      makeItem("a2", "A", "01a2", "priority"),
      makeItem("a1", "A", "01a", "priority"),
      makeItem("a3", "A", "01a3", "priority"),
    ];

    const result = expandSameSpacePriorityItemIds(["a1", "a2"], allItems, {
      excludeSeedIdsFromSiblingExpansion: true,
    });

    expect(result).toEqual(["a1", "a3", "a2"]);
  });

  it("snaps positioned map insert after an existing same-space same-priority group", () => {
    const allItems = [
      makeItem("a1", "A", "01a", "priority"),
      makeItem("a2", "A", "01a2", "priority"),
      makeItem("a3", "A", "01a3", "priority"),
      makeItem("b1", "B", "01"),
    ];
    const executeModeItems: ExecuteModeItems = {
      [dayName]: ["a1", "a2", "b1"],
    };

    const result = computeInsertIntoExecuteAtPosition(
      ["a3"],
      "a1",
      "after",
      executeModeItems,
      dayName,
      allItems,
    );

    expect(result.insertedItemIds).toEqual(["a3"]);
    expect(result.executeModeItems[dayName]).toEqual(["a1", "a2", "a3", "b1"]);
  });

  it("ignores another anchor and reports a merge into the existing visit", () => {
    const allItems = [
      makeItem("a1", "A", "01a", "priority"),
      makeItem("b1", "B", "01"),
      makeItem("a2", "A", "01a2", "priority"),
    ];
    const checkedReferences: string[] = [];

    const result = computeInsertIntoExecuteAtPosition(
      ["a2"],
      "b1",
      "after",
      { [dayName]: ["a1", "b1"] },
      dayName,
      allItems,
      {
        canInsertWithReference: (_insertedId, referenceId) => {
          checkedReferences.push(referenceId);
          return referenceId === "a1";
        },
      },
    );

    expect(result.executeModeItems[dayName]).toEqual(["a1", "a2", "b1"]);
    expect(result).toMatchObject({
      accepted: true,
      placement: "merged-into-existing-visit",
      mergedIntoVisitItemIds: ["a1"],
    });
    expect(checkedReferences).toEqual(["a1"]);
  });

  it("preserves legacy raw ID order while globally merging its projected visit", () => {
    const allItems = [
      makeItem("a1", "A", "01a", "priority"),
      makeItem("b1", "B", "01"),
      makeItem("a2", "A", "01a2", "priority"),
      makeItem("a3", "A", "01a3", "priority"),
    ];

    const result = computeInsertIntoExecuteAtPosition(
      ["a3"],
      "b1",
      "after",
      { [dayName]: ["a1", "b1", "a2"] },
      dayName,
      allItems,
    );

    expect(result.executeModeItems[dayName]).toEqual(["a1", "b1", "a2", "a3"]);
    expect(result.placement).toBe("merged-into-existing-visit");
  });

  it("keeps a different priority as a positioned visit", () => {
    const allItems = [
      makeItem("a-normal", "A", "01a"),
      makeItem("b1", "B", "01"),
      makeItem("a-priority", "A", "01a2", "priority"),
    ];

    const result = computeInsertIntoExecuteAtPosition(
      ["a-priority"],
      "b1",
      "after",
      { [dayName]: ["a-normal", "b1"] },
      dayName,
      allItems,
    );

    expect(result.executeModeItems[dayName]).toEqual([
      "a-normal",
      "b1",
      "a-priority",
    ]);
    expect(result.placement).toBe("positioned");
  });

  it("rejects positioned map insert when the shared boundary rule rejects the reference", () => {
    const allItems = [
      makeItem("a1", "A", "01a", "priority"),
      makeItem("b1", "B", "01"),
    ];
    const executeModeItems: ExecuteModeItems = { [dayName]: ["b1"] };

    const result = computeInsertIntoExecuteAtPosition(
      ["a1"],
      "b1",
      "after",
      executeModeItems,
      dayName,
      allItems,
      { canInsertWithReference: () => false },
    );

    expect(result.accepted).toBe(false);
    expect(result.executeModeItems[dayName]).toEqual(["b1"]);
  });

  it("moves a candidate item together with same-space same-priority siblings", () => {
    const allItems = [
      makeItem("a1", "A", "01", "priority"),
      makeItem("a2", "A", "01", "priority"),
      makeItem("b1", "B", "01"),
    ];

    const result = computeMoveItem({
      dragId: "a1",
      hoverId: "b1",
      targetColumn: "execute",
      sourceColumn: "candidate",
      mode: "edit",
      effectiveSelectedIds: new Set(),
      allItems,
      executeModeItems: { [dayName]: ["b1"] },
      dayName,
      selectedBlockFilters: new Set(),
    });

    expect(result.executeModeItems?.[dayName]).toEqual(["a1", "a2", "b1"]);
  });

  it.each(["b1", "__END_OF_LIST__"])(
    "merges a candidate into an existing noncontiguous visit and ignores anchor %s",
    (hoverId) => {
      const allItems = [
        makeItem("b1", "B", "01"),
        makeItem("a1", "A", "01a"),
        makeItem("a2", "A", "01a2"),
      ];

      const result = computeMoveItem({
        dragId: "a2",
        hoverId,
        targetColumn: "execute",
        sourceColumn: "candidate",
        mode: "edit",
        effectiveSelectedIds: new Set(),
        allItems,
        executeModeItems: { [dayName]: ["b1", "a1"] },
        dayName,
        selectedBlockFilters: new Set(),
      });

      expect(result.executeModeItems?.[dayName]).toEqual(["b1", "a1", "a2"]);
      expect(result).toMatchObject({
        placement: "merged-into-existing-visit",
        mergedIntoVisitItemIds: ["a1"],
      });
    },
  );

  it("keeps a different-priority candidate as a separate positioned visit", () => {
    const allItems = [
      makeItem("b1", "B", "01"),
      makeItem("a1", "A", "01a"),
      makeItem("a2", "A", "01a2", "highest"),
    ];

    const result = computeMoveItem({
      dragId: "a2",
      hoverId: "b1",
      targetColumn: "execute",
      sourceColumn: "candidate",
      mode: "edit",
      effectiveSelectedIds: new Set(),
      allItems,
      executeModeItems: { [dayName]: ["b1", "a1"] },
      dayName,
      selectedBlockFilters: new Set(),
    });

    expect(result.executeModeItems?.[dayName]).toEqual(["a2", "b1", "a1"]);
    expect(result.placement).toBe("positioned");
  });

  it("snaps a new candidate visit before the hover visit global first member", () => {
    const allItems = [
      makeItem("b1", "B", "01a"),
      makeItem("c", "C", "01"),
      makeItem("b2", "B", "01a2"),
      makeItem("a", "A", "01"),
    ];

    const result = computeMoveItem({
      dragId: "a",
      hoverId: "b2",
      targetColumn: "execute",
      sourceColumn: "candidate",
      mode: "edit",
      effectiveSelectedIds: new Set(),
      allItems,
      executeModeItems: { [dayName]: ["b1", "c", "b2"] },
      dayName,
      selectedBlockFilters: new Set(),
    });

    expect(result.executeModeItems?.[dayName]).toEqual(["a", "b1", "c", "b2"]);
  });

  it("snaps execute-column D&D before the hover visit global first member", () => {
    const allItems = [
      makeItem("a1", "A", "01a"),
      makeItem("b", "B", "01"),
      makeItem("a2", "A", "01a2"),
      makeItem("c", "C", "01"),
    ];

    const result = computeMoveItem({
      dragId: "c",
      hoverId: "a2",
      targetColumn: "execute",
      sourceColumn: "execute",
      mode: "edit",
      effectiveSelectedIds: new Set(),
      allItems,
      executeModeItems: { [dayName]: ["a1", "b", "a2", "c"] },
      dayName,
      selectedBlockFilters: new Set(),
    });

    expect(result.executeModeItems?.[dayName]).toEqual(["c", "a1", "b", "a2"]);
  });

  it("blocks execute-column drag reorders across hall boundaries", () => {
    const allItems = [makeItem("a1", "A", "01"), makeItem("b1", "B", "01")];

    const result = computeMoveItem({
      dragId: "a1",
      hoverId: "b1",
      targetColumn: "execute",
      mode: "edit",
      effectiveSelectedIds: new Set(),
      allItems,
      executeModeItems: { [dayName]: ["a1", "b1"] },
      dayName,
      selectedBlockFilters: new Set(),
      areItemsInSameHall: () => false,
    });

    expect(result).toEqual({});
  });

  it("updates priority hall groups and removes an empty old priority group", () => {
    const allItems = [makeItem("a1", "A", "01", "priority")];

    const result = computeUpdateItemPriority(
      "a1",
      "highest",
      allItems,
      halls,
      undefined,
      { ...emptySettings, hallOrder: ["hall-a:priority", "hall-a"] },
    );

    expect(result.items[0].priorityLevel).toBe("highest");
    expect(result.hallRouteSettings.hallOrder).toEqual([
      "hall-a:highest",
      "hall-a",
    ]);
  });

  it("keeps same-space execute items adjacent after a priority change", () => {
    const allItems = [
      makeItem("x1", "X", "01"),
      makeItem("a1", "A", "01", "priority"),
      makeItem("a2", "A", "01", "priority"),
    ];

    const result = reorderExecuteIdsForSpaceAdjacency(
      "a1",
      allItems,
      { [dayName]: ["a1", "x1", "a2"] },
      dayName,
    );

    expect(result[dayName]).toEqual(["x1", "a2", "a1"]);
  });
});
