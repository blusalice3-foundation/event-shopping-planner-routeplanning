import type { ShoppingItem } from "../../../types/item";
import type { DayMapData, HallDefinition } from "../../../types/map";
import {
  projectItemsToExecutionVisits,
  type ProjectedVisit,
} from "../../../utils/visitProjection";
import {
  buildExecutionPlacementGroupKey,
  isSameExecutionPlacementGroup,
  buildExecutionPlacementVisitKey,
  flattenExecutionPlacementItems,
  projectExecutionPlacementVisits,
  type ExecutionPlacementContext,
} from "../../../utils/executionPlacement";

export type ShoppingDragColumn = "execute" | "candidate";
export interface ShoppingDragPresentation {
  readonly spaceGroups: boolean;
  readonly hallGroups: boolean;
  readonly halls: HallDefinition[];
  readonly hallOrder: string[];
  readonly map: DayMapData | null;
  /** Complete membership peers across both columns; the UI supplies its projected event items. */
  readonly allItems?: readonly ShoppingItem[];
}
export interface ShoppingDragPlacement {
  readonly kind?: "items";
  readonly expectedItemIds?: readonly string[];
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
  /** Separate canonical slots used only when dropping into a column's blank area. */
  readonly columnVisitKeys?: readonly string[];
  readonly hallTailReferences?: readonly {
    readonly key: string;
    readonly itemIds: readonly string[];
  }[];
  readonly hallTailInsertions?: readonly {
    readonly anchorId: string;
    readonly insertVisitIndex: number;
    readonly visitKeys: readonly string[];
    readonly itemIds: readonly string[];
  }[];
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
export const shoppingPlacementContext = (
  presentation: ShoppingDragPresentation,
  fallbackItems?: readonly ShoppingItem[],
): ExecutionPlacementContext => ({
  mapData: presentation.map,
  hallDefinitions: presentation.halls,
  allItems: presentation.allItems ?? fallbackItems,
});

export function projectShoppingDragDisplay(
  items: readonly ShoppingItem[],
  presentation: ShoppingDragPresentation,
): ShoppingItem[] {
  return flattenExecutionPlacementItems(
    items,
    shoppingPlacementContext(presentation, items),
    presentation.hallOrder,
  );
}
export interface ShoppingDragLayout {
  readonly context: ExecutionPlacementContext;
  readonly rawItems: readonly ShoppingItem[];
  readonly items: readonly ShoppingItem[];
  readonly visits: ProjectedVisit[];
  readonly itemsById: ReadonlyMap<string, ShoppingItem>;
  readonly rawIndexById: ReadonlyMap<string, number>;
  readonly visitInitialRawEnd: ReadonlyMap<string, number>;
  readonly visitsByKey: ReadonlyMap<string, ProjectedVisit>;
  readonly displayVisitKeys: readonly string[];
  readonly visitBoundaryByItemIndex: readonly number[];
  readonly presentation: ShoppingDragPresentation;
  readonly absentGroupSlots: Map<string, number>;
  readonly ranges: ReadonlyMap<
    string,
    { first: number; last: number; contiguous: boolean }
  >;
  readonly buckets: ReadonlyMap<string, { first: number; last: number }>;
}
export function buildShoppingDragLayout(
  items: readonly ShoppingItem[],
  presentation: ShoppingDragPresentation,
  displayItems?: readonly ShoppingItem[],
): ShoppingDragLayout {
  const context = shoppingPlacementContext(presentation, items);
  const preparedPresentation = presentation.allItems
    ? presentation
    : { ...presentation, allItems: items };
  const visits = displayItems
    ? projectItemsToExecutionVisits(displayItems, (item) =>
        buildExecutionPlacementVisitKey(item, context),
      )
    : projectExecutionPlacementVisits(items, context, presentation.hallOrder);
  const display = visits.flatMap((visit) => visit.items);
  const ranges = new Map<
    string,
    { first: number; last: number; contiguous: boolean }
  >();
  const buckets = new Map<string, { first: number; last: number }>();
  const boundaries: number[] = [];
  visits.forEach((visit, visitIndex) => {
    const first = boundaries.length;
    visit.items.forEach((item) => {
      boundaries.push(visitIndex);
      const group = buildExecutionPlacementGroupKey(item, context);
      const bucket = buckets.get(group);
      if (bucket) bucket.last = boundaries.length - 1;
      else
        buckets.set(group, {
          first: boundaries.length - 1,
          last: boundaries.length - 1,
        });
    });
    ranges.set(visit.key, {
      first,
      last: boundaries.length - 1,
      contiguous: true,
    });
  });
  boundaries.push(visits.length);
  const rawIndexById = new Map(items.map((item, index) => [item.id, index]));
  const visitInitialRawEnd = new Map<string, number>();
  for (const visit of visits) {
    let end = rawIndexById.get(visit.itemIds[0])! + 1;
    while (
      end < items.length &&
      buildExecutionPlacementVisitKey(items[end], context) === visit.key
    )
      end++;
    visitInitialRawEnd.set(visit.key, end);
  }
  return {
    context,
    rawItems: items,
    items: display,
    visits,
    itemsById: new Map(display.map((item) => [item.id, item])),
    rawIndexById,
    visitInitialRawEnd,
    visitsByKey: new Map(visits.map((visit) => [visit.key, visit])),
    displayVisitKeys: visits.map((visit) => visit.key),
    visitBoundaryByItemIndex: boundaries,
    presentation: preparedPresentation,
    absentGroupSlots: new Map(),
    ranges,
    buckets,
  };
}
export function shoppingDragHasSingleGroup(
  moving: readonly ShoppingItem[],
  presentation: ShoppingDragPresentation,
  context = shoppingPlacementContext(presentation, moving),
): boolean {
  if (!moving.length) return false;
  const key = buildExecutionPlacementGroupKey(moving[0], context);
  return moving.every(
    (item) =>
      buildExecutionPlacementGroupKey(item, context) === key &&
      isSameExecutionPlacementGroup(moving[0], item, context),
  );
}
function suggestedGroupSlot(
  layout: ShoppingDragLayout,
  first: ShoppingItem,
): number {
  const context = layout.context;
  const group = buildExecutionPlacementGroupKey(first, context);
  const bucket = layout.buckets.get(group);
  if (bucket) return bucket.last + 1;
  const cached = layout.absentGroupSlots.get(group);
  if (cached !== undefined) return cached;
  const combined = projectExecutionPlacementVisits(
    [...layout.rawItems, first],
    context,
    layout.presentation.hallOrder,
  );
  const desired = combined.findIndex((visit) =>
    visit.itemIds.includes(first.id),
  );
  const slot = combined
    .slice(0, desired)
    .reduce((sum, visit) => sum + visit.items.length, 0);
  layout.absentGroupSlots.set(group, slot);
  return slot;
}
/** Indexed boundaries keep pointer movement independent of total item count. */
export function resolveShoppingDragPlacement(
  layout: ShoppingDragLayout,
  moving: readonly ShoppingItem[],
  referenceId: string | undefined,
  boundary: "before" | "after" | "end",
): ShoppingDragPlacement | null {
  if (!shoppingDragHasSingleGroup(moving, layout.presentation, layout.context))
    return null;
  const context = layout.context;
  const groupKey = buildExecutionPlacementGroupKey(moving[0], context);
  const movingVisits = projectExecutionPlacementVisits(moving, context);
  const merged = movingVisits.filter((visit) =>
    layout.visitsByKey.has(visit.key),
  );
  const positioned = movingVisits.filter(
    (visit) => !layout.visitsByKey.has(visit.key),
  );
  const reference = referenceId ? layout.itemsById.get(referenceId) : undefined;
  const referenceKey =
    reference && buildExecutionPlacementVisitKey(reference, context);
  const range = referenceKey ? layout.ranges.get(referenceKey) : undefined;
  if (boundary !== "end" && !range) return null;
  const insertionIndex =
    boundary === "end"
      ? layout.items.length
      : boundary === "before"
        ? range!.first
        : range!.last + 1;
  if (positioned.length) {
    const bucket = layout.buckets.get(groupKey);
    if (bucket) {
      if (insertionIndex < bucket.first || insertionIndex > bucket.last + 1)
        return null;
    } else {
      const expectedSlot = suggestedGroupSlot(layout, moving[0]);
      if (insertionIndex !== expectedSlot) return null;
    }
  }
  const next = layout.items[insertionIndex];
  const previous = layout.items[insertionIndex - 1];
  const nextInGroup =
    next && buildExecutionPlacementGroupKey(next, context) === groupKey;
  const previousInGroup =
    previous && buildExecutionPlacementGroupKey(previous, context) === groupKey;
  const previousKey =
    previous && buildExecutionPlacementVisitKey(previous, context);
  const anchor = nextInGroup
    ? next
    : previousInGroup && previousKey
      ? layout.rawItems[layout.visitInitialRawEnd.get(previousKey)!]
      : next;
  return {
    boundary,
    referenceId,
    referenceKey,
    referenceMemberIds: referenceKey
      ? layout.visitsByKey.get(referenceKey)!.itemIds
      : [],
    anchorId: anchor?.id ?? "__END_OF_LIST__",
    baseVisitKeys: layout.displayVisitKeys,
    insertVisitIndex: layout.visitBoundaryByItemIndex[insertionIndex],
    positionedVisitKeys: positioned.map((visit) => visit.key),
    positionedIds: positioned.flatMap((visit) => visit.itemIds),
    mergeVisits: merged.map((visit) => ({
      key: visit.key,
      itemIds: layout.visitsByKey.get(visit.key)!.itemIds,
    })),
    mergeTargetIds: merged.map(
      (visit) => layout.visitsByKey.get(visit.key)!.itemIds.at(-1)!,
    ),
    presentation: layout.presentation,
  };
}
/** The suggested slot is guidance; the workspace still requires a valid drop. */
export function resolveShoppingDragColumnPlacement(
  layout: ShoppingDragLayout,
  moving: readonly ShoppingItem[],
): ShoppingDragPlacement | null {
  if (!shoppingDragHasSingleGroup(moving, layout.presentation, layout.context))
    return null;
  const context = layout.context;
  const index = suggestedGroupSlot(layout, moving[0]);
  const next = layout.items[index];
  const previous = layout.items[index - 1];
  const base = resolveShoppingDragPlacement(
    layout,
    moving,
    next?.id ?? previous?.id,
    next ? "before" : previous ? "after" : "end",
  );
  if (!base) return null;
  const visitKeys = base.positionedVisitKeys;
  const referenceKey =
    previous && buildExecutionPlacementVisitKey(previous, context);
  return {
    ...base,
    hallTailInsertions: [
      {
        anchorId: base.anchorId,
        insertVisitIndex: base.insertVisitIndex,
        visitKeys,
        itemIds: base.positionedIds,
      },
    ],
    hallTailReferences: referenceKey
      ? [
          {
            key: referenceKey,
            itemIds: layout.visitsByKey.get(referenceKey)!.itemIds,
          },
        ]
      : [],
  };
}
/** Same-space book reorders use card edges, while visits keep their base slot. */
export function resolveShoppingBookPlacement(
  layout: ShoppingDragLayout,
  moving: readonly ShoppingItem[],
  referenceId: string,
  boundary: "before" | "after",
): ShoppingDragPlacement | null {
  const reference = layout.itemsById.get(referenceId);
  if (
    !reference ||
    !moving.length ||
    !shoppingDragHasSingleGroup(moving, layout.presentation, layout.context)
  )
    return null;
  const context = layout.context;
  const key = buildExecutionPlacementVisitKey(reference, context);
  if (
    !moving.every(
      (item) => buildExecutionPlacementVisitKey(item, context) === key,
    )
  )
    return null;
  const index =
    layout.items.findIndex((item) => item.id === referenceId) +
    (boundary === "after" ? 1 : 0);
  const expected = [...layout.items];
  expected.splice(index, 0, ...moving);
  return {
    kind: "items",
    boundary,
    referenceId,
    referenceKey: key,
    referenceMemberIds: layout.visitsByKey.get(key)!.itemIds,
    anchorId: layout.items[index]?.id ?? "__END_OF_LIST__",
    baseVisitKeys: layout.displayVisitKeys,
    insertVisitIndex: 0,
    positionedVisitKeys: [],
    positionedIds: moving.map((item) => item.id),
    mergeTargetIds: [],
    mergeVisits: [],
    presentation: layout.presentation,
    expectedItemIds: expected.map((item) => item.id),
  };
}
export function sameDragIds(
  first: readonly string[],
  second: readonly string[],
): boolean {
  const ids = new Set(second);
  return (
    first.length === second.length &&
    new Set(first).size === ids.size &&
    first.every((id) => ids.has(id))
  );
}
export function validateShoppingDragPlacement(
  placement: ShoppingDragPlacement,
  before: readonly ShoppingItem[],
  after: readonly ShoppingItem[],
): boolean {
  const context = shoppingPlacementContext(placement.presentation, before);
  const visits = projectExecutionPlacementVisits(
    before,
    context,
    placement.presentation.hallOrder,
  );
  const byKey = new Map(visits.map((visit) => [visit.key, visit.itemIds]));
  if (
    placement.referenceKey &&
    !sameDragIds(
      byKey.get(placement.referenceKey) ?? [],
      placement.referenceMemberIds,
    )
  )
    return false;
  if (
    placement.mergeVisits.some(
      (visit) => !sameDragIds(byKey.get(visit.key) ?? [], visit.itemIds),
    )
  )
    return false;
  if (placement.kind === "items") {
    const actual = projectShoppingDragDisplay(
      after,
      placement.presentation,
    ).map((item) => item.id);
    return (
      actual.length === placement.expectedItemIds?.length &&
      actual.every((id, index) => id === placement.expectedItemIds![index])
    );
  }
  const beforeKeys = visits.map((visit) => visit.key);
  if (
    beforeKeys.length !== placement.baseVisitKeys.length ||
    beforeKeys.some((key, index) => key !== placement.baseVisitKeys[index])
  )
    return false;
  const expected = [...(placement.columnVisitKeys ?? placement.baseVisitKeys)];
  if (!placement.columnVisitKeys)
    expected.splice(
      placement.insertVisitIndex,
      0,
      ...placement.positionedVisitKeys,
    );
  const actual = projectExecutionPlacementVisits(
    after,
    context,
    placement.presentation.hallOrder,
  ).map((visit) => visit.key);
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}
