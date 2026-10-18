import type { FocusPhase } from "../../types/focus";
import type { ShoppingItem } from "../../types/item";

export function planPhaseEnd(
  phase: FocusPhase,
  items: readonly ShoppingItem[],
  capturedPostponed: ReadonlySet<string>,
  capturedLate: ReadonlySet<string>,
) {
  const postponed = new Set<string>();
  const late = new Set<string>();
  for (const item of items) {
    if (
      phase === "normal"
        ? item.purchaseStatus === "Postpone"
        : capturedPostponed.has(item.id)
    )
      postponed.add(item.id);
    if (
      (phase !== "normal" && capturedLate.has(item.id)) ||
      item.purchaseStatus === "Late"
    )
      late.add(item.id);
  }
  const nextPhase: FocusPhase | null =
    phase === "normal" && postponed.size
      ? "postponed"
      : phase !== "late" && late.size
        ? "late"
        : null;
  return { postponed, late, nextPhase };
}
