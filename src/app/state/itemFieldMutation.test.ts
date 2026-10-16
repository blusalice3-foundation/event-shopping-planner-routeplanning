import { describe, expect, it } from "vitest";
import { createEventConsistency } from "../../types/consistency";
import type {
  ItemContentEdit,
  PersistenceSnapshot,
} from "../ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../types/item";
import { applyItemContentEdits } from "./itemContentEdits";
import { planItemContentMutation } from "./itemFieldMutation";
import {
  createItemContentGuard,
  registerItemGuardGenerations,
} from "../../utils/itemContentGuard";
const item: ShoppingItem = {
  id: "1",
  circle: "ユーザー登録",
  title: "新刊",
  eventDate: "1日目",
  block: "A",
  number: "1",
  price: 500,
  quantity: 2,
  purchaseStatus: "None",
  remarks: "",
  source: "spreadsheet",
  protectionLevel: "none",
};
const snapshot = (): PersistenceSnapshot => ({
  eventLists: {
    event: [item, { ...item, id: "2" }],
    past: [{ ...item, id: "past" }],
  },
  eventConsistency: {
    event: createEventConsistency(),
    past: createEventConsistency(),
  },
  eventMetadata: {},
  executeModeItems: {},
  dayModes: { event: { "1日目": "execute" } },
  mapData: {},
  mapRotationSettings: {},
  mapViewportSettings: {},
  routeSettings: {},
  hallDefinitions: {},
  hallRouteSettings: {},
});
const edit = (field: string, value: unknown): ItemContentEdit => ({
  eventName: "event",
  itemId: "1",
  baseline: item as unknown as Record<string, unknown>,
  fields: { [field]: { present: value !== undefined, value } },
});
describe("targeted item fields", () => {
  it("retains other event/item references and promotes protection after normalization", () => {
    const base = snapshot();
    const next = planItemContentMutation(base, [edit("quantity", 7)]).snapshot;
    expect(next.eventLists.past).toBe(base.eventLists.past);
    expect(next.eventLists.event[1]).toBe(base.eventLists.event[1]);
    expect(next.mapData).toBe(base.mapData);
    expect(next.eventLists.event[0]).toMatchObject({
      quantity: 7,
      protectionLevel: "deletable",
    });
    expect(base.eventLists.event[0]).toEqual(item);
  });
  it("merges unrelated remote fields and reviews conflicting fields", () => {
    const base = snapshot();
    base.eventLists.event[0] = { ...item, price: 900, remarks: "他タブ" };
    const merged = planItemContentMutation(base, [edit("quantity", 5)]);
    expect(merged.confirmation).toBeUndefined();
    expect(merged.snapshot.eventLists.event[0]).toMatchObject({
      quantity: 5,
      remarks: "他タブ",
      price: 900,
    });
    expect(
      planItemContentMutation(base, [edit("remarks", "エラーが発生しました")])
        .confirmation?.title,
    ).toContain("競合");
  });
  it("rejects deleted targets and evaluates sequential limited quantities", () => {
    const base = snapshot();
    expect(() =>
      planItemContentMutation(base, [
        { ...edit("price", 800), itemId: "deleted" },
      ]),
    ).toThrow();
    const next = planItemContentMutation(base, [
      edit("purchaseStatus", "LimitedPurchase"),
      edit("limitedPurchasedQuantity", 1),
    ]).snapshot;
    expect(next.eventLists.event[0]).toMatchObject({
      purchaseStatus: "LimitedPurchase",
      limitedPurchasedQuantity: 1,
    });
  });
});

describe("limited purchase quantities changed before persistence", () => {
  it.each([
    [5, 5, "purchased", 9, "LimitedPurchase", 5, true],
    [5, 3, "limited", 2, "Purchased", undefined, true],
    [5, 5, "purchased", 3, "Purchased", undefined, true],
    [5, 1, "limited", 9, "LimitedPurchase", 1, false],
  ] as const)(
    "revalidates planned %i / actual %i (%s) against %i",
    (planned, actual, kind, latest, status, savedActual, review) => {
      const baseline = { ...item, quantity: planned };
      const base = snapshot();
      base.eventLists.event[0] = {
        ...baseline,
        quantity: latest,
        remarks: "他タブのメモ",
      };
      registerItemGuardGenerations(base, { event: 0 });
      const intent: ItemContentEdit = {
        guard: createItemContentGuard(
          base,
          "event",
          baseline,
          "limited-single",
          0,
        ),
        ...edit(
          "purchaseStatus",
          kind === "purchased" ? "Purchased" : "LimitedPurchase",
        ),
        baseline,
        limitedPurchase: {
          kind,
          actual,
          planned,
          plannedEdited: false,
          observedPlanned: planned,
        },
        fields: {
          purchaseStatus: {
            present: true,
            value: kind === "purchased" ? "Purchased" : "LimitedPurchase",
          },
          ...(kind === "limited"
            ? { limitedPurchasedQuantity: { present: true, value: actual } }
            : {}),
        },
      };
      const displayed = applyItemContentEdits(base, [intent]);
      expect(displayed.eventLists.event[0]).toMatchObject({
        quantity: latest,
        purchaseStatus: status,
      });
      expect(
        (displayed.eventLists.event[0] as ShoppingItem)
          .limitedPurchasedQuantity,
      ).toBe(savedActual);
      const plan = planItemContentMutation(base, [intent]);
      expect(Boolean(plan.confirmation)).toBe(review);
      expect(plan.snapshot.eventLists.event[0]).toMatchObject({
        quantity: latest,
        purchaseStatus: status,
        remarks: "他タブのメモ",
      });
      expect(
        (plan.snapshot.eventLists.event[0] as ShoppingItem)
          .limitedPurchasedQuantity,
      ).toBe(savedActual);
      expect(plan.itemContentEdits[0].limitedPurchase).toMatchObject({
        actual,
      });
      if (review)
        expect(plan.confirmation?.details.join("\n")).toContain(`${actual}個`);
    },
  );
});
