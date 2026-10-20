import type { MapEditorSession } from "../../features/map/domain/mapEditorSession";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  AppOverlayInvariantError,
  assertAppOverlayState,
  createInitialAppOverlayState,
  reduceAppOverlayState,
  selectActiveAppOverlayKinds,
  selectAppOverlayReadModel,
  selectConcurrentOverlayStatus,
  selectHasBlockingAppOverlay,
  type ActiveAppOverlayKind,
  type AppOverlayAction,
  type AppOverlayReadModel,
  type AppOverlayState,
  type BackupOverlayState,
  type ConcurrentOverlayStatus,
  type EventOverlayState,
  type ItemOverlayState,
  type MapEditorOverlayState,
  type MapImportOverlayState,
  type XlsxOperationOverlayActivity,
} from "./appOverlayState";

type ActiveItemOverlay = Exclude<
  ItemOverlayState,
  Readonly<{ kind: "inactive" }>
>;
type ActiveEventOverlay = Exclude<
  EventOverlayState,
  Readonly<{ kind: "inactive" }>
>;
type RestoreOverlay = Extract<BackupOverlayState, { kind: "restore" }>;
type ImportOverlay = Extract<MapImportOverlayState, { kind: "import" }>;
type ReimportOverlay = Extract<MapImportOverlayState, { kind: "reimport" }>;
type BlockDefinitionOverlay = Extract<
  MapEditorOverlayState,
  { kind: "block-definition" }
>;
type CellSelectionOverlay = Extract<
  MapEditorOverlayState,
  { kind: "cell-selection" }
>;
type HallDefinitionOverlay = Extract<
  MapEditorOverlayState,
  { kind: "hall-definition" }
>;
type VertexSelectionOverlay = Extract<
  MapEditorOverlayState,
  { kind: "vertex-selection" }
>;

export interface AppOverlayItemCommands {
  openEdit(item: Extract<ActiveItemOverlay, { kind: "edit" }>["item"]): string;
  openDelete(
    item: Extract<ActiveItemOverlay, { kind: "delete" }>["item"],
  ): string;
  close(): void;
  confirm(): void;
}

export interface AppOverlayOpenReceipt {
  readonly requestId: string;
  readonly accepted: boolean;
}

export type AppOverlayOpenReceiptCallback = (
  receipt: AppOverlayOpenReceipt,
) => void;

export interface AppOverlayEventCommands {
  openUpdate(
    pending: Extract<ActiveEventOverlay, { kind: "update" }>["pending"],
    onReceipt?: AppOverlayOpenReceiptCallback,
  ): string;
  openDuplicate(
    pending: Extract<ActiveEventOverlay, { kind: "duplicate" }>["pending"],
  ): string;
  openUrlUpdate(
    eventName: string,
    onReceipt?: AppOverlayOpenReceiptCallback,
  ): string;
  openRename(eventName: string): string;
  openExport(eventName: string): string;
  close(requestId?: string): void;
  confirm(requestId?: string): void;
}

export interface AppOverlayBackupCommands {
  openRestore(
    backup: RestoreOverlay["backup"],
    xlsxCompletion: RestoreOverlay["xlsxCompletion"],
    onReceipt?: AppOverlayOpenReceiptCallback,
  ): string;
  close(requestId?: string): void;
  confirm(requestId?: string): void;
}

export interface AppOverlayMapImportCommands {
  open(file: ImportOverlay["file"], eventName: string): string;
  requestReimport(preparedImport: ReimportOverlay["preparedImport"]): void;
  closeDialog(): void;
  cancelReimport(): void;
  confirmReimport(): void;
}

