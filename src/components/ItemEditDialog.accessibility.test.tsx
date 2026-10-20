// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../types/item";
import type { HallDefinition } from "../types/map";
import { ItemEditDialog } from "./ItemEditDialog";

const item: ShoppingItem = {
  id: "item-1",
  circle: "サークルA",
  eventDate: "1日目",
  block: "東A",
  number: "01a",
  title: "新刊セット",
  price: 1000,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "",
};

const halls: HallDefinition[] = [
  {
    id: "east-1",
    name: "東1ホール",
    vertices: [],
    blockNames: ["東A"],
  },
  {
    id: "east-2",
    name: "東2ホール",
    vertices: [],
    blockNames: ["東A"],
  },
];

const expectExplicitLabel = (
  dialog: HTMLElement,
  control: HTMLElement,
  labelText: string,
) => {
  expect(control.id).not.toBe("");
  const label = Array.from(dialog.querySelectorAll("label")).find(
    (candidate) => candidate.htmlFor === control.id,
  );
  expect(label).toBeDefined();
  expect(label).toHaveTextContent(labelText);
};

describe("ItemEditDialog accessibility", () => {
  it("contains keyboard focus, closes on Escape, and restores the opener", () => {
    const onClose = vi.fn();
    const renderView = (isOpen: boolean) => (
      <>
        <button type="button">アイテム編集を開く</button>
        {isOpen && (
          <ItemEditDialog item={item} onSave={vi.fn()} onClose={onClose} />
        )}
      </>
    );
    const view = render(renderView(false));
    const opener = screen.getByRole("button", { name: "アイテム編集を開く" });
    opener.focus();

    view.rerender(renderView(true));
    const dialog = screen.getByRole("dialog", { name: "アイテム編集" });
    const dialogQueries = within(dialog);
    const firstControl = dialogQueries.getByRole("combobox", {
      name: "サークル名",
    });
    const lastControl = dialogQueries.getByRole("button", { name: "保存" });
    expect(firstControl).toHaveFocus();

    fireEvent.keyDown(firstControl, { key: "Tab", shiftKey: true });
    expect(lastControl).toHaveFocus();
    fireEvent.keyDown(lastControl, { key: "Tab" });
    expect(firstControl).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    view.rerender(renderView(false));
    expect(opener).toHaveFocus();
  });

  it("exposes a named modal and explicitly associates every visible control label", () => {
    const onSave = vi.fn();
    render(
      <ItemEditDialog
        item={item}
        halls={halls}
        onSave={onSave}
        onClose={vi.fn()}
        onPriorityChange={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "アイテム編集" });
    const dialogQueries = within(dialog);
    const heading = dialogQueries.getByRole("heading", {
      name: "アイテム編集",
    });
    const descriptionId = dialog.getAttribute("aria-describedby");

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", heading.id);
    expect(descriptionId).not.toBeNull();
    expect(document.getElementById(descriptionId!)).toHaveTextContent(
      "1日目 東A-01a",
    );

    const labeledControls: Array<[HTMLElement, string]> = [
      [
        dialogQueries.getByRole("combobox", { name: "サークル名" }),
        "サークル名",
      ],
      [dialogQueries.getByRole("textbox", { name: "タイトル" }), "タイトル"],
      [dialogQueries.getByRole("textbox", { name: "参加日" }), "参加日"],
      [dialogQueries.getByRole("textbox", { name: "ブロック" }), "ブロック"],
      [dialogQueries.getByRole("textbox", { name: "ナンバー" }), "ナンバー"],
      [
        dialogQueries.getByRole("textbox", { name: "購入金額" }),
        "購入金額（利用者が編集）",
      ],
      [
        dialogQueries.getByRole("combobox", { name: "クイック選択" }),
        "クイック選択",
      ],
      [dialogQueries.getByRole("combobox", { name: "数量" }), "数量"],
      [dialogQueries.getByRole("combobox", { name: "購入状態" }), "購入状態"],
      [
        dialogQueries.getByRole("combobox", { name: /ホール設定/ }),
        "ホール設定",
      ],
      [dialogQueries.getByRole("combobox", { name: "優先度" }), "優先度"],
      [
        dialogQueries.getByRole("textbox", { name: "利用者メモ" }),
        "利用者メモ",
      ],
      [dialogQueries.getByRole("textbox", { name: "URL" }), "URL"],
    ];

    for (const [control, labelText] of labeledControls) {
      expectExplicitLabel(dialog, control, labelText);
    }
    expect(
      dialogQueries.getByRole("combobox", { name: "サークル名" }),
    ).toBeRequired();

    fireEvent.change(dialogQueries.getByRole("textbox", { name: "参加日" }), {
      target: { value: "2日目" },
    });
    fireEvent.change(
      dialogQueries.getByRole("combobox", { name: "クイック選択" }),
      { target: { value: "1200" } },
    );
    fireEvent.change(dialogQueries.getByRole("combobox", { name: "数量" }), {
      target: { value: "2" },
    });
    fireEvent.click(dialogQueries.getByRole("button", { name: "保存" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ eventDate: "2日目", price: 1200, quantity: 2 }),
      { kind: "unchanged" },
    );
  });

  it("keeps the conditional limited-purchase inputs explicitly labeled", () => {
    render(
      <ItemEditDialog
        item={{
          ...item,
          purchaseStatus: "LimitedPurchase",
          quantity: 4,
          limitedPurchasedQuantity: 2,
        }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "アイテム編集" });
    const dialogQueries = within(dialog);
    expectExplicitLabel(
      dialog,
      dialogQueries.getByRole("textbox", { name: "実購入数" }),
      "実購入数",
    );
    expectExplicitLabel(
      dialog,
      dialogQueries.getByRole("textbox", { name: "購入予定量" }),
      "購入予定量",
    );
  });
});

