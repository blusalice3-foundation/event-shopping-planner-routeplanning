import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  expect,
  type CDPSession,
  type Page,
  type TestInfo,
  type Worker as BrowserWorker,
} from "@playwright/test";

export type TransferCondition = {
  count: number;
  input: "native" | "touch";
  grouped: boolean;
  load: "light" | "practical";
  direction: "candidate-to-execute" | "execute-to-candidate";
};
export type TransferSample = {
  measurementId: string;
  targetId: string;
  durationMs: number;
  matched: boolean;
  [key: string]: unknown;
};
type Rect = { x: number; y: number; width: number; height: number };
type ClickObservation = {
  durationMs: number;
  eventEpoch: number;
  targetId: string;
  matched: boolean;
  trusted: boolean;
  queueDelayMs: number;
};
type Probe = {
  id: string;
  anchor: string;
  source: string;
  destination: string;
  startMs: number;
  startEpoch: number;
  markerDelayMs: number;
  domMs: number | null;
  responseMs: number | null;
  matched: boolean;
  trusted: boolean;
  pending?: ClickObservation;
  applied?: ClickObservation;
  clicks: number;
  failure?: string;
  timeout?: number;
  stop?: () => void;
};
type Commit = {
  at: number;
  stores: string[];
  operationId?: string;
  writes: Array<{ store: string; method: string }>;
};
type TraceEvent = {
  name: string;
  cat?: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: {
    snapshot?: string;
    data?: { clip?: number[]; nodeId?: number };
    [key: string]: unknown;
  };
};
declare global {
  interface Window {
    __shoppingTransferProbe?: Probe;
    __shoppingTransferRpc?: Array<{
      direction: string;
      at: number;
      method?: string;
      operationId?: string;
      bytes: number;
    }>;
  }
}
export const transferEventName = "列間移動の描画性能";
const day = "1日目";
export const transferConditions: TransferCondition[] = [];
for (const load of ["light", "practical"] as const)
  for (const count of load === "light" ? [150, 500] : [500])
    for (const input of ["native", "touch"] as const)
      for (const grouped of [false, true])
        for (const direction of [
          "candidate-to-execute",
          "execute-to-candidate",
        ] as const)
          transferConditions.push({ count, input, grouped, load, direction });
export const transferRow = (page: Page, id: string) =>
  page.locator(
    `[data-item-id="${id}"]:not([data-space-group-key]):not(.esp-shopping-touch-clone)`,
  );
