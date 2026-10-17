// @vitest-environment jsdom

import { emptyApplicationSnapshot } from "../state/useApplicationSnapshot";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EventMetadata,
  ExecuteModeItems,
  ShoppingItem,
} from "../../types/item";
import type { BulkAddMetadata } from "../../features/events/bulkAdd";
import type {
  DuplicateEventResolution,
  SameSourceEventAnalysis,
} from "../../features/events/duplicateEvent";
import type { EventUpdateDiff } from "../../features/events/updateDiff";
import type {
  EventUpdateCommitState,
  PendingEventUpdate,
} from "../../features/events/updateFlow";
import type { PendingDuplicateEventImport } from "../state/appOverlayTypes";

const updateFlowMocks = vi.hoisted(() => ({
  buildEventUpdateDiffFromSpreadsheet: vi.fn(),
}));

vi.mock("../../features/events/updateFlow", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../features/events/updateFlow")>();
  return {
    ...actual,
    buildEventUpdateDiffFromSpreadsheet:
      updateFlowMocks.buildEventUpdateDiffFromSpreadsheet,
  };
});

import {
  useEventUpdateCommands,
  type EventUpdateActionPort,
  type EventUpdateCommandPorts,
  type EventUpdateStatePort,
} from "./useEventUpdateCommands";

const EVENT = "イベントA";
const DAY = "1日目";
const SOURCE = {
  url: "https://docs.google.com/spreadsheets/d/source",
  sheetName: "一覧",
};

const item = (
  id: string,
  overrides: Partial<ShoppingItem> = {},
): ShoppingItem => ({
  id,
  circle: `サークル-${id}`,
  eventDate: DAY,
  block: "東A",
  number: "01a",
  title: `頒布物-${id}`,
  price: 1000,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "",
  source: "spreadsheet",
  ...overrides,
});

const diff = (overrides: Partial<EventUpdateDiff> = {}): EventUpdateDiff => ({
  itemsToDelete: [],
  itemsToUpdate: [],
  itemsToAdd: [],
  appFieldSyncCandidates: [],
  protectedFromDelete: 0,
  protectedFromUpdate: 0,
  quantityWarnings: [],
  pendingPurchasedQuantityChanges: [],
  limitedPurchaseQuantityConflicts: [],
  ...overrides,
});

const duplicateAnalysis = (
  incomingItems: SameSourceEventAnalysis["incomingItems"],
): SameSourceEventAnalysis => ({
  kind: "same-source",
  eventName: EVENT,
  incomingItems,
  itemsForFixedAdd: incomingItems,
  duplicateItemCount: 0,
  incomingSource: SOURCE,
  incomingSourceIdentity: null,
  existingSource: SOURCE,
  existingSourceIdentity: null,
  sourceComparison: {
    primaryMatch: true,
    gidComparison: "not-comparable",
    isSameSource: true,
  },
});

interface HarnessStores {
  eventLists: Record<string, ShoppingItem[]>;
  eventMetadata: Record<string, EventMetadata>;
  executeModeItems: Record<string, ExecuteModeItems>;
  pendingDuplicateEvent: PendingDuplicateEventImport | null;
  pendingEventUpdate: PendingEventUpdate | null;
  pendingUpdateEventName: string | null;
  showUrlUpdateDialog: boolean;
}

interface HarnessOptions extends Partial<
  Pick<
    EventUpdateStatePort,
    | "eventLists"
    | "eventMetadata"
    | "pendingDuplicateEvent"
    | "pendingEventUpdate"
    | "pendingUpdateEventName"
  >
> {
  executeModeItems?: Record<string, ExecuteModeItems>;
  pendingBaseItems?: ShoppingItem[] | null;
}

