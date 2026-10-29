import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  performanceAcceptanceCriteriaForGroup,
  performanceSamplingProfile,
} from "./shopping-performance-evidence-contract.mjs";
import {
  validateBaselineFrameObservations,
  validateBaselineReverseFixtureOrder,
  verifyBaselineFrameObservationFiles,
} from "./baseline-frame-performance-observations.mjs";
import { validateBaselineFrameObservationArtifact } from "./verify-shopping-performance-evidence.mjs";

const version = "shopping-rendering-v4";
const sampleCount = performanceSamplingProfile().sampleCount;
const sourceCommit = "a".repeat(40);
const fixtureHash = "b".repeat(64);
const identity = {
  phase: "before",
  runId: "original-profile",
  productCommit: sourceCommit,
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDLcAAAAASUVORK5CYII=",
  "base64",
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const moved = ["c1", "c2", "c3"];
const allIds = Array.from(
  { length: 500 },
  (_, index) => `${index < 250 ? "c" : "e"}${index % 250}`,
);
const execute = allIds.filter((id) => id.startsWith("e"));
const rects = (role, height = 100) =>
  moved.map((itemId, index) => ({
    itemId,
    x: role === "destination-card" ? 200 : 10,
    y: 20 + index * 100,
    width: 100,
    height: index === 2 ? height : 100,
    role,
  }));
const file = (name, bytes = png) => ({
  [`${name}Path`]: path.resolve(`${name}.png`),
  [`${name}Sha256`]: sha(bytes),
});
const browserEnvironment = {
  browserVersion: "151.0.7922.34",
  userAgent: "fixture-browser",
  browserChannel: "bundled-chromium",
  viewport: { width: 1440, height: 1000 },
  devicePixelRatio: 1,
  headed: false,
  workers: 1,
  retries: 0,
};
function sourceGesture() {
  const point = { x: 20, y: 30 };
  const sourceRect = { x: 10, y: 20, width: 100, height: 100 };
  const hit = {
    origin: "card-edge",
    point,
    withinSource: true,
    withinViewport: true,
    interactive: false,
    sourceContainsHit: true,
    sourceOwnerMatched: true,
    hitItemId: moved[0],
    hitRect: { ...sourceRect },
    matched: true,
  };
  return {
    sourcePoint: point,
    sourceOrigin: hit.origin,
    sourceHitTest: {
      sourceId: moved[0],
      sourceRect,
      attempts: [hit],
      selectedHit: { ...hit },
      initialRejection: null,
    },
  };
}
function forwardExpectation() {
  return {
    contract: "execution-visit-tail-and-anchor-boundary",
    beforeItemOrder: [...allIds],
    beforeExecuteIds: [...execute],
    sourceIds: [...moved],
    beforeVisits: execute.map((id) => ({ key: id, itemIds: [id] })),
    sourceVisits: moved.map((id) => ({ key: id, itemIds: [id] })),
    anchorId: execute.at(-1),
    boundaryKind: "after-reference-visit",
    boundaryId: null,
    expectedItemOrder: [...allIds],
    expectedExecuteIds: [...execute, ...moved],
    expectedDisplayIds: [...execute, ...moved],
  };
}
function preparedSelection() {
  return {
    requestedIds: [...moved],
    requestedDisplayOrder: [...moved],
    mountedCheckedIds: [...moved],
    exactSelectionVerified: true,
    requestedCount: 3,
    effectiveCount: 3,
    headerText: "Candidate (3件)",
    checkboxChecks: moved.map((targetId) => ({
      targetId,
      checked: true,
      scrollY: 0,
      rect: { x: 10, y: 20, width: 100, height: 100 },
    })),
  };
}
function fixtureArtifact(
  completedIndices = [],
  code = "identity-clipped",
  profile = "completion",
) {
  const sampleCount = performanceSamplingProfile(profile).sampleCount;
  const observations = [],
    fixtures = [],
    samples = [];
  for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex++) {
    const measurementId = `original-${sampleIndex}`;
    const common = {
      sampleIndex,
      measurementId,
      fixtureHash,
      effectiveIds: [...moved],
    };
    fixtures.push({
      index: sampleIndex,
      measurementId,
      fixtureHash,
      initialCount: 500,
      isolation: "new-browser-context-per-sample",
      baselineItemOrder: [...allIds],
      baselineExecuteIds: [...execute],
    });
    if (completedIndices.includes(sampleIndex)) {
      observations.push({
        ...common,
        outcome: "completed",
        durationMs: sampleIndex + 0.25,
      });
      samples.push({
        measurementId,
        fixtureHash,
        durationMs: sampleIndex + 0.25,
        expectedTransferredIds: [...moved],
        postconditionErrors: [],
      });
      continue;
    }
    const selectionPreparation = preparedSelection();
    const forwardOrderExpectation = forwardExpectation();
    const evidence = {
      measurementId,
      targetId: moved[0],
      probeCpuMs: 0.2,
      probeChecks: 4,
      operationId: `application:${sampleIndex}`,
      gestureObservation: sourceGesture(),
      requiredDestinationIds: [...moved],
      destinationCardExemptions: [],
      requiredDestinationCardsVerified: true,
      mountedTransferredIds: [...moved],
      expectedDestinationDisplayIds: [...execute, ...moved],
      visibleTransferredIds: [...moved],
      postInput: true,
      trusted: true,
      matched: true,
      startEpoch: 100000 + sampleIndex * 1000,
      domMs: 42,
      markerDelayMs: 1,
      commits: [
        {
          at: 100050 + sampleIndex * 1000,
          stores: ["eventLists"],
          writes: [],
          operationId: `application:${sampleIndex}`,
        },
      ],
      sourceRects: rects("source-origin"),
      targetRects: rects(
        "destination-card",
        code === "identity-clipped" ? 16.15625 : 100,
      ),
      captures: [
        {
          index: 0,
          ...file("frame"),
          sessionId: sampleIndex,
          acknowledged: true,
          metadata: { timestamp: (100100 + sampleIndex * 1000) / 1000 },
        },
      ],
      inputMarkerCount: 1,
      inputMarker: { pid: 17, ts: 1000 },
      domMarker: { pid: 17, ts: 1042 },
      ...file("trace", "trace"),
      ...file("baseline"),
      ...file("failedObservation", "probe"),
      ...file("failureScreenshot"),
      ...file("failureDom", "DOM"),
      durableProof: {
        fullItemContentPreserved: true,
        actualItemOrder: [...allIds],
        actualExecuteIds: [...execute, ...moved],
        expectedExecuteMembership: [...execute, ...moved],
        selectionPreparation,
        candidateOrderProof: null,
        mergeTailProof: [],
        forwardOrderProof: {
          ...structuredClone(forwardOrderExpectation),
          actualItemOrder: [...allIds],
          actualExecuteIds: [...execute, ...moved],
          actualMountedDisplayIds: [...execute, ...moved],
          rawOrderVerified: true,
          displayOrderVerified: true,
        },
      },
      scenarioEvidence: { selectionPreparation, forwardOrderExpectation },
      expectedTransferredIds: [...moved],
      ...(code === "identity-clipped"
        ? {
            guard: {
              itemId: "c3",
              actualHeight: 16.15625,
              minimumHeightExclusive: 20,
            },
          }
        : {
            candidateCount: 0,
            ...file("reference"),
            ...file("verification", "[]"),
          }),
    };
    observations.push({
      ...common,
      outcome: "endpoint-unobservable",
      failure: {
        code,
        message: "Original post-input endpoint could not be observed",
        evidence,
      },
    });
  }
  const raw = samples.map((sample) => sample.durationMs),
    sorted = [...raw].sort((a, b) => a - b),
    count = raw.length;
  return {
    schemaVersion: 1,
    instrumentVersion: version,
    phase: "before",
    runId: identity.runId,
    group: "transfer",
    measurementKind: "frame",
    diagnosticOnly: false,
    acceptanceMeasurement: true,
    ...performanceAcceptanceCriteriaForGroup("transfer", profile),
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
      sourceCommit,
      sourceState: "clean",
      referenceProductCommit: "200cd7564772a17e2264907ae22e9a93ad30f5dc",
      sourceTree: "4155d4dc250e69b16be9a0455bd99a208b9f8d93",
      publicTree: "90071a462092c45bc3ae11df5e696a053fc8a1ed",
    },
    environment: structuredClone(browserEnvironment),
    baselineFrameObservations: observations,
    fixtures,
    errors: [],
    postconditionErrors: [],
    ...(count < sampleCount
      ? { failure: "Original baseline frame endpoint unobservable" }
      : {}),
    metrics: {
      frame: {
        raw,
        samples,
        summary: {
          count,
          medianMs: count
            ? (sorted[Math.floor((count - 1) / 2)] +
                sorted[Math.floor(count / 2)]) /
              2
            : null,
          p95Ms: count ? sorted[Math.ceil(count * 0.95) - 1] : null,
        },
      },
    },
  };
}
function reverseFixtureArtifact(code = "identity-clipped") {
  const artifact = fixtureArtifact([], code);
  artifact.condition.direction = "execute-to-candidate";
  const source = ["e1", "e2", "e3"];
  const candidates = allIds.filter((id) => !execute.includes(id));
  const expectedExecuteIds = execute.filter((id) => !source.includes(id));
  const expectedRawCandidateIds = [...candidates, ...source];
  // The remaining execution e0 slot stays between the candidate/vacated slots.
  // For this end-boundary fixture, refilling those slots preserves all raw IDs.
  const expectedItemOrder = [...allIds];
  for (const observation of artifact.baselineFrameObservations) {
    observation.effectiveIds = [...source];
    const e = observation.failure.evidence;
    e.targetId = source[0];
    e.expectedTransferredIds = [...source];
    e.requiredDestinationIds = [...source];
    e.mountedTransferredIds = [...source];
    e.visibleTransferredIds = [...source];
    e.expectedDestinationDisplayIds = [...expectedRawCandidateIds];
    e.sourceRects.forEach((rect, index) => {
      rect.itemId = source[index];
    });
    e.targetRects.forEach((rect, index) => {
      rect.itemId = source[index];
    });
    if (e.guard) e.guard.itemId = source[2];
    e.gestureObservation.sourceHitTest.sourceId = source[0];
    e.gestureObservation.sourceHitTest.selectedHit.hitItemId = source[0];
    e.gestureObservation.sourceHitTest.attempts[0].hitItemId = source[0];
    const selection = preparedSelection();
    selection.requestedIds = [...source];
    selection.requestedDisplayOrder = [...source];
    selection.mountedCheckedIds = [...source];
    selection.checkboxChecks.forEach((check, index) => {
      check.targetId = source[index];
    });
    e.scenarioEvidence = { selectionPreparation: selection };
    e.durableProof = {
      fullItemContentPreserved: true,
      actualItemOrder: [...expectedItemOrder],
      actualExecuteIds: [...expectedExecuteIds],
      expectedExecuteMembership: [...expectedExecuteIds],
      selectionPreparation: selection,
      forwardOrderProof: null,
      mergeTailProof: [],
      candidateOrderProof: {
        contract: "candidate-raw-boundary-and-default-display",
        rawOrderVerified: true,
        defaultDisplayOrderVerified: true,
        expectedItemOrder: [...expectedItemOrder],
        actualItemOrder: [...expectedItemOrder],
        expectedExecuteIds: [...expectedExecuteIds],
        actualExecuteIds: [...expectedExecuteIds],
        expectedRawCandidateIds: [...expectedRawCandidateIds],
        actualRawCandidateIds: [...expectedRawCandidateIds],
        expectedDisplayIds: [...expectedRawCandidateIds],
        actualMountedDisplayIds: [...expectedRawCandidateIds],
        sourceIds: [...source],
        displayedBeforeIds: [...candidates],
        anchorId: candidates.at(-1),
        boundaryKind: "next-displayed-row",
        boundaryId: null,
      },
    };
  }
  return artifact;
}
const validate = (artifact, profile = "completion") =>
  validateBaselineFrameObservations(artifact, identity, version, profile);
