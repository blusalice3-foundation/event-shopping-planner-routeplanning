# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: priority-manual-item-consistency.spec.ts >> reopens an empty event from delete-last, preserves settings, adds a corrected manual item and reloads it
- Location: tests\browser\priority-manual-item-consistency.spec.ts:210:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: '確認して保存', exact: true })

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e7]:
      - heading "0件イベントの追加再開" [level=1] [ref=e8]
      - button "候補ブロックを番号で並べ替え" [ref=e9] [cursor=pointer]
      - button "ホール定義（ブロック割当）" [ref=e12] [cursor=pointer]
      - button "表示項目の設定" [ref=e16] [cursor=pointer]
      - generic [ref=e17]:
        - button "📝" [ref=e18] [cursor=pointer]
        - button "🏃‍♂️" [ref=e19] [cursor=pointer]
        - button "🔍" [ref=e20] [cursor=pointer]
    - generic [ref=e22]:
      - button "イベント一覧" [ref=e23] [cursor=pointer]
      - button "前夜祭1" [ref=e24] [cursor=pointer]
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
        - list "買い物リスト" [ref=e39]
      - generic [ref=e40]:
        - generic [ref=e41]:
          - heading "候補アイテム" [level=2] [ref=e42]
          - paragraph [ref=e43]: このリストから選択したアイテムを実行リストへ移動します。
        - list "買い物リスト" [ref=e44]:
          - listitem "追加後のサークル 再開した新刊" [ref=e46]:
            - generic [ref=e48]:
              - generic [ref=e49]:
                - checkbox "Select item 追加後のサークル - 再開した新刊" [ref=e50]
                - button "上に移動" [disabled] [ref=e51]
                - button "下に移動" [disabled] [ref=e61]
                - button "完全保護" [ref=e64] [cursor=pointer]: 🔐
              - generic [ref=e65]:
                - generic [ref=e66]:
                  - generic [ref=e67]: 前夜祭
                  - generic [ref=e68]: "-"
                  - button "追加後のサークル" [ref=e69] [cursor=pointer]
                - button "再開した新刊" [ref=e72] [cursor=pointer]
                - textbox "利用者メモ" [ref=e76]: 保持するメモ
              - generic [ref=e77]:
                - 'button "Current status: 未購入. Click to change." [ref=e78] [cursor=pointer]':
                  - generic [ref=e81]: 未購入
                - generic [ref=e82]:
                  - generic [ref=e83]: 数量
                  - combobox "購入予定数量" [ref=e84]:
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
                - generic [ref=e85]:
                  - generic [ref=e86]: 購入金額
                  - generic [ref=e87]: ¥
                  - combobox "購入金額" [ref=e88]:
                    - option "価格未定"
                    - option "0" [selected]
                    - option "100"
                    - option "200"
                    - option "300"
                    - option "400"
                    - option "500"
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
  - status "保存済み"
