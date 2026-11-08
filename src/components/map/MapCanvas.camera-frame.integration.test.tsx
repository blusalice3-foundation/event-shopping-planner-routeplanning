import React, { useState } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DayMapData, NumberCellOutlineStyle } from "../../types/map";
import type {
  CanvasCamera,
  CanvasZoomPublication,
} from "../../features/map/canvas/useCanvasCamera";
import FocusModeMapCanvas from "../FocusModeMapCanvas";
import MapCanvas from "./MapCanvas";

type Point = { x: number; y: number };
type Matrix = [number, number, number, number, number, number];
type CameraFrame = { a: Point; b: Point; paint: number };
type RecordedContext = { markers: Map<string, Point>; matrix: Matrix };
type Mode = "normal" | "focus";
const empty: never[] = [];
const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const project = (m: Matrix, x: number, y: number): Point => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});
const data: DayMapData = {
  maxRow: 20,
  maxCol: 20,
  cells: [10, 12].map((col, index) => ({
    row: 8,
    col,
    value: index === 0 ? "A" : "B",
    backgroundColor: null,
    borders: { top: null, bottom: null, left: null, right: null },
  })),
  mergedCells: [],
  blocks: [],
};

const frames = new Map<number, FrameRequestCallback>();
const records: CameraFrame[] = [];
let width = 600;
let height = 400;
let mainCanvas: HTMLCanvasElement | undefined;
let contexts: Map<HTMLCanvasElement, RecordedContext>;
let paint = 0;
let resize: ResizeObserverCallback;

const record = (canvas: HTMLCanvasElement, state: RecordedContext) => {
  if (canvas !== mainCanvas) return;
  const a = state.markers.get("A");
  const b = state.markers.get("B");
  if (!a || !b) return;
  const scale = canvas.width / width;
  records.push({
    a: { x: a.x / scale, y: a.y / scale },
    b: { x: b.x / scale, y: b.y / scale },
    paint: ++paint,
  });
};

const installDrawingContexts = (cache: boolean) => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      if (!cache && this !== mainCanvas && mainCanvas) return null;
      let state = contexts.get(this);
      if (!state) {
        state = { markers: new Map(), matrix: identity() };
        contexts.set(this, state);
      }
      const current = state;
      const stack: Matrix[] = [];
      const methods = {
        canvas: this,
        measureText: (text: string) => ({ width: text.length * 8 }),
        getLineDash: () => [],
        save: () => stack.push([...current.matrix]),
        restore: () => {
          current.matrix = stack.pop() ?? identity();
        },
        setTransform: (...m: Matrix) => {
          current.matrix = m;
        },
        translate: (x: number, y: number) => {
          current.matrix = multiply(current.matrix, [1, 0, 0, 1, x, y]);
        },
        rotate: (radians: number) => {
          const c = Math.cos(radians);
          const s = Math.sin(radians);
          current.matrix = multiply(current.matrix, [c, s, -s, c, 0, 0]);
        },
        scale: (x: number, y: number) => {
          current.matrix = multiply(current.matrix, [x, 0, 0, y, 0, 0]);
        },
        clearRect: () => current.markers.clear(),
        fillText: (text: string, x: number, y: number) => {
          if (text !== "A" && text !== "B") return;
          current.markers.set(text, project(current.matrix, x, y));
          if (text === "B") record(this, current);
        },
        drawImage: (source: HTMLCanvasElement, x: number, y: number) => {
          const from = contexts.get(source);
          if (!from) return;
          for (const [text, point] of from.markers) {
            current.markers.set(
              text,
              project(current.matrix, point.x + x, point.y + y),
            );
          }
          record(this, current);
        },
      };
      return new Proxy(methods, {
        get: (target, key) => Reflect.get(target, key) ?? (() => {}),
      }) as unknown as CanvasRenderingContext2D;
    },
  );
};

const flush = (inject?: () => void) => {
  const batch = [...frames.entries()];
  for (const [id] of batch) frames.delete(id);
  act(() => {
    for (const [, callback] of batch) callback(16);
    inject?.();
  });
};
const settle = () => {
  for (let i = 0; frames.size > 0 && i < 8; i++) flush();
  expect(frames.size).toBe(0);
};
const sampleScale = (frame: CameraFrame, initial: CameraFrame) =>
  Math.hypot(frame.a.x - frame.b.x, frame.a.y - frame.b.y) /
  Math.hypot(initial.a.x - initial.b.x, initial.a.y - initial.b.y);

