import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
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
        const message = workerDiagnostics.events.find(
          (row) =>
            row.stage === "message-observed" && row.method === "shopping",
        );
        const reply =
          message &&
          workerDiagnostics.events.find(
            (row) => row.stage === "reply-posted" && row.id === message.id,
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
            messageObservedEpoch: message?.at,
            replyPostedEpoch: reply?.at,
            operationId: message?.operationId,
            epochToTrace: {
              inputMarkTraceTs: frame?.correlation?.input.ts,
              inputStartEpoch: start,
              inputMarkerDelayMs: frame?.markerDelayMs,
              method: "same input-mark/epoch mapping as the verified frame",
            },
            ...sampledSelfTimes(
              rawWorkerCpuProfile,
              epochToTrace(message?.at ?? NaN),
              epochToTrace(reply?.at ?? NaN),
            ),
          },
          interpretation:
            "V8 Worker samples clipped to the renderer input/frame window and independently to actual shopping message-observed/reply-posted timestamps; timestamps, idle/GC samples and observer overhead are retained; estimates are not exact callee durations",
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
              "message-observed is the registered listener's observation, not an invented handler-start or queue receipt; reply-posted is the actual Worker postMessage call",
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
          workerInstrumentation: { installed: workerDiagnostics.installed },
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
