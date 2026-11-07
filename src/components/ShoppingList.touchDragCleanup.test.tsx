// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../types/item";
import { acquireBodyScrollLock } from "../utils/bodyScrollLock";
import ShoppingList from "./ShoppingList";

const item: ShoppingItem = {
  id: "touch-item",
  circle: "タッチ確認",
  eventDate: "Day1",
  block: "A",
  number: "01a",
  title: "長押し対象",
  price: 500,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "",
  priorityLevel: "none",
};

const elementFromPointDescriptor = Object.getOwnPropertyDescriptor(
  document,
  "elementFromPoint",
);

const touchPoint = (identifier: number, clientY = 160) => ({
  identifier,
  clientX: 80,
  clientY,
});

function setupTouchDrag(grouped: boolean) {
  vi.useFakeTimers();
  const onMoveItem = vi.fn();
  const view = render(
    <ShoppingList
      items={[item, { ...item, id: "touch-target", number: "02a" }]}
      onUpdateItem={vi.fn()}
      onMoveItem={onMoveItem}
      onEditRequest={vi.fn()}
      onDeleteRequest={vi.fn()}
      selectedItemIds={new Set()}
      onSelectItem={vi.fn()}
      columnType="candidate"
      currentDay="Day1"
      layoutMode="smartphone"
      viewMode="edit"
      showSpaceGroups={grouped}
      collapsedSpaces={grouped ? new Set(["A-01a", "A-02a"]) : undefined}
      skipLimitedPurchaseForSingleQuantity
    />,
  );
  const source = view.container.querySelector<HTMLElement>(
    '[data-item-id="touch-item"]',
  )!;
  const target = view.container.querySelector<HTMLElement>(
    '[data-item-id="touch-target"]',
  )!;
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  if (grouped) expect(source).toHaveAttribute("data-space-group-key");
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
    top: 180,
    bottom: 260,
    left: 0,
    right: 100,
    width: 100,
    height: 80,
    x: 0,
    y: 180,
    toJSON: () => ({}),
  });
  const elementFromPoint = vi.fn(() => target);
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: elementFromPoint,
  });
  const primary = touchPoint(11);
  fireEvent.touchStart(source, {
    touches: [primary],
    changedTouches: [primary],
  });
  return { ...view, source, target, primary, onMoveItem, elementFromPoint };
}

