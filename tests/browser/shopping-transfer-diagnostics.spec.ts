import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  shoppingBrowserEnvironment,
  shoppingEvidenceIdentity,
} from "./shopping-performance-evidence";
import {
  installTransferDiagnostics,
  resetTransferDiagnostics,
  readTransferDiagnostics,
  installWorkerTransferDiagnostics,
  resetWorkerTransferDiagnostics,
  readWorkerTransferDiagnostics,
  createWorkerCpuProfiler,
  selectWorkerDispatchWindow,
  type DiagnosticCpuProfile,
} from "./shopping-transfer-diagnostics";
import {
  restoreTransferFixture,
  installCommitProbe,
  measureTransfer,
} from "./shopping-transfer-measurement";

import {
  prepareAcceptedScenario,
  restoreAcceptedScenario,
} from "./shopping-transfer-scenarios";
function sampledSelfTimes(
  profile: DiagnosticCpuProfile,
  start: number,
  end: number,
) {
  if (
    ![profile.startTime, profile.endTime, start, end].every(Number.isFinite) ||
    profile.startTime > start ||
    end > profile.endTime ||
    start >= end ||
    !profile.samples ||
    !profile.timeDeltas ||
    profile.samples.length !== profile.timeDeltas.length
  )
    return {
      status: "unavailable",
      reason:
        "Profile timestamps/samples do not cover the actual renderer input/frame window",
    };
  const self = new Map<number, { sampledSelfMs: number; samples: number }>();
  let timestamp = profile.startTime;
  for (const [index, nodeId] of profile.samples.entries()) {
    const delta = profile.timeDeltas[index];
    if (!Number.isFinite(delta) || delta < 0)
      return {
        status: "unavailable",
        reason: "Profile contains invalid sample intervals",
      };
    const previous = timestamp;
    timestamp += delta;
    const overlap = Math.max(
      0,
      Math.min(timestamp, end) - Math.max(previous, start),
    );
    if (overlap === 0) continue;
    const row = self.get(nodeId) ?? { sampledSelfMs: 0, samples: 0 };
    row.sampledSelfMs += overlap / 1000;
    row.samples++;
    self.set(nodeId, row);
  }
  return {
    status: "available",
    intervalUs: 1000,
    startTraceTs: start,
    endTraceTs: end,
    interpretation:
      "Sampled self-time estimates clipped to the actual renderer trace window; includes profiler overhead, idle/program/GC frames remain labeled; no timing correction is applied",
    topSelfTimeFrames: [...self]
      .map(([nodeId, value]) => ({
        nodeId,
        ...profile.nodes.find((node) => node.id === nodeId)?.callFrame,
        ...value,
      }))
      .sort((a, b) => b.sampledSelfMs - a.sampledSelfMs)
      .slice(0, 50),
  };
}
test.use({
  viewport: { width: 1440, height: 1000 },
  hasTouch: true,
  video: "off",
  trace: "off",
});
test.describe.configure({ retries: 0 });
for (const profile of [
  { scenario: "single", load: "practical" },
  { scenario: "multiple", load: "light" },
] as const)
  for (const direction of [
    "candidate-to-execute",
    "execute-to-candidate",
  ] as const)
    test(`@shopping-performance @shopping-transfer-diagnostic ${profile.load} ${profile.scenario} diagnostic ${direction}`, async ({
      page,
      context,
    }, testInfo) => {
      test.setTimeout(300000);
      const condition = {
        count: 500,
        grouped: true,
        load: profile.load,
        input: "native" as const,
        direction,
      };
      await installTransferDiagnostics(page);
      const accepted =
        profile.scenario === "multiple"
          ? await restoreAcceptedScenario(
              page,
              { ...condition, scenario: "multiple" },
              true,
            )
          : undefined;
      const fixture =
        accepted?.fixture ??
        (await restoreTransferFixture(page, condition, true));
      const worker = await installCommitProbe(page);
      await installWorkerTransferDiagnostics(worker);
      const session = await context.newCDPSession(page);
      let sample: unknown;
      let failure: unknown;
      let end = 0;
      let profiling = false;
      let rawCpuProfile: DiagnosticCpuProfile | undefined;
      let rawWorkerCpuProfile: DiagnosticCpuProfile | undefined;
      let workerProfiler:
        | Awaited<ReturnType<typeof createWorkerCpuProfiler>>
        | undefined;
      let workerProfiling = false;
      try {
        await measureTransfer(
          page,
          session,
          worker,
          condition,
          0,
          false,
          testInfo,
          accepted
            ? {
                sourceId: accepted.warmupSourceId,
                anchorId: accepted.warmupAnchorId,
                anchorPosition: "any",
                pendingInput: false,
                guideKind: "either",
              }
            : undefined,
        );
        let options;
        if (accepted) {
          const checkbox = page.locator(
            `[data-item-id="${accepted.warmupAnchorId}"]:not([data-space-group-key]) input[type="checkbox"]`,
          );
          await checkbox.uncheck();
          options = await prepareAcceptedScenario(
            page,
            session,
            { ...condition, scenario: "multiple" },
            accepted,
          );
        }
        const browser = context.browser();
        if (!browser) throw new Error("Worker profiling requires Chromium");
        workerProfiler = await createWorkerCpuProfiler(
          browser,
          session,
          worker,
        );
        await resetTransferDiagnostics(page);
        await resetWorkerTransferDiagnostics(worker);
        await session.send("Profiler.enable");
        await session.send("Profiler.setSamplingInterval", { interval: 1000 });
        await workerProfiler.start();
        workerProfiling = true;
        await session.send("Profiler.start");
        profiling = true;
        sample = await measureTransfer(
          page,
          session,
          worker,
          condition,
          1,
          true,
          testInfo,
          options,
        );
      } catch (error) {
        failure = error;
      } finally {
        if (workerProfiler) {
          if (workerProfiling) {
            try {
              rawWorkerCpuProfile = await workerProfiler.stop();
            } catch (error) {
              failure ??= error;
            }
          }
          await workerProfiler.dispose().catch((error: unknown) => {
            failure ??= error;
          });
        }
        if (profiling) {
          try {
            rawCpuProfile = (await session.send("Profiler.stop")).profile;
          } catch (error) {
            failure ??= error;
          }
          await session.send("Profiler.disable").catch(() => {});
        }
        end = await page.evaluate(
          () => performance.timeOrigin + performance.now(),
        );
        await session.detach();
      }
      const frame = (
        sample as
          | {
              frame?: {
                startEpoch?: number;
                durationMs?: number;
                markerDelayMs?: number;
                commits?: Array<{ at: number; operationId?: string }>;
                tracePath?: string;
                correlation?: {
                  input: { pid: number; ts: number };
                  frame: { traceTs: number };
                };
              };
            }
          | undefined
      )?.frame;
      const start = frame?.startEpoch ?? 0;
      if (frame?.durationMs !== undefined) end = start + frame.durationMs;
      const diagnostics = await readTransferDiagnostics(page, start, end);
      const workerDiagnostics = await readWorkerTransferDiagnostics(
        worker,
        start,
        end,
      );
      let cpuProfile;
      let workerCpuProfile;
      if (rawWorkerCpuProfile) {
        const bytes = Buffer.from(JSON.stringify(rawWorkerCpuProfile));
        const profilePath = testInfo.outputPath(
          "shopping-transfer-worker.cpuprofile",
        );
        await writeFile(profilePath, bytes);
        await testInfo.attach("shopping-transfer-worker-cpu-profile", {
          path: profilePath,
          contentType: "application/json",
        });
        // The original product uses commit, while the new product uses shopping.
        const command = selectWorkerDispatchWindow(
          workerDiagnostics.events,
          frame?.commits ?? [],
          workerDiagnostics.handlerHook,
        );
        const epochToTrace = (epoch: number) =>
          (frame?.correlation?.input.ts ?? NaN) +
          (epoch - start - (frame?.markerDelayMs ?? NaN)) * 1000;
        workerCpuProfile = {
          path: profilePath,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          target: workerProfiler?.target,
          profileStartTime: rawWorkerCpuProfile.startTime,
          profileEndTime: rawWorkerCpuProfile.endTime,
          ...sampledSelfTimes(
            rawWorkerCpuProfile,
            frame?.correlation?.input.ts ?? NaN,
            frame?.correlation?.frame.traceTs ?? NaN,
          ),
          commandWindow: {
            ...command,
            epochToTrace: {
              inputMarkTraceTs: frame?.correlation?.input.ts,
              inputStartEpoch: start,
              inputMarkerDelayMs: frame?.markerDelayMs,
              method: "same input-mark/epoch mapping as the verified frame",
            },
            ...(command.status === "available"
              ? sampledSelfTimes(
                  rawWorkerCpuProfile,
                  epochToTrace(command.handlerDispatchEpoch),
                  epochToTrace(command.replyPostedEpoch),
                )
              : {}),
          },
          interpretation:
            "V8 Worker samples clipped to the renderer input/frame window and independently to actual request handler-dispatch/reply-posted timestamps including Worker queue wait; timestamps, idle/GC samples and observer overhead are retained; estimates are not exact callee durations",
        };
      }
      let mainThreadLongTasks: {
        atTraceTs: number;
        durationMs: number;
        pid: number;
        tid: number;
      }[] = [];
      if (rawCpuProfile) {
        const bytes = Buffer.from(JSON.stringify(rawCpuProfile));
        const profilePath = testInfo.outputPath(
          "shopping-transfer-main.cpuprofile",
        );
        await writeFile(profilePath, bytes);
        await testInfo.attach("shopping-transfer-main-cpu-profile", {
          path: profilePath,
          contentType: "application/json",
        });
        cpuProfile = {
          path: profilePath,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          profileStartTime: rawCpuProfile.startTime,
          profileEndTime: rawCpuProfile.endTime,
          ...sampledSelfTimes(
            rawCpuProfile,
            frame?.correlation?.input.ts ?? NaN,
            frame?.correlation?.frame.traceTs ?? NaN,
          ),
        };
      }
      if (frame?.tracePath && frame.correlation) {
        const events = (
          JSON.parse(await readFile(frame.tracePath, "utf8")) as {
            traceEvents: Array<{
              name: string;
              pid: number;
              tid: number;
              ts: number;
              dur?: number;
            }>;
          }
        ).traceEvents;
        const input = events.find(
          (entry) =>
            entry.pid === frame.correlation!.input.pid &&
            entry.ts === frame.correlation!.input.ts &&
            entry.name.endsWith(":input"),
        );
        mainThreadLongTasks = events
          .filter(
            (entry) =>
              input &&
              entry.name === "RunTask" &&
              entry.pid === input.pid &&
              entry.tid === input.tid &&
              (entry.dur ?? 0) >= 50000 &&
              entry.ts <= frame.correlation!.frame.traceTs &&
              entry.ts + (entry.dur ?? 0) >= input.ts,
          )
          .map((entry) => ({
            atTraceTs: entry.ts,
            durationMs: entry.dur! / 1000,
            pid: entry.pid,
            tid: entry.tid,
          }));
      }
      const body = JSON.stringify(
        {
          ...shoppingEvidenceIdentity("transfer", "frame"),
          diagnosticOnly: true,
          acceptanceMeasurement: false,
          condition: { ...condition, scenario: profile.scenario },
          fixture,
          environment: await shoppingBrowserEnvironment(page, testInfo.retry),
          method: {
            repetitions: 1,
            warmupMoves: 1,
            responseThresholdApplied: false,
            instrumentation:
              "Test-only React commit/PerformedWork fiber counts, shopping geometry getters with product/observer call-stack attribution, Long Tasks API, actual Worker message/reply observation, plus content-verified renderer trace/frame, 1000us renderer and Worker CPU profiles, and armed native Worker cost wrappers",
            lifecycle:
              "handler-dispatch is recorded synchronously immediately before Reflect.apply invokes the existing onmessage handler; the window includes its tail queue wait; reply-posted is the actual Worker postMessage call",
            window:
              "trusted drop through content-verified first frame; overlapping long tasks are included and raw epoch timestamps are retained",
            workerCosts:
              "Proxy wrappers preserve native arguments/receiver/return values and promises. syncDurationMs measures only synchronous native invocation/copy/enqueue, not asynchronous digest or IndexedDB completion; top-level keys and array lengths are observed without walking item content. probeOverheadMs measures metadata recording only; no exact canonical/FNV duration is inferred.",
            geometry:
              "Counts calls to real geometry/height getters, not distinct product layout calculations; observer calls and overhead are reported separately",
          },
          diagnosticWindow: { startEpoch: start, endEpoch: end },
          diagnostics,
          counts: {
            commits: diagnostics.commits.length,
            renders: diagnostics.commits.reduce(
              (n, c) => n + c.rendered.length,
              0,
            ),
            mounts: diagnostics.commits.reduce(
              (n, c) => n + c.mounted.length,
              0,
            ),
            productHeightReads: diagnostics.geometryReads.filter(
              (r) => r.origin === "product",
            ).length,
            observerHeightReads: diagnostics.geometryReads.filter(
              (r) => r.origin === "observer",
            ).length,
            longTasks: diagnostics.longTasks.length,
            traceMainThreadLongTasks: mainThreadLongTasks.length,
            workerStructuredCloneCalls: workerDiagnostics.costs.filter(
              (row) => row.method === "structuredClone",
            ).length,
            workerDigestCalls: workerDiagnostics.costs.filter(
              (row) => row.method === "crypto.subtle.digest",
            ).length,
            workerDigestInputBytes: workerDiagnostics.costs.reduce(
              (n, row) => n + (row.inputBytes ?? 0),
              0,
            ),
            workerPutCalls: workerDiagnostics.costs.filter(
              (row) => row.method === "IDBObjectStore.put",
            ).length,
            workerNativeSyncMs: workerDiagnostics.costs.reduce(
              (n, row) => n + row.syncDurationMs,
              0,
            ),
            workerProbeOverheadMs: workerDiagnostics.costs.reduce(
              (n, row) => n + row.probeOverheadMs,
              0,
            ),
            overheadMs:
              diagnostics.commits.reduce((n, c) => n + c.overheadMs, 0) +
              diagnostics.geometryReads.reduce((n, r) => n + r.overheadMs, 0),
          },
          workerEvents: workerDiagnostics.events,
          workerCosts: workerDiagnostics.costs,
          workerInstrumentation: {
            installed: workerDiagnostics.installed,
            handlerHook: workerDiagnostics.handlerHook,
          },
          cpuProfile,
          workerCpuProfile,
          mainThreadLongTasks,
          sample,
          failure:
            failure instanceof Error
              ? failure.message
              : failure
                ? String(failure)
                : undefined,
        },
        null,
        2,
      );
      await writeFile(
        testInfo.outputPath("shopping-transfer-diagnostics.json"),
        body,
        "utf8",
      );
      await testInfo.attach("shopping-transfer-diagnostics", {
        body,
        contentType: "application/json",
      });
      if (failure) throw failure;
      expect(diagnostics.rendererInjected).toBe(true);
      expect(diagnostics.commits.length).toBeGreaterThan(0);
      expect(workerDiagnostics.events.length).toBeGreaterThan(0);
      expect(workerDiagnostics.installed.sort()).toEqual([
        "digest",
        "onmessage",
        "postMessage",
        "put",
        "structuredClone",
      ]);
      expect(workerDiagnostics.costs.length).toBeGreaterThan(0);
      expect(
        workerDiagnostics.costs.every(
          (row) =>
            Number.isFinite(row.syncDurationMs) &&
            row.syncDurationMs >= 0 &&
            Number.isFinite(row.probeOverheadMs) &&
            row.probeOverheadMs >= 0,
        ),
      ).toBe(true);
      expect(cpuProfile?.status).toBe("available");
      expect(workerCpuProfile?.status).toBe("available");
      expect(workerCpuProfile?.commandWindow.status).toBe("available");
      expect(workerCpuProfile?.target?.identityVerified).toBe(true);
      expect(
        workerCpuProfile?.commandWindow.topSelfTimeFrames?.some(
          (row) => row.url === workerProfiler?.target.url,
        ),
        "Actual shopping command must contain measured Worker bundle samples",
      ).toBe(true);
    });

