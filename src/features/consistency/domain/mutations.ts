import { interpretLegacyGroup } from "./context";
import { preserveDayBucketKeys } from "./dayBuckets";
import { resolveSimpleKey } from "./context";
import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type { MutationPlan } from "../../../app/commands/applicationMutationCoordinator";
import { semanticSignature } from "../../../app/commands/applicationMutationCoordinator";
import type { ShoppingItem } from "../../../types/item";
import type {
  DayMapData,
  HallDefinition,
  HallRouteSettings,
  RouteSettings,
} from "../../../types/map";
import { MAPLESS_HALL_KEY } from "../../../types/map";
import type { HallSelectionIntent } from "../../../types/consistency";
import { createEventConsistency } from "../../../types/consistency";
import {
  existingDayKey,
  ensureDayConsistency,
  ensureVisitContext,
  getContextHalls,
  hallGroupKey,
  resolveDayMap,
  sameDay,
  sameHall,
} from "./context";
import {
  applyMembershipIntent,
  createMembershipResolver,
  resolveLocation,
  resolveMembership,
} from "./membership";
import {
  decodeHallGroup,
  decodeHallRef,
  projectConsistencySnapshot,
} from "./projection";
import { mapContextEntries } from "./migration";
import { reconcileConsistencyReferences } from "./references";
import { projectItemsToExecutionVisits } from "../../../utils/visitProjection";

const equal = (a: unknown, b: unknown): boolean =>
  semanticSignature(a) === semanticSignature(b);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
