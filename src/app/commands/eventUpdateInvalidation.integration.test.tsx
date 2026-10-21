import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BulkImportResult } from "../../types/import";
import { createEventConsistency } from "../../types/consistency";
import type {
  DayModeState,
  EventMetadata,
  ExecuteModeItems,
  ShoppingItem,
} from "../../types/item";
import { sheetCsv, sheetItem } from "../../test/sheetImportOptionalUrlFixtures";
import { useAppOverlayController } from "../state/useAppOverlayController";
import {
  emptyApplicationSnapshot,
  useApplicationSnapshot,
} from "../state/useApplicationSnapshot";
import type {
  PersistenceCommandPort,
  PersistenceSnapshot,
} from "../ports/PersistenceCommandPort";
import type { ApplicationSnapshotGuard } from "./ApplicationSnapshotCommitPort";
import type { EventUpdateCommitState } from "../../features/events/updateFlow";
import { buildSameSourceUpdateResolution } from "../../features/events/duplicateEvent";
import { createEventUpdateInvalidationBoundary } from "./eventUpdateInvalidation";
import { createEventUpdateOperationRegistry } from "./eventUpdateOperation";
import { useEventUpdateCommands } from "./useEventUpdateCommands";
import { useShoppingItemMutationCommands } from "./useShoppingItemMutationCommands";

