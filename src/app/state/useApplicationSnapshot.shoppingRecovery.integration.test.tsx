import { useMemo, useRef } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import {
  emptyApplicationSnapshot,
  useApplicationSnapshot,
} from "./useApplicationSnapshot";
import {
  useShoppingItemMutationCommands,
  type ShoppingItemMutationCommandPorts,
} from "../commands/useShoppingItemMutationCommands";
import type { PersistenceSnapshot } from "../ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../types/item";
import { createEventConsistency } from "../../types/consistency";
import { useListInteractionState } from "../../features/lists/hooks/useListInteractionState";
import { buildRangePresentation } from "../../features/lists/domain/rangeSelection";
import type { ShoppingDragMoveContext } from "../../features/shopping-list/drag/shoppingDrag";
import { projectItemsToExecutionVisits } from "../../utils/visitProjection";
import { db } from "../../persistence/facade/indexedDbPersistence";
import { resetDatabaseConnection } from "../../persistence/db/openDatabase";
import { createPersistenceWorkerServer } from "../../persistence/worker/persistenceWorkerServer";
import { createWorkerPersistenceCommandAdapter } from "../../persistence/adapters/workerPersistenceCommandAdapter";

const firstDay = "1日目";
const secondDay = "2日目";
const item = (id: string, day = firstDay): ShoppingItem => ({
  id,
  circle: `ユーザー登録-${id}`,
  title: "新刊",
  eventDate: day,
  block: "A",
  number: id,
  price: 500,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "元のメモ",
  source: "spreadsheet",
  protectionLevel: "none",
  url: `https://example.test/${id}`,
});
const seed = (): PersistenceSnapshot => ({
  ...emptyApplicationSnapshot(),
  eventLists: {
    event: [item("1"), item("2"), item("3"), item("other-day", secondDay)],
    other: [item("other-1"), item("other-2")],
  },
  eventConsistency: {
    event: createEventConsistency(),
    other: createEventConsistency(),
  },
  executeModeItems: {
    event: { [firstDay]: ["1"], [secondDay]: ["other-day"] },
    other: { [firstDay]: [] },
  },
  dayModes: {
    event: { [firstDay]: "edit", [secondDay]: "edit" },
    other: { [firstDay]: "edit" },
  },
});
const options = { interval: 1, timeout: 10000 };

