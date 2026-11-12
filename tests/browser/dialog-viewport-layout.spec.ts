import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { readBrowserEventLists } from "./shopping-transfer-persisted-store";
import { readDownload } from "./ios-xlsx-helpers";
import { sheetCsv } from "../../src/test/sheetImportOptionalUrlFixtures";

test.use({ serviceWorkers: "block" });

const eventName = "画面スクロール検証";
const sizes = [
  { width: 1280, height: 900 },
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
  { width: 375, height: 667 },
  { width: 360, height: 640 },
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 320, height: 568 },
];

function backup(name = eventName, mode = "execute") {
  const items = Array.from({ length: 21 }, (_, index) => ({
    id: `dialog-${index}`,
    eventDate: "1日目",
    circle: "ユーザー登録サークル",
    title: `確認商品${index + 1}`,
    block: "A",
    number: index < 20 ? "1" : "2",
    price: 500,
    quantity: 2,
    purchaseStatus: "None",
    remarks: "エラーが発生しました",
  }));
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-11-12T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: { [name]: items },
      eventMetadata: {},
      executeModeItems: {
        [name]: { "1日目": items.map((item) => item.id) },
      },
      dayModes: { [name]: { "1日目": mode } },
      mapData: {},
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
}

async function launch(page: Page) {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/");
  await expect(page.locator("#loading-screen")).toBeHidden();
}

async function openRestore(page: Page, name = eventName, mode = "execute") {
  await page.getByLabel("バックアップファイルを選択").setInputFiles({
    name: "dialog-layout.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup(name, mode)), "utf8"),
  });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function restore(page: Page, name = eventName, mode = "execute") {
  const dialog = await openRestore(page, name, mode);
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog
    .getByRole("button", { name: "置換して復元", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function inspect(panel: Locator) {
  return panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      overflowY: getComputedStyle(element).overflowY,
    };
  });
}

async function expectContained(panel: Locator) {
  const result = await inspect(panel);
  expect(result.top).toBeGreaterThanOrEqual(-1);
  expect(result.bottom).toBeLessThanOrEqual(result.viewportHeight + 1);
  expect(result.left).toBeGreaterThanOrEqual(-1);
  expect(result.right).toBeLessThanOrEqual(result.viewportWidth + 1);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth + 1);
  return result;
}

async function scrollPanel(
  page: Page,
  panel: Locator,
  browserName: string,
  isMobile: boolean,
) {
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + 8;
  const startY = box!.y + box!.height * 0.8;
  if (browserName === "chromium" && isMobile) {
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y: startY }],
      });
      for (let step = 1; step <= 8; step++) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: startY - (box!.height * 0.6 * step) / 8 }],
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
    // This checks WebKit's real scroll container, not a physical iOS swipe.
    await panel.evaluate((element) => element.scrollBy(0, 240));
  } else {
    await page.mouse.move(x, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 320);
  }
  await expect
    .poll(() => panel.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
}

async function scrollBackdrop(page: Page, isMobile: boolean) {
  if (isMobile) {
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: 2, y: 300 }],
      });
      for (let step = 1; step <= 8; step++) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: 2, y: 300 - 25 * step }],
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
  } else {
    await page.mouse.move(2, 185);
    await page.mouse.wheel(0, 450);
  }
}

async function reach(panel: Locator, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeInViewport({ ratio: 1 });
  // Viewport visibility alone would miss clipping by the scroll panel.
  const targetBox = await target.boundingBox();
  const panelBox = await panel.boundingBox();
  expect(targetBox!.y).toBeGreaterThanOrEqual(panelBox!.y - 1);
  expect(targetBox!.y + targetBox!.height).toBeLessThanOrEqual(
    panelBox!.y + panelBox!.height + 1,
  );
}

async function record(testInfo: TestInfo, name: string, data: unknown) {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(data), "utf8"),
    contentType: "application/json",
  });
}

