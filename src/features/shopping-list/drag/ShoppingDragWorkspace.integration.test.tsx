import { emptyApplicationSnapshot } from "../../../app/state/useApplicationSnapshot";
import {
  projectConsistencySnapshot,
  projectedMembership,
} from "../../consistency/domain/projection";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import ShoppingList from "../../../components/ShoppingList";
import type { ShoppingItem } from "../../../types/item";
import { computeMoveItem } from "../../events/itemOps";
import {
  ShoppingDragProvider,
  ShoppingDragColumnSurface,
} from "./ShoppingDragWorkspace";
import type { ShoppingDragMoveContext } from "./shoppingDrag";
const originalElementFromPoint = Object.getOwnPropertyDescriptor(
  document,
  "elementFromPoint",
);
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
  hallGrouped = false,
  retained = false,
  neutralExecuteSurface = false,
  omittedColumn,
  collapsedExecute,
  sort = null,
  generation = 0,
  onMove = vi.fn(),
  onEditRequest = vi.fn(),
  selectedIds = new Set<string>(),
  collapsedCandidate = false,
  initialCandidate = [x1, x2],
  initialExecute = [a1, a2],
}: {
  grouped?: boolean;
  hallGrouped?: boolean;
  retained?: boolean;
  neutralExecuteSurface?: boolean;
  omittedColumn?: "execute" | "candidate";
  collapsedExecute?: Set<string>;
  sort?: "asc" | "desc" | null;
  generation?: number;
  onMove?: (...args: unknown[]) => void;
  onEditRequest?: (item: ShoppingItem) => void;
  selectedIds?: Set<string>;
  collapsedCandidate?: boolean;
  initialCandidate?: ShoppingItem[];
  initialExecute?: ShoppingItem[];
}) {
  const [execute, setExecute] = useState(initialExecute);
  const [candidate, setCandidate] = useState(initialCandidate);
  const allItems = [...initialExecute, ...initialCandidate];
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
      allItems,
      executeModeItems: { Day1: execute.map((value) => value.id) },
      dayName: "Day1",
      selectedBlockFilters: new Set(),
      dragContext,
    });
    if (result.executeModeItems || result.eventListItems) {
      const ids =
        result.executeModeItems?.Day1 ?? execute.map((value) => value.id);
      const values = result.eventListItems ?? allItems;
      setExecute(ids.map((id) => values.find((value) => value.id === id)!));
      setCandidate(values.filter((value) => !ids.includes(value.id)));
    }
  };
  const common = {
    onUpdateItem: vi.fn(),
    onMoveItem: move,
    onEditRequest,
    onDeleteRequest: vi.fn(),
    selectedItemIds: selectedIds,
    onSelectItem: vi.fn(),
    currentDay: "Day1",
    rangeScopeId: "Event",
    viewMode: "edit" as const,
    showSpaceGroups: grouped,
    showHallGroups: hallGrouped,
    listRendererPreferencePort: retained
      ? {
          read: () => ({ status: "ok", value: "auto" }) as const,
          write: () => true,
        }
      : undefined,
    skipLimitedPurchaseForSingleQuantity: true,
  };
  const executeList = (
    <ShoppingList
      {...common}
      items={execute}
      dragExecuteOrder={execute.map((item) => item.id)}
      collapsedSpaces={collapsedExecute}
      dragSourceItems={allItems}
      columnType="execute"
    />
  );
  return (
    <ShoppingDragProvider eventName="Event" day="Day1" generation={generation}>
      {omittedColumn !== "execute" &&
        (neutralExecuteSurface ? (
          <ShoppingDragColumnSurface column="execute">
            <div data-testid="execute-neutral-surface">実行列の空き領域</div>
            {executeList}
          </ShoppingDragColumnSurface>
        ) : (
          executeList
        ))}
      {omittedColumn !== "candidate" && (
        <ShoppingList
          {...common}
          items={candidate}
          columnType="candidate"
          candidateNumberSortDirection={sort}
          collapsedSpaces={collapsedCandidate ? new Set(["A-02a"]) : undefined}
        />
      )}
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
  if (originalElementFromPoint)
    Object.defineProperty(
      document,
      "elementFromPoint",
      originalElementFromPoint,
    );
  else Reflect.deleteProperty(document, "elementFromPoint");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
  it.each([
    { input: "native", grouped: true, scale: 1 },
    { input: "native", grouped: false, scale: 1 },
    { input: "touch", grouped: true, scale: 0.75 },
    { input: "touch", grouped: false, scale: 1.25 },
  ] as const)(
    "keeps offscreen merge guidance visible while scrolling: $input, grouped $grouped",
    ({ input, grouped, scale }) => {
      const elementFromPoint = Object.getOwnPropertyDescriptor(
        document,
        "elementFromPoint",
      );
      const headerHeight = document.documentElement.dataset.appHeaderHeight;
      document.documentElement.dataset.appHeaderHeight = "120px";
      try {
        const onMove = vi.fn();
        const view = render(
          <Harness
            grouped={grouped}
            initialCandidate={[item("merge", "01a3")]}
            onMove={onMove}
          />,
        );
        const root = view.container.querySelector<HTMLElement>(
          '[data-shopping-drag-column="execute"]',
        )!;
        const source = view.container.querySelector<HTMLElement>(
          '[data-item-id="merge"]:not([data-space-group-key])',
        )!;
        const destination = view.container.querySelector<HTMLElement>(
          '[data-item-id="a2"]:not([data-space-group-key])',
        )!;
        const group = destination.closest<HTMLElement>(
          '[data-row-key^="group:"]',
        );
        vi.spyOn(destination, "getBoundingClientRect").mockReturnValue(
          rect(-1000, -900),
        );
        if (group)
          vi.spyOn(group, "getBoundingClientRect").mockReturnValue(
            rect(-1100, -900),
          );
        const rootRect = vi
          .spyOn(root, "getBoundingClientRect")
          .mockReturnValue(rect(-1200, 1800));
        Object.defineProperties(root, {
          offsetHeight: { configurable: true, value: 3000 / scale },
          offsetWidth: { configurable: true, value: 100 / scale },
        });
        vi.spyOn(
          HTMLElement.prototype,
          "offsetHeight",
          "get",
        ).mockImplementation(function (this: HTMLElement) {
          return this.hasAttribute("data-shopping-drag-status") ? 48 : 0;
        });
        const hitTest = vi.fn(() => root);
        Object.defineProperty(document, "elementFromPoint", {
          configurable: true,
          value: hitTest,
        });
        const transfer = { setData: vi.fn(), getData: () => "candidate" };
        if (input === "native") {
          fireEvent.dragStart(source, { dataTransfer: transfer });
          dragOver(root, 400, transfer);
        } else {
          vi.useFakeTimers();
          vi.stubGlobal("scrollBy", vi.fn());
          fireEvent.touchStart(source, {
            touches: [{ clientX: 80, clientY: 160 }],
          });
          act(() => vi.advanceTimersByTime(250));
          fireEvent.touchMove(source, {
            touches: [{ clientX: 10, clientY: 400 }],
          });
        }
        const status = root.querySelector<HTMLElement>(
          "[data-shopping-drag-status]",
        )!;
        expect(status).toHaveTextContent("既存の1訪問の末尾へ合流します。");
        expect(status).toHaveTextContent("画面外の合流先を含みます。");
        const expectVisible = () => {
          expect(status).not.toHaveAttribute("style");
          const screenTop =
            root.getBoundingClientRect().top +
            Number.parseFloat(status.dataset.layoutTop!) * scale;
          expect(screenTop).toBeGreaterThanOrEqual(128);
          expect(screenTop + 48 * scale).toBeLessThanOrEqual(
            window.innerHeight - 8,
          );
          expect(
            Number.parseFloat(status.dataset.layoutMaxWidth!) * scale,
          ).toBeLessThanOrEqual(100);
        };
        expectVisible();
        rootRect.mockReturnValue(rect(-1600, 1400));
        fireEvent.scroll(window);
        expect(root.querySelector("[data-shopping-drag-status]")).toBe(status);
        expectVisible();
        vi.stubGlobal("innerHeight", 200);
        fireEvent.resize(window);
        expectVisible();
        expect(onMove).not.toHaveBeenCalled();
        if (input === "native") fireEvent.dragEnd(source);
        else fireEvent.touchCancel(source);
        expect(
          view.container.querySelector("[data-shopping-drag-status]"),
        ).toBeNull();
        expect(
          view.container.querySelector("[data-shopping-drag-guide]"),
        ).toBeNull();
      } finally {
        if (elementFromPoint)
          Object.defineProperty(document, "elementFromPoint", elementFromPoint);
        else Reflect.deleteProperty(document, "elementFromPoint");
        if (headerHeight === undefined)
          delete document.documentElement.dataset.appHeaderHeight;
        else document.documentElement.dataset.appHeaderHeight = headerHeight;
      }
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

describe("execution placement movement units", () => {
  it("reorders one book within its own space without expanding its peers", async () => {
    const onMove = vi.fn();
    const view = render(
      <Harness grouped={false} onMove={onMove} initialCandidate={[]} />,
    );
    const row = (id: string) =>
      view.container.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!;
    vi.spyOn(row("a2"), "getBoundingClientRect").mockReturnValue(
      rect(100, 200),
    );
    const transfer = { setData: vi.fn(), getData: () => "execute" };
    fireEvent.dragStart(row("a1"), { dataTransfer: transfer });
    dragOver(row("a2"), 175, transfer);
    fireEvent.drop(row("a2"), { dataTransfer: transfer });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][4].effectiveIds).toEqual(["a1"]);
    expect(onMove.mock.calls[0][4].placement.kind).toBe("items");
    await waitFor(() =>
      expect(
        [
          ...view.container.querySelectorAll(
            '[data-shopping-drag-column="execute"] [data-item-id]',
          ),
        ].map((el) => el.getAttribute("data-item-id")),
      ).toEqual(["a2", "a1"]),
    );
  });
  it("moves the whole source space when one book is dropped after another space", async () => {
    const onMove = vi.fn();
    const view = render(
      <Harness
        grouped={false}
        onMove={onMove}
        initialExecute={[a1, a2, x1]}
        initialCandidate={[]}
      />,
    );
    const row = (id: string) =>
      view.container.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!;
    vi.spyOn(row("x1"), "getBoundingClientRect").mockReturnValue(
      rect(100, 200),
    );
    const transfer = { setData: vi.fn(), getData: () => "execute" };
    fireEvent.dragStart(row("a1"), { dataTransfer: transfer });
    dragOver(row("x1"), 175, transfer);
    fireEvent.drop(row("x1"), { dataTransfer: transfer });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][4].effectiveIds).toEqual(["a1", "a2"]);
    await waitFor(() =>
      expect(
        [
          ...view.container.querySelectorAll(
            '[data-shopping-drag-column="execute"] [data-item-id]',
          ),
        ].map((el) => el.getAttribute("data-item-id")),
      ).toEqual(["x1", "a1", "a2"]),
    );
  });
  it("refuses a mixed-priority candidate heading and retains the selected items", () => {
    const onMove = vi.fn();
    const selectedIds = new Set(["x1", "x2"]);
    const view = render(
      <Harness
        grouped
        onMove={onMove}
        selectedIds={selectedIds}
        collapsedCandidate
        initialCandidate={[{ ...x1, priorityLevel: "highest" }, x2]}
      />,
    );
    const heading = view.container.querySelector<HTMLElement>(
      '[data-space-group-key="A-02a"]',
    )!;
    const destination = view.container.querySelector<HTMLElement>(
      '[data-item-id="a1"]',
    )!;
    const transfer = { setData: vi.fn(), getData: () => "candidate" };
    fireEvent.dragStart(heading, { dataTransfer: transfer });
    dragOver(destination, 200, transfer);
    fireEvent.drop(destination, { dataTransfer: transfer });
    expect(onMove).not.toHaveBeenCalled();
    expect(
      document.querySelector("[data-shopping-placement-rejection]")
        ?.textContent,
    ).toContain("異なるホール・優先度");
    expect([...selectedIds]).toEqual(["x1", "x2"]);
  });
});

