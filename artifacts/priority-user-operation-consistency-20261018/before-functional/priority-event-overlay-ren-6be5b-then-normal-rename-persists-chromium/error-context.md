# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: priority-event-overlay.spec.ts >> rename cancellation and unchanged-name submission close without changing the event, then normal rename persists
- Location: tests\browser\priority-event-overlay.spec.ts:73:1

# Error details

```
Error: expect(locator).toBeHidden() failed

Locator:  getByRole('heading', { name: '即売会名を変更' })
Expected: hidden
Received: visible
Timeout:  5000ms

Call log:
  - Expect "toBeHidden" with timeout 5000ms
  - waiting for getByRole('heading', { name: '即売会名を変更' })
    14 × locator resolved to <h2 class="text-xl font-bold text-slate-900 dark:text-white mb-4">即売会名を変更</h2>
       - unexpected value "visible"

```

```yaml
- heading "即売会名を変更" [level=2]
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | import ExcelJS from "exceljs";
  3   | 
  4   | const eventName = "閉じる操作検証";
  5   | const itemTitle = "出力する新刊";
  6   | const backup = {
  7   |   kind: "event-shopping-planner-backup",
  8   |   version: 1,
  9   |   exportedAt: "2026-10-18T00:00:00.000Z",
  10  |   eventSettings: { blockDetectionSettings: {} },
  11  |   data: {
  12  |     eventLists: {
  13  |       [eventName]: [
  14  |         {
  15  |           id: "overlay-item",
  16  |           circle: "出力するサークル",
  17  |           title: itemTitle,
  18  |           eventDate: "1日目",
  19  |           block: "A",
  20  |           number: "1",
  21  |           price: 500,
  22  |           purchaseStatus: "None",
  23  |           quantity: 1,
  24  |           remarks: "ユーザー登録",
  25  |         },
  26  |       ],
  27  |     },
  28  |     eventMetadata: {},
  29  |     executeModeItems: { [eventName]: { "1日目": ["overlay-item"] } },
  30  |     dayModes: { [eventName]: { "1日目": "edit" } },
  31  |     mapData: {},
  32  |     mapRotationSettings: {},
  33  |     mapViewportSettings: {},
  34  |     routeSettings: {},
  35  |     hallDefinitions: {},
  36  |     hallRouteSettings: {},
  37  |   },
  38  | };
  39  | 
  40  | const restoreAndOpenEventList = async (page: Page) => {
  41  |   await page.goto("/");
  42  |   await page
  43  |     .locator('input[aria-label="バックアップファイルを選択"]')
  44  |     .setInputFiles({
  45  |       name: "event-overlay.json",
  46  |       mimeType: "application/json",
  47  |       buffer: Buffer.from(JSON.stringify(backup), "utf8"),
  48  |     });
  49  |   const dialog = page.getByRole("dialog", {
  50  |     name: "バックアップからイベントを復元",
  51  |   });
  52  |   await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  53  |   await dialog.getByRole("button", { name: "置換して復元" }).click();
  54  |   await expect(dialog).toBeHidden();
  55  |   await expect(
  56  |     page.getByRole("heading", { name: eventName, exact: true }),
  57  |   ).toBeVisible();
  58  |   await page.getByRole("button", { name: "イベント一覧", exact: true }).click();
  59  | };
  60  | 
  61  | const openRename = async (page: Page) => {
  62  |   await page.getByRole("button", { name: "メニュー", exact: true }).click();
  63  |   await page.getByRole("button", { name: /名称変更/ }).click();
  64  |   await expect(page.getByRole("heading", { name: "即売会名を変更" })).toBeVisible();
  65  | };
  66  | 
  67  | const openExport = async (page: Page) => {
  68  |   await page.getByRole("button", { name: "メニュー", exact: true }).click();
  69  |   await page.getByRole("button", { name: /Excel形式で出力/ }).click();
  70  |   await expect(page.getByRole("heading", { name: "エクスポート設定" })).toBeVisible();
  71  | };
  72  | 
  73  | test("rename cancellation and unchanged-name submission close without changing the event, then normal rename persists", async ({
  74  |   page,
  75  | }) => {
  76  |   const downloads: string[] = [];
  77  |   const errors: string[] = [];
  78  |   page.on("download", (download) => downloads.push(download.suggestedFilename()));
  79  |   page.on("pageerror", (error) => errors.push(error.message));
  80  |   await restoreAndOpenEventList(page);
  81  | 
  82  |   await openRename(page);
  83  |   await page.getByLabel("新しい即売会名").fill("取り消す名称");
  84  |   await page.getByRole("button", { name: "キャンセル", exact: true }).click();
> 85  |   await expect(page.getByRole("heading", { name: "即売会名を変更" })).toBeHidden();
      |                                                                ^ Error: expect(locator).toBeHidden() failed
  86  |   await expect(page.getByText(eventName, { exact: true })).toBeVisible();
  87  |   await expect(page.getByText("取り消す名称", { exact: true })).toHaveCount(0);
  88  |   expect(downloads).toEqual([]);
  89  | 
  90  |   await openRename(page);
  91  |   await expect(page.getByLabel("新しい即売会名")).toHaveValue(eventName);
  92  |   await page.getByRole("button", { name: "変更", exact: true }).click();
  93  |   await expect(page.getByRole("heading", { name: "即売会名を変更" })).toBeHidden();
  94  |   await expect(page.getByText(eventName, { exact: true })).toBeVisible();
  95  |   expect(downloads).toEqual([]);
  96  | 
  97  |   await page.reload();
  98  |   await openRename(page);
  99  |   await expect(page.getByLabel("新しい即売会名")).toHaveValue(eventName);
  100 |   const renamed = eventName + "変更後";
  101 |   await page.getByLabel("新しい即売会名").fill(renamed);
  102 |   await page.getByRole("button", { name: "変更", exact: true }).click();
  103 |   await expect(page.getByRole("heading", { name: "即売会名を変更" })).toBeHidden();
  104 |   await expect(page.getByText(renamed, { exact: true })).toBeVisible();
  105 |   await page.reload();
  106 |   await expect(page.getByText(renamed, { exact: true })).toBeVisible();
  107 |   await expect(page.getByText(eventName, { exact: true })).toHaveCount(0);
  108 |   expect(downloads).toEqual([]);
  109 |   expect(errors).toEqual([]);
  110 | });
  111 | 
  112 | test("export cancellation and close icon reopen without downloading, then the real Excel Worker exports and closes", async ({
  113 |   page,
  114 | }) => {
  115 |   const downloads: string[] = [];
  116 |   const errors: string[] = [];
  117 |   const workerUrls: string[] = [];
  118 |   page.on("download", (download) => downloads.push(download.suggestedFilename()));
  119 |   page.on("pageerror", (error) => errors.push(error.message));
  120 |   page.on("worker", (worker) => workerUrls.push(worker.url()));
  121 |   await restoreAndOpenEventList(page);
  122 | 
  123 |   await openExport(page);
  124 |   await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  125 |   await expect(page.getByRole("heading", { name: "エクスポート設定" })).toBeHidden();
  126 |   await expect(page.getByText(eventName, { exact: true })).toBeVisible();
  127 |   expect(downloads).toEqual([]);
  128 | 
  129 |   await openExport(page);
  130 |   await page
  131 |     .getByRole("heading", { name: "エクスポート設定" })
  132 |     .locator("..")
  133 |     .getByRole("button")
  134 |     .click();
  135 |   await expect(page.getByRole("heading", { name: "エクスポート設定" })).toBeHidden();
  136 |   await expect(page.getByText(eventName, { exact: true })).toBeVisible();
  137 |   expect(downloads).toEqual([]);
  138 | 
  139 |   await openExport(page);
  140 |   const downloading = page.waitForEvent("download");
  141 |   await page.getByRole("button", { name: "エクスポート", exact: true }).click();
  142 |   const download = await downloading;
  143 |   expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  144 |   expect(await download.failure()).toBeNull();
  145 |   await expect(page.getByRole("heading", { name: "エクスポート設定" })).toBeHidden();
  146 |   expect(workerUrls.some((url) => url.includes("xlsx.worker"))).toBe(true);
  147 |   const stream = await download.createReadStream();
  148 |   if (!stream) throw new Error("Excel download stream is missing");
  149 |   const chunks: Buffer[] = [];
  150 |   for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  151 |   const workbook = new ExcelJS.Workbook();
  152 |   await workbook.xlsx.load(Buffer.concat(chunks));
  153 |   const rows: string[] = [];
  154 |   workbook.eachSheet((sheet) =>
  155 |     sheet.eachRow((row) => rows.push(JSON.stringify(row.values))),
  156 |   );
  157 |   expect(rows.join("\n")).toContain(itemTitle);
  158 |   expect(rows.join("\n")).toContain("ユーザー登録");
  159 |   expect(downloads).toHaveLength(1);
  160 |   await expect(page.getByText(eventName, { exact: true })).toBeVisible();
  161 |   await openExport(page);
  162 |   await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  163 |   await expect(page.getByRole("heading", { name: "エクスポート設定" })).toBeHidden();
  164 |   expect(downloads).toHaveLength(1);
  165 |   expect(errors).toEqual([]);
  166 | });
  167 | 
```