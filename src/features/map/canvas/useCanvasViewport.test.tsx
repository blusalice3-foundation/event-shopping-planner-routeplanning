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
  const touch = (identifier: number, logicalX: number, logicalY = 200) => ({
    identifier,
    clientX: 60 + logicalX * coordinateScale,
    clientY: 80 + logicalY * coordinateScale,
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
it.each([
  [0.75, 0],
  [1, 0],
  [1.5, 0],
  [0.75, 37],
  [1, 37],
  [1.5, 37],
])(
  "keeps the original map point under an asymmetrically moving pinch center at scale %s and rotation %s",
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
      changedTouches: [touch(1, 200, 250), touch(2, 500, 250)],
    });
    fireEvent.touchEnd(root, {
      changedTouches: [touch(1, 200, 250), touch(2, 500, 250)],
    });
    const after = getViewport();
    const actualAnchor = after.toMapCoordinates(350, 250);
    expect(after.zoomLevelRef.current).toBe(300);
    expect(actualAnchor.x / after.cellSize).toBeCloseTo(normalizedAnchor.x);
    expect(actualAnchor.y / after.cellSize).toBeCloseTo(normalizedAnchor.y);
  },
);

it("pans with a moving two-finger center when the zoom stays unchanged", () => {
  const { root, touch, getViewport } = renderScaledViewport(1.5, 37);
  fireEvent.touchStart(root, {
    changedTouches: [touch(1, 250), touch(2, 350)],
  });
  fireEvent.touchMove(root, {
    changedTouches: [touch(1, 290, 225), touch(2, 390, 225)],
  });
  fireEvent.touchEnd(root, {
    changedTouches: [touch(1, 290, 225), touch(2, 390, 225)],
  });
  const viewport = getViewport();
  expect(viewport.zoomLevelRef.current).toBe(100);
  expect(viewport.offset.x).toBeCloseTo(80);
  expect(viewport.offset.y).toBeCloseTo(45);
  expect(viewport.hadPinchGestureRef.current).toBe(true);
  expect(viewport.suppressClickUntilRef.current).toBeGreaterThan(
    performance.now(),
  );
});

it.each([
  [1000, 400],
  [1, 10],
])(
  "follows a moving pinch center even after zoom is clamped at distance %s",
  (distance, expectedZoom) => {
    const { root, touch, getViewport } = renderScaledViewport(1.5, 37);
    const before = getViewport();
    const anchor = before.toMapCoordinates(300, 200);
    const normalizedAnchor = {
      x: anchor.x / before.cellSize,
      y: anchor.y / before.cellSize,
    };
    fireEvent.touchStart(root, {
      changedTouches: [touch(1, 250), touch(2, 350)],
    });
    for (const [centerX, centerY] of [
      [350, 250],
      [400, 275],
    ]) {
      fireEvent.touchMove(root, {
        changedTouches: [
          touch(1, centerX - distance / 2, centerY),
          touch(2, centerX + distance / 2, centerY),
        ],
      });
    }
    fireEvent.touchEnd(root, {
      changedTouches: [
        touch(1, 400 - distance / 2, 275),
        touch(2, 400 + distance / 2, 275),
      ],
    });
    const after = getViewport();
    const actualAnchor = after.toMapCoordinates(400, 275);
    expect(after.zoomLevelRef.current).toBe(expectedZoom);
    expect(actualAnchor.x / after.cellSize).toBeCloseTo(normalizedAnchor.x);
    expect(actualAnchor.y / after.cellSize).toBeCloseTo(normalizedAnchor.y);
  },
);