describe("placement guidance and release validation", () => {
  it.each(["native", "touch"] as const)(
    "keeps a candidate partial same-space reorder limited to the requested book: %s",
    async (input) => {
      const previousHitTest = Object.getOwnPropertyDescriptor(
        document,
        "elementFromPoint",
      );
      try {
        const s = setup(false);
        const source = s.row("x1");
        const destination = s.row("x2");
        vi.spyOn(destination, "getBoundingClientRect").mockReturnValue(
          rect(100, 200),
        );
        Object.defineProperty(document, "elementFromPoint", {
          configurable: true,
          value: () => destination,
        });
        if (input === "native") {
          fireEvent.dragStart(source, { dataTransfer: s.transfer });
          dragOver(destination, 175, s.transfer);
          fireEvent.drop(destination, { dataTransfer: s.transfer });
        } else {
          vi.useFakeTimers();
          vi.stubGlobal("scrollBy", vi.fn());
          fireEvent.touchStart(source, {
            touches: [{ clientX: 10, clientY: 150 }],
          });
          act(() => vi.advanceTimersByTime(250));
          fireEvent.touchMove(source, {
            touches: [{ clientX: 10, clientY: 175 }],
          });
          fireEvent.touchEnd(source, {
            changedTouches: [{ clientX: 10, clientY: 175 }],
          });
          vi.useRealTimers();
        }
        expect(s.onMove).toHaveBeenCalledTimes(1);
        const context = s.onMove.mock.calls[0][4] as ShoppingDragMoveContext;
        expect(context.effectiveIds).toEqual(["x1"]);
        expect(context.sourceVisits.flatMap((visit) => visit.ids)).toEqual([
          "x1",
        ]);
        await waitFor(() =>
          expect(
            [
              ...s
                .root("candidate")
                .querySelectorAll<HTMLElement>("[data-item-id]"),
            ].map((element) => element.dataset.itemId),
          ).toEqual(["x2", "x1"]),
        );
      } finally {
        if (previousHitTest)
          Object.defineProperty(document, "elementFromPoint", previousHitTest);
        else Reflect.deleteProperty(document, "elementFromPoint");
      }
    },
  );

  it("rejects a drop when its final hit-test leaves the surface after an accepted hover", () => {
    const previousHitTest = Object.getOwnPropertyDescriptor(
      document,
      "elementFromPoint",
    );
    try {
      const s = setup(false);
      const hitTest = vi.fn((): Element | null => s.row("a1"));
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: hitTest,
      });
      fireEvent.dragStart(s.row("x1"), { dataTransfer: s.transfer });
      dragOver(s.row("a1"), 100, s.transfer);
      expect(
        s.root("execute").querySelector('[data-shopping-drag-guide="insert"]'),
      ).not.toBeNull();
      hitTest.mockReturnValue(null);
      fireEvent.drop(s.row("a1"), { dataTransfer: s.transfer });
      expect(s.onMove).not.toHaveBeenCalled();
      expect(
        s.view.container.querySelector("[data-shopping-drag-guide]"),
      ).toBeNull();
    } finally {
      if (previousHitTest)
        Object.defineProperty(document, "elementFromPoint", previousHitTest);
      else Reflect.deleteProperty(document, "elementFromPoint");
    }
  });

  it.each(["native", "touch"] as const)(
    "guides a wrong priority hover without moving until a valid boundary receives a new drop: %s",
    (input) => {
      const previousHitTest = Object.getOwnPropertyDescriptor(
        document,
        "elementFromPoint",
      );
      try {
        const onMove = vi.fn();
        const upper = item("upper", "03a", { priorityLevel: "highest" });
        const view = render(
          <Harness
            grouped={false}
            onMove={onMove}
            initialExecute={[upper, a1, a2]}
          />,
        );
        const row = (id: string) =>
          view.container.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!;
        const source = row("x1"),
          wrong = row("upper"),
          valid = row("a2");
        vi.spyOn(wrong, "getBoundingClientRect").mockReturnValue(
          rect(100, 200),
        );
        vi.spyOn(valid, "getBoundingClientRect").mockReturnValue(
          rect(300, 400),
        );
        const hitTest = vi.fn((): Element | null => wrong);
        Object.defineProperty(document, "elementFromPoint", {
          configurable: true,
          value: hitTest,
        });
        const transfer = { setData: vi.fn(), getData: () => "candidate" };
        const start = () => {
          if (input === "native")
            fireEvent.dragStart(source, { dataTransfer: transfer });
          else {
            fireEvent.touchStart(source, {
              touches: [{ clientX: 10, clientY: 250 }],
            });
            act(() => vi.advanceTimersByTime(250));
          }
        };
        const hover = (target: HTMLElement, y: number) => {
          hitTest.mockReturnValue(target);
          if (input === "native") dragOver(target, y, transfer);
          else
            fireEvent.touchMove(source, {
              touches: [{ clientX: 10, clientY: y }],
            });
        };
        const drop = (target: HTMLElement, y: number) => {
          if (input === "native")
            fireEvent.drop(target, { dataTransfer: transfer });
          else
            fireEvent.touchEnd(source, {
              changedTouches: [{ clientX: 10, clientY: y }],
            });
        };
        if (input === "touch") {
          vi.useFakeTimers();
          vi.stubGlobal("scrollBy", vi.fn());
        }
        start();
        hover(wrong, 125);
        expect(
          view.container.querySelector(
            '[data-shopping-drag-guide="suggestion"]',
          ),
        ).not.toBeNull();
        expect(onMove).not.toHaveBeenCalled();
        drop(wrong, 125);
        expect(onMove).not.toHaveBeenCalled();
        expect(
          view.container.querySelector("[data-shopping-drag-guide]"),
        ).toBeNull();
        expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
        expect(document.body).not.toHaveClass("esp-body-scroll-lock");
        start();
        hover(valid, 375);
        expect(onMove).not.toHaveBeenCalled();
        drop(valid, 375);
        expect(onMove).toHaveBeenCalledTimes(1);
      } finally {
        if (previousHitTest)
          Object.defineProperty(document, "elementFromPoint", previousHitTest);
        else Reflect.deleteProperty(document, "elementFromPoint");
      }
    },
  );
});

