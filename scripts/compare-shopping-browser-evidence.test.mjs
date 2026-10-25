import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  comparableFixtureIdentity,
  comparableMetrics,
  comparisonFunctionalFailure,
  compareBrowserEvidence,
} from "./compare-shopping-browser-evidence.mjs";
import {
  evidenceIdentity,
  summarizeSamples,
  validateEvidenceArtifact,
} from "./verify-shopping-performance-evidence.mjs";
import {
  expectedPerformanceConditions,
  shoppingPerformanceThresholds,
  performanceAcceptanceCriteriaByGroup,
} from "./shopping-performance-evidence-contract.mjs";
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
function shopping(base = 10) {
  const raw = Array.from({ length: 20 }, (_, i) => base + i / 10),
    ops = ["execute", "executeRecord", "focus", "record", "next", "back"];
  return {
    ...evidenceIdentity("shopping"),
    errors: [],
    environment: browserEnvironment,
    count: 150,
    concentrated: false,
    mapVisible: false,
    layout: "pc",
    timings: Object.fromEntries(ops.map((op) => [op, [...raw]])),
    uiTimings: Object.fromEntries(ops.map((op) => [op, [...raw]])),
    summary: Object.fromEntries(ops.map((op) => [op, summarizeSamples(raw)])),
    uiSummary: Object.fromEntries(ops.map((op) => [op, summarizeSamples(raw)])),
    uiSamples: Object.fromEntries(
      ops.map((op) => [
        op,
        raw.map((value, i) => ({
          sampleId: `${op}-${i}`,
          targetId: `item-${i}`,
          expected: "Purchased",
          matched: true,
          legacyMs: value,
          uiMs: value,
        })),
      ]),
    ),
  };
}
test("comparison retains all legacy/UI metrics from a complete threshold-failed before run", () => {
  const data = shopping(80),
    original = structuredClone(data);
  assert.throws(
    () => validateEvidenceArtifact(data, "shopping"),
    /median exceeds/,
  );
  const rows = comparableMetrics(data, "shopping");
  assert.equal(rows.length, 12);
  assert.equal(rows.filter((row) => row.metric === "legacy").length, 6);
  assert.equal(rows.filter((row) => row.metric === "ui").length, 6);
  assert.equal(rows[0].summary.count, 20);
  assert.ok(rows[0].summary.medianMs > shoppingPerformanceThresholds.medianMs);
  assert.deepEqual(data, original);
  assert.throws(
    () => validateEvidenceArtifact(data, "shopping"),
    /median exceeds/,
  );
});
for (const field of ["uiTimings", "uiSummary", "uiSamples"])
  test(`comparison fails closed when ${field} is missing`, () => {
    const data = shopping();
    delete data[field];
    assert.throws(() => comparableMetrics(data, "shopping"));
  });
