# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sheet-import-optional-url.spec.ts >> sheet import and optional URL: direct >> edit: adds a no-URL item and persists it across reload
- Location: tests\browser\sheet-import-optional-url.spec.ts:211:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'このスペースにアイテムを追加', exact: true }).first()

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e7]:
      - heading "取込互換検証" [level=1] [ref=e8]
      - button "候補ブロックを番号で並べ替え" [ref=e9] [cursor=pointer]
      - button "ホール定義（ブロック割当）" [ref=e12] [cursor=pointer]
      - button "表示項目の設定" [ref=e16] [cursor=pointer]
      - generic [ref=e17]:
        - button "📝" [ref=e18] [cursor=pointer]
        - button "🏃‍♂️" [ref=e19] [cursor=pointer]
        - button "🔍" [ref=e20] [cursor=pointer]
    - generic [ref=e22]:
      - button "イベント一覧" [ref=e23] [cursor=pointer]
      - button "1日目2" [ref=e24] [cursor=pointer]
      - button "アイテム追加" [ref=e25] [cursor=pointer]
      - generic [ref=e26]:
        - textbox "検索..." [ref=e27]
        - button "次を検索" [disabled] [ref=e28]
  - main [ref=e29]:
    - generic [ref=e31]:
      - generic [ref=e32]:
        - generic [ref=e33]:
          - generic [ref=e34]:
            - heading "実行リストアイテム" [level=2] [ref=e35]
            - button "スペース別" [ref=e37] [cursor=pointer]
          - paragraph [ref=e38]: 実行対象として選択中のアイテムを管理します。
        - list "買い物リスト" [ref=e39]:
          - listitem "A0 サークル0 新刊0" [ref=e41]:
            - generic [ref=e43]:
              - generic [ref=e44]:
                - checkbox "Select item サークル0 - 新刊0" [ref=e45]
                - button "上に移動" [disabled] [ref=e46]
                - button "下に移動" [ref=e56] [cursor=pointer]
                - button "完全保護" [ref=e59] [cursor=pointer]: 🔐
              - generic [ref=e60]:
                - generic [ref=e61]:
                  - generic [ref=e62]: 1日目
                  - generic [ref=e63]: A-0
                  - button "サークル0" [ref=e64] [cursor=pointer]
                - button "新刊0" [ref=e67] [cursor=pointer]
                - generic [ref=e69]:
                  - generic "シート情報" [ref=e70]:
                    - generic [ref=e71]: "カタログ価格: 500円"
                    - generic "ユーザー登録" [ref=e72]: "シート備考: ユーザー登録"
                  - textbox "利用者メモ" [ref=e74]: ユーザー登録
              - generic [ref=e75]:
                - 'button "Current status: 未購入. Click to change." [ref=e76] [cursor=pointer]':
                  - generic [ref=e79]: 未購入
                - generic [ref=e80]:
                  - generic [ref=e81]: 数量
                  - combobox "購入予定数量" [ref=e82]:
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
                - generic [ref=e83]:
                  - generic [ref=e84]: 購入金額
                  - generic [ref=e85]: ¥
                  - combobox "購入金額" [ref=e86]:
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
          - listitem "A1 サークル1 新刊1" [ref=e88]:
            - generic [ref=e90]:
              - generic [ref=e91]:
                - checkbox "Select item サークル1 - 新刊1" [ref=e92]
                - button "上に移動" [ref=e93] [cursor=pointer]
                - button "下に移動" [disabled] [ref=e103]
                - button "保護なし" [ref=e106] [cursor=pointer]: 🔓
              - generic [ref=e107]:
                - generic [ref=e108]:
                  - generic [ref=e109]: 1日目
                  - generic [ref=e110]: A-1
                  - button "サークル1" [ref=e111] [cursor=pointer]
                - button "新刊1" [ref=e114] [cursor=pointer]
                - generic [ref=e116]:
                  - generic "シート情報" [ref=e117]:
                    - generic [ref=e118]: "カタログ価格: 500円"
                    - generic "ユーザー登録" [ref=e119]: "シート備考: ユーザー登録"
                  - textbox "利用者メモ" [ref=e121]: ユーザー登録
              - generic [ref=e122]:
                - 'button "Current status: 未購入. Click to change." [ref=e123] [cursor=pointer]':
                  - generic [ref=e126]: 未購入
                - generic [ref=e127]:
                  - generic [ref=e128]: 数量
                  - combobox "購入予定数量" [ref=e129]:
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
                - generic [ref=e130]:
                  - generic [ref=e131]: 購入金額
                  - generic [ref=e132]: ¥
                  - combobox "購入金額" [ref=e133]:
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
      - generic [ref=e134]:
        - generic [ref=e135]:
          - heading "候補アイテム" [level=2] [ref=e136]
          - paragraph [ref=e137]: このリストから選択したアイテムを実行リストへ移動します。
        - list "買い物リスト" [ref=e138]
  - status "保存済み"