it.each(["native-card", "native-heading", "touch"] as const)(
  "opens existing membership editing before a pending source can move: %s",
  (input) => {
    const raw = {
      ...emptyApplicationSnapshot(),
      eventLists: { Event: [x1, x2] },
      hallDefinitions: {
        Event: {
          "__mapless__:Day1": [
            { id: "east", name: "東館", blockNames: ["A"], vertices: [] },
            { id: "west", name: "西館", blockNames: ["A"], vertices: [] },
          ],
        },
      },
    };
    const pending = projectConsistencySnapshot(raw, "Event", "Day1").eventLists
      .Event as ShoppingItem[];
    expect(projectedMembership(pending[0])?.status).toBe(
      "confirmation-required",
    );
    const onEditRequest = vi.fn(),
      onMove = vi.fn();
    const selectedIds = new Set(["x1"]);
    const view = render(
      <Harness
        onMove={onMove}
        onEditRequest={onEditRequest}
        selectedIds={selectedIds}
        initialExecute={[]}
        initialCandidate={pending}
        collapsedCandidate={input === "native-heading"}
      />,
    );
    const source = view.container.querySelector<HTMLElement>(
      input === "native-heading"
        ? '[data-space-group-key="A-02a"]'
        : '[data-item-id="x1"]:not([data-space-group-key])',
    )!;
    expect(source).not.toBeNull();
    if (input === "touch") {
      vi.useFakeTimers();
      vi.stubGlobal("scrollBy", vi.fn());
      fireEvent.touchStart(source, {
        touches: [{ clientX: 10, clientY: 150 }],
      });
      act(() => vi.advanceTimersByTime(250));
      fireEvent.touchEnd(source);
    } else {
      const transfer = { setData: vi.fn(), getData: () => "candidate" };
      fireEvent.dragStart(source, { dataTransfer: transfer });
      fireEvent.drop(
        view.container.querySelector('[data-shopping-drag-column="execute"]')!,
        { dataTransfer: transfer },
      );
    }
    expect(onEditRequest).toHaveBeenCalledExactlyOnceWith(pending[0]);
    expect(onMove).not.toHaveBeenCalled();
    expect([...selectedIds]).toEqual(["x1"]);
    expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
    expect(document.body).not.toHaveClass("esp-body-scroll-lock");
  },
);

describe("book preview retains an interleaved raw visit base", () => {
  it.each([false, true])(
    "moves a first member after a peer with grouping %s",
    async (grouped) => {
      const b1 = item("b1", "02a"),
        a3 = item("a3", "01a3");
      const onMove = vi.fn();
      const view = render(
        <Harness
          grouped={grouped}
          onMove={onMove}
          initialExecute={[a1, b1, a2, a3]}
          initialCandidate={[]}
        />,
      );
      const row = (id: string) =>
        view.container.querySelector<HTMLElement>(
          `[data-item-id="${id}"]:not([data-space-group-key])`,
        )!;
      vi.spyOn(row("a2"), "getBoundingClientRect").mockReturnValue(
        rect(100, 200),
      );
      const transfer = { setData: vi.fn(), getData: () => "execute" };
      fireEvent.dragStart(row("a1"), { dataTransfer: transfer });
      dragOver(row("a2"), 175, transfer);
      fireEvent.drop(row("a2"), { dataTransfer: transfer });
      expect(onMove).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls[0][4].placement.expectedItemIds).toEqual([
        "a2",
        "a1",
        "a3",
        "b1",
      ]);
      await waitFor(() =>
        expect(
          [
            ...view.container.querySelectorAll(
              '[data-shopping-drag-column="execute"] [data-item-id]:not([data-space-group-key])',
            ),
          ].map((el) => el.getAttribute("data-item-id")),
        ).toEqual(["a2", "a1", "a3", "b1"]),
      );
    },
  );
});

describe("guidance requires subsequent pointer movement", () => {
  for (const input of ["native", "touch"] as const) {
    it.each([false, true])(
      `keeps refresh under a stationary ${input} pointer provisional; explicit move=%s`,
      (explicitMove) => {
        const previousHitTest = Object.getOwnPropertyDescriptor(
          document,
          "elementFromPoint",
        );
        try {
          const onMove = vi.fn();
          const upper = item("upper", "03a", { priorityLevel: "highest" });
          const view = render(
            <Harness
              grouped={false}
              onMove={onMove}
              initialExecute={[upper, a1, a2]}
            />,
          );
          const row = (id: string) =>
            view.container.querySelector<HTMLElement>(
              `[data-item-id="${id}"]`,
            )!;
          const source = row("x1"),
            wrong = row("upper"),
            destination = row("a2");
          vi.spyOn(wrong, "getBoundingClientRect").mockReturnValue(
            rect(100, 200),
          );
          const firstRect = vi
            .spyOn(row("a1"), "getBoundingClientRect")
            .mockReturnValue(rect(300, 350));
          const destinationRect = vi
            .spyOn(destination, "getBoundingClientRect")
            .mockReturnValue(rect(350, 400));
          const hitTest = vi.fn((): Element | null => wrong);
          Object.defineProperty(document, "elementFromPoint", {
            configurable: true,
            value: hitTest,
          });
          const transfer = { setData: vi.fn(), getData: () => "candidate" };
          vi.stubGlobal("scrollBy", vi.fn());
          if (input === "native") {
            fireEvent.dragStart(source, { dataTransfer: transfer });
            dragOver(wrong, 125, transfer);
          } else {
            vi.useFakeTimers();
            fireEvent.touchStart(source, {
              touches: [{ identifier: 1, clientX: 80, clientY: 250 }],
            });
            act(() => vi.advanceTimersByTime(250));
            fireEvent.touchMove(source, {
              touches: [{ identifier: 1, clientX: 10, clientY: 125 }],
            });
          }
          expect(
            view.container.querySelector(
              '[data-shopping-drag-guide="suggestion"]',
            ),
          ).not.toBeNull();
          expect(onMove).not.toHaveBeenCalled();
          // A guided scroll brings the valid visit below the unchanged pointer.
          // Scroll/layout notifications are observations, not a new drag gesture.
          firstRect.mockReturnValue(rect(70, 100));
          destinationRect.mockReturnValue(rect(100, 150));
          hitTest.mockReturnValue(destination);
          fireEvent.scroll(window);
          expect(onMove).not.toHaveBeenCalled();
          const releaseY = explicitMove ? 129 : 125;
          if (explicitMove) {
            if (input === "native") dragOver(destination, releaseY, transfer);
            else
              fireEvent.touchMove(source, {
                touches: [{ identifier: 1, clientX: 10, clientY: releaseY }],
              });
          }
          if (input === "native")
            fireEvent.drop(destination, {
              dataTransfer: transfer,
              clientX: 10,
              clientY: releaseY,
            });
          else
            fireEvent.touchEnd(source, {
              changedTouches: [
                { identifier: 1, clientX: 10, clientY: releaseY },
              ],
            });
          expect(onMove).toHaveBeenCalledTimes(explicitMove ? 1 : 0);
          expect(
            view.container.querySelector("[data-shopping-drag-guide]"),
          ).toBeNull();
          expect(
            document.querySelector(".esp-shopping-touch-clone"),
          ).toBeNull();
          expect(document.body).not.toHaveClass("esp-body-scroll-lock");
        } finally {
          if (previousHitTest)
            Object.defineProperty(
              document,
              "elementFromPoint",
              previousHitTest,
            );
          else Reflect.deleteProperty(document, "elementFromPoint");
        }
      },
    );
  }
});

