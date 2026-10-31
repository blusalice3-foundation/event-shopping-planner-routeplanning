import { changedItemPositions, registerItemChanges } from "./itemIndex";
import { createMembershipResolver } from "../features/consistency/domain/membership";
import { buildVisitId } from "../features/space-navigation/domain/visitIdentity";
import type { ShoppingItem } from "../types/item";
import type { DayMapData, HallDefinition } from "../types/map";
import {
  projectedMembership,
  encodeHallRef,
} from "../features/consistency/domain/projection";
import {
  buildGroupId,
  groupItemsByHallOrderWithResolver,
} from "./hallGrouping";
import { getSpaceKey } from "./spaceGrouping";
import {
  normalizeExecutionVisitDay,
  projectItemsToExecutionVisits,
  type ProjectedVisit,
} from "./visitProjection";

export interface ExecutionPlacementContext {
  mapData?: DayMapData | null;
  hallDefinitions?: readonly HallDefinition[];
  allItems?: readonly ShoppingItem[];
}

const EMPTY_HALLS: readonly HallDefinition[] = [];
const EMPTY_ORDER: readonly string[] = [];
const legacyResolvers = new WeakMap<
  readonly ShoppingItem[],
  {
    day: string;
    map: DayMapData | null;
    halls: readonly HallDefinition[];
    resolve: ReturnType<typeof createMembershipResolver>;
  }
>();

/** The existing membership resolver is prepared once for a complete raw day. */
function membershipIdentity(
  item: ShoppingItem,
  context: ExecutionPlacementContext,
): readonly unknown[] {
  let membership = projectedMembership(item);
  if (!membership) {
    const halls = context.hallDefinitions ?? EMPTY_HALLS;
    if (!halls.length) return ["confirmed", null];
    const items = context.allItems ?? [item];
    const map = context.mapData ?? null;
    let cached = legacyResolvers.get(items);
    if (
      !cached ||
      cached.day !== item.eventDate ||
      cached.map !== map ||
      cached.halls !== halls
    ) {
      cached = {
        day: item.eventDate,
        map,
        halls,
        resolve: createMembershipResolver({
          items,
          day: item.eventDate,
          map: map
            ? { status: "resolved", key: "", data: map, candidates: [""] }
            : { status: "none", candidates: [] },
          halls: halls.map((definition) => ({
            ref: { kind: "map", mapKey: "", hallId: definition.id },
            definition,
          })),
          context: {
            assignments: Object.fromEntries(
              items
                .filter((member) => member.manualHallId)
                .map((member) => [
                  member.id,
                  { kind: "map", mapKey: "", hallId: member.manualHallId! },
                ]),
            ),
            hallOrder: [],
            hallVisitLists: [],
            route: null,
          },
        }),
      };
      legacyResolvers.set(items, cached);
    }
    membership = cached.resolve(item);
    // Legacy hall IDs already belong to the supplied context; projected IDs are encoded above.
    if (membership.status === "resolved" || membership.status === "unassigned")
      return ["confirmed", membership.hall?.hallId ?? null];
  }
  if (
    membership.status === "confirmation-required" ||
    membership.status === "map-selection-required"
  )
    return [membership.status, membership.sharedKey ?? item.id];
  return ["confirmed", membership.hall ? encodeHallRef(membership.hall) : null];
}

interface PlacementKeys {
  day: string;
  block: string;
  number: string;
  priority: ShoppingItem["priorityLevel"];
  membership: ReturnType<typeof projectedMembership>;
  map: ExecutionPlacementContext["mapData"];
  halls: ExecutionPlacementContext["hallDefinitions"];
  allItems: ExecutionPlacementContext["allItems"];
  confirmed: boolean;
  group: string;
  visit: string;
  navigation: string;
  candidateVisit: string;
}
const placementKeys = new WeakMap<ShoppingItem, PlacementKeys>();
function keysForItem(
  item: ShoppingItem,
  context: ExecutionPlacementContext,
): PlacementKeys {
  const membership = projectedMembership(item);
  const cached = placementKeys.get(item);
  if (
    cached &&
    cached.day === item.eventDate &&
    cached.block === item.block &&
    cached.number === item.number &&
    cached.priority === item.priorityLevel &&
    cached.membership === membership &&
    (membership ||
      (cached.map === context.mapData &&
        cached.halls === context.hallDefinitions &&
        cached.allItems === context.allItems))
  )
    return cached;
  const identity = membershipIdentity(item, context);
  const group = JSON.stringify([
    normalizeExecutionVisitDay(item.eventDate),
    ...identity,
    item.priorityLevel || "none",
  ]);
  const base = buildVisitId(item);
  const navigation =
    identity[0] === "confirmed" && identity[1] === null
      ? base
      : `${base}@placement:${JSON.stringify(identity)}`;
  const candidateVisit = JSON.stringify([
    normalizeExecutionVisitDay(item.eventDate),
    ...identity,
    getSpaceKey(item.block, item.number),
  ]);
  const value = {
    candidateVisit,
    navigation,
    day: item.eventDate,
    block: item.block,
    number: item.number,
    priority: item.priorityLevel,
    membership,
    map: membership ? undefined : context.mapData,
    halls: membership ? undefined : context.hallDefinitions,
    allItems: membership ? undefined : context.allItems,
    confirmed: identity[0] === "confirmed",
    group,
    visit: JSON.stringify([group, getSpaceKey(item.block, item.number)]),
  };
  placementKeys.set(item, value);
  return value;
}