```

# Test source

```ts
  101 |       routeSettings: hasSettings
  102 |         ? {
  103 |             [eventName]: {
  104 |               [retainedMapName]: { isRouteVisible: true, visitOrder: [] },
  105 |             },
  106 |           }
  107 |         : {},
  108 |       hallDefinitions: hasSettings
  109 |         ? { [eventName]: { [retainedMapName]: [hall] } }
  110 |         : {},
  111 |       hallRouteSettings: hasSettings
  112 |         ? {
  113 |             [eventName]: {
  114 |               [retainedMapName]: {
  115 |                 hallOrder: [hall.id],
  116 |                 hallVisitLists: [{ hallId: hall.id, itemIds: [] }],
  117 |               },
  118 |             },
  119 |           }
  120 |         : {},
  121 |     },
  122 |   };
  123 | }
  124 | async function installWriteObserver(page: Page) {
  125 |   await page.addInitScript(() => {
  126 |     Object.assign(window, { __manualItemCommands: [] as string[] });
  127 |     const NativeWorker = window.Worker;
  128 |     window.Worker = class extends NativeWorker {
  129 |       constructor(url: string | URL, options?: WorkerOptions) {
  130 |         super(url, options);
  131 |         if (!String(url).includes("persistence.worker")) return;
  132 |         const send = this.postMessage.bind(this);
  133 |         this.postMessage = (message: { method?: string }) => {
  134 |           if (message.method)
  135 |             (
  136 |               window as unknown as { __manualItemCommands: string[] }
  137 |             ).__manualItemCommands.push(message.method);
  138 |           send(message);
  139 |         };
  140 |       }
  141 |     };
  142 |   });
  143 | }
  144 | async function physicalSettings(page: Page) {
  145 |   return page.evaluate(
  146 |     async (stores) => {
  147 |       const database = await new Promise<IDBDatabase>((resolve, reject) => {
  148 |         const request = indexedDB.open("EventShoppingPlannerDB");
  149 |         request.onsuccess = () => resolve(request.result);
  150 |         request.onerror = () => reject(request.error);
  151 |       });
  152 |       try {
  153 |         return Object.fromEntries(
  154 |           await Promise.all(
  155 |             stores.map(async (name) => [
  156 |               name,
  157 |               await new Promise<unknown[]>((resolve, reject) => {
  158 |                 const request = database
  159 |                   .transaction(name, "readonly")
  160 |                   .objectStore(name)
  161 |                   .getAll();
  162 |                 request.onsuccess = () => resolve(request.result);
  163 |                 request.onerror = () => reject(request.error);
  164 |               }),
  165 |             ]),
  166 |           ),
  167 |         );
  168 |       } finally {
  169 |         database.close();
  170 |       }
  171 |     },
  172 |     [...observedStores],
  173 |   );
  174 | }
  175 | async function downloadSnapshot(page: Page) {
  176 |   const downloaded = page.waitForEvent("download");
  177 |   await page
  178 |     .getByRole("button", { name: "JSONバックアップ保存", exact: true })
  179 |     .click();
  180 |   const file = await downloaded;
  181 |   return (
  182 |     JSON.parse(await readFile((await file.path())!, "utf8")) as {
  183 |       data: PersistenceSnapshot;
  184 |     }
  185 |   ).data;
  186 | }
  187 | async function acceptExistingSaveReview(page: Page) {
  188 |   const savedItem = page.getByText("追加後のサークル", { exact: true });
  189 |   const confirm = page.getByRole("button", {
  190 |     name: "確認して保存",
  191 |     exact: true,
  192 |   });
  193 |   for (let attempt = 0; attempt < 4; attempt++) {
  194 |     await expect
  195 |       .poll(
  196 |         async () =>
  197 |           (await savedItem.isVisible()) || (await confirm.isVisible()),
  198 |       )
  199 |       .toBe(true);
  200 |     if (await savedItem.isVisible()) return;
> 201 |     await confirm.click();
      |                   ^ Error: locator.click: Test timeout of 30000ms exceeded.
  202 |   }
  203 |   await expect(savedItem).toBeVisible();
  204 | }
  205 | for (const origin of [
  206 |   "empty-backup",
  207 |   "delete-last",
  208 |   "settings-only",
  209 | ] as const) {
  210 |   test(`reopens an empty event from ${origin}, preserves settings, adds a corrected manual item and reloads it`, async ({
  211 |     page,
  212 |   }) => {
  213 |     const errors: string[] = [];
  214 |     page.on("pageerror", (error) => errors.push(error.message));
  215 |     await installWriteObserver(page);
  216 |     await page.goto("/");
  217 |     await page
  218 |       .locator('input[aria-label="バックアップファイルを選択"]')
  219 |       .setInputFiles({
  220 |         name: `empty-event-${origin}.json`,
  221 |         mimeType: "application/json",
  222 |         buffer: Buffer.from(JSON.stringify(backup(origin)), "utf8"),
  223 |       });
  224 |     const restore = page.getByRole("dialog", {
  225 |       name: "バックアップからイベントを復元",
  226 |     });
  227 |     await restore.getByRole("radio", { name: /同名で置換/ }).check();
  228 |     await restore.getByRole("button", { name: "置換して復元" }).click();
  229 |     await expect(restore).toBeHidden();
  230 |     expect(
  231 |       page
  232 |         .workers()
  233 |         .some((worker) => worker.url().includes("persistence.worker")),
  234 |     ).toBe(true);
  235 |     if (origin === "delete-last") {
  236 |       const card = page
  237 |         .locator('[data-item-id="last-item"]')
  238 |         .locator(":scope > div.rounded-lg")
  239 |         .first();
  240 |       await expect(card).toBeVisible();
  241 |       await card.dispatchEvent("pointerdown", {
  242 |         button: 0,
  243 |         isPrimary: true,
  244 |         pointerType: "mouse",
  245 |       });
  246 |       await expect(
  247 |         page.getByRole("button", { name: "削除", exact: true }),
  248 |       ).toBeVisible();
  249 |       await card.dispatchEvent("pointerup", {
  250 |         button: 0,
  251 |         isPrimary: true,
  252 |         pointerType: "mouse",
  253 |       });
  254 |       await page.getByRole("button", { name: "削除", exact: true }).click();
  255 |       const deletion = page.getByRole("dialog", { name: "アイテムを削除" });
  256 |       await deletion.getByRole("button", { name: "Yes", exact: true }).click();
  257 |       await expect(deletion).toBeHidden();
  258 |       await expect(page.locator('[data-item-id="last-item"]')).toHaveCount(0);
  259 |       await page
  260 |         .getByRole("button", { name: "イベント一覧", exact: true })
  261 |         .click();
  262 |     }
  263 |     await expect(page.getByText(eventName, { exact: true })).toBeVisible();
  264 |     const before = await downloadSnapshot(page);
  265 |     expect(before.eventLists[eventName]).toEqual([]);
  266 |     if (origin === "settings-only") {
  267 |       expect(before.mapData[eventName][retainedMapName]).toBeDefined();
  268 |       expect(before.hallDefinitions[eventName][retainedMapName]).toHaveLength(
  269 |         1,
  270 |       );
  271 |       expect(
  272 |         before.routeSettings[eventName][retainedMapName].isRouteVisible,
  273 |       ).toBe(true);
  274 |       expect(before.dayModes[eventName]["2日目"]).toBe("edit");
  275 |     }
  276 |     const beforeSelection = await physicalSettings(page);
  277 |     await page.evaluate(() => {
  278 |       (
  279 |         window as unknown as { __manualItemCommands: string[] }
  280 |       ).__manualItemCommands = [];
  281 |     });
  282 |     await page.getByText(eventName, { exact: true }).click();
  283 |     await expect(
  284 |       page.getByRole("button", { name: "リストに追加", exact: true }),
  285 |     ).toBeVisible();
  286 |     expect(await physicalSettings(page)).toEqual(beforeSelection);
  287 |     await page
  288 |       .getByLabel("サークル名", { exact: true })
  289 |       .fill("追加後のサークル");
  290 |     await page.getByLabel("タイトル", { exact: true }).fill("再開した新刊");
  291 |     await page.getByLabel("備考", { exact: true }).fill("保持するメモ");
  292 |     await page.getByLabel("参加日", { exact: true }).selectOption("__custom__");
  293 |     await page.getByLabel("参加日", { exact: true }).fill("　 ");
  294 |     await page
  295 |       .getByRole("button", { name: "リストに追加", exact: true })
  296 |       .click();
  297 |     await expect(page.getByRole("alert")).toHaveText(
  298 |       "参加日を入力してください。",
  299 |     );
  300 |     await expect(page.getByLabel("参加日", { exact: true })).toBeFocused();
  301 |     await expect(page.getByLabel("タイトル", { exact: true })).toHaveValue(
```