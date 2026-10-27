// @vitest-environment jsdom

import type { ComponentProps } from "react";
import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../types/item";
import { acquireBodyScrollLock } from "../utils/bodyScrollLock";
import { getSpaceKey } from "../utils/spaceGrouping";
import ShoppingItemCard from "./ShoppingItemCard";
import ShoppingList from "./ShoppingList";

const items: ShoppingItem[] = ["first", "last"].map((id, index) => ({
  id,
  circle: `確認サークル${index + 1}`,
  title: `確認品目${index + 1}`,
  eventDate: "1日目",
  block: "A",
  number: String(index + 1),
  price: 500,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "",
}));

type ListProps = ComponentProps<typeof ShoppingList>;
const makeProps = (): ListProps => ({
  items,
  onUpdateItem: vi.fn(),
  onMoveItem: vi.fn(),
  onMoveItemUp: vi.fn(),
  onMoveItemDown: vi.fn(),
  onEditRequest: vi.fn(),
  onDeleteRequest: vi.fn(),
  selectedItemIds: new Set(),
  onSelectItem: vi.fn(),
  columnType: "execute",
  currentDay: "1日目",
  rangeScopeId: "確認イベント",
  layoutMode: "pc",
  viewMode: "edit",
  skipLimitedPurchaseForSingleQuantity: true,
  forceFullListRenderer: true,
});
const row = (container: HTMLElement, id: string) => {
  const element = container.querySelector<HTMLElement>(
    `[data-item-id="${id}"]`,
  );
  expect(element).not.toBeNull();
  return element!;
};
const transfer = () => {
  const values = new Map<string, string>();
  return {
    setData: (key: string, value: string) => values.set(key, value),
    getData: (key: string) => values.get(key) ?? "",
  };
};
const touch = { identifier: 1, clientX: 80, clientY: 160 };
const nonEditModes = ["execute", "focus"] as const;
const layouts = ["pc", "smartphone"] as const;
const groupings = ["flat", "hall", "space", "collapsed-space"] as const;
const presentations = nonEditModes.flatMap((viewMode) =>
  layouts.flatMap((layoutMode) =>
    groupings.map((grouping) => ({ viewMode, layoutMode, grouping })),
  ),
);

const expectNoMove = (props: ListProps) => {
  expect(props.onMoveItem).not.toHaveBeenCalled();
  expect(props.onMoveItemUp).not.toHaveBeenCalled();
  expect(props.onMoveItemDown).not.toHaveBeenCalled();
};
const expectNoDragResources = (container: HTMLElement) => {
  expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
  expect(container.querySelector(".opacity-40")).toBeNull();
  expect(container.querySelector("[data-shopping-drag-guide]")).toBeNull();
};

