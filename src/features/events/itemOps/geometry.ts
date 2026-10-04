import type { DayMapData, HallDefinition } from "../../../types/map";
import type { ShoppingItem } from "../../../types/item";
import { getHallIdForItem } from "../../../utils/hallGrouping";

export function findItemHallId(
  item: ShoppingItem,
  halls: HallDefinition[],
  mapData: DayMapData | undefined,
): string | null {
  return getHallIdForItem(item, mapData ?? null, halls);
}
export const findItemHallIdByCell = findItemHallId;
