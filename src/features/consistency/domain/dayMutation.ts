import type {
  ApplicationDayMutation,
  PersistenceSnapshot,
} from "../../../app/ports/PersistenceCommandPort";
import type { MutationPlan } from "../../../app/commands/applicationMutationCoordinator";
import { MutationTargetMissingError } from "../../../app/commands/applicationMutationCoordinator";
import type { ShoppingItem } from "../../../types/item";

import { MAPLESS_HALL_KEY } from "../../../types/map";
import { semanticEqual } from "../../../utils/semanticEquality";
import { sameDay, normalizeMapDay } from "./context";
import { planDayModeToggle } from "./dayMode";
import { projectConsistencySnapshot } from "./projection";
import {
  applyChangedFields,
  changedFieldConflicts,
  confirmChangedFieldConflicts,
  planProjectedMutation,
} from "./mutations";

export const dayMutationStores = [
  "dayModes",
  "executeModeItems",
  "hallRouteSettings",
  "routeSettings",
] as const;
const isDayKey = (
  store: keyof PersistenceSnapshot,
  key: string,
  day: string,
) =>
  store === "dayModes" || store === "executeModeItems"
    ? sameDay(key, day)
    : key.startsWith(`${MAPLESS_HALL_KEY}:`)
      ? sameDay(key.slice(MAPLESS_HALL_KEY.length + 1), day)
      : normalizeMapDay(key) === normalizeMapDay(day);

/** Select read dependencies without cloning geometry or inspecting other events. */
export function scopeDaySnapshot(
  source: PersistenceSnapshot,
  eventName: string,
  day: string,
): PersistenceSnapshot {
  const result = Object.fromEntries(
    Object.keys(source).map((key) => [key, {}]),
  ) as unknown as PersistenceSnapshot;
  for (const store of Object.keys(source) as Array<keyof PersistenceSnapshot>) {
    const event = source[store][eventName];
    if (event === undefined) continue;
    let value: unknown;
    if (store === "eventLists")
      value = (event as ShoppingItem[]).filter((item) =>
        sameDay(item.eventDate, day),
      );
    else if (store === "eventConsistency") {
      const consistency = source.eventConsistency[eventName];
      value = {
        ...consistency,
        days: Object.fromEntries(
          Object.entries(consistency.days).filter(([key]) => sameDay(key, day)),
        ),
        legacyPending: consistency.legacyPending.filter(
          (entry) =>
            entry.sourceDayKey === null || sameDay(entry.sourceDayKey, day),
        ),
      };
    } else if (store === "eventMetadata") value = event;
    else
      value = Object.fromEntries(
        Object.entries(event ?? {}).filter(([key]) =>
          isDayKey(store, key, day),
        ),
      );
    Object.assign(result[store], { [eventName]: value });
  }
  return result;
}

/** Only replace modified branches; unrelated dates, items and maps retain identity. */
export function mergeDaySnapshot(
  source: PersistenceSnapshot,
  before: PersistenceSnapshot,
  after: PersistenceSnapshot,
  eventName: string,
): PersistenceSnapshot {
  const next = { ...source };
  for (const store of Object.keys(source) as Array<keyof PersistenceSnapshot>) {
    const old = before[store][eventName],
      value = after[store][eventName];
    if (semanticEqual(old, value)) continue;
    if (
      store === "eventLists" ||
      store === "mapData" ||
      store === "eventMetadata"
    )
      throw new Error(
        "A day command cannot modify items, geometry or event metadata.",
      );
    if (store === "eventConsistency") {
      const original = source.eventConsistency[eventName];
      const changed = after.eventConsistency[eventName];
      const days = { ...original.days };
      for (const key of Object.keys(
        before.eventConsistency[eventName]?.days ?? {},
      ))
        delete days[key];
      Object.assign(days, changed.days);
      next.eventConsistency = {
        ...source.eventConsistency,
        [eventName]: { ...original, days },
      };
    } else {
      const branch = { ...source[store][eventName] };
      for (const key of Object.keys(old ?? {})) delete branch[key];
      Object.assign(branch, value);
      Object.assign(next, {
        [store]: { ...source[store], [eventName]: branch },
      });
    }
  }
  return next;
}

