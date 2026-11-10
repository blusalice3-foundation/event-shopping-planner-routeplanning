import { expect, test } from "@playwright/test";
import { readBrowserEventLists } from "./shopping-transfer-persisted-store";

const eventName = "単品追加の必須入力確認";
const seed = {
  id: "retained-item",
  eventDate: "1日目",
  circle: "ユーザー登録",
  title: "エラーが発生しました",
  block: "A",
  number: "1",
  price: 500,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "保持する元品目",
};

test("single-item circle requirement handles native invalid and whitespace without losing other inputs, then saves a circle-only item", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("バックアップファイルを選択").setInputFiles({
    name: "single-item-required.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        kind: "event-shopping-planner-backup",
        version: 1,
        exportedAt: "2026-11-10T00:00:00.000Z",
        eventSettings: { blockDetectionSettings: {} },
        data: {
          eventLists: { [eventName]: [seed] },
          eventMetadata: {},
          executeModeItems: { [eventName]: { "1日目": [seed.id] } },
          dayModes: { [eventName]: { "1日目": "edit" } },
          mapData: {},
          mapRotationSettings: {},
          mapViewportSettings: {},
          routeSettings: {},
          hallDefinitions: {},
          hallRouteSettings: {},
        },
      }),
      "utf8",
    ),
  });
  const restore = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await restore.getByRole("radio", { name: /同名で置換/ }).check();
  await restore
    .getByRole("button", { name: "置換して復元", exact: true })
    .click();
  await expect(restore).toBeHidden();
  await page.getByRole("button", { name: "アイテム追加", exact: true }).click();
  const form = page
    .locator("form")
    .filter({ has: page.locator("#singleCircle") });
  await expect(form).toHaveCount(1);
  const circle = form.getByRole("textbox", {
    name: "サークル名（必須）",
    exact: true,
  });
  const title = form.getByRole("textbox", { name: "タイトル", exact: true });
  const remarks = form.getByRole("textbox", { name: "備考", exact: true });
  const send = form.getByRole("button", { name: "リストに追加", exact: true });
  await expect(circle).toHaveAttribute("required", "");
  await title.fill("保持するタイトル");
  await remarks.fill("保持するメモ");
  await form.getByLabel("参加日", { exact: true }).selectOption("2日目");
  await form.getByLabel("ブロック", { exact: true }).fill("東B");
  await form.getByLabel("ナンバー", { exact: true }).fill("12a");
  await form.evaluate((node) => {
    const counts = { invalid: 0, submit: 0 };
    Object.assign(window, { singleItemValidationCounts: counts });
    node.addEventListener(
      "invalid",
      () => {
        counts.invalid++;
      },
      true,
    );
    node.addEventListener("submit", () => {
      counts.submit++;
    });
  });
  for (const value of ["", "   ", "　　"]) {
    await circle.fill(value);
    await send.click();
    await expect(form.getByRole("alert")).toHaveText(
      "サークル名を入力してください。",
    );
    await expect(circle).toHaveAttribute("aria-invalid", "true");
    await expect(circle).toHaveAttribute(
      "aria-describedby",
      "singleCircleError",
    );
    await expect(circle).toBeFocused();
    await expect(circle).toHaveValue(value);
    await expect(title).toHaveValue("保持するタイトル");
    await expect(remarks).toHaveValue("保持するメモ");
    await expect(form.getByLabel("参加日", { exact: true })).toHaveValue(
      "2日目",
    );
    await expect(form.getByLabel("ブロック", { exact: true })).toHaveValue(
      "東B",
    );
    await expect(form.getByLabel("ナンバー", { exact: true })).toHaveValue(
      "12a",
    );
    expect((await readBrowserEventLists(page))[eventName]).toEqual([seed]);
    await remarks.fill("変更したメモ");
    await expect(form.getByRole("alert")).toBeVisible();
    await remarks.fill("保持するメモ");
  }
  expect(
    await page.evaluate(
      () =>
        (window as Window & { singleItemValidationCounts?: unknown })
          .singleItemValidationCounts,
    ),
  ).toEqual({ invalid: 1, submit: 2 });
  await circle.fill("　日本語サークル　");
  await expect(form.getByRole("alert")).toHaveCount(0);
  await expect(circle).toHaveValue("　日本語サークル　");
  await expect(circle).not.toHaveAttribute("aria-invalid");
  await title.fill("");
  await send.click();
  const review = page.getByRole("dialog", {
    name: "所属・配置の変更を確認",
    exact: true,
  });
  await expect
    .poll(
      async () =>
        (await review.isVisible()) ||
        (await readBrowserEventLists(page))[eventName]?.length === 2,
    )
    .toBe(true);
  if (await review.isVisible())
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
  await expect
    .poll(async () => (await readBrowserEventLists(page))[eventName]?.length)
    .toBe(2);
  await page.reload();
  const saved = (await readBrowserEventLists(page))[eventName];
  expect(saved).toHaveLength(2);
  expect(saved.find((entry) => entry.id === seed.id)).toEqual(seed);
  expect(
    saved.find((entry) => entry.circle === "日本語サークル"),
  ).toMatchObject({
    circle: "日本語サークル",
    title: "",
    remarks: "保持するメモ",
    eventDate: "2日目",
    block: "東B",
    number: "12a",
  });
  expect(errors).toEqual([]);
});
