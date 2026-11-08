// Keep a single visible backing store below 64 MiB, including at low app zoom.
// CSS dimensions and map coordinates stay unchanged when resolution is capped.
export const MAX_CANVAS_BACKING_PIXELS = 16 * 1024 * 1024;
export const MAX_CANVAS_BACKING_DIMENSION = 8192;

export function getCanvasBackingSize(
  width: number,
  height: number,
  dpr: number,
) {
  const logicalWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const logicalHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const requestedScale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const area = logicalWidth * logicalHeight;
  const scale = Math.min(
    requestedScale,
    MAX_CANVAS_BACKING_DIMENSION / Math.max(1, logicalWidth, logicalHeight),
    area > 0 ? Math.sqrt(MAX_CANVAS_BACKING_PIXELS / area) : requestedScale,
  );
  return {
    width: Math.trunc(logicalWidth * scale),
    height: Math.trunc(logicalHeight * scale),
    scale,
  };
}
