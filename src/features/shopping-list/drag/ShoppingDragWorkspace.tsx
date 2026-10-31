import { projectedMembership } from "../../consistency/domain/projection";
import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import type { ShoppingItem } from "../../../types/item";
import ReactDOM from "react-dom";
import { buildMovePlan } from "../../lists/domain/movePlan";
import {
  buildExecutionPlacementVisitKey,
  projectExecutionPlacementVisits,
} from "../../../utils/executionPlacement";
import {
  buildShoppingDragLayout,
  resolveShoppingDragColumnPlacement,
  resolveShoppingDragPlacement,
  resolveShoppingBookPlacement,
  shoppingDragHasSingleGroup,
  isShoppingDragGroupSlot,
  shoppingPlacementContext,
  type ShoppingDragColumn,
  type ShoppingDragLayout,
  type ShoppingDragMoveContext,
  type ShoppingDragPlacement,
  type ShoppingDragPresentation,
} from "./shoppingDrag";

interface DragList {
  readonly items: readonly ShoppingItem[];
  readonly sourceItems?: readonly ShoppingItem[];
  readonly executeOrder?: readonly string[];
  readonly displayOrder?: () => readonly string[];
  readonly rowReferences?: () => readonly {
    readonly rowKey: string;
    readonly itemId: string;
  }[];
  readonly groupKeyForItem?: (item: ShoppingItem) => string;
  readonly presentation: ShoppingDragPresentation;
  readonly root: () => HTMLDivElement | null;
  readonly move: (
    dragId: string,
    hoverId: string,
    target: ShoppingDragColumn,
    source: ShoppingDragColumn,
    context?: ShoppingDragMoveContext,
  ) => void;
  readonly reveal?: (itemId: string) => void;
  readonly resolveMembership?: (itemId: string) => void;
  readonly candidateNumberSort: "asc" | "desc" | null;
}
interface ActiveDrag {
  readonly context: ShoppingDragMoveContext;
  readonly dragId: string;
  readonly moving: readonly ShoppingItem[];
  readonly requested: readonly ShoppingItem[];
}
export interface ShoppingDragWorkspace {
  readonly active: () => ActiveDrag | null;
  readonly moveContext: (
    target: ShoppingDragColumn,
  ) => ShoppingDragMoveContext | undefined;
  readonly register: (column: ShoppingDragColumn, list: DragList) => () => void;
  readonly subscribe: (listener: (active: boolean) => void) => () => void;
  readonly start: (
    column: ShoppingDragColumn,
    dragId: string,
    requestedIds: readonly string[],
    operation: ShoppingDragMoveContext["operation"],
  ) => symbol | null;
  readonly hover: (
    column: ShoppingDragColumn,
    targetId: string | undefined,
    clientY: number,
    clientX?: number,
  ) => boolean;
  readonly drop: (column: ShoppingDragColumn) => void;
  readonly leave: () => void;
  readonly clear: (token?: symbol) => void;
  readonly refresh: () => void;
}
const Context = createContext<ShoppingDragWorkspace | null>(null);
export const useShoppingDragWorkspace = (): ShoppingDragWorkspace | null =>
  useContext(Context);

