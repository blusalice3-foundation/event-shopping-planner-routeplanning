# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sheet-import-optional-url.spec.ts >> OP10: CSV read failure is reported and same file selection retries
- Location: tests\browser\sheet-import-optional-url.spec.ts:569:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: '取込互換検証', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('heading', { name: '取込互換検証', exact: true })

```

```yaml
- dialog "所属・配置の変更を確認":
  - heading "所属・配置の変更を確認" [level=2]
  - region "確認内容": "1日目 / マップなし: サークル0・新刊0 → 未割当（共有 1 件） 1日目 / マップなし: サークル1・新刊1 → 未割当（共有 1 件） 1日目 / マップなし: 巡回順: なし 1日目 / マップなし: 訪問リスト: なし"
  - button "取消"
  - button "確認して保存"
- banner:
  - heading "即売会購入巡回表" [level=1]
  - button "表示項目の設定":
    - img
  - button "イベント一覧"
  - button "新規リスト作成"
- main:
  - heading "新規リスト作成" [level=2]
  - paragraph: スプレッドシートのM列 サークル名 / N列 参加日 / O列 ブロック / P列 番号 / Q列 タイトル / R列 価格 / W列 備考をこの順番でコピーし、下の「M列 サークル名」欄に貼り付けてください。データが自動で振り分けられます。
  - status: 保存処理中です。
  - region "シート取込結果":
    - paragraph: "取込対象: 2件、必須項目不足による除外: 0行"
  - text: 即売会名
  - textbox "即売会名":
    - /placeholder: "例: C105"
    - text: 取込互換検証
  - heading "インポート方法" [level=3]
  - text: スプレッドシートURLからインポート
  - textbox "スプレッドシートURLからインポート":
    - /placeholder: https://docs.google.com/spreadsheets/d/..../edit
  - button "URLからインポート"
  - paragraph: シート名「品目表」のM列からR列とW列をインポートします
  - text: CSVの列形式
  - combobox "CSVの列形式":
    - option "見出しから自動判定" [selected]
    - option "A列開始・見出しあり"
    - option "A列開始・見出しなし"
    - option "M列開始・見出しあり"
    - option "M列開始・見出しなし"
  - button "選択したCSVを再試行" [disabled]
  - text: CSVファイルからインポート
  - button "CSVファイルからインポート" [disabled]
  - paragraph: 見出しから形式を判定します。見出しがない場合は列形式を指定してください。
  - text: または M列 サークル名
  - textbox "M列 サークル名":
    - /placeholder: "サークルA\nサークルB"
  - text: N列 参加日
  - textbox "N列 参加日":
    - /placeholder: "1日目\n2日目"
  - text: O列 ブロック
  - textbox "O列 ブロック":
    - /placeholder: "G\nカ"
  - text: P列 番号
  - textbox "P列 番号":
    - /placeholder: "01a\n03b"
  - text: Q列 タイトル
  - textbox "Q列 タイトル":
    - /placeholder: "新刊セット\n既刊1"
  - text: R列 価格
  - textbox "R列 価格":
    - /placeholder: "1000\n500"
  - text: W列 備考
  - textbox "W列 備考":
    - /placeholder: "スケブお願い\n挨拶に行く"
  - text: URL（7列貼り付け対象外）
  - textbox "URL（7列貼り付け対象外）":
    - /placeholder: "https://example.com\nhttps://example2.com"
  - button "リストを作成"
