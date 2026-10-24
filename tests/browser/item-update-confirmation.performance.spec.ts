import { readBrowserEventLists } from "./shopping-transfer-persisted-store";
import { expect, test, type Page } from "@playwright/test";
import { summarizePerformanceSamples } from "./performance-summary";
import {
  sheetSnapshot,
  SHEET_EVENT,
} from "../../src/test/sheetImportOptionalUrlFixtures";
import type { ShoppingItem } from "../../src/types/item";
import {
  DAY_RECORD_PREFIX,
  decodeDayRecords,
  hasDayRecordHead,
} from "../../src/persistence/db/dayRecordStorage";

const requestedPhase = process.env.ITEM_UPDATE_BROWSER_PHASE;
const phase = requestedPhase ?? "current";
test.skip(
  !requestedPhase,
  "Set ITEM_UPDATE_BROWSER_PHASE=baseline or current to collect update timings.",
);
const repeats = Number(process.env.ITEM_UPDATE_BROWSER_REPEATS ?? "20");
const fetchDelayMs = Number(process.env.ITEM_UPDATE_FETCH_DELAY_MS ?? "40");
if (!["baseline", "current"].includes(phase))
  throw new Error("ITEM_UPDATE_BROWSER_PHASE must be baseline or current");
if (!Number.isSafeInteger(repeats) || repeats < 20)
  throw new Error("ITEM_UPDATE_BROWSER_REPEATS must be at least 20");
if (!Number.isFinite(fetchDelayMs) || fetchDelayMs < 0)
  throw new Error("ITEM_UPDATE_FETCH_DELAY_MS must be nonnegative");

type Scenario = "normal" | "collision-title" | "duplicates";
type TransactionTiming = {
  startedAt: number;
  finishedAt?: number;
  eventListWrites: number;
  outcome?: "complete" | "abort";
  stores: string[];
  realm: "main" | "worker";
};
type Probe = {
  marks: Record<string, number>;
  checkboxCheckedAtPaint?: boolean;
  transactions: TransactionTiming[];
};
type ProbeGlobal = typeof globalThis & { __itemUpdateTiming?: Probe };
const source = {
  url: "https://docs.google.com/spreadsheets/d/update-timing/edit#gid=2",
  sheetName: "",
};

function fixture(count: number, scenario: Scenario) {
  const data = sheetSnapshot(count);
  const items = data.eventLists[SHEET_EVENT];
  for (const [index, item] of items.entries()) {
    const a = index % 2 === 0;
    item.circle =
      scenario === "collision-title"
        ? `サークル${Math.floor(index / 2)}${a ? " " : ""}`
        : `サークル${index}`;
    item.number = String(
      scenario === "collision-title" ? Math.floor(index / 2) : index,
    );
    item.title =
      scenario === "collision-title" ? (a ? "旧A" : "旧B") : `新刊${index}`;
    item.catalogPrice = a ? 500 : 700;
    item.price = 900 + index;
    item.remarks = `利用者メモ${index}`;
    item.sheetRemarks = "シート備考";
    item.purchaseStatus = a ? "Purchased" : "LimitedPurchase";
    if (!a) item.limitedPurchasedQuantity = 1;
  }
  const entry = scenario === "normal" ? "items-only" : "source-switch";
  if (entry === "items-only")
    data.eventMetadata[SHEET_EVENT] = {
      spreadsheetUrl: source.url,
      spreadsheetSheetName: source.sheetName,
      lastImportDate: "",
    };
  const incoming = items.map((item, index) => ({
    ...item,
    circle: item.circle.trim(),
    title:
      scenario === "collision-title"
        ? index % 2 === 0
          ? "旧A"
          : "新A"
        : item.title,
    catalogPrice:
      scenario === "collision-title"
        ? index % 2 === 0
          ? 700
          : 500
        : item.catalogPrice,
    quantity: scenario === "collision-title" && index % 2 !== 0 ? 4 : 3,
  }));
  const rows =
    scenario === "duplicates"
      ? incoming.flatMap((item) => [item, { ...item }])
      : incoming;
  const header = Array<string>(27).fill("");
  ["サークル名", "参加日", "ブロック", "番号"].forEach((value, index) => {
    header[12 + index] = value;
  });
  const csvRows = rows.map((item) => {
    const cells = Array<string>(27).fill("");
    [
      item.circle,
      item.eventDate,
      item.block,
      item.number,
      item.title,
      String(item.catalogPrice),
    ].forEach((value, index) => {
      cells[12 + index] = value;
    });
    cells[22] = item.sheetRemarks!;
    cells[26] = String(item.quantity);
    return cells;
  });
  const csv = [header, ...csvRows]
    .map((row) =>
      row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","),
    )
    .join("\n");
  return { data, csv, entry };
}