test("comparison rejects mismatched sample details and summaries without pooling", () => {
  const data = shopping();
  data.uiSamples.execute[0].uiMs = 0;
  assert.throws(() => comparableMetrics(data, "shopping"), /raw\/detail/);
  const short = shopping();
  short.timings.execute.pop();
  assert.throws(() => comparableMetrics(short, "shopping"), /20/);
});
test("incomplete source produces a retained nonzero comparison artifact and refuses overwrite", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "esp compare "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, "comparison.json");
  const result = await compareBrowserEvidence({
    beforeRoot: path.join(directory, "before-missing"),
    afterRoot: path.join(directory, "after-missing"),
    output,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.result.status, "incomplete");
  assert.equal(result.result.deltaStatus, "not-evaluated");
  assert.ok(result.result.errors.length > 0);
  assert.equal(JSON.parse(await readFile(output, "utf8")).status, "incomplete");
  await assert.rejects(
    compareBrowserEvidence({
      beforeRoot: directory,
      afterRoot: directory,
      output,
    }),
    /EEXIST/,
  );
});
async function partialShoppingRun(directory, phase, base = 10, options = {}) {
  const runRoot = path.join(directory, phase);
  await mkdir(path.join(runRoot, "shopping"), { recursive: true });
  const runId = `${phase}-run`;
  const metadata = {
    phase,
    runId,
    instrumentVersion: "shopping-rendering-v2",
    instrumentPatch: { sha256: (options.instrumentHash ?? "a").repeat(64) },
    fixtureSources: { sha256: "b".repeat(64) },
    productCommit: (phase === "before" ? "a" : "b").repeat(40),
    sourceState: "clean",
    sourceDiffSha256: createHash("sha256").update("").digest("hex"),
    releaseCapability: {
      kind: "event-shopping-planner-release-capabilities",
      version: 1,
      buildMode: "release-a",
      releaseChannel: "release-a",
      legacyLocalStorageCleanup: "forced-off",
      sourceState: "clean",
      sourceSha: (phase === "before" ? "a" : "b").repeat(40),
      buildId: (phase === "before" ? "a" : "b").repeat(40),
    },
    releaseCapabilitySha256: "c".repeat(64),
    environment: {
      ...browserEnvironment,
      platform: "win32",
      osRelease: "10.0.26100",
      osVersion: "Windows 11",
      arch: "x64",
      node: process.version,
      ci: null,
      baseURL: "http://127.0.0.1:4173",
      previewSource: "explicit",
      browserChannel: "bundled-chromium",
      headed: false,
      build: "npm run build:release-a",
      workerCount: 1,
    },
  };
  metadata.releaseCapabilityRaw = JSON.stringify(metadata.releaseCapability);
  metadata.releaseCapabilitySha256 = createHash("sha256")
    .update(metadata.releaseCapabilityRaw)
    .digest("hex");
  metadata.servedReleaseCapabilityRaw = metadata.releaseCapabilityRaw;
  metadata.servedReleaseCapabilitySha256 = metadata.releaseCapabilitySha256;
  const report = {
    errors: [],
    config: { workers: 1, projects: [{ retries: 0 }] },
    suites: [
      {
        specs: expectedPerformanceConditions("shopping").map(
          (condition, index) => {
            const data = {
              ...shopping(base),
              ...condition,
              ...evidenceIdentity("shopping", "response", {
                ESP_EVIDENCE_PHASE: phase,
                ESP_EVIDENCE_RUN_ID: runId,
              }),
            };
            if (index === 0 && options.omitUi) delete data.uiSummary;
            return {
              file: "responsive-performance.spec.ts",
              title: `shopping-${index}`,
              ok: phase === "after",
              tests: [
                {
                  expectedStatus: "passed",
                  status: phase === "after" ? "expected" : "unexpected",
                  results: [
                    {
                      retry: 0,
                      status: phase === "after" ? "passed" : "failed",
                      attachments: [
                        {
                          name: "shopping-operation-timings",
                          contentType: "application/json",
                          body: Buffer.from(JSON.stringify(data)).toString(
                            "base64",
                          ),
                        },
                      ],
                    },
                  ],
                },
              ],
            };
          },
        ),
      },
    ],
  };
  await writeFile(
    path.join(runRoot, "run-result.json"),
    JSON.stringify(metadata),
    "utf8",
  );
  await writeFile(
    path.join(runRoot, "shopping/report.json"),
    JSON.stringify(report),
    "utf8",
  );
  return runRoot;
}
test("missing extra categories retain every valid core before/after row and explicit incomparable rows", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "esp partial compare "),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const beforeRoot = await partialShoppingRun(directory, "before", 80),
    afterRoot = await partialShoppingRun(directory, "after", 10);
  const { exitCode, result } = await compareBrowserEvidence({
    beforeRoot,
    afterRoot,
    output: path.join(directory, "comparison.json"),
  });
  assert.equal(exitCode, 1);
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.coverage, {
    expectedMetrics: 672,
    compared: 288,
    uncomparable: 384,
    baselineUnobservable: 0,
    unmeasuredMissing: 384,
  });
  const core = result.rows.find(
    (row) => row.group === "shopping" && row.metric === "ui",
  );
  assert.equal(core.status, "compared");
  assert.equal(core.before.count, 20);
  assert.equal(core.after.count, 20);
  assert.equal(core.beforeAbsolute, "failed");
  assert.equal(core.afterAbsolute, "passed");
  assert.ok(core.deltaMs.median < 0);
  assert.ok(
    result.rows.some(
      (row) =>
        row.group === "transfer" &&
        row.status === "uncomparable" &&
        row.before === null &&
        row.after === null &&
        row.reasons.length > 0,
    ),
  );
});
test("comparison labels current 65ms judgments and preserves original run verdicts", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "esp current budget "),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const beforeRoot = await partialShoppingRun(directory, "before", 60),
    afterRoot = await partialShoppingRun(directory, "after", 64);
  const beforeBytes = await readFile(path.join(beforeRoot, "run-result.json"));
  const afterBytes = await readFile(path.join(afterRoot, "run-result.json"));
  const { result } = await compareBrowserEvidence({ beforeRoot, afterRoot });
  assert.deepEqual(
    result.acceptanceCriteriaByGroup,
    performanceAcceptanceCriteriaByGroup,
  );
  assert.equal(result.acceptanceThresholds, undefined);
  assert.equal(
    result.before.recordedAcceptanceCriteria.acceptanceCriteriaByGroup,
    null,
  );
  const core = result.rows.find((row) => row.group === "shopping");
  assert.equal(core.beforeAbsolute, "passed");
  assert.equal(core.afterAbsolute, "passed");
  assert.equal(core.deltaReview, "increase-needs-review");
  assert.deepEqual(core.acceptanceThresholds, shoppingPerformanceThresholds);
  assert.deepEqual(
    await readFile(path.join(beforeRoot, "run-result.json")),
    beforeBytes,
  );
  assert.deepEqual(
    await readFile(path.join(afterRoot, "run-result.json")),
    afterBytes,
  );
});
test("a missing UI condition leaves its rows incomparable while other valid condition pairs survive", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "esp ui compare "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const beforeRoot = await partialShoppingRun(directory, "before", 10, {
      omitUi: true,
    }),
    afterRoot = await partialShoppingRun(directory, "after", 12);
  const { result } = await compareBrowserEvidence({ beforeRoot, afterRoot });
  assert.equal(result.coverage.compared, 276);
  assert.ok(result.before.errors.some((error) => error.includes("uiSummary")));
  assert.ok(
    result.rows.some(
      (row) =>
        row.group === "shopping" &&
        row.status === "uncomparable" &&
        row.after !== null,
    ),
  );
});
test("instrument mismatches show both raw summaries but never compute misleading deltas", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "esp drift compare "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const beforeRoot = await partialShoppingRun(directory, "before", 10),
    afterRoot = await partialShoppingRun(directory, "after", 12, {
      instrumentHash: "c",
    });
  const { result } = await compareBrowserEvidence({ beforeRoot, afterRoot });
  const core = result.rows.find((row) => row.group === "shopping");
  assert.equal(core.status, "uncomparable");
  assert.ok(core.before && core.after);
  assert.equal(core.deltaMs, null);
  assert.ok(core.reasons.includes("instrumentPatch mismatch"));
});
for (const field of [
  "osRelease",
  "osVersion",
  "browserVersion",
  "viewport",
  "devicePixelRatio",
])
  test(`comparison rejects missing actual run environment ${field}`, async (t) => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "esp environment compare "),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const beforeRoot = await partialShoppingRun(directory, "before");
    const afterRoot = await partialShoppingRun(directory, "after");
    const file = path.join(beforeRoot, "run-result.json");
    const run = JSON.parse(await readFile(file, "utf8"));
    delete run.environment[field];
    await writeFile(file, JSON.stringify(run), "utf8");
    const { exitCode, result } = await compareBrowserEvidence({
      beforeRoot,
      afterRoot,
    });
    assert.equal(exitCode, 1);
    assert.ok(result.errors.some((error) => error.includes("environment")));
    assert.equal(
      result.rows.filter((row) => row.status === "compared").length,
      0,
    );
  });
