import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useRef, useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../../types/item";
import type { DayMapData } from "../../types/map";

const mapCanvasRenderSpy = vi.hoisted(() => vi.fn());
const popupRenderSpy = vi.hoisted(() => vi.fn());
vi.mock("./CellItemsPopup", async (importOriginal) => {
  const { default: ActualPopup } =
    await importOriginal<typeof import("./CellItemsPopup")>();
  return {
    default: (props: ComponentProps<typeof ActualPopup>) => {
      popupRenderSpy(props);
      return <ActualPopup {...props} />;
    },
  };
});

vi.mock("./MapCanvas", () => ({
  default: (props: {
    items: ShoppingItem[];
    onCellClick?: (
      row: number,
      col: number,
      matchingItems: ShoppingItem[],
    ) => void;
  }) => {
    mapCanvasRenderSpy(props);
    return (
      <button
        type="button"
        data-testid="map-canvas-mock"
        onClick={() => props.onCellClick?.(1, 1, props.items)}
      />
    );
  },
}));

import MapView from "./MapView";
import type CellItemsPopup from "./CellItemsPopup";
import { useApplicationSnapshot } from "../../app/state/useApplicationSnapshot";
import { useShoppingItemMutationCommands } from "../../app/commands/useShoppingItemMutationCommands";
import { useIndexedDbPersistence } from "../../hooks/useIndexedDbPersistence";
import { resetDatabaseConnection } from "../../persistence/db/openDatabase";
import {
  commits,
  fresh,
  port,
  seed,
} from "../../test/sheetImportOptionalUrlPersistence";
import {
  sheetSnapshot,
  SHEET_EVENT,
} from "../../test/sheetImportOptionalUrlFixtures";
import {
  computeBatchAddToExecuteListFromMapWithResult,
  computeInsertIntoExecuteAtPosition,
} from "../../features/events/itemOps";

const item = (id: string, number: string): ShoppingItem => ({
  id,
  circle: id,
  eventDate: "Day1",
  block: "A",
  number,
  title: "",
  price: null,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "",
  priorityLevel: "none",
});

const mapData: DayMapData = {
  sheetName: "Day1マップ",
  rows: 3,
  cols: 3,
  maxRow: 3,
  maxCol: 3,
  cells: [],
  mergedCells: [],
  blocks: [
    {
      name: "A",
      startRow: 1,
      startCol: 1,
      endRow: 3,
      endCol: 3,
      numberCells: [
        { row: 1, col: 1, value: 1 },
        { row: 2, col: 1, value: 2 },
      ],
    },
  ],
};

