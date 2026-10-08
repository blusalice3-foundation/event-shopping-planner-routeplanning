import { buildNavigatorEntries } from "./buildNavigatorEntries";
import { buildVisitIdentity } from "./visitIdentity";
import {
  NAVIGATOR_PHASE_ORDER,
  type FocusNavigatorSources,
  type NavigatorBuildSource,
  type NavigatorEntry,
  type NavigatorPhase,
} from "../types";
/** Recompute only groups whose source objects changed. Unchanged entries are shared. */
export function createNavigatorEntriesProjector(phase?: NavigatorPhase) {
  let previousSources: readonly NavigatorBuildSource[] | undefined;
  let previous = new Map<
    string,
    { sources: NavigatorBuildSource[]; entry: NavigatorEntry }
  >();
  let result: NavigatorEntry[] = [];
  return (sources: readonly NavigatorBuildSource[]): NavigatorEntry[] => {
    if (sources === previousSources) return result;
    const groups = new Map<string, NavigatorBuildSource[]>();
    for (const source of sources) {
      const visit = "items" in source ? source : null;
      const item = visit
        ? visit.items[0]
        : (source as Exclude<NavigatorBuildSource, { items: unknown }>);
      const block = visit?.block ?? item?.block;
      const number = visit?.number ?? item?.number;
      if (block === undefined || number === undefined) continue;
      const identity = buildVisitIdentity({
        phase: phase ?? visit?.phase,
        block,
        number,
        priorityLevel: visit?.priorityLevel ?? item?.priorityLevel,
      });
      const group = groups.get(identity.id) ?? [];
      group.push(source);
      groups.set(identity.id, group);
    }
    const next = new Map<
      string,
      { sources: NavigatorBuildSource[]; entry: NavigatorEntry }
    >();
    const output: NavigatorEntry[] = [];
    const counts = new Map<NavigatorPhase | undefined, number>();
    for (const [id, group] of groups) {
      const cached = previous.get(id);
      let entry =
        cached &&
        cached.sources.length === group.length &&
        group.every((source, index) => source === cached.sources[index])
          ? cached.entry
          : buildNavigatorEntries(group, { phase })[0];
      if (!entry) continue;
      const phaseIndex = counts.get(entry.phase) ?? 0;
      counts.set(entry.phase, phaseIndex + 1);
      if (entry.index !== output.length || entry.phaseIndex !== phaseIndex)
        entry = { ...entry, index: output.length, phaseIndex };
      next.set(id, { sources: group, entry });
      output.push(entry);
    }
    if (
      output.length !== result.length ||
      output.some((entry, index) => entry !== result[index])
    )
      result = output;
    previousSources = sources;
    previous = next;
    return result;
  };
}
export function createFocusNavigatorEntriesProjector() {
  const projectors = NAVIGATOR_PHASE_ORDER.map((phase) =>
    createNavigatorEntriesProjector(phase),
  );
  let result: NavigatorEntry[] = [];
  return (sources: FocusNavigatorSources) => {
    const output = NAVIGATOR_PHASE_ORDER.flatMap((phase, index) =>
      projectors[index](sources[phase] ?? []),
    );
    const next = output.map((entry, index) => {
      const old = result[index];
      if (
        old &&
        old.id === entry.id &&
        old.items === entry.items &&
        old.label === entry.label &&
        old.statusCounts === entry.statusCounts &&
        old.warningKinds === entry.warningKinds &&
        old.index === index
      )
        return old;
      return entry.index === index ? entry : { ...entry, index };
    });
    if (
      next.length !== result.length ||
      next.some((entry, index) => entry !== result[index])
    )
      result = next;
    return result;
  };
}
/** Geometry ignores status and price, but includes phase order and all member IDs. */
export function createRouteEntriesProjector() {
  let result: readonly NavigatorEntry[] = [];
  return (entries: readonly NavigatorEntry[]) => {
    if (
      entries.length !== result.length ||
      entries.some(
        (entry, index) =>
          entry.id !== result[index].id ||
          entry.itemIds.length !== result[index].itemIds.length ||
          entry.itemIds.some(
            (id, itemIndex) => id !== result[index].itemIds[itemIndex],
          ),
      )
    )
      result = entries;
    return result;
  };
}
