# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sheet-import-optional-url.spec.ts >> sheet import and optional URL: direct >> execute: adds a no-URL item and persists it across reload
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
      - generic [ref=e5]:
        - generic [ref=e7]:
          - heading "取込互換検証" [level=1] [ref=e8]
          - button "ブロック番号で並べ替え" [ref=e9] [cursor=pointer]
          - button "ホール定義（ブロック割当）" [ref=e12] [cursor=pointer]
          - button "表示項目の設定" [ref=e16] [cursor=pointer]
          - generic [ref=e17]:
            - button "📝" [ref=e18] [cursor=pointer]
            - button "🏃‍♂️" [ref=e19] [cursor=pointer]
            - button "🔍" [ref=e20] [cursor=pointer]
        - generic [ref=e21]:
          - button "巡回順" [ref=e22] [cursor=pointer]
          - button "スペース別" [ref=e23] [cursor=pointer]
      - generic [ref=e25]:
        - button "イベント一覧" [ref=e26] [cursor=pointer]
        - button "1日目2" [ref=e27] [cursor=pointer]
        - button "アイテム追加" [ref=e28] [cursor=pointer]
        - generic [ref=e29]:
          - textbox "検索..." [ref=e30]
          - button "次を検索" [disabled] [ref=e31]
    - main [ref=e32]:
      - list "買い物リスト" [ref=e34]:
        - button "全て折りたたむ" [ref=e36] [cursor=pointer]
        - listitem "A-0 1件" [ref=e38]:
          - generic [ref=e40]:
            - generic [ref=e41] [cursor=pointer]:
              - generic [ref=e42]:
                - generic [ref=e43]:
                  - generic [ref=e44]:
                    - generic [ref=e45]: ▶
                    - generic [ref=e46]: A-0
                    - generic "サークル0" [ref=e47]
                  - generic [ref=e48]: 1件
                - generic [ref=e51]:
                  - button "全購入" [ref=e52]
                  - button "全売切" [ref=e53]
                  - button "全欠席" [ref=e54]
                  - button "全後回" [ref=e55]
                  - button "全遅参" [ref=e56]
                  - button "全限数" [ref=e57]
              - button "このスペースにアイテムを追加" [ref=e58]
            - list "A-0の項目" [ref=e61]:
              - listitem "A0 サークル0 新刊0" [ref=e63]:
                - generic [ref=e65]:
                  - generic [ref=e66]:
                    - checkbox "Select item サークル0 - 新刊0" [ref=e67]
                    - button "上に移動" [disabled] [ref=e68]
                    - button "下に移動" [ref=e78] [cursor=pointer]
                    - button "完全保護" [ref=e81] [cursor=pointer]: 🔐
                  - generic [ref=e82]:
                    - generic [ref=e83]:
                      - generic [ref=e84]: 1日目
                      - generic [ref=e85]: A-0
                      - button "サークル0" [ref=e86] [cursor=pointer]
                    - button "新刊0" [ref=e89] [cursor=pointer]
                    - generic [ref=e91]:
                      - generic "シート情報" [ref=e92]:
                        - generic [ref=e93]: "カタログ価格: 500円"
                        - generic "ユーザー登録" [ref=e94]: "シート備考: ユーザー登録"
                      - textbox "利用者メモ" [ref=e96]: ユーザー登録
                  - generic [ref=e97]:
                    - 'button "Current status: 未購入. Click to change." [ref=e98] [cursor=pointer]':
                      - generic [ref=e101]: 未購入
                    - generic [ref=e102]:
                      - generic [ref=e103]: 数量
                      - combobox "購入予定数量" [ref=e104]:
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
                    - generic [ref=e105]:
                      - generic [ref=e106]: 購入金額
                      - generic [ref=e107]: ¥
                      - combobox "購入金額" [ref=e108]:
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
        - listitem "A-1 1件" [ref=e110]:
          - generic [ref=e112]:
            - generic [ref=e113] [cursor=pointer]:
              - generic [ref=e114]:
                - generic [ref=e115]:
                  - generic [ref=e116]:
                    - generic [ref=e117]: ▶
                    - generic [ref=e118]: A-1
                    - generic "サークル1" [ref=e119]
                  - generic [ref=e120]: 1件
                - generic [ref=e123]:
                  - button "全購入" [ref=e124]
                  - button "全売切" [ref=e125]
                  - button "全欠席" [ref=e126]
                  - button "全後回" [ref=e127]
                  - button "全遅参" [ref=e128]
                  - button "全限数" [ref=e129]
              - button "このスペースにアイテムを追加" [ref=e130]
            - list "A-1の項目" [ref=e133]:
              - listitem "A1 サークル1 新刊1" [ref=e135]:
                - generic [ref=e137]:
                  - generic [ref=e138]:
                    - checkbox "Select item サークル1 - 新刊1" [ref=e139]
                    - button "上に移動" [ref=e140] [cursor=pointer]
                    - button "下に移動" [disabled] [ref=e150]
                    - button "保護なし" [ref=e153] [cursor=pointer]: 🔓
                  - generic [ref=e154]:
                    - generic [ref=e155]:
                      - generic [ref=e156]: 1日目
                      - generic [ref=e157]: A-1
                      - button "サークル1" [ref=e158] [cursor=pointer]
                    - button "新刊1" [ref=e161] [cursor=pointer]
                    - generic [ref=e163]:
                      - generic "シート情報" [ref=e164]:
                        - generic [ref=e165]: "カタログ価格: 500円"
                        - generic "ユーザー登録" [ref=e166]: "シート備考: ユーザー登録"
                      - textbox "利用者メモ" [ref=e168]: ユーザー登録
                  - generic [ref=e169]:
                    - 'button "Current status: 未購入. Click to change." [ref=e170] [cursor=pointer]':
                      - generic [ref=e173]: 未購入
                    - generic [ref=e174]:
                      - generic [ref=e175]: 数量
                      - combobox "購入予定数量" [ref=e176]:
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
                    - generic [ref=e177]:
                      - generic [ref=e178]: 購入金額
                      - generic [ref=e179]: ¥
                      - combobox "購入金額" [ref=e180]:
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
    - generic [ref=e183]:
      - generic [ref=e184]: 0 / 2 件購入済み
      - button "スペース一覧を開く" [ref=e185] [cursor=pointer]:
        - generic [ref=e186]: ▥
        - generic [ref=e187]: スペース一覧
      - generic [ref=e188]:
        - generic [ref=e189]: 残りの合計
        - generic [ref=e190]: ¥2,000
    - status "保存済み"
  - navigation "スペースナビゲーション" [ref=e191]:
    - slider "スペースナビ" [ref=e192]:
      - generic:
        - generic "A-0"
        - generic "A-1":
          - generic "正式な現在地"
  - dialog [ref=e194]:
    - generic [ref=e195]:
      - heading "新規アイテム追加" [level=2] [ref=e196]
      - paragraph [ref=e197]: 1日目 A-0
    - generic [ref=e198]:
      - generic [ref=e199]:
        - generic [ref=e200]:
          - generic [ref=e201]: サークル名 *
          - combobox "サークル名" [active] [ref=e202]
        - generic [ref=e203]:
          - generic [ref=e204]: タイトル
          - textbox "タイトル" [ref=e205]:
            - /placeholder: 新刊セット
      - generic [ref=e206]:
        - generic [ref=e207]:
          - generic [ref=e208]: 参加日
          - textbox "参加日" [ref=e209]: 1日目
        - generic [ref=e210]:
          - generic [ref=e211]: ブロック
          - textbox "ブロック" [ref=e212]:
            - /placeholder: A
            - text: A
        - generic [ref=e213]:
          - generic [ref=e214]: ナンバー
          - textbox "ナンバー" [ref=e215]:
            - /placeholder: 01a
            - text: "0"
      - generic [ref=e216]:
        - generic [ref=e217]:
          - generic [ref=e218]: 購入金額
          - textbox "購入金額" [ref=e219]:
            - /placeholder: "0"
          - generic [ref=e220]: 円
        - generic [ref=e221]:
          - generic [ref=e222]: クイック選択
          - combobox "クイック選択" [ref=e223]:
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
      - generic [ref=e224]:
        - generic [ref=e225]:
          - generic [ref=e226]: 数量
          - combobox "数量" [ref=e227]:
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
        - generic [ref=e228]:
          - generic [ref=e229]: 購入状態
          - combobox "購入状態" [ref=e230]:
            - option "未購入" [selected]
            - option "購入済"
            - option "後回し"
            - option "遅参"
      - generic [ref=e231]:
        - generic [ref=e232]:
          - generic [ref=e233]: 利用者メモ
          - textbox "利用者メモ" [ref=e234]:
            - /placeholder: スケブお願い
        - generic [ref=e235]:
          - generic [ref=e236]: URL
          - textbox "URL" [ref=e237]:
            - /placeholder: https://example.com
    - generic [ref=e238]:
      - button "キャンセル" [ref=e239] [cursor=pointer]
      - button "リストに追加" [disabled] [ref=e240]
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