const renderMap = (
  mode: Mode,
  appZoom: number,
  rotation: number,
  cache: boolean,
) => {
  installDrawingContexts(cache);
  const offsetRef = { current: { x: 0, y: 0 } };
  let setExternalZoom: (zoom: number) => void = () => {};
  let updateData: () => void = () => {};
  let displayedZoom = 100;
  const Harness = () => {
    const [state, setState] = useState({
      zoom: 100,
      publication: { camera: null } as CanvasZoomPublication,
    });
    const [outline, setOutline] = useState<NumberCellOutlineStyle>("rounded");
    displayedZoom = state.zoom;
    setExternalZoom = (zoom) =>
      setState({ zoom, publication: { camera: null } });
    updateData = () => setOutline("square");
    const common = {
      mapData: data,
      mapName: "Day1",
      items: empty,
      executeModeItemIds: empty,
      zoomLevel: state.zoom,
      zoomPublication: state.publication,
      numberCellOutlineStyle: outline,
      rotationAngle: rotation,
      onZoomChange: (zoom: number, camera?: CanvasCamera) =>
        setState({ zoom, publication: { camera: camera ?? null } }),
      onCellClick: () => {},
    };
    return mode === "normal" ? (
      <MapCanvas {...common} offsetRef={offsetRef} isRouteVisible={false} />
    ) : (
      <FocusModeMapCanvas
        {...common}
        appZoomLevel={appZoom}
        selectedHall={null}
        currentVisitKey={null}
        nextVisitKey={null}
        prevVisitKey={null}
        currentPhase="normal"
      />
    );
  };
  const view = render(<Harness />);
  mainCanvas = view.container.querySelector("canvas")!;
  settle();
  expect(records.length).toBeGreaterThan(0);
  const initial = records.at(-1)!;
  records.length = 0;
  const coordinateScale = mode === "focus" ? appZoom / 100 : 1;
  const contact = (identifier: number, zoom: number, center: Point) => ({
    identifier,
    clientX:
      60 +
      (center.x + (identifier === 1 ? -zoom / 2 : zoom / 2)) * coordinateScale,
    clientY: 80 + center.y * coordinateScale,
  });
  const center = { x: 300, y: 200 };
  const start = () =>
    fireEvent.touchStart(mainCanvas!, {
      changedTouches: [contact(1, 100, center), contact(2, 100, center)],
    });
  const move = (zoom: number, focal = center) =>
    fireEvent.touchMove(mainCanvas!, {
      changedTouches: [contact(1, zoom, focal), contact(2, zoom, focal)],
    });
  const end = (zoom: number, focal = center) =>
    fireEvent.touchEnd(mainCanvas!, {
      changedTouches: [contact(1, zoom, focal), contact(2, zoom, focal)],
    });
  return {
    ...view,
    initial,
    offsetRef,
    start,
    move,
    end,
    center,
    displayedZoom: () => displayedZoom,
    externalZoom: (zoom: number) => act(() => setExternalZoom(zoom)),
    invalidateContent: () => act(updateData),
  };
};

