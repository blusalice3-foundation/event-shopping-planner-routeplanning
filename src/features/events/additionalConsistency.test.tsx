// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ShoppingItem } from "../../types/item";
import {
  createEventUpdateDiff,
  type SheetItem,
} from "../../features/events/updateDiff";
import { applyEventUpdateToItems } from "../../features/events/updateApply";
import { parseEventItemsFromCsv } from "../../features/events/sheetImport";
import {
  computeMoveItem,
  computeMoveItemVertical,
} from "../../features/events/itemOps/move";
import { selectItemsForExecutionDay } from "../../app/selectors/appListViewSelectors";
import {
  buildBulkAddItems,
  buildLayoutAppliedEventItems,
} from "../../features/events/bulkAdd";
import { excludeExactDuplicateItems } from "../../features/events/duplicateEvent";
import { getItemKey } from "../../utils/itemComparison";
import ImportScreen from "../../components/ImportScreen";
import { validateSnapshotStructure } from "../../utils/appBackup";
import { createEventConsistency } from "../../types/consistency";

const item = (
  id: string,
  fields: Partial<ShoppingItem> = {},
): ShoppingItem => ({
  id,
  circle: "サークルA",
  eventDate: "1日目",
  block: "A",
  number: "01a",
  title: "本A",
  price: 500,
  catalogPrice: 500,
  quantity: 1,
  remarks: "",
  sheetRemarks: "",
  purchaseStatus: "None",
  source: "spreadsheet",
  sheetIdentityVerified: true,
  protectionLevel: "none",
  ...fields,
});
const sheet = (fields: Partial<SheetItem> = {}): SheetItem => ({
  sheetIdentityVerified: true,
  circle: "サークルA",
  eventDate: "1日目",
  block: "A",
  number: "01a",
  title: "本A",
  price: 500,
  catalogPrice: 500,
  quantity: 1,
  remarks: "",
  sheetRemarks: "",
  ...fields,
});
const csvEscape = (text: string) =>
  /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
