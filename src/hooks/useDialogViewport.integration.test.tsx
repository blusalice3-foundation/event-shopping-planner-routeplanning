import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { StrictMode, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRuntimeLayoutProperties,
  setRuntimeLayoutProperties,
} from "../styles/runtimeLayoutCompatibility";
import { useDialogViewport } from "./useDialogViewport";

class TestViewport extends EventTarget {
  height = 400;
  offsetTop = 18;
  scale = 1;
}

let viewport: TestViewport;
let sheetElement: HTMLStyleElement;
let sheet: CSSStyleSheet;
let callbacks: Map<number, FrameRequestCallback>;
let nextFrame: number;

function Dialog({
  name = "親",
  open = true,
}: {
  name?: string;
  open?: boolean;
}) {
  const ref = useDialogViewport(open);
  const [value, setValue] = useState("");
  return open ? (
    <div ref={ref} data-testid={name}>
      <input
        aria-label={`${name}入力`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button>確定</button>
    </div>
  ) : null;
}

function ExistingRefDialog() {
  const ref = useRef<HTMLDivElement>(null);
  useDialogViewport(true, ref);
  return <div ref={ref} data-testid="既存ref" />;
}

function ruleFor(element: Element) {
  return Array.from(sheet.cssRules).find((rule) =>
    (rule as CSSStyleRule).selectorText?.includes(
      `data-esp-runtime-layout="${element.getAttribute("data-esp-runtime-layout")}"`,
    ),
  ) as CSSStyleRule | undefined;
}

function viewportEvent(type = "resize") {
  act(() => viewport.dispatchEvent(new Event(type)));
}

function flushFrame() {
  const pending = Array.from(callbacks.values());
  callbacks.clear();
  act(() => pending.forEach((callback) => callback(0)));
}

beforeEach(() => {
  viewport = new TestViewport();
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal("innerHeight", 800);
  callbacks = new Map();
  nextFrame = 0;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      callbacks.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => callbacks.delete(id)),
  );
  sheetElement = document.createElement("style");
  sheetElement.textContent = ":root { --esp-runtime-layout-sheet: 1; }";
  document.head.append(sheetElement);
  sheet = sheetElement.sheet!;
  Object.defineProperty(sheet, "href", {
    value: new URL("/assets/dialog-test.css", location.href).href,
  });
  vi.stubGlobal("CSSStyleRule", sheet.cssRules[0].constructor);
  vi.stubGlobal("CSSImportRule", class {});
});

