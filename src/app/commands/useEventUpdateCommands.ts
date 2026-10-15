import { bulkImportFailureStatus } from "../../utils/importOutcome";
import { recordEntry } from "../../utils/ownRecord";
import { useCallback, useRef } from "react";
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
  buildEventUpdateDiffFromSpreadsheet,
  resolveSpreadsheetSource,
  type EventUpdateCommitState,
  type PendingEventUpdate,
  type SpreadsheetSource,
} from "../../features/events/updateFlow";
import { settleEventUpdatePreviewIfCurrent } from "../../features/events/sourceSwitchPreview";
import type { PendingDuplicateEventImport } from "../state/appOverlayTypes";

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

export interface EventUpdateActionPort {
  applyBulkAdd(
    eventName: string,
    items: ImportedShoppingItem[],
    metadata?: BulkAddMetadata,
  ): Promise<BulkImportResult>;
  commitEventUpdateState(state: EventUpdateCommitState): Promise<boolean>;
  openEventUpdate(pending: PendingEventUpdate): void;
  openUrlUpdate(eventName: string): void;
  closeEventOverlay(): void;
  confirmEventOverlay(): void;
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
  handleUpdateEvent(eventName: string): Promise<void>;
  handleDuplicateEventResolution(
    resolution: DuplicateEventResolution,
  ): Promise<void>;
  handleDuplicateEventCancel(): void;
  handleCancelUpdate(): void;
  handleConfirmUpdate(options: EventUpdateApplyOptions): Promise<void>;
  handleUrlUpdate(newUrl: string, sheetName: string): Promise<void>;
}

interface EventUpdatePreviewRequest {
  readonly kind: PendingEventUpdate["kind"];
  readonly eventName: string;
  readonly source: SpreadsheetSource;
  readonly onError: (error: unknown) => void;
}

