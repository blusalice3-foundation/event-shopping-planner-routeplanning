/* global document, window, getComputedStyle, MutationObserver, HTMLInputElement, requestAnimationFrame */
import { chromium } from "@playwright/test";
const baseURL = process.argv[2] ?? "http://127.0.0.1:4189";
const cases = JSON.parse(
  process.env.LAG_CASES ||
    '[{"layout":"pc","count":150,"mode":"execute"},{"layout":"smartphone","count":150,"mode":"execute"},{"layout":"pc","count":150,"mode":"execute","grouped":true,"mapCells":10000},{"layout":"smartphone","count":150,"mode":"execute","grouped":true,"mapCells":10000}]',
);
const eventName = "ラグ調査用イベント";
function makeBackup(count, mode, c) {
  const items = Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    eventDate: "1日目",
    circle: "サークル" + i,
    title: "新刊" + i,
    block: "A",
    number: String(i + 1),
    price: 500,
    purchaseStatus: "None",
    quantity: 1,
    remarks: "ユーザー登録",
  }));
  const dim = c.mapCells ? Math.sqrt(c.mapCells) : 0;
  const map = dim
    ? {
        maxRow: dim,
        maxCol: dim,
        mergedCells: [],
        cells: Array.from({ length: c.mapCells }, (_, i) => ({
          row: Math.floor(i / dim) + 1,
          col: (i % dim) + 1,
          value: null,
          backgroundColor: null,
          borders: { top: null, right: null, bottom: null, left: null },
        })),
        blocks: [
          {
            name: "A",
            startRow: 1,
            startCol: 1,
            endRow: dim,
            endCol: dim,
            numberCells: items.map((item, i) => ({
              row: Math.floor(i / dim) + 1,
              col: (i % dim) + 1,
              value: i + 1,
            })),
          },
        ],
      }
    : null;
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-07T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: { [eventName]: items },
      eventMetadata: {},
      executeModeItems: { [eventName]: { "1日目": items.map((x) => x.id) } },
      dayModes: { [eventName]: { "1日目": mode } },
      mapData: map ? { [eventName]: { "1日目マップ": map } } : {},
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: map
        ? {
            [eventName]: {
              "1日目マップ": [
                {
                  id: "east",
                  name: "東館",
                  vertices: [
                    { row: 1, col: 1 },
                    { row: 1, col: dim },
                    { row: dim, col: dim },
                    { row: dim, col: 1 },
                  ],
                },
              ],
            },
          }
        : {},
      hallRouteSettings: {},
    },
  };
}
const browser = await chromium.launch({ headless: true });
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
try {
  for (const c of cases) {
    const context = await browser.newContext({
      viewport:
        c.layout === "pc"
          ? { width: 1280, height: 900 }
          : { width: 390, height: 844 },
      serviceWorkers: "block",
    });
    const p = await context.newPage();
    p.setDefaultTimeout(30000);
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("dialog", async (d) => {
      errors.push("DIALOG: " + d.message());
      await d.dismiss();
    });
    await p.goto(baseURL);
    await p
      .locator('input[aria-label="バックアップファイルを選択"]')
      .setInputFiles({
        name: "lag-diagnostic.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify(makeBackup(c.count, c.mode, c)),
          "utf8",
        ),
      });
    const dialog = p.getByRole("dialog", {
      name: "バックアップからイベントを復元",
    });
    await dialog.getByRole("radio", { name: /同名で置換/ }).check();
    await dialog.getByRole("button", { name: "置換して復元" }).click();
    await dialog.waitFor({ state: "hidden" });
    await p.getByRole("heading", { name: eventName, exact: true }).waitFor();
    await p
      .locator('[data-item-id="1"] input[aria-label="利用者メモ"]')
      .waitFor();
    if (!c.grouped) {
      for (const button of await p
        .getByRole("button", { name: "スペース別", exact: true })
        .all()) {
        if ((await button.getAttribute("class")).includes("bg-blue-600"))
          await button.click();
      }
    }
    await p
      .locator('button[title="表示項目の設定"]')
      .evaluate((e) => e.click());
    await p
      .getByRole("checkbox", { name: /事後通販･頒布可否確認を有効化/ })
      .uncheck();
    await p
      .locator('button[title="表示項目の設定"]')
      .evaluate((e) => e.click());
    await p.waitForTimeout(700);
    const cd = await context.newCDPSession(p);
    await cd.send("Performance.enable");
    async function counts() {
      return p.evaluate(() => ({
        cards: document.querySelectorAll("[data-item-id]").length,
        options: document.querySelectorAll("option").length,
        nodes: document.querySelectorAll("*").length,
        renderers: [...document.querySelectorAll("[data-list-renderer]")].map(
          (e) => ({
            engine: e.dataset.listRenderer,
            strategy: e.dataset.listRendererStrategy,
            reason: e.dataset.listRendererReason,
            rows: e.dataset.listRowCount,
          }),
        ),
        scale: window.visualViewport?.scale,
        statusStyle: (() => {
          const e = document.querySelector(
            '[data-item-id="1"] button[aria-label^="Current status"]',
          );
          if (!e) return null;
          const s = getComputedStyle(e);
          return {
            transition: s.transitionDuration,
            property: s.transitionProperty,
          };
        })(),
      }));
    }
    async function operation(kind, i) {
      return p.evaluate(
        async ({ kind, i }) => {
          const card = document.querySelector('[data-item-id="1"]');
          const e = card.querySelector(
            kind === "memo"
              ? 'input[aria-label="利用者メモ"]'
              : 'button[aria-label^="Current status"]',
          );
          if (!e) throw Error("Missing operation " + kind);
          const changes = { attributes: 0, childList: 0, characterData: 0 };
          const observer = new MutationObserver((records) => {
            for (const r of records) changes[r.type]++;
          });
          observer.observe(document.body, {
            subtree: true,
            attributes: true,
            childList: true,
            characterData: true,
          });
          const before =
            kind === "memo" ? e.value : e.getAttribute("aria-label");
          const t0 = performance.now();
          if (kind === "memo") {
            Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            ).set.call(e, "ユーザー登録 " + i);
            e.dispatchEvent(new Event("input", { bubbles: true }));
          } else e.click();
          const handlerMs = performance.now() - t0;
          await new Promise((r) => requestAnimationFrame(r));
          const frame1Ms = performance.now() - t0;
          await new Promise((r) => requestAnimationFrame(r));
          const frame2Ms = performance.now() - t0;
          const currentCard = document.querySelector('[data-item-id="1"]');
          const current = currentCard?.querySelector(
            kind === "memo"
              ? 'input[aria-label="利用者メモ"]'
              : 'button[aria-label^="Current status"]',
          );
          const after =
            kind === "memo"
              ? current?.value
              : current?.getAttribute("aria-label");
          if (document.querySelector('[role="dialog"]'))
            throw Error("Unexpected modal during " + kind);
          observer.disconnect();
          return {
            handlerMs,
            frame1Ms,
            frame2Ms,
            before,
            after,
            changed: before !== after,
            changes,
          };
        },
        { kind, i },
      );
    }
    for (const stage of ["initial", "visited"]) {
      if (stage === "visited") {
        await p.evaluate(async () => {
          const scrollers = [...document.querySelectorAll("*")].filter(
            (e) =>
              ["auto", "scroll"].includes(getComputedStyle(e).overflowY) &&
              e.scrollHeight > e.clientHeight + 200 &&
              e.clientHeight > 150,
          );
          const scroller =
            scrollers.find((e) => e.querySelector("[data-list-renderer]")) ||
            document.scrollingElement;
          if (!scroller) throw Error("No list scroll container");
          for (
            let y = 0;
            y < scroller.scrollHeight;
            y += Math.max(200, scroller.clientHeight - 100)
          ) {
            scroller.scrollTop = y;
            await new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            );
          }
          scroller.scrollTop = 0;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
        });
        await p.waitForTimeout(500);
      }
      const dom = await counts();
      for (const kind of c.typingOnly || c.memoryOnly
        ? []
        : ["memo", "status"]) {
        const beforeMetrics = await cd.send("Performance.getMetrics");
        const samples = [];
        for (let i = 0; i < 10; i++) {
          const result = await operation(
            kind,
            i + 100 * (stage === "visited" ? 1 : 0),
          );
          if (i >= 2) samples.push(result);
          await p.waitForTimeout(180);
        }
        const afterMetrics = await cd.send("Performance.getMetrics");
        const metricMap = (m) =>
          Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
        const bm = metricMap(beforeMetrics),
          am = metricMap(afterMetrics);
        const metrics = Object.fromEntries(
          [
            "LayoutCount",
            "RecalcStyleCount",
            "LayoutDuration",
            "RecalcStyleDuration",
            "ScriptDuration",
            "TaskDuration",
          ].map((k) => [k, am[k] - bm[k]]),
        );
        console.log(
          JSON.stringify({
            case: c,
            stage,
            kind,
            dom,
            median: {
              handlerMs: median(samples.map((x) => x.handlerMs)),
              frame1Ms: median(samples.map((x) => x.frame1Ms)),
              frame2Ms: median(samples.map((x) => x.frame2Ms)),
            },
            samples,
            metrics,
            errors,
          }),
        );
      }
    }
    if (c.memoryOnly) {
      await cd.send("HeapProfiler.collectGarbage");
      console.log(
        JSON.stringify({
          case: c,
          kind: "memory",
          dom: await counts(),
          usage: await cd.send("Runtime.getHeapUsage"),
          errors,
        }),
      );
      await context.close();
      continue;
    }
    const memo = p.locator('[data-item-id="1"] input[aria-label="利用者メモ"]');
    await memo.click();
    await memo.press("End");
    const typingBase = await memo.inputValue();
    const expectedTyping = typingBase + "abcdefghijklmnopqrst";
    await p.evaluate(() => {
      globalThis.__typingMeasurements = [];
      const e = document.querySelector(
        '[data-item-id="1"] input[aria-label="利用者メモ"]',
      );
      e.addEventListener(
        "input",
        () => {
          const start = performance.now();
          const sample = {
            value: e.value,
            startMs: start,
            frame1Ms: null,
            frame2Ms: null,
          };
          globalThis.__typingMeasurements.push(sample);
          requestAnimationFrame(() => {
            sample.frame1Ms = performance.now() - start;
            requestAnimationFrame(() => {
              sample.frame2Ms = performance.now() - start;
            });
          });
        },
        { capture: true },
      );
    });
    const typingStart = performance.now();
    await memo.pressSequentially("abcdefghijklmnopqrst", {
      delay: c.typingDelay || 40,
    });
    const typingTotal = performance.now() - typingStart;
    await p.waitForTimeout(600);
    const typingSamples = await p.evaluate(
      () => globalThis.__typingMeasurements,
    );
    const typingValue = await memo.inputValue();
    console.log(
      JSON.stringify({
        case: c,
        kind: "typing",
        totalMs: typingTotal,
        medianFrame1Ms: median(typingSamples.map((x) => x.frame1Ms)),
        medianFrame2Ms: median(typingSamples.map((x) => x.frame2Ms)),
        maxFrame2Ms: Math.max(...typingSamples.map((x) => x.frame2Ms)),
        events: typingSamples.length,
        actual: typingValue,
        expected: expectedTyping,
        allCharactersPresent: typingValue === expectedTyping,
        samples: typingSamples,
      }),
    );
    if (c.typingOnly) {
      await p.waitForTimeout(600);
      await p.reload();
      await p.getByText(eventName, { exact: true }).click();
      await p
        .locator('[data-item-id="1"] input[aria-label="利用者メモ"]')
        .waitFor();
      const durableValue = await p
        .locator('[data-item-id="1"] input[aria-label="利用者メモ"]')
        .inputValue();
      console.log(
        JSON.stringify({
          case: c,
          kind: "typingPersistence",
          actual: durableValue,
          expected: expectedTyping,
          verified: durableValue === expectedTyping,
          errors,
        }),
      );
      await context.close();
      continue;
    }
    await cd.send("Profiler.enable");
    await cd.send("Profiler.start");
    for (let i = 0; i < 10; i++) {
      await operation("memo", 1000 + i);
      await p.waitForTimeout(180);
    }
    const { profile } = await cd.send("Profiler.stop");
    const totals = new Map();
    const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
    for (let i = 0; i < (profile.samples || []).length; i++) {
      const n = nodes.get(profile.samples[i]);
      const f = n.callFrame;
      const key = [
        f.functionName || "(anonymous)",
        f.url,
        f.lineNumber,
        f.columnNumber,
      ].join("|");
      const previous = totals.get(key) || {
        name: f.functionName || "(anonymous)",
        url: f.url,
        line: f.lineNumber,
        column: f.columnNumber,
        ms: 0,
      };
      previous.ms += (profile.timeDeltas?.[i] || 0) / 1000;
      totals.set(key, previous);
    }
    console.log(
      JSON.stringify({
        case: c,
        kind: "profile",
        top: [...totals.values()]
          .filter((x) => x.name !== "(idle)")
          .sort((a, b) => b.ms - a.ms)
          .slice(0, 25),
      }),
    );
    await p.waitForTimeout(600);
    await p.reload();
    await p.getByText(eventName, { exact: true }).click();
    await p
      .locator('[data-item-id="1"] input[aria-label="利用者メモ"]')
      .waitFor();
    const persisted = await p
      .locator('[data-item-id="1"] input[aria-label="利用者メモ"]')
      .inputValue();
    console.log(
      JSON.stringify({
        case: c,
        kind: "persistence",
        persisted,
        verified: persisted === "ユーザー登録 1009",
        errors,
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
