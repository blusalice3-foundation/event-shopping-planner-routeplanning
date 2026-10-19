import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
import type { PersistenceCommandPort } from "../app/ports/PersistenceCommandPort";
import {
  emptyApplicationSnapshot,
  useApplicationSnapshot,
} from "../app/state/useApplicationSnapshot";
import { analyzeDuplicateEventImport } from "../features/events/duplicateEvent";
import {
  createInitialAppOverlayState,
  selectAppOverlayReadModel,
} from "../app/state/appOverlayState";
import AppOverlayLayer from "../features/app-shell/components/AppOverlayLayer";
import type { XlsxExecutionPort } from "../xlsx/port/XlsxExecutionPort";
import EventListScreen from "./EventListScreen";
import EventRenameDialog from "./EventRenameDialog";
import ExportOptionsDialog from "./ExportOptionsDialog";
import UpdateConfirmationModal from "./UpdateConfirmationModal";
import UrlUpdateDialog from "./UrlUpdateDialog";
import BlockDefinitionPanel from "./map/BlockDefinitionPanel";
import MapImportDialog from "./map/MapImportDialog";
import { buildExecutionNavigatorEntries } from "../features/space-navigation/domain/buildNavigatorEntries";
import { SpaceNavigatorActionDialog } from "../features/space-navigation/components/SpaceNavigatorActionDialog";
import { SpaceNavigatorPicker } from "../features/space-navigation/components/SpaceNavigatorPicker";
import { createEventConsistency } from "../types/consistency";
import type { ShoppingItem } from "../types/item";
import { requestModalSafeFocus } from "../utils/modalFocusBoundary";
import DeleteConfirmationModal from "./DeleteConfirmationModal";
import DuplicateEventDialog from "./DuplicateEventDialog";
import { LegacyConsistencyReview } from "./LegacyConsistencyReview";
import LimitedPurchaseConfirmDialog from "./LimitedPurchaseConfirmDialog";
import PostEventDistributionCheckDialog from "./PostEventDistributionCheckDialog";
import SingleQuantityLimitedPurchaseChoiceDialog from "./SingleQuantityLimitedPurchaseChoiceDialog";
import {
  AddItemDialogView,
  CellItemPopup,
  PhaseChangeDialogView,
} from "./focus/FocusModeDialogs";
import { ResumeChoiceDialogView } from "./focus/FocusModeStateViews";
import InsertPositionDialog from "./map/InsertPositionDialog";
import MapReimportConfirmationDialog from "./map/MapReimportConfirmationDialog";

const item: ShoppingItem = {
  id: "item",
  circle: "サークル",
  title: "新刊",
  eventDate: "1日目",
  block: "A",
  number: "1",
  price: 500,
  quantity: 1,
  remarks: "",
  purchaseStatus: "None",
};
const noop = () => {};
const addForm = {
  circle: "",
  title: "",
  price: "",
  quantity: "1",
  remarks: "",
  url: "",
  purchaseStatus: "Purchased" as const,
};
const addDialog = (
  <AddItemDialogView
    dialog={{ isOpen: true, eventDate: "1日目", block: "A", number: "1" }}
    form={addForm}
    setDialog={noop}
    setForm={noop}
    currentVisit={undefined}
    priceOptions={[]}
    onPriceInputChange={noop}
    onPriceSelectChange={noop}
    onClose={noop}
    onSubmit={noop}
  />
);
const phaseDialog = (
  <PhaseChangeDialogView
    dialog={{
      isOpen: true,
      targetPhase: "postponed",
      hasSavedIndex: false,
      savedIndex: 0,
    }}
    visitsByPhase={{
      normal: [],
      postponed: [{ key: "A-1", items: [item] }],
      late: [],
    }}
    onStart={noop}
    onSaved={noop}
    onCancel={noop}
  />
);
const popup = (
  <CellItemPopup
    state={{ isOpen: true, blockName: "A", number: 1, items: [item] }}
    canAddItem
    onAddItem={noop}
    onClose={noop}
  />
);
const entries = buildExecutionNavigatorEntries([item]);
const snapshot = {
  ...emptyApplicationSnapshot(),
  eventLists: { event: [item] },
};
snapshot.eventConsistency.event = {
  ...createEventConsistency(),
  legacyPending: [
    {
      sourceKey: "old",
      sourceDayKey: "1日目",
      sourceMapKey: null,
      reason: "ambiguous-source",
      payload: { kind: "manual-hall", itemId: item.id, manualHallId: "hall" },
    },
  ],
};
const duplicateAnalysis = analyzeDuplicateEventImport({
  eventName: "event",
  incomingItems: [item],
  incomingSource: {
    url: "https://docs.google.com/spreadsheets/d/new/edit",
    sheetName: "",
  },
  eventLists: { event: [item] },
  eventMetadata: {},
});

