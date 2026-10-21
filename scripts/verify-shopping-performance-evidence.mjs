#!/usr/bin/env node
// Acceptance-only validation. Never imported by the application bundle.
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_VERSION = 1;
export const INSTRUMENT_VERSION = "shopping-rendering-v1";
const ownPath = fileURLToPath(import.meta.url);
const groupSpecs = {
  shopping: "responsive-performance.spec.ts",
  range: "edit-execute-range-selection.spec.ts",
  drag: "shopping-cross-column-drag.spec.ts",
  transfer: "shopping-transfer-rendering.performance.spec.ts",
};
const attachmentNames = {
  shopping: "shopping-operation-timings",
  range: "edit-execute-range-selection-timings",
  drag: "shopping-drag-response",
  transfer: "shopping-transfer-rendering",
};
const forbiddenNames = new Set([
  "ESP_RANGE_CONTINUOUS_DIAGNOSTIC",
  "ESP_RANGE_INVALIDATION_DIAGNOSTIC",
  "ESP_RANGE_RENDER_DIAGNOSTICS",
  "ESP_RANGE_WARMUP_VISUAL",
  "ESP_RANGE_WARMUP_MOUSE",
  "ESP_DRAG_TRACE_STAGES",
  "ESP_DRAG_CPU_PROFILE",
  "ESP_DRAG_DROP_PROBE_COMPARE",
  "ESP_DRAG_BASELINE",
]);
export function rejectedDiagnosticEnvironment(env = process.env) {
  return Object.entries(env)
    .filter(
      ([name, value]) =>
        value !== undefined &&
        value !== null &&
        String(value).length > 0 &&
        (/^ESP_(?:PROFILE|DIAGNOSTIC)_/.test(name) || forbiddenNames.has(name)),
    )
    .map(([name]) => ({
      name,
      reason: "Diagnostic settings cannot be used for acceptance measurements",
    }));
}
export function evidenceIdentity(
  group,
  measurementKind = "response",
  env = process.env,
) {
  return {
    schemaVersion: SCHEMA_VERSION,
    instrumentVersion: INSTRUMENT_VERSION,
    phase: env.ESP_EVIDENCE_PHASE ?? "standalone",
    runId: env.ESP_EVIDENCE_RUN_ID ?? "standalone",
    group,
    measurementKind,
    diagnosticOnly: false,
    acceptanceMeasurement: true,
  };
}
export function summarizeSamples(raw) {
  if (
    !Array.isArray(raw) ||
    raw.length < 20 ||
    raw.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0)
  )
    throw new Error("At least 20 finite non-negative raw samples are required");
  const sorted = [...raw].sort((a, b) => a - b);
  return {
    count: raw.length,
    medianMs:
      (sorted[Math.floor((raw.length - 1) / 2)] +
        sorted[Math.floor(raw.length / 2)]) /
      2,
    p95Ms: sorted[Math.ceil(raw.length * 0.95) - 1],
  };
}
function assert(check, message) {
  if (!check) throw new Error(message);
}
function keysEqual(value, expected, label) {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} is missing`,
  );
  assert(
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expected].sort()),
    `${label} has missing or unexpected operations`,
  );
}
function sameNumber(a, b) {
  return typeof a === "number" && Number.isFinite(a) && Math.abs(a - b) < 1e-8;
}
function validateMetric(raw, summary, label, threshold = true) {
  const calculated = summarizeSamples(raw);
  for (const field of ["count", "medianMs", "p95Ms"])
    assert(
      sameNumber(summary?.[field], calculated[field]),
      `${label}: raw/summary ${field} mismatch`,
    );
  if (threshold) {
    assert(calculated.medianMs <= 55, `${label}: median exceeds 55ms`);
    assert(calculated.p95Ms <= 100, `${label}: p95 exceeds 100ms`);
  }
}
export function expectedConditions(group) {
  const rows = [];
  if (group === "shopping")
    for (const count of [150, 500, 1500])
      for (const concentrated of [false, true])
        for (const mapVisible of [false, true])
          for (const layout of ["pc", "smartphone"])
            rows.push({ count, concentrated, mapVisible, layout });
  if (group === "range")
    for (const renderer of ["auto", "full", "virtual"])
      for (const count of [150, 500])
        for (const layout of renderer === "virtual"
          ? ["smartphone"]
          : ["pc", "smartphone"])
          for (const rangeLength of ["short", "long"])
            rows.push({ count, layout, renderer, rangeLength });
  if (group === "drag")
    for (const count of [150, 500])
      for (const input of ["native", "touch"])
        for (const grouped of [false, true])
          rows.push({ count, input, grouped });
  if (group === "transfer")
    for (const load of ["light", "practical"])
      for (const count of load === "light" ? [150, 500] : [500])
        for (const input of ["native", "touch"])
          for (const grouped of [false, true])
            for (const direction of [
              "candidate-to-execute",
              "execute-to-candidate",
            ])
              rows.push({ count, input, grouped, load, direction });
  assert(rows.length > 0, `Unknown performance group: ${group}`);
  return rows;
}
function conditionOf(artifact, group) {
  if (group === "range")
    return {
      ...artifact.environment,
      renderer: artifact.environment?.requestedRenderer,
    };
  if (group === "drag")
    return {
      count: artifact.fixture?.count,
      input: artifact.input,
      grouped: artifact.grouped,
    };
  return group === "transfer" ? artifact.condition : artifact;
}
export function conditionKey(condition, group) {
  return JSON.stringify(
    Object.keys(expectedConditions(group)[0]).map((key) => [
      key,
      condition?.[key],
    ]),
  );
}
export function validateEvidenceArtifact(artifact, group, identity = {}) {
  assert(
    artifact?.schemaVersion === SCHEMA_VERSION,
    "Unsupported or missing evidence schemaVersion",
  );
  assert(
    artifact.instrumentVersion === INSTRUMENT_VERSION,
    "Unsupported or missing instrumentVersion",
  );
  assert(artifact.group === group, "Evidence group mismatch");
  assert(
    artifact.diagnosticOnly === false &&
      artifact.acceptanceMeasurement === true,
    "Normal acceptance artifact required",
  );
  for (const key of ["phase", "runId"])
    if (identity[key] !== undefined)
      assert(artifact[key] === identity[key], `Evidence ${key} mismatch`);
  const kind = artifact.measurementKind;
  assert(
    kind === "response" || (group === "transfer" && kind === "frame"),
    "Invalid or mixed measurementKind",
  );
  const condition = conditionOf(artifact, group);
  const key = conditionKey(condition, group);
  assert(
    expectedConditions(group).some((row) => conditionKey(row, group) === key),
    "Unexpected performance condition",
  );
  if (Array.isArray(artifact.errors))
    assert(artifact.errors.length === 0, "Artifact contains page errors");
  if (group === "shopping") {
    const operations = [
      "execute",
      "executeRecord",
      "focus",
      "record",
      "next",
      "back",
    ];
    for (const name of [
      "timings",
      "summary",
      "uiTimings",
      "uiSummary",
      "uiSamples",
    ])
      keysEqual(artifact[name], operations, name);
    for (const op of operations) {
      validateMetric(
        artifact.timings[op],
        artifact.summary[op],
        `${op}/legacy`,
      );
      validateMetric(
        artifact.uiTimings[op],
        artifact.uiSummary[op],
        `${op}/ui`,
      );
      const samples = artifact.uiSamples[op];
      assert(
        Array.isArray(samples) &&
          samples.length === artifact.timings[op].length &&
          samples.length === artifact.uiTimings[op].length,
        `${op}: sample detail count mismatch`,
      );
      const sampleIds = new Set();
      samples.forEach((sample, i) => {
        assert(
          typeof sample.sampleId === "string" &&
            sample.sampleId.length > 0 &&
            !sampleIds.has(sample.sampleId),
          `${op}: missing or duplicate sampleId`,
        );
        sampleIds.add(sample.sampleId);
        assert(
          typeof sample.targetId === "string" &&
            sample.targetId.length > 0 &&
            sample.expected !== undefined &&
            sample.matched === true &&
            !sample.reason,
          `${op}: expected UI was not established`,
        );
        assert(
          sameNumber(sample.legacyMs, artifact.timings[op][i]) &&
            sameNumber(sample.uiMs, artifact.uiTimings[op][i]),
          `${op}: raw/detail mismatch`,
        );
      });
    }
  } else if (group === "range") {
    const ops = [
      "firstEndpoint",
      "secondEndpoint",
      "selectRange",
      "clearRange",
    ];
    keysEqual(artifact.timings, ops, "timings");
    keysEqual(artifact.summary, ops, "summary");
    for (const op of ops) {
      validateMetric(artifact.timings[op], artifact.summary[op], op);
      assert(
        Array.isArray(artifact.samples) &&
          artifact.samples.length === artifact.timings[op].length,
        `${op}: detail count mismatch`,
      );
      artifact.samples.forEach((sample, index) =>
        assert(
          sample.repeat === index &&
            sameNumber(sample.durations?.[op], artifact.timings[op][index]),
          `${op}: raw/detail mismatch`,
        ),
      );
    }
  } else if (group === "drag") {
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
    keysEqual(artifact.records, ops, "records");
    for (const op of ops)
      validateMetric(artifact.records[op]?.samples, artifact.records[op], op);
    assert(
      Array.isArray(artifact.start) &&
        artifact.start.length >= 20 &&
        Array.isArray(artifact.end) &&
        artifact.end.length === artifact.start.length,
      "Drag start/end details missing",
    );
  } else {
    const ops =
      kind === "response"
        ? ["response", "nextPending", "nextApplied", "save"]
        : ["frame"];
    keysEqual(artifact.metrics, ops, "metrics");
    for (const op of ops) {
      const metric = artifact.metrics[op];
      validateMetric(metric?.raw, metric?.summary, op, op !== "save");
      assert(
        Array.isArray(metric.samples) &&
          metric.samples.length === metric.raw.length,
        `${op}: detail count mismatch`,
      );
      metric.samples.forEach((sample, index) => {
        assert(
          sample.matched === true &&
            typeof sample.measurementId === "string" &&
            sample.measurementId.length > 0 &&
            typeof sample.targetId === "string" &&
            sample.targetId.length > 0 &&
            sameNumber(sample.durationMs, metric.raw[index]),
          `${op}: sample target or duration missing`,
        );
        if (kind === "frame")
          assert(
            sample.frameVerified === true &&
              sample.sourceAbsent === true &&
              sample.destinationOrderVerified === true &&
              sample.controlsVerified === true &&
              typeof sample.frameTimestampMs === "number" &&
              Number.isFinite(sample.frameTimestampMs),
            "Frame evidence is missing verified card content",
          );
      });
      assert(
        new Set(metric.samples.map((sample) => sample.measurementId)).size ===
          metric.samples.length,
        `${op}: duplicate samples`,
      );
    }
  }
  return { key: `${kind}:${key}`, condition, measurementKind: kind };
}
function collectTests(suites, list = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) list.push({ spec, test });
    collectTests(suite.suites, list);
  }
  return list;
}
function inside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
async function readAttachment(attachment, outputRoot, hashes) {
  assert(
    attachment.contentType === "application/json",
    "Acceptance attachment must be JSON",
  );
  let bytes;
  if (typeof attachment.body === "string")
    bytes = Buffer.from(attachment.body, "base64");
  if (typeof attachment.path === "string") {
    const actual = await realpath(path.resolve(attachment.path));
    const root = await realpath(outputRoot);
    assert(
      inside(root, actual),
      "Attachment escaped its group's test-results directory",
    );
    const disk = await readFile(actual);
    assert(!bytes || bytes.equals(disk), "Attachment body/file mismatch");
    bytes = disk;
    hashes[path.relative(outputRoot, actual)] = createHash("sha256")
      .update(bytes)
      .digest("hex");
  }
  assert(bytes, "Acceptance attachment is missing body/path");
  return JSON.parse(bytes.toString("utf8"));
}
async function writeResult(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  assert(
    JSON.stringify(JSON.parse(await readFile(filename, "utf8"))) ===
      JSON.stringify(value),
    "Saved evidence result could not be verified",
  );
}
export async function preflight({ env = process.env, runRoot } = {}) {
  const rejected = rejectedDiagnosticEnvironment(env);
  const result = { status: rejected.length ? "failed" : "passed", rejected };
  if (runRoot)
    await writeResult(path.join(runRoot, "preflight-result.json"), result);
  return result;
}
export async function verifyGroupEvidence({
  runRoot,
  group,
  phase,
  runId,
  write = true,
}) {
  assert(Object.hasOwn(groupSpecs, group), "Unknown evidence group");
  const groupRoot = path.join(runRoot, group);
  const result = {
    group,
    phase,
    runId,
    status: "failed",
    errors: [],
    artifacts: [],
    hashes: {},
  };
  try {
    assert(Object.hasOwn(groupSpecs, group), "Unknown evidence group");
    const reportPath = path.join(groupRoot, "report.json");
    const reportBytes = await readFile(reportPath);
    result.hashes["report.json"] = createHash("sha256")
      .update(reportBytes)
      .digest("hex");
    const report = JSON.parse(reportBytes.toString("utf8"));
    assert(
      Array.isArray(report.errors) && report.errors.length === 0,
      "Playwright report has errors or is incomplete",
    );
    assert(
      report.config?.workers === 1,
      "Performance collection must use one worker",
    );
    assert(
      Array.isArray(report.config?.projects) &&
        report.config.projects.length === 1 &&
        report.config.projects.every((p) => p.retries === 0),
      "Performance retries must be zero",
    );
    const tests = collectTests(report.suites);
    const expected = expectedConditions(group).flatMap((condition) =>
      (group === "transfer" ? ["response", "frame"] : ["response"]).map(
        (kind) => `${kind}:${conditionKey(condition, group)}`,
      ),
    );
    assert(
      tests.length === expected.length,
      `Expected ${expected.length} tests, found ${tests.length}`,
    );
    const seen = new Set();
    for (const { spec, test } of tests) {
      assert(
        path.basename(spec.file ?? "") === groupSpecs[group],
        "Unexpected test spec in performance group",
      );
      assert(
        spec.ok === true &&
          test.expectedStatus === "passed" &&
          test.status === "expected",
        "Skipped, failed or incomplete performance test",
      );
      assert(
        Array.isArray(test.results) &&
          test.results.length === 1 &&
          test.results[0].retry === 0 &&
          test.results[0].status === "passed",
        "Performance test retried, skipped or did not pass initially",
      );
      const attachments = test.results[0].attachments ?? [];
      const acceptance = attachments.filter(
        (a) => a.name === attachmentNames[group],
      );
      assert(
        acceptance.length === 1,
        "Missing or duplicate normal acceptance attachment",
      );
      const artifact = await readAttachment(
        acceptance[0],
        path.join(groupRoot, "test-results"),
        result.hashes,
      );
      const validated = validateEvidenceArtifact(artifact, group, {
        phase,
        runId,
      });
      assert(
        expected.includes(validated.key) && !seen.has(validated.key),
        "Duplicate or unexpected evidence condition",
      );
      seen.add(validated.key);
      result.artifacts.push(validated);
    }
    assert(
      expected.every((key) => seen.has(key)),
      "Missing expected performance conditions",
    );
    result.status = "passed";
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  if (write)
    await writeResult(
      path.join(groupRoot, "evidence-verification.json"),
      result,
    );
  return result;
}
function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(
      ["--run-root", "--group", "--phase", "--run-id"].includes(args[i]) &&
        args[i + 1],
      `Invalid option: ${args[i]}`,
    );
    const name = args[i]
      .slice(2)
      .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    assert(!Object.hasOwn(options, name), `Duplicate option: ${args[i]}`);
    options[name] = args[i + 1];
  }
  return options;
}
if (process.argv[1] && path.resolve(process.argv[1]) === ownPath) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const options = parseArgs(args);
    assert(
      command === "preflight" || command === "verify",
      "Usage: preflight [--run-root path] | verify --run-root path --group group --phase phase --run-id id",
    );
    if (command === "verify")
      for (const name of ["runRoot", "group", "phase", "runId"])
        assert(options[name], `Missing ${name}`);
    const result =
      command === "preflight"
        ? await preflight(options)
        : await verifyGroupEvidence(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === "passed" ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
