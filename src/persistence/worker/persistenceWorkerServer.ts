import {
  planShoppingMove,
  shoppingMoveMatchesBaseline,
  shoppingItemIds,
} from "../../app/commands/shoppingMoveMutation";
import { PersistenceOutcomeUnknownError } from "../../app/ports/PersistenceCommandPort";
import { recordEntry } from "../../utils/ownRecord";
import { registerItemGuardGenerations } from "../../utils/itemContentGuard";
import {
  dayMutationScope,
  matchesScopeDay,
} from "../../features/consistency/domain/dayScope";
import type {
  ApplicationSnapshotRead,
  ApplicationDayMutation,
  ApplicationShoppingMove,
  ApplicationDayScope,
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
import {
  snapshotDelta,
  daySnapshotDelta,
  type WorkerSnapshotRead,
} from "./snapshotDelta";

import {
  planDayMutation,
  scopeDaySnapshot,
  adoptScopedDaySnapshot,
  mergeDaySnapshot,
} from "../../features/consistency/domain/dayMutation";
import { duplicateEventDays } from "../../features/consistency/domain/dayMerge";

export interface PersistenceWorkerDelegate {
  readShoppingCommandSnapshot?(
    target: ApplicationDayScope,
  ): Promise<ApplicationSnapshotRead | undefined>;
  commitShoppingCommandSnapshot?(
    snapshot: PersistenceSnapshot,
    expectedRoots: object,
    target: ApplicationDayScope,
  ): Promise<ApplicationSnapshotRead | void>;
  readDayCommandSnapshot?(
    target?: ApplicationDayScope,
  ): Promise<ApplicationSnapshotRead>;
  commitDayCommandSnapshot?(
    snapshot: PersistenceSnapshot,
    expectedRoots: object,
    target: ApplicationDayScope,
  ): Promise<void>;
  readApplicationSnapshot(options?: {
    shareVerified?: boolean;
    prepareScopedCommands?: boolean;
  }): Promise<ApplicationSnapshotRead>;
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
  const observedSnapshots = new Map<number, PersistenceSnapshot>();
  const publish = (
    read: ApplicationSnapshotRead,
    retainObservation = true,
    dayEvent?: string,
    forceFull = false,
  ): WorkerSnapshotRead => {
    const observationId = ++sequence;
    if (retainObservation) {
      observations.set(observationId, read.expectedRoots);
      observedSnapshots.set(observationId, read.snapshot);
    }
    if (observations.size > 8) {
      const expired = observations.keys().next().value!;
      observations.delete(expired);
      observedSnapshots.delete(expired);
    }
    const next = read.scopeTarget
      ? adoptScopedDaySnapshot(previous, read.snapshot, read.scopeTarget)
      : read.snapshot;
    const delta = forceFull
      ? { full: next }
      : read.scopeTarget && (!previous || retainObservation)
        ? { scope: { target: read.scopeTarget, snapshot: read.snapshot } }
        : dayEvent || read.scopeTarget
          ? daySnapshotDelta(
              previous,
              next,
              dayEvent ?? read.scopeTarget!.eventName,
            )
          : snapshotDelta(previous, next);
    previous = next;
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
      return publish(
        await delegate.readApplicationSnapshot({
          shareVerified: true,
          prepareScopedCommands: true,
        }),
      );
    },
    async readFull() {
      // Never run scoped preparation writes while recovering a known commit.
      const read = await delegate.readApplicationSnapshot({
        shareVerified: true,
        prepareScopedCommands: false,
      });
      if (read.consistencyMissing || read.scopeTarget)
        throw new Error(
          "Recovery requires verified complete persistent state.",
        );
      validate(read.snapshot);
      return publish(read, true, undefined, true);
    },
    async shopping(
      command: ApplicationShoppingMove,
      operationId: string,
      expectedGenerations: Readonly<Record<string, number>>,
    ) {
      if (!operationId) throw new Error("Missing operation sequence.");
      if (
        !previous ||
        !delegate.readShoppingCommandSnapshot ||
        !delegate.commitShoppingCommandSnapshot
      )
        return { status: "review-required" as const };
      const target = { eventName: command.eventName, day: command.day };
      for (let attempt = 0; attempt < 3; attempt++) {
        let read: ApplicationSnapshotRead | undefined;
        try {
          read = await delegate.readShoppingCommandSnapshot(target);
        } catch (error) {
          if (
            error instanceof Error &&
            ["PersistenceConflict", "PersistenceConflictError"].includes(
              error.name,
            )
          )
            return { status: "review-required" as const };
          throw error;
        }
        if (
          !read ||
          (recordEntry(read.eventGenerations, command.eventName) ?? 0) !==
            (recordEntry(expectedGenerations, command.eventName) ?? 0) ||
          recordEntry(read.snapshot.eventConsistency, command.eventName)
            ?.legacyPending.length ||
          duplicateEventDays(read.snapshot, command.eventName).some((day) =>
            matchesScopeDay(target, day),
          ) ||
          !shoppingMoveMatchesBaseline(read.snapshot, command)
        )
          return { status: "review-required" as const };
        const plan = planShoppingMove(read.snapshot, command);
        if (plan.confirmation) return { status: "review-required" as const };
        const scoped = scopeDaySnapshot(
          plan.snapshot,
          command.eventName,
          command.day,
        );
        const maps = new WeakSet<object>(
          Object.values(
            recordEntry(scoped.mapData, command.eventName) ?? {},
          ).filter(
            (value): value is object => !!value && typeof value === "object",
          ),
        );
        const errors = [
          ...validateSnapshotStructure(scoped, true, maps),
          ...validateSnapshotReferences(scoped, maps),
        ];
        if (errors.length) throw new Error(errors.join("\n"));
        let committedReceipt: ApplicationSnapshotRead | void;
        try {
          committedReceipt = await delegate.commitShoppingCommandSnapshot(
            plan.snapshot,
            read.expectedRoots,
            target,
          );
        } catch (error) {
          if (
            error instanceof Error &&
            ["PersistenceConflict", "PersistenceConflictError"].includes(
              error.name,
            )
          )
            continue;
          throw error;
        }
        // The write is known durable. Delta construction may fail, but never resend it.
        const base = previous;
        const baseObservationId = sequence;
        previous = plan.snapshot;
        const observationId = ++sequence;
        try {
          const committedRead =
            committedReceipt ??
            (await delegate.readShoppingCommandSnapshot(target));
          if (!committedRead)
            throw new Error("Committed shopping roots unavailable.");
          observations.set(observationId, committedRead.expectedRoots);
          observedSnapshots.set(observationId, committedRead.snapshot);
          while (observations.size > 8) {
            const expired = observations.keys().next().value!;
            observations.delete(expired);
            observedSnapshots.delete(expired);
          }
          const delta = daySnapshotDelta(
            base,
            { ...plan.snapshot, eventLists: base.eventLists },
            command.eventName,
          );
          if (
            Object.keys(delta.stores ?? {}).length ||
            delta.full ||
            delta.scope ||
            delta.items?.length
          )
            throw new Error("Shopping order requires a new complete baseline.");
          delta.shoppingOrder = {
            version: 1,
            eventName: command.eventName,
            day: command.day,
            baseObservationId,
            baselineItemIds: shoppingItemIds(
              recordEntry(base.eventLists, command.eventName) ?? [],
            ),
            itemIds: shoppingItemIds(
              recordEntry(plan.snapshot.eventLists, command.eventName) ?? [],
            ),
          };
          return {
            status: "committed" as const,
            read: {
              delta,
              observationId,
              consistencyMissing: false,
              eventGenerations: read.eventGenerations,
            },
          };
        } catch {
          return { status: "committed" as const, deltaError: true as const };
        }
      }
      const error = new Error("Shopping move conflicts exhausted.");
      error.name = "MutationConflict";
      throw error;
    },
    async readDay(target: ApplicationDayScope) {
      const read = await (delegate.readDayCommandSnapshot?.(target) ??
        delegate.readApplicationSnapshot());
      const scoped = scopeDaySnapshot(
        read.snapshot,
        target.eventName,
        target.day,
        target.additionalDays,
      );
      // Items are event records; keep all dates for adoption into the UI mirror.
      scoped.eventLists = recordEntry(
        read.snapshot.eventLists,
        target.eventName,
      )
        ? {
            [target.eventName]: recordEntry(
              read.snapshot.eventLists,
              target.eventName,
            ),
          }
        : {};
      if (recordEntry(scoped.eventConsistency, target.eventName))
        recordEntry(scoped.eventConsistency, target.eventName).legacyPending =
          recordEntry(
            read.snapshot.eventConsistency,
            target.eventName,
          ).legacyPending;
      const result = publish({
        ...read,
        snapshot: scoped,
        scopeTarget: target,
      });
      observedSnapshots.set(result.observationId, read.snapshot);
      return result;
    },
    async commitDay(
      submitted: PersistenceSnapshot,
      observationId: number,
      target: ApplicationDayScope,
    ) {
      const expectedRoots = observations.get(observationId);
      const base = observedSnapshots.get(observationId);
      if (!expectedRoots || !base || !delegate.commitDayCommandSnapshot) {
        const error = new Error("Persistence observation expired.");
        error.name = "PersistenceConflict";
        throw error;
      }
      validate(submitted);
      const next = mergeDaySnapshot(
        base,
        scopeDaySnapshot(
          base,
          target.eventName,
          target.day,
          target.additionalDays,
        ),
        submitted,
        target.eventName,
        target.day,
        target.additionalDays,
      );
      await delegate.commitDayCommandSnapshot(next, expectedRoots, target);
      try {
        const scoped = scopeDaySnapshot(
          next,
          target.eventName,
          target.day,
          target.additionalDays,
        );
        scoped.eventLists = {
          [target.eventName]: recordEntry(next.eventLists, target.eventName),
        };
        if (recordEntry(scoped.eventConsistency, target.eventName))
          recordEntry(scoped.eventConsistency, target.eventName).legacyPending =
            recordEntry(next.eventConsistency, target.eventName).legacyPending;
        return publish(
          {
            snapshot: scoped,
            expectedRoots,
            consistencyMissing: false,
            scopeTarget: target,
          },
          false,
        );
      } catch (error) {
        throw new PersistenceOutcomeUnknownError(error);
      }
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
      // The caller adopts its submitted snapshot when this commit resolves.
      try {
        previous =
          (await delegate.readDayCommandSnapshot?.())?.snapshot ?? snapshot;
      } catch (error) {
        throw new PersistenceOutcomeUnknownError(error);
      }
    },
    async day(
      command: ApplicationDayMutation,
      operationId: string,
      expectedGenerations: Readonly<Record<string, number>>,
    ) {
      if (!operationId) throw new Error("Missing operation sequence.");
      const target = dayMutationScope(command);
      for (let attempt = 0; attempt < 3; attempt++) {
        const read = await (delegate.readDayCommandSnapshot?.(target) ??
          delegate.readApplicationSnapshot());
        if (
          (recordEntry(read.eventGenerations, command.eventName) ?? 0) !==
          (recordEntry(expectedGenerations, command.eventName) ?? 0)
        )
          return { status: "review-required" as const };
        if (
          duplicateEventDays(read.snapshot, command.eventName).some((day) =>
            matchesScopeDay(target, day),
          )
        )
          return { status: "review-required" as const };
        if (
          recordEntry(read.snapshot.eventConsistency, command.eventName)
            ?.legacyPending.length
        )
          return { status: "review-required" as const };
        let plan;
        try {
          plan = planDayMutation(read.snapshot, command);
        } catch (error) {
          if (error instanceof MutationTargetMissingError)
            return { status: "review-required" as const };
          throw error;
        }
        if (plan.confirmation) return { status: "review-required" as const };
        const scoped = scopeDaySnapshot(
          plan.snapshot,
          command.eventName,
          command.day,
          target.additionalDays,
        );
        const maps = new WeakSet<object>(
          Object.values(
            recordEntry(scoped.mapData, command.eventName) ?? {},
          ).filter(
            (value): value is object => !!value && typeof value === "object",
          ),
        );
        const errors = [
          ...validateSnapshotStructure(scoped, true, maps),
          ...validateSnapshotReferences(scoped, maps),
        ];
        if (errors.length) throw new Error(errors.join("\n"));
        let committed = false;
        try {
          if (delegate.commitDayCommandSnapshot)
            await delegate.commitDayCommandSnapshot(
              plan.snapshot,
              read.expectedRoots,
              target,
            );
          else
            await delegate.commitApplicationSnapshotAtomically(plan.snapshot, {
              expectedRoots: read.expectedRoots,
              changedStoresOnly: true,
            });
          committed = true;
          return {
            status: "committed" as const,
            read: publish(
              { ...read, snapshot: plan.snapshot },
              false,
              command.eventName,
            ),
          };
        } catch (error) {
          if (committed) throw new PersistenceOutcomeUnknownError(error);
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
              (recordEntry(generations, event) ?? 0) !==
              (recordEntry(expectedGenerations, event) ?? 0),
          )
        )
          return { status: "review-required" as const };
        let plan;
        try {
          registerItemGuardGenerations(read.snapshot, generations);
          plan = planItemContentMutation(read.snapshot, edits);
        } catch (error) {
          if (error instanceof MutationTargetMissingError)
            return { status: "review-required" as const };
          throw error;
        }
        // A review is a hard boundary: no part of this group is written before it.
        if (plan.confirmation) return { status: "review-required" as const };
        validate(plan.snapshot);
        let committed = false;
        try {
          await delegate.commitApplicationSnapshotAtomically(plan.snapshot, {
            expectedRoots: read.expectedRoots,
            changedStoresOnly: true,
          });
          committed = true;
          return {
            status: "committed" as const,
            read: publish(
              {
                ...read,
                snapshot:
                  (await delegate.readDayCommandSnapshot?.())?.snapshot ??
                  plan.snapshot,
              },
              false,
            ),
          };
        } catch (error) {
          if (committed) throw new PersistenceOutcomeUnknownError(error);
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
