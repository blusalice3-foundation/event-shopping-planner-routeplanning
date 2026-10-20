# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: priority-dialog-interaction.spec.ts >> bulk limited input contains touch and keyboard across confirmations and the next item: pc
- Location: tests\browser\priority-dialog-interaction.spec.ts:113:3

# Error details

```
Error: locator.click: Error: strict mode violation: getByRole('button', { name: '全限数', exact: true }) resolved to 2 elements:
    1) <button class="px-2 py-0.5 text-xs flex-shrink-0 whitespace-nowrap font-medium rounded transition-colors bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:bg-orange-100 dark:hover:bg-orange-900/30">全限数</button> aka getByLabel('A-1 2件').getByRole('button', { name: '全限数' })
    2) <button class="px-2 py-0.5 text-xs flex-shrink-0 whitespace-nowrap font-medium rounded transition-colors bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:bg-orange-100 dark:hover:bg-orange-900/30">全限数</button> aka getByLabel('A-2 1件').getByRole('button', { name: '全限数' })

Call log:
  - waiting for getByRole('button', { name: '全限数', exact: true })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - generic [ref=e7]:
        - heading "優先操作の結合検証" [level=1] [ref=e8]
        - button "ホール間移動順序" [ref=e9] [cursor=pointer]
        - button "マップ表示に切り替え" [ref=e13] [cursor=pointer]
        - button "表示項目の設定" [ref=e17] [cursor=pointer]
        - generic [ref=e18]:
          - button "📝" [ref=e19] [cursor=pointer]
          - button "🏃‍♂️" [ref=e20] [cursor=pointer]
          - button "🔍" [active] [ref=e21] [cursor=pointer]
      - generic [ref=e23]:
        - button "イベント一覧" [ref=e24] [cursor=pointer]
        - button "1日目3" [ref=e25] [cursor=pointer]
        - button "2日目1" [ref=e26] [cursor=pointer]
        - button "アイテム追加" [ref=e27] [cursor=pointer]
        - generic [ref=e28]:
          - textbox "検索..." [ref=e29]
          - button "次を検索" [disabled] [ref=e30]
    - main [ref=e31]:
      - generic [ref=e33]:
        - generic [ref=e35]:
          - generic [ref=e36]:
            - generic [ref=e37]:
              - generic [ref=e38]: 訪問先
              - generic [ref=e39]: A-1
              - generic [ref=e40]:
                - generic [ref=e41]: first・second
                - generic [ref=e42]: 0/2
            - generic [ref=e44]:
              - generic [ref=e45]: この訪問の支払額
              - generic [ref=e46]:
                - generic [ref=e47]: ¥0
                - generic [ref=e48]: 予定額 ¥5,000
            - generic [ref=e49]:
              - generic [ref=e50]: フェーズ
              - combobox "phase" [ref=e51] [cursor=pointer]:
                - option "通常" [selected]
                - option "後回し"
                - option "遅参"
              - generic [ref=e52]: "次: A-2 next"
          - generic [ref=e53]:
            - button "全購入" [ref=e54] [cursor=pointer]
            - button "全売切" [ref=e55] [cursor=pointer]
            - button "全欠席" [ref=e56] [cursor=pointer]
            - button "全後回" [ref=e57] [cursor=pointer]
            - button "全遅参" [ref=e58] [cursor=pointer]
            - button "全限数" [ref=e59] [cursor=pointer]
        - generic [ref=e60]:
          - list "現在のスペースの品目" [ref=e61]:
            - generic [ref=e62]:
              - listitem "A1 first 最初の入力" [ref=e65]:
                - generic [ref=e66]:
                  - generic [ref=e67]:
                    - checkbox "Select item first - 最初の入力" [ref=e68]
                    - button "保護なし" [ref=e76] [cursor=pointer]: 🔓
                  - generic [ref=e77]:
                    - generic [ref=e78]:
                      - generic [ref=e79]: 1日目
                      - generic [ref=e80]: A-1
                      - button "first" [ref=e81] [cursor=pointer]
                    - button "最初の入力" [ref=e84] [cursor=pointer]
                    - textbox "利用者メモ" [ref=e88]: ユーザー登録
                  - generic [ref=e89]:
                    - 'button "Current status: 未購入. Click to change." [ref=e90] [cursor=pointer]':
                      - generic [ref=e93]: 未購入
                    - generic [ref=e94]:
                      - generic [ref=e95]: 数量
                      - combobox "購入予定数量" [ref=e96]:
                        - option "1"
                        - option "2"
                        - option "3"
                        - option "4"
                        - option "5" [selected]
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
                    - generic [ref=e97]:
                      - generic [ref=e98]: 購入金額
                      - generic [ref=e99]: ¥
                      - combobox "購入金額" [ref=e100]:
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
              - listitem "A1 second 次の入力" [ref=e103]:
                - generic [ref=e104]:
                  - generic [ref=e105]:
                    - checkbox "Select item second - 次の入力" [ref=e106]
                    - button "保護なし" [ref=e114] [cursor=pointer]: 🔓
                  - generic [ref=e115]:
                    - generic [ref=e116]:
                      - generic [ref=e117]: 1日目
                      - generic [ref=e118]: A-1
                      - button "second" [ref=e119] [cursor=pointer]
                    - button "次の入力" [ref=e122] [cursor=pointer]
                    - textbox "利用者メモ" [ref=e126]: ユーザー登録
                  - generic [ref=e127]:
                    - 'button "Current status: 未購入. Click to change." [ref=e128] [cursor=pointer]':
                      - generic [ref=e131]: 未購入
                    - generic [ref=e132]:
                      - generic [ref=e133]: 数量
                      - combobox "購入予定数量" [ref=e134]:
                        - option "1"
                        - option "2"
                        - option "3"
                        - option "4"
                        - option "5" [selected]
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
                    - generic [ref=e135]:
                      - generic [ref=e136]: 購入金額
                      - generic [ref=e137]: ¥
                      - combobox "購入金額" [ref=e138]:
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
          - button "+" [ref=e140] [cursor=pointer]
        - button "前の訪問先へ移動" [ref=e141] [cursor=pointer]: ◀
        - button "次の訪問先へ移動" [ref=e142] [cursor=pointer]: ▶
    - status "保存済み"
  - contentinfo "集中モード操作" [ref=e143]:
    - generic [ref=e145]:
      - generic [ref=e146]:
        - generic [ref=e147]: "通常: 1/2"
        - generic [ref=e148]: (1/2)
      - generic [ref=e149]:
        - button "スペース一覧を開く" [ref=e150] [cursor=pointer]:
          - generic [ref=e151]: ▥
          - generic [ref=e152]: スペース一覧
        - generic [ref=e153]: 0 / 3 件購入済み
        - generic [ref=e154]:
          - generic [ref=e155]: "残りの合計:"
          - generic [ref=e156]: ¥7,500
        - button "マップを表示" [ref=e157] [cursor=pointer]
        - button "スマートフォンモードに切替" [ref=e160] [cursor=pointer]
  - navigation "スペースナビゲーション" [ref=e163]:
    - slider "スペースナビ" [ref=e164]:
      - generic:
        - generic "A-1":
          - generic "正式な現在地"
        - generic "A-2"
```

