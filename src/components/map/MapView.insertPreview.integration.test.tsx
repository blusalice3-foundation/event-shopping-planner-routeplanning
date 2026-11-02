// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../../types/item";
import type { DayMapData, HallDefinition } from "../../types/map";
import type MapCanvas from "./MapCanvas";

vi.mock("./MapCanvas", () => ({
  default: (props: ComponentProps<typeof MapCanvas>) => {
    const pendingItems = props.items.filter(
      (item) => item.id === "pending" || item.id === "pending-sibling",
    );
    const pending = pendingItems[0];
    return (
      <button
        type="button"
        data-testid="open-pending-map-cell"
        onClick={() => {
          if (!pending) return;
          props.onCellClick?.(
            Number.parseInt(pending.number, 10) + 1,
            pending.block === "B" ? 8 : 2,
            pendingItems,
          );
        }}
      >
        Open pending map cell
      </button>
    );
  },
}));

import MapView from "./MapView";

const item = (
  id: string,
  block: string,
  number: string,
  priorityLevel: ShoppingItem["priorityLevel"] = "none",
): ShoppingItem => ({
  id,
  circle: id,
  eventDate: "Day1",
  block,
  number,
  title: `${id} title`,
  price: 500,
  purchaseStatus: "None",
  quantity: 2,
  remarks: "ユーザー登録 エラーが発生しました",
  priorityLevel,
});

const mapData: DayMapData = {
  sheetName: "Day1マップ",
  rows: 10,
  cols: 12,
  maxRow: 10,
  maxCol: 12,
  cells: [],
  mergedCells: [],
  blocks: [
    {
      name: "A",
      startRow: 1,
      startCol: 1,
      endRow: 8,
      endCol: 5,
      numberCells: [
        { row: 2, col: 2, value: 1 },
        { row: 3, col: 2, value: 2 },
        { row: 4, col: 2, value: 3 },
        { row: 5, col: 2, value: 4 },
      ],
    },
    {
      name: "B",
      startRow: 1,
      startCol: 7,
      endRow: 8,
      endCol: 11,
      numberCells: [
        { row: 2, col: 8, value: 1 },
        { row: 3, col: 8, value: 2 },
      ],
    },
  ],
};

const halls: HallDefinition[] = [
  {
    id: "hall-a",
    name: "Aホール",
    blockNames: ["A"],
    vertices: [
      { row: 1, col: 1 },
      { row: 1, col: 5 },
      { row: 8, col: 5 },
      { row: 8, col: 1 },
    ],
  },
  {
    id: "hall-b",
    name: "Bホール",
    blockNames: ["B"],
    vertices: [
      { row: 1, col: 7 },
      { row: 1, col: 11 },
      { row: 8, col: 11 },
      { row: 8, col: 7 },
    ],
  },
];

const baseItems = [
  item("a1", "A", "01a"),
  item("hall-b", "B", "01a"),
  item("b1", "A", "02a"),
];

interface PreviewCase {
  name: string;
  raw: string[];
  items: ShoppingItem[];
  expected: string[];
  nearby: string[];
  hallOrder?: string[];
  routeHallOrder?: string[];
}

const previewCases: PreviewCase[] = [
  {
    name: "interleaved halls",
    raw: ["a1", "hall-b", "b1"],
    items: baseItems,
    expected: ["a1", "b1", "hall-b"],
    nearby: ["a1", "b1"],
  },
  {
    name: "contiguous control",
    raw: ["a1", "b1", "hall-b"],
    items: baseItems,
    expected: ["a1", "b1", "hall-b"],
    nearby: ["a1", "b1"],
  },
  {
    name: "all books of a fragmented visit",
    raw: ["a1", "hall-b", "b1", "a2"],
    items: [...baseItems, item("a2", "A", "01a2")],
    expected: ["a1", "a2", "b1", "hall-b"],
    nearby: ["a1", "a2", "b1"],
  },
  {
    name: "configured priority groups override the fallback hall order",
    raw: ["a1", "hall-b", "a-highest", "b1", "b-priority"],
    items: [
      ...baseItems,
      item("a-highest", "A", "04a", "highest"),
      item("b-priority", "B", "02a", "priority"),
    ],
    hallOrder: ["hall-b", "hall-a"],
    routeHallOrder: ["hall-a:highest", "hall-b:priority", "hall-a", "hall-b"],
    expected: ["a-highest", "b-priority", "a1", "b1", "hall-b"],
    nearby: ["a-highest", "a1", "b1"],
  },
];