// These toy Workers test diagnostic boundaries only. They never use product
// data, acceptance clocks, a response budget or the normal 100-case sampler.
async function miniDiagnosticWorker(page: Page, source: string) {
  await page.goto("/release-capabilities.json");
  // Honor the product's worker-src 'self' policy; only this toy script request is
  // fulfilled by the fixture, without changing CSP or the product worker.
  const pattern = "**" + "/__shopping_worker_probe_fixture__.js";
  await page.context().unroute(pattern);
  await page.context().route(pattern, (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `${source}\nself.__miniReady = true;`,
    }),
  );
  const pending = page.waitForEvent("worker");
  await page.evaluate(() => {
    const worker = new Worker("/__shopping_worker_probe_fixture__.js");
    Object.assign(globalThis, {
      __miniDiagnosticWorker: worker,
      __miniReplies: [],
    });
    worker.addEventListener("message", (event) => {
      (
        globalThis as unknown as { __miniReplies: unknown[] }
      ).__miniReplies.push(event.data);
    });
  });
  const worker = await pending;
  await expect
    .poll(() =>
      worker.evaluate(
        () => (globalThis as unknown as { __miniReady?: boolean }).__miniReady,
      ),
    )
    .toBe(true);
  await installWorkerTransferDiagnostics(worker);
  await resetWorkerTransferDiagnostics(worker);
  return worker;
}
async function postMiniRequest(page: Page, id: number) {
  await page.evaluate((id) => {
    (
      globalThis as unknown as { __miniDiagnosticWorker: Worker }
    ).__miniDiagnosticWorker.postMessage({
      id,
      method: "shopping",
      args: [{}, `op-${id}`],
    });
  }, id);
}
async function waitMiniReplies(page: Page, count: number) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (globalThis as unknown as { __miniReplies: unknown[] }).__miniReplies
            .length,
      ),
    )
    .toBe(count);
}
const allWorkerDiagnostics = (
  worker: Parameters<typeof readWorkerTransferDiagnostics>[0],
) => readWorkerTransferDiagnostics(worker, 0, Number.MAX_SAFE_INTEGER);

