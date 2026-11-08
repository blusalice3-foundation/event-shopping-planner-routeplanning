// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { isAppleTouchWebKit } from "./appleTouchWebKit";
import {
  setRuntimeLayoutProperties,
  clearRuntimeLayoutProperties,
} from "../styles/runtimeLayoutCompatibility";
vi.mock("./appleTouchWebKit", () => ({
  isAppleTouchWebKit: vi.fn(() => false),
}));
vi.mock("../styles/runtimeLayoutCompatibility", () => ({
  setRuntimeLayoutProperties: vi.fn(),
  clearRuntimeLayoutProperties: vi.fn(),
}));
import { acquireBodyScrollLock } from "./bodyScrollLock";

describe("bodyScrollLock", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(isAppleTouchWebKit).mockReturnValue(false);
    document.body.className = "";
    document.body.style.overflow = "";
    document.body.style.overscrollBehavior = "";
    document.body.style.touchAction = "";
  });

  it("keeps the body locked until overlapping owners have both released it", () => {
    document.body.style.overflow = "auto";
    document.body.style.overscrollBehavior = "contain";

    const releaseDragLock = acquireBodyScrollLock();
    const releaseNavigatorLock = acquireBodyScrollLock({
      lockOverscroll: true,
    });

    expect(document.body).toHaveClass(
      "esp-body-scroll-lock",
      "esp-body-overscroll-lock",
    );
    expect(document.body.style.overflow).toBe("auto");
    expect(document.body.style.overscrollBehavior).toBe("contain");

    releaseDragLock();
    expect(document.body).toHaveClass(
      "esp-body-scroll-lock",
      "esp-body-overscroll-lock",
    );

    releaseNavigatorLock();
    expect(document.body).not.toHaveClass(
      "esp-body-scroll-lock",
      "esp-body-overscroll-lock",
    );
    expect(document.body.style.overflow).toBe("auto");
    expect(document.body.style.overscrollBehavior).toBe("contain");
  });

  it("restores overscroll independently and makes release idempotent", () => {
    document.body.style.overscrollBehavior = "contain";
    document.body.style.touchAction = "pan-y";

    const releasePanelLock = acquireBodyScrollLock({
      lockTouchAction: true,
    });
    const releaseNavigatorLock = acquireBodyScrollLock({
      lockOverscroll: true,
    });

    releaseNavigatorLock();
    expect(document.body).toHaveClass(
      "esp-body-scroll-lock",
      "esp-body-touch-lock",
    );
    expect(document.body).not.toHaveClass("esp-body-overscroll-lock");
    expect(document.body.style.overflow).toBe("");
    expect(document.body.style.overscrollBehavior).toBe("contain");
    expect(document.body.style.touchAction).toBe("pan-y");

    releaseNavigatorLock();
    expect(document.body).toHaveClass(
      "esp-body-scroll-lock",
      "esp-body-touch-lock",
    );

    releasePanelLock();
    expect(document.body).not.toHaveClass(
      "esp-body-scroll-lock",
      "esp-body-touch-lock",
    );
    expect(document.body.style.overflow).toBe("");
    expect(document.body.style.overscrollBehavior).toBe("contain");
    expect(document.body.style.touchAction).toBe("pan-y");
  });
});

it("fixes only iOS modal owners and restores the original position after the last modal", () => {
  vi.mocked(isAppleTouchWebKit).mockReturnValue(true);
  vi.spyOn(window, "scrollX", "get").mockReturnValue(12);
  vi.spyOn(window, "scrollY", "get").mockReturnValue(345);
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const releaseDrag = acquireBodyScrollLock();
  expect(document.body).not.toHaveClass("esp-body-position-lock");
  const releaseFirst = acquireBodyScrollLock({ lockDocumentPosition: true });
  const releaseSecond = acquireBodyScrollLock({ lockDocumentPosition: true });
  expect(setRuntimeLayoutProperties).toHaveBeenCalledWith(document.body, {
    "--esp-body-scroll-left": "-12px",
    "--esp-body-scroll-top": "-345px",
  });
  expect(document.body).toHaveClass("esp-body-position-lock");
  releaseFirst();
  expect(scrollTo).not.toHaveBeenCalled();
  releaseSecond();
  expect(document.body).not.toHaveClass("esp-body-position-lock");
  expect(document.body).toHaveClass("esp-body-scroll-lock");
  expect(clearRuntimeLayoutProperties).toHaveBeenCalledWith(document.body);
  expect(scrollTo).toHaveBeenCalledWith({
    left: 12,
    top: 345,
    behavior: "auto",
  });
  releaseSecond();
  expect(scrollTo).toHaveBeenCalledTimes(1);
  releaseDrag();
  vi.restoreAllMocks();
  vi.mocked(isAppleTouchWebKit).mockReturnValue(false);
});

it("does not fix the document for Windows or Android modal owners", () => {
  const release = acquireBodyScrollLock({ lockDocumentPosition: true });
  expect(document.body).not.toHaveClass("esp-body-position-lock");
  release();
});
