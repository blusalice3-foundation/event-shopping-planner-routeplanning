# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cross-feature-consistency.spec.ts >> OP05 late purchase failure keeps focus inside the focus-mode add dialog
- Location: tests\browser\cross-feature-consistency.spec.ts:5676:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - alert [ref=e4]:
      - text: 保存に失敗しました。1件の操作を未保存のまま保留しています。
      - button "保留中の保存を再試行" [active] [ref=e5] [cursor=pointer]
      - button "JSONバックアップを保存" [ref=e6] [cursor=pointer]
      - button "保留中の操作を取り消す" [ref=e7] [cursor=pointer]
    - alert [ref=e8]:
      - text: ダイアログ中の購入保存失敗
      - button "閉じる" [ref=e9] [cursor=pointer]
    - banner [ref=e10]:
      - generic [ref=e13]:
        - heading "整合性検証" [level=1] [ref=e14]
        - button "ホール定義（ブロック割当）" [ref=e15] [cursor=pointer]
        - button "表示項目の設定" [ref=e19] [cursor=pointer]
        - generic [ref=e20]:
          - button "📝" [ref=e21] [cursor=pointer]
          - button "🏃‍♂️" [ref=e22] [cursor=pointer]
          - button "🔍" [ref=e23] [cursor=pointer]
      - generic [ref=e25]:
        - button "イベント一覧" [ref=e26] [cursor=pointer]
        - button "1日目2" [ref=e27] [cursor=pointer]
        - button "アイテム追加" [ref=e28] [cursor=pointer]
        - generic [ref=e29]:
          - textbox "検索..." [ref=e30]
          - button "次を検索" [disabled] [ref=e31]
    - main [ref=e32]:
      - generic [ref=e34]:
        - generic [ref=e36]:
          - generic [ref=e37]:
            - generic [ref=e38]:
              - generic [ref=e39]: 訪問先
              - generic [ref=e40]: A-1
              - generic [ref=e41]:
                - generic [ref=e42]: サークル1
                - generic [ref=e43]: 1/1
            - generic [ref=e45]:
              - generic [ref=e46]: この訪問の支払額
              - generic [ref=e47]: ¥500
            - generic [ref=e49]:
              - generic [ref=e50]: フェーズ
              - combobox "phase" [ref=e51] [cursor=pointer]:
                - option "通常" [selected]
                - option "後回し"
                - option "遅参"
              - generic [ref=e52]: "次: A-2 サークル2"
          - generic [ref=e53]:
            - button "全購入" [pressed] [ref=e54] [cursor=pointer]
            - button "全売切" [ref=e55] [cursor=pointer]
            - button "全欠席" [ref=e56] [cursor=pointer]
            - button "全後回" [ref=e57] [cursor=pointer]
            - button "全遅参" [ref=e58] [cursor=pointer]
            - button "全限数" [ref=e59] [cursor=pointer]
        - generic [ref=e60]:
          - list "現在のスペースの品目" [ref=e61]:
            - listitem "A1 サークル1 新刊1" [ref=e65]:
              - generic [ref=e66]:
                - generic [ref=e67]:
                  - checkbox "Select item サークル1 - 新刊1" [ref=e68]
                  - button "削除のみ許可" [ref=e76] [cursor=pointer]: 🔒
                - generic [ref=e77]:
                  - generic [ref=e78]:
                    - generic [ref=e79]: 1日目
                    - generic [ref=e80]: A-1
                    - button "サークル1" [ref=e81] [cursor=pointer]
                  - button "新刊1" [ref=e84] [cursor=pointer]
                  - textbox "利用者メモ" [ref=e88]: ユーザー登録
                - generic [ref=e89]:
                  - 'button "Current status: 購入済. Click to change." [ref=e90] [cursor=pointer]':
                    - generic [ref=e93]: 購入済
                  - generic [ref=e94]:
                    - generic [ref=e95]: 数量
                    - combobox "購入予定数量" [ref=e96]:
                      - option "1" [selected]
                      - option "2"
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
                  - generic [ref=e97]:
                    - generic [ref=e98]: 購入金額
                    - generic [ref=e99]: ¥
                    - combobox "購入金額" [ref=e100]:
                      - option "価格未定"
                      - option "0"
                      - option "100"
                      - option "200"
                      - option "300"
                      - option "400"
                      - option "500" [selected]
                      - option "600"
                      - option "700"
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
          - button "+" [ref=e102] [cursor=pointer]
        - button "前の訪問先へ移動" [ref=e103] [cursor=pointer]: ◀
        - button "次の訪問先へ移動" [ref=e104] [cursor=pointer]: ▶
    - status "未保存"
  - contentinfo "集中モード操作" [ref=e105]:
    - generic [ref=e107]:
      - generic [ref=e108]:
        - generic [ref=e109]: "通常: 1/2"
        - generic [ref=e110]: (1/3)
      - generic [ref=e111]:
        - button "スペース一覧を開く" [ref=e112] [cursor=pointer]:
          - generic [ref=e113]: ▥
          - generic [ref=e114]: スペース一覧
        - generic [ref=e115]: 1 / 2 件購入済み
        - generic [ref=e116]:
          - generic [ref=e117]: "残りの合計:"
          - generic [ref=e118]: ¥500
        - button "スマートフォンモードに切替" [ref=e119] [cursor=pointer]
  - navigation "スペースナビゲーション" [ref=e122]:
    - slider "スペースナビ" [ref=e123]:
      - generic:
        - generic "A-1":
          - generic "正式な現在地"
        - generic "A-2"
        - generic "A-2"
  - dialog [ref=e125]:
    - generic [ref=e126]:
      - heading "新規アイテム追加" [level=2] [ref=e127]
      - paragraph [ref=e128]: 1日目 A-1
    - generic [ref=e129]:
      - generic [ref=e130]:
        - generic [ref=e131]:
          - generic [ref=e132]: サークル名 *
          - combobox "サークル名" [ref=e133]: サークル1
        - generic [ref=e134]:
          - generic [ref=e135]: タイトル
          - textbox "タイトル" [ref=e136]:
            - /placeholder: 新刊セット
      - generic [ref=e137]:
        - generic [ref=e138]:
          - generic [ref=e139]: 参加日
          - textbox "参加日" [ref=e140]: 1日目
        - generic [ref=e141]:
          - generic [ref=e142]: ブロック
          - textbox "ブロック" [ref=e143]: A
        - generic [ref=e144]:
          - generic [ref=e145]: ナンバー
          - textbox "ナンバー" [ref=e146]:
            - /placeholder: 01a
            - text: "1"
      - generic [ref=e147]:
        - generic [ref=e148]:
          - generic [ref=e149]: 購入金額
          - textbox "購入金額" [ref=e150]:
            - /placeholder: "0"
          - generic [ref=e151]: 円
        - generic [ref=e152]:
          - generic [ref=e153]: クイック選択
          - combobox "クイック選択" [ref=e154]:
            - option "金額を選択..." [disabled] [selected]
            - option "0円"
            - option "100円"
            - option "200円"
            - option "300円"
            - option "400円"
            - option "500円"
            - option "600円"
            - option "700円"
            - option "800円"
            - option "900円"
            - option "1,000円"
            - option "1,100円"
            - option "1,200円"
            - option "1,300円"
            - option "1,400円"
            - option "1,500円"
            - option "1,600円"
            - option "1,700円"
            - option "1,800円"
            - option "1,900円"
            - option "2,000円"
            - option "2,100円"
            - option "2,200円"
            - option "2,300円"
            - option "2,400円"
            - option "2,500円"
            - option "2,600円"
            - option "2,700円"
            - option "2,800円"
            - option "2,900円"
            - option "3,000円"
            - option "3,100円"
            - option "3,200円"
            - option "3,300円"
            - option "3,400円"
            - option "3,500円"
            - option "3,600円"
            - option "3,700円"
            - option "3,800円"
            - option "3,900円"
            - option "4,000円"
            - option "4,100円"
            - option "4,200円"
            - option "4,300円"
            - option "4,400円"
            - option "4,500円"
            - option "4,600円"
            - option "4,700円"
            - option "4,800円"
            - option "4,900円"
            - option "5,000円"
            - option "5,100円"
            - option "5,200円"
            - option "5,300円"
            - option "5,400円"
            - option "5,500円"
            - option "5,600円"
            - option "5,700円"
            - option "5,800円"
            - option "5,900円"
            - option "6,000円"
            - option "6,100円"
            - option "6,200円"
            - option "6,300円"
            - option "6,400円"
            - option "6,500円"
            - option "6,600円"
            - option "6,700円"
            - option "6,800円"
            - option "6,900円"
            - option "7,000円"
            - option "7,100円"
            - option "7,200円"
            - option "7,300円"
            - option "7,400円"
            - option "7,500円"
            - option "7,600円"
            - option "7,700円"
            - option "7,800円"
            - option "7,900円"
            - option "8,000円"
            - option "8,100円"
            - option "8,200円"
            - option "8,300円"
            - option "8,400円"
            - option "8,500円"
            - option "8,600円"
            - option "8,700円"
            - option "8,800円"
            - option "8,900円"
            - option "9,000円"
            - option "9,100円"
            - option "9,200円"
            - option "9,300円"
            - option "9,400円"
            - option "9,500円"
            - option "9,600円"
            - option "9,700円"
            - option "9,800円"
            - option "9,900円"
            - option "10,000円"
            - option "10,100円"
            - option "10,200円"
            - option "10,300円"
            - option "10,400円"
            - option "10,500円"
            - option "10,600円"
            - option "10,700円"
            - option "10,800円"
            - option "10,900円"
            - option "11,000円"
            - option "11,100円"
            - option "11,200円"
            - option "11,300円"
            - option "11,400円"
            - option "11,500円"
            - option "11,600円"
            - option "11,700円"
            - option "11,800円"
            - option "11,900円"
            - option "12,000円"
            - option "12,100円"
            - option "12,200円"
            - option "12,300円"
            - option "12,400円"
            - option "12,500円"
            - option "12,600円"
            - option "12,700円"
            - option "12,800円"
            - option "12,900円"
            - option "13,000円"
            - option "13,100円"
            - option "13,200円"
            - option "13,300円"
            - option "13,400円"
            - option "13,500円"
            - option "13,600円"
            - option "13,700円"
            - option "13,800円"
            - option "13,900円"
            - option "14,000円"
            - option "14,100円"
            - option "14,200円"
            - option "14,300円"
            - option "14,400円"
            - option "14,500円"
            - option "14,600円"
            - option "14,700円"
            - option "14,800円"
            - option "14,900円"
            - option "15,000円"
      - generic [ref=e155]:
        - generic [ref=e156]:
          - generic [ref=e157]: 数量
          - combobox "数量" [ref=e158]:
            - option "1" [selected]
            - option "2"
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
        - generic [ref=e159]:
          - generic [ref=e160]: 購入状態
          - combobox "購入状態" [ref=e161]:
            - option "購入済" [selected]
            - option "後回し"
            - option "遅参"
      - generic [ref=e162]:
        - generic [ref=e163]:
          - generic [ref=e164]: 利用者メモ
          - textbox "利用者メモ" [ref=e165]:
            - /placeholder: スケブお願い
        - generic [ref=e166]:
          - generic [ref=e167]: URL
          - textbox "URL" [ref=e168]:
            - /placeholder: https://example.com
    - generic [ref=e169]:
      - button "キャンセル" [ref=e170] [cursor=pointer]
      - button "リストに追加" [ref=e171] [cursor=pointer]