// This function is serialized into both the document and production persistence
// worker. Epoch marks allow worker durability to be compared with document input.
function installProbe() {
  const state = globalThis as ProbeGlobal;
  if (state.__itemUpdateTiming) return;
  const probe: Probe = { marks: {}, transactions: [] };
  state.__itemUpdateTiming = probe;
  const now = () => performance.timeOrigin + performance.now();
  const transactions = new WeakMap<IDBTransaction, TransactionTiming>();
  const originalTransaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) {
    const transaction = originalTransaction.apply(this, args);
    if (
      this.name !== "EventShoppingPlannerDB" ||
      transaction.mode !== "readwrite"
    )
      return transaction;
    const timing: TransactionTiming = {
      startedAt: now(),
      eventListWrites: 0,
      stores: Array.from(transaction.objectStoreNames),
      realm: typeof document === "undefined" ? "worker" : "main",
    };
    transactions.set(transaction, timing);
    probe.transactions.push(timing);
    for (const outcome of ["complete", "abort"] as const)
      transaction.addEventListener(
        outcome,
        () => {
          timing.finishedAt = now();
          timing.outcome = outcome;
        },
        { once: true },
      );
    return transaction;
  } as typeof originalTransaction;
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const transaction = transactions.get(this.transaction);
    if (transaction && this.name === "eventLists")
      transaction.eventListWrites++;
    return originalPut.apply(this, args);
  };
  if (typeof document === "undefined") return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (...args) => {
    const request = args[0];
    const url =
      typeof request === "string"
        ? request
        : request instanceof URL
          ? request.href
          : request.url;
    if (url.includes("/api/google-sheets-csv"))
      probe.marks.fetchStartedAt = now();
    return originalFetch(...args);
  };
  const originalText = Response.prototype.text;
  Response.prototype.text = async function (...args) {
    const text = await originalText.apply(this, args);
    if (this.url.includes("/api/google-sheets-csv"))
      probe.marks.csvTextReadyAt = now();
    return text;
  };
  const afterPaintOpportunity = (callback: () => void) =>
    requestAnimationFrame(() => requestAnimationFrame(callback));
  const updateVisible = () =>
    Array.from(document.querySelectorAll("h2")).some(
      (heading) => heading.textContent?.trim() === "アイテム更新の確認",
    );
  new MutationObserver(() => {
    const visible = updateVisible();
    if (visible && probe.marks.csvTextReadyAt && !probe.marks.reviewDomAt) {
      probe.marks.reviewDomAt = now();
      afterPaintOpportunity(() => {
        probe.marks.reviewPaintAt = now();
      });
    }
    if (
      !visible &&
      probe.marks.saveClickedAt &&
      !probe.marks.savedScreenDomAt
    ) {
      probe.marks.savedScreenDomAt = now();
      afterPaintOpportunity(() => {
        probe.marks.savedScreenPaintAt = now();
      });
    }
  }).observe(document, { childList: true, subtree: true });
  document.addEventListener(
    "click",
    (event) => {
      if (!updateVisible()) return;
      const target = event.target as Element;
      const checkbox = target.closest<HTMLInputElement>(
        'input[type="checkbox"]',
      );
      if (checkbox) {
        probe.marks.checkboxClickedAt = now();
        afterPaintOpportunity(() => {
          probe.checkboxCheckedAtPaint = checkbox.checked;
          probe.marks.checkboxPaintAt = now();
        });
      }
      const label = target.closest("button")?.textContent?.trim();
      if (label === "更新を実行" || label === "更新元を切り替えて更新")
        probe.marks.saveClickedAt = now();
    },
    true,
  );
}

