import {
  duplicateEventDays,
  planDayMerge,
} from "../../features/consistency/domain/dayMerge";
import { dayMergeChoicePrefix } from "../../features/consistency/domain/dayMergeMutation";
import {
  projectConsistencySnapshot,
  isCompleteHallOrder,
} from "../../features/consistency/domain/projection";
import {
  buildCandidatePlacementVisitKey,
  buildExecutionPlacementGroupKey,
  buildExecutionPlacementVisitKey,
  flattenExecutionPlacementItems,
} from "../../utils/executionPlacement";
import {
  sameDay,
  getDayConsistency,
  resolveDayMap,
  getContextHalls,
} from "../../features/consistency/domain/context";
import {
  getMaplessKey,
  type DayMapData,
  type HallDefinition,
  type HallRouteSettings,
} from "../../types/map";
import {
  buildExecutionVisitProjectionKey,
  projectItemsToExecutionVisits,
} from "../../utils/visitProjection";
import type {
  ApplicationShoppingMove,
  PersistenceSnapshot,
} from "../ports/PersistenceCommandPort";
import {
  MutationTargetMissingError,
  semanticSignature,
  type MutationChoices,
  type MutationPlan,
} from "./applicationMutationCoordinator";
import {
  scopeDaySnapshot,
  mergeDaySnapshot,
} from "../../features/consistency/domain/dayMutation";
import { existingDayKey } from "../../features/consistency/domain/context";
import {
  applyChangedFields,
  changedFieldConflicts,
  confirmChangedFieldConflicts,
  planShoppingOrderMutation,
} from "../../features/consistency/domain/mutations";
import { recordEntry } from "../../utils/ownRecord";
import { semanticEqual } from "../../utils/semanticEquality";
import type { ShoppingItem } from "../../types/item";

export const shoppingItemIds = (items: readonly unknown[]): string[] =>
  items.map((item) => (item as { id: string }).id);
export const shoppingExecuteIds = (
  snapshot: PersistenceSnapshot,
  eventName: string,
  day: string,
): string[] => {
  const days = recordEntry(snapshot.executeModeItems, eventName) ?? {};
  return recordEntry(days, existingDayKey(days, day) ?? day) ?? [];
};
function uniqueIds(ids: readonly string[]): boolean {
  return (
    ids.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(ids).size === ids.length
  );
}
export function shoppingMoveVisitBaseline(
  snapshot: PersistenceSnapshot,
  eventName: string,
  day: string,
): Array<{ id: string; key: string }> {
  return (
    (recordEntry(snapshot.eventLists, eventName) as
      | ShoppingItem[]
      | undefined) ?? []
  )
    .filter((item) => sameDay(item.eventDate, day))
    .map((item) => ({
      id: item.id,
      key: buildExecutionVisitProjectionKey(item),
    }));
}
/** Only an already-present legacy day conflict may use the existing review flow. */
export function shoppingMoveInitialDayMergeSignature(
  snapshot: PersistenceSnapshot,
  eventName: string,
  day: string,
): string | undefined {
  if (
    !duplicateEventDays(snapshot, eventName).some((value) =>
      sameDay(value, day),
    )
  )
    return undefined;
  const scoped = scopeDaySnapshot(snapshot, eventName, day);
  const comparison = planDayMerge(scoped, eventName, day).confirmation
    ?.comparison as { before?: unknown } | undefined;
  return comparison ? semanticSignature(comparison.before) : undefined;
}

