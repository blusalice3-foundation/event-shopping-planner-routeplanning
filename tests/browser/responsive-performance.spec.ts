import { expect, test, type Page } from "@playwright/test";
const eventName = "応答速度検証";
const makeBackup = (
  count: number,
  concentrated = false,
  historicalCount = 10000,
  decorated = false,
) => {
  const item = (id: string, index: number) => ({
    id,
    eventDate: "1日目",
    circle: "ユーザー登録" + index,
    title: "新刊" + index,
    block: "A",
    number: String(concentrated && index < count - 10 ? 1 : index + 1),
    price: 500,
    quantity: 1,
    purchaseStatus: "None",
    remarks: "エラーが発生しました",
  });
  const items = Array.from({ length: count }, (_, index) =>
    item("perf-" + index, index),
  );
  const histories = Object.fromEntries(
    Array.from({ length: historicalCount / 1000 }, (_, event) => [
      "過去イベント" + event,
      Array.from({ length: 1000 }, (_, index) =>
        item(`past-${event}-${index}`, index),
      ),
    ]),
  );
  const coords = (index: number) => ({
    row: 2 + Math.floor(index / 99) * 2,
    col: 2 + (index % 99) * 2,
  });
  const numbered = new Map(
    items.map((_, index) => {
      const point = coords(index);
      return [`${point.row}-${point.col}`, index + 1];
    }),
  );
  const map = {
    maxRow: 200,
    maxCol: 200,
    mergedCells: [],
    cells: Array.from({ length: 40000 }, (_, index) => {
      const row = Math.floor(index / 200) + 1,
        col = (index % 200) + 1;
      return {
        row,
        col,
        value: numbered.get(`${row}-${col}`) ?? null,
        // Colored cells are obstacles. Keep an entrance corridor around the first visits.
        backgroundColor:
          decorated &&
          (numbered.has(`${row}-${col}`) || (row > 3 && index % 3 === 0))
            ? "#fef3c7"
            : null,
        borders: {
          // Decorated fences retain regularly spaced passages for reachable routes.
          top:
            decorated && row % 5 === 0 && col % 20 > 1
              ? { style: "thin", color: "#666666" }
              : null,
          right: null,
          bottom: null,
          left: null,
        },
      };
    }),
    blocks: [
      {
        name: "A",
        startRow: 1,
        startCol: 1,
        endRow: 200,
        endCol: 200,
        numberCells: items.map((_, index) => ({
          ...coords(index),
          value: index + 1,
        })),
      },
    ],
  };
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-08T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: { [eventName]: items, ...histories },
      eventMetadata: {},
      executeModeItems: {
        [eventName]: { "1日目": items.map((entry) => entry.id) },
      },
      dayModes: { [eventName]: { "1日目": "execute" } },
      mapData: { [eventName]: { "1日目マップ": map } },
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
};
async function restore(
  page: Page,
  count: number,
  concentrated = false,
  historicalCount = 10000,
  decorated = false,
  initialExecuteCount?: number,
  multipleHalls = false,
) {
  await page.goto("/");
  const backup = makeBackup(count, concentrated, historicalCount, decorated);
  if (initialExecuteCount !== undefined)
    backup.data.executeModeItems[eventName]["1日目"] =
      backup.data.executeModeItems[eventName]["1日目"].slice(
        0,
        initialExecuteCount,
      );
  if (multipleHalls)
    Object.assign(backup.data.hallDefinitions, {
      [eventName]: {
        "1日目マップ": [
          {
            id: "west",
            name: "西",
            vertices: [
              { row: 0, col: 0 },
              { row: 0, col: 100 },
              { row: 200, col: 100 },
              { row: 200, col: 0 },
            ],
          },
          {
            id: "east",
            name: "東",
            vertices: [
              { row: 0, col: 100 },
              { row: 0, col: 200 },
              { row: 200, col: 200 },
              { row: 200, col: 100 },
            ],
          },
        ],
      },
    });
  for (const name of Object.keys(backup.data.eventLists)) {
    await page
      .locator('input[aria-label="バックアップファイルを選択"]')
      .setInputFiles({
        name: "performance.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(backup), "utf8"),
      });
    const dialog = page.getByRole("dialog", {
      name: "バックアップからイベントを復元",
    });
    await dialog.getByLabel("復元するイベント").selectOption(name);
    await dialog.getByRole("radio", { name: /同名で置換/ }).check();
    await dialog.getByRole("button", { name: "置換して復元" }).click();
    await expect(dialog).toBeHidden({ timeout: 60000 });
  }
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("EventShoppingPlannerDB");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            return await new Promise<number>((resolve, reject) => {
              const request = db
                .transaction("eventLists")
                .objectStore("eventLists")
                .get("data");
              request.onsuccess = () =>
                resolve(
                  Object.entries(request.result as Record<string, unknown[]>)
                    .filter(([name]) => name.startsWith("過去イベント"))
                    .reduce((sum, [, items]) => sum + items.length, 0),
                );
              request.onerror = () => reject(request.error);
            });
          } finally {
            db.close();
          }
        }),
      { timeout: 60000 },
    )
    .toBe(historicalCount);
  await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  await page.getByText(eventName, { exact: true }).click();
  await expect(page.locator('[data-item-id="perf-0"]')).toBeVisible();
}
async function durableItem(page: Page, id: string) {
  return page.evaluate(
    async ({ eventName, id }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("EventShoppingPlannerDB");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<Record<string, unknown>>((resolve, reject) => {
          const request = db
            .transaction("eventLists", "readonly")
            .objectStore("eventLists")
            .get("data");
          request.onsuccess = () =>
            resolve(
              request.result[eventName].find(
                (item: { id: string }) => item.id === id,
              ),
            );
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    },
    { eventName, id },
  );
}
for (const count of [150, 500, 1500]) {
  test(`bounded DOM and response timings: ${count} items, 40000 cells, 10000 historical items`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240000);
    page.setDefaultTimeout(15000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await restore(page, count);
    const rows = page.locator(
      '[data-list-renderer-strategy="retained-viewport"]',
    );
    await expect(rows).toBeVisible();
    const samples: {
      scenario: string;
      inputResponseMs: number;
      completionMs: number;
    }[] = [];
    const first = page.locator('[data-item-id="perf-0"]');
    const start = await page.evaluate(() => performance.now());
    const inputResponseMs = await first.evaluate(async (row) => {
      const started = performance.now();
      const quantity = row.querySelector<HTMLSelectElement>(
        'select[aria-label="購入予定数量"]',
      )!;
      quantity.value = "7";
      quantity.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(requestAnimationFrame);
      return performance.now() - started;
    });
    await expect
      .poll(async () => (await durableItem(page, "perf-0")).quantity, {
        timeout: 60000,
      })
      .toBe(7);
    samples.push({
      scenario: "quantity",
      inputResponseMs,
      completionMs: (await page.evaluate(() => performance.now())) - start,
    });
    const purchaseStart = await page.evaluate(() => performance.now());
    const purchaseResponse = await first.evaluate(async (row) => {
      const started = performance.now();
      const status = row.querySelector<HTMLButtonElement>(
        'button[aria-label^="Current status:"]',
      )!;
      status.click();
      document
        .querySelector<HTMLElement>(
          '[data-item-id="perf-1"] button[aria-label^="Current status:"]',
        )!
        .click();
      document
        .querySelector<HTMLElement>(
          '[data-item-id="perf-2"] button[aria-label^="Current status:"]',
        )!
        .click();
      await new Promise(requestAnimationFrame);
      return performance.now() - started;
    });
    const displayed = await first
      .getByRole("button", { name: /Current status:/ })
      .getAttribute("aria-label");
    const statusByTitle: Record<string, string> = {
      未購入: "None",
      購入済: "Purchased",
      売切: "SoldOut",
      後回し: "Postpone",
      遅参: "Late",
      限数: "LimitedPurchase",
      欠席: "Absent",
    };
    const expectedStatus =
      statusByTitle[displayed!.slice("Current status: ".length).split(".")[0]];
    expect(expectedStatus).toBe("Purchased");
    for (const id of ["perf-0", "perf-1", "perf-2"])
      await expect
        .poll(async () => (await durableItem(page, id)).purchaseStatus, {
          timeout: 60000,
        })
        .toBe(expectedStatus);
    samples.push({
      scenario: "purchase-burst",
      inputResponseMs: purchaseResponse,
      completionMs:
        (await page.evaluate(() => performance.now())) - purchaseStart,
    });
    // Visit the entire normal-flow list, then ensure controls return to a viewport-sized bound.
    await page.evaluate(async () => {
      const end = document.documentElement.scrollHeight;
      for (let top = 0; top < end; top += innerHeight * 0.8) {
        scrollTo(0, top);
        await new Promise(requestAnimationFrame);
      }
      scrollTo(0, 0);
      await new Promise(requestAnimationFrame);
    });
    await expect(first).toBeVisible();
    await expect
      .poll(() => page.locator("[data-item-id]").count())
      .toBeLessThan(45);
    const cards = await page.locator("[data-item-id]").count();
    const options = await rows.locator("option").count();
    expect(options).toBeLessThanOrEqual(cards * 130);
    const memoStart = await page.evaluate(() => performance.now());
    await first
      .getByRole("textbox", { name: "利用者メモ" })
      .fill("閲覧後の日本語入力");
    const memoResponse =
      (await page.evaluate(() => performance.now())) - memoStart;
    await expect
      .poll(async () => (await durableItem(page, "perf-0")).remarks, {
        timeout: 60000,
      })
      .toBe("閲覧後の日本語入力");
    samples.push({
      scenario: "memo-after-traversal",
      inputResponseMs: memoResponse,
      completionMs: (await page.evaluate(() => performance.now())) - memoStart,
    });
    const search = page.getByPlaceholder("検索...");
    const searchInputStart = await page.evaluate(() => performance.now());
    await search.fill("ユーザー登録" + (count - 1));
    const searchInputResponse =
      (await page.evaluate(() => performance.now())) - searchInputStart;
    await search.dispatchEvent("compositionstart");
    await search.press("Enter");
    await search.dispatchEvent("compositionend");
    const searchStart = await page.evaluate(() => performance.now());
    await page.getByRole("button", { name: "次を検索", exact: true }).click();
    const last = page.locator(`[data-item-id="perf-${count - 1}"]`);
    await expect(last).toBeInViewport({ ratio: 0.1 });
    const searchTime =
      (await page.evaluate(() => performance.now())) - searchStart;
    samples.push({
      scenario: "Japanese-search",
      inputResponseMs: searchInputResponse,
      completionMs: searchTime + (searchStart - searchInputStart),
    });
    let previousScroll = -1;
    let stableScrollCount = 0;
    await expect
      .poll(
        async () => {
          const value = await page.evaluate(() => scrollY);
          stableScrollCount =
            value === previousScroll ? stableScrollCount + 1 : 0;
          previousScroll = value;
          return stableScrollCount >= 2;
        },
        { intervals: [50, 50, 50] },
      )
      .toBe(true);
    const zoomAnchor = await rows.evaluate((root) => {
      const viewportTop =
        document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
      const row = [
        ...root.querySelectorAll<HTMLElement>("[data-row-key][aria-posinset]"),
      ].find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > viewportTop && rect.top < innerHeight;
      })!;
      return { key: row.dataset.rowKey!, top: row.getBoundingClientRect().top };
    });
    await page.getByTitle("表示項目の設定", { exact: true }).click();
    await page.getByLabel("画面の表示倍率").selectOption("125");
    await expect(rows).toHaveAttribute("data-list-renderer", "virtual");
    await expect
      .poll(() => page.locator("[data-item-id]").count())
      .toBeLessThan(45);
    await page
      .locator("div.fixed.inset-0.z-40")
      .first()
      .click({ position: { x: 2, y: 100 } });
    await expect
      .poll(async () =>
        rows.evaluate((root, anchor) => {
          const row = [
            ...root.querySelectorAll<HTMLElement>("[data-row-key]"),
          ].find((element) => element.dataset.rowKey === anchor.key)!;
          return Math.abs(row.getBoundingClientRect().top - anchor.top);
        }, zoomAnchor),
      )
      .toBeLessThan(8);
    const editorTarget = last.locator(":scope > div.rounded-lg").first();
    await editorTarget.dispatchEvent("pointerdown", {
      button: 0,
      isPrimary: true,
      pointerType: "mouse",
    });
    await expect(
      page.getByRole("button", { name: "編集", exact: true }),
    ).toBeVisible();
    await editorTarget.dispatchEvent("pointerup", {
      button: 0,
      isPrimary: true,
      pointerType: "mouse",
    });
    await page.getByRole("button", { name: "編集", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "アイテム編集" });
    await expect(editor).toBeVisible();
    await page.evaluate(() => scrollTo(0, 0));
    await expect(rows).toHaveAttribute("data-list-renderer", "virtual");
    await expect(last).toHaveCount(1);
    await expect
      .poll(() => page.locator("[data-item-id]").count())
      .toBeLessThan(45);
    await editor
      .getByRole("button", { name: "キャンセル", exact: true })
      .click();
    await page.getByTitle("集中モード", { exact: true }).click();
    for (let index = 0; index < 3; index++)
      await page.getByTitle("次の訪問先", { exact: true }).click();
    const focusCard = page.locator('[data-item-id="perf-3"]');
    await expect(focusCard).toBeVisible();
    const nextStart = await page.evaluate(() => performance.now());
    await focusCard.getByRole("button", { name: /Current status:/ }).click();
    await page.getByTitle("次の訪問先", { exact: true }).click();
    const nextTime = (await page.evaluate(() => performance.now())) - nextStart;
    await expect(page.locator('[data-item-id="perf-4"]')).toBeVisible();
    await expect
      .poll(async () => (await durableItem(page, "perf-3")).purchaseStatus)
      .toBe("Purchased");
    samples.push({
      scenario: "purchase-then-next",
      inputResponseMs: nextTime,
      completionMs: (await page.evaluate(() => performance.now())) - nextStart,
    });
    await page.getByTitle("マップを表示", { exact: true }).click();
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();
    const readImage = () =>
      canvas.evaluate((element) => {
        const value = (element as HTMLCanvasElement).toDataURL();
        let hash = 2166136261;
        for (let index = 0; index < value.length; index++)
          hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
        return hash >>> 0;
      });
    const settleImage = async () => {
      let previous = -1,
        stable = 0;
      await expect
        .poll(
          async () => {
            const current = await readImage();
            stable = current === previous ? stable + 1 : 0;
            previous = current;
            return stable >= 2;
          },
          { intervals: [50, 50, 50] },
        )
        .toBe(true);
    };
    await settleImage();
    const beforePinch = await readImage();
    const pinchStart = await page.evaluate(() => performance.now());
    const pinchResponse = await canvas.evaluate(async (element) => {
      const rect = element.getBoundingClientRect();
      const root = element.parentElement!;
      const started = performance.now();
      const touch = (identifier: number, delta: number) =>
        new Touch({
          identifier,
          target: root,
          clientX: rect.left + rect.width / 2 + delta,
          clientY: rect.top + rect.height / 2,
        });
      const emit = (type: string, distance: number) => {
        const touches = [touch(1, -distance), touch(2, distance)];
        root.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches,
            changedTouches: touches,
          }),
        );
      };
      emit("touchstart", 40);
      for (let index = 0; index < 30; index++) emit("touchmove", 40 + index);
      await new Promise(requestAnimationFrame);
      root.dispatchEvent(
        new TouchEvent("touchend", {
          bubbles: true,
          changedTouches: [touch(1, -69), touch(2, 69)],
          touches: [],
        }),
      );
      return performance.now() - started;
    });
    await expect.poll(readImage).not.toBe(beforePinch);
    await settleImage();
    samples.push({
      scenario: "continuous-pinch",
      inputResponseMs: pinchResponse,
      completionMs: (await page.evaluate(() => performance.now())) - pinchStart,
    });
    await page.reload();
    await expect
      .poll(async () => (await durableItem(page, "perf-0")).remarks)
      .toBe("閲覧後の日本語入力");
    expect(errors).toEqual([]);
    await testInfo.attach("response-timings", {
      body: JSON.stringify(
        {
          count,
          cells: 40000,
          historicalItems: 10000,
          cards,
          options,
          samples,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  });
}

test("direct field commands review another tab and retain inputs across worker save failure", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(15000);
  await restore(page, 150);
  await page.getByTitle("表示項目の設定", { exact: true }).click();
  await page.getByLabel("画面の表示倍率").selectOption("125");
  await page
    .locator("div.fixed.inset-0.z-40")
    .first()
    .click({ position: { x: 2, y: 100 } });
  const other = await context.newPage();
  await other.goto("/");
  await other.getByText(eventName, { exact: true }).click();
  const first = page.locator('[data-item-id="perf-0"]');
  const otherFirst = other.locator('[data-item-id="perf-0"]');
  await otherFirst
    .getByRole("combobox", { name: "購入予定数量", exact: true })
    .selectOption("4");
  await expect
    .poll(async () => (await durableItem(page, "perf-0")).quantity)
    .toBe(4);
  await first
    .getByRole("combobox", { name: "購入予定数量", exact: true })
    .selectOption("7");
  const review = page.getByRole("dialog", { name: "競合する更新を確認" });
  await expect(review).toBeVisible();
  await expect(
    page.locator('[data-list-renderer-strategy="retained-viewport"]'),
  ).toHaveAttribute("data-list-renderer", "virtual");
  expect(await page.locator("[data-item-id]").count()).toBeLessThan(45);
  expect((await durableItem(page, "perf-0")).quantity).toBe(4);
  await review
    .getByRole("button", { name: "確認して保存", exact: true })
    .click();
  await expect(review).toBeHidden();
  await expect
    .poll(async () => (await durableItem(page, "perf-0")).quantity)
    .toBe(7);
  const worker = page
    .workers()
    .find((candidate) => candidate.url().includes("persistence.worker"))!;
  await worker.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<typeof original>
    ) {
      if (this.transaction.mode === "readwrite") {
        IDBObjectStore.prototype.put = original;
        throw new DOMException("購入記録の書き込み失敗", "QuotaExceededError");
      }
      return original.apply(this, args);
    };
  });
  await first
    .getByRole("combobox", { name: "購入金額", exact: true })
    .selectOption("900");
  const failure = page
    .getByRole("alert")
    .filter({ hasText: "件の操作を未保存のまま保留しています" });
  await expect(failure).toBeVisible();
  await expect(
    first.getByRole("combobox", { name: "購入金額", exact: true }),
  ).toHaveValue("900");
  expect((await durableItem(page, "perf-0")).price).toBe(500);
  await failure
    .getByRole("button", { name: "保留中の保存を再試行", exact: true })
    .click();
  await expect
    .poll(async () => (await durableItem(page, "perf-0")).price)
    .toBe(900);
  await page.reload();
  await page.getByText(eventName, { exact: true }).click();
  await expect(
    first.getByRole("combobox", { name: "購入金額", exact: true }),
  ).toHaveValue("900");
  await expect(
    first.getByRole("combobox", { name: "購入予定数量", exact: true }),
  ).toHaveValue("7");
  await other.close();
});

