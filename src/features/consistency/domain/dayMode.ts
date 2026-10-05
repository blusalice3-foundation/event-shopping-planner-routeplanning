import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type {
  MutationPlan,
  MutationChoices,
} from "../../../app/commands/applicationMutationCoordinator";
import { existingDayKey } from "./context";
import { planDayMerge } from "./dayMerge";

/** Merge target-day settings and toggle its mode in the same confirmed commit. */
export function planDayModeToggle(
  source: PersistenceSnapshot,
  eventName: string,
  day: string,
  choices: MutationChoices = {},
): MutationPlan {
  if (!source.eventLists[eventName])
    throw new Error("イベントが見つかりません。");
  const { mode: selectedMode, ...otherChoices } = choices;
  const initial = planDayMerge(source, eventName, day, undefined, otherChoices);
  const key = existingDayKey(initial.snapshot.dayModes[eventName], day) ?? day;
  const before = initial.snapshot.dayModes[eventName]?.[key];
  const mode =
    selectedMode === "edit" ||
    selectedMode === "execute" ||
    selectedMode === "focus"
      ? selectedMode
      : before === "execute"
        ? "edit"
        : "execute";
  const merged = initial.confirmation
    ? planDayMerge(source, eventName, day, undefined, { ...otherChoices, mode })
    : initial;
  const next = merged.snapshot;
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
