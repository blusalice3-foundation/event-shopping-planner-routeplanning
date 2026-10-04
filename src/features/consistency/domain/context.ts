import type { ShoppingItem } from "../../../types/item";
import type { DayMapData, HallDefinition } from "../../../types/map";
import { getMaplessKey, MAPLESS_HALL_KEY } from "../../../types/map";
import type {
  DayConsistencyV1,
  EventConsistencyV1,
  HallGroupRef,
  HallRef,
  Priority,
  VisitContextV1,
} from "../../../types/consistency";
import {
  createDayConsistency,
  createVisitContext,
} from "../../../types/consistency";
import { normalizeExecutionVisitDay } from "../../../utils/visitProjection";

export const sameDay = (left: string, right: string): boolean =>
  normalizeExecutionVisitDay(left) === normalizeExecutionVisitDay(right);
export type DayResolution =
  | { status: "missing" }
  | { status: "resolved"; key: string }
  | { status: "ambiguous"; keys: string[] };
export function resolveDayKey(
  record: object | undefined,
  day: string,
): DayResolution {
  const keys = Object.keys(record ?? {})
    .filter((key) => sameDay(key, day))
    .sort();
  return keys.length === 0
    ? { status: "missing" }
    : keys.length === 1
      ? { status: "resolved", key: keys[0] }
      : { status: "ambiguous", keys };
}
export class DayMergeRequiredError extends Error {
  constructor(
    readonly day: string,
    readonly keys: string[],
  ) {
    super(`同じ日付の保存先を確認してください: ${keys.join("、")}`);
    this.name = "DayMergeRequiredError";
  }
}
export function existingDayKey(
  record: object | undefined,
  day: string,
): string | undefined {
  const result = resolveDayKey(record, day);
  if (result.status === "ambiguous")
    throw new DayMergeRequiredError(day, result.keys);
  return result.status === "resolved" ? result.key : undefined;
}
export function resolveSimpleKey(
  definitions: Record<string, unknown> | undefined,
  day: string,
): DayResolution {
  const days = Object.fromEntries(
    Object.keys(definitions ?? {})
      .filter((key) => key.startsWith(`${MAPLESS_HALL_KEY}:`))
      .map((key) => [key.slice(MAPLESS_HALL_KEY.length + 1), true]),
  );
  const result = resolveDayKey(days, day);
  return result.status === "resolved"
    ? { status: "resolved", key: getMaplessKey(result.key) }
    : result.status === "ambiguous"
      ? { status: "ambiguous", keys: result.keys.map(getMaplessKey) }
      : result;
}
export const normalizeMapDay = (value: string): string =>
  value
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[ \u3000]/g, "")
    .replace(/マップ$/, "");
export type MapResolution =
  | { status: "resolved"; key: string; data: DayMapData; candidates: string[] }
  | { status: "none"; candidates: [] }
  | {
      status: "selection-required";
      candidates: string[];
      invalidSelection?: string;
    };
