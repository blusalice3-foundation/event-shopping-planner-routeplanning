import { expect, test, type Locator, type Page } from "@playwright/test";

const eventName = "範囲選択ポップアップ確認";
const mapName = "1日目マップ";
type Cell = { row: number; col: number };
type ObservedWindow = Window & { __selectionPopupClicks: Cell[] };

function backup() {
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-11-11T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: {
        [eventName]: [
          {
            id: "item",
            eventDate: "1日目",
            circle: "ユーザー登録",
            title: "選択確認",
            block: "A",
            number: "1",
            price: 500,
            quantity: 1,
            purchaseStatus: "None",
            remarks: "エラーが発生しました",
          },
        ],
      },
      eventMetadata: {},
      executeModeItems: { [eventName]: { "1日目": ["item"] } },
      dayModes: { [eventName]: { "1日目": "edit" } },
      mapData: {
        [eventName]: {
          [mapName]: {
            maxRow: 40,
            maxCol: 40,
            cells: Array.from({ length: 1600 }, (_, index) => ({
              row: Math.floor(index / 40) + 1,
              col: (index % 40) + 1,
              value: index === 41 ? 1 : null,
              backgroundColor: null,
              borders: { top: null, right: null, bottom: null, left: null },
            })),
            mergedCells: [],
            blocks: [],
          },
        },
      },
      mapRotationSettings: {},
      mapViewportSettings: {
        [eventName]: {
          [mapName]: {
            zoomLevel: 100,
            offsetX: 0,
            offsetY: 0,
          },
        },
      },
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
}

async function openEditor(page: Page, hall: boolean) {
  await page.goto("/");
  await page.getByLabel("バックアップファイルを選択").setInputFiles({
    name: "map-selection-popup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup()), "utf8"),
  });
  const restore = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
    exact: true,
  });
  await restore.getByRole("radio", { name: /同名で置換/ }).check();
  await restore
    .getByRole("button", { name: "置換して復元", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: `「${eventName}」の復元内容を確認`,
    exact: true,
  });
  await expect
    .poll(
      async () => (await review.isVisible()) || !(await restore.isVisible()),
    )
    .toBe(true);
  if (await review.isVisible()) {
    await review
      .getByRole("button", { name: "確認して保存", exact: true })
      .click();
  }
  await expect(restore).toBeHidden();
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  await expect(page.locator("canvas").first()).toBeVisible();
  await page
    .getByTitle("リスト表示に切り替え", { exact: true })
    .click({ delay: 650 });
  await page
    .getByRole("button", {
      name: hall ? "🏛️ ホール定義" : "🔲 ブロック定義",
      exact: true,
    })
    .click();
  const panel = page.getByRole("dialog", {
    name: hall ? "ホール定義エリア設定" : "ブロック定義",
    exact: true,
  });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "+ 新規", exact: true }).click();
  return panel;
}

async function verifyCoveredCellSelection(
  page: Page,
  label: string,
  touch: boolean,
  count: number,
) {
  const popup = page.getByRole("region", { name: label, exact: true });
  const minimize = popup.getByRole("button", {
    name: `${label}を最小化`,
    exact: true,
  });
  const restore = popup.getByRole("button", {
    name: `${label}を元の表示に戻す`,
    exact: true,
  });
  await expect(minimize).toBeVisible();
  const original = await popup.boundingBox();
  const canvas = await page.locator("canvas").first().boundingBox();
  if (!original || !canvas)
    throw new Error("The popup and map must be visible.");
  // This position really belongs to the expanded popup and the map underneath.
  const point = {
    x: original.x + original.width / 2,
    y: Math.max(original.y + 24, canvas.y + 112),
  };
  expect(point.x - 84).toBeGreaterThan(canvas.x);
  expect(point.y).toBeLessThan(
    Math.min(original.y + original.height, canvas.y + canvas.height),
  );
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest("section[aria-label]")
          ?.getAttribute("aria-label"),
      point,
    ),
  ).toBe(label);

  // Observe real canvas events without injecting a selection into the application.
  await page.evaluate(() => {
    const observed = window as ObservedWindow;
    observed.__selectionPopupClicks = [];
    window.addEventListener("mapCellClick", (event) => {
      observed.__selectionPopupClicks.push((event as CustomEvent<Cell>).detail);
    });
  });
  const clicks = () =>
    page.evaluate(() => (window as ObservedWindow).__selectionPopupClicks);
  const press = async (position: { x: number; y: number }) => {
    if (touch) await page.touchscreen.tap(position.x, position.y);
    else await page.mouse.click(position.x, position.y);
  };
  const activate = async (button: Locator) => {
    if (touch) await button.tap();
    else await button.click();
  };
  const minimizeAndCheck = async () => {
    await activate(minimize);
    await expect(restore).toHaveText("□");
    await expect(popup.getByRole("button")).toHaveCount(1);
    const small = await popup.boundingBox();
    if (!small) throw new Error("The minimized control must be visible.");
    expect(small.x).toBeLessThan(40);
    expect(small.width).toBeLessThanOrEqual(60);
    expect(small.height).toBeLessThanOrEqual(60);
    expect(page.viewportSize()!.height - small.y - small.height).toBeLessThan(
      40,
    );
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
        point,
      ),
    ).toBe("CANVAS");
  };
  await minimizeAndCheck();
  await test.info().attach("minimized", {
    body: await page.screenshot({
      path: test.info().outputPath("minimized.png"),
    }),
    contentType: "image/png",
  });
  expect(await clicks()).toEqual([]);
  await press(point);
  await expect.poll(async () => (await clicks()).length).toBe(1);
  await expect(restore).toBeVisible();
  await activate(restore);
  const first = (await clicks())[0];
  await expect(popup).toContainText(`(${first.row},${first.col})`);
  expect(await clicks()).toHaveLength(1);
  await minimizeAndCheck();
  const remaining =
    count === 2
      ? [{ x: point.x - 84, y: point.y - 84 }]
      : [
          { x: point.x - 84, y: point.y },
          { x: point.x - 84, y: point.y - 84 },
          { x: point.x, y: point.y - 84 },
        ];
  for (const [index, position] of remaining.entries()) {
    await press(position);
    await expect.poll(async () => (await clicks()).length).toBe(index + 2);
  }
  // Reaching a confirmable count must not automatically expand the popup.
  await expect(restore).toBeVisible();
  await expect(popup.getByRole("button")).toHaveCount(1);
  await activate(restore);
  await test.info().attach("restored", {
    body: await page.screenshot({
      path: test.info().outputPath("restored.png"),
    }),
    contentType: "image/png",
  });
  const selected = await clicks();
  expect(selected).toHaveLength(count);
  for (const cell of selected) {
    await expect(popup).toContainText(`(${cell.row},${cell.col})`);
  }
  return popup;
}

