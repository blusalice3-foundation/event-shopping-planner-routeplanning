// Local production-UI rendering diagnostic; not release acceptance evidence.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const eventName = "参加日切替計測";
function fixture({ itemsPerDay, cellsPerMap, mode }) {
  const days = ["1日目", "2日目"];
  const items = days.flatMap((day, d) =>
    Array.from({ length: itemsPerDay }, (_, i) => ({
      id: "day" + (d + 1) + "-item" + (i + 1),
      eventDate: day,
      circle: day + "サークル" + (i + 1),
      title: day + "新刊" + (i + 1),
      block: "A",
      number: String(i + 1),
      price: 500,
      purchaseStatus: "None",
      quantity: 1,
      remarks: "ユーザー登録",
    })),
  );
  const maps = {},
    halls = {};
  for (const day of days)
    if (cellsPerMap) {
      const name = day + "マップ",
        rows = Math.ceil(cellsPerMap / 100);
      maps[name] = {
        maxRow: rows,
        maxCol: 100,
        mergedCells: [],
        cells: Array.from({ length: cellsPerMap }, (_, i) => ({
          row: Math.floor(i / 100) + 1,
          col: (i % 100) + 1,
          value: String(i + 1),
          backgroundColor: null,
          borders: { top: null, right: null, bottom: null, left: null },
        })),
        blocks: [
          {
            name: "A",
            startRow: 1,
            startCol: 1,
            endRow: rows,
            endCol: 100,
            numberCells: Array.from({ length: itemsPerDay }, (_, i) => ({
              row: Math.floor(i / 100) + 1,
              col: (i % 100) + 1,
              value: i + 1,
            })),
          },
        ],
      };
      halls[name] = [
        {
          id: "east",
          name: "東館",
          vertices: [
            { row: 1, col: 1 },
            { row: 1, col: 100 },
            { row: rows, col: 100 },
            { row: rows, col: 1 },
          ],
        },
      ];
    }
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-07T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: { [eventName]: items },
      eventMetadata: {},
      executeModeItems: {
        [eventName]: Object.fromEntries(
          days.map((day) => [
            day,
            items.filter((i) => i.eventDate === day).map((i) => i.id),
          ]),
        ),
      },
      dayModes: {
        [eventName]: Object.fromEntries(days.map((day) => [day, mode])),
      },
      mapData: cellsPerMap ? { [eventName]: maps } : {},
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: cellsPerMap ? { [eventName]: halls } : {},
      hallRouteSettings: {},
    },
  };
}
const browser = await chromium.launch({ headless: true });
try {
  const cases = process.argv.includes("--pilot")
    ? [
        {
          name: "pilot",
          itemsPerDay: 75,
          cellsPerMap: 10000,
          mode: "execute",
          surface: "list",
          cpu: 1,
        },
      ]
    : [
        {
          name: "small-edit-no-map",
          itemsPerDay: 75,
          cellsPerMap: 0,
          mode: "edit",
          surface: "list",
          cpu: 1,
        },
        {
          name: "small-execute-no-map",
          itemsPerDay: 75,
          cellsPerMap: 0,
          mode: "execute",
          surface: "list",
          cpu: 1,
        },
        {
          name: "small-execute-map-10k",
          itemsPerDay: 75,
          cellsPerMap: 10000,
          mode: "execute",
          surface: "list",
          cpu: 1,
        },
        {
          name: "small-execute-map-40k",
          itemsPerDay: 75,
          cellsPerMap: 40000,
          mode: "execute",
          surface: "list",
          cpu: 1,
        },
        {
          name: "medium-execute-no-map",
          itemsPerDay: 500,
          cellsPerMap: 0,
          mode: "execute",
          surface: "list",
          cpu: 1,
        },
        {
          name: "medium-execute-map-40k",
          itemsPerDay: 500,
          cellsPerMap: 40000,
          mode: "execute",
          surface: "list",
          cpu: 1,
        },
        {
          name: "medium-focus-map-40k",
          itemsPerDay: 500,
          cellsPerMap: 40000,
          mode: "focus",
          surface: "list",
          cpu: 1,
        },
        {
          name: "large-execute-map-40k",
          itemsPerDay: 1500,
          cellsPerMap: 40000,
          mode: "execute",
          surface: "list",
          cpu: 1,
        },
        {
          name: "small-map-view-40k",
          itemsPerDay: 75,
          cellsPerMap: 40000,
          mode: "execute",
          surface: "map",
          cpu: 1,
        },
        {
          name: "medium-execute-map-40k-cpu4",
          itemsPerDay: 500,
          cellsPerMap: 40000,
          mode: "execute",
          surface: "list",
          cpu: 4,
        },
      ];
  const defaultCases = [
    ...cases,
    {
      name: "phone-execute-flat-no-map",
      itemsPerDay: 500,
      cellsPerMap: 0,
      mode: "execute",
      surface: "list",
      cpu: 1,
      layout: "smartphone",
      grouped: false,
    },
    {
      name: "phone-execute-grouped-no-map",
      itemsPerDay: 500,
      cellsPerMap: 0,
      mode: "execute",
      surface: "list",
      cpu: 1,
      layout: "smartphone",
      grouped: true,
    },
  ];
  const selectedCases = process.env.DAY_TAB_CASES
    ? JSON.parse(process.env.DAY_TAB_CASES)
    : defaultCases;
  for (const c of selectedCases) {
    console.log("CASE " + JSON.stringify(c));
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const dialogs = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const cd = await context.newCDPSession(page);
    await cd.send("Performance.enable");
    await page.goto(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4175");
    await page
      .locator('input[aria-label="バックアップファイルを選択"]')
      .setInputFiles({
        name: "day-tab-diagnostic.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(fixture(c)), "utf8"),
      });
    const dialog = page.getByRole("dialog", {
      name: "バックアップからイベントを復元",
    });
    await dialog.getByRole("radio", { name: /同名で置換/ }).check();
    await dialog.getByRole("button", { name: "置換して復元" }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("heading", { name: eventName, exact: true }).waitFor();
    await page.locator('[data-item-id="day1-item1"]').first().waitFor();
    if (c.surface === "map") {
      await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
      await page.locator("canvas").first().waitFor();
    }
    if (c.layout === "smartphone") {
      await page.getByTitle("表示項目の設定", { exact: true }).click();
      await page
        .getByTitle("スマートフォンモードに切替", { exact: true })
        .click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .locator("div.fixed.inset-0.z-40")
        .first()
        .click({ position: { x: 2, y: 100 } });
      const grouping = page.getByRole("button", {
        name: "スペース別",
        exact: true,
      });
      const isGrouped = (await grouping.getAttribute("class")).includes(
        "bg-blue-600",
      );
      if (isGrouped !== c.grouped) await grouping.click();
    }
    await page.waitForTimeout(700);

    await cd.send("Emulation.setCPUThrottlingRate", { rate: c.cpu });
    if (process.argv.includes("--pilot")) {
      console.log(
        "DOM " +
          JSON.stringify(
            await page.evaluate(() => ({
              buttons: [...globalThis.document.querySelectorAll("button")]
                .slice(0, 38)
                .map((b) => ({
                  text: b.textContent,
                  title: b.title,
                  class: b.className,
                })),
              rows: [...globalThis.document.querySelectorAll("[data-item-id]")]
                .slice(0, 3)
                .map((b) => ({
                  id: b.getAttribute("data-item-id"),
                  text: b.textContent.slice(0, 100),
                })),
              renderer: [
                ...globalThis.document.querySelectorAll("[data-list-renderer]"),
              ].map((b) => b.getAttribute("data-list-renderer")),
            })),
          ),
      );
    }
    const readMetadata = () =>
      page.evaluate(async () => {
        const database = await new Promise((resolve, reject) => {
          const r = globalThis.indexedDB.open("EventShoppingPlannerDB");
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        try {
          return await new Promise((resolve, reject) => {
            const r = database
              .transaction("syncQueue", "readonly")
              .objectStore("syncQueue")
              .getAll();
            r.onsuccess = () =>
              resolve(
                JSON.stringify(
                  r.result.filter((value) => value && value.payloadDigest),
                ),
              );
            r.onerror = () => reject(r.error);
          });
        } finally {
          database.close();
        }
      });
    const baselineMetadata = await readMetadata();
    if (c.profile) {
      await cd.send("Profiler.enable");
      await cd.send("Profiler.start");
    }
    const samples = [];
    for (let round = 0; round < (c.rounds ?? 10); round++) {
      const day = round % 2 === 0 ? "2日目" : "1日目",
        prefix = round % 2 === 0 ? "day2-" : "day1-";
      const before = await cd.send("Performance.getMetrics");
      const sample = await page.evaluate(
        async ({ day, prefix, surface }) => {
          const tab = [...globalThis.document.querySelectorAll("button")].find(
            (b) => b.textContent.trim().startsWith(day) && !b.title,
          );
          if (!tab) throw new Error("Day tab is missing: " + day);
          const start = performance.now();
          tab.click();
          const clickMs = performance.now() - start;
          let readyAt = null;
          for (let attempt = 0; attempt < 300; attempt++) {
            await new Promise((resolve) =>
              globalThis.requestAnimationFrame(resolve),
            );
            const active = tab.className.includes("bg-blue-600");
            const rows = [
              ...globalThis.document.querySelectorAll("[data-item-id]"),
            ].filter((n) => n.getClientRects().length > 0);
            const ready =
              surface === "map"
                ? globalThis.document.querySelectorAll("canvas").length > 0
                : rows.length > 0 &&
                  rows.every((n) =>
                    n.getAttribute("data-item-id").startsWith(prefix),
                  );
            if (active && ready) {
              readyAt = performance.now();
              break;
            }
          }
          if (readyAt === null)
            throw new Error("The destination day did not render: " + day);
          await new Promise((resolve) =>
            globalThis.requestAnimationFrame(resolve),
          );
          return {
            day,
            clickMs,
            readyMs: readyAt - start,
            paintMs: performance.now() - start,
            renderedRows:
              globalThis.document.querySelectorAll("[data-item-id]").length,
            renderer: [
              ...globalThis.document.querySelectorAll("[data-list-renderer]"),
            ].map((n) => n.getAttribute("data-list-renderer")),
            rendererReasons: [
              ...globalThis.document.querySelectorAll("[data-list-renderer]"),
            ].map((n) => n.getAttribute("data-list-renderer-reason")),
            canvasCount: globalThis.document.querySelectorAll("canvas").length,
            liveElements: globalThis.document.querySelectorAll("*").length,
            selectCount: globalThis.document.querySelectorAll("select").length,
            optionCount: globalThis.document.querySelectorAll("option").length,
          };
        },
        { day, prefix, surface: c.surface },
      );
      const after = await cd.send("Performance.getMetrics");
      const get = (m, n) => m.metrics.find((v) => v.name === n)?.value ?? 0;
      Object.assign(sample, {
        round,
        scriptMs:
          1000 * (get(after, "ScriptDuration") - get(before, "ScriptDuration")),
        taskMs:
          1000 * (get(after, "TaskDuration") - get(before, "TaskDuration")),
        layoutMs:
          1000 * (get(after, "LayoutDuration") - get(before, "LayoutDuration")),
        styleMs:
          1000 *
          (get(after, "RecalcStyleDuration") -
            get(before, "RecalcStyleDuration")),
        nodes: get(after, "Nodes"),
        heapBytes: get(after, "JSHeapUsedSize"),
      });
      samples.push(sample);
      await page.waitForTimeout(150);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(dialogs, []);
    const sameMetadata = baselineMetadata === (await readMetadata());
    assert(
      sameMetadata,
      "Ordinary day switching modified persisted root metadata.",
    );
    if (c.profile) {
      const { profile } = await cd.send("Profiler.stop");
      const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
      const parents = new Map();
      for (const n of profile.nodes)
        for (const child of n.children ?? []) parents.set(child, n.id);
      const times = new Map();
      profile.samples?.forEach((id, i) =>
        times.set(id, (times.get(id) ?? 0) + (profile.timeDeltas?.[i] ?? 0)),
      );
      const top = [...times]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([id, us]) => {
          const frames = [];
          for (
            let current = id;
            current && frames.length < 6;
            current = parents.get(current)
          ) {
            const f = nodes.get(current).callFrame;
            frames.push({
              function: f.functionName,
              url: f.url,
              line: f.lineNumber,
              column: f.columnNumber,
            });
          }
          return { selfMs: us / 1000, frames };
        });
      console.log("PROFILE " + JSON.stringify({ case: c, top }));
    }
    const timed = samples.slice(2),
      median = (key) =>
        timed.map((s) => s[key]).sort((a, b) => a - b)[
          Math.floor(timed.length / 2)
        ];
    console.log(
      JSON.stringify({
        case: c,
        first: samples[0],
        summary: {
          samples: timed.length,
          paintMedianMs: median("paintMs"),
          paintMaxMs: Math.max(...timed.map((s) => s.paintMs)),
          scriptMedianMs: median("scriptMs"),
          layoutMedianMs: median("layoutMs"),
          styleMedianMs: median("styleMs"),
        },
        samples,
        errors,
        dialogs,
        sameMetadata,
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
