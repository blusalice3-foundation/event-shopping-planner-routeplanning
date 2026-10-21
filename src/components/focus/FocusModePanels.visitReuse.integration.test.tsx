import React from "react";
import { act, fireEvent, render, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../../types/item";
import { FocusModeItemList } from "./FocusModePanels";
import { createFocusVisitDisplayItemsProjector } from "./focusVisitDisplayItems";
import FocusMode from "../FocusMode";
import { minimalProps } from "../FocusMode.fixtures";

const callerLists = vi.hoisted(() => ({
  values: [] as Array<{
    items: readonly ShoppingItem[];
    price: Set<string>;
    limited: Set<string>;
  }>,
}));
vi.mock("./FocusModePanels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./FocusModePanels")>();
  return {
    ...actual,
    FocusModeItemList: (
      props: React.ComponentProps<typeof actual.FocusModeItemList>,
    ) => {
      callerLists.values.push({
        items: props.currentVisitDisplayItems,
        price: props.blinkingPriceItemIds,
        limited: props.blinkingLimitedMissingItemIds!,
      });
      return <actual.FocusModeItemList {...props} />;
    },
  };
});

const counters = vi.hoisted(() => ({
  mounts: new Map<string, number>(),
  unmounts: new Map<string, number>(),
}));
vi.mock("../ShoppingItemCard", () => ({
  default: function MockShoppingItemCard({
    item,
    onUpdate,
  }: {
    item: ShoppingItem;
    onUpdate: (item: ShoppingItem) => void;
  }) {
    React.useEffect(() => {
      counters.mounts.set(item.id, (counters.mounts.get(item.id) ?? 0) + 1);
      return () => {
        counters.unmounts.set(
          item.id,
          (counters.unmounts.get(item.id) ?? 0) + 1,
        );
      };
    }, [item.id]);
    return (
      <div>
        <input aria-label="draft" defaultValue={item.remarks} />
        <button
          onClick={() => onUpdate({ ...item, quantity: item.quantity + 1 })}
        >
          update
        </button>
        <a href={item.url}>link</a>
      </div>
    );
  },
}));
const makeItem = (id: string): ShoppingItem => ({
  id,
  eventDate: "1日目",
  block: "A",
  number: "1",
  circle: "ユーザー登録",
  title: "新刊",
  price: 500,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "エラーが発生しました",
  url: "https://example.test/original",
});

