# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: priority-dialog-interaction.spec.ts >> bulk limited input contains touch and keyboard across confirmations and the next item: pc
- Location: tests\browser\priority-dialog-interaction.spec.ts:113:3

# Error details

```
Error: expect(locator).toBeFocused() failed

Locator:  getByRole('dialog', { name: '限数購入の数量', exact: true }).getByRole('textbox', { name: '実購入数', exact: true })
Expected: focused
Received: inactive
Timeout:  5000ms

Call log:
  - Expect "toBeFocused" with timeout 5000ms
  - waiting for getByRole('dialog', { name: '限数購入の数量', exact: true }).getByRole('textbox', { name: '実購入数', exact: true })
    14 × locator resolved to <input value="" inputmode="numeric" class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"/>
       - unexpected value "inactive"

```

```yaml
- textbox "実購入数"
```

# Test source

```ts
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
  131 |     const origin = page
  132 |       .getByRole("button", { name: "全限数", exact: true })
  133 |       .first();
  134 |     await origin.click();
  135 |     const main = page.getByRole("dialog", {
  136 |       name: "限数購入の数量",
  137 |       exact: true,
  138 |     });
  139 |     const actual = main.getByRole("textbox", { name: "実購入数", exact: true });
> 140 |     await expect(actual).toBeFocused();
      |                          ^ Error: expect(locator).toBeFocused() failed
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
  222 |   await expect(add).toBeHidden();
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