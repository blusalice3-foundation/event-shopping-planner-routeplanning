import { expect, test, type Page } from "@playwright/test";
import { readBrowserEventLists } from "./shopping-transfer-persisted-store";

test.use({
  hasTouch: true,
  viewport: { width: 1440, height: 1100 },
  video: "off",
  trace: "off",
});
const eventName = "列の空き領域へのドロップ";
const day = "1日目";
type Input = "native" | "touch";
type Column = "execute" | "candidate";
type Scenario = "return" | "empty" | "hall-tail";
type Point = { x: number; y: number };

const makeItem = (id: string, number: number, block = "A") => ({
  id,
  eventDate: day,
  circle: id,
  title: "ユーザー登録",
  block,
  number: String(number),
  price: 500,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "エラーが発生しました",
  priorityLevel: "none",
});

function fixture(scenario: Scenario) {
  const execute =
    scenario === "empty"
      ? []
      : Array.from({ length: 40 }, (_, i) =>
          makeItem(`e${i}`, i + 1, i < 20 ? "A" : "B"),
        );
  const candidate = Array.from(
    { length: scenario === "return" ? 1 : 40 },
    (_, i) => makeItem(`c${i}`, i + 100),
  );
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-31T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: { [eventName]: [...execute, ...candidate] },
      eventMetadata: {},
      executeModeItems: {
        [eventName]: { [day]: execute.map((item) => item.id) },
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

async function restore(
  page: Page,
  scenario: Scenario,
  grouped: boolean,
  renderer: "full" | "retained",
) {
  await page.addInitScript(
    (value) => {
      localStorage.setItem(
        "__esp_internal__:list-renderer-preference:v1",
        JSON.stringify({ version: 1, value }),
      );
    },
    renderer === "full" ? "full" : "auto",
  );
  await page.goto("/");
  const backup = fixture(scenario);
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "blank-drop.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup), "utf8"),
    });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog.getByRole("button", { name: "置換して復元" }).click();
  await expect(dialog).toBeHidden({ timeout: 60000 });
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
  await page.getByTitle("表示項目の設定", { exact: true }).click();
  await page.getByLabel("画面の表示倍率").selectOption("100");
  await page
    .locator("div.fixed.inset-0.z-40")
    .first()
    .click({ position: { x: 2, y: 100 } });
  const button = page
    .getByRole("button", { name: "スペース別", exact: true })
    .first();
  if ((await button.getAttribute("class"))?.includes("bg-blue-600") !== grouped)
    await button.click();
  const source = scenario === "return" ? "execute" : "candidate";
  const list = page.locator(
    `[data-list-renderer][data-shopping-drag-column="${source}"]`,
  );
  if (renderer === "retained")
    await expect(list).toHaveAttribute(
      "data-list-renderer-strategy",
      "retained-viewport",
    );
  else await expect(list).toHaveAttribute("data-list-renderer", "full");
  return backup;
}

async function start(page: Page, input: Input, id: string) {
  const row = page.locator(
    `[data-item-id="${id}"]:not([data-space-group-key]):not(.esp-shopping-touch-clone)`,
  );
  await row.scrollIntoViewIfNeeded();
  await row.evaluate((element, input) => {
    const rect = element.getBoundingClientRect();
    const point = { clientX: rect.left + 20, clientY: rect.top + 30 };
    const state = window as unknown as {
      __blankDropSource: HTMLElement;
      __blankDropTransfer: DataTransfer;
    };
    state.__blankDropSource = element as HTMLElement;
    if (input === "native") {
      state.__blankDropTransfer = new DataTransfer();
      element.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer: state.__blankDropTransfer,
          ...point,
        }),
      );
    } else {
      const touch = new Touch({ identifier: 1, target: element, ...point });
      element.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          cancelable: true,
          touches: [touch],
          changedTouches: [touch],
        }),
      );
    }
  }, input);
  if (input === "touch")
    await expect(page.locator(".esp-shopping-touch-clone")).toBeVisible();
}

async function blankPoint(
  page: Page,
  column: Column,
  location: "gap" | "below",
): Promise<Point> {
  return page
    .locator(`[data-shopping-drag-surface="${column}"]`)
    .evaluate((surface, location) => {
      const rect = surface.getBoundingClientRect();
      const list = surface.querySelector<HTMLElement>("[data-list-renderer]")!;
      const bounds = list.getBoundingClientRect();
      const minY = Math.max(rect.top + 120, 180);
      const maxY = Math.min(rect.bottom - 30, window.innerHeight - 120);
      const xs =
        location === "below"
          ? [rect.left + rect.width / 2]
          : [rect.left + 2, rect.right - 2, bounds.left - 2, bounds.right + 2];
      const ys =
        location === "below"
          ? [Math.max(minY, bounds.bottom + 35)]
          : [bounds.top - 4, minY, (minY + maxY) / 2, maxY];
      for (const y of ys)
        for (const x of xs) {
          if (x <= rect.left || x >= rect.right || y >= maxY || y <= rect.top)
            continue;
          const hit = document.elementFromPoint(x, y);
          if (
            !hit ||
            !surface.contains(hit) ||
            hit.closest("[data-item-id], [data-shopping-drag-reference-id]")
          )
            continue;
          if (location === "gap" && list.contains(hit)) continue;
          return { x, y };
        }
      throw new Error(
        `No real blank ${location} point in column surface; surface=${JSON.stringify(rect.toJSON())} list=${JSON.stringify(bounds.toJSON())}`,
      );
    }, location);
}

