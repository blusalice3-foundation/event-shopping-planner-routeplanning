// Scope native default cancellation to one already-active custom touch drag.
export function acquireShoppingTouchDragDefaultGuard(
  source: HTMLElement,
  identifier: number,
): () => void {
  if (!source.isConnected || !Number.isFinite(identifier)) return () => {};
  const owner = source.ownerDocument;
  let released = false;
  const handleMove = (event: TouchEvent) => {
    if (
      released ||
      !source.isConnected ||
      !event.cancelable ||
      event.defaultPrevented ||
      event.touches.length !== 1 ||
      event.changedTouches.length !== 1
    )
      return;
    const active = event.touches[0];
    const changed = event.changedTouches[0];
    if (
      active.identifier !== identifier ||
      changed.identifier !== identifier ||
      !(event.target instanceof Node) ||
      !source.contains(event.target) ||
      !(changed.target instanceof Node) ||
      !source.contains(changed.target)
    )
      return;
    event.preventDefault();
  };
  owner.addEventListener("touchmove", handleMove, {
    capture: true,
    passive: false,
  });
  return () => {
    if (released) return;
    released = true;
    owner.removeEventListener("touchmove", handleMove, true);
  };
}
