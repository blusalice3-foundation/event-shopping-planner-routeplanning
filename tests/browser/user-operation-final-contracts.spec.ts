import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import type { EventConsistencyStore } from "../../src/types/consistency";

const eventName = "操作最終契約";
const item = (id: string, eventDate = "1日目", purchaseStatus = "None") => ({
  id,
  eventDate,
  circle: `サークル${id}`,
  title: `新刊${id}`,
  block: "A",
  number: id,
  price: 500,
  quantity: 1,
  purchaseStatus,
  remarks: "ユーザー登録",
});
const backup = (items = [item("1"), item("2", "2日目")]) => ({
  kind: "event-shopping-planner-backup",
  version: 1,
  exportedAt: "2026-10-19T00:00:00.000Z",
  eventSettings: { blockDetectionSettings: {} },
  data: {
    eventLists: { [eventName]: items },
    eventMetadata: {},
    executeModeItems: {
      [eventName]: Object.fromEntries(
        ["1日目", "2日目"].map((day) => [
          day,
          items
            .filter((entry) => entry.eventDate === day)
            .map((entry) => entry.id),
        ]),
      ),
    },
    dayModes: { [eventName]: { "1日目": "edit", "2日目": "edit" } },
    mapData: {},
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallDefinitions: {},
    hallRouteSettings: {},
  },
});

async function restore(page: Page, source: unknown) {
  await page.goto("/");
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "final-contracts.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(source), "utf8"),
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

async function stored<T = unknown>(page: Page, storeName: string): Promise<T> {
  return page.evaluate(async (storeName) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const store = database
          .transaction(storeName, "readonly")
          .objectStore(storeName);
        const request = store.get("data");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          if (request.result?.kind !== "event-shopping-planner-day-records") {
            resolve(request.result);
            return;
          }
          const prefix = "__esp_internal__:day-record:v1:";
          const rows: Array<{
            eventName: string;
            path: string[];
            value: unknown;
          }> = [];
          const cursor = store.openCursor(
            IDBKeyRange.bound(prefix, prefix + "\uffff"),
          );
          cursor.onerror = () => reject(cursor.error);
          cursor.onsuccess = () => {
            const entry = cursor.result;
            if (entry) {
              rows.push(entry.value);
              entry.continue();
              return;
            }
            const data: Record<string, Record<string, unknown>> = {};
            for (const row of rows.filter((row) => !row.path.length))
              Object.defineProperty(data, row.eventName, {
                value: row.value,
                enumerable: true,
              });
            for (const row of rows.filter((row) => row.path.length)) {
              const parent =
                row.path.length === 2
                  ? (data[row.eventName].days as Record<string, unknown>)
                  : data[row.eventName];
              Object.defineProperty(parent, row.path.at(-1)!, {
                value: row.value,
                enumerable: true,
              });
            }
            resolve(data);
          };
        };
      });
    } finally {
      database.close();
    }
  }, storeName) as Promise<T>;
}

async function storedMaps(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Record<string, Record<string, unknown>>>(
        (resolve, reject) => {
          const maps: Record<string, Record<string, unknown>> = {};
          const request = database
            .transaction("mapData", "readonly")
            .objectStore("mapData")
            .openCursor();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const row = request.result;
            if (!row) return resolve(maps);
            if (String(row.key).startsWith("mapData:")) {
              const [event, map] = JSON.parse(
                String(row.key).slice("mapData:".length),
              ) as [string, string];
              (maps[event] ??= {})[map] = row.value;
            }
            row.continue();
          };
        },
      );
    } finally {
      database.close();
    }
  });
}

async function openMapTool(page: Page, name: string) {
  await page.getByTitle("リスト表示に切り替え", { exact: true }).hover();
  await page.mouse.down();
  const action = page.getByRole("button", { name, exact: true });
  await expect(action).toBeVisible();
  await page.mouse.up();
  await action.click();
}

