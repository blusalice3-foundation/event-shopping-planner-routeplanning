import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  comparableMetrics,
  compareBrowserEvidence,
} from "./compare-shopping-browser-evidence.mjs";
import {
  evidenceIdentity,
  summarizeSamples,
  validateEvidenceArtifact,
} from "./verify-shopping-performance-evidence.mjs";
function shopping(base = 10) {
  const raw = Array.from({ length: 20 }, (_, i) => base + i / 10),
    ops = ["execute", "executeRecord", "focus", "record", "next", "back"];
  return {
    ...evidenceIdentity("shopping"),
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
