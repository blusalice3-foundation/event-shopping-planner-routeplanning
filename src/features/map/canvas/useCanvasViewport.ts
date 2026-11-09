import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type React from "react";
import {
  useCanvasCamera,
  type CanvasCamera,
  type CanvasZoomPublication,
} from "./useCanvasCamera";
export type { CanvasCamera, CanvasZoomPublication } from "./useCanvasCamera";

export interface Point {
  x: number;
  y: number;
}

export const normalizeRotationAngle = (angle: number): number => {
  const normalized = Math.round(angle) % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

export const rotatePointAroundCenter = (
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  angleRad: number,
): Point => {
  if (angleRad === 0) return { x, y };
  const dx = x - centerX;
  const dy = y - centerY;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    x: dx * cos - dy * sin + centerX,
    y: dx * sin + dy * cos + centerY,
  };
};

interface UseCanvasViewportOptions {
  mapMaxCol: number;
  mapMaxRow: number;
  zoomLevel: number;
  rotationAngle?: number;
  coordinateScale?: number;
  baseCellSize: number;
  minZoom: number;
  maxZoom: number;
  initialOffset?: Point;
  offsetRef?: React.MutableRefObject<Point>;
  zoomRef?: React.MutableRefObject<number>;
  ownerKey?: unknown;
  zoomPublication?: CanvasZoomPublication;
  centerExternalZoom?: boolean;
  onCameraInput?: (camera: CanvasCamera) => void;
  onZoomChange?: (newZoom: number, camera?: CanvasCamera) => void;
  onRotationAngleChange?: (newAngle: number) => void;
}

