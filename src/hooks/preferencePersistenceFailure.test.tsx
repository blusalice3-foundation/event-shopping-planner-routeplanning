// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreferencePersistencePort } from "../app/ports/PersistenceCommandPort";
import { useDisableLimitedPurchaseQuantityCheck } from "./useDisableLimitedPurchaseQuantityCheck";
import { useDisablePriceUndefinedCheck } from "./useDisablePriceUndefinedCheck";
import { useNumberCellOutlineStyle } from "./useNumberCellOutlineStyle";
import { useThemeMode } from "./useThemeMode";
import {
  DEFAULT_UI_VISIBILITY,
  useUIVisibilitySettings,
} from "./useUIVisibilitySettings";

const useSettings = (preferences: PreferencePersistencePort) => ({
  visibility: useUIVisibilitySettings(preferences),
  theme: useThemeMode(preferences),
  outline: useNumberCellOutlineStyle(preferences),
  price: useDisablePriceUndefinedCheck(preferences),
  quantity: useDisableLimitedPurchaseQuantityCheck(preferences),
});

const changeSettings = (settings: ReturnType<typeof useSettings>) => {
  settings.visibility.setUiVisibilitySettings((current) => ({
    ...current,
    showPersistenceStatus: false,
  }));
  settings.theme.setThemeMode("dark");
  settings.outline.setNumberCellOutlineStyle("dashed");
  settings.price.setDisablePriceUndefinedCheck(true);
  settings.quantity.setDisableLimitedPurchaseQuantityCheck(true);
};

const expectChangedSettings = (settings: ReturnType<typeof useSettings>) => {
  expect(settings.visibility.uiVisibilitySettings.showPersistenceStatus).toBe(
    false,
  );
  expect(settings.theme.themeMode).toBe("dark");
  expect(settings.outline.numberCellOutlineStyle).toBe("dashed");
  expect(settings.price.disablePriceUndefinedCheck).toBe(true);
  expect(settings.quantity.disableLimitedPurchaseQuantityCheck).toBe(true);
};

const expectDefaultSettings = (settings: ReturnType<typeof useSettings>) => {
  expect(settings.visibility.uiVisibilitySettings).toEqual(
    DEFAULT_UI_VISIBILITY,
  );
  expect(settings.theme.themeMode).toBe("system");
  expect(settings.outline.numberCellOutlineStyle).toBe("rounded");
  expect(settings.price.disablePriceUndefinedCheck).toBe(false);
  expect(settings.quantity.disableLimitedPurchaseQuantityCheck).toBe(false);
};

const browserPreferences: PreferencePersistencePort = {
  loadPreference: (key) => window.localStorage.getItem(key),
  savePreference: (key, value) => window.localStorage.setItem(key, value),
};

describe("preference persistence failures", () => {
  let darkSystemTheme: boolean;
  let mediaListeners: Set<() => void>;
  let mediaQuery: MediaQueryList;

  beforeEach(() => {
    darkSystemTheme = false;
    mediaListeners = new Set();
    mediaQuery = {
      get matches() {
        return darkSystemTheme;
      },
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        mediaListeners.add(listener);
      }),
      removeEventListener: vi.fn((_type: string, listener: () => void) => {
        mediaListeners.delete(listener);
      }),
    } as unknown as MediaQueryList;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mediaQuery),
    );
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.classList.remove("dark");
  });

  it("keeps initial and changed settings when each preference write throws", () => {
    const preferences = {
      loadPreference: vi.fn(() => null),
      savePreference: vi.fn(() => {
        throw new DOMException("storage full", "QuotaExceededError");
      }),
    };
    const { result, rerender } = renderHook(() => useSettings(preferences));

    expectDefaultSettings(result.current);
    expect(preferences.savePreference).toHaveBeenCalledTimes(5);

    act(() => changeSettings(result.current));

    expectChangedSettings(result.current);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(preferences.savePreference).toHaveBeenCalledTimes(10);

    rerender();
    expect(preferences.savePreference).toHaveBeenCalledTimes(10);
  });

  it("persists all settings and restores them when writes are available", () => {
    const first = renderHook(() => useSettings(browserPreferences));
    act(() => changeSettings(first.result.current));
    expectChangedSettings(first.result.current);
    first.unmount();

    const restored = renderHook(() => useSettings(browserPreferences));
    expectChangedSettings(restored.result.current);
    expect(localStorage.getItem("themeMode")).toBe("dark");
    expect(localStorage.getItem("numberCellOutlineStyle")).toBe("dashed");
    expect(localStorage.getItem("disablePriceUndefinedCheck")).toBe("true");
    expect(localStorage.getItem("disableLimitedPurchaseQuantityCheck")).toBe(
      "true",
    );
  });

  it.each(["read", "getter"] as const)(
    "keeps default settings when localStorage %s is unavailable",
    (failure) => {
      const unavailable = () => {
        throw new DOMException("storage unavailable", "SecurityError");
      };
      if (failure === "getter") {
        vi.spyOn(window, "localStorage", "get").mockImplementation(unavailable);
      } else {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(unavailable);
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(unavailable);
      }

      const { result } = renderHook(() => useSettings(browserPreferences));
      expectDefaultSettings(result.current);
      expect(document.documentElement).toHaveAttribute("data-theme", "system");
    },
  );

  it("applies system theme changes and removes listeners after write failures", () => {
    const preferences = {
      loadPreference: vi.fn(() => null),
      savePreference: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
    };
    const { result, unmount } = renderHook(() => useThemeMode(preferences));
    expect(mediaListeners.size).toBe(1);
    expect(document.documentElement).not.toHaveClass("dark");

    act(() => {
      darkSystemTheme = true;
      mediaListeners.forEach((listener) => listener());
    });
    expect(document.documentElement).toHaveClass("dark");
    expect(preferences.savePreference).toHaveBeenCalledTimes(1);

    act(() => result.current.setThemeMode("light"));
    expect(mediaListeners.size).toBe(0);
    expect(document.documentElement).not.toHaveClass("dark");

    act(() => result.current.setThemeMode("system"));
    expect(mediaListeners.size).toBe(1);
    expect(document.documentElement).toHaveClass("dark");
    unmount();
    expect(mediaListeners.size).toBe(0);
    expect(mediaQuery.addEventListener).toHaveBeenCalledTimes(2);
    expect(mediaQuery.removeEventListener).toHaveBeenCalledTimes(2);
  });
});
