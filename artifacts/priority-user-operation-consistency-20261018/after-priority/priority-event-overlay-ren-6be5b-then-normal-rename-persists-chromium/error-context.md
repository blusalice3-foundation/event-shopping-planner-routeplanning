# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: priority-event-overlay.spec.ts >> rename cancellation and unchanged-name submission close without changing the event, then normal rename persists
- Location: tests\browser\priority-event-overlay.spec.ts:77:1

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
  64  |   await expect(
  65  |     page.getByRole("heading", { name: "即売会名を変更" }),
  66  |   ).toBeVisible();
  67  | };
  68  | 
  69  | const openExport = async (page: Page) => {
  70  |   await page.getByRole("button", { name: "メニュー", exact: true }).click();
  71  |   await page.getByRole("button", { name: /Excel形式で出力/ }).click();
  72  |   await expect(
  73  |     page.getByRole("heading", { name: "エクスポート設定" }),
  74  |   ).toBeVisible();
  75  | };
  76  | 
  77  | test("rename cancellation and unchanged-name submission close without changing the event, then normal rename persists", async ({
  78  |   page,
  79  | }) => {
  80  |   const downloads: string[] = [];
  81  |   const errors: string[] = [];
  82  |   page.on("download", (download) =>
  83  |     downloads.push(download.suggestedFilename()),
  84  |   );
  85  |   page.on("pageerror", (error) => errors.push(error.message));
  86  |   await restoreAndOpenEventList(page);
  87  | 
  88  |   await openRename(page);
  89  |   await page.getByLabel("新しい即売会名").fill("取り消す名称");
  90  |   await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  91  |   await expect(
  92  |     page.getByRole("heading", { name: "即売会名を変更" }),
  93  |   ).toBeHidden();
  94  |   await expect(page.getByText(eventName, { exact: true })).toBeVisible();
  95  |   await expect(page.getByText("取り消す名称", { exact: true })).toHaveCount(0);
  96  |   expect(downloads).toEqual([]);
  97  | 
  98  |   await openRename(page);
  99  |   await expect(page.getByLabel("新しい即売会名")).toHaveValue(eventName);
  100 |   await page.getByRole("button", { name: "変更", exact: true }).click();
  101 |   await expect(
  102 |     page.getByRole("heading", { name: "即売会名を変更" }),
  103 |   ).toBeHidden();
  104 |   await expect(page.getByText(eventName, { exact: true })).toBeVisible();
  105 |   expect(downloads).toEqual([]);
  106 | 
  107 |   await page.reload();
  108 |   await openRename(page);
  109 |   await expect(page.getByLabel("新しい即売会名")).toHaveValue(eventName);
  110 |   const renamed = eventName + "変更後";
  111 |   await page.getByLabel("新しい即売会名").fill(renamed);
  112 |   await page.getByRole("button", { name: "変更", exact: true }).click();
  113 |   await expect(
  114 |     page.getByRole("heading", { name: "即売会名を変更" }),
> 115 |   ).toBeHidden();
      |     ^ Error: expect(locator).toBeHidden() failed
  116 |   await expect(page.getByText(renamed, { exact: true })).toBeVisible();
  117 |   await page.reload();
  118 |   await expect(page.getByText(renamed, { exact: true })).toBeVisible();
  119 |   await expect(page.getByText(eventName, { exact: true })).toHaveCount(0);
  120 |   expect(downloads).toEqual([]);
  121 |   expect(errors).toEqual([]);
  122 | });
  123 | 
  124 | test("export cancellation and close icon reopen without downloading, then the real Excel Worker exports and closes", async ({
  125 |   page,
  126 | }) => {
  127 |   const downloads: string[] = [];
  128 |   const errors: string[] = [];
  129 |   const workerUrls: string[] = [];
  130 |   page.on("download", (download) =>
  131 |     downloads.push(download.suggestedFilename()),
  132 |   );
  133 |   page.on("pageerror", (error) => errors.push(error.message));
  134 |   page.on("worker", (worker) => workerUrls.push(worker.url()));
  135 |   await restoreAndOpenEventList(page);
  136 | 
  137 |   await openExport(page);
  138 |   await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  139 |   await expect(
  140 |     page.getByRole("heading", { name: "エクスポート設定" }),
  141 |   ).toBeHidden();
  142 |   await expect(page.getByText(eventName, { exact: true })).toBeVisible();
  143 |   expect(downloads).toEqual([]);
  144 | 
  145 |   await openExport(page);
  146 |   await page
  147 |     .getByRole("heading", { name: "エクスポート設定" })
  148 |     .locator("..")
  149 |     .getByRole("button")
  150 |     .click();
  151 |   await expect(
  152 |     page.getByRole("heading", { name: "エクスポート設定" }),
  153 |   ).toBeHidden();
  154 |   await expect(page.getByText(eventName, { exact: true })).toBeVisible();
  155 |   expect(downloads).toEqual([]);
  156 | 
  157 |   await openExport(page);
  158 |   const downloading = page.waitForEvent("download");
  159 |   await page.getByRole("button", { name: "エクスポート", exact: true }).click();
  160 |   const download = await downloading;
  161 |   expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  162 |   expect(await download.failure()).toBeNull();
  163 |   await expect(
  164 |     page.getByRole("heading", { name: "エクスポート設定" }),
  165 |   ).toBeHidden();
  166 |   expect(workerUrls.some((url) => url.includes("xlsx.worker"))).toBe(true);
  167 |   const stream = await download.createReadStream();
  168 |   if (!stream) throw new Error("Excel download stream is missing");
  169 |   const chunks: Buffer[] = [];
  170 |   for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  171 |   const workbook = new ExcelJS.Workbook();
  172 |   await workbook.xlsx.load(Buffer.concat(chunks));
  173 |   const rows: string[] = [];
  174 |   workbook.eachSheet((sheet) =>
  175 |     sheet.eachRow((row) => rows.push(JSON.stringify(row.values))),
  176 |   );
  177 |   expect(rows.join("\n")).toContain(itemTitle);
  178 |   expect(rows.join("\n")).toContain("ユーザー登録");
  179 |   expect(downloads).toHaveLength(1);
  180 |   await expect(page.getByText(eventName, { exact: true })).toBeVisible();
  181 |   await openExport(page);
  182 |   await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  183 |   await expect(
  184 |     page.getByRole("heading", { name: "エクスポート設定" }),
  185 |   ).toBeHidden();
  186 |   expect(downloads).toHaveLength(1);
  187 |   expect(errors).toEqual([]);
  188 | });
  189 | 
```