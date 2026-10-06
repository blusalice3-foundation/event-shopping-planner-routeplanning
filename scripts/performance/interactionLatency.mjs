import { chromium } from "@playwright/test";
const count = Number(process.env.BENCHMARK_ITEMS || 150),
  eventName = "応答速度検証";
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
const map = {
  maxRow: 100,
  maxCol: 100,
  mergedCells: [],
  cells: Array.from({ length: 10000 }, (_, i) => ({
    row: Math.floor(i / 100) + 1,
    col: (i % 100) + 1,
    value: null,
    backgroundColor: null,
    borders: { top: null, right: null, bottom: null, left: null },
  })),
  blocks: [
    {
      name: "A",
      startRow: 1,
      startCol: 1,
      endRow: 100,
      endCol: 100,
      numberCells: items.map((v, i) => ({
        row: Math.floor(i / 100) + 1,
        col: (i % 100) + 1,
        value: i + 1,
      })),
    },
  ],
};
const backup = {
  kind: "event-shopping-planner-backup",
  version: 1,
  exportedAt: "2026-10-06T00:00:00.000Z",
  eventSettings: { blockDetectionSettings: {} },
  data: {
    eventLists: { [eventName]: items },
    eventMetadata: {},
    executeModeItems: { [eventName]: { "1日目": items.map((i) => i.id) } },
    dayModes: { [eventName]: { "1日目": "execute" } },
    mapData: { [eventName]: { "1日目マップ": map } },
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallDefinitions: {
      [eventName]: {
        "1日目マップ": [
          {
            id: "east",
            name: "東館",
            vertices: [
              { row: 1, col: 1 },
              { row: 1, col: 100 },
              { row: 100, col: 100 },
              { row: 100, col: 1 },
            ],
          },
        ],
      },
    },
    hallRouteSettings: {},
  },
};
const b = await chromium.launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  p.on("dialog", (d) => {
    console.log("DIALOG", d.message().slice(0, 800));
    void d.dismiss();
  });
  await p.goto(process.argv[2] || "http://127.0.0.1:4173");
  await p
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "performance.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup), "utf8"),
    });
  const d = p.getByRole("dialog", { name: "バックアップからイベントを復元" });
  await d.getByRole("radio", { name: /同名で置換/ }).check();
  await d.getByRole("button", { name: "置換して復元" }).click();
  await d.waitFor({ state: "hidden" });
  await p.getByRole("heading", { name: eventName, exact: true }).waitFor();
  const frames = () =>
    p.evaluate(
      () =>
        new Promise((resolve) =>
          globalThis.requestAnimationFrame(() =>
            globalThis.requestAnimationFrame(() => resolve(performance.now())),
          ),
        ),
    );
  const measure = async (name, action, ready, readyArg) => {
    const start = await p.evaluate(() => performance.now());
    await action();
    if (ready) await p.waitForFunction(ready, readyArg);
    const end = await frames();
    console.log(JSON.stringify({ name, ms: end - start }));
  };
  const clickTitle = (title) =>
    p.evaluate(
      (t) =>
        globalThis.document.querySelector('button[title="' + t + '"]').click(),
      title,
    );
  const cd = await p.context().newCDPSession(p);
  await cd.send("Profiler.enable");
  await cd.send("Profiler.start");
  for (let round = 0; round < 3; round++) {
    for (const [title, color] of [
      ["編集モード", "bg-blue-100"],
      ["実行モード", "bg-green-100"],
      ["集中モード", "bg-purple-100"],
      ["実行モード", "bg-green-100"],
    ]) {
      const start = await p.evaluate(() => performance.now());
      await clickTitle(title);
      await p.waitForFunction(
        ({ title, color }) =>
          globalThis.document
            .querySelector('button[title="' + title + '"]')
            ?.className.includes(color),
        { title, color },
      );
      await p.waitForFunction(
        () => globalThis.document.querySelectorAll("[data-item-id]").length > 0,
      );
      console.log(
        JSON.stringify({ name: title, round, ms: (await frames()) - start }),
      );
    }
    await measure(
      "マップ表示",
      () => clickTitle("マップ表示に切り替え"),
      () => globalThis.document.querySelectorAll("canvas").length > 0,
    );
    const title = await p
      .getByRole("button")
      .evaluateAll((bs) =>
        bs.map((b) => b.title).find((t) => t.includes("リスト表示")),
      );
    await measure(
      "マップ非表示",
      () => clickTitle(title),
      () => globalThis.document.querySelectorAll("[data-item-id]").length > 0,
    );
    await measure(
      "表示設定",
      () => clickTitle("表示項目の設定"),
      () =>
        !!globalThis.document.querySelector('button[title="表示項目の設定"]'),
    );
    await clickTitle("表示項目の設定");
    await frames();
    const value = String(round + 2);
    await measure(
      "数量変更",
      () =>
        p.evaluate((value) => {
          const e = globalThis.document.querySelector(
            '[data-item-id="1"] select[aria-label="購入予定数量"]',
          );
          e.value = value;
          e.dispatchEvent(new Event("change", { bubbles: true }));
        }, value),
      (v) =>
        globalThis.document.querySelector(
          '[data-item-id="1"] select[aria-label="購入予定数量"]',
        )?.value === v,
      value,
    );
    const price = String(600 + 100 * round);
    const priceStart = await p.evaluate(() => performance.now());
    await p.evaluate((value) => {
      const e = globalThis.document.querySelector(
        '[data-item-id="1"] select[aria-label="購入金額"]',
      );
      e.value = value;
      e.dispatchEvent(new Event("change", { bubbles: true }));
    }, price);
    await p.waitForFunction(
      (v) =>
        globalThis.document.querySelector(
          '[data-item-id="1"] select[aria-label="購入金額"]',
        )?.value === v,
      price,
    );
    console.log(
      JSON.stringify({
        name: "金額変更",
        round,
        ms: (await frames()) - priceStart,
      }),
    );
    const statusStart = await p.evaluate(() => performance.now());
    const before = await p
      .locator('[data-item-id="1"] button[aria-label^="Current status"]')
      .getAttribute("aria-label");
    await p.evaluate(() =>
      globalThis.document
        .querySelector(
          '[data-item-id="1"] button[aria-label^="Current status"]',
        )
        .click(),
    );
    await p.waitForFunction(
      (before) =>
        globalThis.document
          .querySelector(
            '[data-item-id="1"] button[aria-label^="Current status"]',
          )
          ?.getAttribute("aria-label") !== before,
      before,
    );
    console.log(
      JSON.stringify({
        name: "購入状態変更",
        round,
        ms: (await frames()) - statusStart,
      }),
    );
  }
  const { profile } = await cd.send("Profiler.stop");
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const times = new Map();
  profile.samples?.forEach((id, i) =>
    times.set(id, (times.get(id) || 0) + profile.timeDeltas[i]),
  );
  console.log(
    "CPU",
    JSON.stringify(
      [...times]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([id, us]) => ({
          function: byId.get(id).callFrame.functionName,
          url: byId.get(id).callFrame.url,
          column: byId.get(id).callFrame.columnNumber,
          ms: us / 1000,
        })),
    ),
  );
} finally {
  await b.close();
}