describe("shopping reorder mode boundary", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(
    layouts.flatMap((layoutMode) =>
      nonEditModes.map((viewMode) => ({ layoutMode, viewMode })),
    ),
  )(
    "hides card movement controls in $layoutMode/$viewMode even with callbacks",
    ({ layoutMode, viewMode }) => {
      const props = makeProps();
      const view = render(
        <ShoppingItemCard
          item={items[0]}
          onUpdate={props.onUpdateItem}
          onEditRequest={props.onEditRequest}
          onDeleteRequest={props.onDeleteRequest}
          onSelectItem={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
          isSelected={false}
          isStriped={false}
          layoutMode={layoutMode}
          viewMode={viewMode}
          skipLimitedPurchaseForSingleQuantity
        />,
      );
      expect(screen.queryByRole("button", { name: "上に移動" })).toBeNull();
      expect(screen.queryByRole("button", { name: "下に移動" })).toBeNull();
      expect(view.container.querySelector("[data-drag-handle]")).toBeNull();
    },
  );

  it.each(presentations)(
    "rejects native/touch movement in $layoutMode/$viewMode/$grouping",
    ({ layoutMode, viewMode, grouping }) => {
      vi.useFakeTimers();
      const props = {
        ...makeProps(),
        layoutMode,
        viewMode,
        showHallGroups: grouping === "hall",
        showSpaceGroups: grouping === "space" || grouping === "collapsed-space",
        collapsedSpaces:
          grouping === "collapsed-space"
            ? new Set(items.map((item) => getSpaceKey(item.block, item.number)))
            : new Set<string>(),
      };
      const before = structuredClone(items);
      const view = render(<ShoppingList {...props} />);
      const source = row(view.container, "first");
      const target = row(view.container, "last");
      expect(source).toHaveAttribute("draggable", "false");
      expect(view.container.querySelector('[draggable="true"]')).toBeNull();
      expect(
        view.container.querySelector("[data-shopping-drag-column]"),
      ).toBeNull();
      expect(
        screen.queryAllByRole("button", {
          name: /^(?:グループを)?[上下]に移動$/,
        }),
      ).toHaveLength(0);
      const dataTransfer = transfer();
      fireEvent.dragStart(source, { dataTransfer });
      fireEvent.dragOver(target, { dataTransfer, clientY: 10 });
      fireEvent.drop(target, { dataTransfer });
      fireEvent.dragEnd(source, { dataTransfer });
      fireEvent.touchStart(source, { touches: [touch] });
      act(() => vi.advanceTimersByTime(250));
      const move = createEvent.touchMove(source, {
        touches: [{ ...touch, clientY: 200 }],
        cancelable: true,
      });
      fireEvent(source, move);
      expect(move.defaultPrevented).toBe(false);
      fireEvent.touchEnd(source, { changedTouches: [touch] });
      expectNoMove(props);
      expectNoDragResources(view.container);
      expect(items).toEqual(before);
    },
  );

  it("keeps editing movement and selection available", () => {
    const props = makeProps();
    const view = render(<ShoppingList {...props} />);
    const source = row(view.container, "first");
    expect(source).toHaveAttribute("draggable", "true");
    fireEvent.click(screen.getAllByRole("button", { name: "下に移動" })[0]);
    expect(props.onMoveItemDown).toHaveBeenCalledWith("first", "execute");
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select item 確認サークル1 - 確認品目1",
      }),
    );
    expect(props.onSelectItem).toHaveBeenCalled();
  });

  it.each(nonEditModes)(
    "cancels an existing native drag on switching to %s",
    (viewMode) => {
      const props = makeProps();
      const view = render(<ShoppingList {...props} />);
      const dataTransfer = transfer();
      fireEvent.dragStart(row(view.container, "first"), { dataTransfer });
      fireEvent.dragOver(row(view.container, "last"), {
        dataTransfer,
        clientY: 10,
      });
      view.rerender(<ShoppingList {...props} viewMode={viewMode} />);
      fireEvent.drop(row(view.container, "last"), { dataTransfer });
      expect(row(view.container, "first")).toHaveAttribute(
        "draggable",
        "false",
      );
      expectNoMove(props);
      expectNoDragResources(view.container);
    },
  );

  it.each(
    nonEditModes.flatMap((viewMode) =>
      [false, true].map((active) => ({ viewMode, active })),
    ),
  )(
    "cleans a pending/active touch drag on $viewMode (active=$active)",
    ({ viewMode, active }) => {
      vi.useFakeTimers();
      const releaseOtherLock = acquireBodyScrollLock({ lockOverscroll: true });
      try {
        const props = { ...makeProps(), layoutMode: "smartphone" as const };
        const view = render(<ShoppingList {...props} />);
        fireEvent.touchStart(row(view.container, "first"), {
          touches: [touch],
        });
        if (active) {
          act(() => vi.advanceTimersByTime(250));
          expect(
            document.querySelector(".esp-shopping-touch-clone"),
          ).not.toBeNull();
        }
        view.rerender(<ShoppingList {...props} viewMode={viewMode} />);
        act(() => vi.advanceTimersByTime(250));
        fireEvent.touchEnd(row(view.container, "first"), {
          changedTouches: [touch],
        });
        expect(row(view.container, "first")).toHaveAttribute(
          "draggable",
          "false",
        );
        expectNoMove(props);
        expectNoDragResources(view.container);
        expect(document.body).toHaveClass(
          "esp-body-scroll-lock",
          "esp-body-overscroll-lock",
        );
        view.unmount();
      } finally {
        releaseOtherLock();
      }
      expect(document.body).not.toHaveClass(
        "esp-body-scroll-lock",
        "esp-body-overscroll-lock",
      );
    },
  );

  it("cancels an active touch drag when the event scope changes", () => {
    vi.useFakeTimers();
    const props = { ...makeProps(), layoutMode: "smartphone" as const };
    const view = render(<ShoppingList {...props} />);
    fireEvent.touchStart(row(view.container, "first"), { touches: [touch] });
    act(() => vi.advanceTimersByTime(250));
    expect(document.querySelector(".esp-shopping-touch-clone")).not.toBeNull();
    view.rerender(<ShoppingList {...props} rangeScopeId="別イベント" />);
    fireEvent.touchEnd(row(view.container, "first"), {
      changedTouches: [touch],
    });
    expectNoMove(props);
    expectNoDragResources(view.container);
    expect(row(view.container, "first")).toHaveAttribute("draggable", "true");
  });
});
