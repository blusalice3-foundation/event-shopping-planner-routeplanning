# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: priority-preference-consistency.spec.ts >> unavailable localStorage getter retains a visible app and backup failure guidance
- Location: tests\browser\priority-preference-consistency.spec.ts:168:3

# Error details

```
Error: expect(locator).not.toBeEmpty() failed

Locator:  locator('#root')
Expected: not empty
Received: empty
Timeout:  5000ms

Call log:
  - Expect "not toBeEmpty" with timeout 5000ms
  - waiting for locator('#root')
    14 × locator resolved to <div id="root"></div>
       - unexpected value "empty"

```

# Test source

```ts
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
  199 |           if (this === local)
  200 |             throw new DOMException(
  201 |               "Injected storage enumeration failure",
  202 |               "SecurityError",
  203 |             );
  204 |           return key.call(this, index);
  205 |         };
  206 |       }
  207 |     }, kind);
  208 |     await page.reload();
> 209 |     await expect(page.locator("#root")).not.toBeEmpty();
      |                                             ^ Error: expect(locator).not.toBeEmpty() failed
  210 |     const event = page.getByText(eventName, { exact: true });
  211 |     const recovery = page.getByRole("heading", {
  212 |       name: "保存データを安全に読み込めませんでした",
  213 |       exact: true,
  214 |     });
  215 |     await expect(event.or(recovery)).toBeVisible();
  216 |     if (await recovery.isVisible()) {
  217 |       await expect(page.getByRole("alert")).toBeVisible();
  218 |       expect(await storedItems(page)).toEqual(before);
  219 |       expect(errors).toEqual([]);
  220 |       await testInfo.attach(`storage-${kind}-outcome`, {
  221 |         body: "Existing startup recovery screen remained visible; no data changed.",
  222 |         contentType: "text/plain",
  223 |       });
  224 |       return;
  225 |     }
  226 |     await testInfo.attach(`storage-${kind}-outcome`, {
  227 |       body: "Migrated database remained available; backup failure guidance is checked below.",
  228 |       contentType: "text/plain",
  229 |     });
  230 |     await event.click();
  231 |     await expect(
  232 |       page.locator(`[data-item-id="${sourceItem.id}"]`),
  233 |     ).toBeVisible();
  234 |     await page
  235 |       .getByRole("button", { name: "イベント一覧", exact: true })
  236 |       .click();
  237 |     const messages: string[] = [];
  238 |     page.on("dialog", async (dialog) => {
  239 |       messages.push(dialog.message());
  240 |       await dialog.accept();
  241 |     });
  242 |     const downloads: string[] = [];
  243 |     page.on("download", (file) => downloads.push(file.suggestedFilename()));
  244 |     await page
  245 |       .getByRole("button", { name: "JSONバックアップ保存", exact: true })
  246 |       .click();
  247 |     await expect
  248 |       .poll(() => messages)
  249 |       .toContain(
  250 |         "バックアップを完全に保存できなかったため、ファイルを作成しませんでした。現在のデータは変更されていません。",
  251 |       );
  252 |     expect(downloads).toEqual([]);
  253 |     expect(await storedItems(page)).toEqual(before);
  254 |     expect(errors).toEqual([]);
  255 |     await expect(
  256 |       page.getByRole("heading", {
  257 |         name: "保存済みの即売会リスト",
  258 |         exact: true,
  259 |       }),
  260 |     ).toBeVisible();
  261 |   });
  262 | }
  263 | 
```