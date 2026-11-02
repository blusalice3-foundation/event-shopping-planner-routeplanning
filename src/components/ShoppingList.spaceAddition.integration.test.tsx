import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../types/item";
import ShoppingList from "./ShoppingList";

const makeItem = (
  id: string,
  priorityLevel: ShoppingItem["priorityLevel"],
): ShoppingItem => ({
  id,
  eventDate: "1日目",
  block: "A",
  number: "01a",
  circle: "既存サークル",
  title: `既存の本${id}`,
  price: 500,
  quantity: 1,
  remarks: "既存メモ",
  purchaseStatus: "None",
  priorityLevel,
});

const commonProps = {
  currentDay: "1日目",
  rangeScopeId: "イベント:1日目",
  onUpdateItem: vi.fn(),
  onMoveItem: vi.fn(),
  onEditRequest: vi.fn(),
  onDeleteRequest: vi.fn(),
  selectedItemIds: new Set<string>(),
  onSelectItem: vi.fn(),
  showSpaceGroups: true,
  skipLimitedPurchaseForSingleQuantity: true,
  forceFullListRenderer: true,
};

const openDialog = () => {
  fireEvent.click(
    screen.getAllByRole("button", {
      name: "このスペースにアイテムを追加",
    })[0],
  );
  return within(screen.getByRole("dialog", { name: "新規アイテム追加" }));
};

describe("space + item addition", () => {
  it.each(["highest", "priority", "none"] as const)(
    "inherits %s from execution without changing existing books or purchase defaults",
    (priorityLevel) => {
      const items = [makeItem("original", priorityLevel)];
      const before = structuredClone(items);
      const onAddItem = vi.fn();
      render(
        <ShoppingList
          {...commonProps}
          items={items}
          columnType="execute"
          viewMode="execute"
          layoutMode="pc"
          onAddItem={onAddItem}
        />,
      );
      const dialog = openDialog();
      expect(dialog.getByLabelText("優先度")).toHaveValue(priorityLevel);
      fireEvent.change(dialog.getByRole("combobox", { name: "サークル名" }), {
        target: { value: "追加サークル" },
      });
      fireEvent.click(dialog.getByRole("button", { name: "リストに追加" }));
      expect(onAddItem).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          eventDate: "1日目",
          block: "A",
          number: "01a",
          circle: "追加サークル",
          priorityLevel,
          price: null,
          quantity: 1,
          purchaseStatus: "None",
        }),
      );
      expect(items).toEqual(before);
    },
  );

  it("inherits uniform candidate priority from every book", () => {
    render(
      <ShoppingList
        {...commonProps}
        items={[makeItem("one", "highest"), makeItem("two", "highest")]}
        columnType="candidate"
        viewMode="edit"
        layoutMode="pc"
        onAddItem={vi.fn()}
      />,
    );
    expect(openDialog().getByLabelText("優先度")).toHaveValue("highest");
  });

  it.each(["pc", "smartphone"] as const)(
    "requires an explicit priority for a collapsed mixed candidate group on %s and retains other inputs",
    (layoutMode) => {
      const items = [makeItem("high", "highest"), makeItem("normal", "none")];
      const before = structuredClone(items);
      const onAddItem = vi.fn();
      render(
        <ShoppingList
          {...commonProps}
          items={items}
          columnType="candidate"
          viewMode="edit"
          layoutMode={layoutMode}
          collapsedSpaces={new Set(["A-01a"])}
          onAddItem={onAddItem}
        />,
      );
      const dialog = openDialog();
      const submit = dialog.getByRole("button", { name: "リストに追加" });
      const priority = dialog.getByLabelText("優先度");
      expect(priority).toHaveValue("");
      expect(priority).toBeRequired();
      fireEvent.change(dialog.getByRole("combobox", { name: "サークル名" }), {
        target: { value: "追加サークル" },
      });
      fireEvent.change(dialog.getByLabelText("タイトル"), {
        target: { value: "入力中の新刊" },
      });
      fireEvent.change(dialog.getByLabelText("購入金額"), {
        target: { value: "1234" },
      });
      fireEvent.change(dialog.getByLabelText("数量"), {
        target: { value: "3" },
      });
      fireEvent.change(dialog.getByLabelText("購入状態"), {
        target: { value: "Purchased" },
      });
      fireEvent.change(dialog.getByLabelText("ブロック"), {
        target: { value: "B" },
      });
      fireEvent.change(dialog.getByLabelText("ナンバー"), {
        target: { value: "08b" },
      });
      fireEvent.change(dialog.getByLabelText("利用者メモ"), {
        target: { value: "入力中メモ" },
      });
      expect(submit).toBeDisabled();
      fireEvent.click(submit);
      expect(onAddItem).not.toHaveBeenCalled();
      fireEvent.change(priority, { target: { value: "priority" } });
      expect(submit).toBeEnabled();
      expect(dialog.getByLabelText("タイトル")).toHaveValue("入力中の新刊");
      expect(dialog.getByLabelText("購入金額")).toHaveValue("1234");
      expect(dialog.getByLabelText("数量")).toHaveValue("3");
      expect(dialog.getByLabelText("購入状態")).toHaveValue("Purchased");
      fireEvent.click(submit);
      expect(onAddItem).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          eventDate: "1日目",
          block: "B",
          number: "08b",
          circle: "追加サークル",
          title: "入力中の新刊",
          priorityLevel: "priority",
          price: 1234,
          quantity: 3,
          purchaseStatus: "Purchased",
          remarks: "入力中メモ",
        }),
      );
      expect(items).toEqual(before);
    },
  );

  it.each(["pc", "smartphone"] as const)(
    "keeps a hyphenated block and normalized book space when adding on %s",
    (layoutMode) => {
      const original = {
        ...makeItem("original", "highest"),
        block: "東-A",
        number: "01a2",
      };
      const onAddItem = vi.fn();
      render(
        <ShoppingList
          {...commonProps}
          items={[original]}
          columnType="candidate"
          viewMode="edit"
          layoutMode={layoutMode}
          collapsedSpaces={new Set(["東-A-01a"])}
          onAddItem={onAddItem}
        />,
      );
      const dialog = openDialog();
      expect(dialog.getByLabelText("ブロック")).toHaveValue("東-A");
      expect(dialog.getByLabelText("ナンバー")).toHaveValue("01a");
      expect(dialog.getByLabelText("優先度")).toHaveValue("highest");
      fireEvent.change(dialog.getByRole("combobox", { name: "サークル名" }), {
        target: { value: "追加サークル" },
      });
      fireEvent.click(dialog.getByRole("button", { name: "リストに追加" }));
      expect(onAddItem).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          block: "東-A",
          number: "01a",
          priorityLevel: "highest",
        }),
      );
      expect(original.number).toBe("01a2");
    },
  );
  it("closes a form whose day or event context has expired", () => {
    const onAddItem = vi.fn();
    const props = {
      ...commonProps,
      items: [makeItem("book", "priority")],
      columnType: "execute" as const,
      viewMode: "edit" as const,
      layoutMode: "pc" as const,
      onAddItem,
    };
    const { rerender } = render(<ShoppingList {...props} />);
    openDialog();
    rerender(
      <ShoppingList
        {...props}
        currentDay="2日目"
        rangeScopeId="別イベント:2日目"
      />,
    );
    expect(
      screen.queryByRole("dialog", { name: "新規アイテム追加" }),
    ).not.toBeInTheDocument();
    expect(onAddItem).not.toHaveBeenCalled();
  });
});
