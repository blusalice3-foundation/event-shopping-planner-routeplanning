// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../../types/item";
import CellItemsPopup from "./CellItemsPopup";

const limitedItem: ShoppingItem = {
  id: "limited-item",
  circle: "Limited Circle",
  eventDate: "Day1",
  block: "A",
  number: "01",
  title: "Limited Title",
  price: 1000,
  purchaseStatus: "LimitedPurchase",
  quantity: 5,
  limitedPurchasedQuantity: 2,
  remarks: "",
};

const renderPopup = (
  props: Partial<ComponentProps<typeof CellItemsPopup>> = {},
) => {
  const onClose = vi.fn();
  const onEditRequest = vi.fn();
  const onAddToVisitList = vi.fn();
  const onRemoveFromVisitList = vi.fn();

  render(
    <CellItemsPopup
      isOpen
      onClose={onClose}
      blockName="A"
      number={1}
      items={[limitedItem]}
      executeModeItemIds={new Set()}
      onAddToVisitList={onAddToVisitList}
      onRemoveFromVisitList={onRemoveFromVisitList}
      onEditRequest={onEditRequest}
      {...props}
    />,
  );

  return { onAddToVisitList, onRemoveFromVisitList, onClose, onEditRequest };
};

describe("CellItemsPopup limited purchase actions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([false, true])(
    "does not capture or start a row long press for the edit button (visited=%s)",
    (visited) => {
      vi.useFakeTimers();
      const {
        onAddToVisitList,
        onRemoveFromVisitList,
        onClose,
        onEditRequest,
      } = renderPopup({
        executeModeItemIds: new Set(visited ? [limitedItem.id] : []),
      });
      const edit = screen.getByRole("button", { name: "限数を編集" });
      const row = edit.closest<HTMLElement>(".cursor-pointer")!;
      const capture = vi.fn();
      Object.defineProperty(row, "setPointerCapture", { value: capture });

      fireEvent.pointerDown(edit, { pointerId: 1, pointerType: "mouse" });
      expect(capture).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(650));
      expect(
        screen.queryByRole("button", { name: "✏️ 編集" }),
      ).not.toBeInTheDocument();
      fireEvent.pointerUp(edit, { pointerId: 1, pointerType: "mouse" });
      fireEvent.click(edit, { detail: 1 });

      expect(onAddToVisitList).not.toHaveBeenCalled();
      expect(onRemoveFromVisitList).not.toHaveBeenCalled();
      expect(onEditRequest).toHaveBeenCalledExactlyOnceWith(limitedItem);
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it("shows a direct edit button for limited purchase items without requiring long press", () => {
    const { onAddToVisitList, onClose, onEditRequest } = renderPopup();

    fireEvent.click(screen.getByRole("button", { name: "限数を編集" }));

    expect(onAddToVisitList).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onEditRequest).toHaveBeenCalledWith(limitedItem);
  });
});
