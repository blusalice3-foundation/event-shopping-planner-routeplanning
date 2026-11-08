import { expect, test, type Locator, type Page } from "@playwright/test";

// Run unchanged in the desktop Chromium, Android Chromium and mobile WebKit projects.
test.use({ serviceWorkers: "block" });
test.describe.configure({ timeout: 60_000 });

const eventName = "マップ表示の引き継ぎ確認";
const initialViewports = {
  "1日目マップ": { zoomLevel: 150, offsetX: 20, offsetY: 30 },
  "2日目マップ": { zoomLevel: 75, offsetX: 200, offsetY: 300 },
};
type Viewport = (typeof initialViewports)["1日目マップ"];
type Backup = {
  data: {
    mapViewportSettings: Record<string, Record<string, Viewport>>;
    executeModeItems: Record<string, Record<string, string[]>>;
    eventLists: Record<string, Array<{ id: string; circle: string }>>;
  };
};

function createBackup() {
  const map = {
    maxRow: 12,
    maxCol: 12,
    cells: Array.from({ length: 144 }, (_, index) => ({
      row: Math.floor(index / 12) + 1,
      col: (index % 12) + 1,
      value: index === 13 ? 1 : null,
      backgroundColor: null,
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
  };
  const hall = (id: string, name: string) => ({
    id,
    name,
    vertices: [
      { row: 1, col: 1 },
      { row: 1, col: 6 },
      { row: 6, col: 6 },
      { row: 6, col: 1 },
    ],
  });
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-11-08T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: {
        [eventName]: [1, 2].map((day) => ({
          id: `day-${day}-item`,
          eventDate: `${day}日目`,
          circle: `${day}日目サークル`,
          title: `${day}日目の新刊`,
          block: "A",
          number: "01a",
          price: 500,
          quantity: 1,
          purchaseStatus: "None",
          remarks: day === 1 ? "ユーザー登録" : "エラーが発生しました",
        })),
      },
      eventMetadata: {},
      executeModeItems: {
        [eventName]: { "1日目": ["day-1-item"], "2日目": ["day-2-item"] },
      },
      dayModes: { [eventName]: { "1日目": "edit", "2日目": "edit" } },
      mapData: { [eventName]: { "1日目マップ": map, "2日目マップ": map } },
      mapRotationSettings: {},
      mapViewportSettings: { [eventName]: initialViewports },
      routeSettings: {},
      hallDefinitions: {
        [eventName]: {
          "1日目マップ": [hall("day-1-hall", "1日目ホール")],
          "2日目マップ": [hall("day-2-hall", "2日目ホール")],
        },
      },
      hallRouteSettings: {},
    },
  };
}

async function restore(page: Page) {
  await page.goto("/");
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "map-workspace-continuity.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(createBackup()), "utf8"),
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
}

async function openMap(page: Page) {
  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  return canvas;
}

async function selectDay(page: Page, day: number, zoom: number) {
  await page.getByRole("button", { name: new RegExp(`^${day}日目`) }).click();
  await expect(page.getByText(`${zoom}%`, { exact: true })).toBeVisible();
}

async function exportBackup(page: Page): Promise<Backup> {
  await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  await expect(page.getByText(eventName, { exact: true })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONバックアップ保存", exact: true })
    .click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  if (!stream) throw new Error("JSON backup download stream is missing.");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Backup;
}

async function reopenMap(page: Page) {
  await page.getByText(eventName, { exact: true }).click();
  return openMap(page);
}

async function editViewport(page: Page, canvas: Locator, isMobile: boolean) {
  if (isMobile) {
    // The browser event path is shared with native touch. Physical device gesture
    // validation remains separate because Playwright cannot swipe mobile WebKit.
    await canvas.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const touch = (identifier: number, x: number) => ({
        identifier,
        target: element,
        clientX: rect.left + x,
        clientY: rect.top + 120,
      });
      const start = [touch(1, 80), touch(2, 160)];
      const end = [touch(1, 70), touch(2, 170)];
      for (const [type, touches] of [
        ["touchstart", start],
        ["touchmove", end],
        ["touchend", []],
      ] as const) {
        // Mobile WebKit does not expose constructible Touch/TouchEvent APIs.
        // Supply the native handler's touch lists on an ordinary DOM event.
        const inputEvent = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(inputEvent, {
          touches: { value: [...touches] },
          targetTouches: { value: [...touches] },
          changedTouches: { value: type === "touchend" ? end : [...touches] },
        });
        element.dispatchEvent(inputEvent);
      }
    });
  } else {
    const box = await canvas.boundingBox();
    if (!box) throw new Error("The map canvas is not visible.");
    await page.mouse.move(box.x + 120, box.y + 120);
    await page.mouse.wheel(0, -100);
  }
  await expect(page.getByText("150%", { exact: true })).toBeHidden();

  const box = await canvas.boundingBox();
  if (!box) throw new Error("The map canvas is not visible.");
  if (isMobile) {
    const pointer = {
      pointerId: 3,
      pointerType: "touch",
      isPrimary: true,
      clientX: box.x + 180,
      clientY: box.y + 180,
    };
    await canvas.dispatchEvent("pointerdown", {
      ...pointer,
      button: 0,
      buttons: 1,
    });
    await canvas.dispatchEvent("pointermove", {
      ...pointer,
      clientX: pointer.clientX + 30,
      clientY: pointer.clientY + 20,
      buttons: 1,
    });
    await canvas.dispatchEvent("pointerup", {
      ...pointer,
      clientX: pointer.clientX + 30,
      clientY: pointer.clientY + 20,
      button: 0,
      buttons: 0,
    });
  } else {
    await page.mouse.move(box.x + 180, box.y + 180);
    await page.mouse.down();
    await page.mouse.move(box.x + 210, box.y + 200, { steps: 4 });
    await page.mouse.up();
  }
}

