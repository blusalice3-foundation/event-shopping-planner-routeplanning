# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: hall-sync-worker-atomicity.spec.ts >> OP02 real Worker simple hall sync rolls back every source/target after successful IDB writes, then retries atomically
- Location: tests\browser\hall-sync-worker-atomicity.spec.ts:430:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('dialog', { name: 'ホール定義（ブロック割当）', exact: true }).getByRole('button').filter({ hasText: '元の簡易ホール' }).first()

```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - banner [ref=f1e4]:
    - generic [ref=f1e7]:
      - heading "ホール同期の原子性" [level=1] [ref=f1e8]
      - button "候補ブロックを番号で並べ替え" [ref=f1e9] [cursor=pointer]
      - button "ホール定義（ブロック割当）" [ref=f1e12] [cursor=pointer]
      - button "ホール間移動順序" [ref=f1e15] [cursor=pointer]
      - button "表示項目の設定" [ref=f1e19] [cursor=pointer]
      - generic [ref=f1e20]:
        - button "📝" [ref=f1e21] [cursor=pointer]
        - button "🏃‍♂️" [ref=f1e22] [cursor=pointer]
        - button "🔍" [ref=f1e23] [cursor=pointer]
    - generic [ref=f1e25]:
      - button "イベント一覧" [ref=f1e26] [cursor=pointer]
      - button "２日目1" [ref=f1e27] [cursor=pointer]
      - button "1日目1" [ref=f1e28] [cursor=pointer]
      - button "2日目1" [ref=f1e29] [cursor=pointer]
      - button "3日目1" [ref=f1e30] [cursor=pointer]
      - button "4日目1" [ref=f1e31] [cursor=pointer]
      - button "アイテム追加" [ref=f1e32] [cursor=pointer]
      - generic [ref=f1e33]:
        - textbox "検索..." [ref=f1e34]
        - button "次を検索" [disabled] [ref=f1e35]
  - main [ref=f1e36]:
    - generic [ref=f1e38]:
      - generic [ref=f1e39]:
        - generic [ref=f1e40]:
          - generic [ref=f1e41]:
            - heading "実行リストアイテム" [level=2] [ref=f1e42]
            - button "スペース別" [ref=f1e44] [cursor=pointer]
          - paragraph [ref=f1e45]: 実行対象として選択中のアイテムを管理します。
        - list "買い物リスト" [ref=f1e46]:
          - listitem "元の簡易同期先2 1件" [ref=f1e48]:
            - generic [ref=f1e49]:
              - generic [ref=f1e50]:
                - generic [ref=f1e53]: 元の簡易同期先2
                - generic [ref=f1e54]: 1件
              - list "元の簡易同期先2の項目" [ref=f1e55]:
                - listitem "A1 サークル3 新刊3" [ref=f1e57]:
                  - generic [ref=f1e59]:
                    - generic [ref=f1e60]:
                      - generic [ref=f1e61]: "1"
                      - checkbox "Select item サークル3 - 新刊3" [ref=f1e62]
                      - button "上に移動" [disabled] [ref=f1e63]
                      - button "下に移動" [disabled] [ref=f1e73]
                      - button "保護なし" [ref=f1e76] [cursor=pointer]: 🔓
                    - generic [ref=f1e77]:
                      - generic [ref=f1e78]:
                        - generic [ref=f1e79]: ２日目
                        - generic [ref=f1e80]: A-1
                        - button "サークル3" [ref=f1e81] [cursor=pointer]
                      - button "新刊3" [ref=f1e84] [cursor=pointer]
                      - textbox "利用者メモ" [ref=f1e88]: エラーが発生しました・この購入記録は保持
                    - generic [ref=f1e89]:
                      - 'button "Current status: 購入済. Click to change." [ref=f1e90] [cursor=pointer]':
                        - generic [ref=f1e93]: 購入済
                      - generic [ref=f1e94]:
                        - generic [ref=f1e95]: 数量
                        - combobox "購入予定数量" [ref=f1e96]:
                          - option "1"
                          - option "2" [selected]
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
                      - generic [ref=f1e97]:
                        - generic [ref=f1e98]: 購入金額
                        - generic [ref=f1e99]: ¥
                        - combobox "購入金額" [ref=f1e100]:
                          - option "価格未定"
                          - option "0"
                          - option "100"
                          - option "200"
                          - option "300"
                          - option "400"
                          - option "500"
                          - option "600"
                          - option "700" [selected]
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
      - generic [ref=f1e101]:
        - generic [ref=f1e102]:
          - heading "候補アイテム" [level=2] [ref=f1e103]
          - paragraph [ref=f1e104]: このリストから選択したアイテムを実行リストへ移動します。
        - list "買い物リスト" [ref=f1e105]
  - dialog "ホール定義（ブロック割当）" [ref=f1e106]:
    - group [ref=f1e107]:
      - generic [ref=f1e108]:
        - generic [ref=f1e109]:
          - heading "ホール定義（ブロック割当）" [level=2] [ref=f1e110]
          - paragraph [ref=f1e111]: ブロック名でホールを定義します
        - button "閉じる" [active] [ref=f1e112] [cursor=pointer]: ×
      - generic [ref=f1e114]:
        - 'button "元の 元の簡易同期先2 ブロック: A" [ref=f1e115] [cursor=pointer]':
          - generic [ref=f1e116]:
            - generic [ref=f1e117]: 元の
            - generic [ref=f1e121]:
              - generic [ref=f1e122]: 元の簡易同期先2
              - generic [ref=f1e123]: "ブロック: A"
        - button "+ 新しいホールを追加" [ref=f1e124] [cursor=pointer]:
          - generic [ref=f1e125]: +
          - text: 新しいホールを追加
      - generic [ref=f1e127]:
        - button "キャンセル" [ref=f1e128] [cursor=pointer]
        - button "他の日に同期" [ref=f1e129] [cursor=pointer]
        - button "保存" [ref=f1e130] [cursor=pointer]
  - status "保存済み・旧データ保全中"
```

