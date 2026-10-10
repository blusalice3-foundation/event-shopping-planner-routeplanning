import { observeViewportAnchors } from "../../space-navigation/domain/navigationAnchors";
import React, { useEffect, useLayoutEffect, useRef } from "react";

import { recordShoppingRender } from "../../../utils/shoppingPerformance";
import type { ShoppingListGroupRow } from "../model/buildListRows";
import {
  ViewportRowStateContext,
  type CardExpansion,
} from "./ViewportRowState";
import type {
  FullListRendererProps,
  FullListRenderedItemRow,
} from "./FullListRenderer";
import { getShoppingListRowAccessibilityAttributes } from "./rowAccessibility";
import type { ShoppingListItemRow } from "../model/buildListRows";
import {
  ViewportContent,
  focusPendingViewportContent,
  findViewportRow,
} from "./ViewportContent";

type Props = FullListRendererProps & {
  readonly layoutMode?: "pc" | "smartphone";
  readonly defer?: boolean;
  readonly engine?: "full" | "virtual";
  readonly pinnedRowKeys?: ReadonlySet<string>;
  readonly zoomPercent?: number | null;
  readonly renderDependencies?: readonly unknown[];
  readonly getGroupVisitId?: (groupKey: string) => string | undefined;
  readonly getGroupVersion?: (groupKey: string) => unknown;
  readonly getVisitId?: (
    item: ShoppingListItemRow["item"],
  ) => string | undefined;
};

type GroupContentProps = {
  row: ShoppingListGroupRow;
  items: readonly FullListRenderedItemRow[];
  index: number;
  render: NonNullable<Props["renderGroup"]>;
  dependencies?: readonly unknown[];
  version?: unknown;
  retained: readonly boolean[];
};
const sameGroupContent = (
  before: GroupContentProps,
  after: GroupContentProps,
) =>
  !!before.dependencies &&
  !!after.dependencies &&
  before.version === after.version &&
  before.retained.length === after.retained.length &&
  before.retained.every((value, index) => value === after.retained[index]) &&
  before.index === after.index &&
  before.dependencies.length === after.dependencies.length &&
  before.dependencies.every(
    (value, index) => value === after.dependencies![index],
  ) &&
  before.row.rowKey === after.row.rowKey &&
  before.row.label === after.row.label &&
  before.row.accessibleName === after.row.accessibleName &&
  before.row.collapsed === after.row.collapsed &&
  before.row.itemCount === after.row.itemCount &&
  before.items.length === after.items.length &&
  before.items.every((item, index) => {
    const next = after.items[index];
    return (
      item.index === next.index &&
      item.row.item === next.row.item &&
      item.row.column === next.row.column &&
      item.row.positionInSet === next.row.positionInSet &&
      item.row.setSize === next.row.setSize &&
      item.row.flags.selected === next.row.flags.selected &&
      item.row.flags.highlighted === next.row.flags.highlighted &&
      item.row.flags.duplicateCircle === next.row.flags.duplicateCircle
    );
  });
const GroupContent = React.memo(
  ({ row, items, index, render }: GroupContentProps) => {
    recordShoppingRender("execution-space");
    return (
      <div {...getShoppingListRowAccessibilityAttributes(row)}>
        {render(row, items, index)}
      </div>
    );
  },
  sameGroupContent,
);
const itemPlaceholder = (
  row: ShoppingListItemRow,
  layoutMode: "pc" | "smartphone",
  getVisitId: Props["getVisitId"],
): React.ReactElement => (
  <div
    {...getShoppingListRowAccessibilityAttributes(row)}
    data-space-navigation-visit-id={getVisitId?.(row.item)}
    data-space-navigation-anchor="item"
    tabIndex={0}
    data-viewport-focus-sentinel
    onFocus={(event) => focusPendingViewportContent(event.currentTarget)}
    className={
      layoutMode === "pc"
        ? "esp-viewport-placeholder esp-viewport-placeholder-pc"
        : "esp-viewport-placeholder esp-viewport-placeholder-phone"
    }
  >
    <span className="esp-viewport-placeholder-label">
      {[
        row.accessibleName,
        row.item.remarks,
        row.item.price ?? "価格未定",
        row.item.quantity,
      ].join(" ")}
    </span>
  </div>
);

