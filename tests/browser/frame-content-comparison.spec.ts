import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  compareFrameContent,
  createFrameContentComparator,
  type FrameRect,
} from "./shopping-transfer-measurement";
import { writeEvidenceFiles } from "./evidence-file-writes";

type Rect = { x: number; y: number; width: number; height: number };
const rects: FrameRect[] = [
  {
    x: 20,
    y: 10,
    width: 600,
    height: 140,
    itemId: "c42",
    role: "destination-card",
  },
  { x: 10, y: 20, width: 600, height: 130, itemId: "c43", role: "source-gap" },
];
async function fixture(
  page: Page,
  variant: "reference" | "before" | "controls",
  scale = 1,
) {
  return page.evaluate(
    ({ variant, scale }) => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(innerWidth * scale);
      canvas.height = Math.round(innerHeight * scale);
      const context = canvas.getContext("2d")!;
      context.scale(scale, scale);
      context.fillStyle = "white";
      context.fillRect(0, 0, innerWidth, innerHeight);
      context.fillStyle = "black";
      context.font = "24px sans-serif";
      context.fillText(
        variant === "before" ? "Before transfer 17" : "Moved item 42",
        95,
        60,
      );
      context.fillRect(28, 23, variant === "controls" ? 5 : 18, 18);
      context.fillText("Quantity 3", 430, 50);
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { variant, scale },
  );
}

test("cached frame comparisons preserve all original scores across pixels, raster and viewport changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 180 });
  const reference = await fixture(page, "reference");
  const baseline = await fixture(page, "before");
  const comparator = await createFrameContentComparator(
    page,
    reference,
    baseline,
    rects,
  );
  try {
    for (const variant of ["reference", "before", "controls"] as const) {
      for (const scale of [1, 0.5]) {
        const frame = await fixture(page, variant, scale);
        expect(await comparator.compare(frame)).toEqual(
          await compareUncachedFrameContent(
            page,
            frame,
            reference,
            baseline,
            rects,
          ),
        );
      }
    }
    const accepted = await comparator.compare(reference);
    expect(accepted.matched).toBe(true);
    expect((await comparator.compare(baseline)).matched).toBe(false);
    expect(
      (await comparator.compare(await fixture(page, "controls"))).matched,
    ).toBe(false);
    await page.setViewportSize({ width: 800, height: 240 });
    const resized = await fixture(page, "reference", 0.5);
    expect(await comparator.compare(resized)).toEqual(
      await compareUncachedFrameContent(
        page,
        resized,
        reference,
        baseline,
        rects,
      ),
    );
    expect(
      await compareFrameContent(page, resized, reference, baseline, rects),
    ).toEqual(
      await compareUncachedFrameContent(
        page,
        resized,
        reference,
        baseline,
        rects,
      ),
    );
  } finally {
    await comparator.close();
  }
});

test("sample cache decodes references once and releases images after successful and failed comparisons", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 180 });
  const reference = await fixture(page, "reference");
  const baseline = await fixture(page, "before");
  await page.evaluate(() => {
    const state = { decoded: 0, live: new Set<ImageBitmap>() };
    Object.assign(window, { __frameComparisonImages: state });
    const originalImage = globalThis.createImageBitmap.bind(globalThis);
    globalThis.createImageBitmap = (async (
      image: ImageBitmapSource,
      options?: ImageBitmapOptions,
    ) => {
      const bitmap = await originalImage(image, options);
      state.decoded++;
      state.live.add(bitmap);
      return bitmap;
    }) as typeof createImageBitmap;
    const originalClose = ImageBitmap.prototype.close;
    ImageBitmap.prototype.close = function () {
      state.live.delete(this);
      return originalClose.call(this);
    };
  });
  const counts = () =>
    page.evaluate(() => {
      const state = (
        window as unknown as {
          __frameComparisonImages: { decoded: number; live: Set<ImageBitmap> };
        }
      ).__frameComparisonImages;
      return { decoded: state.decoded, live: state.live.size };
    });
  const comparator = await createFrameContentComparator(
    page,
    reference,
    baseline,
    rects,
  );
  try {
    expect(await counts()).toEqual({ decoded: 2, live: 2 });
    await comparator.compare(reference);
    await comparator.compare(reference);
    expect(await counts()).toEqual({ decoded: 4, live: 2 });
    await expect(comparator.compare("bm90LWFuLWltYWdl")).rejects.toThrow();
    expect(await counts()).toEqual({ decoded: 4, live: 2 });
  } finally {
    await comparator.close();
  }
  expect(await counts()).toEqual({ decoded: 4, live: 0 });
  await expect(
    createFrameContentComparator(page, reference, "bm90LWFuLWltYWdl", rects),
  ).rejects.toThrow();
  expect(await counts()).toEqual({ decoded: 5, live: 0 });
});

