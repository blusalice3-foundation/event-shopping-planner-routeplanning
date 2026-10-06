import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../../types/item";
import type {
  BlockDetectionSettingsStore,
  DayMapData,
  HallDefinition,
  HallRouteSettings,
  RouteSettings,
} from "../../../types/map";
import { MAPLESS_HALL_KEY, getMaplessKey } from "../../../types/map";
import type {
  EventConsistencyV1,
  HallRef,
  LegacyPendingV1,
  VisitContextV1,
} from "../../../types/consistency";
import {
  createDayConsistency,
  createEventConsistency,
} from "../../../types/consistency";
import {
  resolveDayKey,
  resolveSimpleKey,
  collectEventDays,
  ensureDayConsistency,
  ensureVisitContext,
  getContextHalls,
  getDayConsistency,
  hallGroupKey,
  interpretLegacyGroup,
  normalizeMapDay,
  sameDay,
  type SourcedHall,
} from "./context";
import { assertEventConsistency } from "./validation";

export type LegacySnapshot = Omit<PersistenceSnapshot, "eventConsistency">;
export interface ConsistencyChange {
  path: string;
  message: string;
}
export interface MigrationResult {
  data: PersistenceSnapshot;
  changes: ConsistencyChange[];
}
/** Receives structurally validated input. It never mutates or persists its source. */
export function migrateLegacyConsistency(
  source: LegacySnapshot | PersistenceSnapshot,
  settings: BlockDetectionSettingsStore = {},
): MigrationResult {
  if (Object.prototype.hasOwnProperty.call(source, "eventConsistency")) {
    assertEventConsistency((source as PersistenceSnapshot).eventConsistency);
    return {
      data: structuredClone(source as PersistenceSnapshot),
      changes: [],
    };
  }
  const data: PersistenceSnapshot = {
    ...structuredClone(source),
    eventConsistency: {},
  };
  const changes: ConsistencyChange[] = [];
  for (const [eventName, rawItems] of Object.entries(data.eventLists)) {
    const items = rawItems as ShoppingItem[];
    const event = createEventConsistency();
    Object.defineProperty(data.eventConsistency, eventName, {
      value: event,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    event.blockDetectionSettings = structuredClone(settings[eventName] ?? null);
    const definitions = (data.hallDefinitions[eventName] ??= {}) as Record<
      string,
      HallDefinition[]
    >;
    const maps = (data.mapData[eventName] ?? {}) as Record<string, DayMapData>;
    const simpleDayKeys = Object.fromEntries(
      Object.keys(definitions)
        .filter((key) => key.startsWith(`${MAPLESS_HALL_KEY}:`))
        .map((key) => [key.slice(MAPLESS_HALL_KEY.length + 1), true]),
    );
    const days = collectEventDays(
      items,
      data.executeModeItems[eventName],
      data.dayModes[eventName],
      simpleDayKeys,
    );
    const addPending = (entry: LegacyPendingV1) => {
      event.legacyPending.push(structuredClone(entry));
      changes.push({
        path: `${eventName}.${entry.sourceKey}`,
        message: "旧設定の対応先を確認してください。原値を保全しています。",
      });
    };
    const records = [
      data.executeModeItems[eventName],
      data.dayModes[eventName],
      simpleDayKeys,
    ];
    const ambiguousDays = new Set(
      days.filter((day) =>
        records.some(
          (record) => resolveDayKey(record, day).status === "ambiguous",
        ),
      ),
    );
    // Keep duplicate saved day buckets intact; their contents require a confirmed merge.
    for (const day of ambiguousDays)
      for (const record of records)
        for (const key of Object.keys(record ?? {}))
          if (sameDay(key, day)) ensureDayConsistencyExact(event, key);
    const context = (
      day: string,
      mapKey: string | null,
    ): VisitContextV1 | null =>
      ambiguousDays.has(day.replace(/\u3000/g, " ").trim())
        ? null
        : ensureVisitContext(ensureDayConsistency(event, day, records), mapKey);
    // Preserve definitions before the former hydration normalizer can discard them.
    for (const [sourceKey, halls] of Object.entries(definitions)) {
      const legacySimple =
        sourceKey === MAPLESS_HALL_KEY
          ? halls
          : !sourceKey.startsWith(`${MAPLESS_HALL_KEY}:`)
            ? halls.filter(
                (hall) => hall.vertices.length < 3 && hall.blockNames,
              )
            : [];
      if (!legacySimple.length) continue;
      const candidateDays =
        sourceKey === MAPLESS_HALL_KEY
          ? days
          : days.filter(
              (day) => normalizeMapDay(day) === normalizeMapDay(sourceKey),
            );
      if (
        candidateDays.length === 1 &&
        resolveSimpleKey(definitions, candidateDays[0]).status === "missing" &&
        !ambiguousDays.has(candidateDays[0])
      ) {
        definitions[getMaplessKey(candidateDays[0])] =
          structuredClone(legacySimple);
        changes.push({
          path: `${eventName}.${sourceKey}`,
          message: `簡易ホールを${candidateDays[0]}へ移行します。`,
        });
      } else {
        addPending({
          sourceKey,
          sourceDayKey: candidateDays.length === 1 ? candidateDays[0] : null,
          sourceMapKey: sourceKey === MAPLESS_HALL_KEY ? null : sourceKey,
          reason:
            candidateDays.length === 1
              ? "conflicting-definition"
              : "ambiguous-day",
          payload: { kind: "hall-definitions", halls: legacySimple },
        });
      }
      if (sourceKey === MAPLESS_HALL_KEY) delete definitions[sourceKey];
      else
        definitions[sourceKey] = halls.filter(
          (hall) => !legacySimple.includes(hall),
        );
    }
    for (const item of items) {
      if (item.manualHallId === undefined) continue;
      const candidateMaps = Object.keys(maps).filter(
        (key) => normalizeMapDay(key) === normalizeMapDay(item.eventDate),
      );
      const halls = new Map<
        string,
        { hall: SourcedHall; mapKey: string | null }
      >();
      const add = (mapKey: string | null) => {
        for (const hall of getContextHalls(
          definitions,
          item.eventDate,
          mapKey,
        ).filter((hall) => hall.ref.hallId === item.manualHallId)) {
          const key = JSON.stringify(hall.ref);
          halls.set(key, {
            hall,
            mapKey:
              hall.ref.kind === "map"
                ? hall.ref.mapKey
                : candidateMaps.length === 1
                  ? candidateMaps[0]
                  : null,
          });
        }
      };
      add(null);
      candidateMaps.forEach(add);
      const choices = [...halls.values()];
      if (
        choices.length === 1 &&
        (choices[0].hall.ref.kind === "map" || candidateMaps.length <= 1)
      ) {
        const target = context(item.eventDate, choices[0].mapKey);
        if (target) target.assignments[item.id] = choices[0].hall.ref;
        else
          addPending({
            sourceKey: "eventLists",
            sourceDayKey: item.eventDate,
            sourceMapKey: choices[0].mapKey,
            reason: "ambiguous-day",
            payload: {
              kind: "manual-hall",
              itemId: item.id,
              manualHallId: item.manualHallId,
            },
          });
      } else {
        const pendingDefinition = event.legacyPending.some(
          (p) =>
            p.payload.kind === "hall-definitions" &&
            p.payload.halls.some((hall) => hall.id === item.manualHallId),
        );
        if (choices.length || pendingDefinition)
          addPending({
            sourceKey: "eventLists",
            sourceDayKey: item.eventDate,
            sourceMapKey: null,
            reason: "ambiguous-source",
            payload: {
              kind: "manual-hall",
              itemId: item.id,
              manualHallId: item.manualHallId,
            },
          });
        else
          changes.push({
            path: `${eventName}.${item.id}.manualHallId`,
            message: `存在しないホール「${item.manualHallId}」への指定を解除します。`,
          });
      }
      delete item.manualHallId;
    }
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const sourceDays = (sourceKey: string): string[] =>
      sourceKey.startsWith(`${MAPLESS_HALL_KEY}:`)
        ? days.filter((day) =>
            sameDay(day, sourceKey.slice(MAPLESS_HALL_KEY.length + 1)),
          )
        : sourceKey === MAPLESS_HALL_KEY
          ? days
          : days.filter(
              (day) => normalizeMapDay(day) === normalizeMapDay(sourceKey),
            );
    for (const [sourceKey, raw] of Object.entries(
      data.hallRouteSettings[eventName] ?? {},
    )) {
      const settings = raw as HallRouteSettings;
      for (const [index, list] of settings.hallVisitLists.entries()) {
        const invalid = list.itemIds.filter((id) => !itemsById.has(id));
        if (invalid.length)
          changes.push({
            path: `${eventName}.hallRouteSettings.${sourceKey}.hallVisitLists[${index}]`,
            message: `存在しない品目への訪問参照を ${invalid.length} 件整理します。`,
          });
      }
      const candidates = sourceDays(sourceKey);
      const outside = settings.hallVisitLists
        .flatMap((list) => list.itemIds)
        .filter((id) => {
          const item = itemsById.get(id);
          return (
            item &&
            candidates.length > 0 &&
            !candidates.some((day) => sameDay(item.eventDate, day))
          );
        });
      if (outside.length)
        changes.push({
          path: [eventName, "hallRouteSettings", sourceKey].join("."),
          message:
            "訪問先の日付と一致しない品目参照を " +
            outside.length +
            " 件整理します。",
        });
      const mapKey = sourceKey.startsWith(MAPLESS_HALL_KEY) ? null : sourceKey;
      const referencedDays = [
        ...new Set(
          settings.hallVisitLists
            .flatMap((list) => list.itemIds)
            .map((id) => itemsById.get(id)?.eventDate)
            .filter((day): day is string => day !== undefined),
        ),
      ];
      const orderDays =
        candidates.length === 1
          ? candidates
          : referencedDays.length === 1
            ? candidates.filter((day) => sameDay(day, referencedDays[0]))
            : [];
      let pendingOrder =
        settings.hallOrder.length > 0 && orderDays.length !== 1;
      for (const day of candidates) {
        const target = context(day, mapKey);
        if (!target) {
          addPending({
            sourceKey,
            sourceDayKey: day,
            sourceMapKey: mapKey,
            reason: "ambiguous-day",
            payload: { kind: "hall-route-settings", settings },
          });
          continue;
        }
        const halls = getContextHalls(definitions, day, mapKey);
        if (orderDays.includes(day))
          for (const id of settings.hallOrder) {
            const groups = interpretLegacyGroup(id, halls);
            if (groups.length === 1) {
              if (
                !target.hallOrder.some(
                  (group) => hallGroupKey(group) === hallGroupKey(groups[0]),
                )
              )
                target.hallOrder.push(groups[0]);
            } else pendingOrder = true;
          }
        for (const list of settings.hallVisitLists) {
          const ids = list.itemIds.filter((id) => {
            const item = itemsById.get(id);
            return item && sameDay(item.eventDate, day);
          });
          if (
            !ids.length &&
            (list.itemIds.length > 0 || candidates.length !== 1)
          )
            continue;
          const groups = interpretLegacyGroup(list.hallId, halls);
          if (groups.length === 1)
            target.hallVisitLists.push({
              group: groups[0],
              itemIds: ids,
              legacyHallId: list.hallId,
            });
          else
            addPending({
              sourceKey,
              sourceDayKey: day,
              sourceMapKey: mapKey,
              reason: "ambiguous-source",
              payload: {
                kind: "hall-route-settings",
                settings: {
                  hallOrder: [],
                  hallVisitLists: [{ ...list, itemIds: ids }],
                },
              },
            });
        }
      }
      const pendingLists =
        candidates.length > 1
          ? settings.hallVisitLists.filter((list) => list.itemIds.length === 0)
          : [];
      if (pendingOrder || pendingLists.length || !candidates.length)
        addPending({
          sourceKey,
          sourceDayKey: null,
          sourceMapKey: mapKey,
          reason: "ambiguous-day",
          payload: {
            kind: "hall-route-settings",
            settings:
              !candidates.length || pendingLists.length > 0
                ? settings
                : {
                    hallOrder: pendingOrder ? settings.hallOrder : [],
                    hallVisitLists: pendingLists,
                  },
          },
        });
    }
    for (const [sourceKey, raw] of Object.entries(
      data.routeSettings[eventName] ?? {},
    )) {
      const route = raw as RouteSettings;
      for (const [index, point] of route.visitOrder.entries()) {
        const invalid = point.itemIds.filter((id) => !itemsById.has(id));
        if (invalid.length)
          changes.push({
            path: `${eventName}.routeSettings.${sourceKey}.visitOrder[${index}]`,
            message: `存在しない品目への経路参照を ${invalid.length} 件整理します。`,
          });
      }
      const candidates = sourceDays(sourceKey);
      const outside = route.visitOrder
        .flatMap((point) => point.itemIds)
        .filter((id) => {
          const item = itemsById.get(id);
          return (
            item &&
            candidates.length > 0 &&
            !candidates.some((day) => sameDay(item.eventDate, day))
          );
        });
      if (outside.length)
        changes.push({
          path: [eventName, "routeSettings", sourceKey].join("."),
          message:
            "経路の日付と一致しない品目参照を " +
            outside.length +
            " 件整理します。",
        });
      if (
        !candidates.length ||
        (route.visitOrder.length === 0 && candidates.length > 1)
      ) {
        addPending({
          sourceKey,
          sourceDayKey: null,
          sourceMapKey: sourceKey,
          reason: "ambiguous-day",
          payload: { kind: "route-settings", settings: route },
        });
        continue;
      }
      const pendingPoints =
        candidates.length > 1
          ? route.visitOrder.filter((point) => point.itemIds.length === 0)
          : [];
      if (pendingPoints.length)
        addPending({
          sourceKey,
          sourceDayKey: null,
          sourceMapKey: sourceKey,
          reason: "ambiguous-day",
          payload: {
            kind: "route-settings",
            settings: route,
          },
        });
      for (const day of candidates) {
        const visitOrder = route.visitOrder.flatMap((point) => {
          const itemIds = point.itemIds.filter((id) => {
            const item = itemsById.get(id);
            return item && sameDay(item.eventDate, day);
          });
          return itemIds.length ||
            (point.itemIds.length === 0 && candidates.length === 1)
            ? [{ ...point, itemIds }]
            : [];
        });
        if (visitOrder.length || candidates.length === 1) {
          const target = context(day, sourceKey);
          if (target) target.route = { ...route, visitOrder };
          else
            addPending({
              sourceKey,
              sourceDayKey: day,
              sourceMapKey: sourceKey,
              reason: "ambiguous-day",
              payload: {
                kind: "route-settings",
                settings: { ...route, visitOrder },
              },
            });
        }
      }
    }
    for (const day of days) {
      const candidateMaps = Object.keys(maps).filter(
        (key) => normalizeMapDay(key) === normalizeMapDay(day),
      );
      for (const mapKey of candidateMaps.length ? candidateMaps : [null]) {
        const target = context(day, mapKey);
        if (!target) continue;
        const halls = getContextHalls(definitions, day, mapKey);
        const simple =
          mapKey === null ? target : getDayConsistency(event, day)?.mapless;
        const mapOrder = target.hallOrder.length
          ? target.hallOrder
          : halls
              .filter((hall) => hall.ref.kind === "map")
              .map((hall) => ({ hall: hall.ref, priority: "none" as const }));
        const simpleOrder = simple?.hallOrder.length
          ? simple.hallOrder
          : halls
              .filter((hall) => hall.ref.kind === "simple")
              .map((hall) => ({ hall: hall.ref, priority: "none" as const }));
        // Seed the complete order with the old map-then-simple display order.
        // Definition registration order must not replace either saved order.
        target.hallOrder = [...mapOrder, ...simpleOrder].filter(
          (group, index, order) =>
            order.findIndex(
              (candidate) => hallGroupKey(candidate) === hallGroupKey(group),
            ) === index,
        );
      }
    }
    delete data.hallRouteSettings[eventName];
    delete data.routeSettings[eventName];
  }
  return { data, changes };
}
export function mapContextEntries(
  event: EventConsistencyV1,
): Array<{ day: string; mapKey: string | null; context: VisitContextV1 }> {
  return Object.entries(event.days).flatMap(([day, value]) => [
    ...(value.mapless ? [{ day, mapKey: null, context: value.mapless }] : []),
    ...Object.entries(value.maps).map(([mapKey, context]) => ({
      day,
      mapKey,
      context,
    })),
  ]);
}
export function mapHallRefs(
  context: VisitContextV1,
  mapper: (ref: HallRef) => HallRef,
): void {
  for (const [id, ref] of Object.entries(context.assignments))
    context.assignments[id] = mapper(ref);
  context.hallOrder = context.hallOrder.map((group) => ({
    ...group,
    hall: group.hall ? mapper(group.hall) : null,
  }));
  context.hallVisitLists = context.hallVisitLists.map((list) => ({
    ...list,
    group: {
      ...list.group,
      hall: list.group.hall ? mapper(list.group.hall) : null,
    },
  }));
}
function ensureDayConsistencyExact(
  event: EventConsistencyV1,
  key: string,
): void {
  if (!Object.prototype.hasOwnProperty.call(event.days, key))
    Object.defineProperty(event.days, key, {
      value: createDayConsistency(),
      enumerable: true,
      writable: true,
      configurable: true,
    });
}
