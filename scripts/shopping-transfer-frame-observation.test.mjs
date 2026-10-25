import { spawnSync } from "node:child_process";
import { performanceSamplingProfile } from "./shopping-performance-evidence-contract.mjs";
const sampleCount = performanceSamplingProfile().sampleCount;
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  FrameObservationError,
  appendBaselineFrameObservation,
  canRecordBaselineFrameObservation,
} from "../tests/browser/shopping-transfer-frame-observation.ts";
import { terminalBaselineProduct } from "../tests/browser/shopping-transfer-terminal-observation.ts";

const proof = {
  ...terminalBaselineProduct,
  phase: "before",
  sourceCommit: "a".repeat(40),
  sourceState: "clean",
};
const condition = { count: 500, scenario: "range" };
const hash = "b".repeat(64);
const evidence = () => ({
  postInput: true,
  trusted: true,
  matched: true,
  startEpoch: 100000,
  domMs: 40,
  markerDelayMs: 1,
  inputMarkerCount: 1,
  inputMarker: { pid: 17, ts: 1000 },
  domMarker: { pid: 17, ts: 1040 },
  candidateCount: 0,
  referencePath: "fixture-reference.png",
  referenceSha256: hash,
  verificationPath: "fixture-verification.json",
  verificationSha256: hash,
  commits: [{ at: 100030, stores: ["eventLists"], writes: [] }],
  sourceRects: [
    { itemId: "c1", x: 10, y: 10, width: 100, height: 100, role: "source-gap" },
  ],
  targetRects: [
    {
      itemId: "c3",
      x: 200,
      y: 983.84375,
      width: 100,
      height: 16.15625,
      role: "destination-card",
    },
  ],
  guard: { itemId: "c3", actualHeight: 16.15625, minimumHeightExclusive: 20 },
  tracePath: "fixture-trace.json",
  traceSha256: hash,
  baselinePath: "fixture-baseline.png",
  baselineSha256: hash,
  failedObservationPath: "fixture-probe.json",
  failedObservationSha256: hash,
  captures: [
    {
      index: 0,
      framePath: "fixture-capture.png",
      frameSha256: hash,
      sessionId: 1,
      acknowledged: true,
      metadata: { timestamp: 100.05 },
    },
  ],
});
const observationError = (code = "identity-clipped", details = evidence()) =>
  new FrameObservationError(
    code,
    "accepted-range-frame-1",
    "original guard detail",
    details,
  );

test("typed frame observations preserve actual clipping detail without creating a latency", () => {
  const details = evidence();
  const error = observationError("identity-clipped", details);
  assert.ok(error instanceof Error);
  assert.equal(error.name, "FrameObservationError");
  assert.equal(error.code, "identity-clipped");
  assert.equal(error.measurementId, "accepted-range-frame-1");
  assert.equal(error.message, "original guard detail");
  assert.equal(error.evidence, details);
  assert.equal(error.evidence.guard.actualHeight, 16.15625);
  assert.equal(Object.hasOwn(error, "durationMs"), false);
  assert.equal(Object.hasOwn(error.evidence, "durationMs"), false);
});

for (const change of [
  (details) => {
    details.postInput = false;
  },
  (details) => {
    details.trusted = false;
  },
  (details) => {
    details.matched = false;
  },
]) {
  test("setup, untrusted or unmatched failures cannot become typed post-input observations", () => {
    const details = evidence();
    change(details);
    assert.throws(
      () => observationError("identity-clipped", details),
      /Unknown or pre-input/,
    );
  });
}