test("evidence writes preserve bytes and finish every batch before rejecting the first failure", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "esp-evidence-writes-"),
  );
  try {
    const files = Array.from({ length: 9 }, (_, index) => ({
      path: path.join(directory, `${index}.bin`),
      data: Buffer.from([index, 0, 255]),
    }));
    const firstFailure = path.join(directory, "missing-first", "fail.bin");
    const laterFailure = path.join(directory, "missing-later", "fail.bin");
    await expect(
      writeEvidenceFiles([
        { path: firstFailure, data: "first" },
        ...files.slice(0, 4),
        { path: laterFailure, data: "later" },
        ...files.slice(4),
      ]),
    ).rejects.toMatchObject({ path: firstFailure, code: "ENOENT" });
    for (const file of files)
      expect(await readFile(file.path)).toEqual(file.data);
    const textPath = path.join(directory, "utf8.txt");
    await writeEvidenceFiles([{ path: textPath, data: "日本語の保存" }]);
    expect(await readFile(textPath)).toEqual(
      Buffer.from("日本語の保存", "utf8"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// Frozen pre-change algorithm: an independent equivalence oracle for the cache.
async function compareUncachedFrameContent(
  page: Page,
  frame: string,
  reference: string,
  baseline: string,
  rects: FrameRect[],
) {
  return page.evaluate(
    async ({ frame, reference, baseline, rects }) => {
      const image = async (data: string, mime: string) => {
        const bytes = Uint8Array.from(atob(data), (character) =>
          character.charCodeAt(0),
        );
        return createImageBitmap(new Blob([bytes], { type: mime }));
      };
      const [actual, expected, before] = await Promise.all([
        image(frame, "image/png"),
        image(reference, "image/png"),
        image(baseline, "image/png"),
      ]);
      const crop = (bitmap: ImageBitmap, rect: Rect) => {
        const canvas = new OffscreenCanvas(
            Math.ceil(rect.width),
            Math.ceil(rect.height),
          ),
          context = canvas.getContext("2d")!;
        context.drawImage(
          bitmap,
          (rect.x * bitmap.width) / innerWidth,
          (rect.y * bitmap.height) / innerHeight,
          (rect.width * bitmap.width) / innerWidth,
          (rect.height * bitmap.height) / innerHeight,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      // Compare dark foreground ink, preserving glyph shape and opacity while excluding
      // the allowed striping/hover background color transition from readiness.
      const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
        let disagreement = 0,
          inkWeight = 0;
        for (let i = 0; i < a.length; i += 4) {
          const ink = (pixels: Uint8ClampedArray) =>
            Math.max(
              0,
              170 -
                (0.2126 * pixels[i] +
                  0.7152 * pixels[i + 1] +
                  0.0722 * pixels[i + 2]),
            ) / 170;
          const actualInk = ink(a),
            expectedInk = ink(b);
          disagreement += Math.abs(actualInk - expectedInk);
          inkWeight += Math.max(actualInk, expectedInk);
        }
        return inkWeight > 0 ? disagreement / inkWeight : 1;
      };
      try {
        // Normalize complete images to the trace screenshot raster before comparing glyphs.
        const resize = (bitmap: ImageBitmap) => {
          const canvas = new OffscreenCanvas(actual.width, actual.height);
          canvas
            .getContext("2d")!
            .drawImage(bitmap, 0, 0, actual.width, actual.height);
          return canvas.transferToImageBitmap();
        };
        const normalizedExpected = resize(expected),
          normalizedBefore = resize(before);
        const scores = rects.map((rect) => {
          const identityRect = {
            x: rect.x + 70,
            y: rect.y + 5,
            width: Math.min(300, rect.width - 70),
            height: Math.min(100, rect.height - 5),
          };
          const controls = [
            {
              x: rect.x + 7,
              y: rect.y + 7,
              width: 38,
              height: Math.min(30, rect.height - 7),
            },
            {
              x: rect.x + rect.width - 200,
              y: rect.y + 5,
              width: 190,
              height: Math.min(75, rect.height - 5),
            },
          ];
          const ref = crop(normalizedExpected, identityRect);
          return {
            itemId: rect.itemId,
            role: rect.role,
            rect,
            identityRect,
            controlRects: controls,
            frameError: difference(crop(actual, identityRect), ref),
            baselineError: difference(
              crop(normalizedBefore, identityRect),
              ref,
            ),
            controlErrors: controls.map((control) =>
              difference(
                crop(actual, control),
                crop(normalizedExpected, control),
              ),
            ),
          };
        });
        normalizedExpected.close();
        normalizedBefore.close();
        return {
          method: "dark-ink-shape-native-v2",
          matched: scores.every(
            (score) =>
              score.baselineError > 0.001 &&
              score.frameError <= 0.025 &&
              score.frameError < score.baselineError * 0.55 &&
              score.controlErrors.every((error) => error <= 0.025),
          ),
          scores,
        };
      } finally {
        actual.close();
        expected.close();
        before.close();
      }
    },
    { frame, reference, baseline, rects },
  );
}
