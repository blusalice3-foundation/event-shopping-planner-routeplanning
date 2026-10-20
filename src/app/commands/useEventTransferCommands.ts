import { isPersistenceWriteStopReason } from "../ports/PersistenceCommandPort";
import { CommittedStateApplyError } from "./applicationMutationCoordinator";
import type { AppOverlayOpenReceipt } from "../state/useAppOverlayController";
import { recordEntry } from "../../utils/ownRecord";
import type { ApplicationMutationPort } from "../ports/ApplicationMutationPort";
import type { EventConsistencyStore } from "../../types/consistency";
import { planEventRestore } from "../../features/consistency/domain/eventMutations";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { ExportOptions } from "../../types/export";
import type {
  DayModeState,
  EventMetadata,
  ExecuteModeItems,
  ShoppingItem,
} from "../../types/item";
import type {
  HallDefinitionsStore,
  HallRouteSettingsStore,
  MapDataStore,
  MapRotationSettingsStore,
  MapViewportSettingsStore,
  RouteSettingsStore,
} from "../../types/map";
import {
  type PersistenceCommandPort,
  type PersistenceSnapshot,
} from "../ports/PersistenceCommandPort";
import type { AppNavigationCommands } from "../navigation";
import type { PendingXlsxRestoreCompletion } from "../state/appOverlayTypes";
import type { XlsxOperationOverlayActivity } from "../state/appOverlayState";
import type {
  PersistedStateValues,
  PersistenceStartupState,
} from "../../hooks/useIndexedDbPersistence";
import {
  createAppBackup,
  parseAppBackup,
  createAppBackupFile,
  type AppBackupV1,
} from "../../utils/appBackup";
import { downloadBlob } from "../../utils/downloadBlob";
import {
  exportStartupRecoveryBundle,
  type PersistenceRecoveryExportResult,
} from "../../utils/persistenceRecoveryExport";
import {
  buildEventExportFile,
  hasExportableItems,
  selectEventExportContent,
} from "../../features/events/exportFlow";
import {
  buildXlsxEventRestoreSource,
  toImportedEventData,
} from "../../features/events/fileImport";
import {
  buildImportCompletionMessage,
  buildLargeXlsxRestoreDeferredNotice,
  buildLegacySheetFieldFallbackMessage,
  resolveEventListTab,
  shouldDeferLargeXlsxRestoreOpen,
} from "../../features/events/uiOrchestration";
import type { ItemFallbackWarning } from "../../xlsx/domain/eventWorkbook";
import type { XlsxExecutionPort } from "../../xlsx/port/XlsxExecutionPort";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export interface EventTransferRuntime {
  readonly persistenceCommands: PersistenceCommandPort;
  readonly xlsxCommands: XlsxExecutionPort;
  readonly downloadXlsx: (bytes: Uint8Array, fileName: string) => void;
}

export interface EventTransferCommandPorts extends ApplicationMutationPort {
  eventConsistency: EventConsistencyStore;
  appRuntime: EventTransferRuntime;
  eventLists: Record<string, ShoppingItem[]>;
  eventMetadata: Record<string, EventMetadata>;
  executeModeItems: Record<string, ExecuteModeItems>;
  dayModes: Record<string, DayModeState>;
  mapData: MapDataStore;
  mapRotationSettings: MapRotationSettingsStore;
  routeSettings: RouteSettingsStore;
  hallDefinitions: HallDefinitionsStore;
  hallRouteSettings: HallRouteSettingsStore;
  mapViewportSettings: MapViewportSettingsStore;
  startupState: PersistenceStartupState;
  exportEventName: string | null;
  pendingBackup: AppBackupV1 | null;
  pendingXlsxRestoreCompletion: PendingXlsxRestoreCompletion | null;
  navigationCommands: Pick<
    AppNavigationCommands,
    "openEvent" | "showEventList"
  >;
  clearSelection(): void;
  runExclusiveRestore: <T>(
    restoredValues: PersistedStateValues,
    restore: () => Promise<T>,
  ) => Promise<T>;
  openExport(eventName: string): void;
  confirmEventOverlay(): void;
  openBackupRestore(
    backup: AppBackupV1,
    xlsxCompletion: PendingXlsxRestoreCompletion | null,
    onReceipt?: (receipt: AppOverlayOpenReceipt) => void,
  ): string | void;
  confirmBackupRestore(requestId?: string): void;
  closeBackupRestore?(requestId?: string): void;
  stopWrites?(reason: CommittedStateApplyError): void;
  startXlsxOperation(activity: XlsxOperationActivity): string;
  updateXlsxOperation(requestId: string, activity: XlsxOperationActivity): void;
  clearXlsxOperation(requestId: string): void;
  setEventLists: StateSetter<Record<string, ShoppingItem[]>>;
  setEventMetadata: StateSetter<Record<string, EventMetadata>>;
  setExecuteModeItemsCommitted: StateSetter<Record<string, ExecuteModeItems>>;
  setDayModes: StateSetter<Record<string, DayModeState>>;
  setMapData: StateSetter<MapDataStore>;
  setMapRotationSettings: StateSetter<MapRotationSettingsStore>;
  setRouteSettings: StateSetter<RouteSettingsStore>;
  setHallDefinitions: StateSetter<HallDefinitionsStore>;
  setHallRouteSettings: StateSetter<HallRouteSettingsStore>;
  setMapViewportSettings: StateSetter<MapViewportSettingsStore>;
}

