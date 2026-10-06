import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type {
  MutationChoices,
  MutationPlan,
} from "../../../app/commands/applicationMutationCoordinator";
import { duplicateEventDays } from "./dayMerge";
import { planWithDayMerges } from "./dayMergeMutation";
import { buildEventRestoreData } from "../../events/backupRestore";
export function eventSnapshot(
  snapshot: PersistenceSnapshot,
  name: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(snapshot).map(([key, values]) => [
      key,
      values[name] ?? null,
    ]),
  );
}
export function planEventRestore(
  snapshot: PersistenceSnapshot,
  backup: PersistenceSnapshot,
  source: string,
  target: string,
  notices: string[] = [],
  choices: MutationChoices = {},
): MutationPlan {
  const restored = buildEventRestoreData(snapshot, backup, source, target);
  const before = eventSnapshot(snapshot, target);
  const exists = Object.values(before).some((value) => value !== null);
  const result = planWithDayMerges(
    restored,
    duplicateEventDays(restored, target).map((day) => ({
      eventName: target,
      day,
    })),
    choices,
    (next) => {
      const after = eventSnapshot(next, target);
      return {
        snapshot: next,
        invalidatedEvents: [target],
        ...(exists || notices.length
          ? {
              confirmation: {
                title: `「${target}」の復元内容を確認`,
                details: [
                  ...notices,
                  "保存後、このイベントで開いている並び替え履歴と保留中の画面操作を終了します。",
                  "現在の品目・購入記録・設定を以下の内容へ置き換えます。バックアップにない内容は削除されます。",
                  ...Object.keys(before)
                    .filter(
                      (key) =>
                        JSON.stringify(before[key]) !==
                        JSON.stringify(after[key]),
                    )
                    .map(
                      (key) =>
                        `${key}\n現在: ${JSON.stringify(before[key], null, 2)}\n復元後: ${JSON.stringify(after[key], null, 2)}`,
                    ),
                ],
                comparison: { before, after },
              },
            }
          : {}),
      };
    },
  );
  return result.confirmation
    ? {
        ...result,
        confirmation: {
          ...result.confirmation,
          title: `「${target}」の復元内容を確認`,
        },
      }
    : result;
}
export function planEventDelete(
  snapshot: PersistenceSnapshot,
  name: string,
): MutationPlan {
  const before = eventSnapshot(snapshot, name);
  const next = Object.fromEntries(
    Object.entries(snapshot).map(([key, values]) => [
      key,
      Object.fromEntries(
        Object.entries(values).filter(([event]) => event !== name),
      ),
    ]),
  ) as unknown as PersistenceSnapshot;
  return {
    snapshot: next,
    invalidatedEvents: [name],
    confirmation: {
      title: `「${name}」を削除`,
      details: [
        "削除後、このイベントの並び替え履歴と保留中の画面操作を終了します。",
        JSON.stringify(before, null, 2),
      ],
      comparison: before,
    },
  };
}
export function planEventRename(
  snapshot: PersistenceSnapshot,
  oldName: string,
  newName: string,
): MutationPlan {
  if (
    Object.values(snapshot).some((values) =>
      Object.prototype.hasOwnProperty.call(values, newName),
    )
  )
    throw new Error("同名のイベントが既に存在します。");
  if (!snapshot.eventLists[oldName])
    throw new Error("変更元のイベントが見つかりません。");
  const next = Object.fromEntries(
    Object.entries(snapshot).map(([key, values]) => [
      key,
      Object.fromEntries(
        Object.entries(values).map(([event, value]) => [
          event === oldName ? newName : event,
          value,
        ]),
      ),
    ]),
  ) as unknown as PersistenceSnapshot;
  return {
    snapshot: next,
    invalidatedEvents: [oldName, newName],
    confirmation: {
      title: "イベント名を変更",
      details: [
        `${oldName} → ${newName}`,
        "保存後、変更前の並び替え履歴と保留中の画面操作を終了します。",
      ],
      comparison: { oldName, newName },
    },
  };
}
