import ts from "typescript";
import { performance } from "node:perf_hooks";
const input = JSON.parse(process.env.ESP_MATCHING_BENCHMARK_INPUT);
function compile(source, dependencies = {}) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  new Function("require", "exports", outputText)((name) => {
    if (!(name in dependencies)) throw new Error("Unexpected import " + name);
    return dependencies[name];
  }, exports);
  return exports;
}
const keys = compile(input.itemComparison.split("const locationCollator")[0]);
const before = compile(input.before, { "../../utils/itemComparison": keys }).matchSheetItems;
const after = compile(input.after, { "../../utils/itemComparison": keys }).matchSheetItems;
const percentile = (samples, fraction) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * fraction) - 1];
const summarize = (samples) => ({ count: samples.length, medianMs: percentile(samples, .5), p95Ms: percentile(samples, .95) });
const result = [];
for (const count of [150, 1500]) {
  for (const scenario of ["unique-titles", "verified-duplicate-titles", "historic-inferred-values", "identical-input-effects"]) {
    const current = Array.from({ length: count }, (_, index) => ({
      id: String(index), circle: "Circle-" + Math.floor(index / 2), eventDate: "Day1", block: "A", number: "01",
      title: scenario === "unique-titles" ? "Book-" + index : "Same book",
      price: index % 2 ? 500 : 700, remarks: "User note " + index, source: "spreadsheet",
      catalogPrice: scenario === "identical-input-effects" ? 500 : index % 2 ? 700 : 500,
      sheetRemarks: "Sheet note", quantity: index % 2 ? 5 : 2, purchaseStatus: "None",
      ...(scenario === "historic-inferred-values" ? {} : { sheetIdentityVerified: true }),
    }));
    if (scenario === "historic-inferred-values")
      for (const item of current) item.catalogPrice = item.price;
    const incoming = current.map((item, index) => ({
      circle: item.circle, eventDate: item.eventDate, block: item.block, number: item.number, title: item.title,
      price: scenario === "identical-input-effects" ? 500 : index % 2 ? 700 : 500,
      catalogPrice: scenario === "identical-input-effects" ? 500 : index % 2 ? 700 : 500,
      remarks: "Sheet note", sheetRemarks: "Sheet note", sheetIdentityVerified: true,
      quantity: scenario === "identical-input-effects" ? 2 : item.quantity,
    })).reverse();
    const samples = { before: [], after: [] };
    const outcomes = {};
    for (let iteration = -10; iteration < 40; iteration++) {
      const order = iteration % 2 ? [["after", after], ["before", before]] : [["before", before], ["after", after]];
      for (const [label, match] of order) {
        const started = performance.now();
        const value = match(current, incoming);
        const elapsed = performance.now() - started;
        if (iteration >= 0) samples[label].push(elapsed);
        outcomes[label] = { matched: value.matches.size, unresolved: value.unresolved.length };
      }
    }
    result.push({ count, scenario, warmups: 10, summary: { before: summarize(samples.before), after: summarize(samples.after) }, outcomes, samples });
  }
}
console.log(JSON.stringify({ baseHead: input.baseHead, sourceBeforeSha256: input.beforeHash, sourceAfterSha256: input.afterHash, node: process.version, scenarios: result }, null, 2));
