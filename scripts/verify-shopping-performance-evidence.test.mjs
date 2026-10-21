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
  verifyGroupEvidence,
  verifyFrameFiles,
} from "./verify-shopping-performance-evidence.mjs";

const identity = { phase: "after", runId: "fixture-run" };
const env = {
  ESP_EVIDENCE_PHASE: identity.phase,
  ESP_EVIDENCE_RUN_ID: identity.runId,
};
const raw = () => Array.from({ length: 20 }, (_, i) => 10 + i / 10);
const metric = (kind = "response") => {
  const values = raw();
  return {
    raw: values,
    summary: summarizeSamples(values),
    samples: values.map((durationMs, i) => ({
      durationMs,
      matched: true,
      measurementId: `sample-${i}`,
      targetId: "item-1",
      ...(kind === "frame"
        ? {
            frameVerified: true,
            sourceAbsent: true,
            destinationOrderVerified: true,
            controlsVerified: true,
            frameTimestampMs: durationMs,
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
  const base = { ...evidenceIdentity(group, kind, env), errors: [] };
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
      environment: { ...condition, requestedRenderer: condition.renderer },
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
    metrics: Object.fromEntries(
      (kind === "response"
        ? ["response", "nextPending", "nextApplied", "save"]
        : ["frame"]
      ).map((op) => [op, metric(kind)]),
    ),
  };
}
const names = {
  shopping: "shopping-operation-timings",
  range: "edit-execute-range-selection-timings",
  drag: "shopping-drag-response",
  transfer: "shopping-transfer-rendering",
};
const specs = {
  shopping: "responsive-performance.spec.ts",
  range: "edit-execute-range-selection.spec.ts",
  drag: "shopping-cross-column-drag.spec.ts",
  transfer: "shopping-transfer-rendering.performance.spec.ts",
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
        specs: expectedConditions(group).flatMap((condition) =>
          (group === "transfer" ? ["response", "frame"] : ["response"]).map(
            (kind) => ({
              file: specs[group],
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
          screenshot: { pid: 1, ts: began + sample.durationMs * 1000 },
        };
        trace.push(
          { name: `${sample.measurementId}:input`, ...points.input },
          { name: `${sample.measurementId}:dom`, ...points.dom },
          { name: "Paint", ...points.paint },
          { name: "DrawFrame", ...points.drawFrame },
          {
            name: "Screenshot",
            ...points.screenshot,
            args: { snapshot: image.toString("base64") },
          },
        );
        sample.markerDelayMs = 0;
        sample.paintCorrelated = true;
        sample.drawFrameCorrelated = true;
        sample.correlation = {
          ...points,
          comparison: {
            matched: true,
            scores: [
              { frameError: 0, baselineError: 1 },
              { frameError: 0, baselineError: 1 },
            ],
          },
        };
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
test("known normal matrices pass with exact expected coverage and response/frame separation", async (t) => {
  assert.deepEqual(
    ["shopping", "range", "drag", "transfer"].map(
      (g) => expectedConditions(g).length,
    ),
    [24, 20, 8, 24],
  );
  for (const group of ["shopping", "range", "drag", "transfer"]) {
    const f = await fixture(t, group);
    assert.equal((await f.verify()).status, "passed", group);
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
    "19 samples",
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
  assert.deepEqual(summarizeSamples(Array.from({ length: 20 }, (_, i) => i)), {
    count: 20,
    medianMs: 9.5,
    p95Ms: 18,
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
    "wrong screenshot",
    (sample) => {
      sample.correlation.screenshot.ts += 1;
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
