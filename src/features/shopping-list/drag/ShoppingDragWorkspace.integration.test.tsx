import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import ShoppingList from "../../../components/ShoppingList";
import type { ShoppingItem } from "../../../types/item";
import { computeMoveItem } from "../../events/itemOps";
import { ShoppingDragProvider } from "./ShoppingDragWorkspace";
import type { ShoppingDragMoveContext } from "./shoppingDrag";
const item = (
  id: string,
  number: string,
  overrides: Partial<ShoppingItem> = {},
): ShoppingItem => ({
  id,
  eventDate: "Day1",
  block: "A",
  number,
  circle: id,
  title: id,
  quantity: 1,
  price: null,
  purchaseStatus: "None",
  remarks: "エラーが発生しました",
  ...overrides,
});
const a1 = item("a1", "01a"),
  a2 = item("a2", "01a2"),
  x1 = item("x1", "02a"),
  x2 = item("x2", "02a2");
function Harness({
  grouped = true,
  sort = null,
  generation = 0,
  onMove = vi.fn(),
  selectedIds = new Set<string>(),
  collapsedCandidate = false,
}: {
  grouped?: boolean;
  sort?: "asc" | "desc" | null;
  generation?: number;
  onMove?: (...args: unknown[]) => void;
  selectedIds?: Set<string>;
  collapsedCandidate?: boolean;
}) {
  const [execute, setExecute] = useState([a1, a2]);
  const [candidate, setCandidate] = useState([x1, x2]);
  const move = (
    dragId: string,
    hoverId: string,
    targetColumn?: "execute" | "candidate",
    sourceColumn?: "execute" | "candidate",
    dragContext?: ShoppingDragMoveContext,
  ) => {
    onMove(dragId, hoverId, targetColumn, sourceColumn, dragContext);
    const result = computeMoveItem({
      dragId,
      hoverId,
      targetColumn,
      sourceColumn,
      mode: "edit",
      effectiveSelectedIds: new Set(dragContext?.requestedIds),
      allItems: [a1, a2, x1, x2],
      executeModeItems: { Day1: execute.map((value) => value.id) },
      dayName: "Day1",
      selectedBlockFilters: new Set(),
      dragContext,
    });
    if (result.executeModeItems) {
      const ids = result.executeModeItems.Day1;
      const values = result.eventListItems ?? [a1, a2, x1, x2];
      setExecute(ids.map((id) => values.find((value) => value.id === id)!));
      setCandidate(values.filter((value) => !ids.includes(value.id)));
    }
  };
  const common = {
    onUpdateItem: vi.fn(),
    onMoveItem: move,
    onEditRequest: vi.fn(),
    onDeleteRequest: vi.fn(),
    selectedItemIds: selectedIds,
    onSelectItem: vi.fn(),
    currentDay: "Day1",
    rangeScopeId: "Event",
    viewMode: "edit" as const,
    showSpaceGroups: grouped,
    skipLimitedPurchaseForSingleQuantity: true,
  };
  return (
    <ShoppingDragProvider eventName="Event" day="Day1" generation={generation}>
      <ShoppingList {...common} items={execute} columnType="execute" />
      <ShoppingList
        {...common}
        items={candidate}
        columnType="candidate"
        candidateNumberSortDirection={sort}
        collapsedSpaces={collapsedCandidate ? new Set(["A-02a"]) : undefined}
      />
    </ShoppingDragProvider>
  );
}
const rect = (top: number, bottom: number): DOMRect => ({
  top,
  bottom,
  height: bottom - top,
  left: 0,
  right: 100,
  width: 100,
  x: 0,
  y: top,
  toJSON: () => ({}),
});
function setup(grouped = true, sort: "asc" | "desc" | null = null) {
  const onMove = vi.fn();
  const view = render(
    <Harness grouped={grouped} sort={sort} onMove={onMove} />,
  );
  const root = (column: string) =>
    view.container.querySelector<HTMLElement>(
      `[data-shopping-drag-column="${column}"]`,
    )!;
  const row = (id: string) =>
    view.container.querySelector<HTMLElement>(
      `[data-item-id="${id}"]:not([data-space-group-key])`,
    )!;
  const group = () =>
    row("a1").closest<HTMLElement>('[data-row-key^="group:"]') ?? row("a1");
  vi.spyOn(group(), "getBoundingClientRect").mockReturnValue(rect(100, 300));
  const transfer = { setData: vi.fn(), getData: () => "candidate" };
  return { view, onMove, root, row, group, transfer };
}
function dragOver(element: HTMLElement, y: number, dataTransfer: unknown) {
  const event = new Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientY: { value: y },
    clientX: { value: 10 },
    dataTransfer: { value: dataTransfer },
  });
  fireEvent(element, event);
}
function dragLeave(element: HTMLElement, relatedTarget: Element | null) {
  const event = new Event("dragleave", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "relatedTarget", { value: relatedTarget });
  fireEvent(element, event);
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("workspace cross-column drag", () => {
  it.each([
    { y: 199, edge: "before", order: ["x1", "x2", "a1", "a2"] },
    { y: 200, edge: "after", order: ["a1", "a2", "x1", "x2"] },
    { y: 201, edge: "after", order: ["a1", "a2", "x1", "x2"] },
  ])(
    "uses the whole group's 50% boundary at $y",
    async ({ y, edge, order }) => {
      const s = setup();
      fireEvent.dragStart(s.row("x1"), { dataTransfer: s.transfer });
      dragOver(s.row("a1"), y, s.transfer);
      expect(
        s.root("execute").querySelector('[data-shopping-drag-guide="insert"]'),
      ).toHaveAttribute("data-shopping-drag-boundary", edge);
      fireEvent.drop(s.row("a1"), { dataTransfer: s.transfer });
      expect(s.onMove).toHaveBeenCalledTimes(1);
      expect(s.onMove.mock.calls[0][4].effectiveIds).toEqual(["x1", "x2"]);
      await waitFor(() =>
        expect(
          Array.from(
            s.root("execute").querySelectorAll<HTMLElement>("[data-item-id]"),
          )
            .filter((el) => !el.hasAttribute("data-space-group-key"))
            .map((el) => el.dataset.itemId),
        ).toEqual(order),
      );
      expect(
        s.view.container.querySelector("[data-shopping-drag-guide]"),
      ).toBeNull();
    },
  );
  it.each([null, "asc", "desc"] as const)(
    "returns to candidate without an insertion line for sort %s",
    (sort) => {
      const s = setup(true, sort);
      fireEvent.dragStart(s.row("a1"), { dataTransfer: s.transfer });
      fireEvent.dragOver(s.root("candidate"), {
        clientY: 400,
        clientX: 10,
        dataTransfer: s.transfer,
      });
      expect(
        s.root("candidate").querySelector("[data-shopping-drag-guide]"),
      ).toBeNull();
      expect(s.root("candidate").textContent).toContain(
        sort === null ? "ブロック・番号順" : "配列順",
      );
      fireEvent.drop(s.root("candidate"), { dataTransfer: s.transfer });
      expect(s.onMove.mock.calls[0].slice(0, 4)).toEqual([
        "a1",
        "__END_OF_LIST__",
        "candidate",
        "execute",
      ]);
    },
  );
  it.each(["native", "touch"] as const)(
    "passes the frozen source selection for same-column %s dragging",
    (input) => {
      const onMove = vi.fn();
      const view = render(
        <Harness
          grouped={false}
          selectedIds={new Set(["x1"])}
          onMove={onMove}
        />,
      );
      const row = (id: string) =>
        view.container.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!;
      const transfer = { setData: vi.fn(), getData: () => "candidate" };
      vi.stubGlobal("scrollBy", vi.fn());
      if (input === "native")
        fireEvent.dragStart(row("x1"), { dataTransfer: transfer });
      else {
        vi.useFakeTimers();
        fireEvent.touchStart(row("x1"), {
          touches: [{ clientX: 80, clientY: 160 }],
        });
        act(() => vi.advanceTimersByTime(250));
      }
      view.rerender(
        <Harness
          grouped={false}
          selectedIds={new Set(["x2"])}
          onMove={onMove}
        />,
      );
      if (input === "native") {
        dragOver(row("x2"), 201, transfer);
        fireEvent.drop(row("x2"), { dataTransfer: transfer });
      } else {
        Object.defineProperty(document, "elementFromPoint", {
          configurable: true,
          value: () => row("x2"),
        });
        fireEvent.touchMove(row("x1"), {
          touches: [{ clientX: 10, clientY: 201 }],
        });
        fireEvent.touchEnd(row("x1"));
      }
      expect(onMove).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls[0][4]?.requestedIds).toEqual(["x1"]);
      expect(onMove.mock.calls[0][4]?.effectiveIds).toEqual(["x1"]);
    },
  );
  it.each(["native", "touch"] as const)(
    "keeps the collapsed candidate header's existing first-member anchor: %s",
    (input) => {
      const onMove = vi.fn();
      const view = render(<Harness collapsedCandidate onMove={onMove} />);
      const source = view.container.querySelector<HTMLElement>(
        '[data-item-id="a1"]',
      )!;
      const header = view.container.querySelector<HTMLElement>(
        '[data-space-group-key="A-02a"]',
      )!;
      vi.spyOn(header, "getBoundingClientRect").mockReturnValue(rect(100, 300));
      const transfer = { setData: vi.fn(), getData: () => "execute" };
      if (input === "native") {
        fireEvent.dragStart(source, { dataTransfer: transfer });
        dragOver(header, 201, transfer);
        fireEvent.drop(header, { dataTransfer: transfer });
      } else {
        vi.useFakeTimers();
        vi.stubGlobal("scrollBy", vi.fn());
        fireEvent.touchStart(source, {
          touches: [{ clientX: 10, clientY: 160 }],
        });
        act(() => vi.advanceTimersByTime(250));
        Object.defineProperty(document, "elementFromPoint", {
          configurable: true,
          value: () => header,
        });
        fireEvent.touchMove(source, {
          touches: [{ clientX: 10, clientY: 201 }],
        });
        fireEvent.touchEnd(source);
      }
      expect(onMove).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls[0][1]).toBe("x1");
    },
  );
  it("keeps the candidate row's existing lower-half next-row insertion", () => {
    const s = setup(false);
    vi.spyOn(s.row("x1"), "getBoundingClientRect").mockReturnValue(
      rect(100, 300),
    );
    fireEvent.dragStart(s.row("a1"), { dataTransfer: s.transfer });
    dragOver(s.row("x1"), 201, s.transfer);
    expect(
      s.root("candidate").querySelector("[data-shopping-drag-guide]"),
    ).toBeNull();
    fireEvent.drop(s.root("candidate"), { dataTransfer: s.transfer });
    expect(s.onMove.mock.calls[0].slice(0, 4)).toEqual([
      "a1",
      "x2",
      "candidate",
      "execute",
    ]);
  });
  it("resolves the touch destination root and releases the clone and lock", () => {
    vi.useFakeTimers();
    const s = setup();
    const source = s.row("x1");
    fireEvent.touchStart(source, { touches: [{ clientX: 250, clientY: 160 }] });
    act(() => vi.advanceTimersByTime(250));
    vi.stubGlobal("scrollBy", vi.fn());
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => s.row("a1"),
    });
    fireEvent.touchMove(source, { touches: [{ clientX: 10, clientY: 201 }] });
    fireEvent.touchEnd(source, {
      changedTouches: [{ clientX: 10, clientY: 201 }],
    });
    expect(s.onMove.mock.calls[0].slice(0, 4)).toEqual([
      "x1",
      "__END_OF_LIST__",
      "execute",
      "candidate",
    ]);
    expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
    expect(document.body).not.toHaveClass("esp-body-scroll-lock");
  });
  it.each(["execute", "candidate"] as const)(
    "rejects touch release outside the viewport after hovering %s",
    (column) => {
      vi.useFakeTimers();
      const s = setup(false);
      const source = s.row("x1");
      fireEvent.touchStart(source, {
        touches: [{ clientX: 80, clientY: 160 }],
      });
      act(() => vi.advanceTimersByTime(250));
      vi.stubGlobal("scrollBy", vi.fn());
      const hitTest = vi.fn((): Element | null =>
        s.row(column === "execute" ? "a1" : "x2"),
      );
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: hitTest,
      });
      fireEvent.touchMove(source, { touches: [{ clientX: 10, clientY: 201 }] });
      hitTest.mockReturnValue(null);
      fireEvent.touchMove(source, {
        touches: [{ clientX: -20, clientY: 201 }],
      });
      expect(
        s.view.container.querySelector("[data-shopping-drag-guide]"),
      ).toBeNull();
      fireEvent.touchEnd(source);
      expect(s.onMove).not.toHaveBeenCalled();
      expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
      expect(document.body).not.toHaveClass("esp-body-scroll-lock");
    },
  );
  it.each([true, false])(
    "clears native guides outside the list while retaining the owner for re-entry (grouped %s)",
    (grouped) => {
      const s = setup(grouped);
      fireEvent.dragStart(s.row("x1"), { dataTransfer: s.transfer });
      dragOver(s.row("a1"), 100, s.transfer);
      expect(
        s.root("execute").querySelector("[data-shopping-drag-guide]"),
      ).not.toBeNull();
      dragLeave(s.row("a1"), s.row("a2"));
      expect(
        s.root("execute").querySelector("[data-shopping-drag-guide]"),
      ).not.toBeNull();
      dragLeave(s.root("execute"), s.view.container);
      expect(
        s.view.container.querySelector("[data-shopping-drag-guide]"),
      ).toBeNull();
      expect(
        s.view.container.querySelector("[data-shopping-drag-status]"),
      ).toBeNull();
      dragOver(s.row("a1"), 100, s.transfer);
      expect(
        s.root("execute").querySelector("[data-shopping-drag-guide]"),
      ).not.toBeNull();
      fireEvent.drop(s.root("execute"), { dataTransfer: s.transfer });
      expect(s.onMove).toHaveBeenCalledTimes(1);
    },
  );
  it.each([true, false])(
    "rejects a native drop after leaving the last accepted list (grouped %s)",
    (grouped) => {
      const s = setup(grouped);
      fireEvent.dragStart(s.row("x1"), { dataTransfer: s.transfer });
      dragOver(s.row("a1"), 100, s.transfer);
      dragLeave(s.root("execute"), null);
      fireEvent.drop(s.root("execute"), { dataTransfer: s.transfer });
      expect(s.onMove).not.toHaveBeenCalled();
      expect(
        s.view.container.querySelector("[data-shopping-drag-status]"),
      ).toBeNull();
    },
  );
  it("clears guide and frozen owner when its scope generation changes", () => {
    const s = setup();
    fireEvent.dragStart(s.row("x1"), { dataTransfer: s.transfer });
    fireEvent.dragOver(s.row("a1"), { clientY: 100, dataTransfer: s.transfer });
    const frozen = s.view.container.querySelector("[data-shopping-drag-guide]");
    expect(frozen).not.toBeNull();
    s.view.rerender(<Harness generation={1} onMove={s.onMove} />);
    fireEvent.drop(s.root("execute"), { dataTransfer: s.transfer });
    expect(s.onMove).not.toHaveBeenCalled();
    expect(
      s.view.container.querySelector("[data-shopping-drag-guide]"),
    ).toBeNull();
  });
});
