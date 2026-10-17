// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createEventUpdateDiff,
  type AppFieldSyncCandidate,
  type PendingPurchasedQuantityChange,
  type SheetItem,
} from "../features/events/updateDiff";
import type { ShoppingItem } from "../types/item";
import UpdateConfirmationModal from "./UpdateConfirmationModal";

const commonProps = {
  itemsToDelete: [],
  itemsToUpdate: [],
  itemsToAdd: [],
  onCancel: vi.fn(),
};

describe("UpdateConfirmationModal quantity confirmation", () => {
  it("通常更新では更新元の案内を表示せずキャンセルできる", () => {
    const onCancel = vi.fn();
    render(
      <UpdateConfirmationModal
        {...commonProps}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.queryByText("更新元を切り替えます")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "更新元を切り替えて更新" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("不正数量を利用者向けに説明する", () => {
    render(
      <UpdateConfirmationModal
        {...commonProps}
        quantityWarnings={[
          {
            kind: "new-item-skipped",
            reason: "out-of-range",
            receivedValue: "21",
            circle: "サークルA",
            eventDate: "1日目",
            block: "東A",
            number: "01a",
            title: "新刊",
          },
        ]}
        onConfirm={vi.fn()}
      />,
    );

    expect(
      screen.getByText("数量を反映できなかった行: 1件"),
    ).toBeInTheDocument();
    expect(screen.getByText(/数量は1～20の整数/)).toBeInTheDocument();
    expect(screen.getByText(/品目を追加しません/)).toBeInTheDocument();
  });

  it("購入済み予定数量を既定では反映せず、チェック時だけ許可する", () => {
    const onConfirm = vi.fn();
    render(
      <UpdateConfirmationModal
        {...commonProps}
        pendingPurchasedQuantityChanges={[
          {
            itemId: "item-1",
            circle: "サークルA",
            eventDate: "1日目",
            block: "東A",
            number: "01a",
            title: "新刊",
            purchaseStatus: "LimitedPurchase",
            currentQuantity: 2,
            nextQuantity: 4,
          },
        ]}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText(/実際に購入した数量/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更新を実行" }));
    expect(onConfirm).toHaveBeenLastCalledWith({
      applyPurchasedQuantityChanges: false,
      acceptCsvExclusions: true,
      priceSyncMode: "preserve",
      remarksSyncMode: "preserve",
    });

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /スプレッドシートの予定数量へ変更する/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "更新を実行" }));
    expect(onConfirm).toHaveBeenLastCalledWith({
      applyPurchasedQuantityChanges: true,
      acceptCsvExclusions: true,
      priceSyncMode: "preserve",
      remarksSyncMode: "preserve",
    });
  });

  it.each<[string, Partial<PendingPurchasedQuantityChange>]>([
    ["対象ID", { itemId: "item-2" }],
    ["現在の予定数量", { currentQuantity: 3 }],
    ["変更後の予定数量", { nextQuantity: 5 }],
    ["購入状態", { purchaseStatus: "Purchased" }],
    ["表示する品目内容", { title: "別の新刊" }],
  ])("%sが同件数のまま変わると数量変更の再確認を求める", (_, changes) => {
    const pending: PendingPurchasedQuantityChange = {
      itemId: "item-1",
      circle: "ユーザー登録",
      eventDate: "1日目",
      block: "東A",
      number: "01a",
      title: "新刊",
      purchaseStatus: "LimitedPurchase",
      currentQuantity: 2,
      nextQuantity: 4,
    };
    const onConfirm = vi.fn();
    const { rerender } = render(
      <UpdateConfirmationModal
        {...commonProps}
        pendingPurchasedQuantityChanges={[pending]}
        onConfirm={onConfirm}
      />,
    );
    const checkbox = () =>
      screen.getByRole("checkbox", {
        name: /スプレッドシートの予定数量へ変更する/,
      });
    fireEvent.click(checkbox());
    expect(checkbox()).toBeChecked();

    rerender(
      <UpdateConfirmationModal
        {...commonProps}
        pendingPurchasedQuantityChanges={[{ ...pending, ...changes }]}
        onConfirm={onConfirm}
      />,
    );
    expect(checkbox()).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "更新を実行" }));
    expect(onConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ applyPurchasedQuantityChanges: false }),
    );

    fireEvent.click(checkbox());
    fireEvent.click(screen.getByRole("button", { name: "更新を実行" }));
    expect(onConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ applyPurchasedQuantityChanges: true }),
    );
  });

  it("同じ確認内容の配列を作り直しても数量変更の確認を保持する", () => {
    const pending: PendingPurchasedQuantityChange = {
      itemId: "item-1",
      circle: "ユーザー登録",
      eventDate: "1日目",
      block: "東A",
      number: "01a",
      title: "新刊",
      purchaseStatus: "Purchased",
      currentQuantity: 2,
      nextQuantity: 4,
    };
    const onConfirm = vi.fn();
    const { rerender } = render(
      <UpdateConfirmationModal
        {...commonProps}
        pendingPurchasedQuantityChanges={[pending]}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /スプレッドシートの予定数量へ変更する/,
      }),
    );
    rerender(
      <UpdateConfirmationModal
        {...commonProps}
        pendingPurchasedQuantityChanges={[{ ...pending }]}
        onConfirm={onConfirm}
      />,
    );
    expect(
      screen.getByRole("checkbox", {
        name: /スプレッドシートの予定数量へ変更する/,
      }),
    ).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "更新を実行" }));
    expect(onConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ applyPurchasedQuantityChanges: true }),
    );
  });

  it("限数の実購入数以下になる予定数量を反映しない理由を表示する", () => {
    render(
      <UpdateConfirmationModal
        {...commonProps}
        limitedPurchaseQuantityConflicts={[
          {
            itemId: "item-1",
            circle: "サークルA",
            eventDate: "1日目",
            block: "東A",
            number: "01a",
            title: "新刊",
            currentQuantity: 5,
            nextQuantity: 2,
            actualPurchasedQuantity: 3,
          },
        ]}
        onConfirm={vi.fn()}
      />,
    );

    expect(
      screen.getByText("限数購入の予定数量を反映できない品目: 1件"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/予定数量は実購入数より多い必要があります/),
    ).toBeInTheDocument();
    expect(screen.getByText(/実購入3、予定5 → 2/)).toBeInTheDocument();
  });

  it("更新元切替では新しい接続先とキャンセル時の扱いを表示する", () => {
    render(
      <UpdateConfirmationModal
        {...commonProps}
        nextSource={{
          url: "https://docs.google.com/spreadsheets/d/new-source",
          sheetName: "新刊一覧",
        }}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText("更新元を切り替えます")).toBeInTheDocument();
    expect(
      screen.getByText("https://docs.google.com/spreadsheets/d/new-source"),
    ).toBeInTheDocument();
    expect(screen.getByText("新刊一覧")).toBeInTheDocument();
    expect(
      screen.getByText("キャンセルすると、品目も更新元も変更されません。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "更新元を切り替えて更新" }),
    ).toBeInTheDocument();
  });
});

