import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type {
  MutationPlan,
  MutationChoice,
  MutationChoices,
} from "../../../app/commands/applicationMutationCoordinator";
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
import type { ShoppingItem } from "../../../types/item";
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
  selections: MutationChoices = {},
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
  const choices: MutationChoice[] = [];
  const choose = (
    id: string,
    label: string,
    options: MutationChoice["options"],
    fallback = options[0].value,
  ) => {
    const selected = selections[id];
    const value = options.some((option) => option.value === selected)
      ? selected
      : fallback;
    if (options.length > 1) choices.push({ id, label, options, value });
    return value;
  };
  const sourceKeys = [
    ...new Set([
      ...sortedKeys(snapshot.executeModeItems[name], requestedDay),
      ...sortedKeys(snapshot.dayModes[name], requestedDay),
      ...sortedKeys(snapshot.eventConsistency[name]?.days, requestedDay),
      ...Object.keys(snapshot.hallDefinitions[name] ?? {})
        .filter((key) => key.startsWith(`${MAPLESS_HALL_KEY}:`))
        .map((key) => key.slice(MAPLESS_HALL_KEY.length + 1))
        .filter((key) => sameDay(key, requestedDay)),
      preferredKey,
    ]),
  ].sort();
  preferredKey = choose(
    "destination",
    "統合先の日付表記",
    sourceKeys.map((key) => ({ value: key, label: JSON.stringify(key) })),
    preferredKey,
  );
  const prioritize = (keys: string[], first: string) => [
    first,
    ...keys.filter((key) => key !== first),
  ];
  const itemsById = new Map(
    ((snapshot.eventLists[name] ?? []) as ShoppingItem[]).map((item) => [
      item.id,
      item,
    ]),
  );
  const describeItems = (ids: string[]) =>
    ids
      .map((id) => {
        const item = itemsById.get(id);
        return item
          ? `${item.circle} / ${item.title}（${item.block}-${item.number}）`
          : id;
      })
      .join(" → ");
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
    const first = choose(
      "executeOrder",
      "実行列の順序（選んだ保存先を先に、残りの品目を続ける）",
      executeKeys.map((key) => ({
        value: key,
        label: `${JSON.stringify(key)}: ${describeItems(execute[key]) || "空"}`,
      })),
    );
    const order = [
      ...new Set(prioritize(executeKeys, first).flatMap((key) => execute[key])),
    ];
    details.push(
      `実行列: ${executeKeys.map((key) => JSON.stringify(key)).join(" + ")} → ${JSON.stringify(preferredKey)} / ${describeItems(order)}`,
    );
    for (const key of executeKeys) delete execute[key];
    execute[preferredKey] = order;
  }
  const modes = next.dayModes[name] ?? {};
  const modeKeys = sortedKeys(modes, preferredKey);
  if (modeKeys.length) {
    const mode = choose(
      "mode",
      "統合後の表示モード",
      ["edit", "execute"].map((value) => ({
        value,
        label: `${value === "execute" ? "実行モード" : "編集モード"}（${
          modeKeys
            .filter((key) => modes[key] === value)
            .map((key) => JSON.stringify(key))
            .join("、") || "新しく選択"
        }）`,
      })),
      modes[modeKeys[0]],
    );
    details.push(
      `表示モード: ${modeKeys.map((key) => `${JSON.stringify(key)}=${modes[key]}`).join("、")} → ${mode}`,
    );
    for (const key of modeKeys) delete modes[key];
    modes[preferredKey] = mode;
  }
  const keys = sortedKeys(event.days, preferredKey);
  const merged = createDayConsistency();
  const contextSources = Object.fromEntries(
    keys.map((key) => [key, event.days[key]]),
  );
  if (keys.length) {
    const mapOptions = [
      ...new Set(keys.map((key) => event.days[key].selectedMapKey)),
    ];
    merged.selectedMapKey = JSON.parse(
      choose(
        "selectedMap",
        "統合後の利用マップ",
        mapOptions.map((mapKey) => ({
          value: JSON.stringify(mapKey),
          label: mapKey ?? "未選択",
        })),
        JSON.stringify(mapOptions.find((mapKey) => mapKey !== null) ?? null),
      ),
    ) as string | null;
    details.push(`利用マップ: ${merged.selectedMapKey ?? "未選択"}`);
  }
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
  }
  for (const key of keys) {
    const day: DayConsistencyV1 = event.days[key];
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
  const describeGroup = (group: VisitContextV1["hallOrder"][number]) => {
    const hall = group.hall;
    const sourceKey =
      hall?.kind === "simple" ? getMaplessKey(hall.dayKey) : hall?.mapKey;
    const definition = sourceKey
      ? (
          next.hallDefinitions[name]?.[sourceKey] as
            | HallDefinition[]
            | undefined
        )?.find((entry) => entry.id === hall?.hallId)
      : undefined;
    return `${definition?.name ?? hall?.hallId ?? "ホール未定義"}${group.priority === "highest" ? "最優先" : group.priority === "priority" ? "優先" : ""}`;
  };
  for (const mapKey of [null, ...Object.keys(merged.maps)]) {
    const target = mapKey === null ? merged.mapless : merged.maps[mapKey];
    if (!target) continue;
    const sources = Object.fromEntries(
      keys.flatMap((key) => {
        const context =
          mapKey === null
            ? contextSources[key].mapless
            : contextSources[key].maps[mapKey];
        return context ? [[key, context]] : [];
      }),
    ) as Record<string, VisitContextV1>;
    const contextLabel = mapKey ?? "マップなし";
    function ordered(
      field: "hallOrder" | "hallVisitLists" | "route",
      label: string,
      describe: (context: VisitContextV1) => string,
    ): VisitContextV1[] {
      const available = keys.filter((key) => {
        const value = sources[key]?.[field];
        return value && (!Array.isArray(value) || value.length > 0);
      });
      if (!available.length) return [];
      const first = choose(
        `${field}:${JSON.stringify(mapKey)}`,
        `${contextLabel}: ${label}（選んだ保存先の順序を優先）`,
        available.map((key) => ({
          value: key,
          label: `${JSON.stringify(key)}: ${describe(sources[key])}`,
        })),
      );
      return prioritize(available, first).map((key) => sources[key]);
    }
    const groups = ordered("hallOrder", "ホール巡回順", (context) =>
      context.hallOrder.map(describeGroup).join(" → "),
    );
    const seenGroups = new Set<string>();
    target.hallOrder = groups
      .flatMap((context) => context.hallOrder)
      .filter((group) => {
        const key = hallGroupKey(group);
        if (seenGroups.has(key)) return false;
        seenGroups.add(key);
        return true;
      });
    target.hallVisitLists = ordered("hallVisitLists", "訪問品目順", (context) =>
      context.hallVisitLists
        .map((list) => describeItems(list.itemIds))
        .join(" / "),
    ).flatMap((context) => context.hallVisitLists);
    const routes = ordered("route", "経路順と経路設定", (context) =>
      context
        .route!.visitOrder.map((point) => describeItems(point.itemIds))
        .join(" → "),
    ).map((context) => context.route!);
    if (routes.length) {
      const seenPoints = new Set<string>();
      target.route = {
        ...structuredClone(routes[0]),
        visitOrder: routes
          .flatMap((route) => route.visitOrder)
          .filter((point) => {
            const key = semanticSignature({ ...point, order: 0 });
            if (seenPoints.has(key)) return false;
            seenPoints.add(key);
            return true;
          })
          .map((point, order) => ({ ...point, order })),
      };
    }
    details.push(
      `${contextLabel} / ホール巡回順: ${target.hallOrder.map(describeGroup).join(" → ") || "未設定"}`,
      `${contextLabel} / 訪問品目順: ${target.hallVisitLists.map((list) => describeItems(list.itemIds)).join(" / ") || "未設定"}`,
    );
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
      choices,
      details,
      comparison: {
        before: affected(snapshot),
        after: affected(next),
        choices,
      },
    },
  };
}
