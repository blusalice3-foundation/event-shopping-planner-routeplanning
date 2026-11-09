import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { Point } from "./useCanvasViewport";

export interface CanvasCamera {
  readonly owner: object;
  readonly revision: number;
  readonly zoom: number;
  readonly offset: Point;
  readonly origin:
    | "initial"
    | "gesture"
    | "pan"
    | "external"
    | "center"
    | "restore";
}

/** A new receipt is issued for every writer, including external same-value writes. */
export interface CanvasZoomPublication {
  readonly camera: CanvasCamera | null;
}

interface Options {
  zoomLevel: number;
  zoomPublication?: CanvasZoomPublication;
  offsetRef: MutableRefObject<Point>;
  zoomRef: MutableRefObject<number>;
  ownerKey?: unknown;
  rotationAngle: number;
  mapMaxCol: number;
  mapMaxRow: number;
  baseCellSize: number;
  containerRef: RefObject<HTMLDivElement>;
  centerExternalZoom?: boolean;
  onCameraInput?: (camera: CanvasCamera) => void;
  onZoomChange?: (zoom: number, camera?: CanvasCamera) => void;
}

/** Keep input, React publication and each completed paint in one camera generation. */
export function useCanvasCamera({
  zoomLevel,
  zoomPublication,
  offsetRef,
  zoomRef,
  ownerKey,
  rotationAngle,
  mapMaxCol,
  mapMaxRow,
  baseCellSize,
  containerRef,
  centerExternalZoom = false,
  onZoomChange,
  onCameraInput,
}: Options) {
  const owner = useMemo(() => {
    // The opaque owner token must not retain a replaced map's cell arrays.
    void ownerKey;
    return { offsetRef, zoomRef };
  }, [offsetRef, zoomRef, ownerKey]);
  const activeOwner = useRef(owner);
  const initial = useRef<CanvasCamera>({
    owner,
    revision: 0,
    zoom: zoomLevel,
    offset: { ...offsetRef.current },
    origin: "initial",
  });
  const latest = useRef(initial.current);
  const [renderCamera, setRenderCamera] = useState(initial.current);
  const pending = useRef<CanvasCamera | null>(null);
  const frame = useRef<number | null>(null);
  const frameTicket = useRef<object | null>(null);
  const inputCallback = useRef(onCameraInput);
  inputCallback.current = onCameraInput;
  const callback = useRef(onZoomChange);
  callback.current = onZoomChange;
  const explicitPublication = useRef(zoomPublication !== undefined);
  explicitPublication.current = zoomPublication !== undefined;
  const publications = useRef(new WeakSet<CanvasCamera>());
  const lastPublication = useRef<CanvasCamera | null>(null);
  const observed = useRef({
    owner,
    zoomLevel,
    zoomPublication,
    receipt: lastPublication.current,
  });
  const lastPainted = useRef<CanvasCamera | null>(null);
  // Rotation/data dimensions belong to the callback's geometry, not to mutable input.
  const drawing = useMemo(
    () => ({ owner, rotationAngle, mapMaxCol, mapMaxRow, baseCellSize }),
    [owner, rotationAngle, mapMaxCol, mapMaxRow, baseCellSize],
  );
  const activeDrawing = useRef(drawing);
  const paintedDrawing = useRef(drawing);

  const cancelPendingCamera = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    frameTicket.current = null;
    pending.current = null;
  }, []);

  const updateCamera = useCallback(
    (zoom: number, offset: Point, origin: CanvasCamera["origin"]) => {
      if (owner !== activeOwner.current) return latest.current;
      const previous = latest.current;
      const camera: CanvasCamera = {
        owner,
        revision: previous.owner === owner ? previous.revision + 1 : 0,
        zoom,
        offset: { ...offset },
        origin,
      };
      latest.current = camera;
      offsetRef.current = camera.offset;
      zoomRef.current = zoom;
      inputCallback.current?.(camera);
      return camera;
    },
    [offsetRef, owner, zoomRef],
  );

  const commitCamera = useCallback((camera: CanvasCamera) => {
    if (camera.owner !== activeOwner.current) return;
    setRenderCamera((previous) =>
      previous.owner === camera.owner && previous.revision > camera.revision
        ? previous
        : camera,
    );
  }, []);

  const publishCamera = useCallback(
    (camera: CanvasCamera) => {
      if (camera.owner !== activeOwner.current) return;
      publications.current.add(camera);
      lastPublication.current = camera;
      commitCamera(camera);
      if (explicitPublication.current) callback.current?.(camera.zoom, camera);
      else callback.current?.(camera.zoom);
    },
    [commitCamera],
  );

  const flushCamera = useCallback(() => {
    const value = pending.current;
    cancelPendingCamera();
    if (value) publishCamera(value);
  }, [cancelPendingCamera, publishCamera]);

  const scheduleCamera = useCallback(
    (zoom: number, offset: Point) => {
      if (owner !== activeOwner.current) return;
      pending.current = updateCamera(zoom, offset, "gesture");
      if (frame.current !== null) return;
      const ticket = {};
      frameTicket.current = ticket;
      frame.current = requestAnimationFrame(() => {
        if (frameTicket.current === ticket) {
          frame.current = null;
          frameTicket.current = null;
          flushCamera();
        }
      });
    },
    [flushCamera, owner, updateCamera],
  );

  const setCamera = useCallback(
    (zoom: number, offset: Point, origin: "center" | "restore") => {
      if (owner !== activeOwner.current) return;
      cancelPendingCamera();
      publishCamera(updateCamera(zoom, offset, origin));
    },
    [cancelPendingCamera, owner, publishCamera, updateCamera],
  );

  const setPanOffset = useCallback(
    (offset: Point) => updateCamera(latest.current.zoom, offset, "pan"),
    [updateCamera],
  );
  const setOffset = useCallback(
    (offset: Point) => {
      if (owner !== activeOwner.current) return;
      const previous = latest.current;
      const camera =
        previous.offset.x === offset.x && previous.offset.y === offset.y
          ? previous
          : setPanOffset(offset);
      // A one-finger continuation can commit before the queued zoom publication.
      if (pending.current) pending.current = camera;
      commitCamera(camera);
    },
    [commitCamera, owner, setPanOffset],
  );

  useLayoutEffect(() => {
    activeDrawing.current = drawing;
    const previous = observed.current;
    const ownerChanged = activeOwner.current !== owner;
    const receipt = lastPublication.current;
    const changed =
      ownerChanged ||
      previous.zoomLevel !== zoomLevel ||
      previous.zoomPublication !== zoomPublication;
    observed.current = { owner, zoomLevel, zoomPublication, receipt };
    if (!changed) return;
    activeOwner.current = owner;
    if (ownerChanged) {
      cancelPendingCamera();
      lastPainted.current = null;
      const refsChanged =
        previous.owner.offsetRef !== offsetRef ||
        previous.owner.zoomRef !== zoomRef;
      // Replacing a drawing with retained refs must not transfer unpublished input.
      const base = refsChanged
        ? { zoom: zoomLevel, offset: offsetRef.current }
        : renderCamera;
      const camera = updateCamera(base.zoom, base.offset, "initial");
      commitCamera(camera);
      return;
    }
    const accepted = zoomPublication?.camera;
    // Legacy single-argument consumers are synchronous React setters. Their local
    // publication receipt must be new in this commit; numeric equality alone is
    // never used as an echo receipt. Production writers return explicit receipts.
    const synchronousReceipt =
      zoomPublication === undefined &&
      receipt !== previous.receipt &&
      receipt?.zoom === zoomLevel
        ? receipt
        : null;
    const echo = accepted ?? synchronousReceipt;
    if (echo && publications.current.has(echo)) {
      if (echo.owner === owner) commitCamera(echo);
      return;
    }
    // An explicit external request supersedes input, even when its zoom is equal
    // to an earlier pending value. Apply the center anchor exactly once.
    cancelPendingCamera();
    const base =
      lastPainted.current?.owner === owner ? lastPainted.current : renderCamera;
    const container = containerRef.current;
    const ratio = zoomLevel / base.zoom;
    const offset =
      centerExternalZoom && container
        ? {
            x:
              container.clientWidth / 2 -
              (container.clientWidth / 2 - base.offset.x) * ratio,
            y:
              container.clientHeight / 2 -
              (container.clientHeight / 2 - base.offset.y) * ratio,
          }
        : base.offset;
    commitCamera(updateCamera(zoomLevel, offset, "external"));
  }, [
    centerExternalZoom,
    commitCamera,
    containerRef,
    drawing,
    offsetRef,
    zoomRef,
    renderCamera,
    owner,
    updateCamera,
    zoomLevel,
    zoomPublication,
    cancelPendingCamera,
  ]);

  useLayoutEffect(() => cancelPendingCamera, [cancelPendingCamera]);

  const getDrawCamera = useCallback(
    (committed: CanvasCamera, preferLatest = false): CanvasCamera | null => {
      if (
        committed.owner !== activeOwner.current ||
        activeDrawing.current !== drawing
      )
        return null;
      const input = latest.current;
      if (input.owner !== committed.owner) return null;
      const camera =
        preferLatest || input.zoom === committed.zoom ? input : committed;
      const painted = lastPainted.current;
      return painted?.owner === camera.owner &&
        painted.revision > camera.revision
        ? null
        : camera;
    },
    [drawing],
  );
  const markCameraPainted = useCallback(
    (camera: CanvasCamera) => {
      if (
        camera.owner === activeOwner.current &&
        activeDrawing.current === drawing
      ) {
        lastPainted.current = camera;
        paintedDrawing.current = drawing;
      }
    },
    [drawing],
  );
  const isCameraOwnerCurrent = useCallback(
    () => owner === activeOwner.current,
    [owner],
  );
  const getHitCamera = useCallback(() => {
    const painted = lastPainted.current;
    return painted?.owner === activeOwner.current
      ? { camera: painted, rotationAngle: paintedDrawing.current.rotationAngle }
      : {
          camera: latest.current,
          rotationAngle: activeDrawing.current.rotationAngle,
        };
  }, []);

  return {
    renderCamera,
    scheduleCamera,
    flushCamera,
    setCamera,
    setOffset,
    setPanOffset,
    getDrawCamera,
    getHitCamera,
    isCameraOwnerCurrent,
    markCameraPainted,
    owner,
    latestCameraRef: latest,
  };
}
