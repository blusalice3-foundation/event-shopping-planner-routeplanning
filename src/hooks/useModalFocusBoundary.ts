import { acquireBodyScrollLock } from "../utils/bodyScrollLock";
import { isAppleTouchWebKit } from "../utils/appleTouchWebKit";
import { useEffect, useLayoutEffect, type RefObject } from "react";
import { isTopModal, registerModalFocus } from "../utils/modalFocusBoundary";

/** Registers modal focus and applies the iOS document-position scroll lock. */
export function useModalFocusBoundary({
  isOpen,
  dialogRef,
}: {
  isOpen: boolean;
  dialogRef: RefObject<HTMLElement | null>;
}) {
  useLayoutEffect(() => {
    if (
      !isOpen ||
      !isAppleTouchWebKit() ||
      dialogRef.current?.getAttribute("aria-modal") === "false"
    )
      return;
    return acquireBodyScrollLock({ lockDocumentPosition: true });
  }, [dialogRef, isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const element = dialogRef.current;
    if (!element) return;
    if (!element.hasAttribute("tabindex")) element.tabIndex = -1;
    const restore =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;
    return registerModalFocus(element, restore, true);
  }, [dialogRef, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const element = dialogRef.current;
    let released = false;
    // Existing passive effects may capture the opener and choose initial focus.
    // Wait for all of them before filling a missing initial focus target.
    queueMicrotask(() => {
      if (
        !released &&
        element?.isConnected &&
        isTopModal(element) &&
        element.getAttribute("aria-modal") !== "false" &&
        !element.contains(document.activeElement)
      )
        element.focus({ preventScroll: true });
    });
    return () => {
      released = true;
    };
  }, [dialogRef, isOpen]);
}
