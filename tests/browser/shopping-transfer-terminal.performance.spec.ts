import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { summarizePerformanceSamples } from "./performance-summary";
import { shoppingEvidenceIdentity } from "./shopping-performance-evidence";
import {
  terminalConditions,
  restoreTerminalFixture,
  measureTerminal,
  installCommitProbe,
} from "./shopping-transfer-terminal-measurement";
import type { TransferSample } from "./shopping-transfer-measurement";
test.use({
  video: "off",
  trace: "off",
  viewport: { width: 1440, height: 1000 },
  hasTouch: true,
});
test.describe.configure({ retries: 0 });
for (const condition of terminalConditions)
  for (const measurementKind of condition.scenario === "noop" ||
  condition.scenario === "same-column"
    ? (["response", "frame"] as const)
    : (["response"] as const)) {
    test(`@shopping-performance @shopping-transfer-rendering-performance terminal ${condition.input} ${condition.scenario} ${measurementKind}`, async ({
      page,
      context,
    }, testInfo) => {
      test.setTimeout(600000);
      page.setDefaultTimeout(15000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const frame = measurementKind === "frame",
        saving = condition.scenario === "same-column";
      const names = frame
        ? ["frame"]
        : saving
          ? ["response", "nextPending", "nextApplied", "save"]
          : ["response", "nextApplied"];
      const samples: Record<string, TransferSample[]> = Object.fromEntries(
        names.map((name) => [name, []]),
      );
      let failure: unknown;
      let fixture: unknown;
      try {
        for (let index = 0; index < 20; index++) {
          // A fresh fixture is explicit preparation, never part of a sample's clock.
          fixture = await restoreTerminalFixture(
            page,
            condition,
            frame && index === 0,
          );
          const worker = await installCommitProbe(page);
          const session = await context.newCDPSession(page);
          try {
            if (condition.input === "touch")
              await session.send("Emulation.setTouchEmulationEnabled", {
                enabled: true,
                maxTouchPoints: 1,
              });
            const measured = await measureTerminal(
              page,
              session,
              worker,
              condition,
              index,
              frame,
              testInfo,
            );
            for (const [name, sample] of Object.entries(measured))
              samples[name].push(sample);
          } finally {
            await session.detach();
          }
        }
      } catch (error) {
        failure = error;
      }
      const metrics = Object.fromEntries(
        Object.entries(samples).map(([name, values]) => {
          const raw = values.map((s) => s.durationMs);
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
        metrics,
        errors,
        method: {
          repetitions: 20,
          freshFixturePerSample: true,
          warmupMoves: 0,
          trace: frame,
          video: false,
          thresholds: { minimumCount: 20, medianMs: 55, p95Ms: 100 },
          response:
            "trusted drop/dragend/touchend/touchcancel event timestamp to correct endpoint/selection/order and cleared drag UI, then rAF and next task",
        },
        ...(!saving
          ? {
              notApplicable: {
                save: "No persistence mutation is accepted for this terminal outcome",
                nextPending: "No save is pending for this terminal outcome",
              },
              persistence: { writeCount: 0, operationId: null, commits: [] },
            }
          : {}),
        ...(failure
          ? {
              failure:
                failure instanceof Error ? failure.message : String(failure),
            }
          : {}),
      };
      const filename = testInfo.outputPath("shopping-transfer-rendering.json");
      await writeFile(filename, JSON.stringify(artifact, null, 2), "utf8");
      await testInfo.attach("shopping-transfer-rendering", {
        path: filename,
        contentType: "application/json",
      });
      expect(errors).toEqual([]);
      if (failure) throw failure;
      for (const [name, metric] of Object.entries(metrics)) {
        expect(metric.raw).toHaveLength(20);
        if (name !== "save") {
          expect(metric.summary.medianMs).toBeLessThanOrEqual(55);
          expect(metric.summary.p95Ms).toBeLessThanOrEqual(100);
        }
      }
    });
  }
