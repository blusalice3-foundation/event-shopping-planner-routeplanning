import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ShoppingList from "./ShoppingList";
import type { ShoppingItem } from "../types/item";
const items: ShoppingItem[] = [
  {
    id: "target",
    circle: "対象",
    title: "新刊",
    eventDate: "Day1",
    block: "A",
    number: "01",
    price: 100,
    quantity: 1,
    purchaseStatus: "None",
    remarks: "",
  },
];
const original = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
afterEach(() => {
  if (original)
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", original);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});
function Harness({ requestId }: { requestId: number | null }) {
  const [collapsed, setCollapsed] = useState(new Set(["A-01"]));
  return (
    <>
      <input aria-label="検索語" />
      <ShoppingList
        items={items}
        onUpdateItem={vi.fn()}
        onMoveItem={vi.fn()}
        onEditRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
        onSelectItem={vi.fn()}
        selectedItemIds={new Set()}
        columnType="execute"
        currentDay="Day1"
        layoutMode="pc"
        viewMode="execute"
        skipLimitedPurchaseForSingleQuantity
        showSpaceGroups
        collapsedSpaces={collapsed}
        onToggleSpaceCollapse={(key) =>
          setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          })
        }
        searchScrollRequest={
          requestId === null ? null : { requestId, itemId: "target" }
        }
      />
    </>
  );
}
describe("search scroll requests", () => {
  it("expands a collapsed visit, waits for its row, and preserves the input focus on repeated requests", async () => {
    const scrolled: HTMLElement[] = [];
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: function (this: HTMLElement) {
        scrolled.push(this);
      },
    });
    const view = render(<Harness requestId={null} />);
    const search = screen.getByRole("textbox", { name: "検索語" });
    search.focus();
    expect(
      view.container.querySelector(
        '[data-space-navigation-anchor="item"][data-item-id="target"]',
      ),
    ).toBeNull();
    view.rerender(<Harness requestId={1} />);
    await waitFor(() =>
      expect(
        scrolled.some(
          (row) =>
            row.dataset.itemId === "target" ||
            row.querySelector('[data-item-id="target"]'),
        ),
      ).toBe(true),
    );
    expect(search).toHaveFocus();
    const count = scrolled.length;
    view.rerender(<Harness requestId={2} />);
    await waitFor(() => expect(scrolled.length).toBeGreaterThan(count));
    expect(search).toHaveFocus();
    const settledCount = scrolled.length;
    view.rerender(<Harness requestId={2} />);
    expect(scrolled).toHaveLength(settledCount);
  });
});
