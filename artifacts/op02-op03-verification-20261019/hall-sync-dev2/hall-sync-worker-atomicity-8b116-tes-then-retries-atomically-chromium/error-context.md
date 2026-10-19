# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: hall-sync-worker-atomicity.spec.ts >> OP02 real Worker detailed hall sync rolls back every source/target after successful IDB writes, then retries atomically
- Location: tests\browser\hall-sync-worker-atomicity.spec.ts:431:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "2日目マップ"
Received: null
```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - banner [ref=f1e4]:
    - generic [ref=f1e7]:
      - heading "ホール同期の原子性" [level=1] [ref=f1e8]
      - button "候補ブロックを番号で並べ替え" [ref=f1e9] [cursor=pointer]
      - button "リスト表示に切り替え" [ref=f1e13] [cursor=pointer]
      - button "表示項目の設定" [ref=f1e17] [cursor=pointer]
      - 'button "表示ホール: 全ホール" [ref=f1e19] [cursor=pointer]'
      - button "ホール順を編集" [ref=f1e20] [cursor=pointer]
      - 'button "ルート表示: 有効" [ref=f1e21] [cursor=pointer]'
      - button "M" [ref=f1e22] [cursor=pointer]
      - generic [ref=f1e24]:
        - button "回転操作を展開" [ref=f1e25] [cursor=pointer]: ▸
        - generic [ref=f1e26]: 回転
        - generic [ref=f1e27]: 0°
    - generic [ref=f1e29]:
      - button "イベント一覧" [ref=f1e30] [cursor=pointer]
      - button "２日目2" [ref=f1e31] [cursor=pointer]
      - button "1日目2" [ref=f1e32] [cursor=pointer]
      - button "2日目2" [ref=f1e33] [cursor=pointer]
      - button "3日目2" [ref=f1e34] [cursor=pointer]
      - button "4日目2" [ref=f1e35] [cursor=pointer]
      - button "アイテム追加" [ref=f1e36] [cursor=pointer]
      - generic [ref=f1e37]:
        - textbox "検索..." [ref=f1e38]
        - button "次を検索" [disabled] [ref=f1e39]
  - main [ref=f1e40]:
    - generic [ref=f1e41]:
      - generic [ref=f1e42]: 100%
      - group [ref=f1e44]:
        - generic "場所未確認 1アイテム" [ref=f1e45] [cursor=pointer]
  - dialog [ref=f1e49]:
    - group [ref=f1e50]:
      - generic [ref=f1e51]:
        - heading "ホール定義エリア設定" [level=2] [ref=f1e52]
        - button "ホール定義エリア設定を閉じる" [ref=f1e53] [cursor=pointer]: ×
      - generic [ref=f1e54]:
        - generic [ref=f1e55]:
          - button "一覧" [ref=f1e56] [cursor=pointer]
          - button "編集" [ref=f1e57] [cursor=pointer]
        - generic [ref=f1e58]:
          - generic [ref=f1e59]:
            - heading "定義済みホール (2件)" [level=3] [ref=f1e60]
            - generic [ref=f1e61]:
              - button "+ 新規" [ref=f1e62] [cursor=pointer]
              - button "全削除" [ref=f1e63] [cursor=pointer]
          - generic [ref=f1e64]:
            - generic [ref=f1e66]:
              - button "4角 ユーザー登録・同期する下書き 1ブロック" [ref=f1e67] [cursor=pointer]:
                - generic [ref=f1e68]: 4角
                - generic [ref=f1e72]:
                  - generic [ref=f1e73]: ユーザー登録・同期する下書き
                  - generic [ref=f1e74]: 1ブロック
              - button "ユーザー登録・同期する下書きを削除" [ref=f1e75] [cursor=pointer]: 削除
            - generic [ref=f1e77]:
              - button "ブロック 元の簡易ホール 0ブロック" [ref=f1e78] [cursor=pointer]:
                - generic [ref=f1e79]: ブロック
                - generic [ref=f1e83]:
                  - generic [ref=f1e84]: 元の簡易ホール
                  - generic [ref=f1e85]: 0ブロック
              - button "元の簡易ホールを削除" [ref=f1e86] [cursor=pointer]: 削除
      - generic [ref=f1e87]:
        - generic [ref=f1e88]:
          - generic [ref=f1e89]: "同期先の日付を選択（現在: 1日目）"
          - generic [ref=f1e90]:
            - generic [ref=f1e91] [cursor=pointer]:
              - checkbox "２日目" [checked] [ref=f1e92]
              - generic [ref=f1e93]: ２日目
            - generic [ref=f1e94] [cursor=pointer]:
              - checkbox "2日目" [checked] [ref=f1e95]
              - generic [ref=f1e96]: 2日目
            - generic [ref=f1e97] [cursor=pointer]:
              - checkbox "3日目" [checked] [active] [ref=f1e98]
              - generic [ref=f1e99]: 3日目
            - generic [ref=f1e100] [cursor=pointer]:
              - checkbox "4日目" [ref=f1e101]
              - generic [ref=f1e102]: 4日目
          - generic [ref=f1e103]:
            - button "全日付に適用" [ref=f1e104] [cursor=pointer]
            - button "選択した日に同期 (3)" [ref=f1e105] [cursor=pointer]
            - button "閉じる" [ref=f1e106] [cursor=pointer]
        - generic [ref=f1e107]:
          - button "キャンセル" [ref=f1e108] [cursor=pointer]
          - button "他の日に同期" [ref=f1e109] [cursor=pointer]
          - button "適用" [ref=f1e110] [cursor=pointer]
  - status "保存済み・旧データ保全中"
```

