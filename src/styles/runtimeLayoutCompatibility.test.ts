// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRuntimeLayoutProperties,
  installRuntimeLayoutCompatibility,
  setRuntimeLayoutProperties,
} from "./runtimeLayoutCompatibility";

let dispose: (() => void) | undefined;
let style: HTMLStyleElement;
let sheet: CSSStyleSheet;
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const ruleFor = (element: Element) =>
  Array.from(sheet.cssRules).find((rule) =>
    (rule as CSSStyleRule).selectorText?.includes(
      `data-esp-runtime-layout="${element.getAttribute("data-esp-runtime-layout")}"`,
    ),
  ) as CSSStyleRule | undefined;

beforeEach(() => {
  style = document.createElement("style");
  style.textContent = ":root { --esp-runtime-layout-sheet: 1; }";
  document.head.append(style);
  sheet = style.sheet!;
  Object.defineProperty(sheet, "href", {
    value: new URL("/assets/app.css", location.href).href,
  });
  vi.stubGlobal("CSSStyleRule", sheet.cssRules[0].constructor);
  vi.stubGlobal("CSSImportRule", class {});
  vi.stubGlobal("CSS", { supports: () => false });
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  clearRuntimeLayoutProperties(document.body);
  document.body.replaceChildren();
  style.remove();
  vi.unstubAllGlobals();
});

describe("typed attr compatibility", () => {
  it("updates added and changed elements before the next frame without inline CSS", async () => {
    dispose = installRuntimeLayoutCompatibility();
    const row = document.createElement("div");
    row.dataset.layoutHeight =
      "calc((100dvh - 80px - var(--app-header-height)) / 0.15)";
    row.dataset.layoutTranslateY = "170px";
    document.body.append(row);
    await flush();
    expect(ruleFor(row)?.style.getPropertyValue("height")).toContain("100dvh");
    expect(ruleFor(row)?.style.getPropertyValue("transform")).toBe(
      "translateY(170px)",
    );
    expect(row.hasAttribute("style")).toBe(false);
    row.dataset.layoutTranslateY = "380px";
    await flush();
    expect(ruleFor(row)?.style.getPropertyValue("transform")).toBe(
      "translateY(380px)",
    );
    delete row.dataset.layoutTranslateY;
    await flush();
    expect(ruleFor(row)?.style.getPropertyValue("transform")).toBe("");
    row.remove();
    await flush();
    expect(sheet.cssRules).toHaveLength(1);
  });

  it("preserves independent rules for a drag clone and removes obsolete rules", async () => {
    dispose = installRuntimeLayoutCompatibility();
    const source = document.createElement("div");
    source.dataset.layoutTop = "100px";
    document.body.append(source);
    await flush();
    const clone = source.cloneNode(true) as HTMLElement;
    clone.dataset.layoutTop = "250px";
    document.body.append(clone);
    await flush();
    expect(ruleFor(source)?.style.getPropertyValue("top")).toBe("100px");
    expect(ruleFor(clone)?.style.getPropertyValue("top")).toBe("250px");
    expect(source.getAttribute("data-esp-runtime-layout")).not.toBe(
      clone.getAttribute("data-esp-runtime-layout"),
    );
  });

  it("does no observation or rule creation when typed attr is supported", async () => {
    vi.stubGlobal("CSS", { supports: () => true });
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    dispose = installRuntimeLayoutCompatibility();
    document.body.dataset.layoutTop = "120px";
    await flush();
    expect(observe).not.toHaveBeenCalled();
    expect(sheet.cssRules).toHaveLength(1);
    delete document.body.dataset.layoutTop;
  });

  it("allows only bounded layout properties and expressions in the trusted sheet", () => {
    setRuntimeLayoutProperties(document.body, {
      "--esp-body-scroll-top": "-120px",
    });
    expect(
      ruleFor(document.body)?.style.getPropertyValue("--esp-body-scroll-top"),
    ).toBe("-120px");
    setRuntimeLayoutProperties(document.body, {
      top: "url(https://example.com/x)",
    });
    expect(ruleFor(document.body)?.style.getPropertyValue("top")).toBe("");
    expect(document.body.hasAttribute("style")).toBe(false);
    clearRuntimeLayoutProperties(document.body);
    expect(sheet.cssRules).toHaveLength(1);
  });
});