async function moveAndDrop(
  page: Page,
  input: Input,
  column: Column,
  point: Point,
) {
  const admitted = await page.evaluate(
    ({ input, point }) => {
      const state = window as unknown as {
        __blankDropSource: HTMLElement;
        __blankDropTransfer: DataTransfer;
      };
      const target = document.elementFromPoint(point.x, point.y)!;
      if (input === "native")
        return !target.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            dataTransfer: state.__blankDropTransfer,
            clientX: point.x,
            clientY: point.y,
          }),
        );
      else {
        const touch = new Touch({
          identifier: 1,
          target: state.__blankDropSource,
          clientX: point.x,
          clientY: point.y,
        });
        state.__blankDropSource.dispatchEvent(
          new TouchEvent("touchmove", {
            bubbles: true,
            cancelable: true,
            touches: [touch],
            changedTouches: [touch],
          }),
        );
      }
      return true;
    },
    { input, point },
  );
  expect(
    admitted,
    "native dragover must allow the browser to deliver a drop",
  ).toBe(true);
  await expect(
    page.locator(
      `[data-shopping-drag-surface="${column}"] [data-shopping-drag-status="accepted"]`,
    ),
  ).toBeVisible();
  await page.evaluate(
    ({ input, point }) => {
      const state = window as unknown as {
        __blankDropSource: HTMLElement;
        __blankDropTransfer: DataTransfer;
      };
      if (input === "native") {
        document.elementFromPoint(point.x, point.y)!.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer: state.__blankDropTransfer,
            clientX: point.x,
            clientY: point.y,
          }),
        );
        state.__blankDropSource.dispatchEvent(
          new DragEvent("dragend", { bubbles: true }),
        );
      } else
        state.__blankDropSource.dispatchEvent(
          new TouchEvent("touchend", {
            bubbles: true,
            cancelable: true,
            touches: [],
            changedTouches: [],
          }),
        );
    },
    { input, point },
  );
  await expect(
    page.locator("[data-shopping-drag-status], .esp-shopping-touch-clone"),
  ).toHaveCount(0);
}

async function savedExecuteIds(page: Page) {
  return page.evaluate(
    async ({ eventName, day }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("EventShoppingPlannerDB");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<string[]>((resolve, reject) => {
          const tx = db.transaction("executeModeItems", "readonly");
          const store = tx.objectStore("executeModeItems");
          const root = store.get("data");
          const scoped = store.get(
            "__esp_internal__:day-record:v1:" +
              JSON.stringify([eventName, [day]]),
          );
          tx.oncomplete = () =>
            resolve(
              scoped.result?.value ?? root.result?.[eventName]?.[day] ?? [],
            );
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { eventName, day },
  );
}

test.describe("cross-column drops on real blank column surfaces", () => {
  for (const input of ["native", "touch"] as const)
    for (const renderer of ["full", "retained"] as const)
      for (const grouped of [false, true])
        for (const scenario of ["return", "empty", "hall-tail"] as const)
          test(`${scenario}: ${input} ${renderer} grouping=${grouped}`, async ({
            page,
          }) => {
            const backup = await restore(page, scenario, grouped, renderer);
            const expected = [...backup.data.executeModeItems[eventName][day]];
            const target = scenario === "return" ? "candidate" : "execute";
            await start(page, input, scenario === "return" ? "e0" : "c0");
            await moveAndDrop(
              page,
              input,
              target,
              await blankPoint(
                page,
                target,
                scenario === "empty" ? "below" : "gap",
              ),
            );
            if (scenario === "return") expected.splice(0, 1);
            else expected.splice(scenario === "empty" ? 0 : 20, 0, "c0");
            await expect.poll(() => savedExecuteIds(page)).toEqual(expected);
            if (scenario === "return") {
              await start(page, input, "e1");
              await moveAndDrop(
                page,
                input,
                target,
                await blankPoint(page, target, "below"),
              );
              expected.splice(0, 1);
              await expect.poll(() => savedExecuteIds(page)).toEqual(expected);
            }
            const items = (await readBrowserEventLists(page))[eventName];
            expect(items.map((item) => item.id).sort()).toEqual(
              backup.data.eventLists[eventName].map((item) => item.id).sort(),
            );
            expect(
              items.every(
                (item) =>
                  item.title === "ユーザー登録" &&
                  item.remarks === "エラーが発生しました",
              ),
            ).toBe(true);
          });
});