async function verifyNewSelectionAndCancel(
  panel: Locator,
  start: string,
  label: string,
  draft: Locator,
  name: string,
) {
  await panel.getByRole("button", { name: start, exact: true }).click();
  const popup = panel.page().getByRole("region", { name: label, exact: true });
  await expect(
    popup.getByRole("button", { name: `${label}を最小化`, exact: true }),
  ).toBeVisible();
  await expect(popup.getByText(/^選択:/)).toHaveCount(0);
  await popup
    .getByRole("button", { name: `${label}を最小化`, exact: true })
    .click();
  await popup
    .getByRole("button", { name: `${label}を元の表示に戻す`, exact: true })
    .click();
  await popup.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(draft).toHaveValue(name);
}

const blockPaths = [
  {
    key: "corner",
    mode: "通常",
    start: "マップ上で4つの角をクリックして選択",
    count: 4,
  },
  {
    key: "multiCorner",
    mode: "複数範囲",
    start: "マップ上で4つの角をクリックして範囲を追加",
    count: 4,
  },
  { key: "rangeStart", mode: "壁", start: "+ 範囲追加", count: 2 },
  { key: "individual", mode: "壁", start: "+ 個別追加", count: 2 },
];

for (const surface of [
  { name: "desktop", viewport: { width: 1280, height: 900 }, touch: false },
  { name: "phone", viewport: { width: 390, height: 844 }, touch: true },
]) {
  test.describe(`map selection popup ${surface.name}`, () => {
    test.use({
      viewport: surface.viewport,
      hasTouch: surface.touch,
      isMobile: surface.touch,
      serviceWorkers: "block",
    });
    test.describe.configure({ timeout: 60_000 });

    for (const path of surface.touch ? blockPaths.slice(0, 1) : blockPaths) {
      test(`${path.key}: select through the covered map, restore and restart`, async ({
        page,
      }) => {
        const panel = await openEditor(page, false);
        const draft = panel.getByPlaceholder("例: ア, め, N");
        await draft.fill("編集中のブロック");
        if (path.mode !== "通常") {
          await panel
            .getByRole("button", { name: path.mode, exact: true })
            .click();
        }
        await panel
          .getByRole("button", { name: path.start, exact: true })
          .click();
        const popup = await verifyCoveredCellSelection(
          page,
          "ブロック範囲選択",
          surface.touch,
          path.count,
        );
        const confirm = popup.getByRole("button", {
          name: "選択を確定",
          exact: true,
        });
        await expect(confirm).toBeEnabled();
        await confirm.click();
        await expect(draft).toHaveValue("編集中のブロック");
        if (path.key === "corner")
          await expect(panel.getByText(/^範囲: 行/)).toBeVisible();
        if (path.key === "multiCorner")
          await expect(panel.getByText(/^範囲1:/)).toBeVisible();
        if (path.key === "rangeStart")
          await expect(panel.getByText(/^範囲\(/)).toBeVisible();
        if (path.key === "individual")
          await expect(
            panel.getByText("個別2セル", { exact: true }),
          ).toBeVisible();
        await verifyNewSelectionAndCancel(
          panel,
          path.start,
          "ブロック範囲選択",
          draft,
          "編集中のブロック",
        );
      });
    }

    test("hall: retain vertices, draft and guide settings while minimized", async ({
      page,
    }) => {
      const panel = await openEditor(page, true);
      const draft = panel.getByPlaceholder("例: 東1ホール");
      await draft.fill("編集中のホール");
      const start = "マップ上で頂点を選択";
      await panel.getByRole("button", { name: start, exact: true }).click();
      await page
        .getByRole("button", { name: "補助グリッド ON", exact: true })
        .click();
      await page
        .getByRole("button", { name: "座標尺 ON", exact: true })
        .click();
      const popup = await verifyCoveredCellSelection(
        page,
        "ホール頂点選択",
        surface.touch,
        4,
      );
      await expect(
        popup.getByRole("button", { name: "補助グリッド OFF", exact: true }),
      ).toBeVisible();
      await expect(
        popup.getByRole("button", { name: "座標尺 OFF", exact: true }),
      ).toBeVisible();
      await popup.getByRole("button", { name: "確定", exact: true }).click();
      await expect(draft).toHaveValue("編集中のホール");
      await expect(
        panel.getByText("選択済み: 4頂点", { exact: true }),
      ).toBeVisible();
      await verifyNewSelectionAndCancel(
        panel,
        start,
        "ホール頂点選択",
        draft,
        "編集中のホール",
      );
      await expect(
        panel.getByText("選択済み: 4頂点", { exact: true }),
      ).toBeVisible();
    });
  });
}
