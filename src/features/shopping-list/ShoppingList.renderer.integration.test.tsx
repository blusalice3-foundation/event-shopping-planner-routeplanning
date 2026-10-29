import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import ShoppingList, {
  calculateBlockColors,
} from "../../components/ShoppingList";
import { shoppingPerformance } from "../../utils/shoppingPerformance";
import type { ShoppingItem } from "../../types/item";
import { getSpaceKey } from "../../utils/spaceGrouping";
import { useListInteractionState } from "../lists/hooks/useListInteractionState";
import { revealViewportContent } from "./renderers/ViewportContent";
import * as rowModels from "./model/buildListRows";
import * as listController from "./controller/listController";
import {
  buildListRows,
  type BuildListRowsInput,
  type ShoppingListReadModel,
} from "./model/buildListRows";
import type {
  ListRendererPreferencePort,
  ListRendererPreferenceReadResult,
} from "./preference/ListRendererPreferencePort";

type SelectItemHandler = React.ComponentProps<
  typeof ShoppingList
>["onSelectItem"];

const preferencePort = (
  result: ListRendererPreferenceReadResult,
): ListRendererPreferencePort => ({
  read: () => result,
  write: vi.fn(() => true),
});

const originalVisualViewportDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "visualViewport",
);
let scrollToSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

const setViewportScale = (scale: number): void => {
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      scale,
    } as unknown as VisualViewport,
  });
};

afterAll(() => {
  scrollToSpy.mockRestore();
  if (originalVisualViewportDescriptor) {
    Object.defineProperty(
      window,
      "visualViewport",
      originalVisualViewportDescriptor,
    );
  } else {
    Reflect.deleteProperty(window, "visualViewport");
  }
});

const item = (index: number): ShoppingItem => ({
  id: `item-${index}`,
  circle: `サークル${index}`,
  eventDate: "1日目",
  block: "東A",
  number: String(index),
  title: `新刊${index}`,
  price: 1000,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "",
});

const longItems = Array.from({ length: 100 }, (_, index) => item(index + 1));

const expectExactCanonicalRows = (
  container: HTMLElement,
  model: ShoppingListReadModel,
): void => {
  const renderedRows = Array.from(
    container.querySelectorAll<HTMLElement>("[data-row-key]"),
  );
  expect(renderedRows.map((row) => row.dataset.rowKey)).toEqual(
    model.rows.map((row) => row.rowKey),
  );
  expect(new Set(renderedRows.map((row) => row.dataset.rowKey)).size).toBe(
    model.rows.length,
  );
  model.itemRows.forEach((row) => {
    const renderedRow = renderedRows.find(
      (element) => element.dataset.rowKey === row.rowKey,
    );
    expect(renderedRow).toHaveAttribute(
      "aria-posinset",
      `${row.positionInSet}`,
    );
    expect(renderedRow).toHaveAttribute("aria-setsize", `${row.setSize}`);
    expect(renderedRow).toHaveAttribute("aria-label", row.accessibleName);
  });
};

const renderEmptyList = (
  port: ListRendererPreferencePort,
  forceFullListRenderer = false,
) =>
  render(
    <ShoppingList
      items={[]}
      onUpdateItem={vi.fn()}
      onMoveItem={vi.fn()}
      onEditRequest={vi.fn()}
      onDeleteRequest={vi.fn()}
      selectedItemIds={new Set()}
      onSelectItem={vi.fn()}
      skipLimitedPurchaseForSingleQuantity={false}
      listRendererPreferencePort={port}
      forceFullListRenderer={forceFullListRenderer}
    />,
  );

const renderLongList = ({
  port = preferencePort({ status: "ok", value: "auto" }),
  layoutMode = "smartphone",
  recoveryActive = false,
  onSelectItem = vi.fn<SelectItemHandler>(),
}: {
  port?: ListRendererPreferencePort;
  layoutMode?: "pc" | "smartphone";
  recoveryActive?: boolean | null;
  onSelectItem?: SelectItemHandler;
} = {}) =>
  render(
    <ShoppingList
      items={longItems}
      onUpdateItem={vi.fn()}
      onMoveItem={vi.fn()}
      onEditRequest={vi.fn()}
      onDeleteRequest={vi.fn()}
      selectedItemIds={new Set()}
      onSelectItem={onSelectItem}
      skipLimitedPurchaseForSingleQuantity={false}
      listRendererPreferencePort={port}
      layoutMode={layoutMode}
      recoveryActive={recoveryActive}
    />,
  );

