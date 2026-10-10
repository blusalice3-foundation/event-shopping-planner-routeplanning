import { render, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../types/item";
import type { DayMapData, HallDefinition } from "../types/map";

vi.mock("../utils/pathfinding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/pathfinding")>();
  return {
    ...actual,
    generateRouteSegmentsStrict: vi.fn(() => ({ ok: true, segments: [] })),
  };
});

vi.mock("./FocusModeMapCanvas", () => ({ default: () => null }));
import FocusMode from "./FocusMode";
import { generateRouteSegmentsStrict } from "../utils/pathfinding";
import { minimalProps } from "./FocusMode.fixtures";

const mockedGenerateRouteSegmentsStrict = vi.mocked(
  generateRouteSegmentsStrict,
);

const makeItem = (overrides: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: "item-1",
  circle: "Circle",
  eventDate: "Day1",
  block: "A",
  number: "01a",
  title: "Title",
  price: 1000,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "remarks",
  url: "",
  priorityLevel: "none",
  ...overrides,
});

const makeMap = (overrides: Partial<DayMapData> = {}): DayMapData => ({
  sheetName: "Sheet",
  rows: 10,
  cols: 10,
  maxRow: 10,
  maxCol: 10,
  cells: [
    {
      row: 1,
      col: 1,
      value: 1,
      backgroundColor: "#fff",
      borders: { top: null, right: null, bottom: null, left: null },
    },
    {
      row: 2,
      col: 2,
      value: 2,
      backgroundColor: "#fff",
      borders: { top: null, right: null, bottom: null, left: null },
    },
  ],
  mergedCells: [],
  blocks: [
    {
      name: "A",
      startRow: 1,
      startCol: 1,
      endRow: 2,
      endCol: 2,
      numberCells: [
        { row: 1, col: 1, value: 1 },
        { row: 2, col: 2, value: 2 },
        { row: 3, col: 3, value: 3 },
      ],
    },
    {
      name: "B",
      startRow: 3,
      startCol: 3,
      endRow: 4,
      endCol: 4,
      numberCells: [{ row: 3, col: 3, value: 2 }],
    },
  ],
  ...overrides,
});

const halls: HallDefinition[] = [
  {
    id: "hall-1",
    name: "Hall 1",
    color: "#fff",
    vertices: [
      { row: 0, col: 0 },
      { row: 0, col: 5 },
      { row: 5, col: 5 },
      { row: 5, col: 0 },
    ],
    blockNames: ["A"],
  },
];

const renderFocusMode = (params: {
  items?: ShoppingItem[];
  executeModeItemIds?: string[];
  map?: DayMapData;
  hallDefinitions?: HallDefinition[];
  hallOrder?: string[];
  mapVisible?: boolean;
}) => {
  const item1 = makeItem({ id: "item-1", number: "01a" });
  const item2 = makeItem({ id: "item-2", number: "02a" });
  const items = params.items ?? [item1, item2];

  const view = render(
    <FocusMode
      {...minimalProps({
        items,
        executeModeItemIds:
          params.executeModeItemIds ?? items.map((item) => item.id),
      })}
      mapData={{ Day1マップ: params.map ?? makeMap() }}
      hallDefinitions={params.hallDefinitions ?? halls}
      hallOrder={params.hallOrder ?? ["hall-1"]}
    />,
  );
  if (params.mapVisible !== false)
    fireEvent.click(view.getByTitle("マップを表示"));
  return view;
};

