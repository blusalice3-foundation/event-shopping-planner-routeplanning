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

import { scopeReadyKey } from "../../src/persistence/db/scopedDayStorage";
import {
  dayRecordStores,
  dayRecordRootDigestKey,
  partitionDayRecordStore,
  sidecarRecordStores,
} from "../../src/persistence/db/dayRecordStorage";

const phase = process.env.SHEET_URL_BROWSER_PHASE;
const legacyStartup = process.env.SHEET_URL_LEGACY_STARTUP === "1";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";
const fixedInputs = process.env.SHEET_URL_FIXED_INPUT_DIR;
const repeats = Number(process.env.SHEET_URL_BROWSER_REPEATS ?? "20");
if (!Number.isSafeInteger(repeats) || repeats < 1)
  throw new Error("SHEET_URL_BROWSER_REPEATS must be a positive integer");

type TransactionProbe = {
  realm: "main" | "worker";
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  mode: IDBTransactionMode;
  stores: string[];
  outcome?: "complete" | "abort";
  putRequests: Record<string, number>;
  eventListsDataPuts: number;
  scopeReadyPuts: number;
  injectedAbort?: boolean;
};
type BrowserProbe = {
  transactions: TransactionProbe[];
  marks: Record<string, number>;
  abortNextAtomic: boolean;
};