# Test source

```ts
  32  |         { row: 3, col: 2, value: 2 },
  33  |       ],
  34  |     },
  35  |   ],
  36  | };
  37  | async function restore(page: Page) {
  38  |   await page.goto("/");
  39  |   await page
  40  |     .locator('input[aria-label="バックアップファイルを選択"]')
  41  |     .setInputFiles({
  42  |       name: "priority-interaction.json",
  43  |       mimeType: "application/json",
  44  |       buffer: Buffer.from(
  45  |         JSON.stringify({
  46  |           kind: "event-shopping-planner-backup",
  47  |           version: 1,
  48  |           exportedAt: "2026-10-18T00:00:00.000Z",
  49  |           eventSettings: { blockDetectionSettings: {} },
  50  |           data: {
  51  |             eventLists: { [eventName]: items },
  52  |             eventMetadata: {},
  53  |             executeModeItems: {
  54  |               [eventName]: {
  55  |                 "1日目": ["first", "second", "next"],
  56  |                 "2日目": ["other"],
  57  |               },
  58  |             },
  59  |             dayModes: {
  60  |               [eventName]: { "1日目": "execute", "2日目": "execute" },
  61  |             },
  62  |             mapData: {
  63  |               [eventName]: { "1日目マップ": map, "2日目マップ": map },
  64  |             },
  65  |             mapRotationSettings: {},
  66  |             mapViewportSettings: {},
  67  |             routeSettings: {},
  68  |             hallDefinitions: {},
  69  |             hallRouteSettings: {},
  70  |           },
  71  |         }),
  72  |         "utf8",
  73  |       ),
  74  |     });
  75  |   const dialog = page.getByRole("dialog", {
  76  |     name: "バックアップからイベントを復元",
  77  |   });
  78  |   await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  79  |   await dialog.getByRole("button", { name: "置換して復元" }).click();
  80  |   await expect(dialog).toBeHidden();
  81  |   await expect(
  82  |     page.getByRole("heading", { name: eventName, exact: true }),
  83  |   ).toBeVisible();
  84  | }
  85  | async function swipe(page: Page, selector: string) {
  86  |   await page.locator(selector).evaluate((root) => {
  87  |     const start = new Touch({
  88  |       identifier: 1,
  89  |       target: root,
  90  |       clientX: 250,
  91  |       clientY: 150,
  92  |     });
  93  |     const end = new Touch({
  94  |       identifier: 1,
  95  |       target: root,
  96  |       clientX: 50,
  97  |       clientY: 150,
  98  |     });
  99  |     root.dispatchEvent(
  100 |       new TouchEvent("touchstart", { bubbles: true, touches: [start] }),
  101 |     );
  102 |     root.dispatchEvent(
  103 |       new TouchEvent("touchmove", { bubbles: true, touches: [end] }),
  104 |     );
  105 |     root.dispatchEvent(
  106 |       new TouchEvent("touchend", { bubbles: true, changedTouches: [end] }),
  107 |     );
  108 |     root.dispatchEvent(new TouchEvent("touchcancel", { bubbles: true }));
  109 |   });
  110 | }
  111 | 
  112 | for (const layout of ["pc", "smartphone"] as const)
  113 |   test(`bulk limited input contains touch and keyboard across confirmations and the next item: ${layout}`, async ({
  114 |     page,
  115 |   }) => {
  116 |     const errors: string[] = [];
  117 |     page.on("pageerror", (error) => errors.push(error.message));
  118 |     await restore(page);
  119 |     if (layout === "smartphone") {
  120 |       await page.getByTitle("表示項目の設定", { exact: true }).click();
  121 |       await page
  122 |         .getByTitle("スマートフォンモードに切替", { exact: true })
  123 |         .click();
  124 |       await page.setViewportSize({ width: 390, height: 844 });
  125 |       await page
  126 |         .locator("div.fixed.inset-0.z-40")
  127 |         .first()
  128 |         .click({ position: { x: 2, y: 100 } });
  129 |     }
  130 |     await page.getByTitle("集中モード", { exact: true }).click();
  131 |     const origin = page.getByRole("button", { name: "全限数", exact: true });
> 132 |     await origin.click();
      |                  ^ Error: locator.click: Error: strict mode violation: getByRole('button', { name: '全限数', exact: true }) resolved to 2 elements:
  133 |     const main = page.getByRole("dialog", {
  134 |       name: "限数購入の数量",
  135 |       exact: true,
  136 |     });
  137 |     const actual = main.getByRole("textbox", { name: "実購入数", exact: true });
  138 |     await expect(actual).toBeFocused();
  139 |     await swipe(page, '[aria-labelledby="limited-purchase-dialog-title"]');
  140 |     await expect(
  141 |       main.getByText("対象: 最初の入力", { exact: true }),
  142 |     ).toBeVisible();
  143 |     await actual.fill("5");
  144 |     await main.getByRole("button", { name: "保存", exact: true }).click();
  145 |     const confirm = page.getByRole("dialog", {
  146 |       name: "購入済として保存しますか？",
  147 |       exact: true,
  148 |     });
  149 |     await expect(confirm).toBeVisible();
  150 |     await confirm.press("Escape");
  151 |     await expect(confirm).toBeHidden();
  152 |     await expect(
  153 |       main.getByRole("button", { name: "保存", exact: true }),
  154 |     ).toBeFocused();
  155 |     await main.getByRole("button", { name: "保存", exact: true }).click();
  156 |     await confirm
  157 |       .getByRole("button", { name: "購入済にする", exact: true })
  158 |       .click();
  159 |     await expect(
  160 |       main.getByText("対象: 次の入力", { exact: true }),
  161 |     ).toBeVisible();
  162 |     await expect(actual).toBeFocused();
  163 |     await page.keyboard.press("Shift+Tab");
  164 |     await expect(
  165 |       main.getByRole("button", { name: "保存", exact: true }),
  166 |     ).toBeFocused();
  167 |     await page.keyboard.press("Tab");
  168 |     await expect(actual).toBeFocused();
  169 |     await page.keyboard.press("Escape");
  170 |     await expect(main).toBeHidden();
  171 |     await expect(origin).toBeFocused();
  172 |     await origin.click();
  173 |     await expect(actual).toBeFocused();
  174 |     await page.keyboard.press("Escape");
  175 |     expect(errors).toEqual([]);
  176 |   });
  177 | 
  178 | test("keyboard day changes discard popup input while retaining the map canvas", async ({
  179 |   page,
  180 | }) => {
  181 |   const errors: string[] = [];
  182 |   page.on("pageerror", (error) => errors.push(error.message));
  183 |   await restore(page);
  184 |   await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  185 |   const canvas = page.locator("canvas");
  186 |   await canvas.evaluate((element) => {
  187 |     element.dataset.priorityIdentity = "kept";
  188 |   });
  189 |   await canvas.click({ position: { x: 42, y: 42 } });
  190 |   const popup = page.getByRole("dialog", {
  191 |     name: "A-1のアイテム一覧",
  192 |     exact: true,
  193 |   });
  194 |   await expect(popup).toBeVisible();
  195 |   const day2 = page.getByRole("button", { name: /^2日目/ }).first();
  196 |   await day2.focus();
  197 |   await day2.press("Enter");
  198 |   await expect(popup).toBeHidden();
  199 |   await expect(canvas).toHaveAttribute("data-priority-identity", "kept");
  200 |   const day1 = page.getByRole("button", { name: /^1日目/ }).first();
  201 |   await day1.focus();
  202 |   await day1.press("Enter");
  203 |   await expect(popup).toBeHidden();
  204 |   await canvas.click({ position: { x: 42, y: 42 } });
  205 |   await popup
  206 |     .getByRole("button", { name: "新規アイテム追加", exact: true })
  207 |     .click();
  208 |   const add = page.getByRole("dialog", {
  209 |     name: "新規アイテム追加",
  210 |     exact: true,
  211 |   });
  212 |   await expect(add.getByLabel("参加日", { exact: true })).toHaveValue("1日目");
  213 |   const circle = add
  214 |     .getByRole("combobox", { name: "サークル名", exact: true })
  215 |     .or(add.getByRole("textbox", { name: "サークル名", exact: true }));
  216 |   await expect(circle).toHaveValue("");
  217 |   await circle.fill("未送信の入力");
  218 |   await day2.focus();
  219 |   await day2.press("Enter");
  220 |   await expect(add).toBeHidden();
  221 |   await expect(popup).toBeHidden();
  222 |   await expect(canvas).toHaveAttribute("data-priority-identity", "kept");
  223 |   await day1.focus();
  224 |   await day1.press("Enter");
  225 |   await expect(add).toBeHidden();
  226 |   await expect(popup).toBeHidden();
  227 |   expect(errors).toEqual([]);
  228 | });
  229 | 
```