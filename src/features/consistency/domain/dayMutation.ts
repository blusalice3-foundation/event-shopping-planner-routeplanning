import type {
  ApplicationDayMutation,
  ApplicationDayScope,
  PersistenceSnapshot,
} from "../../../app/ports/PersistenceCommandPort";
import type { MutationPlan } from "../../../app/commands/applicationMutationCoordinator";
import { MutationTargetMissingError } from "../../../app/commands/applicationMutationCoordinator";
import type { ShoppingItem } from "../../../types/item";

import { MAPLESS_HALL_KEY } from "../../../types/map";
import { semanticEqual } from "../../../utils/semanticEquality";
import { sameDay, normalizeMapDay } from "./context";
import { planDayModeToggle } from "./dayMode";
import { planDayMerge } from "./dayMerge";
import { planVisitPanelMutation } from "./visitPanelMutation";
import { dayMutationScope, matchesScopeDay } from "./dayScope";
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
  "mapViewportSettings",
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
  additionalDays: readonly string[] = [],
): PersistenceSnapshot {
  const target = { eventName, day, additionalDays };
  const result = Object.fromEntries(
    Object.keys(source).map((key) => [key, {}]),
  ) as unknown as PersistenceSnapshot;
  for (const store of Object.keys(source) as Array<keyof PersistenceSnapshot>) {
    const event = source[store][eventName];
    if (event === undefined) continue;
    let value: unknown;
    if (store === "eventLists")
      value = (event as ShoppingItem[]).filter((item) =>
        matchesScopeDay(target, item.eventDate),
      );
    else if (store === "eventConsistency") {
      const consistency = source.eventConsistency[eventName];
      value = {
        ...consistency,
        days: Object.fromEntries(
          Object.entries(consistency.days).filter(([key]) =>
            matchesScopeDay(target, key),
          ),
        ),
        legacyPending: consistency.legacyPending.filter(
          (entry) =>
            entry.sourceDayKey === null ||
            matchesScopeDay(target, entry.sourceDayKey),
        ),
      };
    } else if (store === "eventMetadata") value = event;
    else
      value = Object.fromEntries(
        Object.entries(event ?? {}).filter(([key]) =>
          [day, ...additionalDays].some((value) => isDayKey(store, key, value)),
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
  day: string,
  additionalDays: readonly string[] = [],
): PersistenceSnapshot {
  const target = { eventName, day, additionalDays };
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
        [eventName]: {
          ...original,
          days,
          legacyPending: [
            ...original.legacyPending.filter(
              (entry) =>
                entry.sourceDayKey !== null &&
                !matchesScopeDay(target, entry.sourceDayKey),
            ),
            ...changed.legacyPending,
          ],
        },
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
  const target = dayMutationScope(command);
  const scoped = scopeDaySnapshot(
    source,
    eventName,
    day,
    target.additionalDays,
  );
  let plan: MutationPlan;
  if (command.kind === "mode") {
    plan = planDayModeToggle(
      scoped,
      eventName,
      day,
      command.mode ? { mode: command.mode } : {},
    );
  } else if (command.kind === "visits") {
    plan = planVisitPanelMutation(scoped, command);
  } else if (command.kind === "map-viewport") {
    if (!scoped.mapData[eventName]?.[command.mapKey])
      throw new MutationTargetMissingError();
    plan = {
      snapshot: {
        ...scoped,
        mapViewportSettings: {
          ...scoped.mapViewportSettings,
          [eventName]: {
            ...scoped.mapViewportSettings[eventName],
            [command.mapKey]: structuredClone(command.viewport),
          },
        },
      },
    };
  } else if (command.kind === "day-merge") {
    plan = planDayMerge(scoped, eventName, day);
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
    snapshot: mergeDaySnapshot(
      source,
      scoped,
      plan.snapshot,
      eventName,
      day,
      target.additionalDays,
    ),
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
      Object.assign(baseline, {
        [store]: before === undefined ? {} : { [eventName]: select(before) },
      });
      Object.assign(changes, {
        [store]: after === undefined ? {} : { [eventName]: select(after) },
      });
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

/** Merge an independently verified day read without discarding retained historical state. */
export function adoptScopedDaySnapshot(
  retained: PersistenceSnapshot | undefined,
  scoped: PersistenceSnapshot,
  target: ApplicationDayScope,
): PersistenceSnapshot {
  if (!retained) return scoped;
  let result = retained;
  const { eventName, day, additionalDays = [] } = target;
  for (const store of Object.keys(scoped) as Array<keyof PersistenceSnapshot>) {
    const latest = scoped[store][eventName];
    const current = retained[store][eventName];
    let value: unknown;
    if (store === "eventLists" || store === "eventMetadata") value = latest;
    else if (store === "eventConsistency") {
      if (latest === undefined) value = undefined;
      else {
        const old = retained.eventConsistency[eventName];
        const next = scoped.eventConsistency[eventName];
        const days = Object.fromEntries(
          Object.entries(old?.days ?? {}).filter(
            ([key]) => !matchesScopeDay(target, key),
          ),
        );
        value = { ...next, days: { ...days, ...next.days } };
      }
    } else if (latest === undefined && current === undefined) value = undefined;
    else {
      value = {
        ...Object.fromEntries(
          Object.entries(current ?? {}).filter(
            ([key]) =>
              ![day, ...additionalDays].some((value) =>
                isDayKey(store, key, value),
              ),
          ),
        ),
        ...(latest as object),
      };
    }
    if (semanticEqual(current, value)) continue;
    const branch = { ...result[store] } as Record<string, unknown>;
    if (value === undefined) delete branch[eventName];
    else
      Object.defineProperty(branch, eventName, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    result = { ...result, [store]: branch };
  }
  return result;
}
