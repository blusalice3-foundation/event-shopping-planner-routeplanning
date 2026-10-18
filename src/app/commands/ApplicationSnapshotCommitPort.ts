import type { PersistenceSnapshot } from "../ports/PersistenceCommandPort";
import type { BlockDetectionSettings } from "../../types/map";

export type ApplicationSnapshotPatch = Partial<PersistenceSnapshot>;
/** Rechecked against the latest serialized snapshot on planning and retries. */
export type ApplicationSnapshotGuard = (snapshot: PersistenceSnapshot) => void;

/** Explicit destination days for route patches spanning multiple dates. */
export interface ApplicationSnapshotCommitContext {
  /** Skip the ordinary placement review after an event update was reviewed. */
  confirm?: boolean;
  routeDays?: Record<string, Record<string, string[]>>;
  /** Detailed hall sync replaces only polygon route entries in these targets.
   * Each destination day retains its own simple/unassigned groups and visits. */
  polygonHallSyncTargets?: Record<string, string[]>;
}

export interface ApplicationSnapshotCommitPort {
  /** Captures changes against the render that supplied this port, then applies
   * them to the latest queued state. Resolves after saving and applying it.
   * Callers may finish UI effects, but must not reapply the submitted patch.
   */
  commitApplicationSnapshotPatch(
    patch: ApplicationSnapshotPatch,
    blockDetectionSettings?: {
      eventName: string;
      settings: BlockDetectionSettings | null;
    },
    context?: ApplicationSnapshotCommitContext,
    assertCurrent?: ApplicationSnapshotGuard,
  ): Promise<void>;
}
