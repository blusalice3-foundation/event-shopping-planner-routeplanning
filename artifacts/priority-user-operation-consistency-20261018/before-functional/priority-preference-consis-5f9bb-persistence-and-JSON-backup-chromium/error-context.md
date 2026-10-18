# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: priority-preference-consistency.spec.ts >> localStorage quota failures preserve the app, current settings, item persistence and JSON backup
- Location: tests\browser\priority-preference-consistency.spec.ts:78:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByText('設定保存障害の検証', { exact: true })

```

# Test source

```ts
  1   | import { readFile } from "node:fs/promises";
  2   | import { expect, test, type Page } from "@playwright/test";
  3   | 
  4   | const eventName = "設定保存障害の検証";
  5   | const sourceItem = {
  6   |   id: "preference-item",
  7   |   circle: "ユーザー登録",
  8   |   title: "設定障害中の新刊",
  9   |   eventDate: "1日目",
  10  |   block: "A",
  11  |   number: "1",
  12  |   price: 500,
  13  |   purchaseStatus: "None",
  14  |   quantity: 1,
  15  |   remarks: "既存メモ",
  16  | };
  17  | async function seed(page: Page) {
  18  |   await page.goto("/");
  19  |   await page
  20  |     .locator('input[aria-label="バックアップファイルを選択"]')
  21  |     .setInputFiles({
  22  |       name: "preference-failure.json",
  23  |       mimeType: "application/json",
  24  |       buffer: Buffer.from(
  25  |         JSON.stringify({
  26  |           kind: "event-shopping-planner-backup",
  27  |           version: 1,
  28  |           exportedAt: "2026-10-18T00:00:00.000Z",
  29  |           eventSettings: { blockDetectionSettings: {} },
  30  |           data: {
  31  |             eventLists: { [eventName]: [sourceItem] },
  32  |             eventMetadata: {},
  33  |             executeModeItems: { [eventName]: { "1日目": [sourceItem.id] } },
  34  |             dayModes: { [eventName]: { "1日目": "edit" } },
  35  |             mapData: {},
  36  |             mapRotationSettings: {},
  37  |             mapViewportSettings: {},
  38  |             routeSettings: {},
  39  |             hallDefinitions: {},
  40  |             hallRouteSettings: {},
  41  |           },
  42  |         }),
  43  |         "utf8",
  44  |       ),
  45  |     });
  46  |   const restore = page.getByRole("dialog", {
  47  |     name: "バックアップからイベントを復元",
  48  |   });
  49  |   await restore.getByRole("radio", { name: /同名で置換/ }).check();
  50  |   await restore.getByRole("button", { name: "置換して復元" }).click();
  51  |   await expect(restore).toBeHidden();
  52  |   await expect(page.locator(`[data-item-id="${sourceItem.id}"]`)).toBeVisible();
  53  | }
  54  | async function storedItems(page: Page) {
  55  |   return page.evaluate(async () => {
  56  |     const database = await new Promise<IDBDatabase>((resolve, reject) => {
  57  |       const request = indexedDB.open("EventShoppingPlannerDB");
  58  |       request.onsuccess = () => resolve(request.result);
  59  |       request.onerror = () => reject(request.error);
  60  |     });
  61  |     try {
  62  |       return await new Promise<Record<string, (typeof sourceItem)[]>>(
  63  |         (resolve, reject) => {
  64  |           const request = database
  65  |             .transaction("eventLists", "readonly")
  66  |             .objectStore("eventLists")
  67  |             .get("data");
  68  |           request.onsuccess = () => resolve(request.result);
  69  |           request.onerror = () => reject(request.error);
  70  |         },
  71  |       );
  72  |     } finally {
  73  |       database.close();
  74  |     }
  75  |   });
  76  | }
  77  | 
  78  | test("localStorage quota failures preserve the app, current settings, item persistence and JSON backup", async ({
  79  |   page,
  80  | }) => {
  81  |   const errors: string[] = [];
  82  |   page.on("pageerror", (error) => errors.push(error.message));
  83  |   await seed(page);
  84  |   await page.addInitScript(() => {
  85  |     const set = Storage.prototype.setItem;
  86  |     Object.assign(window, { __preferenceWriteAttempts: [] as string[] });
  87  |     Storage.prototype.setItem = function (key, value) {
  88  |       if (this === window.localStorage) {
  89  |         (
  90  |           window as unknown as { __preferenceWriteAttempts: string[] }
  91  |         ).__preferenceWriteAttempts.push(key);
  92  |         throw new DOMException("Injected quota failure", "QuotaExceededError");
  93  |       }
  94  |       return set.call(this, key, value);
  95  |     };
  96  |   });
  97  |   await page.reload();
> 98  |   await page.getByText(eventName, { exact: true }).click();
      |                                                    ^ Error: locator.click: Test timeout of 30000ms exceeded.
  99  |   await expect(page.locator(`[data-item-id="${sourceItem.id}"]`)).toBeVisible();
  100 |   await page.getByTitle("表示項目の設定", { exact: true }).click();
  101 |   await page
  102 |     .getByTitle("システム設定 → ライトモードへ", { exact: true })
  103 |     .click();
  104 |   await page
  105 |     .getByTitle("ライトモード → ダークモードへ", { exact: true })
  106 |     .click();
  107 |   await expect(page.locator("html")).toHaveClass(/dark/);
  108 |   await page.getByRole("radio", { name: "直角", exact: true }).check();
  109 |   await expect(
  110 |     page.getByRole("radio", { name: "直角", exact: true }),
  111 |   ).toBeChecked();
  112 |   await page.getByRole("checkbox", { name: /^保存状態を表示/ }).uncheck();
  113 |   await page
  114 |     .locator("div.fixed.inset-0.z-40")
  115 |     .first()
  116 |     .click({ position: { x: 2, y: 100 } });
  117 |   await page.getByTitle("表示項目の設定", { exact: true }).click();
  118 |   await expect(
  119 |     page.getByRole("checkbox", { name: /^保存状態を表示/ }),
  120 |   ).not.toBeChecked();
  121 |   await expect(
  122 |     page.getByRole("radio", { name: "直角", exact: true }),
  123 |   ).toBeChecked();
  124 |   await page
  125 |     .locator("div.fixed.inset-0.z-40")
  126 |     .first()
  127 |     .click({ position: { x: 2, y: 100 } });
  128 |   await page
  129 |     .locator(`[data-item-id="${sourceItem.id}"]`)
  130 |     .getByRole("textbox", { name: "利用者メモ" })
  131 |     .fill("設定障害中に保存したメモ");
  132 |   await expect
  133 |     .poll(async () => (await storedItems(page))[eventName][0].remarks)
  134 |     .toBe("設定障害中に保存したメモ");
  135 |   await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  136 |   const download = page.waitForEvent("download");
  137 |   await page
  138 |     .getByRole("button", { name: "JSONバックアップ保存", exact: true })
  139 |     .click();
  140 |   const file = await download;
  141 |   const saved = JSON.parse(await readFile((await file.path())!, "utf8"));
  142 |   expect(saved.data.eventLists[eventName][0]).toMatchObject({
  143 |     id: sourceItem.id,
  144 |     remarks: "設定障害中に保存したメモ",
  145 |   });
  146 |   expect(
  147 |     await page.evaluate(
  148 |       () =>
  149 |         (window as unknown as { __preferenceWriteAttempts: string[] })
  150 |           .__preferenceWriteAttempts,
  151 |     ),
  152 |   ).toEqual(
  153 |     expect.arrayContaining([
  154 |       "themeMode",
  155 |       "uiVisibilitySettings",
  156 |       "numberCellOutlineStyle",
  157 |     ]),
  158 |   );
  159 |   await page.reload();
  160 |   await page.getByText(eventName, { exact: true }).click();
  161 |   await expect(page.getByRole("textbox", { name: "利用者メモ" })).toHaveValue(
  162 |     "設定障害中に保存したメモ",
  163 |   );
  164 |   expect(errors).toEqual([]);
  165 | });
  166 | 
  167 | for (const kind of ["read", "getter"] as const) {
  168 |   test(`unavailable localStorage ${kind} retains a visible app and backup failure guidance`, async ({
  169 |     page,
  170 |   }, testInfo) => {
  171 |     const errors: string[] = [];
  172 |     page.on("pageerror", (error) => errors.push(error.message));
  173 |     await seed(page);
  174 |     const before = await storedItems(page);
  175 |     await page.addInitScript((kind) => {
  176 |       if (kind === "getter") {
  177 |         Object.defineProperty(window, "localStorage", {
  178 |           configurable: true,
  179 |           get() {
  180 |             throw new DOMException(
  181 |               "Injected storage getter failure",
  182 |               "SecurityError",
  183 |             );
  184 |           },
  185 |         });
  186 |       } else {
  187 |         const local = window.localStorage;
  188 |         const get = Storage.prototype.getItem;
  189 |         const key = Storage.prototype.key;
  190 |         Storage.prototype.getItem = function (name) {
  191 |           if (this === local)
  192 |             throw new DOMException(
  193 |               "Injected storage read failure",
  194 |               "SecurityError",
  195 |             );
  196 |           return get.call(this, name);
  197 |         };
  198 |         Storage.prototype.key = function (index) {
```