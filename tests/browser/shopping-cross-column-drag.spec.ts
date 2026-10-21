import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { summarizePerformanceSamples } from "./performance-summary";
import {
  shoppingEvidenceIdentity,
  shoppingBrowserEnvironment,
} from "./shopping-performance-evidence";

test.use({
  video: "off",
  trace: "off",
  viewport: { width: 1440, height: 1000 },
});
const eventName = "列間ドラッグ検証";
const day = "1日目";
type Input = "native" | "touch";
const makeItem = (
  id: string,
  number: string,
  block = "A",
  priorityLevel = "none",
) => ({
  id,
  eventDate: day,
  circle: id,
  title: "ユーザー登録",
  block,
  number,
  price: 500,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "エラーが発生しました",
  priorityLevel,
});
function fixture(count = 150, candidateOrder = false) {
  const execute = candidateOrder
    ? [makeItem("two", "2")]
    : [
        makeItem("a1", "01a"),
        makeItem("a2", "01a2"),
        makeItem("b1", "02a"),
        makeItem("priority", "03a", "A", "priority"),
        ...Array.from({ length: Math.floor(count / 2) - 5 }, (_, i) =>
          makeItem(
            `execute-${i}`,
            String(i + 10),
            i % 5 === 0 ? "B" : "A",
            i % 7 === 0 ? "priority" : "none",
          ),
        ),
        makeItem("offscreen", "999a", "B"),
      ];
  const candidate = candidateOrder
    ? [makeItem("one", "1"), makeItem("three", "3")]
    : [
        makeItem("merge-a", "01a3"),
        makeItem("merge-b", "02a2"),
        makeItem("new-x", "04a"),
        makeItem("bad-priority", "05a", "A", "priority"),
        makeItem("merge-offscreen", "999a2", "B"),
        ...Array.from({ length: count - execute.length - 5 }, (_, i) =>
          makeItem(`new-${i}`, String(i + 1000)),
        ),
      ];
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-18T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: {
        [eventName]: candidateOrder
          ? [...candidate, ...execute]
          : [...execute, ...candidate],
      },
      eventMetadata: {},
      executeModeItems: {
        [eventName]: { [day]: execute.map((item) => item.id) },
      },
      dayModes: { [eventName]: { [day]: "edit" } },
      mapData: {},
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {
        [eventName]: {
          [`__mapless__:${day}`]: [
            { id: "hall-a", name: "Aホール", vertices: [], blockNames: ["A"] },
            { id: "hall-b", name: "Bホール", vertices: [], blockNames: ["B"] },
          ],
        },
      } as Record<
        string,
        Record<
          string,
          Array<{
            id: string;
            name: string;
            vertices: Array<{ row: number; col: number }>;
            blockNames: string[];
          }>
        >
      >,
      hallRouteSettings: {},
    },
  };
}
function performanceFixture(count: number) {
  const backup = fixture(count);
  // One visible priority visit keeps all pointer cases inside the real viewport; both hall and priority constraints remain active.
  backup.data.eventLists[eventName].forEach((item) => {
    if (item.id.startsWith("execute-")) item.priorityLevel = "none";
  });
  const mapKey = `${day}マップ`;
  const blocks = ["A", "B"].map((name, index) => {
    const values = [
      ...new Set(
        backup.data.eventLists[eventName]
          .filter((item) => item.block === name)
          .map((item) => Number.parseInt(item.number, 10)),
      ),
    ].sort((a, b) => a - b);
    const firstColumn = index * 13 + 2;
    return {
      name,
      startRow: 1,
      startCol: firstColumn - 1,
      endRow: Math.ceil(values.length / 10) + 2,
      endCol: firstColumn + 10,
      numberCells: values.map((value, position) => ({
        row: Math.floor(position / 10) + 2,
        col: firstColumn + (position % 10),
        value,
      })),
    };
  });
  Object.assign(backup.data.mapData, {
    [eventName]: {
      [mapKey]: {
        maxRow: Math.max(...blocks.map((block) => block.endRow)),
        maxCol: 27,
        cells: [],
        mergedCells: [],
        blocks,
      },
    },
  });
  backup.data.hallDefinitions[eventName] = {
    [mapKey]: blocks.map((block, index) => ({
      id: index === 0 ? "hall-a" : "hall-b",
      name: `${block.name}ホール`,
      blockNames: [block.name],
      vertices: [
        { row: block.startRow, col: block.startCol },
        { row: block.startRow, col: block.endCol },
        { row: block.endRow, col: block.endCol },
        { row: block.endRow, col: block.startCol },
      ],
    })),
  };
  const order = backup.data.executeModeItems[eventName][day];
  order.splice(order.indexOf("priority"), 1);
  order.unshift("priority");
  return backup;
}
async function restore(
  page: Page,
  value: ReturnType<typeof fixture>,
  legacy = false,
) {
  await page.goto("/");
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "drag.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(value), "utf8"),
    });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog.getByRole("button", { name: "置換して復元" }).click();
  await expect(dialog).toBeHidden({ timeout: 60000 });
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
  if (!legacy)
    await expect(
      page.locator('[data-shopping-drag-column="execute"]'),
    ).toBeVisible();
}
async function reopen(page: Page) {
  await page.reload();
  await page.getByText(eventName, { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: eventName, exact: true }),
  ).toBeVisible();
}
async function grouping(page: Page, enabled: boolean) {
  const button = page
    .getByRole("button", { name: "スペース別", exact: true })
    .first();
  if ((await button.getAttribute("class"))?.includes("bg-blue-600") !== enabled)
    await button.click();
}
const rowSelector = (id: string) =>
  `[data-item-id=${JSON.stringify(id)}]:not([data-space-group-key]):not(.esp-shopping-touch-clone)`;
