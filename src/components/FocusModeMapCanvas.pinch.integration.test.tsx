import {
  getCanvasBackingSize,
  MAX_CANVAS_BACKING_PIXELS,
} from "../features/map/canvas/canvasBackingSize";
import React, { useState } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DayMapData } from "../types/map";
import type { FocusMapViewportSnapshot } from "../types/focus";
import FocusModeMapCanvas from "./FocusModeMapCanvas";

const mapData: DayMapData = {
  maxRow: 20,
  maxCol: 20,
  cells: [],
  mergedCells: [],
  blocks: [
    {
      name: "A",
      startRow: 1,
      startCol: 1,
      endRow: 20,
      endCol: 20,
      numberCells: Array.from({ length: 20 }, (_, index) => ({
        row: 8,
        col: index + 1,
        value: index + 1,
      })),
    },
  ],
};

const renderMap = (
  appZoomLevel: number,
  initialZoom = 100,
  rotationAngle = 0,
  data = mapData,
) => {
  const snapshots = vi.fn<(snapshot: FocusMapViewportSnapshot) => void>();
  const onCellClick = vi.fn();
  const Harness = () => {
    const [zoomLevel, setZoomLevel] = useState(initialZoom);
    return (
      <FocusModeMapCanvas
        mapData={data}
        mapName="Day1"
        items={[]}
        executeModeItemIds={[]}
        zoomLevel={zoomLevel}
        appZoomLevel={appZoomLevel}
        rotationAngle={rotationAngle}
        selectedHall={null}
        currentVisitKey={null}
        nextVisitKey={null}
        prevVisitKey={null}
        currentPhase="normal"
        onZoomChange={setZoomLevel}
        onCellClick={onCellClick}
        onViewportSnapshotChange={snapshots}
      />
    );
  };
  const view = render(<Harness />);
  const canvas = view.container.querySelector("canvas")!;
  const scale = appZoomLevel / 100;
  const rect = {
    x: 60,
    y: 80,
    left: 60,
    top: 80,
    right: 60 + 600 * scale,
    bottom: 80 + 400 * scale,
    width: 600 * scale,
    height: 400 * scale,
    toJSON: () => ({}),
  };
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(canvas.parentElement!, "getBoundingClientRect").mockReturnValue(
    rect,
  );
  const center = { clientX: 60 + 300 * scale, clientY: 80 + 200 * scale };
  const touch = (identifier: number, delta: number) => ({
    identifier,
    clientX: center.clientX + delta * scale,
    clientY: center.clientY,
  });
  const pinch = (distanceRatio: number) => {
    fireEvent.touchStart(canvas, {
      changedTouches: [touch(1, -50), touch(2, 50)],
    });
    fireEvent.touchMove(canvas, {
      changedTouches: [
        touch(1, -50 * distanceRatio),
        touch(2, 50 * distanceRatio),
      ],
    });
    fireEvent.touchEnd(canvas, {
      changedTouches: [
        touch(1, -50 * distanceRatio),
        touch(2, 50 * distanceRatio),
      ],
    });
  };
  const latestSnapshot = () => snapshots.mock.calls.at(-1)![0];
  return { canvas, center, touch, pinch, latestSnapshot, onCellClick, ...view };
};

const frames = new Map<number, FrameRequestCallback>();

