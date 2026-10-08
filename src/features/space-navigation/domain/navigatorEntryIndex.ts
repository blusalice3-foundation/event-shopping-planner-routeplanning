import type { NavigatorEntry, NavigatorPhase } from "../types";
const indices = new WeakMap<
  readonly NavigatorEntry[],
  ReturnType<typeof buildIndex>
>();
function buildIndex(entries: readonly NavigatorEntry[]) {
  const byId = new Map<string, NavigatorEntry>();
  const byPhase = new Map<NavigatorPhase, NavigatorEntry[]>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
    if (entry.phase) {
      const phase = byPhase.get(entry.phase) ?? [];
      phase.push(entry);
      byPhase.set(entry.phase, phase);
    }
  }
  return { byId, byPhase };
}
export function navigatorEntryIndex(entries: readonly NavigatorEntry[]) {
  let index = indices.get(entries);
  if (!index) indices.set(entries, (index = buildIndex(entries)));
  return index;
}
