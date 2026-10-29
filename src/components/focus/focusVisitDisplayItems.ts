import type { ShoppingItem } from "../../types/item";
import { createOrderedItemsProjector } from "../../utils/incrementalItems";

type VisitProjection = {
  project: ReturnType<typeof createOrderedItemsProjector>;
  items?: readonly ShoppingItem[];
  selectedIds?: readonly string[];
  value?: ShoppingItem[];
};

// Focus-mode-only, bounded to the two most recently used selected-ID arrays.
// A direct cache hit requires both immutable input references. Updates always
// pass through the existing projector; matching item IDs alone never reuse data.
export function createFocusVisitDisplayItemsProjector() {
  const recent: VisitProjection[] = [];
  return (items: readonly ShoppingItem[], selectedIds: readonly string[]) => {
    const index = recent.findIndex((slot) => slot.selectedIds === selectedIds);
    const slot: VisitProjection =
      index >= 0
        ? recent.splice(index, 1)[0]!
        : recent.length === 2
          ? recent.pop()!
          : { project: createOrderedItemsProjector() };
    recent.unshift(slot);
    if (
      slot.items === items &&
      slot.selectedIds === selectedIds &&
      slot.value !== undefined
    )
      return slot.value;
    const value = slot.project(items, selectedIds);
    slot.items = items;
    slot.selectedIds = selectedIds;
    slot.value = value;
    return value;
  };
}