const createHarness = (options: HarnessOptions = {}) => {
  const initialItems = [item("keep"), item("delete")];
  const eventLists = options.eventLists ?? { [EVENT]: initialItems };
  const eventMetadata = options.eventMetadata ?? {
    [EVENT]: {
      spreadsheetUrl: SOURCE.url,
      spreadsheetSheetName: SOURCE.sheetName,
      lastImportDate: "2026-08-09T00:00:00.000Z",
    },
  };
  const executeModeItems = options.executeModeItems ?? {
    [EVENT]: { [DAY]: initialItems.map(({ id }) => id) },
  };
  const stores: HarnessStores = {
    eventLists,
    eventMetadata,
    executeModeItems,
    pendingDuplicateEvent: options.pendingDuplicateEvent ?? null,
    pendingEventUpdate: options.pendingEventUpdate ?? null,
    pendingUpdateEventName: options.pendingUpdateEventName ?? null,
    showUrlUpdateDialog: false,
  };
  const refs = {
    eventListsRef: { current: eventLists },
    eventMetadataRef: { current: eventMetadata },
    executeModeItemsRef: { current: executeModeItems },
    pendingEventUpdateBaseItemsRef: {
      current:
        options.pendingBaseItems === undefined
          ? (eventLists[EVENT] ?? null)
          : options.pendingBaseItems,
    },
    eventUpdatePreviewEpochRef: { current: 0 },
  };
  const applyBulkAdd = vi.fn<
    (
      eventName: string,
      items: SameSourceEventAnalysis["incomingItems"],
      metadata?: BulkAddMetadata,
    ) => Promise<import("../../types/import").BulkImportResult>
  >(async () => ({ status: "saved" }));
  const commitEventUpdateState = vi.fn(async (next: EventUpdateCommitState) => {
    stores.eventLists = next.eventLists;
    stores.eventMetadata = next.eventMetadata;
    stores.executeModeItems = next.executeModeItems;
    refs.eventListsRef.current = next.eventLists;
    refs.eventMetadataRef.current = next.eventMetadata;
    refs.executeModeItemsRef.current = next.executeModeItems;
    return true;
  });
  const closeEventOverlay = vi.fn(() => {
    stores.pendingDuplicateEvent = null;
    stores.pendingEventUpdate = null;
    stores.pendingUpdateEventName = null;
    stores.showUrlUpdateDialog = false;
  });
  const openEventUpdate = vi.fn((value: PendingEventUpdate) => {
    closeEventOverlay();
    stores.pendingEventUpdate = value;
  });
  const openUrlUpdate = vi.fn((eventName: string) => {
    closeEventOverlay();
    stores.pendingUpdateEventName = eventName;
    stores.showUrlUpdateDialog = true;
  });
  const confirmEventOverlay = vi.fn(() => closeEventOverlay());
  const notify = vi.fn();
  const reportError = vi.fn();
  const actions: EventUpdateActionPort = {
    applyBulkAdd,
    commitEventUpdateState,
    openEventUpdate,
    openUrlUpdate,
    closeEventOverlay,
    confirmEventOverlay,
  };
  const ports: EventUpdateCommandPorts = {
    state: {
      eventLists,
      eventMetadata,
      pendingDuplicateEvent: stores.pendingDuplicateEvent,
      pendingEventUpdate: stores.pendingEventUpdate,
      pendingUpdateEventName: stores.pendingUpdateEventName,
      ...refs,
    },
    actions,
    effects: { notify, reportError },
  };

  return {
    ports,
    stores,
    refs,
    spies: {
      applyBulkAdd,
      commitEventUpdateState,
      openEventUpdate,
      openUrlUpdate,
      closeEventOverlay,
      confirmEventOverlay,
      notify,
      reportError,
    },
  };
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  updateFlowMocks.buildEventUpdateDiffFromSpreadsheet.mockReset();
});

