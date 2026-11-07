import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectBrowserSourceIdentity,
  spawnInvocation,
} from "./run-shopping-browser-evidence.mjs";
import { performanceSamplingMetadata } from "./shopping-performance-evidence-contract.mjs";
import { preflight } from "./verify-shopping-performance-evidence.mjs";

// Fixed representative cases: a diagnostic subset, never the acceptance inventory.
export const QUICK_CASES = [
  {
    group: "shopping",
    spec: "tests/browser/responsive-performance.spec.ts",
    titles: [
      "local shopping operations: 500 items, concentrated=false, mapVisible=true, layout=pc @shopping-performance",
    ],
    expectedTests: 1,
  },
  {
    group: "range",
    spec: "tests/browser/edit-execute-range-selection.spec.ts",
    titles: [
      "edit execute chain response: 500 items, smartphone, virtual, long @range-selection-performance @shopping-performance",
    ],
    expectedTests: 1,
  },
  {
    group: "drag",
    spec: "tests/browser/shopping-cross-column-drag.spec.ts",
    titles: [
      "@shopping-performance @shopping-drag-performance 500 touch grouping on",
    ],
    expectedTests: 1,
  },
  {
    group: "transfer",
    spec: "tests/browser/shopping-transfer-rendering.performance.spec.ts",
    titles: [
      "@shopping-performance @shopping-transfer-rendering-performance 500 touch grouping on practical candidate-to-execute response",
      "@shopping-performance @shopping-transfer-rendering-performance 500 touch grouping on practical candidate-to-execute frame",
    ],
    expectedTests: 2,
  },
];
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const groupNames = ["all", ...QUICK_CASES.map(({ group }) => group)];
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseQuickOptions(args) {
  const options = { group: "all" };
  let groupSet = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (groupNames.includes(argument) && !groupSet) {
      options.group = argument;
      groupSet = true;
    } else if (argument === "--list" && !options.list) options.list = true;
    else if (argument === "--group" && !groupSet) {
      options.group = args[++index];
      groupSet = true;
      if (!groupNames.includes(options.group))
        throw new Error(`--group must be ${groupNames.join("|")}`);
    } else
      throw new Error(`Unknown or duplicate quick-check option: ${argument}`);
  }
  return options;
}