afterEach(() => {
  cleanup();
  sheetElement.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("dialog visual viewport lifecycle", () => {
  it("synchronizes an already open keyboard and a new child without waiting for events", () => {
    const added = vi.spyOn(viewport, "addEventListener");
    const view = render(<Dialog />);
    const parent = screen.getByTestId("親");
    const firstRule = ruleFor(parent)!;
    expect(firstRule.style.getPropertyValue("top")).toBe("18px");
    expect(firstRule.style.getPropertyValue("height")).toBe("400px");
    expect(parent).not.toHaveAttribute("style");

    viewportEvent();
    expect(callbacks.size).toBe(1);
    view.rerender(
      <>
        <Dialog />
        <Dialog name="子" />
      </>,
    );
    expect(callbacks.size).toBe(0);
    expect(ruleFor(screen.getByTestId("子"))?.style.height).toBe("400px");
    expect(ruleFor(parent)).toBe(firstRule);
    expect(added.mock.calls.map(([type]) => type)).toEqual([
      "resize",
      "scroll",
    ]);
  });

  it("coalesces event bursts into one frame and writes only changed bounds", () => {
    render(<Dialog />);
    const rule = ruleFor(screen.getByTestId("親"))!;
    const writes = vi.spyOn(rule.style, "setProperty");
    viewportEvent();
    viewportEvent("scroll");
    viewportEvent();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    flushFrame();
    expect(writes).not.toHaveBeenCalled();
    expect(callbacks.size).toBe(0);

    viewport.height = 320;
    viewport.offsetTop = 30;
    viewportEvent();
    flushFrame();
    expect(rule.style.height).toBe("320px");
    expect(rule.style.top).toBe("30px");
    expect(writes).toHaveBeenCalledTimes(2);
  });

  it("keeps the surviving parent's rule and listeners, then removes the last pending work", () => {
    const removed = vi.spyOn(viewport, "removeEventListener");
    const view = render(
      <>
        <Dialog />
        <Dialog name="子" />
      </>,
    );
    const parent = screen.getByTestId("親");
    const child = screen.getByTestId("子");
    view.rerender(<Dialog />);
    expect(child).not.toHaveAttribute("data-esp-runtime-layout");
    expect(ruleFor(parent)?.style.height).toBe("400px");
    expect(removed).not.toHaveBeenCalled();
    viewportEvent();
    const staleFrame = Array.from(callbacks.values())[0];
    view.unmount();
    expect(callbacks.size).toBe(0);
    expect(parent).not.toHaveAttribute("data-esp-runtime-layout");
    expect(sheet.cssRules).toHaveLength(1);
    expect(removed.mock.calls.map(([type]) => type)).toEqual([
      "resize",
      "scroll",
    ]);

    render(<Dialog name="新規" />);
    const replacement = screen.getByTestId("新規");
    viewport.height = 250;
    viewportEvent();
    act(() => staleFrame(0));
    expect(ruleFor(replacement)?.style.height).toBe("400px");
    flushFrame();
    expect(ruleFor(replacement)?.style.height).toBe("250px");
  });

  it("clears correction for pinch and keyboard closure while preserving another layout owner", () => {
    const other = document.createElement("div");
    document.body.append(other);
    setRuntimeLayoutProperties(other, { top: "99px" });
    const view = render(<Dialog />);
    const dialog = screen.getByTestId("親");
    viewport.scale = 1.5;
    viewportEvent();
    flushFrame();
    expect(dialog).not.toHaveAttribute("data-esp-runtime-layout");
    expect(ruleFor(other)?.style.top).toBe("99px");
    viewport.scale = 1.000001;
    viewportEvent();
    flushFrame();
    expect(ruleFor(dialog)?.style.height).toBe("400px");
    viewport.height = 800;
    viewport.offsetTop = 0;
    viewportEvent();
    flushFrame();
    expect(dialog).not.toHaveAttribute("data-esp-runtime-layout");
    view.unmount();
    expect(ruleFor(other)?.style.top).toBe("99px");
    clearRuntimeLayoutProperties(other);
    other.remove();
    expect(sheet.cssRules).toHaveLength(1);
  });

  it("survives StrictMode and retains input through keyboard resize, rotation and reopening", () => {
    const added = vi.spyOn(viewport, "addEventListener");
    const removed = vi.spyOn(viewport, "removeEventListener");
    const view = render(
      <StrictMode>
        <Dialog />
      </StrictMode>,
    );
    expect(added).toHaveBeenCalledTimes(4);
    expect(removed).toHaveBeenCalledTimes(2);
    const input = screen.getByRole("textbox", { name: "親入力" });
    fireEvent.change(input, { target: { value: "編集中のイベント名" } });
    input.focus();
    viewport.height = 280;
    viewport.offsetTop = 5;
    viewportEvent();
    flushFrame();
    expect(input).toHaveValue("編集中のイベント名");
    expect(input).toHaveFocus();
    expect(sheet.cssRules).toHaveLength(2);
    view.rerender(
      <StrictMode>
        <Dialog open={false} />
      </StrictMode>,
    );
    expect(sheet.cssRules).toHaveLength(1);
    view.rerender(
      <StrictMode>
        <Dialog />
      </StrictMode>,
    );
    expect(ruleFor(screen.getByTestId("親"))?.style.height).toBe("280px");
    expect(screen.getByRole("textbox", { name: "親入力" })).toHaveValue(
      "編集中のイベント名",
    );
  });

  it("uses an existing modal ref without replacing its DOM element", () => {
    render(<ExistingRefDialog />);
    expect(ruleFor(screen.getByTestId("既存ref"))?.style.height).toBe("400px");
  });

  it("does no viewport observation while closed or when the API is unavailable", () => {
    const added = vi.spyOn(viewport, "addEventListener");
    const view = render(<Dialog open={false} />);
    expect(added).not.toHaveBeenCalled();
    vi.stubGlobal("visualViewport", undefined);
    view.rerender(<Dialog />);
    expect(added).not.toHaveBeenCalled();
    expect(screen.getByTestId("親")).not.toHaveAttribute(
      "data-esp-runtime-layout",
    );
    expect(callbacks.size).toBe(0);
    expect(sheet.cssRules).toHaveLength(1);
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])(
    "discards invalid viewport height %s and restores CSS defaults",
    (height) => {
      render(<Dialog />);
      viewport.height = height;
      viewportEvent();
      flushFrame();
      expect(screen.getByTestId("親")).not.toHaveAttribute(
        "data-esp-runtime-layout",
      );
      expect(sheet.cssRules).toHaveLength(1);
    },
  );
});