test("comparison requires actual clean release capability and allows different product build IDs", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "esp release compare "),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const beforeRoot = await partialShoppingRun(directory, "before");
  const afterRoot = await partialShoppingRun(directory, "after");
  const file = path.join(afterRoot, "run-result.json");
  const run = JSON.parse(await readFile(file, "utf8"));
  run.releaseCapability.buildId = "b".repeat(40);
  run.releaseCapability.sourceSha = "b".repeat(40);
  run.releaseCapabilityRaw = JSON.stringify(run.releaseCapability);
  run.releaseCapabilitySha256 = createHash("sha256")
    .update(run.releaseCapabilityRaw)
    .digest("hex");
  run.servedReleaseCapabilityRaw = run.releaseCapabilityRaw;
  run.servedReleaseCapabilitySha256 = run.releaseCapabilitySha256;
  await writeFile(file, JSON.stringify(run), "utf8");
  assert.equal(
    (await compareBrowserEvidence({ beforeRoot, afterRoot })).result.coverage
      .compared,
    288,
  );
  delete run.releaseCapability;
  await writeFile(file, JSON.stringify(run), "utf8");
  const result = await compareBrowserEvidence({ beforeRoot, afterRoot });
  assert.equal(result.exitCode, 1);
  assert.ok(
    result.result.errors.some((error) =>
      error.includes("release-a capability"),
    ),
  );
});

