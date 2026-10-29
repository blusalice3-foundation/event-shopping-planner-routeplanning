#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  INSTRUMENT_VERSION,
  preflight,
  verifyGroupEvidence,
} from "./verify-shopping-performance-evidence.mjs";

import {
  performanceAcceptanceCriteriaByGroupForProfile,
  performanceSamplingMetadata,
  resolvePerformanceProfile,
  performanceProfileEnvironment,
  shoppingLargeListDiagnosticTag,
} from "./shopping-performance-evidence-contract.mjs";

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
        `@shopping-performance|${shoppingLargeListDiagnosticTag}`,
      ];
  args.push("--output", output, "--reporter=line,html,json");
  return {
    command: process.execPath,
    args,
    env: {
      ...performanceProfileEnvironment(env),
      PLAYWRIGHT_HTML_REPORT: html,
      PLAYWRIGHT_HTML_OUTPUT_DIR: html,
      PLAYWRIGHT_HTML_OPEN: "never",
      PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(groupRoot, "report.json"),
      ESP_EVIDENCE_PHASE: phase,
      ESP_EVIDENCE_RUN_ID: runId,
      ESP_EVIDENCE_GROUP: group,
      ESP_PERFORMANCE_PROFILE: resolvePerformanceProfile(undefined, env),
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
export function validateBrowserSourceIdentity(provenance) {
  const emptyDiffHash = createHash("sha256").update("").digest("hex");
  if (
    !/^[a-f0-9]{40}$/.test(provenance.productCommit ?? "") ||
    provenance.sourceState !== "clean" ||
    provenance.sourceDiffSha256 !== emptyDiffHash
  )
    throw new Error(
      "Acceptance evidence requires the exact clean product source",
    );
  if (
    provenance.releaseCapability?.sourceSha !== provenance.productCommit ||
    provenance.releaseCapability?.buildId !== provenance.productCommit
  )
    throw new Error(
      "Release capability source/build IDs differ from the measured product HEAD",
    );
}
export function collectBrowserSourceIdentity(cwd) {
  const git = (args) => execFileSync("git", args, { cwd });
  return {
    productCommit: git(["rev-parse", "HEAD"]).toString("utf8").trim(),
    sourceState:
      git([
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        "src",
        "public",
      ])
        .toString("utf8")
        .trim() === ""
        ? "clean"
        : "dirty",
    sourceDiffSha256: createHash("sha256")
      .update(git(["diff", "HEAD", "--", "src", "public"]))
      .digest("hex"),
  };
}
export async function collectBrowserEnvironment(cwd, env, sourceIdentity) {
  const capabilityBytes = await readFile(
    path.join(cwd, "dist/release-capabilities.json"),
  );
  const releaseCapability = JSON.parse(capabilityBytes.toString("utf8"));
  if (
    releaseCapability.kind !== "event-shopping-planner-release-capabilities" ||
    releaseCapability.version !== 1 ||
    releaseCapability.buildMode !== "release-a" ||
    releaseCapability.releaseChannel !== "release-a" ||
    releaseCapability.legacyLocalStorageCleanup !== "forced-off" ||
    releaseCapability.sourceState !== "clean" ||
    !/^[a-f0-9]{40}$/.test(releaseCapability.sourceSha ?? "") ||
    !/^[a-f0-9]{40}$/.test(releaseCapability.buildId ?? "")
  )
    throw new Error(
      "Acceptance evidence requires a clean release-a capability",
    );
  if (sourceIdentity)
    validateBrowserSourceIdentity({ ...sourceIdentity, releaseCapability });
  let servedReleaseCapabilityRaw = null;
  if (env.PLAYWRIGHT_BASE_URL) {
    const response = await fetch(
      new URL("/release-capabilities.json", env.PLAYWRIGHT_BASE_URL),
      {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw new Error(
        `Preview release capability request failed: ${response.status}`,
      );
    const served = Buffer.from(await response.arrayBuffer());
    if (!served.equals(capabilityBytes))
      throw new Error(
        "Preview release capability differs from the measured local release build",
      );
    servedReleaseCapabilityRaw = served.toString("utf8");
  }
  const require = createRequire(path.join(cwd, "package.json"));
  const { chromium, devices } = require("@playwright/test");
  const browser = await chromium.launch({
    channel: env.PERFORMANCE_BROWSER_CHANNEL || undefined,
    headless: env.PERFORMANCE_HEADED !== "1",
  });
  try {
    const context = await browser.newContext({
      ...devices["Desktop Chrome"],
      userAgent: undefined,
    });
    const page = await context.newPage();
    const actual = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      viewport: {
        width: globalThis.innerWidth,
        height: globalThis.innerHeight,
      },
      devicePixelRatio: globalThis.devicePixelRatio,
    }));
    return {
      releaseCapability,
      releaseCapabilityRaw: capabilityBytes.toString("utf8"),
      servedReleaseCapabilityRaw,
      servedReleaseCapabilitySha256:
        servedReleaseCapabilityRaw === null
          ? null
          : createHash("sha256")
              .update(servedReleaseCapabilityRaw)
              .digest("hex"),
      releaseCapabilitySha256: createHash("sha256")
        .update(capabilityBytes)
        .digest("hex"),
      environment: {
        platform: process.platform,
        osRelease: os.release(),
        osVersion: os.version(),
        arch: process.arch,
        node: process.version,
        ci: env.CI ?? null,
        baseURL: env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173",
        previewSource: env.PLAYWRIGHT_BASE_URL
          ? "explicit"
          : "playwright-webServer",
        browserVersion: browser.version(),
        ...actual,
        browserChannel: env.PERFORMANCE_BROWSER_CHANNEL ?? "bundled-chromium",
        headed: env.PERFORMANCE_HEADED === "1",
        build: "npm run build:release-a",
        workerCount: 1,
        githubRunId: env.GITHUB_RUN_ID ?? null,
        githubRunAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
      },
    };
  } finally {
    await browser.close();
  }
}
export async function collectBrowserProvenance(cwd, env) {
  const specs = [
    "tests/browser/responsive-performance.spec.ts",
    "tests/browser/edit-execute-range-selection.spec.ts",
    "tests/browser/shopping-cross-column-drag.spec.ts",
    "tests/browser/shopping-transfer-rendering.performance.spec.ts",
    "tests/browser/shopping-transfer-accepted.performance.spec.ts",
    "tests/browser/shopping-transfer-terminal.performance.spec.ts",
  ];
  const transferSources = (await readdir(path.join(cwd, "tests/browser")))
    .filter((name) => /^shopping-transfer-.*\.ts$/.test(name))
    .sort()
    .map((name) => `tests/browser/${name}`);
  const instruments = [
    ...new Set([
      ...specs,
      "tests/browser/performance-summary.ts",
      "tests/browser/shopping-performance-evidence.ts",
      "tests/browser/shopping-operation-sampling.ts",
      "tests/browser/shopping-transfer-measurement.ts",
      "scripts/verify-shopping-performance-evidence.mjs",
      "scripts/baseline-frame-performance-observations.mjs",
      "scripts/baseline-shopping-performance-observations.mjs",
      "scripts/run-shopping-browser-evidence.mjs",
      "scripts/shopping-performance-evidence-contract.mjs",
      ...transferSources,
    ]),
  ];
  const sourceIdentity = collectBrowserSourceIdentity(cwd);
  return {
    ...sourceIdentity,
    instrumentVersion: INSTRUMENT_VERSION,
    acceptanceCriteriaByGroup: performanceAcceptanceCriteriaByGroupForProfile(
      resolvePerformanceProfile(undefined, env),
    ),
    ...performanceSamplingMetadata(resolvePerformanceProfile(undefined, env)),
    instrumentPatch: await sourceHashes(cwd, instruments),
    fixtureSources: await sourceHashes(cwd, [
      ...new Set([
        ...specs,
        "tests/browser/shopping-operation-sampling.ts",
        ...transferSources,
      ]),
    ]),
    ...(await collectBrowserEnvironment(cwd, env, sourceIdentity)),
  };
}
export async function runBrowserEvidence(options = {}) {
  const cwd = path.resolve(options.cwd ?? projectRoot);
  let env = { ...(options.env ?? process.env) };
  let profile, profileError;
  try {
    profile = resolvePerformanceProfile(options.profile, env);
  } catch (error) {
    profileError = error.message;
  }
  if (!profileError) env = performanceProfileEnvironment(env, profile);
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
    ...(profileError
      ? {
          samplingConfigurationError: profileError,
          requestedProfile: options.profile ?? null,
        }
      : {
          acceptanceCriteriaByGroup:
            performanceAcceptanceCriteriaByGroupForProfile(profile),
          ...performanceSamplingMetadata(profile),
        }),
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
  const output = path.join(runRoot, "run-result.json");
  // Keep a complete checkpoint even if the host terminates a long browser run.
  // The exclusively created run directory remains the authority for run ID reuse.
  const checkpoint = async () => {
    const temporary = path.join(runRoot, `run-result-${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, output);
  };
  await checkpoint();
  let exitCode = 1;
  try {
    const checked = await preflight({ env, runRoot, profile: options.profile });
    result.preflight = {
      ...checked,
      exitCode: checked.status === "passed" ? 0 : 1,
    };
    await checkpoint();
    if (checked.status !== "passed")
      throw new Error(
        `Acceptance preflight rejected: ${checked.rejected.map((r) => r.name).join(", ")}`,
      );
    Object.assign(
      result,
      options.provenance ?? (await collectBrowserProvenance(cwd, env)),
      {
        acceptanceCriteriaByGroup:
          performanceAcceptanceCriteriaByGroupForProfile(profile),
        ...performanceSamplingMetadata(profile),
      },
    );
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
      await checkpoint();
      const child = await (options.spawn ?? spawnInvocation)(invocation, cwd);
      Object.assign(entry, child);
      await checkpoint();
      const childPassed = child.exitCode === 0 && !child.signal && !child.error;
      if (definition.group !== "functional") {
        const evidence = await (options.verify ?? verifyGroupEvidence)({
          runRoot,
          group: definition.group,
          phase,
          runId,
          profile,
        });
        entry.evidenceStatus = evidence.status;
        entry.evidenceExitCode = evidence.status === "passed" ? 0 : 1;
      } else entry.evidenceStatus = "not-applicable";
      entry.finishedAt = new Date().toISOString();
      entry.status =
        childPassed && entry.evidenceStatus !== "failed" ? "passed" : "failed";
      await checkpoint();
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
  await checkpoint();

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
    const args = process.argv.slice(2),
      options = {};
    if (![2, 4].includes(args.length))
      throw new Error("Usage: --phase before|after [--profile pr|completion]");
    for (let i = 0; i < args.length; i += 2) {
      if (
        !["--phase", "--profile"].includes(args[i]) ||
        !args[i + 1] ||
        Object.hasOwn(options, args[i].slice(2))
      )
        throw new Error("Invalid or duplicate runner option");
      options[args[i].slice(2)] = args[i + 1];
    }
    if (!options.phase) throw new Error("Missing --phase");
    const { exitCode, result } = await runBrowserEvidence(options);
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