describe("useEventUpdateCommands", () => {
  it("commits only the newest preview from the current event-list identity", async () => {
    const first = deferred<EventUpdateDiff>();
    const second = deferred<EventUpdateDiff>();
    const firstDiff = diff({ protectedFromDelete: 1 });
    const secondDiff = diff({ protectedFromUpdate: 2 });
    updateFlowMocks.buildEventUpdateDiffFromSpreadsheet
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const harness = createHarness();
    const { result } = renderHook(() => useEventUpdateCommands(harness.ports));

    let firstRequest!: Promise<void>;
    let secondRequest!: Promise<void>;
    act(() => {
      firstRequest = result.current.handleUpdateEvent(EVENT);
      secondRequest = result.current.handleUpdateEvent(EVENT);
    });
    await act(async () => {
      second.resolve(secondDiff);
      await secondRequest;
    });
    await act(async () => {
      first.resolve(firstDiff);
      await firstRequest;
    });

    const committed = harness.spies.openEventUpdate.mock.calls.map(
      ([value]) => value,
    );
    expect(committed).toEqual([
      {
        kind: "items-only",
        eventName: EVENT,
        baseSource: SOURCE,
        diff: secondDiff,
      },
    ]);
    expect(harness.refs.pendingEventUpdateBaseItemsRef.current).toEqual(
      harness.ports.state.eventLists[EVENT],
    );
    expect(harness.refs.eventUpdatePreviewEpochRef.current).toBe(2);
  });

  it("rejects a preview when the target list content changes in flight", async () => {
    const pending = deferred<EventUpdateDiff>();
    updateFlowMocks.buildEventUpdateDiffFromSpreadsheet.mockReturnValueOnce(
      pending.promise,
    );
    const harness = createHarness();
    const { result } = renderHook(() => useEventUpdateCommands(harness.ports));

    let request!: Promise<void>;
    act(() => {
      request = result.current.handleUpdateEvent(EVENT);
    });
    harness.refs.eventListsRef.current = {
      [EVENT]: [item("keep", { title: "取得中の変更" })],
    };
    await act(async () => {
      pending.resolve(diff());
      await request;
    });

    expect(harness.spies.openEventUpdate).not.toHaveBeenCalled();
    expect(harness.refs.pendingEventUpdateBaseItemsRef.current).toBeNull();
  });

  it("opens URL fallback for missing metadata and restores it after preview failure", async () => {
    const missingSource = createHarness({ eventMetadata: {} });
    const missingResult = renderHook(() =>
      useEventUpdateCommands(missingSource.ports),
    ).result;

    await act(async () => {
      await missingResult.current.handleUpdateEvent(EVENT);
    });
    expect(missingSource.refs.eventUpdatePreviewEpochRef.current).toBe(1);
    expect(missingSource.spies.openUrlUpdate).toHaveBeenCalledWith(EVENT);

    const failure = new Error("network unavailable");
    updateFlowMocks.buildEventUpdateDiffFromSpreadsheet.mockRejectedValueOnce(
      failure,
    );
    const fallback = createHarness({ pendingUpdateEventName: EVENT });
    const fallbackResult = renderHook(() =>
      useEventUpdateCommands(fallback.ports),
    ).result;

    await act(async () => {
      await fallbackResult.current.handleUrlUpdate(
        "https://docs.google.com/spreadsheets/d/replacement",
        "",
      );
    });

    expect(
      updateFlowMocks.buildEventUpdateDiffFromSpreadsheet,
    ).toHaveBeenCalledWith(fallback.ports.state.eventLists[EVENT], {
      url: "https://docs.google.com/spreadsheets/d/replacement",
      sheetName: SOURCE.sheetName,
    });
    expect(fallback.spies.closeEventOverlay).toHaveBeenCalled();
    expect(fallback.spies.openUrlUpdate).toHaveBeenCalledWith(EVENT);
    expect(fallback.spies.reportError).toHaveBeenCalledWith(
      "Spreadsheet update preview failed (preview-failed).",
    );
  });

  it("resolves alias and fixed-item duplicate choices without changing source accidentally", async () => {
    const incomingItems = [
      {
        circle: "新規サークル",
        eventDate: DAY,
        block: "西B",
        number: "02b",
        title: "新刊",
        price: 500,
        quantity: 1,
        remarks: "",
      },
    ];
    const pendingDuplicateEvent: PendingDuplicateEventImport = {
      analysis: duplicateAnalysis(incomingItems),
      metadata: { source: "spreadsheet", url: "old", sheetName: "旧" },
    };
    const aliasHarness = createHarness({ pendingDuplicateEvent });
    const aliasResult = renderHook(() =>
      useEventUpdateCommands(aliasHarness.ports),
    ).result;
    const aliasResolution: DuplicateEventResolution = {
      action: "create-alias",
      originalEventName: EVENT,
      eventName: "イベントA 別名",
      items: incomingItems,
      source: {
        url: "https://docs.google.com/spreadsheets/d/new",
        sheetName: "新",
      },
    };

    await act(async () => {
      await aliasResult.current.handleDuplicateEventResolution(aliasResolution);
    });
    expect(aliasHarness.spies.closeEventOverlay).toHaveBeenCalled();
    expect(aliasHarness.spies.applyBulkAdd).toHaveBeenCalledWith(
      "イベントA 別名",
      incomingItems,
      {
        source: "spreadsheet",
        url: "https://docs.google.com/spreadsheets/d/new",
        sheetName: "新",
      },
    );

    const fixedHarness = createHarness({ pendingDuplicateEvent });
    const fixedResult = renderHook(() =>
      useEventUpdateCommands(fixedHarness.ports),
    ).result;
    await act(async () => {
      await fixedResult.current.handleDuplicateEventResolution({
        action: "append-fixed-items",
        eventName: EVENT,
        items: [],
        duplicateItemCount: 3,
        itemSource: "app",
      });
    });
    expect(fixedHarness.spies.applyBulkAdd).not.toHaveBeenCalled();
    expect(fixedHarness.spies.notify).toHaveBeenCalledWith(
      "追加できる新しい品目はありません。完全一致の3件は追加対象から除かれました。",
    );
  });

  it("previews a different-source resolution with the reviewed source binding", async () => {
    const previewDiff = diff({ protectedFromUpdate: 1 });
    updateFlowMocks.buildEventUpdateDiffFromSpreadsheet.mockResolvedValueOnce(
      previewDiff,
    );
    const incomingItems = [
      {
        circle: "切替サークル",
        eventDate: DAY,
        block: "南C",
        number: "03a",
        title: "切替新刊",
        price: 700,
        quantity: 1,
        remarks: "",
      },
    ];
    const pendingDuplicateEvent: PendingDuplicateEventImport = {
      analysis: {
        ...duplicateAnalysis(incomingItems),
        kind: "different-source",
        sourceComparison: {
          primaryMatch: false,
          gidComparison: "not-comparable",
          isSameSource: false,
        },
      },
    };
    const harness = createHarness({ pendingDuplicateEvent });
    const { result } = renderHook(() => useEventUpdateCommands(harness.ports));

    await act(async () => {
      await result.current.handleDuplicateEventResolution({
        action: "switch-source",
        eventName: EVENT,
        source: {
          url: "https://docs.google.com/spreadsheets/d/reviewed-source",
          sheetName: "切替先",
        },
        sourceIdentity: {
          documentId: "reviewed-source",
          normalizedSheetName: "切替先",
        },
        nextStep: "review-update-diff",
      });
    });

    expect(
      updateFlowMocks.buildEventUpdateDiffFromSpreadsheet,
    ).toHaveBeenCalledWith(harness.ports.state.eventLists[EVENT], {
      url: "https://docs.google.com/spreadsheets/d/reviewed-source",
      sheetName: "切替先",
    });
    expect(harness.spies.openEventUpdate).toHaveBeenLastCalledWith({
      kind: "source-switch",
      baseSource: SOURCE,
      eventName: EVENT,
      diff: previewDiff,
      nextSource: {
        url: "https://docs.google.com/spreadsheets/d/reviewed-source",
        sheetName: "切替先",
      },
    });
    expect(harness.refs.pendingEventUpdateBaseItemsRef.current).toEqual(
      harness.ports.state.eventLists[EVENT],
    );
  });

  it("commits source, item, and execute changes through one composite action", async () => {
    const baseItems = [item("keep"), item("delete")];
    const pendingEventUpdate: PendingEventUpdate = {
      kind: "source-switch",
      baseSource: SOURCE,
      eventName: EVENT,
      diff: diff({ itemsToDelete: [baseItems[1]] }),
      nextSource: {
        url: "https://docs.google.com/spreadsheets/d/new",
        sheetName: "更新後",
      },
    };
    const harness = createHarness({
      eventLists: { [EVENT]: baseItems },
      executeModeItems: { [EVENT]: { [DAY]: ["keep", "delete"] } },
      pendingEventUpdate,
      pendingBaseItems: baseItems,
    });
    const { result } = renderHook(() => useEventUpdateCommands(harness.ports));

    await act(() => result.current.handleConfirmUpdate({}));

    expect(harness.spies.commitEventUpdateState).toHaveBeenCalledTimes(1);
    const committed = harness.spies.commitEventUpdateState.mock.calls[0][0];
    expect(committed.eventLists[EVENT].map(({ id }) => id)).toEqual(["keep"]);
    expect(committed.executeModeItems[EVENT][DAY]).toEqual(["keep"]);
    expect(committed.eventMetadata[EVENT]).toMatchObject({
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/new",
      spreadsheetSheetName: "更新後",
    });
    expect(harness.refs.pendingEventUpdateBaseItemsRef.current).toBeNull();
    expect(harness.spies.confirmEventOverlay).toHaveBeenCalled();
    expect(harness.spies.notify).toHaveBeenCalledWith(
      "アイテムを更新しました。",
    );
  });

  it("keeps the reviewed update open when its atomic commit fails", async () => {
    const baseItems = [item("keep")];
    const pendingEventUpdate: PendingEventUpdate = {
      kind: "items-only",
      baseSource: SOURCE,
      eventName: EVENT,
      diff: diff(),
    };
    const harness = createHarness({
      eventLists: { [EVENT]: baseItems },
      pendingEventUpdate,
      pendingBaseItems: baseItems,
    });
    harness.ports.actions.commitEventUpdateState = vi.fn(async () => false);
    const { result } = renderHook(() => useEventUpdateCommands(harness.ports));

    await act(() => result.current.handleConfirmUpdate({}));

    expect(harness.refs.pendingEventUpdateBaseItemsRef.current).toBe(baseItems);
    expect(harness.spies.confirmEventOverlay).not.toHaveBeenCalled();
    expect(harness.spies.notify).not.toHaveBeenCalledWith(
      "アイテムを更新しました。",
    );
  });

  it("fails closed without a partial commit after the reviewed list changes", async () => {
    const baseItems = [item("keep")];
    const pendingEventUpdate: PendingEventUpdate = {
      kind: "items-only",
      baseSource: SOURCE,
      eventName: EVENT,
      diff: diff(),
    };
    const harness = createHarness({
      eventLists: { [EVENT]: baseItems },
      pendingEventUpdate,
      pendingBaseItems: baseItems,
    });
    harness.refs.eventListsRef.current = {
      [EVENT]: [{ ...baseItems[0], title: "確認後の変更" }],
    };
    const { result } = renderHook(() => useEventUpdateCommands(harness.ports));

    await act(() => result.current.handleConfirmUpdate({}));

    expect(harness.spies.commitEventUpdateState).not.toHaveBeenCalled();
    expect(harness.spies.closeEventOverlay).toHaveBeenCalled();
    expect(harness.spies.notify).toHaveBeenCalledWith(
      "確認中にイベントの品目または更新元が変更・削除されたため、更新元も品目も変更していません。もう一度更新してください。",
    );
  });

  it("invalidates in-flight work when duplicate resolution is cancelled", () => {
    const harness = createHarness({
      pendingDuplicateEvent: {
        analysis: duplicateAnalysis([]),
      },
    });
    const { result } = renderHook(() => useEventUpdateCommands(harness.ports));

    act(() => {
      result.current.handleDuplicateEventCancel();
      result.current.handleCancelUpdate();
    });

    expect(harness.refs.eventUpdatePreviewEpochRef.current).toBe(2);
    expect(harness.spies.closeEventOverlay).toHaveBeenCalledTimes(2);
  });
});