async function stored(page: Page) {
  const raw = await page.evaluate(async (prefix) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const read = (name: string) =>
        new Promise<{
          payload: unknown;
          entries?: Array<[string, unknown]>;
        }>((resolve, reject) => {
          const store = database.transaction(name).objectStore(name);
          const request = store.get("data");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const payload = request.result;
            if (payload?.kind !== "event-shopping-planner-day-records") {
              resolve({ payload });
              return;
            }
            // Enqueue within the get callback, while its transaction is active.
            const entries: Array<[string, unknown]> = [];
            const cursor = store.openCursor(
              IDBKeyRange.bound(prefix, prefix + "\uffff"),
            );
            cursor.onerror = () => reject(cursor.error);
            cursor.onsuccess = () => {
              const row = cursor.result;
              if (!row) {
                resolve({ payload, entries });
                return;
              }
              entries.push([String(row.key), row.value]);
              row.continue();
            };
          };
        });
      const [lists, metadata, execute] = await Promise.all([
        read("eventLists"),
        read("eventMetadata"),
        read("executeModeItems"),
      ]);
      return { lists, metadata, execute };
    } finally {
      database.close();
    }
  }, DAY_RECORD_PREFIX);
  // executeModeItems/data is a manifest, unlike the eventLists/metadata payloads.
  // Reuse the production decoder for its hashes, parent index and day branches.
  // This verification happens after timing marks and never enters the save path.
  const execute = hasDayRecordHead(raw.execute.payload)
    ? (
        await decodeDayRecords(
          "executeModeItems",
          raw.execute.payload,
          new Map(raw.execute.entries),
        )
      ).data
    : (raw.execute.payload as Record<string, unknown>);
  return {
    items: (
      await readBrowserEventLists<ShoppingItem & Record<string, unknown>>(page)
    )[SHEET_EVENT],
    metadata: (raw.metadata.payload as Record<string, unknown>)[SHEET_EVENT],
    execute: execute[SHEET_EVENT] as Record<string, string[]>,
  };
}

async function restore(page: Page, data: ReturnType<typeof fixture>["data"]) {
  await page.goto("/");
  await page.getByLabel("バックアップファイルを選択").setInputFiles({
    name: "item-update-timing.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        kind: "event-shopping-planner-backup",
        version: 2,
        exportedAt: "2026-10-18T00:00:00.000Z",
        data,
      }),
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
    name: `「${SHEET_EVENT}」の復元内容を確認`,
    exact: true,
  });
  const heading = page.getByRole("heading", { name: SHEET_EVENT, exact: true });
  await expect
    .poll(async () => (await review.isVisible()) || (await heading.isVisible()))
    .toBe(true);
  if (await review.isVisible())
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
  await expect(dialog).toBeHidden();
  await expect(heading).toBeVisible();
  const restored = await stored(page);
  expect(restored.items).toEqual(data.eventLists[SHEET_EVENT]);
  expect(restored.execute).toEqual(data.executeModeItems[SHEET_EVENT]);
  expect(restored.metadata).toEqual(data.eventMetadata[SHEET_EVENT]);
}

async function resetAndPrepareProbe(page: Page) {
  const reset = () => {
    const probe = (globalThis as ProbeGlobal).__itemUpdateTiming;
    if (probe) {
      probe.marks = {};
      probe.transactions = [];
      delete probe.checkboxCheckedAtPaint;
    }
  };
  await page.evaluate(reset);
  for (const worker of page.workers()) {
    if (!worker.url().includes("persistence.worker")) continue;
    await worker.evaluate(installProbe);
    await worker.evaluate(reset);
  }
}

