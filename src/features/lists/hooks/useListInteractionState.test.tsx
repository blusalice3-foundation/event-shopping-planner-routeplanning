// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildRangePresentation } from "../domain/rangeSelection";
import { useListInteractionState } from "./useListInteractionState";

describe("useListInteractionState range anchors", () => {
  it("consumes only transferred IDs and retains the Set when none are selected", () => {
    const { result } = renderHook(() => useListInteractionState());
    act(() => result.current.toggleRangeItemIdsSelection(["a", "b", "other"]));
    const before = result.current.selectedItemIds;
    act(() => result.current.removeSelectedItemIds(["unselected"]));
    expect(result.current.selectedItemIds).toBe(before);

    act(() => {
      result.current.toggleRangeItemIdsSelection(["later"]);
      result.current.removeSelectedItemIds(["a", "b", "expanded-peer"]);
    });
    expect([...result.current.selectedItemIds]).toEqual(["other", "later"]);
  });

  it("leaves range endpoints to the explicit acceptance cleanup", () => {
    const presentation = buildRangePresentation({
      scopeKey: "event/day/candidate/flat",
      grouping: "flat",
      itemIds: ["a", "b", "c"],
    });
    const { result } = renderHook(() => useListInteractionState());
    act(() => result.current.selectItemForRange("a", presentation));
    act(() => result.current.selectItemForRange("c", presentation));
    const { rangeStart, rangeEnd } = result.current;
    act(() => result.current.removeSelectedItemIds(["a"]));
    expect(result.current.rangeStart).toBe(rangeStart);
    expect(result.current.rangeEnd).toBe(rangeEnd);
    act(() => result.current.clearRangeSelection());
    expect(result.current.rangeStart).toBeNull();
    expect(result.current.rangeEnd).toBeNull();
    expect([...result.current.selectedItemIds]).toEqual(["c"]);
  });
  it("uses the rendered flat order and toggles exactly the supplied range IDs", () => {
    const presentation = buildRangePresentation({
      scopeKey: "event/day/candidate/flat",
      grouping: "flat",
      itemIds: ["visible-c", "visible-a", "visible-b", "visible-d"],
    });
    const { result } = renderHook(() => useListInteractionState());

    act(() => {
      result.current.selectItemForRange("visible-c", presentation);
    });
    act(() => {
      result.current.selectItemForRange("visible-b", presentation);
    });

    expect(result.current.rangeStart).toEqual({
      kind: "item",
      itemId: "visible-c",
      scopeKey: presentation.scopeKey,
    });
    expect(result.current.rangeEnd).toEqual({
      kind: "item",
      itemId: "visible-b",
      scopeKey: presentation.scopeKey,
    });
    expect([...result.current.selectedItemIds]).toEqual([
      "visible-c",
      "visible-b",
    ]);

    act(() => {
      result.current.toggleRangeItemIdsSelection([
        "visible-c",
        "visible-a",
        "visible-b",
      ]);
    });
    expect([...result.current.selectedItemIds]).toEqual([
      "visible-c",
      "visible-b",
      "visible-a",
    ]);

    act(() => {
      result.current.toggleRangeItemIdsSelection([
        "visible-c",
        "visible-a",
        "visible-b",
      ]);
    });
    expect(result.current.selectedItemIds.size).toBe(0);
    expect(result.current.rangeStart).toBeNull();
    expect(result.current.rangeEnd).toBeNull();
  });

  it("does not reuse an endpoint after the presentation scope changes", () => {
    const firstPresentation = buildRangePresentation({
      scopeKey: "event/day/execute/filter-sold-out",
      grouping: "flat",
      itemIds: ["a", "b", "c"],
    });
    const secondPresentation = buildRangePresentation({
      scopeKey: "event/day/execute/filter-manual",
      grouping: "flat",
      itemIds: ["a", "b", "c", "d"],
    });
    const { result } = renderHook(() => useListInteractionState());

    act(() => {
      result.current.selectItemForRange("a", firstPresentation);
    });
    act(() => {
      result.current.selectItemForRange("c", secondPresentation);
    });

    expect(result.current.rangeStart).toEqual({
      kind: "item",
      itemId: "c",
      scopeKey: secondPresentation.scopeKey,
    });
    expect(result.current.rangeEnd).toBeNull();
  });

  it("starts over when an item click crosses displayed hall groups", () => {
    const presentation = buildRangePresentation({
      scopeKey: "event/day/execute/hall",
      grouping: "hall",
      groups: [
        { key: "east:none", itemIds: ["e1", "e2", "e3"] },
        { key: "west:none", itemIds: ["w1", "w2", "w3"] },
      ],
    });
    const { result } = renderHook(() => useListInteractionState());

    act(() => {
      result.current.selectItemForRange("e1", presentation);
    });
    act(() => {
      result.current.selectItemForRange("w3", presentation);
    });

    expect(result.current.rangeStart).toEqual({
      kind: "item",
      itemId: "w3",
      scopeKey: presentation.scopeKey,
    });
    expect(result.current.rangeEnd).toBeNull();
  });

  it("uses displayed space-group keys for collapsed header anchors", () => {
    const presentation = buildRangePresentation({
      scopeKey: "event/day/execute/space",
      grouping: "space",
      groups: [
        { key: "A-01:priority", itemIds: ["a1", "a2"] },
        { key: "A-01:highest", itemIds: ["b1"] },
        { key: "A-02:priority", itemIds: ["c1", "c2"] },
      ],
    });
    const { result } = renderHook(() => useListInteractionState());

    act(() => {
      result.current.selectSpaceGroupForRange(
        "A-01:priority",
        ["a1", "a2"],
        presentation,
      );
    });
    act(() => {
      result.current.selectSpaceGroupForRange(
        "A-01:highest",
        ["b1"],
        presentation,
      );
    });
    expect(result.current.rangeEnd).toBeNull();

    act(() => {
      result.current.selectSpaceGroupForRange(
        "A-02:priority",
        ["c1", "c2"],
        presentation,
      );
    });
    expect(result.current.rangeEnd).toEqual({
      kind: "group",
      groupKey: "A-02:priority",
      scopeKey: presentation.scopeKey,
    });
  });
});

