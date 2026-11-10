import { createHash } from "node:crypto";
import { createServer, request } from "node:http";
import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { addInflateRegressionPart } from "../../src/xlsx/fixtures/inflateWindowWrap";
import {
  confirmRestore,
  contentDigest,
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
  browserName,
}, testInfo) => {
  // Closing network connections exercises the browser's real offline fallback.
  // Playwright WebKit's protocol-level setOffline can fail navigation before
  // its Service Worker gets a chance to respond on Windows.
  let networkUnavailable = false;
  const deniedUrls: string[] = [];
  const offlineErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (networkUnavailable) offlineErrors.push(error.message);
  });
  const upstream = new URL(
    process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173",
  );
  const server = createServer((incoming, outgoing) => {
    if (networkUnavailable) {
      deniedUrls.push(
        new URL(incoming.url ?? "/", `http://${incoming.headers.host}`).href,
      );
      incoming.socket.destroy();
      return;
    }
    const forwarded = request(
      new URL(incoming.url ?? "/", upstream),
      { method: incoming.method },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    forwarded.on("error", () => {
      outgoing.destroy();
    });
    incoming.pipe(forwarded);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Offline test server address is missing.");
  const gateOrigin = `http://127.0.0.1:${address.port}`;
  const auditExpectedNetworkErrors = () => {
    // WebKit emits two pageerror events for a refused metrics request. Admit
    // exactly those adjacent pairs and require the gate's actual denied URL;
    // arbitrary TypeErrors, uncached asset errors and crashes still fail.
    if (browserName !== "webkit") expect(offlineErrors).toEqual([]);
    expect(offlineErrors.length % 2).toBe(0);
    const metricsUrl = `${gateOrigin}/api/persistence-release-a-metrics`;
    for (let index = 0; index < offlineErrors.length; index += 2) {
      expect(offlineErrors[index]).toBe("TypeError: Load failed");
      expect(offlineErrors[index + 1]).toBe(
        `/${new URL(metricsUrl).host}${new URL(metricsUrl).pathname}.`,
      );
      expect(deniedUrls).toContain(metricsUrl);
    }
    expect(
      deniedUrls.filter((url) => url === metricsUrl).length,
    ).toBeGreaterThanOrEqual(offlineErrors.length / 2);
    return [...offlineErrors];
  };
  try {
    const trace = await launch(
      page,
      false,
      false,
      `http://127.0.0.1:${address.port}/`,
    );
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
    networkUnavailable = true;
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
    const traces = await trace.verify(
      1,
      testInfo,
      2,
      auditExpectedNetworkErrors(),
    );
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
          networkLoss: "connections-destroyed-at-test-http-gate",
          updateAcrossBuildsVerified: false,
        }),
      ),
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#loading-screen")).toBeHidden();
    const reloaded = await exportBackup(page);
    expect(contentDigest(reloaded.data)).toBe(contentDigest(saved.data));
    expect(reloaded.eventSettings).toEqual(saved.eventSettings);
    expect(await readRuntimeIdentity(page)).toEqual(identity);
    await trace.verify(1, testInfo, 3, auditExpectedNetworkErrors());
    await testInfo.attach("offline-network-error-audit", {
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify({
          deniedUrls,
          offlineErrors,
          admittedOnlyExactMetricsPairs: true,
        }),
      ),
    });
  } finally {
    networkUnavailable = false;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
