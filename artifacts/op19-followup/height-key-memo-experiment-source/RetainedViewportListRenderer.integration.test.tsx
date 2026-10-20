import React from "react";
import { shoppingPerformance } from "../../../utils/shoppingPerformance";
import ShoppingList from "../../../components/ShoppingList";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildListRows } from "../model/buildListRows";
import type { ShoppingItem } from "../../../types/item";
import { RetainedViewportListRenderer } from "./RetainedViewportListRenderer";
import {
  prewarmViewportContent,
  revealViewportContent,
  ViewportContent,
  VIEWPORT_RETENTION_EVENT,
} from "./ViewportContent";
import { evaluateRetainedViewportEligibility } from "./retainedViewportEligibility";

let callback: IntersectionObserverCallback;
const observed = new Set<Element>();
const disconnect = vi.fn();
const visibleKeys = new Set<string>();
beforeEach(() => {
  disconnect.mockClear();
  const observers = new Set<{
    next: IntersectionObserverCallback;
    targets: Set<Element>;
  }>();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      targets = new Set<Element>();
      constructor(public next: IntersectionObserverCallback) {
        observers.add(this);
        callback = (entries) => {
          for (const observer of observers) {
            const ownEntries = entries.filter((entry) =>
              observer.targets.has(entry.target),
            );
            if (ownEntries.length)
              observer.next(
                ownEntries,
                observer as unknown as IntersectionObserver,
              );
          }
        };
      }
      observe(element: Element) {
        this.targets.add(element);
        observed.add(element);
      }
      unobserve(element: Element) {
        this.targets.delete(element);
        if (![...observers].some((observer) => observer.targets.has(element)))
          observed.delete(element);
      }
      disconnect() {
        disconnect();
        for (const target of this.targets) this.unobserve(target);
        observers.delete(this);
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        top:
          !this.dataset.viewportRowKey ||
          visibleKeys.has(this.dataset.viewportRowKey)
            ? 20
            : 10000,
        bottom:
          !this.dataset.viewportRowKey ||
          visibleKeys.has(this.dataset.viewportRowKey)
            ? 156
            : 10136,
        height: 136,
        width: 400,
        left: 0,
        right: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    },
  );
});
afterEach(() => {
  shoppingPerformance.enable(false);
  visibleKeys.clear();
  observed.clear();
  disconnect.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const items: ShoppingItem[] = Array.from({ length: 100 }, (_, index) => ({
  id: "item-" + index,
  eventDate: "1日目",
  circle: "ユーザー登録" + index,
  title: "新刊" + index,
  block: "A",
  number: String(index + 1),
  price: 500,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "エラーが発生しました",
}));

describe("retained viewport rendering", () => {
  it("keeps all canonical accessible rows while generating only visible controls", () => {
    const model = buildListRows({ items });
    visibleKeys.add(model.rows[0].rowKey);
    const view = render(
      <RetainedViewportListRenderer
        model={model}
        accessibleLabel="買い物リスト"
        renderRow={(row) =>
          row.kind === "item" ? (
            <input aria-label={row.itemId} defaultValue={row.item.circle} />
          ) : null
        }
      />,
    );
    expect(view.container.querySelectorAll("input")).toHaveLength(1);
    expect(view.container.querySelectorAll("[data-row-key]")).toHaveLength(100);
    expect(view.container.querySelector('[aria-setsize="100"]')).not.toBeNull();
    expect(view.container.querySelector("[style]")).toBeNull();
    expect(view.container.firstElementChild).toHaveAttribute(
      "data-list-renderer",
      "virtual",
    );
  });

  it.each(["nondeferred", "retained", "visible", "printing"] as const)(
    "keeps %s rows active without scanning their descendants",
    (reason) => {
      const rowKey = `skip-retention-scan-${reason}`;
      if (reason === "visible") visibleKeys.add(rowKey);
      const view = render(
        <ViewportContent
          rowKey={rowKey}
          defer={reason !== "nondeferred"}
          retain={reason === "retained"}
          placeholder={<span>pending</span>}
          render={() => (
            <input aria-label="既存の入力" defaultValue="ユーザー登録" />
          )}
        />,
      );
      if (reason === "printing") fireEvent(window, new Event("beforeprint"));
      const root = view.container.firstElementChild as HTMLElement;
      const input = view.getByRole("textbox", { name: "既存の入力" });
      const query = vi.spyOn(root, "querySelector");
      const queryAll = vi.spyOn(root, "querySelectorAll");
      fireEvent(root, new Event(VIEWPORT_RETENTION_EVENT, { bubbles: true }));
      expect(query).not.toHaveBeenCalled();
      expect(queryAll).not.toHaveBeenCalled();
      expect(root).toHaveAttribute("data-viewport-active", "true");
      expect(view.getByRole("textbox", { name: "既存の入力" })).toBe(input);
      if (reason === "printing") fireEvent(window, new Event("afterprint"));
    },
  );

  it("keeps an offscreen pinned descendant active without scanning requested rows", () => {
    const view = render(
      <ViewportContent
        rowKey="offscreen-pinned-descendant"
        placeholder={<span data-viewport-retain="true">pending</span>}
        render={() => (
          <input data-viewport-retain="true" aria-label="保持中の入力" />
        )}
      />,
    );
    const root = view.container.firstElementChild as HTMLElement;
    const input = view.getByRole("textbox", { name: "保持中の入力" });
    const queryAll = vi.spyOn(root, "querySelectorAll");
    fireEvent(root, new Event(VIEWPORT_RETENTION_EVENT, { bubbles: true }));
    expect(queryAll).not.toHaveBeenCalled();
    expect(root).toHaveAttribute("data-viewport-active", "true");
    expect(view.getByRole("textbox", { name: "保持中の入力" })).toBe(input);
    input.removeAttribute("data-viewport-retain");
    fireEvent(root, new Event(VIEWPORT_RETENTION_EVENT, { bubbles: true }));
    expect(root).toHaveAttribute("data-viewport-active", "false");
  });

  it("keeps an offscreen requested row active until its owner releases it", () => {
    const view = render(
      <ViewportContent
        rowKey="offscreen-requested-row"
        placeholder={<span>pending</span>}
        render={() => <input aria-label="要求中の入力" />}
      />,
    );
    const root = view.container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("data-viewport-active", "false");
    let release!: () => void;
    act(() => {
      release = prewarmViewportContent(root);
    });
    const input = view.getByRole("textbox", { name: "要求中の入力" });
    fireEvent(root, new Event(VIEWPORT_RETENTION_EVENT, { bubbles: true }));
    expect(view.getByRole("textbox", { name: "要求中の入力" })).toBe(input);
    act(() => release());
    expect(root).toHaveAttribute("data-viewport-active", "false");
    expect(input).not.toBeInTheDocument();
  });
  it("reuses height keys only while every input and the nearest list remain unchanged", () => {
    const callbacks = new Map<Element, ResizeObserverCallback>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private next: ResizeObserverCallback) {}
        observe(target: Element) {
          callbacks.set(target, this.next);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    const properties = [
      "innerWidth",
      "visualViewport",
      "devicePixelRatio",
    ] as const;
    const descriptors = properties.map(
      (name) => [name, Object.getOwnPropertyDescriptor(window, name)] as const,
    );
    let view: ReturnType<typeof render> | undefined;
    const setViewport = (innerWidth: number, scale: number, dpr: number) => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: innerWidth,
      });
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: { scale },
      });
      Object.defineProperty(window, "devicePixelRatio", {
        configurable: true,
        value: dpr,
      });
    };
    try {
      setViewport(1200, 1, 1);
      const encoded = vi.spyOn(JSON, "stringify");
      const keyCalls = () =>
        encoded.mock.calls.filter(
          ([value]) =>
            Array.isArray(value) &&
            value.length === 6 &&
            String(value[0]).startsWith("height-key-memo"),
        );
      const content = (rowKey: string, layoutKey: string) => (
        <div data-viewport-list>
          <ViewportContent
            rowKey={rowKey}
            layoutKey={layoutKey}
            placeholder={<span>pending</span>}
            render={() => <input />}
          />
        </div>
      );
      visibleKeys.add("height-key-memo-one");
      visibleKeys.add("height-key-memo-two");
      view = render(content("height-key-memo-one", "layout-one"));
      const list = view.container.firstElementChild as HTMLElement;
      const root = list.firstElementChild as HTMLElement;
      const resize = () =>
        act(() =>
          callbacks.get(root)!(
            [
              {
                target: root,
                contentRect: new DOMRect(0, 0, 400, 176),
                borderBoxSize: [{ blockSize: 176, inlineSize: 400 }],
                contentBoxSize: [],
                devicePixelContentBoxSize: [],
              },
            ],
            {} as ResizeObserver,
          ),
        );
      expect(keyCalls()).toHaveLength(1);
      resize();
      resize();
      expect(keyCalls()).toHaveLength(1);
      view.rerender(content("height-key-memo-two", "layout-one"));
      expect(keyCalls()).toHaveLength(2);
      view.rerender(content("height-key-memo-two", "layout-two"));
      expect(keyCalls()).toHaveLength(3);
      list.dataset.viewportWidth = "600";
      resize();
      expect(keyCalls()).toHaveLength(4);
      setViewport(1400, 1, 1);
      resize();
      expect(keyCalls()).toHaveLength(5);
      setViewport(1400, 2, 1);
      resize();
      expect(keyCalls()).toHaveLength(6);
      setViewport(1400, 2, 2);
      resize();
      expect(keyCalls()).toHaveLength(7);
      expect(keyCalls().at(-1)?.[0]).toEqual([
        "height-key-memo-two",
        "600",
        "layout-two",
        1400,
        2,
        2,
      ]);
      const otherList = document.createElement("div");
      otherList.dataset.viewportList = "";
      otherList.dataset.viewportWidth = "600";
      view.container.append(otherList);
      otherList.append(root);
      resize();
      expect(keyCalls()).toHaveLength(8);
      list.append(root);
      otherList.remove();
      resize();
      expect(keyCalls()).toHaveLength(9);
      resize();
      expect(keyCalls()).toHaveLength(9);
    } finally {
      view?.unmount();
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(window, name, descriptor);
        else Reflect.deleteProperty(window, name);
      }
    }
  });

  it.each(["width", "innerWidth", "scale", "dpr"] as const)(
    "separates remounted height caches when %s changes",
    (changed) => {
      const callbacks = new Map<Element, ResizeObserverCallback>();
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(private next: ResizeObserverCallback) {}
          observe(target: Element) {
            callbacks.set(target, this.next);
          }
          unobserve() {}
          disconnect() {}
        },
      );
      const properties = [
        "innerWidth",
        "visualViewport",
        "devicePixelRatio",
      ] as const;
      const descriptors = properties.map(
        (name) =>
          [name, Object.getOwnPropertyDescriptor(window, name)] as const,
      );
      const setViewport = (innerWidth: number, scale: number, dpr: number) => {
        Object.defineProperty(window, "innerWidth", {
          configurable: true,
          value: innerWidth,
        });
        Object.defineProperty(window, "visualViewport", {
          configurable: true,
          value: { scale },
        });
        Object.defineProperty(window, "devicePixelRatio", {
          configurable: true,
          value: dpr,
        });
      };
      const rectangles = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
      const rectangle = rectangles.getMockImplementation()!;
      rectangles.mockImplementation(function (this: HTMLElement) {
        const result = rectangle.call(this);
        return this.hasAttribute("data-viewport-list")
          ? { ...result, width: Number(this.dataset.testWidth) }
          : result;
      });
      const rowKey = `height-cache-remount-${changed}`;
      const content = (width: number) => (
        <div data-viewport-list data-test-width={width}>
          <ViewportContent
            rowKey={rowKey}
            placeholder={<span>pending</span>}
            render={() => <input aria-label="高さを保持する入力" />}
          />
        </div>
      );
      let view: ReturnType<typeof render> | undefined;
      try {
        setViewport(1200, 1, 1);
        visibleKeys.add(rowKey);
        view = render(content(400));
        const root = view.container.querySelector("[data-viewport-row-key]")!;
        act(() =>
          callbacks.get(root)!(
            [
              {
                target: root,
                contentRect: new DOMRect(0, 0, 400, 196),
                borderBoxSize: [{ blockSize: 196, inlineSize: 400 }],
                contentBoxSize: [],
                devicePixelContentBoxSize: [],
              },
            ],
            {} as ResizeObserver,
          ),
        );
        view.unmount();
        visibleKeys.delete(rowKey);
        setViewport(
          changed === "innerWidth" ? 1400 : 1200,
          changed === "scale" ? 2 : 1,
          changed === "dpr" ? 2 : 1,
        );
        view = render(content(changed === "width" ? 600 : 400));
        expect(
          view.container.querySelector("[data-viewport-row-key]"),
        ).toHaveAttribute("data-layout-height", "220px");
        view.unmount();
        setViewport(1200, 1, 1);
        view = render(content(400));
        expect(
          view.container.querySelector("[data-viewport-row-key]"),
        ).toHaveAttribute("data-layout-height", "196px");
      } finally {
        view?.unmount();
        for (const [name, descriptor] of descriptors) {
          if (descriptor) Object.defineProperty(window, name, descriptor);
          else Reflect.deleteProperty(window, name);
        }
      }
    },
  );
  it("preserves row heights while a list is hidden and resets them for a real width change", () => {
    const callbacks = new Map<Element, ResizeObserverCallback>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private next: ResizeObserverCallback) {}
        observe(target: Element) {
          callbacks.set(target, this.next);
        }
        unobserve(target: Element) {
          callbacks.delete(target);
        }
        disconnect() {}
      },
    );
    visibleKeys.add("hidden-width-cache");
    const renderRow = vi.fn(() => (
      <input aria-label="保持する編集" defaultValue="ユーザー登録" />
    ));
    const view = render(
      <div data-viewport-list>
        <ViewportContent
          rowKey="hidden-width-cache"
          defer
          estimatedHeight={220}
          placeholder={<span>エラーが発生しました</span>}
          render={renderRow}
        />
      </div>,
    );
    const list = view.container.firstElementChild as HTMLElement;
    const input = view.getByRole("textbox", { name: "保持する編集" });
    fireEvent.change(input, { target: { value: "入力中の編集" } });
    const rendered = renderRow.mock.calls.length;
    const resize = (width: number) =>
      act(() =>
        callbacks.get(list)!(
          [
            {
              target: list,
              contentRect: new DOMRect(0, 0, width, 136),
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          {} as ResizeObserver,
        ),
      );

    expect(list.dataset.viewportWidth).toBe("400");
    resize(0);
    expect(list.dataset.viewportWidth).toBe("400");
    resize(400);
    expect(renderRow).toHaveBeenCalledTimes(rendered);
    expect(view.getByRole("textbox", { name: "保持する編集" })).toBe(input);
    expect(input).toHaveValue("入力中の編集");

    resize(600);
    expect(list.dataset.viewportWidth).toBe("600");
    expect(renderRow.mock.calls.length).toBeGreaterThan(rendered);
    expect(input).toHaveValue("入力中の編集");
  });

  it("uses reported heights without forced reads and reuses them on activation", () => {
    const callbacks = new Map<Element, ResizeObserverCallback>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private next: ResizeObserverCallback) {}
        observe(target: Element) {
          callbacks.set(target, this.next);
        }
        unobserve(target: Element) {
          callbacks.delete(target);
        }
        disconnect() {}
      },
    );
    visibleKeys.add("reported-height-cache");
    const view = render(
      <div data-viewport-list>
        <ViewportContent
          rowKey="reported-height-cache"
          defer
          estimatedHeight={220}
          placeholder={<span>pending</span>}
          render={() => <span>measured</span>}
        />
      </div>,
    );
    const root = view.container.querySelector<HTMLElement>(
      "[data-viewport-row-key]",
    )!;
    const rectangles = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    const resize = (borderBoxSize: ResizeObserverSize[]) =>
      act(() =>
        callbacks.get(root)!(
          [
            {
              target: root,
              contentRect: new DOMRect(
                0,
                0,
                400,
                borderBoxSize.length ? borderBoxSize[0].blockSize : 136,
              ),
              borderBoxSize,
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          {} as ResizeObserver,
        ),
      );
    const intersect = (isIntersecting: boolean) =>
      act(() =>
        callback(
          [
            {
              target: root,
              isIntersecting,
              boundingClientRect: new DOMRect(0, 0, 400, 136),
              intersectionRect: isIntersecting
                ? new DOMRect(0, 0, 400, 136)
                : new DOMRect(),
              intersectionRatio: Number(isIntersecting),
              rootBounds: null,
              time: 0,
            },
          ],
          {} as IntersectionObserver,
        ),
      );

    rectangles.mockClear();
    resize([{ blockSize: 176, inlineSize: 400 }]);
    expect(rectangles).not.toHaveBeenCalled();
    intersect(false);
    expect(root).toHaveAttribute("data-layout-height", "176px");

    rectangles.mockClear();
    intersect(true);
    expect(rectangles).not.toHaveBeenCalled();
    resize([{ blockSize: 0, inlineSize: 0 }]);
    intersect(false);
    expect(root).toHaveAttribute("data-layout-height", "176px");

    intersect(true);
    resize([{ blockSize: 212, inlineSize: 400 }]);
    intersect(false);
    expect(root).toHaveAttribute("data-layout-height", "212px");

    intersect(true);
    rectangles.mockClear();
    resize([]);
    expect(rectangles).toHaveBeenCalledTimes(1);
    intersect(false);
    expect(root).toHaveAttribute("data-layout-height", "136px");
  });

  it("retains an activated control, its edit and focus after leaving the viewport", () => {
    const model = buildListRows({ items });
    visibleKeys.add(model.rows[0].rowKey);
    const content = (
      <RetainedViewportListRenderer
        model={model}
        accessibleLabel="買い物リスト"
        renderRow={(row) =>
          row.kind === "item" ? (
            <input aria-label={row.itemId} defaultValue={row.item.circle} />
          ) : null
        }
      />
    );
    const view = render(content);
    const input = view.getByRole("textbox", { name: "item-0" });
    input.focus();
    fireEvent.change(input, { target: { value: "入力中の編集" } });
    visibleKeys.clear();
    act(() =>
      callback(
        [...observed].map((target) => ({
          target,
          isIntersecting: false,
        })) as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    view.rerender(content);
    expect(view.getByRole("textbox", { name: "item-0" })).toBe(input);
    expect(input).toHaveValue("入力中の編集");
    expect(input).toHaveFocus();
  });

  it("reveals an offscreen grouped target and its ancestor before navigation", () => {
    const model = buildListRows({
      items,
      groups: [{ key: "A1", label: "A1", items }],
    });
    const view = render(
      <RetainedViewportListRenderer
        model={model}
        accessibleLabel="買い物リスト"
        getVisitId={(item) => "visit-" + item.id}
        renderGroup={(_group, rows) => (
          <section>
            {rows.map((row) =>
              row.render(
                <input
                  aria-label={row.row.itemId}
                  defaultValue={row.row.item.circle}
                />,
              ),
            )}
          </section>
        )}
      />,
    );
    expect(view.container.querySelectorAll("input")).toHaveLength(0);
    const target = view.container.querySelector<HTMLElement>(
      '[data-space-navigation-visit-id="visit-item-90"]',
    )!;
    act(() => revealViewportContent(target));
    expect(view.getByRole("textbox", { name: "item-90" })).toHaveValue(
      "ユーザー登録90",
    );
    expect(view.container.querySelectorAll("[data-row-key]")).toHaveLength(101);
    expect(view.container.querySelectorAll("input")).toHaveLength(1);
  });

  it("keeps collapsed group navigation anchors without creating hidden item controls", () => {
    const model = buildListRows({
      items,
      groups: [{ key: "A1", label: "A1", items, collapsed: true }],
    });
    const view = render(
      <RetainedViewportListRenderer
        model={model}
        accessibleLabel="買い物リスト"
        getGroupVisitId={() => "collapsed-visit"}
        renderGroup={() => <button>展開する</button>}
      />,
    );
    const anchor = view.container.querySelector<HTMLElement>(
      '[data-space-navigation-visit-id="collapsed-visit"]',
    )!;
    expect(anchor).not.toBeNull();
    act(() => revealViewportContent(anchor));
    expect(view.getByRole("button", { name: "展開する" })).toBeInTheDocument();
  });

  it("activates every item, including deferred children of groups, before printing", () => {
    const model = buildListRows({
      items,
      groups: [{ key: "A1", label: "A1", items }],
    });
    const view = render(
      <RetainedViewportListRenderer
        model={model}
        accessibleLabel="買い物リスト"
        renderGroup={(_group, rows) => (
          <section>
            {rows.map((row) =>
              row.render(
                <input
                  aria-label={row.row.itemId}
                  defaultValue={row.row.item.circle}
                />,
              ),
            )}
          </section>
        )}
      />,
    );
    fireEvent(window, new Event("beforeprint"));
    expect(view.container.querySelectorAll("input")).toHaveLength(100);
    expect(view.container.querySelectorAll("[data-row-key]")).toHaveLength(101);
    fireEvent(window, new Event("afterprint"));
    expect(view.container.querySelectorAll("input")).toHaveLength(0);
  });

  it("activates a pending row and transfers forward/reverse Tab focus to its native controls", () => {
    const model = buildListRows({ items });
    const view = render(
      <RetainedViewportListRenderer
        model={model}
        accessibleLabel="買い物リスト"
        renderRow={(row) =>
          row.kind === "item" ? (
            <div>
              <input aria-label={row.itemId + "-first"} />
              <button>{row.itemId + "-last"}</button>
            </div>
          ) : null
        }
      />,
    );
    const second = view.container.querySelector<HTMLElement>(
      "[data-viewport-focus-sentinel]",
    )!;
    fireEvent.focus(second);
    expect(view.getByRole("textbox", { name: "item-0-first" })).toHaveFocus();
    const next = view.container.querySelector<HTMLElement>(
      "[data-viewport-focus-sentinel]",
    )!;
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    fireEvent.focus(next);
    expect(view.getByRole("button", { name: "item-1-last" })).toHaveFocus();
  });

  it("disconnects observation on unmount and ignores queued entries for removed rows", () => {
    const view = render(
      <ViewportContent
        rowKey="removed"
        placeholder={<span>準備</span>}
        render={() => <input />}
      />,
    );
    const target = [...observed][0];
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    act(() =>
      callback(
        [{ target, isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    expect(observed.size).toBe(0);
  });

  it("keeps the same control when the defer threshold changes", () => {
    const view = render(
      <ViewportContent
        rowKey="same"
        defer={false}
        placeholder={null}
        render={() => <input defaultValue="編集内容" />}
      />,
    );
    const input = view.getByRole("textbox");
    input.focus();
    view.rerender(
      <ViewportContent
        rowKey="same"
        defer
        placeholder={null}
        render={() => <input defaultValue="編集内容" />}
      />,
    );
    expect(view.getByRole("textbox")).toBe(input);
    expect(input).toHaveFocus();
  });
});

describe("ShoppingList retained controls", () => {
  const renderList = (
    nextItems: ShoppingItem[],
    onMoveItem: React.ComponentProps<typeof ShoppingList>["onMoveItem"],
  ) => (
    <ShoppingList
      items={nextItems}
      onUpdateItem={vi.fn()}
      onMoveItem={onMoveItem}
      onEditRequest={vi.fn()}
      onDeleteRequest={vi.fn()}
      selectedItemIds={new Set()}
      onSelectItem={vi.fn()}
      skipLimitedPurchaseForSingleQuantity={false}
      layoutMode="pc"
      columnType="execute"
      listRendererPreferencePort={{
        read: () => ({ status: "ok", value: "auto" }),
        write: () => true,
      }}
    />
  );

  const readyViewport = () => {
    vi.stubGlobal("visualViewport", {
      scale: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    visibleKeys.add(buildListRows({ items }).rows[0].rowKey);
  };

  it("retains the PC card and its focus when a deletion crosses the threshold", () => {
    readyViewport();
    const view = render(renderList(items.slice(0, 33), vi.fn()));
    const root = view.container.firstElementChild;
    expect(root).toHaveAttribute(
      "data-list-renderer-strategy",
      "retained-viewport",
    );
    const control = view.container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    control.focus();
    view.rerender(renderList(items.slice(0, 31), vi.fn()));
    expect(view.container.firstElementChild).toBe(root);
    expect(root).toHaveAttribute("data-list-row-count", "31");
    expect(view.container.querySelector('input[type="checkbox"]')).toBe(
      control,
    );
    expect(control).toHaveFocus();
  });

  it("retains existing controls when additions first enable deferred rendering", () => {
    readyViewport();
    const onMoveItem = vi.fn();
    const view = render(renderList(items.slice(0, 31), onMoveItem));
    const root = view.container.firstElementChild;
    expect(root).toHaveAttribute("data-list-renderer", "full");
    const control = view.container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    control.focus();
    view.rerender(renderList(items.slice(0, 33), onMoveItem));
    expect(view.container.firstElementChild).toBe(root);
    expect(root).toHaveAttribute("data-list-renderer", "virtual");
    expect(view.container.querySelector('input[type="checkbox"]')).toBe(
      control,
    );
    expect(control).toHaveFocus();
  });

  it("keeps the PC drag source mounted and passes moves through the existing handler", () => {
    readyViewport();
    const onMoveItem = vi.fn();
    const view = render(renderList(items, onMoveItem));
    const root = view.container.firstElementChild;
    const source = view.container.querySelector<HTMLElement>(
      '[data-item-id="item-0"]',
    )!;
    fireEvent.dragStart(source, { dataTransfer: { setData: vi.fn() } });
    expect(view.container.firstElementChild).toBe(root);
    expect(root).toHaveAttribute(
      "data-list-renderer-strategy",
      "retained-viewport",
    );
    expect(source.isConnected).toBe(true);
    const pending = [
      ...view.container.querySelectorAll<HTMLElement>("[data-row-key]"),
    ].find(
      (row) => row.dataset.rowKey === buildListRows({ items }).rows[1].rowKey,
    )!;
    act(() => revealViewportContent(pending));
    const target = view.container.querySelector<HTMLElement>(
      '[data-item-id="item-1"]',
    )!;
    fireEvent.dragOver(target, {
      clientY: 5000,
      dataTransfer: { dropEffect: "" },
    });
    fireEvent.drop(target, { dataTransfer: { getData: () => "execute" } });
    expect(onMoveItem).toHaveBeenCalled();
    fireEvent.dragEnd(source);
    expect(source.isConnected).toBe(true);
  });
});

describe("retained viewport capability", () => {
  const ready = {
    runtimeAvailable: true,
    zoomPercent: 100,
    recoveryActive: false,
    rowCount: 100,
    minimumRowCount: 80,
    stableRowKeys: true,
    estimatedRowHeightPx: 136,
  };
  it("uses its independent normal-flow capability", () => {
    expect(evaluateRetainedViewportEligibility(ready).eligible).toBe(true);
  });
  it.each([
    [{ runtimeAvailable: false }, "runtime-unavailable"],
    [{ zoomPercent: null }, "zoom-unknown"],
    [{ zoomPercent: 0 }, "zoom-unsupported"],
    [{ recoveryActive: null }, "recovery-state-unknown"],
    [{ recoveryActive: true }, "recovery-active"],
    [{ stableRowKeys: false }, "row-keys-unstable"],
    [{ rowCount: 79 }, "list-too-short"],
    [{ rowCount: -1 }, "row-count-unknown"],
  ] as const)("fails closed for %j", (override, reason) => {
    expect(
      evaluateRetainedViewportEligibility({ ...ready, ...override }),
    ).toMatchObject({ eligible: false, reason });
  });
});

it("releases visited controls and options while retaining lightweight anchors", () => {
  const model = buildListRows({ items });
  const view = render(
    <RetainedViewportListRenderer
      model={model}
      accessibleLabel="買い物リスト"
      renderRow={(row) =>
        row.kind === "item" ? (
          <select aria-label={row.itemId}>
            <option>ユーザー登録</option>
            <option>エラーが発生しました</option>
          </select>
        ) : null
      }
    />,
  );
  const notify = (key: string, visible: boolean) => {
    const target = [
      ...view.container.querySelectorAll<HTMLElement>(
        "[data-viewport-row-key]",
      ),
    ].find((row) => row.dataset.viewportRowKey === key)!;
    act(() =>
      callback(
        [
          {
            target,
            isIntersecting: visible,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    );
  };
  for (const row of model.rows) {
    notify(row.rowKey, true);
    notify(row.rowKey, false);
  }
  expect(view.container.querySelectorAll("select, option")).toHaveLength(0);
  expect(view.container.querySelectorAll("[data-row-key]")).toHaveLength(100);
  notify(model.rows[99].rowKey, true);
  expect(view.container.querySelectorAll("option")).toHaveLength(2);
});
it("keeps a pinned offscreen target until its dialog closes", () => {
  const model = buildListRows({ items });
  const props = {
    model,
    accessibleLabel: "買い物リスト",
    renderRow: (row: (typeof model.rows)[number]) =>
      row.kind === "item" ? <input aria-label={row.itemId} /> : null,
  };
  const view = render(
    <RetainedViewportListRenderer
      {...props}
      pinnedRowKeys={new Set([model.rows[0].rowKey])}
    />,
  );
  expect(view.container.querySelectorAll("input")).toHaveLength(1);
  view.rerender(
    <RetainedViewportListRenderer {...props} pinnedRowKeys={new Set()} />,
  );
  expect(view.container.querySelectorAll("input")).toHaveLength(0);
});
it.each([75, 125, 150, 200])(
  "keeps the viewport capability at %i percent zoom",
  (zoomPercent) => {
    expect(
      evaluateRetainedViewportEligibility({
        runtimeAvailable: true,
        zoomPercent,
        recoveryActive: false,
        rowCount: 1500,
        minimumRowCount: 80,
        stableRowKeys: true,
        estimatedRowHeightPx: 136,
      }).eligible,
    ).toBe(true);
  },
);

it("renders only the changed execution group and uses the latest render closure", () => {
  const groupItems = [items[0], items[1]];
  const makeModel = (members: ShoppingItem[]) =>
    buildListRows({
      items: members,
      groups: members.map((item, index) => ({
        key: `space-${index}`,
        label: `Space ${index}`,
        items: [item],
      })),
    });
  const rendered = vi.fn();
  const renderGroups =
    (members: ShoppingItem[]) =>
    (
      row: { groupKey: string },
      children: readonly {
        row: { item: ShoppingItem };
        render(content: React.ReactNode): React.ReactElement;
      }[],
    ) => {
      rendered(row.groupKey);
      return (
        <div>
          {children.map((child) =>
            child.render(
              <span>
                {
                  members.find((item) => item.id === child.row.item.id)!
                    .purchaseStatus
                }
              </span>,
            ),
          )}
        </div>
      );
    };
  const view = render(
    <RetainedViewportListRenderer
      defer={false}
      model={makeModel(groupItems)}
      accessibleLabel="buy"
      renderDependencies={[]}
      renderGroup={renderGroups(groupItems)}
    />,
  );
  rendered.mockClear();
  shoppingPerformance.enable();
  shoppingPerformance.reset();
  const next = [
    { ...groupItems[0], purchaseStatus: "Purchased" as const },
    groupItems[1],
  ];
  view.rerender(
    <RetainedViewportListRenderer
      defer={false}
      model={makeModel(next)}
      accessibleLabel="buy"
      renderDependencies={[]}
      renderGroup={renderGroups(next)}
    />,
  );
  expect(shoppingPerformance.read().renders["execution-viewport"]).toBe(1);
  expect(rendered).toHaveBeenCalledTimes(1);
  expect(rendered).toHaveBeenCalledWith("space-0");
  expect(view.getByText("Purchased")).toBeVisible();
});

it("keeps overlapping prewarm requests until both navigation owners release them", () => {
  const view = render(
    <ViewportContent
      rowKey="overlapping-next"
      placeholder={<span>待機</span>}
      render={() => <input aria-label="次の訪問先" />}
    />,
  );
  const root = view.container.querySelector<HTMLElement>(
    "[data-viewport-row-key]",
  )!;
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  act(() => {
    releaseFirst = prewarmViewportContent(root);
    releaseSecond = prewarmViewportContent(root);
  });
  expect(view.getByRole("textbox")).toBeVisible();
  act(() => releaseFirst());
  expect(view.getByRole("textbox")).toBeVisible();
  act(() => releaseFirst());
  expect(view.getByRole("textbox")).toBeVisible();
  act(() => releaseSecond());
  expect(view.queryByRole("textbox")).toBeNull();
});

it("updates a collapsed space summary without rendering unrelated collapsed spaces", () => {
  const sources = [items[0], items[1]];
  const model = buildListRows({
    items: sources,
    groups: sources.map((item) => ({
      key: item.id,
      label: item.id,
      items: [item],
      collapsed: true,
    })),
  });
  const rendered = vi.fn();
  const props = (members: ShoppingItem[]) => ({
    model,
    defer: false,
    accessibleLabel: "購入状態",
    renderDependencies: [],
    getGroupVersion: (id: string) => members.find((item) => item.id === id),
    renderGroup: (row: { groupKey: string }) => {
      rendered(row.groupKey);
      return (
        <span>
          {members.find((item) => item.id === row.groupKey)!.purchaseStatus}
        </span>
      );
    },
  });
  const view = render(<RetainedViewportListRenderer {...props(sources)} />);
  rendered.mockClear();
  view.rerender(
    <RetainedViewportListRenderer
      {...props([{ ...sources[0], purchaseStatus: "Purchased" }, sources[1]])}
    />,
  );
  expect(rendered).toHaveBeenCalledOnce();
  expect(rendered).toHaveBeenCalledWith(sources[0].id);
  expect(view.getByText("Purchased")).toBeVisible();
});

it("reveals the committed group after a concurrent render is discarded", () => {
  const blocked = new Promise<void>(() => {});
  const Suspend = ({ value }: { value: string }) => {
    if (value === "discarded") throw blocked;
    return null;
  };
  let discard!: () => void;
  const Harness = () => {
    const [value, setValue] = React.useState("committed");
    discard = () => React.startTransition(() => setValue("discarded"));
    const member = { ...items[0], remarks: value };
    return (
      <React.Suspense fallback={<span>ロード中</span>}>
        <RetainedViewportListRenderer
          model={buildListRows({
            items: [member],
            groups: [{ key: "group", label: "訪問先", items: [member] }],
          })}
          accessibleLabel="購入状態"
          renderDependencies={[value]}
          renderGroup={() => <span>{value}</span>}
        />
        <Suspend value={value} />
      </React.Suspense>
    );
  };
  const view = render(<Harness />);
  act(() => discard());
  act(() =>
    callback(
      [...observed].map((target) => ({
        target,
        isIntersecting: true,
      })) as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    ),
  );
  expect(view.getByText("committed", { exact: true })).toBeVisible();
  expect(view.queryByText("discarded", { exact: true })).toBeNull();
});

it("propagates dialog retention through a memoized group and releases the row after closing", () => {
  const model = buildListRows({
    items,
    groups: [{ key: "A1", label: "A1", items }],
  });
  const rowKey = model.itemRows[0].rowKey;
  visibleKeys.add(model.rows[0].rowKey);
  visibleKeys.add(rowKey);
  const renderGroup = (
    _group: unknown,
    rows: readonly {
      row: { itemId: string };
      render(content: React.ReactNode): React.ReactElement;
    }[],
  ) => (
    <section>
      {rows.map((row) =>
        row.render(
          <input aria-label={row.row.itemId} defaultValue="保持する入力" />,
        ),
      )}
    </section>
  );
  const dependencies: readonly unknown[] = [];
  const props = {
    model,
    accessibleLabel: "買い物リスト",
    renderGroup,
    renderDependencies: dependencies,
  };
  const view = render(<RetainedViewportListRenderer {...props} />);
  const input = view.getByRole("textbox", { name: "item-0" });
  view.rerender(
    <RetainedViewportListRenderer
      {...props}
      pinnedRowKeys={new Set([rowKey])}
    />,
  );
  visibleKeys.clear();
  const leaveViewport = () =>
    act(() =>
      callback(
        [...observed].map((target) => ({
          target,
          isIntersecting: false,
        })) as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
  leaveViewport();
  expect(view.getByRole("textbox", { name: "item-0" })).toBe(input);
  expect(input).toHaveValue("保持する入力");
  view.rerender(
    <RetainedViewportListRenderer {...props} pinnedRowKeys={new Set()} />,
  );
  leaveViewport();
  expect(view.queryByRole("textbox", { name: "item-0" })).toBeNull();
});

it.each([500, 1500])(
  "bounds synchronous initial position measurements for %i rows",
  (count) => {
    const many = Array.from({ length: count }, (_, index) => ({
      ...items[0],
      id: `bounded-${index}`,
    }));
    const model = buildListRows({ items: many });
    visibleKeys.add(model.rows[0].rowKey);
    const measure = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    measure.mockClear();
    const view = render(
      <RetainedViewportListRenderer
        model={model}
        accessibleLabel="計測範囲"
        renderRow={(row) => (row.kind === "item" ? <input /> : null)}
      />,
    );
    const rowMeasurements = measure.mock.instances.filter(
      (element) => !!(element as HTMLElement).dataset.viewportRowKey,
    );
    expect(rowMeasurements.length).toBeLessThan(20);
    expect(view.container.querySelectorAll("input")).toHaveLength(1);
  },
  15000,
);

it.each([false, true])(
  "activates a newly inserted visible %s-grouped row before an observer notification",
  async (grouped) => {
    const initial = items.slice(0, 100);
    const inserted = { ...items[0], id: "inserted-visible" };
    const model = (members: ShoppingItem[]) =>
      buildListRows({
        items: members,
        ...(grouped
          ? {
              groups: [
                { key: "existing-parent", label: "会場", items: members },
              ],
            }
          : {}),
      });
    const initialModel = model(initial);
    visibleKeys.add(initialModel.rows[0].rowKey);
    visibleKeys.add(initialModel.itemRows[0].rowKey);
    const input = (row: { itemId: string }) => (
      <input aria-label={row.itemId} defaultValue="保持する入力" />
    );
    const content = (members: ShoppingItem[]) => (
      <RetainedViewportListRenderer
        model={model(members)}
        accessibleLabel="新規行の表示"
        {...(grouped
          ? {
              renderGroup: (
                _row: unknown,
                rows: readonly {
                  row: { itemId: string };
                  render(content: React.ReactNode): React.ReactElement;
                }[],
              ) => (
                <section>
                  {rows.map((row) => row.render(input(row.row)))}
                </section>
              ),
            }
          : {
              renderRow: (row: { kind: string; itemId?: string }) =>
                row.kind === "item" ? input({ itemId: row.itemId! }) : null,
            })}
      />
    );
    const view = render(content(initial));
    const existing = view.getByRole("textbox", { name: "item-0" });
    existing.focus();
    fireEvent.change(existing, { target: { value: "編集中の入力" } });
    await act(async () => {
      await Promise.resolve();
    });
    visibleKeys.add(model([inserted]).itemRows[0].rowKey);

    // No IntersectionObserver callback is delivered between insertion and this assertion.
    view.rerender(content([inserted, ...initial]));
    expect(view.getByRole("textbox", { name: inserted.id })).toBeVisible();
    expect(view.getByRole("textbox", { name: "item-0" })).toBe(existing);
    expect(existing).toHaveValue("編集中の入力");
    expect(existing).toHaveFocus();
  },
);

it.each([false, true])(
  "keeps a newly inserted offscreen %s-grouped row deferred",
  async (grouped) => {
    const inserted = { ...items[0], id: "inserted-offscreen" };
    const content = (members: ShoppingItem[]) => {
      const model = buildListRows({
        items: members,
        ...(grouped
          ? {
              groups: [
                { key: "existing-parent", label: "会場", items: members },
              ],
            }
          : {}),
      });
      visibleKeys.add(model.rows[0].rowKey);
      visibleKeys.add(model.itemRows[0].rowKey);
      return (
        <RetainedViewportListRenderer
          model={model}
          accessibleLabel="画面外の新規行"
          {...(grouped
            ? {
                renderGroup: (
                  _row: unknown,
                  rows: readonly {
                    row: { itemId: string };
                    render(content: React.ReactNode): React.ReactElement;
                  }[],
                ) => (
                  <section>
                    {rows.map((row) =>
                      row.render(<input aria-label={row.row.itemId} />),
                    )}
                  </section>
                ),
              }
            : {
                renderRow: (row: { kind: string; itemId?: string }) =>
                  row.kind === "item" ? (
                    <input aria-label={row.itemId} />
                  ) : null,
              })}
        />
      );
    };
    const view = render(content(items));
    await act(async () => {
      await Promise.resolve();
    });
    view.rerender(content([...items, inserted]));
    expect(view.queryByRole("textbox", { name: inserted.id })).toBeNull();
    expect(view.container.querySelectorAll("input")).toHaveLength(1);
  },
);

it("does not remeasure existing row visibility for an ordinary item update", async () => {
  const model = (members: ShoppingItem[]) => buildListRows({ items: members });
  visibleKeys.add(model(items).itemRows[0].rowKey);
  const content = (members: ShoppingItem[]) => (
    <RetainedViewportListRenderer
      model={model(members)}
      accessibleLabel="通常更新"
      renderRow={(row) =>
        row.kind === "item" ? (
          <input
            aria-label={row.itemId}
            value={row.item.purchaseStatus}
            readOnly
          />
        ) : null
      }
    />
  );
  const view = render(content(items));
  await act(async () => {
    await Promise.resolve();
  });
  const measure = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
  measure.mockClear();
  view.rerender(
    content([{ ...items[0], purchaseStatus: "Purchased" }, ...items.slice(1)]),
  );
  expect(view.getByRole("textbox", { name: "item-0" })).toHaveValue(
    "Purchased",
  );
  expect(
    measure.mock.instances.filter(
      (element) => !!(element as HTMLElement).dataset.viewportRowKey,
    ),
  ).toHaveLength(0);
});

it.each([500, 1500])(
  "bounds new row visibility measurements when replacing all %i IDs in the same parent",
  async (count) => {
    const many = Array.from({ length: count }, (_, index) => ({
      ...items[0],
      id: `replace-before-${index}`,
    }));
    const replacement = many.map((item, index) => ({
      ...item,
      id: `replace-after-${index}`,
    }));
    const content = (members: ShoppingItem[]) => (
      <>
        <ViewportContent
          rowKey="keep-registry-alive"
          defer={false}
          placeholder={null}
          render={() => <span>別のリスト</span>}
        />
        <RetainedViewportListRenderer
          model={buildListRows({ items: members })}
          accessibleLabel="日付変更の全件置換"
          renderRow={(row) =>
            row.kind === "item" ? <input aria-label={row.itemId} /> : null
          }
        />
      </>
    );
    visibleKeys.add(buildListRows({ items: many }).itemRows[0].rowKey);
    const view = render(content(many));
    await act(async () => {
      await Promise.resolve();
    });
    visibleKeys.add(buildListRows({ items: replacement }).itemRows[0].rowKey);
    const measure = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    measure.mockClear();
    view.rerender(content(replacement));
    const rowMeasurements = measure.mock.instances.filter(
      (element) => !!(element as HTMLElement).dataset.viewportRowKey,
    );
    expect(rowMeasurements.length).toBeLessThan(20);
    expect(view.container.querySelectorAll("input")).toHaveLength(1);
    expect(
      view.getByRole("textbox", { name: replacement[0].id }),
    ).toBeVisible();
  },
  15000,
);

it("keeps an appended offscreen row deferred after the original parent anchor is removed", async () => {
  const inserted = { ...items[0], id: "after-removed-anchor" };
  const content = (members: ShoppingItem[]) => (
    <RetainedViewportListRenderer
      model={buildListRows({ items: members })}
      accessibleLabel="先頭削除後の追加"
      renderRow={(row) =>
        row.kind === "item" ? <input aria-label={row.itemId} /> : null
      }
    />
  );
  visibleKeys.add(buildListRows({ items }).itemRows[0].rowKey);
  const view = render(content(items));
  await act(async () => {
    await Promise.resolve();
  });
  view.rerender(content([...items.slice(1), inserted]));
  expect(view.queryByRole("textbox", { name: inserted.id })).toBeNull();
  const pending = [
    ...view.container.querySelectorAll<HTMLElement>("[data-viewport-row-key]"),
  ].find(
    (element) =>
      element.dataset.viewportRowKey ===
      buildListRows({ items: [inserted] }).itemRows[0].rowKey,
  );
  expect(pending).toHaveAttribute("data-viewport-active", "false");
});
