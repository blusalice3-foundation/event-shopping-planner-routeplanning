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
export type TransferMeasurementOptions = {
  sourceId?: string;
  anchorId?: string;
  measurementId?: string;
  sourceColumn?: "execute" | "candidate";
  sameColumn?: boolean;
  expectedTransferredIds?: readonly string[];
  anchorPosition?: "before" | "after" | "any";
  gestureTargetSelector?: string;
  guideKind?: "insert" | "merge" | "either";
  pendingInput?: boolean;
  gesture?: () => Promise<Record<string, unknown> | void>;
  recaptureAfterGesture?: boolean;
  scenarioEvidence?: Record<string, unknown>;
};
type Rect = { x: number; y: number; width: number; height: number };
export type FrameRect = Rect & {
  itemId: string;
  role: "source-gap" | "source-origin" | "destination-card";
};
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
  probeCpuMs: number;
  probeChecks: number;
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
      bytes?: number;
      payload?: unknown;
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
export function createTransferFixture(condition: TransferCondition) {
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
    makeItem(`e${i}`, half - i),
  );
  const candidate = Array.from({ length: condition.count - half }, (_, i) =>
    makeItem(`c${i}`, half + i + 1),
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
const rpcProbePages = new WeakSet<Page>();
export async function restoreTransferFixture(
  page: Page,
  condition: TransferCondition,
  frame: boolean,
  customBackup?: ReturnType<typeof createTransferFixture>,
) {
  if (frame && !rpcProbePages.has(page)) {
    rpcProbePages.add(page);
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
              payload: event.data,
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
          payload: message,
        });
        return Reflect.apply(original, this, args);
      };
    });
  }
  await page.goto("/");
  const backup = customBackup ?? createTransferFixture(condition);
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
  options: Pick<
    TransferMeasurementOptions,
    | "sourceColumn"
    | "sameColumn"
    | "expectedTransferredIds"
    | "anchorPosition"
    | "pendingInput"
  > = {},
) {
  return page.evaluate(
    ({ id, anchor, destination, input, measurementId, options }) => {
      window.__shoppingTransferProbe?.stop?.();
      const source =
        options.sourceColumn ??
        (destination === "execute" ? "candidate" : "execute");
      const state: Probe = {
        id,
        anchor,
        source,
        destination,
        startMs: 0,
        startEpoch: 0,
        markerDelayMs: 0,
        probeCpuMs: 0,
        probeChecks: 0,
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
      const rootByColumn = new Map([
        [source, roots[0]],
        [destination, roots[1]],
      ]);
      const row = (column: string, item: string) =>
        rootByColumn
          .get(column)!
          .querySelector<HTMLElement>(
            `[data-item-id="${item}"]:not([data-space-group-key]):not(.esp-shopping-touch-clone)`,
          );
      const correct = () => {
        const began = performance.now();
        state.probeChecks++;
        try {
          const target = row(destination, id),
            anchorRow = row(destination, anchor);
          if (!target || !anchorRow) return false;
          const removed = options.expectedTransferredIds ?? [id];
          if (!options.sameColumn && removed.some((item) => row(source, item)))
            return false;
          const position = options.anchorPosition ?? "after";
          if (
            position !== "any" &&
            !(
              anchorRow.compareDocumentPosition(target) &
              (position === "after"
                ? Node.DOCUMENT_POSITION_FOLLOWING
                : Node.DOCUMENT_POSITION_PRECEDING)
            )
          )
            return false;
          // DOM response checks every mounted moved card without forcing layout.
          // Actual viewport visibility and pixels are proved separately by the frame pass.
          return removed.every((item) => {
            const element = row(destination, item);
            return (
              !element || !!element.querySelector('input[type="checkbox"]')
            );
          });
        } finally {
          state.probeCpuMs += performance.now() - began;
        }
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
        const field =
          options.pendingInput === false
            ? "applied"
            : expected
              ? "pending"
              : "applied";
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
    { id, anchor, destination, input, measurementId, options },
  );
}
export async function beginGesture(
  page: Page,
  session: CDPSession,
  input: "native" | "touch",
  id: string,
  anchor: string,
  options: Pick<
    TransferMeasurementOptions,
    "gestureTargetSelector" | "guideKind"
  > = {},
) {
  const source = await transferRow(page, id).boundingBox(),
    target = await (
      options.gestureTargetSelector
        ? page.locator(options.gestureTargetSelector)
        : transferRow(page, anchor)
    ).boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  let from = { x: source!.x + 4, y: source!.y + 35 };
  let sourceOrigin = "card-edge";
  if (input === "touch") {
    const blocked = await page.evaluate(
      (point) =>
        !!document
          .elementFromPoint(point.x, point.y)
          ?.closest("[data-no-long-press],button,input,select,textarea,a"),
      from,
    );
    if (blocked) {
      const handle = await transferRow(page, id)
        .locator("[data-drag-handle]")
        .boundingBox();
      expect(
        handle,
        "selected touch source needs an actual drag handle",
      ).not.toBeNull();
      from = {
        x: handle!.x + handle!.width / 2,
        y: handle!.y + handle!.height / 2,
      };
      expect(
        await page.evaluate(
          (point) =>
            !!document
              .elementFromPoint(point.x, point.y)
              ?.closest("[data-drag-handle]") &&
            !document
              .elementFromPoint(point.x, point.y)
              ?.closest("[data-no-long-press]"),
          from,
        ),
      ).toBe(true);
      sourceOrigin = "drag-handle";
    }
  }
  const to = {
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
    page
      .locator(
        options.guideKind === "either"
          ? `[data-shopping-drag-guide],[data-shopping-drag-status="accepted"]`
          : `[data-shopping-drag-guide="${options.guideKind ?? "insert"}"],[data-shopping-drag-column="candidate"] [data-shopping-drag-status="accepted"]`,
      )
      .first(),
  ).toBeVisible();
  return { ...to, sourcePoint: from, sourceOrigin };
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
  options: TransferMeasurementOptions = {},
) {
  const prefix = condition.direction === "candidate-to-execute" ? "c" : "e",
    destination = options.sameColumn
      ? (options.sourceColumn ?? (prefix === "c" ? "candidate" : "execute"))
      : prefix === "c"
        ? "execute"
        : "candidate";
  const id = options.sourceId ?? `${prefix}${index}`,
    anchor =
      options.anchorId ??
      (prefix === "c" ? "e0" : index > 0 ? `e${index - 1}` : "c0"),
    measurementId = options.measurementId ?? `transfer-${index}`;
  await transferRow(page, id).scrollIntoViewIfNeeded();
  await transferRow(page, anchor).scrollIntoViewIfNeeded();
  await waitForTransferIdle(page);
  const collectSourceOrigins = () =>
    page.evaluate(
      (ids) =>
        ids
          .flatMap((itemId) => {
            const element = document.querySelector<HTMLElement>(
              `[data-item-id="${itemId}"]:not([data-space-group-key]):not(.esp-shopping-touch-clone)`,
            );
            if (!element) return [];
            const r = element.getBoundingClientRect();
            if (
              r.bottom <= 0 ||
              r.top >= innerHeight ||
              r.right <= 0 ||
              r.left >= innerWidth
            )
              return [];
            return [
              {
                itemId,
                x: Math.max(0, r.x),
                y: Math.max(0, r.y),
                width: Math.min(innerWidth, r.right) - Math.max(0, r.x),
                height: Math.min(
                  180,
                  Math.min(innerHeight, r.bottom) - Math.max(0, r.y),
                ),
                role: "source-gap" as const,
              },
            ];
          })
          .sort((a, b) => a.y - b.y || a.x - b.x),
      [...(options.expectedTransferredIds ?? [id])],
    );
  let sourceRects: FrameRect[] = frame ? await collectSourceOrigins() : [];
  let sourceBox = await transferRow(page, id).boundingBox();
  expect(sourceBox).not.toBeNull();
  let beforeFrame = frame
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
    const gestureObservation = options.gesture
      ? await options.gesture()
      : await beginGesture(page, session, condition.input, id, anchor, options);
    if (frame && options.recaptureAfterGesture) {
      sourceRects = await collectSourceOrigins();
      sourceBox = await transferRow(page, id).boundingBox();
      expect(sourceBox).not.toBeNull();
      beforeFrame = await page.screenshot({ animations: "allow" });
    }
    if (frame) {
      expect(
        sourceRects.some((rect) => rect.itemId === id),
        "primary source origin must remain physically visible before drop",
      ).toBe(true);
      for (const rect of sourceRects)
        expect(
          rect.height,
          `${rect.itemId}: source identity must be observable before drop`,
        ).toBeGreaterThan(20);
    }
    await armProbe(
      page,
      id,
      anchor,
      destination,
      condition.input,
      measurementId,
      {
        sourceColumn: options.sourceColumn,
        sameColumn: options.sameColumn,
        expectedTransferredIds: options.expectedTransferredIds,
        anchorPosition:
          options.anchorPosition ?? (prefix === "e" ? "before" : "after"),
        pendingInput: options.pendingInput,
      },
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
    if (!frame && options.pendingInput !== false)
      await clickAt(session, nextPoint);
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
    const observedVisibleIds = await page.evaluate(
      ({ ids, destination }) =>
        ids.filter((item) => {
          const element = document.querySelector<HTMLElement>(
            `[data-shopping-drag-column="${destination}"] [data-item-id="${item}"]:not([data-space-group-key]):not(.esp-shopping-touch-clone)`,
          );
          if (!element) return false;
          const r = element.getBoundingClientRect();
          return (
            r.bottom > 0 &&
            r.top < innerHeight &&
            r.right > 0 &&
            r.left < innerWidth
          );
        }),
      { ids: [...(options.expectedTransferredIds ?? [id])], destination },
    );
    const common = {
      measurementId,
      targetId: id,
      matched: true,
      startEpoch: state.startEpoch,
      domMs: state.domMs,
      markerDelayMs: state.markerDelayMs,
      probeCpuMs: state.probeCpuMs,
      probeChecks: state.probeChecks,
      operationId: saved.operationId ?? null,
      operationIdUnavailableReason: saved.operationId
        ? undefined
        : "Persistence request did not expose an operation ID",
      commits,
      gestureObservation,
      scenarioEvidence: options.scenarioEvidence,
      expectedTransferredIds: options.expectedTransferredIds ?? [id],
      visibleTransferredIds: observedVisibleIds,
    };
    if (!frame) {
      if (options.pendingInput !== false) {
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
      }
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
        ...(options.pendingInput !== false
          ? { nextPending: { ...common, ...state.pending!, targetId: anchor } }
          : {}),
        nextApplied: { ...common, ...state.applied!, targetId: anchor },
        save: { ...common, durationMs: saved.at - state.startEpoch },
      };
    }
    // A final reference is auxiliary: it never substitutes for a captured compositor frame.
    const visibleTargets = await page.evaluate(
      async ({ ids, destination }) => {
        const rows = () =>
          ids.flatMap((itemId) => {
            const element = document.querySelector<HTMLElement>(
              `[data-shopping-drag-column="${destination}"] [data-item-id="${itemId}"]:not([data-space-group-key]):not(.esp-shopping-touch-clone)`,
            );
            if (!element) return [];
            const r = element.getBoundingClientRect();
            if (
              r.bottom <= 0 ||
              r.top >= innerHeight ||
              r.right <= 0 ||
              r.left >= innerWidth
            )
              return [];
            return [{ itemId, element, r }];
          });
        let previous = "",
          stable = 0;
        const began = performance.now();
        await new Promise<void>((resolve, reject) => {
          function check() {
            const entries = rows();
            const ready =
              entries.length > 0 &&
              entries.every(({ element, r }) => {
                let opacity = 1;
                for (
                  let node: HTMLElement | null = element;
                  node;
                  node = node.parentElement
                )
                  opacity *= Number(getComputedStyle(node).opacity);
                const y =
                  Math.max(0, r.top) +
                  Math.min(
                    35,
                    (Math.min(innerHeight, r.bottom) - Math.max(0, r.top)) / 2,
                  );
                return (
                  opacity >= 0.999 &&
                  element.contains(document.elementFromPoint(r.left + 20, y)) &&
                  !!element.querySelector('input[type="checkbox"]')
                );
              });
            const geometry = JSON.stringify([
              scrollY,
              ...entries.map(({ itemId, r }) => [
                itemId,
                r.x,
                r.y,
                r.width,
                r.height,
              ]),
            ]);
            stable = ready && geometry === previous ? stable + 1 : 0;
            previous = geometry;
            if (stable >= 3) return resolve();
            if (performance.now() - began > 10000)
              return reject(
                new Error(
                  "Visible moved cards never became opaque, hit-testable and stable",
                ),
              );
            requestAnimationFrame(check);
          }
          requestAnimationFrame(check);
        });
        return rows()
          .sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x)
          .map(({ itemId, r }) => ({
            itemId,
            x: Math.max(0, r.x),
            y: Math.max(0, r.y),
            width: Math.min(innerWidth, r.right) - Math.max(0, r.x),
            height: Math.min(
              180,
              Math.min(innerHeight, r.bottom) - Math.max(0, r.y),
            ),
            role: "destination-card" as const,
          }));
      },
      { ids: [...(options.expectedTransferredIds ?? [id])], destination },
    );
    expect(
      visibleTargets.some((row) => row.itemId === id),
      "primary moved card must be physically visible",
    ).toBe(true);
    for (const target of visibleTargets)
      expect(
        target.height,
        `${target.itemId}: card identity must be observable inside viewport`,
      ).toBeGreaterThan(20);
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
    const sourceRect = sourceRects.find((rect) => rect.itemId === id)!;
    const targetRects: FrameRect[] = visibleTargets;
    const targetRect = targetRects.find((rect) => rect.itemId === id)!;
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
    let selectedSourcePaints: Array<{
      itemId: string;
      pid: number;
      ts: number;
      clip?: number[];
    }> = [];
    let selectedTargetPaints: Array<{
      itemId: string;
      pid: number;
      ts: number;
      clip?: number[];
    }> = [];
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
      const targetPaints = targetRects.map((rect) => ({
        itemId: rect.itemId,
        paint: paints.find(
          (event) => event.ts <= frameTraceTs && covers(event, rect),
        ),
      }));
      const targetPaint = targetPaints.find(
        (entry) => entry.itemId === id,
      )?.paint;
      const sourcePaints = sourceRects.map((rect) => ({
        itemId: rect.itemId,
        paint: paints.find(
          (event) => event.ts <= frameTraceTs && covers(event, rect),
        ),
      }));
      const removedSourcePaint = sourcePaints.find(
        (entry) => entry.itemId === id,
      )?.paint;
      if (
        !targetPaint ||
        !removedSourcePaint ||
        targetPaints.some((entry) => !entry.paint) ||
        sourcePaints.some((entry) => !entry.paint)
      )
        continue;
      const drawFrame = trace.find(
        (event) =>
          event.name === "DrawFrame" &&
          event.pid === dom!.pid &&
          event.ts >=
            Math.max(
              ...sourcePaints.map((entry) => entry.paint!.ts),
              ...targetPaints.map((entry) => entry.paint!.ts),
            ) &&
          event.ts <= frameTraceTs,
      );
      if (!drawFrame) continue;
      const checked = await compareFrameContent(
        page,
        captured.data,
        reference.toString("base64"),
        beforeFrame!.toString("base64"),
        [...sourceRects, ...targetRects],
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
        sourceRects,
        targetRect,
        targetRects,
      });
      if (checked.matched) {
        selected = { ...captured, traceTs: frameTraceTs };
        comparison = checked;
        paint = targetPaint;
        sourcePaint = removedSourcePaint;
        draw = drawFrame;
        selectedSourcePaints = sourcePaints.map(({ itemId, paint }) => ({
          itemId,
          pid: paint!.pid,
          ts: paint!.ts,
          clip: paint!.args?.data?.clip,
        }));
        selectedTargetPaints = targetPaints.map(({ itemId, paint }) => ({
          itemId,
          pid: paint!.pid,
          ts: paint!.ts,
          clip: paint!.args?.data?.clip,
        }));
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
        visibleTransferredIds: targetRects.map((rect) => rect.itemId),
        allVisibleDestinationCardsVerified: true,
        visibleSourceIds: sourceRects.map((rect) => rect.itemId),
        sourceOriginsVerified: true,
        sourceAbsent: !options.sameColumn,
        sourceOriginVacated: !!options.sameColumn,
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
          sourceRects,
          sourceProofs: sourceRects.map((rect, index) => ({
            sourceId: rect.itemId,
            rect,
            paint: selectedSourcePaints.find(
              (paint) => paint.itemId === rect.itemId,
            ),
            scoreIndex: index,
          })),
          targetRect,
          targetRects,
          targetPaints: selectedTargetPaints,
          targetProofs: targetRects.map((rect, index) => ({
            targetId: rect.itemId,
            rect,
            paint: selectedTargetPaints.find(
              (paint) => paint.itemId === rect.itemId,
            ),
            scoreIndex: sourceRects.length + index,
          })),
          comparison,
        },
        rpc: await page.evaluate(
          (start) =>
            window.__shoppingTransferRpc
              ?.filter((event) => event.at >= start)
              .map(({ payload, ...metadata }) => ({
                ...metadata,
                bytes: new Blob([JSON.stringify(payload)]).size,
              })),
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
export async function compareFrameContent(
  page: Page,
  frame: string,
  reference: string,
  baseline: string,
  rects: FrameRect[],
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
              height: Math.min(30, rect.height - 7),
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
            itemId: rect.itemId,
            role: rect.role,
            rect,
            identityRect,
            controlRects: controls,
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

export async function readTransferDurable(page: Page) {
  return page.evaluate(async (eventName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{
        items: Array<{ id: string; number: string; [key: string]: unknown }>;
        executeIds: string[];
        historicalItems: number;
      }>((resolve, reject) => {
        const tx = db.transaction(["eventLists", "executeModeItems"]);
        const lists = tx.objectStore("eventLists").get("data");
        const execute = tx.objectStore("executeModeItems").get("data");
        const scoped = tx
          .objectStore("executeModeItems")
          .get(
            "__esp_internal__:day-record:v1:" +
              JSON.stringify([eventName, ["1日目"]]),
          );
        tx.oncomplete = () => {
          const all = lists.result as Record<
            string,
            Array<{ id: string; number: string; [key: string]: unknown }>
          >;
          resolve({
            items: all[eventName],
            executeIds:
              scoped.result?.value ??
              execute.result?.[eventName]?.["1日目"] ??
              [],
            historicalItems: Object.entries(all)
              .filter(([name]) => name.startsWith("過去イベント"))
              .reduce((sum, [, items]) => sum + items.length, 0),
          });
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, transferEventName);
}
export async function verifyContinuousTransferResult(
  page: Page,
  condition: TransferCondition,
) {
  const saved = await readTransferDurable(page);
  const half = Math.floor(condition.count / 2);
  const execute = Array.from({ length: half }, (_, i) => `e${i}`);
  const candidates = Array.from(
    { length: condition.count - half },
    (_, i) => `c${i}`,
  );
  const moved = Array.from({ length: 21 }, (_, i) => i).reverse();
  let expectedItems = [...execute, ...candidates];
  if (condition.direction === "execute-to-candidate") {
    let executing = new Set(execute);
    const number = (id: string) =>
      id.startsWith("e")
        ? half - Number(id.slice(1))
        : half + Number(id.slice(1)) + 1;
    // The user-visible candidate order is numeric, while durable order retains
    // all event slots and uses the next displayed item as the insertion boundary.
    for (let i = 0; i <= 20; i++) {
      const id = `e${i}`;
      const rawCandidates = expectedItems.filter(
        (item) => !executing.has(item),
      );
      const displayed = [...rawCandidates].sort(
        (a, b) => number(a) - number(b),
      );
      const anchor = i === 0 ? "c0" : `e${i - 1}`;
      const boundary = displayed[displayed.indexOf(anchor) + 1];
      const insert = boundary
        ? rawCandidates.indexOf(boundary)
        : rawCandidates.length;
      rawCandidates.splice(insert, 0, id);
      const remaining = expectedItems.filter(
        (item) => executing.has(item) && item !== id,
      );
      let candidateIndex = 0,
        executeIndex = 0;
      expectedItems = expectedItems.map((item) =>
        executing.has(item) && item !== id
          ? remaining[executeIndex++]
          : rawCandidates[candidateIndex++],
      );
      executing = new Set(remaining);
    }
  }
  const expectedExecute =
    condition.direction === "candidate-to-execute"
      ? ["e0", ...moved.map((i) => `c${i}`), ...execute.slice(1)]
      : execute.slice(21);
  expect(saved.items.map((item) => item.id)).toEqual(expectedItems);
  expect(saved.executeIds).toEqual(expectedExecute);
  const expectedVisible =
    condition.direction === "execute-to-candidate"
      ? [...moved.map((i) => `e${i}`), ...candidates]
      : ["e0", ...moved.map((i) => `c${i}`), ...execute.slice(1)];
  const visiblePrefix = await page.evaluate(
    (column) =>
      [
        ...document.querySelectorAll<HTMLElement>(
          `[data-shopping-drag-column="${column}"] [data-item-id]:not([data-space-group-key]):not(.esp-shopping-touch-clone)`,
        ),
      ]
        .filter((row) => !!row.querySelector('input[type="checkbox"]'))
        .slice(0, 8)
        .map((row) => row.dataset.itemId),
    condition.direction === "execute-to-candidate" ? "candidate" : "execute",
  );
  expect(visiblePrefix).toEqual(expectedVisible.slice(0, visiblePrefix.length));
  expect(saved.historicalItems).toBe(
    condition.load === "practical" ? 10000 : 0,
  );
  return {
    expectedItems,
    expectedExecute,
    actualItems: saved.items.map((item) => item.id),
    actualExecute: saved.executeIds,
    historicalItems: saved.historicalItems,
  };
}
