import { expect, test, type Page, type Worker } from "@playwright/test";
import ExcelJS from "exceljs";

const eventName = "地図取込の遅延取消";
const day = "1日目";
const oldFile = "cancelled-map.xlsx";
const nextFile = "next-user-map.xlsx";

test.use({ serviceWorkers: "block" });

function fixture(reimport: boolean) {
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-19T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: {
        [eventName]: [
          {
            id: "1",
            eventDate: day,
            circle: "ユーザー登録",
            title: "購入記録を保持",
            block: "A",
            number: "1",
            price: 700,
            quantity: 2,
            purchaseStatus: "Purchased",
            remarks: "エラーが発生しました・この記録は変更しない",
          },
        ],
      },
      eventMetadata: {},
      executeModeItems: { [eventName]: { [day]: ["1"] } },
      dayModes: { [eventName]: { [day]: "edit" } },
      mapData: reimport
        ? {
            [eventName]: {
              [`${day}マップ`]: {
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
                    numberCells: [{ row: 2, col: 2, value: 1 }],
                  },
                ],
              },
            },
          }
        : {},
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
}

async function restore(page: Page, reimport: boolean) {
  await page.addInitScript(() => {
    const trace = { workers: 0, received: [] as number[] };
    Object.assign(window, { __mapCancelMainTrace: trace });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes("persistence.worker")) return;
        trace.workers++;
        this.addEventListener("message", (event) => {
          if (typeof event.data?.id === "number")
            trace.received.push(event.data.id);
        });
      }
    };
  });
  await page.goto("/");
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "map-cancel-fixture.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(fixture(reimport)), "utf8"),
    });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog
    .getByRole("button", { name: "置換して復元", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: `「${eventName}」の復元内容を確認`,
    exact: true,
  });
  await expect
    .poll(async () => {
      if (await review.isVisible()) return "review";
      return (await dialog.isVisible()) ? "waiting" : "saved";
    })
    .not.toBe("waiting");
  if (await review.isVisible())
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
}

type StoredRows = Record<string, Array<{ key: IDBValidKey; value: unknown }>>;

