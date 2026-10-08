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