const validateV4 = (artifact) =>
  validateBaselineFrameObservationArtifact(artifact, identity, "completion");
for (const code of ["identity-clipped", "no-content-verified-frame"])
  test(`v4 ${code} retains actual emitted metadata without a latency or pass claim`, () => {
    const artifact = fixtureArtifact([], code);
    const original = structuredClone(artifact);
    const checked = validateV4(artifact);
    assert.equal(checked.unobservableCount, sampleCount);
    assert.deepEqual(artifact, original);
    assert.deepEqual(artifact.metrics.frame.raw, []);
    assert.equal(artifact.metrics.frame.summary.medianMs, null);
    assert.equal(artifact.metrics.frame.summary.p95Ms, null);
    assert.equal(Object.hasOwn(checked, "passed"), false);
  });
test("reverse fixture golden retains the interleaved remaining execution slot", () => {
  const fixture = {
    baselineItemOrder: ["e0", "e1", "c0", "c1"],
    baselineExecuteIds: ["e0", "e1"],
  };
  const order = {
    sourceIds: ["e0"],
    displayedBeforeIds: ["c0", "c1"],
    anchorId: "c0",
    boundaryKind: "next-displayed-row",
    boundaryId: "c1",
    expectedExecuteIds: ["e1"],
    expectedRawCandidateIds: ["c0", "e0", "c1"],
    expectedItemOrder: ["c0", "e1", "e0", "c1"],
  };
  assert.doesNotThrow(() =>
    validateBaselineReverseFixtureOrder(order, fixture, ["e0"]),
  );
  // This tempting full-array remove/splice result moves e1 to another slot.
  order.expectedItemOrder = ["e1", "c0", "e0", "c1"];
  assert.throws(
    () => validateBaselineReverseFixtureOrder(order, fixture, ["e0"]),
    /original fixture candidate slots/,
  );
});
for (const code of ["identity-clipped", "no-content-verified-frame"])
  test(`v4 reverse ${code} binds all original raw items and execution members`, () => {
    assert.equal(
      validateV4(reverseFixtureArtifact(code)).unobservableCount,
      sampleCount,
    );
  });
