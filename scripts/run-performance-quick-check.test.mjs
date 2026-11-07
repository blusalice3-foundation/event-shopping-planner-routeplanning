import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  QUICK_CASES,
  parseQuickOptions,
  runPerformanceQuickCheck,
} from "./run-performance-quick-check.mjs";
import { expectedPerformanceCases } from "./shopping-performance-evidence-contract.mjs";

async function fixture(t) {
  const cwd = await mkdtemp(
    path.join(os.tmpdir(), "esp quick check with spaces "),
  );
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return {
    cwd,
    env: { CI: "1" },
    runId: "quick-test-run",
    sourceIdentity: { productCommit: "a".repeat(40), sourceState: "clean" },
  };
}

function expectedTitles(group) {
  return expectedPerformanceCases(group).map(
    ({ condition: c, measurementKind }) => {
      if (group === "shopping")
        return `local shopping operations: ${c.count} items, concentrated=${c.concentrated}, mapVisible=${c.mapVisible}, layout=${c.layout} @shopping-performance`;
      if (group === "range")
        return `edit execute chain response: ${c.count} items, ${c.layout}, ${c.renderer}, ${c.rangeLength} @range-selection-performance @shopping-performance`;
      if (group === "drag")
        return `@shopping-performance @shopping-drag-performance ${c.count} ${c.input} grouping ${c.grouped ? "on" : "off"}`;
      if (!c.scenario)
        return `@shopping-performance @shopping-transfer-rendering-performance ${c.count} ${c.input} grouping ${c.grouped ? "on" : "off"} ${c.load} ${c.direction} ${measurementKind}`;
      if (["noop", "reject", "cancel", "same-column"].includes(c.scenario))
        return `@shopping-performance @shopping-transfer-rendering-performance terminal ${c.input} ${c.scenario} ${measurementKind}`;
      return `@shopping-performance @shopping-transfer-rendering-performance ${c.scenario} ${c.count} ${c.input} grouping on light ${c.direction} ${measurementKind}`;
    },
  );
}

async function writeReport(
  invocation,
  { count, stats = {}, status = "passed" } = {},
) {
  const definition = QUICK_CASES.find(
    ({ group }) => group === invocation.env.ESP_EVIDENCE_GROUP,
  );
  const titles = definition.titles.slice(0, count ?? definition.expectedTests);
  const filename = invocation.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(
    filename,
    JSON.stringify({
      config: { workers: 1, projects: [{ name: "chromium", retries: 0 }] },
      errors: [],
      stats: {
        expected: titles.length,
        unexpected: 0,
        skipped: 0,
        flaky: 0,
        duration: 10,
        ...stats,
      },
      suites: [
        {
          file: definition.spec,
          specs: titles.map((title) => ({
            title,
            file: definition.spec,
            ok: status === "passed",
            tests: [
              {
                projectName: "chromium",
                expectedStatus: "passed",
                status: status === "passed" ? "expected" : "unexpected",
                results: [{ status, retry: 0, duration: 10, errors: [] }],
              },
            ],
          })),
        },
      ],
    }),
    "utf8",
  );
}

const passingSpawn = async (invocation) => {
  await writeReport(invocation);
  return { exitCode: 0, signal: null };
};

async function filesWithin(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const filename = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesWithin(filename)));
    else files.push(filename);
  }
  return files;
}

test("quick selection is a five-case subset of the formal 144-case inventory", () => {
  assert.deepEqual(
    QUICK_CASES.map(({ group }) => group),
    ["shopping", "range", "drag", "transfer"],
  );
  assert.equal(
    QUICK_CASES.reduce((sum, row) => sum + row.expectedTests, 0),
    5,
  );
  assert.equal(
    ["shopping", "range", "drag", "transfer"].reduce(
      (sum, group) => sum + expectedPerformanceCases(group).length,
      0,
    ),
    144,
  );
  for (const definition of QUICK_CASES) {
    assert.equal(definition.titles.length, definition.expectedTests);
    assert.equal(new Set(definition.titles).size, definition.titles.length);
    for (const title of definition.titles) {
      assert.ok(expectedTitles(definition.group).includes(title), title);
      assert.ok(title.includes("500"), title);
    }
    assert.ok(
      expectedPerformanceCases(definition.group).some(
        ({ spec }) => path.basename(spec) === path.basename(definition.spec),
      ),
    );
  }
  const transferTitles = QUICK_CASES.find(
    ({ group }) => group === "transfer",
  ).titles;
  assert.ok(transferTitles.some((title) => title.endsWith(" response")));
  assert.ok(transferTitles.some((title) => title.endsWith(" frame")));
});

