import {
  expect,
  type Download,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { createHash } from "node:crypto";
import { verifyZipjsInflatePatch } from "../../scripts/patch-zipjs-inflate.mjs";

export const eventName = "iOSファイル保存確認";
export const item = {
  id: "ios-file-item",
  eventDate: "1日目",
  circle: "ユーザー登録",
  title: "日本語の新刊",
  block: "A",
  number: "01a",
  price: 500,
  quantity: 2,
  purchaseStatus: "None",
  remarks: "エラーが発生しました",
};
export const backup = {
  kind: "event-shopping-planner-backup",
  version: 1,
  exportedAt: "2026-11-08T00:00:00.000Z",
  eventSettings: { blockDetectionSettings: {} },
  data: {
    eventLists: { [eventName]: [item] },
    eventMetadata: {},
    executeModeItems: { [eventName]: { "1日目": [item.id] } },
    dayModes: { [eventName]: { "1日目": "edit" } },
    mapData: {},
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallDefinitions: {},
    hallRouteSettings: {},
  },
};
export const xlsxMime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function readDownload(download: Download): Promise<Buffer> {
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  if (!stream) throw new Error("File download stream is missing.");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

type WorkerTrace = {
  url: string;
  requests: Array<{
    kind: string;
    inputBytes: number | null;
    transferred: boolean | null;
    detached: boolean | null;
  }>;
  responses: Array<{ type: string; kind: string; errorCode?: string }>;
};
type XlsxTraceWindow = Window & { __xlsxTransferTrace: WorkerTrace[] };

// All instrumentation is test-only. The actual native module Worker, its
// transfer list and product executor remain in use.
export async function launch(
  page: Page,
  forbidNativeCodecs = true,
  interceptWorker = true,
  startUrl = "/",
) {
  const failures: string[] = [];
  const navigations: string[] = [];
  const workers: string[] = [];
  const workerBodies: Record<string, string> = {};
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("crash", () => failures.push("page crashed"));
  page.on("dialog", (dialog) => void dialog.accept());
  page.on("worker", (worker) => {
    if (worker.url().includes("xlsx.worker")) workers.push(worker.url());
  });
  await page.addInitScript(() => {
    const trace: WorkerTrace[] = [];
    (window as XlsxTraceWindow).__xlsxTransferTrace = trace;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      readonly trace?: WorkerTrace;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes("xlsx.worker")) return;
        this.trace = { url: String(url), requests: [], responses: [] };
        trace.push(this.trace);
        this.addEventListener("message", (event) => {
          if (event.data?.type === "XLSX_PROGRESS") return;
          this.trace!.responses.push({
            type: event.data?.type,
            kind: event.data?.kind,
            ...(event.data?.errorCode
              ? { errorCode: event.data.errorCode }
              : {}),
          });
        });
      }
      postMessage(message: unknown, transfer: Transferable[]): void;
      postMessage(message: unknown, options?: StructuredSerializeOptions): void;
      postMessage(
        message: unknown,
        transferOrOptions?: Transferable[] | StructuredSerializeOptions,
      ): void {
        const value = message as {
          type?: string;
          kind?: string;
          input?: ArrayBuffer;
        };
        const transfer = Array.isArray(transferOrOptions)
          ? transferOrOptions
          : (transferOrOptions?.transfer ?? []);
        const input = value.input;
        const request =
          this.trace && value.type !== "XLSX_CANCEL_REQUEST"
            ? {
                kind: value.kind ?? "unknown",
                inputBytes: input?.byteLength ?? null,
                transferred: input ? transfer.includes(input) : null,
                detached: input ? false : null,
              }
            : null;
        if (Array.isArray(transferOrOptions))
          super.postMessage(message, transferOrOptions);
        else super.postMessage(message, transferOrOptions);
        if (request) {
          if (input) request.detached = input.byteLength === 0;
          this.trace!.requests.push(request);
        }
      }
    };
  });
  if (interceptWorker) {
    await page.route("**/xlsx.worker-*.js", async (route) => {
      const response = await route.fetch();
      // Apple WebKit must keep using JS; other platforms can fall back when
      // native codecs are absent. No executor or QA adapter is substituted.
      const prefix = forbidNativeCodecs
        ? 'globalThis.CompressionStream = globalThis.DecompressionStream = class { constructor() { throw new Error("Native ZIP codec must not be used."); } };\n'
        : "";
      const body = prefix + (await response.text());
      workerBodies[route.request().url()] = createHash("sha256")
        .update(body)
        .digest("hex");
      await route.fulfill({ response, body });
    });
  }
  await page.goto(startUrl);
  await expect(page.locator("#loading-screen")).toBeHidden();
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  return {
    async verify(
      expectedWorkers: number,
      testInfo: TestInfo,
      expectedNavigations = 0,
      expectedFailures: readonly string[] = [],
    ) {
      expect(workers).toHaveLength(expectedWorkers);
      expect(failures).toEqual(expectedFailures);
      expect(navigations).toHaveLength(expectedNavigations);
      const trace = await page.evaluate(
        () => (window as XlsxTraceWindow).__xlsxTransferTrace,
      );
      for (const worker of trace)
        for (const request of worker.requests)
          if (request.inputBytes !== null) {
            expect(request.inputBytes).toBeGreaterThan(0);
            expect(request.transferred).toBe(true);
            expect(request.detached).toBe(true);
          }
      await testInfo.attach("product-xlsx-worker-evidence", {
        contentType: "application/json",
        body: Buffer.from(
          JSON.stringify({
            testId: testInfo.testId,
            project: testInfo.project.name,
            retry: testInfo.retry,
            pageErrors: failures,
            codecPath: forbidNativeCodecs
              ? "forced-js-fallback"
              : "platform-selection",
            workers,
            workerBodies,
            decoder: verifyZipjsInflatePatch(),
            trace,
            identity: await readRuntimeIdentity(page),
          }),
        ),
      });
      return trace;
    },
  };
}

