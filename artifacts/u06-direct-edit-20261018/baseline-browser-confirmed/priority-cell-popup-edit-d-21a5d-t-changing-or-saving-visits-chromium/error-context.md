# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: priority-cell-popup-edit.spec.ts >> direct mouse click opens the real limited editor without changing or saving visits
- Location: tests\browser\priority-cell-popup-edit.spec.ts:238:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('dialog', { name: 'アイテム編集', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'アイテム編集', exact: true })

```

```yaml
- banner:
  - heading "セルからの限数編集" [level=1]
  - button "候補ブロックを番号で並べ替え":
    - img
  - button "リスト表示に切り替え":
    - img
  - button "表示項目の設定":
    - img
  - 'button "ルート表示: 有効"':
    - img
  - button "M":
    - img
    - text: M
  - button "回転操作を展開": ▸
  - text: 回転 0°
  - button "イベント一覧"
  - button "1日目1"
  - button "アイテム追加"
  - textbox "検索..."
  - button "次を検索" [disabled]
- main: 100%
- status "保存済み"
- dialog "A-1のアイテム一覧":
  - heading "A-1 （1件）" [level=2]
  - button "1 ○"
  - button "A-1のアイテム一覧を閉じる":
    - img
  - button "新規アイテム追加":
    - img
    - text: 新規アイテム追加
  - text: 限数サークル
  - paragraph: ユーザー登録の限数品目
  - paragraph: "購入金額: ¥500"
  - paragraph: "利用者メモ: エラーが発生しました、という誤動作を防ぐ検証"
  - text: 限数 タップで追加
  - button "限数を編集"
  - paragraph: 長押しで編集・削除
