import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function launch(page: Page, forceFallback = false) {
  if (forceFallback) {
    await page.addInitScript(() => {
      const supports = CSS.supports.bind(CSS);
      CSS.supports = ((...args: [string, string?]) =>
        args.some((value) => value?.includes("attr("))
          ? false
          : args.length === 1
            ? supports(args[0])
            : supports(args[0], args[1]!)) as typeof CSS.supports;
    });
  }
  await page.goto("/");
  await expect(page.locator("#loading-screen")).toBeHidden();
  await expect(page.locator("#root")).not.toBeEmpty();
}

async function restoreEvent(page: Page) {
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "ios-compatibility.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          kind: "event-shopping-planner-backup",
          version: 1,
          exportedAt: "2026-11-08T00:00:00.000Z",
          eventSettings: { blockDetectionSettings: {} },
          data: {
            eventLists: {
              iOS互換確認: [
                {
                  id: "ios-item",
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
            executeModeItems: { iOS互換確認: { "1日目": ["ios-item"] } },
            dayModes: { iOS互換確認: { "1日目": "edit" } },
            mapData: {},
            mapRotationSettings: {},
            mapViewportSettings: {},
            routeSettings: {},
            hallDefinitions: {},
            hallRouteSettings: {},
          },
        }),
        "utf8",
      ),
    });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog
    .getByRole("button", { name: "置換して復元", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "「iOS互換確認」の復元内容を確認",
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
    page.getByRole("heading", { name: "iOS互換確認", exact: true }),
  ).toBeVisible();
}

test("@ios-compat typed attr fallback updates layout without inline styles or CSP violations", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (
      window as Window & { compatibilityViolations?: string[] }
    ).compatibilityViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (
        window as Window & { compatibilityViolations: string[] }
      ).compatibilityViolations.push(event.effectiveDirective);
    });
  });
  await launch(page, true);
  await page.evaluate(() => {
    const element = document.createElement("div");
    element.id = "compatibility-layout";
    element.className =
      "fixed esp-layout-left esp-layout-top esp-layout-width esp-layout-height esp-layout-translate-y";
    for (const [attribute, value] of Object.entries({
      "data-layout-left": "12px",
      "data-layout-top": "34px",
      "data-layout-width": "123px",
      "data-layout-height": "77px",
      "data-layout-translate-y": "9px",
    }))
      element.setAttribute(attribute, value);
    document.body.appendChild(element);
  });
  const element = page.locator("#compatibility-layout");
  await expect(element).toHaveCSS("left", "12px");
  await expect(element).toHaveCSS("top", "34px");
  await expect(element).toHaveCSS("height", "77px");
  await expect(element).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 9)");
  await element.evaluate((node) =>
    node.setAttribute("data-layout-left", "56px"),
  );
  await expect(element).toHaveCSS("left", "56px");
  expect(await element.getAttribute("style")).toBeNull();
  await element.evaluate((node) => node.remove());
  expect(
    await page.evaluate(
      () =>
        (window as Window & { compatibilityViolations: string[] })
          .compatibilityViolations,
    ),
  ).toEqual([]);
});

test("@ios-compat modal locking and price picker keep platform behavior", async ({
  page,
  browserName,
}) => {
  await launch(page);
  if (browserName === "webkit") {
    await expect(
      page.getByText(/Safariとホーム画面アプリの保存領域は別です/),
    ).toBeVisible();
  }
  await restoreEvent(page);
  await page.getByRole("button", { name: "表示項目の設定" }).click();
  const body = page.locator("body");
  if (browserName === "webkit") {
    await expect(body).toHaveClass(/esp-body-position-lock/);
    await expect(body).toHaveCSS("position", "fixed");
  } else {
    await expect(body).not.toHaveClass(/esp-body-position-lock/);
  }
  await page.locator(".fixed.inset-0.z-40").click({ position: { x: 1, y: 1 } });
  await expect(body).not.toHaveClass(/esp-body-position-lock/);
  await page.getByRole("button", { name: "アイテム追加", exact: true }).click();
  const opener = page.getByRole("button", { name: "クイック選択を開く" });
  if (browserName === "webkit") {
    await expect(
      page.getByRole("combobox", { name: "クイック選択" }),
    ).toHaveCount(0);
    await opener.click();
  }
  const select = page.getByRole("combobox", { name: "クイック選択" });
  await expect(select).toBeVisible();
  const value = await select
    .locator("option:not([disabled])")
    .last()
    .getAttribute("value");
  await select.selectOption(value!);
  if (browserName === "webkit") {
    await expect(select).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
});

test("@ios-compat links retain native touch callouts", async ({ page }) => {
  await launch(page);
  const callout = await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "https://example.com/";
    const span = document.createElement("span");
    span.textContent = "URL";
    link.appendChild(span);
    document.body.appendChild(link);
    const value = getComputedStyle(span).getPropertyValue(
      "-webkit-touch-callout",
    );
    link.remove();
    return value;
  });
  // Chromium does not implement the Apple-specific property.
  expect(["", "default"]).toContain(callout);
});

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`@ios-compat recovery notice preserves ordinary event and settings clicks after reload at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await launch(page, true);
    await restoreEvent(page);
    await page.evaluate(() => {
      localStorage.setItem(
        "esp-unsaved-changes-v1:notice-regression",
        JSON.stringify({
          format: "event-shopping-planner-unsaved-changes",
          version: 1,
          source: "application",
          recordedAt: "2026-11-08T00:00:00.000Z",
          operations: [
            { id: "retained-review", changes: [], canResume: false },
          ],
        }),
      );
    });
    await page.reload();
    const toggle = page.getByRole("button", { name: /救済記録.*を表示/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveCSS("position", "static");
    await expect(
      page
        .getByTestId("app-shell-header")
        .getByRole("button", { name: /救済記録.*を表示/ }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const header = document.querySelector(
            '[data-testid="app-shell-header"]',
          )!;
          const height = header.getBoundingClientRect().height;
          const measured = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(
              "--app-header-height",
            ),
          );
          return Math.abs(height - measured);
        }),
      )
      .toBeLessThan(1);
    await expect(
      page.getByRole("region", { name: "離脱前の未保存操作" }),
    ).toHaveCount(0);
    await page.getByText("iOS互換確認", { exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "iOS互換確認", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "表示項目の設定" }).click();
    await page
      .locator(".fixed.inset-0.z-40")
      .click({ position: { x: 1, y: 1 } });
    await toggle.click();
    await expect(
      page.getByRole("region", { name: "離脱前の未保存操作" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "記録を保持して最小化" }).click();
    await expect(toggle).toBeVisible();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("esp-unsaved-changes-v1:notice-regression"),
      ),
    ).not.toBeNull();
  });
}
