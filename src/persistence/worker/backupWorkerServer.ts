import { ownValue, setOwnValue } from "../../utils/ownRecord";
import type {
  ApplicationBackupChange,
  ItemContentEdit,
  ApplicationBackupFile,
  ApplicationSnapshotRead,
  PersistenceSnapshot,
} from "../../app/ports/PersistenceCommandPort";
import { applyChangedFields } from "../../features/consistency/domain/mutations";
import { createAppBackupFile } from "../../utils/appBackup";

export async function buildWorkerBackup(
  read: () => Promise<ApplicationSnapshotRead>,
  request: {
    changes: readonly ApplicationBackupChange[];
    guardedItemEdits?: readonly ItemContentEdit[];
    snapshot?: PersistenceSnapshot;
  },
): Promise<{ file: ApplicationBackupFile } | { needsSnapshot: true }> {
  // Guarded accepted input must be captured against the UI's current context.
  // Never rebase its unguarded whole-item diff onto a newer durable snapshot.
  if (
    !request.snapshot &&
    request.guardedItemEdits?.some(
      (edit) => edit.guard || edit.operationKind === "limited-input",
    )
  )
    return { needsSnapshot: true };
  let snapshot = request.snapshot;
  if (!snapshot) {
    try {
      snapshot = (await read()).snapshot;
    } catch {
      return { needsSnapshot: true };
    }
    for (const change of request.changes) {
      const store = { ...snapshot[change.store] } as Record<string, unknown>;
      const value =
        ownValue(store, change.eventName) === undefined &&
        change.desired !== undefined
          ? change.desired
          : applyChangedFields(
              change.baseline,
              change.desired,
              ownValue(store, change.eventName),
            );
      if (value === undefined) delete store[change.eventName];
      else setOwnValue(store, change.eventName, value);
      snapshot = { ...snapshot, [change.store]: store };
    }
  }
  return { file: createAppBackupFile(snapshot) };
}
