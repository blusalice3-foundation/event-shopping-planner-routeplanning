import type { ShoppingItem } from "../types/item";
import { buildExecutionVisitProjectionKey } from "./visitProjection";

/** Swap selected members of one visit, or whole visits within an existing hall group. */
export function swapVisitItems(
  items: readonly ShoppingItem[],
  firstId: string,
  secondId: string,
): ShoppingItem[] | null {
  const first = items.findIndex((item) => item.id === firstId);
  const second = items.findIndex((item) => item.id === secondId);
  if (first < 0 || second < 0 || first === second) return null;
  const firstKey = buildExecutionVisitProjectionKey(items[first]);
  const secondKey = buildExecutionVisitProjectionKey(items[second]);
  if (firstKey === secondKey) {
    const result = [...items];
    [result[first], result[second]] = [result[second], result[first]];
    return result;
  }
  const firstMembers = items.filter(
    (item) => buildExecutionVisitProjectionKey(item) === firstKey,
  );
  const secondMembers = items.filter(
    (item) => buildExecutionVisitProjectionKey(item) === secondKey,
  );
  const seen = new Set<string>();
  return items.flatMap((item) => {
    const key = buildExecutionVisitProjectionKey(item);
    if (key !== firstKey && key !== secondKey) return [item];
    if (seen.has(key)) return [];
    seen.add(key);
    return key === firstKey ? secondMembers : firstMembers;
  });
}
