# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sheet-import-optional-url.measurement.spec.ts >> sheet optional URL real-browser route measurements >> startup-B02: 150 direct @sheet-url-routes
- Location: tests\browser\sheet-import-optional-url.measurement.spec.ts:588:9

# Error details

```
Error: expect(received).toHaveLength(expected)

Expected length: 1
Received length: 0
Received array:  []
```

# Test source

```ts
  397 |         "eventLists",
  398 |         "data",
  399 |         metadata,
  400 |         previousCheckpoint,
  401 |       )
  402 |     : previousCheckpoint;
  403 |   const sidecar = await partitionDayRecordStore("eventLists", next);
  404 |   await page.evaluate(
  405 |     async ({
  406 |       next,
  407 |       metadata,
  408 |       checkpoint,
  409 |       metadataKey,
  410 |       checkpointKey,
  411 |       readinessKeys,
  412 |       preparedEventListKey,
  413 |       sidecarEntries,
  414 |       rootDigests,
  415 |     }) => {
  416 |       const database = await new Promise<IDBDatabase>((resolve, reject) => {
  417 |         const request = indexedDB.open("EventShoppingPlannerDB");
  418 |         request.onsuccess = () => resolve(request.result);
  419 |         request.onerror = () => reject(request.error);
  420 |       });
  421 |       try {
  422 |         await new Promise<void>((resolve, reject) => {
  423 |           const tx = database.transaction(
  424 |             ["eventLists", "syncQueue"],
  425 |             "readwrite",
  426 |           );
  427 |           const control = tx.objectStore("syncQueue");
  428 |           tx.objectStore("eventLists").put(next, "data");
  429 |           control.put(metadata, metadataKey);
  430 |           control.put(checkpoint, checkpointKey);
  431 |           for (const [key, entry] of sidecarEntries)
  432 |             tx.objectStore("eventLists").put(entry, key);
  433 |           for (const [key, digest] of rootDigests) control.put(digest, key);
  434 |           if (!readinessKeys.length)
  435 |             control.put(metadata.revision, preparedEventListKey);
  436 |           for (const key of readinessKeys) control.delete(key);
  437 |           tx.oncomplete = () => resolve();
  438 |           tx.onabort = () => reject(tx.error);
  439 |         });
  440 |       } finally {
  441 |         database.close();
  442 |       }
  443 |     },
  444 |     {
  445 |       next,
  446 |       metadata,
  447 |       checkpoint,
  448 |       metadataKey,
  449 |       checkpointKey,
  450 |       readinessKeys: unprepared
  451 |         ? [...sidecarRecordStores, "mapData" as const].map(scopeReadyKey)
  452 |         : [],
  453 |       preparedEventListKey: scopeReadyKey("eventLists"),
  454 |       sidecarEntries: [...sidecar.puts],
  455 |       rootDigests: [...sidecar.puts.values()]
  456 |         .filter((entry) => !entry.path.length)
  457 |         .map(
  458 |           (entry) =>
  459 |             [
  460 |               dayRecordRootDigestKey("eventLists", entry.eventName),
  461 |               entry.digest,
  462 |             ] as const,
  463 |         ),
  464 |     },
  465 |   );
  466 |   for (const store of dayRecordStores)
  467 |     expect(await stored(page, store)).toEqual(
  468 |       expect.objectContaining({ authenticatedRoots: true }),
  469 |     );
  470 |   for (const store of [...sidecarRecordStores, "mapData" as const]) {
  471 |     const ready = await stored(page, "syncQueue", scopeReadyKey(store));
  472 |     const root = (await stored(
  473 |       page,
  474 |       "syncQueue",
  475 |       createPersistenceMetadataKey(store, "data"),
  476 |     )) as StoredPersistenceMetadata;
  477 |     expect(ready).toBe(unprepared ? undefined : root.revision);
  478 |   }
  479 | }
  480 | async function assertStartupWrites(page: Page, state: string, mode: string) {
  481 |   const probe = await collectProbe(page);
  482 |   const atomic = probe.transactions.filter(
  483 |     (entry) =>
  484 |       entry.mode === "readwrite" &&
  485 |       entry.stores.includes("eventLists") &&
  486 |       entry.stores.includes("eventConsistency"),
  487 |   );
  488 |   const successes = atomic.filter((entry) => entry.outcome === "complete");
  489 |   const preparation = successes.filter(
  490 |     (entry) => entry.eventListsDataPuts === 0,
  491 |   );
  492 |   const compatibility = successes.filter(
  493 |     (entry) => entry.eventListsDataPuts > 0,
  494 |   );
  495 |   const requiresPreparation = ["B02", "B04", "B06"].includes(state);
  496 |   const requiresCompatibility = ["B03", "B04", "B06"].includes(state);
> 497 |   expect(preparation).toHaveLength(requiresPreparation ? 1 : 0);
      |                       ^ Error: expect(received).toHaveLength(expected)
  498 |   expect(compatibility).toHaveLength(requiresCompatibility ? 1 : 0);
  499 |   expect(successes).toHaveLength(
  500 |     Number(requiresPreparation) + Number(requiresCompatibility),
  501 |   );
  502 |   expect(atomic.filter((entry) => entry.outcome === "abort")).toHaveLength(
  503 |     state === "B06" ? 1 : 0,
  504 |   );
  505 |   if (state === "B06")
  506 |     expect(atomic.filter((entry) => entry.injectedAbort)).toHaveLength(1);
  507 |   for (const entry of atomic)
  508 |     expect(entry.realm).toBe(mode === "worker" ? "worker" : "main");
  509 |   return {
  510 |     ...probe,
  511 |     preparationCommits: preparation.length,
  512 |     compatibilityCommits: compatibility.length,
  513 |     preparationCommitMs: preparation.reduce(
  514 |       (sum, entry) => sum + entry.durationMs!,
  515 |       0,
  516 |     ),
  517 |     compatibilityCommitMs: compatibility.reduce(
  518 |       (sum, entry) => sum + entry.durationMs!,
  519 |       0,
  520 |     ),
  521 |   };
  522 | }
  523 | async function openEditor(page: Page) {
  524 |   const card = page
  525 |     .locator('[data-item-id="item-0"]')
  526 |     .first()
  527 |     .locator(":scope > div.rounded-lg")
  528 |     .first();
  529 |   await card.dispatchEvent("pointerdown", {
  530 |     button: 0,
  531 |     isPrimary: true,
  532 |     pointerType: "mouse",
  533 |   });
  534 |   await expect(
  535 |     page.getByRole("button", { name: "編集", exact: true }),
  536 |   ).toBeVisible();
  537 |   await card.dispatchEvent("pointerup", {
  538 |     button: 0,
  539 |     isPrimary: true,
  540 |     pointerType: "mouse",
  541 |   });
  542 |   await page.getByRole("button", { name: "編集", exact: true }).click();
  543 |   return page.getByRole("dialog", { name: "アイテム編集", exact: true });
  544 | }
  545 | async function abortOnce(page: Page, mode: string) {
  546 |   const inject = () => {
  547 |     const original = IDBObjectStore.prototype.put;
  548 |     IDBObjectStore.prototype.put = function (
  549 |       ...args: Parameters<typeof original>
  550 |     ) {
  551 |       if (
  552 |         this.transaction.mode === "readwrite" &&
  553 |         this.transaction.objectStoreNames.contains("eventConsistency")
  554 |       ) {
  555 |         IDBObjectStore.prototype.put = original;
  556 |         throw new DOMException("measurement abort", "AbortError");
  557 |       }
  558 |       return original.apply(this, args);
  559 |     };
  560 |   };
  561 |   if (mode === "worker") {
  562 |     const worker = page
  563 |       .workers()
  564 |       .find((worker) => worker.url().includes("persistence.worker"));
  565 |     if (!worker) throw new Error("Missing production persistence worker");
  566 |     await worker.evaluate(inject);
  567 |   } else await page.evaluate(inject);
  568 | }
  569 | 
  570 | test.describe("sheet optional URL real-browser route measurements", () => {
  571 |   test.skip(!phase, "Opt in with SHEET_URL_BROWSER_PHASE=before or after");
  572 |   for (const count of [150, 500])
  573 |     for (const mode of ["direct", "worker"])
  574 |       for (const route of [
  575 |         "import",
  576 |         "update",
  577 |         "switch",
  578 |         "restore-json",
  579 |         "restore-xlsx",
  580 |         "startup-B01",
  581 |         "startup-B02",
  582 |         "startup-B03",
  583 |         "startup-B04",
  584 |         "startup-B05",
  585 |         "startup-B06",
  586 |         "retry",
  587 |       ] as const) {
  588 |         test(`${route}: ${count} ${mode} @sheet-url-routes`, async ({
  589 |           browser,
  590 |         }, testInfo) => {
  591 |           test.setTimeout(240000);
  592 |           const samples: Array<Record<string, unknown>> = [];
  593 |           for (let iteration = 0; iteration < repeats; iteration++) {
  594 |             const context: BrowserContext = await browser.newContext({
  595 |               viewport: { width: 1280, height: 720 },
  596 |               serviceWorkers: "block",
  597 |             });
```