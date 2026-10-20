import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const eventName = "保存確認と復元候補の重なり";

type BackupGate = {
  __lateBackupWaiting: boolean;
  __releaseLateBackup(): Promise<void>;
};

function backup() {
  const map = {
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
  };
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-20T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: {
        [eventName]: [
          {
            id: "1",
            eventDate: "1日目",
            circle: "ユーザー登録",
            title: "前面確認を保持",
            block: "A",
            number: "1",
            price: 500,
            purchaseStatus: "None",
            quantity: 1,
            remarks: "エラーが発生しました",
          },
        ],
      },
      eventMetadata: {},
      executeModeItems: { [eventName]: { "1日目": ["1"] } },
      dayModes: { [eventName]: { "1日目": "edit" } },
      mapData: { [eventName]: { "1日目マップ": map } },
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
}

async function storedMaps(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown[]>((resolve, reject) => {
        const request = db
          .transaction("mapData", "readonly")
          .objectStore("mapData")
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

test("OP05 late lower restore dialog keeps Tab and Enter in the visible save confirmation", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const original = File.prototype.text;
    const realm = window as unknown as BackupGate;
    realm.__lateBackupWaiting = false;
    File.prototype.text = async function () {
      if (this.name !== "late-restore.json") return original.call(this);
      const read = original.bind(this);
      return new Promise<string>((resolve, reject) => {
        realm.__lateBackupWaiting = true;
        realm.__releaseLateBackup = async () => {
          try {
            resolve(await read());
          } catch (error) {
            reject(error);
          }
        };
      });
    };
  });
  await page.goto("/");
  const input = page.getByLabel("バックアップファイルを選択");
  const contents = Buffer.from(JSON.stringify(backup()), "utf8");
  await input.setInputFiles({
    name: "initial-map.json",
    mimeType: "application/json",
    buffer: contents,
  });
  const restore = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
    exact: true,
  });
  await restore.getByRole("radio", { name: /同名で置換/ }).check();
  await restore
    .getByRole("button", { name: "置換して復元", exact: true })
    .click();
  await expect(restore).toBeHidden();
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
  const before = await storedMaps(page);
  await input.setInputFiles({
    name: "late-restore.json",
    mimeType: "application/json",
    buffer: contents,
  });
  await page.waitForFunction(
    () => (window as unknown as BackupGate).__lateBackupWaiting,
  );
  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  await page.getByTitle("リスト表示に切り替え", { exact: true }).hover();
  await page.mouse.down();
  await expect(
    page.getByRole("button", { name: "🔲 ブロック定義", exact: true }),
  ).toBeVisible();
  await page.mouse.up();
  await page
    .getByRole("button", { name: "🔲 ブロック定義", exact: true })
    .click();
  await page.getByRole("button", { name: /A.*1セル/ }).click();
  await page.getByPlaceholder("例: ア, め, N").fill("B");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "適用", exact: true }).click();
  const front = page.getByRole("dialog", {
    name: "所属・配置の変更を確認",
    exact: true,
  });
  await expect(front).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as BackupGate).__releaseLateBackup(),
  );
  await expect(restore).toBeVisible();
  await expect(front.getByRole("region", { name: "確認内容" })).toBeFocused();
  await page.keyboard.press("Enter");
  const observations = [];
  for (const key of [
    ...Array<string>(8).fill("Tab"),
    ...Array<string>(8).fill("Shift+Tab"),
  ]) {
    await page.keyboard.press(key);
    const observation = await front.evaluate((element) => {
      const active = document.activeElement;
      const rect = active?.getBoundingClientRect();
      const hit =
        rect &&
        document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
      return {
        focusInside: element.contains(active),
        hitInside: element.contains(hit ?? null),
      };
    });
    observations.push(observation);
    expect(observation).toEqual({ focusInside: true, hitInside: true });
  }
  expect(await storedMaps(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(front).toBeHidden();
  await expect
    .poll(() =>
      restore.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(restore).toBeHidden();
  expect(await storedMaps(page)).toEqual(before);
  await page.reload();
  expect(await storedMaps(page)).toEqual(before);
  expect(errors).toEqual([]);
  await testInfo.attach("modal-layer-keyboard-observations", {
    body: Buffer.from(
      JSON.stringify({ observations, durableUnchanged: true, errors }),
      "utf8",
    ),
    contentType: "application/json",
  });
});