test("only the two known guards on the pinned clean before range frame can continue", () => {
  for (const code of ["identity-clipped", "no-content-verified-frame"]) {
    const error = observationError(code);
    assert.equal(
      canRecordBaselineFrameObservation(
        error,
        "before",
        "frame",
        condition,
        proof,
      ),
      true,
    );
    for (const [phase, kind, scope, identity] of [
      ["after", "frame", condition, proof],
      [undefined, "frame", condition, proof],
      ["before", "response", condition, proof],
      ["before", "frame", { ...condition, count: 150 }, proof],
      ["before", "frame", { ...condition, scenario: "multiple" }, proof],
      ["before", "frame", condition, undefined],
      ["before", "frame", condition, { ...proof, sourceTree: "f".repeat(40) }],
      ["before", "frame", condition, { ...proof, sourceState: "dirty" }],
      [
        "before",
        "frame",
        condition,
        { ...proof, referenceProductCommit: "f".repeat(40) },
      ],
    ])
      assert.equal(
        canRecordBaselineFrameObservation(error, phase, kind, scope, identity),
        false,
      );
  }
  assert.throws(() => observationError("setup-error"), /Unknown or pre-input/);
  assert.equal(
    canRecordBaselineFrameObservation(
      new Error("original guard detail"),
      "before",
      "frame",
      condition,
      proof,
    ),
    false,
  );
  assert.equal(
    canRecordBaselineFrameObservation(
      JSON.parse(JSON.stringify(observationError())),
      "before",
      "frame",
      condition,
      proof,
    ),
    false,
  );
});

for (const [name, mutate] of [
  [
    "missing trusted-input trace marker",
    (details) => {
      delete details.inputMarker;
    },
  ],
  [
    "duplicated input trace marker",
    (details) => {
      details.inputMarkerCount = 2;
    },
  ],
  [
    "DOM marker from another renderer",
    (details) => {
      details.domMarker.pid = 18;
    },
  ],
  [
    "DOM marker before input",
    (details) => {
      details.domMarker.ts = 900;
    },
  ],
  [
    "missing no-frame comparison witness",
    (details) => {
      delete details.verificationPath;
    },
  ],
  [
    "no captured PNG",
    (details) => {
      details.captures = [];
    },
  ],
  [
    "unacknowledged capture",
    (details) => {
      details.captures[0].acknowledged = false;
    },
  ],
  [
    "untimed captures only",
    (details) => {
      delete details.captures[0].metadata.timestamp;
    },
  ],
  [
    "missing trace witness",
    (details) => {
      delete details.tracePath;
    },
  ],
  [
    "missing probe witness",
    (details) => {
      delete details.failedObservationSha256;
    },
  ],
]) {
  test(`${name} remains a fatal collection failure`, () => {
    const details = evidence();
    mutate(details);
    assert.equal(
      canRecordBaselineFrameObservation(
        observationError("no-content-verified-frame", details),
        "before",
        "frame",
        condition,
        proof,
      ),
      false,
    );
  });
}

const identity = (sampleIndex) => ({
  sampleIndex,
  measurementId: `original-${sampleIndex}`,
  fixtureHash: hash,
  effectiveIds: ["c1", "c2", "c3"],
});
test("records exactly the original profile-count attempts while keeping unobservable frames out of numeric samples", () => {
  const observations = [];
  const raw = [];
  const attempted = [];
  for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex++) {
    attempted.push(sampleIndex);
    if (sampleIndex % 5 === 0) {
      appendBaselineFrameObservation(observations, {
        ...identity(sampleIndex),
        outcome: "endpoint-unobservable",
        failure: {
          code: "no-content-verified-frame",
          message: "no verified endpoint",
          evidence: evidence(),
        },
      });
    } else {
      const durationMs = sampleIndex + 0.5;
      raw.push(durationMs);
      appendBaselineFrameObservation(observations, {
        ...identity(sampleIndex),
        outcome: "completed",
        durationMs,
      });
    }
  }
  assert.deepEqual(
    attempted,
    Array.from({ length: sampleCount }, (_, index) => index + 1),
  );
  assert.equal(observations.length, sampleCount);
  assert.equal(
    new Set(observations.map((row) => row.measurementId)).size,
    sampleCount,
  );
  assert.equal(raw.length, sampleCount - Math.floor(sampleCount / 5));
  assert.deepEqual(
    observations
      .filter((row) => row.outcome === "completed")
      .map((row) => row.durationMs),
    raw,
  );
  const unobservable = observations.filter(
    (row) => row.outcome === "endpoint-unobservable",
  );
  assert.equal(unobservable.length, Math.floor(sampleCount / 5));
  assert.ok(unobservable.every((row) => !Object.hasOwn(row, "durationMs")));
  assert.throws(
    () =>
      appendBaselineFrameObservation(observations, {
        ...identity(sampleCount + 1),
        outcome: "completed",
        durationMs: 1,
      }),
    /original baseline frame attempt/,
  );
});

