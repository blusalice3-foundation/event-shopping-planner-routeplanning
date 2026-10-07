import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { ShoppingItem } from "../types/item";
import ShoppingItemCard from "./ShoppingItemCard";
const item: ShoppingItem = {
  id: "item-rendering",
  eventDate: "1日目",
  block: "A",
  number: "1",
  circle: "ユーザー登録サークル",
  title: "エラーが発生しました",
  purchaseStatus: "None",
  price: 1255,
  quantity: 25,
  remarks: "メモ",
};
const props = (): ComponentProps<typeof ShoppingItemCard> => ({
  item,
  onUpdate: vi.fn(),
  onEditRequest: vi.fn(),
  onDeleteRequest: vi.fn(),
  onSelectItem: vi.fn(),
  isSelected: false,
  isStriped: false,
  layoutMode: "pc",
  viewMode: "execute",
  skipLimitedPurchaseForSingleQuantity: true,
});

describe("shared native select choices", () => {
  it("reuses common choices without omitting the current custom price or quantity", () => {
    const current = props();
    const { rerender } = render(<ShoppingItemCard {...current} />);
    const price = screen.getByRole("combobox", { name: "購入金額" });
    const quantity = screen.getByRole("combobox", { name: "購入予定数量" });
    expect(within(price).getAllByRole("option")).toHaveLength(103);
    expect(price).toHaveValue("1255");
    expect(within(price).getByRole("option", { name: "1,255" })).toHaveValue(
      "1255",
    );
    expect(quantity).toHaveValue("25");
    expect(
      within(quantity).getByRole("option", { name: "25（現在値）" }),
    ).toHaveValue("25");
    rerender(
      <ShoppingItemCard
        {...current}
        item={{ ...item, price: null, quantity: 1 }}
      />,
    );
    expect(price).toHaveValue("");
    expect(within(price).getAllByRole("option")).toHaveLength(102);
    expect(within(price).getByRole("option", { name: "価格未定" })).toHaveValue(
      "",
    );
    expect(quantity).toHaveValue("1");
    expect(within(quantity).getAllByRole("option")).toHaveLength(20);
  });

  it("keeps independently controlled values when several cards share choices", () => {
    const current = props();
    render(
      <>
        <ShoppingItemCard
          {...current}
          item={{ ...item, price: 500, quantity: 1 }}
        />
        <ShoppingItemCard
          {...props()}
          item={{ ...item, id: "second", price: 2000, quantity: 20 }}
        />
      </>,
    );
    const prices = screen.getAllByRole("combobox", { name: "購入金額" });
    const quantities = screen.getAllByRole("combobox", {
      name: "購入予定数量",
    });
    fireEvent.change(prices[0], { target: { value: "0" } });
    fireEvent.change(quantities[0], { target: { value: "2" } });
    expect(prices[0]).toHaveValue("0");
    expect(prices[1]).toHaveValue("2000");
    expect(quantities[0]).toHaveValue("2");
    expect(quantities[1]).toHaveValue("20");
  });

  it.each([
    ["pc", false],
    ["pc", true],
    ["smartphone", false],
    ["smartphone", true],
  ] as const)(
    "keeps existing update callbacks for %s/native=%s price, quantity, and remarks changes",
    (layoutMode, preferNativeOptions) => {
      const current = { ...props(), layoutMode, preferNativeOptions };
      render(<ShoppingItemCard {...current} />);
      fireEvent.change(screen.getByRole("combobox", { name: "購入金額" }), {
        target: { value: "2000" },
      });
      expect(current.onUpdate).toHaveBeenLastCalledWith({
        ...item,
        price: 2000,
      });
      fireEvent.change(screen.getByRole("combobox", { name: "購入予定数量" }), {
        target: { value: "20" },
      });
      expect(current.onUpdate).toHaveBeenLastCalledWith({
        ...item,
        price: 2000,
        quantity: 20,
      });
      fireEvent.change(screen.getByRole("textbox", { name: "利用者メモ" }), {
        target: { value: "確認と保存" },
      });
      expect(current.onUpdate).toHaveBeenLastCalledWith({
        ...item,
        price: 2000,
        quantity: 20,
        remarks: "確認と保存",
      });
    },
  );

  it.each([false, true])(
    "keeps focused controls and child ownership stable when the list preference changes from %s",
    (preferNativeOptions) => {
      const current = { ...props(), preferNativeOptions };
      const { rerender } = render(<ShoppingItemCard {...current} />);
      const price = screen.getByRole("combobox", { name: "購入金額" });
      price.focus();
      rerender(
        <ShoppingItemCard
          {...current}
          preferNativeOptions={!preferNativeOptions}
        />,
      );
      expect(screen.getByRole("combobox", { name: "購入金額" })).toBe(price);
      expect(document.activeElement).toBe(price);
      expect(within(price).getAllByRole("option")).toHaveLength(103);
      expect(price).toHaveValue("1255");
    },
  );

  it("keeps native choices read-only and restores their controlled value", () => {
    const current = { ...props(), preferNativeOptions: true, readOnly: true };
    render(<ShoppingItemCard {...current} />);
    const price = screen.getByRole("combobox", { name: "購入金額" });
    const quantity = screen.getByRole("combobox", { name: "購入予定数量" });
    expect(price).toBeDisabled();
    expect(quantity).toBeDisabled();
    fireEvent.change(price, { target: { value: "0" } });
    expect(current.onUpdate).not.toHaveBeenCalled();
    expect(price).toHaveValue("1255");
  });

  it.each([0, 0.5, 21, 100])(
    "retains imported nonstandard quantity %s in numeric order",
    (quantity) => {
      render(<ShoppingItemCard {...props()} item={{ ...item, quantity }} />);
      const control = screen.getByRole("combobox", { name: "購入予定数量" });
      const values = within(control)
        .getAllByRole("option")
        .map((option) => Number((option as HTMLOptionElement).value));
      expect(control).toHaveValue(String(quantity));
      expect(values).toEqual(
        [
          ...new Set([
            quantity,
            ...Array.from({ length: 20 }, (_, index) => index + 1),
          ]),
        ].sort((a, b) => a - b),
      );
    },
  );
});