describe("existing space is a merge drop zone", () => {
  it.each([false, true])(
    "shows its tail for either edge of a matching space, grouping %s",
    async (grouped) => {
      const onMove = vi.fn();
      const incoming = item("incoming", "01a4");
      const view = render(
        <Harness
          grouped={grouped}
          onMove={onMove}
          initialCandidate={[incoming]}
        />,
      );
      const row = (id: string) =>
        view.container.querySelector<HTMLElement>(
          `[data-item-id="${id}"]:not([data-space-group-key])`,
        )!;
      const owner = grouped
        ? row("a1").closest<HTMLElement>('[data-row-key^="group:"]')!
        : row("a1");
      vi.spyOn(owner, "getBoundingClientRect").mockReturnValue(rect(100, 300));
      const transfer = { setData: vi.fn(), getData: () => "candidate" };
      fireEvent.dragStart(row("incoming"), { dataTransfer: transfer });
      dragOver(row("a1"), 110, transfer);
      expect(
        view.container.querySelector('[data-shopping-drag-guide="merge"]'),
      ).toHaveAttribute("data-shopping-drag-boundary", "after");
      fireEvent.drop(row("a1"), { dataTransfer: transfer });
      expect(onMove).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(
          [
            ...view.container.querySelectorAll(
              '[data-shopping-drag-column="execute"] [data-item-id]:not([data-space-group-key])',
            ),
          ].map((el) => el.getAttribute("data-item-id")),
        ).toEqual(["a1", "a2", "incoming"]),
      );
    },
  );
});

describe("pure merges use the confirmed placement group", () => {
  it.each([
    { grouped: false, y: 110 },
    { grouped: false, y: 290 },
    { grouped: true, y: 110 },
    { grouped: true, y: 290 },
  ])(
    "appends at the existing tail when hovering another same-group space $grouped/$y",
    async ({ grouped, y }) => {
      const other = item("other", "02a"),
        incoming = item("incoming", "01a4");
      const onMove = vi.fn();
      const view = render(
        <Harness
          grouped={grouped}
          onMove={onMove}
          initialExecute={[a1, a2, other]}
          initialCandidate={[incoming]}
        />,
      );
      const row = (id: string) =>
        view.container.querySelector<HTMLElement>(
          `[data-item-id="${id}"]:not([data-space-group-key])`,
        )!;
      const owner = grouped
        ? row("other").closest<HTMLElement>('[data-row-key^="group:"]')!
        : row("other");
      vi.spyOn(owner, "getBoundingClientRect").mockReturnValue(rect(100, 300));
      const transfer = { setData: vi.fn(), getData: () => "candidate" };
      fireEvent.dragStart(row("incoming"), { dataTransfer: transfer });
      dragOver(row("other"), y, transfer);
      const guide = view.container.querySelector<HTMLElement>(
        '[data-shopping-drag-guide="merge"]',
      )!;
      expect(guide).toHaveAttribute("data-shopping-drag-boundary", "after");
      expect(
        grouped
          ? guide.closest<HTMLElement>('[data-row-key^="group:"]')?.dataset
              .rowKey
          : guide.closest<HTMLElement>("[data-item-id]")?.dataset.itemId,
      ).toBe(grouped ? 'group:"A-01a"' : "a2");
      fireEvent.drop(row("other"), { dataTransfer: transfer });
      expect(onMove).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(
          [
            ...view.container.querySelectorAll(
              '[data-shopping-drag-column="execute"] [data-item-id]:not([data-space-group-key])',
            ),
          ].map((el) => el.getAttribute("data-item-id")),
        ).toEqual(["a1", "a2", "incoming", "other"]),
      );
    },
  );
  it("accepts the group tail immediately before the next priority group", async () => {
    const next = item("next", "02a", { priorityLevel: "none" });
    const first = { ...a1, priorityLevel: "priority" as const },
      peer = { ...a2, priorityLevel: "priority" as const };
    const incoming = item("incoming", "01a4", { priorityLevel: "priority" });
    const onMove = vi.fn();
    const view = render(
      <Harness
        grouped={false}
        onMove={onMove}
        initialExecute={[first, peer, next]}
        initialCandidate={[incoming]}
      />,
    );
    const row = (id: string) =>
      view.container.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!;
    vi.spyOn(row("next"), "getBoundingClientRect").mockReturnValue(
      rect(100, 300),
    );
    const transfer = { setData: vi.fn(), getData: () => "candidate" };
    fireEvent.dragStart(row("incoming"), { dataTransfer: transfer });
    dragOver(row("next"), 110, transfer);
    fireEvent.drop(row("next"), { dataTransfer: transfer });
    expect(onMove).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        [
          ...view.container.querySelectorAll(
            '[data-shopping-drag-column="execute"] [data-item-id]',
          ),
        ].map((el) => el.getAttribute("data-item-id")),
      ).toEqual(["a1", "a2", "incoming", "next"]),
    );
  });
});

describe("public drag row surfaces", () => {
  it.each([false, true])(
    "uses the real same-group gap rather than the global end, grouping %s",
    async (grouped) => {
      const first = { ...a1, priorityLevel: "priority" as const };
      const peer = { ...a2, priorityLevel: "priority" as const };
      const other = item("other", "02a", { priorityLevel: "priority" });
      const later = item("later", "03a", { priorityLevel: "priority" });
      const next = item("next", "04a", { priorityLevel: "none" });
      const incoming = item("incoming", "05a", { priorityLevel: "priority" });
      const onMove = vi.fn();
      const view = render(
        <Harness
          grouped={grouped}
          hallGrouped={!grouped}
          onMove={onMove}
          initialExecute={[first, peer, other, later, next]}
          initialCandidate={[incoming]}
        />,
      );
      const root = view.container.querySelector<HTMLElement>(
        '[data-shopping-drag-column="execute"]',
      )!;
      const row = (id: string) =>
        view.container.querySelector<HTMLElement>(
          `[data-item-id="${id}"]:not([data-space-group-key])`,
        )!;
      const group = row("a1").closest<HTMLElement>('[data-row-key^="group:"]')!;
      const positions = new Map([
        ['item:"a1"', rect(100, 140)],
        ['item:"a2"', rect(150, 190)],
        ['item:"other"', rect(240, 300)],
        ['item:"later"', rect(400, 460)],
        ['item:"next"', rect(600, 660)],
      ]);
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        const key = this.dataset.rowKey ?? this.dataset.viewportRowKey;
        if (key && positions.has(key)) return positions.get(key)!;
        if (key?.startsWith("group:")) {
          if (!grouped) return this === group ? rect(50, 500) : rect(550, 700);
          if (key.includes("01a")) return rect(50, 200);
          if (key.includes("02a")) return rect(220, 320);
          if (key.includes("03a")) return rect(380, 480);
          return rect(550, 700);
        }
        const id = this.dataset.itemId;
        return (
          (id && positions.get(`item:${JSON.stringify(id)}`)) || rect(0, 800)
        );
      });
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => (grouped ? root : group),
      });
      const transfer = { setData: vi.fn(), getData: () => "candidate" };
      fireEvent.dragStart(row("incoming"), { dataTransfer: transfer });
      dragOver(root, 350, transfer);
      expect(
        root.querySelector('[data-shopping-drag-status="accepted"]'),
      ).not.toBeNull();
      fireEvent.scroll(window);
      expect(
        root.querySelector('[data-shopping-drag-status="accepted"]'),
      ).not.toBeNull();
      fireEvent.drop(root, { dataTransfer: transfer });
      expect(onMove).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls[0][1]).toBe("later");
      await waitFor(() =>
        expect(
          [
            ...root.querySelectorAll<HTMLElement>(
              "[data-item-id]:not([data-space-group-key])",
            ),
          ].map((element) => element.dataset.itemId),
        ).toEqual(["a1", "a2", "other", "incoming", "later", "next"]),
      );
    },
  );

  it("keeps a global blank below the last public row at the actual group tail", () => {
    const first = { ...a1, priorityLevel: "priority" as const };
    const last = item("last", "02a", { priorityLevel: "none" });
    const incoming = item("incoming", "03a", { priorityLevel: "none" });
    const onMove = vi.fn();
    const view = render(
      <Harness
        grouped={false}
        initialExecute={[first, last]}
        initialCandidate={[incoming]}
        onMove={onMove}
      />,
    );
    const root = view.container.querySelector<HTMLElement>(
      '[data-shopping-drag-column="execute"]',
    )!;
    const row = (id: string) =>
      view.container.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const key = this.dataset.rowKey;
        if (key === 'item:"a1"' || this.dataset.itemId === "a1")
          return rect(100, 200);
        if (key === 'item:"last"' || this.dataset.itemId === "last")
          return rect(300, 400);
        return rect(0, 800);
      },
    );
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => root,
    });
    const transfer = { setData: vi.fn(), getData: () => "candidate" };
    fireEvent.dragStart(row("incoming"), { dataTransfer: transfer });
    dragOver(root, 500, transfer);
    fireEvent.drop(root, { dataTransfer: transfer });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][1]).toBe("__END_OF_LIST__");
    expect(
      [...root.querySelectorAll<HTMLElement>("[data-item-id]")].map(
        (element) => element.dataset.itemId,
      ),
    ).toEqual(["a1", "last", "incoming"]);
  });

  it("resolves retained public group placeholders and the collapsed legacy-key merge tail", () => {
    vi.stubGlobal("visualViewport", {
      scale: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const observers: {
      callback: IntersectionObserverCallback;
      targets: Set<Element>;
    }[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        targets = new Set<Element>();
        constructor(public callback: IntersectionObserverCallback) {
          observers.push(this);
        }
        observe(element: Element) {
          this.targets.add(element);
        }
        unobserve(element: Element) {
          this.targets.delete(element);
        }
        disconnect() {
          this.targets.clear();
        }
      },
    );
    let scrolled = false;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const key = this.dataset.viewportRowKey ?? this.dataset.rowKey;
        if (!scrolled) return key ? rect(5000, 5200) : rect(0, 800);
        if (key === 'group:"A-01a"') return rect(-1000, -800);
        const match = key?.match(/other-(\d+)/);
        if (match) {
          const top = 160 + Number(match[1]) * 300;
          return rect(top, top + 100);
        }
        const group = key?.match(/group:"A-(\d+)a"/);
        if (group) {
          const top = 100 + (Number(group[1]) - 2) * 300;
          return rect(top, top + 200);
        }
        return rect(0, 800);
      },
    );
    const execute = [
      a1,
      a2,
      ...Array.from({ length: 32 }, (_, index) =>
        item(`other-${index}`, `${index + 2}a`),
      ),
    ];
    const incoming = item("incoming", "01a4");
    const onMove = vi.fn();
    const view = render(
      <Harness
        retained
        grouped
        collapsedExecute={new Set(["A-01a"])}
        initialExecute={execute}
        initialCandidate={[incoming]}
        onMove={onMove}
      />,
    );
    const root = view.container.querySelector<HTMLElement>(
      '[data-shopping-drag-column="execute"]',
    )!;
    expect(root).toHaveAttribute(
      "data-list-renderer-strategy",
      "retained-viewport",
    );
    const target = root.querySelector<HTMLElement>(
      "[data-viewport-row-key='group:\"A-2a\"']",
    )!;
    const mergeTail = root.querySelector<HTMLElement>(
      "[data-viewport-row-key='group:\"A-01a\"']",
    )!;
    expect(target).not.toBeNull();
    expect(mergeTail).not.toBeNull();
    expect(root.querySelector('[data-item-id="other-0"]')).toBeNull();
    expect(root.querySelector('[data-item-id="a1"]')).toBeNull();
    scrolled = true;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => target.querySelector(".esp-viewport-placeholder-heading"),
    });
    const source = view.container.querySelector<HTMLElement>(
      '[data-item-id="incoming"]',
    )!;
    const transfer = { setData: vi.fn(), getData: () => "candidate" };
    root.dataset.shoppingDragGuideOwner = "external";
    source.dataset.shoppingDragGuideOwner = "source-owner";
    const rootClass = root.className;
    fireEvent.dragStart(source, { dataTransfer: transfer });
    dragOver(target, 150, transfer);
    expect(
      root.querySelector('[data-shopping-drag-status="accepted"]'),
    ).not.toBeNull();
    const guide = mergeTail.querySelector(
      '[data-shopping-drag-guide="merge"]',
    )!;
    expect(guide).not.toBeNull();
    expect(mergeTail).toHaveAttribute("data-shopping-drag-guide-owner", "true");
    expect(mergeTail).toHaveClass("esp-layout-height");
    act(() => {
      observers.forEach((observer) => {
        if (observer.targets.has(mergeTail))
          observer.callback(
            [
              {
                target: mergeTail,
                isIntersecting: true,
                time: performance.now(),
                boundingClientRect: mergeTail.getBoundingClientRect(),
                intersectionRatio: 1,
                intersectionRect: mergeTail.getBoundingClientRect(),
                rootBounds: null,
              },
            ],
            observer as unknown as IntersectionObserver,
          );
      });
    });
    expect(mergeTail).toHaveAttribute("data-viewport-active", "true");
    expect(mergeTail).not.toHaveClass("esp-layout-height");
    expect(guide.isConnected).toBe(true);
    expect(guide.parentElement).toBe(mergeTail);
    expect(mergeTail).toHaveAttribute("data-shopping-drag-guide-owner", "true");
    fireEvent.drop(target, { dataTransfer: transfer });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][4].placement.mergeTargetIds).toEqual(["a2"]);
    expect(mergeTail).not.toHaveAttribute("data-shopping-drag-guide-owner");
    expect(root).toHaveAttribute("data-shopping-drag-guide-owner", "external");
    expect(source).toHaveAttribute(
      "data-shopping-drag-guide-owner",
      "source-owner",
    );
    expect(root.className).toBe(rootClass);
  });
});

