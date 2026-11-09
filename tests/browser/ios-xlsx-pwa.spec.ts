import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { addInflateRegressionPart } from "../../src/xlsx/fixtures/inflateWindowWrap";
import {
  confirmRestore,
  eventName,
  exportBackup,
  item,
  launch,
  readRuntimeIdentity,
  xlsxMime,
} from "./ios-xlsx-helpers";

// No request interception: this must use the product Worker cached by the
// installed Service Worker. Physical iPhone/PWA validation remains separate.
test.use({ serviceWorkers: "allow" });
test.describe.configure({ timeout: 60_000 });

test("@ios-compat controlled offline PWA imports the fixed inflate corpus through the cached product Worker", async ({
  page,
  context,
}, testInfo) => {
  const trace = await launch(page, false, false);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  const identity = await readRuntimeIdentity(page);
  expect(identity.sourceSha).toMatch(/^[0-9a-f]{40}$/);
  expect(identity.variantId).toMatch(/^[0-9a-f]{64}$/);
  expect(identity.controller).toMatch(/\/sw\.js$/);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("アイテムデータ");
  sheet.addRow([
    "ID",
    "サークル",
    "参加日",
    "ブロック",
    "番号",
    "タイトル",
    "価格",
    "数量",
    "購入状況",
    "備考",
  ]);
  sheet.addRow([
    item.id,
    item.circle,
    item.eventDate,
    item.block,
    item.number,
    item.title,
    item.price,
    item.quantity,
    item.purchaseStatus,
    item.remarks,
  ]);
  const metadata = book.addWorksheet("メタデータ");
  metadata.addRow(["key", "value"]);
  metadata.addRow(["eventName", eventName]);
  metadata.addRow(["version", "1.0"]);
  const bytes = Buffer.from(
    addInflateRegressionPart(new Uint8Array(await book.xlsx.writeBuffer())),
  );
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#loading-screen")).toBeHidden();
    expect(await readRuntimeIdentity(page)).toEqual(identity);
    await page
      .locator('input[aria-label="Excelファイルを選択"]')
      .setInputFiles({
        name: "offline-inflate-regression.xlsx",
        mimeType: xlsxMime,
        buffer: bytes,
      });
    await confirmRestore(page, eventName);
    const saved = await exportBackup(page);
    expect(saved.data.eventLists[eventName]).toEqual([
      expect.objectContaining(item),
    ]);
    const traces = await trace.verify(1, testInfo, 2);
    expect(traces.flatMap((worker) => worker.responses)).toEqual([
      { type: "XLSX_IMPORT_RESULT", kind: "event-import" },
    ]);
    const workerUrl = traces[0].url;
    const cachedWorker = await page.evaluate(async (url) => {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`cached Worker HTTP ${response.status}`);
      return [...new Uint8Array(await response.arrayBuffer())];
    }, workerUrl);
    await testInfo.attach("offline-worker-build-correspondence", {
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify({
          identity,
          workerUrl,
          workerSha256: createHash("sha256")
            .update(new Uint8Array(cachedWorker))
            .digest("hex"),
          inputSha256: createHash("sha256").update(bytes).digest("hex"),
          physicalDevice: false,
          updateAcrossBuildsVerified: false,
        }),
      ),
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#loading-screen")).toBeHidden();
    const reloaded = await exportBackup(page);
    expect(reloaded.data).toEqual(saved.data);
    expect(reloaded.eventSettings).toEqual(saved.eventSettings);
    expect(await readRuntimeIdentity(page)).toEqual(identity);
  } finally {
    await context.setOffline(false);
  }
});
