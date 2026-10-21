import React from "react";
import { fireEvent, render, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../../types/item";
import { FocusModeItemList } from "./FocusModePanels";
import { createFocusVisitDisplayItemsProjector } from "./focusVisitDisplayItems";

const counters = vi.hoisted(() => ({
  mounts: new Map<string, number>(),
  unmounts: new Map<string, number>(),
}));
vi.mock("../ShoppingItemCard", () => ({
  default: function MockShoppingItemCard({
    item,
    onUpdate,
  }: {
    item: ShoppingItem;
    onUpdate: (item: ShoppingItem) => void;
  }) {
    React.useEffect(() => {
      counters.mounts.set(item.id, (counters.mounts.get(item.id) ?? 0) + 1);
      return () => {
        counters.unmounts.set(
          item.id,
          (counters.unmounts.get(item.id) ?? 0) + 1,
        );
      };
    }, [item.id]);
    return (
      <div>
        <input aria-label="draft" defaultValue={item.remarks} />
        <button
          onClick={() => onUpdate({ ...item, quantity: item.quantity + 1 })}
        >
          update
        </button>
        <a href={item.url}>link</a>
      </div>
    );
  },
}));
const makeItem = (id: string): ShoppingItem => ({
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
  url: "https://example.test/original",
});

describe("focus visit visibility and rows-only memo boundary", () => {
  beforeEach(() => {
    counters.mounts.clear();
    counters.unmounts.clear();
  });

  it("keeps all retained controls/DOM/input state while hiding and restoring a large visit", () => {
    const large = Array.from({ length: 80 }, (_, i) => makeItem(`large-${i}`));
    const small = makeItem("small"),
      items = [...large, small];
    const largeIds = large.map((item) => item.id),
      smallIds = ["small"];
    const project = createFocusVisitDisplayItemsProjector();
    const blinking = new Set<string>(),
      limited = new Set<string>();
    const has = vi.spyOn(blinking, "has"),
      onUpdateItem = vi.fn();
    const shared = {
      itemListRef: React.createRef<HTMLDivElement>(),
      layoutMode: "pc" as const,
      isMapVisible: false,
      blinkingPriceItemIds: blinking,
      blinkingLimitedMissingItemIds: limited,
      retainedItemIds: new Set(items.map((item) => item.id)),
      skipLimitedPurchaseForSingleQuantity: false,
      onUpdateItem,
    };
    const view = render(
      <FocusModeItemList
        {...shared}
        visitId="large"
        currentVisitDisplayItems={project(items, largeIds)}
      />,
    );
    const row = view.container.querySelector<HTMLElement>(
      '[data-item-id="large-0"]',
    )!;
    const input = within(row).getByRole("textbox", { name: "draft" });
    fireEvent.change(input, { target: { value: "入力途中" } });
    const visit = row.closest<HTMLElement>("[data-viewport-list]")!;
    expect(visit.hidden).toBe(false);
    expect(row.getAttribute("aria-setsize")).toBe("80");
    has.mockClear();
    view.rerender(
      <FocusModeItemList
        {...shared}
        visitId="small"
        currentVisitDisplayItems={project(items, smallIds)}
      />,
    );
    expect(visit.hidden).toBe(true);
    expect(visit.getAttribute("aria-hidden")).toBe("true");
    expect(
      view.container.querySelectorAll('[data-item-id^="large-"]'),
    ).toHaveLength(80);
    // Only the newly displayed small visit maps its item; the large hidden wrapper
    // changes without re-running its 80-item map/has checks.
    expect(has.mock.calls.length).toBe(1);
    has.mockClear();
    view.rerender(
      <FocusModeItemList
        {...shared}
        visitId="large"
        currentVisitDisplayItems={project(items, largeIds)}
      />,
    );
    expect(view.container.querySelector('[data-item-id="large-0"]')).toBe(row);
    expect(within(row).getByRole("textbox", { name: "draft" })).toBe(input);
    expect(input).toHaveValue("入力途中");
    expect(visit.hidden).toBe(false);
    expect(has).not.toHaveBeenCalled();
    expect(counters.mounts.get("large-0")).toBe(1);
    expect(counters.unmounts.get("large-0") ?? 0).toBe(0);

    const latest = vi.fn();
    view.rerender(
      <FocusModeItemList
        {...shared}
        onUpdateItem={latest}
        visitId="large"
        currentVisitDisplayItems={project(items, largeIds)}
      />,
    );
    fireEvent.click(within(row).getByRole("button", { name: "update" }));
    expect(latest).toHaveBeenCalledWith(
      expect.objectContaining({ id: "large-0", quantity: 2 }),
    );
    expect(onUpdateItem).not.toHaveBeenCalled();
    const changed = {
      ...large[0],
      quantity: 5,
      url: "https://example.test/current",
    };
    const changedItems = [changed, ...items.slice(1)];
    view.rerender(
      <FocusModeItemList
        {...shared}
        onUpdateItem={latest}
        visitId="large"
        currentVisitDisplayItems={project(changedItems, largeIds)}
      />,
    );
    expect(within(row).getByRole("link", { name: "link" })).toHaveAttribute(
      "href",
      changed.url,
    );
    expect(within(row).getByRole("textbox", { name: "draft" })).toBe(input);
    expect(input).toHaveValue("入力途中");
    fireEvent.click(within(row).getByRole("button", { name: "update" }));
    expect(latest).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "large-0", quantity: 6 }),
    );
  });
});