describe("neutral execution column surfaces", () => {
  it.each([
    { grouped: false, merge: false, location: "surface" },
    { grouped: true, merge: false, location: "surface" },
    { grouped: false, merge: true, location: "surface" },
    { grouped: true, merge: true, location: "surface" },
    { grouped: false, merge: false, location: "header" },
    { grouped: false, merge: false, location: "footer" },
  ])(
    "uses canonical placement on neutral $location, grouping $grouped, merge $merge",
    async ({ grouped, merge, location }) => {
      const first = { ...a1, priorityLevel: "priority" as const };
      const peer = { ...a2, priorityLevel: "priority" as const };
      const other = item("other", "02a", { priorityLevel: "priority" });
      const next = item("next", "03a", { priorityLevel: "none" });
      const incoming = item("incoming", merge ? "01a4" : "04a", {
        priorityLevel: "priority",
      });
      const onMove = vi.fn();
      const view = render(
        <Harness
          grouped={grouped}
          neutralExecuteSurface
          onMove={onMove}
          initialExecute={[first, peer, other, next]}
          initialCandidate={[incoming]}
        />,
      );
      const root = view.container.querySelector<HTMLElement>(
        '[data-shopping-drag-column="execute"]',
      )!;
      const blank = view.getByTestId("execute-neutral-surface");
      const row = (id: string) =>
        view.container.querySelector<HTMLElement>(
          `[data-item-id="${id}"]:not([data-space-group-key])`,
        )!;
      const positions = new Map([
        ['item:"a1"', rect(200, 240)],
        ['item:"a2"', rect(250, 290)],
        ['item:"other"', rect(400, 460)],
        ['item:"next"', rect(600, 660)],
      ]);
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        if (this === root) return rect(180, 800);
        const key = this.dataset.viewportRowKey ?? this.dataset.rowKey;
        if (key && positions.has(key)) return positions.get(key)!;
        if (key?.startsWith("group:")) {
          if (key.includes("01a")) return rect(190, 300);
          if (key.includes("02a")) return rect(380, 480);
          return rect(580, 680);
        }
        return (
          (this.dataset.itemId &&
            positions.get(`item:${JSON.stringify(this.dataset.itemId)}`)) ||
          rect(100, 170)
        );
      });
      const hit = location === "surface" ? blank : root;
      const y =
        location === "surface" ? 150 : location === "header" ? 185 : 750;
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => hit,
      });
      const transfer = { setData: vi.fn(), getData: () => "candidate" };
      fireEvent.dragStart(row("incoming"), { dataTransfer: transfer });
      dragOver(hit, y, transfer);
      expect(
        root.querySelector('[data-shopping-drag-status="accepted"]'),
      ).not.toBeNull();
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperties(drop, {
        clientX: { value: 10 },
        clientY: { value: y },
        dataTransfer: { value: transfer },
      });
      fireEvent(hit, drop);
      expect(onMove).toHaveBeenCalledTimes(1);
      expect(
        onMove.mock.calls[0][4].placement.hallTailInsertions,
      ).toBeDefined();
      await waitFor(() =>
        expect(
          [
            ...root.querySelectorAll<HTMLElement>(
              "[data-item-id]:not([data-space-group-key])",
            ),
          ].map((element) => element.dataset.itemId),
        ).toEqual(
          merge
            ? ["a1", "a2", "incoming", "other", "next"]
            : ["a1", "a2", "other", "incoming", "next"],
        ),
      );
    },
  );
});

