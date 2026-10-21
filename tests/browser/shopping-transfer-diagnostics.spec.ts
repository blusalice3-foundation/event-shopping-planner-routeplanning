import { writeFile } from "node:fs/promises";
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
  readWorkerTransferDiagnostics,
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
        await resetTransferDiagnostics(page);
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
        end = await page.evaluate(
          () => performance.timeOrigin + performance.now(),
        );
        await session.detach();
      }
      const frame = (
        sample as
          | { frame?: { startEpoch?: number; durationMs?: number } }
          | undefined
      )?.frame;
      const start = frame?.startEpoch ?? 0;
      if (frame?.durationMs !== undefined) end = start + frame.durationMs;
      const diagnostics = await readTransferDiagnostics(page, start, end);
      const workerEvents = await readWorkerTransferDiagnostics(
        worker,
        start,
        end,
      );
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
              "Test-only React commit/PerformedWork fiber counts, shopping geometry getters with product/observer call-stack attribution, Long Tasks API, actual Worker message/reply observation, plus content-verified renderer trace and frame",
            lifecycle:
              "message-observed is the registered listener's observation, not an invented handler-start or queue receipt; reply-posted is the actual Worker postMessage call",
            window:
              "trusted drop through content-verified first frame; overlapping long tasks are included and raw epoch timestamps are retained",
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
            overheadMs:
              diagnostics.commits.reduce((n, c) => n + c.overheadMs, 0) +
              diagnostics.geometryReads.reduce((n, r) => n + r.overheadMs, 0),
          },
          workerEvents,
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
      expect(workerEvents.length).toBeGreaterThan(0);
    });
