# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cross-feature-consistency.spec.ts >> OP06 normalized planned draft matches visible select and durable quantity: 03 None
- Location: tests\browser\cross-feature-consistency.spec.ts:5559:5

# Error details

```
Error: expect(locator).toHaveValue(expected) failed

Locator:  getByRole('dialog', { name: 'アイテム編集', exact: true }).getByRole('combobox', { name: '数量', exact: true })
Expected: "3"
Received: "1"
Timeout:  5000ms

Call log:
  - Expect "toHaveValue" with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'アイテム編集', exact: true }).getByRole('combobox', { name: '数量', exact: true })
    14 × locator resolved to <select aria-label="数量" id=":r5:-quantity" class="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900 dark:text-white">…</select>
       - unexpected value "1"

```

```yaml
- combobox "数量":
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
```

# Test source

```ts
  5482 |       [eventName]: { "1日目": expectedIds },
  5483 |     });
  5484 |   });
  5485 | }
  5486 | 
  5487 | test("OP09: resumed phase synchronizes replacement postponed targets before recovering an empty old phase", async ({
  5488 |   page,
  5489 | }) => {
  5490 |   const source = backup([
  5491 |     item("1"),
  5492 |     { ...item("2"), purchaseStatus: "Postpone" },
  5493 |     item("4"),
  5494 |   ]);
  5495 |   source.data.dayModes[eventName]["1日目"] = "execute";
  5496 |   await restore(page, source);
  5497 |   await op09Postponed(page);
  5498 |   await page.getByTitle("編集モード", { exact: true }).click();
  5499 |   await op09Delete(page, "2");
  5500 |   await op09CardMenu(page, "4");
  5501 |   await page.getByRole("button", { name: "編集", exact: true }).click();
  5502 |   const editor = page.getByRole("dialog", {
  5503 |     name: "アイテム編集",
  5504 |     exact: true,
  5505 |   });
  5506 |   await editor.getByLabel("購入状態", { exact: true }).selectOption("Postpone");
  5507 |   await editor.getByRole("button", { name: "保存", exact: true }).click();
  5508 |   await expect(editor).toBeHidden();
  5509 |   await expect
  5510 |     .poll(
  5511 |       async () =>
  5512 |         (
  5513 |           (await stored(page, "eventLists"))[eventName] as Array<{
  5514 |             id: string;
  5515 |             purchaseStatus: string;
  5516 |           }>
  5517 |         ).find((value) => value.id === "4")?.purchaseStatus,
  5518 |     )
  5519 |     .toBe("Postpone");
  5520 |   await page.evaluate(() => {
  5521 |     const trace = { completionScreens: 0 };
  5522 |     Object.assign(window, { __op09ResumeTrace: trace });
  5523 |     const observer = new MutationObserver(() => {
  5524 |       if (document.body.textContent?.includes("全ての訪問先を確認しました"))
  5525 |         trace.completionScreens++;
  5526 |     });
  5527 |     observer.observe(document.body, { childList: true, subtree: true });
  5528 |   });
  5529 |   await page.getByRole("button", { name: "🏃‍♂️", exact: true }).click();
  5530 |   await page.getByTitle("集中モード", { exact: true }).click();
  5531 |   await expect(page.getByLabel("phase", { exact: true })).toHaveValue(
  5532 |     "postponed",
  5533 |   );
  5534 |   await expect(page.locator('[data-item-id="4"]')).toBeVisible();
  5535 |   await expect(page.locator('[data-item-id="2"]')).toHaveCount(0);
  5536 |   await expect(
  5537 |     page.getByText("全ての訪問先を確認しました", { exact: true }),
  5538 |   ).toHaveCount(0);
  5539 |   expect(
  5540 |     await page.evaluate(
  5541 |       () =>
  5542 |         (
  5543 |           window as typeof window & {
  5544 |             __op09ResumeTrace: { completionScreens: number };
  5545 |           }
  5546 |         ).__op09ResumeTrace.completionScreens,
  5547 |     ),
  5548 |   ).toBe(0);
  5549 |   // The replacement captured set must also recover when its own last member disappears.
  5550 |   await op09Delete(page, "4");
  5551 |   await expect(
  5552 |     page.getByText("全ての訪問先を確認しました", { exact: true }),
  5553 |   ).toBeVisible();
  5554 |   expect((await stored(page, "eventLists"))[eventName]).toEqual([item("1")]);
  5555 | });
  5556 | 
  5557 | for (const planned of ["3", "03"]) {
  5558 |   for (const status of ["None", "Purchased"]) {
  5559 |     test(`OP06 normalized planned draft matches visible select and durable quantity: ${planned} ${status}`, async ({
  5560 |       page,
  5561 |     }) => {
  5562 |       await restore(page, backup([item("1")]));
  5563 |       await editMemo(page, "数量の往復入力を保持");
  5564 |       const editor = page.getByRole("dialog", {
  5565 |         name: "アイテム編集",
  5566 |         exact: true,
  5567 |       });
  5568 |       const purchaseStatus = editor.getByRole("combobox", {
  5569 |         name: "購入状態",
  5570 |         exact: true,
  5571 |       });
  5572 |       await purchaseStatus.selectOption("LimitedPurchase");
  5573 |       await editor
  5574 |         .getByRole("textbox", { name: "購入予定量", exact: true })
  5575 |         .fill(planned);
  5576 |       await editor
  5577 |         .getByRole("textbox", { name: "実購入数", exact: true })
  5578 |         .fill("2");
  5579 |       await purchaseStatus.selectOption(status);
  5580 |       await expect(
  5581 |         editor.getByRole("combobox", { name: "数量", exact: true }),
> 5582 |       ).toHaveValue("3");
       |         ^ Error: expect(locator).toHaveValue(expected) failed
  5583 |       await purchaseStatus.selectOption("LimitedPurchase");
  5584 |       await expect(
  5585 |         editor.getByRole("textbox", { name: "実購入数", exact: true }),
  5586 |       ).toHaveValue("2");
  5587 |       await purchaseStatus.selectOption(status);
  5588 |       const quantity = editor.getByRole("combobox", {
  5589 |         name: "数量",
  5590 |         exact: true,
  5591 |       });
  5592 |       await expect(quantity).toHaveValue("3");
  5593 |       await expect(quantity.locator("option:checked")).toHaveText("3");
  5594 |       await editor.getByRole("button", { name: "保存", exact: true }).click();
  5595 |       await expect(editor).toBeHidden();
  5596 |       const expected = {
  5597 |         id: "1",
  5598 |         quantity: 3,
  5599 |         purchaseStatus: status,
  5600 |         remarks: "数量の往復入力を保持",
  5601 |       };
  5602 |       await expect
  5603 |         .poll(() => stored(page, "eventLists"))
  5604 |         .toMatchObject({ [eventName]: [expect.objectContaining(expected)] });
  5605 |       await page.reload();
  5606 |       await page.getByText(eventName, { exact: true }).click();
  5607 |       await editMemo(page, "数量の往復入力を保持");
  5608 |       await expect(
  5609 |         editor.getByRole("combobox", { name: "数量", exact: true }),
  5610 |       ).toHaveValue("3");
  5611 |       expect(await stored(page, "eventLists")).toMatchObject({
  5612 |         [eventName]: [expect.objectContaining(expected)],
  5613 |       });
  5614 |       await editor
  5615 |         .getByRole("button", { name: "キャンセル", exact: true })
  5616 |         .click();
  5617 |     });
  5618 |   }
  5619 | }
  5620 | 
  5621 | async function gateNextPurchaseReadAndAbort(page: Page) {
  5622 |   await persistenceRealm(page).evaluate(() => {
  5623 |     const descriptor = Object.getOwnPropertyDescriptor(
  5624 |       IDBTransaction.prototype,
  5625 |       "oncomplete",
  5626 |     )!;
  5627 |     const originalPut = IDBObjectStore.prototype.put;
  5628 |     const gate = { ready: false, calls: [] as string[], release: () => {} };
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
  5681 |       { ...item("2"), purchaseStatus: "Postponed" },
  5682 |     ]);
```