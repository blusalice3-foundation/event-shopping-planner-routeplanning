import {
  isPersistenceWriteStopReason,
  type PersistenceWriteStopReason,
} from "../ports/PersistenceCommandPort";
import { normalizeSnapshotItemOptionalFields } from "../../utils/itemOptionalFields";
import { recordEntry, setOwnValue } from "../../utils/ownRecord";
import {
  registerItemGuardGenerations,
  inheritItemGuardGenerations,
  requiresItemContentGuard,
} from "../../utils/itemContentGuard";
import {
  semanticEqual,
  jsonEqual,
  reuseEqualReferences,
  reuseEqualItemLists,
} from "../../utils/semanticEquality";
import type {
  ApplicationSnapshotCommitContext,
  ApplicationSnapshotGuard,
} from "../commands/ApplicationSnapshotCommitPort";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
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
  semanticSignature,
  MutationConflictError,
  MutationTargetMissingError,
  CommittedStateApplyError,
  type MutationPlan,
  type MutationChoices,
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
import {
  projectConsistencySnapshot,
  createConsistencySnapshotProjector,
  canReuseProjectedItem,
} from "../../features/consistency/domain/projection";
import { createEventConsistency } from "../../types/consistency";
import {
  validateSnapshotStructure,
  validateSnapshotReferences,
  createAppBackupFile,
} from "../../utils/appBackup";
import type { BlockDetectionSettings } from "../../types/map";
import {
  applyItemContentEdits,
  collectItemContentEdits,
  isMemoOnlyItemContentEdit,
  type ItemContentEdit,
} from "./itemContentEdits";

import {
  planItemContentMutation,
  type UpdateItemFieldsInput,
} from "./itemFieldMutation";

import {
  collectDayMutation,
  dayMutationStores,
} from "../../features/consistency/domain/dayMutation";
import { measureShoppingOperation } from "../../utils/shoppingPerformance";

