import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  expectedPerformanceCases,
  performanceConditionKey,
  validateAcceptanceCriteriaMetadata,
  validatePerformanceSamplingMetadata,
  performanceSamplingProfile,
} from "./shopping-performance-evidence-contract.mjs";
import { validateBaselineProductObservation } from "./baseline-shopping-performance-observations.mjs";

const assert = (value, message) => {
  if (!value) throw new Error(`Baseline frame observation: ${message}`);
};
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const hash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const unique = (value) =>
  Array.isArray(value) &&
  value.every(text) &&
  new Set(value).size === value.length;
const same = isDeepStrictEqual;
const keys = (value, expected) =>
  object(value) && same(Object.keys(value).sort(), [...expected].sort());
const filePair = (value, name) =>
  text(value[`${name}Path`]) && hash(value[`${name}Sha256`]);
const fileNames = [
  "trace",
  "baseline",
  "failedObservation",
  "failureScreenshot",
  "failureDom",
];
const outcomeFields = [
  "sampleIndex",
  "measurementId",
  "fixtureHash",
  "effectiveIds",
  "outcome",
];
const evidenceFields = [
  "postInput",
  "trusted",
  "matched",
  "startEpoch",
  "domMs",
  "markerDelayMs",
  "commits",
  "sourceRects",
  "targetRects",
  "captures",
  "inputMarkerCount",
  "inputMarker",
  "domMarker",
  "durableProof",
  "scenarioEvidence",
  "expectedTransferredIds",
  ...fileNames.flatMap((name) => [`${name}Path`, `${name}Sha256`]),
  "guard",
  "candidateCount",
  "referencePath",
  "referenceSha256",
  "verificationPath",
  "verificationSha256",
];
const rectangle = (rect) =>
  object(rect) &&
  text(rect.itemId) &&
  ["x", "y", "width", "height"].every((key) => finite(rect[key])) &&
  rect.width > 0 &&
  rect.height >= 0;
const marker = (value) =>
  keys(value, ["pid", "ts"]) &&
  Number.isSafeInteger(value.pid) &&
  value.pid >= 0 &&
  finite(value.ts) &&
  value.ts >= 0;

