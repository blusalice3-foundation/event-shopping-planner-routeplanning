// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ShoppingList from "../../../components/ShoppingList";
import type { ShoppingItem } from "../../../types/item";
import { ShoppingDragProvider } from "./ShoppingDragWorkspace";
import { acquireShoppingTouchDragDefaultGuard } from "./touchDragDefaultGuard";

type Point = Pick<Touch, "identifier" | "target" | "clientX" | "clientY">;
const point = (target: EventTarget, identifier = 7): Point => ({
  identifier,
  target,
  clientX: 80,
  clientY: 160,
});
function move(
  target: Element,
  touches: Point[],
  changedTouches = touches,
  cancelable = true,
  alreadyPrevented = false,
) {
  const event = new Event("touchmove", { bubbles: true, cancelable });
  Object.defineProperties(event, {
    touches: { value: touches },
    changedTouches: { value: changedTouches },
  });
  if (alreadyPrevented) event.preventDefault();
  target.dispatchEvent(event);
  return event;
}
const releases: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const release of releases.splice(0)) release();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
function sourceFixture() {
  const source = document.createElement("div");
  const child = document.createElement("span");
  source.appendChild(child);
  document.body.appendChild(source);
  return { source, child };
}
describe("active shopping touch default cancellation", () => {
  it("cancels only the original single touch, preserves propagation, and releases idempotently", () => {
    const { source, child } = sourceFixture();
    const bubble = vi.fn();
    document.addEventListener("touchmove", bubble);
    const release = acquireShoppingTouchDragDefaultGuard(source, 7);
    releases.push(release);
    expect(move(child, [point(child)]).defaultPrevented).toBe(true);
    expect(bubble).toHaveBeenCalledTimes(1);
    release();
    release();
    expect(move(child, [point(child)]).defaultPrevented).toBe(false);
    document.removeEventListener("touchmove", bubble);
  });
  it("leaves other targets, identifiers, multiple fingers, and noncancelable events alone", () => {
    const { source, child } = sourceFixture();
    const other = document.createElement("div");
    document.body.appendChild(other);
    releases.push(acquireShoppingTouchDragDefaultGuard(source, 7));
    expect(move(child, [point(child, 8)]).defaultPrevented).toBe(false);
    expect(move(child, [point(child), point(child, 8)]).defaultPrevented).toBe(
      false,
    );
    expect(
      move(child, [point(child)], [point(child), point(child, 8)])
        .defaultPrevented,
    ).toBe(false);
    expect(
      move(child, [point(child)], [point(child, 8)]).defaultPrevented,
    ).toBe(false);
    expect(move(other, [point(other)]).defaultPrevented).toBe(false);
    expect(move(child, [point(child)], [point(other)]).defaultPrevented).toBe(
      false,
    );
    expect(
      move(child, [point(child)], [point(child)], false).defaultPrevented,
    ).toBe(false);
    const already = move(child, [point(child)], [point(child)], true, true);
    expect(already.defaultPrevented).toBe(true);
    source.remove();
    expect(move(other, [point(other)]).defaultPrevented).toBe(false);
  });
  it("registers nothing for a disconnected source or missing identifier", () => {
    const added = vi.spyOn(document, "addEventListener");
    const disconnected = document.createElement("div");
    acquireShoppingTouchDragDefaultGuard(disconnected, 7)();
    const { source } = sourceFixture();
    acquireShoppingTouchDragDefaultGuard(source, Number.NaN)();
    expect(
      added.mock.calls.filter(([type]) => type === "touchmove"),
    ).toHaveLength(0);
  });
});

const item: ShoppingItem = {
  id: "guard-item",
  circle: "ユーザー登録",
  eventDate: "Day1",
  block: "A",
  number: "01a",
  title: "長押し対象",
  price: 500,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "エラーが発生しました",
  priorityLevel: "none",
};
function Harness({
  grouped = false,
  generation = 0,
}: {
  grouped?: boolean;
  generation?: number;
}) {
  return (
    <ShoppingDragProvider eventName="Event" day="Day1" generation={generation}>
      <ShoppingList
        items={[item, { ...item, id: "guard-second", number: "01a2" }]}
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
        showSpaceGroups={grouped}
        collapsedSpaces={grouped ? new Set(["A-01a"]) : undefined}
        skipLimitedPurchaseForSingleQuantity
      />
    </ShoppingDragProvider>
  );
}
const nativeAdds = (calls: Array<unknown[]>) =>
  calls.filter(
    ([type, , options]) =>
      type === "touchmove" &&
      typeof options === "object" &&
      options !== null &&
      (options as AddEventListenerOptions).capture === true &&
      (options as AddEventListenerOptions).passive === false,
  );
function begin(grouped = false) {
  vi.useFakeTimers();
  const added = vi.spyOn(document, "addEventListener");
  const removed = vi.spyOn(document, "removeEventListener");
  const view = render(<Harness grouped={grouped} />);
  const source = view.container.querySelector<HTMLElement>(
    grouped ? "[data-space-group-key]" : '[data-item-id="guard-item"]',
  )!;
  expect(source).not.toBeNull();
  const active = point(source, 13);
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => source,
  });
  fireEvent.touchStart(source, { touches: [active], changedTouches: [active] });
  act(() => vi.advanceTimersByTime(199));
  expect(nativeAdds(added.mock.calls)).toHaveLength(0);
  act(() => vi.advanceTimersByTime(1));
  expect(document.querySelector(".esp-shopping-touch-clone")).not.toBeNull();
  const registrations = nativeAdds(added.mock.calls);
  expect(registrations).toHaveLength(1);
  expect(move(source, [active]).defaultPrevented).toBe(true);
  return { view, source, active, removed, listener: registrations[0][1] };
}
describe("ShoppingList native guard lifetime", () => {
  it.each([
    "end",
    "cancel",
    "global-end",
    "global-cancel",
    "unmount",
    "workspace-cancel",
  ] as const)("releases its exact listener after %s", (mode) => {
    const s = begin();
    if (mode === "end")
      fireEvent.touchEnd(s.source, { changedTouches: [s.active] });
    if (mode === "cancel")
      fireEvent.touchCancel(s.source, { changedTouches: [s.active] });
    if (mode === "global-end") fireEvent.touchEnd(document);
    if (mode === "global-cancel") fireEvent.touchCancel(document);
    if (mode === "unmount") s.view.unmount();
    if (mode === "workspace-cancel")
      s.view.rerender(<Harness generation={1} />);
    expect(document.querySelector(".esp-shopping-touch-clone")).toBeNull();
    expect(s.removed).toHaveBeenCalledWith("touchmove", s.listener, true);
    if (s.source.isConnected)
      expect(move(s.source, [s.active]).defaultPrevented).toBe(false);
  });
  it("uses the real collapsed group-header touch identifier as well as item touches", () => {
    const s = begin(true);
    expect(move(s.source, [point(s.source, 99)]).defaultPrevented).toBe(false);
    fireEvent.touchCancel(s.source, { changedTouches: [s.active] });
    expect(s.removed).toHaveBeenCalledWith("touchmove", s.listener, true);
  });
});