test("v4 failed forward order inputs cannot replace the original fixture", () => {
  const artifact = fixtureArtifact();
  const ids = artifact.fixtures[0].baselineItemOrder;
  [ids[100], ids[101]] = [ids[101], ids[100]];
  assert.throws(() => validateV4(artifact), /original fixture/);
});
test("v4 failed reverse raw order cannot consistently forge an unrelated before item", () => {
  const artifact = reverseFixtureArtifact();
  const proof =
    artifact.baselineFrameObservations[0].failure.evidence.durableProof;
  const order = proof.candidateOrderProof;
  for (const ids of [
    proof.actualItemOrder,
    order.expectedItemOrder,
    order.actualItemOrder,
    order.expectedRawCandidateIds,
    order.actualRawCandidateIds,
  ])
    [ids[0], ids[1]] = [ids[1], ids[0]];
  assert.throws(() => validateV4(artifact), /original fixture candidate slots/);
});
test("v4 explicitly unavailable operation IDs stay bound to their original transaction", () => {
  const artifact = fixtureArtifact();
  for (const observation of artifact.baselineFrameObservations) {
    const evidence = observation.failure.evidence;
    evidence.operationId = null;
    delete evidence.commits[0].operationId;
    evidence.operationIdUnavailableReason =
      "Persistence request did not expose an operation ID";
  }
  assert.equal(validateV4(artifact).unobservableCount, sampleCount);
  artifact.baselineFrameObservations[0].failure.evidence.commits[0].operationId =
    "foreign-operation";
  assert.throws(() => validateV4(artifact), /operation identity/);
});
for (const field of [
  "measurementId",
  "targetId",
  "probeCpuMs",
  "probeChecks",
  "operationId",
  "gestureObservation",
  "requiredDestinationIds",
  "destinationCardExemptions",
  "requiredDestinationCardsVerified",
  "mountedTransferredIds",
  "expectedDestinationDisplayIds",
  "visibleTransferredIds",
])
  test(`v4 failed witnesses reject missing ${field}`, () => {
    const artifact = fixtureArtifact();
    delete artifact.baselineFrameObservations[0].failure.evidence[field];
    assert.throws(() => validateV4(artifact));
  });
