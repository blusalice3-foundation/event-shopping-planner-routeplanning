import { expect, test, type Page } from "@playwright/test";
import type { ShoppingItem } from "../../src/types/item";
import { readBrowserEventLists } from "./shopping-transfer-persisted-store";

const eventName = "実行配置ルール検証";
const day = "1日目";
const item = (
  id: string,
  block: string,
  number: string,
  priorityLevel: ShoppingItem["priorityLevel"] = "none",
): ShoppingItem => ({
  id,
  block,
  number,
  priorityLevel,
  eventDate: day,
  circle: id,
  title: id,
  price: 500,
  quantity: 2,
  purchaseStatus: "None",
  remarks: "ユーザー登録 エラーが発生しました",
});
const initialItems = [
  item("a1", "A", "01a"),
  item("b1", "A", "02a"),
  item("a2", "A", "01a2"),
  item("a3", "A", "01a3"),
  item("hall-b", "B", "01a"),
  item("merge-a", "A", "01a4"),
  item("new-a", "A", "03a"),
  item("mixed-b", "B", "02a"),
  item("priority-a", "A", "04a", "highest"),
];
const initialExecute = ["a1", "b1", "a2", "a3", "hall-b"];
const guideFillers = Array.from({ length: 16 }, (_, index) =>
  item(`guide-${index}`, "A", String(index + 10)),
);
function backup(guide = false) {
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-11-01T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: {
        [eventName]: guide ? [...initialItems, ...guideFillers] : initialItems,
      },
      eventMetadata: {},
      executeModeItems: {
        [eventName]: {
          [day]: guide
            ? [
                ...initialExecute.slice(0, -1),
                ...guideFillers.map((item) => item.id),
                "hall-b",
              ]
            : initialExecute,
        },
      },
      dayModes: { [eventName]: { [day]: "edit" } },
      mapData: {},
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {
        [eventName]: {
          [`__mapless__:${day}`]: [
            { id: "hall-a", name: "Aホール", vertices: [], blockNames: ["A"] },
            { id: "hall-b", name: "Bホール", vertices: [], blockNames: ["B"] },
          ],
        },
      },
      hallRouteSettings: {},
    },
  };
}
const row = (page: Page, id: string) =>
  page.locator(
    `[data-item-id=${JSON.stringify(id)}]:not([data-space-group-key]):not(.esp-shopping-touch-clone)`,
  );