async function importMapFile(page: Page, buffer: Buffer) {
  const input = page.locator('input[type="file"][accept=".xlsx"]').first();
  await input.evaluate((element, name) => {
    (element as HTMLInputElement).dataset.eventName = name;
  }, eventName);
  await input.setInputFiles({
    name: "same-map.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  const heading = page.getByRole("heading", {
    name: "📋 マップデータ取り込み",
  });
  await expect(heading).toBeVisible();
  await page.getByRole("button", { name: "取り込む", exact: true }).click();
  const target = page.getByRole("dialog", {
    name: "マップを入れ替える前の確認",
  });
  const review = page.getByRole("dialog", {
    name: "マップ再取り込みの影響を確認",
    exact: true,
  });
  await expect
    .poll(async () => {
      if (await target.isVisible()) return "target";
      if (await review.isVisible()) return "review";
      return (await heading.isVisible()) ? "waiting" : "saved";
    })
    .not.toBe("waiting");
  if (await target.isVisible()) {
    await target
      .getByRole("button", { name: "影響を確認せずに取り込む", exact: true })
      .click();
    await expect(target).toBeHidden();
  }
  if (await review.isVisible()) {
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
    await expect(review).toBeHidden();
  }
  await expect(heading).toBeHidden();
}

async function startSelection(
  page: Page,
  kind: "block" | "hall",
  name: string,
) {
  await openMapTool(
    page,
    kind === "block" ? "🔲 ブロック定義" : "🏛️ ホール定義",
  );
  await page.getByRole("button", { name: "+ 新規", exact: true }).click();
  await page
    .getByPlaceholder(kind === "block" ? "例: ア, め, N" : "例: 東1ホール")
    .fill(name);
  await page
    .getByRole("button", {
      name:
        kind === "block"
          ? "マップ上で4つの角をクリックして選択"
          : "マップ上で頂点を選択",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(`「${name}」設定中`, { exact: true }),
  ).toBeVisible();
}

for (const kind of ["block", "hall"] as const) {
  test(`OP01 identical same-key map reimport completes and rejects old ${kind} callbacks in a new session`, async ({
    page,
  }) => {
    await restore(page, backup());
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("1日目");
    const border = { style: "medium" as const, color: { argb: "FFFF0000" } };
    sheet.getCell("A1").value = "A";
    sheet.getCell("A1").border = { top: border, bottom: border, left: border };
    sheet.getCell("B1").value = 1;
    sheet.getCell("B1").border = { top: border, bottom: border, right: border };
    sheet.getCell("F6").value = "同一地図";
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await importMapFile(page, buffer);
    await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
    const beforeMaps = await storedMaps(page);
    expect(Object.keys(beforeMaps[eventName])).toEqual(["1日目マップ"]);
    const beforeItems = await stored(page, "eventLists");
    const beforeHalls = await stored(page, "hallDefinitions");
    await page.evaluate(() => {
      const listeners = new Set<EventListenerOrEventListenerObject>();
      const removed = new Set<EventListenerOrEventListenerObject>();
      let captured: EventListenerOrEventListenerObject[] = [];
      const originalAdd = window.addEventListener;
      const originalRemove = window.removeEventListener;
      window.addEventListener = function (
        ...args: Parameters<typeof window.addEventListener>
      ) {
        if (args[0] === "mapCellClick" && args[1]) listeners.add(args[1]);
        return originalAdd.apply(window, args);
      } as typeof window.addEventListener;
      window.removeEventListener = function (
        ...args: Parameters<typeof window.removeEventListener>
      ) {
        if (args[0] === "mapCellClick" && args[1]) {
          listeners.delete(args[1]);
          if (captured.includes(args[1])) removed.add(args[1]);
        }
        return originalRemove.apply(window, args);
      } as typeof window.removeEventListener;
      Object.assign(window, {
        __captureOldMapCallbacks: () => {
          window.addEventListener = originalAdd;
          captured = [...listeners];
          Object.assign(window, { __oldMapCallbacks: captured });
          return captured.length;
        },
        __finishOldMapCallbacks: () => {
          window.removeEventListener = originalRemove;
          return captured.filter((callback) => removed.has(callback)).length;
        },
      });
    });
    await startSelection(page, kind, "旧sessionの下書き");
    const countText = (count: number) =>
      kind === "block"
        ? `セルをクリックして角を選択 (${count}/4)`
        : `ホールの頂点をクリック (${count}/6)`;
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("mapCellClick", { detail: { row: 1, col: 1 } }),
      ),
    );
    await expect(page.getByText(countText(1), { exact: true })).toBeVisible();
    const captured = await page.evaluate(() =>
      (
        window as unknown as { __captureOldMapCallbacks(): number }
      ).__captureOldMapCallbacks(),
    );
    expect(captured).toBeGreaterThan(0);
    page.once("dialog", (dialog) => dialog.accept());
    await importMapFile(page, buffer);
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { __finishOldMapCallbacks(): number }
        ).__finishOldMapCallbacks(),
      ),
    ).toBe(captured);
    await expect(
      page.getByText("「旧sessionの下書き」設定中", { exact: true }),
    ).toHaveCount(0);
    expect(await storedMaps(page)).toEqual(beforeMaps);
    expect(await stored(page, "eventLists")).toEqual(beforeItems);
    expect(await stored(page, "hallDefinitions")).toEqual(beforeHalls);
    await startSelection(page, kind, "新sessionの下書き");
    await expect(page.getByText(countText(0), { exact: true })).toBeVisible();
    // A current event must change this exact counter; the old event below must not.
    for (const count of [1, 0]) {
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent("mapCellClick", { detail: { row: 4, col: 4 } }),
        ),
      );
      await expect(
        page.getByText(countText(count), { exact: true }),
      ).toBeVisible();
    }
    for (let index = 0; index < captured; index++) {
      await page.evaluate(async (index) => {
        const callback = (
          window as unknown as {
            __oldMapCallbacks: EventListenerOrEventListenerObject[];
          }
        ).__oldMapCallbacks[index];
        const event = new CustomEvent("mapCellClick", {
          detail: { row: 4, col: 4 },
        });
        if (typeof callback === "function") callback.call(window, event);
        else callback.handleEvent(event);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => setTimeout(resolve, 0)),
        );
      }, index);
      // Observe each stale callback separately so repeated toggles cannot cancel out.
      await expect(page.getByText(countText(0), { exact: true })).toBeVisible();
    }
    await expect(
      page.getByText("「新sessionの下書き」設定中", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "キャンセル", exact: true }).click();
    await expect(
      page.getByPlaceholder(
        kind === "block" ? "例: ア, め, N" : "例: 東1ホール",
      ),
    ).toHaveValue("新sessionの下書き");
    expect(await storedMaps(page)).toEqual(beforeMaps);
    expect(await stored(page, "hallDefinitions")).toEqual(beforeHalls);
    await page.reload();
    await expect(
      page.locator('input[aria-label="バックアップファイルを選択"]'),
    ).toBeAttached();
    expect(await storedMaps(page)).toEqual(beforeMaps);
    expect(await stored(page, "eventLists")).toEqual(beforeItems);
  });
}

