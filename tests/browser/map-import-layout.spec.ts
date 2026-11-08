import { expect, test, type Locator, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

test.use({ serviceWorkers: "block" });

let workbookBuffer: Promise<Buffer> | undefined;

function createWorkbook() {
  workbookBuffer ??= (async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("1日目");
    const border = { style: "medium" as const, color: { argb: "FFFF0000" } };
    sheet.getCell("A1").value = "A";
    sheet.getCell("A1").border = { top: border, bottom: border, left: border };
    sheet.getCell("B1").value = 1;
    sheet.getCell("B1").border = { top: border, bottom: border, right: border };
    // A tall, sparse map also exercises the preview's own scroll container.
    sheet.getCell("F120").value = "preview-bottom";
    return Buffer.from(await workbook.xlsx.writeBuffer());
  })();
  return workbookBuffer;
}

async function openExpandedPreview(page: Page) {
  await page.goto("/");
  const input = page.locator('input[type="file"][accept=".xlsx"]').first();
  await input.evaluate((element) => {
    (element as HTMLInputElement).dataset.eventName = "map-scroll-layout";
  });
  await input.setInputFiles({
    name: "scrollable-map.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await createWorkbook(),
  });
  const dialog = page.getByRole("dialog", {
    name: "📋 マップデータ取り込み",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: /プレビュー（ブロック検出）/ })
    .click();
  await expect(dialog.getByText("✅ 1ブロック検出")).toBeAttached();
  await dialog
    .getByRole("button", { name: /ブロック自動検出の詳細設定/ })
    .click();
  return {
    dialog,
    content: dialog.getByTestId("map-import-scroll-content"),
    angle: dialog.getByRole("spinbutton", { name: "1日目マップ", exact: true }),
  };
}

async function scrollContent(
  page: Page,
  content: Locator,
  browserName: string,
  isMobile: boolean,
) {
  const box = await content.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  // Start inside the fieldset padding so a swipe cannot adjust a range input.
  const x = box.x + 12;
  if (isMobile && browserName === "chromium") {
    const session = await page.context().newCDPSession(page);
    try {
      const startY = box.y + box.height * 0.8;
      const endY = box.y + box.height * 0.2;
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y: startY }],
      });
      for (let step = 1; step <= 8; step++) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: startY + ((endY - startY) * step) / 8 }],
        });
        await page.waitForTimeout(16);
      }
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } finally {
      await session.detach();
    }
  } else if (isMobile) {
    // Playwright cannot send native touch swipes to mobile WebKit. Verify the
    // real scroll container here; physical iOS gesture validation is separate.
    await content.evaluate((element) => element.scrollBy(0, 300));
  } else {
    await page.mouse.move(x, box.y + box.height / 2);
    await page.mouse.wheel(0, 300);
  }
  await expect
    .poll(() => content.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
}

test("expanded map settings and preview scroll while header and actions stay fixed", async ({
  page,
  browserName,
  isMobile,
}) => {
  const { dialog, content, angle } = await openExpandedPreview(page);
  const heading = dialog.getByRole("heading", {
    name: "📋 マップデータ取り込み",
  });
  const cancel = dialog.getByRole("button", {
    name: "キャンセル",
    exact: true,
  });
  const importButton = dialog.getByRole("button", {
    name: "取り込む",
    exact: true,
  });
  const headingBefore = await heading.boundingBox();
  const cancelBefore = await cancel.boundingBox();
  await expect(heading).toBeInViewport();
  await expect(importButton).toBeInViewport();
  await expect
    .poll(() =>
      content.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    )
    .toBeGreaterThan(0);

  await scrollContent(page, content, browserName, isMobile);
  await expect(dialog.getByText("✅ 1ブロック検出")).toBeAttached();
  await expect(dialog.locator("canvas")).toBeAttached();
  await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(angle).toBeInViewport({ ratio: 1 });
  await angle.fill("90");
  await expect(angle).toHaveValue("90");
  expect((await heading.boundingBox())?.y).toBeCloseTo(headingBefore!.y, 1);
  expect((await cancel.boundingBox())?.y).toBeCloseTo(cancelBefore!.y, 1);
  await expect(importButton).toBeEnabled();
  await cancel.click();
  await expect(dialog).toBeHidden();
});

test("map preview scrolls without moving the surrounding settings", async ({
  page,
}) => {
  const { dialog, content } = await openExpandedPreview(page);
  const preview = dialog.locator("canvas").locator("..");
  await preview.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      preview.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    )
    .toBeGreaterThan(0);
  const outerScroll = await content.evaluate((element) => element.scrollTop);
  await preview.evaluate((element) => element.scrollBy(0, 50));
  await expect
    .poll(() => preview.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await content.evaluate((element) => element.scrollTop)).toBe(
    outerScroll,
  );
  await expect(
    dialog.getByRole("button", { name: "取り込む", exact: true }),
  ).toBeInViewport();
});

test("map import remains usable in a short landscape viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  const { dialog, content, angle } = await openExpandedPreview(page);
  const importButton = dialog.getByRole("button", {
    name: "取り込む",
    exact: true,
  });
  await expect(importButton).toBeInViewport({ ratio: 1 });
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(390);
  await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(angle).toBeInViewport({ ratio: 1 });
  await angle.fill("180");
  await expect(angle).toHaveValue("180");
  await expect(importButton).toBeInViewport({ ratio: 1 });
  await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(dialog).toBeHidden();
});
