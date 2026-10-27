import {
  buildShoppingDragLayout,
  resolveShoppingDragPlacement,
  type ShoppingDragMoveContext,
} from "../../features/shopping-list/drag/shoppingDrag";
import { projectItemsToExecutionVisits } from "../../utils/visitProjection";
// @vitest-environment jsdom

import { emptyApplicationSnapshot as emptyApplicationSnapshotForImport } from "../state/useApplicationSnapshot";
import { rememberItemUpdateBaseline } from "../../utils/itemUpdateBaseline";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { Suspense, startTransition, useState } from "react";
import ShoppingList from "../../components/ShoppingList";
import { useListInteractionState } from "../../features/lists/hooks/useListInteractionState";
import { describe, expect, it, vi } from "vitest";
import type {
  DayModeState,
  EventMetadata,
  ExecuteModeItems,
  ShoppingItem,
} from "../../types/item";
import { getItemKey } from "../../utils/itemComparison";
import type { PendingDuplicateEventImport } from "../state/appOverlayTypes";
import { createEventUpdateOperationRegistry } from "./eventUpdateOperation";
import {
  useShoppingItemMutationCommands,
  type BulkAddItemInput,
  type ShoppingItemMutationActionPort,
  type ShoppingItemMutationCommandPorts,
  type ShoppingItemMutationStatePort,
} from "./useShoppingItemMutationCommands";

const EVENT = "event-a";
const DAY = "day-1";
const PADDED_DAY = ` \u3000${DAY}\u3000 `;

const item = (
  id: string,
  overrides: Partial<ShoppingItem> = {},
): ShoppingItem => ({
  id,
  circle: `circle-${id}`,
  eventDate: DAY,
  block: "A",
  number: "1",
  title: `title-${id}`,
  price: null,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "",
  ...overrides,
});

const bulkItem = (
  circle: string,
  overrides: Partial<BulkAddItemInput> = {},
): BulkAddItemInput => ({
  circle,
  eventDate: DAY,
  block: "A",
  number: "1",
  title: `title-${circle}`,
  price: null,
  quantity: 1,
  remarks: "",
  ...overrides,
});

interface HarnessStores {
  eventLists: Record<string, ShoppingItem[]>;
  eventMetadata: Record<string, EventMetadata>;
  dayModes: Record<string, DayModeState>;
  executeModeItems: Record<string, ExecuteModeItems>;
  recentlyChangedItemIds: Set<string>;
  pendingDuplicateEvent: PendingDuplicateEventImport | null;
  blockSortDirection: "asc" | "desc" | null;
  candidateNumberSortDirection: "asc" | "desc" | null;
}

interface HarnessOptions extends Partial<
  Pick<
    ShoppingItemMutationStatePort,
    | "activeEventName"
    | "activeEventDate"
    | "eventLists"
    | "eventMetadata"
    | "dayModes"
    | "items"
    | "selectedItemIds"
    | "selectedBlockFilters"
    | "blockSortDirection"
    | "candidateNumberSortDirection"
    | "itemToDelete"
  >
> {
  executeModeItems?: Record<string, ExecuteModeItems>;
  spaceGroupDragItemIds?: readonly string[] | null;
  replayEventListUpdater?: boolean;
  replayExecuteUpdater?: boolean;
  areItemsInSameHall?: (
    firstItemId: string,
    secondItemId: string,
    eventDate: string,
  ) => boolean;
  areItemsInSameHallGroup?: (
    firstItemId: string,
    secondItemId: string,
    eventDate: string,
  ) => boolean;
}

const createHarness = (options: HarnessOptions = {}) => {
  const activeEventName = Object.prototype.hasOwnProperty.call(
    options,
    "activeEventName",
  )
    ? (options.activeEventName ?? null)
    : EVENT;
  const defaultItems = [item("one")];
  const initialEventLists =
    options.eventLists ??
    (activeEventName ? { [activeEventName]: defaultItems } : {});
  const stores: HarnessStores = {
    eventLists: initialEventLists,
    eventMetadata: options.eventMetadata ?? {},
    dayModes:
      options.dayModes ??
      (activeEventName ? { [activeEventName]: { [DAY]: "edit" } } : {}),
    executeModeItems: options.executeModeItems ?? {},
    recentlyChangedItemIds: new Set(),
    pendingDuplicateEvent: null,
    blockSortDirection: options.blockSortDirection ?? null,
    candidateNumberSortDirection: options.candidateNumberSortDirection ?? null,
  };
  const executeModeItemsRef = { current: stores.executeModeItems };
  const eventListsRef = { current: stores.eventLists };
  const spaceGroupDragItemIdsRef = {
    current: options.spaceGroupDragItemIds ?? null,
  };
  const eventUpdatePreviewEpochRef = { current: 0 };

  const setEventLists = vi.fn(
    (
      updater: (
        current: Record<string, ShoppingItem[]>,
      ) => Record<string, ShoppingItem[]>,
    ) => {
      const previous = stores.eventLists;
      const next = updater(previous);
      if (options.replayEventListUpdater) updater(previous);
      stores.eventLists = next;
      eventListsRef.current = stores.eventLists;
    },
  );
  const setEventMetadata = vi.fn(
    (
      updater: (
        current: Record<string, EventMetadata>,
      ) => Record<string, EventMetadata>,
    ) => {
      stores.eventMetadata = updater(stores.eventMetadata);
    },
  );
  const setDayModes = vi.fn(
    (
      updater: (
        current: Record<string, DayModeState>,
      ) => Record<string, DayModeState>,
    ) => {
      stores.dayModes = updater(stores.dayModes);
    },
  );
  const updateExecuteModeItems = vi.fn(
    (
      updater: (
        current: Record<string, ExecuteModeItems>,
      ) => Record<string, ExecuteModeItems>,
    ) => {
      const previous = stores.executeModeItems;
      const next = updater(previous);
      if (options.replayExecuteUpdater) updater(previous);
      stores.executeModeItems = next;
      executeModeItemsRef.current = stores.executeModeItems;
    },
  );
  const setRecentlyChangedItemIds = vi.fn(
    (updater: (current: Set<string>) => Set<string>) => {
      stores.recentlyChangedItemIds = updater(stores.recentlyChangedItemIds);
    },
  );
  const openDuplicateEvent = vi.fn((value: PendingDuplicateEventImport) => {
    stores.pendingDuplicateEvent = value;
  });
  const openEvent = vi.fn();
  const showImport = vi.fn();
  const clearRangeSelection = vi.fn();
  const clearSelection = vi.fn();
  const removeSelectedItemIds = vi.fn();
  const queueShoppingMovePatch = vi.fn<
    ShoppingItemMutationActionPort["queueShoppingMovePatch"]
  >((input) => {
    if (input.eventListItems) {
      stores.eventLists = {
        ...stores.eventLists,
        [input.eventName]: [...input.eventListItems],
      };
      eventListsRef.current = stores.eventLists;
    }
    if (input.executeModeItems) {
      stores.executeModeItems = {
        ...stores.executeModeItems,
        [input.eventName]: input.executeModeItems,
      };
      executeModeItemsRef.current = stores.executeModeItems;
    }
    return {
      status: "accepted",
      operationId: "operation",
      moveId: "operation:move:1",
    };
  });
  const setSortState = vi.fn();
  const setBlockSortDirection = vi.fn((value: "asc" | "desc" | null) => {
    stores.blockSortDirection = value;
  });
  const setCandidateNumberSortDirection = vi.fn(
    (value: "asc" | "desc" | null) => {
      stores.candidateNumberSortDirection = value;
    },
  );
  const confirmItemDelete = vi.fn();
  const notify = vi.fn();
  const areItemsInSameHall = vi.fn(options.areItemsInSameHall ?? (() => true));
  const areItemsInSameHallGroup = vi.fn(
    options.areItemsInSameHallGroup ?? (() => true),
  );

  const actions: ShoppingItemMutationActionPort = {
    setEventLists,
    setEventMetadata,
    setDayModes,
    updateExecuteModeItems,
    setRecentlyChangedItemIds,
    openDuplicateEvent,
    clearRangeSelection,
    clearSelection,
    removeSelectedItemIds,
    queueShoppingMovePatch,
    setSortState,
    setBlockSortDirection,
    setCandidateNumberSortDirection,
    confirmItemDelete,
    navigation: { openEvent, showImport },
  };
  const state: ShoppingItemMutationStatePort = {
    activeEventName,
    activeEventDate: options.activeEventDate ?? DAY,
    eventLists: initialEventLists,
    eventListsRef,
    eventMetadata: stores.eventMetadata,
    dayModes: stores.dayModes,
    items:
      options.items ??
      (activeEventName ? initialEventLists[activeEventName] || [] : []),
    selectedItemIds: options.selectedItemIds ?? new Set(),
    selectedBlockFilters: options.selectedBlockFilters ?? new Set(),
    blockSortDirection: options.blockSortDirection ?? null,
    candidateNumberSortDirection: options.candidateNumberSortDirection ?? null,
    itemToDelete: options.itemToDelete ?? null,
    executeModeItemsRef,
    spaceGroupDragItemIdsRef,
    eventUpdatePreviewEpochRef,
  };
  const ports: ShoppingItemMutationCommandPorts = {
    state,
    actions,
    selectors: { areItemsInSameHall, areItemsInSameHallGroup },
    alerts: { notify },
    persistence: {
      commitApplicationSnapshotPatch: vi.fn<
        NonNullable<
          ShoppingItemMutationCommandPorts["persistence"]
        >["commitApplicationSnapshotPatch"]
      >(async (patch) => {
        Object.assign(stores, patch);
        eventListsRef.current = stores.eventLists;
        executeModeItemsRef.current = stores.executeModeItems;
      }),
    },
  };

  return {
    ports,
    stores,
    refs: {
      eventListsRef,
      executeModeItemsRef,
      spaceGroupDragItemIdsRef,
      eventUpdatePreviewEpochRef,
    },
    spies: {
      setEventLists,
      setEventMetadata,
      setDayModes,
      updateExecuteModeItems,
      setRecentlyChangedItemIds,
      openDuplicateEvent,
      openEvent,
      showImport,
      clearRangeSelection,
      clearSelection,
      removeSelectedItemIds,
      queueShoppingMovePatch,
      setSortState,
      setBlockSortDirection,
      setCandidateNumberSortDirection,
      confirmItemDelete,
      notify,
      areItemsInSameHall,
      areItemsInSameHallGroup,
    },
  };
};