test("duplicate, reordered or fabricated failure durations cannot refill the original inventory", () => {
  const observations = [];
  appendBaselineFrameObservation(observations, {
    ...identity(1),
    outcome: "completed",
    durationMs: 2,
  });
  for (const changed of [
    { ...identity(1), outcome: "completed", durationMs: 2 },
    { ...identity(3), outcome: "completed", durationMs: 2 },
    {
      ...identity(2),
      measurementId: "original-1",
      outcome: "completed",
      durationMs: 2,
    },
    {
      ...identity(2),
      outcome: "endpoint-unobservable",
      durationMs: 0,
      failure: {
        code: "identity-clipped",
        message: "clipped",
        evidence: evidence(),
      },
    },
    { ...identity(2), outcome: "completed", durationMs: NaN },
    {
      ...identity(2),
      outcome: "unmeasured",
      failure: { message: "not an observed attempt" },
    },
  ])
    assert.throws(
      () => appendBaselineFrameObservation(observations, changed),
      /original baseline frame attempt/,
    );
  assert.equal(observations.length, 1);
});

test("source guards and the fixed profile-count fixture collection remain distinct from endpoint bookkeeping", async () => {
  const measurement = await readFile(
    new URL(
      "../tests/browser/shopping-transfer-measurement.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(
    [...measurement.matchAll(/new FrameObservationError\(/g)].length,
    2,
  );
  assert.match(
    measurement,
    /source identity must be observable before drop`,\s*\)\.toBeGreaterThan\(20\)/,
  );
  assert.match(measurement, /"identity-clipped"/);
  assert.match(measurement, /"no-content-verified-frame"/);
  const spec = await readFile(
    new URL(
      "../tests/browser/shopping-transfer-accepted.performance.spec.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(spec, /index <= performanceMeasurementSampleCount/);
  assert.match(spec, /resolveBaselineProductObservation\(\{ phase \}\)/);
  assert.match(
    spec,
    /baselineComparisonObservation,\s*baselineFrameObservations/,
  );
  assert.match(spec, /if \(failure\) throw failure/);
  const proofIndex = spec.indexOf(
    "const durableProof = await originalFrameAttempt.verifyDurable()",
  );
  const failedObservationIndex = spec.indexOf(
    'outcome: "endpoint-unobservable"',
  );
  assert.ok(proofIndex >= 0 && proofIndex < failedObservationIndex);
  assert.match(
    spec,
    /verifyDurable: \(\) =>\s*verifyAcceptedScenario\(page, before, scenario, condition\)/,
  );
  assert.match(
    spec,
    /scenarioEvidence: originalFrameAttempt\.scenarioEvidence/,
  );
  assert.match(
    spec,
    /expectedTransferredIds:\s*originalFrameAttempt\.expectedTransferredIds/,
  );
});

test("PR frame bookkeeping uses exactly the selected two original attempts without starting a browser", () => {
  const url = new URL(
    "../tests/browser/shopping-transfer-frame-observation.ts",
    import.meta.url,
  ).href;
  const source = `const { appendBaselineFrameObservation } = await import(${JSON.stringify(url)});
    const observations = [];
    for (let index = 1; index <= 2; index++) appendBaselineFrameObservation(observations, {sampleIndex:index,measurementId:String(index),fixtureHash:"b".repeat(64),effectiveIds:["c1","c2","c3"],outcome:"completed",durationMs:index});
    let rejected = false;
    try { appendBaselineFrameObservation(observations, {sampleIndex:3,measurementId:"3",fixtureHash:"b".repeat(64),effectiveIds:["c1","c2","c3"],outcome:"completed",durationMs:3}); } catch { rejected = true; }
    process.stdout.write(JSON.stringify({count:observations.length,rejected}));`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source],
    {
      env: { ...process.env, ESP_PERFORMANCE_PROFILE: "pr" },
      encoding: "utf8",
    },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { count: 2, rejected: true });
});