it("uses the gesture start without accumulating drift across moves before a frame", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const { root, touch, getViewport } = renderScaledViewport(0.75, 37);
  const before = getViewport();
  const anchor = before.toMapCoordinates(300, 200);
  const normalizedAnchor = {
    x: anchor.x / before.cellSize,
    y: anchor.y / before.cellSize,
  };
  fireEvent.touchStart(root, {
    changedTouches: [touch(1, 250), touch(2, 350)],
  });
  act(() => {
    fireEvent.touchMove(root, {
      changedTouches: [touch(1, 220, 220), touch(2, 420, 220)],
    });
    fireEvent.touchMove(root, {
      changedTouches: [touch(1, 200, 250), touch(2, 500, 250)],
    });
    fireEvent.touchMove(root, {
      changedTouches: [touch(1, 250, 230), touch(2, 450, 230)],
    });
  });
  expect(frames).toHaveLength(1);
  expect(getViewport().zoomLevelRef.current).toBe(200);
  act(() => frames[0](16));
  const after = getViewport();
  const actualAnchor = after.toMapCoordinates(350, 230);
  expect(after.cellSize).toBe(64);
  expect(actualAnchor.x / after.cellSize).toBeCloseTo(normalizedAnchor.x);
  expect(actualAnchor.y / after.cellSize).toBeCloseTo(normalizedAnchor.y);
});
it("keeps an unpublished zoom and offset together in the external owner", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const owner = { current: { x: 40, y: 20 } };
  const zoomRef = { current: 100 };
  const publishZoom = vi.fn();
  let viewport!: ReturnType<typeof useCanvasViewport>;
  const Harness = () => {
    viewport = useCanvasViewport({
      mapMaxRow: 20,
      mapMaxCol: 20,
      zoomLevel: 100,
      baseCellSize: 32,
      minZoom: 10,
      maxZoom: 400,
      initialOffset: owner.current,
      offsetRef: owner,
      zoomRef,
      onZoomChange: publishZoom,
    });
    return <div ref={viewport.containerRef} data-testid="owned-map" />;
  };
  const view = render(<Harness />);
  fireEvent.wheel(view.getByTestId("owned-map"), {
    deltaY: -100,
    clientX: 300,
    clientY: 200,
  });
  expect(publishZoom).not.toHaveBeenCalled();
  expect(frames).toHaveLength(1);
  expect(zoomRef.current).toBe(110);
  expect(owner.current.x).toBeCloseTo(14);
  expect(owner.current.y).toBeCloseTo(2);
});

it("starts a new viewport owner without writing the previous state or pending pinch into it", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const cancelFrame = vi.fn();
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  const publishZoom = vi.fn();
  const first = { current: { x: 40, y: 20 } };
  const firstZoom = { current: 100 };
  const second = { current: { x: 200, y: 300 } };
  const secondZoom = { current: 75 };
  let viewport!: ReturnType<typeof useCanvasViewport>;
  const Harness = ({
    owner,
    zoomRef,
    zoomLevel,
  }: {
    owner: React.MutableRefObject<{ x: number; y: number }>;
    zoomRef: React.MutableRefObject<number>;
    zoomLevel: number;
  }) => {
    viewport = useCanvasViewport({
      mapMaxRow: 20,
      mapMaxCol: 20,
      zoomLevel,
      baseCellSize: 32,
      minZoom: 10,
      maxZoom: 400,
      initialOffset: owner.current,
      offsetRef: owner,
      zoomRef,
      onZoomChange: publishZoom,
    });
    return <div ref={viewport.containerRef} data-testid="owned-map" />;
  };
  const view = render(
    <Harness owner={first} zoomRef={firstZoom} zoomLevel={100} />,
  );
  const root = view.getByTestId("owned-map");
  const touch = (identifier: number, clientX: number) => ({
    identifier,
    clientX,
    clientY: 200,
  });
  fireEvent.touchStart(root, {
    changedTouches: [touch(1, 250), touch(2, 350)],
  });
  fireEvent.touchMove(root, {
    changedTouches: [touch(1, 200), touch(2, 500)],
  });
  expect(firstZoom.current).toBe(300);
  expect(first.current).toEqual({ x: -430, y: -340 });
  expect(publishZoom).not.toHaveBeenCalled();
  view.rerender(<Harness owner={second} zoomRef={secondZoom} zoomLevel={75} />);
  expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(1);
  expect(firstZoom.current).toBe(300);
  expect(first.current).toEqual({ x: -430, y: -340 });
  expect(secondZoom.current).toBe(75);
  expect(second.current).toEqual({ x: 200, y: 300 });
  expect(viewport.offset).toEqual({ x: 200, y: 300 });
  expect(viewport.cellSize).toBe(24);
  expect(viewport.prevCellSizeRef.current).toBe(24);
  expect(viewport.activeTouchesRef.current.size).toBe(0);
  expect(viewport.isPinchGestureRef.current).toBe(false);
  expect(viewport.hadPinchGestureRef.current).toBe(true);
  expect(viewport.isViewportInteracting).toBe(false);
  expect(viewport.suppressClickUntilRef.current).toBeGreaterThan(
    performance.now(),
  );
  fireEvent.touchEnd(root, {
    changedTouches: [touch(1, 200), touch(2, 500)],
  });
  expect(publishZoom).not.toHaveBeenCalled();
  fireEvent.wheel(root, {
    deltaY: -100,
    clientX: 300,
    clientY: 200,
  });
  expect(frames).toHaveLength(2);
  expect(secondZoom.current).toBe(85);
  expect(second.current.x).toBeCloseTo(300 - (100 * 85) / 75);
  expect(second.current.y).toBeCloseTo(200 + (100 * 85) / 75);
  act(() => frames[1](16));
  expect(publishZoom).toHaveBeenCalledExactlyOnceWith(85);
});
