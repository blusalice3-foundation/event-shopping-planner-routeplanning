import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { BlockDefinition, DayMapData } from "../../src/types/map";

// Browser/engine compatibility; physical IME, software keyboard and PWA checks
// remain separate. Keep the production persistence Worker enabled.
test.use({ serviceWorkers: "block" });
test.describe.configure({ timeout: 90_000 });

const eventName = "ブロック編集の整合性確認";
const mapName = "1日目マップ";
type Backup = {
  data: {
    mapData: Record<string, Record<string, DayMapData>>;
    eventLists: Record<string, unknown[]>;
    executeModeItems: Record<string, Record<string, string[]>>;
  };
};

function createMap(): DayMapData {
  const cells: DayMapData["cells"] = [
    { row: 1, col: 1, value: "b" },
    { row: 2, col: 2, value: 1 },
    { row: 3, col: 3, value: " 2 " },
    { row: 2, col: 3, value: 99, isMerged: true },
  ].map((cell) => ({
    ...cell,
    backgroundColor: null,
    borders: { top: null, right: null, bottom: null, left: null },
  }));
  const block = (name: string, id?: string): BlockDefinition => ({
    ...(id ? { id } : {}),
    name,
    startRow: 1,
    startCol: 1,
    endRow: 4,
    endCol: 4,
    color: "#E3F2FD",
    numberCells: [
      { row: 2, col: 2, value: 1 },
      { row: 3, col: 3, value: 2 },
    ],
    ...(name === "b" ? { nameCells: [{ row: 1, col: 1 }] } : {}),
    isAutoDetected: true,
  });
  return {
    maxRow: 8,
    maxCol: 8,
    cells,
    mergedCells: [],
    blocks: [block("b", "stable-b-id"), block("B"), block("ヤ")],
  };
}

function createBackup(map = createMap()) {
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-11-10T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: {
        [eventName]: [
          {
            id: "block-item",
            eventDate: "1日目",
            circle: "ユーザー登録",
            title: "正常な品目を保持",
            block: "b",
            number: "1",
            price: 500,
            quantity: 2,
            purchaseStatus: "None",
            remarks: "エラーが発生しました",
          },
        ],
      },
      eventMetadata: {},
      executeModeItems: { [eventName]: { "1日目": ["block-item"] } },
      dayModes: { [eventName]: { "1日目": "edit" } },
      mapData: { [eventName]: { [mapName]: map } },
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
}

async function restore(page: Page, map = createMap()) {
  await page.goto("/");
  await page.getByLabel("バックアップファイルを選択").setInputFiles({
    name: "integrated-block-remediation.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(createBackup(map)), "utf8"),
  });
  const restoreDialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
    exact: true,
  });
  await restoreDialog.getByRole("radio", { name: /同名で置換/ }).check();
  await restoreDialog
    .getByRole("button", { name: "置換して復元", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: `「${eventName}」の復元内容を確認`,
    exact: true,
  });
  await expect
    .poll(
      async () =>
        (await review.isVisible()) || !(await restoreDialog.isVisible()),
    )
    .toBe(true);
  if (await review.isVisible())
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
  await expect(restoreDialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
  expect(
    page
      .workers()
      .some((worker) => worker.url().includes("persistence.worker")),
  ).toBe(true);
}