test("OP02 simple halls sync twice with committed display IDs and retain day-specific visits after reload", async ({
  page,
}) => {
  const original = backup([item("1"), item("2", "2日目")]);
  const source = {
    ...original,
    data: {
      ...original.data,
      hallDefinitions: {
        [eventName]: Object.fromEntries(
          ["1日目", "2日目"].map((day) => [
            `__mapless__:${day}`,
            [
              {
                id: "simple",
                name: day === "1日目" ? "元の簡易ホール" : "同期先の簡易ホール",
                vertices: [],
                blockNames: ["A"],
              },
            ],
          ]),
        ),
      },
      hallRouteSettings: {
        [eventName]: {
          "__mapless__:1日目": {
            hallOrder: ["simple"],
            hallVisitLists: [{ hallId: "simple", itemIds: ["1"] }],
          },
          "__mapless__:2日目": {
            hallOrder: ["simple"],
            hallVisitLists: [{ hallId: "simple", itemIds: ["2"] }],
          },
        },
      },
    },
  };
  await restore(page, source);
  const beforeItems = await stored(page, "eventLists");
  await page.getByTitle("ホール定義（ブロック割当）", { exact: true }).click();
  const panel = page.getByRole("dialog", {
    name: "ホール定義（ブロック割当）",
    exact: true,
  });
  let currentName = "元の簡易ホール";
  for (const name of ["一度目の簡易ホール", "二度目の簡易ホール"]) {
    await panel.getByRole("button").filter({ hasText: currentName }).click();
    await panel.getByPlaceholder("例: 東1ホール").fill(name);
    await panel.getByRole("button", { name: "確定", exact: true }).click();
    await panel
      .getByRole("button", { name: "他の日に同期", exact: true })
      .click();
    await panel.getByRole("checkbox", { name: "2日目", exact: true }).check();
    page.once("dialog", (dialog) => dialog.accept());
    await panel.getByRole("button", { name: /選択した日に同期/ }).click();
    const confirm = page.getByRole("button", {
      name: "確認して保存",
      exact: true,
    });
    await expect
      .poll(async () => {
        if (await confirm.isVisible()) return "review";
        const definitions = await stored<
          Record<string, Record<string, Array<{ name: string }>>>
        >(page, "hallDefinitions");
        return definitions[eventName]?.["__mapless__:2日目"]?.[0]?.name === name
          ? "saved"
          : "waiting";
      })
      .not.toBe("waiting");
    if (await confirm.isVisible()) await confirm.click();
    await expect
      .poll(() => stored(page, "hallDefinitions"))
      .toMatchObject({
        [eventName]: {
          "__mapless__:1日目": [
            expect.objectContaining({ id: "simple", name, blockNames: ["A"] }),
          ],
          "__mapless__:2日目": [
            expect.objectContaining({ name, blockNames: ["A"] }),
          ],
        },
      });
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("button").filter({ hasText: name }),
    ).toBeVisible();
    const saved = await stored<EventConsistencyStore>(page, "eventConsistency");
    for (const [day, id] of [
      ["1日目", "1"],
      ["2日目", "2"],
    ]) {
      const context = saved[eventName].days[day].mapless!;
      const definitions = await stored<
        Record<string, Record<string, Array<{ id: string }>>>
      >(page, "hallDefinitions");
      const hallId = definitions[eventName][`__mapless__:${day}`][0].id;
      expect(hallId.startsWith("@hall:")).toBe(false);
      expect(context.hallOrder).toEqual([
        { hall: { kind: "simple", dayKey: day, hallId }, priority: "none" },
      ]);
      expect(context.hallVisitLists).toEqual([
        expect.objectContaining({ itemIds: [id], group: context.hallOrder[0] }),
      ]);
    }
    currentName = name;
  }
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await expect(panel).toBeHidden();
  const definitions = await stored(page, "hallDefinitions");
  const consistency = await stored(page, "eventConsistency");
  expect(await stored(page, "eventLists")).toEqual(beforeItems);
  await page.reload();
  await page.getByText(eventName, { exact: true }).click();
  await page.getByTitle("ホール定義（ブロック割当）", { exact: true }).click();
  await expect(
    panel.getByRole("button").filter({ hasText: "二度目の簡易ホール" }),
  ).toBeVisible();
  expect(await stored(page, "hallDefinitions")).toEqual(definitions);
  expect(await stored(page, "eventConsistency")).toEqual(consistency);
  expect(await stored(page, "eventLists")).toEqual(beforeItems);
});