if (duplicateAnalysis.kind === "create") {
  throw new Error("Expected an existing event conflict");
}

const emptyMap = {
  maxRow: 1,
  maxCol: 1,
  cells: [],
  mergedCells: [],
  blocks: [],
};
const mapFile = new File(["map"], "map.xlsx");
const xlsxExecutionPort = {
  importWorkbook: vi.fn(),
  exportWorkbook: vi.fn(),
} as XlsxExecutionPort;
const visitConfirmationProps = {
  overlay: {
    ...selectAppOverlayReadModel(createInitialAppOverlayState()),
    showVisitListConfirmDialog: true,
  },
  overlayCommands: { item: {}, event: {}, mapEditor: {} },
  model: {
    item: { items: [] },
    event: {},
    mapEditor: {},
    visitList: {},
    imports: {},
    list: {},
  },
  actions: {
    item: {},
    event: {},
    mapEditor: {},
    visitList: {
      handleVisitListDialogCancel: noop,
      handleVisitListDialogConfirm: noop,
    },
    imports: { xlsxExecutionPort },
    list: {},
  },
} as unknown as ComponentProps<typeof AppOverlayLayer>;
const newlyRegisteredModals = [
  {
    name: "URL update",
    content: (
      <UrlUpdateDialog
        currentUrl="https://docs.google.com/spreadsheets/d/current/edit"
        onConfirm={noop}
        onCancel={noop}
      />
    ),
  },
  {
    name: "event rename",
    content: (
      <EventRenameDialog currentName="event" onConfirm={noop} onCancel={noop} />
    ),
  },
  {
    name: "export options",
    content: (
      <ExportOptionsDialog isOpen hasMapData onExport={noop} onClose={noop} />
    ),
  },
  ...[false, true].map((isSaving) => ({
    name: `update confirmation (saving: ${isSaving})`,
    content: (
      <UpdateConfirmationModal
        isSaving={isSaving}
        itemsToDelete={[]}
        itemsToUpdate={[]}
        itemsToAdd={[]}
        onConfirm={noop}
        onCancel={noop}
      />
    ),
  })),
  {
    name: "block definition",
    content: (
      <BlockDefinitionPanel
        isOpen
        mapData={emptyMap}
        onClose={noop}
        onUpdateBlocks={noop}
        onStartCellSelection={noop}
      />
    ),
  },
  ...[false, true].map((requestPending) => ({
    name: `map import (saving: ${requestPending})`,
    content: (
      <MapImportDialog
        isOpen
        file={mapFile}
        eventName="event"
        savedSettings={null}
        requestPending={requestPending}
        canCancel={!requestPending}
        onClose={noop}
        onImport={noop}
        xlsxExecutionPort={xlsxExecutionPort}
      />
    ),
  })),
  {
    name: "visit list close confirmation",
    content: <AppOverlayLayer {...visitConfirmationProps} />,
  },
];
const legacyModals: {
  name: string;
  content: ReactNode;
  open?: () => Promise<void>;
}[] = [
  ...newlyRegisteredModals,
  { name: "cell popup", content: popup },
  {
    name: "delete",
    content: (
      <DeleteConfirmationModal item={item} onConfirm={noop} onCancel={noop} />
    ),
  },
  {
    name: "duplicate event",
    content: (
      <DuplicateEventDialog
        analysis={duplicateAnalysis}
        existingEventNames={["event"]}
        onResolve={noop}
        onCancel={noop}
      />
    ),
  },
  {
    name: "legacy consistency",
    content: (
      <LegacyConsistencyReview
        snapshot={snapshot}
        eventName="event"
        resolve={async () => {}}
      />
    ),
    open: async () => {
      await userEvent.click(
        screen.getByRole("button", { name: "確認待ち設定を開く" }),
      );
    },
  },
  {
    name: "limited confirmation",
    content: (
      <LimitedPurchaseConfirmDialog
        isOpen
        title="購入確認"
        message="確認"
        cancelLabel="戻る"
        confirmLabel="保存"
        initialFocus="confirm"
        onCancel={noop}
        onConfirm={noop}
      />
    ),
  },
  {
    name: "single quantity",
    content: (
      <SingleQuantityLimitedPurchaseChoiceDialog
        isOpen
        onPurchased={noop}
        onLimited={noop}
        onCancel={noop}
      />
    ),
  },
  {
    name: "post event",
    content: (
      <PostEventDistributionCheckDialog
        open
        mode="single"
        targets={[item]}
        onCancel={noop}
        onApply={noop}
      />
    ),
  },
  {
    name: "resume",
    content: (
      <ResumeChoiceDialogView
        dialog={{
          isOpen: true,
          lastSpaceLabel: "A-1",
          lastPhase: "normal",
          lastIndex: 0,
          pointerPhase: "normal",
          pointerIndex: 0,
          phaseStartPhase: "normal",
          lastChangeEnabled: true,
          phaseStartEnabled: true,
          normalStartEnabled: true,
          wasCompleted: false,
        }}
        onChoice={noop}
      />
    ),
  },
  {
    name: "insert position",
    content: (
      <InsertPositionDialog
        isOpen
        addingItem={item}
        nearbyVisitItems={[]}
        hasHallDefinition={false}
        onSelect={noop}
        onCancel={noop}
      />
    ),
  },
  {
    name: "map reimport",
    content: (
      <MapReimportConfirmationDialog
        isOpen
        plan={{
          eventName: "event",
          targets: [],
          impact: {
            targetDayCount: 0,
            visitPointCount: 0,
            mapHallDefinitionCount: 0,
            manualAssignmentCount: 0,
            hallRouteDayCount: 0,
            viewportDayCount: 0,
            rotationDayCount: 0,
            maplessHallDefinitionCount: 0,
            maplessManualAssignmentCount: 0,
            maplessHallRouteDayCount: 0,
          },
          requiresConfirmation: true,
        }}
        onCancel={noop}
        onConfirm={noop}
      />
    ),
  },
  {
    name: "navigator picker",
    content: (
      <SpaceNavigatorPicker
        entries={entries}
        candidateIndex={0}
        layoutMode="pc"
        side="left"
        onCandidateChange={noop}
        onSelect={noop}
        onClose={noop}
      />
    ),
  },
  {
    name: "navigator action",
    content: (
      <SpaceNavigatorActionDialog
        entry={entries[0]}
        result={null}
        pendingIntent={null}
        busy={false}
        onChoose={noop}
        onCancel={noop}
      />
    ),
  },
];