- status "保存中…"
```

# Test source

```ts
  513 |     "3",
  514 |   );
  515 |   await editor.getByLabel("実購入数", { exact: true }).fill("2");
  516 |   await editor.getByRole("button", { name: "保存", exact: true }).click();
  517 |   await expect(editor).toBeHidden();
  518 |   await expect
  519 |     .poll(async () =>
  520 |       (
  521 |         (await stored(page, "eventLists"))[SHEET_EVENT] as Array<{
  522 |           id: string;
  523 |           quantity: number;
  524 |           limitedPurchasedQuantity: number;
  525 |         }>
  526 |       ).find((i) => i.id === "item-0"),
  527 |     )
  528 |     .toMatchObject({
  529 |       quantity: 3,
  530 |       limitedPurchasedQuantity: 2,
  531 |       purchaseStatus: "LimitedPurchase",
  532 |     });
  533 |   await page.reload();
  534 |   expect(
  535 |     ((await stored(page, "eventLists"))[SHEET_EVENT] as object[])[0],
  536 |   ).toMatchObject({ quantity: 3, limitedPurchasedQuantity: 2 });
  537 | });
  538 | 
  539 | test("OP11: failed URL update reopens with submitted URL and empty sheet name", async ({
  540 |   page,
  541 | }) => {
  542 |   page.on("dialog", (dialog) => dialog.accept());
  543 |   await page.route("**/api/google-sheets-csv", (route) =>
  544 |     route.fulfill({ status: 503, body: "unavailable" }),
  545 |   );
  546 |   await restore(page, 2, "edit", true);
  547 |   await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  548 |   await page.getByRole("button", { name: "メニュー", exact: true }).click();
  549 |   await page
  550 |     .getByRole("button", { name: "🔄 アイテム更新", exact: true })
  551 |     .click();
  552 |   const url = page.getByLabel("スプレッドシートURL", { exact: true });
  553 |   await expect(url).toBeVisible();
  554 |   await url.fill("https://docs.google.com/spreadsheets/d/retried/edit");
  555 |   await page.getByLabel("シート名（オプション）", { exact: true }).fill("");
  556 |   await page.getByRole("button", { name: "更新", exact: true }).click();
  557 |   await expect(url).toHaveValue(
  558 |     "https://docs.google.com/spreadsheets/d/retried/edit",
  559 |   );
  560 |   await expect(
  561 |     page.getByLabel("シート名（オプション）", { exact: true }),
  562 |   ).toHaveValue("");
  563 |   expect((await stored(page, "eventMetadata"))[SHEET_EVENT]).toMatchObject({
  564 |     spreadsheetUrl: "https://docs.google.com/spreadsheets/d/original/edit",
  565 |     spreadsheetSheetName: "品目表",
  566 |   });
  567 | });
  568 | 
  569 | test("OP10: CSV read failure is reported and same file selection retries", async ({
  570 |   page,
  571 | }) => {
  572 |   const alerts: string[] = [];
  573 |   page.on("dialog", async (dialog) => {
  574 |     alerts.push(dialog.message());
  575 |     await dialog.accept();
  576 |   });
  577 |   await page.addInitScript(() => {
  578 |     const original = File.prototype.text;
  579 |     let failed = false;
  580 |     File.prototype.text = function () {
  581 |       if (this.name === "retry.csv" && !failed) {
  582 |         failed = true;
  583 |         return Promise.reject(
  584 |           new DOMException("unreadable", "NotReadableError"),
  585 |         );
  586 |       }
  587 |       return original.call(this);
  588 |     };
  589 |   });
  590 |   await page.goto("/");
  591 |   await page
  592 |     .getByRole("button", { name: "新規リスト作成", exact: true })
  593 |     .click();
  594 |   await page.getByLabel("即売会名", { exact: true }).fill(SHEET_EVENT);
  595 |   const input = page.locator('input[type="file"][accept=".csv"]');
  596 |   const file = {
  597 |     name: "retry.csv",
  598 |     mimeType: "text/csv",
  599 |     buffer: Buffer.from(sheetCsv(2), "utf8"),
  600 |   };
  601 |   await input.setInputFiles(file);
  602 |   await expect
  603 |     .poll(() =>
  604 |       alerts.some((message) =>
  605 |         message.includes("CSVファイルを読み取れませんでした"),
  606 |       ),
  607 |     )
  608 |     .toBe(true);
  609 |   expect(await input.inputValue()).toBe("");
  610 |   await input.setInputFiles(file);
  611 |   await expect(
  612 |     page.getByRole("heading", { name: SHEET_EVENT, exact: true }),
> 613 |   ).toBeVisible();
      |     ^ Error: expect(locator).toBeVisible() failed
  614 |   await page.reload();
  615 |   expect((await stored(page, "eventLists"))[SHEET_EVENT]).toHaveLength(2);
  616 | });
  617 | 
  618 | test("OP07: late JSON cannot reopen after newer candidate cancellation", async ({
  619 |   page,
  620 | }) => {
  621 |   const alerts: string[] = [];
  622 |   page.on("dialog", async (dialog) => {
  623 |     alerts.push(dialog.message());
  624 |     await dialog.accept();
  625 |   });
  626 |   await page.addInitScript(() => {
  627 |     const original = File.prototype.text;
  628 |     File.prototype.text = function () {
  629 |       if (this.name === "late.json")
  630 |         return new Promise<string>((resolve) => {
  631 |           (window as unknown as { releaseOldJson: () => void }).releaseOldJson =
  632 |             () => {
  633 |               void original.call(this).then(resolve);
  634 |             };
  635 |         });
  636 |       return original.call(this);
  637 |     };
  638 |   });
  639 |   await page.goto("/");
  640 |   const fixture = Buffer.from(
  641 |     JSON.stringify({
  642 |       kind: "event-shopping-planner-backup",
  643 |       version: 2,
  644 |       exportedAt: "2026-10-18T00:00:00.000Z",
  645 |       data: sheetSnapshot(2),
  646 |     }),
  647 |     "utf8",
  648 |   );
  649 |   const input = page.getByLabel("バックアップファイルを選択");
  650 |   await input.setInputFiles({
  651 |     name: "late.json",
  652 |     mimeType: "application/json",
  653 |     buffer: fixture,
  654 |   });
  655 |   await input.setInputFiles({
  656 |     name: "new.json",
  657 |     mimeType: "application/json",
  658 |     buffer: fixture,
  659 |   });
  660 |   const candidate = page.getByRole("dialog", {
  661 |     name: "バックアップからイベントを復元",
  662 |     exact: true,
  663 |   });
  664 |   await expect(candidate).toBeVisible();
  665 |   await candidate
  666 |     .getByRole("button", { name: "キャンセル", exact: true })
  667 |     .click();
  668 |   await expect(candidate).toBeHidden();
  669 |   await page.evaluate(() => {
  670 |     (window as unknown as { releaseOldJson: () => void }).releaseOldJson();
  671 |   });
  672 |   await page.evaluate(async () => {
  673 |     await new Promise(requestAnimationFrame);
  674 |     await new Promise((resolve) => setTimeout(resolve, 0));
  675 |   });
  676 |   await expect(candidate).toBeHidden();
  677 |   expect(alerts).toEqual([]);
  678 | });
  679 | 
```