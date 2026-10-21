#!/usr/bin/env node
// Comparing complete failed measurements never changes their acceptance verdict.
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  conditionKey,
  expectedConditions,
  INSTRUMENT_VERSION,
  validateEvidenceArtifact,
  verifyFrameFiles,
} from "./verify-shopping-performance-evidence.mjs";
const groups = ["shopping", "range", "drag", "transfer"];
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
export function comparableMetrics(artifact, group) {
  validateEvidenceArtifact(artifact, group, {}, { enforceBudgets: false });
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
async function readRun(runRoot, phase) {
  const bytes = await readFile(path.join(runRoot, "run-result.json"));
  const run = JSON.parse(bytes.toString("utf8"));
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
  const rows = new Map(),
    artifacts = new Map(),
    sourceHashes = { "run-result.json": hash(bytes) };
  for (const group of groups) {
    const reportBytes = await readFile(
      path.join(runRoot, group, "report.json"),
    );
    sourceHashes[`${group}/report.json`] = hash(reportBytes);
    const report = JSON.parse(reportBytes.toString("utf8"));
    assert(
      Array.isArray(report.errors) && report.errors.length === 0,
      `${phase}/${group}: incomplete report`,
    );
    assert(
      report.config?.workers === 1 &&
        report.config.projects?.length === 1 &&
        report.config.projects[0].retries === 0,
      `${phase}/${group}: worker/retry mismatch`,
    );
    const expected = expectedConditions(group).flatMap((condition) =>
      (group === "transfer" ? ["response", "frame"] : ["response"]).map(
        (kind) => `${kind}:${conditionKey(condition, group)}`,
      ),
    );
    const tests = collect(report.suites);
    assert(
      tests.length === expected.length,
      `${phase}/${group}: missing expected tests`,
    );
    const seen = new Set();
    for (const { spec, test } of tests) {
      assert(
        path.basename(spec.file ?? "") === specs[group] &&
          test.expectedStatus === "passed" &&
          test.results?.length === 1 &&
          test.results[0].retry === 0 &&
          ["passed", "failed"].includes(test.results[0].status),
        `${phase}/${group}: skipped, retried or incomplete test`,
      );
      const matches = (test.results[0].attachments ?? []).filter(
        (attachment) => attachment.name === names[group],
      );
      assert(
        matches.length === 1,
        `${phase}/${group}: normal artifact missing or duplicated`,
      );
      const attachment = matches[0];
      assert(
        attachment.contentType === "application/json",
        `${phase}/${group}: wrong attachment content type`,
      );
      let body = attachment.body
        ? Buffer.from(attachment.body, "base64")
        : undefined;
      if (attachment.path) {
        const actual = await realpath(attachment.path),
          output = await realpath(path.join(runRoot, group, "test-results"));
        assert(inside(output, actual), `${phase}/${group}: escaped attachment`);
        const disk = await readFile(actual);
        assert(
          !body || body.equals(disk),
          `${phase}/${group}: attachment mismatch`,
        );
        body = disk;
        sourceHashes[`${group}/${path.relative(output, actual)}`] = hash(body);
      }
      assert(body, `${phase}/${group}: empty artifact`);
      const artifact = JSON.parse(body.toString("utf8"));
      const checked = validateEvidenceArtifact(
        artifact,
        group,
        { phase, runId: run.runId },
        { enforceBudgets: false },
      );
      assert(
        expected.includes(checked.key) && !seen.has(checked.key),
        `${phase}/${group}: duplicate or foreign condition`,
      );
      seen.add(checked.key);
      if (group === "transfer" && artifact.measurementKind === "frame")
        await verifyFrameFiles(
          artifact,
          path.join(runRoot, group, "test-results"),
          sourceHashes,
        );
      const artifactKey = `${group}:${checked.key}`;
      artifacts.set(artifactKey, artifact);
      for (const metric of comparableMetrics(artifact, group)) {
        const key = `${artifactKey}:${metric.operation}:${metric.metric}`;
        assert(!rows.has(key), `${phase}: duplicate metric`);
        rows.set(key, {
          group,
          condition: checked.condition,
          measurementKind: artifact.measurementKind,
          ...metric,
        });
      }
    }
    assert(
      expected.every((key) => seen.has(key)),
      `${phase}/${group}: incomplete conditions`,
    );
  }
  return { run, rows, artifacts, sourceHashes };
}
export async function compareBrowserEvidence({
  beforeRoot,
  afterRoot,
  output,
}) {
  const result = {
    schemaVersion: 1,
    status: "incomplete",
    errors: [],
    absoluteStatus: "not-evaluated",
    deltaStatus: "not-evaluated",
    rows: [],
  };
  try {
    const before = await readRun(path.resolve(beforeRoot), "before"),
      after = await readRun(path.resolve(afterRoot), "after");
    for (const field of ["instrumentVersion"])
      assert(
        before.run[field] === after.run[field],
        `Before/after ${field} mismatch`,
      );
    for (const field of ["instrumentPatch", "fixtureSources"])
      assert(
        before.run[field].sha256 === after.run[field].sha256,
        `Before/after ${field} mismatch`,
      );
    for (const field of [
      "platform",
      "arch",
      "node",
      "ci",
      "baseURL",
      "browserChannel",
      "headed",
      "build",
      "workerCount",
    ]) {
      assert(
        Object.hasOwn(before.run.environment, field) &&
          Object.hasOwn(after.run.environment, field),
        `Environment ${field} missing`,
      );
      assert(
        before.run.environment[field] === after.run.environment[field],
        `Before/after environment ${field} mismatch`,
      );
    }
    assert(
      before.rows.size === after.rows.size,
      "Before/after metric coverage differs",
    );
    for (const [key, oldArtifact] of before.artifacts) {
      const newArtifact = after.artifacts.get(key);
      assert(newArtifact, `Missing after artifact ${key}`);
      assert(
        oldArtifact.fixture?.fixtureHash === newArtifact.fixture?.fixtureHash,
        `Fixture mismatch ${key}`,
      );
      for (const field of [
        "browserVersion",
        "userAgent",
        "viewport",
        "devicePixelRatio",
        "browserChannel",
        "headed",
      ]) {
        const a = oldArtifact.environment?.[field] ?? oldArtifact[field],
          b = newArtifact.environment?.[field] ?? newArtifact[field];
        assert(
          JSON.stringify(a) === JSON.stringify(b),
          `Artifact environment ${field} mismatch ${key}`,
        );
      }
    }
    for (const [key, oldMetric] of before.rows) {
      const current = after.rows.get(key);
      assert(current, `Missing after metric ${key}`);
      const auxiliary = current.auxiliary;
      result.rows.push({
        group: current.group,
        condition: current.condition,
        measurementKind: current.measurementKind,
        operation: current.operation,
        metric: current.metric,
        auxiliary,
        before: oldMetric.summary,
        after: current.summary,
        deltaMs: {
          median: current.summary.medianMs - oldMetric.summary.medianMs,
          p95: current.summary.p95Ms - oldMetric.summary.p95Ms,
        },
        beforeAbsolute: auxiliary
          ? "not-applicable"
          : oldMetric.summary.medianMs <= 55 && oldMetric.summary.p95Ms <= 100
            ? "passed"
            : "failed",
        afterAbsolute: auxiliary
          ? "not-applicable"
          : current.summary.medianMs <= 55 && current.summary.p95Ms <= 100
            ? "passed"
            : "failed",
        deltaReview:
          current.summary.medianMs > oldMetric.summary.medianMs ||
          current.summary.p95Ms > oldMetric.summary.p95Ms
            ? "increase-needs-review"
            : "no-increase",
      });
    }
    result.absoluteStatus = result.rows.some(
      (row) => row.afterAbsolute === "failed",
    )
      ? "failed"
      : "passed";
    result.deltaStatus = result.rows.some(
      (row) => row.deltaReview === "increase-needs-review",
    )
      ? "review-required"
      : "no-increase";
    result.status = "complete";
    result.before = {
      runRoot: path.resolve(beforeRoot),
      runId: before.run.runId,
      productCommit: before.run.productCommit,
      sourceHashes: before.sourceHashes,
    };
    result.after = {
      runRoot: path.resolve(afterRoot),
      runId: after.run.runId,
      productCommit: after.run.productCommit,
      sourceHashes: after.sourceHashes,
    };
    result.comparison = {
      instrumentVersion: before.run.instrumentVersion,
      instrumentPatch: before.run.instrumentPatch,
      fixtureSources: before.run.fixtureSources,
      environment: before.run.environment,
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
