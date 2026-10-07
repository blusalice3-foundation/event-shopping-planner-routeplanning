import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasCellLayerCache } from "./CanvasCellLayerCache";

const contextFor = (canvas: HTMLCanvasElement): CanvasRenderingContext2D =>
  ({
    canvas,
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    font: "10px sans-serif",
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 10,
    lineDashOffset: 0,
    textAlign: "start",
    textBaseline: "alphabetic",
    direction: "inherit",
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "low",
  }) as unknown as CanvasRenderingContext2D;
afterEach(() => vi.restoreAllMocks());

describe("canvas cell layer cache", () => {
  const setup = () => {
    const target = contextFor(document.createElement("canvas"));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      function (this: HTMLCanvasElement) {
        return contextFor(this);
      } as unknown as typeof HTMLCanvasElement.prototype.getContext,
    );
    return { target, cache: new CanvasCellLayerCache() };
  };
  it("reuses cell pixels while routes and markers may be redrawn independently", () => {
    const { target, cache } = setup();
    const mapCells: unknown[] = [];
    const render = vi.fn((context: CanvasRenderingContext2D) => {
      context.font = "14px sans-serif";
      context.lineCap = "round";
    });
    expect(cache.paint(target, [mapCells], "viewport", 800, 600, render)).toBe(
      true,
    );
    expect(cache.paint(target, [mapCells], "viewport", 800, 600, render)).toBe(
      true,
    );
    expect(render).toHaveBeenCalledTimes(1);
    expect(target.drawImage).toHaveBeenCalledTimes(2);
    expect(target.font).toBe("14px sans-serif");
    expect(target.lineCap).toBe("round");
    expect(target.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
  });
  it("invalidates on pixel-affecting state, geometry and viewport changes", () => {
    const { target, cache } = setup();
    const cells: unknown[] = [];
    const render = vi.fn();
    cache.paint(target, [cells], "none", 800, 600, render);
    cache.paint(target, [cells], "purchased", 800, 600, render);
    cache.paint(target, [cells], "rotated", 800, 600, render);
    cache.paint(target, [cells], "rotated", 900, 600, render);
    cache.paint(target, [[]], "rotated", 900, 600, render);
    expect(render).toHaveBeenCalledTimes(5);
  });
  it("fails back to direct painting when allocation would exceed its pixel bound", () => {
    const { target, cache } = setup();
    const render = vi.fn();
    expect(cache.paint(target, [], "large", 4096, 4096, render)).toBe(false);
    expect(cache.paint(target, [], "empty", 0, 600, render)).toBe(false);
    expect(render).not.toHaveBeenCalled();
    expect(target.drawImage).not.toHaveBeenCalled();
  });
  it("fails back to direct painting if the layer has no 2D context", () => {
    const { target, cache } = setup();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    expect(cache.paint(target, [], "unsupported", 800, 600, vi.fn())).toBe(
      false,
    );
    expect(target.drawImage).not.toHaveBeenCalled();
  });
  it("does not publish a partial layer when rendering throws", () => {
    const { target, cache } = setup();
    expect(() =>
      cache.paint(target, [], "state", 800, 600, () => {
        throw new Error("paint failed");
      }),
    ).toThrow("paint failed");
    const render = vi.fn();
    expect(cache.paint(target, [], "state", 800, 600, render)).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
    expect(target.drawImage).toHaveBeenCalledTimes(1);
  });
});