it("previews and confirms against separately projected but equal latest items", async () => {
  const harness = createHarness();
  harness.refs.eventListsRef.current = structuredClone(
    harness.stores.eventLists,
  );
  updateFlowMocks.buildEventUpdateDiffFromSpreadsheet.mockResolvedValueOnce(
    diff({ itemsToDelete: [harness.stores.eventLists[EVENT][1]] }),
  );
  const { result, rerender } = renderHook(() =>
    useEventUpdateCommands(harness.ports),
  );
  await act(() => result.current.handleUpdateEvent(EVENT));
  expect(harness.spies.openEventUpdate).toHaveBeenCalledOnce();
  Object.assign(harness.ports.state, {
    pendingEventUpdate: harness.stores.pendingEventUpdate,
  });
  // A fresh projection during confirmation must not expire equal contents.
  harness.refs.eventListsRef.current = structuredClone(
    harness.stores.eventLists,
  );
  rerender();
  await act(() => result.current.handleConfirmUpdate({}));
  expect(harness.spies.commitEventUpdateState).toHaveBeenCalledOnce();
  expect(harness.stores.eventLists[EVENT].map(({ id }) => id)).toEqual([
    "keep",
  ]);
  expect(harness.spies.notify).toHaveBeenCalledWith("アイテムを更新しました。");
});

