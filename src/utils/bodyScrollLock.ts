import { isAppleTouchWebKit } from "./appleTouchWebKit";
import {
  clearRuntimeLayoutProperties,
  setRuntimeLayoutProperties,
} from "../styles/runtimeLayoutCompatibility";

export interface BodyScrollLockOptions {
  lockOverscroll?: boolean;
  lockTouchAction?: boolean;
  lockDocumentPosition?: boolean;
}

interface ActiveBodyScrollLock {
  lockOverscroll: boolean;
  lockTouchAction: boolean;
  lockDocumentPosition: boolean;
}

let nextLockId = 0;
const activeLocks = new Map<number, ActiveBodyScrollLock>();
const BODY_SCROLL_LOCK_CLASS = "esp-body-scroll-lock";
const BODY_OVERSCROLL_LOCK_CLASS = "esp-body-overscroll-lock";
const BODY_TOUCH_LOCK_CLASS = "esp-body-touch-lock";
const BODY_POSITION_LOCK_CLASS = "esp-body-position-lock";
let lockedPosition: { left: number; top: number } | null = null;

function applyBodyScrollLockState(): void {
  if (typeof document === "undefined") return;

  const locks = Array.from(activeLocks.values());
  const needsPositionLock = locks.some((lock) => lock.lockDocumentPosition);
  if (needsPositionLock && !lockedPosition) {
    lockedPosition = { left: window.scrollX, top: window.scrollY };
    setRuntimeLayoutProperties(document.body, {
      "--esp-body-scroll-left": `${-lockedPosition.left}px`,
      "--esp-body-scroll-top": `${-lockedPosition.top}px`,
    });
    document.body.classList.add(BODY_POSITION_LOCK_CLASS);
  } else if (!needsPositionLock && lockedPosition) {
    const position = lockedPosition;
    lockedPosition = null;
    document.body.classList.remove(BODY_POSITION_LOCK_CLASS);
    clearRuntimeLayoutProperties(document.body);
    window.scrollTo({ ...position, behavior: "auto" });
  }
  document.body.classList.toggle(BODY_SCROLL_LOCK_CLASS, locks.length > 0);
  document.body.classList.toggle(
    BODY_OVERSCROLL_LOCK_CLASS,
    locks.some((lock) => lock.lockOverscroll),
  );
  document.body.classList.toggle(
    BODY_TOUCH_LOCK_CLASS,
    locks.some((lock) => lock.lockTouchAction),
  );
}

export function acquireBodyScrollLock(
  options: BodyScrollLockOptions = {},
): () => void {
  if (typeof document === "undefined") return () => {};

  const lockId = ++nextLockId;
  activeLocks.set(lockId, {
    lockOverscroll: options.lockOverscroll ?? false,
    lockTouchAction: options.lockTouchAction ?? false,
    lockDocumentPosition:
      (options.lockDocumentPosition ?? false) && isAppleTouchWebKit(),
  });
  applyBodyScrollLockState();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeLocks.delete(lockId);
    applyBodyScrollLockState();
  };
}
