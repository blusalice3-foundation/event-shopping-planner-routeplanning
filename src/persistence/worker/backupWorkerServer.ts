import type {
  ApplicationBackupChange,
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
    snapshot?: PersistenceSnapshot;
  },
): Promise<{ file: ApplicationBackupFile } | { needsSnapshot: true }> {
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
        store[change.eventName] === undefined && change.desired !== undefined
          ? change.desired
          : applyChangedFields(
              change.baseline,
              change.desired,
              store[change.eventName],
            );
      if (value === undefined) delete store[change.eventName];
      else store[change.eventName] = value;
      snapshot = { ...snapshot, [change.store]: store };
    }
  }
  return { file: createAppBackupFile(snapshot) };
}
