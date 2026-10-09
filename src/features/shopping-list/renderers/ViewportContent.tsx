import React, { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

const REVEAL_EVENT = "esp-reveal-viewport-content";
export const VIEWPORT_RETENTION_EVENT = "esp-viewport-retention-change";
const PRELOAD_MARGIN_PX = 500;
interface Subscription {
  visible: boolean;
  update(): void;
  resetHeight(): void;
}
interface ViewportRegistry {
  observer: IntersectionObserver;
  subscribers: Map<Element, Subscription>;
  visibility: WeakMap<Element, boolean>;
  listSizes: Map<HTMLElement, number>;
  sizeObserver?: ResizeObserver;
  requestedKeys: Map<string, number>;
  initialOffsets: WeakMap<
    Element,
    { top: number; offset: number; width: number }
  >;
  printing: boolean;
  backwardTab: boolean;
  keyDown: (event: KeyboardEvent) => void;
  focusOut: () => void;
  beforePrint: () => void;
  afterPrint: () => void;
}
const registries = new WeakMap<Document, ViewportRegistry>();
// Height retention outlives observer subscriptions. Bound it across long sessions.
const heightCaches = new WeakMap<Document, Map<string, number>>();
const heightKey = (root: HTMLElement, rowKey: string, layoutKey: string) =>
  JSON.stringify([
    rowKey,
    root.closest<HTMLElement>("[data-list-renderer], [data-viewport-list]")
      ?.dataset.viewportWidth,
    layoutKey,
    root.ownerDocument.defaultView?.innerWidth,
    root.ownerDocument.defaultView?.visualViewport?.scale ?? 1,
    root.ownerDocument.defaultView?.devicePixelRatio ?? 1,
  ]);
const heightCache = (document: Document) => {
  let cache = heightCaches.get(document);
  if (!cache) heightCaches.set(document, (cache = new Map()));
  return cache;
};
function initiallyVisible(
  root: HTMLElement,
  registry: ViewportRegistry,
  height: number,
): boolean {
  const parent =
    root.closest<HTMLElement>("[data-viewport-list]") ?? root.parentElement;
  if (!parent || !root.closest("[data-list-renderer], [data-viewport-list]"))
    return withinViewport(root);
  let position = registry.initialOffsets.get(parent);
  if (!position) {
    const rect = parent.getBoundingClientRect();
    position = { top: rect.top, offset: 0, width: rect.width };
    registry.initialOffsets.set(parent, position);
  }
  const top = position.top + position.offset;
  position.offset += height;
  const bottom =
    (root.ownerDocument.defaultView?.innerHeight ?? 0) + PRELOAD_MARGIN_PX;
  return (
    top + height >= -PRELOAD_MARGIN_PX && top <= bottom && withinViewport(root)
  );
}
const requestKey = (registry: ViewportRegistry, key: string) =>
  registry.requestedKeys.set(key, (registry.requestedKeys.get(key) ?? 0) + 1);
const releaseKey = (registry: ViewportRegistry, key: string) => {
  const remaining = (registry.requestedKeys.get(key) ?? 0) - 1;
  if (remaining > 0) registry.requestedKeys.set(key, remaining);
  else registry.requestedKeys.delete(key);
};
const withinViewport = (root: Element): boolean => {
  const rect = root.getBoundingClientRect();
  return (
    rect.height > 0 &&
    rect.bottom >= -PRELOAD_MARGIN_PX &&
    rect.top <=
      (root.ownerDocument.defaultView?.innerHeight ?? 0) + PRELOAD_MARGIN_PX
  );
};
const getRegistry = (document: Document): ViewportRegistry => {
  const existing = registries.get(document);
  if (existing) return existing;
  const subscribers = new Map<Element, Subscription>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const subscription = subscribers.get(entry.target);
        if (!subscription) continue;
        subscription.visible = entry.isIntersecting;
        registry.visibility.set(entry.target, entry.isIntersecting);
        subscription.update();
      }
    },
    { rootMargin: PRELOAD_MARGIN_PX + "px" },
  );
  const registry: ViewportRegistry = {
    observer,
    subscribers,
    visibility: new WeakMap(),
    listSizes: new Map(),
    requestedKeys: new Map(),
    initialOffsets: new WeakMap(),
    printing: false,
    backwardTab: false,
    keyDown: (event) => {
      if (event.key === "Tab") registry.backwardTab = event.shiftKey;
    },
    focusOut: () =>
      queueMicrotask(() => {
        for (const [root, subscription] of subscribers) {
          if (
            !subscription.visible &&
            root.getAttribute("data-viewport-active") === "true"
          )
            subscription.update();
        }
      }),
    beforePrint: () => {
      registry.printing = true;
      flushSync(() => {
        for (const subscription of subscribers.values()) subscription.update();
      });
    },
    afterPrint: () => {
      registry.printing = false;
      for (const [root, subscription] of subscribers) {
        subscription.visible = withinViewport(root);
        subscription.update();
      }
    },
  };
  if (typeof ResizeObserver === "function")
    registry.sizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const list = entry.target as HTMLElement;
        const width = String(entry.contentRect.width);
        if (list.dataset.viewportWidth === width) continue;
        list.dataset.viewportWidth = width;
        for (const [root, subscription] of subscribers)
          if (
            root.closest("[data-list-renderer], [data-viewport-list]") === list
          )
            subscription.resetHeight();
      }
    });
  document.addEventListener("keydown", registry.keyDown, true);
  document.addEventListener("focusout", registry.focusOut, true);
  document.defaultView?.addEventListener("beforeprint", registry.beforePrint);
  document.defaultView?.addEventListener("afterprint", registry.afterPrint);
  registries.set(document, registry);
  return registry;
};

