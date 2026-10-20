import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function storedEventLists(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Record<string, Array<Record<string, unknown>>>>(
        (resolve, reject) => {
          const request = database
            .transaction("eventLists", "readonly")
            .objectStore("eventLists")
            .get("data");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
    } finally {
      database.close();
    }
  });
}

test("a real XLSX restore stops every later write after its committed completion alert throws", async ({
  page,
}, testInfo) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.addInitScript(() => {
    const trace = { workers: 0, writeMethods: [] as string[] };
    Object.assign(window, { __restoreUiWriteTrace: trace });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes("persistence.worker")) return;
        trace.workers++;
        const send = this.postMessage.bind(this);
        this.postMessage = (message: { method?: string }) => {
          if (
            message.method &&
            (["commit", "commitDay", "day", "items"].includes(message.method) ||
              message.method.startsWith("save"))
          )
            trace.writeMethods.push(message.method);
          send(message);
        };
      }
    };
  });
  const originalEvent = "復元UI元イベント";
  const restoredEvent = "復元UI確定イベント";
  const source = {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-19T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: {
        [originalEvent]: [
          {
            id: "1",
            eventDate: "1日目",
            circle: "ユーザー登録",
            title: "新刊",
            block: "A",
            number: "1",
            price: 500,
            quantity: 1,
            purchaseStatus: "None",
            remarks: "エラーが発生しました",
          },
        ],
      },
      eventMetadata: {},
      executeModeItems: { [originalEvent]: { "1日目": ["1"] } },
      dayModes: { [originalEvent]: { "1日目": "execute" } },
      mapData: {},
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
  const jsonFile = {
    name: "restore-ui.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source), "utf8"),
  };
  await page.goto("/");
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles(jsonFile);
  const candidate = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await candidate.getByRole("radio", { name: /同名で置換/ }).check();
  await candidate
    .getByRole("button", { name: "置換して復元", exact: true })
    .click();
  await expect(candidate).toBeHidden();
  await expect(
    page.getByRole("heading", { name: originalEvent, exact: true }),
  ).toBeVisible();
  const originalItems = (await storedEventLists(page))[originalEvent];
  await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("button", { name: /Excel形式で出力/ }).click();
  await expect(
    page.getByRole("checkbox", {
      name: "配置情報（実行列・候補リストの順序）",
    }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "ホール定義・所属・巡回設定" }),
  ).toBeChecked();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "エクスポート", exact: true }).click();
  const stream = await (await downloading).createReadStream();
  if (!stream) throw new Error("Exported XLSX stream missing");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const xlsxFile = {
    name: "restore-ui.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.concat(chunks),
  };
  await page
    .locator('input[aria-label="Excelファイルを選択"]')
    .setInputFiles(xlsxFile);
  await expect(candidate).toBeVisible();
  await candidate
    .getByRole("textbox", { name: "復元後のイベント名" })
    .fill(restoredEvent);
  expect((await storedEventLists(page))[restoredEvent]).toBeUndefined();
  const worker = page
    .workers()
    .find((value) => value.url().includes("persistence.worker"));
  if (!worker) throw new Error("Persistence Worker missing");
  await worker.evaluate(() => {
    const trace = { started: 0, completed: 0, stores: [] as string[][] };
    Object.assign(self, { __restoreUiPhysicalTrace: trace });
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      ...args: Parameters<IDBDatabase["transaction"]>
    ) {
      const result = transaction.apply(this, args);
      if (args[1] === "readwrite") {
        trace.started++;
        trace.stores.push(Array.from(result.objectStoreNames).sort());
        result.addEventListener("complete", () => trace.completed++);
      }
      return result;
    };
  });
  const completionMessage = `${restoredEvent}を作成しました。\n1件`;
  await page.evaluate((completionMessage) => {
    const nativeAlert = window.alert;
    const trace = { failures: 0, messages: [] as string[] };
    Object.assign(window, { __restoreCompletionUiTrace: trace });
    (
      window as unknown as { __restoreUiWriteTrace: { writeMethods: string[] } }
    ).__restoreUiWriteTrace.writeMethods.length = 0;
    window.alert = (message?: unknown) => {
      if (String(message) === completionMessage) {
        trace.failures++;
        trace.messages.push(String(message));
        throw new Error("Injected post-commit restore completion UI failure");
      }
      nativeAlert(message);
    };
  }, completionMessage);
  await candidate
    .getByRole("button", { name: "別名で復元", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "再読み込み", exact: true }),
  ).toBeVisible();
  await expect(candidate).toBeHidden();
  const saved = await storedEventLists(page);
  expect(saved[restoredEvent]).toMatchObject([
    {
      title: "新刊",
      quantity: 1,
      purchaseStatus: "None",
      remarks: "エラーが発生しました",
    },
  ]);
  expect(saved[originalEvent]).toEqual(originalItems);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __restoreCompletionUiTrace: unknown })
          .__restoreCompletionUiTrace,
    ),
  ).toEqual({ failures: 1, messages: [completionMessage] });
  const beforeRetries = await worker.evaluate(
    () =>
      (self as unknown as { __restoreUiPhysicalTrace: unknown })
        .__restoreUiPhysicalTrace,
  );
  expect(beforeRetries).toMatchObject({ started: 1, completed: 1 });
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __restoreUiWriteTrace: unknown })
          .__restoreUiWriteTrace,
    ),
  ).toEqual({ workers: 1, writeMethods: ["commit"] });
  // Re-selecting the same XLSX and a JSON candidate cannot reopen a stopped owner.
  await page
    .locator('input[aria-label="Excelファイルを選択"]')
    .setInputFiles(xlsxFile);
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles(jsonFile);
  await expect(candidate).toBeHidden();
  await expect(
    page.locator('input[aria-label="Excelファイルを選択"]'),
  ).toHaveValue("");
  await expect(
    page.locator('input[aria-label="バックアップファイルを選択"]'),
  ).toHaveValue("");
  await page.getByRole("button", { name: "保存を再試行", exact: true }).click();
  await page.getByRole("button", { name: "保存を再試行", exact: true }).click();
  const row = page.locator('[data-item-id="1"]').first();
  await row.locator('button[aria-label^="Current status:"]').click();
  // Outlast both memo debounce timers and any queued follow-up work.
  await page.waitForTimeout(1100);
  const backupDownloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONバックアップを保存", exact: true })
    .click();
  const backupStream = await (await backupDownloading).createReadStream();
  if (!backupStream) throw new Error("Recovery JSON stream missing");
  const backupChunks: Buffer[] = [];
  for await (const chunk of backupStream) backupChunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(backupChunks).toString("utf8"));
  expect(exported.data.eventLists[restoredEvent]).toEqual(saved[restoredEvent]);
  expect(exported.data.eventLists[originalEvent]).toEqual(originalItems);
  expect(await storedEventLists(page)).toEqual(saved);
  const afterRetries = await worker.evaluate(
    () =>
      (self as unknown as { __restoreUiPhysicalTrace: unknown })
        .__restoreUiPhysicalTrace,
  );
  expect(afterRetries).toEqual(beforeRetries);
  const rpc = await page.evaluate(
    () =>
      (window as unknown as { __restoreUiWriteTrace: unknown })
        .__restoreUiWriteTrace,
  );
  expect(rpc).toEqual({ workers: 1, writeMethods: ["commit"] });
  await testInfo.attach("restore-committed-ui-failure", {
    contentType: "application/json",
    body: JSON.stringify({
      completionMessage,
      injectedFailures: 1,
      beforeRetries,
      afterRetries,
      rpc,
      restoredEvent,
      originalEventUnchanged: true,
      committedSnapshotExported: true,
    }),
  });
  await page.reload();
  await page.getByText(restoredEvent, { exact: true }).click();
  await expect(page.locator('[data-item-id="1"]').first()).toBeVisible();
  expect((await storedEventLists(page))[restoredEvent]).toEqual(
    saved[restoredEvent],
  );
});
