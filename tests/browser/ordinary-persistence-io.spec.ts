import { readBrowserEventLists } from "./shopping-transfer-persisted-store";
import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block", video: "off", trace: "off" });

test("ordinary purchase, planned quantity and memo retain the same physical persistence boundary", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const calls: Array<{
      id: number;
      method: string;
      sentAt: number;
      repliedAt?: number;
      error?: unknown;
    }> = [];
    Object.assign(window, { __ordinaryIoCalls: calls });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes("persistence.worker")) return;
        const send = this.postMessage.bind(this);
        this.postMessage = (message: { id: number; method: string }) => {
          calls.push({
            id: message.id,
            method: message.method,
            sentAt: performance.now(),
          });
          send(message);
        };
        this.addEventListener("message", (event) => {
          const call = calls.find((entry) => entry.id === event.data.id);
          if (call) {
            call.repliedAt = performance.now();
            call.error = event.data.error;
          }
        });
      }
    };
  });
  const items = ["1", "2", "3"].map((id) => ({
    id,
    eventDate: "1日目",
    circle: "ユーザー登録" + id,
    title: "新刊" + id,
    block: "A",
    number: id,
    price: 500,
    quantity: 1,
    purchaseStatus: "None",
    remarks: "エラーが発生しました",
  }));
  const map = {
    maxRow: 3,
    maxCol: 3,
    mergedCells: [],
    cells: Array.from({ length: 9 }, (_, index) => ({
      row: Math.floor(index / 3) + 1,
      col: (index % 3) + 1,
      value: index < 3 ? index + 1 : null,
      backgroundColor: null,
      borders: { top: null, right: null, bottom: null, left: null },
    })),
    blocks: [
      {
        name: "A",
        startRow: 1,
        startCol: 1,
        endRow: 3,
        endCol: 3,
        numberCells: [1, 2, 3].map((value) => ({ row: 1, col: value, value })),
      },
    ],
  };
  const source = {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-18T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: { "通常保存I/O": items },
      eventMetadata: {},
      executeModeItems: {
        "通常保存I/O": { "1日目": items.map((item) => item.id) },
      },
      dayModes: { "通常保存I/O": { "1日目": "execute" } },
      mapData: { "通常保存I/O": { "1日目マップ": map } },
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
  await page.goto("/");
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "ordinary-io.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(source), "utf8"),
    });
  const restore = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await restore.getByRole("radio", { name: /同名で置換/ }).check();
  await restore.getByRole("button", { name: "置換して復元" }).click();
  await expect(restore).toBeHidden();
  const worker = page
    .workers()
    .find((value) => value.url().includes("persistence.worker"));
  if (!worker) throw new Error("Persistence Worker missing");
  await worker.evaluate(() => {
    type Transaction = {
      stores: string[];
      writes: Array<{ store: string; method: string }>;
    };
    const active = new WeakMap<IDBTransaction, Transaction>();
    const completed: Transaction[] = [];
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      ...args: Parameters<IDBDatabase["transaction"]>
    ) {
      const result = transaction.apply(this, args);
      if (args[1] === "readwrite") {
        const entry = {
          stores: Array.from(result.objectStoreNames),
          writes: [],
        };
        active.set(result, entry);
        result.addEventListener("complete", () => completed.push(entry));
      }
      return result;
    };
    for (const method of ["put", "add", "delete", "clear"] as const) {
      const original = IDBObjectStore.prototype[method];
      Object.defineProperty(IDBObjectStore.prototype, method, {
        configurable: true,
        writable: true,
        value: function (this: IDBObjectStore, ...args: unknown[]) {
          const result = (original as (...args: unknown[]) => IDBRequest).apply(
            this,
            args,
          );
          active
            .get(this.transaction)
            ?.writes.push({ store: this.name, method });
          return result;
        },
      });
    }
    Object.assign(self, { __ordinaryIoTake: () => completed.splice(0) });
  });
  const readItems = async () =>
    (await readBrowserEventLists(page))["通常保存I/O"];
  const originalItems = await readItems();
  const row = page.locator('[data-item-id="1"]').first();
  await expect(row).toBeVisible();
  const observations: unknown[] = [];
  for (const operation of ["purchase", "planned-quantity", "memo"] as const) {
    await page.evaluate(() => {
      (
        window as unknown as { __ordinaryIoCalls: unknown[] }
      ).__ordinaryIoCalls.length = 0;
    });
    await worker.evaluate(() =>
      (self as unknown as { __ordinaryIoTake(): unknown }).__ordinaryIoTake(),
    );
    const reaction = await row.evaluate(async (element, operation) => {
      const startedAt = performance.now();
      if (operation === "purchase")
        element
          .querySelector<HTMLButtonElement>(
            'button[aria-label^="Current status:"]',
          )!
          .click();
      else if (operation === "planned-quantity") {
        const select = element.querySelector<HTMLSelectElement>(
          'select[aria-label="購入予定数量"]',
        )!;
        select.value = "2";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        const input = element.querySelector<HTMLInputElement>(
          'input[aria-label="利用者メモ"]',
        )!;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, "通常I/O確認のメモ");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await new Promise(requestAnimationFrame);
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { startedAt, responseMs: performance.now() - startedAt };
    }, operation);
    await expect
      .poll(async () => {
        const item = (await readItems()).find((entry) => entry.id === "1")!;
        return operation === "purchase"
          ? item.purchaseStatus
          : operation === "planned-quantity"
            ? item.quantity
            : item.remarks;
      })
      .toBe(
        operation === "purchase"
          ? "Purchased"
          : operation === "planned-quantity"
            ? 2
            : "通常I/O確認のメモ",
      );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const calls = (
            window as unknown as {
              __ordinaryIoCalls: Array<{ method: string; repliedAt?: number }>;
            }
          ).__ordinaryIoCalls;
          const writes = calls.filter(
            (entry) =>
              ["commit", "commitDay", "day", "items"].includes(entry.method) ||
              entry.method.startsWith("save"),
          );
          return (
            writes.length > 0 &&
            writes.every((entry) => entry.repliedAt !== undefined)
          );
        }),
      )
      .toBe(true);
    const calls = await page.evaluate(
      () =>
        (
          window as unknown as {
            __ordinaryIoCalls: Array<{
              method: string;
              sentAt: number;
              repliedAt: number;
              error?: unknown;
            }>;
          }
        ).__ordinaryIoCalls,
    );
    const physical = await worker.evaluate(() =>
      (
        self as unknown as {
          __ordinaryIoTake(): Array<{
            stores: string[];
            writes: Array<{ store: string; method: string }>;
          }>;
        }
      ).__ordinaryIoTake(),
    );
    const writeCalls = calls.filter(
      (entry) =>
        ["commit", "commitDay", "day", "items"].includes(entry.method) ||
        entry.method.startsWith("save"),
    );
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls.every((entry) => !entry.error)).toBe(true);
    expect(physical).toHaveLength(1);
    expect((await readItems()).slice(1)).toEqual(originalItems.slice(1));
    observations.push({
      operation,
      responseMs: reaction.responseMs,
      saveCompletionMs:
        Math.max(...writeCalls.map((entry) => entry.repliedAt)) -
        reaction.startedAt,
      workerRoundTripsByMethod: Object.fromEntries(
        [...new Set(calls.map((entry) => entry.method))].map((method) => [
          method,
          calls.filter((entry) => entry.method === method).length,
        ]),
      ),
      physicalCommittedTransactions: physical.length,
      committedObjectStoreMutationRequests: physical.reduce(
        (sum, entry) => sum + entry.writes.length,
        0,
      ),
      transactionStores: physical.map((entry) => [...entry.stores].sort()),
      mutations: physical
        .flatMap((entry) => entry.writes)
        .sort(
          (left, right) =>
            left.store.localeCompare(right.store) ||
            left.method.localeCompare(right.method),
        ),
    });
  }
  await testInfo.attach("ordinary-persistence-io", {
    contentType: "application/json",
    body: JSON.stringify(
      {
        label: process.env.ESP_IO_RESULT_LABEL ?? "unspecified",
        fixture: "3 items, 3x3 map; isolated ordinary operations",
        notes:
          "Physical counts observe completed readwrite IDB transactions and their issued objectStore mutation requests; independent of app diagnostic events. Response is one animation frame plus following task. Save completion is successful write RPC reply. Timing values are observations, not performance acceptance.",
        observations,
      },
      null,
      2,
    ),
  });
});
