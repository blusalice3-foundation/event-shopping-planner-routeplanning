import type { ShoppingItem } from "../../../types/item";
import { buildExecutionVisitProjectionKey } from "../../../utils/visitProjection";
/** Only reorder surviving known slots; new visits and new members retain theirs. */
export function applyVisitHistory(
  currentIds: readonly string[],
  historyIds: readonly string[],
  items: readonly ShoppingItem[],
  groupFor: (item: ShoppingItem) => string,
): string[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const current = [...new Set(currentIds)].filter((id) => byId.has(id));
  const rank = new Map(historyIds.map((id, index) => [id, index]));
  const groups = new Map<string, Map<string, string[]>>();
  for (const id of current) {
    const item = byId.get(id)!;
    const group = groupFor(item),
      visit = buildExecutionVisitProjectionKey(item);
    if (!groups.has(group)) groups.set(group, new Map());
    const visits = groups.get(group)!;
    if (!visits.has(visit)) visits.set(visit, []);
    visits.get(visit)!.push(id);
  }
  const result: string[] = [];
  for (const visits of groups.values()) {
    const known = [...visits.keys()].filter((key) =>
      visits.get(key)!.some((id) => rank.has(id)),
    );
    known.sort(
      (a, b) =>
        Math.min(...visits.get(a)!.map((id) => rank.get(id) ?? Infinity)) -
        Math.min(...visits.get(b)!.map((id) => rank.get(id) ?? Infinity)),
    );
    const knownSet = new Set(known);
    let visitIndex = 0;
    for (const key of visits.keys()) {
      const ids = visits.get(knownSet.has(key) ? known[visitIndex++] : key)!;
      const members = ids
        .filter((id) => rank.has(id))
        .sort((a, b) => rank.get(a)! - rank.get(b)!);
      let memberIndex = 0;
      result.push(
        ...ids.map((id) => (rank.has(id) ? members[memberIndex++] : id)),
      );
    }
  }
  return result;
}
