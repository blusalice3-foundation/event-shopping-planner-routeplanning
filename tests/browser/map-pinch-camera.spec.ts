import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });
test.describe.configure({ timeout: 60_000 });

const eventName = "ピンチ描画の整合確認";
const markerColor = "#12ab34";
// Canvas engines quantize context transforms. Pure camera calculations retain
// the 1e-6 logical-pixel contract; this browser bound is 0.001 backing pixels.
const browserCanvasTolerance = 1e-3;
const browserScaleTolerance = 1e-5;
type Paint = {
  x: number;
  y: number;
  edgeX: number;
  edgeY: number;
  time: number;
  raster: boolean;
};
type ProbeWindow = Window & {
  __mapPinchProbe: {
    records: Paint[];
    points: WeakMap<HTMLCanvasElement, Paint>;
  };
};

async function installProbe(page: Page) {
  // Track the real context transforms at the distinctive cell and propagate the
  // landmark through cached canvas copies. No product instrumentation is needed.
  await page.addInitScript(
    ({ markerColor }) => {
      type Point = {
        x: number;
        y: number;
        edgeX: number;
        edgeY: number;
        time: number;
        raster: boolean;
      };
      const points = new WeakMap<HTMLCanvasElement, Point>();
      const records: Point[] = [];
      (window as unknown as { __mapPinchProbe: unknown }).__mapPinchProbe = {
        points,
        records,
      };
      const prototype = CanvasRenderingContext2D.prototype;
      const fillRect = prototype.fillRect;
      const drawImage = prototype.drawImage;
      const clearRect = prototype.clearRect;
      const record = (context: CanvasRenderingContext2D, point: Point) => {
        points.set(context.canvas, point);
        if (context.canvas.isConnected) records.push(point);
      };
      prototype.clearRect = function (...args: Parameters<typeof clearRect>) {
        points.delete(this.canvas);
        return clearRect.apply(this, args);
      };
      prototype.fillRect = function (...args: Parameters<typeof fillRect>) {
        const result = fillRect.apply(this, args);
        if (this.fillStyle === markerColor) {
          const [x, y, width, height] = args;
          const matrix = this.getTransform();
          const center = matrix.transformPoint({
            x: x + width / 2,
            y: y + height / 2,
          });
          const edge = matrix.transformPoint({
            x: x + width,
            y: y + height / 2,
          });
          record(this, {
            x: center.x,
            y: center.y,
            edgeX: edge.x,
            edgeY: edge.y,
            time: performance.now(),
            raster: false,
          });
        }
        return result;
      };
      prototype.drawImage = function (...args: Parameters<typeof drawImage>) {
        const result = drawImage.apply(this, args);
        const source = args[0];
        if (!(source instanceof HTMLCanvasElement)) return result;
        const point = points.get(source);
        if (!point) return result;
        const values = args.slice(1) as number[];
        let sx = 0,
          sy = 0,
          sw = source.width,
          sh = source.height;
        let dx = values[0],
          dy = values[1],
          dw = sw,
          dh = sh;
        if (values.length === 4) [dx, dy, dw, dh] = values;
        if (values.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = values;
        const matrix = this.getTransform();
        const project = (x: number, y: number) =>
          matrix.transformPoint({
            x: dx + ((x - sx) * dw) / sw,
            y: dy + ((y - sy) * dh) / sh,
          });
        const center = project(point.x, point.y);
        const edge = project(point.edgeX, point.edgeY);
        record(this, {
          x: center.x,
          y: center.y,
          edgeX: edge.x,
          edgeY: edge.y,
          time: performance.now(),
          raster: true,
        });
        return result;
      } as typeof drawImage;
    },
    { markerColor },
  );
}

function backup() {
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-11-08T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: {
        [eventName]: [
          {
            id: "pinch-item",
            eventDate: "1日目",
            circle: "ユーザー登録",
            title: "エラーが発生しました",
            block: "A",
            number: "01a",
            price: 500,
            quantity: 1,
            purchaseStatus: "None",
            remarks: "",
          },
        ],
      },
      eventMetadata: {},
      executeModeItems: { [eventName]: { "1日目": ["pinch-item"] } },
      dayModes: { [eventName]: { "1日目": "execute" } },
      mapData: {
        [eventName]: {
          "1日目マップ": {
            maxRow: 12,
            maxCol: 12,
            cells: Array.from({ length: 144 }, (_, index) => ({
              row: Math.floor(index / 12) + 1,
              col: (index % 12) + 1,
              value: index === 13 ? 1 : null,
              backgroundColor: index === 26 ? markerColor : null,
              borders: { top: null, right: null, bottom: null, left: null },
            })),
            mergedCells: [],
            blocks: [
              {
                name: "A",
                startRow: 1,
                startCol: 1,
                endRow: 6,
                endCol: 6,
                numberCells: [{ row: 2, col: 2, value: 1 }],
              },
            ],
          },
        },
      },
      mapRotationSettings: {},
      mapViewportSettings: {
        [eventName]: {
          "1日目マップ": { zoomLevel: 100, offsetX: 0, offsetY: 0 },
        },
      },
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
}

async function restore(page: Page, mode: "normal" | "focus") {
  await installProbe(page);
  await page.goto("/");
  await expect(page.locator("#loading-screen")).toBeHidden();
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "map-pinch-camera.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup()), "utf8"),
    });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
    exact: true,
  });
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog
    .getByRole("button", { name: "置換して復元", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: `「${eventName}」の復元内容を確認`,
    exact: true,
  });
  await expect
    .poll(async () => (await review.isVisible()) || !(await dialog.isVisible()))
    .toBe(true);
  if (await review.isVisible())
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
  if (mode === "normal")
    await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  else {
    await page.getByTitle("集中モード", { exact: true }).click();
    await expect(page.locator("#focus-mode-footer")).toBeVisible();
    await page.getByTitle("マップを表示", { exact: true }).click();
  }
  const canvas =
    mode === "focus"
      ? page.locator('canvas[aria-label^="フォーカスマップ"]')
      : page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await expect
    .poll(() =>
      canvas.evaluate((node) =>
        Boolean(
          (window as unknown as ProbeWindow).__mapPinchProbe.points.get(
            node as HTMLCanvasElement,
          ),
        ),
      ),
    )
    .toBe(true);
  await frames(page, 3);
  return canvas;
}