type ShoppingDiagnostics = {
  enable(value?: boolean): void;
  reset(): void;
  read(): {
    samples: { operation: string; phase: string; durationMs: number }[];
    renders: Record<string, number>;
    summary: Record<string, { count: number; medianMs: number; p95Ms: number }>;
  };
};
const shoppingProfiles = [false, true].flatMap((concentrated) =>
  [false, true].flatMap((mapVisible) =>
    (["pc", "smartphone"] as const).map((layout) => ({
      concentrated,
      mapVisible,
      layout,
    })),
  ),
);
for (const count of [150, 500, 1500])
  for (const { concentrated, mapVisible, layout } of shoppingProfiles) {
    test(`local shopping operations: ${count} items, concentrated=${concentrated}, mapVisible=${mapVisible}, layout=${layout} @shopping-performance`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(360000);
      page.setDefaultTimeout(15000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width: 1280, height: 900 });
      await restore(page, count, concentrated);
      if (layout === "smartphone") {
        await page.getByTitle("表示項目の設定", { exact: true }).click();
        await page
          .getByTitle("スマートフォンモードに切替", { exact: true })
          .click();
        await page.setViewportSize({ width: 390, height: 844 });
        await page
          .locator("div.fixed.inset-0.z-40")
          .first()
          .click({ position: { x: 2, y: 100 } });
        const groups = page.getByRole("button", {
          name: "スペース別",
          exact: true,
        });
        if (!(await groups.getAttribute("class"))?.includes("bg-blue-600"))
          await groups.click();
      }
      const diagnostics = (action: "enable" | "reset" | "read") =>
        page.evaluate((action) => {
          const api = (
            window as unknown as {
              __espShoppingPerformance: ShoppingDiagnostics;
            }
          ).__espShoppingPerformance;
          return action === "read" ? api.read() : api[action]();
        }, action);
      await diagnostics("enable");
      await diagnostics("reset");
      const timings: Record<string, number[]> = {
        execute: [],
        executeRecord: [],
        focus: [],
        record: [],
        next: [],
        back: [],
      };
      const prepareItem = async (rowKey: string, itemId: string) => {
        await expect
          .poll(
            async () => {
              await page
                .locator(`[data-row-key='${rowKey}']`)
                .evaluate(async (row) => {
                  row.scrollIntoView({ block: "center" });
                  await new Promise(requestAnimationFrame);
                  await new Promise((resolve) => setTimeout(resolve, 0));
                });
              return page.locator(`[data-item-id="${itemId}"]`).isVisible();
            },
            { timeout: 15000 },
          )
          .toBe(true);
      };
      const clickResponse = async (
        locator: ReturnType<Page["locator"]>,
        button: string,
        group: string,
      ) => {
        await locator.scrollIntoViewIfNeeded();
        const duration = await locator.evaluate(async (root, selector) => {
          const button = root.matches(selector)
            ? (root as HTMLButtonElement)
            : root.querySelector<HTMLButtonElement>(selector)!;
          const start = performance.now();
          button.click();
          await new Promise(requestAnimationFrame);
          await new Promise((resolve) => setTimeout(resolve, 0));
          return performance.now() - start;
        }, button);
        timings[group].push(duration);
      };
      const navigateResponse = async (
        direction: "next" | "back",
        record = true,
      ) => {
        if (layout === "pc") {
          const button = page.getByTitle(
            direction === "next" ? "次の訪問先" : "前の訪問先",
            { exact: true },
          );
          if (record) await clickResponse(button, "button", direction);
          else await button.click();
          return;
        }
        const duration = await page
          .getByTestId("focus-mode-scroll-region")
          .evaluate(async (root, direction) => {
            const emit = (type: string, x: number) => {
              const point = { clientX: x, clientY: 200 };
              const event = new Event(type, { bubbles: true });
              Object.defineProperties(event, {
                touches: { value: type === "touchend" ? [] : [point] },
                changedTouches: { value: [point] },
              });
              root.dispatchEvent(event);
            };
            const start = performance.now();
            emit("touchstart", 200);
            emit("touchmove", direction === "next" ? 80 : 320);
            emit("touchend", direction === "next" ? 80 : 320);
            await new Promise(requestAnimationFrame);
            await new Promise((resolve) => setTimeout(resolve, 0));
            return performance.now() - start;
          }, direction);
        if (record) timings[direction].push(duration);
      };
      // Scroll across the complete list before measuring, so old cards must be released.
      const visitedIds = await page.evaluate(async () => {
        const seen = new Set<string>();
        const collect = () =>
          document
            .querySelectorAll<HTMLElement>("[data-item-id]")
            .forEach((row) => seen.add(row.dataset.itemId!));
        const step = innerHeight;
        collect();
        for (
          let top = 0;
          top < document.documentElement.scrollHeight;
          top += step
        ) {
          scrollTo(0, top);
          await new Promise(requestAnimationFrame);
          await new Promise((resolve) => setTimeout(resolve, 0));
          collect();
        }
        scrollTo(0, document.documentElement.scrollHeight);
        await new Promise(requestAnimationFrame);
        await new Promise((resolve) => setTimeout(resolve, 0));
        collect();
        scrollTo(0, 0);
        await new Promise(requestAnimationFrame);
        return [...seen];
      });
      const visited = new Set(visitedIds);
      for (let index = 0; index < count; index++) {
        const id = `perf-${index}`;
        if (visited.has(id)) continue;
        await prepareItem(`item:"${id}"`, id);
        visited.add(id);
      }
      const visitedCount = visited.size;
      expect(visitedCount).toBe(count);
      await diagnostics("reset");
      const profiler = process.env.ESP_PROFILE_SHOPPING
        ? await page.context().newCDPSession(page)
        : undefined;
      await profiler?.send("Profiler.enable");
      await profiler?.send("Profiler.start");
      for (let index = 0; index < 20; index++) {
        const row = page.locator(`[data-item-id="perf-${index}"]`);
        await prepareItem(`item:"perf-${index}"`, `perf-${index}`);
        await clickResponse(
          row,
          'button[aria-label^="Current status:"]',
          "execute",
        );
      }
      await expect
        .poll(async () => (await durableItem(page, "perf-19")).purchaseStatus, {
          timeout: 60000,
        })
        .toBe("Purchased");
      expect(await page.locator("[data-item-id]").count()).toBeLessThan(60);
      const executionDiagnostic = await diagnostics("read");
      if (profiler) {
        const profile = await profiler.send("Profiler.stop");
        await testInfo.attach("execution-cpu-profile", {
          body: JSON.stringify(profile),
          contentType: "application/json",
        });
        await profiler.detach();
      }
      await diagnostics("reset");
      const executionRow = page.locator('[data-item-id="perf-19"]');
      await executionRow.scrollIntoViewIfNeeded();
      await executionRow
        .getByRole("button", { name: /Current status:/ })
        .click();
      const executionDialog = page.getByRole("dialog", {
        name: "事後通販･頒布可否確認",
      });
      await expect(executionDialog).toBeVisible();
      for (let sample = 0; sample < 20; sample++) {
        if (sample > 0) {
          await executionRow.evaluate(async (root) => {
            const button = root.querySelector<HTMLButtonElement>(
              'button[aria-label^="Current status:"]',
            )!;
            for (let transition = 0; transition < 6; transition++)
              button.click();
            await new Promise(requestAnimationFrame);
          });
          await expect(executionDialog).toBeVisible();
        }
        await executionDialog
          .getByRole("combobox", { name: "回答内容", exact: true })
          .selectOption({ index: 1 + (sample % 2) });
        await clickResponse(
          executionDialog.getByRole("button", {
            name: "記録",
            exact: true,
          }),
          "button",
          "executeRecord",
        );
        await expect(executionDialog).toBeHidden();
        await expect(
          executionRow.getByRole("button", {
            name: /Current status: 売切/,
          }),
        ).toBeVisible();
      }
      await expect
        .poll(async () => (await durableItem(page, "perf-19")).remarks, {
          timeout: 60000,
        })
        .toContain("通販･頒布確認");
      const executionRecordDiagnostic = await diagnostics("read");
      await page.getByTitle("集中モード", { exact: true }).click();
      if (!concentrated)
        for (let index = 0; index < 20; index++)
          await navigateResponse("next", false);
      if (mapVisible)
        await page.getByTitle("マップを表示", { exact: true }).click();
      await diagnostics("reset");
      for (let index = 20; index < 40; index++) {
        const row = page.locator(`[data-item-id="perf-${index}"]`);
        if (concentrated)
          await prepareItem(`focus:perf-${index}`, `perf-${index}`);
        await expect(row).toBeVisible();
        await clickResponse(
          row,
          'button[aria-label^="Current status:"]',
          "focus",
        );
        if (!concentrated) await navigateResponse("next");
      }
      const target = concentrated ? "perf-39" : "perf-40";
      const row = page.locator(`[data-item-id="${target}"]`);
      if (!concentrated)
        await clickResponse(
          row,
          'button[aria-label^="Current status:"]',
          "focus",
        );
      await clickResponse(
        row,
        'button[aria-label^="Current status:"]',
        "focus",
      );
      const dialog = page.getByRole("dialog", {
        name: "事後通販･頒布可否確認",
      });
      await expect(dialog).toBeVisible();
      for (let sample = 0; sample < 20; sample++) {
        if (sample > 0) {
          // Exercise all six transitions before React renders; the final intent
          // equals the rendered status and must still be accepted in order.
          await row.evaluate(async (root) => {
            const button = root.querySelector<HTMLButtonElement>(
              'button[aria-label^="Current status:"]',
            )!;
            for (let transition = 0; transition < 6; transition++)
              button.click();
            await new Promise(requestAnimationFrame);
          });
          await expect(dialog).toBeVisible();
        }
        await dialog
          .getByRole("combobox", { name: "回答内容", exact: true })
          .selectOption({ index: 1 + (sample % 2) });
        await clickResponse(
          dialog.getByRole("button", { name: "記録", exact: true }),
          "button",
          "record",
        );
        await expect(dialog).toBeHidden();
        await expect(
          row.getByRole("button", { name: /Current status: 売切/ }),
        ).toBeVisible();
      }
      await navigateResponse("next");
      await expect(dialog).toBeHidden();
      await expect
        .poll(async () => (await durableItem(page, target)).remarks, {
          timeout: 60000,
        })
        .toContain("通販･頒布確認");
      await expect
        .poll(async () => (await durableItem(page, target)).purchaseStatus)
        .toBe("SoldOut");
      const backProfiler = process.env.ESP_PROFILE_FOCUS_BACK
        ? await page.context().newCDPSession(page)
        : undefined;
      await backProfiler?.send("Profiler.enable");
      await backProfiler?.send("Profiler.start");
      // Returning to the large first space also exercises retained input state.
      for (let sample = 0; sample < 20; sample++) {
        await navigateResponse("back");
        await navigateResponse("next");
      }
      if (backProfiler) {
        const profile = await backProfiler.send("Profiler.stop");
        await testInfo.attach("focus-back-cpu-profile", {
          body: JSON.stringify(profile),
          contentType: "application/json",
        });
        await backProfiler.detach();
      }
      const diagnostic = await diagnostics("read");
      const summary = Object.fromEntries(
        Object.entries(timings).map(([operation, values]) => {
          values.sort((a, b) => a - b);
          return [
            operation,
            {
              count: values.length,
              medianMs: values[Math.ceil(values.length * 0.5) - 1],
              p95Ms: values[Math.ceil(values.length * 0.95) - 1],
            },
          ];
        }),
      );
      await testInfo.attach("shopping-operation-timings", {
        body: JSON.stringify(
          {
            count,
            concentrated,
            mapVisible,
            layout,
            visitedCount,
            timings,
            summary,
            diagnostic,
            executionDiagnostic,
            executionRecordDiagnostic,
            errors,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
      expect(errors).toEqual([]);
      if (count === 1500) {
        for (const operation of [
          "execute",
          "executeRecord",
          "focus",
          "record",
          "next",
          "back",
        ]) {
          expect(
            summary[operation].count,
            operation + " sample count",
          ).toBeGreaterThanOrEqual(20);
          expect(
            summary[operation].medianMs,
            operation + " median",
          ).toBeLessThanOrEqual(50);
          expect(
            summary[operation].p95Ms,
            operation + " p95",
          ).toBeLessThanOrEqual(100);
        }
      }
    });
  }

type PerformanceMode = "edit" | "execute" | "focus";
const modeTitles: Record<PerformanceMode, string> = {
  edit: "編集モード",
  execute: "実行モード",
  focus: "集中モード",
};
const modeClasses: Record<PerformanceMode, string> = {
  edit: "bg-blue-100",
  execute: "bg-green-100",
  focus: "bg-purple-100",
};
async function measureModeClick(page: Page, mode: PerformanceMode) {
  const button = page.getByTitle(modeTitles[mode], { exact: true });
  const bounds = await button.boundingBox();
  if (!bounds) throw new Error("Mode button is not visible.");
  await button.evaluate((element, activeClass) => {
    const state = window as unknown as {
      modeMeasurement?: { durationMs: number };
    };
    state.modeMeasurement = undefined;
    element.addEventListener(
      "click",
      (event) => {
        const started = event.timeStamp;
        const observer = new MutationObserver(check);
        let completed = false;
        function check() {
          if (completed || !element.classList.contains(activeClass)) return;
          completed = true;
          observer.disconnect();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              state.modeMeasurement = {
                durationMs: performance.now() - started,
              };
            }),
          );
        }
        observer.observe(document.body, {
          attributes: true,
          childList: true,
          subtree: true,
        });
        check();
      },
      { once: true },
    );
  }, modeClasses[mode]);
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.waitForFunction(
    () =>
      (window as unknown as { modeMeasurement?: unknown }).modeMeasurement !==
      undefined,
  );
  return page.evaluate(
    () =>
      (window as unknown as { modeMeasurement: { durationMs: number } })
        .modeMeasurement.durationMs,
  );
}
// Alternate paired conditions so browser/time drift does not align with history size.
for (const session of [1, 2, 3])
  for (const historicalCount of session === 2 ? [10000, 0] : [0, 10000]) {
    test(`six mode transitions: 500 items, history=${historicalCount}, session=${session} @mode-performance`, async ({
      page,
      browser,
    }, testInfo) => {
      test.setTimeout(240000);
      await page.setViewportSize({ width: 1280, height: 900 });
      await restore(page, 500, false, historicalCount);
      const samples: Array<{
        from: PerformanceMode;
        to: PerformanceMode;
        durationMs: number;
        first: boolean;
      }> = [];
      const cold = await measureModeClick(page, "edit");
      const cycle: PerformanceMode[] = [
        "execute",
        "focus",
        "edit",
        "focus",
        "execute",
        "edit",
      ];
      let from: PerformanceMode = "edit";
      for (let repeat = 0; repeat < 30; repeat++)
        for (const to of cycle) {
          const durationMs = await measureModeClick(page, to);
          samples.push({ from, to, durationMs, first: repeat === 0 });
          from = to;
        }
      await testInfo.attach("mode-response-timings", {
        contentType: "application/json",
        body: Buffer.from(
          JSON.stringify({
            historicalCount,
            session,
            coldExecuteToEditMs: cold,
            measurementOrder: "paired-counterbalanced-v1",
            releaseIdentity: await page.evaluate(async () =>
              (
                await fetch("/release-identity.json", { cache: "no-store" })
              ).json(),
            ),
            browserVersion: browser.version(),
            browserChannel: process.env.PERFORMANCE_BROWSER_CHANNEL,
            headed: process.env.PERFORMANCE_HEADED === "1",
            samples,
          }),
        ),
      });
      expect(samples).toHaveLength(180);
      expect(
        new Set(samples.map((value) => `${value.from}->${value.to}`)).size,
      ).toBe(6);
    });
  }