test("Worker dispatch contract records before the original synchronous body and same-ID reply @shopping-performance @shopping-transfer-worker-probe-contract", async ({
  page,
}) => {
  const worker = await miniDiagnosticWorker(
    page,
    `
    self.onmessage = function(event) {
      structuredClone({id:event.data.id});
      self.postMessage({id:event.data.id,result:true});
    };
  `,
  );
  await postMiniRequest(page, 1);
  await waitMiniReplies(page, 1);
  const data = await allWorkerDiagnostics(worker);
  const dispatch = data.events.find(
    (event) => event.stage === "handler-dispatch",
  )!;
  const clone = data.costs.find((cost) => cost.method === "structuredClone")!;
  const reply = data.events.find((event) => event.stage === "reply-posted")!;
  expect(data.handlerHook.status).toBe("installed");
  expect(dispatch.actualMessageEvent).toBe(true);
  expect(dispatch.eventTimestampEpoch).toBeGreaterThan(0);
  expect(dispatch.at).toBeLessThanOrEqual(clone.at);
  expect(clone.at).toBeLessThanOrEqual(reply.at);
  const window = selectWorkerDispatchWindow(
    data.events,
    [{ at: clone.at }],
    data.handlerHook,
  );
  expect(window.status).toBe("available");
  if (window.status === "available") {
    expect(window.requestId).toBe(1);
    expect(window.operationId).toBe("op-1");
    expect(window.handlerDispatchEpoch).toBe(dispatch.at);
    expect(window.replyPostedEpoch).toBe(reply.at);
  }
});