describe("ShoppingList renderer integration", () => {
  it("defaults a missing preference to auto and fails closed to the full DOM", () => {
    const view = renderEmptyList(preferencePort({ status: "missing" }));
    const root = view.container.firstElementChild;

    expect(root?.getAttribute("data-list-renderer")).toBe("full");
    expect(root?.getAttribute("data-list-renderer-reason")).toBe(
      "virtual-ineligible",
    );
    expect(root?.getAttribute("data-list-row-count")).toBe("0");
  });

  it("uses full for corrupt preferences and a force-full QA policy", () => {
    const corrupt = renderEmptyList(preferencePort({ status: "invalid" }));
    expect(
      corrupt.container.firstElementChild?.getAttribute(
        "data-list-renderer-reason",
      ),
    ).toBe("preference-full");
    corrupt.unmount();

    const forced = renderEmptyList(
      preferencePort({ status: "ok", value: "auto" }),
      true,
    );
    expect(
      forced.container.firstElementChild?.getAttribute(
        "data-list-renderer-reason",
      ),
    ).toBe("force-full");
  });

  it("uses the TanStack runtime for an eligible long single-column list", () => {
    setViewportScale(1);
    const view = renderLongList();
    const root = view.container.firstElementChild;
    const renderedRows = root?.querySelectorAll('[role="listitem"]') ?? [];

    expect(root?.getAttribute("data-list-renderer")).toBe("virtual");
    expect(root?.getAttribute("data-list-row-count")).toBe("100");
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThan(100);
    expect(root?.querySelector("[style]")).toBeNull();
    expect(renderedRows[0]).toHaveAttribute("aria-posinset");
    expect(renderedRows[0]).toHaveAttribute("aria-setsize", "100");
  });

  it("renders space groups from the exact canonical full-renderer row sequence", () => {
    const first = { ...item(1), number: "01a" };
    const second = { ...item(2), number: "01a2" };
    const third = { ...item(3), number: "02a" };
    const groupedItems = [first, second, third];
    const firstSpaceKey = getSpaceKey(first.block, first.number);
    const secondSpaceKey = getSpaceKey(third.block, third.number);
    const model = buildListRows({
      items: groupedItems,
      groups: [
        {
          key: firstSpaceKey,
          label: firstSpaceKey,
          items: [first, second],
        },
        { key: secondSpaceKey, label: secondSpaceKey, items: [third] },
      ],
    });
    const view = render(
      <ShoppingList
        items={groupedItems}
        onUpdateItem={vi.fn()}
        onMoveItem={vi.fn()}
        onEditRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
        selectedItemIds={new Set()}
        onSelectItem={vi.fn()}
        skipLimitedPurchaseForSingleQuantity={false}
        showSpaceGroups
        forceFullListRenderer
      />,
    );
    const root = view.container.firstElementChild as HTMLElement;

    expect(root).toHaveAttribute("data-list-renderer", "full");
    expect(root).toHaveAttribute("data-list-row-count", `${model.rows.length}`);
    expectExactCanonicalRows(root, model);
    expect(root.querySelectorAll('[role="list"]')).toHaveLength(2);
  });

  it("renders hall groups from the exact canonical full-renderer row sequence", () => {
    const highest = { ...item(1), priorityLevel: "highest" as const };
    const regular = item(2);
    const groupedItems = [highest, regular];
    const model = buildListRows({
      items: groupedItems,
      groups: [
        {
          key: "undefined:highest",
          label: "ホール未定義最優先",
          items: [highest],
        },
        {
          key: "ungrouped:1",
          label: "ホール未定義",
          items: [regular],
        },
      ],
    });
    const view = render(
      <ShoppingList
        items={groupedItems}
        onUpdateItem={vi.fn()}
        onMoveItem={vi.fn()}
        onEditRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
        selectedItemIds={new Set()}
        onSelectItem={vi.fn()}
        skipLimitedPurchaseForSingleQuantity={false}
        showHallGroups
        forceFullListRenderer
      />,
    );
    const root = view.container.firstElementChild as HTMLElement;

    expect(root).toHaveAttribute("data-list-renderer", "full");
    expect(root).toHaveAttribute("data-list-row-count", `${model.rows.length}`);
    expectExactCanonicalRows(root, model);
    expect(root.querySelectorAll('[role="list"]')).toHaveLength(2);
  });

  it("shares the visible model while selection is empty and refreshes the nonempty display model after structural changes", () => {
    const createProjector = rowModels.createListRowsProjector;
    const observedInputs: BuildListRowsInput[] = [];
    const projectorSpy = vi
      .spyOn(rowModels, "createListRowsProjector")
      .mockImplementation(() => {
        const project = createProjector();
        return (input) => {
          observedInputs.push(input);
          return project(input);
        };
      });
    const baseItems = [item(1), item(2), item(3), item(4)];
    const props: React.ComponentProps<typeof ShoppingList> = {
      items: baseItems,
      onUpdateItem: vi.fn(),
      onMoveItem: vi.fn(),
      onEditRequest: vi.fn(),
      onDeleteRequest: vi.fn(),
      selectedItemIds: new Set(),
      onSelectItem: vi.fn(),
      skipLimitedPurchaseForSingleQuantity: false,
      columnType: "execute",
      forceFullListRenderer: true,
    };
    const view = render(<ShoppingList {...props} />);
    const expectRows = (input: BuildListRowsInput) => {
      const model = buildListRows(input);
      expectExactCanonicalRows(view.container, model);
      model.itemRows.forEach((row) => {
        const card = view.container.querySelector<HTMLElement>(
          `[data-item-id="${row.itemId}"]`,
        );
        expect(card).toHaveAttribute(
          "data-is-selected",
          `${row.flags.selected}`,
        );
        expect(
          card?.querySelector<HTMLInputElement>('input[type="checkbox"]')
            ?.checked,
        ).toBe(row.flags.selected);
      });
    };

    try {
      expect(observedInputs).toHaveLength(1);
      expect(observedInputs[0].selectedItemIds).toBeUndefined();
      expectRows({ items: baseItems, column: "execute" });

      view.rerender(
        <ShoppingList {...props} selectedItemIds={new Set(["item-1"])} />,
      );
      expectRows({
        items: baseItems,
        column: "execute",
        selectedItemIds: new Set(["item-1"]),
      });
      expect(
        observedInputs.some((input) => input.selectedItemIds?.has("item-1")),
      ).toBe(true);

      view.rerender(<ShoppingList {...props} />);
      expectRows({ items: baseItems, column: "execute" });
      const selectedProjectionCount = observedInputs.filter(
        (input) => input.selectedItemIds !== undefined,
      ).length;
      const changedItems = [
        { ...baseItems[3], title: "更新された新刊", quantity: 3 },
        baseItems[1],
      ];
      const changedProps = {
        ...props,
        items: changedItems,
        highlightedItemId: "item-4",
        duplicateCircleItemIds: new Set(["item-2"]),
      };
      const expectedInput = {
        items: changedItems,
        column: "execute" as const,
        highlightedItemId: "item-4",
        duplicateCircleItemIds: changedProps.duplicateCircleItemIds,
      };
      view.rerender(<ShoppingList {...changedProps} />);
      expectRows(expectedInput);
      expect(view.getByText("更新された新刊")).toBeInTheDocument();
      expect(
        observedInputs.filter((input) => input.selectedItemIds !== undefined),
      ).toHaveLength(selectedProjectionCount);

      const selectedItemIds = new Set(["item-2"]);
      view.rerender(
        <ShoppingList {...changedProps} selectedItemIds={selectedItemIds} />,
      );
      expectRows({ ...expectedInput, selectedItemIds });
      expect(observedInputs.at(-1)).toMatchObject(expectedInput);
      expect(baseItems[3].title).toBe("新刊4");
    } finally {
      view.unmount();
      projectorSpy.mockRestore();
    }
  });

  it("keeps collapsed item membership and current canonical rows across empty selection, regrouping, and filtering", () => {
    const controllerSpy = vi.spyOn(
      listController,
      "shoppingListControllerReducer",
    );
    try {
      const baseItems = [item(1), item(2), item(3)];
      const hiddenKey = getSpaceKey(baseItems[1].block, baseItems[1].number);
      const props: React.ComponentProps<typeof ShoppingList> = {
        items: baseItems,
        onUpdateItem: vi.fn(),
        onMoveItem: vi.fn(),
        onEditRequest: vi.fn(),
        onDeleteRequest: vi.fn(),
        selectedItemIds: new Set(),
        onSelectItem: vi.fn(),
        skipLimitedPurchaseForSingleQuantity: false,
        showSpaceGroups: true,
        collapsedSpaces: new Set([hiddenKey]),
        forceFullListRenderer: true,
      };
      const groups = baseItems.map((entry) => {
        const key = getSpaceKey(entry.block, entry.number);
        return {
          key,
          label: key,
          items: [entry],
          collapsed: key === hiddenKey,
        };
      });
      const view = render(<ShoppingList {...props} />);
      expectExactCanonicalRows(
        view.container,
        buildListRows({ items: baseItems, groups }),
      );
      expect(
        view.container.querySelector(
          '[data-item-id="item-2"][data-is-selected]',
        ),
      ).toBeNull();
      const collapsedControllerModel = controllerSpy.mock.calls.at(-1)?.[0];
      expect(collapsedControllerModel?.itemIds).toEqual(
        baseItems.map((entry) => entry.id),
      );
      expect(
        collapsedControllerModel?.itemRows.map((row) => row.itemId),
      ).toEqual(["item-1", "item-3"]);

      const hiddenSelection = new Set(["item-2"]);
      view.rerender(
        <ShoppingList {...props} selectedItemIds={hiddenSelection} />,
      );
      view.rerender(
        <ShoppingList
          {...props}
          selectedItemIds={hiddenSelection}
          collapsedSpaces={new Set()}
        />,
      );
      expectExactCanonicalRows(
        view.container,
        buildListRows({
          items: baseItems,
          groups: groups.map((group) => ({ ...group, collapsed: false })),
          selectedItemIds: hiddenSelection,
        }),
      );
      expect(
        view.container.querySelector(
          '[data-item-id="item-2"][data-is-selected] input[type="checkbox"]',
        ),
      ).toBeChecked();

      view.rerender(<ShoppingList {...props} />);
      const highest = { ...item(4), priorityLevel: "highest" as const };
      const regroupedItems = [highest, baseItems[2], baseItems[1]];
      const hallProps = {
        ...props,
        items: regroupedItems,
        showSpaceGroups: false,
        showHallGroups: true,
      };
      const hallGroups = [
        {
          key: "undefined:highest",
          label: "ホール未定義最優先",
          items: [highest],
        },
        {
          key: "ungrouped:1",
          label: "ホール未定義",
          items: [baseItems[2], baseItems[1]],
        },
      ];
      view.rerender(<ShoppingList {...hallProps} />);
      expectExactCanonicalRows(
        view.container,
        buildListRows({ items: regroupedItems, groups: hallGroups }),
      );
      const selectedItemIds = new Set(["item-3"]);
      view.rerender(
        <ShoppingList {...hallProps} selectedItemIds={selectedItemIds} />,
      );
      const expectedModel = buildListRows({
        items: regroupedItems,
        groups: hallGroups,
        selectedItemIds,
      });
      expectExactCanonicalRows(view.container, expectedModel);
      expect(
        view.container.querySelector(
          '[data-item-id="item-3"] input[type="checkbox"]',
        ),
      ).toBeChecked();

      view.rerender(
        <ShoppingList
          {...hallProps}
          items={[highest, baseItems[1]]}
          selectedItemIds={selectedItemIds}
        />,
      );
      expect(
        view.container.querySelector('[data-item-id="item-3"]'),
      ).toBeNull();
      view.rerender(
        <ShoppingList {...hallProps} selectedItemIds={selectedItemIds} />,
      );
      expectExactCanonicalRows(view.container, expectedModel);
      expect(
        view.container.querySelector(
          '[data-item-id="item-3"] input[type="checkbox"]',
        ),
      ).toBeChecked();
    } finally {
      controllerSpy.mockRestore();
    }
  });
  it.each([
    {
      engine: "full",
      port: preferencePort({ status: "ok", value: "full" }),
    },
    {
      engine: "virtual",
      port: preferencePort({ status: "ok", value: "auto" }),
    },
  ] as const)(
    "routes $engine selection, focus, and scrolling through the shared controller",
    ({ engine, port }) => {
      setViewportScale(1);
      const onSelectItem = vi.fn<SelectItemHandler>();
      const view = renderLongList({ port, onSelectItem });
      const root = view.container.firstElementChild as HTMLElement;
      const firstRow = root.querySelector<HTMLElement>('[role="listitem"]');
      const firstItem = root.querySelector<HTMLElement>(
        '[data-item-id="item-1"]',
      );
      const checkbox = firstRow?.querySelector<HTMLInputElement>(
        'input[type="checkbox"]',
      );

      expect(root).toHaveAttribute("data-list-renderer", engine);
      expect(root).toHaveAttribute("data-list-controller", "shared");
      expect(firstRow).toHaveAttribute("aria-label", "東A1 サークル1 新刊1");
      expect(checkbox).not.toBeNull();

      fireEvent.focus(checkbox!);
      expect(root).toHaveAttribute(
        "data-list-focused-row-key",
        firstRow?.dataset.rowKey,
      );

      fireEvent.click(checkbox!);
      expect(checkbox).toBeChecked();
      expect(firstItem).toHaveAttribute("data-is-selected", "true");
      expect(onSelectItem).toHaveBeenCalledWith(
        "item-1",
        undefined,
        expect.any(Object),
      );

      view.unmount();
    },
    15_000,
  );

  it("fails closed for unsupported zoom, multiple columns, and recovery", () => {
    setViewportScale(1.25);
    const zoomed = renderLongList();
    expect(
      zoomed.container.firstElementChild?.getAttribute("data-list-renderer"),
    ).toBe("full");
    zoomed.unmount();

    setViewportScale(1);
    const multipleColumns = renderLongList({ layoutMode: "pc" });
    expect(
      multipleColumns.container.firstElementChild?.getAttribute(
        "data-list-renderer",
      ),
    ).toBe("full");
    multipleColumns.unmount();

    const recovery = renderLongList({ recoveryActive: true });
    expect(
      recovery.container.firstElementChild?.getAttribute("data-list-renderer"),
    ).toBe("full");
  }, 20_000);

  it("keeps a corrupt preference and the QA policy on the full long-list path", () => {
    setViewportScale(1);
    const corrupt = renderLongList({
      port: preferencePort({ status: "invalid" }),
    });
    expect(
      corrupt.container.firstElementChild?.getAttribute(
        "data-list-renderer-reason",
      ),
    ).toBe("preference-full");
    corrupt.unmount();

    const failedRead = renderLongList({
      port: {
        read: () => {
          throw new Error("storage unavailable");
        },
        write: vi.fn(() => false),
      },
    });
    expect(
      failedRead.container.firstElementChild?.getAttribute(
        "data-list-renderer-reason",
      ),
    ).toBe("preference-full");
    failedRead.unmount();

    const forced = render(
      <ShoppingList
        items={longItems}
        onUpdateItem={vi.fn()}
        onMoveItem={vi.fn()}
        onEditRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
        selectedItemIds={new Set()}
        onSelectItem={vi.fn()}
        skipLimitedPurchaseForSingleQuantity={false}
        listRendererPreferencePort={preferencePort({
          status: "ok",
          value: "auto",
        })}
        layoutMode="smartphone"
        forceFullListRenderer
      />,
    );
    expect(
      forced.container.firstElementChild?.getAttribute(
        "data-list-renderer-reason",
      ),
    ).toBe("force-full");
  }, 20_000);

  it("switches to the full renderer before processing an active drag", () => {
    setViewportScale(1);
    const view = renderLongList();
    const source = view.container.querySelector<HTMLElement>(
      '[data-item-id="item-1"]',
    );
    expect(source).not.toBeNull();

    fireEvent.dragStart(source!, {
      dataTransfer: { setData: vi.fn() },
    });

    expect(
      view.container.firstElementChild?.getAttribute("data-list-renderer"),
    ).toBe("full");
    expect(
      view.container.firstElementChild?.getAttribute(
        "data-list-renderer-reason",
      ),
    ).toBe("virtual-ineligible");
  });
});