const makeItem = (index: number): ShoppingItem => ({
  id: `item-${index}`,
  circle: `ユーザー登録${index}`,
  eventDate: "1日目",
  block: "A",
  number: String(index + 1),
  title: `旧刊${index}`,
  price: 900,
  catalogPrice: 500,
  quantity: 2,
  purchaseStatus: "None",
  remarks: "利用者の記録",
  sheetRemarks: "旧シート備考",
  sheetIdentityVerified: true,
  source: "spreadsheet",
});

const fillEmptyCandidate: AppFieldSyncCandidate = {
  itemId: "item-fill",
  circle: "サークル補完",
  eventDate: "1日目",
  block: "東A",
  number: "01a",
  title: "新刊セット",
  purchaseStatus: "None",
  price: {
    currentValue: null,
    previousSheetValue: null,
    sheetValue: 1200,
    canFillEmpty: true,
  },
  remarks: {
    currentValue: "",
    previousSheetValue: "",
    sheetValue: "会場限定特典付き",
    canFillEmpty: true,
  },
};

const purchasedOverwriteCandidate: AppFieldSyncCandidate = {
  ...fillEmptyCandidate,
  itemId: "item-purchased",
  purchaseStatus: "Purchased",
  price: {
    currentValue: 900,
    previousSheetValue: 1000,
    sheetValue: null,
    canFillEmpty: false,
  },
  remarks: {
    currentValue: "利用者の記録",
    previousSheetValue: "旧シート備考",
    sheetValue: "",
    canFillEmpty: false,
  },
};