function permitsKnownInitialDayReview(
  command: ApplicationShoppingMove,
  confirmation: NonNullable<MutationPlan["confirmation"]>,
): boolean {
  if (!command.initialDayMergeSignature) return false;
  const comparison = confirmation.comparison as
    | { merges?: Array<{ before?: unknown }>; operation?: unknown }
    | undefined;
  const prefix = dayMergeChoicePrefix(command.eventName, command.day);
  return (
    comparison?.merges?.length === 1 &&
    comparison.operation === null &&
    semanticSignature(comparison.merges[0].before) ===
      command.initialDayMergeSignature &&
    !!confirmation.choices?.length &&
    confirmation.choices.every((choice) => choice.id.startsWith(prefix))
  );
}
export function shoppingMoveMatchesBaseline(
  snapshot: PersistenceSnapshot,
  command: ApplicationShoppingMove,
): boolean {
  if (
    command.initialDayMergeSignature &&
    shoppingMoveInitialDayMergeSignature(
      snapshot,
      command.eventName,
      command.day,
    ) !== command.initialDayMergeSignature
  )
    return false;
  if (command.placementBaseline)
    return semanticEqual(
      command.placementBaseline,
      shoppingMovePlacementBaseline(snapshot, command),
    );
  return (
    (!command.baselineVisits ||
      semanticEqual(
        shoppingMoveVisitBaseline(snapshot, command.eventName, command.day),
        command.baselineVisits,
      )) &&
    semanticEqual(
      shoppingItemIds(
        recordEntry(snapshot.eventLists, command.eventName) ?? [],
      ),
      command.baselineItemIds,
    ) &&
    semanticEqual(
      shoppingExecuteIds(snapshot, command.eventName, command.day),
      command.baselineExecuteIds,
    )
  );
}
export const SHOPPING_PLACEMENT_CHANGED_REASON =
  "移動元または配置先の所属・優先度・順序が変わったため、移動を中止しました。もう一度ドラッグしてください。";

export class ShoppingPlacementChangedError extends Error {
  constructor() {
    super(SHOPPING_PLACEMENT_CHANGED_REASON);
    this.name = "ShoppingPlacementChanged";
  }
}