async function durableExecuteIds(page: Page) {
  return page.evaluate(async (event) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string[]>((resolve, reject) => {
        const store = db
          .transaction("executeModeItems")
          .objectStore("executeModeItems");
        const request = store.get("data");
        request.onsuccess = () => {
          if (request.result?.kind === "event-shopping-planner-day-records") {
            const date = store.get(
              "__esp_internal__:day-record:v1:" +
                JSON.stringify([event, ["1日目"]]),
            );
            date.onsuccess = () => resolve(date.result?.value ?? []);
            date.onerror = () => reject(date.error);
          } else resolve(request.result?.[event]?.["1日目"] ?? []);
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, eventName);
}
for (const decorated of [false, true])
  test(`map insertion markers 1-5 remain selectable, decorated=${decorated} @visit-performance`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => {
      const state = window as unknown as { visitCommandMethods: string[] };
      state.visitCommandMethods = [];
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          const send = this.postMessage.bind(this);
          this.postMessage = (message: { method?: string }) => {
            if (message.method) state.visitCommandMethods.push(message.method);
            send(message);
          };
        }
      };
    });
    await restore(page, 500, false, 10000, decorated, 5, decorated);
    const resetCommandMethods = () =>
      page.evaluate(() => {
        (
          window as unknown as { visitCommandMethods: string[] }
        ).visitCommandMethods = [];
      });
    const commandMethods = () =>
      page.evaluate(
        () =>
          (window as unknown as { visitCommandMethods: string[] })
            .visitCommandMethods,
      );
    await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
    page.setDefaultTimeout(15000);
    const selectWest = async () => {
      if (!decorated) return;
      const selector = page.getByTitle(/^表示ホール:/);
      if ((await selector.getAttribute("title"))?.includes("西")) return;
      await selector.click();
      await page.getByRole("button", { name: /^西\s*\(/ }).click();
    };
    await selectWest();
    const smart = page.locator('button[title^="スマート挿入:"]');
    if ((await smart.getAttribute("title"))!.includes("プレビュー")) {
      await smart.hover();
      await page.mouse.down();
      await expect(smart).toHaveAttribute("title", /マップ/);
      await page.mouse.up();
    }
    if ((await smart.getAttribute("title"))!.includes("無効"))
      await smart.click();
    const map = page.locator("[data-route-pending]");
    await expect(map).toHaveAttribute("data-route-pending", "false", {
      timeout: 60000,
    });
    const canvas = page.locator("canvas").first();
    const clickCell = async (col: number) => {
      const rect = await canvas.boundingBox();
      if (!rect) throw new Error("Missing canvas");
      await page.mouse.click(rect.x + (col - 0.5) * 28, rect.y + 42);
    };
    const samples: unknown[] = [];
    for (let marker = 1; marker <= 5; marker++) {
      await resetCommandMethods();
      await clickCell(12);
      await page.getByText("ユーザー登録5", { exact: true }).click();
      const notice = page
        .getByRole("status")
        .filter({ hasText: "ルート線または番号をクリックしてください" });
      await expect(notice).toBeVisible();
      const noticeBounds = await notice.boundingBox(),
        canvasBounds = await canvas.boundingBox();
      expect(noticeBounds!.y + noticeBounds!.height).toBeLessThanOrEqual(
        canvasBounds!.y + 1,
      );
      await canvas.evaluate((element) =>
        element.addEventListener(
          "click",
          (event) => {
            (window as unknown as { visitStarted: number }).visitStarted =
              event.timeStamp;
          },
          { once: true },
        ),
      );
      await clickCell(marker * 2);
      const screen = (async () => {
        await expect(notice).toBeHidden();
        await expect(map).toHaveAttribute("data-route-item-count", "6");
        return page.evaluate(async () => {
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          return (
            performance.now() -
            (window as unknown as { visitStarted: number }).visitStarted
          );
        });
      })();
      const saved = (async () => {
        await expect
          .poll(() => durableExecuteIds(page), { timeout: 60000 })
          .toContain("perf-5");
        return page.evaluate(
          () =>
            performance.now() -
            (window as unknown as { visitStarted: number }).visitStarted,
        );
      })();
      const route = (async () => {
        await expect(map).toHaveAttribute("data-route-item-count", "6");
        await expect(map).toHaveAttribute("data-route-pending", "false", {
          timeout: 60000,
        });
        return page.evaluate(
          () =>
            performance.now() -
            (window as unknown as { visitStarted: number }).visitStarted,
        );
      })();
      const [screenMs, savedMs, routeMs] = await Promise.all([
        screen,
        saved,
        route,
      ]);
      const addMethods = await commandMethods();
      expect(addMethods).toContain("day");
      expect(addMethods).not.toContain("commit");
      samples.push({
        operation: "add",
        marker,
        screenMs,
        savedMs,
        routeMs,
        commandMethods: addMethods,
      });
      await resetCommandMethods();
      await clickCell(12);
      const remove = page.getByText("ユーザー登録5", { exact: true });
      await remove.evaluate((element) =>
        element.addEventListener(
          "click",
          (event) => {
            (window as unknown as { visitStarted: number }).visitStarted =
              event.timeStamp;
          },
          { once: true },
        ),
      );
      await remove.click();
      const removeScreen = (async () => {
        await expect(map).toHaveAttribute("data-route-item-count", "5");
        return page.evaluate(async () => {
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          return (
            performance.now() -
            (window as unknown as { visitStarted: number }).visitStarted
          );
        });
      })();
      const removeSaved = (async () => {
        await expect
          .poll(() => durableExecuteIds(page), { timeout: 60000 })
          .not.toContain("perf-5");
        return page.evaluate(
          () =>
            performance.now() -
            (window as unknown as { visitStarted: number }).visitStarted,
        );
      })();
      const removeRoute = (async () => {
        await expect(map).toHaveAttribute("data-route-item-count", "5");
        await expect(map).toHaveAttribute("data-route-pending", "false", {
          timeout: 60000,
        });
        return page.evaluate(
          () =>
            performance.now() -
            (window as unknown as { visitStarted: number }).visitStarted,
        );
      })();
      const [removeScreenMs, removeSavedMs, removeRouteMs] = await Promise.all([
        removeScreen,
        removeSaved,
        removeRoute,
      ]);
      const removeMethods = await commandMethods();
      expect(removeMethods).toContain("day");
      expect(removeMethods).not.toContain("commit");
      samples.push({
        commandMethods: removeMethods,
        operation: "remove",
        marker,
        screenMs: removeScreenMs,
        savedMs: removeSavedMs,
        routeMs: removeRouteMs,
      });
      await expect(map).toHaveAttribute("data-route-item-count", "5");
      await expect(map).toHaveAttribute("data-route-pending", "false", {
        timeout: 60000,
      });
      await page.reload();
      await page.getByText(eventName, { exact: true }).click();
      await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
      await selectWest();

      await expect(map).toHaveAttribute("data-route-pending", "false", {
        timeout: 60000,
      });
    }
    await testInfo.attach("visit-response-timings", {
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify({ decorated, multipleHalls: decorated, samples }),
      ),
    });
  });

