import { computeUpdateItem } from "./itemOps/crud";
import { createSheetIdentityFingerprint } from "../../utils/sheetIdentity";
import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../../types/item";
import { applyEventUpdateToItems } from "./updateApply";
import { createEventUpdateDiff } from "./updateDiff";
import { getActualPurchasedQuantity } from "../../utils/purchaseQuantity";
import type { EventUpdateDiff, SpreadsheetItemToAdd } from "./updateDiff";

const item = (overrides: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: "item-1",
  circle: "サークルA",
  eventDate: "1日目",
  block: "東A",
  number: "01a",
  title: "旧タイトル",
  price: 900,
  purchaseStatus: "LimitedPurchase",
  quantity: 4,
  limitedPurchasedQuantity: 2,
  remarks: "利用者メモ",
  url: "https://old.example",
  source: "spreadsheet",
  sheetIdentityFingerprint: createSheetIdentityFingerprint(
    1000,
    "旧シート備考",
  ),
  protectionLevel: "none",
  assignedTo: "担当者",
  lastSyncedAt: "2026-01-01",
  orderIndex: 8,
  postponed: true,
  manualHallId: "hall-1",
  ...overrides,
});

const payload = (
  overrides: Partial<
    Pick<
      EventUpdateDiff,
      | "itemsToDelete"
      | "itemsToUpdate"
      | "itemsToAdd"
      | "pendingPurchasedQuantityChanges"
    >
  > = {},
) => ({
  itemsToDelete: [],
  itemsToUpdate: [],
  itemsToAdd: [],
  pendingPurchasedQuantityChanges: [],
  ...overrides,
});