function openPreview(
  source: PreviewCase,
  selectedHallId = "all",
  pending = item("pending", "A", "03a"),
  siblings: ShoppingItem[] = [],
) {
  const raw = [...source.raw];
  const pendingItems = [pending, ...siblings];
  const items = [
    ...source.items.map((entry) => ({ ...entry })),
    ...pendingItems,
  ];
  const itemsBefore = items.map((entry) => ({ ...entry }));
  const ports = {
    onAddToExecuteList: vi.fn(() => [pending.id]),
    onAddToExecuteListAtPosition: vi.fn(() => [pending.id]),
    onBatchAddToExecuteList: vi.fn(() => pendingItems.map((entry) => entry.id)),
    onBatchAddToExecuteListAtPosition: vi.fn(() =>
      pendingItems.map((entry) => entry.id),
    ),
    onRemoveFromExecuteList: vi.fn(),
    onMoveToFirst: vi.fn(),
    onMoveToLast: vi.fn(),
    onUpdateHallRouteSettings: vi.fn(),
  };
  render(
    <MapView
      {...ports}
      mapData={mapData}
      mapName="Day1マップ"
      eventDate="Day1"
      operationScope='["preview-event",0,"Day1","Day1マップ"]'
      items={items}
      executeModeItemIds={raw}
      halls={halls}
      hallRouteSettings={{
        hallOrder: source.hallOrder ?? ["hall-a", "hall-b"],
        hallVisitLists: [],
      }}
      routeHallOrder={source.routeHallOrder}
      externalSelectedHallId={selectedHallId}
      smartInsertEnabled
      smartInsertMode="preview"
    />,
  );
  fireEvent.click(screen.getByTestId("open-pending-map-cell"));
  const popup = screen.getByRole("dialog", {
    name: /のアイテム一覧$/,
  });
  fireEvent.click(
    siblings.length
      ? within(popup).getByTitle("02a: 0/2件追加済み")
      : within(popup).getByText(pending.id, { exact: true }),
  );
  const dialog = screen.getByRole("dialog", {
    name: "追加位置を選択",
  });
  const expectNoMutation = () => {
    Object.values(ports).forEach((port) => expect(port).not.toHaveBeenCalled());
    expect(raw).toEqual(source.raw);
    expect(items).toEqual(itemsBefore);
  };
  return { dialog, ports, raw, items, itemsBefore, expectNoMutation };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MapView insertion preview order", () => {
  for (const selectedHallId of ["all", "hall-a"]) {
    it.each(previewCases)(
      `projects $name without hiding other halls: selected=${selectedHallId}`,
      (source) => {
        const { dialog, expectNoMutation } = openPreview(
          source,
          selectedHallId,
        );
        const circles = [...dialog.querySelectorAll("span.truncate")];
        expect(circles.map((element) => element.textContent)).toEqual(
          source.expected,
        );
        expect(
          within(dialog)
            .getAllByText(/^#\d+$/)
            .map((element) => element.textContent),
        ).toEqual(source.expected.map((_, index) => `#${index + 1}`));
        expect(
          within(dialog)
            .getAllByRole("button", { name: /^挿入位置 [A-Z] を選択$/ })
            .map((element) => element.getAttribute("aria-label")),
        ).toEqual(
          ["A", "B", "C", "D", "E", "F"]
            .slice(0, source.expected.length + 1)
            .map((letter) => `挿入位置 ${letter} を選択`),
        );
        for (const circle of circles) {
          expect(circle.parentElement?.classList.contains("bg-blue-50")).toBe(
            source.nearby.includes(circle.textContent ?? ""),
          );
        }
        expectNoMutation();
        fireEvent.click(
          within(dialog).getByRole("button", {
            name: "キャンセル",
          }),
        );
        expect(
          screen.queryByRole("dialog", { name: "追加位置を選択" }),
        ).not.toBeInTheDocument();
        expectNoMutation();
      },
    );
  }
});

