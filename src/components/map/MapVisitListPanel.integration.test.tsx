import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../../types/item";
import type { BlockDefinition } from "../../types/map";
import MapVisitListPanel from "./MapVisitListPanel";

const makeItem = (overrides: Partial<ShoppingItem>): ShoppingItem => ({
  id: "item-1",
  circle: "Circle",
  eventDate: "Day1",
  block: "A",
  number: "1a",
  title: "Title",
  price: 1000,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "",
  url: "",
  priorityLevel: "none",
  ...overrides,
});

const blocks: BlockDefinition[] = [
  {
    name: "A",
    startRow: 1,
    startCol: 1,
    endRow: 10,
    endCol: 10,
    numberCells: [
      { row: 1, col: 1, value: 1 },
      { row: 2, col: 1, value: 2 },
    ],
  },
];

describe("MapVisitListPanel", () => {
  it("globally merges a non-contiguous visit and uses contiguous visit order", () => {
    render(
      <MapVisitListPanel
        isOpen={true}
        onClose={vi.fn()}
        items={[
          makeItem({ id: "same-cell-1", circle: "Circle A", number: "1a" }),
          makeItem({ id: "same-cell-2", circle: "Circle B", number: "1a2" }),
          makeItem({ id: "next-cell", circle: "Circle C", number: "2a" }),
        ]}
        executeModeItemIds={["same-cell-1", "next-cell", "same-cell-2"]}
        blocks={blocks}
        onJumpToCell={vi.fn()}
      />,
    );

    const duplicateCellButton = screen
      .getByText("Circle A, Circle B")
      .closest("button");
    const nextCellButton = screen.getByText("Circle C").closest("button");

    expect(duplicateCellButton).not.toBeNull();
    expect(nextCellButton).not.toBeNull();
    expect(within(duplicateCellButton!).getByText("1")).toBeInTheDocument();
    expect(within(nextCellButton!).getByText("2")).toBeInTheDocument();
  });

  it("keeps different priorities as separate visits even on the same cell", () => {
    render(
      <MapVisitListPanel
        isOpen={true}
        onClose={vi.fn()}
        items={[
          makeItem({ id: "normal", circle: "Normal", number: "1a" }),
          makeItem({
            id: "priority",
            circle: "Priority",
            number: "1a2",
            priorityLevel: "priority",
          }),
        ]}
        executeModeItemIds={["normal", "priority"]}
        blocks={blocks}
        onJumpToCell={vi.fn()}
      />,
    );

    expect(screen.getByText("合計 2 箇所")).toBeInTheDocument();
    expect(screen.getByText("Normal")).toBeInTheDocument();
    expect(screen.getByText("Priority")).toBeInTheDocument();
    expect(screen.getAllByText("A-1A")).toHaveLength(2);
    expect(screen.getByText("優先")).toBeInTheDocument();
  });
});