it("accepts a fresh equal projection while CSV is loading", async () => {
  const harness = createHarness();
  const preview = deferred<EventUpdateDiff>();
  updateFlowMocks.buildEventUpdateDiffFromSpreadsheet.mockReturnValueOnce(
    preview.promise,
  );
  const { result } = renderHook(() => useEventUpdateCommands(harness.ports));
  let loading!: Promise<void>;
  act(() => {
    loading = result.current.handleUpdateEvent(EVENT);
  });
  harness.refs.eventListsRef.current = structuredClone(
    harness.stores.eventLists,
  );
  await act(async () => {
    preview.resolve(diff());
    await loading;
  });
  expect(harness.spies.openEventUpdate).toHaveBeenCalledOnce();
});

it.each(["loading", "confirmation"] as const)(
  "expires an equal same-name replacement during %s using event generation",
  async (phase) => {
    const harness = createHarness();
    let generation = 0;
    Object.assign(harness.ports.state, {
      getEventGeneration: () => generation,
    });
    const preview = deferred<EventUpdateDiff>();
    updateFlowMocks.buildEventUpdateDiffFromSpreadsheet.mockReturnValueOnce(
      preview.promise,
    );
    const { result, rerender } = renderHook(() =>
      useEventUpdateCommands(harness.ports),
    );
    let loading!: Promise<void>;
    act(() => {
      loading = result.current.handleUpdateEvent(EVENT);
    });
    if (phase === "loading") generation++;
    await act(async () => {
      preview.resolve(diff());
      await loading;
    });
    if (phase === "loading") {
      expect(harness.spies.openEventUpdate).not.toHaveBeenCalled();
    } else {
      expect(harness.stores.pendingEventUpdate).toMatchObject({
        eventGeneration: 0,
      });
      Object.assign(harness.ports.state, {
        pendingEventUpdate: harness.stores.pendingEventUpdate,
      });
      generation++;
      rerender();
      await act(() => result.current.handleConfirmUpdate({}));
      expect(harness.spies.commitEventUpdateState).not.toHaveBeenCalled();
    }
  },
);

it("uses accepted latest contents and freezes them before loading the CSV", async () => {
  const harness = createHarness();
  const latest = [item("latest", { remarks: "受け付け済みの変更" })];
  harness.refs.eventListsRef.current = { [EVENT]: latest };
  const preview = deferred<EventUpdateDiff>();
  updateFlowMocks.buildEventUpdateDiffFromSpreadsheet.mockReturnValueOnce(
    preview.promise,
  );
  const { result } = renderHook(() => useEventUpdateCommands(harness.ports));
  let loading!: Promise<void>;
  act(() => {
    loading = result.current.handleUpdateEvent(EVENT);
  });
  expect(
    updateFlowMocks.buildEventUpdateDiffFromSpreadsheet.mock.calls.at(-1)?.[0],
  ).toEqual(latest);
  latest[0].remarks = "取得中の変更";
  await act(async () => {
    preview.resolve(diff());
    await loading;
  });
  expect(harness.spies.openEventUpdate).not.toHaveBeenCalled();
});

