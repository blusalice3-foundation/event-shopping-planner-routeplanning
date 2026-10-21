import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  GROUPS,
  groupInvocation,
  runBrowserEvidence,
  spawnInvocation,
} from "./run-shopping-browser-evidence.mjs";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
async function fixture(t) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "esp runner with spaces "));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return {
    cwd,
    npmCli: path.join(cwd, "npm cli/npm-cli.js"),
    runId: "test-run",
    phase: "after",
    env: { CI: "1" },
    provenance: {
      productCommit: "fixture",
      instrumentVersion: "fixture",
      fixtureHash: "fixture",
    },
  };
}
test("normal runner keeps group order, siblings, argument boundaries and parent environment", async (t) => {
  const options = await fixture(t);
  const original = { ...options.env };
  const calls = [];
  const result = await runBrowserEvidence({
    ...options,
    spawn: async (invocation) => {
      calls.push(invocation);
      return { exitCode: 0, signal: null };
    },
    verify: async () => ({ status: "passed" }),
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(
    calls.map((r) => r.env.ESP_EVIDENCE_GROUP),
    GROUPS.map((r) => r.group),
  );
  assert.deepEqual(options.env, original);
  for (const call of calls) {
    const env = call.env;
    const output = call.args[call.args.indexOf("--output") + 1];
    assert.equal(
      path.dirname(output),
      path.dirname(env.PLAYWRIGHT_HTML_REPORT),
    );
    assert.equal(
      path.dirname(output),
      path.dirname(env.PLAYWRIGHT_JSON_OUTPUT_FILE),
    );
    assert.equal(env.PLAYWRIGHT_HTML_REPORT, env.PLAYWRIGHT_HTML_OUTPUT_DIR);
    assert.equal(call.command, process.execPath);
    assert.equal(env.PLAYWRIGHT_HTML_OPEN, "never");
    assert.ok(call.args.includes("--reporter=line,html,json"));
    if (env.ESP_EVIDENCE_GROUP === "functional") {
      assert.ok(call.args.includes("--grep-invert"));
      assert.ok(!call.args.includes("--retries=0"));
    } else {
      assert.equal(call.args[0], options.npmCli);
      assert.equal(call.args[3], "--");
      assert.ok(call.args.includes("--retries=0"));
      assert.ok(call.args.includes("--workers=1"));
    }
  }
  const saved = JSON.parse(
    await readFile(path.join(result.result.runRoot, "run-result.json"), "utf8"),
  );
  assert.equal(saved.status, "passed");
  assert.equal(saved.groups.length, 5);
  await assert.rejects(runBrowserEvidence(options), /EEXIST/);
});
for (const [label, child] of [
  ["nonzero", { exitCode: 1, signal: null }],
  ["signal", { exitCode: null, signal: "SIGTERM" }],
  ["spawn error", { exitCode: null, signal: null, error: "ENOENT" }],
])
  test(`runner retains ${label} failure and marks later groups not-run`, async (t) => {
    const options = await fixture(t);
    let count = 0;
    const { result, exitCode } = await runBrowserEvidence({
      ...options,
      spawn: async () => {
        count++;
        return child;
      },
    });
    assert.equal(count, 1);
    assert.equal(exitCode, 1);
    assert.equal(result.groups[0].status, "failed");
    assert.ok(result.groups.slice(1).every((r) => r.status === "not-run"));
    assert.equal(
      JSON.parse(
        await readFile(path.join(result.runRoot, "run-result.json"), "utf8"),
      ).status,
      "failed",
    );
  });
test("exit zero cannot hide missing acceptance artifacts", async (t) => {
  const options = await fixture(t);
  let count = 0;
  const { result, exitCode } = await runBrowserEvidence({
    ...options,
    spawn: async () => {
      count++;
      return { exitCode: 0 };
    },
  });
  assert.equal(exitCode, 1);
  assert.equal(count, 2);
  assert.equal(result.groups[1].exitCode, 0);
  assert.equal(result.groups[1].evidenceExitCode, 1);
  assert.equal(result.groups[1].status, "failed");
  assert.ok(result.groups.slice(2).every((r) => r.status === "not-run"));
});
for (const name of [
  "ESP_PROFILE_RANGE",
  "ESP_PROFILE_SHOPPING",
  "ESP_DIAGNOSTIC_CSS",
  "ESP_RANGE_RENDER_DIAGNOSTICS",
  "ESP_DRAG_TRACE_STAGES",
])
  test(`runner rejects ${name}=0 before launching and retains the setting error`, async (t) => {
    const options = await fixture(t);
    options.env[name] = "0";
    let launched = false;
    const { result, exitCode } = await runBrowserEvidence({
      ...options,
      spawn: async () => {
        launched = true;
      },
    });
    assert.equal(exitCode, 1);
    assert.equal(launched, false);
    assert.equal(result.preflight.status, "failed");
    assert.equal(options.env[name], "0");
    assert.ok(result.groups.every((r) => r.status === "not-run"));
    assert.equal(
      JSON.parse(
        await readFile(
          path.join(result.runRoot, "preflight-result.json"),
          "utf8",
        ),
      ).rejected[0].name,
      name,
    );
  });
test("a CI first-attempt failure runs once and is never replaced by the fixture's later success", async (t) => {
  const options = await fixture(t);
  const marker = path.join(options.cwd, "attempts.txt");
  const script = path.join(options.cwd, "retry-only-success.mjs");
  await writeFile(
    script,
    'import {existsSync,appendFileSync} from "node:fs"; const first=!existsSync(process.argv[2]); appendFileSync(process.argv[2],"attempt\\n"); process.exitCode=first?1:0;',
    "utf8",
  );
  let calls = 0;
  const { result, exitCode } = await runBrowserEvidence({
    ...options,
    spawn: async (invocation) => {
      calls++;
      if (invocation.env.ESP_EVIDENCE_GROUP === "functional")
        return { exitCode: 0 };
      assert.ok(invocation.args.includes("--retries=0"));
      return spawnInvocation(
        {
          command: process.execPath,
          args: [script, marker],
          env: invocation.env,
        },
        options.cwd,
      );
    },
    verify: async () => ({ status: "failed" }),
  });
  assert.equal(exitCode, 1);
  assert.equal(calls, 2);
  assert.equal(result.groups[1].exitCode, 1);
  assert.equal(await readFile(marker, "utf8"), "attempt\n");
});
test("dedicated scripts preserve tags/specs, preflight and zero retries without changing shared retry defaults", async () => {
  const pkg = JSON.parse(
    await readFile(path.join(repository, "package.json"), "utf8"),
  );
  for (const { script } of GROUPS.filter((r) => r.script)) {
    assert.match(
      pkg.scripts[script],
      /^node scripts\/verify-shopping-performance-evidence\.mjs preflight && playwright test tests\/browser\//,
    );
    assert.match(pkg.scripts[script], /--workers=1 --retries=0$/);
  }
  assert.match(
    pkg.scripts["test:browser"],
    /^npm run build:release-a && node scripts\/run-shopping-browser-evidence\.mjs --phase after$/,
  );
  assert.match(
    await readFile(path.join(repository, "playwright.config.ts"), "utf8"),
    /retries: process\.env\.CI \? 2 : 0/,
  );
});
test("performance invocation preserves a spaced npm CLI and forwards exactly one npm separator", () => {
  const call = groupInvocation({
    cwd: repository,
    npmCli: "C:/Program Files/npm/npm-cli.js",
    group: "shopping",
    script: "test:shopping-performance:run",
    groupRoot: "C:/evidence root/shopping",
    env: {},
    phase: "after",
    runId: "id",
  });
  assert.equal(call.args[0], "C:/Program Files/npm/npm-cli.js");
  assert.equal(call.args.filter((r) => r === "--").length, 1);
});
