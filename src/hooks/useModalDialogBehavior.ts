import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { isTopModal, registerModalFocus } from "../utils/modalFocusBoundary";
import { acquireBodyScrollLock } from "../utils/bodyScrollLock";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const isAvailableFocusTarget = (element: HTMLElement | null) =>
  element?.isConnected &&
  !element.matches(":disabled") &&
  !element.closest('[hidden], [aria-hidden="true"], [inert]');

const getFocusableElements = (container: HTMLElement | null) =>
  container
    ? Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(
        (element) =>
          isAvailableFocusTarget(element) &&
          element.getAttribute("tabindex") !== "-1",
      )
    : [];

type UseModalDialogBehaviorOptions = {
  isOpen: boolean;
  containExternalFocus?: boolean;
  onEscape: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
};

export const useModalDialogBehavior = <T extends HTMLElement = HTMLDivElement>({
  isOpen,
  containExternalFocus = false,
  onEscape,
  initialFocusRef,
  fallbackFocusRef,
}: UseModalDialogBehaviorOptions) => {
  const dialogRef = useRef<T>(null);

  useEffect(() => {
    if (!isOpen) return;
    const releaseBodyScrollLock = acquireBodyScrollLock({
      lockOverscroll: true,
    });

    return () => {
      releaseBodyScrollLock();
    };
  }, [fallbackFocusRef, isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const opener =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;
    const element = dialogRef.current;
    if (!element) return;
    if (!element.hasAttribute("tabindex")) element.tabIndex = -1;
    const restore = () => {
      return isAvailableFocusTarget(opener)
        ? opener
        : (getFocusableElements(fallbackFocusRef?.current ?? null)[0] ?? null);
    };
    const release = registerModalFocus(element, restore, containExternalFocus);
    const initialFocus =
      initialFocusRef?.current ?? getFocusableElements(element)[0] ?? element;
    initialFocus.focus({ preventScroll: true });
    return release;
  }, [containExternalFocus, fallbackFocusRef, initialFocusRef, isOpen]);

  const onDialogKeyDown = useCallback(
    (event: KeyboardEvent<T>) => {
      const eventTarget = event.target instanceof Element ? event.target : null;
      if (eventTarget?.closest('[role="dialog"]') !== event.currentTarget) {
        return;
      }

      if (
        !isTopModal(dialogRef.current) ||
        event.currentTarget.getAttribute("aria-modal") === "false"
      )
        return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;

      const dialogElement = dialogRef.current;
      const focusableElements = getFocusableElements(dialogElement);
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialogElement?.focus({ preventScroll: true });
        return;
      }

      if (!focusableElements.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialogElement?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialogElement?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    },
    [onEscape],
  );

  return { dialogRef, onDialogKeyDown };
};
