import { readBrowserEventLists } from "./shopping-transfer-persisted-store";
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

// Match the shopping harness response endpoint without trace/video overhead.
test.use({ video: "off", trace: "off" });
const eventName = "追加操作性能診断";
const phase = process.env.ESP_PRIORITY_PHASE ?? "unspecified";
function makeBackup(count: number) {
  const items = Array.from({ length: count }, (_, index) => ({
    id: `diagnostic-${index}`,
    circle: `診断サークル${index}`,
    title: `診断商品${index}`,
    eventDate: index === count - 1 ? "2日目" : "1日目",
    block: "A",
    number: index < 3 ? "1" : String(index),
    price: 500,
    quantity: index === 3 ? 1 : 5,
    purchaseStatus: "None",
    remarks: "ユーザー登録",
  }));
  const map = {
    cells: [],
    mergedCells: [],
    maxRow: 6,
    maxCol: 6,
    blocks: [
      {
        name: "A",
        startRow: 1,
        startCol: 1,
        endRow: 5,
        endCol: 5,
        numberCells: [
          { row: 2, col: 2, value: 1 },
          { row: 3, col: 2, value: 2 },
        ],
      },
    ],
  };
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-18T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: { [eventName]: items },
      eventMetadata: {},
      executeModeItems: {
        [eventName]: {
          "1日目": items
            .filter((item) => item.eventDate === "1日目")
            .map((item) => item.id),
          "2日目": [items[count - 1].id],
        },
      },
      dayModes: { [eventName]: { "1日目": "edit", "2日目": "edit" } },
      mapData: { [eventName]: { "1日目マップ": map, "2日目マップ": map } },
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
}
async function restore(page: Page, count: number) {
  await page.addInitScript(() => {
    localStorage.setItem("purchaseStatusControlMode", "radial");
    localStorage.setItem("skipLimitedPurchaseForSingleQuantity", "true");
  });
  await page.goto("/");
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "priority-operation-diagnostics.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(makeBackup(count)), "utf8"),
    });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog.getByRole("button", { name: "置換して復元" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-item-id="diagnostic-0"]')).toBeVisible();
  expect(
    page
      .workers()
      .some((worker) => worker.url().includes("persistence.worker")),
  ).toBe(true);
}
type Timings = Record<string, number[]>;
async function clickResponse(locator: Locator): Promise<number> {
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate(async (element) => {
    const start = performance.now();
    (element as HTMLElement).click();
    await new Promise(requestAnimationFrame);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return performance.now() - start;
  });
}
async function inputResponse(locator: Locator, value: string): Promise<number> {
  return locator.evaluate(async (element, value) => {
    const input = element as HTMLInputElement;
    const start = performance.now();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(requestAnimationFrame);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return performance.now() - start;
  }, value);
}
async function changeQuantityResponse(
  locator: Locator,
  value: string,
): Promise<number> {
  return locator.evaluate(async (element, value) => {
    const start = performance.now();
    (element as HTMLSelectElement).value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(requestAnimationFrame);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return performance.now() - start;
  }, value);
}
async function durableItem(page: Page, id: string) {
  const items = await readBrowserEventLists<{
    id: string;
    purchaseStatus: string;
    limitedPurchasedQuantity?: number;
    quantity: number;
  }>(page);
  const item = items[eventName]?.find((entry) => entry.id === id);
  if (!item) throw new Error("Persisted diagnostic item is missing: " + id);
  return item;
}
function add(timings: Timings, group: string, value: number) {
  (timings[group] ??= []).push(value);
}
async function report(
  testInfo: TestInfo,
  count: number,
  timings: Timings,
  completion: Timings,
  errors: string[],
  observations: Record<string, boolean[]>,
) {
  const summary = Object.fromEntries(
    Object.entries(timings).map(([name, values]) => {
      const warm = values.slice(1).sort((a, b) => a - b);
      return [
        name,
        {
          firstMs: values[0],
          count: warm.length,
          medianMs:
            (warm[Math.floor((warm.length - 1) / 2)] +
              warm[Math.ceil((warm.length - 1) / 2)]) /
            2,
          p95Ms: warm[Math.ceil(warm.length * 0.95) - 1],
        },
      ];
    }),
  );
  await testInfo.attach(`priority-operation-diagnostics-${phase}-${count}`, {
    body: JSON.stringify(
      {
        phase,
        count,
        viewport: { width: 1280, height: 900 },
        responseEndpoint:
          "performance.now before handler to requestAnimationFrame then timeout(0)",
        firstSamplePolicy:
          "values[0] reported separately; following 20 samples define warm summary",
        timings,
        summary,
        completionMs: completion,
        errors,
        observations,
        relayDiagnostics: "tests/browser/priority-relay-diagnostics.spec.ts",
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  return summary;
}
for (const count of [150, 500]) {
  test(`priority dialog and scope operations ${count} @priority-operation-performance`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(300000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const timings: Timings = {};
    const completion: Timings = {};
    const observations = {
      popupRetainedAfterDaySwitch: [] as boolean[],
      radialInputFocused: [] as boolean[],
      bulkNextInputFocused: [] as boolean[],
      invalidationInputFocused: [] as boolean[],
    };
    await restore(page, count);
    const row = page.locator('[data-item-id="diagnostic-0"]');
    const status = row.getByRole("button", { name: /Current status:/ });
    const main = page.getByRole("dialog", {
      name: "限数購入の数量",
      exact: true,
    });
    const confirmation = page.getByRole("dialog", {
      name: "購入済として保存しますか？",
      exact: true,
    });
    const radialLimited = page.getByRole("radio", {
      name: "LimitedPurchaseに変更",
      exact: true,
    });
    let summary: Awaited<ReturnType<typeof report>> = {};
    try {
      for (let sample = 0; sample < 21; sample++) {
        add(timings, "radial-open", await clickResponse(status));
        add(
          timings,
          "radial-to-limited-input",
          await clickResponse(radialLimited),
        );
        await expect(main).toBeVisible();
        const actual = main.getByRole("textbox", {
          name: "実購入数",
          exact: true,
        });
        observations.radialInputFocused.push(
          await actual.evaluate((input) => document.activeElement === input),
        );
        if (phase === "after") await expect(actual).toBeFocused();
        add(
          timings,
          "limited-quantity-input",
          await inputResponse(
            main.getByRole("textbox", { name: "実購入数", exact: true }),
            "5",
          ),
        );
        add(
          timings,
          "limited-confirm-open",
          await clickResponse(
            main.getByRole("button", { name: "保存", exact: true }),
          ),
        );
        await expect(confirmation).toBeVisible();
        add(
          timings,
          "limited-confirm-return",
          await clickResponse(
            confirmation.getByRole("button", {
              name: "入力に戻る",
              exact: true,
            }),
          ),
        );
        await expect(confirmation).toBeHidden();
        add(
          timings,
          "limited-cancel",
          await clickResponse(
            main.getByRole("button", { name: "キャンセル", exact: true }),
          ),
        );
        await expect(main).toBeHidden();
      }
      // Model an already accepted same-screen quantity update arriving during confirmation.
      // The real card handler and persistence worker process the change; no app state is injected.
      for (let sample = 0; sample < 21; sample++) {
        await row
          .getByRole("combobox", { name: "購入予定数量", exact: true })
          .selectOption("5");
        await clickResponse(status);
        await clickResponse(radialLimited);
        await inputResponse(
          main.getByRole("textbox", { name: "実購入数", exact: true }),
          "5",
        );
        await main.getByRole("button", { name: "保存", exact: true }).click();
        await expect(confirmation).toBeVisible();
        const started = await page.evaluate(() => performance.now());
        add(
          timings,
          "same-screen-confirmation-invalidation",
          await changeQuantityResponse(
            row.getByRole("combobox", { name: "購入予定数量", exact: true }),
            "6",
          ),
        );
        await expect(confirmation).toBeHidden();
        const actual = main.getByRole("textbox", {
          name: "実購入数",
          exact: true,
        });
        observations.invalidationInputFocused.push(
          await actual.evaluate((input) => document.activeElement === input),
        );
        if (phase === "after") await expect(actual).toBeFocused();
        await expect
          .poll(async () => (await durableItem(page, "diagnostic-0")).quantity)
          .toBe(6);
        add(
          completion,
          "same-screen-quantity-save",
          (await page.evaluate(() => performance.now())) - started,
        );
        await main
          .getByRole("button", { name: "キャンセル", exact: true })
          .click();
      }
      const single = page.locator('[data-item-id="diagnostic-3"]');
      const choice = page.getByRole("dialog", {
        name: "限数にしますか？",
        exact: true,
      });
      for (let sample = 0; sample < 21; sample++) {
        await single.scrollIntoViewIfNeeded();
        await single.getByRole("button", { name: /Current status:/ }).click();
        add(
          timings,
          "radial-to-single-choice",
          await clickResponse(radialLimited),
        );
        await expect(choice).toBeVisible();
        add(
          timings,
          "single-choice-to-limited",
          await clickResponse(
            choice.getByRole("button", { name: "限数", exact: true }),
          ),
        );
        await expect(main).toBeVisible();
        add(
          timings,
          "single-choice-limited-cancel",
          await clickResponse(
            main.getByRole("button", { name: "キャンセル", exact: true }),
          ),
        );
        await expect(main).toBeHidden();
      }
      await row
        .getByRole("combobox", { name: "購入予定数量", exact: true })
        .selectOption("5");
      await page.getByTitle("集中モード", { exact: true }).click();
      for (let sample = 0; sample < 21; sample++) {
        if (sample > 0) {
          await status.click();
          await page
            .getByRole("radio", { name: "Noneに変更", exact: true })
            .click();
          await expect
            .poll(
              async () =>
                (await durableItem(page, "diagnostic-0")).purchaseStatus,
            )
            .toBe("None");
        }
        add(
          timings,
          "bulk-limited-open",
          await clickResponse(
            page.getByRole("button", { name: "全限数", exact: true }).first(),
          ),
        );
        await expect(main).toContainText("診断商品0");
        await inputResponse(
          main.getByRole("textbox", { name: "実購入数", exact: true }),
          "2",
        );
        const started = await page.evaluate(() => performance.now());
        add(
          timings,
          "bulk-limited-save-next",
          await clickResponse(
            main.getByRole("button", { name: "保存", exact: true }),
          ),
        );
        await expect(main).toContainText("診断商品1");
        const nextActual = main.getByRole("textbox", {
          name: "実購入数",
          exact: true,
        });
        observations.bulkNextInputFocused.push(
          await nextActual.evaluate(
            (input) => document.activeElement === input,
          ),
        );
        if (phase === "after") await expect(nextActual).toBeFocused();
        await expect
          .poll(
            async () =>
              (await durableItem(page, "diagnostic-0"))
                .limitedPurchasedQuantity,
          )
          .toBe(2);
        add(
          completion,
          "bulk-limited-save",
          (await page.evaluate(() => performance.now())) - started,
        );
        await main
          .getByRole("button", { name: "キャンセル", exact: true })
          .click();
      }
      await page.getByTitle("編集モード", { exact: true }).click();
      await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
      const popup = page.getByRole("dialog", {
        name: "A-1のアイテム一覧",
        exact: true,
      });
      for (let sample = 0; sample < 21; sample++) {
        await page.getByRole("button", { name: /^1日目/ }).click();
        await page.locator("canvas").click({ position: { x: 42, y: 42 } });
        await expect(popup).toBeVisible();
        add(
          timings,
          "day-switch-popup-invalidation",
          await clickResponse(page.getByRole("button", { name: /^2日目/ })),
        );
        const retained = await popup.isVisible();
        observations.popupRetainedAfterDaySwitch.push(retained);
        if (phase === "after") await expect(popup).toBeHidden();
        // The baseline may retain the old popup. Close it explicitly only for preparing the next sample.
        if (retained)
          await popup
            .getByRole("button", {
              name: "A-1のアイテム一覧を閉じる",
              exact: true,
            })
            .click();
      }
    } finally {
      summary = await report(
        testInfo,
        count,
        timings,
        completion,
        errors,
        observations,
      );
    }
    expect(errors).toEqual([]);
    for (const [operation, result] of Object.entries(summary)) {
      expect(
        result.count,
        operation + " warm sample count",
      ).toBeGreaterThanOrEqual(20);
      expect(result.medianMs, operation + " median").toBeLessThanOrEqual(55);
      expect(result.p95Ms, operation + " p95").toBeLessThanOrEqual(100);
    }
  });
}
