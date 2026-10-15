import type { DayMapData } from "../types/map";
import type { ShoppingItem } from "../types/item";
import { createLocationResolver } from "../features/consistency/domain/membership";
import { normalizeExecutionVisitDay } from "./visitProjection";
import { areMapRouteGroupKeysCompatible } from "./hallGrouping";
import type { MapRoutePoint } from "./mapRoutePoints";

export interface ValidateMapSmartInsertParams {
  anchorItemId: string;
  pendingItemIds: string[];
  routePoints: MapRoutePoint[];
}

export type MapSmartInsertValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "anchor-not-found" | "pending-not-found" | "group-mismatch";
      message: string;
    };

export function validateMapSmartInsert(
  params: ValidateMapSmartInsertParams,
): MapSmartInsertValidationResult {
  const pointByItemId = new Map(
    params.routePoints.map((point) => [point.itemId, point]),
  );
  const anchorPoint = pointByItemId.get(params.anchorItemId);
  if (!anchorPoint) {
    return {
      ok: false,
      reason: "anchor-not-found",
      message:
        "選択した基準アイテムがルート上にありません。別のルート線または番号を選んでください。",
    };
  }

  const pendingGroupKeys: Array<string | null> = [];
  for (const itemId of params.pendingItemIds) {
    const point = pointByItemId.get(itemId);
    if (!point) {
      return {
        ok: false,
        reason: "pending-not-found",
        message:
          "追加対象が現在表示中のマップ上にありません。別の追加方法を選んでください。",
      };
    }
    pendingGroupKeys.push(point.groupKey);
  }

  if (!areMapRouteGroupKeysCompatible(anchorPoint.groupKey, pendingGroupKeys)) {
    return {
      ok: false,
      reason: "group-mismatch",
      message:
        "選択した位置は追加対象とホールまたは優先度が異なります。別のルート線または番号を選んでください。",
    };
  }

  return { ok: true };
}

/** Use the same map and location resolution for every insertion entry point. */
export function createNearbyVisitSelector(map: DayMapData) {
  const resolve = createLocationResolver(map);
  const blockKey = (block: DayMapData["blocks"][number]) =>
    JSON.stringify([
      block.name,
      block.startRow,
      block.startCol,
      block.endRow,
      block.endCol,
    ]);
  return (
    item: ShoppingItem,
    ids: readonly string[],
    items: ReadonlyMap<string, ShoppingItem>,
  ) => {
    const location = resolve(item);
    if (location.status !== "resolved") return [];
    const key = blockKey(location.location.block);
    const result: Array<{ item: ShoppingItem; visitIndex: number }> = [];
    ids.forEach((id, visitIndex) => {
      const existing = items.get(id);
      if (
        !existing ||
        normalizeExecutionVisitDay(existing.eventDate) !==
          normalizeExecutionVisitDay(item.eventDate)
      )
        return;
      const other = resolve(existing);
      if (
        other.status === "resolved" &&
        blockKey(other.location.block) === key &&
        Math.abs(other.location.numberValue - location.location.numberValue) <=
          3
      )
        result.push({ item: existing, visitIndex });
    });
    return result;
  };
}