const mapBackup = () => {
  const source = backup([item("1"), item("2"), item("3"), item("4", "2日目")]);
  return {
    ...source,
    data: {
      ...source.data,
      mapData: {
        [eventName]: {
          "1日目マップ": {
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
                numberCells: [
                  { row: 2, col: 2, value: 1 },
                  { row: 3, col: 2, value: 2 },
                  { row: 4, col: 2, value: 3 },
                ],
              },
            ],
          },
        },
      },
    },
  };
};

async function openCardMenu(page: Page, id: string) {
  const card = page
    .locator(`[data-item-id="${id}"]`)
    .first()
    .locator(":scope > div.rounded-lg")
    .first();
  await card.dispatchEvent("pointerdown", {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
  });
  await expect(
    page.getByRole("button", { name: "削除", exact: true }),
  ).toBeVisible();
  await card.dispatchEvent("pointerup", {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
  });
}

async function deleteCard(page: Page, id: string) {
  await openCardMenu(page, id);
  await page.getByRole("button", { name: "削除", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "アイテムを削除",
    exact: true,
  });
  await dialog.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () =>
      (await stored<Record<string, Array<{ id: string }>>>(page, "eventLists"))[
        eventName
      ].map((entry) => entry.id),
    )
    .not.toContain(id);
}