for (const size of sizes) {
  test(`dialog bounds and final actions in real restore, distribution and menu at ${size.width}x${size.height}`, async ({
    page,
    browserName,
    isMobile,
  }, testInfo) => {
    await page.setViewportSize(size);
    await launch(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const restoreDialog = await openRestore(page);
    await expectContained(restoreDialog);
    const nameInput = restoreDialog.getByRole("textbox", {
      name: "復元後のイベント名",
    });
    await reach(restoreDialog, nameInput);
    await nameInput.fill("入力中の日本語イベント");
    await page.setViewportSize({ width: size.height, height: size.width });
    await expect(nameInput).toHaveValue("入力中の日本語イベント");
    await page.setViewportSize(size);
    const restoreGeometry = await expectContained(restoreDialog);
    if (restoreGeometry.scrollHeight > restoreGeometry.clientHeight + 1) {
      await restoreDialog.evaluate((element) => {
        element.scrollTop = 0;
      });
      await scrollPanel(page, restoreDialog, browserName, isMobile);
    }
    await restoreDialog.getByRole("radio", { name: /同名で置換/ }).check();
    const restoreButton = restoreDialog.getByRole("button", {
      name: "置換して復元",
      exact: true,
    });
    await reach(restoreDialog, restoreButton);
    await restoreButton.click();
    await expect(restoreDialog).toBeHidden();
    await expect(
      page.getByRole("heading", { name: eventName, exact: true }),
    ).toBeVisible();
    const original = (await readBrowserEventLists(page))[eventName];
    expect(original).toHaveLength(21);

    await page
      .getByRole("button", { name: "全売切", exact: true })
      .first()
      .click();
    const distribution = page.getByRole("dialog", {
      name: "事後通販･頒布可否確認",
      exact: true,
    });
    const distributionGeometry = await expectContained(distribution);
    const answer = distribution.getByRole("combobox", {
      name: "一括回答",
      exact: true,
    });
    await answer.selectOption({ index: 1 });
    const answerValue = await answer.inputValue();
    const lastAnswer = distribution.getByRole("combobox", {
      name: "確認商品20の回答内容",
      exact: true,
    });
    await reach(distribution, lastAnswer);
    await lastAnswer.selectOption({ index: 2 });
    if (
      distributionGeometry.scrollHeight >
      distributionGeometry.clientHeight + 1
    ) {
      await distribution.evaluate((element) => {
        element.scrollTop = 0;
      });
      await scrollPanel(page, distribution, browserName, isMobile);
    }
    const recordButton = distribution.getByRole("button", {
      name: "記録",
      exact: true,
    });
    await reach(distribution, recordButton);
    await recordButton.click();
    await expect(distribution).toBeHidden();
    await expect
      .poll(
        async () =>
          (await readBrowserEventLists(page))[eventName]?.filter(
            (item) => item.purchaseStatus === "SoldOut",
          ).length,
      )
      .toBe(20);
    const saved = (await readBrowserEventLists(page))[eventName];
    expect(saved[0].remarks).toContain(`通販･頒布確認: ${answerValue}`);
    expect(saved[20]).toMatchObject({ purchaseStatus: "None" });

    await page
      .getByRole("button", { name: "イベント一覧", exact: true })
      .click();
    await page.getByRole("button", { name: "メニュー", exact: true }).click();
    const menu = page.getByRole("dialog", {
      name: `${eventName}の操作`,
      exact: true,
    });
    const menuGeometry = await expectContained(menu);
    const cancel = menu.getByRole("button", {
      name: "キャンセル",
      exact: true,
    });
    await reach(menu, cancel);
    await cancel.click();
    await expect(menu).toBeHidden();
    expect((await readBrowserEventLists(page))[eventName]).toEqual(saved);
    expect(errors).toEqual([]);
    await record(testInfo, "dialog-layout-geometry", {
      size,
      browserName,
      isMobile,
      restoreGeometry,
      distributionGeometry,
      menuGeometry,
      errors,
    });
  });
}

for (const size of [sizes[0], sizes[1], sizes[2], sizes[6], sizes[7]]) {
  test(`90vh input regression retains edits and cancellation at ${size.width}x${size.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await launch(page);
    await restore(page);
    await page.setViewportSize(size);
    const original = (await readBrowserEventLists(page))[eventName];
    const card = page
      .locator('[data-item-id="dialog-0"]')
      .first()
      .locator(":scope > div.rounded-lg")
      .first();
    await card.dispatchEvent("pointerdown", {
      button: 0,
      isPrimary: true,
      pointerType: "mouse",
    });
    await page.waitForTimeout(550);
    await card.dispatchEvent("pointerup", {
      button: 0,
      isPrimary: true,
      pointerType: "mouse",
    });
    await page.getByRole("button", { name: "編集", exact: true }).click();
    const editor = page.getByRole("dialog", {
      name: "アイテム編集",
      exact: true,
    });
    const editorGeometry = await expectContained(editor);
    await editor
      .getByRole("combobox", { name: "サークル名", exact: true })
      .fill("入力中ユーザー登録");
    const memo = editor.getByRole("textbox", {
      name: "利用者メモ",
      exact: true,
    });
    await reach(editor, memo);
    await memo.fill("回転しても保持する日本語メモ");
    await page.setViewportSize({ width: size.height, height: size.width });
    await expect(memo).toHaveValue("回転しても保持する日本語メモ");
    await page.setViewportSize(size);
    const cancel = editor.getByRole("button", {
      name: "キャンセル",
      exact: true,
    });
    await reach(editor, cancel);
    await cancel.click();
    await expect(editor).toBeHidden();
    expect((await readBrowserEventLists(page))[eventName]).toEqual(original);

    await page.route("**/api/google-sheets-csv", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/csv; charset=utf-8",
        body: sheetCsv(2),
      }),
    );
    await page
      .getByRole("button", { name: "イベント一覧", exact: true })
      .click();
    await page
      .getByRole("button", { name: "新規リスト作成", exact: true })
      .click();
    await page.getByLabel("即売会名", { exact: true }).fill(eventName);
    await page
      .getByLabel("スプレッドシートURLからインポート", { exact: true })
      .fill("https://docs.google.com/spreadsheets/d/dialog-layout-source/edit");
    await page
      .getByRole("button", { name: "URLからインポート", exact: true })
      .click();
    const duplicate = page.getByRole("dialog", {
      name: `「${eventName}」はすでにあります`,
      exact: true,
    });
    const duplicateGeometry = await expectContained(duplicate);
    const alias = duplicate.getByRole("textbox", {
      name: "新しいイベント名",
      exact: true,
    });
    await reach(duplicate, alias);
    await alias.fill("入力中の別名イベント");
    await duplicate
      .getByRole("radio", { name: "更新元を切り替える", exact: true })
      .check();
    await duplicate
      .getByRole("radio", { name: "別名作成（推奨）", exact: true })
      .check();
    await expect(alias).toHaveValue("入力中の別名イベント");
    await page.setViewportSize({ width: size.height, height: size.width });
    await expect(alias).toHaveValue("入力中の別名イベント");
    await page.setViewportSize(size);
    await reach(
      duplicate,
      duplicate.getByRole("button", { name: "キャンセル", exact: true }),
    );
    await duplicate
      .getByRole("button", { name: "キャンセル", exact: true })
      .click();
    await expect(duplicate).toBeHidden();
    expect((await readBrowserEventLists(page))[eventName]).toEqual(original);
    await record(testInfo, "90vh-input-regression", {
      size,
      editorGeometry,
      duplicateGeometry,
      keyboard: "not physical; viewport rotation only",
    });
  });
}

test("real exported XLSX restore can scroll, edit, cancel and save in landscape", async ({
  page,
  browserName,
  isMobile,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await launch(page);
  await restore(page);
  await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("button", { name: /Excel形式で出力/ }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "エクスポート", exact: true }).click();
  const file = {
    name: "dialog-layout.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await readDownload(await downloading),
  };
  await page.setViewportSize({ width: 667, height: 375 });
  await page
    .getByLabel("Excelファイルを選択", { exact: true })
    .setInputFiles(file);
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
    exact: true,
  });
  const geometry = await expectContained(dialog);
  await dialog.evaluate((element) => {
    element.scrollTop = 0;
  });
  if (geometry.scrollHeight > geometry.clientHeight + 1)
    await scrollPanel(page, dialog, browserName, isMobile);
  const input = dialog.getByRole("textbox", {
    name: /^復元後のイベント名/,
  });
  await reach(dialog, input);
  await input.fill(eventName);
  await expect(
    dialog.getByText("この名前は使用中です。別の名前を入力してください。"),
  ).toBeVisible();
  await input.fill("Excel復元の日本語入力");
  await reach(
    dialog,
    dialog.getByRole("button", { name: "キャンセル", exact: true }),
  );
  await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(
    (await readBrowserEventLists(page))["Excel復元の日本語入力"],
  ).toBeUndefined();
  await page
    .getByLabel("Excelファイルを選択", { exact: true })
    .setInputFiles(file);
  await dialog
    .getByRole("textbox", { name: "復元後のイベント名", exact: true })
    .fill("Excel復元の日本語入力");
  await reach(
    dialog,
    dialog.getByRole("button", { name: "別名で復元", exact: true }),
  );
  await dialog.getByRole("button", { name: "別名で復元", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await readBrowserEventLists(page))["Excel復元の日本語入力"]?.length,
    )
    .toBe(21);
  await record(testInfo, "real-xlsx-layout", {
    geometry,
    nativeSwipe: browserName === "chromium" && isMobile,
    physicalKeyboard: false,
  });
});

for (const size of sizes) {
  test(`resume and space action choices remain reachable at ${size.width}x${size.height}`, async ({
    page,
  }, testInfo) => {
    // This functional flow restores data and switches modes before both dialogs.
    test.setTimeout(60_000);
    const flowStartedAt = Date.now();
    await page.setViewportSize({ width: 1280, height: 900 });
    await launch(page);
    await restore(page);
    await page.setViewportSize(size);
    const original = (await readBrowserEventLists(page))[eventName];
    await page
      .getByRole("button", { name: "スペース一覧を開く", exact: true })
      .click();
    const picker = page.getByRole("dialog", {
      name: "スペース一覧",
      exact: true,
    });
    await picker.getByRole("button").filter({ hasText: "A-1" }).click();
    const action = page.getByRole("dialog", { name: "A-1", exact: true });
    const actionGeometry = await expectContained(action);
    for (const label of [
      "現在地として移動",
      "一時移動して操作",
      "内容だけ確認",
      "キャンセル",
    ]) {
      await reach(
        action,
        action.getByRole("button", {
          name: label,
          exact: label === "キャンセル",
        }),
      );
    }
    await action
      .getByRole("button", { name: "キャンセル", exact: true })
      .click();
    await expect(action).toBeHidden();
    await picker
      .getByRole("button", { name: "スペース一覧を閉じる", exact: true })
      .click();
    expect((await readBrowserEventLists(page))[eventName]).toEqual(original);
    await page.getByTitle("集中モード", { exact: true }).click();
    await expect(page.getByTestId("focus-mode-scroll-region")).toBeVisible();
    await page
      .getByRole("button", { name: "全購入", exact: true })
      .first()
      .click();
    await expect
      .poll(
        async () =>
          (await readBrowserEventLists(page))[eventName]?.filter(
            (item) => item.purchaseStatus === "Purchased",
          ).length,
      )
      .toBe(20);
    await page.getByTitle("実行モード", { exact: true }).click();
    await expect(page.getByTestId("focus-mode-scroll-region")).toBeHidden();
    await page.getByTitle("集中モード", { exact: true }).click();
    const resume = page.getByRole("dialog", {
      name: "集中モードを再開しますか？",
      exact: true,
    });
    const resumeGeometry = await expectContained(resume);
    await expect(resume.getByRole("button")).toHaveCount(4);
    const lastChoice = resume.getByRole("button", {
      name: "通常フェーズの最初から",
      exact: true,
    });
    await reach(resume, lastChoice);
    const choiceReadyAfterMs = Date.now() - flowStartedAt;
    await lastChoice.click();
    await expect(resume).toBeHidden();
    await expect(page.getByTestId("focus-mode-scroll-region")).toBeVisible();
    await record(testInfo, "resume-space-layout", {
      size,
      choiceReadyAfterMs,
      driverElapsedMs: Date.now() - flowStartedAt,
      actionGeometry,
      resumeGeometry,
    });
  });
}

for (const size of sizes.slice(0, 3)) {
  test(`nominal event menu geometry and local dialog lifecycle diagnostic at ${size.width}x${size.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(size);
    await launch(page);
    await restore(page);
    await page
      .getByRole("button", { name: "イベント一覧", exact: true })
      .click();
    const started = await page.evaluate(() => performance.now());
    await page.getByRole("button", { name: "メニュー", exact: true }).click();
    const menu = page.getByRole("dialog", {
      name: `${eventName}の操作`,
      exact: true,
    });
    const geometry = await expectContained(menu);
    await menu.getByRole("button", { name: "キャンセル", exact: true }).click();
    await expect(menu).toBeHidden();
    const menuLifecycleDriverMs =
      (await page.evaluate(() => performance.now())) - started;
    const dialog = await openRestore(page);
    const restoreStarted = await page.evaluate(() => performance.now());
    const input = dialog.getByRole("textbox", {
      name: /^復元後のイベント名/,
    });
    await reach(dialog, input);
    await input.fill("入力診断ユーザー登録");
    await reach(
      dialog,
      dialog.getByRole("button", { name: "キャンセル", exact: true }),
    );
    await dialog
      .getByRole("button", { name: "キャンセル", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    const restoreLifecycleDriverMs =
      (await page.evaluate(() => performance.now())) - restoreStarted;
    await record(testInfo, "nominal-local-diagnostic", {
      size,
      geometry,
      menuLifecycleDriverMs,
      restoreLifecycleDriverMs,
      diagnosticOnly: true,
      acceptanceMeasurement: false,
      timingMeaning:
        "Playwright-driven lifecycle elapsed time; includes driver waits, not input-to-frame latency",
      runtimeLayoutNodesAfterClose: await page
        .locator("[data-esp-runtime-layout]")
        .count(),
      keyboard: "not physical",
    });
  });
}

test("distribution scroll stays inside the dialog and restores background position on cancellation", async ({
  page,
  browserName,
  isMobile,
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "Physical iOS backdrop swipes are checked separately; scrollBy does not synthesize chaining.",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await launch(page);
  await restore(page);
  await page.setViewportSize({ width: 667, height: 375 });
  await page
    .getByRole("button", { name: "全売切", exact: true })
    .first()
    .click();
  const distribution = page.getByRole("dialog", {
    name: "事後通販･頒布可否確認",
    exact: true,
  });
  await expectContained(distribution);
  const position = await page.evaluate(() => scrollY);
  await scrollBackdrop(page, isMobile);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => scrollY)).toBe(position);
  await expect(distribution).toBeVisible();
  const inner = distribution.locator(".max-h-72");
  const outerStart = await inner.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    const outer = element.closest('[role="dialog"]')!;
    outer.scrollTop =
      element.getBoundingClientRect().top -
      outer.getBoundingClientRect().top +
      outer.scrollTop -
      24;
    return outer.scrollTop;
  });
  if (!isMobile) {
    const box = await distribution.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 80);
    await page.mouse.wheel(0, 150);
    await expect
      .poll(() => distribution.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(outerStart);
  }
  expect(await page.evaluate(() => scrollY)).toBe(position);
  const cancel = distribution.getByRole("button", {
    name: "キャンセル",
    exact: true,
  });
  await reach(distribution, cancel);
  await cancel.click();
  await expect(distribution).toBeHidden();
  expect(await page.evaluate(() => scrollY)).toBe(position);
  // The bulk status change precedes this optional question. Cancelling only
  // skips the answer, retaining the existing SoldOut state and original memo.
  const cancelled = (await readBrowserEventLists(page))[eventName];
  expect(
    cancelled.filter((item) => item.purchaseStatus === "SoldOut"),
  ).toHaveLength(20);
  expect(
    cancelled.every((item) => item.remarks === "エラーが発生しました"),
  ).toBe(true);
  expect(cancelled[20].purchaseStatus).toBe("None");
  await record(testInfo, "distribution-scroll-boundary", {
    browserName,
    isMobile,
    backgroundPosition: position,
    desktopNestedWheelChecked: !isMobile,
  });
});