it("does not accept cancellation after the duplicate import has begun committing", async () => {
  const incoming = [
    {
      circle: "A",
      eventDate: DAY,
      block: "A",
      number: "1",
      title: "本",
      price: 500,
      quantity: 1,
      remarks: "",
    },
  ];
  const complete = vi.fn();
  const h = createHarness({
    pendingDuplicateEvent: { analysis: duplicateAnalysis(incoming), complete },
  });
  const saving = deferred<import("../../types/import").BulkImportResult>();
  h.ports.actions.applyBulkAdd = vi.fn(() => saving.promise);
  const { result } = renderHook(() => useEventUpdateCommands(h.ports));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.handleDuplicateEventResolution({
      action: "create-alias",
      originalEventName: EVENT,
      eventName: "別名",
      items: incoming,
      source: null,
    });
  });
  act(() => result.current.handleDuplicateEventCancel());
  expect(complete).not.toHaveBeenCalled();
  await act(async () => {
    saving.resolve({ status: "saved" });
    await pending;
  });
  expect(complete).toHaveBeenCalledExactlyOnceWith({ status: "saved" });
});

it("completes a duplicate request as cancelled before saving starts", () => {
  const complete = vi.fn();
  const h = createHarness({
    pendingDuplicateEvent: { analysis: duplicateAnalysis([]), complete },
  });
  const { result } = renderHook(() => useEventUpdateCommands(h.ports));
  act(() => result.current.handleDuplicateEventCancel());
  expect(complete).toHaveBeenCalledExactlyOnceWith({ status: "cancelled" });
  expect(h.spies.applyBulkAdd).not.toHaveBeenCalled();
});

it.each([
  ["Error", "unknown"],
  ["CommittedStateApplyError", "committed-ui-failed"],
  ["QuotaExceededError", "failed"],
] as const)(
  "propagates a reviewed import's %s outcome without announcing success",
  async (name, status) => {
    const complete = vi.fn();
    const base = [item("keep")];
    const h = createHarness({
      eventLists: { [EVENT]: base },
      pendingEventUpdate: {
        kind: "items-only",
        baseSource: SOURCE,
        eventName: EVENT,
        diff: diff(),
        onImportComplete: complete,
      },
      pendingBaseItems: base,
    });
    h.ports.actions.commitEventUpdateState = vi.fn(async () => {
      throw Object.assign(new Error("save result"), { name });
    });
    const { result } = renderHook(() => useEventUpdateCommands(h.ports));
    await act(() => result.current.handleConfirmUpdate({}));
    expect(complete).toHaveBeenCalledExactlyOnceWith({ status });
    expect(h.spies.confirmEventOverlay).not.toHaveBeenCalled();
    expect(h.spies.notify).not.toHaveBeenCalledWith("アイテムを更新しました。");
    if (status !== "failed")
      expect(h.spies.closeEventOverlay).toHaveBeenCalled();
  },
);

for (const flow of ["normal", "same-source", "source-switch"] as const) {
  for (const phase of ["loading", "confirmation"] as const) {
    it.each(["spreadsheetUrl", "spreadsheetSheetName", "removed"] as const)(
      `invalidates ${flow} during ${phase} when only the source changes: %s`,
      async (change) => {
        const complete = vi.fn();
        const harness = createHarness({
          pendingDuplicateEvent: { analysis: duplicateAnalysis([]), complete },
        });
        const before = structuredClone(harness.stores.eventLists);
        const preview = deferred<EventUpdateDiff>();
        updateFlowMocks.buildEventUpdateDiffFromSpreadsheet.mockReturnValueOnce(
          preview.promise,
        );
        const { result, rerender } = renderHook(() =>
          useEventUpdateCommands(harness.ports),
        );
        let loading!: Promise<void>;
        act(() => {
          loading =
            flow === "normal"
              ? result.current.handleUpdateEvent(EVENT)
              : result.current.handleDuplicateEventResolution({
                  action:
                    flow === "same-source" ? "open-update" : "switch-source",
                  eventName: EVENT,
                  sourceIdentity: {
                    documentId: "source",
                    normalizedSheetName: SOURCE.sheetName,
                  },
                  nextStep: "review-update-diff",
                  source:
                    flow === "same-source"
                      ? SOURCE
                      : {
                          url: "https://example.com/new-source",
                          sheetName: "新シート",
                        },
                });
        });
        const changeSource = () => {
          if (change === "removed")
            delete harness.refs.eventMetadataRef.current[EVENT];
          else
            harness.refs.eventMetadataRef.current[EVENT][change] = "変更済み";
        };
        if (phase === "loading") changeSource();
        await act(async () => {
          preview.resolve(
            diff({ itemsToDelete: [harness.stores.eventLists[EVENT][1]] }),
          );
          await loading;
        });
        if (phase === "confirmation") {
          expect(harness.spies.openEventUpdate).toHaveBeenCalledOnce();
          Object.assign(harness.ports.state, {
            pendingEventUpdate: harness.stores.pendingEventUpdate,
          });
          changeSource();
          rerender();
          await act(() => result.current.handleConfirmUpdate({}));
        } else expect(harness.spies.openEventUpdate).not.toHaveBeenCalled();
        expect(harness.spies.commitEventUpdateState).not.toHaveBeenCalled();
        expect(harness.stores.eventLists).toEqual(before);
        expect(harness.spies.confirmEventOverlay).not.toHaveBeenCalled();
        if (flow !== "normal")
          expect(complete).toHaveBeenCalledExactlyOnceWith({
            status: "invalidated",
          });
      },
    );
  }
}

