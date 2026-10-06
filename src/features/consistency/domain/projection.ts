import { projectDayBuckets } from "./dayBuckets";
import { normalizeExecutionVisitDay } from "../../../utils/visitProjection";
import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../../types/item";
import type {
  HallDefinition,
  HallRouteSettings,
  DayMapData,
  RouteSettings,
} from "../../../types/map";
import { getMaplessKey, MAPLESS_HALL_KEY } from "../../../types/map";
import type { HallGroupRef, HallRef } from "../../../types/consistency";
import { getContextHalls, getDayConsistency, resolveDayMap } from "./context";
import { createMembershipResolver, type Membership } from "./membership";

const membershipByItem = new WeakMap<ShoppingItem, Membership>();
const fullOrderSettings = new WeakSet<HallRouteSettings>();
export const projectedMembership = (
  item: ShoppingItem,
): Membership | undefined => membershipByItem.get(item);
export const isCompleteHallOrder = (
  settings: HallRouteSettings | undefined,
): boolean => !!settings && fullOrderSettings.has(settings);
export const encodeHallRef = (ref: HallRef): string =>
  `@hall:${JSON.stringify(ref.kind === "map" ? ["map", ref.mapKey, ref.hallId] : ["simple", ref.dayKey, ref.hallId])}`;
export function decodeHallRef(id: string): HallRef | null {
  if (!id.startsWith("@hall:")) return null;
  try {
    const parts: unknown = JSON.parse(id.slice(6));
    if (
      !Array.isArray(parts) ||
      parts.length !== 3 ||
      !parts.every((part) => typeof part === "string")
    )
      return null;
    return parts[0] === "map"
      ? { kind: "map", mapKey: parts[1], hallId: parts[2] }
      : parts[0] === "simple"
        ? { kind: "simple", dayKey: parts[1], hallId: parts[2] }
        : null;
  } catch {
    return null;
  }
}
export const encodeHallGroup = (group: HallGroupRef): string =>
  `${group.hall ? encodeHallRef(group.hall) : "undefined"}${group.priority === "none" ? "" : `:${group.priority}`}`;
export function decodeHallGroup(id: string): HallGroupRef | null {
  const priority = id.endsWith(":highest")
    ? "highest"
    : id.endsWith(":priority")
      ? "priority"
      : "none";
  const base = priority === "none" ? id : id.slice(0, -priority.length - 1);
  if (base === "undefined") return { hall: null, priority };
  const hall = decodeHallRef(base);
  return hall ? { hall, priority } : null;
}
/** Read-only legacy component adapter. Its route and assignment fields are never persisted. */
export function projectConsistencySnapshot(
  source: PersistenceSnapshot,
  activeEvent: string | null,
  activeDay: string,
): PersistenceSnapshot {
  const result: PersistenceSnapshot = {
    ...source,
    executeModeItems: Object.fromEntries(
      Object.entries(source.executeModeItems).map(([name, days]) => [
        name,
        projectDayBuckets(days),
      ]),
    ),
    dayModes: Object.fromEntries(
      Object.entries(source.dayModes).map(([name, days]) => [
        name,
        projectDayBuckets(days),
      ]),
    ),
    eventLists: {},
    hallDefinitions: {},
    hallRouteSettings: {},
    routeSettings: {},
  };
  for (const [eventName, rawItems] of Object.entries(source.eventLists)) {
    const event = source.eventConsistency[eventName];
    const items = rawItems as ShoppingItem[];
    const definitions = (source.hallDefinitions[eventName] ?? {}) as Record<
      string,
      HallDefinition[]
    >;
    const maps = (source.mapData[eventName] ?? {}) as Record<
      string,
      DayMapData
    >;
    result.hallDefinitions[eventName] = Object.fromEntries(
      Object.entries(definitions).map(([key, halls]) => [
        key,
        halls.map((hall) => ({
          ...hall,
          id: encodeHallRef(
            key.startsWith(`${MAPLESS_HALL_KEY}:`)
              ? {
                  kind: "simple",
                  dayKey: key.slice(MAPLESS_HALL_KEY.length + 1),
                  hallId: hall.id,
                }
              : { kind: "map", mapKey: key, hallId: hall.id },
          ),
        })),
      ]),
    );
    const simple = Object.fromEntries(
      Object.entries(result.hallDefinitions[eventName])
        .filter(([key]) => key.startsWith(`${MAPLESS_HALL_KEY}:`))
        .map(([key, value]) => [key.slice(MAPLESS_HALL_KEY.length + 1), value]),
    );
    result.hallDefinitions[eventName] = {
      ...Object.fromEntries(
        Object.entries(result.hallDefinitions[eventName]).filter(
          ([key]) => !key.startsWith(`${MAPLESS_HALL_KEY}:`),
        ),
      ),
      ...Object.fromEntries(
        Object.entries(projectDayBuckets(simple)).map(([day, value]) => [
          getMaplessKey(day),
          value,
        ]),
      ),
    };
    const resolvers = new Map<
      string,
      ReturnType<typeof createMembershipResolver>
    >();
    result.eventLists[eventName] = items.map((item) => {
      const day = getDayConsistency(event, item.eventDate);
      const map = resolveDayMap(maps, item.eventDate, day?.selectedMapKey);
      const context =
        map.status === "resolved"
          ? day?.maps[map.key]
          : map.status === "none"
            ? day?.mapless
            : null;
      const dayKey = normalizeExecutionVisitDay(item.eventDate);
      let resolve = resolvers.get(dayKey);
      if (!resolve) {
        resolve = createMembershipResolver({
          items,
          day: item.eventDate,
          map,
          halls: getContextHalls(
            definitions,
            item.eventDate,
            map.status === "resolved" ? map.key : null,
          ),
          context,
        });
        resolvers.set(dayKey, resolve);
      }
      const membership = resolve(item);
      const projected = { ...item };
      delete projected.manualHallId;
      if (membership.hall)
        projected.manualHallId = encodeHallRef(membership.hall);
      membershipByItem.set(projected, membership);
      return projected;
    });
    const displayDay =
      activeEvent === eventName ? activeDay : (items[0]?.eventDate ?? "");
    const day = getDayConsistency(event, displayDay);
    result.hallRouteSettings[eventName] = {};
    result.routeSettings[eventName] = {};
    if (!day) continue;
    const projectContext = (
      key: string,
      context: NonNullable<typeof day.mapless>,
    ) => {
      const settings: HallRouteSettings = {
        hallOrder: context.hallOrder.map(encodeHallGroup),
        hallVisitLists: context.hallVisitLists.map((list) => ({
          hallId: encodeHallGroup(list.group),
          itemIds: [...list.itemIds],
        })),
      };
      fullOrderSettings.add(settings);
      result.hallRouteSettings[eventName][key] = settings;
      if (context.route)
        result.routeSettings[eventName][key] = context.route as RouteSettings;
    };
    for (const [key, context] of Object.entries(day.maps))
      projectContext(key, context);
    if (day.mapless)
      projectContext(
        getMaplessKey(normalizeExecutionVisitDay(displayDay)),
        day.mapless,
      );
  }
  return result;
}