const EVENT = "更新対象";
const NEXT_EVENT = "後続の取込";
const SOURCE = {
  url: "https://docs.google.com/spreadsheets/d/source/edit",
  sheetName: "品目表",
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const response = () => ({ ok: true, text: async () => sheetCsv(1) });

function harness(review?: "conflict" | "day-merge") {
  const eventListsRef: { current: Record<string, ShoppingItem[]> } = {
    current: { [EVENT]: [sheetItem()], [NEXT_EVENT]: [sheetItem()] },
  };
  const eventMetadataRef: { current: Record<string, EventMetadata> } = {
    current: Object.fromEntries(
      [EVENT, NEXT_EVENT].map((eventName) => [
        eventName,
        {
          spreadsheetUrl: SOURCE.url,
          spreadsheetSheetName: SOURCE.sheetName,
          lastImportDate: "2026-10-17T00:00:00Z",
        },
      ]),
    ),
  };
  const executeModeItemsRef: {
    current: Record<string, ExecuteModeItems>;
  } = { current: {} };
  const eventUpdateOperationsRef = {
    current: createEventUpdateOperationRegistry(),
  };
  const eventUpdatePreviewEpochRef = { current: 0 };
  const pendingEventUpdateBaseItemsRef: { current: ShoppingItem[] | null } = {
    current: null,
  };
  const invalidateRef = { current: (_eventName: string) => {} };
  const invalidation = createEventUpdateInvalidationBoundary(invalidateRef);
  const commit = vi
    .fn<
      (
        next: EventUpdateCommitState,
        assertCurrent: ApplicationSnapshotGuard,
      ) => Promise<boolean>
    >()
    .mockResolvedValue(true);
  const dayModes: Record<string, DayModeState> =
    review === "day-merge"
      ? { [EVENT]: { "1日目": "edit", " 1日目　": "execute" } }
      : {};
  let durable: PersistenceSnapshot = {
    ...emptyApplicationSnapshot(),
    eventLists: structuredClone(eventListsRef.current),
    eventMetadata: structuredClone(eventMetadataRef.current),
    dayModes: structuredClone(dayModes),
    eventConsistency: {
      [EVENT]: createEventConsistency(),
      [NEXT_EVENT]: createEventConsistency(),
    },
  };
  const storageCommit = vi.fn(async (next: PersistenceSnapshot) => {
    durable = structuredClone(next);
  });
  const persistence = {
    readApplicationSnapshot: async () => ({
      snapshot: structuredClone(durable),
      expectedRoots: {},
      consistencyMissing: false,
    }),
    commitApplicationSnapshotAtomically: storageCommit,
    bindApplicationSettings: () => () => {},
  } as unknown as PersistenceCommandPort;
  const notify = vi.fn();
  const hook = renderHook(() => {
    const application = useApplicationSnapshot(persistence, EVENT, "1日目");
    const overlay = useAppOverlayController();
    if (review)
      commit.mockImplementation(async (next, assertCurrent) => {
        await application.commitPatch(
          next,
          undefined,
          { confirm: false },
          assertCurrent,
        );
        return true;
      });
    const mutations = useShoppingItemMutationCommands({
      state: {
        activeEventName: null,
        activeEventDate: "1日目",
        eventLists: eventListsRef.current,
        eventListsRef,
        eventMetadata: eventMetadataRef.current,
        dayModes: {},
        items: [],
        selectedItemIds: new Set(),
        selectedBlockFilters: new Set(),
        blockSortDirection: null,
        candidateNumberSortDirection: null,
        itemToDelete: null,
        executeModeItemsRef,
        spaceGroupDragItemIdsRef: { current: null },
        eventUpdatePreviewEpochRef,
        eventUpdateOperationsRef,
      },
      actions: {
        setEventLists: (updater) => {
          eventListsRef.current = updater(eventListsRef.current);
        },
        setEventMetadata: (updater) => {
          eventMetadataRef.current = updater(eventMetadataRef.current);
        },
        setDayModes: vi.fn(),
        updateExecuteModeItems: vi.fn(),
        setRecentlyChangedItemIds: vi.fn(),
        openDuplicateEvent: overlay.commands.event.openDuplicate,
        clearRangeSelection: vi.fn(),
        clearSelection: vi.fn(),
        removeSelectedItemIds: vi.fn(),
        queueShoppingMovePatch: vi.fn(() => ({
          status: "blocked" as const,
          reason: "unused",
        })),
        setSortState: vi.fn(),
        setBlockSortDirection: vi.fn(),
        setCandidateNumberSortDirection: vi.fn(),
        confirmItemDelete: vi.fn(),
        navigation: { openEvent: vi.fn(), showImport: vi.fn() },
      },
      selectors: {
        areItemsInSameHall: () => true,
        areItemsInSameHallGroup: () => true,
      },
      alerts: { notify },
      persistence: { commitApplicationSnapshotPatch: vi.fn(async () => {}) },
    });
    const updates = useEventUpdateCommands({
      state: {
        eventLists: eventListsRef.current,
        eventMetadata: eventMetadataRef.current,
        pendingDuplicateEvent: overlay.readModel.pendingDuplicateEvent,
        pendingEventUpdate: overlay.readModel.pendingEventUpdate,
        pendingUpdateEventName: overlay.readModel.pendingUpdateEventName,
        eventListsRef,
        eventMetadataRef,
        executeModeItemsRef,
        pendingEventUpdateBaseItemsRef,
        eventUpdatePreviewEpochRef,
        eventUpdateOperationsRef,
      },
      actions: {
        applyBulkAdd: mutations.applyBulkAdd,
        commitEventUpdateState: commit,
        openEventUpdate: overlay.commands.event.openUpdate,
        openUrlUpdate: overlay.commands.event.openUrlUpdate,
        closeEventOverlay: overlay.commands.event.close,
        confirmEventOverlay: overlay.commands.event.confirm,
      },
      effects: { notify, reportError: vi.fn() },
    });
    invalidateRef.current = updates.invalidateEventUpdateForEvent;
    application.handlers.current.applied = (_snapshot, eventNames) =>
      invalidation.applied(eventNames);
    return { overlay, mutations, updates, application };
  });
  act(() => {
    hook.result.current.application.hydrationSetters.setEventLists(
      eventListsRef.current,
    );
    hook.result.current.application.hydrationSetters.setEventMetadata(
      eventMetadataRef.current,
    );
    hook.result.current.application.hydrationSetters.setEventConsistency(
      durable.eventConsistency,
    );
    hook.result.current.application.hydrationSetters.setDayModes(
      structuredClone(dayModes),
    );
  });
  let inputCurrent = true;
  const startImport = (eventName = EVENT) =>
    hook.result.current.mutations.handleBulkAdd(eventName, [sheetItem()], {
      source: "spreadsheet",
      url: SOURCE.url,
      sheetName: SOURCE.sheetName,
      request: { id: `input:${eventName}`, isCurrent: () => inputCurrent },
    });
  const reviewImport = () => {
    const pending = hook.result.current.overlay.readModel.pendingDuplicateEvent;
    if (pending?.analysis.kind !== "same-source")
      throw new Error("Expected the same-source import review.");
    return hook.result.current.updates.handleDuplicateEventResolution(
      buildSameSourceUpdateResolution(pending.analysis),
    );
  };
  return {
    ...hook,
    invalidation,
    registry: eventUpdateOperationsRef.current,
    startImport,
    reviewImport,
    invalidateInput: () => {
      inputCurrent = false;
    },
    commit,
    storageCommit,
    prepareAuxiliaryReview: () => {
      if (review === "conflict")
        durable.eventLists[EVENT] = [
          { ...sheetItem(), title: "先行して保存された品目名" },
        ];
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("App event update invalidation boundary", () => {
  it.each(["selection", "loading", "url", "confirmation"] as const)(
    "%s: snapshot application and delete/rename finish the owning import only once",
    async (phase) => {
      const fetchResult = deferred<ReturnType<typeof response>>();
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          phase === "url"
            ? Promise.reject(new Error("取得を再試行してください"))
            : phase === "loading"
              ? fetchResult.promise
              : Promise.resolve(response()),
        ),
      );
      const h = harness();
      const completion = vi.fn();
      let importResult!: Promise<BulkImportResult>;
      let acquisition: Promise<void> | undefined;
      act(() => {
        importResult = h.startImport();
        void importResult.then(completion);
      });
      expect(h.result.current.overlay.state.event.kind).toBe("duplicate");
      if (phase !== "selection") {
        await act(async () => {
          acquisition = h.reviewImport();
          if (phase !== "loading") await acquisition;
        });
      }
      expect(h.registry.current?.phase).toBe(phase);

      await act(async () => {
        h.invalidation.applied(["無関係なイベント"]);
        expect(completion).not.toHaveBeenCalled();
        h.invalidation.applied([EVENT]);
        h.invalidation.closeEventUpdateForEvent(EVENT);
        h.invalidation.applied([EVENT]);
        await importResult;
      });

      expect(completion).toHaveBeenCalledExactlyOnceWith({
        status: "invalidated",
      });
      expect(h.registry.current).toBeNull();
      expect(h.result.current.overlay.state.event.kind).toBe("inactive");
      const nextCompletion = vi.fn();
      let nextResult!: Promise<BulkImportResult>;
      act(() => {
        nextResult = h.startImport(NEXT_EVENT);
        void nextResult.then(nextCompletion);
      });
      const nextRequest = h.result.current.overlay.state.event;
      expect(nextRequest.kind).toBe("duplicate");
      if (phase === "loading") {
        await act(async () => {
          fetchResult.resolve(response());
          await acquisition;
        });
      }
      act(() => h.invalidation.closeEventUpdateForEvent(EVENT));
      expect(h.result.current.overlay.state.event).toBe(nextRequest);
      expect(completion).toHaveBeenCalledTimes(1);
      expect(nextCompletion).not.toHaveBeenCalled();
      await act(async () => {
        h.invalidation.closeEventUpdateForEvent(NEXT_EVENT);
        await nextResult;
      });
      expect(nextCompletion).toHaveBeenCalledExactlyOnceWith({
        status: "invalidated",
      });
      h.unmount();
    },
  );

  it("ignores a late failed acquisition after its import was invalidated", async () => {
    const fetchResult = deferred<ReturnType<typeof response>>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => fetchResult.promise),
    );
    const h = harness();
    const completion = vi.fn();
    let importResult!: Promise<BulkImportResult>;
    let acquisition!: Promise<void>;
    act(() => {
      importResult = h.startImport();
      void importResult.then(completion);
    });
    act(() => {
      acquisition = h.reviewImport();
    });
    await act(async () => {
      h.invalidation.applied([EVENT]);
      await importResult;
    });
    let nextResult!: Promise<BulkImportResult>;
    act(() => {
      nextResult = h.startImport(NEXT_EVENT);
    });
    const nextRequest = h.result.current.overlay.state.event;
    await act(async () => {
      fetchResult.reject(new Error("遅れて到着した取得失敗"));
      await acquisition;
    });
    expect(h.result.current.overlay.state.event).toBe(nextRequest);
    expect(h.registry.current?.eventName).toBe(NEXT_EVENT);
    expect(completion).toHaveBeenCalledExactlyOnceWith({
      status: "invalidated",
    });
    await act(async () => {
      h.invalidation.applied([NEXT_EVENT]);
      await nextResult;
    });
  });
});