const sha256 = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
function fixture(condition: TransferCondition) {
  const half = Math.floor(condition.count / 2);
  const makeItem = (id: string, number: number) => ({
    id,
    eventDate: day,
    circle: id,
    title: `ユーザー登録 ${id}`,
    block: "A",
    number: String(number),
    price: 500,
    quantity: 1,
    purchaseStatus: "None",
    remarks: "エラーが発生しました",
    priorityLevel: "none",
  });
  const execute = Array.from({ length: half }, (_, i) =>
    makeItem(`e${i}`, 1000 - i),
  );
  const candidate = Array.from({ length: condition.count - half }, (_, i) =>
    makeItem(`c${i}`, i + 1),
  );
  const items = [...execute, ...candidate];
  const histories =
    condition.load === "practical"
      ? Object.fromEntries(
          Array.from({ length: 10 }, (_, e) => [
            `過去イベント${e}`,
            Array.from({ length: 1000 }, (_, i) =>
              makeItem(`past-${e}-${i}`, i + 1),
            ),
          ]),
        )
      : {};
  const coords = (i: number) => ({
    row: 2 + Math.floor(i / 99) * 2,
    col: 2 + (i % 99) * 2,
  });
  const numbered = new Map(
    items.map((item, i) => {
      const point = coords(i);
      return [`${point.row}-${point.col}`, Number(item.number)];
    }),
  );
  const maps =
    condition.load === "practical"
      ? {
          [transferEventName]: {
            [`${day}マップ`]: {
              maxRow: 200,
              maxCol: 200,
              mergedCells: [],
              cells: Array.from({ length: 40000 }, (_, i) => {
                const row = Math.floor(i / 200) + 1,
                  col = (i % 200) + 1;
                return {
                  row,
                  col,
                  value: numbered.get(`${row}-${col}`) ?? null,
                  backgroundColor: numbered.has(`${row}-${col}`)
                    ? null
                    : i % 3 === 0
                      ? "#fef3c7"
                      : null,
                  borders: { top: null, right: null, bottom: null, left: null },
                };
              }),
              blocks: [
                {
                  name: "A",
                  startRow: 1,
                  startCol: 1,
                  endRow: 200,
                  endCol: 200,
                  numberCells: items.map((item, i) => ({
                    ...coords(i),
                    value: Number(item.number),
                  })),
                },
              ],
            },
          },
        }
      : {};
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-21T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: { [transferEventName]: items, ...histories },
      eventMetadata: {},
      executeModeItems: {
        [transferEventName]: { [day]: execute.map((item) => item.id) },
      },
      dayModes: { [transferEventName]: { [day]: "edit" } },
      mapData: maps,
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
}
export async function restoreTransferFixture(
  page: Page,
  condition: TransferCondition,
  frame: boolean,
) {
  if (frame)
    await page.addInitScript(() => {
      const entries: NonNullable<Window["__shoppingTransferRpc"]> = [];
      window.__shoppingTransferRpc = entries;
      const observed = new WeakSet<Worker>();
      const original = globalThis.Worker.prototype.postMessage;
      globalThis.Worker.prototype.postMessage = function (
        ...args: [unknown, (StructuredSerializeOptions | Transferable[])?]
      ) {
        const message = args[0] as { method?: string; args?: unknown[] };
        if (!observed.has(this as unknown as Worker)) {
          observed.add(this as unknown as Worker);
          this.addEventListener("message", (event) =>
            entries.push({
              direction: "receive",
              at: performance.timeOrigin + performance.now(),
              bytes: new Blob([JSON.stringify(event.data)]).size,
            }),
          );
        }
        entries.push({
          direction: "send",
          at: performance.timeOrigin + performance.now(),
          method: message?.method,
          operationId:
            typeof message?.args?.[1] === "string"
              ? message.args[1]
              : undefined,
          bytes: new Blob([JSON.stringify(message)]).size,
        });
        return Reflect.apply(original, this, args);
      };
    });
  await page.goto("/");
  const backup = fixture(condition);
  const fixtureHash = sha256(JSON.stringify(backup));
  for (const [name, items] of Object.entries(backup.data.eventLists)) {
    const one = {
      ...backup,
      data: {
        ...backup.data,
        eventLists: { [name]: items },
        mapData: name === transferEventName ? backup.data.mapData : {},
        executeModeItems:
          name === transferEventName ? backup.data.executeModeItems : {},
        dayModes: name === transferEventName ? backup.data.dayModes : {},
      },
    };
    await page
      .locator('input[aria-label="バックアップファイルを選択"]')
      .setInputFiles({
        name: `transfer-${name}.json`,
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(one), "utf8"),
      });
    const dialog = page.getByRole("dialog", {
      name: "バックアップからイベントを復元",
    });
    await dialog.getByLabel("復元するイベント").selectOption(name);
    await dialog.getByRole("radio", { name: /同名で置換/ }).check();
    await dialog.getByRole("button", { name: "置換して復元" }).click();
    await expect(dialog).toBeHidden({ timeout: 60000 });
  }
  if (condition.load === "practical") {
    await page
      .getByRole("button", { name: "イベント一覧", exact: true })
      .click();
    await page.getByText(transferEventName, { exact: true }).click();
  }
  await expect(
    page.getByRole("heading", { name: transferEventName, exact: true }),
  ).toBeVisible();
  await page.getByTitle("表示項目の設定", { exact: true }).click();
  await page.getByLabel("画面の表示倍率").selectOption("100");
  await page
    .locator("div.fixed.inset-0.z-40")
    .first()
    .click({ position: { x: 2, y: 100 } });
  const group = page
    .getByRole("button", { name: "スペース別", exact: true })
    .first();
  if (
    (await group.getAttribute("class"))?.includes("bg-blue-600") !==
    condition.grouped
  )
    await group.click();
  await expect(transferRow(page, "e0")).toBeVisible();
  await expect(transferRow(page, "c0")).toBeVisible();
  const size = await page.evaluate(
    async ({ eventName, day }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("EventShoppingPlannerDB");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<{
          count: number;
          historicalItems: number;
          mapCells: number;
        }>((resolve, reject) => {
          const tx = db.transaction(["eventLists", "mapData"]);
          const lists = tx.objectStore("eventLists").get("data");
          const map = tx
            .objectStore("mapData")
            .get(`mapData:${JSON.stringify([eventName, `${day}マップ`])}`);
          tx.oncomplete = () => {
            const all = lists.result as Record<string, unknown[]>;
            resolve({
              count: all[eventName].length,
              historicalItems: Object.entries(all)
                .filter(([name]) => name.startsWith("過去イベント"))
                .reduce((sum, [, items]) => sum + items.length, 0),
              mapCells: map.result?.cells?.length ?? 0,
            });
          };
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { eventName: transferEventName, day },
  );
  expect(size).toEqual({
    count: condition.count,
    historicalItems: condition.load === "practical" ? 10000 : 0,
    mapCells: condition.load === "practical" ? 13668 : 0,
  });
  return {
    fixtureHash,
    size,
    inputMapCells: condition.load === "practical" ? 40000 : 0,
    mapVisible: false,
  };
}
export async function installCommitProbe(page: Page) {
  const worker = page
    .workers()
    .find((entry) => entry.url().includes("persistence.worker"));
  expect(worker).toBeDefined();
  await worker!.evaluate(() => {
    const state = globalThis as unknown as {
      __transferCommits: Commit[];
      __transferCurrentOperation?: string;
    };
    state.__transferCommits = [];
    globalThis.addEventListener(
      "message",
      (event: MessageEvent<{ method?: string; args?: unknown[] }>) => {
        if (["shopping", "commitDay", "day"].includes(event.data?.method ?? ""))
          state.__transferCurrentOperation =
            typeof event.data.args?.[1] === "string"
              ? event.data.args[1]
              : undefined;
      },
      true,
    );
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      ...args: Parameters<IDBDatabase["transaction"]>
    ) {
      const tx = original.apply(this, args);
      if (tx.mode === "readwrite") {
        const commit: Commit = {
          at: 0,
          stores: Array.from(tx.objectStoreNames),
          operationId: state.__transferCurrentOperation,
          writes: [],
        };
        const store = tx.objectStore.bind(tx);
        tx.objectStore = function (name: string) {
          const value = store(name);
          for (const method of ["put", "add", "delete", "clear"] as const) {
            const write = value[method].bind(value) as (
              ...args: unknown[]
            ) => IDBRequest;
            Object.defineProperty(value, method, {
              configurable: true,
              value: (...values: unknown[]) => {
                commit.writes.push({ store: name, method });
                return write(...values);
              },
            });
          }
          return value;
        };
        tx.addEventListener("complete", () => {
          commit.at = performance.timeOrigin + performance.now();
          state.__transferCommits.push(commit);
        });
      }
      return tx;
    };
  });
  return worker!;
}
export async function waitForTransferIdle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}
async function armProbe(
  page: Page,
  id: string,
  anchor: string,
  destination: string,
  input: "native" | "touch",
  measurementId: string,
) {
  return page.evaluate(
    ({ id, anchor, destination, input, measurementId }) => {
      window.__shoppingTransferProbe?.stop?.();
      const source = destination === "execute" ? "candidate" : "execute";
      const state: Probe = {
        id,
        anchor,
        source,
        destination,
        startMs: 0,
        startEpoch: 0,
        markerDelayMs: 0,
        domMs: null,
        responseMs: null,
        matched: false,
        trusted: false,
        clicks: 0,
      };
      window.__shoppingTransferProbe = state;
      const roots = [source, destination].map(
        (column) =>
          document.querySelector(`[data-shopping-drag-column="${column}"]`)!,
      );
      const row = (column: string, item: string) =>
        document.querySelector<HTMLElement>(
          `[data-shopping-drag-column="${column}"] [data-item-id="${item}"]:not([data-space-group-key]):not(.esp-shopping-touch-clone)`,
        );
      const correct = () => {
        const target = row(destination, id),
          anchorRow = row(destination, anchor);
        return (
          !!target &&
          !!anchorRow &&
          !row(source, id) &&
          !!(
            anchorRow.compareDocumentPosition(target) &
            Node.DOCUMENT_POSITION_FOLLOWING
          ) &&
          !!target.querySelector('input[type="checkbox"]')
        );
      };
      const observer = new MutationObserver(() => {
        if (!state.startEpoch || state.domMs !== null || !correct()) return;
        state.domMs = performance.now() - state.startMs;
        performance.mark(`${measurementId}:dom`);
        requestAnimationFrame(() =>
          setTimeout(() => {
            state.matched = correct();
            state.responseMs = performance.now() - state.startMs;
            observer.disconnect();
          }, 0),
        );
      });
      const began = (event: Event) => {
        if (state.startEpoch) return;
        state.startMs = event.timeStamp;
        state.startEpoch = performance.timeOrigin + event.timeStamp;
        state.trusted = event.isTrusted;
        state.markerDelayMs = performance.now() - state.startMs;
        performance.mark(`${measurementId}:input`);
        for (const root of roots)
          observer.observe(root, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["class", "style", "data-item-id"],
          });
        if (correct()) {
          state.domMs = performance.now() - state.startMs;
          performance.mark(`${measurementId}:dom`);
          requestAnimationFrame(() =>
            setTimeout(() => {
              state.matched = correct();
              state.responseMs = performance.now() - state.startMs;
              observer.disconnect();
            }, 0),
          );
        }
      };
      const click = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (!target.matches('input[type="checkbox"]')) return;
        const targetId =
          target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId ?? "";
        const expected = state.clicks++ === 0;
        const field = expected ? "pending" : "applied";
        const eventEpoch = performance.timeOrigin + event.timeStamp;
        const queueDelayMs = performance.now() - event.timeStamp;
        requestAnimationFrame(() =>
          setTimeout(() => {
            state[field] = {
              durationMs: performance.now() - event.timeStamp,
              eventEpoch,
              targetId,
              matched:
                targetId === anchor &&
                (target as HTMLInputElement).checked === expected,
              trusted: event.isTrusted,
              queueDelayMs,
            };
          }, 0),
        );
      };
      const eventName = input === "native" ? "drop" : "touchend";
      document.addEventListener(eventName, began, {
        capture: true,
        once: true,
      });
      document.addEventListener("click", click, true);
      state.timeout = window.setTimeout(() => {
        state.failure = "Expected destination UI was not established";
        observer.disconnect();
      }, 15000);
      state.stop = () => {
        observer.disconnect();
        clearTimeout(state.timeout);
        document.removeEventListener(eventName, began, true);
        document.removeEventListener("click", click, true);
      };
      return { source, destination };
    },
    { id, anchor, destination, input, measurementId },
  );
}
async function beginGesture(
  page: Page,
  session: CDPSession,
  input: "native" | "touch",
  id: string,
  anchor: string,
) {
  const source = await transferRow(page, id).boundingBox(),
    target = await transferRow(page, anchor).boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  const from = { x: source!.x + 4, y: source!.y + 35 },
    to = {
      x: target!.x + 4,
      y: target!.y + Math.min(target!.height - 4, target!.height * 0.8),
    };
  if (input === "native") {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 12, from.y + 8, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.move(to.x + 1, to.y + 1);
  } else {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...from, id: 1 }],
    });
    await expect(page.locator(".esp-shopping-touch-clone")).toBeVisible();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...to, id: 1 }],
    });
  }
  await expect(
    page.locator('[data-shopping-drag-guide="insert"]').first(),
  ).toBeVisible();
  return to;
}
const clickAt = (session: CDPSession, point: { x: number; y: number }) => {
  const down = session.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...point,
    button: "left",
    clickCount: 1,
    timestamp: Date.now() / 1000,
  });
  const up = session.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...point,
    button: "left",
    clickCount: 1,
    timestamp: Date.now() / 1000,
  });
  return Promise.all([down, up]);
};
export async function measureTransfer(
  page: Page,
  session: CDPSession,
  worker: BrowserWorker,
  condition: TransferCondition,
  index: number,
  frame: boolean,
  testInfo: TestInfo,
) {
  const prefix = condition.direction === "candidate-to-execute" ? "c" : "e",
    destination = prefix === "c" ? "execute" : "candidate";
  const id = `${prefix}${index}`,
    anchor = prefix === "c" ? "e0" : "c0",
    measurementId = `transfer-${index}`;
  await transferRow(page, id).scrollIntoViewIfNeeded();
  await transferRow(page, anchor).scrollIntoViewIfNeeded();
  await waitForTransferIdle(page);
  const sourceBox = await transferRow(page, id).boundingBox();
  expect(sourceBox).not.toBeNull();
  const beforeFrame = frame
    ? await page.screenshot({ animations: "allow" })
    : undefined;
  const trace: TraceEvent[] = [];
  const collect = (value: { value: object[] }) => {
    trace.push(...(value.value as TraceEvent[]));
  };
  let traceStopped = false;
  let traceSaved = false;
  let screencastStopped = false;
  const capturedFrames: Array<{
    data: string;
    metadata: { timestamp?: number; [key: string]: unknown };
    sessionId: number;
    acknowledged: boolean;
  }> = [];
  const acknowledgements: Promise<unknown>[] = [];
  const capture = (event: {
    data: string;
    metadata: object;
    sessionId: number;
  }) => {
    const recorded = {
      ...event,
      metadata: event.metadata as {
        timestamp?: number;
        [key: string]: unknown;
      },
      acknowledged: false,
    };
    capturedFrames.push(recorded);
    acknowledgements.push(
      session
        .send("Page.screencastFrameAck", { sessionId: event.sessionId })
        .then(() => {
          recorded.acknowledged = true;
        }),
    );
  };
  if (frame) {
    session.on("Tracing.dataCollected", collect);
    await session.send("Tracing.start", {
      categories:
        "devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame",
      transferMode: "ReportEvents",
    });
    session.on("Page.screencastFrame", capture);
    await session.send("Page.startScreencast", {
      format: "png",
      maxWidth: 1440,
      maxHeight: 1000,
      everyNthFrame: 1,
    });
  }
  try {
    await beginGesture(page, session, condition.input, id, anchor);
    await armProbe(
      page,
      id,
      anchor,
      destination,
      condition.input,
      measurementId,
    );
    const checkbox = await transferRow(page, anchor)
      .locator('input[type="checkbox"]')
      .boundingBox();
    expect(checkbox).not.toBeNull();
    const nextPoint = {
      x: checkbox!.x + checkbox!.width / 2,
      y: checkbox!.y + checkbox!.height / 2,
    };
    // Playwright completes the browser's native drag dispatch; it does not await application persistence.
    if (condition.input === "native") await page.mouse.up();
    else
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
        timestamp: Date.now() / 1000,
      });
    // Do not wait for UI or save completion before sending the next trusted input.
    if (!frame) await clickAt(session, nextPoint);
    await page.waitForFunction(
      () =>
        window.__shoppingTransferProbe?.responseMs !== null ||
        !!window.__shoppingTransferProbe?.failure,
      {},
      { timeout: 16000 },
    );
    let state = await page.evaluate(() => ({
      ...window.__shoppingTransferProbe!,
      stop: undefined,
    }));
    expect(state.failure).toBeUndefined();
    expect(state.trusted).toBe(true);
    expect(state.matched).toBe(true);
    expect(state.responseMs).not.toBeNull();
    await expect
      .poll(async () =>
        worker.evaluate(
          (start) =>
            (
              globalThis as unknown as { __transferCommits: Commit[] }
            ).__transferCommits.filter((commit) => commit.at >= start),
          state.startEpoch,
        ),
      )
      .not.toHaveLength(0);
    const commits = await worker.evaluate(
      (start) =>
        (
          globalThis as unknown as { __transferCommits: Commit[] }
        ).__transferCommits.filter((commit) => commit.at >= start),
      state.startEpoch,
    );
    expect(commits).toHaveLength(1);
    const saved = commits[0];
    const common = {
      measurementId,
      targetId: id,
      matched: true,
      startEpoch: state.startEpoch,
      domMs: state.domMs,
      markerDelayMs: state.markerDelayMs,
      operationId: saved.operationId ?? null,
      operationIdUnavailableReason: saved.operationId
        ? undefined
        : "Persistence request did not expose an operation ID",
      commits,
    };
    if (!frame) {
      await page.waitForFunction(
        () => !!window.__shoppingTransferProbe?.pending,
      );
      state = await page.evaluate(() => ({
        ...window.__shoppingTransferProbe!,
        stop: undefined,
      }));
      expect(state.pending?.trusted).toBe(true);
      expect(state.pending?.matched).toBe(true);
      expect(
        state.pending!.eventEpoch,
        "pending input must follow this move input",
      ).toBeGreaterThan(state.startEpoch);
      expect(
        state.pending!.eventEpoch,
        "pending input must occur before this move's save complete",
      ).toBeLessThan(saved.at);
      const afterCheckbox = await transferRow(page, anchor)
        .locator('input[type="checkbox"]')
        .boundingBox();
      expect(afterCheckbox).not.toBeNull();
      await clickAt(session, {
        x: afterCheckbox!.x + afterCheckbox!.width / 2,
        y: afterCheckbox!.y + afterCheckbox!.height / 2,
      });
      await page.waitForFunction(
        () => !!window.__shoppingTransferProbe?.applied,
      );
      state = await page.evaluate(() => ({
        ...window.__shoppingTransferProbe!,
        stop: undefined,
      }));
      expect(state.applied?.trusted).toBe(true);
      expect(state.applied?.matched).toBe(true);
      expect(state.applied!.eventEpoch).toBeGreaterThan(saved.at);
      return {
        response: { ...common, durationMs: state.responseMs! },
        nextPending: { ...common, ...state.pending!, targetId: anchor },
        nextApplied: { ...common, ...state.applied!, targetId: anchor },
        save: { ...common, durationMs: saved.at - state.startEpoch },
      };
    }
    // A final reference is auxiliary: it never substitutes for a captured compositor frame.
    await page.evaluate(async () => {
      const row = document.querySelector<HTMLElement>(
        `[data-shopping-drag-column="${window.__shoppingTransferProbe!.destination}"] [data-item-id="${window.__shoppingTransferProbe!.id}"]:not([data-space-group-key])`,
      )!;
      let previous = "",
        stable = 0;
      const began = performance.now();
      await new Promise<void>((resolve, reject) => {
        function check() {
          let opacity = 1;
          for (
            let node: HTMLElement | null = row;
            node;
            node = node.parentElement
          )
            opacity *= Number(getComputedStyle(node).opacity);
          const rect = row.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + 20,
            rect.top + Math.min(40, rect.height / 2),
          );
          const geometry = JSON.stringify([
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            scrollY,
          ]);
          stable =
            opacity >= 0.999 && row.contains(hit) && geometry === previous
              ? stable + 1
              : 0;
          previous = geometry;
          if (stable >= 3) {
            resolve();
            return;
          }
          if (performance.now() - began > 10000) {
            reject(
              new Error("Target never became opaque, hit-testable and stable"),
            );
            return;
          }
          requestAnimationFrame(check);
        }
        requestAnimationFrame(check);
      });
    });
    const targetBox = await transferRow(page, id).boundingBox();
    expect(targetBox).not.toBeNull();
    const reference = await page.screenshot({ animations: "allow" });
    await session.send("Page.stopScreencast");
    screencastStopped = true;
    session.off("Page.screencastFrame", capture);
    await Promise.all(acknowledgements);
    const complete = new Promise<void>((resolve) =>
      session.once("Tracing.tracingComplete", () => resolve()),
    );
    await session.send("Tracing.end");
    await complete;
    traceStopped = true;
    session.off("Tracing.dataCollected", collect);
    const tracePath = testInfo.outputPath(`${measurementId}-trace.json`),
      referencePath = testInfo.outputPath(`${measurementId}-reference.png`),
      baselinePath = testInfo.outputPath(`${measurementId}-baseline.png`);
    const traceBytes = Buffer.from(
      JSON.stringify({ traceEvents: trace }),
      "utf8",
    );
    await writeFile(tracePath, traceBytes);
    traceSaved = true;
    await writeFile(referencePath, reference);
    await writeFile(baselinePath, beforeFrame!);
    await testInfo.attach(`${measurementId}-trace`, {
      path: tracePath,
      contentType: "application/json",
    });
    await testInfo.attach(`${measurementId}-reference`, {
      path: referencePath,
      contentType: "image/png",
    });
    const marks = trace.filter(
        (event) => event.name === `${measurementId}:input`,
      ),
      dom = trace.find((event) => event.name === `${measurementId}:dom`);
    expect(marks).toHaveLength(1);
    expect(dom).toBeDefined();
    const mark = marks[0];
    const sourceRect = {
        x: sourceBox!.x,
        y: sourceBox!.y,
        width: sourceBox!.width,
        height: Math.min(sourceBox!.height, 180),
      },
      targetRect = {
        x: targetBox!.x,
        y: targetBox!.y,
        width: targetBox!.width,
        height: Math.min(targetBox!.height, 180),
      };
    const covers = (event: TraceEvent, rect: Rect) => {
      const clip = event.args?.data?.clip;
      if (!clip || clip.length < 8) return false;
      const xs = clip.filter((_, i) => i % 2 === 0),
        ys = clip.filter((_, i) => i % 2 === 1);
      return (
        Math.min(...xs) <= rect.x &&
        Math.max(...xs) >= rect.x + rect.width &&
        Math.min(...ys) <= rect.y &&
        Math.max(...ys) >= rect.y + rect.height
      );
    };
    const paints = trace.filter(
      (event) =>
        event.name === "Paint" && event.pid === dom!.pid && event.ts >= dom!.ts,
    );
    const candidateComparisons: unknown[] = [];
    let selected:
      | {
          data: string;
          metadata: { timestamp?: number; [key: string]: unknown };
          sessionId: number;
          acknowledged: boolean;
          traceTs: number;
        }
      | undefined;
    let comparison: unknown;
    let paint: TraceEvent | undefined;
    let sourcePaint: TraceEvent | undefined;
    let draw: TraceEvent | undefined;
    for (const captured of capturedFrames) {
      if (
        !captured.acknowledged ||
        !Number.isFinite(captured.metadata.timestamp)
      )
        continue;
      const frameEpochMs = captured.metadata.timestamp! * 1000;
      const frameTraceTs =
        mark.ts +
        (frameEpochMs - state.startEpoch - state.markerDelayMs) * 1000;
      if (frameTraceTs < dom!.ts) continue;
      const targetPaint = paints.find(
        (event) => event.ts <= frameTraceTs && covers(event, targetRect),
      );
      const removedSourcePaint = paints.find(
        (event) => event.ts <= frameTraceTs && covers(event, sourceRect),
      );
      if (!targetPaint || !removedSourcePaint) continue;
      const drawFrame = trace.find(
        (event) =>
          event.name === "DrawFrame" &&
          event.pid === dom!.pid &&
          event.ts >= Math.max(targetPaint.ts, removedSourcePaint.ts) &&
          event.ts <= frameTraceTs,
      );
      if (!drawFrame) continue;
      const checked = await compareFrameContent(
        page,
        captured.data,
        reference.toString("base64"),
        beforeFrame!.toString("base64"),
        [sourceRect, targetRect],
      );
      const candidatePath = testInfo.outputPath(
        `${measurementId}-candidate-${candidateComparisons.length}.png`,
      );
      const candidateBytes = Buffer.from(captured.data, "base64");
      await writeFile(candidatePath, candidateBytes);
      candidateComparisons.push({
        frameSwapEpochMs: frameEpochMs,
        framePath: candidatePath,
        frameSha256: sha256(candidateBytes),
        captureTs: frameTraceTs,
        checked,
        sourceRect,
        targetRect,
      });
      if (checked.matched) {
        selected = { ...captured, traceTs: frameTraceTs };
        comparison = checked;
        paint = targetPaint;
        sourcePaint = removedSourcePaint;
        draw = drawFrame;
        break;
      }
    }
    await testInfo.attach(`${measurementId}-frame-verification`, {
      body: JSON.stringify(candidateComparisons, null, 2),
      contentType: "application/json",
    });
    expect(
      selected,
      "No captured compositor frame had verified source/destination card content after the corresponding Paint/DrawFrame",
    ).toBeDefined();
    const frameBytes = Buffer.from(selected!.data, "base64"),
      framePath = testInfo.outputPath(`${measurementId}-frame.png`);
    await writeFile(framePath, frameBytes);
    await testInfo.attach(`${measurementId}-frame`, {
      path: framePath,
      contentType: "image/png",
    });
    const durationMs = selected!.metadata.timestamp! * 1000 - state.startEpoch;
    const frameMetadata = {
      method: "Page.startScreencast",
      format: "png",
      maxWidth: 1440,
      maxHeight: 1000,
      everyNthFrame: 1,
      sessionId: selected!.sessionId,
      acknowledged: selected!.acknowledged,
      metadata: selected!.metadata,
      frameSha256: sha256(frameBytes),
    };
    const metadataBytes = Buffer.from(JSON.stringify(frameMetadata), "utf8");
    const frameMetadataPath = testInfo.outputPath(
      `${measurementId}-frame-metadata.json`,
    );
    await writeFile(frameMetadataPath, metadataBytes);
    return {
      frame: {
        ...common,
        durationMs,
        frameTimestampMs: durationMs,
        captureMethod: "Page.startScreencast(png)",
        captureTimestampKind: "frame-swap-upper-bound",
        frameMetadataPath,
        frameMetadataSha256: sha256(metadataBytes),
        frameVerified: true,
        sourceAbsent: true,
        destinationOrderVerified: true,
        controlsVerified: true,
        paintCorrelated: true,
        drawFrameCorrelated: true,
        tracePath,
        traceSha256: sha256(traceBytes),
        framePath,
        frameSha256: sha256(frameBytes),
        referencePath,
        referenceSha256: sha256(reference),
        baselinePath,
        baselineSha256: sha256(beforeFrame!),
        correlation: {
          input: { pid: mark.pid, ts: mark.ts },
          dom: { pid: dom!.pid, ts: dom!.ts },
          paint: {
            pid: paint!.pid,
            ts: paint!.ts,
            clip: paint!.args?.data?.clip,
          },
          drawFrame: { pid: draw!.pid, ts: draw!.ts },
          frame: {
            epochMs: selected!.metadata.timestamp! * 1000,
            traceTs: selected!.traceTs,
            sessionId: selected!.sessionId,
          },
          sourcePaint: {
            pid: sourcePaint!.pid,
            ts: sourcePaint!.ts,
            clip: sourcePaint!.args?.data?.clip,
          },
          sourceRect,
          targetRect,
          comparison,
        },
        rpc: await page.evaluate(
          (start) =>
            window.__shoppingTransferRpc?.filter((event) => event.at >= start),
          state.startEpoch,
        ),
      },
    };
  } catch (error) {
    const state = await page.evaluate(() => ({
      probe: { ...window.__shoppingTransferProbe, stop: undefined },
      columns: [
        ...document.querySelectorAll<HTMLElement>(
          "[data-shopping-drag-column]",
        ),
      ].map((root) => ({
        column: root.dataset.shoppingDragColumn,
        ids: [
          ...root.querySelectorAll<HTMLElement>(
            "[data-item-id]:not([data-space-group-key])",
          ),
        ]
          .slice(0, 10)
          .map((row) => row.dataset.itemId),
      })),
    }));
    await testInfo.attach(`${measurementId}-failed-observation`, {
      body: JSON.stringify(state, null, 2),
      contentType: "application/json",
    });
    throw error;
  } finally {
    await page.evaluate(() => window.__shoppingTransferProbe?.stop?.());
    if (frame) {
      if (!screencastStopped) await session.send("Page.stopScreencast");
      session.off("Page.screencastFrame", capture);
      await Promise.all(acknowledgements);
      if (!traceStopped) {
        const complete = new Promise<void>((resolve) =>
          session.once("Tracing.tracingComplete", () => resolve()),
        );
        await session.send("Tracing.end");
        await complete;
      }
      session.off("Tracing.dataCollected", collect);
      if (!traceSaved) {
        const output = testInfo.outputPath(
          `${measurementId}-failed-trace.json`,
        );
        await writeFile(output, JSON.stringify({ traceEvents: trace }), "utf8");
        await testInfo.attach(`${measurementId}-failed-trace`, {
          path: output,
          contentType: "application/json",
        });
      }
    }
  }
}
async function compareFrameContent(
  page: Page,
  frame: string,
  reference: string,
  baseline: string,
  rects: Rect[],
) {
  return page.evaluate(
    async ({ frame, reference, baseline, rects }) => {
      const image = async (data: string, mime: string) => {
        const bytes = Uint8Array.from(atob(data), (character) =>
          character.charCodeAt(0),
        );
        return createImageBitmap(new Blob([bytes], { type: mime }));
      };
      const [actual, expected, before] = await Promise.all([
        image(frame, "image/png"),
        image(reference, "image/png"),
        image(baseline, "image/png"),
      ]);
      const crop = (bitmap: ImageBitmap, rect: Rect) => {
        const canvas = new OffscreenCanvas(
            Math.ceil(rect.width),
            Math.ceil(rect.height),
          ),
          context = canvas.getContext("2d")!;
        context.drawImage(
          bitmap,
          (rect.x * bitmap.width) / innerWidth,
          (rect.y * bitmap.height) / innerHeight,
          (rect.width * bitmap.width) / innerWidth,
          (rect.height * bitmap.height) / innerHeight,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      // Compare dark foreground ink, preserving glyph shape and opacity while excluding
      // the allowed striping/hover background color transition from readiness.
      const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
        let disagreement = 0,
          inkWeight = 0;
        for (let i = 0; i < a.length; i += 4) {
          const ink = (pixels: Uint8ClampedArray) =>
            Math.max(
              0,
              170 -
                (0.2126 * pixels[i] +
                  0.7152 * pixels[i + 1] +
                  0.0722 * pixels[i + 2]),
            ) / 170;
          const actualInk = ink(a),
            expectedInk = ink(b);
          disagreement += Math.abs(actualInk - expectedInk);
          inkWeight += Math.max(actualInk, expectedInk);
        }
        return inkWeight > 0 ? disagreement / inkWeight : 1;
      };
      try {
        // Normalize complete images to the trace screenshot raster before comparing glyphs.
        const resize = (bitmap: ImageBitmap) => {
          const canvas = new OffscreenCanvas(actual.width, actual.height);
          canvas
            .getContext("2d")!
            .drawImage(bitmap, 0, 0, actual.width, actual.height);
          return canvas.transferToImageBitmap();
        };
        const normalizedExpected = resize(expected),
          normalizedBefore = resize(before);
        const scores = rects.map((rect) => {
          const identityRect = {
            x: rect.x + 70,
            y: rect.y + 5,
            width: Math.min(300, rect.width - 70),
            height: Math.min(100, rect.height - 5),
          };
          const controls = [
            {
              x: rect.x + 7,
              y: rect.y + 7,
              width: 38,
              height: 30,
            },
            {
              x: rect.x + rect.width - 200,
              y: rect.y + 5,
              width: 190,
              height: Math.min(75, rect.height - 5),
            },
          ];
          const ref = crop(normalizedExpected, identityRect);
          return {
            frameError: difference(crop(actual, identityRect), ref),
            baselineError: difference(
              crop(normalizedBefore, identityRect),
              ref,
            ),
            controlErrors: controls.map((control) =>
              difference(
                crop(actual, control),
                crop(normalizedExpected, control),
              ),
            ),
          };
        });
        normalizedExpected.close();
        normalizedBefore.close();
        return {
          method: "dark-ink-shape-native-v2",
          matched: scores.every(
            (score) =>
              score.baselineError > 0.001 &&
              score.frameError <= 0.025 &&
              score.frameError < score.baselineError * 0.55 &&
              score.controlErrors.every((error) => error <= 0.025),
          ),
          scores,
        };
      } finally {
        actual.close();
        expected.close();
        before.close();
      }
    },
    { frame, reference, baseline, rects },
  );
}