describe("MapView visit projection", () => {
  it("keeps all member IDs for canvas membership while routing representatives", () => {
    const items = [item("a1", "01a"), item("b", "02a"), item("a2", "01a2")];

    render(
      <MapView
        mapData={mapData}
        mapName="Day1マップ"
        operationScope='["event",0,"Day1","Day1マップ"]'
        items={items}
        executeModeItemIds={["a1", "b", "a2"]}
        onAddToExecuteList={vi.fn()}
        onRemoveFromExecuteList={vi.fn()}
        onMoveToFirst={vi.fn()}
        onMoveToLast={vi.fn()}
        halls={[]}
        hallRouteSettings={{ hallOrder: [], hallVisitLists: [] }}
        onUpdateHallRouteSettings={vi.fn()}
      />,
    );

    const canvasProps = mapCanvasRenderSpy.mock.calls.at(-1)?.[0] as {
      executeModeItemIds: string[];
      routePointsOverride: Array<{ itemId: string }>;
    };
    expect(canvasProps.executeModeItemIds).toEqual(["a1", "b", "a2"]);
    expect(
      canvasProps.routePointsOverride.map((point) => point.itemId),
    ).toEqual(["a1", "b"]);
  });

  it("shows a notice when a positioned add merges into an existing visit", () => {
    const a1 = item("a1", "01a");
    const a2 = item("a2", "01a2");
    const insertResult = computeInsertIntoExecuteAtPosition(
      ["a2"],
      "a1",
      "after",
      { Day1: ["a1"] },
      "Day1",
      [a1, a2],
    );

    render(
      <MapView
        mapData={mapData}
        mapName="Day1マップ"
        operationScope='["event",0,"Day1","Day1マップ"]'
        items={[a1, a2]}
        executeModeItemIds={["a1"]}
        onAddToExecuteList={vi.fn()}
        onAddToExecuteListAtPosition={() => insertResult.insertedItemIds}
        onRemoveFromExecuteList={vi.fn()}
        onMoveToFirst={vi.fn()}
        onMoveToLast={vi.fn()}
        halls={[]}
        hallRouteSettings={{ hallOrder: [], hallVisitLists: [] }}
        onUpdateHallRouteSettings={vi.fn()}
        smartInsertEnabled={false}
      />,
    );

    fireEvent.click(screen.getByTestId("map-canvas-mock"));
    fireEvent.click(screen.getByText("タップで追加"));

    expect(screen.getByRole("status")).toHaveTextContent(
      "同じ訪問先の商品として追加しました。訪問順は変更していません。",
    );
  });

  it("restarts the notice timer when the same merge message is shown again", () => {
    vi.useFakeTimers();
    try {
      const a1 = item("a1", "01a");
      const a2 = item("a2", "01a2");
      const insertResult = computeInsertIntoExecuteAtPosition(
        ["a2"],
        "a1",
        "after",
        { Day1: ["a1"] },
        "Day1",
        [a1, a2],
      );

      render(
        <MapView
          mapData={mapData}
          mapName="Day1マップ"
          operationScope='["event",0,"Day1","Day1マップ"]'
          items={[a1, a2]}
          executeModeItemIds={["a1"]}
          onAddToExecuteList={vi.fn()}
          onAddToExecuteListAtPosition={() => insertResult.insertedItemIds}
          onRemoveFromExecuteList={vi.fn()}
          onMoveToFirst={vi.fn()}
          onMoveToLast={vi.fn()}
          halls={[]}
          hallRouteSettings={{ hallOrder: [], hallVisitLists: [] }}
          onUpdateHallRouteSettings={vi.fn()}
          smartInsertEnabled={false}
        />,
      );

      const showMergeNotice = () => {
        fireEvent.click(screen.getByTestId("map-canvas-mock"));
        fireEvent.click(screen.getByText("タップで追加"));
      };
      showMergeNotice();
      act(() => vi.advanceTimersByTime(4000));
      showMergeNotice();
      act(() => vi.advanceTimersByTime(1500));
      expect(screen.getByRole("status")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(3501));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the merge notice when only part of a normal batch joins an existing visit", () => {
    const a1 = item("a1", "01a");
    const a2 = item("a2", "01a2");
    const priorityVisit = {
      ...item("priority", "01a3"),
      priorityLevel: "priority" as const,
    };
    const items = [a1, a2, priorityVisit];
    const batchResult = computeBatchAddToExecuteListFromMapWithResult(
      ["a2", "priority"],
      "Day1",
      items,
      { Day1: ["a1"] },
      [],
      { hallOrder: [], hallVisitLists: [] },
      mapData,
    );

    render(
      <MapView
        mapData={mapData}
        mapName="Day1マップ"
        operationScope='["event",0,"Day1","Day1マップ"]'
        items={items}
        executeModeItemIds={["a1"]}
        onAddToExecuteList={vi.fn()}
        onBatchAddToExecuteList={() => batchResult.insertedItemIds}
        onRemoveFromExecuteList={vi.fn()}
        onMoveToFirst={vi.fn()}
        onMoveToLast={vi.fn()}
        halls={[]}
        hallRouteSettings={{ hallOrder: [], hallVisitLists: [] }}
        onUpdateHallRouteSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("map-canvas-mock"));
    fireEvent.click(screen.getByTitle(/1\/3件追加済み/));

    expect(screen.getByRole("status")).toHaveTextContent(
      "同じ訪問先の商品として追加しました。訪問順は変更していません。",
    );
  });
});

const scope = (day = "Day1", generation = 0, map = `${day}マップ`) =>
  JSON.stringify(["event", generation, day, map]);
const scopedProps = (
  overrides: Partial<ComponentProps<typeof MapView>> = {},
): ComponentProps<typeof MapView> => ({
  mapData,
  mapName: "Day1マップ",
  operationScope: scope(),
  eventDate: "Day1",
  items: [item("scope-item", "01a")],
  executeModeItemIds: [],
  onAddToExecuteList: vi.fn(),
  onRemoveFromExecuteList: vi.fn(),
  onMoveToFirst: vi.fn(),
  onMoveToLast: vi.fn(),
  halls: [],
  hallRouteSettings: { hallOrder: [], hallVisitLists: [] },
  onUpdateHallRouteSettings: vi.fn(),
  ...overrides,
});
const latestPopup = () =>
  popupRenderSpy.mock.calls.at(-1)![0] as ComponentProps<typeof CellItemsPopup>;

afterEach(() => {
  resetDatabaseConnection();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MapView popup operation scope", () => {
  it.each([
    { name: "day A to B to A", scopes: [scope("Day2"), scope()] },
    { name: "same-name event replacement", scopes: [scope("Day1", 1)] },
    { name: "map replacement", scopes: [scope("Day1", 0, "別マップ")] },
  ])("rejects every retained old callback after $name", ({ scopes }) => {
    const callbacks = {
      onUpdateItem: vi.fn(),
      onUpdateItemPriority: vi.fn(),
      onDeleteItem: vi.fn(),
      onAddItem: vi.fn(),
      onEditRequest: vi.fn(),
      onAddToExecuteList: vi.fn(),
      onRemoveFromExecuteList: vi.fn(),
      onBatchAddToExecuteList: vi.fn(),
      onBatchRemoveFromExecuteList: vi.fn(),
    };
    const props = scopedProps(callbacks);
    const { rerender } = render(<MapView {...props} />);
    fireEvent.click(screen.getByTestId("map-canvas-mock"));
    const old = latestPopup();
    for (const operationScope of scopes)
      rerender(<MapView {...props} operationScope={operationScope} />);
    expect(
      screen.queryByRole("dialog", { name: "A-1のアイテム一覧" }),
    ).not.toBeInTheDocument();
    act(() => {
      old.onUpdateItem?.(
        { ...props.items[0], remarks: "旧画面" },
        props.items[0],
      );
      old.onUpdateItemPriority?.(props.items[0].id, "priority");
      old.onDeleteItem?.(props.items[0].id);
      old.onEditRequest?.(props.items[0]);
      old.onAddItem?.({ ...props.items[0], id: undefined } as unknown as Omit<
        ShoppingItem,
        "id"
      >);
      old.onAddToVisitList(props.items[0].id);
      old.onRemoveFromVisitList(props.items[0].id);
      old.onBatchAddToVisitList?.([props.items[0].id]);
      old.onBatchRemoveFromVisitList?.([props.items[0].id]);
      old.onClose();
    });
    for (const callback of Object.values(callbacks))
      expect(callback).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("map-canvas-mock"));
    expect(
      screen.getByRole("dialog", { name: "A-1のアイテム一覧" }),
    ).toBeInTheDocument();
    act(() => old.onClose());
    expect(
      screen.getByRole("dialog", { name: "A-1のアイテム一覧" }),
    ).toBeInTheDocument();
  });

  it("rejects a closed session after reopening the same scope and preserves update baselines", () => {
    const onUpdateItem = vi.fn();
    const props = scopedProps({ onUpdateItem });
    const { rerender } = render(<MapView {...props} />);
    fireEvent.click(screen.getByTestId("map-canvas-mock"));
    const old = latestPopup();
    act(() => old.onClose());
    fireEvent.click(screen.getByTestId("map-canvas-mock"));
    const current = latestPopup();
    act(() =>
      old.onUpdateItem?.({ ...props.items[0], remarks: "old" }, props.items[0]),
    );
    expect(onUpdateItem).not.toHaveBeenCalled();
    const updated = { ...props.items[0], remarks: "first accepted" };
    act(() => current.onUpdateItem?.(updated, props.items[0]));
    expect(onUpdateItem).toHaveBeenLastCalledWith(updated, props.items[0]);
    expect(onUpdateItem.mock.calls[0][1]).toBe(props.items[0]);
    rerender(<MapView {...props} items={[updated]} />);
    const next = { ...updated, remarks: "second accepted" };
    act(() => latestPopup().onUpdateItem?.(next, updated));
    expect(onUpdateItem).toHaveBeenLastCalledWith(next, updated);
    expect(onUpdateItem).toHaveBeenCalledTimes(2);
  });
});