function validateFailedEvidence(observation, fixture, condition) {
  const failure = observation.failure;
  assert(
    keys(failure, ["code", "message", "evidence"]) && text(failure.message),
    "failed outcome fields are invalid",
  );
  assert(
    ["identity-clipped", "no-content-verified-frame"].includes(failure.code),
    "unknown frame endpoint failure",
  );
  const evidence = failure.evidence;
  assert(
    object(evidence) &&
      Object.keys(evidence).every((key) => evidenceFields.includes(key)),
    "failed evidence fields are invalid",
  );
  assert(
    evidence.postInput === true &&
      evidence.trusted === true &&
      evidence.matched === true,
    "trusted matched post-input witness is required",
  );
  assert(
    finite(evidence.startEpoch) &&
      evidence.startEpoch >= 0 &&
      finite(evidence.domMs) &&
      evidence.domMs >= 0 &&
      finite(evidence.markerDelayMs) &&
      evidence.markerDelayMs >= 0,
    "invalid input/DOM clocks",
  );
  assert(
    evidence.inputMarkerCount === 1 &&
      marker(evidence.inputMarker) &&
      marker(evidence.domMarker) &&
      evidence.inputMarker.pid === evidence.domMarker.pid &&
      evidence.domMarker.ts >= evidence.inputMarker.ts,
    "input and DOM marker tuples must be unique and ordered in one process",
  );
  assert(
    Array.isArray(evidence.commits) && evidence.commits.length === 1,
    "accepted move must have one actual transaction",
  );
  const commit = evidence.commits[0];
  assert(
    object(commit) &&
      finite(commit.at) &&
      commit.at >= evidence.startEpoch &&
      unique(commit.stores) &&
      commit.stores.length > 0 &&
      Array.isArray(commit.writes) &&
      (commit.operationId === undefined ||
        commit.operationId === null ||
        text(commit.operationId)),
    "invalid actual durable transaction",
  );
  for (const [name, roles] of [
    ["sourceRects", ["source-origin", "source-gap"]],
    ["targetRects", ["destination-card"]],
  ]) {
    const rects = evidence[name];
    assert(
      Array.isArray(rects) &&
        rects.length > 0 &&
        rects.every(
          (rect) =>
            rectangle(rect) &&
            roles.includes(rect.role) &&
            observation.effectiveIds.includes(rect.itemId),
        ) &&
        unique(rects.map((rect) => rect.itemId)),
      `invalid ${name} identity/geometry`,
    );
  }
  assert(
    same(
      evidence.targetRects.map((rect) => rect.itemId).sort(),
      [...observation.effectiveIds].sort(),
    ),
    "all three destination identities must have actual rectangles",
  );
  if (failure.code === "identity-clipped") {
    assert(
      keys(evidence.guard, [
        "itemId",
        "actualHeight",
        "minimumHeightExclusive",
      ]) &&
        evidence.guard.minimumHeightExclusive === 20 &&
        finite(evidence.guard.actualHeight) &&
        evidence.guard.actualHeight >= 0 &&
        evidence.guard.actualHeight <= 20 &&
        evidence.targetRects.some(
          (rect) =>
            rect.itemId === evidence.guard.itemId &&
            rect.height === evidence.guard.actualHeight,
        ),
      "clipped-identity guard is not true in observed geometry",
    );
    assert(
      evidence.candidateCount === undefined,
      "clipped-identity guard cannot claim candidate verification",
    );
  } else {
    assert(
      evidence.guard === undefined &&
        Number.isSafeInteger(evidence.candidateCount) &&
        evidence.candidateCount >= 0 &&
        filePair(evidence, "reference") &&
        filePair(evidence, "verification"),
      "no-content endpoint requires actual reference/candidate verification evidence",
    );
  }
  for (const name of fileNames)
    assert(filePair(evidence, name), `missing ${name} file/hash`);
  for (const name of ["reference", "verification"])
    assert(
      (evidence[`${name}Path`] === undefined &&
        evidence[`${name}Sha256`] === undefined) ||
        filePair(evidence, name),
      `invalid optional ${name} file/hash`,
    );
  const captures = evidence.captures;
  assert(
    Array.isArray(captures) && captures.length > 0,
    "actual captured PNG witnesses are required",
  );
  for (const [index, capture] of captures.entries()) {
    assert(
      keys(capture, [
        "index",
        "framePath",
        "frameSha256",
        "sessionId",
        "acknowledged",
        "metadata",
      ]) &&
        capture.index === index &&
        filePair(capture, "frame") &&
        Number.isSafeInteger(capture.sessionId) &&
        capture.sessionId >= 0 &&
        capture.acknowledged === true &&
        object(capture.metadata),
      "capture metadata/acknowledgement is invalid",
    );
    assert(
      capture.metadata.timestamp === undefined ||
        finite(capture.metadata.timestamp),
      "capture timestamp is invalid",
    );
  }
  assert(
    captures.some((capture) => finite(capture.metadata.timestamp)),
    "captures lack actual compositor timestamps",
  );
  assert(
    unique(captures.map((capture) => capture.framePath)),
    "captured PNG paths must identify separate capture records",
  );
  const proof = evidence.durableProof;
  assert(
    object(proof) &&
      proof.fullItemContentPreserved === true &&
      unique(proof.actualItemOrder) &&
      proof.actualItemOrder.length === condition.count &&
      same(
        [...proof.actualItemOrder].sort(),
        [...fixture.baselineItemOrder].sort(),
      ) &&
      unique(proof.actualExecuteIds) &&
      proof.actualExecuteIds.every((id) =>
        proof.actualItemOrder.includes(id),
      ) &&
      unique(proof.expectedExecuteMembership) &&
      same(
        [...proof.actualExecuteIds].sort(),
        [...proof.expectedExecuteMembership].sort(),
      ),
    "mandatory full durable item/member proof is missing",
  );
  const expectedExecute = new Set(fixture.baselineExecuteIds);
  for (const id of observation.effectiveIds) {
    if (condition.direction === "candidate-to-execute") expectedExecute.add(id);
    else expectedExecute.delete(id);
  }
  assert(
    same([...proof.actualExecuteIds].sort(), [...expectedExecute].sort()),
    "durable membership does not reflect all three transferred identities",
  );
  assert(
    object(proof.selectionPreparation) &&
      object(evidence.scenarioEvidence) &&
      same(
        evidence.scenarioEvidence.selectionPreparation,
        proof.selectionPreparation,
      ) &&
      same(evidence.expectedTransferredIds, observation.effectiveIds),
    "scenario selection/moved identity proof differs from attempt",
  );
}