interface RangeRendererCase {
  name: string;
  layoutMode: "pc" | "smartphone";
  preference: "auto" | "full";
  intersectionObserver: boolean;
  renderer: "full" | "virtual";
  strategy: "retained-viewport" | null;
  reason: "preference-full" | "virtual-eligible";
  count: number;
}

const rangeRendererCases: RangeRendererCase[] = [
  {
    name: "Full PC",
    layoutMode: "pc",
    preference: "full",
    intersectionObserver: true,
    renderer: "full",
    strategy: null,
    reason: "preference-full",
    count: 150,
  },
  {
    name: "Full smartphone",
    layoutMode: "smartphone",
    preference: "full",
    intersectionObserver: true,
    renderer: "full",
    strategy: null,
    reason: "preference-full",
    count: 500,
  },
  {
    name: "Retained PC",
    layoutMode: "pc",
    preference: "auto",
    intersectionObserver: true,
    renderer: "virtual",
    strategy: "retained-viewport",
    reason: "virtual-eligible",
    count: 150,
  },
  {
    name: "Retained smartphone",
    layoutMode: "smartphone",
    preference: "auto",
    intersectionObserver: true,
    renderer: "virtual",
    strategy: "retained-viewport",
    reason: "virtual-eligible",
    count: 500,
  },
  {
    name: "TanStack smartphone",
    layoutMode: "smartphone",
    preference: "auto",
    intersectionObserver: false,
    renderer: "virtual",
    strategy: null,
    reason: "virtual-eligible",
    count: 500,
  },
];