/** Captures changed fields instead of carrying an old whole snapshot into the queue. */
export function applyChangedFields(
  base: unknown,
  desired: unknown,
  latest: unknown,
): unknown {
  if (equal(base, desired)) return latest;
  if (isRecord(base) && isRecord(desired) && isRecord(latest)) {
    const result = { ...latest };
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(desired),
    ])) {
      if (equal(base[key], desired[key])) continue;
      if (!Object.prototype.hasOwnProperty.call(desired, key))
        delete result[key];
      else
        Object.defineProperty(result, key, {
          value: applyChangedFields(base[key], desired[key], latest[key]),
          enumerable: true,
          writable: true,
          configurable: true,
        });
    }
    return result;
  }
  const identifiable = (
    value: unknown,
  ): value is Array<Record<string, unknown> & { id: string }> =>
    Array.isArray(value) &&
    value.every((entry) => isRecord(entry) && typeof entry.id === "string");
  if (identifiable(base) && identifiable(desired) && identifiable(latest)) {
    const baseById = new Map(base.map((entry) => [entry.id, entry]));
    const desiredById = new Map(desired.map((entry) => [entry.id, entry]));
    const latestById = new Map(latest.map((entry) => [entry.id, entry]));
    const surviving = latest.filter(
      (entry) => !baseById.has(entry.id) || desiredById.has(entry.id),
    );
    const orderedKnown = desired
      .filter((entry) => latestById.has(entry.id) || !baseById.has(entry.id))
      .map((entry) => entry.id);
    let index = 0;
    const order = surviving.map((entry) =>
      desiredById.has(entry.id) ? orderedKnown[index++] : entry.id,
    );
    order.push(...orderedKnown.slice(index));
    return [...new Set(order)].map((id) => {
      const desiredItem = desiredById.get(id),
        old = baseById.get(id),
        current = latestById.get(id);
      return desiredItem
        ? current && old
          ? applyChangedFields(old, desiredItem, current)
          : structuredClone(desiredItem)
        : current;
    });
  }
  if (
    Array.isArray(base) &&
    Array.isArray(desired) &&
    Array.isArray(latest) &&
    [...base, ...desired, ...latest].every((value) => typeof value === "string")
  ) {
    const old = new Set(base as string[]);
    const wanted = new Set(desired as string[]);
    const current = new Set(latest as string[]);
    const ordered = [...new Set(desired as string[])].filter(
      (id) => current.has(id) || !old.has(id),
    );
    const survivors = [...new Set(latest as string[])].filter(
      (id) => !old.has(id) || wanted.has(id),
    );
    let index = 0;
    const result = survivors.map((id) =>
      wanted.has(id) ? ordered[index++] : id,
    );
    return [...new Set([...result, ...ordered.slice(index)])];
  }
  return structuredClone(desired);
}
export interface MutationContext {
  eventName: string | null;
  day: string;
  mapKey?: string | null;
  selection?: { itemId: string; intent: HallSelectionIntent };
  confirm?: boolean;
}
export function planProjectedMutation(
  source: PersistenceSnapshot,
  patch: Partial<PersistenceSnapshot>,
  input: MutationContext,
): MutationPlan {
  const beforeProjection = projectConsistencySnapshot(
    source,
    input.eventName,
    input.day,
  );
  const proposed = { ...beforeProjection, ...patch };
  const next = structuredClone(source);
  const details: string[] = [];
  const comparisons: unknown[] = [];
  const standard = [
    "eventMetadata",
    "mapData",
    "mapRotationSettings",
    "mapViewportSettings",
    "eventConsistency",
  ] as const;
  for (const key of standard)
    if (patch[key] !== undefined)
      Object.assign(next, { [key]: structuredClone(patch[key]) });
  for (const key of ["executeModeItems", "dayModes"] as const)
    if (patch[key])
      Object.assign(next, {
        [key]: Object.fromEntries(
          Object.entries(patch[key]).map(([name, days]) => [
            name,
            equal(days, beforeProjection[key][name])
              ? source[key][name]
              : preserveDayBucketKeys(
                  source[key][name] as Record<string, unknown> | undefined,
                  days,
                ),
          ]),
        ),
      });
  for (const eventName of Object.keys(next.eventLists))
    next.eventConsistency[eventName] ??= createEventConsistency();
  if (patch.hallDefinitions) {
    next.hallDefinitions = Object.fromEntries(
      Object.entries(patch.hallDefinitions).map(([eventName, sources]) => [
        eventName,
        Object.fromEntries(
          Object.entries(sources).map(([key, raw]) => [
            key.startsWith(`${MAPLESS_HALL_KEY}:`)
              ? (() => {
                  const found = resolveSimpleKey(
                    source.hallDefinitions[eventName],
                    key.slice(MAPLESS_HALL_KEY.length + 1),
                  );
                  if (found.status === "ambiguous")
                    throw new Error("日付別ホールの統合を確認してください。");
                  return found.status === "resolved" ? found.key : key;
                })()
              : key,
            (raw as HallDefinition[]).map((hall) => ({
              ...hall,
              id: decodeHallRef(hall.id)?.hallId ?? hall.id,
            })),
          ]),
        ),
      ]),
    );
  }
  if (patch.eventLists) {
    next.eventLists = Object.fromEntries(
      Object.entries(patch.eventLists).map(([eventName, raw]) => [
        eventName,
        (raw as ShoppingItem[]).map((item) => {
          const canonical = { ...item };
          delete canonical.manualHallId;
          return canonical;
        }),
      ]),
    );

    for (const eventName of Object.keys(next.eventLists))
      next.eventConsistency[eventName] ??= createEventConsistency();
  }
  // Route updates carry an explicit day; a map name is never a day bucket.
  for (const eventName of new Set([
    ...(patch.hallRouteSettings
      ? [
          ...Object.keys(patch.hallRouteSettings),
          ...Object.keys(beforeProjection.hallRouteSettings),
        ]
      : []),
    ...(patch.routeSettings
      ? [
          ...Object.keys(patch.routeSettings),
          ...Object.keys(beforeProjection.routeSettings),
        ]
      : []),
  ])) {
    const event = next.eventConsistency[eventName];
    if (!event) continue;
    const changedRoutes =
      !equal(
        patch.hallRouteSettings
          ? patch.hallRouteSettings[eventName]
          : beforeProjection.hallRouteSettings[eventName],
        beforeProjection.hallRouteSettings[eventName],
      ) ||
      !equal(
        patch.routeSettings
          ? patch.routeSettings[eventName]
          : beforeProjection.routeSettings[eventName],
        beforeProjection.routeSettings[eventName],
      );
    if (!changedRoutes) continue;
    const day = input.day;
    const targetDay = ensureDayConsistency(event, day, [
      next.executeModeItems[eventName],
      next.dayModes[eventName],
    ]);
    for (const [key, raw] of Object.entries(
      patch.hallRouteSettings?.[eventName] ?? {},
    )) {
      if (equal(raw, beforeProjection.hallRouteSettings[eventName]?.[key]))
        continue;
      const mapKey = key.startsWith(`${MAPLESS_HALL_KEY}:`) ? null : key;
      const target = ensureVisitContext(targetDay, mapKey);
      const settings = raw as HallRouteSettings;
      const decodeGroup = (id: string) => {
        const decoded = decodeHallGroup(id);
        if (decoded) return decoded;
        const candidates = interpretLegacyGroup(
          id,
          getContextHalls(
            next.hallDefinitions[eventName] as Record<string, HallDefinition[]>,
            day,
            mapKey,
          ),
        );
        return candidates.length === 1 ? candidates[0] : null;
      };
      target.hallOrder = settings.hallOrder.map((id) => {
        const group = decodeGroup(id);
        if (!group) throw new Error("巡回先の保存元を確認してください。");
        return group;
      });
      target.hallVisitLists = settings.hallVisitLists.map((list) => {
        const group = decodeGroup(list.hallId);
        if (!group) throw new Error("訪問先の保存元を確認してください。");
        const old = target.hallVisitLists.find(
          (old) => hallGroupKey(old.group) === hallGroupKey(group),
        );
        return {
          group,
          itemIds: [...list.itemIds],
          ...(old?.legacyHallId ? { legacyHallId: old.legacyHallId } : {}),
        };
      });
    }
    if (patch.hallRouteSettings) {
      for (const key of Object.keys(
        beforeProjection.hallRouteSettings[eventName] ?? {},
      ))
        if (
          !Object.prototype.hasOwnProperty.call(
            patch.hallRouteSettings[eventName] ?? {},
            key,
          )
        ) {
          const context = ensureVisitContext(
            targetDay,
            key.startsWith(`${MAPLESS_HALL_KEY}:`) ? null : key,
          );
          context.hallOrder = [];
          context.hallVisitLists = [];
        }
    }
    if (patch.routeSettings) {
      for (const key of Object.keys(
        beforeProjection.routeSettings[eventName] ?? {},
      ))
        if (
          !Object.prototype.hasOwnProperty.call(
            patch.routeSettings[eventName] ?? {},
            key,
          )
        )
          ensureVisitContext(targetDay, key).route = null;
    }
    for (const [mapKey, raw] of Object.entries(
      patch.routeSettings?.[eventName] ?? {},
    )) {
      if (!equal(raw, beforeProjection.routeSettings[eventName]?.[mapKey]))
        ensureVisitContext(targetDay, mapKey).route = structuredClone(
          raw as RouteSettings,
        );
    }
  }
  for (const [eventName, rawItems] of Object.entries(next.eventLists)) {
    const items = rawItems as ShoppingItem[];
    const currentById = new Map(items.map((item) => [item.id, item]));
    const previous = new Map(
      ((source.eventLists[eventName] as ShoppingItem[] | undefined) ?? []).map(
        (item) => [item.id, item],
      ),
    );
    const oldDisplayed = new Map(
      (
        (beforeProjection.eventLists[eventName] as
          | ShoppingItem[]
          | undefined) ?? []
      ).map((item) => [item.id, item]),
    );
    const newDisplayed = new Map(
      (
        (proposed.eventLists[eventName] as ShoppingItem[] | undefined) ?? []
      ).map((item) => [item.id, item]),
    );
    const maps = (next.mapData[eventName] ?? {}) as Record<string, DayMapData>;
    const definitions = (next.hallDefinitions[eventName] ?? {}) as Record<
      string,
      HallDefinition[]
    >;
    const event = next.eventConsistency[eventName];
    const definitionChanged =
      !equal(
        source.hallDefinitions[eventName],
        next.hallDefinitions[eventName],
      ) || !equal(source.mapData[eventName], next.mapData[eventName]);
    const changedDefinitionKeys = new Set(
      [
        ...Object.keys(source.hallDefinitions[eventName] ?? {}),
        ...Object.keys(definitions),
      ].filter(
        (key) =>
          !equal(source.hallDefinitions[eventName]?.[key], definitions[key]),
      ),
    );
    const changedMapKeys = new Set(
      [
        ...Object.keys(source.mapData[eventName] ?? {}),
        ...Object.keys(maps),
      ].filter((key) => !equal(source.mapData[eventName]?.[key], maps[key])),
    );
    const affectedDays = new Set<string>();
    const affect = (day: string) =>
      affectedDays.add(day.replace(/\u3000/g, " ").trim());
    for (const old of previous.values()) {
      const current = currentById.get(old.id);
      if (
        !current ||
        !sameDay(old.eventDate, current.eventDate) ||
        old.block !== current.block ||
        old.number !== current.number ||
        old.priorityLevel !== current.priorityLevel
      ) {
        affect(old.eventDate);
        if (current) affect(current.eventDate);
      }
    }
    for (const [day, ids] of Object.entries(
      next.executeModeItems[eventName] ?? {},
    ))
      if (!equal(ids, source.executeModeItems[eventName]?.[day])) affect(day);
    if (definitionChanged)
      for (const dayKey of new Set(items.map((item) => item.eventDate))) {
        const savedDays = Object.entries(event.days).filter(([key]) =>
          sameDay(key, dayKey),
        );
        const candidateMaps = new Set([
          ...resolveDayMap(maps, dayKey).candidates,
          ...savedDays.flatMap(
            ([, value]) =>
              resolveDayMap(maps, dayKey, value.selectedMapKey).candidates,
          ),
        ]);
        const simpleChanged = [...changedDefinitionKeys].some(
          (key) =>
            key.startsWith(MAPLESS_HALL_KEY + ":") &&
            sameDay(key.slice(MAPLESS_HALL_KEY.length + 1), dayKey),
        );
        if (
          !simpleChanged &&
          ![...candidateMaps].some(
            (key) => changedDefinitionKeys.has(key) || changedMapKeys.has(key),
          )
        )
          continue;
        const day = ensureDayConsistency(event, dayKey, [
          next.executeModeItems[eventName],
          next.dayModes[eventName],
        ]);
        const selected = resolveDayMap(maps, dayKey, day.selectedMapKey);
        for (const key of selected.candidates)
          if (changedDefinitionKeys.has(key) || changedMapKeys.has(key))
            ensureVisitContext(day, key);
        if (
          selected.status === "none" &&
          [...changedDefinitionKeys].some(
            (key) =>
              key.startsWith(MAPLESS_HALL_KEY + ":") &&
              sameDay(key.slice(MAPLESS_HALL_KEY.length + 1), dayKey),
          )
        )
          ensureVisitContext(day, null);
      }
    // Item identity/explicit choice changes use the destination's latest members.
    for (const item of items) {
      const old = previous.get(item.id);
      const identityChanged =
        !old ||
        !sameDay(old.eventDate, item.eventDate) ||
        old.block !== item.block ||
        old.number !== item.number;
      if (
        !identityChanged &&
        oldDisplayed.get(item.id)?.manualHallId ===
          newDisplayed.get(item.id)?.manualHallId &&
        (input.selection?.itemId !== item.id ||
          input.selection.intent.kind === "unchanged")
      )
        continue;
      if (identityChanged) affect(item.eventDate);
      const day = ensureDayConsistency(event, item.eventDate, [
        next.executeModeItems[eventName],
        next.dayModes[eventName],
      ]);
      const selected = resolveDayMap(maps, item.eventDate, day.selectedMapKey);
      const mapKeys = identityChanged
        ? [...new Set([...selected.candidates, ...Object.keys(day.maps)])]
        : selected.status === "resolved"
          ? [selected.key]
          : [];
      const allContexts: Array<string | null> =
        selected.status === "none" ? [null, ...mapKeys] : mapKeys;
      const contexts = allContexts;
      if (
        selected.status === "selection-required" &&
        input.selection?.itemId === item.id &&
        input.selection.intent.kind !== "unchanged"
      )
        throw new Error("マップの選択が必要です。");
      for (const mapKey of contexts) {
        if (mapKey !== null && !maps[mapKey]) continue;
        const map =
          mapKey === null
            ? { status: "none" as const, candidates: [] as [] }
            : {
                status: "resolved" as const,
                key: mapKey,
                data: maps[mapKey],
                candidates: [mapKey],
              };
        const halls = getContextHalls(definitions, item.eventDate, mapKey);
        let context = ensureVisitContext(day, mapKey);
        // Carry this item's source choice across dates only when it remains valid.
        if (identityChanged && old && !context.assignments[item.id]) {
          const oldDayKey = existingDayKey(event.days, old.eventDate);
          const oldDay = oldDayKey ? event.days[oldDayKey] : undefined;
          const oldContext =
            mapKey === null ? oldDay?.mapless : oldDay?.maps[mapKey];
          if (oldContext?.assignments[item.id])
            context.assignments[item.id] = oldContext.assignments[item.id];
        }
        let intent: HallSelectionIntent = { kind: "unchanged" };
        const currentMap = selected.status === "resolved" ? selected.key : null;
        if (mapKey === currentMap && eventName === input.eventName) {
          if (input.selection?.itemId === item.id)
            intent = input.selection.intent;
          else if (
            oldDisplayed.get(item.id)?.manualHallId !==
            newDisplayed.get(item.id)?.manualHallId
          ) {
            const encoded = newDisplayed.get(item.id)?.manualHallId;
            const hall = encoded ? decodeHallRef(encoded) : null;
            intent = hall ? { kind: "select", hall } : { kind: "automatic" };
          }
        }
        const before = structuredClone(context.assignments);
        context = applyMembershipIntent(item, old, intent, {
          items,
          day: item.eventDate,
          map,
          halls,
          context,
        });
        // A definition edit can invalidate a choice even if the item did not move.
        const resolveUpdated = createMembershipResolver({
          items,
          day: item.eventDate,
          map,
          halls,
          context,
        });
        for (const member of items.filter((member) =>
          sameDay(member.eventDate, item.eventDate),
        )) {
          const hall = context.assignments[member.id];
          if (
            hall &&
            !resolveUpdated(member).candidates.some((candidate) =>
              sameHall(candidate, hall),
            )
          )
            delete context.assignments[member.id];
        }
        if (mapKey === null) day.mapless = context;
        else day.maps[mapKey] = context;
        const resolution = resolveMembership(item, {
          items,
          day: item.eventDate,
          map,
          halls,
          context,
        });
        if (
          !equal(before, context.assignments) ||
          identityChanged ||
          intent.kind !== "unchanged"
        ) {
          const label = resolution.hall
            ? (halls.find((hall) => sameHall(hall.ref, resolution.hall))
                ?.definition.name ?? "未割当")
            : resolution.status === "confirmation-required"
              ? "所属確認が必要"
              : "未割当";
          details.push(
            `${item.eventDate} / ${mapKey ?? "マップなし"}: ${item.circle}・${item.title} → ${label}（共有 ${resolution.memberIds.length} 件）`,
          );
          comparisons.push({
            eventName,
            day: item.eventDate,
            mapKey,
            itemId: item.id,
            identity: [item.block, item.number, item.priorityLevel],
            before,
            after: context.assignments,
            resolution,
            definitions: halls,
          });
        }
      }
    }
    for (const { day, mapKey, context } of mapContextEntries(event)) {
      const oldContext =
        mapKey === null
          ? source.eventConsistency[eventName]?.days[day]?.mapless
          : source.eventConsistency[eventName]?.days[day]?.maps[mapKey];
      const definitionAffected =
        (mapKey !== null &&
          (changedMapKeys.has(mapKey) || changedDefinitionKeys.has(mapKey))) ||
        [...changedDefinitionKeys].some(
          (key) =>
            key.startsWith(`${MAPLESS_HALL_KEY}:`) &&
            sameDay(key.slice(MAPLESS_HALL_KEY.length + 1), day),
        );
      if (
        !affectedDays.has(day.replace(/\u3000/g, " ").trim()) &&
        !definitionAffected &&
        equal(context, oldContext)
      )
        continue;
      const executeKey = existingDayKey(next.executeModeItems[eventName], day);
      const ids = executeKey
        ? next.executeModeItems[eventName][executeKey]
        : [];
      const byId = new Map(items.map((item) => [item.id, item]));
      const ordered = projectItemsToExecutionVisits(
        ids
          .map((id) => byId.get(id))
          .filter(
            (item): item is ShoppingItem =>
              !!item && sameDay(item.eventDate, day),
          ),
      ).flatMap((visit) => visit.items);
      const map =
        mapKey !== null && maps[mapKey]
          ? {
              status: "resolved" as const,
              key: mapKey,
              data: maps[mapKey],
              candidates: [mapKey],
            }
          : { status: "none" as const, candidates: [] as [] };
      const halls = getContextHalls(definitions, day, mapKey);
      if (definitionAffected) {
        const beforeAssignments = structuredClone(context.assignments);
        const candidates = createMembershipResolver({
          items,
          day,
          map,
          halls,
          context,
        });
        const dayItems = items.filter((item) => sameDay(item.eventDate, day));
        for (const item of dayItems) {
          const assigned = context.assignments[item.id];
          if (
            assigned &&
            !candidates(item).candidates.some((hall) =>
              sameHall(hall, assigned),
            )
          )
            delete context.assignments[item.id];
        }
        const resolveAfter = createMembershipResolver({
          items,
          day,
          map,
          halls,
          context,
        });
        const units = new Map<string | null, ReturnType<typeof resolveAfter>>();
        for (const item of dayItems) {
          const resolution = resolveAfter(item);
          if (!units.has(resolution.sharedKey))
            units.set(resolution.sharedKey, resolution);
        }
        for (const resolution of units.values()) {
          const label = resolution.hall
            ? (halls.find((hall) => sameHall(hall.ref, resolution.hall))
                ?.definition.name ?? "未割当")
            : resolution.status === "confirmation-required"
              ? "所属確認が必要"
              : "未割当";
          details.push(
            `${day} / ${mapKey ?? "マップなし"}: ${resolution.memberIds.join("、")} → ${label}`,
          );
        }
        comparisons.push({
          eventName,
          day,
          mapKey,
          before: beforeAssignments,
          after: context.assignments,
          units: [...units.values()],
        });
      }
      const resolve = createMembershipResolver({
        items,
        day,
        map,
        halls,
        context,
      });
      const groupFor = (item: ShoppingItem) => ({
        hall: resolve(item).hall,
        priority: item.priorityLevel ?? "none",
      });
      for (const list of context.hallVisitLists)
        list.itemIds = ordered
          .filter(
            (item) =>
              list.itemIds.includes(item.id) &&
              hallGroupKey(groupFor(item)) === hallGroupKey(list.group),
          )
          .map((item) => item.id);
      const listed = new Set(
        context.hallVisitLists.flatMap((list) => list.itemIds),
      );
      for (const item of ordered) {
        const group = groupFor(item);
        if (
          !context.hallOrder.some(
            (entry) => hallGroupKey(entry) === hallGroupKey(group),
          )
        )
          context.hallOrder.push(group);
        if (listed.has(item.id)) continue;
        let list = context.hallVisitLists.find(
          (entry) => hallGroupKey(entry.group) === hallGroupKey(group),
        );
        if (!list) {
          list = { group, itemIds: [] };
          context.hallVisitLists.push(list);
        }
        list.itemIds.push(item.id);
      }
      for (const list of context.hallVisitLists)
        list.itemIds = ordered
          .filter(
            (item) => hallGroupKey(groupFor(item)) === hallGroupKey(list.group),
          )
          .map((item) => item.id);
      // Visibility-only route edits retain the saved path. Membership/order edits
      // rebuild from the current day and the full mixed hall order.
      const rebuildRoute =
        affectedDays.has(day.replace(/\u3000/g, " ").trim()) ||
        definitionAffected ||
        !equal(context.assignments, oldContext?.assignments) ||
        !equal(context.hallOrder, oldContext?.hallOrder) ||
        !equal(context.hallVisitLists, oldContext?.hallVisitLists);
      if (rebuildRoute && context.route && map.status === "resolved") {
        const points: RouteSettings["visitOrder"] = [];
        const order = new Map(
          context.hallOrder.map((group, index) => [hallGroupKey(group), index]),
        );
        const routeItems = [...ordered].sort(
          (a, b) =>
            (order.get(hallGroupKey(groupFor(a))) ?? order.size) -
            (order.get(hallGroupKey(groupFor(b))) ?? order.size),
        );
        const groupedPoints = new Map<
          string,
          RouteSettings["visitOrder"][number]
        >();
        for (const item of routeItems) {
          const location = resolveLocation(map.data, item);
          if (location.status !== "resolved") continue;
          const pointKey = JSON.stringify([
            hallGroupKey(groupFor(item)),
            location.location.cell.row,
            location.location.cell.col,
          ]);
          const found = groupedPoints.get(pointKey);
          if (found) found.itemIds.push(item.id);
          else {
            const point = {
              row: location.location.cell.row,
              col: location.location.cell.col,
              blockName: item.block,
              number: location.location.numberValue,
              order: points.length,
              itemIds: [item.id],
            };
            points.push(point);
            groupedPoints.set(pointKey, point);
          }
        }
        context.route.visitOrder = points;
      }
    }
  }
  const repaired = reconcileConsistencyReferences(next);
  if (patch.hallDefinitions || patch.mapData) {
    comparisons.push({
      previousDefinitions: Object.fromEntries(
        Object.keys(patch.hallDefinitions ?? {})
          .filter(
            (name) =>
              !equal(source.hallDefinitions[name], next.hallDefinitions[name]),
          )
          .map((name) => [name, source.hallDefinitions[name]]),
      ),
      previousMaps: Object.fromEntries(
        Object.keys(patch.mapData ?? {})
          .filter((name) => !equal(source.mapData[name], next.mapData[name]))
          .map((name) => [name, source.mapData[name]]),
      ),
      definitions: Object.fromEntries(
        Object.keys(patch.hallDefinitions ?? {})
          .filter(
            (name) =>
              !equal(source.hallDefinitions[name], next.hallDefinitions[name]),
          )
          .map((name) => [name, next.hallDefinitions[name]]),
      ),
      maps: Object.fromEntries(
        Object.keys(patch.mapData ?? {})
          .filter((name) => !equal(source.mapData[name], next.mapData[name]))
          .map((name) => [name, next.mapData[name]]),
      ),
    });
    if (details.length === 0)
      details.push("マップ・ホール定義と関連する所属・巡回情報を保存します。");
  }
  return {
    snapshot: repaired.data,
    ...(details.length && input.confirm !== false
      ? {
          confirmation: {
            title: "所属・配置の変更を確認",
            details: [
              ...new Set([
                ...details,
                ...repaired.changes.map((change) => change.message),
              ]),
            ],
            comparison: comparisons,
          },
        }
      : {}),
  };
}