```

# Test source

```ts
  5629 |     Object.assign(globalThis, { __modalPurchaseGate: gate });
  5630 |     globalThis.addEventListener(
  5631 |       "message",
  5632 |       (event: MessageEvent<{ method?: string }>) => {
  5633 |         if (event.data.method) gate.calls.push(event.data.method);
  5634 |       },
  5635 |     );
  5636 |     let intercepted = false;
  5637 |     Object.defineProperty(IDBTransaction.prototype, "oncomplete", {
  5638 |       ...descriptor,
  5639 |       set(this: IDBTransaction, handler: IDBTransaction["oncomplete"]) {
  5640 |         if (
  5641 |           !intercepted &&
  5642 |           this.mode === "readonly" &&
  5643 |           this.objectStoreNames.contains("syncQueue")
  5644 |         ) {
  5645 |           intercepted = true;
  5646 |           descriptor.set!.call(this, (event: Event) => {
  5647 |             gate.ready = true;
  5648 |             gate.release = () => {
  5649 |               Object.defineProperty(
  5650 |                 IDBTransaction.prototype,
  5651 |                 "oncomplete",
  5652 |                 descriptor,
  5653 |               );
  5654 |               handler?.call(this, event);
  5655 |             };
  5656 |           });
  5657 |         } else descriptor.set!.call(this, handler);
  5658 |       },
  5659 |     });
  5660 |     IDBObjectStore.prototype.put = function (
  5661 |       ...args: Parameters<typeof originalPut>
  5662 |     ) {
  5663 |       if (
  5664 |         this.transaction.mode === "readwrite" &&
  5665 |         this.transaction.objectStoreNames.contains("eventConsistency")
  5666 |       ) {
  5667 |         IDBObjectStore.prototype.put = originalPut;
  5668 |         throw new DOMException("ダイアログ中の購入保存失敗", "AbortError");
  5669 |       }
  5670 |       return originalPut.apply(this, args);
  5671 |     };
  5672 |   });
  5673 | }
  5674 | 
  5675 | for (const kind of ["add", "phase"] as const) {
  5676 |   test(`OP05 late purchase failure keeps focus inside the focus-mode ${kind} dialog`, async ({
  5677 |     page,
  5678 |   }) => {
  5679 |     const source = backup([
  5680 |       item("1"),
  5681 |       { ...item("2"), purchaseStatus: "Postpone" },
  5682 |     ]);
  5683 |     await restore(page, source);
  5684 |     await page.getByTitle("集中モード", { exact: true }).click();
  5685 |     await expect(page.locator("#focus-mode-footer")).toBeVisible();
  5686 |     await gateNextPurchaseReadAndAbort(page);
  5687 |     await page
  5688 |       .locator('[data-item-id="1"]')
  5689 |       .getByRole("button", { name: /Current status:/ })
  5690 |       .click();
  5691 |     await expect
  5692 |       .poll(() =>
  5693 |         persistenceRealm(page).evaluate(
  5694 |           () =>
  5695 |             (
  5696 |               globalThis as typeof globalThis & {
  5697 |                 __modalPurchaseGate: { ready: boolean };
  5698 |               }
  5699 |             ).__modalPurchaseGate.ready,
  5700 |         ),
  5701 |       )
  5702 |       .toBe(true);
  5703 |     if (kind === "add")
  5704 |       await page
  5705 |         .getByTitle("新規アイテム追加", { exact: true })
  5706 |         .click();
  5707 |     else
  5708 |       await page.getByLabel("phase", { exact: true }).selectOption("postponed");
  5709 |     const dialog = page.getByRole("dialog", {
  5710 |       name: kind === "add" ? "新規アイテム追加" : "フェーズを切り替えますか？",
  5711 |       exact: true,
  5712 |     });
  5713 |     await expect(dialog).toBeVisible();
  5714 |     await persistenceRealm(page).evaluate(() =>
  5715 |       (
  5716 |         globalThis as typeof globalThis & {
  5717 |           __modalPurchaseGate: { release(): void };
  5718 |         }
  5719 |       ).__modalPurchaseGate.release(),
  5720 |     );
  5721 |     const pending = page
  5722 |       .getByRole("alert")
  5723 |       .filter({ hasText: "件の操作を未保存のまま保留しています" });
  5724 |     await expect(pending).toBeVisible();
  5725 |     await expect
  5726 |       .poll(() =>
  5727 |         dialog.evaluate((element) => element.contains(document.activeElement)),
  5728 |       )
> 5729 |       .toBe(true);
       |        ^ Error: expect(received).toBe(expected) // Object.is equality
  5730 |     const before = await persistenceRealm(page).evaluate(
  5731 |       () =>
  5732 |         (
  5733 |           globalThis as typeof globalThis & {
  5734 |             __modalPurchaseGate: { calls: string[] };
  5735 |           }
  5736 |         ).__modalPurchaseGate.calls.length,
  5737 |     );
  5738 |     for (let index = 0; index < 12; index++) {
  5739 |       await page.keyboard.press(index % 2 ? "Shift+Tab" : "Tab");
  5740 |       expect(
  5741 |         await dialog.evaluate((element) =>
  5742 |           element.contains(document.activeElement),
  5743 |         ),
  5744 |       ).toBe(true);
  5745 |     }
  5746 |     await dialog.evaluate((element: HTMLElement) => {
  5747 |       element.tabIndex = -1;
  5748 |       element.focus();
  5749 |     });
  5750 |     await page.keyboard.press("Enter");
  5751 |     await page.evaluate(
  5752 |       () =>
  5753 |         new Promise<void>((resolve) =>
  5754 |           requestAnimationFrame(() => setTimeout(resolve, 0)),
  5755 |         ),
  5756 |     );
  5757 |     expect(
  5758 |       await persistenceRealm(page).evaluate(
  5759 |         () =>
  5760 |           (
  5761 |             globalThis as typeof globalThis & {
  5762 |               __modalPurchaseGate: { calls: string[] };
  5763 |             }
  5764 |           ).__modalPurchaseGate.calls.length,
  5765 |       ),
  5766 |     ).toBe(before);
  5767 |     await expect(dialog).toBeVisible();
  5768 |     await page.keyboard.press("Escape");
  5769 |     await expect(dialog).toBeHidden();
  5770 |     await expect(
  5771 |       pending.getByRole("button", {
  5772 |         name: "保留中の保存を再試行",
  5773 |         exact: true,
  5774 |       }),
  5775 |     ).toBeFocused();
  5776 |     await pending
  5777 |       .getByRole("button", { name: "保留中の保存を再試行", exact: true })
  5778 |       .click();
  5779 |     await expect(pending).toBeHidden();
  5780 |     await expect
  5781 |       .poll(() => stored(page, "eventLists"))
  5782 |       .toMatchObject({
  5783 |         [eventName]: [
  5784 |           expect.objectContaining({ id: "1", purchaseStatus: "Purchased" }),
  5785 |           expect.objectContaining({ id: "2", purchaseStatus: "Postpone" }),
  5786 |         ],
  5787 |       });
  5788 |   });
  5789 | }
  5790 | 
```