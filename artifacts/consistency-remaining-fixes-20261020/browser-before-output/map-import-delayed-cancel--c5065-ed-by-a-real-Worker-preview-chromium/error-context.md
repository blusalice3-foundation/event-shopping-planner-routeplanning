# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: map-import-delayed-cancel.spec.ts >> map import can resume after a pending import parser is replaced by a real Worker preview
- Location: tests\browser\map-import-delayed-cancel.spec.ts:425:1

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator: getByRole('dialog', { name: '📋 マップデータ取り込み', exact: true }).getByRole('button', { name: '取り込む', exact: true })
Expected: enabled
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeEnabled" with timeout 5000ms
  - waiting for getByRole('dialog', { name: '📋 マップデータ取り込み', exact: true }).getByRole('button', { name: '取り込む', exact: true })

```

```yaml
- banner:
  - heading "地図取込の遅延取消" [level=1]
  - button "候補ブロックを番号で並べ替え":
    - img
  - button "ホール定義（ブロック割当）":
    - img
  - button "表示項目の設定":
    - img
  - button "📝"
  - button "🏃‍♂️"
  - button "🔍"
  - button "イベント一覧"
  - button "1日目1"
  - button "アイテム追加"
  - textbox "検索..."
  - button "次を検索" [disabled]
- main:
  - heading "実行リストアイテム" [level=2]
  - button "スペース別"
  - paragraph: 実行対象として選択中のアイテムを管理します。
  - list "買い物リスト":
    - listitem "A1 ユーザー登録 購入記録を保持":
      - checkbox "Select item ユーザー登録 - 購入記録を保持"
      - button "上に移動" [disabled]:
        - img
      - img
      - button "下に移動" [disabled]:
        - img
      - button "保護なし": 🔓
      - text: 1日目 A-1
      - button "ユーザー登録"
      - button "購入記録を保持"
      - textbox "利用者メモ": エラーが発生しました・この記録は変更しない
      - 'button "Current status: 購入済. Click to change."':
        - img
        - text: 購入済
      - text: 数量
      - combobox "購入予定数量":
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
      - text: 購入金額 ¥
      - combobox "購入金額":
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
  - heading "候補アイテム" [level=2]
  - paragraph: このリストから選択したアイテムを実行リストへ移動します。
  - list "買い物リスト"
- dialog "📋 マップデータ取り込み":
  - heading "📋 マップデータ取り込み" [level=2]
  - button:
    - img
  - group:
    - text: 📄 parser-switch.xlsx (6.4 KB)
    - button "⚙️ ブロック自動検出の詳細設定":
      - text: ⚙️ ブロック自動検出の詳細設定
      - img
    - button "🔍 プレビュー（ブロック検出）"
    - text: ✅ 1ブロック検出
    - paragraph: 検出ブロック (1件)
    - button "A (1)"
    - paragraph: 1日目マップ
    - paragraph: 日別マップの初期角度（0〜359°、未設定は0°）
    - paragraph: ここで設定した角度は「リセット」の戻り先になります。
    - text: 1日目マップ
    - spinbutton "1日目マップ": "0"
  - button "キャンセル"
  - button "取り込み中..." [disabled]
- status "保存済み"
```

# Test source

```ts
  393 |     await expect(next).toBeVisible();
  394 |     await expect(next.getByText(nextFile, { exact: true })).toBeVisible();
  395 |     await expect(setting).toHaveValue("3");
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
> 493 |   await expect(retry).toBeEnabled();
      |                       ^ Error: expect(locator).toBeEnabled() failed
  494 |   expect(await allStores(page)).toEqual(before);
  495 |   await retry.click();
  496 |   await expect(dialog).toBeHidden();
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