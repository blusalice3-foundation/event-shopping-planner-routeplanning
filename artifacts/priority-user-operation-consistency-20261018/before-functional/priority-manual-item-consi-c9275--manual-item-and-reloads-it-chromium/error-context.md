# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: priority-manual-item-consistency.spec.ts >> deletes the last item, reopens the saved empty event, adds a corrected manual item, and reloads it
- Location: tests\browser\priority-manual-item-consistency.spec.ts:38:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: 'リストに追加', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('button', { name: 'リストに追加', exact: true })

```

```yaml
- banner:
  - heading "即売会購入巡回表" [level=1]
  - button "表示項目の設定":
    - img
  - button "イベント一覧"
  - button "新規リスト作成"
- main:
  - heading "保存済みの即売会リスト" [level=2]
  - button "Excel取り込み":
    - img
    - text: Excel取り込み
  - button "JSONバックアップ保存":
    - img
    - text: JSONバックアップ保存
  - button "JSONバックアップ復元":
    - img
    - text: JSONバックアップ復元
  - list:
    - listitem:
      - text: 0件イベントの追加再開
      - button "メニュー":
        - img
- status "保存済み"
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | 
  3   | const eventName = "0件イベントの追加再開";
  4   | const backup = {
  5   |   kind: "event-shopping-planner-backup",
  6   |   version: 1,
  7   |   exportedAt: "2026-10-18T00:00:00.000Z",
  8   |   eventSettings: { blockDetectionSettings: {} },
  9   |   data: {
  10  |     eventLists: {
  11  |       [eventName]: [
  12  |         {
  13  |           id: "last-item",
  14  |           circle: "削除するサークル",
  15  |           title: "最後の品目",
  16  |           eventDate: "1日目",
  17  |           block: "A",
  18  |           number: "1",
  19  |           price: 500,
  20  |           purchaseStatus: "None",
  21  |           quantity: 1,
  22  |           remarks: "ユーザー登録",
  23  |         },
  24  |       ],
  25  |     },
  26  |     eventMetadata: {},
  27  |     executeModeItems: { [eventName]: { "1日目": ["last-item"] } },
  28  |     dayModes: { [eventName]: { "1日目": "edit", "2日目": "edit" } },
  29  |     mapData: {},
  30  |     mapRotationSettings: {},
  31  |     mapViewportSettings: {},
  32  |     routeSettings: {},
  33  |     hallDefinitions: {},
  34  |     hallRouteSettings: {},
  35  |   },
  36  | };
  37  | 
  38  | test("deletes the last item, reopens the saved empty event, adds a corrected manual item, and reloads it", async ({
  39  |   page,
  40  | }) => {
  41  |   await page.goto("/");
  42  |   await page
  43  |     .locator('input[aria-label="バックアップファイルを選択"]')
  44  |     .setInputFiles({
  45  |       name: "empty-event-reentry.json",
  46  |       mimeType: "application/json",
  47  |       buffer: Buffer.from(JSON.stringify(backup), "utf8"),
  48  |     });
  49  |   const restore = page.getByRole("dialog", {
  50  |     name: "バックアップからイベントを復元",
  51  |   });
  52  |   await restore.getByRole("radio", { name: /同名で置換/ }).check();
  53  |   await restore.getByRole("button", { name: "置換して復元" }).click();
  54  |   await expect(restore).toBeHidden();
  55  |   const card = page
  56  |     .locator('[data-item-id="last-item"]')
  57  |     .locator(":scope > div.rounded-lg")
  58  |     .first();
  59  |   await expect(card).toBeVisible();
  60  |   await card.dispatchEvent("pointerdown", {
  61  |     button: 0,
  62  |     isPrimary: true,
  63  |     pointerType: "mouse",
  64  |   });
  65  |   await expect(
  66  |     page.getByRole("button", { name: "削除", exact: true }),
  67  |   ).toBeVisible();
  68  |   await card.dispatchEvent("pointerup", {
  69  |     button: 0,
  70  |     isPrimary: true,
  71  |     pointerType: "mouse",
  72  |   });
  73  |   await page.getByRole("button", { name: "削除", exact: true }).click();
  74  |   const deletion = page.getByRole("dialog", { name: "アイテムを削除" });
  75  |   await deletion.getByRole("button", { name: "Yes", exact: true }).click();
  76  |   await expect(deletion).toBeHidden();
  77  |   await expect(page.locator('[data-item-id="last-item"]')).toHaveCount(0);
  78  |   await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  79  |   await page.getByText(eventName, { exact: true }).click();
  80  |   await expect(
  81  |     page.getByRole("button", { name: "リストに追加", exact: true }),
> 82  |   ).toBeVisible();
      |     ^ Error: expect(locator).toBeVisible() failed
  83  |   await page.getByLabel("サークル名", { exact: true }).fill("追加後のサークル");
  84  |   await page.getByLabel("タイトル", { exact: true }).fill("再開した新刊");
  85  |   await page.getByLabel("備考", { exact: true }).fill("保持するメモ");
  86  |   await page.getByLabel("参加日", { exact: true }).selectOption("__custom__");
  87  |   await page.getByLabel("参加日", { exact: true }).fill("　 ");
  88  |   await page.getByRole("button", { name: "リストに追加", exact: true }).click();
  89  |   await expect(page.getByRole("alert")).toHaveText(
  90  |     "参加日を入力してください。",
  91  |   );
  92  |   await expect(page.getByLabel("参加日", { exact: true })).toBeFocused();
  93  |   await expect(page.getByLabel("タイトル", { exact: true })).toHaveValue(
  94  |     "再開した新刊",
  95  |   );
  96  |   await expect(page.getByLabel("備考", { exact: true })).toHaveValue(
  97  |     "保持するメモ",
  98  |   );
  99  |   await page.getByLabel("参加日", { exact: true }).fill("前夜祭");
  100 |   await page.getByRole("button", { name: "リストに追加", exact: true }).click();
  101 |   await expect(
  102 |     page.getByRole("heading", { name: eventName, exact: true }),
  103 |   ).toBeVisible();
  104 |   await expect(
  105 |     page.getByText("追加後のサークル", { exact: true }),
  106 |   ).toBeVisible();
  107 |   await page.reload();
  108 |   await page.getByText(eventName, { exact: true }).click();
  109 |   await expect(
  110 |     page.getByRole("button", { name: "前夜祭", exact: true }),
  111 |   ).toBeVisible();
  112 |   await expect(
  113 |     page.getByText("追加後のサークル", { exact: true }),
  114 |   ).toBeVisible();
  115 |   await expect(
  116 |     page.getByRole("textbox", { name: "利用者メモ", exact: true }),
  117 |   ).toHaveValue("保持するメモ");
  118 | });
  119 | 
```