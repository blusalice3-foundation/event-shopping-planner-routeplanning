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
  /** Target days sharing the source map use its mixed route as input, while
   * retaining their own simple entries. The source day still saves its full draft. */
  polygonHallSyncTargetDays?: Record<string, Record<string, string[]>>;
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

/** Synchronous acceptance of a frozen drag; saving remains on the normal queue. */
export interface ShoppingMovePatch {
  /** Orders used by the UI calculation, checked against the accepted preview. */
  baselineItemIds: readonly string[];
  baselineExecuteIds: readonly string[];
  eventName: string;
  day: string;
  eventGeneration?: number;
  eventListItems?: readonly import("../../types/item").ShoppingItem[];
  executeModeItems?: import("../../types/item").ExecuteModeItems;
  sourceColumn: "execute" | "candidate";
  targetColumn: "execute" | "candidate";
  requestedIds: readonly string[];
  effectiveIds: readonly string[];
  hoverId: string;
  candidateSortMode?: string;
}
export type ShoppingMoveReceipt =
  | { status: "accepted"; operationId: string; moveId: string }
  | { status: "noop"; reason: "same-order" }
  | { status: "blocked"; reason: string };
export type QueueShoppingMovePatch = (
  input: ShoppingMovePatch,
) => ShoppingMoveReceipt;
