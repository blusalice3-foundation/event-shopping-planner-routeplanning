import React, { useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DayMapData } from "../../types/map";
import MapCanvas from "./MapCanvas";

type Contact = { identifier: number; clientX: number; clientY: number };
type ReleaseOrder = "pointer-first" | "touch-first";
const first: Contact = { identifier: 1, clientX: 56, clientY: 84 };
const second: Contact = { identifier: 2, clientX: 112, clientY: 84 };
const movedFirst: Contact = { ...first, clientX: 28 };
const movedSecond: Contact = { ...second, clientX: 140 };
const mapCellClick = vi.fn();
const mapData: DayMapData = {
  maxRow: 20,
  maxCol: 20,
  cells: [],
  mergedCells: [],
  blocks: [],
};

const pointer = (
  canvas: HTMLCanvasElement,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  contact: Contact,
  pointerType = "touch",
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: contact.clientX,
    clientY: contact.clientY,
    buttons: type === "pointerdown" || type === "pointermove" ? 1 : 0,
  });
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    pointerId: { value: contact.identifier },
  });
  fireEvent(canvas, event);
};

const touch = (
  canvas: HTMLCanvasElement,
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  changedTouches: Contact[],
  touches: Contact[],
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    changedTouches: { value: changedTouches },
    touches: { value: touches },
  });
  fireEvent(canvas, event);
};

const beginPinch = (canvas: HTMLCanvasElement) => {
  pointer(canvas, "pointerdown", first);
  touch(canvas, "touchstart", [first], [first]);
  pointer(canvas, "pointerdown", second);
  touch(canvas, "touchstart", [second], [first, second]);
  touch(
    canvas,
    "touchmove",
    [movedFirst, movedSecond],
    [movedFirst, movedSecond],
  );
};

const release = (
  canvas: HTMLCanvasElement,
  contact: Contact,
  remaining: Contact[],
  order: ReleaseOrder,
) => {
  if (order === "touch-first") touch(canvas, "touchend", [contact], remaining);
  pointer(canvas, "pointerup", contact);
  if (order === "pointer-first")
    touch(canvas, "touchend", [contact], remaining);
};

const tap = (canvas: HTMLCanvasElement, pointerType = "touch") => {
  pointer(canvas, "pointerdown", first, pointerType);
  if (pointerType === "touch") touch(canvas, "touchstart", [first], [first]);
  pointer(canvas, "pointerup", first, pointerType);
  if (pointerType === "touch") touch(canvas, "touchend", [first], []);
  fireEvent.click(canvas, { clientX: first.clientX, clientY: first.clientY });
};

const renderCanvas = async () => {
  const onCellClick = vi.fn();
  const offsetRef = { current: { x: 0, y: 0 } };
  const Harness = () => {
    const [zoomLevel, setZoomLevel] = useState(100);
    return (
      <MapCanvas
        mapData={mapData}
        mapName="Day1"
        items={[]}
        executeModeItemIds={[]}
        zoomLevel={zoomLevel}
        onZoomChange={setZoomLevel}
        offsetRef={offsetRef}
        isRouteVisible={false}
        onCellClick={onCellClick}
      />
    );
  };
  const view = render(<Harness />);
  const canvas = view.container.querySelector("canvas");
  if (!canvas) throw new Error("canvas not found");
  await act(async () => {
    await vi.waitFor(() => expect(canvas.width).toBe(280));
  });
  return { canvas, onCellClick, offsetRef };
};

