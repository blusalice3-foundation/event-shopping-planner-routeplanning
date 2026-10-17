# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sheet-import-optional-url.measurement.spec.ts >> sheet optional URL real-browser route measurements >> update: 150 direct @sheet-url-routes
- Location: tests\browser\sheet-import-optional-url.measurement.spec.ts:253:9

# Error details

```
TypeError: parseCsvRecords(...).map is not a function
```

# Test source

```ts
  222 |         this.transaction.objectStoreNames.contains("eventConsistency")
  223 |       ) {
  224 |         IDBObjectStore.prototype.put = original;
  225 |         throw new DOMException("measurement abort", "AbortError");
  226 |       }
  227 |       return original.apply(this, args);
  228 |     };
  229 |   };
  230 |   if (mode === "worker") {
  231 |     const worker = page
  232 |       .workers()
  233 |       .find((worker) => worker.url().includes("persistence.worker"));
  234 |     if (!worker) throw new Error("Missing production persistence worker");
  235 |     await worker.evaluate(inject);
  236 |   } else await page.evaluate(inject);
  237 | }
  238 | 
  239 | test.describe("sheet optional URL real-browser route measurements", () => {
  240 |   test.skip(!phase, "Opt in with SHEET_URL_BROWSER_PHASE=before or after");
  241 |   for (const count of [150, 500])
  242 |     for (const mode of ["direct", "worker"])
  243 |       for (const route of [
  244 |         "import",
  245 |         "update",
  246 |         "switch",
  247 |         "restore-json",
  248 |         "restore-xlsx",
  249 |         "startup-B01",
  250 |         "startup-B04",
  251 |         "retry",
  252 |       ] as const) {
  253 |         test(`${route}: ${count} ${mode} @sheet-url-routes`, async ({
  254 |           browser,
  255 |         }, testInfo) => {
  256 |           test.setTimeout(240000);
  257 |           const samples: Array<Record<string, unknown>> = [];
  258 |           for (let iteration = 0; iteration < repeats; iteration++) {
  259 |             const context: BrowserContext = await browser.newContext({
  260 |               viewport: { width: 1280, height: 720 },
  261 |               serviceWorkers: "block",
  262 |             });
  263 |             if (mode === "direct")
  264 |               await context.addInitScript(() => {
  265 |                 const state = window as unknown as {
  266 |                   Worker: typeof Worker | undefined;
  267 |                   __sheetOriginalWorker?: typeof Worker;
  268 |                 };
  269 |                 state.__sheetOriginalWorker = state.Worker;
  270 |                 state.Worker = undefined;
  271 |               });
  272 |             const page = await context.newPage();
  273 |             page.on("dialog", (dialog) => dialog.accept());
  274 |             try {
  275 |               await enter(page);
  276 |               let detail: Record<string, unknown>;
  277 |               if (route === "import") {
  278 |                 await page.route("**/api/google-sheets-csv", (request) =>
  279 |                   request.fulfill({
  280 |                     status: 200,
  281 |                     contentType: "text/csv; charset=utf-8",
  282 |                     body: sheetCsv(count),
  283 |                   }),
  284 |                 );
  285 |                 await page
  286 |                   .getByRole("button", { name: "新規リスト作成", exact: true })
  287 |                   .click();
  288 |                 await page
  289 |                   .getByLabel("即売会名", { exact: true })
  290 |                   .fill(SHEET_EVENT);
  291 |                 await page
  292 |                   .getByLabel("スプレッドシートURLからインポート", {
  293 |                     exact: true,
  294 |                   })
  295 |                   .fill("https://docs.google.com/spreadsheets/d/test/edit");
  296 |                 const start = performance.now();
  297 |                 await page
  298 |                   .getByRole("button", {
  299 |                     name: "URLからインポート",
  300 |                     exact: true,
  301 |                   })
  302 |                   .click();
  303 |                 const review = page.getByRole("dialog", {
  304 |                   name: "所属・配置の変更を確認",
  305 |                   exact: true,
  306 |                 });
  307 |                 await expect(review).toBeVisible();
  308 |                 const reviewMs = performance.now() - start;
  309 |                 const commitStart = performance.now();
  310 |                 await review
  311 |                   .getByRole("button", { name: "確認して保存", exact: true })
  312 |                   .click();
  313 |                 await expect(review).toBeHidden();
  314 |                 await expect(
  315 |                   page.getByRole("heading", { name: SHEET_EVENT, exact: true }),
  316 |                 ).toBeVisible();
  317 |                 const saveMs = performance.now() - commitStart;
  318 |                 detail = { reviewMs, saveMs, durationMs: reviewMs + saveMs };
  319 |               } else if (route === "update" || route === "switch") {
  320 |                 await restore(page, count, route === "update", undefined, true);
  321 |                 const csv = parseCsvRecords(sheetCsv(count))
> 322 |                   .map((record, index) => {
      |                    ^ TypeError: parseCsvRecords(...).map is not a function
  323 |                     const cells = [...record.cells];
  324 |                     if (index > 0) cells[24] = "https://baseline.test";
  325 |                     return cells
  326 |                       .map((cell) => `"${cell.replace(/"/g, '""')}"`)
  327 |                       .join(",");
  328 |                   })
  329 |                   .join("\n")
  330 |                   .replace(/"500"/g, '"501"');
  331 |                 await page.route("**/api/google-sheets-csv", (request) =>
  332 |                   request.fulfill({
  333 |                     status: 200,
  334 |                     contentType: "text/csv; charset=utf-8",
  335 |                     body: csv,
  336 |                   }),
  337 |                 );
  338 |                 await page
  339 |                   .getByRole("button", { name: "イベント一覧", exact: true })
  340 |                   .click();
  341 |                 await page
  342 |                   .getByRole("button", { name: "メニュー", exact: true })
  343 |                   .click();
  344 |                 let start = performance.now();
  345 |                 await page
  346 |                   .getByRole("button", { name: "🔄 アイテム更新", exact: true })
  347 |                   .click();
  348 |                 if (route === "switch") {
  349 |                   await page
  350 |                     .getByRole("textbox", {
  351 |                       name: "スプレッドシートURL",
  352 |                       exact: true,
  353 |                     })
  354 |                     .fill("https://docs.google.com/spreadsheets/d/new/edit");
  355 |                   start = performance.now();
  356 |                   await page
  357 |                     .getByRole("button", { name: "更新", exact: true })
  358 |                     .click();
  359 |                 }
  360 |                 const heading = page.getByRole("heading", {
  361 |                   name: "アイテム更新の確認",
  362 |                   exact: true,
  363 |                 });
  364 |                 await expect(heading).toBeVisible();
  365 |                 const reviewMs = performance.now() - start;
  366 |                 const commitStart = performance.now();
  367 |                 await page
  368 |                   .getByRole("button", {
  369 |                     name:
  370 |                       route === "switch"
  371 |                         ? "更新元を切り替えて更新"
  372 |                         : "更新を実行",
  373 |                     exact: true,
  374 |                   })
  375 |                   .click();
  376 |                 await expect(heading).toBeHidden();
  377 |                 detail = { reviewMs, saveMs: performance.now() - commitStart };
  378 |                 expect(
  379 |                   (
  380 |                     (await stored(page, "eventLists")) as Record<
  381 |                       string,
  382 |                       Array<{ catalogPrice: number }>
  383 |                     >
  384 |                   )[SHEET_EVENT][0].catalogPrice,
  385 |                 ).toBe(501);
  386 |               } else if (route.startsWith("restore")) {
  387 |                 const bytes =
  388 |                   route === "restore-xlsx"
  389 |                     ? await readFile(
  390 |                         join(
  391 |                           fixedInputs!,
  392 |                           `restore-${count}-${mode}-blank=true.xlsx`,
  393 |                         ),
  394 |                       )
  395 |                     : undefined;
  396 |                 detail = await restore(page, count, false, bytes);
  397 |               } else if (route.startsWith("startup")) {
  398 |                 await restore(page, count, false);
  399 |                 if (route === "startup-B04") await legacyUrls(page);
  400 |                 const start = performance.now();
  401 |                 await page.reload();
  402 |                 await expect(
  403 |                   page.getByRole("listitem").filter({ hasText: SHEET_EVENT }),
  404 |                 ).toBeVisible();
  405 |                 detail = { durationMs: performance.now() - start };
  406 |                 if (phase === "after")
  407 |                   expect(
  408 |                     (
  409 |                       (await stored(page, "eventLists")) as Record<
  410 |                         string,
  411 |                         object[]
  412 |                       >
  413 |                     )[SHEET_EVENT].every(
  414 |                       (item) =>
  415 |                         !Object.prototype.hasOwnProperty.call(item, "url"),
  416 |                     ),
  417 |                   ).toBe(true);
  418 |               } else {
  419 |                 await restore(page, count, false, undefined, true);
  420 |                 const editor = await openEditor(page);
  421 |                 await editor
  422 |                   .getByRole("textbox", { name: "購入金額", exact: true })
```