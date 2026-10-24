import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { restoreTransferFixture } from "./shopping-transfer-measurement";
import { readBrowserEventLists } from "./shopping-transfer-persisted-store";

test.use({ trace: "off", video: "off", serviceWorkers: "allow" });

test("rollback maintenance keeps the normal app stopped and preserves the verified backup", async ({
  page,
}) => {
  test.setTimeout(120000);
  await restoreTransferFixture(
    page,
    {
      count: 150,
      input: "native",
      grouped: false,
      load: "light",
      direction: "candidate-to-execute",
    },
    false,
  );
  const before = await readBrowserEventLists(page);
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  const readHead = () =>
    page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("EventShoppingPlannerDB");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const transaction = database.transaction("eventLists", "readonly");
        const request = transaction.objectStore("eventLists").get("data");
        return await new Promise<unknown>((resolve, reject) => {
          transaction.oncomplete = () => resolve(request.result);
          transaction.onabort = transaction.onerror = () =>
            reject(transaction.error);
        });
      } finally {
        database.close();
      }
    });
  const originalHead = await readHead();
  expect(originalHead).toMatchObject({
    kind: "event-shopping-planner-day-records",
  });
  await page.goto("/?maintenance=storage-rollback");
  await expect(
    page.getByRole("heading", { name: "旧バージョンへ戻す準備" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "イベント一覧", exact: true }),
  ).toHaveCount(0);
  const prepare = page.getByRole("button", {
    name: "2. 旧バージョン用に準備",
    exact: true,
  });
  await expect(prepare).toBeDisabled();
  expect(await readHead()).toEqual(originalHead);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "1. 最新のバックアップを保存", exact: true })
      .click(),
  ]);
  const downloaded = await download.path();
  expect(downloaded).toBeTruthy();
  const backup = JSON.parse(await readFile(downloaded!, "utf8"));
  expect(backup.data.eventLists).toEqual(before);
  await expect(prepare).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "バックアップファイルが保存されたことを確認しました",
    })
    .check();
  await prepare.click();
  await expect(page.getByRole("status")).toContainText("準備が完了しました");
  expect(await readHead()).toEqual(before);
  expect(await readBrowserEventLists(page)).toEqual(before);
  expect(workers.filter((url) => url.includes("persistence.worker"))).toEqual(
    [],
  );
  // Returning to the current app must keep the explicitly prepared legacy form.
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "イベント一覧", exact: true }),
  ).toBeVisible();
  expect(await readHead()).toEqual(before);
  expect(await readBrowserEventLists(page)).toEqual(before);
});
