import type { PersistenceSnapshot } from "../app/ports/PersistenceCommandPort";
import type { DayModeState, ShoppingItem } from "../types/item";
import { createEventConsistency } from "../types/consistency";

export const SHEET_EVENT = "取込互換検証";
export const sheetItem = (index = 0): ShoppingItem => ({
  id: `item-${index}`,
  circle: `サークル${index}`,
  eventDate: "1日目",
  block: "A",
  number: String(index),
  title: `新刊${index}`,
  price: 500,
  catalogPrice: 500,
  quantity: 2,
  remarks: "ユーザー登録",
  sheetRemarks: "ユーザー登録",
  sheetIdentityVerified: true,
  purchaseStatus: "None",
  source: "spreadsheet",
  protectionLevel: "none",
});
type SheetFixtureSnapshot = Omit<
  PersistenceSnapshot,
  "eventLists" | "dayModes"
> & {
  eventLists: Record<string, ShoppingItem[]>;
  dayModes: Record<string, DayModeState>;
};
export function sheetSnapshot(count = 2): SheetFixtureSnapshot {
  const items = Array.from({ length: count }, (_, index) => sheetItem(index));
  return {
    eventLists: { [SHEET_EVENT]: items },
    eventConsistency: { [SHEET_EVENT]: createEventConsistency() },
    eventMetadata: {},
    executeModeItems: {
      [SHEET_EVENT]: { "1日目": items.map((item) => item.id) },
    },
    dayModes: { [SHEET_EVENT]: { "1日目": "edit" } },
    mapData: {},
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallDefinitions: {},
    hallRouteSettings: {},
  };
}
export function sheetCsv(
  count: number,
  kind: "normal" | "mixed" | "excluded" = "normal",
  format: "google" | "legacy" = "google",
): string {
  const offset = format === "google" ? 12 : 0;
  const encode = (cells: string[]) =>
    cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",");
  const header = Array<string>(offset)
    .fill("")
    .concat(["サークル名", "参加日", "ブロック", "番号", "タイトル", "価格"]);
  return [
    encode(header),
    ...Array.from({ length: count }, (_, index) => {
      const item = sheetItem(index);
      const cells = Array<string>(format === "google" ? 27 : 12).fill("");
      [
        item.circle,
        item.eventDate,
        item.block,
        item.number,
        item.title,
        "500",
      ].forEach((value, column) => {
        cells[offset + column] = value;
      });
      cells[format === "google" ? 22 : 8] = item.remarks;
      cells[format === "google" ? 26 : 6] = "2";
      if (kind === "excluded" || (kind === "mixed" && index % 4 === 0))
        cells[offset + 2] = "　";
      return encode(cells);
    }),
  ].join("\n");
}
