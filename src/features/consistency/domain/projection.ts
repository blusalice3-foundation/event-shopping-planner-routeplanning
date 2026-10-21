import { recordEntry, setOwnValue } from "../../../utils/ownRecord";
import {
  changedItemPositions,
  itemPositions,
  registerItemChanges,
} from "../../../utils/itemIndex";
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
import type {
  HallGroupRef,
  HallRef,
  EventConsistencyV1,
  VisitContextV1,
} from "../../../types/consistency";
import { getContextHalls, getDayConsistency, resolveDayMap } from "./context";
import {
  createMembershipResolver,
  type Membership,
  type LocationResolution,
  type ResolvedCell,
} from "./membership";
import { semanticEqual } from "../../../utils/semanticEquality";

const membershipByItem = new WeakMap<ShoppingItem, Membership>();
const fullOrderSettings = new WeakSet<HallRouteSettings>();
const sameResolvedCell = (before: ResolvedCell, next: ResolvedCell): boolean =>
  before.block === next.block &&
  before.numberValue === next.numberValue &&
  before.cell.row === next.cell.row &&
  before.cell.col === next.cell.col;
function sameLocation(
  before: LocationResolution | null,
  next: LocationResolution | null,
): boolean {
  if (before === next) return true;
  if (!before || !next || before.status !== next.status) return false;
  if (before.status === "resolved" && next.status === "resolved")
    return sameResolvedCell(before.location, next.location);
  return (
    before.status !== "resolved" &&
    next.status !== "resolved" &&
    before.candidates.length === next.candidates.length &&
    before.candidates.every((cell, index) =>
      sameResolvedCell(cell, next.candidates[index]),
    )
  );
}
function sameMembership(
  before: Membership | undefined,
  next: Membership | undefined,
): boolean {
  return (
    before === next ||
    (!!before &&
      !!next &&
      before.status === next.status &&
      before.reason === next.reason &&
      before.sharedKey === next.sharedKey &&
      semanticEqual(before.hall, next.hall) &&
      semanticEqual(before.candidates, next.candidates) &&
      semanticEqual(before.memberIds, next.memberIds) &&
      sameLocation(before.location, next.location))
  );
}
/** Equal visible fields alone cannot replace an item carrying newer membership metadata. */
export function canReuseProjectedItem(before: unknown, next: unknown): boolean {
  const membership = (value: unknown) =>
    value && typeof value === "object"
      ? membershipByItem.get(value as ShoppingItem)
      : undefined;
  return sameMembership(membership(before), membership(next));
}
type PreviousProjectedEvent = {
  items: PersistenceSnapshot["eventLists"][string];
  definitions: PersistenceSnapshot["hallDefinitions"][string];
  projection: Pick<PersistenceSnapshot, "eventLists" | "hallDefinitions">;
};
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
  return projectSnapshot(source, activeEvent, activeDay);
}
function projectSnapshot(
  source: PersistenceSnapshot,
  activeEvent: string | null,
  activeDay: string,
  previous?: ReadonlyMap<string, PreviousProjectedEvent>,
  retainedItems?: ReadonlyMap<string, ShoppingItem[]>,
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
    const event = recordEntry(source.eventConsistency, eventName);
    const items = rawItems as ShoppingItem[];
    const definitions = (recordEntry(source.hallDefinitions, eventName) ??
      {}) as Record<string, HallDefinition[]>;
    const maps = (recordEntry(source.mapData, eventName) ?? {}) as Record<
      string,
      DayMapData
    >;
    const before = previous?.get(eventName);
    if (
      before &&
      before.definitions === recordEntry(source.hallDefinitions, eventName)
    ) {
      setOwnValue(
        result.hallDefinitions,
        eventName,
        recordEntry(before.projection.hallDefinitions, eventName),
      );
    } else {
      setOwnValue(
        result.hallDefinitions,
        eventName,
        Object.fromEntries(
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
        ),
      );
      const simple = Object.fromEntries(
        Object.entries(recordEntry(result.hallDefinitions, eventName))
          .filter(([key]) => key.startsWith(`${MAPLESS_HALL_KEY}:`))
          .map(([key, value]) => [
            key.slice(MAPLESS_HALL_KEY.length + 1),
            value,
          ]),
      );
      setOwnValue(result.hallDefinitions, eventName, {
        ...Object.fromEntries(
          Object.entries(recordEntry(result.hallDefinitions, eventName)).filter(
            ([key]) => !key.startsWith(`${MAPLESS_HALL_KEY}:`),
          ),
        ),
        ...Object.fromEntries(
          Object.entries(projectDayBuckets(simple)).map(([day, value]) => [
            getMaplessKey(day),
            value,
          ]),
        ),
      });
    }
    const retained = retainedItems?.get(eventName);
    if (retained) {
      setOwnValue(result.eventLists, eventName, retained);
    } else {
      const resolvers = new Map<
        string,
        ReturnType<typeof createMembershipResolver>
      >();
      const beforeItems = before?.items as ShoppingItem[] | undefined;
      const beforeProjected =
        before &&
        (recordEntry(before.projection.eventLists, eventName) as
          | ShoppingItem[]
          | undefined);
      const positions =
        beforeItems && beforeItems !== items
          ? itemPositions(beforeItems)
          : null;
      const projectedItems = items.map((item, index) => {
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
        const oldIndex =
          beforeItems === items ? index : positions?.get(item.id);
        const oldItem =
          oldIndex === undefined ? undefined : beforeProjected?.[oldIndex];
        if (
          oldItem &&
          oldIndex !== undefined &&
          semanticEqual(beforeItems![oldIndex], item) &&
          sameMembership(membershipByItem.get(oldItem), membership)
        )
          return oldItem;
        const projected = { ...item };
        delete projected.manualHallId;
        if (membership.hall)
          projected.manualHallId = encodeHallRef(membership.hall);
        membershipByItem.set(projected, membership);
        return projected;
      });
      const changed =
        beforeProjected &&
        projectedItems.flatMap((item, index) =>
          item === beforeProjected[index] ? [] : [index],
        );
      const shared =
        beforeProjected &&
        beforeProjected.length === projectedItems.length &&
        !changed!.length
          ? beforeProjected
          : projectedItems;
      if (beforeProjected && shared !== beforeProjected)
        registerItemChanges(beforeProjected, shared, changed!);
      setOwnValue(result.eventLists, eventName, shared);
    }
    const displayDay =
      activeEvent === eventName ? activeDay : (items[0]?.eventDate ?? "");
    const day = getDayConsistency(event, displayDay);
    setOwnValue(result.hallRouteSettings, eventName, {});
    setOwnValue(result.routeSettings, eventName, {});
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
      recordEntry(result.hallRouteSettings, eventName)[key] = settings;
      if (context.route)
        recordEntry(result.routeSettings, eventName)[key] =
          context.route as RouteSettings;
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
function projectCachedDayStores<T>(
  source: Record<string, Record<string, T>>,
  previous: Record<string, Record<string, T>> | undefined,
  projected: Record<string, Record<string, T>> | undefined,
): Record<string, Record<string, T>> {
  if (source === previous) return projected!;
  return Object.fromEntries(
    Object.entries(source).map(([event, days]) => [
      event,
      days === previous?.[event] && projected?.[event]
        ? projected[event]
        : projectDayBuckets(days),
    ]),
  );
}
function sameMembershipContext(
  before: EventConsistencyV1 | undefined,
  next: EventConsistencyV1 | undefined,
): boolean {
  if (before === next) return true;
  const previous = before?.days ?? {};
  const after = next?.days ?? {};
  const keys = Object.keys(previous);
  const sameAssignments = (
    left: VisitContextV1 | null | undefined,
    right: VisitContextV1 | null | undefined,
  ) =>
    !!left === !!right &&
    (!left || semanticEqual(left.assignments, right!.assignments));
  return (
    keys.length === Object.keys(after).length &&
    keys.every((key) => {
      if (!Object.prototype.hasOwnProperty.call(after, key)) return false;
      const left = previous[key],
        right = after[key];
      const mapKeys = Object.keys(left.maps);
      return (
        left.selectedMapKey === right.selectedMapKey &&
        sameAssignments(left.mapless, right.mapless) &&
        mapKeys.length === Object.keys(right.maps).length &&
        mapKeys.every(
          (mapKey) =>
            Object.prototype.hasOwnProperty.call(right.maps, mapKey) &&
            sameAssignments(left.maps[mapKey], right.maps[mapKey]),
        )
      );
    })
  );
}
/** Reordering immutable objects cannot change a uniquely determined membership. */
function projectCachedItemOrder(
  previous: ShoppingItem[],
  items: ShoppingItem[],
  projected: ShoppingItem[],
): ShoppingItem[] | undefined {
  if (previous.length !== items.length) return undefined;
  const positions = itemPositions(previous);
  if (positions.size !== previous.length) return undefined;
  const seen = new Set<string>();
  const result: ShoppingItem[] = [];
  for (const item of items) {
    const index = positions.get(item.id);
    if (index === undefined || seen.has(item.id) || previous[index] !== item)
      return undefined;
    const value = projected[index];
    const membership = membershipByItem.get(value);
    // Multiple candidates can inherit their order from the peer item order.
    if (
      !membership ||
      membership.candidates.length > 1 ||
      membership.status === "confirmation-required" ||
      membership.status === "map-selection-required" ||
      membership.location?.status === "ambiguous"
    )
      return undefined;
    seen.add(item.id);
    result.push(value);
  }
  return result;
}
function projectCachedItemContent(
  previous: ShoppingItem[],
  items: ShoppingItem[],
  projected: ShoppingItem[],
  allowReorder: boolean,
): ShoppingItem[] | undefined {
  if (previous === items) return projected;
  const changed = changedItemPositions(previous, items);
  if (changed === null)
    return allowReorder
      ? projectCachedItemOrder(previous, items, projected)
      : undefined;
  if (
    changed.some(
      (index) =>
        items[index].id !== previous[index].id ||
        items[index].eventDate !== previous[index].eventDate ||
        items[index].block !== previous[index].block ||
        items[index].number !== previous[index].number,
    )
  )
    return undefined;
  const contentChanges = changed.filter(
    (index) => !semanticEqual(previous[index], items[index]),
  );
  if (!contentChanges.length) return projected;
  const result = projected.slice();
  for (const index of contentChanges) {
    const value = { ...items[index] };
    delete value.manualHallId;
    const membership = membershipByItem.get(projected[index])!;
    if (membership.hall) value.manualHallId = encodeHallRef(membership.hall);
    membershipByItem.set(value, membership);
    result[index] = value;
  }
  registerItemChanges(projected, result, contentChanges);
  return result;
}
/** Cache only immutable UI snapshots. Mutation planners keep using the uncached adapter. */
export function createConsistencySnapshotProjector() {
  type Entry = {
    items: PersistenceSnapshot["eventLists"][string];
    maps: PersistenceSnapshot["mapData"][string];
    definitions: PersistenceSnapshot["hallDefinitions"][string];
    consistency: PersistenceSnapshot["eventConsistency"][string];
    day: string;
    projection: Pick<
      PersistenceSnapshot,
      "eventLists" | "hallDefinitions" | "hallRouteSettings" | "routeSettings"
    >;
  };
  let previous: PersistenceSnapshot | undefined;
  let previousResult: PersistenceSnapshot | undefined;
  let previousEvent: string | null;
  let previousDay: string;
  let entries = new Map<string, Entry>();
  return (
    source: PersistenceSnapshot,
    activeEvent: string | null,
    activeDay: string,
  ): PersistenceSnapshot => {
    if (
      source === previous &&
      activeEvent === previousEvent &&
      activeDay === previousDay
    )
      return previousResult!;
    const nextEntries = new Map<string, Entry>();
    const changed: PersistenceSnapshot["eventLists"] = {};
    const retainedItems = new Map<string, ShoppingItem[]>();
    for (const [name, rawItems] of Object.entries(source.eventLists)) {
      const cached = entries.get(name);
      const displayDay =
        activeEvent === name
          ? activeDay
          : ((rawItems as ShoppingItem[])[0]?.eventDate ?? "");
      const sameGeometry =
        cached &&
        cached.maps === recordEntry(source.mapData, name) &&
        cached.definitions === recordEntry(source.hallDefinitions, name);
      const consistency = recordEntry(source.eventConsistency, name);
      const sameContext =
        sameGeometry &&
        cached.consistency === consistency &&
        cached.day === displayDay;
      const reusable =
        sameGeometry && sameMembershipContext(cached.consistency, consistency)
          ? projectCachedItemContent(
              cached.items as ShoppingItem[],
              rawItems as ShoppingItem[],
              recordEntry(cached.projection.eventLists, name) as ShoppingItem[],
              activeEvent === previousEvent && activeDay === previousDay,
            )
          : undefined;
      const projection =
        sameContext && reusable
          ? reusable === recordEntry(cached.projection.eventLists, name)
            ? cached.projection
            : { ...cached.projection, eventLists: { [name]: reusable } }
          : undefined;
      if (!projection && reusable) retainedItems.set(name, reusable);
      if (!projection)
        Object.defineProperty(changed, name, {
          value: rawItems,
          enumerable: true,
        });
      nextEntries.set(name, {
        items: rawItems,
        maps: recordEntry(source.mapData, name),
        definitions: recordEntry(source.hallDefinitions, name),
        consistency: recordEntry(source.eventConsistency, name),
        day: displayDay,
        projection: projection!,
      });
    }
    const fresh = projectSnapshot(
      { ...source, eventLists: changed, executeModeItems: {}, dayModes: {} },
      activeEvent,
      activeDay,
      entries,
      retainedItems,
    );
    const projectedKeys = [
      "eventLists",
      "hallDefinitions",
      "hallRouteSettings",
      "routeSettings",
    ] as const;
    const result = {
      ...source,
      executeModeItems: projectCachedDayStores(
        source.executeModeItems,
        previous?.executeModeItems,
        previousResult?.executeModeItems,
      ),
      dayModes: projectCachedDayStores(
        source.dayModes,
        previous?.dayModes,
        previousResult?.dayModes,
      ),
    };
    for (const [name, entry] of nextEntries) {
      if (!entry.projection)
        entry.projection = Object.fromEntries(
          projectedKeys.map((key) => [
            key,
            { [name]: recordEntry(fresh[key], name) },
          ]),
        ) as Entry["projection"];
    }
    for (const key of projectedKeys) {
      const values = Object.fromEntries(
        [...nextEntries].map(([name, entry]) => [
          name,
          recordEntry(entry.projection[key], name),
        ]),
      );
      const old = previousResult?.[key];
      const oldKeys = old ? Object.keys(old) : [];
      const unchanged =
        old &&
        Object.keys(old).length === nextEntries.size &&
        Object.entries(values).every(
          ([name, value], index) =>
            oldKeys[index] === name && old[name] === value,
        );
      Object.assign(result, { [key]: unchanged ? old : values });
    }
    previous = source;
    previousEvent = activeEvent;
    previousDay = activeDay;
    previousResult = result;
    entries = nextEntries;
    return result;
  };
}
