import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../../types/item";
import type { ItemContentEdit } from "../ports/PersistenceCommandPort";
import { emptyApplicationSnapshot } from "./useApplicationSnapshot";
import { createEventConsistency } from "../../types/consistency";
import { applyItemContentEdits } from "./itemContentEdits";
import { planItemContentMutation } from "./itemFieldMutation";
import {
  createItemContentGuard,
  registerItemGuardGenerations,
} from "../../utils/itemContentGuard";
import { buildLimitedPurchaseDialogUpdate } from "../../utils/limitedPurchaseIntent";
import {
  itemUpdateBaseline,
  itemExplicitFields,
} from "../../utils/itemUpdateBaseline";
import { createAppBackup, parseAppBackup } from "../../utils/appBackup";
const item: ShoppingItem = {
  id: "target",
  circle: "ユーザー登録",
  title: "本",
  eventDate: "1日目",
  block: "A",
  number: "01a",
  price: 500,
  remarks: "エラーが発生しました",
  quantity: 5,
  purchaseStatus: "None",
};
function source() {
  const snapshot = {
    ...emptyApplicationSnapshot(),
    eventLists: { event: [item] },
    eventConsistency: { event: createEventConsistency() },
    executeModeItems: { event: { "1日目": [item.id] } },
  };
  registerItemGuardGenerations(snapshot, { event: 3 });
  return snapshot;
}
function limited(snapshot = source()): ItemContentEdit {
  return {
    eventName: "event",
    itemId: item.id,
    baseline: item as unknown as Record<string, unknown>,
    operationKind: "limited-input",
    guard: createItemContentGuard(snapshot, "event", item, "limited-focus", 3),
    fields: {
      purchaseStatus: { present: true, value: "LimitedPurchase" },
      limitedPurchasedQuantity: { present: true, value: 1 },
    },
  };
}
describe("guarded accepted input", () => {
  it.each(["date", "visit", "execution", "generation", "delete"])(
    "excludes only invalid limited fields from plans, display and JSON: %s",
    (change) => {
      const snapshot = source(),
        guarded = limited(snapshot);
      const current = structuredClone(snapshot);
      if (change === "date") current.eventLists.event[0].eventDate = "2日目";
      if (change === "visit") current.eventLists.event[0].number = "02a";
      if (change === "execution") current.executeModeItems.event["1日目"] = [];
      if (change === "delete") current.eventLists.event = [];
      registerItemGuardGenerations(current, {
        event: change === "generation" ? 4 : 3,
      });
      const memo: ItemContentEdit = {
        eventName: "event",
        itemId: item.id,
        baseline: item as unknown as Record<string, unknown>,
        fields: { remarks: { present: true, value: "保持するメモ" } },
      };
      const edits = change === "delete" ? [guarded] : [guarded, memo];
      const display = applyItemContentEdits(current, edits);
      const plan = planItemContentMutation(current, edits);
      expect(plan.confirmation?.title).toBe("対象外になった限数入力を確認");
      if (change === "delete") {
        expect(plan.skipCommit).toBe(true);
        expect(display.eventLists.event).toEqual([]);
      } else {
        expect(display.eventLists.event[0]).toMatchObject({
          purchaseStatus: "None",
          remarks: "保持するメモ",
        });
        expect(plan.snapshot.eventLists.event[0]).toMatchObject({
          purchaseStatus: "None",
          remarks: "保持するメモ",
        });
        expect(display.eventLists.event[0]).not.toHaveProperty(
          "limitedPurchasedQuantity",
        );
        const backup = parseAppBackup(createAppBackup(display));
        expect(backup.ok).toBe(true);
        if (backup.ok)
          expect(backup.data.eventLists.event[0]).toMatchObject({
            remarks: "保持するメモ",
            purchaseStatus: "None",
          });
      }
    },
  );
  it("keeps a single candidate input valid without execution or map conditions", () => {
    const snapshot = source();
    snapshot.executeModeItems.event["1日目"] = [];
    const edit = {
      ...limited(snapshot),
      guard: createItemContentGuard(
        snapshot,
        "event",
        item,
        "limited-single",
        3,
      ),
    };
    expect(
      planItemContentMutation(snapshot, [edit]).confirmation,
    ).toBeUndefined();
    expect(
      applyItemContentEdits(snapshot, [edit]).eventLists.event[0],
    ).toMatchObject({
      purchaseStatus: "LimitedPurchase",
      limitedPurchasedQuantity: 1,
    });
  });
  it("validates the limited-input protocol at runtime and does not write a malformed request", () => {
    const snapshot = source();
    const edit = { ...limited(snapshot), guard: undefined };
    expect(planItemContentMutation(snapshot, [edit]).skipCommit).toBe(true);
    expect(applyItemContentEdits(snapshot, [edit])).toBe(snapshot);
  });
  it("confirms each explicitly edited field against its own starting value", () => {
    const snapshot = source();
    snapshot.eventLists.event[0] = {
      ...item,
      remarks: "他タブのメモ",
      price: 700,
    };
    const memo: ItemContentEdit = {
      eventName: "event",
      itemId: item.id,
      baseline: { remarks: item.remarks },
      fields: { remarks: { present: true, value: "今回のメモ" } },
    };
    const price: ItemContentEdit = {
      eventName: "event",
      itemId: item.id,
      baseline: { price: 700 },
      fields: { price: { present: true, value: 900 } },
    };
    const plan = planItemContentMutation(snapshot, [memo, price]);
    expect(plan.confirmation?.details).toHaveLength(1);
    expect(plan.confirmation?.details[0]).toContain("メモ");
    expect(plan.snapshot.eventLists.event[0]).toMatchObject({
      remarks: "今回のメモ",
      price: 900,
    });
  });
});
describe("planned quantity intent", () => {
  it("keeps a newer unedited plan and the entered actual count", () => {
    expect(
      buildLimitedPurchaseDialogUpdate(
        { ...item, quantity: 9 },
        {
          kind: "limited",
          actual: 1,
          planned: 5,
          plannedEdited: false,
          baselinePlanned: 5,
        },
      ),
    ).toMatchObject({ quantity: 9, limitedPurchasedQuantity: 1 });
  });
  it("reconfirms changed purchase meaning rather than claiming the new planned amount was bought", () => {
    expect(
      buildLimitedPurchaseDialogUpdate(
        { ...item, quantity: 9 },
        {
          kind: "purchased",
          actual: 5,
          planned: 5,
          plannedEdited: false,
          baselinePlanned: 5,
          observedPlanned: 5,
        },
      ),
    ).toBeNull();
  });
  it("retains an explicit edit back to the starting quantity as intent", () => {
    const result = buildLimitedPurchaseDialogUpdate(
      { ...item, quantity: 9 },
      {
        kind: "limited",
        actual: 1,
        planned: 5,
        plannedEdited: true,
        baselinePlanned: 5,
      },
    );
    expect(result?.quantity).toBe(5);
    expect(itemUpdateBaseline(result!)?.quantity).toBe(5);
    expect(itemExplicitFields(result!)).toContain("quantity");
  });
});

it("invalidates a bulk input when its formal hall assignment changes, while retaining an independent memo", () => {
  const snapshot = source();
  snapshot.eventConsistency.event.days["1日目"] = {
    selectedMapKey: null,
    maps: {},
    mapless: {
      assignments: {},
      hallOrder: [],
      hallVisitLists: [],
      route: null,
    },
  };
  const guarded = limited(snapshot);
  const current = structuredClone(snapshot);
  current.eventConsistency.event.days["1日目"].mapless!.assignments[item.id] = {
    kind: "simple",
    dayKey: "1日目",
    hallId: "new",
  };
  registerItemGuardGenerations(current, { event: 3 });
  const memo: ItemContentEdit = {
    eventName: "event",
    itemId: item.id,
    baseline: item as unknown as Record<string, unknown>,
    fields: { remarks: { present: true, value: "保持するメモ" } },
  };
  expect(
    planItemContentMutation(current, [guarded, memo]).confirmation?.title,
  ).toBe("対象外になった限数入力を確認");
  expect(
    applyItemContentEdits(current, [guarded, memo]).eventLists.event[0],
  ).toMatchObject({ remarks: "保持するメモ", purchaseStatus: "None" });
});
