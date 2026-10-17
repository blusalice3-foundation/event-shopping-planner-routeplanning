import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { parseSpreadsheetPaste as before } from "./before/pasteColumns.ts";
import { parseSpreadsheetPaste as after } from "../../../src/features/events/pasteColumns.ts";

const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, medianMs: sorted[Math.ceil(sorted.length * 0.5) - 1], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] };
};
const results = [];
for (const count of [150, 500]) {
  const rows = Array.from({ length: count }, (_, i) => `サークル${i}\t1日目\t東A\t${i}\t品目${i}\t1000\t備考`);
  for (const gaps of [false, true]) {
    const text = rows.join(gaps ? "\n\n" : "\n") + "\r\n";
    const baseline = before(text);
    const updated = after(text);
    assert.equal(baseline.ok, true);
    assert.equal(updated.ok, true);
    assert.equal(updated.columns.circles.split("\n").length, gaps ? count * 2 - 1 : count);
    if (!gaps) assert.deepEqual(updated, baseline);
    for (let i = 0; i < 100; i++) { before(text); after(text); }
    const raw = { before: [], after: [] };
    const measure = (name, parse) => { const start = performance.now(); parse(text); raw[name].push(performance.now() - start); };
    for (let i = 0; i < 200; i++) {
      if (i % 2) { measure("after", after); measure("before", before); }
      else { measure("before", before); measure("after", after); }
    }
    results.push({ count, gaps, physicalRows: gaps ? count * 2 - 1 : count, comparableColumns: !gaps, raw, summary: { before: summarize(raw.before), after: summarize(raw.after) } });
  }
}
console.log(JSON.stringify({ node: process.version, unit: "milliseconds per parser call", note: "Blank-row output intentionally differs; parser time excludes React, saving and network.", results }, null, 2));