it("starts a normal update from accepted source values rather than an older render", async () => {
  const h = createHarness();
  h.refs.eventMetadataRef.current = {
    [EVENT]: {
      ...h.stores.eventMetadata[EVENT],
      spreadsheetUrl: "https://example.com/accepted",
      spreadsheetSheetName: "受理済み",
    },
  };
  updateFlowMocks.buildEventUpdateDiffFromSpreadsheet.mockResolvedValueOnce(
    diff(),
  );
  const { result } = renderHook(() => useEventUpdateCommands(h.ports));
  await act(() => result.current.handleUpdateEvent(EVENT));
  expect(
    updateFlowMocks.buildEventUpdateDiffFromSpreadsheet,
  ).toHaveBeenCalledWith(expect.any(Array), {
    url: "https://example.com/accepted",
    sheetName: "受理済み",
  });
  expect(h.stores.pendingEventUpdate).toMatchObject({
    baseSource: { url: "https://example.com/accepted", sheetName: "受理済み" },
  });
});

it("preserves unrelated metadata changes and equal source projections throughout an update", async () => {
  const h = createHarness();
  const preview = deferred<EventUpdateDiff>();
  updateFlowMocks.buildEventUpdateDiffFromSpreadsheet.mockReturnValueOnce(
    preview.promise,
  );
  const { result, rerender } = renderHook(() =>
    useEventUpdateCommands(h.ports),
  );
  let loading!: Promise<void>;
  act(() => {
    loading = result.current.handleUpdateEvent(EVENT);
  });
  h.refs.eventMetadataRef.current = structuredClone(h.stores.eventMetadata);
  h.refs.eventMetadataRef.current[EVENT].lastImportDate =
    "2026-10-16T00:00:00.000Z";
  await act(async () => {
    preview.resolve(diff());
    await loading;
  });
  Object.assign(h.ports.state, {
    pendingEventUpdate: h.stores.pendingEventUpdate,
  });
  rerender();
  await act(() => result.current.handleConfirmUpdate({}));
  expect(h.spies.commitEventUpdateState).toHaveBeenCalledOnce();
  expect(h.stores.eventMetadata[EVENT].lastImportDate).toBe(
    "2026-10-16T00:00:00.000Z",
  );
});

it("reports invalidation when the queued save observes a different source", async () => {
  const complete = vi.fn();
  const h = createHarness({
    pendingDuplicateEvent: { analysis: duplicateAnalysis([]), complete },
  });
  updateFlowMocks.buildEventUpdateDiffFromSpreadsheet.mockResolvedValueOnce(
    diff(),
  );
  const { result, rerender } = renderHook(() =>
    useEventUpdateCommands(h.ports),
  );
  await act(() =>
    result.current.handleDuplicateEventResolution({
      action: "open-update",
      eventName: EVENT,
      source: SOURCE,
      sourceIdentity: {
        documentId: "source",
        normalizedSheetName: SOURCE.sheetName,
      },
      nextStep: "review-update-diff",
    }),
  );
  Object.assign(h.ports.state, {
    pendingEventUpdate: h.stores.pendingEventUpdate,
  });
  h.ports.actions.commitEventUpdateState = vi.fn(
    async (_next, assertCurrent) => {
      assertCurrent({
        ...emptyApplicationSnapshot(),
        eventMetadata: {
          [EVENT]: {
            ...h.stores.eventMetadata[EVENT],
            spreadsheetUrl: "https://example.com/queued",
          },
        },
      });
      return true;
    },
  );
  rerender();
  await act(() => result.current.handleConfirmUpdate({}));
  expect(complete).toHaveBeenCalledExactlyOnceWith({ status: "invalidated" });
  expect(h.spies.confirmEventOverlay).not.toHaveBeenCalled();
  expect(h.spies.notify).toHaveBeenCalledWith(
    expect.stringContaining("更新元"),
  );
  expect(h.spies.notify).not.toHaveBeenCalledWith("アイテムを更新しました。");
});