export const MEMO_SAVE_DELAY_MS = 300;
export const MEMO_SAVE_MAX_WAIT_MS = 1000;

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
function itemContentSignature(lists: PersistenceSnapshot["eventLists"]) {
  return semanticSignature(
    Object.fromEntries(
      Object.entries(lists).map(([event, items]) => [
        event,
        items.map(semanticSignature).sort(),
      ]),
    ),
  );
}
type Batch = {
  id: string;
  context: MutationContext;
  base: PersistenceSnapshot;
  draft: PersistenceSnapshot;
  retainOnConflict?: boolean;
  retryOnFailure?: boolean;
  acceptedBase?: PersistenceSnapshot;
  acceptedDraft?: PersistenceSnapshot;
  itemContentEdits?: readonly ItemContentEdit[];
  acceptedItemContentEdits?: readonly ItemContentEdit[];
  blockedItemOperations?: ReadonlySet<string>;
  assertCurrent?: ApplicationSnapshotGuard;
  inputItemIds?: readonly string[];
};
function changedSnapshotStores(
  base: PersistenceSnapshot,
  snapshot: PersistenceSnapshot,
) {
  return keys.filter((key) => !jsonEqual(base[key], snapshot[key]));
}
function shouldRetainSetterBatch(
  batch: Batch,
  latest: PersistenceSnapshot,
  plan: MutationPlan,
): boolean {
  // These setters accept ordinary user edits. Definitions, membership and
  // route settings remain proposed operations even within one physical store.
  const acceptedKeys: Array<keyof PersistenceSnapshot> = [
    "eventLists",
    "eventMetadata",
    "executeModeItems",
    "dayModes",
    "mapRotationSettings",
    "mapViewportSettings",
  ];
  return (
    !plan.confirmation?.choices?.some((choice) =>
      choice.id.startsWith("dayMerge:"),
    ) &&
    changedSnapshotStores(batch.base, batch.draft).every((key) =>
      acceptedKeys.includes(key),
    ) &&
    changedSnapshotStores(latest, plan.snapshot).length <= 1
  );
}
function planBatch(
  batch: Batch,
  latest: PersistenceSnapshot,
  choices: MutationChoices = {},
): MutationPlan {
  batch.assertCurrent?.(latest);
  if (batch.itemContentEdits)
    return planItemContentMutation(latest, batch.itemContentEdits);
  const projected = projectConsistencySnapshot(
    latest,
    batch.context.eventName,
    batch.context.day,
  );
  const changed: Partial<PersistenceSnapshot> = {};
  const mapStores: Array<keyof PersistenceSnapshot> = [
    "mapData",
    "hallDefinitions",
    "hallRouteSettings",
    "routeSettings",
    "mapRotationSettings",
    "mapViewportSettings",
  ];
  for (const key of keys)
    if (!jsonEqual(batch.base[key], batch.draft[key])) {
      for (const event of new Set([
        ...Object.keys(batch.base[key]),
        ...Object.keys(batch.draft[key]),
      ])) {
        if (
          semanticEqual(
            recordEntry(batch.base[key], event),
            recordEntry(batch.draft[key], event),
          )
        )
          continue;
        if (
          recordEntry(batch.base.eventLists, event) !== undefined &&
          recordEntry(batch.draft.eventLists, event) !== undefined &&
          recordEntry(latest.eventLists, event) === undefined
        )
          throw new MutationTargetMissingError();
        if (mapStores.includes(key)) {
          const old = recordEntry(batch.base[key], event) as
            | Record<string, unknown>
            | undefined;
          const desired = recordEntry(batch.draft[key], event) as
            | Record<string, unknown>
            | undefined;
          for (const mapKey of Object.keys(
            recordEntry(batch.base.mapData, event) ?? {},
          ))
            if (
              desired?.[mapKey] !== undefined &&
              semanticSignature(old?.[mapKey]) !==
                semanticSignature(desired[mapKey]) &&
              recordEntry(latest.mapData, event)?.[mapKey] === undefined
            )
              throw new MutationTargetMissingError();
        }
      }
      Object.assign(changed, {
        [key]: applyChangedFields(
          batch.base[key],
          batch.draft[key],
          projected[key],
          { requireExistingTargets: true },
        ),
      });
    }
  const normalized = normalizeSnapshotItemOptionalFields(
    { ...projected, ...changed },
    projected,
  );
  if (normalized.eventLists !== projected.eventLists)
    changed.eventLists = normalized.eventLists;
  return confirmChangedFieldConflicts(
    planProjectedMutation(
      latest,
      changed,
      batch.context,
      choices,
      projected,
      true,
    ),
    changedFieldConflicts(batch.base, batch.draft, projected),
  );
}
function acceptedBatchEdits(
  batch: Batch,
): readonly ItemContentEdit[] | undefined {
  const edits = batch.acceptedItemContentEdits ?? batch.itemContentEdits;
  return batch.blockedItemOperations?.size
    ? edits?.filter(
        (edit) =>
          !edit.guard ||
          !batch.blockedItemOperations!.has(edit.guard.operationId),
      )
    : edits;
}
function applyAcceptedBatches(
  source: PersistenceSnapshot,
  batches: Batch[],
  retainedIds: ReadonlySet<string>,
): PersistenceSnapshot {
  let snapshot = source;
  for (const batch of batches) {
    if (!retainedIds.has(batch.id)) continue;
    const itemContentEdits = acceptedBatchEdits(batch);
    const previous = snapshot;
    snapshot = planBatch(
      {
        ...batch,
        itemContentEdits,
        base: batch.acceptedBase ?? batch.base,
        draft: batch.acceptedDraft ?? batch.draft,
      },
      snapshot,
    ).snapshot;
    inheritItemGuardGenerations(previous, snapshot);
  }
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
  const projectForDisplay = useMemo(createConsistencySnapshotProjector, []);
  const rawRef = useRef(raw);
  const readGuardGenerations = useRef<() => Readonly<Record<string, number>>>(
    () => ({}),
  );
  const contextRef = useRef<MutationContext>({ eventName, day });
  contextRef.current = { eventName, day };
  const handlers = useRef<{
    drain(): Promise<void>;
    stopWrites?(reason: PersistenceWriteStopReason): void;
    observeSnapshot?(
      snapshot: PersistedStateValues,
      base: PersistedStateValues,
    ): Promise<void>;
    applied(snapshot: PersistedStateValues, events: string[]): void;
  }>({
    drain: async () => {},
    applied: (_snapshot: PersistedStateValues, _events: string[]) => {},
  });
  const writeStopReason = useRef<PersistenceWriteStopReason>();
  const terminalCleanupRef = useRef<
    (reason: PersistenceWriteStopReason) => void
  >(() => {});
  const confirmationWork = useRef(0);
  const pendingMutationListeners = useRef(new Map<string, Set<() => void>>());
  const notifyPendingMutationState = useCallback((id?: string) => {
    if (!pendingMutationListeners.current.size) return;
    const notify = (listener: () => void) => {
      try {
        listener();
      } catch (error) {
        console.error("Mutation pending-state subscriber failed.", error);
      }
    };
    if (id !== undefined) {
      const listeners = pendingMutationListeners.current.get(id);
      if (listeners) for (const listener of listeners) notify(listener);
    } else {
      for (const listeners of pendingMutationListeners.current.values())
        for (const listener of listeners) notify(listener);
    }
  }, []);
  const subscribePendingMutationState = useCallback(
    (id: string, listener: () => void): (() => void) => {
      const listeners = pendingMutationListeners.current.get(id) ?? new Set();
      listeners.add(listener);
      pendingMutationListeners.current.set(id, listeners);
      return () => {
        listeners.delete(listener);
        if (
          !listeners.size &&
          pendingMutationListeners.current.get(id) === listeners
        )
          pendingMutationListeners.current.delete(id);
      };
    },
    [],
  );
  const [requiresReload, setRequiresReload] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingChoices, setPendingChoices] = useState(0);
  const [pendingConfirmations, setPendingConfirmations] = useState(0);
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
  const flushDraftRef = useRef(() => {});
  const submitted = useRef<Batch[]>([]);
  const memoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memoMaxWaitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setItemDraftRevision] = useState(0);
  const previewRef = useRef<PersistenceSnapshot>(raw);
  const suspended = useRef(new Set<string>());
  const retained = useRef(new Set<string>());
  const [retainedOperationIds, setRetainedOperationIds] = useState<string[]>(
    [],
  );
  const [retryableFailures, setRetryableFailures] = useState<string[]>([]);
  const precedingBatches = useCallback((id: string) => {
    const index = submitted.current.findIndex((batch) => batch.id === id);
    return index < 0 ? submitted.current : submitted.current.slice(0, index);
  }, []);
  const itemContentOverlayCache = useRef<{
    source: PersistenceSnapshot;
    edits: readonly (readonly ItemContentEdit[])[];
    generations: Readonly<Record<string, number>>;
    value: PersistenceSnapshot;
  }>();
  const overlayPendingItemContent = useCallback(
    (snapshot: PersistenceSnapshot) => {
      registerItemGuardGenerations(snapshot, readGuardGenerations.current());
      const edits = [
        ...submitted.current,
        ...(draft.current ? [draft.current] : []),
      ]
        .filter(
          (batch) =>
            !retained.current.has(batch.id) && !suspended.current.has(batch.id),
        )
        .flatMap((batch) =>
          acceptedBatchEdits(batch)?.length ? [acceptedBatchEdits(batch)!] : [],
        );
      const cached = itemContentOverlayCache.current;
      if (
        cached?.source === snapshot &&
        cached.generations === readGuardGenerations.current() &&
        cached.edits.length === edits.length &&
        edits.every((edit, index) => edit === cached.edits[index])
      )
        return cached.value;
      const value = applyItemContentEdits(snapshot, edits.flat());
      itemContentOverlayCache.current = {
        source: snapshot,
        edits,
        value,
        generations: readGuardGenerations.current(),
      };
      return value;
    },
    [],
  );
  const readAcceptedSnapshot = useCallback(
    () =>
      overlayPendingItemContent(
        applyAcceptedBatches(
          rawRef.current,
          submitted.current,
          retained.current,
        ),
      ),
    [overlayPendingItemContent],
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
        onPendingStateChanged: notifyPendingMutationState,
        readCurrent: () => rawRef.current,
        readExportCurrent: readAcceptedSnapshot,
        readMutationCurrent: (snapshot, id) =>
          applyAcceptedBatches(
            snapshot,
            precedingBatches(id),
            retained.current,
          ),
        hasPendingAcceptedChanges: (id) =>
          precedingBatches(id).some((batch) => retained.current.has(batch.id)),
        drain: () => handlers.current.drain(),
        readDurable: () => persistence.readApplicationSnapshot(),
        readDayDurable: persistence.readDayApplicationSnapshot,
        commitDaySnapshot: persistence.commitDayApplicationSnapshot,
        commitItemContentEdits: persistence.commitItemContentEdits,
        commitDayMutation: persistence.commitDayMutation,
        createBackupFile: async (base, accepted) => {
          if (!persistence.createBackupFile) {
            if (writeStopReason.current) throw writeStopReason.current;
            return createAppBackupFile(accepted);
          }
          const changes = keys.flatMap((store) => {
            if (base[store] === accepted[store]) return [];
            return [
              ...new Set([
                ...Object.keys(base[store]),
                ...Object.keys(accepted[store]),
              ]),
            ]
              .filter(
                (eventName) =>
                  !semanticEqual(
                    recordEntry(base[store], eventName),
                    recordEntry(accepted[store], eventName),
                  ),
              )
              .map((eventName) => ({
                store,
                eventName,
                baseline: recordEntry(base[store], eventName),
                desired: recordEntry(accepted[store], eventName),
              }));
          });
          const guardedItemEdits = [
            ...submitted.current,
            ...(draft.current ? [draft.current] : []),
          ]
            .flatMap(
              (batch) =>
                batch.acceptedItemContentEdits ?? batch.itemContentEdits ?? [],
            )
            .filter(requiresItemContentGuard);
          return persistence.createBackupFile(
            changes,
            () => (guardedItemEdits.length ? readAcceptedSnapshot() : accepted),
            guardedItemEdits,
          );
        },
        commit: async (snapshot, expectedRoots, base, invalidatedEvents) => {
          const errors = persistence.commitItemContentEdits
            ? []
            : [
                ...validateSnapshotStructure(snapshot),
                ...validateSnapshotReferences(snapshot),
              ];
          if (errors.length) throw new Error(errors.join("\n"));
          const changedStores = changedSnapshotStores(base, snapshot);
          // Decide after reference repair: saved visit lists/routes make an
          // execution reorder a multi-store mutation, even with one setter.
          if (
            !invalidatedEvents?.length &&
            changedStores.length === 1 &&
            (changedStores[0] === "executeModeItems" ||
              (changedStores[0] === "eventLists" &&
                itemContentSignature(base.eventLists) ===
                  itemContentSignature(snapshot.eventLists))) &&
            handlers.current.observeSnapshot
          ) {
            await handlers.current.observeSnapshot(
              snapshot as unknown as PersistedStateValues,
              base as unknown as PersistedStateValues,
            );
            // Other stores may have changed in another tab during debounce.
            // Adopt their latest durable values without writing them back.
            try {
              Object.assign(
                snapshot,
                (await persistence.readApplicationSnapshot()).snapshot,
              );
            } catch (error) {
              throw new CommittedStateApplyError(error);
            }
          } else
            await persistence.commitApplicationSnapshotAtomically(snapshot, {
              expectedRoots,
              changedStoresOnly: true,
              ...(invalidatedEvents?.length ? { invalidatedEvents } : {}),
            });
        },
        apply: (snapshot, events) => {
          rawRef.current = reuseEqualReferences(
            rawRef.current,
            snapshot as unknown as PersistedStateValues,
          );
          registerItemGuardGenerations(
            rawRef.current,
            readGuardGenerations.current(),
          );
          persistence.adoptCommittedSnapshot?.(rawRef.current);
          setRaw(rawRef.current);
          handlers.current.applied(rawRef.current, events);
        },
        onApplyFailure: (error) => {
          if (writeStopReason.current) return;
          writeStopReason.current = error;
          // Register every writer before React can render or any request is cleaned up.
          persistence.stopWrites?.(error);
          handlers.current.stopWrites?.(error);
          setRequiresReload(true);
          setFailure(error.message);
          terminalCleanupRef.current(error);
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
    [
      persistence,
      precedingBatches,
      readAcceptedSnapshot,
      releasePending,
      notifyPendingMutationState,
    ],
  );
  readGuardGenerations.current = coordinator.durableEventGenerations;
  registerItemGuardGenerations(rawRef.current, readGuardGenerations.current());
  renderedGenerations.current = Object.fromEntries(
    [
      ...Object.keys(renderedGenerations.current),
      ...Object.keys(raw.eventLists),
      ...(eventName ? [eventName] : []),
    ].map((name) => [name, coordinator.generation(name)]),
  );
  const previewInputs = useRef<{
    raw: PersistenceSnapshot;
    eventName: string | null;
    day: string;
  }>();
  const rebuildPreview = useCallback(
    (force = true) => {
      const context = contextRef.current;
      if (
        !force &&
        previewInputs.current?.raw === rawRef.current &&
        previewInputs.current.eventName === context.eventName &&
        previewInputs.current.day === context.day
      )
        return;
      let next = projectForDisplay(
        rawRef.current,
        contextRef.current.eventName,
        contextRef.current.day,
      );
      for (const batch of [
        ...submitted.current,
        ...(draft.current ? [draft.current] : []),
      ]) {
        if (suspended.current.has(batch.id) && !retained.current.has(batch.id))
          continue;
        next = batch.itemContentEdits
          ? applyItemContentEdits(next, acceptedBatchEdits(batch) ?? [])
          : (applyChangedFields(
              batch.acceptedBase ?? batch.base,
              batch.acceptedDraft ?? batch.draft,
              next,
            ) as PersistenceSnapshot);
      }
      previewRef.current = next;
      previewInputs.current = { raw: rawRef.current, ...context };
    },
    [projectForDisplay],
  );
  // Do not replace a synchronously accepted draft with an older render.
  rebuildPreview(false);
  const handleResult = useCallback(
    (id: string, result: MutationResult) => {
      if (!resolvers.current.has(id)) return;
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
            if (earlier.itemContentEdits && committed.itemContentEdits) {
              earlier.acceptedItemContentEdits = (
                earlier.acceptedItemContentEdits ?? earlier.itemContentEdits
              ).flatMap((edit) => {
                const overwritten = new Set(
                  committed
                    .itemContentEdits!.filter(
                      (next) =>
                        next.eventName === edit.eventName &&
                        next.itemId === edit.itemId,
                    )
                    .flatMap((next) => Object.keys(next.fields)),
                );
                const fields = Object.fromEntries(
                  Object.entries(edit.fields).filter(
                    ([key]) => !overwritten.has(key),
                  ),
                );
                const limitedPurchase = [
                  "quantity",
                  "purchaseStatus",
                  "limitedPurchasedQuantity",
                ].some((key) => overwritten.has(key))
                  ? undefined
                  : edit.limitedPurchase;
                return Object.keys(fields).length || limitedPurchase
                  ? [{ ...edit, fields, limitedPurchase }]
                  : [];
              });
            }
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
  terminalCleanupRef.current = (reason) => {
    if (memoSaveTimer.current !== null) clearTimeout(memoSaveTimer.current);
    if (memoMaxWaitTimer.current !== null)
      clearTimeout(memoMaxWaitTimer.current);
    memoSaveTimer.current = null;
    memoMaxWaitTimer.current = null;
    const batches = [
      ...submitted.current,
      ...(draft.current ? [draft.current] : []),
    ];
    draft.current = null;
    submitted.current = batches.filter((batch) => {
      if (batch.retryOnFailure && batch.retainOnConflict === undefined) {
        try {
          batch.retainOnConflict = shouldRetainSetterBatch(
            batch,
            rawRef.current,
            planBatch(batch, rawRef.current),
          );
        } catch {
          batch.retainOnConflict = false;
        }
      }
      const accepted = !!batch.itemContentEdits || !!batch.retainOnConflict;
      if (accepted) retained.current.add(batch.id);
      else retained.current.delete(batch.id);
      return accepted;
    });
    suspended.current.clear();
    for (const resolver of resolvers.current.values()) resolver.reject(reason);
    resolvers.current.clear();
    setConfirmations([]);
    setPendingCount(0);
    setPendingChoices(0);
    setPendingConfirmations(0);
    setRetryableFailures([]);
    setRetainedOperationIds([...retained.current]);
    rebuildPreview();
    setItemDraftRevision((revision) => revision + 1);
  };
  const stopWrites = useCallback(
    (reason: PersistenceWriteStopReason) => {
      coordinator.stopWrites(reason);
    },
    [coordinator],
  );
  useEffect(() => {
    const release = persistence.onWritesStopped?.(stopWrites);
    const reason = persistence.getWriteStopReason?.();
    if (reason) stopWrites(reason);
    return release;
  }, [persistence, stopWrites]);
  const fail = useCallback(
    (id: string, error: unknown) => {
      if (isPersistenceWriteStopReason(error)) {
        stopWrites(error);
        return;
      }
      if (!resolvers.current.has(id)) return;
      const batch = submitted.current.find((entry) => entry.id === id);
      if (batch?.retryOnFailure && batch.retainOnConflict === undefined) {
        // A failed drain can precede planning. Preserve accepted single-store
        // edits, but keep a related operation's proposed values out of exports.
        try {
          batch.retainOnConflict = shouldRetainSetterBatch(
            batch,
            rawRef.current,
            planBatch(batch, rawRef.current),
          );
        } catch {
          batch.retainOnConflict = false;
        }
      }
      if (
        error instanceof MutationConflictError ||
        ((batch?.retainOnConflict || batch?.retryOnFailure) &&
          !(error instanceof MutationCancelledError) &&
          !(error instanceof MutationTargetMissingError) &&
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
    [coordinator, rebuildPreview, releasePending, stopWrites],
  );
  const request = useCallback(
    (
      intent: Omit<MutationIntent, "id"> & { id?: string },
    ): Promise<PersistenceSnapshot> => {
      if (writeStopReason.current)
        return Promise.reject(writeStopReason.current);
      // A setter accepted in this turn must enter the queue before this command.
      flushDraftRef.current();
      const id = intent.id ?? `application:${++sequence.current}`;
      const acceptedContext = { ...contextRef.current };
      const finishSave = measureShoppingOperation("item-command", "save");
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
            if (
              base &&
              !plan.confirmation?.choices?.some((choice) =>
                choice.id.startsWith("dayMerge:"),
              ) &&
              !submitted.current.some((batch) => batch.id === id)
            ) {
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
                recordEntry(renderedGenerations.current, name) ?? 0,
              ]),
            ),
        })
        .then(
          (result) => {
            if (result.status === "committed") finishSave();
            handleResult(id, result);
          },
          (error) => fail(id, error),
        );
      return result;
    },
    [coordinator, handleResult, fail, rebuildPreview],
  );
  const submitBatch = useCallback(
    (batch: Batch) => {
      if (batch.itemContentEdits) batch.retainOnConflict = true;
      submitted.current.push(batch);
      const events = batch.itemContentEdits
        ? [...new Set(batch.itemContentEdits.map((edit) => edit.eventName))]
        : [
            ...new Set(
              keys.flatMap((key) => [
                ...Object.keys(batch.base[key]),
                ...Object.keys(batch.draft[key]),
              ]),
            ),
          ].filter((name) =>
            keys.some(
              (key) =>
                !jsonEqual(
                  recordEntry(batch.base[key], name),
                  recordEntry(batch.draft[key], name),
                ),
            ),
          );
      return request({
        id: batch.id,
        events,
        itemContentEdits: batch.itemContentEdits,
        // Snapshot guards must run in the planner, including on CAS retries.
        dayMutation: batch.assertCurrent
          ? undefined
          : collectDayMutation(
              batch.base,
              batch.draft,
              batch.context.eventName,
              batch.context.day,
              batch.context.routeDays,
            ),
        plan: (latest, choices) => {
          const plan = planBatch(batch, latest, choices);
          if (batch.itemContentEdits) {
            const blocked = new Set(
              plan.invalidItemContentEdits?.flatMap((edit) =>
                edit.guard ? [edit.guard.operationId] : [],
              ),
            );
            if (
              JSON.stringify([...(batch.blockedItemOperations ?? [])]) !==
              JSON.stringify([...blocked])
            ) {
              batch.blockedItemOperations = blocked;
              rebuildPreview();
              setItemDraftRevision((revision) => revision + 1);
            }
          }
          // Reference repair can turn one setter into a multi-store operation.
          // Only standalone setter edits are accepted before a successful save.
          if (batch.retryOnFailure && !batch.itemContentEdits)
            batch.retainOnConflict = shouldRetainSetterBatch(
              batch,
              latest,
              plan,
            );
          return plan;
        },
      });
    },
    [request, rebuildPreview],
  );
  const flushDraft = useCallback(() => {
    if (writeStopReason.current) return;
    if (memoSaveTimer.current !== null) clearTimeout(memoSaveTimer.current);
    if (memoMaxWaitTimer.current !== null)
      clearTimeout(memoMaxWaitTimer.current);
    memoSaveTimer.current = null;
    memoMaxWaitTimer.current = null;
    const batch = draft.current;
    if (!batch) return;
    draft.current = null;
    void submitBatch(batch).catch(() => {});
  }, [submitBatch]);
  flushDraftRef.current = flushDraft;
  const setters = useMemo(
    () =>
      Object.fromEntries(
        keys.map((key) => [
          `set${key[0].toUpperCase()}${key.slice(1)}`,
          (action: SetStateAction<PersistedStateValues[typeof key]>) => {
            if (writeStopReason.current) return;
            const previous = (draft.current?.draft ?? previewRef.current)[key];
            // React state updaters are immutable. Preserve all untouched date branches
            // for day commands instead of cloning historical visits and route settings.
            const current = (dayMutationStores as readonly string[]).includes(
              key,
            )
              ? previous
              : structuredClone(previous);
            const next =
              typeof action === "function"
                ? (action as (value: typeof current) => typeof current)(current)
                : action;
            // Submit accepted memo input before combining it with a structural proposal.
            if (
              draft.current &&
              isMemoOnlyItemContentEdit(draft.current.itemContentEdits) &&
              collectItemContentEdits(draft.current.base, {
                ...draft.current.draft,
                [key]: next,
              }) === undefined
            ) {
              flushDraft();
            }
            if (!draft.current) {
              const base = previewRef.current;
              draft.current = {
                id: `application:${++sequence.current}`,
                context: { ...contextRef.current },
                base,
                draft: { ...base },
                retryOnFailure: true,
              };
            }

            Object.assign(draft.current.draft, { [key]: next });
            draft.current.itemContentEdits = collectItemContentEdits(
              draft.current.base,
              draft.current.draft,
            );
            rebuildPreview();
            if (isMemoOnlyItemContentEdit(draft.current.itemContentEdits)) {
              // Keep the input urgent while the shared list catches up.
              startTransition(() =>
                setItemDraftRevision((revision) => revision + 1),
              );
              if (memoSaveTimer.current !== null)
                clearTimeout(memoSaveTimer.current);
              memoSaveTimer.current = setTimeout(
                flushDraft,
                MEMO_SAVE_DELAY_MS,
              );
              memoMaxWaitTimer.current ??= setTimeout(
                flushDraft,
                MEMO_SAVE_MAX_WAIT_MS,
              );
            } else {
              queueMicrotask(flushDraft);
            }
            return next;
          },
        ]),
      ) as unknown as PersistedStateSetters,
    [flushDraft, rebuildPreview],
  );
  const updateItemFields = useCallback(
    (
      inputOrInputs: UpdateItemFieldsInput | readonly UpdateItemFieldsInput[],
    ) => {
      if (writeStopReason.current) return;
      const finishInput = measureShoppingOperation("item-command");
      const inputs: readonly UpdateItemFieldsInput[] = Array.isArray(
        inputOrInputs,
      )
        ? inputOrInputs
        : [inputOrInputs as UpdateItemFieldsInput];
      if (draft.current && !draft.current.itemContentEdits) flushDraft();
      const source = previewRef.current;
      registerItemGuardGenerations(source, readGuardGenerations.current());
      const proposedEdits: ItemContentEdit[] = inputs.flatMap((input) => {
        const fields = Object.fromEntries(
          Object.entries(input.changes).map(([key, value]) => [
            key,
            { present: value !== undefined, value },
          ]),
        );
        return Object.keys(fields).length || input.limitedPurchase
          ? [
              {
                eventName: input.eventName,
                itemId: input.itemId,
                fields,
                limitedPurchase: input.limitedPurchase,
                baseline: input.baseline as unknown as Record<string, unknown>,
                ...(input.guard || input.limitedPurchase
                  ? {
                      guard: input.guard,
                      operationKind: "limited-input" as const,
                    }
                  : {}),
              },
            ]
          : [];
      });
      if (!proposedEdits.length) {
        if (inputs.some((input) => input.saveImmediately)) flushDraft();
        finishInput();
        return;
      }
      const accepted = planItemContentMutation(source, proposedEdits);
      const next = accepted.snapshot;
      if (
        next === source &&
        !proposedEdits.some((edit) => edit.limitedPurchase)
      ) {
        if (inputs.some((input) => input.saveImmediately)) flushDraft();
        finishInput();
        return;
      }
      if (!draft.current) {
        draft.current = {
          id: `application:${++sequence.current}`,
          context: { ...contextRef.current },
          base: source,
          draft: next,
          retryOnFailure: true,
          itemContentEdits: [],
          inputItemIds: [],
        };
      }
      const mergedEdits = [...(draft.current.itemContentEdits ?? [])];
      for (const edit of accepted.itemContentEdits) {
        const previous = mergedEdits.at(-1);
        // Merge only adjacent operations. Moving an earlier field edit across a
        // guarded edit can reverse the user's final choice for the same item.
        if (
          previous &&
          !previous.limitedPurchase &&
          !edit.limitedPurchase &&
          previous.eventName === edit.eventName &&
          previous.itemId === edit.itemId &&
          JSON.stringify(previous.guard ?? null) ===
            JSON.stringify(edit.guard ?? null)
        ) {
          mergedEdits[mergedEdits.length - 1] = {
            ...edit,
            baseline: Object.fromEntries(
              [
                ...new Set([
                  ...Object.keys(previous.fields),
                  ...Object.keys(edit.fields),
                ]),
              ].map((field) => [
                field,
                Object.prototype.hasOwnProperty.call(previous.fields, field)
                  ? previous.baseline?.[field]
                  : edit.baseline?.[field],
              ]),
            ),
            fields: { ...previous.fields, ...edit.fields },
          };
        } else mergedEdits.push(edit);
      }
      draft.current.inputItemIds = [
        ...new Set([
          ...(draft.current.inputItemIds ?? []),
          ...inputs.map((input) => input.itemId),
        ]),
      ];
      draft.current.draft = next;
      draft.current.itemContentEdits = mergedEdits;
      previewRef.current = next;
      if (inputs.some((input) => input.saveImmediately)) {
        setItemDraftRevision((revision) => revision + 1);
        flushDraft();
      } else if (isMemoOnlyItemContentEdit(draft.current.itemContentEdits)) {
        startTransition(() => setItemDraftRevision((revision) => revision + 1));
        if (memoSaveTimer.current !== null) clearTimeout(memoSaveTimer.current);
        memoSaveTimer.current = setTimeout(flushDraft, MEMO_SAVE_DELAY_MS);
        memoMaxWaitTimer.current ??= setTimeout(
          flushDraft,
          MEMO_SAVE_MAX_WAIT_MS,
        );
      } else {
        setItemDraftRevision((revision) => revision + 1);
        queueMicrotask(flushDraft);
      }
      finishInput();
    },
    [flushDraft],
  );
  const hydrationSetters = useMemo(
    () =>
      Object.fromEntries(
        keys.map((key) => [
          `set${key[0].toUpperCase()}${key.slice(1)}`,
          (action: SetStateAction<PersistedStateValues[typeof key]>) => {
            if (writeStopReason.current) return;
            const current = rawRef.current[key];
            const value =
              typeof action === "function"
                ? (action as (value: typeof current) => typeof current)(current)
                : action;
            rawRef.current = { ...rawRef.current, [key]: value };
            registerItemGuardGenerations(
              rawRef.current,
              readGuardGenerations.current(),
            );
            persistence.adoptCommittedSnapshot?.(rawRef.current);
            setRaw(rawRef.current);
            rebuildPreview();
          },
        ]),
      ) as unknown as PersistedStateSetters,
    [rebuildPreview, persistence],
  );
  const retainedSnapshot = useMemo(
    () =>
      applyAcceptedBatches(
        raw,
        submitted.current,
        new Set(retainedOperationIds),
      ),
    [raw, retainedOperationIds],
  );
  const displayRef = useRef<PersistedStateValues>();
  const projectedValues = projectForDisplay(
    overlayPendingItemContent(retainedSnapshot),
    eventName,
    day,
  ) as unknown as PersistedStateValues;
  // Save acknowledgements carry cloned durable objects. Keep accepted item
  // references when their content is identical; foreign changes still replace them.
  const values = useMemo(
    () =>
      displayRef.current
        ? {
            ...projectedValues,
            eventLists: reuseEqualItemLists(
              displayRef.current.eventLists,
              projectedValues.eventLists,
              canReuseProjectedItem,
            ),
          }
        : projectedValues,
    [projectedValues],
  );
  displayRef.current = values;
  const commitPatch = useCallback(
    async (
      patch: Partial<PersistenceSnapshot>,
      settings?: { eventName: string; settings: BlockDetectionSettings | null },
      context?: ApplicationSnapshotCommitContext,
      assertCurrent?: ApplicationSnapshotGuard,
    ) => {
      flushDraft();
      // The submitted patch was computed from this render, not the pending preview.
      // Capture only its changes; queued plans apply them to the latest snapshot.
      const base = values;
      const next = { ...base, ...patch };
      if (settings) {
        next.eventConsistency = structuredClone(next.eventConsistency);
        if (!recordEntry(next.eventConsistency, settings.eventName))
          setOwnValue(
            next.eventConsistency,
            settings.eventName,
            createEventConsistency(),
          );
        recordEntry(
          next.eventConsistency,
          settings.eventName,
        ).blockDetectionSettings = settings.settings;
      }
      await submitBatch({
        id: `application:${++sequence.current}`,
        base,
        draft: next,
        context: { eventName, day, ...structuredClone(context) },
        assertCurrent,
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
              if (!recordEntry(snapshot.eventLists, name))
                throw new Error("イベントが見つかりません。");
              if (!recordEntry(snapshot.eventConsistency, name))
                setOwnValue(
                  snapshot.eventConsistency,
                  name,
                  createEventConsistency(),
                );
              recordEntry(
                snapshot.eventConsistency,
                name,
              ).blockDetectionSettings = structuredClone(settings);
              return { snapshot };
            },
          });
        },
      }),
    [persistence, request],
  );
  const choose = useCallback(
    (token: ConfirmationToken, choiceId: string, value: string) => {
      if (writeStopReason.current) return;
      confirmationWork.current++;
      notifyPendingMutationState();
      setPendingChoices((count) => count + 1);
      void coordinator
        .choose(token, choiceId, value)
        .then(
          (result) => handleResult(token.operationId, result),
          (error) => fail(token.operationId, error),
        )
        .finally(() => {
          confirmationWork.current--;
          notifyPendingMutationState();
          setPendingChoices((count) => Math.max(0, count - 1));
        });
    },
    [coordinator, handleResult, fail, notifyPendingMutationState],
  );
  const confirm = useCallback(
    (token: ConfirmationToken) => {
      if (writeStopReason.current) return;
      confirmationWork.current++;
      notifyPendingMutationState();
      setPendingConfirmations((count) => count + 1);
      void coordinator
        .confirm(token)
        .then(
          (result) => handleResult(token.operationId, result),
          (error) => fail(token.operationId, error),
        )
        .finally(() => {
          confirmationWork.current--;
          notifyPendingMutationState();
          setPendingConfirmations((count) => Math.max(0, count - 1));
        });
    },
    [coordinator, handleResult, fail, notifyPendingMutationState],
  );
  const cancel = useCallback(
    (token: ConfirmationToken) => {
      if (coordinator.cancel(token))
        handleResult(token.operationId, { status: "cancelled" });
    },
    [coordinator, handleResult],
  );
  const getPendingMutationState = useCallback(
    (id: string) => {
      const state = coordinator.getPendingState(id);
      const requestPending = resolvers.current.has(id) && state.requestPending;
      return {
        requestPending,
        confirmationPending: state.confirmationPending,
        canCancel:
          requestPending &&
          state.canCancel &&
          confirmationWork.current === 0 &&
          !writeStopReason.current,
      };
    },
    [coordinator],
  );
  const cancelPendingMutation = useCallback(
    (id: string): boolean => {
      if (!getPendingMutationState(id).canCancel || !coordinator.discard(id))
        return false;
      handleResult(id, { status: "cancelled" });
      return true;
    },
    [coordinator, getPendingMutationState, handleResult],
  );
  const retryPending = useCallback(() => {
    if (writeStopReason.current) return;
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
      if (coordinator.discard(id)) handleResult(id, { status: "cancelled" });
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
    const flushMemo = () => {
      if (memoSaveTimer.current !== null) flushDraft();
    };
    const visibilityChange = () => {
      if (document.visibilityState === "hidden") flushMemo();
    };
    document.addEventListener("focusout", flushMemo);
    document.addEventListener("visibilitychange", visibilityChange);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      document.removeEventListener("focusout", flushMemo);
      document.removeEventListener("visibilitychange", visibilityChange);
      window.removeEventListener("beforeunload", beforeUnload);
      if (memoSaveTimer.current !== null) clearTimeout(memoSaveTimer.current);
      if (memoMaxWaitTimer.current !== null)
        clearTimeout(memoMaxWaitTimer.current);
    };
  }, [isPending, flushDraft]);
  return {
    raw,
    rawRef,
    previewRef,
    values,
    setters,
    updateItemFields,
    pendingItemIds: [
      ...new Set(
        [
          ...submitted.current,
          ...(draft.current ? [draft.current] : []),
        ].flatMap(
          (batch) =>
            batch.inputItemIds?.filter((id) =>
              batch.itemContentEdits?.some(
                (edit) => edit.itemId === id && edit.eventName === eventName,
              ),
            ) ?? [],
        ),
      ),
    ],
    hydrationSetters,
    handlers,
    request,
    commitPatch,
    coordinator,
    stopWrites,
    getWriteStopReason: () => writeStopReason.current,
    cancelPendingMutation,
    getPendingMutationState,
    subscribePendingMutationState,
    flushDraft,
    flush,
    isPending,
    confirmations,
    choose,
    confirm,
    cancel,
    pendingCount: pendingCount + (draft.current ? 1 : 0),
    isUpdatingChoices: pendingChoices > 0,
    isConfirmationBusy: pendingChoices > 0 || pendingConfirmations > 0,
    retryableFailures,
    retryPending,
    discardPending,
    requiresReload,
    failure,
    clearFailure: () => setFailure(null),
  };
}
