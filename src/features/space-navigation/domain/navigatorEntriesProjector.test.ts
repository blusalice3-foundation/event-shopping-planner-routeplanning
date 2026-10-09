import { describe, expect, it } from "vitest";
import type { NavigatorItem } from "../types";
import { indexedItems, registerItemChanges } from "../../../utils/itemIndex";
import {
  buildFocusNavigatorEntries,
  buildNavigatorEntries,
} from "./buildNavigatorEntries";
import {
  createFocusNavigatorEntriesProjector,
  createNavigatorEntriesProjector,
  createRouteEntriesProjector,
} from "./navigatorEntriesProjector";
import { navigatorEntryIndex } from "./navigatorEntryIndex";

const item = (
  index: number,
  status: NavigatorItem["purchaseStatus"] = "None",
): NavigatorItem => ({
  id: String(index),
  circle: "サークル" + index,
  block: "A",
  number: String(index + 1),
  priorityLevel: "none",
  purchaseStatus: status,
  price: 500,
  quantity: 2,
});

describe.each([150, 500, 1500])(
  "navigator projections with %i items",
  (count) => {
    it("reuses every unrelated entry, index bucket and route geometry after one field edit", () => {
      const project = createFocusNavigatorEntriesProjector();
      const route = createRouteEntriesProjector();
      const original = Array.from({ length: count }, (_, index) => item(index));
      const sources = {
        normal: original,
        postponed: [item(count, "Postpone")],
        late: [item(count + 1, "Late")],
      };
      const first = project(sources);
      const firstIndex = navigatorEntryIndex(first);
      const firstGeometry = route(first);
      const changed = original.slice();
      changed[50] = {
        ...original[50],
        purchaseStatus: "Purchased",
        price: null,
      };
      registerItemChanges(original, changed, [50]);
      const next = project({ ...sources, normal: changed });
      expect(next).toEqual(
        buildFocusNavigatorEntries({ ...sources, normal: changed }),
      );
      expect(
        next.filter((entry, index) => entry !== first[index]),
      ).toHaveLength(1);
      expect(next[50].itemIds).toBe(first[50].itemIds);
      expect(next[50].warningKinds).toContain("price");
      expect(route(next)).toBe(firstGeometry);
      const nextIndex = navigatorEntryIndex(next);
      expect(nextIndex.byId.get(next[50].id)).toBe(next[50]);
      expect(nextIndex.bySpace.get(next[49].spaceKey)).toBe(
        firstIndex.bySpace.get(first[49].spaceKey),
      );
      expect(nextIndex.byPhase.get("late")).toBe(
        firstIndex.byPhase.get("late"),
      );
      expect(nextIndex.spaceOrderByPhase).toBe(firstIndex.spaceOrderByPhase);
      expect(firstIndex.byId.get(first[50].id)?.items[0]).toBe(original[50]);
      expect(indexedItems(next).get(next[50].id)).toBe(next[50]);
    });
  },
);

it("merges split visits in their first position and rebuilds membership after identity changes", () => {
  const project = createNavigatorEntriesProjector();
  const original = [item(0), item(1), { ...item(2), number: "1" }];
  const first = project(original);
  expect(first).toEqual(buildNavigatorEntries(original));
  expect(first[0].itemIds).toEqual(["0", "2"]);
  const changed = original.slice();
  changed[2] = {
    ...original[2],
    purchaseStatus: "LimitedPurchase",
    limitedPurchasedQuantity: 1,
  };
  registerItemChanges(original, changed, [2]);
  const updated = project(changed);
  expect(updated).toEqual(buildNavigatorEntries(changed));
  expect(updated[1]).toBe(first[1]);
  const relocated = changed.slice();
  relocated[2] = { ...changed[2], number: "3" };
  registerItemChanges(changed, relocated, [2]);
  expect(project(relocated)).toEqual(buildNavigatorEntries(relocated));
  expect(project(relocated.slice(1))).toEqual(
    buildNavigatorEntries(relocated.slice(1)),
  );
});

it("updates phase offsets when membership changes and handles a 1500-item bulk update", () => {
  const project = createFocusNavigatorEntriesProjector();
  let normal = Array.from({ length: 1500 }, (_, index) => item(index));
  const postponed = [item(1500, "Postpone")],
    late = [item(1501, "Late")];
  const first = project({ normal, postponed, late });
  navigatorEntryIndex(first);
  const before = normal;
  normal = normal.map((member) => ({
    ...member,
    purchaseStatus: "Purchased" as const,
  }));
  registerItemChanges(
    before,
    normal,
    normal.map((_, index) => index),
  );
  const bulk = project({ normal, postponed, late });
  expect(bulk).toEqual(buildFocusNavigatorEntries({ normal, postponed, late }));
  const index = navigatorEntryIndex(bulk);
  expect(
    index.byPhase
      .get("normal")
      ?.every((entry, position) => entry === bulk[position]),
  ).toBe(true);
  expect(index.byPhase.get("late")![0]).toBe(bulk[1501]);
  const reduced = { normal: normal.slice(0, 2), postponed: [], late };
  const structural = project(reduced);
  expect(structural).toEqual(buildFocusNavigatorEntries(reduced));
  expect(navigatorEntryIndex(structural).byPhase.get("late")![0].index).toBe(2);
  expect(project({ normal, postponed, late })).toEqual(
    buildFocusNavigatorEntries({ normal, postponed, late }),
  );
});
