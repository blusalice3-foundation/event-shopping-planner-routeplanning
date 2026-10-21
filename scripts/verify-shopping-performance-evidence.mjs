#!/usr/bin/env node
// Acceptance-only validation. Never imported by the application bundle.
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  expectedPerformanceCases,
  expectedPerformanceConditions,
  expectedTransferMetricNames,
  performanceConditionKey,
  performanceGroupSpecs,
  performanceAttachmentNames,
} from "./shopping-performance-evidence-contract.mjs";
export const SCHEMA_VERSION = 1;
export const INSTRUMENT_VERSION = "shopping-rendering-v1";
const ownPath = fileURLToPath(import.meta.url);
const groupSpecs = performanceGroupSpecs;
const attachmentNames = performanceAttachmentNames;
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
export const expectedConditions = expectedPerformanceConditions;
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
export const conditionKey = performanceConditionKey;
function validateFrameVisualProof(sample, condition) {
  assert(
    sample.frameVerified === true &&
      sample.controlsVerified === true &&
      typeof sample.frameTimestampMs === "number" &&
      Number.isFinite(sample.frameTimestampMs),
    "Frame evidence is missing verified visible content/controls",
  );
  const target = sample.visualTarget ?? "card";
  if (condition.scenario === "noop")
    assert(
      target === "endpoints",
      "Noop frame cannot claim source disappearance",
    );
  if (condition.scenario === "same-column")
    assert(
      target === "source-origin",
      "Same-column frame must describe its retained source origin",
    );
  if (target === "notice")
    assert(
      condition.scenario === "offscreen",
      "Notice proof is limited to offscreen scenarios",
    );
  if (target === "collapsed-header")
    assert(
      condition.scenario === "collapsed",
      "Header proof is limited to collapsed scenarios",
    );
  if (target === "card")
    assert(
      sample.sourceAbsent === true && sample.destinationOrderVerified === true,
      "Card frame lacks verified source absence or destination order",
    );
  else if (target === "source-origin")
    assert(
      sample.sourceAbsent === false &&
        sample.sourcePresent === true &&
        sample.sourceOriginVacated === true &&
        sample.orderVerified === true,
      "Same-column frame requires the retained item and its vacated origin/order",
    );
  else if (target === "endpoints")
    assert(
      sample.sourceAbsent === false &&
        sample.sourcePresent === true &&
        sample.selectionVerified === true &&
        sample.endpointsCleared === true,
      "Noop frame requires retained source/selection and cleared endpoints",
    );
  else if (target === "notice")
    assert(
      sample.logicalMoveVerified === true && sample.noticeVerified === true,
      "Offscreen frame lacks verified logical move/visible notice",
    );
  else if (target === "collapsed-header")
    assert(
      sample.logicalMoveVerified === true && sample.headerVerified === true,
      "Collapsed frame lacks verified logical move/visible group header",
    );
  else throw new Error("Unknown frame visualTarget");
}
function validatePreparedNextInput(sample, metric, condition, environment) {
  const expectedStrategy =
    (condition.scenario ?? "single") === "single"
      ? "anchor"
      : "topmost-visible-unmoved-destination";
  assert(
    typeof sample.nextInputId === "string" &&
      sample.nextInputId.length > 0 &&
      sample.nextInputStrategy === expectedStrategy &&
      Array.isArray(sample.expectedTransferredIds) &&
      sample.expectedTransferredIds.length > 0 &&
      sample.expectedTransferredIds.every(
        (id) => typeof id === "string" && id.length > 0,
      ) &&
      new Set(sample.expectedTransferredIds).size ===
        sample.expectedTransferredIds.length &&
      !sample.expectedTransferredIds.includes(sample.nextInputId),
    `${metric}: missing or invalid frozen unmoved next-input target/strategy`,
  );
  if (!["nextPending", "nextApplied"].includes(metric)) return;
  const prepared = sample.inputPreparation;
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const destination = condition.direction.split("-to-")[1];
  const validHit = (hit) =>
    hit?.itemId === sample.nextInputId &&
    hit.column === destination &&
    hit.tagName === "INPUT" &&
    hit.type === "checkbox" &&
    hit.exactInput === true;
  assert(
    sample.targetId === sample.nextInputId &&
      prepared?.targetId === sample.nextInputId &&
      prepared.hitTestMatched === true &&
      prepared.checked === (metric === "nextApplied") &&
      validHit(prepared.actualHit) &&
      validHit(sample.actualHit),
    `${metric}: prepared/event checkbox identity, column or checked state mismatch`,
  );
  assert(
    prepared.rect &&
      [
        prepared.rect.x,
        prepared.rect.y,
        prepared.rect.width,
        prepared.rect.height,
      ].every(finite) &&
      prepared.rect.width > 0 &&
      prepared.rect.height > 0 &&
      finite(prepared.viewport?.width) &&
      finite(prepared.viewport?.height) &&
      prepared.viewport.width === environment.viewport.width &&
      prepared.viewport.height === environment.viewport.height &&
      finite(prepared.point?.x) &&
      finite(prepared.point?.y) &&
      prepared.point.x > 0 &&
      prepared.point.x < prepared.viewport.width &&
      prepared.point.y > 0 &&
      prepared.point.y < prepared.viewport.height &&
      sameNumber(prepared.point.x, prepared.rect.x + prepared.rect.width / 2) &&
      sameNumber(prepared.point.y, prepared.rect.y + prepared.rect.height / 2),
    `${metric}: prepared checkbox center/viewport geometry is invalid`,
  );
  assert(
    finite(sample.inputPoint?.x) &&
      finite(sample.inputPoint?.y) &&
      Math.abs(sample.inputPoint.x - prepared.point.x) <= 1 &&
      Math.abs(sample.inputPoint.y - prepared.point.y) <= 1 &&
      finite(sample.queueDelayMs) &&
      sample.queueDelayMs >= 0 &&
      sample.queueDelayMs <= sample.durationMs,
    `${metric}: actual click point or event queue delay does not match preparation`,
  );
}
const terminalScenarios = new Set(["noop", "reject", "cancel", "same-column"]);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const finitePoint = (point) =>
  Number.isFinite(point?.x) && Number.isFinite(point?.y);
