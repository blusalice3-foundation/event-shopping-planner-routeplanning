import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { sheetUrlStageProbe } from "./sheet-url-stage-probe.mjs";

function execute(source, path, globals = {}) {
  const transformed = sheetUrlStageProbe().transform(source, path);
  assert.ok(transformed);
  const { outputText, diagnostics } = ts.transpileModule(transformed.code, {
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  assert.deepEqual(
    diagnostics.filter(
      (entry) => entry.category === ts.DiagnosticCategory.Error,
    ),
    [],
  );
  const spans = [];
  let clock = 0;
  const context = {
    exports: {},
    ...globals,
    performance: { now: () => ++clock },
    __sheetUrlStageObserver: (stage, startMs, endMs) => {
      spans.push({ stage, startMs, endMs });
    },
  };
  vm.runInNewContext(outputText, context, { filename: path });
  return { exports: context.exports, spans };
}
function stages(spans) {
  for (const span of spans) assert.ok(span.endMs > span.startMs);
  return spans.map((span) => span.stage).sort();
}
const synchronousFixtures = [
  {
    path: "D:/planner/src/utils/appBackup.ts",
    source: `
      function validateSnapshotStructure(source: object) {
        if (source.failure) throw source.failure;
        return source;
      }
      function validateSnapshotReferences(source: object) { return source; }
      export function parseAppBackup(source: object) {
        return validateSnapshotReferences(validateSnapshotStructure(source));
      }
    `,
    entry: "parseAppBackup",
    success: [
      "backup-processing",
      "validation-references",
      "validation-structure",
    ],
    failure: ["backup-processing", "validation-structure"],
  },
  {
    path: "D:/planner/src/utils/itemOptionalFields.ts",
    source: `
      function normalizeSnapshotItemOptionalFields(source: object) {
        if (source.failure) throw source.failure;
        return source;
      }
      export function entry(source: object) {
        return normalizeSnapshotItemOptionalFields(source);
      }
    `,
    entry: "entry",
    success: ["normalization"],
    failure: ["normalization"],
  },
];

test("leaves unrelated production modules untouched", () => {
  assert.equal(
    sheetUrlStageProbe().transform(
      "export function parseAppBackup(source) { return JSON.parse(source); }",
      "D:/planner/src/features/unrelated.ts",
    ),
    null,
  );
});
test("observes same-module validator and normalizer calls without replacing their result", () => {
  for (const fixture of synchronousFixtures) {
    const instrumented = execute(fixture.source, fixture.path);
    const value = Object.freeze({ futureOptionalField: { preserved: true } });
    assert.equal(instrumented.exports[fixture.entry](value), value);
    assert.deepEqual(stages(instrumented.spans), fixture.success);
  }
});
test("records same-module exceptional exits and preserves the original exception", () => {
  for (const fixture of synchronousFixtures) {
    const instrumented = execute(fixture.source, fixture.path);
    const failure = new Error("original failure");
    assert.throws(
      () => instrumented.exports[fixture.entry]({ failure }),
      (caught) => caught === failure,
    );
    assert.deepEqual(stages(instrumented.spans), fixture.failure);
  }
});
test("JSON.parse(source) keeps its receiver, result and thrown value", () => {
  const result = { parsed: true };
  const failure = new SyntaxError("original parse failure");
  let calls = 0;
  const parser = {
    parse(source) {
      assert.equal(this, parser);
      calls++;
      if (source === "invalid") throw failure;
      assert.equal(source, "valid");
      return result;
    },
  };
  const instrumented = execute(
    "export function parseAppBackup(source: string) { return JSON.parse(source); }",
    "D:\\planner\\src\\utils\\appBackup.ts?measurement",
    { JSON: parser },
  );
  assert.equal(instrumented.exports.parseAppBackup("valid"), result);
  assert.throws(
    () => instrumented.exports.parseAppBackup("invalid"),
    (caught) => caught === failure,
  );
  assert.equal(calls, 2);
  assert.deepEqual(stages(instrumented.spans), [
    "backup-processing",
    "backup-processing",
    "json-decode",
    "json-decode",
  ]);
});
test("mutation replanning keeps method this, arguments, result and thrown value", () => {
  const instrumented = execute(
    `export function entry(operation, planning) {
      return operation.intent.plan(planning, operation.choices);
    }`,
    "D:/planner/src/app/commands/applicationMutationCoordinator.ts",
  );
  const planning = { version: 3 };
  const choices = { accepted: true };
  const result = { snapshot: planning };
  const failure = new Error("original plan failure");
  let calls = 0;
  const intent = {
    fail: false,
    plan(actualPlanning, actualChoices) {
      assert.equal(this, intent);
      assert.equal(actualPlanning, planning);
      assert.equal(actualChoices, choices);
      calls++;
      if (this.fail) throw failure;
      return result;
    },
  };
  const operation = { intent, choices };
  assert.equal(instrumented.exports.entry(operation, planning), result);
  intent.fail = true;
  assert.throws(
    () => instrumented.exports.entry(operation, planning),
    (caught) => caught === failure,
  );
  assert.equal(calls, 2);
  assert.deepEqual(stages(instrumented.spans), [
    "mutation-replan",
    "mutation-replan",
  ]);
});
test("XLSX timing finishes after awaited input resolves or rejects", async () => {
  const instrumented = execute(
    `export async function importFromXlsx(source: Promise<object>) {
      const value = await source;
      return value;
    }`,
    "D:/planner/src/xlsx/engine/eventWorkbookEngine.ts",
  );
  let resolve;
  const input = new Promise((complete) => {
    resolve = complete;
  });
  const result = { items: [] };
  const pending = instrumented.exports.importFromXlsx(input);
  assert.deepEqual(instrumented.spans, []);
  resolve(result);
  assert.equal(await pending, result);
  assert.deepEqual(stages(instrumented.spans), ["xlsx-parse"]);
  let reject;
  const rejectedInput = new Promise((_, fail) => {
    reject = fail;
  });
  const rejected = instrumented.exports.importFromXlsx(rejectedInput);
  const failure = new Error("original XLSX failure");
  assert.equal(instrumented.spans.length, 1);
  reject(failure);
  await assert.rejects(rejected, (caught) => caught === failure);
  assert.deepEqual(stages(instrumented.spans), ["xlsx-parse", "xlsx-parse"]);
});
