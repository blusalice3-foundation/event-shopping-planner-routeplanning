import type {
  ApplicationSnapshotRead,
  ItemContentEdit,
  PersistenceSnapshot,
} from "../../app/ports/PersistenceCommandPort";
import { semanticEqual } from "../../utils/semanticEquality";

export interface SnapshotDelta {
  full?: PersistenceSnapshot;
  stores?: Partial<PersistenceSnapshot>;
  items?: ItemContentEdit[];
  branches?: Array<{
    store: keyof PersistenceSnapshot;
    eventName: string;
    path: string[];
    present: boolean;
    value?: unknown;
  }>;
}
/** Comparison runs only in the storage worker; unchanged payloads never cross the boundary. */
export function snapshotDelta(
  previous: PersistenceSnapshot | undefined,
  next: PersistenceSnapshot,
): SnapshotDelta {
  if (!previous) return { full: next };
  const stores: Partial<PersistenceSnapshot> = {};
  const items: ItemContentEdit[] = [];
  for (const key of Object.keys(next) as Array<keyof PersistenceSnapshot>) {
    if (semanticEqual(previous[key], next[key])) continue;
    if (key !== "eventLists") {
      Object.assign(stores, { [key]: next[key] });
      continue;
    }
    const beforeNames = Object.keys(previous.eventLists);
    const names = Object.keys(next.eventLists);
    if (
      beforeNames.length !== names.length ||
      names.some(
        (name) =>
          !Object.prototype.hasOwnProperty.call(previous.eventLists, name),
      )
    ) {
      stores.eventLists = next.eventLists;
      continue;
    }
    let structural = false;
    const edits: ItemContentEdit[] = [];
    for (const name of names) {
      const before = previous.eventLists[name] as Record<string, unknown>[];
      const after = next.eventLists[name] as Record<string, unknown>[];
      if (
        before.length !== after.length ||
        after.some((item, index) => item.id !== before[index]?.id)
      ) {
        structural = true;
        break;
      }
      after.forEach((item, index) => {
        if (semanticEqual(item, before[index])) return;
        const fields = Object.fromEntries(
          [...new Set([...Object.keys(item), ...Object.keys(before[index])])]
            .filter(
              (field) => !semanticEqual(item[field], before[index][field]),
            )
            .map((field) => [
              field,
              {
                present: Object.prototype.hasOwnProperty.call(item, field),
                value: item[field],
              },
            ]),
        );
        edits.push({ eventName: name, itemId: item.id as string, fields });
      });
    }
    if (structural) stores.eventLists = next.eventLists;
    else items.push(...edits);
  }
  return { stores, items };
}
export interface WorkerSnapshotRead extends Omit<
  ApplicationSnapshotRead,
  "snapshot" | "expectedRoots"
> {
  delta: SnapshotDelta;
  observationId: number;
}

/** Shallow immutable paths let a day acknowledgement preserve every other branch. */
export function applySnapshotBranches(
  snapshot: PersistenceSnapshot,
  branches: NonNullable<SnapshotDelta["branches"]>,
): PersistenceSnapshot {
  let next = snapshot;
  for (const { store, eventName, path, present, value } of branches) {
    const root = { ...next[store] } as Record<string, unknown>;
    let parent = root;
    for (const key of [eventName, ...path].slice(0, -1)) {
      const child = { ...(parent[key] as object) } as Record<string, unknown>;
      parent[key] = child;
      parent = child;
    }
    const key = [eventName, ...path].at(-1)!;
    if (present) parent[key] = value;
    else delete parent[key];
    next = { ...next, [store]: root };
  }
  return next;
}
export function daySnapshotDelta(
  previous: PersistenceSnapshot | undefined,
  next: PersistenceSnapshot,
  eventName: string,
): SnapshotDelta {
  if (!previous) return { full: next };
  const branches: NonNullable<SnapshotDelta["branches"]> = [];
  const compare = (
    store: keyof PersistenceSnapshot,
    before: unknown,
    after: unknown,
    path: string[],
  ) => {
    if (semanticEqual(before, after)) return;
    const record = (value: unknown): value is Record<string, unknown> =>
      !!value && typeof value === "object" && !Array.isArray(value);
    if (record(before) && record(after)) {
      for (const key of new Set([
        ...Object.keys(before),
        ...Object.keys(after),
      ]))
        compare(store, before[key], after[key], [...path, key]);
    } else
      branches.push({
        store,
        eventName,
        path,
        present: after !== undefined,
        value: after,
      });
  };
  const stores: Partial<PersistenceSnapshot> = {};
  for (const store of Object.keys(next) as Array<keyof PersistenceSnapshot>) {
    // The cached baseline carries identical references unless another writer changed it.
    if (previous[store] === next[store]) continue;
    const names = new Set([
      ...Object.keys(previous[store]),
      ...Object.keys(next[store]),
    ]);
    if (
      [...names].some(
        (name) =>
          name !== eventName &&
          !semanticEqual(previous[store][name], next[store][name]),
      )
    ) {
      Object.assign(stores, { [store]: next[store] });
    } else
      compare(store, previous[store][eventName], next[store][eventName], []);
  }
  return { branches, stores };
}