```

# Test source

```ts
  77  |       const database = await new Promise<IDBDatabase>((resolve, reject) => {
  78  |         const request = indexedDB.open("EventShoppingPlannerDB");
  79  |         request.onsuccess = () => resolve(request.result);
  80  |         request.onerror = () => reject(request.error);
  81  |       });
  82  |       try {
  83  |         const read = (store: string, key = "data") =>
  84  |           new Promise<unknown>((resolve, reject) => {
  85  |             const request = database
  86  |               .transaction(store, "readonly")
  87  |               .objectStore(store)
  88  |               .get(key);
  89  |             request.onsuccess = () => resolve(request.result);
  90  |             request.onerror = () => reject(request.error);
  91  |           });
  92  |         const [visits, lists] = await Promise.all([
  93  |           read(
  94  |             "executeModeItems",
  95  |             "__esp_internal__:day-record:v1:" +
  96  |               JSON.stringify([eventName, [day]]),
  97  |           ),
  98  |           read("eventLists"),
  99  |         ]);
  100 |         return {
  101 |           visits: (visits as { value: string[] }).value,
  102 |           item: (lists as Record<string, Array<{ id: string }>>)[
  103 |             eventName
  104 |           ].find((item) => item.id === "limited"),
  105 |         };
  106 |       } finally {
  107 |         database.close();
  108 |       }
  109 |     },
  110 |     { eventName, day },
  111 |   );
  112 | }
  113 | function popup(page: Page) {
  114 |   return page.getByRole("dialog", { name: "A-1のアイテム一覧", exact: true });
  115 | }
  116 | function detail(page: Page) {
  117 |   return page.getByRole("dialog", { name: "アイテム編集", exact: true });
  118 | }
  119 | async function restore(page: Page, visits = ["limited"]) {
  120 |   await observeWorker(page);
  121 |   await page.goto("/");
  122 |   await page
  123 |     .locator('input[aria-label="バックアップファイルを選択"]')
  124 |     .setInputFiles({
  125 |       name: "cell-popup-limited-edit.json",
  126 |       mimeType: "application/json",
  127 |       buffer: Buffer.from(
  128 |         JSON.stringify({
  129 |           kind: "event-shopping-planner-backup",
  130 |           version: 1,
  131 |           exportedAt: "2026-10-18T00:00:00.000Z",
  132 |           eventSettings: { blockDetectionSettings: {} },
  133 |           data: {
  134 |             eventLists: { [eventName]: [limitedItem] },
  135 |             eventMetadata: {},
  136 |             executeModeItems: { [eventName]: { [day]: visits } },
  137 |             dayModes: { [eventName]: { [day]: "edit" } },
  138 |             mapData: { [eventName]: { "1日目マップ": map } },
  139 |             mapRotationSettings: {},
  140 |             mapViewportSettings: {},
  141 |             routeSettings: {},
  142 |             hallDefinitions: {},
  143 |             hallRouteSettings: {},
  144 |           },
  145 |         }),
  146 |         "utf8",
  147 |       ),
  148 |     });
  149 |   const restoreDialog = page.getByRole("dialog", {
  150 |     name: "バックアップからイベントを復元",
  151 |   });
  152 |   await restoreDialog.getByRole("radio", { name: /同名で置換/ }).check();
  153 |   await restoreDialog.getByRole("button", { name: "置換して復元" }).click();
  154 |   await expect(restoreDialog).toBeHidden();
  155 |   await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  156 |   await expect
  157 |     .poll(async () => (await workerObservation(page)).pending)
  158 |     .toEqual([]);
  159 |   await expect
  160 |     .poll(async () => (await durableState(page)).visits)
  161 |     .toEqual(visits);
  162 |   expect(
  163 |     page
  164 |       .workers()
  165 |       .some((worker) => worker.url().includes("persistence.worker")),
  166 |   ).toBe(true);
  167 |   await page.evaluate(() => {
  168 |     (
  169 |       window as unknown as { __cellPopupEditWorker: WorkerObservation }
  170 |     ).__cellPopupEditWorker.mutations = [];
  171 |   });
  172 |   await page.locator("canvas").click({ position: { x: 42, y: 42 } });
  173 |   await expect(popup(page)).toBeVisible();
  174 | }
  175 | async function assertDetailAndCancel(page: Page, visits = ["limited"]) {
  176 |   const editor = detail(page);
> 177 |   await expect(editor).toBeVisible();
      |                        ^ Error: expect(locator).toBeVisible() failed
  178 |   await expect(popup(page)).toBeHidden();
  179 |   await expect(
  180 |     editor.getByRole("textbox", { name: "実購入数", exact: true }),
  181 |   ).toHaveValue("2");
  182 |   await expect(
  183 |     editor.getByRole("textbox", { name: "購入予定量", exact: true }),
  184 |   ).toHaveValue("5");
  185 |   await editor
  186 |     .getByRole("textbox", { name: "購入予定量", exact: true })
  187 |     .fill("6");
  188 |   await editor.getByRole("button", { name: "キャンセル", exact: true }).click();
  189 |   await expect(editor).toBeHidden();
  190 |   // Wait beyond the row's long-press timer, so leaked timers and delayed writes surface.
  191 |   await page.waitForTimeout(650);
  192 |   await expect(
  193 |     page.getByRole("button", { name: "✏️ 編集", exact: true }),
  194 |   ).toBeHidden();
  195 |   expect((await workerObservation(page)).mutations).toEqual([]);
  196 |   expect(await durableState(page)).toMatchObject({ visits, item: limitedItem });
  197 |   await test.info().attach("cell-popup-edit-before-reload", {
  198 |     body: JSON.stringify(
  199 |       {
  200 |         durable: await durableState(page),
  201 |         worker: await workerObservation(page),
  202 |       },
  203 |       null,
  204 |       2,
  205 |     ),
  206 |     contentType: "application/json",
  207 |   });
  208 |   await page.reload();
  209 |   await page.getByText(eventName, { exact: true }).click();
  210 |   await expect(
  211 |     page.getByRole("heading", { name: eventName, exact: true }),
  212 |   ).toBeVisible();
  213 |   expect(await durableState(page)).toMatchObject({ visits, item: limitedItem });
  214 | }
  215 | 
  216 | test.afterEach(async ({ page }, testInfo) => {
  217 |   if (page.isClosed()) return;
  218 |   try {
  219 |     await testInfo.attach("cell-popup-edit-observation", {
  220 |       body: JSON.stringify(
  221 |         {
  222 |           durable: await durableState(page),
  223 |           worker: await workerObservation(page),
  224 |         },
  225 |         null,
  226 |         2,
  227 |       ),
  228 |       contentType: "application/json",
  229 |     });
  230 |   } catch (error) {
  231 |     await testInfo.attach("cell-popup-edit-observation-unavailable", {
  232 |       body: String(error),
  233 |       contentType: "text/plain",
  234 |     });
  235 |   }
  236 | });
  237 | 
  238 | test("direct mouse click opens the real limited editor without changing or saving visits", async ({
  239 |   page,
  240 | }) => {
  241 |   await restore(page);
  242 |   await popup(page)
  243 |     .getByRole("button", { name: "限数を編集", exact: true })
  244 |     .click();
  245 |   await assertDetailAndCancel(page);
  246 | });
  247 | 
  248 | test("direct mouse click preserves an unregistered item without adding or saving visits", async ({
  249 |   page,
  250 | }) => {
  251 |   await restore(page, []);
  252 |   await popup(page)
  253 |     .getByRole("button", { name: "限数を編集", exact: true })
  254 |     .click();
  255 |   await assertDetailAndCancel(page, []);
  256 | });
  257 | 
  258 | test("direct mouse entry saves the real detail edit once and retains limited quantities and visits on reload", async ({
  259 |   page,
  260 | }) => {
  261 |   await restore(page);
  262 |   await popup(page)
  263 |     .getByRole("button", { name: "限数を編集", exact: true })
  264 |     .click();
  265 |   const editor = detail(page);
  266 |   await expect(
  267 |     editor.getByRole("textbox", { name: "実購入数", exact: true }),
  268 |   ).toHaveValue("2");
  269 |   await expect(
  270 |     editor.getByRole("textbox", { name: "購入予定量", exact: true }),
  271 |   ).toHaveValue("5");
  272 |   const remarks = "ユーザー登録のメモを詳細編集から保存";
  273 |   await editor
  274 |     .getByRole("textbox", { name: "利用者メモ", exact: true })
  275 |     .fill(remarks);
  276 |   await editor.getByRole("button", { name: "保存", exact: true }).click();
  277 |   await expect(editor).toBeHidden();
```