describe("applyEventUpdateToItems allowlist", () => {
  it("同期対象外フィールドと別品目を、更新データに含まれていても変更しない", () => {
    const before = item();
    const untouched = item({ id: "item-2", number: "02a" });
    const hostileUpdate: ShoppingItem = {
      ...before,
      title: "新タイトル",
      quantity: 5,
      price: 1200,
      remarks: "更新した備考",
      url: "https://new.example",
      purchaseStatus: "SoldOut",
      limitedPurchasedQuantity: 99,
      assignedTo: "別担当",
      orderIndex: 99,
      manualHallId: "hall-2",
    };

    const result = applyEventUpdateToItems(
      [before, untouched],
      payload({ itemsToUpdate: [hostileUpdate] }),
    );

    expect(result[0]).toEqual({
      ...before,
      title: "新タイトル",
      quantity: 5,
      price: 1200,
      remarks: "更新した備考",
      url: "https://new.example",
    });
    expect(result[0]).toMatchObject({
      price: 1200,
      remarks: "更新した備考",
      purchaseStatus: "LimitedPurchase",
      limitedPurchasedQuantity: 2,
      assignedTo: "担当者",
      orderIndex: 8,
      manualHallId: "hall-1",
    });
    expect(result[1]).toBe(untouched);
  });

  it("購入済み予定数量は既定で維持し、明示許可時だけ反映する", () => {
    const before = item();
    const updateData = payload({
      pendingPurchasedQuantityChanges: [
        {
          itemId: before.id,
          circle: before.circle,
          eventDate: before.eventDate,
          block: before.block,
          number: before.number,
          title: before.title,
          purchaseStatus: "LimitedPurchase",
          currentQuantity: 4,
          nextQuantity: 5,
        },
      ],
    });

    expect(applyEventUpdateToItems([before], updateData)[0].quantity).toBe(4);

    const applied = applyEventUpdateToItems([before], updateData, {
      applyPurchasedQuantityChanges: true,
    })[0];
    expect(applied.quantity).toBe(5);
    expect(applied.purchaseStatus).toBe("LimitedPurchase");
    expect(applied.limitedPurchasedQuantity).toBe(2);
  });

  it.each([
    [1000, "旧シート備考"],
    [null, ""],
    [0, "ユーザー登録\nエラーが発生しました"],
  ] as const)(
    "保護なしの価格%sと備考を通常更新で反映する",
    (price, remarks) => {
      const before = item({ protectionLevel: "none" });
      const incoming = {
        ...before,
        price,
        remarks,
        sheetIdentityFingerprint: createSheetIdentityFingerprint(
          price,
          remarks,
        ),
        rawQuantity: "",
      };
      const diff = createEventUpdateDiff([before], [incoming]);
      const after = applyEventUpdateToItems([before], diff);
      expect(after[0]).toMatchObject({
        price,
        remarks,
        sheetIdentityFingerprint: incoming.sheetIdentityFingerprint,
        purchaseStatus: before.purchaseStatus,
        limitedPurchasedQuantity: before.limitedPurchasedQuantity,
      });
      expect(after[0]).not.toHaveProperty("catalogPrice");
      expect(after[0]).not.toHaveProperty("sheetRemarks");
      expect(before.price).toBe(900);
      expect(before.remarks).toBe("利用者メモ");
    },
  );

  it.each(["deletable", "full"] as const)(
    "確認後に%sへ保護された品目は、価格・備考・数量を反映しない",
    (protectionLevel) => {
      const before = item({ protectionLevel: "none" });
      const incoming = {
        ...before,
        price: 1200,
        remarks: "新しいシートの備考",
        rawQuantity: "7",
      };
      const diff = createEventUpdateDiff([before], [incoming]);
      const protectedItem = { ...before, protectionLevel };
      expect(
        applyEventUpdateToItems([protectedItem], diff, {
          applyPurchasedQuantityChanges: true,
        }),
      ).toEqual([protectedItem]);
    },
  );
  it("確認後に完全保護された品目は、古い削除候補にも従わない", () => {
    const before = item();
    const diff = createEventUpdateDiff([before], []);
    expect(diff.itemsToDelete).toEqual([before]);
    const protectedItem = { ...before, protectionLevel: "full" as const };
    expect(applyEventUpdateToItems([protectedItem], diff)).toEqual([
      protectedItem,
    ]);
  });
  it.each(["execute", "focus"] as const)(
    "%sで購入状態を変更して既存ロックが付いた後は、現場入力の価格と備考を守る",
    (mode) => {
      const initial = item({
        purchaseStatus: "None",
        limitedPurchasedQuantity: undefined,
      });
      const purchased = computeUpdateItem(
        [initial],
        { ...initial, purchaseStatus: "Purchased" },
        mode,
        initial.protectionLevel,
        initial.source,
      ).items[0];
      const edited = computeUpdateItem(
        [purchased],
        {
          ...purchased,
          price: 700,
          remarks: "ユーザー登録\nエラーが発生しました",
        },
        mode,
        purchased.protectionLevel,
        purchased.source,
      ).items[0];
      expect(edited.protectionLevel).toBe("deletable");
      expect(edited.sheetIdentityFingerprint).toBe(
        initial.sheetIdentityFingerprint,
      );
      const diff = createEventUpdateDiff(
        [edited],
        [
          {
            ...edited,
            price: 1200,
            remarks: "更新したシートの備考",
            sheetIdentityFingerprint: createSheetIdentityFingerprint(
              1200,
              "更新したシートの備考",
            ),
            rawQuantity: "",
          },
        ],
      );
      expect(diff.itemsToUpdate).toEqual([]);
      expect(applyEventUpdateToItems([edited], diff)).toEqual([edited]);
    },
  );
  it("確認中に利用者が数量を変えた場合は、古い確認結果で上書きしない", () => {
    const changedWhileConfirming = item({ quantity: 6 });
    const result = applyEventUpdateToItems(
      [changedWhileConfirming],
      payload({
        pendingPurchasedQuantityChanges: [
          {
            itemId: changedWhileConfirming.id,
            circle: changedWhileConfirming.circle,
            eventDate: changedWhileConfirming.eventDate,
            block: changedWhileConfirming.block,
            number: changedWhileConfirming.number,
            title: changedWhileConfirming.title,
            purchaseStatus: "LimitedPurchase",
            currentQuantity: 4,
            nextQuantity: 5,
          },
        ],
      }),
      { applyPurchasedQuantityChanges: true },
    );

    expect(result[0].quantity).toBe(6);
  });

  it.each([3, 2])(
    "限数の実購入数3以上にならない予定数量%dは明示許可されても反映しない",
    (nextQuantity) => {
      const before = item({
        quantity: 5,
        limitedPurchasedQuantity: 3,
        protectionLevel: "none",
      });
      const result = applyEventUpdateToItems(
        [before],
        payload({
          pendingPurchasedQuantityChanges: [
            {
              itemId: before.id,
              circle: before.circle,
              eventDate: before.eventDate,
              block: before.block,
              number: before.number,
              title: before.title,
              purchaseStatus: "LimitedPurchase",
              currentQuantity: 5,
              nextQuantity,
            },
          ],
        }),
        { applyPurchasedQuantityChanges: true },
      );

      expect(result[0].quantity).toBe(5);
      expect(result[0].limitedPurchasedQuantity).toBe(3);
    },
  );

  it("限数の実購入数3より多い予定数量4は明示許可時に反映する", () => {
    const before = item({
      quantity: 5,
      limitedPurchasedQuantity: 3,
      protectionLevel: "none",
    });
    const result = applyEventUpdateToItems(
      [before],
      payload({
        pendingPurchasedQuantityChanges: [
          {
            itemId: before.id,
            circle: before.circle,
            eventDate: before.eventDate,
            block: before.block,
            number: before.number,
            title: before.title,
            purchaseStatus: "LimitedPurchase",
            currentQuantity: 5,
            nextQuantity: 4,
          },
        ],
      }),
      { applyPurchasedQuantityChanges: true },
    );

    expect(result[0].quantity).toBe(4);
    expect(result[0].limitedPurchasedQuantity).toBe(3);
  });

  it("新規シート品目は単一の価格・備考と内部識別情報を保持する", () => {
    const newItem: SpreadsheetItemToAdd = {
      circle: "サークルB",
      eventDate: "1日目",
      block: "東B",
      number: "03a",
      title: "新刊",
      price: 1300,
      quantity: 2,
      remarks: "シートからの備考",
      sheetIdentityFingerprint: createSheetIdentityFingerprint(
        1300,
        "シートからの備考",
      ),
    };

    const result = applyEventUpdateToItems(
      [],
      payload({ itemsToAdd: [newItem] }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      price: 1300,
      remarks: "シートからの備考",
      purchaseStatus: "None",
      source: "spreadsheet",
      sheetIdentityFingerprint: newItem.sheetIdentityFingerprint,
      protectionLevel: "none",
    });
  });
});

