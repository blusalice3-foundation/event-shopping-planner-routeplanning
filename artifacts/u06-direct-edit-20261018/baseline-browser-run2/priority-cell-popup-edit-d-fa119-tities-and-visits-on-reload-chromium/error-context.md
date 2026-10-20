# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: priority-cell-popup-edit.spec.ts >> direct mouse entry saves the real detail edit once and retains limited quantities and visits on reload
- Location: tests\browser\priority-cell-popup-edit.spec.ts:246:1

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
  200 |   ).toBeVisible();
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
> 256 |   ).toHaveValue("2");
      |     ^ Error: expect(locator).toHaveValue(expected) failed
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
  301 | });
  302 | 
  303 | test("row long press still opens the legacy entry and then the real limited editor", async ({
  304 |   page,
  305 | }) => {
  306 |   await restore(page);
  307 |   await popup(page)
  308 |     .getByText(limitedItem.circle, { exact: true })
  309 |     .click({ delay: 650 });
  310 |   await page.getByRole("button", { name: "✏️ 編集", exact: true }).click();
  311 |   await detail(page)
  312 |     .getByRole("button", { name: "限数を編集", exact: true })
  313 |     .click();
  314 |   await assertDetailAndCancel(page);
  315 | });
  316 | 
  317 | test("ordinary row mouse clicks still remove and add visits without changing the limited item", async ({
  318 |   page,
  319 | }) => {
  320 |   await restore(page);
  321 |   const rowText = popup(page).getByText(limitedItem.circle, { exact: true });
  322 |   await rowText.click();
  323 |   await expect.poll(async () => (await durableState(page)).visits).toEqual([]);
  324 |   await expect(
  325 |     popup(page).getByText("タップで追加", { exact: true }),
  326 |   ).toBeVisible();
  327 |   await rowText.click();
  328 |   await expect
  329 |     .poll(async () => (await durableState(page)).visits)
  330 |     .toEqual(["limited"]);
  331 |   await expect(popup(page).getByText("訪問先", { exact: true })).toBeVisible();
  332 |   expect((await durableState(page)).item).toMatchObject(limitedItem);
  333 |   expect((await workerObservation(page)).mutations).toHaveLength(2);
  334 | });
  335 | 
  336 | test.describe("mobile touch", () => {
  337 |   test.use({
  338 |     viewport: { width: 390, height: 844 },
  339 |     isMobile: true,
  340 |     hasTouch: true,
  341 |   });
  342 |   test("touch tap opens the real limited editor without changing or saving visits", async ({
  343 |     page,
  344 |   }) => {
  345 |     await restore(page);
  346 |     await popup(page)
  347 |       .getByRole("button", { name: "限数を編集", exact: true })
  348 |       .tap();
  349 |     await assertDetailAndCancel(page);
  350 |   });
  351 | });
  352 | 
```