describe("MapCanvas pinch gesture tap isolation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mapCellClick.mockClear();
    window.addEventListener("mapCellClick", mapCellClick);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(280);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(280);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        new Proxy<Record<string, unknown>>(
          {
            measureText: (text: string) => ({ width: text.length * 8 }),
            getLineDash: () => [],
          },
          { get: (target, property: string) => target[property] ?? vi.fn() },
        ) as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getBoundingClientRect",
    ).mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 280,
      bottom: 280,
      width: 280,
      height: 280,
      toJSON: () => ({}),
    });
  });

  afterEach(async () => {
    try {
      // Keep gesture cooldown callbacks inside this test's jsdom lifetime.
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      cleanup();
      window.removeEventListener("mapCellClick", mapCellClick);
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it.each<ReleaseOrder>(["pointer-first", "touch-first"])(
    "does not tap on staggered pinch releases or their generated click (%s)",
    async (order) => {
      const { canvas, onCellClick } = await renderCanvas();
      beginPinch(canvas);
      release(canvas, movedSecond, [movedFirst], order);
      release(canvas, movedFirst, [], order);
      fireEvent.click(canvas, {
        clientX: first.clientX,
        clientY: first.clientY,
      });
      expect(onCellClick).not.toHaveBeenCalled();
      expect(mapCellClick).not.toHaveBeenCalled();

      tap(canvas);
      expect(onCellClick).toHaveBeenCalledTimes(1);
      expect(mapCellClick).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps one-finger panning after pinch without treating its release as a tap", async () => {
    const { canvas, onCellClick, offsetRef } = await renderCanvas();
    beginPinch(canvas);
    release(canvas, movedSecond, [movedFirst], "pointer-first");
    const beforePan = { ...offsetRef.current };
    const panned = { ...movedFirst, clientX: movedFirst.clientX + 24 };
    pointer(canvas, "pointermove", panned);
    touch(canvas, "touchmove", [panned], [panned]);
    expect(offsetRef.current.x).toBeGreaterThan(beforePan.x);
    release(canvas, panned, [], "pointer-first");
    fireEvent.click(canvas, {
      clientX: panned.clientX,
      clientY: panned.clientY,
    });
    expect(onCellClick).not.toHaveBeenCalled();
    expect(mapCellClick).not.toHaveBeenCalled();
    tap(canvas);
    expect(onCellClick).toHaveBeenCalledTimes(1);
  });

  it("keeps canceled pinch releases from tapping and accepts the next gesture", async () => {
    const { canvas, onCellClick } = await renderCanvas();
    beginPinch(canvas);
    pointer(canvas, "pointercancel", movedSecond);
    touch(canvas, "touchcancel", [movedSecond], [movedFirst]);
    release(canvas, movedFirst, [], "touch-first");
    fireEvent.click(canvas, { clientX: first.clientX, clientY: first.clientY });
    expect(onCellClick).not.toHaveBeenCalled();
    expect(mapCellClick).not.toHaveBeenCalled();
    tap(canvas);
    expect(onCellClick).toHaveBeenCalledTimes(1);
    expect(mapCellClick).toHaveBeenCalledTimes(1);
  });

  it("suppresses a click after all contacts are canceled without pointerup", async () => {
    const { canvas, onCellClick } = await renderCanvas();
    beginPinch(canvas);
    touch(canvas, "touchcancel", [movedFirst, movedSecond], []);
    fireEvent.click(canvas, { clientX: first.clientX, clientY: first.clientY });
    expect(onCellClick).not.toHaveBeenCalled();
    expect(mapCellClick).not.toHaveBeenCalled();
    tap(canvas);
    expect(onCellClick).toHaveBeenCalledTimes(1);
  });

  it("rejects pointer releases even when all touchend events arrived first", async () => {
    const { canvas, onCellClick } = await renderCanvas();
    beginPinch(canvas);
    touch(canvas, "touchend", [movedFirst, movedSecond], []);
    pointer(canvas, "pointerup", movedFirst);
    pointer(canvas, "pointerup", movedSecond);
    fireEvent.click(canvas, { clientX: first.clientX, clientY: first.clientY });
    expect(onCellClick).not.toHaveBeenCalled();
    expect(mapCellClick).not.toHaveBeenCalled();
    tap(canvas);
    expect(onCellClick).toHaveBeenCalledTimes(1);
  });

  it("does not convert a two-finger gesture without zoom movement into a tap", async () => {
    const { canvas, onCellClick } = await renderCanvas();
    pointer(canvas, "pointerdown", first);
    touch(canvas, "touchstart", [first], [first]);
    pointer(canvas, "pointerdown", second);
    touch(canvas, "touchstart", [second], [first, second]);
    release(canvas, second, [first], "pointer-first");
    release(canvas, first, [], "pointer-first");
    fireEvent.click(canvas, { clientX: first.clientX, clientY: first.clientY });
    expect(onCellClick).not.toHaveBeenCalled();
    expect(mapCellClick).not.toHaveBeenCalled();
    tap(canvas);
    expect(onCellClick).toHaveBeenCalledTimes(1);
  });

  it.each(["pen", "mouse"])(
    "accepts a new %s interaction after a completed pinch",
    async (pointerType) => {
      const { canvas, onCellClick } = await renderCanvas();
      beginPinch(canvas);
      release(canvas, movedSecond, [movedFirst], "pointer-first");
      release(canvas, movedFirst, [], "pointer-first");
      // A later mouse interaction is independent of the earlier touch gesture.
      vi.spyOn(performance, "now").mockReturnValue(performance.now() + 1000);
      onCellClick.mockClear();
      mapCellClick.mockClear();
      tap(canvas, pointerType);
      expect(onCellClick).toHaveBeenCalledTimes(1);
      expect(mapCellClick).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["touch", "pen", "mouse"])(
    "preserves ordinary %s taps",
    async (pointerType) => {
      const { canvas, onCellClick } = await renderCanvas();
      tap(canvas, pointerType);
      expect(onCellClick).toHaveBeenCalledTimes(1);
      expect(mapCellClick).toHaveBeenCalledTimes(1);
    },
  );
});