type GroupViewportProps = GroupContentProps & {
  layoutMode: "pc" | "smartphone";
  defer?: boolean;
  retained: readonly boolean[];
  visitIds: readonly (string | undefined)[];
  getVisitId: Props["getVisitId"];
  layoutKey: string;
  estimatedHeight: number;
};
const GroupViewport = React.memo(
  ({
    row,
    items,
    index,
    render,
    dependencies,
    version,
    layoutMode,
    defer,
    retained,
    visitIds,
    getVisitId,
    layoutKey,
    estimatedHeight,
  }: GroupViewportProps) => {
    recordShoppingRender("execution-viewport");
    return (
      <ViewportContent
        rowKey={row.rowKey}
        layoutKey={layoutKey}
        estimatedHeight={estimatedHeight}
        retain={retained.some(Boolean)}
        defer={defer}
        placeholder={
          <div {...getShoppingListRowAccessibilityAttributes(row)}>
            <div
              className="esp-viewport-placeholder-heading"
              data-space-navigation-visit-id={visitIds[0]}
              data-space-navigation-anchor="heading"
              tabIndex={0}
              data-viewport-focus-sentinel
              onFocus={(event) =>
                focusPendingViewportContent(event.currentTarget)
              }
            >
              <span className="esp-viewport-placeholder-label">
                {row.accessibleName}
              </span>
            </div>
            <div role="list" aria-label={row.label + "の項目"}>
              {items.map(({ row: itemRow }) => (
                <React.Fragment key={itemRow.rowKey}>
                  {itemPlaceholder(itemRow, layoutMode, getVisitId)}
                </React.Fragment>
              ))}
            </div>
          </div>
        }
        render={() => (
          <GroupContent
            row={row}
            items={items}
            index={index}
            render={render}
            dependencies={dependencies}
            version={version}
            retained={retained}
          />
        )}
      />
    );
  },
  (before, after) =>
    sameGroupContent(before, after) &&
    before.layoutMode === after.layoutMode &&
    before.defer === after.defer &&
    before.layoutKey === after.layoutKey &&
    before.estimatedHeight === after.estimatedHeight &&
    before.visitIds.every((value, index) => value === after.visitIds[index]),
);
/**
 * Keep controls near the viewport and retain rows for active focus, dialogs and drag.
 * Every pending row has a normal-flow accessible/navigation placeholder.
 */
