import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ video: "off", trace: "off" });
const phase = process.env.ESP_PRIORITY_PHASE ?? "unspecified";
const eventName = "中継解除性能診断";
type RelayKind = "map" | "preview" | "waiting";
interface RouteRequestObservation {
  requestId: number;
  workerId: number;
  key: string;
}
interface WorkerObservations {
  hold: boolean;
  held: Array<RouteRequestObservation & { deliver(): void }>;
  release(requestIds?: number[]): number;
  requests: RouteRequestObservation[];
  delivered: RouteRequestObservation[];
  callbacks: Record<string, () => void>;
  domClickStates: Array<{ name: string; connected: boolean }>;
  workerSequence: number;
  methods: string[];
  computeMs: number[];
  posts: number;
}
function source(count: number) {
  const items = Array.from({ length: count }, (_, index) => ({
    id: `relay-${index}`,
    circle: `中継サークル${index}`,
    title: `中継商品${index}`,
    eventDate: index === count - 1 ? "2日目" : "1日目",
    block: "A",
    number: index === count - 1 ? "1" : String(index + 1),
    price: 500,
    quantity: 5,
    purchaseStatus: "None",
    remarks: "ユーザー登録",
  }));
  const map = {
    maxRow: 6,
    maxCol: 14,
    cells: [],
    mergedCells: [],
    blocks: [
      {
        name: "A",
        startRow: 1,
        startCol: 1,
        endRow: 5,
        endCol: 14,
        numberCells: Array.from({ length: 6 }, (_, index) => ({
          row: 2,
          col: (index + 1) * 2,
          value: index + 1,
        })),
      },
    ],
  };
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-18T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: { [eventName]: items },
      eventMetadata: {},
      executeModeItems: {
        [eventName]: {
          "1日目": items.slice(0, 5).map((item) => item.id),
          "2日目": [items[count - 1].id],
        },
      },
      dayModes: { [eventName]: { "1日目": "edit", "2日目": "edit" } },
      mapData: { [eventName]: { "1日目マップ": map, "2日目マップ": map } },
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
}
async function initialize(page: Page, count: number, kind: RelayKind) {
  await page.addInitScript((kind) => {
    localStorage.setItem("mapSmartInsertEnabled", "true");
    localStorage.setItem(
      "mapSmartInsertMode",
      kind === "preview" ? "preview" : "map",
    );
    const state: WorkerObservations = {
      hold: false,
      held: [],
      requests: [],
      delivered: [],
      callbacks: {},
      domClickStates: [],
      workerSequence: 0,
      methods: [],
      computeMs: [],
      posts: 0,
      release(requestIds) {
        if (!requestIds) this.hold = false;
        const selected = requestIds ? new Set(requestIds) : null;
        const held = this.held.filter(
          (reply) => !selected || selected.has(reply.requestId),
        );
        this.held = this.held.filter(
          (reply) => selected && !selected.has(reply.requestId),
        );
        for (const reply of held) reply.deliver();
        return held.length;
      },
    };
    Object.assign(window, { __priorityRelayWorker: state });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        const route = String(url).includes("route.worker");
        const persistence = String(url).includes("persistence.worker");
        const send = this.postMessage.bind(this);
        let postedAt = 0;
        const workerId = route ? ++state.workerSequence : 0;
        let routeRequest: RouteRequestObservation | null = null;
        this.postMessage = (message: { method?: string; key?: string }) => {
          if (persistence && message.method) state.methods.push(message.method);
          if (route) {
            state.posts++;
            postedAt = performance.now();
            routeRequest = {
              requestId: state.posts,
              workerId,
              key: message.key ?? "",
            };
            state.requests.push(routeRequest);
          }
          send(message);
        };
        if (!route) return;
        let handler: ((this: Worker, event: MessageEvent) => unknown) | null =
          null;
        // Keep the real worker and its data. Delay only delivery to its app callback.
        Object.defineProperty(this, "onmessage", {
          configurable: true,
          get: () => handler,
          set: (value) => {
            handler = value;
          },
        });
        this.addEventListener("message", (event) => {
          state.computeMs.push(performance.now() - postedAt);
          const captured = handler;
          const request = routeRequest ?? {
            requestId: -1,
            workerId,
            key: String(event.data.key),
          };
          const deliver = () => {
            state.delivered.push(request);
            captured?.call(this, event);
          };
          if (state.hold) state.held.push({ ...request, deliver });
          else deliver();
        });
      }
    };
  }, kind);
  await page.goto("/");
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "relay-diagnostics.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(source(count)), "utf8"),
    });
  const restore = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await restore.getByRole("radio", { name: /同名で置換/ }).check();
  await restore.getByRole("button", { name: "置換して復元" }).click();
  await expect(restore).toBeHidden();
  await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  await expect(page.locator("[data-route-pending]")).toHaveAttribute(
    "data-route-pending",
    "false",
  );
  expect(
    page
      .workers()
      .some((worker) => worker.url().includes("persistence.worker")),
  ).toBe(true);
}
async function clickResponse(locator: Locator) {
  return locator.evaluate(async (element) => {
    const started = performance.now();
    (element as HTMLElement).click();
    await new Promise(requestAnimationFrame);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return performance.now() - started;
  });
}
async function releaseResponse(page: Page, requestIds?: number[]) {
  return page.evaluate(async (requestIds) => {
    const state = (
      window as unknown as { __priorityRelayWorker: WorkerObservations }
    ).__priorityRelayWorker;
    const started = performance.now();
    const before = state.delivered.length;
    const count = state.release(requestIds);
    await new Promise(requestAnimationFrame);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return {
      count,
      responseMs: performance.now() - started,
      delivered: state.delivered.slice(before),
    };
  }, requestIds);
}
// Retain the actual DOM node across the context change. Direct execution of
// obsolete React callbacks is covered by the connected MapView integration tests.
async function retainClick(locator: Locator, name: string) {
  await locator.evaluate((element, name) => {
    const state = (
      window as unknown as { __priorityRelayWorker: WorkerObservations }
    ).__priorityRelayWorker;
    state.callbacks[name] = () => {
      state.domClickStates.push({ name, connected: element.isConnected });
      (element as HTMLElement).click();
    };
  }, name);
}
async function clickRetainedNodes(page: Page) {
  return page.evaluate(async () => {
    const state = (
      window as unknown as { __priorityRelayWorker: WorkerObservations }
    ).__priorityRelayWorker;
    const started = performance.now();
    const names = Object.keys(state.callbacks);
    for (const callback of Object.values(state.callbacks)) callback();
    await new Promise(requestAnimationFrame);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return {
      names,
      domNodes: state.domClickStates,
      responseMs: performance.now() - started,
    };
  });
}
async function executeIds(page: Page) {
  return page.evaluate(async (event) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("EventShoppingPlannerDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string[]>((resolve, reject) => {
        const store = database
          .transaction("executeModeItems")
          .objectStore("executeModeItems");
        const request = store.get("data");
        request.onsuccess = () => {
          if (request.result?.kind === "event-shopping-planner-day-records") {
            const date = store.get(
              "__esp_internal__:day-record:v1:" +
                JSON.stringify([event, ["1日目"]]),
            );
            date.onsuccess = () => resolve(date.result?.value ?? []);
            date.onerror = () => reject(date.error);
          } else resolve(request.result?.[event]?.["1日目"] ?? []);
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, eventName);
}
for (const roundTrip of [false, true])
  for (const count of [150, 500])
    for (const kind of ["map", "preview", "waiting"] as const) {
      test(`popup ${kind} relay invalidation ${count}${roundTrip ? " A to B to A" : ""} @priority-operation-performance`, async ({
        page,
      }, testInfo) => {
        test.setTimeout(300000);
        await page.setViewportSize({ width: 1280, height: 900 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await initialize(page, count, kind);
        const map = page.locator("[data-route-pending]");
        const canvas = page.locator("canvas").first();
        const popup = page.getByRole("dialog", {
          name: "A-6のアイテム一覧",
          exact: true,
        });
        const position = page
          .getByRole("status")
          .filter({ hasText: "ルート線または番号をクリックしてください" });
        const preview = page.getByRole("dialog", {
          name: "追加位置を選択",
          exact: true,
        });
        const waiting = page
          .getByRole("status")
          .filter({ hasText: "経路を計算しています…" });
        const ui =
          kind === "map" ? position : kind === "preview" ? preview : waiting;
        const timings: Record<string, number[]> = {
          start: [],
          dayChange: [],
          ...(kind === "waiting" ? { staleReplyDelivery: [] } : {}),
          ...(roundTrip
            ? { returnDayChange: [], retainedDomClickDelivery: [] }
            : {}),
        };
        const samples: unknown[] = [];
        try {
          for (let sample = 0; sample < 21; sample++) {
            await page.getByRole("button", { name: /^2日目/ }).click();
            await expect(map).toHaveAttribute("data-route-pending", "false");
            await page.evaluate((hold) => {
              const state = (
                window as unknown as {
                  __priorityRelayWorker: WorkerObservations;
                }
              ).__priorityRelayWorker;
              state.methods = [];
              state.computeMs = [];
              state.requests = [];
              state.delivered = [];
              state.callbacks = {};
              state.domClickStates = [];
              state.hold = hold;
            }, kind === "waiting");
            const requestStarted = await page.evaluate(() => performance.now());
            await page.getByRole("button", { name: /^1日目/ }).click();
            if (kind === "waiting") {
              await expect
                .poll(() =>
                  page.evaluate(
                    () =>
                      (
                        window as unknown as {
                          __priorityRelayWorker: WorkerObservations;
                        }
                      ).__priorityRelayWorker.held.length,
                  ),
                )
                .toBeGreaterThan(0);
              await expect(map).toHaveAttribute("data-route-pending", "true");
            } else
              await expect(map).toHaveAttribute("data-route-pending", "false");
            const oldARequests =
              kind === "waiting"
                ? await page.evaluate(() =>
                    (
                      window as unknown as {
                        __priorityRelayWorker: WorkerObservations;
                      }
                    ).__priorityRelayWorker.held.map(
                      ({ requestId, workerId, key }) => ({
                        requestId,
                        workerId,
                        key,
                      }),
                    ),
                  )
                : [];
            await canvas.click({ position: { x: 322, y: 42 } });
            await expect(popup).toBeVisible();
            if (roundTrip && kind === "waiting")
              await retainClick(
                popup.getByRole("button", {
                  name: "A-6のアイテム一覧を閉じる",
                  exact: true,
                }),
                "oldWaitingPopupClose",
              );
            const startMs = await clickResponse(
              popup.getByText("中継サークル5", { exact: true }),
            );
            timings.start.push(startMs);
            await expect(ui).toBeVisible();
            if (roundTrip && kind === "map") {
              await retainClick(
                position.getByRole("button", {
                  name: "キャンセル",
                  exact: true,
                }),
                "oldMapCancel",
              );
            }
            if (roundTrip && kind === "preview") {
              await retainClick(
                preview
                  .getByRole("button", { name: /^挿入位置 .* を選択$/ })
                  .first(),
                "oldPreviewSelect",
              );
              await retainClick(
                preview.getByRole("button", {
                  name: "キャンセル",
                  exact: true,
                }),
                "oldPreviewCancel",
              );
            }
            const changeMs = await clickResponse(
              page.getByRole("button", { name: /^2日目/ }),
            );
            timings.dayChange.push(changeMs);
            const retained = await ui.isVisible();
            const popupRetained = await popup.isVisible();
            if (phase === "after") await expect(popup).toBeHidden();
            if (phase === "after") await expect(ui).toBeHidden();
            let currentARequests: RouteRequestObservation[] = [];
            let callbackDelivery: {
              names: string[];
              responseMs: number;
            } | null = null;
            if (roundTrip) {
              timings.returnDayChange.push(
                await clickResponse(
                  page.getByRole("button", { name: /^1日目/ }),
                ),
              );
              if (phase === "after") {
                await expect(popup).toBeHidden();
                await expect(ui).toBeHidden();
              }
              if (kind === "waiting") {
                await expect
                  .poll(() =>
                    page.evaluate(
                      (old) => {
                        const state = (
                          window as unknown as {
                            __priorityRelayWorker: WorkerObservations;
                          }
                        ).__priorityRelayWorker;
                        return state.held.some(
                          (reply) =>
                            reply.key === old.key &&
                            !old.ids.includes(reply.requestId),
                        );
                      },
                      {
                        key: oldARequests[0].key,
                        ids: oldARequests.map((request) => request.requestId),
                      },
                    ),
                  )
                  .toBe(true);
                currentARequests = await page.evaluate(
                  (old) =>
                    (
                      window as unknown as {
                        __priorityRelayWorker: WorkerObservations;
                      }
                    ).__priorityRelayWorker.requests.filter(
                      (request) =>
                        request.key === old.key &&
                        !old.ids.includes(request.requestId),
                    ),
                  {
                    key: oldARequests[0].key,
                    ids: oldARequests.map((request) => request.requestId),
                  },
                );
                expect(currentARequests.length).toBeGreaterThan(0);
              } else
                await expect(map).toHaveAttribute(
                  "data-route-pending",
                  "false",
                );
              callbackDelivery = await clickRetainedNodes(page);
              timings.retainedDomClickDelivery.push(
                callbackDelivery.responseMs,
              );
            }
            const released =
              kind === "waiting"
                ? await releaseResponse(
                    page,
                    roundTrip
                      ? oldARequests.map((request) => request.requestId)
                      : undefined,
                  )
                : { count: 0, responseMs: 0, delivered: [] };
            if (kind === "waiting") {
              timings.staleReplyDelivery.push(released.responseMs);
              if (roundTrip) {
                expect(released.count).toBe(oldARequests.length);
                expect(
                  released.delivered.map((reply) => reply.requestId),
                ).toEqual(oldARequests.map((request) => request.requestId));
                if (phase === "after") {
                  await expect(ui).toBeHidden();
                  expect(await executeIds(page)).not.toContain("relay-5");
                }
              }
            }
            const releasedCurrent =
              kind === "waiting" && roundTrip
                ? await releaseResponse(page)
                : null;
            await expect(map).toHaveAttribute("data-route-pending", "false");
            if (phase === "after") await expect(ui).toBeHidden();
            const worker = await page.evaluate(() => {
              const state = (
                window as unknown as {
                  __priorityRelayWorker: WorkerObservations;
                }
              ).__priorityRelayWorker;
              return {
                methods: state.methods,
                computeMs: state.computeMs,
                posts: state.posts,
              };
            });
            const ids = await executeIds(page);
            const writes = worker.methods.filter((method) =>
              [
                "commit",
                "commitDay",
                "day",
                "items",
                "saveEventLists",
                "saveExecuteModeItems",
              ].includes(method),
            );
            samples.push({
              sample,
              roundTrip,
              startMs,
              dayChangeMs: changeMs,
              retainedAfterDayChange: retained,
              popupRetainedAfterDayChange: popupRetained,
              releasedReplies: released.count,
              staleReplyResponseMs: released.responseMs,
              oldARequests,
              currentARequests,
              sameKeyAcrossDistinctRequests:
                currentARequests.length > 0 &&
                currentARequests.every(
                  (request) =>
                    request.key === oldARequests[0]?.key &&
                    !oldARequests.some(
                      (old) => old.requestId === request.requestId,
                    ),
                ),
              staleDeliveredRequests: released.delivered,
              currentDeliveredRequests: releasedCurrent?.delivered ?? [],
              retainedDomClickDelivery: callbackDelivery,
              realWorkerComputeMs: worker.computeMs,
              requestToCurrentRouteReadyMs:
                (await page.evaluate(() => performance.now())) - requestStarted,
              persistenceMethods: worker.methods,
              writes,
              candidateSaved: ids.includes("relay-5"),
            });
            if (phase === "after") {
              expect(writes).toEqual([]);
              expect(ids).not.toContain("relay-5");
            }
            // Baseline defects are observed above; explicit cancellation prepares the next sample.
            if (await position.isVisible())
              await position
                .getByRole("button", { name: "キャンセル", exact: true })
                .click();
            if (await preview.isVisible())
              await preview
                .getByRole("button", { name: "キャンセル", exact: true })
                .click();
            if (await popup.isVisible()) {
              await popup
                .getByRole("button", {
                  name: "A-6のアイテム一覧を閉じる",
                  exact: true,
                })
                .click();
            }
            if (ids.includes("relay-5")) {
              await page.getByRole("button", { name: /^1日目/ }).click();
              await canvas.click({ position: { x: 322, y: 42 } });
              await popup.getByText("中継サークル5", { exact: true }).click();
              await popup
                .getByRole("button", {
                  name: "A-6のアイテム一覧を閉じる",
                  exact: true,
                })
                .click();
              await page.getByRole("button", { name: /^2日目/ }).click();
            }
            if (phase === "after") {
              await canvas.click({ position: { x: 42, y: 42 } });
              const currentPopup = page.getByRole("dialog", {
                name: "A-1のアイテム一覧",
                exact: true,
              });
              await expect(currentPopup).toContainText(
                `中継サークル${roundTrip ? 0 : count - 1}`,
              );
              await currentPopup
                .getByRole("button", {
                  name: "A-1のアイテム一覧を閉じる",
                  exact: true,
                })
                .click();
            }
          }
        } finally {
          const summary = Object.fromEntries(
            Object.entries(timings).map(([name, values]) => {
              const warm = values.slice(1).sort((a, b) => a - b);
              return [
                name,
                {
                  firstMs: values[0],
                  count: warm.length,
                  medianMs: (warm[9] + warm[10]) / 2,
                  p95Ms: warm[Math.ceil(warm.length * 0.95) - 1],
                },
              ];
            }),
          );
          await testInfo.attach(
            `priority-relay-diagnostics-${phase}-${kind}-${count}${roundTrip ? "-roundtrip" : ""}`,
            {
              body: JSON.stringify(
                {
                  phase,
                  kind,
                  count,
                  roundTrip,
                  endpoint: "performance.now → handler → rAF → timeout(0)",
                  timings,
                  summary,
                  samples,
                  errors,
                },
                null,
                2,
              ),
              contentType: "application/json",
            },
          );
        }
        expect(errors).toEqual([]);
        for (const [operation, values] of Object.entries(timings)) {
          const warm = values.slice(1).sort((a, b) => a - b);
          expect(
            warm.length,
            operation + " sample count",
          ).toBeGreaterThanOrEqual(20);
          expect(
            (warm[9] + warm[10]) / 2,
            operation + " median",
          ).toBeLessThanOrEqual(55);
          expect(
            warm[Math.ceil(warm.length * 0.95) - 1],
            operation + " p95",
          ).toBeLessThanOrEqual(100);
        }
      });
    }