const pointer = (
  canvas: HTMLCanvasElement,
  type: "pointerdown" | "pointerup",
  touch: { identifier: number; clientX: number; clientY: number },
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: touch.clientX,
    clientY: touch.clientY,
    buttons: type === "pointerdown" ? 1 : 0,
  });
  Object.defineProperties(event, {
    pointerType: { value: "touch" },
    pointerId: { value: touch.identifier },
  });
  fireEvent(canvas, event);
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  frames.clear();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FocusModeMapCanvas zoom center", () => {
  it.each([75, 100, 150].map((appZoomLevel) => ({ appZoomLevel })))(
    "keeps a fixed pinch center at $appZoomLevel percent app scale with a displaced container",
    ({ appZoomLevel }) => {
      const { pinch, latestSnapshot } = renderMap(appZoomLevel);
      pinch(2);
      expect(latestSnapshot()).toMatchObject({ zoomLevel: 200 });
      expect(latestSnapshot().offsetX).toBeCloseTo(-300);
      expect(latestSnapshot().offsetY).toBeCloseTo(-200);
    },
  );

  it("uses the same scaled coordinates for wheel zoom on a rotated map", () => {
    const { canvas, center, latestSnapshot } = renderMap(150, 100, 37);
    fireEvent.wheel(canvas, { ...center, deltaY: -100 });
    act(() => {
      const pending = Array.from(frames.values());
      frames.clear();
      pending.forEach((callback) => callback(16));
    });
    expect(latestSnapshot()).toMatchObject({ zoomLevel: 110 });
    expect(latestSnapshot().offsetX).toBeCloseTo(-30);
    expect(latestSnapshot().offsetY).toBeCloseTo(-20);
  });

  it.each([
    { initialZoom: 180, ratio: 2, finalZoom: 200 },
    { initialZoom: 30, ratio: 0.25, finalZoom: 15 },
  ])(
    "preserves the focal point at the $finalZoom percent zoom limit",
    ({ initialZoom, ratio, finalZoom }) => {
      const { pinch, latestSnapshot } = renderMap(150, initialZoom);
      pinch(ratio);
      expect(latestSnapshot()).toMatchObject({ zoomLevel: finalZoom });
      expect(latestSnapshot().offsetX).toBeCloseTo(
        300 * (1 - finalZoom / initialZoom),
      );
      expect(latestSnapshot().offsetY).toBeCloseTo(
        200 * (1 - finalZoom / initialZoom),
      );
    },
  );

  it("ignores both finger releases after a pinch and accepts the next independent tap", () => {
    const { canvas, touch, center, onCellClick } = renderMap(100);
    pointer(canvas, "pointerdown", touch(1, -50));
    fireEvent.touchStart(canvas, { changedTouches: [touch(1, -50)] });
    pointer(canvas, "pointerdown", touch(2, 50));
    fireEvent.touchStart(canvas, { changedTouches: [touch(2, 50)] });
    fireEvent.touchMove(canvas, {
      changedTouches: [touch(1, -100), touch(2, 100)],
    });
    pointer(canvas, "pointerup", touch(1, -100));
    fireEvent.touchEnd(canvas, { changedTouches: [touch(1, -100)] });
    pointer(canvas, "pointerup", touch(2, 100));
    fireEvent.touchEnd(canvas, { changedTouches: [touch(2, 100)] });
    fireEvent.click(canvas, center);
    expect(onCellClick).not.toHaveBeenCalled();

    pointer(canvas, "pointerdown", touch(3, 0));
    fireEvent.touchStart(canvas, { changedTouches: [touch(3, 0)] });
    pointer(canvas, "pointerup", touch(3, 0));
    fireEvent.touchEnd(canvas, { changedTouches: [touch(3, 0)] });
    expect(onCellClick).toHaveBeenCalledExactlyOnceWith("A", 11, []);
  });
});