async function start(page: Page, input: Input, id: string) {
  let source = page.locator(rowSelector(id));
  const collapsed = page.locator(
    `[data-space-group-key][data-item-id=${JSON.stringify(id)}]`,
  );
  if ((await source.count()) === 0 && (await collapsed.count()) > 0)
    source = collapsed;
  if ((await source.count()) === 0) {
    await page
      .getByRole("listitem", { name: new RegExp(` ${id} ユーザー登録$`) })
      .scrollIntoViewIfNeeded();
    await expect(source).toBeAttached();
  }
  await source.scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
  });
  return page.evaluate(
    async ({ input, id }) => {
      const row = document.querySelector<HTMLElement>(
        `[data-item-id=${JSON.stringify(id)}]:not([data-space-group-key]), [data-space-group-key][data-item-id=${JSON.stringify(id)}]`,
      )!;
      const rect = row.getBoundingClientRect();
      const point = { clientX: rect.left + 20, clientY: rect.top + 30 };
      const began = performance.now();
      let activated = began;
      const state = window as unknown as {
        __dragTransfer?: DataTransfer;
        __dragSource?: string;
      };
      state.__dragSource = id;
      if (input === "native") {
        state.__dragTransfer = new DataTransfer();
        row.dispatchEvent(
          new DragEvent("dragstart", {
            bubbles: true,
            cancelable: true,
            dataTransfer: state.__dragTransfer,
            ...point,
          }),
        );
      } else {
        await new Promise<void>((resolve) => {
          const observer = new MutationObserver(() => {
            if (document.querySelector(".esp-shopping-touch-clone")) {
              activated = performance.now();
              observer.disconnect();
              resolve();
            }
          });
          observer.observe(document.body, { childList: true });
          const touch = new Touch({ identifier: 1, target: row, ...point });
          row.dispatchEvent(
            new TouchEvent("touchstart", {
              bubbles: true,
              cancelable: true,
              touches: [touch],
              changedTouches: [touch],
            }),
          );
        });
      }
      await new Promise(requestAnimationFrame);
      await new Promise((resolve) => setTimeout(resolve, 0));
      return {
        totalMs: performance.now() - began,
        fallbackMs: performance.now() - began - (input === "touch" ? 200 : 0),
        intentionalLongPressMs: input === "touch" ? 200 : 0,
        postClonePaintMs: performance.now() - activated,
        renderer: Array.from(
          document.querySelectorAll<HTMLElement>("[data-list-renderer]"),
        ).map((root, index) => ({
          column:
            root.dataset.shoppingDragColumn ?? ["execute", "candidate"][index],
          engine: root.dataset.listRenderer,
          strategy: root.dataset.listRendererStrategy,
          mounted: root.querySelectorAll(
            "[data-item-id]:not([data-space-group-key])",
          ).length,
        })),
      };
    },
    { input, id },
  );
}
async function hover(
  page: Page,
  input: Input,
  id: string,
  edge: "before" | "after",
  grouped: boolean,
  scroll = 0,
) {
  return page.evaluate(
    async ({ input, id, edge, grouped, scroll }) => {
      const state = window as unknown as {
        __dragTransfer: DataTransfer;
        __dragSource: string;
      };
      const target = document.querySelector<HTMLElement>(
        `[data-item-id=${JSON.stringify(id)}]:not([data-space-group-key])`,
      )!;
      const root = target.closest<HTMLElement>("[data-shopping-drag-column]")!;
      const header = grouped
        ? root.querySelector<HTMLElement>(`[data-space-group-key]`)
        : null;
      const owner = grouped
        ? target.closest<HTMLElement>('[data-row-key^="group:"]')
        : null;
      const top = (owner ?? target).getBoundingClientRect();
      const next =
        id === "a1"
          ? root.querySelector<HTMLElement>(
              '[data-item-id="a2"]:not([data-space-group-key])',
            )
          : null;
      const bottom = owner ? top : (next ?? target).getBoundingClientRect();
      const y =
        edge === "before"
          ? top.top + Math.max(4, (bottom.bottom - top.top) * 0.25)
          : top.top + Math.max(6, (bottom.bottom - top.top) * 0.75);
      const x = top.left + 20;
      const scrollBefore = window.scrollY;
      const began = performance.now();
      if (scroll) window.scrollBy(0, scroll);
      if (input === "native")
        target.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            dataTransfer: state.__dragTransfer,
            clientX: x,
            clientY: y,
          }),
        );
      else {
        const source = document.querySelector<HTMLElement>(
          `[data-item-id=${JSON.stringify(state.__dragSource)}]:not([data-space-group-key]), [data-space-group-key][data-item-id=${JSON.stringify(state.__dragSource)}]`,
        )!;
        const touch = new Touch({
          identifier: 1,
          target: source,
          clientX: x,
          clientY: y,
        });
        source.dispatchEvent(
          new TouchEvent("touchmove", {
            bubbles: true,
            cancelable: true,
            touches: [touch],
            changedTouches: [touch],
          }),
        );
      }
      await new Promise(requestAnimationFrame);
      await new Promise((resolve) => setTimeout(resolve, 0));
      // Keep the existing response interval separate from the guide audit reads.
      const ms = performance.now() - began;
      return {
        ms,
        viewportScroll: { before: scrollBefore, after: window.scrollY },
        status: root.querySelector<HTMLElement>("[data-shopping-drag-status]")
          ?.dataset.shoppingDragStatus,
        text: root.querySelector("[data-shopping-drag-status]")?.textContent,
        guides: Array.from(
          root.querySelectorAll<HTMLElement>("[data-shopping-drag-guide]"),
        ).map((line) => {
          const owner = line.parentElement!;
          const ownerRect = owner.getBoundingClientRect();
          const lineRect = line.getBoundingClientRect();
          const rowKey = owner.dataset.rowKey ?? owner.dataset.viewportRowKey;
          const identity =
            owner.dataset.itemId ??
            (rowKey?.startsWith("item:")
              ? (JSON.parse(rowKey.slice(5)) as string)
              : rowKey);
          return {
            kind: line.dataset.shoppingDragGuide,
            edge: line.dataset.shoppingDragBoundary,
            owner: identity,
            offsetPx:
              line.dataset.shoppingDragBoundary === "before"
                ? Math.abs(lineRect.top - ownerRect.top)
                : Math.abs(lineRect.bottom - ownerRect.bottom),
            ownerRect: { top: ownerRect.top, bottom: ownerRect.bottom },
            guideRect: { top: lineRect.top, bottom: lineRect.bottom },
          };
        }),
        header: !!header,
      };
    },
    { input, id, edge, grouped, scroll },
  );
}
async function autoScroll(page: Page, input: Input) {
  return page.evaluate(async (input) => {
    const state = window as unknown as {
      __dragTransfer: DataTransfer;
      __dragSource: string;
    };
    const root = document.querySelector<HTMLElement>(
      '[data-shopping-drag-column="execute"]',
    )!;
    let x = 0;
    let y = 0;
    let target: HTMLElement | null = null;
    for (const card of root.querySelectorAll<HTMLElement>(
      "[data-item-id]:not([data-space-group-key])",
    )) {
      const rect = card.getBoundingClientRect();
      const top = Math.max(rect.top + 4, window.innerHeight - 95);
      const bottom = Math.min(rect.bottom - 4, window.innerHeight - 5);
      if (bottom < top || rect.width <= 0) continue;
      const cardX = rect.left + Math.min(20, rect.width / 2);
      const cardY = (top + bottom) / 2;
      const hit = document
        .elementFromPoint(cardX, cardY)
        ?.closest<HTMLElement>("[data-item-id]:not([data-space-group-key])");
      if (hit !== card) continue;
      target = card;
      x = cardX;
      y = cardY;
      break;
    }
    if (!target)
      throw new Error(
        "No mounted execution card in the native/touch auto-scroll trigger region",
      );
    const source = document.querySelector<HTMLElement>(
      `[data-shopping-drag-column="candidate"] [data-item-id=${JSON.stringify(state.__dragSource)}]:not([data-space-group-key])`,
    )!;
    if (!source && input === "touch")
      throw new Error("Touch source must remain mounted while dragging");
    const before = window.scrollY;
    let removeListener: () => void = () => {};
    const scrolled = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        removeListener();
        reject(new Error("The product drag auto-scroll did not scroll"));
      }, 2000);
      const listener = () => {
        if (window.scrollY <= before) return;
        clearTimeout(timeout);
        removeListener();
        resolve();
      };
      removeListener = () => window.removeEventListener("scroll", listener);
      window.addEventListener("scroll", listener);
    });
    const sendTouch = (clientY: number) => {
      const touch = new Touch({
        identifier: 1,
        target: source,
        clientX: x,
        clientY,
      });
      source.dispatchEvent(
        new TouchEvent("touchmove", {
          bubbles: true,
          cancelable: true,
          touches: [touch],
          changedTouches: [touch],
        }),
      );
    };
    const began = performance.now();
    if (input === "native")
      target.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: state.__dragTransfer,
          clientX: x,
          clientY: y,
        }),
      );
    else sendTouch(y);
    await scrolled;
    // Leave the trigger region through the real touch handler so its interval stops before the next sample.
    if (input === "touch") sendTouch(window.innerHeight / 2);
    await new Promise(requestAnimationFrame);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const guides = Array.from(
      root.querySelectorAll<HTMLElement>("[data-shopping-drag-guide]"),
    ).map((line) => {
      const owner = line.parentElement!;
      const ownerRect = owner.getBoundingClientRect();
      const lineRect = line.getBoundingClientRect();
      const rowKey = owner.dataset.rowKey ?? owner.dataset.viewportRowKey;
      const identity =
        owner.dataset.itemId ??
        (rowKey?.startsWith("item:")
          ? (JSON.parse(rowKey.slice(5)) as string)
          : rowKey);
      return {
        kind: line.dataset.shoppingDragGuide,
        edge: line.dataset.shoppingDragBoundary,
        owner: identity,
        offsetPx:
          line.dataset.shoppingDragBoundary === "before"
            ? Math.abs(lineRect.top - ownerRect.top)
            : Math.abs(lineRect.bottom - ownerRect.bottom),
        viewportTop: lineRect.top,
        ownerTop: ownerRect.top,
      };
    });
    return {
      ms: performance.now() - began,
      scrollBefore: before,
      scrollAfter: window.scrollY,
      trigger: { targetId: target.dataset.itemId, x, y },
      status: root.querySelector<HTMLElement>("[data-shopping-drag-status]")
        ?.dataset.shoppingDragStatus,
      guides,
    };
  }, input);
}
async function finish(
  page: Page,
  input: Input,
  drop: boolean,
  targetColumn = "execute",
  resultId?: string,
) {
  return page.evaluate(
    async ({ input, drop, targetColumn, resultId }) => {
      const state = window as unknown as {
        __dragTransfer: DataTransfer;
        __dragSource: string;
      };
      const source = document.querySelector<HTMLElement>(
        `[data-item-id=${JSON.stringify(state.__dragSource)}]:not([data-space-group-key]), [data-space-group-key][data-item-id=${JSON.stringify(state.__dragSource)}]`,
      );
      const root = document.querySelector<HTMLElement>(
        `[data-shopping-drag-column="${targetColumn}"]`,
      )!;
      const diagnostics = window as unknown as {
        __dragRenderProbe?: {
          cost: () => {
            callbacks: number;
            enabledCallbacks: number;
            overheadMs: number;
            commitTimes: number[];
          };
        };
        __dragDropDiagnostics?: Array<Record<string, unknown>>;
        __dragRpcEvents?: Array<{
          direction: string;
          at: number;
          id: unknown;
          type: unknown;
        }>;
      };
      const probeBefore = diagnostics.__dragRenderProbe?.cost();
      const rpcIndex = diagnostics.__dragRpcEvents?.length ?? 0;
      const sourceGroup = diagnostics.__dragRpcEvents
        ? source?.closest<HTMLElement>(
            '[data-row-key^="group:"], [data-viewport-row-key^="group:"]',
          )
        : undefined;
      const sourceGroupRowKey =
        sourceGroup?.dataset.rowKey ?? sourceGroup?.dataset.viewportRowKey;
      const sourceGroupKey = sourceGroupRowKey?.startsWith("group:")
        ? (JSON.parse(sourceGroupRowKey.slice(6)) as string)
        : undefined;
      let outerPlaceholderAt: number | undefined;
      let outerActiveAt: number | undefined;
      let placeholderAt: number | undefined;
      let observedAt: number | undefined;
      let stopObserving: (() => void) | undefined;
      const rendered = resultId
        ? new Promise<void>((resolve, reject) => {
            const observer = new MutationObserver(check);
            const timeout = setTimeout(() => {
              observer.disconnect();
              reject(
                new Error(
                  `Dropped item ${resultId} was not rendered in ${targetColumn}`,
                ),
              );
            }, 5000);
            function check() {
              const rowKey = `item:${JSON.stringify(resultId)}`;
              if (diagnostics.__dragRpcEvents && sourceGroupRowKey) {
                if (
                  outerPlaceholderAt === undefined &&
                  root.querySelector(
                    `[data-row-key=${JSON.stringify(sourceGroupRowKey)}], [data-viewport-row-key=${JSON.stringify(sourceGroupRowKey)}]`,
                  )
                )
                  outerPlaceholderAt = performance.now();
                if (
                  outerActiveAt === undefined &&
                  sourceGroupKey &&
                  root.querySelector(
                    `[data-space-group-key=${JSON.stringify(sourceGroupKey)}]`,
                  )
                )
                  outerActiveAt = performance.now();
              }
              if (
                diagnostics.__dragRpcEvents &&
                placeholderAt === undefined &&
                root.querySelector(
                  `[data-row-key=${JSON.stringify(rowKey)}], [data-viewport-row-key=${JSON.stringify(rowKey)}]`,
                )
              )
                placeholderAt = performance.now();
              if (
                !root.querySelector(
                  `[data-item-id=${JSON.stringify(resultId)}]:not([data-space-group-key])`,
                )
              )
                return;
              observedAt = performance.now();
              observer.disconnect();
              clearTimeout(timeout);
              resolve();
            }
            observer.observe(root, { childList: true, subtree: true });
            stopObserving = () => {
              observer.disconnect();
              clearTimeout(timeout);
            };
            check();
          })
        : null;
      const began = performance.now();
      if (input === "native") {
        if (drop)
          root.dispatchEvent(
            new DragEvent("drop", {
              bubbles: true,
              cancelable: true,
              dataTransfer: state.__dragTransfer,
            }),
          );
        source?.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
      } else
        source?.dispatchEvent(
          new TouchEvent(drop ? "touchend" : "touchcancel", {
            bubbles: true,
            cancelable: true,
            touches: [],
            changedTouches: [],
          }),
        );
      const dispatchEnded = performance.now();
      try {
        if (rendered) await rendered;
        await new Promise(requestAnimationFrame);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const paintedAt = performance.now();
        const probeAfter = diagnostics.__dragRenderProbe?.cost();
        if (resultId) {
          diagnostics.__dragDropDiagnostics ??= [];
          diagnostics.__dragDropDiagnostics.push({
            id: resultId,
            dispatchMs: dispatchEnded - began,
            ...(diagnostics.__dragRpcEvents
              ? {
                  sourceGroupRowKey,
                  outerPlaceholderMs:
                    outerPlaceholderAt === undefined
                      ? null
                      : outerPlaceholderAt - began,
                  outerActiveMs:
                    outerActiveAt === undefined ? null : outerActiveAt - began,
                  placeholderMs:
                    placeholderAt === undefined ? null : placeholderAt - began,
                  rpc: diagnostics.__dragRpcEvents
                    .slice(rpcIndex)
                    .map((event) => ({ ...event, at: event.at - began })),
                  commitsMs: probeAfter?.commitTimes
                    .slice(probeBefore?.callbacks ?? 0)
                    .map((at) => at - began),
                }
              : {}),
            observedMs: observedAt === undefined ? null : observedAt - began,
            paintedMs: paintedAt - began,
            probeOverheadMs:
              (probeAfter?.overheadMs ?? 0) - (probeBefore?.overheadMs ?? 0),
            commitCallbacks:
              (probeAfter?.callbacks ?? 0) - (probeBefore?.callbacks ?? 0),
            measuredCommitCallbacks:
              (probeAfter?.enabledCallbacks ?? 0) -
              (probeBefore?.enabledCallbacks ?? 0),
          });
        }
        return paintedAt - began;
      } finally {
        stopObserving?.();
      }
    },
    { input, drop, targetColumn, resultId },
  );
}
async function stored(
  page: Page,
  storeName: string,
): Promise<Record<string, unknown>> {
  return page.evaluate(async (storeName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const store = db.transaction(storeName).objectStore(storeName);
        const request = store.get("data");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          if (request.result?.kind !== "event-shopping-planner-day-records") {
            resolve(request.result);
            return;
          }
          const rows: { eventName: string; path: string[]; value: unknown }[] =
            [];
          const cursor = store.openCursor(
            IDBKeyRange.bound(
              "__esp_internal__:day-record:v1:",
              "__esp_internal__:day-record:v1:\uffff",
            ),
          );
          cursor.onerror = () => reject(cursor.error);
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (row) {
              rows.push(row.value);
              row.continue();
              return;
            }
            const data: Record<string, Record<string, unknown>> = {};
            for (const row of rows.filter((row) => !row.path.length))
              data[row.eventName] = row.value as Record<string, unknown>;
            for (const row of rows.filter((row) => row.path.length)) {
              const parent =
                row.path.length === 2
                  ? (data[row.eventName].days as Record<string, unknown>)
                  : data[row.eventName];
              parent[row.path.at(-1)!] = row.value;
            }
            resolve(data);
          };
        };
      });
    } finally {
      db.close();
    }
  }, storeName);
}
async function fixtureConsistencyShape(page: Page) {
  const value = (await stored(page, "eventConsistency"))[eventName];
  const contexts: Array<{
    path: string[];
    assignments: number;
    hallVisitLists: number;
  }> = [];
  const walk = (entry: unknown, path: string[]) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const record = entry as Record<string, unknown>;
    if ("assignments" in record || "hallVisitLists" in record) {
      contexts.push({
        path,
        assignments:
          record.assignments && typeof record.assignments === "object"
            ? Object.keys(record.assignments).length
            : 0,
        hallVisitLists: Array.isArray(record.hallVisitLists)
          ? record.hallVisitLists.length
          : 0,
      });
    }
    for (const [key, child] of Object.entries(record)) {
      if (key !== "assignments" && key !== "hallVisitLists")
        walk(child, [...path, key]);
    }
  };
  walk(value, []);
  return {
    contexts,
    totalAssignments: contexts.reduce(
      (sum, context) => sum + context.assignments,
      0,
    ),
    totalHallVisitLists: contexts.reduce(
      (sum, context) => sum + context.hallVisitLists,
      0,
    ),
  };
}
async function ids(page: Page, column: string) {
  return page
    .locator(
      `[data-shopping-drag-column="${column}"] [data-item-id]:not([data-space-group-key])`,
    )
    .evaluateAll((rows) =>
      rows.map((row) => (row as HTMLElement).dataset.itemId),
    );
}
function selectionFixture(sourceColumn: "candidate" | "execute") {
  const backup = fixture(6);
  backup.data.eventLists[eventName] = [
    makeItem("move-1", "11"),
    makeItem("move-2", "12"),
    makeItem("move-3", "13"),
    makeItem("source-stay", "14"),
    makeItem("target", "21"),
    makeItem("outside", "22"),
  ];
  backup.data.executeModeItems[eventName][day] =
    sourceColumn === "execute"
      ? ["move-1", "move-2", "move-3", "source-stay"]
      : ["target", "outside"];
  return backup;
}
const selectionBox = (page: Page, id: string) =>
  page.locator(rowSelector(id)).getByRole("checkbox");