export const RetainedViewportListRenderer = (
  props: Props,
): React.ReactElement => {
  const layoutMode = props.layoutMode ?? "pc";
  const renderGroup = props.renderGroup;
  const layoutKey = JSON.stringify([
    layoutMode,
    props.model.itemRows[0]?.column,
    props.zoomPercent,
    props.selectionReason,
  ]);
  const estimatedItemHeight = layoutMode === "pc" ? 220 : 136;
  const rowStates = useRef(new Map<string, CardExpansion>());
  const anchorRef = useRef<{ key: string; top: number }>();
  const listRoot = useRef<HTMLDivElement | null>(null);
  const previousZoom = useRef(props.zoomPercent);
  useEffect(() => {
    let frame: number | null = null;
    const capture = () => {
      frame = null;
      const rows = anchors.candidates();
      const viewportTop = Math.max(
        0,
        document.querySelector("header")?.getBoundingClientRect().bottom ?? 0,
      );
      let first: { key: string; top: number } | undefined;
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (rect.bottom > viewportTop && rect.top < window.innerHeight) {
          if (!first || rect.top < first.top)
            first = { key: row.dataset.rowKey!, top: rect.top };
        }
      }
      if (first) anchorRef.current = first;
    };
    const scroll = () => {
      frame ??= requestAnimationFrame(capture);
    };
    const root = listRoot.current;
    if (!root) return;
    const anchors = observeViewportAnchors(
      root,
      "[data-row-key][aria-posinset]",
      scroll,
      ["data-row-key", "aria-posinset"],
    );
    capture();
    window.addEventListener("scroll", scroll, { passive: true });
    return () => {
      anchors.dispose();
      window.removeEventListener("scroll", scroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);
  useLayoutEffect(() => {
    if (previousZoom.current === props.zoomPercent) return;
    previousZoom.current = props.zoomPercent;
    const anchor = anchorRef.current;
    if (!anchor) return;
    const row = findViewportRow(listRoot.current, anchor.key);
    if (row)
      window.scrollBy({
        top: row.getBoundingClientRect().top - anchor.top,
        behavior: "instant",
      });
  }, [props.zoomPercent]);
  useEffect(() => {
    const ids = new Set(props.model.itemRows.map((row) => row.itemId));
    for (const id of rowStates.current.keys())
      if (!ids.has(id)) rowStates.current.delete(id);
  }, [props.model]);
  const rendered: React.ReactElement[] = [];
  for (let index = 0; index < props.model.rows.length; index += 1) {
    const row = props.model.rows[index];
    if (row.kind === "group" && renderGroup) {
      const itemRows: FullListRenderedItemRow[] = [];
      let cursor = index + 1;
      while (cursor < props.model.rows.length) {
        const itemRow = props.model.rows[cursor];
        if (itemRow.kind !== "item" || itemRow.groupKey !== row.groupKey) break;
        const itemIndex = cursor;
        itemRows.push({
          row: itemRow,
          index: itemIndex,
          render: (content) => (
            <ViewportContent
              key={itemRow.rowKey}
              rowKey={itemRow.rowKey}
              layoutKey={layoutKey}
              estimatedHeight={estimatedItemHeight}
              retain={props.pinnedRowKeys?.has(itemRow.rowKey)}
              defer={props.defer}
              placeholder={itemPlaceholder(
                itemRow,
                layoutMode,
                props.getVisitId,
              )}
              render={() => (
                <div {...getShoppingListRowAccessibilityAttributes(itemRow)}>
                  {content}
                </div>
              )}
            />
          ),
        });
        cursor += 1;
      }
      const groupIndex = index;
      rendered.push(
        <GroupViewport
          key={row.rowKey}
          row={row}
          items={itemRows}
          index={groupIndex}
          render={renderGroup}
          dependencies={props.renderDependencies}
          version={props.getGroupVersion?.(row.groupKey)}
          layoutMode={layoutMode}
          defer={props.defer}
          retained={[
            !!props.pinnedRowKeys?.has(row.rowKey),
            ...itemRows.map(
              ({ row: child }) => !!props.pinnedRowKeys?.has(child.rowKey),
            ),
          ]}
          visitIds={[
            props.getGroupVisitId?.(row.groupKey) ??
              (itemRows[0] && props.getVisitId?.(itemRows[0].row.item)),
            ...itemRows.map(({ row: child }) => props.getVisitId?.(child.item)),
          ]}
          getVisitId={props.getVisitId}
          layoutKey={layoutKey}
          estimatedHeight={
            row.collapsed ? 44 : 44 + estimatedItemHeight * itemRows.length
          }
        />,
      );
      index = cursor - 1;
    } else if (row.kind === "item" && props.renderRow) {
      const itemIndex = index;
      rendered.push(
        <ViewportContent
          key={row.rowKey}
          rowKey={row.rowKey}
          layoutKey={layoutKey}
          estimatedHeight={estimatedItemHeight}
          retain={props.pinnedRowKeys?.has(row.rowKey)}
          defer={props.defer}
          placeholder={itemPlaceholder(row, layoutMode, props.getVisitId)}
          render={() => (
            <div {...getShoppingListRowAccessibilityAttributes(row)}>
              {props.renderRow?.(row, itemIndex)}
            </div>
          )}
        />,
      );
    }
  }
  return (
    <ViewportRowStateContext.Provider value={rowStates.current}>
      <div
        {...props.rootProps}
        ref={(node) => {
          listRoot.current = node;
          if (typeof props.rootRef === "function") props.rootRef(node);
          else if (props.rootRef)
            (
              props.rootRef as React.MutableRefObject<HTMLDivElement | null>
            ).current = node;
        }}
        role="list"
        aria-label={props.accessibleLabel}
        data-list-renderer={props.engine ?? "virtual"}
        data-list-renderer-strategy="retained-viewport"
        data-list-renderer-reason={props.selectionReason}
        data-list-row-count={props.model.rows.length}
        data-list-row-keys-stable={
          props.model.hasStableRowKeys ? "true" : "false"
        }
        data-list-controller="shared"
        data-list-focused-row-key={props.focusedRowKey ?? undefined}
      >
        {props.beforeContent}
        {rendered}
        {props.afterContent}
      </div>
    </ViewportRowStateContext.Provider>
  );
};
