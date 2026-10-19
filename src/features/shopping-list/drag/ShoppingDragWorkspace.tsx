import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
} from "react";
import type { ShoppingItem } from "../../../types/item";
import { getSpaceKey } from "../../../utils/spaceGrouping";
import { buildMovePlan } from "../../lists/domain/movePlan";
import {
  buildExecutionVisitProjectionKey,
  projectItemsToExecutionVisits,
} from "../../../utils/visitProjection";
import {
  buildShoppingDragLayout,
  resolveShoppingDragPlacement,
  type ShoppingDragColumn,
  type ShoppingDragLayout,
  type ShoppingDragMoveContext,
  type ShoppingDragPresentation,
} from "./shoppingDrag";

interface DragList {
  readonly items: readonly ShoppingItem[];
  readonly sourceItems?: readonly ShoppingItem[];
  readonly executeOrder?: readonly string[];
  readonly displayOrder?: () => readonly string[];
  readonly presentation: ShoppingDragPresentation;
  readonly root: () => HTMLDivElement | null;
  readonly move: (
    dragId: string,
    hoverId: string,
    target: ShoppingDragColumn,
    source: ShoppingDragColumn,
    context?: ShoppingDragMoveContext,
  ) => void;
  readonly candidateNumberSort: "asc" | "desc" | null;
}
interface ActiveDrag {
  readonly context: ShoppingDragMoveContext;
  readonly dragId: string;
  readonly moving: readonly ShoppingItem[];
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
): ShoppingDragWorkspace {
  const lists = new Map<ShoppingDragColumn, DragList>();
  const listeners = new Set<(active: boolean) => void>();
  let active: ActiveDrag | null = null;
  let layoutCache: { list: DragList; layout: ShoppingDragLayout } | null = null;
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
  const clearDecorations = () => {
    decorations.splice(0).forEach((element) => element.remove());
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
    element.style.maxWidth = `${width / scaleX}px`;
    element.style.left = `${(left - bounds.left) / scaleX}px`;
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
    element.style.top = `${(top - bounds.top) / scaleY}px`;
  };
  const itemElement = (root: HTMLElement, id: string): HTMLElement | null => {
    const rowKey = `item:${JSON.stringify(id)}`;
    return (
      root.querySelector(`[data-item-id=${JSON.stringify(id)}]`) ??
      root.querySelector(`[data-viewport-row-key=${JSON.stringify(rowKey)}]`) ??
      root.querySelector(`[data-row-key=${JSON.stringify(rowKey)}]`)
    );
  };
  const visitElements = (
    list: DragList,
    layout: ShoppingDragLayout,
    id: string,
  ): { first: HTMLElement; last: HTMLElement } | null => {
    const root = list.root();
    const item = layout.itemsById.get(id);
    if (!root || !item) return null;
    const key = buildExecutionVisitProjectionKey(item);
    const visit = layout.visitsByKey.get(key);
    if (!visit) return null;
    if (list.presentation.spaceGroups) {
      const rowKey = `group:${JSON.stringify(getSpaceGroupKey(item))}`;
      const layoutOwner =
        root.querySelector<HTMLElement>(
          `[data-viewport-row-key=${JSON.stringify(rowKey)}]`,
        ) ??
        root.querySelector<HTMLElement>(
          `[data-row-key=${JSON.stringify(rowKey)}]`,
        );
      if (layoutOwner) return { first: layoutOwner, last: layoutOwner };
      const first = itemElement(root, visit.itemIds[0]);
      const group = first?.closest<HTMLElement>('[data-row-key^="group:"]');
      if (group) return { first: group, last: group };
      // Expanded headers do not expose an item ID; their stable visit ID identifies the owner.
      const heading = root.querySelector<HTMLElement>(
        `[data-space-group-key=${JSON.stringify(getSpaceGroupKey(item))}]`,
      );
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
    root.classList.add("relative");
    const status = document.createElement("div");
    status.setAttribute("role", "status");
    status.dataset.shoppingDragStatus = accepted ? "accepted" : "rejected";
    status.className =
      "absolute top-0 left-0 z-40 rounded bg-blue-100 px-3 py-2 text-sm text-blue-950 pointer-events-none";
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
      element.classList.add("relative");
      element.append(line);
      decorations.push(line);
    });
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
      const list = lists.get(column);
      if (!list) return null;
      const visibleIds = new Set(list.items.map((item) => item.id));
      const sourceItems = (list.sourceItems ?? list.items).filter((item) =>
        visibleIds.has(item.id),
      );
      const plan = buildMovePlan({
        requestedIds,
        sourceOrderedIds: sourceItems.map((item) => item.id),
        allItems: sourceItems,
        dayName: day,
        expansionPolicy: "same-visit",
      });
      if (!plan.effective.includes(dragId)) return null;
      const ids = new Set(plan.effective);
      const moving = sourceItems.filter((item) => ids.has(item.id));
      const token = Symbol("shopping-drag");
      const context: ShoppingDragMoveContext = {
        token,
        eventName,
        day,
        generation,
        sourceColumn: column,
        requestedIds: plan.requested,
        effectiveIds: plan.effective,
        sourceVisits: projectItemsToExecutionVisits(moving).map((visit) => ({
          key: visit.key,
          ids: visit.itemIds,
        })),
        operation,
        isCurrent: () => active?.context.token === token,
      };
      active = { context, dragId, moving };
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
        layoutObserver = new MutationObserver(() => workspace.refresh());
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
      hitTestRejected = false;
      if (active.context.sourceColumn === column) {
        hitTestRejected = true;
        accepted = null;
        hoverPoint = null;
        clearDecorations();
        return false;
      }
      hoverPoint = { column, id: targetId, y: clientY, x: clientX };
      const list = lists.get(column);
      accepted = null;
      if (!list?.root()) {
        clearDecorations();
        return true;
      }
      if (column === "candidate") {
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
          context: { ...active.context, targetColumn: column },
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
      if (layoutCache?.list !== list)
        layoutCache = {
          list,
          layout: buildShoppingDragLayout(
            rawExecuteItems(list),
            list.presentation,
          ),
        };
      const layout = layoutCache.layout;
      const elements = targetId ? visitElements(list, layout, targetId) : null;
      const firstRect = elements?.first.getBoundingClientRect();
      const lastRect = elements?.last.getBoundingClientRect();
      const boundary = targetId
        ? firstRect &&
          lastRect &&
          clientY < (firstRect.top + lastRect.bottom) / 2
          ? "before"
          : "after"
        : "end";
      const placement = resolveShoppingDragPlacement(
        layout,
        active.moving,
        targetId,
        boundary,
      );
      if (!placement) {
        decorate(
          list,
          "rejected",
          "この境界には移動できません。ホール・優先度のまとまりを維持できる位置を選んでください。",
          [],
        );
        return true;
      }
      accepted = {
        column,
        hoverId: placement.anchorId,
        context: { ...active.context, targetColumn: column, placement },
      };
      const lines: {
        element: HTMLElement;
        edge: "before" | "after";
        kind: string;
      }[] = [];
      if (placement.positionedIds.length > 0) {
        if (elements)
          lines.push({
            element: boundary === "before" ? elements.first : elements.last,
            edge: boundary === "before" ? "before" : "after",
            kind: "insert",
          });
        else
          lines.push({ element: list.root()!, edge: "after", kind: "insert" });
      }
      let offscreen = false;
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
          ? `${placement.positionedIds.length > 0 ? "新しい訪問を境界へ挿入し、" : ""}既存の${placement.mergeVisits.length}訪問の末尾へ合流します。${offscreen ? "画面外の合流先を含みます。" : ""}`
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
        text,
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
      const root = element?.closest<HTMLElement>("[data-shopping-drag-column]");
      if (root) {
        const column = root.dataset.shoppingDragColumn as ShoppingDragColumn;
        const reference = element?.closest<HTMLElement>(
          "[data-item-id], [data-shopping-drag-reference-id]",
        );
        workspace.hover(
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
        workspace.hover(point.column, point.id, point.y);
      else {
        hitTestRejected = true;
        accepted = null;
        clearDecorations();
      }
    },
    drop(column) {
      if (!active || active.context.sourceColumn === column) return;
      if (hitTestRejected) {
        workspace.clear(active.context.token);
        return;
      }
      const point = hoverPoint;
      if (point && point.column !== column) return;
      if (!point || point.column !== column)
        workspace.hover(column, undefined, 0);
      else workspace.hover(column, point.id, point.y, point.x);
      const target = accepted;
      const source = active;
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
      clearDecorations();
      if (wasActive) listeners.forEach((listener) => listener(false));
    },
  };
  return workspace;
}
function getSpaceGroupKey(item: ShoppingItem): string {
  const space = getSpaceKey(item.block, item.number);
  // Match the existing space identity normalizer rather than display labels.
  return item.priorityLevel && item.priorityLevel !== "none"
    ? `${space}:${item.priorityLevel}`
    : space;
}
export function ShoppingDragProvider({
  eventName,
  day,
  generation,
  children,
}: {
  eventName: string;
  day: string;
  generation: number;
  children: React.ReactNode;
}): React.ReactElement {
  const workspace = useMemo(
    () => createWorkspace(eventName, day, generation),
    [eventName, day, generation],
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
  return <Context.Provider value={workspace}>{children}</Context.Provider>;
}
