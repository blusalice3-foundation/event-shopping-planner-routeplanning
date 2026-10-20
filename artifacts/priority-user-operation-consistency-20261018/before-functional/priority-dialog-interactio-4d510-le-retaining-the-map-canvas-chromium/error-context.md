# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: priority-dialog-interaction.spec.ts >> keyboard day changes discard popup input while retaining the map canvas
- Location: tests\browser\priority-dialog-interaction.spec.ts:178:1

# Error details

```
Error: expect(locator).toBeHidden() failed

Locator:  getByRole('dialog', { name: 'A-1のアイテム一覧', exact: true })
Expected: hidden
Received: visible
Timeout:  5000ms

Call log:
  - Expect "toBeHidden" with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'A-1のアイテム一覧', exact: true })
    14 × locator resolved to <div role="dialog" aria-label="A-1のアイテム一覧" class="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl transition-all duration-150 dark:border-slate-700 dark:bg-slate-800">…</div>
       - unexpected value "visible"

```

```yaml
- dialog "A-1のアイテム一覧":
  - heading "A-1 （2件）" [level=2]
  - button "1 ○"
  - button "A-1のアイテム一覧を閉じる"
  - button "新規アイテム追加"
  - text: first
  - paragraph: 最初の入力
  - paragraph: "購入金額: ¥500"
  - paragraph: "利用者メモ: ユーザー登録"
  - text: タップで追加
  - paragraph: 長押しで編集・削除
  - text: second
  - paragraph: 次の入力
  - paragraph: "購入金額: ¥500"
  - paragraph: "利用者メモ: ユーザー登録"
  - text: タップで追加
  - paragraph: 長押しで編集・削除
```

# Test source

```ts
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
  132 |     await origin.click();
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
> 198 |   await expect(popup).toBeHidden();
      |                       ^ Error: expect(locator).toBeHidden() failed
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