describe("ItemEditDialog map selection", () => {
  it("blocks saving while a map is unselected and enables saving after selection", () => {
    const onSave = vi.fn();
    let mapSelectionRequired = true;
    const previewMembership = vi.fn(() => ({
      mapSelectionRequired,
      status: mapSelectionRequired
        ? "利用するマップを選択してください"
        : "自動判定",
      locationStatus: mapSelectionRequired
        ? "マップ選択待ち"
        : "場所を特定済み",
      halls: [],
      details: [],
    }));
    const view = render(
      <ItemEditDialog
        item={item}
        onSave={onSave}
        onClose={vi.fn()}
        previewMembership={previewMembership}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "ナンバー" }), {
      target: { value: "02a" },
    });
    const save = screen.getByRole("button", { name: "保存" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/利用するマップを選択してください/)).toBeVisible();
    mapSelectionRequired = false;
    view.rerender(
      <ItemEditDialog
        item={item}
        onSave={onSave}
        onClose={vi.fn()}
        previewMembership={() => previewMembership()}
      />,
    );
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ number: "02a" }),
      { kind: "unchanged" },
    );
  });
});

describe("planned quantity draft", () => {
  it("keeps an edited planned quantity through status changes and saves the visible 2/3", () => {
    const onSave = vi.fn();
    render(
      <ItemEditDialog
        item={{ ...item, quantity: 5 }}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("購入状態"), {
      target: { value: "LimitedPurchase" },
    });
    expect(screen.getByLabelText("購入予定量")).toHaveValue("3");
    fireEvent.change(screen.getByLabelText("実購入数"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("購入状態"), {
      target: { value: "None" },
    });
    fireEvent.change(screen.getByLabelText("購入状態"), {
      target: { value: "LimitedPurchase" },
    });
    expect(screen.getByLabelText("実購入数")).toHaveValue("2");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        quantity: 3,
        limitedPurchasedQuantity: 2,
        purchaseStatus: "LimitedPurchase",
      }),
      { kind: "unchanged" },
    );
  });
  it("does not substitute a quantity for an empty planned draft after leaving limited mode", () => {
    const onSave = vi.fn();
    render(
      <ItemEditDialog
        item={{ ...item, purchaseStatus: "LimitedPurchase", quantity: 30 }}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("購入予定量"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("購入予定量を入力してください")).toBeVisible();
  });
});

it("initializes purchased actual draft once, then retains it across limited status toggles", () => {
  render(
    <ItemEditDialog
      item={{ ...item, purchaseStatus: "Purchased", quantity: 5 }}
      onSave={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("購入状態"), {
    target: { value: "LimitedPurchase" },
  });
  expect(screen.getByLabelText("実購入数")).toHaveValue("5");
  fireEvent.change(screen.getByLabelText("実購入数"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("購入状態"), {
    target: { value: "Purchased" },
  });
  fireEvent.change(screen.getByLabelText("購入状態"), {
    target: { value: "LimitedPurchase" },
  });
  expect(screen.getByLabelText("実購入数")).toHaveValue("2");
});

describe("planned quantity select boundary", () => {
  it.each([
    ["3", 3],
    ["03", 3],
    [" 3 ", 3],
    ["30", 30],
    ["030", 30],
  ])(
    "shows and saves the same planned quantity after limited input %j",
    (draft, planned) => {
      const onSave = vi.fn();
      render(
        <ItemEditDialog
          item={{
            ...item,
            purchaseStatus: "LimitedPurchase",
            quantity: 5,
            limitedPurchasedQuantity: 2,
          }}
          onSave={onSave}
          onClose={vi.fn()}
        />,
      );
      fireEvent.change(screen.getByLabelText("購入予定量"), {
        target: { value: draft },
      });
      fireEvent.change(screen.getByLabelText("購入状態"), {
        target: { value: "None" },
      });
      expect(screen.getByLabelText("数量")).toHaveValue(String(planned));
      expect(
        within(screen.getByLabelText("数量")).getByRole("option", {
          selected: true,
        }),
      ).toHaveTextContent(String(planned));
      fireEvent.change(screen.getByLabelText("購入状態"), {
        target: { value: "LimitedPurchase" },
      });
      expect(screen.getByLabelText("購入予定量")).toHaveValue(draft);
      expect(screen.getByLabelText("実購入数")).toHaveValue("2");
      fireEvent.change(screen.getByLabelText("購入状態"), {
        target: { value: "None" },
      });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: planned, purchaseStatus: "None" }),
        { kind: "unchanged" },
      );
      expect(onSave.mock.calls[0][0]).not.toHaveProperty(
        "limitedPurchasedQuantity",
      );
    },
  );
});

