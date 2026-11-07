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
) => {
  const snapshots = vi.fn<(snapshot: FocusMapViewportSnapshot) => void>();
  const onCellClick = vi.fn();
  const Harness = () => {
    const [zoomLevel, setZoomLevel] = useState(initialZoom);
    return (
      <FocusModeMapCanvas
        mapData={mapData}
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
  return { canvas, center, touch, pinch, latestSnapshot, onCellClick };
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
