import { useLayoutEffect, useRef, type RefObject } from "react";
import {
  clearRuntimeLayoutProperties,
  setRuntimeLayoutProperties,
} from "../styles/runtimeLayoutCompatibility";

interface ViewportBounds {
  top: number;
  height: number;
}

interface Registration {
  applied: ViewportBounds | null;
}

const registrations = new Map<HTMLElement, Registration>();
let observedViewport: VisualViewport | null = null;
let pendingFrame: { id: number } | null = null;

function cancelPendingFrame(): void {
  if (!pendingFrame) return;
  cancelAnimationFrame(pendingFrame.id);
  pendingFrame = null;
}

function readViewportBounds(): ViewportBounds | null {
  if (!observedViewport) return null;
  const { height, offsetTop, scale } = observedViewport;
  const layoutHeight = Math.max(
    window.innerHeight,
    document.documentElement.clientHeight,
  );
  if (
    !Number.isFinite(height) ||
    !Number.isFinite(offsetTop) ||
    !Number.isFinite(scale) ||
    height <= 0 ||
    Math.abs(scale - 1) > 0.01
  )
    return null;
  const top = Math.max(0, offsetTop);
  return top > 0.5 || height < layoutHeight - 0.5 ? { top, height } : null;
}

function synchronize(): void {
  // Read once per synchronization, never measure dialog or item geometry.
  const bounds = readViewportBounds();
  for (const [element, registration] of registrations) {
    const previous = registration.applied;
    if (!bounds) {
      if (previous) clearRuntimeLayoutProperties(element);
      registration.applied = null;
    } else if (
      previous?.top !== bounds.top ||
      previous?.height !== bounds.height
    ) {
      setRuntimeLayoutProperties(element, {
        top: `${bounds.top}px`,
        height: `${bounds.height}px`,
      });
      registration.applied = bounds;
    }
  }
}

function scheduleSynchronization(): void {
  if (pendingFrame) return;
  const frame = { id: 0 };
  pendingFrame = frame;
  frame.id = requestAnimationFrame(() => {
    // A cancelled callback must not affect a later registration.
    if (pendingFrame !== frame) return;
    pendingFrame = null;
    synchronize();
  });
}

function registerViewport(element: HTMLElement): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};

  const registration: Registration = { applied: null };
  registrations.set(element, registration);
  if (!observedViewport) {
    observedViewport = viewport;
    viewport.addEventListener("resize", scheduleSynchronization);
    viewport.addEventListener("scroll", scheduleSynchronization);
  }
  // A newly opened child needs the current keyboard bounds immediately, even
  // when the viewport has not changed since its parent's last synchronization.
  cancelPendingFrame();
  synchronize();

  return () => {
    if (registrations.get(element) !== registration) return;
    registrations.delete(element);
    if (registration.applied) clearRuntimeLayoutProperties(element);
    if (registrations.size > 0) return;
    observedViewport?.removeEventListener("resize", scheduleSynchronization);
    observedViewport?.removeEventListener("scroll", scheduleSynchronization);
    observedViewport = null;
    cancelPendingFrame();
  };
}

/**
 * Use only on a dedicated fixed dialog outer element with no other runtime
 * layout owner. The existing modal focus/ref contract can be passed unchanged.
 */
export function useDialogViewport<T extends HTMLElement = HTMLDivElement>(
  isOpen: boolean,
  viewportRef?: RefObject<T>,
): RefObject<T> {
  const ownedRef = useRef<T>(null);
  const ref = viewportRef ?? ownedRef;
  useLayoutEffect(() => {
    if (!isOpen || !ref.current) return;
    return registerViewport(ref.current);
  }, [isOpen, ref]);
  return ref;
}