const headerMove = (page: Page, column: "candidate" | "execute") =>
  page.getByRole("button", {
    name:
      column === "candidate"
        ? /^選択したアイテムを実行列に移動 /u
        : /^選択したアイテムを実行列から戻す /u,
  });
async function actualSelectionDrag(page: Page, id: string, targetId: string) {
  await page
    .locator(rowSelector(id))
    .dragTo(page.locator(rowSelector(targetId)), {
      sourcePosition: { x: 4, y: 40 },
      targetPosition: { x: 4, y: 30 },
    });
}
async function savedExecuteIds(page: Page): Promise<string[]> {
  return (
    (await stored(page, "executeModeItems"))[eventName] as Record<
      string,
      string[]
    >
  )[day];
}
for (const sourceColumn of ["candidate", "execute"] as const) {
  for (const kind of ["single", "multiple", "range"] as const) {
    test(`selection after actual native cross-column transfer: ${sourceColumn} ${kind}`, async ({
      page,
    }) => {
      await restore(page, selectionFixture(sourceColumn));
      await grouping(page, false);
      const targetColumn =
        sourceColumn === "candidate" ? "execute" : "candidate";
      const moving =
        kind === "single"
          ? ["move-1"]
          : kind === "multiple"
            ? ["move-1", "move-3"]
            : ["move-1", "move-2", "move-3"];
      if (kind === "range") {
        const displayed = (await ids(page, sourceColumn)).filter(
          (id): id is string => !!id && moving.includes(id),
        );
        await selectionBox(page, displayed[0]).check();
        await selectionBox(page, displayed.at(-1)!).check();
        await page
          .getByTitle("範囲内のチェックを入れる", { exact: true })
          .first()
          .click();
      } else {
        for (const id of moving) await selectionBox(page, id).check();
      }
      await expect(headerMove(page, sourceColumn)).toHaveText(
        new RegExp(`\\(${moving.length}件\\)$`, "u"),
      );
      await expect(headerMove(page, targetColumn)).toHaveCount(0);
      // Mixed-column selection intentionally hides both header move buttons.
      // After transfer, the unrelated target check must be the only one left.
      await selectionBox(page, "outside").check();
      await expect(headerMove(page, sourceColumn)).toHaveCount(0);
      await expect(headerMove(page, targetColumn)).toHaveCount(0);
      for (const id of moving)
        await expect(selectionBox(page, id)).toBeChecked();
      const before = await savedExecuteIds(page);
      const afterFirst =
        sourceColumn === "candidate"
          ? [...before, ...moving]
          : before.filter((id) => !moving.includes(id));

      await actualSelectionDrag(page, moving[0], "target");
      await expect
        .poll(async () => (await savedExecuteIds(page)).slice().sort())
        .toEqual(afterFirst.slice().sort());
      for (const id of moving) {
        await expect(
          page.locator(
            `[data-shopping-drag-column="${targetColumn}"] ${rowSelector(id)}`,
          ),
        ).toBeVisible();
        await expect(selectionBox(page, id)).not.toBeChecked();
      }
      await expect(selectionBox(page, "outside")).toBeChecked();
      await expect(headerMove(page, sourceColumn)).toHaveCount(0);
      await expect(headerMove(page, targetColumn)).toHaveText(/\(1件\)$/u);
      await expect(
        page.getByTitle("範囲内のチェックを外す", { exact: true }),
      ).toHaveCount(0);

      // A single new click must check only that card, and the next drag must use
      // exactly the two IDs shown by the parent header count.
      await selectionBox(page, moving[0]).check();
      await expect(selectionBox(page, moving[0])).toBeChecked();
      for (const id of moving.slice(1))
        await expect(selectionBox(page, id)).not.toBeChecked();
      await expect(headerMove(page, targetColumn)).toHaveText(/\(2件\)$/u);
      await actualSelectionDrag(page, moving[0], "source-stay");
      const nextIds = [moving[0], "outside"];
      const afterSecond =
        sourceColumn === "execute"
          ? [...afterFirst, ...nextIds]
          : afterFirst.filter((id) => !nextIds.includes(id));
      await expect
        .poll(async () => (await savedExecuteIds(page)).slice().sort())
        .toEqual(afterSecond.slice().sort());
      for (const id of nextIds) {
        await expect(
          page.locator(
            `[data-shopping-drag-column="${sourceColumn}"] ${rowSelector(id)}`,
          ),
        ).toBeVisible();
        await expect(selectionBox(page, id)).not.toBeChecked();
      }
      for (const id of moving.slice(1))
        await expect(
          page.locator(
            `[data-shopping-drag-column="${targetColumn}"] ${rowSelector(id)}`,
          ),
        ).toBeVisible();
      await expect(headerMove(page, "candidate")).toHaveCount(0);
      await expect(headerMove(page, "execute")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "選択を解除", exact: true }),
      ).toHaveCount(0);
    });
  }
}

test("selection restores a hidden candidate check and excludes it from the visible drag", async ({
  page,
}) => {
  const backup = selectionFixture("candidate");
  backup.data.eventLists[eventName].find(
    (item) => item.id === "move-3",
  )!.block = "B";
  await restore(page, backup);
  await grouping(page, false);
  await selectionBox(page, "move-1").check();
  await selectionBox(page, "move-3").check();
  await expect(headerMove(page, "candidate")).toHaveText(/\(2件\)$/u);
  const filter = page.getByRole("button", { name: "A", exact: true });
  await filter.click();
  await expect(page.locator(rowSelector("move-3"))).toHaveCount(0);
  await expect(headerMove(page, "candidate")).toHaveText(/\(2件\)$/u);
  await filter.click();
  await expect(selectionBox(page, "move-3")).toBeChecked();
  await expect(selectionBox(page, "move-1")).toBeChecked();
  await filter.click();
  await actualSelectionDrag(page, "move-1", "target");
  await expect
    .poll(async () => (await savedExecuteIds(page)).includes("move-1"))
    .toBe(true);
  expect(await savedExecuteIds(page)).not.toContain("move-3");
  await expect(headerMove(page, "candidate")).toHaveText(/\(1件\)$/u);
  await expect(headerMove(page, "execute")).toHaveCount(0);
  await filter.click();
  await expect(selectionBox(page, "move-3")).toBeChecked();
  await expect(selectionBox(page, "move-1")).not.toBeChecked();
});

for (const column of ["candidate", "execute"] as const) {
  test(`selection survives same-column native reorder: ${column}`, async ({
    page,
  }) => {
    await restore(page, selectionFixture(column));
    await grouping(page, false);
    await selectionBox(page, "move-1").check();
    await selectionBox(page, "move-2").check();
    await expect(headerMove(page, column)).toHaveText(/\(2件\)$/u);
    const readOrder = async () =>
      column === "execute"
        ? savedExecuteIds(page)
        : (
            (await stored(page, "eventLists"))[eventName] as { id: string }[]
          ).map((item) => item.id);
    const before = await readOrder();
    await start(page, "native", "move-1");
    await hover(
      page,
      "native",
      "source-stay",
      column === "candidate" ? "before" : "after",
      false,
    );
    await finish(page, "native", true, column);
    await expect.poll(readOrder).not.toEqual(before);
    expect((await readOrder()).slice().sort()).toEqual(before.slice().sort());
    await expect(selectionBox(page, "move-1")).toBeChecked();
    await expect(selectionBox(page, "move-2")).toBeChecked();
    await expect(headerMove(page, column)).toHaveText(/\(2件\)$/u);
    await expect(
      page.getByTitle("範囲内のチェックを入れる", { exact: true }),
    ).toHaveCount(0);
  });
}
for (const input of ["native", "touch"] as const) {
  test(`execution group boundary and durable order: ${input}`, async ({
    page,
  }) => {
    await restore(page, fixture());
    await grouping(page, true);
    await start(page, input, "new-x");
    const guide = await hover(page, input, "a1", "after", true);
    expect(guide.guides.filter((line) => line.kind === "insert")).toHaveLength(
      1,
    );
    expect(guide.guides[0].edge).toBe("after");
    await finish(page, input, true);
    await expect
      .poll(async () =>
        (
          (await stored(page, "executeModeItems"))[eventName] as Record<
            string,
            string[]
          >
        )[day].slice(0, 4),
      )
      .toEqual(["a1", "a2", "new-x", "b1"]);
    await reopen(page);
    await expect(page.locator(rowSelector("new-x"))).toBeVisible();
    expect((await ids(page, "execute")).slice(0, 4)).toEqual([
      "a1",
      "a2",
      "new-x",
      "b1",
    ]);
  });
  for (const sort of [null, "asc", "desc"] as const)
    test(`candidate ${sort ?? "null"} keeps existing save and reload rules: ${input}`, async ({
      page,
    }) => {
      await restore(page, fixture(3, true));
      await grouping(page, false);
      await page.getByRole("button", { name: "A", exact: true }).click();
      if (sort) {
        await page.getByRole("button", { name: /^番号.*並べ替え$/ }).click();
        if (sort === "desc")
          await page.getByRole("button", { name: /^番号.*並べ替え$/ }).click();
      }
      await start(page, input, "two");
      await page
        .locator('[data-shopping-drag-column="candidate"]')
        .evaluate((root, input) => {
          const state = window as unknown as {
            __dragTransfer: DataTransfer;
            __dragSource: string;
          };
          root.scrollIntoView({ block: "end" });
          const rect = root.getBoundingClientRect();
          const endX = rect.left + 8;
          let endY = Math.min(rect.bottom - 4, window.innerHeight - 120);
          let found = false;
          for (
            let y = Math.min(rect.bottom - 4, window.innerHeight - 120);
            y >= Math.max(rect.top, 0) && !found;
            y -= 8
          ) {
            const under = document.elementFromPoint(endX, y);
            if (
              under?.closest("[data-shopping-drag-column]") === root &&
              !under.closest("[data-item-id]")
            ) {
              endY = y;
              found = true;
            }
          }
          if (!found) throw new Error("Candidate end zone is not visible");
          if (input === "native")
            root.dispatchEvent(
              new DragEvent("dragover", {
                bubbles: true,
                cancelable: true,
                dataTransfer: state.__dragTransfer,
                clientX: endX,
                clientY: endY,
              }),
            );
          else {
            const source = document.querySelector<HTMLElement>(
              '[data-item-id="two"]',
            )!;
            const touch = new Touch({
              identifier: 1,
              target: source,
              clientX: endX,
              clientY: endY,
            });
            source.dispatchEvent(
              new TouchEvent("touchmove", {
                bubbles: true,
                cancelable: true,
                touches: [touch],
                changedTouches: [touch],
              }),
            );
          }
        }, input);
      await expect(
        page.locator(
          '[data-shopping-drag-column="candidate"] [data-shopping-drag-guide]',
        ),
      ).toHaveCount(0);
      await finish(page, input, true, "candidate");
      await expect
        .poll(
          async () =>
            (
              (await stored(page, "executeModeItems"))[eventName] as Record<
                string,
                string[]
              >
            )[day],
        )
        .toEqual([]);
      const raw =
        sort === "desc" ? ["three", "one", "two"] : ["one", "three", "two"];
      await expect
        .poll(async () =>
          (
            (await stored(page, "eventLists"))[eventName] as { id: string }[]
          ).map((item) => item.id),
        )
        .toEqual(raw);
      expect(await ids(page, "candidate")).toEqual(
        sort === null ? ["one", "two", "three"] : raw,
      );
      await reopen(page);
      expect(await ids(page, "candidate")).toEqual(["one", "two", "three"]);
      expect(
        ((await stored(page, "eventLists"))[eventName] as { id: string }[]).map(
          (item) => item.id,
        ),
      ).toEqual(raw);
    });
}

