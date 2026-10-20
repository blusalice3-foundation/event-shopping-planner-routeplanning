import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { PersistenceSnapshot } from "../../src/app/ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../src/types/item";

const eventName = "0件イベントの追加再開";
const retainedMapName = "2日目マップ";
type EmptyEventOrigin = "empty-backup" | "delete-last" | "settings-only";
const observedStores = [
  "dayModes",
  "mapData",
  "mapRotationSettings",
  "mapViewportSettings",
  "routeSettings",
  "hallDefinitions",
  "hallRouteSettings",
  "eventConsistency",
] as const;
function backup(origin: EmptyEventOrigin) {
  const hasSettings = origin === "settings-only";
  const map = {
    maxRow: 6,
    maxCol: 6,
    cells: [],
    mergedCells: [],
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
  const hall = {
    id: "retained-hall",
    name: "保持する会場",
    blockNames: ["A"],
    vertices: [
      { row: 1, col: 1 },
      { row: 1, col: 5 },
      { row: 5, col: 5 },
      { row: 5, col: 1 },
    ],
  };
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-18T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: {
        [eventName]:
          origin === "delete-last"
            ? [
                {
                  id: "last-item",
                  circle: "削除するサークル",
                  title: "最後の品目",
                  eventDate: "1日目",
                  block: "A",
                  number: "1",
                  price: 500,
                  purchaseStatus: "None",
                  quantity: 1,
                  remarks: "ユーザー登録",
                },
              ]
            : [],
      },
      eventMetadata: {},
      executeModeItems:
        origin === "delete-last"
          ? { [eventName]: { "1日目": ["last-item"] } }
          : {},
      dayModes:
        origin === "empty-backup"
          ? {}
          : { [eventName]: { "1日目": "edit", "2日目": "edit" } },
      mapData: hasSettings ? { [eventName]: { [retainedMapName]: map } } : {},
      mapRotationSettings: hasSettings
        ? {
            [eventName]: {
              [retainedMapName]: {
                initialAngle: 0,
                mapTabAngle: 90,
                focusModeAngle: 180,
              },
            },
          }
        : {},
      mapViewportSettings: hasSettings
        ? {
            [eventName]: {
              [retainedMapName]: { zoomLevel: 1.5, offsetX: 12, offsetY: 24 },
            },
          }
        : {},
      routeSettings: hasSettings
        ? {
            [eventName]: {
              [retainedMapName]: { isRouteVisible: true, visitOrder: [] },
            },
          }
        : {},
      hallDefinitions: hasSettings
        ? { [eventName]: { [retainedMapName]: [hall] } }
        : {},
      hallRouteSettings: hasSettings
        ? {
            [eventName]: {
              [retainedMapName]: {
                hallOrder: [hall.id],
                hallVisitLists: [{ hallId: hall.id, itemIds: [] }],
              },
            },
          }
        : {},
    },
  };
}
async function installWriteObserver(page: Page) {
  await page.addInitScript(() => {
    Object.assign(window, { __manualItemCommands: [] as string[] });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes("persistence.worker")) return;
        const send = this.postMessage.bind(this);
        this.postMessage = (message: { method?: string }) => {
          if (message.method)
            (
              window as unknown as { __manualItemCommands: string[] }
            ).__manualItemCommands.push(message.method);
          send(message);
        };
      }
    };
  });
}
async function physicalSettings(page: Page) {
  return page.evaluate(
    async (stores) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("EventShoppingPlannerDB");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return Object.fromEntries(
          await Promise.all(
            stores.map(async (name) => [
              name,
              await new Promise<unknown[]>((resolve, reject) => {
                const request = database
                  .transaction(name, "readonly")
                  .objectStore(name)
                  .getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              }),
            ]),
          ),
        );
      } finally {
        database.close();
      }
    },
    [...observedStores],
  );
}
async function downloadSnapshot(page: Page) {
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONバックアップ保存", exact: true })
    .click();
  const file = await downloaded;
  return (
    JSON.parse(await readFile((await file.path())!, "utf8")) as {
      data: PersistenceSnapshot;
    }
  ).data;
}
async function acceptExistingSaveReview(page: Page) {
  const savedItem = page.getByText("追加後のサークル", { exact: true });
  const confirm = page.getByRole("button", {
    name: "確認して保存",
    exact: true,
  });
  await expect
    .poll(
      async () => (await savedItem.isVisible()) || (await confirm.isVisible()),
    )
    .toBe(true);
  if (!(await savedItem.isVisible())) {
    await confirm.click();
    await expect(confirm).toBeHidden();
  }
  await expect(savedItem).toBeVisible();
}
for (const origin of [
  "empty-backup",
  "delete-last",
  "settings-only",
] as const) {
  test(`reopens an empty event from ${origin}, preserves settings, adds a corrected manual item and reloads it`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installWriteObserver(page);
    await page.goto("/");
    await page
      .locator('input[aria-label="バックアップファイルを選択"]')
      .setInputFiles({
        name: `empty-event-${origin}.json`,
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(backup(origin)), "utf8"),
      });
    const restore = page.getByRole("dialog", {
      name: "バックアップからイベントを復元",
    });
    await restore.getByRole("radio", { name: /同名で置換/ }).check();
    await restore.getByRole("button", { name: "置換して復元" }).click();
    await expect(restore).toBeHidden();
    expect(
      page
        .workers()
        .some((worker) => worker.url().includes("persistence.worker")),
    ).toBe(true);
    if (origin === "delete-last") {
      const card = page
        .locator('[data-item-id="last-item"]')
        .locator(":scope > div.rounded-lg")
        .first();
      await expect(card).toBeVisible();
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
      await page.getByRole("button", { name: "削除", exact: true }).click();
      const deletion = page.getByRole("dialog", { name: "アイテムを削除" });
      await deletion.getByRole("button", { name: "Yes", exact: true }).click();
      await expect(deletion).toBeHidden();
      await expect(page.locator('[data-item-id="last-item"]')).toHaveCount(0);
      await page
        .getByRole("button", { name: "イベント一覧", exact: true })
        .click();
    }
    await expect(page.getByText(eventName, { exact: true })).toBeVisible();
    const before = await downloadSnapshot(page);
    expect(before.eventLists[eventName]).toEqual([]);
    if (origin === "settings-only") {
      expect(before.mapData[eventName][retainedMapName]).toBeDefined();
      expect(before.hallDefinitions[eventName][retainedMapName]).toHaveLength(
        1,
      );
      expect(
        before.eventConsistency[eventName].days["2日目"].maps[retainedMapName]
          .route?.isRouteVisible,
      ).toBe(true);
      expect(before.dayModes[eventName]["2日目"]).toBe("edit");
    }
    const beforeSelection = await physicalSettings(page);
    await page.evaluate(() => {
      (
        window as unknown as { __manualItemCommands: string[] }
      ).__manualItemCommands = [];
    });
    await page.getByText(eventName, { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "リストに追加", exact: true }),
    ).toBeVisible();
    expect(await physicalSettings(page)).toEqual(beforeSelection);
    await page
      .getByLabel("サークル名", { exact: true })
      .fill("追加後のサークル");
    await page.getByLabel("タイトル", { exact: true }).fill("再開した新刊");
    await page.getByLabel("備考", { exact: true }).fill("保持するメモ");
    await page.getByLabel("参加日", { exact: true }).selectOption("__custom__");
    await page.getByLabel("参加日", { exact: true }).fill("　 ");
    await page
      .getByRole("button", { name: "リストに追加", exact: true })
      .click();
    await expect(page.getByRole("alert")).toHaveText(
      "参加日を入力してください。",
    );
    await expect(page.getByLabel("参加日", { exact: true })).toBeFocused();
    await expect(page.getByLabel("タイトル", { exact: true })).toHaveValue(
      "再開した新刊",
    );
    await expect(page.getByLabel("備考", { exact: true })).toHaveValue(
      "保持するメモ",
    );
    const methods = await page.evaluate(
      () =>
        (window as unknown as { __manualItemCommands: string[] })
          .__manualItemCommands,
    );
    expect(
      methods.filter((method) =>
        [
          "commit",
          "commitDay",
          "day",
          "items",
          "saveEventLists",
          "saveExecuteModeItems",
        ].includes(method),
      ),
    ).toEqual([]);
    expect(await physicalSettings(page)).toEqual(beforeSelection);
    await page.getByLabel("参加日", { exact: true }).fill("前夜祭");
    await page
      .getByRole("button", { name: "リストに追加", exact: true })
      .click();
    await acceptExistingSaveReview(page);
    await expect(
      page.getByText("追加後のサークル", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "イベント一覧", exact: true })
      .click();
    const after = await downloadSnapshot(page);
    const saved = after.eventLists[eventName] as ShoppingItem[];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      eventDate: "前夜祭",
      circle: "追加後のサークル",
      remarks: "保持するメモ",
    });
    for (const store of observedStores.filter(
      (store) => store !== "eventConsistency",
    )) {
      const beforeEvent =
        (before[store] as Record<string, Record<string, unknown>>)[eventName] ??
        {};
      const afterEvent =
        (after[store] as Record<string, Record<string, unknown>>)[eventName] ??
        {};
      for (const [key, value] of Object.entries(beforeEvent))
        expect(afterEvent[key], `${store}.${key}`).toEqual(value);
    }
    for (const [day, value] of Object.entries(
      before.eventConsistency[eventName]?.days ?? {},
    )) {
      expect(
        after.eventConsistency[eventName].days[day],
        `retained consistency ${day}`,
      ).toEqual(value);
    }
    await page.reload();
    await page.getByText(eventName, { exact: true }).click();
    await expect(page.getByRole("button", { name: /^前夜祭/ })).toBeVisible();
    await expect(page.locator(`[data-item-id="${saved[0].id}"]`)).toBeVisible();
    await expect(
      page.getByText("追加後のサークル", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "利用者メモ", exact: true }),
    ).toHaveValue("保持するメモ");
    expect(errors).toEqual([]);
  });
}