test("JSON backup keeps input responsive while exporting 10000 historical items @backup-performance", async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  await page.addInitScript(() => {
    const state = window as unknown as {
      backupPayloads: Array<{ snapshot: boolean }>;
    };
    state.backupPayloads = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (String(url).toLowerCase().includes("backup")) {
          const send = this.postMessage.bind(this);
          this.postMessage = (message: { snapshot?: unknown }) => {
            state.backupPayloads.push({
              snapshot: message.snapshot !== undefined,
            });
            send(message);
          };
        }
      }
    };
  });
  await restore(page, 500, false, 10000, true);
  await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  await page.evaluate(() => {
    const state = window as unknown as {
      backupFrameGaps: number[];
      backupLongTasks: number[];
      backupMeasuring: boolean;
    };
    state.backupFrameGaps = [];
    state.backupLongTasks = [];
    state.backupMeasuring = true;
    const observer = new PerformanceObserver((entries) => {
      if (state.backupMeasuring)
        for (const entry of entries.getEntries())
          state.backupLongTasks.push(entry.duration);
    });
    observer.observe({ type: "longtask", buffered: false });
    let previous = performance.now();
    function frame(now: number) {
      state.backupFrameGaps.push(now - previous);
      previous = now;
      if (state.backupMeasuring) requestAnimationFrame(frame);
      else observer.disconnect();
    }
    requestAnimationFrame(frame);
  });
  const download = page.waitForEvent("download");
  const exportButton = page.getByRole("button", {
    name: "JSONバックアップ保存",
    exact: true,
  });
  await exportButton.evaluate((element) =>
    element.addEventListener(
      "click",
      (event) => {
        (window as unknown as { backupStarted: number }).backupStarted =
          event.timeStamp;
      },
      { once: true },
    ),
  );
  await exportButton.click();
  const open = page.getByText(eventName, { exact: true });
  await open.evaluate((element) =>
    element.addEventListener(
      "click",
      (event) => {
        (
          window as unknown as { backupInputStarted: number }
        ).backupInputStarted = event.timeStamp;
      },
      { once: true },
    ),
  );
  await open.click();
  await expect(page.locator('[data-item-id="perf-0"]')).toBeVisible();
  const inputResponseMs = await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return (
      performance.now() -
      (window as unknown as { backupInputStarted: number }).backupInputStarted
    );
  });
  const file = await download;
  const completionMs = await page.evaluate(
    () =>
      performance.now() -
      (window as unknown as { backupStarted: number }).backupStarted,
  );
  const sample = await page.evaluate(() => {
    const state = window as unknown as {
      backupFrameGaps: number[];
      backupLongTasks: number[];
      backupMeasuring: boolean;
      backupPayloads: Array<{ snapshot: boolean }>;
    };
    state.backupMeasuring = false;
    return {
      frameGaps: state.backupFrameGaps,
      longTasks: state.backupLongTasks,
      payloads: state.backupPayloads,
    };
  });
  expect(sample.payloads).toEqual([{ snapshot: false }]);
  expect(inputResponseMs).toBeLessThan(300);
  expect(Math.max(0, ...sample.longTasks)).toBeLessThan(300);
  const path = await file.path();
  expect(path).not.toBeNull();
  const { readFile } = await import("node:fs/promises");
  const backup = JSON.parse(await readFile(path!, "utf8"));
  expect(
    Object.entries(backup.data.eventLists as Record<string, unknown[]>)
      .filter(([name]) => name.startsWith("過去イベント"))
      .reduce((sum, [, items]) => sum + items.length, 0),
  ).toBe(10000);
  expect(backup.data.eventLists[eventName][0].circle).toBe("ユーザー登録0");

  await testInfo.attach("backup-response-timings", {
    contentType: "application/json",
    body: Buffer.from(
      JSON.stringify({ ...sample, inputResponseMs, completionMs }),
    ),
  });
});

