import type { ComponentProps } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../types/item";
import type { HallDefinition } from "../types/map";
import { useListInteractionState } from "../features/lists/hooks/useListInteractionState";
import ShoppingList from "./ShoppingList";
import type { RangePresentation } from "../features/lists/domain/rangeSelection";

const makeItem = (id: string, number: string): ShoppingItem => ({
  id,
  circle: `Circle ${id}`,
  eventDate: "Day1",
  block: "A",
  number,
  title: `Title ${id}`,
  price: 100,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "",
  priorityLevel: "none",
});

const items = [
  makeItem("first", "01"),
  makeItem("middle-a", "02"),
  makeItem("middle-b", "03"),
  makeItem("last", "04"),
];

type RangeHarnessProps = {
  listProps?: Partial<ComponentProps<typeof ShoppingList>>;
  onPresentation?: (presentation: RangePresentation) => void;
  onRangeToggle?: (itemIds: readonly string[]) => void;
};

const RangeHarness = ({
  listProps,
  onPresentation,
  onRangeToggle,
}: RangeHarnessProps) => {
  const rangeState = useListInteractionState();

  return (
    <>
      <button onClick={rangeState.clearRangeSelection}>Clear endpoints</button>
      <button onClick={rangeState.clearSelection}>Clear all selection</button>
      <output data-testid="range-state">
        {JSON.stringify({
          selected: [...rangeState.selectedItemIds].sort(),
          start: rangeState.rangeStart,
          end: rangeState.rangeEnd,
        })}
      </output>
      <ShoppingList
        items={items}
        onUpdateItem={vi.fn()}
        onMoveItem={vi.fn()}
        onEditRequest={vi.fn()}
        onDeleteRequest={vi.fn()}
        columnType="candidate"
        currentDay="Day1"
        layoutMode="pc"
        viewMode="edit"
        forceFullListRenderer
        skipLimitedPurchaseForSingleQuantity
        {...listProps}
        selectedItemIds={rangeState.selectedItemIds}
        onSelectItem={(itemId, _columnType, presentation) => {
          onPresentation?.(presentation);
          rangeState.selectItemForRange(itemId, presentation);
        }}
        rangeStart={rangeState.rangeStart}
        rangeEnd={rangeState.rangeEnd}
        onToggleRangeSelection={(itemIds) => {
          onRangeToggle?.(itemIds);
          rangeState.toggleRangeItemIdsSelection(itemIds);
        }}
        onSelectSpaceGroupForRange={rangeState.selectSpaceGroupForRange}
      />
    </>
  );
};

const itemCheckbox = (id: string) =>
  screen.getByRole("checkbox", {
    name: `Select item Circle ${id} - Title ${id}`,
  });

const readRangeState = () =>
  JSON.parse(screen.getByTestId("range-state").textContent!) as {
    selected: string[];
    start: { itemId: string; scopeKey: string } | null;
    end: { itemId: string; scopeKey: string } | null;
  };

const executeFlatProps: Partial<ComponentProps<typeof ShoppingList>> = {
  columnType: "execute",
  showSpaceGroups: false,
  showHallGroups: true,
  hallDefinitions: [],
};

const hallDefinitions: HallDefinition[] = [
  { id: "hall-a", name: "Hall A", vertices: [], blockNames: ["A"] },
  { id: "hall-b", name: "Hall B", vertices: [], blockNames: ["B"] },
];

const groupedSpanItems = ["a", "b", "c", "d"].flatMap((group) => [
  { ...makeItem(`${group}1`, "01a"), block: group.toUpperCase() },
  { ...makeItem(`${group}2`, "01a2"), block: group.toUpperCase() },
]);

const expectNoChain = () => {
  expect(
    screen.queryByTitle("範囲内のチェックを入れる"),
  ).not.toBeInTheDocument();
  expect(screen.queryByTitle("範囲内のチェックを外す")).not.toBeInTheDocument();
};

const groupedItems = [
  { ...makeItem("priority", "01a"), priorityLevel: "priority" as const },
  { ...makeItem("highest", "01a2"), priorityLevel: "highest" as const },
  {
    ...makeItem("ordinary", "02"),
    block: "B",
    priorityLevel: "none" as const,
  },
];

