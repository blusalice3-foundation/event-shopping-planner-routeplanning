// Comparison consumer only. This module is never part of a browser measurement.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateRunAcceptanceCriteriaMetadata } from "./shopping-performance-evidence-contract.mjs";

export const HISTORICAL_POLICY_TRANSITION = Object.freeze({
  id: "dnd-110-20261024-to-150-20261026",
  policyPath: "scripts/shopping-performance-evidence-contract.mjs",
  beforePolicySha256:
    "62316e459e82d89915a72986d61aa56dd86026907bd3e03c149618e122eae831",
  afterPolicySha256:
    "8b60ab9a246ff2fed865d8c4f35358c7a40a77fff0bc20584be823a5d0bb10ca",
  beforeCriteriaId: "dnd-selection-rendering-110-110-2026-10-24",
  afterCriteriaId: "dnd-selection-rendering-150-150-2026-10-26",
});
const LEGACY_MODULES = Object.freeze({
  "scripts/run-shopping-browser-evidence.mjs":
    "a20302166e2cb9d4b07af0157e72f7be4e34c0bf4e17de5eb87bdc46ca072ef6",
  "scripts/verify-shopping-performance-evidence.mjs":
    "08ce0118ec3dd6689a9b1cf9812b7d2a4354a0d0895b3ccc7e44146ef3e19e9e",
  "scripts/baseline-frame-performance-observations.mjs":
    "fbd49f58cf249d245a65587c1ff802673949bd8f91ef214fe8d49d3ca2db16c8",
  "scripts/baseline-shopping-performance-observations.mjs":
    "5cc0d09573c73f8e77a13411a41b858fad0ea455d84aff756f17b0be38055226",
  [HISTORICAL_POLICY_TRANSITION.policyPath]:
    HISTORICAL_POLICY_TRANSITION.beforePolicySha256,
});
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (root, args, bytes = false) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: bytes ? undefined : "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
const PRODUCER_SPECS = Object.freeze([
  "tests/browser/responsive-performance.spec.ts",
  "tests/browser/edit-execute-range-selection.spec.ts",
  "tests/browser/shopping-cross-column-drag.spec.ts",
  "tests/browser/shopping-transfer-rendering.performance.spec.ts",
  "tests/browser/shopping-transfer-accepted.performance.spec.ts",
  "tests/browser/shopping-transfer-terminal.performance.spec.ts",
]);
export function expectedHistoricalInventory(root, revision = "HEAD") {
  const transfers = git(root, [
    "ls-tree",
    "-r",
    "--name-only",
    revision,
    "--",
    "tests/browser",
  ])
    .trim()
    .split(/\r?\n/)
    .filter((name) => /^tests\/browser\/shopping-transfer-.*\.ts$/.test(name))
    .sort();
  const instrument = [
    ...new Set([
      ...PRODUCER_SPECS,
      "tests/browser/performance-summary.ts",
      "tests/browser/shopping-performance-evidence.ts",
      "tests/browser/shopping-operation-sampling.ts",
      "tests/browser/shopping-transfer-measurement.ts",
      "scripts/verify-shopping-performance-evidence.mjs",
      "scripts/baseline-frame-performance-observations.mjs",
      "scripts/baseline-shopping-performance-observations.mjs",
      "scripts/run-shopping-browser-evidence.mjs",
      HISTORICAL_POLICY_TRANSITION.policyPath,
      ...transfers,
    ]),
  ];
  const fixtures = [
    ...new Set([
      ...PRODUCER_SPECS,
      "tests/browser/shopping-operation-sampling.ts",
      ...transfers,
    ]),
  ];
  assert.equal(instrument.length, 24, "Unrecognized v3 instrument inventory");
  assert.equal(fixtures.length, 17, "Unrecognized v3 fixture inventory");
  return { instrument, fixtures, transferSources: transfers };
}
const replacements = Object.freeze([
  [
    "// Time budgets and workload conditions are unchanged. Sampling changed on 2026-10-26.\n",
    "// D&D budgets changed on 2026-10-26; shopping budgets and workload conditions are unchanged.\n// Sampling remains PR2/completion10 under its separate 2026-10-26 policy.\n",
  ],
  [
    'export const dndSelectionRenderingPerformanceCriteriaDate = "2026-10-24";',
    'export const dndSelectionRenderingPerformanceCriteriaDate = "2026-10-26";',
  ],
  ["  medianMs: 110,\n  p95Ms: 110,", "  medianMs: 150,\n  p95Ms: 150,"],
  [
    'acceptanceCriteriaId: "dnd-selection-rendering-110-110-2026-10-24",',
    'acceptanceCriteriaId: "dnd-selection-rendering-150-150-2026-10-26",',
  ],
]);
export function proveKnownPolicyTransition(beforeBytes, afterBytes) {
  assert.equal(
    hash(beforeBytes),
    HISTORICAL_POLICY_TRANSITION.beforePolicySha256,
    "Unrecognized historical policy bytes",
  );
  assert.equal(
    hash(afterBytes),
    HISTORICAL_POLICY_TRANSITION.afterPolicySha256,
    "Unrecognized current policy bytes",
  );
  let expected = beforeBytes.toString("utf8");
  for (const [before, after] of replacements) {
    assert.equal(
      expected.split(before).length - 1,
      1,
      "Known policy literal must occur exactly once",
    );
    expected = expected.replace(before, after);
  }
  assert.ok(
    Buffer.from(expected, "utf8").equals(afterBytes),
    "Policy transition changes more than the known budgets/date/ID/header",
  );
  return {
    ...HISTORICAL_POLICY_TRANSITION,
    byteExactKnownLiteralReplacement: true,
    replacementCount: replacements.length,
    unchanged: [
      "shopping65/100",
      "PR2/completion10",
      "conditions",
      "operations",
      "endpoints",
      "fixture inventory",
    ],
  };
}
function instrumentFiles(run, label) {
  const value = run.instrumentPatch;
  assert.match(
    value?.sha256 ?? "",
    /^[a-f0-9]{64}$/,
    `${label}:missing instrument aggregate`,
  );
  assert.ok(
    value.files &&
      typeof value.files === "object" &&
      !Array.isArray(value.files),
    `${label}:missing instrument file manifest`,
  );
  const names = Object.keys(value.files);
  assert.ok(names.length > 0, `${label}:empty instrument inventory`);
  for (const name of names) {
    assert.ok(
      !path.isAbsolute(name) &&
        !name.includes("\\") &&
        !name.includes(":") &&
        !name
          .split("/")
          .some((part) => part === ".." || part === "." || part === ""),
      `${label}:unsafe instrument path`,
    );
    assert.match(
      value.files[name],
      /^[a-f0-9]{64}$/,
      `${label}:invalid instrument file hash`,
    );
  }
  return value.files;
}
export async function loadBeforePolicyBridge({
  beforeRoot,
  afterRoot,
  beforePolicyRoot,
  currentPolicyPath,
  profile,
}) {
  const beforeRunBytes = await readFile(
    path.join(beforeRoot, "run-result.json"),
  );
  const afterRunBytes = await readFile(path.join(afterRoot, "run-result.json"));
  const beforeRun = JSON.parse(beforeRunBytes.toString("utf8"));
  const afterRun = JSON.parse(afterRunBytes.toString("utf8"));
  // Current after metadata is mandatory. The explicit switch never relaxes it.
  validateRunAcceptanceCriteriaMetadata(afterRun, { required: true, profile });
  assert.equal(beforeRun.phase, "before");
  assert.equal(afterRun.phase, "after");
  for (const [label, run] of [
    ["before", beforeRun],
    ["after", afterRun],
  ]) {
    assert.ok(
      ["passed", "failed"].includes(run.status) &&
        typeof run.finishedAt === "string" &&
        Number.isFinite(Date.parse(run.finishedAt)),
      `${label}:historical comparison requires a finished producer record`,
    );
  }
  assert.match(beforeRun.productCommit ?? "", /^[a-f0-9]{40}$/);
  const root = await realpath(beforePolicyRoot);
  assert.equal(
    await realpath(git(root, ["rev-parse", "--show-toplevel"]).trim()),
    root,
    "Historical policy root must be the Git worktree root",
  );
  assert.equal(
    git(root, ["rev-parse", "HEAD"]).trim(),
    beforeRun.productCommit,
    "Historical policy HEAD differs from the before producer",
  );
  assert.equal(
    git(root, ["status", "--porcelain=v1", "--untracked-files=all"]).trim(),
    "",
    "Historical policy worktree is not clean",
  );
  const beforeFiles = instrumentFiles(beforeRun, "before");
  const afterFiles = instrumentFiles(afterRun, "after");
  const expectedInventory = expectedHistoricalInventory(root);
  assert.deepEqual(
    Object.keys(beforeFiles),
    expectedInventory.instrument,
    "Before instrument inventory differs from the pinned runner and Git tree",
  );
  assert.deepEqual(
    Object.keys(afterFiles),
    expectedInventory.instrument,
    "After instrument inventory differs from the pinned runner and Git tree",
  );
  const policy = HISTORICAL_POLICY_TRANSITION.policyPath;
  assert.equal(
    beforeFiles[policy],
    HISTORICAL_POLICY_TRANSITION.beforePolicySha256,
    "Before instrument policy is not the known110 policy",
  );
  assert.equal(
    afterFiles[policy],
    HISTORICAL_POLICY_TRANSITION.afterPolicySha256,
    "After instrument policy is not the current150 policy",
  );
  assert.equal(
    beforeRun.fixtureSources?.sha256,
    afterRun.fixtureSources?.sha256,
    "Fixture sources differ",
  );
  assert.deepEqual(
    beforeRun.fixtureSources?.files,
    afterRun.fixtureSources?.files,
    "Fixture source file inventory differs",
  );
  const afterPolicyBytes = await readFile(currentPolicyPath);
  const beforeAggregate = createHash("sha256"),
    afterAggregate = createHash("sha256");
  const fileProofs = [];
  const originalBytes = new Map();
  let beforePolicyBytes;
  for (const name of Object.keys(beforeFiles)) {
    const disk = await readFile(path.join(root, name));
    const committed = git(root, ["show", `HEAD:${name}`], true);
    assert.ok(
      disk.equals(committed),
      `Historical module differs from Git:${name}`,
    );
    assert.equal(
      hash(disk),
      beforeFiles[name],
      `Historical module differs from measured manifest:${name}`,
    );
    originalBytes.set(name, disk);
    const next = name === policy ? afterPolicyBytes : disk;
    assert.equal(
      hash(next),
      afterFiles[name],
      `Non-policy instrument mismatch:${name}`,
    );
    beforeAggregate.update(name).update("\0").update(disk).update("\0");
    afterAggregate.update(name).update("\0").update(next).update("\0");
    fileProofs.push({
      path: name,
      beforeSha256: hash(disk),
      afterSha256: hash(next),
      policyOnlyDifference: name === policy,
    });
    if (name === policy) beforePolicyBytes = disk;
  }
  assert.equal(
    beforeAggregate.digest("hex"),
    beforeRun.instrumentPatch.sha256,
    "Before instrument aggregate does not bind the exact Git bytes",
  );
  assert.equal(
    afterAggregate.digest("hex"),
    afterRun.instrumentPatch.sha256,
    "After instrument aggregate has changes beyond the policy",
  );
  assert.ok(
    beforeRun.fixtureSources?.files &&
      Object.keys(beforeRun.fixtureSources.files).length > 0,
    "Missing full fixture manifest",
  );
  assert.deepEqual(
    Object.keys(beforeRun.fixtureSources.files),
    expectedInventory.fixtures,
    "Before fixture inventory differs from pinned v3",
  );
  assert.deepEqual(
    Object.keys(afterRun.fixtureSources.files),
    expectedInventory.fixtures,
    "After fixture inventory differs from pinned v3",
  );
  const fixtureAggregate = createHash("sha256");
  for (const [name, digest] of Object.entries(beforeRun.fixtureSources.files)) {
    assert.ok(
      name !== policy && originalBytes.has(name),
      "Fixture source is outside the unchanged measurement inventory",
    );
    assert.equal(
      digest,
      hash(originalBytes.get(name)),
      `Fixture file differs from measured Git bytes:${name}`,
    );
    fixtureAggregate
      .update(name)
      .update("\0")
      .update(originalBytes.get(name))
      .update("\0");
  }
  assert.equal(
    fixtureAggregate.digest("hex"),
    beforeRun.fixtureSources.sha256,
    "Fixture aggregate differs from exact unchanged Git bytes",
  );
  const transition = proveKnownPolicyTransition(
    beforePolicyBytes,
    afterPolicyBytes,
  );
  // The old verifier has four non-node source modules in its import graph.
  // Their bytes and the fixed producer runner are pinned before any legacy import.
  for (const [name, expected] of Object.entries(LEGACY_MODULES))
    assert.equal(
      beforeFiles[name],
      expected,
      `Unrecognized historical validator dependency:${name}`,
    );
  assert.equal(
    git(root, ["status", "--porcelain=v1", "--untracked-files=all"]).trim(),
    "",
    "Historical policy root changed before import",
  );
  // No legacy code is imported until Git, manifest, aggregate and full byte delta
  // proofs have all succeeded. Original before records are never rewritten.
  const legacyPolicy = await import(
    pathToFileURL(path.join(root, policy)).href
  );
  const legacyVerifier = await import(
    pathToFileURL(
      path.join(root, "scripts/verify-shopping-performance-evidence.mjs"),
    ).href
  );
  legacyPolicy.validateRunAcceptanceCriteriaMetadata(beforeRun, {
    required: true,
    profile,
  });
  return {
    legacyPolicy,
    legacyVerifier,
    beforeRunSha256: hash(beforeRunBytes),
    afterRunSha256: hash(afterRunBytes),
    proof: {
      id: transition.id,
      explicitBeforePolicyRoot: root,
      historicalHead: beforeRun.productCommit,
      originalBeforeInstrumentSha256: beforeRun.instrumentPatch.sha256,
      currentAfterInstrumentSha256: afterRun.instrumentPatch.sha256,
      transition,
      fileProofs,
      legacyValidatorDependencies: LEGACY_MODULES,
      expectedInventory,
      originalBeforeCriteria: beforeRun.acceptanceCriteriaByGroup,
      targetAfterCriteria: afterRun.acceptanceCriteriaByGroup,
      originalBeforeProducerStatus: beforeRun.status,
      rawRecordsRewritten: false,
      interpretation:
        "Validate before with its original110 policy, then separately re-evaluate unchanged numeric timing under current150. Functional failures, unobservable endpoints and incomplete evidence remain failures/unavailable.",
    },
  };
}
