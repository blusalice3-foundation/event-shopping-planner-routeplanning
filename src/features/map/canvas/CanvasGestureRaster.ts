import type { Point } from "./useCanvasViewport";
/** Retain one completed viewport image while the user changes its camera. */
export class CanvasGestureRaster {
  private frame: {
    canvas: HTMLCanvasElement;
    cellSize: number;
    offset: Point;
    rotation: number;
    dependencies: readonly unknown[];
  } | null = null;
  paint(
    context: CanvasRenderingContext2D,
    cellSize: number,
    offset: Point,
    rotation: number,
    dependencies: readonly unknown[],
    interacting: boolean,
    dpr: number,
  ): boolean {
    const frame = this.frame;
    if (
      !interacting ||
      !frame ||
      frame.rotation !== rotation ||
      frame.canvas.width !== context.canvas.width ||
      frame.canvas.height !== context.canvas.height ||
      dependencies.length !== frame.dependencies.length ||
      dependencies.some((value, index) => value !== frame.dependencies[index])
    )
      return false;
    const ratio = cellSize / frame.cellSize;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    context.setTransform(
      ratio,
      0,
      0,
      ratio,
      dpr * (offset.x - ratio * frame.offset.x),
      dpr * (offset.y - ratio * frame.offset.y),
    );
    context.drawImage(frame.canvas, 0, 0);
    context.restore();
    return true;
  }
  capture(
    context: CanvasRenderingContext2D,
    cellSize: number,
    offset: Point,
    rotation: number,
    dependencies: readonly unknown[],
  ): void {
    const target = context.canvas;
    if (
      !target.ownerDocument ||
      target.width <= 0 ||
      target.height <= 0 ||
      target.width * target.height > 4 * 1024 * 1024
    )
      return;
    const canvas =
      this.frame?.canvas ?? target.ownerDocument.createElement("canvas");
    if (canvas.width !== target.width) canvas.width = target.width;
    if (canvas.height !== target.height) canvas.height = target.height;
    const cached = canvas.getContext("2d");
    if (!cached) return;
    cached.clearRect(0, 0, canvas.width, canvas.height);
    cached.drawImage(target, 0, 0);
    this.frame = {
      canvas,
      cellSize,
      offset: { ...offset },
      rotation,
      dependencies: [...dependencies],
    };
  }
}