describe("UpdateConfirmationModal automatic update review", () => {
  it("500件のタイトル変更でも個別選択なしで1回の更新操作を受け付ける", () => {
    const current = Array.from({ length: 500 }, (_, index) => makeItem(index));
    const incoming: SheetItem[] = current.map((item, index) => ({
      ...item,
      title: `新刊${index}`,
      rawQuantity: String(item.quantity),
    }));
    const onConfirm = vi.fn();
    render(
      <UpdateConfirmationModal
        {...commonProps}
        {...createEventUpdateDiff(current, incoming)}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText("更新: 500件")).toBeInTheDocument();
    expect(screen.getByText("...他 495件")).toBeInTheDocument();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    const confirm = screen.getByRole("button", { name: "更新を実行" });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith({
      applyPurchasedQuantityChanges: false,
      acceptCsvExclusions: true,
      priceSyncMode: "preserve",
      remarksSyncMode: "preserve",
    });
  });

  it("追加・更新・削除は各5件の例と総件数を表示し、保護件数も維持する", () => {
    const current = Array.from({ length: 8 }, (_, index) => makeItem(index));
    render(
      <UpdateConfirmationModal
        {...commonProps}
        itemsToDelete={current}
        itemsToUpdate={current}
        itemsToAdd={current}
        protectedFromDelete={2}
        protectedFromUpdate={3}
        onConfirm={vi.fn()}
      />,
    );

    for (const action of ["削除", "更新", "追加"]) {
      const section = screen.getByText(`${action}: 8件`).parentElement!;
      expect(within(section).getAllByRole("listitem")).toHaveLength(6);
      expect(within(section).getByText("...他 3件")).toBeInTheDocument();
      expect(within(section).queryByText(/旧刊5/)).not.toBeInTheDocument();
    }
    expect(screen.getByText("削除から保護: 2件")).toBeInTheDocument();
    expect(screen.getByText("更新から保護: 3件")).toBeInTheDocument();
  });

  it.each([
    ["空欄補完候補", fillEmptyCandidate],
    ["購入済みの上書き候補", purchasedOverwriteCandidate],
  ] as const)(
    "%sがあっても価格・利用者メモの選択を出さず維持を送る",
    (_, candidate) => {
      const onConfirm = vi.fn();
      render(
        <UpdateConfirmationModal
          {...commonProps}
          appFieldSyncCandidates={[candidate]}
          onConfirm={onConfirm}
        />,
      );

      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
      expect(
        screen.queryByText("利用者欄へのシート値反映"),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "更新を実行" }));
      expect(onConfirm).toHaveBeenCalledWith({
        applyPurchasedQuantityChanges: false,
        acceptCsvExclusions: true,
        priceSyncMode: "preserve",
        remarksSyncMode: "preserve",
      });
    },
  );

  it("CSVの除外結果と警告を表示し、追加チェックなしで更新できる", () => {
    const onConfirm = vi.fn();
    render(
      <UpdateConfirmationModal
        {...commonProps}
        itemsToDelete={[makeItem(0)]}
        csvReview={{
          warnings: ["必須項目が不足した行は取り込みません。"],
          itemCount: 4,
        }}
        sheetImport={{
          acceptedCount: 4,
          rowExclusions: {
            excludedCount: 1,
            missingFieldCounts: {
              circle: 1,
              eventDate: 0,
              block: 0,
              number: 0,
            },
            examples: [
              {
                sourceRowId: "row-3",
                lineNumber: 3,
                missingFields: ["circle"],
              },
            ],
          },
        }}
        onConfirm={onConfirm}
      />,
    );

    expect(
      screen.getByRole("region", { name: "シート取込結果" }),
    ).toHaveTextContent("取込対象: 4件、必須項目不足による除外: 1行");
    expect(
      screen.getByText("除外後の品目: 4件、削除候補: 1件"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("必須項目が不足した行は取り込みません。"),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    const confirm = screen.getByRole("button", { name: "更新を実行" });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ acceptCsvExclusions: true }),
    );
  });

  it("数量確認内容を変更前に戻しても古い同意を復元しない", () => {
    const pending: PendingPurchasedQuantityChange = {
      itemId: "item-1",
      circle: "ユーザー登録",
      eventDate: "1日目",
      block: "東A",
      number: "01a",
      title: "購入済み品目",
      purchaseStatus: "Purchased",
      currentQuantity: 2,
      nextQuantity: 4,
    };
    const onConfirm = vi.fn();
    const props = { ...commonProps, onConfirm };
    const { rerender } = render(
      <UpdateConfirmationModal
        {...props}
        pendingPurchasedQuantityChanges={[pending]}
      />,
    );
    const checkbox = () =>
      screen.getByRole("checkbox", {
        name: /スプレッドシートの予定数量へ変更する/,
      });
    fireEvent.click(checkbox());
    expect(checkbox()).toBeChecked();
    rerender(
      <UpdateConfirmationModal
        {...props}
        pendingPurchasedQuantityChanges={[{ ...pending, nextQuantity: 5 }]}
      />,
    );
    expect(checkbox()).not.toBeChecked();
    rerender(
      <UpdateConfirmationModal
        {...props}
        pendingPurchasedQuantityChanges={[pending]}
      />,
    );
    expect(checkbox()).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "更新を実行" }));
    expect(onConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ applyPurchasedQuantityChanges: false }),
    );
  });
});