for (const input of ["native", "touch"] as const)
  for (const grouped of [true, false]) {
    test(`mixed insertion and multiple durable merges: ${input} grouping ${grouped}`, async ({
      page,
    }) => {
      await restore(page, fixture());
      await grouping(page, grouped);
      await select(page, ["merge-a", "merge-b", "new-x"]);
      await start(page, input, "merge-a");
      const result = await hover(page, input, "a1", "before", grouped);
      expect(
        result.guides.filter((line) => line.kind === "merge"),
      ).toHaveLength(2);
      expect(
        result.guides.filter((line) => line.kind === "insert"),
      ).toHaveLength(1);
      await finish(page, input, true);
      const expected = ["new-x", "a1", "a2", "merge-a", "b1", "merge-b"];
      await expect
        .poll(async () =>
          (
            (await stored(page, "executeModeItems"))[eventName] as Record<
              string,
              string[]
            >
          )[day].slice(0, 6),
        )
        .toEqual(expected);
      await reopen(page);
      await expect(page.locator(rowSelector("new-x"))).toBeVisible();
      expect((await ids(page, "execute")).slice(0, 6)).toEqual(expected);
    });
    test(`scrolled offscreen merge keeps its notice visible: ${input} grouping ${grouped}`, async ({
      page,
    }, testInfo) => {
      const backup = fixture();
      for (const item of backup.data.eventLists[eventName]) {
        if (item.id === "a1") item.number = "9000a";
        if (item.id === "a2") item.number = "9000a2";
        if (item.id === "merge-a") item.number = "9000a3";
      }
      await restore(page, backup);
      await grouping(page, grouped);
      await start(page, input, "merge-a");
      await page.evaluate(async (input) => {
        const root = document.querySelector<HTMLElement>(
          '[data-shopping-drag-column="execute"]',
        )!;
        const target = Array.from(
          root.querySelectorAll<HTMLElement>(
            "[data-item-id]:not([data-space-group-key])",
          ),
        ).find((element) => {
          const rect = element.getBoundingClientRect();
          const x = rect.left + 20;
          const y = Math.max(180, rect.top + 30);
          return (
            rect.bottom > y + 10 &&
            y < window.innerHeight - 150 &&
            document
              .elementFromPoint(x, y)
              ?.closest("[data-shopping-drag-column]") === root
          );
        });
        if (!target)
          throw new Error("No visible execution target after scrolling");
        const rect = target.getBoundingClientRect();
        const point = {
          clientX: rect.left + 20,
          clientY: Math.max(180, rect.top + 30),
        };
        const state = window as unknown as {
          __dragTransfer: DataTransfer;
          __dragSource: string;
        };
        if (input === "native")
          target.dispatchEvent(
            new DragEvent("dragover", {
              bubbles: true,
              cancelable: true,
              dataTransfer: state.__dragTransfer,
              ...point,
            }),
          );
        else {
          const source = document.querySelector<HTMLElement>(
            `[data-item-id=${JSON.stringify(state.__dragSource)}]:not([data-space-group-key])`,
          )!;
          const touch = new Touch({ identifier: 1, target: source, ...point });
          source.dispatchEvent(
            new TouchEvent("touchmove", {
              bubbles: true,
              cancelable: true,
              touches: [touch],
              changedTouches: [touch],
            }),
          );
        }
        await new Promise(requestAnimationFrame);
      }, input);
      const status = page.locator(
        '[data-shopping-drag-column="execute"] [data-shopping-drag-status="accepted"]',
      );
      const expectVisibleNotice = async () => {
        await expect(status).toContainText("画面外");
        await expect(status).toBeInViewport({ ratio: 1 });
        await expect
          .poll(() =>
            status.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              const { appHeaderHeight, footerHeight } =
                document.documentElement.dataset;
              const header = Number.parseFloat(appHeaderHeight ?? "") || 0;
              const footer = Number.parseFloat(footerHeight ?? "") || 0;
              return (
                rect.top >= header + 7 &&
                rect.bottom <= window.innerHeight - footer - 7
              );
            }),
          )
          .toBe(true);
      };
      await expectVisibleNotice();
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
      const beforeScroll = await page.evaluate(() => window.scrollY);
      await page.evaluate(() => window.scrollBy(0, -120));
      await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .toBeLessThan(beforeScroll);
      await expectVisibleNotice();
      await testInfo.attach("scrolled-merge-notice", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      await finish(page, input, true);
      await expect(
        page.locator("[data-shopping-drag-status], [data-shopping-drag-guide]"),
      ).toHaveCount(0);
      await expect
        .poll(async () => {
          const order = (
            (await stored(page, "executeModeItems"))[eventName] as Record<
              string,
              string[]
            >
          )[day];
          return order.slice(order.indexOf("a1"), order.indexOf("a1") + 3);
        })
        .toEqual(["a1", "a2", "merge-a"]);
      await reopen(page);
      await expect.poll(() => ids(page, "candidate")).not.toContain("merge-a");
    });
    test(`offscreen merge follows its own destination: ${input} grouping ${grouped}`, async ({
      page,
    }) => {
      await restore(page, fixture());
      await grouping(page, grouped);
      await select(page, ["merge-a", "merge-offscreen"]);
      await start(page, input, "merge-a");
      const result = await hover(page, input, "a1", "before", grouped);
      expect(
        result.guides.filter((line) => line.kind === "merge"),
      ).toHaveLength(2);
      expect(
        result.guides.filter((line) => line.kind === "insert"),
      ).toHaveLength(0);
      expect(result.text).toContain("画面外");
      await finish(page, input, true);
      await expect
        .poll(async () =>
          (
            (await stored(page, "executeModeItems"))[eventName] as Record<
              string,
              string[]
            >
          )[day].at(-1),
        )
        .toBe("merge-offscreen");
      await reopen(page);
      await expect
        .poll(() => ids(page, "candidate"))
        .not.toContain("merge-offscreen");
    });
  }
for (const input of ["native", "touch"] as const)
  test(`impossible OFF boundary rejects a mixed drop atomically: ${input}`, async ({
    page,
  }) => {
    await restore(page, fixture());
    await grouping(page, false);
    const before = (await stored(page, "executeModeItems"))[eventName];
    await select(page, ["merge-a", "bad-priority"]);
    await start(page, input, "merge-a");
    const result = await hover(page, input, "a1", "after", false);
    expect(result.status).toBe("rejected");
    expect(result.guides).toHaveLength(0);
    await finish(page, input, true);
    expect((await stored(page, "executeModeItems"))[eventName]).toEqual(before);
    expect(await ids(page, "candidate")).toContain("merge-a");
    expect(await ids(page, "candidate")).toContain("bad-priority");
    await expect(
      page.locator(rowSelector("merge-a")).getByRole("checkbox"),
    ).toBeChecked();
    await expect(
      page.locator(rowSelector("bad-priority")).getByRole("checkbox"),
    ).toBeChecked();
  });
for (const input of ["native", "touch"] as const)
  test(`OFF selection rejects reversed hall buckets before drop: ${input}`, async ({
    page,
  }) => {
    const backup = fixture(4);
    backup.data.eventLists[eventName] = [
      makeItem("a1", "01", "A"),
      makeItem("b1", "02", "B"),
      makeItem("x", "03", "B"),
      makeItem("y", "04", "A"),
    ];
    backup.data.executeModeItems[eventName][day] = ["a1", "b1"];
    await restore(page, backup);
    await grouping(page, false);
    await select(page, ["x", "y"]);
    await start(page, input, "x");
    const guide = await hover(page, input, "a1", "after", false);
    expect(guide.status).toBe("rejected");
    expect(guide.guides).toHaveLength(0);
    await finish(page, input, true);
    expect(
      (
        (await stored(page, "executeModeItems"))[eventName] as Record<
          string,
          string[]
        >
      )[day],
    ).toEqual(["a1", "b1"]);
    expect(await ids(page, "candidate")).toEqual(["y", "x"]);
    for (const id of ["x", "y"])
      await expect(
        page.locator(rowSelector(id)).getByRole("checkbox"),
      ).toBeChecked();
  });
for (const grouped of [true, false])
  test(`actual Chromium native leave clears shared guides before release: grouping ${grouped}`, async ({
    page,
  }) => {
    await restore(page, fixture());
    await grouping(page, grouped);
    const before = (await stored(page, "executeModeItems"))[eventName];
    const source = await page.locator(rowSelector("new-x")).boundingBox();
    const target = await page.locator(rowSelector("a1")).boundingBox();
    expect(source).not.toBeNull();
    expect(target).not.toBeNull();
    await page.mouse.move(source!.x + 4, source!.y + 40);
    await page.mouse.down();
    try {
      await page.mouse.move(target!.x + 4, target!.y + 30, { steps: 12 });
      await page.mouse.move(target!.x + 6, target!.y + 32);
      await expect(
        page.locator('[data-shopping-drag-status="accepted"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-shopping-drag-guide="insert"]'),
      ).toBeVisible();
      const header = await page
        .getByRole("heading", { name: eventName, exact: true })
        .boundingBox();
      expect(header).not.toBeNull();
      await page.mouse.move(header!.x + 6, header!.y + header!.height / 2, {
        steps: 12,
      });
      await expect(page.locator("[data-shopping-drag-status]")).toHaveCount(0);
      await expect(page.locator("[data-shopping-drag-guide]")).toHaveCount(0);
    } finally {
      await page.mouse.up();
    }
    expect((await stored(page, "executeModeItems"))[eventName]).toEqual(before);
  });
