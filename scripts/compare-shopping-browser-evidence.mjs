#!/usr/bin/env node
// Comparing complete failed measurements never changes their acceptance verdict.
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INSTRUMENT_VERSION,
  validateBaselineFrameObservationArtifact,
  verifyBaselineFrameObservationFiles,
  validateEvidenceArtifact,
  validateBrowserArtifactEnvironment,
  verifyFrameFiles,
} from "./verify-shopping-performance-evidence.mjs";
import {
  expectedPerformanceCases,
  performanceGroupSpecs,
  expectedTransferMetricNames,
  performanceAcceptanceCriteriaByGroup,
  performanceAcceptanceCriteriaForGroup,
  validateRunAcceptanceCriteriaMetadata,
} from "./shopping-performance-evidence-contract.mjs";
import { validateBrowserSourceIdentity } from "./run-shopping-browser-evidence.mjs";
const groups = ["shopping", "range", "drag", "transfer"];
const names = {
  shopping: "shopping-operation-timings",
  range: "edit-execute-range-selection-timings",
  drag: "shopping-drag-response",
  transfer: "shopping-transfer-rendering",
};
const specs = performanceGroupSpecs;
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function collect(suites, result = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) result.push({ spec, test });
    collect(suite.suites, result);
  }
  return result;
}
function inside(root, file) {
  const relative = path.relative(root, file);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
// Compare the actual restored payloads, including every isolated accepted sample.
// Source hashes alone cannot detect a different fixture supplied at runtime.
export function comparableFixtureIdentity(artifact, group) {
  const validHash = (value) =>
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const fixture = artifact.fixture;
  if (group !== "transfer") {
    if (fixture?.fixtureHash === undefined) return null;
    assert(validHash(fixture.fixtureHash), "invalid fixture hash");
    return { kind: "single", hash: fixture.fixtureHash };
  }
  if (Object.hasOwn(artifact, "fixtures")) {
    assert(
      Array.isArray(artifact.fixtures),
      "isolated fixtures must be an array",
    );
    assert(!fixture, "ambiguous single and isolated fixtures");
    const fixtures = artifact.fixtures;
    assert(fixtures.length >= 20, "isolated fixture identities are incomplete");
    const hashes = fixtures.map((entry, index) => {
      assert(
        entry?.index === index + 1 && validHash(entry.fixtureHash),
        "isolated fixture index or hash is invalid",
      );
      return entry.fixtureHash;
    });
    for (const [name, metric] of Object.entries(artifact.metrics ?? {})) {
      assert(
        Array.isArray(metric.samples) &&
          metric.samples.length === hashes.length,
        `${name}: isolated fixture/sample counts differ`,
      );
      metric.samples.forEach((sample, index) =>
        assert(
          sample.fixtureHash === hashes[index],
          `${name}: sample fixture hash does not match its restored fixture`,
        ),
      );
    }
    return { kind: "isolated", hashes };
  }
  assert(
    validHash(fixture?.fixtureHash),
    "actual transfer fixture hash is missing",
  );
  return { kind: "single", hash: fixture.fixtureHash };
}

export function comparableMetrics(artifact, group, identity = {}) {
  validateEvidenceArtifact(artifact, group, identity, {
    enforceBudgets: false,
    requireCurrentCriteria: false,
    allowBaselinePostconditionFailures: true,
  });
  const metrics = [];
  const add = (operation, metric, summary, auxiliary = false) =>
    metrics.push({ operation, metric, summary, auxiliary });
  if (group === "shopping")
    for (const operation of Object.keys(artifact.timings)) {
      add(operation, "legacy", artifact.summary[operation]);
      add(operation, "ui", artifact.uiSummary[operation]);
    }
  else if (group === "range")
    for (const operation of Object.keys(artifact.timings))
      add(operation, "response", artifact.summary[operation]);
  else if (group === "drag")
    for (const [operation, value] of Object.entries(artifact.records))
      add(operation, "response", {
        count: value.count,
        medianMs: value.medianMs,
        p95Ms: value.p95Ms,
      });
  else
    for (const [operation, value] of Object.entries(artifact.metrics))
      add(
        operation,
        artifact.measurementKind,
        value.summary,
        operation === "save",
      );
  return metrics;
}
// Strict artifact validation precedes this shared reporting step. Partial frame
// samples keep their original indices and remain functional failures in either path.
export function comparisonFunctionalFailure(artifact, group, key, phase) {
  if (!artifact.postconditionErrors?.length) return null;
  return {
    record: { group, key, postconditionErrors: artifact.postconditionErrors },
    message: `${phase}/${group}/${key}: completed timings retained with failed functional postconditions`,
  };
}
function recordedCriteria(run) {
  return {
    acceptanceCriteriaByGroup: run.acceptanceCriteriaByGroup ?? null,
    acceptanceCriteriaDate: run.acceptanceCriteriaDate ?? null,
    acceptanceThresholds: run.acceptanceThresholds ?? null,
    originalStatus: run.status ?? null,
  };
}
async function readRun(runRoot, phase) {
  const bytes = await readFile(path.join(runRoot, "run-result.json"));
  const run = JSON.parse(bytes.toString("utf8"));
  validateRunAcceptanceCriteriaMetadata(run);
  assert(
    run.phase === phase &&
      typeof run.runId === "string" &&
      run.runId.length > 0,
    `${phase}: missing run identity`,
  );
  assert(
    run.instrumentVersion === INSTRUMENT_VERSION,
    `${phase}: unknown instrumentVersion`,
  );
  for (const field of ["instrumentPatch", "fixtureSources"])
    assert(
      /^[a-f0-9]{64}$/.test(run[field]?.sha256 ?? ""),
      `${phase}: missing ${field} hash`,
    );
  assert(
    run.productCommit && run.environment,
    `${phase}: provenance is incomplete`,
  );
  for (const field of [
    "platform",
    "osRelease",
    "osVersion",
    "arch",
    "node",
    "baseURL",
    "build",
  ])
    assert(
      typeof run.environment[field] === "string" &&
        run.environment[field].length > 0,
      `${phase}: actual environment ${field} is missing`,
    );
  validateBrowserArtifactEnvironment({
    ...run.environment,
    workers: run.environment.workerCount,
    retries: 0,
  });
  const capability = run.releaseCapability;
  assert(
    capability?.kind === "event-shopping-planner-release-capabilities" &&
      capability.version === 1 &&
      capability.buildMode === "release-a" &&
      capability.releaseChannel === "release-a" &&
      capability.legacyLocalStorageCleanup === "forced-off" &&
      capability.sourceState === "clean" &&
      /^[a-f0-9]{40}$/.test(capability.sourceSha ?? "") &&
      /^[a-f0-9]{40}$/.test(capability.buildId ?? "") &&
      /^[a-f0-9]{64}$/.test(run.releaseCapabilitySha256 ?? ""),
    `${phase}: actual clean release-a capability is missing or invalid`,
  );
  assert(
    typeof run.releaseCapabilityRaw === "string" &&
      hash(Buffer.from(run.releaseCapabilityRaw, "utf8")) ===
        run.releaseCapabilitySha256 &&
      JSON.stringify(JSON.parse(run.releaseCapabilityRaw)) ===
        JSON.stringify(capability),
    `${phase}: raw local release capability/hash mismatch`,
  );
  assert(
    ["explicit", "playwright-webServer"].includes(
      run.environment.previewSource,
    ),
    `${phase}: preview source metadata missing`,
  );
  if (run.environment.previewSource === "explicit")
    assert(
      typeof run.servedReleaseCapabilityRaw === "string" &&
        run.servedReleaseCapabilityRaw === run.releaseCapabilityRaw &&
        run.servedReleaseCapabilitySha256 === run.releaseCapabilitySha256,
      `${phase}: served preview capability differs from the measured release build`,
    );
  validateBrowserSourceIdentity(run);
  const rows = new Map(),
    artifacts = new Map(),
    sourceHashes = { "run-result.json": hash(bytes) },
    errors = [],
    functionalFailures = [],
    baselineObservations = new Map();
  for (const group of groups) {
    const definitions = expectedPerformanceCases(group),
      expected = definitions.map((row) => row.key),
      seen = new Set();
    try {
      const reportBytes = await readFile(
        path.join(runRoot, group, "report.json"),
      );
      sourceHashes[`${group}/report.json`] = hash(reportBytes);
      const report = JSON.parse(reportBytes.toString("utf8"));
      assert(
        Array.isArray(report.errors) && report.errors.length === 0,
        "incomplete report",
      );
      assert(
        report.config?.workers === 1 &&
          report.config.projects?.length === 1 &&
          report.config.projects[0].retries === 0,
        "worker/retry mismatch",
      );
      const tests = collect(report.suites);
      if (tests.length !== expected.length)
        errors.push(
          `${phase}/${group}: expected ${expected.length} tests, found ${tests.length}`,
        );
      for (const { spec, test } of tests)
        try {
          assert(
            specs[group].includes(path.basename(spec.file ?? "")) &&
              test.expectedStatus === "passed" &&
              test.results?.length === 1 &&
              test.results[0].retry === 0 &&
              ["passed", "failed"].includes(test.results[0].status),
            "skipped, retried or incomplete test",
          );
          const matches = (test.results[0].attachments ?? []).filter(
            (attachment) => attachment.name === names[group],
          );
          assert(matches.length === 1, "normal artifact missing or duplicated");
          const attachment = matches[0];
          assert(
            attachment.contentType === "application/json",
            "wrong attachment content type",
          );
          let body = attachment.body
            ? Buffer.from(attachment.body, "base64")
            : undefined;
          if (attachment.path) {
            const actual = await realpath(attachment.path),
              output = await realpath(
                path.join(runRoot, group, "test-results"),
              );
            assert(inside(output, actual), "escaped attachment");
            const disk = await readFile(actual);
            assert(!body || body.equals(disk), "attachment mismatch");
            body = disk;
            sourceHashes[`${group}/${path.relative(output, actual)}`] =
              hash(body);
          }
          assert(body, "empty artifact");
          const artifact = JSON.parse(body.toString("utf8"));
          if (
            phase === "before" &&
            group === "transfer" &&
            artifact.measurementKind === "frame" &&
            artifact.baselineFrameObservations?.some(
              (entry) => entry.outcome === "endpoint-unobservable",
            )
          ) {
            assert(
              test.results[0].status === "failed",
              "unobservable baseline artifact must retain its failed producer result",
            );
            const observed = validateBaselineFrameObservationArtifact(
              artifact,
              {
                phase,
                runId: run.runId,
                productCommit: run.productCommit,
              },
            );
            assert(
              expected.includes(observed.key) &&
                definitions.find((row) => row.key === observed.key)?.spec ===
                  path.basename(spec.file ?? "") &&
                !seen.has(observed.key),
              "duplicate, foreign baseline observation or wrong spec",
            );
            const output = path.join(runRoot, group, "test-results");
            await verifyFrameFiles(artifact, output, sourceHashes);
            await verifyBaselineFrameObservationFiles(
              artifact,
              output,
              sourceHashes,
            );
            const artifactKey = `${group}:${observed.key}`;
            baselineObservations.set(artifactKey, observed);
            const functional = comparisonFunctionalFailure(
              artifact,
              group,
              observed.key,
              phase,
            );
            if (functional) {
              functionalFailures.push(functional.record);
              errors.push(functional.message);
            }
            artifacts.set(artifactKey, artifact);
            seen.add(observed.key);
            continue;
          }
          const checked = validateEvidenceArtifact(
            artifact,
            group,
            { phase, runId: run.runId, productCommit: run.productCommit },
            {
              enforceBudgets: false,
              requireCurrentCriteria: false,
              allowBaselinePostconditionFailures: true,
            },
          );
          assert(
            expected.includes(checked.key) &&
              definitions.find((row) => row.key === checked.key)?.spec ===
                path.basename(spec.file ?? "") &&
              !seen.has(checked.key),
            "duplicate, foreign condition or wrong spec",
          );
          if (group === "transfer" && artifact.measurementKind === "frame")
            await verifyFrameFiles(
              artifact,
              path.join(runRoot, group, "test-results"),
              sourceHashes,
            );
          seen.add(checked.key);
          comparableFixtureIdentity(artifact, group);
          const artifactKey = `${group}:${checked.key}`;
          const functional = comparisonFunctionalFailure(
            artifact,
            group,
            checked.key,
            phase,
          );
          if (functional) {
            functionalFailures.push(functional.record);
            errors.push(functional.message);
          }
          artifacts.set(artifactKey, artifact);
          for (const metric of comparableMetrics(artifact, group, {
            phase,
            runId: run.runId,
            productCommit: run.productCommit,
          })) {
            const key = `${artifactKey}:${metric.operation}:${metric.metric}`;
            assert(!rows.has(key), "duplicate metric");
            rows.set(key, {
              group,
              condition: checked.condition,
              measurementKind: artifact.measurementKind,
              ...metric,
            });
          }
        } catch (error) {
          errors.push(
            `${phase}/${group}/${spec.title ?? spec.file ?? "unknown"}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
    } catch (error) {
      errors.push(
        `${phase}/${group}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const key of expected)
      if (!seen.has(key))
        errors.push(`${phase}/${group}: unavailable normal evidence ${key}`);
  }
  return {
    run,
    rows,
    artifacts,
    sourceHashes,
    errors,
    functionalFailures,
    baselineObservations,
  };
}
function expectedMetricRows() {
  return groups.flatMap((group) =>
    expectedPerformanceCases(group).flatMap((testCase) => {
      let metrics;
      if (group === "shopping")
        metrics = [
          "execute",
          "executeRecord",
          "focus",
          "record",
          "next",
          "back",
        ].flatMap((operation) =>
          ["legacy", "ui"].map((metric) => ({
            operation,
            metric,
            auxiliary: false,
          })),
        );
      else if (group === "range")
        metrics = [
          "firstEndpoint",
          "secondEndpoint",
          "selectRange",
          "clearRange",
        ].map((operation) => ({
          operation,
          metric: "response",
          auxiliary: false,
        }));
      else if (group === "drag")
        metrics = [
          "same-boundary",
          "boundary-switch",
          "multiple-merges",
          "mixed",
          "offscreen-merge",
          "auto-scroll",
          ...(!testCase.condition.grouped ? ["rejected"] : []),
          "drop",
        ].map((operation) => ({
          operation,
          metric: "response",
          auxiliary: false,
        }));
      else
        metrics = expectedTransferMetricNames(
          testCase.condition,
          testCase.measurementKind,
        ).map((operation) => ({
          operation,
          metric: testCase.measurementKind,
          auxiliary: operation === "save",
        }));
      return metrics.map((metric) => ({
        key: `${group}:${testCase.key}:${metric.operation}:${metric.metric}`,
        artifactKey: `${group}:${testCase.key}`,
        group,
        condition: testCase.condition,
        measurementKind: testCase.measurementKind,
        ...metric,
      }));
    }),
  );
}
export async function compareBrowserEvidence({
  beforeRoot,
  afterRoot,
  output,
}) {
  const result = {
    schemaVersion: 1,
    acceptanceCriteriaByGroup: performanceAcceptanceCriteriaByGroup,
    status: "incomplete",
    errors: [],
    absoluteStatus: "not-evaluated",
    deltaStatus: "not-evaluated",
    rows: [],
  };
  try {
    const before = await readRun(path.resolve(beforeRoot), "before"),
      after = await readRun(path.resolve(afterRoot), "after");
    const compatibility = [];
    if (before.run.instrumentVersion !== after.run.instrumentVersion)
      compatibility.push("instrumentVersion mismatch");
    for (const field of ["instrumentPatch", "fixtureSources"])
      if (before.run[field].sha256 !== after.run[field].sha256)
        compatibility.push(`${field} mismatch`);
    for (const field of [
      "platform",
      "osRelease",
      "osVersion",
      "browserVersion",
      "userAgent",
      "viewport",
      "devicePixelRatio",
      "arch",
      "node",
      "ci",
      "baseURL",
      "previewSource",
      "browserChannel",
      "headed",
      "build",
      "workerCount",
    ])
      if (
        !Object.hasOwn(before.run.environment, field) ||
        !Object.hasOwn(after.run.environment, field) ||
        JSON.stringify(before.run.environment[field]) !==
          JSON.stringify(after.run.environment[field])
      )
        compatibility.push(`environment ${field} mismatch or missing`);
    result.errors.push(...before.errors, ...after.errors, ...compatibility);
    for (const descriptor of expectedMetricRows()) {
      const oldMetric = before.rows.get(descriptor.key),
        current = after.rows.get(descriptor.key),
        baselineObservation = before.baselineObservations.get(
          descriptor.artifactKey,
        ),
        reasons = [...compatibility];
      if (!oldMetric)
        reasons.push(
          baselineObservation
            ? `before: ${baselineObservation.unobservableCount} of 20 frame endpoints were unobservable; no 20-frame timing can be inferred`
            : "before: complete matching normal metric unavailable; see before source errors",
        );
      if (!current)
        reasons.push(
          "after: complete matching normal metric unavailable; see after source errors",
        );
      const oldArtifact = before.artifacts.get(descriptor.artifactKey),
        newArtifact = after.artifacts.get(descriptor.artifactKey);
      if (oldArtifact && newArtifact) {
        if (
          JSON.stringify(
            baselineObservation
              ? { kind: "isolated", hashes: baselineObservation.fixtureHashes }
              : comparableFixtureIdentity(oldArtifact, descriptor.group),
          ) !==
          JSON.stringify(
            comparableFixtureIdentity(newArtifact, descriptor.group),
          )
        )
          reasons.push("fixture hash mismatch");
        for (const field of [
          "browserVersion",
          "userAgent",
          "viewport",
          "devicePixelRatio",
          "browserChannel",
          "headed",
        ]) {
          const a = oldArtifact.environment[field],
            b = newArtifact.environment[field];
          if (JSON.stringify(a) !== JSON.stringify(b))
            reasons.push(`artifact environment ${field} mismatch`);
        }
      }
      const criteria = performanceAcceptanceCriteriaForGroup(descriptor.group);
      const absolute = (metric) =>
        !metric
          ? "missing"
          : descriptor.auxiliary
            ? "not-applicable"
            : metric.summary.medianMs <=
                  criteria.acceptanceThresholds.medianMs &&
                metric.summary.p95Ms <= criteria.acceptanceThresholds.p95Ms
              ? "passed"
              : "failed";
      const compared = reasons.length === 0;
      const delta = compared
        ? {
            median: current.summary.medianMs - oldMetric.summary.medianMs,
            p95: current.summary.p95Ms - oldMetric.summary.p95Ms,
          }
        : null;
      result.rows.push({
        group: descriptor.group,
        ...criteria,
        condition: descriptor.condition,
        measurementKind: descriptor.measurementKind,
        operation: descriptor.operation,
        metric: descriptor.metric,
        auxiliary: descriptor.auxiliary,
        status: compared ? "compared" : "uncomparable",
        before: oldMetric?.summary ?? null,
        after: current?.summary ?? null,
        deltaMs: delta,
        beforeObservation: baselineObservation
          ? {
              attempted: baselineObservation.attempted,
              completedCount: baselineObservation.completedCount,
              unobservableCount: baselineObservation.unobservableCount,
              numericTimingAvailable: false,
            }
          : null,
        beforePostconditionErrors: oldArtifact?.postconditionErrors ?? [],
        beforeAbsolute: baselineObservation
          ? "unobservable"
          : absolute(oldMetric),
        afterAbsolute: absolute(current),
        deltaReview: !compared
          ? "uncomparable"
          : delta.median > 0 || delta.p95 > 0
            ? "increase-needs-review"
            : "no-increase",
        ...(reasons.length ? { reasons } : {}),
      });
    }
    const uncomparable = result.rows.filter(
      (row) => row.status === "uncomparable",
    ).length;
    result.absoluteStatus = result.rows.some(
      (row) => row.afterAbsolute === "missing",
    )
      ? "incomplete"
      : result.rows.some((row) => row.afterAbsolute === "failed")
        ? "failed"
        : "passed";
    result.deltaStatus = uncomparable
      ? "incomplete"
      : result.rows.some((row) => row.deltaReview === "increase-needs-review")
        ? "review-required"
        : "no-increase";
    result.status =
      uncomparable || result.errors.length ? "incomplete" : "complete";
    result.coverage = {
      expectedMetrics: result.rows.length,
      compared: result.rows.length - uncomparable,
      uncomparable,
      // These are two evidence axes, not a partition: one row may have an
      // observed-unobservable before endpoint and missing after evidence.
      baselineUnobservable: result.rows.filter(
        (row) => row.beforeObservation !== null,
      ).length,
      unmeasuredMissing: result.rows.filter(
        (row) =>
          row.status === "uncomparable" &&
          (row.afterAbsolute === "missing" ||
            (row.beforeAbsolute === "missing" &&
              row.beforeObservation === null)),
      ).length,
    };
    result.before = {
      runRoot: path.resolve(beforeRoot),
      runId: before.run.runId,
      productCommit: before.run.productCommit,
      recordedAcceptanceCriteria: recordedCriteria(before.run),
      sourceHashes: before.sourceHashes,
      errors: before.errors,
      functionalFailures: before.functionalFailures,
      baselineFrameObservations: [...before.baselineObservations.entries()].map(
        ([key, observation]) => ({ key, ...observation }),
      ),
    };
    result.after = {
      runRoot: path.resolve(afterRoot),
      runId: after.run.runId,
      productCommit: after.run.productCommit,
      recordedAcceptanceCriteria: recordedCriteria(after.run),
      sourceHashes: after.sourceHashes,
      errors: after.errors,
    };
    result.comparison = {
      instrumentVersion: before.run.instrumentVersion,
      instrumentPatch: before.run.instrumentPatch,
      fixtureSources: before.run.fixtureSources,
      environment: before.run.environment,
      compatibilityErrors: compatibility,
    };
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  if (output) {
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    assert(
      JSON.stringify(JSON.parse(await readFile(output, "utf8"))) ===
        JSON.stringify(result),
      "Comparison output round-trip failed",
    );
  }
  return {
    exitCode:
      result.status !== "complete" || result.absoluteStatus !== "passed"
        ? 1
        : 0,
    result,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2),
      options = {};
    assert(
      args.length === 6,
      "Usage: --before-root path --after-root path --output path",
    );
    for (let i = 0; i < args.length; i += 2) {
      assert(
        ["--before-root", "--after-root", "--output"].includes(args[i]) &&
          args[i + 1],
        "Invalid comparison argument",
      );
      const name = args[i]
        .slice(2)
        .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      assert(!Object.hasOwn(options, name), "Duplicate comparison argument");
      options[name] = args[i + 1];
    }
    const { exitCode, result } = await compareBrowserEvidence(options);
    process.stdout.write(
      `${JSON.stringify({ status: result.status, absoluteStatus: result.absoluteStatus, deltaStatus: result.deltaStatus, rows: result.rows.length, errors: result.errors })}\n`,
    );
    process.exitCode = exitCode;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