it.each(["conflict", "day-merge"] as const)(
  "%s: application-owned auxiliary confirmation preserves the saving owner through cancellation and retry",
  async (review) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => sheetCsv(1).replace('"新刊0"', '"更新した新刊"'),
      })),
    );
    const h = harness(review);
    const completion = vi.fn();
    let importResult!: Promise<BulkImportResult>;
    act(() => {
      importResult = h.startImport();
      void importResult.then(completion);
    });
    await act(async () => {
      await h.reviewImport();
    });
    h.prepareAuxiliaryReview();
    const reviewOverlay = h.result.current.overlay.state.event;
    expect(reviewOverlay.kind).toBe("update");
    let saving!: Promise<void>;
    act(() => {
      saving = h.result.current.updates.handleConfirmUpdate({});
    });
    await waitFor(() =>
      expect(h.result.current.application.confirmations).toHaveLength(1),
    );

    expect(
      h.result.current.application.confirmations[0].confirmation.title,
    ).toMatch(review === "conflict" ? /競合/ : /保存先を統合/);
    expect(h.result.current.updates.isEventUpdateSaving).toBe(true);
    expect(h.registry.current?.phase).toBe("saving");
    expect(h.result.current.overlay.state.event).toBe(reviewOverlay);
    expect(completion).not.toHaveBeenCalled();
    act(() => {
      h.result.current.updates.handleCancelUpdate();
      h.invalidation.applied([EVENT]);
    });
    await act(async () => {
      expect(await h.startImport(NEXT_EVENT)).toEqual({
        status: "invalidated",
      });
    });
    expect(h.result.current.updates.isEventUpdateSaving).toBe(true);
    expect(h.result.current.overlay.state.event).toBe(reviewOverlay);
    expect(completion).not.toHaveBeenCalled();
    expect(h.storageCommit).not.toHaveBeenCalled();

    await act(async () => {
      h.result.current.application.cancel(
        h.result.current.application.confirmations[0].token,
      );
      await saving;
    });
    expect(h.result.current.updates.isEventUpdateSaving).toBe(false);
    expect(h.registry.current?.phase).toBe("confirmation");
    expect(h.result.current.overlay.state.event).toBe(reviewOverlay);
    expect(completion).not.toHaveBeenCalled();

    act(() => {
      saving = h.result.current.updates.handleConfirmUpdate({});
    });
    await waitFor(() =>
      expect(h.result.current.application.confirmations).toHaveLength(1),
    );
    await act(async () => {
      h.result.current.application.confirm(
        h.result.current.application.confirmations[0].token,
      );
      await saving;
      await importResult;
    });
    expect(h.result.current.application.failure).toBeNull();
    expect(completion).toHaveBeenCalledExactlyOnceWith({ status: "saved" });
    expect(h.storageCommit).toHaveBeenCalledOnce();
    expect(h.result.current.application.raw.eventLists[EVENT][0]).toMatchObject(
      {
        title: "更新した新刊",
        quantity: 2,
        remarks: "ユーザー登録",
      },
    );
    expect(h.registry.current).toBeNull();
    expect(h.result.current.updates.isEventUpdateSaving).toBe(false);
    expect(h.result.current.overlay.state.event.kind).toBe("inactive");
  },
);

it("rechecks the captured import input when a queued application confirmation resumes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      text: async () => sheetCsv(1).replace('"新刊0"', '"更新した新刊"'),
    })),
  );
  const h = harness("conflict");
  const completion = vi.fn();
  let importResult!: Promise<BulkImportResult>;
  act(() => {
    importResult = h.startImport();
    void importResult.then(completion);
  });
  await act(async () => {
    await h.reviewImport();
  });
  h.prepareAuxiliaryReview();
  let saving!: Promise<void>;
  act(() => {
    saving = h.result.current.updates.handleConfirmUpdate({});
  });
  await waitFor(() =>
    expect(h.result.current.application.confirmations).toHaveLength(1),
  );
  await act(async () => {
    h.invalidateInput();
    h.result.current.application.confirm(
      h.result.current.application.confirmations[0].token,
    );
    await saving;
    await importResult;
  });
  expect(h.storageCommit).not.toHaveBeenCalled();
  expect(completion).toHaveBeenCalledExactlyOnceWith({ status: "invalidated" });
  expect(h.registry.current).toBeNull();
  expect(h.result.current.updates.isEventUpdateSaving).toBe(false);
  expect(h.result.current.overlay.state.event.kind).toBe("inactive");
});
