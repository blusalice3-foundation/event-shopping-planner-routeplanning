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
) {
  await page.goto("/");
  await expect(page.locator("#loading-screen")).toBeHidden();
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "placement-rules.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup(guide)), "utf8"),
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
async function begin(page: Page, id: string, touch: boolean) {
  await row(page, id).scrollIntoViewIfNeeded();
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
  await row(page, id).scrollIntoViewIfNeeded();
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
        clientX: rect.left + 5,
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
    const target = document.querySelector<HTMLElement>(
      `[data-item-id=${JSON.stringify(state.__placementTarget)}]:not([data-space-group-key])`,
    )!;
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
        // Revisit the invalid surface after guidance; releasing here must not accept a new location.
        await hover(page, "hall-b", touch, "after", grouped);
        await finish(page, touch);
        expect(await saved(page)).toEqual(before);
        await expect(
          page.locator("[data-shopping-placement-rejection]"),
        ).toBeVisible();
        await begin(page, "merge-a", touch);
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
          await firstBox.uncheck();
          await secondBox.uncheck();
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
