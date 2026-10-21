import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  comparableFixtureIdentity,
  comparableMetrics,
  compareBrowserEvidence,
} from "./compare-shopping-browser-evidence.mjs";
import {
  evidenceIdentity,
  summarizeSamples,
  validateEvidenceArtifact,
} from "./verify-shopping-performance-evidence.mjs";
import { expectedPerformanceConditions } from "./shopping-performance-evidence-contract.mjs";
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
  assert.ok(rows[0].summary.medianMs > 55);
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
    instrumentVersion: "shopping-rendering-v1",
    instrumentPatch: { sha256: (options.instrumentHash ?? "a").repeat(64) },
    fixtureSources: { sha256: "b".repeat(64) },
    productCommit: `${phase}-product`,
    releaseCapability: {
      kind: "event-shopping-planner-release-capabilities",
      version: 1,
      buildMode: "release-a",
      releaseChannel: "release-a",
      legacyLocalStorageCleanup: "forced-off",
      sourceState: "clean",
      sourceSha: "a".repeat(40),
      buildId: "a".repeat(40),
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