describe("save failure focus ownership for existing dialogs", () => {
  it.each(legacyModals)(
    "defers background retry until the $name dialog closes",
    async ({ content, open }) => {
      const retry = vi.fn();
      function Host({ show }: { show: boolean }) {
        return (
          <>
            <button onClick={retry}>再試行</button>
            {show && content}
          </>
        );
      }
      const view = render(<Host show={false} />);
      const retryButton = screen.getByRole("button", { name: "再試行" });
      retryButton.focus();
      view.rerender(<Host show />);
      await open?.();
      const dialog = screen.getByRole("dialog");
      await waitFor(() =>
        expect(dialog.contains(document.activeElement)).toBe(true),
      );
      act(() =>
        requestModalSafeFocus(
          () => retryButton,
          () => true,
        ),
      );
      expect(dialog.contains(document.activeElement)).toBe(true);
      const user = userEvent.setup();
      await user.keyboard("{Enter}");
      expect(retry).not.toHaveBeenCalled();
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
      await user.keyboard("{Enter}");
      expect(retry).not.toHaveBeenCalled();
      view.rerender(<Host show={false} />);
      await waitFor(() => expect(retryButton).toHaveFocus());
    },
  );

  it("keeps existing passive initial focus and restores its opener", async () => {
    function Host({ show }: { show: boolean }) {
      return (
        <>
          <button>起点</button>
          {show && (
            <SingleQuantityLimitedPurchaseChoiceDialog
              isOpen
              onPurchased={noop}
              onLimited={noop}
              onCancel={noop}
            />
          )}
        </>
      );
    }
    const view = render(<Host show={false} />);
    const opener = screen.getByRole("button", { name: "起点" });
    opener.focus();
    view.rerender(<Host show />);
    const purchased = screen.getByRole("button", { name: "購入済" });
    await waitFor(() => expect(purchased).toHaveFocus());
    view.rerender(<Host show={false} />);
    expect(opener).toHaveFocus();
  });

  it.each([false, true])(
    "restores the opener or pending retry after a dialog with no initial focus closes (resolved: %s)",
    async (resolved) => {
      let currentFailure = true;
      const retry = vi.fn();
      function Host({ show }: { show: boolean }) {
        return (
          <>
            <button>起点</button>
            <button onClick={retry}>再試行</button>
            {show && (
              <DeleteConfirmationModal
                item={item}
                onConfirm={noop}
                onCancel={noop}
              />
            )}
          </>
        );
      }
      const view = render(<Host show={false} />);
      const opener = screen.getByRole("button", { name: "起点" });
      const retryButton = screen.getByRole("button", { name: "再試行" });
      opener.focus();
      view.rerender(<Host show />);
      const dialog = screen.getByRole("dialog");
      await waitFor(() => expect(dialog).toHaveFocus());
      act(() =>
        requestModalSafeFocus(
          () => retryButton,
          () => currentFailure,
        ),
      );
      await userEvent.keyboard("{Enter}");
      expect(retry).not.toHaveBeenCalled();
      if (resolved) currentFailure = false;
      view.rerender(<Host show={false} />);
      await waitFor(() =>
        expect(resolved ? opener : retryButton).toHaveFocus(),
      );
    },
  );

  it("waits for a registered legacy child and its common parent to close", async () => {
    function Host({ parent, child }: { parent: boolean; child: boolean }) {
      return (
        <>
          <button>再試行</button>
          {parent && addDialog}
          {child && (
            <DeleteConfirmationModal
              item={item}
              onConfirm={noop}
              onCancel={noop}
            />
          )}
        </>
      );
    }
    const view = render(<Host parent child={false} />);
    const parent = screen.getByRole("dialog", { name: "新規アイテム追加" });
    view.rerender(<Host parent child />);
    const child = screen.getByRole("dialog", { name: "アイテムを削除" });
    await waitFor(() =>
      expect(child.contains(document.activeElement)).toBe(true),
    );
    const retry = screen.getByRole("button", { name: "再試行" });
    act(() =>
      requestModalSafeFocus(
        () => retry,
        () => true,
      ),
    );
    view.rerender(<Host parent child={false} />);
    expect(parent.contains(document.activeElement)).toBe(true);
    view.rerender(<Host parent={false} child={false} />);
    await waitFor(() => expect(retry).toHaveFocus());
  });
});