for (const [name, mutate] of Object.entries({
  "unknown field": (e) => {
    e.acceptedFrame = true;
  },
  "foreign measurement": (e) => {
    e.measurementId = "another-attempt";
  },
  "foreign source": (e) => {
    e.targetId = "e99";
  },
  "negative probe cost": (e) => {
    e.probeCpuMs = -1;
  },
  "null probe cost": (e) => {
    e.probeCpuMs = null;
  },
  "string probe count": (e) => {
    e.probeChecks = "4";
  },
  "fractional probe count": (e) => {
    e.probeChecks = 0.5;
  },
  "foreign operation": (e) => {
    e.operationId = "foreign-operation";
  },
  "unavailable operation without reason": (e) => {
    e.operationId = null;
    delete e.commits[0].operationId;
  },
  "unavailable reason for a present operation": (e) => {
    e.operationIdUnavailableReason = "not applicable";
  },
  "missing required secondary card": (e) => {
    e.requiredDestinationIds.pop();
  },
  "missing mounted secondary card": (e) => {
    e.mountedTransferredIds.pop();
  },
  "forged offscreen exemption": (e) => {
    e.destinationCardExemptions.push({
      itemId: "c3",
      reason: "offscreen-merge-target",
      targetId: "e3",
    });
  },
  "unverified required card": (e) => {
    e.requiredDestinationCardsVerified = false;
  },
  "swapped visible cards": (e) => {
    e.visibleTransferredIds.reverse();
  },
  "swapped mounted cards": (e) => {
    e.mountedTransferredIds.reverse();
  },
  "missing expected destination member": (e) => {
    e.expectedDestinationDisplayIds.pop();
  },
  "invented frame pass": (e) => {
    e.frameVerified = true;
  },
  "negative input clock": (e) => {
    e.startEpoch = -1;
  },
  "null DOM clock": (e) => {
    e.domMs = null;
  },
  "invalid card geometry": (e) => {
    e.targetRects[1].width = 0;
  },
  "lost durable item": (e) => {
    e.durableProof.actualItemOrder.pop();
  },
  "forged actual hit": (e) => {
    e.gestureObservation.sourceHitTest.selectedHit = {
      ...e.gestureObservation.sourceHitTest.selectedHit,
      interactive: true,
    };
  },
  "out of viewport source": (e) => {
    e.gestureObservation.sourceHitTest.sourceRect.x = 2000;
  },
  "self-consistent forged display order": (e) => {
    for (const ids of [
      e.expectedDestinationDisplayIds,
      e.durableProof.forwardOrderProof.expectedDisplayIds,
      e.durableProof.forwardOrderProof.actualMountedDisplayIds,
      e.scenarioEvidence.forwardOrderExpectation.expectedDisplayIds,
    ])
      [ids[0], ids[1]] = [ids[1], ids[0]];
  },
}))
  test(`v4 failed witnesses reject ${name}`, () => {
    const artifact = fixtureArtifact();
    mutate(artifact.baselineFrameObservations[0].failure.evidence);
    assert.throws(() => validateV4(artifact));
  });