/** Display/movement identities only. Saved visit identities remain unchanged. */
export function buildExecutionPlacementGroupKey(
  item: ShoppingItem,
  context: ExecutionPlacementContext = {},
): string {
  return keysForItem(item, context).group;
}
export function buildExecutionPlacementVisitKey(
  item: ShoppingItem,
  context: ExecutionPlacementContext = {},
): string {
  return keysForItem(item, context).visit;
}
/** Candidate headings retain mixed priorities while separating confirmed memberships. */
export function buildCandidatePlacementVisitKey(
  item: ShoppingItem,
  context: ExecutionPlacementContext = {},
): string {
  return keysForItem(item, context).candidateVisit;
}

export function isSameExecutionPlacementGroup(
  first: ShoppingItem,
  second: ShoppingItem,
  context: ExecutionPlacementContext = {},
): boolean {
  const firstKeys = keysForItem(first, context);
  const secondKeys = keysForItem(second, context);
  return (
    firstKeys.confirmed &&
    secondKeys.confirmed &&
    firstKeys.group === secondKeys.group
  );
}

export function isSameExecutionPlacementVisit(
  first: ShoppingItem,
  second: ShoppingItem,
  context: ExecutionPlacementContext = {},
): boolean {
  return (
    isSameExecutionPlacementGroup(first, second, context) &&
    getSpaceKey(first.block, first.number) ===
      getSpaceKey(second.block, second.number)
  );
}

export function projectExecutionPlacementVisits(
  items: readonly ShoppingItem[],
  context: ExecutionPlacementContext = {},
  hallOrder: readonly string[] = [],
): ProjectedVisit[] {
  const allItems = context.allItems ?? items;
  const resolvedContext = { ...context, allItems };
  const grouped = groupItemsByHallOrderWithResolver(
    [...items],
    [...(context.hallDefinitions ?? [])],
    [...hallOrder],
    (item) => {
      const identity = membershipIdentity(item, resolvedContext);
      const hall =
        identity[0] === "confirmed"
          ? (identity[1] as string | null)
          : `@pending:${JSON.stringify(identity)}`;
      return buildGroupId(hall, item.priorityLevel || "none");
    },
  );
  return grouped.flatMap((group) =>
    projectItemsToExecutionVisits(group.items, (item) =>
      buildExecutionPlacementVisitKey(item, resolvedContext),
    ),
  );
}

export function flattenExecutionPlacementItems(
  items: readonly ShoppingItem[],
  context: ExecutionPlacementContext = {},
  hallOrder: readonly string[] = [],
): ShoppingItem[] {
  return projectExecutionPlacementVisits(items, context, hallOrder).flatMap(
    (visit) => visit.items,
  );
}

/** A group tail immediately before the next group's first row is a valid boundary. */
export function canPlaceExecutionItemsAtBoundary(input: {
  movingItems: readonly ShoppingItem[];
  remainingItems: readonly ShoppingItem[];
  beforeId: string;
  context?: ExecutionPlacementContext;
  hallOrder?: readonly string[];
}): boolean {
  const { movingItems, remainingItems, beforeId, context = {} } = input;
  const first = movingItems[0];
  if (
    !first ||
    !movingItems.every((item) =>
      isSameExecutionPlacementGroup(first, item, context),
    )
  )
    return false;
  if (!remainingItems.length) return beforeId === "__END_OF_LIST__";
  const index =
    beforeId === "__END_OF_LIST__"
      ? remainingItems.length
      : remainingItems.findIndex((item) => item.id === beforeId);
  if (index < 0) return false;
  const previous = remainingItems[index - 1];
  const next = remainingItems[index];
  const previousMatches =
    !!previous && isSameExecutionPlacementGroup(first, previous, context);
  const nextMatches =
    !!next && isSameExecutionPlacementGroup(first, next, context);
  // Reject a boundary inside an unrelated group, including unresolved membership.
  if (!previousMatches && !nextMatches) {
    if (
      remainingItems.some((item) =>
        isSameExecutionPlacementGroup(first, item, context),
      )
    )
      return false;
    return (
      findExecutionPlacementGroupTailAnchor(
        first,
        remainingItems,
        context,
        input.hallOrder,
      ) === beforeId
    );
  }
  if (
    previous &&
    next &&
    isSameExecutionPlacementVisit(previous, next, context)
  )
    return false;
  return true;
}