for (const concentrated of [false, true]) {
  test(`mode transitions preserve decorated 40000-cell maps and multiple halls, concentrated=${concentrated}`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    page.setDefaultTimeout(15000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await restore(page, 500, concentrated, 10000, true, undefined, true);
    await measureModeClick(page, "edit");
    for (const mode of [
      "execute",
      "focus",
      "edit",
      "focus",
      "execute",
      "edit",
    ] as const)
      await measureModeClick(page, mode);
    await page.reload();
    await page.getByText(eventName, { exact: true }).click();
    await expect(page.getByTitle(modeTitles.edit, { exact: true })).toHaveClass(
      /bg-blue-100/,
    );
    expect(errors).toEqual([]);
  });
}

for (const session of [1, 2, 3])
  test(
    "backup comparison on Windows, session=" + session + " @backup-comparison",
    async ({ page, browser }, testInfo) => {
      test.setTimeout(180000);
      await page.setViewportSize({ width: 1280, height: 900 });
      await restore(page, 500, false, 10000, true);
      const samples: Array<Record<string, unknown>> = [];
      for (const parallel of [false, true]) {
        await page
          .getByRole("button", { name: "イベント一覧", exact: true })
          .click();
        const button = page.getByRole("button", {
          name: "JSONバックアップ保存",
          exact: true,
        });
        const exportBounds = (await button.boundingBox())!;
        const eventBounds = (await page
          .getByText(eventName, { exact: true })
          .boundingBox())!;
        await page.evaluate(() => {
          const state = window as unknown as {
            backupCompare: {
              longTasks: number[];
              frameGaps: number[];
              active: boolean;
              started: number;
              startedEpochMs: number;
            };
          };
          state.backupCompare = {
            longTasks: [],
            frameGaps: [],
            active: true,
            started: 0,
            startedEpochMs: 0,
          };
          const observer = new PerformanceObserver((entries) => {
            for (const entry of entries.getEntries())
              state.backupCompare.longTasks.push(entry.duration);
          });
          observer.observe({ type: "longtask", buffered: false });
          let previous = performance.now();
          function frame(now: number) {
            if (!state.backupCompare.active) {
              observer.disconnect();
              return;
            }
            state.backupCompare.frameGaps.push(now - previous);
            previous = now;
            requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        });
        await button.evaluate((element) =>
          element.addEventListener(
            "click",
            (event) => {
              const state = (
                window as unknown as {
                  backupCompare: { started: number; startedEpochMs: number };
                }
              ).backupCompare;
              state.started = event.timeStamp;
              state.startedEpochMs = Date.now();
            },
            { once: true },
          ),
        );
        let downloadReceivedAt = 0;
        const download = page.waitForEvent("download").then((file) => {
          downloadReceivedAt = Date.now();
          return file;
        });
        const click = page.mouse.click(
          exportBounds.x + exportBounds.width / 2,
          exportBounds.y + exportBounds.height / 2,
        );
        let inputSentAt: number | undefined;
        let inputPaintMs: number | undefined;
        if (parallel) {
          await new Promise((resolve) => setTimeout(resolve, 40));
          inputSentAt = Date.now();
          await page.mouse.click(
            eventBounds.x + eventBounds.width / 2,
            eventBounds.y + eventBounds.height / 2,
          );
          await expect(page.locator('[data-item-id="perf-0"]')).toBeVisible();
          inputPaintMs = await page.evaluate(async (sentAt) => {
            await new Promise(requestAnimationFrame);
            await new Promise(requestAnimationFrame);
            return Date.now() - sentAt;
          }, inputSentAt);
        }
        await click;
        const file = await download;

        const measured = await page.evaluate(async () => {
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          const state = (
            window as unknown as {
              backupCompare: {
                longTasks: number[];
                frameGaps: number[];
                active: boolean;
                started: number;
                startedEpochMs: number;
              };
            }
          ).backupCompare;
          state.active = false;
          return {
            ...state,
            observationDurationMs: performance.now() - state.started,
          };
        });
        const { readFile } = await import("node:fs/promises");
        const exported = JSON.parse(
          await readFile((await file.path())!, "utf8"),
        );
        expect(
          Object.values(
            exported.data.eventLists as Record<string, unknown[]>,
          ).reduce((sum, items) => sum + items.length, 0),
        ).toBe(10500);
        expect(exported.data.eventLists[eventName][0].circle).toBe(
          "ユーザー登録0",
        );
        samples.push({
          parallel,
          ...measured,
          completionMs: downloadReceivedAt - measured.startedEpochMs,
          inputSentAt,
          inputPaintMs,
          downloadReceivedAt,
        });
      }
      const userAgent = await page.evaluate(() => navigator.userAgent);
      await testInfo.attach("backup-comparison-timings", {
        contentType: "application/json",
        body: Buffer.from(
          JSON.stringify({
            session,
            userAgent,
            releaseIdentity: await page.evaluate(async () =>
              (
                await fetch("/release-identity.json", { cache: "no-store" })
              ).json(),
            ),
            browserVersion: browser.version(),
            browserChannel: process.env.PERFORMANCE_BROWSER_CHANNEL,
            headed: process.env.PERFORMANCE_HEADED === "1",
            fixture: "500+10000, decorated40000, 1280x900",
            samples,
          }),
        ),
      });
      if (process.env.PERFORMANCE_COMPARE_BASELINE !== "1") {
        expect(Math.max(0, ...(samples[0].longTasks as number[]))).toBeLessThan(
          100,
        );
        expect(samples[1].inputPaintMs as number).toBeLessThan(300);
      }
    },
  );

test("visit panel reorder, discard, save and long press stay scoped with 10000 historical items @visit-panel-scope", async ({
  page,
}) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    const state = window as unknown as {
      panelCommands: Array<{ method: string; kind?: string; modeDay?: string }>;
    };
    state.panelCommands = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes("persistence.worker")) return;
        const send = this.postMessage.bind(this);
        this.postMessage = (message: {
          method?: string;
          args?: Array<{ kind?: string; modeDay?: string }>;
        }) => {
          if (message.method)
            state.panelCommands.push({
              method: message.method,
              kind: message.args?.[0]?.kind,
              modeDay: message.args?.[0]?.modeDay,
            });
          send(message);
        };
      }
    };
  });
  await restore(page, 500, false, 10000, true, 5, true);
  page.setDefaultTimeout(15000);
  const baseline = Array.from({ length: 5 }, (_, index) => `perf-${index}`);
  const reordered = ["perf-1", "perf-0", ...baseline.slice(2)];
  const resetCommands = () =>
    page.evaluate(() => {
      (window as unknown as { panelCommands: unknown[] }).panelCommands = [];
    });
  const expectVisits = async (modeDay?: string) => {
    const commands = await page.evaluate(
      () =>
        (
          window as unknown as {
            panelCommands: Array<{
              method: string;
              kind?: string;
              modeDay?: string;
            }>;
          }
        ).panelCommands,
    );
    expect(commands).toContainEqual({ method: "day", kind: "visits", modeDay });
    expect(
      commands.some(({ method }) =>
        ["read", "commit", "restore"].includes(method),
      ),
    ).toBe(false);
  };
  const openPanel = async () => {
    await page.getByTitle("リスト表示に切り替え", { exact: true }).hover();
    await page.mouse.down();
    const button = page.getByRole("button", {
      name: "📍 訪問リスト",
      exact: true,
    });
    await expect(button).toBeVisible();
    await page.mouse.up();
    await button.click();
    await expect(page.locator("[data-drag-item]")).toHaveCount(5);
  };
  const reorder = async (expected: string[]) => {
    await resetCommands();
    const rows = page.locator("[data-drag-item]");
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await rows.nth(1).dispatchEvent("dragstart", { dataTransfer: transfer });
    await rows.nth(0).dispatchEvent("dragover", { dataTransfer: transfer });
    await rows.nth(0).dispatchEvent("drop", { dataTransfer: transfer });
    await transfer.dispose();
    await expect
      .poll(() => durableExecuteIds(page), { timeout: 60000 })
      .toEqual(expected);
    await expectVisits();
  };
  const longPress = async (choice: string) => {
    await resetCommands();
    await page.getByRole("button", { name: /^1日目/ }).hover();
    await page.mouse.down();
    await expect(
      page.getByRole("heading", { name: "変更を保存しますか？" }),
    ).toBeVisible();
    await page.mouse.up();
    await page.getByRole("button", { name: choice, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "変更を保存しますか？" }),
    ).toBeHidden();
    await expect(page.locator("[data-drag-item]")).toHaveCount(0);
    await expectVisits("1日目");
  };
  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  await openPanel();
  await reorder(reordered);
  await resetCommands();
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect.poll(() => durableExecuteIds(page)).toEqual(baseline);
  await expectVisits();
  await reorder(reordered);

  await resetCommands();
  await page.getByRole("button", { name: "確定", exact: true }).click();
  await expect(
    page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }),
  ).toBeDisabled();
  await expectVisits();
  await reorder(baseline);
  await longPress("保存して確定");
  await expect.poll(() => durableExecuteIds(page)).toEqual(baseline);
  // Return to the day list to select execute mode before reopening the map.
  await page.getByTitle("リスト表示に切り替え", { exact: true }).click();
  const execute = page.getByTitle("実行モード", { exact: true });
  await execute.click();
  await expect(execute).toHaveClass(/bg-green-100/);
  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  await openPanel();
  await reorder(reordered);
  await longPress("キャンセル（破棄）");
  await expect.poll(() => durableExecuteIds(page)).toEqual(baseline);
  await page.reload();
  await page.getByText(eventName, { exact: true }).click();
  await expect(page.locator('[data-item-id="perf-0"]')).toBeVisible();
  expect(await durableExecuteIds(page)).toEqual(baseline);
});
