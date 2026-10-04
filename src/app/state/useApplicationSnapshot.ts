import type { ApplicationSnapshotCommitContext } from "../commands/ApplicationSnapshotCommitPort";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import type {
  PersistenceCommandPort,
  PersistenceSnapshot,
} from "../ports/PersistenceCommandPort";
import type {
  PersistedStateSetters,
  PersistedStateValues,
} from "../../hooks/useIndexedDbPersistence";
import {
  createApplicationMutationCoordinator,
  MutationConflictError,
  CommittedStateApplyError,
  type MutationPlan,
  type ConfirmationToken,
  type MutationConfirmation,
  type MutationIntent,
  type MutationResult,
} from "../commands/applicationMutationCoordinator";
import {
  applyChangedFields,
  changedFieldConflicts,
  confirmChangedFieldConflicts,
  planProjectedMutation,
  type MutationContext,
} from "../../features/consistency/domain/mutations";
import { projectConsistencySnapshot } from "../../features/consistency/domain/projection";
import { createEventConsistency } from "../../types/consistency";
import {
  validateSnapshotStructure,
  validateSnapshotReferences,
} from "../../utils/appBackup";
import type { BlockDetectionSettings } from "../../types/map";

export const emptyApplicationSnapshot = (): PersistedStateValues => ({
  eventLists: {},
  eventMetadata: {},
  executeModeItems: {},
  dayModes: {},
  mapData: {},
  mapRotationSettings: {},
  mapViewportSettings: {},
  routeSettings: {},
  hallDefinitions: {},
  hallRouteSettings: {},
  eventConsistency: {},
});
const keys = Object.keys(emptyApplicationSnapshot()) as Array<
  keyof PersistedStateValues
>;
type Batch = {
  id: string;
  context: MutationContext;
  base: PersistenceSnapshot;
  draft: PersistenceSnapshot;
  retainOnConflict?: boolean;
  acceptedBase?: PersistenceSnapshot;
  acceptedDraft?: PersistenceSnapshot;
};
function planBatch(batch: Batch, latest: PersistenceSnapshot): MutationPlan {
  const projected = projectConsistencySnapshot(
    latest,
    batch.context.eventName,
    batch.context.day,
  );
  const changed: Partial<PersistenceSnapshot> = {};
  for (const key of keys)
    if (JSON.stringify(batch.base[key]) !== JSON.stringify(batch.draft[key]))
      Object.assign(changed, {
        [key]: applyChangedFields(
          batch.base[key],
          batch.draft[key],
          projected[key],
        ),
      });
  return confirmChangedFieldConflicts(
    planProjectedMutation(latest, changed, batch.context),
    changedFieldConflicts(batch.base, batch.draft, projected),
  );
}
function applyAcceptedBatches(
  source: PersistenceSnapshot,
  batches: Batch[],
  retainedIds: ReadonlySet<string>,
): PersistenceSnapshot {
  let snapshot = source;
  for (const batch of batches)
    if (retainedIds.has(batch.id))
      snapshot = planBatch(
        {
          ...batch,
          base: batch.acceptedBase ?? batch.base,
          draft: batch.acceptedDraft ?? batch.draft,
        },
        snapshot,
      ).snapshot;
  return snapshot;
}
export class MutationCancelledError extends Error {
  constructor() {
    super("操作を取り消しました。");
    this.name = "MutationCancelled";
  }
}