export function planDayMutation(
  source: PersistenceSnapshot,
  command: ApplicationDayMutation,
): MutationPlan {
  const { eventName, day } = command;
  if (!source.eventLists[eventName]) throw new MutationTargetMissingError();
  const scoped = scopeDaySnapshot(source, eventName, day);
  let plan: MutationPlan;
  if (command.kind === "mode") {
    plan = planDayModeToggle(
      scoped,
      eventName,
      day,
      command.mode ? { mode: command.mode } : {},
    );
  } else {
    const projected = projectConsistencySnapshot(scoped, eventName, day);
    const patch: Partial<PersistenceSnapshot> = {};
    for (const store of dayMutationStores) {
      if (command.desired[store] === undefined) continue;
      Object.assign(patch, {
        [store]: applyChangedFields(
          command.baseline[store],
          command.desired[store],
          projected[store],
          { requireExistingTargets: true },
        ),
      });
    }
    plan = confirmChangedFieldConflicts(
      planProjectedMutation(
        scoped,
        patch,
        { eventName, day, routeDays: command.routeDays },
        {},
        projected,
        true,
      ),
      changedFieldConflicts(
        command.baseline,
        command.desired,
        Object.fromEntries(
          Object.keys(command.desired).map((key) => [
            key,
            projected[key as keyof PersistenceSnapshot],
          ]),
        ),
      ),
    );
  }
  return {
    ...plan,
    snapshot: mergeDaySnapshot(source, scoped, plan.snapshot, eventName),
  };
}

/** Convert compatible setter batches without copying a whole store. */
export function collectDayMutation(
  base: PersistenceSnapshot,
  desired: PersistenceSnapshot,
  eventName: string | null,
  day: string,
  routeDays?: Record<string, Record<string, string[]>>,
): ApplicationDayMutation | undefined {
  if (!eventName || !base.eventLists[eventName]) return;
  const baseline: Partial<PersistenceSnapshot> = {},
    changes: Partial<PersistenceSnapshot> = {};
  for (const store of Object.keys(base) as Array<keyof PersistenceSnapshot>) {
    if (base[store] === desired[store]) continue;
    if (!(dayMutationStores as readonly string[]).includes(store)) return;
    for (const name of new Set([
      ...Object.keys(base[store]),
      ...Object.keys(desired[store]),
    ])) {
      if (semanticEqual(base[store][name], desired[store][name])) continue;
      if (name !== eventName) return;
      const before = base[store][name] as Record<string, unknown> | undefined;
      const after = desired[store][name] as Record<string, unknown> | undefined;
      for (const key of new Set([
        ...Object.keys(before ?? {}),
        ...Object.keys(after ?? {}),
      ])) {
        if (
          !semanticEqual(before?.[key], after?.[key]) &&
          !isDayKey(store, key, day)
        )
          return;
      }
      const select = (value: Record<string, unknown> | undefined) =>
        Object.fromEntries(
          Object.entries(value ?? {}).filter(([key]) =>
            isDayKey(store, key, day),
          ),
        );
      Object.assign(baseline, { [store]: { [eventName]: select(before) } });
      Object.assign(changes, { [store]: { [eventName]: select(after) } });
    }
  }
  if (!Object.keys(changes).length) return;
  if (
    routeDays &&
    Object.entries(routeDays).some(
      ([name, maps]) =>
        name !== eventName ||
        Object.values(maps).some((days) =>
          days.some((value) => !sameDay(value, day)),
        ),
    )
  )
    return;
  return {
    kind: "patch",
    eventName,
    day,
    baseline,
    desired: changes,
    routeDays,
  };
}
