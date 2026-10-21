#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  INSTRUMENT_VERSION,
  preflight,
  verifyGroupEvidence,
} from "./verify-shopping-performance-evidence.mjs";

export const GROUPS = [
  { group: "functional", script: null },
  { group: "shopping", script: "test:shopping-performance:run" },
  { group: "range", script: "test:range-selection-performance:run" },
  { group: "drag", script: "test:shopping-drag-performance:run" },
  {
    group: "transfer",
    script: "test:shopping-transfer-rendering-performance:run",
  },
];
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
async function resolveNpmCli(env) {
  const candidates = [
    env.npm_execpath,
    path.join(
      path.dirname(process.execPath),
      "node_modules/npm/bin/npm-cli.js",
    ),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (path.basename(candidate) !== "npm-cli.js") continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* next Node/npm installation layout */
    }
  }
  throw new Error(
    "npm-cli.js was not found; invoke this runner through npm run test:browser",
  );
}
export function groupInvocation({
  cwd,
  npmCli,
  group,
  script,
  groupRoot,
  env,
  phase,
  runId,
}) {
  const output = path.join(groupRoot, "test-results");
  const html = path.join(groupRoot, "html");
  const args = script
    ? [npmCli, "run", script, "--", "--workers=1", "--retries=0"]
    : [
        path.join(cwd, "node_modules/@playwright/test/cli.js"),
        "test",
        "--grep-invert",
        "@shopping-performance",
      ];
  args.push("--output", output, "--reporter=line,html,json");
  return {
    command: process.execPath,
    args,
    env: {
      ...env,
      PLAYWRIGHT_HTML_REPORT: html,
      PLAYWRIGHT_HTML_OUTPUT_DIR: html,
      PLAYWRIGHT_HTML_OPEN: "never",
      PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(groupRoot, "report.json"),
      ESP_EVIDENCE_PHASE: phase,
      ESP_EVIDENCE_RUN_ID: runId,
      ESP_EVIDENCE_GROUP: group,
    },
  };
}
export function spawnInvocation(invocation, cwd) {
  return new Promise((resolve) => {
    let child;
    const forward = (signal) => child?.kill(signal);
    const interrupt = () => forward("SIGINT");
    const terminate = () => forward("SIGTERM");
    try {
      child = spawn(invocation.command, invocation.args, {
        cwd,
        env: invocation.env,
        shell: false,
        stdio: "inherit",
      });
      process.once("SIGINT", interrupt);
      process.once("SIGTERM", terminate);
      let spawnError;
      child.once("error", (error) => {
        spawnError = error.message;
      });
      child.once("close", (exitCode, signal) => {
        process.removeListener("SIGINT", interrupt);
        process.removeListener("SIGTERM", terminate);
        resolve({
          exitCode,
          signal,
          ...(spawnError ? { error: spawnError } : {}),
        });
      });
    } catch (error) {
      resolve({ exitCode: null, signal: null, error: String(error) });
    }
  });
}
async function sourceHashes(cwd, files) {
  const hash = createHash("sha256");
  const entries = {};
  for (const file of files) {
    const bytes = await readFile(path.join(cwd, file));
    entries[file] = createHash("sha256").update(bytes).digest("hex");
    hash.update(file).update("\0").update(bytes).update("\0");
  }
  return { sha256: hash.digest("hex"), files: entries };
}
async function provenance(cwd, env) {
  const specs = [
    "tests/browser/responsive-performance.spec.ts",
    "tests/browser/edit-execute-range-selection.spec.ts",
    "tests/browser/shopping-cross-column-drag.spec.ts",
    "tests/browser/shopping-transfer-rendering.performance.spec.ts",
  ];
  const instruments = [
    ...specs,
    "tests/browser/performance-summary.ts",
    "tests/browser/shopping-performance-evidence.ts",
    "scripts/verify-shopping-performance-evidence.mjs",
    "scripts/run-shopping-browser-evidence.mjs",
  ];
  return {
    productCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
    }).trim(),
    sourceDiffSha256: createHash("sha256")
      .update(
        execFileSync("git", ["diff", "HEAD", "--", "src", "public"], { cwd }),
      )
      .digest("hex"),
    instrumentVersion: INSTRUMENT_VERSION,
    instrumentPatch: await sourceHashes(cwd, instruments),
    fixtureSources: await sourceHashes(cwd, specs),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      ci: env.CI ?? null,
      baseURL: env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173",
      browserChannel: env.PERFORMANCE_BROWSER_CHANNEL ?? "bundled-chromium",
      headed: env.PERFORMANCE_HEADED === "1",
      build: "npm run build:release-a",
      workerCount: 1,
      githubRunId: env.GITHUB_RUN_ID ?? null,
      githubRunAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
    },
  };
}
export async function runBrowserEvidence(options = {}) {
  const cwd = path.resolve(options.cwd ?? projectRoot);
  const env = { ...(options.env ?? process.env) };
  const phase = options.phase ?? "after";
  if (!["before", "after"].includes(phase))
    throw new Error("phase must be before or after");
  const runId =
    options.runId ??
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId))
    throw new Error("Invalid run ID");
  const runRoot = path.resolve(
    cwd,
    "artifacts/dnd-selection-rendering",
    phase,
    runId,
  );
  await mkdir(path.dirname(runRoot), { recursive: true });
  await mkdir(runRoot); // exclusive run ID: never reuse or overwrite earlier evidence
  const result = {
    schemaVersion: 1,
    phase,
    runId,
    runRoot,
    startedAt: new Date().toISOString(),
    status: "failed",
    preflight: { status: "not-run", exitCode: null },
    groups: GROUPS.map(({ group }) => ({
      group,
      status: "not-run",
      exitCode: null,
      evidenceStatus: "not-run",
      evidenceExitCode: null,
    })),
  };
  let exitCode = 1;
  try {
    const checked = await preflight({ env, runRoot });
    result.preflight = {
      ...checked,
      exitCode: checked.status === "passed" ? 0 : 1,
    };
    if (checked.status !== "passed")
      throw new Error(
        `Acceptance preflight rejected: ${checked.rejected.map((r) => r.name).join(", ")}`,
      );
    Object.assign(result, options.provenance ?? (await provenance(cwd, env)));
    const npmCli = options.npmCli ?? (await resolveNpmCli(env));
    for (const definition of GROUPS) {
      const entry = result.groups.find((row) => row.group === definition.group);
      const groupRoot = path.join(runRoot, definition.group);
      await mkdir(groupRoot);
      const invocation = groupInvocation({
        cwd,
        npmCli,
        ...definition,
        groupRoot,
        env,
        phase,
        runId,
      });
      entry.command = [invocation.command, ...invocation.args];
      entry.startedAt = new Date().toISOString();
      entry.status = "running";
      const child = await (options.spawn ?? spawnInvocation)(invocation, cwd);
      Object.assign(entry, child);
      const childPassed = child.exitCode === 0 && !child.signal && !child.error;
      if (definition.group !== "functional") {
        const evidence = await (options.verify ?? verifyGroupEvidence)({
          runRoot,
          group: definition.group,
          phase,
          runId,
        });
        entry.evidenceStatus = evidence.status;
        entry.evidenceExitCode = evidence.status === "passed" ? 0 : 1;
      } else entry.evidenceStatus = "not-applicable";
      entry.finishedAt = new Date().toISOString();
      entry.status =
        childPassed && entry.evidenceStatus !== "failed" ? "passed" : "failed";
      if (entry.status !== "passed")
        throw new Error(
          `${definition.group} failed; later groups were not run`,
        );
    }
    result.status = "passed";
    exitCode = 0;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    for (const group of result.groups)
      if (group.status === "running") group.status = "interrupted";
  }
  result.finishedAt = new Date().toISOString();
  const output = path.join(runRoot, "run-result.json");
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  const saved = JSON.parse(await readFile(output, "utf8"));
  if (JSON.stringify(saved) !== JSON.stringify(result))
    throw new Error("run-result JSON could not be verified after saving");
  return { exitCode, result };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--phase")
      throw new Error(
        "Usage: run-shopping-browser-evidence.mjs --phase before|after",
      );
    const { exitCode, result } = await runBrowserEvidence({ phase: args[1] });
    process.stdout.write(
      `${result.status.toUpperCase()} browser evidence: ${result.runRoot}${result.error ? `\n${result.error}` : ""}\n`,
    );
    process.exitCode = exitCode;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
