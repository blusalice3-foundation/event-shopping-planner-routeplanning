import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../../types/item";
import type { HallDefinition } from "../../../types/map";
import type { HallRef } from "../../../types/consistency";
import { normalizeMapDay, resolveHallDefinition, sameDay } from "./context";
import { mapContextEntries, type ConsistencyChange } from "./migration";

export function reconcileConsistencyReferences(
  source: PersistenceSnapshot,
  clone = true,
): {
  data: PersistenceSnapshot;
  changes: ConsistencyChange[];
} {
  // Planners already own a private snapshot; public callers retain copy isolation.
  const data = clone ? structuredClone(source) : source;
  const changes: ConsistencyChange[] = [];
  const changed = (path: string, message: string) =>
    changes.push({ path, message });
  for (const [eventName, rawItems] of Object.entries(data.eventLists)) {
    const items = new Map(
      (rawItems as ShoppingItem[]).map((item) => [item.id, item]),
    );
    const inDay = (id: string, day: string) => {
      const item = items.get(id);
      return item !== undefined && sameDay(item.eventDate, day);
    };
    for (const [day, ids] of Object.entries(
      data.executeModeItems[eventName] ?? {},
    )) {
      const retained = ids.filter((id) => inDay(id, day));
      if (retained.length !== ids.length) {
        data.executeModeItems[eventName][day] = retained;
        changed(
          `${eventName}.executeModeItems.${day}`,
          "削除済み品目・旧日付への参照を整理します。",
        );
      }
    }
    const event = data.eventConsistency[eventName];
    if (!event) continue;
    const definitions = data.hallDefinitions[eventName] as
      | Record<string, HallDefinition[]>
      | undefined;
    for (const { day, mapKey, context } of mapContextEntries(event)) {
      const path = `${eventName}.${day}.${mapKey ?? "マップなし"}`;
      const validHall = (ref: HallRef) =>
        !!resolveHallDefinition(definitions, ref) &&
        (ref.kind === "simple"
          ? sameDay(ref.dayKey, day)
          : ref.mapKey === mapKey);
      for (const [id, hall] of Object.entries(context.assignments)) {
        if (!inDay(id, day) || !validHall(hall)) {
          delete context.assignments[id];
          changed(
            `${path}.assignments.${id}`,
            "無効なホール指定を解除します。",
          );
        }
      }
      const order = context.hallOrder.filter(
        (group) => group.hall === null || validHall(group.hall),
      );
      if (order.length !== context.hallOrder.length)
        changed(
          `${path}.hallOrder`,
          "存在しないホールへの巡回参照を整理します。",
        );
      context.hallOrder = order;
      const lists = context.hallVisitLists;
      context.hallVisitLists = lists
        .filter(
          (list) => list.group.hall === null || validHall(list.group.hall),
        )
        .map((list) => ({
          ...list,
          itemIds: list.itemIds.filter((id) => inDay(id, day)),
        }))
        .filter(
          (list, index) =>
            list.itemIds.length > 0 ||
            lists.filter(
              (value) =>
                value.group.hall === null || validHall(value.group.hall),
            )[index].itemIds.length === 0,
        );
      if (JSON.stringify(lists) !== JSON.stringify(context.hallVisitLists))
        changed(`${path}.hallVisitLists`, "訪問品目の無効な参照を整理します。");
      if (context.route) {
        const points = context.route.visitOrder;
        context.route.visitOrder = points
          .map((point) => ({
            ...point,
            itemIds: point.itemIds.filter((id) => inDay(id, day)),
          }))
          .filter(
            (point, index) =>
              point.itemIds.length > 0 || points[index].itemIds.length === 0,
          );
        if (JSON.stringify(points) !== JSON.stringify(context.route.visitOrder))
          changed(`${path}.route`, "経路の無効な参照を整理します。");
      }
    }
  }
  return { data, changes };
}
export function validateConsistencyReferences(
  data: PersistenceSnapshot,
): string[] {
  const errors: string[] = [];
  for (const [eventName, event] of Object.entries(data.eventConsistency)) {
    if (!Object.prototype.hasOwnProperty.call(data.eventLists, eventName)) {
      errors.push(`eventConsistency.${eventName}: 存在しないイベントです`);
      continue;
    }
    const items = new Map(
      (data.eventLists[eventName] as ShoppingItem[]).map((item) => [
        item.id,
        item,
      ]),
    );
    const definitions = data.hallDefinitions[eventName] as
      | Record<string, HallDefinition[]>
      | undefined;
    for (const { day, mapKey, context } of mapContextEntries(event)) {
      const path = `eventConsistency.${eventName}.days.${day}.${mapKey ?? "mapless"}`;
      if (
        mapKey !== null &&
        (!Object.prototype.hasOwnProperty.call(
          data.mapData[eventName] ?? {},
          mapKey,
        ) ||
          normalizeMapDay(mapKey) !== normalizeMapDay(day))
      )
        errors.push(`${path}: 存在しない対象マップです`);
      const ref = (hall: HallRef | null) => {
        if (
          hall &&
          (!resolveHallDefinition(definitions, hall) ||
            (hall.kind === "map"
              ? hall.mapKey !== mapKey
              : !sameDay(hall.dayKey, day)))
        )
          errors.push(`${path}: ホール参照が不正です`);
      };
      const item = (id: string) => {
        const value = items.get(id);
        if (!value || !sameDay(value.eventDate, day))
          errors.push(`${path}: 品目「${id}」の日付参照が不正です`);
      };
      for (const [id, hall] of Object.entries(context.assignments)) {
        item(id);
        ref(hall);
      }
      context.hallOrder.forEach((group) => ref(group.hall));
      context.hallVisitLists.forEach((list) => {
        ref(list.group.hall);
        list.itemIds.forEach(item);
      });
      context.route?.visitOrder.forEach((point) => point.itemIds.forEach(item));
    }
  }
  for (const eventName of Object.keys(data.eventLists))
    if (!Object.prototype.hasOwnProperty.call(data.eventConsistency, eventName))
      errors.push(
        `eventConsistency.${eventName}: 必須のイベント設定がありません`,
      );
  return errors;
}
