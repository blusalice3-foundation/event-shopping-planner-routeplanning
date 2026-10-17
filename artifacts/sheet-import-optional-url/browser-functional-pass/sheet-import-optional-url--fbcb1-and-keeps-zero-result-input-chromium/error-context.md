# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sheet-import-optional-url.spec.ts >> sheet import and optional URL: worker >> new URL import excludes incomplete rows, saves no-URL items and keeps zero-result input
- Location: tests\browser\sheet-import-optional-url.spec.ts:191:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('listitem').filter({ hasText: '取込互換検証' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('listitem').filter({ hasText: '取込互換検証' })

```

```yaml
- banner:
  - heading "取込互換検証" [level=1]
  - button "候補ブロックを番号で並べ替え":
    - img
  - button "ホール定義（ブロック割当）":
    - img
  - button "表示項目の設定":
    - img
  - button "📝"
  - button "🏃‍♂️"
  - button "🔍"
  - button "イベント一覧"
  - button "1日目3"
  - button "アイテム追加"
  - textbox "検索..."
  - button "次を検索" [disabled]
- main:
  - heading "実行リストアイテム" [level=2]
  - button "スペース別"
  - paragraph: 実行対象として選択中のアイテムを管理します。
  - list "買い物リスト"
  - heading "候補アイテム" [level=2]
  - paragraph: このリストから選択したアイテムを実行リストへ移動します。
  - text: "ブロックでフィルタ:"
  - button "A"
  - list "買い物リスト":
    - listitem "A1 サークル1 新刊1":
      - checkbox "Select item サークル1 - 新刊1"
      - button "上に移動" [disabled]:
        - img
      - img
      - button "下に移動":
        - img
      - button "保護なし": 🔓
      - text: 1日目 A-1
      - button "サークル1"
      - button "新刊1"
      - text: "カタログ価格: 500円 シート備考: ユーザー登録"
      - textbox "利用者メモ": ユーザー登録
      - 'button "Current status: 未購入. Click to change."':
        - img
        - text: 未購入
      - text: 数量
      - combobox "購入予定数量":
        - option "1"
        - option "2" [selected]
        - option "3"
        - option "4"
        - option "5"
        - option "6"
        - option "7"
        - option "8"
        - option "9"
        - option "10"
        - option "11"
        - option "12"
        - option "13"
        - option "14"
        - option "15"
        - option "16"
        - option "17"
        - option "18"
        - option "19"
        - option "20"
      - text: 購入金額 ¥
      - combobox "購入金額":
        - option "価格未定"
        - option "0"
        - option "100"
        - option "200"
        - option "300"
        - option "400"
        - option "500" [selected]
        - option "600"
        - option "700"
        - option "800"
        - option "900"
        - option "1,000"
        - option "1,100"
        - option "1,200"
        - option "1,300"
        - option "1,400"
        - option "1,500"
        - option "1,600"
        - option "1,700"
        - option "1,800"
        - option "1,900"
        - option "2,000"
        - option "2,100"
        - option "2,200"
        - option "2,300"
        - option "2,400"
        - option "2,500"
        - option "2,600"
        - option "2,700"
        - option "2,800"
        - option "2,900"
        - option "3,000"
        - option "3,100"
        - option "3,200"
        - option "3,300"
        - option "3,400"
        - option "3,500"
        - option "3,600"
        - option "3,700"
        - option "3,800"
        - option "3,900"
        - option "4,000"
        - option "4,100"
        - option "4,200"
        - option "4,300"
        - option "4,400"
        - option "4,500"
        - option "4,600"
        - option "4,700"
        - option "4,800"
        - option "4,900"
        - option "5,000"
        - option "5,100"
        - option "5,200"
        - option "5,300"
        - option "5,400"
        - option "5,500"
        - option "5,600"
        - option "5,700"
        - option "5,800"
        - option "5,900"
        - option "6,000"
        - option "6,100"
        - option "6,200"
        - option "6,300"
        - option "6,400"
        - option "6,500"
        - option "6,600"
        - option "6,700"
        - option "6,800"
        - option "6,900"
        - option "7,000"
        - option "7,100"
        - option "7,200"
        - option "7,300"
        - option "7,400"
        - option "7,500"
        - option "7,600"
        - option "7,700"
        - option "7,800"
        - option "7,900"
        - option "8,000"
        - option "8,100"
        - option "8,200"
        - option "8,300"
        - option "8,400"
        - option "8,500"
        - option "8,600"
        - option "8,700"
        - option "8,800"
        - option "8,900"
        - option "9,000"
        - option "9,100"
        - option "9,200"
        - option "9,300"
        - option "9,400"
        - option "9,500"
        - option "9,600"
        - option "9,700"
        - option "9,800"
        - option "9,900"
        - option "10,000"
    - listitem "A2 サークル2 新刊2":
      - checkbox "Select item サークル2 - 新刊2"
      - button "上に移動":
        - img
      - img
      - button "下に移動":
        - img
      - button "保護なし": 🔓
      - text: 1日目 A-2
      - button "サークル2"
      - button "新刊2"
      - text: "カタログ価格: 500円 シート備考: ユーザー登録"
      - textbox "利用者メモ": ユーザー登録
      - 'button "Current status: 未購入. Click to change."':
        - img
        - text: 未購入
      - text: 数量
      - combobox "購入予定数量":
        - option "1"
        - option "2" [selected]
        - option "3"
        - option "4"
        - option "5"
        - option "6"
        - option "7"
        - option "8"
        - option "9"
        - option "10"
        - option "11"
        - option "12"
        - option "13"
        - option "14"
        - option "15"
        - option "16"
        - option "17"
        - option "18"
        - option "19"
        - option "20"
      - text: 購入金額 ¥
      - combobox "購入金額":
        - option "価格未定"
        - option "0"
        - option "100"
        - option "200"
        - option "300"
        - option "400"
        - option "500" [selected]
        - option "600"
        - option "700"
        - option "800"
        - option "900"
        - option "1,000"
        - option "1,100"
        - option "1,200"
        - option "1,300"
        - option "1,400"
        - option "1,500"
        - option "1,600"
        - option "1,700"
        - option "1,800"
        - option "1,900"
        - option "2,000"
        - option "2,100"
        - option "2,200"
        - option "2,300"
        - option "2,400"
        - option "2,500"
        - option "2,600"
        - option "2,700"
        - option "2,800"
        - option "2,900"
        - option "3,000"
        - option "3,100"
        - option "3,200"
        - option "3,300"
        - option "3,400"
        - option "3,500"
        - option "3,600"
        - option "3,700"
        - option "3,800"
        - option "3,900"
        - option "4,000"
        - option "4,100"
        - option "4,200"
        - option "4,300"
        - option "4,400"
        - option "4,500"
        - option "4,600"
        - option "4,700"
        - option "4,800"
        - option "4,900"
        - option "5,000"
        - option "5,100"
        - option "5,200"
        - option "5,300"
        - option "5,400"
        - option "5,500"
        - option "5,600"
        - option "5,700"
        - option "5,800"
        - option "5,900"
        - option "6,000"
        - option "6,100"
        - option "6,200"
        - option "6,300"
        - option "6,400"
        - option "6,500"
        - option "6,600"
        - option "6,700"
        - option "6,800"
        - option "6,900"
        - option "7,000"
        - option "7,100"
        - option "7,200"
        - option "7,300"
        - option "7,400"
        - option "7,500"
        - option "7,600"
        - option "7,700"
        - option "7,800"
        - option "7,900"
        - option "8,000"
        - option "8,100"
        - option "8,200"
        - option "8,300"
        - option "8,400"
        - option "8,500"
        - option "8,600"
        - option "8,700"
        - option "8,800"
        - option "8,900"
        - option "9,000"
        - option "9,100"
        - option "9,200"
        - option "9,300"
        - option "9,400"
        - option "9,500"
        - option "9,600"
        - option "9,700"
        - option "9,800"
        - option "9,900"
        - option "10,000"
    - listitem "A3 サークル3 新刊3":
      - checkbox "Select item サークル3 - 新刊3"
      - button "上に移動":
        - img
      - img
      - button "下に移動" [disabled]:
        - img
      - button "保護なし": 🔓
      - text: 1日目 A-3
      - button "サークル3"
      - button "新刊3"
      - text: "カタログ価格: 500円 シート備考: ユーザー登録"
      - textbox "利用者メモ": ユーザー登録
      - 'button "Current status: 未購入. Click to change."':
        - img
        - text: 未購入
      - text: 数量
      - combobox "購入予定数量":
        - option "1"
        - option "2" [selected]
        - option "3"
        - option "4"
        - option "5"
        - option "6"
        - option "7"
        - option "8"
        - option "9"
        - option "10"
        - option "11"
        - option "12"
        - option "13"
        - option "14"
        - option "15"
        - option "16"
        - option "17"
        - option "18"
        - option "19"
        - option "20"
      - text: 購入金額 ¥
      - combobox "購入金額":
        - option "価格未定"
        - option "0"
        - option "100"
        - option "200"
        - option "300"
        - option "400"
        - option "500" [selected]
        - option "600"
        - option "700"
        - option "800"
        - option "900"
        - option "1,000"
        - option "1,100"
        - option "1,200"
        - option "1,300"
        - option "1,400"
        - option "1,500"
        - option "1,600"
        - option "1,700"
        - option "1,800"
        - option "1,900"
        - option "2,000"
        - option "2,100"
        - option "2,200"
        - option "2,300"
        - option "2,400"
        - option "2,500"
        - option "2,600"
        - option "2,700"
        - option "2,800"
        - option "2,900"
        - option "3,000"
        - option "3,100"
        - option "3,200"
        - option "3,300"
        - option "3,400"
        - option "3,500"
        - option "3,600"
        - option "3,700"
        - option "3,800"
        - option "3,900"
        - option "4,000"
        - option "4,100"
        - option "4,200"
        - option "4,300"
        - option "4,400"
        - option "4,500"
        - option "4,600"
        - option "4,700"
        - option "4,800"
        - option "4,900"
        - option "5,000"
        - option "5,100"
        - option "5,200"
        - option "5,300"
        - option "5,400"
        - option "5,500"
        - option "5,600"
        - option "5,700"
        - option "5,800"
        - option "5,900"
        - option "6,000"
        - option "6,100"
        - option "6,200"
        - option "6,300"
        - option "6,400"
        - option "6,500"
        - option "6,600"
        - option "6,700"
        - option "6,800"
        - option "6,900"
        - option "7,000"
        - option "7,100"
        - option "7,200"
        - option "7,300"
        - option "7,400"
        - option "7,500"
        - option "7,600"
        - option "7,700"
        - option "7,800"
        - option "7,900"
        - option "8,000"
        - option "8,100"
        - option "8,200"
        - option "8,300"
        - option "8,400"
        - option "8,500"
        - option "8,600"
        - option "8,700"
        - option "8,800"
        - option "8,900"
        - option "9,000"
        - option "9,100"
        - option "9,200"
        - option "9,300"
        - option "9,400"
        - option "9,500"
        - option "9,600"
        - option "9,700"
        - option "9,800"
        - option "9,900"
        - option "10,000"
- status "保存済み"
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | import {
  3   |   sheetCsv,
  4   |   sheetSnapshot,
  5   |   SHEET_EVENT,
  6   | } from "../../src/test/sheetImportOptionalUrlFixtures";
  7   | 
  8   | async function stored(page: Page, name: string) {
  9   |   return page.evaluate(async (name) => {
  10  |     const database = await new Promise<IDBDatabase>((resolve, reject) => {
  11  |       const request = indexedDB.open("EventShoppingPlannerDB");
  12  |       request.onsuccess = () => resolve(request.result);
  13  |       request.onerror = () => reject(request.error);
  14  |     });
  15  |     try {
  16  |       return await new Promise<Record<string, unknown>>((resolve, reject) => {
  17  |         const request = database
  18  |           .transaction(name)
  19  |           .objectStore(name)
  20  |           .get("data");
  21  |         request.onsuccess = () => resolve(request.result);
  22  |         request.onerror = () => reject(request.error);
  23  |       });
  24  |     } finally {
  25  |       database.close();
  26  |     }
  27  |   }, name);
  28  | }
  29  | async function restore(
  30  |   page: Page,
  31  |   count = 4,
  32  |   mode: "edit" | "execute" | "focus" = "edit",
  33  |   source = true,
  34  | ) {
  35  |   const data = sheetSnapshot(count);
  36  |   if (count) data.eventLists[SHEET_EVENT][0].protectionLevel = "full";
  37  |   data.dayModes[SHEET_EVENT]["1日目"] = mode;
  38  |   if (source)
  39  |     data.eventMetadata[SHEET_EVENT] = {
  40  |       spreadsheetUrl: "https://docs.google.com/spreadsheets/d/original/edit",
  41  |       spreadsheetSheetName: "品目表",
  42  |       lastImportDate: "",
  43  |     };
  44  |   await page.goto("/");
  45  |   await page.getByLabel("バックアップファイルを選択").setInputFiles({
  46  |     name: "fixture.json",
  47  |     mimeType: "application/json",
  48  |     buffer: Buffer.from(
  49  |       JSON.stringify({
  50  |         kind: "event-shopping-planner-backup",
  51  |         version: 2,
  52  |         exportedAt: "2026-10-17T00:00:00.000Z",
  53  |         data,
  54  |       }),
  55  |     ),
  56  |   });
  57  |   const dialog = page.getByRole("dialog", {
  58  |     name: "バックアップからイベントを復元",
  59  |   });
  60  |   await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  61  |   await dialog.getByRole("button", { name: "置換して復元" }).click();
  62  |   await expect(dialog).toBeHidden();
  63  |   await expect(
  64  |     page.getByRole("heading", { name: SHEET_EVENT, exact: true }),
  65  |   ).toBeVisible();
  66  | }
  67  | async function finishAddition(page: Page, newEvent = false) {
  68  |   const review = page.getByRole("dialog", {
  69  |     name: "所属・配置の変更を確認",
  70  |     exact: true,
  71  |   });
  72  |   await expect
  73  |     .poll(
  74  |       async () =>
  75  |         (await review.isVisible()) ||
  76  |         (
  77  |           (await stored(page, "eventLists"))[SHEET_EVENT] as
  78  |             | unknown[]
  79  |             | undefined
  80  |         )?.length === 3,
  81  |     )
  82  |     .toBe(true);
  83  |   if (await review.isVisible())
  84  |     await review
  85  |       .getByRole("button", { name: "確認して保存", exact: true })
  86  |       .click();
  87  |   await expect
  88  |     .poll(async () => (await stored(page, "eventLists"))[SHEET_EVENT])
  89  |     .toHaveLength(3);
  90  |   await expect(
  91  |     newEvent
  92  |       ? page.getByRole("listitem").filter({ hasText: SHEET_EVENT })
  93  |       : page.getByRole("heading", { name: SHEET_EVENT, exact: true }),
> 94  |   ).toBeVisible();
      |     ^ Error: expect(locator).toBeVisible() failed
  95  | }
  96  | for (const storage of ["direct", "worker"])
  97  |   test.describe(`sheet import and optional URL: ${storage}`, () => {
  98  |     test.use({ serviceWorkers: "block" });
  99  |     test.beforeEach(async ({ page }) => {
  100 |       if (storage === "direct")
  101 |         await page.addInitScript(() => {
  102 |           Object.defineProperty(window, "Worker", {
  103 |             value: undefined,
  104 |             configurable: true,
  105 |           });
  106 |         });
  107 |       page.on("dialog", (dialog) => dialog.accept());
  108 |     });
  109 |     for (const count of [150, 500])
  110 |       for (const kind of ["items-only", "source-switch"] as const) {
  111 |         test(`${kind} ${count}: ordinary exclusions survive the real event-list review, cancellation and save/reload`, async ({
  112 |           page,
  113 |         }) => {
  114 |           await page.route("**/api/google-sheets-csv", (route) =>
  115 |             route.fulfill({
  116 |               status: 200,
  117 |               contentType: "text/csv; charset=utf-8",
  118 |               body: sheetCsv(count, "excluded"),
  119 |             }),
  120 |           );
  121 |           await restore(page, count, "edit", kind === "items-only");
  122 |           const open = async () => {
  123 |             const list = page.getByRole("button", {
  124 |               name: "イベント一覧",
  125 |               exact: true,
  126 |             });
  127 |             if (await list.isVisible()) await list.click();
  128 |             await page
  129 |               .getByRole("button", { name: "メニュー", exact: true })
  130 |               .click();
  131 |             await page
  132 |               .getByRole("button", { name: "🔄 アイテム更新", exact: true })
  133 |               .click();
  134 |             if (kind === "source-switch") {
  135 |               await page
  136 |                 .getByRole("textbox", {
  137 |                   name: "スプレッドシートURL",
  138 |                   exact: true,
  139 |                 })
  140 |                 .fill("https://docs.google.com/spreadsheets/d/new/edit");
  141 |               await page
  142 |                 .getByRole("button", { name: "更新", exact: true })
  143 |                 .click();
  144 |             }
  145 |           };
  146 |           await open();
  147 |           const summary = page.getByRole("region", { name: "シート取込結果" });
  148 |           await expect(summary).toContainText(
  149 |             `取込対象: 0件、必須項目不足による除外: ${count}行`,
  150 |           );
  151 |           await expect(summary.locator("li")).toHaveCount(20);
  152 |           await expect(
  153 |             page.getByText(`削除候補: ${count - 1}件、削除から保護: 1件`, {
  154 |               exact: true,
  155 |             }),
  156 |           ).toBeVisible();
  157 |           const before = await stored(page, "eventLists");
  158 |           const metadata = await stored(page, "eventMetadata");
  159 |           await page
  160 |             .getByRole("button", { name: "キャンセル", exact: true })
  161 |             .last()
  162 |             .click();
  163 |           expect(await stored(page, "eventLists")).toEqual(before);
  164 |           expect(await stored(page, "eventMetadata")).toEqual(metadata);
  165 |           await open();
  166 |           const confirm = page.getByRole("button", {
  167 |             name:
  168 |               kind === "source-switch"
  169 |                 ? "更新元を切り替えて更新"
  170 |                 : "更新を実行",
  171 |             exact: true,
  172 |           });
  173 |           await expect(confirm).toBeEnabled();
  174 |           await confirm.click();
  175 |           await expect(summary).toBeHidden();
  176 |           await expect
  177 |             .poll(async () => (await stored(page, "eventLists"))[SHEET_EVENT])
  178 |             .toHaveLength(1);
  179 |           await page.reload();
  180 |           expect((await stored(page, "eventLists"))[SHEET_EVENT]).toEqual([
  181 |             expect.objectContaining({ id: "item-0", protectionLevel: "full" }),
  182 |           ]);
  183 |           if (kind === "source-switch")
  184 |             expect(
  185 |               (await stored(page, "eventMetadata"))[SHEET_EVENT],
  186 |             ).toMatchObject({
  187 |               spreadsheetUrl: "https://docs.google.com/spreadsheets/d/new/edit",
  188 |             });
  189 |         });
  190 |       }
  191 |     test("new URL import excludes incomplete rows, saves no-URL items and keeps zero-result input", async ({
  192 |       page,
  193 |     }) => {
  194 |       let csv = sheetCsv(4, "excluded");
```