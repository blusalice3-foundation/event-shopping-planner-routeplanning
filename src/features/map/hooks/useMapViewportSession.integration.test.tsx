import { act, renderHook } from "@testing-library/react";
import { StrictMode, type PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import type { MapViewportState } from "../../../types/map";
import type { CanvasCamera } from "../canvas/useCanvasViewport";
import { useMapViewportSession } from "./useMapViewportSession";

const first = { zoomLevel: 150, offsetX: 20, offsetY: 30 };
const second = { zoomLevel: 75, offsetX: 200, offsetY: 300 };

describe("map viewport ownership", () => {
  it("skips parent rendering for internal same-zoom input but issues a fresh receipt for external same-zoom requests", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useMapViewportSession("map", first);
    });
    const initialReceipt = result.current.zoomPublication;
    const camera: CanvasCamera = {
      owner: {},
      revision: 1,
      zoom: 150,
      offset: { x: 35, y: 45 },
      origin: "gesture",
    };
    result.current.canvasOffsetRef.current = camera.offset;
    const beforeInternal = renders;
    act(() => result.current.setZoomLevel(150, camera));
    expect(renders).toBe(beforeInternal);
    expect(result.current.zoomPublication).toBe(initialReceipt);
    act(() => result.current.setZoomLevel(150, { ...camera, revision: 2 }));
    expect(renders).toBe(beforeInternal);
    expect(result.current.zoomPublication).toBe(initialReceipt);
    expect(result.current.zoomLevelRef.current).toBe(150);
    expect(result.current.canvasOffsetRef.current).toEqual({ x: 35, y: 45 });
    act(() => result.current.setZoomLevel(150));
    expect(renders).toBe(beforeInternal + 1);
    const externalReceipt = result.current.zoomPublication;
    expect(externalReceipt).not.toBe(initialReceipt);
    expect(externalReceipt.camera).toBeNull();
    const beforeRepeatedInternal = renders;
    act(() => result.current.setZoomLevel(150, { ...camera, revision: 2 }));
    // React 18 may render once to bail out immediately after an external update.
    expect(renders).toBeLessThanOrEqual(beforeRepeatedInternal + 1);
    const afterBailout = renders;
    for (const revision of [3, 4, 5]) {
      act(() => result.current.setZoomLevel(150, { ...camera, revision }));
    }
    expect(renders).toBe(afterBailout);
    expect(result.current.zoomLevel).toBe(150);
    expect(result.current.zoomPublication).toBe(externalReceipt);
    act(() => result.current.setZoomLevel(150));
    expect(result.current.zoomPublication).not.toBe(externalReceipt);
    expect(result.current.zoomPublication.camera).toBeNull();
  });

  it("restores each map without writing unchanged values", () => {
    const saveFirst = vi.fn();
    const saveSecond = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ scope, initial, save }) => useMapViewportSession(scope, initial, save),
      { initialProps: { scope: "day1", initial: first, save: saveFirst } },
    );
    const firstOffsetRef = result.current.canvasOffsetRef;
    rerender({ scope: "day2", initial: second, save: saveSecond });
    expect(result.current.zoomLevel).toBe(75);
    expect(result.current.canvasOffsetRef.current).toEqual({ x: 200, y: 300 });
    expect(result.current.canvasOffsetRef).not.toBe(firstOffsetRef);
    rerender({ scope: "day1", initial: first, save: saveFirst });
    expect(result.current.zoomLevel).toBe(150);
    unmount();
    expect(saveFirst).not.toHaveBeenCalled();
    expect(saveSecond).not.toHaveBeenCalled();
  });

  it("saves accepted frame-pending input to the old map and blocks late publishers", () => {
    const saveFirst = vi.fn();
    const saveSecond = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ scope, initial, save }) => useMapViewportSession(scope, initial, save),
      { initialProps: { scope: "day1", initial: first, save: saveFirst } },
    );
    const oldOwner = result.current;
    // Canvas accepts this pair synchronously before its scheduled React publish.
    oldOwner.zoomLevelRef.current = 180;
    oldOwner.canvasOffsetRef.current = { x: 50, y: 60 };
    rerender({ scope: "day2", initial: second, save: saveSecond });
    expect(saveFirst).toHaveBeenCalledExactlyOnceWith({
      zoomLevel: 180,
      offsetX: 50,
      offsetY: 60,
    });
    expect(saveSecond).not.toHaveBeenCalled();
    act(() => oldOwner.setZoomLevel(200));
    expect(result.current.zoomLevel).toBe(75);
    expect(result.current.canvasOffsetRef.current).toEqual({ x: 200, y: 300 });
    unmount();
    expect(saveFirst).toHaveBeenCalledTimes(1);
    expect(saveSecond).not.toHaveBeenCalled();
  });

  it("ignores same-scope persisted props and retains the committed save owner", () => {
    const oldSave = vi.fn();
    const replacementSave = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ scope, initial, save }) => useMapViewportSession(scope, initial, save),
      { initialProps: { scope: "map:1", initial: first, save: oldSave } },
    );
    act(() => result.current.setZoomLevel(180));
    const offsetRef = result.current.canvasOffsetRef;
    offsetRef.current = { x: 50, y: 60 };
    rerender({ scope: "map:1", initial: second, save: replacementSave });
    expect(result.current.zoomLevel).toBe(180);
    expect(result.current.canvasOffsetRef).toBe(offsetRef);
    unmount();
    expect(oldSave).toHaveBeenCalledExactlyOnceWith({
      zoomLevel: 180,
      offsetX: 50,
      offsetY: 60,
    });
    expect(replacementSave).not.toHaveBeenCalled();
  });

  it("restores a quick return before the old map's save reaches persisted props", () => {
    const saveFirst = vi.fn();
    const saveSecond = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ scope, initial, save }) => useMapViewportSession(scope, initial, save),
      { initialProps: { scope: "day1", initial: first, save: saveFirst } },
    );
    act(() => result.current.setZoomLevel(180));
    result.current.canvasOffsetRef.current = { x: 50, y: 60 };
    rerender({ scope: "day2", initial: second, save: saveSecond });
    rerender({ scope: "day1", initial: first, save: saveFirst });
    expect(result.current.zoomLevel).toBe(180);
    expect(result.current.canvasOffsetRef.current).toEqual({ x: 50, y: 60 });
    // Resolving that save must not move the view or cause another write.
    rerender({
      scope: "day1",
      initial: { zoomLevel: 180, offsetX: 50, offsetY: 60 },
      save: saveFirst,
    });
    unmount();
    expect(saveFirst).toHaveBeenCalledTimes(1);
    expect(saveSecond).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "drops a reimported map's cached viewport, same drawing=%s",
    (sameDrawing) => {
      const drawing = { cells: [], mergedCells: [], maxRow: 12, maxCol: 12 };
      const save = vi.fn();
      const { result, rerender, unmount } = renderHook(
        ({
          scope,
          initial,
          source,
        }: {
          scope: string;
          initial: MapViewportState | undefined;
          source: typeof drawing;
        }) => useMapViewportSession(scope, initial, save, source),
        {
          initialProps: {
            scope: "day1",
            initial: first as MapViewportState | undefined,
            source: drawing,
          },
        },
      );
      act(() => result.current.setZoomLevel(180));
      result.current.canvasOffsetRef.current = { x: 50, y: 60 };
      rerender({ scope: "day2", initial: second, source: drawing });
      rerender({
        scope: "day1",
        initial: undefined,
        source: sameDrawing ? drawing : { ...drawing, cells: [] },
      });
      expect(result.current.zoomLevel).toBe(100);
      expect(result.current.canvasOffsetRef.current).toEqual({ x: 0, y: 0 });
      unmount();
    },
  );

  it("retains pending input for an initially unsaved map when returning from a saved map", () => {
    const save = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({
        scope,
        initial,
      }: {
        scope: string;
        initial: MapViewportState | undefined;
      }) => useMapViewportSession(scope, initial, save),
      {
        initialProps: {
          scope: "saved",
          initial: first as MapViewportState | undefined,
        },
      },
    );
    rerender({ scope: "new", initial: undefined });
    act(() => result.current.setZoomLevel(125));
    result.current.canvasOffsetRef.current = { x: 44, y: 55 };
    rerender({ scope: "saved", initial: first });
    rerender({ scope: "new", initial: undefined });
    expect(result.current.zoomLevel).toBe(125);
    expect(result.current.canvasOffsetRef.current).toEqual({ x: 44, y: 55 });
    unmount();
  });
  it("does not publish during StrictMode's initial cleanup or ordinary input", () => {
    const save = vi.fn<(viewport: MapViewportState) => void>();
    const { result, unmount } = renderHook(
      () => useMapViewportSession("map", undefined, save),
      {
        wrapper: ({ children }: PropsWithChildren) => (
          <StrictMode>{children}</StrictMode>
        ),
      },
    );
    expect(save).not.toHaveBeenCalled();
    act(() => result.current.setZoomLevel(125));
    result.current.canvasOffsetRef.current = { x: 10, y: 15 };
    expect(save).not.toHaveBeenCalled();
    unmount();
    expect(save).toHaveBeenCalledExactlyOnceWith({
      zoomLevel: 125,
      offsetX: 10,
      offsetY: 15,
    });
  });
});
