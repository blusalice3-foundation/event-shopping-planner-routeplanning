# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: priority-manual-item-consistency.spec.ts >> reopens an empty event from settings-only, preserves settings, adds a corrected manual item and reloads it
- Location: tests\browser\priority-manual-item-consistency.spec.ts:210:3

# Error details

```
TypeError: Cannot read properties of undefined (reading '2日目マップ')
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e7]:
      - heading "即売会購入巡回表" [level=1] [ref=e8]
      - button "表示項目の設定" [ref=e10] [cursor=pointer]
    - generic [ref=e12]:
      - button "イベント一覧" [ref=e13] [cursor=pointer]
      - button "新規リスト作成" [ref=e14] [cursor=pointer]
  - main [ref=e15]:
    - generic [ref=e16]:
      - generic [ref=e17]:
        - heading "保存済みの即売会リスト" [level=2] [ref=e18]
        - generic [ref=e19]:
          - button "Excel取り込み" [ref=e20] [cursor=pointer]
          - button "JSONバックアップ保存" [active] [ref=e23] [cursor=pointer]
          - button "JSONバックアップ復元" [ref=e26] [cursor=pointer]
      - list [ref=e30]:
        - listitem [ref=e31]:
          - generic [ref=e32]:
            - generic [ref=e33] [cursor=pointer]: 0件イベントの追加再開
            - button "メニュー" [ref=e34] [cursor=pointer]
  - status "保存済み"
```

# Test source

```ts
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
  201 |     await confirm.click();
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
> 272 |         before.routeSettings[eventName][retainedMapName].isRouteVisible,
      |                                        ^ TypeError: Cannot read properties of undefined (reading '2日目マップ')
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
  302 |       "再開した新刊",
  303 |     );
  304 |     await expect(page.getByLabel("備考", { exact: true })).toHaveValue(
  305 |       "保持するメモ",
  306 |     );
  307 |     const methods = await page.evaluate(
  308 |       () =>
  309 |         (window as unknown as { __manualItemCommands: string[] })
  310 |           .__manualItemCommands,
  311 |     );
  312 |     expect(
  313 |       methods.filter((method) =>
  314 |         [
  315 |           "commit",
  316 |           "commitDay",
  317 |           "day",
  318 |           "items",
  319 |           "saveEventLists",
  320 |           "saveExecuteModeItems",
  321 |         ].includes(method),
  322 |       ),
  323 |     ).toEqual([]);
  324 |     expect(await physicalSettings(page)).toEqual(beforeSelection);
  325 |     await page.getByLabel("参加日", { exact: true }).fill("前夜祭");
  326 |     await page
  327 |       .getByRole("button", { name: "リストに追加", exact: true })
  328 |       .click();
  329 |     await acceptExistingSaveReview(page);
  330 |     await expect(
  331 |       page.getByText("追加後のサークル", { exact: true }),
  332 |     ).toBeVisible();
  333 |     await page
  334 |       .getByRole("button", { name: "イベント一覧", exact: true })
  335 |       .click();
  336 |     const after = await downloadSnapshot(page);
  337 |     const saved = after.eventLists[eventName] as ShoppingItem[];
  338 |     expect(saved).toHaveLength(1);
  339 |     expect(saved[0]).toMatchObject({
  340 |       eventDate: "前夜祭",
  341 |       circle: "追加後のサークル",
  342 |       remarks: "保持するメモ",
  343 |     });
  344 |     for (const store of observedStores.filter(
  345 |       (store) => store !== "eventConsistency",
  346 |     )) {
  347 |       const beforeEvent =
  348 |         (before[store] as Record<string, Record<string, unknown>>)[eventName] ??
  349 |         {};
  350 |       const afterEvent =
  351 |         (after[store] as Record<string, Record<string, unknown>>)[eventName] ??
  352 |         {};
  353 |       for (const [key, value] of Object.entries(beforeEvent))
  354 |         expect(afterEvent[key], `${store}.${key}`).toEqual(value);
  355 |     }
  356 |     for (const [day, value] of Object.entries(
  357 |       before.eventConsistency[eventName]?.days ?? {},
  358 |     )) {
  359 |       expect(
  360 |         after.eventConsistency[eventName].days[day],
  361 |         `retained consistency ${day}`,
  362 |       ).toEqual(value);
  363 |     }
  364 |     await page.reload();
  365 |     await page.getByText(eventName, { exact: true }).click();
  366 |     await expect(page.getByRole("button", { name: /^前夜祭/ })).toBeVisible();
  367 |     await expect(page.locator(`[data-item-id="${saved[0].id}"]`)).toBeVisible();
  368 |     await expect(
  369 |       page.getByText("追加後のサークル", { exact: true }),
  370 |     ).toBeVisible();
  371 |     await expect(
  372 |       page.getByRole("textbox", { name: "利用者メモ", exact: true }),
```