import { readFile, writeFile } from "node:fs/promises";
import { parseCsvRecords } from "../../src/utils/csvRecords";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import {
  sheetCsv,
  sheetSnapshot,
  SHEET_EVENT,
} from "../../src/test/sheetImportOptionalUrlFixtures";
import {
  prepareMetadataForPayload,
  createNextPersistenceCheckpoint,
  type StoredPersistenceMetadata,
} from "../../src/persistence/internal/persistenceCore";
import {
  createPersistenceMetadataKey,
  createPersistenceCheckpointKey,
  type PersistenceCheckpoint,
} from "../../src/utils/persistenceResilience";

const phase = process.env.SHEET_URL_BROWSER_PHASE;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";
const fixedInputs = process.env.SHEET_URL_FIXED_INPUT_DIR;
const repeats = 20;
async function stored(
  page: Page,
  name: string,
  key = "data",
): Promise<unknown> {
  return page.evaluate(
    async ({ name, key }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("EventShoppingPlannerDB");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<unknown>((resolve, reject) => {
          const request = database.transaction(name).objectStore(name).get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        database.close();
      }
    },
    { name, key },
  );
}
async function enter(page: Page) {
  await page.goto(baseURL);
  await expect(
    page.getByRole("button", { name: "新規リスト作成", exact: true }),
  ).toBeVisible();
  // Persistence selected its direct adapter at composition time. Other workers
  // remain available for the production XLSX and JSON codecs.
  await page.evaluate(() => {
    const state = window as unknown as {
      Worker: typeof Worker;
      __sheetOriginalWorker?: typeof Worker;
    };
    if (state.__sheetOriginalWorker) state.Worker = state.__sheetOriginalWorker;
  });
}
async function restore(
  page: Page,
  count: number,
  source: boolean,
  bytes?: Buffer,
  withUrl = false,
) {
  const data = sheetSnapshot(count);
  if (withUrl)
    for (const item of data.eventLists[SHEET_EVENT])
      item.url = "https://baseline.test";
  if (source)
    data.eventMetadata[SHEET_EVENT] = {
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/original/edit",
      spreadsheetSheetName: "品目表",
      lastImportDate: "",
    };
  const input = bytes
    ? page.getByLabel("Excelファイルを選択")
    : page.getByLabel("バックアップファイルを選択");
  const start = performance.now();
  await input.setInputFiles({
    name: bytes ? "fixture.xlsx" : "fixture.json",
    mimeType: bytes
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/json",
    buffer:
      bytes ??
      Buffer.from(
        JSON.stringify({
          kind: "event-shopping-planner-backup",
          version: 2,
          exportedAt: "2026-10-17T00:00:00.000Z",
          data,
        }),
      ),
  });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await expect(dialog).toBeVisible();
  const parseMs = performance.now() - start;
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  const commitStart = performance.now();
  await dialog
    .getByRole("button", { name: "置換して復元", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: `「${SHEET_EVENT}」の復元内容を確認`,
    exact: true,
  });
  await expect
    .poll(
      async () =>
        (await review.isVisible()) ||
        (await page
          .getByRole("heading", { name: SHEET_EVENT, exact: true })
          .isVisible()),
    )
    .toBe(true);
  if (await review.isVisible())
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: SHEET_EVENT, exact: true }),
  ).toBeVisible();
  return { parseMs, saveMs: performance.now() - commitStart };
}
async function legacyUrls(page: Page) {
  const lists = (await stored(page, "eventLists")) as Record<string, object[]>;
  const next = {
    ...lists,
    [SHEET_EVENT]: lists[SHEET_EVENT].map((item) => ({ ...item, url: "" })),
  };
  const metadataKey = createPersistenceMetadataKey("eventLists", "data");
  const checkpointKey = createPersistenceCheckpointKey("eventLists", "data");
  const previous = (await stored(
    page,
    "syncQueue",
    metadataKey,
  )) as StoredPersistenceMetadata;
  const previousCheckpoint = (await stored(
    page,
    "syncQueue",
    checkpointKey,
  )) as PersistenceCheckpoint | null;
  const metadata = await prepareMetadataForPayload(
    "eventLists",
    "data",
    next,
    previous.revision,
  );
  const checkpoint = createNextPersistenceCheckpoint(
    "eventLists",
    "data",
    metadata,
    previousCheckpoint,
  );
  await page.evaluate(
    async ({ next, metadata, checkpoint, metadataKey, checkpointKey }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("EventShoppingPlannerDB");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = database.transaction(
            ["eventLists", "syncQueue"],
            "readwrite",
          );
          tx.objectStore("eventLists").put(next, "data");
          tx.objectStore("syncQueue").put(metadata, metadataKey);
          tx.objectStore("syncQueue").put(checkpoint, checkpointKey);
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        database.close();
      }
    },
    { next, metadata, checkpoint, metadataKey, checkpointKey },
  );
}
async function openEditor(page: Page) {
  const card = page
    .locator('[data-item-id="item-0"]')
    .first()
    .locator(":scope > div.rounded-lg")
    .first();
  await card.dispatchEvent("pointerdown", {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
  });
  await expect(
    page.getByRole("button", { name: "編集", exact: true }),
  ).toBeVisible();
  await card.dispatchEvent("pointerup", {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
  });
  await page.getByRole("button", { name: "編集", exact: true }).click();
  return page.getByRole("dialog", { name: "アイテム編集", exact: true });
}
async function abortOnce(page: Page, mode: string) {
  const inject = () => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<typeof original>
    ) {
      if (
        this.transaction.mode === "readwrite" &&
        this.transaction.objectStoreNames.contains("eventConsistency")
      ) {
        IDBObjectStore.prototype.put = original;
        throw new DOMException("measurement abort", "AbortError");
      }
      return original.apply(this, args);
    };
  };
  if (mode === "worker") {
    const worker = page
      .workers()
      .find((worker) => worker.url().includes("persistence.worker"));
    if (!worker) throw new Error("Missing production persistence worker");
    await worker.evaluate(inject);
  } else await page.evaluate(inject);
}

