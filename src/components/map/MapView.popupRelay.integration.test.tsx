// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../../types/item";
import type { DayMapData, RouteSegment } from "../../types/map";
import type MapCanvas from "./MapCanvas";
import type CellItemsPopup from "./CellItemsPopup";
import type InsertPositionDialog from "./InsertPositionDialog";

const canvasRender = vi.hoisted(() => vi.fn());
const popupRender = vi.hoisted(() => vi.fn());
const insertDialogRender = vi.hoisted(() => vi.fn());
const routeControl = vi.hoisted(() => ({
  current: {
    key: "controlled-route",
    pending: false,
    error: undefined as string | undefined,
    result: {
      displayRouteSegments: [] as RouteSegment[],
      mapInsertRouteSegments: [] as RouteSegment[],
      displayRouteState: "normal" as const,
    },
  },
  listeners: new Set<() => void>(),
}));

vi.mock("./MapCanvas", () => ({
  default: (props: ComponentProps<typeof MapCanvas>) => {
    canvasRender(props);
    return <div data-testid="relay-canvas" />;
  },
}));
vi.mock("./CellItemsPopup", () => ({
  default: (props: ComponentProps<typeof CellItemsPopup>) => {
    popupRender(props);
    return (
      <button
        onClick={() => {
          props.onAddToVisitList("pending");
          props.onClose();
        }}
      >
        Start insertion
      </button>
    );
  },
}));
vi.mock("./InsertPositionDialog", () => ({
  default: (props: ComponentProps<typeof InsertPositionDialog>) => {
    insertDialogRender(props);
    return props.isOpen ? <div data-testid="insert-preview" /> : null;
  },
}));
vi.mock("../../features/map/routing/useRouteCalculation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useRouteCalculation: () =>
      useSyncExternalStore(
        (listener) => {
          routeControl.listeners.add(listener);
          return () => routeControl.listeners.delete(listener);
        },
        () => routeControl.current,
      ),
  };
});

import MapView from "./MapView";

type CanvasProps = ComponentProps<typeof MapCanvas>;
type PopupProps = ComponentProps<typeof CellItemsPopup>;
type InsertDialogProps = ComponentProps<typeof InsertPositionDialog>;
const latestCanvas = () => canvasRender.mock.calls.at(-1)![0] as CanvasProps;
const latestPopup = () => popupRender.mock.calls.at(-1)![0] as PopupProps;
const latestDialog = () =>
  insertDialogRender.mock.calls.at(-1)![0] as InsertDialogProps;

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
const items = [
  item("first", "01a"),
  item("pending", "02a"),
  item("last", "03a"),
];
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
        { row: 3, col: 1, value: 3 },
      ],
    },
  ],
};
const segment: RouteSegment = {
  fromRow: 1,
  fromCol: 1,
  toRow: 3,
  toCol: 1,
  fromItemId: "first",
  toItemId: "last",
  path: [
    { row: 1, col: 1 },
    { row: 2, col: 1 },
    { row: 3, col: 1 },
  ],
};
const markerHit = {
  type: "marker" as const,
  itemId: "first",
  order: 0,
  duplicateCandidates: [{ itemId: "first", order: 0 }],
};

const setRoutePending = (pending: boolean) => {
  act(() => {
    routeControl.current = { ...routeControl.current, pending };
    routeControl.listeners.forEach((listener) => listener());
  });
};