# Test source

```ts
  362 |           });
  363 |           transaction.addEventListener("abort", () => {
  364 |             record.outcome = "abort";
  365 |           });
  366 |         }
  367 |         return transaction;
  368 |       };
  369 |       const originalPut = IDBObjectStore.prototype.put;
  370 |       IDBObjectStore.prototype.put = function (
  371 |         ...args: Parameters<IDBObjectStore["put"]>
  372 |       ) {
  373 |         const request = originalPut.apply(this, args);
  374 |         const transaction = this.transaction;
  375 |         const record = transactions.get(transaction);
  376 |         if (!record) return request;
  377 |         record.puts++;
  378 |         const value = args[0] as {
  379 |           kind?: string;
  380 |           eventName?: string;
  381 |           path?: string[];
  382 |         };
  383 |         const key =
  384 |           this.name === "hallDefinitions" &&
  385 |           value.kind === "event-shopping-planner-day-record" &&
  386 |           value.eventName === eventName
  387 |             ? value.path?.[0]
  388 |             : undefined;
  389 |         if (key) record.queuedDefinitions.push(key);
  390 |         request.addEventListener("success", () => {
  391 |           record.successfulPuts++;
  392 |           if (key) record.successfulDefinitions.push(key);
  393 |           // Abort only after real source and target definition writes have succeeded.
  394 |           // Their request success must still roll back with the encompassing transaction.
  395 |           if (key === destination && trace.injected === 0) {
  396 |             trace.injected++;
  397 |             transaction.abort();
  398 |           }
  399 |         });
  400 |         return request;
  401 |       };
  402 |     },
  403 |     { eventName, destination: simple ? maplessKey("3日目") : "3日目マップ" },
  404 |   );
  405 |   return worker;
  406 | }
  407 | 
  408 | async function sync(page: Page, panel: Locator) {
  409 |   page.once("dialog", (dialog) => dialog.accept());
  410 |   await panel.getByRole("button", { name: /選択した日に同期/ }).click();
  411 |   const confirmation = page.getByRole("button", {
  412 |     name: "確認して保存",
  413 |     exact: true,
  414 |   });
  415 |   const error = panel.getByRole("alert");
  416 |   await expect
  417 |     .poll(async () => {
  418 |       if (await confirmation.isVisible()) return "review";
  419 |       if (await error.isVisible()) return "failed";
  420 |       return (await panel
  421 |         .getByRole("checkbox", { name: targets[0], exact: true })
  422 |         .isVisible())
  423 |         ? "waiting"
  424 |         : "saved";
  425 |     })
  426 |     .not.toBe("waiting");
  427 |   if (await confirmation.isVisible()) await confirmation.click();
  428 | }
  429 | 
  430 | for (const simple of [true, false]) {
  431 |   test(`OP02 real Worker ${simple ? "simple" : "detailed"} hall sync rolls back every source/target after successful IDB writes, then retries atomically`, async ({
  432 |     page,
  433 |   }, testInfo) => {
  434 |     await restore(page, simple);
  435 |     const panel = await openPanel(page, simple);
  436 |     await panel
  437 |       .getByRole("button")
  438 |       .filter({ hasText: sourceName(simple) })
  439 |       .first()
  440 |       .click();
  441 |     await panel.getByPlaceholder("例: 東1ホール").fill(draftName);
  442 |     await panel
  443 |       .getByRole("button", { name: simple ? "確定" : "保存", exact: true })
  444 |       .click();
  445 |     await panel
  446 |       .getByRole("button", { name: "他の日に同期", exact: true })
  447 |       .click();
  448 |     for (const day of targets)
  449 |       await panel.getByRole("checkbox", { name: day, exact: true }).check();
  450 |     const before = await allStores(page);
  451 |     const beforeDefinitions = payload<HallDefinitionsStore>(
  452 |       before,
  453 |       "hallDefinitions",
  454 |     );
  455 |     const beforeConsistency = payload<EventConsistencyStore>(
  456 |       before,
  457 |       "eventConsistency",
  458 |     );
  459 |     if (!simple) {
  460 |       // Distinct exact day keys resolve to one shared real map destination.
  461 |       for (const day of targets.slice(0, 2))
> 462 |         expect(beforeConsistency[eventName].days[day].selectedMapKey).toBe(
      |                                                                       ^ Error: expect(received).toBe(expected) // Object.is equality
  463 |           "2日目マップ",
  464 |         );
  465 |     }
  466 |     const worker = await installAbort(page, simple);
  467 |     await sync(page, panel);
  468 |     await expect(panel.getByRole("alert")).toContainText(
  469 |       "入力を保持しています",
  470 |     );
  471 |     await expect(
  472 |       panel.getByRole("button").filter({ hasText: draftName }).first(),
  473 |     ).toBeVisible();
  474 |     for (const day of targets)
  475 |       await expect(
  476 |         panel.getByRole("checkbox", { name: day, exact: true }),
  477 |       ).toBeChecked();
  478 |     expect(await allStores(page)).toEqual(before);
  479 |     const failed = await worker.evaluate(
  480 |       () =>
  481 |         (globalThis as unknown as { __hallSyncAbortTrace: WorkerTrace })
  482 |           .__hallSyncAbortTrace,
  483 |     );
  484 |     expect(failed.writeRequests).toEqual(["commit"]);
  485 |     expect(failed.injected).toBe(1);
  486 |     expect(failed.transactions).toHaveLength(1);
  487 |     expect(failed.transactions[0].outcome).toBe("abort");
  488 |     expect(failed.transactions[0].stores).toEqual(
  489 |       expect.arrayContaining([
  490 |         "hallDefinitions",
  491 |         "hallRouteSettings",
  492 |         "eventConsistency",
  493 |         "syncQueue",
  494 |       ]),
  495 |     );
  496 |     expect(failed.transactions[0].successfulPuts).toBeGreaterThan(1);
  497 |     const destinations = simple
  498 |       ? days.slice(0, 4).map(maplessKey)
  499 |       : ["1日目マップ", "2日目マップ", "3日目マップ"];
  500 |     expect(failed.transactions[0].successfulDefinitions).toEqual(
  501 |       expect.arrayContaining(destinations),
  502 |     );
  503 |     // A second independent readonly transaction sees exactly the same durable data.
  504 |     expect(await allStores(page)).toEqual(before);
  505 |     await sync(page, panel);
  506 |     await expect(panel.getByRole("alert")).toHaveCount(0);
  507 |     await expect(
  508 |       panel.getByRole("checkbox", { name: targets[0], exact: true }),
  509 |     ).toHaveCount(0);
  510 |     await expect(
  511 |       panel.getByRole("button").filter({ hasText: draftName }).first(),
  512 |     ).toBeVisible();
  513 |     const saved = await allStores(page);
  514 |     const definitions = payload<HallDefinitionsStore>(saved, "hallDefinitions");
  515 |     const consistency = payload<EventConsistencyStore>(
  516 |       saved,
  517 |       "eventConsistency",
  518 |     );
  519 |     for (const destination of destinations)
  520 |       expect(definitions[eventName][destination][0].name).toBe(draftName);
  521 |     expect(definitions[eventName][destinations[0]][0].id).toBe("shared-raw-id");
  522 |     expect(
  523 |       new Set(
  524 |         destinations.map(
  525 |           (destination) => definitions[eventName][destination][0].id,
  526 |         ),
  527 |       ).size,
  528 |     ).toBe(destinations.length);
  529 |     for (const hall of Object.values(definitions[eventName]).flat())
  530 |       expect(hall.id.startsWith("@hall:")).toBe(false);
  531 |     for (const [index, day] of days.slice(0, 4).entries()) {
  532 |       const context = simple
  533 |         ? consistency[eventName].days[day].mapless!
  534 |         : consistency[eventName].days[day].maps[mapKeys[index]];
  535 |       const destination = simple ? maplessKey(day) : mapKeys[index];
  536 |       const hallId = definitions[eventName][destination][0].id;
  537 |       expect(context.hallOrder[0].hall).toEqual(
  538 |         simple
  539 |           ? { kind: "simple", dayKey: day, hallId }
  540 |           : { kind: "map", mapKey: destination, hallId },
  541 |       );
  542 |       expect(
  543 |         context.hallVisitLists.find(
  544 |           (list) => list.group.hall?.hallId === hallId,
  545 |         )?.itemIds,
  546 |       ).toEqual([`${index + 1}`]);
  547 |       if (!simple) {
  548 |         expect(definitions[eventName][maplessKey(day)]).toEqual(
  549 |           beforeDefinitions[eventName][maplessKey(day)],
  550 |         );
  551 |         expect(context.hallOrder[1]).toEqual(
  552 |           beforeConsistency[eventName].days[day].maps[mapKeys[index]]
  553 |             .hallOrder[1],
  554 |         );
  555 |         expect(
  556 |           context.hallVisitLists.find(
  557 |             (list) => list.group.hall?.kind === "simple",
  558 |           ),
  559 |         ).toEqual(
  560 |           beforeConsistency[eventName].days[day].maps[
  561 |             mapKeys[index]
  562 |           ].hallVisitLists.find((list) => list.group.hall?.kind === "simple"),
```