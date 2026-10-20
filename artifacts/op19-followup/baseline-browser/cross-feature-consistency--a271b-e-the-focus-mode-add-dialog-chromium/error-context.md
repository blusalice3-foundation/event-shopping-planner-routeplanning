# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cross-feature-consistency.spec.ts >> OP05 late purchase failure keeps focus inside the focus-mode add dialog
- Location: tests\browser\cross-feature-consistency.spec.ts:5676:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('dialog', { name: 'バックアップからイベントを復元' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'バックアップからイベントを復元' })

```

```yaml
- banner:
  - heading "即売会購入巡回表" [level=1]
  - button "表示項目の設定":
    - img
  - button "イベント一覧"
  - button "新規リスト作成"
- main:
  - heading "保存されたリストはありません" [level=2]
  - paragraph: 「新規リスト作成」から新しいイベントの巡回表を作成してください。
  - button "Excelファイルを取り込み":
    - img
    - text: Excelファイルを取り込み
  - button "JSONバックアップ保存":
    - img
    - text: JSONバックアップ保存
  - button "JSONバックアップ復元":
    - img
    - text: JSONバックアップ復元
- status "保存済み"
```

# Test source

```ts
  1   | import {
  2   |   DAY_RECORD_PREFIX,
  3   |   dayRecordRootDigestKey,
  4   |   partitionDayRecordStore,
  5   | } from "../../src/persistence/db/dayRecordStorage";
  6   | import ExcelJS from "exceljs";
  7   | import type { PersistenceSnapshot } from "../../src/app/ports/PersistenceCommandPort";
  8   | import { planEventRestore } from "../../src/features/consistency/domain/eventMutations";
  9   | import { duplicateEventDays } from "../../src/features/consistency/domain/dayMerge";
  10  | import { createAppBackup } from "../../src/utils/appBackup";
  11  | import { migrateLegacyConsistency } from "../../src/features/consistency/domain/migration";
  12  | import type { EventConsistencyStore } from "../../src/types/consistency";
  13  | import { expect, test, type Page } from "@playwright/test";
  14  | import {
  15  |   createNextPersistenceCheckpoint,
  16  |   prepareMetadataForPayload,
  17  |   type StoredPersistenceMetadata,
  18  | } from "../../src/persistence/internal/persistenceCore";
  19  | import {
  20  |   createPersistenceMetadataKey,
  21  |   createPersistenceCheckpointKey,
  22  |   type PersistenceCheckpoint,
  23  | } from "../../src/utils/persistenceResilience";
  24  | 
  25  | const eventName = "整合性検証";
  26  | const item = (id: string, eventDate = "1日目") => ({
  27  |   id,
  28  |   eventDate,
  29  |   circle: "サークル" + id,
  30  |   title: "新刊" + id,
  31  |   block: "A",
  32  |   number: id,
  33  |   price: 500,
  34  |   purchaseStatus: "None",
  35  |   quantity: 1,
  36  |   remarks: "ユーザー登録",
  37  | });
  38  | const backup = (items = [item("1"), item("2", "2日目")]) => ({
  39  |   kind: "event-shopping-planner-backup",
  40  |   version: 1,
  41  |   exportedAt: "2026-09-28T00:00:00.000Z",
  42  |   eventSettings: { blockDetectionSettings: {} },
  43  |   data: {
  44  |     eventLists: { [eventName]: items },
  45  |     eventMetadata: {},
  46  |     executeModeItems: {
  47  |       [eventName]: {
  48  |         "1日目": items
  49  |           .filter((value) => value.eventDate === "1日目")
  50  |           .map((value) => value.id),
  51  |         "2日目": items
  52  |           .filter((value) => value.eventDate === "2日目")
  53  |           .map((value) => value.id),
  54  |       },
  55  |     },
  56  |     dayModes: { [eventName]: { "1日目": "edit", "2日目": "edit" } },
  57  |     mapData: {},
  58  |     mapRotationSettings: {},
  59  |     mapViewportSettings: {},
  60  |     routeSettings: {},
  61  |     hallDefinitions: {},
  62  |     hallRouteSettings: {},
  63  |   },
  64  | });
  65  | async function restore(
  66  |   page: Page,
  67  |   data: unknown = backup(),
  68  |   reviewTitle?: string,
  69  |   expectedEventName = eventName,
  70  | ) {
  71  |   await page.goto("/");
  72  |   await page
  73  |     .locator('input[aria-label="バックアップファイルを選択"]')
  74  |     .setInputFiles({
  75  |       name: "consistency.json",
  76  |       mimeType: "application/json",
  77  |       buffer: Buffer.from(JSON.stringify(data), "utf8"),
  78  |     });
  79  |   const dialog = page.getByRole("dialog", {
  80  |     name: "バックアップからイベントを復元",
  81  |   });
> 82  |   await expect(dialog).toBeVisible();
      |                        ^ Error: expect(locator).toBeVisible() failed
  83  |   await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  84  |   await dialog.getByRole("button", { name: "置換して復元" }).click();
  85  |   if (reviewTitle) {
  86  |     const review = page.getByRole("dialog", { name: reviewTitle, exact: true });
  87  |     await expect(review).toBeVisible();
  88  |     await review
  89  |       .getByRole("button", { name: "確認して保存", exact: true })
  90  |       .click();
  91  |     await expect(review).toBeHidden();
  92  |   }
  93  |   await expect(dialog).toBeHidden();
  94  |   await expect(
  95  |     page.getByRole("heading", { name: expectedEventName, exact: true }),
  96  |   ).toBeVisible();
  97  | }
  98  | function persistenceRealm(page: Page) {
  99  |   const worker = page
  100 |     .workers()
  101 |     .find((candidate) => candidate.url().includes("persistence.worker"));
  102 |   if (!worker) throw new Error("The persistence worker has not started.");
  103 |   return worker;
  104 | }
  105 | async function stored(page: Page, store: string, key = "data", asJson = false) {
  106 |   const value = await page.evaluate(
  107 |     async ({ name, key, asJson }) => {
  108 |       const database = await new Promise<IDBDatabase>((resolve, reject) => {
  109 |         const request = indexedDB.open("EventShoppingPlannerDB");
  110 |         request.onsuccess = () => resolve(request.result);
  111 |         request.onerror = () => reject(request.error);
  112 |       });
  113 |       try {
  114 |         return await new Promise<unknown>((resolve, reject) => {
  115 |           const store = database
  116 |             .transaction(name, "readonly")
  117 |             .objectStore(name);
  118 |           const request = store.get(key);
  119 |           request.onsuccess = () => {
  120 |             const head = request.result;
  121 |             if (
  122 |               key !== "data" ||
  123 |               head?.kind !== "event-shopping-planner-day-records"
  124 |             ) {
  125 |               resolve(asJson ? JSON.stringify(head) : head);
  126 |               return;
  127 |             }
  128 |             const prefix = "__esp_internal__:day-record:v1:";
  129 |             const rows: Array<{
  130 |               eventName: string;
  131 |               path: string[];
  132 |               value: unknown;
  133 |             }> = [];
  134 |             const cursor = store.openCursor(
  135 |               IDBKeyRange.bound(prefix, prefix + "\uffff"),
  136 |             );
  137 |             cursor.onerror = () => reject(cursor.error);
  138 |             cursor.onsuccess = () => {
  139 |               const row = cursor.result;
  140 |               if (row) {
  141 |                 rows.push(row.value);
  142 |                 row.continue();
  143 |                 return;
  144 |               }
  145 |               const data: Record<string, Record<string, unknown>> = {};
  146 |               for (const row of rows.filter((row) => !row.path.length))
  147 |                 Object.defineProperty(data, row.eventName, {
  148 |                   value: row.value,
  149 |                   enumerable: true,
  150 |                 });
  151 |               for (const row of rows.filter((row) => row.path.length)) {
  152 |                 const parent =
  153 |                   row.path.length === 2
  154 |                     ? (data[row.eventName].days as Record<string, unknown>)
  155 |                     : data[row.eventName];
  156 |                 Object.defineProperty(parent, row.path.at(-1)!, {
  157 |                   value: row.value,
  158 |                   enumerable: true,
  159 |                 });
  160 |               }
  161 |               resolve(asJson ? JSON.stringify(data) : data);
  162 |             };
  163 |           };
  164 |           request.onerror = () => reject(request.error);
  165 |         });
  166 |       } finally {
  167 |         database.close();
  168 |       }
  169 |     },
  170 |     { name: store, key, asJson },
  171 |   );
  172 |   return asJson ? JSON.parse(value as string) : value;
  173 | }
  174 | async function storedMaps(page: Page) {
  175 |   return page.evaluate(async () => {
  176 |     const database = await new Promise<IDBDatabase>((resolve, reject) => {
  177 |       const request = indexedDB.open("EventShoppingPlannerDB");
  178 |       request.onsuccess = () => resolve(request.result);
  179 |       request.onerror = () => reject(request.error);
  180 |     });
  181 |     try {
  182 |       return await new Promise<Record<string, Record<string, unknown>>>(
```