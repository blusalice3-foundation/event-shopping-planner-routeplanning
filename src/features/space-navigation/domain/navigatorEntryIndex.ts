import { indexedItems } from "../../../utils/itemIndex";
import type { NavigatorEntry, NavigatorPhase } from "../types";
const indices = new WeakMap<
  readonly NavigatorEntry[],
  ReturnType<typeof buildIndex>
>();
function buildIndex(entries: readonly NavigatorEntry[]) {
  const byId = indexedItems(entries);
  const byPhase = new Map<NavigatorPhase, NavigatorEntry[]>();
  const bySpace = new Map<string, NavigatorEntry[]>();
  const byPhaseAndSpace = new Map<
    NavigatorPhase,
    Map<string, NavigatorEntry[]>
  >();
  for (const entry of entries) {
    const space = bySpace.get(entry.spaceKey) ?? [];
    space.push(entry);
    bySpace.set(entry.spaceKey, space);
    if (entry.phase) {
      const phase = byPhase.get(entry.phase) ?? [];
      phase.push(entry);
      byPhase.set(entry.phase, phase);
      const phaseSpaces =
        byPhaseAndSpace.get(entry.phase) ?? new Map<string, NavigatorEntry[]>();
      const phaseSpace = phaseSpaces.get(entry.spaceKey) ?? [];
      phaseSpace.push(entry);
      phaseSpaces.set(entry.spaceKey, phaseSpace);
      byPhaseAndSpace.set(entry.phase, phaseSpaces);
    }
  }
  const spaceOrderByPhase = new Map(
    [...byPhaseAndSpace].map(([phase, spaces]) => [phase, [...spaces.keys()]]),
  );
  const spacePositionsByPhase = new Map(
    [...spaceOrderByPhase].map(([phase, keys]) => [
      phase,
      new Map(keys.map((key, index) => [key, index])),
    ]),
  );
  return {
    byId,
    byPhase,
    bySpace,
    byPhaseAndSpace,
    spaceOrderByPhase,
    spacePositionsByPhase,
  };
}
export function navigatorEntryIndex(entries: readonly NavigatorEntry[]) {
  let index = indices.get(entries);
  if (!index) indices.set(entries, (index = buildIndex(entries)));
  return index;
}

/** Share structural indexes and patch only the changed entry's buckets. */
export function registerNavigatorEntryChanges(
  previous: readonly NavigatorEntry[],
  next: readonly NavigatorEntry[],
  changed: readonly number[],
) {
  const before = indices.get(previous);
  if (
    !before ||
    previous.length !== next.length ||
    changed.some((index) => {
      const old = previous[index],
        entry = next[index];
      return (
        old.id !== entry.id ||
        old.phase !== entry.phase ||
        old.spaceKey !== entry.spaceKey
      );
    })
  )
    return;
  const value = {
    ...before,
    byId: indexedItems(next),
    byPhase: new Map(before.byPhase),
    bySpace: new Map(before.bySpace),
    byPhaseAndSpace: new Map(before.byPhaseAndSpace),
  };
  const replace = (
    members: readonly NavigatorEntry[],
    old: NavigatorEntry,
    entry: NavigatorEntry,
  ) => members.map((member) => (member === old ? entry : member));
  const copiedPhases = new Set<NavigatorPhase>();
  for (const index of changed) {
    const old = previous[index],
      entry = next[index];
    value.bySpace.set(
      entry.spaceKey,
      replace(value.bySpace.get(entry.spaceKey)!, old, entry),
    );
    if (entry.phase) {
      if (!copiedPhases.has(entry.phase)) {
        value.byPhase.set(entry.phase, value.byPhase.get(entry.phase)!.slice());
        value.byPhaseAndSpace.set(
          entry.phase,
          new Map(value.byPhaseAndSpace.get(entry.phase)),
        );
        copiedPhases.add(entry.phase);
      }
      value.byPhase.get(entry.phase)![entry.phaseIndex] = entry;
      const spaces = value.byPhaseAndSpace.get(entry.phase)!;
      spaces.set(
        entry.spaceKey,
        replace(spaces.get(entry.spaceKey)!, old, entry),
      );
      value.byPhaseAndSpace.set(entry.phase, spaces);
    }
  }
  indices.set(next, value);
}