test("profile-count unobservable original attempts have no numeric frame value or pass claim", () => {
  const result = validate(fixtureArtifact());
  assert.equal(result.attempted, sampleCount);
  assert.equal(result.completedCount, 0);
  assert.equal(result.unobservableCount, sampleCount);
  assert.equal(result.fixtureHashes.length, sampleCount);
  assert.equal(new Set(result.fixtureHashes).size, 1);
  assert.equal(Object.hasOwn(result, "passed"), false);
});
test("partial original indices retain only real completed values with recomputed summary", () => {
  const artifact = fixtureArtifact(
    [2, 7, sampleCount],
    "no-content-verified-frame",
  );
  assert.equal(validate(artifact).completedCount, 3);
  assert.deepEqual(artifact.metrics.frame.raw, [
    2.25,
    7.25,
    sampleCount + 0.25,
  ]);
});
test("all profile-count actually completed before frames can retain normal observations without failure", () => {
  assert.equal(
    validate(
      fixtureArtifact(
        Array.from({ length: sampleCount }, (_, index) => index + 1),
      ),
    ).unobservableCount,
    0,
  );
});
test("completed selection errors bind original index, measurement ID and effective IDs", () => {
  const artifact = fixtureArtifact([2, 7]);
  const error = {
    sampleIndex: 7,
    measurementId: "original-7",
    code: "selection-not-consumed",
    message: "Checked moved card remained selected",
    itemIds: ["c2"],
  };
  artifact.postconditionErrors.push(error);
  artifact.metrics.frame.samples[1].postconditionErrors.push(error);
  assert.equal(validate(artifact).completedCount, 2);
  artifact.postconditionErrors[0].sampleIndex = 2;
  assert.throws(() => validate(artifact), /original completed attempt/);
});

