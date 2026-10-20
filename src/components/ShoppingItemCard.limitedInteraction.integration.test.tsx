import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ShoppingItemCard from "./ShoppingItemCard";
import type { ShoppingItem } from "../types/item";

const item: ShoppingItem = {
  id: "limited-focus",
  circle: "サークル",
  title: "入力対象",
  eventDate: "1日目",
  block: "A",
  number: "01",
  price: 100,
  quantity: 5,
  remarks: "",
  purchaseStatus: "None",
};

const renderCard = (quantity: number) =>
  render(
    <ShoppingItemCard
      item={{ ...item, quantity }}
      onUpdate={vi.fn()}
      isStriped={false}
      onEditRequest={vi.fn()}
      onDeleteRequest={vi.fn()}
      isSelected={false}
      onSelectItem={vi.fn()}
      layoutMode="pc"
      viewMode="execute"
      purchaseStatusControlMode="radial"
      skipLimitedPurchaseForSingleQuantity
    />,
  );

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("radial limited input focus handoff", () => {
  it.each([1, 5])(
    "keeps quantity %i input focused after delayed animation callbacks",
    async (quantity) => {
      const user = userEvent.setup();
      const frames: FrameRequestCallback[] = [];
      vi.spyOn(window, "requestAnimationFrame").mockImplementation(
        (callback) => {
          frames.push(callback);
          return frames.length;
        },
      );
      renderCard(quantity);
      const statusButton = screen.getByRole("button", {
        name: /Current status/i,
      });
      await user.click(statusButton);
      await user.click(screen.getByRole("radio", { name: /^LimitedPurchase/ }));
      if (quantity === 1) {
        const choice = screen.getByRole("dialog", { name: "限数にしますか？" });
        expect(
          within(choice).getByRole("button", { name: "購入済" }),
        ).toHaveFocus();
        await user.click(within(choice).getByRole("button", { name: "限数" }));
      }
      const dialog = screen.getByRole("dialog", { name: "限数購入の数量" });
      const actual = within(dialog).getByRole("textbox", { name: "実購入数" });
      expect(actual).toHaveFocus();
      act(() => {
        frames.splice(0).forEach((callback) => callback(0));
      });
      expect(actual).toHaveFocus();
      await user.click(
        within(dialog).getByRole("button", { name: "キャンセル" }),
      );
      expect(statusButton).toHaveFocus();
      await user.click(statusButton);
      await user.click(screen.getByRole("radio", { name: /^LimitedPurchase/ }));
      const reopened = screen.getByRole("dialog", {
        name: quantity === 1 ? "限数にしますか？" : "限数購入の数量",
      });
      act(() => {
        frames.splice(0).forEach((callback) => callback(0));
      });
      expect(reopened).toContainElement(document.activeElement as HTMLElement);
    },
  );

  it("does not queue timeout focus restoration when animation frames are unavailable", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", undefined);
    renderCard(5);
    fireEvent.click(screen.getByRole("button", { name: /Current status/i }));
    fireEvent.click(screen.getByRole("radio", { name: /^LimitedPurchase/ }));
    const actual = screen.getByRole("textbox", { name: "実購入数" });
    expect(actual).toHaveFocus();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(actual).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(
      screen.getByRole("button", { name: /Current status/i }),
    ).toHaveFocus();
    vi.unstubAllGlobals();
  });

  it("contains touch events in the quantity-one choice and returns to its stable button", () => {
    const touch = vi.fn();
    render(
      <div
        onTouchStart={touch}
        onTouchMove={touch}
        onTouchEnd={touch}
        onTouchCancel={touch}
      >
        <ShoppingItemCard
          item={{ ...item, quantity: 1 }}
          onUpdate={vi.fn()}
          isStriped={false}
          onEditRequest={vi.fn()}
          onDeleteRequest={vi.fn()}
          isSelected={false}
          onSelectItem={vi.fn()}
          layoutMode="smartphone"
          viewMode="focus"
          purchaseStatusControlMode="radial"
          skipLimitedPurchaseForSingleQuantity
        />
      </div>,
    );
    const status = screen.getByRole("button", { name: /Current status/i });
    fireEvent.click(status);
    fireEvent.click(screen.getByRole("radio", { name: /^LimitedPurchase/ }));
    const choice = screen.getByRole("dialog", { name: "限数にしますか？" });
    fireEvent.touchStart(choice, { touches: [{ clientX: 150, clientY: 20 }] });
    fireEvent.touchMove(choice, { touches: [{ clientX: 20, clientY: 20 }] });
    fireEvent.touchEnd(choice, {
      changedTouches: [{ clientX: 20, clientY: 20 }],
    });
    fireEvent.touchCancel(choice);
    expect(touch).not.toHaveBeenCalled();
    fireEvent.click(within(choice).getByRole("button", { name: "キャンセル" }));
    expect(status).toHaveFocus();
  });
});

it("does not restore limited input focus to a hidden status button", async () => {
  const user = userEvent.setup();
  renderCard(5);
  const status = screen.getByRole("button", { name: /Current status/i });
  await user.click(status);
  await user.click(screen.getByRole("radio", { name: /^LimitedPurchase/ }));
  status.hidden = true;
  await user.click(screen.getByRole("button", { name: "キャンセル" }));
  expect(status).not.toHaveFocus();
  expect(document.body).toHaveFocus();
});