test("comparison rejects a mismatched served preview capability even when both local builds are valid", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "esp served compare "),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const beforeRoot = await partialShoppingRun(directory, "before");
  const afterRoot = await partialShoppingRun(directory, "after");
  const file = path.join(afterRoot, "run-result.json");
  const run = JSON.parse(await readFile(file, "utf8"));
  run.servedReleaseCapabilityRaw += "\n";
  await writeFile(file, JSON.stringify(run), "utf8");
  const { exitCode, result } = await compareBrowserEvidence({
    beforeRoot,
    afterRoot,
  });
  assert.equal(exitCode, 1);
  assert.ok(
    result.errors.some((error) => error.includes("served preview capability")),
  );
});

test("comparison checks each actual isolated fixture and its sample association", () => {
  const hashes = Array.from({ length: 20 }, (_, index) =>
    index.toString(16).padStart(64, "0"),
  );
  const artifact = {
    fixtures: hashes.map((fixtureHash, index) => ({
      index: index + 1,
      fixtureHash,
    })),
    metrics: {
      response: { samples: hashes.map((fixtureHash) => ({ fixtureHash })) },
      save: { samples: hashes.map((fixtureHash) => ({ fixtureHash })) },
    },
  };
  const original = structuredClone(artifact);
  assert.deepEqual(comparableFixtureIdentity(artifact, "transfer"), {
    kind: "isolated",
    hashes,
  });
  assert.deepEqual(artifact, original);
  const different = structuredClone(artifact);
  different.fixtures[7].fixtureHash = "f".repeat(64);
  different.metrics.response.samples[7].fixtureHash = "f".repeat(64);
  different.metrics.save.samples[7].fixtureHash = "f".repeat(64);
  assert.notDeepEqual(
    comparableFixtureIdentity(different, "transfer"),
    comparableFixtureIdentity(artifact, "transfer"),
  );
  const unlinked = structuredClone(artifact);
  unlinked.metrics.save.samples[7].fixtureHash = "f".repeat(64);
  assert.throws(
    () => comparableFixtureIdentity(unlinked, "transfer"),
    /sample fixture hash/,
  );
  const reordered = structuredClone(artifact);
  reordered.fixtures.reverse();
  assert.throws(
    () => comparableFixtureIdentity(reordered, "transfer"),
    /index or hash/,
  );
  const short = structuredClone(artifact);
  short.fixtures.pop();
  assert.throws(
    () => comparableFixtureIdentity(short, "transfer"),
    /incomplete/,
  );
});

test("comparison requires actual transfer fixture identities without inventing missing values", () => {
  const first = { fixture: { fixtureHash: "a".repeat(64) } };
  const second = { fixture: { fixtureHash: "b".repeat(64) } };
  assert.notDeepEqual(
    comparableFixtureIdentity(first, "transfer"),
    comparableFixtureIdentity(second, "transfer"),
  );
  assert.throws(() => comparableFixtureIdentity({}, "transfer"), /missing/);
  assert.throws(
    () =>
      comparableFixtureIdentity({ fixture: { fixtureHash: "" } }, "transfer"),
    /missing/,
  );
  assert.throws(
    () => comparableFixtureIdentity({ ...first, fixtures: [] }, "transfer"),
    /ambiguous/,
  );
  assert.equal(comparableFixtureIdentity(shopping(), "shopping"), null);
});