function delayedFailureHarness(content: ReactNode) {
  let rejectSave!: (reason: unknown) => void;
  const commit = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
  const port = {
    readApplicationSnapshot: async () => ({
      snapshot: {
        ...emptyApplicationSnapshot(),
        eventLists: { event: [item] },
      },
      expectedRoots: {},
      consistencyMissing: false,
    }),
    commitApplicationSnapshotAtomically: commit,
    bindApplicationSettings: () => () => {},
  } as unknown as PersistenceCommandPort;
  let application!: ReturnType<typeof useApplicationSnapshot>;
  let hide!: () => void;
  function Host() {
    const app = useApplicationSnapshot(port, "event", "1日目");
    application = app;
    const retryRef = useRef<HTMLButtonElement>(null);
    const failuresRef = useRef(app.retryableFailures);
    failuresRef.current = app.retryableFailures;
    const [show, setShow] = useState(false);
    hide = () => setShow(false);
    useEffect(() => {
      const failures = app.retryableFailures;
      if (failures.length)
        requestModalSafeFocus(
          () => retryRef.current,
          () => failuresRef.current === failures && failures.length > 0,
        );
    }, [app.retryableFailures]);
    return (
      <>
        <button onClick={() => setShow(true)}>開く</button>
        {app.retryableFailures.length > 0 && (
          <button ref={retryRef} onClick={app.retryPending}>
            保留の再試行
          </button>
        )}
        {show && content}
      </>
    );
  }
  render(<Host />);
  return {
    app: () => application,
    commit,
    rejectSave: () => rejectSave(new DOMException("保存失敗", "AbortError")),
    hide: () => hide(),
  };
}