/** Execution-only anchor identity; focus history keeps its stored visit IDs. */
export function buildExecutionNavigationVisitId(item: ShoppingItem): string {
  return keysForItem(item, {}).navigation;
}

/** Changes book order without moving the visit's base slot or unrelated raw IDs. */
export function applyExecutionBookOrder(
  itemIds: readonly string[],
  orderedBookIds: readonly string[],
): string[] {
  const members = new Set(orderedBookIds);
  let index = 0;
  return itemIds.map((id) => (members.has(id) ? orderedBookIds[index++] : id));
}

/** Returns a raw insertion anchor; reading this function never changes saved order. */
export function findExecutionPlacementGroupTailAnchor(
  item: ShoppingItem,
  existingItems: readonly ShoppingItem[],
  context: ExecutionPlacementContext = {},
  hallOrder: readonly string[] = [],
): string {
  let last = -1;
  existingItems.forEach((existing, index) => {
    if (isSameExecutionPlacementGroup(item, existing, context)) last = index;
  });
  if (last >= 0) return existingItems[last + 1]?.id ?? "__END_OF_LIST__";
  const projected = flattenExecutionPlacementItems(
    [...existingItems, item],
    context,
    hallOrder,
  );
  const index = projected.findIndex((existing) => existing.id === item.id);
  return projected[index + 1]?.id ?? "__END_OF_LIST__";
}

/** Content-only updates retain the prepared group/visit order and touch changed cards. */
export function createExecutionPlacementProjector() {
  let previous: readonly ShoppingItem[] | undefined;
  let previousMap: ExecutionPlacementContext["mapData"];
  let previousHalls: ExecutionPlacementContext["hallDefinitions"];
  let previousAllItems: ExecutionPlacementContext["allItems"];
  let previousOrder: readonly string[] | undefined;
  let allProjected = false;
  let result: ShoppingItem[] = [];
  let positions = new Map<string, number>();
  return (
    items: readonly ShoppingItem[],
    context: ExecutionPlacementContext = {},
    hallOrder: readonly string[] = EMPTY_ORDER,
  ): ShoppingItem[] => {
    const changes = previous ? changedItemPositions(previous, items) : null;
    const halls = context.hallDefinitions ?? EMPTY_HALLS;
    const sameHalls =
      previousHalls === halls ||
      (!!previousHalls &&
        previousHalls.length === halls.length &&
        halls.every((hall, index) => hall === previousHalls![index]));
    const sameOrder =
      previousOrder === hallOrder ||
      (!!previousOrder &&
        previousOrder.length === hallOrder.length &&
        hallOrder.every((id, index) => id === previousOrder![index]));
    const contextSame =
      previousMap === context.mapData &&
      sameHalls &&
      sameOrder &&
      (allProjected || previousAllItems === context.allItems);
    if (previous === items && contextSame) return result;
    if (
      contextSame &&
      changes !== null &&
      changes.every(
        (index) =>
          previous![index].id === items[index].id &&
          buildExecutionPlacementVisitKey(previous![index], context) ===
            buildExecutionPlacementVisitKey(items[index], context),
      )
    ) {
      if (changes.length) {
        const next = result.slice();
        const updated: number[] = [];
        for (const index of changes) {
          const target = positions.get(items[index].id)!;
          next[target] = items[index];
          updated.push(target);
        }
        registerItemChanges(result, next, updated);
        result = next;
      }
    } else {
      result = flattenExecutionPlacementItems(items, context, hallOrder);
      positions = new Map(result.map((item, index) => [item.id, index]));
      allProjected = items.every((item) => !!projectedMembership(item));
    }
    previous = items;
    previousMap = context.mapData;
    previousHalls = halls;
    previousAllItems = context.allItems;
    previousOrder = hallOrder;
    return result;
  };
}
