import { readFile, writeFile } from "node:fs/promises";
import {
  correlateTransferMoves,
  type MoveFrameMeasurement,
} from "./shopping-transfer-move-correlation";
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
  type MoveLifecycleRecord,
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
              frame?: MoveFrameMeasurement & {
                markerDelayMs?: number;
                commits?: Array<{ at: number; operationId?: string }>;
                tracePath?: string;
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
      const moveCorrelation = correlateTransferMoves(
        diagnostics.moveLifecycle,
        diagnostics.inputs,
        frame,
        selectWorkerDispatchWindow(
          workerDiagnostics.events,
          frame?.commits ?? [],
          workerDiagnostics.handlerHook,
        ),
      );
      if (frame)
        Object.assign(frame, {
          moveIds: moveCorrelation.moves.map((move) => move.moveId),
          moveCorrelation,
        });
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
          moveCorrelation,
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
      expect(moveCorrelation.status).toBe("available");
      expect(moveCorrelation.moves).toHaveLength(1);
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
        workerCpuProfile &&
          "topSelfTimeFrames" in workerCpuProfile.commandWindow &&
          workerCpuProfile.commandWindow.topSelfTimeFrames?.some(
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

const source = `
let database;
self.__returnSentinel = { original: true };
self.__errorSentinel = new Error("original handler error");
const opened = indexedDB.open("transfer-commit-probe-contract", 1);
opened.onupgradeneeded = () => opened.result.createObjectStore("rows");
opened.onsuccess = () => {
  database = opened.result;
  self.postMessage({ ready: true });
};
self.onmessage = function(event) {
  const message = event.data;
  if (message.method === "return-check" || message.method === "throw-check") {
    self.__lastOriginalCall = { receiver: this, args: Array.from(arguments) };
    if (message.method === "throw-check") throw self.__errorSentinel;
    return self.__returnSentinel;
  }
  if (message.method === "read") {
    self.postMessage({ id: message.id, ok: true });
    return;
  }
  const run = () => {
    const transaction = database.transaction("rows", "readwrite");
    transaction.objectStore("rows").put(
      { operation: message.args[1] },
      String(message.id),
    );
    transaction.oncomplete = () => self.postMessage({ id: message.id, ok: true });
    transaction.onabort = () => self.postMessage({ id: message.id, ok: false });
    return transaction;
  };
  if (message.mode === "blocked") {
    self.__resumeMiniWrite = run;
    self.postMessage({ waiting: message.id });
    return;
  }
  if (message.mode === "cached") {
    void Promise.resolve().then(run);
    return;
  }
  if (message.mode === "async") {
    setTimeout(run, 0);
    return;
  }
  return run();
};
`;
type MiniMessage = {
  id: number;
  method: string;
  mode: "sync" | "cached" | "async" | "blocked";
  args: unknown[];
};
type MiniWindow = Window & {
  __miniReady: boolean;
  __miniWaiting?: number;
  __miniCompleted: number[];
  __miniSend(message: MiniMessage): Promise<{ id: number; ok: boolean }>;
};
async function harness(page: Page) {
  await page.route("**/__commit-probe__/harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: {
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; worker-src 'self'; object-src 'none'",
      },
      body: "<!doctype html><title>Commit probe contract fixture</title>",
    }),
  );
  await page.route("**/__commit-probe__/persistence.worker.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: source }),
  );
  await page.goto("/__commit-probe__/harness");
  const created = page.waitForEvent("worker");
  await page.evaluate(() => {
    const state = window as unknown as MiniWindow;
    const worker = new Worker("/__commit-probe__/persistence.worker.js");
    const pending = new Map<
      number,
      (reply: { id: number; ok: boolean }) => void
    >();
    state.__miniReady = false;
    state.__miniCompleted = [];
    worker.addEventListener("message", (event) => {
      if (event.data.ready) state.__miniReady = true;
      else if (event.data.waiting) state.__miniWaiting = event.data.waiting;
      else {
        state.__miniCompleted.push(event.data.id);
        const resolve = pending.get(event.data.id);
        pending.delete(event.data.id);
        resolve?.(event.data);
      }
    });
    state.__miniSend = (message) =>
      new Promise((resolve) => {
        pending.set(message.id, resolve);
        worker.postMessage(message);
      });
  });
  const worker = await created;
  await page.waitForFunction(
    () => (window as unknown as MiniWindow).__miniReady,
  );
  return worker;
}
async function exchange(
  page: Page,
  id: number,
  operation: unknown,
  mode: MiniMessage["mode"],
  method = "shopping",
) {
  return page.evaluate(
    (message) => (window as unknown as MiniWindow).__miniSend(message),
    { id, method, mode, args: [{}, operation] },
  );
}
test("@shopping-performance @shopping-transfer-worker-probe-contract @shopping-transfer-commit-probe-contract binds current sync/cached and async transactions", async ({
  page,
}) => {
  const worker = await harness(page);
  await installCommitProbe(page);
  expect((await exchange(page, 1, "operation:old", "sync")).ok).toBe(true);
  expect((await exchange(page, 2, "operation:current", "cached")).ok).toBe(
    true,
  );
  expect((await exchange(page, 3, "operation:async", "async")).ok).toBe(true);
  expect((await exchange(page, 4, { revision: 1 }, "async", "commit")).ok).toBe(
    true,
  );
  // An unknown RPC during an outstanding async write must not inherit a stale ID.
  // This deliberately exceeds the normal benchmark's serialized request contract.
  await page.evaluate(() => {
    void (window as unknown as MiniWindow).__miniSend({
      id: 5,
      method: "shopping",
      mode: "blocked",
      args: [{}, "operation:blocked"],
    });
  });
  await page.waitForFunction(
    () => (window as unknown as MiniWindow).__miniWaiting === 5,
  );
  expect((await exchange(page, 6, undefined, "sync", "read")).ok).toBe(true);
  await worker.evaluate(() => {
    (
      globalThis as unknown as { __resumeMiniWrite(): void }
    ).__resumeMiniWrite();
  });
  await page.waitForFunction(() =>
    (window as unknown as MiniWindow).__miniCompleted.includes(5),
  );
  const commits = await worker.evaluate(
    () =>
      (
        globalThis as unknown as {
          __transferCommits: Array<{
            at: number;
            operationId?: string;
            stores: string[];
            writes: Array<{ store: string; method: string }>;
          }>;
        }
      ).__transferCommits,
  );
  expect(commits.map((commit) => commit.operationId)).toEqual([
    "operation:old",
    "operation:current",
    "operation:async",
    undefined,
    undefined,
  ]);
  expect(commits).toHaveLength(5);
  for (const commit of commits) {
    expect(commit.stores).toEqual(["rows"]);
    expect(commit.writes).toEqual([{ store: "rows", method: "put" }]);
    expect(Number.isFinite(commit.at) && commit.at > 0).toBe(true);
  }
});
test("@shopping-performance @shopping-transfer-worker-probe-contract @shopping-transfer-commit-probe-contract preserves original receiver arguments return and throw", async ({
  page,
}) => {
  const worker = await harness(page);
  await installCommitProbe(page);
  const result = await worker.evaluate(() => {
    const state = globalThis as unknown as {
      __returnSentinel: object;
      __errorSentinel: Error;
      __lastOriginalCall: { receiver: object; args: unknown[] };
    };
    const receiver = { exact: true };
    const event = { data: { method: "return-check" } };
    const extra = { original: true };
    const returned = Reflect.apply(globalThis.onmessage!, receiver, [
      event,
      extra,
    ]);
    const receiverMatched = state.__lastOriginalCall.receiver === receiver;
    const argsMatched =
      state.__lastOriginalCall.args[0] === event &&
      state.__lastOriginalCall.args[1] === extra &&
      state.__lastOriginalCall.args.length === 2;
    let thrownMatched = false;
    try {
      Reflect.apply(globalThis.onmessage!, receiver, [
        { data: { method: "throw-check" } },
      ]);
    } catch (error) {
      thrownMatched = error === state.__errorSentinel;
    }
    return {
      receiverMatched,
      argsMatched,
      returnMatched: returned === state.__returnSentinel,
      thrownMatched,
    };
  });
  expect(result).toEqual({
    receiverMatched: true,
    argsMatched: true,
    returnMatched: true,
    thrownMatched: true,
  });
});
test("@shopping-performance @shopping-transfer-worker-probe-contract @shopping-transfer-commit-probe-contract does not duplicate wrappers under outer diagnostic Proxy", async ({
  page,
}) => {
  const worker = await harness(page);
  await installCommitProbe(page);
  await worker.evaluate(() => {
    const state = globalThis as unknown as {
      __outerDiagnosticCalls: number;
      __shoppingWorkerDiagnosticProbe: unknown;
    };
    state.__outerDiagnosticCalls = 0;
    state.__shoppingWorkerDiagnosticProbe = {};
    const original = globalThis.onmessage!;
    globalThis.onmessage = new Proxy(original, {
      apply(target, receiver, args) {
        state.__outerDiagnosticCalls++;
        return Reflect.apply(target, receiver, args);
      },
    });
  });
  await installCommitProbe(page);
  expect((await exchange(page, 5, "operation:one-wrapper", "cached")).ok).toBe(
    true,
  );
  const state = await worker.evaluate(() => {
    const observed = globalThis as unknown as {
      __outerDiagnosticCalls: number;
      __transferCommits: Array<{ operationId?: string; writes: unknown[] }>;
    };
    return {
      dispatches: observed.__outerDiagnosticCalls,
      commits: observed.__transferCommits,
    };
  });
  expect(state.dispatches).toBe(1);
  expect(state.commits).toHaveLength(1);
  expect(state.commits[0].operationId).toBe("operation:one-wrapper");
  expect(state.commits[0].writes).toHaveLength(1);
  await worker.evaluate(() => {
    globalThis.onmessage = () => {};
  });
  await expect(installCommitProbe(page)).rejects.toThrow("hooks were replaced");
});
test("@shopping-performance @shopping-transfer-worker-probe-contract @shopping-transfer-commit-probe-contract fails closed on reversed first-install order", async ({
  page,
}) => {
  const worker = await harness(page);
  const original = await worker.evaluate(() => {
    const state = globalThis as unknown as {
      __shoppingWorkerDiagnosticProbe: unknown;
      __originalTransaction: typeof IDBDatabase.prototype.transaction;
      __originalHandler: typeof globalThis.onmessage;
    };
    state.__shoppingWorkerDiagnosticProbe = {};
    state.__originalTransaction = IDBDatabase.prototype.transaction;
    state.__originalHandler = globalThis.onmessage;
    return true;
  });
  expect(original).toBe(true);
  await expect(installCommitProbe(page)).rejects.toThrow(
    "before the Worker diagnostic dispatcher",
  );
  expect(
    await worker.evaluate(() => {
      const state = globalThis as unknown as {
        __originalTransaction: typeof IDBDatabase.prototype.transaction;
        __originalHandler: typeof globalThis.onmessage;
      };
      return (
        IDBDatabase.prototype.transaction === state.__originalTransaction &&
        globalThis.onmessage === state.__originalHandler
      );
    }),
  ).toBe(true);
});

