import type { ShoppingItem } from "../../../types/item";
import type { DayMapData, HallDefinition } from "../../../types/map";
import {
  groupItemsByHallOrder,
  getItemGroupId,
} from "../../../utils/hallGrouping";
import {
  buildExecutionVisitProjectionKey,
  flattenExecutionVisitProjection,
  projectItemsToExecutionVisits,
} from "../../../utils/visitProjection";

export type ShoppingDragColumn = "execute" | "candidate";
export interface ShoppingDragPresentation {
  readonly spaceGroups: boolean;
  readonly hallGroups: boolean;
  readonly halls: HallDefinition[];
  readonly hallOrder: string[];
  readonly map: DayMapData | null;
}
export interface ShoppingDragPlacement {
  readonly boundary: "before" | "after" | "end";
  readonly referenceId?: string;
  readonly referenceKey?: string;
  readonly referenceMemberIds: readonly string[];
  readonly anchorId: string;
  readonly baseVisitKeys: readonly string[];
  readonly insertVisitIndex: number;
  readonly positionedVisitKeys: readonly string[];
  readonly mergeTargetIds: readonly string[];
  readonly mergeVisits: readonly {
    readonly key: string;
    readonly itemIds: readonly string[];
  }[];
  readonly positionedIds: readonly string[];
  readonly presentation: ShoppingDragPresentation;
}
export interface ShoppingDragMoveContext {
  readonly token: symbol;
  readonly eventName: string;
  readonly day: string;
  readonly generation: number;
  readonly sourceColumn: ShoppingDragColumn;
  readonly targetColumn?: ShoppingDragColumn;
  readonly requestedIds: readonly string[];
  readonly effectiveIds: readonly string[];
  readonly sourceVisits: readonly {
    readonly key: string;
    readonly ids: readonly string[];
  }[];
  readonly operation: "single" | "selection" | "space-group";
  readonly isCurrent: () => boolean;
  readonly placement?: ShoppingDragPlacement;
}
export function projectShoppingDragDisplay(
  items: readonly ShoppingItem[],
  presentation: ShoppingDragPresentation,
): ShoppingItem[] {
  const visits = flattenExecutionVisitProjection(items);
  if (presentation.spaceGroups || !presentation.hallGroups) return visits;
  const index = new Map(visits.map((item, position) => [item.id, position]));
  return groupItemsByHallOrder(
    visits,
    presentation.map,
    presentation.halls,
    presentation.hallOrder,
  )
    .sort((a, b) => index.get(a.items[0].id)! - index.get(b.items[0].id)!)
    .flatMap((group) => group.items);
}
export interface ShoppingDragLayout {
  readonly items: readonly ShoppingItem[];
  readonly visits: ReturnType<typeof projectItemsToExecutionVisits>;
  readonly itemsById: ReadonlyMap<string, ShoppingItem>;
  readonly rawIndexById: ReadonlyMap<string, number>;
  readonly bucketPositions: ReadonlyMap<
    string,
    {
      readonly first: number;
      readonly firstRawIndex: number;
      readonly size: number;
      readonly ranks: readonly number[];
      readonly counts: readonly number[];
    }
  >;
  readonly visitsByKey: ReadonlyMap<
    string,
    ReturnType<typeof projectItemsToExecutionVisits>[number]
  >;
  readonly visitBucketTails: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly displayVisitKeys: readonly string[];
  readonly visitBoundaryByItemIndex: readonly number[];
  readonly presentation: ShoppingDragPresentation;
  readonly ranges: ReadonlyMap<
    string,
    { first: number; last: number; contiguous: boolean }
  >;
  readonly buckets: ReadonlyMap<string, { first: number; last: number }>;
}
export function buildShoppingDragLayout(
  items: readonly ShoppingItem[],
  presentation: ShoppingDragPresentation,
): ShoppingDragLayout {
  const display = projectShoppingDragDisplay(items, presentation);
  const rawIndexById = new Map(items.map((item, index) => [item.id, index]));
  const rawVisitFirst = new Map(
    projectItemsToExecutionVisits(items).map((visit) => [
      visit.key,
      visit.firstIndex,
    ]),
  );
  const bucketPositions = new Map<
    string,
    {
      first: number;
      firstRawIndex: number;
      size: number;
      ranks: number[];
      counts: number[];
    }
  >();
  const visitBucketTails = new Map<string, Map<string, string>>();
  const ranges = new Map<
    string,
    { first: number; last: number; contiguous: boolean }
  >();
  const buckets = new Map<string, { first: number; last: number }>();
  display.forEach((item, index) => {
    const key = buildExecutionVisitProjectionKey(item);
    const range = ranges.get(key);
    if (range) {
      range.contiguous &&= range.last === index - 1;
      range.last = index;
    } else ranges.set(key, { first: index, last: index, contiguous: true });
    const bucket = dragBucket(item, presentation);
    let tails = visitBucketTails.get(key);
    if (!tails) {
      tails = new Map();
      visitBucketTails.set(key, tails);
    }
    tails.set(bucket, item.id);
    const rank = rawVisitFirst.get(key)!;
    let position = bucketPositions.get(bucket);
    if (!position) {
      position = {
        first: index,
        firstRawIndex: rank,
        size: 0,
        ranks: [],
        counts: [],
      };
      bucketPositions.set(bucket, position);
    }
    position.size++;
    if (position.ranks.at(-1) === rank)
      position.counts[position.counts.length - 1]++;
    else {
      position.ranks.push(rank);
      position.counts.push(1);
    }
    const existing = buckets.get(bucket);
    if (existing) existing.last = index;
    else buckets.set(bucket, { first: index, last: index });
  });
  const visits = projectItemsToExecutionVisits(display);
  const displayVisitKeys: string[] = [];
  const visitBoundaryByItemIndex: number[] = [];
  display.forEach((item) => {
    const key = buildExecutionVisitProjectionKey(item);
    if (displayVisitKeys.at(-1) !== key) displayVisitKeys.push(key);
    visitBoundaryByItemIndex.push(displayVisitKeys.length - 1);
  });
  visitBoundaryByItemIndex.push(displayVisitKeys.length);
  return {
    items: display,
    visits,
    itemsById: new Map(display.map((item) => [item.id, item])),
    rawIndexById,
    bucketPositions,
    visitsByKey: new Map(visits.map((visit) => [visit.key, visit])),
    visitBucketTails,
    displayVisitKeys,
    visitBoundaryByItemIndex,
    presentation,
    ranges,
    buckets,
  };
}
function dragBucket(
  item: ShoppingItem,
  presentation: ShoppingDragPresentation,
): string {
  return presentation.spaceGroups || !presentation.hallGroups
    ? "all"
    : (getItemGroupId(item, presentation.map, presentation.halls) ??
        "undefined");
}
/** Uses the prepared visit/bucket indexes; pointer movement never projects a snapshot. */
export function resolveShoppingDragPlacement(
  layout: ShoppingDragLayout,
  moving: readonly ShoppingItem[],
  referenceId: string | undefined,
  boundary: "before" | "after" | "end",
): ShoppingDragPlacement | null {
  const movingVisits = projectItemsToExecutionVisits(moving);
  const existingByKey = layout.visitsByKey;
  const merged = movingVisits.filter((visit) => existingByKey.has(visit.key));
  const positioned = movingVisits.filter(
    (visit) => !existingByKey.has(visit.key),
  );
  const mergeTargetIds = new Set<string>();
  for (const visit of merged) {
    const tails = layout.visitBucketTails.get(visit.key)!;
    for (const item of visit.items) {
      const destination = tails.get(dragBucket(item, layout.presentation));
      // A new hall segment would split the existing visit instead of appending to it.
      if (!destination) return null;
      mergeTargetIds.add(destination);
    }
  }
  const reference = referenceId ? layout.itemsById.get(referenceId) : undefined;
  const referenceKey = reference && buildExecutionVisitProjectionKey(reference);
  const range = referenceKey ? layout.ranges.get(referenceKey) : undefined;
  if (
    positioned.length > 0 &&
    boundary !== "end" &&
    (!reference || !range?.contiguous)
  )
    return null;
  const insertionIndex =
    boundary === "end" || positioned.length === 0
      ? layout.items.length
      : boundary === "before"
        ? range!.first
        : range!.last + 1;
  const anchor = layout.items[insertionIndex];
  const rawAnchorIndex = anchor
    ? layout.rawIndexById.get(anchor.id)!
    : layout.rawIndexById.size;
  // Resolve the canonical slot from prepared ranks, including legacy non-contiguous raw members.
  // This checks only the moving visits and indexed hall buckets; full projection remains a drop check.
  let previousBucket: string | undefined;
  const emittedBuckets = new Set<string>();
  for (const visit of positioned) {
    const bucket = dragBucket(visit.items[0], layout.presentation);
    if (
      visit.items.some(
        (item) => dragBucket(item, layout.presentation) !== bucket,
      )
    )
      return null;
    const position = layout.bucketPositions.get(bucket);
    let actualIndex = 0;
    if (position) {
      actualIndex = position.first;
      for (
        let index = 0;
        index < position.ranks.length && position.ranks[index] < rawAnchorIndex;
        index++
      )
        actualIndex += position.counts[index];
    } else {
      layout.bucketPositions.forEach((existing) => {
        if (existing.firstRawIndex < rawAnchorIndex)
          actualIndex += existing.size;
      });
    }
    if (actualIndex !== insertionIndex) return null;
    if (previousBucket !== bucket && emittedBuckets.has(bucket)) return null;
    emittedBuckets.add(bucket);
    previousBucket = bucket;
  }
  const nextItem =
    positioned.length > 0 ? layout.items[insertionIndex] : undefined;
  return {
    boundary,
    referenceId,
    referenceKey,
    referenceMemberIds: referenceKey
      ? (existingByKey.get(referenceKey)?.itemIds ?? [])
      : [],
    anchorId: nextItem?.id ?? "__END_OF_LIST__",
    baseVisitKeys: layout.displayVisitKeys,
    insertVisitIndex: layout.visitBoundaryByItemIndex[insertionIndex],
    positionedVisitKeys: positioned.map((visit) => visit.key),
    mergeVisits: merged.map((visit) => ({
      key: visit.key,
      itemIds: existingByKey.get(visit.key)!.itemIds,
    })),
    mergeTargetIds: [...mergeTargetIds],
    positionedIds: positioned.flatMap((visit) => visit.itemIds),
    presentation: layout.presentation,
  };
}
export function sameDragIds(
  first: readonly string[],
  second: readonly string[],
): boolean {
  const secondIds = new Set(second);
  return (
    first.length === second.length &&
    new Set(first).size === new Set(second).size &&
    first.every((id) => secondIds.has(id))
  );
}
export function validateShoppingDragPlacement(
  placement: ShoppingDragPlacement,
  before: readonly ShoppingItem[],
  after: readonly ShoppingItem[],
): boolean {
  const beforeKeys: string[] = [];
  projectShoppingDragDisplay(before, placement.presentation).forEach((item) => {
    const key = buildExecutionVisitProjectionKey(item);
    if (beforeKeys.at(-1) !== key) beforeKeys.push(key);
  });
  if (
    beforeKeys.length !== placement.baseVisitKeys.length ||
    beforeKeys.some((key, index) => key !== placement.baseVisitKeys[index])
  )
    return false;
  if (placement.positionedVisitKeys.some((key) => beforeKeys.includes(key)))
    return false;
  if (
    placement.mergeVisits.some(
      (visit) =>
        !sameDragIds(
          before
            .filter(
              (item) => buildExecutionVisitProjectionKey(item) === visit.key,
            )
            .map((item) => item.id),
          visit.itemIds,
        ),
    )
  )
    return false;
  if (placement.referenceKey) {
    const reference = before.filter(
      (item) =>
        buildExecutionVisitProjectionKey(item) === placement.referenceKey,
    );
    if (
      !sameDragIds(
        reference.map((item) => item.id),
        placement.referenceMemberIds,
      )
    )
      return false;
  }
  const projected = projectShoppingDragDisplay(after, placement.presentation);
  const actual: string[] = [];
  projected.forEach((item) => {
    const key = buildExecutionVisitProjectionKey(item);
    if (actual.at(-1) !== key) actual.push(key);
  });
  const expected = [...placement.baseVisitKeys];
  expected.splice(
    placement.insertVisitIndex,
    0,
    ...placement.positionedVisitKeys,
  );
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}
