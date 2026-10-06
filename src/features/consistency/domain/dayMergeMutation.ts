import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type {
  MutationChoices,
  MutationConfirmation,
  MutationPlan,
} from "../../../app/commands/applicationMutationCoordinator";
import { semanticSignature } from "../../../app/commands/applicationMutationCoordinator";
import { normalizeExecutionVisitDay } from "../../../utils/visitProjection";
import { duplicateEventDays, planDayMerge } from "./dayMerge";
import type { HallRef } from "../../../types/consistency";
import { hallRefKey } from "./context";

export interface MutationDay {
  eventName: string;
  day: string;
}

export const dayMergeChoicePrefix = (eventName: string, day: string): string =>
  `dayMerge:${JSON.stringify([eventName, normalizeExecutionVisitDay(day)])}:`;

/** Recalculate the requested operation against the user's merged day settings. */
export function planWithDayMerges(
  source: PersistenceSnapshot,
  targets: readonly MutationDay[],
  choices: MutationChoices,
  operation: (
    snapshot: PersistenceSnapshot,
    remapHall: (eventName: string, hall: HallRef) => HallRef,
  ) => MutationPlan,
  defaults: MutationChoices = {},
): MutationPlan {
  const days = [
    ...new Map(
      targets.map(({ eventName, day }) => {
        const target = { eventName, day: normalizeExecutionVisitDay(day) };
        return [JSON.stringify([eventName, target.day]), target] as const;
      }),
    ).entries(),
  ].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  let merged = source;
  const hallRefs = new Map<string, HallRef>();
  const reviews: MutationConfirmation[] = [];
  for (const [, { eventName, day }] of days) {
    if (!duplicateEventDays(merged, eventName).includes(day)) continue;
    const prefix = dayMergeChoicePrefix(eventName, day);
    const selections = Object.fromEntries(
      Object.entries({ ...defaults, ...choices })
        .filter(([id]) => id.startsWith(prefix))
        .map(([id, value]) => [id.slice(prefix.length), value]),
    );
    const plan = planDayMerge(merged, eventName, day, undefined, selections);
    merged = plan.snapshot;
    for (const [key, hall] of plan.hallRefRemap ?? [])
      hallRefs.set(JSON.stringify([eventName, key]), hall);
    if (plan.confirmation)
      reviews.push({
        ...plan.confirmation,
        choices: plan.confirmation.choices?.map((choice) => ({
          ...choice,
          id: prefix + choice.id,
        })),
      });
  }
  const result = operation(
    merged,
    (eventName, hall) =>
      hallRefs.get(JSON.stringify([eventName, hallRefKey(hall)])) ?? hall,
  );
  if (!reviews.length) return result;
  const changes: Array<{ path: string[]; before: unknown; after: unknown }> =
    [];
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const compare = (before: unknown, after: unknown, path: string[]) => {
    if (semanticSignature(before) === semanticSignature(after)) return;
    if (record(before) && record(after)) {
      for (const key of [
        ...new Set([...Object.keys(before), ...Object.keys(after)]),
      ].sort())
        compare(before[key], after[key], [...path, key]);
    } else if (
      Array.isArray(before) &&
      Array.isArray(after) &&
      [...before, ...after].every(
        (entry) => record(entry) && typeof entry.id === "string",
      )
    ) {
      const old = new Map(before.map((entry) => [entry.id, entry]));
      const next = new Map(after.map((entry) => [entry.id, entry]));
      compare([...old.keys()], [...next.keys()], [...path, "order"]);
      for (const id of [...new Set([...old.keys(), ...next.keys()])].sort())
        compare(old.get(id), next.get(id), [...path, id]);
    } else changes.push({ path, before, after });
  };
  compare(merged, result.snapshot, []);
  return {
    ...result,
    confirmation: {
      title: reviews[0].title,
      choices: [
        ...reviews.flatMap((review) =>
          (review.choices ?? []).map((choice) => ({
            ...choice,
            label:
              reviews.length > 1
                ? `${review.title.replace(/ の保存先を統合$/, "")}: ${choice.label}`
                : choice.label,
          })),
        ),
        ...(result.confirmation?.choices ?? []),
      ],
      details: [
        ...reviews.flatMap((review) => review.details),
        ...changes.map(
          (change) =>
            `${change.path.join(" / ")}: ${JSON.stringify(change.before) ?? "未設定"} → ${JSON.stringify(change.after) ?? "未設定"}`,
        ),
        ...(result.confirmation?.details ?? []),
      ],
      comparison: {
        merges: reviews.map((review) => review.comparison),
        changes,
        operation: result.confirmation?.comparison ?? null,
      },
    },
  };
}