test("actual Chromium native drag uses the shared column owner", async ({
  page,
}) => {
  await restore(page, fixture());
  await grouping(page, true);
  const source = page.locator(rowSelector("new-x")),
    target = page.locator(rowSelector("a1"));
  await source.dragTo(target, {
    sourcePosition: { x: 4, y: 40 },
    targetPosition: { x: 4, y: 30 },
  });
  await expect
    .poll(async () =>
      (
        (await stored(page, "executeModeItems"))[eventName] as Record<
          string,
          string[]
        >
      )[day].slice(0, 3),
    )
    .toEqual(["new-x", "a1", "a2"]);
});
test("actual Chromium touch drag resolves the target column", async ({
  page,
  context,
}) => {
  await restore(page, fixture());
  await grouping(page, true);
  const session = await context.newCDPSession(page);
  try {
    await session.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    const source = await page.locator(rowSelector("new-x")).boundingBox();
    expect(source).not.toBeNull();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: source!.x + 4, y: source!.y + 40, id: 1 }],
    });
    await expect(page.locator(".esp-shopping-touch-clone")).toBeVisible();
    const target = await page.locator(rowSelector("a1")).boundingBox();
    expect(target).not.toBeNull();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: target!.x + 4, y: target!.y + 30, id: 1 }],
    });
    await expect(
      page.locator('[data-shopping-drag-guide="insert"]'),
    ).toBeVisible();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(async () =>
        (
          (await stored(page, "executeModeItems"))[eventName] as Record<
            string,
            string[]
          >
        )[day].slice(0, 3),
      )
      .toEqual(["new-x", "a1", "a2"]);
  } finally {
    await session.detach();
  }
});
for (const input of ["native", "touch"] as const)
  for (const column of ["execute", "candidate"] as const)
    test(`empty ${column} accepts a scoped ${input} drop`, async ({ page }) => {
      const backup = fixture(3, true);
      backup.data.executeModeItems[eventName][day] =
        column === "execute" ? [] : ["one", "three", "two"];
      await restore(page, backup);
      await grouping(page, false);
      const sourceId = column === "execute" ? "one" : "two";
      await start(page, input, sourceId);
      await page.locator(`[data-shopping-drag-column="${column}"]`).evaluate(
        (root, { input, sourceId }) => {
          const rect = root.getBoundingClientRect();
          const x = rect.left + 20,
            y = rect.top + Math.min(100, rect.height / 2);
          const state = window as unknown as { __dragTransfer: DataTransfer };
          if (input === "native")
            root.dispatchEvent(
              new DragEvent("dragover", {
                bubbles: true,
                cancelable: true,
                dataTransfer: state.__dragTransfer,
                clientX: x,
                clientY: y,
              }),
            );
          else {
            const source = document.querySelector<HTMLElement>(
              `[data-item-id=${JSON.stringify(sourceId)}]:not([data-space-group-key])`,
            )!;
            const touch = new Touch({
              identifier: 1,
              target: source,
              clientX: x,
              clientY: y,
            });
            source.dispatchEvent(
              new TouchEvent("touchmove", {
                bubbles: true,
                cancelable: true,
                touches: [touch],
                changedTouches: [touch],
              }),
            );
          }
        },
        { input, sourceId },
      );
      await finish(page, input, true, column);
      const expected = column === "execute" ? ["one"] : ["one", "three"];
      await expect
        .poll(
          async () =>
            (
              (await stored(page, "executeModeItems"))[eventName] as Record<
                string,
                string[]
              >
            )[day],
        )
        .toEqual(expected);
      await reopen(page);
      await expect(
        page.locator(
          `[data-shopping-drag-column="${column}"] ${rowSelector(sourceId)}`,
        ),
      ).toBeVisible();
    });
for (const input of ["native", "touch"] as const)
  test(`collapsed destination uses its complete header boundary: ${input}`, async ({
    page,
  }) => {
    await restore(page, fixture());
    await grouping(page, true);
    const header = page.locator(
      '[data-shopping-drag-column="execute"] [data-space-group-key="A-01a"]',
    );
    await header.click();
    await expect(
      page.locator(
        '[data-shopping-drag-column="execute"] ' + rowSelector("a1"),
      ),
    ).toHaveCount(0);
    await start(page, input, "new-x");
    await header.evaluate((header, input) => {
      const rect = header.getBoundingClientRect();
      const x = rect.left + 20,
        y = rect.top + rect.height * 0.75;
      const state = window as unknown as { __dragTransfer: DataTransfer };
      if (input === "native")
        header.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            dataTransfer: state.__dragTransfer,
            clientX: x,
            clientY: y,
          }),
        );
      else {
        const source = document.querySelector<HTMLElement>(
          '[data-item-id="new-x"]:not([data-space-group-key])',
        )!;
        const touch = new Touch({
          identifier: 1,
          target: source,
          clientX: x,
          clientY: y,
        });
        source.dispatchEvent(
          new TouchEvent("touchmove", {
            bubbles: true,
            cancelable: true,
            touches: [touch],
            changedTouches: [touch],
          }),
        );
      }
    }, input);
    await expect(
      page.locator('[data-shopping-drag-guide="insert"]'),
    ).toHaveAttribute("data-shopping-drag-boundary", "after");
    await finish(page, input, true);
    await expect
      .poll(async () =>
        (
          (await stored(page, "executeModeItems"))[eventName] as Record<
            string,
            string[]
          >
        )[day].slice(0, 4),
      )
      .toEqual(["a1", "a2", "new-x", "b1"]);
  });
for (const input of ["native", "touch"] as const)
  test(`candidate filter keeps a hidden selected visit out of the ${input} drag`, async ({
    page,
  }) => {
    await restore(page, fixture());
    await grouping(page, true);
    await select(page, ["merge-a", "merge-offscreen"]);
    await page.getByRole("button", { name: "A", exact: true }).click();
    await start(page, input, "merge-a");
    await hover(page, input, "a1", "before", true);
    await finish(page, input, true);
    await expect
      .poll(async () =>
        (
          (await stored(page, "executeModeItems"))[eventName] as Record<
            string,
            string[]
          >
        )[day].includes("merge-a"),
      )
      .toBe(true);
    expect(
      (
        (await stored(page, "executeModeItems"))[eventName] as Record<
          string,
          string[]
        >
      )[day],
    ).not.toContain("merge-offscreen");
  });
for (const input of ["native", "touch"] as const)
  test(`candidate lower-half hover preserves the existing next-row insertion: ${input}`, async ({
    page,
  }) => {
    await restore(page, fixture(3, true));
    await grouping(page, false);
    await page.getByRole("button", { name: "A", exact: true }).click();
    await start(page, input, "two");
    const result = await hover(page, input, "one", "after", false);
    expect(result.guides).toHaveLength(0);
    await finish(page, input, true, "candidate");
    await expect
      .poll(async () =>
        ((await stored(page, "eventLists"))[eventName] as { id: string }[]).map(
          (item) => item.id,
        ),
      )
      .toEqual(["one", "two", "three"]);
    await expect
      .poll(
        async () =>
          (
            (await stored(page, "executeModeItems"))[eventName] as Record<
              string,
              string[]
            >
          )[day],
      )
      .toEqual([]);
  });
interface RenderProbe {
  counts: Record<string, number>;
  known: string[];
  reset: () => void;
  read: () => {
    counts: Record<string, number>;
    mounts: Record<string, number>;
    known: string[];
    mounted: string[];
  };
}
for (const input of ["native", "touch"] as const)
  test(`collapsed source group moves every frozen member: ${input}`, async ({
    page,
  }) => {
    const backup = fixture();
    backup.data.eventLists[eventName].push(makeItem("new-x2", "04a2"));
    await restore(page, backup);
    await grouping(page, true);
    const header = page.locator(
      '[data-shopping-drag-column="candidate"] [data-space-group-key="A-04a"]',
    );
    await header.click();
    await expect(header).toHaveAttribute("draggable", "true");
    await start(page, input, "new-x");
    const result = await hover(page, input, "a1", "after", true);
    expect(result.status).toBe("accepted");
    await finish(page, input, true);
    await expect
      .poll(async () =>
        (
          (await stored(page, "executeModeItems"))[eventName] as Record<
            string,
            string[]
          >
        )[day].slice(0, 5),
      )
      .toEqual(["a1", "a2", "new-x", "new-x2", "b1"]);
    await reopen(page);
    await expect
      .poll(async () =>
        (
          (await stored(page, "executeModeItems"))[eventName] as Record<
            string,
            string[]
          >
        )[day].slice(0, 5),
      )
      .toEqual(["a1", "a2", "new-x", "new-x2", "b1"]);
  });
for (const input of ["native", "touch"] as const)
  test(`same-column candidate drag keeps its start selection: ${input}`, async ({
    page,
  }) => {
    await restore(page, fixture(3, true));
    await grouping(page, false);
    await select(page, ["one"]);
    await start(page, input, "one");
    await page
      .locator(rowSelector("one"))
      .getByRole("checkbox")
      .evaluate((element) => (element as HTMLInputElement).click());
    await page
      .locator(rowSelector("three"))
      .getByRole("checkbox")
      .evaluate((element) => (element as HTMLInputElement).click());
    await hover(page, input, "three", "after", false);
    await finish(page, input, true, "candidate");
    await expect
      .poll(async () =>
        ((await stored(page, "eventLists"))[eventName] as { id: string }[]).map(
          (item) => item.id,
        ),
      )
      .toEqual(["three", "one", "two"]);
    await reopen(page);
    await expect
      .poll(async () =>
        ((await stored(page, "eventLists"))[eventName] as { id: string }[]).map(
          (item) => item.id,
        ),
      )
      .toEqual(["three", "one", "two"]);
  });