/** Placement-only dependencies. Item contents and unrelated visits are excluded. */
export function shoppingMovePlacementBaseline(
  snapshot: PersistenceSnapshot,
  command: Pick<
    ApplicationShoppingMove,
    | "eventName"
    | "day"
    | "sourceColumn"
    | "targetColumn"
    | "effectiveIds"
    | "hoverId"
    | "itemIds"
    | "executeIds"
    | "placementBaseline"
    | "reorderWithinVisit"
  >,
  alreadyProjected = false,
): NonNullable<ApplicationShoppingMove["placementBaseline"]> {
  const scoped = scopeDaySnapshot(snapshot, command.eventName, command.day);
  const projected = alreadyProjected
    ? scoped
    : projectConsistencySnapshot(scoped, command.eventName, command.day);
  const items = (recordEntry(projected.eventLists, command.eventName) ??
    []) as ShoppingItem[];
  const byId = new Map(items.map((item) => [item.id, item]));
  const executing = shoppingExecuteIds(
    snapshot,
    command.eventName,
    command.day,
  );
  const executeSet = new Set(executing);
  const moving = new Set(command.effectiveIds);
  const sourceVisitKeys = new Set(
    command.effectiveIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [buildExecutionPlacementVisitKey(item)] : [];
    }),
  );
  const movingGroups = new Set(
    command.effectiveIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [buildExecutionPlacementGroupKey(item)] : [];
    }),
  );
  const source =
    command.sourceColumn === "execute"
      ? executing
      : items.filter((item) => !executeSet.has(item.id)).map((item) => item.id);
  const desiredTarget =
    command.targetColumn === "execute"
      ? command.executeIds
      : command.itemIds.filter((id) => !command.executeIds.includes(id));
  const targetIds =
    command.targetColumn === "execute"
      ? executing
      : items.filter((item) => !executeSet.has(item.id)).map((item) => item.id);
  const targetVisitKey = (item: ShoppingItem) =>
    command.targetColumn === "candidate"
      ? buildCandidatePlacementVisitKey(item)
      : buildExecutionPlacementVisitKey(item);
  const remainingTargetIds = targetIds.filter((id) => !moving.has(id));
  const remainingVisitKeys = new Set(
    remainingTargetIds.flatMap((id) =>
      byId.has(id) ? [buildExecutionPlacementVisitKey(byId.get(id)!)] : [],
    ),
  );
  const positioned = new Set(
    command.effectiveIds.filter(
      (id) =>
        command.targetColumn === "candidate" ||
        !byId.has(id) ||
        !remainingVisitKeys.has(buildExecutionPlacementVisitKey(byId.get(id)!)),
    ),
  );
  const boundary = new Set<string>();
  for (let index = 0; index < desiredTarget.length; index++) {
    if (!positioned.has(desiredTarget[index]) || command.reorderWithinVisit)
      continue;
    for (const step of [-1, 1]) {
      let adjacent = index + step;
      while (
        adjacent >= 0 &&
        adjacent < desiredTarget.length &&
        moving.has(desiredTarget[adjacent])
      )
        adjacent += step;
      if (adjacent >= 0 && adjacent < desiredTarget.length)
        boundary.add(desiredTarget[adjacent]);
    }
  }
  if (
    positioned.size &&
    !command.reorderWithinVisit &&
    byId.has(command.hoverId)
  )
    boundary.add(command.hoverId);
  const relevant = new Set(command.effectiveIds);
  const sourceRelevant = new Set(command.effectiveIds);
  source.forEach((id) => {
    const item = byId.get(id);
    if (
      item &&
      (command.sourceColumn !== "candidate" ||
        command.targetColumn !== "candidate") &&
      sourceVisitKeys.has(buildExecutionPlacementVisitKey(item))
    ) {
      relevant.add(id);
      sourceRelevant.add(id);
    }
  });
  const tailGroups =
    command.targetColumn === "execute"
      ? (command.placementBaseline?.tailGroups ??
        [...movingGroups]
          .filter((key) => {
            if (command.reorderWithinVisit) return false;
            const visits = projectItemsToExecutionVisits(
              desiredTarget.flatMap((id) => {
                const item = byId.get(id);
                return item && buildExecutionPlacementGroupKey(item) === key
                  ? [item]
                  : [];
              }),
              buildExecutionPlacementVisitKey,
            );
            return (
              visits.at(-1)?.itemIds.some((id) => positioned.has(id)) ?? false
            );
          })
          .sort())
      : undefined;
  const targetDependencyKeys = new Set<string>();
  for (const key of tailGroups ?? []) {
    const visits = projectItemsToExecutionVisits(
      remainingTargetIds.flatMap((id) => {
        const item = byId.get(id);
        return item && buildExecutionPlacementGroupKey(item) === key
          ? [item]
          : [];
      }),
      buildExecutionPlacementVisitKey,
    );
    const tail = visits.at(-1);
    if (tail) targetDependencyKeys.add(tail.key);
  }
  if (!command.reorderWithinVisit && positioned.size) {
    // Recheck the actual neighboring visit of each frozen insertion anchor.
    // A newly inserted visit inside the chosen gap is a placement change;
    // a distant visit, including one in a different hall, is not.
    const groups =
      command.targetColumn === "execute" ? [...movingGroups] : [null];
    for (const group of groups) {
      const inGroup = (item: ShoppingItem) =>
        group === null || buildExecutionPlacementGroupKey(item) === group;
      const desiredItems = desiredTarget.flatMap((id) => {
        const item = byId.get(id);
        return item && inGroup(item) ? [item] : [];
      });
      const currentItems = remainingTargetIds.flatMap((id) => {
        const item = byId.get(id);
        return item && inGroup(item) ? [item] : [];
      });
      const desired =
        command.targetColumn === "execute"
          ? projectItemsToExecutionVisits(
              desiredItems,
              buildExecutionPlacementVisitKey,
            ).flatMap((visit) => visit.items)
          : desiredItems;
      const current =
        command.targetColumn === "execute"
          ? projectItemsToExecutionVisits(
              currentItems,
              buildExecutionPlacementVisitKey,
            ).flatMap((visit) => visit.items)
          : currentItems;
      for (let index = 0; index < desired.length; index++) {
        if (!positioned.has(desired[index].id)) continue;
        const next = desired
          .slice(index + 1)
          .find((item) => !moving.has(item.id));
        if (!next) continue;
        const at = current.findIndex((item) => item.id === next.id);
        const previous = current[at - 1];
        if (previous) targetDependencyKeys.add(targetVisitKey(previous));
      }
    }
  }
  // Existing destination visits own the merge position; distant visits in the
  // same hall/priority do not affect it.
  remainingTargetIds.forEach((id) => {
    const item = byId.get(id);
    if (
      item &&
      command.targetColumn === "execute" &&
      sourceVisitKeys.has(buildExecutionPlacementVisitKey(item))
    )
      targetDependencyKeys.add(targetVisitKey(item));
  });
  boundary.forEach((id) => {
    const item = byId.get(id);
    if (item) targetDependencyKeys.add(targetVisitKey(item));
  });
  remainingTargetIds.forEach((id) => {
    const item = byId.get(id);
    if (item && targetDependencyKeys.has(targetVisitKey(item)))
      relevant.add(id);
  });
  boundary.forEach((id) => relevant.add(id));
  const entries = [...relevant].sort().map((id) => {
    const item = byId.get(id);
    return {
      id,
      key: item
        ? sourceRelevant.has(id)
          ? buildExecutionPlacementVisitKey(item)
          : targetVisitKey(item)
        : "missing",
      column: executeSet.has(id)
        ? ("execute" as const)
        : ("candidate" as const),
    };
  });
  let groupNeighbors: Array<Array<string | null>> | undefined;
  // Existing visit tails and book slots do not depend on other groups surviving.
  if (
    command.targetColumn === "execute" &&
    positioned.size > 0 &&
    !command.reorderWithinVisit
  ) {
    const event = recordEntry(snapshot.eventConsistency, command.eventName);
    const settings = getDayConsistency(event, command.day);
    const maps = (recordEntry(projected.mapData, command.eventName) ??
      {}) as Record<string, DayMapData>;
    const map = resolveDayMap(maps, command.day, settings?.selectedMapKey);
    const definitions = (recordEntry(
      projected.hallDefinitions,
      command.eventName,
    ) ?? {}) as Record<string, HallDefinition[]>;
    const halls = getContextHalls(
      definitions,
      command.day,
      map.status === "resolved" ? map.key : null,
    ).map((entry) => entry.definition);
    const routeSettings =
      recordEntry(projected.hallRouteSettings, command.eventName) ?? {};
    const simpleKey = getMaplessKey(command.day.replace(/\u3000/g, " ").trim());
    const selected = routeSettings[
      map.status === "resolved" ? map.key : simpleKey
    ] as HallRouteSettings | undefined;
    const simple = routeSettings[simpleKey] as HallRouteSettings | undefined;
    const hallOrder = isCompleteHallOrder(selected)
      ? selected!.hallOrder
      : [
          ...new Set([
            ...(selected?.hallOrder ?? []),
            ...(simple?.hallOrder ?? []),
            ...halls.map((hall) => hall.id),
          ]),
        ];
    const displayItems = [
      ...executing,
      ...command.effectiveIds.filter((id) => !executeSet.has(id)),
    ].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    let groups = [
      ...new Set(
        flattenExecutionPlacementItems(
          displayItems,
          {
            hallDefinitions: halls,
            mapData: map.status === "resolved" ? map.data : null,
            allItems: items,
          },
          hallOrder,
        ).map((item) => buildExecutionPlacementGroupKey(item)),
      ),
    ];
    const frozenGroups = command.placementBaseline?.groupNeighbors;
    if (frozenGroups) {
      const dependentGroups = new Set(
        frozenGroups.flatMap((entry) =>
          entry.filter((key): key is string => key !== null),
        ),
      );
      groups = groups.filter((key) => dependentGroups.has(key));
    }
    groupNeighbors = [...movingGroups].sort().map((key) => {
      const index = groups.indexOf(key);
      return [groups[index - 1] ?? null, key, groups[index + 1] ?? null];
    });
  }
  return {
    entries,
    ...(groupNeighbors ? { groupNeighbors } : {}),
    ...(tailGroups ? { tailGroups } : {}),
    sourceOrder: source.filter((id) => relevant.has(id)),
    targetOrder: (command.targetColumn === "execute"
      ? executing
      : items.filter((item) => !executeSet.has(item.id)).map((item) => item.id)
    ).filter((id) => relevant.has(id)),
  };
}