export async function runPerformanceQuickCheck(options = {}) {
  const cwd = path.resolve(options.cwd ?? projectRoot);
  const group = options.group ?? "all";
  if (!groupNames.includes(group))
    throw new Error(`Unknown quick-check group: ${group}`);
  const selected = QUICK_CASES.filter(
    (entry) => group === "all" || entry.group === group,
  );
  const runId =
    options.runId ??
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId))
    throw new Error("Invalid run ID");
  const runRoot = path.resolve(cwd, "artifacts/performance-quick-check", runId);
  await mkdir(path.dirname(runRoot), { recursive: true });
  await mkdir(runRoot); // An earlier diagnostic, including a failed one, is never overwritten.
  const env = { ...(options.env ?? process.env) };
  for (const name of Object.keys(env))
    if (
      /^ESP_(?:PERFORMANCE_PROFILE|EVIDENCE_(?:PHASE|RUN_ID|GROUP)|DIAGNOSTIC_QUICK_CHECK)$/i.test(
        name,
      )
    )
      delete env[name];
  env.ESP_PERFORMANCE_PROFILE = "pr";
  let source;
  try {
    source = options.sourceIdentity ?? collectBrowserSourceIdentity(cwd);
  } catch {
    source = { productCommit: null, sourceState: "unavailable" };
  }
  const started = Date.now();
  const result = {
    schemaVersion: 1,
    kind: "development-performance-quick-check",
    diagnosticOnly: true,
    acceptanceMeasurement: false,
    full144CaseAcceptanceMeasured: false,
    ...performanceSamplingMetadata("pr"),
    ...source,
    runId,
    runRoot,
    startedAt: new Date(started).toISOString(),
    status: "failed",
    groups: selected.map(({ group, expectedTests, spec, titles }) => ({
      group,
      expectedTests,
      spec,
      titles,
      status: "not-run",
      exitCode: null,
    })),
  };
  const output = path.join(runRoot, "quick-check-result.json");
  const checkpoint = async () => {
    const temporary = path.join(runRoot, `quick-check-${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, output);
  };
  await checkpoint();
  try {
    // Reject other profiling/debug changes before adding our diagnostic-only identity.
    result.preflight = await preflight({ env, runRoot, profile: "pr" });
    if (result.preflight.status !== "passed")
      throw new Error(
        `Quick-check preflight rejected: ${result.preflight.rejected.map(({ name }) => name).join(", ")}`,
      );
    for (const entry of result.groups) {
      const groupRoot = path.join(runRoot, entry.group);
      await mkdir(groupRoot);
      const reportPath = path.join(groupRoot, "report.json");
      const invocation = {
        command: process.execPath,
        args: [
          path.join(cwd, "node_modules/@playwright/test/cli.js"),
          "test",
          entry.spec,
          "--grep",
          `(?:${entry.titles.map(escapeRegex).join("|")})$`,
          "--workers=1",
          "--retries=0",
          "--output",
          path.join(groupRoot, "test-results"),
          "--reporter=line,json",
        ],
        env: {
          ...env,
          ESP_DIAGNOSTIC_QUICK_CHECK: "1",
          ESP_EVIDENCE_PHASE: "diagnostic",
          ESP_EVIDENCE_RUN_ID: runId,
          ESP_EVIDENCE_GROUP: entry.group,
          PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
        },
      };
      entry.reportPath = reportPath;
      entry.command = [invocation.command, ...invocation.args];
      const groupStarted = Date.now();
      entry.startedAt = new Date(groupStarted).toISOString();
      entry.status = "running";
      await checkpoint();
      Object.assign(
        entry,
        await (options.spawn ?? spawnInvocation)(invocation, cwd),
      );
      entry.finishedAt = new Date().toISOString();
      entry.elapsedMs = Date.now() - groupStarted;
      entry.status = "failed";
      if (entry.exitCode !== 0 || entry.signal || entry.error)
        throw new Error(`${entry.group} quick check failed`);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      const stats = report.stats;
      entry.stats = stats;
      if (
        !stats ||
        stats.expected !== entry.expectedTests ||
        stats.unexpected !== 0 ||
        stats.skipped !== 0 ||
        stats.flaky !== 0 ||
        report.errors?.length
      )
        throw new Error(
          `${entry.group}: incomplete or failing quick-check report`,
        );
      entry.status = "passed";
      await checkpoint();
    }
    result.status = "passed";
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    for (const entry of result.groups)
      if (entry.status === "running") entry.status = "failed";
  }
  result.finishedAt = new Date().toISOString();
  result.elapsedMs = Date.now() - started;
  await checkpoint();
  return { exitCode: result.status === "passed" ? 0 : 1, result };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseQuickOptions(process.argv.slice(2));
    if (options.list) {
      process.stdout.write(
        `${JSON.stringify(
          QUICK_CASES.filter(
            ({ group }) => options.group === "all" || group === options.group,
          ),
          null,
          2,
        )}\n`,
      );
    } else {
      process.stdout.write(
        "Development diagnostic: representative cases, 2 samples; not full acceptance.\n",
      );
      const { exitCode, result } = await runPerformanceQuickCheck(options);
      for (const entry of result.groups)
        process.stdout.write(
          `${entry.group}: ${entry.status}${entry.elapsedMs === undefined ? "" : ` (${(entry.elapsedMs / 1000).toFixed(1)}s)`}\n`,
        );
      process.stdout.write(
        `${result.status.toUpperCase()} diagnostic: ${result.runRoot}${result.error ? `\n${result.error}` : ""}\n`,
      );
      process.exitCode = exitCode;
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