test("quick options accept list and a single known group only", () => {
  assert.deepEqual(parseQuickOptions(["range"]), { group: "range" });
  assert.throws(
    () => parseQuickOptions(["range", "shopping"]),
    /duplicate|Unknown/i,
  );
  assert.deepEqual(parseQuickOptions([]), { group: "all" });
  assert.deepEqual(parseQuickOptions(["--group", "range"]), { group: "range" });
  assert.deepEqual(parseQuickOptions(["--list"]), { group: "all", list: true });
  assert.deepEqual(parseQuickOptions(["--list", "--group", "drag"]), {
    group: "drag",
    list: true,
  });
  for (const args of [
    ["--group"],
    ["--group", "unknown"],
    ["--profile", "completion"],
    ["--group", "range", "--group", "shopping"],
    ["--list", "--list"],
    ["--workers", "8"],
    ["unknown"],
  ])
    assert.throws(
      () => parseQuickOptions(args),
      undefined,
      JSON.stringify(args),
    );
});

test("quick run keeps two samples, diagnostic identity, exact cases and parent environment", async (t) => {
  const options = await fixture(t);
  options.env = {
    CI: "1",
    ESP_PERFORMANCE_PROFILE: "completion",
    esp_performance_profile: "completion",
    ESP_EVIDENCE_PHASE: "after",
    esp_evidence_run_id: "old-canonical-run",
    ESP_EVIDENCE_GROUP: "functional",
    PLAYWRIGHT_BASE_URL: "http://127.0.0.1:4567",
  };
  const original = { ...options.env };
  const calls = [];
  const { exitCode, result } = await runPerformanceQuickCheck({
    ...options,
    spawn: async (invocation, cwd) => {
      assert.equal(cwd, options.cwd);
      calls.push(invocation);
      return passingSpawn(invocation);
    },
  });
  assert.equal(exitCode, 0);
  assert.equal(result.status, "passed");
  assert.equal(result.diagnosticOnly, true);
  assert.equal(result.acceptanceMeasurement, false);
  assert.equal(result.samplingProfile.id, "pr");
  assert.equal(result.samplingProfile.sampleCount, 2);
  assert.equal(result.samplingProfile.completionEligible, false);
  assert.deepEqual(options.env, original);
  assert.deepEqual(
    calls.map((call) => call.env.ESP_EVIDENCE_GROUP),
    QUICK_CASES.map(({ group }) => group),
  );
  assert.equal(result.groups.length, 4);
  assert.ok(result.groups.every(({ status }) => status === "passed"));
  for (const call of calls) {
    const definition = QUICK_CASES.find(
      ({ group }) => group === call.env.ESP_EVIDENCE_GROUP,
    );
    assert.equal(call.command, process.execPath);
    assert.ok(call.args.includes("--workers=1"));
    assert.ok(call.args.includes("--retries=0"));
    assert.ok(call.args.includes("--reporter=line,json"));
    assert.ok(
      call.args.some(
        (arg) => path.basename(arg) === path.basename(definition.spec),
      ),
    );
    assert.equal(call.env.ESP_PERFORMANCE_PROFILE, "pr");
    assert.equal(call.env.ESP_DIAGNOSTIC_QUICK_CHECK, "1");
    assert.equal(call.env.ESP_EVIDENCE_PHASE, "diagnostic");
    assert.equal(call.env.ESP_EVIDENCE_RUN_ID, options.runId);
    assert.equal(call.env.PLAYWRIGHT_BASE_URL, original.PLAYWRIGHT_BASE_URL);
    assert.deepEqual(
      Object.keys(call.env).filter(
        (key) => key.toUpperCase() === "ESP_PERFORMANCE_PROFILE",
      ),
      ["ESP_PERFORMANCE_PROFILE"],
    );
    assert.equal(call.env.esp_evidence_run_id, undefined);
    const pattern = new RegExp(call.args[call.args.indexOf("--grep") + 1]);
    for (const title of definition.titles) {
      assert.ok(pattern.test(title));
      assert.equal(pattern.test(`${title} extra condition`), false);
    }
    for (const title of expectedTitles(definition.group))
      assert.equal(
        pattern.test(title),
        definition.titles.includes(title),
        title,
      );
  }
  const summary = path.join(result.runRoot, "quick-check-result.json");
  assert.deepEqual(JSON.parse(await readFile(summary, "utf8")), result);
  const written = await filesWithin(result.runRoot);
  assert.ok(written.includes(summary));
  assert.ok(
    written.every((filename) => path.basename(filename) !== "run-result.json"),
  );
  assert.equal(
    path.dirname(result.runRoot),
    path.join(options.cwd, "artifacts", "performance-quick-check"),
  );
});

