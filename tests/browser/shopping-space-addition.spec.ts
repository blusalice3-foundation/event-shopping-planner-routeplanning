import { expect, test, type Page } from "@playwright/test";
import type { ShoppingItem } from "../../src/types/item";
import { readBrowserEventLists } from "./shopping-transfer-persisted-store";

const eventName = "スペース追加の優先度検証";
const day = "1日目";
const makeItem = (
  id: string,
  number: string,
  priorityLevel: NonNullable<ShoppingItem["priorityLevel"]>,
): ShoppingItem => ({
  id,
  eventDate: day,
  block: "A",
  number,
  circle: `既存サークル${id}`,
  title: `既存の本${id}`,
  priorityLevel,
  price: 500,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "ユーザー登録 エラーが発生しました",
});
function backup() {
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-11-01T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: {
        [eventName]: [
          makeItem("execute-highest", "01a", "highest"),
          makeItem("execute-priority", "02a", "priority"),
          makeItem("execute-normal", "03a", "none"),
          makeItem("candidate-highest", "04a", "highest"),
          makeItem("candidate-normal", "04a2", "none"),
          makeItem("candidate-uniform", "05a", "priority"),
        ],
      },
      eventMetadata: {},
      executeModeItems: {
        [eventName]: {
          [day]: ["execute-highest", "execute-priority", "execute-normal"],
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
            {
              id: "hall-a",
              name: "Aホール",
              vertices: [],
              blockNames: ["A", "東-A"],
            },
          ],
        },
      },
      hallRouteSettings: {},
    },
  };
}
async function restore(page: Page) {
  await page.goto("/");
  await expect(page.locator("#loading-screen")).toBeHidden();
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "space-addition.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup()), "utf8"),
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
  await expect(
    page.locator('[data-shopping-drag-column="execute"]'),
  ).toBeVisible();
}
async function openSpaceAddition(
  page: Page,
  column: "execute" | "candidate",
  referenceId: string,
  touch: boolean,
) {
  const header = page.locator(
    `[data-shopping-drag-column="${column}"] [data-space-group-key][data-shopping-drag-reference-id="${referenceId}"]`,
  );
  await header.scrollIntoViewIfNeeded();
  const opener = header.getByRole("button", {
    name: "このスペースにアイテムを追加",
  });
  if (touch) await opener.tap();
  else await opener.click();
  return page.getByRole("dialog", { name: "新規アイテム追加" });
}
async function durableItems(page: Page) {
  return (await readBrowserEventLists(page))[eventName];
}

