# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: priority-dialog-interaction.spec.ts >> keyboard day changes discard popup input while retaining the map canvas
- Location: tests\browser\priority-dialog-interaction.spec.ts:180:1

# Error details

```
Error: expect(locator).toBeHidden() failed

Locator:  getByRole('dialog', { name: '新規アイテム追加', exact: true })
Expected: hidden
Received: visible
Timeout:  5000ms

Call log:
  - Expect "toBeHidden" with timeout 5000ms
  - waiting for getByRole('dialog', { name: '新規アイテム追加', exact: true })
    14 × locator resolved to <div role="dialog" tabindex="-1" aria-modal="true" aria-labelledby=":rb:-add-title" aria-describedby=":rb:-add-description" class="bg-white dark:bg-slate-800 rounded-lg shadow-2xl max-w-lg w-full mx-4 overflow-hidden max-h-[90vh] overflow-y-auto">…</div>
       - unexpected value "visible"

```

```yaml
- dialog "新規アイテム追加":
  - heading "新規アイテム追加" [level=2]
  - paragraph: 1日目 A-1
  - text: サークル名
  - combobox "サークル名": 未送信の入力
  - text: タイトル
  - textbox "タイトル":
    - /placeholder: 新刊セット
  - text: 参加日
  - textbox "参加日": 1日目
  - text: ブロック
  - textbox "ブロック": A
  - text: ナンバー
  - textbox "ナンバー":
    - /placeholder: 01a
  - text: 購入金額
  - textbox "購入金額":
    - /placeholder: "0"
  - text: 円 クイック選択
  - combobox "クイック選択"
  - text: 数量
  - combobox "数量"
  - text: 購入状態
  - combobox "購入状態"
  - text: 利用者メモ
  - textbox "利用者メモ":
    - /placeholder: スケブお願い
  - text: URL
  - textbox "URL":
    - /placeholder: https://example.com
  - button "キャンセル"
  - button "リストに追加"
```

# Test source

```ts
  122 |         .getByTitle("スマートフォンモードに切替", { exact: true })
  123 |         .click();
  124 |       await page.setViewportSize({ width: 390, height: 844 });
  125 |       await page
  126 |         .locator("div.fixed.inset-0.z-40")
  127 |         .first()
  128 |         .click({ position: { x: 2, y: 100 } });
  129 |     }
  130 |     await page.getByTitle("集中モード", { exact: true }).click();
  131 |     const origin = page
  132 |       .getByRole("button", { name: "全限数", exact: true })
  133 |       .first();
  134 |     await origin.click();
  135 |     const main = page.getByRole("dialog", {
  136 |       name: "限数購入の数量",
  137 |       exact: true,
  138 |     });
  139 |     const actual = main.getByRole("textbox", { name: "実購入数", exact: true });
  140 |     await expect(actual).toBeFocused();
  141 |     await swipe(page, '[aria-labelledby="limited-purchase-dialog-title"]');
  142 |     await expect(
  143 |       main.getByText("対象: 最初の入力", { exact: true }),
  144 |     ).toBeVisible();
  145 |     await actual.fill("5");
  146 |     await main.getByRole("button", { name: "保存", exact: true }).click();
  147 |     const confirm = page.getByRole("dialog", {
  148 |       name: "購入済として保存しますか？",
  149 |       exact: true,
  150 |     });
  151 |     await expect(confirm).toBeVisible();
  152 |     await confirm.press("Escape");
  153 |     await expect(confirm).toBeHidden();
  154 |     await expect(
  155 |       main.getByRole("button", { name: "保存", exact: true }),
  156 |     ).toBeFocused();
  157 |     await main.getByRole("button", { name: "保存", exact: true }).click();
  158 |     await confirm
  159 |       .getByRole("button", { name: "購入済にする", exact: true })
  160 |       .click();
  161 |     await expect(
  162 |       main.getByText("対象: 次の入力", { exact: true }),
  163 |     ).toBeVisible();
  164 |     await expect(actual).toBeFocused();
  165 |     await page.keyboard.press("Shift+Tab");
  166 |     await expect(
  167 |       main.getByRole("button", { name: "保存", exact: true }),
  168 |     ).toBeFocused();
  169 |     await page.keyboard.press("Tab");
  170 |     await expect(actual).toBeFocused();
  171 |     await page.keyboard.press("Escape");
  172 |     await expect(main).toBeHidden();
  173 |     await expect(origin).toBeFocused();
  174 |     await origin.click();
  175 |     await expect(actual).toBeFocused();
  176 |     await page.keyboard.press("Escape");
  177 |     expect(errors).toEqual([]);
  178 |   });
  179 | 
  180 | test("keyboard day changes discard popup input while retaining the map canvas", async ({
  181 |   page,
  182 | }) => {
  183 |   const errors: string[] = [];
  184 |   page.on("pageerror", (error) => errors.push(error.message));
  185 |   await restore(page);
  186 |   await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  187 |   const canvas = page.locator("canvas");
  188 |   await canvas.evaluate((element) => {
  189 |     element.dataset.priorityIdentity = "kept";
  190 |   });
  191 |   await canvas.click({ position: { x: 42, y: 42 } });
  192 |   const popup = page.getByRole("dialog", {
  193 |     name: "A-1のアイテム一覧",
  194 |     exact: true,
  195 |   });
  196 |   await expect(popup).toBeVisible();
  197 |   const day2 = page.getByRole("button", { name: /^2日目/ }).first();
  198 |   await day2.focus();
  199 |   await day2.press("Enter");
  200 |   await expect(popup).toBeHidden();
  201 |   await expect(canvas).toHaveAttribute("data-priority-identity", "kept");
  202 |   const day1 = page.getByRole("button", { name: /^1日目/ }).first();
  203 |   await day1.focus();
  204 |   await day1.press("Enter");
  205 |   await expect(popup).toBeHidden();
  206 |   await canvas.click({ position: { x: 42, y: 42 } });
  207 |   await popup
  208 |     .getByRole("button", { name: "新規アイテム追加", exact: true })
  209 |     .click();
  210 |   const add = page.getByRole("dialog", {
  211 |     name: "新規アイテム追加",
  212 |     exact: true,
  213 |   });
  214 |   await expect(add.getByLabel("参加日", { exact: true })).toHaveValue("1日目");
  215 |   const circle = add
  216 |     .getByRole("combobox", { name: "サークル名", exact: true })
  217 |     .or(add.getByRole("textbox", { name: "サークル名", exact: true }));
  218 |   await expect(circle).toHaveValue("");
  219 |   await circle.fill("未送信の入力");
  220 |   await day2.focus();
  221 |   await day2.press("Enter");
> 222 |   await expect(add).toBeHidden();
      |                     ^ Error: expect(locator).toBeHidden() failed
  223 |   await expect(popup).toBeHidden();
  224 |   await expect(canvas).toHaveAttribute("data-priority-identity", "kept");
  225 |   await day1.focus();
  226 |   await day1.press("Enter");
  227 |   await expect(add).toBeHidden();
  228 |   await expect(popup).toBeHidden();
  229 |   expect(errors).toEqual([]);
  230 | });
  231 | 
```