export interface EventTransferCommands {
  backupFileInputRef: RefObject<HTMLInputElement>;
  isBackupRestoreStopped: boolean;
  cancelXlsxOperation(): void;
  handleExportEvent(eventName: string): Promise<void>;
  previewEventExport(
    options: ExportOptions,
  ): ReturnType<typeof selectEventExportContent>["manifest"];
  handleBackupExport(): void;
  handlePersistenceRecoveryExport(): PersistenceRecoveryExportResult;
  handleBackupRestoreRequest(): void;
  handleBackupRestoreCancel(requestId?: string): boolean;
  handleBackupFileImport(event: ChangeEvent<HTMLInputElement>): Promise<void>;
  handleBackupRestore(
    sourceEventName: string,
    targetEventName: string,
  ): Promise<void>;
  handleConfirmExport(options: ExportOptions): Promise<void>;
  handleExportFileImport(event: ChangeEvent<HTMLInputElement>): Promise<void>;
}

export type XlsxOperationActivity = XlsxOperationOverlayActivity;

interface ActiveXlsxOperation {
  readonly controller: AbortController;
  readonly requestId: string;
  activity: XlsxOperationActivity;
}

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";

export const useEventTransferCommands = ({
  requestMutation,
  readExportSnapshot,
  createBackupFile,
  appRuntime,
  startupState,
  exportEventName,
  pendingBackup,
  pendingXlsxRestoreCompletion,
  navigationCommands,
  clearSelection,
  openExport,
  confirmEventOverlay,
  openBackupRestore,
  confirmBackupRestore,
  closeBackupRestore,
  stopWrites,
  startXlsxOperation,
  updateXlsxOperation,
  clearXlsxOperation,
}: EventTransferCommandPorts): EventTransferCommands => {
  const backupFileInputRef = useRef<HTMLInputElement>(null);
  const [isBackupRestoreStopped, setBackupRestoreStopped] = useState(false);
  const xlsxOperationRef = useRef<ActiveXlsxOperation | null>(null);
  const restoreOwnerRef = useRef<{
    phase: "reading" | "candidate" | "restoring" | "stopped";
    requestId?: string;
    backup?: AppBackupV1;
  } | null>(null);
  const exportRequestRef = useRef(0);
  const [exportSession, setExportSession] = useState<{
    eventName: string;
    snapshot: PersistenceSnapshot;
  } | null>(null);

  useEffect(
    () => () => {
      restoreOwnerRef.current = null;
      xlsxOperationRef.current?.controller.abort();
    },
    [],
  );

  const cancelXlsxOperation = useCallback(() => {
    const active = xlsxOperationRef.current;
    if (!active) return;
    active.activity = { ...active.activity, cancelRequested: true };
    updateXlsxOperation(active.requestId, active.activity);
    active.controller.abort();
  }, [updateXlsxOperation]);

  const handleExportEvent = useCallback(
    async (eventName: string) => {
      const request = ++exportRequestRef.current;
      try {
        const snapshot = structuredClone(await readExportSnapshot());
        if (request !== exportRequestRef.current) return;
        if (
          !hasExportableItems(
            recordEntry(snapshot.eventLists, eventName) as ShoppingItem[],
          )
        ) {
          alert("出力できるアイテムがありません。");
          return;
        }
        setExportSession({ eventName, snapshot });
        openExport(eventName);
      } catch {
        alert("出力内容を確認できません。再試行してください。");
      }
    },
    [readExportSnapshot, openExport],
  );

  const previewEventExport = useCallback(
    (options: ExportOptions) => {
      if (!exportSession || exportSession.eventName !== exportEventName)
        throw new Error("出力内容を確認し直してください。");
      return selectEventExportContent(
        exportSession.snapshot,
        exportSession.eventName,
        options,
      ).manifest;
    },
    [exportSession, exportEventName],
  );

  const handleBackupExport = useCallback(async () => {
    try {
      const file = createBackupFile
        ? await createBackupFile()
        : createAppBackupFile(await readExportSnapshot());
      const timestamp = file.exportedAt.replace(/[:.]/g, "-");
      downloadBlob(
        file.blob,
        `event-shopping-planner-backup-${timestamp}.json`,
      );
    } catch {
      console.error("Backup export failed (backup-export-failed).");
      alert(
        "バックアップを完全に保存できなかったため、ファイルを作成しませんでした。現在のデータは変更されていません。",
      );
    }
  }, [readExportSnapshot, createBackupFile]);

  const handlePersistenceRecoveryExport =
    useCallback((): PersistenceRecoveryExportResult => {
      if (
        startupState.status !== "recovery-required" ||
        !startupState.recoveryBundle
      ) {
        return { status: "failed" };
      }

      const result = exportStartupRecoveryBundle(startupState.recoveryBundle);
      if (result.status === "failed") {
        console.error(
          "Persistence recovery export failed (recovery-export-failed).",
        );
        alert(
          "退避用JSONを作成できませんでした。保存候補は変更されていません。",
        );
      }
      return result;
    }, [startupState]);

  const handleBackupRestoreRequest = useCallback(() => {
    backupFileInputRef.current?.click();
  }, []);

  const handleBackupRestoreCancel = useCallback(
    (requestId?: string) => {
      const owner = restoreOwnerRef.current;
      if (
        owner &&
        (owner.phase === "restoring" ||
          owner.phase === "stopped" ||
          (requestId !== undefined && owner.requestId !== requestId))
      )
        return false;
      restoreOwnerRef.current = null;
      closeBackupRestore?.(requestId);
      return true;
    },
    [closeBackupRestore],
  );

  const handleBackupFileImport = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget ?? event.target;
      const file = input.files?.[0];
      input.value = "";
      if (
        !file ||
        pendingBackup ||
        (restoreOwnerRef.current && restoreOwnerRef.current.phase !== "reading")
      )
        return;
      const previousXlsx = xlsxOperationRef.current;
      if (previousXlsx?.activity.kind === "import") {
        previousXlsx.controller.abort();
        xlsxOperationRef.current = null;
        clearXlsxOperation(previousXlsx.requestId);
      }
      const owner = { phase: "reading" as const } as NonNullable<
        typeof restoreOwnerRef.current
      >;
      restoreOwnerRef.current = owner;
      try {
        const text = await file.text();
        if (restoreOwnerRef.current !== owner) return;
        const result = parseAppBackup(text);
        if (!result.ok) {
          restoreOwnerRef.current = null;
          alert(
            `バックアップを読み込めませんでした。\n${result.errors.join("\n")}`,
          );
          return;
        }
        if (Object.keys(result.data.eventLists).length === 0) {
          restoreOwnerRef.current = null;
          alert("このバックアップには復元できるイベントがありません。");
          return;
        }
        owner.phase = "candidate";
        owner.backup = result.backup;
        const requestId = openBackupRestore(result.backup, null, (receipt) => {
          if (restoreOwnerRef.current !== owner) return;
          if (receipt.accepted) owner.requestId = receipt.requestId;
          else restoreOwnerRef.current = null;
        });
        if (typeof requestId === "string") owner.requestId = requestId;
      } catch {
        if (restoreOwnerRef.current !== owner) return;
        restoreOwnerRef.current = null;
        console.error("Backup import failed (backup-import-failed).");
        alert(
          "バックアップを読み込めませんでした。JSONバックアップファイルを選び直してください。",
        );
      }
    },
    [openBackupRestore, pendingBackup, clearXlsxOperation],
  );
  const handleBackupRestore = useCallback(
    async (sourceEventName: string, targetEventName: string) => {
      if (!pendingBackup) {
        throw new Error("復元するバックアップをもう一度選んでください。");
      }

      let owner = restoreOwnerRef.current;
      if (
        owner &&
        (owner.phase !== "candidate" ||
          (owner.backup && owner.backup !== pendingBackup))
      )
        return;
      if (!owner) {
        owner = { phase: "candidate", backup: pendingBackup };
        restoreOwnerRef.current = owner;
      }
      owner.phase = "restoring";
      let committed = false;
      try {
        const currentData = await readExportSnapshot();
        const isUpdate = Object.prototype.hasOwnProperty.call(
          currentData.eventLists,
          targetEventName,
        );
        const nextData = await requestMutation({
          events: [targetEventName],
          plan: (snapshot, choices) =>
            planEventRestore(
              snapshot,
              pendingBackup.data,
              sourceEventName,
              targetEventName,
              pendingBackup.notices?.map(
                (change) => `${change.path}: ${change.message}`,
              ),
              choices,
            ),
        });
        committed = true;
        const restoredItems = recordEntry(
          nextData.eventLists,
          targetEventName,
        ) as ShoppingItem[];
        const restoredTab = resolveEventListTab(restoredItems);
        const deferLargeXlsxOpen = shouldDeferLargeXlsxRestoreOpen({
          isXlsxRestore: pendingXlsxRestoreCompletion !== null,
          itemCount: restoredItems.length,
        });
        if (deferLargeXlsxOpen) {
          navigationCommands.showEventList();
        } else if (restoredTab) {
          navigationCommands.openEvent(targetEventName, restoredTab);
        } else {
          navigationCommands.showEventList();
        }
        clearSelection();
        confirmBackupRestore(owner.requestId);

        if (pendingXlsxRestoreCompletion) {
          const completionMessage = buildImportCompletionMessage({
            errors: pendingXlsxRestoreCompletion.errors,
            eventName: targetEventName,
            isUpdate,
            itemCount: pendingXlsxRestoreCompletion.itemCount,
          });
          alert(
            deferLargeXlsxOpen
              ? `${completionMessage}\n${buildLargeXlsxRestoreDeferredNotice(
                  restoredItems.length,
                )}`
              : completionMessage,
          );
        }
        if (restoreOwnerRef.current === owner) restoreOwnerRef.current = null;
      } catch (error) {
        if (restoreOwnerRef.current === owner) {
          owner.phase =
            !committed && !isPersistenceWriteStopReason(error)
              ? "candidate"
              : "stopped";
          if (owner.phase === "stopped") setBackupRestoreStopped(true);
        }
        if (committed) {
          const failure = new CommittedStateApplyError(error);
          stopWrites?.(failure);
          throw failure;
        }
        throw error;
      }
    },
    [
      stopWrites,
      pendingBackup,
      requestMutation,
      readExportSnapshot,
      clearSelection,
      confirmBackupRestore,
      pendingXlsxRestoreCompletion,
      navigationCommands,
    ],
  );

  const handleConfirmExport = useCallback(
    async (options: ExportOptions) => {
      if (!exportEventName || exportSession?.eventName !== exportEventName)
        return;

      options = structuredClone(options);
      const exportSnapshot = exportSession.snapshot;
      const itemsToExport = recordEntry(
        exportSnapshot.eventLists,
        exportEventName,
      ) as ShoppingItem[];
      if (!hasExportableItems(itemsToExport)) {
        return;
      }

      xlsxOperationRef.current?.controller.abort();
      const controller = new AbortController();
      const initialActivity: XlsxOperationActivity = {
        kind: "export",
        progress: null,
        cancelRequested: false,
      };
      const requestId = startXlsxOperation(initialActivity);
      const operation: ActiveXlsxOperation = {
        controller,
        requestId,
        activity: initialActivity,
      };
      xlsxOperationRef.current = operation;
      try {
        const { bytes, filename } = await buildEventExportFile(
          appRuntime.xlsxCommands,
          controller.signal,
          exportEventName,
          itemsToExport,
          options,
          recordEntry(
            exportSnapshot.eventMetadata,
            exportEventName,
          ) as EventMetadata,
          {
            ...(exportSnapshot as unknown as PersistedStateValues),
            blockDetectionSettings: recordEntry(
              exportSnapshot.eventConsistency,
              exportEventName,
            )?.blockDetectionSettings
              ? {
                  [exportEventName]: recordEntry(
                    exportSnapshot.eventConsistency,
                    exportEventName,
                  ).blockDetectionSettings!,
                }
              : {},
          },
          new Date(),
          (_requestId, progress) => {
            if (xlsxOperationRef.current !== operation) return;
            operation.activity = { ...operation.activity, progress };
            updateXlsxOperation(requestId, operation.activity);
          },
        );
        if (controller.signal.aborted) return;
        appRuntime.downloadXlsx(bytes, filename);
      } catch (error) {
        if (isAbortError(error)) return;
        console.error("Item export failed (item-export-failed).");
        alert("アイテムの出力に失敗しました。");
      } finally {
        if (xlsxOperationRef.current === operation) {
          xlsxOperationRef.current = null;
          clearXlsxOperation(requestId);
        }
      }

      confirmEventOverlay();
    },
    [
      exportEventName,
      exportSession,
      clearXlsxOperation,
      confirmEventOverlay,
      appRuntime,
      startXlsxOperation,
      updateXlsxOperation,
    ],
  );

  const handleExportFileImport = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (
        !file ||
        pendingBackup ||
        (restoreOwnerRef.current && restoreOwnerRef.current.phase !== "reading")
      )
        return;
      const owner: NonNullable<typeof restoreOwnerRef.current> = {
        phase: "reading",
      };
      restoreOwnerRef.current = owner;

      xlsxOperationRef.current?.controller.abort();
      const controller = new AbortController();
      const initialActivity: XlsxOperationActivity = {
        kind: "import",
        progress: null,
        cancelRequested: false,
      };
      const requestId = startXlsxOperation(initialActivity);
      const operation: ActiveXlsxOperation = {
        controller,
        requestId,
        activity: initialActivity,
      };
      xlsxOperationRef.current = operation;
      try {
        const input = await file.arrayBuffer();
        if (controller.signal.aborted || restoreOwnerRef.current !== owner)
          return;
        const response = await appRuntime.xlsxCommands.importWorkbook(
          { kind: "event-import", input, fileName: file.name },
          controller.signal,
          (_requestId, progress) => {
            if (xlsxOperationRef.current !== operation) return;
            operation.activity = { ...operation.activity, progress };
            updateXlsxOperation(requestId, operation.activity);
          },
        );
        if (controller.signal.aborted || restoreOwnerRef.current !== owner)
          return;
        if (response.kind !== "event-import") {
          throw new Error("XLSX Worker returned an unexpected result kind.");
        }
        const result = response.value;

        if (!result.success) {
          alert(`インポートに失敗しました:\n${result.errors.join("\n")}`);
          return;
        }

        const fallbackWarnings = result.itemFallbackWarnings || [];
        const skippedItemIds = new Set<string>();
        const BULK_APPROVAL_THRESHOLD = 6;

        const describeFallbackWarning = (
          warning: ItemFallbackWarning,
        ): string =>
          `${warning.rowNumber}行目\n${warning.reasons.map((reason) => `- ${reason}`).join("\n")}`;

        if (fallbackWarnings.length >= BULK_APPROVAL_THRESHOLD) {
          const previewLines = fallbackWarnings
            .slice(0, 5)
            .map(
              (warning) =>
                `- ${warning.rowNumber}行目: ${warning.reasons[0] || "補完が必要です"}`,
            );
          const previewText = previewLines.join("\n");
          const hasMore = fallbackWarnings.length > 5 ? "\n- ..." : "";

          const complementAll = window.confirm(
            `不正データが${fallbackWarnings.length}件見つかりました。\n${previewText}${hasMore}\n\nOK: すべて補完して取り込む\nキャンセル: すべてスキップ`,
          );

          if (!complementAll) {
            fallbackWarnings.forEach((warning) => {
              skippedItemIds.add(warning.itemId);
            });
          }
        } else {
          for (const warning of fallbackWarnings) {
            const shouldComplement = window.confirm(
              `不正データを検出しました。\n${describeFallbackWarning(warning)}\n\nOK: この行を補完して取り込む\nキャンセル: この行をスキップ`,
            );
            if (!shouldComplement) {
              skippedItemIds.add(warning.itemId);
            }
          }
        }

        const resolvedItems =
          skippedItemIds.size === 0
            ? result.items
            : result.items.filter((item) => !skippedItemIds.has(item.id));
        if (resolvedItems.length === 0) {
          if (result.items.length > 0 && skippedItemIds.size > 0) {
            alert(
              "不正データをすべてスキップしたため、取り込み対象がありませんでした。",
            );
          } else {
            alert("取り込んだファイルにアイテムが見つかりませんでした。");
          }
          return;
        }

        const fallbackResolutionMessages: string[] = [];
        if (fallbackWarnings.length > 0) {
          const skippedCount = skippedItemIds.size;
          const complementedCount = fallbackWarnings.length - skippedCount;
          if (complementedCount > 0) {
            fallbackResolutionMessages.push(
              `不正データ${complementedCount}件を補完して取り込みました。`,
            );
          }
          if (skippedCount > 0) {
            fallbackResolutionMessages.push(
              `不正データ${skippedCount}件をスキップしました。`,
            );
          }
        }
        const legacySheetFieldFallbackMessage =
          buildLegacySheetFieldFallbackMessage({
            fallbacks: result.legacySheetFieldFallbacks || [],
            skippedItemIds,
          });
        if (legacySheetFieldFallbackMessage) {
          fallbackResolutionMessages.push(legacySheetFieldFallbackMessage);
        }

        const resolvedResult = {
          ...result,
          items: resolvedItems,
          errors: [...result.errors, ...fallbackResolutionMessages],
        };

        if (resolvedResult.items.length === 0) {
          alert("取り込んだファイルにアイテムが見つかりませんでした。");
          return;
        }

        const importedData = toImportedEventData(resolvedResult);
        const restoreSource = buildXlsxEventRestoreSource(importedData);
        const validation = parseAppBackup(
          createAppBackup(restoreSource.data, new Date(), {
            blockDetectionSettings: restoreSource.blockDetectionSettings,
          }),
        );
        if (!validation.ok) {
          alert(
            `Excel復元データを検証できませんでした。\n${validation.errors.join("\n")}`,
          );
          return;
        }

        owner.phase = "candidate";
        const restoreRequestId = openBackupRestore(
          {
            ...validation.backup,
            notices: [
              ...restoreSource.notices,
              ...(validation.backup.notices ?? []),
            ],
          },
          {
            errors: importedData.errors,
            itemCount: importedData.items.length,
          },
          (receipt) => {
            if (restoreOwnerRef.current !== owner) return;
            if (receipt.accepted) owner.requestId = receipt.requestId;
            else restoreOwnerRef.current = null;
          },
        );
        if (typeof restoreRequestId === "string")
          owner.requestId = restoreRequestId;
      } catch (error) {
        if (isAbortError(error) || restoreOwnerRef.current !== owner) return;
        console.error("Item import failed (item-import-failed).");
        alert(
          "アイテムの取り込みに失敗しました。ファイル形式を確認してください。",
        );
      } finally {
        if (
          typeof owner !== "undefined" &&
          restoreOwnerRef.current === owner &&
          owner.phase === "reading"
        )
          restoreOwnerRef.current = null;
        if (xlsxOperationRef.current === operation) {
          xlsxOperationRef.current = null;
          clearXlsxOperation(requestId);
        }
      }
    },
    [
      pendingBackup,
      appRuntime.xlsxCommands,
      clearXlsxOperation,
      openBackupRestore,
      startXlsxOperation,
      updateXlsxOperation,
    ],
  );

  return {
    backupFileInputRef,
    isBackupRestoreStopped,
    cancelXlsxOperation,
    handleExportEvent,
    previewEventExport,
    handleBackupExport,
    handlePersistenceRecoveryExport,
    handleBackupRestoreRequest,
    handleBackupRestoreCancel,
    handleBackupFileImport,
    handleBackupRestore,
    handleConfirmExport,
    handleExportFileImport,
  };
};
