import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HISTORICAL_POLICY_TRANSITION,
  proveKnownPolicyTransition,
  loadBeforePolicyBridge,
  expectedHistoricalInventory,
} from "./browser-evidence-before-policy.mjs";
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
  performanceSamplingMetadata,
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
  const raw = Array.from({ length: 10 }, (_, i) => base + i / 10),
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
  assert.equal(rows[0].summary.count, 10);
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
  assert.throws(() => comparableMetrics(short, "shopping"), /10/);
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
    instrumentVersion: options.instrumentVersion ?? "shopping-rendering-v4",
    ...performanceSamplingMetadata(),
    acceptanceCriteriaByGroup:
      options.criteria ?? performanceAcceptanceCriteriaByGroup,
    instrumentPatch: options.instrumentPatch ?? {
      sha256: (options.instrumentHash ?? "a").repeat(64),
    },
    fixtureSources: options.fixtureSources ?? { sha256: "b".repeat(64) },
    productCommit:
      options.productCommit ?? (phase === "before" ? "a" : "b").repeat(40),
    ...(options.finishedAt
      ? {
          status:
            options.producerStatus ??
            (phase === "before" ? "failed" : "passed"),
          finishedAt: options.finishedAt,
        }
      : {}),
    sourceState: "clean",
    sourceDiffSha256: createHash("sha256").update("").digest("hex"),
    releaseCapability: {
      kind: "event-shopping-planner-release-capabilities",
      version: 1,
      buildMode: "release-a",
      releaseChannel: "release-a",
      legacyLocalStorageCleanup: "forced-off",
      sourceState: "clean",
      sourceSha:
        options.productCommit ?? (phase === "before" ? "a" : "b").repeat(40),
      buildId:
        options.productCommit ?? (phase === "before" ? "a" : "b").repeat(40),
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
              ...(options.identityFactory ?? evidenceIdentity)(
                "shopping",
                "response",
                {
                  ESP_EVIDENCE_PHASE: phase,
                  ESP_EVIDENCE_RUN_ID: runId,
                },
              ),
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
    expectedMetrics: 576,
    compared: 192,
    uncomparable: 384,
    baselineUnobservable: 0,
    unmeasuredMissing: 384,
  });
  assert.equal(result.rows.filter((row) => !row.auxiliary).length, 530);
  assert.equal(result.rows.filter((row) => row.auxiliary).length, 46);
  const core = result.rows.find(
    (row) => row.group === "shopping" && row.metric === "ui",
  );
  assert.equal(core.status, "compared");
  assert.equal(core.before.count, 10);
  assert.equal(core.after.count, 10);
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
  assert.deepEqual(
    result.before.recordedAcceptanceCriteria.acceptanceCriteriaByGroup,
    performanceAcceptanceCriteriaByGroup,
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
  assert.equal(result.coverage.compared, 180);
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
    192,
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
  const hashes = Array.from({ length: 10 }, (_, index) =>
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

async function addRangeReport(
  runRoot,
  phase,
  values,
  identityFactory = evidenceIdentity,
  producerStatus = "passed",
) {
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
                status: producerStatus === "passed" ? "expected" : "unexpected",
                results: [
                  {
                    retry: 0,
                    status: producerStatus,
                    attachments: [
                      {
                        name: "edit-execute-range-selection-timings",
                        contentType: "application/json",
                        body: Buffer.from(
                          JSON.stringify({
                            ...identityFactory("range", "response", {
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
test("mixed runs independently judge shopping at 65/100 and range at inclusive 150/150 while retaining historical metadata", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "esp scoped compare "),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const beforeRoot = await partialShoppingRun(directory, "before", 70);
  const afterRoot = await partialShoppingRun(directory, "after", 70);
  await addRangeReport(beforeRoot, "before", Array(10).fill(150));
  await addRangeReport(afterRoot, "after", [
    ...Array(8).fill(100),
    150.001,
    150.001,
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
    minimumCount: 10,
    medianMs: 150,
    p95Ms: 150,
  });
  assert.deepEqual(
    result.before.recordedAcceptanceCriteria.acceptanceCriteriaByGroup,
    performanceAcceptanceCriteriaByGroup,
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

for (const historical of [false, true])
  test(`${historical ? "explicit110-to150 bridge: " : ""}comparison retains a file-verified unobservable baseline without creating a numeric frame or borrowing after acceptance`, async (t) => {
    const historicalFixture = historical
      ? await historicalComparisonFixture(t)
      : null;
    const directory =
      historicalFixture?.directory ??
      (await mkdtemp(path.join(os.tmpdir(), "esp observed baseline compare ")));
    if (!historicalFixture)
      t.after(() => rm(directory, { recursive: true, force: true }));
    const beforeRoot =
      historicalFixture?.beforeRoot ??
      (await partialShoppingRun(directory, "before", 80));
    const afterRoot =
      historicalFixture?.afterRoot ??
      (await partialShoppingRun(directory, "after", 10));
    const identityFactory =
      historicalFixture?.legacyVerifier.evidenceIdentity ?? evidenceIdentity;
    const beforePolicyRoot = historicalFixture?.root;
    const compare =
      historicalFixture?.compareBrowserEvidence ?? compareBrowserEvidence;
    const metadataPath = path.join(beforeRoot, "run-result.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
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
    const forwardOrderExpectation = {
      contract: "execution-visit-tail-and-anchor-boundary",
      beforeItemOrder: [...allIds],
      beforeExecuteIds: [...executeIds],
      sourceIds: [...effectiveIds],
      beforeVisits: executeIds.map((id) => ({ key: id, itemIds: [id] })),
      sourceVisits: effectiveIds.map((id) => ({ key: id, itemIds: [id] })),
      anchorId: executeIds.at(-1),
      boundaryKind: "after-reference-visit",
      boundaryId: null,
      expectedItemOrder: [...allIds],
      expectedExecuteIds: [...executeIds, ...effectiveIds],
      expectedDisplayIds: [...executeIds, ...effectiveIds],
    };
    if (!historical)
      durableProof.forwardOrderProof = {
        ...forwardOrderExpectation,
        actualItemOrder: [...allIds],
        actualExecuteIds: [...executeIds, ...effectiveIds],
        actualMountedDisplayIds: [...executeIds, ...effectiveIds],
        rawOrderVerified: true,
        displayOrderVerified: true,
      };
    const fixtures = [],
      observations = [];
    for (let sampleIndex = 1; sampleIndex <= 10; sampleIndex++) {
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
      const sourcePoint = { x: 20, y: 30 };
      const sourceRect = { x: 10, y: 20, width: 100, height: 100 };
      const sourceHit = {
        origin: "card-edge",
        point: sourcePoint,
        withinSource: true,
        withinViewport: true,
        interactive: false,
        sourceContainsHit: true,
        sourceOwnerMatched: true,
        hitItemId: effectiveIds[0],
        hitRect: { ...sourceRect },
        matched: true,
      };
      const evidence = {
        ...(!historical
          ? {
              measurementId,
              targetId: effectiveIds[0],
              probeCpuMs: 0.2,
              probeChecks: 4,
              operationId: null,
              operationIdUnavailableReason:
                "Persistence request did not expose an operation ID",
              gestureObservation: {
                sourcePoint,
                sourceOrigin: sourceHit.origin,
                sourceHitTest: {
                  sourceId: effectiveIds[0],
                  sourceRect,
                  attempts: [sourceHit],
                  selectedHit: { ...sourceHit },
                  initialRejection: null,
                },
              },
              requiredDestinationIds: [...effectiveIds],
              destinationCardExemptions: [],
              requiredDestinationCardsVerified: true,
              mountedTransferredIds: [...effectiveIds],
              expectedDestinationDisplayIds: [...executeIds, ...effectiveIds],
              visibleTransferredIds: [...effectiveIds],
            }
          : {}),
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
        scenarioEvidence: {
          selectionPreparation,
          ...(!historical ? { forwardOrderExpectation } : {}),
        },
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
      ...identityFactory("transfer", "frame", {
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
        "Original frame endpoint unobservable in all original profile attempts; no timing was substituted",
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
    const { exitCode, result } = await compare({
      beforeRoot,
      afterRoot,
      beforePolicyRoot,
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
    if (historical) {
      assert.equal(row.beforeOriginalAbsolute, "unobservable");
      assert.equal(row.beforeReevaluatedAbsolute, "unobservable");
      assert.equal(row.beforeFunctionalStatus, "unobservable");
      assert.equal(row.beforeOriginalProducerTestStatus, "failed");
    }
    assert.equal(row.afterAbsolute, "missing");
    assert.equal(row.before, null);
    assert.equal(row.after, null);
    assert.equal(row.deltaMs, null);
    assert.deepEqual(row.beforeObservation, {
      attempted: 10,
      completedCount: 0,
      unobservableCount: 10,
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
        name.endsWith("original-frame-10-trace"),
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
    contradictoryReport.suites[0].specs[0].tests[0].results[0].status =
      "passed";
    await writeFile(reportPath, JSON.stringify(contradictoryReport), "utf8");
    const rejected = await compare({
      beforeRoot,
      afterRoot,
      beforePolicyRoot,
    });
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

async function rewriteRunSampling(root, profile) {
  const {
    performanceAcceptanceCriteriaByGroupForProfile,
    performanceSamplingMetadata,
    performanceAcceptanceCriteriaForGroup,
    performanceSamplingProfile,
  } = await import("./shopping-performance-evidence-contract.mjs");
  const metaPath = path.join(root, "run-result.json"),
    run = JSON.parse(await readFile(metaPath, "utf8"));
  Object.assign(run, performanceSamplingMetadata(profile), {
    acceptanceCriteriaByGroup:
      performanceAcceptanceCriteriaByGroupForProfile(profile),
  });
  await writeFile(metaPath, JSON.stringify(run), "utf8");
  const reportPath = path.join(root, "shopping/report.json"),
    report = JSON.parse(await readFile(reportPath, "utf8"));
  const count = performanceSamplingProfile(profile).sampleCount;
  for (const spec of report.suites[0].specs) {
    const attachment = spec.tests[0].results[0].attachments[0],
      a = JSON.parse(Buffer.from(attachment.body, "base64"));
    Object.assign(
      a,
      performanceAcceptanceCriteriaForGroup("shopping", profile),
    );
    for (const op of Object.keys(a.timings)) {
      a.timings[op] = a.timings[op].slice(0, count);
      a.uiTimings[op] = a.uiTimings[op].slice(0, count);
      a.uiSamples[op] = a.uiSamples[op].slice(0, count);
      a.summary[op] = summarizeSamples(a.timings[op], count);
      a.uiSummary[op] = summarizeSamples(a.uiTimings[op], count);
    }
    attachment.body = Buffer.from(JSON.stringify(a)).toString("base64");
  }
  await writeFile(reportPath, JSON.stringify(report), "utf8");
}
test("comparison requires the same explicit sampling profile and cannot reuse PR2 as completion10", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "esp profile compare "),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const beforeRoot = await partialShoppingRun(directory, "before"),
    afterRoot = await partialShoppingRun(directory, "after");
  await rewriteRunSampling(beforeRoot, "pr");
  await rewriteRunSampling(afterRoot, "pr");
  const pr = await compareBrowserEvidence({
    beforeRoot,
    afterRoot,
    profile: "pr",
    env: {},
  });
  assert.equal(pr.result.coverage.compared, 192);
  assert.equal(pr.result.samplingProfile.completionEligible, false);
  assert.equal(
    pr.result.rows.find((row) => row.group === "shopping").after.count,
    2,
  );
  const final = await compareBrowserEvidence({
    beforeRoot,
    afterRoot,
    env: {},
  });
  assert.equal(final.exitCode, 1);
  assert.equal(final.result.rows.length, 0);
  assert.match(final.result.errors.join("\n"), /sampling metadata/);
  const afterPath = path.join(afterRoot, "run-result.json"),
    after = JSON.parse(await readFile(afterPath, "utf8"));
  Object.assign(after, performanceSamplingMetadata());
  await writeFile(afterPath, JSON.stringify(after), "utf8");
  const mixed = await compareBrowserEvidence({
    beforeRoot,
    afterRoot,
    profile: "pr",
    env: {},
  });
  assert.equal(mixed.exitCode, 1);
  assert.equal(mixed.result.rows.length, 0);
  assert.match(mixed.result.errors.join("\n"), /sampling metadata/);
  await assert.rejects(
    compareBrowserEvidence({
      beforeRoot,
      afterRoot,
      profile: "pr",
      env: { ESP_PERFORMANCE_PROFILE: "completion" },
    }),
    /conflicts/,
  );
});

test("v3 comparison cannot hide forged sample thresholds by deleting time criteria fields", () => {
  const data = shopping();
  delete data.acceptanceScope;
  delete data.acceptanceCriteriaId;
  data.acceptanceThresholds = { ...data.acceptanceThresholds, minimumCount: 2 };
  assert.throws(
    () => comparableMetrics(data, "shopping"),
    /acceptanceScope metadata/,
  );
});
function historicalPolicyBytes(current) {
  const text = current
    .toString("utf8")
    .replace(
      "// D&D budgets changed on 2026-10-26; shopping budgets and workload conditions are unchanged.\n// Sampling remains PR2/completion10 under its separate 2026-10-26 policy.\n",
      "// Time budgets and workload conditions are unchanged. Sampling changed on 2026-10-26.\n",
    )
    .replace(
      'export const dndSelectionRenderingPerformanceCriteriaDate = "2026-10-26";',
      'export const dndSelectionRenderingPerformanceCriteriaDate = "2026-10-24";',
    )
    .replace(
      "  medianMs: 150,\n  p95Ms: 150,",
      "  medianMs: 110,\n  p95Ms: 110,",
    )
    .replace(
      'acceptanceCriteriaId: "dnd-selection-rendering-150-150-2026-10-26",',
      'acceptanceCriteriaId: "dnd-selection-rendering-110-110-2026-10-24",',
    );
  const bytes = Buffer.from(text, "utf8");
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    HISTORICAL_POLICY_TRANSITION.beforePolicySha256,
  );
  return bytes;
}
function manifestFor(entries) {
  const hash = createHash("sha256"),
    files = {};
  for (const [name, bytes] of entries) {
    files[name] = createHash("sha256").update(bytes).digest("hex");
    hash.update(name).update("\0").update(bytes).update("\0");
  }
  return { sha256: hash.digest("hex"), files };
}
async function historicalComparisonFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "esp policy bridge "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "historical-policy");
  await mkdir(path.join(root, "scripts"), { recursive: true });
  const currentRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const policy = HISTORICAL_POLICY_TRANSITION.policyPath;
  const current = await readFile(path.join(currentRoot, policy));
  const files = new Map();
  // Historical bridge fixtures are actual pinned v3 bytes. Current v4 endpoint
  // contracts must never be written into an invented v3 producer manifest.
  const historicalSource = "62087221941e10a55562842288a8cc1ab298b1c4";
  const historicalBytes = (name) =>
    execFileSync(
      "git",
      ["-C", currentRoot, "show", `${historicalSource}:${name}`],
      { windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
    );
  const inventory = expectedHistoricalInventory(currentRoot, historicalSource);
  for (const name of inventory.instrument) {
    const bytes =
      name === policy ? historicalPolicyBytes(current) : historicalBytes(name);
    files.set(name, bytes);
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), bytes);
  }
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  git("init", "--quiet");
  git("config", "core.autocrlf", "false");
  git("config", "user.name", "Policy fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("add", "--all");
  git("commit", "--quiet", "-m", "known historical policy fixture");
  const commit = git("rev-parse", "HEAD");
  const legacyPolicy = await import(
    pathToFileURL(path.join(root, policy)).href
  );
  const legacyVerifier = await import(
    pathToFileURL(
      path.join(root, "scripts/verify-shopping-performance-evidence.mjs"),
    ).href
  );
  const afterFiles = new Map(files);
  afterFiles.set(policy, current);
  // Run the old comparison contract with its own v3 tools and known150 policy.
  // The current v4 comparator continues to reject historical endpoint semantics.
  const consumerRoot = path.join(directory, "historical-consumer");
  const consumerFiles = new Map(afterFiles);
  for (const name of [
    "scripts/compare-shopping-browser-evidence.mjs",
    "scripts/browser-evidence-before-policy.mjs",
  ])
    consumerFiles.set(name, historicalBytes(name));
  for (const [name, bytes] of consumerFiles) {
    await mkdir(path.dirname(path.join(consumerRoot, name)), {
      recursive: true,
    });
    await writeFile(path.join(consumerRoot, name), bytes);
  }
  const historicalComparator = await import(
    pathToFileURL(
      path.join(consumerRoot, "scripts/compare-shopping-browser-evidence.mjs"),
    ).href
  );
  const historicalAfterVerifier = await import(
    pathToFileURL(
      path.join(
        consumerRoot,
        "scripts/verify-shopping-performance-evidence.mjs",
      ),
    ).href
  );
  const fixtureSources = manifestFor(
    new Map(inventory.fixtures.map((name) => [name, files.get(name)])),
  );
  const beforeRoot = await partialShoppingRun(directory, "before", 70, {
    criteria: legacyPolicy.performanceAcceptanceCriteriaByGroup,
    instrumentVersion: "shopping-rendering-v3",
    identityFactory: legacyVerifier.evidenceIdentity,
    productCommit: commit,
    instrumentPatch: manifestFor(files),
    fixtureSources,
    finishedAt: "2026-10-26T00:00:00.000Z",
    producerStatus: "failed",
  });
  const afterRoot = await partialShoppingRun(directory, "after", 60, {
    instrumentVersion: "shopping-rendering-v3",
    identityFactory: historicalAfterVerifier.evidenceIdentity,
    instrumentPatch: manifestFor(afterFiles),
    fixtureSources,
    finishedAt: "2026-10-26T01:00:00.000Z",
    producerStatus: "passed",
  });
  await addRangeReport(
    beforeRoot,
    "before",
    Array(10).fill(130),
    legacyVerifier.evidenceIdentity,
    "failed",
  );
  await addRangeReport(
    afterRoot,
    "after",
    Array(10).fill(130),
    historicalAfterVerifier.evidenceIdentity,
  );
  const read = async (phase) =>
    JSON.parse(
      await readFile(
        path.join(
          phase === "before" ? beforeRoot : afterRoot,
          "run-result.json",
        ),
        "utf8",
      ),
    );
  const change = async (phase, update) => {
    const file = path.join(
      phase === "before" ? beforeRoot : afterRoot,
      "run-result.json",
    );
    const data = JSON.parse(await readFile(file, "utf8"));
    update(data);
    await writeFile(file, JSON.stringify(data), "utf8");
  };
  return {
    directory,
    root,
    beforeRoot,
    afterRoot,
    legacyPolicy,
    legacyVerifier,
    compareBrowserEvidence: historicalComparator.compareBrowserEvidence,
    current,
    files,
    afterFiles,
    policy,
    currentPolicyPath: path.join(currentRoot, policy),
    read,
    change,
    git,
  };
}
for (const afterVersion of ["shopping-rendering-v3", "shopping-rendering-v4"])
  test(`current v4 comparison rejects v3 before clocks with ${afterVersion} after metadata`, async (t) => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "esp endpoint version "),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const beforeRoot = await partialShoppingRun(directory, "before", 10, {
      instrumentVersion: "shopping-rendering-v3",
    });
    const afterRoot = await partialShoppingRun(directory, "after", 10, {
      instrumentVersion: afterVersion,
    });
    const { exitCode, result } = await compareBrowserEvidence({
      beforeRoot,
      afterRoot,
    });
    assert.equal(exitCode, 1);
    assert.equal(result.rows.length, 0);
    assert.ok(
      result.errors.some((message) =>
        message.includes("unknown instrumentVersion"),
      ),
    );
  });
test("known policy proof recognizes only exact110-to150 literals, preserving sampling/inventory", async () => {
  const current = await readFile(
    new URL("./shopping-performance-evidence-contract.mjs", import.meta.url),
  );
  const before = historicalPolicyBytes(current);
  const proof = proveKnownPolicyTransition(before, current);
  assert.equal(proof.byteExactKnownLiteralReplacement, true);
  assert.equal(proof.replacementCount, 4);
  for (const changed of [
    Buffer.concat([current, Buffer.from("\n")]),
    Buffer.from(
      current.toString().replace("sampleCount: 10", "sampleCount: 20"),
    ),
    Buffer.from(current.toString().replace("medianMs: 65", "medianMs: 150")),
  ])
    assert.throws(
      () => proveKnownPolicyTransition(before, changed),
      /Unrecognized current policy/,
    );
});
test("default comparison still rejects explicit historical110 metadata without the policy switch", async (t) => {
  const f = await historicalComparisonFixture(t);
  const { result } = await compareBrowserEvidence({
    beforeRoot: f.beforeRoot,
    afterRoot: f.afterRoot,
  });
  assert.equal(result.status, "incomplete");
  assert.ok(
    result.errors.some((error) => /invalid acceptanceCriteriaId/.test(error)),
  );
  assert.equal(result.beforePolicyReevaluation, undefined);
});
test("explicit policy root validates old110 records then separately reevaluates150 without promoting incomplete coverage", async (t) => {
  const f = await historicalComparisonFixture(t);
  const beforeBytes = await readFile(
    path.join(f.beforeRoot, "run-result.json"),
  );
  const beforeRange = await readFile(
    path.join(f.beforeRoot, "range/report.json"),
  );
  const afterBytes = await readFile(path.join(f.afterRoot, "run-result.json"));
  const { result, exitCode } = await f.compareBrowserEvidence({
    beforeRoot: f.beforeRoot,
    afterRoot: f.afterRoot,
    beforePolicyRoot: f.root,
  });
  const row = result.rows.find((row) => row.group === "range");
  assert.equal(row.status, "compared");
  assert.equal(row.beforeOriginalCriteria.acceptanceThresholds.medianMs, 110);
  assert.equal(row.beforeOriginalAbsolute, "failed");
  assert.equal(row.beforeOriginalProducerTestStatus, "failed");
  assert.equal(
    row.beforeReevaluatedCriteria.acceptanceThresholds.medianMs,
    150,
  );
  assert.equal(row.beforeReevaluatedAbsolute, "passed");
  assert.equal(row.beforeAbsolute, "passed");
  assert.equal(
    result.before.recordedAcceptanceCriteria.originalStatus,
    "failed",
  );
  assert.equal(
    result.beforePolicyReevaluation.transition.byteExactKnownLiteralReplacement,
    true,
  );
  assert.ok(result.coverage.uncomparable > 0);
  assert.equal(result.status, "incomplete");
  assert.equal(exitCode, 1);
  assert.deepEqual(
    await readFile(path.join(f.beforeRoot, "run-result.json")),
    beforeBytes,
  );
  assert.deepEqual(
    await readFile(path.join(f.beforeRoot, "range/report.json")),
    beforeRange,
  );
  assert.deepEqual(
    await readFile(path.join(f.afterRoot, "run-result.json")),
    afterBytes,
  );
});
for (const change of [
  "non-policy-hash",
  "inventory",
  "aggregate",
  "fixture-inventory",
  "fixture-aggregate",
  "both-missing-file",
  "both-extra-file",
  "both-missing-fixture",
  "after-old-policy",
  "unfinished",
]) {
  test(`explicit historical bridge rejects ${change} instead of allowing a generic mismatch`, async (t) => {
    const f = await historicalComparisonFixture(t);
    await f.change("after", (data) => {
      if (change === "non-policy-hash")
        data.instrumentPatch.files[
          "scripts/verify-shopping-performance-evidence.mjs"
        ] = "a".repeat(64);
      if (change === "inventory") delete data.instrumentPatch.files[f.policy];
      if (change === "aggregate") data.instrumentPatch.sha256 = "a".repeat(64);
      if (change === "fixture-inventory") data.fixtureSources.files = {};
      if (change === "fixture-aggregate")
        data.fixtureSources.sha256 = "a".repeat(64);
      if (change === "after-old-policy")
        data.acceptanceCriteriaByGroup =
          f.legacyPolicy.performanceAcceptanceCriteriaByGroup;
      if (change === "unfinished") delete data.finishedAt;
    });
    if (
      change === "both-missing-file" ||
      change === "both-extra-file" ||
      change === "both-missing-fixture"
    ) {
      for (const phase of ["before", "after"])
        await f.change(phase, (data) => {
          if (change === "both-missing-file")
            delete data.instrumentPatch.files[
              "scripts/run-shopping-browser-evidence.mjs"
            ];
          if (change === "both-extra-file")
            data.instrumentPatch.files["scripts/extra.mjs"] = "a".repeat(64);
          if (change === "both-missing-fixture")
            delete data.fixtureSources.files[
              "tests/browser/shopping-operation-sampling.ts"
            ];
        });
    }
    const { result, exitCode } = await compareBrowserEvidence({
      beforeRoot: f.beforeRoot,
      afterRoot: f.afterRoot,
      beforePolicyRoot: f.root,
    });
    assert.equal(exitCode, 1);
    assert.equal(result.status, "incomplete");
    assert.ok(result.errors.length > 0);
    assert.equal(result.beforePolicyReevaluation, undefined);
  });
}
test("historical dependency edits are rejected before a changed legacy module can be imported", async (t) => {
  const f = await historicalComparisonFixture(t);
  const validator = path.join(
    f.root,
    "scripts/verify-shopping-performance-evidence.mjs",
  );
  await writeFile(
    validator,
    Buffer.concat([
      await readFile(validator),
      Buffer.from("\nglobalThis.__untrustedLegacyPolicyExecuted = true;\n"),
    ]),
  );
  delete globalThis.__untrustedLegacyPolicyExecuted;
  await assert.rejects(
    loadBeforePolicyBridge({
      beforeRoot: f.beforeRoot,
      afterRoot: f.afterRoot,
      beforePolicyRoot: f.root,
      currentPolicyPath: f.currentPolicyPath,
      profile: "completion",
    }),
    /not clean/,
  );
  assert.equal(globalThis.__untrustedLegacyPolicyExecuted, undefined);
});
test("historical root HEAD must match the producer and PR2 cannot be reused as completion10", async (t) => {
  const f = await historicalComparisonFixture(t);
  await f.change("before", (data) => {
    data.productCommit = "d".repeat(40);
  });
  await assert.rejects(
    loadBeforePolicyBridge({
      beforeRoot: f.beforeRoot,
      afterRoot: f.afterRoot,
      beforePolicyRoot: f.root,
      currentPolicyPath: f.currentPolicyPath,
      profile: "completion",
    }),
    /HEAD differs/,
  );
  await f.change("before", (data) => {
    data.productCommit = f.git("rev-parse", "HEAD");
    Object.assign(data, f.legacyPolicy.performanceSamplingMetadata("pr"));
    data.acceptanceCriteriaByGroup =
      f.legacyPolicy.performanceAcceptanceCriteriaByGroupForProfile("pr");
  });
  await assert.rejects(
    loadBeforePolicyBridge({
      beforeRoot: f.beforeRoot,
      afterRoot: f.afterRoot,
      beforePolicyRoot: f.root,
      currentPolicyPath: f.currentPolicyPath,
      profile: "completion",
    }),
    /mixed completion/,
  );
});
