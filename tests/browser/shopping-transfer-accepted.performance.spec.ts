import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { summarizePerformanceSamples } from "./performance-summary";
import { shoppingEvidenceIdentity } from "./shopping-performance-evidence";
import {
  installCommitProbe,
  measureTransfer,
  readTransferDurable,
  transferRow,
  type TransferSample,
} from "./shopping-transfer-measurement";
import {
  acceptedTransferConditions,
  prepareAcceptedScenario,
  restoreAcceptedScenario,
  verifyAcceptedScenario,
} from "./shopping-transfer-scenarios";

test.use({
  video: "off",
  trace: "off",
  viewport: { width: 1440, height: 1000 },
  hasTouch: true,
});
test.describe.configure({ retries: 0 });
for (const condition of acceptedTransferConditions)
  for (const measurementKind of ["response", "frame"] as const) {
    test(`@shopping-performance @shopping-transfer-rendering-performance ${condition.scenario} ${condition.count} ${condition.input} grouping on light ${condition.direction} ${measurementKind}`, async ({
      browser,
    }, testInfo) => {
      test.setTimeout(900000);
      const errors: string[] = [],
        notices: string[] = [];
      const samples: Record<string, TransferSample[]> = Object.fromEntries(
        (measurementKind === "response"
          ? ["response", "nextPending", "nextApplied", "save"]
          : ["frame"]
        ).map((name) => [name, []]),
      );
      const fixtures: unknown[] = [];
      let failure: unknown, environment: unknown;
      try {
        for (let index = 1; index <= 20; index++) {
          // Close the preceding Worker and its IDB connections before reseeding.
          // Context setup, fixture restore and one unrelated warmup precede the clocks.
          const context = await browser.newContext({
            baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173",
            viewport: { width: 1440, height: 1000 },
            hasTouch: true,
            serviceWorkers: "allow",
          });
          const page = await context.newPage();
          page.setDefaultTimeout(15000);
          page.on("pageerror", (error) => errors.push(error.message));
          page.on("dialog", async (dialog) => {
            notices.push(dialog.message());
            await dialog.dismiss();
          });
          try {
            environment ??= {
              browserVersion: browser.version(),
              userAgent: await page.evaluate(() => navigator.userAgent),
              viewport: page.viewportSize(),
              devicePixelRatio: await page.evaluate(() => devicePixelRatio),
              browserChannel:
                process.env.PERFORMANCE_BROWSER_CHANNEL ?? "bundled-chromium",
              headed: process.env.PERFORMANCE_HEADED === "1",
              workers: 1,
              retries: testInfo.retry,
            };
            const scenario = await restoreAcceptedScenario(
              page,
              condition,
              measurementKind === "frame",
            );
            const worker = await installCommitProbe(page),
              session = await context.newCDPSession(page);
            try {
              if (condition.input === "touch")
                await session.send("Emulation.setTouchEmulationEnabled", {
                  enabled: true,
                  maxTouchPoints: 1,
                });
              // No measured ID has previously moved in this isolated fixture.
              const warmup = await measureTransfer(
                page,
                session,
                worker,
                condition,
                0,
                false,
                testInfo,
                {
                  sourceId: scenario.warmupSourceId,
                  anchorId: scenario.warmupAnchorId,
                  anchorPosition: "any",
                  pendingInput: false,
                  guideKind: "either",
                  measurementId: `warmup-${condition.scenario}-${condition.input}-${condition.direction}-${index}`,
                },
              );
              await transferRow(page, scenario.warmupAnchorId)
                .locator('input[type="checkbox"]')
                .uncheck();
              const before = await readTransferDurable(page);
              const options = await prepareAcceptedScenario(
                page,
                session,
                condition,
                scenario,
              );
              const measurementId = `accepted-${condition.scenario}-${condition.input}-${condition.direction}-${measurementKind}-${index}`;
              const measured = await measureTransfer(
                page,
                session,
                worker,
                condition,
                index,
                measurementKind === "frame",
                testInfo,
                { ...options, measurementId },
              );
              const durableProof = await verifyAcceptedScenario(
                page,
                before,
                scenario,
                condition,
              );
              fixtures.push({
                index,
                ...scenario.fixture,
                fixtureHash: scenario.fixtureHash,
                isolation: "new-browser-context-per-sample",
                initialCount: condition.count,
                warmup: {
                  sourceId: scenario.warmupSourceId,
                  anchorId: scenario.warmupAnchorId,
                  operationId:
                    "save" in warmup ? warmup.save.operationId : null,
                  commits: "save" in warmup ? warmup.save.commits : null,
                  selectionReset: true,
                },
                baselineItemOrder: before.items.map((item) => item.id),
                baselineExecuteIds: before.executeIds,
              });
              for (const [name, sample] of Object.entries(measured))
                if (sample && samples[name])
                  samples[name].push({
                    ...sample,
                    durableProof,
                    visualTarget: "card",
                    fixtureHash: scenario.fixtureHash,
                  });
            } finally {
              await session.detach();
            }
          } catch (error) {
            await testInfo
              .attach(`accepted-${index}-failure-screenshot`, {
                body: await page.screenshot(),
                contentType: "image/png",
              })
              .catch(() => {});
            await testInfo
              .attach(`accepted-${index}-failure-dom`, {
                body: await page.locator("body").ariaSnapshot(),
                contentType: "text/yaml",
              })
              .catch(() => {});
            throw error;
          } finally {
            await context.close();
          }
        }
      } catch (error) {
        failure = error;
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
        fixtures,
        environment,
        method: {
          warmupMoves: 1,
          warmupPerFixture: true,
          repetitions: 20,
          sampleIsolation: "new-browser-context-per-sample",
          uniqueMeasuredMovePerFixture: true,
          trace: measurementKind === "frame",
          video: false,
          gesture: condition.input,
          response:
            "trusted drop/touchend to every effective source removal and actual visible destination cards/order/controls, then rAF and following task",
          nextInput:
            "trusted pending and applied checkbox input with Worker transaction timestamp phase proof",
          frame:
            "first content-verified compositor PNG with every visible moved source origin and destination card, each mapped to its Paint and identity/control crop before the same DrawFrame",
          offscreen:
            "visible moved cards plus independent full membership/content and hidden merge destination proof; no hidden-card frame claim",
          collapsed:
            "actual collapsed header hit, preserved hidden destination members and visible inserted card",
          autoScroll:
            "actual trusted native drag at viewport edge changes product scroll before measured drop; fresh before-drop screenshot preserves current coordinate proof",
          rpcByteEstimates:
            "serialized after Tracing.end, outside measured frame endpoint",
          thresholds: { minimumCount: 20, medianMs: 55, p95Ms: 100 },
        },
        metrics,
        errors,
        notices,
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
        expect(metric.raw.length, `${name}: missing samples`).toBe(20);
        expect(
          metric.raw.every((value) => Number.isFinite(value) && value >= 0),
          `${name}: invalid sample`,
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
