import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../../../types/item";
import { buildListRows } from "../model/buildListRows";
import {
  createShoppingListControllerState,
  shoppingListCommand,
  shoppingListControllerReducer,
} from "./listController";

const item = (id: string): ShoppingItem => ({
  id,
  circle: `サークル${id}`,
  eventDate: "1日目",
  block: "東A",
  number: id,
  title: "",
  price: null,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "",
});

describe("shoppingListControllerReducer", () => {
  it("coordinates selection, focus, and scroll requests against canonical rows", () => {
    const model = buildListRows({ items: [item("1"), item("2")] });
    let state = createShoppingListControllerState(["missing", "1"]);

    state = shoppingListControllerReducer(
      model,
      state,
      shoppingListCommand.reconcileModel(),
    );
    expect(state.selectedItemIds).toEqual(["1"]);

    state = shoppingListControllerReducer(
      model,
      state,
      shoppingListCommand.toggleSelection("2"),
    );
    expect(state.selectedItemIds).toEqual(["1", "2"]);

    const secondRowKey = model.itemRows[1].rowKey;
    state = shoppingListControllerReducer(
      model,
      state,
      shoppingListCommand.focusRow(secondRowKey),
    );
    state = shoppingListControllerReducer(
      model,
      state,
      shoppingListCommand.requestScroll(secondRowKey, "center"),
    );
    expect(state.focusedRowKey).toBe(secondRowKey);
    expect(state.scrollRequest).toEqual({
      requestId: 1,
      rowKey: secondRowKey,
      alignment: "center",
    });

    state = shoppingListControllerReducer(
      model,
      state,
      shoppingListCommand.consumeScroll(1),
    );
    expect(state.scrollRequest).toBeNull();
  });

  it("does not target missing items or rows", () => {
    const model = buildListRows({ items: [item("1")] });
    const state = createShoppingListControllerState();

    expect(
      shoppingListControllerReducer(
        model,
        state,
        shoppingListCommand.toggleSelection("missing"),
      ),
    ).toBe(state);
    expect(
      shoppingListControllerReducer(
        model,
        state,
        shoppingListCommand.focusRow("missing"),
      ),
    ).toBe(state);
    expect(
      shoppingListControllerReducer(model, state, {
        type: "unknown-command",
      } as never),
    ).toBe(state);
  });

  it("preserves state identity for no-op external synchronization", () => {
    const model = buildListRows({ items: [item("1"), item("2")] });
    const state = createShoppingListControllerState(["2", "1"]);

    expect(
      shoppingListControllerReducer(
        model,
        state,
        shoppingListCommand.replaceSelection(["1", "missing", "2"]),
      ),
    ).toBe(state);
    expect(
      shoppingListControllerReducer(
        model,
        state,
        shoppingListCommand.focusRow(null),
      ),
    ).toBe(state);
    expect(
      shoppingListControllerReducer(
        model,
        state,
        shoppingListCommand.reconcileModel(),
      ),
    ).toBe(state);
  });
});

describe("shoppingListControllerReducer range selection", () => {
  const model = buildListRows({
    items: [item("1"), item("2"), item("3"), item("4")],
  });
  const targets = ["1", "2", "3"];

  it.each([{ itemIds: [] }, { itemIds: ["missing"] }])(
    "keeps state identity when a range contains no available targets: $itemIds",
    ({ itemIds }) => {
      const state = createShoppingListControllerState(["4"]);
      expect(
        shoppingListControllerReducer(
          model,
          state,
          shoppingListCommand.toggleRangeSelection(itemIds),
        ),
      ).toBe(state);
    },
  );

  it.each([
    { selected: ["4"], expected: ["4", "1", "2", "3"] },
    { selected: ["4", "2"], expected: ["4", "2", "1", "3"] },
    { selected: ["4", "1", "2", "3"], expected: ["4"] },
  ])(
    "toggles the full range from $selected and preserves outside selection",
    ({ selected, expected }) => {
      const state = {
        ...createShoppingListControllerState(selected),
        focusedRowKey: model.itemRows[3].rowKey,
        scrollRequest: {
          requestId: 1,
          rowKey: model.itemRows[3].rowKey,
          alignment: "center" as const,
        },
        nextRequestId: 2,
      };
      const next = shoppingListControllerReducer(
        model,
        state,
        shoppingListCommand.toggleRangeSelection(targets),
      );
      expect(next.selectedItemIds).toEqual(expected);
      expect(next.focusedRowKey).toBe(state.focusedRowKey);
      expect(next.scrollRequest).toBe(state.scrollRequest);
      expect(next.nextRequestId).toBe(state.nextRequestId);
      expect(state.selectedItemIds).toEqual(selected);
    },
  );

  it("filters unavailable and duplicate targets before deciding whether to select or clear", () => {
    const initial = createShoppingListControllerState(["4"]);
    const command = shoppingListCommand.toggleRangeSelection([
      "1",
      "missing",
      "1",
      "3",
    ]);
    const selected = shoppingListControllerReducer(model, initial, command);
    expect(selected.selectedItemIds).toEqual(["4", "1", "3"]);
    const cleared = shoppingListControllerReducer(model, selected, command);
    expect(cleared.selectedItemIds).toEqual(["4"]);
  });

  it("uses the latest reducer state for two rapid range toggles without an external synchronization", () => {
    const initial = createShoppingListControllerState(["4"]);
    const command = shoppingListCommand.toggleRangeSelection(targets);
    const selected = shoppingListControllerReducer(model, initial, command);
    const cleared = shoppingListControllerReducer(model, selected, command);

    expect(selected.selectedItemIds).toEqual(["4", "1", "2", "3"]);
    expect(cleared).toEqual(initial);
  });
});