describe("FocusModeMapCanvas container resize", () => {
  const flushFrames = () => {
    act(() => {
      const pending = Array.from(frames.values());
      frames.clear();
      pending.forEach((callback) => callback(16));
    });
  };

  const useDrawingContexts = () => {
    const contexts = new Map<HTMLCanvasElement, CanvasRenderingContext2D>();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      function (this: HTMLCanvasElement) {
        let context = contexts.get(this);
        if (!context) {
          context = new Proxy(
            {
              canvas: this,
              measureText: vi.fn((text: string) => ({
                width: text.length * 8,
              })),
            } as unknown as CanvasRenderingContext2D,
            {
              get(target, property, receiver) {
                if (!Reflect.has(target, property)) {
                  Reflect.set(target, property, vi.fn());
                }
                return Reflect.get(target, property, receiver);
              },
            },
          );
          contexts.set(this, context);
        }
        return context;
      },
    );
    return contexts;
  };

  it("caps the low-app-zoom backing while retaining visible cell hit coordinates", () => {
    vi.stubGlobal("devicePixelRatio", 3);
    const contexts = useDrawingContexts();
    const { canvas, onCellClick } = renderMap(15);
    const width = 2653;
    const height = 4025;
    Object.defineProperties(canvas.parentElement!, {
      clientWidth: { configurable: true, value: width },
      clientHeight: { configurable: true, value: height },
    });
    vi.mocked(canvas.getBoundingClientRect).mockReturnValue({
      left: 60,
      top: 80,
      width: width * 0.15,
      height: height * 0.15,
    } as DOMRect);
    flushFrames();
    const backing = getCanvasBackingSize(width, height, 3);
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(
      MAX_CANVAS_BACKING_PIXELS,
    );
    expect(contexts.get(canvas)!.setTransform).toHaveBeenCalledWith(
      backing.scale,
      0,
      0,
      backing.scale,
      0,
      0,
    );
    fireEvent.click(canvas, {
      clientX: 60 + 210 * 0.15,
      clientY: 80 + 210 * 0.15,
    });
    expect(onCellClick).toHaveBeenCalledExactlyOnceWith("A", 8, []);
  });
  it.each([
    { appZoomLevel: 100, dpr: 1 },
    { appZoomLevel: 150, dpr: 2 },
  ])(
    "redraws resized backing pixels and selects the displayed cell at $appZoomLevel percent scale and DPR $dpr",
    ({ appZoomLevel, dpr }) => {
      let resize: ResizeObserverCallback = () => {};
      const observe = vi.fn();
      const disconnect = vi.fn();
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(callback: ResizeObserverCallback) {
            resize = callback;
          }
          observe = observe;
          disconnect = disconnect;
        },
      );
      vi.stubGlobal("devicePixelRatio", dpr);
      const contexts = useDrawingContexts();
      const { canvas, onCellClick, unmount } = renderMap(appZoomLevel, 100, 0, {
        ...mapData,
        cells: mapData.blocks[0].numberCells.map((cell) => ({
          ...cell,
          backgroundColor: null,
          borders: { top: null, bottom: null, left: null, right: null },
        })),
      });
      const container = canvas.parentElement!;
      let width = 600;
      let height = 400;
      Object.defineProperties(container, {
        clientWidth: { configurable: true, get: () => width },
        clientHeight: { configurable: true, get: () => height },
      });
      flushFrames();
      expect(canvas.width).toBe(600 * dpr);
      expect(canvas.height).toBe(400 * dpr);
      const mainContext = contexts.get(canvas)!;
      vi.mocked(mainContext.clearRect).mockClear();
      for (const context of contexts.values()) {
        vi.mocked(context.fillText).mockClear();
      }

      width = 360;
      height = 280;
      const scale = appZoomLevel / 100;
      vi.mocked(canvas.getBoundingClientRect).mockReturnValue({
        x: 60,
        y: 80,
        left: 60,
        top: 80,
        right: 60 + width * scale,
        bottom: 80 + height * scale,
        width: width * scale,
        height: height * scale,
        toJSON: () => ({}),
      });
      const notifyResize = () => resize([], {} as ResizeObserver);
      notifyResize();
      notifyResize();
      expect(frames.size).toBe(1);
      flushFrames();
      expect(canvas.width).toBe(width * dpr);
      expect(canvas.height).toBe(height * dpr);
      expect(observe).toHaveBeenCalledExactlyOnceWith(container);
      expect(mainContext.clearRect).toHaveBeenCalledExactlyOnceWith(
        0,
        0,
        width,
        height,
      );
      expect(
        Array.from(contexts.values()).some((context) =>
          vi
            .mocked(context.fillText)
            .mock.calls.some(
              ([text, x, y]) => text === "8" && x === 210 && y === 210,
            ),
        ),
      ).toBe(true);
      fireEvent.click(canvas, {
        clientX: 60 + 210 * scale,
        clientY: 80 + 210 * scale,
      });
      expect(onCellClick).toHaveBeenCalledExactlyOnceWith("A", 8, []);

      notifyResize();
      expect(frames.size).toBe(0);
      width = 400;
      notifyResize();
      expect(frames.size).toBe(1);
      unmount();
      expect(disconnect).toHaveBeenCalledOnce();
      expect(frames.size).toBe(0);
    },
  );

  it.each([
    { dpr: 3, nextWidth: 3000, nextHeight: 4500, observer: true },
    { dpr: 1, nextWidth: 3500, nextHeight: 5250, observer: true },
    { dpr: 3, nextWidth: 3000, nextHeight: 4500, observer: false },
  ])(
    "redraws a proportional capped resize at DPR $dpr with ResizeObserver $observer",
    ({ dpr, nextWidth, nextHeight, observer }) => {
      let resize: ResizeObserverCallback = () => {};
      vi.stubGlobal(
        "ResizeObserver",
        observer
          ? class {
              constructor(callback: ResizeObserverCallback) {
                resize = callback;
              }
              observe = vi.fn();
              disconnect = vi.fn();
            }
          : undefined,
      );
      vi.stubGlobal("devicePixelRatio", dpr);
      const contexts = useDrawingContexts();
      const { canvas, onCellClick } = renderMap(15, 100, 0, {
        ...mapData,
        cells: mapData.blocks[0].numberCells.map((cell) => ({
          ...cell,
          backgroundColor: null,
          borders: { top: null, bottom: null, left: null, right: null },
        })),
      });
      let width = 4000;
      let height = 6000;
      Object.defineProperties(canvas.parentElement!, {
        clientWidth: { configurable: true, get: () => width },
        clientHeight: { configurable: true, get: () => height },
      });
      flushFrames();
      const previous = getCanvasBackingSize(width, height, dpr);
      const mainContext = contexts.get(canvas)!;
      for (const context of contexts.values()) {
        vi.mocked(context.clearRect).mockClear();
        vi.mocked(context.setTransform).mockClear();
        vi.mocked(context.fillText).mockClear();
      }
      width = nextWidth;
      height = nextHeight;
      const backing = getCanvasBackingSize(width, height, dpr);
      expect(backing.width).toBe(previous.width);
      expect(backing.height).toBe(previous.height);
      expect(backing.scale).not.toBe(previous.scale);
      vi.mocked(canvas.getBoundingClientRect).mockReturnValue({
        left: 60,
        top: 80,
        width: width * 0.15,
        height: height * 0.15,
      } as DOMRect);
      const notifyResize = () => {
        if (observer) resize([], {} as ResizeObserver);
        else fireEvent(window, new Event("resize"));
      };
      notifyResize();
      notifyResize();
      expect(frames.size).toBe(1);
      flushFrames();
      expect(canvas.width).toBe(previous.width);
      expect(canvas.height).toBe(previous.height);
      expect(mainContext.clearRect).toHaveBeenCalledExactlyOnceWith(
        0,
        0,
        width,
        height,
      );
      expect(mainContext.setTransform).toHaveBeenCalledWith(
        backing.scale,
        0,
        0,
        backing.scale,
        0,
        0,
      );
      const label = Array.from(contexts.values())
        .flatMap((context) => vi.mocked(context.fillText).mock.calls)
        .find(([text]) => text === "8");
      expect(label).toBeDefined();
      const [, labelX, labelY] = label!;
      // Derive the tap from the rendered pixel and its current CSS display size.
      fireEvent.click(canvas, {
        clientX: 60 + ((labelX * backing.scale) / canvas.width) * width * 0.15,
        clientY:
          80 + ((labelY * backing.scale) / canvas.height) * height * 0.15,
      });
      expect(onCellClick).toHaveBeenCalledExactlyOnceWith("A", 8, []);
      notifyResize();
      expect(frames.size).toBe(0);
    },
  );

  it("invalidates the gesture raster when a dimension-capped resize keeps the same pixels", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let resize: ResizeObserverCallback = () => {};
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(callback: ResizeObserverCallback) {
            resize = callback;
          }
          observe = vi.fn();
          disconnect = vi.fn();
        },
      );
      vi.stubGlobal("devicePixelRatio", 3);
      const contexts = useDrawingContexts();
      const { canvas } = renderMap(15, 100, 0, {
        ...mapData,
        cells: mapData.blocks[0].numberCells.map((cell) => ({
          ...cell,
          backgroundColor: null,
          borders: { top: null, bottom: null, left: null, right: null },
        })),
      });
      let width = 30000;
      let height = 300;
      Object.defineProperties(canvas.parentElement!, {
        clientWidth: { configurable: true, get: () => width },
        clientHeight: { configurable: true, get: () => height },
      });
      flushFrames();
      const previous = getCanvasBackingSize(width, height, 3);
      expect(canvas.width).toBe(8192);
      expect(canvas.height).toBe(previous.height);
      expect(contexts.get(canvas)!.setTransform).toHaveBeenCalledWith(
        previous.scale,
        0,
        0,
        previous.scale,
        0,
        0,
      );
      expect(previous.width * previous.height).toBeLessThan(4 * 1024 * 1024);
      fireEvent.wheel(canvas, { clientX: 60, clientY: 80, deltaY: -100 });
      flushFrames();
      flushFrames();
      expect(frames.size).toBe(0);
      for (const context of contexts.values()) {
        vi.mocked(context.fillText).mockClear();
        vi.mocked(context.setTransform).mockClear();
      }
      width = 22500;
      height = 225;
      const backing = getCanvasBackingSize(width, height, 3);
      expect(backing.width).toBe(previous.width);
      expect(backing.height).toBe(previous.height);
      expect(backing.scale).not.toBe(previous.scale);
      resize([], {} as ResizeObserver);
      expect(frames.size).toBe(1);
      flushFrames();
      expect(contexts.get(canvas)!.setTransform).toHaveBeenCalledWith(
        backing.scale,
        0,
        0,
        backing.scale,
        0,
        0,
      );
      expect(
        Array.from(contexts.values()).some((context) =>
          vi.mocked(context.fillText).mock.calls.some(([text]) => text === "8"),
        ),
      ).toBe(true);
      resize([], {} as ResizeObserver);
      expect(frames.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("redraws on window resize when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    useDrawingContexts();
    const { canvas, unmount } = renderMap(100);
    const container = canvas.parentElement!;
    let width = 600;
    Object.defineProperties(container, {
      clientWidth: { configurable: true, get: () => width },
      clientHeight: { configurable: true, value: 400 },
    });
    flushFrames();
    width = 360;
    fireEvent(window, new Event("resize"));
    flushFrames();
    expect(canvas.width).toBe(360);
    unmount();
    fireEvent(window, new Event("resize"));
    expect(frames.size).toBe(0);
  });
});
