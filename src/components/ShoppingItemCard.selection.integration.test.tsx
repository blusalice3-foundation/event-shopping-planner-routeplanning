import type { ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../types/item";
import ShoppingItemCard from "./ShoppingItemCard";
import { shoppingPerformance } from "../utils/shoppingPerformance";

const item: ShoppingItem = {
  id: "selection-card",
  eventDate: "1日目",
  block: "A",
  number: "01",
  circle: "ユーザー登録サークル",
  title: "エラーが発生しました",
  purchaseStatus: "None",
  price: 1255,
  quantity: 25,
  remarks: "優先",
};

type CardProps = ComponentProps<typeof ShoppingItemCard>;
const makeProps = (): CardProps => ({
  item,
  onUpdate: vi.fn(),
  onEditRequest: vi.fn(),
  onDeleteRequest: vi.fn(),
  onSelectItem: vi.fn(),
  isSelected: false,
  isStriped: false,
  layoutMode: "pc",
  viewMode: "edit",
  skipLimitedPurchaseForSingleQuantity: true,
});

const presentations = [
  { layoutMode: "pc", viewMode: "edit", hasCheckbox: true },
  { layoutMode: "smartphone", viewMode: "edit", hasCheckbox: true },
  { layoutMode: "smartphone", viewMode: "execute", hasCheckbox: false },
] as const;
const nativePresentations = presentations.flatMap((presentation) =>
  [false, true].map((preferNativeOptions) => ({
    ...presentation,
    preferNativeOptions,
  })),
);

const getCard = (container: HTMLElement) => {
  const card = container.firstElementChild;
  expect(card).toBeInstanceOf(HTMLElement);
  expect(card).toHaveClass("rounded-lg");
  return card as HTMLElement;
};
const selectionStripe = (card: HTMLElement) =>
  [...card.querySelectorAll<HTMLElement>("[class]")].find(
    (element) =>
      element.classList.contains("bg-blue-500") &&
      element.classList.contains("w-1.5"),
  );
const warningStripe = (card: HTMLElement) =>
  [...card.querySelectorAll<HTMLElement>("[class]")].find((element) =>
    element.getAttribute("class")?.includes("repeating-linear-gradient"),
  );
const priceControl = () =>
  screen.getByRole<HTMLSelectElement>("combobox", { name: "購入金額" });
const quantityControl = () =>
  screen.getByRole<HTMLSelectElement>("combobox", {
    name: "購入予定数量",
  });

describe("ShoppingItemCard selection updates", () => {
  it.each(presentations)(
    "updates selection presentation without replacing the $layoutMode/$viewMode card",
    ({ layoutMode, viewMode, hasCheckbox }) => {
      const current = { ...makeProps(), layoutMode, viewMode };
      const view = render(<ShoppingItemCard {...current} />);
      const card = getCard(view.container);
      const checkbox = hasCheckbox
        ? screen.getByRole("checkbox", {
            name: `Select item ${item.circle} - ${item.title}`,
          })
        : null;
      expect(card).toHaveClass("bg-white");
      expect(selectionStripe(card)).toHaveClass("invisible");
      expect(warningStripe(card)).toBeInTheDocument();
      if (checkbox) expect(checkbox).not.toBeChecked();
      if (layoutMode === "pc") {
        expect(
          card.querySelector(
            ".absolute.inset-0.rounded-lg.pointer-events-none",
          ),
        ).toHaveClass("bg-white/80");
      }

      view.rerender(<ShoppingItemCard {...current} isSelected />);
      expect(getCard(view.container)).toBe(card);
      expect(card).toHaveClass("bg-blue-100", "dark:bg-blue-900/50");
      expect(selectionStripe(card)).not.toHaveClass("invisible");
      expect(selectionStripe(card)).toBeVisible();
      if (checkbox) {
        expect(
          screen.getByRole("checkbox", {
            name: `Select item ${item.circle} - ${item.title}`,
          }),
        ).toBe(checkbox);
        expect(checkbox).toBeChecked();
      } else {
        expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      }
      if (layoutMode === "pc") {
        expect(warningStripe(card)).toBeUndefined();
        expect(
          card.querySelector(
            ".absolute.inset-0.rounded-lg.pointer-events-none",
          ),
        ).toHaveClass("bg-blue-100/80", "dark:bg-blue-900/30");
      } else {
        expect(warningStripe(card)).toBeInTheDocument();
      }

      view.rerender(<ShoppingItemCard {...current} />);
      expect(getCard(view.container)).toBe(card);
      expect(card).toHaveClass("bg-white");
      expect(selectionStripe(card)).toHaveClass("invisible");
      expect(warningStripe(card)).toBeInTheDocument();
      if (checkbox) expect(checkbox).not.toBeChecked();
    },
  );

  it.each(nativePresentations)(
    "preserves focused controls and custom options across $layoutMode/$viewMode selection (native=$preferNativeOptions)",
    ({ layoutMode, viewMode, preferNativeOptions }) => {
      const current = {
        ...makeProps(),
        layoutMode,
        viewMode,
        preferNativeOptions,
      };
      const view = render(<ShoppingItemCard {...current} />);
      const card = getCard(view.container);
      const price = priceControl();
      const quantity = quantityControl();
      const customPrice = within(price).getByRole("option", { name: "1,255" });
      const standardPrice = within(price).getByRole("option", { name: "500" });
      const customQuantity = within(quantity).getByRole("option", {
        name: "25（現在値）",
      });
      price.focus();
      expect(price).toHaveFocus();

      for (const isSelected of [true, false, true]) {
        view.rerender(
          <ShoppingItemCard {...current} isSelected={isSelected} />,
        );
        expect(getCard(view.container)).toBe(card);
        expect(priceControl()).toBe(price);
        expect(quantityControl()).toBe(quantity);
        expect(price).toHaveFocus();
        expect(price).toHaveValue("1255");
        expect(quantity).toHaveValue("25");
        expect(within(price).getByRole("option", { name: "1,255" })).toBe(
          customPrice,
        );
        expect(within(price).getByRole("option", { name: "500" })).toBe(
          standardPrice,
        );
        expect(
          within(quantity).getByRole("option", { name: "25（現在値）" }),
        ).toBe(customQuantity);
      }
      expect(current.onUpdate).not.toHaveBeenCalled();
    },
  );

  it.each(presentations)(
    "retains optimistic quantity edits when selection changes in $layoutMode/$viewMode",
    ({ layoutMode, viewMode }) => {
      const current = {
        ...makeProps(),
        layoutMode,
        viewMode,
        preferNativeOptions: true,
      };
      const view = render(<ShoppingItemCard {...current} />);
      const card = getCard(view.container);
      const quantity = quantityControl();
      fireEvent.change(quantity, { target: { value: "7" } });
      expect(current.onUpdate).toHaveBeenLastCalledWith({
        ...item,
        quantity: 7,
      });
      expect(quantity).toHaveValue("7");
      // The source item is deliberately unchanged, as while its save is pending.
      view.rerender(<ShoppingItemCard {...current} isSelected />);
      expect(getCard(view.container)).toBe(card);
      expect(quantityControl()).toBe(quantity);
      expect(quantity).toHaveValue("7");
      fireEvent.change(priceControl(), { target: { value: "2000" } });
      expect(current.onUpdate).toHaveBeenLastCalledWith({
        ...item,
        quantity: 7,
        price: 2000,
      });
    },
  );

  it.each(presentations)(
    "applies read-only changes while selected and resumes with the latest callback in $layoutMode/$viewMode",
    ({ layoutMode, viewMode, hasCheckbox }) => {
      const current = {
        ...makeProps(),
        layoutMode,
        viewMode,
        preferNativeOptions: true,
        isSelected: true,
      };
      const view = render(<ShoppingItemCard {...current} />);
      const card = getCard(view.container);
      const price = priceControl();
      const quantity = quantityControl();
      view.rerender(<ShoppingItemCard {...current} readOnly />);
      expect(getCard(view.container)).toBe(card);
      expect(priceControl()).toBe(price);
      expect(quantityControl()).toBe(quantity);
      expect(price).toBeDisabled();
      expect(quantity).toBeDisabled();
      if (hasCheckbox) {
        expect(screen.getByRole("checkbox")).toBeDisabled();
        expect(screen.getByRole("checkbox")).toBeChecked();
      }
      fireEvent.change(price, { target: { value: "2000" } });
      fireEvent.change(quantity, { target: { value: "7" } });
      expect(current.onUpdate).not.toHaveBeenCalled();
      expect(price).toHaveValue("1255");
      expect(quantity).toHaveValue("25");

      const latestUpdate = vi.fn();
      view.rerender(
        <ShoppingItemCard
          {...current}
          readOnly={false}
          onUpdate={latestUpdate}
        />,
      );
      expect(price).not.toBeDisabled();
      fireEvent.change(price, { target: { value: "2000" } });
      expect(latestUpdate).toHaveBeenLastCalledWith({ ...item, price: 2000 });
      expect(current.onUpdate).not.toHaveBeenCalled();
    },
  );

  it.each(presentations)(
    "propagates item changes and new callbacks while selected in $layoutMode/$viewMode",
    ({ layoutMode, viewMode, hasCheckbox }) => {
      const current = {
        ...makeProps(),
        layoutMode,
        viewMode,
        isSelected: true,
      };
      const view = render(<ShoppingItemCard {...current} />);
      const card = getCard(view.container);
      const latestUpdate = vi.fn();
      const latestSelection = vi.fn();
      const changedItem = {
        ...item,
        circle: "変更後のユーザー登録",
        title: "更新後のエラーが発生しました",
        price: 1455,
      };
      view.rerender(
        <ShoppingItemCard
          {...current}
          item={changedItem}
          onUpdate={latestUpdate}
          onSelectItem={latestSelection}
        />,
      );
      expect(getCard(view.container)).toBe(card);
      expect(screen.getByText(changedItem.circle)).toBeInTheDocument();
      expect(screen.getByText(changedItem.title)).toBeInTheDocument();
      expect(priceControl()).toHaveValue("1455");
      expect(
        within(priceControl()).getByRole("option", { name: "1,455" }),
      ).toBeInTheDocument();
      if (hasCheckbox) {
        const checkbox = screen.getByRole("checkbox", {
          name: `Select item ${changedItem.circle} - ${changedItem.title}`,
        });
        expect(checkbox).toBeChecked();
        fireEvent.click(checkbox);
        expect(latestSelection).toHaveBeenCalledWith(item.id);
        expect(current.onSelectItem).not.toHaveBeenCalled();
      }
      fireEvent.change(priceControl(), { target: { value: "2000" } });
      expect(latestUpdate).toHaveBeenLastCalledWith({
        ...changedItem,
        price: 2000,
      });
      expect(current.onUpdate).not.toHaveBeenCalled();
    },
  );

  it("keeps adjacent cards' selection presentation independent", () => {
    const first = makeProps();
    const second = {
      ...makeProps(),
      item: { ...item, id: "other-card", circle: "別のサークル" },
    };
    const Cards = ({ firstSelected }: { firstSelected: boolean }) => (
      <>
        <ShoppingItemCard {...first} isSelected={firstSelected} />
        <ShoppingItemCard {...second} isSelected={!firstSelected} />
      </>
    );
    const view = render(<Cards firstSelected />);
    const firstCard = view.container.children[0] as HTMLElement;
    const secondCard = view.container.children[1] as HTMLElement;
    expect(within(firstCard).getByRole("checkbox")).toBeChecked();
    expect(within(secondCard).getByRole("checkbox")).not.toBeChecked();
    expect(firstCard).toHaveClass("bg-blue-100");
    expect(secondCard).toHaveClass("bg-white");
    view.rerender(<Cards firstSelected={false} />);
    expect(view.container.children[0]).toBe(firstCard);
    expect(view.container.children[1]).toBe(secondCard);
    expect(within(firstCard).getByRole("checkbox")).not.toBeChecked();
    expect(within(secondCard).getByRole("checkbox")).toBeChecked();
    expect(firstCard).toHaveClass("bg-white");
    expect(secondCard).toHaveClass("bg-blue-100");
  });
});

describe("ShoppingItemCard background presentation updates", () => {
  it.each(nativePresentations)(
    "updates both background inputs without rendering controls again in $layoutMode/$viewMode (native=$preferNativeOptions)",
    ({ layoutMode, viewMode, preferNativeOptions }) => {
      const firstColor = "bg-amber-50 dark:bg-amber-950";
      const nextColor = "bg-emerald-50 dark:bg-emerald-950";
      const current = {
        ...makeProps(),
        layoutMode,
        viewMode,
        preferNativeOptions,
      };
      shoppingPerformance.enable();
      try {
        const view = render(
          <ShoppingItemCard {...current} blockBackgroundColor={firstColor} />,
        );
        const card = getCard(view.container);
        const price = priceControl();
        const quantity = quantityControl();
        const priceChoices = [...price.options];
        const quantityChoices = [...quantity.options];
        price.focus();
        shoppingPerformance.reset();

        view.rerender(
          <ShoppingItemCard
            {...current}
            isStriped
            blockBackgroundColor={nextColor}
          />,
        );
        expect(card).toHaveClass("bg-emerald-50", "dark:bg-emerald-950");
        expect(card).not.toHaveClass("bg-amber-50");
        if (layoutMode === "pc") {
          expect(
            card.querySelector(
              ".grid.flex-grow > .absolute.inset-0.rounded-lg.pointer-events-none",
            ),
          ).toHaveClass("bg-transparent", "dark:bg-slate-900/45");
        }

        view.rerender(<ShoppingItemCard {...current} isSelected />);
        expect(card).toHaveClass("bg-blue-100", "dark:bg-blue-900/50");
        view.rerender(
          <ShoppingItemCard
            {...current}
            isSelected
            isStriped
            blockBackgroundColor={firstColor}
          />,
        );
        expect(card).toHaveClass("bg-blue-100", "dark:bg-blue-900/50");
        if (layoutMode === "pc") {
          expect(
            card.querySelector(
              ".grid.flex-grow > .absolute.inset-0.rounded-lg.pointer-events-none",
            ),
          ).toHaveClass("bg-blue-100/80", "dark:bg-blue-900/30");
        }

        view.rerender(<ShoppingItemCard {...current} isStriped />);
        expect(card).toHaveClass("bg-blue-50/50", "dark:bg-slate-900/50");
        if (layoutMode === "pc") {
          expect(
            card.querySelector(
              ".grid.flex-grow > .absolute.inset-0.rounded-lg.pointer-events-none",
            ),
          ).toHaveClass("bg-blue-50/40", "dark:bg-slate-900/25");
        }
        view.rerender(<ShoppingItemCard {...current} />);
        expect(card).toHaveClass("bg-white", "dark:bg-slate-800");
        if (layoutMode === "pc") {
          expect(
            card.querySelector(
              ".grid.flex-grow > .absolute.inset-0.rounded-lg.pointer-events-none",
            ),
          ).toHaveClass("bg-white/80", "dark:bg-slate-800/35");
        }
        expect(getCard(view.container)).toBe(card);
        expect(priceControl()).toBe(price);
        expect(quantityControl()).toBe(quantity);
        expect([...price.options]).toEqual(priceChoices);
        expect([...quantity.options]).toEqual(quantityChoices);
        priceChoices.forEach((choice, index) =>
          expect(price.options[index]).toBe(choice),
        );
        quantityChoices.forEach((choice, index) =>
          expect(quantity.options[index]).toBe(choice),
        );
        expect(price).toHaveFocus();
        expect(shoppingPerformance.read().renders.card ?? 0).toBe(0);
        expect(current.onUpdate).not.toHaveBeenCalled();
      } finally {
        shoppingPerformance.enable(false);
        shoppingPerformance.reset();
      }
    },
  );

  it.each(presentations)(
    "uses the current optimistic purchase status for $layoutMode/$viewMode backgrounds",
    ({ layoutMode, viewMode }) => {
      const current = {
        ...makeProps(),
        item: { ...item, quantity: 1 },
        layoutMode,
        viewMode,
        preferNativeOptions: true,
      };
      const latestColor = "bg-emerald-50 dark:bg-emerald-950";
      shoppingPerformance.enable();
      try {
        const view = render(
          <ShoppingItemCard
            {...current}
            blockBackgroundColor="bg-amber-50 dark:bg-amber-950"
          />,
        );
        const card = getCard(view.container);
        const status = screen.getByRole("button", { name: /Current status/i });
        fireEvent.click(status);
        expect(current.onUpdate).toHaveBeenLastCalledWith(
          expect.objectContaining({ purchaseStatus: "Purchased" }),
        );
        expect(card).toHaveClass("bg-white");
        shoppingPerformance.reset();

        // The source still says None while the local purchase save is pending.
        view.rerender(
          <ShoppingItemCard
            {...current}
            isStriped
            blockBackgroundColor={latestColor}
          />,
        );
        expect(card).toHaveClass("bg-blue-50/50", "dark:bg-slate-900/50");
        expect(card).not.toHaveClass("bg-emerald-50");
        if (layoutMode === "pc") {
          expect(
            card.querySelector(
              ".grid.flex-grow > .absolute.inset-0.rounded-lg.pointer-events-none",
            ),
          ).toHaveClass("bg-blue-50/40", "dark:bg-slate-900/25");
        }
        view.rerender(
          <ShoppingItemCard
            {...current}
            isSelected
            isStriped
            blockBackgroundColor={latestColor}
          />,
        );
        expect(card).toHaveClass("bg-blue-100", "dark:bg-blue-900/50");
        view.rerender(
          <ShoppingItemCard
            {...current}
            isStriped
            blockBackgroundColor={latestColor}
          />,
        );
        expect(card).toHaveClass("bg-blue-50/50");
        expect(shoppingPerformance.read().renders.card ?? 0).toBe(0);

        for (const purchaseStatus of [
          "SoldOut",
          "Absent",
          "Postpone",
          "Late",
          "None",
        ]) {
          fireEvent.click(status);
          expect(current.onUpdate).toHaveBeenLastCalledWith(
            expect.objectContaining({ purchaseStatus }),
          );
        }
        expect(getCard(view.container)).toBe(card);
        expect(card).toHaveClass("bg-emerald-50", "dark:bg-emerald-950");
        if (layoutMode === "pc") {
          expect(
            card.querySelector(
              ".grid.flex-grow > .absolute.inset-0.rounded-lg.pointer-events-none",
            ),
          ).toHaveClass("bg-transparent", "dark:bg-slate-900/45");
        }
      } finally {
        shoppingPerformance.enable(false);
        shoppingPerformance.reset();
      }
    },
  );
});