describe("focus visit visibility and rows-only memo boundary", () => {
  beforeEach(() => {
    callerLists.values = [];
    counters.mounts.clear();
    counters.unmounts.clear();
  });

  it("keeps all retained controls/DOM/input state while hiding and restoring a large visit", () => {
    const large = Array.from({ length: 80 }, (_, i) => makeItem(`large-${i}`));
    const small = makeItem("small"),
      items = [...large, small];
    const largeIds = large.map((item) => item.id),
      smallIds = ["small"];
    const project = createFocusVisitDisplayItemsProjector();
    const blinking = new Set<string>(),
      limited = new Set<string>();
    const has = vi.spyOn(blinking, "has"),
      onUpdateItem = vi.fn();
    const shared = {
      itemListRef: React.createRef<HTMLDivElement>(),
      layoutMode: "pc" as const,
      isMapVisible: false,
      blinkingPriceItemIds: blinking,
      blinkingLimitedMissingItemIds: limited,
      retainedItemIds: new Set(items.map((item) => item.id)),
      skipLimitedPurchaseForSingleQuantity: false,
      onUpdateItem,
    };
    const view = render(
      <FocusModeItemList
        {...shared}
        visitId="large"
        currentVisitDisplayItems={project(items, largeIds)}
      />,
    );
    const row = view.container.querySelector<HTMLElement>(
      '[data-item-id="large-0"]',
    )!;
    const input = within(row).getByRole("textbox", { name: "draft" });
    fireEvent.change(input, { target: { value: "入力途中" } });
    const visit = row.closest<HTMLElement>("[data-viewport-list]")!;
    expect(visit.hidden).toBe(false);
    expect(row.getAttribute("aria-setsize")).toBe("80");
    has.mockClear();
    view.rerender(
      <FocusModeItemList
        {...shared}
        visitId="small"
        currentVisitDisplayItems={project(items, smallIds)}
      />,
    );
    expect(visit.hidden).toBe(true);
    expect(visit.getAttribute("aria-hidden")).toBe("true");
    expect(
      view.container.querySelectorAll('[data-item-id^="large-"]'),
    ).toHaveLength(80);
    // Only the newly displayed small visit maps its item; the large hidden wrapper
    // changes without re-running its 80-item map/has checks.
    expect(has.mock.calls.length).toBe(1);
    has.mockClear();
    view.rerender(
      <FocusModeItemList
        {...shared}
        visitId="large"
        currentVisitDisplayItems={project(items, largeIds)}
      />,
    );
    expect(view.container.querySelector('[data-item-id="large-0"]')).toBe(row);
    expect(within(row).getByRole("textbox", { name: "draft" })).toBe(input);
    expect(input).toHaveValue("入力途中");
    expect(visit.hidden).toBe(false);
    expect(has).not.toHaveBeenCalled();
    expect(counters.mounts.get("large-0")).toBe(1);
    expect(counters.unmounts.get("large-0") ?? 0).toBe(0);

    const latest = vi.fn();
    view.rerender(
      <FocusModeItemList
        {...shared}
        onUpdateItem={latest}
        visitId="large"
        currentVisitDisplayItems={project(items, largeIds)}
      />,
    );
    fireEvent.click(within(row).getByRole("button", { name: "update" }));
    expect(latest).toHaveBeenCalledWith(
      expect.objectContaining({ id: "large-0", quantity: 2 }),
    );
    expect(onUpdateItem).not.toHaveBeenCalled();
    const changed = {
      ...large[0],
      quantity: 5,
      url: "https://example.test/current",
    };
    const changedItems = [changed, ...items.slice(1)];
    view.rerender(
      <FocusModeItemList
        {...shared}
        onUpdateItem={latest}
        visitId="large"
        currentVisitDisplayItems={project(changedItems, largeIds)}
      />,
    );
    expect(within(row).getByRole("link", { name: "link" })).toHaveAttribute(
      "href",
      changed.url,
    );
    expect(within(row).getByRole("textbox", { name: "draft" })).toBe(input);
    expect(input).toHaveValue("入力途中");
    fireEvent.click(within(row).getByRole("button", { name: "update" }));
    expect(latest).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "large-0", quantity: 6 }),
    );
  });
});

