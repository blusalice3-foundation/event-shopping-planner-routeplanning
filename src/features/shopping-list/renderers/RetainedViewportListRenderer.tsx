import React, { useEffect, useLayoutEffect, useRef } from "react";
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
} from "./ViewportContent";

type Props = FullListRendererProps & {
  readonly layoutMode?: "pc" | "smartphone";
  readonly defer?: boolean;
  readonly engine?: "full" | "virtual";
  readonly pinnedRowKeys?: ReadonlySet<string>;
  readonly zoomPercent?: number | null;
  readonly getGroupVisitId?: (groupKey: string) => string | undefined;
  readonly getVisitId?: (
    item: ShoppingListItemRow["item"],
  ) => string | undefined;
};

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

/**
 * Keep controls near the viewport and retain rows for active focus, dialogs and drag.
 * Every pending row has a normal-flow accessible/navigation placeholder.
 */
export const RetainedViewportListRenderer = (
  props: Props,
): React.ReactElement => {
  const layoutMode = props.layoutMode ?? "pc";
  const rowStates = useRef(new Map<string, CardExpansion>());
  const anchorRef = useRef<{ key: string; top: number }>();
  const listRoot = useRef<HTMLDivElement | null>(null);
  const previousZoom = useRef(props.zoomPercent);
  useEffect(() => {
    let frame: number | null = null;
    const capture = () => {
      frame = null;
      const rows = listRoot.current?.querySelectorAll<HTMLElement>(
        "[data-row-key][aria-posinset]",
      );
      if (!rows) return;
      const viewportTop = Math.max(
        0,
        document.querySelector("header")?.getBoundingClientRect().bottom ?? 0,
      );
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (rect.bottom > viewportTop && rect.top < window.innerHeight) {
          anchorRef.current = { key: row.dataset.rowKey!, top: rect.top };
          break;
        }
      }
    };
    const scroll = () => {
      frame ??= requestAnimationFrame(capture);
    };
    capture();
    window.addEventListener("scroll", scroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", scroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);
  useLayoutEffect(() => {
    if (previousZoom.current === props.zoomPercent) return;
    previousZoom.current = props.zoomPercent;
    const anchor = anchorRef.current;
    if (!anchor) return;
    const row = [
      ...(listRoot.current?.querySelectorAll<HTMLElement>("[data-row-key]") ??
        []),
    ].find((candidate) => candidate.dataset.rowKey === anchor.key);
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
    if (row.kind === "group" && props.renderGroup) {
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
        <ViewportContent
          key={row.rowKey}
          rowKey={row.rowKey}
          retain={
            props.pinnedRowKeys?.has(row.rowKey) ||
            (row.kind === "group" &&
              itemRows.some(({ row: child }) =>
                props.pinnedRowKeys?.has(child.rowKey),
              ))
          }
          defer={props.defer}
          placeholder={
            <div {...getShoppingListRowAccessibilityAttributes(row)}>
              <div
                className="esp-viewport-placeholder-heading"
                data-space-navigation-visit-id={
                  props.getGroupVisitId?.(row.groupKey) ??
                  (itemRows[0] && props.getVisitId?.(itemRows[0].row.item))
                }
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
                {itemRows.map(({ row: itemRow }) => (
                  <React.Fragment key={itemRow.rowKey}>
                    {itemPlaceholder(itemRow, layoutMode, props.getVisitId)}
                  </React.Fragment>
                ))}
              </div>
            </div>
          }
          render={() => (
            <div {...getShoppingListRowAccessibilityAttributes(row)}>
              {props.renderGroup?.(row, itemRows, groupIndex)}
            </div>
          )}
        />,
      );
      index = cursor - 1;
    } else if (row.kind === "item" && props.renderRow) {
      const itemIndex = index;
      rendered.push(
        <ViewportContent
          key={row.rowKey}
          rowKey={row.rowKey}
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
