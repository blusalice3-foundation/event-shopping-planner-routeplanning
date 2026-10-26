import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  evidenceIdentity,
  expectedConditions,
  rejectedDiagnosticEnvironment,
  summarizeSamples,
  validateEvidenceArtifact,
  validateBaselineFrameObservationArtifact,
  validateTransferSourceProof,
  validateAcceptedScenarioProof,
  verifyGroupEvidence,
  verifyFrameFiles,
} from "./verify-shopping-performance-evidence.mjs";

import {
  expectedPerformanceCases,
  expectedTransferMetricNames,
  shoppingPerformanceThresholds,
  shoppingCollectionMetadataForCount,
} from "./shopping-performance-evidence-contract.mjs";
const identity = { phase: "after", runId: "fixture-run" };
const env = {
  ESP_EVIDENCE_PHASE: identity.phase,
  ESP_EVIDENCE_RUN_ID: identity.runId,
};
const browserEnvironment = {
  browserVersion: "140.0.0.0",
  userAgent: "fixture-browser",
  browserChannel: "bundled-chromium",
  viewport: { width: 1440, height: 1000 },
  devicePixelRatio: 1,
  headed: false,
  workers: 1,
  retries: 0,
};
const raw = () => Array.from({ length: 10 }, (_, i) => 10 + i / 10);
const terminalScenarios = new Set(["noop", "reject", "cancel", "same-column"]);
function movedIds(condition) {
  const n =
    !condition.scenario || terminalScenarios.has(condition.scenario)
      ? 1
      : ["range", "mixed"].includes(condition.scenario)
        ? 3
        : ["collapsed", "auto-scroll"].includes(condition.scenario)
          ? 1
          : 2;
  return Array.from({ length: n }, (_, i) => `item-${i + 1}`);
}
function sourceFixtureProof(moved) {
  const selected = {
    origin: "card-edge",
    point: { x: 104, y: 135 },
    hitTagName: "DIV",
    hitTitle: null,
    hitItemId: moved[0],
    sourceContainsHit: true,
    sourceOwnerMatched: true,
    interactive: false,
    withinSource: true,
    withinViewport: true,
    matched: true,
    hitRect: { x: 100, y: 100, width: 100, height: 80 },
  };
  return {
    sourcePoint: selected.point,
    sourceOrigin: selected.origin,
    sourceHitTest: {
      sourceId: moved[0],
      sourceRect: { x: 100, y: 100, width: 100, height: 80 },
      attempts: [selected],
      selectedHit: selected,
      initialRejection: null,
    },
  };
}
function acceptedFixtureProof(condition, moved) {
  if (!condition.scenario || terminalScenarios.has(condition.scenario))
    return {};
  const requested =
    condition.scenario === "same-visit-merge" ? moved.slice(0, 1) : [...moved];
  const selection = {
    requestedIds: requested,
    requestedDisplayOrder: [...requested],
    checkboxChecks: requested.map((targetId, i) => ({
      targetId,
      checked: true,
      scrollY: i * 1000,
      rect: { x: 100, y: 200, width: 20, height: 20 },
    })),
    headerText: `Move(${requested.length === moved.length ? `${requested.length}件` : `選択${requested.length}件（移動${moved.length}件）`})`,
    requestedCount: requested.length,
    effectiveCount: moved.length,
    mountedCheckedIds: [...requested],
    exactSelectionVerified: true,
    scrollRestoration:
      condition.scenario === "offscreen" &&
      condition.direction === "candidate-to-execute"
        ? { before: 0, after: 0, sourceVisible: true, anchorVisible: true }
        : null,
  };
  const rest = Array.from(
    { length: condition.count - moved.length - 2 },
    (_, i) => `unmoved-${i}`,
  );
  const raw = ["anchor-1", ...moved, "other-candidate", ...rest];
  const reversed = condition.direction === "execute-to-candidate";
  const count =
    condition.scenario === "same-visit-merge"
      ? 1
      : ["multiple-merge", "mixed", "offscreen"].includes(condition.scenario)
        ? 2
        : 0;
  const tail = reversed
    ? []
    : Array.from({ length: count }, (_, i) => {
        const appendedIds = count === 1 ? [...moved] : [moved[i]];
        const existingIds = [i ? "other-candidate" : "anchor-1"];
        return {
          existingIds,
          appendedIds,
          expectedIds: [...existingIds, ...appendedIds],
          durableIds: [...existingIds, ...appendedIds],
          mountedIds: [...existingIds, ...appendedIds],
        };
      });
  const mergeProof =
    condition.scenario === "offscreen"
      ? [
          {
            source: moved[1],
            target: "other-candidate",
            sourceNumber: "9999a2",
            targetNumber: "9999a",
            targetMembership: true,
          },
        ]
      : [];
  return {
    scenarioEvidence: {
      selectionPreparation: selection,
      ...(condition.scenario === "offscreen"
        ? {
            offscreenTargetId: "other-candidate",
            targetMounted: false,
            targetBounds: null,
            viewport: browserEnvironment.viewport,
            offscreenBeforeDrop: true,
          }
        : {}),
    },
    durableProof: {
      fullItemContentPreserved: true,
      selectionPreparation: selection,
      actualItemOrder: raw,
      actualExecuteIds: [],
      mergeProof,
      offscreenIdentityProof:
        condition.scenario === "offscreen"
          ? { ...mergeProof[0], beforeItemPreserved: true }
          : null,
      mergeTailProof: tail,
      candidateOrderProof: reversed
        ? {
            contract: "candidate-raw-boundary-and-default-display",
            rawOrderVerified: true,
            defaultDisplayOrderVerified: true,
            expectedItemOrder: raw,
            actualItemOrder: raw,
            expectedExecuteIds: [],
            actualExecuteIds: [],
            expectedRawCandidateIds: raw,
            actualRawCandidateIds: raw,
            expectedDisplayIds: raw,
            actualMountedDisplayIds: raw,
            sourceIds: moved,
            displayedBeforeIds: ["anchor-1", "other-candidate", ...rest],
            boundaryKind: "next-displayed-row",
            anchorId: "anchor-1",
            boundaryId: "other-candidate",
          }
        : null,
    },
  };
}
const metric = (kind = "response", operation = "response", condition = {}) => {
  const noSave = ["noop", "reject", "cancel"].includes(condition.scenario);
  const moved = movedIds(condition);
  const preparedNextInput =
    kind === "response" &&
    !["noop", "reject", "cancel", "same-column"].includes(condition.scenario);
  const hit = {
    itemId: "anchor-1",
    column: (condition.direction ?? "candidate-to-execute").split("-to-")[1],
    tagName: "INPUT",
    type: "checkbox",
    exactInput: true,
  };
  const values = operation === "save" ? raw().map(() => 2) : raw();
  return {
    raw: values,
    summary: summarizeSamples(values),
    samples: values.map((durationMs, i) => ({
      durationMs,
      matched: true,
      measurementId: `sample-${i}`,
      targetId: operation.startsWith("next") ? "anchor-1" : "item-1",
      ...(!terminalScenarios.has(condition.scenario)
        ? { expectedTransferredIds: moved }
        : {}),
      startEpoch: 1000000 + i * 1000,
      commits: noSave
        ? []
        : [{ at: 1000002 + i * 1000, stores: ["eventLists"] }],
      physicalWriteCount: noSave ? 0 : 1,
      operationId: null,
      operationIdUnavailableReason: "Fixture has no operation ID",
      ...(!terminalScenarios.has(condition.scenario)
        ? {
            gestureObservation: sourceFixtureProof(moved),
            ...acceptedFixtureProof(condition, moved),
          }
        : {}),
      ...(preparedNextInput
        ? {
            nextInputId: "anchor-1",
            nextInputStrategy:
              (condition.scenario ?? "single") === "single"
                ? "anchor"
                : "topmost-visible-unmoved-destination",
            expectedTransferredIds: moved,
          }
        : {}),
      ...(operation.startsWith("next")
        ? {
            trusted: true,
            ...(preparedNextInput
              ? {
                  inputPreparation: {
                    targetId: "anchor-1",
                    point: { x: 110, y: 130 },
                    rect: { x: 100, y: 120, width: 20, height: 20 },
                    checked: operation === "nextApplied",
                    viewport: { width: 1440, height: 1000 },
                    actualHit: { ...hit },
                    hitTestMatched: true,
                  },
                  inputPoint: { x: 110, y: 130 },
                  actualHit: { ...hit },
                  queueDelayMs: 0.25,
                }
              : {}),
            eventEpoch:
              1000000 + i * 1000 + (operation === "nextPending" ? 1 : 3),
          }
        : {}),
      ...(noSave && operation === "response"
        ? {
            selectionBeforeIds: ["t0", "t1", "t2"],
            selectionAfterIds: ["t0", "t1", "t2"],
            guideCleared: true,
            cloneCleared: true,
            sourceInteractive: true,
            endpointsCleared: condition.scenario === "noop",
            endpointsRetained: condition.scenario !== "noop",
          }
        : {}),
      ...(kind === "frame"
        ? {
            frameVerified: true,
            sourceAbsent: true,
            destinationOrderVerified: true,
            controlsVerified: true,
            frameTimestampMs: durationMs,
            ...(condition.scenario === "range"
              ? {
                  visibleSourceIds: [...moved],
                  visibleTransferredIds: [...moved],
                }
              : {}),
            ...(condition.scenario === "noop"
              ? {
                  visualTarget: "endpoints",
                  sourceAbsent: false,
                  sourcePresent: true,
                  selectionVerified: true,
                  endpointsCleared: true,
                }
              : condition.scenario === "same-column"
                ? {
                    visualTarget: "source-origin",
                    sourceAbsent: false,
                    sourcePresent: true,
                    sourceOriginVacated: true,
                    orderVerified: true,
                  }
                : {}),
          }
        : {}),
    })),
  };
};
function artifact(
  group,
  condition = expectedConditions(group)[0],
  kind = "response",
) {
  const base = {
    ...evidenceIdentity(group, kind, env),
    environment: browserEnvironment,
    errors: [],
  };
  if (group === "shopping") {
    const ops = ["execute", "executeRecord", "focus", "record", "next", "back"];
    return {
      ...base,
      ...condition,
      timings: Object.fromEntries(ops.map((op) => [op, raw()])),
      summary: Object.fromEntries(
        ops.map((op) => [op, summarizeSamples(raw())]),
      ),
      uiTimings: Object.fromEntries(ops.map((op) => [op, raw()])),
      uiSummary: Object.fromEntries(
        ops.map((op) => [op, summarizeSamples(raw())]),
      ),
      uiSamples: Object.fromEntries(
        ops.map((op) => [
          op,
          raw().map((duration, i) => ({
            sampleId: `${op}-${i}`,
            targetId: "item-1",
            expected: "Purchased",
            matched: true,
            legacyMs: duration,
            uiMs: duration,
          })),
        ]),
      ),
    };
  }
  if (group === "range") {
    const ops = [
      "firstEndpoint",
      "secondEndpoint",
      "selectRange",
      "clearRange",
    ];
    return {
      ...base,
      environment: {
        ...browserEnvironment,
        ...condition,
        requestedRenderer: condition.renderer,
      },
      timings: Object.fromEntries(ops.map((op) => [op, raw()])),
      summary: Object.fromEntries(
        ops.map((op) => [op, summarizeSamples(raw())]),
      ),
      samples: raw().map((duration, repeat) => ({
        repeat,
        durations: Object.fromEntries(ops.map((op) => [op, duration])),
      })),
    };
  }
  if (group === "drag") {
    const ops = [
      "same-boundary",
      "boundary-switch",
      "multiple-merges",
      "mixed",
      "offscreen-merge",
      "auto-scroll",
      ...(!condition.grouped ? ["rejected"] : []),
      "drop",
    ];
    return {
      ...base,
      fixture: { count: condition.count },
      input: condition.input,
      grouped: condition.grouped,
      records: Object.fromEntries(
        ops.map((op) => [op, { samples: raw(), ...summarizeSamples(raw()) }]),
      ),
      start: raw(),
      end: raw(),
    };
  }
  return {
    ...base,
    condition,
    ...(["noop", "reject", "cancel"].includes(condition.scenario)
      ? {
          notApplicable: { save: "No write", nextPending: "No save" },
          persistence: { writeCount: 0, operationId: null, commits: [] },
        }
      : {}),
    metrics: Object.fromEntries(
      expectedTransferMetricNames(condition, kind).map((op) => [
        op,
        metric(kind, op, condition),
      ]),
    ),
  };
}
const names = {
  shopping: "shopping-operation-timings",
  range: "edit-execute-range-selection-timings",
  drag: "shopping-drag-response",
  transfer: "shopping-transfer-rendering",
};
async function fixture(t, group = "shopping") {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), "esp evidence "));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const root = path.join(runRoot, group);
  await mkdir(root);
  const report = {
    errors: [],
    config: { workers: 1, projects: [{ retries: 0 }] },
    suites: [
      {
        specs: expectedPerformanceCases(group).map(
          ({ condition, measurementKind: kind, spec: expectedSpec }) => ({
            file: expectedSpec,
            ok: true,
            tests: [
              {
                expectedStatus: "passed",
                status: "expected",
                results: [
                  {
                    retry: 0,
                    status: "passed",
                    attachments: [
                      {
                        name: names[group],
                        contentType: "application/json",
                        body: Buffer.from(
                          JSON.stringify(artifact(group, condition, kind)),
                        ).toString("base64"),
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        ),
      },
    ],
  };
  if (group === "transfer") {
    for (const [index, spec] of report.suites[0].specs.entries()) {
      const attachment = spec.tests[0].results[0].attachments[0];
      const data = JSON.parse(
        Buffer.from(attachment.body, "base64").toString("utf8"),
      );
      if (data.measurementKind !== "frame") continue;
      const directory = path.join(root, "test-results", `frame-${index}`);
      await mkdir(directory, { recursive: true });
      const image = Buffer.from("fixture-screenshot-bytes");
      const trace = [];
      for (const [i, sample] of data.metrics.frame.samples.entries()) {
        const began = 100000 + i * 100000;
        const points = {
          input: { pid: 1, ts: began },
          dom: { pid: 1, ts: began + 1000 },
          paint: { pid: 1, ts: began + 2000 },
          drawFrame: { pid: 1, ts: began + 3000 },
        };
        trace.push(
          { name: `${sample.measurementId}:input`, ...points.input },
          { name: `${sample.measurementId}:dom`, ...points.dom },
          {
            name: "Paint",
            ...points.paint,
            args: { data: { clip: [0, 0, 1440, 0, 1440, 1000, 0, 1000] } },
          },
          { name: "DrawFrame", ...points.drawFrame },
        );
        const sourceRect = { x: 20, y: 100, width: 400, height: 100 };
        const targetRect = { x: 700, y: 100, width: 400, height: 100 };
        const sourceRole =
          sample.visualTarget === "source-origin"
            ? "source-origin"
            : "source-gap";
        const score = (rect, role, itemId) => ({
          itemId,
          role,
          rect,
          frameError: 0,
          baselineError: 1,
          controlErrors: [0, 0],
          identityRect: {
            x: rect.x + 70,
            y: rect.y + 5,
            width: 300,
            height: 90,
          },
          controlRects: [
            { x: rect.x + 7, y: rect.y + 7, width: 38, height: 30 },
            { x: rect.x + 200, y: rect.y + 5, width: 190, height: 75 },
          ],
        });
        sample.markerDelayMs = 0;
        sample.paintCorrelated = true;
        sample.drawFrameCorrelated = true;
        sample.captureMethod = "Page.startScreencast(png)";
        sample.captureTimestampKind = "frame-swap-upper-bound";
        sample.expectedTransferredIds ??= [sample.targetId];
        const visibleIds =
          data.condition.scenario === "range"
            ? [...sample.expectedTransferredIds]
            : [sample.targetId];
        sample.visibleSourceIds = [...visibleIds];
        sample.visibleTransferredIds = [...visibleIds];
        const sourceRects = visibleIds.map((_, index) => ({
          ...sourceRect,
          y: sourceRect.y + index * 200,
        }));
        const targetRects = visibleIds.map((_, index) => ({
          ...targetRect,
          y: targetRect.y + index * 200,
        }));
        sample.allVisibleDestinationCardsVerified = true;
        const timestamp = (sample.startEpoch + sample.durationMs) / 1000;
        sample.correlation = {
          ...points,
          sourcePaint: points.paint,
          sourceRect,
          targetRect,
          sourceProofs: visibleIds.map((sourceId, index) => ({
            sourceId,
            rect: sourceRects[index],
            paint: { ...points.paint, itemId: sourceId },
            scoreIndex: index,
          })),
          targetProofs: visibleIds.map((targetId, index) => ({
            targetId,
            rect: targetRects[index],
            paint: { ...points.paint, itemId: targetId },
            scoreIndex: visibleIds.length + index,
          })),
          frame: {
            epochMs: timestamp * 1000,
            traceTs: began + (timestamp * 1000 - sample.startEpoch) * 1000,
            sessionId: i + 1,
          },
          comparison: {
            matched: true,
            scores: [
              ...visibleIds.map((id, index) =>
                score(sourceRects[index], sourceRole, id),
              ),
              ...visibleIds.map((id, index) =>
                score(targetRects[index], "destination-card", id),
              ),
            ],
          },
        };
        const bytes = Buffer.from(
          JSON.stringify({
            method: "Page.startScreencast",
            format: "png",
            maxWidth: 1440,
            maxHeight: 1000,
            everyNthFrame: 1,
            acknowledged: true,
            sessionId: i + 1,
            metadata: { timestamp },
            frameSha256: createHash("sha256").update(image).digest("hex"),
          }),
        );
        const filename = path.join(directory, `metadata-${i}.json`);
        await writeFile(filename, bytes);
        sample.frameMetadataPath = filename;
        sample.frameMetadataSha256 = createHash("sha256")
          .update(bytes)
          .digest("hex");
      }
      const files = {
        trace: Buffer.from(JSON.stringify({ traceEvents: trace })),
        frame: image,
        reference: image,
        baseline: image,
      };
      for (const [name, bytes] of Object.entries(files)) {
        const filename = path.join(directory, `${name}.fixture`);
        await writeFile(filename, bytes);
        for (const sample of data.metrics.frame.samples) {
          sample[`${name}Path`] = filename;
          sample[`${name}Sha256`] = createHash("sha256")
            .update(bytes)
            .digest("hex");
        }
      }
      attachment.body = Buffer.from(JSON.stringify(data)).toString("base64");
    }
  }
  const save = () =>
    writeFile(path.join(root, "report.json"), JSON.stringify(report), "utf8");
  await save();
  return {
    runRoot,
    report,
    save,
    verify: () =>
      verifyGroupEvidence({ runRoot, group, ...identity, write: false }),
  };
}
test("preflight rejects every nonempty diagnostic setting without changing the parent environment", () => {
  const values = {
    ESP_PROFILE_RANGE: "1",
    ESP_PROFILE_SHOPPING: "0",
    ESP_DIAGNOSTIC_CSS: "0",
    ESP_RANGE_WARMUP_MOUSE: "0",
    ESP_DRAG_BASELINE: "0",
    ESP_EXPECT_CSS_CHAIN: "1",
    ESP_PROFILE_EMPTY: "",
    PERFORMANCE_HEADED: "1",
  };
  const before = { ...values };
  const rejected = rejectedDiagnosticEnvironment(values);
  assert.deepEqual(
    rejected.map((r) => r.name),
    Object.keys(values).slice(0, 5),
  );
  assert.deepEqual(values, before);
});
for (const transform of [
  (name) => name.toLowerCase(),
  (name) =>
    name.replace(/./g, (letter, index) =>
      index % 2 ? letter.toLowerCase() : letter,
    ),
]) {
  test(`preflight rejects diagnostic environment names regardless of case: ${transform("ESP_PROFILE_RANGE")}`, () => {
    const names = [
      "ESP_PROFILE_RANGE",
      "ESP_DIAGNOSTIC_CSS",
      "ESP_RANGE_CONTINUOUS_DIAGNOSTIC",
      "ESP_RANGE_INVALIDATION_DIAGNOSTIC",
      "ESP_RANGE_RENDER_DIAGNOSTICS",
      "ESP_RANGE_WARMUP_VISUAL",
      "ESP_RANGE_WARMUP_MOUSE",
      "ESP_DRAG_TRACE_STAGES",
      "ESP_DRAG_CPU_PROFILE",
      "ESP_DRAG_DROP_PROBE_COMPARE",
      "ESP_DRAG_BASELINE",
    ].map(transform);
    const values = Object.fromEntries(
      names.map((name, index) => [name, index % 2 ? "0" : "1"]),
    );
    values[transform("ESP_PROFILE_EMPTY")] = "";
    values[transform("ESP_EXPECT_CSS_CHAIN")] = "1";
    const before = { ...values };
    assert.deepEqual(
      rejectedDiagnosticEnvironment(values).map((entry) => entry.name),
      names,
    );
    assert.deepEqual(values, before);
  });
}

test("known normal matrices pass with exact expected coverage and response/frame separation", async (t) => {
  assert.deepEqual(
    ["shopping", "range", "drag", "transfer"].map(
      (g) => expectedConditions(g).length,
    ),
    [16, 20, 8, 52],
  );
  for (const group of ["shopping", "range", "drag", "transfer"]) {
    const f = await fixture(t, group);
    const result = await f.verify();
    assert.equal(
      result.status,
      "passed",
      `${group}: ${JSON.stringify(result.errors)}`,
    );
  }
});
for (const [name, mutate] of [
  ["missing condition", (r) => r.suites[0].specs.pop()],
  [
    "duplicate condition",
    (r) => {
      r.suites[0].specs[1] = structuredClone(r.suites[0].specs[0]);
    },
  ],
  [
    "skip",
    (r) => {
      r.suites[0].specs[0].tests[0].results[0].status = "skipped";
    },
  ],
  [
    "retry",
    (r) => {
      r.suites[0].specs[0].tests[0].results[0].retry = 1;
    },
  ],
  [
    "CI retry config",
    (r) => {
      r.config.projects[0].retries = 2;
    },
  ],
  [
    "diagnostic-only attachment",
    (r) => {
      r.suites[0].specs[0].tests[0].results[0].attachments[0].name =
        "shopping-operation-diagnostic";
    },
  ],
  [
    "missing attachment",
    (r) => {
      r.suites[0].specs[0].tests[0].results[0].attachments = [];
    },
  ],
  [
    "multiple workers",
    (r) => {
      r.config.workers = 2;
    },
  ],
])
  test(`report rejects ${name} even with a successful child exit`, async (t) => {
    const f = await fixture(t);
    mutate(f.report);
    await f.save();
    assert.equal((await f.verify()).status, "failed");
  });
for (const [name, mutate] of [
  [
    "9 samples",
    (a) => {
      a.timings.execute.pop();
    },
  ],
  [
    "raw-summary mismatch",
    (a) => {
      a.summary.execute.medianMs = 1;
    },
  ],
  [
    "missing UI metric",
    (a) => {
      delete a.uiTimings;
    },
  ],
  [
    "unmatched expected UI",
    (a) => {
      a.uiSamples.execute[0].matched = false;
    },
  ],
  [
    "detail mismatch",
    (a) => {
      a.uiSamples.execute[0].uiMs = 0;
    },
  ],
  [
    "diagnostic identity",
    (a) => {
      a.diagnosticOnly = true;
    },
  ],
  [
    "not acceptance",
    (a) => {
      a.acceptanceMeasurement = false;
    },
  ],
  [
    "foreign run",
    (a) => {
      a.runId = "another-run";
    },
  ],
  [
    "foreign phase",
    (a) => {
      a.phase = "before";
    },
  ],
  [
    "unknown instrument",
    (a) => {
      a.instrumentVersion = "old";
    },
  ],
  [
    "negative raw value",
    (a) => {
      a.timings.execute[0] = -1;
    },
  ],
  [
    "null raw value",
    (a) => {
      a.timings.execute[0] = null;
    },
  ],
  [
    "infinite raw value",
    (a) => {
      a.timings.execute[0] = Infinity;
    },
  ],
  [
    "duplicate sample",
    (a) => {
      a.uiSamples.execute[1].sampleId = a.uiSamples.execute[0].sampleId;
    },
  ],
])
  test(`artifact rejects ${name}`, () => {
    const a = artifact("shopping");
    mutate(a);
    assert.throws(() => validateEvidenceArtifact(a, "shopping", identity));
  });
for (const kind of ["legacy", "ui"])
  for (const [name, values, error] of [
    ["inclusive median", Array(10).fill(65), null],
    ["excess median", Array(10).fill(65.01), /median exceeds 65ms/],
    ["inclusive p95", [...Array(8).fill(65), 100, 100], null],
    ["excess p95", [...Array(8).fill(65), 100.01, 100.01], /p95 exceeds 100ms/],
  ])
    test(`current ${kind} budget validates ${name} independently`, () => {
      const a = artifact("shopping");
      const timings = kind === "legacy" ? a.timings : a.uiTimings;
      const summary = kind === "legacy" ? a.summary : a.uiSummary;
      timings.execute = values;
      summary.execute = summarizeSamples(values);
      for (let index = 0; index < values.length; index++)
        a.uiSamples.execute[index][kind === "legacy" ? "legacyMs" : "uiMs"] =
          values[index];
      if (error)
        assert.throws(
          () => validateEvidenceArtifact(a, "shopping", identity),
          error,
        );
      else
        assert.doesNotThrow(() =>
          validateEvidenceArtifact(a, "shopping", identity),
        );
    });

test("new evidence labels its current criteria without changing earlier artifact fields", () => {
  const a = artifact("shopping");
  assert.equal(a.acceptanceCriteriaDate, "2026-10-25");
  assert.deepEqual(a.acceptanceThresholds, shoppingPerformanceThresholds);
  a.method = { thresholds: { minimumCount: 20, medianMs: 55, p95Ms: 100 } };
  const original = structuredClone(a);
  assert.doesNotThrow(() => validateEvidenceArtifact(a, "shopping", identity));
  assert.deepEqual(a, original);
});
test("frame evidence cannot replace a response condition or rely on unverified pixels", () => {
  const frame = artifact(
    "transfer",
    expectedConditions("transfer")[0],
    "frame",
  );
  assert.doesNotThrow(() =>
    validateEvidenceArtifact(frame, "transfer", identity),
  );
  frame.metrics.frame.samples[0].frameVerified = false;
  assert.throws(() => validateEvidenceArtifact(frame, "transfer", identity));
  const response = artifact("transfer");
  response.measurementKind = "frame";
  assert.throws(() => validateEvidenceArtifact(response, "transfer", identity));
});
test("verification is retained separately, hashes its source and refuses overwrite", async (t) => {
  const f = await fixture(t);
  const options = { runRoot: f.runRoot, group: "shopping", ...identity };
  const result = await verifyGroupEvidence(options);
  assert.equal(result.status, "passed");
  assert.match(result.hashes["report.json"], /^[a-f0-9]{64}$/);
  assert.deepEqual(
    JSON.parse(
      await readFile(
        path.join(f.runRoot, "shopping/evidence-verification.json"),
        "utf8",
      ),
    ),
    result,
  );
  await assert.rejects(verifyGroupEvidence(options), /EEXIST/);
});
test("summaries use even median and nearest-rank p95", () => {
  assert.deepEqual(summarizeSamples(Array.from({ length: 10 }, (_, i) => i)), {
    count: 10,
    medianMs: 4.5,
    p95Ms: 9,
  });
});
for (const [label, mutate] of [
  [
    "frame hash mismatch",
    (sample) => {
      sample.frameSha256 = "0".repeat(64);
    },
  ],
  [
    "foreign frame path",
    (sample) => {
      sample.framePath = sample.framePath.replace("test-results", "outside");
    },
  ],
  [
    "unrelated Paint",
    (sample) => {
      sample.correlation.paint.pid = 99;
    },
  ],
  [
    "unrelated DrawFrame",
    (sample) => {
      sample.correlation.drawFrame.ts += 1;
    },
  ],
  [
    "wrong selected frame",
    (sample) => {
      sample.correlation.frame.traceTs += 1;
    },
  ],
  [
    "unverified image content",
    (sample) => {
      sample.correlation.comparison.matched = false;
    },
  ],
  [
    "unrelated image content",
    (sample) => {
      sample.correlation.comparison.scores[0].frameError = 1;
    },
  ],
])
  test(`frame collection rejects ${label}`, async (t) => {
    const f = await fixture(t, "transfer");
    const attachment =
      f.report.suites[0].specs[1].tests[0].results[0].attachments[0];
    const data = JSON.parse(
      Buffer.from(attachment.body, "base64").toString("utf8"),
    );
    mutate(data.metrics.frame.samples[0]);
    attachment.body = Buffer.from(JSON.stringify(data)).toString("base64");
    await f.save();
    assert.equal((await f.verify()).status, "failed");
  });

async function screencastProofFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "esp screencast proof "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputRoot = path.join(root, "test-results");
  const directory = path.join(outputRoot, "frame with spaces");
  await mkdir(directory, { recursive: true });
  const image = Buffer.from("fixture-screencast-png-bytes");
  const sample = {
    measurementId: "screencast-1",
    targetId: "target-1",
    captureMethod: "Page.startScreencast(png)",
    captureTimestampKind: "frame-swap-upper-bound",
    startEpoch: 1700000000000,
    markerDelayMs: 1,
    durationMs: 20,
    frameTimestampMs: 20,
    paintCorrelated: true,
    drawFrameCorrelated: true,
    correlation: {
      input: { pid: 7, ts: 100000 },
      dom: { pid: 7, ts: 101000 },
      paint: { pid: 7, ts: 102000 },
      sourcePaint: { pid: 7, ts: 102500 },
      drawFrame: { pid: 7, ts: 103000 },
      frame: { epochMs: 1700000000020, traceTs: 119000, sessionId: 42 },
      targetRect: { x: 100, y: 100, width: 40, height: 60 },
      sourceRect: { x: 20, y: 100, width: 40, height: 60 },
      comparison: {
        matched: true,
        scores: [
          { frameError: 0.01, baselineError: 0.1, controlErrors: [0.01, 0.01] },
          { frameError: 0.01, baselineError: 0.1, controlErrors: [0.01, 0.01] },
        ],
      },
    },
  };
  sample.expectedTransferredIds = [sample.targetId];
  sample.visibleTransferredIds = [sample.targetId];
  sample.visibleSourceIds = [sample.targetId];
  sample.allVisibleDestinationCardsVerified = true;
  sample.correlation.targetProofs = [
    {
      targetId: sample.targetId,
      rect: sample.correlation.targetRect,
      paint: { ...sample.correlation.paint, itemId: sample.targetId },
      scoreIndex: 1,
    },
  ];
  sample.correlation.sourceProofs = [
    {
      sourceId: sample.targetId,
      rect: sample.correlation.sourceRect,
      paint: { ...sample.correlation.sourcePaint, itemId: sample.targetId },
      scoreIndex: 0,
    },
  ];
  Object.assign(sample.correlation.comparison.scores[0], {
    itemId: sample.targetId,
    role: "source-gap",
    rect: sample.correlation.sourceRect,
    identityRect: { x: 25, y: 105, width: 20, height: 20 },
    controlRects: [
      { x: 22, y: 102, width: 5, height: 5 },
      { x: 50, y: 102, width: 5, height: 5 },
    ],
  });
  Object.assign(sample.correlation.comparison.scores[1], {
    itemId: sample.targetId,
    role: "destination-card",
    rect: sample.correlation.targetRect,
    identityRect: { x: 105, y: 105, width: 20, height: 20 },
    controlRects: [
      { x: 102, y: 102, width: 5, height: 5 },
      { x: 130, y: 102, width: 5, height: 5 },
    ],
  });
  const metadata = {
    method: "Page.startScreencast",
    format: "png",
    maxWidth: 1440,
    maxHeight: 1000,
    everyNthFrame: 1,
    acknowledged: true,
    sessionId: 42,
    metadata: { timestamp: 1700000000.02 },
    frameSha256: createHash("sha256").update(image).digest("hex"),
  };
  const events = [
    { name: "screencast-1:input", ...sample.correlation.input },
    { name: "screencast-1:dom", ...sample.correlation.dom },
    {
      name: "Paint",
      ...sample.correlation.paint,
      args: { data: { clip: [100, 100, 140, 100, 140, 160, 100, 160] } },
    },
    {
      name: "Paint",
      ...sample.correlation.sourcePaint,
      args: { data: { clip: [20, 100, 60, 100, 60, 160, 20, 160] } },
    },
    { name: "DrawFrame", ...sample.correlation.drawFrame },
  ];
  const hashes = {};
  const data = { metrics: { frame: { samples: [sample] } } };
  const save = async () => {
    const files = {
      trace: Buffer.from(JSON.stringify({ traceEvents: events })),
      frame: image,
      reference: image,
      baseline: image,
      frameMetadata: Buffer.from(JSON.stringify(metadata)),
    };
    for (const [name, bytes] of Object.entries(files)) {
      const filename = path.join(directory, `${name}.fixture`);
      await writeFile(filename, bytes);
      sample[`${name}Path`] = filename;
      sample[`${name}Sha256`] = createHash("sha256")
        .update(bytes)
        .digest("hex");
    }
  };
  await save();
  return {
    data,
    sample,
    metadata,
    events,
    hashes,
    outputRoot,
    save,
    verify: () => verifyFrameFiles(data, outputRoot, hashes),
  };
}
test("screencast proof accepts matched swap timestamps, source Paint and recorded controls", async (t) => {
  const f = await screencastProofFixture(t);
  await assert.doesNotReject(f.verify());
  assert.equal(Object.keys(f.hashes).length, 5);
  assert.ok(
    Object.values(f.hashes).every((hash) => /^[a-f0-9]{64}$/.test(hash)),
  );
});
for (const [label, mutate, afterSave] of [
  [
    "incompatible metadata",
    (f) => {
      f.metadata.format = "jpeg";
    },
  ],
  [
    "unacknowledged frame",
    (f) => {
      f.metadata.acknowledged = false;
    },
  ],
  [
    "embedded frame hash mismatch",
    (f) => {
      f.metadata.frameSha256 = "0".repeat(64);
    },
  ],
  [
    "metadata file hash mismatch",
    () => {},
    (f) => {
      f.sample.frameMetadataSha256 = "0".repeat(64);
    },
  ],
  [
    "foreign session",
    (f) => {
      f.metadata.sessionId++;
    },
  ],
  [
    "wrong swap timestamp",
    (f) => {
      f.metadata.metadata.timestamp += 0.001;
    },
  ],
  [
    "wrong frame duration",
    (f) => {
      f.sample.durationMs++;
    },
  ],
  [
    "unrelated source Paint",
    (f) => {
      f.sample.correlation.sourcePaint.pid++;
    },
  ],
  [
    "source Paint after selected frame",
    (f) => {
      f.sample.correlation.sourcePaint.ts = 120000;
      f.events[3].ts = 120000;
    },
  ],
  [
    "source Paint misses source card",
    (f) => {
      f.events[3].args.data.clip = [0, 0, 10, 0, 10, 10, 0, 10];
    },
  ],
  [
    "target Paint misses destination card",
    (f) => {
      f.events[2].args.data.clip = [0, 0, 10, 0, 10, 10, 0, 10];
    },
  ],
  [
    "missing control comparisons",
    (f) => {
      f.sample.correlation.comparison.scores[0].controlErrors = [];
    },
  ],
  [
    "nonfinite control comparison",
    (f) => {
      f.sample.correlation.comparison.scores[0].controlErrors[0] = Infinity;
    },
  ],
  [
    "wrong controls",
    (f) => {
      f.sample.correlation.comparison.scores[0].controlErrors[0] = 0.026;
    },
  ],
])
  test(`screencast proof rejects ${label}`, async (t) => {
    const f = await screencastProofFixture(t);
    mutate(f);
    await f.save();
    afterSave?.(f);
    await assert.rejects(f.verify());
  });
for (const [name, mutate] of [
  [
    "pending input after commit",
    (a) => {
      a.metrics.nextPending.samples[0].eventEpoch =
        a.metrics.nextPending.samples[0].commits[0].at + 1;
    },
  ],
  [
    "pending input before input acceptance",
    (a) => {
      a.metrics.nextPending.samples[0].eventEpoch =
        a.metrics.nextPending.samples[0].startEpoch - 1;
    },
  ],
  [
    "applied input before commit",
    (a) => {
      a.metrics.nextApplied.samples[0].eventEpoch =
        a.metrics.nextApplied.samples[0].startEpoch + 1;
    },
  ],
  [
    "missing save transaction",
    (a) => {
      a.metrics.response.samples[0].commits = [];
    },
  ],
  [
    "multiple save transactions",
    (a) => {
      a.metrics.response.samples[0].commits.push({
        ...a.metrics.response.samples[0].commits[0],
      });
    },
  ],
  [
    "fabricated save duration",
    (a) => {
      const sample = a.metrics.save.samples[0];
      sample.commits[0].at += 1;
    },
  ],
  [
    "mixed move IDs",
    (a) => {
      a.metrics.nextApplied.samples[0].startEpoch += 1;
    },
  ],
  [
    "wrong next-input target",
    (a) => {
      a.metrics.nextApplied.samples[0].targetId = "other-item";
    },
  ],
])
  test(`response phase proof rejects ${name}`, () => {
    const a = artifact("transfer");
    mutate(a);
    assert.throws(() => validateEvidenceArtifact(a, "transfer", identity));
  });
for (const [name, mutate] of [
  [
    "fabricated operation ID",
    (a) => {
      a.persistence.operationId = "fake";
    },
  ],
  [
    "physical write",
    (a) => {
      a.metrics.response.samples[0].physicalWriteCount = 1;
    },
  ],
  [
    "lost selection",
    (a) => {
      a.metrics.response.samples[0].selectionAfterIds = [];
    },
  ],
  [
    "uncleared guide",
    (a) => {
      a.metrics.response.samples[0].guideCleared = false;
    },
  ],
  [
    "lost endpoints on cancel",
    (a) => {
      a.metrics.response.samples[0].endpointsRetained = false;
    },
  ],
])
  test(`no-save phase proof rejects ${name}`, () => {
    const condition = expectedConditions("transfer").find(
      (c) => c.scenario === "cancel",
    );
    const a = artifact("transfer", condition);
    mutate(a);
    assert.throws(() => validateEvidenceArtifact(a, "transfer", identity));
  });
for (const [scenario, target] of [
  ["noop", "endpoints"],
  ["same-column", "source-origin"],
])
  test(`${scenario} frame retains its source and cannot masquerade as a moved-out card`, () => {
    const condition = expectedConditions("transfer").find(
      (row) => row.scenario === scenario,
    );
    const a = artifact("transfer", condition, "frame");
    assert.doesNotThrow(() =>
      validateEvidenceArtifact(a, "transfer", identity),
    );
    assert.equal(a.metrics.frame.samples[0].visualTarget, target);
    a.metrics.frame.samples[0].visualTarget = "card";
    a.metrics.frame.samples[0].sourceAbsent = true;
    assert.throws(() => validateEvidenceArtifact(a, "transfer", identity));
  });
for (const field of [
  "browserVersion",
  "userAgent",
  "viewport",
  "devicePixelRatio",
  "browserChannel",
  "headed",
  "workers",
  "retries",
])
  test(`acceptance rejects missing actual environment ${field}`, () => {
    const a = artifact("shopping");
    a.environment = { ...a.environment };
    delete a.environment[field];
    assert.throws(
      () => validateEvidenceArtifact(a, "shopping", identity),
      /environment/,
    );
  });
test("screencast requires proof for each visible moved target and excludes genuinely hidden targets", async (t) => {
  const f = await screencastProofFixture(t);
  f.sample.expectedTransferredIds = [
    "target-1",
    "target-2",
    "offscreen-target",
  ];
  f.sample.visibleTransferredIds.push("target-2");
  await assert.rejects(f.verify(), /Every visible moved/);
  const rect = { x: 200, y: 100, width: 40, height: 60 };
  const paint = { pid: 7, ts: 102600 };
  f.events.push({
    name: "Paint",
    ...paint,
    args: { data: { clip: [200, 100, 240, 100, 240, 160, 200, 160] } },
  });
  f.sample.correlation.targetProofs.push({
    targetId: "target-2",
    rect,
    paint: { ...paint, itemId: "target-2" },
    scoreIndex: 2,
  });
  f.sample.correlation.comparison.scores.push({
    frameError: 0.01,
    baselineError: 0.1,
    controlErrors: [0.01, 0.01],
    itemId: "target-2",
    role: "destination-card",
    rect,
    identityRect: { x: 205, y: 105, width: 20, height: 20 },
    controlRects: [
      { x: 202, y: 102, width: 5, height: 5 },
      { x: 230, y: 102, width: 5, height: 5 },
    ],
  });
  await f.save();
  await assert.doesNotReject(f.verify());
  f.sample.correlation.targetProofs[1].targetId = "target-1";
  await assert.rejects(f.verify(), /Every visible moved/);
  f.sample.correlation.targetProofs[1].targetId = "target-2";
  f.sample.correlation.targetProofs[1].rect = { ...rect, x: 201 };
  await assert.rejects(f.verify(), /Every visible moved/);
});

test("transfer phase proof cannot be bypassed by omitting every raw phase field", () => {
  const a = artifact("transfer");
  for (const values of Object.values(a.metrics))
    for (const sample of values.samples) {
      delete sample.commits;
      delete sample.startEpoch;
      delete sample.eventEpoch;
    }
  assert.throws(
    () => validateEvidenceArtifact(a, "transfer", identity),
    /phase proof/,
  );
});

test("screencast requires every visible source origin and rejects borrowed image crops", async (t) => {
  const f = await screencastProofFixture(t);
  f.sample.visibleSourceIds.push("second-source");
  await assert.rejects(f.verify(), /Every visible moved/);
  f.sample.visibleSourceIds.pop();
  f.sample.correlation.comparison.scores[1].identityRect.x = 20;
  await assert.rejects(f.verify(), /Every visible moved/);
  f.sample.correlation.comparison.scores[1].identityRect.x = 105;
  f.sample.correlation.sourceProofs[0].paint = {
    ...f.sample.correlation.paint,
    itemId: f.sample.targetId,
  };
  await assert.rejects(f.verify(), /Every visible moved/);
});

test("same-column frames require every retained source origin and moved target image proof", async (t) => {
  const f = await screencastProofFixture(t);
  f.sample.visualTarget = "source-origin";
  f.sample.correlation.comparison.scores[0].role = "source-origin";
  await assert.doesNotReject(f.verify());
  f.sample.visibleTransferredIds.push("second-selected-item");
  await assert.rejects(f.verify(), /Every visible moved/);
});

for (const method of [
  undefined,
  "Screenshot",
  "Page.captureScreenshot(fromSurface:true)",
])
  test(`acceptance rejects unsupported frame capture method ${method}`, async (t) => {
    const f = await screencastProofFixture(t);
    f.sample.captureMethod = method;
    await assert.rejects(f.verify(), /captureMethod/);
  });

test("transfer operation IDs must match the observed transaction and cannot be fabricated when unavailable", () => {
  const a = artifact("transfer");
  for (const values of Object.values(a.metrics))
    for (const sample of values.samples) {
      sample.operationId = "invented";
    }
  assert.throws(
    () => validateEvidenceArtifact(a, "transfer", identity),
    /observed save transaction/,
  );
  for (const values of Object.values(a.metrics))
    for (const sample of values.samples) {
      sample.commits[0].operationId = "actual-worker-operation";
      sample.operationId = "actual-worker-operation";
    }
  assert.doesNotThrow(() => validateEvidenceArtifact(a, "transfer", identity));
  for (const values of Object.values(a.metrics))
    values.samples[0].operationId = "different-worker-operation";
  assert.throws(
    () => validateEvidenceArtifact(a, "transfer", identity),
    /observed save transaction/,
  );
});

for (const [name, mutate] of [
  [
    "missing frozen next-input ID",
    (a) => {
      delete a.metrics.response.samples[0].nextInputId;
    },
  ],
  [
    "changed next-input strategy",
    (a) => {
      a.metrics.nextApplied.samples[0].nextInputStrategy =
        "topmost-visible-unmoved-destination";
    },
  ],
  [
    "moved target reused for next input",
    (a) => {
      a.metrics.response.samples[0].expectedTransferredIds.push("anchor-1");
    },
  ],
  [
    "mixed next-input IDs",
    (a) => {
      a.metrics.save.samples[0].nextInputId = "other";
    },
  ],
  [
    "missing checkbox preparation",
    (a) => {
      delete a.metrics.nextPending.samples[0].inputPreparation;
    },
  ],
  [
    "wrong preparation target",
    (a) => {
      a.metrics.nextApplied.samples[0].inputPreparation.targetId = "other";
    },
  ],
  [
    "failed center hit test",
    (a) => {
      a.metrics.nextPending.samples[0].inputPreparation.hitTestMatched = false;
    },
  ],
  [
    "already checked pending target",
    (a) => {
      a.metrics.nextPending.samples[0].inputPreparation.checked = true;
    },
  ],
  [
    "unchecked applied target",
    (a) => {
      a.metrics.nextApplied.samples[0].inputPreparation.checked = false;
    },
  ],
  [
    "label instead of exact checkbox",
    (a) => {
      a.metrics.nextPending.samples[0].inputPreparation.actualHit.exactInput = false;
    },
  ],
  [
    "actual event wrong item",
    (a) => {
      a.metrics.nextApplied.samples[0].actualHit.itemId = "other";
    },
  ],
  [
    "actual event wrong column",
    (a) => {
      a.metrics.nextPending.samples[0].actualHit.column = "candidate";
    },
  ],
  [
    "actual event wrong control",
    (a) => {
      a.metrics.nextApplied.samples[0].actualHit.type = "button";
    },
  ],
  [
    "nonfinite checkbox geometry",
    (a) => {
      a.metrics.nextPending.samples[0].inputPreparation.rect.width = Infinity;
    },
  ],
  [
    "offscreen prepared point",
    (a) => {
      a.metrics.nextPending.samples[0].inputPreparation.point.y = -1;
    },
  ],
  [
    "noncenter prepared point",
    (a) => {
      a.metrics.nextPending.samples[0].inputPreparation.point.x += 2;
    },
  ],
  [
    "foreign viewport",
    (a) => {
      a.metrics.nextApplied.samples[0].inputPreparation.viewport.height = 999;
    },
  ],
  [
    "actual click missed prepared point",
    (a) => {
      a.metrics.nextPending.samples[0].inputPoint.x += 2;
    },
  ],
  [
    "missing actual click hit",
    (a) => {
      delete a.metrics.nextApplied.samples[0].actualHit;
    },
  ],
  [
    "negative event queue delay",
    (a) => {
      a.metrics.nextPending.samples[0].queueDelayMs = -1;
    },
  ],
  [
    "event queue delay exceeds response",
    (a) => {
      a.metrics.nextPending.samples[0].queueDelayMs = 100;
    },
  ],
])
  test(`prepared next-input proof rejects ${name}`, () => {
    const a = artifact("transfer");
    mutate(a);
    assert.throws(() => validateEvidenceArtifact(a, "transfer", identity));
  });
test("prepared next-input proof accepts CDP event integer rounding and scenario-specific strategy", () => {
  const condition = expectedConditions("transfer").find(
    (c) => c.scenario === "multiple",
  );
  const a = artifact("transfer", condition);
  for (const name of ["nextPending", "nextApplied"])
    for (const sample of a.metrics[name].samples) {
      sample.inputPoint.x += 1;
      sample.inputPoint.y -= 1;
    }
  validateEvidenceArtifact(a, "transfer", identity);
});

test("source proof preserves the first eligible existing origin and the real owner", () => {
  const sample = {
    expectedTransferredIds: ["item-1"],
    gestureObservation: sourceFixtureProof(["item-1"]),
  };
  validateTransferSourceProof(sample, browserEnvironment);
  const original = structuredClone(sample);
  validateTransferSourceProof(sample, browserEnvironment);
  assert.deepEqual(sample, original);
});
test("source proof retains a rejected interactive origin before its actual fallback", () => {
  const observation = sourceFixtureProof(["item-1"]);
  const first = {
    ...observation.sourceHitTest.selectedHit,
    interactive: true,
    matched: false,
  };
  const selected = {
    ...observation.sourceHitTest.selectedHit,
    origin: "card-body",
    point: { x: 180, y: 135 },
  };
  observation.sourceHitTest = {
    ...observation.sourceHitTest,
    attempts: [first, selected],
    initialRejection: first,
    selectedHit: selected,
  };
  observation.sourceOrigin = selected.origin;
  observation.sourcePoint = selected.point;
  validateTransferSourceProof(
    { expectedTransferredIds: ["item-1"], gestureObservation: observation },
    browserEnvironment,
  );
});
for (const [name, mutate] of [
  ["missing source proof", (s) => delete s.gestureObservation.sourceHitTest],
  [
    "foreign real owner",
    (s) =>
      (s.gestureObservation.sourceHitTest.selectedHit.hitItemId = "foreign"),
  ],
  [
    "owner flag false",
    (s) =>
      (s.gestureObservation.sourceHitTest.selectedHit.sourceOwnerMatched = false),
  ],
  [
    "interactive hit",
    (s) => (s.gestureObservation.sourceHitTest.selectedHit.interactive = true),
  ],
  [
    "out of source point",
    (s) => (s.gestureObservation.sourceHitTest.selectedHit.point.x = 20),
  ],
  [
    "unmatched trusted point",
    (s) => (s.gestureObservation.sourcePoint = { x: 180, y: 150 }),
  ],
  [
    "wrong initial rejection",
    (s) =>
      (s.gestureObservation.sourceHitTest.initialRejection =
        s.gestureObservation.sourceHitTest.selectedHit),
  ],
  [
    "unmoved source identity",
    (s) => (s.expectedTransferredIds = ["different"]),
  ],
])
  test(`source proof rejects ${name}`, () => {
    const sample = {
      expectedTransferredIds: ["item-1"],
      gestureObservation: sourceFixtureProof(["item-1"]),
    };
    mutate(sample);
    assert.throws(() =>
      validateTransferSourceProof(sample, browserEnvironment),
    );
  });
test("all accepted category proof fixtures retain direction-specific raw and display contracts", () => {
  for (const condition of expectedConditions("transfer").filter(
    (c) => c.scenario && !terminalScenarios.has(c.scenario),
  )) {
    const moved = movedIds(condition);
    validateAcceptedScenarioProof(
      {
        expectedTransferredIds: moved,
        ...acceptedFixtureProof(condition, moved),
      },
      condition,
    );
  }
});
const acceptedCondition = (
  scenario = "same-visit-merge",
  direction = "execute-to-candidate",
) => ({
  count: 500,
  input: "native",
  grouped: true,
  load: "light",
  scenario,
  direction,
});
for (const [name, scenario, direction, mutate] of [
  [
    "missing checkbox evidence",
    "same-visit-merge",
    "execute-to-candidate",
    (s) => (s.durableProof.selectionPreparation.checkboxChecks = []),
  ],
  [
    "extra requested selection",
    "multiple",
    "execute-to-candidate",
    (s) => s.durableProof.selectionPreparation.requestedIds.push("extra"),
  ],
  [
    "wrong parent count",
    "multiple",
    "execute-to-candidate",
    (s) => (s.durableProof.selectionPreparation.headerText = "Move(3件)"),
  ],
  [
    "raw UI ordering conflated",
    "same-visit-merge",
    "execute-to-candidate",
    (s) => s.durableProof.candidateOrderProof.actualRawCandidateIds.reverse(),
  ],
  [
    "missing displayed identity",
    "same-visit-merge",
    "execute-to-candidate",
    (s) => s.durableProof.candidateOrderProof.expectedDisplayIds.pop(),
  ],
  [
    "unexpected displayed member",
    "same-visit-merge",
    "execute-to-candidate",
    (s) =>
      s.durableProof.candidateOrderProof.actualMountedDisplayIds.push(
        "foreign",
      ),
  ],
  [
    "missing raw global order",
    "same-visit-merge",
    "execute-to-candidate",
    (s) => (s.durableProof.candidateOrderProof.actualItemOrder = []),
  ],
  [
    "wrong raw boundary",
    "same-visit-merge",
    "execute-to-candidate",
    (s) => (s.durableProof.candidateOrderProof.boundaryId = "anchor-1"),
  ],
  [
    "reverse tail substitution",
    "same-visit-merge",
    "execute-to-candidate",
    (s) => (s.durableProof.mergeTailProof = [{}]),
  ],
  [
    "missing forward tail",
    "same-visit-merge",
    "candidate-to-execute",
    (s) => (s.durableProof.mergeTailProof = []),
  ],
  [
    "forward prepend substitution",
    "same-visit-merge",
    "candidate-to-execute",
    (s) => s.durableProof.mergeTailProof[0].expectedIds.reverse(),
  ],
  [
    "offscreen scroll not restored",
    "offscreen",
    "candidate-to-execute",
    (s) => (s.durableProof.selectionPreparation.scrollRestoration.after = 100),
  ],
  [
    "offscreen checkbox not reached",
    "offscreen",
    "candidate-to-execute",
    (s) => (s.durableProof.selectionPreparation.checkboxChecks[1].scrollY = 0),
  ],
  [
    "missing unmounted target proof",
    "offscreen",
    "execute-to-candidate",
    (s) => delete s.scenarioEvidence.targetMounted,
  ],
  [
    "false offscreen target",
    "offscreen",
    "execute-to-candidate",
    (s) => {
      s.scenarioEvidence.targetMounted = true;
      s.scenarioEvidence.targetBounds = { x: 0, y: 50, width: 100, height: 80 };
    },
  ],
  [
    "wrong durable offscreen identity",
    "offscreen",
    "execute-to-candidate",
    (s) => (s.durableProof.offscreenIdentityProof.target = "foreign"),
  ],
])
  test(`accepted proof rejects ${name}`, () => {
    const condition = acceptedCondition(scenario, direction),
      moved = movedIds(condition);
    const sample = structuredClone({
      expectedTransferredIds: moved,
      ...acceptedFixtureProof(condition, moved),
    });
    mutate(sample);
    assert.throws(() => validateAcceptedScenarioProof(sample, condition));
  });

for (const operation of ["response", "nextPending", "nextApplied", "save"])
  test(`saving metric membership rejects an unrelated ${operation} measurement set`, () => {
    const a = artifact("transfer");
    for (const sample of a.metrics[operation].samples)
      sample.measurementId = `${operation}-other-${sample.measurementId}`;
    assert.throws(
      () => validateEvidenceArtifact(a, "transfer", identity),
      /Move metric membership/,
    );
  });

for (const scenario of ["noop", "reject", "cancel"])
  test(`${scenario} metric membership rejects unrelated next-input measurements`, () => {
    const condition = expectedConditions("transfer").find(
      (c) => c.scenario === scenario,
    );
    const a = artifact("transfer", condition);
    for (const sample of a.metrics.nextApplied.samples)
      sample.measurementId = `other-${sample.measurementId}`;
    assert.throws(
      () => validateEvidenceArtifact(a, "transfer", identity),
      /Move metric membership/,
    );
  });

test("move membership accepts the same complete IDs when metric detail order differs", () => {
  const a = artifact("transfer");
  a.metrics.nextPending.samples.reverse();
  a.metrics.nextPending.raw.reverse();
  assert.doesNotThrow(() => validateEvidenceArtifact(a, "transfer", identity));
});

for (const field of ["visibleSourceIds", "visibleTransferredIds"])
  test(`range frame rejects an omitted identity from ${field}`, () => {
    const condition = expectedConditions("transfer").find(
      (c) => c.scenario === "range",
    );
    const a = artifact("transfer", condition, "frame");
    a.metrics.frame.samples[0][field] = a.metrics.frame.samples[0][field].slice(
      0,
      2,
    );
    assert.throws(
      () => validateEvidenceArtifact(a, "transfer", identity),
      /Range frame requires all three/,
    );
  });

test("range frame cannot redefine its known three-item scenario as two items", async (t) => {
  const f = await fixture(t, "transfer");
  const a = f.report.suites[0].specs
    .map((spec) =>
      JSON.parse(
        Buffer.from(
          spec.tests[0].results[0].attachments[0].body,
          "base64",
        ).toString("utf8"),
      ),
    )
    .find(
      (data) =>
        data.condition.scenario === "range" && data.measurementKind === "frame",
    );
  const sample = a.metrics.frame.samples[0];
  const moved = sample.expectedTransferredIds.slice(0, 2);
  sample.expectedTransferredIds = moved;
  sample.visibleSourceIds = [...moved];
  sample.visibleTransferredIds = [...moved];
  sample.correlation.sourceProofs = sample.correlation.sourceProofs.slice(0, 2);
  sample.correlation.targetProofs = sample.correlation.targetProofs
    .slice(0, 2)
    .map((proof, index) => ({ ...proof, scoreIndex: 2 + index }));
  const scores = sample.correlation.comparison.scores;
  sample.correlation.comparison.scores = [
    ...scores.slice(0, 2),
    ...scores.slice(3, 5),
  ];
  const selection = sample.durableProof.selectionPreparation;
  selection.requestedIds = [...moved];
  selection.requestedDisplayOrder = [...moved];
  selection.checkboxChecks = selection.checkboxChecks.slice(0, 2);
  selection.mountedCheckedIds = [...moved];
  selection.requestedCount = 2;
  selection.effectiveCount = 2;
  selection.headerText = "Move(2件)";
  sample.scenarioEvidence.selectionPreparation = selection;
  assert.throws(
    () => validateEvidenceArtifact(a, "transfer", identity),
    /Accepted scenario|Range frame requires all three/,
  );
});

for (const missing of [true, false])
  test(`normal artifacts reject ${missing ? "missing" : "unknown-type"} page errors`, () => {
    const a = artifact("shopping");
    if (missing) delete a.errors;
    else a.errors = "not-an-array";
    assert.throws(
      () => validateEvidenceArtifact(a, "shopping", identity),
      /Artifact errors must be an empty array/,
    );
  });

for (const group of ["range", "drag", "transfer"])
  for (const [name, values, error] of [
    ["inclusive median and p95", Array(10).fill(150), null],
    ["excess median", Array(10).fill(150.001), /median exceeds 150ms/],
    [
      "excess p95",
      [...Array(8).fill(100), 150.001, 150.001],
      /p95 exceeds 150ms/,
    ],
  ])
    test(`${group} scoped budget validates ${name}`, () => {
      const condition =
        group === "transfer"
          ? expectedConditions(group).find((row) => row.scenario === "cancel")
          : undefined;
      const a = artifact(group, condition);
      if (group === "range") {
        a.timings.firstEndpoint = values;
        a.summary.firstEndpoint = summarizeSamples(values);
        a.samples.forEach((sample, index) => {
          sample.durations.firstEndpoint = values[index];
        });
      } else if (group === "drag") {
        a.records.drop = { samples: values, ...summarizeSamples(values) };
      } else {
        a.metrics.response.raw = values;
        a.metrics.response.summary = summarizeSamples(values);
        a.metrics.response.samples.forEach((sample, index) => {
          sample.durationMs = values[index];
        });
      }
      if (error)
        assert.throws(
          () => validateEvidenceArtifact(a, group, identity),
          error,
        );
      else
        assert.doesNotThrow(() => validateEvidenceArtifact(a, group, identity));
    });
test("current evidence rejects forged scope even when budgets are disabled; historical evidence remains unmodified", () => {
  const a = artifact("range");
  a.acceptanceThresholds = { minimumCount: 20, medianMs: 999, p95Ms: 999 };
  assert.throws(
    () =>
      validateEvidenceArtifact(a, "range", identity, { enforceBudgets: false }),
    /acceptanceThresholds metadata/,
  );
  delete a.acceptanceScope;
  delete a.acceptanceCriteriaId;
  a.acceptanceThresholds = { minimumCount: 20, medianMs: 65, p95Ms: 100 };
  const original = JSON.stringify(a);
  assert.throws(
    () => validateEvidenceArtifact(a, "range", identity),
    /acceptanceScope metadata/,
  );
  assert.doesNotThrow(() =>
    validateEvidenceArtifact(a, "range", identity, {
      requireCurrentCriteria: false,
    }),
  );
  assert.equal(JSON.stringify(a), original);
  assert.throws(
    () => validateEvidenceArtifact(a, "future", identity),
    /Unknown performance criteria group/,
  );
  a.timings.firstEndpoint.pop();
  assert.throws(
    () =>
      validateEvidenceArtifact(a, "range", identity, {
        requireCurrentCriteria: false,
      }),
    /expected exactly 10/,
  );
});

test("completed baseline timings retain independent functional failures without passing acceptance", async () => {
  const data = artifact(
    "transfer",
    acceptedCondition("multiple", "candidate-to-execute"),
  );
  data.phase = "before";
  const record = {
    measurementId: data.metrics.response.samples[0].measurementId,
    sampleIndex: 1,
    code: "selection-not-consumed",
    message: "Transferred selection remains checked on the baseline",
    itemIds: [data.metrics.response.samples[0].expectedTransferredIds[0]],
  };
  data.postconditionErrors = [record];
  for (const metric of Object.values(data.metrics))
    metric.samples.forEach((sample, index) => {
      sample.postconditionErrors = index === 0 ? [record] : [];
    });
  const comparisonOptions = {
    enforceBudgets: false,
    allowBaselinePostconditionFailures: true,
  };
  assert.throws(
    () => validateEvidenceArtifact(data, "transfer"),
    /Functional postconditions failed/,
  );
  assert.doesNotThrow(() =>
    validateEvidenceArtifact(data, "transfer", {}, comparisonOptions),
  );
  const { comparableMetrics } =
    await import("./compare-shopping-browser-evidence.mjs");
  assert.equal(comparableMetrics(data, "transfer").length, 4);
  const after = structuredClone(data);
  after.phase = "after";
  assert.throws(
    () => validateEvidenceArtifact(after, "transfer", {}, comparisonOptions),
    /Functional postconditions failed/,
  );
  const mismatched = structuredClone(data);
  mismatched.metrics.save.samples[0].postconditionErrors = [];
  assert.throws(
    () =>
      validateEvidenceArtifact(mismatched, "transfer", {}, comparisonOptions),
    /disagree/,
  );
  const wrongTarget = structuredClone(data);
  wrongTarget.postconditionErrors[0].itemIds = ["not-transferred"];
  assert.throws(
    () =>
      validateEvidenceArtifact(wrongTarget, "transfer", {}, comparisonOptions),
    /does not match/,
  );
  const sampleOnly = structuredClone(data);
  sampleOnly.postconditionErrors = [];
  assert.throws(
    () =>
      validateEvidenceArtifact(sampleOnly, "transfer", {}, comparisonOptions),
    /disagree/,
  );
});

const baselineNoopSource = "67743821a278c22b38f43fc918d443c581d748cb";
const baselineNoopComparisonOptions = {
  enforceBudgets: false,
  allowBaselinePostconditionFailures: true,
};
function baselineNoopIntegrationFixture(
  kind = "response",
  zeroWriteIndex = -1,
) {
  const condition = expectedConditions("transfer").find(
    (row) => row.scenario === "noop" && row.input === "native",
  );
  const data = artifact("transfer", condition, kind);
  data.phase = "before";
  data.baselineComparisonObservation = {
    phase: "before",
    sourceCommit: baselineNoopSource,
    referenceProductCommit: "200cd7564772a17e2264907ae22e9a93ad30f5dc",
    sourceTree: "4155d4dc250e69b16be9a0455bd99a208b9f8d93",
    publicTree: "90071a462092c45bc3ae11df5e696a053fc8a1ed",
    sourceState: "clean",
  };
  data.notApplicable = {
    save: "The noop sampler defines no save clock; actual unexpected transactions are recorded",
    nextPending: "The noop sampler defines no pending-save input clock",
  };
  data.postconditionErrors = [];
  data.persistence = {
    writeCount: 0,
    operationId: null,
    commits: [],
    samples: [],
  };
  const primary = data.metrics[kind].samples;
  for (const [index, sample] of primary.entries()) {
    const commits =
      index === zeroWriteIndex
        ? []
        : [
            {
              at: sample.startEpoch + 2,
              operationId: `actual-noop-${index}`,
              stores: ["eventLists", "syncQueue"],
              writes: [
                { store: "eventLists", method: "put", key: "fixture-event" },
              ],
            },
          ];
    const record = commits.length
      ? {
          measurementId: sample.measurementId,
          sampleIndex: index + 1,
          code: "unexpected-noop-write",
          itemIds: [sample.targetId],
          message: "Noop expected zero persistence transactions; observed 1",
          expectedWriteCount: 0,
          actualWriteCount: commits.length,
        }
      : undefined;
    if (record) data.postconditionErrors.push(record);
    for (const values of Object.values(data.metrics)) {
      const corresponding = values.samples[index];
      corresponding.commits = structuredClone(commits);
      corresponding.physicalWriteCount = commits.length;
      corresponding.operationId = commits[0]?.operationId ?? null;
      delete corresponding.operationIdUnavailableReason;
      corresponding.postconditionErrors = record
        ? [structuredClone(record)]
        : [];
    }
    data.persistence.samples.push({
      sampleIndex: index + 1,
      measurementId: sample.measurementId,
      physicalWriteCount: commits.length,
      operationId: commits[0]?.operationId ?? null,
      commits: structuredClone(commits),
    });
    data.persistence.commits.push(...structuredClone(commits));
    data.persistence.writeCount += commits.length;
  }
  return data;
}
const baselineNoopExpectedRun = {
  phase: "before",
  runId: identity.runId,
  productCommit: baselineNoopSource,
};
function validateBaselineNoopIntegration(
  data,
  expectedRun = baselineNoopExpectedRun,
) {
  return validateEvidenceArtifact(
    data,
    "transfer",
    expectedRun,
    baselineNoopComparisonOptions,
  );
}

for (const kind of ["response", "frame"]) {
  test(`baseline noop integration ${kind} retains actual writes only for before comparison`, async () => {
    const data = baselineNoopIntegrationFixture(kind);
    const original = structuredClone(data);
    assert.throws(
      () => validateEvidenceArtifact(data, "transfer"),
      /Functional postconditions failed/,
    );
    assert.throws(
      () =>
        validateEvidenceArtifact(
          data,
          "transfer",
          {},
          {
            allowBaselinePostconditionFailures: true,
          },
        ),
      /Functional postconditions failed/,
    );
    assert.doesNotThrow(() => validateBaselineNoopIntegration(data));
    const { comparableMetrics } =
      await import("./compare-shopping-browser-evidence.mjs");
    const rows = comparableMetrics(data, "transfer");
    assert.equal(rows.length, kind === "response" ? 2 : 1);
    assert.deepEqual(
      rows.map((row) => row.operation),
      kind === "response" ? ["response", "nextApplied"] : ["frame"],
    );
    assert.equal(data.persistence.writeCount, 10);
    assert.equal(data.metrics[kind].samples[0].operationId, "actual-noop-0");
    assert.deepEqual(data, original);
    data.phase = "after";
    assert.throws(
      () =>
        validateEvidenceArtifact(
          data,
          "transfer",
          {},
          baselineNoopComparisonOptions,
        ),
      /Functional postconditions failed/,
    );
  });
  test(`baseline noop integration ${kind} keeps zero-write originals outside the exception map`, () => {
    const data = baselineNoopIntegrationFixture(kind, 0);
    assert.doesNotThrow(() => validateBaselineNoopIntegration(data));
    assert.equal(data.persistence.writeCount, 9);
    assert.equal(data.postconditionErrors.length, 9);
    assert.deepEqual(data.metrics[kind].samples[0].commits, []);
    assert.equal(data.metrics[kind].samples[0].operationId, null);
    assert.deepEqual(data.metrics[kind].samples[0].postconditionErrors, []);
    data.metrics[kind].samples[0].physicalWriteCount = 1;
    assert.throws(
      () => validateBaselineNoopIntegration(data),
      /physical transaction evidence/,
    );
  });
}

for (const [label, kind, mutate, pattern] of [
  [
    "source commit from another run",
    "response",
    (data) => {
      data.baselineComparisonObservation.sourceCommit = "b".repeat(40);
    },
    /source commit differs from provenance/,
  ],
  [
    "unknown phase",
    "response",
    (data) => {
      data.phase = "unknown";
    },
    /Functional postconditions failed/,
  ],
  [
    "dirty source",
    "response",
    (data) => {
      data.baselineComparisonObservation.sourceState = "dirty";
    },
    /pinned clean before product/,
  ],
  [
    "changed product tree",
    "frame",
    (data) => {
      data.baselineComparisonObservation.sourceTree = "c".repeat(40);
    },
    /pinned clean before product/,
  ],
  [
    "fake zero aggregate write count",
    "response",
    (data) => {
      data.persistence.writeCount = 0;
    },
    /hides or fabricates/,
  ],
  [
    "fake zero sample write count",
    "frame",
    (data) => {
      data.metrics.frame.samples[0].physicalWriteCount = 0;
    },
    /physical transaction evidence/,
  ],
  [
    "missing next-input metric",
    "response",
    (data) => {
      delete data.metrics.nextApplied;
    },
    /every original/,
  ],
  [
    "mixed frame and response metrics",
    "frame",
    (data) => {
      data.metrics.response = structuredClone(data.metrics.frame);
    },
    /every original/,
  ],
  [
    "write record count mismatch",
    "response",
    (data) => {
      data.postconditionErrors[0].actualWriteCount = 2;
    },
    /actual target\/transaction count/,
  ],
  [
    "record uses next-input target",
    "response",
    (data) => {
      data.postconditionErrors[0].itemIds = [
        data.metrics.nextApplied.samples[0].targetId,
      ];
    },
    /actual target\/transaction count/,
  ],
  [
    "sample record differs from top record",
    "frame",
    (data) => {
      data.metrics.frame.samples[0].postconditionErrors = [];
    },
    /postconditions disagree/,
  ],
  [
    "actual write has no failure record",
    "response",
    (data) => {
      data.postconditionErrors.shift();
      for (const values of Object.values(data.metrics))
        values.samples[0].postconditionErrors = [];
    },
    /matching functional failure record/,
  ],
  [
    "unknown postcondition record field",
    "frame",
    (data) => {
      data.postconditionErrors[0].accepted = true;
    },
    /postcondition record is invalid/,
  ],
  [
    "faked sole operation ID",
    "response",
    (data) => {
      data.metrics.response.samples[0].operationId = "fake-operation";
    },
    /sole operation ID/,
  ],
  [
    "next-input starts before the actual commit",
    "response",
    (data) => {
      data.metrics.nextApplied.samples[0].eventEpoch =
        data.metrics.response.samples[0].commits[0].at;
    },
    /did not follow every actual transaction/,
  ],
  [
    "untrusted next-input",
    "response",
    (data) => {
      data.metrics.nextApplied.samples[0].trusted = false;
    },
    /did not follow every actual transaction/,
  ],
  [
    "unmatched next-input",
    "response",
    (data) => {
      data.metrics.nextApplied.samples[0].matched = false;
    },
    /did not follow every actual transaction/,
  ],
]) {
  test(`baseline noop integration rejects ${label}`, () => {
    const data = baselineNoopIntegrationFixture(kind);
    mutate(data);
    const expectedRun =
      label === "unknown phase" ? {} : baselineNoopExpectedRun;
    assert.throws(
      () => validateBaselineNoopIntegration(data, expectedRun),
      pattern,
    );
  });
}
for (const [field, value, pattern] of [
  ["guideCleared", false, /restore interactive drag state/],
  ["cloneCleared", false, /restore interactive drag state/],
  ["sourceInteractive", false, /restore interactive drag state/],
  ["endpointsCleared", false, /incorrect endpoint state/],
  ["selectionAfterIds", ["changed-selection"], /lost its frozen selection/],
]) {
  test(`baseline noop integration preserves mandatory UI cleanup ${field}`, () => {
    const data = baselineNoopIntegrationFixture();
    data.metrics.response.samples[0][field] = value;
    assert.throws(() => validateBaselineNoopIntegration(data), pattern);
  });
}
for (const field of [
  "sourcePresent",
  "selectionVerified",
  "controlsVerified",
]) {
  test(`baseline noop integration preserves frame visual proof ${field}`, () => {
    const data = baselineNoopIntegrationFixture("frame");
    data.metrics.frame.samples[0][field] = false;
    assert.throws(() => validateBaselineNoopIntegration(data));
  });
}

function baselineFrameIntegrationFixture(partial = false) {
  const condition = acceptedCondition("range", "candidate-to-execute");
  const data = artifact("transfer", condition, "frame");
  data.phase = "before";
  data.baselineComparisonObservation = {
    phase: "before",
    sourceCommit: baselineNoopSource,
    referenceProductCommit: "200cd7564772a17e2264907ae22e9a93ad30f5dc",
    sourceTree: "4155d4dc250e69b16be9a0455bd99a208b9f8d93",
    publicTree: "90071a462092c45bc3ae11df5e696a053fc8a1ed",
    sourceState: "clean",
  };
  data.fixtures = [];
  data.baselineFrameObservations = [];
  data.postconditionErrors = [];
  const fixtureHash = "d".repeat(64);
  for (const [index, sample] of data.metrics.frame.samples.entries()) {
    sample.fixtureHash = fixtureHash;
    sample.postconditionErrors = [];
    sample.durableProof.actualExecuteIds = [...sample.expectedTransferredIds];
    sample.durableProof.expectedExecuteMembership = [
      ...sample.expectedTransferredIds,
    ];
    data.fixtures.push({
      index: index + 1,
      measurementId: sample.measurementId,
      fixtureHash,
      initialCount: 500,
      isolation: "new-browser-context-per-sample",
      baselineItemOrder: [...sample.durableProof.actualItemOrder],
      baselineExecuteIds: [],
    });
    data.baselineFrameObservations.push({
      sampleIndex: index + 1,
      measurementId: sample.measurementId,
      fixtureHash,
      effectiveIds: [...sample.expectedTransferredIds],
      outcome: "completed",
      durationMs: sample.durationMs,
    });
  }
  if (!partial) return data;
  const [unobservable] = data.metrics.frame.samples.splice(0, 1);
  data.metrics.frame.raw.splice(0, 1);
  // A partial witness retains only its nine genuine completed values.
  const values = [...data.metrics.frame.raw].sort((a, b) => a - b);
  data.metrics.frame.summary = {
    count: 9,
    medianMs: values[4],
    p95Ms: values[8],
  };
  const rects = (role) =>
    unobservable.expectedTransferredIds.map((itemId, index) => ({
      itemId,
      role,
      x: role === "destination-card" ? 200 : 10,
      y: 20 + index * 100,
      width: 100,
      height: role === "destination-card" && index === 2 ? 16 : 100,
    }));
  const ref = (name) => ({
    [`${name}Path`]: path.resolve(`wrapper-${name}.fixture`),
    [`${name}Sha256`]: "e".repeat(64),
  });
  const durableProof = structuredClone(unobservable.durableProof);
  durableProof.actualExecuteIds = [...unobservable.expectedTransferredIds];
  durableProof.expectedExecuteMembership = [
    ...unobservable.expectedTransferredIds,
  ];
  const evidence = {
    postInput: true,
    trusted: true,
    matched: true,
    startEpoch: unobservable.startEpoch,
    domMs: 3,
    markerDelayMs: 0,
    commits: unobservable.commits.map((commit) => ({ ...commit, writes: [] })),
    sourceRects: rects("source-origin"),
    targetRects: rects("destination-card"),
    captures: [
      {
        index: 0,
        ...ref("frame"),
        sessionId: 1,
        acknowledged: true,
        metadata: { timestamp: (unobservable.startEpoch + 10) / 1000 },
      },
    ],
    inputMarkerCount: 1,
    inputMarker: { pid: 17, ts: 1000 },
    domMarker: { pid: 17, ts: 4000 },
    ...ref("trace"),
    ...ref("baseline"),
    ...ref("failedObservation"),
    ...ref("failureScreenshot"),
    ...ref("failureDom"),
    durableProof,
    scenarioEvidence: structuredClone(unobservable.scenarioEvidence),
    expectedTransferredIds: [...unobservable.expectedTransferredIds],
    guard: {
      itemId: unobservable.expectedTransferredIds[2],
      actualHeight: 16,
      minimumHeightExclusive: 20,
    },
  };
  const first = data.baselineFrameObservations[0];
  delete first.durationMs;
  first.outcome = "endpoint-unobservable";
  first.failure = {
    code: "identity-clipped",
    message: "Observed destination identity occupied only sixteen pixels",
    evidence,
  };
  data.failure = "One original baseline frame endpoint was unobservable";
  return data;
}

test("baseline frame wrapper integration preserves all completion-profile completed original frames", async () => {
  const data = baselineFrameIntegrationFixture();
  const original = structuredClone(data);
  const checked = validateBaselineFrameObservationArtifact(
    data,
    baselineNoopExpectedRun,
  );
  assert.equal(checked.attempted, 10);
  assert.equal(checked.completedCount, 10);
  assert.equal(checked.unobservableCount, 0);
  assert.doesNotThrow(() =>
    validateEvidenceArtifact(data, "transfer", baselineNoopExpectedRun),
  );
  const { comparableMetrics } =
    await import("./compare-shopping-browser-evidence.mjs");
  assert.equal(comparableMetrics(data, "transfer").length, 1);
  assert.deepEqual(data, original);
});

test("baseline frame wrapper integration retains nine completed clocks and one typed unobservable original", async () => {
  const data = baselineFrameIntegrationFixture(true);
  const original = structuredClone(data);
  const checked = validateBaselineFrameObservationArtifact(
    data,
    baselineNoopExpectedRun,
  );
  assert.equal(checked.attempted, 10);
  assert.equal(checked.completedCount, 9);
  assert.equal(checked.unobservableCount, 1);
  assert.equal(data.metrics.frame.raw.length, 9);
  assert.equal(data.metrics.frame.summary.count, 9);
  assert.equal(
    data.baselineFrameObservations[0].outcome,
    "endpoint-unobservable",
  );
  assert.equal(
    Object.hasOwn(data.baselineFrameObservations[0], "durationMs"),
    false,
  );
  assert.equal(
    data.metrics.frame.samples[0].measurementId,
    data.baselineFrameObservations[1].measurementId,
  );
  assert.throws(
    () => validateEvidenceArtifact(data, "transfer", baselineNoopExpectedRun),
    /Normal acceptance requires 10 observed frames/,
  );
  assert.throws(
    () =>
      validateEvidenceArtifact(
        data,
        "transfer",
        baselineNoopExpectedRun,
        baselineNoopComparisonOptions,
      ),
    /Normal acceptance requires 10 observed frames/,
  );
  const { comparableMetrics } =
    await import("./compare-shopping-browser-evidence.mjs");
  assert.throws(
    () => comparableMetrics(data, "transfer"),
    /Normal acceptance requires 10 observed frames/,
  );
  assert.deepEqual(data, original);
});

for (const partial of [false, true]) {
  test(`baseline frame wrapper integration rejects after ${partial ? "partial" : "complete"} observations`, () => {
    const data = baselineFrameIntegrationFixture(partial);
    data.phase = "after";
    assert.throws(
      () => validateBaselineFrameObservationArtifact(data, {}),
      /only normal before/,
    );
    assert.throws(
      () =>
        validateEvidenceArtifact(
          data,
          "transfer",
          {},
          baselineNoopComparisonOptions,
        ),
      /only normal before/,
    );
  });
  test(`baseline frame wrapper integration binds ${partial ? "partial" : "complete"} source commit to provenance`, () => {
    const data = baselineFrameIntegrationFixture(partial);
    const wrongRun = {
      ...baselineNoopExpectedRun,
      productCommit: "f".repeat(40),
    };
    assert.throws(
      () => validateBaselineFrameObservationArtifact(data, wrongRun),
      /source commit differs from provenance/,
    );
    assert.throws(
      () => validateEvidenceArtifact(data, "transfer", wrongRun),
      /source commit differs from provenance/,
    );
  });
}
for (const [label, mutate, pattern] of [
  [
    "missing full durable item content",
    (evidence) => {
      delete evidence.durableProof.fullItemContentPreserved;
    },
    /mandatory full durable/,
  ],
  [
    "missing complete durable order",
    (evidence) => {
      evidence.durableProof.actualItemOrder.pop();
    },
    /mandatory full durable/,
  ],
  [
    "incorrect transferred membership",
    (evidence) => {
      evidence.durableProof.actualExecuteIds = [];
      evidence.durableProof.expectedExecuteMembership = [];
    },
    /durable membership/,
  ],
  [
    "missing exact checkbox preparation",
    (evidence) => {
      delete evidence.durableProof.selectionPreparation.checkboxChecks;
      delete evidence.scenarioEvidence.selectionPreparation.checkboxChecks;
    },
    /actual-checkbox/,
  ],
  [
    "missing direction-specific durable order",
    (evidence) => {
      delete evidence.durableProof.mergeTailProof;
    },
    /direction-specific order proof/,
  ],
  [
    "unverified selection count",
    (evidence) => {
      evidence.durableProof.selectionPreparation.exactSelectionVerified = false;
      evidence.scenarioEvidence.selectionPreparation.exactSelectionVerified = false;
    },
    /actual-checkbox/,
  ],
]) {
  test(`baseline frame wrapper integration rejects ${label} in an unobservable attempt`, () => {
    const data = baselineFrameIntegrationFixture(true);
    mutate(data.baselineFrameObservations[0].failure.evidence);
    assert.throws(
      () =>
        validateBaselineFrameObservationArtifact(data, baselineNoopExpectedRun),
      pattern,
    );
  });
}
for (const partial of [false, true]) {
  test(`baseline frame wrapper integration keeps completed frame visual proof for ${partial ? "partial" : "complete"} observations`, () => {
    const data = baselineFrameIntegrationFixture(partial);
    data.metrics.frame.samples[0].controlsVerified = false;
    assert.throws(
      () =>
        validateBaselineFrameObservationArtifact(data, baselineNoopExpectedRun),
      /verified visible content/,
    );
  });
}

test("1500 diagnostics and forged normal flags cannot replace mandatory shopping evidence", () => {
  const diagnostic = artifact("shopping", {
    ...expectedConditions("shopping")[0],
    count: 1500,
  });
  Object.assign(diagnostic, shoppingCollectionMetadataForCount(1500));
  assert.throws(
    () => validateEvidenceArtifact(diagnostic, "shopping", identity),
    /Normal acceptance artifact required/,
  );
  diagnostic.diagnosticOnly = false;
  diagnostic.acceptanceMeasurement = true;
  assert.throws(
    () => validateEvidenceArtifact(diagnostic, "shopping", identity),
    /Unexpected performance condition/,
  );
});

async function profiledShoppingArtifact(profile) {
  const { performanceAcceptanceCriteriaForGroup, performanceSamplingProfile } =
    await import("./shopping-performance-evidence-contract.mjs");
  const data = artifact("shopping");
  Object.assign(
    data,
    performanceAcceptanceCriteriaForGroup("shopping", profile),
  );
  const count = performanceSamplingProfile(profile).sampleCount;
  for (const op of Object.keys(data.timings)) {
    data.timings[op] = data.timings[op].slice(0, count);
    data.uiTimings[op] = data.uiTimings[op].slice(0, count);
    data.uiSamples[op] = data.uiSamples[op].slice(0, count);
    data.summary[op] = summarizeSamples(data.timings[op], count);
    data.uiSummary[op] = summarizeSamples(data.uiTimings[op], count);
  }
  return data;
}
test("PR2 is valid only for explicitly requested PR evidence and never for completion10", async () => {
  const data = await profiledShoppingArtifact("pr");
  assert.equal(data.samplingProfile.completionEligible, false);
  assert.doesNotThrow(() =>
    validateEvidenceArtifact(data, "shopping", identity, { profile: "pr" }),
  );
  assert.throws(
    () => validateEvidenceArtifact(data, "shopping", identity),
    /sampling metadata/,
  );
  const completed = await profiledShoppingArtifact("completion");
  assert.doesNotThrow(() =>
    validateEvidenceArtifact(completed, "shopping", identity),
  );
  assert.throws(
    () =>
      validateEvidenceArtifact(completed, "shopping", identity, {
        profile: "pr",
      }),
    /sampling metadata/,
  );
});
for (const mutation of [
  "claimed-count",
  "claimed-eligibility",
  "mixed-metric",
  "old20",
  "missing-policy",
])
  test(`sampling evidence rejects ${mutation} instead of inferring its own profile`, async () => {
    const data = await profiledShoppingArtifact("pr");
    if (mutation === "claimed-count")
      data.samplingProfile = { ...data.samplingProfile, sampleCount: 10 };
    if (mutation === "claimed-eligibility")
      data.samplingProfile = {
        ...data.samplingProfile,
        completionEligible: true,
      };
    if (mutation === "mixed-metric" || mutation === "old20") {
      data.timings.execute = Array(mutation === "old20" ? 20 : 10).fill(10);
      data.summary.execute = summarizeSamples(data.timings.execute);
    }
    if (mutation === "missing-policy") delete data.samplingPolicyId;
    assert.throws(
      () =>
        validateEvidenceArtifact(data, "shopping", identity, { profile: "pr" }),
      /sampling metadata|expected exactly 2/,
    );
  });
test("group verification cannot accept a complete PR matrix as a completion run", async (t) => {
  const f = await fixture(t);
  for (const spec of f.report.suites[0].specs) {
    const a = spec.tests[0].results[0].attachments[0];
    const old = JSON.parse(Buffer.from(a.body, "base64"));
    const data = await profiledShoppingArtifact("pr");
    const { performanceAcceptanceCriteriaForGroup } =
      await import("./shopping-performance-evidence-contract.mjs");
    for (const key of [
      "timings",
      "uiTimings",
      "uiSamples",
      "summary",
      "uiSummary",
    ])
      old[key] = data[key];
    Object.assign(old, performanceAcceptanceCriteriaForGroup("shopping", "pr"));
    a.body = Buffer.from(JSON.stringify(old)).toString("base64");
  }
  await f.save();
  const pr = await verifyGroupEvidence({
    runRoot: f.runRoot,
    group: "shopping",
    ...identity,
    write: false,
    profile: "pr",
  });
  // The fixed condition identities, not the sampling helper, remain the oracle.
  assert.equal(pr.status, "passed", pr.errors.join("\n"));
  const completion = await f.verify();
  assert.equal(completion.status, "failed");
  assert.match(completion.errors.join("\n"), /sampling metadata/);
});

for (const group of ["range", "drag", "transfer"])
  test(`PR2 ${group} evidence uses explicit sampling without changing its endpoint proof`, async () => {
    const { performanceAcceptanceCriteriaForGroup } =
      await import("./shopping-performance-evidence-contract.mjs");
    const a = artifact(group);
    Object.assign(a, performanceAcceptanceCriteriaForGroup(group, "pr"));
    if (group === "range") {
      for (const op of Object.keys(a.timings)) {
        a.timings[op] = a.timings[op].slice(0, 2);
        a.summary[op] = summarizeSamples(a.timings[op], 2);
      }
      a.samples = a.samples.slice(0, 2);
    } else if (group === "drag") {
      for (const record of Object.values(a.records)) {
        record.samples = record.samples.slice(0, 2);
        Object.assign(record, summarizeSamples(record.samples, 2));
      }
      a.start = a.start.slice(0, 2);
      a.end = a.end.slice(0, 2);
    } else
      for (const metric of Object.values(a.metrics)) {
        metric.raw = metric.raw.slice(0, 2);
        metric.samples = metric.samples.slice(0, 2);
        metric.summary = summarizeSamples(metric.raw, 2);
      }
    assert.doesNotThrow(() =>
      validateEvidenceArtifact(a, group, identity, { profile: "pr" }),
    );
    assert.throws(
      () => validateEvidenceArtifact(a, group, identity),
      /sampling metadata/,
    );
  });

test("rewriting every profile label cannot promote two real samples into completion ten", async () => {
  const data = await profiledShoppingArtifact("pr");
  const { performanceAcceptanceCriteriaForGroup } =
    await import("./shopping-performance-evidence-contract.mjs");
  Object.assign(
    data,
    performanceAcceptanceCriteriaForGroup("shopping", "completion"),
  );
  assert.throws(
    () => validateEvidenceArtifact(data, "shopping", identity),
    /expected exactly 10/,
  );
});
