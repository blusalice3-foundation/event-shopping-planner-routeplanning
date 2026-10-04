import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type { ShoppingItem, ViewMode } from "../../../types/item";
import type { HallSelectionIntent } from "../../../types/consistency";
import type { DayMapData, HallDefinition } from "../../../types/map";
import {
  computeUpdateItem,
  repositionExecuteItemAfterIdentityChangeWithResult,
} from "../../events/itemOps";
import {
  applyChangedFields,
  changedFieldConflicts,
  confirmChangedFieldConflicts,
  planProjectedMutation,
} from "./mutations";
import {
  existingDayKey,
  getContextHalls,
  getDayConsistency,
  resolveDayMap,
  sameHall,
} from "./context";
import { resolveMembership } from "./membership";
import { encodeHallRef, projectConsistencySnapshot } from "./projection";
export interface ItemMembershipPreview {
  status: string;
  locationStatus: string;
  halls: HallDefinition[];
  details: string[];
}
export function planItemEdit(
  snapshot: PersistenceSnapshot,
  eventName: string,
  baseline: ShoppingItem,
  edited: ShoppingItem,
  selection: HallSelectionIntent,
) {
  const original = (
    snapshot.eventLists[eventName] as ShoppingItem[] | undefined
  )?.find((item) => item.id === edited.id);
  if (!original)
    throw new Error("品目が削除されています。編集を開き直してください。");
  const clean = (item: ShoppingItem) => {
    const next = { ...item };
    delete next.manualHallId;
    return next;
  };
  const delta = applyChangedFields(
    clean(baseline),
    clean(edited),
    original,
  ) as ShoppingItem;
  const modeKey = existingDayKey(
    snapshot.dayModes[eventName],
    original.eventDate,
  );
  const mode = modeKey
    ? (snapshot.dayModes[eventName][modeKey] as ViewMode)
    : undefined;
  const items = computeUpdateItem(
    snapshot.eventLists[eventName] as ShoppingItem[],
    delta,
    mode,
    original.protectionLevel,
    original.source,
  ).items;
  const changed = items.find((item) => item.id === edited.id)!;
  const execute = repositionExecuteItemAfterIdentityChangeWithResult(
    snapshot.executeModeItems[eventName] ?? {},
    original,
    changed,
    items,
  ).executeModeItems;
  const projection = projectConsistencySnapshot(
    snapshot,
    eventName,
    changed.eventDate,
  );
  // Keep displayed choices on untouched items; the edited item's explicit intent is separate.
  const displayedItems = (
    projection.eventLists[eventName] as ShoppingItem[]
  ).map((item) =>
    item.id === changed.id
      ? { ...changed, manualHallId: item.manualHallId }
      : item,
  );
  return confirmChangedFieldConflicts(
    planProjectedMutation(
      snapshot,
      {
        eventLists: { ...projection.eventLists, [eventName]: displayedItems },
        executeModeItems: {
          ...snapshot.executeModeItems,
          [eventName]: execute,
        },
      },
      {
        eventName,
        day: changed.eventDate,
        selection: { itemId: edited.id, intent: selection },
      },
    ),
    changedFieldConflicts(clean(baseline), clean(edited), clean(original), [
      edited.id,
    ]),
  );
}
export function previewItemEdit(
  snapshot: PersistenceSnapshot,
  eventName: string,
  baseline: ShoppingItem,
  edited: ShoppingItem,
  selection: HallSelectionIntent,
): ItemMembershipPreview {
  let details: string[] = [];
  try {
    const plan = planItemEdit(snapshot, eventName, baseline, edited, selection);
    snapshot = plan.snapshot;
    details = plan.confirmation?.details ?? [];
  } catch (error) {
    details = [
      error instanceof Error ? error.message : "所属を確認できません。",
    ];
  }
  const day = getDayConsistency(
    snapshot.eventConsistency[eventName],
    edited.eventDate,
  );
  const map = resolveDayMap(
    snapshot.mapData[eventName] as Record<string, DayMapData>,
    edited.eventDate,
    day?.selectedMapKey,
  );
  const halls = getContextHalls(
    snapshot.hallDefinitions[eventName] as Record<string, HallDefinition[]>,
    edited.eventDate,
    map.status === "resolved" ? map.key : null,
  );
  const items = (snapshot.eventLists[eventName] as ShoppingItem[]).map(
    (item) => (item.id === edited.id ? edited : item),
  );
  const membership = resolveMembership(edited, {
    items,
    day: edited.eventDate,
    map,
    halls,
    context: map.status === "resolved" ? day?.maps[map.key] : day?.mapless,
  });
  const locationStatus =
    map.status === "selection-required"
      ? "マップ選択待ち"
      : map.status === "none"
        ? "マップなし"
        : membership.location?.status === "resolved"
          ? "場所を特定済み"
          : "場所未解決";
  if (map.status === "resolved") {
    if (membership.location?.status === "ambiguous")
      details.push(
        `マップ「${map.key}」で同じブロック名・番号に異なる位置の番号セルが${membership.location.candidates.length}件あるため、場所を特定できません。ブロック定義を確認してください。`,
      );
    else if (membership.location?.status === "missing")
      details.push(
        `マップ「${map.key}」に一致する番号セルが見つからないため、場所を特定できません。ブロック名・番号とブロック定義を確認してください。`,
      );
  }
  return {
    locationStatus,
    status:
      membership.status === "map-selection-required"
        ? "利用するマップを選択してください"
        : membership.reason === "manual"
          ? "共有先の手動指定を使用"
          : membership.reason === "automatic"
            ? "自動判定"
            : membership.status === "confirmation-required"
              ? "所属確認が必要"
              : "未割当",
    halls: membership.candidates.map((ref) => {
      const hall = halls.find((hall) => sameHall(hall.ref, ref))!;
      return {
        ...hall.definition,
        id: encodeHallRef(ref),
        name: `${hall.definition.name}（${ref.kind === "map" ? `詳細: ${ref.mapKey}` : `簡易: ${ref.dayKey}`}）`,
      };
    }),
    details,
  };
}