async function openBlocks(page: Page) {
  const mapToggle = page.getByTitle("マップ表示に切り替え", { exact: true });
  if (await mapToggle.count()) await mapToggle.click();
  // Exercise the existing long-press menu without changing touch/OS handling.
  await page
    .getByTitle("リスト表示に切り替え", { exact: true })
    .click({ delay: 650 });
  await page
    .getByRole("button", { name: "🔲 ブロック定義", exact: true })
    .click();
  const panel = page.getByRole("dialog", { name: "ブロック定義", exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

function blockButton(panel: Locator, name: string) {
  return panel.locator("button").filter({
    has: panel
      .page()
      .locator("span")
      .filter({ hasText: new RegExp(`^${name}$`) }),
  });
}

async function mapsInDatabase(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown[]>((resolve, reject) => {
        const request = database
          .transaction("mapData", "readonly")
          .objectStore("mapData")
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

async function watchInnerWrites(page: Page) {
  const worker = page
    .workers()
    .find((candidate) => candidate.url().includes("persistence.worker"));
  if (!worker) throw new Error("Production persistence Worker is required.");
  await worker.evaluate(() => {
    let writes = 0;
    Object.defineProperty(globalThis, "__blockEditorWrites", {
      get: () => writes,
    });
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      ...args: Parameters<typeof original>
    ) {
      if (args[1] === "readwrite") writes += 1;
      return original.apply(this, args);
    };
  });
  return () =>
    worker.evaluate(
      () =>
        (globalThis as unknown as { __blockEditorWrites: number })
          .__blockEditorWrites,
    );
}

async function applyAndSave(page: Page, panel: Locator) {
  await panel.getByRole("button", { name: "適用", exact: true }).click();
  await expect(panel).toBeHidden();
  const confirmation = page.getByRole("button", {
    name: "確認して保存",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation.click();
  await expect(confirmation).toBeHidden();
  await expect(page.getByRole("status", { name: /^保存済み/ })).toBeVisible();
}

async function exportBackup(page: Page): Promise<Backup> {
  const list = page.getByRole("button", { name: "イベント一覧", exact: true });
  if (await list.count()) await list.click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONバックアップ保存", exact: true })
    .click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  if (!stream) throw new Error("JSON backup stream missing.");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Backup;
}

for (const mode of ["通常", "壁", "複数範囲"] as const) {
  test(`incomplete same-name ${mode} addition never removes the original definition`, async ({
    page,
  }) => {
    await restore(page);
    const original = await mapsInDatabase(page);
    const panel = await openBlocks(page);
    const writes = await watchInnerWrites(page);
    await panel.getByRole("button", { name: "+ 新規", exact: true }).click();
    await panel.getByPlaceholder("例: ア, め, N").fill("b");
    if (mode !== "通常")
      await panel.getByRole("button", { name: mode, exact: true }).click();
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.type());
      await dialog.accept();
    });
    await panel.getByRole("button", { name: "追加", exact: true }).click();
    expect(dialogs).toEqual(["alert"]);
    await expect(panel.getByPlaceholder("例: ア, め, N")).toHaveValue("b");
    await panel
      .getByRole("button", { name: "キャンセル", exact: true })
      .first()
      .click();
    await expect(
      panel.getByText("定義済みブロック (3件)", { exact: true }),
    ).toBeVisible();
    await expect(blockButton(panel, "b")).toBeVisible();
    expect(await writes()).toBe(0);
    expect(await mapsInDatabase(page)).toEqual(original);
    await panel.getByRole("button", { name: "適用", exact: true }).click();
    await expect(panel).toBeHidden();
    await page.reload();
    const saved = await exportBackup(page);
    expect(saved.data.mapData[eventName][mapName].blocks).toEqual(
      createMap().blocks,
    );
  });
}

const selectionPaths = [
  {
    key: "corner",
    mode: "通常",
    start: "マップ上で4つの角をクリックして選択",
    cells: [
      { row: 2, col: 2 },
      { row: 2, col: 4 },
      { row: 4, col: 4 },
      { row: 4, col: 2 },
    ],
  },
  {
    key: "multiCorner",
    mode: "複数範囲",
    start: "マップ上で4つの角をクリックして範囲を追加",
    cells: [
      { row: 2, col: 2 },
      { row: 2, col: 4 },
      { row: 4, col: 4 },
      { row: 4, col: 2 },
    ],
  },
  {
    key: "rangeStart",
    mode: "壁",
    start: "+ 範囲追加",
    cells: [
      { row: 2, col: 2 },
      { row: 4, col: 4 },
    ],
  },
  {
    key: "individual",
    mode: "壁",
    start: "+ 個別追加",
    cells: [
      { row: 2, col: 2 },
      { row: 3, col: 3 },
    ],
  },
] as const;

for (const path of selectionPaths) {
  test(`${path.key} cancel and confirm preserve the original target and unapplied blocks after a descending start`, async ({
    page,
  }) => {
    await restore(page);
    const before = await mapsInDatabase(page);
    const panel = await openBlocks(page);
    const writes = await watchInnerWrites(page);
    await blockButton(panel, "b").click();
    await panel.getByPlaceholder("例: ア, め, N").fill("b保存済み");
    await panel.getByRole("button", { name: "保存", exact: true }).click();
    await panel.getByRole("button", { name: "↑昇順", exact: true }).click();
    await blockButton(panel, "B").click();
    await panel.getByPlaceholder("例: ア, め, N").fill("B選択中");
    if (path.mode !== "通常")
      await panel.getByRole("button", { name: path.mode, exact: true }).click();
    await panel.getByRole("button", { name: path.start, exact: true }).click();
    await expect(panel).toBeHidden();
    await page.getByRole("button", { name: "キャンセル", exact: true }).click();
    await expect(panel.getByPlaceholder("例: ア, め, N")).toHaveValue(
      "B選択中",
    );
    await panel.getByRole("button", { name: "一覧", exact: true }).click();
    // Keep the existing display-direction reset on remount. The edit target
    // must remain B even though selection began with the descending list.
    await expect(
      panel.getByRole("button", { name: "↑昇順", exact: true }),
    ).toBeVisible();
    await expect(blockButton(panel, "b保存済み")).toBeVisible();
    await panel.getByRole("button", { name: "編集", exact: true }).click();
    await panel.getByPlaceholder("例: ア, め, N").fill("B確定後");
    await panel.getByRole("button", { name: path.start, exact: true }).click();
    for (const cell of path.cells) {
      // Shared App cell-selection event; gesture/physical-device verification is separate.
      await page.evaluate(
        (detail) =>
          window.dispatchEvent(new CustomEvent("mapCellClick", { detail })),
        cell,
      );
    }
    await page.getByRole("button", { name: "選択を確定", exact: true }).click();
    await expect(panel.getByPlaceholder("例: ア, め, N")).toHaveValue(
      "B確定後",
    );
    if (path.key === "multiCorner")
      await expect(panel.getByText(/^範囲1:/)).toHaveCount(1);
    if (path.key === "rangeStart")
      await expect(
        panel.getByText("範囲(2,2)-(4,4)", { exact: true }),
      ).toHaveCount(1);
    if (path.key === "individual")
      await expect(panel.getByText("個別2セル", { exact: true })).toHaveCount(
        1,
      );
    await panel.getByRole("button", { name: "保存", exact: true }).click();
    expect(await writes()).toBe(0);
    expect(await mapsInDatabase(page)).toEqual(before);
    await expect(blockButton(panel, "B確定後")).toBeVisible();
    await expect(blockButton(panel, "b保存済み")).toBeVisible();
    await applyAndSave(page, panel);
    const saved = await exportBackup(page);
    const blocks = saved.data.mapData[eventName][mapName].blocks;
    expect(blocks).toHaveLength(3);
    expect(blocks.find((block) => block.name === "ヤ")).toEqual(
      createMap().blocks[2],
    );
    expect(blocks.find((block) => block.name === "b保存済み")).toEqual({
      ...createMap().blocks[0],
      name: "b保存済み",
      nameCells: undefined,
      isAutoDetected: false,
      isWallBlock: false,
    });
    const selected = blocks.find((block) => block.name === "B確定後");
    expect(selected).toMatchObject({
      startRow: 2,
      startCol: 2,
      endRow: path.key === "individual" ? 3 : 4,
      endCol: path.key === "individual" ? 3 : 4,
      numberCells: [
        { row: 2, col: 2, value: 1 },
        { row: 3, col: 3, value: 2 },
      ],
      isAutoDetected: false,
      isWallBlock: path.mode === "壁",
    });
    expect(selected).not.toHaveProperty("id");
    expect(selected).not.toHaveProperty("nameCells");
    if (path.mode !== "通常") expect(selected?.cellGroups).toHaveLength(1);
    else expect(selected).not.toHaveProperty("cellGroups");
    await page.reload();
    const reloaded = await exportBackup(page);
    expect(reloaded.data.mapData).toEqual(saved.data.mapData);
  });
}

test("execution mode omits block sorting while edit candidate sorting and header geometry remain intact", async ({
  page,
}) => {
  await restore(page);
  const before = createBackup();
  for (let direction = 0; direction < 3; direction += 1) {
    if (direction > 0) {
      await page.getByTitle("編集モード", { exact: true }).click();
      await page.getByTitle(/^候補ブロック.*並べ替え$/).click();
    }
    await page.getByTitle("実行モード", { exact: true }).click();
    await expect(
      page.getByRole("heading", { name: eventName, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /^ブロック(?:番号で|を昇順で|を降順で)並べ替え$/,
      }),
    ).toHaveCount(0);
    const header = page.getByTestId("app-shell-header");
    const height = await header.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    expect(height).toBeGreaterThan(0);
    await expect
      .poll(() => page.locator("html").getAttribute("data-app-header-height"))
      .toBe(`${height}px`);
  }
  await page.getByTitle("編集モード", { exact: true }).click();
  await expect(page.getByTitle(/^候補ブロック.*並べ替え$/)).toBeVisible();
  const saved = await exportBackup(page);
  expect(saved.data.eventLists).toEqual(before.data.eventLists);
  expect(saved.data.executeModeItems).toEqual(before.data.executeModeItems);
  expect(saved.data.mapData).toEqual(before.data.mapData);
});
// Exact map extracted through the baseline production import/Worker/export path
// from the attachment copy; provenance and hashes are beside the gzip fixture.
const attachmentMap = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL("../fixtures/block-edit-115-map.json.gz", import.meta.url),
    ),
  ).toString("utf8"),
) as DayMapData;

for (const changeSort of [false, true]) {
  test(`actual 115-block map changes only b after edit${changeSort ? " and ascending/descending roundtrips" : " without sorting"}`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    expect(attachmentMap.blocks).toHaveLength(115);
    const original = attachmentMap.blocks.find((block) => block.name === "b");
    if (!original) throw new Error("Actual b definition missing.");
    await restore(page, attachmentMap);
    const panel = await openBlocks(page);
    const writes = await watchInnerWrites(page);
    await blockButton(panel, "b").click();
    await panel.getByPlaceholder("例: ア, め, N").fill("b監査");
    if (changeSort) {
      await panel.getByRole("button", { name: "一覧", exact: true }).click();
      await panel.getByRole("button", { name: "↑昇順", exact: true }).click();
      await panel.getByRole("button", { name: "↓降順", exact: true }).click();
      await panel.getByRole("button", { name: "↑昇順", exact: true }).click();
      await panel.getByRole("button", { name: "編集", exact: true }).click();
    }
    await panel.getByRole("button", { name: "保存", exact: true }).click();
    await expect(blockButton(panel, "b監査")).toBeVisible();
    await expect(blockButton(panel, "b")).toHaveCount(0);
    await expect(blockButton(panel, "B")).toBeVisible();
    await expect(blockButton(panel, "ヤ")).toBeVisible();
    expect(await writes()).toBe(0);
    await applyAndSave(page, panel);
    const saved = await exportBackup(page);
    const map = saved.data.mapData[eventName][mapName];
    const expectedTarget: BlockDefinition = {
      ...original,
      name: "b監査",
      isAutoDetected: false,
      isWallBlock: false,
    };
    delete expectedTarget.nameCells;
    // The new name has no matching map cell. Numeric cells and geometry are
    // unchanged, while every non-target definition must be byte-for-byte equal.
    const expectedBlocks = attachmentMap.blocks.map((block) =>
      block.name === "b" ? expectedTarget : block,
    );
    expect(map.blocks).toEqual(expectedBlocks);
    expect(map.blocks).toHaveLength(115);
    expect(
      map.blocks.find((block) => block.name === "b監査"),
    ).not.toHaveProperty("nameCells");
    expect(map.cells).toEqual(attachmentMap.cells);
    await page.reload();
    const reloaded = await exportBackup(page);
    expect(reloaded.data.mapData[eventName][mapName]).toEqual(map);
    expect(errors).toEqual([]);
  });
}
