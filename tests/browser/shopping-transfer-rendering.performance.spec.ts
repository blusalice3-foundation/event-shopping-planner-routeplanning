import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { summarizePerformanceSamples } from "./performance-summary";
import { shoppingEvidenceIdentity } from "./shopping-performance-evidence";
import {
  installCommitProbe,
  measureTransfer,
  restoreTransferFixture,
  transferConditions,
  verifyContinuousTransferResult,
  type TransferSample,
} from "./shopping-transfer-measurement";

test.use({
  video: "off",
  trace: "off",
  viewport: { width: 1440, height: 1000 },
  hasTouch: true,
});
test.describe.configure({ retries: 0 });
for (const condition of transferConditions)
  for (const measurementKind of ["response", "frame"] as const) {
    test(`@shopping-performance @shopping-transfer-rendering-performance ${condition.count} ${condition.input} grouping ${condition.grouped ? "on" : "off"} ${condition.load} ${condition.direction} ${measurementKind}`, async ({
      page,
      context,
    }, testInfo) => {
      test.setTimeout(600000);
      page.setDefaultTimeout(15000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const fixture = await restoreTransferFixture(
        page,
        condition,
        measurementKind === "frame",
      );
      const worker = await installCommitProbe(page);
      const session = await context.newCDPSession(page);
      const samples: Record<string, TransferSample[]> = Object.fromEntries(
        (measurementKind === "response"
          ? ["response", "nextPending", "nextApplied", "save"]
          : ["frame"]
        ).map((name) => [name, []]),
      );
      let failure: unknown;
      let finalState: unknown;
      try {
        if (condition.input === "touch")
          await session.send("Emulation.setTouchEmulationEnabled", {
            enabled: true,
            maxTouchPoints: 1,
          });
        // One fixed, unrecorded move warms the same product path. Measured IDs each move once.
        await measureTransfer(
          page,
          session,
          worker,
          condition,
          0,
          false,
          testInfo,
        );
        for (let index = 1; index <= 20; index++) {
          const measured = await measureTransfer(
            page,
            session,
            worker,
            condition,
            index,
            measurementKind === "frame",
            testInfo,
          );
          for (const [name, sample] of Object.entries(measured))
            if (sample && samples[name])
              samples[name].push(sample as TransferSample);
        }
        finalState = await verifyContinuousTransferResult(page, condition);
      } catch (error) {
        failure = error;
      } finally {
        await session.detach();
      }
      const metrics = Object.fromEntries(
        Object.entries(samples).map(([name, values]) => {
          const raw = values.map((sample) => sample.durationMs);
          return [
            name,
            {
              raw,
              summary: raw.length
                ? summarizePerformanceSamples(raw)
                : { count: 0, medianMs: null, p95Ms: null },
              samples: values,
            },
          ];
        }),
      );
      const artifact = {
        ...shoppingEvidenceIdentity("transfer", measurementKind),
        condition,
        fixture,
        environment: {
          browserVersion: context.browser()?.version(),
          userAgent: await page.evaluate(() => navigator.userAgent),
          viewport: page.viewportSize(),
          devicePixelRatio: await page.evaluate(() => devicePixelRatio),
          browserChannel:
            process.env.PERFORMANCE_BROWSER_CHANNEL ?? "bundled-chromium",
          headed: process.env.PERFORMANCE_HEADED === "1",
          workers: 1,
          retries: testInfo.retry,
        },
        method: {
          warmupMoves: 1,
          repetitions: 20,
          uniqueSourceIds: true,
          trace: measurementKind === "frame",
          video: false,
          response:
            "trusted input event timestamp to expected destination/source/order/controls DOM, then rAF and following task",
          nextInput:
            "queued trusted CDP mouse input timestamp to correct checkbox state, then rAF and following task; Worker transaction epoch proves pending/applied phase",
          frame:
            "first content-verified full-resolution PNG screencast frame, armed before input; its frame-swap timestamp follows the same-renderer DOM marker, covering Paint and DrawFrame; includes actual capture load",
          save: "Worker readwrite transaction complete epoch minus input timestamp; auxiliary with no response threshold",
          frameComparison:
            "source gap and destination dark-ink glyph shapes/opacity must match final reference and discriminate pre-drop identities; checkbox/status control ink is checked separately; allowed striping/hover background color is excluded",
          actualMoveIds:
            "measurementId identifies only the test sample; actual persistence operationId is reported separately when exposed",
          thresholds: { minimumCount: 20, medianMs: 55, p95Ms: 100 },
        },
        metrics,
        finalState,
        errors,
        ...(failure
          ? {
              failure:
                failure instanceof Error ? failure.message : String(failure),
            }
          : {}),
      };
      const output = testInfo.outputPath("shopping-transfer-rendering.json");
      await writeFile(output, JSON.stringify(artifact, null, 2), "utf8");
      await testInfo.attach("shopping-transfer-rendering", {
        path: output,
        contentType: "application/json",
      });
      expect(errors).toEqual([]);
      if (failure) throw failure;
      for (const [name, metric] of Object.entries(metrics)) {
        expect(
          metric.raw.length,
          `${name}: missing samples`,
        ).toBeGreaterThanOrEqual(20);
        expect(
          metric.raw.every((value) => Number.isFinite(value) && value >= 0),
          `${name}: invalid raw timing`,
        ).toBe(true);
        if (name !== "save") {
          expect(
            metric.summary.medianMs,
            `${name}: median`,
          ).toBeLessThanOrEqual(55);
          expect(metric.summary.p95Ms, `${name}: p95`).toBeLessThanOrEqual(100);
        }
      }
    });
  }