export const useCanvasViewport = ({
  mapMaxCol,
  mapMaxRow,
  zoomLevel,
  rotationAngle = 0,
  coordinateScale = 1,
  baseCellSize,
  minZoom,
  maxZoom,
  initialOffset,
  offsetRef: externalOffsetRef,
  zoomRef: externalZoomRef,
  onZoomChange,
  onRotationAngleChange,
  ownerKey,
  zoomPublication,
  centerExternalZoom,
  onCameraInput,
}: UseCanvasViewportOptions) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const internalOffsetRef = useRef(initialOffset ?? { x: 0, y: 0 });
  const offsetRef = externalOffsetRef ?? internalOffsetRef;
  const internalZoomLevelRef = useRef(zoomLevel);
  const zoomLevelRef = externalZoomRef ?? internalZoomLevelRef;
  const viewportOwner = useRef({ offsetRef, zoomLevelRef, ownerKey });
  const viewportOwnerChanged =
    viewportOwner.current.offsetRef !== offsetRef ||
    viewportOwner.current.zoomLevelRef !== zoomLevelRef ||
    viewportOwner.current.ownerKey !== ownerKey;
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<Point>({ x: 0, y: 0 });
  const dragStartOffsetRef = useRef<Point>({ x: 0, y: 0 });
  const rafPendingRef = useRef(false);
  const drawCanvasRef = useRef<(() => void) | null>(null);
  const activeTouchesRef = useRef<Map<number, Point>>(new Map());
  const pinchStartDistRef = useRef(0);
  const pinchStartZoomRef = useRef(zoomLevel);
  const pinchStartOffsetRef = useRef<Point>({ x: 0, y: 0 });
  const pinchStartCenterRef = useRef<Point>({ x: 0, y: 0 });
  const isPinchGestureRef = useRef(false);
  // Keep the gesture history through the final pointerup, regardless of touchend order.
  const hadPinchGestureRef = useRef(false);
  const suppressClickUntilRef = useRef(0);
  const prevCellSizeRef = useRef(baseCellSize * (zoomLevel / 100));
  const [isRotationInteracting, setIsRotationInteracting] = useState(false);
  const [isViewportInteracting, setIsViewportInteracting] = useState(false);
  const viewportIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
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
    latestCameraRef,
  } = useCanvasCamera({
    zoomLevel,
    zoomPublication,
    offsetRef,
    zoomRef: zoomLevelRef,
    ownerKey,
    rotationAngle: normalizeRotationAngle(rotationAngle),
    mapMaxCol,
    mapMaxRow,
    baseCellSize,
    containerRef,
    centerExternalZoom,
    onZoomChange,
    onCameraInput,
  });
  const offset = renderCamera.offset;
  const setOffsetState = setOffset;
  const scheduleZoom = useCallback(
    (newZoom: number, newOffset: Point) => {
      scheduleCamera(newZoom, newOffset);
      setIsViewportInteracting(true);
      if (viewportIdleTimer.current !== null)
        clearTimeout(viewportIdleTimer.current);
      viewportIdleTimer.current = setTimeout(
        () => setIsViewportInteracting(false),
        150,
      );
    },
    [scheduleCamera],
  );
  useEffect(
    () => () => {
      if (viewportIdleTimer.current !== null)
        clearTimeout(viewportIdleTimer.current);
    },
    [],
  );
  // A new external viewport owner must never receive an old gesture or offset.
  useLayoutEffect(() => {
    if (!viewportOwnerChanged) return;
    viewportOwner.current = { offsetRef, zoomLevelRef, ownerKey };
    if (viewportIdleTimer.current !== null)
      clearTimeout(viewportIdleTimer.current);
    viewportIdleTimer.current = null;
    // Releases from the old owner still reach this retained canvas. Keep their
    // tap-suppression marker until the next pointerdown starts a fresh input.
    hadPinchGestureRef.current =
      hadPinchGestureRef.current ||
      isDraggingRef.current ||
      activeTouchesRef.current.size > 0;
    if (hadPinchGestureRef.current) {
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      suppressClickUntilRef.current = now + 450;
    }
    activeTouchesRef.current.clear();
    pinchStartDistRef.current = 0;
    pinchStartZoomRef.current = zoomLevelRef.current;
    pinchStartOffsetRef.current = { ...offsetRef.current };
    pinchStartCenterRef.current = { x: 0, y: 0 };
    isPinchGestureRef.current = false;
    isDraggingRef.current = false;
    dragStartRef.current = { x: 0, y: 0 };
    dragStartOffsetRef.current = { ...offsetRef.current };
    prevCellSizeRef.current = baseCellSize * (zoomLevelRef.current / 100);
    setIsDragging(false);
    setIsViewportInteracting(false);
  }, [
    baseCellSize,
    offsetRef,
    ownerKey,
    viewportOwnerChanged,
    zoomLevel,
    zoomLevelRef,
  ]);
  const rotationInteractionTimerRef = useRef<number | null>(null);

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const scale = renderCamera.zoom / 100;
  const cellSize = baseCellSize * scale;

  const normalizedRotationAngle = useMemo(
    () => normalizeRotationAngle(rotationAngle),
    [rotationAngle],
  );
  const rotationRadians = useMemo(
    () => (normalizedRotationAngle * Math.PI) / 180,
    [normalizedRotationAngle],
  );
  const mapCenterX = useMemo(
    () => (mapMaxCol * cellSize) / 2,
    [mapMaxCol, cellSize],
  );
  const mapCenterY = useMemo(
    () => (mapMaxRow * cellSize) / 2,
    [mapMaxRow, cellSize],
  );

  const toMapCoordinates = useCallback(
    (viewX: number, viewY: number, currentOffset?: Point) => {
      const hit = currentOffset ? null : getHitCamera();
      const hitCellSize = hit
        ? baseCellSize * (hit.camera.zoom / 100)
        : cellSize;
      const ofs = currentOffset ?? hit!.camera.offset;
      const translatedX = viewX - ofs.x;
      const translatedY = viewY - ofs.y;
      const angle = hit ? (hit.rotationAngle * Math.PI) / 180 : rotationRadians;
      // Consumers divide by the render's cell size. Convert the painted camera's
      // coordinates into that geometry after hit testing its actual transform.
      const toRenderScale = cellSize / hitCellSize;
      if (angle === 0)
        return {
          x: translatedX * toRenderScale,
          y: translatedY * toRenderScale,
        };
      const centerX = (mapMaxCol * hitCellSize) / 2;
      const centerY = (mapMaxRow * hitCellSize) / 2;
      const dx = translatedX - centerX;
      const dy = translatedY - centerY;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return {
        x: (dx * cos + dy * sin + centerX) * toRenderScale,
        y: (-dx * sin + dy * cos + centerY) * toRenderScale,
      };
    },
    [
      baseCellSize,
      cellSize,
      getHitCamera,
      mapMaxCol,
      mapMaxRow,
      rotationRadians,
    ],
  );

  const rotateAroundMapCenter = useCallback(
    (x: number, y: number, angleRad = rotationRadians) =>
      rotatePointAroundCenter(x, y, mapCenterX, mapCenterY, angleRad),
    [mapCenterX, mapCenterY, rotationRadians],
  );

  const calculateOffsetForZoomPoint = useCallback(
    (
      viewX: number,
      viewY: number,
      newZoom: number,
      options?: {
        baseZoom?: number;
        baseOffset?: Point;
      },
    ) => {
      const baseZoom = options?.baseZoom ?? zoomLevelRef.current;
      const baseOffset = options?.baseOffset ?? offsetRef.current;
      const currentCellSize = baseCellSize * (baseZoom / 100);
      const newCellSize = baseCellSize * (newZoom / 100);
      const translatedX = viewX - baseOffset.x;
      const translatedY = viewY - baseOffset.y;
      let mapPointX = translatedX;
      let mapPointY = translatedY;

      if (rotationRadians !== 0) {
        const currentMapCenterX = (mapMaxCol * currentCellSize) / 2;
        const currentMapCenterY = (mapMaxRow * currentCellSize) / 2;
        const dx = translatedX - currentMapCenterX;
        const dy = translatedY - currentMapCenterY;
        const cos = Math.cos(rotationRadians);
        const sin = Math.sin(rotationRadians);
        mapPointX = dx * cos + dy * sin + currentMapCenterX;
        mapPointY = -dx * sin + dy * cos + currentMapCenterY;
      }

      const normalizedMapX = mapPointX / currentCellSize;
      const normalizedMapY = mapPointY / currentCellSize;
      const scaledMapX = normalizedMapX * newCellSize;
      const scaledMapY = normalizedMapY * newCellSize;
      const newMapCenterX = (mapMaxCol * newCellSize) / 2;
      const newMapCenterY = (mapMaxRow * newCellSize) / 2;
      const rotatedPoint = rotatePointAroundCenter(
        scaledMapX,
        scaledMapY,
        newMapCenterX,
        newMapCenterY,
        rotationRadians,
      );
      return {
        x: viewX - rotatedPoint.x,
        y: viewY - rotatedPoint.y,
      };
    },
    [
      baseCellSize,
      mapMaxCol,
      mapMaxRow,
      offsetRef,
      rotationRadians,
      zoomLevelRef,
    ],
  );

  const getPointerViewMetrics = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      // Hit testing uses logical CSS size, independently of capped pixel buffers.
      const width =
        canvas.clientWidth ||
        containerRef.current?.clientWidth ||
        canvas.width / dpr;
      const height =
        canvas.clientHeight ||
        containerRef.current?.clientHeight ||
        canvas.height / dpr;
      const scaleX = width / rect.width;
      const scaleY = height / rect.height;

      return {
        viewX: (clientX - rect.left) * scaleX,
        viewY: (clientY - rect.top) * scaleY,
      };
    },
    [dpr],
  );

  useLayoutEffect(() => {
    prevCellSizeRef.current = cellSize;
  }, [cellSize]);
  useEffect(() => {
    setIsRotationInteracting(true);
    if (rotationInteractionTimerRef.current !== null) {
      clearTimeout(rotationInteractionTimerRef.current);
    }
    rotationInteractionTimerRef.current = window.setTimeout(() => {
      setIsRotationInteracting(false);
      rotationInteractionTimerRef.current = null;
    }, 150);

    return () => {
      if (rotationInteractionTimerRef.current !== null) {
        clearTimeout(rotationInteractionTimerRef.current);
      }
    };
  }, [normalizedRotationAngle]);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!isCameraOwnerCurrent()) return;
      e.preventDefault();
      if (e.shiftKey && onRotationAngleChange) {
        const delta = e.deltaY < 0 ? -15 : 15;
        onRotationAngleChange(normalizeRotationAngle(rotationAngle + delta));
        return;
      }
      if (!onZoomChange) return;

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const viewX = (e.clientX - rect.left) / coordinateScale;
      const viewY = (e.clientY - rect.top) / coordinateScale;
      const currentZoom = zoomLevelRef.current;
      const zoomDelta = -e.deltaY * 0.1;
      const newZoom = Math.round(
        Math.max(minZoom, Math.min(maxZoom, currentZoom + zoomDelta)),
      );

      if (newZoom === currentZoom) return;

      const newOffset = calculateOffsetForZoomPoint(viewX, viewY, newZoom, {
        baseZoom: currentZoom,
        baseOffset: offsetRef.current,
      });

      scheduleZoom(newZoom, newOffset);
    },
    [
      calculateOffsetForZoomPoint,
      isCameraOwnerCurrent,
      coordinateScale,
      maxZoom,
      minZoom,
      offsetRef,
      onRotationAngleChange,
      onZoomChange,
      rotationAngle,
      scheduleZoom,
      zoomLevelRef,
    ],
  );

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!isCameraOwnerCurrent()) return;
      if (activeTouchesRef.current.size === 0) {
        hadPinchGestureRef.current = false;
      }
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        activeTouchesRef.current.set(touch.identifier, {
          x: touch.clientX,
          y: touch.clientY,
        });
      }

      if (activeTouchesRef.current.size >= 2) {
        hadPinchGestureRef.current = true;
      }

      if (activeTouchesRef.current.size === 2) {
        isPinchGestureRef.current = true;
        isDraggingRef.current = false;
        setIsDragging(false);
        e.preventDefault();
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const touches = Array.from(activeTouchesRef.current.values());
        const dx = touches[1].x - touches[0].x;
        const dy = touches[1].y - touches[0].y;
        pinchStartDistRef.current = Math.sqrt(dx * dx + dy * dy);
        pinchStartZoomRef.current = zoomLevelRef.current;
        pinchStartOffsetRef.current = { ...offsetRef.current };
        pinchStartCenterRef.current = {
          x: ((touches[0].x + touches[1].x) / 2 - rect.left) / coordinateScale,
          y: ((touches[0].y + touches[1].y) / 2 - rect.top) / coordinateScale,
        };
      }
    },
    [coordinateScale, isCameraOwnerCurrent, offsetRef, zoomLevelRef],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isCameraOwnerCurrent()) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        activeTouchesRef.current.set(touch.identifier, {
          x: touch.clientX,
          y: touch.clientY,
        });
      }

      if (activeTouchesRef.current.size === 2 && onZoomChange) {
        hadPinchGestureRef.current = true;
        isPinchGestureRef.current = true;
        e.preventDefault();
        const touches = Array.from(activeTouchesRef.current.values());
        const dx = touches[1].x - touches[0].x;
        const dy = touches[1].y - touches[0].y;
        const currentDist = Math.sqrt(dx * dx + dy * dy);

        if (pinchStartDistRef.current === 0) return;

        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const midX =
          ((touches[0].x + touches[1].x) / 2 - rect.left) / coordinateScale;
        const midY =
          ((touches[0].y + touches[1].y) / 2 - rect.top) / coordinateScale;
        const scaleRatio = currentDist / pinchStartDistRef.current;
        const newZoom = Math.round(
          Math.max(
            minZoom,
            Math.min(maxZoom, pinchStartZoomRef.current * scaleRatio),
          ),
        );

        const startCenter = pinchStartCenterRef.current;
        const anchoredOffset = calculateOffsetForZoomPoint(
          startCenter.x,
          startCenter.y,
          newZoom,
          {
            baseZoom: pinchStartZoomRef.current,
            baseOffset: pinchStartOffsetRef.current,
          },
        );
        // The original map point follows the fingers even at a zoom limit.
        const newOffset = {
          x: anchoredOffset.x + midX - startCenter.x,
          y: anchoredOffset.y + midY - startCenter.y,
        };
        if (
          newZoom === zoomLevelRef.current &&
          newOffset.x === offsetRef.current.x &&
          newOffset.y === offsetRef.current.y
        )
          return;

        scheduleZoom(newZoom, newOffset);
      }
    },
    [
      calculateOffsetForZoomPoint,
      isCameraOwnerCurrent,
      coordinateScale,
      maxZoom,
      minZoom,
      onZoomChange,
      offsetRef,
      scheduleZoom,
      zoomLevelRef,
    ],
  );

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (!isCameraOwnerCurrent()) return;
      if (hadPinchGestureRef.current) {
        const now =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        suppressClickUntilRef.current = now + 450;
      }
      for (let i = 0; i < e.changedTouches.length; i++) {
        activeTouchesRef.current.delete(e.changedTouches[i].identifier);
      }

      if (activeTouchesRef.current.size < 2) {
        flushCamera();
        if (viewportIdleTimer.current !== null)
          clearTimeout(viewportIdleTimer.current);
        setIsViewportInteracting(false);
        pinchStartDistRef.current = 0;
        isPinchGestureRef.current = false;
        isDraggingRef.current = false;
        setIsDragging(false);

        if (activeTouchesRef.current.size === 1) {
          const remainingTouch = Array.from(
            activeTouchesRef.current.values(),
          )[0];
          dragStartRef.current = { x: remainingTouch.x, y: remainingTouch.y };
          dragStartOffsetRef.current = { ...offsetRef.current };
        }
      }
    },
    [offsetRef, flushCamera, isCameraOwnerCurrent],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("wheel", handleWheel, { passive: false });
    container.addEventListener("touchstart", handleTouchStart, {
      passive: false,
    });
    container.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });
    container.addEventListener("touchend", handleTouchEnd);
    container.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [handleWheel, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return {
    renderCamera,
    getDrawCamera,
    getHitCamera,
    isCameraOwnerCurrent,
    markCameraPainted,
    setCamera,
    setPanOffset,
    latestCameraRef,
    activeTouchesRef,
    calculateOffsetForZoomPoint,
    canvasRef,
    cellSize,
    containerRef,
    dpr,
    dragStartOffsetRef,
    dragStartRef,
    drawCanvasRef,
    getPointerViewMetrics,
    hadPinchGestureRef,
    isDragging,
    isDraggingRef,
    isPinchGestureRef,
    isRotationInteracting,
    isViewportInteracting,
    mapCenterX,
    mapCenterY,
    normalizedRotationAngle,
    offset,
    offsetRef,
    prevCellSizeRef,
    rafPendingRef,
    rotateAroundMapCenter,
    rotationRadians,
    setIsDragging,
    setOffset,
    setOffsetState,
    suppressClickUntilRef,
    toMapCoordinates,
    zoomLevelRef,
  };
};
