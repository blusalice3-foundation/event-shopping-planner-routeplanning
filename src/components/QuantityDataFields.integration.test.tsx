import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../types/item";
import { ItemEditDialog } from "./ItemEditDialog";
import ShoppingItemCard from "./ShoppingItemCard";
import { AddItemDialogView } from "./focus/FocusModeDialogs";

const baseItem: ShoppingItem = {
  id: "item-1",
  circle: "サークルA",
  eventDate: "1日目",
  block: "A",
  number: "01",
  title: "新刊",
  price: 900,
  purchaseStatus: "None",
  quantity: 25,
  remarks: "当日確認",
};

const optionValues = (select: HTMLElement): string[] =>
  Array.from((select as HTMLSelectElement).options).map(
    (option) => option.value,
  );

const cardProps = () => ({
  onUpdate: vi.fn(),
  isStriped: false,
  onEditRequest: vi.fn(),
  onDeleteRequest: vi.fn(),
  isSelected: false,
  onSelectItem: vi.fn(),
  skipLimitedPurchaseForSingleQuantity: true,
});

describe("quantity and synchronized field presentation", () => {
  it("shows synchronized price and remarks in editable fields without duplicate sheet fields", () => {
    render(
      <ItemEditDialog
        item={{ ...baseItem, price: 1200, remarks: "新刊セットあり" }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.queryByLabelText("カタログ価格（シート・読み取り専用）"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("シート備考（読み取り専用）"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "購入金額" })).toHaveValue(
      "1200",
    );
    expect(screen.getByRole("textbox", { name: "利用者メモ" })).toHaveValue(
      "新刊セットあり",
    );

    const quantity = screen.getByRole("combobox", { name: "数量" });
    expect(optionValues(quantity)).toEqual([
      ...Array.from({ length: 20 }, (_, index) => String(index + 1)),
      "25",
    ]);
    expect(quantity).toHaveValue("25");
    expect(
      within(quantity).getByRole("option", { name: "25（現在値）" }),
    ).toBeInTheDocument();
  });

  it("keeps existing editable values without duplicate sheet fields", () => {
    render(
      <ItemEditDialog item={baseItem} onSave={vi.fn()} onClose={vi.fn()} />,
    );

    expect(
      screen.queryByLabelText("カタログ価格（シート・読み取り専用）"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("シート備考（読み取り専用）"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "購入金額" })).toHaveValue(
      "900",
    );
    expect(screen.getByRole("textbox", { name: "利用者メモ" })).toHaveValue(
      "当日確認",
    );
  });

  it("shows synchronized fields once and reflects zero prices and empty remarks on cards", () => {
    const props = cardProps();
    const { rerender } = render(
      <ShoppingItemCard
        {...props}
        item={{ ...baseItem, price: 1200, remarks: "シート側の備考" }}
      />,
    );

    expect(screen.queryByLabelText("シート情報")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "利用者メモ" })).toHaveValue(
      "シート側の備考",
    );
    expect(screen.getByRole("combobox", { name: "購入金額" })).toHaveValue(
      "1200",
    );

    const quantity = screen.getByRole("combobox", { name: "購入予定数量" });
    expect(quantity).toHaveValue("25");
    expect(optionValues(quantity)).toContain("20");
    fireEvent.change(quantity, { target: { value: "20" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 20 }),
    );

    rerender(
      <ShoppingItemCard
        {...props}
        item={{ ...baseItem, price: 0, remarks: "" }}
      />,
    );
    expect(screen.getByRole("combobox", { name: "購入金額" })).toHaveValue("0");
    expect(screen.getByRole("textbox", { name: "利用者メモ" })).toHaveValue("");
  });

  it.each([
    ["full", "完全保護"],
    ["deletable", "削除のみ許可"],
  ] as const)(
    "keeps the %s lock visible and permits direct memo edits",
    (protectionLevel, label) => {
      const props = cardProps();
      render(
        <ShoppingItemCard
          {...props}
          item={{ ...baseItem, purchaseStatus: "Purchased", protectionLevel }}
        />,
      );

      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
      expect(screen.queryByLabelText("シート情報")).not.toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "購入金額" })).toHaveValue(
        "900",
      );
      fireEvent.change(screen.getByRole("textbox", { name: "利用者メモ" }), {
        target: { value: "現地で追記" },
      });
      expect(props.onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ remarks: "現地で追記", protectionLevel }),
      );
    },
  );

  it("uses the same 1-to-20 range in the focus-mode add dialog", () => {
    render(
      <AddItemDialogView
        dialog={{
          isOpen: true,
          eventDate: "1日目",
          block: "A",
          number: "01",
        }}
        form={{
          circle: "サークルA",
          title: "",
          price: "",
          quantity: "1",
          remarks: "",
          url: "",
          purchaseStatus: "Purchased",
        }}
        setDialog={vi.fn()}
        setForm={vi.fn()}
        currentVisit={undefined}
        priceOptions={[0, 100]}
        onPriceInputChange={vi.fn()}
        onPriceSelectChange={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const quantity = screen.getByRole("combobox", { name: "数量" });
    expect(optionValues(quantity)).toEqual(
      Array.from({ length: 20 }, (_, index) => String(index + 1)),
    );
    expect(screen.getByText("購入金額")).toBeInTheDocument();
    expect(screen.getByText("利用者メモ")).toBeInTheDocument();
  });
});
