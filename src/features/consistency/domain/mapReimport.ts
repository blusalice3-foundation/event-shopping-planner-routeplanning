import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type { MutationPlan } from "../../../app/commands/applicationMutationCoordinator";
import type {
  MapReimportOptions,
  MapReimportTarget,
} from "../../map/domain/mapReimport";
import type {
  BlockDetectionSettings,
  DayMapData,
  HallDefinition,
} from "../../../types/map";
import type { ShoppingItem } from "../../../types/item";
import {
  collectEventDays,
  ensureDayConsistency,
  getDayConsistency,
  normalizeMapDay,
  resolveDayMap,
  resolveSimpleKey,
  sameDay,
} from "./context";
import { planProjectedMutation } from "./mutations";
import { mapContextEntries } from "./migration";
import { createEventConsistency } from "../../../types/consistency";
import { normalizeRotationAngle } from "../../map/canvas/useCanvasViewport";
export function planMapReimport(
  source: PersistenceSnapshot,
  eventName: string,
  targets: readonly MapReimportTarget[],
  options: MapReimportOptions,
  settings: BlockDetectionSettings,
): MutationPlan {
  if (!source.eventLists[eventName])
    throw new Error("取り込み先のイベントが見つかりません。");
  const next = structuredClone(source);
  const event = (next.eventConsistency[eventName] ??= createEventConsistency());
  const maps = (next.mapData[eventName] ??= {}) as Record<string, DayMapData>;
  const definitions = (next.hallDefinitions[eventName] ??= {}) as Record<
    string,
    HallDefinition[]
  >;
  const rotations = (next.mapRotationSettings[eventName] ??= {});
  const viewports = (next.mapViewportSettings[eventName] ??= {});
  const days = collectEventDays(
    source.eventLists[eventName] as ShoppingItem[],
    source.executeModeItems[eventName],
    source.dayModes[eventName],
    event.days,
  );
  const affectedDays = new Set<string>(),
    changedMaps = new Set<string>(),
    deletedSimpleKeys = new Set<string>();
  const details: string[] = [];
  for (const target of targets) {
    const choice =
      options.targetMapKeys?.[target.eventDate] ??
      getDayConsistency(event, target.eventDate)?.selectedMapKey;
    const resolved = resolveDayMap(
      source.mapData[eventName] as Record<string, DayMapData>,
      target.eventDate,
      choice,
    );
    if (resolved.status === "selection-required")
      throw new Error(
        `${target.eventDate}: 更新する実在マップを選択してください。`,
      );
    const key =
      resolved.status === "resolved" ? resolved.key : target.mapTabName;
    if (normalizeMapDay(key) !== normalizeMapDay(target.eventDate))
      throw new Error("マップ名と対象日付が一致しません。");
    if (changedMaps.has(key))
      throw new Error(`更新先「${key}」が重複しています。`);
    changedMaps.add(key);
    const dependentDays = days.filter(
      (day) =>
        resolveDayMap(
          source.mapData[eventName] as Record<string, DayMapData>,
          day,
        ).candidates.some((candidate) => candidate === key) ||
        Object.prototype.hasOwnProperty.call(
          getDayConsistency(event, day)?.maps ?? {},
          key,
        ) ||
        sameDay(day, target.eventDate),
    );
    dependentDays.forEach((day) => affectedDays.add(day));
    details.push(
      `更新する実在マップ: ${key} / 依存する日付: ${dependentDays.join("、")}`,
    );
    ensureDayConsistency(event, target.eventDate, [
      next.executeModeItems[eventName],
      next.dayModes[eventName],
    ]).selectedMapKey = key;
    // Worker DTOs retain optional undefined fields; persistence omits them.
    maps[key] = JSON.parse(JSON.stringify(target.mapData)) as DayMapData;
    delete definitions[key];
    const angle = normalizeRotationAngle(target.initialAngle);
    rotations[key] = {
      initialAngle: angle,
      mapTabAngle: angle,
      focusModeAngle: angle,
    };
    delete viewports[key];
    if (!options.preserveMaplessHalls)
      for (const day of dependentDays) {
        const simple = resolveSimpleKey(definitions, day);
        if (simple.status === "ambiguous")
          throw new Error(`${day}: 簡易ホールの保存先を先に統合してください。`);
        if (simple.status === "resolved") {
          deletedSimpleKeys.add(simple.key);
          delete definitions[simple.key];
          details.push(
            `簡易ホールを削除: ${simple.key}（この日付の全マップへ反映）`,
          );
        }
      }
  }
  event.blockDetectionSettings = structuredClone(settings);
  const plan = planProjectedMutation(
    source,
    {
      mapData: next.mapData,
      hallDefinitions: next.hallDefinitions,
      mapRotationSettings: next.mapRotationSettings,
      mapViewportSettings: next.mapViewportSettings,
      eventConsistency: next.eventConsistency,
    },
    { eventName, day: targets[0]?.eventDate ?? "", confirm: true },
  );
  // Reimport discards positions defined on the previous drawing, preserving visibility.
  for (const { mapKey, context } of mapContextEntries(
    plan.snapshot.eventConsistency[eventName],
  ))
    if (mapKey !== null && changedMaps.has(mapKey) && context.route)
      context.route.visitOrder = [];
  const affected = (snapshot: PersistenceSnapshot) => ({
    maps: Object.fromEntries(
      [...changedMaps].map((key) => [
        key,
        snapshot.mapData[eventName]?.[key] ?? null,
      ]),
    ),
    definitions: Object.fromEntries(
      [...changedMaps, ...deletedSimpleKeys].map((key) => [
        key,
        snapshot.hallDefinitions[eventName]?.[key] ?? null,
      ]),
    ),
    rotations: Object.fromEntries(
      [...changedMaps].map((key) => [
        key,
        snapshot.mapRotationSettings[eventName]?.[key] ?? null,
      ]),
    ),
    viewports: Object.fromEntries(
      [...changedMaps].map((key) => [
        key,
        snapshot.mapViewportSettings[eventName]?.[key] ?? null,
      ]),
    ),
    detection: snapshot.eventConsistency[eventName].blockDetectionSettings,
    contexts: Object.fromEntries(
      Object.entries(snapshot.eventConsistency[eventName].days).filter(
        ([day]) => [...affectedDays].some((value) => sameDay(value, day)),
      ),
    ),
    placements: (snapshot.eventLists[eventName] as ShoppingItem[])
      .filter((item) =>
        [...affectedDays].some((day) => sameDay(day, item.eventDate)),
      )
      .map((item) => ({
        id: item.id,
        eventDate: item.eventDate,
        block: item.block,
        number: item.number,
        priority: item.priorityLevel,
      })),
  });
  return {
    snapshot: plan.snapshot,
    confirmation: {
      title: "マップ再取り込みの影響を確認",
      details: [
        ...details,
        ...(plan.confirmation?.details ?? []),
        `変更後の関連設定\n${JSON.stringify(affected(plan.snapshot), null, 2)}`,
      ],
      comparison: { before: affected(source), after: affected(plan.snapshot) },
    },
  };
}