describe("FocusMode route recalculation cache", () => {
  beforeEach(() => {
    mockedGenerateRouteSegmentsStrict.mockClear();
  });

  it("uses one normal route stop for non-contiguous members and a distinct phase revisit", () => {
    renderFocusMode({
      items: [
        makeItem({
          id: "a1",
          number: "01a",
          purchaseStatus: "Postpone",
        }),
        makeItem({ id: "b", number: "02a" }),
        makeItem({ id: "a2", number: "01a2" }),
      ],
      executeModeItemIds: ["a1", "b", "a2"],
    });

    const visitPoints =
      mockedGenerateRouteSegmentsStrict.mock.calls.at(-1)?.[1];
    expect(visitPoints).toHaveLength(3);
    expect(visitPoints?.map((point) => point.itemId)).toEqual([
      expect.stringContaining("normal"),
      expect.stringContaining("normal"),
      expect.stringContaining("postponed"),
    ]);
    expect(new Set(visitPoints?.map((point) => point.itemId)).size).toBe(3);
  });

  it("uses the existing route cell inside a block regardless of duplicate-number order", () => {
    const map = makeMap();
    map.blocks[0].numberCells.unshift(
      { row: 9, col: 1, value: 2 },
      { row: 2, col: 3, value: 2 },
    );
    const { rerender } = renderFocusMode({ map });
    expect(
      mockedGenerateRouteSegmentsStrict.mock.calls.at(-1)?.[1],
    ).toMatchObject([
      { row: 1, col: 1 },
      { row: 2, col: 2 },
    ]);
    const reversed = structuredClone(map);
    reversed.blocks[0].numberCells.reverse();
    rerender(
      <FocusMode
        {...minimalProps({
          items: [
            makeItem({ id: "item-1", number: "01a" }),
            makeItem({ id: "item-2", number: "02a" }),
          ],
          executeModeItemIds: ["item-1", "item-2"],
        })}
        mapData={{ Day1マップ: reversed }}
        hallDefinitions={halls}
        hallOrder={["hall-1"]}
      />,
    );
    expect(
      mockedGenerateRouteSegmentsStrict.mock.calls.at(-1)?.[1],
    ).toMatchObject([
      { row: 1, col: 1 },
      { row: 2, col: 2 },
    ]);
  });
  it("omits distinct locations across duplicate blocks and restores the route when the duplicate block is removed", () => {
    const map = makeMap();
    map.blocks.push({
      ...map.blocks[0],
      name: "Ａ",
      numberCells: [{ row: 9, col: 9, value: 2 }],
    });
    const third = makeItem({ id: "item-3", number: "03a" });
    const items = [
      makeItem({ id: "item-1" }),
      makeItem({ id: "item-2", number: "02a" }),
      third,
    ];
    const { rerender } = renderFocusMode({ map, items });
    expect(
      mockedGenerateRouteSegmentsStrict.mock.calls.at(-1)?.[1],
    ).toHaveLength(2);
    rerender(
      <FocusMode
        {...minimalProps({
          items,
          executeModeItemIds: items.map((item) => item.id),
        })}
        mapData={{ Day1マップ: makeMap() }}
        hallDefinitions={halls}
        hallOrder={["hall-1"]}
      />,
    );
    expect(
      mockedGenerateRouteSegmentsStrict.mock.calls.at(-1)?.[1],
    ).toHaveLength(3);
  });

  it("resolves the canonical map key for padded raw event dates", () => {
    renderFocusMode({
      items: [
        makeItem({ id: "padded-1", eventDate: "Day1\u3000", number: "01a" }),
        makeItem({ id: "padded-2", eventDate: "Day1\u3000", number: "02a" }),
      ],
      executeModeItemIds: ["padded-1", "padded-2"],
    });

    expect(mockedGenerateRouteSegmentsStrict).toHaveBeenCalled();
    expect(
      mockedGenerateRouteSegmentsStrict.mock.calls.at(-1)?.[1],
    ).toHaveLength(2);
  });

  it("does not regenerate route segments when a member joins an existing visit", () => {
    const a1 = makeItem({ id: "a1", number: "01a" });
    const b = makeItem({ id: "b", number: "02a" });
    const a2 = makeItem({ id: "a2", number: "01a2" });
    const { rerender } = renderFocusMode({
      items: [a1, b],
      executeModeItemIds: ["a1", "b"],
    });
    const callsBefore = mockedGenerateRouteSegmentsStrict.mock.calls.length;

    rerender(
      <FocusMode
        {...minimalProps({
          items: [a1, b, a2],
          executeModeItemIds: ["a1", "b", "a2"],
        })}
        mapData={{ Day1マップ: makeMap() }}
        hallDefinitions={halls}
        hallOrder={["hall-1"]}
      />,
    );

    expect(mockedGenerateRouteSegmentsStrict.mock.calls.length).toBe(
      callsBefore,
    );
  });

  it.each([
    ["remarks", { remarks: "after" }],
    ["price", { price: 2000 }],
    ["quantity", { quantity: 3 }],
  ] as const)(
    "does not regenerate route segments when %s changes",
    (_label, change) => {
      const item1 = makeItem({ id: "item-1", number: "01a" });
      const item2 = makeItem({ id: "item-2", number: "02a" });
      const { rerender } = renderFocusMode({ items: [item1, item2] });
      const callsBefore = mockedGenerateRouteSegmentsStrict.mock.calls.length;

      rerender(
        <FocusMode
          {...minimalProps({
            items: [{ ...item1, ...change }, item2],
            executeModeItemIds: ["item-1", "item-2"],
          })}
          mapData={{ Day1マップ: makeMap() }}
          hallDefinitions={halls}
          hallOrder={["hall-1"]}
        />,
      );

      expect(mockedGenerateRouteSegmentsStrict.mock.calls.length).toBe(
        callsBefore,
      );
    },
  );

  it("regenerates route segments when number changes and visit coords change", () => {
    const item1 = makeItem({ id: "item-1", number: "01a" });
    const item2 = makeItem({ id: "item-2", number: "02a" });
    const { rerender } = renderFocusMode({ items: [item1, item2] });
    const callsBefore = mockedGenerateRouteSegmentsStrict.mock.calls.length;

    rerender(
      <FocusMode
        {...minimalProps({
          items: [{ ...item1, number: "03a" }, item2],
          executeModeItemIds: ["item-1", "item-2"],
        })}
        mapData={{ Day1マップ: makeMap() }}
        hallDefinitions={halls}
        hallOrder={["hall-1"]}
      />,
    );

    expect(mockedGenerateRouteSegmentsStrict.mock.calls.length).toBeGreaterThan(
      callsBefore,
    );
  });

  it("regenerates route segments when pathfinding map input changes even if visit coords stay the same", () => {
    const { rerender } = renderFocusMode({});
    const callsBefore = mockedGenerateRouteSegmentsStrict.mock.calls.length;
    const changedMap = makeMap({
      cells: makeMap().cells.map((cell, index) =>
        index === 0 ? { ...cell, value: "wall-b" } : cell,
      ),
    });

    rerender(
      <FocusMode
        {...minimalProps({
          items: [
            makeItem({ id: "item-1", number: "01a" }),
            makeItem({ id: "item-2", number: "02a" }),
          ],
          executeModeItemIds: ["item-1", "item-2"],
        })}
        mapData={{ Day1マップ: changedMap }}
        hallDefinitions={halls}
        hallOrder={["hall-1"]}
      />,
    );

    expect(mockedGenerateRouteSegmentsStrict.mock.calls.length).toBeGreaterThan(
      callsBefore,
    );
  });

  it("does not regenerate route segments when map display fields change for the active route day", () => {
    const { rerender } = renderFocusMode({});
    const callsBefore = mockedGenerateRouteSegmentsStrict.mock.calls.length;
    const displayOnlyMap = makeMap({
      sheetName: "Other",
      rows: 99,
      cols: 99,
      cells: makeMap().cells.map((cell) => ({
        ...cell,
        fontColor: "#f00",
        isMerged: true,
        mergeParent: { row: cell.row, col: cell.col },
        isVerticalText: true,
      })),
      mergedCells: [
        { startRow: 1, startCol: 1, endRow: 1, endCol: 1, value: "x" },
      ],
    });

    rerender(
      <FocusMode
        {...minimalProps({
          items: [
            makeItem({ id: "item-1", number: "01a" }),
            makeItem({ id: "item-2", number: "02a" }),
          ],
          executeModeItemIds: ["item-1", "item-2"],
        })}
        mapData={{ Day1マップ: displayOnlyMap }}
        hallDefinitions={halls}
        hallOrder={["hall-1"]}
      />,
    );

    expect(mockedGenerateRouteSegmentsStrict.mock.calls.length).toBe(
      callsBefore,
    );
  });

  it("does not regenerate route segments when hall name color or vertices change but coords and pathfinding input stay the same", () => {
    const { rerender } = renderFocusMode({});
    const callsBefore = mockedGenerateRouteSegmentsStrict.mock.calls.length;

    rerender(
      <FocusMode
        {...minimalProps({
          items: [
            makeItem({ id: "item-1", number: "01a" }),
            makeItem({ id: "item-2", number: "02a" }),
          ],
          executeModeItemIds: ["item-1", "item-2"],
        })}
        mapData={{ Day1マップ: makeMap() }}
        hallDefinitions={[
          {
            ...halls[0],
            name: "Renamed",
            color: "#000",
            vertices: [
              { row: 0, col: 0 },
              { row: 0, col: 6 },
              { row: 6, col: 6 },
              { row: 6, col: 0 },
            ],
          },
        ]}
        hallOrder={["hall-1"]}
      />,
    );

    expect(mockedGenerateRouteSegmentsStrict.mock.calls.length).toBe(
      callsBefore,
    );
  });
});

it("does not search hidden focus routes and cancels them when the map closes", () => {
  mockedGenerateRouteSegmentsStrict.mockClear();
  const view = renderFocusMode({ mapVisible: false });
  expect(mockedGenerateRouteSegmentsStrict).not.toHaveBeenCalled();
  fireEvent.click(view.getByTitle("マップを表示"));
  expect(mockedGenerateRouteSegmentsStrict).toHaveBeenCalledOnce();
  fireEvent.click(view.getByTitle("マップを非表示"));
  const calls = mockedGenerateRouteSegmentsStrict.mock.calls.length;
  view.rerender(
    <FocusMode
      {...minimalProps({
        items: [
          makeItem({ number: "03a" }),
          makeItem({ id: "item-2", number: "02a" }),
        ],
        executeModeItemIds: ["item-1", "item-2"],
      })}
      mapData={{ Day1マップ: makeMap() }}
      hallDefinitions={halls}
      hallOrder={["hall-1"]}
    />,
  );
  expect(mockedGenerateRouteSegmentsStrict.mock.calls.length).toBe(calls);
});