function moveCorrelationFixture() {
  const operationId = "actual-batch";
  const lifecycle: MoveLifecycleRecord[] = [];
  for (let index = 1; index <= 2; index++) {
    const link = {
      diagnosticToken: `actual-drag:${index}`,
      draggedItemId: `item-${index}`,
      sourceColumn: "candidate",
      targetColumn: "execute",
    };
    for (const [phase, epochMs] of [
      ["move-command-entry", 101 + index * 2],
      ["plan-ready", 102 + index * 2],
      ["queue-accepted", 103 + index * 2],
      ["ui-apply-start", 150],
      ["ui-apply-success", 155],
    ] as const)
      lifecycle.push({
        ...link,
        phase,
        epochMs,
        atMs: epochMs - 100,
        ...(phase !== "move-command-entry" && phase !== "plan-ready"
          ? { operationId, moveId: `${operationId}:move:${index}` }
          : {}),
      });
  }
  const inputs = [
    { at: 101, type: "drop", trusted: true },
    { at: 105, type: "drop", trusted: true },
  ];
  const worker = selectWorkerDispatchWindow(
    [
      {
        at: 120,
        stage: "handler-dispatch",
        actualMessageEvent: true,
        id: 9,
        method: "shopping",
        operationId,
      },
      { at: 145, stage: "reply-posted", id: 9 },
    ],
    [{ at: 140 }],
    { status: "installed" },
  );
  const frame: MoveFrameMeasurement = {
    measurementId: "test-sample",
    startEpoch: 100,
    domMs: 60,
    operationId,
    durationMs: 80,
    correlation: {
      input: { pid: 1, ts: 1000 },
      dom: { pid: 1, ts: 61000 },
      paint: { pid: 1, ts: 62000 },
      drawFrame: { pid: 1, ts: 63000 },
      frame: { epochMs: 180, traceTs: 81000, sessionId: 3 },
    },
  };
  return { lifecycle, inputs, worker, frame };
}

