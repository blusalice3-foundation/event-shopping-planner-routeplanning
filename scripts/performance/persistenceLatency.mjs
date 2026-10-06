// Local native IndexedDB diagnostic. PowerShell stdin supplies an IIFE bundle exporting
// SaveBenchmark.readApplicationSnapshot / commitApplicationSnapshotAtomically
// and createEventConsistency. Fresh browser storage is used for every run.
// This diagnostic does not produce release performance acceptance evidence.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
// PowerShell supplies the standalone bundle on stdin; the app is served using
// ordinary HTTP script loading, with no browser interception or code injection.
const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const source = Buffer.concat(chunks);
assert(source.length > 0, "Supply the diagnostic IIFE bundle on stdin.");
const server = createServer((request, response) => {
  if (request.url === "/save.js") {
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
    });
    response.end(source);
  } else if (request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      '<!doctype html><title>Persistence benchmark</title><script src="/save.js"></script>',
    );
  } else {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const address = server.address();
  assert(address && typeof address === "object");
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const result = await page.evaluate(async () => {
    const api = globalThis.SaveBenchmark;
    const all = [];
    for (const size of [10000, 40000]) {
      const event = "save-benchmark";
      const fixture = {
        eventConsistency: { [event]: api.createEventConsistency() },
        eventLists: {
          [event]: Array.from({ length: 150 }, (_, i) => ({
            id: String(i + 1),
            title: "book" + i,
            quantity: 1,
            price: 500,
            purchaseStatus: "None",
          })),
        },
        eventMetadata: {},
        executeModeItems: {},
        dayModes: { [event]: { 1: "edit" } },
        mapData: {
          [event]: {
            day: {
              maxRow: Math.ceil(size / 100),
              maxCol: 100,
              mergedCells: [],
              blocks: [],
              cells: Array.from({ length: size }, (_, i) => ({
                row: Math.floor(i / 100) + 1,
                col: (i % 100) + 1,
                value: String(i + 1),
                backgroundColor: null,
                borders: { top: null, right: null, bottom: null, left: null },
              })),
            },
          },
        },
        mapRotationSettings: {},
        routeSettings: {},
        hallDefinitions: {},
        hallRouteSettings: {},
        mapViewportSettings: {},
      };
      await api.commitApplicationSnapshotAtomically(fixture);
      for (let round = 0; round < 11; round++) {
        const readStart = performance.now();
        const read = await api.readApplicationSnapshot();
        const commitStart = performance.now();
        const next = {
          ...read.snapshot,
          eventLists: {
            ...read.snapshot.eventLists,
            [event]: read.snapshot.eventLists[event].map((item, i) =>
              i === 0 ? { ...item, quantity: round + 2 } : item,
            ),
          },
        };
        await api.commitApplicationSnapshotAtomically(next, {
          expectedRoots: read.expectedRoots,
          changedStoresOnly: true,
        });
        const end = performance.now();
        const saved = await api.readApplicationSnapshot();
        if (saved.snapshot.eventLists[event][0].quantity !== round + 2)
          throw new Error("Durable verification failed");
        if (round >= 2)
          all.push({
            mapCells: size,
            round: round - 2,
            readMs: commitStart - readStart,
            commitMs: end - commitStart,
            totalMs: end - readStart,
          });
      }
    }
    return all;
  });
  assert.equal(result.length, 18);
  const median = (values) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  for (const mapCells of [10000, 40000]) {
    const samples = result.filter((row) => row.mapCells === mapCells);
    console.log(
      JSON.stringify({
        mapCells,
        runs: samples.length,
        readMs: median(samples.map((row) => row.readMs)),
        commitMs: median(samples.map((row) => row.commitMs)),
        totalMs: median(samples.map((row) => row.totalMs)),
        durableVerified: true,
      }),
    );
  }
  console.log(JSON.stringify({ raw: result }));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