test("touch leaving the viewport cancels its last valid cross-column target", async ({
  page,
}) => {
  await restore(page, fixture());
  await grouping(page, true);
  const before = (await stored(page, "executeModeItems"))[eventName];
  await start(page, "touch", "new-x");
  expect((await hover(page, "touch", "a1", "after", true)).status).toBe(
    "accepted",
  );
  await page.locator(rowSelector("new-x")).evaluate((source) => {
    const touch = new Touch({
      identifier: 1,
      target: source,
      clientX: -20,
      clientY: 250,
    });
    source.dispatchEvent(
      new TouchEvent("touchmove", {
        bubbles: true,
        cancelable: true,
        touches: [touch],
        changedTouches: [touch],
      }),
    );
  });
  await expect(page.locator("[data-shopping-drag-guide]")).toHaveCount(0);
  await finish(page, "touch", true);
  expect((await stored(page, "executeModeItems"))[eventName]).toEqual(before);
  await expect(page.locator(".esp-shopping-touch-clone")).toHaveCount(0);
});
for (const input of ["native", "touch"] as const)
  for (const compatible of [true, false])
    test(`actual-map membership determines the durable merge endpoint: ${input} existing pair ${compatible}`, async ({
      page,
    }) => {
      const backup = fixture();
      const a1 = Object.assign(makeItem("a1", "01a"), {
        manualHallId: "hall-a",
      });
      const c = Object.assign(makeItem("c", "03"), { manualHallId: "hall-a" });
      const a2 = Object.assign(makeItem("a2", "01a2"), {
        manualHallId: "hall-b",
      });
      const b = Object.assign(makeItem("b", "02"), { manualHallId: "hall-b" });
      const x = Object.assign(makeItem("x", "01a3"), {
        manualHallId: compatible ? "hall-a" : "hall-b",
      });
      const mapKey = `${day}マップ`;
      Object.assign(backup.data.mapData, {
        [eventName]: {
          [mapKey]: {
            maxRow: 6,
            maxCol: 6,
            cells: [],
            mergedCells: [],
            blocks: [
              {
                name: "A",
                startRow: 1,
                startCol: 1,
                endRow: 5,
                endCol: 5,
                numberCells: [
                  { row: 2, col: 2, value: 1 },
                  { row: 3, col: 2, value: 2 },
                  { row: 4, col: 2, value: 3 },
                ],
              },
            ],
          },
        },
      });
      backup.data.hallDefinitions[eventName] = {
        [mapKey]: [
          {
            id: "hall-a",
            name: "Aホール",
            blockNames: ["A"],
            vertices: [
              { row: 1, col: 1 },
              { row: 1, col: 3 },
              { row: 5, col: 3 },
              { row: 5, col: 1 },
            ],
          },
          {
            id: "hall-b",
            name: "Bホール",
            blockNames: ["B"],
            vertices: [
              { row: 1, col: 4 },
              { row: 1, col: 6 },
              { row: 5, col: 6 },
              { row: 5, col: 4 },
            ],
          },
        ],
      };
      const existing = compatible ? [a1, c, a2, b] : [a1, c, b];
      backup.data.eventLists[eventName] = [...existing, x];
      backup.data.executeModeItems[eventName][day] = existing.map(
        (item) => item.id,
      );
      await restore(page, backup);
      await grouping(page, false);
      await select(page, ["x"]);
      await start(page, input, "x");
      const result = await hover(page, input, "c", "after", false);
      expect(result.status).toBe("accepted");
      expect(
        result.guides.map(({ kind, edge, owner }) => ({ kind, edge, owner })),
      ).toEqual([
        { kind: "merge", edge: "after", owner: compatible ? "a2" : "a1" },
      ]);
      await finish(page, input, true);
      const expectedRaw = compatible
        ? ["a1", "c", "a2", "x", "b"]
        : ["a1", "x", "c", "b"];
      await expect
        .poll(
          async () =>
            (
              (await stored(page, "executeModeItems"))[eventName] as Record<
                string,
                string[]
              >
            )[day],
        )
        .toEqual(expectedRaw);
      const expectedDisplay = compatible
        ? ["a1", "a2", "x", "c", "b"]
        : ["a1", "x", "c", "b"];
      await expect.poll(() => ids(page, "execute")).toEqual(expectedDisplay);

      await reopen(page);
      await expect.poll(() => ids(page, "execute")).toEqual(expectedDisplay);
    });
for (const input of ["native", "touch"] as const)
  test(`collapsed candidate header preserves the first-member anchor: ${input}`, async ({
    page,
  }) => {
    await restore(page, fixture(3, true));
    await grouping(page, true);
    const header = page.locator(
      '[data-shopping-drag-column="candidate"] [data-space-group-key="A-1"]',
    );
    await header.click();
    await expect(header).toHaveAttribute("draggable", "true");
    await start(page, input, "two");
    await header.evaluate((header, input) => {
      const rect = header.getBoundingClientRect();
      const x = rect.left + 20,
        y = rect.top + rect.height * 0.75;
      if (input === "native") {
        const state = window as unknown as { __dragTransfer: DataTransfer };
        header.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            dataTransfer: state.__dragTransfer,
            clientX: x,
            clientY: y,
          }),
        );
      } else {
        const source = document.querySelector<HTMLElement>(
          '[data-shopping-drag-column="execute"] [data-item-id="two"]:not([data-space-group-key])',
        )!;
        const touch = new Touch({
          identifier: 1,
          target: source,
          clientX: x,
          clientY: y,
        });
        source.dispatchEvent(
          new TouchEvent("touchmove", {
            bubbles: true,
            cancelable: true,
            touches: [touch],
            changedTouches: [touch],
          }),
        );
      }
    }, input);
    await expect(
      page.locator(
        '[data-shopping-drag-column="candidate"] [data-shopping-drag-guide]',
      ),
    ).toHaveCount(0);
    await finish(page, input, true, "candidate");
    await expect
      .poll(async () =>
        ((await stored(page, "eventLists"))[eventName] as { id: string }[]).map(
          (item) => item.id,
        ),
      )
      .toEqual(["two", "one", "three"]);
    await reopen(page);
    await expect
      .poll(async () =>
        ((await stored(page, "eventLists"))[eventName] as { id: string }[]).map(
          (item) => item.id,
        ),
      )
      .toEqual(["two", "one", "three"]);
  });