const setup = (smartInsertMode: "map" | "preview") => {
  const onAddToExecuteList = vi.fn(() => ["pending"]);
  const onAddToExecuteListAtPosition = vi.fn(() => ["pending"]);
  const onUpdateHallRouteSettings = vi.fn();
  const onBatchAddToExecuteList = vi.fn(() => ["pending"]);
  const onBatchAddToExecuteListAtPosition = vi.fn(() => ["pending"]);
  const onRemoveFromExecuteList = vi.fn();
  const props: ComponentProps<typeof MapView> = {
    operationScope: "scope-A",
    eventDate: "Day1",
    mapData,
    mapName: "Day1マップ",
    items,
    executeModeItemIds: ["first", "last"],
    onAddToExecuteList,
    onAddToExecuteListAtPosition,
    onBatchAddToExecuteList,
    onBatchAddToExecuteListAtPosition,
    onRemoveFromExecuteList,
    onMoveToFirst: vi.fn(),
    onMoveToLast: vi.fn(),
    halls: [],
    hallRouteSettings: { hallOrder: [], hallVisitLists: [] },
    onUpdateHallRouteSettings,
    smartInsertEnabled: true,
    smartInsertMode,
    hideInternalControls: true,
  };
  const view = render(<MapView {...props} />);
  const rerenderScope = (operationScope: string) =>
    view.rerender(<MapView {...props} operationScope={operationScope} />);
  const expectNoWrites = () => {
    for (const command of [
      onAddToExecuteList,
      onAddToExecuteListAtPosition,
      onBatchAddToExecuteList,
      onBatchAddToExecuteListAtPosition,
      onRemoveFromExecuteList,
      onUpdateHallRouteSettings,
    ]) {
      expect(command).not.toHaveBeenCalled();
    }
  };
  const startInsertion = () => {
    act(() => latestCanvas().onCellClick?.(2, 1, [items[1]]));
    const popup = latestPopup();
    fireEvent.click(screen.getByRole("button", { name: "Start insertion" }));
    return popup;
  };
  return {
    rerenderScope,
    expectNoWrites,
    startInsertion,
    onAddToExecuteListAtPosition,
  };
};

const expectInactiveCanvas = () => {
  expect(latestCanvas().routeInsertSelectionActive).toBe(false);
  expect(latestCanvas().forceRouteVisible).toBe(false);
  expect(latestCanvas().routeInsertMissMapDataOverride).toBeUndefined();
  expect(latestCanvas().mapData).toBe(mapData);
  expect(screen.queryByTestId("insert-preview")).not.toBeInTheDocument();
  expect(
    screen.queryByText("ルート線または番号をクリックしてください"),
  ).not.toBeInTheDocument();
};