export async function readRuntimeIdentity(page: Page) {
  return page.evaluate(() => {
    const meta = (name: string) =>
      document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
        ?.content ?? null;
    return {
      buildId: meta("event-shopping-planner-build-id"),
      sourceSha: meta("event-shopping-planner-source-sha"),
      variantId: meta("event-shopping-planner-variant-id"),
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
    };
  });
}

export async function allStores(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<
        Record<string, Array<{ key: IDBValidKey; value: unknown }>>
      >((resolve, reject) => {
        const names = [...database.objectStoreNames];
        const transaction = database.transaction(names, "readonly");
        const rows: Record<
          string,
          Array<{ key: IDBValidKey; value: unknown }>
        > = Object.fromEntries(names.map((name) => [name, []]));
        transaction.oncomplete = () => resolve(rows);
        transaction.onabort = () => reject(transaction.error);
        for (const name of names) {
          const request = transaction.objectStore(name).openCursor();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const row = request.result;
            if (!row) return;
            rows[name].push({ key: row.key, value: row.value });
            row.continue();
          };
        }
      });
    } finally {
      database.close();
    }
  });
}

export async function confirmRestore(page: Page, name: string, rename = false) {
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
    exact: true,
  });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  if (rename) {
    await dialog
      .getByRole("textbox", { name: "復元後のイベント名" })
      .fill(name);
    await dialog
      .getByRole("button", { name: "別名で復元", exact: true })
      .click();
  } else {
    await dialog.getByRole("radio", { name: /同名で置換/ }).check();
    await dialog
      .getByRole("button", { name: "置換して復元", exact: true })
      .click();
  }
  const review = page.getByRole("dialog", {
    name: `「${name}」の復元内容を確認`,
    exact: true,
  });
  await expect
    .poll(
      async () => (await review.isVisible()) || !(await dialog.isVisible()),
      { timeout: 30_000 },
    )
    .toBe(true);
  if (await review.isVisible())
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

export async function exportBackup(page: Page) {
  const back = page.getByRole("button", { name: "イベント一覧", exact: true });
  if (await back.isVisible()) await back.click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONバックアップ保存", exact: true })
    .click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/\.json$/);
  return JSON.parse((await readDownload(file)).toString("utf8")) as {
    kind: string;
    eventSettings: Record<string, unknown>;
    data: {
      eventLists: Record<string, Array<typeof item>>;
      mapData: Record<
        string,
        Record<string, { maxRow: number; maxCol: number; cells: unknown[] }>
      >;
      [key: string]: unknown;
    };
  };
}

// Hash canonical complete data so failure output stays bounded for 50,000-cell
// maps. No sampling or omission of intermediate records is involved.
export function contentDigest(value: unknown): string {
  const canonical = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(canonical);
    if (entry && typeof entry === "object")
      return Object.fromEntries(
        Object.entries(entry)
          .sort(([a], [b]) => a.localeCompare(b, "en"))
          .map(([key, child]) => [key, canonical(child)]),
      );
    return entry;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