beforeEach(() => {
  frames.clear();
  records.length = 0;
  contexts = new Map();
  width = 600;
  height = 400;
  paint = 0;
  mainCanvas = undefined;
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    () => width,
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    () => height,
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        x: 60,
        y: 80,
        left: 60,
        top: 80,
        right: 660,
        bottom: 480,
        width: 600,
        height: 400,
        toJSON: () => ({}),
      }) as DOMRect,
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each<Mode>(["normal", "focus"])(
  "%s map camera frame coherence",
  (mode) => {
    it.each(
      [false, true].flatMap((cache) =>
        [0, 37].flatMap((rotation) =>
          [75, 100, 150].map((appZoom, index) => ({
            cache,
            rotation,
            appZoom,
            dpr: index + 1,
            growing: index !== 1,
            moving: index !== 0,
          })),
        ),
      ),
    )(
      "keeps every frame coherent (cache=$cache rotation=$rotation app=$appZoom DPR=$dpr growing=$growing moving=$moving)",
      ({ cache, rotation, appZoom, dpr, growing, moving }) => {
        vi.stubGlobal("devicePixelRatio", dpr);
        const map = renderMap(mode, appZoom, rotation, cache);
        // The displayed Focus canvas is CSS-scaled by the app-level zoom.
        if (mode === "focus") {
          const scale = appZoom / 100;
          vi.spyOn(mainCanvas!, "getBoundingClientRect").mockReturnValue({
            left: 60,
            top: 80,
            width: width * scale,
            height: height * scale,
          } as DOMRect);
        }
        const inputs = growing
          ? [102, 103, 106, 107, 111]
          : [98, 97, 94, 93, 89];
        const sampleCenters = new Map<number, Point>([[100, map.center]]);
        map.start();
        for (const [index, zoom] of inputs.entries()) {
          const focal = moving
            ? { x: 300 + (index + 1) * 3, y: 200 - (index + 1) * 2 }
            : map.center;
          sampleCenters.set(zoom, focal);
          map.move(zoom, focal);
          flush();
        }
        expect(records.length).toBeGreaterThanOrEqual(3);
        map.end(inputs.at(-1)!, sampleCenters.get(inputs.at(-1)!)!);
        settle();
        expect(map.displayedZoom()).toBe(inputs.at(-1));
        expect(records.length).toBeGreaterThanOrEqual(4);
        let previous = 100;
        for (const frame of records) {
          const ratio = sampleScale(frame, map.initial);
          const zoom = Math.round(ratio * 100);
          expect(ratio * 100).toBeCloseTo(zoom, 6);
          const focal = sampleCenters.get(zoom);
          expect(
            focal,
            "a frame must correspond to a real input sample",
          ).toBeDefined();
          for (const marker of ["a", "b"] as const) {
            expect(frame[marker].x).toBeCloseTo(
              focal!.x + (map.initial[marker].x - map.center.x) * ratio,
              6,
            );
            expect(frame[marker].y).toBeCloseTo(
              focal!.y + (map.initial[marker].y - map.center.y) * ratio,
              6,
            );
          }
          expect(growing ? zoom >= previous : zoom <= previous).toBe(true);
          previous = zoom;
        }
        expect(previous).toBe(inputs.at(-1));
      },
    );

    it("publishes the latest pinch before commit without applying a second center correction", () => {
      const map = renderMap(mode, 100, 0, true);
      map.start();
      map.move(102);
      flush(() => map.move(104));
      flush();
      settle();
      expect(map.displayedZoom()).toBe(104);
      if (mode === "normal") {
        expect(map.offsetRef.current.x).toBeCloseTo(-12, 6);
        expect(map.offsetRef.current.y).toBeCloseTo(-8, 6);
      }
      map.end(104);
      settle();
      const last = records.at(-1)!;
      expect(sampleScale(last, map.initial)).toBeCloseTo(1.04, 6);
      expect(last.a.x).toBeCloseTo(300 + (map.initial.a.x - 300) * 1.04, 6);
      expect(last.a.y).toBeCloseTo(200 + (map.initial.a.y - 200) * 1.04, 6);
    });

    it("keeps rendering after raster style invalidation and a resize during continuous input", () => {
      const map = renderMap(mode, 100, 0, true);
      map.start();
      map.move(102);
      flush();
      map.move(104);
      flush();
      const beforeInvalidation = records.length;
      map.invalidateContent();
      width = 620;
      act(() => {
        if (mode === "focus") resize([], {} as ResizeObserver);
        else fireEvent(window, new Event("resize"));
      });
      for (const zoom of [106, 108, 110, 112]) {
        map.move(zoom);
        flush();
      }
      const beforeRelease = records.length;
      expect(beforeRelease).toBeGreaterThanOrEqual(beforeInvalidation + 2);
      map.end(112);
      settle();
      expect(records.length).toBeGreaterThanOrEqual(beforeRelease);
      expect(sampleScale(records.at(-1)!, map.initial)).toBeCloseTo(1.12, 6);
      expect(mainCanvas!.width).toBe(620);
      let previous = 1;
      for (const frame of records) {
        const ratio = sampleScale(frame, map.initial);
        expect(ratio).toBeGreaterThanOrEqual(previous - 1e-8);
        expect(frame.a.x).toBeCloseTo(300 + (map.initial.a.x - 300) * ratio, 6);
        expect(frame.a.y).toBeCloseTo(200 + (map.initial.a.y - 200) * ratio, 6);
        previous = ratio;
      }
    });

    it("retains coherent full rendering when the raster pixel budget is exceeded", () => {
      width = 2200;
      height = 2000;
      const map = renderMap(mode, 100, 37, true);
      expect(mainCanvas!.width * mainCanvas!.height).toBeGreaterThan(
        4 * 1024 * 1024,
      );
      map.start();
      for (const zoom of [102, 104, 106, 108, 110]) {
        map.move(zoom);
        flush();
      }
      expect(records.length).toBeGreaterThanOrEqual(3);
      map.end(110);
      settle();
      let previous = 1;
      for (const frame of records) {
        const ratio = sampleScale(frame, map.initial);
        expect(ratio).toBeGreaterThanOrEqual(previous - 1e-8);
        expect(frame.a.x).toBeCloseTo(300 + (map.initial.a.x - 300) * ratio, 6);
        expect(frame.a.y).toBeCloseTo(200 + (map.initial.a.y - 200) * ratio, 6);
        previous = ratio;
      }
      expect(previous).toBeCloseTo(1.1, 6);
    });
  },
);

it("preserves the viewport center for an external normal-map zoom", () => {
  const map = renderMap("normal", 100, 37, true);
  map.externalZoom(150);
  settle();
  const last = records.at(-1)!;
  expect(sampleScale(last, map.initial)).toBeCloseTo(1.5, 6);
  expect(last.a.x).toBeCloseTo(300 + (map.initial.a.x - 300) * 1.5, 6);
  expect(last.a.y).toBeCloseTo(200 + (map.initial.a.y - 200) * 1.5, 6);
});
