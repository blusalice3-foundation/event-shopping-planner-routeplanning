import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type { MutationPlan } from "../../../app/commands/applicationMutationCoordinator";
import { semanticSignature } from "../../../app/commands/applicationMutationCoordinator";
import type {
  DayConsistencyV1,
  HallRef,
  VisitContextV1,
} from "../../../types/consistency";
import {
  createDayConsistency,
  createVisitContext,
} from "../../../types/consistency";
import type { HallDefinition } from "../../../types/map";
import { getMaplessKey, MAPLESS_HALL_KEY } from "../../../types/map";
import { normalizeExecutionVisitDay } from "../../../utils/visitProjection";
import { hallGroupKey, hallRefKey, sameDay } from "./context";
import { mapContextEntries } from "./migration";

const sortedKeys = (record: object | undefined, day: string) =>
  Object.keys(record ?? {})
    .filter((key) => sameDay(key, day))
    .sort((a, b) =>
      a === day ? -1 : b === day ? 1 : a < b ? -1 : a > b ? 1 : 0,
    );
export function duplicateEventDays(
  snapshot: PersistenceSnapshot,
  name: string,
): string[] {
  const definitions = Object.fromEntries(
    Object.keys(snapshot.hallDefinitions[name] ?? {})
      .filter((key) => key.startsWith(`${MAPLESS_HALL_KEY}:`))
      .map((key) => [key.slice(MAPLESS_HALL_KEY.length + 1), true]),
  );
  const records = [
    snapshot.executeModeItems[name],
    snapshot.dayModes[name],
    snapshot.eventConsistency[name]?.days,
    definitions,
  ];
  return [
    ...new Set(
      records.flatMap((record) =>
        Object.keys(record ?? {})
          .filter((key) => sortedKeys(record, key).length > 1)
          .map(normalizeExecutionVisitDay),
      ),
    ),
  ].sort();
}
/** Produces a stable proposal without touching either the source or purchase fields. */
export function planDayMerge(
  snapshot: PersistenceSnapshot,
  name: string,
  requestedDay: string,
  preferredKey = normalizeExecutionVisitDay(requestedDay),
): MutationPlan {
  if (!sameDay(requestedDay, preferredKey))
    throw new Error("統合先は同じ日付を指定してください。");
  const next = structuredClone(snapshot);
  if (
    !duplicateEventDays(snapshot, name).some((day) =>
      sameDay(day, requestedDay),
    )
  )
    return { snapshot: next };
  const details: string[] = [];
  const event = next.eventConsistency[name];
  if (!event) throw new Error("イベントの関連設定がありません。");
  const simpleDefinitions = (next.hallDefinitions[name] ??= {}) as Record<
    string,
    HallDefinition[]
  >;
  const sourceDays = Object.fromEntries(
    Object.entries(simpleDefinitions)
      .filter(([key]) => key.startsWith(`${MAPLESS_HALL_KEY}:`))
      .map(([key, value]) => [key.slice(MAPLESS_HALL_KEY.length + 1), value]),
  );
  const definitionKeys = sortedKeys(sourceDays, preferredKey);
  const definitions: HallDefinition[] = [];
  const remap = new Map<string, HallRef>();
  for (const dayKey of definitionKeys) {
    for (const definition of sourceDays[dayKey]) {
      let id = definition.id;
      const existing = definitions.find((hall) => hall.id === id);
      if (
        existing &&
        semanticSignature(existing) !== semanticSignature(definition)
      ) {
        let suffix = 2;
        while (
          definitions.some((hall) => hall.id === `${definition.id}~${suffix}`)
        )
          suffix++;
        id = `${definition.id}~${suffix}`;
        details.push(
          `ホールIDの衝突: ${JSON.stringify(dayKey)} / ${definition.id} → ${id}（${definition.name}）`,
        );
      }
      if (!definitions.some((hall) => hall.id === id))
        definitions.push({ ...definition, id });
      remap.set(hallRefKey({ kind: "simple", dayKey, hallId: definition.id }), {
        kind: "simple",
        dayKey: preferredKey,
        hallId: id,
      });
    }
    delete simpleDefinitions[getMaplessKey(dayKey)];
  }
  if (definitionKeys.length)
    simpleDefinitions[getMaplessKey(preferredKey)] = definitions;
  const remapRef = (hall: HallRef | null): HallRef | null =>
    hall ? (remap.get(hallRefKey(hall)) ?? hall) : null;
  for (const { context } of mapContextEntries(event)) {
    context.assignments = Object.fromEntries(
      Object.entries(context.assignments).map(([id, hall]) => [
        id,
        remapRef(hall)!,
      ]),
    );
    context.hallOrder = context.hallOrder.map((group) => ({
      ...group,
      hall: remapRef(group.hall),
    }));
    context.hallVisitLists = context.hallVisitLists.map((list) => {
      const previous = list.group.hall;
      const hall = remapRef(previous);
      let legacyHallId = list.legacyHallId;
      if (previous && hall && legacyHallId !== undefined) {
        // Use the resolved source and group, never guess by splitting a literal ID.
        if (legacyHallId === previous.hallId) legacyHallId = hall.hallId;
        else if (
          list.group.priority !== "none" &&
          legacyHallId === `${previous.hallId}:${list.group.priority}`
        )
          legacyHallId = `${hall.hallId}:${list.group.priority}`;
      }
      return {
        ...list,
        group: { ...list.group, hall },
        ...(legacyHallId !== undefined ? { legacyHallId } : {}),
      };
    });
  }
  const execute = next.executeModeItems[name] ?? {};
  const executeKeys = sortedKeys(execute, preferredKey);
  if (executeKeys.length) {
    const order = [...new Set(executeKeys.flatMap((key) => execute[key]))];
    details.push(
      `実行列: ${executeKeys.map((key) => JSON.stringify(key)).join(" + ")} → ${JSON.stringify(preferredKey)} / ${order.join(" → ")}`,
    );
    for (const key of executeKeys) delete execute[key];
    execute[preferredKey] = order;
  }
  const modes = next.dayModes[name] ?? {};
  const modeKeys = sortedKeys(modes, preferredKey);
  if (modeKeys.length) {
    const mode = modes[modeKeys[0]];
    details.push(
      `表示モード: ${modeKeys.map((key) => `${JSON.stringify(key)}=${modes[key]}`).join("、")} → ${mode}`,
    );
    for (const key of modeKeys) delete modes[key];
    modes[preferredKey] = mode;
  }
  const keys = sortedKeys(event.days, preferredKey);
  const merged = createDayConsistency();
  const conflicts = new Map<VisitContextV1, Set<string>>();
  function mergeContext(
    target: VisitContextV1,
    source: VisitContextV1,
    sourceDay: string,
    mapKey: string | null,
  ): void {
    for (const [id, hall] of Object.entries(source.assignments)) {
      const current = target.assignments[id];
      if (conflicts.get(target)?.has(id)) {
        event.legacyPending.push({
          sourceKey:
            hall.kind === "map" ? hall.mapKey : getMaplessKey(hall.dayKey),
          sourceDayKey: preferredKey,
          sourceMapKey: mapKey,
          reason: "ambiguous-source",
          payload: {
            kind: "manual-hall",
            itemId: id,
            manualHallId: hall.hallId,
          },
        });
        continue;
      }
      if (current && hallRefKey(current) !== hallRefKey(hall)) {
        event.legacyPending.push(
          ...[current, hall].map((ref) => ({
            sourceKey:
              ref.kind === "map" ? ref.mapKey : getMaplessKey(ref.dayKey),
            sourceDayKey: preferredKey,
            sourceMapKey: mapKey,
            reason: "ambiguous-source" as const,
            payload: {
              kind: "manual-hall" as const,
              itemId: id,
              manualHallId: ref.hallId,
            },
          })),
        );
        if (!conflicts.has(target)) conflicts.set(target, new Set());
        conflicts.get(target)!.add(id);
        delete target.assignments[id];
        details.push(
          `${sourceDay} / ${id}: 所属指定の食い違いを保留し、再選択します。`,
        );
      } else target.assignments[id] = hall;
    }
    for (const group of source.hallOrder)
      if (
        !target.hallOrder.some(
          (entry) => hallGroupKey(entry) === hallGroupKey(group),
        )
      )
        target.hallOrder.push(group);
    // Keep saved list boundaries and relative order, even within one group.
    target.hallVisitLists.push(...source.hallVisitLists);
    if (source.route) {
      if (!target.route) target.route = source.route;
      else {
        target.route.visitOrder.push(
          ...source.route.visitOrder.filter(
            (point) =>
              !target.route!.visitOrder.some(
                (existing) =>
                  semanticSignature(existing) === semanticSignature(point),
              ),
          ),
        );
        target.route.visitOrder.forEach((point, index) => {
          point.order = index;
        });
      }
    }
  }
  for (const key of keys) {
    const day: DayConsistencyV1 = event.days[key];
    if (day.selectedMapKey !== null) {
      if (merged.selectedMapKey === null)
        merged.selectedMapKey = day.selectedMapKey;
      else if (day.selectedMapKey !== merged.selectedMapKey)
        details.push(
          `利用マップ: ${JSON.stringify(key)}=${day.selectedMapKey} → ${merged.selectedMapKey}`,
        );
    }
    if (day.mapless)
      mergeContext(
        (merged.mapless ??= createVisitContext()),
        day.mapless,
        key,
        null,
      );
    for (const [mapKey, context] of Object.entries(day.maps))
      mergeContext(
        (merged.maps[mapKey] ??= createVisitContext()),
        context,
        key,
        mapKey,
      );
    delete event.days[key];
  }
  if (keys.length) event.days[preferredKey] = merged;
  for (const pending of event.legacyPending)
    if (
      pending.sourceDayKey !== null &&
      sameDay(pending.sourceDayKey, requestedDay)
    )
      pending.sourceDayKey = preferredKey;
  const affected = (value: PersistenceSnapshot) => ({
    execute: Object.fromEntries(
      Object.entries(value.executeModeItems[name] ?? {}).filter(([key]) =>
        sameDay(key, requestedDay),
      ),
    ),
    modes: Object.fromEntries(
      Object.entries(value.dayModes[name] ?? {}).filter(([key]) =>
        sameDay(key, requestedDay),
      ),
    ),
    days: Object.fromEntries(
      Object.entries(value.eventConsistency[name]?.days ?? {}).filter(([key]) =>
        sameDay(key, requestedDay),
      ),
    ),
    definitions: Object.fromEntries(
      Object.entries(value.hallDefinitions[name] ?? {}).filter(
        ([key]) =>
          key.startsWith(`${MAPLESS_HALL_KEY}:`) &&
          sameDay(key.slice(MAPLESS_HALL_KEY.length + 1), requestedDay),
      ),
    ),
    pending: value.eventConsistency[name]?.legacyPending,
  });
  return {
    snapshot: next,
    confirmation: {
      title: `${name} / ${requestedDay} の保存先を統合`,
      details: [
        ...details,
        `統合後の設定\n${JSON.stringify(affected(next), null, 2)}`,
      ],
      comparison: { before: affected(snapshot), after: affected(next) },
    },
  };
}