test("Worker dispatch contract covers a fulfilled tail's synchronous microtask work @shopping-performance @shopping-transfer-worker-probe-contract", async ({
  page,
}) => {
  const worker = await miniDiagnosticWorker(
    page,
    `
    let tail = Promise.resolve();
    self.onmessage = function(event) {
      tail = tail.then(async () => {
        structuredClone({id:event.data.id});
        await Promise.resolve();
        self.postMessage({id:event.data.id,result:true});
      });
    };
  `,
  );
  await postMiniRequest(page, 2);
  await waitMiniReplies(page, 1);
  const data = await allWorkerDiagnostics(worker);
  const dispatch = data.events.find(
    (event) => event.stage === "handler-dispatch",
  )!;
  const clone = data.costs.find((cost) => cost.method === "structuredClone")!;
  expect(dispatch.at).toBeLessThanOrEqual(clone.at);
  expect(
    selectWorkerDispatchWindow(
      data.events,
      [{ at: clone.at }],
      data.handlerHook,
    ).status,
  ).toBe("available");
});

test("Worker dispatch contract includes blocked tail queue wait without inventing body start @shopping-performance @shopping-transfer-worker-probe-contract", async ({
  page,
}) => {
  const worker = await miniDiagnosticWorker(
    page,
    `
    let release;
    let tail = new Promise(resolve => { release = resolve; });
    self.__miniReceived=0;
    self.__releaseMiniTail = () => release();
    self.onmessage = function(event) {
      self.__miniReceived++;
      tail = tail.then(async () => {
        structuredClone({id:event.data.id});
        // One millisecond of deliberate toy body work separates the queued
        // requests' completion markers; this fixture has no performance budget.
        const until=performance.now()+1;
        while(performance.now()<until){}
        self.postMessage({id:event.data.id,bodyMarkerEpoch:performance.timeOrigin+performance.now()});
      });
    };
  `,
  );
  await postMiniRequest(page, 3);
  await postMiniRequest(page, 4);
  await expect
    .poll(() =>
      worker.evaluate(
        () =>
          (globalThis as unknown as { __miniReceived: number }).__miniReceived,
      ),
    )
    .toBe(2);
  await worker.evaluate(() =>
    (
      globalThis as unknown as { __releaseMiniTail(): void }
    ).__releaseMiniTail(),
  );
  await waitMiniReplies(page, 2);
  const data = await allWorkerDiagnostics(worker);
  const dispatch = data.events.find(
    (event) => event.stage === "handler-dispatch" && event.id === 4,
  )!;
  const firstCost = data.costs[0]!;
  const reply3 = data.events.find(
    (event) => event.stage === "reply-posted" && event.id === 3,
  )!;
  const lastCost = data.costs.at(-1)!;
  const bodyMarker = await page.evaluate(
    () =>
      (
        globalThis as unknown as {
          __miniReplies: Array<{ id: number; bodyMarkerEpoch: number }>;
        }
      ).__miniReplies.find((reply) => reply.id === 4)!.bodyMarkerEpoch,
  );
  expect(dispatch.at).toBeLessThanOrEqual(firstCost.at);
  expect(dispatch.at).toBeLessThanOrEqual(reply3.at);
  expect(reply3.at).toBeLessThanOrEqual(lastCost.at);
  const window = selectWorkerDispatchWindow(
    data.events,
    [{ at: bodyMarker }],
    data.handlerHook,
  );
  expect(window.status).toBe("available");
  if (window.status === "available") {
    expect(window.requestId).toBe(4);
    expect(window.interpretation).toContain("tail queue wait");
    expect(window).not.toHaveProperty("bodyStartEpoch");
  }
});
test("Worker dispatch contract preserves receiver, exact arguments, return and thrown values @shopping-performance @shopping-transfer-worker-probe-contract", async ({
  page,
}) => {
  const worker = await miniDiagnosticWorker(
    page,
    `
    self.__returnToken={token:true};
    self.__throwToken=new Error("original");
    self.onmessage=function(...args){
      self.__lastCall={receiver:this,args};
      if(args[0].data.mode==="throw") throw self.__throwToken;
      return self.__returnToken;
    };
  `,
  );
  const result = await worker.evaluate(() => {
    const state = globalThis as unknown as {
      onmessage: (...args: unknown[]) => unknown;
      __returnToken: unknown;
      __throwToken: unknown;
      __lastCall: { receiver: unknown; args: unknown[] };
    };
    const receiver = { originalReceiver: true },
      first = { data: { id: 7, method: "shopping", args: [] } },
      second = { extra: true };
    const returned = Reflect.apply(state.onmessage, receiver, [first, second]);
    const receiverPreserved = state.__lastCall.receiver === receiver;
    const argsPreserved =
      state.__lastCall.args.length === 2 &&
      state.__lastCall.args[0] === first &&
      state.__lastCall.args[1] === second;
    let thrownPreserved = false;
    try {
      Reflect.apply(state.onmessage, receiver, [{ data: { mode: "throw" } }]);
    } catch (error) {
      thrownPreserved = error === state.__throwToken;
    }
    return {
      receiverPreserved,
      argsPreserved,
      returnPreserved: returned === state.__returnToken,
      thrownPreserved,
    };
  });
  expect(result).toEqual({
    receiverPreserved: true,
    argsPreserved: true,
    returnPreserved: true,
    thrownPreserved: true,
  });
});