async function rendererState(page: Page) {
  return page.locator("[data-list-renderer]").evaluateAll((roots) =>
    roots.map((root, index) => {
      const element = root as HTMLElement;
      return {
        column:
          element.dataset.shoppingDragColumn ?? ["execute", "candidate"][index],
        engine: element.dataset.listRenderer,
        strategy: element.dataset.listRendererStrategy,
        mounted: element.querySelectorAll(
          "[data-item-id]:not([data-space-group-key])",
        ).length,
        mountedGroups: element.querySelectorAll("[data-space-group-key]")
          .length,
      };
    }),
  );
}
async function installRenderProbe(page: Page) {
  await page.addInitScript((trace: boolean) => {
    interface Fiber {
      memoizedProps?: {
        item?: { id: string };
        onUpdate?: unknown;
        row?: { kind: string; rowKey: string };
        model?: { rows: Array<{ kind: string; rowKey: string }> };
        render?: unknown;
        renderGroup?: unknown;
        layoutMode?: unknown;
        "data-list-renderer"?: string;
        "data-list-renderer-strategy"?: string;
      };
      flags: number;
      alternate?: Fiber;
      child?: Fiber;
      sibling?: Fiber;
    }
    const keysFor = (fiber: Fiber): string[] => {
      const props = fiber.memoizedProps;
      if (props?.item?.id && props.onUpdate) return [`item:${props.item.id}`];
      // GroupContent is the actual retained group render; GroupViewport has layoutMode and only owns mounting.
      if (props?.row?.kind === "group" && props.render && !props.layoutMode)
        return [`group:${props.row.rowKey}`];
      // FullListRenderer calls renderGroup directly, so count its actual canonical groups when that renderer performs work.
      const host = fiber.child?.memoizedProps;
      if (
        props?.model &&
        props.renderGroup &&
        host?.["data-list-renderer"] === "full" &&
        host["data-list-renderer-strategy"] !== "retained-viewport"
      )
        return props.model.rows
          .filter((row) => row.kind === "group")
          .map((row) => `group:${row.rowKey}`);
      return [];
    };
    const known = new Set<string>();
    let counts: Record<string, number> = {};
    let mounts: Record<string, number> = {};
    let currentRoot: Fiber | undefined;
    let enabled = true;
    let callbacks = 0;
    let enabledCallbacks = 0;
    let overheadMs = 0;
    const commitTimes: number[] = [];
    const probe = {
      setEnabled(value: boolean) {
        enabled = value;
      },
      cost() {
        return {
          callbacks,
          enabledCallbacks,
          overheadMs,
          commitTimes: [...commitTimes],
        };
      },
      reset() {
        counts = {};
        mounts = {};
      },
      read() {
        const mounted = new Set<string>();
        const visit = (fiber: Fiber | undefined) => {
          if (!fiber) return;
          keysFor(fiber).forEach((key) => mounted.add(key));
          visit(fiber.child);
          visit(fiber.sibling);
        };
        visit(currentRoot);
        return {
          counts: { ...counts },
          mounts: { ...mounts },
          known: [...known],
          mounted: [...mounted],
        };
      },
    };
    if (trace) {
      const rpcEvents: Array<{
        direction: string;
        at: number;
        id: unknown;
        type: unknown;
      }> = [];
      const observedWorkers = new WeakSet<Worker>();
      const postMessage = Worker.prototype.postMessage;
      const recordRpc = (direction: string, message: unknown) => {
        const data = message as {
          id?: unknown;
          requestId?: unknown;
          type?: unknown;
          kind?: unknown;
          operation?: unknown;
          method?: unknown;
        } | null;
        rpcEvents.push({
          direction,
          at: performance.now(),
          id: data?.id ?? data?.requestId,
          type: data?.type ?? data?.kind ?? data?.operation ?? data?.method,
        });
      };
      Worker.prototype.postMessage = function (...args: unknown[]) {
        if (!observedWorkers.has(this)) {
          observedWorkers.add(this);
          this.addEventListener("message", (event) =>
            recordRpc("receive", event.data),
          );
        }
        recordRpc("send", args[0]);
        return Reflect.apply(postMessage, this, args);
      };
      Object.assign(window, { __dragRpcEvents: rpcEvents });
    }
    Object.assign(window, {
      __dragRenderProbe: probe,
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        supportsFiber: true,
        renderers: new Map(),
        inject(renderer: unknown) {
          this.renderers.set(1, renderer);
          return 1;
        },
        onCommitFiberRoot(_id: unknown, root: { current: unknown }) {
          currentRoot = root.current as Fiber;
          callbacks++;
          if (trace) commitTimes.push(performance.now());
          if (!enabled) return;
          enabledCallbacks++;
          const probeBegan = performance.now();
          const visit = (fiber: Fiber | undefined) => {
            if (!fiber) return;
            keysFor(fiber).forEach((key) => {
              known.add(key);
              if ((fiber.flags & 1) !== 0) {
                const counter = fiber.alternate ? counts : mounts;
                counter[key] = (counter[key] ?? 0) + 1;
              }
            });
            if (!fiber.alternate || fiber.child !== fiber.alternate.child)
              visit(fiber.child);
            visit(fiber.sibling);
          };
          visit(currentRoot);
          overheadMs += performance.now() - probeBegan;
        },
        onCommitFiberUnmount() {},
      },
    });
  }, process.env.ESP_DRAG_TRACE_STAGES === "1");
}
async function select(page: Page, requested: string[]) {
  const clear = page.getByRole("button", { name: "選択を解除", exact: true });
  if (await clear.count()) await clear.click();
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
  });
  for (const id of requested) {
    const row = page.locator(rowSelector(id));
    if ((await row.count()) === 0) {
      await page
        .getByRole("listitem", { name: new RegExp(` ${id} ユーザー登録$`) })
        .scrollIntoViewIfNeeded();
      await expect(row).toBeAttached();
    }
    await row
      .locator('input[type="checkbox"]')
      .evaluate((box: HTMLInputElement) => {
        if (!box.checked) box.click();
      });
  }
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise(requestAnimationFrame);
  });
}
async function renderCounts(page: Page, reset = false) {
  return page.evaluate((reset) => {
    const probe = (window as unknown as { __dragRenderProbe: RenderProbe })
      .__dragRenderProbe;
    if (reset) probe.reset();
    return probe.read();
  }, reset);
}
async function fixturePresentationControl(page: Page) {
  const observe = () =>
    page
      .locator("[data-list-renderer]")
      .first()
      .evaluate((root) => ({
        hallLabels: ["Aホール", "Bホール"].filter((label) =>
          root.textContent?.includes(label),
        ),
        groupKeys: [
          ...new Set(
            Array.from(
              root.querySelectorAll<HTMLElement>(
                "[data-row-key], [data-viewport-row-key], [data-space-group-key]",
              ),
            )
              .map(
                (element) =>
                  element.dataset.rowKey ??
                  element.dataset.viewportRowKey ??
                  element.dataset.spaceGroupKey,
              )
              .filter(
                (key) =>
                  key?.startsWith("group:") ||
                  key?.startsWith("A-") ||
                  key?.startsWith("B-"),
              ),
          ),
        ],
        visitIds: [
          ...new Set(
            Array.from(
              root.querySelectorAll<HTMLElement>(
                "[data-space-navigation-visit-id]",
              ),
            ).map((element) => element.dataset.spaceNavigationVisitId),
          ),
        ],
      }));
  const observations = [await observe()];
  const offscreen = page.locator(rowSelector("offscreen"));
  if (!(await offscreen.count()))
    await page
      .getByRole("listitem", { name: / offscreen ユーザー登録$/ })
      .scrollIntoViewIfNeeded();
  else await offscreen.scrollIntoViewIfNeeded();
  await expect(offscreen).toBeAttached();
  observations.push(await observe());
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise(requestAnimationFrame);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  observations.push(await observe());
  expect(
    observations.some((value) => value.hallLabels.includes("Aホール")),
  ).toBe(true);
  expect(
    observations.some((value) => value.hallLabels.includes("Bホール")),
  ).toBe(true);
  expect(
    observations.some((value) =>
      value.visitIds.some((id) => id?.endsWith(":priority")),
    ),
  ).toBe(true);
  return observations;
}
async function probePositiveControl(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as {
        __dragRenderProbe: { setEnabled: (value: boolean) => void };
      }
    ).__dragRenderProbe.setEnabled(true),
  );
  await renderCounts(page, true);
  await select(page, ["priority"]);
  await select(page, []);
  const response = await renderCounts(page);
  expect(
    Object.keys(response.counts).filter((key) => key.startsWith("item:"))
      .length,
  ).toBeGreaterThan(0);
  expect(
    Object.keys(response.counts).filter((key) => key.startsWith("group:"))
      .length,
  ).toBeGreaterThan(0);
  await renderCounts(page, true);
  return response;
}
const summary = (values: number[]) => ({
  samples: values,
  ...summarizePerformanceSamples(values),
});
async function attach(testInfo: TestInfo, name: string, data: unknown) {
  await testInfo.attach(name, {
    body: JSON.stringify(data, null, 2),
    contentType: "application/json",
  });
}
for (const count of [150, 500])
  for (const input of ["native", "touch"] as const)
    for (const grouped of [true, false])
      test(`@shopping-performance @shopping-drag-performance ${count} ${input} grouping ${grouped ? "on" : "off"}`, async ({
        page,
        browserName,
      }, testInfo) => {
        test.setTimeout(240000);
        await installRenderProbe(page);
        await restore(page, performanceFixture(count));
        await grouping(page, grouped);
        const fixturePersistenceBefore = await fixtureConsistencyShape(page);
        const worker = page
          .workers()
          .find((worker) => worker.url().includes("persistence.worker"));
        expect(worker).toBeDefined();
        await worker!.evaluate(() => {
          type Write = { store: string; method: string };
          type Commit = { stores: string[]; writes: Write[] };
          const requests: Write[] = [];
          const completed: Commit[] = [];
          const active = new WeakMap<IDBTransaction, Commit>();
          const transaction = IDBDatabase.prototype.transaction;
          IDBDatabase.prototype.transaction = function (
            ...args: Parameters<IDBDatabase["transaction"]>
          ) {
            const result = transaction.apply(this, args);
            if (result.mode === "readwrite") {
              const entry: Commit = {
                stores: Array.from(result.objectStoreNames),
                writes: [],
              };
              active.set(result, entry);
              result.addEventListener("complete", () => completed.push(entry));
            }
            return result;
          };
          for (const method of ["put", "add", "delete", "clear"] as const) {
            const original = IDBObjectStore.prototype[method];
            Object.defineProperty(IDBObjectStore.prototype, method, {
              configurable: true,
              writable: true,
              value: function (this: IDBObjectStore, ...args: unknown[]) {
                const request = { store: this.name, method };
                requests.push(request);
                active.get(this.transaction)?.writes.push(request);
                return (original as (...values: unknown[]) => IDBRequest).apply(
                  this,
                  args,
                );
              },
            });
          }
          Object.assign(globalThis, {
            __dragPhysicalIO: () => ({
              requests: [...requests],
              completed: [...completed],
            }),
          });
        });
        const physicalIO = () =>
          worker!.evaluate(() =>
            (
              globalThis as unknown as {
                __dragPhysicalIO: () => {
                  requests: Array<{ store: string; method: string }>;
                  completed: Array<{
                    stores: string[];
                    writes: Array<{ store: string; method: string }>;
                  }>;
                };
              }
            ).__dragPhysicalIO(),
          );
        const records: Record<string, ReturnType<typeof summary>> = {};
        const locality: Record<string, unknown> = {};
        const fixtureControl = await fixturePresentationControl(page);
        const positiveControl = await probePositiveControl(page);
        await page.evaluate(() =>
          (
            window as unknown as {
              __dragRenderProbe: { setEnabled: (value: boolean) => void };
            }
          ).__dragRenderProbe.setEnabled(false),
        );
        const rendererBefore = await rendererState(page);
        const starts: unknown[] = [];
        const ends: number[] = [];
        const scenarioStarts: Array<{
          name: string;
          response: Awaited<ReturnType<typeof start>>;
        }> = [];
        const scenarioEnds: Array<{ name: string; ms: number }> = [];
        const cases = [
          {
            name: "same-boundary",
            selected: ["new-x"],
            source: "new-x",
            target: "a1",
            alternating: false,
          },
          {
            name: "boundary-switch",
            selected: ["new-x"],
            source: "new-x",
            target: "a1",
            alternating: true,
          },
          {
            name: "multiple-merges",
            selected: ["merge-a", "merge-b"],
            source: "merge-a",
            target: "a1",
            alternating: true,
          },
          {
            name: "mixed",
            selected: ["merge-a", "merge-b", "new-x"],
            source: "merge-a",
            target: "a1",
            alternating: true,
          },
          {
            name: "offscreen-merge",
            selected: ["merge-a", "merge-offscreen"],
            source: "merge-a",
            target: "a1",
            alternating: true,
          },
          {
            name: "auto-scroll",
            selected: ["merge-a", "merge-b", "merge-offscreen"],
            source: "merge-a",
            target: "a1",
            alternating: true,
          },
          ...(!grouped
            ? [
                {
                  name: "rejected",
                  selected: ["bad-priority"],
                  source: "bad-priority",
                  target: "a1",
                  alternating: true,
                },
              ]
            : []),
        ];
        const pointerIOBefore = await physicalIO();
        await start(page, input, "merge-a");
        await finish(page, input, false);
        for (let sample = 0; sample < 20; sample++) {
          await page.evaluate(async () => {
            window.scrollTo(0, 0);
            await new Promise(requestAnimationFrame);
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
          starts.push(await start(page, input, "merge-a"));
          ends.push(await finish(page, input, false));
        }
        await page.evaluate(() =>
          (
            window as unknown as {
              __dragRenderProbe: { setEnabled: (value: boolean) => void };
            }
          ).__dragRenderProbe.setEnabled(true),
        );
        for (const scenario of cases) {
          await page.evaluate(async () => {
            window.scrollTo(0, 0);
            await new Promise(requestAnimationFrame);
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
          await select(page, scenario.selected);
          scenarioStarts.push({
            name: scenario.name,
            response: await start(page, input, scenario.source),
          });
          await page.evaluate(async () => {
            window.scrollTo(0, 200);
            await new Promise(requestAnimationFrame);
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
          const initialHover = await hover(
            page,
            input,
            scenario.target,
            "before",
            grouped,
          );
          if (scenario.name === "boundary-switch")
            expect(
              initialHover.guides.map(({ kind, edge, owner }) => ({
                kind,
                edge,
                owner,
              })),
            ).toEqual([
              {
                kind: "insert",
                edge: "before",
                owner: grouped ? 'group:"A-01a"' : "a1",
              },
            ]);
          await page.evaluate(async () => {
            await new Promise(requestAnimationFrame);
            await new Promise(requestAnimationFrame);
          });
          const beforeRender = await renderCounts(page, true);
          const beforeIO = await physicalIO();
          const samples: number[] = [];
          const guideSamples: unknown[] = [];
          const boundarySwitches: Array<{
            sample: number;
            from: string;
            to: string;
          }> = [];
          let previousBoundary = initialHover.guides[0]?.edge;
          for (let i = 0; i < 20; i++) {
            if (scenario.name === "rejected") {
              const accepted = await hover(
                page,
                input,
                "priority",
                "after",
                false,
              );
              expect(accepted.status).toBe("accepted");
              expect(
                accepted.guides.some((line) => line.kind === "insert"),
              ).toBe(true);
            }
            // The setup is before, so the first alternating sample must switch to after.
            const expectedEdge =
              scenario.name === "rejected" ||
              (scenario.alternating && i % 2 === 0)
                ? "after"
                : "before";
            const response =
              scenario.name === "auto-scroll"
                ? await autoScroll(page, input)
                : await hover(
                    page,
                    input,
                    scenario.target,
                    expectedEdge,
                    grouped,
                  );
            samples.push(response.ms);
            const expectedGuides: Array<{
              kind: string;
              edge: string;
              owner: string;
            }> = [];
            if (
              scenario.name === "same-boundary" ||
              scenario.name === "boundary-switch" ||
              scenario.name === "mixed"
            )
              expectedGuides.push({
                kind: "insert",
                edge: expectedEdge,
                owner: grouped
                  ? 'group:"A-01a"'
                  : expectedEdge === "before"
                    ? "a1"
                    : "a2",
              });
            if (
              scenario.name === "multiple-merges" ||
              scenario.name === "mixed" ||
              scenario.name === "offscreen-merge" ||
              scenario.name === "auto-scroll"
            ) {
              expectedGuides.push({
                kind: "merge",
                edge: "after",
                owner: grouped ? 'group:"A-01a"' : "a2",
              });
              if (scenario.name !== "offscreen-merge")
                expectedGuides.push({
                  kind: "merge",
                  edge: "after",
                  owner: grouped ? 'group:"A-02a"' : "b1",
                });
              if (
                scenario.name === "offscreen-merge" ||
                scenario.name === "auto-scroll"
              )
                expectedGuides.push({
                  kind: "merge",
                  edge: "after",
                  owner: grouped ? 'group:"B-999a"' : "offscreen",
                });
            }
            const identity = (line: {
              kind?: string;
              edge?: string;
              owner?: string;
            }) => JSON.stringify([line.kind, line.edge, line.owner]);
            expect(
              response.guides.map(identity).sort(),
              `${scenario.name} sample ${i} exact boundaries`,
            ).toEqual(expectedGuides.map(identity).sort());
            expect(
              response.guides.every(
                (line) => Number.isFinite(line.offsetPx) && line.offsetPx <= 1,
              ),
              `${scenario.name} sample ${i} rectangle alignment`,
            ).toBe(true);
            if (scenario.name === "boundary-switch") {
              const observedBoundary = response.guides[0].edge!;
              expect(previousBoundary, `sample ${i} previous boundary`).toBe(
                expectedEdge === "after" ? "before" : "after",
              );
              boundarySwitches.push({
                sample: i,
                from: previousBoundary!,
                to: observedBoundary,
              });
              previousBoundary = observedBoundary;
            }
            guideSamples.push({ ...response, expectedGuides });
            if ("viewportScroll" in response)
              expect(response.viewportScroll.after, scenario.name).toBe(
                response.viewportScroll.before,
              );
            if ("scrollBefore" in response) {
              expect(response.scrollAfter).toBeGreaterThan(
                response.scrollBefore,
              );
              expect(
                response.guides.filter((line) => line.kind === "merge"),
              ).toHaveLength(3);
              expect(response.guides.every((line) => line.offsetPx <= 1)).toBe(
                true,
              );
              expect(response.guides.map((line) => line.owner).sort()).toEqual(
                (grouped
                  ? ['group:"A-01a"', 'group:"A-02a"', 'group:"B-999a"']
                  : ["a2", "b1", "offscreen"]
                ).sort(),
              );
            }
            if (scenario.name === "rejected") {
              expect(response.status).toBe("rejected");
              expect(response.guides).toHaveLength(0);
            } else {
              expect(response.status).toBe("accepted");
              if (
                scenario.name === "multiple-merges" ||
                scenario.name === "offscreen-merge"
              )
                expect(
                  response.guides.filter((line) => line.kind === "merge"),
                ).toHaveLength(2);
              if (scenario.name === "mixed") {
                expect(
                  response.guides.filter((line) => line.kind === "merge"),
                ).toHaveLength(2);
                expect(
                  response.guides.filter((line) => line.kind === "insert"),
                ).toHaveLength(1);
              }
            }
          }
          if (scenario.name === "boundary-switch")
            expect(boundarySwitches).toHaveLength(20);
          const render = await renderCounts(page);
          expect(
            render.known.filter((key) => key.startsWith("item:")).length,
          ).toBeGreaterThan(0);
          expect(render.counts).toEqual({});
          expect(
            Object.keys(render.mounts).filter((key) =>
              beforeRender.mounted.includes(key),
            ),
          ).toEqual([]);
          if (scenario.name !== "auto-scroll")
            expect(render.mounts, scenario.name).toEqual({});
          if (grouped)
            expect(
              render.known.filter((key) => key.startsWith("group:")).length,
            ).toBeGreaterThan(0);
          const afterIO = await physicalIO();
          const ioDelta = {
            mutationRequests: afterIO.requests.slice(beforeIO.requests.length),
            completedReadwriteTransactions: afterIO.completed.slice(
              beforeIO.completed.length,
            ),
          };
          expect(ioDelta.mutationRequests).toEqual([]);
          expect(ioDelta.completedReadwriteTransactions).toEqual([]);
          locality[scenario.name] = {
            ...render,
            mountedBefore: beforeRender.mounted,
            guideSamples,
            ...(scenario.name === "boundary-switch"
              ? { boundarySwitches }
              : {}),
            io: { before: beforeIO, after: afterIO, delta: ioDelta },
          };
          records[scenario.name] = summary(samples);
          scenarioEnds.push({
            name: scenario.name,
            ms: await finish(page, input, false),
          });
        }
        // The product persistence watcher debounces at 500ms. Wait outside response timing so delayed pointer writes cannot escape the phase delta.
        await page.waitForTimeout(600);
        const pointerIOAfter = await physicalIO();
        const pointerIO = {
          settleMs: 600,
          before: pointerIOBefore,
          after: pointerIOAfter,
          delta: {
            mutationRequests: pointerIOAfter.requests.slice(
              pointerIOBefore.requests.length,
            ),
            completedReadwriteTransactions: pointerIOAfter.completed.slice(
              pointerIOBefore.completed.length,
            ),
          },
        };
        expect(pointerIO.delta.mutationRequests).toEqual([]);
        expect(pointerIO.delta.completedReadwriteTransactions).toEqual([]);
        await select(page, []);
        const drops: number[] = [];
        const enabledDrops: number[] = [];
        const saveCompletionMs: number[] = [];
        const enabledSaveCompletionMs: number[] = [];
        const dropProbePattern: Array<{ id: string; probeEnabled: boolean }> =
          [];
        const compareProbe = process.env.ESP_DRAG_DROP_PROBE_COMPARE === "1";
        const cdp =
          process.env.ESP_DRAG_TRACE_STAGES === "1"
            ? await page.context().newCDPSession(page)
            : undefined;
        if (cdp) await cdp.send("Performance.enable");
        const diagnosticPerformanceMetrics: unknown[] = [];
        const cpuProfileIntervals: Array<{
          id: string;
          startUs: number;
          endUs: number;
        }> = [];
        const profileCpu = process.env.ESP_DRAG_CPU_PROFILE === "1";
        if (cdp && profileCpu) {
          await cdp.send("Profiler.enable");
          await cdp.send("Profiler.setSamplingInterval", { interval: 250 });
          await cdp.send("Profiler.start");
        }
        await page.evaluate(() =>
          (
            window as unknown as {
              __dragRenderProbe: { setEnabled: (value: boolean) => void };
            }
          ).__dragRenderProbe.setEnabled(false),
        );
        for (let i = 0; i < (compareProbe ? 40 : 20); i++) {
          await page.evaluate(async () => {
            window.scrollTo(0, 0);
            await new Promise(requestAnimationFrame);
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
          const id = `new-${i}`;
          await start(page, input, id);
          await page.evaluate(async () => {
            window.scrollTo(0, 0);
            await new Promise(requestAnimationFrame);
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
          const target = await hover(page, input, "priority", "after", grouped);
          expect(target.status).toBe("accepted");
          // Balanced E,D,D,E pairs compare the same evolving fixture without changing the product or threshold.
          const probeEnabled = compareProbe && (i % 4 === 0 || i % 4 === 3);
          await page.evaluate(
            (enabled) =>
              (
                window as unknown as {
                  __dragRenderProbe: { setEnabled: (value: boolean) => void };
                }
              ).__dragRenderProbe.setEnabled(enabled),
            probeEnabled,
          );
          dropProbePattern.push({ id, probeEnabled });
          const began = Date.now();
          const beforeMetrics = cdp
            ? await cdp.send("Performance.getMetrics")
            : undefined;
          const responseMs = await finish(page, input, true, "execute", id);
          if (cdp && beforeMetrics) {
            const afterMetrics = await cdp.send("Performance.getMetrics");
            const before = new Map(
              beforeMetrics.metrics.map((metric) => [
                metric.name,
                metric.value,
              ]),
            );
            cpuProfileIntervals.push({
              id,
              startUs: (before.get("Timestamp") ?? 0) * 1000000,
              endUs:
                (afterMetrics.metrics.find(
                  (metric) => metric.name === "Timestamp",
                )?.value ?? 0) * 1000000,
            });
            diagnosticPerformanceMetrics.push({
              id,
              elapsedMs: responseMs,
              metrics: Object.fromEntries(
                afterMetrics.metrics
                  .filter((metric) =>
                    [
                      "ScriptDuration",
                      "LayoutDuration",
                      "RecalcStyleDuration",
                      "TaskDuration",
                      "LayoutCount",
                      "RecalcStyleCount",
                    ].includes(metric.name),
                  )
                  .map((metric) => [
                    metric.name,
                    (metric.value - (before.get(metric.name) ?? 0)) *
                      (metric.name.endsWith("Duration") ? 1000 : 1),
                  ]),
              ),
            });
          }
          (probeEnabled ? enabledDrops : drops).push(responseMs);
          await expect
            .poll(async () =>
              (
                (await stored(page, "executeModeItems"))[eventName] as Record<
                  string,
                  string[]
                >
              )[day].includes(id),
            )
            .toBe(true);
          (probeEnabled ? enabledSaveCompletionMs : saveCompletionMs).push(
            Date.now() - began,
          );
        }
        await page.evaluate(() =>
          (
            window as unknown as {
              __dragRenderProbe: { setEnabled: (value: boolean) => void };
            }
          ).__dragRenderProbe.setEnabled(false),
        );
        if (cdp && profileCpu) {
          const { profile } = await cdp.send("Profiler.stop");
          await attach(testInfo, "shopping-drag-main-cpu-profile", {
            profile,
            intervals: cpuProfileIntervals,
            samplingIntervalUs: 250,
            note: "Diagnostic only; restrict profile timeDeltas to the20 drop intervals and exclude idle samples.",
          });
        }
        if (cdp) await cdp.detach();
        records.drop = summary(drops);
        await attach(testInfo, "shopping-drag-response", {
          ...shoppingEvidenceIdentity("drag"),
          environment: await shoppingBrowserEnvironment(page, testInfo.retry),
          build: "npm run build:app",
          fixture: {
            count,
            halls: ["A", "B"],
            priorities: ["none", "priority"],
          },
          browser: browserName,
          userAgent: await page.evaluate(() => navigator.userAgent),
          input,
          grouped,
          warmup: 1,
          probeCounting: {
            positiveControl: true,
            comparableStartEnd: false,
            pointer: true,
            drop: false,
          },
          records,
          locality,
          pointerIO,
          start: starts,
          end: ends,
          fixtureControl,
          positiveControl,
          fixturePersistence: {
            before: fixturePersistenceBefore,
            after: await fixtureConsistencyShape(page),
          },
          rendererBefore,
          rendererAfter: await rendererState(page),
          saveCompletionMs,
          ...(diagnosticPerformanceMetrics.length
            ? { diagnosticPerformanceMetrics }
            : {}),
          ...(compareProbe
            ? {
                dropProbeComparison: {
                  enabled: summary(enabledDrops),
                  disabled: summary(drops),
                  enabledSaveCompletionMs,
                  pattern: dropProbePattern,
                },
              }
            : {}),
          dropDetails: await page.evaluate(
            () =>
              (
                window as unknown as {
                  __dragDropDiagnostics?: Array<Record<string, unknown>>;
                  __dragRpcEvents?: Array<{
                    direction: string;
                    at: number;
                    id: unknown;
                    type: unknown;
                  }>;
                }
              ).__dragDropDiagnostics ?? [],
          ),
          scenarioStarts,
          scenarioEnds,
          dropMeasurement:
            "input dispatch to observed execute item DOM, then requestAnimationFrame and following task; save completion polled separately",
          baseline: {
            crossColumn:
              "not functioning at 5bf82a3; no baseline UI timing is substituted",
            startEndComparison: "requires separately built 5bf82a3 run",
          },
        });
        for (const [operation, value] of Object.entries(records)) {
          expect(value.samples.length, operation).toBeGreaterThanOrEqual(20);
          expect(value.medianMs, operation).toBeLessThanOrEqual(55);
          expect(value.p95Ms, operation).toBeLessThanOrEqual(100);
        }
      });

for (const count of [150, 500])
  for (const input of ["native", "touch"] as const)
    for (const grouped of [true, false])
      test(`@shopping-performance @shopping-drag-baseline ${count} ${input} grouping ${grouped ? "on" : "off"}`, async ({
        page,
        browserName,
      }, testInfo) => {
        test.skip(
          process.env.ESP_DRAG_BASELINE !== "1",
          "Run only against the separately built 5bf82a3 baseline.",
        );
        test.setTimeout(120000);
        await installRenderProbe(page);
        await restore(page, performanceFixture(count), true);
        await grouping(page, grouped);
        const fixtureControl = await fixturePresentationControl(page);
        const positiveControl = await probePositiveControl(page);
        await page.evaluate(() =>
          (
            window as unknown as {
              __dragRenderProbe: { setEnabled: (value: boolean) => void };
            }
          ).__dragRenderProbe.setEnabled(false),
        );
        const rendererBefore = await rendererState(page);
        const starts: unknown[] = [];
        const ends: number[] = [];
        await start(page, input, "merge-a");
        await finish(page, input, false);
        for (let i = 0; i < 20; i++) {
          await page.evaluate(async () => {
            window.scrollTo(0, 0);
            await new Promise(requestAnimationFrame);
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
          starts.push(await start(page, input, "merge-a"));
          ends.push(await finish(page, input, false));
        }
        await attach(testInfo, "shopping-drag-baseline-start-end", {
          commit: "5bf82a364d5b656cfa1e67c5233cfac0564840cf",
          probeCounting: { positiveControl: true, comparableStartEnd: false },
          count,
          input,
          grouped,
          browser: browserName,
          userAgent: await page.evaluate(() => navigator.userAgent),
          start: starts,
          end: ends,
          fixtureControl,
          positiveControl,
          rendererBefore,
          rendererAfter: await rendererState(page),
          crossColumn:
            "not functioning; guide/drop baseline timings unavailable",
        });
      });