test("day switches preserve distinct saved viewports without remounting the canvas @map-workspace", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await restore(page);
  const canvas = await openMap(page);
  await expect(page.getByText("150%", { exact: true })).toBeVisible();
  const originalCanvas = await canvas.elementHandle();
  await selectDay(page, 2, 75);
  expect(
    await canvas.evaluate(
      (current, original) => current === original,
      originalCanvas,
    ),
  ).toBe(true);
  await selectDay(page, 1, 150);
  await selectDay(page, 2, 75);
  const saved = await exportBackup(page);
  expect(saved.data.mapViewportSettings[eventName]).toEqual(initialViewports);

  await page.reload();
  await reopenMap(page);
  await expect(page.getByText("150%", { exact: true })).toBeVisible();
  await selectDay(page, 2, 75);
  const reloaded = await exportBackup(page);
  expect(reloaded.data.mapViewportSettings[eventName]).toEqual(
    initialViewports,
  );
  expect(errors).toEqual([]);
  await originalCanvas?.dispose();
});

test("wheel or touch zoom and dragging save to their source day across round trips @map-workspace", async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await restore(page);
  const canvas = await openMap(page);
  await editViewport(page, canvas, isMobile);
  await selectDay(page, 2, 75);
  const saved = await exportBackup(page);
  const edited = saved.data.mapViewportSettings[eventName]["1日目マップ"];
  expect(edited.zoomLevel).toBeGreaterThan(150);
  expect(edited.offsetX).not.toBe(initialViewports["1日目マップ"].offsetX);
  expect(edited.offsetY).not.toBe(initialViewports["1日目マップ"].offsetY);
  expect(saved.data.mapViewportSettings[eventName]["2日目マップ"]).toEqual(
    initialViewports["2日目マップ"],
  );

  await reopenMap(page);
  await expect(
    page.getByText(`${edited.zoomLevel}%`, { exact: true }),
  ).toBeVisible();
  await selectDay(page, 2, 75);
  await selectDay(page, 1, edited.zoomLevel);
  const roundTrip = await exportBackup(page);
  expect(roundTrip.data.mapViewportSettings[eventName]).toEqual(
    saved.data.mapViewportSettings[eventName],
  );
  await page.reload();
  await reopenMap(page);
  await expect(
    page.getByText(`${edited.zoomLevel}%`, { exact: true }),
  ).toBeVisible();
  await selectDay(page, 2, 75);
  const reloaded = await exportBackup(page);
  expect(reloaded.data.mapViewportSettings[eventName]).toEqual(
    saved.data.mapViewportSettings[eventName],
  );
  expect(errors).toEqual([]);
});