export const useEventUpdateCommands = ({
  state,
  actions,
  effects,
}: EventUpdateCommandPorts): EventUpdateCommands => {
  const {
    getEventGeneration,
    eventMetadata,
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
  const importCompletion =
    useRef<PendingDuplicateEventImport["complete"]>(undefined);
  const savingImport = useRef(false);
  const finishImport = useCallback(
    (result: BulkImportResult) => {
      const complete =
        importCompletion.current ??
        pendingEventUpdate?.onImportComplete ??
        pendingDuplicateEvent?.complete;
      complete?.(result);
      importCompletion.current = undefined;
    },
    [pendingEventUpdate?.onImportComplete, pendingDuplicateEvent?.complete],
  );

  const previewEventUpdate = useCallback(
    async ({
      kind,
      eventName,
      source,
      onError,
    }: EventUpdatePreviewRequest): Promise<void> => {
      eventUpdatePreviewEpochRef.current += 1;
      closeEventOverlay();
      pendingEventUpdateBaseItemsRef.current = null;

      const latestItems = recordEntry(eventListsRef.current, eventName);
      if (!latestItems) {
        finishImport({ status: "invalidated" });
        return;
      }
      const currentItems = structuredClone(latestItems);
      const requestEpoch = eventUpdatePreviewEpochRef.current;
      const eventGeneration = getEventGeneration?.(eventName);
      const isCurrentRequest = () =>
        eventUpdatePreviewEpochRef.current === requestEpoch &&
        getEventGeneration?.(eventName) === eventGeneration &&
        eventUpdateItemsMatch(
          recordEntry(eventListsRef.current, eventName),
          currentItems,
        );

      const previewResult = await settleEventUpdatePreviewIfCurrent({
        loadPreview: () =>
          buildEventUpdateDiffFromSpreadsheet(currentItems, source),
        isCurrent: isCurrentRequest,
        commit: (updateDiff) => {
          pendingEventUpdateBaseItemsRef.current = currentItems;
          openEventUpdate(
            kind === "source-switch"
              ? {
                  kind,
                  eventName,
                  diff: updateDiff,
                  ...(eventGeneration === undefined ? {} : { eventGeneration }),
                  ...(importCompletion.current
                    ? { onImportComplete: importCompletion.current }
                    : {}),
                  nextSource: source,
                }
              : {
                  kind,
                  eventName,
                  diff: updateDiff,
                  ...(eventGeneration === undefined ? {} : { eventGeneration }),
                  ...(importCompletion.current
                    ? { onImportComplete: importCompletion.current }
                    : {}),
                },
          );
        },
        onError: (error) => {
          if (error instanceof Error) notify(error.message);
          onError(error);
        },
      });
      if (previewResult !== "committed")
        finishImport({
          status: previewResult === "stale" ? "invalidated" : "failed",
        });
    },
    [
      getEventGeneration,
      finishImport,
      notify,
      eventListsRef,
      eventUpdatePreviewEpochRef,
      closeEventOverlay,
      openEventUpdate,
      pendingEventUpdateBaseItemsRef,
    ],
  );

  const handleUpdateEvent = useCallback(
    async (eventName: string): Promise<void> => {
      const source = resolveSpreadsheetSource(
        recordEntry(eventMetadata, eventName),
      );
      if (!source) {
        eventUpdatePreviewEpochRef.current += 1;
        openUrlUpdate(eventName);
        return;
      }

      await previewEventUpdate({
        kind: "items-only",
        eventName,
        source,
        onError: () => {
          reportError("Spreadsheet update preview failed (preview-failed).");
          openUrlUpdate(eventName);
        },
      });
    },
    [
      eventMetadata,
      eventUpdatePreviewEpochRef,
      openUrlUpdate,
      previewEventUpdate,
      reportError,
    ],
  );

  const handleDuplicateEventResolution = useCallback(
    async (resolution: DuplicateEventResolution): Promise<void> => {
      const pending = pendingDuplicateEvent;
      if (savingImport.current) return;
      if (!pending) return;
      if (pending.metadata?.request?.isCurrent?.() === false) {
        pending.complete?.({ status: "invalidated" });
        closeEventOverlay();
        return;
      }
      if (
        pending.eventGeneration !== undefined &&
        pending.eventGeneration !==
          getEventGeneration?.(pending.analysis.eventName)
      ) {
        pending.complete?.({ status: "invalidated" });
        closeEventOverlay();
        notify(
          "対象イベントが変更されたため取込みを終了しました。入力を確認して再試行してください。",
        );
        return;
      }
      importCompletion.current = pending.complete;
      eventUpdatePreviewEpochRef.current += 1;
      closeEventOverlay();

      if (resolution.action === "create-alias") {
        const nextMetadata: BulkAddMetadata | undefined = resolution.source
          ? {
              ...pending.metadata,
              url: resolution.source.url,
              sheetName: resolution.source.sheetName,
              source: "spreadsheet",
            }
          : pending.metadata;
        savingImport.current = true;
        try {
          finishImport(
            await applyBulkAdd(
              resolution.eventName,
              resolution.items,
              nextMetadata,
            ),
          );
        } catch {
          finishImport({ status: "failed" });
        } finally {
          savingImport.current = false;
        }
        return;
      }

      if (resolution.action === "append-fixed-items") {
        if (resolution.items.length === 0) {
          finishImport({ status: "no-additions" });
          notify(
            `追加できる新しい品目はありません。完全一致の${resolution.duplicateItemCount}件は追加対象から除かれました。`,
          );
        } else {
          savingImport.current = true;
          try {
            finishImport(
              await applyBulkAdd(resolution.eventName, resolution.items, {
                source: "app",
                request: pending.metadata?.request,
              }),
            );
          } catch {
            finishImport({ status: "failed" });
          } finally {
            savingImport.current = false;
          }
        }
        return;
      }

      if (resolution.action === "open-update") {
        await previewEventUpdate({
          kind: "items-only",
          eventName: resolution.eventName,
          source: {
            url: resolution.source.url,
            sheetName: resolution.source.sheetName,
          },
          onError: () => {
            reportError("Spreadsheet update preview failed (preview-failed).");
            openUrlUpdate(resolution.eventName);
          },
        });
        return;
      }

      await previewEventUpdate({
        kind: "source-switch",
        eventName: resolution.eventName,
        source: {
          url: resolution.source.url,
          sheetName: resolution.source.sheetName,
        },
        onError: () => {
          reportError(
            "Spreadsheet source switch preview failed (preview-failed).",
          );
          notify(
            "新しい更新元の内容を確認できなかったため、更新元も品目も変更していません。",
          );
        },
      });
    },
    [
      applyBulkAdd,
      finishImport,
      getEventGeneration,
      closeEventOverlay,
      eventUpdatePreviewEpochRef,
      notify,
      openUrlUpdate,
      pendingDuplicateEvent,
      previewEventUpdate,
      reportError,
    ],
  );

  const handleDuplicateEventCancel = useCallback(() => {
    if (savingImport.current) return;

    finishImport({ status: "cancelled" });
    eventUpdatePreviewEpochRef.current += 1;
    closeEventOverlay();
  }, [closeEventOverlay, eventUpdatePreviewEpochRef, finishImport]);

  const handleCancelUpdate = useCallback(() => {
    if (savingImport.current) return;
    finishImport({ status: "cancelled" });
    eventUpdatePreviewEpochRef.current += 1;
    closeEventOverlay();
  }, [closeEventOverlay, eventUpdatePreviewEpochRef, finishImport]);

  const handleConfirmUpdate = useCallback(
    async (options: EventUpdateApplyOptions): Promise<void> => {
      if (!pendingEventUpdate || savingImport.current) return;

      const generationMatches =
        pendingEventUpdate.eventGeneration === undefined ||
        pendingEventUpdate.eventGeneration ===
          getEventGeneration?.(pendingEventUpdate.eventName);
      const nextState = generationMatches
        ? applyPendingEventUpdate({
            state: {
              eventLists: eventListsRef.current,
              eventMetadata: eventMetadataRef.current,
              executeModeItems: executeModeItemsRef.current,
            },
            pending: pendingEventUpdate,
            baseItems: pendingEventUpdateBaseItemsRef.current,
            options,
          })
        : null;
      if (!nextState) {
        finishImport({ status: "invalidated" });
        closeEventOverlay();
        notify(
          "確認中にイベントの品目が変更または削除されたため、更新元も品目も変更していません。もう一度更新してください。",
        );
        return;
      }

      savingImport.current = true;
      try {
        if (!(await commitEventUpdateState(nextState))) {
          finishImport({ status: "failed" });
          return;
        }
      } catch (error) {
        const status = bulkImportFailureStatus(error);
        finishImport({ status });
        if (status === "unknown" || status === "committed-ui-failed") {
          closeEventOverlay();
          notify(
            "保存結果の確認が必要です。再取込みせず、画面を再読み込みして保存内容を確認してください。",
          );
        } else if (status === "failed")
          notify(
            "イベントを保存できませんでした。表示内容は変更されていません。",
          );
        return;
      } finally {
        savingImport.current = false;
      }
      finishImport({ status: "saved" });
      pendingEventUpdateBaseItemsRef.current = null;
      confirmEventOverlay();
      notify("アイテムを更新しました。");
    },
    [
      commitEventUpdateState,
      finishImport,
      closeEventOverlay,
      confirmEventOverlay,
      eventListsRef,
      eventMetadataRef,
      executeModeItemsRef,
      notify,
      pendingEventUpdate,
      getEventGeneration,
      pendingEventUpdateBaseItemsRef,
    ],
  );

  const handleUrlUpdate = useCallback(
    async (newUrl: string, sheetName: string): Promise<void> => {
      closeEventOverlay();
      if (!pendingUpdateEventName) return;

      const eventName = pendingUpdateEventName;
      const currentMetadata = recordEntry(eventMetadata, eventName);
      const normalizedSheetName =
        sheetName || currentMetadata?.spreadsheetSheetName || "";

      await previewEventUpdate({
        kind: "source-switch",
        eventName,
        source: {
          url: newUrl,
          sheetName: normalizedSheetName,
        },
        onError: () => {
          reportError("Spreadsheet update preview failed (preview-failed).");
          openUrlUpdate(eventName);
        },
      });
    },
    [
      eventMetadata,
      closeEventOverlay,
      openUrlUpdate,
      pendingUpdateEventName,
      previewEventUpdate,
      reportError,
    ],
  );

  return {
    handleUpdateEvent,
    handleDuplicateEventResolution,
    handleDuplicateEventCancel,
    handleCancelUpdate,
    handleConfirmUpdate,
    handleUrlUpdate,
  };
};