```

# Test source

```ts
  127 |           ).toBeVisible();
  128 |           const before = await stored(page, "eventLists");
  129 |           const metadata = await stored(page, "eventMetadata");
  130 |           await page
  131 |             .getByRole("button", { name: "キャンセル", exact: true })
  132 |             .last()
  133 |             .click();
  134 |           expect(await stored(page, "eventLists")).toEqual(before);
  135 |           expect(await stored(page, "eventMetadata")).toEqual(metadata);
  136 |           await open();
  137 |           const confirm = page.getByRole("button", {
  138 |             name:
  139 |               kind === "source-switch"
  140 |                 ? "更新元を切り替えて更新"
  141 |                 : "更新を実行",
  142 |             exact: true,
  143 |           });
  144 |           await expect(confirm).toBeEnabled();
  145 |           await confirm.click();
  146 |           await expect(summary).toBeHidden();
  147 |           await expect
  148 |             .poll(async () => (await stored(page, "eventLists"))[SHEET_EVENT])
  149 |             .toHaveLength(1);
  150 |           await page.reload();
  151 |           expect((await stored(page, "eventLists"))[SHEET_EVENT]).toEqual([
  152 |             expect.objectContaining({ id: "item-0", protectionLevel: "full" }),
  153 |           ]);
  154 |           if (kind === "source-switch")
  155 |             expect(
  156 |               (await stored(page, "eventMetadata"))[SHEET_EVENT],
  157 |             ).toMatchObject({
  158 |               spreadsheetUrl: "https://docs.google.com/spreadsheets/d/new/edit",
  159 |             });
  160 |         });
  161 |       }
  162 |     test("new URL import excludes incomplete rows, saves no-URL items and keeps zero-result input", async ({
  163 |       page,
  164 |     }) => {
  165 |       let csv = sheetCsv(4, "excluded");
  166 |       await page.route("**/api/google-sheets-csv", (route) =>
  167 |         route.fulfill({
  168 |           status: 200,
  169 |           contentType: "text/csv; charset=utf-8",
  170 |           body: csv,
  171 |         }),
  172 |       );
  173 |       await page.goto("/");
  174 |       await page
  175 |         .getByRole("button", { name: "新規リスト作成", exact: true })
  176 |         .click();
  177 |       await page.getByLabel("即売会名", { exact: true }).fill(SHEET_EVENT);
  178 |       const input = page.getByLabel("スプレッドシートURLからインポート", {
  179 |         exact: true,
  180 |       });
  181 |       await input.fill("https://docs.google.com/spreadsheets/d/new/edit");
  182 |       await page
  183 |         .getByRole("button", { name: "URLからインポート", exact: true })
  184 |         .click();
  185 |       await expect(
  186 |         page.getByRole("region", { name: "シート取込結果" }),
  187 |       ).toContainText("取込対象: 0件");
  188 |       await expect(input).toHaveValue(
  189 |         "https://docs.google.com/spreadsheets/d/new/edit",
  190 |       );
  191 |       expect(Object.keys((await stored(page, "eventLists")) ?? {})).toEqual([]);
  192 |       csv = sheetCsv(4, "mixed");
  193 |       await page
  194 |         .getByRole("button", { name: "URLからインポート", exact: true })
  195 |         .click();
  196 |       await expect
  197 |         .poll(async () => (await stored(page, "eventLists"))[SHEET_EVENT])
  198 |         .toHaveLength(3);
  199 |       await page.reload();
  200 |       const items = (await stored(page, "eventLists"))[SHEET_EVENT] as object[];
  201 |       expect(
  202 |         items.every(
  203 |           (item) => !Object.prototype.hasOwnProperty.call(item, "url"),
  204 |         ),
  205 |       ).toBe(true);
  206 |       await expect(
  207 |         page.getByRole("heading", { name: SHEET_EVENT, exact: true }),
  208 |       ).toBeVisible();
  209 |     });
  210 |     for (const mode of ["edit", "execute", "focus"] as const) {
  211 |       test(`${mode}: adds a no-URL item and persists it across reload`, async ({
  212 |         page,
  213 |       }) => {
  214 |         await restore(page, 2, mode);
  215 |         if (mode === "focus")
  216 |           await page
  217 |             .getByTitle("新規アイテム追加", { exact: true })
  218 |             .first()
  219 |             .click();
  220 |         else
  221 |           await page
  222 |             .getByRole("button", {
  223 |               name: "このスペースにアイテムを追加",
  224 |               exact: true,
  225 |             })
  226 |             .first()
> 227 |             .click();
      |              ^ Error: locator.click: Test timeout of 30000ms exceeded.
  228 |         const dialog = page.getByRole("dialog", {
  229 |           name: "新規アイテム追加",
  230 |           exact: true,
  231 |         });
  232 |         await dialog
  233 |           .getByRole("textbox", { name: "サークル名", exact: true })
  234 |           .fill("URLなし手動追加");
  235 |         await dialog
  236 |           .getByRole("button", { name: "リストに追加", exact: true })
  237 |           .click();
  238 |         await expect(dialog).toBeHidden();
  239 |         await expect
  240 |           .poll(async () => (await stored(page, "eventLists"))[SHEET_EVENT])
  241 |           .toHaveLength(3);
  242 |         await page.reload();
  243 |         const items = (await stored(page, "eventLists"))[SHEET_EVENT] as Array<{
  244 |           circle: string;
  245 |         }>;
  246 |         const item = items.find((item) => item.circle === "URLなし手動追加")!;
  247 |         expect(item).toBeTruthy();
  248 |         expect(Object.prototype.hasOwnProperty.call(item, "url")).toBe(false);
  249 |       });
  250 |     }
  251 |     test("removes an existing URL through the guarded editor and persists its absence", async ({
  252 |       page,
  253 |     }) => {
  254 |       await restore(page, 2);
  255 |       const card = page
  256 |         .locator('[data-item-id="item-0"]')
  257 |         .first()
  258 |         .locator(":scope > div.rounded-lg")
  259 |         .first();
  260 |       const edit = async (url: string) => {
  261 |         await card.dispatchEvent("pointerdown", {
  262 |           button: 0,
  263 |           isPrimary: true,
  264 |           pointerType: "mouse",
  265 |         });
  266 |         await card.dispatchEvent("pointerup", {
  267 |           button: 0,
  268 |           isPrimary: true,
  269 |           pointerType: "mouse",
  270 |         });
  271 |         await page.getByRole("button", { name: "編集", exact: true }).click();
  272 |         const editor = page.getByRole("dialog", {
  273 |           name: "アイテム編集",
  274 |           exact: true,
  275 |         });
  276 |         await editor
  277 |           .getByRole("textbox", { name: "URL", exact: true })
  278 |           .fill(url);
  279 |         await editor.getByRole("button", { name: "保存", exact: true }).click();
  280 |         await expect(editor).toBeHidden();
  281 |       };
  282 |       await edit("https://existing.test");
  283 |       await edit("");
  284 |       await expect
  285 |         .poll(async () =>
  286 |           Object.prototype.hasOwnProperty.call(
  287 |             ((await stored(page, "eventLists"))[SHEET_EVENT] as object[])[0],
  288 |             "url",
  289 |           ),
  290 |         )
  291 |         .toBe(false);
  292 |       await page.reload();
  293 |       expect(
  294 |         Object.prototype.hasOwnProperty.call(
  295 |           ((await stored(page, "eventLists"))[SHEET_EVENT] as object[])[0],
  296 |           "url",
  297 |         ),
  298 |       ).toBe(false);
  299 |     });
  300 |   });
  301 | 
```