const frozenDrag = (
  sourceColumn: "execute" | "candidate",
  targetColumn: "execute" | "candidate",
  requestedIds: readonly string[],
  effectiveIds: readonly string[],
  sourceItems: ShoppingItem[],
): ShoppingDragMoveContext => ({
  token: Symbol(),
  eventName: EVENT,
  day: DAY,
  generation: 0,
  sourceColumn,
  targetColumn,
  requestedIds,
  effectiveIds,
  sourceVisits: projectItemsToExecutionVisits(sourceItems).map((visit) => ({
    key: visit.key,
    ids: visit.itemIds,
  })),
  operation: "selection",
  isCurrent: () => true,
});

describe("useShoppingItemMutationCommands", () => {
  it.each(["execute", "focus"] as const)(
    "rejects new drag and vertical moves in %s mode without queue, selection, or sort effects",
    (mode) => {
      const items = [item("a", { number: "1" }), item("b", { number: "2" })];
      const harness = createHarness({
        eventLists: { [EVENT]: items },
        items,
        dayModes: { [EVENT]: { [DAY]: mode } },
        executeModeItems: { [EVENT]: { [DAY]: ["a", "b"] } },
        selectedItemIds: new Set(["a"]),
        spaceGroupDragItemIds: ["a"],
        blockSortDirection: "asc",
      });
      const before = structuredClone(harness.stores);
      const { result } = renderHook(() =>
        useShoppingItemMutationCommands(harness.ports),
      );
      act(() => {
        result.current.moveItem("a", "b", "execute", "execute");
        result.current.moveItem(
          "a",
          "b",
          "execute",
          "execute",
          frozenDrag("execute", "execute", ["a"], ["a"], items),
        );
        result.current.moveItemUp("b", "execute");
        result.current.moveItemDown("a", "execute");
      });
      expect(harness.stores).toEqual(before);
      expect(harness.refs.spaceGroupDragItemIdsRef.current).toEqual(["a"]);
      for (const spy of Object.values(harness.spies))
        expect(spy).not.toHaveBeenCalled();
      expect(
        harness.ports.persistence.commitApplicationSnapshotPatch,
      ).not.toHaveBeenCalled();
    },
  );

  it.each(["execute", "focus"] as const)(
    "rejects callbacks and gestures captured in edit mode after changing to %s",
    (mode) => {
      const items = [item("a", { number: "1" }), item("b", { number: "2" })];
      const harness = createHarness({
        eventLists: { [EVENT]: items },
        items,
        executeModeItems: { [EVENT]: { [DAY]: ["a", "b"] } },
      });
      const { result, rerender } = renderHook(
        ({ dayModes }) =>
          useShoppingItemMutationCommands({
            ...harness.ports,
            state: { ...harness.ports.state, dayModes },
          }),
        { initialProps: { dayModes: harness.stores.dayModes } },
      );
      const captured = result.current;
      const drag = frozenDrag("execute", "execute", ["a"], ["a"], items);
      const before = structuredClone(harness.stores);
      rerender({ dayModes: { [EVENT]: { [DAY]: mode } } });
      act(() => {
        captured.moveItem("a", "b", "execute", "execute", drag);
        captured.moveItem("a", "b", "execute", "execute");
        captured.moveItemUp("b", "execute");
        captured.moveItemDown("a", "execute");
        result.current.moveItemDown("a", "execute");
      });
      expect(harness.stores).toEqual(before);
      for (const spy of Object.values(harness.spies))
        expect(spy).not.toHaveBeenCalled();
      expect(
        harness.ports.persistence.commitApplicationSnapshotPatch,
      ).not.toHaveBeenCalled();
    },
  );

  it.each(["execute", "focus"] as const)(
    "keeps committed %s mode guarded when an edit render is abandoned",
    (mode) => {
      const items = [item("a", { number: "1" }), item("b", { number: "2" })];
      const harness = createHarness({
        eventLists: { [EVENT]: items },
        items,
        executeModeItems: { [EVENT]: { [DAY]: ["a", "b"] } },
      });
      const suspendedRender = vi.fn();
      const pending = new Promise<void>(() => {});
      const { result, rerender } = renderHook(
        ({ dayModes, suspended }) => {
          const commands = useShoppingItemMutationCommands({
            ...harness.ports,
            state: { ...harness.ports.state, dayModes },
          });
          if (suspended) {
            suspendedRender();
            throw pending;
          }
          return commands;
        },
        {
          initialProps: { dayModes: harness.stores.dayModes, suspended: false },
          wrapper: ({ children }) => (
            <Suspense fallback={null}>{children}</Suspense>
          ),
        },
      );
      const captured = result.current;
      rerender({ dayModes: { [EVENT]: { [DAY]: mode } }, suspended: false });
      const committed = result.current;
      const before = structuredClone(harness.stores);
      act(() => {
        startTransition(() =>
          rerender({ dayModes: harness.stores.dayModes, suspended: true }),
        );
      });
      expect(suspendedRender).toHaveBeenCalled();
      expect(result.current).toBe(committed);
      act(() => {
        captured.moveItem(
          "a",
          "b",
          "execute",
          "execute",
          frozenDrag("execute", "execute", ["a"], ["a"], items),
        );
        captured.moveItem("a", "b", "execute", "execute");
        captured.moveItemUp("b", "execute");
        captured.moveItemDown("a", "execute");
      });
      expect(harness.stores).toEqual(before);
      for (const spy of Object.values(harness.spies))
        expect(spy).not.toHaveBeenCalled();
      expect(
        harness.ports.persistence.commitApplicationSnapshotPatch,
      ).not.toHaveBeenCalled();
    },
  );

  it("keeps committed edit moves available when an execute render is abandoned", () => {
    const items = [item("a", { number: "1" }), item("b", { number: "2" })];
    const harness = createHarness({ eventLists: { [EVENT]: items }, items });
    const suspendedRender = vi.fn();
    const pending = new Promise<void>(() => {});
    const { result, rerender } = renderHook(
      ({ dayModes, suspended }) => {
        const commands = useShoppingItemMutationCommands({
          ...harness.ports,
          state: { ...harness.ports.state, dayModes },
        });
        if (suspended) {
          suspendedRender();
          throw pending;
        }
        return commands;
      },
      {
        initialProps: { dayModes: harness.stores.dayModes, suspended: false },
        wrapper: ({ children }) => (
          <Suspense fallback={null}>{children}</Suspense>
        ),
      },
    );
    const committed = result.current;
    act(() => {
      startTransition(() =>
        rerender({
          dayModes: { [EVENT]: { [DAY]: "execute" } },
          suspended: true,
        }),
      );
    });
    expect(suspendedRender).toHaveBeenCalled();
    expect(result.current).toBe(committed);
    act(() => committed.moveItemDown("a", "candidate"));
    expect(harness.stores.eventLists[EVENT].map(({ id }) => id)).toEqual([
      "b",
      "a",
    ]);
    expect(harness.spies.setEventLists).toHaveBeenCalledOnce();
  });

  it.each(["event", "day"] as const)(
    "rejects move callbacks retained from a different active %s",
    (changedScope) => {
      const items = [item("a", { number: "1" }), item("b", { number: "2" })];
      const harness = createHarness({ eventLists: { [EVENT]: items }, items });
      const { result, rerender } = renderHook(
        ({ state }) =>
          useShoppingItemMutationCommands({ ...harness.ports, state }),
        { initialProps: { state: harness.ports.state } },
      );
      const captured = result.current;
      const before = structuredClone(harness.stores);
      rerender({
        state: {
          ...harness.ports.state,
          ...(changedScope === "event"
            ? { activeEventName: "other-event" }
            : { activeEventDate: "other-day" }),
        },
      });
      act(() => {
        captured.moveItem("b", "a", "candidate", "candidate");
        captured.moveItemUp("b", "candidate");
        captured.moveItemDown("a", "candidate");
      });
      expect(harness.stores).toEqual(before);
      for (const spy of Object.values(harness.spies))
        expect(spy).not.toHaveBeenCalled();
    },
  );

  it.each(["event", "day"] as const)(
    "uses the displayed edit default when the %s mode bucket is missing",
    (missingBucket) => {
      for (const operation of ["drag", "up", "down"] as const) {
        const items = [item("a", { number: "1" }), item("b", { number: "2" })];
        const harness = createHarness({
          eventLists: { [EVENT]: items },
          items,
          dayModes: missingBucket === "event" ? {} : { [EVENT]: {} },
        });
        const { result, unmount } = renderHook(() =>
          useShoppingItemMutationCommands(harness.ports),
        );
        act(() => {
          if (operation === "drag")
            result.current.moveItem("b", "a", "candidate", "candidate");
          else if (operation === "up")
            result.current.moveItemUp("b", "candidate");
          else result.current.moveItemDown("a", "candidate");
        });
        expect(harness.stores.eventLists[EVENT].map(({ id }) => id)).toEqual([
          "b",
          "a",
        ]);
        expect(harness.spies.setEventLists).toHaveBeenCalledOnce();
        unmount();
      }
    },
  );

  it.each(["candidate", "execute"] as const)(
    "supplies the accepted baseline for a second %s move before the screen rerenders",
    (sourceColumn) => {
      const x = item("x", { number: "1" });
      const y = item("y", { number: "2" });
      const z = item("z", { number: "3" });
      const target = item("target", { number: "4" });
      const targetColumn =
        sourceColumn === "candidate" ? "execute" : "candidate";
      const harness = createHarness({
        eventLists: { [EVENT]: [x, y, z, target] },
        executeModeItems: {
          [EVENT]: {
            [DAY]: sourceColumn === "execute" ? ["x", "y", "z"] : ["target"],
          },
        },
      });
      const { result } = renderHook(() =>
        useShoppingItemMutationCommands(harness.ports),
      );
      act(() => {
        result.current.moveItem(
          "x",
          "__END_OF_LIST__",
          targetColumn,
          sourceColumn,
          frozenDrag(sourceColumn, targetColumn, ["x"], ["x"], [x]),
        );
      });
      const afterFirstOrder = harness.refs.eventListsRef.current[EVENT].map(
        (entry) => entry.id,
      );
      const afterFirstExecute = [
        ...harness.refs.executeModeItemsRef.current[EVENT][DAY],
      ];
      // The render's eventLists/dayModes are deliberately unchanged. Both compute
      // inputs and their queue proof must use the synchronously accepted refs.
      act(() => {
        result.current.moveItem(
          "y",
          "__END_OF_LIST__",
          sourceColumn,
          sourceColumn,
          frozenDrag(sourceColumn, sourceColumn, ["y"], ["y"], [y]),
        );
      });
      expect(harness.spies.queueShoppingMovePatch).toHaveBeenCalledTimes(2);
      expect(
        harness.spies.queueShoppingMovePatch.mock.calls[1][0],
      ).toMatchObject({
        baselineItemIds: afterFirstOrder,
        baselineExecuteIds: afterFirstExecute,
      });
      expect(
        harness.refs.executeModeItemsRef.current[EVENT][DAY].includes("x"),
      ).toBe(sourceColumn === "candidate");
    },
  );

  it.each(["candidate", "execute"] as const)(
    "keeps both column controllers and later checks consistent while an accepted %s transfer saves",
    (sourceColumn) => {
      const moving = ["m1", "m2", "m3"].map((id, index) =>
        item(id, { number: String(index + 1) }),
      );
      const target = item("target", { number: "9" });
      const targetColumn =
        sourceColumn === "candidate" ? "execute" : "candidate";
      const context = frozenDrag(
        sourceColumn,
        targetColumn,
        ["m1", "m2", "m3"],
        ["m1", "m2", "m3"],
        moving,
      );
      const harness = createHarness({
        eventLists: { [EVENT]: [...moving, target] },
        executeModeItems: {
          [EVENT]: {
            [DAY]:
              sourceColumn === "execute"
                ? moving.map((entry) => entry.id)
                : ["target"],
          },
        },
      });
      let completeSave!: () => void;
      function TransferHarness() {
        const selection = useListInteractionState();
        const [, refresh] = useState(0);
        harness.spies.queueShoppingMovePatch.mockImplementation((input) => {
          completeSave = () => {
            if (input.eventListItems) {
              harness.stores.eventLists = {
                [EVENT]: [...input.eventListItems],
              };
              harness.refs.eventListsRef.current = harness.stores.eventLists;
            }
            if (input.executeModeItems) {
              harness.stores.executeModeItems = {
                [EVENT]: input.executeModeItems,
              };
              harness.refs.executeModeItemsRef.current =
                harness.stores.executeModeItems;
            }
            refresh((value) => value + 1);
          };
          return {
            status: "accepted",
            operationId: "save",
            moveId: "save:move:1",
          };
        });
        const commands = useShoppingItemMutationCommands({
          ...harness.ports,
          state: {
            ...harness.ports.state,
            eventLists: harness.stores.eventLists,
            selectedItemIds: selection.selectedItemIds,
          },
          actions: {
            ...harness.ports.actions,
            removeSelectedItemIds: selection.removeSelectedItemIds,
            clearRangeSelection: selection.clearRangeSelection,
          },
        });
        const executeIds = new Set(harness.stores.executeModeItems[EVENT][DAY]);
        return (
          <>
            <output data-testid="selection-state">
              {JSON.stringify({
                selected: [...selection.selectedItemIds].sort(),
                start: selection.rangeStart,
                end: selection.rangeEnd,
              })}
            </output>
            <button
              onClick={() =>
                commands.moveItem(
                  "m1",
                  "__END_OF_LIST__",
                  targetColumn,
                  sourceColumn,
                  context,
                )
              }
            >
              Move frozen range
            </button>
            {(["candidate", "execute"] as const).map((column) => (
              <ShoppingList
                key={column}
                items={harness.stores.eventLists[EVENT].filter(
                  (entry) =>
                    executeIds.has(entry.id) === (column === "execute"),
                )}
                onUpdateItem={vi.fn()}
                onMoveItem={commands.moveItem}
                onEditRequest={vi.fn()}
                onDeleteRequest={vi.fn()}
                selectedItemIds={selection.selectedItemIds}
                onSelectItem={(id, _column, presentation) =>
                  selection.selectItemForRange(id, presentation)
                }
                rangeStart={selection.rangeStart}
                rangeEnd={selection.rangeEnd}
                onToggleRangeSelection={selection.toggleRangeItemIdsSelection}
                columnType={column}
                currentDay={DAY}
                viewMode="edit"
                layoutMode="pc"
                showSpaceGroups={false}
                showHallGroups={false}
                forceFullListRenderer
                skipLimitedPurchaseForSingleQuantity
              />
            ))}
          </>
        );
      }
      render(<TransferHarness />);
      const checkbox = (id: string) =>
        screen.getByRole("checkbox", {
          name: `Select item circle-${id} - title-${id}`,
        });
      const readSelection = () =>
        JSON.parse(screen.getByTestId("selection-state").textContent!) as {
          selected: string[];
          start: { itemId: string } | null;
          end: unknown;
        };
      fireEvent.click(checkbox("target"));
      fireEvent.click(checkbox("m1"));
      fireEvent.click(checkbox("m3"));
      fireEvent.click(screen.getAllByTitle("範囲内のチェックを入れる")[0]);
      expect(readSelection().selected).toEqual(["m1", "m2", "m3", "target"]);
      for (const entry of moving) expect(checkbox(entry.id)).toBeChecked();

      fireEvent.click(
        screen.getByRole("button", { name: "Move frozen range" }),
      );
      expect(readSelection()).toEqual({
        selected: ["target"],
        start: null,
        end: null,
      });
      for (const entry of moving) expect(checkbox(entry.id)).not.toBeChecked();
      expect(checkbox("target")).toBeChecked();
      expect(
        screen.queryByTitle("範囲内のチェックを外す"),
      ).not.toBeInTheDocument();

      // The next check is accepted before persistence updates either column.
      fireEvent.click(checkbox("m1"));
      expect(checkbox("m1")).toBeChecked();
      expect(readSelection().selected).toEqual(["m1", "target"]);
      const laterStart = readSelection().start;
      act(() => completeSave());
      expect(checkbox("m1")).toBeChecked();
      expect(checkbox("m2")).not.toBeChecked();
      expect(checkbox("m3")).not.toBeChecked();
      expect(checkbox("target")).toBeChecked();
      expect(readSelection()).toEqual({
        selected: ["m1", "target"],
        start: laterStart,
        end: null,
      });
    },
  );

  it.each(["candidate", "execute"] as const)(
    "consumes only accepted %s transfers including expanded visit members",
    (sourceColumn) => {
      const x = item("x", { number: "2a" });
      const peer = item("peer", { number: "2a2" });
      const other = item("other", { number: "3a" });
      const targetColumn =
        sourceColumn === "candidate" ? "execute" : "candidate";
      const harness = createHarness({
        eventLists: { [EVENT]: [x, peer, other] },
        selectedItemIds: new Set(["x", "peer", "other"]),
        executeModeItems: {
          [EVENT]: { [DAY]: sourceColumn === "execute" ? ["x", "peer"] : [] },
        },
      });
      const { result } = renderHook(() =>
        useShoppingItemMutationCommands(harness.ports),
      );
      const context = frozenDrag(
        sourceColumn,
        targetColumn,
        ["x"],
        ["x", "peer"],
        [x, peer],
      );
      act(() =>
        result.current.moveItem(
          "x",
          "__END_OF_LIST__",
          targetColumn,
          sourceColumn,
          context,
        ),
      );

      expect(
        harness.spies.removeSelectedItemIds,
      ).toHaveBeenCalledExactlyOnceWith(["x", "peer"]);
      expect(harness.spies.clearRangeSelection).toHaveBeenCalledTimes(1);
      expect(harness.spies.clearSelection).not.toHaveBeenCalled();
      expect(harness.spies.setSortState).toHaveBeenCalledExactlyOnceWith(
        "Manual",
      );
      expect(
        harness.spies.setBlockSortDirection,
      ).toHaveBeenCalledExactlyOnceWith(null);
      expect(
        harness.spies.setCandidateNumberSortDirection,
      ).not.toHaveBeenCalled();
      expect(harness.spies.setEventLists).not.toHaveBeenCalled();
      expect(harness.spies.updateExecuteModeItems).not.toHaveBeenCalled();
      expect(harness.spies.queueShoppingMovePatch).toHaveBeenCalledTimes(1);
      expect(
        harness.spies.queueShoppingMovePatch.mock.calls[0][0],
      ).toMatchObject({
        eventName: EVENT,
        day: DAY,
        eventGeneration: 0,
        sourceColumn,
        targetColumn,
        requestedIds: ["x"],
        effectiveIds: ["x", "peer"],
      });
    },
  );

  it.each(["candidate", "execute"] as const)(
    "retains checks and performs existing UI cleanup once for a same-order %s drop",
    (column) => {
      const a = item("a", { number: "1" });
      const b = item("b", { number: "2" });
      const c = item("c", { number: "3" });
      const harness = createHarness({
        eventLists: { [EVENT]: [a, b, c] },
        selectedItemIds: new Set(["b", "c"]),
        executeModeItems: {
          [EVENT]: { [DAY]: column === "execute" ? ["a", "b", "c"] : [] },
        },
        spaceGroupDragItemIds: ["b", "c"],
        candidateNumberSortDirection: "desc",
      });
      harness.spies.queueShoppingMovePatch.mockReturnValue({
        status: "noop",
        reason: "same-order",
      });
      const { result } = renderHook(() =>
        useShoppingItemMutationCommands(harness.ports),
      );
      const context = frozenDrag(
        column,
        column,
        ["b", "c"],
        ["b", "c"],
        [b, c],
      );
      act(() =>
        result.current.moveItem(
          "b",
          "__END_OF_LIST__",
          column,
          column,
          context,
        ),
      );

      expect(harness.spies.queueShoppingMovePatch).toHaveBeenCalledTimes(1);
      expect(harness.spies.removeSelectedItemIds).not.toHaveBeenCalled();
      expect(harness.spies.clearSelection).not.toHaveBeenCalled();
      expect(harness.spies.clearRangeSelection).toHaveBeenCalledTimes(1);
      expect(harness.spies.setSortState).toHaveBeenCalledExactlyOnceWith(
        "Manual",
      );
      expect(
        harness.spies.setBlockSortDirection,
      ).toHaveBeenCalledExactlyOnceWith(null);
      expect(
        harness.spies.setCandidateNumberSortDirection,
      ).not.toHaveBeenCalled();
      expect(harness.stores.candidateNumberSortDirection).toBe("desc");
      expect(harness.refs.spaceGroupDragItemIdsRef.current).toBeNull();
      expect(harness.spies.notify).not.toHaveBeenCalled();
      expect(harness.spies.setEventLists).not.toHaveBeenCalled();
      expect(harness.spies.updateExecuteModeItems).not.toHaveBeenCalled();
      expect(harness.stores.eventLists[EVENT]).toEqual([a, b, c]);
    },
  );

  it.each(["candidate", "execute"] as const)(
    "preserves selection, endpoints and sort when the queue blocks a %s drop",
    (targetColumn) => {
      const a = item("a", { number: "1" });
      const harness = createHarness({
        eventLists: { [EVENT]: [a] },
        selectedItemIds: new Set(["a"]),
        spaceGroupDragItemIds: ["a"],
      });
      harness.spies.queueShoppingMovePatch.mockReturnValue({
        status: "blocked",
        reason: "write-stop",
      });
      const { result } = renderHook(() =>
        useShoppingItemMutationCommands(harness.ports),
      );
      const context = frozenDrag("candidate", targetColumn, ["a"], ["a"], [a]);
      act(() =>
        result.current.moveItem(
          "a",
          "__END_OF_LIST__",
          targetColumn,
          "candidate",
          context,
        ),
      );

      expect(harness.spies.queueShoppingMovePatch).toHaveBeenCalledTimes(1);
      expect(harness.spies.removeSelectedItemIds).not.toHaveBeenCalled();
      expect(harness.spies.clearRangeSelection).not.toHaveBeenCalled();
      expect(harness.spies.clearSelection).not.toHaveBeenCalled();
      expect(harness.spies.setSortState).not.toHaveBeenCalled();
      expect(harness.spies.setBlockSortDirection).not.toHaveBeenCalled();
      expect(
        harness.spies.setCandidateNumberSortDirection,
      ).not.toHaveBeenCalled();
      expect(harness.spies.notify).not.toHaveBeenCalled();
      expect(harness.refs.spaceGroupDragItemIdsRef.current).toEqual(["a"]);
      expect(harness.spies.setEventLists).not.toHaveBeenCalled();
      expect(harness.spies.updateExecuteModeItems).not.toHaveBeenCalled();
    },
  );

  it("freezes an exact same-column candidate selection without expanding its peers", () => {
    const a = item("a", { number: "1a" }),
      x1 = item("x1", { number: "2a" }),
      x2 = item("x2", { number: "2a2" }),
      y = item("y", { number: "3a" });
    const harness = createHarness({
      eventLists: { [EVENT]: [a, x1, x2, y] },
      selectedItemIds: new Set(["x1", "x2"]),
      executeModeItems: { [EVENT]: { [DAY]: ["a"] } },
    });
    const context: ShoppingDragMoveContext = {
      token: Symbol(),
      eventName: EVENT,
      day: DAY,
      generation: 0,
      sourceColumn: "candidate",
      targetColumn: "candidate",
      requestedIds: ["x1", "y"],
      effectiveIds: ["x1", "y"],
      sourceVisits: projectItemsToExecutionVisits([x1, x2, y]).map((visit) => ({
        key: visit.key,
        ids: visit.itemIds,
      })),
      operation: "selection",
      isCurrent: () => true,
    };
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );
    act(() =>
      result.current.moveItem(
        "x1",
        "__END_OF_LIST__",
        "candidate",
        "candidate",
        context,
      ),
    );
    expect(
      harness.stores.eventLists[EVENT].filter((item) => item.id !== "a").map(
        (item) => item.id,
      ),
    ).toEqual(["x2", "x1", "y"]);
  });
  it("freezes the original execution groups for a same-column drag", () => {
    const a1 = item("a1", { number: "1a" }),
      a2 = item("a2", { number: "1a2" }),
      b = item("b", { number: "2a" }),
      c = item("c", { number: "3a" });
    const harness = createHarness({
      eventLists: { [EVENT]: [a1, b, a2, c] },
      selectedItemIds: new Set(["a1", "c"]),
      executeModeItems: { [EVENT]: { [DAY]: ["a1", "b", "a2", "c"] } },
    });
    const context: ShoppingDragMoveContext = {
      token: Symbol(),
      eventName: EVENT,
      day: DAY,
      generation: 0,
      sourceColumn: "execute",
      targetColumn: "execute",
      requestedIds: ["a1", "b"],
      effectiveIds: ["a1", "b", "a2"],
      sourceVisits: projectItemsToExecutionVisits([a1, b, a2]).map((visit) => ({
        key: visit.key,
        ids: visit.itemIds,
      })),
      operation: "selection",
      isCurrent: () => true,
    };
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );
    act(() =>
      result.current.moveItem(
        "a1",
        "__END_OF_LIST__",
        "execute",
        "execute",
        context,
      ),
    );
    expect(harness.stores.executeModeItems[EVENT][DAY]).toEqual([
      "c",
      "a1",
      "b",
      "a2",
    ]);
  });
  it("refuses a candidate anchor whose column membership changed before drop", () => {
    const a = item("a", { number: "1a" }),
      target = item("target", { number: "2a" });
    const harness = createHarness({
      eventLists: { [EVENT]: [a, target] },
      executeModeItems: { [EVENT]: { [DAY]: ["a"] } },
    });
    const context: ShoppingDragMoveContext = {
      token: Symbol(),
      eventName: EVENT,
      day: DAY,
      generation: 0,
      sourceColumn: "execute",
      targetColumn: "candidate",
      requestedIds: ["a"],
      effectiveIds: ["a"],
      sourceVisits: projectItemsToExecutionVisits([a]).map((visit) => ({
        key: visit.key,
        ids: visit.itemIds,
      })),
      operation: "single",
      isCurrent: () => true,
    };
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );
    harness.refs.executeModeItemsRef.current = {
      [EVENT]: { [DAY]: ["a", "target"] },
    };
    act(() =>
      result.current.moveItem("a", "target", "candidate", "execute", context),
    );
    expect(harness.spies.clearRangeSelection).not.toHaveBeenCalled();
    expect(harness.spies.setSortState).not.toHaveBeenCalled();
    expect(harness.spies.updateExecuteModeItems).not.toHaveBeenCalled();
  });
  it("uses the frozen drag selection instead of a later live selection", () => {
    const a = item("a", { number: "1a" }),
      x = item("x", { number: "2a" }),
      sibling = item("sibling", { number: "2a2" }),
      other = item("other", { number: "3a" });
    const live = new Set(["other"]);
    const harness = createHarness({
      eventLists: { [EVENT]: [a, x, sibling, other] },
      selectedItemIds: live,
      executeModeItems: { [EVENT]: { [DAY]: ["a"] } },
    });
    const layout = buildShoppingDragLayout([a], {
      spaceGroups: true,
      hallGroups: false,
      halls: [],
      hallOrder: [],
      map: null,
    });
    const context: ShoppingDragMoveContext = {
      token: Symbol(),
      eventName: EVENT,
      day: DAY,
      generation: 0,
      sourceColumn: "candidate",
      targetColumn: "execute",
      requestedIds: ["x"],
      effectiveIds: ["x", "sibling"],
      sourceVisits: projectItemsToExecutionVisits([x, sibling]).map(
        (visit) => ({ key: visit.key, ids: visit.itemIds }),
      ),
      operation: "single",
      isCurrent: () => true,
      placement: resolveShoppingDragPlacement(
        layout,
        [x, sibling],
        "a",
        "after",
      )!,
    };
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );
    act(() =>
      result.current.moveItem(
        "x",
        "__END_OF_LIST__",
        "execute",
        "candidate",
        context,
      ),
    );
    expect(harness.stores.executeModeItems[EVENT][DAY]).toEqual([
      "a",
      "x",
      "sibling",
    ]);
    expect(
      harness.stores.eventLists[EVENT].find((item) => item.id === "other"),
    ).toBe(other);
  });
  it("does not clear range or sort when a drag owner or generation is invalid", () => {
    const x = item("x", { number: "2a" });
    const harness = createHarness({
      eventLists: { [EVENT]: [x] },
      selectedItemIds: new Set(["x"]),
    });
    harness.ports.state.getEventGeneration = () => 2;
    const context: ShoppingDragMoveContext = {
      token: Symbol(),
      eventName: EVENT,
      day: DAY,
      generation: 1,
      sourceColumn: "candidate",
      targetColumn: "execute",
      requestedIds: ["x"],
      effectiveIds: ["x"],
      sourceVisits: projectItemsToExecutionVisits([x]).map((visit) => ({
        key: visit.key,
        ids: visit.itemIds,
      })),
      operation: "single",
      isCurrent: () => true,
    };
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );
    act(() =>
      result.current.moveItem(
        "x",
        "__END_OF_LIST__",
        "execute",
        "candidate",
        context,
      ),
    );
    expect(harness.spies.clearRangeSelection).not.toHaveBeenCalled();
    expect(harness.spies.setSortState).not.toHaveBeenCalled();
    expect(harness.spies.setEventLists).not.toHaveBeenCalled();
    expect(harness.spies.updateExecuteModeItems).not.toHaveBeenCalled();
  });
  it("does not change sort or selection after a same-visit source member arrives during drag", () => {
    const x = item("x", { number: "2a" }),
      late = item("late", { number: "2a2" });
    const harness = createHarness({ eventLists: { [EVENT]: [x] } });
    const context: ShoppingDragMoveContext = {
      token: Symbol(),
      eventName: EVENT,
      day: DAY,
      generation: 0,
      sourceColumn: "candidate",
      targetColumn: "execute",
      requestedIds: ["x"],
      effectiveIds: ["x"],
      sourceVisits: projectItemsToExecutionVisits([x]).map((visit) => ({
        key: visit.key,
        ids: visit.itemIds,
      })),
      operation: "single",
      isCurrent: () => true,
    };
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );
    harness.refs.eventListsRef.current = { [EVENT]: [x, late] };
    act(() =>
      result.current.moveItem(
        "x",
        "__END_OF_LIST__",
        "execute",
        "candidate",
        context,
      ),
    );
    expect(harness.spies.clearRangeSelection).not.toHaveBeenCalled();
    expect(harness.spies.setSortState).not.toHaveBeenCalled();
    expect(harness.spies.updateExecuteModeItems).not.toHaveBeenCalled();
  });
  it("commits a new bulk event through all related stores before navigation", async () => {
    const harness = createHarness({
      activeEventName: null,
      eventLists: {},
      eventMetadata: {},
      dayModes: {},
      items: [],
      executeModeItems: {},
    });
    const inputs = [
      bulkItem("circle-a"),
      bulkItem("circle-b", { eventDate: "day-2" }),
    ];
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    await act(() =>
      result.current.applyBulkAdd("new-event", inputs, {
        url: "https://docs.google.com/spreadsheets/d/source/edit",
        sheetName: "Sheet1",
        source: "spreadsheet",
      }),
    );

    expect(harness.stores.eventLists["new-event"]).toHaveLength(2);
    expect(harness.stores.eventLists["new-event"][0]).toMatchObject({
      source: "spreadsheet",
      protectionLevel: "none",
      catalogPrice: null,
      sheetRemarks: "",
    });
    expect(harness.stores.dayModes["new-event"]).toEqual({
      "day-1": "edit",
      "day-2": "edit",
    });
    expect(harness.stores.executeModeItems["new-event"]).toEqual({
      "day-1": [],
      "day-2": [],
    });
    expect(harness.stores.eventMetadata["new-event"]).toMatchObject({
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/source/edit",
      spreadsheetSheetName: "Sheet1",
    });
    expect(harness.spies.notify).toHaveBeenCalledWith(
      "2 items imported into a new event.",
    );
    expect(harness.spies.openEvent).toHaveBeenCalledWith("new-event", "day-1");
  });

  it("restores explicit layout and execute order in one new-event transaction", async () => {
    const harness = createHarness({
      activeEventName: null,
      eventLists: {},
      dayModes: {},
      items: [],
      executeModeItems: {},
    });
    const candidate = bulkItem("candidate");
    const execute = bulkItem("execute");
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    await act(() =>
      result.current.applyBulkAdd("layout-event", [candidate, execute], {
        source: "app",
        layoutInfo: [
          {
            itemKey: getItemKey(candidate),
            eventDate: DAY,
            columnType: "candidate",
            order: 0,
          },
          {
            itemKey: getItemKey(execute),
            eventDate: DAY,
            columnType: "execute",
            order: 0,
          },
        ],
      }),
    );

    const storedItems = harness.stores.eventLists["layout-event"];
    expect(storedItems.map((stored) => stored.circle)).toEqual([
      "execute",
      "candidate",
    ]);
    expect(harness.stores.executeModeItems["layout-event"][DAY]).toEqual([
      storedItems[0].id,
    ]);
    expect(
      harness.ports.persistence!.commitApplicationSnapshotPatch,
    ).toHaveBeenCalledOnce();
    expect(harness.spies.updateExecuteModeItems).not.toHaveBeenCalled();
    expect(harness.spies.notify).toHaveBeenCalledOnce();
    expect(harness.spies.notify).toHaveBeenCalledWith(
      "2 items imported into a new event.",
    );
  });

  it("leaves every bulk-add state slice unchanged when the atomic commit fails", async () => {
    const harness = createHarness({
      activeEventName: null,
      eventLists: {},
      eventMetadata: {},
      dayModes: {},
      executeModeItems: {},
    });
    harness.ports.persistence.commitApplicationSnapshotPatch = vi.fn(
      async () => {
        throw new Error("transaction aborted");
      },
    );
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    await act(() =>
      result.current.applyBulkAdd("new-event", [bulkItem("candidate")]),
    );

    expect(harness.stores.eventLists).toEqual({});
    expect(harness.stores.eventMetadata).toEqual({});
    expect(harness.stores.dayModes).toEqual({});
    expect(harness.stores.executeModeItems).toEqual({});
    expect(harness.spies.openEvent).not.toHaveBeenCalled();
  });

  it("invalidates stale preview and defers duplicate event mutation", () => {
    const existing = item("existing");
    const harness = createHarness({
      eventLists: { [EVENT]: [existing] },
      items: [existing],
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    let accepted:
      | ReturnType<
          ReturnType<typeof useShoppingItemMutationCommands>["handleBulkAdd"]
        >
      | undefined;
    act(() => {
      accepted = result.current.handleBulkAdd(EVENT, [bulkItem("incoming")], {
        source: "spreadsheet",
      });
    });

    expect(accepted).toBeInstanceOf(Promise);
    expect(harness.refs.eventUpdatePreviewEpochRef.current).toBe(1);
    expect(harness.stores.pendingDuplicateEvent?.analysis.kind).toBe(
      "different-source",
    );
    expect(harness.spies.setEventLists).not.toHaveBeenCalled();
  });

  it("allows explicit app additions to the open event without duplicate review", async () => {
    const existing = item("existing");
    const harness = createHarness({
      eventLists: { [EVENT]: [existing] },
      items: [existing],
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    let accepted:
      | Awaited<
          ReturnType<
            ReturnType<typeof useShoppingItemMutationCommands>["handleBulkAdd"]
          >
        >
      | undefined;
    await act(async () => {
      accepted = await result.current.handleBulkAdd(
        EVENT,
        [bulkItem("manual")],
        {
          source: "app",
        },
      );
      await Promise.resolve();
    });

    expect(accepted).toEqual({ status: "saved", importedItemCount: 1 });
    expect(harness.stores.eventLists[EVENT]).toHaveLength(2);
    expect(harness.stores.eventLists[EVENT][1]).toMatchObject({
      source: "app",
      protectionLevel: "full",
    });
    expect(harness.stores.pendingDuplicateEvent).toBeNull();
  });

  it("updates the current transaction and marks status or quantity changes", () => {
    const original = item("changing", {
      source: "spreadsheet",
      protectionLevel: "none",
    });
    const harness = createHarness({
      eventLists: { [EVENT]: [original] },
      dayModes: { [EVENT]: { [DAY]: "execute" } },
      items: [original],
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );
    harness.stores.eventLists = {
      [EVENT]: [original, item("concurrent")],
    };
    harness.refs.eventListsRef.current = harness.stores.eventLists;

    act(() =>
      result.current.updateItem({
        ...original,
        purchaseStatus: "Purchased",
        quantity: 2,
      }),
    );

    expect(harness.stores.eventLists[EVENT][0]).toMatchObject({
      purchaseStatus: "Purchased",
      quantity: 2,
      protectionLevel: "deletable",
    });
    expect(harness.stores.eventLists[EVENT].map(({ id }) => id)).toEqual([
      "changing",
      "concurrent",
    ]);
    expect(harness.stores.recentlyChangedItemIds).toEqual(
      new Set(["changing"]),
    );
  });

  it("moves an identity-edited item behind the existing destination visit", () => {
    const editing = item("editing", { block: "C", number: "03a" });
    const between = item("between", { block: "B", number: "02a" });
    const destination = item("destination", { block: "A", number: "01a" });
    const items = [editing, between, destination];
    const harness = createHarness({
      eventLists: { [EVENT]: items },
      items,
      executeModeItems: {
        [EVENT]: { [DAY]: ["editing", "between", "destination"] },
      },
      replayEventListUpdater: true,
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    act(() =>
      result.current.updateItem({
        ...editing,
        block: "A",
        number: "01a2",
      }),
    );

    expect(harness.stores.executeModeItems[EVENT][DAY]).toEqual([
      "between",
      "destination",
      "editing",
    ]);
    expect(harness.spies.updateExecuteModeItems).toHaveBeenCalledOnce();
  });

  it("uses hall-group adjacency for multi-space drag and consumes its override", () => {
    const items = [
      item("a", { block: "A", number: "1" }),
      item("b", { block: "B", number: "1" }),
      item("c", { block: "C", number: "1" }),
    ];
    const harness = createHarness({
      eventLists: { [EVENT]: items },
      items,
      selectedItemIds: new Set(["b"]),
      executeModeItems: { [EVENT]: { [DAY]: ["a", "b", "c"] } },
      spaceGroupDragItemIds: ["a", "c"],
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    act(() => result.current.moveItem("a", "b", "execute", "execute"));

    expect(harness.refs.spaceGroupDragItemIdsRef.current).toBeNull();
    expect(harness.spies.areItemsInSameHallGroup).toHaveBeenCalledWith(
      "a",
      "b",
      DAY,
    );
    expect(harness.spies.areItemsInSameHall).not.toHaveBeenCalled();
    expect(harness.stores.executeModeItems[EVENT][DAY]).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(harness.spies.clearRangeSelection).toHaveBeenCalledOnce();
    expect(harness.spies.setSortState).toHaveBeenCalledWith("Manual");
    expect(harness.spies.setBlockSortDirection).toHaveBeenCalledWith(null);
  });

  it("notifies when candidate D&D joins an existing execution visit", () => {
    const between = item("between", { block: "B", number: "2" });
    const a1 = item("a1", { block: "A", number: "1a" });
    const a2 = item("a2", { block: "A", number: "1a2" });
    const items = [between, a1, a2];
    const harness = createHarness({
      eventLists: { [EVENT]: items },
      items,
      executeModeItems: { [EVENT]: { [DAY]: ["between", "a1"] } },
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    act(() => result.current.moveItem("a2", "between", "execute", "candidate"));

    expect(harness.stores.executeModeItems[EVENT][DAY]).toEqual([
      "between",
      "a1",
      "a2",
    ]);
    expect(harness.spies.notify).toHaveBeenCalledOnce();
    expect(harness.spies.notify).toHaveBeenCalledWith(
      "同じ訪問先の商品として追加しました。訪問順は変更していません。",
    );
  });

  it("moves an execute space-priority block across the adjacent block", () => {
    const items = [
      item("a", { block: "A", number: "1" }),
      item("b-1", { block: "B", number: "1" }),
      item("b-2", { block: "B", number: "1" }),
      item("c", { block: "C", number: "1" }),
    ];
    const harness = createHarness({
      eventLists: { [EVENT]: items },
      items,
      executeModeItems: {
        [EVENT]: { [DAY]: ["a", "b-1", "b-2", "c"] },
      },
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    act(() => result.current.moveItemDown("b-1", "execute"));

    expect(harness.stores.executeModeItems[EVENT][DAY]).toEqual([
      "a",
      "c",
      "b-1",
      "b-2",
    ]);
    expect(harness.spies.areItemsInSameHall).toHaveBeenCalledWith(
      "b-1",
      "c",
      DAY,
    );
    expect(harness.spies.areItemsInSameHallGroup).not.toHaveBeenCalled();
  });

  it("moves a noncontiguous execution visit without capturing intervening visits", () => {
    const items = [
      item("a1", { block: "A", number: "1a" }),
      item("b", { block: "B", number: "2" }),
      item("a2", { block: "A", number: "1a2" }),
      item("c", { block: "C", number: "3" }),
    ];
    const harness = createHarness({
      eventLists: { [EVENT]: items },
      items,
      executeModeItems: {
        [EVENT]: { [DAY]: ["a1", "b", "a2", "c"] },
      },
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    act(() => result.current.moveItemDown("a2", "execute"));

    expect(harness.stores.executeModeItems[EVENT][DAY]).toEqual([
      "b",
      "a1",
      "a2",
      "c",
    ]);
  });

  it("moves a split leading visit after its logical neighbor", () => {
    const items = [
      item("b1", { block: "B", number: "2a" }),
      item("c", { block: "C", number: "3" }),
      item("b2", { block: "B", number: "2a2" }),
    ];
    const harness = createHarness({
      eventLists: { [EVENT]: items },
      items,
      executeModeItems: { [EVENT]: { [DAY]: ["b1", "c", "b2"] } },
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    act(() => result.current.moveItemDown("b1", "execute"));

    expect(harness.stores.executeModeItems[EVENT][DAY]).toEqual([
      "c",
      "b1",
      "b2",
    ]);
  });

  it("handles execute visit boundary no-ops without falling back to raw movement", () => {
    const items = [
      item("a1", { block: "A", number: "1a" }),
      item("b", { block: "B", number: "2" }),
      item("a2", { block: "A", number: "1a2" }),
    ];
    const harness = createHarness({
      eventLists: { [EVENT]: items },
      items,
      executeModeItems: { [EVENT]: { [DAY]: ["a1", "b", "a2"] } },
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    act(() => result.current.moveItemUp("a2", "execute"));
    act(() => result.current.moveItemDown("b", "execute"));

    expect(harness.stores.executeModeItems[EVENT][DAY]).toEqual([
      "a1",
      "b",
      "a2",
    ]);
    expect(harness.spies.updateExecuteModeItems).not.toHaveBeenCalled();
  });

  it("blocks a logical execute visit from crossing a hall boundary", () => {
    const items = [
      item("a1", { block: "A", number: "1a" }),
      item("b", { block: "B", number: "2" }),
      item("a2", { block: "A", number: "1a2" }),
    ];
    const harness = createHarness({
      eventLists: { [EVENT]: items },
      items,
      executeModeItems: { [EVENT]: { [DAY]: ["a1", "b", "a2"] } },
      areItemsInSameHall: () => false,
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    act(() => result.current.moveItemDown("a1", "execute"));

    expect(harness.stores.executeModeItems[EVENT][DAY]).toEqual([
      "a1",
      "b",
      "a2",
    ]);
    expect(harness.spies.areItemsInSameHall).toHaveBeenCalledWith(
      "a1",
      "b",
      DAY,
    );
    expect(harness.spies.updateExecuteModeItems).not.toHaveBeenCalled();
  });

  it("uses the synchronously committed execute order across immediate column commands", () => {
    const items = [
      item("execute", { block: "A", number: "1" }),
      item("candidate-1", { block: "B", number: "2" }),
      item("candidate-2", { block: "B", number: "2" }),
    ];
    const harness = createHarness({
      eventLists: { [EVENT]: items },
      items,
      executeModeItems: { [EVENT]: { [DAY]: ["execute"] } },
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    act(() => result.current.moveToExecuteColumn(["candidate-1"]));
    expect(harness.refs.executeModeItemsRef.current[EVENT][DAY]).toEqual([
      "execute",
      "candidate-1",
      "candidate-2",
    ]);

    act(() => result.current.removeFromExecuteColumn(["candidate-1"]));
    expect(harness.refs.executeModeItemsRef.current[EVENT][DAY]).toEqual([
      "execute",
    ]);
    expect(harness.spies.clearSelection).toHaveBeenCalledTimes(2);
  });

  it("notifies once when move-to-execute joins an existing visit", () => {
    const a1 = item("a1", { block: "A", number: "1a" });
    const a2 = item("a2", { block: "A", number: "1a2" });
    const items = [a1, a2];
    const harness = createHarness({
      eventLists: { [EVENT]: items },
      items,
      executeModeItems: { [EVENT]: { [DAY]: ["a1"] } },
      replayExecuteUpdater: true,
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    act(() => result.current.moveToExecuteColumn(["a2"]));

    expect(harness.stores.executeModeItems[EVENT][DAY]).toEqual(["a1", "a2"]);
    expect(harness.spies.notify).toHaveBeenCalledOnce();
    expect(harness.spies.notify).toHaveBeenCalledWith(
      "同じ訪問先の商品として追加しました。訪問順は変更していません。",
    );
  });

  it("deletes one item from the event and every execute day before confirming", () => {
    const deleted = item("deleted");
    const kept = item("kept");
    const harness = createHarness({
      eventLists: { [EVENT]: [deleted, kept] },
      items: [deleted, kept],
      itemToDelete: deleted,
      executeModeItems: {
        [EVENT]: { [DAY]: ["kept", "deleted"], "day-2": ["deleted"] },
      },
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    act(() => result.current.confirmDeleteItem());

    expect(harness.stores.eventLists[EVENT]).toEqual([kept]);
    expect(harness.stores.executeModeItems[EVENT]).toEqual({
      [DAY]: ["kept"],
      "day-2": [],
    });
    expect(harness.spies.confirmItemDelete).toHaveBeenCalledOnce();
  });

  it("sorts only the active date by block and keeps empty blocks last", () => {
    const otherDate = item("other", { eventDate: "day-2", block: "0" });
    const block10 = item("block-10", {
      eventDate: PADDED_DAY,
      block: "A10",
    });
    const empty = item("empty", { block: "" });
    const block2 = item("block-2", { block: "A2" });
    const harness = createHarness({
      eventLists: { [EVENT]: [block10, otherDate, empty, block2] },
      items: [block10, otherDate, empty, block2],
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    act(() => result.current.toggleBlockSort());

    expect(harness.stores.eventLists[EVENT].map(({ id }) => id)).toEqual([
      "block-2",
      "other",
      "block-10",
      "empty",
    ]);
    expect(harness.stores.blockSortDirection).toBe("asc");
    expect(harness.spies.clearSelection).toHaveBeenCalledOnce();
  });

  it("sorts candidate blocks without moving execute-column slots", () => {
    const candidateB = item("candidate-b", {
      eventDate: PADDED_DAY,
      block: "B",
    });
    const execute = item("execute", { block: "Z" });
    const candidateA = item("candidate-a", { block: "A" });
    const harness = createHarness({
      eventLists: { [EVENT]: [candidateB, execute, candidateA] },
      items: [candidateB, execute, candidateA],
      executeModeItems: { [EVENT]: { [DAY]: ["execute"] } },
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    act(() => result.current.toggleCandidateBlockSort());

    expect(harness.stores.eventLists[EVENT].map(({ id }) => id)).toEqual([
      "candidate-a",
      "execute",
      "candidate-b",
    ]);
    expect(harness.stores.blockSortDirection).toBe("asc");
  });

  it("sorts only candidate numbers inside the selected block filter", () => {
    const a10 = item("a-10", {
      eventDate: PADDED_DAY,
      block: "A",
      number: "10",
    });
    const b1 = item("b-1", { block: "B", number: "1" });
    const execute = item("execute", { block: "A", number: "0" });
    const a2 = item("a-2", { block: "A", number: "2" });
    const harness = createHarness({
      eventLists: { [EVENT]: [a10, b1, execute, a2] },
      items: [a10, b1, execute, a2],
      selectedBlockFilters: new Set(["A"]),
      executeModeItems: { [EVENT]: { [DAY]: ["execute"] } },
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    act(() => result.current.toggleCandidateNumberSort());

    expect(harness.stores.eventLists[EVENT].map(({ id }) => id)).toEqual([
      "a-2",
      "b-1",
      "execute",
      "a-10",
    ]);
    expect(harness.stores.candidateNumberSortDirection).toBe("asc");
    expect(harness.spies.clearSelection).toHaveBeenCalledOnce();
  });

  it("does not mutate or reset selection when no event is active", () => {
    const harness = createHarness({
      activeEventName: null,
      eventLists: {},
      items: [],
      executeModeItems: {},
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(harness.ports),
    );

    act(() => {
      result.current.updateItem(item("ignored"));
      result.current.moveItem("a", "b");
      result.current.moveItemUp("a");
      result.current.moveToExecuteColumn(["a"]);
      result.current.removeFromExecuteColumn(["a"]);
      result.current.confirmDeleteItem();
      result.current.toggleBlockSort();
      result.current.toggleCandidateBlockSort();
      result.current.toggleCandidateNumberSort();
    });

    expect(harness.spies.setEventLists).not.toHaveBeenCalled();
    expect(harness.spies.updateExecuteModeItems).not.toHaveBeenCalled();
    expect(harness.spies.clearRangeSelection).not.toHaveBeenCalled();
    expect(harness.spies.clearSelection).not.toHaveBeenCalled();
    expect(harness.spies.confirmItemDelete).not.toHaveBeenCalled();
  });
});

it.each(["rendered item", "form baseline"] as const)(
  "keeps newer purchase fields when changing only priority from a %s",
  (baseline) => {
    const original = item("editing", {
      price: 500,
      remarks: "元のメモ",
      priorityLevel: "none",
    });
    const purchase = {
      purchaseStatus: "Purchased" as const,
      price: 900,
      quantity: 2,
      remarks: "新しいメモ",
    };
    const latest = { ...original, ...purchase };
    const rendered = baseline === "form baseline" ? latest : original;
    const h = createHarness({
      eventLists: { [EVENT]: [rendered] },
      items: [rendered],
    });
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(h.ports),
    );
    h.stores.eventLists = { [EVENT]: [latest] };
    h.refs.eventListsRef.current = h.stores.eventLists;
    act(() => {
      const changed = { ...original, priorityLevel: "highest" as const };
      if (baseline === "form baseline")
        result.current.updateItem(changed, original);
      else result.current.updateItem(changed);
    });
    expect(h.stores.eventLists[EVENT][0]).toMatchObject({
      ...purchase,
      priorityLevel: "highest",
    });
  },
);

it("applies explicitly edited purchase fields while preserving other newer fields", () => {
  const original = item("editing", { price: 500, remarks: "元のメモ" });
  const latest = {
    ...original,
    purchaseStatus: "Purchased" as const,
    price: 900,
    quantity: 2,
    remarks: "新しいメモ",
  };
  const h = createHarness({
    eventLists: { [EVENT]: [latest] },
    items: [latest],
  });
  const { result } = renderHook(() => useShoppingItemMutationCommands(h.ports));
  act(() => {
    result.current.updateItem(
      { ...original, price: 800, remarks: "編集したメモ" },
      original,
    );
  });
  expect(h.stores.eventLists[EVENT][0]).toMatchObject({
    purchaseStatus: "Purchased",
    price: 800,
    quantity: 2,
    remarks: "編集したメモ",
  });
});

it("preserves every accepted transition when a rapid cycle returns to the rendered status", () => {
  const original = item("rapid", { purchaseStatus: "SoldOut", price: 500 });
  const h = createHarness({
    eventLists: { [EVENT]: [original] },
    items: [original],
  });
  const { result } = renderHook(() => useShoppingItemMutationCommands(h.ports));
  let accepted = original;
  act(() => {
    for (const purchaseStatus of [
      "Absent",
      "Postpone",
      "Late",
      "None",
      "Purchased",
      "SoldOut",
    ] as const) {
      const changed = rememberItemUpdateBaseline(
        { ...accepted, purchaseStatus },
        accepted,
      );
      result.current.updateItem(changed);
      accepted = h.refs.eventListsRef.current[EVENT][0];
      expect(accepted.purchaseStatus).toBe(purchaseStatus);
    }
    const recorded = rememberItemUpdateBaseline(
      { ...accepted, remarks: "通販･頒布確認：可能" },
      accepted,
    );
    result.current.updateItem(recorded);
  });
  expect(h.stores.eventLists[EVENT][0]).toMatchObject({
    purchaseStatus: "SoldOut",
    remarks: "通販･頒布確認：可能",
  });
});

it("distinguishes a saved import from failure to navigate after its commit", async () => {
  const h = createHarness({ activeEventName: null, eventLists: {} });
  h.spies.openEvent.mockImplementation(() => {
    throw new Error("UI failed");
  });
  const { result } = renderHook(() => useShoppingItemMutationCommands(h.ports));
  const outcome = await result.current.applyBulkAdd("新規", [bulkItem("A")]);
  expect(outcome.status).toBe("committed-ui-failed");
  expect(h.stores.eventLists["新規"]).toHaveLength(1);
  expect(
    h.ports.persistence!.commitApplicationSnapshotPatch,
  ).toHaveBeenCalledTimes(1);
});
it("keeps a new input or view intact when an older import finishes saving", async () => {
  const h = createHarness({ activeEventName: null, eventLists: {} });
  let current = true;
  let finish!: () => void;
  h.ports.persistence!.commitApplicationSnapshotPatch = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = renderHook(() => useShoppingItemMutationCommands(h.ports));
  const pending = result.current.applyBulkAdd("旧入力", [bulkItem("A")], {
    request: { id: "old", isCurrent: () => current },
  });
  current = false;
  finish();
  expect((await pending).status).toBe("saved");
  expect(h.spies.notify).not.toHaveBeenCalled();
  expect(h.spies.openEvent).not.toHaveBeenCalled();
  expect(h.spies.showImport).not.toHaveBeenCalled();
});

it.each([false, true])(
  "passes limited purchase intent through single and bulk field commands, bulk=%s",
  async (bulk) => {
    const { buildLimitedPurchaseDialogUpdate } =
      await import("../../utils/limitedPurchaseIntent");
    const original = item("limited", { quantity: 5 });
    const h = createHarness({
      eventLists: { [EVENT]: [original] },
      items: [original],
    });
    const updateItemFields = vi.fn();
    h.ports.actions.updateItemFields = updateItemFields;
    const { result } = renderHook(() =>
      useShoppingItemMutationCommands(h.ports),
    );
    const intent = {
      kind: "purchased",
      actual: 5,
      planned: 5,
      plannedEdited: false,
      observedPlanned: 5,
    } as const;
    const updated = buildLimitedPurchaseDialogUpdate(original, intent)!;
    act(() =>
      bulk
        ? result.current.updateItems([updated])
        : result.current.updateItem(updated),
    );
    const call = updateItemFields.mock.calls[0][0];
    expect((bulk ? call[0] : call).limitedPurchase).toEqual(intent);
    expect(updated).not.toHaveProperty("limitedPurchase");
  },
);

it("returns the actual saved count after deduplicating a new import", async () => {
  const harness = createHarness({
    activeEventName: null,
    eventLists: {},
    items: [],
  });
  const { result } = renderHook(() =>
    useShoppingItemMutationCommands(harness.ports),
  );
  const first = bulkItem("ユーザー登録");
  let saved;
  await act(async () => {
    saved = await result.current.handleBulkAdd("新規", [first, { ...first }], {
      source: "spreadsheet",
    });
  });
  expect(saved).toEqual({ status: "saved", importedItemCount: 1 });
  expect(harness.stores.eventLists["新規"]).toHaveLength(1);
  expect(harness.spies.notify).toHaveBeenCalledWith(
    "1 items imported into a new event.",
  );
});

it("[ID 9] captures duplicate ownership and its displayed request before choosing a resolution", async () => {
  const h = createHarness();
  const registry = createEventUpdateOperationRegistry();
  Object.assign(h.ports.state, {
    eventUpdateOperationsRef: { current: registry },
  });
  let inputCurrent = true;
  h.ports.actions.openDuplicateEvent = vi.fn((pending) => {
    expect(registry.current?.id).toBe(pending.updateOperationId);
    h.stores.pendingDuplicateEvent = pending;
    return "duplicate-owned";
  });
  const { result } = renderHook(() => useShoppingItemMutationCommands(h.ports));
  let completion!: Promise<import("../../types/import").BulkImportResult>;
  act(() => {
    completion = result.current.handleBulkAdd(EVENT, [bulkItem("incoming")], {
      source: "spreadsheet",
      request: { id: "input", isCurrent: () => inputCurrent },
    });
  });
  const owner = registry.current!;
  expect(owner.requestId).toBe("duplicate-owned");
  inputCurrent = false;
  expect(owner.isCurrentInput?.()).toBe(false);
  act(() => registry.finish(owner.id, { status: "invalidated" }));
  await expect(completion).resolves.toEqual({ status: "invalidated" });
});

it("[ID 8] rejects a new import while preserving the submitted update and completion", async () => {
  const h = createHarness();
  const registry = createEventUpdateOperationRegistry();
  Object.assign(h.ports.state, {
    eventUpdateOperationsRef: { current: registry },
  });
  const complete = vi.fn();
  const owner = registry.start({ eventName: EVENT, complete })!;
  registry.changePhase(owner, "saving");
  const { result } = renderHook(() => useShoppingItemMutationCommands(h.ports));
  let outcome: import("../../types/import").BulkImportResult | undefined;
  await act(async () => {
    outcome = await result.current.handleBulkAdd(
      EVENT,
      [bulkItem("incoming")],
      { source: "spreadsheet" },
    );
  });
  expect(outcome).toEqual({ status: "invalidated" });
  expect(registry.current).toBe(owner);
  expect(complete).not.toHaveBeenCalled();
  expect(h.spies.openDuplicateEvent).not.toHaveBeenCalled();
  expect(h.refs.eventUpdatePreviewEpochRef.current).toBe(0);
});

it("[ID 9] replacing a duplicate selection resolves only the earlier waiting import", async () => {
  const h = createHarness();
  const registry = createEventUpdateOperationRegistry();
  Object.assign(h.ports.state, {
    eventUpdateOperationsRef: { current: registry },
  });
  const { result } = renderHook(() => useShoppingItemMutationCommands(h.ports));
  let first!: Promise<import("../../types/import").BulkImportResult>;
  let second!: Promise<import("../../types/import").BulkImportResult>;
  act(() => {
    first = result.current.handleBulkAdd(EVENT, [bulkItem("first")], {
      source: "spreadsheet",
    });
    second = result.current.handleBulkAdd(EVENT, [bulkItem("second")], {
      source: "spreadsheet",
    });
  });
  await expect(first).resolves.toEqual({ status: "invalidated" });
  const owner = registry.current!;
  expect(h.stores.pendingDuplicateEvent?.updateOperationId).toBe(owner.id);
  act(() => registry.finish(owner.id, { status: "cancelled" }));
  await expect(second).resolves.toEqual({ status: "cancelled" });
});

it("[ID 3] rechecks the captured import input in the queued save guard", async () => {
  const h = createHarness();
  let current = true;
  let queued!: import("./ApplicationSnapshotCommitPort").ApplicationSnapshotGuard;
  let continueSave!: () => void;
  const proceed = new Promise<void>((resolve) => {
    continueSave = resolve;
  });
  h.ports.persistence.commitApplicationSnapshotPatch = vi.fn(
    async (_patch, _settings, _context, guard) => {
      queued = guard!;
      await proceed;
      queued({
        ...emptyApplicationSnapshotForImport(),
        eventLists: h.stores.eventLists,
      });
    },
  );
  const { result } = renderHook(() => useShoppingItemMutationCommands(h.ports));
  let saving!: Promise<import("../../types/import").BulkImportResult>;
  act(() => {
    saving = result.current.applyBulkAdd(EVENT, [bulkItem("incoming")], {
      request: { id: "input", isCurrent: () => current },
    });
  });
  expect(queued).toBeTypeOf("function");
  current = false;
  let outcome: import("../../types/import").BulkImportResult | undefined;
  await act(async () => {
    continueSave();
    outcome = await saving;
  });
  expect(outcome).toEqual({ status: "invalidated" });
  expect(h.stores.eventLists[EVENT]).toHaveLength(1);
  expect(h.spies.notify).not.toHaveBeenCalled();
});

it("[ID 9] a reentrant later import keeps its ownership when an earlier import is replaced", async () => {
  const h = createHarness();
  const registry = createEventUpdateOperationRegistry();
  Object.assign(h.ports.state, {
    eventUpdateOperationsRef: { current: registry },
  });
  const { result } = renderHook(() => useShoppingItemMutationCommands(h.ports));
  let later!: Promise<import("../../types/import").BulkImportResult>;
  registry.start({
    eventName: EVENT,
    complete: () => {
      later = result.current.handleBulkAdd(EVENT, [bulkItem("later")], {
        source: "spreadsheet",
      });
    },
  });
  let outcome: import("../../types/import").BulkImportResult | undefined;
  await act(async () => {
    outcome = await result.current.handleBulkAdd(EVENT, [bulkItem("outer")], {
      source: "spreadsheet",
    });
  });
  expect(outcome).toEqual({ status: "invalidated" });
  expect(h.stores.pendingDuplicateEvent?.analysis.incomingItems[0].circle).toBe(
    "later",
  );
  const owner = registry.current!;
  act(() => registry.finish(owner.id, { status: "cancelled" }));
  await expect(later).resolves.toEqual({ status: "cancelled" });
});

it("[ID 9] a stale incoming import cannot invalidate a later selection owner", async () => {
  const h = createHarness();
  const registry = createEventUpdateOperationRegistry();
  Object.assign(h.ports.state, {
    eventUpdateOperationsRef: { current: registry },
  });
  const complete = vi.fn();
  const owner = registry.start({ eventName: EVENT, complete })!;
  const { result } = renderHook(() => useShoppingItemMutationCommands(h.ports));
  let outcome: import("../../types/import").BulkImportResult | undefined;
  await act(async () => {
    outcome = await result.current.handleBulkAdd(EVENT, [bulkItem("stale")], {
      source: "spreadsheet",
      request: { id: "stale", isCurrent: () => false },
    });
  });
  expect(outcome).toEqual({ status: "invalidated" });
  expect(registry.current).toBe(owner);
  expect(complete).not.toHaveBeenCalled();
  expect(h.refs.eventUpdatePreviewEpochRef.current).toBe(0);
  expect(h.spies.openDuplicateEvent).not.toHaveBeenCalled();
});