async function restore(
  page: Page,
  phone: boolean,
  grouped: boolean,
  guide = false,
  source = backup(guide),
) {
  await page.goto("/");
  await expect(page.locator("#loading-screen")).toBeHidden();
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "placement-rules.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(source), "utf8"),
    });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog.getByRole("button", { name: "置換して復元" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
  if (phone) {
    await page.getByTitle("表示項目の設定", { exact: true }).click();
    await page
      .getByTitle("スマートフォンモードに切替", { exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator("div.fixed.inset-0.z-40")
      .first()
      .click({ position: { x: 2, y: 100 } });
  }
  const button = page
    .getByRole("button", { name: "スペース別", exact: true })
    .first();
  if ((await button.getAttribute("class"))?.includes("bg-blue-600") !== grouped)
    await button.click();
  await expect(row(page, "a1")).toBeVisible();
}
async function saved(page: Page) {
  return page.evaluate(
    async ({ eventName, day }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("EventShoppingPlannerDB");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<{ ids: string[]; checkpoint: unknown }>(
          (resolve, reject) => {
            const tx = db.transaction(
              ["executeModeItems", "syncQueue"],
              "readonly",
            );
            const root = tx.objectStore("executeModeItems").get("data");
            const cp = tx
              .objectStore("syncQueue")
              .get("__esp_internal__:checkpoint:v1:executeModeItems:data");
            const records: Array<{
              eventName: string;
              path: string[];
              value: unknown;
            }> = [];
            const cursor = tx.objectStore("executeModeItems").openCursor();
            cursor.onsuccess = () => {
              if (cursor.result) {
                if (
                  String(cursor.result.key).startsWith(
                    "__esp_internal__:day-record:v1:",
                  )
                )
                  records.push(cursor.result.value);
                cursor.result.continue();
              }
            };
            tx.onerror = () => reject(tx.error);
            tx.oncomplete = () => {
              const value = root.result;
              const ids =
                value?.kind === "event-shopping-planner-day-records"
                  ? records.find(
                      (record) =>
                        record.eventName === eventName &&
                        record.path.length === 1 &&
                        record.path[0] === day,
                    )?.value
                  : value?.[eventName]?.[day];
              resolve({ ids: ids as string[], checkpoint: cp.result });
            };
          },
        );
      } finally {
        db.close();
      }
    },
    { eventName, day },
  );
}
async function ensureRow(page: Page, id: string) {
  if ((await row(page, id).count()) === 0) {
    const itemKey = `item:${JSON.stringify(id)}`;
    const groups: Record<string, string> = {
      a1: "A-01a",
      a2: "A-01a",
      a3: "A-01a",
      b1: "A-02a",
      "hall-b": "B-01a",
      "merge-a": "A-01a",
      "new-a": "A-03a",
      "mixed-b": "B-02a",
      "priority-a": "A-04a:highest",
    };
    const groupKey = `group:${JSON.stringify(groups[id])}`;
    const itemOwner = page
      .locator(
        `[data-viewport-row-key=${JSON.stringify(itemKey)}], [data-row-key=${JSON.stringify(itemKey)}]`,
      )
      .first();
    const groupOwner = page
      .locator(
        `[data-viewport-row-key=${JSON.stringify(groupKey)}], [data-row-key=${JSON.stringify(groupKey)}]`,
      )
      .first();
    await ((await itemOwner.count()) ? itemOwner : groupOwner).evaluate(
      (element) => element.scrollIntoView({ block: "center" }),
    );
    await expect(row(page, id)).toBeAttached();
  }
  await row(page, id).evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
}
async function begin(page: Page, id: string, touch: boolean) {
  await ensureRow(page, id);
  await page.evaluate(
    ({ id, touch }) => {
      const source = document.querySelector<HTMLElement>(
        `[data-item-id=${JSON.stringify(id)}]:not([data-space-group-key])`,
      )!;
      const rect = source.getBoundingClientRect();
      const point = { clientX: rect.left + 4, clientY: rect.top + 40 };
      const state = window as unknown as {
        __placementSource: string;
        __placementTransfer: DataTransfer;
      };
      state.__placementSource = id;
      state.__placementTransfer = new DataTransfer();
      if (touch) {
        const finger = new Touch({ identifier: 73, target: source, ...point });
        source.dispatchEvent(
          new TouchEvent("touchstart", {
            bubbles: true,
            cancelable: true,
            touches: [finger],
            changedTouches: [finger],
          }),
        );
      } else
        source.dispatchEvent(
          new DragEvent("dragstart", {
            bubbles: true,
            cancelable: true,
            dataTransfer: state.__placementTransfer,
            ...point,
          }),
        );
    },
    { id, touch },
  );
  if (touch)
    await expect(page.locator(".esp-shopping-touch-clone")).toBeAttached();
}
async function hover(
  page: Page,
  id: string,
  touch: boolean,
  edge: "before" | "after",
  groupBoundary: boolean,
) {
  await ensureRow(page, id);
  return page.evaluate(
    async ({ id, touch, edge, groupBoundary }) => {
      const target = document.querySelector<HTMLElement>(
        `[data-item-id=${JSON.stringify(id)}]:not([data-space-group-key])`,
      )!;
      const owner = groupBoundary
        ? (target.closest<HTMLElement>(
            '[data-viewport-row-key^="group:"], [data-row-key^="group:"]',
          ) ?? target)
        : target;
      let bounds = owner.getBoundingClientRect();
      const desired = edge === "before" ? bounds.top + 8 : bounds.bottom - 8;
      window.scrollBy(0, desired - window.innerHeight * 0.55);
      await new Promise(requestAnimationFrame);
      bounds = owner.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      const point = {
        clientX: rect.left + (id === "a3" ? 15 : 5),
        clientY: edge === "before" ? bounds.top + 8 : bounds.bottom - 8,
      };
      const hit = document.elementFromPoint(point.clientX, point.clientY);
      if (!hit || !owner.contains(hit))
        throw new Error(
          `Placement point missed ${id}: ${point.clientX},${point.clientY}`,
        );
      const beforeScroll = window.scrollY;
      const state = window as unknown as {
        __placementSource: string;
        __placementTransfer: DataTransfer;
        __placementPoint: { clientX: number; clientY: number };
        __placementTarget: string;
      };
      state.__placementPoint = point;
      state.__placementTarget = id;
      if (touch) {
        const source = document.querySelector<HTMLElement>(
          `[data-item-id=${JSON.stringify(state.__placementSource)}]:not([data-space-group-key])`,
        )!;
        const finger = new Touch({ identifier: 73, target: source, ...point });
        source.dispatchEvent(
          new TouchEvent("touchmove", {
            bubbles: true,
            cancelable: true,
            touches: [finger],
            changedTouches: [finger],
          }),
        );
      } else
        target.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            dataTransfer: state.__placementTransfer,
            ...point,
          }),
        );
      await new Promise(requestAnimationFrame);
      return { beforeScroll };
    },
    { id, touch, edge, groupBoundary },
  );
}
async function finish(page: Page, touch: boolean) {
  await page.evaluate((touch) => {
    const state = window as unknown as {
      __placementSource: string;
      __placementTransfer: DataTransfer;
      __placementPoint: { clientX: number; clientY: number };
      __placementTarget: string;
    };
    const source = document.querySelector<HTMLElement>(
      `[data-item-id=${JSON.stringify(state.__placementSource)}]:not([data-space-group-key])`,
    )!;
    const target =
      document.elementFromPoint(
        state.__placementPoint.clientX,
        state.__placementPoint.clientY,
      ) ?? source;
    if (touch) {
      const finger = new Touch({
        identifier: 73,
        target: source,
        ...state.__placementPoint,
      });
      source.dispatchEvent(
        new TouchEvent("touchend", {
          bubbles: true,
          cancelable: true,
          touches: [],
          changedTouches: [finger],
        }),
      );
    } else {
      target.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: state.__placementTransfer,
          ...state.__placementPoint,
        }),
      );
      source.dispatchEvent(
        new DragEvent("dragend", {
          bubbles: true,
          dataTransfer: state.__placementTransfer,
        }),
      );
    }
  }, touch);
  await expect(page.locator(".esp-shopping-touch-clone")).toHaveCount(0);
  await expect(page.locator("[data-shopping-drag-guide]")).toHaveCount(0);
}
async function displayIds(page: Page) {
  return page
    .locator(
      '[data-shopping-drag-column="execute"] [data-item-id]:not([data-space-group-key])',
    )
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-item-id")),
    );
}

