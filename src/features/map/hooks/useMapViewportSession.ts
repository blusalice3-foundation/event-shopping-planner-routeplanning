import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { DayMapData, MapViewportState } from "../../../types/map";

type SaveViewport = ((viewport: MapViewportState) => void) | undefined;
type ViewportOwner = {
  key: string;
  hadStoredViewport: boolean;
  zoomRef: MutableRefObject<number>;
  offsetRef: MutableRefObject<{ x: number; y: number }>;
  initial: MapViewportState;
  published?: MapViewportState;
  save: SaveViewport;
};

type DrawingSource = Pick<
  DayMapData,
  "cells" | "mergedCells" | "maxRow" | "maxCol"
>;
const drawingIds = new WeakMap<object, number>();
let nextDrawingId = 0;
const drawingId = (value: object): number => {
  let id = drawingIds.get(value);
  if (id === undefined) {
    id = ++nextDrawingId;
    drawingIds.set(value, id);
  }
  return id;
};
const sameViewport = (first: MapViewportState, second: MapViewportState) =>
  first.zoomLevel === second.zoomLevel &&
  first.offsetX === second.offsetX &&
  first.offsetY === second.offsetY;

const createOwner = (
  key: string,
  viewport?: MapViewportState,
  hadStoredViewport = viewport !== undefined,
): ViewportOwner => {
  const initial = viewport ?? { zoomLevel: 100, offsetX: 0, offsetY: 0 };
  return {
    key,
    hadStoredViewport,
    zoomRef: { current: initial.zoomLevel },
    offsetRef: { current: { x: initial.offsetX, y: initial.offsetY } },
    initial: { ...initial },
    save: undefined,
  };
};

/** Keep pending canvas input and its save callback owned by one committed map. */
export function useMapViewportSession(
  scope: string,
  initialViewport?: MapViewportState,
  onViewportChange?: SaveViewport,
  drawing?: DrawingSource,
) {
  const key = JSON.stringify([
    scope,
    drawing ? drawingId(drawing.cells) : 0,
    drawing ? drawingId(drawing.mergedCells) : 0,
    drawing?.maxRow,
    drawing?.maxCol,
  ]);
  const recentViewports = useRef(
    new Map<
      string,
      { viewport: MapViewportState; hadStoredViewport: boolean }
    >(),
  );
  const [state, setState] = useState(() => ({
    owner: createOwner(key, initialViewport),
    zoom: initialViewport?.zoomLevel ?? 100,
  }));
  const storedViewportRemoved =
    state.owner.key === key &&
    state.owner.hadStoredViewport &&
    initialViewport === undefined;
  if (state.owner.key !== key || storedViewportRemoved) {
    const recent = recentViewports.current.get(key);
    const canReuseRecent =
      !storedViewportRemoved &&
      recent &&
      (!recent.hadStoredViewport || initialViewport !== undefined);
    const viewport = canReuseRecent ? recent.viewport : initialViewport;
    setState({
      owner: createOwner(key, viewport, initialViewport !== undefined),
      zoom: viewport?.zoomLevel ?? 100,
    });
  }
  const { owner, zoom } = state;

  useLayoutEffect(() => {
    // Capture only after commit. A later map replacement must not lend its
    // callback to input that still belongs to this owner.
    owner.save ??= onViewportChange;
    if (initialViewport !== undefined) owner.hadStoredViewport = true;
  }, [initialViewport, onViewportChange, owner]);

  useLayoutEffect(
    () => () => {
      // A quick return can precede the asynchronous save's UI projection.
      // Retain only small viewport values, never map data or DOM nodes.
      const recent = recentViewports.current;
      recent.delete(owner.key);
      recent.set(owner.key, {
        viewport: {
          zoomLevel: owner.zoomRef.current,
          offsetX: owner.offsetRef.current.x,
          offsetY: owner.offsetRef.current.y,
        },
        hadStoredViewport: owner.hadStoredViewport,
      });
      if (recent.size > 32) recent.delete(recent.keys().next().value!);
    },
    [owner],
  );

  useEffect(
    () => () => {
      const viewport = {
        zoomLevel: owner.zoomRef.current,
        offsetX: owner.offsetRef.current.x,
        offsetY: owner.offsetRef.current.y,
      };
      if (
        !owner.save ||
        sameViewport(owner.published ?? owner.initial, viewport)
      )
        return;
      owner.save(viewport);
      owner.published = viewport;
    },
    [owner],
  );

  const setZoomLevel = useCallback(
    (newZoom: number) => {
      owner.zoomRef.current = newZoom;
      setState((current) =>
        current.owner === owner && current.zoom !== newZoom
          ? { owner, zoom: newZoom }
          : current,
      );
    },
    [owner],
  );

  return {
    zoomLevel: zoom,
    zoomLevelRef: owner.zoomRef,
    canvasOffsetRef: owner.offsetRef,
    setZoomLevel,
  };
}
