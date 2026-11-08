import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useCanvasCamera,
  type CanvasCamera,
  type CanvasZoomPublication,
} from "./useCanvasCamera";

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const flush = () => {
  const batch = [...frames.entries()];
  frames.clear();
  act(() => batch.forEach(([, callback]) => callback(16)));
};

const renderCamera = () => {
  const container = document.createElement("div");
  Object.defineProperties(container, {
    clientWidth: { value: 600 },
    clientHeight: { value: 400 },
  });
  const changes = vi.fn<(zoom: number, camera?: CanvasCamera) => void>();
  const options = {
    zoomLevel: 100,
    zoomPublication: { camera: null } as CanvasZoomPublication,
    offsetRef: { current: { x: 0, y: 0 } },
    zoomRef: { current: 100 },
    ownerKey: "Day1:map1",
    rotationAngle: 0,
    mapMaxCol: 20,
    mapMaxRow: 20,
    baseCellSize: 28,
    containerRef: { current: container },
    centerExternalZoom: true,
    onZoomChange: changes,
  };
  const hook = renderHook((props) => useCanvasCamera(props), {
    initialProps: options,
  });
  return { ...hook, changes, options };
};

beforeEach(() => {
  frames.clear();
  nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());

describe("canvas camera publication and drawing contract", () => {
  it("keeps each zoom and offset atomic and coalesces only the pending publication", () => {
    const { result, changes } = renderCamera();
    const first = result.current.renderCamera;
    act(() => {
      result.current.scheduleCamera(102, { x: -6, y: -4 });
      result.current.scheduleCamera(104, { x: -12, y: -8 });
    });
    expect(frames.size).toBe(1);
    expect(changes).not.toHaveBeenCalled();
    expect(result.current.getDrawCamera(first)).toBe(first);
    const latest = result.current.getDrawCamera(first, true)!;
    expect(latest).toMatchObject({
      zoom: 104,
      offset: { x: -12, y: -8 },
      origin: "gesture",
    });
    expect(first).toMatchObject({ zoom: 100, offset: { x: 0, y: 0 } });
    flush();
    expect(changes).toHaveBeenCalledExactlyOnceWith(104, latest);
    expect(result.current.renderCamera).toBe(latest);
    expect(frames.size).toBe(0);
  });

  it("rejects a full frame older than an already painted raster and advances on the existing publication", () => {
    const { result } = renderCamera();
    const committed = result.current.renderCamera;
    act(() => result.current.scheduleCamera(102, { x: -6, y: -4 }));
    const raster = result.current.getDrawCamera(committed, true)!;
    result.current.markCameraPainted(raster);
    expect(result.current.getDrawCamera(committed)).toBeNull();
    flush();
    const full = result.current.getDrawCamera(result.current.renderCamera);
    expect(full).toBe(raster);
    result.current.markCameraPainted(full!);
    // Data/style/size invalidation must be allowed to repaint the same generation.
    expect(result.current.getDrawCamera(result.current.renderCamera)).toBe(
      full,
    );
  });

  it("uses an immediate pan with the matching committed zoom", () => {
    const { result } = renderCamera();
    const committed = result.current.renderCamera;
    act(() => result.current.setPanOffset({ x: 17, y: -9 }));
    const pan = result.current.getDrawCamera(committed)!;
    expect(pan).toMatchObject({
      zoom: 100,
      offset: { x: 17, y: -9 },
      origin: "pan",
    });
    expect(pan.revision).toBeGreaterThan(committed.revision);
    expect(result.current.renderCamera).toBe(committed);
  });

  it("does not let an older accepted echo overwrite newer immediate input", () => {
    const { result, options, rerender, changes } = renderCamera();
    act(() => result.current.scheduleCamera(102, { x: -6, y: -4 }));
    flush();
    const accepted = changes.mock.calls[0][1]!;
    act(() => result.current.scheduleCamera(104, { x: -12, y: -8 }));
    rerender({
      ...options,
      zoomLevel: 102,
      zoomPublication: { camera: accepted },
    });
    expect(options.zoomRef.current).toBe(104);
    expect(options.offsetRef.current).toEqual({ x: -12, y: -8 });
    expect(
      result.current.getDrawCamera(result.current.renderCamera, true),
    ).toMatchObject({
      zoom: 104,
      offset: { x: -12, y: -8 },
    });
    flush();
    expect(changes.mock.calls.at(-1)![0]).toBe(104);
  });

  it("recognizes an external same-value request from its receipt and cancels its queued gesture", () => {
    const { result, options, rerender, changes } = renderCamera();
    act(() => result.current.scheduleCamera(110, { x: -10, y: -10 }));
    const staleCallback = [...frames.values()][0];
    rerender({
      ...options,
      zoomLevel: 110,
      zoomPublication: { camera: null },
    });
    expect(result.current.renderCamera.origin).toBe("external");
    expect(result.current.renderCamera.zoom).toBe(110);
    expect(frames.size).toBe(0);
    act(() => staleCallback(16));
    expect(changes).not.toHaveBeenCalled();
    expect(options.zoomRef.current).toBe(110);
    const external = result.current.renderCamera;
    rerender({
      ...options,
      zoomLevel: 110,
      zoomPublication: { camera: null },
    });
    expect(result.current.renderCamera.origin).toBe("external");
    expect(result.current.renderCamera.revision).toBeGreaterThan(
      external.revision,
    );
    expect(options.offsetRef.current.x).toBeCloseTo(-30, 6);
    expect(options.offsetRef.current.y).toBeCloseTo(-20, 6);
  });

  it("anchors an external zoom to the latest raster that was actually painted", () => {
    const { result, options, rerender } = renderCamera();
    const committed = result.current.renderCamera;
    act(() => result.current.scheduleCamera(110, { x: -10, y: -10 }));
    const raster = result.current.getDrawCamera(committed, true)!;
    result.current.markCameraPainted(raster);
    rerender({ ...options, zoomLevel: 120, zoomPublication: { camera: null } });
    expect(result.current.renderCamera).toMatchObject({
      zoom: 120,
      origin: "external",
    });
    expect(options.offsetRef.current.x).toBeCloseTo(-420 / 11, 6);
    expect(options.offsetRef.current.y).toBeCloseTo(-320 / 11, 6);
    expect(frames.size).toBe(0);
  });
  it("invalidates old-owner input and paint callbacks without publishing to the replacement owner", () => {
    const { result, options, rerender, changes } = renderCamera();
    const oldCamera = result.current.renderCamera;
    const oldGetDrawCamera = result.current.getDrawCamera;
    act(() => result.current.scheduleCamera(102, { x: -6, y: -4 }));
    const oldCallback = [...frames.values()][0];
    const offsetRef = { current: { x: 70, y: 80 } };
    const zoomRef = { current: 75 };
    rerender({
      ...options,
      offsetRef,
      zoomRef,
      zoomLevel: 75,
      ownerKey: "Day2:map2",
      zoomPublication: { camera: null },
    });
    expect(frames.size).toBe(0);
    act(() => oldCallback(16));
    expect(changes).not.toHaveBeenCalled();
    expect(offsetRef.current).toEqual({ x: 70, y: 80 });
    expect(zoomRef.current).toBe(75);
    expect(oldGetDrawCamera(oldCamera)).toBeNull();
    expect(result.current.renderCamera.owner).not.toBe(oldCamera.owner);
    expect(
      result.current.getDrawCamera(result.current.renderCamera),
    ).not.toBeNull();
  });

  it("discards old pending coordinates when the map owner changes while refs are retained", () => {
    const { result, options, rerender, changes } = renderCamera();
    const oldCamera = result.current.renderCamera;
    act(() => result.current.scheduleCamera(102, { x: -6, y: -4 }));
    const oldCallback = [...frames.values()][0];
    rerender({ ...options, ownerKey: "Day2:replacement-map" });
    expect(result.current.renderCamera.owner).not.toBe(oldCamera.owner);
    expect(result.current.renderCamera.zoom).toBe(100);
    expect(result.current.renderCamera.offset).toEqual({ x: 0, y: 0 });
    expect(options.offsetRef.current).toEqual({ x: 0, y: 0 });
    expect(options.zoomRef.current).toBe(100);
    act(() => oldCallback(16));
    expect(changes).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
  it("ignores an old-owner publication echoed after replacement without canceling new-owner input", () => {
    const { result, options, rerender, changes } = renderCamera();
    act(() => result.current.scheduleCamera(102, { x: -6, y: -4 }));
    flush();
    const oldEcho = changes.mock.calls[0][1]!;
    const replacement = {
      ...options,
      ownerKey: "Day2:replacement-map",
      zoomLevel: 75,
      zoomPublication: { camera: null } as CanvasZoomPublication,
      offsetRef: { current: { x: 70, y: 80 } },
      zoomRef: { current: 75 },
    };
    rerender(replacement);
    const replacementOwner = result.current.renderCamera.owner;
    act(() => result.current.scheduleCamera(80, { x: 50, y: 60 }));
    rerender({
      ...replacement,
      zoomLevel: 102,
      zoomPublication: { camera: oldEcho },
    });
    expect(result.current.renderCamera.owner).toBe(replacementOwner);
    expect(result.current.renderCamera.zoom).toBe(75);
    expect(replacement.zoomRef.current).toBe(80);
    expect(replacement.offsetRef.current).toEqual({ x: 50, y: 60 });
    expect(frames.size).toBe(1);
    flush();
    expect(result.current.renderCamera.zoom).toBe(80);
    expect(result.current.renderCamera.owner).toBe(replacementOwner);
    expect(changes.mock.calls.at(-1)![0]).toBe(80);
  });
  it.each([
    "scheduleCamera",
    "setCamera",
    "setPanOffset",
    "setOffset",
  ] as const)(
    "ignores a stale %s closure without changing the replacement owner's queued input",
    (method) => {
      const { result, options, rerender, changes } = renderCamera();
      const stale = result.current;
      const replacement = {
        ...options,
        ownerKey: "Day2:replacement-map",
        zoomLevel: 75,
        zoomPublication: { camera: null } as CanvasZoomPublication,
        offsetRef: { current: { x: 70, y: 80 } },
        zoomRef: { current: 75 },
      };
      rerender(replacement);
      const current = result.current.renderCamera;
      act(() => result.current.scheduleCamera(80, { x: 50, y: 60 }));
      act(() => {
        if (method === "scheduleCamera")
          stale.scheduleCamera(200, { x: 1, y: 2 });
        else if (method === "setCamera")
          stale.setCamera(200, { x: 1, y: 2 }, "center");
        else if (method === "setPanOffset") stale.setPanOffset({ x: 1, y: 2 });
        else stale.setOffset({ x: 1, y: 2 });
      });
      expect(result.current.renderCamera).toBe(current);
      expect(replacement.zoomRef.current).toBe(80);
      expect(replacement.offsetRef.current).toEqual({ x: 50, y: 60 });
      expect(options.zoomRef.current).toBe(100);
      expect(options.offsetRef.current).toEqual({ x: 0, y: 0 });
      expect(frames.size).toBe(1);
      expect(changes).not.toHaveBeenCalled();
      flush();
      expect(result.current.renderCamera).toMatchObject({
        zoom: 80,
        offset: { x: 50, y: 60 },
      });
      expect(changes).toHaveBeenCalledExactlyOnceWith(
        80,
        result.current.renderCamera,
      );
    },
  );
  it.each([{ rotationAngle: 37 }, { mapMaxCol: 30 }, { mapMaxRow: 30 }])(
    "invalidates callbacks with replaced drawing geometry: %j",
    (geometry) => {
      const { result, options, rerender } = renderCamera();
      const oldCamera = result.current.renderCamera;
      const oldGetDrawCamera = result.current.getDrawCamera;
      rerender({ ...options, ...geometry });
      expect(oldGetDrawCamera(oldCamera)).toBeNull();
      expect(
        result.current.getDrawCamera(result.current.renderCamera),
      ).not.toBeNull();
    },
  );

  it("hit-tests the painted camera and rotation while newer input or rotation awaits drawing", () => {
    const { result, options, rerender } = renderCamera();
    const initial = result.current.renderCamera;
    const staleMark = result.current.markCameraPainted;
    result.current.markCameraPainted(initial);
    act(() => result.current.scheduleCamera(110, { x: -30, y: -20 }));
    expect(result.current.getHitCamera()).toEqual({
      camera: initial,
      rotationAngle: 0,
    });
    const raster = result.current.getDrawCamera(initial, true)!;
    result.current.markCameraPainted(raster);
    act(() => result.current.scheduleCamera(120, { x: -60, y: -40 }));
    expect(result.current.getHitCamera()).toEqual({
      camera: raster,
      rotationAngle: 0,
    });
    rerender({ ...options, rotationAngle: 37 });
    expect(result.current.getHitCamera()).toEqual({
      camera: raster,
      rotationAngle: 0,
    });
    const rotated = result.current.getDrawCamera(
      result.current.renderCamera,
      true,
    )!;
    result.current.markCameraPainted(rotated);
    staleMark(initial);
    expect(result.current.getHitCamera()).toEqual({
      camera: rotated,
      rotationAngle: 37,
    });
  });
  it.each(["center", "restore"] as const)(
    "publishes an explicit %s camera atomically and supersedes pending input",
    (origin) => {
      const { result, changes, options, rerender } = renderCamera();
      act(() => result.current.scheduleCamera(102, { x: -6, y: -4 }));
      const staleCallback = [...frames.values()][0];
      act(() => result.current.setCamera(75, { x: 60, y: 45 }, origin));
      expect(frames.size).toBe(0);
      const camera = result.current.renderCamera;
      expect(camera).toMatchObject({
        zoom: 75,
        offset: { x: 60, y: 45 },
        origin,
      });
      expect(changes).toHaveBeenCalledExactlyOnceWith(75, camera);
      rerender({ ...options, zoomLevel: 75, zoomPublication: { camera } });
      expect(result.current.renderCamera).toBe(camera);
      expect(options.offsetRef.current).toEqual({ x: 60, y: 45 });
      act(() => staleCallback(16));
      expect(changes).toHaveBeenCalledTimes(1);
    },
  );

  it("cancels queued input at unmount even if a detached callback is invoked", () => {
    const { result, changes, unmount } = renderCamera();
    act(() => result.current.scheduleCamera(102, { x: -6, y: -4 }));
    const staleCallback = [...frames.values()][0];
    unmount();
    expect(frames.size).toBe(0);
    act(() => staleCallback(16));
    expect(changes).not.toHaveBeenCalled();
  });
});