for (const layout of ["pc", "smartphone"] as const) {
  test.describe(`space addition ${layout}`, () => {
    test.use({ hasTouch: layout === "smartphone" });
    test(`space + priority inheritance and mixed choice retain input and durable books: ${layout}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width: 1440, height: 1000 });
      await restore(page);
      if (layout === "smartphone") {
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
      const grouping = page
        .getByRole("button", { name: "スペース別", exact: true })
        .first();
      if (!(await grouping.getAttribute("class"))?.includes("bg-blue-600"))
        await grouping.click();
      await page
        .getByRole("button", { name: "全て折りたたむ", exact: true })
        .click();
      const before = await durableItems(page);
      const originalIds = new Set(before.map((item) => item.id));
      const createdIds: string[] = [];
      const expectations: Array<{ circle: string; priorityLevel: string }> = [];
      for (const [referenceId, priorityLevel] of [
        ["execute-highest", "highest"],
        ["execute-priority", "priority"],
        ["execute-normal", "none"],
        ["candidate-uniform", "priority"],
      ] as const) {
        const dialog = await openSpaceAddition(
          page,
          referenceId.startsWith("execute") ? "execute" : "candidate",
          referenceId,
          layout === "smartphone",
        );
        await expect(dialog.getByLabel("優先度", { exact: true })).toHaveValue(
          priorityLevel,
        );
        await expect(
          dialog.getByLabel("購入金額", { exact: true }),
        ).toHaveValue("");
        await expect(dialog.getByLabel("数量", { exact: true })).toHaveValue(
          "1",
        );
        await expect(
          dialog.getByLabel("購入状態", { exact: true }),
        ).toHaveValue("None");
        const circle = `追加${referenceId}`;
        await dialog.getByRole("combobox", { name: "サークル名" }).fill(circle);
        const add = dialog.getByRole("button", {
          name: "リストに追加",
          exact: true,
        });
        if (layout === "smartphone") await add.tap();
        else await add.click();
        await expect(dialog).toBeHidden();
        await expect
          .poll(
            async () =>
              (await durableItems(page)).filter(
                (item) => item.circle === circle,
              ).length,
          )
          .toBe(1);
        const created = (await durableItems(page)).find(
          (item) => item.circle === circle,
        )!;
        expect(created).toMatchObject({
          priorityLevel,
          price: null,
          quantity: 1,
          purchaseStatus: "None",
        });
        createdIds.push(String(created.id));
        expectations.push({ circle, priorityLevel });
      }
      const dialog = await openSpaceAddition(
        page,
        "candidate",
        "candidate-highest",
        layout === "smartphone",
      );
      const priority = dialog.getByLabel("優先度", { exact: true });
      await expect(priority).toHaveValue("");
      await expect(priority).toHaveAttribute("required", "");
      await dialog
        .getByRole("combobox", { name: "サークル名" })
        .fill("混在から追加");
      await dialog.getByLabel("タイトル", { exact: true }).fill("入力中の新刊");
      await dialog.getByLabel("購入金額", { exact: true }).fill("1234");
      await dialog.getByLabel("数量", { exact: true }).selectOption("3");
      await dialog
        .getByLabel("購入状態", { exact: true })
        .selectOption("Purchased");
      await dialog
        .getByLabel("利用者メモ", { exact: true })
        .fill("保持するメモ");
      await dialog.getByLabel("ブロック", { exact: true }).fill("東-A");
      await dialog.getByLabel("ナンバー", { exact: true }).fill("08b");
      const submit = dialog.getByRole("button", {
        name: "リストに追加",
        exact: true,
      });
      await expect(submit).toBeDisabled();
      expect((await durableItems(page)).length).toBe(before.length + 4);
      await priority.selectOption("priority");
      await expect(dialog.getByLabel("タイトル", { exact: true })).toHaveValue(
        "入力中の新刊",
      );
      await expect(dialog.getByLabel("購入金額", { exact: true })).toHaveValue(
        "1234",
      );
      await expect(dialog.getByLabel("数量", { exact: true })).toHaveValue("3");
      await expect(dialog.getByLabel("購入状態", { exact: true })).toHaveValue(
        "Purchased",
      );
      await expect(dialog.getByLabel("ブロック", { exact: true })).toHaveValue(
        "東-A",
      );
      await expect(dialog.getByLabel("ナンバー", { exact: true })).toHaveValue(
        "08b",
      );
      await expect(submit).toBeEnabled();
      if (layout === "smartphone") await submit.tap();
      else await submit.click();
      await expect(dialog).toBeHidden();
      await expect
        .poll(async () => (await durableItems(page)).length)
        .toBe(before.length + 5);
      const after = await durableItems(page);
      expect(after.filter((item) => originalIds.has(item.id))).toEqual(before);
      const mixedAdded = after.find((item) => item.circle === "混在から追加")!;
      expect(mixedAdded).toMatchObject({
        eventDate: day,
        block: "東-A",
        number: "08b",
        priorityLevel: "priority",
        title: "入力中の新刊",
        price: 1234,
        quantity: 3,
        purchaseStatus: "Purchased",
        remarks: "保持するメモ",
      });
      createdIds.push(String(mixedAdded.id));
      expect(new Set(createdIds).size).toBe(5);
      expect(new Set(after.map((item) => item.id)).size).toBe(after.length);
      await page.reload();
      await page.getByText(eventName, { exact: true }).click();
      await expect(
        page.getByRole("heading", { name: eventName, exact: true }),
      ).toBeVisible();
      const reloaded = await durableItems(page);
      expect(reloaded).toEqual(after);
      for (const expected of expectations)
        expect(
          reloaded.find((item) => item.circle === expected.circle),
        ).toMatchObject({
          ...expected,
          price: null,
          quantity: 1,
          purchaseStatus: "None",
        });
      expect(errors).toEqual([]);
      await testInfo.attach("space-addition-durable-proof", {
        body: Buffer.from(
          JSON.stringify(
            {
              layout,
              createdIds,
              originalIds: [...originalIds],
              after,
              reloaded,
            },
            null,
            2,
          ),
          "utf8",
        ),
        contentType: "application/json",
      });
    });
  });
}
