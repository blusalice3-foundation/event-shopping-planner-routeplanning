# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: priority-cell-popup-edit.spec.ts >> direct mouse entry saves the real detail edit once and retains limited quantities and visits on reload
- Location: tests\browser\priority-cell-popup-edit.spec.ts:258:1

# Error details

```
Error: expect(locator).toHaveValue(expected) failed

Locator: getByRole('dialog', { name: 'アイテム編集', exact: true }).getByRole('textbox', { name: '実購入数', exact: true })
Expected: "2"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveValue" with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'アイテム編集', exact: true }).getByRole('textbox', { name: '実購入数', exact: true })

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
> 268 |   ).toHaveValue("2");
      |     ^ Error: expect(locator).toHaveValue(expected) failed
  269 |   await expect(
  270 |     editor.getByRole("textbox", { name: "購入予定量", exact: true }),
  271 |   ).toHaveValue("5");
  272 |   const remarks = "ユーザー登録のメモを詳細編集から保存";
  273 |   await editor
  274 |     .getByRole("textbox", { name: "利用者メモ", exact: true })
  275 |     .fill(remarks);
  276 |   await editor.getByRole("button", { name: "保存", exact: true }).click();
  277 |   await expect(editor).toBeHidden();
  278 |   await expect
  279 |     .poll(async () => (await durableState(page)).item)
  280 |     .toMatchObject({ ...limitedItem, remarks });
  281 |   expect((await durableState(page)).visits).toEqual(["limited"]);
  282 |   expect((await workerObservation(page)).mutations).toHaveLength(1);
  283 |   await test.info().attach("cell-popup-edit-before-reload", {
  284 |     body: JSON.stringify(
  285 |       {
  286 |         durable: await durableState(page),
  287 |         worker: await workerObservation(page),
  288 |       },
  289 |       null,
  290 |       2,
  291 |     ),
  292 |     contentType: "application/json",
  293 |   });
  294 |   await page.reload();
  295 |   await page.getByText(eventName, { exact: true }).click();
  296 |   await expect(
  297 |     page.getByRole("heading", { name: eventName, exact: true }),
  298 |   ).toBeVisible();
  299 |   expect(await durableState(page)).toMatchObject({
  300 |     visits: ["limited"],
  301 |     item: { ...limitedItem, remarks },
  302 |   });
  303 | });
  304 | test("keyboard Enter opens the same limited editor without changing or saving visits", async ({
  305 |   page,
  306 | }) => {
  307 |   await restore(page);
  308 |   const edit = popup(page).getByRole("button", {
  309 |     name: "限数を編集",
  310 |     exact: true,
  311 |   });
  312 |   await edit.focus();
  313 |   await edit.press("Enter");
  314 |   await assertDetailAndCancel(page);
  315 | });
  316 | 
  317 | test("holding the child edit button does not trigger the row long-press menu", async ({
  318 |   page,
  319 | }) => {
  320 |   await restore(page);
  321 |   await popup(page)
  322 |     .getByRole("button", { name: "限数を編集", exact: true })
  323 |     .click({ delay: 650 });
  324 |   await assertDetailAndCancel(page);
  325 | });
  326 | 
  327 | test("row long press still opens the legacy entry and then the real limited editor", async ({
  328 |   page,
  329 | }) => {
  330 |   await restore(page);
  331 |   await popup(page)
  332 |     .getByText(limitedItem.circle, { exact: true })
  333 |     .click({ delay: 650 });
  334 |   await page.getByRole("button", { name: "✏️ 編集", exact: true }).click();
  335 |   await detail(page)
  336 |     .getByRole("button", { name: "限数を編集", exact: true })
  337 |     .click();
  338 |   await assertDetailAndCancel(page);
  339 | });
  340 | 
  341 | test("ordinary row mouse clicks still remove and add visits without changing the limited item", async ({
  342 |   page,
  343 | }) => {
  344 |   await restore(page);
  345 |   const rowText = popup(page).getByText(limitedItem.circle, { exact: true });
  346 |   await rowText.click();
  347 |   await expect.poll(async () => (await durableState(page)).visits).toEqual([]);
  348 |   await expect(
  349 |     popup(page).getByText("タップで追加", { exact: true }),
  350 |   ).toBeVisible();
  351 |   await rowText.click();
  352 |   await expect
  353 |     .poll(async () => (await durableState(page)).visits)
  354 |     .toEqual(["limited"]);
  355 |   await expect(popup(page).getByText("訪問先", { exact: true })).toBeVisible();
  356 |   expect((await durableState(page)).item).toMatchObject(limitedItem);
  357 |   expect((await workerObservation(page)).mutations).toHaveLength(2);
  358 | });
  359 | 
  360 | test.describe("mobile touch", () => {
  361 |   test.use({
  362 |     viewport: { width: 390, height: 844 },
  363 |     isMobile: true,
  364 |     hasTouch: true,
  365 |   });
  366 |   test("touch tap opens the real limited editor without changing or saving visits", async ({
  367 |     page,
  368 |   }) => {
```