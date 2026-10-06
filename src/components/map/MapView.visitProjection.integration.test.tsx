import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../../types/item";
import type { DayMapData } from "../../types/map";

const mapCanvasRenderSpy = vi.hoisted(() => vi.fn());

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
