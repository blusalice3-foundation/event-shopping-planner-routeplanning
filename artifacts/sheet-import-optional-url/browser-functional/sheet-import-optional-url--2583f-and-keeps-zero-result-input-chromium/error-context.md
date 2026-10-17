# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sheet-import-optional-url.spec.ts >> sheet import and optional URL: direct >> new URL import excludes incomplete rows, saves no-URL items and keeps zero-result input
- Location: tests\browser\sheet-import-optional-url.spec.ts:162:5

# Error details

```
Error: expect(received).toHaveLength(expected)

Matcher error: received value must have a length property whose value must be a number

Received has value: undefined

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - dialog "所属・配置の変更を確認" [ref=e4]:
    - generic [ref=e5]:
      - heading "所属・配置の変更を確認" [level=2] [ref=e6]
      - region "確認内容" [ref=e7]:
        - generic [ref=e8]: "1日目 / マップなし: サークル1・新刊1 → 未割当（共有 1 件）"
        - generic [ref=e9]: "1日目 / マップなし: サークル2・新刊2 → 未割当（共有 1 件）"
        - generic [ref=e10]: "1日目 / マップなし: サークル3・新刊3 → 未割当（共有 1 件）"
        - generic [ref=e11]: "1日目 / マップなし: 巡回順: なし"
        - generic [ref=e12]: "1日目 / マップなし: 訪問リスト: なし"
      - generic [ref=e13]:
        - button "取消" [ref=e14] [cursor=pointer]
        - button "確認して保存" [ref=e15] [cursor=pointer]
  - banner [ref=e16]:
    - generic [ref=e19]:
      - heading "即売会購入巡回表" [level=1] [ref=e20]
      - button "表示項目の設定" [ref=e22] [cursor=pointer]
    - generic [ref=e24]:
      - button "イベント一覧" [ref=e25] [cursor=pointer]
      - button "新規リスト作成" [ref=e26] [cursor=pointer]
  - main [ref=e27]:
    - generic [ref=e28]:
      - heading "新規リスト作成" [level=2] [ref=e29]
      - paragraph [ref=e30]: スプレッドシートのM列 サークル名 / N列 参加日 / O列 ブロック / P列 番号 / Q列 タイトル / R列 価格 / W列 備考をこの順番でコピーし、下の「M列 サークル名」欄に貼り付けてください。データが自動で振り分けられます。
      - status [ref=e31]: 保存処理中です。
      - region "シート取込結果" [ref=e32]:
        - paragraph [ref=e33]: "取込対象: 3件、必須項目不足による除外: 1行"
        - paragraph [ref=e34]: "不足項目: ブロック 1行"
        - group [ref=e35]:
          - generic "除外行の例（先頭1行）" [ref=e36]
      - generic [ref=e37]:
        - generic [ref=e38]:
          - generic [ref=e39]: 即売会名
          - textbox "即売会名" [ref=e40]:
            - /placeholder: "例: C105"
            - text: 取込互換検証
        - generic [ref=e41]:
          - heading "インポート方法" [level=3] [ref=e42]
          - generic [ref=e43]:
            - generic [ref=e44]: スプレッドシートURLからインポート
            - generic [ref=e45]:
              - textbox "スプレッドシートURLからインポート" [ref=e46]:
                - /placeholder: https://docs.google.com/spreadsheets/d/..../edit
                - text: https://docs.google.com/spreadsheets/d/new/edit
              - button "URLからインポート" [active] [ref=e47] [cursor=pointer]
            - paragraph [ref=e48]: シート名「品目表」のM列からR列とW列をインポートします
          - generic [ref=e49]:
            - text: CSVの列形式
            - combobox "CSVの列形式" [ref=e50]:
              - option "見出しから自動判定" [selected]
              - option "A列開始・見出しあり"
              - option "A列開始・見出しなし"
              - option "M列開始・見出しあり"
              - option "M列開始・見出しなし"
          - generic [ref=e51]:
            - generic [ref=e52]: CSVファイルからインポート
            - button "CSVファイルからインポート" [disabled] [ref=e53]
            - paragraph [ref=e54]: 見出しから形式を判定します。見出しがない場合は列形式を指定してください。
          - generic [ref=e55]: または
        - generic [ref=e56]:
          - generic [ref=e57]:
            - generic [ref=e58]: M列 サークル名
            - textbox "M列 サークル名" [ref=e59]:
              - /placeholder: "サークルA\nサークルB"
          - generic [ref=e60]:
            - generic [ref=e61]: N列 参加日
            - textbox "N列 参加日" [ref=e62]:
              - /placeholder: "1日目\n2日目"
          - generic [ref=e63]:
            - generic [ref=e64]: O列 ブロック
            - textbox "O列 ブロック" [ref=e65]:
              - /placeholder: "G\nカ"
          - generic [ref=e66]:
            - generic [ref=e67]: P列 番号
            - textbox "P列 番号" [ref=e68]:
              - /placeholder: "01a\n03b"
          - generic [ref=e69]:
            - generic [ref=e70]: Q列 タイトル
            - textbox "Q列 タイトル" [ref=e71]:
              - /placeholder: "新刊セット\n既刊1"
          - generic [ref=e72]:
            - generic [ref=e73]: R列 価格
            - textbox "R列 価格" [ref=e74]:
              - /placeholder: "1000\n500"
        - generic [ref=e75]:
          - generic [ref=e76]:
            - generic [ref=e77]: W列 備考
            - textbox "W列 備考" [ref=e78]:
              - /placeholder: "スケブお願い\n挨拶に行く"
          - generic [ref=e79]:
            - generic [ref=e80]: URL（7列貼り付け対象外）
            - textbox "URL（7列貼り付け対象外）" [ref=e81]:
              - /placeholder: "https://example.com\nhttps://example2.com"
        - button "リストを作成" [ref=e83] [cursor=pointer]
  - status "保存中…"
```

# Test source

```ts
  98  |             if (await list.isVisible()) await list.click();
  99  |             await page
  100 |               .getByRole("button", { name: "メニュー", exact: true })
  101 |               .click();
  102 |             await page
  103 |               .getByRole("button", { name: "🔄 アイテム更新", exact: true })
  104 |               .click();
  105 |             if (kind === "source-switch") {
  106 |               await page
  107 |                 .getByRole("textbox", {
  108 |                   name: "スプレッドシートURL",
  109 |                   exact: true,
  110 |                 })
  111 |                 .fill("https://docs.google.com/spreadsheets/d/new/edit");
  112 |               await page
  113 |                 .getByRole("button", { name: "更新", exact: true })
  114 |                 .click();
  115 |             }
  116 |           };
  117 |           await open();
  118 |           const summary = page.getByRole("region", { name: "シート取込結果" });
  119 |           await expect(summary).toContainText(
  120 |             `取込対象: 0件、必須項目不足による除外: ${count}行`,
  121 |           );
  122 |           await expect(summary.locator("li")).toHaveCount(20);
  123 |           await expect(
  124 |             page.getByText(`削除候補: ${count - 1}件、削除から保護: 1件`, {
  125 |               exact: true,
  126 |             }),
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
> 198 |         .toHaveLength(3);
      |          ^ Error: expect(received).toHaveLength(expected)
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
  227 |             .click();
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
```