/** Reveal deferred ancestors before scrolling; release the temporary pin afterwards. */
export const revealViewportContent = (element: HTMLElement): void => {
  const registry = registries.get(element.ownerDocument);
  if (!registry) return;
  const keys: string[] = [];
  let ancestor: HTMLElement | null = element;
  while (ancestor) {
    const key = ancestor.dataset.viewportRowKey ?? ancestor.dataset.rowKey;
    if (key) {
      requestKey(registry, key);
      keys.push(key);
    }
    ancestor = ancestor.parentElement;
  }
  element.dispatchEvent(new Event(REVEAL_EVENT, { bubbles: true }));
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const key of keys) releaseKey(registry, key);
      for (const [root, subscription] of registry.subscribers) {
        if (keys.includes((root as HTMLElement).dataset.viewportRowKey ?? "")) {
          subscription.visible = withinViewport(root);
          subscription.update();
        }
      }
    }),
  );
};

export const findViewportRow = (
  root: ParentNode | null | undefined,
  key: string,
): HTMLElement | null => {
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(key)
      : key.replace(/["\\]/g, "\\$&");
  return (
    root?.querySelector<HTMLElement>(`[data-row-key="${escaped}"]`) ?? null
  );
};
export const focusPendingViewportContent = (element: HTMLElement): void => {
  const document = element.ownerDocument;
  const key = element.closest<HTMLElement>("[data-row-key]")?.dataset.rowKey;
  const backward = registries.get(document)?.backwardTab ?? false;
  const root =
    element.closest<HTMLElement>("[data-list-renderer]") ??
    document.documentElement;
  flushSync(() => revealViewportContent(element));
  const row = key ? findViewportRow(root, key) : null;
  const targets = [
    ...(row?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ) ?? []),
  ].filter((target) => !target.hasAttribute("data-viewport-focus-sentinel"));
  (backward ? targets[targets.length - 1] : targets[0])?.focus();
};
export interface ViewportContentProps {
  readonly rowKey: string;
  readonly defer?: boolean;
  readonly retain?: boolean;
  readonly estimatedHeight?: number;
  readonly layoutKey?: string;
  readonly placeholder: React.ReactNode;
  readonly render: () => React.ReactNode;
}
export const ViewportContent = ({
  rowKey,
  defer = true,
  retain = false,
  estimatedHeight = 220,
  layoutKey = "default",
  placeholder,
  render,
}: ViewportContentProps): React.ReactElement => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activated, setActivated] = useState(
    !defer || retain || typeof IntersectionObserver !== "function",
  );
  const heightRef = useRef<number>();
  const [, setHeightRevision] = useState(0);
  const updateRef = useRef<() => void>();
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (typeof IntersectionObserver !== "function") {
      setActivated(true);
      return;
    }
    const registry = getRegistry(root.ownerDocument);
    const list = root.closest<HTMLElement>(
      "[data-list-renderer], [data-viewport-list]",
    );
    if (list && !registry.listSizes.has(list)) {
      list.dataset.viewportWidth = String(list.getBoundingClientRect().width);
      registry.sizeObserver?.observe(list);
    }
    if (list)
      registry.listSizes.set(list, (registry.listSizes.get(list) ?? 0) + 1);
    const cachedHeight = heightCache(root.ownerDocument).get(
      heightKey(root, rowKey, layoutKey),
    );
    if (heightRef.current !== cachedHeight) {
      heightRef.current = cachedHeight;
      if (cachedHeight !== undefined)
        setHeightRevision((revision) => revision + 1);
    }
    const subscription: Subscription = {
      resetHeight: () => {
        heightRef.current = heightCache(root.ownerDocument).get(
          heightKey(root, rowKey, layoutKey),
        );
        setHeightRevision((revision) => revision + 1);
      },
      visible:
        registry.visibility.get(root) ??
        initiallyVisible(root, registry, cachedHeight ?? estimatedHeight),
      update: () => {
        const pinned =
          root.contains(root.ownerDocument.activeElement) ||
          root.dataset.viewportRetain === "true" ||
          root.querySelector('[data-viewport-retain="true"]') !== null;
        const requested =
          registry.requestedKeys.has(rowKey) ||
          [
            ...root.querySelectorAll<HTMLElement>("[data-viewport-row-key]"),
          ].some((child) =>
            registry.requestedKeys.has(child.dataset.viewportRowKey ?? ""),
          );
        setActivated(
          !defer ||
            retain ||
            registry.printing ||
            subscription.visible ||
            pinned ||
            requested,
        );
      },
    };
    registry.visibility.set(root, subscription.visible);
    updateRef.current = subscription.update;
    registry.subscribers.set(root, subscription);
    registry.observer.observe(root);
    root.addEventListener(REVEAL_EVENT, subscription.update);
    root.addEventListener(VIEWPORT_RETENTION_EVENT, subscription.update);
    subscription.update();
    return () => {
      root.removeEventListener(REVEAL_EVENT, subscription.update);
      root.removeEventListener(VIEWPORT_RETENTION_EVENT, subscription.update);
      registry.observer.unobserve(root);
      registry.subscribers.delete(root);
      if (list) {
        const count = (registry.listSizes.get(list) ?? 1) - 1;
        if (count > 0) registry.listSizes.set(list, count);
        else {
          registry.listSizes.delete(list);
          registry.sizeObserver?.unobserve(list);
        }
      }
      if (!registry.subscribers.size) {
        registry.observer.disconnect();
        registry.sizeObserver?.disconnect();
        root.ownerDocument.removeEventListener(
          "keydown",
          registry.keyDown,
          true,
        );
        root.ownerDocument.removeEventListener(
          "focusout",
          registry.focusOut,
          true,
        );
        root.ownerDocument.defaultView?.removeEventListener(
          "beforeprint",
          registry.beforePrint,
        );
        root.ownerDocument.defaultView?.removeEventListener(
          "afterprint",
          registry.afterPrint,
        );
        registries.delete(root.ownerDocument);
      }
    };
  }, [defer, retain, rowKey, layoutKey, estimatedHeight]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !activated) return;
    const measure = () => {
      const height = root.offsetHeight || root.getBoundingClientRect().height;
      if (height > 0) {
        heightRef.current = height;
        const cache = heightCache(root.ownerDocument);
        const key = heightKey(root, rowKey, layoutKey);
        cache.delete(key);
        cache.set(key, height);
        if (cache.size > 4096) cache.delete(cache.keys().next().value!);
      }
    };
    measure();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(root);
    return () => observer?.disconnect();
  }, [activated, rowKey, layoutKey]);
  const deferredHeight = heightRef.current ?? estimatedHeight;
  return (
    <div
      ref={rootRef}
      data-viewport-row-key={rowKey}
      data-viewport-active={activated ? "true" : "false"}
      onDragStartCapture={() => {
        if (rootRef.current) rootRef.current.dataset.viewportRetain = "true";
      }}
      onDragEndCapture={() => {
        if (rootRef.current) delete rootRef.current.dataset.viewportRetain;
        updateRef.current?.();
      }}
      className={!activated && deferredHeight ? "esp-layout-height" : undefined}
      data-layout-height={
        !activated && deferredHeight ? `${deferredHeight}px` : undefined
      }
    >
      {activated ? render() : placeholder}
    </div>
  );
};

/** Warm at most the current and following visit; leaving the range releases controls. */
export function prewarmViewportContent(element: HTMLElement): () => void {
  const registry = registries.get(element.ownerDocument);
  if (!registry) return () => {};
  const keys: string[] = [];
  let ancestor: HTMLElement | null = element;
  while (ancestor) {
    const key = ancestor.dataset.viewportRowKey;
    if (key) {
      requestKey(registry, key);
      keys.push(key);
    }
    ancestor = ancestor.parentElement;
  }
  element.dispatchEvent(new Event(REVEAL_EVENT, { bubbles: true }));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const key of keys) releaseKey(registry, key);
    for (const [root, subscription] of registry.subscribers)
      if (keys.includes((root as HTMLElement).dataset.viewportRowKey ?? ""))
        subscription.update();
  };
}
