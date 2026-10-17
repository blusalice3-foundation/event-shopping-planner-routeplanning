import { describe, expect, it } from "vitest";
import {
  normalizeItemOptionalFields,
  normalizeItemsOptionalFields,
  normalizeSnapshotItemOptionalFields,
} from "./itemOptionalFields";
import {
  sheetItem,
  sheetSnapshot,
  SHEET_EVENT,
} from "../test/sheetImportOptionalUrlFixtures";
import { validateSnapshotStructure } from "./appBackup";

describe("item optional field normalization", () => {
  it.each([undefined, "", " 　\t\r\n"])(
    "omits an empty URL (%s) without changing the input",
    (url) => {
      const item = Object.freeze({ ...sheetItem(), url });
      const result = normalizeItemOptionalFields(item);
      expect(Object.prototype.hasOwnProperty.call(result, "url")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(item, "url")).toBe(true);
      expect(normalizeItemOptionalFields(result)).toBe(result);
    },
  );
  it.each([null, 1, [], {}, " https://example.test/path "])(
    "keeps nonempty and malformed values visible (%s)",
    (url) => {
      const item = { ...sheetItem(), url };
      expect(normalizeItemOptionalFields(item)).toBe(item);
      const data = sheetSnapshot();
      Object.assign(data.eventLists[SHEET_EVENT][0], { url });
      expect(
        validateSnapshotStructure(data).some((error) => error.includes("url")),
      ).toBe(typeof url !== "string");
    },
  );
  it("only removes known undefined keys and preserves all other values and future fields", () => {
    const item = {
      ...sheetItem(),
      catalogPrice: null,
      limitedPurchasedQuantity: undefined,
      sheetRemarks: "",
      sheetIdentityVerified: undefined,
      priorityLevel: undefined,
      protectionLevel: undefined,
      source: undefined,
      assignedTo: "",
      lastSyncedAt: undefined,
      orderIndex: 0,
      postponed: false,
      manualHallId: undefined,
      future: undefined,
      id: undefined,
    };
    const result = normalizeItemOptionalFields(item);
    expect(result).toMatchObject({
      catalogPrice: null,
      sheetRemarks: "",
      assignedTo: "",
      orderIndex: 0,
      postponed: false,
    });
    expect(Object.prototype.hasOwnProperty.call(result, "future")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, "id")).toBe(true);
    for (const key of [
      "limitedPurchasedQuantity",
      "sheetIdentityVerified",
      "priorityLevel",
      "protectionLevel",
      "source",
      "lastSyncedAt",
      "manualHallId",
    ])
      expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(false);
  });
  it("reuses canonical branches, preserves frozen inputs and copies only a changed branch", () => {
    const canonical = sheetItem();
    const items = [canonical];
    expect(normalizeItemsOptionalFields(items)).toBe(items);
    const source = sheetSnapshot();
    source.eventLists.other = items;
    source.eventLists[SHEET_EVENT][0] = Object.freeze({
      ...sheetItem(),
      url: "",
    });
    Object.freeze(source.eventLists[SHEET_EVENT]);
    Object.freeze(source.eventLists);
    Object.freeze(source);
    const result = normalizeSnapshotItemOptionalFields(source);
    expect(result).not.toBe(source);
    expect(result.eventLists.other).toBe(items);
    expect(result.eventLists[SHEET_EVENT][1]).toBe(
      source.eventLists[SHEET_EVENT][1],
    );
    expect(result.mapData).toBe(source.mapData);
    expect(normalizeSnapshotItemOptionalFields(result)).toBe(result);
  });
  it("does not inspect unchanged events when normalizing a replanned operation", () => {
    const source = sheetSnapshot();
    const historical = [sheetItem(4)];
    source.eventLists.history = historical;
    const read = () => {
      throw new Error("Unrelated event was inspected");
    };
    Object.defineProperty(historical, "forEach", { get: read });
    const next = {
      ...source,
      eventLists: {
        ...source.eventLists,
        [SHEET_EVENT]: [
          ...source.eventLists[SHEET_EVENT],
          { ...sheetItem(2), url: undefined },
        ],
      },
    };
    expect(
      normalizeSnapshotItemOptionalFields(next, source).eventLists.history,
    ).toBe(historical);
  });
  it("skips optional-key checks for 500 reordered or deleted unchanged items, including replay", () => {
    let optionalKeyChecks = 0;
    const optionalKeys = new Set([
      "catalogPrice",
      "limitedPurchasedQuantity",
      "sheetRemarks",
      "sheetIdentityVerified",
      "url",
      "priorityLevel",
      "protectionLevel",
      "source",
      "assignedTo",
      "lastSyncedAt",
      "orderIndex",
      "postponed",
      "manualHallId",
    ]);
    const items = Array.from(
      { length: 500 },
      (_, index) =>
        new Proxy(Object.freeze(sheetItem(index)), {
          getOwnPropertyDescriptor(target, key) {
            if (typeof key === "string" && optionalKeys.has(key))
              optionalKeyChecks++;
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        }),
    );
    const reordered = [...items].reverse();
    for (let replay = 0; replay < 3; replay++) {
      expect(normalizeItemsOptionalFields(reordered, items)).toBe(reordered);
      const afterDeletion = reordered.slice(1);
      expect(normalizeItemsOptionalFields(afterDeletion, items)).toBe(
        afterDeletion,
      );
    }
    expect(optionalKeyChecks).toBe(0);
  });
  it("checks only replacement and added items after a reorder and does not cache obsolete values", () => {
    const reads: Record<string, number> = {};
    const observed = (index: number, url: string) => {
      const item = {
        ...sheetItem(index),
        url,
        futureOptionalField: { preserved: true },
      };
      return new Proxy(item, {
        get(target, key, receiver) {
          if (key === "url") reads[target.id] = (reads[target.id] ?? 0) + 1;
          return Reflect.get(target, key, receiver);
        },
      });
    };
    const items = Array.from({ length: 500 }, (_, index) =>
      observed(index, "https://example.test"),
    );
    const replacement = observed(250, "  ");
    const added = observed(500, "");
    const next = [...items].reverse();
    next[249] = replacement;
    next.push(added);
    const normalized = normalizeItemsOptionalFields(next, items);
    expect(Object.keys(reads).sort()).toEqual(["item-250", "item-500"]);
    expect(normalized[249]).not.toHaveProperty("url");
    expect(normalized[500]).not.toHaveProperty("url");
    expect(normalized[249].futureOptionalField).toBe(
      replacement.futureOptionalField,
    );
    expect(normalized[0]).toBe(items[499]);
    replacement.url = "https://example.test/changed";
    const replayed = normalizeItemsOptionalFields(next, items);
    expect(replayed[249]).toBe(replacement);
    expect(replayed[249].url).toBe("https://example.test/changed");
    expect(items[250].url).toBe("https://example.test");
  });
  it.each([
    null,
    [],
    { eventLists: [] },
    { eventLists: { bad: null } },
    { eventLists: { bad: [null, 4, []] } },
  ])("leaves malformed structure for validation", (data) => {
    expect(normalizeSnapshotItemOptionalFields(data)).toBe(data);
  });
});