test("@shopping-performance @shopping-transfer-move-correlation-contract preserves each actual move in a shared save batch", () => {
  const fixture = moveCorrelationFixture();
  const result = correlateTransferMoves(
    fixture.lifecycle,
    fixture.inputs,
    fixture.frame,
    fixture.worker,
  );
  expect(result.status).toBe("available");
  expect(result.moves.map((move) => move.moveId)).toEqual([
    "actual-batch:move:1",
    "actual-batch:move:2",
  ]);
  expect(result.moves.map((move) => move.input.actualEvent?.at)).toEqual([
    101, 105,
  ]);
  for (const [index, move] of result.moves.entries()) {
    expect(move.operationId).toBe("actual-batch");
    expect(move.input.commandEntry?.diagnosticToken).toBe(
      `actual-drag:${index + 1}`,
    );
    expect(move.queueAccepted.moveId).toBe(move.moveId);
    expect(move.uiApply.success?.moveId).toBe(move.moveId);
    expect(move.worker.requestId).toBe(9);
    expect(move.frame.sessionId).toBe(3);
  }
});

for (const missing of [
  "queue-accepted",
  "move-command-entry",
  "plan-ready",
  "ui-apply-start",
  "ui-apply-success",
])
  test(`@shopping-performance @shopping-transfer-move-correlation-contract rejects missing ${missing}`, () => {
    const fixture = moveCorrelationFixture();
    const result = correlateTransferMoves(
      fixture.lifecycle.filter((record) => record.phase !== missing),
      fixture.inputs,
      fixture.frame,
      fixture.worker,
    );
    expect(result.status).toBe("unavailable");
    expect(result.moves).toEqual([]);
  });

test("@shopping-performance @shopping-transfer-move-correlation-contract rejects stale, duplicate and untrusted identity evidence", () => {
  const fixture = moveCorrelationFixture();
  for (const lifecycle of [
    [...fixture.lifecycle, fixture.lifecycle[2]],
    fixture.lifecycle.map((record) =>
      record.phase === "ui-apply-success"
        ? { ...record, operationId: "other-batch" }
        : record,
    ),
  ])
    expect(
      correlateTransferMoves(
        lifecycle,
        fixture.inputs,
        fixture.frame,
        fixture.worker,
      ).status,
    ).toBe("unavailable");
  expect(
    correlateTransferMoves(
      fixture.lifecycle,
      fixture.inputs.map((input) => ({ ...input, trusted: false })),
      fixture.frame,
      fixture.worker,
    ).status,
  ).toBe("unavailable");
  expect(
    correlateTransferMoves(
      fixture.lifecycle,
      fixture.inputs,
      { ...fixture.frame, operationId: "other-batch" },
      fixture.worker,
    ).status,
  ).toBe("unavailable");
});
