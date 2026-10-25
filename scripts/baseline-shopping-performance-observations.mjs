import { isDeepStrictEqual } from "node:util";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const same = isDeepStrictEqual;
const keys = (value, expected) =>
  object(value) && same(Object.keys(value).sort(), [...expected].sort());
const proofFields = [
  "phase",
  "sourceCommit",
  "referenceProductCommit",
  "sourceTree",
  "publicTree",
  "sourceState",
];
const recordFields = [
  "measurementId",
  "sampleIndex",
  "code",
  "itemIds",
  "message",
  "expectedWriteCount",
  "actualWriteCount",
];
const persistenceFields = ["writeCount", "operationId", "commits", "samples"];
const persistenceSampleFields = [
  "sampleIndex",
  "measurementId",
  "physicalWriteCount",
  "operationId",
  "commits",
];

export function validateBaselineProductObservation(
  proof,
  expectedSourceCommit,
) {
  assert(
    keys(proof, proofFields),
    "Baseline product observation fields are invalid",
  );
  assert(
    proof.phase === "before" &&
      proof.sourceState === "clean" &&
      /^[a-f0-9]{40}$/.test(proof.sourceCommit ?? "") &&
      proof.referenceProductCommit ===
        "200cd7564772a17e2264907ae22e9a93ad30f5dc" &&
      proof.sourceTree === "4155d4dc250e69b16be9a0455bd99a208b9f8d93" &&
      proof.publicTree === "90071a462092c45bc3ae11df5e696a053fc8a1ed",
    "Baseline product observation is not the pinned clean before product",
  );
  if (expectedSourceCommit !== undefined)
    assert(
      typeof expectedSourceCommit === "string" &&
        /^[a-f0-9]{40}$/.test(expectedSourceCommit) &&
        proof.sourceCommit === expectedSourceCommit,
      "Baseline product observation source commit differs from provenance",
    );
  return proof;
}

function validateCommits(sample) {
  assert(
    finite(sample.startEpoch) &&
      sample.startEpoch >= 0 &&
      Array.isArray(sample.commits) &&
      Number.isSafeInteger(sample.physicalWriteCount) &&
      sample.physicalWriteCount === sample.commits.length,
    "Baseline noop sample has invalid input/physical transaction evidence",
  );
  for (const commit of sample.commits) {
    assert(
      object(commit) &&
        finite(commit.at) &&
        commit.at >= sample.startEpoch &&
        Array.isArray(commit.stores) &&
        commit.stores.length > 0 &&
        commit.stores.every(text) &&
        new Set(commit.stores).size === commit.stores.length &&
        Array.isArray(commit.writes),
      "Baseline noop contains an invalid observed transaction",
    );
    assert(
      commit.operationId === undefined ||
        commit.operationId === null ||
        text(commit.operationId),
      "Baseline noop transaction has an invalid operation ID",
    );
  }
  const count = sample.commits.length;
  if (count === 0) {
    assert(
      sample.operationId === null &&
        sample.operationIdUnavailableReason === undefined,
      "Zero-write noop must not fabricate operation attribution",
    );
  } else if (count === 1 && text(sample.commits[0].operationId)) {
    assert(
      sample.operationId === sample.commits[0].operationId &&
        sample.operationIdUnavailableReason === undefined,
      "Baseline noop sole operation ID differs from its actual transaction",
    );
  } else {
    assert(
      sample.operationId === null && text(sample.operationIdUnavailableReason),
      "Baseline noop transactions require explicit unavailable or multiple-ID attribution",
    );
  }
}

