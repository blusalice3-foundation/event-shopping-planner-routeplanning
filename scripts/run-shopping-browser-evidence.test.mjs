import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  GROUPS,
  collectBrowserEnvironment,
  collectBrowserSourceIdentity,
  validateBrowserSourceIdentity,
  groupInvocation,
  runBrowserEvidence,
  spawnInvocation,
} from "./run-shopping-browser-evidence.mjs";

import { performanceAcceptanceCriteriaByGroup } from "./shopping-performance-evidence-contract.mjs";

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
  options.provenance.acceptanceCriteriaByGroup = { forged: { medianMs: 999 } };
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
  assert.deepEqual(
    saved.acceptanceCriteriaByGroup,
    performanceAcceptanceCriteriaByGroup,
  );
  assert.equal(saved.acceptanceCriteriaByGroup.functional, undefined);
  assert.equal(saved.acceptanceThresholds, undefined);
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
test("real Playwright keeps CI performance retries at zero and preserves general retries", async (t) => {
  const options = await fixture(t);
  const parentCI = process.env.CI;
  // Only copy environment entries needed to start Node on Windows. Diagnostics
  // from an unrelated parent shell must not alter this isolated policy fixture.
  options.env = {
    ...Object.fromEntries(
      ["PATH", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "HOME"]
        .filter((name) => typeof process.env[name] === "string")
        .map((name) => [name, process.env[name]]),
    ),
    CI: "1",
  };
  const originalEnvironment = { ...options.env };
  const config = path.join(options.cwd, "retry policy.config.mjs");
  const spec = path.join(options.cwd, "retry-policy.spec.mjs");
  const playwrightCli = path.join(
    repository,
    "node_modules/@playwright/test/cli.js",
  );
  const playwrightImport = pathToFileURL(
    path.join(repository, "node_modules/@playwright/test/index.mjs"),
  ).href;
  await writeFile(
    config,
    `export default { testDir: ${JSON.stringify(options.cwd)}, testMatch: "retry-policy.spec.mjs", retries: process.env.CI ? 2 : 0, workers: 1 };\n`,
    "utf8",
  );
  await writeFile(
    spec,
    [
      `import { test, expect } from ${JSON.stringify(playwrightImport)};`,
      'import { appendFileSync } from "node:fs";',
      'test("first attempt fails and a retry succeeds", async ({}, testInfo) => {',
      '  appendFileSync(process.env.RETRY_POLICY_MARKER, JSON.stringify({ retry: testInfo.retry, configuredRetries: testInfo.project.retries, ci: process.env.CI }) + "\\n", "utf8");',
      "  expect(testInfo.retry).toBeGreaterThan(0);",
      "});",
    ].join("\n") + "\n",
    "utf8",
  );

  for (const performance of [true, false]) {
    const marker = path.join(
      options.cwd,
      performance ? "performance attempts.jsonl" : "general attempts.jsonl",
    );
    const launched = [];
    const { result, exitCode } = await runBrowserEvidence({
      ...options,
      runId: performance
        ? "real-playwright-performance"
        : "real-playwright-general",
      spawn: async (invocation) => {
        const group = invocation.env.ESP_EVIDENCE_GROUP;
        launched.push(group);
        if (group !== (performance ? "shopping" : "functional"))
          return { exitCode: 0, signal: null };
        const separator = invocation.args.indexOf("--");
        const forwarded = performance
          ? invocation.args.slice(separator + 1)
          : invocation.args.slice(2);
        assert.equal(forwarded.includes("--retries=0"), performance);
        return spawnInvocation(
          {
            command: process.execPath,
            args: [playwrightCli, "test", "--config", config, ...forwarded],
            env: { ...invocation.env, RETRY_POLICY_MARKER: marker },
          },
          options.cwd,
        );
      },
      // Artifact shape is covered separately; this test isolates the real child
      // exit code and retry options at the parent runner boundary.
      verify: async () => ({ status: "passed" }),
    });
    const attempts = (await readFile(marker, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      attempts,
      performance
        ? [{ retry: 0, configuredRetries: 0, ci: "1" }]
        : [
            { retry: 0, configuredRetries: 2, ci: "1" },
            { retry: 1, configuredRetries: 2, ci: "1" },
          ],
    );
    assert.equal(exitCode, performance ? 1 : 0);
    if (performance) {
      assert.deepEqual(launched, ["functional", "shopping"]);
      assert.equal(result.groups[1].exitCode, 1);
      assert.equal(result.groups[1].status, "failed");
      assert.ok(
        result.groups.slice(2).every((group) => group.status === "not-run"),
      );
      const saved = JSON.parse(
        await readFile(path.join(result.runRoot, "run-result.json"), "utf8"),
      );
      assert.equal(saved.status, "failed");
      assert.equal(saved.groups[1].exitCode, 1);
    } else {
      assert.equal(result.groups[0].exitCode, 0);
      assert.equal(result.groups[0].status, "passed");
    }
  }
  assert.equal(process.env.CI, parentCI);
  assert.deepEqual(options.env, originalEnvironment);
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

test("browser environment preflight rejects an unrelated explicit preview before launching a browser", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "esp preview guard "));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, "dist"));
  const capability = {
    kind: "event-shopping-planner-release-capabilities",
    version: 1,
    buildMode: "release-a",
    releaseChannel: "release-a",
    legacyLocalStorageCleanup: "forced-off",
    sourceState: "clean",
    sourceSha: "a".repeat(40),
    buildId: "a".repeat(40),
  };
  await writeFile(
    path.join(cwd, "dist/release-capabilities.json"),
    JSON.stringify(capability),
    "utf8",
  );
  const server = createServer((request, response) => {
    assert.equal(request.url, "/release-capabilities.json");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ...capability, buildId: "b".repeat(40) }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  await assert.rejects(
    collectBrowserEnvironment(cwd, {
      PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${address.port}`,
    }),
    /Preview release capability differs/,
  );
});

test("runner checkpoints the running group before starting its child", async (t) => {
  const options = await fixture(t);
  let checkpoints = 0;
  const { result, exitCode } = await runBrowserEvidence({
    ...options,
    spawn: async (invocation) => {
      const saved = JSON.parse(
        await readFile(
          path.join(
            path.dirname(invocation.env.PLAYWRIGHT_JSON_OUTPUT_FILE),
            "..",
            "run-result.json",
          ),
          "utf8",
        ),
      );
      const current = saved.groups.find(
        (row) => row.group === invocation.env.ESP_EVIDENCE_GROUP,
      );
      assert.equal(saved.preflight.status, "passed");
      assert.equal(current.status, "running");
      assert.ok(current.startedAt);
      assert.equal(current.exitCode, null);
      assert.ok(
        saved.groups
          .slice(checkpoints + 1)
          .every((row) => row.status === "not-run"),
      );
      assert.ok(
        saved.groups
          .slice(0, checkpoints)
          .every((row) => row.status === "passed"),
      );
      checkpoints++;
      return { exitCode: 0, signal: null };
    },
    verify: async () => ({ status: "passed" }),
  });
  assert.equal(checkpoints, 5);
  assert.equal(exitCode, 0);
  assert.equal(result.status, "passed");
});

test("runner preserves the completed child checkpoint if evidence verification is interrupted", async (t) => {
  const options = await fixture(t);
  let verified = 0;
  const { result, exitCode } = await runBrowserEvidence({
    ...options,
    spawn: async () => ({ exitCode: 0, signal: null }),
    verify: async ({ runRoot, group }) => {
      const saved = JSON.parse(
        await readFile(path.join(runRoot, "run-result.json"), "utf8"),
      );
      const current = saved.groups.find((row) => row.group === group);
      assert.equal(saved.groups[0].status, "passed");
      assert.equal(current.status, "running");
      assert.equal(current.exitCode, 0);
      assert.equal(current.signal, null);
      assert.equal(current.evidenceStatus, "not-run");
      assert.ok(saved.groups.slice(2).every((row) => row.status === "not-run"));
      verified++;
      throw new Error("evidence verification interrupted");
    },
  });
  assert.equal(verified, 1);
  assert.equal(exitCode, 1);
  const saved = JSON.parse(
    await readFile(path.join(result.runRoot, "run-result.json"), "utf8"),
  );
  assert.equal(saved.status, "failed");
  assert.equal(saved.error, "evidence verification interrupted");
  assert.equal(saved.groups[1].status, "interrupted");
  assert.equal(saved.groups[1].exitCode, 0);
  assert.ok(saved.groups.slice(2).every((row) => row.status === "not-run"));
});

test("actual source proof rejects tracked, staged and untracked product changes before browser launch", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "esp source identity "));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (args) =>
    execFileSync("git", ["-c", "core.autocrlf=false", ...args], {
      cwd,
      encoding: "utf8",
    }).trim();
  git(["init", "--quiet"]);
  await mkdir(path.join(cwd, "src"));
  await mkdir(path.join(cwd, "public"));
  await mkdir(path.join(cwd, "dist"));
  await writeFile(
    path.join(cwd, "src/item.ts"),
    "export const value = 1;\n",
    "utf8",
  );
  await writeFile(path.join(cwd, "public/manifest.json"), "{}\n", "utf8");
  git(["add", "src", "public"]);
  git([
    "-c",
    "user.name=Evidence Test",
    "-c",
    "user.email=evidence@example.test",
    "commit",
    "--quiet",
    "-m",
    "source fixture",
  ]);
  const head = git(["rev-parse", "HEAD"]);
  const capability = {
    kind: "event-shopping-planner-release-capabilities",
    version: 1,
    buildMode: "release-a",
    releaseChannel: "release-a",
    legacyLocalStorageCleanup: "forced-off",
    sourceState: "clean",
    sourceSha: head,
    buildId: head,
  };
  await writeFile(
    path.join(cwd, "dist/release-capabilities.json"),
    JSON.stringify(capability),
    "utf8",
  );
  const clean = collectBrowserSourceIdentity(cwd);
  assert.equal(clean.productCommit, head);
  assert.equal(clean.sourceState, "clean");
  assert.doesNotThrow(() =>
    validateBrowserSourceIdentity({ ...clean, releaseCapability: capability }),
  );
  // Build mismatch must fail before loading Playwright or requesting a preview.
  await assert.rejects(
    collectBrowserEnvironment(
      cwd,
      {},
      { ...clean, productCommit: "a".repeat(40) },
    ),
    /source\/build IDs differ/,
  );
  for (const mode of [
    "tracked",
    "staged",
    "untracked-src",
    "untracked-public",
  ]) {
    const relative = mode.startsWith("untracked")
      ? mode === "untracked-src"
        ? "src/extra.ts"
        : "public/extra.json"
      : "src/item.ts";
    await writeFile(path.join(cwd, relative), "changed\n", "utf8");
    if (mode === "staged") git(["add", relative]);
    const dirty = collectBrowserSourceIdentity(cwd);
    assert.equal(dirty.sourceState, "dirty", mode);
    if (mode.startsWith("untracked"))
      assert.equal(dirty.sourceDiffSha256, clean.sourceDiffSha256);
    else assert.notEqual(dirty.sourceDiffSha256, clean.sourceDiffSha256);
    await assert.rejects(
      collectBrowserEnvironment(cwd, {}, dirty),
      /exact clean product source/,
      mode,
    );
    if (mode.startsWith("untracked")) await rm(path.join(cwd, relative));
    else git(["restore", "--source=HEAD", "--staged", "--worktree", relative]);
  }
  assert.deepEqual(collectBrowserSourceIdentity(cwd), clean);
});
