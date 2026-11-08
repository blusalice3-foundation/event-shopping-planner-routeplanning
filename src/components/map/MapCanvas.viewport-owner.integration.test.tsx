import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DayMapData } from "../../types/map";
import MapCanvas from "./MapCanvas";

vi.mock("../../features/map/routing/useRouteCalculation", () => ({
  useRouteCalculation: () => ({ result: [], pending: false }),
}));

type Contact = { identifier: number; clientX: number; clientY: number };
type Gesture = "pinch" | "touch-drag" | "pen-drag" | "touch-press";
type ReleaseOrder = "pointer-first" | "touch-first";
const first: Contact = { identifier: 1, clientX: 56, clientY: 84 };
const second: Contact = { identifier: 2, clientX: 112, clientY: 84 };
const mapData: DayMapData = {
  maxRow: 20,
  maxCol: 20,
  cells: [],
  mergedCells: [],
  blocks: [],
};

function pointer(
  canvas: HTMLCanvasElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  contact: Contact,
  pointerType = "touch",
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: contact.clientX,
    clientY: contact.clientY,
    buttons: type === "pointerup" ? 0 : 1,
  });
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    pointerId: { value: contact.identifier },
  });
  fireEvent(canvas, event);
}

function touch(
  canvas: HTMLCanvasElement,
  type: "touchstart" | "touchmove" | "touchend",
  changedTouches: Contact[],
  touches: Contact[],
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    changedTouches: { value: changedTouches },
    touches: { value: touches },
  });
  fireEvent(canvas, event);
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(280);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(280);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(
  (["pinch", "touch-drag", "pen-drag", "touch-press"] as Gesture[]).flatMap(
    (gesture) =>
      (["pointer-first", "touch-first"] as ReleaseOrder[]).map(
        (order) => [gesture, order] as const,
      ),
  ),
)(
  "ignores the old %s release after an owner switch (%s), then accepts a fresh tap",
  (gesture, order) => {
    const onCellClick = vi.fn();
    const oldOwner = { current: { x: 0, y: 0 } };
    const oldZoom = { current: 100 };
    const nextOwner = { current: { x: 0, y: 0 } };
    const nextZoom = { current: 100 };
    const element = (owner: typeof oldOwner, zoom: typeof oldZoom) => (
      <MapCanvas
        mapData={mapData}
        mapName="map"
        items={[]}
        executeModeItemIds={[]}
        zoomLevel={100}
        onZoomChange={() => {}}
        offsetRef={owner}
        viewportZoomRef={zoom}
        isRouteVisible={false}
        onCellClick={onCellClick}
      />
    );
    const view = render(element(oldOwner, oldZoom));
    const canvas = view.container.querySelector("canvas");
    if (!canvas) throw new Error("The map canvas is missing.");
    const pointerType = gesture === "pen-drag" ? "pen" : "touch";
    pointer(canvas, "pointerdown", first, pointerType);
    if (pointerType === "touch") touch(canvas, "touchstart", [first], [first]);
    let finalFirst = first;
    let finalSecond = second;
    if (gesture === "pinch") {
      pointer(canvas, "pointerdown", second);
      touch(canvas, "touchstart", [second], [first, second]);
      finalFirst = { ...first, clientX: 28 };
      finalSecond = { ...second, clientX: 140 };
      touch(
        canvas,
        "touchmove",
        [finalFirst, finalSecond],
        [finalFirst, finalSecond],
      );
      expect(oldZoom.current).toBe(200);
    } else if (gesture !== "touch-press") {
      finalFirst = { ...first, clientX: first.clientX + 30 };
      pointer(canvas, "pointermove", finalFirst, pointerType);
      expect(oldOwner.current.x).toBeGreaterThan(0);
    }
    view.rerender(element(nextOwner, nextZoom));
    expect(view.container.querySelector("canvas")).toBe(canvas);
    const release = (contact: Contact, remaining: Contact[]) => {
      if (pointerType === "touch" && order === "touch-first")
        touch(canvas, "touchend", [contact], remaining);
      pointer(canvas, "pointerup", contact, pointerType);
      if (pointerType === "touch" && order === "pointer-first")
        touch(canvas, "touchend", [contact], remaining);
    };
    if (gesture === "pinch") release(finalSecond, [finalFirst]);
    release(finalFirst, []);
    fireEvent.click(canvas, { clientX: first.clientX, clientY: first.clientY });
    expect(onCellClick).not.toHaveBeenCalled();
    expect(nextOwner.current).toEqual({ x: 0, y: 0 });
    pointer(canvas, "pointerdown", first);
    touch(canvas, "touchstart", [first], [first]);
    pointer(canvas, "pointerup", first);
    touch(canvas, "touchend", [first], []);
    fireEvent.click(canvas, { clientX: first.clientX, clientY: first.clientY });
    expect(onCellClick).toHaveBeenCalledTimes(1);
  },
);