const RendererRangeHarness = ({
  rangeItems,
  layoutMode,
  port,
  onSelectItem,
}: {
  rangeItems: ShoppingItem[];
  layoutMode: "pc" | "smartphone";
  port: ListRendererPreferencePort;
  onSelectItem: SelectItemHandler;
}) => {
  const state = useListInteractionState();
  return (
    <>
      <output data-testid="range-selection">
        {JSON.stringify([...state.selectedItemIds].sort())}
      </output>
      <output data-testid="range-endpoints">
        {JSON.stringify([state.rangeStart, state.rangeEnd])}
      </output>
      <button onClick={state.clearRangeSelection}>Clear endpoints</button>
      <ShoppingList
        items={rangeItems}
        onUpdateItem={vi.fn()}
        onMoveItem={vi.fn()}
        onEditRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
        selectedItemIds={state.selectedItemIds}
        onSelectItem={(itemId, column, presentation) => {
          onSelectItem(itemId, column, presentation);
          state.selectItemForRange(itemId, presentation);
        }}
        rangeStart={state.rangeStart}
        rangeEnd={state.rangeEnd}
        onToggleRangeSelection={state.toggleRangeItemIdsSelection}
        skipLimitedPurchaseForSingleQuantity={false}
        listRendererPreferencePort={port}
        layoutMode={layoutMode}
        recoveryActive={false}
        currentDay="1日目"
        viewMode="edit"
        columnType="execute"
        showSpaceGroups={false}
        showHallGroups
        hallDefinitions={[]}
      />
    </>
  );
};