it.each(["open-update", "switch-source"] as const)(
  "invalidates a duplicate %s choice if its source changed before preview starts",
  async (action) => {
    const complete = vi.fn();
    const h = createHarness({
      pendingDuplicateEvent: { analysis: duplicateAnalysis([]), complete },
    });
    h.refs.eventMetadataRef.current = {
      [EVENT]: {
        ...h.stores.eventMetadata[EVENT],
        spreadsheetUrl: "https://example.com/already-changed",
      },
    };
    const { result } = renderHook(() => useEventUpdateCommands(h.ports));
    await act(() =>
      result.current.handleDuplicateEventResolution({
        action,
        eventName: EVENT,
        source: SOURCE,
        sourceIdentity: {
          documentId: "source",
          normalizedSheetName: SOURCE.sheetName,
        },
        nextStep: "review-update-diff",
      }),
    );
    expect(complete).toHaveBeenCalledExactlyOnceWith({ status: "invalidated" });
    expect(
      updateFlowMocks.buildEventUpdateDiffFromSpreadsheet,
    ).not.toHaveBeenCalled();
    expect(h.spies.commitEventUpdateState).not.toHaveBeenCalled();
  },
);

it.each(["normal", "source-switch"] as const)(
  "previews and confirms %s with cloned unknown fields without changing their content",
  async (flow) => {
    const existing = {
      ...item("keep"),
      futureOptionalField: {
        preserved: true,
        nested: [0, false, null, "ユーザー登録"],
      },
    };
    const harness = createHarness({
      eventLists: { [EVENT]: [existing] },
      pendingUpdateEventName: EVENT,
    });
    const preview = deferred<EventUpdateDiff>();
    updateFlowMocks.buildEventUpdateDiffFromSpreadsheet.mockReturnValueOnce(
      preview.promise,
    );
    const { result, rerender } = renderHook(() =>
      useEventUpdateCommands(harness.ports),
    );
    let loading!: Promise<void>;
    act(() => {
      loading =
        flow === "normal"
          ? result.current.handleUpdateEvent(EVENT)
          : result.current.handleUrlUpdate(
              "https://example.com/new-source",
              "新シート",
            );
    });
    harness.refs.eventListsRef.current = structuredClone(
      harness.stores.eventLists,
    );
    await act(async () => {
      preview.resolve(
        diff({ itemsToUpdate: [{ ...existing, title: "更新後" }] }),
      );
      await loading;
    });
    expect(harness.spies.openEventUpdate).toHaveBeenCalledOnce();
    expect(harness.refs.pendingEventUpdateBaseItemsRef.current?.[0]).not.toBe(
      existing,
    );
    Object.assign(harness.ports.state, {
      pendingEventUpdate: harness.stores.pendingEventUpdate,
    });
    harness.refs.eventListsRef.current = structuredClone(
      harness.stores.eventLists,
    );
    rerender();
    await act(() => result.current.handleConfirmUpdate({}));
    expect(harness.spies.commitEventUpdateState).toHaveBeenCalledOnce();
    expect(harness.stores.eventLists[EVENT][0]).toMatchObject({
      title: "更新後",
      futureOptionalField: existing.futureOptionalField,
    });
    expect(harness.stores.eventMetadata[EVENT].spreadsheetUrl).toBe(
      flow === "normal" ? SOURCE.url : "https://example.com/new-source",
    );
  },
);

for (const flow of ["normal", "source-switch"] as const) {
  it.each(["loading", "confirmation"] as const)(
    `invalidates ${flow} when unknown nested content changes during %s`,
    async (phase) => {
      const existing = {
        ...item("keep"),
        futureOptionalField: { preserved: true },
      };
      const harness = createHarness({
        eventLists: { [EVENT]: [existing] },
        pendingUpdateEventName: EVENT,
      });
      const preview = deferred<EventUpdateDiff>();
      updateFlowMocks.buildEventUpdateDiffFromSpreadsheet.mockReturnValueOnce(
        preview.promise,
      );
      const { result, rerender } = renderHook(() =>
        useEventUpdateCommands(harness.ports),
      );
      let loading!: Promise<void>;
      act(() => {
        loading =
          flow === "normal"
            ? result.current.handleUpdateEvent(EVENT)
            : result.current.handleUrlUpdate(
                "https://example.com/new-source",
                "新シート",
              );
      });
      const changeNestedValue = () => {
        // In-place edits must also invalidate the independent review snapshot.
        existing.futureOptionalField.preserved = false;
      };
      if (phase === "loading") changeNestedValue();
      await act(async () => {
        preview.resolve(diff());
        await loading;
      });
      if (phase === "confirmation") {
        expect(harness.spies.openEventUpdate).toHaveBeenCalledOnce();
        Object.assign(harness.ports.state, {
          pendingEventUpdate: harness.stores.pendingEventUpdate,
        });
        changeNestedValue();
        rerender();
        await act(() => result.current.handleConfirmUpdate({}));
      } else expect(harness.spies.openEventUpdate).not.toHaveBeenCalled();
      expect(harness.spies.commitEventUpdateState).not.toHaveBeenCalled();
      expect(harness.spies.confirmEventOverlay).not.toHaveBeenCalled();
    },
  );
}