for (const mode of ["direct", "worker"]) {
  it(`preserves real-popup baseline field intent across failure, invalidation and retry: ${mode}`, async () => {
    fresh();
    const initial = sheetSnapshot(1);
    initial.eventLists[SHEET_EVENT][0].number = "01a";
    await seed(initial);
    const commands = port(mode);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const accepted: Array<[ShoppingItem, ShoppingItem | undefined]> = [];
    let application!: ReturnType<typeof useApplicationSnapshot>;
    let mutations!: ReturnType<typeof useShoppingItemMutationCommands>;
    const updateThroughMutation = vi.fn(
      (updated: ShoppingItem, baseline?: ShoppingItem) =>
        mutations.updateItem(updated, baseline),
    );
    let setDay!: (day: string) => void;
    function Harness() {
      const [day, changeDay] = useState("1日目");
      setDay = changeDay;
      application = useApplicationSnapshot(commands, SHEET_EVENT, day);
      const persistence = useIndexedDbPersistence({
        values: application.raw,
        setters: application.hydrationSetters,
        onHydratedSnapshot: application.coordinator.initializeEventGenerations,
        persistenceCommands: commands,
        externalMutations: true,
      });
      application.handlers.current = {
        drain: persistence.flushPendingSave,
        observeSnapshot: persistence.observeSnapshot,
        applied: persistence.acceptCommittedSnapshot,
      };
      const values = application.values;
      const eventListsRef = useRef(values.eventLists);
      const executeModeItemsRef = useRef(values.executeModeItems);
      eventListsRef.current = values.eventLists;
      executeModeItemsRef.current = values.executeModeItems;
      mutations = useShoppingItemMutationCommands({
        state: {
          activeEventName: SHEET_EVENT,
          activeEventDate: day,
          getEventGeneration: application.coordinator.generation,
          eventLists: values.eventLists,
          eventListsRef,
          eventMetadata: values.eventMetadata,
          dayModes: values.dayModes,
          items: values.eventLists[SHEET_EVENT] ?? [],
          selectedItemIds: new Set(),
          selectedBlockFilters: new Set(),
          blockSortDirection: null,
          candidateNumberSortDirection: null,
          itemToDelete: null,
          executeModeItemsRef,
          spaceGroupDragItemIdsRef: useRef(null),
          eventUpdatePreviewEpochRef: useRef(0),
        },
        actions: {
          setEventLists: application.setters.setEventLists,
          updateItemFields: application.updateItemFields,
          setEventMetadata: application.setters.setEventMetadata,
          setDayModes: application.setters.setDayModes,
          updateExecuteModeItems: application.setters.setExecuteModeItems,
          setRecentlyChangedItemIds: vi.fn(),
          openDuplicateEvent: vi.fn(),
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
        alerts: { notify: vi.fn() },
        persistence: {
          commitApplicationSnapshotPatch: application.commitPatch,
        },
      });
      if (!persistence.isInitialized) return <p>起動中</p>;
      const current = values.eventLists[SHEET_EVENT] ?? [];
      return (
        <MapView
          {...scopedProps({
            mapName: `${day}マップ`,
            eventDate: day,
            operationScope: JSON.stringify([
              SHEET_EVENT,
              application.coordinator.generation(SHEET_EVENT),
              day,
              `${day}マップ`,
            ]),
            items: current,
            onUpdateItem: (updated, baseline) => {
              accepted.push([updated, baseline]);
              updateThroughMutation(updated, baseline);
            },
          })}
        />
      );
    }
    const rendered = render(<Harness />);
    await screen.findByTestId("map-canvas-mock");
    fireEvent.click(screen.getByTestId("map-canvas-mock"));
    const oldPopup = latestPopup();
    const row = screen
      .getByText("サークル0")
      .closest('[class*="cursor-pointer"]') as HTMLElement;
    expect(row).not.toBeNull();
    fireEvent.pointerDown(row, { pointerId: 1 });
    fireEvent.click(await screen.findByRole("button", { name: "✏️ 編集" }));
    fireEvent.change(screen.getByRole("textbox", { name: /^タイトル$/ }), {
      target: { value: "明示したタイトル" },
    });
    const writes = commits(true);
    writes.failNext();
    act(() =>
      application.updateItemFields({
        eventName: SHEET_EVENT,
        itemId: initial.eventLists[SHEET_EVENT][0].id,
        baseline: initial.eventLists[SHEET_EVENT][0],
        changes: {
          purchaseStatus: "Purchased",
          quantity: 4,
          remarks: "保存待ちのメモ",
        },
      }),
    );
    await waitFor(() => expect(application.retryableFailures).toHaveLength(1), {
      interval: 1,
      timeout: 10000,
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(accepted).toHaveLength(1);
    expect(accepted[0][1]).toEqual(initial.eventLists[SHEET_EVENT][0]);
    expect(updateThroughMutation.mock.calls[0][1]).toBe(accepted[0][1]);
    expect(accepted[0][0].title).toBe("明示したタイトル");
    expect(application.values.eventLists[SHEET_EVENT][0]).toMatchObject({
      purchaseStatus: "Purchased",
      quantity: 4,
      remarks: "保存待ちのメモ",
    });
    act(() => setDay("2日目"));
    act(() =>
      oldPopup.onUpdateItem?.(
        { ...initial.eventLists[SHEET_EVENT][0], remarks: "旧画面からの編集" },
        initial.eventLists[SHEET_EVENT][0],
      ),
    );
    expect(accepted).toHaveLength(1);
    act(() => application.retryPending());
    await waitFor(() => expect(application.pendingCount).toBe(0), {
      interval: 1,
      timeout: 10000,
    });
    const stored = (await commands.readApplicationSnapshot()).snapshot
      .eventLists[SHEET_EVENT][0];
    expect(stored).toMatchObject({
      eventDate: "1日目",
      title: "明示したタイトル",
      purchaseStatus: "Purchased",
      quantity: 4,
      remarks: "保存待ちのメモ",
    });
    writes.stop();
    rendered.unmount();
  });
}

it.each(["popup", "editor"])(
  "opens one external limited editor from the %s entry before invalidating the popup",
  async (entry) => {
    const limited = {
      ...item("limited", "01a"),
      purchaseStatus: "LimitedPurchase" as const,
      quantity: 5,
      limitedPurchasedQuantity: 2,
    };
    const onEditRequest = vi.fn();
    render(
      <MapView
        {...scopedProps({
          items: [limited],
          onEditRequest,
          onUpdateItem: vi.fn(),
        })}
      />,
    );
    fireEvent.click(screen.getByTestId("map-canvas-mock"));
    const oldPopup = latestPopup();
    if (entry === "editor") {
      const row = screen
        .getByText("limited")
        .closest('[class*="cursor-pointer"]') as HTMLElement;
      fireEvent.pointerDown(row, { pointerId: 1 });
      fireEvent.click(await screen.findByRole("button", { name: "✏️ 編集" }));
      const editor = screen.getByRole("dialog", { name: "アイテム編集" });
      fireEvent.click(
        within(editor).getByRole("button", { name: "限数を編集" }),
      );
    } else {
      fireEvent.click(screen.getByRole("button", { name: "限数を編集" }));
    }
    expect(onEditRequest).toHaveBeenCalledExactlyOnceWith(limited);
    expect(
      screen.queryByRole("dialog", { name: "A-1のアイテム一覧" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("map-canvas-mock"));
    act(() => oldPopup.onEditRequest?.(limited));
    expect(onEditRequest).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("dialog", { name: "A-1のアイテム一覧" }),
    ).toBeInTheDocument();
  },
);

it("clears an old popup long press when its operation scope changes", () => {
  vi.useFakeTimers();
  try {
    const props = scopedProps({ onUpdateItem: vi.fn(), onDeleteItem: vi.fn() });
    const { rerender } = render(<MapView {...props} />);
    fireEvent.click(screen.getByTestId("map-canvas-mock"));
    const row = screen
      .getByText("scope-item")
      .closest('[class*="cursor-pointer"]') as HTMLElement;
    fireEvent.pointerDown(row, { pointerId: 1 });
    rerender(<MapView {...props} operationScope={scope("Day2")} />);
    act(() => vi.advanceTimersByTime(600));
    expect(
      screen.queryByRole("button", { name: "✏️ 編集" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "A-1のアイテム一覧" }),
    ).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