async function allStores(page: Page): Promise<StoredRows> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<StoredRows>((resolve, reject) => {
        const names = [...database.objectStoreNames];
        const transaction = database.transaction(names, "readonly");
        const rows: StoredRows = Object.fromEntries(
          names.map((name) => [name, []]),
        );
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

async function workbook(marker: string) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(day);
  const border = { style: "medium" as const, color: { argb: "FFFF0000" } };
  sheet.getCell("A1").value = "A";
  sheet.getCell("A1").border = { top: border, bottom: border, left: border };
  sheet.getCell("B1").value = 1;
  sheet.getCell("B1").border = { top: border, bottom: border, right: border };
  sheet.getCell("F6").value = marker;
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function selectMap(page: Page, name: string, buffer: Buffer) {
  const input = page.locator('input[type="file"][accept=".xlsx"]').first();
  await input.evaluate((element, value) => {
    (element as HTMLInputElement).dataset.eventName = value;
  }, eventName);
  await input.setInputFiles({
    name,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  const dialog = page.getByRole("dialog", {
    name: "📋 マップデータ取り込み",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(name, { exact: true })).toBeVisible();
  return dialog;
}

interface ReadGateTrace {
  readRequests: number[];
  readReplies: number[];
  gatedReadId: number | null;
  gateReached: number;
  released: boolean;
  writes: string[];
  readwriteStarted: number;
  readwriteCompleted: number;
}
interface ReadGateRealm {
  __mapCancelReadGate: ReadGateTrace;
  __releaseMapCancelRead(): void;
}

async function delayFirstDurableRead(page: Page): Promise<Worker> {
  const worker = page
    .workers()
    .find((candidate) => candidate.url().includes("persistence.worker"));
  if (!worker) throw new Error("The real persistence Worker has not started.");
  await worker.evaluate(() => {
    const trace: ReadGateTrace = {
      readRequests: [],
      readReplies: [],
      gatedReadId: null,
      gateReached: 0,
      released: false,
      writes: [],
      readwriteStarted: 0,
      readwriteCompleted: 0,
    };
    let resume: (() => void) | undefined;
    let armed = true;
    const realm = globalThis as unknown as ReadGateRealm;
    realm.__mapCancelReadGate = trace;
    realm.__releaseMapCancelRead = () => {
      if (!resume || trace.released)
        throw new Error("Read gate is not waiting.");
      trace.released = true;
      resume();
    };
    self.addEventListener("message", (event) => {
      const method = event.data?.method as string | undefined;
      if (method === "read") trace.readRequests.push(event.data.id);
      if (
        method &&
        (["commit", "commitDay", "day", "items"].includes(method) ||
          method.startsWith("save"))
      )
        trace.writes.push(method);
    });
    const send = self.postMessage.bind(self);
    self.postMessage = ((message: { id?: number }) => {
      if (
        typeof message.id === "number" &&
        trace.readRequests.includes(message.id)
      )
        trace.readReplies.push(message.id);
      send(message);
    }) as typeof self.postMessage;
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      ...args: Parameters<IDBDatabase["transaction"]>
    ) {
      const result = transaction.apply(this, args);
      if (args[1] === "readwrite") {
        trace.readwriteStarted++;
        result.addEventListener("complete", () => trace.readwriteCompleted++);
      }
      const stores = typeof args[0] === "string" ? [args[0]] : [...args[0]];
      if (
        armed &&
        args[1] === "readonly" &&
        stores.includes("eventLists") &&
        stores.includes("eventConsistency") &&
        stores.includes("syncQueue")
      ) {
        armed = false;
        let handler: IDBTransaction["oncomplete"] = null;
        Object.defineProperty(result, "oncomplete", {
          configurable: true,
          get: () => handler,
          set: (value: IDBTransaction["oncomplete"]) => {
            handler = value;
          },
        });
        result.addEventListener("complete", (event) => {
          // IDB has really finished reading. Only the consumer's completion is delayed.
          trace.gateReached++;
          trace.gatedReadId = trace.readRequests.at(-1) ?? null;
          resume = () => handler?.call(result, event);
        });
      }
      return result;
    };
  });
  return worker;
}

const gateTrace = (worker: Worker) =>
  worker.evaluate(
    () => (globalThis as unknown as ReadGateRealm).__mapCancelReadGate,
  );

for (const route of [
  "initial",
  "reimport with impact",
  "reimport without impact",
] as const) {
  test(`OP12 real App cancels ${route} during initial durable read and keeps the next file after its late reply`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    const reimport = route !== "initial";
    await restore(page, reimport);
    const durableBefore = await allStores(page);
    const importDialog = await selectMap(
      page,
      oldFile,
      await workbook("旧要求"),
    );
    const preconfirmation = page.getByRole("dialog", {
      name: "マップを入れ替える前の確認",
      exact: true,
    });
    const impact = page.getByRole("dialog", {
      name: "マップ再取り込みの影響を確認",
      exact: true,
    });
    let ownerDialog = importDialog;
    if (reimport) {
      await importDialog
        .getByRole("button", { name: "取り込む", exact: true })
        .click();
      await expect(preconfirmation).toBeVisible();
      ownerDialog = preconfirmation;
    }
    const worker = await delayFirstDurableRead(page);
    if (reimport)
      await preconfirmation
        .getByRole("button", {
          name:
            route === "reimport with impact"
              ? "影響範囲を確認する"
              : "影響を確認せずに取り込む",
          exact: true,
        })
        .click();
    else
      await importDialog
        .getByRole("button", { name: "取り込む", exact: true })
        .click();
    await expect
      .poll(async () => (await gateTrace(worker)).gateReached)
      .toBe(1);
    const held = await gateTrace(worker);
    expect(held.readRequests).toHaveLength(1);
    expect(held.gatedReadId).toBe(held.readRequests[0]);
    expect(held.readReplies).toEqual([]);
    expect(held.writes).toEqual([]);
    expect(held.readwriteStarted).toBe(0);
    expect(held.readwriteCompleted).toBe(0);
    await expect(
      ownerDialog.getByRole("button", { name: "キャンセル", exact: true }),
    ).toBeEnabled();
    await ownerDialog
      .getByRole("button", { name: "キャンセル", exact: true })
      .click();
    await expect(importDialog).toBeHidden();
    await expect(preconfirmation).toBeHidden();
    await expect(impact).toBeHidden();
    const next = await selectMap(
      page,
      nextFile,
      await workbook("次ファイルの入力"),
    );
    await next
      .getByRole("button", { name: /ブロック自動検出の詳細設定/ })
      .click();
    const setting = next.locator('input[type="number"]').first();
    await setting.fill("3");
    await expect(setting).toHaveValue("3");
    await worker.evaluate(() =>
      (globalThis as unknown as ReadGateRealm).__releaseMapCancelRead(),
    );
    await expect
      .poll(async () => (await gateTrace(worker)).readReplies)
      .toContain(held.gatedReadId);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __mapCancelMainTrace: { received: number[] };
              }
            ).__mapCancelMainTrace.received,
        ),
      )
      .toContain(held.gatedReadId);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expect(next).toBeVisible();
    await expect(next.getByText(nextFile, { exact: true })).toBeVisible();
    await expect(setting).toHaveValue("3");
    await expect(
      next.getByRole("button", { name: "取り込む", exact: true }),
    ).toBeEnabled();
    await expect(preconfirmation).toBeHidden();
    await expect(impact).toBeHidden();
    const trace = await gateTrace(worker);
    expect(trace.gateReached).toBe(1);
    expect(trace.released).toBe(true);
    expect(trace.writes).toEqual([]);
    expect(trace.readwriteStarted).toBe(0);
    expect(trace.readwriteCompleted).toBe(0);
    expect(await allStores(page)).toEqual(durableBefore);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __mapCancelMainTrace: { workers: number } })
            .__mapCancelMainTrace.workers,
      ),
    ).toBe(1);
    await testInfo.attach("real-worker-delayed-map-import-cancel", {
      body: Buffer.from(
        JSON.stringify({ route, workerUrl: worker.url(), trace }, null, 2),
        "utf8",
      ),
      contentType: "application/json",
    });
  });
}
