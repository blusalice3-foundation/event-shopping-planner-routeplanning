import React, { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

const REVEAL_EVENT = "esp-reveal-viewport-content";
const PRELOAD_MARGIN_PX = 500;
interface ViewportRegistry {
  observer: IntersectionObserver;
  subscribers: Map<Element, () => void>;
  requestedKeys: Set<string>;
  printing: boolean;
  backwardTab: boolean;
  keyDown: (event: KeyboardEvent) => void;
  beforePrint: () => void;
  afterPrint: () => void;
}
const registries = new WeakMap<Document, ViewportRegistry>();

const getRegistry = (document: Document): ViewportRegistry => {
  const existing = registries.get(document);
  if (existing) return existing;
  const subscribers = new Map<Element, () => void>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) subscribers.get(entry.target)?.();
      }
    },
    { rootMargin: PRELOAD_MARGIN_PX + "px" },
  );
  const registry: ViewportRegistry = {
    observer,
    subscribers,
    requestedKeys: new Set<string>(),
    printing: false,
    backwardTab: false,
    keyDown: (event) => {
      if (event.key === "Tab") registry.backwardTab = event.shiftKey;
    },
    beforePrint: () => {
      registry.printing = true;
      flushSync(() => {
        for (const activate of [...subscribers.values()]) activate();
      });
    },
    afterPrint: () => {
      registry.printing = false;
    },
  };
  document.addEventListener("keydown", registry.keyDown, true);
  document.defaultView?.addEventListener("beforeprint", registry.beforePrint);
  document.defaultView?.addEventListener("afterprint", registry.afterPrint);
  registries.set(document, registry);
  return registry;
};

/** Reveal both an offscreen target and its deferred ancestors before navigation. */
export const revealViewportContent = (element: HTMLElement): void => {
  const registry = registries.get(element.ownerDocument);
  if (!registry) return;
  let ancestor: HTMLElement | null = element;
  while (ancestor) {
    const key = ancestor.dataset.rowKey;
    if (key) registry.requestedKeys.add(key);
    ancestor = ancestor.parentElement;
  }
  element.dispatchEvent(new Event(REVEAL_EVENT, { bubbles: true }));
};

/** A placeholder occupies the next native tab position until its controls exist. */
export const focusPendingViewportContent = (element: HTMLElement): void => {
  const document = element.ownerDocument;
  const key = element.closest<HTMLElement>("[data-row-key]")?.dataset.rowKey;
  const backward = registries.get(document)?.backwardTab ?? false;
  const root =
    element.closest<HTMLElement>("[data-list-renderer]") ??
    document.documentElement;
  flushSync(() => revealViewportContent(element));
  const row = [...root.querySelectorAll<HTMLElement>("[data-row-key]")].find(
    (candidate) => candidate.dataset.rowKey === key,
  );
  const targets = [
    ...(row?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ) ?? []),
  ].filter((target) => !target.hasAttribute("data-viewport-focus-sentinel"));
  const target = backward ? targets[targets.length - 1] : targets[0];
  target?.focus();
};

export interface ViewportContentProps {
  readonly rowKey: string;
  readonly defer?: boolean;
  readonly placeholder: React.ReactNode;
  readonly render: () => React.ReactNode;
}

export const ViewportContent = ({
  rowKey,
  defer = true,
  placeholder,
  render,
}: ViewportContentProps): React.ReactElement => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activated, setActivated] = useState(
    () =>
      !defer ||
      (typeof document !== "undefined" &&
        (registries.get(document)?.printing ||
          registries.get(document)?.requestedKeys.has(rowKey) ||
          false)),
  );
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || activated) return;
    const registry = getRegistry(root.ownerDocument);
    const activate = () => {
      registry.observer.unobserve(root);
      setActivated(true);
    };
    registry.subscribers.set(root, activate);
    registry.observer.observe(root);
    root.addEventListener(REVEAL_EVENT, activate);
    const rect = root.getBoundingClientRect();
    if (
      !defer ||
      registry.printing ||
      registry.requestedKeys.has(rowKey) ||
      (rect.height > 0 &&
        rect.bottom >= -PRELOAD_MARGIN_PX &&
        rect.top <= window.innerHeight + PRELOAD_MARGIN_PX)
    ) {
      activate();
    }

    return () => {
      root.removeEventListener(REVEAL_EVENT, activate);

      registry.observer.unobserve(root);
      registry.subscribers.delete(root);
      if (registry.subscribers.size === 0) {
        registry.observer.disconnect();
        root.ownerDocument.removeEventListener(
          "keydown",
          registry.keyDown,
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
  }, [activated, defer, rowKey]);
  return (
    <div ref={rootRef} data-viewport-row-key={rowKey}>
      {activated ? render() : placeholder}
    </div>
  );
};