for (const touch of [false, true])
  for (const grouped of [false, true]) {
    test.describe(`placement ${touch ? "smartphone touch-event" : "PC drag-event"} grouping ${grouped}`, () => {
      test.use({ hasTouch: touch });
      test("book order preserves the raw visit slot, then another-space drop moves every book", async ({
        page,
      }, testInfo) => {
        test.setTimeout(90000);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await restore(page, touch, grouped);
        const itemsBefore = (await readBrowserEventLists(page))[eventName];
        expect((await saved(page)).ids).toEqual(initialExecute);
        expect(await displayIds(page)).toEqual([
          "a1",
          "a2",
          "a3",
          "b1",
          "hall-b",
        ]);
        await begin(page, "a1", touch);
        await hover(page, "a2", touch, "after", false);
        await finish(page, touch);
        await expect
          .poll(async () => (await saved(page)).ids)
          .toEqual(["a2", "b1", "a1", "a3", "hall-b"]);
        expect(await displayIds(page)).toEqual([
          "a2",
          "a1",
          "a3",
          "b1",
          "hall-b",
        ]);
        await begin(page, "a1", touch);
        await hover(page, "b1", touch, "after", grouped);
        await finish(page, touch);
        await expect
          .poll(async () => (await saved(page)).ids)
          .toEqual(["b1", "a2", "a1", "a3", "hall-b"]);
        expect(await displayIds(page)).toEqual([
          "b1",
          "a2",
          "a1",
          "a3",
          "hall-b",
        ]);
        expect((await readBrowserEventLists(page))[eventName]).toEqual(
          itemsBefore,
        );
        await page.reload();
        await page.getByText(eventName, { exact: true }).click();
        await expect
          .poll(async () => (await saved(page)).ids)
          .toEqual(["b1", "a2", "a1", "a3", "hall-b"]);
        await testInfo.attach("book-space-order-proof", {
          body: Buffer.from(
            JSON.stringify({
              touch,
              grouped,
              durable: await saved(page),
              items: await readBrowserEventLists(page),
            }),
            "utf8",
          ),
          contentType: "application/json",
        });
      });
      test("guidance requires a valid drop and mixed hall or priority selections are preserved", async ({
        page,
      }, testInfo) => {
        test.setTimeout(90000);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await restore(page, touch, grouped, true);
        const before = await saved(page);
        const itemsBefore = (await readBrowserEventLists(page))[eventName];
        await begin(page, "merge-a", touch);
        const guidePoint = await hover(page, "hall-b", touch, "after", grouped);
        await expect
          .poll(() => page.evaluate(() => window.scrollY))
          .not.toBe(guidePoint.beforeScroll);
        await expect(
          page.locator('[data-shopping-drag-guide="suggestion"]'),
        ).toBeAttached();
        expect(await saved(page)).toEqual(before);
        // Scrolling a valid destination under a stationary pointer cannot confirm the move.
        await finish(page, touch);
        expect(await saved(page)).toEqual(before);
        await expect(
          page.locator("[data-shopping-placement-rejection]"),
        ).toBeVisible();
        await begin(page, "merge-a", touch);
        await hover(page, "hall-b", touch, "after", grouped);
        await expect(
          page.locator('[data-shopping-drag-guide="suggestion"]'),
        ).toBeAttached();
        await hover(page, "a3", touch, "after", grouped);
        await finish(page, touch);
        await expect
          .poll(async () => (await saved(page)).ids)
          .toEqual([
            ...before.ids.slice(0, 4),
            "merge-a",
            ...before.ids.slice(4),
          ]);
        const merged = await saved(page);
        for (const second of ["mixed-b", "priority-a"]) {
          const firstBox = row(page, "new-a").getByRole("checkbox");
          const secondBox = row(page, second).getByRole("checkbox");
          await firstBox.check();
          await secondBox.check();
          await begin(page, "new-a", touch);
          await hover(page, "b1", touch, "after", grouped);
          await finish(page, touch);
          await expect(
            page.locator("[data-shopping-placement-rejection]"),
          ).toContainText("異なるホール・優先度");
          expect(await saved(page)).toEqual(merged);
          await expect(firstBox).toBeChecked();
          await expect(secondBox).toBeChecked();
          await page
            .getByRole("button", { name: "選択を解除", exact: true })
            .click();
          await expect(firstBox).not.toBeChecked();
          await expect(secondBox).not.toBeChecked();
        }
        expect((await readBrowserEventLists(page))[eventName]).toEqual(
          itemsBefore,
        );
        await testInfo.attach("placement-guidance-rejection-proof", {
          body: Buffer.from(
            JSON.stringify({
              touch,
              grouped,
              before,
              merged,
              after: await saved(page),
            }),
            "utf8",
          ),
          contentType: "application/json",
        });
      });
    });
  }

