import type {
  MutationPlan,
  MutationChoices,
} from "../../../app/commands/applicationMutationCoordinator";
import type {
  ApplicationDayMutation,
  PersistenceSnapshot,
} from "../../../app/ports/PersistenceCommandPort";
import { planDayModeToggle } from "./dayMode";
import { duplicateEventDays, planDayMerge } from "./dayMerge";
import {
  existingDayKey,
  getContextHalls,
  getDayConsistency,
  hallGroupKey,
  resolveDayMap,
  sameDay,
} from "./context";
import { createMembershipResolver } from "./membership";
import { applyVisitHistory } from "./visitHistory";
import { planProjectedMutation } from "./mutations";
import type { DayMapData, HallDefinition } from "../../../types/map";
import type { ShoppingItem } from "../../../types/item";

export interface VisitPanelRebase {
  day: string;
  map: string;
  baseline: string[];
}

type SessionTransition = (
  snapshot: PersistenceSnapshot,
  choices?: MutationChoices,
) => MutationPlan;

/** Reviews source and target changes before either is persisted. */
function planSessionTransition(
  snapshot: PersistenceSnapshot,
  value: { event: string; day: string; modeDay?: string },
  choices?: MutationChoices,
  transition?: SessionTransition,
): MutationPlan {
  const transitionPlan = transition?.(snapshot, choices);
  const sourceChoices = transition
    ? Object.fromEntries(
        Object.entries(choices ?? {})
          .filter(([key]) => key.startsWith("source:"))
          .map(([key, choice]) => [key.slice("source:".length), choice]),
      )
    : choices;
  const mergePlan = planDayMerge(
    transitionPlan?.snapshot ?? snapshot,
    value.event,
    value.day,
    undefined,
    sourceChoices,
  );

  const sourceReview = mergePlan.confirmation
    ? {
        ...mergePlan.confirmation,
        choices: mergePlan.confirmation.choices?.map((choice) => ({
          ...choice,
          id: transition ? `source:${choice.id}` : choice.id,
          label: transition ? `${value.day} / ${choice.label}` : choice.label,
        })),
      }
    : undefined;
  let review =
    transitionPlan?.confirmation && sourceReview
      ? {
          title: transitionPlan.confirmation.title,
          choices: [
            ...(transitionPlan.confirmation.choices ?? []),
            ...(sourceReview.choices ?? []),
          ],
          details: [
            ...transitionPlan.confirmation.details,
            ...sourceReview.details,
          ],
          comparison: {
            transition: transitionPlan.confirmation.comparison,
            source: sourceReview.comparison,
          },
        }
      : (sourceReview ?? transitionPlan?.confirmation);
  if (review && transitionPlan && value.modeDay) {
    const modeDay = value.modeDay;
    const selectedModes = (source: PersistenceSnapshot) =>
      Object.fromEntries(
        Object.entries(source.dayModes[value.event] ?? {}).filter(([day]) =>
          sameDay(day, modeDay),
        ),
      );
    const before = selectedModes(snapshot);
    const after = selectedModes(transitionPlan.snapshot);
    review = {
      ...review,
      details: [
        ...review.details,
        ...(!transitionPlan.confirmation
          ? [
              `${value.modeDay} のモード: ${Object.values(before)[0] ?? "未設定"} → ${Object.values(after)[0] ?? "未設定"}`,
            ]
          : []),
      ],
      comparison: {
        review: review.comparison,
        transitionModes: { before, after },
      },
    };
  }
  return { ...mergePlan, confirmation: review };
}
/** Shared by worker commands and reviewed UI plans; input contains only affected dates. */
export function planVisitPanelMutation(
  snapshot: PersistenceSnapshot,
  command: Extract<ApplicationDayMutation, { kind: "visits" }>,
  choices?: MutationChoices,
): MutationPlan & { rebase?: VisitPanelRebase } {
  const value = {
    event: command.eventName,
    day: command.day,
    modeDay: command.modeDay,
  };
  const transition: SessionTransition | undefined = command.modeDay
    ? (source, selected) =>
        planDayModeToggle(source, command.eventName, command.modeDay!, selected)
    : undefined;
  const sourceDuplicated = duplicateEventDays(snapshot, value.event).some(
    (day) => sameDay(day, value.day),
  );
  const mergePlan = planSessionTransition(snapshot, value, choices, transition);
  if (command.order === undefined) return mergePlan;
  snapshot = mergePlan.snapshot;
  let rebase: VisitPanelRebase | undefined;
  const review = mergePlan.confirmation;
  const dayKey = existingDayKey(
    snapshot.executeModeItems[value.event],
    value.day,
  );
  if (!dayKey) return { snapshot, confirmation: review };
  const items = snapshot.eventLists[value.event] as ShoppingItem[];
  const day = getDayConsistency(snapshot.eventConsistency[value.event], dayKey);
  const maps = snapshot.mapData[value.event] as
    | Record<string, DayMapData>
    | undefined;
  const mapKey = day?.selectedMapKey ?? command.mapKey;
  const map = resolveDayMap(maps, dayKey, mapKey);
  const context = day?.maps[mapKey];
  if (sourceDuplicated || dayKey !== value.day || mapKey !== command.mapKey)
    rebase = {
      day: dayKey,
      map: mapKey,
      baseline: [...snapshot.executeModeItems[value.event][dayKey]],
    };
  const halls = getContextHalls(
    snapshot.hallDefinitions[value.event] as Record<string, HallDefinition[]>,
    dayKey,
    mapKey,
  );
  const resolve = createMembershipResolver({
    items,
    day: dayKey,
    map,
    context,
    halls,
  });
  const order = applyVisitHistory(
    snapshot.executeModeItems[value.event][dayKey],
    command.order,
    items,
    (item) =>
      hallGroupKey({
        hall: resolve(item).hall,
        priority: item.priorityLevel ?? "none",
      }),
  );
  const orderPlan = planProjectedMutation(
    snapshot,
    {
      executeModeItems: {
        ...snapshot.executeModeItems,
        [value.event]: {
          ...snapshot.executeModeItems[value.event],
          [dayKey]: order,
        },
      },
    },
    { eventName: value.event, day: dayKey, mapKey, confirm: false },
  );
  if (!review) return { ...orderPlan, rebase };
  const beforeOrder = snapshot.executeModeItems[value.event][dayKey];
  const afterOrder = orderPlan.snapshot.executeModeItems[value.event][dayKey];
  return {
    ...orderPlan,
    rebase,
    confirmation: {
      ...review,
      details: [
        ...review.details,
        `${value.day} の訪問順: ${JSON.stringify(beforeOrder)} → ${JSON.stringify(afterOrder)}`,
      ],
      comparison: { review: review.comparison, beforeOrder, afterOrder },
    },
  };
}
