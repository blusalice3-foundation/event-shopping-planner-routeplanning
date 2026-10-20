# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: modal-layer-order.spec.ts >> OP05 late lower restore dialog keeps Tab and Enter in the visible save confirmation
- Location: tests\browser\modal-layer-order.spec.ts:86:1

# Error details

```
Error: expect(locator).toBeFocused() failed

Locator:  getByRole('dialog', { name: '所属・配置の変更を確認', exact: true }).getByRole('region', { name: '確認内容' })
Expected: focused
Received: inactive
Timeout:  5000ms

Call log:
  - Expect "toBeFocused" with timeout 5000ms
  - waiting for getByRole('dialog', { name: '所属・配置の変更を確認', exact: true }).getByRole('region', { name: '確認内容' })
    14 × locator resolved to <div tabindex="0" role="region" aria-label="確認内容" class="min-h-0 flex-1 overflow-y-auto">…</div>
       - unexpected value "inactive"

```

```yaml
- region "確認内容": "1日目 / 1日目マップ: 1 → 未割当 1日目 / 1日目マップ: 巡回順: 未割当（通常） 1日目 / 1日目マップ: 訪問リスト: 未割当（通常）: ユーザー登録・前面確認を保持（A-1）"
```

# Test source

```ts
  62  | }
  63  | 
  64  | async function storedMaps(page: Page) {
  65  |   return page.evaluate(async () => {
  66  |     const db = await new Promise<IDBDatabase>((resolve, reject) => {
  67  |       const request = indexedDB.open("EventShoppingPlannerDB");
  68  |       request.onsuccess = () => resolve(request.result);
  69  |       request.onerror = () => reject(request.error);
  70  |     });
  71  |     try {
  72  |       return await new Promise<unknown[]>((resolve, reject) => {
  73  |         const request = db
  74  |           .transaction("mapData", "readonly")
  75  |           .objectStore("mapData")
  76  |           .getAll();
  77  |         request.onsuccess = () => resolve(request.result);
  78  |         request.onerror = () => reject(request.error);
  79  |       });
  80  |     } finally {
  81  |       db.close();
  82  |     }
  83  |   });
  84  | }
  85  | 
  86  | test("OP05 late lower restore dialog keeps Tab and Enter in the visible save confirmation", async ({
  87  |   page,
  88  | }, testInfo) => {
  89  |   const errors: string[] = [];
  90  |   page.on("pageerror", (error) => errors.push(error.message));
  91  |   await page.addInitScript(() => {
  92  |     const original = File.prototype.text;
  93  |     const realm = window as unknown as BackupGate;
  94  |     realm.__lateBackupWaiting = false;
  95  |     File.prototype.text = async function () {
  96  |       if (this.name !== "late-restore.json") return original.call(this);
  97  |       const file = this;
  98  |       return new Promise<string>((resolve, reject) => {
  99  |         realm.__lateBackupWaiting = true;
  100 |         realm.__releaseLateBackup = async () => {
  101 |           try {
  102 |             resolve(await original.call(file));
  103 |           } catch (error) {
  104 |             reject(error);
  105 |           }
  106 |         };
  107 |       });
  108 |     };
  109 |   });
  110 |   await page.goto("/");
  111 |   const input = page.getByLabel("バックアップファイルを選択");
  112 |   const contents = Buffer.from(JSON.stringify(backup()), "utf8");
  113 |   await input.setInputFiles({
  114 |     name: "initial-map.json",
  115 |     mimeType: "application/json",
  116 |     buffer: contents,
  117 |   });
  118 |   const restore = page.getByRole("dialog", {
  119 |     name: "バックアップからイベントを復元",
  120 |     exact: true,
  121 |   });
  122 |   await restore.getByRole("radio", { name: /同名で置換/ }).check();
  123 |   await restore
  124 |     .getByRole("button", { name: "置換して復元", exact: true })
  125 |     .click();
  126 |   await expect(restore).toBeHidden();
  127 |   await expect(
  128 |     page.getByRole("heading", { name: eventName, exact: true }),
  129 |   ).toBeVisible();
  130 |   const before = await storedMaps(page);
  131 |   await input.setInputFiles({
  132 |     name: "late-restore.json",
  133 |     mimeType: "application/json",
  134 |     buffer: contents,
  135 |   });
  136 |   await page.waitForFunction(
  137 |     () => (window as unknown as BackupGate).__lateBackupWaiting,
  138 |   );
  139 |   await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  140 |   await page.getByTitle("リスト表示に切り替え", { exact: true }).hover();
  141 |   await page.mouse.down();
  142 |   await expect(
  143 |     page.getByRole("button", { name: "🔲 ブロック定義", exact: true }),
  144 |   ).toBeVisible();
  145 |   await page.mouse.up();
  146 |   await page
  147 |     .getByRole("button", { name: "🔲 ブロック定義", exact: true })
  148 |     .click();
  149 |   await page.getByRole("button", { name: /A.*1セル/ }).click();
  150 |   await page.getByPlaceholder("例: ア, め, N").fill("B");
  151 |   await page.getByRole("button", { name: "保存", exact: true }).click();
  152 |   await page.getByRole("button", { name: "適用", exact: true }).click();
  153 |   const front = page.getByRole("dialog", {
  154 |     name: "所属・配置の変更を確認",
  155 |     exact: true,
  156 |   });
  157 |   await expect(front).toBeVisible();
  158 |   await page.evaluate(() =>
  159 |     (window as unknown as BackupGate).__releaseLateBackup(),
  160 |   );
  161 |   await expect(restore).toBeVisible();
> 162 |   await expect(front.getByRole("region", { name: "確認内容" })).toBeFocused();
      |                                                             ^ Error: expect(locator).toBeFocused() failed
  163 |   await page.keyboard.press("Enter");
  164 |   const observations = [];
  165 |   for (const key of [
  166 |     ...Array<string>(8).fill("Tab"),
  167 |     ...Array<string>(8).fill("Shift+Tab"),
  168 |   ]) {
  169 |     await page.keyboard.press(key);
  170 |     const observation = await front.evaluate((element) => {
  171 |       const active = document.activeElement;
  172 |       const rect = active?.getBoundingClientRect();
  173 |       const hit =
  174 |         rect &&
  175 |         document.elementFromPoint(
  176 |           rect.left + rect.width / 2,
  177 |           rect.top + rect.height / 2,
  178 |         );
  179 |       return {
  180 |         focusInside: element.contains(active),
  181 |         hitInside: element.contains(hit ?? null),
  182 |       };
  183 |     });
  184 |     observations.push(observation);
  185 |     expect(observation).toEqual({ focusInside: true, hitInside: true });
  186 |   }
  187 |   expect(await storedMaps(page)).toEqual(before);
  188 |   await page.keyboard.press("Escape");
  189 |   await expect(front).toBeHidden();
  190 |   await expect
  191 |     .poll(() =>
  192 |       restore.evaluate((element) => element.contains(document.activeElement)),
  193 |     )
  194 |     .toBe(true);
  195 |   await page.keyboard.press("Escape");
  196 |   await expect(restore).toBeHidden();
  197 |   expect(await storedMaps(page)).toEqual(before);
  198 |   await page.reload();
  199 |   expect(await storedMaps(page)).toEqual(before);
  200 |   expect(errors).toEqual([]);
  201 |   await testInfo.attach("modal-layer-keyboard-observations", {
  202 |     body: Buffer.from(
  203 |       JSON.stringify({ observations, durableUnchanged: true, errors }),
  204 |       "utf8",
  205 |     ),
  206 |     contentType: "application/json",
  207 |   });
  208 | });
  209 | 
```