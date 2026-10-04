import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type { MutationPlan } from "../../../app/commands/applicationMutationCoordinator";
import { existingDayKey } from "./context";
import { planDayMerge } from "./dayMerge";

/** Merge target-day settings and toggle its mode in the same confirmed commit. */
export function planDayModeToggle(
  source: PersistenceSnapshot,
  eventName: string,
  day: string,
): MutationPlan {
  if (!source.eventLists[eventName])
    throw new Error("イベントが見つかりません。");
  const merged = planDayMerge(source, eventName, day);
  const next = merged.snapshot;
  const key = existingDayKey(next.dayModes[eventName], day) ?? day;
  const before = next.dayModes[eventName]?.[key];
  const mode = before === "execute" ? "edit" : "execute";
  next.dayModes[eventName] = { ...next.dayModes[eventName], [key]: mode };
  return {
    ...merged,
    ...(merged.confirmation
      ? {
          confirmation: {
            ...merged.confirmation,
            details: [
              ...merged.confirmation.details,
              `${day} のモード: ${before ?? "未設定"} → ${mode}`,
            ],
            comparison: {
              merge: merged.confirmation.comparison,
              key,
              before,
              mode,
            },
          },
        }
      : {}),
  };
}