/** Compare physical book/order records and their commit identity outside timing windows. */
async function placementRecords(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Record<string, Array<[IDBValidKey, unknown]>>>(
        (resolve, reject) => {
          const result: Record<string, Array<[IDBValidKey, unknown]>> = {
            eventLists: [],
            executeModeItems: [],
            integrity: [],
          };
          const tx = db.transaction(
            ["eventLists", "executeModeItems", "syncQueue"],
            "readonly",
          );
          for (const store of ["eventLists", "executeModeItems", "syncQueue"]) {
            const cursor = tx.objectStore(store).openCursor();
            cursor.onsuccess = () => {
              const entry = cursor.result;
              if (!entry) return;
              if (store !== "syncQueue")
                result[store].push([entry.key, entry.value]);
              else if (
                typeof entry.key === "string" &&
                (entry.key.endsWith(":eventLists:data") ||
                  entry.key.endsWith(":executeModeItems:data"))
              )
                result.integrity.push([entry.key, entry.value]);
              entry.continue();
            };
          }
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        },
      );
    } finally {
      db.close();
    }
  });
}

async function displayedNavigationIds(page: Page) {
  return page
    .locator(
      '[data-shopping-drag-column="execute"] [data-space-navigation-visit-id]',
    )
    .evaluateAll((elements) => [
      ...new Set(
        elements.map((element) =>
          element.getAttribute("data-space-navigation-visit-id"),
        ),
      ),
    ]);
}