async function runtimeMetadata(page: Page) {
  return page.evaluate(() => ({
    userAgent: navigator.userAgent,
    devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
    buildId:
      document
        .querySelector('meta[name="event-shopping-planner-build-id"]')
        ?.getAttribute("content") ?? null,
    sourceSha:
      document
        .querySelector('meta[name="event-shopping-planner-source-sha"]')
        ?.getAttribute("content") ?? null,
    appZoomLevel: 100,
    screenHz: null,
    emulationOnly: true,
  }));
}

async function frames(page: Page, count: number) {
  await page.evaluate(async (count) => {
    for (let index = 0; index < count; index++)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
  }, count);
}

async function snapshot(canvas: Locator) {
  return canvas.evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const point = (window as unknown as ProbeWindow).__mapPinchProbe.points.get(
      canvas,
    )!;
    const rect = canvas.getBoundingClientRect();
    const containerRect = canvas.parentElement!.getBoundingClientRect();
    const transform = canvas.getContext("2d")!.getTransform();
    return {
      renderScale: Math.hypot(transform.a, transform.b),
      containerX: containerRect.x,
      containerY: containerRect.y,
      point,
      width: rect.width,
      height: rect.height,
      backingWidth: canvas.width,
      backingHeight: canvas.height,
    };
  });
}

async function resetRecords(page: Page) {
  await page.evaluate(() => {
    (window as unknown as ProbeWindow).__mapPinchProbe.records.length = 0;
  });
}

async function touch(
  canvas: Locator,
  type: string,
  distance: number,
  centerX: number,
  centerY: number,
) {
  return canvas.evaluate(
    (node, input) => {
      const rect = node.parentElement!.getBoundingClientRect();
      const contacts = [-1, 1].map((direction, index) => ({
        identifier: 40 + index,
        target: node,
        clientX: rect.left + input.centerX + (direction * input.distance) / 2,
        clientY: rect.top + input.centerY,
      }));
      const event = new Event(input.type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: {
          value:
            input.type === "touchend" || input.type === "touchcancel"
              ? []
              : contacts,
        },
        targetTouches: {
          value:
            input.type === "touchend" || input.type === "touchcancel"
              ? []
              : contacts,
        },
        changedTouches: { value: contacts },
      });
      const dispatchedAt = performance.now();
      node.dispatchEvent(event);
      return dispatchedAt;
    },
    { type, distance, centerX, centerY },
  );
}