// Installed in each real browser realm, including the production module worker.
// The probe records IDB request counts without traversing item payloads.
function installPersistenceProbe(config: {
  abortFirstAtomic: boolean;
  eventName: string;
}) {
  const state = globalThis as unknown as {
    __sheetUrlProbe?: BrowserProbe;
    document?: Document;
  };
  if (state.__sheetUrlProbe) return;
  const probe: BrowserProbe = {
    transactions: [],
    marks: {},
    abortNextAtomic: config.abortFirstAtomic,
  };
  state.__sheetUrlProbe = probe;
  const now = () => performance.timeOrigin + performance.now();
  const entries = new WeakMap<IDBTransaction, TransactionProbe>();
  const originalTransaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = originalTransaction.apply(this, args);
    if (this.name !== "EventShoppingPlannerDB") return tx;
    const entry: TransactionProbe = {
      realm: state.document ? "main" : "worker",
      startedAt: now(),
      mode: tx.mode,
      stores: Array.from(tx.objectStoreNames),
      putRequests: {},
      eventListsDataPuts: 0,
      scopeReadyPuts: 0,
    };
    entries.set(tx, entry);
    probe.transactions.push(entry);
    const finish = (outcome: "complete" | "abort") => {
      entry.finishedAt = now();
      entry.durationMs = entry.finishedAt - entry.startedAt;
      entry.outcome = outcome;
    };
    tx.addEventListener("complete", () => finish("complete"), { once: true });
    tx.addEventListener("abort", () => finish("abort"), { once: true });
    return tx;
  } as typeof originalTransaction;
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const entry = entries.get(this.transaction);
    if (entry) {
      entry.putRequests[this.name] = (entry.putRequests[this.name] ?? 0) + 1;
      if (this.name === "eventLists" && args[1] === "data")
        entry.eventListsDataPuts++;
      if (
        this.name === "syncQueue" &&
        typeof args[1] === "string" &&
        args[1].startsWith("__esp_internal__:scope-ready:v1:")
      )
        entry.scopeReadyPuts++;
      if (
        probe.abortNextAtomic &&
        this.transaction.mode === "readwrite" &&
        this.transaction.objectStoreNames.contains("eventConsistency") &&
        this.transaction.objectStoreNames.contains("eventLists")
      ) {
        probe.abortNextAtomic = false;
        entry.injectedAbort = true;
        this.transaction.abort();
        throw new DOMException("measurement startup abort", "AbortError");
      }
    }
    return originalPut.apply(this, args);
  };
  if (!state.document) return;
  const originalText = Response.prototype.text;
  Response.prototype.text = async function (...args) {
    const text = await originalText.apply(this, args);
    if (this.url.includes("/api/google-sheets-csv"))
      probe.marks.csvTextReadyAt = now();
    return text;
  };
  const document = state.document;
  const reviewTitles = new Set([
    "所属・配置の変更を確認",
    "アイテム更新の確認",
  ]);
  const observeScreen = () => {
    const headings = Array.from(document.querySelectorAll("h1,h2,h3"));
    const review = headings.some((heading) =>
      reviewTitles.has(heading.textContent?.trim() ?? ""),
    );
    if (review && !probe.marks.reviewDomAt) {
      probe.marks.reviewDomAt = now();
      requestAnimationFrame(() => {
        probe.marks.reviewFrameAt = now();
      });
    }
    if (
      probe.marks.confirmationClickedAt &&
      !review &&
      !probe.marks.screenDomAt
    ) {
      probe.marks.screenDomAt = now();
      requestAnimationFrame(() => {
        probe.marks.screenFrameAt = now();
      });
    }
    if (
      !probe.marks.startupScreenDomAt &&
      Array.from(document.querySelectorAll("li,[role=listitem]")).some((item) =>
        item.textContent?.includes(config.eventName),
      )
    )
      probe.marks.startupScreenDomAt = now();
  };
  document.addEventListener(
    "click",
    (event) => {
      const button = (event.target as Element).closest?.("button");
      if (
        ["確認して保存", "更新を実行", "更新元を切り替えて更新"].includes(
          button?.textContent?.trim() ?? "",
        )
      )
        probe.marks.confirmationClickedAt = now();
    },
    true,
  );
  new MutationObserver(observeScreen).observe(document, {
    childList: true,
    subtree: true,
  });
}
async function resetProbe(page: Page) {
  const reset = () => {
    const probe = (globalThis as unknown as { __sheetUrlProbe?: BrowserProbe })
      .__sheetUrlProbe;
    if (probe) {
      probe.transactions = [];
      probe.marks = {};
      probe.abortNextAtomic = false;
    }
  };
  await page.evaluate(reset);
  for (const worker of page.workers())
    if (worker.url().includes("persistence.worker"))
      await worker.evaluate(reset);
}
async function collectProbe(page: Page) {
  // Frame observation completes outside the Playwright wall-time intervals.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  const navigationTimeOrigin = await page.evaluate(
    () => performance.timeOrigin,
  );
  const read = () =>
    (globalThis as unknown as { __sheetUrlProbe?: BrowserProbe })
      .__sheetUrlProbe;
  const main = await page.evaluate(read);
  const workers = [];
  for (const worker of page.workers())
    if (worker.url().includes("persistence.worker"))
      workers.push(await worker.evaluate(read));
  const transactions = [main, ...workers].flatMap(
    (entry) => entry?.transactions ?? [],
  );
  const marks = main?.marks ?? {};
  return {
    transactions,
    verifiedSnapshotReadSpans: transactions.filter(
      (entry) =>
        entry.mode === "readonly" &&
        entry.stores.includes("eventLists") &&
        entry.stores.includes("eventConsistency") &&
        entry.stores.includes("mapData"),
    ),
    startupScreenDomMs: marks.startupScreenDomAt
      ? marks.startupScreenDomAt - navigationTimeOrigin
      : null,
    marks,
    csvTextToReviewDomMs:
      marks.csvTextReadyAt && marks.reviewDomAt
        ? marks.reviewDomAt - marks.csvTextReadyAt
        : null,
    csvTextToReviewFrameMs:
      marks.csvTextReadyAt && marks.reviewFrameAt
        ? marks.reviewFrameAt - marks.csvTextReadyAt
        : null,
    confirmationToScreenDomMs:
      marks.confirmationClickedAt && marks.screenDomAt
        ? marks.screenDomAt - marks.confirmationClickedAt
        : null,
    confirmationToScreenFrameMs:
      marks.confirmationClickedAt && marks.screenFrameAt
        ? marks.screenFrameAt - marks.confirmationClickedAt
        : null,
  };
}
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
async function seedStartup(
  page: Page,
  unprepared: boolean,
  legacyUrl: boolean,
) {
  const lists = (await stored(page, "eventLists")) as Record<string, object[]>;
  const next = legacyUrl
    ? {
        ...lists,
        [SHEET_EVENT]: lists[SHEET_EVENT].map((item) => ({ ...item, url: "" })),
      }
    : lists;
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
  const metadata = legacyUrl
    ? await prepareMetadataForPayload(
        "eventLists",
        "data",
        next,
        previous.revision,
      )
    : previous;
  const checkpoint = legacyUrl
    ? createNextPersistenceCheckpoint(
        "eventLists",
        "data",
        metadata,
        previousCheckpoint,
      )
    : previousCheckpoint;
  const sidecar = await partitionDayRecordStore("eventLists", next);
  await page.evaluate(
    async ({
      next,
      metadata,
      checkpoint,
      metadataKey,
      checkpointKey,
      readinessKeys,
      preparedEventListKey,
      sidecarEntries,
      rootDigests,
    }) => {
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
          const control = tx.objectStore("syncQueue");
          tx.objectStore("eventLists").put(next, "data");
          control.put(metadata, metadataKey);
          control.put(checkpoint, checkpointKey);
          for (const [key, entry] of sidecarEntries)
            tx.objectStore("eventLists").put(entry, key);
          for (const [key, digest] of rootDigests) control.put(digest, key);
          if (!readinessKeys.length)
            control.put(metadata.revision, preparedEventListKey);
          for (const key of readinessKeys) control.delete(key);
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        database.close();
      }
    },
    {
      next,
      metadata,
      checkpoint,
      metadataKey,
      checkpointKey,
      readinessKeys: unprepared
        ? [...sidecarRecordStores, "mapData" as const].map(scopeReadyKey)
        : [],
      preparedEventListKey: scopeReadyKey("eventLists"),
      sidecarEntries: [...sidecar.puts],
      rootDigests: [...sidecar.puts.values()]
        .filter((entry) => !entry.path.length)
        .map(
          (entry) =>
            [
              dayRecordRootDigestKey("eventLists", entry.eventName),
              entry.digest,
            ] as const,
        ),
    },
  );
  for (const store of dayRecordStores)
    expect(await stored(page, store)).toEqual(
      expect.objectContaining({ authenticatedRoots: true }),
    );
  for (const store of [...sidecarRecordStores, "mapData" as const]) {
    const ready = await stored(page, "syncQueue", scopeReadyKey(store));
    const root = (await stored(
      page,
      "syncQueue",
      createPersistenceMetadataKey(store, "data"),
    )) as StoredPersistenceMetadata;
    expect(ready).toBe(unprepared ? undefined : root.revision);
  }
}
async function assertStartupWrites(page: Page, state: string, mode: string) {
  const probe = await collectProbe(page);
  const atomic = probe.transactions.filter(
    (entry) =>
      entry.mode === "readwrite" &&
      entry.stores.includes("eventLists") &&
      entry.stores.includes("eventConsistency"),
  );
  const successes = atomic.filter((entry) => entry.outcome === "complete");
  const preparation = successes.filter(
    (entry) => entry.eventListsDataPuts === 0,
  );
  const compatibility = successes.filter(
    (entry) => entry.eventListsDataPuts > 0,
  );
  const unprepared = ["B02", "B04", "B06"].includes(state);
  // Only the worker adapter prepares scoped commands on its initial read.
  // Direct compatibility saves prepare their scope markers in the same commit.
  const requiresPreparation = mode === "worker" && unprepared;
  const requiresCompatibility =
    !legacyStartup && ["B03", "B04", "B06"].includes(state);
  expect(preparation).toHaveLength(requiresPreparation ? 1 : 0);
  expect(compatibility).toHaveLength(requiresCompatibility ? 1 : 0);
  expect(successes).toHaveLength(
    Number(requiresPreparation) + Number(requiresCompatibility),
  );
  expect(atomic.filter((entry) => entry.outcome === "abort")).toHaveLength(
    state === "B06" ? 1 : 0,
  );
  if (state === "B06")
    expect(atomic.filter((entry) => entry.injectedAbort)).toHaveLength(1);
  for (const entry of atomic)
    expect(entry.realm).toBe(mode === "worker" ? "worker" : "main");
  const preparationInCompatibilityCommit =
    mode === "direct" && unprepared && requiresCompatibility;
  if (preparationInCompatibilityCommit)
    expect(compatibility[0].scopeReadyPuts).toBe(
      sidecarRecordStores.length + 1,
    );
  if ((!legacyStartup && state !== "B02") || mode === "worker")
    for (const store of [...sidecarRecordStores, "mapData" as const]) {
      const ready = await stored(page, "syncQueue", scopeReadyKey(store));
      const root = (await stored(
        page,
        "syncQueue",
        createPersistenceMetadataKey(store, "data"),
      )) as StoredPersistenceMetadata;
      expect(ready).toBe(root.revision);
    }
  return {
    ...probe,
    startupPreparationPolicy:
      mode === "worker" ? "prepare-on-read" : "prepare-on-save",
    preparationInCompatibilityCommit,
    preparationCommits: preparation.length,
    compatibilityCommits: compatibility.length,
    preparationCommitMs: preparation.reduce(
      (sum, entry) => sum + entry.durationMs!,
      0,
    ),
    compatibilityCommitMs: compatibility.reduce(
      (sum, entry) => sum + entry.durationMs!,
      0,
    ),
  };
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
        "startup-B02",
        "startup-B03",
        "startup-B04",
        "startup-B05",
        "startup-B06",
        "retry",
      ] as const) {
        if (legacyStartup && route !== "startup-B04") continue;
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
            // Static preview has no API functions. Keep best-effort telemetry
            // deterministic in both builds instead of generating unrelated 404s.
            await context.route(
              "**/api/persistence-release-a-metrics",
              (request) => request.fulfill({ status: 204 }),
            );
            if (mode === "direct")
              await context.addInitScript(() => {
                const state = window as unknown as {
                  Worker: typeof Worker | undefined;
                  __sheetOriginalWorker?: typeof Worker;
                };
                state.__sheetOriginalWorker = state.Worker;
                state.Worker = undefined;
              });
            let abortStartup = false;
            await context.route("**/*persistence.worker*.js", async (route) => {
              const response = await route.fetch();
              const source = await response.text();
              const prefix = `(${installPersistenceProbe.toString()})(${JSON.stringify({ abortFirstAtomic: abortStartup, eventName: SHEET_EVENT })});\n`;
              await route.fulfill({ response, body: prefix + source });
            });
            const page = await context.newPage();
            const runtimeErrors: string[] = [];
            const consoleErrors: string[] = [];
            page.on("pageerror", (error) =>
              runtimeErrors.push(`${error.name}: ${error.message}`),
            );
            page.on("console", (message) => {
              if (message.type() === "error")
                consoleErrors.push(
                  JSON.stringify({
                    message: message.text(),
                    location: message.location(),
                  }),
                );
            });
            page.on("dialog", (dialog) => dialog.accept());
            try {
              await enter(page);
              await page.evaluate(installPersistenceProbe, {
                abortFirstAtomic: false,
                eventName: SHEET_EVENT,
              });
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
                await resetProbe(page);
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
                await resetProbe(page);
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
                const state = route.slice("startup-".length);
                await seedStartup(
                  page,
                  ["B02", "B04", "B05", "B06"].includes(state),
                  ["B03", "B04", "B05", "B06"].includes(state),
                );
                await page.addInitScript(installPersistenceProbe, {
                  abortFirstAtomic: state === "B06",
                  eventName: SHEET_EVENT,
                });
                if (state === "B05") {
                  await page.reload();
                  await expect(
                    page.getByRole("listitem").filter({ hasText: SHEET_EVENT }),
                  ).toBeVisible();
                  await assertStartupWrites(page, "B04", mode);
                }
                abortStartup = state === "B06";
                const start = performance.now();
                await page.reload();
                let failureMs = 0;
                let retryMs = 0;
                if (state === "B06") {
                  const retry = page.getByRole("button", {
                    name: "読み込みを再試行",
                    exact: true,
                  });
                  await expect(retry).toBeVisible();
                  failureMs = performance.now() - start;
                  const retryStart = performance.now();
                  await retry.click();
                  await expect(
                    page.getByRole("listitem").filter({ hasText: SHEET_EVENT }),
                  ).toBeVisible();
                  retryMs = performance.now() - retryStart;
                } else
                  await expect(
                    page.getByRole("listitem").filter({ hasText: SHEET_EVENT }),
                  ).toBeVisible();
                detail = {
                  durationMs: performance.now() - start,
                  failureMs,
                  retryMs,
                  ...(await assertStartupWrites(page, state, mode)),
                };
                const savedItems = (
                  (await stored(page, "eventLists")) as Record<
                    string,
                    Array<{ url?: unknown }>
                  >
                )[SHEET_EVENT];
                expect(
                  savedItems.every((item) =>
                    legacyStartup
                      ? Object.prototype.hasOwnProperty.call(item, "url") &&
                        item.url === ""
                      : !Object.prototype.hasOwnProperty.call(item, "url"),
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
                await resetProbe(page);
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
              expect(runtimeErrors).toEqual([]);
              const injectedFailure =
                route === "retry" || route === "startup-B06";
              if (!injectedFailure) expect(consoleErrors).toEqual([]);
              samples.push({
                runtimeErrors,
                consoleErrors,
                consoleErrorContext: injectedFailure
                  ? "storage-failure-injected"
                  : "normal",
                phase,
                count,
                mode,
                route,
                iteration,
                evidenceEligible: repeats >= 20,
                ...(legacyStartup
                  ? { sourceBaseline: "cc475cd", legacyStartup: true }
                  : {}),
                ...detail,
                ...(route.startsWith("startup")
                  ? {}
                  : await collectProbe(page)),
              });
            } finally {
              await context.close();
            }
          }
          await writeFile(
            testInfo.outputPath("sheet-url-route-timings.json"),
            JSON.stringify(samples, null, 2),
            "utf8",
          );
          expect(samples).toHaveLength(repeats);
        });
      }
});