const header = Array.from({ length: 27 }, (_, index) =>
  index === 12 ? "サークル名" : `列${index}`,
).join(",");
function csvRow(fields: Partial<SheetItem> = {}, prefix: string[] = []) {
  const record = sheet(fields);
  const cells = Array.from({ length: 27 }, () => "");
  prefix.forEach((text, index) => {
    cells[index] = text;
  });
  cells[12] = record.circle;
  cells[13] = record.eventDate;
  cells[14] = record.block;
  cells[15] = record.number;
  cells[16] = record.title;
  cells[17] = String(record.price ?? "");
  cells[22] = record.remarks;
  cells[24] = record.url ?? "";
  cells[26] = String(record.quantity);
  return cells.map(csvEscape).join(",");
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("additional consistency audit: spreadsheet row identity", () => {
  it("control: an unchanged multi-title spreadsheet keeps both records", () => {
    const current = [item("a"), item("b", { title: "本B" })];
    const result = applyEventUpdateToItems(
      current,
      createEventUpdateDiff(current, [sheet(), sheet({ title: "本B" })]),
    );
    expect(result.map((record) => [record.id, record.title])).toEqual([
      ["a", "本A"],
      ["b", "本B"],
    ]);
  });
  it("control: a unique title rename preserves its ID", () => {
    const current = [item("a")];
    const result = applyEventUpdateToItems(
      current,
      createEventUpdateDiff(current, [sheet({ title: "改題A" })], { "0": "a" }),
    );
    expect(result.map((record) => [record.id, record.title])).toEqual([
      ["a", "改題A"],
    ]);
  });
  it("adding another title at the same space must not overwrite the existing title", () => {
    const current = [item("a", { remarks: "本Aへのメモ" })];
    const diff = createEventUpdateDiff(current, [
      sheet(),
      sheet({ title: "本B", price: 700, catalogPrice: 700 }),
    ]);
    const result = applyEventUpdateToItems(current, diff);
    expect(result.map((record) => record.title)).toEqual(["本A", "本B"]);
  });
  it("removing one title must remove only that title even when the space remains", () => {
    const current = [item("a"), item("b", { title: "本B" })];
    const diff = createEventUpdateDiff(current, [sheet()]);
    const result = applyEventUpdateToItems(current, diff);
    expect(result.map((record) => record.id)).toEqual(["a"]);
  });
});

describe("additional consistency audit: quoted CSV records", () => {
  it("control: a single-line row retains memo, URL, and quantity", () => {
    const parsed = parseEventItemsFromCsv(
      header +
        "\n" +
        csvRow({
          remarks: "取り置き",
          url: "https://example.com/book",
          quantity: 3,
        }),
    );
    expect(parsed[0]).toMatchObject({
      remarks: "取り置き",
      url: "https://example.com/book",
      rawQuantity: "3",
    });
  });
  it("quoted multiline remarks must retain the entire record including trailing columns", () => {
    const parsed = parseEventItemsFromCsv(
      header +
        "\n" +
        csvRow({
          remarks: "取り置き\n午後受取",
          url: "https://example.com/book",
          quantity: 3,
        }),
    );
    expect(parsed[0]).toMatchObject({
      remarks: "取り置き\n午後受取",
      url: "https://example.com/book",
      rawQuantity: "3",
    });
  });
  it("a quoted newline in the circle name must not turn a still-present item into a deletion", () => {
    const circle = "サークルA\n別名";
    const current = [item("a", { circle })];
    const parsed = parseEventItemsFromCsv(header + "\n" + csvRow({ circle }));
    const diff = createEventUpdateDiff(current, parsed);
    expect(diff.itemsToDelete).toHaveLength(0);
    expect(parsed).toHaveLength(1);
  });
});

const mixedDays = () => [
  item("a"),
  item("b", { eventDate: "11日目", number: "02a" }),
  item("c", { number: "03a" }),
];
describe("additional consistency audit: arrow and drag reorder", () => {
  it("control: dragging uses the displayed day only", () => {
    const before = mixedDays();
    const result = computeMoveItem({
      dragId: "c",
      hoverId: "a",
      targetColumn: "candidate",
      mode: "edit",
      effectiveSelectedIds: new Set(),
      allItems: before,
      executeModeItems: { "1日目": [], "11日目": [] },
      dayName: "1日目",
      selectedBlockFilters: new Set(),
    });
    expect(
      selectItemsForExecutionDay(result.eventListItems ?? before, "1日目").map(
        (record) => record.id,
      ),
    ).toEqual(["c", "a"]);
  });
  it("the up arrow must produce the same visible order when another date is interleaved", () => {
    const before = mixedDays();
    const result = computeMoveItemVertical(
      "up",
      "c",
      "candidate",
      "edit",
      new Set(),
      before,
      { "1日目": [], "11日目": [] },
      "1日目",
      () => true,
    );
    const visible = selectItemsForExecutionDay(
      result.eventListItems ?? before,
      "1日目",
    ).map((record) => record.id);
    expect(visible).toEqual(["c", "a"]);
  });
});

it("CSV layout must preserve distinct records with the same identity fields and different prices", () => {
  const incoming = [sheet(), sheet({ price: 700, catalogPrice: 700 })];
  const kept = excludeExactDuplicateItems(incoming, []).items;
  expect(kept).toHaveLength(2);
  const created = buildBulkAddItems(kept, { source: "app" });
  const layout = created.map((record, index) => ({
    sourceRowId: String(index),
    itemKey: getItemKey(record),
    eventDate: record.eventDate,
    columnType: "candidate" as const,
    order: index + 1,
  }));
  const result = buildLayoutAppliedEventItems(
    created,
    layout,
    new Map(created.map((record, index) => [String(index), record.id])),
  );
  const snapshot = {
    eventLists: { event: result.sortedItems },
    eventMetadata: {},
    executeModeItems: {},
    dayModes: {},
    mapData: {},
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallDefinitions: {},
    hallRouteSettings: {},
    eventConsistency: { event: createEventConsistency() },
  };
  expect(validateSnapshotStructure(snapshot)).toEqual([]);
  expect(new Set(result.sortedItems.map((record) => record.id)).size).toBe(2);
  expect(result.sortedItems.map((record) => record.price)).toEqual([500, 700]);
});

async function importGoogleCsv(csv: string) {
  const onBulkAdd = vi.fn(
    async (
      _name: string,
      _items: Omit<ShoppingItem, "id" | "purchaseStatus">[],
    ) => ({ status: "cancelled" as const }),
  );
  vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(csv, { status: 200 })),
  );
  render(
    <ImportScreen
      onBulkAdd={onBulkAdd}
      activeEventName={null}
      itemToEdit={null}
      onUpdateItem={vi.fn()}
      onDoneEditing={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("即売会名"), {
    target: { value: "テストイベント" },
  });
  fireEvent.change(screen.getByLabelText("スプレッドシートURLからインポート"), {
    target: { value: "https://docs.google.com/spreadsheets/d/test/edit" },
  });
  fireEvent.click(screen.getByRole("button", { name: "URLからインポート" }));
  await waitFor(() => expect(onBulkAdd).toHaveBeenCalledTimes(1));
  return onBulkAdd.mock.calls[0][1] as unknown as ShoppingItem[];
}
describe("additional consistency audit: initial import and refresh column selection", () => {
  it("control: initial import uses M onward when A through D are empty", async () => {
    const csv = header + "\n" + csvRow();
    const imported = await importGoogleCsv(csv);
    expect(imported[0]).toMatchObject({
      circle: "サークルA",
      eventDate: "1日目",
      block: "A",
      number: "01a",
    });
  });
  it("URL import must use the same M onward columns as refresh even when A through D contain other values", async () => {
    const csv =
      header + "\n" + csvRow({}, ["集計用サークル", "2日目", "Z", "99"]);
    const imported = await importGoogleCsv(csv);
    const refreshed = parseEventItemsFromCsv(csv);
    expect(imported[0]).toMatchObject({
      circle: refreshed[0].circle,
      eventDate: refreshed[0].eventDate,
      block: refreshed[0].block,
      number: refreshed[0].number,
    });
  });
});
