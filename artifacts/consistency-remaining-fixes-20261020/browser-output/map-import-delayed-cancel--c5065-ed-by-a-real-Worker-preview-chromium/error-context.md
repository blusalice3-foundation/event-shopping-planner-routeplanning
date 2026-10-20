# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: map-import-delayed-cancel.spec.ts >> map import can resume after a pending import parser is replaced by a real Worker preview
- Location: tests\browser\map-import-delayed-cancel.spec.ts:425:1

# Error details

```
Error: expect(locator).toBeHidden() failed

Locator:  getByRole('dialog', { name: '📋 マップデータ取り込み', exact: true })
Expected: hidden
Received: visible
Timeout:  5000ms

Call log:
  - Expect "toBeHidden" with timeout 5000ms
  - waiting for getByRole('dialog', { name: '📋 マップデータ取り込み', exact: true })
    14 × locator resolved to <div role="dialog" tabindex="-1" aria-modal="true" aria-labelledby=":r2:" class="mx-4 flex max-h-[90vh] w-full max-w-[640px] flex-col rounded-lg bg-white shadow-xl dark:bg-slate-800">…</div>
       - unexpected value "visible"

```

```yaml
- dialog "📋 マップデータ取り込み":
  - heading "📋 マップデータ取り込み" [level=2]
  - button
  - group
  - button "キャンセル"
  - button "取り込み中..." [disabled]
```

# Test source

```ts
  396 |     await expect(
  397 |       next.getByRole("button", { name: "取り込む", exact: true }),
  398 |     ).toBeEnabled();
  399 |     await expect(preconfirmation).toBeHidden();
  400 |     await expect(impact).toBeHidden();
  401 |     const trace = await gateTrace(worker);
  402 |     expect(trace.gateReached).toBe(1);
  403 |     expect(trace.released).toBe(true);
  404 |     expect(trace.writes).toEqual([]);
  405 |     expect(trace.readwriteStarted).toBe(0);
  406 |     expect(trace.readwriteCompleted).toBe(0);
  407 |     expect(await allStores(page)).toEqual(durableBefore);
  408 |     expect(
  409 |       await page.evaluate(
  410 |         () =>
  411 |           (window as unknown as { __mapCancelMainTrace: { workers: number } })
  412 |             .__mapCancelMainTrace.workers,
  413 |       ),
  414 |     ).toBe(1);
  415 |     await testInfo.attach("real-worker-delayed-map-import-cancel", {
  416 |       body: Buffer.from(
  417 |         JSON.stringify({ route, workerUrl: worker.url(), trace }, null, 2),
  418 |         "utf8",
  419 |       ),
  420 |       contentType: "application/json",
  421 |     });
  422 |   });
  423 | }
  424 | 
  425 | test("map import can resume after a pending import parser is replaced by a real Worker preview", async ({
  426 |   page,
  427 | }, testInfo) => {
  428 |   const errors: string[] = [];
  429 |   const alerts: string[] = [];
  430 |   page.on("pageerror", (error) => errors.push(error.message));
  431 |   page.on("dialog", async (dialog) => {
  432 |     alerts.push(dialog.message());
  433 |     await dialog.accept();
  434 |   });
  435 |   await page.addInitScript(() => {
  436 |     const post = Worker.prototype.postMessage;
  437 |     let heldRequestId: unknown;
  438 |     const trace = {
  439 |       heldImport: false,
  440 |       cancelled: false,
  441 |       sent: [] as Array<{ type: string; kind?: string }>,
  442 |     };
  443 |     Object.assign(window, { __mapParserSwitch: trace });
  444 |     Worker.prototype.postMessage = function (
  445 |       ...args: Parameters<Worker["postMessage"]>
  446 |     ) {
  447 |       const message = args[0] as {
  448 |         type?: string;
  449 |         kind?: string;
  450 |         requestId?: unknown;
  451 |       };
  452 |       if (message?.type?.startsWith("XLSX_")) {
  453 |         trace.sent.push({ type: message.type, kind: message.kind });
  454 |         if (
  455 |           message.type === "XLSX_IMPORT_REQUEST" &&
  456 |           message.kind === "map-import" &&
  457 |           !trace.heldImport
  458 |         ) {
  459 |           trace.heldImport = true;
  460 |           heldRequestId = message.requestId;
  461 |           return;
  462 |         }
  463 |         if (
  464 |           message.type === "XLSX_CANCEL_REQUEST" &&
  465 |           message.requestId === heldRequestId
  466 |         )
  467 |           trace.cancelled = true;
  468 |       }
  469 |       return post.apply(this, args);
  470 |     };
  471 |   });
  472 |   await restore(page, false);
  473 |   const before = await allStores(page);
  474 |   const dialog = await selectMap(
  475 |     page,
  476 |     "parser-switch.xlsx",
  477 |     await workbook("プレビュー後に取り込む"),
  478 |   );
  479 |   await dialog.getByRole("button", { name: "取り込む", exact: true }).click();
  480 |   await page.waitForFunction(
  481 |     () =>
  482 |       (window as unknown as { __mapParserSwitch: { heldImport: boolean } })
  483 |         .__mapParserSwitch.heldImport,
  484 |   );
  485 |   await expect(
  486 |     dialog.getByRole("button", { name: "取り込み中...", exact: true }),
  487 |   ).toBeDisabled();
  488 |   await dialog
  489 |     .getByRole("button", { name: /プレビュー（ブロック検出）/ })
  490 |     .click();
  491 |   await expect(dialog.getByText(/✅ 1ブロック検出/)).toBeVisible();
  492 |   const retry = dialog.getByRole("button", { name: "取り込む", exact: true });
  493 |   await expect(retry).toBeEnabled();
  494 |   expect(await allStores(page)).toEqual(before);
  495 |   await retry.click();
> 496 |   await expect(dialog).toBeHidden();
      |                        ^ Error: expect(locator).toBeHidden() failed
  497 |   const after = await allStores(page);
  498 |   expect(after.mapData).not.toEqual(before.mapData);
  499 |   expect(after.eventLists).toEqual(before.eventLists);
  500 |   const trace = await page.evaluate(
  501 |     () =>
  502 |       (window as unknown as { __mapParserSwitch: unknown }).__mapParserSwitch,
  503 |   );
  504 |   expect(trace).toMatchObject({ heldImport: true, cancelled: true });
  505 |   await page.reload();
  506 |   const reloaded = await allStores(page);
  507 |   expect(reloaded.mapData).toEqual(after.mapData);
  508 |   expect(reloaded.eventLists).toEqual(before.eventLists);
  509 |   expect(errors).toEqual([]);
  510 |   expect(alerts).toEqual([]);
  511 |   await testInfo.attach("real-worker-parser-switch", {
  512 |     body: Buffer.from(
  513 |       JSON.stringify({
  514 |         trace,
  515 |         durablePreviewUnchanged: true,
  516 |         retryPersisted: true,
  517 |         errors,
  518 |         alerts,
  519 |       }),
  520 |       "utf8",
  521 |     ),
  522 |     contentType: "application/json",
  523 |   });
  524 | });
  525 | 
```