describe("invalid and retried planned quantity drafts", () => {
  it.each([
    ["", "", "購入予定量を入力してください"],
    ["   ", "   ", "購入予定量を入力してください"],
    ["0", "0", "購入予定量は1以上で入力してください"],
    ["00", "0", "購入予定量は1以上で入力してください"],
    ["-1", "-1", "購入予定量は整数で入力してください"],
    ["1.5", "1.5", "購入予定量は整数で入力してください"],
    ["1e2", "1e2", "購入予定量は整数で入力してください"],
    ["0x10", "0x10", "購入予定量は整数で入力してください"],
  ])(
    "retains invalid draft %j on the ordinary select and rejects saving",
    (draft, selected, error) => {
      const onSave = vi.fn();
      render(
        <ItemEditDialog
          item={{ ...item, purchaseStatus: "LimitedPurchase", quantity: 30 }}
          onSave={onSave}
          onClose={vi.fn()}
        />,
      );
      fireEvent.change(screen.getByLabelText("購入予定量"), {
        target: { value: draft },
      });
      fireEvent.change(screen.getByLabelText("購入状態"), {
        target: { value: "None" },
      });
      expect(screen.getByLabelText("数量")).toHaveValue(selected);
      expect(
        within(screen.getByLabelText("数量")).getByRole("option", {
          selected: true,
        }),
      ).toHaveTextContent(
        draft.trim() === "" ? "購入予定量を入力してください" : selected,
      );
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(onSave).not.toHaveBeenCalled();
      expect(screen.getByText(error, { selector: "p" })).toBeVisible();
      fireEvent.change(screen.getByLabelText("購入状態"), {
        target: { value: "LimitedPurchase" },
      });
      expect(screen.getByLabelText("購入予定量")).toHaveValue(draft);
      fireEvent.change(screen.getByLabelText("購入状態"), {
        target: { value: "None" },
      });
      fireEvent.change(screen.getByLabelText("数量"), {
        target: { value: "4" },
      });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 4 }),
        { kind: "unchanged" },
      );
    },
  );

  it("keeps normalized selection and other edits after save failure, then retries the visible quantity", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error("保存再試行テスト"))
      .mockResolvedValueOnce(undefined);
    render(
      <ItemEditDialog
        item={{
          ...item,
          purchaseStatus: "LimitedPurchase",
          quantity: 5,
          limitedPurchasedQuantity: 2,
        }}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("購入予定量"), {
      target: { value: "03" },
    });
    fireEvent.change(screen.getByLabelText("利用者メモ"), {
      target: { value: "ユーザー登録のメモを保持" },
    });
    fireEvent.change(screen.getByLabelText("購入状態"), {
      target: { value: "Purchased" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存" })).toBeEnabled(),
    );
    expect(screen.getByText("保存再試行テスト")).toBeVisible();
    expect(screen.getByLabelText("数量")).toHaveValue("3");
    expect(screen.getByLabelText("利用者メモ")).toHaveValue(
      "ユーザー登録のメモを保持",
    );
    fireEvent.change(screen.getByLabelText("購入状態"), {
      target: { value: "LimitedPurchase" },
    });
    expect(screen.getByLabelText("購入予定量")).toHaveValue("03");
    expect(screen.getByLabelText("実購入数")).toHaveValue("2");
    fireEvent.change(screen.getByLabelText("購入状態"), {
      target: { value: "Purchased" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        quantity: 3,
        purchaseStatus: "Purchased",
        remarks: "ユーザー登録のメモを保持",
      }),
    );
    expect(onSave.mock.calls[1][0]).not.toHaveProperty(
      "limitedPurchasedQuantity",
    );
  });

  it("uses the same parsed quantity when equal actual input is cancelled and confirmed", () => {
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const onSave = vi.fn();
    render(
      <ItemEditDialog
        item={{ ...item, purchaseStatus: "LimitedPurchase", quantity: 5 }}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("購入予定量"), {
      target: { value: "03" },
    });
    fireEvent.change(screen.getByLabelText("実購入数"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText("購入予定量")).toHaveValue("03");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 3, purchaseStatus: "Purchased" }),
      { kind: "unchanged" },
    );
    confirm.mockRestore();
  });

  it("retains the planned draft after excess confirmation is cancelled, then converts with its parsed value", () => {
    const onSave = vi.fn();
    render(
      <ItemEditDialog
        item={{ ...item, purchaseStatus: "LimitedPurchase", quantity: 5 }}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("購入予定量"), {
      target: { value: "03" },
    });
    fireEvent.change(screen.getByLabelText("実購入数"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    fireEvent.click(screen.getByRole("button", { name: "修正する" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText("購入予定量")).toHaveValue("03");
    expect(screen.getByLabelText("実購入数")).toHaveValue("4");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    fireEvent.click(screen.getByRole("button", { name: "購入済にする" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 3, purchaseStatus: "Purchased" }),
      { kind: "unchanged" },
    );
  });
});