test("single-group quick run executes only the requested group", async (t) => {
  const options = await fixture(t);
  const calls = [];
  const { exitCode, result } = await runPerformanceQuickCheck({
    ...options,
    group: "transfer",
    spawn: async (invocation) => {
      calls.push(invocation);
      return passingSpawn(invocation);
    },
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(
    calls.map((call) => call.env.ESP_EVIDENCE_GROUP),
    ["transfer"],
  );
  assert.deepEqual(
    result.groups.map(({ group }) => group),
    ["transfer"],
  );
  assert.equal(result.groups[0].expectedTests, 2);
});

test("quick run IDs are exclusive and existing diagnostic evidence stays intact", async (t) => {
  const options = await fixture(t);
  const first = await runPerformanceQuickCheck({
    ...options,
    group: "drag",
    spawn: passingSpawn,
  });
  const summary = path.join(first.result.runRoot, "quick-check-result.json");
  const before = await readFile(summary);
  let spawned = false;
  await assert.rejects(
    runPerformanceQuickCheck({
      ...options,
      group: "drag",
      spawn: async () => {
        spawned = true;
        return { exitCode: 0 };
      },
    }),
  );
  assert.equal(spawned, false);
  assert.deepEqual(await readFile(summary), before);
});

test("child failure preserves the failure and leaves later groups unrun", async (t) => {
  const options = await fixture(t);
  const calls = [];
  const { exitCode, result } = await runPerformanceQuickCheck({
    ...options,
    spawn: async (invocation) => {
      calls.push(invocation);
      await writeReport(invocation);
      return { exitCode: 7, signal: null };
    },
  });
  assert.notEqual(exitCode, 0);
  assert.equal(result.status, "failed");
  assert.equal(calls.length, 1);
  assert.equal(result.groups[0].status, "failed");
  assert.equal(result.groups[0].exitCode, 7);
  assert.ok(result.groups.slice(1).every(({ status }) => status === "not-run"));
  assert.deepEqual(
    JSON.parse(
      await readFile(
        path.join(result.runRoot, "quick-check-result.json"),
        "utf8",
      ),
    ),
    result,
  );
});

for (const [name, reportOptions] of [
  ["zero selected tests", { count: 0 }],
  ["partial transfer selection", { count: 1 }],
  ["unexpected failure", { stats: { unexpected: 1 } }],
  ["skipped selected test", { stats: { skipped: 1 } }],
  ["flaky selected test", { stats: { flaky: 1 } }],
])
  test(`quick run rejects ${name} even when the child exits zero`, async (t) => {
    const options = await fixture(t);
    const { exitCode, result } = await runPerformanceQuickCheck({
      ...options,
      group: "transfer",
      spawn: async (invocation) => {
        await writeReport(invocation, reportOptions);
        return { exitCode: 0, signal: null };
      },
    });
    assert.notEqual(exitCode, 0);
    assert.equal(result.status, "failed");
    assert.equal(result.groups[0].status, "failed");
  });

test("quick run fails if the child produces no JSON report", async (t) => {
  const options = await fixture(t);
  const { exitCode, result } = await runPerformanceQuickCheck({
    ...options,
    group: "shopping",
    spawn: async () => ({ exitCode: 0, signal: null }),
  });
  assert.notEqual(exitCode, 0);
  assert.equal(result.groups[0].status, "failed");
});

test("quick run rejects inherited measurement modifiers before starting Chromium", async (t) => {
  const options = await fixture(t);
  let spawned = false;
  const { exitCode, result } = await runPerformanceQuickCheck({
    ...options,
    env: { ESP_PROFILE_RANGE: "1" },
    spawn: async () => {
      spawned = true;
      return { exitCode: 0 };
    },
  });
  assert.notEqual(exitCode, 0);
  assert.equal(result.status, "failed");
  assert.equal(spawned, false);
  assert.ok(result.groups.every(({ status }) => status === "not-run"));
});