describe("candidate container whitespace keeps its original endpoint", () => {
  it.each([
    { input: "native", grouped: false },
    { input: "native", grouped: true },
    { input: "touch", grouped: false },
    { input: "touch", grouped: true },
  ] as const)(
    "appends the requested book from a real in-root gutter: $input/$grouped",
    ({ input, grouped }) => {
      const onMove = vi.fn();
      const view = render(
        <Harness
          grouped={grouped}
          initialExecute={[]}
          initialCandidate={[
            item("one", "01a"),
            item("two", "02a"),
            item("three", "03a"),
          ]}
          onMove={onMove}
        />,
      );
      const root = view.container.querySelector<HTMLElement>(
        '[data-shopping-drag-column="candidate"]',
      )!;
      const source = root.querySelector<HTMLElement>(
        '[data-item-id="two"]:not([data-space-group-key])',
      )!;
      const rows = new Map([
        ['item:"one"', rect(100, 180)],
        ['item:"two"', rect(230, 310)],
        ['item:"three"', rect(350, 430)],
      ]);
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        if (this === root) return { ...rect(0, 500), right: 200, width: 200 };
        const key = this.dataset.viewportRowKey ?? this.dataset.rowKey;
        let bounds = key && rows.get(key);
        if (!bounds && this.dataset.itemId)
          bounds = rows.get(`item:${JSON.stringify(this.dataset.itemId)}`);
        if (!bounds && key?.startsWith("group:")) {
          bounds = key.includes("01a")
            ? rect(80, 200)
            : key.includes("02a")
              ? rect(210, 320)
              : rect(330, 450);
        }
        return {
          ...(bounds || rect(0, 500)),
          left: 10,
          right: 180,
          width: 170,
        };
      });
      // x=195 is inside the list, alongside its cards, and hits no card/header.
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => root,
      });
      const transfer = { setData: vi.fn(), getData: () => "candidate" };
      if (input === "native") {
        fireEvent.dragStart(source, { dataTransfer: transfer });
        const over = new Event("dragover", { bubbles: true, cancelable: true });
        Object.defineProperties(over, {
          clientX: { value: 195 },
          clientY: { value: 360 },
          dataTransfer: { value: transfer },
        });
        fireEvent(root, over);
        fireEvent.drop(root, { dataTransfer: transfer });
      } else {
        vi.useFakeTimers();
        vi.stubGlobal("scrollBy", vi.fn());
        fireEvent.touchStart(source, {
          touches: [{ identifier: 1, clientX: 80, clientY: 260 }],
        });
        act(() => vi.advanceTimersByTime(250));
        fireEvent.touchMove(source, {
          touches: [{ identifier: 1, clientX: 195, clientY: 360 }],
        });
        fireEvent.touchEnd(source, {
          changedTouches: [{ identifier: 1, clientX: 195, clientY: 360 }],
        });
      }
      expect(onMove).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls[0][1]).toBe("__END_OF_LIST__");
      expect(onMove.mock.calls[0][4].effectiveIds).toEqual(["two"]);
      expect(
        [
          ...root.querySelectorAll<HTMLElement>(
            "[data-item-id]:not([data-space-group-key])",
          ),
        ].map((element) => element.dataset.itemId),
      ).toEqual(["one", "three", "two"]);
    },
  );
});

it.each(["native", "touch"] as const)(
  "re-reveals an offscreen corrective target without repeating a visible guide: %s",
  async (input) => {
    const priorScroll = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    const reveal = vi.fn();
    const priorHeader = document.documentElement.dataset.appHeaderHeight;
    const priorFooter = document.documentElement.dataset.footerHeight;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: function (this: HTMLElement) {
        if (this.dataset.rowKey === 'item:"priority"') reveal();
      },
    });
    try {
      vi.useFakeTimers();
      vi.stubGlobal("scrollBy", vi.fn());
      const priority = item("priority", "03a", { priorityLevel: "priority" });
      const incoming = item("incoming", "05a", { priorityLevel: "priority" });
      const onMove = vi.fn();
      const view = render(
        <Harness
          grouped={false}
          onMove={onMove}
          initialExecute={[a1, a2, priority]}
          initialCandidate={[incoming]}
        />,
      );
      const row = (id: string) =>
        view.container.querySelector<HTMLElement>(
          `[data-item-id="${id}"]:not([data-space-group-key])`,
        )!;
      const root = view.container.querySelector<HTMLElement>(
        '[data-shopping-drag-column="execute"]',
      )!;
      const source = row("incoming"),
        correct = row("priority"),
        wrong = row("a2");
      const correctRect = vi
        .spyOn(correct, "getBoundingClientRect")
        .mockReturnValue(rect(300, 400));
      vi.spyOn(row("a1"), "getBoundingClientRect").mockReturnValue(
        rect(300, 360),
      );
      vi.spyOn(wrong, "getBoundingClientRect").mockReturnValue(rect(360, 420));
      const hitTest = vi.fn((): Element | null => correct);
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: hitTest,
      });
      const transfer = { setData: vi.fn(), getData: () => "candidate" };
      const hover = (target: HTMLElement, y: number) => {
        hitTest.mockReturnValue(target);
        if (input === "native") dragOver(target, y, transfer);
        else
          fireEvent.touchMove(source, {
            touches: [{ identifier: 1, clientX: 10, clientY: y }],
          });
      };
      const flushReveal = async () => {
        await act(async () => {
          vi.advanceTimersByTime(50);
        });
      };
      if (input === "native")
        fireEvent.dragStart(source, { dataTransfer: transfer });
      else {
        fireEvent.touchStart(source, {
          touches: [{ identifier: 1, clientX: 10, clientY: 250 }],
        });
        act(() => vi.advanceTimersByTime(250));
      }
      hover(correct, 390);
      expect(
        root.querySelector('[data-shopping-drag-status="accepted"]'),
      ).not.toBeNull();
      expect(reveal).not.toHaveBeenCalled();
      // A public/programmatic scroll changes the row beneath the stationary
      // pointer, establishing a corrective target during refresh.
      correctRect.mockReturnValue(rect(2000, 2100));
      hitTest.mockReturnValue(wrong);
      fireEvent.scroll(window);
      await flushReveal();
      expect(reveal).toHaveBeenCalledTimes(1);
      const suggestion = root.querySelector<HTMLElement>(
        '[data-shopping-drag-guide="suggestion"]',
      )!;
      let suggestionBounds = rect(2094, 2100);
      const suggestionRect = vi
        .spyOn(suggestion, "getBoundingClientRect")
        .mockImplementation(() => suggestionBounds);
      expect(
        root.querySelector('[data-shopping-drag-status="rejected"]'),
      ).not.toBeNull();
      fireEvent.scroll(window);
      hover(wrong, 390);
      await flushReveal();
      expect(reveal).toHaveBeenCalledTimes(1);
      expect(onMove).not.toHaveBeenCalled();
      expect(suggestionRect).not.toHaveBeenCalled();
      // A real input retries the still-offscreen target.
      hover(wrong, 394);
      await flushReveal();
      expect(reveal).toHaveBeenCalledTimes(2);
      expect(
        root.querySelector('[data-shopping-drag-status="rejected"]'),
      ).not.toBeNull();
      expect(
        root.querySelectorAll('[data-shopping-drag-guide="suggestion"]'),
      ).toHaveLength(1);
      correctRect.mockReturnValue(rect(300, 400));
      suggestionBounds = rect(394, 400);
      hover(wrong, 398);
      await flushReveal();
      hover(wrong, 402);
      await flushReveal();
      expect(reveal).toHaveBeenCalledTimes(2);
      expect(suggestionRect).toHaveBeenCalledTimes(3);
      // A line hidden under the header or footer needs a new reveal.
      document.documentElement.dataset.appHeaderHeight = "410";
      hover(wrong, 406);
      await flushReveal();
      expect(reveal).toHaveBeenCalledTimes(3);
      document.documentElement.dataset.appHeaderHeight = "0";
      document.documentElement.dataset.footerHeight = `${window.innerHeight - 390}`;
      hover(wrong, 410);
      await flushReveal();
      expect(reveal).toHaveBeenCalledTimes(4);
      document.documentElement.dataset.footerHeight = "0";
      correctRect.mockReturnValue(rect(2000, 2100));
      suggestionBounds = rect(2094, 2100);
      hover(wrong, 414);
      await flushReveal();
      expect(reveal).toHaveBeenCalledTimes(5);
      expect(suggestionRect).toHaveBeenCalledTimes(6);
      // A disconnected guide is unknown, even if its old bounds were visible.
      suggestionBounds = rect(394, 400);
      suggestion.remove();
      hover(wrong, 418);
      await flushReveal();
      expect(reveal).toHaveBeenCalledTimes(6);
      expect(suggestionRect).toHaveBeenCalledTimes(6);
      const replacement = root.querySelector<HTMLElement>(
        '[data-shopping-drag-guide="suggestion"]',
      )!;
      expect(replacement).not.toBe(suggestion);
      const replacementRect = vi
        .spyOn(replacement, "getBoundingClientRect")
        .mockReturnValue(rect(394, 400));
      hover(wrong, 422);
      await flushReveal();
      fireEvent.scroll(window);
      await flushReveal();
      expect(reveal).toHaveBeenCalledTimes(6);
      expect(replacementRect).toHaveBeenCalledTimes(1);
      expect(onMove).not.toHaveBeenCalled();
      if (input === "native")
        fireEvent.drop(wrong, {
          dataTransfer: transfer,
          clientX: 10,
          clientY: 422,
        });
      else
        fireEvent.touchEnd(source, {
          changedTouches: [{ identifier: 1, clientX: 10, clientY: 422 }],
        });
      expect(onMove).not.toHaveBeenCalled();
      expect(
        view.container.querySelector("[data-shopping-drag-guide]"),
      ).toBeNull();
      expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
      expect(document.body).not.toHaveClass("esp-body-scroll-lock");
    } finally {
      if (priorHeader === undefined)
        delete document.documentElement.dataset.appHeaderHeight;
      else document.documentElement.dataset.appHeaderHeight = priorHeader;
      if (priorFooter === undefined)
        delete document.documentElement.dataset.footerHeight;
      else document.documentElement.dataset.footerHeight = priorFooter;
      if (priorScroll)
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollIntoView",
          priorScroll,
        );
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  },
);