describe("real FocusMode caller preserves unchanged warning membership", () => {
  const latestList = () => callerLists.values.at(-1)!;
  const clickVisit = (
    view: ReturnType<typeof render>,
    direction: "next" | "back",
  ) => {
    const label =
      direction === "next" ? "次の訪問先へ移動" : "前の訪問先へ移動";
    const button = view.baseElement.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    expect(button).not.toBeNull();
    fireEvent.click(button!);
  };

  it("restores a 1490-item visit without remapping it after the caller's empty-warning effect", () => {
    const large = Array.from({ length: 1490 }, (_, index) =>
      makeItem(`caller-large-${index}`),
    );
    const small = { ...makeItem("caller-small"), number: "2" };
    const items = [...large, small];
    const view = render(
      <FocusMode
        {...minimalProps({
          items,
          executeModeItemIds: items.map((item) => item.id),
        })}
      />,
    );
    const first = latestList();
    expect(first.items).toHaveLength(1490);
    expect(first.price.size).toBe(0);
    expect(first.limited.size).toBe(0);
    const priceHas = vi.spyOn(first.price, "has");
    const limitedHas = vi.spyOn(first.limited, "has");
    try {
      clickVisit(view, "next");
      expect(latestList().items.map((item) => item.id)).toEqual([small.id]);
      expect(latestList().price).toBe(first.price);
      expect(latestList().limited).toBe(first.limited);
      priceHas.mockClear();
      limitedHas.mockClear();
      clickVisit(view, "back");
      expect(latestList().items).toBe(first.items);
      expect(latestList().price).toBe(first.price);
      expect(latestList().limited).toBe(first.limited);
      expect(
        priceHas.mock.calls.some(([id]) => id.startsWith("caller-large-")),
      ).toBe(false);
      expect(
        limitedHas.mock.calls.some(([id]) => id.startsWith("caller-large-")),
      ).toBe(false);
      const row = view.container.querySelector<HTMLElement>(
        '[data-item-id="caller-large-0"]',
      )!;
      expect(row.closest<HTMLElement>("[data-viewport-list]")!.hidden).toBe(
        false,
      );
      expect(counters.mounts.get("caller-large-0")).toBe(1);
    } finally {
      priceHas.mockRestore();
      limitedHas.mockRestore();
      view.unmount();
    }
  });

  it("still updates real price/limited warning membership and clears the corresponding row rings", () => {
    const price = {
      ...makeItem("caller-price"),
      purchaseStatus: "Purchased" as const,
      price: null,
    };
    const limited = {
      ...makeItem("caller-limited"),
      purchaseStatus: "LimitedPurchase" as const,
      quantity: 5,
    };
    const ids = [price.id, limited.id];
    const base = minimalProps({
      items: [price, limited],
      executeModeItemIds: ids,
    });
    const view = render(<FocusMode {...base} />);
    const first = latestList();
    expect([...first.price]).toEqual([price.id]);
    expect([...first.limited]).toEqual([limited.id]);
    expect(
      view.container.querySelector('[data-item-id="caller-price"]'),
    ).toHaveClass("ring-red-500");
    expect(
      view.container.querySelector('[data-item-id="caller-limited"]'),
    ).toHaveClass("ring-orange-500");
    view.rerender(
      <FocusMode {...base} items={[{ ...price, quantity: 2 }, limited]} />,
    );
    expect(latestList().price).toBe(first.price);
    expect(latestList().limited).toBe(first.limited);
    view.rerender(
      <FocusMode
        {...base}
        items={[
          { ...price, price: 500 },
          { ...limited, limitedPurchasedQuantity: 2 },
        ]}
      />,
    );
    expect(latestList().price.size).toBe(0);
    expect(latestList().limited.size).toBe(0);
    expect(latestList().price).not.toBe(first.price);
    expect(latestList().limited).not.toBe(first.limited);
    expect(
      view.container.querySelector('[data-item-id="caller-price"]'),
    ).not.toHaveClass("ring-red-500");
    expect(
      view.container.querySelector('[data-item-id="caller-limited"]'),
    ).not.toHaveClass("ring-orange-500");
  });

  it("keeps the unchecked-visit notification delay and expiry while equal warning Sets stay unchanged", async () => {
    const first = makeItem("caller-timer-first");
    const second = { ...makeItem("caller-timer-second"), number: "2" };
    const items = [first, second];
    const view = render(
      <FocusMode
        {...minimalProps({
          items,
          executeModeItemIds: items.map((item) => item.id),
        })}
      />,
    );
    vi.useFakeTimers();
    try {
      const initial = latestList();
      clickVisit(view, "next");
      expect(latestList().price).toBe(initial.price);
      expect(latestList().limited).toBe(initial.limited);
      expect(
        view.queryByText("前のサークルでチェック漏れがあります"),
      ).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(99);
      });
      expect(
        view.queryByText("前のサークルでチェック漏れがあります"),
      ).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(
        view.getByText("前のサークルでチェック漏れがあります"),
      ).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1999);
      });
      expect(
        view.getByText("前のサークルでチェック漏れがあります"),
      ).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(
        view.queryByText("前のサークルでチェック漏れがあります"),
      ).toBeNull();
    } finally {
      view.unmount();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