/** Classifies original baseline attempts; this result never grants acceptance. */
export function validateBaselineFrameObservations(
  artifact,
  identity = {},
  instrumentVersion,
  profile = "completion",
) {
  assert(
    object(artifact) &&
      artifact.schemaVersion === 1 &&
      text(instrumentVersion) &&
      instrumentVersion === "shopping-rendering-v3" &&
      artifact.instrumentVersion === instrumentVersion,
    "unsupported schema/instrument version",
  );
  assert(
    artifact.group === "transfer" &&
      artifact.measurementKind === "frame" &&
      artifact.phase === "before" &&
      artifact.diagnosticOnly === false &&
      artifact.acceptanceMeasurement === true,
    "only normal before transfer/frame observations are supported",
  );
  for (const field of ["phase", "runId"])
    if (identity[field] !== undefined)
      assert(
        artifact[field] === identity[field],
        `${field} differs from provenance`,
      );
  assert(
    typeof identity.productCommit === "string" &&
      /^[a-f0-9]{40}$/.test(identity.productCommit),
    "before product commit provenance is required",
  );
  validateBaselineProductObservation(
    artifact.baselineComparisonObservation,
    identity.productCommit,
  );
  validatePerformanceSamplingMetadata(artifact, profile);
  const sampleCount = performanceSamplingProfile(profile).sampleCount;
  validateAcceptanceCriteriaMetadata(artifact, "transfer", { profile });
  const condition = artifact.condition;
  assert(
    object(condition) &&
      condition.count === 500 &&
      condition.grouped === true &&
      condition.scenario === "range" &&
      ["native", "touch"].includes(condition.input),
    "only grouped 500-item native/touch range frames are supported",
  );
  const key = `frame:${performanceConditionKey(condition, "transfer")}`;
  assert(
    expectedPerformanceCases("transfer").some(
      (entry) =>
        entry.key === key &&
        entry.measurementKind === "frame" &&
        same(entry.condition, condition),
    ),
    "unexpected or extended range-frame condition",
  );
  assert(
    Array.isArray(artifact.errors) && artifact.errors.length === 0,
    "artifact errors must be empty",
  );
  assert(
    artifact.postconditionErrors === undefined ||
      Array.isArray(artifact.postconditionErrors),
    "postcondition errors must be an array when present",
  );
  const observations = artifact.baselineFrameObservations;
  assert(
    Array.isArray(observations) &&
      observations.length === sampleCount &&
      Array.isArray(artifact.fixtures) &&
      artifact.fixtures.length === sampleCount,
    `exactly ${sampleCount} original fixture attempts are required`,
  );
  assert(
    unique(observations.map((entry) => entry?.measurementId)),
    "measurement IDs must be unique original attempts",
  );
  const completed = [];
  for (const [offset, observation] of observations.entries()) {
    const fixture = artifact.fixtures[offset];
    assert(
      object(observation) &&
        observation.sampleIndex === offset + 1 &&
        text(observation.measurementId) &&
        hash(observation.fixtureHash) &&
        unique(observation.effectiveIds) &&
        observation.effectiveIds.length === 3,
      "invalid original ordinal/measurement/hash/effective identities",
    );
    assert(
      object(fixture) &&
        fixture.index === offset + 1 &&
        fixture.measurementId === observation.measurementId &&
        fixture.fixtureHash === observation.fixtureHash &&
        fixture.initialCount === 500 &&
        fixture.isolation === "new-browser-context-per-sample" &&
        unique(fixture.baselineItemOrder) &&
        fixture.baselineItemOrder.length === 500 &&
        unique(fixture.baselineExecuteIds) &&
        fixture.baselineExecuteIds.every((id) =>
          fixture.baselineItemOrder.includes(id),
        ) &&
        observation.effectiveIds.every((id) =>
          fixture.baselineItemOrder.includes(id),
        ),
      "fixture identity/content does not match original attempt",
    );
    assert(
      observation.effectiveIds.every(
        (id) =>
          fixture.baselineExecuteIds.includes(id) ===
          (condition.direction === "execute-to-candidate"),
      ),
      "effective source membership differs from direction",
    );
    if (observation.outcome === "completed") {
      assert(
        keys(observation, [...outcomeFields, "durationMs"]) &&
          finite(observation.durationMs) &&
          observation.durationMs >= 0,
        "completed outcome requires only an actual finite duration",
      );
      completed.push(observation);
    } else {
      assert(
        observation.outcome === "endpoint-unobservable" &&
          keys(observation, [...outcomeFields, "failure"]),
        "unobservable outcomes cannot contain a latency or unknown result",
      );
      validateFailedEvidence(observation, fixture, condition);
    }
  }
  const unobservableCount = observations.length - completed.length;
  assert(
    unobservableCount > 0
      ? text(artifact.failure)
      : artifact.failure === undefined,
    "artifact failure must reflect unobservable outcomes exactly",
  );
  assert(
    keys(artifact.metrics, ["frame"]),
    "only actual completed frame metrics are allowed",
  );
  const metric = artifact.metrics.frame;
  assert(
    keys(metric, ["raw", "summary", "samples"]) &&
      Array.isArray(metric.raw) &&
      Array.isArray(metric.samples) &&
      metric.raw.length === completed.length &&
      metric.samples.length === completed.length,
    "raw/samples must contain only completed original attempts",
  );
  for (const [index, observation] of completed.entries()) {
    const sample = metric.samples[index];
    assert(
      object(sample) &&
        sample.measurementId === observation.measurementId &&
        sample.fixtureHash === observation.fixtureHash &&
        same(sample.expectedTransferredIds, observation.effectiveIds) &&
        sample.durationMs === observation.durationMs &&
        metric.raw[index] === observation.durationMs,
      "completed duration/measurement/hash/effective identities differ from actual metric sample",
    );
  }
  const recordedPostconditions = [];
  for (const [index, observation] of completed.entries()) {
    const errors = metric.samples[index].postconditionErrors ?? [];
    assert(
      Array.isArray(errors),
      "completed sample postcondition errors must be an array",
    );
    for (const error of errors) {
      assert(
        keys(error, [
          "measurementId",
          "sampleIndex",
          "code",
          "message",
          "itemIds",
        ]) &&
          error.measurementId === observation.measurementId &&
          error.sampleIndex === observation.sampleIndex &&
          error.code === "selection-not-consumed" &&
          text(error.message) &&
          unique(error.itemIds) &&
          error.itemIds.length > 0 &&
          error.itemIds.every((id) => observation.effectiveIds.includes(id)),
        "postcondition error does not identify its original completed attempt",
      );
      recordedPostconditions.push(error);
    }
  }
  assert(
    same(artifact.postconditionErrors ?? [], recordedPostconditions),
    "top-level and original completed sample postcondition errors differ",
  );
  const sorted = [...metric.raw].sort((a, b) => a - b);
  const count = sorted.length;
  const expectedSummary = {
    count,
    medianMs: count
      ? count % 2
        ? sorted[(count - 1) / 2]
        : (sorted[count / 2 - 1] + sorted[count / 2]) / 2
      : null,
    p95Ms: count ? sorted[Math.ceil(count * 0.95) - 1] : null,
  };
  assert(
    same(metric.summary, expectedSummary),
    "partial completed metric summary is not recomputed from genuine samples",
  );
  return {
    key,
    condition,
    attempted: sampleCount,
    completedCount: completed.length,
    unobservableCount,
    fixtureHashes: observations.map((entry) => entry.fixtureHash),
    observations,
  };
}