export interface AppOverlayMapEditorCommands {
  openBlockDefinition(
    pendingSelection: BlockDefinitionOverlay["pendingSelection"],
    session?: MapEditorSession,
  ): string;
  openSimpleHallDefinition(session?: MapEditorSession): string;
  openGlobalHallOrder(): string;
  openHallDefinition(
    pendingSelection: HallDefinitionOverlay["pendingSelection"],
    session?: MapEditorSession,
  ): string;
  startCellSelection(selection: CellSelectionOverlay["selection"]): void;
  clearPendingCellSelection(): void;
  toggleCellSelection(
    cell: CellSelectionOverlay["selection"]["clickedCells"][number],
  ): void;
  finishCellSelection(
    pendingSelection: BlockDefinitionOverlay["pendingSelection"],
  ): void;
  startVertexSelection(selection: VertexSelectionOverlay["selection"]): void;
  clearPendingVertexSelection(): void;
  toggleVertexSelection(
    vertex: VertexSelectionOverlay["selection"]["clickedVertices"][number],
  ): void;
  finishVertexSelection(
    pendingSelection: HallDefinitionOverlay["pendingSelection"],
  ): void;
  close(): void;
}

export interface AppOverlayVisitListCommands {
  open(mapTab: string, originalOrder: readonly string[]): string;
  setUnsaved(hasUnsavedChanges: boolean): void;
  requestConfirmClose(pendingTabChange: string | null): void;
  closePanel(): void;
  endSession(): void;
  confirmClose(): void;
  discardClose(): void;
}

export interface AppOverlayStatusCommands {
  startXlsxOperation(activity: XlsxOperationOverlayActivity): string;
  updateXlsxOperation(
    requestId: string,
    activity: XlsxOperationOverlayActivity,
  ): void;
  clearXlsxOperation(requestId: string): void;
  showSmartInsertToast(message: string, tone: "success" | "error"): string;
  clearSmartInsertToast(requestId: string): void;
}

export interface AppOverlayCommands {
  readonly item: AppOverlayItemCommands;
  readonly event: AppOverlayEventCommands;
  readonly backup: AppOverlayBackupCommands;
  readonly mapImport: AppOverlayMapImportCommands;
  readonly mapEditor: AppOverlayMapEditorCommands;
  readonly visitList: AppOverlayVisitListCommands;
  readonly status: AppOverlayStatusCommands;
}

export interface AppOverlayController {
  readonly state: AppOverlayState;
  readonly readModel: AppOverlayReadModel;
  readonly activeKinds: readonly ActiveAppOverlayKind[];
  readonly hasBlockingOverlay: boolean;
  readonly concurrentStatus: ConcurrentOverlayStatus;
  readonly commands: AppOverlayCommands;
}

export interface AppOverlayControllerOptions {
  readonly initialState?: AppOverlayState;
  readonly createRequestId?: () => string;
}

const isExpectedConcurrentTransition = (
  error: unknown,
): error is AppOverlayInvariantError =>
  error instanceof AppOverlayInvariantError &&
  (error.code.includes(".stale") || error.code.endsWith(".busy"));

/**
 * The domain reducer remains strict for tests and command code. The production
 * controller treats a callback from an obsolete render as a rejected no-op so
 * it cannot close or mutate the replacement overlay that won the race.
 */
export const reduceAppOverlayControllerState = (
  state: AppOverlayState,
  action: AppOverlayAction,
): AppOverlayState => {
  try {
    return reduceAppOverlayState(state, action);
  } catch (error) {
    if (isExpectedConcurrentTransition(error)) return state;
    throw error;
  }
};

type AppOverlayControllerReducerState = Readonly<{
  overlays: AppOverlayState;
  openReceipts: readonly AppOverlayOpenReceipt[];
}>;

type AppOverlayControllerAction =
  | AppOverlayAction
  | Readonly<{
      type: "controller/consume-open-receipts";
      requestIds: readonly string[];
    }>
  | Readonly<{
      type: "controller/close-event";
      requestId: string;
    }>
  | Readonly<{
      type: "controller/confirm-event";
      requestId: string;
    }>;