// Keep the real TanStack runtime and deferred row controls; only browser geometry
// and capabilities are supplied by the test environment.
describe("ShoppingList range selection across renderer strategies", () => {
  let geometrySpy: ReturnType<typeof vi.spyOn>;
  afterEach(() => {
    geometrySpy?.mockRestore();
    vi.unstubAllGlobals();
  });

  it.each(
    rangeRendererCases.flatMap((rendererCase) =>
      (["forward", "reverse"] as const).flatMap((direction) =>
        (["short", "long"] as const).map((rangeLength) => ({
          ...rendererCase,
          direction,
          rangeLength,
        })),
      ),
    ),
  )(
    "$name selects and clears the same $rangeLength range $direction without changing outside checks",
    async (rendererCase) => {
      setViewportScale(1);
      vi.stubGlobal("scrollY", 0);
      vi.stubGlobal("pageYOffset", 0);
      vi.stubGlobal(
        "IntersectionObserver",
        rendererCase.intersectionObserver
          ? class {
              observe() {}
              unobserve() {}
              disconnect() {}
            }
          : undefined,
      );
      geometrySpy = vi
        .spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockImplementation(function (this: HTMLElement) {
          const index = Number(this.dataset.index ?? "0");
          const top = index * 144 - window.scrollY;
          return {
            top,
            bottom: top + 136,
            height: 136,
            width: 400,
            left: 0,
            right: 400,
            x: 0,
            y: top,
            toJSON: () => ({}),
          } as DOMRect;
        });
      const rangeItems = Array.from(
        { length: rendererCase.count },
        (_, index) => ({ ...item(index + 1), priorityLevel: "none" as const }),
      );
      const onSelectItem = vi.fn<SelectItemHandler>();
      const view = render(
        <RendererRangeHarness
          rangeItems={rangeItems}
          layoutMode={rendererCase.layoutMode}
          port={preferencePort({
            status: "ok",
            value: rendererCase.preference,
          })}
          onSelectItem={onSelectItem}
        />,
      );
      const root = view.container.querySelector<HTMLElement>(
        "[data-list-renderer]",
      )!;
      const assertRenderer = () => {
        expect(root).toHaveAttribute(
          "data-list-renderer",
          rendererCase.renderer,
        );
        expect(root.getAttribute("data-list-renderer-strategy")).toBe(
          rendererCase.strategy,
        );
        expect(root).toHaveAttribute(
          "data-list-renderer-reason",
          rendererCase.reason,
        );
        expect(root).toHaveAttribute(
          "data-list-row-count",
          String(rendererCase.count),
        );
        expect(typeof IntersectionObserver === "function").toBe(
          rendererCase.intersectionObserver,
        );
        expect(typeof ResizeObserver).toBe("function");
        expect(typeof HTMLElement.prototype.focus).toBe("function");
        expect(window.visualViewport?.scale).toBe(1);
      };
      const checkbox = (index: number): HTMLInputElement => {
        const control = root.querySelector<HTMLInputElement>(
          `[data-item-id="item-${index}"] input[type="checkbox"]`,
        );
        if (!control) throw new Error(`Item ${index} is not rendered`);
        return control;
      };
      const selectedIds = () =>
        JSON.parse(view.getByTestId("range-selection").textContent ?? "[]");

      const showCheckbox = async (index: number) => {
        if (rendererCase.strategy === "retained-viewport") {
          const row = root.querySelector<HTMLElement>(
            `[aria-posinset="${index}"]`,
          )!;
          act(() => revealViewportContent(row));
        } else if (rendererCase.renderer === "virtual") {
          act(() => {
            vi.stubGlobal("scrollY", (index - 1) * 144);
            vi.stubGlobal("pageYOffset", window.scrollY);
            fireEvent.scroll(window);
          });
          await waitFor(() => expect(checkbox(index)).toBeInTheDocument());
        }
        return checkbox(index);
      };

      assertRenderer();
      if (rendererCase.renderer === "virtual") {
        expect(
          root.querySelectorAll('input[type="checkbox"]').length,
        ).toBeLessThan(rendererCase.count);
      }
      const lastEndpoint =
        rendererCase.rangeLength === "short" ? 3 : rendererCase.count;
      if (rendererCase.rangeLength === "short") {
        fireEvent.click(await showCheckbox(4));
        fireEvent.click(view.getByRole("button", { name: "Clear endpoints" }));
      }
      const endpoints =
        rendererCase.direction === "forward"
          ? [1, lastEndpoint]
          : [lastEndpoint, 1];
      for (const endpoint of endpoints)
        fireEvent.click(await showCheckbox(endpoint));
      expect(onSelectItem).toHaveBeenLastCalledWith(
        `item-${endpoints[1]}`,
        "execute",
        expect.objectContaining({ grouping: "flat" }),
      );
      fireEvent.click(view.getAllByTitle("範囲内のチェックを入れる")[0]);
      const expectedIds =
        rendererCase.rangeLength === "short"
          ? ["item-1", "item-2", "item-3", "item-4"]
          : rangeItems.map((item) => item.id).sort();
      expect(selectedIds()).toEqual(expectedIds);
      const checkIndexes =
        rendererCase.rangeLength === "short"
          ? [1, 2, 3, 4]
          : [1, Math.floor(rendererCase.count / 2), rendererCase.count];
      for (const index of checkIndexes)
        expect(await showCheckbox(index)).toBeChecked();
      fireEvent.click(view.getAllByTitle("範囲内のチェックを外す")[0]);
      expect(selectedIds()).toEqual(
        rendererCase.rangeLength === "short" ? ["item-4"] : [],
      );
      expect(view.getByTestId("range-endpoints")).toHaveTextContent(
        "[null,null]",
      );
      for (const index of checkIndexes) {
        if (rendererCase.rangeLength === "short" && index === 4) {
          expect(await showCheckbox(index)).toBeChecked();
        } else {
          expect(await showCheckbox(index)).not.toBeChecked();
        }
      }
      expect(view.queryByTitle("範囲内のチェックを入れる")).toBeNull();
      expect(view.queryByTitle("範囲内のチェックを外す")).toBeNull();
      assertRenderer();
      expect(await showCheckbox(rendererCase.count)).not.toBeChecked();
      view.unmount();
    },
    30_000,
  );
});