test.describe("sheet optional URL real-browser route measurements", () => {
  test.skip(!phase, "Opt in with SHEET_URL_BROWSER_PHASE=before or after");
  for (const count of [150, 500])
    for (const mode of ["direct", "worker"])
      for (const route of [
        "import",
        "update",
        "switch",
        "restore-json",
        "restore-xlsx",
        "startup-B01",
        "startup-B04",
        "retry",
      ] as const) {
        test(`${route}: ${count} ${mode} @sheet-url-routes`, async ({
          browser,
        }, testInfo) => {
          test.setTimeout(240000);
          const samples: Array<Record<string, unknown>> = [];
          for (let iteration = 0; iteration < repeats; iteration++) {
            const context: BrowserContext = await browser.newContext({
              viewport: { width: 1280, height: 720 },
              serviceWorkers: "block",
            });
            if (mode === "direct")
              await context.addInitScript(() => {
                const state = window as unknown as {
                  Worker: typeof Worker | undefined;
                  __sheetOriginalWorker?: typeof Worker;
                };
                state.__sheetOriginalWorker = state.Worker;
                state.Worker = undefined;
              });
            const page = await context.newPage();
            page.on("dialog", (dialog) => dialog.accept());
            try {
              await enter(page);
              let detail: Record<string, unknown>;
              if (route === "import") {
                await page.route("**/api/google-sheets-csv", (request) =>
                  request.fulfill({
                    status: 200,
                    contentType: "text/csv; charset=utf-8",
                    body: sheetCsv(count),
                  }),
                );
                await page
                  .getByRole("button", { name: "新規リスト作成", exact: true })
                  .click();
                await page
                  .getByLabel("即売会名", { exact: true })
                  .fill(SHEET_EVENT);
                await page
                  .getByLabel("スプレッドシートURLからインポート", {
                    exact: true,
                  })
                  .fill("https://docs.google.com/spreadsheets/d/test/edit");
                const start = performance.now();
                await page
                  .getByRole("button", {
                    name: "URLからインポート",
                    exact: true,
                  })
                  .click();
                const review = page.getByRole("dialog", {
                  name: "所属・配置の変更を確認",
                  exact: true,
                });
                await expect(review).toBeVisible();
                const reviewMs = performance.now() - start;
                const commitStart = performance.now();
                await review
                  .getByRole("button", { name: "確認して保存", exact: true })
                  .click();
                await expect(review).toBeHidden();
                await expect(
                  page.getByRole("heading", { name: SHEET_EVENT, exact: true }),
                ).toBeVisible();
                const saveMs = performance.now() - commitStart;
                detail = { reviewMs, saveMs, durationMs: reviewMs + saveMs };
              } else if (route === "update" || route === "switch") {
                await restore(page, count, route === "update", undefined, true);
                const csv = parseCsvRecords(sheetCsv(count))
                  .records.map((record, index) => {
                    const cells = [...record.cells];
                    if (index > 0) cells[24] = "https://baseline.test";
                    return cells
                      .map((cell) => `"${cell.replace(/"/g, '""')}"`)
                      .join(",");
                  })
                  .join("\n")
                  .replace(/"500"/g, '"501"');
                await page.route("**/api/google-sheets-csv", (request) =>
                  request.fulfill({
                    status: 200,
                    contentType: "text/csv; charset=utf-8",
                    body: csv,
                  }),
                );
                await page
                  .getByRole("button", { name: "イベント一覧", exact: true })
                  .click();
                await page
                  .getByRole("button", { name: "メニュー", exact: true })
                  .click();
                let start = performance.now();
                await page
                  .getByRole("button", { name: "🔄 アイテム更新", exact: true })
                  .click();
                if (route === "switch") {
                  await page
                    .getByRole("textbox", {
                      name: "スプレッドシートURL",
                      exact: true,
                    })
                    .fill("https://docs.google.com/spreadsheets/d/new/edit");
                  start = performance.now();
                  await page
                    .getByRole("button", { name: "更新", exact: true })
                    .click();
                }
                const heading = page.getByRole("heading", {
                  name: "アイテム更新の確認",
                  exact: true,
                });
                await expect(heading).toBeVisible();
                const reviewMs = performance.now() - start;
                const commitStart = performance.now();
                await page
                  .getByRole("button", {
                    name:
                      route === "switch"
                        ? "更新元を切り替えて更新"
                        : "更新を実行",
                    exact: true,
                  })
                  .click();
                await expect(heading).toBeHidden();
                detail = { reviewMs, saveMs: performance.now() - commitStart };
                expect(
                  (
                    (await stored(page, "eventLists")) as Record<
                      string,
                      Array<{ catalogPrice: number }>
                    >
                  )[SHEET_EVENT][0].catalogPrice,
                ).toBe(501);
              } else if (route.startsWith("restore")) {
                const bytes =
                  route === "restore-xlsx"
                    ? await readFile(
                        join(
                          fixedInputs!,
                          `restore-${count}-${mode}-blank=true.xlsx`,
                        ),
                      )
                    : undefined;
                detail = await restore(page, count, false, bytes);
              } else if (route.startsWith("startup")) {
                await restore(page, count, false);
                if (route === "startup-B04") await legacyUrls(page);
                const start = performance.now();
                await page.reload();
                await expect(
                  page.getByRole("listitem").filter({ hasText: SHEET_EVENT }),
                ).toBeVisible();
                detail = { durationMs: performance.now() - start };
                if (phase === "after")
                  expect(
                    (
                      (await stored(page, "eventLists")) as Record<
                        string,
                        object[]
                      >
                    )[SHEET_EVENT].every(
                      (item) =>
                        !Object.prototype.hasOwnProperty.call(item, "url"),
                    ),
                  ).toBe(true);
              } else {
                await restore(page, count, false, undefined, true);
                const editor = await openEditor(page);
                await editor
                  .getByRole("textbox", { name: "購入金額", exact: true })
                  .fill("900");
                await editor
                  .getByRole("textbox", { name: "利用者メモ", exact: true })
                  .fill("再試行を確認");
                await abortOnce(page, mode);
                await editor
                  .getByRole("button", { name: "保存", exact: true })
                  .click();
                const retained = page
                  .getByRole("alert")
                  .filter({ hasText: "件の操作を未保存のまま保留しています" });
                await expect(retained).toBeVisible();
                const start = performance.now();
                await retained
                  .getByRole("button", {
                    name: "保留中の保存を再試行",
                    exact: true,
                  })
                  .click();
                await expect(retained).toBeHidden();
                await expect(editor).toBeHidden();
                detail = { durationMs: performance.now() - start };
              }
              samples.push({ phase, count, mode, route, iteration, ...detail });
            } finally {
              await context.close();
            }
          }
          await writeFile(
            testInfo.outputPath("sheet-url-route-timings.json"),
            JSON.stringify(samples, null, 2),
            "utf8",
          );
          expect(samples).toHaveLength(20);
        });
      }
});