/** Replay only this move's IDs; retain newer unrelated insertions, removals and order. */
function applyFrozenMoveOrder(
  baseline: readonly string[],
  desired: readonly string[],
  current: readonly string[],
  effective: ReadonlySet<string>,
): string[] {
  if (semanticEqual(baseline, desired)) return [...current];
  const result = current.filter((id) => !effective.has(id));
  const currentSet = new Set(current);
  for (let index = 0; index < desired.length; index++) {
    if (!effective.has(desired[index])) continue;
    const run: string[] = [];
    while (index < desired.length && effective.has(desired[index])) {
      if (currentSet.has(desired[index]) || !baseline.includes(desired[index]))
        run.push(desired[index]);
      index++;
    }
    const next = desired.slice(index).find((id) => result.includes(id));
    const previous = desired
      .slice(0, index - run.length)
      .reverse()
      .find((id) => result.includes(id));
    const at =
      next !== undefined
        ? result.indexOf(next)
        : previous !== undefined
          ? result.indexOf(previous) + 1
          : result.length;
    result.splice(at, 0, ...run);
    index--;
  }
  return result;
}
/** Shared by generic retry/review and the worker. Reorder current objects, never old copies. */
export function planShoppingMove(
  snapshot: PersistenceSnapshot,
  command: ApplicationShoppingMove,
  choices: MutationChoices = {},
): MutationPlan {
  const { eventName, day } = command;
  const items = recordEntry(snapshot.eventLists, eventName) as
    | ShoppingItem[]
    | undefined;
  if (!items) throw new MutationTargetMissingError();
  if (
    command.version !== 1 ||
    ![
      command.itemIds,
      command.baselineItemIds,
      command.executeIds,
      command.baselineExecuteIds,
      command.requestedIds,
      command.effectiveIds,
    ].every(uniqueIds)
  )
    throw new Error("Invalid shopping move IDs.");
  const baselineIds = new Set(command.baselineItemIds);
  if (
    command.itemIds.length !== command.baselineItemIds.length ||
    command.itemIds.some((id) => !baselineIds.has(id))
  )
    throw new Error("Shopping moves must preserve item membership.");
  if (
    !Array.isArray(command.baselineVisits) ||
    !uniqueIds(command.baselineVisits.map((entry) => entry.id)) ||
    command.baselineVisits.some((entry) => typeof entry.key !== "string")
  )
    throw new Error("Invalid frozen shopping visits.");
  const baselineDayIds = new Set(
    command.baselineVisits.map((entry) => entry.id),
  );
  const baselineExecute = new Set(command.baselineExecuteIds);
  const desiredExecute = new Set(command.executeIds);
  const frozenEffective = new Set(command.effectiveIds);
  const crossColumn = command.sourceColumn !== command.targetColumn;
  if (
    command.baselineExecuteIds.some((id) => !baselineDayIds.has(id)) ||
    command.executeIds.some((id) => !baselineDayIds.has(id)) ||
    command.effectiveIds.some(
      (id) =>
        !baselineDayIds.has(id) ||
        baselineExecute.has(id) !== (command.sourceColumn === "execute"),
    ) ||
    command.baselineItemIds.some(
      (id) =>
        baselineExecute.has(id) !== desiredExecute.has(id) &&
        (!crossColumn || !frozenEffective.has(id)),
    ) ||
    (crossColumn &&
      command.effectiveIds.some(
        (id) => desiredExecute.has(id) !== (command.targetColumn === "execute"),
      )) ||
    !semanticEqual(
      command.baselineItemIds.filter((id) => !baselineDayIds.has(id)),
      command.itemIds.filter((id) => !baselineDayIds.has(id)),
    )
  )
    throw new Error("Shopping move changed an unrelated membership or day.");
  if (
    command.placementBaseline &&
    !shoppingMoveMatchesBaseline(snapshot, command)
  )
    throw new ShoppingPlacementChangedError();
  const currentIds = shoppingItemIds(items);
  const currentExecuteIds = new Set(
    shoppingExecuteIds(snapshot, eventName, day),
  );
  const effective = new Set(command.effectiveIds);
  const currentSource = items.filter(
    (item) =>
      sameDay(item.eventDate, day) &&
      currentExecuteIds.has(item.id) === (command.sourceColumn === "execute"),
  );
  const sourceIds = new Set(currentSource.map((item) => item.id));
  if (
    !effective.size ||
    command.requestedIds.some((id) => !effective.has(id)) ||
    command.effectiveIds.some((id) => !sourceIds.has(id))
  )
    throw new MutationTargetMissingError();
  if (command.baselineVisits && !command.placementBaseline) {
    const expected = new Map(
      command.baselineVisits.map((visit) => [visit.id, visit.key]),
    );
    const currentVisits = projectItemsToExecutionVisits(currentSource);
    const baselineSourceIds = new Set(command.baselineExecuteIds);
    const expectedVisits = new Map<string, Set<string>>();
    for (const entry of command.baselineVisits) {
      if (
        baselineSourceIds.has(entry.id) !==
        (command.sourceColumn === "execute")
      )
        continue;
      if (!expectedVisits.has(entry.key))
        expectedVisits.set(entry.key, new Set());
      expectedVisits.get(entry.key)!.add(entry.id);
    }
    const currentById = new Map(currentSource.map((item) => [item.id, item]));
    for (const visit of currentVisits) {
      if (!visit.itemIds.some((id) => effective.has(id))) continue;
      const expectedIds = expectedVisits.get(visit.key) ?? new Set<string>();
      if (
        visit.itemIds.some((id) => expected.get(id) !== visit.key) ||
        visit.itemIds.length !== expectedIds.size ||
        visit.itemIds.some((id) => !expectedIds.has(id))
      )
        throw new MutationTargetMissingError();
    }
    if (
      command.effectiveIds.some(
        (id) =>
          expected.get(id) !==
          buildExecutionVisitProjectionKey(currentById.get(id)!),
      )
    )
      throw new MutationTargetMissingError();
  }
  const ids = command.placementBaseline
    ? applyFrozenMoveOrder(
        command.baselineItemIds,
        command.itemIds,
        currentIds,
        effective,
      )
    : (applyChangedFields(
        command.baselineItemIds,
        command.itemIds,
        currentIds,
      ) as string[]);
  const currentExecute = shoppingExecuteIds(snapshot, eventName, day);
  let executeIds = command.placementBaseline
    ? applyFrozenMoveOrder(
        command.baselineExecuteIds,
        command.executeIds,
        currentExecute,
        effective,
      )
    : (applyChangedFields(
        command.baselineExecuteIds,
        command.executeIds,
        currentExecute,
      ) as string[]);
  if (command.reorderWithinVisit) {
    if (
      !command.placementBaseline ||
      command.sourceColumn !== "execute" ||
      command.targetColumn !== "execute"
    )
      throw new Error("Book ordering requires a frozen execution visit.");
    const placementKeys = new Map(
      command.placementBaseline.entries.map((entry) => [entry.id, entry.key]),
    );
    const visitKey = placementKeys.get(command.effectiveIds[0]);
    if (
      !visitKey ||
      command.effectiveIds.some((id) => placementKeys.get(id) !== visitKey)
    )
      throw new Error("Book ordering must stay within one execution visit.");
    const desiredBooks = command.executeIds.filter(
      (id) => placementKeys.get(id) === visitKey,
    );
    const bookIds = new Set(
      command.baselineExecuteIds.filter(
        (id) => placementKeys.get(id) === visitKey,
      ),
    );
    if (
      desiredBooks.length !== bookIds.size ||
      desiredBooks.some((id) => !bookIds.has(id))
    )
      throw new Error(
        "Book ordering must preserve its execution visit members.",
      );
    let bookIndex = 0;
    executeIds = currentExecute.map((id) =>
      bookIds.has(id) ? desiredBooks[bookIndex++] : id,
    );
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  if (
    !uniqueIds(currentIds) ||
    !uniqueIds(ids) ||
    ids.length !== currentIds.length ||
    ids.some((id) => !byId.has(id)) ||
    executeIds.some((id) => !byId.has(id))
  )
    throw new MutationTargetMissingError();
  const ordered = semanticEqual(ids, currentIds)
    ? items
    : ids.map((id) => byId.get(id)!);
  const scoped = scopeDaySnapshot(snapshot, eventName, day);
  const dayIds = new Set(
    shoppingItemIds(recordEntry(scoped.eventLists, eventName) ?? []),
  );
  // Consistency planners consume the displayed placement projection. Reorder its
  // current objects so virtual hall assignments are not mistaken for removals.
  const projected = projectConsistencySnapshot(scoped, eventName, day);
  const projectedById = new Map(
    (recordEntry(projected.eventLists, eventName) as ShoppingItem[]).map(
      (item) => [item.id, item],
    ),
  );
  const days = recordEntry(projected.executeModeItems, eventName) ?? {};
  const dayKey = existingDayKey(days, day) ?? day;
  const plan = planShoppingOrderMutation(
    scoped,
    {
      ...(ordered === items
        ? {}
        : {
            eventLists: {
              [eventName]: ordered
                .filter((item) => dayIds.has(item.id))
                .map((item) => projectedById.get(item.id)!),
            },
          }),
      ...(semanticEqual(currentExecute, executeIds)
        ? {}
        : {
            executeModeItems: {
              [eventName]: { ...days, [dayKey]: executeIds },
            },
          }),
    },
    { eventName, day },
    choices,
    projected,
    true,
  );
  const next = mergeDaySnapshot(
    snapshot,
    scoped,
    { ...plan.snapshot, eventLists: scoped.eventLists },
    eventName,
    day,
  );
  if (ordered !== items)
    next.eventLists = { ...snapshot.eventLists, [eventName]: ordered };
  if (command.placementBaseline) {
    if (
      plan.confirmation &&
      !permitsKnownInitialDayReview(command, plan.confirmation)
    )
      throw new ShoppingPlacementChangedError();
    return { ...plan, snapshot: next };
  }
  return confirmChangedFieldConflicts({ ...plan, snapshot: next }, [
    ...(command.baselineVisits &&
    !semanticEqual(
      command.baselineVisits,
      shoppingMoveVisitBaseline(snapshot, eventName, day),
    )
      ? [
          {
            path: ["eventLists", eventName, "placement"],
            baseline: command.baselineVisits,
            current: shoppingMoveVisitBaseline(snapshot, eventName, day),
            desired: command.itemIds,
          },
        ]
      : []),
    ...changedFieldConflicts(
      command.baselineItemIds,
      command.itemIds,
      currentIds,
      ["eventLists", eventName],
    ),
    ...changedFieldConflicts(
      command.baselineExecuteIds,
      command.executeIds,
      currentExecute,
      ["executeModeItems", eventName, day],
    ),
  ]);
}