test("Worker dispatch contract fails closed for missing, replaced and ambiguous hooks or identity @shopping-performance @shopping-transfer-worker-probe-contract", async ({
  page,
}) => {
  const missing = await miniDiagnosticWorker(page, `self.onmessage=null;`);
  const missingData = await allWorkerDiagnostics(missing);
  expect(missingData.handlerHook.status).toBe("unavailable");
  expect(
    selectWorkerDispatchWindow([], [], missingData.handlerHook).status,
  ).toBe("unavailable");
  const replaced = await miniDiagnosticWorker(
    page,
    `self.onmessage=event=>self.postMessage({id:event.data.id});`,
  );
  await replaced.evaluate(() => {
    globalThis.onmessage = () => {};
  });
  const replacedData = await allWorkerDiagnostics(replaced);
  expect(replacedData.handlerHook.reason).toContain("replaced");
  expect(
    selectWorkerDispatchWindow([], [], replacedData.handlerHook).status,
  ).toBe("unavailable");
  const real = await miniDiagnosticWorker(
    page,
    `self.onmessage=event=>{structuredClone({});self.postMessage({id:event.data.id});};`,
  );
  await postMiniRequest(page, 8);
  await waitMiniReplies(page, 1);
  const data = await allWorkerDiagnostics(real),
    cost = data.costs[0];
  expect(
    selectWorkerDispatchWindow(
      [...data.events, ...data.events],
      [{ at: cost.at }],
      data.handlerHook,
    ).status,
  ).toBe("unavailable");
  expect(
    selectWorkerDispatchWindow(
      data.events.map((event) => ({ ...event, id: undefined })),
      [{ at: cost.at }],
      data.handlerHook,
    ).status,
  ).toBe("unavailable");
  expect(
    selectWorkerDispatchWindow(
      data.events,
      [{ at: cost.at - 1000 }],
      data.handlerHook,
    ).status,
  ).toBe("unavailable");
});