describe("MapView insertion preview reference IDs", () => {
  it.each([
    {
      name: "uses the pending B group at the A-to-B boundary",
      pending: item("pending", "B", "02a"),
      marker: "C",
      referenceId: "hall-b",
      position: "before",
    },
    {
      name: "uses the pending A group at the A-to-B boundary",
      pending: item("pending", "A", "03a"),
      marker: "C",
      referenceId: "b1",
      position: "after",
    },
    {
      name: "keeps the existing after reference inside the same group",
      pending: item("pending", "A", "03a"),
      marker: "B",
      referenceId: "a1",
      position: "after",
    },
    {
      name: "keeps the first displayed item's before reference",
      pending: item("pending", "A", "03a"),
      marker: "A",
      referenceId: "a1",
      position: "before",
    },
    {
      name: "keeps the final displayed item's after reference",
      pending: item("pending", "B", "02a"),
      marker: "D",
      referenceId: "hall-b",
      position: "after",
    },
    {
      name: "preserves the old anchor when neither side has the pending priority",
      pending: item("pending", "A", "03a", "highest"),
      marker: "B",
      referenceId: "a1",
      position: "after",
    },
  ])("$name", ({ pending, marker, referenceId, position }) => {
    const { dialog, ports, raw, expectNoMutation } = openPreview(
      previewCases[0],
      "all",
      pending,
    );
    expectNoMutation();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: `挿入位置 ${marker} を選択`,
      }),
    );
    expect(ports.onAddToExecuteListAtPosition).toHaveBeenCalledExactlyOnceWith(
      pending.id,
      referenceId,
      position,
    );
    expect(ports.onAddToExecuteList).not.toHaveBeenCalled();
    expect(ports.onRemoveFromExecuteList).not.toHaveBeenCalled();
    expect(raw).toEqual(previewCases[0].raw);
  });
});
describe("MapView insertion preview batch references", () => {
  it.each([
    {
      name: "uses the shared B group for both pending books",
      siblingPriority: "none" as const,
      referenceId: "hall-b",
      position: "before",
      reject: false,
    },
    {
      name: "preserves the original anchor and dialog after mixed-priority rejection",
      siblingPriority: "highest" as const,
      referenceId: "b1",
      position: "after",
      reject: true,
    },
  ])("$name", ({ siblingPriority, referenceId, position, reject }) => {
    const { dialog, ports, raw, items, itemsBefore, expectNoMutation } =
      openPreview(previewCases[0], "all", item("pending", "B", "02a"), [
        item("pending-sibling", "B", "02a2", siblingPriority),
      ]);
    expectNoMutation();
    if (reject) ports.onBatchAddToExecuteListAtPosition.mockReturnValue([]);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "挿入位置 C を選択" }),
    );
    expect(
      ports.onBatchAddToExecuteListAtPosition,
    ).toHaveBeenCalledExactlyOnceWith(
      ["pending", "pending-sibling"],
      referenceId,
      position,
    );
    expect(ports.onAddToExecuteListAtPosition).not.toHaveBeenCalled();
    expect(ports.onAddToExecuteList).not.toHaveBeenCalled();
    expect(ports.onBatchAddToExecuteList).not.toHaveBeenCalled();
    expect(raw).toEqual(previewCases[0].raw);
    expect(items).toEqual(itemsBefore);
    if (reject) {
      expect(ports.onUpdateHallRouteSettings).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog", { name: "追加位置を選択" })).toBe(
        dialog,
      );
    } else {
      expect(
        screen.queryByRole("dialog", { name: "追加位置を選択" }),
      ).not.toBeInTheDocument();
    }
  });
});