test("OP08 deleting the selected swap visit via the map popup rejects index reuse and preserves other visits", async ({
  page,
}) => {
  await restore(page, mapBackup());
  const beforeItems = await stored<Record<string, Array<{ id: string }>>>(
    page,
    "eventLists",
  );
  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  await openMapTool(page, "📍 訪問リスト");
  const rows = page.locator("[data-drag-item]");
  await expect(rows).toHaveCount(3);
  await page.getByRole("button", { name: "入れ替え", exact: true }).click();
  await rows.filter({ hasText: "サークル1" }).click();
  await expect(
    page.getByText("2つ目を選択してください（同一グループ内）", {
      exact: true,
    }),
  ).toBeVisible();
  await page.locator("canvas").click({ position: { x: 42, y: 42 } });
  const popup = page.getByRole("dialog", {
    name: "A-1のアイテム一覧",
    exact: true,
  });
  await expect(popup).toBeVisible();
  const card = popup
    .getByText("サークル1", { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"cursor-pointer")][1]');
  await card.dispatchEvent("pointerdown", {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
  });
  const remove = page.getByRole("button", { name: "🗑️ 削除", exact: true });
  await expect(remove).toBeVisible();
  await card.dispatchEvent("pointerup", {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
  });
  await remove.click();
  const deletion = page.getByRole("dialog", {
    name: "アイテムを削除",
    exact: true,
  });
  await deletion.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(deletion).toBeHidden();
  await expect(rows).toHaveCount(2);
  const closePopup = page.getByRole("button", {
    name: "A-1のアイテム一覧を閉じる",
    exact: true,
  });
  if (await closePopup.isVisible()) await closePopup.click();
  await rows.filter({ hasText: "サークル3" }).click();
  await expect(
    page.getByText("2つ目を選択してください（同一グループ内）", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect
    .poll(() => stored(page, "executeModeItems"))
    .toMatchObject({ [eventName]: { "1日目": ["2", "3"], "2日目": ["4"] } });
  await expect(rows.first()).toContainText("サークル2");
  expect(await stored(page, "eventLists")).toEqual({
    [eventName]: beforeItems[eventName].filter((entry) => entry.id !== "1"),
  });
  await page.getByRole("button", { name: "確定", exact: true }).click();
  await expect(
    page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }),
  ).toBeDisabled();
  await page.reload();
  await page.getByText(eventName, { exact: true }).click();
  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  await openMapTool(page, "📍 訪問リスト");
  await expect(rows.first()).toContainText("サークル2");
  expect(await stored(page, "executeModeItems")).toMatchObject({
    [eventName]: { "1日目": ["2", "3"] },
  });
});

async function enterLatePhase(page: Page) {
  await page.getByTitle("集中モード", { exact: true }).click();
  await page.getByLabel("phase", { exact: true }).selectOption("late");
  const dialog = page.getByRole("dialog", {
    name: "フェーズを切り替えますか？",
    exact: true,
  });
  await dialog.getByRole("button", { name: /最初から開始/ }).click();
  await expect(page.getByLabel("phase", { exact: true })).toHaveValue("late");
}

