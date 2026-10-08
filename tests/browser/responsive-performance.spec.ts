import { expect, test, type Page } from "@playwright/test";
const eventName = "応答速度検証";
const makeBackup = (count: number, concentrated = false) => {
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
    Array.from({ length: 10 }, (_, event) => [
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
        backgroundColor: null,
        borders: { top: null, right: null, bottom: null, left: null },
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
async function restore(page: Page, count: number, concentrated = false) {
  await page.goto("/");
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "performance.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify(makeBackup(count, concentrated)),
        "utf8",
      ),
    });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog.getByRole("button", { name: "置換して復元" }).click();
  await expect(dialog).toBeHidden({ timeout: 60000 });
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
for (const count of [150, 500, 1500])
  for (const concentrated of [false, true]) {
    test(`local shopping operations: ${count} items, concentrated=${concentrated}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(240000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await restore(page, count, concentrated);
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
        focus: [],
        record: [],
        next: [],
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
        await page
          .locator(`[data-row-key='item:"${id}"']`)
          .scrollIntoViewIfNeeded();
        await expect(page.locator(`[data-item-id="${id}"]`)).toBeVisible();
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
        await page
          .locator(`[data-row-key='item:"perf-${index}"']`)
          .scrollIntoViewIfNeeded();
        await expect(row).toBeVisible();
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
      await page.getByTitle("集中モード", { exact: true }).click();
      if (!concentrated)
        for (let index = 0; index < 20; index++)
          await page.getByTitle("次の訪問先", { exact: true }).click();
      if (count === 1500)
        await page.getByTitle("マップを表示", { exact: true }).click();
      await diagnostics("reset");
      for (let index = 20; index < 40; index++) {
        const row = page.locator(`[data-item-id="perf-${index}"]`);
        if (concentrated)
          await page
            .locator(`[data-row-key="focus:perf-${index}"]`)
            .scrollIntoViewIfNeeded();
        await expect(row).toBeVisible();
        await clickResponse(
          row,
          'button[aria-label^="Current status:"]',
          "focus",
        );
        if (!concentrated)
          await clickResponse(
            page.locator('[title="次の訪問先"]').locator(".."),
            'button[title="次の訪問先"]',
            "next",
          );
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
      await clickResponse(
        dialog.getByRole("button", { name: "記録", exact: true }),
        "button",
        "record",
      );
      await clickResponse(
        page.locator('[title="次の訪問先"]').locator(".."),
        'button[title="次の訪問先"]',
        "next",
      );
      await expect(dialog).toBeHidden();
      await expect
        .poll(async () => (await durableItem(page, target)).remarks, {
          timeout: 60000,
        })
        .toContain("通販･頒布確認");
      await expect
        .poll(async () => (await durableItem(page, target)).purchaseStatus)
        .toBe("SoldOut");
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
            mapVisible: count === 1500,
            visitedCount,
            timings,
            summary,
            diagnostic,
            executionDiagnostic,
            errors,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
      expect(errors).toEqual([]);
    });
  }
