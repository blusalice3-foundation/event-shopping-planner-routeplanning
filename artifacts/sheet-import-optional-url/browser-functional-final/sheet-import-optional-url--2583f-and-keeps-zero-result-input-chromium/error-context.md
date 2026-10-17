# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sheet-import-optional-url.spec.ts >> sheet import and optional URL: direct >> new URL import excludes incomplete rows, saves no-URL items and keeps zero-result input
- Location: tests\browser\sheet-import-optional-url.spec.ts:186:5

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
  130 |               await page
  131 |                 .getByRole("textbox", {
  132 |                   name: "スプレッドシートURL",
  133 |                   exact: true,
  134 |                 })
  135 |                 .fill("https://docs.google.com/spreadsheets/d/new/edit");
  136 |               await page
  137 |                 .getByRole("button", { name: "更新", exact: true })
  138 |                 .click();
  139 |             }
  140 |           };
  141 |           await open();
  142 |           const summary = page.getByRole("region", { name: "シート取込結果" });
  143 |           await expect(summary).toContainText(
  144 |             `取込対象: 0件、必須項目不足による除外: ${count}行`,
  145 |           );
  146 |           await expect(summary.locator("li")).toHaveCount(20);
  147 |           await expect(
  148 |             page.getByText(`削除候補: ${count - 1}件、削除から保護: 1件`, {
  149 |               exact: true,
  150 |             }),
  151 |           ).toBeVisible();
  152 |           const before = await stored(page, "eventLists");
  153 |           const metadata = await stored(page, "eventMetadata");
  154 |           await page
  155 |             .getByRole("button", { name: "キャンセル", exact: true })
  156 |             .last()
  157 |             .click();
  158 |           expect(await stored(page, "eventLists")).toEqual(before);
  159 |           expect(await stored(page, "eventMetadata")).toEqual(metadata);
  160 |           await open();
  161 |           const confirm = page.getByRole("button", {
  162 |             name:
  163 |               kind === "source-switch"
  164 |                 ? "更新元を切り替えて更新"
  165 |                 : "更新を実行",
  166 |             exact: true,
  167 |           });
  168 |           await expect(confirm).toBeEnabled();
  169 |           await confirm.click();
  170 |           await expect(summary).toBeHidden();
  171 |           await expect
  172 |             .poll(async () => (await stored(page, "eventLists"))[SHEET_EVENT])
  173 |             .toHaveLength(1);
  174 |           await page.reload();
  175 |           expect((await stored(page, "eventLists"))[SHEET_EVENT]).toEqual([
  176 |             expect.objectContaining({ id: "item-0", protectionLevel: "full" }),
  177 |           ]);
  178 |           if (kind === "source-switch")
  179 |             expect(
  180 |               (await stored(page, "eventMetadata"))[SHEET_EVENT],
  181 |             ).toMatchObject({
  182 |               spreadsheetUrl: "https://docs.google.com/spreadsheets/d/new/edit",
  183 |             });
  184 |         });
  185 |       }
  186 |     test("new URL import excludes incomplete rows, saves no-URL items and keeps zero-result input", async ({
  187 |       page,
  188 |     }) => {
  189 |       let csv = sheetCsv(4, "excluded");
  190 |       await page.route("**/api/google-sheets-csv", (route) =>
  191 |         route.fulfill({
  192 |           status: 200,
  193 |           contentType: "text/csv; charset=utf-8",
  194 |           body: csv,
  195 |         }),
  196 |       );
  197 |       await page.goto("/");
  198 |       await page
  199 |         .getByRole("button", { name: "新規リスト作成", exact: true })
  200 |         .click();
  201 |       await page.getByLabel("即売会名", { exact: true }).fill(SHEET_EVENT);
  202 |       const input = page.getByLabel("スプレッドシートURLからインポート", {
  203 |         exact: true,
  204 |       });
  205 |       await input.fill("https://docs.google.com/spreadsheets/d/new/edit");
  206 |       await page
  207 |         .getByRole("button", { name: "URLからインポート", exact: true })
  208 |         .click();
  209 |       await expect(
  210 |         page.getByRole("region", { name: "シート取込結果" }),
  211 |       ).toContainText("取込対象: 0件");
  212 |       await expect(input).toHaveValue(
  213 |         "https://docs.google.com/spreadsheets/d/new/edit",
  214 |       );
  215 |       expect(Object.keys((await stored(page, "eventLists")) ?? {})).toEqual([]);
  216 |       csv = sheetCsv(4, "mixed");
  217 |       await page
  218 |         .getByRole("button", { name: "URLからインポート", exact: true })
  219 |         .click();
  220 |       await finishAddition(page);
  221 |       await page.reload();
  222 |       const items = (await stored(page, "eventLists"))[SHEET_EVENT] as object[];
  223 |       expect(
  224 |         items.every(
  225 |           (item) => !Object.prototype.hasOwnProperty.call(item, "url"),
  226 |         ),
  227 |       ).toBe(true);
  228 |       await expect(
  229 |         page.getByRole("heading", { name: SHEET_EVENT, exact: true }),
> 230 |       ).toBeVisible();
      |         ^ Error: expect(locator).toBeVisible() failed
  231 |     });
  232 |     for (const mode of ["edit", "execute", "focus"] as const) {
  233 |       test(`${mode}: adds a no-URL item and persists it across reload`, async ({
  234 |         page,
  235 |       }) => {
  236 |         await restore(page, 2, mode);
  237 |         if (mode === "edit") {
  238 |           await page
  239 |             .getByRole("button", { name: "アイテム追加", exact: true })
  240 |             .click();
  241 |           await page
  242 |             .getByLabel("サークル名", { exact: true })
  243 |             .fill("URLなし手動追加");
  244 |           await page
  245 |             .getByRole("button", { name: "リストに追加", exact: true })
  246 |             .click();
  247 |         } else {
  248 |           if (mode === "focus")
  249 |             await page
  250 |               .getByTitle("新規アイテム追加", { exact: true })
  251 |               .first()
  252 |               .click();
  253 |           else
  254 |             await page
  255 |               .getByRole("button", {
  256 |                 name: "このスペースにアイテムを追加",
  257 |                 exact: true,
  258 |               })
  259 |               .first()
  260 |               .click();
  261 |           const dialog = page
  262 |             .getByRole("dialog")
  263 |             .filter({
  264 |               has: page.getByRole("heading", {
  265 |                 name: "新規アイテム追加",
  266 |                 exact: true,
  267 |               }),
  268 |             });
  269 |           await dialog
  270 |             .getByLabel("サークル名", { exact: true })
  271 |             .fill("URLなし手動追加");
  272 |           await dialog
  273 |             .getByRole("button", { name: "リストに追加", exact: true })
  274 |             .click();
  275 |           await expect(dialog).toBeHidden();
  276 |         }
  277 |         await finishAddition(page);
  278 |         await page.reload();
  279 |         const items = (await stored(page, "eventLists"))[SHEET_EVENT] as Array<{
  280 |           circle: string;
  281 |         }>;
  282 |         const item = items.find((item) => item.circle === "URLなし手動追加")!;
  283 |         expect(item).toBeTruthy();
  284 |         expect(Object.prototype.hasOwnProperty.call(item, "url")).toBe(false);
  285 |       });
  286 |     }
  287 |     test("removes an existing URL through the guarded editor and persists its absence", async ({
  288 |       page,
  289 |     }) => {
  290 |       await restore(page, 2);
  291 |       const card = page
  292 |         .locator('[data-item-id="item-0"]')
  293 |         .first()
  294 |         .locator(":scope > div.rounded-lg")
  295 |         .first();
  296 |       const edit = async (url: string) => {
  297 |         await card.dispatchEvent("pointerdown", {
  298 |           button: 0,
  299 |           isPrimary: true,
  300 |           pointerType: "mouse",
  301 |         });
  302 |         await card.dispatchEvent("pointerup", {
  303 |           button: 0,
  304 |           isPrimary: true,
  305 |           pointerType: "mouse",
  306 |         });
  307 |         await page.getByRole("button", { name: "編集", exact: true }).click();
  308 |         const editor = page.getByRole("dialog", {
  309 |           name: "アイテム編集",
  310 |           exact: true,
  311 |         });
  312 |         await editor
  313 |           .getByRole("textbox", { name: "URL", exact: true })
  314 |           .fill(url);
  315 |         await editor.getByRole("button", { name: "保存", exact: true }).click();
  316 |         await expect(editor).toBeHidden();
  317 |       };
  318 |       await edit("https://existing.test");
  319 |       await edit("");
  320 |       await expect
  321 |         .poll(async () =>
  322 |           Object.prototype.hasOwnProperty.call(
  323 |             ((await stored(page, "eventLists"))[SHEET_EVENT] as object[])[0],
  324 |             "url",
  325 |           ),
  326 |         )
  327 |         .toBe(false);
  328 |       await page.reload();
  329 |       expect(
  330 |         Object.prototype.hasOwnProperty.call(
```