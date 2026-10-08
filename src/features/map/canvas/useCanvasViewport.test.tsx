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
