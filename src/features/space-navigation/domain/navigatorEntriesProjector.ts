import { registerNavigatorEntryChanges } from "./navigatorEntryIndex";
import { buildNavigatorEntries } from "./buildNavigatorEntries";
import { buildVisitIdentity } from "./visitIdentity";
import {
  changedItemPositions,
  registerItemChanges,
} from "../../../utils/itemIndex";
import {
  NAVIGATOR_PHASE_ORDER,
  type FocusNavigatorSources,
  type NavigatorBuildSource,
  type NavigatorEntry,
  type NavigatorPhase,
} from "../types";

const identityForSource = (
  source: NavigatorBuildSource,
  phase?: NavigatorPhase,
) => {
  const visit = "items" in source ? source : null;
  const item = visit
    ? visit.items[0]
    : (source as Exclude<NavigatorBuildSource, { items: unknown }>);
  const block = visit?.block ?? item?.block,
    number = visit?.number ?? item?.number;
  if (block === undefined || number === undefined) return null;
  return buildVisitIdentity({
    phase: phase ?? visit?.phase,
    block,
    number,
    priorityLevel: visit?.priorityLevel ?? item?.priorityLevel,
  }).id;
};

/** Content changes rebuild the affected entry, preserving other visits and indexes. */
export function createNavigatorEntriesProjector(phase?: NavigatorPhase) {
  let previous: readonly NavigatorBuildSource[] | undefined;
  let sourceKeys: (string | null)[] = [];
  let groups = new Map<
    string,
    { sourceIndices: number[]; entryIndex: number }
  >();
  let result: NavigatorEntry[] = [];
  return (sources: readonly NavigatorBuildSource[]): NavigatorEntry[] => {
    if (previous === sources) return result;
    const changes = previous ? changedItemPositions(previous, sources) : null;
    if (
      changes === null ||
      changes.some(
        (index) =>
          identityForSource(sources[index], phase) !== sourceKeys[index],
      )
    ) {
      sourceKeys = sources.map((source) => identityForSource(source, phase));
      groups = new Map();
      sourceKeys.forEach((id, index) => {
        if (id === null) return;
        const group = groups.get(id) ?? {
          sourceIndices: [],
          entryIndex: groups.size,
        };
        group.sourceIndices.push(index);
        groups.set(id, group);
      });
      const output: NavigatorEntry[] = [];
      const counts = new Map<NavigatorPhase | undefined, number>();
      for (const group of groups.values()) {
        const entry = buildNavigatorEntries(
          group.sourceIndices.map((index) => sources[index]),
          { phase },
        )[0];
        if (!entry) continue;
        const phaseIndex = counts.get(entry.phase) ?? 0;
        counts.set(entry.phase, phaseIndex + 1);
        group.entryIndex = output.length;
        output.push({ ...entry, index: output.length, phaseIndex });
      }
      result = output;
    } else if (changes.length) {
      const touched = new Set(
        changes.flatMap((index) => sourceKeys[index] ?? []),
      );
      const next = result.slice();
      const updated: number[] = [];
      for (const id of touched) {
        const group = groups.get(id)!;
        const before = result[group.entryIndex];
        const entry = buildNavigatorEntries(
          group.sourceIndices.map((index) => sources[index]),
          { phase },
        )[0];
        const sameMembers =
          entry.itemIds.length === before.itemIds.length &&
          entry.itemIds.every((id, index) => id === before.itemIds[index]);
        next[group.entryIndex] = {
          ...entry,
          itemIds: sameMembers ? before.itemIds : entry.itemIds,
          index: before.index,
          phaseIndex: before.phaseIndex,
        };
        updated.push(group.entryIndex);
      }
      registerItemChanges(result, next, updated);
      registerNavigatorEntryChanges(result, next, updated);
      result = next;
    }
    previous = sources;
    return result;
  };
}

export function createFocusNavigatorEntriesProjector() {
  const projectors = NAVIGATOR_PHASE_ORDER.map((phase) =>
    createNavigatorEntriesProjector(phase),
  );
  let previous: NavigatorEntry[][] | undefined;
  let result: NavigatorEntry[] = [];
  return (sources: FocusNavigatorSources) => {
    const phases = NAVIGATOR_PHASE_ORDER.map((phase, index) =>
      projectors[index](sources[phase] ?? EMPTY_SOURCES),
    );
    if (
      previous &&
      phases.every((entries, index) => entries === previous![index])
    )
      return result;
    const changes = previous
      ? phases.map((entries, index) =>
          changedItemPositions(previous![index], entries),
        )
      : [];
    if (!previous || changes.some((change) => change === null))
      result = phases
        .flatMap((entries) => entries)
        .map((entry, index) =>
          entry.index === index ? entry : { ...entry, index },
        );
    else {
      const next = result.slice();
      const updated: number[] = [];
      let offset = 0;
      phases.forEach((entries, phaseIndex) => {
        for (const localIndex of changes[phaseIndex]!) {
          const index = offset + localIndex;
          next[index] =
            entries[localIndex].index === index
              ? entries[localIndex]
              : { ...entries[localIndex], index };
          updated.push(index);
        }
        offset += entries.length;
      });
      registerItemChanges(result, next, updated);
      registerNavigatorEntryChanges(result, next, updated);
      result = next;
    }
    previous = phases;
    return result;
  };
}
const EMPTY_SOURCES: readonly NavigatorBuildSource[] = [];

/** Geometry ignores status/price; even comparison examines only changed entries. */
export function createRouteEntriesProjector() {
  let previous: readonly NavigatorEntry[] | undefined;
  let result: readonly NavigatorEntry[] = [];
  return (entries: readonly NavigatorEntry[]) => {
    const changes = previous ? changedItemPositions(previous, entries) : null;
    if (
      changes === null ||
      changes.some((index) => {
        const entry = entries[index],
          before = previous![index];
        return (
          entry.id !== before.id ||
          (entry.itemIds !== before.itemIds &&
            (entry.itemIds.length !== before.itemIds.length ||
              entry.itemIds.some(
                (id, itemIndex) => id !== before.itemIds[itemIndex],
              )))
        );
      })
    )
      result = entries;
    previous = entries;
    return result;
  };
}