test("item deletion keeps backdrop scrolling locked until cancellation", async ({
  page,
  browserName,
  isMobile,
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "Physical iOS backdrop swipes are checked separately.",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await launch(page);
  await restore(page);
  await page.setViewportSize({ width: 667, height: 375 });
  const original = (await readBrowserEventLists(page))[eventName];
  const card = page
    .locator('[data-item-id="dialog-0"]')
    .first()
    .locator(":scope > div.rounded-lg")
    .first();
  await card.dispatchEvent("pointerdown", {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
  });
  await page.waitForTimeout(550);
  await card.dispatchEvent("pointerup", {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
  });
  await page.getByRole("button", { name: "削除", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "アイテムを削除",
    exact: true,
  });
  const panel = dialog.locator(":scope > div").first();
  await expectContained(panel);
  const position = await page.evaluate(() => scrollY);
  await scrollBackdrop(page, isMobile);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => scrollY)).toBe(position);
  await reach(panel, dialog.getByRole("button", { name: "No", exact: true }));
  await dialog.getByRole("button", { name: "No", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => scrollY)).toBe(position);
  expect((await readBrowserEventLists(page))[eventName]).toEqual(original);
  await expect(page.locator("body")).not.toHaveClass(/esp-body-scroll-lock/);
  await record(testInfo, "delete-scroll-boundary", {
    browserName,
    isMobile,
    position,
  });
});
