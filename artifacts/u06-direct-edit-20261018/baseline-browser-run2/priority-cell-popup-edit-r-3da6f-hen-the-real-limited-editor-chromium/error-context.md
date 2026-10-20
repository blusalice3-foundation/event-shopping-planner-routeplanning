# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: priority-cell-popup-edit.spec.ts >> row long press still opens the legacy entry and then the real limited editor
- Location: tests\browser\priority-cell-popup-edit.spec.ts:303:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'セルからの限数編集', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('heading', { name: 'セルからの限数編集', exact: true })

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
      - text: セルからの限数編集
      - button "メニュー":
        - img
- status "保存済み・旧データ保全中"
```

# Test source

```ts
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
  177 |   await expect(editor).toBeVisible();
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
  197 |   await page.reload();
  198 |   await expect(
  199 |     page.getByRole("heading", { name: eventName, exact: true }),
> 200 |   ).toBeVisible();
      |     ^ Error: expect(locator).toBeVisible() failed
  201 |   expect(await durableState(page)).toMatchObject({ visits, item: limitedItem });
  202 | }
  203 | 
  204 | test.afterEach(async ({ page }, testInfo) => {
  205 |   if (page.isClosed()) return;
  206 |   try {
  207 |     await testInfo.attach("cell-popup-edit-observation", {
  208 |       body: JSON.stringify(
  209 |         {
  210 |           durable: await durableState(page),
  211 |           worker: await workerObservation(page),
  212 |         },
  213 |         null,
  214 |         2,
  215 |       ),
  216 |       contentType: "application/json",
  217 |     });
  218 |   } catch (error) {
  219 |     await testInfo.attach("cell-popup-edit-observation-unavailable", {
  220 |       body: String(error),
  221 |       contentType: "text/plain",
  222 |     });
  223 |   }
  224 | });
  225 | 
  226 | test("direct mouse click opens the real limited editor without changing or saving visits", async ({
  227 |   page,
  228 | }) => {
  229 |   await restore(page);
  230 |   await popup(page)
  231 |     .getByRole("button", { name: "限数を編集", exact: true })
  232 |     .click();
  233 |   await assertDetailAndCancel(page);
  234 | });
  235 | 
  236 | test("direct mouse click preserves an unregistered item without adding or saving visits", async ({
  237 |   page,
  238 | }) => {
  239 |   await restore(page, []);
  240 |   await popup(page)
  241 |     .getByRole("button", { name: "限数を編集", exact: true })
  242 |     .click();
  243 |   await assertDetailAndCancel(page, []);
  244 | });
  245 | 
  246 | test("direct mouse entry saves the real detail edit once and retains limited quantities and visits on reload", async ({
  247 |   page,
  248 | }) => {
  249 |   await restore(page);
  250 |   await popup(page)
  251 |     .getByRole("button", { name: "限数を編集", exact: true })
  252 |     .click();
  253 |   const editor = detail(page);
  254 |   await expect(
  255 |     editor.getByRole("textbox", { name: "実購入数", exact: true }),
  256 |   ).toHaveValue("2");
  257 |   await expect(
  258 |     editor.getByRole("textbox", { name: "購入予定量", exact: true }),
  259 |   ).toHaveValue("5");
  260 |   const remarks = "ユーザー登録のメモを詳細編集から保存";
  261 |   await editor
  262 |     .getByRole("textbox", { name: "利用者メモ", exact: true })
  263 |     .fill(remarks);
  264 |   await editor.getByRole("button", { name: "保存", exact: true }).click();
  265 |   await expect(editor).toBeHidden();
  266 |   await expect
  267 |     .poll(async () => (await durableState(page)).item)
  268 |     .toMatchObject({ ...limitedItem, remarks });
  269 |   expect((await durableState(page)).visits).toEqual(["limited"]);
  270 |   expect((await workerObservation(page)).mutations).toHaveLength(1);
  271 |   await page.reload();
  272 |   await expect(
  273 |     page.getByRole("heading", { name: eventName, exact: true }),
  274 |   ).toBeVisible();
  275 |   expect(await durableState(page)).toMatchObject({
  276 |     visits: ["limited"],
  277 |     item: { ...limitedItem, remarks },
  278 |   });
  279 | });
  280 | test("keyboard Enter opens the same limited editor without changing or saving visits", async ({
  281 |   page,
  282 | }) => {
  283 |   await restore(page);
  284 |   const edit = popup(page).getByRole("button", {
  285 |     name: "限数を編集",
  286 |     exact: true,
  287 |   });
  288 |   await edit.focus();
  289 |   await edit.press("Enter");
  290 |   await assertDetailAndCancel(page);
  291 | });
  292 | 
  293 | test("holding the child edit button does not trigger the row long-press menu", async ({
  294 |   page,
  295 | }) => {
  296 |   await restore(page);
  297 |   await popup(page)
  298 |     .getByRole("button", { name: "限数を編集", exact: true })
  299 |     .click({ delay: 650 });
  300 |   await assertDetailAndCancel(page);
```