describe("pending selection consumption ownership", () => {
  it.each(["item", "group", "range", "remove", "clear-all"] as const)(
    "protects later off/on selection through the %s entry point",
    (entry) => {
      const { result } = renderHook(() => useListInteractionState());
      const flat = buildRangePresentation({
        scopeKey: "event/day/candidate/flat",
        grouping: "flat",
        itemIds: ["a", "b", "later"],
      });
      const grouped = buildRangePresentation({
        scopeKey: "event/day/candidate/space",
        grouping: "space",
        groups: [{ key: "a-space", itemIds: ["a"] }],
      });
      act(() => result.current.toggleRangeItemIdsSelection(["a", "b"]));
      const owner = result.current.captureSelectionConsumption([
        "a",
        "b",
        "not-selected",
      ]);
      const touch = () => {
        if (entry === "item") result.current.selectItemForRange("a", flat);
        else if (entry === "group")
          result.current.selectSpaceGroupForRange("a-space", ["a"], grouped);
        else result.current.toggleRangeItemIdsSelection(["a"]);
      };
      if (entry === "clear-all") {
        act(() => result.current.clearSelection());
        act(() => result.current.toggleRangeItemIdsSelection(["a", "b"]));
      } else {
        act(() => {
          if (entry === "remove") result.current.removeSelectedItemIds(["a"]);
          else touch();
        });
        act(() => touch());
      }
      const { rangeStart, rangeEnd } = result.current;
      act(() => {
        owner.consume();
        owner.consume();
        owner.release();
      });
      expect([...result.current.selectedItemIds]).toEqual(
        entry === "clear-all" ? ["a", "b"] : ["a"],
      );
      expect(result.current.rangeStart).toBe(rangeStart);
      expect(result.current.rangeEnd).toBe(rangeEnd);
    },
  );

  it("keeps parallel owners independent and releases aborted work without changing selection", () => {
    const { result } = renderHook(() => useListInteractionState());
    act(() => result.current.toggleRangeItemIdsSelection(["a", "b", "c"]));
    const aborted = result.current.captureSelectionConsumption(["a", "b"]);
    const committed = result.current.captureSelectionConsumption(["b", "c"]);
    act(() => result.current.toggleRangeItemIdsSelection(["later"]));
    const beforeAbort = result.current.selectedItemIds;
    act(() => {
      aborted.release();
      aborted.release();
      aborted.consume();
    });
    expect(result.current.selectedItemIds).toBe(beforeAbort);
    act(() => committed.consume());
    expect([...result.current.selectedItemIds]).toEqual(["a", "later"]);
  });

  it("invalidates pending owners on unmount and leaves another hook's selection alone", () => {
    const first = renderHook(() => useListInteractionState());
    act(() => first.result.current.toggleRangeItemIdsSelection(["a"]));
    const owner = first.result.current.captureSelectionConsumption(["a"]);
    first.unmount();
    const next = renderHook(() => useListInteractionState());
    act(() => next.result.current.toggleRangeItemIdsSelection(["a"]));
    const selected = next.result.current.selectedItemIds;
    act(() => {
      owner.consume();
      owner.release();
      owner.consume();
    });
    expect(next.result.current.selectedItemIds).toBe(selected);
    expect([...selected]).toEqual(["a"]);
  });
});
