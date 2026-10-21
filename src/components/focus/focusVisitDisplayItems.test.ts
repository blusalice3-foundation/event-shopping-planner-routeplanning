import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../../types/item";
import { createFocusVisitDisplayItemsProjector } from "./focusVisitDisplayItems";

const item = (
  id: string,
  overrides: Partial<ShoppingItem> = {},
): ShoppingItem => ({
  id,
  eventDate: "1日目",
  block: "A",
  number: "1",
  circle: "ユーザー登録",
  title: "新刊",
  price: 500,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "エラーが発生しました",
  ...overrides,
});

describe("focus-mode recent immutable visit projections", () => {
  it("reuses both exact visit arrays over 1490-item/one-item round trips", () => {
    const project = createFocusVisitDisplayItemsProjector();
    const large = Array.from({ length: 1490 }, (_, i) => item(`large-${i}`));
    const single = item("single"),
      items = [...large, single];
    const largeIds = large.map((entry) => entry.id),
      singleIds = [single.id];
    const firstLarge = project(items, largeIds),
      firstSingle = project(items, singleIds);
    for (let i = 0; i < 20; i++) {
      expect(project(items, largeIds)).toBe(firstLarge);
      expect(project(items, singleIds)).toBe(firstSingle);
    }
    expect(firstLarge).toHaveLength(1490);
    expect(firstLarge.every((entry, i) => entry === large[i])).toBe(true);
    expect(firstSingle[0]).toBe(single);
  });

  it("bounds reuse to the two most recently used visits", () => {
    const project = createFocusVisitDisplayItemsProjector();
    const items = [item("a"), item("b"), item("c")],
      a = ["a"],
      b = ["b"],
      c = ["c"];
    const firstA = project(items, a),
      firstB = project(items, b);
    expect(project(items, a)).toBe(firstA);
    project(items, c);
    expect(project(items, a)).toBe(firstA);
    expect(project(items, b)).not.toBe(firstB);
  });

  it("does not treat a new selected-ID array as the same immutable input", () => {
    const project = createFocusVisitDisplayItemsProjector(),
      items = [item("a")];
    const ids = ["a"],
      first = project(items, ids);
    const next = project(items, [...ids]);
    expect(next).not.toBe(first);
    expect(next).toEqual(first);
  });

  it("revisits updated content and preserves optional fields without ID-only reuse", () => {
    const project = createFocusVisitDisplayItemsProjector();
    const a = item("a", { url: undefined }),
      b = item("b");
    const aIds = ["a"],
      bIds = ["b"],
      original = [a, b];
    const old = project(original, aIds);
    project(original, bIds);
    const changed = {
      ...a,
      quantity: 3,
      remarks: "更新後",
      url: "https://example.test/current",
    };
    const next = project([changed, b], aIds);
    expect(next).not.toBe(old);
    expect(next[0]).toBe(changed);
    expect(next[0].url).toBe("https://example.test/current");
    expect(old[0]).toBe(a);
    expect(Object.prototype.hasOwnProperty.call(old[0], "url")).toBe(true);
    expect(old[0].url).toBeUndefined();
  });

  it("retains selected order when source order changes and drops only missing IDs", () => {
    const project = createFocusVisitDisplayItemsProjector();
    const a = item("a"),
      b = item("b"),
      ids = ["b", "missing", "a"];
    expect(project([a, b], ids)).toEqual([b, a]);
    expect(project([b, a], ids)).toEqual([b, a]);
    expect(project([a], ids)).toEqual([a]);
  });
});
