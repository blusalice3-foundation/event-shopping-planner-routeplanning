import type {
  ItemContentEdit,
  ItemContentGuard,
  PersistenceSnapshot,
} from "../app/ports/PersistenceCommandPort";
import type { ShoppingItem } from "../types/item";
import { indexedItem } from "./itemIndex";
import { ownValue } from "./ownRecord";
import {
  buildExecutionVisitProjectionKey,
  normalizeExecutionVisitDay,
} from "./visitProjection";
import {
  resolveDayKey,
  resolveDayMap,
} from "../features/consistency/domain/context";
import type { DayMapData } from "../types/map";
import type { HallVisitListV1 } from "../types/consistency";

const generations = new WeakMap<object, Readonly<Record<string, number>>>();
export function registerItemGuardGenerations(
  snapshot: PersistenceSnapshot,
  value: Readonly<Record<string, number>>,
) {
  generations.set(snapshot.eventConsistency, value);
}
export function inheritItemGuardGenerations(
  source: PersistenceSnapshot,
  next: PersistenceSnapshot,
) {
  const value = generations.get(source.eventConsistency);
  if (value) registerItemGuardGenerations(next, value);
  return next;
}
const executeSets = new WeakMap<readonly string[], ReadonlySet<string>>();
function executionIds(
  snapshot: PersistenceSnapshot,
  event: string,
  day: string,
): ReadonlySet<string> | undefined {
  const days = ownValue(snapshot.executeModeItems, event);
  const key = resolveDayKey(days, day);
  if (key.status !== "resolved") return undefined;
  const ids = days![key.key];
  let set = executeSets.get(ids);
  if (!set) executeSets.set(ids, (set = new Set(ids)));
  return set;
}
const visitGroups = new WeakMap<
  readonly HallVisitListV1[],
  ReadonlyMap<string, readonly string[]>
>();
function groupsForItem(
  lists: readonly HallVisitListV1[],
  itemId: string,
): readonly string[] | undefined {
  let index = visitGroups.get(lists);
  if (!index) {
    const next = new Map<string, string[]>();
    for (const list of lists) {
      const group = JSON.stringify(list.group);
      for (const id of list.itemIds) {
        const groups = next.get(id) ?? [];
        groups.push(group);
        next.set(id, groups);
      }
    }
    visitGroups.set(lists, (index = next));
  }
  return index.get(itemId);
}
function mapContext(
  snapshot: PersistenceSnapshot,
  event: string,
  day: string,
  itemId: string,
): string {
  const days = ownValue(snapshot.eventConsistency, event)?.days;
  const resolution = resolveDayKey(days, day);
  if (resolution.status === "ambiguous")
    return JSON.stringify(["ambiguous", resolution.keys]);
  const consistency =
    resolution.status === "resolved"
      ? ownValue(days, resolution.key)
      : undefined;
  const map = resolveDayMap(
    ownValue(snapshot.mapData, event) as Record<string, DayMapData> | undefined,
    day,
    consistency?.selectedMapKey,
  );
  const context =
    map.status === "resolved"
      ? ownValue(consistency?.maps, map.key)
      : consistency?.mapless;
  return JSON.stringify([
    map.status,
    map.status === "resolved" ? map.key : map.candidates,
    ownValue(context?.assignments, itemId) ?? null,
    context ? (groupsForItem(context.hallVisitLists, itemId) ?? null) : null,
  ]);
}
export function createItemContentGuard(
  snapshot: PersistenceSnapshot,
  event: string,
  item: ShoppingItem,
  kind: ItemContentGuard["kind"],
  eventGeneration: number,
): ItemContentGuard {
  return {
    kind,
    operationId: crypto.randomUUID(),
    itemId: item.id,
    eventName: event,
    day: normalizeExecutionVisitDay(item.eventDate),
    eventGeneration,
    requireExecute:
      kind === "limited-focus" ||
      (kind === "limited-list" &&
        !!executionIds(snapshot, event, item.eventDate)?.has(item.id)),
    ...(kind === "limited-single"
      ? {}
      : {
          visitKey: buildExecutionVisitProjectionKey(item),
          mapContext: mapContext(snapshot, event, item.eventDate, item.id),
        }),
  };
}
export function requiresItemContentGuard(edit: ItemContentEdit): boolean {
  return (
    edit.operationKind === "limited-input" ||
    !!edit.guard ||
    edit.limitedPurchase !== undefined
  );
}
export function itemContentGuardFailure(
  snapshot: PersistenceSnapshot,
  edit: ItemContentEdit,
): string | undefined {
  if (!requiresItemContentGuard(edit)) return undefined;
  const guard = edit.guard;
  if (
    !guard ||
    !["limited-single", "limited-list", "limited-focus"].includes(guard.kind) ||
    typeof guard.operationId !== "string" ||
    !guard.operationId ||
    typeof guard.day !== "string" ||
    !Number.isSafeInteger(guard.eventGeneration) ||
    guard.eventGeneration < 0 ||
    typeof guard.requireExecute !== "boolean" ||
    guard.eventName !== edit.eventName ||
    guard.itemId !== edit.itemId ||
    (guard.visitKey !== undefined && typeof guard.visitKey !== "string") ||
    (guard.mapContext !== undefined && typeof guard.mapContext !== "string") ||
    (guard.kind === "limited-focus" && !guard.requireExecute) ||
    (guard.kind !== "limited-single" &&
      (!guard.visitKey || guard.mapContext === undefined))
  )
    return "限数入力の対象条件を確認できません。";
  if (
    resolveDayKey(
      ownValue(snapshot.eventConsistency, edit.eventName)?.days,
      guard.day,
    ).status === "ambiguous"
  )
    return "同じ日付の保存先を確認してください。";
  const currentGenerations = generations.get(snapshot.eventConsistency);
  if (
    !currentGenerations ||
    (ownValue(currentGenerations, edit.eventName) ?? 0) !==
      guard.eventGeneration
  )
    return "イベントが置換・改名・削除されました。";
  const items = ownValue(snapshot.eventLists, edit.eventName) as
    | ShoppingItem[]
    | undefined;
  const item = items && indexedItem(items, edit.itemId);
  if (!item) return "品目が削除されました。";
  if (normalizeExecutionVisitDay(item.eventDate) !== guard.day)
    return "参加日が変更されました。";
  if (
    guard.visitKey !== undefined &&
    buildExecutionVisitProjectionKey(item) !== guard.visitKey
  )
    return "訪問先が変更されました。";
  if (
    guard.requireExecute &&
    !executionIds(snapshot, edit.eventName, guard.day)?.has(item.id)
  )
    return "実行列から外されました。";
  if (
    guard.mapContext !== undefined &&
    mapContext(snapshot, edit.eventName, guard.day, item.id) !==
      guard.mapContext
  )
    return "利用マップが変更されました。";
  return undefined;
}
const guards = new WeakMap<ShoppingItem, ItemContentGuard>();
export function rememberItemUpdateGuard(
  item: ShoppingItem,
  guard: ItemContentGuard,
) {
  guards.set(item, guard);
  return item;
}
export const itemUpdateGuard = (item: ShoppingItem) => guards.get(item);
export function sameItemGuardTarget(
  first: ItemContentGuard,
  second: ItemContentGuard,
): boolean {
  return (
    first.itemId === second.itemId &&
    first.eventName === second.eventName &&
    first.eventGeneration === second.eventGeneration &&
    first.day === second.day &&
    first.visitKey === second.visitKey &&
    first.requireExecute === second.requireExecute &&
    first.mapContext === second.mapContext
  );
}