test("completed observations bind effective identities to the actual original metric sample", () => {
  for (const completedIndices of [
    [2, 7],
    Array.from({ length: sampleCount }, (_, index) => index + 1),
  ]) {
    const artifact = fixtureArtifact(completedIndices);
    const original = structuredClone(artifact);
    assert.equal(validate(artifact).completedCount, completedIndices.length);
    assert.deepEqual(artifact, original);
    const completed = artifact.baselineFrameObservations.find(
      (entry) => entry.outcome === "completed",
    );
    completed.effectiveIds = ["c4", "c5", "c6"];
    assert.throws(() => validate(artifact), /effective identities differ/);
  }
});
for (const [label, mutate] of Object.entries({
  missing: (sample) => {
    delete sample.expectedTransferredIds;
  },
  reordered: (sample) => {
    sample.expectedTransferredIds.reverse();
  },
  extra: (sample) => {
    sample.expectedTransferredIds.push("c4");
  },
  duplicate: (sample) => {
    sample.expectedTransferredIds[2] = "c1";
  },
}))
  test(`rejects ${label} actual completed transferred identities without compacting original indices`, () => {
    const artifact = fixtureArtifact([2, 7]);
    mutate(artifact.metrics.frame.samples[1]);
    assert.throws(() => validate(artifact), /effective identities differ/);
  });
const mutations = {
  "after phase": (a) => {
    a.phase = "after";
  },
  "response endpoint": (a) => {
    a.measurementKind = "response";
  },
  "foreign product": (a) => {
    a.baselineComparisonObservation.sourceTree = "c".repeat(40);
  },
  "dirty product": (a) => {
    a.baselineComparisonObservation.sourceState = "dirty";
  },
  "wrong source provenance": (a) => {
    a.baselineComparisonObservation.sourceCommit = "d".repeat(40);
  },
  "old instrument": (a) => {
    a.instrumentVersion = "shopping-rendering-v1";
  },
  "wrong criterion": (a) => {
    a.acceptanceCriteriaDate = "2026-10-25";
  },
  "diagnostic substitution": (a) => {
    a.diagnosticOnly = true;
  },
  "extended condition": (a) => {
    a.condition.fake = true;
  },
  "missing original attempt": (a) => {
    a.baselineFrameObservations.pop();
  },
  "reordered original ordinals": (a) => {
    a.baselineFrameObservations[3].sampleIndex = 2;
  },
  "duplicate measurement": (a) => {
    a.baselineFrameObservations[3].measurementId = "original-1";
  },
  "mismatched fixture": (a) => {
    a.fixtures[1].fixtureHash = "e".repeat(64);
  },
  "only two effective identities": (a) => {
    a.baselineFrameObservations[0].effectiveIds.pop();
  },
  "unknown endpoint failure": (a) => {
    a.baselineFrameObservations[0].failure.code = "timeout";
  },
  "invented failed latency": (a) => {
    a.baselineFrameObservations[0].durationMs = 0;
  },
  "untrusted input": (a) => {
    a.baselineFrameObservations[0].failure.evidence.trusted = false;
  },
  "pre-input failure": (a) => {
    a.baselineFrameObservations[0].failure.evidence.postInput = false;
  },
  "missing physical PNG": (a) => {
    a.baselineFrameObservations[0].failure.evidence.captures = [];
  },
  "unacknowledged capture": (a) => {
    a.baselineFrameObservations[0].failure.evidence.captures[0].acknowledged = false;
  },
  "no compositor timestamp": (a) => {
    delete a.baselineFrameObservations[0].failure.evidence.captures[0].metadata
      .timestamp;
  },
  "false clipped guard": (a) => {
    a.baselineFrameObservations[0].failure.evidence.guard.actualHeight = 100;
  },
  "missing durable proof": (a) => {
    delete a.baselineFrameObservations[0].failure.evidence.durableProof;
  },
  "lost transferred member": (a) => {
    a.baselineFrameObservations[0].failure.evidence.durableProof.actualExecuteIds.pop();
  },
  "extra durable transaction": (a) => {
    a.baselineFrameObservations[0].failure.evidence.commits.push(
      a.baselineFrameObservations[0].failure.evidence.commits[0],
    );
  },
  "unordered trace marker": (a) => {
    a.baselineFrameObservations[0].failure.evidence.domMarker.ts = 999;
  },
  "duplicate trusted input": (a) => {
    a.baselineFrameObservations[0].failure.evidence.inputMarkerCount = 2;
  },
  "missing failed-test flag": (a) => {
    delete a.failure;
  },
  "pseudo zero frame": (a) => {
    a.metrics.frame.raw.push(0);
  },
  "unknown setup error": (a) => {
    a.errors.push("setup failed");
  },
};
for (const [name, mutate] of Object.entries(mutations))
  test(`rejects ${name}`, () => {
    const a = fixtureArtifact();
    mutate(a);
    assert.throws(() => validate(a));
  });