it.each(["native", "touch"] as const)(
  "ends retained corrective guidance before its pending scroll frame: %s",
  async (input) => {
    const previousScroll = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    const scrollTarget = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: function (this: HTMLElement) {
        if (this.dataset.rowKey === 'item:"priority"') scrollTarget();
      },
    });
    try {
      vi.useFakeTimers();
      vi.stubGlobal("scrollBy", vi.fn());
      vi.stubGlobal("visualViewport", {
        scale: 1,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        const key = this.dataset.viewportRowKey ?? this.dataset.rowKey;
        const id = this.dataset.itemId;
        if (key === 'item:"priority"' || id === "priority")
          return rect(5000, 5200);
        if (key === 'item:"a1"' || id === "a1") return rect(300, 360);
        if (key === 'item:"a2"' || id === "a2") return rect(360, 420);
        if (key === 'item:"incoming"' || id === "incoming")
          return rect(250, 300);
        return key ? rect(2000, 2200) : rect(0, 800);
      });
      const priority = item("priority", "03a", { priorityLevel: "priority" });
      const incoming = item("incoming", "05a", { priorityLevel: "priority" });
      const onMove = vi.fn();
      const view = render(
        <Harness
          retained
          grouped={false}
          onMove={onMove}
          initialExecute={[
            a1,
            a2,
            ...Array.from({ length: 32 }, (_, index) =>
              item(`normal-${index}`, `${index + 10}a`),
            ),
            priority,
          ]}
          initialCandidate={[incoming]}
        />,
      );
      const root = view.container.querySelector<HTMLElement>(
        '[data-shopping-drag-column="execute"]',
      )!;
      expect(root).toHaveAttribute(
        "data-list-renderer-strategy",
        "retained-viewport",
      );
      const target = root.querySelector<HTMLElement>(
        "[data-viewport-row-key='item:\"priority\"']",
      )!;
      expect(target).toHaveAttribute("data-viewport-active", "false");
      expect(root.querySelector('[data-item-id="priority"]')).toBeNull();
      const source = view.container.querySelector<HTMLElement>(
        '[data-item-id="incoming"]',
      )!;
      const wrong = root.querySelector<HTMLElement>('[data-item-id="a2"]')!;
      expect(source).not.toBeNull();
      expect(wrong).not.toBeNull();
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => wrong,
      });
      await act(async () => {
        vi.advanceTimersByTime(80);
      });
      const transfer = { setData: vi.fn(), getData: () => "candidate" };
      if (input === "native")
        fireEvent.dragStart(source, { dataTransfer: transfer });
      else {
        fireEvent.touchStart(source, {
          touches: [{ identifier: 1, clientX: 10, clientY: 250 }],
        });
        act(() => vi.advanceTimersByTime(250));
      }
      if (input === "native") dragOver(wrong, 390, transfer);
      else
        fireEvent.touchMove(source, {
          touches: [{ identifier: 1, clientX: 10, clientY: 390 }],
        });
      expect(
        root.querySelector('[data-shopping-drag-guide="suggestion"]'),
      ).not.toBeNull();
      expect(target).toHaveAttribute("data-viewport-active", "true");
      expect(scrollTarget).not.toHaveBeenCalled();
      if (input === "native")
        fireEvent.dragEnd(source, { dataTransfer: transfer });
      else
        fireEvent.touchCancel(source, {
          changedTouches: [{ identifier: 1, clientX: 10, clientY: 390 }],
        });
      expect(
        root.querySelector(
          "[data-shopping-drag-guide], [data-shopping-drag-status]",
        ),
      ).toBeNull();
      expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
      expect(document.body).not.toHaveClass("esp-body-scroll-lock");
      await act(async () => {
        vi.advanceTimersByTime(80);
      });
      expect(scrollTarget).not.toHaveBeenCalled();
      expect(target).toHaveAttribute("data-viewport-active", "false");
      expect(onMove).not.toHaveBeenCalled();
    } finally {
      if (previousScroll)
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollIntoView",
          previousScroll,
        );
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  },
);

it.each([
  { input: "native", finish: "end" },
  { input: "touch", finish: "cancel" },
  { input: "native", finish: "unregister-execute" },
  { input: "native", finish: "unregister-candidate" },
] as const)(
  "retains visited controls in both columns until the gesture ends: $input $finish",
  ({ input, finish }) => {
    vi.useFakeTimers();
    vi.stubGlobal("scrollBy", vi.fn());
    vi.stubGlobal("visualViewport", {
      scale: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const observers = new Set<{
      next: IntersectionObserverCallback;
      targets: Set<Element>;
    }>();
    const intersect: IntersectionObserverCallback = (entries) => {
      for (const observer of observers) {
        const own = entries.filter((entry) =>
          observer.targets.has(entry.target),
        );
        if (own.length)
          observer.next(own, observer as unknown as IntersectionObserver);
      }
    };
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        targets = new Set<Element>();
        constructor(public next: IntersectionObserverCallback) {
          observers.add(this);
        }
        observe(element: Element) {
          this.targets.add(element);
        }
        unobserve(element: Element) {
          this.targets.delete(element);
        }
        disconnect() {
          observers.delete(this);
        }
      },
    );
    const visible = new Set(["incoming", "candidate-near", "a1", "a2"]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const key = this.dataset.viewportRowKey ?? this.dataset.rowKey;
        const id = key?.startsWith("item:")
          ? (JSON.parse(key.slice(5)) as string)
          : this.dataset.itemId;
        if (id === "a1" && visible.has(id)) return rect(300, 360);
        if (id === "a2" && visible.has(id)) return rect(360, 420);
        return id || key
          ? visible.has(id ?? "")
            ? rect(250, 300)
            : rect(5000, 5200)
          : rect(0, 800);
      },
    );
    const onMove = vi.fn();
    const props = {
      retained: true,
      grouped: false,
      onMove,
      initialExecute: [
        a1,
        a2,
        ...Array.from({ length: 32 }, (_, index) =>
          item(`execute-${index}`, `${index + 10}a`),
        ),
      ],
      initialCandidate: [
        item("incoming", "01a3"),
        item("candidate-near", "03a"),
        ...Array.from({ length: 32 }, (_, index) =>
          item(`candidate-${index}`, `${index + 50}a`),
        ),
      ],
    };
    const view = render(<Harness {...props} />);
    const card = (id: string) =>
      view.container.querySelector<HTMLElement>(
        `[data-item-id="${id}"]:not([data-space-group-key])`,
      );
    const viewport = (id: string) =>
      view.container.querySelector<HTMLElement>(
        `[data-viewport-row-key=${JSON.stringify(`item:${JSON.stringify(id)}`)}]`,
      )!;
    const notify = (id: string, isIntersecting: boolean) => {
      if (isIntersecting) visible.add(id);
      else visible.delete(id);
      act(() =>
        intersect(
          [
            { target: viewport(id), isIntersecting },
          ] as unknown as IntersectionObserverEntry[],
          {} as IntersectionObserver,
        ),
      );
    };
    const source = card("incoming")!;
    const existingTarget = card("a2")!;
    const existingCandidate = card("candidate-near")!;
    const transfer = { setData: vi.fn(), getData: () => "candidate" };
    if (input === "native")
      fireEvent.dragStart(source, { dataTransfer: transfer });
    else {
      fireEvent.touchStart(source, {
        touches: [{ identifier: 1, clientX: 10, clientY: 250 }],
      });
      act(() => vi.advanceTimersByTime(250));
    }
    notify("a2", false);
    notify("candidate-near", false);
    expect(card("a2")).toBe(existingTarget);
    expect(card("candidate-near")).toBe(existingCandidate);
    notify("execute-0", true);
    notify("candidate-0", true);
    const visitedTarget = card("execute-0")!;
    const visitedCandidate = card("candidate-0")!;
    notify("execute-0", false);
    notify("candidate-0", false);
    notify("execute-0", true);
    notify("candidate-0", true);
    expect(card("execute-0")).toBe(visitedTarget);
    expect(card("candidate-0")).toBe(visitedCandidate);
    expect(viewport("execute-1")).toHaveAttribute(
      "data-viewport-active",
      "false",
    );
    expect(viewport("candidate-1")).toHaveAttribute(
      "data-viewport-active",
      "false",
    );
    expect(card("execute-1")).toBeNull();
    expect(card("candidate-1")).toBeNull();
    // A valid hover cancels corrective scrolling, but keeps the gesture's rows.
    notify("a2", true);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => existingTarget,
    });
    if (input === "native") dragOver(existingTarget, 390, transfer);
    else
      fireEvent.touchMove(source, {
        touches: [{ identifier: 1, clientX: 10, clientY: 390 }],
      });
    expect(
      view.container.querySelector('[data-shopping-drag-status="accepted"]'),
    ).not.toBeNull();
    notify("a2", false);
    notify("execute-0", false);
    notify("candidate-0", false);
    expect(card("a2")).toBe(existingTarget);
    expect(card("execute-0")).toBe(visitedTarget);
    expect(card("candidate-0")).toBe(visitedCandidate);
    if (finish === "unregister-execute") {
      view.rerender(<Harness {...props} omittedColumn="execute" />);
      // Removing the destination releases that root, while the source lease lives.
      expect(card("candidate-near")).toBe(existingCandidate);
      expect(card("candidate-0")).toBe(visitedCandidate);
      fireEvent.dragEnd(source, { dataTransfer: transfer });
    } else if (finish === "unregister-candidate")
      view.rerender(<Harness {...props} omittedColumn="candidate" />);
    else if (input === "native")
      fireEvent.dragEnd(source, { dataTransfer: transfer });
    else fireEvent.touchCancel(source);
    expect(card("a2")).toBeNull();
    expect(card("candidate-near")).toBeNull();
    expect(card("execute-0")).toBeNull();
    expect(card("candidate-0")).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
    expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
    expect(document.body).not.toHaveClass("esp-body-scroll-lock");
  },
);