/** Extends cross-column hit testing across headers and unused column space. */
export function ShoppingDragColumnSurface({
  column,
  className,
  children,
}: {
  column: ShoppingDragColumn;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const workspace = useShoppingDragWorkspace();
  const acceptsDrag = () => {
    const active = workspace?.active();
    return (
      active !== null &&
      active !== undefined &&
      active.context.sourceColumn !== column
    );
  };
  return (
    <div
      className={className}
      data-shopping-drag-surface={column}
      onDragOver={(event) => {
        if (!acceptsDrag()) return;
        event.preventDefault();
        event.stopPropagation();
        workspace!.hover(column, undefined, event.clientY, event.clientX);
      }}
      onDrop={(event) => {
        if (!acceptsDrag()) return;
        event.preventDefault();
        event.stopPropagation();
        workspace!.hover(column, undefined, event.clientY, event.clientX);
        workspace!.drop(column);
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        if (acceptsDrag()) workspace!.leave();
      }}
    >
      {children}
    </div>
  );
}

function rawExecuteItems(list: DragList): readonly ShoppingItem[] {
  if (!list.executeOrder) return list.items;
  const itemsById = new Map(list.items.map((item) => [item.id, item]));
  return list.executeOrder.flatMap((id) => {
    const item = itemsById.get(id);
    return item ? [item] : [];
  });
}

function createWorkspace(
  eventName: string,
  day: string,
  generation: number,
  reportRejection: (message: string) => void,
): ShoppingDragWorkspace {
  const lists = new Map<ShoppingDragColumn, DragList>();
  const listeners = new Set<(active: boolean) => void>();
  let active: ActiveDrag | null = null;
  let layoutCache: {
    list: DragList;
    layout: ShoppingDragLayout;
    columnPlacement?: ShoppingDragPlacement | null;
    moving?: readonly ShoppingItem[];
  } | null = null;
  const rowReferenceCaches = new WeakMap<
    DragList,
    {
      readonly references: readonly {
        readonly rowKey: string;
        readonly itemId: string;
      }[];
      readonly byKey: ReadonlyMap<string, string>;
      elements?: readonly {
        readonly itemId: string;
        readonly element: HTMLElement;
      }[];
    }
  >();
  let hoverPoint: {
    column: ShoppingDragColumn;
    id?: string;
    y: number;
    x?: number;
  } | null = null;
  let accepted: {
    column: ShoppingDragColumn;
    hoverId: string;
    context: ShoppingDragMoveContext;
  } | null = null;
  const decorations: HTMLElement[] = [];
  const decorationOwners = new Map<HTMLElement, string | null>();
  let decorationKey = "";
  let dragStatus: { root: HTMLElement; element: HTMLElement } | null = null;
  let layoutObserver: MutationObserver | null = null;
  let candidateNavigation: {
    list: DragList;
    ids: readonly string[];
    index: ReadonlyMap<string, number>;
  } | null = null;
  const prepareCandidateNavigation = (list: DragList) => {
    const ids = list.displayOrder?.() ?? list.items.map((item) => item.id);
    return { list, ids, index: new Map(ids.map((id, index) => [id, index])) };
  };
  let hitTestRejected = false;
  let rejectionReason = "";
  let guidedTarget = "";
  let guidedPoint: { x?: number; y: number } | null = null;
  let refreshing = false;
  let highlightedIds: readonly ShoppingItem[] | null = null;
  const highlights = new Map<HTMLElement, boolean>();
  const clearHighlights = () => {
    highlights.forEach((wasDimmed, element) => {
      delete element.dataset.shoppingDragEffective;
      if (!wasDimmed) element.classList.remove("opacity-40");
    });
    highlights.clear();
    highlightedIds = null;
    document.querySelector("[data-shopping-drag-count]")?.remove();
  };
  const highlightMoving = (moving: readonly ShoppingItem[]) => {
    if (highlightedIds === moving) return;
    clearHighlights();
    highlightedIds = moving;
    const root = active && lists.get(active.context.sourceColumn)?.root();
    if (root)
      moving.forEach((item) => {
        const element = root.querySelector<HTMLElement>(
          `[data-item-id=${JSON.stringify(item.id)}]`,
        );
        if (!element) return;
        highlights.set(element, element.classList.contains("opacity-40"));
        element.dataset.shoppingDragEffective = "true";
        element.classList.add("opacity-40");
      });
    const clone = document.querySelector(".esp-shopping-touch-clone");
    if (clone) {
      const badge = document.createElement("span");
      badge.dataset.shoppingDragCount = "true";
      badge.className =
        "absolute right-0 top-0 rounded bg-blue-700 px-2 py-1 text-white";
      badge.textContent = `${moving.length}件`;
      clone.append(badge);
    }
  };
  const ownDecorationPosition = (element: HTMLElement) => {
    if (!decorationOwners.has(element))
      decorationOwners.set(
        element,
        element.getAttribute("data-shopping-drag-guide-owner"),
      );
    element.dataset.shoppingDragGuideOwner = "true";
  };
  const clearDecorations = () => {
    decorations.splice(0).forEach((element) => element.remove());
    decorationOwners.forEach((previous, element) => {
      if (element.dataset.shoppingDragGuideOwner !== "true") return;
      if (previous === null) delete element.dataset.shoppingDragGuideOwner;
      else element.setAttribute("data-shopping-drag-guide-owner", previous);
    });
    decorationOwners.clear();
    decorationKey = "";
    dragStatus = null;
  };
  const positionStatus = () => {
    if (!dragStatus) return;
    const { root, element } = dragStatus;
    const bounds = root.getBoundingClientRect();
    const rootWidth = root.offsetWidth;
    const rootHeight = root.offsetHeight;
    // The list can be inside the app's scaled content; keep the overlay in
    // list coordinates while positioning its visible box in the viewport.
    const scaleX =
      rootWidth > 0 && bounds.width > 0 ? bounds.width / rootWidth : 1;
    const scaleY =
      rootHeight > 0 && bounds.height > 0 ? bounds.height / rootHeight : 1;
    const margin = 8;
    const width = Math.max(
      0,
      Math.min(bounds.width, window.innerWidth - margin * 2),
    );
    const left = Math.max(
      margin,
      Math.min(bounds.left, window.innerWidth - width - margin),
    );
    element.dataset.layoutMaxWidth = `${width / scaleX}px`;
    element.dataset.layoutLeft = `${(left - bounds.left) / scaleX}px`;
    const { appHeaderHeight, footerHeight } = document.documentElement.dataset;
    const topLimit = (Number.parseFloat(appHeaderHeight ?? "") || 0) + margin;
    const bottomLimit =
      window.innerHeight -
      (Number.parseFloat(footerHeight ?? "") || 0) -
      element.offsetHeight * scaleY -
      margin;
    const top = Math.max(
      margin,
      Math.min(Math.max(bounds.top, topLimit), bottomLimit),
    );
    element.dataset.layoutTop = `${(top - bounds.top) / scaleY}px`;
  };
  const itemElement = (root: HTMLElement, id: string): HTMLElement | null => {
    const rowKey = `item:${JSON.stringify(id)}`;
    return (
      root.querySelector(`[data-item-id=${JSON.stringify(id)}]`) ??
      root.querySelector(`[data-viewport-row-key=${JSON.stringify(rowKey)}]`) ??
      root.querySelector(`[data-row-key=${JSON.stringify(rowKey)}]`)
    );
  };
  const rowCache = (list: DragList) => {
    let cache = rowReferenceCaches.get(list);
    if (!cache) {
      const references = list.rowReferences?.() ?? [];
      cache = {
        references,
        byKey: new Map(references.map((row) => [row.rowKey, row.itemId])),
      };
      rowReferenceCaches.set(list, cache);
    }
    return cache;
  };
  const resolveRowReference = (
    list: DragList,
    clientY: number,
    clientX?: number,
  ): string | undefined => {
    const root = list.root();
    if (!root || !list.rowReferences) return undefined;
    const cache = rowCache(list);
    if (!cache.references.length) return undefined;
    const hit =
      clientX === undefined || typeof document.elementFromPoint !== "function"
        ? null
        : document.elementFromPoint(clientX, clientY);
    if (hit && root.contains(hit)) {
      const row = hit.closest<HTMLElement>(
        "[data-viewport-row-key], [data-row-key]",
      );
      const key = row?.dataset.viewportRowKey ?? row?.dataset.rowKey;
      const itemId = key && cache.byKey.get(key);
      if (itemId && key.startsWith("item:")) return itemId;
    }
    if (!cache.elements) {
      // Retained rows keep these public wrappers while their controls are absent.
      // Rebuild identities only after row mounts change; geometry stays live.
      const elements = new Map<string, HTMLElement>();
      root
        .querySelectorAll<HTMLElement>(
          "[data-viewport-row-key], [data-row-key]",
        )
        .forEach((element) => {
          const key = element.dataset.viewportRowKey ?? element.dataset.rowKey;
          if (key && !elements.has(key)) elements.set(key, element);
        });
      cache.elements = cache.references.flatMap((row) => {
        const element = elements.get(row.rowKey);
        return element ? [{ itemId: row.itemId, element }] : [];
      });
    }
    const rows = cache.elements;
    if (!rows.length) return undefined;
    // Canonical row tops follow display order, including nested group headers.
    // Read only the search path and its adjacent boundaries on each hover.
    let first = 0;
    let end = rows.length;
    while (first < end) {
      const middle = (first + end) >>> 1;
      if (rows[middle].element.getBoundingClientRect().top <= clientY)
        first = middle + 1;
      else end = middle;
    }
    const previous = rows[first - 1];
    const next = rows[first];
    const previousRect = previous?.element.getBoundingClientRect();
    const nextRect = next?.element.getBoundingClientRect();
    if (previousRect && previousRect.bottom > previousRect.top) {
      if (
        clientY <= previousRect.bottom ||
        !nextRect ||
        clientY - previousRect.bottom <= nextRect.top - clientY
      )
        return previous.itemId;
    }
    return nextRect && nextRect.bottom > nextRect.top ? next.itemId : undefined;
  };
  const visitElements = (
    list: DragList,
    layout: ShoppingDragLayout,
    id: string,
  ): { first: HTMLElement; last: HTMLElement } | null => {
    const root = list.root();
    const item = layout.itemsById.get(id);
    if (!root || !item) return null;
    const key = buildExecutionPlacementVisitKey(
      item,
      shoppingPlacementContext(list.presentation),
    );
    const visit = layout.visitsByKey.get(key);
    if (!visit) return null;
    if (list.presentation.spaceGroups) {
      const headingById = root.querySelector<HTMLElement>(
        `[data-shopping-drag-reference-id=${JSON.stringify(visit.itemIds[0])}]`,
      );
      const headingOwner = headingById?.closest<HTMLElement>(
        "[data-viewport-row-key], [data-row-key]",
      );
      if (headingOwner) return { first: headingOwner, last: headingOwner };
      const groupKey = list.groupKeyForItem?.(item);
      const rowKey = groupKey && `group:${JSON.stringify(groupKey)}`;
      const layoutOwner = rowKey
        ? (root.querySelector<HTMLElement>(
            `[data-viewport-row-key=${JSON.stringify(rowKey)}]`,
          ) ??
          root.querySelector<HTMLElement>(
            `[data-row-key=${JSON.stringify(rowKey)}]`,
          ))
        : null;
      if (layoutOwner) return { first: layoutOwner, last: layoutOwner };
      const first = itemElement(root, visit.itemIds[0]);
      const group = first?.closest<HTMLElement>('[data-row-key^="group:"]');
      if (group) return { first: group, last: group };
      // Expanded headers do not expose an item ID; their stable visit ID identifies the owner.
      const heading = groupKey
        ? root.querySelector<HTMLElement>(
            `[data-space-group-key=${JSON.stringify(groupKey)}]`,
          )
        : null;
      const owner = heading?.closest<HTMLElement>("[data-row-key]");
      if (owner) return { first: owner, last: owner };
    }
    const first = itemElement(root, visit.itemIds[0]);
    const last = itemElement(root, visit.itemIds.at(-1)!);
    return first && last ? { first, last } : null;
  };
  const decorate = (
    list: DragList,
    key: string,
    text: string,
    lines: readonly {
      element: HTMLElement;
      edge: "before" | "after";
      kind: string;
    }[],
  ) => {
    if (
      key === decorationKey &&
      decorations.every((element) => element.isConnected)
    )
      return;
    clearDecorations();
    decorationKey = key;
    const root = list.root();
    if (!root) return;
    ownDecorationPosition(root);
    const status = document.createElement("div");
    status.setAttribute("role", "status");
    status.dataset.shoppingDragStatus = accepted ? "accepted" : "rejected";
    status.className =
      "esp-shopping-drag-status absolute z-40 rounded bg-blue-100 px-3 py-2 text-sm text-blue-950 pointer-events-none";
    status.textContent = text;
    root.prepend(status);
    decorations.push(status);
    dragStatus = { root, element: status };
    positionStatus();
    lines.forEach(({ element, edge, kind }) => {
      const line = document.createElement("div");
      line.dataset.shoppingDragGuide = kind;
      line.dataset.shoppingDragBoundary = edge;
      line.className = `absolute left-0 right-0 h-1.5 bg-blue-500 rounded-full z-30 pointer-events-none ${edge === "before" ? "top-0" : "bottom-0"}`;
      ownDecorationPosition(element);
      element.append(line);
      decorations.push(line);
    });
  };
  const refreshHover = (
    ...args: Parameters<ShoppingDragWorkspace["hover"]>
  ) => {
    const previous = refreshing;
    refreshing = true;
    try {
      return workspace.hover(...args);
    } finally {
      refreshing = previous;
    }
  };
  const workspace: ShoppingDragWorkspace = {
    active: () => active,
    moveContext(target) {
      if (!active) return undefined;
      const context = active.context;
      return {
        ...context,
        targetColumn: target,
        effectiveIds:
          target === "candidate" && context.sourceColumn === "candidate"
            ? context.requestedIds
            : context.effectiveIds,
      };
    },
    register(column, list) {
      lists.set(column, list);
      layoutCache = null;
      if (column === "candidate") candidateNavigation = null;
      if (hoverPoint?.column === column && active)
        workspace.hover(column, hoverPoint.id, hoverPoint.y, hoverPoint.x);
      return () => {
        if (lists.get(column) !== list) return;
        lists.delete(column);
        if (active?.context.sourceColumn === column)
          workspace.clear(active.context.token);
        else {
          accepted = null;
          clearDecorations();
        }
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(active !== null);
      return () => {
        listeners.delete(listener);
      };
    },
    start(column, dragId, requestedIds, operation) {
      workspace.clear();
      reportRejection("");
      const list = lists.get(column);
      if (!list) return null;
      const visibleIds = new Set(list.items.map((item) => item.id));
      const sourceItems = (
        column === "execute"
          ? rawExecuteItems(list)
          : (list.sourceItems ?? list.items)
      ).filter((item) => visibleIds.has(item.id));
      const plan = buildMovePlan({
        requestedIds,
        sourceOrderedIds: sourceItems.map((item) => item.id),
        allItems: sourceItems,
        dayName: day,
        expansionPolicy: "exact",
      });
      if (!plan.effective.includes(dragId)) return null;
      const ids = new Set(plan.effective);
      const requested = sourceItems.filter((item) => ids.has(item.id));
      const unresolved = requested.find((item) => {
        const membership = projectedMembership(item);
        return (
          membership &&
          (membership.status === "confirmation-required" ||
            membership.status === "map-selection-required")
        );
      });
      if (unresolved) {
        reportRejection(
          "所属の確認が必要です。品目の編集画面で所属を確認してから、もう一度ドラッグしてください。",
        );
        list.resolveMembership?.(unresolved.id);
        return null;
      }
      const placementContext = shoppingPlacementContext(list.presentation);
      const visitKeys = new Set(
        requested.map((item) =>
          buildExecutionPlacementVisitKey(item, placementContext),
        ),
      );
      const moving = sourceItems.filter((item) =>
        visitKeys.has(buildExecutionPlacementVisitKey(item, placementContext)),
      );
      rejectionReason = shoppingDragHasSingleGroup(requested, list.presentation)
        ? ""
        : "異なるホール・優先度の品目をまとめてドラッグできません。同じ所属・優先度で選び直してください。";
      if (rejectionReason) reportRejection(rejectionReason);
      const token = Symbol("shopping-drag");
      const context: ShoppingDragMoveContext = {
        token,
        eventName,
        day,
        generation,
        sourceColumn: column,
        requestedIds: plan.requested,
        effectiveIds: moving.map((item) => item.id),
        sourceVisits: projectExecutionPlacementVisits(
          moving,
          placementContext,
        ).map((visit) => ({
          key: visit.key,
          ids: visit.itemIds,
        })),
        operation,
        isCurrent: () => active?.context.token === token,
      };
      active = { context, dragId, moving, requested };
      const candidates = lists.get("candidate");
      if (candidates)
        candidateNavigation = prepareCandidateNavigation(candidates);
      const target = lists.get("execute");
      if (target)
        layoutCache = {
          list: target,
          layout: buildShoppingDragLayout(
            rawExecuteItems(target),
            target.presentation,
          ),
        };
      if (typeof MutationObserver === "function") {
        layoutObserver = new MutationObserver((records) => {
          for (const record of records) {
            const changedRows = [
              ...record.addedNodes,
              ...record.removedNodes,
            ].some(
              (node) =>
                node instanceof Element &&
                (node.matches("[data-viewport-row-key], [data-row-key]") ||
                  node.querySelector(
                    "[data-viewport-row-key], [data-row-key]",
                  )),
            );
            if (!changedRows || !(record.target instanceof Element)) continue;
            const root = record.target.closest<HTMLElement>(
              "[data-shopping-drag-column]",
            );
            const column = root?.dataset.shoppingDragColumn as
              | ShoppingDragColumn
              | undefined;
            const list = column && lists.get(column);
            if (list) rowCache(list).elements = undefined;
          }
          workspace.refresh();
        });
        lists.forEach((entry) => {
          const root = entry.root();
          if (root)
            layoutObserver?.observe(root, { childList: true, subtree: true });
        });
      }
      listeners.forEach((listener) => listener(true));
      return token;
    },
    hover(column, targetId, clientY, clientX) {
      if (!active) return false;
      if (
        guidedPoint &&
        !refreshing &&
        (Math.abs(clientY - guidedPoint.y) > 1 ||
          (clientX !== undefined &&
            guidedPoint.x !== undefined &&
            Math.abs(clientX - guidedPoint.x) > 1))
      )
        guidedPoint = null;
      hitTestRejected = false;

      const list = lists.get(column);
      targetId ??= list && resolveRowReference(list, clientY, clientX);
      hoverPoint = { column, id: targetId, y: clientY, x: clientX };
      accepted = null;
      if (!list?.root()) {
        clearDecorations();
        return true;
      }
      if (rejectionReason) {
        decorate(list, "mixed-group", rejectionReason, []);
        return true;
      }
      if (column === "candidate") {
        highlightMoving(
          active.context.sourceColumn === column
            ? active.requested
            : active.moving,
        );
        if (candidateNavigation?.list !== list)
          candidateNavigation = prepareCandidateNavigation(list);
        let hoverId = targetId ?? "__END_OF_LIST__";
        if (targetId) {
          const index = candidateNavigation.index.get(targetId);
          const element = itemElement(list.root()!, targetId);
          if (index === undefined || !element) {
            decorate(
              list,
              "candidate-rejected",
              "この位置には戻せません。表示中の候補列を選んでください。",
              [],
            );
            return true;
          }
          const rect = element.getBoundingClientRect();
          if (
            !element.hasAttribute("data-space-group-key") &&
            clientY >= (rect.top + rect.bottom) / 2
          )
            hoverId = candidateNavigation.ids[index + 1] ?? "__END_OF_LIST__";
        }
        accepted = {
          column,
          hoverId,
          context: {
            ...active.context,
            targetColumn: column,
            sourceVisits: projectExecutionPlacementVisits(
              active.context.sourceColumn === column
                ? active.requested
                : active.moving,
              shoppingPlacementContext(list.presentation),
            ).map((visit) => ({ key: visit.key, ids: visit.itemIds })),
            effectiveIds:
              active.context.sourceColumn === column
                ? active.requested.map((item) => item.id)
                : active.moving.map((item) => item.id),
          },
        };
        decorate(
          list,
          `candidate:${list.candidateNumberSort}`,
          list.candidateNumberSort === null
            ? "候補列へ戻します。ブロック・番号順で表示します。"
            : "候補列へ戻します。移動後の配列順で表示します。",
          [],
        );
        return true;
      }
      const placementContext = shoppingPlacementContext(list.presentation);
      const sourceIsExecute =
        active.context.sourceColumn === "execute" && column === "execute";
      const reference =
        targetId && list.items.find((item) => item.id === targetId);
      const isBookReorder = Boolean(
        sourceIsExecute &&
        active.context.operation !== "space-group" &&
        reference &&
        active.requested.every(
          (item) =>
            buildExecutionPlacementVisitKey(item, placementContext) ===
            buildExecutionPlacementVisitKey(reference, placementContext),
        ),
      );
      const moving = isBookReorder ? active.requested : active.moving;
      highlightMoving(moving);
      if (layoutCache?.list !== list || layoutCache.moving !== moving) {
        const ids = new Set(
          sourceIsExecute ? moving.map((item) => item.id) : [],
        );
        layoutCache = {
          list,
          moving,
          layout: buildShoppingDragLayout(
            rawExecuteItems(list).filter((item) => !ids.has(item.id)),
            list.presentation,
            isBookReorder
              ? list.items.filter((item) => !ids.has(item.id))
              : undefined,
          ),
        };
      }
      const layout = layoutCache.layout;
      const elements = targetId
        ? isBookReorder
          ? (() => {
              const element = itemElement(list.root()!, targetId);
              return element ? { first: element, last: element } : null;
            })()
          : visitElements(list, layout, targetId)
        : null;
      const firstRect = elements?.first.getBoundingClientRect();
      const lastRect = elements?.last.getBoundingClientRect();
      const boundary = targetId
        ? firstRect &&
          lastRect &&
          clientY < (firstRect.top + lastRect.bottom) / 2
          ? "before"
          : "after"
        : "end";
      const placement = targetId
        ? isBookReorder
          ? resolveShoppingBookPlacement(
              layout,
              moving,
              targetId,
              boundary === "end" ? "after" : boundary,
            )
          : resolveShoppingDragPlacement(layout, moving, targetId, boundary)
        : layoutCache.columnPlacement === undefined
          ? (layoutCache.columnPlacement = resolveShoppingDragColumnPlacement(
              layout,
              moving,
            ))
          : layoutCache.columnPlacement;
      const mergeOnly =
        placement &&
        placement.positionedIds.length === 0 &&
        placement.mergeTargetIds.length > 0;
      const referenceKey =
        reference &&
        buildExecutionPlacementVisitKey(reference, placementContext);
      const referenceRange = referenceKey
        ? layout.ranges.get(referenceKey)
        : undefined;
      const pointerSlot = referenceRange
        ? boundary === "before"
          ? referenceRange.first
          : referenceRange.last + 1
        : layout.items.length;
      // Existing joins have fixed tails. Any valid position in the same placement
      // group accepts that real merge; a corrective guide remains provisional.
      const validMergeHover =
        !mergeOnly || isShoppingDragGroupSlot(layout, moving[0], pointerSlot);
      const tail = layout.items.at(-1);
      const tailElements = tail ? visitElements(list, layout, tail.id) : null;
      const validBlank = Boolean(
        targetId ||
        layout.items.length === 0 ||
        (placement &&
          placement.insertVisitIndex === layout.visits.length &&
          tailElements &&
          clientY >= tailElements.last.getBoundingClientRect().bottom),
      );
      if (!placement || !validMergeHover || !validBlank || guidedPoint) {
        guidedPoint ??= { x: clientX, y: clientY };
        const suggestion =
          layoutCache.columnPlacement === undefined
            ? (layoutCache.columnPlacement = resolveShoppingDragColumnPlacement(
                layout,
                moving,
              ))
            : layoutCache.columnPlacement;
        const target =
          suggestion?.mergeTargetIds[0] ??
          (suggestion &&
            layout.visits[suggestion.insertVisitIndex - 1]?.itemIds.at(-1)) ??
          (suggestion &&
            layout.visits[suggestion.insertVisitIndex]?.itemIds[0]);
        if (target && guidedTarget !== target) {
          guidedTarget = target;
          list.reveal?.(target);
        }
        const guideBefore = Boolean(
          suggestion &&
          !suggestion.mergeTargetIds.length &&
          suggestion.insertVisitIndex === 0,
        );
        const destination = target ? visitElements(list, layout, target) : null;
        decorate(
          list,
          `guide:${target ?? "none"}`,
          suggestion
            ? `${suggestion.mergeVisits.length ? `既存の${suggestion.mergeVisits.length}訪問の末尾へ合流します。${!destination || destination.last.getBoundingClientRect().top > window.innerHeight || destination.last.getBoundingClientRect().bottom < 0 ? "画面外の合流先を含みます。" : ""}` : ""}正しい所属・優先度の挿入先へ案内しています。表示された位置へドラッグしてから離してください。`
            : "この境界には移動できません。ホール・優先度のまとまりを維持できる位置を選んでください。",
          destination
            ? [
                {
                  element: guideBefore ? destination.first : destination.last,
                  edge: guideBefore ? "before" : "after",
                  kind: "suggestion",
                },
              ]
            : [],
        );
        return true;
      }
      guidedTarget = "";
      accepted = {
        column,
        hoverId: placement.anchorId,
        context: {
          ...active.context,
          targetColumn: column,
          effectiveIds: moving.map((item) => item.id),
          sourceVisits: projectExecutionPlacementVisits(
            moving,
            placementContext,
          ).map((visit) => ({ key: visit.key, ids: visit.itemIds })),
          placement,
        },
      };
      const lines: {
        element: HTMLElement;
        edge: "before" | "after";
        kind: string;
      }[] = [];
      let offscreen = false;
      if (placement.positionedIds.length > 0) {
        if (elements)
          lines.push({
            element: boundary === "before" ? elements.first : elements.last,
            edge: boundary === "before" ? "before" : "after",
            kind: "insert",
          });
        else if (placement.hallTailInsertions)
          placement.hallTailInsertions.forEach((insertion) => {
            const previousKey =
              layout.displayVisitKeys[insertion.insertVisitIndex - 1];
            const previousId =
              previousKey &&
              layout.visitsByKey.get(previousKey)?.itemIds.at(-1);
            const destination = previousId
              ? visitElements(list, layout, previousId)
              : null;
            if (previousId && !destination) {
              offscreen = true;
              return;
            }
            if (destination) {
              const rect = destination.last.getBoundingClientRect();
              if (rect.bottom < 0 || rect.top > window.innerHeight)
                offscreen = true;
            }
            lines.push({
              element: destination?.last ?? list.root()!,
              edge: "after",
              kind: "insert",
            });
          });
        else
          lines.push({ element: list.root()!, edge: "after", kind: "insert" });
      }
      placement.mergeTargetIds.forEach((id) => {
        const row = list.presentation.spaceGroups
          ? null
          : itemElement(list.root()!, id);
        const destination = row
          ? { first: row, last: row }
          : visitElements(list, layout, id);
        if (!destination) {
          offscreen = true;
          return;
        }
        const rect = destination.last.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) offscreen = true;
        lines.push({ element: destination.last, edge: "after", kind: "merge" });
      });
      const text =
        placement.mergeTargetIds.length > 0
          ? `${placement.positionedIds.length > 0 ? (placement.hallTailInsertions ? "新しい訪問を所属ホール・優先度の末尾へ挿入し、" : "新しい訪問を境界へ挿入し、") : ""}既存の${placement.mergeVisits.length}訪問の末尾へ合流します。${offscreen ? "画面外の合流先を含みます。" : ""}`
          : placement.hallTailInsertions
            ? `所属ホール・優先度の末尾へ移動します。${offscreen ? "画面外の挿入先を含みます。" : ""}`
            : "表示した訪問境界へ移動します。";
      decorate(
        list,
        JSON.stringify([
          placement.anchorId,
          boundary,
          placement.positionedIds,
          placement.mergeTargetIds,
          offscreen,
        ]),
        `${moving.length}件を移動します。${text}`,
        lines,
      );
      return true;
    },
    refresh() {
      if (!active || !hoverPoint) return;
      positionStatus();
      const point = hoverPoint;
      const element =
        point.x === undefined || typeof document.elementFromPoint !== "function"
          ? null
          : document.elementFromPoint(point.x, point.y);
      const root = element?.closest<HTMLElement>(
        "[data-shopping-drag-column], [data-shopping-drag-surface]",
      );
      if (root) {
        const column = (root.dataset.shoppingDragColumn ??
          root.dataset.shoppingDragSurface) as ShoppingDragColumn;
        const reference = element?.closest<HTMLElement>(
          "[data-item-id], [data-shopping-drag-reference-id]",
        );
        refreshHover(
          column,
          reference?.dataset.itemId ??
            reference?.dataset.shoppingDragReferenceId,
          point.y,
          point.x,
        );
      } else if (
        point.x === undefined ||
        typeof document.elementFromPoint !== "function"
      )
        refreshHover(point.column, point.id, point.y);
      else {
        hitTestRejected = true;
        accepted = null;
        clearDecorations();
      }
    },
    drop(column) {
      if (!active) return;
      if (rejectionReason) {
        reportRejection(rejectionReason);
        workspace.clear(active.context.token);
        return;
      }
      if (hitTestRejected) {
        workspace.clear(active.context.token);
        return;
      }
      workspace.refresh();
      if (hitTestRejected) {
        workspace.clear(active.context.token);
        return;
      }
      const point = hoverPoint;
      if (!point || point.column !== column) {
        reportRejection(
          "配置先を確認できませんでした。品目は移動していません。有効な位置でもう一度ドラッグしてください。",
        );
        workspace.clear(active.context.token);
        return;
      }
      workspace.hover(column, point.id, point.y, point.x);
      const target = accepted;
      const source = active;
      if (!target)
        reportRejection(
          "配置先を確認できませんでした。品目は移動していません。有効な位置でもう一度ドラッグしてください。",
        );
      if (target?.column === column)
        lists
          .get(column)
          ?.move(
            source.dragId,
            target.hoverId,
            column,
            source.context.sourceColumn,
            target.context,
          );
      workspace.clear(source.context.token);
    },
    leave() {
      hitTestRejected = true;
      accepted = null;
      hoverPoint = null;
      clearDecorations();
    },
    clear(token) {
      if (token && active?.context.token !== token) return;
      const wasActive = active !== null;
      layoutObserver?.disconnect();
      layoutObserver = null;
      active = null;
      hitTestRejected = false;
      accepted = null;
      hoverPoint = null;
      layoutCache = null;
      candidateNavigation = null;
      rejectionReason = "";
      guidedTarget = "";
      guidedPoint = null;
      refreshing = false;
      clearHighlights();
      clearDecorations();
      if (wasActive) listeners.forEach((listener) => listener(false));
    },
  };
  return workspace;
}

export function ShoppingDragProvider({
  eventName,
  day,
  generation,
  onPlacementRejected,
  children,
}: {
  eventName: string;
  day: string;
  generation: number;
  onPlacementRejected?: (message: string) => void;
  children: React.ReactNode;
}): React.ReactElement {
  const [rejection, setRejection] = useState<string | null>(null);
  const workspace = useMemo(
    () =>
      createWorkspace(
        eventName,
        day,
        generation,
        onPlacementRejected ?? setRejection,
      ),
    [eventName, day, generation, onPlacementRejected],
  );
  useLayoutEffect(() => {
    const refresh = () => workspace.refresh();
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    return () => {
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
      workspace.clear();
    };
  }, [workspace]);
  return (
    <Context.Provider value={workspace}>
      {children}
      {rejection &&
        ReactDOM.createPortal(
          <div
            role="alert"
            data-shopping-placement-rejection
            className="fixed left-4 right-4 top-20 z-[100] rounded bg-red-700 p-3 text-white shadow-lg"
          >
            {rejection}
            <button
              type="button"
              className="ml-4 underline"
              onClick={() => setRejection(null)}
            >
              閉じる
            </button>
          </div>,
          document.body,
        )}
    </Context.Provider>
  );
}