it.each([false, true])(
  "applies quantity consent to the preserved collision IDs, accepted=%s",
  (accepted) => {
    const before = [
      item({
        id: "A",
        circle: "X ",
        title: "旧A",
        purchaseStatus: "Purchased",
        protectionLevel: "none",
        price: 900,
      }),
      item({
        id: "B",
        circle: "X",
        title: "旧B",
        purchaseStatus: "LimitedPurchase",
        protectionLevel: "none",
        price: 1200,
      }),
    ];
    const incoming = [
      { ...before[1], title: "旧A", quantity: 1, rawQuantity: "7" },
      {
        ...before[0],
        circle: "X",
        title: "新A",
        quantity: 1,
        rawQuantity: "8",
      },
    ];
    const diff = createEventUpdateDiff(before, incoming);
    expect(diff.itemsToAdd).toEqual([]);
    expect(diff.itemsToDelete).toEqual([]);
    const after = applyEventUpdateToItems(before, diff, {
      applyPurchasedQuantityChanges: accepted,
    });
    expect(
      after.map(
        ({ id, title, circle, quantity, price, remarks, purchaseStatus }) => ({
          id,
          title,
          circle,
          quantity,
          price,
          remarks,
          purchaseStatus,
        }),
      ),
    ).toEqual([
      {
        id: "A",
        title: "新A",
        circle: "X ",
        quantity: accepted ? 8 : 4,
        price: 900,
        remarks: "利用者メモ",
        purchaseStatus: "Purchased",
      },
      {
        id: "B",
        title: "旧A",
        circle: "X",
        quantity: accepted ? 7 : 4,
        price: 1200,
        remarks: "利用者メモ",
        purchaseStatus: "LimitedPurchase",
      },
    ]);
    expect(after.map(getActualPurchasedQuantity)).toEqual([
      accepted ? 8 : 4,
      2,
    ]);
    expect(
      after.reduce(
        (total, item) =>
          total + (item.price ?? 0) * (getActualPurchasedQuantity(item) ?? 0),
        0,
      ),
    ).toBe(accepted ? 9600 : 6000);
  },
);