test("fragmented visits keep list, map visit list and navigator order without display-only saves", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const source = backup();
  source.data.dayModes[eventName][day] = "execute";
  const mapKey = `${day}マップ`;
  Object.assign(source.data.mapData, {
    [eventName]: {
      [mapKey]: {
        maxRow: 8,
        maxCol: 12,
        cells: [],
        mergedCells: [],
        blocks: [
          {
            name: "A",
            startRow: 1,
            startCol: 1,
            endRow: 6,
            endCol: 5,
            numberCells: [
              { row: 2, col: 2, value: 1 },
              { row: 3, col: 2, value: 2 },
              { row: 4, col: 2, value: 3 },
              { row: 5, col: 2, value: 4 },
            ],
          },
          {
            name: "B",
            startRow: 1,
            startCol: 7,
            endRow: 6,
            endCol: 11,
            numberCells: [
              { row: 2, col: 8, value: 1 },
              { row: 3, col: 8, value: 2 },
            ],
          },
        ],
      },
    },
  });
  source.data.hallDefinitions[eventName] = {
    [mapKey]: [
      {
        id: "hall-a",
        name: "Aホール",
        blockNames: ["A"],
        vertices: [
          { row: 1, col: 1 },
          { row: 1, col: 5 },
          { row: 6, col: 5 },
          { row: 6, col: 1 },
        ],
      },
      {
        id: "hall-b",
        name: "Bホール",
        blockNames: ["B"],
        vertices: [
          { row: 1, col: 7 },
          { row: 1, col: 11 },
          { row: 6, col: 11 },
          { row: 6, col: 7 },
        ],
      },
    ],
  };
  await restore(page, false, true, false, source);
  const expectedBooks = ["a1", "a2", "a3", "b1", "hall-b"];
  const expectedNavigationIds = [
    `A-01a:none@placement:${JSON.stringify(["confirmed", '@hall:["map","1日目マップ","hall-a"]'])}`,
    `A-02a:none@placement:${JSON.stringify(["confirmed", '@hall:["map","1日目マップ","hall-a"]'])}`,
    `B-01a:none@placement:${JSON.stringify(["confirmed", '@hall:["map","1日目マップ","hall-b"]'])}`,
  ];
  const beforeRecords = await placementRecords(page);
  const beforeItems = await readBrowserEventLists(page);
  expect((await saved(page)).ids).toEqual(initialExecute);
  expect(await displayIds(page)).toEqual(expectedBooks);
  expect(await displayedNavigationIds(page)).toEqual(expectedNavigationIds);

  const checkNavigator = async () => {
    await page
      .getByRole("button", { name: "スペース一覧を開く", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "スペース一覧",
      exact: true,
    });
    const entries = dialog.locator(
      '[data-testid="space-navigator-window"] button',
    );
    await expect(entries).toHaveCount(3);
    for (const [index, label] of ["A-01a", "A-02a", "B-01a"].entries()) {
      await expect(
        entries.nth(index).getByText(label, { exact: true }),
      ).toBeVisible();
      await expect(entries.nth(index).locator("span").first()).toHaveText(
        String(index + 1),
      );
    }
    await dialog
      .getByRole("button", { name: "スペース一覧を閉じる", exact: true })
      .click();
  };
  await checkNavigator();
  const grouping = page
    .getByRole("button", { name: "スペース別", exact: true })
    .first();
  await grouping.click();
  expect(await displayIds(page)).toEqual(expectedBooks);
  expect(await displayedNavigationIds(page)).toEqual(expectedNavigationIds);
  await checkNavigator();
  await grouping.click();
  expect(await displayIds(page)).toEqual(expectedBooks);
  expect(await displayedNavigationIds(page)).toEqual(expectedNavigationIds);
  expect(await placementRecords(page)).toEqual(beforeRecords);

  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  await expect(page.locator('[data-route-item-count="3"]')).toBeVisible();
  await page.getByTitle("リスト表示に切り替え", { exact: true }).hover();
  await page.mouse.down();
  const openPanel = page.getByRole("button", {
    name: "📍 訪問リスト",
    exact: true,
  });
  await expect(openPanel).toBeVisible();
  await page.mouse.up();
  await openPanel.click();
  const mapRows = page.locator("[data-drag-item]");
  await expect(mapRows).toHaveCount(5);
  expect(
    await mapRows.evaluateAll((elements) =>
      elements.map((element) =>
        element.querySelector("p")?.textContent?.trim(),
      ),
    ),
  ).toEqual(expectedBooks);
  await page.getByTitle("閉じる", { exact: true }).click();
  await page.getByTitle("リスト表示に切り替え", { exact: true }).click();
  expect(await displayIds(page)).toEqual(expectedBooks);
  expect(await displayedNavigationIds(page)).toEqual(expectedNavigationIds);
  expect(await placementRecords(page)).toEqual(beforeRecords);
  expect(await readBrowserEventLists(page)).toEqual(beforeItems);

  await page.reload();
  await page.getByText(eventName, { exact: true }).click();
  const listButton = page.getByTitle("リスト表示に切り替え", { exact: true });
  if (await listButton.isVisible()) await listButton.click();
  await expect.poll(() => displayIds(page)).toEqual(expectedBooks);
  expect(await displayedNavigationIds(page)).toEqual(expectedNavigationIds);
  await checkNavigator();
  expect((await saved(page)).ids).toEqual(initialExecute);
  expect(await placementRecords(page)).toEqual(beforeRecords);
  expect(await readBrowserEventLists(page)).toEqual(beforeItems);
  await testInfo.attach("display-only-placement-proof", {
    body: Buffer.from(
      JSON.stringify({
        expectedBooks,
        expectedNavigationIds,
        raw: initialExecute,
        records: await placementRecords(page),
      }),
      "utf8",
    ),
    contentType: "application/json",
  });
});