# Test source

```ts
  339 |         )
  340 |           trace.writeRequests.push(method);
  341 |       });
  342 |       const transactions = new WeakMap<IDBTransaction, TransactionTrace>();
  343 |       const originalTransaction = IDBDatabase.prototype.transaction;
  344 |       IDBDatabase.prototype.transaction = function (
  345 |         ...args: Parameters<IDBDatabase["transaction"]>
  346 |       ) {
  347 |         const transaction = originalTransaction.apply(this, args);
  348 |         if (args[1] === "readwrite") {
  349 |           const record: TransactionTrace = {
  350 |             stores: [...transaction.objectStoreNames],
  351 |             outcome: "pending",
  352 |             puts: 0,
  353 |             successfulPuts: 0,
  354 |             queuedDefinitions: [],
  355 |             successfulDefinitions: [],
  356 |           };
  357 |           transactions.set(transaction, record);
  358 |           trace.transactions.push(record);
  359 |           transaction.addEventListener("complete", () => {
  360 |             record.outcome = "complete";
  361 |           });
  362 |           transaction.addEventListener("abort", () => {
  363 |             record.outcome = "abort";
  364 |           });
  365 |         }
  366 |         return transaction;
  367 |       };
  368 |       const originalPut = IDBObjectStore.prototype.put;
  369 |       IDBObjectStore.prototype.put = function (
  370 |         ...args: Parameters<IDBObjectStore["put"]>
  371 |       ) {
  372 |         const request = originalPut.apply(this, args);
  373 |         const transaction = this.transaction;
  374 |         const record = transactions.get(transaction);
  375 |         if (!record) return request;
  376 |         record.puts++;
  377 |         const value = args[0] as {
  378 |           kind?: string;
  379 |           eventName?: string;
  380 |           path?: string[];
  381 |         };
  382 |         const key =
  383 |           this.name === "hallDefinitions" &&
  384 |           value.kind === "event-shopping-planner-day-record" &&
  385 |           value.eventName === eventName
  386 |             ? value.path?.[0]
  387 |             : undefined;
  388 |         if (key) record.queuedDefinitions.push(key);
  389 |         request.addEventListener("success", () => {
  390 |           record.successfulPuts++;
  391 |           if (key) record.successfulDefinitions.push(key);
  392 |           // Abort only after real source and target definition writes have succeeded.
  393 |           // Their request success must still roll back with the encompassing transaction.
  394 |           if (key === destination && trace.injected === 0) {
  395 |             trace.injected++;
  396 |             transaction.abort();
  397 |           }
  398 |         });
  399 |         return request;
  400 |       };
  401 |     },
  402 |     { eventName, destination: simple ? maplessKey("3日目") : "3日目マップ" },
  403 |   );
  404 |   return worker;
  405 | }
  406 | 
  407 | async function sync(page: Page, panel: Locator) {
  408 |   page.once("dialog", (dialog) => dialog.accept());
  409 |   await panel.getByRole("button", { name: /選択した日に同期/ }).click();
  410 |   const confirmation = page.getByRole("button", {
  411 |     name: "確認して保存",
  412 |     exact: true,
  413 |   });
  414 |   const error = panel.getByRole("alert");
  415 |   await expect
  416 |     .poll(async () => {
  417 |       if (await confirmation.isVisible()) return "review";
  418 |       if (await error.isVisible()) return "failed";
  419 |       return (await panel
  420 |         .getByRole("checkbox", { name: targets[0], exact: true })
  421 |         .isVisible())
  422 |         ? "waiting"
  423 |         : "saved";
  424 |     })
  425 |     .not.toBe("waiting");
  426 |   if (await confirmation.isVisible()) await confirmation.click();
  427 | }
  428 | 
  429 | for (const simple of [true, false]) {
  430 |   test(`OP02 real Worker ${simple ? "simple" : "detailed"} hall sync rolls back every source/target after successful IDB writes, then retries atomically`, async ({
  431 |     page,
  432 |   }, testInfo) => {
  433 |     await restore(page, simple);
  434 |     const panel = await openPanel(page, simple);
  435 |     await panel
  436 |       .getByRole("button")
  437 |       .filter({ hasText: sourceName(simple) })
  438 |       .first()
> 439 |       .click();
      |        ^ Error: locator.click: Test timeout of 30000ms exceeded.
  440 |     await panel.getByPlaceholder("例: 東1ホール").fill(draftName);
  441 |     await panel
  442 |       .getByRole("button", { name: simple ? "確定" : "保存", exact: true })
  443 |       .click();
  444 |     await panel
  445 |       .getByRole("button", { name: "他の日に同期", exact: true })
  446 |       .click();
  447 |     for (const day of targets)
  448 |       await panel.getByRole("checkbox", { name: day, exact: true }).check();
  449 |     const before = await allStores(page);
  450 |     const beforeDefinitions = payload<HallDefinitionsStore>(
  451 |       before,
  452 |       "hallDefinitions",
  453 |     );
  454 |     const beforeConsistency = payload<EventConsistencyStore>(
  455 |       before,
  456 |       "eventConsistency",
  457 |     );
  458 |     if (!simple) {
  459 |       // Distinct exact day keys resolve to one shared real map destination.
  460 |       for (const day of targets.slice(0, 2))
  461 |         expect(beforeConsistency[eventName].days[day].selectedMapKey).toBe(
  462 |           "2日目マップ",
  463 |         );
  464 |     }
  465 |     const worker = await installAbort(page, simple);
  466 |     await sync(page, panel);
  467 |     await expect(panel.getByRole("alert")).toContainText(
  468 |       "入力を保持しています",
  469 |     );
  470 |     await expect(
  471 |       panel.getByRole("button").filter({ hasText: draftName }).first(),
  472 |     ).toBeVisible();
  473 |     for (const day of targets)
  474 |       await expect(
  475 |         panel.getByRole("checkbox", { name: day, exact: true }),
  476 |       ).toBeChecked();
  477 |     expect(await allStores(page)).toEqual(before);
  478 |     const failed = await worker.evaluate(
  479 |       () =>
  480 |         (globalThis as unknown as { __hallSyncAbortTrace: WorkerTrace })
  481 |           .__hallSyncAbortTrace,
  482 |     );
  483 |     expect(failed.writeRequests).toEqual(["commit"]);
  484 |     expect(failed.injected).toBe(1);
  485 |     expect(failed.transactions).toHaveLength(1);
  486 |     expect(failed.transactions[0].outcome).toBe("abort");
  487 |     expect(failed.transactions[0].stores).toEqual(
  488 |       expect.arrayContaining([
  489 |         "hallDefinitions",
  490 |         "hallRouteSettings",
  491 |         "eventConsistency",
  492 |         "syncQueue",
  493 |       ]),
  494 |     );
  495 |     expect(failed.transactions[0].successfulPuts).toBeGreaterThan(1);
  496 |     const destinations = simple
  497 |       ? days.slice(0, 4).map(maplessKey)
  498 |       : ["1日目マップ", "2日目マップ", "3日目マップ"];
  499 |     expect(failed.transactions[0].successfulDefinitions).toEqual(
  500 |       expect.arrayContaining(destinations),
  501 |     );
  502 |     // A second independent readonly transaction sees exactly the same durable data.
  503 |     expect(await allStores(page)).toEqual(before);
  504 |     await sync(page, panel);
  505 |     await expect(panel.getByRole("alert")).toHaveCount(0);
  506 |     await expect(
  507 |       panel.getByRole("checkbox", { name: targets[0], exact: true }),
  508 |     ).toHaveCount(0);
  509 |     await expect(
  510 |       panel.getByRole("button").filter({ hasText: draftName }).first(),
  511 |     ).toBeVisible();
  512 |     const saved = await allStores(page);
  513 |     const definitions = payload<HallDefinitionsStore>(saved, "hallDefinitions");
  514 |     const consistency = payload<EventConsistencyStore>(
  515 |       saved,
  516 |       "eventConsistency",
  517 |     );
  518 |     for (const destination of destinations)
  519 |       expect(definitions[eventName][destination][0].name).toBe(draftName);
  520 |     expect(definitions[eventName][destinations[0]][0].id).toBe("shared-raw-id");
  521 |     expect(
  522 |       new Set(
  523 |         destinations.map(
  524 |           (destination) => definitions[eventName][destination][0].id,
  525 |         ),
  526 |       ).size,
  527 |     ).toBe(destinations.length);
  528 |     for (const hall of Object.values(definitions[eventName]).flat())
  529 |       expect(hall.id.startsWith("@hall:")).toBe(false);
  530 |     for (const [index, day] of days.slice(0, 4).entries()) {
  531 |       const context = simple
  532 |         ? consistency[eventName].days[day].mapless!
  533 |         : consistency[eventName].days[day].maps[mapKeys[index]];
  534 |       const destination = simple ? maplessKey(day) : mapKeys[index];
  535 |       const hallId = definitions[eventName][destination][0].id;
  536 |       expect(context.hallOrder[0].hall).toEqual(
  537 |         simple
  538 |           ? { kind: "simple", dayKey: day, hallId }
  539 |           : { kind: "map", mapKey: destination, hallId },
```