// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeBatchedElementMeasurements } from "./batchedElementMeasurements";

describe("batched element measurements", () => {
  let callback: ResizeObserverCallback;
  let observed: Set<Element>;
  let disconnect: ReturnType<typeof vi.fn>;
  const disposers: Array<() => void> = [];
  const observe = (elements: Element[], read: () => () => void) => {
    const dispose = observeBatchedElementMeasurements(elements, read);
    disposers.push(dispose);
    return dispose;
  };
  const resize = (...targets: Element[]) =>
    callback(
      targets.map((target) => ({ target }) as ResizeObserverEntry),
      {} as ResizeObserver,
    );

  beforeEach(() => {
    observed = new Set();
    disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(function (onResize: ResizeObserverCallback) {
        callback = onResize;
        return {
          observe: (element: Element) => observed.add(element),
          unobserve: (element: Element) => observed.delete(element),
          disconnect,
        };
      }),
    );
  });

  afterEach(async () => {
    for (const dispose of disposers.splice(0)) dispose();
    await Promise.resolve();
    vi.unstubAllGlobals();
  });

  it("reads all card widths before any result can change layout", async () => {
    const operations: string[] = [];
    for (const name of ["first", "second"]) {
      observe([document.createElement("div")], () => {
        operations.push("read " + name);
        return () => operations.push("publish " + name);
      });
    }
    expect(operations).toEqual([]);
    await Promise.resolve();
    expect(operations).toEqual([
      "read first",
      "read second",
      "publish first",
      "publish second",
    ]);
    expect(ResizeObserver).toHaveBeenCalledTimes(1);
  });

  it("coalesces repeated resize entries while remeasuring later resizes", async () => {
    const circle = document.createElement("span");
    const title = document.createElement("span");
    const publish = vi.fn();
    const read = vi.fn(() => publish);
    observe([circle, title], read);
    resize(circle, title, circle);
    resize(title);
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);

    resize(title, circle);
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps shared targets observed until their last subscriber leaves", async () => {
    const element = document.createElement("div");
    const publish = vi.fn();
    const first = observe([element, element], () => vi.fn());
    observe([element], () => publish);
    first();
    resize(element);
    await Promise.resolve();
    expect(observed.has(element)).toBe(true);
    expect(disconnect).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledOnce();
  });

  it("drops removed cards and uses the replacement measurement", async () => {
    const element = document.createElement("div");
    const staleRead = vi.fn(() => vi.fn());
    const dispose = observe([element], staleRead);
    dispose();
    const publish = vi.fn();
    observe([element], () => publish);
    await Promise.resolve();
    expect(staleRead).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(ResizeObserver).toHaveBeenCalledTimes(2);
  });

  it("does not publish a result if another result unmounts that card", async () => {
    let removeSecond = () => {};
    observe([document.createElement("div")], () => () => removeSecond());
    const publish = vi.fn();
    removeSecond = observe([document.createElement("div")], () => publish);
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not retain an observer for absent or unmounted elements", async () => {
    observeBatchedElementMeasurements([null], () => vi.fn())();
    expect(ResizeObserver).not.toHaveBeenCalled();
    const element = document.createElement("div");
    const dispose = observe([element], () => vi.fn());
    dispose();
    await Promise.resolve();
    expect(observed.size).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
