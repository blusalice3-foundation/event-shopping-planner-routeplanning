import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type { MutationPlan } from "../../../app/commands/applicationMutationCoordinator";
import { semanticSignature } from "../../../app/commands/applicationMutationCoordinator";
import type { HallDefinition, DayMapData } from "../../../types/map";
import { getMaplessKey } from "../../../types/map";
import type { HallGroupRef, LegacyPendingV1 } from "../../../types/consistency";
import type { ShoppingItem } from "../../../types/item";
import {
  collectEventDays,
  ensureDayConsistency,
  ensureVisitContext,
  getContextHalls,
  hallGroupKey,
  resolveDayMap,
  resolveSimpleKey,
  sameDay,
  sameHall,
} from "./context";
import {
  applyMembershipIntent,
  resolveMembership,
  removeResolvedManualHallPending,
} from "./membership";
import { planProjectedMutation } from "./mutations";
import { reconcileConsistencyReferences } from "./references";
export interface LegacyResolutionChoice {
  day: string;
  mapKey: string | null;
  groups: Record<string, HallGroupRef>;
  automatic?: boolean;
}
export const legacyPendingIdentity = (entry: LegacyPendingV1): string =>
  semanticSignature(entry);
export function legacyGroupIds(entry: LegacyPendingV1): string[] {
  if (entry.payload.kind === "manual-hall") return [entry.payload.manualHallId];
  if (entry.payload.kind === "hall-route-settings")
    return [
      ...new Set([
        ...entry.payload.settings.hallOrder,
        ...entry.payload.settings.hallVisitLists.map((list) => list.hallId),
      ]),
    ];
  return [];
}
export function planLegacyResolution(
  source: PersistenceSnapshot,
  name: string,
  identity: string,
  choice: LegacyResolutionChoice,
): MutationPlan {
  const next = structuredClone(source),
    event = next.eventConsistency[name];
  const index =
    event?.legacyPending.findIndex(
      (entry) => legacyPendingIdentity(entry) === identity,
    ) ?? -1;
  if (index < 0)
    throw new Error(
      "確認待ち設定が変更されています。画面を開き直してください。",
    );
  const entry = event.legacyPending[index];
  if (entry.payload.kind === "hall-definitions")
    choice = { ...choice, mapKey: null };
  const items = next.eventLists[name] as ShoppingItem[];
  const days = collectEventDays(
    items,
    next.executeModeItems[name],
    next.dayModes[name],
    event.days,
  );
  if (!days.some((day) => sameDay(day, choice.day)))
    throw new Error("保存先の日付を選択してください。");
  const day = ensureDayConsistency(event, choice.day, [
    next.executeModeItems[name],
    next.dayModes[name],
  ]);
  const maps = next.mapData[name] as Record<string, DayMapData> | undefined;
  if (
    choice.mapKey !== null &&
    !resolveDayMap(maps, choice.day).candidates.some(
      (key) => key === choice.mapKey,
    )
  )
    throw new Error("この日付で利用できるマップを選択してください。");
  const definitions = (next.hallDefinitions[name] ??= {}) as Record<
    string,
    HallDefinition[]
  >;
  const details = [
    `移行元: ${entry.sourceKey}`,
    `保存先: ${choice.day} / ${choice.mapKey ?? "マップなし"}`,
  ];
  const target = ensureVisitContext(day, choice.mapKey);
  const halls = getContextHalls(definitions, choice.day, choice.mapKey);
  for (const id of legacyGroupIds(entry)) {
    if (entry.payload.kind === "manual-hall" && choice.automatic) continue;
    const group = choice.groups[id];
    if (
      !group ||
      (group.hall !== null &&
        !halls.some((hall) => sameHall(hall.ref, group.hall)))
    )
      throw new Error(`旧指定「${id}」の対応先を選択してください。`);
  }
  if (entry.payload.kind === "hall-definitions") {
    const match = resolveSimpleKey(definitions, choice.day);
    if (match.status === "ambiguous")
      throw new Error("先に日付別の保存先を統合してください。");
    const key =
      match.status === "resolved" ? match.key : getMaplessKey(choice.day);
    const stored = (definitions[key] ??= []);
    for (const hall of entry.payload.halls) {
      if (
        stored.some(
          (value) => semanticSignature(value) === semanticSignature(hall),
        )
      )
        continue;
      let id = hall.id,
        suffix = 2;
      while (stored.some((value) => value.id === id))
        id = `${hall.id}~${suffix++}`;
      stored.push({ ...hall, id });
      details.push(`${hall.name}: ${hall.id} → ${id}`);
    }
  } else if (entry.payload.kind === "manual-hall") {
    const payload = entry.payload;
    const member = items.find((item) => item.id === payload.itemId);
    if (!member || !sameDay(member.eventDate, choice.day))
      throw new Error("品目の現在の日付を選択してください。");
    const ref = choice.groups[payload.manualHallId]?.hall;
    const map =
      choice.mapKey === null
        ? { status: "none" as const, candidates: [] as [] }
        : {
            status: "resolved" as const,
            key: choice.mapKey,
            data: maps![choice.mapKey],
            candidates: [choice.mapKey],
          };
    const result = applyMembershipIntent(
      member,
      member,
      choice.automatic
        ? { kind: "automatic" }
        : ref
          ? { kind: "select", hall: ref }
          : { kind: "automatic" },
      { items, day: choice.day, map, halls, context: target },
    );
    if (choice.mapKey === null) day.mapless = result;
    else day.maps[choice.mapKey] = result;
    const membership = resolveMembership(member, {
      items,
      day: choice.day,
      map,
      halls,
      context: result,
    });
    event.legacyPending = removeResolvedManualHallPending(
      event.legacyPending,
      membership.memberIds,
      choice.day,
      choice.mapKey,
    );
  } else if (entry.payload.kind === "hall-route-settings") {
    target.hallOrder = entry.payload.settings.hallOrder.map(
      (id) => choice.groups[id],
    );
    target.hallVisitLists = entry.payload.settings.hallVisitLists.map(
      (list) => ({
        group: choice.groups[list.hallId],
        legacyHallId: list.hallId,
        itemIds: list.itemIds.filter((id) =>
          items.some(
            (item) => item.id === id && sameDay(item.eventDate, choice.day),
          ),
        ),
      }),
    );
    target.hallOrder = target.hallOrder.filter(
      (group, index, groups) =>
        groups.findIndex(
          (value) => hallGroupKey(value) === hallGroupKey(group),
        ) === index,
    );
  } else {
    if (choice.mapKey === null)
      throw new Error("経路の保存先マップを選択してください。");
    const route = entry.payload.settings;
    target.route = {
      ...route,
      visitOrder: route.visitOrder
        .map((point) => ({
          ...point,
          itemIds: point.itemIds.filter((id) =>
            items.some(
              (item) => item.id === id && sameDay(item.eventDate, choice.day),
            ),
          ),
        }))
        .filter(
          (point, index) =>
            point.itemIds.length > 0 ||
            route.visitOrder[index].itemIds.length === 0,
        ),
    };
  }
  event.legacyPending = event.legacyPending.filter(
    (pending) => legacyPendingIdentity(pending) !== identity,
  );
  // Choosing the destination of retained visit settings must keep their saved
  // positions, including itemless points. No membership or order edit occurred.
  const plan =
    entry.payload.kind === "hall-route-settings" ||
    entry.payload.kind === "route-settings"
      ? { snapshot: reconcileConsistencyReferences(next).data }
      : planProjectedMutation(
          source,
          {
            eventConsistency: next.eventConsistency,
            ...(entry.payload.kind === "hall-definitions"
              ? { hallDefinitions: next.hallDefinitions }
              : {}),
          },
          { eventName: name, day: choice.day, confirm: false },
        );
  return {
    snapshot: plan.snapshot,
    confirmation: {
      title: "確認待ち設定の対応先を保存",
      details: [
        ...details,
        ...(plan.confirmation?.details ?? []),
        `変更後の関連設定\n${JSON.stringify(plan.snapshot.eventConsistency[name].days, null, 2)}`,
      ],
      comparison: {
        original: entry,
        resolvedPending: source.eventConsistency[name].legacyPending.filter(
          (pending) =>
            !event.legacyPending.some(
              (retained) =>
                legacyPendingIdentity(retained) ===
                legacyPendingIdentity(pending),
            ),
        ),
        choice,
        definitions: next.hallDefinitions[name],
        before: source.eventConsistency[name].days,
        after: plan.snapshot.eventConsistency[name].days,
      },
    },
  };
}
