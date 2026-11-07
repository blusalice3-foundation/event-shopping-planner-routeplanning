// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCanvasViewport } from "./useCanvasViewport";
afterEach(() => {
  vi.unstubAllGlobals();
});
it("accumulates wheel input immediately but publishes at most once per animation frame", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const zoom = vi.fn();
  let viewport!: ReturnType<typeof useCanvasViewport>;
  const Harness = () => {
    viewport = useCanvasViewport({
      mapMaxRow: 200,
      mapMaxCol: 200,
      zoomLevel: 100,
      baseCellSize: 32,
      minZoom: 10,
      maxZoom: 400,
      onZoomChange: zoom,
    });
    return (
      <div ref={viewport.containerRef} data-testid="map">
        <canvas ref={viewport.canvasRef} />
      </div>
    );
  };
  const view = render(<Harness />);
  const root = view.getByTestId("map");
  act(() => {
    for (let index = 0; index < 3; index++)
      fireEvent.wheel(root, { deltaY: -100, clientX: 50, clientY: 50 });
  });
  expect(viewport.zoomLevelRef.current).toBe(130);
  expect(zoom).not.toHaveBeenCalled();
  expect(frames).toHaveLength(1);
  act(() => frames[0](16));
  expect(zoom).toHaveBeenCalledExactlyOnceWith(130);
});
const renderScaledViewport = (coordinateScale: number, rotationAngle = 0) => {
  let viewport!: ReturnType<typeof useCanvasViewport>;
  const Harness = () => {
    const [zoomLevel, setZoomLevel] = React.useState(100);
    viewport = useCanvasViewport({
      mapMaxRow: 200,
      mapMaxCol: 200,
      zoomLevel,
      rotationAngle,
      coordinateScale,
      baseCellSize: 32,
      minZoom: 10,
      maxZoom: 400,
      initialOffset: { x: 40, y: 20 },
      onZoomChange: setZoomLevel,
    });
    return <div ref={viewport.containerRef} data-testid="scaled-map" />;
  };
  const view = render(<Harness />);
  const root = view.getByTestId("scaled-map");
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
    left: 60,
    top: 80,
    width: 600 * coordinateScale,
    height: 400 * coordinateScale,
  } as DOMRect);
  const touch = (identifier: number, logicalX: number) => ({
    identifier,
    clientX: 60 + logicalX * coordinateScale,
    clientY: 80 + 200 * coordinateScale,
  });
  return { root, touch, getViewport: () => viewport };
};

it.each([
  [0.75, 0],
  [1, 0],
  [1.5, 0],
  [0.75, 37],
  [1, 37],
  [1.5, 37],
])(
  "keeps the map point under a fixed pinch center at display scale %s and rotation %s",
  (coordinateScale, rotationAngle) => {
    const { root, touch, getViewport } = renderScaledViewport(
      coordinateScale,
      rotationAngle,
    );
    const before = getViewport();
    const anchor = before.toMapCoordinates(300, 200);
    const normalizedAnchor = {
      x: anchor.x / before.cellSize,
      y: anchor.y / before.cellSize,
    };
    fireEvent.touchStart(root, {
      changedTouches: [touch(1, 250), touch(2, 350)],
    });
    fireEvent.touchMove(root, {
      changedTouches: [touch(1, 200), touch(2, 400)],
    });
    fireEvent.touchEnd(root, {
      changedTouches: [touch(1, 200), touch(2, 400)],
    });
    const after = getViewport();
    const actualAnchor = after.toMapCoordinates(300, 200);
    expect(after.zoomLevelRef.current).toBe(200);
    expect(actualAnchor.x / after.cellSize).toBeCloseTo(normalizedAnchor.x);
    expect(actualAnchor.y / after.cellSize).toBeCloseTo(normalizedAnchor.y);
    expect(after.offset.x).toBeCloseTo(-220);
    expect(after.offset.y).toBeCloseTo(-160);
  },
);

it.each([
  [1000, 400],
  [1, 10],
])(
  "preserves the scaled pinch anchor when zoom is clamped to %s / %s",
  (distance, expectedZoom) => {
    const { root, touch, getViewport } = renderScaledViewport(1.5);
    fireEvent.touchStart(root, {
      changedTouches: [touch(1, 250), touch(2, 350)],
    });
    fireEvent.touchMove(root, {
      changedTouches: [
        touch(1, 300 - distance / 2),
        touch(2, 300 + distance / 2),
      ],
    });
    fireEvent.touchEnd(root, {
      changedTouches: [
        touch(1, 300 - distance / 2),
        touch(2, 300 + distance / 2),
      ],
    });
    const viewport = getViewport();
    expect(viewport.zoomLevelRef.current).toBe(expectedZoom);
    expect(viewport.offset.x).toBeCloseTo(300 - (260 * expectedZoom) / 100);
    expect(viewport.offset.y).toBeCloseTo(200 - (180 * expectedZoom) / 100);
  },
);

it.each([0.75, 1, 1.5])(
  "uses the same logical center for wheel zoom at display scale %s",
  (coordinateScale) => {
    const { root, getViewport } = renderScaledViewport(coordinateScale);
    fireEvent.wheel(root, {
      deltaY: -100,
      clientX: 60 + 300 * coordinateScale,
      clientY: 80 + 200 * coordinateScale,
    });
    const viewport = getViewport();
    expect(viewport.zoomLevelRef.current).toBe(110);
    expect(viewport.offsetRef.current.x).toBeCloseTo(14);
    expect(viewport.offsetRef.current.y).toBeCloseTo(2);
  },
);
