import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../../types/item";
import { createEventUpdateDiff, type SheetItem } from "./updateDiff";
import { applyEventUpdateToItems } from "./updateApply";
import { createSheetRowExclusionSummary } from "./sheetRowSelection";

const currentItem = (overrides: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: "item-1",
  circle: "サークルA",
  eventDate: "1日目",
  block: "東A",
  number: "01a",
  title: "新刊",
  price: 1000,
  purchaseStatus: "None",
  quantity: 2,
  remarks: "旧シート備考",
  url: "https://old.example",
  source: "spreadsheet",
  protectionLevel: "none",
  assignedTo: "担当者",
  orderIndex: 7,
  ...overrides,
});

const sheetItem = (overrides: Partial<SheetItem> = {}): SheetItem => ({
  circle: "サークルA",
  eventDate: "1日目",
  block: "東A",
  number: "01a",
  title: "新刊",
  price: 1200,
  quantity: 3,
  remarks: "新シート備考",
  url: "https://new.example",
  ...overrides,
});

describe("createEventUpdateDiff quantity and field allowlist", () => {
  it("保護なしの品目は数量・価格・備考・URLを同期し、購入記録を維持する", () => {
    const before = currentItem({
      limitedPurchasedQuantity: 1,
      lastSyncedAt: "2026-01-01",
    });
    const diff = createEventUpdateDiff([before], [sheetItem()]);

    expect(diff.itemsToUpdate).toHaveLength(1);
    expect(diff.itemsToUpdate[0]).toMatchObject({
      quantity: 3,
      url: "https://new.example",
      price: 1200,
      remarks: "新シート備考",
      purchaseStatus: "None",
      limitedPurchasedQuantity: 1,
      assignedTo: "担当者",
      orderIndex: 7,
      lastSyncedAt: "2026-01-01",
    });
    expect(diff.quantityWarnings).toEqual([]);
    expect(diff.pendingPurchasedQuantityChanges).toEqual([]);
  });

  it("既存品目の空欄と旧データの数量21超をそのまま維持する", () => {
    const before = currentItem({ quantity: 25 });
    const diff = createEventUpdateDiff(
      [before],
      [
        sheetItem({
          price: 1000,
          remarks: "旧シート備考",
          url: "https://old.example",
          rawQuantity: "",
        }),
      ],
    );

    expect(diff.itemsToUpdate).toEqual([]);
    expect(diff.quantityWarnings).toEqual([]);
    expect(before.quantity).toBe(25);
  });

  it.each(["deletable", "full"] as const)(
    "%sで保護された品目は価格・備考・内部識別情報を更新しない",
    (protectionLevel) => {
      const before = currentItem({ protectionLevel });
      const diff = createEventUpdateDiff([before], [sheetItem()]);
      expect(diff.itemsToUpdate).toEqual([]);
      expect(diff.protectedFromUpdate).toBe(1);
      expect(applyEventUpdateToItems([before], diff)).toEqual([before]);
    },
  );

  it("アプリ由来でも明示的に保護なしにした品目はシート値で更新する", () => {
    const before = currentItem({ source: "app", protectionLevel: "none" });
    const incoming = sheetItem();
    const diff = createEventUpdateDiff([before], [incoming]);
    expect(applyEventUpdateToItems([before], diff)[0]).toMatchObject({
      price: incoming.price,
      remarks: incoming.remarks,
    });
  });
  it("既存品目の不正数量を警告し、数量は変更しない", () => {
    const before = currentItem();
    const diff = createEventUpdateDiff(
      [before],
      [
        sheetItem({
          price: 1000,
          remarks: "旧シート備考",
          url: "https://old.example",
          rawQuantity: "21",
        }),
      ],
    );

    expect(diff.itemsToUpdate).toEqual([]);
    expect(diff.quantityWarnings).toEqual([
      expect.objectContaining({
        kind: "existing-quantity-not-updated",
        receivedValue: "21",
      }),
    ]);
  });

  it("新規品目の空欄は数量1で追加し、不正数量の行は品目ごと追加しない", () => {
    const diff = createEventUpdateDiff(
      [],
      [
        sheetItem({ number: "01a", rawQuantity: "" }),
        sheetItem({ number: "02a", rawQuantity: "0" }),
      ],
    );

    expect(diff.itemsToAdd).toEqual([
      expect.objectContaining({
        number: "01a",
        quantity: 1,
        price: 1200,
        remarks: "新シート備考",
      }),
    ]);
    expect(diff.quantityWarnings).toEqual([
      expect.objectContaining({
        kind: "new-item-skipped",
        number: "02a",
        receivedValue: "0",
      }),
    ]);
  });

  it("購入済みと限定購入の予定数量変更を、明示確認待ちとして分離する", () => {
    const purchased = currentItem({
      id: "purchased",
      purchaseStatus: "Purchased",
      quantity: 2,
    });
    const limited = currentItem({
      id: "limited",
      number: "02a",
      purchaseStatus: "LimitedPurchase",
      quantity: 4,
      limitedPurchasedQuantity: 2,
    });
    const diff = createEventUpdateDiff(
      [purchased, limited],
      [
        sheetItem({
          price: 1000,
          remarks: "旧シート備考",
          url: "https://old.example",
          rawQuantity: "3",
        }),
        sheetItem({
          number: "02a",
          price: 1000,
          remarks: "旧シート備考",
          url: "https://old.example",
          rawQuantity: "5",
        }),
      ],
    );

    expect(diff.itemsToUpdate).toEqual([]);
    expect(diff.pendingPurchasedQuantityChanges).toEqual([
      expect.objectContaining({
        itemId: "purchased",
        purchaseStatus: "Purchased",
        currentQuantity: 2,
        nextQuantity: 3,
      }),
      expect.objectContaining({
        itemId: "limited",
        purchaseStatus: "LimitedPurchase",
        currentQuantity: 4,
        nextQuantity: 5,
      }),
    ]);
  });

  it("限数の予定数量が実購入数以下なら警告へ分離し、有効な増加だけ確認候補にする", () => {
    const sameAsActual = currentItem({
      id: "same-as-actual",
      number: "01a",
      purchaseStatus: "LimitedPurchase",
      quantity: 5,
      limitedPurchasedQuantity: 3,
    });
    const belowActual = currentItem({
      id: "below-actual",
      number: "02a",
      purchaseStatus: "LimitedPurchase",
      quantity: 5,
      limitedPurchasedQuantity: 3,
    });
    const aboveActual = currentItem({
      id: "above-actual",
      number: "03a",
      purchaseStatus: "LimitedPurchase",
      quantity: 5,
      limitedPurchasedQuantity: 3,
    });

    const diff = createEventUpdateDiff(
      [sameAsActual, belowActual, aboveActual],
      [
        sheetItem({ number: "01a", rawQuantity: "3" }),
        sheetItem({ number: "02a", rawQuantity: "2" }),
        sheetItem({ number: "03a", rawQuantity: "4" }),
      ],
    );

    expect(diff.limitedPurchaseQuantityConflicts).toEqual([
      expect.objectContaining({
        itemId: "same-as-actual",
        actualPurchasedQuantity: 3,
        currentQuantity: 5,
        nextQuantity: 3,
      }),
      expect.objectContaining({
        itemId: "below-actual",
        actualPurchasedQuantity: 3,
        currentQuantity: 5,
        nextQuantity: 2,
      }),
    ]);
    expect(diff.pendingPurchasedQuantityChanges).toEqual([
      expect.objectContaining({
        itemId: "above-actual",
        currentQuantity: 5,
        nextQuantity: 4,
      }),
    ]);
  });

  it("更新保護された購入済み品目は予定数量の確認候補にも入れない", () => {
    const protectedItem = currentItem({
      purchaseStatus: "Purchased",
      protectionLevel: "deletable",
      quantity: 2,
    });

    const diff = createEventUpdateDiff(
      [protectedItem],
      [
        sheetItem({
          price: 1000,
          remarks: "旧シート備考",
          url: "https://old.example",
          rawQuantity: "3",
        }),
      ],
    );

    expect(diff.itemsToUpdate).toEqual([]);
    expect(diff.pendingPurchasedQuantityChanges).toEqual([]);
    expect(diff.protectedFromUpdate).toBe(1);
  });
});