for (const [name, mutate] of Object.entries({
  "unrecomputed partial summary": (a) => {
    a.metrics.frame.summary.count = sampleCount;
  },
  "compacted measurement identity": (a) => {
    a.metrics.frame.samples[0].measurementId = "original-1";
  },
  "changed completed duration": (a) => {
    a.metrics.frame.raw[0] += 1;
  },
}))
  test(`rejects ${name}`, () => {
    const a = fixtureArtifact([2, 7]);
    mutate(a);
    assert.throws(() => validate(a));
  });

test("missing provenance or untrusted current version cannot enable baseline extraction", () => {
  assert.throws(
    () => validateBaselineFrameObservations(fixtureArtifact(), {}, version),
    /provenance/,
  );
  assert.throws(
    () =>
      validateBaselineFrameObservations(
        fixtureArtifact(),
        identity,
        "arbitrary-v3",
      ),
    /instrument version/,
  );
});
test("no-content endpoint requires reference and candidate verification references", () => {
  const a = fixtureArtifact([], "no-content-verified-frame");
  delete a.baselineFrameObservations[0].failure.evidence.referencePath;
  assert.throws(() => validate(a), /reference\/candidate/);
});

async function actualFiles(t, code = "identity-clipped") {
  const root = await mkdtemp(path.join(os.tmpdir(), "esp-frame-observation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifact = fixtureArtifact([2, 7], code);
  const put = async (record, name, bytes, suffix) => {
    const filename = path.join(
      root,
      `${suffix}-${name}${name === "trace" || name === "failedObservation" || name === "verification" ? ".json" : name === "failureDom" ? ".yml" : ".png"}`,
    );
    await writeFile(filename, bytes);
    record[`${name}Path`] = filename;
    record[`${name}Sha256`] = sha(bytes);
    return filename;
  };
  for (const observation of artifact.baselineFrameObservations) {
    if (observation.outcome === "completed") continue;
    const e = observation.failure.evidence,
      id = observation.measurementId;
    await put(
      e,
      "trace",
      JSON.stringify({
        traceEvents: [
          { name: `${id}:input`, ...e.inputMarker },
          { name: `${id}:dom`, ...e.domMarker },
        ],
      }),
      id,
    );
    await put(
      e,
      "failedObservation",
      JSON.stringify({
        probe: {
          id: moved[0],
          trusted: true,
          matched: true,
          startEpoch: e.startEpoch,
          domMs: e.domMs,
          markerDelayMs: e.markerDelayMs,
        },
        columns: [{ column: "execute", ids: [...moved] }],
      }),
      id,
    );
    await put(e, "baseline", png, id);
    await put(e, "failureScreenshot", png, id);
    await put(e, "failureDom", "- document: original failed endpoint\n", id);
    await put(e.captures[0], "frame", png, id);
    if (code === "no-content-verified-frame") {
      await put(e, "reference", png, id);
      await put(e, "verification", "[]", id);
    }
  }
  validate(artifact);
  return { artifact, root, put };
}
test("all failed witness files are hashed and actual trace/probe/PNG metadata verified", async (t) => {
  const { artifact, root } = await actualFiles(t);
  const hashes = {};
  await verifyBaselineFrameObservationFiles(artifact, root, hashes);
  assert.equal(Object.keys(hashes).length, (sampleCount - 2) * 6);
});
test("actual no-content candidate evidence is verified separately from accepted frames", async (t) => {
  const { artifact, root } = await actualFiles(t, "no-content-verified-frame");
  await verifyBaselineFrameObservationFiles(artifact, root, {});
});
for (const name of [
  "trace",
  "baseline",
  "failedObservation",
  "failureScreenshot",
  "failureDom",
])
  test(`rejects tampered failed ${name} bytes`, async (t) => {
    const { artifact, root } = await actualFiles(t);
    const e = artifact.baselineFrameObservations[0].failure.evidence;
    await writeFile(e[`${name}Path`], "tampered");
    await assert.rejects(
      verifyBaselineFrameObservationFiles(artifact, root, {}),
      /hash mismatch/,
    );
  });
test("rehashed duplicate input or foreign trace tuple still fails", async (t) => {
  const { artifact, root, put } = await actualFiles(t);
  const o = artifact.baselineFrameObservations[0],
    e = o.failure.evidence;
  await put(
    e,
    "trace",
    JSON.stringify({
      traceEvents: [
        { name: `${o.measurementId}:input`, ...e.inputMarker },
        { name: `${o.measurementId}:input`, ...e.inputMarker },
        { name: `${o.measurementId}:dom`, ...e.domMarker },
      ],
    }),
    "duplicate",
  );
  await assert.rejects(
    verifyBaselineFrameObservationFiles(artifact, root, {}),
    /actual trace/,
  );
});
test("rehashed probe from another attempt cannot substitute for the failed observation", async (t) => {
  const { artifact, root, put } = await actualFiles(t);
  const e = artifact.baselineFrameObservations[0].failure.evidence;
  await put(
    e,
    "failedObservation",
    JSON.stringify({
      probe: {
        id: "c1",
        trusted: true,
        matched: true,
        startEpoch: 1,
        domMs: e.domMs,
        markerDelayMs: e.markerDelayMs,
      },
      columns: [],
    }),
    "foreign",
  );
  await assert.rejects(
    verifyBaselineFrameObservationFiles(artifact, root, {}),
    /actual failed probe/,
  );
});
test("rehashed non-PNG capture is rejected", async (t) => {
  const { artifact, root, put } = await actualFiles(t);
  const e = artifact.baselineFrameObservations[0].failure.evidence;
  await put(e.captures[0], "frame", "not a PNG", "bad-capture");
  await assert.rejects(
    verifyBaselineFrameObservationFiles(artifact, root, {}),
    /PNG/,
  );
});
test("correct hash outside evidence realpath root is rejected", async (t) => {
  const { artifact, root } = await actualFiles(t);
  const outer = await mkdtemp(path.join(os.tmpdir(), "esp-outer-frame-"));
  t.after(() => rm(outer, { recursive: true, force: true }));
  const outside = path.join(outer, "capture.png");
  await writeFile(outside, png);
  artifact.baselineFrameObservations[0].failure.evidence.captures[0].framePath =
    outside;
  await assert.rejects(
    verifyBaselineFrameObservationFiles(artifact, root, {}),
    /escaped evidence root/,
  );
});
test("symlink escape is resolved before evidence containment", async (t) => {
  const { artifact, root } = await actualFiles(t);
  const outer = await mkdtemp(path.join(os.tmpdir(), "esp-outer-link-"));
  t.after(() => rm(outer, { recursive: true, force: true }));
  const outside = path.join(outer, "capture.png"),
    link = path.join(root, "escape.png");
  await writeFile(outside, png);
  try {
    await symlink(outside, link, "file");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) {
      t.skip("Windows file symlink privilege unavailable");
      return;
    }
    throw error;
  }
  artifact.baselineFrameObservations[0].failure.evidence.captures[0].framePath =
    link;
  await assert.rejects(
    verifyBaselineFrameObservationFiles(artifact, root, {}),
    /escaped evidence root/,
  );
});
test("rehashed candidate with a verified content match contradicts no-content failure", async (t) => {
  const { artifact, root, put } = await actualFiles(
    t,
    "no-content-verified-frame",
  );
  const e = artifact.baselineFrameObservations[0].failure.evidence;
  e.candidateCount = 1;
  await put(
    e,
    "verification",
    JSON.stringify([
      {
        frameSwapEpochMs: e.startEpoch + 10,
        captureTs: 1234,
        checked: { matched: true },
        sourceRects: e.sourceRects,
        targetRects: e.targetRects,
        ...e.captures[0],
      },
    ]),
    "contradiction",
  );
  await assert.rejects(
    verifyBaselineFrameObservationFiles(artifact, root, {}),
    /contradicts/,
  );
});
test("rehashed candidate count cannot hide the actual verification records", async (t) => {
  const { artifact, root, put } = await actualFiles(
    t,
    "no-content-verified-frame",
  );
  const e = artifact.baselineFrameObservations[0].failure.evidence;
  await put(e, "verification", "[{}]", "hidden-candidate");
  await assert.rejects(
    verifyBaselineFrameObservationFiles(artifact, root, {}),
    /count differs/,
  );
});

test("PR baseline frame observations retain exactly two original attempts and cannot claim completion", () => {
  const data = fixtureArtifact([], "identity-clipped", "pr");
  const result = validate(data, "pr");
  assert.equal(result.attempted, 2);
  assert.equal(result.unobservableCount, 2);
  assert.equal(data.samplingProfile.completionEligible, false);
  assert.throws(() => validate(data), /sampling metadata/);
  data.samplingProfile = { ...data.samplingProfile, sampleCount: 10 };
  assert.throws(() => validate(data, "pr"), /sampling metadata/);
});
