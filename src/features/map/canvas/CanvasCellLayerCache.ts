const MAX_LAYER_PIXELS = 4 * 1024 * 1024;

const readPaintState = (context: CanvasRenderingContext2D) => ({
  fillStyle: context.fillStyle,
  strokeStyle: context.strokeStyle,
  lineWidth: context.lineWidth,
  lineCap: context.lineCap,
  lineJoin: context.lineJoin,
  miterLimit: context.miterLimit,
  lineDashOffset: context.lineDashOffset,
  font: context.font,
  textAlign: context.textAlign,
  textBaseline: context.textBaseline,
  direction: context.direction,
  imageSmoothingEnabled: context.imageSmoothingEnabled,
  imageSmoothingQuality: context.imageSmoothingQuality,
});

/** One viewport-sized raster, bounded to 16 MiB; never stores business state. */
export class CanvasCellLayerCache {
  private entry: {
    readonly dependencies: readonly unknown[];
    readonly signature: string;
    readonly canvas: HTMLCanvasElement;
    readonly paintState: ReturnType<typeof readPaintState>;
  } | null = null;

  paint(
    target: CanvasRenderingContext2D,
    dependencies: readonly unknown[],
    signature: string,
    width: number,
    height: number,
    render: (context: CanvasRenderingContext2D) => void,
  ): boolean {
    if (width <= 0 || height <= 0 || width * height > MAX_LAYER_PIXELS)
      return false;
    let entry = this.entry;
    if (
      !entry ||
      entry.signature !== signature ||
      entry.canvas.ownerDocument !== target.canvas.ownerDocument ||
      entry.canvas.width !== width ||
      entry.canvas.height !== height ||
      entry.dependencies.length !== dependencies.length ||
      dependencies.some((value, index) => value !== entry!.dependencies[index])
    ) {
      const canvas = target.canvas.ownerDocument.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return false;
      Object.assign(context, readPaintState(target));
      render(context);
      entry = {
        dependencies: [...dependencies],
        signature,
        canvas,
        paintState: readPaintState(context),
      };
      this.entry = entry;
    }
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.drawImage(entry.canvas, 0, 0);
    target.restore();
    // Preserve inherited styles used by later route and marker drawing.
    Object.assign(target, entry.paintState);
    return true;
  }
}
