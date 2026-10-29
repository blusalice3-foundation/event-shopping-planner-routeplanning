import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { summarizePerformanceSamples } from "./performance-summary";
import {
  shoppingEvidenceIdentity,
  performanceMeasurementSampleCount,
  performanceAcceptanceCriteriaForGroup,
} from "./shopping-performance-evidence";
import {
  installCommitProbe,
  measureTransfer,
  prepareTransferSourceOrigin,
  readTransferDurable,
  transferRow,
  type TransferSample,
  type BaselineFrameObservation,
  appendBaselineFrameObservation,
  canRecordBaselineFrameObservation,
} from "./shopping-transfer-measurement";
import {
  resolveBaselineProductObservation,
  isTerminalBaselineObservation,
} from "./shopping-transfer-terminal-observation";
import {
  acceptedTransferConditions,
  acceptedRangeFrameGeometry,
  prepareAcceptedScenario,
  prepareAcceptedRangeFrame,
  verifyAcceptedRangeFramePreparation,
  restoreAcceptedScenario,
  verifyAcceptedScenario,
  captureAcceptedSelectionPostcondition,
  type AcceptedTransferPostconditionError,
} from "./shopping-transfer-scenarios";

const shoppingPerformanceThresholds =
  performanceAcceptanceCriteriaForGroup("transfer").acceptanceThresholds;

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
      const postconditionErrors: AcceptedTransferPostconditionError[] = [];
      const phase = process.env.ESP_EVIDENCE_PHASE;
      const baselineComparisonObservation =
        phase === "before" &&
        measurementKind === "frame" &&
        condition.scenario === "range" &&
        condition.count === 500
          ? resolveBaselineProductObservation({ phase })
          : undefined;
      const baselineFrameMode = isTerminalBaselineObservation(
        baselineComparisonObservation,
      );
      const baselineFrameObservations: BaselineFrameObservation[] = [];
      let failure: unknown, environment: unknown;
      try {
        for (
          let index = 1;
          index <= performanceMeasurementSampleCount;
          index++
        ) {
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
          let originalFrameAttempt:
            | {
                observation: Pick<
                  BaselineFrameObservation,
                  | "sampleIndex"
                  | "measurementId"
                  | "fixtureHash"
                  | "effectiveIds"
                >;
                fixture: () => unknown;
                verifyDurable: () => Promise<
                  Awaited<ReturnType<typeof verifyAcceptedScenario>>
                >;
                scenarioEvidence: Record<string, unknown> | undefined;
                expectedTransferredIds: readonly string[];
              }
            | undefined;
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
                before,
              );
              const measurementId = `accepted-${condition.scenario}-${condition.input}-${condition.direction}-${measurementKind}-${index}`;
              let rangeFramePreparation:
                | Awaited<ReturnType<typeof prepareAcceptedRangeFrame>>
                | undefined;
              if (
                measurementKind === "frame" &&
                condition.scenario === "range"
              ) {
                const preparation = await prepareAcceptedRangeFrame(
                  page,
                  scenario.effectiveIds,
                  scenario.anchorId,
                );
                rangeFramePreparation = preparation;
                const preparationPath = testInfo.outputPath(
                  `${measurementId}-preclock-preparation.json`,
                );
                await writeFile(
                  preparationPath,
                  JSON.stringify(preparation, null, 2),
                  "utf8",
                );
                await testInfo.attach(`${measurementId}-preclock-preparation`, {
                  path: preparationPath,
                  contentType: "application/json",
                });
                // Persist actual geometry before any preparation guard can fail.
                verifyAcceptedRangeFramePreparation(preparation);
                const origin = await prepareTransferSourceOrigin(
                  page,
                  scenario.sourceId,
                );
                const originPath = testInfo.outputPath(
                  `${measurementId}-preclock-source-origin.json`,
                );
                await writeFile(
                  originPath,
                  JSON.stringify(origin, null, 2),
                  "utf8",
                );
                await testInfo.attach(
                  `${measurementId}-preclock-source-origin`,
                  {
                    path: originPath,
                    contentType: "application/json",
                  },
                );
                options.scenarioEvidence = {
                  ...options.scenarioEvidence,
                  framePreparation: {
                    ...preparation,
                    origin,
                    preparationPath,
                    originPath,
                  },
                };
              }
              const fixtureEvidence = () => ({
                index,
                ...(baselineFrameMode ? { measurementId } : {}),
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
                  responseMs:
                    "response" in warmup ? warmup.response.durationMs : null,
                  saveMs: "save" in warmup ? warmup.save.durationMs : null,
                  auxiliary: true,
                  firstFixtureMove: true,
                  selectionReset: true,
                },
                baselineItemOrder: before.items.map((item) => item.id),
                baselineExecuteIds: before.executeIds,
              });
              if (baselineFrameMode)
                originalFrameAttempt = {
                  observation: {
                    sampleIndex: index,
                    measurementId,
                    fixtureHash: scenario.fixtureHash,
                    effectiveIds: [...scenario.effectiveIds],
                  },
                  fixture: fixtureEvidence,
                  verifyDurable: () =>
                    verifyAcceptedScenario(page, before, scenario, condition),
                  scenarioEvidence: options.scenarioEvidence,
                  expectedTransferredIds: [
                    ...(options.expectedTransferredIds ??
                      scenario.effectiveIds),
                  ],
                };
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
              if (rangeFramePreparation) {
                const geometry = await acceptedRangeFrameGeometry(
                  page,
                  scenario.effectiveIds,
                  scenario.anchorId,
                );
                const observationPath = testInfo.outputPath(
                  `${measurementId}-post-frame-observation.json`,
                );
                await writeFile(
                  observationPath,
                  JSON.stringify({ geometry, measured }, null, 2),
                  "utf8",
                );
                await testInfo.attach(
                  `${measurementId}-post-frame-observation`,
                  {
                    path: observationPath,
                    contentType: "application/json",
                  },
                );
                // Physical observations precede every additional range-frame guard.
                expect("frame" in measured).toBe(true);
                if (!("frame" in measured))
                  throw new Error("Range frame missing");
                const frame = measured.frame;
                expect(frame).toBeDefined();
                if (!frame) throw new Error("Range frame missing");
                const actualOrigin = frame.gestureObservation as
                  | Awaited<ReturnType<typeof prepareTransferSourceOrigin>>
                  | undefined;
                const primary = rangeFramePreparation.after.source.find(
                  (row) => row.id === scenario.sourceId,
                );
                expect(actualOrigin?.sourceHitTest.selectedHit?.matched).toBe(
                  true,
                );
                expect(actualOrigin?.sourceHitTest.sourceId).toBe(
                  scenario.sourceId,
                );
                expect(
                  Math.abs(
                    (actualOrigin?.sourceHitTest.sourceRect.y ?? Infinity) -
                      primary!.rect!.y,
                  ),
                  "The frozen engine must preserve the prepared source position",
                ).toBeLessThanOrEqual(1);
                expect(frame.visibleSourceIds).toHaveLength(3);
                expect(frame.visibleSourceIds).toEqual(scenario.effectiveIds);
                expect(frame.visibleTransferredIds).toHaveLength(3);
                const expectedDestinationOrder =
                  scenario.forwardOrderExpectation?.expectedDisplayIds ??
                  scenario.reverseOrderExpectation!.expectedDisplayIds;
                expect(frame.visibleTransferredIds).toEqual(
                  expectedDestinationOrder.filter((id) =>
                    scenario.effectiveIds.includes(id),
                  ),
                );
                expect(frame.correlation.sourceProofs).toHaveLength(3);
                expect(frame.correlation.targetProofs).toHaveLength(3);
                expect(
                  geometry.source.every(
                    (row) =>
                      row.fullyVisible &&
                      row.controls.length > 0 &&
                      row.controls.every((control) => control.fullyVisible),
                  ),
                  "All three destination cards and visible controls must fully fit",
                ).toBe(true);
              }
              const durableProof = await verifyAcceptedScenario(
                page,
                before,
                scenario,
                condition,
              );
              const recordedMeasurementId =
                "response" in measured
                  ? measured.response.measurementId
                  : measured.frame.measurementId;
              if (!recordedMeasurementId)
                throw new Error("Completed transfer measurement ID is missing");
              const samplePostconditionErrors =
                await captureAcceptedSelectionPostcondition(
                  page,
                  scenario.effectiveIds,
                  index,
                  recordedMeasurementId,
                );
              postconditionErrors.push(...samplePostconditionErrors);
              // Each original isolated fixture contributes once. A later UI
              // postcondition failure is retained and fails the test below;
              // it never refills or replaces a timed sample with another one.
              fixtures.push(fixtureEvidence());
              for (const [name, sample] of Object.entries(measured))
                if (sample && samples[name])
                  samples[name].push({
                    ...sample,
                    durableProof,
                    postconditionErrors: samplePostconditionErrors,
                    visualTarget: "card",
                    fixtureHash: scenario.fixtureHash,
                  });
              if (baselineFrameMode)
                appendBaselineFrameObservation(baselineFrameObservations, {
                  ...originalFrameAttempt!.observation,
                  outcome: "completed",
                  durationMs: measured.frame!.durationMs,
                });
            } finally {
              await session.detach();
            }
          } catch (error) {
            if (
              originalFrameAttempt &&
              canRecordBaselineFrameObservation(
                error,
                phase,
                measurementKind,
                condition,
                baselineComparisonObservation,
              ) &&
              error.measurementId ===
                originalFrameAttempt.observation.measurementId
            ) {
              const failureScreenshotPath = testInfo.outputPath(
                `${error.measurementId}-failure-screenshot.png`,
              );
              const failureDomPath = testInfo.outputPath(
                `${error.measurementId}-failure-dom.yml`,
              );
              const screenshot = await page.screenshot();
              const dom = Buffer.from(
                await page.locator("body").ariaSnapshot(),
                "utf8",
              );
              await writeFile(failureScreenshotPath, screenshot);
              await writeFile(failureDomPath, dom);
              Object.assign(error.evidence, {
                failureScreenshotPath,
                failureScreenshotSha256: createHash("sha256")
                  .update(screenshot)
                  .digest("hex"),
                failureDomPath,
                failureDomSha256: createHash("sha256")
                  .update(dom)
                  .digest("hex"),
              });
              await testInfo.attach(`accepted-${index}-failure-screenshot`, {
                path: failureScreenshotPath,
                contentType: "image/png",
              });
              await testInfo.attach(`accepted-${index}-failure-dom`, {
                path: failureDomPath,
                contentType: "text/yaml",
              });
              fixtures.push(originalFrameAttempt.fixture());
              // Frame observability never excuses failed persistence/content/order.
              // A proof failure remains fatal and does not create an observation.
              const durableProof = await originalFrameAttempt.verifyDurable();
              Object.assign(error.evidence, {
                durableProof,
                scenarioEvidence: originalFrameAttempt.scenarioEvidence,
                expectedTransferredIds:
                  originalFrameAttempt.expectedTransferredIds,
              });
              appendBaselineFrameObservation(baselineFrameObservations, {
                ...originalFrameAttempt.observation,
                outcome: "endpoint-unobservable",
                failure: {
                  code: error.code,
                  message: error.message,
                  evidence: error.evidence,
                },
              });
              // Observe the next original isolated fixture once; never retry or
              // replace this missing endpoint with a fabricated duration/sample.
              continue;
            }
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
      if (
        !failure &&
        baselineFrameObservations.some(
          (entry) => entry.outcome === "endpoint-unobservable",
        )
      )
        failure = new Error(
          "Baseline frame endpoint was unobservable in original fixture attempts; no latency value was substituted",
        );
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
        ...(baselineFrameMode
          ? { baselineComparisonObservation, baselineFrameObservations }
          : {}),
        method: {
          warmupMoves: 1,
          warmupPerFixture: true,
          repetitions: performanceMeasurementSampleCount,
          sampleIsolation: "new-browser-context-per-sample",
          uniqueMeasuredMovePerFixture: true,
          trace: measurementKind === "frame",
          video: false,
          gesture: condition.input,
          response:
            "trusted drop/touchend to every effective source removal and mounted destination cards/order/controls, then rAF and following task",
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
          selectionPostcondition:
            "checked moved identities are reported after clocks and mandatory durable proof; all original isolated samples are retained and any postcondition error fails acceptance",
          thresholds: shoppingPerformanceThresholds,
        },
        metrics,
        errors,
        notices,
        postconditionErrors,
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
      expect(postconditionErrors).toEqual([]);
      for (const [name, metric] of Object.entries(metrics)) {
        expect(metric.raw.length, `${name}: missing samples`).toBe(
          shoppingPerformanceThresholds.minimumCount,
        );
        expect(
          metric.raw.every((value) => Number.isFinite(value) && value >= 0),
          `${name}: invalid sample`,
        ).toBe(true);
        if (name !== "save") {
          expect(
            metric.summary.medianMs,
            `${name}: median`,
          ).toBeLessThanOrEqual(shoppingPerformanceThresholds.medianMs);
          expect(metric.summary.p95Ms, `${name}: p95`).toBeLessThanOrEqual(
            shoppingPerformanceThresholds.p95Ms,
          );
        }
      }
    });
  }