/** Committed state stays separate from accepted edits retained after a save failure. */
export function useApplicationSnapshot(
  persistence: PersistenceCommandPort,
  eventName: string | null,
  day: string,
) {
  const [raw, setRaw] = useState(emptyApplicationSnapshot);
  const rawRef = useRef(raw);
  const contextRef = useRef<MutationContext>({ eventName, day });
  contextRef.current = { eventName, day };
  const handlers = useRef({
    drain: async () => {},
    applied: (_snapshot: PersistedStateValues, _events: string[]) => {},
  });
  const [requiresReload, setRequiresReload] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingChoices, setPendingChoices] = useState(0);
  const [confirmations, setConfirmations] = useState<
    Array<{ token: ConfirmationToken; confirmation: MutationConfirmation }>
  >([]);
  const resolvers = useRef(
    new Map<
      string,
      {
        resolve(snapshot: PersistenceSnapshot): void;
        reject(error: unknown): void;
      }
    >(),
  );
  const sequence = useRef(0);
  const renderedGenerations = useRef<Record<string, number>>({});
  const draft = useRef<Batch | null>(null);
  const submitted = useRef<Batch[]>([]);
  const previewRef = useRef<PersistenceSnapshot>(raw);
  const suspended = useRef(new Set<string>());
  const retained = useRef(new Set<string>());
  const [retainedOperationIds, setRetainedOperationIds] = useState<string[]>(
    [],
  );
  const [retryableFailures, setRetryableFailures] = useState<string[]>([]);
  const readAcceptedSnapshot = useCallback(
    () =>
      applyAcceptedBatches(rawRef.current, submitted.current, retained.current),
    [],
  );
  const releasePending = useCallback((id: string) => {
    if (suspended.current.delete(id))
      setRetryableFailures([...suspended.current]);
    if (retained.current.delete(id))
      setRetainedOperationIds([...retained.current]);
  }, []);
  const coordinator = useMemo(
    () =>
      createApplicationMutationCoordinator({
        readCurrent: () => rawRef.current,
        readExportCurrent: readAcceptedSnapshot,
        drain: () => handlers.current.drain(),
        readDurable: () => persistence.readApplicationSnapshot(),
        commit: async (snapshot, expectedRoots) => {
          const errors = [
            ...validateSnapshotStructure(snapshot),
            ...validateSnapshotReferences(snapshot),
          ];
          if (errors.length) throw new Error(errors.join("\n"));
          await persistence.commitApplicationSnapshotAtomically(snapshot, {
            expectedRoots,
          });
        },
        apply: (snapshot, events) => {
          rawRef.current = snapshot as unknown as PersistedStateValues;
          setRaw(rawRef.current);
          handlers.current.applied(rawRef.current, events);
        },
        onApplyFailure: (error) => {
          setRequiresReload(true);
          setFailure(error.message);
        },
        onExpired: (ids) => {
          const expired = new Set(ids);
          submitted.current = submitted.current.filter(
            (batch) => !expired.has(batch.id),
          );
          for (const id of ids) {
            releasePending(id);
            resolvers.current.get(id)?.reject(new MutationCancelledError());
            resolvers.current.delete(id);
          }
          setConfirmations((current) =>
            current.filter((entry) => !expired.has(entry.token.operationId)),
          );
          setPendingCount(resolvers.current.size);
        },
      }),
    [persistence, readAcceptedSnapshot, releasePending],
  );
  renderedGenerations.current = Object.fromEntries(
    [
      ...Object.keys(renderedGenerations.current),
      ...Object.keys(raw.eventLists),
      ...(eventName ? [eventName] : []),
    ].map((name) => [name, coordinator.generation(name)]),
  );
  const rebuildPreview = useCallback(() => {
    let next = projectConsistencySnapshot(
      rawRef.current,
      contextRef.current.eventName,
      contextRef.current.day,
    );
    for (const batch of [
      ...submitted.current,
      ...(draft.current ? [draft.current] : []),
    ])
      next = applyChangedFields(
        batch.acceptedBase ?? batch.base,
        batch.acceptedDraft ?? batch.draft,
        next,
      ) as PersistenceSnapshot;
    previewRef.current = next;
  }, []);
  // Do not replace a synchronously accepted draft with an older render.
  rebuildPreview();
  const handleResult = useCallback(
    (id: string, result: MutationResult) => {
      if (result.status === "confirmation-required") {
        setConfirmations((current) => [
          ...current.filter((entry) => entry.token.operationId !== id),
          { token: result.token, confirmation: result.confirmation },
        ]);
        return;
      }
      setConfirmations((current) =>
        current.filter((entry) => entry.token.operationId !== id),
      );
      if (result.status === "committed") {
        const index = submitted.current.findIndex((batch) => batch.id === id);
        const committed = submitted.current[index];
        if (committed) {
          // A newer saved edit wins in the display. Keep the original intent
          // unchanged so retry still compares it with the latest durable values.
          for (const earlier of submitted.current.slice(0, index)) {
            if (!retained.current.has(earlier.id)) continue;
            earlier.acceptedBase = applyChangedFields(
              committed.base,
              committed.draft,
              earlier.acceptedBase ?? earlier.base,
            ) as PersistenceSnapshot;
            earlier.acceptedDraft = applyChangedFields(
              committed.base,
              committed.draft,
              earlier.acceptedDraft ?? earlier.draft,
            ) as PersistenceSnapshot;
          }
          if (retained.current.size)
            setRetainedOperationIds([...retained.current]);
        }
      }
      releasePending(id);
      submitted.current = submitted.current.filter((batch) => batch.id !== id);
      rebuildPreview();
      const resolver = resolvers.current.get(id);
      resolvers.current.delete(id);
      if (result.status === "committed") resolver?.resolve(result.snapshot);
      else resolver?.reject(new MutationCancelledError());
      setPendingCount(resolvers.current.size);
    },
    [rebuildPreview, releasePending],
  );
  const fail = useCallback(
    (id: string, error: unknown) => {
      const batch = submitted.current.find((entry) => entry.id === id);
      if (
        error instanceof MutationConflictError ||
        (batch?.retainOnConflict &&
          !(error instanceof MutationCancelledError) &&
          !(error instanceof CommittedStateApplyError))
      ) {
        suspended.current.add(id);

        if (batch?.retainOnConflict && !retained.current.has(id)) {
          retained.current.add(id);
          setRetainedOperationIds([...retained.current]);
        }
        setRetryableFailures([...suspended.current]);
        if (!(error instanceof MutationConflictError))
          setFailure(
            error instanceof Error ? error.message : "保存に失敗しました。",
          );
        setConfirmations((current) =>
          current.filter((entry) => entry.token.operationId !== id),
        );
        rebuildPreview();
        return;
      }
      coordinator.discard(id);
      releasePending(id);
      submitted.current = submitted.current.filter((batch) => batch.id !== id);
      setConfirmations((current) =>
        current.filter((entry) => entry.token.operationId !== id),
      );
      rebuildPreview();
      resolvers.current.get(id)?.reject(error);
      resolvers.current.delete(id);
      setPendingCount(resolvers.current.size);
      if (!(error instanceof MutationCancelledError))
        setFailure(
          error instanceof Error ? error.message : "保存に失敗しました。",
        );
    },
    [coordinator, rebuildPreview, releasePending],
  );
  const request = useCallback(
    (
      intent: Omit<MutationIntent, "id"> & { id?: string },
    ): Promise<PersistenceSnapshot> => {
      const id = intent.id ?? `application:${++sequence.current}`;
      const acceptedContext = { ...contextRef.current };
      const result = new Promise<PersistenceSnapshot>((resolve, reject) => {
        resolvers.current.set(id, { resolve, reject });
      });
      setPendingCount(resolvers.current.size);
      void coordinator
        .request({
          ...intent,
          id,
          plan: (snapshot, choices) => {
            const base = intent.retainOnConflict
              ? projectConsistencySnapshot(
                  structuredClone(snapshot),
                  acceptedContext.eventName,
                  acceptedContext.day,
                )
              : null;
            const plan = intent.plan(snapshot, choices);
            if (base && !submitted.current.some((batch) => batch.id === id)) {
              submitted.current.push({
                id,
                context: acceptedContext,
                base,
                draft: projectConsistencySnapshot(
                  structuredClone(plan.snapshot),
                  acceptedContext.eventName,
                  acceptedContext.day,
                ),
                retainOnConflict: true,
              });
              rebuildPreview();
            }
            return plan;
          },
          expectedGenerations:
            intent.expectedGenerations ??
            Object.fromEntries(
              intent.events.map((name) => [
                name,
                renderedGenerations.current[name] ?? 0,
              ]),
            ),
        })
        .then(
          (result) => handleResult(id, result),
          (error) => fail(id, error),
        );
      return result;
    },
    [coordinator, handleResult, fail, rebuildPreview],
  );
  const submitBatch = useCallback(
    (batch: Batch) => {
      submitted.current.push(batch);
      const events = [
        ...new Set(
          keys
            .flatMap((key) => [
              ...Object.keys(batch.base[key]),
              ...Object.keys(batch.draft[key]),
            ])
            .filter((name) =>
              keys.some(
                (key) =>
                  JSON.stringify(batch.base[key][name]) !==
                  JSON.stringify(batch.draft[key][name]),
              ),
            ),
        ),
      ];
      return request({
        id: batch.id,
        events,
        plan: (latest) => planBatch(batch, latest),
      });
    },
    [request],
  );
  const flushDraft = useCallback(() => {
    const batch = draft.current;
    if (!batch) return;
    draft.current = null;
    void submitBatch(batch).catch(() => {});
  }, [submitBatch]);
  const setters = useMemo(
    () =>
      Object.fromEntries(
        keys.map((key) => [
          `set${key[0].toUpperCase()}${key.slice(1)}`,
          (action: SetStateAction<PersistedStateValues[typeof key]>) => {
            if (!draft.current) {
              const base = structuredClone(previewRef.current);
              draft.current = {
                id: `application:${++sequence.current}`,
                context: { ...contextRef.current },
                base,
                draft: structuredClone(base),
                retainOnConflict: true,
              };
              queueMicrotask(flushDraft);
            }
            const current = draft.current.draft[
              key
            ] as PersistedStateValues[typeof key];
            const next =
              typeof action === "function"
                ? (action as (value: typeof current) => typeof current)(current)
                : action;
            Object.assign(draft.current.draft, { [key]: next });
            rebuildPreview();
            return next;
          },
        ]),
      ) as unknown as PersistedStateSetters,
    [flushDraft, rebuildPreview],
  );
  const hydrationSetters = useMemo(
    () =>
      Object.fromEntries(
        keys.map((key) => [
          `set${key[0].toUpperCase()}${key.slice(1)}`,
          (action: SetStateAction<PersistedStateValues[typeof key]>) => {
            const current = rawRef.current[key];
            const value =
              typeof action === "function"
                ? (action as (value: typeof current) => typeof current)(current)
                : action;
            rawRef.current = { ...rawRef.current, [key]: value };
            setRaw(rawRef.current);
            rebuildPreview();
          },
        ]),
      ) as unknown as PersistedStateSetters,
    [rebuildPreview],
  );
  const values = useMemo(
    () =>
      projectConsistencySnapshot(
        applyAcceptedBatches(
          raw,
          submitted.current,
          new Set(retainedOperationIds),
        ),
        eventName,
        day,
      ) as unknown as PersistedStateValues,
    [raw, eventName, day, retainedOperationIds],
  );
  const commitPatch = useCallback(
    async (
      patch: Partial<PersistenceSnapshot>,
      settings?: { eventName: string; settings: BlockDetectionSettings | null },
      context?: ApplicationSnapshotCommitContext,
    ) => {
      flushDraft();
      // The submitted patch was computed from this render, not the pending preview.
      // Capture only its changes; queued plans apply them to the latest snapshot.
      const base = structuredClone(values);
      const next = { ...base, ...patch };
      if (settings) {
        next.eventConsistency = structuredClone(next.eventConsistency);
        next.eventConsistency[settings.eventName] ??= createEventConsistency();
        next.eventConsistency[settings.eventName].blockDetectionSettings =
          settings.settings;
      }
      await submitBatch({
        id: `application:${++sequence.current}`,
        base,
        draft: next,
        context: { eventName, day, ...structuredClone(context) },
      });
    },
    [day, eventName, flushDraft, submitBatch, values],
  );
  useEffect(
    () =>
      persistence.bindApplicationSettings({
        read: () => rawRef.current,
        save: async (name, settings) => {
          await request({
            events: [name],
            plan: (snapshot) => {
              if (!snapshot.eventLists[name])
                throw new Error("イベントが見つかりません。");
              snapshot.eventConsistency[name] ??= createEventConsistency();
              snapshot.eventConsistency[name].blockDetectionSettings =
                structuredClone(settings);
              return { snapshot };
            },
          });
        },
      }),
    [persistence, request],
  );
  const choose = useCallback(
    (token: ConfirmationToken, choiceId: string, value: string) => {
      setPendingChoices((count) => count + 1);
      void coordinator
        .choose(token, choiceId, value)
        .then(
          (result) => handleResult(token.operationId, result),
          (error) => fail(token.operationId, error),
        )
        .finally(() => setPendingChoices((count) => count - 1));
    },
    [coordinator, handleResult, fail],
  );
  const confirm = useCallback(
    (token: ConfirmationToken) => {
      void coordinator.confirm(token).then(
        (result) => handleResult(token.operationId, result),
        (error) => fail(token.operationId, error),
      );
    },
    [coordinator, handleResult, fail],
  );
  const cancel = useCallback(
    (token: ConfirmationToken) => {
      coordinator.cancel(token);
      handleResult(token.operationId, { status: "cancelled" });
    },
    [coordinator, handleResult],
  );
  const retryPending = useCallback(() => {
    const ids = [...suspended.current];
    setFailure(null);
    suspended.current.clear();
    setRetryableFailures([]);
    for (const id of ids)
      void coordinator.retry(id).then(
        (result) => handleResult(id, result),
        (error) => fail(id, error),
      );
  }, [coordinator, handleResult, fail]);
  const discardPending = useCallback(() => {
    for (const id of [...suspended.current]) {
      coordinator.discard(id);
      handleResult(id, { status: "cancelled" });
    }
  }, [coordinator, handleResult]);
  const isPending = useCallback(
    () => draft.current !== null || resolvers.current.size > 0,
    [],
  );
  const flush = useCallback(async () => {
    flushDraft();
    await coordinator.enqueue(() => undefined);
    if (suspended.current.size)
      throw new Error("未保存で保留中の操作を再試行または取り消してください。");
    if (isPending()) throw new Error("保存前の確認を完了してください。");
  }, [coordinator, flushDraft, isPending]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!isPending()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [isPending]);
  return {
    raw,
    rawRef,
    previewRef,
    values,
    setters,
    hydrationSetters,
    handlers,
    request,
    commitPatch,
    coordinator,
    flushDraft,
    flush,
    isPending,
    confirmations,
    choose,
    confirm,
    cancel,
    pendingCount,
    isUpdatingChoices: pendingChoices > 0,
    retryableFailures,
    retryPending,
    discardPending,
    requiresReload,
    failure,
    clearFailure: () => setFailure(null),
  };
}