/** Keep receipt decisions in the same pure transition that applies each open. */
const reduceControllerWithReceipts = (
  state: AppOverlayControllerReducerState,
  action: AppOverlayControllerAction,
): AppOverlayControllerReducerState => {
  if (action.type === "controller/consume-open-receipts") {
    const consumed = new Set(action.requestIds);
    const openReceipts = state.openReceipts.filter(
      (receipt) => !consumed.has(receipt.requestId),
    );
    return openReceipts.length === state.openReceipts.length
      ? state
      : { ...state, openReceipts };
  }
  if (
    action.type === "controller/close-event" ||
    action.type === "controller/confirm-event"
  ) {
    const current = state.overlays.event;
    if (current.kind === "inactive" || current.requestId !== action.requestId) {
      return state;
    }
    return {
      ...state,
      overlays: reduceAppOverlayControllerState(state.overlays, {
        type:
          action.type === "controller/close-event"
            ? "event/close"
            : "event/confirm",
        requestId: action.requestId,
        expectedKind: current.kind,
      }),
    };
  }
  const overlays = reduceAppOverlayControllerState(state.overlays, action);
  if (
    action.type === "event/open-update" ||
    action.type === "event/open-url-update" ||
    action.type === "backup/open-restore"
  ) {
    const expectedKind =
      action.type === "event/open-update" ? "update" : "url-update";
    const accepted =
      action.type === "backup/open-restore"
        ? overlays.backup.kind === "restore" &&
          overlays.backup.requestId === action.requestId
        : overlays.event.kind === expectedKind &&
          overlays.event.requestId === action.requestId;
    return {
      overlays,
      openReceipts: [
        ...state.openReceipts,
        { requestId: action.requestId, accepted },
      ],
    };
  }
  return overlays === state.overlays ? state : { ...state, overlays };
};

const requireGeneratedRequestId = (requestId: unknown): string => {
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new AppOverlayInvariantError(
      "overlay.controller.request-id",
      "Overlay request ID factory must return a non-empty string.",
    );
  }
  return requestId;
};

