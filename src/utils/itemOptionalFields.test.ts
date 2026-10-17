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