describe("MapView popup insertion relay ownership", () => {
  beforeEach(() => {
    canvasRender.mockClear();
    popupRender.mockClear();
    insertDialogRender.mockClear();
    routeControl.listeners.clear();
    routeControl.current = {
      key: "controlled-route",
      pending: false,
      error: undefined,
      result: {
        displayRouteSegments: [segment],
        mapInsertRouteSegments: [segment],
        displayRouteState: "normal",
      },
    };
  });

  it("discards map-selection snapshots and rejects old hit/miss callbacks after A to B to A", () => {
    const context = setup("map");
    const popup = context.startInsertion();
    const oldCanvas = latestCanvas();
    expect(oldCanvas.routeInsertSelectionActive).toBe(true);
    expect(oldCanvas.mapData).not.toBe(mapData);
    expect(oldCanvas.routeInsertMissMapDataOverride).toBeDefined();
    context.expectNoWrites();

    context.rerenderScope("scope-B");
    expectInactiveCanvas();
    context.rerenderScope("scope-A");
    expectInactiveCanvas();
    act(() => {
      oldCanvas.onRouteInsertHit?.(markerHit);
      oldCanvas.onRouteInsertMiss?.({ kind: "cell" });
      popup.onAddToVisitList("pending");
      popup.onClose();
    });
    expectInactiveCanvas();
    context.expectNoWrites();

    context.startInsertion();
    const activeCanvas = latestCanvas();
    act(() => oldCanvas.onRouteInsertHit?.(markerHit));
    expect(latestCanvas().routeInsertSelectionActive).toBe(true);
    context.expectNoWrites();
    act(() => activeCanvas.onRouteInsertHit?.(markerHit));
    expect(
      context.onAddToExecuteListAtPosition,
    ).toHaveBeenCalledExactlyOnceWith("pending", "first", "after");
    expectInactiveCanvas();
  });

  it("rejects a retained Canvas cell callback from another scope without disturbing a new popup", () => {
    const context = setup("map");
    const oldCanvas = latestCanvas();
    context.rerenderScope("scope-B");
    act(() => oldCanvas.onCellClick?.(2, 1, [items[1]]));
    expect(
      screen.queryByRole("button", { name: "Start insertion" }),
    ).not.toBeInTheDocument();
    context.expectNoWrites();

    act(() => latestCanvas().onCellClick?.(2, 1, [items[1]]));
    const popupRenderCount = popupRender.mock.calls.length;
    expect(
      screen.getByRole("button", { name: "Start insertion" }),
    ).toBeVisible();
    act(() => oldCanvas.onCellClick?.(2, 1, [items[1]]));
    expect(popupRender).toHaveBeenCalledTimes(popupRenderCount);
    expect(
      screen.getByRole("button", { name: "Start insertion" }),
    ).toBeVisible();
    context.expectNoWrites();

    fireEvent.click(screen.getByRole("button", { name: "Start insertion" }));
    expect(latestCanvas().routeInsertSelectionActive).toBe(true);
    act(() => latestCanvas().onRouteInsertHit?.(markerHit));
    expect(
      context.onAddToExecuteListAtPosition,
    ).toHaveBeenCalledExactlyOnceWith("pending", "first", "after");
    expectInactiveCanvas();
  });

  it("invalidates preview select/cancel without allowing old cancel to close a new same-scope relay", () => {
    const context = setup("preview");
    context.startInsertion();
    const oldDialog = latestDialog();
    expect(screen.getByTestId("insert-preview")).toBeInTheDocument();
    context.expectNoWrites();

    context.rerenderScope("scope-B");
    expectInactiveCanvas();
    context.rerenderScope("scope-A");
    act(() => {
      oldDialog.onSelect({ type: "after", referenceItemId: "first" });
      oldDialog.onCancel();
    });
    expectInactiveCanvas();
    context.expectNoWrites();

    context.startInsertion();
    const currentDialog = latestDialog();
    act(() => oldDialog.onCancel());
    expect(screen.getByTestId("insert-preview")).toBeInTheDocument();
    context.expectNoWrites();
    act(() =>
      currentDialog.onSelect({ type: "after", referenceItemId: "first" }),
    );
    expect(
      context.onAddToExecuteListAtPosition,
    ).toHaveBeenCalledExactlyOnceWith("pending", "first", "after");
    expectInactiveCanvas();
  });

  it("does not resume an invalidated worker wait and resumes a new same-scope wait normally", () => {
    const context = setup("map");
    setRoutePending(true);
    const oldPopup = context.startInsertion();
    expect(screen.getByRole("status")).toHaveTextContent(
      "経路を計算しています…",
    );
    expect(latestCanvas().routeInsertSelectionActive).toBe(false);

    context.rerenderScope("scope-B");
    context.rerenderScope("scope-A");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    setRoutePending(false);
    expectInactiveCanvas();
    context.expectNoWrites();

    setRoutePending(true);
    context.startInsertion();
    act(() => oldPopup.onClose());
    expect(screen.getByRole("status")).toHaveTextContent(
      "経路を計算しています…",
    );
    setRoutePending(false);
    expect(screen.queryByText("経路を計算しています…")).not.toBeInTheDocument();
    expect(latestCanvas().routeInsertSelectionActive).toBe(true);
    context.expectNoWrites();
    act(() => latestCanvas().onRouteInsertHit?.(markerHit));
    expect(
      context.onAddToExecuteListAtPosition,
    ).toHaveBeenCalledExactlyOnceWith("pending", "first", "after");
    expectInactiveCanvas();
  });
});