/** This validates retained before observations, never an acceptance exception. */
export function validateBaselineNoopObservation(artifact, identity = {}) {
  assert(
    object(artifact) &&
      artifact.group === "transfer" &&
      artifact.phase === "before" &&
      artifact.condition?.scenario === "noop",
    "Baseline noop observation is limited to before transfer/noop",
  );
  for (const name of ["group", "phase", "runId"])
    if (identity[name] !== undefined)
      assert(
        artifact[name] === identity[name],
        `Baseline noop ${name} differs from comparison identity`,
      );
  assert(text(artifact.runId), "Baseline noop run ID is missing");
  validateBaselineProductObservation(
    artifact.baselineComparisonObservation,
    identity.productCommit,
  );
  const metricNames =
    artifact.measurementKind === "response"
      ? ["response", "nextApplied"]
      : artifact.measurementKind === "frame"
        ? ["frame"]
        : [];
  assert(
    metricNames.length > 0 && keys(artifact.metrics, metricNames),
    "Baseline noop must retain every original response/next-input or frame metric",
  );
  const primaryName = metricNames[0];
  const primary = artifact.metrics[primaryName].samples;
  const sampleMaps = new Map();
  for (const name of metricNames) {
    const metric = artifact.metrics[name];
    assert(
      object(metric) &&
        Array.isArray(metric.samples) &&
        metric.samples.length === 20 &&
        Array.isArray(metric.raw) &&
        metric.raw.length === 20,
      "Baseline noop needs twenty complete samples for every original metric",
    );
    const map = new Map();
    for (const [index, sample] of metric.samples.entries()) {
      assert(
        object(sample) &&
          text(sample.measurementId) &&
          !map.has(sample.measurementId) &&
          text(sample.targetId) &&
          finite(sample.durationMs) &&
          sample.durationMs >= 0 &&
          metric.raw[index] === sample.durationMs,
        "Baseline noop metric ID/target/clock is invalid or duplicated",
      );
      if (sample.sampleIndex !== undefined)
        assert(
          sample.sampleIndex === index + 1,
          "Baseline noop metric ordinal differs from its physical sample order",
        );
      validateCommits(sample);
      assert(
        Array.isArray(sample.postconditionErrors),
        "Baseline noop sample postconditions are missing",
      );
      map.set(sample.measurementId, sample);
    }
    sampleMaps.set(name, map);
  }
  assert(
    Array.isArray(artifact.postconditionErrors),
    "Baseline noop functional postconditions are missing",
  );
  const records = new Map(),
    ordinals = new Set();
  for (const record of artifact.postconditionErrors) {
    assert(
      keys(record, recordFields) &&
        record.code === "unexpected-noop-write" &&
        text(record.measurementId) &&
        text(record.message) &&
        Number.isSafeInteger(record.sampleIndex) &&
        record.sampleIndex >= 1 &&
        record.sampleIndex <= 20 &&
        record.expectedWriteCount === 0 &&
        Number.isSafeInteger(record.actualWriteCount) &&
        record.actualWriteCount > 0 &&
        !records.has(record.measurementId) &&
        !ordinals.has(record.sampleIndex),
      "Baseline noop write postcondition record is invalid or duplicated",
    );
    const sample = primary[record.sampleIndex - 1];
    assert(
      sample?.measurementId === record.measurementId &&
        same(record.itemIds, [sample.targetId]) &&
        record.actualWriteCount === sample.commits.length &&
        record.actualWriteCount === sample.physicalWriteCount,
      "Baseline noop write postcondition does not match its actual target/transaction count",
    );
    records.set(record.measurementId, record);
    ordinals.add(record.sampleIndex);
  }
  for (const [index, sample] of primary.entries()) {
    const record = records.get(sample.measurementId);
    assert(
      sample.commits.length > 0 === Boolean(record),
      "Baseline noop actual writes must have one matching functional failure record",
    );
    const expectedErrors = record ? [record] : [];
    for (const name of metricNames) {
      const corresponding = artifact.metrics[name].samples[index];
      assert(
        corresponding?.measurementId === sample.measurementId &&
          sampleMaps.get(name).has(sample.measurementId),
        "Baseline noop metric measurement IDs or sample order disagree",
      );
      for (const field of [
        "startEpoch",
        "commits",
        "physicalWriteCount",
        "operationId",
        "operationIdUnavailableReason",
      ])
        assert(
          same(corresponding[field], sample[field]),
          `Baseline noop metric ${field} differs for the same measurement`,
        );
      assert(
        same(corresponding.postconditionErrors, expectedErrors),
        "Baseline noop top/sample functional postconditions disagree",
      );
      if (name === "nextApplied") {
        const lastActualCommit = Math.max(
          sample.startEpoch,
          ...sample.commits.map((commit) => commit.at),
        );
        assert(
          corresponding.trusted === true &&
            corresponding.matched === true &&
            finite(corresponding.eventEpoch) &&
            corresponding.eventEpoch > lastActualCommit,
          "Baseline noop next input did not follow every actual transaction",
        );
      }
    }
  }
  const persistence = artifact.persistence;
  assert(
    keys(persistence, persistenceFields) &&
      persistence.operationId === null &&
      Array.isArray(persistence.samples) &&
      persistence.samples.length === 20 &&
      Array.isArray(persistence.commits),
    "Baseline noop must retain all twenty physical persistence samples",
  );
  const flattened = [];
  let writeCount = 0;
  for (const [index, physical] of persistence.samples.entries()) {
    const sample = primary[index];
    assert(
      keys(physical, persistenceSampleFields) &&
        physical.sampleIndex === index + 1 &&
        physical.measurementId === sample.measurementId &&
        physical.physicalWriteCount === sample.commits.length &&
        physical.operationId === sample.operationId &&
        same(physical.commits, sample.commits),
      "Baseline noop persistence sample ordinal/common fields disagree",
    );
    writeCount += physical.commits.length;
    flattened.push(...physical.commits);
  }
  assert(
    Number.isSafeInteger(persistence.writeCount) &&
      persistence.writeCount === writeCount &&
      same(persistence.commits, flattened),
    "Baseline noop aggregate persistence hides or fabricates physical transactions",
  );
  return records;
}
