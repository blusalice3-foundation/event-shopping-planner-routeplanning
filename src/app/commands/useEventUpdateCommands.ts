import type {
  ApplicationSnapshotCommitContext,
  ApplicationSnapshotGuard,
} from "./ApplicationSnapshotCommitPort";
import { bulkImportFailureStatus } from "../../utils/importOutcome";
import { recordEntry } from "../../utils/ownRecord";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { BulkImportResult } from "../../types/import";
import type {
  EventMetadata,
  ExecuteModeItems,
  ShoppingItem,
} from "../../types/item";
import type { BulkAddMetadata } from "../../features/events/bulkAdd";
import type {
  DuplicateEventResolution,
  ImportedShoppingItem,
} from "../../features/events/duplicateEvent";
import type { EventUpdateApplyOptions } from "../../features/events/updateApply";
import {
  applyPendingEventUpdate,
  eventUpdateItemsMatch,
  eventUpdateSourceMatches,
  EventUpdateInvalidatedError,
  buildEventUpdateDiffFromSpreadsheet,
  resolveSpreadsheetSource,
  type EventUpdateCommitState,
  type PendingEventUpdate,
  type SpreadsheetSource,
} from "../../features/events/updateFlow";
import type { PendingDuplicateEventImport } from "../state/appOverlayTypes";
import type { AppOverlayOpenReceipt } from "../state/useAppOverlayController";
import {
  createEventUpdateOperationRegistry,
  type EventUpdateOperation,
  type EventUpdateUrlDraft,
  type EventUpdateOperationRegistry,
} from "./eventUpdateOperation";

export interface MutableEventUpdateValue<T> {
  current: T;
}

export interface EventUpdateStatePort {
  readonly eventLists: Record<string, ShoppingItem[]>;
  readonly getEventGeneration?: (eventName: string) => number;
  readonly eventMetadata: Record<string, EventMetadata>;
  readonly pendingDuplicateEvent: PendingDuplicateEventImport | null;
  readonly pendingEventUpdate: PendingEventUpdate | null;
  readonly pendingUpdateEventName: string | null;
  readonly eventUpdateOperationsRef?: MutableEventUpdateValue<EventUpdateOperationRegistry>;
  readonly eventListsRef: MutableEventUpdateValue<
    Record<string, ShoppingItem[]>
  >;
  readonly eventMetadataRef: MutableEventUpdateValue<
    Record<string, EventMetadata>
  >;
  readonly executeModeItemsRef: MutableEventUpdateValue<
    Record<string, ExecuteModeItems>
  >;
  readonly pendingEventUpdateBaseItemsRef: MutableEventUpdateValue<
    ShoppingItem[] | null
  >;
  readonly eventUpdatePreviewEpochRef: MutableEventUpdateValue<number>;
}

type OpenReceiptCallback = (receipt: AppOverlayOpenReceipt) => void;
export interface EventUpdateActionPort {
  applyBulkAdd(
    eventName: string,
    items: ImportedShoppingItem[],
    metadata?: BulkAddMetadata,
  ): Promise<BulkImportResult>;
  commitEventUpdateState(
    state: EventUpdateCommitState,
    assertCurrent: ApplicationSnapshotGuard,
    context: ApplicationSnapshotCommitContext,
  ): Promise<boolean>;
  openEventUpdate(
    pending: PendingEventUpdate,
    onReceipt?: OpenReceiptCallback,
  ): string | void;
  openUrlUpdate(
    eventName: string,
    onReceipt?: OpenReceiptCallback,
  ): string | void;
  closeEventOverlay(requestId?: string): void;
  confirmEventOverlay(requestId?: string): void;
}

export interface EventUpdateEffectPort {
  notify(message: string): void;
  reportError(message: string): void;
}

export interface EventUpdateCommandPorts {
  readonly state: EventUpdateStatePort;
  readonly actions: EventUpdateActionPort;
  readonly effects: EventUpdateEffectPort;
}

