import type { ShoppingItem } from "../types/item";
import {
  changedItemPositions,
  itemPositions,
  registerItemChanges,
} from "./itemIndex";
import {
  buildExecutionVisitProjectionKey,
  projectItemsToExecutionVisits,
  type ProjectedVisit,
} from "./visitProjection";
import {
  getPlannedBudgetQuantity,
  getSafePriceForCalculation,
  isCountedAsPurchased,
} from "./purchaseQuantity";
export const sameItemRouting = (
  before: ShoppingItem,
  after: ShoppingItem,
): boolean =>
  before.id === after.id &&
  before.eventDate === after.eventDate &&
  before.block === after.block &&
  before.number === after.number &&
  before.priorityLevel === after.priorityLevel &&
  before.manualHallId === after.manualHallId;
const remaining = (item: ShoppingItem) =>
  ["None", "Postpone", "Late"].includes(item.purchaseStatus)
    ? getSafePriceForCalculation(item.price) * getPlannedBudgetQuantity(item)
    : 0;
export interface ExecutionVisitIndex {
  visits: ProjectedVisit[];
  itemMembership: ReadonlyMap<
    string,
    { visitIndex: number; itemIndex: number }
  >;
  visitsByKey: ReadonlyMap<string, ProjectedVisit>;
  remainingCost: number;
  purchasedCount: number;
  postponedItemIds: Set<string>;
  lateItemIds: Set<string>;
  routingItems: ShoppingItem[];
  updatedVisitCount: number;
}
/** Shared by execution and focus. Content edits keep visit order and member IDs. */
export function createExecutionVisitIndex(
  keyForItem: (item: ShoppingItem) => string = buildExecutionVisitProjectionKey,
) {
  let previous: ShoppingItem[] | undefined;
  let value: ExecutionVisitIndex | undefined;
  return (items: ShoppingItem[]): ExecutionVisitIndex => {
    if (items === previous) return value!;
    const changed = previous ? changedItemPositions(previous, items) : null;
    if (
      !value ||
      changed === null ||
      changed.some((index) => !sameItemRouting(previous![index], items[index]))
    ) {
      const visits = projectItemsToExecutionVisits(items, keyForItem);
      const membership = new Map<
        string,
        { visitIndex: number; itemIndex: number }
      >();
      visits.forEach((visit, visitIndex) =>
        visit.items.forEach((item, itemIndex) =>
          membership.set(item.id, { visitIndex, itemIndex }),
        ),
      );
      value = {
        visits,
        visitsByKey: new Map(visits.map((visit) => [visit.key, visit])),
        itemMembership: membership,
        remainingCost: 0,
        purchasedCount: 0,
        postponedItemIds: new Set(),
        lateItemIds: new Set(),
        routingItems: items,
        updatedVisitCount: visits.length,
      };
      for (const item of items) {
        value.remainingCost += remaining(item);
        value.purchasedCount += Number(isCountedAsPurchased(item));
        if (item.purchaseStatus === "Postpone")
          value.postponedItemIds.add(item.id);
        if (item.purchaseStatus === "Late") value.lateItemIds.add(item.id);
      }
    } else if (changed.length) {
      const visits = value.visits.slice();
      const updates = new Map<number, number[]>();
      let postponed = value.postponedItemIds;
      let late = value.lateItemIds;
      let cost = value.remainingCost;
      let purchased = value.purchasedCount;
      for (const index of changed) {
        const before = previous![index];
        const after = items[index];
        cost += remaining(after) - remaining(before);
        purchased +=
          Number(isCountedAsPurchased(after)) -
          Number(isCountedAsPurchased(before));
        if (
          (before.purchaseStatus === "Postpone") !==
          (after.purchaseStatus === "Postpone")
        ) {
          if (postponed === value.postponedItemIds)
            postponed = new Set(postponed);
          if (after.purchaseStatus === "Postpone") postponed.add(after.id);
          else postponed.delete(after.id);
        }
        if (
          (before.purchaseStatus === "Late") !==
          (after.purchaseStatus === "Late")
        ) {
          if (late === value.lateItemIds) late = new Set(late);
          if (after.purchaseStatus === "Late") late.add(after.id);
          else late.delete(after.id);
        }
        const location = value.itemMembership.get(after.id)!;
        let indices = updates.get(location.visitIndex);
        if (!indices) {
          indices = [];
          updates.set(location.visitIndex, indices);
          visits[location.visitIndex] = {
            ...visits[location.visitIndex],
            items: visits[location.visitIndex].items.slice(),
          };
        }
        visits[location.visitIndex].items[location.itemIndex] = after;
        indices.push(location.itemIndex);
      }
      for (const [index, indices] of updates)
        registerItemChanges(
          value.visits[index].items,
          visits[index].items,
          indices,
        );
      registerItemChanges(value.visits, visits, [...updates.keys()]);
      const visitsByKey = new Map(value.visitsByKey);
      for (const index of updates.keys())
        visitsByKey.set(visits[index].key, visits[index]);
      value = {
        ...value,
        visits,
        visitsByKey,
        remainingCost: cost,
        purchasedCount: purchased,
        postponedItemIds: postponed,
        lateItemIds: late,
        updatedVisitCount: updates.size,
      };
    }
    previous = items;
    return value!;
  };
}
/** Fixed phase membership remains fixed; only changed visits are filtered again. */
export function createPhaseVisitProjector(filterItems = true) {
  let previous: ProjectedVisit[] | undefined;
  let previousIds: ReadonlySet<string> | undefined;
  let result: ProjectedVisit[] = [];
  let membership = new Map<string, string>();
  let projected = new Map<string, ProjectedVisit | null>();
  return (
    visits: ProjectedVisit[],
    ids: ReadonlySet<string>,
  ): ProjectedVisit[] => {
    if (previous === visits && previousIds === ids) return result;
    const changes = previous ? changedItemPositions(previous, visits) : null;
    const changedKeys = new Set<string>();
    if (changes === null) {
      membership = new Map();
      projected = new Map();
      for (const source of visits) {
        for (const id of source.itemIds) membership.set(id, source.key);
        changedKeys.add(source.key);
      }
    } else {
      for (const index of changes) changedKeys.add(visits[index].key);
      if (previousIds !== ids) {
        for (const id of previousIds ?? [])
          if (!ids.has(id)) {
            const key = membership.get(id);
            if (key) changedKeys.add(key);
          }
        for (const id of ids)
          if (!previousIds?.has(id)) {
            const key = membership.get(id);
            if (key) changedKeys.add(key);
          }
      }
    }
    const positions = itemPositions(visits);
    let next = changes === null ? ([] as ProjectedVisit[]) : result;
    for (const key of changedKeys) {
      const source = visits[positions.get(key)!];
      const items = source.items.filter((item) => ids.has(item.id));
      const visit = items.length
        ? filterItems
          ? { ...source, items, itemIds: items.map((item) => item.id) }
          : source
        : null;
      projected.set(key, visit);
    }
    if (changes === null)
      next = visits.flatMap((source) => {
        const visit = projected.get(source.key);
        return visit ? [visit] : [];
      });
    else if (changedKeys.size) {
      const oldPositions = itemPositions(result);
      const membershipChanged = [...changedKeys].some(
        (key) => oldPositions.has(key) !== !!projected.get(key),
      );
      if (membershipChanged) {
        // Reconcile order from the cached membership, without testing other members.
        next = visits.flatMap((source) => {
          const visit = projected.get(source.key);
          return visit ? [visit] : [];
        });
      } else {
        const updated: number[] = [];
        for (const key of changedKeys) {
          const index = oldPositions.get(key),
            visit = projected.get(key);
          if (index === undefined || !visit || result[index] === visit)
            continue;
          if (next === result) next = result.slice();
          next[index] = visit;
          updated.push(index);
        }
        registerItemChanges(result, next, updated);
      }
    }
    result = next;
    previous = visits;
    previousIds = ids;
    return result;
  };
}
/** Keep geometry input stable across price, quantity, remarks and status edits. */
export function createRoutingItemsProjector() {
  let previous: ShoppingItem[] | undefined;
  let result: ShoppingItem[];
  return (items: ShoppingItem[]) => {
    const changes = previous ? changedItemPositions(previous, items) : null;
    if (
      changes === null ||
      changes.some((index) => !sameItemRouting(previous![index], items[index]))
    )
      result = items;
    previous = items;
    return result!;
  };
}
