import { projectConsistencySnapshot } from "../../features/consistency/domain/projection";
import { sameDay } from "../../features/consistency/domain/context";
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
  planProjectedMutation,
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
export function shoppingMoveMatchesBaseline(
  snapshot: PersistenceSnapshot,
  command: ApplicationShoppingMove,
): boolean {
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
  if (command.baselineVisits) {
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
  const ids = applyChangedFields(
    command.baselineItemIds,
    command.itemIds,
    currentIds,
  ) as string[];
  const currentExecute = shoppingExecuteIds(snapshot, eventName, day);
  const executeIds = applyChangedFields(
    command.baselineExecuteIds,
    command.executeIds,
    currentExecute,
  ) as string[];
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
  const plan = planProjectedMutation(
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