describe("ShoppingList transfer background presentation", () => {
  it.each(["full", "retained"] as const)(
    "keeps unchanged %s card bodies while a three-item transfer updates palette and accessibility",
    async (renderer) => {
      setViewportScale(1);
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      const geometry = vi
        .spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockReturnValue({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 640,
          bottom: 160,
          width: 640,
          height: 160,
          toJSON: () => ({}),
        } as DOMRect);
      const makeColumn = (prefix: string, offset: number) =>
        Array.from(
          { length: 20 },
          (_, index): ShoppingItem => ({
            ...item(index + 1),
            id: prefix + index,
            block: "A",
            number: String(offset + index) + "a",
            priorityLevel: "none",
          }),
        );
      const candidates = makeColumn("c", 40);
      const execution = makeColumn("e", 90);
      const moving = candidates.slice(1, 4);
      const movedIds = new Set(moving.map((entry) => entry.id));
      const nextCandidates = candidates.filter(
        (entry) => !movedIds.has(entry.id),
      );
      const nextExecution = [execution[0], ...moving, ...execution.slice(1)];
      const retainedIds = [...candidates, ...execution].map(
        (entry) => entry.id,
      );
      const emptySelection = new Set<string>();
      const port = preferencePort({
        status: "ok",
        value: renderer === "full" ? "full" : "auto",
      });
      const callbacks = {
        onUpdateItem: vi.fn(),
        onMoveItem: vi.fn(),
        onEditRequest: vi.fn(),
        onDeleteRequest: vi.fn(),
        onSelectItem: vi.fn(),
      };
      const columns = (
        candidateItems: ShoppingItem[],
        executeItems: ShoppingItem[],
        selected: Set<string>,
      ) => (
        <>
          <ShoppingList
            {...callbacks}
            items={candidateItems}
            selectedItemIds={selected}
            columnType="candidate"
            showSpaceGroups
            layoutMode="pc"
            viewMode="edit"
            skipLimitedPurchaseForSingleQuantity={false}
            listRendererPreferencePort={port}
            forceFullListRenderer={renderer === "full"}
            retainedItemIds={retainedIds}
          />
          <ShoppingList
            {...callbacks}
            items={executeItems}
            selectedItemIds={selected}
            columnType="execute"
            showSpaceGroups
            layoutMode="pc"
            viewMode="edit"
            skipLimitedPurchaseForSingleQuantity={false}
            listRendererPreferencePort={port}
            forceFullListRenderer={renderer === "full"}
            retainedItemIds={retainedIds}
          />
        </>
      );
      shoppingPerformance.enable();
      try {
        const view = render(columns(candidates, execution, movedIds));
        const roots = [
          ...view.container.querySelectorAll<HTMLElement>(
            "[data-list-renderer]",
          ),
        ];
        expect(roots).toHaveLength(2);
        const [source, destination] = roots;
        if (renderer === "retained") {
          expect(source).toHaveAttribute(
            "data-list-renderer-strategy",
            "retained-viewport",
          );
          expect(destination).toHaveAttribute(
            "data-list-renderer-strategy",
            "retained-viewport",
          );
        } else {
          expect(source).toHaveAttribute("data-list-renderer", "full");
        }
        const rowFor = (root: HTMLElement, id: string) => {
          const row = root.querySelector<HTMLElement>(
            '[data-item-id="' + id + '"]:not([data-space-group-key])',
          );
          if (!row) throw new Error("Missing mounted item " + id);
          return row;
        };
        const sourceItem = rowFor(source, "c4");
        const destinationItem = rowFor(destination, "e1");
        const sourceCard = sourceItem.firstElementChild as HTMLElement;
        const destinationCard =
          destinationItem.firstElementChild as HTMLElement;
        const sourceRow = sourceItem.closest("[aria-posinset]");
        const destinationRow = destinationItem.closest("[aria-posinset]");
        const price = sourceCard.querySelector<HTMLSelectElement>(
          'select[aria-label="購入金額"]',
        )!;
        const quantity = sourceCard.querySelector<HTMLSelectElement>(
          'select[aria-label="購入予定数量"]',
        )!;
        const firstPriceChoice = price.options[0];
        const firstQuantityChoice = quantity.options[0];
        expect(sourceRow).toHaveAttribute("aria-posinset", "5");
        expect(sourceRow).toHaveAttribute("aria-setsize", "20");
        expect(destinationRow).toHaveAttribute("aria-posinset", "2");
        expect(destinationRow).toHaveAttribute("aria-setsize", "20");
        act(() => price.focus());
        shoppingPerformance.reset();

        view.rerender(columns(nextCandidates, nextExecution, emptySelection));
        await waitFor(() => {
          expect(sourceRow).toHaveAttribute("aria-posinset", "2");
          expect(sourceRow).toHaveAttribute("aria-setsize", "17");
          expect(destinationRow).toHaveAttribute("aria-posinset", "5");
          expect(destinationRow).toHaveAttribute("aria-setsize", "23");
        });
        expect(rowFor(source, "c4")).toBe(sourceItem);
        expect(rowFor(destination, "e1")).toBe(destinationItem);
        expect(sourceItem.firstElementChild).toBe(sourceCard);
        expect(destinationItem.firstElementChild).toBe(destinationCard);
        expect(calculateBlockColors(candidates).get("c4")).not.toBe(
          calculateBlockColors(nextCandidates).get("c4"),
        );
        expect(calculateBlockColors(execution).get("e1")).not.toBe(
          calculateBlockColors(nextExecution).get("e1"),
        );
        expect(sourceCard).toHaveClass(
          ...calculateBlockColors(nextCandidates).get("c4")!.split(/\s+/),
        );
        expect(destinationCard).toHaveClass(
          ...calculateBlockColors(nextExecution).get("e1")!.split(/\s+/),
        );
        expect(sourceCard.querySelector('select[aria-label="購入金額"]')).toBe(
          price,
        );
        expect(
          sourceCard.querySelector('select[aria-label="購入予定数量"]'),
        ).toBe(quantity);
        expect(price.options[0]).toBe(firstPriceChoice);
        expect(quantity.options[0]).toBe(firstQuantityChoice);
        expect(price).toHaveFocus();
        // Three cards mount in the other list. The other 37 bodies stay current
        // without rebuilding their controls for background-only prop changes.
        expect(shoppingPerformance.read().renders.card).toBe(3);
        for (const moved of moving) {
          expect(
            source.querySelector('[data-item-id="' + moved.id + '"]'),
          ).toBeNull();
          expect(
            rowFor(destination, moved.id).querySelector(
              'input[type="checkbox"]',
            ),
          ).not.toBeChecked();
        }
        view.unmount();
      } finally {
        shoppingPerformance.enable(false);
        shoppingPerformance.reset();
        geometry.mockRestore();
        vi.unstubAllGlobals();
      }
    },
  );
});
