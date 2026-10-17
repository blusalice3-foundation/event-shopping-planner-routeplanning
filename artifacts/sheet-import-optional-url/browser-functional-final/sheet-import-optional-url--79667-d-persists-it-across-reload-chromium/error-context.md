# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sheet-import-optional-url.spec.ts >> sheet import and optional URL: direct >> focus: adds a no-URL item and persists it across reload
- Location: tests\browser\sheet-import-optional-url.spec.ts:233:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('dialog').filter({ has: getByRole('heading', { name: '新規アイテム追加', exact: true }) }).getByLabel('サークル名', { exact: true })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - generic [ref=e7]:
        - heading "取込互換検証" [level=1] [ref=e8]
        - button "ホール定義（ブロック割当）" [ref=e9] [cursor=pointer]
        - button "表示項目の設定" [ref=e13] [cursor=pointer]
        - generic [ref=e14]:
          - button "📝" [ref=e15] [cursor=pointer]
          - button "🏃‍♂️" [ref=e16] [cursor=pointer]
          - button "🔍" [ref=e17] [cursor=pointer]
      - generic [ref=e19]:
        - button "イベント一覧" [ref=e20] [cursor=pointer]
        - button "1日目2" [ref=e21] [cursor=pointer]
        - button "アイテム追加" [ref=e22] [cursor=pointer]
        - generic [ref=e23]:
          - textbox "検索..." [ref=e24]
          - button "次を検索" [disabled] [ref=e25]
    - main [ref=e26]:
      - generic [ref=e28]:
        - generic [ref=e30]:
          - generic [ref=e31]:
            - generic [ref=e32]:
              - generic [ref=e33]: 訪問先
              - generic [ref=e34]: A-0
              - generic [ref=e35]:
                - generic [ref=e36]: サークル0
                - generic [ref=e37]: 0/1
            - generic [ref=e39]:
              - generic [ref=e40]: この訪問の支払額
              - generic [ref=e41]:
                - generic [ref=e42]: ¥0
                - generic [ref=e43]: 予定額 ¥1,000
            - generic [ref=e44]:
              - generic [ref=e45]: フェーズ
              - combobox "phase" [ref=e46] [cursor=pointer]:
                - option "通常" [selected]
                - option "後回し"
                - option "遅参"
              - generic [ref=e47]: "次: A-1 サークル1"
          - generic [ref=e48]:
            - button "全購入" [ref=e49] [cursor=pointer]
            - button "全売切" [ref=e50] [cursor=pointer]
            - button "全欠席" [ref=e51] [cursor=pointer]
            - button "全後回" [ref=e52] [cursor=pointer]
            - button "全遅参" [ref=e53] [cursor=pointer]
            - button "全限数" [ref=e54] [cursor=pointer]
        - generic [ref=e55]:
          - list "現在のスペースの品目" [ref=e56]:
            - listitem "A0 サークル0 新刊0" [ref=e60]:
              - generic [ref=e61]:
                - generic [ref=e62]:
                  - checkbox "Select item サークル0 - 新刊0" [ref=e63]
                  - button "完全保護" [ref=e71] [cursor=pointer]: 🔐
                - generic [ref=e72]:
                  - generic [ref=e73]:
                    - generic [ref=e74]: 1日目
                    - generic [ref=e75]: A-0
                    - button "サークル0" [ref=e76] [cursor=pointer]
                  - button "新刊0" [ref=e79] [cursor=pointer]
                  - generic [ref=e81]:
                    - generic "シート情報" [ref=e82]:
                      - generic [ref=e83]: "カタログ価格: 500円"
                      - generic "ユーザー登録" [ref=e84]: "シート備考: ユーザー登録"
                    - textbox "利用者メモ" [ref=e86]: ユーザー登録
                - generic [ref=e87]:
                  - 'button "Current status: 未購入. Click to change." [ref=e88] [cursor=pointer]':
                    - generic [ref=e91]: 未購入
                  - generic [ref=e92]:
                    - generic [ref=e93]: 数量
                    - combobox "購入予定数量" [ref=e94]:
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
                  - generic [ref=e95]:
                    - generic [ref=e96]: 購入金額
                    - generic [ref=e97]: ¥
                    - combobox "購入金額" [ref=e98]:
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
          - button "+" [ref=e100] [cursor=pointer]
        - button "前の訪問先へ移動" [ref=e101] [cursor=pointer]: ◀
        - button "次の訪問先へ移動" [ref=e102] [cursor=pointer]: ▶
    - status "保存済み"
  - contentinfo "集中モード操作" [ref=e103]:
    - generic [ref=e105]:
      - generic [ref=e106]:
        - generic [ref=e107]: "通常: 1/2"
        - generic [ref=e108]: (1/2)
      - generic [ref=e109]:
        - button "スペース一覧を開く" [ref=e110] [cursor=pointer]:
          - generic [ref=e111]: ▥
          - generic [ref=e112]: スペース一覧
        - generic [ref=e113]: 0 / 2 件購入済み
        - generic [ref=e114]:
          - generic [ref=e115]: "残りの合計:"
          - generic [ref=e116]: ¥2,000
        - button "スマートフォンモードに切替" [ref=e117] [cursor=pointer]
  - navigation "スペースナビゲーション" [ref=e120]:
    - slider "スペースナビ" [ref=e121]:
      - generic:
        - generic "A-0":
          - generic "正式な現在地"
        - generic "A-1"
  - dialog [ref=e123]:
    - generic [ref=e124]:
      - heading "新規アイテム追加" [level=2] [ref=e125]
      - paragraph [ref=e126]: 1日目 A-0
    - generic [ref=e127]:
      - generic [ref=e128]:
        - generic [ref=e129]:
          - generic [ref=e130]: サークル名 *
          - combobox "サークル名" [active] [ref=e131]: サークル0
        - generic [ref=e132]:
          - generic [ref=e133]: タイトル
          - textbox "タイトル" [ref=e134]:
            - /placeholder: 新刊セット
      - generic [ref=e135]:
        - generic [ref=e136]:
          - generic [ref=e137]: 参加日
          - textbox "参加日" [ref=e138]: 1日目
        - generic [ref=e139]:
          - generic [ref=e140]: ブロック
          - textbox "ブロック" [ref=e141]: A
        - generic [ref=e142]:
          - generic [ref=e143]: ナンバー
          - textbox "ナンバー" [ref=e144]:
            - /placeholder: 01a
            - text: "0"
      - generic [ref=e145]:
        - generic [ref=e146]:
          - generic [ref=e147]: 購入金額
          - textbox "購入金額" [ref=e148]:
            - /placeholder: "0"
          - generic [ref=e149]: 円
        - generic [ref=e150]:
          - generic [ref=e151]: クイック選択
          - combobox "クイック選択" [ref=e152]:
            - option "金額を選択..." [disabled] [selected]
            - option "0円"
            - option "100円"
            - option "200円"
            - option "300円"
            - option "400円"
            - option "500円"
            - option "600円"
            - option "700円"
            - option "800円"
            - option "900円"
            - option "1,000円"
            - option "1,100円"
            - option "1,200円"
            - option "1,300円"
            - option "1,400円"
            - option "1,500円"
            - option "1,600円"
            - option "1,700円"
            - option "1,800円"
            - option "1,900円"
            - option "2,000円"
            - option "2,100円"
            - option "2,200円"
            - option "2,300円"
            - option "2,400円"
            - option "2,500円"
            - option "2,600円"
            - option "2,700円"
            - option "2,800円"
            - option "2,900円"
            - option "3,000円"
            - option "3,100円"
            - option "3,200円"
            - option "3,300円"
            - option "3,400円"
            - option "3,500円"
            - option "3,600円"
            - option "3,700円"
            - option "3,800円"
            - option "3,900円"
            - option "4,000円"
            - option "4,100円"
            - option "4,200円"
            - option "4,300円"
            - option "4,400円"
            - option "4,500円"
            - option "4,600円"
            - option "4,700円"
            - option "4,800円"
            - option "4,900円"
            - option "5,000円"
            - option "5,100円"
            - option "5,200円"
            - option "5,300円"
            - option "5,400円"
            - option "5,500円"
            - option "5,600円"
            - option "5,700円"
            - option "5,800円"
            - option "5,900円"
            - option "6,000円"
            - option "6,100円"
            - option "6,200円"
            - option "6,300円"
            - option "6,400円"
            - option "6,500円"
            - option "6,600円"
            - option "6,700円"
            - option "6,800円"
            - option "6,900円"
            - option "7,000円"
            - option "7,100円"
            - option "7,200円"
            - option "7,300円"
            - option "7,400円"
            - option "7,500円"
            - option "7,600円"
            - option "7,700円"
            - option "7,800円"
            - option "7,900円"
            - option "8,000円"
            - option "8,100円"
            - option "8,200円"
            - option "8,300円"
            - option "8,400円"
            - option "8,500円"
            - option "8,600円"
            - option "8,700円"
            - option "8,800円"
            - option "8,900円"
            - option "9,000円"
            - option "9,100円"
            - option "9,200円"
            - option "9,300円"
            - option "9,400円"
            - option "9,500円"
            - option "9,600円"
            - option "9,700円"
            - option "9,800円"
            - option "9,900円"
            - option "10,000円"
            - option "10,100円"
            - option "10,200円"
            - option "10,300円"
            - option "10,400円"
            - option "10,500円"
            - option "10,600円"
            - option "10,700円"
            - option "10,800円"
            - option "10,900円"
            - option "11,000円"
            - option "11,100円"
            - option "11,200円"
            - option "11,300円"
            - option "11,400円"
            - option "11,500円"
            - option "11,600円"
            - option "11,700円"
            - option "11,800円"
            - option "11,900円"
            - option "12,000円"
            - option "12,100円"
            - option "12,200円"
            - option "12,300円"
            - option "12,400円"
            - option "12,500円"
            - option "12,600円"
            - option "12,700円"
            - option "12,800円"
            - option "12,900円"
            - option "13,000円"
            - option "13,100円"
            - option "13,200円"
            - option "13,300円"
            - option "13,400円"
            - option "13,500円"
            - option "13,600円"
            - option "13,700円"
            - option "13,800円"
            - option "13,900円"
            - option "14,000円"
            - option "14,100円"
            - option "14,200円"
            - option "14,300円"
            - option "14,400円"
            - option "14,500円"
            - option "14,600円"
            - option "14,700円"
            - option "14,800円"
            - option "14,900円"
            - option "15,000円"
      - generic [ref=e153]:
        - generic [ref=e154]:
          - generic [ref=e155]: 数量
          - combobox "数量" [ref=e156]:
            - option "1" [selected]
            - option "2"
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
        - generic [ref=e157]:
          - generic [ref=e158]: 購入状態
          - combobox "購入状態" [ref=e159]:
            - option "購入済" [selected]
            - option "後回し"
            - option "遅参"
      - generic [ref=e160]:
        - generic [ref=e161]:
          - generic [ref=e162]: 利用者メモ
          - textbox "利用者メモ" [ref=e163]:
            - /placeholder: スケブお願い
        - generic [ref=e164]:
          - generic [ref=e165]: URL
          - textbox "URL" [ref=e166]:
            - /placeholder: https://example.com
    - generic [ref=e167]:
      - button "キャンセル" [ref=e168] [cursor=pointer]
      - button "リストに追加" [ref=e169] [cursor=pointer]
```

# Test source

```ts
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
  230 |       ).toBeVisible();
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
> 271 |             .fill("URLなし手動追加");
      |              ^ Error: locator.fill: Test timeout of 30000ms exceeded.
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
  331 |           ((await stored(page, "eventLists"))[SHEET_EVENT] as object[])[0],
  332 |           "url",
  333 |         ),
  334 |       ).toBe(false);
  335 |     });
  336 |   });
  337 | 
```