export const useAppOverlayController = (
  options: AppOverlayControllerOptions = {},
): AppOverlayController => {
  const { createRequestId, initialState } = options;
  const localRequestSequence = useRef(0);
  const receiptCallbacks = useRef(
    new Map<string, AppOverlayOpenReceiptCallback>(),
  );
  const [controllerState, dispatch] = useReducer(
    reduceControllerWithReceipts,
    initialState,
    (seed): AppOverlayControllerReducerState => {
      const selected = seed ?? createInitialAppOverlayState();
      assertAppOverlayState(selected);
      return { overlays: selected, openReceipts: [] };
    },
  );
  const state = controllerState.overlays;

  useEffect(() => {
    const receipts = controllerState.openReceipts;
    if (receipts.length === 0) return;
    dispatch({
      type: "controller/consume-open-receipts",
      requestIds: receipts.map((receipt) => receipt.requestId),
    });
    for (const receipt of receipts) {
      const callback = receiptCallbacks.current.get(receipt.requestId);
      // Delete before delivery: StrictMode and reentrant commands cannot replay it.
      receiptCallbacks.current.delete(receipt.requestId);
      callback?.(receipt);
    }
  }, [controllerState.openReceipts]);

  useEffect(() => {
    const toast = state.concurrentStatus.smartInsertToast;
    if (!toast) return;
    const timer = window.setTimeout(() => {
      dispatch({
        type: "status/clear-smart-insert-toast",
        requestId: toast.requestId,
      });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [state.concurrentStatus.smartInsertToast]);

  const nextRequestId = useCallback((): string => {
    const requestId = createRequestId
      ? createRequestId()
      : `app-overlay-${++localRequestSequence.current}`;
    return requireGeneratedRequestId(requestId);
  }, [createRequestId]);

  const itemCommands = useMemo<AppOverlayItemCommands>(
    () => ({
      openEdit: (item) => {
        const requestId = nextRequestId();
        dispatch({ type: "item/open-edit", requestId, item });
        return requestId;
      },
      openDelete: (item) => {
        const requestId = nextRequestId();
        dispatch({ type: "item/open-delete", requestId, item });
        return requestId;
      },
      close: () => {
        if (state.item.kind === "inactive") return;
        dispatch({
          type: "item/close",
          requestId: state.item.requestId,
          expectedKind: state.item.kind,
        });
      },
      confirm: () => {
        if (state.item.kind === "inactive") return;
        dispatch({
          type: "item/confirm",
          requestId: state.item.requestId,
          expectedKind: state.item.kind,
        });
      },
    }),
    [nextRequestId, state.item],
  );

  const eventCommands = useMemo<AppOverlayEventCommands>(
    () => ({
      openUpdate: (pending, onReceipt) => {
        const requestId = nextRequestId();
        if (onReceipt) receiptCallbacks.current.set(requestId, onReceipt);
        dispatch({ type: "event/open-update", requestId, pending });
        return requestId;
      },
      openDuplicate: (pending) => {
        const requestId = nextRequestId();
        dispatch({ type: "event/open-duplicate", requestId, pending });
        return requestId;
      },
      openUrlUpdate: (eventName, onReceipt) => {
        const requestId = nextRequestId();
        if (onReceipt) receiptCallbacks.current.set(requestId, onReceipt);
        dispatch({ type: "event/open-url-update", requestId, eventName });
        return requestId;
      },
      openRename: (eventName) => {
        const requestId = nextRequestId();
        dispatch({ type: "event/open-rename", requestId, eventName });
        return requestId;
      },
      openExport: (eventName) => {
        const requestId = nextRequestId();
        dispatch({ type: "event/open-export", requestId, eventName });
        return requestId;
      },
      close: (requestId) => {
        if (requestId !== undefined) {
          dispatch({ type: "controller/close-event", requestId });
          return;
        }
        if (state.event.kind === "inactive") return;
        dispatch({
          type: "event/close",
          requestId: state.event.requestId,
          expectedKind: state.event.kind,
        });
      },
      confirm: (requestId) => {
        if (requestId !== undefined) {
          dispatch({ type: "controller/confirm-event", requestId });
          return;
        }
        if (state.event.kind === "inactive") return;
        dispatch({
          type: "event/confirm",
          requestId: state.event.requestId,
          expectedKind: state.event.kind,
        });
      },
    }),
    [nextRequestId, state.event],
  );

  const backupCommands = useMemo<AppOverlayBackupCommands>(
    () => ({
      openRestore: (backup, xlsxCompletion, onReceipt) => {
        const requestId = nextRequestId();
        if (onReceipt) receiptCallbacks.current.set(requestId, onReceipt);
        dispatch({
          type: "backup/open-restore",
          requestId,
          backup,
          xlsxCompletion,
        });
        return requestId;
      },
      close: (requestId) => {
        if (
          state.backup.kind !== "restore" ||
          (requestId !== undefined && state.backup.requestId !== requestId)
        )
          return;
        dispatch({ type: "backup/close", requestId: state.backup.requestId });
      },
      confirm: (requestId) => {
        if (
          state.backup.kind !== "restore" ||
          (requestId !== undefined && state.backup.requestId !== requestId)
        )
          return;
        dispatch({ type: "backup/confirm", requestId: state.backup.requestId });
      },
    }),
    [nextRequestId, state.backup],
  );

  const mapImportCommands = useMemo<AppOverlayMapImportCommands>(
    () => ({
      open: (file, eventName) => {
        const requestId = nextRequestId();
        dispatch({ type: "map-import/open", requestId, file, eventName });
        return requestId;
      },
      requestReimport: (preparedImport) => {
        if (state.mapImport.kind !== "import") return;
        dispatch({
          type: "map-import/request-reimport",
          requestId: state.mapImport.requestId,
          preparedImport,
        });
      },
      closeDialog: () => {
        if (state.mapImport.kind !== "import") return;
        dispatch({
          type: "map-import/close-dialog",
          requestId: state.mapImport.requestId,
        });
      },
      cancelReimport: () => {
        if (state.mapImport.kind !== "reimport") return;
        dispatch({
          type: "map-import/cancel-reimport",
          requestId: state.mapImport.requestId,
        });
      },
      confirmReimport: () => {
        if (state.mapImport.kind !== "reimport") return;
        dispatch({
          type: "map-import/confirm-reimport",
          requestId: state.mapImport.requestId,
        });
      },
    }),
    [nextRequestId, state.mapImport],
  );

  const mapEditorCommands = useMemo<AppOverlayMapEditorCommands>(
    () => ({
      openBlockDefinition: (pendingSelection, session) => {
        const requestId = nextRequestId();
        dispatch({
          type: "map-editor/open-block-definition",
          ...(session ? { session } : {}),
          requestId,
          pendingSelection,
        });
        return requestId;
      },
      openSimpleHallDefinition: (session) => {
        const requestId = nextRequestId();
        dispatch({
          type: "map-editor/open-simple-hall-definition",
          ...(session ? { session } : {}),
          requestId,
        });
        return requestId;
      },
      openGlobalHallOrder: () => {
        const requestId = nextRequestId();
        dispatch({ type: "map-editor/open-global-hall-order", requestId });
        return requestId;
      },
      openHallDefinition: (pendingSelection, session) => {
        const requestId = nextRequestId();
        dispatch({
          type: "map-editor/open-hall-definition",
          ...(session ? { session } : {}),
          requestId,
          pendingSelection,
        });
        return requestId;
      },
      startCellSelection: (selection) => {
        if (state.mapEditor.kind !== "block-definition") return;
        dispatch({
          type: "map-editor/start-cell-selection",
          requestId: state.mapEditor.requestId,
          selection,
        });
      },
      clearPendingCellSelection: () => {
        if (state.mapEditor.kind !== "block-definition") return;
        dispatch({
          type: "map-editor/clear-pending-cell-selection",
          requestId: state.mapEditor.requestId,
        });
      },
      toggleCellSelection: (cell) => {
        if (state.mapEditor.kind !== "cell-selection") return;
        dispatch({
          type: "map-editor/toggle-cell",
          requestId: state.mapEditor.requestId,
          cell,
        });
      },
      finishCellSelection: (pendingSelection) => {
        if (state.mapEditor.kind !== "cell-selection") return;
        dispatch({
          type: "map-editor/finish-cell-selection",
          requestId: state.mapEditor.requestId,
          pendingSelection,
        });
      },
      startVertexSelection: (selection) => {
        if (state.mapEditor.kind !== "hall-definition") return;
        dispatch({
          type: "map-editor/start-vertex-selection",
          requestId: state.mapEditor.requestId,
          selection,
        });
      },
      clearPendingVertexSelection: () => {
        if (state.mapEditor.kind !== "hall-definition") return;
        dispatch({
          type: "map-editor/clear-pending-vertex-selection",
          requestId: state.mapEditor.requestId,
        });
      },
      toggleVertexSelection: (vertex) => {
        if (state.mapEditor.kind !== "vertex-selection") return;
        dispatch({
          type: "map-editor/toggle-vertex",
          requestId: state.mapEditor.requestId,
          vertex,
        });
      },
      finishVertexSelection: (pendingSelection) => {
        if (state.mapEditor.kind !== "vertex-selection") return;
        dispatch({
          type: "map-editor/finish-vertex-selection",
          requestId: state.mapEditor.requestId,
          pendingSelection,
        });
      },
      close: () => {
        if (state.mapEditor.kind === "inactive") return;
        dispatch({
          type: "map-editor/close",
          requestId: state.mapEditor.requestId,
          expectedKind: state.mapEditor.kind,
        });
      },
    }),
    [nextRequestId, state.mapEditor],
  );

  const visitListCommands = useMemo<AppOverlayVisitListCommands>(
    () => ({
      open: (mapTab, originalOrder) => {
        const requestId = nextRequestId();
        dispatch({
          type: "visit-list/open",
          requestId,
          mapTab,
          originalOrder,
        });
        return requestId;
      },
      setUnsaved: (hasUnsavedChanges) => {
        if (state.visitList.kind !== "panel") return;
        dispatch({
          type: "visit-list/set-unsaved",
          requestId: state.visitList.requestId,
          hasUnsavedChanges,
        });
      },
      requestConfirmClose: (pendingTabChange) => {
        if (
          state.visitList.kind !== "panel" ||
          !state.visitList.hasUnsavedChanges
        ) {
          return;
        }
        dispatch({
          type: "visit-list/request-confirm-close",
          requestId: state.visitList.requestId,
          pendingTabChange,
        });
      },
      endSession: () => {
        if (state.visitList.kind === "inactive") return;
        dispatch({
          type:
            state.visitList.kind === "confirm-close"
              ? "visit-list/discard-close"
              : "visit-list/close-panel",
          requestId: state.visitList.requestId,
        });
      },
      closePanel: () => {
        if (state.visitList.kind !== "panel") return;
        dispatch({
          type: "visit-list/close-panel",
          requestId: state.visitList.requestId,
        });
      },
      confirmClose: () => {
        if (state.visitList.kind !== "confirm-close") return;
        dispatch({
          type: "visit-list/confirm-close",
          requestId: state.visitList.requestId,
        });
      },
      discardClose: () => {
        if (state.visitList.kind !== "confirm-close") return;
        dispatch({
          type: "visit-list/discard-close",
          requestId: state.visitList.requestId,
        });
      },
    }),
    [nextRequestId, state.visitList],
  );

  const statusCommands = useMemo<AppOverlayStatusCommands>(
    () => ({
      startXlsxOperation: (activity) => {
        const requestId = nextRequestId();
        dispatch({ type: "status/set-xlsx-operation", requestId, activity });
        return requestId;
      },
      updateXlsxOperation: (requestId, activity) => {
        dispatch({
          type: "status/update-xlsx-operation",
          requestId,
          activity,
        });
      },
      clearXlsxOperation: (requestId) => {
        dispatch({
          type: "status/clear-xlsx-operation",
          requestId,
        });
      },
      showSmartInsertToast: (message, tone) => {
        const requestId = nextRequestId();
        dispatch({
          type: "status/show-smart-insert-toast",
          requestId,
          message,
          tone,
        });
        return requestId;
      },
      clearSmartInsertToast: (requestId) => {
        dispatch({
          type: "status/clear-smart-insert-toast",
          requestId,
        });
      },
    }),
    [nextRequestId],
  );

  const commands = useMemo<AppOverlayCommands>(
    () => ({
      item: itemCommands,
      event: eventCommands,
      backup: backupCommands,
      mapImport: mapImportCommands,
      mapEditor: mapEditorCommands,
      visitList: visitListCommands,
      status: statusCommands,
    }),
    [
      backupCommands,
      eventCommands,
      itemCommands,
      mapEditorCommands,
      mapImportCommands,
      statusCommands,
      visitListCommands,
    ],
  );

  const readModel = useMemo(() => selectAppOverlayReadModel(state), [state]);
  const activeKinds = useMemo(
    () => selectActiveAppOverlayKinds(state),
    [state],
  );
  const hasBlockingOverlay = useMemo(
    () => selectHasBlockingAppOverlay(state),
    [state],
  );
  const concurrentStatus = useMemo(
    () => selectConcurrentOverlayStatus(state),
    [state],
  );

  return useMemo(
    () => ({
      state,
      readModel,
      activeKinds,
      hasBlockingOverlay,
      concurrentStatus,
      commands,
    }),
    [
      activeKinds,
      commands,
      concurrentStatus,
      hasBlockingOverlay,
      readModel,
      state,
    ],
  );
};