const presentations = [false, true];
describe("ShoppingList touch drag cleanup", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (elementFromPointDescriptor) {
      Object.defineProperty(
        document,
        "elementFromPoint",
        elementFromPointDescriptor,
      );
    } else {
      Reflect.deleteProperty(document, "elementFromPoint");
    }
    document.body.className = "";
    document.body.style.overflow = "";
    document.body.style.overscrollBehavior = "";
  });

  it("fully releases its drag resources without unlocking another body-scroll owner", () => {
    vi.useFakeTimers();
    document.body.style.overflow = "auto";
    const releaseNavigatorLock = acquireBodyScrollLock({
      lockOverscroll: true,
    });
    const view = render(
      <ShoppingList
        items={[item]}
        onUpdateItem={vi.fn()}
        onMoveItem={vi.fn()}
        onEditRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
        selectedItemIds={new Set()}
        onSelectItem={vi.fn()}
        columnType="candidate"
        currentDay="Day1"
        layoutMode="smartphone"
        viewMode="edit"
        skipLimitedPurchaseForSingleQuantity
      />,
    );
    const source = view.container.querySelector<HTMLElement>(
      '[data-item-id="touch-item"]',
    );
    expect(source).not.toBeNull();

    fireEvent.touchStart(source!, {
      touches: [{ identifier: 1, clientX: 80, clientY: 160 }],
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(source).toHaveClass("opacity-40");
    expect(source).toHaveAttribute("draggable", "false");
    expect(document.body).toHaveClass(
      "esp-body-scroll-lock",
      "esp-body-overscroll-lock",
    );
    const dragClone = document.body.querySelector(".esp-shopping-touch-clone");
    expect(dragClone).not.toBeNull();
    expect(dragClone).not.toHaveAttribute("style");

    view.unmount();

    expect(source).not.toHaveClass("opacity-40");
    expect(source).toHaveAttribute("draggable", "true");
    expect(document.body).toHaveClass(
      "esp-body-scroll-lock",
      "esp-body-overscroll-lock",
    );
    expect(document.body.querySelector(".esp-shopping-touch-clone")).toBeNull();

    releaseNavigatorLock();
    expect(document.body).not.toHaveClass(
      "esp-body-scroll-lock",
      "esp-body-overscroll-lock",
    );
    expect(document.body.style.overflow).toBe("auto");
    expect(document.body.style.overscrollBehavior).toBe("");
  });

  it.each(presentations)(
    "keeps the initiating finger through secondary ends, cancels, and reordered touches (grouped=%s)",
    (grouped) => {
      const fixture = setupTouchDrag(grouped);
      act(() => vi.advanceTimersByTime(250));
      const secondary = touchPoint(22, 500);
      fireEvent.touchStart(fixture.source, {
        touches: [secondary, fixture.primary],
        changedTouches: [secondary],
      });
      act(() => vi.advanceTimersByTime(250));
      expect(
        document.querySelectorAll(".esp-shopping-touch-clone"),
      ).toHaveLength(1);

      const movedPrimary = touchPoint(11, 200);
      fireEvent.touchMove(fixture.source, {
        touches: [secondary, movedPrimary],
        changedTouches: [movedPrimary],
      });
      expect(fixture.elementFromPoint).toHaveBeenLastCalledWith(80, 200);
      expect(
        document.querySelector(".esp-shopping-touch-clone"),
      ).toHaveAttribute("data-layout-top", "180px");

      for (const surface of [fixture.source, document]) {
        fireEvent.touchEnd(surface, {
          touches: [movedPrimary],
          changedTouches: [secondary],
        });
        fireEvent.touchCancel(surface, {
          touches: [movedPrimary],
          changedTouches: [secondary],
        });
        expect(fixture.onMoveItem).not.toHaveBeenCalled();
        expect(
          document.querySelector(".esp-shopping-touch-clone"),
        ).not.toBeNull();
        expect(document.body).toHaveClass("esp-body-scroll-lock");
      }

      fireEvent.touchEnd(fixture.source, {
        touches: [secondary],
        changedTouches: [movedPrimary],
      });
      expect(fixture.onMoveItem).toHaveBeenCalledOnce();
      expect(fixture.onMoveItem).toHaveBeenCalledWith(
        "touch-item",
        "touch-target",
        "candidate",
        "candidate",
        undefined,
      );
      expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
      expect(document.body).not.toHaveClass("esp-body-scroll-lock");
    },
  );

  it.each(
    presentations.flatMap((grouped) =>
      [false, true].map((active) => ({ grouped, active })),
    ),
  )(
    "cancels the initiating finger without dropping even when another finger remains (grouped=$grouped, active=$active)",
    ({ grouped, active }) => {
      const fixture = setupTouchDrag(grouped);
      act(() => vi.advanceTimersByTime(active ? 250 : 100));
      const secondary = touchPoint(22);
      fireEvent.touchMove(fixture.source, {
        touches: [fixture.primary, secondary],
        changedTouches: [fixture.primary],
      });
      fireEvent.touchCancel(fixture.source, {
        touches: [secondary],
        changedTouches: [fixture.primary],
      });
      act(() => vi.advanceTimersByTime(500));
      expect(fixture.onMoveItem).not.toHaveBeenCalled();
      expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
      expect(fixture.source).toHaveAttribute("draggable", "true");
      expect(document.body).not.toHaveClass("esp-body-scroll-lock");
    },
  );

  it.each(
    presentations.flatMap((grouped) =>
      ["end", "cancel"].flatMap((ending) =>
        ["source", "document"].map((surface) => ({ grouped, ending, surface })),
      ),
    ),
  )(
    "does not start an ended long press (grouped=$grouped, $ending on $surface)",
    ({ grouped, ending, surface }) => {
      const fixture = setupTouchDrag(grouped);
      act(() => vi.advanceTimersByTime(100));
      const target = surface === "source" ? fixture.source : document;
      const event = { touches: [], changedTouches: [fixture.primary] };
      if (ending === "end") fireEvent.touchEnd(target, event);
      else fireEvent.touchCancel(target, event);
      act(() => vi.advanceTimersByTime(500));
      expect(fixture.onMoveItem).not.toHaveBeenCalled();
      expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
      expect(document.body).not.toHaveClass("esp-body-scroll-lock");
    },
  );

  it.each(presentations)(
    "cancels a pending long press when a second finger arrives without leaving an old timer (grouped=%s)",
    (grouped) => {
      const fixture = setupTouchDrag(grouped);
      act(() => vi.advanceTimersByTime(100));
      const secondary = touchPoint(22);
      fireEvent.touchStart(fixture.source, {
        touches: [fixture.primary, secondary],
        changedTouches: [secondary],
      });
      act(() => vi.advanceTimersByTime(100));
      expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
      fireEvent.touchEnd(fixture.source, {
        touches: [fixture.primary],
        changedTouches: [secondary],
      });
      fireEvent.touchEnd(fixture.source, {
        touches: [],
        changedTouches: [fixture.primary],
      });
      act(() => vi.advanceTimersByTime(500));
      expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
      expect(document.body).not.toHaveClass("esp-body-scroll-lock");
      expect(fixture.onMoveItem).not.toHaveBeenCalled();

      const fresh = touchPoint(33);
      fireEvent.touchStart(fixture.source, {
        touches: [fresh],
        changedTouches: [fresh],
      });
      act(() => vi.advanceTimersByTime(200));
      expect(
        document.querySelectorAll(".esp-shopping-touch-clone"),
      ).toHaveLength(1);
      fireEvent.touchEnd(fixture.source, {
        touches: [],
        changedTouches: [fresh],
      });
      expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
    },
  );

  it.each(presentations)(
    "replaces a pending timer when the touch contact changes (grouped=%s)",
    (grouped) => {
      const fixture = setupTouchDrag(grouped);
      act(() => vi.advanceTimersByTime(100));
      const replacement = touchPoint(22);
      fireEvent.touchStart(fixture.source, {
        touches: [replacement],
        changedTouches: [replacement],
      });
      act(() => vi.advanceTimersByTime(100));
      expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
      fireEvent.touchCancel(document, {
        touches: [],
        changedTouches: [replacement],
      });
      act(() => vi.advanceTimersByTime(500));
      expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
      expect(document.body).not.toHaveClass("esp-body-scroll-lock");
    },
  );
});