export interface EventUpdateCommands {
  readonly isEventUpdateSaving: boolean;
  readonly currentUpdateOperationId: string | undefined;
  readonly currentUpdateUrlDraft: EventUpdateUrlDraft | undefined;
  finishUpdateOperation(
    updateOperationId: string,
    result: BulkImportResult,
  ): void;
  invalidateEventUpdateForEvent(eventName: string): void;
  handleUpdateEvent(eventName: string): Promise<void>;
  handleDuplicateEventResolution(
    resolution: DuplicateEventResolution,
  ): Promise<void>;
  handleDuplicateEventCancel(expectedOperationId?: string): boolean;
  handleCancelUpdate(expectedOperationId?: string): boolean;
  handleUrlUpdateCancel(expectedOperationId?: string): boolean;
  handleConfirmUpdate(options: EventUpdateApplyOptions): Promise<void>;
  handleUrlUpdate(
    newUrl: string,
    sheetName: string,
    expectedOperationId?: string,
  ): Promise<void>;
}

const savingNotice =
  "アイテム更新を保存中です。保留中の保存を再試行または取り消してから、次の更新を開始してください。";
const pendingSaveNotice =
  "先行する未保存の操作を再試行または取り消してから、この確認画面でもう一度更新してください。";

export const useEventUpdateCommands = ({
  state,
  actions,
  effects,
}: EventUpdateCommandPorts): EventUpdateCommands => {
  const {
    getEventGeneration,
    pendingDuplicateEvent,
    pendingEventUpdate,
    pendingUpdateEventName,
    eventListsRef,
    eventMetadataRef,
    executeModeItemsRef,
    pendingEventUpdateBaseItemsRef,
    eventUpdatePreviewEpochRef,
  } = state;
  const {
    applyBulkAdd,
    commitEventUpdateState,
    openEventUpdate,
    openUrlUpdate,
    closeEventOverlay,
    confirmEventOverlay,
  } = actions;
  const { notify, reportError } = effects;
  const localRegistry = useRef<EventUpdateOperationRegistry | null>(null);
  if (!localRegistry.current)
    localRegistry.current = createEventUpdateOperationRegistry();
  const registry =
    state.eventUpdateOperationsRef?.current ?? localRegistry.current;
  const isEventUpdateSaving = useSyncExternalStore(
    registry.subscribe,
    registry.isSaving,
    registry.isSaving,
  );

  const currentUpdateOperationId = useSyncExternalStore(
    registry.subscribe,
    () => registry.current?.id,
    () => undefined,
  );

  const currentUpdateUrlDraft = useSyncExternalStore(
    registry.subscribe,
    () => registry.current?.urlDraft,
    () => undefined,
  );

  registry.onFinish = (operation, result) => {
    eventUpdatePreviewEpochRef.current += 1;
    pendingEventUpdateBaseItemsRef.current = null;
    if (!operation.requestId && !operation.ownsUntrackedOverlay) return;
    if (result.status === "saved") confirmEventOverlay(operation.requestId);
    else closeEventOverlay(operation.requestId);
  };
  const finishUpdateOperation = useCallback(
    (id: string, result: BulkImportResult) => registry.finish(id, result),
    [registry],
  );
  useEffect(
    () => () => {
      const operation = registry.current;
      if (operation && operation.phase !== "saving")
        registry.finish(operation.id, { status: "invalidated" });
    },
    [registry],
  );

  const owns = useCallback(
    (operation: EventUpdateOperation) =>
      registry.current === operation && operation.phase !== "finished",
    [registry],
  );
  const inputIsCurrent = useCallback(
    (operation: EventUpdateOperation) =>
      owns(operation) &&
      operation.isCurrentInput?.() !== false &&
      (operation.eventGeneration === undefined ||
        operation.eventGeneration ===
          getEventGeneration?.(operation.eventName)),
    [getEventGeneration, owns],
  );
  const invalidateEventUpdateForEvent = useCallback(
    (eventName: string) => {
      const operation = registry.current;
      // A committed save applies its own source changes before its Promise resolves.
      if (operation?.eventName === eventName && operation.phase !== "saving")
        finishUpdateOperation(operation.id, { status: "invalidated" });
    },
    [finishUpdateOperation, registry],
  );

  const startOperation = useCallback(
    (
      eventName: string,
      complete?: (result: BulkImportResult) => void,
      isCurrentInput?: () => boolean,
      eventGeneration?: number,
    ) => {
      const operation = registry.start({
        eventName,
        complete,
        isCurrentInput,
        eventGeneration: eventGeneration ?? getEventGeneration?.(eventName),
      });
      if (!operation) notify(savingNotice);
      return operation;
    },
    [getEventGeneration, notify, registry],
  );

  const receiptFor = useCallback(
    (
      operation: EventUpdateOperation,
      generation: number,
      phase: "url" | "confirmation",
    ): OpenReceiptCallback =>
      (receipt) => {
        if (
          !owns(operation) ||
          operation.acquisitionGeneration !== generation ||
          operation.phase !== phase ||
          operation.requestId !== receipt.requestId
        )
          return;
        if (!inputIsCurrent(operation) || !receipt.accepted)
          finishUpdateOperation(operation.id, { status: "invalidated" });
      },
    [finishUpdateOperation, inputIsCurrent, owns],
  );

  const showUrl = useCallback(
    (operation: EventUpdateOperation) => {
      if (!inputIsCurrent(operation)) {
        finishUpdateOperation(operation.id, { status: "invalidated" });
        return;
      }
      registry.changePhase(operation, "url");
      operation.requestId =
        openUrlUpdate(
          operation.eventName,
          receiptFor(operation, operation.acquisitionGeneration, "url"),
        ) || undefined;
      operation.ownsUntrackedOverlay = !operation.requestId;
    },
    [
      finishUpdateOperation,
      inputIsCurrent,
      openUrlUpdate,
      receiptFor,
      registry,
    ],
  );

  const previewEventUpdate = useCallback(
    async (
      operation: EventUpdateOperation,
      kind: PendingEventUpdate["kind"],
      source: SpreadsheetSource,
      retryUrl: boolean,
    ): Promise<void> => {
      if (!inputIsCurrent(operation)) {
        finishUpdateOperation(operation.id, { status: "invalidated" });
        return;
      }
      if (operation.requestId) closeEventOverlay(operation.requestId);
      else if (operation.ownsUntrackedOverlay) closeEventOverlay();
      operation.requestId = undefined;
      operation.ownsUntrackedOverlay = false;
      registry.changePhase(operation, "loading");
      operation.acquisitionGeneration += 1;
      const generation = operation.acquisitionGeneration;
      const requestEpoch = ++eventUpdatePreviewEpochRef.current;
      pendingEventUpdateBaseItemsRef.current = null;
      const latestItems = recordEntry(
        eventListsRef.current,
        operation.eventName,
      );
      if (!latestItems) {
        finishUpdateOperation(operation.id, { status: "invalidated" });
        return;
      }
      const currentItems = structuredClone(latestItems);
      const baseSource = resolveSpreadsheetSource(
        recordEntry(eventMetadataRef.current, operation.eventName),
      );
      operation.baseItems = currentItems;
      operation.baseSource = baseSource;
      const stillAcquiring = () =>
        owns(operation) &&
        operation.acquisitionGeneration === generation &&
        operation.phase === "loading";
      const isCurrentRequest = () =>
        stillAcquiring() &&
        inputIsCurrent(operation) &&
        eventUpdatePreviewEpochRef.current === requestEpoch &&
        eventUpdateSourceMatches(
          recordEntry(eventMetadataRef.current, operation.eventName),
          baseSource,
        ) &&
        eventUpdateItemsMatch(
          recordEntry(eventListsRef.current, operation.eventName),
          currentItems,
        );
      try {
        const updateDiff = await buildEventUpdateDiffFromSpreadsheet(
          currentItems,
          source,
        );
        // A late response never completes a newer acquisition or a replacement owner.
        if (!stillAcquiring()) return;
        if (!isCurrentRequest()) {
          finishUpdateOperation(operation.id, { status: "invalidated" });
          return;
        }
        const common = {
          eventName: operation.eventName,
          diff: updateDiff,
          baseSource,
          updateOperationId: operation.id,
          reviewedSource: source,
          ...(operation.eventGeneration === undefined
            ? {}
            : { eventGeneration: operation.eventGeneration }),
          ...(operation.complete
            ? { onImportComplete: operation.complete }
            : {}),
        };
        const pending: PendingEventUpdate =
          kind === "source-switch"
            ? { ...common, kind, nextSource: source }
            : { ...common, kind };
        operation.pending = pending;
        pendingEventUpdateBaseItemsRef.current = currentItems;
        registry.changePhase(operation, "confirmation");
        operation.requestId =
          openEventUpdate(
            pending,
            receiptFor(operation, generation, "confirmation"),
          ) || undefined;
        operation.ownsUntrackedOverlay = !operation.requestId;
      } catch (error) {
        if (!stillAcquiring()) return;
        if (!isCurrentRequest()) {
          finishUpdateOperation(operation.id, { status: "invalidated" });
          return;
        }
        if (error instanceof Error) notify(error.message);
        reportError(
          kind === "source-switch" && !retryUrl
            ? "Spreadsheet source switch preview failed (preview-failed)."
            : "Spreadsheet update preview failed (preview-failed).",
        );
        if (retryUrl) showUrl(operation);
        else {
          notify(
            "新しい更新元の内容を確認できなかったため、更新元も品目も変更していません。",
          );
          finishUpdateOperation(operation.id, { status: "failed" });
        }
      }
    },
    [
      closeEventOverlay,
      eventListsRef,
      eventMetadataRef,
      eventUpdatePreviewEpochRef,
      finishUpdateOperation,
      inputIsCurrent,
      notify,
      openEventUpdate,
      owns,
      pendingEventUpdateBaseItemsRef,
      receiptFor,
      registry,
      reportError,
      showUrl,
    ],
  );

  const handleUpdateEvent = useCallback(
    async (eventName: string): Promise<void> => {
      const operation = startOperation(eventName);
      if (!operation) return;
      const source = resolveSpreadsheetSource(
        recordEntry(eventMetadataRef.current, eventName),
      );
      if (!source) {
        eventUpdatePreviewEpochRef.current += 1;
        showUrl(operation);
      } else await previewEventUpdate(operation, "items-only", source, true);
    },
    [
      eventMetadataRef,
      eventUpdatePreviewEpochRef,
      previewEventUpdate,
      showUrl,
      startOperation,
    ],
  );

  const duplicateOperation = useCallback(
    (pending: PendingDuplicateEventImport) => {
      const current = registry.current;
      if (pending.updateOperationId)
        return current?.id === pending.updateOperationId ? current : null;
      if (
        current &&
        current.complete === pending.complete &&
        current.eventName === pending.analysis.eventName
      )
        return current;
      const operation = startOperation(
        pending.analysis.eventName,
        pending.complete,
        pending.metadata?.request?.isCurrent,
        pending.eventGeneration,
      );
      if (operation) operation.ownsUntrackedOverlay = true;
      return operation;
    },
    [registry, startOperation],
  );

  const handleDuplicateEventResolution = useCallback(
    async (resolution: DuplicateEventResolution): Promise<void> => {
      if (!pendingDuplicateEvent || registry.isSaving()) return;
      const pending = pendingDuplicateEvent;
      const operation = duplicateOperation(pending);
      if (!operation || operation.phase !== "selection") return;
      if (
        !inputIsCurrent(operation) ||
        ((resolution.action === "open-update" ||
          resolution.action === "switch-source") &&
          !eventUpdateSourceMatches(
            recordEntry(eventMetadataRef.current, pending.analysis.eventName),
            pending.analysis.existingSource,
          ))
      ) {
        finishUpdateOperation(operation.id, { status: "invalidated" });
        notify(new EventUpdateInvalidatedError().message);
        return;
      }
      if (
        resolution.action === "open-update" ||
        resolution.action === "switch-source"
      ) {
        await previewEventUpdate(
          operation,
          resolution.action === "open-update" ? "items-only" : "source-switch",
          resolution.source,
          resolution.action === "open-update",
        );
        return;
      }
      closeEventOverlay(operation.requestId);
      if (
        resolution.action === "append-fixed-items" &&
        !resolution.items.length
      ) {
        finishUpdateOperation(operation.id, { status: "no-additions" });
        notify(
          `追加できる新しい品目はありません。完全一致の${resolution.duplicateItemCount}件は追加対象から除かれました。`,
        );
        return;
      }
      const metadata =
        resolution.action === "create-alias"
          ? resolution.source
            ? {
                ...pending.metadata,
                url: resolution.source.url,
                sheetName: resolution.source.sheetName,
                source: "spreadsheet" as const,
              }
            : pending.metadata
          : { source: "app" as const, request: pending.metadata?.request };
      registry.changePhase(operation, "saving");
      try {
        finishUpdateOperation(
          operation.id,
          await applyBulkAdd(resolution.eventName, resolution.items, metadata),
        );
      } catch {
        finishUpdateOperation(operation.id, { status: "failed" });
      }
    },
    [
      applyBulkAdd,
      closeEventOverlay,
      duplicateOperation,
      eventMetadataRef,
      finishUpdateOperation,
      inputIsCurrent,
      notify,
      pendingDuplicateEvent,
      previewEventUpdate,
      registry,
    ],
  );

  const operationForConfirmation = useCallback(() => {
    if (!pendingEventUpdate) return null;
    const current = registry.current;
    if (pendingEventUpdate.updateOperationId)
      return current?.id === pendingEventUpdate.updateOperationId
        ? current
        : null;
    if (current?.pending === pendingEventUpdate) return current;
    if (registry.isSaving()) return null;
    const operation = startOperation(
      pendingEventUpdate.eventName,
      pendingEventUpdate.onImportComplete,
      undefined,
      pendingEventUpdate.eventGeneration,
    );
    if (operation) {
      operation.baseItems = pendingEventUpdateBaseItemsRef.current;
      operation.baseSource = pendingEventUpdate.baseSource;
      operation.pending = pendingEventUpdate;
      operation.ownsUntrackedOverlay = true;
      registry.changePhase(operation, "confirmation");
    }
    return operation;
  }, [
    pendingEventUpdate,
    pendingEventUpdateBaseItemsRef,
    registry,
    startOperation,
  ]);

  const handleCancelUpdate = useCallback(
    (expectedOperationId?: string): boolean => {
      if (registry.isSaving()) return false;
      if (expectedOperationId && registry.current?.id !== expectedOperationId)
        return false;
      const operation =
        registry.current ??
        (pendingDuplicateEvent
          ? duplicateOperation(pendingDuplicateEvent)
          : operationForConfirmation());
      if (operation)
        finishUpdateOperation(operation.id, { status: "cancelled" });
      else closeEventOverlay();
      return true;
    },
    [
      closeEventOverlay,
      duplicateOperation,
      finishUpdateOperation,
      operationForConfirmation,
      pendingDuplicateEvent,
      registry,
    ],
  );

  const handleConfirmUpdate = useCallback(
    async (options: EventUpdateApplyOptions): Promise<void> => {
      if (registry.isSaving()) return;
      const operation = operationForConfirmation();
      const pending = operation?.pending;
      if (!operation || !pending || operation.phase !== "confirmation") return;
      const nextState = inputIsCurrent(operation)
        ? applyPendingEventUpdate({
            state: {
              eventLists: eventListsRef.current,
              eventMetadata: eventMetadataRef.current,
              executeModeItems: executeModeItemsRef.current,
            },
            pending,
            baseItems: operation.baseItems,
            options,
          })
        : null;
      if (!nextState) {
        finishUpdateOperation(operation.id, { status: "invalidated" });
        notify(new EventUpdateInvalidatedError().message);
        return;
      }
      registry.changePhase(operation, "saving");
      try {
        const committed = await commitEventUpdateState(
          nextState,
          (snapshot) => {
            if (
              !inputIsCurrent(operation) ||
              !eventUpdateSourceMatches(
                recordEntry(snapshot.eventMetadata, pending.eventName) as
                  | EventMetadata
                  | undefined,
                pending.baseSource,
              )
            )
              throw new EventUpdateInvalidatedError();
          },
          { confirm: false },
        );
        if (!committed) {
          registry.changePhase(operation, "confirmation");
          notify(
            "イベントを保存できませんでした。確認内容を保持しています。もう一度更新してください。",
          );
          return;
        }
      } catch (error) {
        if (!owns(operation)) return;
        if (error instanceof EventUpdateInvalidatedError) {
          finishUpdateOperation(operation.id, { status: "invalidated" });
          notify(error.message);
          return;
        }
        if (
          error instanceof Error &&
          error.name === "PendingAcceptedMutation"
        ) {
          registry.changePhase(operation, "confirmation");
          notify(pendingSaveNotice);
          return;
        }
        const status = bulkImportFailureStatus(error);
        if (status === "failed" || status === "cancelled") {
          registry.changePhase(operation, "confirmation");
          if (status === "failed")
            notify(
              "イベントを保存できませんでした。確認内容を保持しています。もう一度更新してください。",
            );
        } else {
          finishUpdateOperation(operation.id, { status });
          notify(
            "保存結果の確認が必要です。再取込みせず、画面を再読み込みして保存内容を確認してください。",
          );
        }
        return;
      }
      if (!owns(operation)) return;
      finishUpdateOperation(operation.id, { status: "saved" });
      notify("アイテムを更新しました。");
    },
    [
      commitEventUpdateState,
      eventListsRef,
      eventMetadataRef,
      executeModeItemsRef,
      finishUpdateOperation,
      inputIsCurrent,
      notify,
      operationForConfirmation,
      owns,
      registry,
    ],
  );

  const handleUrlUpdate = useCallback(
    async (
      newUrl: string,
      sheetName: string,
      expectedOperationId?: string,
    ): Promise<void> => {
      if (expectedOperationId && registry.current?.id !== expectedOperationId)
        return;
      if (registry.isSaving()) {
        notify(savingNotice);
        return;
      }
      const operation =
        registry.current ??
        (pendingUpdateEventName
          ? startOperation(pendingUpdateEventName)
          : null);
      if (
        !operation ||
        (operation.phase !== "url" &&
          operation.phase !== "selection" &&
          operation.phase !== "loading")
      )
        return;
      if (!registry.setUrlDraft(operation, newUrl, sheetName)) return;
      await previewEventUpdate(
        operation,
        "source-switch",
        { url: newUrl, sheetName },
        true,
      );
    },
    [
      notify,
      pendingUpdateEventName,
      previewEventUpdate,
      registry,
      startOperation,
    ],
  );

  return {
    isEventUpdateSaving,
    currentUpdateOperationId,
    currentUpdateUrlDraft,
    finishUpdateOperation,
    invalidateEventUpdateForEvent,
    handleUpdateEvent,
    handleDuplicateEventResolution,
    handleDuplicateEventCancel: handleCancelUpdate,
    handleCancelUpdate,
    handleUrlUpdateCancel: handleCancelUpdate,
    handleConfirmUpdate,
    handleUrlUpdate,
  };
};
