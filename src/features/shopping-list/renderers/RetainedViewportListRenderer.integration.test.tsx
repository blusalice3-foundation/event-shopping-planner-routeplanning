import React from "react";
import ShoppingList from "../../../components/ShoppingList";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildListRows } from "../model/buildListRows";
import type { ShoppingItem } from "../../../types/item";
import { RetainedViewportListRenderer } from "./RetainedViewportListRenderer";
import { revealViewportContent, ViewportContent } from "./ViewportContent";
import { evaluateRetainedViewportEligibility } from "./retainedViewportEligibility";

let callback: IntersectionObserverCallback;
const observed = new Set<Element>();
const disconnect = vi.fn();
const visibleKeys = new Set<string>();
beforeEach(() => {
  disconnect.mockClear();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(next: IntersectionObserverCallback) {
        callback = next;
      }
      observe(element: Element) {
        observed.add(element);
      }
      unobserve(element: Element) {
        observed.delete(element);
      }
      disconnect() {
        disconnect();
        observed.clear();
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        top: visibleKeys.has(this.dataset.viewportRowKey ?? "") ? 20 : 10000,
        bottom: visibleKeys.has(this.dataset.viewportRowKey ?? "")
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