it.each([
  { input: "native", grouped: false },
  { input: "native", grouped: true },
  { input: "touch", grouped: false },
  { input: "touch", grouped: true },
] as const)(
  "does not guide to the execution tail while hovering the moving source itself: $input grouped=$grouped",
  async ({ input, grouped }) => {
    vi.useFakeTimers();
    vi.stubGlobal("scrollBy", vi.fn());
    const previousScroll = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scroll,
    });
    try {
      const onMove = vi.fn();
      const view = render(
        <Harness
          grouped={grouped}
          onMove={onMove}
          initialExecute={[
            item("e0", "01a"),
            item("e1", "41a"),
            item("e249", "2249a"),
            item("priority", "9999a", { priorityLevel: "priority" }),
          ]}
          initialCandidate={[item("c0", "90a")]}
        />,
      );
      const card = (id: string) =>
        view.container.querySelector<HTMLElement>(
          `[data-item-id="${id}"]:not([data-space-group-key])`,
        )!;
      const source = card("e0"),
        target = card("c0"),
        wrong = card("priority");
      vi.spyOn(source, "getBoundingClientRect").mockReturnValue(rect(250, 350));
      vi.spyOn(target, "getBoundingClientRect").mockReturnValue(rect(250, 350));
      vi.spyOn(wrong, "getBoundingClientRect").mockReturnValue(rect(350, 450));
      const wrongGroup = wrong.closest<HTMLElement>('[data-row-key^="group:"]');
      if (wrongGroup)
        vi.spyOn(wrongGroup, "getBoundingClientRect").mockReturnValue(
          rect(350, 450),
        );
      const hitTest = vi.fn(() => source);
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: hitTest,
      });
      const transfer = { setData: vi.fn(), getData: () => "execute" };
      const begin = () => {
        hitTest.mockReturnValue(source);
        if (input === "native")
          fireEvent.dragStart(source, { dataTransfer: transfer });
        else {
          fireEvent.touchStart(source, {
            touches: [{ identifier: 1, clientX: 10, clientY: 280 }],
          });
          act(() => vi.advanceTimersByTime(250));
        }
      };
      const hover = (element: HTMLElement, y: number) => {
        hitTest.mockReturnValue(element);
        if (input === "native") dragOver(element, y, transfer);
        else
          fireEvent.touchMove(source, {
            touches: [{ identifier: 1, clientX: 10, clientY: y }],
          });
      };
      const drop = (element: HTMLElement, y: number) => {
        if (input === "native")
          fireEvent.drop(element, {
            dataTransfer: transfer,
            clientX: 10,
            clientY: y,
          });
        else
          fireEvent.touchEnd(source, {
            changedTouches: [{ identifier: 1, clientX: 10, clientY: y }],
          });
      };
      begin();
      hover(source, 300);
      await act(async () => vi.advanceTimersByTime(50));
      expect(scroll).not.toHaveBeenCalled();
      expect(
        view.container.querySelector("[data-shopping-drag-guide]"),
      ).toBeNull();
      expect(onMove).not.toHaveBeenCalled();
      // Returning to the source clears an earlier corrective guide.
      hover(wrong, 360);
      expect(
        view.container.querySelector('[data-shopping-drag-guide="suggestion"]'),
      ).not.toBeNull();
      scroll.mockClear();
      hover(source, 300);
      await act(async () => vi.advanceTimersByTime(50));
      expect(scroll).not.toHaveBeenCalled();
      expect(
        view.container.querySelector(
          "[data-shopping-drag-status], [data-shopping-drag-guide]",
        ),
      ).toBeNull();
      // A real destination still accepts, and returning to the source clears it.
      hover(target, 310);
      expect(
        view.container.querySelector('[data-shopping-drag-status="accepted"]'),
      ).not.toBeNull();
      hover(source, 300);
      expect(
        view.container.querySelector(
          "[data-shopping-drag-status], [data-shopping-drag-guide]",
        ),
      ).toBeNull();
      drop(source, 300);
      expect(onMove).not.toHaveBeenCalled();
      expect(
        document.querySelector("[data-shopping-placement-rejection]"),
      ).toBeNull();
      expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
      expect(document.body).not.toHaveClass("esp-body-scroll-lock");
      begin();
      hover(source, 300);
      hover(target, 310);
      drop(target, 310);
      expect(onMove).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls[0].slice(0, 4)).toEqual([
        "e0",
        "__END_OF_LIST__",
        "candidate",
        "execute",
      ]);
      expect(onMove.mock.calls[0][4].effectiveIds).toEqual(["e0"]);
      expect(scroll).not.toHaveBeenCalled();
      expect(
        document.querySelector("[data-shopping-placement-rejection]"),
      ).toBeNull();
      expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
      expect(document.body).not.toHaveClass("esp-body-scroll-lock");
    } finally {
      if (previousScroll)
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollIntoView",
          previousScroll,
        );
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  },
);

it.each(["native", "touch"] as const)(
  "accepts a nonmoving book in the same visit after a source no-op: %s",
  (input) => {
    vi.useFakeTimers();
    vi.stubGlobal("scrollBy", vi.fn());
    const onMove = vi.fn();
    const view = render(
      <Harness
        grouped={false}
        onMove={onMove}
        initialExecute={[a1, a2, x1]}
        initialCandidate={[]}
      />,
    );
    const card = (id: string) =>
      view.container.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!;
    const source = card("a1"),
      peer = card("a2");
    vi.spyOn(source, "getBoundingClientRect").mockReturnValue(rect(250, 350));
    vi.spyOn(peer, "getBoundingClientRect").mockReturnValue(rect(350, 450));
    const hitTest = vi.fn(() => source);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: hitTest,
    });
    const transfer = { setData: vi.fn(), getData: () => "execute" };
    if (input === "native") {
      fireEvent.dragStart(source, { dataTransfer: transfer });
      dragOver(source, 300, transfer);
      hitTest.mockReturnValue(peer);
      dragOver(peer, 420, transfer);
      fireEvent.drop(peer, { dataTransfer: transfer });
    } else {
      fireEvent.touchStart(source, {
        touches: [{ identifier: 1, clientX: 10, clientY: 280 }],
      });
      act(() => vi.advanceTimersByTime(250));
      fireEvent.touchMove(source, {
        touches: [{ identifier: 1, clientX: 10, clientY: 300 }],
      });
      hitTest.mockReturnValue(peer);
      fireEvent.touchMove(source, {
        touches: [{ identifier: 1, clientX: 10, clientY: 420 }],
      });
      fireEvent.touchEnd(source, {
        changedTouches: [{ identifier: 1, clientX: 10, clientY: 420 }],
      });
    }
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][4].effectiveIds).toEqual(["a1"]);
    expect(onMove.mock.calls[0][4].placement.kind).toBe("items");
    expect(
      [
        ...view.container.querySelectorAll(
          '[data-shopping-drag-column="execute"] [data-item-id]',
        ),
      ].map((node) => node.getAttribute("data-item-id")),
    ).toEqual(["a2", "a1", "x1"]);
    expect(
      document.querySelector("[data-shopping-placement-rejection]"),
    ).toBeNull();
  },
);