test("a hall from another day clears while its items and cell popup remain usable @map-workspace", async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await restore(page);
  const canvas = await openMap(page);
  await page.getByTitle("表示ホール: 全ホール", { exact: true }).click();
  await page.getByRole("button", { name: /^1日目ホール/ }).click();
  await expect(
    page.getByTitle("表示ホール: 1日目ホール", { exact: true }),
  ).toBeVisible();
  await selectDay(page, 2, 75);
  await expect(
    page.getByTitle("表示ホール: 全ホール", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-route-item-count]")).toHaveAttribute(
    "data-route-item-count",
    "1",
  );

  const position = { x: 200 + 1.5 * 28 * 0.75, y: 300 + 1.5 * 28 * 0.75 };
  if (isMobile) await canvas.tap({ position });
  else await canvas.click({ position });
  const popup = page.getByRole("dialog", {
    name: "A-1のアイテム一覧",
    exact: true,
  });
  await expect(popup).toContainText("2日目サークル");
  await expect(popup).toContainText("訪問先");
  await expect(popup).not.toContainText("1日目サークル");
  await popup
    .getByRole("button", { name: "A-1のアイテム一覧を閉じる", exact: true })
    .click();
  await expect(popup).toBeHidden();
  await page.getByTitle("表示ホール: 全ホール", { exact: true }).click();
  await page.getByRole("button", { name: /^2日目ホール/ }).click();
  await expect(
    page.getByTitle("表示ホール: 2日目ホール", { exact: true }),
  ).toBeVisible();
  await selectDay(page, 1, 150);
  await expect(
    page.getByTitle("表示ホール: 全ホール", { exact: true }),
  ).toBeVisible();
  const saved = await exportBackup(page);
  expect(saved.data.executeModeItems[eventName]).toEqual({
    "1日目": ["day-1-item"],
    "2日目": ["day-2-item"],
  });
  expect(saved.data.eventLists[eventName].map((item) => item.id)).toEqual([
    "day-1-item",
    "day-2-item",
  ]);
  expect(errors).toEqual([]);
});

test("an old pinch ending after a day switch cannot open the new map popup @map-workspace", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await restore(page);
  const canvas = await openMap(page);
  const originalCanvas = await canvas.elementHandle();
  await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const touch = (identifier: number, x: number) => ({
      identifier,
      target: element,
      clientX: rect.left + x,
      clientY: rect.top + 120,
    });
    const start = [touch(11, 80), touch(12, 160)];
    const moved = [touch(11, 70), touch(12, 170)];
    for (const [type, touches] of [
      ["touchstart", start],
      ["touchmove", moved],
    ] as const) {
      const inputEvent = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(inputEvent, {
        touches: { value: [...touches] },
        targetTouches: { value: [...touches] },
        changedTouches: { value: [...touches] },
      });
      element.dispatchEvent(inputEvent);
    }
  });
  await expect(page.getByText("150%", { exact: true })).toBeHidden();
  await selectDay(page, 2, 75);
  expect(
    await canvas.evaluate(
      (current, original) => current === original,
      originalCanvas,
    ),
  ).toBe(true);

  // Old native touchend can arrive before its corresponding pointerup. Ending
  // those touch IDs must not erase the protection for the replacement map.
  await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const ended = [11, 12].map((identifier) => ({
      identifier,
      target: element,
      clientX: rect.left + 120,
      clientY: rect.top + 120,
    }));
    const inputEvent = new Event("touchend", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperties(inputEvent, {
      touches: { value: [] },
      targetTouches: { value: [] },
      changedTouches: { value: ended },
    });
    element.dispatchEvent(inputEvent);
  });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("The map canvas is not visible.");
  const pointer = {
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: box.x + 200 + 1.5 * 28 * 0.75,
    clientY: box.y + 300 + 1.5 * 28 * 0.75,
  };
  await canvas.dispatchEvent("pointerup", {
    ...pointer,
    pointerId: 11,
    buttons: 0,
  });
  await canvas.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  const popup = page.getByRole("dialog", {
    name: "A-1のアイテム一覧",
    exact: true,
  });
  await expect(popup).toHaveCount(0);

  await canvas.dispatchEvent("pointerdown", {
    ...pointer,
    pointerId: 90,
    buttons: 1,
  });
  await canvas.dispatchEvent("pointerup", {
    ...pointer,
    pointerId: 90,
    buttons: 0,
  });
  await expect(popup).toHaveCount(1);
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("2日目サークル");
  await expect(popup).not.toContainText("1日目サークル");
  expect(errors).toEqual([]);
  await originalCanvas?.dispose();
});
