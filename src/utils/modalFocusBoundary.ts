type ModalRestoreTarget = HTMLElement | null | (() => HTMLElement | null);
type ModalOwner = { element: HTMLElement; restore: ModalRestoreTarget };
const owners: ModalOwner[] = [];
let deferredFocus: {
  target: () => HTMLElement | null;
  current: () => boolean;
} | null = null;

export function requestModalSafeFocus(
  target: () => HTMLElement | null,
  current: () => boolean,
) {
  deferredFocus = { target, current };
  if (!owners.length) flushDeferredFocus();
}
function flushDeferredFocus(): boolean {
  if (owners.length || !deferredFocus) return false;
  const request = deferredFocus;
  deferredFocus = null;
  const target = request.target();
  if (!request.current() || !target?.isConnected) return false;
  target.focus({ preventScroll: true });
  return true;
}
export function isTopModal(element: HTMLElement | null) {
  return owners.at(-1)?.element === element;
}
export function registerModalFocus(
  element: HTMLElement,
  restore: ModalRestoreTarget,
  containExternalFocus = false,
) {
  const owner = { element, restore };
  const getRestoreTarget = () => {
    const target = typeof restore === "function" ? restore() : restore;
    return target?.isConnected ? target : null;
  };
  owners.push(owner);
  const containFocus = (event: FocusEvent) => {
    if (
      !isTopModal(element) ||
      element.getAttribute("aria-modal") === "false" ||
      element.contains(event.target as Node)
    )
      return;
    element.focus({ preventScroll: true });
  };
  if (containExternalFocus) document.addEventListener("focusin", containFocus);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    document.removeEventListener("focusin", containFocus);
    const wasTop = isTopModal(element);
    const index = owners.indexOf(owner);
    if (index >= 0) owners.splice(index, 1);
    if (!wasTop) return;
    const parent = owners.at(-1)?.element;
    if (parent) {
      const restoreTarget = getRestoreTarget();
      const target =
        restoreTarget && parent.contains(restoreTarget)
          ? restoreTarget
          : parent;
      target.focus({ preventScroll: true });
      if (!parent.contains(document.activeElement))
        parent.focus({ preventScroll: true });
      return;
    }
    // A new dialog may mount in this same commit. Recheck after its layout effects.
    if (deferredFocus) {
      queueMicrotask(() => {
        if (!owners.length && !flushDeferredFocus())
          getRestoreTarget()?.focus({ preventScroll: true });
      });
    } else getRestoreTarget()?.focus({ preventScroll: true });
  };
}