export function resolveDayMap(
  maps: Record<string, DayMapData> | undefined,
  day: string,
  selectedMapKey: string | null = null,
): MapResolution {
  const candidates = Object.keys(maps ?? {})
    .filter((key) => normalizeMapDay(key) === normalizeMapDay(day))
    .sort();
  const resolved = (key: string): MapResolution => ({
    status: "resolved",
    key,
    data: maps![key],
    candidates,
  });
  if (selectedMapKey !== null)
    return candidates.includes(selectedMapKey)
      ? resolved(selectedMapKey)
      : {
          status: "selection-required",
          candidates,
          invalidSelection: selectedMapKey,
        };
  const exact = normalizeExecutionVisitDay(day) + "マップ";
  if (candidates.includes(exact)) return resolved(exact);
  if (candidates.length === 1) return resolved(candidates[0]);
  return candidates.length
    ? { status: "selection-required", candidates }
    : { status: "none", candidates: [] };
}
export function getDayConsistency(
  event: EventConsistencyV1 | undefined,
  day: string,
): DayConsistencyV1 | undefined {
  const result = resolveDayKey(event?.days, day);
  return result.status === "resolved" ? event?.days[result.key] : undefined;
}
export function ensureDayConsistency(
  event: EventConsistencyV1,
  day: string,
  preferredRecords: Array<object | undefined> = [],
): DayConsistencyV1 {
  let key = existingDayKey(event.days, day);
  if (!key) {
    for (const record of preferredRecords) {
      key = existingDayKey(record, day);
      if (key) break;
    }
    key ??= normalizeExecutionVisitDay(day);
    Object.defineProperty(event.days, key, {
      value: createDayConsistency(),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return event.days[key];
}
export function ensureVisitContext(
  day: DayConsistencyV1,
  mapKey: string | null,
): VisitContextV1 {
  if (mapKey === null) return (day.mapless ??= createVisitContext());
  if (!Object.prototype.hasOwnProperty.call(day.maps, mapKey))
    Object.defineProperty(day.maps, mapKey, {
      value: createVisitContext(),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return day.maps[mapKey];
}
export function hallRefKey(ref: HallRef | null): string {
  return ref === null
    ? "null"
    : JSON.stringify(
        ref.kind === "map"
          ? [ref.kind, ref.mapKey, ref.hallId]
          : [ref.kind, ref.dayKey, ref.hallId],
      );
}
export const sameHall = (
  left: HallRef | null,
  right: HallRef | null,
): boolean => hallRefKey(left) === hallRefKey(right);
export const hallGroupKey = (group: HallGroupRef): string =>
  JSON.stringify([hallRefKey(group.hall), group.priority]);
export const hallSourceKey = (ref: HallRef): string =>
  ref.kind === "map" ? ref.mapKey : getMaplessKey(ref.dayKey);
export function resolveHallDefinition(
  definitions: Record<string, HallDefinition[]> | undefined,
  ref: HallRef,
): HallDefinition | undefined {
  return definitions?.[hallSourceKey(ref)]?.find(
    (hall) => hall.id === ref.hallId,
  );
}
export type SourcedHall = { ref: HallRef; definition: HallDefinition };
export function getContextHalls(
  definitions: Record<string, HallDefinition[]> | undefined,
  day: string,
  mapKey: string | null,
): SourcedHall[] {
  const result: SourcedHall[] = [];
  if (mapKey)
    for (const definition of definitions?.[mapKey] ?? [])
      result.push({
        ref: { kind: "map", mapKey, hallId: definition.id },
        definition,
      });
  for (const key of Object.keys(definitions ?? {}).sort()) {
    if (
      key.startsWith(`${MAPLESS_HALL_KEY}:`) &&
      sameDay(key.slice(MAPLESS_HALL_KEY.length + 1), day)
    ) {
      for (const definition of definitions![key])
        result.push({
          ref: {
            kind: "simple",
            dayKey: key.slice(MAPLESS_HALL_KEY.length + 1),
            hallId: definition.id,
          },
          definition,
        });
    }
  }
  return result;
}
/** A literal hall ID has precedence. Ambiguous suffix interpretations stay pending. */
export function interpretLegacyGroup(
  value: string,
  halls: SourcedHall[],
): HallGroupRef[] {
  const possibilities: HallGroupRef[] = [];
  const add = (id: string, priority: Priority) => {
    if (id === "undefined") possibilities.push({ hall: null, priority });
    for (const hall of halls.filter((hall) => hall.ref.hallId === id))
      possibilities.push({ hall: hall.ref, priority });
  };
  add(value, "none");
  for (const priority of ["priority", "highest"] as const)
    if (value.endsWith(`:${priority}`))
      add(value.slice(0, -priority.length - 1), priority);
  return possibilities;
}
export function collectEventDays(
  items: readonly ShoppingItem[],
  ...records: Array<object | undefined>
): string[] {
  return [
    ...new Set(
      [
        ...items.map((item) => item.eventDate),
        ...records.flatMap((record) => Object.keys(record ?? {})),
      ].map(normalizeExecutionVisitDay),
    ),
  ].sort();
}
