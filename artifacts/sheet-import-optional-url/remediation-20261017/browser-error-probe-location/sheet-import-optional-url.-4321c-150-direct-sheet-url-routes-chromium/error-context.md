# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sheet-import-optional-url.measurement.spec.ts >> sheet optional URL real-browser route measurements >> import: 150 direct @sheet-url-routes
- Location: tests\browser\sheet-import-optional-url.measurement.spec.ts:613:9

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 26

- Array []
+ Array [
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+   "{\"message\":\"Failed to load resource: the server responded with a status of 404 (Not Found)\",\"location\":{\"url\":\"http://127.0.0.1:4173/api/persistence-release-a-metrics\",\"line\":0,\"column\":0,\"lineNumber\":0,\"columnNumber\":0}}",
+ ]
```

# Test source

```ts
  772 |                         join(
  773 |                           fixedInputs!,
  774 |                           `restore-${count}-${mode}-blank=true.xlsx`,
  775 |                         ),
  776 |                       )
  777 |                     : undefined;
  778 |                 detail = await restore(page, count, false, bytes);
  779 |               } else if (route.startsWith("startup")) {
  780 |                 await restore(page, count, false);
  781 |                 const state = route.slice("startup-".length);
  782 |                 await seedStartup(
  783 |                   page,
  784 |                   ["B02", "B04", "B05", "B06"].includes(state),
  785 |                   ["B03", "B04", "B05", "B06"].includes(state),
  786 |                 );
  787 |                 await page.addInitScript(installPersistenceProbe, {
  788 |                   abortFirstAtomic: state === "B06",
  789 |                   eventName: SHEET_EVENT,
  790 |                 });
  791 |                 if (state === "B05") {
  792 |                   await page.reload();
  793 |                   await expect(
  794 |                     page.getByRole("listitem").filter({ hasText: SHEET_EVENT }),
  795 |                   ).toBeVisible();
  796 |                   await assertStartupWrites(page, "B04", mode);
  797 |                 }
  798 |                 abortStartup = state === "B06";
  799 |                 const start = performance.now();
  800 |                 await page.reload();
  801 |                 let failureMs = 0;
  802 |                 let retryMs = 0;
  803 |                 if (state === "B06") {
  804 |                   const retry = page.getByRole("button", {
  805 |                     name: "読み込みを再試行",
  806 |                     exact: true,
  807 |                   });
  808 |                   await expect(retry).toBeVisible();
  809 |                   failureMs = performance.now() - start;
  810 |                   const retryStart = performance.now();
  811 |                   await retry.click();
  812 |                   await expect(
  813 |                     page.getByRole("listitem").filter({ hasText: SHEET_EVENT }),
  814 |                   ).toBeVisible();
  815 |                   retryMs = performance.now() - retryStart;
  816 |                 } else
  817 |                   await expect(
  818 |                     page.getByRole("listitem").filter({ hasText: SHEET_EVENT }),
  819 |                   ).toBeVisible();
  820 |                 detail = {
  821 |                   durationMs: performance.now() - start,
  822 |                   failureMs,
  823 |                   retryMs,
  824 |                   ...(await assertStartupWrites(page, state, mode)),
  825 |                 };
  826 |                 const savedItems = (
  827 |                   (await stored(page, "eventLists")) as Record<
  828 |                     string,
  829 |                     Array<{ url?: unknown }>
  830 |                   >
  831 |                 )[SHEET_EVENT];
  832 |                 expect(
  833 |                   savedItems.every((item) =>
  834 |                     legacyStartup
  835 |                       ? Object.prototype.hasOwnProperty.call(item, "url") &&
  836 |                         item.url === ""
  837 |                       : !Object.prototype.hasOwnProperty.call(item, "url"),
  838 |                   ),
  839 |                 ).toBe(true);
  840 |               } else {
  841 |                 await restore(page, count, false, undefined, true);
  842 |                 const editor = await openEditor(page);
  843 |                 await editor
  844 |                   .getByRole("textbox", { name: "購入金額", exact: true })
  845 |                   .fill("900");
  846 |                 await editor
  847 |                   .getByRole("textbox", { name: "利用者メモ", exact: true })
  848 |                   .fill("再試行を確認");
  849 |                 await resetProbe(page);
  850 |                 await abortOnce(page, mode);
  851 |                 await editor
  852 |                   .getByRole("button", { name: "保存", exact: true })
  853 |                   .click();
  854 |                 const retained = page
  855 |                   .getByRole("alert")
  856 |                   .filter({ hasText: "件の操作を未保存のまま保留しています" });
  857 |                 await expect(retained).toBeVisible();
  858 |                 const start = performance.now();
  859 |                 await retained
  860 |                   .getByRole("button", {
  861 |                     name: "保留中の保存を再試行",
  862 |                     exact: true,
  863 |                   })
  864 |                   .click();
  865 |                 await expect(retained).toBeHidden();
  866 |                 await expect(editor).toBeHidden();
  867 |                 detail = { durationMs: performance.now() - start };
  868 |               }
  869 |               expect(runtimeErrors).toEqual([]);
  870 |               const injectedFailure =
  871 |                 route === "retry" || route === "startup-B06";
> 872 |               if (!injectedFailure) expect(consoleErrors).toEqual([]);
      |                                                           ^ Error: expect(received).toEqual(expected) // deep equality
  873 |               samples.push({
  874 |                 runtimeErrors,
  875 |                 consoleErrors,
  876 |                 consoleErrorContext: injectedFailure
  877 |                   ? "storage-failure-injected"
  878 |                   : "normal",
  879 |                 phase,
  880 |                 count,
  881 |                 mode,
  882 |                 route,
  883 |                 iteration,
  884 |                 evidenceEligible: repeats >= 20,
  885 |                 ...(legacyStartup
  886 |                   ? { sourceBaseline: "cc475cd", legacyStartup: true }
  887 |                   : {}),
  888 |                 ...detail,
  889 |                 ...(route.startsWith("startup")
  890 |                   ? {}
  891 |                   : await collectProbe(page)),
  892 |               });
  893 |             } finally {
  894 |               await context.close();
  895 |             }
  896 |           }
  897 |           await writeFile(
  898 |             testInfo.outputPath("sheet-url-route-timings.json"),
  899 |             JSON.stringify(samples, null, 2),
  900 |             "utf8",
  901 |           );
  902 |           expect(samples).toHaveLength(repeats);
  903 |         });
  904 |       }
  905 | });
  906 | 
```