beforeEach(() => {
  resetDatabaseConnection();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  resetDatabaseConnection();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function recoveryHarness(invalidFull = false) {
  const initial = await db.readApplicationSnapshot();
  await db.commitApplicationSnapshotAtomically(seed(), {
    expectedRoots: initial.expectedRoots,
  });
  const shoppingCommit = vi.fn(db.commitShoppingCommandSnapshot);
  const itemCommit = vi.fn(db.commitApplicationSnapshotAtomically);
  const fullRead = vi.fn(db.readApplicationSnapshot);
  const server = createPersistenceWorkerServer({
    ...db,
    readApplicationSnapshot: fullRead,
    commitShoppingCommandSnapshot: shoppingCommit,
    commitApplicationSnapshotAtomically: itemCommit,
  });
  const methods: string[] = [];
  const writeOrder: string[] = [];
  let recoveryStarted = false;
  let recoveryPuts = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let corruptNextShopping = true;
  // Only Worker transport is looped back. Every read, mutation, validation,
  // transaction and snapshot projection below uses the production code.
  class LoopbackWorker {
    onmessage?: (event: MessageEvent) => void;
    onerror?: (event: Event) => void;
    tail = Promise.resolve();
    postMessage(value: { id: number; method: string; args: unknown[] }) {
      const request = structuredClone(value);
      methods.push(request.method);
      this.tail = this.tail.then(async () => {
        try {
          if (request.method === "readFull") {
            recoveryStarted = true;
            await gate;
          }
          const puts =
            request.method === "readFull"
              ? vi.spyOn(IDBObjectStore.prototype, "put")
              : undefined;
          let result: unknown;
          try {
            const dispatch = server as unknown as Record<
              string,
              (...args: unknown[]) => Promise<unknown>
            >;
            result = await dispatch[request.method](...request.args);
          } finally {
            if (puts) {
              recoveryPuts += puts.mock.calls.length;
              puts.mockRestore();
            }
          }
          if (
            ["shopping", "items", "commit", "commitDay", "day"].includes(
              request.method,
            )
          )
            writeOrder.push(request.method);
          if (request.method === "shopping" && corruptNextShopping) {
            corruptNextShopping = false;
            const committed = result as Awaited<
              ReturnType<typeof server.shopping>
            >;
            if (committed.status !== "committed" || !committed.read)
              throw new Error("Expected an actual committed shopping delta.");
            committed.read.delta.shoppingOrder!.itemIds = ["1", "1"];
          }
          if (request.method === "readFull" && invalidFull) {
            const read = result as Awaited<ReturnType<typeof server.readFull>>;
            read.delta.full!.executeModeItems.event[firstDay] = ["missing"];
          }
          this.onmessage?.({
            data: structuredClone({
              id: request.id,
              result,
              storageChanges: [],
            }),
          } as MessageEvent);
        } catch (error) {
          const value = error as Error;
          this.onmessage?.({
            data: {
              id: request.id,
              error: { name: value.name, message: value.message },
            },
          } as MessageEvent);
        }
      });
    }
    terminate() {}
  }
  vi.stubGlobal("Worker", LoopbackWorker);
  const port = createWorkerPersistenceCommandAdapter();
  const baseline = await port.readApplicationSnapshot();
  const hook = renderHook(
    ({ eventName, day }: { eventName: string; day: string }) => {
      const application = useApplicationSnapshot(port, eventName, day);
      const selection = useListInteractionState();
      // Match App.tsx: command refs read synchronously accepted proposals,
      // while the displayed structural state waits for the durable commit.
      const eventListsRef = useMemo(
        () => ({
          get current() {
            return application.previewRef.current.eventLists as Record<
              string,
              ShoppingItem[]
            >;
          },
        }),
        [application.previewRef],
      );
      const executeModeItemsRef = useMemo(
        () => ({
          get current() {
            return application.previewRef.current.executeModeItems;
          },
        }),
        [application.previewRef],
      );
      const commands = useShoppingItemMutationCommands({
        state: {
          activeEventName: eventName,
          activeEventDate: day,
          eventLists: application.values.eventLists,
          eventListsRef,
          eventMetadata: application.values.eventMetadata,
          dayModes: application.values.dayModes,
          items:
            application.values.eventLists[eventName]?.filter(
              (entry) => entry.eventDate === day,
            ) ?? [],
          selectedItemIds: selection.selectedItemIds,
          selectedBlockFilters: selection.selectedBlockFilters,
          blockSortDirection: null,
          candidateNumberSortDirection: null,
          itemToDelete: null,
          executeModeItemsRef,
          spaceGroupDragItemIdsRef: useRef(null),
          eventUpdatePreviewEpochRef: useRef(0),
          getEventGeneration: application.coordinator.generation,
        },
        actions: {
          ...application.setters,
          updateItemFields: application.updateItemFields,
          updateExecuteModeItems: application.setters.setExecuteModeItems,
          queueShoppingMovePatch: application.queueShoppingMovePatch,
          removeSelectedItemIds: selection.removeSelectedItemIds,
          clearRangeSelection: selection.clearRangeSelection,
          clearSelection: selection.clearSelection,
          setRecentlyChangedItemIds: vi.fn(),
          openDuplicateEvent: vi.fn(),
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
        alerts: { notify: vi.fn() },
        persistence: {
          commitApplicationSnapshotPatch: application.commitPatch,
        },
      } satisfies ShoppingItemMutationCommandPorts);
      return { application, selection, commands, eventName, day };
    },
    { initialProps: { eventName: "event", day: firstDay } },
  );
  act(() => {
    const setters = hook.result.current.application
      .hydrationSetters as unknown as Record<string, (value: unknown) => void>;
    for (const [key, value] of Object.entries(baseline.snapshot))
      setters[`set${key[0].toUpperCase()}${key.slice(1)}`](value);
    hook.result.current.application.coordinator.initializeEventGenerations(
      baseline,
    );
  });
  fullRead.mockClear();
  const drop = (id: string, sourceColumn: "candidate" | "execute") => {
    const { application, commands, eventName, day } = hook.result.current;
    const targetColumn = sourceColumn === "candidate" ? "execute" : "candidate";
    const accepted = application.previewRef.current;
    const execute = new Set(accepted.executeModeItems[eventName][day]);
    const source = (accepted.eventLists[eventName] as ShoppingItem[]).filter(
      (entry) =>
        entry.eventDate === day &&
        execute.has(entry.id) === (sourceColumn === "execute"),
    );
    const context: ShoppingDragMoveContext = {
      token: Symbol(),
      eventName,
      day,
      generation: application.coordinator.generation(eventName),
      sourceColumn,
      targetColumn,
      requestedIds: [id],
      effectiveIds: [id],
      sourceVisits: projectItemsToExecutionVisits(source).map((visit) => ({
        key: visit.key,
        ids: visit.itemIds,
      })),
      operation: "single",
      isCurrent: () => true,
    };
    commands.moveItem(
      id,
      "__END_OF_LIST__",
      targetColumn,
      sourceColumn,
      context,
    );
  };
  const select = (id: string) => {
    const { eventName, day, selection, application } = hook.result.current;
    selection.selectItemForRange(
      id,
      buildRangePresentation({
        grouping: "flat",
        scopeKey: `${eventName}/${day}/candidate`,
        itemIds: (
          application.previewRef.current.eventLists[eventName] as ShoppingItem[]
        )
          .filter((entry) => entry.eventDate === day)
          .map((entry) => entry.id),
      }),
    );
  };
  return {
    ...hook,
    port,
    methods,
    writeOrder,
    fullRead,
    shoppingCommit,
    itemCommit,
    drop,
    select,
    release,
    recoveryStarted: () => recoveryStarted,
    recoveryPuts: () => recoveryPuts,
  };
}

describe("committed shopping recovery across accepted application input", () => {
  it.each(["same scope", "day switch", "event switch"] as const)(
    "serializes full recovery, later edits and the next drop through %s",
    async (scope) => {
      const h = await recoveryHarness();
      act(() => h.select("1"));
      act(() => h.drop("1", "execute"));
      await waitFor(() => expect(h.recoveryStarted()).toBe(true), options);
      expect(h.shoppingCommit).toHaveBeenCalledOnce();
      expect(
        h.result.current.application.raw.executeModeItems.event[firstDay],
      ).toEqual(["1"]);
      expect(h.result.current.selection.selectedItemIds.size).toBe(0);
      const durableA = await db.readApplicationSnapshot();
      expect(durableA.snapshot.executeModeItems.event[firstDay]).toEqual([]);
      expect(
        durableA.snapshot.eventLists.event.map(
          (entry) => (entry as ShoppingItem).id,
        ),
      ).toEqual(["2", "3", "1", "other-day"]);
      const eventName = scope === "event switch" ? "other" : "event";
      const day = scope === "day switch" ? secondDay : firstDay;
      const editId =
        scope === "event switch"
          ? "other-1"
          : scope === "day switch"
            ? "other-day"
            : "2";
      const dropId = scope === "event switch" ? "other-2" : editId;
      if (scope !== "same scope") {
        act(() => h.result.current.selection.clearSelection());
        h.rerender({ eventName, day });
      }
      act(() => {
        const baseline = (
          h.result.current.application.values.eventLists[
            eventName
          ] as ShoppingItem[]
        ).find((entry) => entry.id === editId)!;
        h.result.current.application.updateItemFields({
          eventName,
          itemId: editId,
          baseline,
          changes: { quantity: 9, remarks: "復旧待ち中の後発メモ" },
        });
      });
      act(() => h.select(dropId));
      act(() =>
        h.drop(dropId, scope === "day switch" ? "execute" : "candidate"),
      );
      // New selection and endpoint belong to the later operation and must
      // survive acknowledgement/reprojection of the earlier recovered move.
      const selectedId =
        scope === "event switch"
          ? "other-1"
          : scope === "day switch"
            ? "other-day"
            : "3";
      act(() => h.select(selectedId));
      const endpoint = h.result.current.selection.rangeStart;
      expect(
        h.result.current.application.values.eventLists[eventName].find(
          (entry) => entry.id === editId,
        ),
      ).toMatchObject({ quantity: 9, remarks: "復旧待ち中の後発メモ" });
      expect(h.writeOrder).toEqual(["shopping"]);
      expect(h.methods.filter((method) => method === "readFull")).toHaveLength(
        1,
      );
      expect(h.itemCommit).not.toHaveBeenCalled();
      await act(async () => {
        h.release();
        await h.result.current.application.flush();
      });
      expect(h.result.current.eventName).toBe(eventName);
      expect(h.result.current.day).toBe(day);
      expect(h.result.current.selection.selectedItemIds).toEqual(
        new Set([selectedId]),
      );
      expect(h.result.current.selection.rangeStart).toEqual(endpoint);
      expect(h.result.current.application.confirmations).toEqual([]);
      expect(h.result.current.application.retryableFailures).toEqual([]);
      expect(h.result.current.application.requiresReload).toBe(false);
      expect(h.result.current.application.pendingCount).toBe(0);
      expect(h.writeOrder).toEqual(["shopping", "items", "shopping"]);
      expect(h.shoppingCommit).toHaveBeenCalledTimes(2);
      expect(h.itemCommit).toHaveBeenCalledOnce();
      expect(h.recoveryPuts()).toBe(0);
      expect(
        h.fullRead.mock.calls.filter(
          ([options]) => options?.prepareScopedCommands === false,
        ),
      ).toEqual([[{ shareVerified: true, prepareScopedCommands: false }]]);
      expect(h.methods.filter((method) => method === "readFull")).toHaveLength(
        1,
      );
      const durable = await db.readApplicationSnapshot();
      expect(
        durable.snapshot.eventLists[eventName].find(
          (entry) => (entry as ShoppingItem).id === editId,
        ),
      ).toMatchObject({
        quantity: 9,
        remarks: "復旧待ち中の後発メモ",
        url: `https://example.test/${editId}`,
      });
      expect(durable.snapshot.executeModeItems.event[firstDay]).toEqual(
        scope === "same scope" ? ["2"] : [],
      );
      expect(durable.snapshot.executeModeItems[eventName][day]).toEqual(
        scope === "day switch" ? [] : [dropId],
      );
      expect(h.result.current.application.raw).toEqual(durable.snapshot);
      expect(h.port.getWriteStopReason!()).toBeUndefined();
      h.unmount();
    },
  );

  it("stops writes after invalid full recovery without replaying the committed move or losing later content and selection", async () => {
    const h = await recoveryHarness(true);
    act(() => h.drop("1", "execute"));
    await waitFor(() => expect(h.recoveryStarted()).toBe(true), options);
    act(() => {
      h.result.current.application.updateItemFields({
        eventName: "event",
        itemId: "2",
        baseline: item("2"),
        changes: { quantity: 11, remarks: "復旧失敗でも保持する入力" },
      });
    });
    act(() => h.select("3"));
    const endpoint = h.result.current.selection.rangeStart;
    await act(async () => {
      h.release();
      await expect(h.result.current.application.flush()).rejects.toMatchObject({
        name: "CommittedStateApplyError",
      });
    });
    expect(h.result.current.application.requiresReload).toBe(true);
    expect(
      h.result.current.application.values.eventLists.event.find(
        (entry) => entry.id === "2",
      ),
    ).toMatchObject({ quantity: 11, remarks: "復旧失敗でも保持する入力" });
    expect(h.result.current.selection.selectedItemIds).toEqual(new Set(["3"]));
    expect(h.result.current.selection.rangeStart).toEqual(endpoint);
    expect(h.shoppingCommit).toHaveBeenCalledOnce();
    expect(h.itemCommit).not.toHaveBeenCalled();
    expect(h.writeOrder).toEqual(["shopping"]);
    expect(h.methods.filter((method) => method === "readFull")).toHaveLength(1);
    expect(h.recoveryPuts()).toBe(0);
    act(() => h.result.current.application.retryPending());
    expect(h.shoppingCommit).toHaveBeenCalledOnce();
    const durable = await db.readApplicationSnapshot();
    expect(durable.snapshot.executeModeItems.event[firstDay]).toEqual([]);
    expect(
      durable.snapshot.eventLists.event.find(
        (entry) => (entry as ShoppingItem).id === "2",
      ),
    ).toMatchObject({ quantity: 1, remarks: "元のメモ" });
    h.unmount();
  });
});
