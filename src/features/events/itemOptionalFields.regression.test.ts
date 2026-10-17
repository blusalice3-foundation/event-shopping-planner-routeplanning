import { describe, expect, it } from "vitest";
import { buildBulkAddItems } from "./bulkAdd";
import { computeAddItemFromFocusMode, computeUpdateItem } from "./itemOps/crud";
import { createEventUpdateDiff } from "./updateDiff";
import { applyEventUpdateToItems } from "./updateApply";
import { validateSnapshotStructure } from "../../utils/appBackup";
import {
  SHEET_EVENT,
  sheetItem,
  sheetSnapshot,
} from "../../test/sheetImportOptionalUrlFixtures";

describe("completed item optional fields", () => {
  it("saves manual and focus additions without a URL and leaves incomplete manual locations valid", () => {
    const {
      id: _id,
      purchaseStatus: _status,
      ...input
    } = {
      ...sheetItem(),
      block: "",
      number: "",
      url: undefined,
      assignedTo: undefined,
    };
    const bulk = buildBulkAddItems([input], { source: "app" });
    const focus = computeAddItemFromFocusMode(
      [],
      { ...input, purchaseStatus: "None" },
      {},
    );
    for (const item of [bulk[0], focus.items[0]]) {
      expect(Object.prototype.hasOwnProperty.call(item, "url")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(item, "assignedTo")).toBe(
        false,
      );
      const snapshot = sheetSnapshot(0);
      snapshot.eventLists[SHEET_EVENT] = [item];
      expect(validateSnapshotStructure(snapshot)).toEqual([]);
    }
    expect(input).toHaveProperty("url");
  });
  it("clears an existing URL after applying the edit and preserves unrelated item references", () => {
    const original = { ...sheetItem(), url: "https://existing.test" };
    const other = sheetItem(1);
    const edit = { ...original, url: "　 " };
    const result = computeUpdateItem(
      [original, other],
      edit,
      "edit",
      "none",
      "spreadsheet",
    );
    expect(Object.prototype.hasOwnProperty.call(result.items[0], "url")).toBe(
      false,
    );
    expect(result.items[1]).toBe(other);
    expect(original.url).toBe("https://existing.test");
    expect(
      computeUpdateItem(
        [original],
        { ...original, remarks: "更新" },
        "edit",
        "none",
        "spreadsheet",
      ).items[0].url,
    ).toBe(original.url);
  });
  it("normalizes both sheet update candidates and applied items while keeping purchase records", () => {
    const original = {
      ...sheetItem(),
      url: "https://existing.test",
      purchaseStatus: "Purchased" as const,
      price: 700,
      remarks: "利用者メモ",
    };
    const incoming = {
      ...sheetItem(),
      url: undefined,
      sheetIdentityVerified: undefined,
      title: "改訂版",
    };
    const diff = createEventUpdateDiff([original], [incoming], {
      "0": original.id,
    });
    expect(diff.itemsToUpdate).toHaveLength(1);
    for (const item of [
      diff.itemsToUpdate[0],
      applyEventUpdateToItems([original], diff)[0],
    ]) {
      expect(Object.prototype.hasOwnProperty.call(item, "url")).toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(item, "sheetIdentityVerified"),
      ).toBe(false);
      expect(item).toMatchObject({
        id: original.id,
        purchaseStatus: "Purchased",
        price: 700,
        remarks: "利用者メモ",
        quantity: 2,
      });
    }
  });
  it("does not introduce a URL change into an ordinary purchase or quantity edit", () => {
    const original = sheetItem();
    const result = computeUpdateItem(
      [original],
      { ...original, purchaseStatus: "Purchased", quantity: 3 },
      "execute",
      "none",
      "spreadsheet",
    );
    expect(Object.prototype.hasOwnProperty.call(result.items[0], "url")).toBe(
      false,
    );
    expect(result.items[0].protectionLevel).toBe("deletable");
  });
});
