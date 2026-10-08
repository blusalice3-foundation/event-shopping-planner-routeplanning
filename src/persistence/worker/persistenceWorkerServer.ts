import type {
  ApplicationSnapshotRead,
  AtomicSnapshotOptions,
  ItemContentEdit,
  PersistenceSnapshot,
} from "../../app/ports/PersistenceCommandPort";
import { MutationTargetMissingError } from "../../app/commands/applicationMutationCoordinator";
import { planItemContentMutation } from "../../app/state/itemFieldMutation";
import {
  validateSnapshotReferences,
  validateSnapshotStructure,
} from "../../utils/appBackup";
import { snapshotDelta, type WorkerSnapshotRead } from "./snapshotDelta";

export interface PersistenceWorkerDelegate {
  readApplicationSnapshot(): Promise<ApplicationSnapshotRead>;
  commitApplicationSnapshotAtomically(
    snapshot: PersistenceSnapshot,
    options?: AtomicSnapshotOptions,
  ): Promise<void>;
}
export function createPersistenceWorkerServer(
  delegate: PersistenceWorkerDelegate,
) {
  let previous: PersistenceSnapshot | undefined;
  let sequence = 0;
  const observations = new Map<number, object>();
  const publish = (
    read: ApplicationSnapshotRead,
    retainObservation = true,
  ): WorkerSnapshotRead => {
    const observationId = ++sequence;
    if (retainObservation) observations.set(observationId, read.expectedRoots);
    if (observations.size > 8)
      observations.delete(observations.keys().next().value!);
    const delta = snapshotDelta(previous, read.snapshot);
    previous = read.snapshot;
    return {
      delta,
      observationId,
      consistencyMissing: read.consistencyMissing,
      eventGenerations: read.eventGenerations,
    };
  };
  const validate = (snapshot: PersistenceSnapshot) => {
    const errors = [
      ...validateSnapshotStructure(snapshot),
      ...validateSnapshotReferences(snapshot),
    ];
    if (errors.length) throw new Error(errors.join("\n"));
  };
  return {
    async read() {
      return publish(await delegate.readApplicationSnapshot());
    },
    async commit(
      snapshot: PersistenceSnapshot,
      options: AtomicSnapshotOptions & { observationId?: number } = {},
    ) {
      validate(snapshot);
      const expectedRoots =
        options.observationId === undefined
          ? undefined
          : observations.get(options.observationId);
      if (options.observationId !== undefined && !expectedRoots) {
        const error = new Error("Persistence observation expired.");
        error.name = "PersistenceConflict";
        throw error;
      }
      await delegate.commitApplicationSnapshotAtomically(snapshot, {
        ...options,
        expectedRoots,
      });
      // The next read computes its delta against the last value actually sent to the UI.
    },
    async items(
      edits: readonly ItemContentEdit[],
      operationIds: readonly string[],
      expectedGenerations: Readonly<Record<string, number>>,
    ) {
      if (!operationIds.length) throw new Error("Missing operation sequence.");
      for (let attempt = 0; attempt < 3; attempt++) {
        const read = await delegate.readApplicationSnapshot();
        const generations = read.eventGenerations ?? {};
        if (
          [
            ...new Set([
              ...Object.keys(generations),
              ...Object.keys(expectedGenerations),
            ]),
          ].some(
            (event) =>
              (generations[event] ?? 0) !== (expectedGenerations[event] ?? 0),
          )
        )
          return { status: "review-required" as const };
        let plan;
        try {
          plan = planItemContentMutation(read.snapshot, edits);
        } catch (error) {
          if (error instanceof MutationTargetMissingError)
            return { status: "review-required" as const };
          throw error;
        }
        // A review is a hard boundary: no part of this group is written before it.
        if (plan.confirmation) return { status: "review-required" as const };
        validate(plan.snapshot);
        try {
          await delegate.commitApplicationSnapshotAtomically(plan.snapshot, {
            expectedRoots: read.expectedRoots,
            changedStoresOnly: true,
          });
          return {
            status: "committed" as const,
            read: publish({ ...read, snapshot: plan.snapshot }, false),
          };
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !["PersistenceConflict", "PersistenceConflictError"].includes(
              error.name,
            )
          )
            throw error;
        }
      }
      const error = new Error(
        "保存の競合が続いています。最新の内容を確認して再試行してください。",
      );
      error.name = "MutationConflict";
      throw error;
    },
  };
}