async function addRangeReport(runRoot, phase, values) {
  const operations = [
    "firstEndpoint",
    "secondEndpoint",
    "selectRange",
    "clearRange",
  ];
  const report = {
    errors: [],
    config: { workers: 1, projects: [{ retries: 0 }] },
    suites: [
      {
        specs: expectedPerformanceConditions("range").map(
          (condition, index) => ({
            file: "edit-execute-range-selection.spec.ts",
            title: `range-${index}`,
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
                        name: "edit-execute-range-selection-timings",
                        contentType: "application/json",
                        body: Buffer.from(
                          JSON.stringify({
                            ...evidenceIdentity("range", "response", {
                              ESP_EVIDENCE_PHASE: phase,
                              ESP_EVIDENCE_RUN_ID: `${phase}-run`,
                            }),
                            environment: {
                              ...browserEnvironment,
                              ...condition,
                              requestedRenderer: condition.renderer,
                            },
                            errors: [],
                            timings: Object.fromEntries(
                              operations.map((op) => [op, values]),
                            ),
                            summary: Object.fromEntries(
                              operations.map((op) => [
                                op,
                                summarizeSamples(values),
                              ]),
                            ),
                            samples: values.map((value, repeat) => ({
                              repeat,
                              durations: Object.fromEntries(
                                operations.map((op) => [op, value]),
                              ),
                            })),
                          }),
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
  await mkdir(path.join(runRoot, "range"));
  await writeFile(
    path.join(runRoot, "range/report.json"),
    JSON.stringify(report),
    "utf8",
  );
}
test("mixed runs independently judge shopping at 65/100 and range at inclusive 110/110 while retaining historical metadata", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "esp scoped compare "),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const beforeRoot = await partialShoppingRun(directory, "before", 70);
  const afterRoot = await partialShoppingRun(directory, "after", 70);
  await addRangeReport(beforeRoot, "before", Array(20).fill(110));
  await addRangeReport(afterRoot, "after", [
    ...Array(18).fill(100),
    110.001,
    110.001,
  ]);
  const file = path.join(afterRoot, "run-result.json");
  const run = JSON.parse(await readFile(file, "utf8"));
  run.acceptanceCriteriaByGroup = performanceAcceptanceCriteriaByGroup;
  await writeFile(file, JSON.stringify(run), "utf8");
  const beforeBytes = await readFile(path.join(beforeRoot, "run-result.json"));
  const afterBytes = await readFile(file);
  const { result } = await compareBrowserEvidence({ beforeRoot, afterRoot });
  const shoppingRow = result.rows.find((row) => row.group === "shopping");
  const rangeRow = result.rows.find((row) => row.group === "range");
  assert.equal(shoppingRow.afterAbsolute, "failed");
  assert.equal(rangeRow.status, "compared");
  assert.equal(rangeRow.beforeAbsolute, "passed");
  assert.equal(rangeRow.afterAbsolute, "failed");
  assert.equal(rangeRow.acceptanceScope, "dnd-selection-rendering");
  assert.deepEqual(rangeRow.acceptanceThresholds, {
    minimumCount: 20,
    medianMs: 110,
    p95Ms: 110,
  });
  assert.equal(
    result.before.recordedAcceptanceCriteria.acceptanceCriteriaByGroup,
    null,
  );
  assert.deepEqual(
    result.after.recordedAcceptanceCriteria.acceptanceCriteriaByGroup,
    performanceAcceptanceCriteriaByGroup,
  );
  assert.deepEqual(
    await readFile(path.join(beforeRoot, "run-result.json")),
    beforeBytes,
  );
  assert.deepEqual(await readFile(file), afterBytes);
});
test("comparison refuses a present but incomplete criteria table", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "esp invalid criteria "),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const beforeRoot = await partialShoppingRun(directory, "before");
  const afterRoot = await partialShoppingRun(directory, "after");
  const file = path.join(afterRoot, "run-result.json");
  const run = JSON.parse(await readFile(file, "utf8"));
  run.acceptanceCriteriaByGroup = structuredClone(
    performanceAcceptanceCriteriaByGroup,
  );
  delete run.acceptanceCriteriaByGroup.range;
  await writeFile(file, JSON.stringify(run), "utf8");
  const { result, exitCode } = await compareBrowserEvidence({
    beforeRoot,
    afterRoot,
  });
  assert.equal(exitCode, 1);
  assert.ok(
    result.errors.some((error) =>
      error.includes("acceptanceCriteriaByGroup metadata"),
    ),
  );
  assert.equal(result.rows.length, 0);
});

test("comparison retains a file-verified unobservable baseline without creating a numeric frame or borrowing after acceptance", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "esp observed baseline compare "),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const beforeRoot = await partialShoppingRun(directory, "before", 80);
  const afterRoot = await partialShoppingRun(directory, "after", 10);
  const metadataPath = path.join(beforeRoot, "run-result.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  metadata.productCommit = "a".repeat(40);
  await writeFile(metadataPath, JSON.stringify(metadata), "utf8");
  const evidenceRoot = path.join(
    beforeRoot,
    "transfer",
    "test-results",
    "observed",
  );
  await mkdir(evidenceRoot, { recursive: true });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDLcAAAAASUVORK5CYII=",
    "base64",
  );
  const put = async (stem, name, bytes) => {
    const filename = path.join(evidenceRoot, `${stem}-${name}`);
    await writeFile(filename, bytes);
    return {
      [`${name}Path`]: filename,
      [`${name}Sha256`]: createHash("sha256").update(bytes).digest("hex"),
    };
  };
  const sharedImage = await put("shared", "frame", png);
  const image = (name) => ({
    [`${name}Path`]: sharedImage.framePath,
    [`${name}Sha256`]: sharedImage.frameSha256,
  });
  const allIds = Array.from(
    { length: 500 },
    (_, index) => `${index < 250 ? "c" : "e"}${index % 250}`,
  );
  const executeIds = allIds.filter((id) => id.startsWith("e"));
  const effectiveIds = ["c1", "c2", "c3"];
  const selectionPreparation = {
    requestedIds: [...effectiveIds],
    requestedDisplayOrder: [...effectiveIds],
    mountedCheckedIds: [...effectiveIds],
    exactSelectionVerified: true,
    requestedCount: 3,
    effectiveCount: 3,
    headerText: "Candidate (3件)",
    checkboxChecks: effectiveIds.map((targetId) => ({
      targetId,
      checked: true,
      scrollY: 0,
      rect: { x: 10, y: 10, width: 100, height: 100 },
    })),
  };
  const durableProof = {
    fullItemContentPreserved: true,
    actualItemOrder: [...allIds],
    actualExecuteIds: [...executeIds, ...effectiveIds],
    expectedExecuteMembership: [...executeIds, ...effectiveIds],
    selectionPreparation,
    candidateOrderProof: null,
    mergeTailProof: [],
  };
  const fixtures = [],
    observations = [];
  for (let sampleIndex = 1; sampleIndex <= 20; sampleIndex++) {
    const measurementId = `original-frame-${sampleIndex}`,
      fixtureHash = "b".repeat(64),
      startEpoch = 100000 + sampleIndex * 1000;
    const inputMarker = { pid: 17, ts: sampleIndex * 10000 },
      domMarker = { pid: 17, ts: sampleIndex * 10000 + 42000 };
    const rects = (role) =>
      effectiveIds.map((itemId, index) => ({
        itemId,
        x: role === "destination-card" ? 200 : 10,
        y: 20 + index * 100,
        width: 100,
        height: role === "destination-card" && index === 2 ? 16.15625 : 100,
        role,
      }));
    const evidence = {
      postInput: true,
      trusted: true,
      matched: true,
      startEpoch,
      domMs: 42,
      markerDelayMs: 1,
      commits: [{ at: startEpoch + 50, stores: ["eventLists"], writes: [] }],
      sourceRects: rects("source-gap"),
      targetRects: rects("destination-card"),
      captures: [
        {
          index: 0,
          ...sharedImage,
          sessionId: sampleIndex,
          acknowledged: true,
          metadata: { timestamp: (startEpoch + 100) / 1000 },
        },
      ],
      inputMarkerCount: 1,
      inputMarker,
      domMarker,
      ...(await put(
        measurementId,
        "trace",
        JSON.stringify({
          traceEvents: [
            { name: `${measurementId}:input`, ...inputMarker },
            { name: `${measurementId}:dom`, ...domMarker },
          ],
        }),
      )),
      ...(await put(
        measurementId,
        "failedObservation",
        JSON.stringify({
          probe: {
            id: "c1",
            trusted: true,
            matched: true,
            startEpoch,
            domMs: 42,
            markerDelayMs: 1,
          },
          columns: [{ column: "execute", ids: [...effectiveIds] }],
        }),
      )),
      ...image("baseline"),
      ...image("failureScreenshot"),
      ...(await put(
        measurementId,
        "failureDom",
        "- document: original failed frame endpoint\n",
      )),
      durableProof,
      scenarioEvidence: { selectionPreparation },
      expectedTransferredIds: [...effectiveIds],
      guard: {
        itemId: "c3",
        actualHeight: 16.15625,
        minimumHeightExclusive: 20,
      },
    };
    fixtures.push({
      index: sampleIndex,
      measurementId,
      fixtureHash,
      initialCount: 500,
      isolation: "new-browser-context-per-sample",
      baselineItemOrder: [...allIds],
      baselineExecuteIds: [...executeIds],
    });
    observations.push({
      sampleIndex,
      measurementId,
      fixtureHash,
      effectiveIds: [...effectiveIds],
      outcome: "endpoint-unobservable",
      failure: {
        code: "identity-clipped",
        message:
          "The third actual moved identity was clipped below the unchanged 20px guard",
        evidence,
      },
    });
  }
  const artifact = {
    ...evidenceIdentity("transfer", "frame", {
      ESP_EVIDENCE_PHASE: "before",
      ESP_EVIDENCE_RUN_ID: metadata.runId,
    }),
    condition: {
      count: 500,
      input: "native",
      grouped: true,
      load: "light",
      direction: "candidate-to-execute",
      scenario: "range",
    },
    baselineComparisonObservation: {
      phase: "before",
      sourceCommit: metadata.productCommit,
      sourceState: "clean",
      referenceProductCommit: "200cd7564772a17e2264907ae22e9a93ad30f5dc",
      sourceTree: "4155d4dc250e69b16be9a0455bd99a208b9f8d93",
      publicTree: "90071a462092c45bc3ae11df5e696a053fc8a1ed",
    },
    fixtures,
    baselineFrameObservations: observations,
    environment: browserEnvironment,
    errors: [],
    postconditionErrors: [],
    metrics: {
      frame: {
        raw: [],
        samples: [],
        summary: { count: 0, medianMs: null, p95Ms: null },
      },
    },
    failure:
      "Original frame endpoint unobservable in all twenty isolated attempts; no timing was substituted",
  };
  const artifactPath = path.join(evidenceRoot, "artifact.json");
  await writeFile(artifactPath, JSON.stringify(artifact), "utf8");
  const originalBytes = await readFile(artifactPath);
  await writeFile(
    path.join(beforeRoot, "transfer", "report.json"),
    JSON.stringify({
      errors: [],
      config: { workers: 1, projects: [{ retries: 0 }] },
      suites: [
        {
          specs: [
            {
              file: "shopping-transfer-accepted.performance.spec.ts",
              title: "original range frame",
              tests: [
                {
                  expectedStatus: "passed",
                  results: [
                    {
                      retry: 0,
                      status: "failed",
                      attachments: [
                        {
                          name: "shopping-transfer-rendering",
                          contentType: "application/json",
                          path: artifactPath,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
    "utf8",
  );
  const { exitCode, result } = await compareBrowserEvidence({
    beforeRoot,
    afterRoot,
  });
  const row = result.rows.find(
    (entry) =>
      entry.group === "transfer" &&
      entry.measurementKind === "frame" &&
      entry.condition.scenario === "range" &&
      entry.condition.input === "native" &&
      entry.condition.direction === "candidate-to-execute",
  );
  assert.equal(exitCode, 1);
  assert.equal(result.status, "incomplete");
  assert.equal(row.status, "uncomparable");
  assert.equal(row.beforeAbsolute, "unobservable");
  assert.equal(row.afterAbsolute, "missing");
  assert.equal(row.before, null);
  assert.equal(row.after, null);
  assert.equal(row.deltaMs, null);
  assert.deepEqual(row.beforeObservation, {
    attempted: 20,
    completedCount: 0,
    unobservableCount: 20,
    numericTimingAvailable: false,
  });
  assert.equal(result.coverage.baselineUnobservable, 1);
  assert.equal(result.before.baselineFrameObservations.length, 1);
  assert.equal(
    result.before.baselineFrameObservations[0].observations.every(
      (entry) => !Object.hasOwn(entry, "durationMs"),
    ),
    true,
  );
  assert.equal(
    result.before.errors.some((error) =>
      error.includes("original range frame:"),
    ),
    false,
  );
  assert.ok(
    Object.keys(result.before.sourceHashes).some((name) =>
      name.endsWith("original-frame-20-trace"),
    ),
  );
  const shoppingRow = result.rows.find(
    (entry) => entry.group === "shopping" && entry.metric === "ui",
  );
  assert.equal(shoppingRow.beforeAbsolute, "failed");
  assert.equal(shoppingRow.afterAbsolute, "passed");
  assert.equal(shoppingRow.status, "compared");
  assert.deepEqual(await readFile(artifactPath), originalBytes);
  const reportPath = path.join(beforeRoot, "transfer", "report.json");
  const contradictoryReport = JSON.parse(await readFile(reportPath, "utf8"));
  contradictoryReport.suites[0].specs[0].tests[0].results[0].status = "passed";
  await writeFile(reportPath, JSON.stringify(contradictoryReport), "utf8");
  const rejected = await compareBrowserEvidence({ beforeRoot, afterRoot });
  assert.equal(rejected.exitCode, 1);
  assert.equal(rejected.result.coverage.baselineUnobservable, 0);
  assert.equal(rejected.result.before.baselineFrameObservations.length, 0);
  assert.ok(
    rejected.result.before.errors.some((error) =>
      error.includes("failed producer result"),
    ),
  );
  assert.deepEqual(await readFile(artifactPath), originalBytes);
});

test("normal and censored comparison reporting retains original partial functional failure identities", () => {
  const artifact = {
    baselineFrameObservations: [
      {
        sampleIndex: 1,
        measurementId: "original-1",
        outcome: "endpoint-unobservable",
      },
      {
        sampleIndex: 7,
        measurementId: "original-7",
        outcome: "completed",
        durationMs: 42,
      },
    ],
    postconditionErrors: [
      {
        sampleIndex: 7,
        measurementId: "original-7",
        code: "selection-not-consumed",
        message: "Moved card remained selected",
        itemIds: ["c2"],
      },
    ],
  };
  const original = structuredClone(artifact);
  const key = 'frame:[["count",500],["scenario","range"]]';
  const failure = comparisonFunctionalFailure(
    artifact,
    "transfer",
    key,
    "before",
  );
  assert.deepEqual(failure.record, {
    group: "transfer",
    key,
    postconditionErrors: original.postconditionErrors,
  });
  assert.match(
    failure.message,
    /completed timings retained with failed functional postconditions/,
  );
  assert.equal(failure.record.postconditionErrors[0].sampleIndex, 7);
  assert.equal(
    failure.record.postconditionErrors[0].measurementId,
    "original-7",
  );
  assert.deepEqual(artifact, original);
  assert.equal(
    comparisonFunctionalFailure(
      { postconditionErrors: [] },
      "transfer",
      key,
      "before",
    ),
    null,
  );
});

for (const change of [
  "product-commit",
  "build-id",
  "source-sha",
  "dirty",
  "diff",
  "missing-state",
])
  test(`comparison rejects self-consistent capability metadata with invalid measured source: ${change}`, async (t) => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "esp source compare "),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const beforeRoot = await partialShoppingRun(directory, "before");
    const afterRoot = await partialShoppingRun(directory, "after");
    const file = path.join(afterRoot, "run-result.json");
    const run = JSON.parse(await readFile(file, "utf8"));
    if (change === "product-commit") run.productCommit = "c".repeat(40);
    if (change === "build-id") run.releaseCapability.buildId = "c".repeat(40);
    if (change === "source-sha")
      run.releaseCapability.sourceSha = "c".repeat(40);
    if (change === "dirty") run.sourceState = "dirty";
    if (change === "diff")
      run.sourceDiffSha256 = createHash("sha256")
        .update("source changed")
        .digest("hex");
    if (change === "missing-state") delete run.sourceState;
    // Rehash local and served copies: internal file consistency alone cannot
    // prove that these bytes were built from the recorded measured product.
    run.releaseCapabilityRaw = JSON.stringify(run.releaseCapability);
    run.releaseCapabilitySha256 = createHash("sha256")
      .update(run.releaseCapabilityRaw)
      .digest("hex");
    run.servedReleaseCapabilityRaw = run.releaseCapabilityRaw;
    run.servedReleaseCapabilitySha256 = run.releaseCapabilitySha256;
    await writeFile(file, JSON.stringify(run), "utf8");
    const { result, exitCode } = await compareBrowserEvidence({
      beforeRoot,
      afterRoot,
    });
    assert.equal(exitCode, 1);
    assert.equal(result.status, "incomplete");
    assert.equal(result.rows.length, 0);
    assert.match(
      result.errors.join("\n"),
      /exact clean product source|source\/build IDs differ/,
    );
  });