describe("additional rows alone are deduplicated after matching", () => {
  it.each(["", "1", "2"])(
    "stays stable across repeated updates with raw quantity %j",
    (rawQuantity) => {
      const row = sheetItem({ quantity: 1, rawQuantity });
      const input = [row, { ...row }];
      const initial = createEventUpdateDiff([], input);
      expect(initial.itemsToAdd).toHaveLength(1);
      expect(initial.itemsToAdd[0].quantity).toBe(rawQuantity === "2" ? 2 : 1);
      expect(initial.duplicateItemCount).toBe(1);
      let saved = applyEventUpdateToItems([], initial);
      const firstId = saved[0].id;
      for (let repeat = 0; repeat < 3; repeat++) {
        const diff = createEventUpdateDiff(saved, input);
        expect(diff.itemsToAdd).toEqual([]);
        expect(diff.itemsToDelete).toEqual([]);
        expect(diff.duplicateItemCount).toBe(1);
        saved = applyEventUpdateToItems(saved, diff);
        expect(saved).toHaveLength(1);
        expect(saved[0].id).toBe(firstId);
      }
      expect(input.map((item) => item.quantity)).toEqual([1, 1]);
    },
  );

  it("uses evaluated quantities rather than CSV parser placeholders in the complete key", () => {
    const rows = ["", "1", "2"].map((rawQuantity) =>
      sheetItem({ quantity: 1, rawQuantity }),
    );
    const diff = createEventUpdateDiff([], rows);
    expect(diff.itemsToAdd.map((item) => item.quantity)).toEqual([1, 2]);
    expect(diff.duplicateItemCount).toBe(1);
    const existing = currentItem({ quantity: 7 });
    const blankDiff = createEventUpdateDiff([existing], [rows[0], rows[1]]);
    expect(blankDiff.itemsToAdd).toEqual([]);
    expect(blankDiff.duplicateItemCount).toBe(1);
    expect(applyEventUpdateToItems([existing], blankDiff)[0].quantity).toBe(7);
  });

  it.each([0, 1])(
    "does not let invalid quantity rows suppress valid later rows with %s existing IDs",
    (count) => {
      const existing = count ? [currentItem()] : [];
      const rows = ["invalid", "2", "2"].map((rawQuantity) =>
        sheetItem({ quantity: 1, rawQuantity }),
      );
      const diff = createEventUpdateDiff(existing, rows);
      expect(diff.itemsToAdd).toHaveLength(1);
      expect(diff.itemsToAdd[0].quantity).toBe(2);
      expect(diff.duplicateItemCount).toBe(1);
      expect(diff.quantityWarnings).toMatchObject([
        {
          kind: count ? "existing-quantity-not-updated" : "new-item-skipped",
          receivedValue: "invalid",
        },
      ]);
    },
  );

  it("preserves both separate IDs and purchase records for identical matched input", () => {
    const before = [
      currentItem({ purchaseStatus: "Purchased" }),
      currentItem({
        id: "item-2",
        purchaseStatus: "LimitedPurchase",
        limitedPurchasedQuantity: 1,
      }),
    ];
    const row = sheetItem({
      rawQuantity: "",
      price: before[0].price,
      remarks: before[0].remarks,
    });
    const diff = createEventUpdateDiff(before, [row, { ...row }]);
    expect(diff.itemsToAdd).toEqual([]);
    expect(diff.itemsToDelete).toEqual([]);
    expect(diff.duplicateItemCount).toBe(0);
    expect(
      applyEventUpdateToItems(before, diff).map(
        ({ id, purchaseStatus, limitedPurchasedQuantity, price, remarks }) => ({
          id,
          purchaseStatus,
          limitedPurchasedQuantity,
          price,
          remarks,
        }),
      ),
    ).toEqual(
      before.map(
        ({ id, purchaseStatus, limitedPurchasedQuantity, price, remarks }) => ({
          id,
          purchaseStatus,
          limitedPurchasedQuantity,
          price,
          remarks,
        }),
      ),
    );
  });

  it.each(["none", "deletable", "full"] as const)(
    "retains normal reduction and %s protection rules",
    (protectionLevel) => {
      const before = [
        currentItem(),
        currentItem({
          id: "item-2",
          protectionLevel,
          purchaseStatus: "Purchased",
        }),
      ];
      const diff = createEventUpdateDiff(before, [sheetItem()]);
      expect(diff.itemsToDelete.map((item) => item.id)).toEqual(
        protectionLevel === "full" ? [] : ["item-2"],
      );
      expect(diff.protectedFromDelete).toBe(protectionLevel === "full" ? 1 : 0);
      expect(diff.duplicateItemCount).toBe(0);
    },
  );

  it("reports actual accepted, invalid-new, duplicate-addition and missing-field counts separately", () => {
    const rowExclusions = createSheetRowExclusionSummary();
    rowExclusions.excludedCount = 2;
    const rows = ["1", "1", "bad"].map((rawQuantity) =>
      sheetItem({ rawQuantity }),
    );
    const diff = createEventUpdateDiff([], rows, {}, rowExclusions);
    expect(diff.sheetImport).toEqual({ acceptedCount: 1, rowExclusions });
    expect(diff.quantityWarnings).toHaveLength(1);
    expect(diff.duplicateItemCount).toBe(1);
    expect(diff.itemsToAdd).toHaveLength(1);
  });
});