const positiveRect = (rect) =>
  finitePoint(rect) &&
  Number.isFinite(rect?.width) &&
  rect.width > 0 &&
  Number.isFinite(rect?.height) &&
  rect.height > 0;
const uniqueStrings = (ids) =>
  Array.isArray(ids) &&
  ids.every((id) => typeof id === "string" && id.length > 0) &&
  new Set(ids).size === ids.length;
const sameMembers = (a, b) =>
  uniqueStrings(a) &&
  uniqueStrings(b) &&
  a.length === b.length &&
  a.every((id) => b.includes(id));
export function validateTransferSourceProof(sample, environment) {
  const observation = sample.gestureObservation;
  const proof = observation?.sourceHitTest;
  const attempts = proof?.attempts;
  const selected = proof?.selectedHit;
  const viewport = environment?.viewport;
  assert(
    typeof proof?.sourceId === "string" &&
      sample.expectedTransferredIds?.includes(proof.sourceId) &&
      positiveRect(proof.sourceRect) &&
      Array.isArray(attempts) &&
      attempts.length > 0 &&
      attempts.length <= 7 &&
      selected &&
      sameJson(selected, attempts.at(-1)) &&
      attempts.slice(0, -1).every((attempt) => attempt.matched === false) &&
      sameJson(
        proof.initialRejection,
        attempts[0].matched ? null : attempts[0],
      ),
    "Missing or inconsistent real source-origin attempts",
  );
  for (const attempt of attempts) {
    const point = attempt.point;
    const withinSource =
      finitePoint(point) &&
      point.x > proof.sourceRect.x &&
      point.x < proof.sourceRect.x + proof.sourceRect.width &&
      point.y > proof.sourceRect.y &&
      point.y < proof.sourceRect.y + proof.sourceRect.height;
    const withinViewport =
      finitePoint(point) &&
      point.x > 0 &&
      point.x < viewport?.width &&
      point.y > 0 &&
      point.y < viewport?.height;
    assert(
      ["card-edge", "drag-handle", "card-body"].includes(attempt.origin) &&
        attempt.withinSource === withinSource &&
        attempt.withinViewport === withinViewport &&
        typeof attempt.interactive === "boolean" &&
        typeof attempt.sourceContainsHit === "boolean" &&
        typeof attempt.sourceOwnerMatched === "boolean" &&
        (attempt.sourceOwnerMatched !== true ||
          attempt.hitItemId === proof.sourceId) &&
        (attempt.matched !== true ||
          (withinSource &&
            withinViewport &&
            attempt.sourceContainsHit === true &&
            attempt.sourceOwnerMatched === true &&
            attempt.interactive === false &&
            positiveRect(attempt.hitRect))),
      "Source-origin hit-test flags do not prove its actual source owner",
    );
  }
  assert(
    selected.matched === true &&
      selected.hitItemId === proof.sourceId &&
      observation.sourceOrigin === selected.origin &&
      sameJson(observation.sourcePoint, selected.point),
    "Trusted drag source point does not match its selected real source hit",
  );
}
export function validateAcceptedScenarioProof(sample, condition) {
  const scenario = condition.scenario ?? "single";
  if (scenario === "single" || terminalScenarios.has(scenario)) return;
  const proof = sample.durableProof;
  const selection = proof?.selectionPreparation;
  const effectiveCount = ["range", "mixed"].includes(scenario)
    ? 3
    : ["collapsed", "auto-scroll"].includes(scenario)
      ? 1
      : 2;
  const requestedCount = scenario === "same-visit-merge" ? 1 : effectiveCount;
  const requested = selection?.requestedIds;
  const moved = sample.expectedTransferredIds;
  const checks = selection?.checkboxChecks;
  const label =
    requestedCount === effectiveCount
      ? `${requestedCount}件`
      : `選択${requestedCount}件（移動${effectiveCount}件）`;
  assert(
    proof?.fullItemContentPreserved === true &&
      uniqueStrings(proof.actualItemOrder) &&
      proof.actualItemOrder.length === condition.count &&
      uniqueStrings(proof.actualExecuteIds) &&
      proof.actualExecuteIds.every((id) =>
        proof.actualItemOrder.includes(id),
      ) &&
      uniqueStrings(moved) &&
      moved.length === effectiveCount &&
      uniqueStrings(requested) &&
      requested.length === requestedCount &&
      requested.every((id) => moved.includes(id)) &&
      selection.exactSelectionVerified === true &&
      selection.requestedCount === requestedCount &&
      selection.effectiveCount === effectiveCount &&
      typeof selection.headerText === "string" &&
      selection.headerText.endsWith(`(${label})`) &&
      Array.isArray(checks) &&
      sameMembers(
        checks.map((entry) => entry.targetId),
        requested,
      ) &&
      checks.every(
        (entry) =>
          entry.checked === true &&
          Number.isFinite(entry.scrollY) &&
          positiveRect(entry.rect),
      ) &&
      sameMembers(selection.requestedDisplayOrder, requested) &&
      uniqueStrings(selection.mountedCheckedIds) &&
      sameJson(
        selection.mountedCheckedIds,
        selection.requestedDisplayOrder.filter((id) =>
          selection.mountedCheckedIds.includes(id),
        ),
      ) &&
      sameJson(sample.scenarioEvidence?.selectionPreparation, selection),
    "Accepted scenario lacks exact actual-checkbox/parent-count selection preparation",
  );
  if (
    scenario === "offscreen" &&
    condition.direction === "candidate-to-execute"
  ) {
    const restored = selection.scrollRestoration;
    assert(
      Number.isFinite(restored?.before) &&
        Number.isFinite(restored?.after) &&
        Math.abs(restored.before - restored.after) <= 1 &&
        restored.sourceVisible === true &&
        restored.anchorVisible === true &&
        checks[1].scrollY > checks[0].scrollY,
      "Offscreen candidate was not actually checked and returned to the source viewport",
    );
  }
  if (scenario === "offscreen") {
    const evidence = sample.scenarioEvidence;
    const identity = proof.offscreenIdentityProof;
    const box = evidence?.targetBounds;
    const viewport = evidence?.viewport;
    assert(
      evidence?.offscreenBeforeDrop === true &&
        typeof evidence.offscreenTargetId === "string" &&
        typeof evidence.targetMounted === "boolean" &&
        (evidence.targetMounted
          ? positiveRect(box) &&
            viewport?.width > 0 &&
            viewport?.height > 0 &&
            (box.y + box.height <= 0 || box.y >= viewport.height)
          : box === null) &&
        identity?.target === evidence.offscreenTargetId &&
        moved.includes(identity.source) &&
        identity.targetMembership === true &&
        identity.beforeItemPreserved === true &&
        typeof identity.sourceNumber === "string" &&
        typeof identity.targetNumber === "string" &&
        identity.sourceNumber.replace(/([a-zA-Z])\d+$/, "$1") ===
          identity.targetNumber.replace(/([a-zA-Z])\d+$/, "$1") &&
        proof.mergeProof?.some((pair) =>
          sameJson(
            pair,
            Object.fromEntries(
              Object.entries(identity).filter(
                ([key]) => key !== "beforeItemPreserved",
              ),
            ),
          ),
        ),
      "Offscreen destination lacks no-wait viewport observation and durable identity proof",
    );
  }
  const tail = proof.mergeTailProof;
  assert(
    Array.isArray(tail),
    "Accepted scenario is missing direction-specific order proof",
  );
  if (condition.direction === "execute-to-candidate") {
    const order = proof.candidateOrderProof;
    assert(
      tail.length === 0 &&
        order?.contract === "candidate-raw-boundary-and-default-display" &&
        order.rawOrderVerified === true &&
        order.defaultDisplayOrderVerified === true &&
        uniqueStrings(order.expectedItemOrder) &&
        order.expectedItemOrder.length === condition.count &&
        sameJson(order.actualItemOrder, order.expectedItemOrder) &&
        sameJson(proof.actualItemOrder, order.actualItemOrder) &&
        uniqueStrings(order.expectedExecuteIds) &&
        sameJson(order.actualExecuteIds, order.expectedExecuteIds) &&
        sameJson(proof.actualExecuteIds, order.actualExecuteIds) &&
        uniqueStrings(order.expectedRawCandidateIds) &&
        sameJson(order.actualRawCandidateIds, order.expectedRawCandidateIds) &&
        sameJson(
          order.actualItemOrder.filter(
            (id) => !order.actualExecuteIds.includes(id),
          ),
          order.actualRawCandidateIds,
        ) &&
        sameMembers(order.expectedDisplayIds, order.expectedRawCandidateIds) &&
        uniqueStrings(order.actualMountedDisplayIds) &&
        sameJson(
          order.actualMountedDisplayIds,
          order.expectedDisplayIds.filter((id) =>
            order.actualMountedDisplayIds.includes(id),
          ),
        ) &&
        sameMembers(order.sourceIds, moved) &&
        uniqueStrings(order.displayedBeforeIds) &&
        ["next-displayed-row", "collapsed-first-member"].includes(
          order.boundaryKind,
        ) &&
        order.displayedBeforeIds.includes(order.anchorId),
      "Reverse scenario does not independently prove full raw order and numeric display order",
    );
    const boundary =
      order.boundaryKind === "collapsed-first-member"
        ? order.anchorId
        : (order.displayedBeforeIds[
            order.displayedBeforeIds.indexOf(order.anchorId) + 1
          ] ?? null);
    const start = order.expectedRawCandidateIds.indexOf(order.sourceIds[0]);
    assert(
      boundary === order.boundaryId &&
        start >= 0 &&
        sameJson(
          order.expectedRawCandidateIds.slice(start, start + moved.length),
          order.sourceIds,
        ) &&
        (boundary === null
          ? start + moved.length === order.expectedRawCandidateIds.length
          : order.expectedRawCandidateIds[start + moved.length] === boundary),
      "Reverse scenario moved block does not precede its independent candidate boundary",
    );
  } else {
    const expectedTailCount =
      scenario === "same-visit-merge"
        ? 1
        : ["multiple-merge", "mixed", "offscreen"].includes(scenario)
          ? 2
          : 0;
    assert(
      proof.candidateOrderProof === null && tail.length === expectedTailCount,
      "Forward scenario is missing its existing visit-tail contract",
    );
    for (const visit of tail) {
      assert(
        uniqueStrings(visit.existingIds) &&
          visit.existingIds.length > 0 &&
          uniqueStrings(visit.appendedIds) &&
          visit.appendedIds.length > 0 &&
          visit.appendedIds.every((id) => moved.includes(id)) &&
          sameJson(visit.expectedIds, [
            ...visit.existingIds,
            ...visit.appendedIds,
          ]) &&
          sameJson(visit.durableIds, visit.expectedIds) &&
          uniqueStrings(visit.mountedIds) &&
          sameJson(
            visit.mountedIds,
            visit.expectedIds.filter((id) => visit.mountedIds.includes(id)),
          ),
        "Forward merge did not append after the existing durable visit tail",
      );
    }
  }
}
function validateTransferPhaseProofs(artifact, condition) {
  const preparedNextInput =
    artifact.measurementKind === "response" &&
    !["noop", "reject", "cancel", "same-column"].includes(condition.scenario);
  const noSave = ["noop", "reject", "cancel"].includes(condition.scenario);
  if (noSave) {
    assert(
      typeof artifact.notApplicable?.save === "string" &&
        artifact.notApplicable.save.length > 0 &&
        typeof artifact.notApplicable?.nextPending === "string" &&
        artifact.notApplicable.nextPending.length > 0,
      "No-save cases must explicitly mark save/pending timings not applicable",
    );
    assert(
      artifact.persistence?.writeCount === 0 &&
        artifact.persistence.operationId === null &&
        Array.isArray(artifact.persistence.commits) &&
        artifact.persistence.commits.length === 0,
      "No-save case contains a write or fabricated operation ID",
    );
  }
  const byId = new Map();
  for (const [metric, values] of Object.entries(artifact.metrics))
    for (const sample of values.samples) {
      if (!byId.has(sample.measurementId)) byId.set(sample.measurementId, {});
      byId.get(sample.measurementId)[metric] = sample;
      if (!terminalScenarios.has(condition.scenario)) {
        validateTransferSourceProof(sample, artifact.environment);
        validateAcceptedScenarioProof(sample, condition);
      }
      if (preparedNextInput)
        validatePreparedNextInput(
          sample,
          metric,
          condition,
          artifact.environment,
        );

      assert(
        typeof sample.startEpoch === "number" &&
          Number.isFinite(sample.startEpoch) &&
          sample.startEpoch >= 0 &&
          Array.isArray(sample.commits),
        `${metric}: missing input/commit phase proof`,
      );
      if (noSave) {
        assert(
          sample.commits.length === 0 &&
            sample.physicalWriteCount === 0 &&
            sample.operationId === null,
          `${metric}: no-save sample wrote persistence or fabricated an operation ID`,
        );
        if (metric === "response") {
          assert(
            Array.isArray(sample.selectionBeforeIds) &&
              sample.selectionBeforeIds.length > 0 &&
              JSON.stringify(sample.selectionBeforeIds) ===
                JSON.stringify(sample.selectionAfterIds),
            "No-save sample lost its frozen selection",
          );
          assert(
            sample.guideCleared === true &&
              sample.cloneCleared === true &&
              sample.sourceInteractive === true,
            "No-save sample did not restore interactive drag state",
          );
          assert(
            condition.scenario === "noop"
              ? sample.endpointsCleared === true
              : sample.endpointsRetained === true,
            "No-save sample has incorrect endpoint state",
          );
        }
        if (metric === "nextApplied")
          assert(
            typeof sample.eventEpoch === "number" &&
              Number.isFinite(sample.eventEpoch) &&
              sample.eventEpoch > sample.startEpoch &&
              sample.trusted === true,
            "No-save next input did not follow cleanup",
          );
      } else {
        assert(
          sample.commits.length === 1 &&
            typeof sample.commits[0].at === "number" &&
            Number.isFinite(sample.commits[0].at) &&
            sample.commits[0].at >= sample.startEpoch,
          `${metric}: expected exactly one attributable save transaction`,
        );
        const saved = sample.commits[0].at;
        assert(
          (typeof sample.operationId === "string" &&
            sample.operationId.length > 0) ||
            (sample.operationId === null &&
              typeof sample.operationIdUnavailableReason === "string" &&
              sample.operationIdUnavailableReason.length > 0),
          `${metric}: missing operation ID attribution or unavailability reason`,
        );
        const committedOperationId = sample.commits[0].operationId;
        assert(
          typeof committedOperationId === "string" &&
            committedOperationId.length > 0
            ? sample.operationId === committedOperationId
            : sample.operationId === null,
          `${metric}: operation ID does not match its observed save transaction`,
        );
        if (metric === "nextPending")
          assert(
            sample.trusted === true &&
              typeof sample.eventEpoch === "number" &&
              Number.isFinite(sample.eventEpoch) &&
              sample.eventEpoch > sample.startEpoch &&
              sample.eventEpoch < saved,
            "Pending input was not sent/received during this move's save",
          );
        if (metric === "nextApplied")
          assert(
            sample.trusted === true &&
              typeof sample.eventEpoch === "number" &&
              Number.isFinite(sample.eventEpoch) &&
              sample.eventEpoch > saved,
            "Applied input preceded this move's save completion",
          );
        if (metric === "save")
          assert(
            sameNumber(sample.durationMs, saved - sample.startEpoch),
            "Save timing does not match its transaction completion",
          );
      }
    }
  for (const samples of byId.values()) {
    const first = Object.values(samples)[0];
    for (const sample of Object.values(samples))
      if (first.startEpoch !== undefined)
        assert(
          sample.startEpoch === first.startEpoch &&
            JSON.stringify(sample.commits) === JSON.stringify(first.commits) &&
            sample.operationId === first.operationId,
          "Metric samples mixed different moves or save transactions",
        );
    if (preparedNextInput)
      for (const sample of Object.values(samples))
        assert(
          sample.nextInputId === first.nextInputId &&
            sample.nextInputStrategy === first.nextInputStrategy &&
            JSON.stringify(sample.expectedTransferredIds) ===
              JSON.stringify(first.expectedTransferredIds),
          "Metric samples mixed different next-input preparations or moved IDs",
        );
    if (samples.nextPending && samples.nextApplied)
      assert(
        samples.nextPending.targetId === samples.nextApplied.targetId,
        "Next inputs targeted different items",
      );
    if (samples.response && samples.save)
      assert(
        samples.response.targetId === samples.save.targetId,
        "Save timing belongs to a different moved target",
      );
  }
}
export function validateBrowserArtifactEnvironment(environment) {
  for (const field of ["browserVersion", "userAgent", "browserChannel"])
    assert(
      typeof environment?.[field] === "string" && environment[field].length > 0,
      `Artifact environment ${field} is missing`,
    );
  assert(
    environment.viewport &&
      [environment.viewport.width, environment.viewport.height].every(
        (value) =>
          typeof value === "number" && Number.isFinite(value) && value > 0,
      ),
    "Artifact environment viewport is missing or invalid",
  );
  assert(
    typeof environment.devicePixelRatio === "number" &&
      Number.isFinite(environment.devicePixelRatio) &&
      environment.devicePixelRatio > 0,
    "Artifact environment devicePixelRatio is missing or invalid",
  );
  assert(
    typeof environment.headed === "boolean" &&
      environment.workers === 1 &&
      environment.retries === 0,
    "Artifact environment headed/workers/retries is missing or invalid",
  );
}
// Budget reporting is used only by before/after comparison; acceptance verification always enforces budgets.
export function validateEvidenceArtifact(
  artifact,
  group,
  identity = {},
  { enforceBudgets = true } = {},
) {
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
  assert(!artifact.failure, "Artifact records an incomplete measurement");
  validateBrowserArtifactEnvironment(artifact.environment);
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
        enforceBudgets,
      );
      validateMetric(
        artifact.uiTimings[op],
        artifact.uiSummary[op],
        `${op}/ui`,
        enforceBudgets,
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
      validateMetric(
        artifact.timings[op],
        artifact.summary[op],
        op,
        enforceBudgets,
      );
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
      validateMetric(
        artifact.records[op]?.samples,
        artifact.records[op],
        op,
        enforceBudgets,
      );
    assert(
      Array.isArray(artifact.start) &&
        artifact.start.length >= 20 &&
        Array.isArray(artifact.end) &&
        artifact.end.length === artifact.start.length,
      "Drag start/end details missing",
    );
  } else {
    const ops = expectedTransferMetricNames(condition, kind);
    keysEqual(artifact.metrics, ops, "metrics");
    for (const op of ops) {
      const metric = artifact.metrics[op];
      validateMetric(
        metric?.raw,
        metric?.summary,
        op,
        op !== "save" && enforceBudgets,
      );
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
        if (kind === "frame") validateFrameVisualProof(sample, condition);
      });
      assert(
        new Set(metric.samples.map((sample) => sample.measurementId)).size ===
          metric.samples.length,
        `${op}: duplicate samples`,
      );
    }
  }
  if (group === "transfer") validateTransferPhaseProofs(artifact, condition);
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
export async function verifyFrameFiles(artifact, outputRoot, hashes) {
  const root = await realpath(outputRoot);
  const cache = new Map();
  async function checkedFile(sample, name) {
    const filename = sample[`${name}Path`];
    const expectedHash = sample[`${name}Sha256`];
    assert(
      typeof filename === "string" && /^[a-f0-9]{64}$/.test(expectedHash ?? ""),
      `Frame ${name} file/hash is missing`,
    );
    const actual = await realpath(path.resolve(filename));
    assert(
      inside(root, actual),
      `Frame ${name} file escaped its group's test-results directory`,
    );
    let bytes = cache.get(actual);
    if (!bytes) {
      bytes = await readFile(actual);
      cache.set(actual, bytes);
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert(digest === expectedHash, `Frame ${name} hash mismatch`);
    hashes[path.relative(outputRoot, actual)] = digest;
    return bytes;
  }
  for (const sample of artifact.metrics.frame.samples) {
    const traceBytes = await checkedFile(sample, "trace");
    await checkedFile(sample, "frame");
    await checkedFile(sample, "reference");
    await checkedFile(sample, "baseline");
    const events = JSON.parse(traceBytes.toString("utf8")).traceEvents;
    assert(Array.isArray(events), "Frame trace events missing");
    const correlation = sample.correlation;
    assert(
      correlation &&
        sample.paintCorrelated === true &&
        sample.drawFrameCorrelated === true,
      "Frame correlation missing",
    );
    const find = (name, point) =>
      events.find(
        (event) =>
          event.name === name &&
          event.pid === point?.pid &&
          event.ts === point?.ts,
      );
    const input = find(`${sample.measurementId}:input`, correlation.input);
    const dom = find(`${sample.measurementId}:dom`, correlation.dom);
    const paint = find("Paint", correlation.paint);
    const draw = find("DrawFrame", correlation.drawFrame);
    assert(
      sample.captureMethod === "Page.startScreencast(png)",
      "Acceptance frame captureMethod must be Page.startScreencast(png)",
    );
    if (sample.captureMethod === "Page.startScreencast(png)") {
      const metadataBytes = await checkedFile(sample, "frameMetadata");
      const savedMetadata = JSON.parse(metadataBytes.toString("utf8"));
      const timestamp = savedMetadata.metadata?.timestamp;
      assert(
        savedMetadata.method === "Page.startScreencast" &&
          savedMetadata.format === "png" &&
          savedMetadata.maxWidth === 1440 &&
          savedMetadata.maxHeight === 1000 &&
          savedMetadata.everyNthFrame === 1 &&
          savedMetadata.acknowledged === true &&
          savedMetadata.frameSha256 === sample.frameSha256 &&
          typeof timestamp === "number" &&
          Number.isFinite(timestamp),
        "Screencast frame metadata is missing or incompatible",
      );
      const sourcePaint = find("Paint", correlation.sourcePaint);
      const framePoint = correlation.frame;
      const traceTs =
        input?.ts +
        (timestamp * 1000 - sample.startEpoch - sample.markerDelayMs) * 1000;
      const covers = (event, rect) => {
        const clip = event?.args?.data?.clip;
        if (
          !Array.isArray(clip) ||
          clip.length < 8 ||
          !rect ||
          ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
          rect.width <= 0 ||
          rect.height <= 0
        )
          return false;
        const xs = clip.filter((_, i) => i % 2 === 0),
          ys = clip.filter((_, i) => i % 2 === 1);
        return (
          Math.min(...xs) <= rect.x &&
          Math.max(...xs) >= rect.x + rect.width &&
          Math.min(...ys) <= rect.y &&
          Math.max(...ys) >= rect.y + rect.height
        );
      };
      assert(
        sample.captureTimestampKind === "frame-swap-upper-bound" &&
          input &&
          dom &&
          paint &&
          sourcePaint &&
          draw &&
          framePoint &&
          savedMetadata.sessionId === framePoint.sessionId &&
          sameNumber(framePoint.epochMs, timestamp * 1000) &&
          sameNumber(framePoint.traceTs, traceTs) &&
          input.pid === dom.pid &&
          dom.pid === paint.pid &&
          paint.pid === sourcePaint.pid &&
          sourcePaint.pid === draw.pid &&
          input.ts <= dom.ts &&
          dom.ts <= Math.min(paint.ts, sourcePaint.ts) &&
          Math.max(paint.ts, sourcePaint.ts) <= draw.ts &&
          draw.ts <= framePoint.traceTs &&
          covers(paint, correlation.targetRect) &&
          covers(sourcePaint, correlation.sourceRect),
        "Screencast frame DOM/Paint/DrawFrame correlation mismatch",
      );
      if (["card", "source-origin"].includes(sample.visualTarget ?? "card")) {
        const visible = sample.visibleTransferredIds;
        const sources = sample.visibleSourceIds;
        const proofs = correlation.targetProofs;
        const sourceProofs = correlation.sourceProofs;
        const scores = correlation.comparison?.scores;
        const uniqueIds = (ids) =>
          Array.isArray(ids) &&
          ids.length > 0 &&
          ids.every((id) => typeof id === "string" && id.length > 0) &&
          new Set(ids).size === ids.length;
        const insideRect = (outer, inner) =>
          inner &&
          [inner.x, inner.y, inner.width, inner.height].every(
            Number.isFinite,
          ) &&
          inner.width > 0 &&
          inner.height > 0 &&
          inner.x >= outer.x &&
          inner.y >= outer.y &&
          inner.x + inner.width <= outer.x + outer.width &&
          inner.y + inner.height <= outer.y + outer.height;
        const checkedProof = (proof, id, scoreIndex, role, field) => {
          const actualPaint = find("Paint", proof.paint);
          const score = scores[proof.scoreIndex];
          return (
            proof[field] === id &&
            proof.scoreIndex === scoreIndex &&
            proof.paint?.itemId === id &&
            actualPaint?.pid === dom.pid &&
            dom.ts <= actualPaint.ts &&
            actualPaint.ts <= draw.ts &&
            covers(actualPaint, proof.rect) &&
            score?.itemId === id &&
            score.role === role &&
            ["x", "y", "width", "height"].every((key) =>
              sameNumber(score.rect?.[key], proof.rect?.[key]),
            ) &&
            insideRect(proof.rect, score.identityRect) &&
            Array.isArray(score.controlRects) &&
            score.controlRects.length === 2 &&
            score.controlRects.every((rect) => insideRect(proof.rect, rect))
          );
        };
        assert(
          sample.allVisibleDestinationCardsVerified === true &&
            uniqueIds(sample.expectedTransferredIds) &&
            uniqueIds(visible) &&
            uniqueIds(sources) &&
            Array.isArray(proofs) &&
            proofs.length === visible.length &&
            Array.isArray(sourceProofs) &&
            sourceProofs.length === sources.length &&
            Array.isArray(scores) &&
            scores.length === sources.length + visible.length &&
            sourceProofs.every((proof, index) =>
              checkedProof(
                proof,
                sources[index],
                index,
                sample.visualTarget === "source-origin"
                  ? "source-origin"
                  : "source-gap",
                "sourceId",
              ),
            ) &&
            proofs.every((proof, index) =>
              checkedProof(
                proof,
                visible[index],
                sources.length + index,
                "destination-card",
                "targetId",
              ),
            ) &&
            (!Array.isArray(sample.expectedTransferredIds) ||
              [...sources, ...visible].every((id) =>
                sample.expectedTransferredIds.includes(id),
              )),
          "Every visible moved source/destination requires its own identity/control image and covering Paint proof",
        );
      }
      assert(
        sameNumber(sample.durationMs, timestamp * 1000 - sample.startEpoch) &&
          sameNumber(sample.durationMs, sample.frameTimestampMs),
        "Screencast frame timestamp mismatch",
      );
      assert(
        Array.isArray(correlation.comparison?.scores) &&
          correlation.comparison.scores.every(
            (score) =>
              Array.isArray(score.controlErrors) &&
              score.controlErrors.length === 2 &&
              score.controlErrors.every(
                (error) =>
                  typeof error === "number" &&
                  Number.isFinite(error) &&
                  error >= 0 &&
                  error <= 0.025,
              ),
          ),
        "Screencast controls were not verified",
      );
    }
    const scores = correlation.comparison?.scores;
    assert(
      correlation.comparison?.matched === true &&
        Array.isArray(scores) &&
        scores.length ===
          (sample.captureMethod === "Page.startScreencast(png)" &&
          ["card", "source-origin"].includes(sample.visualTarget ?? "card")
            ? sample.visibleSourceIds.length +
              sample.visibleTransferredIds.length
            : 2) &&
        scores.every(
          (score) =>
            Number.isFinite(score.frameError) &&
            Number.isFinite(score.baselineError) &&
            score.baselineError > 0.001 &&
            score.frameError >= 0 &&
            score.frameError <= 0.025 &&
            score.frameError < score.baselineError * 0.55,
        ),
      "Frame source/destination image comparison is missing or invalid",
    );
  }
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
    const expected = expectedPerformanceCases(group).map((row) => row.key);
    assert(
      tests.length === expected.length,
      `Expected ${expected.length} tests, found ${tests.length}`,
    );
    const seen = new Set();
    for (const { spec, test } of tests) {
      assert(
        groupSpecs[group].includes(path.basename(spec.file ?? "")),
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
      if (group === "transfer" && artifact.measurementKind === "frame")
        await verifyFrameFiles(
          artifact,
          path.join(groupRoot, "test-results"),
          result.hashes,
        );
      const validated = validateEvidenceArtifact(artifact, group, {
        phase,
        runId,
      });
      assert(
        expected.includes(validated.key) &&
          expectedPerformanceCases(group).find(
            (row) => row.key === validated.key,
          )?.spec === path.basename(spec.file ?? "") &&
          !seen.has(validated.key),
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
