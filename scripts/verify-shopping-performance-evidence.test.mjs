import assert from "node:assert/strict";
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