describe("late failure while dialogs are open", () => {
  it.each([
    ...newlyRegisteredModals,
    { name: "new item", content: addDialog },
    { name: "phase change", content: phaseDialog },
  ])(
    "retains focus and defers a late failure for $name",
    async ({ content }) => {
      const h = delayedFailureHarness(content);
      const user = userEvent.setup();
      act(() => h.app().setters.setDayModes({ event: { "1日目": "execute" } }));
      await waitFor(() => expect(h.commit).toHaveBeenCalledOnce());
      await user.click(screen.getByRole("button", { name: "開く" }));
      const dialog = screen.getByRole("dialog");
      await act(async () => h.rejectSave());
      const retry = await screen.findByRole("button", { name: "保留の再試行" });
      expect(dialog.contains(document.activeElement)).toBe(true);
      const enabledControls = within(dialog)
        .queryAllByRole("button")
        .filter((control) => !control.matches(":disabled"));
      if (enabledControls.length) {
        enabledControls.at(-1)!.focus();
        await user.tab();
        expect(dialog.contains(document.activeElement)).toBe(true);
        enabledControls[0].focus();
      }
      await user.tab({ shift: true });
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
      await user.keyboard("{Enter}");
      expect(h.commit).toHaveBeenCalledOnce();
      act(() => h.hide());
      await waitFor(() => expect(retry).toHaveFocus());
    },
  );

  it.each([{ name: "new item", content: addDialog }, ...newlyRegisteredModals])(
    "discards a resolved failure and restores the original opener for $name",
    async ({ content }) => {
      const h = delayedFailureHarness(content);
      const user = userEvent.setup();
      const opener = screen.getByRole("button", { name: "開く" });
      act(() => h.app().setters.setDayModes({ event: { "1日目": "execute" } }));
      await waitFor(() => expect(h.commit).toHaveBeenCalledOnce());
      await user.click(opener);
      await act(async () => h.rejectSave());
      await screen.findByRole("button", { name: "保留の再試行" });
      act(() => h.app().discardPending());
      const dialog = screen.getByRole("dialog");
      expect(dialog.contains(document.activeElement)).toBe(true);
      act(() => h.hide());
      await waitFor(() => expect(opener).toHaveFocus());
    },
  );
});

describe("dialog ownership handoff and busy recovery", () => {
  it("keeps a pending failure inside the event menu and its replacement URL dialog", async () => {
    function EventDialogs() {
      const [urlOpen, setUrlOpen] = useState(false);
      return (
        <>
          <EventListScreen
            eventNames={["event"]}
            onSelect={noop}
            onDelete={noop}
            onExport={noop}
            onUpdate={() => setUrlOpen(true)}
          />
          {urlOpen && (
            <UrlUpdateDialog
              currentUrl="https://docs.google.com/spreadsheets/d/current/edit"
              onConfirm={noop}
              onCancel={() => setUrlOpen(false)}
            />
          )}
        </>
      );
    }
    const h = delayedFailureHarness(<EventDialogs />);
    const user = userEvent.setup();
    act(() => h.app().setters.setDayModes({ event: { "1日目": "execute" } }));
    await waitFor(() => expect(h.commit).toHaveBeenCalledOnce());
    await user.click(screen.getByRole("button", { name: "開く" }));
    await user.click(screen.getByRole("button", { name: "メニュー" }));
    const menu = screen.getByRole("dialog", { name: "eventの操作" });
    await act(async () => h.rejectSave());
    const retry = await screen.findByRole("button", { name: "保留の再試行" });
    expect(menu.contains(document.activeElement)).toBe(true);
    await user.click(
      within(menu).getByRole("button", { name: /アイテム更新/ }),
    );
    const urlDialog = screen.getByRole("dialog", {
      name: "スプレッドシートURLを更新",
    });
    await waitFor(() =>
      expect(urlDialog.contains(document.activeElement)).toBe(true),
    );
    await user.keyboard("{Enter}");
    expect(h.commit).toHaveBeenCalledOnce();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(retry).toHaveFocus());
    expect(h.commit).toHaveBeenCalledOnce();
  });

  it("ignores Escape while the update is saving, then cancels once after recovery", async () => {
    const cancel = vi.fn();
    const props = {
      itemsToDelete: [],
      itemsToUpdate: [],
      itemsToAdd: [],
      onConfirm: vi.fn(),
      onCancel: cancel,
    };
    const view = render(<UpdateConfirmationModal {...props} />);
    const user = userEvent.setup();
    const confirm = screen.getByRole("button", { name: "更新を実行" });
    confirm.focus();
    view.rerender(<UpdateConfirmationModal {...props} isSaving />);
    await user.tab();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(
      true,
    );
    await user.keyboard("{Enter}{Escape}");
    expect(cancel).not.toHaveBeenCalled();
    expect(props.onConfirm).not.toHaveBeenCalled();
    view.rerender(<UpdateConfirmationModal {...props} />);
    await user.keyboard("{Escape}");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
