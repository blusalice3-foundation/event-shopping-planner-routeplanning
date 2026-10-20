# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: map-import-delayed-cancel.spec.ts >> map import can resume after a pending import parser is replaced by a real Worker preview
- Location: tests\browser\map-import-delayed-cancel.spec.ts:425:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "1件のマップを取り込みました。",
+ ]
```

# Page snapshot

```yaml
- main [ref=f1e3]:
  - paragraph [ref=f1e4]: 保存データを確認しています…
```

# Test source

```ts
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
  496 |   const impact = page.getByRole("dialog", {
  497 |     name: "マップ再取り込みの影響を確認",
  498 |     exact: true,
  499 |   });
  500 |   await expect(impact).toBeVisible();
  501 |   expect(await allStores(page)).toEqual(before);
  502 |   await impact
  503 |     .getByRole("button", { name: "確認して保存", exact: true })
  504 |     .click();
  505 |   await expect(dialog).toBeHidden();
  506 |   const after = await allStores(page);
  507 |   expect(after.mapData).not.toEqual(before.mapData);
  508 |   expect(after.eventLists).toEqual(before.eventLists);
  509 |   const trace = await page.evaluate(
  510 |     () =>
  511 |       (window as unknown as { __mapParserSwitch: unknown }).__mapParserSwitch,
  512 |   );
  513 |   expect(trace).toMatchObject({ heldImport: true, cancelled: true });
  514 |   await page.reload();
  515 |   const reloaded = await allStores(page);
  516 |   expect(reloaded.mapData).toEqual(after.mapData);
  517 |   expect(reloaded.eventLists).toEqual(before.eventLists);
  518 |   expect(errors).toEqual([]);
> 519 |   expect(alerts).toEqual([]);
      |                  ^ Error: expect(received).toEqual(expected) // deep equality
  520 |   await testInfo.attach("real-worker-parser-switch", {
  521 |     body: Buffer.from(
  522 |       JSON.stringify({
  523 |         trace,
  524 |         durablePreviewUnchanged: true,
  525 |         retryPersisted: true,
  526 |         errors,
  527 |         alerts,
  528 |       }),
  529 |       "utf8",
  530 |     ),
  531 |     contentType: "application/json",
  532 |   });
  533 | });
  534 | 
```