for (const mode of ["normal", "focus"] as const) {
  for (const moving of [false, true]) {
    test(`${mode} pinch paints coherent camera frames with ${moving ? "moving" : "fixed"} midpoint @map-pinch-camera`, async ({
      page,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const canvas = await restore(page, mode);
      const initial = await snapshot(canvas);
      const anchor = {
        x: Math.min(160, initial.width / 2),
        y: Math.min(120, initial.height / 2),
      };
      const factorX = initial.renderScale;
      const factorY = initial.renderScale;
      const initialRadius = Math.hypot(
        initial.point.edgeX - initial.point.x,
        initial.point.edgeY - initial.point.y,
      );
      const records: Array<
        Paint & {
          expectedX: number;
          expectedY: number;
          ratio: number;
          error: number;
        }
      > = [];
      const inputSamples: Array<{ percent: number; dispatchedAt: number }> = [];
      await resetRecords(page);
      await touch(canvas, "touchstart", 100, anchor.x, anchor.y);
      for (const percent of [102, 103, 106, 107, 111, 114, 117, 120]) {
        const step = percent - 100;
        const dispatchedAt = await touch(
          canvas,
          "touchmove",
          percent,
          anchor.x + (moving ? step * 0.4 : 0),
          anchor.y + (moving ? step * 0.2 : 0),
        );
        inputSamples.push({ percent, dispatchedAt });
        // One display frame between inputs leaves publication and draw callbacks
        // interleaved, rather than only examining a settled final viewport.
        await frames(page, 1);
      }
      await touch(canvas, "touchend", 120, anchor.x, anchor.y);
      await frames(page, 4);
      const painted = await page.evaluate(
        () => (window as unknown as ProbeWindow).__mapPinchProbe.records,
      );
      for (const point of painted) {
        const ratio =
          Math.hypot(point.edgeX - point.x, point.edgeY - point.y) /
          initialRadius;
        const step = (ratio - 1) * 100;
        const expectedX =
          factorX * (anchor.x + (moving ? step * 0.4 : 0)) +
          ratio * (initial.point.x - factorX * anchor.x);
        const expectedY =
          factorY * (anchor.y + (moving ? step * 0.2 : 0)) +
          ratio * (initial.point.y - factorY * anchor.y);
        records.push({
          ...point,
          expectedX,
          expectedY,
          ratio,
          error: Math.hypot(point.x - expectedX, point.y - expectedY),
        });
      }
      await testInfo.attach("camera-paints", {
        body: Buffer.from(
          JSON.stringify(
            {
              browser: testInfo.project.name,
              mode,
              moving,
              initial,
              anchor,
              records,
              diagnosticOnly: true,
              acceptanceMeasurement: false,
              inputSamples: inputSamples.map((sample) => {
                const paint = records.find(
                  (record) =>
                    record.time >= sample.dispatchedAt &&
                    Math.abs(record.ratio * 100 - sample.percent) < 1e-3 &&
                    record.error < browserCanvasTolerance,
                );
                return {
                  ...sample,
                  firstCoherentPaintAt: paint?.time ?? null,
                  inputToFirstCoherentPaintMs: paint
                    ? paint.time - sample.dispatchedAt
                    : null,
                };
              }),
              paintIntervalsMs: records
                .slice(1)
                .map((record, index) => record.time - records[index].time),
              runtime: await runtimeMetadata(page),
              physicalDeviceValidation: false,
            },
            null,
            2,
          ),
          "utf8",
        ),
        contentType: "application/json",
      });
      expect(records.length).toBeGreaterThanOrEqual(3);
      expect(
        records.some((record) => record.ratio > 1.01 && record.ratio < 1.19),
      ).toBe(true);
      expect(records.at(-1)!.ratio).toBeCloseTo(1.2, 6);
      expect(Math.max(...records.map((record) => record.error))).toBeLessThan(
        browserCanvasTolerance,
      );
      for (let index = 1; index < records.length; index++)
        expect(
          records[index].ratio + browserScaleTolerance,
        ).toBeGreaterThanOrEqual(records[index - 1].ratio);
      const final = await snapshot(canvas);
      expect(final.backingWidth * final.backingHeight).toBeLessThanOrEqual(
        16 * 1024 * 1024,
      );
      expect(final.backingWidth).toBeLessThanOrEqual(8192);
      expect(final.backingHeight).toBeLessThanOrEqual(8192);
      expect(errors).toEqual([]);
    });
  }
}

test("wheel keeps its cursor anchor and Shift+wheel rotates without changing scale @map-pinch-camera", async ({
  page,
}, testInfo) => {
  const canvas = await restore(page, "normal");
  const initial = await snapshot(canvas);
  // MouseEvent client coordinates are integers. Use the actual delivered
  // position when the layout container starts at a fractional CSS pixel.
  const anchor = {
    x: Math.round(initial.containerX + 140) - initial.containerX,
    y: Math.round(initial.containerY + 100) - initial.containerY,
  };
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Map canvas is missing.");
  await resetRecords(page);
  await canvas.dispatchEvent("wheel", {
    deltaY: -100,
    clientX: initial.containerX + anchor.x,
    clientY: initial.containerY + anchor.y,
    bubbles: true,
    cancelable: true,
  });
  await frames(page, 4);
  const zoomed = await snapshot(canvas);
  const ratio =
    Math.hypot(
      zoomed.point.edgeX - zoomed.point.x,
      zoomed.point.edgeY - zoomed.point.y,
    ) /
    Math.hypot(
      initial.point.edgeX - initial.point.x,
      initial.point.edgeY - initial.point.y,
    );
  expect(ratio).toBeGreaterThan(1);
  expect(zoomed.point.x).toBeCloseTo(
    anchor.x * initial.renderScale +
      ratio * (initial.point.x - anchor.x * initial.renderScale),
    3,
  );
  expect(zoomed.point.y).toBeCloseTo(
    anchor.y * initial.renderScale +
      ratio * (initial.point.y - anchor.y * initial.renderScale),
    3,
  );
  await canvas.dispatchEvent("wheel", {
    deltaY: 20,
    shiftKey: true,
    clientX: initial.containerX + anchor.x,
    clientY: initial.containerY + anchor.y,
    bubbles: true,
    cancelable: true,
  });
  await frames(page, 3);
  // Rotation is published by the application settings writer. Wait for its
  // actual 15-degree paint, independently of the pinch frame/latency checks.
  await expect
    .poll(async () => {
      const { point } = await snapshot(canvas);
      return Math.atan2(point.edgeY - point.y, point.edgeX - point.x);
    })
    .toBeCloseTo(Math.PI / 12, 5);
  const rotated = await snapshot(canvas);
  expect(
    Math.hypot(
      rotated.point.edgeX - rotated.point.x,
      rotated.point.edgeY - rotated.point.y,
    ),
  ).toBeCloseTo(
    Math.hypot(
      zoomed.point.edgeX - zoomed.point.x,
      zoomed.point.edgeY - zoomed.point.y,
    ),
    3,
  );
  expect(rotated.point.x).not.toBeCloseTo(zoomed.point.x, 3);
  await testInfo.attach("wheel-cameras", {
    body: Buffer.from(
      JSON.stringify(
        { initial, zoomed, rotated, physicalDeviceValidation: false },
        null,
        2,
      ),
      "utf8",
    ),
    contentType: "application/json",
  });
});

for (const mode of ["normal", "focus"] as const) {
  test(`${mode} native Chromium touch reaches a coherent final camera @map-pinch-camera`, async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName !== "chromium",
      "CDP touch input is Chromium-only; shared native handlers are covered above in WebKit.",
    );
    const canvas = await restore(page, mode);
    const initial = await snapshot(canvas);
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Map canvas is missing.");
    const anchor = {
      x: Math.min(160, box.width / 2),
      y: Math.min(120, box.height / 2),
    };
    const cdp = await page.context().newCDPSession(page);
    await resetRecords(page);
    try {
      for (const [type, distance] of [
        ["touchStart", 100],
        ["touchMove", 106],
        ["touchMove", 112],
        ["touchMove", 120],
      ] as const) {
        await cdp.send("Input.dispatchTouchEvent", {
          type,
          touchPoints: [-1, 1].map((direction, index) => ({
            id: 40 + index,
            x: initial.containerX + anchor.x + (direction * distance) / 2,
            y: initial.containerY + anchor.y,
          })),
        });
        await frames(page, 1);
      }
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await frames(page, 4);
      const painted = await page.evaluate(
        () => (window as unknown as ProbeWindow).__mapPinchProbe.records,
      );
      const radius = Math.hypot(
        initial.point.edgeX - initial.point.x,
        initial.point.edgeY - initial.point.y,
      );
      const factorX = initial.renderScale;
      const factorY = initial.renderScale;
      const records = painted.map((point) => {
        const ratio =
          Math.hypot(point.edgeX - point.x, point.edgeY - point.y) / radius;
        const expectedX =
          factorX * anchor.x + ratio * (initial.point.x - factorX * anchor.x);
        const expectedY =
          factorY * anchor.y + ratio * (initial.point.y - factorY * anchor.y);
        return {
          ...point,
          ratio,
          error: Math.hypot(point.x - expectedX, point.y - expectedY),
        };
      });
      await testInfo.attach("native-touch-camera-paints", {
        body: Buffer.from(
          JSON.stringify(
            {
              browser: testInfo.project.name,
              mode,
              initial,
              records,
              diagnosticOnly: true,
              acceptanceMeasurement: false,
              paintIntervalsMs: records
                .slice(1)
                .map((record, index) => record.time - records[index].time),
              runtime: await runtimeMetadata(page),
              physicalDeviceValidation: false,
            },
            null,
            2,
          ),
          "utf8",
        ),
        contentType: "application/json",
      });
      expect(records.length).toBeGreaterThanOrEqual(2);
      expect(records.at(-1)!.ratio).toBeCloseTo(1.2, 6);
      expect(Math.max(...records.map((record) => record.error))).toBeLessThan(
        browserCanvasTolerance,
      );
    } finally {
      await cdp.detach();
    }
  });
}
