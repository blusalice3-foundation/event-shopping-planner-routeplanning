import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("a real persistence Worker dying after DB commit stops retries and exports without a new writer", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const trace = { workers: 0, writes: 0, committed: 0 };
    Object.assign(window, { __terminalPersistenceTrace: trace });
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
            trace.writes++;
          send(message);
        };
        this.addEventListener("message", (event) => {
          if (event.data?.__terminalCommitted !== undefined)
            trace.committed = event.data.__terminalCommitted;
        });
      }
    };
  });
  await page.goto("/");
  const source = {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-18T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: {
        停止検証: [
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
            remarks: "元のメモ",
          },
        ],
      },
      eventMetadata: {},
      executeModeItems: { 停止検証: { "1日目": ["1"] } },
      dayModes: { 停止検証: { "1日目": "edit" } },
      mapData: {},
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "terminal.json",
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
    const methods = new Map<number, string>();
    self.addEventListener("message", (event) =>
      methods.set(event.data.id, event.data.method),
    );
    let committed = 0;
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      ...args: Parameters<IDBDatabase["transaction"]>
    ) {
      const result = transaction.apply(this, args);
      if (args[1] === "readwrite")
        result.addEventListener("complete", () => committed++);
      return result;
    };
    const send = self.postMessage.bind(self);
    self.postMessage = (message: { id?: number; error?: unknown }) => {
      const method = methods.get(message.id ?? -1);
      if (
        !message.error &&
        method &&
        (["commit", "commitDay", "day", "items"].includes(method) ||
          method.startsWith("save"))
      ) {
        send({ __terminalCommitted: committed });
        // The actual DB transaction completed; lose only its ordinary success reply.
        queueMicrotask(() => {
          throw new Error("Injected worker loss after DB commit");
        });
        return;
      }
      send(message);
    };
  });
  await page.evaluate(() => {
    const trace = (
      window as unknown as { __terminalPersistenceTrace: { writes: number } }
    ).__terminalPersistenceTrace;
    trace.writes = 0;
  });
  const card = page
    .locator('[data-item-id="1"]')
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
  const editor = page.getByRole("dialog", { name: "アイテム編集" });
  await editor
    .getByRole("textbox", { name: "利用者メモ", exact: true })
    .fill("応答喪失後も保持する入力");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "再読み込み", exact: true }),
  ).toBeVisible();
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole("textbox", { name: "利用者メモ", exact: true }),
  ).toHaveValue("応答喪失後も保持する入力");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __terminalPersistenceTrace: unknown })
          .__terminalPersistenceTrace,
    ),
  ).toEqual({ workers: 1, writes: 1, committed: 1 });
  await editor.getByRole("button", { name: "キャンセル", exact: true }).click();
  await page.getByRole("button", { name: "保存を再試行", exact: true }).click();
  await page.getByRole("button", { name: "保存を再試行", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONバックアップを保存", exact: true })
    .click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(exported.data.eventLists["停止検証"][0].remarks).toBe(
    "応答喪失後も保持する入力",
  );
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __terminalPersistenceTrace: unknown })
          .__terminalPersistenceTrace,
    ),
  ).toEqual({ workers: 1, writes: 1, committed: 1 });
  await page.reload();
  await page.getByText("停止検証", { exact: true }).click();
  const reloadedCard = page
    .locator('[data-item-id="1"]')
    .first()
    .locator(":scope > div.rounded-lg")
    .first();
  await reloadedCard.dispatchEvent("pointerdown", {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
  });
  await expect(
    page.getByRole("button", { name: "編集", exact: true }),
  ).toBeVisible();
  await reloadedCard.dispatchEvent("pointerup", {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
  });
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "アイテム編集" })
      .getByRole("textbox", { name: "利用者メモ", exact: true }),
  ).toHaveValue("応答喪失後も保持する入力");
});

test("the real confirmation host contains busy keyboard focus and defers a late failed-input focus request", async ({
  page,
}) => {
  await page.goto("/");
  const source = {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-18T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: {
        確認検証: [
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
            remarks: "元のメモ",
          },
        ],
      },
      eventMetadata: {},
      executeModeItems: { 確認検証: { "1日目": ["1"] } },
      dayModes: { 確認検証: { "1日目": "edit" } },
      mapData: {},
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
  const upload = async () => {
    await page
      .locator('input[aria-label="バックアップファイルを選択"]')
      .setInputFiles({
        name: "focus.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(source), "utf8"),
      });
    const candidate = page.getByRole("dialog", {
      name: "バックアップからイベントを復元",
    });
    await candidate.getByRole("radio", { name: /同名で置換/ }).check();
    await candidate.getByRole("button", { name: "置換して復元" }).click();
    return candidate;
  };
  await expect(await upload()).toBeHidden();
  const candidate = await upload();
  const review = page.getByRole("dialog", {
    name: "「確認検証」の復元内容を確認",
    exact: true,
  });
  await expect(review).toBeVisible();
  const worker = page
    .workers()
    .find((value) => value.url().includes("persistence.worker"));
  if (!worker) throw new Error("Persistence Worker missing");
  await worker.evaluate(() => {
    const receive = self.onmessage!;
    let held: MessageEvent | undefined;
    self.onmessage = (event) => {
      if (!held && event.data.method === "read") {
        held = event;
        return;
      }
      receive.call(self, event);
    };
    Object.assign(self, {
      __releaseConfirmationRead: () => {
        self.onmessage = receive;
        if (held) receive.call(self, held);
      },
    });
  });
  await review
    .getByRole("button", { name: "確認して保存", exact: true })
    .click();
  await expect(review).toHaveAttribute("aria-busy", "true");
  await expect(
    review.getByRole("button", { name: "取消", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(review).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await review.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect(
    await review.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await worker.evaluate(() =>
    (
      self as unknown as { __releaseConfirmationRead(): void }
    ).__releaseConfirmationRead(),
  );
  await expect(review).toBeHidden();
  await expect(candidate).toBeHidden();

  await upload();
  await expect(review).toBeVisible();
  await worker.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "eventLists")
        throw new DOMException("Injected accepted-input failure", "AbortError");
      return put.apply(this, args);
    };
  });
  // Deliver an already accepted card callback while the review owns keyboard focus.
  await page
    .locator('[data-item-id="1"]')
    .first()
    .getByRole("combobox", { name: "購入金額", exact: true })
    .evaluate((select: HTMLSelectElement) => {
      select.value = "900";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  const retry = page.getByRole("button", {
    name: "保留中の保存を再試行",
    exact: true,
  });
  await expect(retry).toBeVisible();
  expect(
    await review.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Tab");
  expect(
    await review.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(review).toBeHidden();
  await expect(candidate).toBeVisible();
  expect(
    await candidate.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await candidate
    .getByRole("button", { name: "キャンセル", exact: true })
    .click();
  await expect(retry).toBeFocused();
});