for (const count of [150, 500])
  for (const scenario of ["normal", "collision-title", "duplicates"] as const) {
    test(`${count} ${scenario}: update phases remain separate @item-update-performance`, async ({
      browser,
    }, testInfo) => {
      test.setTimeout(600_000);
      const input = fixture(count, scenario);
      const samples: Array<Record<string, unknown>> = [];
      for (let iteration = 0; iteration < repeats; iteration++) {
        // A fresh profile and the same backup reset persistence and all app state;
        // an earlier sample's title/quantity changes never become the next baseline.
        const context = await browser.newContext({
          baseURL: testInfo.project.use.baseURL,
          viewport: { width: 1280, height: 900 },
          serviceWorkers: "block",
        });
        const page = await context.newPage();
        const runtimeErrors: string[] = [];
        page.on("pageerror", (error) => runtimeErrors.push(error.message));
        page.on("dialog", (dialog) => dialog.accept());
        await page.addInitScript(installProbe);
        await page.route("**/api/google-sheets-csv", async (route) => {
          await new Promise((resolve) => setTimeout(resolve, fetchDelayMs));
          await route.fulfill({
            status: 200,
            contentType: "text/csv; charset=utf-8",
            body: input.csv,
          });
        });
        try {
          await restore(page, input.data);
          await page
            .getByRole("button", { name: "イベント一覧", exact: true })
            .click();
          await page
            .getByRole("button", { name: "メニュー", exact: true })
            .click();
          await resetAndPrepareProbe(page);
          await page
            .getByRole("button", { name: "🔄 アイテム更新", exact: true })
            .click();
          if (input.entry === "source-switch") {
            await page
              .getByRole("textbox", {
                name: "スプレッドシートURL",
                exact: true,
              })
              .fill(source.url);
            await page
              .getByRole("button", { name: "更新", exact: true })
              .click();
          }
          const heading = page.getByRole("heading", {
            name: "アイテム更新の確認",
            exact: true,
          });
          await expect(heading).toBeVisible();
          await page.waitForFunction(
            () =>
              !!(globalThis as ProbeGlobal).__itemUpdateTiming?.marks
                .reviewPaintAt,
          );
          const reviewText = await heading.locator("..").innerText();
          const reviewCounts = {
            added: Number(reviewText.match(/追加:\s*(\d+)件/)?.[1] ?? 0),
            deleted: Number(reviewText.match(/削除:\s*(\d+)件/)?.[1] ?? 0),
            duplicateAdditionsSkipped: Number(
              reviewText.match(/完全重複による追加除外:\s*(\d+)行/)?.[1] ?? 0,
            ),
          };
          if (phase === "current") {
            expect(reviewCounts.added).toBe(0);
            expect(reviewCounts.deleted).toBe(0);
            expect(reviewCounts.duplicateAdditionsSkipped).toBe(
              scenario === "duplicates" ? count : 0,
            );
          }
          const checkbox = page.getByRole("checkbox", {
            name: "内容を確認し、スプレッドシートの予定数量へ変更する",
            exact: true,
          });
          await expect(checkbox).not.toBeChecked();
          await checkbox.check();
          await page.waitForFunction(
            () =>
              !!(globalThis as ProbeGlobal).__itemUpdateTiming?.marks
                .checkboxPaintAt,
          );
          await page
            .getByRole("button", {
              name:
                input.entry === "source-switch"
                  ? "更新元を切り替えて更新"
                  : "更新を実行",
              exact: true,
            })
            .click();
          await expect(heading).toBeHidden();
          await page.waitForFunction(
            () =>
              !!(globalThis as ProbeGlobal).__itemUpdateTiming?.marks
                .savedScreenPaintAt,
          );
          const saved = await stored(page);
          const readProbe = () =>
            (globalThis as ProbeGlobal).__itemUpdateTiming!;
          const main = await page.evaluate(readProbe);
          const transactions = [...main.transactions];
          for (const worker of page.workers())
            if (worker.url().includes("persistence.worker"))
              transactions.push(
                ...(await worker.evaluate(readProbe)).transactions,
              );
          const { marks } = main;
          const saves = transactions.filter(
            (transaction) =>
              transaction.startedAt >= marks.saveClickedAt &&
              transaction.eventListWrites > 0 &&
              transaction.outcome === "complete" &&
              transaction.stores.includes("eventConsistency"),
          );
          expect(saves.length).toBeGreaterThan(0);
          expect(main.checkboxCheckedAtPaint).toBe(true);
          const durableAt = Math.max(
            ...saves.map((transaction) => transaction.finishedAt!),
          );
          if (phase === "current") {
            expect(saved.items.map((item) => item.id)).toEqual(
              input.data.eventLists[SHEET_EVENT].map((item) => item.id),
            );
            for (const [index, item] of saved.items.entries()) {
              const original = input.data.eventLists[SHEET_EVENT][index];
              expect(item).toMatchObject({
                id: original.id,
                circle: original.circle,
                purchaseStatus: original.purchaseStatus,
                quantity:
                  scenario === "collision-title" && index % 2 === 0 ? 4 : 3,
                price: original.price,
                remarks: original.remarks,
                title:
                  scenario === "collision-title"
                    ? index % 2 === 0
                      ? "新A"
                      : "旧A"
                    : original.title,
              });
              expect(item.limitedPurchasedQuantity).toBe(
                original.limitedPurchasedQuantity,
              );
            }
            expect(saved.execute).toEqual(
              input.data.executeModeItems[SHEET_EVENT],
            );
            expect(saved.metadata).toMatchObject({
              spreadsheetUrl: source.url,
              spreadsheetSheetName: source.sheetName,
            });
          }
          const originalIds = new Set(
            input.data.eventLists[SHEET_EVENT].map((item) => item.id),
          );
          const savedIds = new Set(saved.items.map((item) => item.id));
          const outcome = {
            initialCount: count,
            savedCount: saved.items.length,
            retainedOriginalIds: [...originalIds].filter((id) =>
              savedIds.has(id),
            ).length,
            removedOriginalIds: [...originalIds].filter(
              (id) => !savedIds.has(id),
            ),
            addedIdsCount: [...savedIds].filter((id) => !originalIds.has(id))
              .length,
            metadata: saved.metadata,
            executeIds: saved.execute,
            sampleItems: saved.items.slice(0, 5),
          };
          const timings = {
            controlledFetchWaitMs: marks.csvTextReadyAt - marks.fetchStartedAt,
            responseTextToConfirmationDomMs:
              marks.reviewDomAt - marks.csvTextReadyAt,
            responseTextToConfirmationPaintMs:
              marks.reviewPaintAt - marks.csvTextReadyAt,
            checkboxReactionMs: marks.checkboxPaintAt - marks.checkboxClickedAt,
            saveDurabilityMs: durableAt - marks.saveClickedAt,
            saveScreenPaintMs: marks.savedScreenPaintAt - marks.saveClickedAt,
          };
          for (const value of Object.values(timings)) {
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
          }
          await page.reload();
          await expect(
            page.getByText(SHEET_EVENT, { exact: true }),
          ).toBeVisible();
          expect(await stored(page)).toEqual(saved);
          expect(runtimeErrors).toEqual([]);
          samples.push({
            iteration,
            timings,
            reviewCounts,
            outcome,
            reloadVerified: true,
            transactions: saves,
            runtimeErrors,
          });
        } finally {
          await context.close();
        }
      }
      const timingNames = Object.keys(
        samples[0].timings as Record<string, number>,
      );
      const summary = Object.fromEntries(
        timingNames.map((name) => {
          const values = samples.map(
            (sample) => (sample.timings as Record<string, number>)[name],
          );
          const {
            count: sampleCount,
            medianMs,
            p95Ms,
          } = summarizePerformanceSamples(values);
          return [name, { sampleCount, medianMs, p95Ms }];
        }),
      );
      await testInfo.attach("item-update-phase-timings", {
        contentType: "application/json",
        body: Buffer.from(
          JSON.stringify(
            {
              phase,
              count,
              scenario,
              entry: input.entry,
              samplesPerCondition: repeats,
              fetchDelayMs,
              browserVersion: browser.version(),
              browserChannel: process.env.PERFORMANCE_BROWSER_CHANNEL,
              headed: process.env.PERFORMANCE_HEADED === "1",
              paintObservation:
                "Two requestAnimationFrame callbacks after the DOM/input change; browser paint opportunity, not physical display presentation.",
              saveObservation:
                "IDB atomic transaction complete measured separately from the saved screen paint; full items/source/execution state verified again after reload.",
              summary,
              samples,
            },
            null,
            2,
          ),
        ),
      });
      expect(samples).toHaveLength(repeats);
    });
  }
