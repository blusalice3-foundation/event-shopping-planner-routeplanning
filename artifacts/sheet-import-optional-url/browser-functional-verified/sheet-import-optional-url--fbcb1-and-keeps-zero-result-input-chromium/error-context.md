# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sheet-import-optional-url.spec.ts >> sheet import and optional URL: worker >> new URL import excludes incomplete rows, saves no-URL items and keeps zero-result input
- Location: tests\browser\sheet-import-optional-url.spec.ts:189:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: '取込互換検証', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('heading', { name: '取込互換検証', exact: true })

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
      - text: 取込互換検証
      - button "メニュー":
        - img
- status "保存済み・旧データ保全中"
```

# Test source

```ts
  133 |               await page
  134 |                 .getByRole("textbox", {
  135 |                   name: "スプレッドシートURL",
  136 |                   exact: true,
  137 |                 })
  138 |                 .fill("https://docs.google.com/spreadsheets/d/new/edit");
  139 |               await page
  140 |                 .getByRole("button", { name: "更新", exact: true })
  141 |                 .click();
  142 |             }
  143 |           };
  144 |           await open();
  145 |           const summary = page.getByRole("region", { name: "シート取込結果" });
  146 |           await expect(summary).toContainText(
  147 |             `取込対象: 0件、必須項目不足による除外: ${count}行`,
  148 |           );
  149 |           await expect(summary.locator("li")).toHaveCount(20);
  150 |           await expect(
  151 |             page.getByText(`削除候補: ${count - 1}件、削除から保護: 1件`, {
  152 |               exact: true,
  153 |             }),
  154 |           ).toBeVisible();
  155 |           const before = await stored(page, "eventLists");
  156 |           const metadata = await stored(page, "eventMetadata");
  157 |           await page
  158 |             .getByRole("button", { name: "キャンセル", exact: true })
  159 |             .last()
  160 |             .click();
  161 |           expect(await stored(page, "eventLists")).toEqual(before);
  162 |           expect(await stored(page, "eventMetadata")).toEqual(metadata);
  163 |           await open();
  164 |           const confirm = page.getByRole("button", {
  165 |             name:
  166 |               kind === "source-switch"
  167 |                 ? "更新元を切り替えて更新"
  168 |                 : "更新を実行",
  169 |             exact: true,
  170 |           });
  171 |           await expect(confirm).toBeEnabled();
  172 |           await confirm.click();
  173 |           await expect(summary).toBeHidden();
  174 |           await expect
  175 |             .poll(async () => (await stored(page, "eventLists"))[SHEET_EVENT])
  176 |             .toHaveLength(1);
  177 |           await page.reload();
  178 |           expect((await stored(page, "eventLists"))[SHEET_EVENT]).toEqual([
  179 |             expect.objectContaining({ id: "item-0", protectionLevel: "full" }),
  180 |           ]);
  181 |           if (kind === "source-switch")
  182 |             expect(
  183 |               (await stored(page, "eventMetadata"))[SHEET_EVENT],
  184 |             ).toMatchObject({
  185 |               spreadsheetUrl: "https://docs.google.com/spreadsheets/d/new/edit",
  186 |             });
  187 |         });
  188 |       }
  189 |     test("new URL import excludes incomplete rows, saves no-URL items and keeps zero-result input", async ({
  190 |       page,
  191 |     }) => {
  192 |       let csv = sheetCsv(4, "excluded");
  193 |       await page.route("**/api/google-sheets-csv", (route) =>
  194 |         route.fulfill({
  195 |           status: 200,
  196 |           contentType: "text/csv; charset=utf-8",
  197 |           body: csv,
  198 |         }),
  199 |       );
  200 |       await page.goto("/");
  201 |       await page
  202 |         .getByRole("button", { name: "新規リスト作成", exact: true })
  203 |         .click();
  204 |       await page.getByLabel("即売会名", { exact: true }).fill(SHEET_EVENT);
  205 |       const input = page.getByLabel("スプレッドシートURLからインポート", {
  206 |         exact: true,
  207 |       });
  208 |       await input.fill("https://docs.google.com/spreadsheets/d/new/edit");
  209 |       await page
  210 |         .getByRole("button", { name: "URLからインポート", exact: true })
  211 |         .click();
  212 |       await expect(
  213 |         page.getByRole("region", { name: "シート取込結果" }),
  214 |       ).toContainText("取込対象: 0件");
  215 |       await expect(input).toHaveValue(
  216 |         "https://docs.google.com/spreadsheets/d/new/edit",
  217 |       );
  218 |       expect(Object.keys((await stored(page, "eventLists")) ?? {})).toEqual([]);
  219 |       csv = sheetCsv(4, "mixed");
  220 |       await page
  221 |         .getByRole("button", { name: "URLからインポート", exact: true })
  222 |         .click();
  223 |       await finishAddition(page);
  224 |       await page.reload();
  225 |       const items = (await stored(page, "eventLists"))[SHEET_EVENT] as object[];
  226 |       expect(
  227 |         items.every(
  228 |           (item) => !Object.prototype.hasOwnProperty.call(item, "url"),
  229 |         ),
  230 |       ).toBe(true);
  231 |       await expect(
  232 |         page.getByRole("heading", { name: SHEET_EVENT, exact: true }),
> 233 |       ).toBeVisible();
      |         ^ Error: expect(locator).toBeVisible() failed
  234 |     });
  235 |     for (const mode of ["edit", "execute", "focus"] as const) {
  236 |       test(`${mode}: adds a no-URL item and persists it across reload`, async ({
  237 |         page,
  238 |       }) => {
  239 |         await restore(page, 2, mode);
  240 |         if (mode === "edit") {
  241 |           await page
  242 |             .getByRole("button", { name: "アイテム追加", exact: true })
  243 |             .click();
  244 |           await page
  245 |             .getByLabel("サークル名", { exact: true })
  246 |             .fill("URLなし手動追加");
  247 |           await page
  248 |             .getByRole("button", { name: "リストに追加", exact: true })
  249 |             .click();
  250 |         } else {
  251 |           if (mode === "focus")
  252 |             await page
  253 |               .getByTitle("新規アイテム追加", { exact: true })
  254 |               .first()
  255 |               .click();
  256 |           else
  257 |             await page
  258 |               .getByRole("button", {
  259 |                 name: "このスペースにアイテムを追加",
  260 |                 exact: true,
  261 |               })
  262 |               .first()
  263 |               .click();
  264 |           const dialog = page.getByRole("dialog").filter({
  265 |             has: page.getByRole("heading", {
  266 |               name: "新規アイテム追加",
  267 |               exact: true,
  268 |             }),
  269 |           });
  270 |           await dialog
  271 |             .getByRole("combobox", { name: "サークル名", exact: true })
  272 |             .or(
  273 |               dialog.getByRole("textbox", { name: "サークル名", exact: true }),
  274 |             )
  275 |             .fill("URLなし手動追加");
  276 |           await dialog
  277 |             .getByRole("button", { name: "リストに追加", exact: true })
  278 |             .click();
  279 |           await expect(dialog).toBeHidden();
  280 |         }
  281 |         await finishAddition(page);
  282 |         await page.reload();
  283 |         const items = (await stored(page, "eventLists"))[SHEET_EVENT] as Array<{
  284 |           circle: string;
  285 |         }>;
  286 |         const item = items.find((item) => item.circle === "URLなし手動追加")!;
  287 |         expect(item).toBeTruthy();
  288 |         expect(Object.prototype.hasOwnProperty.call(item, "url")).toBe(false);
  289 |       });
  290 |     }
  291 |     test("removes an existing URL through the guarded editor and persists its absence", async ({
  292 |       page,
  293 |     }) => {
  294 |       await restore(page, 2);
  295 |       const card = page
  296 |         .locator('[data-item-id="item-0"]')
  297 |         .first()
  298 |         .locator(":scope > div.rounded-lg")
  299 |         .first();
  300 |       const edit = async (url: string) => {
  301 |         await card.dispatchEvent("pointerdown", {
  302 |           button: 0,
  303 |           isPrimary: true,
  304 |           pointerType: "mouse",
  305 |         });
  306 |         await card.dispatchEvent("pointerup", {
  307 |           button: 0,
  308 |           isPrimary: true,
  309 |           pointerType: "mouse",
  310 |         });
  311 |         await page.getByRole("button", { name: "編集", exact: true }).click();
  312 |         const editor = page.getByRole("dialog", {
  313 |           name: "アイテム編集",
  314 |           exact: true,
  315 |         });
  316 |         await editor
  317 |           .getByRole("textbox", { name: "URL", exact: true })
  318 |           .fill(url);
  319 |         await editor.getByRole("button", { name: "保存", exact: true }).click();
  320 |         await expect(editor).toBeHidden();
  321 |       };
  322 |       await edit("https://existing.test");
  323 |       await edit("");
  324 |       await expect
  325 |         .poll(async () =>
  326 |           Object.prototype.hasOwnProperty.call(
  327 |             ((await stored(page, "eventLists"))[SHEET_EVENT] as object[])[0],
  328 |             "url",
  329 |           ),
  330 |         )
  331 |         .toBe(false);
  332 |       await page.reload();
  333 |       expect(
```