const SpaceRangeHarness = () => {
  const rangeState = useListInteractionState();

  return (
    <ShoppingList
      items={groupedItems}
      onUpdateItem={vi.fn()}
      onMoveItem={vi.fn()}
      onEditRequest={vi.fn()}
      onDeleteRequest={vi.fn()}
      selectedItemIds={rangeState.selectedItemIds}
      onSelectItem={(itemId, _columnType, presentation) =>
        rangeState.selectItemForRange(itemId, presentation)
      }
      columnType="execute"
      currentDay="Day1"
      rangeStart={rangeState.rangeStart}
      rangeEnd={rangeState.rangeEnd}
      onToggleRangeSelection={rangeState.toggleRangeItemIdsSelection}
      onSelectSpaceGroupForRange={rangeState.selectSpaceGroupForRange}
      showSpaceGroups
      collapsedSpaces={new Set(["A-01a:priority", "A-01a:highest", "B-02"])}
      layoutMode="pc"
      viewMode="edit"
      skipLimitedPurchaseForSingleQuantity
    />
  );
};

describe("ShoppingList range selection integration", () => {
  it.each(["candidate", "execute"] as const)(
    "restores parent checks when %s model members return after filtering",
    (columnType) => {
      const listProps = {
        columnType,
        showSpaceGroups: false,
        items,
      };
      const view = render(<RangeHarness listProps={listProps} />);
      fireEvent.click(itemCheckbox("first"));
      fireEvent.click(itemCheckbox("last"));
      const selected = readRangeState().selected;

      view.rerender(
        <RangeHarness listProps={{ ...listProps, items: items.slice(1, 3) }} />,
      );
      expect(readRangeState().selected).toEqual(selected);
      expect(
        screen.queryByRole("checkbox", {
          name: "Select item Circle first - Title first",
        }),
      ).not.toBeInTheDocument();
      expect(itemCheckbox("middle-a")).not.toBeChecked();

      view.rerender(<RangeHarness listProps={listProps} />);
      expect(itemCheckbox("first")).toBeChecked();
      expect(itemCheckbox("last")).toBeChecked();
      expect(itemCheckbox("middle-a")).not.toBeChecked();
      expect(readRangeState().selected).toEqual(selected);

      fireEvent.click(itemCheckbox("first"));
      expect(itemCheckbox("first")).not.toBeChecked();
      expect(itemCheckbox("last")).toBeChecked();
      expect(readRangeState().selected).toEqual(["last"]);
    },
  );

  it("uses the same rendered range for the chain and the actual check state", () => {
    render(<RangeHarness />);

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select item Circle first - Title first",
      }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select item Circle last - Title last",
      }),
    );

    fireEvent.click(screen.getAllByTitle("範囲内のチェックを入れる")[0]);

    for (const item of items) {
      expect(
        screen.getByRole("checkbox", {
          name: `Select item ${item.circle} - ${item.title}`,
        }),
      ).toBeChecked();
    }

    fireEvent.click(screen.getAllByTitle("範囲内のチェックを外す")[0]);

    for (const item of items) {
      expect(
        screen.getByRole("checkbox", {
          name: `Select item ${item.circle} - ${item.title}`,
        }),
      ).not.toBeChecked();
    }
  });

  it("keeps priority-separated display groups distinct and selects the displayed group span", () => {
    const view = render(<SpaceRangeHarness />);
    const groupElements = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-space-group-key]"),
    );
    const groupKeys = groupElements.map(
      (element) => element.dataset.spaceGroupKey,
    );

    expect(groupElements).toHaveLength(3);
    expect(groupKeys).toContain("A-01a:priority");
    expect(groupKeys).toContain("A-01a:highest");

    const firstCheckbox = groupElements[0].querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    const lastCheckbox = groupElements[2].querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(firstCheckbox).not.toBeNull();
    expect(lastCheckbox).not.toBeNull();

    fireEvent.click(firstCheckbox!);
    fireEvent.click(lastCheckbox!);
    fireEvent.click(screen.getAllByTitle("範囲内のチェックを入れる")[0]);

    for (const groupElement of groupElements) {
      expect(
        groupElement.querySelector<HTMLInputElement>('input[type="checkbox"]'),
      ).toBeChecked();
    }
  });

  it.each([
    ["pc", false],
    ["pc", true],
    ["smartphone", false],
    ["smartphone", true],
  ] as const)(
    "selects and clears the three-item execute range in %s (reverse=%s)",
    (layoutMode, reverse) => {
      const onPresentation = vi.fn<(presentation: RangePresentation) => void>();
      const onRangeToggle = vi.fn<(itemIds: readonly string[]) => void>();
      const flatItems = [...items, makeItem("untouched", "05")];
      render(
        <RangeHarness
          listProps={{ ...executeFlatProps, layoutMode, items: flatItems }}
          onPresentation={onPresentation}
          onRangeToggle={onRangeToggle}
        />,
      );
      fireEvent.click(itemCheckbox("last"));
      fireEvent.click(screen.getByRole("button", { name: "Clear endpoints" }));
      const endpoints = reverse ? ["middle-b", "first"] : ["first", "middle-b"];
      endpoints.forEach((id) => fireEvent.click(itemCheckbox(id)));

      expect(
        screen.getAllByTitle("範囲内のチェックを入れる").length,
      ).toBeGreaterThan(0);
      expect(onPresentation).toHaveBeenLastCalledWith(
        expect.objectContaining({
          grouping: "flat",
          itemIds: flatItems.map((item) => item.id),
        }),
      );
      fireEvent.click(screen.getAllByTitle("範囲内のチェックを入れる")[0]);
      expect(onRangeToggle).toHaveBeenLastCalledWith([
        "first",
        "middle-a",
        "middle-b",
      ]);
      expect(readRangeState().selected).toEqual([
        "first",
        "last",
        "middle-a",
        "middle-b",
      ]);
      ["first", "middle-a", "middle-b", "last"].forEach((id) =>
        expect(itemCheckbox(id)).toBeChecked(),
      );
      expect(itemCheckbox("untouched")).not.toBeChecked();

      fireEvent.click(screen.getAllByTitle("範囲内のチェックを外す")[0]);
      expect(readRangeState()).toEqual({
        selected: ["last"],
        start: null,
        end: null,
      });
      ["first", "middle-a", "middle-b", "untouched"].forEach((id) =>
        expect(itemCheckbox(id)).not.toBeChecked(),
      );
      expect(itemCheckbox("last")).toBeChecked();
      expect(
        screen.queryByTitle("範囲内のチェックを入れる"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTitle("範囲内のチェックを外す"),
      ).not.toBeInTheDocument();
    },
  );

  it.each<{
    label: string;
    changed: Partial<ComponentProps<typeof ShoppingList>>;
    grouping: RangePresentation["grouping"];
  }>([
    {
      label: "spaces",
      changed: { showSpaceGroups: true },
      grouping: "space",
    },
    {
      label: "added hall definitions",
      changed: { hallDefinitions: [hallDefinitions[0]] },
      grouping: "hall",
    },
    {
      label: "one non-null priority group",
      changed: {
        items: items.map((item) => ({
          ...item,
          priorityLevel: "priority" as const,
        })),
      },
      grouping: "hall",
    },
    {
      label: "multiple priority groups",
      changed: {
        items: items.map((item, index) => ({
          ...item,
          priorityLevel:
            index === 3 ? ("priority" as const) : ("none" as const),
        })),
      },
      grouping: "hall",
    },
  ])(
    "invalidates old scopes without clearing them when switching to $label",
    ({ changed, grouping }) => {
      const onPresentation = vi.fn<(presentation: RangePresentation) => void>();
      const props = { ...executeFlatProps, items };
      const view = render(
        <RangeHarness listProps={props} onPresentation={onPresentation} />,
      );
      fireEvent.click(itemCheckbox("first"));
      fireEvent.click(itemCheckbox("middle-b"));
      expect(
        screen.getAllByTitle("範囲内のチェックを入れる").length,
      ).toBeGreaterThan(0);
      const previousState = readRangeState();
      expect(onPresentation.mock.lastCall?.[0].grouping).toBe("flat");

      view.rerender(
        <RangeHarness
          listProps={{ ...props, ...changed }}
          onPresentation={onPresentation}
        />,
      );
      expectNoChain();
      expect(readRangeState()).toEqual(previousState);
      expect(itemCheckbox("first")).toBeChecked();
      expect(itemCheckbox("middle-b")).toBeChecked();

      view.rerender(
        <RangeHarness listProps={props} onPresentation={onPresentation} />,
      );
      expect(
        screen.getAllByTitle("範囲内のチェックを入れる").length,
      ).toBeGreaterThan(0);
      expect(readRangeState()).toEqual(previousState);

      view.rerender(
        <RangeHarness
          listProps={{ ...props, ...changed }}
          onPresentation={onPresentation}
        />,
      );
      fireEvent.click(itemCheckbox("last"));
      expect(onPresentation.mock.lastCall?.[0].grouping).toBe(grouping);
      expect(readRangeState().start?.itemId).toBe("last");
      expect(readRangeState().start?.scopeKey).not.toBe(
        previousState.start?.scopeKey,
      );
      expect(readRangeState().end).toBeNull();
      expectNoChain();
    },
  );

  it("starts a fresh range after selecting unselected endpoints in a new scope", () => {
    const onRangeToggle = vi.fn<(itemIds: readonly string[]) => void>();
    const scopeItems = [
      ...items,
      makeItem("fresh-middle", "05"),
      makeItem("fresh-end", "06"),
    ];
    const props = { ...executeFlatProps, items: scopeItems };
    const view = render(
      <RangeHarness listProps={props} onRangeToggle={onRangeToggle} />,
    );
    fireEvent.click(itemCheckbox("first"));
    fireEvent.click(itemCheckbox("middle-b"));
    const oldScope = readRangeState().start?.scopeKey;
    view.rerender(
      <RangeHarness
        listProps={{ ...props, showSpaceGroups: true }}
        onRangeToggle={onRangeToggle}
      />,
    );
    expectNoChain();
    fireEvent.click(itemCheckbox("fresh-end"));
    fireEvent.click(itemCheckbox("last"));
    expect(readRangeState().start?.itemId).toBe("fresh-end");
    expect(readRangeState().end?.itemId).toBe("last");
    expect(readRangeState().start?.scopeKey).not.toBe(oldScope);
    fireEvent.click(screen.getAllByTitle("範囲内のチェックを入れる")[0]);
    expect(onRangeToggle).toHaveBeenLastCalledWith([
      "last",
      "fresh-middle",
      "fresh-end",
    ]);
    expect(readRangeState().selected).toEqual([
      "first",
      "fresh-end",
      "fresh-middle",
      "last",
      "middle-b",
    ]);
    fireEvent.click(screen.getAllByTitle("範囲内のチェックを外す")[0]);
    expect(readRangeState()).toEqual({
      selected: ["first", "middle-b"],
      start: null,
      end: null,
    });
    expectNoChain();
  });

  it.each([false, true])(
    "selects complete expanded display groups between a2 and c1 (reverse=%s)",
    (reverse) => {
      const onRangeToggle = vi.fn<(itemIds: readonly string[]) => void>();
      render(
        <RangeHarness
          listProps={{
            ...executeFlatProps,
            items: groupedSpanItems,
            showSpaceGroups: true,
            collapsedSpaces: new Set(),
          }}
          onRangeToggle={onRangeToggle}
        />,
      );
      fireEvent.click(itemCheckbox("d1"));
      fireEvent.click(screen.getByRole("button", { name: "Clear endpoints" }));
      (reverse ? ["c1", "a2"] : ["a2", "c1"]).forEach((id) =>
        fireEvent.click(itemCheckbox(id)),
      );
      fireEvent.click(screen.getAllByTitle("範囲内のチェックを入れる")[0]);
      expect(onRangeToggle).toHaveBeenLastCalledWith([
        "a1",
        "a2",
        "b1",
        "b2",
        "c1",
        "c2",
      ]);
      expect(readRangeState().selected).toEqual([
        "a1",
        "a2",
        "b1",
        "b2",
        "c1",
        "c2",
        "d1",
      ]);
      ["a1", "a2", "b1", "b2", "c1", "c2", "d1"].forEach((id) =>
        expect(itemCheckbox(id)).toBeChecked(),
      );
      expect(itemCheckbox("d2")).not.toBeChecked();
      fireEvent.click(screen.getAllByTitle("範囲内のチェックを外す")[0]);
      expect(readRangeState()).toEqual({
        selected: ["d1"],
        start: null,
        end: null,
      });
      expect(itemCheckbox("d1")).toBeChecked();
      expect(itemCheckbox("d2")).not.toBeChecked();
      expectNoChain();
    },
  );

  it.each([
    {
      label: "flat neighbors",
      listProps: executeFlatProps,
      endpoints: ["first", "middle-a"],
    },
    {
      label: "neighbors across expanded spaces",
      listProps: {
        ...executeFlatProps,
        items: groupedSpanItems,
        showSpaceGroups: true,
      },
      endpoints: ["a2", "b1"],
    },
  ])("suppresses the chain for $label", ({ listProps, endpoints }) => {
    render(<RangeHarness listProps={listProps} />);
    fireEvent.click(itemCheckbox(endpoints[0]));
    expectNoChain();
    fireEvent.click(itemCheckbox(endpoints[1]));
    expectNoChain();
    expect(readRangeState().end).toBeNull();
  });

  it("clears the only endpoint when its checkbox is toggled off", () => {
    render(<RangeHarness listProps={executeFlatProps} />);
    fireEvent.click(itemCheckbox("first"));
    expectNoChain();
    fireEvent.click(itemCheckbox("first"));
    expect(readRangeState()).toEqual({ selected: [], start: null, end: null });
    expectNoChain();
  });

  it("keeps selection within one displayed hall and preserves another hall", () => {
    const onPresentation = vi.fn<(presentation: RangePresentation) => void>();
    const onRangeToggle = vi.fn<(itemIds: readonly string[]) => void>();
    const hallItems = items.map((item, index) => ({
      ...item,
      block: index === 3 ? "B" : "A",
    }));
    render(
      <RangeHarness
        listProps={{ ...executeFlatProps, items: hallItems, hallDefinitions }}
        onPresentation={onPresentation}
        onRangeToggle={onRangeToggle}
      />,
    );
    fireEvent.click(itemCheckbox("last"));
    fireEvent.click(screen.getByRole("button", { name: "Clear endpoints" }));
    fireEvent.click(itemCheckbox("first"));
    fireEvent.click(itemCheckbox("middle-b"));
    expect(onPresentation.mock.lastCall?.[0]).toMatchObject({
      grouping: "hall",
      groups: [
        { key: "hall-a", itemIds: ["first", "middle-a", "middle-b"] },
        { key: "hall-b", itemIds: ["last"] },
      ],
    });
    fireEvent.click(screen.getAllByTitle("範囲内のチェックを入れる")[0]);
    expect(onRangeToggle).toHaveBeenLastCalledWith([
      "first",
      "middle-a",
      "middle-b",
    ]);
    expect(readRangeState().selected).toEqual([
      "first",
      "last",
      "middle-a",
      "middle-b",
    ]);
    fireEvent.click(screen.getAllByTitle("範囲内のチェックを外す")[0]);
    expect(readRangeState()).toEqual({
      selected: ["last"],
      start: null,
      end: null,
    });
    expectNoChain();
  });

  it("does not offer a range across displayed hall boundaries", () => {
    render(
      <RangeHarness
        listProps={{
          ...executeFlatProps,
          items: items.map((item, index) => ({
            ...item,
            block: index === 3 ? "B" : "A",
          })),
          hallDefinitions,
        }}
      />,
    );
    fireEvent.click(itemCheckbox("first"));
    fireEvent.click(itemCheckbox("last"));
    expectNoChain();
    expect(readRangeState().selected).toEqual(["first", "last"]);
    expect(readRangeState().start?.itemId).toBe("last");
    expect(readRangeState().end).toBeNull();
  });

  it("slices item endpoints inside one expanded space group", () => {
    const sameSpaceItems = items.map((item, index) => ({
      ...item,
      number: index === 0 ? "01a" : `01a${index + 1}`,
    }));
    const onRangeToggle = vi.fn<(itemIds: readonly string[]) => void>();
    render(
      <RangeHarness
        listProps={{
          ...executeFlatProps,
          showSpaceGroups: true,
          items: sameSpaceItems,
        }}
        onRangeToggle={onRangeToggle}
      />,
    );
    fireEvent.click(itemCheckbox("first"));
    fireEvent.click(itemCheckbox("middle-b"));
    fireEvent.click(screen.getAllByTitle("範囲内のチェックを入れる")[0]);
    expect(onRangeToggle).toHaveBeenLastCalledWith([
      "first",
      "middle-a",
      "middle-b",
    ]);
    expect(readRangeState().selected).toEqual([
      "first",
      "middle-a",
      "middle-b",
    ]);
    expect(itemCheckbox("last")).not.toBeChecked();
    fireEvent.click(screen.getAllByTitle("範囲内のチェックを外す")[0]);
    expect(readRangeState()).toEqual({ selected: [], start: null, end: null });
    expectNoChain();
  });

  it.each(["pc", "smartphone"] as const)(
    "keeps rapid chain toggles synchronized with controlled selection in %s",
    async (layoutMode) => {
      const onRangeToggle = vi.fn<(itemIds: readonly string[]) => void>();
      const listProps = { ...executeFlatProps, layoutMode };
      const view = render(
        <RangeHarness listProps={listProps} onRangeToggle={onRangeToggle} />,
      );
      fireEvent.click(itemCheckbox("last"));
      fireEvent.click(screen.getByRole("button", { name: "Clear endpoints" }));
      fireEvent.click(itemCheckbox("first"));
      fireEvent.click(itemCheckbox("middle-b"));
      const chain = screen.getAllByTitle("範囲内のチェックを入れる")[0];
      // Both updates arrive before the controlled selection effect is flushed.
      act(() => {
        fireEvent.click(chain);
        fireEvent.click(chain);
      });
      expect(onRangeToggle).toHaveBeenCalledTimes(2);
      for (const [rangeIds] of onRangeToggle.mock.calls) {
        expect(rangeIds).toEqual(["first", "middle-a", "middle-b"]);
      }
      expect(readRangeState()).toEqual({
        selected: ["last"],
        start: null,
        end: null,
      });
      expect(itemCheckbox("last")).toBeChecked();
      ["first", "middle-a", "middle-b"].forEach((id) =>
        expect(itemCheckbox(id)).not.toBeChecked(),
      );
      expectNoChain();

      view.rerender(
        <RangeHarness listProps={listProps} onRangeToggle={onRangeToggle} />,
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(readRangeState()).toEqual({
        selected: ["last"],
        start: null,
        end: null,
      });
      expect(itemCheckbox("last")).toBeChecked();
      expectNoChain();
      expect(onRangeToggle).toHaveBeenCalledTimes(2);

      // A new range starts normally after the rapid clear; old endpoints stay cleared.
      fireEvent.click(itemCheckbox("first"));
      expect(readRangeState().start?.itemId).toBe("first");
      expect(readRangeState().end).toBeNull();
      expectNoChain();
      fireEvent.click(itemCheckbox("middle-b"));
      fireEvent.click(screen.getAllByTitle("範囲内のチェックを入れる")[0]);
      expect(readRangeState().selected).toEqual([
        "first",
        "last",
        "middle-a",
        "middle-b",
      ]);
      ["first", "middle-a", "middle-b", "last"].forEach((id) =>
        expect(itemCheckbox(id)).toBeChecked(),
      );
      expect(onRangeToggle).toHaveBeenCalledTimes(3);
      expect(onRangeToggle).toHaveBeenLastCalledWith([
        "first",
        "middle-a",
        "middle-b",
      ]);

      // Parent-owned clearing must still replace the list's synchronized local checks.
      fireEvent.click(
        screen.getByRole("button", { name: "Clear all selection" }),
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(readRangeState()).toEqual({
        selected: [],
        start: null,
        end: null,
      });
      for (const item of items) expect(itemCheckbox(item.id)).not.toBeChecked();
      expectNoChain();
      expect(onRangeToggle).toHaveBeenCalledTimes(3);
    },
  );
});