const inside = (root, filename) => {
  const relative = path.relative(root, filename);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
};
function png(bytes) {
  assert(
    bytes.length >= 33 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.readUInt32BE(8) === 13 &&
      bytes.toString("ascii", 12, 16) === "IHDR",
    "invalid PNG signature/IHDR",
  );
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  assert(
    width > 0 && height > 0 && width <= 32768 && height <= 32768,
    "invalid PNG dimensions",
  );
  return { width, height };
}

/** Hash-checks diagnostic files; no captured PNG is promoted to an accepted frame. */
export async function verifyBaselineFrameObservationFiles(
  artifact,
  outputRoot,
  hashes = {},
) {
  const root = await realpath(outputRoot);
  const cache = new Map();
  async function checkedFile(record, name, image = false) {
    assert(filePair(record, name), `missing ${name} file/hash`);
    const filename = await realpath(path.resolve(record[`${name}Path`]));
    assert(
      inside(root, filename) && (await stat(filename)).isFile(),
      `${name} file escaped evidence root or is not a regular file`,
    );
    let bytes = cache.get(filename);
    if (!bytes) {
      bytes = await readFile(filename);
      cache.set(filename, bytes);
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert(digest === record[`${name}Sha256`], `${name} file hash mismatch`);
    hashes[path.relative(outputRoot, filename)] = digest;
    if (image) png(bytes);
    return bytes;
  }
  assert(
    Array.isArray(artifact.baselineFrameObservations),
    "missing original observations",
  );
  for (const observation of artifact.baselineFrameObservations) {
    if (observation.outcome !== "endpoint-unobservable") continue;
    const evidence = observation.failure.evidence;
    const trace = JSON.parse(
      (await checkedFile(evidence, "trace")).toString("utf8"),
    );
    assert(Array.isArray(trace.traceEvents), "traceEvents are missing");
    const inputs = trace.traceEvents.filter(
      (event) => event.name === `${observation.measurementId}:input`,
    );
    const doms = trace.traceEvents.filter(
      (event) => event.name === `${observation.measurementId}:dom`,
    );
    assert(
      inputs.length === 1 &&
        doms.length === 1 &&
        evidence.inputMarkerCount === 1 &&
        same({ pid: inputs[0].pid, ts: inputs[0].ts }, evidence.inputMarker) &&
        same({ pid: doms[0].pid, ts: doms[0].ts }, evidence.domMarker) &&
        inputs[0].pid === doms[0].pid &&
        doms[0].ts >= inputs[0].ts,
      "actual trace input/DOM markers differ from the unique ordered witness",
    );
    const failed = JSON.parse(
      (await checkedFile(evidence, "failedObservation")).toString("utf8"),
    );
    const probe = failed.probe;
    assert(
      object(probe) &&
        observation.effectiveIds.includes(probe.id) &&
        probe.trusted === true &&
        probe.matched === true &&
        probe.startEpoch === evidence.startEpoch &&
        probe.domMs === evidence.domMs &&
        probe.markerDelayMs === evidence.markerDelayMs &&
        Array.isArray(failed.columns),
      "actual failed probe does not match the post-input observation",
    );
    await checkedFile(evidence, "baseline", true);
    await checkedFile(evidence, "failureScreenshot", true);
    assert(
      (await checkedFile(evidence, "failureDom")).toString("utf8").trim()
        .length > 0,
      "failure DOM snapshot is empty",
    );
    for (const capture of evidence.captures)
      await checkedFile(capture, "frame", true);
    if (evidence.referencePath !== undefined)
      await checkedFile(evidence, "reference", true);
    if (evidence.verificationPath !== undefined) {
      const candidates = JSON.parse(
        (await checkedFile(evidence, "verification")).toString("utf8"),
      );
      assert(
        Array.isArray(candidates) &&
          candidates.length === evidence.candidateCount,
        "actual candidate verification count differs from observation",
      );
      for (const candidate of candidates) {
        assert(
          object(candidate.checked) &&
            candidate.checked.matched === false &&
            finite(candidate.frameSwapEpochMs) &&
            finite(candidate.captureTs) &&
            same(candidate.sourceRects, evidence.sourceRects) &&
            same(candidate.targetRects, evidence.targetRects),
          "candidate verification contradicts the unobservable endpoint/geometry",
        );
        await checkedFile(candidate, "frame", true);
      }
    }
    if (observation.failure.code === "identity-clipped")
      assert(
        evidence.targetRects.some(
          (rect) =>
            rect.itemId === evidence.guard.itemId &&
            rect.height === evidence.guard.actualHeight &&
            rect.height <= 20,
        ),
        "actual clipped guard geometry is false",
      );
  }
  return hashes;
}
