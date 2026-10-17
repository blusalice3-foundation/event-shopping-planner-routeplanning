# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sheet-import-optional-url.measurement.spec.ts >> sheet optional URL real-browser route measurements >> startup-B03: 500 direct @sheet-url-routes
- Location: tests\browser\sheet-import-optional-url.measurement.spec.ts:613:9

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: '新規リスト作成', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('button', { name: '新規リスト作成', exact: true })

```

```yaml
- paragraph: 読み込み中...
```

# Test source

```ts
  183 |     childList: true,
  184 |     subtree: true,
  185 |   });
  186 | }
  187 | async function resetProbe(page: Page) {
  188 |   const reset = () => {
  189 |     const probe = (globalThis as unknown as { __sheetUrlProbe?: BrowserProbe })
  190 |       .__sheetUrlProbe;
  191 |     if (probe) {
  192 |       probe.transactions = [];
  193 |       probe.marks = {};
  194 |       probe.abortNextAtomic = false;
  195 |     }
  196 |   };
  197 |   await page.evaluate(reset);
  198 |   for (const worker of page.workers())
  199 |     if (worker.url().includes("persistence.worker"))
  200 |       await worker.evaluate(reset);
  201 | }
  202 | async function collectProbe(page: Page) {
  203 |   // Frame observation completes outside the Playwright wall-time intervals.
  204 |   await page.evaluate(
  205 |     () =>
  206 |       new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  207 |   );
  208 |   const navigationTimeOrigin = await page.evaluate(
  209 |     () => performance.timeOrigin,
  210 |   );
  211 |   const read = () =>
  212 |     (globalThis as unknown as { __sheetUrlProbe?: BrowserProbe })
  213 |       .__sheetUrlProbe;
  214 |   const main = await page.evaluate(read);
  215 |   const workers = [];
  216 |   for (const worker of page.workers())
  217 |     if (worker.url().includes("persistence.worker"))
  218 |       workers.push(await worker.evaluate(read));
  219 |   const transactions = [main, ...workers].flatMap(
  220 |     (entry) => entry?.transactions ?? [],
  221 |   );
  222 |   const marks = main?.marks ?? {};
  223 |   return {
  224 |     transactions,
  225 |     verifiedSnapshotReadSpans: transactions.filter(
  226 |       (entry) =>
  227 |         entry.mode === "readonly" &&
  228 |         entry.stores.includes("eventLists") &&
  229 |         entry.stores.includes("eventConsistency") &&
  230 |         entry.stores.includes("mapData"),
  231 |     ),
  232 |     startupScreenDomMs: marks.startupScreenDomAt
  233 |       ? marks.startupScreenDomAt - navigationTimeOrigin
  234 |       : null,
  235 |     marks,
  236 |     csvTextToReviewDomMs:
  237 |       marks.csvTextReadyAt && marks.reviewDomAt
  238 |         ? marks.reviewDomAt - marks.csvTextReadyAt
  239 |         : null,
  240 |     csvTextToReviewFrameMs:
  241 |       marks.csvTextReadyAt && marks.reviewFrameAt
  242 |         ? marks.reviewFrameAt - marks.csvTextReadyAt
  243 |         : null,
  244 |     confirmationToScreenDomMs:
  245 |       marks.confirmationClickedAt && marks.screenDomAt
  246 |         ? marks.screenDomAt - marks.confirmationClickedAt
  247 |         : null,
  248 |     confirmationToScreenFrameMs:
  249 |       marks.confirmationClickedAt && marks.screenFrameAt
  250 |         ? marks.screenFrameAt - marks.confirmationClickedAt
  251 |         : null,
  252 |   };
  253 | }
  254 | async function stored(
  255 |   page: Page,
  256 |   name: string,
  257 |   key = "data",
  258 | ): Promise<unknown> {
  259 |   return page.evaluate(
  260 |     async ({ name, key }) => {
  261 |       const database = await new Promise<IDBDatabase>((resolve, reject) => {
  262 |         const request = indexedDB.open("EventShoppingPlannerDB");
  263 |         request.onsuccess = () => resolve(request.result);
  264 |         request.onerror = () => reject(request.error);
  265 |       });
  266 |       try {
  267 |         return await new Promise<unknown>((resolve, reject) => {
  268 |           const request = database.transaction(name).objectStore(name).get(key);
  269 |           request.onsuccess = () => resolve(request.result);
  270 |           request.onerror = () => reject(request.error);
  271 |         });
  272 |       } finally {
  273 |         database.close();
  274 |       }
  275 |     },
  276 |     { name, key },
  277 |   );
  278 | }
  279 | async function enter(page: Page) {
  280 |   await page.goto(baseURL);
  281 |   await expect(
  282 |     page.getByRole("button", { name: "新規リスト作成", exact: true }),
> 283 |   ).toBeVisible();
      |     ^ Error: expect(locator).toBeVisible() failed
  284 |   // Persistence selected its direct adapter at composition time. Other workers
  285 |   // remain available for the production XLSX and JSON codecs.
  286 |   await page.evaluate(() => {
  287 |     const state = window as unknown as {
  288 |       Worker: typeof Worker;
  289 |       __sheetOriginalWorker?: typeof Worker;
  290 |     };
  291 |     if (state.__sheetOriginalWorker) state.Worker = state.__sheetOriginalWorker;
  292 |   });
  293 | }
  294 | async function restore(
  295 |   page: Page,
  296 |   count: number,
  297 |   source: boolean,
  298 |   bytes?: Buffer,
  299 |   withUrl = false,
  300 | ) {
  301 |   const data = sheetSnapshot(count);
  302 |   if (withUrl)
  303 |     for (const item of data.eventLists[SHEET_EVENT])
  304 |       item.url = "https://baseline.test";
  305 |   if (source)
  306 |     data.eventMetadata[SHEET_EVENT] = {
  307 |       spreadsheetUrl: "https://docs.google.com/spreadsheets/d/original/edit",
  308 |       spreadsheetSheetName: "品目表",
  309 |       lastImportDate: "",
  310 |     };
  311 |   const input = bytes
  312 |     ? page.getByLabel("Excelファイルを選択")
  313 |     : page.getByLabel("バックアップファイルを選択");
  314 |   const start = performance.now();
  315 |   await input.setInputFiles({
  316 |     name: bytes ? "fixture.xlsx" : "fixture.json",
  317 |     mimeType: bytes
  318 |       ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  319 |       : "application/json",
  320 |     buffer:
  321 |       bytes ??
  322 |       Buffer.from(
  323 |         JSON.stringify({
  324 |           kind: "event-shopping-planner-backup",
  325 |           version: 2,
  326 |           exportedAt: "2026-10-17T00:00:00.000Z",
  327 |           data,
  328 |         }),
  329 |       ),
  330 |   });
  331 |   const dialog = page.getByRole("dialog", {
  332 |     name: "バックアップからイベントを復元",
  333 |   });
  334 |   await expect(dialog).toBeVisible();
  335 |   const parseMs = performance.now() - start;
  336 |   await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  337 |   const commitStart = performance.now();
  338 |   await dialog
  339 |     .getByRole("button", { name: "置換して復元", exact: true })
  340 |     .click();
  341 |   const review = page.getByRole("dialog", {
  342 |     name: `「${SHEET_EVENT}」の復元内容を確認`,
  343 |     exact: true,
  344 |   });
  345 |   await expect
  346 |     .poll(
  347 |       async () =>
  348 |         (await review.isVisible()) ||
  349 |         (await page
  350 |           .getByRole("heading", { name: SHEET_EVENT, exact: true })
  351 |           .isVisible()),
  352 |     )
  353 |     .toBe(true);
  354 |   if (await review.isVisible())
  355 |     await review
  356 |       .getByRole("button", { name: "確認して保存", exact: true })
  357 |       .click();
  358 |   await expect(dialog).toBeHidden();
  359 |   await expect(
  360 |     page.getByRole("heading", { name: SHEET_EVENT, exact: true }),
  361 |   ).toBeVisible();
  362 |   return { parseMs, saveMs: performance.now() - commitStart };
  363 | }
  364 | async function seedStartup(
  365 |   page: Page,
  366 |   unprepared: boolean,
  367 |   legacyUrl: boolean,
  368 | ) {
  369 |   const lists = (await stored(page, "eventLists")) as Record<string, object[]>;
  370 |   const next = legacyUrl
  371 |     ? {
  372 |         ...lists,
  373 |         [SHEET_EVENT]: lists[SHEET_EVENT].map((item) => ({ ...item, url: "" })),
  374 |       }
  375 |     : lists;
  376 |   const metadataKey = createPersistenceMetadataKey("eventLists", "data");
  377 |   const checkpointKey = createPersistenceCheckpointKey("eventLists", "data");
  378 |   const previous = (await stored(
  379 |     page,
  380 |     "syncQueue",
  381 |     metadataKey,
  382 |   )) as StoredPersistenceMetadata;
  383 |   const previousCheckpoint = (await stored(
```