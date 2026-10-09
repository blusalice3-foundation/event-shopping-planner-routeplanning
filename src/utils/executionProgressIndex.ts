import type { ShoppingItem } from "../types/item";
import { changedItemPositions } from "./itemIndex";

const insertionPosition = (positions: readonly number[], target: number) => {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (positions[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
};
const setPosition = (
  positions: number[],
  position: number,
  present: boolean,
) => {
  const index = insertionPosition(positions, position);
  if (present && positions[index] !== position)
    positions.splice(index, 0, position);
  else if (!present && positions[index] === position)
    positions.splice(index, 1);
};

/** Maintain progression counts and ordered group tails across accepted commands. */
export function createExecutionProgressIndex(
  groupKey: (item: ShoppingItem) => string,
) {
  let renderedItems: readonly ShoppingItem[] | undefined;
  let renderedRecent: ReadonlySet<string> | undefined;
  let scope: string | undefined;
  const current = new Map<string, ShoppingItem>();
  const positions = new Map<string, number>();
  const recent = new Set<string>();
  const groups = new Map<string, { all: number[]; visible: number[] }>();
  let ids: string[] = [];
  let noneCount = 0;
  let visibleNoneCount = 0;
  const isVisible = (item: ShoppingItem) =>
    item.purchaseStatus === "Postpone" || recent.has(item.id);
  const group = (key: string) => {
    let value = groups.get(key);
    if (!value) groups.set(key, (value = { all: [], visible: [] }));
    return value;
  };
  const apply = (item: ShoppingItem, markRecent = false) => {
    const before = current.get(item.id);
    const position = positions.get(item.id);
    if (!before || position === undefined) return;
    const beforeVisible = isVisible(before);
    if (markRecent) recent.add(item.id);
    const afterVisible = isVisible(item);
    noneCount +=
      Number(item.purchaseStatus === "None") -
      Number(before.purchaseStatus === "None");
    visibleNoneCount +=
      Number(afterVisible && item.purchaseStatus === "None") -
      Number(beforeVisible && before.purchaseStatus === "None");
    const oldKey = groupKey(before);
    const newKey = groupKey(item);
    if (oldKey !== newKey) {
      const oldGroup = group(oldKey);
      setPosition(oldGroup.all, position, false);
      setPosition(oldGroup.visible, position, false);
      if (!oldGroup.all.length) groups.delete(oldKey);
      setPosition(group(newKey).all, position, true);
    }
    if (oldKey !== newKey || beforeVisible !== afterVisible)
      setPosition(group(newKey).visible, position, afterVisible);
    current.set(item.id, item);
  };
  return {
    sync(
      items: readonly ShoppingItem[],
      recentIds: ReadonlySet<string>,
      context: string,
    ) {
      const changes =
        renderedItems && scope === context
          ? changedItemPositions(renderedItems, items)
          : null;
      if (changes === null) {
        current.clear();
        positions.clear();
        recent.clear();
        groups.clear();
        noneCount = 0;
        visibleNoneCount = 0;
        ids = items.map((item, index) => {
          current.set(item.id, item);
          positions.set(item.id, index);
          if (recentIds.has(item.id)) recent.add(item.id);
          const visible = isVisible(item);
          const membership = group(groupKey(item));
          membership.all.push(index);
          if (visible) membership.visible.push(index);
          noneCount += Number(item.purchaseStatus === "None");
          visibleNoneCount += Number(visible && item.purchaseStatus === "None");
          return item.id;
        });
      } else {
        for (const index of changes) apply(items[index]);
        if (renderedRecent !== recentIds) {
          // Only changed temporary memberships touch counts or group tails.
          for (const id of recent) {
            if (recentIds.has(id)) continue;
            const item = current.get(id)!;
            if (item.purchaseStatus === "None") visibleNoneCount--;
            recent.delete(id);
            if (item.purchaseStatus !== "Postpone")
              setPosition(
                group(groupKey(item)).visible,
                positions.get(id)!,
                false,
              );
          }
          for (const id of recentIds) {
            if (recent.has(id)) continue;
            const item = current.get(id);
            if (item) apply(item, true);
          }
        }
      }
      scope = context;
      renderedItems = items;
      renderedRecent = recentIds;
    },
    apply,
    item: (id: string) => current.get(id),
    get noneCount() {
      return noneCount;
    },
    get visibleNoneCount() {
      return visibleNoneCount;
    },
    lastItemId(key: string, postponed = false) {
      const membership = groups.get(key);
      const ordered = postponed ? membership?.visible : membership?.all;
      return ordered?.length ? ids[ordered[ordered.length - 1]] : undefined;
    },
  };
}