test("OP09 deleting the last late target completes and preserves earlier phases and another day", async ({
  page,
}) => {
  const source = backup([
    item("1"),
    item("2", "1日目", "Late"),
    item("4", "2日目"),
  ]);
  source.data.dayModes[eventName]["1日目"] = "execute";
  await restore(page, source);
  const secondDay = (
    await stored<EventConsistencyStore>(page, "eventConsistency")
  )[eventName].days["2日目"];
  await enterLatePhase(page);
  await expect(page.locator('[data-item-id="2"]')).toBeVisible();
  await deleteCard(page, "2");
  await expect(
    page.getByText("全ての訪問先を確認しました", { exact: true }),
  ).toBeVisible();
  const remaining = [item("1"), item("4", "2日目")];
  expect(await stored(page, "eventLists")).toEqual({ [eventName]: remaining });
  expect(await stored(page, "executeModeItems")).toMatchObject({
    [eventName]: { "1日目": ["1"], "2日目": ["4"] },
  });
  expect(
    (await stored<EventConsistencyStore>(page, "eventConsistency"))[eventName]
      .days["2日目"],
  ).toEqual(secondDay);
  await page.reload();
  await expect(
    page.locator('input[aria-label="バックアップファイルを選択"]'),
  ).toBeAttached();
  expect(await stored(page, "eventLists")).toEqual({ [eventName]: remaining });
});

test("OP09 resume synchronizes a replacement late target before recovering an empty captured late phase", async ({
  page,
}) => {
  const source = backup([
    item("1"),
    item("2", "1日目", "Late"),
    item("3"),
    item("4", "2日目"),
  ]);
  source.data.dayModes[eventName]["1日目"] = "execute";
  await restore(page, source);
  const secondDay = (
    await stored<EventConsistencyStore>(page, "eventConsistency")
  )[eventName].days["2日目"];
  await enterLatePhase(page);
  await page.getByTitle("編集モード", { exact: true }).click();
  await expect(page.locator("#focus-mode-footer")).toBeHidden();
  await deleteCard(page, "2");
  await openCardMenu(page, "3");
  await page.getByRole("button", { name: "編集", exact: true }).click();
  const editor = page.getByRole("dialog", {
    name: "アイテム編集",
    exact: true,
  });
  await editor.getByLabel("購入状態", { exact: true }).selectOption("Late");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect
    .poll(() => stored(page, "eventLists"))
    .toMatchObject({
      [eventName]: expect.arrayContaining([
        expect.objectContaining({ id: "3", purchaseStatus: "Late" }),
      ]),
    });
  await page.evaluate(() => {
    const trace = { completionScreens: 0 };
    Object.assign(window, { __lateResumeTrace: trace });
    new MutationObserver(() => {
      if (document.body.textContent?.includes("全ての訪問先を確認しました"))
        trace.completionScreens++;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole("button", { name: "🏃‍♂️", exact: true }).click();
  await page.getByTitle("集中モード", { exact: true }).click();
  await expect(page.getByLabel("phase", { exact: true })).toHaveValue("late");
  await expect(page.locator('[data-item-id="3"]')).toBeVisible();
  await expect(page.locator('[data-item-id="2"]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __lateResumeTrace: { completionScreens: number };
          }
        ).__lateResumeTrace.completionScreens,
    ),
  ).toBe(0);
  await deleteCard(page, "3");
  await expect(
    page.getByText("全ての訪問先を確認しました", { exact: true }),
  ).toBeVisible();
  expect(await stored(page, "eventLists")).toEqual({
    [eventName]: [item("1"), item("4", "2日目")],
  });
  expect(
    (await stored<EventConsistencyStore>(page, "eventConsistency"))[eventName]
      .days["2日目"],
  ).toEqual(secondDay);
  await page.reload();
  await expect(
    page.locator('input[aria-label="バックアップファイルを選択"]'),
  ).toBeAttached();
  expect(await stored(page, "eventLists")).toEqual({
    [eventName]: [item("1"), item("4", "2日目")],
  });
});