describe("batched card text overflow", () => {
  let callback: ResizeObserverCallback;
  let availableWidth: number;

  beforeEach(() => {
    availableWidth = 100;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      () => availableWidth,
    );
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.textContent === item.circle ? 200 : 101;
      },
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(onResize: ResizeObserverCallback) {
          callback = onResize;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  it("preserves the one-pixel threshold and expand/collapse after measurement", async () => {
    render(<ShoppingItemCard {...props()} />);
    await flush();
    const circle = screen.getByTitle(item.circle);
    const title = screen.getByTitle(item.title);
    expect(circle).toHaveClass("border-dashed");
    expect(title).not.toHaveClass("border-dashed");
    fireEvent.click(circle);
    expect(circle).toHaveAttribute("aria-expanded", "true");
    await flush();
    fireEvent.click(circle);
    await flush();
    expect(circle).toHaveAttribute("aria-expanded", "false");
    expect(circle).toHaveClass("border-dashed");
  });

  it("remeasures on resize and changed text without retaining stale overflow", async () => {
    const current = props();
    const { rerender } = render(<ShoppingItemCard {...current} />);
    await flush();
    const circle = screen.getByTitle(item.circle);
    availableWidth = 300;
    act(() =>
      callback(
        [{ target: circle.firstElementChild } as ResizeObserverEntry],
        {} as ResizeObserver,
      ),
    );
    await flush();
    expect(circle).not.toHaveClass("border-dashed");
    availableWidth = 100;
    rerender(
      <ShoppingItemCard
        {...current}
        item={{ ...item, circle: "短いサークル名" }}
      />,
    );
    await flush();
    expect(screen.getByTitle("短いサークル名")).not.toHaveClass(
      "border-dashed",
    );
  });
});
