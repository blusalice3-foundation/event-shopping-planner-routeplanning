# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sheet-import-optional-url.spec.ts >> sheet import and optional URL: worker >> removes an existing URL through the guarded editor and persists its absence
- Location: tests\browser\sheet-import-optional-url.spec.ts:291:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: '編集', exact: true })

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
  233 |       ).toBeVisible();
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
> 311 |         await page.getByRole("button", { name: "編集", exact: true }).click();
      |                                                                     ^ Error: locator.click: Test timeout of 30000ms exceeded.
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
  334 |         Object.prototype.hasOwnProperty.call(
  335 |           ((await stored(page, "eventLists"))[SHEET_EVENT] as object[])[0],
  336 |           "url",
  337 |         ),
  338 |       ).toBe(false);
  339 |     });
  340 |   });
  341 | 
```