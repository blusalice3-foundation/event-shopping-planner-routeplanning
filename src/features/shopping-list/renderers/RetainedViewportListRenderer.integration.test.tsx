import React from "react";
import { shoppingPerformance } from "../../../utils/shoppingPerformance";
import ShoppingList from "../../../components/ShoppingList";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildListRows } from "../model/buildListRows";
import type { ShoppingItem } from "../../../types/item";
import { getSpaceKey } from "../../../utils/spaceGrouping";
import { RetainedViewportListRenderer } from "./RetainedViewportListRenderer";
import { useCardExpansion } from "./ViewportRowState";
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

const fixedSlotModes = [undefined, "current-model"] as const;

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

  it("does not scan offscreen descendants when no rows are requested", () => {
    const view = render(
      <ViewportContent
        rowKey="empty-requested-keys"
        placeholder={<span>pending</span>}
        render={() => <input aria-label="非表示の入力" />}
      />,
    );
    const root = view.container.firstElementChild as HTMLElement;
    const queryAll = vi.spyOn(root, "querySelectorAll");
    fireEvent(root, new Event(VIEWPORT_RETENTION_EVENT, { bubbles: true }));
    expect(queryAll).not.toHaveBeenCalled();
    expect(root).toHaveAttribute("data-viewport-active", "false");
    expect(view.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps an offscreen ancestor active for a requested descendant until release", () => {
    const view = render(
      <ViewportContent
        rowKey="requested-descendant-parent"
        placeholder={
          <span data-viewport-row-key="requested-descendant-child">
            pending
          </span>
        }
        render={() => (
          <input
            data-viewport-row-key="requested-descendant-child"
            aria-label="要求された子の入力"
          />
        )}
      />,
    );
    const root = view.container.firstElementChild as HTMLElement;
    const requestTarget = document.createElement("span");
    requestTarget.dataset.viewportRowKey = "requested-descendant-child";
    const queryAll = vi.spyOn(root, "querySelectorAll");
    let release!: () => void;
    act(() => {
      release = prewarmViewportContent(requestTarget);
      fireEvent(root, new Event(VIEWPORT_RETENTION_EVENT, { bubbles: true }));
    });
    const input = view.getByRole("textbox", { name: "要求された子の入力" });
    expect(queryAll).toHaveBeenCalledWith("[data-viewport-row-key]");
    fireEvent(root, new Event(VIEWPORT_RETENTION_EVENT, { bubbles: true }));
    expect(root).toHaveAttribute("data-viewport-active", "true");
    expect(view.getByRole("textbox", { name: "要求された子の入力" })).toBe(
      input,
    );
    queryAll.mockClear();
    act(() => {
      release();
      fireEvent(root, new Event(VIEWPORT_RETENTION_EVENT, { bubbles: true }));
    });
    expect(root).toHaveAttribute("data-viewport-active", "false");
    expect(input).not.toBeInTheDocument();
    expect(queryAll).not.toHaveBeenCalled();
  });
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

  it("measures and retains activated row heights without ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    visibleKeys.add("fallback-height-cache");
    const offsetHeight = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(184);
    const view = render(
      <div data-viewport-list>
        <ViewportContent
          rowKey="fallback-height-cache"
          defer
          placeholder={<span>準備中</span>}
          render={() => <input aria-label="高さを保持する入力" />}
        />
      </div>,
    );
    const root = view.container.querySelector<HTMLElement>(
      "[data-viewport-row-key]",
    )!;
    const intersect = (isIntersecting: boolean) =>
      act(() =>
        callback(
          [
            {
              target: root,
              isIntersecting,
              boundingClientRect: new DOMRect(0, 0, 400, 184),
              intersectionRect: isIntersecting
                ? new DOMRect(0, 0, 400, 184)
                : new DOMRect(),
              intersectionRatio: Number(isIntersecting),
              rootBounds: null,
              time: 0,
            },
          ],
          {} as IntersectionObserver,
        ),
      );

    expect(offsetHeight).toHaveBeenCalledTimes(1);
    intersect(false);
    expect(root).toHaveAttribute("data-layout-height", "184px");
    expect(view.queryByRole("textbox")).not.toBeInTheDocument();

    offsetHeight.mockReturnValue(196);
    intersect(true);
    expect(view.getByRole("textbox")).toBeInTheDocument();
    expect(offsetHeight).toHaveBeenCalledTimes(2);
    intersect(false);
    expect(root).toHaveAttribute("data-layout-height", "196px");
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
    const offsetHeight = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get");
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
    expect(offsetHeight).not.toHaveBeenCalled();
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

  it.each(fixedSlotModes)(
    "reveals an offscreen grouped target and its ancestor before navigation (%s)",
    (groupSlotMode) => {
      const model = buildListRows({
        items,
        groups: [{ key: "A1", label: "A1", items }],
      });
      const view = render(
        <RetainedViewportListRenderer
          groupSlotMode={groupSlotMode}
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
      expect(view.container.querySelectorAll("[data-row-key]")).toHaveLength(
        101,
      );
      expect(view.container.querySelectorAll("input")).toHaveLength(1);
    },
  );

  it.each(fixedSlotModes)(
    "keeps collapsed group navigation anchors without creating hidden item controls (%s)",
    (groupSlotMode) => {
      const model = buildListRows({
        items,
        groups: [{ key: "A1", label: "A1", items, collapsed: true }],
      });
      const view = render(
        <RetainedViewportListRenderer
          groupSlotMode={groupSlotMode}
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
      expect(
        view.getByRole("button", { name: "展開する" }),
      ).toBeInTheDocument();
    },
  );

  it.each(fixedSlotModes)(
    "activates every item, including deferred children of groups, before printing (%s)",
    (groupSlotMode) => {
      const model = buildListRows({
        items,
        groups: [{ key: "A1", label: "A1", items }],
      });
      const view = render(
        <RetainedViewportListRenderer
          groupSlotMode={groupSlotMode}
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
      expect(view.container.querySelectorAll("[data-row-key]")).toHaveLength(
        101,
      );
      fireEvent(window, new Event("afterprint"));
      expect(view.container.querySelectorAll("input")).toHaveLength(0);
    },
  );

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

it.each(fixedSlotModes)(
  "renders only the changed execution group and uses the latest render closure (%s)",
  (groupSlotMode) => {
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
        groupSlotMode={groupSlotMode}
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
        groupSlotMode={groupSlotMode}
        defer={false}
        model={makeModel(next)}
        accessibleLabel="buy"
        renderDependencies={[]}
        renderGroup={renderGroups(next)}
      />,
    );
    expect(shoppingPerformance.read().renders["execution-viewport"] ?? 0).toBe(
      groupSlotMode ? 0 : 1,
    );
    expect(rendered).toHaveBeenCalledTimes(1);
    expect(rendered).toHaveBeenCalledWith("space-0");
    expect(view.getByText("Purchased")).toBeVisible();
  },
);

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

it.each(fixedSlotModes)(
  "updates a collapsed space summary without rendering unrelated collapsed spaces (%s)",
  (groupSlotMode) => {
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
    const view = render(
      <RetainedViewportListRenderer
        groupSlotMode={groupSlotMode}
        {...props(sources)}
      />,
    );
    rendered.mockClear();
    view.rerender(
      <RetainedViewportListRenderer
        groupSlotMode={groupSlotMode}
        {...props([{ ...sources[0], purchaseStatus: "Purchased" }, sources[1]])}
      />,
    );
    expect(rendered).toHaveBeenCalledOnce();
    expect(rendered).toHaveBeenCalledWith(sources[0].id);
    expect(view.getByText("Purchased")).toBeVisible();
  },
);

it.each(fixedSlotModes)(
  "reveals the committed group after a concurrent render is discarded (%s)",
  (groupSlotMode) => {
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
            groupSlotMode={groupSlotMode}
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
    expect(view.container).toHaveTextContent("committed");
    expect(view.container).not.toHaveTextContent("discarded");
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
  },
);

it.each(fixedSlotModes)(
  "propagates dialog retention through a memoized group and releases the row after closing (%s)",
  (groupSlotMode) => {
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
    const view = render(
      <RetainedViewportListRenderer groupSlotMode={groupSlotMode} {...props} />,
    );
    const input = view.getByRole("textbox", { name: "item-0" });
    view.rerender(
      <RetainedViewportListRenderer
        groupSlotMode={groupSlotMode}
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
      <RetainedViewportListRenderer
        groupSlotMode={groupSlotMode}
        {...props}
        pinnedRowKeys={new Set()}
      />,
    );
    leaveViewport();
    expect(view.queryByRole("textbox", { name: "item-0" })).toBeNull();
  },
);

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

it("keeps all 500 placeholder attributes equivalent and updates only the changed metadata consumer", () => {
  const members = Array.from({ length: 500 }, (_, index) => ({
    ...items[0],
    id: `slot-${index}`,
    number: String(index),
  }));
  const content = (
    groupSlotMode: (typeof fixedSlotModes)[number],
    source: ShoppingItem[],
  ) => (
    <RetainedViewportListRenderer
      groupSlotMode={groupSlotMode}
      model={buildListRows({
        items: source,
        groups: source.map((item) => ({
          key: item.id,
          label: item.circle,
          items: [item],
        })),
      })}
      accessibleLabel="全件同値"
      getVisitId={(item) => `visit-${item.id}`}
      renderDependencies={[]}
      renderGroup={(_group, rows) => (
        <>{rows.map((child) => child.render(<input />))}</>
      )}
    />
  );
  const reference = render(content(undefined, members));
  const view = render(content("current-model", members));
  expect(view.container.innerHTML).toBe(reference.container.innerHTML);
  const next = [
    { ...members[0], quantity: 7, remarks: "ユーザー登録・更新" },
    ...members.slice(1),
  ];
  shoppingPerformance.enable();
  shoppingPerformance.reset();
  const readContext = vi.spyOn(React, "useContext");
  view.rerender(content("current-model", next));
  // No active body exists: only this group's metadata consumer may run.
  expect(readContext).toHaveBeenCalledTimes(1);
  expect(shoppingPerformance.read().renders["execution-viewport"] ?? 0).toBe(0);
  readContext.mockRestore();
  reference.rerender(content(undefined, next));
  expect(view.container.innerHTML).toBe(reference.container.innerHTML);
  const inserted = { ...members[0], id: "inserted-slot" };
  for (const reordered of [
    [inserted, ...next.slice().reverse()],
    next.slice(1),
  ]) {
    reference.rerender(content(undefined, reordered));
    view.rerender(content("current-model", reordered));
    expect(view.container.innerHTML).toBe(reference.container.innerHTML);
    const rows = [
      ...view.container.querySelectorAll<HTMLElement>("[aria-posinset]"),
    ];
    expect(rows).toHaveLength(reordered.length);
    rows.forEach((row, index) => {
      expect(row).toHaveAttribute("aria-posinset", String(index + 1));
      expect(row).toHaveAttribute("aria-setsize", String(reordered.length));
    });
  }
}, 15_000);

describe.each(fixedSlotModes)(
  "fixed group slot strategy %s",
  (groupSlotMode) => {
    it("keeps every native option mounted when IntersectionObserver is unavailable", () => {
      vi.stubGlobal("IntersectionObserver", undefined);
      const members = items.slice(0, 3);
      const view = render(
        <RetainedViewportListRenderer
          groupSlotMode={groupSlotMode}
          model={buildListRows({
            items: members,
            groups: [{ key: "all", label: "全件", items: members }],
          })}
          accessibleLabel="通常の全件表示"
          renderGroup={(_group, rows) => (
            <>
              {rows.map((child) =>
                child.render(
                  <select aria-label={child.row.itemId} defaultValue="1">
                    <option value="1">ユーザー登録</option>
                    <option value="2">エラーが発生しました</option>
                  </select>,
                ),
              )}
            </>
          )}
        />,
      );
      expect(view.container.querySelectorAll("select")).toHaveLength(3);
      expect(view.container.querySelectorAll("option")).toHaveLength(6);
      expect(view.container.querySelectorAll("[data-row-key]")).toHaveLength(4);
    });

    it("keeps hall boundaries, section totals, raw stripes, and canonical callback indices current", () => {
      const clicked = vi.fn();
      const sources = items.slice(0, 4);
      type Group = {
        key: string;
        label: string;
        hall: string;
        items: ShoppingItem[];
      };
      const groupsFor = (order: ShoppingItem[]) =>
        order.map((item) => ({
          key: item.id,
          label: item.id,
          hall: item === sources[0] || item === sources[1] ? "H1" : "H2",
          items: [item],
        }));
      const content = (
        raw: ShoppingItem[],
        groups: Group[],
        marker: string,
      ) => (
        <RetainedViewportListRenderer
          groupSlotMode={groupSlotMode}
          defer={false}
          model={buildListRows({ items: raw, groups })}
          accessibleLabel="境界と位置"
          renderDependencies={[]}
          getGroupVersion={(key) => groups.find((group) => group.key === key)}
          renderGroup={(row, children, index) => {
            const position = groups.findIndex(
              (group) => group.key === row.groupKey,
            );
            const group = groups[position];
            let count = 0;
            for (
              let cursor = position;
              groups[cursor]?.hall === group.hall;
              cursor++
            )
              count += groups[cursor].items.length;
            return (
              <section data-testid={row.groupKey} data-model-index={index}>
                <header>
                  {groups[position - 1]?.hall !== group.hall
                    ? `${group.hall}:${count}`
                    : ""}
                </header>
                {children.map((child) =>
                  child.render(
                    <button
                      data-testid={`card-${child.row.itemId}`}
                      data-striped={raw.indexOf(child.row.item) % 2 !== 0}
                      data-can-move-up={raw.indexOf(child.row.item) > 0}
                      data-canonical-index={child.index}
                      onClick={() => clicked(marker)}
                    >
                      {child.row.item.title}
                    </button>,
                  ),
                )}
              </section>
            );
          }}
        />
      );
      const view = render(content(sources, groupsFor(sources), "first"));
      const header = (item: ShoppingItem) =>
        view.getByTestId(item.id).querySelector("header")!.textContent;
      expect(header(sources[1])).toBe("");
      view.rerender(
        content(
          sources,
          groupsFor([sources[2], sources[1], sources[0], sources[3]]),
          "boundary",
        ),
      );
      // B's own index/membership/ARIA size are unchanged; its previous hall changed.
      expect(header(sources[1])).toBe("H1:2");
      view.rerender(
        content(
          sources,
          groupsFor([sources[1], sources[0], sources[2], sources[3]]),
          "section",
        ),
      );
      expect(header(sources[1])).toBe("H1:2");
      view.rerender(
        content(
          sources,
          groupsFor([sources[1], sources[2], sources[0], sources[3]]),
          "short-section",
        ),
      );
      expect(header(sources[1])).toBe("H1:1");
      const raw = [sources[0], sources[2], sources[1], sources[3]];
      const grouped: Group[] = [
        {
          key: "merged",
          label: "同一訪問",
          hall: "H1",
          items: [sources[0], sources[1]],
        },
        {
          key: sources[2].id,
          label: sources[2].id,
          hall: "H2",
          items: [sources[2]],
        },
        {
          key: sources[3].id,
          label: sources[3].id,
          hall: "H2",
          items: [sources[3]],
        },
      ];
      view.rerender(content(raw, grouped, "raw-before"));
      expect(view.getByTestId(`card-${sources[2].id}`)).toHaveAttribute(
        "data-striped",
        "true",
      );
      const nextRaw = [sources[0], sources[1], sources[2], sources[3]];
      view.rerender(
        content(
          nextRaw,
          grouped.map((group) => ({ ...group })),
          "raw-after",
        ),
      );
      const moved = view.getByTestId(`card-${sources[2].id}`);
      expect(moved).toHaveAttribute("data-striped", "false");
      expect(moved).toHaveAttribute("data-can-move-up", "true");
      expect(moved).toHaveAttribute("data-canonical-index", "4");
      expect(view.getByTestId(sources[2].id)).toHaveAttribute(
        "data-model-index",
        "3",
      );
      fireEvent.click(moved);
      expect(clicked).toHaveBeenLastCalledWith("raw-after");
    });

    it("reveals optional content and focuses the latest handler after an inactive update", () => {
      const used = vi.fn();
      const content = (url: string, marker: string) => {
        const member = { ...items[0], url };
        return (
          <RetainedViewportListRenderer
            groupSlotMode={groupSlotMode}
            model={buildListRows({
              items: [member],
              groups: [{ key: "pending", label: "待機", items: [member] }],
            })}
            accessibleLabel="最新の本文"
            renderDependencies={[marker]}
            getVisitId={() => "optional-target"}
            renderGroup={(_group, rows) => (
              <>
                {rows.map((child) =>
                  child.render(
                    <input
                      aria-label="URL"
                      value={child.row.item.url}
                      readOnly
                      onFocus={() => used(marker)}
                    />,
                  ),
                )}
              </>
            )}
          />
        );
      };
      const view = render(content("https://example.com/old", "old"));
      expect(view.queryByRole("textbox")).toBeNull();
      view.rerender(content("https://example.com/current", "current"));
      const pending = view.container.querySelector<HTMLElement>(
        '[data-space-navigation-anchor="item"][data-space-navigation-visit-id="optional-target"]',
      )!;
      act(() => pending.focus());
      expect(view.getByRole("textbox", { name: "URL" })).toHaveValue(
        "https://example.com/current",
      );
      expect(view.getByRole("textbox", { name: "URL" })).toHaveFocus();
      expect(used).toHaveBeenLastCalledWith("current");
    });

    it("preserves the root and list state through hall/space key collisions, layout, flat and empty transitions", () => {
      const scroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
      const PersistentRow = ({ item }: { item: ShoppingItem }) => {
        const [expanded, setExpanded] = useCardExpansion(item.id);
        return (
          <div>
            <button
              aria-label={`expand-${item.id}`}
              aria-expanded={expanded.has("title")}
              onClick={() => setExpanded(new Set(["title"]))}
            >
              展開
            </button>
            <input aria-label={item.id} defaultValue={item.circle} />
          </div>
        );
      };
      const content = (
        grouping: "space" | "hall" | "flat" | "empty",
        layoutMode: "pc" | "smartphone" = "pc",
        defer = false,
      ) => {
        const members = grouping === "empty" ? [] : items.slice(0, 2);
        const common = {
          groupSlotMode,
          layoutMode,
          defer,
          zoomPercent: layoutMode === "pc" ? 100 : 150,
          accessibleLabel: "保持するリスト",
          beforeContent: <input aria-label="リスト入力" defaultValue="保持" />,
          pinnedRowKeys: new Set(
            buildListRows({ items: members }).itemRows.map((row) => row.rowKey),
          ),
        };
        const grouped = grouping === "space" || grouping === "hall";
        return grouped ? (
          <RetainedViewportListRenderer
            {...common}
            model={buildListRows({
              items: members,
              groups: [{ key: "shared-key", label: grouping, items: members }],
            })}
            renderDependencies={[grouping]}
            renderGroup={(_group, rows) => (
              <section>
                {rows.map((child) =>
                  child.render(<PersistentRow item={child.row.item} />),
                )}
              </section>
            )}
          />
        ) : (
          <RetainedViewportListRenderer
            {...common}
            model={buildListRows({ items: members })}
            renderRow={(row) =>
              row.kind === "item" ? <PersistentRow item={row.item} /> : null
            }
          />
        );
      };
      const view = render(content("space"));
      const root = view.container.firstElementChild;
      const input = view.getByRole("textbox", { name: "item-0" });
      fireEvent.click(view.getByRole("button", { name: "expand-item-0" }));
      fireEvent.change(input, { target: { value: "編集中" } });
      input.focus();
      for (const next of [
        content("hall"),
        content("space", "smartphone", true),
        content("hall", "pc", true),
      ]) {
        view.rerender(next);
        expect(view.container.firstElementChild).toBe(root);
        expect(view.getByRole("textbox", { name: "item-0" })).toBe(input);
        expect(input).toHaveFocus();
        expect(input).toHaveValue("編集中");
        expect(
          view.getByRole("button", { name: "expand-item-0" }),
        ).toHaveAttribute("aria-expanded", "true");
      }
      expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
      const listInput = view.getByRole("textbox", { name: "リスト入力" });
      listInput.focus();
      view.rerender(content("flat"));
      expect(
        view.getByRole("button", { name: "expand-item-0" }),
      ).toHaveAttribute("aria-expanded", "true");
      view.rerender(content("empty"));
      expect(view.container.firstElementChild).toBe(root);
      expect(view.getByRole("textbox", { name: "リスト入力" })).toBe(listInput);
      expect(listInput).toHaveFocus();
      expect(view.queryByRole("button", { name: "expand-item-0" })).toBeNull();
      view.rerender(content("space"));
      // Deleting an item clears its retained state, as on the generic path.
      expect(
        view.getByRole("button", { name: "expand-item-0" }),
      ).toHaveAttribute("aria-expanded", "false");
    });
  },
);

it("keeps the actual ShoppingList retained strategy, root and row state through all grouping branches", async () => {
  vi.stubGlobal("visualViewport", {
    scale: 1,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
  const sharedKey = getSpaceKey("A", "01a");
  const hallDefinitions = [
    {
      id: sharedKey,
      name: "同一keyのホール",
      vertices: [],
      blockNames: ["A", "B"],
    },
  ];
  const initial: ShoppingItem[] = [
    {
      ...items[0],
      number: "01a",
      title: "省略される新刊タイトル".repeat(8),
      manualHallId: sharedKey,
    },
    { ...items[1], block: "B", number: "02a", manualHallId: sharedKey },
  ];
  const latest = [
    { ...initial[0], url: "https://example.com/current" },
    initial[1],
  ];
  const oldEdit = vi.fn();
  const currentEdit = vi.fn();
  const common = {
    onUpdateItem: vi.fn(),
    onMoveItem: vi.fn(),
    onDeleteRequest: vi.fn(),
    onSelectItem: vi.fn(),
    selectedItemIds: new Set<string>(),
    layoutMode: "pc" as const,
    viewMode: "edit" as const,
    columnType: "execute" as const,
    skipLimitedPurchaseForSingleQuantity: false,
    listRendererPreferencePort: {
      read: () => ({ status: "ok" as const, value: "auto" as const }),
      write: () => true,
    },
  };
  const content = (
    grouping: "empty" | "space" | "hall" | "flat",
    members = latest,
    onEditRequest = currentEdit,
  ) => (
    <ShoppingList
      {...common}
      items={grouping === "empty" ? [] : members}
      hallDefinitions={hallDefinitions}
      showSpaceGroups={grouping === "space"}
      showHallGroups={grouping === "hall"}
      onEditRequest={onEditRequest}
    />
  );
  const view = render(content("empty"));
  const root = view.container.firstElementChild as HTMLElement;
  const assertRoot = () => {
    expect(view.container.firstElementChild).toBe(root);
    expect(root).toHaveAttribute(
      "data-list-renderer-strategy",
      "retained-viewport",
    );
  };
  assertRoot();
  view.rerender(content("space", initial, oldEdit));
  assertRoot();
  expect(root.querySelectorAll("[data-space-group-key]")).toHaveLength(2);
  const groupGate = [
    ...root.querySelectorAll<HTMLElement>("[data-viewport-row-key]"),
  ].find(
    (row) =>
      row.dataset.viewportRowKey === `group:${JSON.stringify(sharedKey)}`,
  )!;
  expect(groupGate).toBeInTheDocument();
  const title = () => view.getByTitle(initial[0].title);
  await waitFor(() => expect(title()).toHaveClass("border-dashed"));
  fireEvent.click(title());
  expect(title()).toHaveAttribute("aria-expanded", "true");
  const card = () =>
    root.querySelector<HTMLElement>('[data-item-id="item-0"]')!;
  const memo = card().querySelector<HTMLElement>('[aria-label="利用者メモ"]')!;
  act(() => memo.focus());
  shoppingPerformance.enable();
  shoppingPerformance.reset();
  view.rerender(content("space"));
  expect(shoppingPerformance.read().renders["execution-viewport"] ?? 0).toBe(0);
  expect(card().querySelector('[aria-label="利用者メモ"]')).toBe(memo);
  expect(memo).toHaveFocus();
  expect(card().querySelector('[aria-label="URLを開く"]')).toHaveAttribute(
    "href",
    latest[0].url,
  );
  const frame = title().closest<HTMLElement>("[data-viewport-retain]")!;
  fireEvent.pointerDown(frame);
  const edit = await view.findByRole("button", { name: "編集" });
  fireEvent.pointerUp(frame);
  fireEvent.click(edit);
  expect(currentEdit).toHaveBeenLastCalledWith(latest[0]);
  expect(oldEdit).not.toHaveBeenCalled();
  // Real hall/space bodies have different child structures. Retain their shared
  // Gate and list state; do not invent an input-DOM guarantee that generic lacks.
  root.tabIndex = 0;
  act(() => root.focus());
  for (const grouping of ["hall", "space", "flat"] as const) {
    view.rerender(content(grouping));
    assertRoot();
    expect(root).toHaveFocus();
    expect(title()).toHaveAttribute("aria-expanded", "true");
    if (grouping !== "flat") expect(groupGate).toBeInTheDocument();
    const rows = [...root.querySelectorAll<HTMLElement>("[aria-posinset]")];
    expect(rows).toHaveLength(2);
    rows.forEach((row, index) => {
      expect(row).toHaveAttribute("aria-posinset", String(index + 1));
      expect(row).toHaveAttribute("aria-setsize", "2");
    });
  }
  view.rerender(content("empty"));
  assertRoot();
  expect(root).toHaveFocus();
  expect(root.querySelectorAll("[aria-posinset]")).toHaveLength(0);
  view.rerender(content("space"));
  assertRoot();
  expect(title()).toHaveAttribute("aria-expanded", "false");
});

describe("single-item current-model activation", () => {
  it.each(
    fixedSlotModes.flatMap((groupSlotMode) =>
      [1, 2].map((count) => ({ groupSlotMode, count })),
    ),
  )(
    "keeps the first outer-body commit complete only for an opted-in single item ($groupSlotMode, $count)",
    ({ groupSlotMode, count }) => {
      const members = items.slice(0, count);
      const model = buildListRows({
        items: members,
        groups: [{ key: "first-commit", label: "同時生成", items: members }],
      });
      model.itemRows.forEach((row) => visibleKeys.add(row.rowKey));
      const bodyCommits: number[] = [];
      const BodyCommitProbe = ({ children }: { children: React.ReactNode }) => {
        const root = React.useRef<HTMLDivElement>(null);
        React.useLayoutEffect(() => {
          bodyCommits.push(root.current!.querySelectorAll("input").length);
        });
        return <div ref={root}>{children}</div>;
      };
      const view = render(
        <RetainedViewportListRenderer
          groupSlotMode={groupSlotMode}
          model={model}
          accessibleLabel="単品の初回commit"
          renderGroup={(_group, rows) => (
            <BodyCommitProbe>
              {rows.map((child) =>
                child.render(<input aria-label={child.row.itemId} />),
              )}
            </BodyCommitProbe>
          )}
        />,
      );
      expect(view.container.querySelectorAll("input")).toHaveLength(0);
      const outer = view.container.querySelector<HTMLElement>(
        "[data-viewport-row-key]",
      )!;
      // Deliver only the outer intersection. Its first body layout effect records
      // the committed DOM before a deferred child's own activation can commit.
      act(() =>
        callback(
          [
            { target: outer, isIntersecting: true },
          ] as unknown as IntersectionObserverEntry[],
          {} as IntersectionObserver,
        ),
      );
      expect(bodyCommits).toEqual([
        groupSlotMode === "current-model" && count === 1 ? 1 : 0,
      ]);
      expect(view.container.querySelectorAll("input")).toHaveLength(count);
      expect(
        view.container.querySelectorAll("[data-viewport-row-key]"),
      ).toHaveLength(count + 1);
    },
  );

  it("keeps 500 inactive single-item groups deferred and activates just the outer-selected card", () => {
    const members = Array.from({ length: 500 }, (_, index) => ({
      ...items[0],
      id: `activation-${index}`,
    }));
    const model = buildListRows({
      items: members,
      groups: members.map((item) => ({
        key: item.id,
        label: item.id,
        items: [item],
      })),
    });
    const view = render(
      <RetainedViewportListRenderer
        groupSlotMode="current-model"
        model={model}
        accessibleLabel="画面外の単品"
        renderGroup={(_group, rows) => (
          <>
            {rows.map((child) =>
              child.render(<input aria-label={child.row.itemId} />),
            )}
          </>
        )}
      />,
    );
    expect(view.container.querySelectorAll("input")).toHaveLength(0);
    expect(view.container.querySelectorAll("[data-row-key]")).toHaveLength(
      1000,
    );
    const outer = view.container.querySelector<HTMLElement>(
      "[data-viewport-row-key]",
    )!;
    act(() =>
      callback(
        [
          { target: outer, isIntersecting: true },
        ] as unknown as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    expect(view.container.querySelectorAll("input")).toHaveLength(1);
    expect(
      view.getByRole("textbox", { name: members[0].id }),
    ).toBeInTheDocument();
    expect(view.container.querySelectorAll("[data-row-key]")).toHaveLength(
      1000,
    );
    act(() =>
      callback(
        [
          { target: outer, isIntersecting: false },
        ] as unknown as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    expect(view.container.querySelectorAll("input")).toHaveLength(0);
  }, 15_000);

  it("preserves a pinned single card, its focused edit and print activation", async () => {
    const model = buildListRows({
      items: [items[0]],
      groups: [
        { key: "pinned-single", label: "保持する単品", items: [items[0]] },
      ],
    });
    const content = (pinned: boolean) => (
      <RetainedViewportListRenderer
        groupSlotMode="current-model"
        model={model}
        pinnedRowKeys={pinned ? new Set([model.itemRows[0].rowKey]) : undefined}
        accessibleLabel="単品の保持と印刷"
        renderGroup={(_group, rows) => (
          <>
            {rows.map((child) =>
              child.render(
                <input
                  aria-label={child.row.itemId}
                  defaultValue="ユーザー登録"
                />,
              ),
            )}
          </>
        )}
      />
    );
    const view = render(content(true));
    const outer = view.container.querySelector("[data-viewport-row-key]");
    const input = view.getByRole("textbox", { name: items[0].id });
    act(() => input.focus());
    fireEvent.change(input, {
      target: { value: "エラーが発生しました・編集中" },
    });
    view.rerender(content(false));
    fireEvent(window, new Event("beforeprint"));
    fireEvent(window, new Event("afterprint"));
    expect(view.container.querySelector("[data-viewport-row-key]")).toBe(outer);
    expect(view.getByRole("textbox", { name: items[0].id })).toBe(input);
    expect(input).toHaveValue("エラーが発生しました・編集中");
    expect(input).toHaveFocus();
    await act(async () => {
      input.blur();
      await Promise.resolve();
    });
    expect(view.queryByRole("textbox")).toBeNull();
    fireEvent(window, new Event("beforeprint"));
    expect(
      view.getByRole("textbox", { name: items[0].id }),
    ).toBeInTheDocument();
    fireEvent(window, new Event("afterprint"));
    expect(view.queryByRole("textbox")).toBeNull();
  });
});

it("reuses only static placeholder parts while keeping current ARIA, text and visit identity", () => {
  const source = items.slice(0, 2);
  const readContext = vi.spyOn(React, "useContext");
  const content = (
    mode: (typeof fixedSlotModes)[number],
    members: ShoppingItem[],
    label = "訪問先",
    prefix = "old",
  ) => (
    <RetainedViewportListRenderer
      groupSlotMode={mode}
      model={buildListRows({
        items: members,
        groups: members.map((item) => ({
          key: item.id,
          label: `${label}-${item.id}`,
          items: [item],
        })),
      })}
      accessibleLabel="静的ラベル"
      getVisitId={(item) => `${prefix}-${item.id}`}
      renderGroup={(_group, rows) => (
        <>{rows.map((child) => child.render(<input />))}</>
      )}
    />
  );
  type Node = React.ReactElement<Record<string, unknown>>;
  const captured = (key: string) => {
    const result = readContext.mock.results
      .map((result) => result.value)
      .filter(
        (value) =>
          React.isValidElement<Record<string, unknown>>(value) &&
          value.props["data-row-key"] === key,
      )
      .at(-1) as Node | undefined;
    expect(result).toBeDefined();
    const [heading, list] = result!.props.children as Node[];
    const fragment = (list.props.children as Node[])[0];
    const item = fragment.props.children as Node;
    return { heading, item, label: item.props.children as Node };
  };
  const reference = render(content(undefined, source));
  const view = render(content("current-model", source));
  const key = buildListRows({
    items: source,
    groups: [{ key: source[0].id, label: "訪問先", items: [source[0]] }],
  }).rows[0].rowKey;
  try {
    const initial = captured(key);
    const withInsertion = [{ ...source[0], id: "static-inserted" }, ...source];
    view.rerender(content("current-model", withInsertion));
    reference.rerender(content(undefined, withInsertion));
    const positioned = captured(key);
    expect(positioned.heading).toBe(initial.heading);
    expect(positioned.label).toBe(initial.label);
    expect(positioned.item).not.toBe(initial.item);
    expect(positioned.item.props["aria-posinset"]).toBe(2);
    expect(positioned.item.props["aria-setsize"]).toBe(3);
    expect(view.container.innerHTML).toBe(reference.container.innerHTML);
    const edited = withInsertion.map((item) =>
      item.id === source[0].id
        ? { ...item, remarks: "ユーザー登録・更新", price: null, quantity: 7 }
        : item,
    );
    view.rerender(content("current-model", edited));
    reference.rerender(content(undefined, edited));
    const changed = captured(key);
    expect(changed.heading).toBe(initial.heading);
    expect(changed.label).not.toBe(initial.label);
    expect(changed.label.props.children).toContain(
      "ユーザー登録・更新 価格未定 7",
    );
    expect(view.container.innerHTML).toBe(reference.container.innerHTML);
    view.rerender(content("current-model", edited, "更新した訪問先", "new"));
    reference.rerender(content(undefined, edited, "更新した訪問先", "new"));
    const updated = captured(key);
    expect(updated.heading).not.toBe(initial.heading);
    expect(updated.heading.props["data-space-navigation-visit-id"]).toBe(
      `new-${source[0].id}`,
    );
    expect(updated.label).toBe(changed.label);
    expect(view.container.innerHTML).toBe(reference.container.innerHTML);
  } finally {
    readContext.mockRestore();
  }
});

it("keeps reordered multi-item placeholder labels and their ARIA equivalent to the generic path", () => {
  const content = (
    mode: (typeof fixedSlotModes)[number],
    members: ShoppingItem[],
  ) => (
    <RetainedViewportListRenderer
      groupSlotMode={mode}
      model={buildListRows({
        items: members,
        groups: [{ key: "static-multiple", label: "複数項目", items: members }],
      })}
      accessibleLabel="並替えラベル"
      getVisitId={(item) => item.id}
      renderGroup={(_group, rows) => (
        <>{rows.map((child) => child.render(<input />))}</>
      )}
    />
  );
  const source = items.slice(0, 3);
  const reference = render(content(undefined, source));
  const view = render(content("current-model", source));
  for (const reordered of [
    [source[2], source[0], source[1]],
    source.slice(1),
  ]) {
    view.rerender(content("current-model", reordered));
    reference.rerender(content(undefined, reordered));
    expect(view.container.innerHTML).toBe(reference.container.innerHTML);
    const rows = [
      ...view.container.querySelectorAll<HTMLElement>("[aria-posinset]"),
    ];
    rows.forEach((row, index) => {
      expect(row).toHaveAttribute("aria-posinset", String(index + 1));
      expect(row).toHaveAttribute("aria-setsize", String(reordered.length));
      expect(row).toHaveTextContent(reordered[index].circle);
    });
    expect(view.container.querySelector("input")).toBeNull();
  }
});

it("does not rejoin 500 unchanged labels when only their ARIA positions change", () => {
  const source = Array.from({ length: 500 }, (_, index) => ({
    ...items[0],
    id: `primitive-${index}`,
    remarks: `primitive-label-${index}`,
  }));
  const content = (
    mode: (typeof fixedSlotModes)[number],
    members: ShoppingItem[],
  ) => (
    <RetainedViewportListRenderer
      groupSlotMode={mode}
      model={buildListRows({
        items: members,
        groups: members.map((item) => ({
          key: item.id,
          label: item.id,
          items: [item],
        })),
      })}
      accessibleLabel="ラベルの元データ"
      renderGroup={(_group, rows) => (
        <>{rows.map((child) => child.render(<input />))}</>
      )}
    />
  );
  const originalJoin = Array.prototype.join;
  let labelJoins = 0;
  const join = vi.spyOn(Array.prototype, "join").mockImplementation(function (
    this: unknown[],
    separator?: string,
  ) {
    if (
      separator === " " &&
      this.length === 4 &&
      typeof this[1] === "string" &&
      this[1].startsWith("primitive-label-")
    )
      labelJoins++;
    return originalJoin.call(this, separator);
  });
  try {
    const view = render(content("current-model", source));
    expect(labelJoins).toBe(500);
    const firstLabel = view.container.querySelectorAll(
      ".esp-viewport-placeholder-label",
    )[1];
    const inserted = { ...items[0], id: "primitive-new", remarks: "new label" };
    for (const members of [[inserted, ...source], source]) {
      labelJoins = 0;
      view.rerender(content("current-model", members));
      expect(labelJoins).toBe(0);
      const position = members === source ? 1 : 2;
      const firstRow = [
        ...view.container.querySelectorAll<HTMLElement>("[aria-posinset]"),
      ].find(
        (row) => row.dataset.rowKey === `item:${JSON.stringify(source[0].id)}`,
      )!;
      expect(firstRow).toHaveAttribute("aria-posinset", String(position));
      expect(firstRow).toHaveAttribute("aria-setsize", String(members.length));
      expect(firstRow.querySelector(".esp-viewport-placeholder-label")).toBe(
        firstLabel,
      );
      const reference = render(content(undefined, members));
      expect(view.container.innerHTML).toBe(reference.container.innerHTML);
      reference.unmount();
    }
    expect(view.container.querySelector("input")).toBeNull();
  } finally {
    join.mockRestore();
  }
}, 15000);

it("records changed label primitives even when their joined text and JSX stay equal", () => {
  const source = {
    ...items[0],
    id: "primitive-equivalent",
    remarks: "",
    price: null,
  };
  const content = (
    mode: (typeof fixedSlotModes)[number],
    member: ShoppingItem,
    includePrefix = false,
  ) => {
    const members = includePrefix
      ? [{ ...items[1], id: "primitive-prefix" }, member]
      : [member];
    return (
      <RetainedViewportListRenderer
        groupSlotMode={mode}
        model={buildListRows({
          items: members,
          groups: members.map((item) => ({
            key: item.id,
            label: item.id,
            items: [item],
          })),
        })}
        accessibleLabel="同じ文字列のラベル"
        renderGroup={(_group, rows) => (
          <>{rows.map((child) => child.render(<input />))}</>
        )}
      />
    );
  };
  type Node = React.ReactElement<Record<string, unknown>>;
  const readContext = vi.spyOn(React, "useContext");
  const labelElement = () => {
    const group = readContext.mock.results
      .map((result) => result.value)
      .filter(
        (value) =>
          React.isValidElement<Record<string, unknown>>(value) &&
          value.props["data-row-key"] === `group:${JSON.stringify(source.id)}`,
      )
      .at(-1) as Node;
    const list = (group.props.children as Node[])[1];
    const item = (list.props.children as Node[])[0].props.children as Node;
    return item.props.children;
  };
  const name = buildListRows({ items: [source] }).itemRows[0].accessibleName;
  const originalJoin = Array.prototype.join;
  let labelJoins = 0;
  const join = vi.spyOn(Array.prototype, "join").mockImplementation(function (
    this: unknown[],
    separator?: string,
  ) {
    if (separator === " " && this.length === 4 && this[0] === name)
      labelJoins++;
    return originalJoin.call(this, separator);
  });
  try {
    const view = render(content("current-model", source));
    const initial = labelElement();
    // The renderer accepts item snapshots directly; exercise equivalent join values
    // explicitly, including malformed/null input without broadening item validation.
    for (const remarks of [null, undefined, ""]) {
      const member = {
        ...source,
        remarks: remarks as unknown as ShoppingItem["remarks"],
      };
      labelJoins = 0;
      view.rerender(content("current-model", member));
      expect(labelJoins).toBe(1);
      expect(labelElement()).toBe(initial);
      for (const includePrefix of [true, false]) {
        labelJoins = 0;
        view.rerender(content("current-model", member, includePrefix));
        expect(labelJoins).toBe(0);
        expect(labelElement()).toBe(initial);
        const reference = render(content(undefined, member, includePrefix));
        expect(view.container.innerHTML).toBe(reference.container.innerHTML);
        reference.unmount();
      }
    }
  } finally {
    join.mockRestore();
    readContext.mockRestore();
  }
});
describe("forced viewport activation keeps unknown visibility private", () => {
  const noSynchronousHeightRead = () =>
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  const row = (key: string, defer: boolean, retain = false) => (
    <ViewportContent
      key={key}
      rowKey={key}
      defer={defer}
      retain={retain}
      placeholder={<span>pending-{key}</span>}
      render={() => <input aria-label={key} defaultValue="draft" />}
    />
  );
  const rootOf = (view: ReturnType<typeof render>, key: string) =>
    view.container.querySelector<HTMLElement>(
      '[data-viewport-row-key="' + key + '"]',
    )!;
  const measuredCount = (root: HTMLElement) =>
    vi
      .mocked(HTMLElement.prototype.getBoundingClientRect)
      .mock.instances.filter((element) => element === root).length;

  it.each(["nondeferred", "retained"] as const)(
    "does not measure a new %s root merely to force its body active",
    (reason) => {
      noSynchronousHeightRead();
      const key = "unknown-initial-" + reason;
      const view = render(
        row(key, reason !== "nondeferred", reason === "retained"),
      );
      const root = rootOf(view, key);
      expect(root).toHaveAttribute("data-viewport-active", "true");
      expect(root.querySelector("input")).not.toBeNull();
      expect(measuredCount(root)).toBe(0);
    },
  );

  it.each([
    ["nondeferred", true],
    ["nondeferred", false],
    ["retained", true],
    ["retained", false],
  ] as const)(
    "measures unknown %s visibility when forcing ends (visible=%s)",
    (reason, visible) => {
      noSynchronousHeightRead();
      const key = "unknown-transition-" + reason + "-" + visible;
      if (visible) visibleKeys.add(key);
      const view = render(
        <>
          {row("unknown-transition-registry", false)}
          {row(key, reason !== "nondeferred", reason === "retained")}
        </>,
      );
      const root = rootOf(view, key);
      const input = root.querySelector("input");
      expect(measuredCount(root)).toBe(0);
      view.rerender(
        <>
          {row("unknown-transition-registry", false)}
          {row(key, true)}
        </>,
      );
      expect(measuredCount(root)).toBe(1);
      expect(root).toHaveAttribute("data-viewport-active", String(visible));
      expect(root.querySelector("input")).toBe(visible ? input : null);
    },
  );

  it.each([true, false])(
    "uses an actual IO boolean after forced activation (intersecting=%s)",
    (intersecting) => {
      noSynchronousHeightRead();
      const key = "known-io-" + intersecting;
      const view = render(
        <>
          {row("known-io-registry", false)}
          {row(key, false)}
        </>,
      );
      const root = rootOf(view, key);
      act(() =>
        callback(
          [
            {
              target: root,
              isIntersecting: intersecting,
              boundingClientRect: new DOMRect(
                0,
                intersecting ? 20 : 10000,
                400,
                136,
              ),
              intersectionRect: intersecting
                ? new DOMRect(0, 20, 400, 136)
                : new DOMRect(),
              intersectionRatio: Number(intersecting),
              rootBounds: null,
              time: 0,
            },
          ] as IntersectionObserverEntry[],
          {} as IntersectionObserver,
        ),
      );
      expect(root).toHaveAttribute("data-viewport-active", "true");
      view.rerender(
        <>
          {row("known-io-registry", false)}
          {row(key, true)}
        </>,
      );
      expect(measuredCount(root)).toBe(0);
      expect(root).toHaveAttribute(
        "data-viewport-active",
        String(intersecting),
      );
    },
  );

  it.each([true, false])(
    "preserves forced-prefix offsets through synchronous registration changes (keepRegistry=%s)",
    (keepRegistry) => {
      noSynchronousHeightRead();
      const measure = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
      const originalMeasure = measure.getMockImplementation()!;
      measure.mockImplementation(function (this: HTMLElement) {
        const original = originalMeasure.call(this);
        if (this.dataset.testid === "unknown-offset-list")
          return {
            ...original,
            top: -1000,
            bottom: 636,
            height: 1636,
            y: -1000,
          };
        if (this.dataset.viewportRowKey === "unknown-offset-first")
          return {
            ...original,
            top: -1000,
            bottom: 500,
            height: 1500,
            y: -1000,
          };
        if (this.dataset.viewportRowKey === "unknown-offset-next")
          return { ...original, top: 500, bottom: 636, height: 136, y: 500 };
        return original;
      });
      function Harness() {
        const [next, setNext] = React.useState(false);
        React.useLayoutEffect(() => setNext(true), []);
        return (
          <>
            {keepRegistry && row("unknown-offset-registry", false)}
            <div data-viewport-list data-testid="unknown-offset-list">
              <ViewportContent
                rowKey="unknown-offset-first"
                defer={keepRegistry && next}
                layoutKey={!keepRegistry && next ? "changed" : "original"}
                estimatedHeight={1500}
                placeholder={<span>pending-first</span>}
                render={() => <input aria-label="unknown-offset-first" />}
              />
              {next && (
                <ViewportContent
                  rowKey="unknown-offset-next"
                  estimatedHeight={136}
                  placeholder={<span>pending-next</span>}
                  render={() => <input aria-label="unknown-offset-next" />}
                />
              )}
            </div>
          </>
        );
      }
      const view = render(<Harness />);
      const first = rootOf(view, "unknown-offset-first");
      const following = rootOf(view, "unknown-offset-next");
      expect(first).toHaveAttribute("data-viewport-active", "true");
      expect(following).toHaveAttribute("data-viewport-active", "true");
      expect(following.querySelector("input")).not.toBeNull();
      expect(measuredCount(first)).toBe(keepRegistry ? 1 : 0);
      expect(measuredCount(following)).toBe(1);
    },
  );

  it("keeps focus and requested activation, then measures correctly after printing", async () => {
    noSynchronousHeightRead();
    const key = "unknown-focus-print";
    const view = render(
      <>
        {row("unknown-focus-registry", false)}
        {row(key, true, true)}
      </>,
    );
    const root = rootOf(view, key);
    const input = root.querySelector("input")!;
    input.focus();
    fireEvent.change(input, { target: { value: "still editing" } });
    view.rerender(
      <>
        {row("unknown-focus-registry", false)}
        {row(key, true)}
      </>,
    );
    expect(measuredCount(root)).toBe(1);
    expect(root.querySelector("input")).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("still editing");
    input.blur();
    await act(async () => {
      await Promise.resolve();
    });
    expect(root.querySelector("input")).toBeNull();
    let release = () => {};
    act(() => {
      release = prewarmViewportContent(root);
    });
    expect(root.querySelector("input")).not.toBeNull();
    act(() => release());
    expect(root.querySelector("input")).toBeNull();
    fireEvent(window, new Event("beforeprint"));
    expect(root.querySelector("input")).not.toBeNull();
    fireEvent(window, new Event("afterprint"));
    expect(root.querySelector("input")).toBeNull();
  });
});
