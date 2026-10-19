type ModalRestoreTarget = HTMLElement | null | (() => HTMLElement | null);
type ModalLayer = { element: HTMLElement; zIndex: number };
type ModalOwner = {
  element: HTMLElement;
  restore: ModalRestoreTarget;
  layers: ModalLayer[];
};

// Read styles only when opening a modal, never while handling focus or keys.
function getModalLayers(element: HTMLElement): ModalLayer[] {
  const layers: ModalLayer[] = [];
  for (
    let ancestor: HTMLElement | null = element;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor);
    const hasZIndex = style.zIndex !== "" && style.zIndex !== "auto";
    const positioned = style.position !== "" && style.position !== "static";
    const parentDisplay =
      hasZIndex && !positioned && ancestor.parentElement
        ? getComputedStyle(ancestor.parentElement).display
        : "";
    const nonDefault = (value: string) => Boolean(value) && value !== "none";
    if (
      ancestor === document.documentElement ||
      style.position === "fixed" ||
      style.position === "sticky" ||
      (hasZIndex &&
        (positioned || /^(inline-)?(flex|grid)$/.test(parentDisplay))) ||
      [
        style.transform,
        style.translate,
        style.rotate,
        style.scale,
        style.perspective,
        style.filter,
        style.backdropFilter,
      ].some(nonDefault) ||
      (style.opacity !== "" && Number(style.opacity) < 1) ||
      style.isolation === "isolate" ||
      (style.mixBlendMode !== "" && style.mixBlendMode !== "normal") ||
      /\b(layout|paint|strict|content)\b/.test(style.contain) ||
      /\b(transform|translate|rotate|scale|perspective|filter|opacity)\b/.test(
        style.willChange,
      )
    )
      layers.unshift({
        element: ancestor,
        zIndex: hasZIndex ? Number(style.zIndex) : 0,
      });
  }
  return layers;
}

function compareModalLayers(first: ModalLayer[], second: ModalLayer[]) {
  for (let index = 0; index < Math.max(first.length, second.length); index++) {
    // A high inner z-index cannot escape its enclosing stacking context.
    const firstLayer = first[index];
    const secondLayer = second[index];
    if (firstLayer?.element === secondLayer?.element) continue;
    const difference = (firstLayer?.zIndex ?? 0) - (secondLayer?.zIndex ?? 0);
    if (difference) return difference;
    if (firstLayer && secondLayer) {
      const position = firstLayer.element.compareDocumentPosition(
        secondLayer.element,
      );
      if (position & Node.DOCUMENT_POSITION_DISCONNECTED) return 0;
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    }
    return 0;
  }
  return 0;
}
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
  const owner = { element, restore, layers: getModalLayers(element) };
  const getRestoreTarget = () => {
    const target =
      typeof owner.restore === "function" ? owner.restore() : owner.restore;
    return target?.isConnected ? target : null;
  };
  const index = owners.findIndex(
    (entry) => compareModalLayers(entry.layers, owner.layers) > 0,
  );
  // The same stacking context retains later-registration priority.
  owners.splice(index < 0 ? owners.length : index, 0, owner);
  const coveringOwner = owners.at(-1);
  const restoreTarget = getRestoreTarget();
  if (
    coveringOwner !== owner &&
    restoreTarget &&
    coveringOwner?.element.contains(restoreTarget)
  )
    // The lower dialog did not open the covering dialog; retain its real opener.
    owner.restore = coveringOwner.restore;
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
